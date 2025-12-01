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

    service.callAI = async function(messages = [], channel, onUpdate) {
        const originalChannel = ensureChannel(channel);
        const { adapter, entry } = resolveAdapter(originalChannel, 'call');
        const effectiveChannel = applyDefaults(originalChannel, entry);

        // 统一异步化 onUpdate（macrotask），覆盖所有渠道而不改变适配器实现
        // 不丢数据、不合并事件，仅把回调放到下一个任务队列，避免同步阻塞渲染
        const safeOnUpdate = (typeof onUpdate === 'function')
            ? (payload) => {
                setTimeout(() => {
                    try {
                        onUpdate(payload);
                    } catch (e) {
                        console.error('[Service] onUpdate error:', e);
                    }
                }, 0);
            }
            : null;

        return adapter.call(messages, effectiveChannel, safeOnUpdate);
    };

    service.fetchModels = async function(channel) {
        const originalChannel = ensureChannel(channel);
        const { adapter, entry } = resolveAdapter(originalChannel, 'fetchModels');
        const effectiveChannel = applyDefaults(originalChannel, entry);
        return adapter.fetchModels(effectiveChannel);
    };

})();