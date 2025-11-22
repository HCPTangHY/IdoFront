/**
 * Sandbox Loader
 * 在沙箱 iframe 中运行插件代码
 */
(function() {
    const plugins = new Map(); // id -> { instance, cleanup }
    let currentExecutingPluginId = null; // 跟踪当前正在执行的插件 ID
    let networkLoggerInstalled = false;

    // Mock IdoFront API for Sandbox
    const IdoFront = {
        channelRegistry: {
            registerType(id, definition) {
                // 序列化 definition 中的函数，以便传回主线程
                // 注意：这里只能传递配置数据，不能直接传递函数引用
                // 解决方案：主线程代理 adapter 调用
                
                // 使用当前正在执行的插件 ID
                if (currentExecutingPluginId && definition.adapter) {
                    const plugin = plugins.get(currentExecutingPluginId);
                    console.log('[Sandbox] registerType', { channelId: id, pluginId: currentExecutingPluginId, hasPlugin: !!plugin, source: definition.source });
                    if (plugin) {
                        plugin.adapter = definition.adapter;
                        plugin.channelId = id; // 保存渠道 ID 以便后续查找
                        console.log('[Sandbox] Adapter saved for plugin', currentExecutingPluginId);
                    } else {
                        console.warn('[Sandbox] Plugin container not found for', currentExecutingPluginId);
                    }
                } else {
                    console.warn('[Sandbox] Cannot save adapter:', { currentExecutingPluginId, hasAdapter: !!definition.adapter });
                }
                
                window.parent.postMessage({
                    type: 'PLUGIN_REGISTER_CHANNEL',
                    payload: {
                        id,
                        pluginId: currentExecutingPluginId, // 发送实际的插件 ID
                        definition: serializeDefinition(definition)
                    }
                }, '*');
            },
            unregisterType(id) {
                window.parent.postMessage({
                    type: 'PLUGIN_UNREGISTER_CHANNEL',
                    payload: { id }
                }, '*');
            }
        }
    };

    function serializeDefinition(def) {
        return {
            label: def.label,
            source: def.source,
            version: def.version,
            defaults: def.defaults,
            capabilities: def.capabilities,
            metadata: def.metadata
            // adapter 不传递，保留在沙箱中
        };
    }

    window.addEventListener('message', async (event) => {
        const { type, payload } = event.data;

        switch (type) {
            case 'EXECUTE_PLUGIN':
                executePlugin(payload.id, payload.code);
                break;
            case 'CHANNEL_CALL':
                handleChannelCall(payload);
                break;
            case 'CHANNEL_FETCH_MODELS':
                handleFetchModels(payload);
                break;
        }
    });

    function executePlugin(id, code) {
        try {
            // 确保网络日志拦截器已安装
            if (!networkLoggerInstalled) {
                installNetworkLogger();
                networkLoggerInstalled = true;
            }
            
            // 在沙箱中可以安全使用 new Function / eval
            // 注入模拟的 window.IdoFront
            const runner = new Function('window', 'IdoFront', code);
            
            // 创建插件实例容器
            plugins.set(id, {});
            
            // 设置当前执行的插件 ID
            currentExecutingPluginId = id;
            
            // 执行插件
            // 注意：我们需要拦截 window.IdoFront 的访问
            const sandboxWindow = new Proxy(window, {
                get(target, prop) {
                    if (prop === 'IdoFront') return IdoFront;
                    return target[prop];
                }
            });
            
            runner(sandboxWindow, IdoFront);
            
            // 清除当前执行的插件 ID
            currentExecutingPluginId = null;
            
            window.parent.postMessage({
                type: 'PLUGIN_EXECUTED',
                payload: { id, success: true }
            }, '*');
        } catch (error) {
            console.error('[Sandbox] Plugin execution failed:', error);
            window.parent.postMessage({
                type: 'PLUGIN_EXECUTED',
                payload: { 
                    id, 
                    success: false, 
                    error: { message: error.message, stack: error.stack } 
                }
            }, '*');
        }
    }

    async function handleChannelCall(payload) {
        const { requestId, pluginId, messages, config } = payload;
        const plugin = plugins.get(pluginId);
        
        console.log('[Sandbox] handleChannelCall', { pluginId, hasPlugin: !!plugin, hasAdapter: !!plugin?.adapter, allPlugins: Array.from(plugins.keys()) });
        
        if (!plugin || !plugin.adapter) {
            sendError(requestId, `Plugin adapter not found for ${pluginId}. Available plugins: ${Array.from(plugins.keys()).join(', ')}`);
            return;
        }

        try {
            const onUpdate = (data) => {
                window.parent.postMessage({
                    type: 'CHANNEL_STREAM_UPDATE',
                    payload: { requestId, data }
                }, '*');
            };

            const result = await plugin.adapter.call(messages, config, onUpdate);
            
            window.parent.postMessage({
                type: 'CHANNEL_CALL_RESULT',
                payload: { requestId, result }
            }, '*');
        } catch (error) {
            sendError(requestId, error.message);
        }
    }

    async function handleFetchModels(payload) {
        const { requestId, pluginId, config } = payload;
        const plugin = plugins.get(pluginId);

        if (!plugin || !plugin.adapter) {
            sendError(requestId, 'Plugin adapter not found');
            return;
        }

        try {
            const models = await plugin.adapter.fetchModels(config);
            window.parent.postMessage({
                type: 'CHANNEL_FETCH_MODELS_RESULT',
                payload: { requestId, models }
            }, '*');
        } catch (error) {
            sendError(requestId, error.message);
        }
    }

    function sendError(requestId, message) {
        window.parent.postMessage({
            type: 'CHANNEL_ERROR',
            payload: { requestId, error: message }
        }, '*');
    }

    /**
     * 安装网络日志拦截器
     * 拦截沙箱中的 fetch 请求并发送到主线程记录
     */
    function installNetworkLogger() {
        const originalFetch = window.fetch;
        
        window.fetch = async function(...args) {
            const [resource, config] = args;
            const url = typeof resource === 'string' ? resource : resource.url;
            const method = config?.method || 'GET';
            const startTime = Date.now();
            
            // 提取请求信息
            const requestInfo = {
                url: url,
                method: method,
                headers: {},
                body: null,
                rawBody: ''
            };
            
            if (config?.headers) {
                if (config.headers instanceof Headers) {
                    config.headers.forEach((value, key) => {
                        requestInfo.headers[key] = value;
                    });
                } else {
                    Object.assign(requestInfo.headers, config.headers);
                }
            }
            
            if (config?.body) {
                requestInfo.rawBody = config.body;
                try {
                    requestInfo.body = JSON.parse(config.body);
                } catch (e) {
                    requestInfo.body = config.body;
                }
            }
            
            // 发送请求开始日志
            const logId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            window.parent.postMessage({
                type: 'NETWORK_LOG_REQUEST',
                payload: {
                    logId,
                    timestamp: startTime,
                    request: requestInfo
                }
            }, '*');
            
            try {
                // 调用原始 fetch
                const response = await originalFetch(...args);
                
                // 克隆响应
                const clonedResponse = response.clone();
                
                // 检查是否为流式响应
                const contentType = response.headers.get('content-type') || '';
                const isStream = contentType.includes('text/event-stream') ||
                               contentType.includes('application/x-ndjson');
                
                if (isStream) {
                    // 处理流式响应
                    handleStreamResponse(logId, startTime, response, clonedResponse);
                } else {
                    // 处理普通响应
                    handleNormalResponse(logId, startTime, clonedResponse);
                }
                
                return response;
            } catch (error) {
                // 发送错误日志
                window.parent.postMessage({
                    type: 'NETWORK_LOG_ERROR',
                    payload: {
                        logId,
                        error: {
                            message: error.message,
                            stack: error.stack,
                            name: error.name
                        },
                        duration: Date.now() - startTime
                    }
                }, '*');
                throw error;
            }
        };
        
        async function handleNormalResponse(logId, startTime, response) {
            try {
                const responseHeaders = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });
                
                const rawBody = await response.text();
                let body = rawBody;
                try {
                    body = JSON.parse(rawBody);
                } catch (e) {
                    // 保持原始文本
                }
                
                window.parent.postMessage({
                    type: 'NETWORK_LOG_RESPONSE',
                    payload: {
                        logId,
                        response: {
                            status: response.status,
                            statusText: response.statusText,
                            headers: responseHeaders,
                            body: body,
                            rawBody: rawBody,
                            isStream: false
                        },
                        duration: Date.now() - startTime
                    }
                }, '*');
            } catch (error) {
                console.error('[Sandbox] Error handling response:', error);
            }
        }
        
        async function handleStreamResponse(logId, startTime, originalResponse, clonedResponse) {
            try {
                const responseHeaders = {};
                clonedResponse.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });
                
                // 发送流开始
                window.parent.postMessage({
                    type: 'NETWORK_LOG_STREAM_START',
                    payload: {
                        logId,
                        response: {
                            status: clonedResponse.status,
                            statusText: clonedResponse.statusText,
                            headers: responseHeaders,
                            isStream: true
                        }
                    }
                }, '*');
                
                // 读取流
                const reader = clonedResponse.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        // 流结束
                        window.parent.postMessage({
                            type: 'NETWORK_LOG_STREAM_COMPLETE',
                            payload: {
                                logId,
                                duration: Date.now() - startTime
                            }
                        }, '*');
                        break;
                    }
                    
                    // 发送数据块
                    const chunk = decoder.decode(value, { stream: true });
                    window.parent.postMessage({
                        type: 'NETWORK_LOG_STREAM_CHUNK',
                        payload: {
                            logId,
                            chunk: chunk,
                            timestamp: Date.now()
                        }
                    }, '*');
                }
            } catch (error) {
                console.error('[Sandbox] Error reading stream:', error);
            }
        }
    }
})();