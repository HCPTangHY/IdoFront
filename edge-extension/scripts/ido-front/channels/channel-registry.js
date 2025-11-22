/**
 * IdoFront Channel Registry
 * 维护渠道适配器的注册、查询与回收，向下兼容 legacy window.IdoFront.channels。
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    const legacyChannels = window.IdoFront.channels = window.IdoFront.channels || {};

    const registry = new Map();
    const events = createEventBus();

    function createEventBus() {
        const listeners = {};
        return {
            on(event, handler) {
                if (!event || typeof handler !== 'function') return;
                if (!listeners[event]) listeners[event] = new Set();
                listeners[event].add(handler);
            },
            off(event, handler) {
                const bucket = listeners[event];
                if (!bucket) return;
                bucket.delete(handler);
                if (bucket.size === 0) delete listeners[event];
            },
            emit(event, payload) {
                const bucket = listeners[event];
                if (!bucket) return;
                bucket.forEach(handler => {
                    try {
                        handler(payload);
                    } catch (error) {
                        console.error('[ChannelRegistry] 事件回调异常', event, error);
                    }
                });
            }
        };
    }

    function normalizeDefinition(type, definition, source) {
        if (!definition || typeof definition !== 'object') {
            throw new Error('[ChannelRegistry] definition 必须是对象');
        }
        const adapter = definition.adapter;
        if (!adapter || typeof adapter.call !== 'function') {
            throw new Error(`[ChannelRegistry] 渠道 ${type} 必须提供 adapter.call`);
        }

        const defaults = {
            baseUrl: definition.defaults?.baseUrl || '',
            model: definition.defaults?.model || '',
            params: definition.defaults?.params || null,
            headers: definition.defaults?.headers || null
        };

        const capabilities = {
            streaming: definition.capabilities?.streaming !== false,
            vision: !!definition.capabilities?.vision,
            fetchModels: typeof adapter.fetchModels === 'function'
        };

        return Object.freeze({
            id: type,
            label: definition.label || type,
            description: definition.description || '',
            icon: definition.icon || null,
            defaults,
            capabilities,
            adapter,
            metadata: definition.metadata || {},
            source,
            version: definition.version || '1.0.0',
            createdAt: Date.now()
        });
    }

    function registerType(type, definition, options = {}) {
        if (!type || typeof type !== 'string') {
            throw new Error('[ChannelRegistry] type 必须是字符串');
        }
        const typeId = type.trim();
        if (!typeId) {
            throw new Error('[ChannelRegistry] type 不能为空');
        }

        const source = options.source || definition?.source || 'external';
        const normalized = normalizeDefinition(typeId, definition, source);
        const existing = registry.get(typeId);
        if (existing && existing.source !== normalized.source) {
            throw new Error(`[ChannelRegistry] 渠道类型 ${typeId} 已由 ${existing.source} 注册`);
        }

        registry.set(typeId, normalized);
        legacyChannels[typeId] = normalized.adapter; // 兼容旧逻辑
        events.emit('channel-type:registered', normalized);
        return normalized;
    }

    function unregisterType(type, options = {}) {
        if (!type || typeof type !== 'string') return false;
        const typeId = type.trim();
        if (!registry.has(typeId)) return false;

        const entry = registry.get(typeId);
        const expectSource = options.source;
        if (expectSource && entry.source && entry.source !== expectSource) {
            throw new Error(`[ChannelRegistry] 不允许 ${expectSource} 卸载 ${entry.source} 的渠道 ${typeId}`);
        }

        registry.delete(typeId);
        delete legacyChannels[typeId];
        events.emit('channel-type:unregistered', entry);
        return true;
    }

    function unregisterBySource(source) {
        if (!source) return;
        Array.from(registry.entries()).forEach(([typeId, entry]) => {
            if (entry.source === source) {
                unregisterType(typeId);
            }
        });
    }

    function getType(type) {
        if (!type) return null;
        return registry.get(type) || null;
    }

    function listTypes() {
        return Array.from(registry.values());
    }

    function hasType(type) {
        return registry.has(type);
    }

    const api = window.IdoFront.channelRegistry || {};
    api.registerType = registerType;
    api.unregisterType = unregisterType;
    api.unregisterBySource = unregisterBySource;
    api.getType = getType;
    api.listTypes = listTypes;
    api.hasType = hasType;
    api.events = events;
    Object.defineProperty(api, 'size', {
        get() {
            return registry.size;
        }
    });

    Object.defineProperty(api, '__dangerouslyGetRegistry', {
        value: () => registry,
        enumerable: false
    });

    window.IdoFront.channelRegistry = api;
})();
