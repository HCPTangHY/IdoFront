/**
 * Comlink Bridge
 * 使用 Comlink 简化主线程与沙箱 iframe 之间的 RPC 通信
 * 
 * 主线程侧：暴露 Framework/Store API 供沙箱调用
 * 沙箱侧：暴露 Plugin/Channel API 供主线程调用
 */
(function() {
    'use strict';

    window.IdoFront = window.IdoFront || {};

    // Store 事件订阅管理
    const storeEventSubscriptions = new Map(); // eventName -> Set<pluginId>
    
    /**
     * 主线程 API - 暴露给沙箱调用
     */
    const MainThreadAPI = {
        // ============================================================
        // Framework API
        // ============================================================
        
        addMessage(role, content, options) {
            if (window.Framework?.addMessage) {
                window.Framework.addMessage(role, content, options);
            }
        },
        
        updateLastMessage(content) {
            if (window.Framework?.updateLastMessage) {
                window.Framework.updateLastMessage(content);
            }
        },
        
        clearMessages() {
            if (window.Framework?.clearMessages) {
                window.Framework.clearMessages();
            }
        },
        
        togglePanel(side, force) {
            if (window.Framework?.togglePanel) {
                window.Framework.togglePanel(side, force);
            }
        },
        
        setMode(mode) {
            if (window.Framework?.setMode) {
                window.Framework.setMode(mode);
            }
        },
        
        refreshSlot(slotName) {
            if (window.Framework?.refreshSlot) {
                window.Framework.refreshSlot(slotName);
            }
        },
        
        hideBottomSheet() {
            if (window.Framework?.hideBottomSheet) {
                window.Framework.hideBottomSheet();
            }
        },
        
        restoreDefaultRightPanel() {
            if (window.Framework?.restoreDefaultRightPanel) {
                window.Framework.restoreDefaultRightPanel();
            }
        },
        
        finalizeStreamingMessage() {
            if (window.Framework?.finalizeStreamingMessage) {
                window.Framework.finalizeStreamingMessage();
            }
        },
        
        renderAllPendingMarkdown() {
            if (window.Framework?.renderAllPendingMarkdown) {
                window.Framework.renderAllPendingMarkdown();
            }
        },
        
        removeMessageStreamingIndicator(messageId) {
            if (window.Framework?.removeMessageStreamingIndicator) {
                window.Framework.removeMessageStreamingIndicator(messageId);
            }
        },
        
        removeLoadingIndicator(loadingId) {
            if (window.Framework?.removeLoadingIndicator) {
                window.Framework.removeLoadingIndicator(loadingId);
            }
        },
        
        // ============================================================
        // DOM Class API (for theme plugins)
        // ============================================================
        
        addBodyClass(className) {
            if (typeof className !== 'string' || !className.trim()) return;
            const sanitizedClass = className.trim().replace(/[^a-zA-Z0-9_-]/g, '');
            document.documentElement.classList.add(sanitizedClass);
            document.body.classList.add(sanitizedClass);
        },
        
        removeBodyClass(className) {
            if (typeof className !== 'string' || !className.trim()) return;
            const sanitizedClass = className.trim().replace(/[^a-zA-Z0-9_-]/g, '');
            document.documentElement.classList.remove(sanitizedClass);
            document.body.classList.remove(sanitizedClass);
        },
        
        toggleBodyClass(className, force) {
            if (typeof className !== 'string' || !className.trim()) return;
            const sanitizedClass = className.trim().replace(/[^a-zA-Z0-9_-]/g, '');
            if (force === true) {
                document.documentElement.classList.add(sanitizedClass);
                document.body.classList.add(sanitizedClass);
            } else if (force === false) {
                document.documentElement.classList.remove(sanitizedClass);
                document.body.classList.remove(sanitizedClass);
            } else {
                document.documentElement.classList.toggle(sanitizedClass);
                document.body.classList.toggle(sanitizedClass);
            }
        },
        
        setSendButtonLoading(isLoading) {
            if (window.Framework?.setSendButtonLoading) {
                window.Framework.setSendButtonLoading(isLoading);
            }
        },
        
        async addLoadingIndicator() {
            if (window.Framework?.addLoadingIndicator) {
                return window.Framework.addLoadingIndicator();
            }
            return null;
        },
        
        async attachLoadingIndicatorToMessage(loadingId, messageId) {
            if (window.Framework?.attachLoadingIndicatorToMessage) {
                return window.Framework.attachLoadingIndicatorToMessage(loadingId, messageId);
            }
            return false;
        },
        
        // ============================================================
        // Storage API
        // ============================================================
        
        async storageGetItem(key, defaultValue) {
            if (window.Framework?.storage?.getItem) {
                return window.Framework.storage.getItem(key, defaultValue);
            }
            const raw = localStorage.getItem(key);
            if (raw == null) return defaultValue;
            try {
                return JSON.parse(raw);
            } catch (e) {
                return raw;
            }
        },
        
        async storageSetItem(key, value) {
            if (window.Framework?.storage?.setItem) {
                window.Framework.storage.setItem(key, value);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
        },
        
        async storageRemoveItem(key) {
            if (window.Framework?.storage?.removeItem) {
                window.Framework.storage.removeItem(key);
            } else {
                localStorage.removeItem(key);
            }
        },
        
        // ============================================================
        // Store API
        // ============================================================
        
        async getState() {
            const store = window.IdoFront?.store;
            if (!store) return null;
            
            return {
                conversations: store.state.conversations,
                activeConversationId: store.state.activeConversationId,
                channels: store.state.channels,
                personas: store.state.personas,
                activePersonaId: store.state.activePersonaId
            };
        },
        
        async getActiveConversation() {
            const store = window.IdoFront?.store;
            if (store?.getActiveConversation) {
                return store.getActiveConversation();
            }
            return null;
        },
        
        async getConversation(conversationId) {
            const store = window.IdoFront?.store;
            if (store?.state?.conversations) {
                return store.state.conversations.find(c => c.id === conversationId) || null;
            }
            return null;
        },
        
        async updateConversationMetadata(conversationId, metadata) {
            const store = window.IdoFront?.store;
            if (!store?.state?.conversations) {
                throw new Error('Store not available');
            }
            
            const conv = store.state.conversations.find(c => c.id === conversationId);
            if (!conv) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            
            conv.metadata = { ...(conv.metadata || {}), ...metadata };
        },
        
        async persistStore() {
            const store = window.IdoFront?.store;
            if (store?.persist) {
                store.persist();
            }
        },
        
        // ============================================================
        // Store Events API
        // ============================================================
        
        subscribeStoreEvent(eventName) {
            if (!storeEventSubscriptions.has(eventName)) {
                storeEventSubscriptions.set(eventName, new Set());
                
                // 订阅 Store 事件
                const store = window.IdoFront?.store;
                if (store?.events?.on) {
                    store.events.on(eventName, (eventData) => {
                        dispatchEventToSandbox(eventName, eventData);
                    });
                }
            }
        },
        
        unsubscribeStoreEvent(eventName) {
            storeEventSubscriptions.delete(eventName);
        },
        
        // ============================================================
        // Channel Registry API
        // ============================================================
        
        registerChannel(channelId, definition, pluginId) {
            const registry = window.IdoFront?.channelRegistry;
            const loader = window.IdoFront?.pluginLoader;
            
            if (!registry) {
                console.warn('[ComlinkBridge] Channel registry not available');
                return;
            }
            
            // 创建代理 adapter，调用沙箱中的实际 adapter
            const proxyAdapter = {
                call: async (messages, config, onUpdate, signal) => {
                    return await window.IdoFront.comlinkBridge.callSandboxChannelAdapter(
                        pluginId,
                        'call',
                        [messages, config],
                        onUpdate,
                        signal
                    );
                },
                fetchModels: async (config) => {
                    return await window.IdoFront.comlinkBridge.callSandboxChannelAdapter(
                        pluginId,
                        'fetchModels',
                        [config]
                    );
                }
            };
            
            try {
                registry.registerType(channelId, {
                    ...definition,
                    adapter: proxyAdapter
                });
                
                // 追踪资源
                if (loader && typeof loader.trackChannelType === 'function') {
                    loader.trackChannelType(pluginId, channelId);
                }
                
                console.info(`[ComlinkBridge] Channel registered: ${channelId} for plugin ${pluginId}`);
            } catch (e) {
                console.error(`[ComlinkBridge] Failed to register channel ${channelId}`, e);
            }
        },
        
        unregisterChannel(channelId) {
            const registry = window.IdoFront?.channelRegistry;
            if (registry) {
                try {
                    registry.unregisterType(channelId);
                } catch (e) {
                    console.warn(`[ComlinkBridge] Failed to unregister channel ${channelId}`, e);
                }
            }
        },
        
        // ============================================================
        // Network Logging API
        // ============================================================
        
        logNetworkRequest(logId, timestamp, request) {
            const store = window.IdoFront?.store;
            if (!store) return;
            
            const logEntry = {
                id: logId,
                timestamp,
                request,
                response: null,
                error: null,
                duration: null,
                status: 'pending'
            };

            if (!store.state.networkLogs) store.state.networkLogs = [];
            store.state.networkLogs.unshift(logEntry);
            if (store.state.networkLogs.length > 100) {
                store.state.networkLogs = store.state.networkLogs.slice(0, 100);
            }

            store.events?.emit?.('network-log:created', { logId, logEntry });
        },
        
        logNetworkResponse(logId, response, duration) {
            const store = window.IdoFront?.store;
            const logEntry = store?.state?.networkLogs?.find(log => log.id === logId);
            if (!logEntry) return;

            logEntry.response = response;
            logEntry.duration = duration;
            logEntry.status = 'success';

            store.events?.emit?.('network-log:response', { logId, logEntry });
        },
        
        logNetworkStreamStart(logId, response) {
            const store = window.IdoFront?.store;
            const logEntry = store?.state?.networkLogs?.find(log => log.id === logId);
            if (!logEntry) return;

            logEntry.response = { ...response, body: null, rawBody: '', streamChunks: [] };
            logEntry.status = 'streaming';

            store.events?.emit?.('network-log:response', { logId, logEntry });
        },
        
        logNetworkStreamChunk(logId, chunk, timestamp) {
            const store = window.IdoFront?.store;
            const logEntry = store?.state?.networkLogs?.find(log => log.id === logId);
            if (!logEntry?.response) return;

            logEntry.response.streamChunks.push({ timestamp, data: chunk });
            logEntry.response.rawBody += chunk;

            store.events?.emit?.('network-log:stream-chunk', { logId, chunk });
        },
        
        logNetworkStreamComplete(logId, duration) {
            const store = window.IdoFront?.store;
            const logEntry = store?.state?.networkLogs?.find(log => log.id === logId);
            if (!logEntry) return;

            logEntry.status = 'success';
            logEntry.duration = duration;

            store.events?.emit?.('network-log:stream-complete', { logId, logEntry });
        },
        
        logNetworkError(logId, error, duration) {
            const store = window.IdoFront?.store;
            const logEntry = store?.state?.networkLogs?.find(log => log.id === logId);
            if (!logEntry) return;

            logEntry.error = error;
            logEntry.status = 'error';
            logEntry.duration = duration;

            store.events?.emit?.('network-log:error', { logId, error, logEntry });
        }
    };
    
    /**
     * 分发事件到沙箱
     */
    function dispatchEventToSandbox(eventName, eventData) {
        const bridge = window.IdoFront.comlinkBridge;
        if (!bridge || !bridge._sandboxProxy) return;
        
        const store = window.IdoFront?.store;
        let enhancedEventData = eventData;
        
        // 增强 'updated' 事件的数据
        if (eventName === 'updated' && store) {
            try {
                const activeConv = store.getActiveConversation?.();
                const activeChannel = activeConv && store.state.channels
                    ? store.state.channels.find(c => c?.id === activeConv.selectedChannelId)
                    : null;
                
                enhancedEventData = {
                    ...(eventData && typeof eventData === 'object' ? eventData : {}),
                    __context: {
                        activeConversationId: activeConv?.id || null,
                        activeChannelId: activeConv?.selectedChannelId || null,
                        activeChannelType: activeChannel?.type || null,
                        activeConversationMetadata: activeConv?.metadata || null
                    }
                };
            } catch (e) {
                enhancedEventData = eventData;
            }
        }
        
        // 通过 Comlink 调用沙箱的 dispatchStoreEvent
        try {
            bridge._sandboxProxy.dispatchStoreEvent(eventName, enhancedEventData);
        } catch (e) {
            console.warn('[ComlinkBridge] Failed to dispatch event to sandbox:', e);
        }
    }

    /**
     * Comlink 桥接管理器
     */
    class ComlinkBridgeManager {
        constructor() {
            this._sandboxFrame = null;
            this._sandboxProxy = null;
            this._initialized = false;
        }
        
        /**
         * 初始化桥接
         * @param {HTMLIFrameElement} sandboxFrame 沙箱 iframe
         */
        async init(sandboxFrame) {
            if (this._initialized) return;
            
            this._sandboxFrame = sandboxFrame;
            
            if (typeof Comlink === 'undefined') {
                console.error('[ComlinkBridge] Comlink not available!');
                return;
            }
            
            try {
                // 使用 Comlink 的 windowEndpoint
                const endpoint = Comlink.windowEndpoint(
                    sandboxFrame.contentWindow,
                    self
                );
                
                // 暴露主线程 API 给沙箱
                Comlink.expose(MainThreadAPI, endpoint);
                
                // 包装沙箱 API
                this._sandboxProxy = Comlink.wrap(endpoint);
                
                this._initialized = true;
                console.log('[ComlinkBridge] Initialized');
            } catch (e) {
                console.error('[ComlinkBridge] Init failed:', e);
            }
        }
        
        /**
         * 调用沙箱中的 Channel adapter
         * @param {string} pluginId 插件 ID
         * @param {string} method 方法名 (call | fetchModels)
         * @param {Array} args 参数
         * @param {Function} onUpdate 流式更新回调
         * @param {AbortSignal} signal 中止信号
         */
        async callSandboxChannelAdapter(pluginId, method, args, onUpdate, signal) {
            if (!this._sandboxProxy) {
                throw new Error('Sandbox not initialized');
            }
            
            // 创建回调代理
            let updateCallback = null;
            
            if (onUpdate && typeof onUpdate === 'function') {
                updateCallback = Comlink.proxy(onUpdate);
            }
            
            // 处理 AbortSignal
            if (signal?.aborted) {
                const error = new Error('Request aborted');
                error.name = 'AbortError';
                throw error;
            }
            
            try {
                const result = await this._sandboxProxy.callChannelAdapter(
                    pluginId,
                    method,
                    args,
                    updateCallback
                );
                return result;
            } finally {
                // 清理回调代理
                if (updateCallback && updateCallback[Comlink.releaseProxy]) {
                    updateCallback[Comlink.releaseProxy]();
                }
            }
        }
        
        /**
         * 执行插件代码
         * @param {string} pluginId 插件 ID
         * @param {string} code 代码
         * @param {Object} meta 元数据
         */
        async executePlugin(pluginId, code, meta = null) {
            if (!this._sandboxProxy) {
                throw new Error('Sandbox not initialized');
            }
            return await this._sandboxProxy.executePlugin(pluginId, code, meta);
        }
        
        /**
         * 停止插件
         * @param {string} pluginId 插件 ID
         */
        async stopPlugin(pluginId) {
            if (!this._sandboxProxy) {
                console.warn('[ComlinkBridge] Sandbox not initialized, cannot stop plugin');
                return { success: false };
            }
            return await this._sandboxProxy.stopPlugin(pluginId);
        }
        
        /**
         * 获取沙箱中的插件列表
         */
        async getPluginIds() {
            if (!this._sandboxProxy) return [];
            return await this._sandboxProxy.getPluginIds();
        }
        
        /**
         * 检查插件是否有 adapter
         */
        async hasAdapter(pluginId) {
            if (!this._sandboxProxy) return false;
            return await this._sandboxProxy.hasAdapter(pluginId);
        }
        
        /**
         * 获取沙箱代理
         */
        getSandboxProxy() {
            return this._sandboxProxy;
        }
        
        /**
         * 检查是否已初始化
         */
        isInitialized() {
            return this._initialized;
        }
    }

    // 创建全局实例
    window.IdoFront.comlinkBridge = new ComlinkBridgeManager();
    window.IdoFront.MainThreadAPI = MainThreadAPI;

    console.log('[ComlinkBridge] Module loaded');
})();