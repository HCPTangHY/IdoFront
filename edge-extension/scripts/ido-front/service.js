/**
 * IdoFront Service
 * 统一封装渠道调用，支持 channelRegistry 动态扩展。
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const registry = window.IdoFront.channelRegistry;
    const legacyChannels = window.IdoFront.channels || {};

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

    // 存储当前活跃的请求控制器
    let currentAbortController = null;

    service.callAI = async function(messages = [], channel, onUpdate) {
        const originalChannel = ensureChannel(channel);
        const { adapter, entry } = resolveAdapter(originalChannel, 'call');
        const effectiveChannel = applyDefaults(originalChannel, entry);

        // 创建新的 AbortController
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

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
            // 等待所有 onUpdate 回调执行完毕，确保 UI 状态与返回结果同步
            if (pendingUpdates.length > 0) {
                await Promise.all(pendingUpdates);
            }
            // 清理当前控制器引用
            if (currentAbortController && currentAbortController.signal === signal) {
                currentAbortController = null;
            }
        }
    };

    // 取消当前请求
    service.abortCurrentRequest = function() {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            return true;
        }
        return false;
    };

    // 检查是否有活跃的请求
    service.hasActiveRequest = function() {
        return currentAbortController !== null;
    };

    service.fetchModels = async function(channel) {
        const originalChannel = ensureChannel(channel);
        const { adapter, entry } = resolveAdapter(originalChannel, 'fetchModels');
        const effectiveChannel = applyDefaults(originalChannel, entry);
        return adapter.fetchModels(effectiveChannel);
    };

})();