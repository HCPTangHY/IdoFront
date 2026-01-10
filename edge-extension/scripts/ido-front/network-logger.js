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
                
                // ★ 过滤不需要记录的请求（避免记录图片等二进制资源导致卡顿）
                if (shouldSkipLogging(url)) {
                    return originalFetch(...args);
                }
                
                // 创建日志条目
                const logId = createLogEntry(url, method, config);
                
                try {
                    // 调用原始 fetch
                    const response = await originalFetch(...args);
                    
                    // ★ 检查响应类型，跳过二进制响应（图片、音频、视频等）
                    const contentType = response.headers.get('content-type') || '';
                    if (isBinaryContentType(contentType)) {
                        // 标记为二进制响应，不读取响应体
                        markAsBinaryResponse(logId, response, contentType);
                        return response;
                    }
                    
                    // 克隆响应以便读取
                    const clonedResponse = response.clone();
                    
                    // 检查是否为流式响应
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
     * 截断超长字符串的配置
     */
    const TRUNCATE_CONFIG = {
        // 字符串超过此长度将被截断
        maxLength: 1000,
        // 截断后保留的前缀长度
        keepPrefix: 200,
        // 截断后保留的后缀长度
        keepSuffix: 200
    };

    /**
     * 判断是否应该跳过日志记录
     * @param {string} url - 请求 URL
     * @returns {boolean}
     */
    function shouldSkipLogging(url) {
        if (!url) return false;
        
        // 跳过 blob: 和 data: URL
        if (url.startsWith('blob:') || url.startsWith('data:')) {
            return true;
        }
        
        // 跳过常见的静态资源
        const skipExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
        const urlLower = url.toLowerCase();
        for (const ext of skipExtensions) {
            if (urlLower.includes(ext)) {
                return true;
            }
        }
        
        // 跳过 Chrome 扩展内部资源
        if (url.startsWith('chrome-extension://') && !url.includes('/api/')) {
            return true;
        }
        
        return false;
    }

    /**
     * 判断是否为二进制内容类型
     * @param {string} contentType - Content-Type header
     * @returns {boolean}
     */
    function isBinaryContentType(contentType) {
        if (!contentType) return false;
        
        const binaryTypes = [
            'image/',
            'audio/',
            'video/',
            'application/octet-stream',
            'application/pdf',
            'application/zip',
            'font/'
        ];
        
        const ct = contentType.toLowerCase();
        return binaryTypes.some(type => ct.includes(type));
    }

    /**
     * 标记为二进制响应（不读取响应体）
     */
    function markAsBinaryResponse(logId, response, contentType) {
        const store = window.IdoFront.store;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;
        
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });
        
        logEntry.response = {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: `[二进制内容: ${contentType}]`,
            rawBody: '',
            isStream: false,
            isBinary: true
        };
        
        logEntry.duration = Date.now() - logEntry.timestamp;
        logEntry.status = 'success';
    }

    /**
     * 截断单个超长字符串
     * @param {string} str - 原始字符串
     * @returns {string} 截断后的字符串
     */
    function truncateLongString(str) {
        if (typeof str !== 'string' || str.length <= TRUNCATE_CONFIG.maxLength) {
            return str;
        }
        
        const { keepPrefix, keepSuffix } = TRUNCATE_CONFIG;
        const truncatedLength = str.length - keepPrefix - keepSuffix;
        
        return `${str.substring(0, keepPrefix)}...[已截断 ${truncatedLength} 字符]...${str.substring(str.length - keepSuffix)}`;
    }

    /**
     * 递归遍历对象，截断所有超长字符串
     * 这样可以保持 JSON 结构完整，同时避免超长数据（如 base64 图片）导致性能问题
     *
     * @param {any} obj - 要处理的对象
     * @returns {any} 处理后的对象（深拷贝）
     */
    function truncateLongStrings(obj) {
        // 处理字符串：超长则截断
        if (typeof obj === 'string') {
            return truncateLongString(obj);
        }
        
        // 处理数组：递归处理每个元素
        if (Array.isArray(obj)) {
            return obj.map(item => truncateLongStrings(item));
        }
        
        // 处理对象：递归处理每个属性
        if (obj && typeof obj === 'object') {
            const result = {};
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    result[key] = truncateLongStrings(obj[key]);
                }
            }
            return result;
        }
        
        // 其他类型（number, boolean, null, undefined 等）直接返回
        return obj;
    }

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
        
        // 提取请求体并截断超长字符串
        let body = null;
        let rawBody = '';
        if (config?.body) {
            // rawBody 也需要截断，避免存储过大数据
            rawBody = truncateLongString(config.body);
            try {
                const parsedBody = JSON.parse(config.body);
                // 递归截断对象中的所有超长字符串
                body = truncateLongStrings(parsedBody);
            } catch (e) {
                // 如果不是 JSON，直接使用截断后的字符串
                body = rawBody;
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

            // 读取响应体并截断超长字符串
            const originalRawBody = await response.text();
            // rawBody 也需要截断
            const rawBody = truncateLongString(originalRawBody);
            let body = rawBody;
            try {
                const parsedBody = JSON.parse(originalRawBody);
                // 递归截断对象中的所有超长字符串
                body = truncateLongStrings(parsedBody);
            } catch (e) {
                // 如果不是 JSON，直接使用截断后的字符串
                body = rawBody;
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
                
                // 记录数据块（截断超长字符串）
                const chunk = decoder.decode(value, { stream: true });
                const truncatedChunk = truncateLongString(chunk);
                logEntry.response.streamChunks.push({
                    timestamp: Date.now(),
                    data: truncatedChunk,
                    truncated: truncatedChunk !== chunk
                });
                logEntry.response.rawBody += truncatedChunk;
                

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