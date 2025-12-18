/**
 * Sandbox Loader - Comlink 版本
 * 使用 Comlink 进行主线程与沙箱之间的双向 RPC 通信
 *
 * 此沙箱负责：
 * 1. 执行插件的 JS 脚本部分
 * 2. 处理 Channel adapter 的 call/fetchModels 调用
 * 3. 提供 Plugin API（getSettings, getConversationMeta 等）
 */
(function() {
    'use strict';
    
    const plugins = new Map(); // id -> { adapter, meta, channelId }
    let currentExecutingPluginId = null;
    let networkLoggerInstalled = false;
    
    // 主线程 API 代理（通过 Comlink）
    let mainThreadAPI = null;
    
    // 渠道请求中断控制器
    const pendingChannelCalls = new Map(); // requestId -> { controller, pluginId }
    
    // Store 事件监听器
    const eventListeners = new Map(); // eventName -> Set<{ pluginId, callback, listenerId }>
    let eventListenerId = 0;

    // ============================================================
    // Comlink 初始化
    // ============================================================
    
    async function initComlink() {
        if (typeof Comlink === 'undefined') {
            console.error('[Sandbox] Comlink not available!');
            return false;
        }
        
        try {
            // 创建与主线程通信的端点
            const endpoint = Comlink.windowEndpoint(window.parent, window);
            
            // 暴露 SandboxAPI 给主线程调用
            Comlink.expose(SandboxAPI, endpoint);
            
            // 包装主线程 API
            mainThreadAPI = Comlink.wrap(endpoint);
            
            console.log('[Sandbox] Comlink initialized');
            return true;
        } catch (e) {
            console.error('[Sandbox] Comlink init failed:', e);
            return false;
        }
    }
    
    // ============================================================
    // SandboxAPI - 暴露给主线程调用
    // ============================================================
    
    const SandboxAPI = {
        /**
         * 执行插件代码
         */
        executePlugin(pluginId, code, meta = null) {
            return executePlugin(pluginId, code, meta);
        },
        
        /**
         * 停止并清理插件
         */
        stopPlugin(pluginId) {
            const plugin = plugins.get(pluginId);
            if (!plugin) {
                console.log(`[Sandbox] Plugin ${pluginId} not found, nothing to stop`);
                return { success: true };
            }
            
            // 清理 Channel adapter
            if (plugin.channelId) {
                console.log(`[Sandbox] Cleaning up channel ${plugin.channelId} for plugin ${pluginId}`);
            }
            
            // 清理事件监听器
            for (const [eventName, listeners] of eventListeners.entries()) {
                const toRemove = [];
                for (const info of listeners) {
                    if (info.pluginId === pluginId) {
                        toRemove.push(info);
                    }
                }
                toRemove.forEach(info => listeners.delete(info));
                if (listeners.size === 0) {
                    eventListeners.delete(eventName);
                }
            }
            
            // 中止该插件的所有待处理请求
            for (const [requestId, info] of pendingChannelCalls.entries()) {
                if (info.pluginId === pluginId) {
                    try { 
                        info.controller.abort(); 
                    } catch (e) { /* ignore */ }
                    pendingChannelCalls.delete(requestId);
                }
            }
            
            // 移除插件
            plugins.delete(pluginId);
            console.log(`[Sandbox] Plugin ${pluginId} stopped and cleaned up`);
            return { success: true };
        },
        
        /**
         * 调用 Channel adapter
         */
        async callChannelAdapter(pluginId, method, args, onUpdate = null) {
            const plugin = plugins.get(pluginId);
            
            if (!plugin || !plugin.adapter) {
                throw new Error(`Plugin adapter not found: ${pluginId}`);
            }
            
            if (method === 'call') {
                const [messages, config] = args;
                const abortController = new AbortController();
                const requestId = `${pluginId}-${Date.now()}`;
                
                pendingChannelCalls.set(requestId, {
                    controller: abortController,
                    pluginId
                });
                
                try {
                    const wrappedOnUpdate = onUpdate ? (data) => {
                        try { onUpdate(data); } catch (e) { console.error('[Sandbox] onUpdate error:', e); }
                    } : null;
                    
                    return await plugin.adapter.call(messages, config, wrappedOnUpdate, abortController.signal);
                } finally {
                    pendingChannelCalls.delete(requestId);
                }
            }
            
            if (method === 'fetchModels') {
                const [config] = args;
                if (typeof plugin.adapter.fetchModels === 'function') {
                    return await plugin.adapter.fetchModels(config);
                }
                return [];
            }
            
            throw new Error(`Unknown method: ${method}`);
        },
        
        /**
         * 获取所有插件 ID
         */
        getPluginIds() {
            return Array.from(plugins.keys());
        },
        
        /**
         * 检查插件是否有 adapter
         */
        hasAdapter(pluginId) {
            const plugin = plugins.get(pluginId);
            return !!(plugin && plugin.adapter);
        },
        
        /**
         * 分发 Store 事件到插件的回调
         */
        dispatchStoreEvent(eventName, eventData) {
            const listeners = eventListeners.get(eventName);
            if (!listeners) return;
            
            for (const info of listeners) {
                const prevPluginId = currentExecutingPluginId;
                if (info && info.pluginId) {
                    currentExecutingPluginId = info.pluginId;
                }
                
                try {
                    info.callback(eventData);
                } catch (error) {
                    console.error(`[Sandbox] Event handler error for ${eventName}:`, error);
                } finally {
                    currentExecutingPluginId = prevPluginId;
                }
            }
        }
    };

    // ============================================================
    // Plugin API - 用于混合格式插件
    // ============================================================
    
    function createPluginAPI(pluginId, meta = {}) {
        return {
            meta: Object.freeze({ ...meta }),
            
            async getSettings() {
                const key = `plugin:${pluginId}:settings`;
                const defaults = getDefaultSettings(meta.settings);
                return await mainThreadAPI.storageGetItem(key, defaults);
            },
            
            async saveSettings(settings) {
                const key = `plugin:${pluginId}:settings`;
                return await mainThreadAPI.storageSetItem(key, settings);
            },
            
            async getConversationMeta() {
                const conv = await mainThreadAPI.getActiveConversation();
                return conv && conv.metadata ? conv.metadata : {};
            },
            
            async setConversationMeta(key, value) {
                const conv = await mainThreadAPI.getActiveConversation();
                if (!conv) return;
                return await mainThreadAPI.updateConversationMetadata(conv.id, { [key]: value });
            },
            
            async clearConversationMeta(key) {
                const conv = await mainThreadAPI.getActiveConversation();
                if (!conv) return;
                return await mainThreadAPI.updateConversationMetadata(conv.id, { [key]: null });
            },
            
            // DOM Class API - 用于主题插件操作主页面的 body class
            addBodyClass(className) {
                mainThreadAPI.addBodyClass(className);
            },
            
            removeBodyClass(className) {
                mainThreadAPI.removeBodyClass(className);
            },
            
            toggleBodyClass(className, force) {
                mainThreadAPI.toggleBodyClass(className, force);
            },
            
            // 设置变更监听
            onSettingsChange(callback) {
                const eventName = `plugin-settings:${pluginId}:changed`;
                return IdoFront.store.events.on(eventName, callback);
            },
            
            registerChannel(adapter) {
                const channelConfig = meta.channel || {};
                const channelId = channelConfig.type || pluginId;
                
                const plugin = plugins.get(pluginId);
                if (plugin) {
                    plugin.adapter = adapter;
                    plugin.channelId = channelId;
                }
                
                // 通知主线程注册渠道
                mainThreadAPI.registerChannel(channelId, {
                    label: channelConfig.label || meta.name || pluginId,
                    version: meta.version || '1.0.0',
                    defaults: channelConfig.defaults || {},
                    capabilities: channelConfig.capabilities || { streaming: true, vision: false },
                    source: `plugin:${pluginId}`
                }, pluginId);
                
                console.log(`[Sandbox] Plugin ${pluginId} registered channel: ${channelId}`);
            }
        };
    }
    
    function getDefaultSettings(settingsConfig) {
        if (!settingsConfig || !settingsConfig.fields) return {};
        
        const defaults = {};
        Object.keys(settingsConfig.fields).forEach(key => {
            const field = settingsConfig.fields[key];
            if (field.default !== undefined) {
                defaults[key] = field.default;
            }
        });
        return defaults;
    }

    // ============================================================
    // Mock IdoFront API for Sandbox
    // ============================================================
    
    const IdoFront = {
        channelRegistry: {
            registerType(id, definition) {
                if (currentExecutingPluginId && definition.adapter) {
                    const plugin = plugins.get(currentExecutingPluginId);
                    if (plugin) {
                        plugin.adapter = definition.adapter;
                        plugin.channelId = id;
                    }
                }
                
                mainThreadAPI.registerChannel(id, {
                    label: definition.label,
                    source: definition.source,
                    version: definition.version,
                    defaults: definition.defaults,
                    capabilities: definition.capabilities
                }, currentExecutingPluginId);
            },
            
            unregisterType(id) {
                mainThreadAPI.unregisterChannel(id);
            }
        },
        
        store: {
            getState() {
                return mainThreadAPI.getState();
            },
            
            getActiveConversation() {
                return mainThreadAPI.getActiveConversation();
            },
            
            getConversation(conversationId) {
                return mainThreadAPI.getConversation(conversationId);
            },
            
            updateConversationMetadata(conversationId, metadata) {
                return mainThreadAPI.updateConversationMetadata(conversationId, metadata);
            },
            
            persist() {
                return mainThreadAPI.persistStore();
            },
            
            events: {
                on(eventName, callback) {
                    const pluginId = currentExecutingPluginId;
                    const listenerId = `listener-${++eventListenerId}`;
                    
                    if (!eventListeners.has(eventName)) {
                        eventListeners.set(eventName, new Set());
                        // 通知主线程订阅事件
                        mainThreadAPI.subscribeStoreEvent(eventName);
                    }
                    
                    eventListeners.get(eventName).add({ pluginId, callback, listenerId });
                    
                    return () => IdoFront.store.events.off(eventName, callback);
                },
                
                off(eventName, callback) {
                    const listeners = eventListeners.get(eventName);
                    if (!listeners) return;
                    
                    for (const info of listeners) {
                        if (info.callback === callback) {
                            listeners.delete(info);
                            break;
                        }
                    }
                    
                    if (listeners.size === 0) {
                        eventListeners.delete(eventName);
                        // 通知主线程取消订阅
                        mainThreadAPI.unsubscribeStoreEvent(eventName);
                    }
                }
            }
        },
        
        storage: {
            getItem(key) {
                return mainThreadAPI.storageGetItem(key, null);
            },
            
            setItem(key, value) {
                return mainThreadAPI.storageSetItem(key, value);
            },
            
            removeItem(key) {
                return mainThreadAPI.storageRemoveItem(key);
            }
        }
    };
    
    // ============================================================
    // Framework 代理
    // ============================================================
    
    const Framework = {
        addMessage(role, content, options) {
            mainThreadAPI.addMessage(role, content, options);
        },
        
        updateLastMessage(content) {
            mainThreadAPI.updateLastMessage(content);
        },
        
        finalizeStreamingMessage() {
            mainThreadAPI.finalizeStreamingMessage();
        },
        
        renderAllPendingMarkdown() {
            mainThreadAPI.renderAllPendingMarkdown();
        },
        
        addLoadingIndicator() {
            return mainThreadAPI.addLoadingIndicator();
        },
        
        removeLoadingIndicator(loadingId) {
            mainThreadAPI.removeLoadingIndicator(loadingId);
        },
        
        attachLoadingIndicatorToMessage(loadingId, messageId) {
            return mainThreadAPI.attachLoadingIndicatorToMessage(loadingId, messageId);
        },
        
        removeMessageStreamingIndicator(messageId) {
            mainThreadAPI.removeMessageStreamingIndicator(messageId);
        },
        
        setSendButtonLoading(isLoading) {
            mainThreadAPI.setSendButtonLoading(!!isLoading);
        },
        
        storage: {
            getItem(key, defaultValue) {
                return mainThreadAPI.storageGetItem(key, defaultValue);
            },
            setItem(key, value) {
                return mainThreadAPI.storageSetItem(key, value);
            }
        }
    };

    // ============================================================
    // 插件执行
    // ============================================================
    
    function executePlugin(id, code, meta = null) {
        try {
            if (!networkLoggerInstalled) {
                installNetworkLogger();
                networkLoggerInstalled = true;
            }
            
            plugins.set(id, { meta: meta || {} });
            currentExecutingPluginId = id;
            
            const pluginAPI = createPluginAPI(id, meta || {});
            
            const sandboxWindow = new Proxy(window, {
                get(target, prop) {
                    if (prop === 'IdoFront') return IdoFront;
                    if (prop === 'Framework') return Framework;
                    if (prop === 'Plugin') return pluginAPI;
                    return target[prop];
                }
            });
            
            const runner = new Function('window', 'IdoFront', 'Framework', 'Plugin', code);
            runner(sandboxWindow, IdoFront, Framework, pluginAPI);
            
            currentExecutingPluginId = null;
            
            console.log(`[Sandbox] Plugin ${id} executed successfully`);
            return { success: true };
        } catch (error) {
            console.error('[Sandbox] Plugin execution failed:', error);
            currentExecutingPluginId = null;
            
            return { 
                success: false, 
                error: { 
                    message: error.message, 
                    stack: error.stack 
                } 
            };
        }
    }

    // ============================================================
    // 网络日志拦截器
    // ============================================================
    
    function installNetworkLogger() {
        const originalFetch = window.fetch;
        
        window.fetch = async function(...args) {
            const [resource, config] = args;
            const url = typeof resource === 'string' ? resource : resource.url;
            const method = config?.method || 'GET';
            const startTime = Date.now();
            
            const requestInfo = {
                url, method,
                headers: {},
                body: null,
                rawBody: ''
            };
            
            if (config?.headers) {
                if (config.headers instanceof Headers) {
                    config.headers.forEach((value, key) => { requestInfo.headers[key] = value; });
                } else {
                    Object.assign(requestInfo.headers, config.headers);
                }
            }
            
            if (config?.body) {
                requestInfo.rawBody = config.body;
                try { requestInfo.body = JSON.parse(config.body); } catch (e) { requestInfo.body = config.body; }
            }
            
            const logId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            // 记录请求
            mainThreadAPI.logNetworkRequest(logId, startTime, requestInfo);
            
            try {
                const response = await originalFetch(...args);
                const clonedResponse = response.clone();
                
                const contentType = response.headers.get('content-type') || '';
                const isStream = contentType.includes('text/event-stream') || contentType.includes('application/x-ndjson');
                
                if (isStream) {
                    handleStreamResponse(logId, startTime, clonedResponse);
                } else {
                    handleNormalResponse(logId, startTime, clonedResponse);
                }
                
                return response;
            } catch (error) {
                mainThreadAPI.logNetworkError(logId, {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                }, Date.now() - startTime);
                throw error;
            }
        };
        
        async function handleNormalResponse(logId, startTime, response) {
            try {
                const responseHeaders = {};
                response.headers.forEach((value, key) => { responseHeaders[key] = value; });
                
                const rawBody = await response.text();
                let body = rawBody;
                try { body = JSON.parse(rawBody); } catch (e) { /* keep text */ }
                
                mainThreadAPI.logNetworkResponse(logId, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                    body,
                    rawBody,
                    isStream: false
                }, Date.now() - startTime);
            } catch (error) {
                console.error('[Sandbox] Error handling response:', error);
            }
        }
        
        async function handleStreamResponse(logId, startTime, clonedResponse) {
            try {
                const responseHeaders = {};
                clonedResponse.headers.forEach((value, key) => { responseHeaders[key] = value; });
                
                mainThreadAPI.logNetworkStreamStart(logId, {
                    status: clonedResponse.status,
                    statusText: clonedResponse.statusText,
                    headers: responseHeaders,
                    isStream: true
                });
                
                const reader = clonedResponse.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        mainThreadAPI.logNetworkStreamComplete(logId, Date.now() - startTime);
                        break;
                    }
                    
                    const chunk = decoder.decode(value, { stream: true });
                    mainThreadAPI.logNetworkStreamChunk(logId, chunk, Date.now());
                }
            } catch (error) {
                console.error('[Sandbox] Error reading stream:', error);
            }
        }
    }

    // ============================================================
    // 启动
    // ============================================================
    
    initComlink().then(success => {
        if (success) {
            console.log('[Sandbox] Ready');
        } else {
            console.error('[Sandbox] Failed to initialize');
        }
    });
})();