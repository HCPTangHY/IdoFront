/**
 * Network Logger
 * 通过拦截 fetch 记录所有网络请求和响应
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    // 保存原始的 fetch 函数
    const originalFetch = window.fetch;
    let isInterceptorInstalled = false;

    /**
     * 网络日志数据结构
     * @typedef {Object} NetworkLog
     * @property {string} id - 日志唯一ID
     * @property {number} timestamp - 时间戳
     * @property {Object} request - 请求信息
     * @property {string} request.url - 请求URL
     * @property {string} request.method - 请求方法
     * @property {Object} request.headers - 请求头
     * @property {Object|string} request.body - 请求体
     * @property {string} request.rawBody - 原始请求体字符串
     * @property {Object|null} response - 响应信息
     * @property {number} response.status - 响应状态码
     * @property {string} response.statusText - 响应状态文本
     * @property {Object} response.headers - 响应头
     * @property {Object|string} response.body - 响应体
     * @property {string} response.rawBody - 原始响应体
     * @property {boolean} response.isStream - 是否为流式响应
     * @property {Array} response.streamChunks - 流式响应的数据块
     * @property {Error|null} error - 错误信息
     * @property {number|null} duration - 请求耗时（毫秒）
     * @property {string} status - 状态：pending, success, error, streaming
     */

    window.IdoFront.networkLogger = {
        
        /**
         * 安装 fetch 拦截器
         */
        installInterceptor() {
            if (isInterceptorInstalled) {
                console.warn('Network logger interceptor already installed');
                return;
            }

            window.fetch = async function(...args) {
                const [resource, config] = args;
                const url = typeof resource === 'string' ? resource : resource.url;
                const method = config?.method || 'GET';
                
                // 创建日志条目
                const logId = createLogEntry(url, method, config);
                
                try {
                    // 调用原始 fetch
                    const response = await originalFetch(...args);
                    
                    // 克隆响应以便读取
                    const clonedResponse = response.clone();
                    
                    // 检查是否为流式响应
                    const contentType = response.headers.get('content-type') || '';
                    const isStream = contentType.includes('text/event-stream') ||
                                   contentType.includes('application/x-ndjson');
                    
                    if (isStream) {
                        // 处理流式响应
                        handleStreamResponse(logId, response, clonedResponse);
                    } else {
                        // 处理普通响应
                        handleNormalResponse(logId, clonedResponse);
                    }
                    
                    return response;
                } catch (error) {
                    // 记录错误
                    logError(logId, error);
                    throw error;
                }
            };

            isInterceptorInstalled = true;
            console.log('Network logger interceptor installed');
        },

        /**
         * 卸载 fetch 拦截器
         */
        uninstallInterceptor() {
            if (!isInterceptorInstalled) {
                return;
            }
            window.fetch = originalFetch;
            isInterceptorInstalled = false;
            console.log('Network logger interceptor uninstalled');
        },

        /**
         * 清空所有网络日志
         */
        clearLogs() {
            const store = window.IdoFront.store;
            store.state.networkLogs = [];
            // 触发事件
            if (store.events) {
                if (typeof store.events.emitAsync === 'function') {
                    store.events.emitAsync('network-log:cleared');
                } else {
                    store.events.emit('network-log:cleared');
                }
            }
        },

        /**
         * 获取所有网络日志
         * @returns {Array} 网络日志数组
         */
        getLogs() {
            const store = window.IdoFront.store;
            return store.state.networkLogs || [];
        },

        /**
         * 根据ID获取日志
         * @param {string} logId - 日志ID
         * @returns {Object|null} 日志条目
         */
        getLog(logId) {
            const store = window.IdoFront.store;
            return store.state.networkLogs?.find(log => log.id === logId) || null;
        }
    };

    /**
     * 创建日志条目
     */
    function createLogEntry(url, method, config) {
        const logId = window.IdoFront.utils.createId('netlog');
        const timestamp = Date.now();
        
        // 提取请求头
        const headers = {};
        if (config?.headers) {
            if (config.headers instanceof Headers) {
                config.headers.forEach((value, key) => {
                    headers[key] = value;
                });
            } else {
                Object.assign(headers, config.headers);
            }
        }
        
        // 提取请求体
        let body = null;
        let rawBody = '';
        if (config?.body) {
            rawBody = config.body;
            try {
                body = JSON.parse(config.body);
            } catch (e) {
                body = config.body;
            }
        }
        
        const logEntry = {
            id: logId,
            timestamp: timestamp,
            request: {
                url: url,
                method: method,
                headers: headers,
                body: body,
                rawBody: rawBody
            },
            response: null,
            error: null,
            duration: null,
            status: 'pending'
        };

        // 保存到 store
        const store = window.IdoFront.store;
        if (!store.state.networkLogs) {
            store.state.networkLogs = [];
        }
        store.state.networkLogs.unshift(logEntry);
        
        // 限制日志数量（保留最近100条）
        if (store.state.networkLogs.length > 100) {
            store.state.networkLogs = store.state.networkLogs.slice(0, 100);
        }

        // 触发事件
        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:created', { logId, logEntry });
            } else {
                store.events.emit('network-log:created', { logId, logEntry });
            }
        }

        return logId;
    }

    /**
     * 处理普通响应
     */
    async function handleNormalResponse(logId, response) {
        const store = window.IdoFront.store;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;

        try {
            // 提取响应头
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            // 读取响应体
            const rawBody = await response.text();
            let body = rawBody;
            try {
                body = JSON.parse(rawBody);
            } catch (e) {
                // 保持原始文本
            }

            logEntry.response = {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                body: body,
                rawBody: rawBody,
                isStream: false
            };
            
            logEntry.duration = Date.now() - logEntry.timestamp;
            logEntry.status = 'success';

            // 触发事件
            if (store.events) {
                if (typeof store.events.emitAsync === 'function') {
                    store.events.emitAsync('network-log:response', { logId, logEntry });
                } else {
                    store.events.emit('network-log:response', { logId, logEntry });
                }
            }
        } catch (error) {
            console.error('Error handling response:', error);
            logError(logId, error);
        }
    }

    /**
     * 处理流式响应
     */
    async function handleStreamResponse(logId, originalResponse, clonedResponse) {
        const store = window.IdoFront.store;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;

        // 提取响应头
        const responseHeaders = {};
        clonedResponse.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        logEntry.response = {
            status: clonedResponse.status,
            statusText: clonedResponse.statusText,
            headers: responseHeaders,
            body: null,
            rawBody: '',
            isStream: true,
            streamChunks: []
        };
        
        logEntry.status = 'streaming';

        // 触发事件
        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:response', { logId, logEntry });
            } else {
                store.events.emit('network-log:response', { logId, logEntry });
            }
        }

        // 读取流
        try {
            const reader = clonedResponse.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    // 流结束
                    logEntry.status = 'success';
                    logEntry.duration = Date.now() - logEntry.timestamp;

                    if (store.events) {
                        if (typeof store.events.emitAsync === 'function') {
                            store.events.emitAsync('network-log:stream-complete', { logId, logEntry });
                        } else {
                            store.events.emit('network-log:stream-complete', { logId, logEntry });
                        }
                    }
                    break;
                }
                
                // 记录数据块
                const chunk = decoder.decode(value, { stream: true });
                logEntry.response.streamChunks.push({
                    timestamp: Date.now(),
                    data: chunk
                });
                logEntry.response.rawBody += chunk;
                

                if (store.events) {
                    if (typeof store.events.emitAsync === 'function') {
                        store.events.emitAsync('network-log:stream-chunk', { logId, chunk });
                    } else {
                        store.events.emit('network-log:stream-chunk', { logId, chunk });
                    }
                }
            }
        } catch (error) {
            console.error('Error reading stream:', error);
            logError(logId, error);
        }
    }

    /**
     * 记录错误
     */
    function logError(logId, error) {
        const store = window.IdoFront.store;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;

        logEntry.error = {
            message: error.message,
            stack: error.stack,
            name: error.name
        };
        logEntry.status = 'error';
        logEntry.duration = Date.now() - logEntry.timestamp;

        // 触发事件
        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:error', { logId, error, logEntry });
            } else {
                store.events.emit('network-log:error', { logId, error, logEntry });
            }
        }
    }

})();