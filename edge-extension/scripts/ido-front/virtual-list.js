/**
 * Virtual List / DOM Cache Manager
 * 虚拟列表与 DOM 缓存管理器
 * 
 * 核心优化策略：
 * 1. 消息 DOM 缓存 - 切换对话时保留已渲染的消息，避免重复渲染
 * 2. 窗口化渲染 - 只渲染可视区域附近的消息，减少 DOM 节点数
 * 3. 增量更新 - 只更新变化的消息，复用未变化的 DOM
 */
(function() {
    'use strict';

    window.IdoFront = window.IdoFront || {};

    // 配置常量
    const CONFIG = {
        // 缓存的最大对话数（LRU 淘汰）
        MAX_CACHED_CONVERSATIONS: 5,
        // 初始渲染的消息数（最近的 N 条）
        INITIAL_RENDER_COUNT: 20,
        // 向上滚动时每次加载的消息数
        LOAD_MORE_COUNT: 15,
        // 触发加载更多的滚动阈值（距离顶部的像素）
        LOAD_MORE_THRESHOLD: 200,
        // 对话列表虚拟化阈值（超过此数量启用虚拟化）
        CONVERSATION_VIRTUALIZE_THRESHOLD: 30
    };

    /**
     * 消息渲染缓存
     * 结构: Map<conversationId, { fragment: DocumentFragment, messageIds: string[], scrollTop: number }>
     */
    const messageCache = new Map();
    
    /**
     * LRU 访问顺序
     */
    const cacheAccessOrder = [];

    /**
     * 对话列表 DOM 缓存
     * 结构: Map<convId, HTMLElement>
     */
    const conversationItemCache = new Map();

    /**
     * 当前渲染状态
     */
    const renderState = {
        currentConvId: null,
        renderedMessageCount: 0,
        totalMessageCount: 0,
        isLoadingMore: false,
        scrollHandler: null
    };

    /**
     * 更新 LRU 缓存顺序
     */
    function touchCache(convId) {
        const idx = cacheAccessOrder.indexOf(convId);
        if (idx !== -1) {
            cacheAccessOrder.splice(idx, 1);
        }
        cacheAccessOrder.push(convId);

        // 淘汰超出限制的缓存
        while (cacheAccessOrder.length > CONFIG.MAX_CACHED_CONVERSATIONS) {
            const evictId = cacheAccessOrder.shift();
            messageCache.delete(evictId);
        }
    }

    /**
     * 保存当前对话的消息 DOM 到缓存
     * @param {string} convId - 对话 ID
     * @param {HTMLElement} chatStream - 聊天流容器
     */
    function saveToCache(convId, chatStream) {
        if (!convId || !chatStream) return;

        // 直接移动当前所有消息到 DocumentFragment（保留事件处理器）
        // 不使用 cloneNode，因为克隆不会保留事件处理器
        const fragment = document.createDocumentFragment();
        const messages = Array.from(chatStream.querySelectorAll('[data-message-id]'));
        
        const messageIds = [];
        messages.forEach(msg => {
            messageIds.push(msg.dataset.messageId);
            // 直接移动节点到 fragment，保留所有事件处理器
            fragment.appendChild(msg);
        });

        messageCache.set(convId, {
            fragment,
            messageIds,
            scrollTop: chatStream.scrollTop,
            timestamp: Date.now()
        });

        touchCache(convId);
    }

    /**
     * 从缓存恢复消息 DOM
     * @param {string} convId - 对话 ID
     * @param {HTMLElement} chatStream - 聊天流容器
     * @param {Function} rebindEvents - 重新绑定事件的回调（现在主要用于分支切换器）
     * @returns {boolean} 是否成功恢复
     */
    function restoreFromCache(convId, chatStream, rebindEvents) {
        const cached = messageCache.get(convId);
        if (!cached) return false;

        // 检查 fragment 是否为空（节点可能已被移走）
        if (!cached.fragment.firstChild) {
            messageCache.delete(convId);
            return false;
        }

        // 验证缓存是否仍然有效（消息 ID 列表是否匹配）
        const store = window.IdoFront?.store;
        if (!store) return false;

        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return false;

        const activePath = store.getActivePath(convId);
        const currentIds = activePath.map(m => m.id);
        
        // 性能优化：使用 join 生成快照进行比较，比 every() 更快
        // 对于长消息列表，字符串比较通常比逐元素比较更高效
        const cachedSnapshot = cached.messageIds.join(',');
        const currentSnapshot = currentIds.join(',');
        const cacheValid = cachedSnapshot === currentSnapshot;

        if (!cacheValid) {
            messageCache.delete(convId);
            return false;
        }

        // 清空当前内容
        chatStream.innerHTML = '';

        // 直接移动缓存中的节点到 chatStream（保留所有事件处理器）
        // 不使用 cloneNode，这样按钮的 onclick 等事件都能保留
        while (cached.fragment.firstChild) {
            chatStream.appendChild(cached.fragment.firstChild);
        }

        // 恢复滚动位置
        chatStream.scrollTop = cached.scrollTop;

        // 由于使用移动而非克隆，大部分事件处理器已保留
        // 但分支切换器的事件可能需要更新（因为分支信息可能变化）
        if (typeof rebindEvents === 'function') {
            rebindEvents(chatStream);
        }

        // 移除缓存条目（节点已被移走，fragment 现在为空）
        messageCache.delete(convId);
        const idx = cacheAccessOrder.indexOf(convId);
        if (idx !== -1) {
            cacheAccessOrder.splice(idx, 1);
        }

        return true;
    }

    /**
     * 使缓存失效
     * @param {string} convId - 对话 ID（不传则清除所有）
     */
    function invalidateCache(convId) {
        if (convId) {
            messageCache.delete(convId);
            const idx = cacheAccessOrder.indexOf(convId);
            if (idx !== -1) {
                cacheAccessOrder.splice(idx, 1);
            }
        } else {
            messageCache.clear();
            cacheAccessOrder.length = 0;
        }
    }

    /**
     * 窗口化渲染消息
     * 初始只渲染最近的 N 条消息，滚动时动态加载更多
     * 
     * @param {Array} activePath - 完整的消息路径
     * @param {HTMLElement} chatStream - 聊天流容器
     * @param {Function} renderMessage - 渲染单条消息的函数
     * @param {Object} options - 渲染选项
     * @returns {Object} 渲染结果 { renderedCount, totalCount }
     */
    function windowedRender(activePath, chatStream, renderMessage, options = {}) {
        const total = activePath.length;
        const initialCount = options.initialCount || CONFIG.INITIAL_RENDER_COUNT;

        // 清空容器
        chatStream.innerHTML = '';

        if (total === 0) {
            return { renderedCount: 0, totalCount: 0 };
        }

        // 计算初始渲染范围（最后 N 条消息）
        const startIndex = Math.max(0, total - initialCount);
        const messagesToRender = activePath.slice(startIndex);

        // 如果有更多消息，添加 "加载更多" 占位符
        if (startIndex > 0) {
            const loadMorePlaceholder = document.createElement('div');
            loadMorePlaceholder.className = 'ido-load-more-placeholder';
            loadMorePlaceholder.dataset.remainingCount = startIndex;
            loadMorePlaceholder.innerHTML = `
                <button class="ido-load-more-btn">
                    <span class="material-symbols-outlined">expand_less</span>
                    加载更早的 ${startIndex} 条消息
                </button>
            `;
            loadMorePlaceholder.querySelector('button').onclick = () => {
                loadMoreMessages(activePath, chatStream, renderMessage, startIndex);
            };
            chatStream.appendChild(loadMorePlaceholder);
        }

        // 使用 DocumentFragment 批量渲染
        const fragment = document.createDocumentFragment();
        messagesToRender.forEach((msg, idx) => {
            renderMessage(msg, fragment, { index: startIndex + idx, total });
        });
        chatStream.appendChild(fragment);

        // 滚动到底部
        chatStream.scrollTop = chatStream.scrollHeight;

        // 设置滚动监听器（用于自动加载更多）
        setupScrollListener(activePath, chatStream, renderMessage, startIndex);

        renderState.currentConvId = options.convId;
        renderState.renderedMessageCount = messagesToRender.length;
        renderState.totalMessageCount = total;

        return {
            renderedCount: messagesToRender.length,
            totalCount: total,
            hasMore: startIndex > 0
        };
    }

    /**
     * 加载更多消息
     */
    function loadMoreMessages(activePath, chatStream, renderMessage, currentStartIndex) {
        if (renderState.isLoadingMore || currentStartIndex <= 0) return;

        renderState.isLoadingMore = true;

        const loadCount = CONFIG.LOAD_MORE_COUNT;
        const newStartIndex = Math.max(0, currentStartIndex - loadCount);
        const messagesToLoad = activePath.slice(newStartIndex, currentStartIndex);

        // 记录当前滚动位置和第一个可见元素
        const firstMessage = chatStream.querySelector('[data-message-id]');
        const scrollAnchor = firstMessage ? {
            id: firstMessage.dataset.messageId,
            offsetTop: firstMessage.getBoundingClientRect().top
        } : null;

        // 移除旧的占位符
        const placeholder = chatStream.querySelector('.ido-load-more-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // 创建新消息的 fragment
        const fragment = document.createDocumentFragment();

        // 如果还有更多，添加新的占位符
        if (newStartIndex > 0) {
            const newPlaceholder = document.createElement('div');
            newPlaceholder.className = 'ido-load-more-placeholder';
            newPlaceholder.dataset.remainingCount = newStartIndex;
            newPlaceholder.innerHTML = `
                <button class="ido-load-more-btn">
                    <span class="material-symbols-outlined">expand_less</span>
                    加载更早的 ${newStartIndex} 条消息
                </button>
            `;
            newPlaceholder.querySelector('button').onclick = () => {
                loadMoreMessages(activePath, chatStream, renderMessage, newStartIndex);
            };
            fragment.appendChild(newPlaceholder);
        }

        // 渲染新消息
        messagesToLoad.forEach((msg, idx) => {
            renderMessage(msg, fragment, { index: newStartIndex + idx, total: activePath.length });
        });

        // 插入到容器开头
        chatStream.insertBefore(fragment, chatStream.firstChild);

        // 恢复滚动位置
        if (scrollAnchor) {
            const anchorElement = chatStream.querySelector(`[data-message-id="${scrollAnchor.id}"]`);
            if (anchorElement) {
                const newOffsetTop = anchorElement.getBoundingClientRect().top;
                chatStream.scrollTop += (newOffsetTop - scrollAnchor.offsetTop);
            }
        }

        renderState.renderedMessageCount += messagesToLoad.length;
        renderState.isLoadingMore = false;

        // 更新滚动监听器
        setupScrollListener(activePath, chatStream, renderMessage, newStartIndex);
    }

    /**
     * 设置滚动监听器
     */
    function setupScrollListener(activePath, chatStream, renderMessage, currentStartIndex) {
        // 移除旧的监听器
        if (renderState.scrollHandler) {
            chatStream.removeEventListener('scroll', renderState.scrollHandler);
        }

        if (currentStartIndex <= 0) {
            renderState.scrollHandler = null;
            return;
        }

        renderState.scrollHandler = () => {
            if (chatStream.scrollTop < CONFIG.LOAD_MORE_THRESHOLD && !renderState.isLoadingMore) {
                loadMoreMessages(activePath, chatStream, renderMessage, currentStartIndex);
            }
        };

        chatStream.addEventListener('scroll', renderState.scrollHandler, { passive: true });
    }

    /**
     * 差分更新对话列表
     * 只更新变化的项，复用未变化的 DOM
     * 
     * @param {Array} conversations - 对话列表
     * @param {HTMLElement} container - 容器元素
     * @param {Function} createItem - 创建单个对话项的函数
     * @param {string} activeId - 当前活跃的对话 ID
     */
    function diffUpdateConversationList(conversations, container, createItem, activeId) {
        // 处理空列表
        if (conversations.length === 0) {
            container.innerHTML = '';
            const placeholder = document.createElement('div');
            placeholder.className = 'ido-empty-placeholder text-center py-8 text-gray-400 text-xs';
            placeholder.textContent = '暂无对话';
            container.appendChild(placeholder);
            return;
        }
        
        // 移除空占位符
        const emptyPlaceholder = container.querySelector('.ido-empty-placeholder');
        if (emptyPlaceholder) emptyPlaceholder.remove();
        
        // 获取当前 DOM 中的对话项，构建映射
        const existingMap = new Map();
        Array.from(container.querySelectorAll('[data-conv-id]')).forEach(item => {
            existingMap.set(item.dataset.convId, item);
            // 先从 DOM 中移除（但保留在内存中，事件处理器不丢失）
            item.remove();
        });
        
        // 构建新的 ID 集合
        const newIds = new Set(conversations.map(c => c.id));
        
        // 按正确顺序添加项
        conversations.forEach((conv) => {
            let item = existingMap.get(conv.id);
            
            if (item) {
                // 复用已存在的项，更新状态
                updateConversationItem(item, conv, activeId);
            } else {
                // 创建新项
                item = createItem(conv, activeId);
            }
            
            // 添加到容器末尾（因为我们按顺序遍历，所以末尾添加就是正确顺序）
            container.appendChild(item);
        });
    }

    /**
     * 更新单个对话项
     */
    function updateConversationItem(item, conv, activeId) {
        const isActive = conv.id === activeId;
        
        // 更新活跃状态样式
        if (isActive) {
            item.classList.add('bg-blue-50', 'text-blue-700');
            item.classList.remove('hover:bg-gray-100', 'text-gray-700');
        } else {
            item.classList.remove('bg-blue-50', 'text-blue-700');
            item.classList.add('hover:bg-gray-100', 'text-gray-700');
        }

        // 更新标题
        const titleEl = item.querySelector('.flex-1.truncate');
        if (titleEl) {
            const newTitle = conv.title || '新对话';
            if (titleEl.textContent !== newTitle) {
                titleEl.textContent = newTitle;
                titleEl.title = newTitle;
            }
        }
    }

    /**
     * 获取缓存统计信息
     */
    function getCacheStats() {
        return {
            cachedConversations: messageCache.size,
            cacheOrder: [...cacheAccessOrder],
            currentState: { ...renderState },
            config: { ...CONFIG }
        };
    }

    /**
     * 更新配置
     */
    function updateConfig(updates) {
        Object.assign(CONFIG, updates);
    }

    // 导出 API
    window.IdoFront.virtualList = {
        // 缓存管理
        saveToCache,
        restoreFromCache,
        invalidateCache,
        
        // 窗口化渲染
        windowedRender,
        loadMoreMessages,
        
        // 差分更新
        diffUpdateConversationList,
        
        // 配置与统计
        getCacheStats,
        updateConfig,
        CONFIG
    };

})();