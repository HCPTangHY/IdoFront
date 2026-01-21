/**
 * IdoFront Service
 * 统一封装渠道调用，支持 channelRegistry 动态扩展。
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const registry = window.IdoFront.channelRegistry;
    const legacyChannels = window.IdoFront.channels || {};

    // ========== 禁止请求头处理 ==========
    // Referer, Origin 等是浏览器的 forbidden headers，fetch API 无法直接设置
    // 需要通过扩展的 declarativeNetRequest API 在网络层修改
    
    const FORBIDDEN_HEADERS = [
        'referer', 'origin', 'host', 'user-agent', 'cookie',
        'connection', 'content-length', 'accept-encoding'
    ];

    /**
     * 检查渠道是否有需要特殊处理的禁止请求头
     * @param {Object} channel - 渠道配置
     * @returns {boolean}
     */
    function hasForbiddenHeaders(channel) {
        if (!channel.customHeaders || !Array.isArray(channel.customHeaders)) {
            return false;
        }
        return channel.customHeaders.some(h => 
            h.key && h.value && FORBIDDEN_HEADERS.includes(h.key.toLowerCase())
        );
    }

    /**
     * 设置渠道的禁止请求头规则（通过 background script）
     * @param {Object} channel - 渠道配置
     */
    async function setupForbiddenHeaderRules(channel) {
        if (!hasForbiddenHeaders(channel)) {
            return;
        }
        
        if (typeof chrome === 'undefined' || !chrome.runtime) {
            console.warn('[Service] chrome.runtime not available, cannot set forbidden headers');
            return;
        }
        
        try {
            await chrome.runtime.sendMessage({
                type: 'UPDATE_CHANNEL_HEADERS',
                channelId: channel.id || 'temp-channel',
                baseUrl: channel.baseUrl,
                customHeaders: channel.customHeaders
            });
        } catch (e) {
            console.warn('[Service] Failed to set forbidden headers via background:', e);
        }
    }

    function ensureChannel(channel) {
        if (!channel) {
            throw new Error('未指定渠道');
        }
        if (!channel.type || typeof channel.type !== 'string') {
            throw new Error('渠道缺少有效的 type 标识');
        }
        return channel;
    }

    function getRegistryEntry(type) {
        if (!registry || typeof registry.getType !== 'function') return null;
        return registry.getType(type) || null;
    }

    function formatAvailableTypes() {
        const fromRegistry = (registry && typeof registry.listTypes === 'function')
            ? registry.listTypes().map(entry => entry.id)
            : [];
        const fromLegacy = Object.keys(legacyChannels);
        const merged = Array.from(new Set([...fromRegistry, ...fromLegacy]));
        return merged.length ? merged.join(', ') : '无';
    }

    function resolveAdapter(channel, capability) {
        const entry = getRegistryEntry(channel.type);
        let adapter = entry?.adapter;

        if (!adapter) {
            adapter = legacyChannels[channel.type] || legacyChannels.openai || null;
            if (adapter && !entry) {
                console.warn(`[Service] 渠道 ${channel.type} 未在 registry 注册，使用 legacy Handler。`);
            }
        }

        if (!adapter) {
            throw new Error(`[Service] 未找到渠道 ${channel.type} 的适配器，可用类型: ${formatAvailableTypes()}`);
        }

        if (capability && typeof adapter[capability] !== 'function') {
            throw new Error(`[Service] 渠道 ${channel.type} 不支持 ${capability}`);
        }

        return { adapter, entry };
    }

    function applyDefaults(channel, entry) {
        if (!entry || !entry.defaults) return { ...channel };
        const merged = { ...channel };
        const defaults = entry.defaults;

        if (defaults.baseUrl && !merged.baseUrl) {
            merged.baseUrl = defaults.baseUrl;
        }
        if (defaults.model && !merged.model) {
            merged.model = defaults.model;
        }
        if (defaults.headers && Array.isArray(defaults.headers) && (!merged.customHeaders || merged.customHeaders.length === 0)) {
            merged.customHeaders = defaults.headers.slice();
        }
        if (defaults.params && typeof defaults.params === 'object') {
            merged.paramsOverride = Object.assign({}, defaults.params, merged.paramsOverride || {});
        }
        return merged;
    }

    const service = window.IdoFront.service = window.IdoFront.service || {};

    // 多请求控制器：支持并行请求与按 ID 取消
    const requestControllers = new Map(); // requestId -> AbortController
    let currentAbortController = null;
    let currentRequestId = null;

    function createRequestId() {
        return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    // options: { requestId?: string, setAsCurrent?: boolean }
    service.callAI = async function(messages = [], channel, onUpdate, options) {
        const originalChannel = ensureChannel(channel);
        const { adapter, entry } = resolveAdapter(originalChannel, 'call');
        const effectiveChannel = applyDefaults(originalChannel, entry);

        // 设置禁止请求头规则（如 Referer, Origin 等）
        // 这些头无法通过 fetch 设置，需要通过 declarativeNetRequest 在网络层修改
        await setupForbiddenHeaderRules(effectiveChannel);

        const opt = options && typeof options === 'object' ? options : {};
        const requestId = opt.requestId || createRequestId();
        const setAsCurrent = opt.setAsCurrent !== false;

        const controller = new AbortController();
        const signal = controller.signal;

        requestControllers.set(requestId, controller);
        if (setAsCurrent) {
            currentAbortController = controller;
            currentRequestId = requestId;
        }

        // 收集所有待执行的更新 Promise，确保在 return 前全部完成
        const pendingUpdates = [];
        
        // 统一异步化 onUpdate（microtask），覆盖所有渠道而不改变适配器实现
        // 使用 Promise.resolve() 替代 setTimeout，确保在 call() return 前执行完毕
        const safeOnUpdate = (typeof onUpdate === 'function')
            ? (payload) => {
                const updatePromise = Promise.resolve().then(() => {
                    try {
                        onUpdate(payload);
                    } catch (e) {
                        console.error('[Service] onUpdate error:', e);
                    }
                });
                pendingUpdates.push(updatePromise);
            }
            : null;

        try {
            // 传递 signal 给适配器
            const result = await adapter.call(messages, effectiveChannel, safeOnUpdate, signal);
            return result;
        } finally {
            if (pendingUpdates.length > 0) {
                await Promise.all(pendingUpdates);
            }

            requestControllers.delete(requestId);
            if (currentAbortController === controller) {
                currentAbortController = null;
                currentRequestId = null;
            }
        }
    };

    // 取消指定请求
    service.abortRequest = function(requestId) {
        if (!requestId) return false;
        const controller = requestControllers.get(requestId);
        if (!controller) return false;
        controller.abort();
        requestControllers.delete(requestId);
        if (currentAbortController === controller) {
            currentAbortController = null;
            currentRequestId = null;
        }
        return true;
    };

    // 取消当前请求（最近一次 setAsCurrent 的请求）
    service.abortCurrentRequest = function() {
        if (currentRequestId) {
            return service.abortRequest(currentRequestId);
        }
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            return true;
        }
        return false;
    };

    // 检查是否有活跃的请求
    service.hasActiveRequest = function(requestId) {
        if (requestId) {
            return requestControllers.has(requestId);
        }
        return requestControllers.size > 0;
    };

    service.fetchModels = async function(channel) {
        const originalChannel = ensureChannel(channel);
        const { adapter, entry } = resolveAdapter(originalChannel, 'fetchModels');
        const effectiveChannel = applyDefaults(originalChannel, entry);
        return adapter.fetchModels(effectiveChannel);
    };

})();