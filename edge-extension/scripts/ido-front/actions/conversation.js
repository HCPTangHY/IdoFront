/**
 * Conversation Actions
 * 对话管理相关操作
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.conversationActions = window.IdoFront.conversationActions || {};

    const DEMO_API_CONFIG = {
        MAX_CONVERSATION_TITLE_LENGTH: 30
    };

    let context = null;
    let store = null;
    let messageActions = null;

    /**
     * 初始化对话管理模块
     */
    window.IdoFront.conversationActions.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        messageActions = window.IdoFront.messageActions;
        
        // 监听面具切换事件，刷新对话列表
        if (store.events) {
            store.events.on('persona:changed', () => {
                renderConversationList();
                // 同步UI以显示新面具的对话
                syncUI();
            });
        }
    };

    /**
     * 创建新对话
     */
    window.IdoFront.conversationActions.create = function(initialText) {
        const title = initialText && initialText.trim()
            ? initialText.trim().slice(0, DEMO_API_CONFIG.MAX_CONVERSATION_TITLE_LENGTH)
            : '新对话';
        const conv = store.createConversationInternal(title);
        store.state.activeConversationId = conv.id;
        
        if (context && context.clearMessages) context.clearMessages();

        if (initialText && initialText.trim()) {
            if (messageActions && messageActions.send) {
                messageActions.send(initialText);
            }
        } else {
            store.persist();
        }
        return conv;
    };

    /**
     * 选择对话
     */
    window.IdoFront.conversationActions.select = function(id) {
        const target = store.state.conversations.find(c => c.id === id);
        if (!target) return;

        store.state.activeConversationId = id;
        
        // If switching to a conversation from a different persona, switch persona too
        if (target.personaId && target.personaId !== store.state.activePersonaId) {
            store.state.activePersonaId = target.personaId;
        }
        
        store.persist();
        
        syncUI();
        updateHeader(target);

        if (context && context.events) {
            context.events.emit('chat:conversation-selected', { conversationId: id });
        }
    };

    /**
     * 删除对话
     */
    window.IdoFront.conversationActions.delete = function(id) {
        store.deleteConversation(id);
        syncUI();
    };

    /**
     * 删除消息
     */
    window.IdoFront.conversationActions.deleteMessage = function(messageId) {
        const active = store.getActiveConversation();
        if (active) {
            store.deleteMessage(active.id, messageId);
            syncUI();
        }
    };

    /**
     * 获取当前面具的对话列表
     */
    function getPersonaConversations() {
        let activePersonaId = store.state.activePersonaId;
        
        // Fallback to first available persona if active is missing
        if (!activePersonaId && store.state.personas && store.state.personas.length > 0) {
            activePersonaId = store.state.personas[0].id;
        }
        
        // If still no active persona (extremely rare), return empty list instead of all
        // to prevent leaking conversations across potential workspaces
        if (!activePersonaId) return [];
        
        return store.state.conversations.filter(c => c.personaId === activePersonaId);
    }

    /**
     * 同步 UI（将 Store 中的消息渲染到界面）
     */
    function syncUI() {
        if (!context) return;
        
        const active = store.getActiveConversation();
        if (active) {
            if (context.clearMessages) context.clearMessages();
            active.messages.forEach(msg => {
                const uiRole = msg.role === 'assistant' ? 'ai' : msg.role;
                const payload = {
                    content: msg.content,
                    id: msg.id
                };
                
                // 添加 reasoning（如果存在）
                if (msg.reasoning) {
                    payload.reasoning = msg.reasoning;
                    
                    // 添加存储的思维链时间（如果存在）
                    if (msg.metadata && msg.metadata.reasoningDuration !== undefined) {
                        payload.reasoningDuration = msg.metadata.reasoningDuration;
                    }
                }
                
                // 添加附件信息（如果存在）
                if (msg.metadata && msg.metadata.attachments) {
                    payload.attachments = msg.metadata.attachments;
                }
                
                context.addMessage(uiRole, payload);
            });
            // 同步时也更新header
            updateHeader(active);
            
            // 批量渲染所有历史消息的 Markdown（性能优化）
            if (context.renderAllPendingMarkdown) {
                // 使用 setTimeout 确保 DOM 已更新
                setTimeout(() => {
                    context.renderAllPendingMarkdown();
                }, 0);
            }
        } else {
            if (context.clearMessages) context.clearMessages();
            // 清空header
            updateHeader(null);
        }
        
        // 更新对话列表（仅显示当前面具的对话）
        renderConversationList();
    }
    
    /**
     * 渲染对话列表（仅显示当前面具的对话）
     */
    function renderConversationList() {
        const listContainer = document.getElementById('history-list');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        
        const personaConvs = getPersonaConversations();
        
        if (personaConvs.length === 0) {
            const empty = document.createElement('div');
            empty.className = "text-center py-8 text-gray-400 text-xs";
            empty.textContent = "暂无对话";
            listContainer.appendChild(empty);
            return;
        }
        
        personaConvs.forEach(conv => {
            const item = document.createElement('div');
            const isActive = conv.id === store.state.activeConversationId;
            item.className = `group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                isActive ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100 text-gray-700'
            }`;
            
            const title = document.createElement('div');
            title.className = "flex-1 text-xs font-medium truncate";
            title.textContent = conv.title || '新对话';
            title.title = conv.title || '新对话';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = "opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-all";
            deleteBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete</span>';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`确定要删除对话 "${conv.title}" 吗？`)) {
                    window.IdoFront.conversationActions.delete(conv.id);
                }
            };
            
            item.onclick = () => {
                window.IdoFront.conversationActions.select(conv.id);
            };
            
            item.appendChild(title);
            item.appendChild(deleteBtn);
            listContainer.appendChild(item);
        });
    }

    /**
     * 更新顶栏信息
     */
    function updateHeader(conv) {
        if (!context) return;
        
        // 更新标题
        const titleEl = document.getElementById('chat-title');
        if (titleEl) {
            titleEl.textContent = conv ? (conv.title || '新对话') : '新对话';
        }
        
        // 更新模型信息
        const modelInfoEl = document.getElementById('model-info');
        if (modelInfoEl) {
            if (conv && conv.selectedChannelId && conv.selectedModel) {
                const channel = store.state.channels.find(c => c.id === conv.selectedChannelId);
                if (channel) {
                    modelInfoEl.textContent = `${channel.name} / ${conv.selectedModel}`;
                } else {
                    modelInfoEl.textContent = '';
                }
            } else {
                modelInfoEl.textContent = '';
            }
        }
    }

    // 暴露 API 供外部调用
    window.IdoFront.conversationActions.syncUI = syncUI;
    window.IdoFront.conversationActions.renderConversationList = renderConversationList;
    window.IdoFront.conversationActions.getPersonaConversations = getPersonaConversations;

})();