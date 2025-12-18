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
        
        // 修复：切换对话后，更新发送按钮状态
        // 检查新对话是否有活跃的生成请求
        const hasActiveGeneration = messageActions && messageActions.hasActiveGeneration
            ? messageActions.hasActiveGeneration(id)
            : false;
        
        const isGenerating = store.state.isTyping &&
                            store.state.typingConversationId === id &&
                            hasActiveGeneration;
        
        if (context && context.setSendButtonLoading) {
            context.setSendButtonLoading(isGenerating);
        }

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
     * 使用活跃路径（getActivePath）而非全部消息，以支持分支功能
     * @param {Object} [options] - 可选配置
     * @param {string} [options.focusMessageId] - 渲染后尝试滚动到的消息 ID（用于分支切换时保持位置）
     * @param {boolean} [options.incrementalFromParent] - 增量更新模式：只更新 focusMessageId 之后的消息
     */
    function syncUI(options) {
        options = options || {};
        if (!context) return;
        
        const active = store.getActiveConversation();
        if (active) {
            const chatStream = document.getElementById('chat-stream');
            
            // 使用活跃路径而非全部消息，以支持分支功能
            const activePath = store.getActivePath(active.id);
            
            // 性能优化：一次性构建 childrenMap，避免 getSiblings 对每条消息重复遍历 O(N²) -> O(N)
            const childrenMap = {};
            active.messages.forEach(m => {
                const pId = m.parentId === undefined || m.parentId === null ? 'root' : m.parentId;
                if (!childrenMap[pId]) childrenMap[pId] = [];
                childrenMap[pId].push(m);
            });
            // 预排序所有分支
            for (const key in childrenMap) {
                childrenMap[key].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            }
            
            // 增量更新模式：只删除并重建 focusMessageId 之后的消息
            let startIndex = 0;
            let scrollAnchor = null;
            let anchorOffsetTop = 0;
            let preserveScrollTop = null;
            
            if (options.focusMessageId && options.incrementalFromParent && chatStream) {
                const anchorEl = chatStream.querySelector(`[data-message-id="${options.focusMessageId}"]`);
                if (anchorEl) {
                    scrollAnchor = options.focusMessageId;
                    anchorOffsetTop = anchorEl.getBoundingClientRect().top - chatStream.getBoundingClientRect().top;
                    
                    // 找到锚点消息在 activePath 中的位置
                    const anchorIndex = activePath.findIndex(m => m.id === options.focusMessageId);
                    if (anchorIndex !== -1) {
                        startIndex = anchorIndex + 1; // 从锚点的下一条开始更新
                        
                        // 删除锚点之后的所有 DOM 节点
                        let sibling = anchorEl.nextElementSibling;
                        while (sibling) {
                            const next = sibling.nextElementSibling;
                            sibling.remove();
                            sibling = next;
                        }
                        
                        // 更新锚点消息的分支切换器（它的分支信息可能已改变）
                        updateMessageBranchSwitcher(anchorEl, activePath[anchorIndex], childrenMap);
                    }
                } else {
                    preserveScrollTop = chatStream.scrollTop;
                }
            } else if (options.focusMessageId && chatStream) {
                const anchorEl = chatStream.querySelector(`[data-message-id="${options.focusMessageId}"]`);
                if (anchorEl) {
                    scrollAnchor = options.focusMessageId;
                    anchorOffsetTop = anchorEl.getBoundingClientRect().top - chatStream.getBoundingClientRect().top;
                } else {
                    preserveScrollTop = chatStream.scrollTop;
                }
            } else if (options.preserveScroll && chatStream) {
                preserveScrollTop = chatStream.scrollTop;
            }
            
            // 如果不是增量更新，清空所有消息
            if (startIndex === 0) {
                if (context.clearMessages) context.clearMessages();
            }
            
            // 使用 DocumentFragment 批量渲染，减少 DOM 重排
            const fragment = document.createDocumentFragment();
            
            for (let idx = startIndex; idx < activePath.length; idx++) {
                const msg = activePath[idx];
                const uiRole = msg.role === 'assistant' ? 'ai' : msg.role;
                const payload = {
                    content: msg.content,
                    id: msg.id,
                    createdAt: msg.createdAt  // 传递消息时间
                };
                
                // 添加 reasoning（如果存在）
                if (msg.reasoning) {
                    payload.reasoning = msg.reasoning;
                    
                    // 添加存储的思维链时间（如果存在）
                    if (msg.reasoningDuration !== undefined) {
                        payload.reasoningDuration = msg.reasoningDuration;
                    }
                }
                
                // 添加附件信息（如果存在）
                if (msg.attachments) {
                    payload.attachments = msg.attachments;
                }
                
                // AI 消息：添加模型名和渠道名
                if (msg.role === 'assistant') {
                    if (msg.modelName) {
                        payload.modelName = msg.modelName;
                    }
                    if (msg.channelName) {
                        payload.channelName = msg.channelName;
                    }
                    // 添加统计信息（如果存在）
                    if (msg.stats) {
                        payload.stats = msg.stats;
                    }
                }
                
                // 添加分支信息（使用预构建的 childrenMap，O(1) 查找）
                const parentKey = msg.parentId === undefined || msg.parentId === null ? 'root' : msg.parentId;
                const siblings = childrenMap[parentKey] || [];
                if (siblings.length > 1) {
                    const currentIndex = siblings.findIndex(s => s.id === msg.id);
                    payload.branchInfo = {
                        currentIndex,
                        total: siblings.length,
                        siblings: siblings.map(s => s.id)
                    };
                }
                
                // 批量渲染：所有消息都不触发滚动，使用 fragment 作为目标容器
                context.addMessage(uiRole, payload, {
                    noScroll: true,
                    targetContainer: fragment,
                    isHistorical: true  // 标记为历史消息，避免启动计时器
                });
            }
            
            // 一次性插入所有消息到 DOM
            if (chatStream && fragment.childNodes.length > 0) {
                chatStream.appendChild(fragment);
            }
            
            // 恢复滚动位置
            if (chatStream) {
                if (scrollAnchor) {
                    const anchorEl = chatStream.querySelector(`[data-message-id="${scrollAnchor}"]`);
                    if (anchorEl) {
                        const newOffsetTop = anchorEl.getBoundingClientRect().top - chatStream.getBoundingClientRect().top;
                        chatStream.scrollTop += (newOffsetTop - anchorOffsetTop);
                    } else if (preserveScrollTop !== null) {
                        chatStream.scrollTop = preserveScrollTop;
                    }
                } else if (preserveScrollTop !== null) {
                    chatStream.scrollTop = preserveScrollTop;
                } else if (startIndex === 0) {
                    // 完全重建时滚动到底部
                    chatStream.scrollTop = chatStream.scrollHeight;
                }
            }
            
            // 同步时也更新header
            updateHeader(active);
            
            // 批量渲染所有历史消息的 Markdown（性能优化）
            if (context.renderAllPendingMarkdown) {
                // 使用 requestAnimationFrame 确保 DOM 已更新，避免宏任务排队带来的延迟
                requestAnimationFrame(() => {
                    context.renderAllPendingMarkdown();
                });
            }

            // 如果当前对话正在生成回复，恢复对应的加载指示器 / 流式状态
            if (store.state.isTyping && store.state.typingConversationId === active.id && context) {
                const typingMsgId = store.state.typingMessageId;

                // 兜底校验：若没有活跃生成标记，避免创建幽灵 loading
                const hasActiveGen = window.IdoFront.messageActions && window.IdoFront.messageActions.hasActiveGeneration
                    ? window.IdoFront.messageActions.hasActiveGeneration(active.id)
                    : false;

                // 先清理可能残留的流式指示器（例如上一次渲染留下的）
                if (typingMsgId && context.removeMessageStreamingIndicator) {
                    try {
                        context.removeMessageStreamingIndicator(typingMsgId);
                    } catch (e) {
                        console.warn('removeMessageStreamingIndicator error:', e);
                    }
                }

                if (hasActiveGen && typingMsgId && context.addLoadingIndicator && context.attachLoadingIndicatorToMessage) {
                    // 已经有助手消息，直接在该消息下方挂载 loading 指示器
                    const loadingId = context.addLoadingIndicator();
                    context.attachLoadingIndicatorToMessage(loadingId, typingMsgId);
                    // 同步发送按钮状态
                    if (context.setSendButtonLoading) {
                        context.setSendButtonLoading(true);
                    }
                } else if (hasActiveGen && !typingMsgId && context.addLoadingIndicator) {
                    // 还没有助手消息（请求已发出但首个 chunk 未到达），显示独立的 loading 气泡
                    context.addLoadingIndicator();
                    // 同步发送按钮状态
                    if (context.setSendButtonLoading) {
                        context.setSendButtonLoading(true);
                    }
                } else {
                    // 无活跃生成，清理全局 typing 状态，避免幽灵 loading
                    store.state.isTyping = false;
                    store.state.typingConversationId = null;
                    store.state.typingMessageId = null;
                    store.persist();
                    // 同步发送按钮状态
                    if (context.setSendButtonLoading) {
                        context.setSendButtonLoading(false);
                    }
                }
            } else {
                // 当前对话没有进行中的生成，确保按钮状态正确
                if (context.setSendButtonLoading) {
                    context.setSendButtonLoading(false);
                }
            }
        } else {
            if (context.clearMessages) context.clearMessages();
            // 清空header
            updateHeader(null);
            // 没有活跃对话时，确保按钮状态正确
            if (context.setSendButtonLoading) {
                context.setSendButtonLoading(false);
            }
        }
        
        // 更新对话列表（仅显示当前面具的对话）
        renderConversationList();
    }
    
    /**
     * 渲染对话列表（仅显示当前面具的对话）
     * 列表按最近更新时间倒序排列：最新有消息活动的对话排在最前
     */
    function renderConversationList() {
        const listContainer = document.getElementById('history-list');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        
        // 根据 updatedAt / createdAt 倒序排序，最近活跃的对话排在前面
        const personaConvs = getPersonaConversations()
            .slice()
            .sort((a, b) => {
                const aTime = a.updatedAt || a.createdAt || 0;
                const bTime = b.updatedAt || b.createdAt || 0;
                return bTime - aTime;
            });
        
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
     * 更新消息的分支切换器（用于增量更新时更新锚点消息）
     */
    function updateMessageBranchSwitcher(msgEl, msg, childrenMap) {
        if (!msgEl || !msg) return;
        
        const parentKey = msg.parentId === undefined || msg.parentId === null ? 'root' : msg.parentId;
        const siblings = childrenMap[parentKey] || [];
        
        // 查找现有的 controls 容器
        const controls = msgEl.querySelector('.ido-message__controls');
        if (!controls) return;
        
        // 查找现有的分支切换器
        const existingSwitcher = controls.querySelector('.ido-branch-switcher');
        
        if (siblings.length > 1) {
            const currentIndex = siblings.findIndex(s => s.id === msg.id);
            const branchInfo = {
                currentIndex,
                total: siblings.length,
                siblings: siblings.map(s => s.id)
            };
            
            if (existingSwitcher) {
                // 更新现有切换器的状态
                const counter = existingSwitcher.querySelector('.ido-branch-switcher__counter');
                if (counter) {
                    counter.textContent = `${currentIndex + 1}/${siblings.length}`;
                }
                const prevBtn = existingSwitcher.querySelector('.ido-branch-switcher__btn:first-child');
                const nextBtn = existingSwitcher.querySelector('.ido-branch-switcher__btn:last-child');
                if (prevBtn) prevBtn.disabled = currentIndex === 0;
                if (nextBtn) nextBtn.disabled = currentIndex === siblings.length - 1;
            } else {
                // 创建新的切换器（使用 FrameworkMessages 模块）
                const FrameworkMessages = window.FrameworkMessages || (typeof globalThis !== 'undefined' && globalThis.FrameworkMessages);
                if (FrameworkMessages && FrameworkMessages.createBranchSwitcher) {
                    const newSwitcher = FrameworkMessages.createBranchSwitcher(msg.id, branchInfo);
                    controls.appendChild(newSwitcher);
                }
            }
        } else if (existingSwitcher) {
            // 不再需要切换器
            existingSwitcher.remove();
        }
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