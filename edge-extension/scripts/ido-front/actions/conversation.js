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
            
            // 监听对话重命名事件，增量更新侧边栏
            store.events.on('conversation:renamed', (data) => {
                updateConversationTitleInList(data.id, data.title);
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
        
        // syncUI 会统一处理 loading 状态和发送按钮状态
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
                    
                    // ★ 累计计时字段（用于恢复进行中的计时器）
                    if (msg.reasoningAccumulatedTime !== undefined) {
                        payload.reasoningAccumulatedTime = msg.reasoningAccumulatedTime;
                    }
                    if (msg.reasoningSegmentStart !== undefined) {
                        payload.reasoningSegmentStart = msg.reasoningSegmentStart;
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

            // 唯一判断条件：typingMessageId 是否在当前活跃路径中
            const typingMsgId = store.state.typingMessageId;
            
            // 清理所有独立的 loading 气泡（syncUI 重建后不应该有残留）
            const loadingChatStream = document.getElementById('chat-stream');
            if (loadingChatStream) {
                const strayLoadings = loadingChatStream.querySelectorAll('[data-loading-id]');
                strayLoadings.forEach(el => el.remove());
            }
            
            // 判断 typingMsgId 是否在当前活跃路径中
            const isTypingMsgInActivePath = typingMsgId && activePath.some(m => m.id === typingMsgId);
            
            if (isTypingMsgInActivePath && context) {
                // 消息在活跃路径中，恢复 loading 指示器到该消息
                if (context.addLoadingIndicator && context.attachLoadingIndicatorToMessage) {
                    const loadingId = context.addLoadingIndicator();
                    const attached = context.attachLoadingIndicatorToMessage(loadingId, typingMsgId);
                    if (!attached && context.removeLoadingIndicator) {
                        context.removeLoadingIndicator(loadingId);
                    }
                }
                // 发送按钮禁用（与 loading 一致）
                if (context.setSendButtonLoading) {
                    context.setSendButtonLoading(true);
                }
            } else {
                // 消息不在活跃路径中，或无活跃生成
                // 发送按钮可用（用户可以在其他分支发送消息）
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
            item.dataset.convId = conv.id;
            
            const title = document.createElement('div');
            title.className = "flex-1 text-xs font-medium truncate";
            title.textContent = conv.title || '新对话';
            title.title = conv.title || '新对话';
            
            // 编辑按钮
            const editBtn = document.createElement('button');
            editBtn.className = "opacity-0 group-hover:opacity-100 p-1 hover:bg-blue-50 text-gray-400 hover:text-blue-500 rounded transition-all";
            editBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">edit</span>';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                startInlineEdit(item, title, conv.id, conv.title || '新对话');
            };
            
            // 删除按钮
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
            item.appendChild(editBtn);
            item.appendChild(deleteBtn);
            listContainer.appendChild(item);
        });
    }

    /**
     * 增量更新对话列表中的标题
     * @param {string} convId - 对话 ID
     * @param {string} newTitle - 新标题
     */
    function updateConversationTitleInList(convId, newTitle) {
        const listContainer = document.getElementById('history-list');
        if (!listContainer) return;
        
        const item = listContainer.querySelector(`[data-conv-id="${convId}"]`);
        if (!item) return;
        
        const titleEl = item.querySelector('.flex-1.text-xs.font-medium.truncate');
        if (!titleEl) return;
        
        // 更新标题内容
        titleEl.textContent = newTitle;
        titleEl.title = newTitle;
        
        // 添加高亮动效
        item.classList.add('ido-title-updated');
        
        // 动效结束后移除类
        setTimeout(() => {
            item.classList.remove('ido-title-updated');
        }, 1500);
        
        // 同步更新 header（如果是当前活跃对话）
        if (convId === store.state.activeConversationId) {
            const headerTitle = document.getElementById('chat-title');
            if (headerTitle && headerTitle.dataset.editing !== 'true') {
                headerTitle.textContent = newTitle;
            }
        }
    }

    /**
     * 启动内联编辑模式（对话列表项）
     */
    function startInlineEdit(itemEl, titleEl, convId, currentTitle) {
        // 如果已经在编辑模式，忽略
        if (itemEl.querySelector('input')) return;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.className = 'flex-1 text-xs font-medium bg-white border border-blue-400 rounded px-1 py-0.5 outline-none';
        input.style.minWidth = '0';
        
        // 隐藏原标题
        titleEl.style.display = 'none';
        
        // 插入输入框
        itemEl.insertBefore(input, titleEl);
        input.focus();
        input.select();
        
        const finishEdit = (save) => {
            if (save) {
                const newTitle = input.value.trim();
                if (newTitle && newTitle !== currentTitle) {
                    store.renameConversation(convId, newTitle, 'user');
                    titleEl.textContent = newTitle;
                    titleEl.title = newTitle;
                    // 同步更新 header（如果是当前活跃对话）
                    if (convId === store.state.activeConversationId) {
                        const headerTitle = document.getElementById('chat-title');
                        if (headerTitle) {
                            headerTitle.textContent = newTitle;
                        }
                    }
                }
            }
            input.remove();
            titleEl.style.display = '';
        };
        
        input.onblur = () => finishEdit(true);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishEdit(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
            }
        };
        
        // 阻止点击事件冒泡以免触发选择
        input.onclick = (e) => e.stopPropagation();
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
            
            // 添加可编辑样式提示
            titleEl.style.cursor = conv ? 'pointer' : 'default';
            titleEl.title = conv ? '点击编辑标题' : '';
            
            // 移除旧的事件监听器（避免重复绑定）
            titleEl.onclick = null;
            
            if (conv) {
                titleEl.onclick = (e) => {
                    e.stopPropagation();
                    startHeaderTitleEdit(titleEl, conv.id, conv.title || '新对话');
                };
            }
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

    /**
     * 启动 Header 标题编辑模式
     */
    function startHeaderTitleEdit(titleEl, convId, currentTitle) {
        // 如果已经在编辑模式，忽略
        if (titleEl.dataset.editing === 'true') return;
        titleEl.dataset.editing = 'true';
        
        const originalText = titleEl.textContent;
        const originalStyles = {
            cursor: titleEl.style.cursor,
            minWidth: titleEl.style.minWidth
        };
        
        // 创建输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.className = 'bg-transparent border-b border-blue-400 outline-none text-inherit font-inherit';
        input.style.width = Math.max(100, titleEl.offsetWidth + 20) + 'px';
        input.style.fontSize = 'inherit';
        input.style.fontWeight = 'inherit';
        
        // 隐藏原标题文本
        titleEl.textContent = '';
        titleEl.appendChild(input);
        titleEl.style.cursor = 'text';
        
        input.focus();
        input.select();
        
        const finishEdit = (save) => {
            if (titleEl.dataset.editing !== 'true') return; // 防止重复调用
            titleEl.dataset.editing = 'false';
            
            if (save) {
                const newTitle = input.value.trim();
                if (newTitle && newTitle !== currentTitle) {
                    store.renameConversation(convId, newTitle, 'user');
                    titleEl.textContent = newTitle;
                    // 同步更新对话列表
                    renderConversationList();
                } else {
                    titleEl.textContent = originalText;
                }
            } else {
                titleEl.textContent = originalText;
            }
            
            titleEl.style.cursor = originalStyles.cursor;
        };
        
        input.onblur = () => finishEdit(true);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur(); // 触发 onblur 保存
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
            }
        };
    }

    // 暴露 API 供外部调用
    window.IdoFront.conversationActions.syncUI = syncUI;
    window.IdoFront.conversationActions.renderConversationList = renderConversationList;
    window.IdoFront.conversationActions.getPersonaConversations = getPersonaConversations;

})();