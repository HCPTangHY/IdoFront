
/**
 * External Plugin Loader
 * 外部插件加载器：负责管理和运行用户导入的第三方插件脚本
 * Refactored for Manifest V3: Uses Sandboxed Iframe
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.pluginLoader = window.IdoFront.pluginLoader || {};

    const channelRegistry = window.IdoFront.channelRegistry;
    const pluginResources = new Map(); // pluginId -> { cleanupFns: Set, channelTypes: Set }
    
    // Sandbox Communication
    let sandboxFrame = null;
    let sandboxWindow = null;
    const pendingRequests = new Map(); // requestId -> { resolve, reject, onUpdate }
    let requestCounter = 0;

    function ensureResourceBucket(pluginId) {
        if (!pluginId) return null;
        if (!pluginResources.has(pluginId)) {
            pluginResources.set(pluginId, {
                cleanupFns: new Set(),
                channelTypes: new Set()
            });
        }
        return pluginResources.get(pluginId);
    }

    function trackChannelType(pluginId, typeId) {
        const bucket = ensureResourceBucket(pluginId);
        if (!bucket) return;
        bucket.channelTypes.add(typeId);
    }

    function releasePluginResources(pluginId) {
        const bucket = pluginResources.get(pluginId);
        if (!bucket) return;

        // Notice: Cleanup functions defined in sandbox are not reachable here directly
        // We rely on sandbox to cleanup its own scope if needed, or send message to sandbox
        
        if (channelRegistry) {
            bucket.channelTypes.forEach(typeId => {
                try {
                    channelRegistry.unregisterType(typeId, { source: `plugin:${pluginId}` });
                } catch (error) {
                    console.warn(`[PluginLoader] unregister channel type failed ${typeId}`, error);
                }
            });
        }
        bucket.channelTypes.clear();

        if (bucket.cleanupFns.size === 0 && bucket.channelTypes.size === 0) {
            pluginResources.delete(pluginId);
        }
    }

    let context = null;
    let store = null;
    const loadedPlugins = new Map(); // id -> plugin meta
    const runtimeHandles = new Map(); // id -> cleanup hooks

    /**
     * 内建插件列表（与外部插件共享同一执行/管理通道）
     * - 与 IndexedDB 中的 external plugins 一起恢复并执行
     * - 通过 pluginSettings 暴露 enable/disable 控制
     * - source 固定为 'builtin'
     */
    const builtInPlugins = [
        {
            id: 'builtin-image-gallery',
            name: 'Image Gallery (Built-in)',
            code: `(function() {
    if (!window.Framework || !window.Framework.registerPlugin) {
        console.warn('[builtin-image-gallery] Framework API not available');
        return;
    }

    const { registerPlugin, SLOTS, ui, setMode, getCurrentMode } = window.Framework;
    const PLUGIN_SLOT = SLOTS.HEADER_ACTIONS;
    const PLUGIN_ID = 'builtin-image-gallery';
    const MODE_ID = 'image-gallery';

    function renderGallerySidebar(container) {
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'p-3 text-xs text-gray-600';
        wrapper.textContent = 'Image Gallery Sidebar (builtin plugin placeholder)';
        container.appendChild(wrapper);
    }

    function renderGalleryMain(container) {
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'flex-1 flex flex-col items-center justify-center text-gray-400 text-xs';
        wrapper.textContent = 'Image Gallery Main View (builtin plugin placeholder)';
        container.appendChild(wrapper);
    }

    registerPlugin(PLUGIN_SLOT, PLUGIN_ID, {
        render(frameworkApi) {
            const button = frameworkApi.ui.createIconButton({
                label: '生图',
                icon: 'image',
                title: '切换到生图视图（占位实现，后续替换为真实 gallery UI）',
                className: 'ido-btn ido-btn--ghost text-xs gap-1',
                iconClassName: 'material-symbols-outlined text-[16px]',
                onClick() {
                    const current = typeof frameworkApi.getCurrentMode === 'function'
                        ? frameworkApi.getCurrentMode()
                        : 'chat';
                    if (current === MODE_ID) {
                        frameworkApi.setMode('chat');
                    } else {
                        frameworkApi.setMode(MODE_ID, {
                            sidebar: renderGallerySidebar,
                            main: renderGalleryMain
                        });
                    }
                }
            });
            return button;
        }
    });
})();`,
            enabled: true,
            version: '0.1.0',
            description: 'Builtin image gallery main-view plugin (placeholder implementation).',
            author: 'IdoFront',
            homepage: '',
            icon: 'photo_library',
            source: 'builtin',
            createdAt: 'builtin',
            updatedAt: 'builtin'
        }
    ];

    /**
     * 初始化插件加载器
     */
    /**
     * 解析插件元数据 (类似 Userscript Header)
     * 支持整文件扫描 `// @key value`，不再强依赖 ==UserScript== 块，
     * 并对 key 做小写归一，兼容 @Name/@Desc 等写法。
     * @param {string} code
     * @returns {Object} metadata
     */
    window.IdoFront.pluginLoader.parseMetadata = function(code) {
        const meta = {
            name: '',
            version: '1.0.0',
            description: '',
            author: '',
            homepage: '',
            icon: ''
        };

        if (!code) return meta;

        // 全局扫描所有形如 "// @key value" 的行
        const lineRegex = /^\s*\/\/\s*@([\w-]+)\s+(.+)$/gm;
        let match;
        while ((match = lineRegex.exec(code)) !== null) {
            const rawKey = match[1].trim();
            const key = rawKey.toLowerCase();
            const value = match[2].trim();

            switch (key) {
                case 'name':
                    meta.name = value;
                    break;
                case 'version':
                    // 若未提供版本则保持默认值
                    if (value) meta.version = value;
                    break;
                case 'description':
                case 'desc':
                    meta.description = value;
                    break;
                case 'author':
                    meta.author = value;
                    break;
                case 'homepage':
                case 'home':
                case 'url':
                    meta.homepage = value;
                    break;
                case 'icon':
                    meta.icon = value;
                    break;
                default:
                    // 其他未识别字段忽略
                    break;
            }
        }

        return meta;
    };

    window.IdoFront.pluginLoader.init = async function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
    
        console.info('[PluginLoader] init');

        // Initialize Sandbox
        await initSandbox();
    
        await loadStoredPlugins();
    
        attachStoreListeners();
    
        console.info('[PluginLoader] ready');
    };

    function initSandbox() {
        return new Promise((resolve) => {
            const existing = document.getElementById('ido-plugin-sandbox');
            if (existing) {
                sandboxFrame = existing;
                sandboxWindow = existing.contentWindow;
                resolve();
                return;
            }

            const iframe = document.createElement('iframe');
            iframe.src = 'sandbox.html';
            iframe.style.display = 'none';
            iframe.id = 'ido-plugin-sandbox';
            document.body.appendChild(iframe);

            iframe.onload = () => {
                sandboxFrame = iframe;
                sandboxWindow = iframe.contentWindow;
                console.info('[PluginLoader] Sandbox initialized');
                setupSandboxListener();
                resolve();
            };
        });
    }

    function setupSandboxListener() {
        window.addEventListener('message', (event) => {
            // Security check: ensure message comes from our sandbox
            if (event.source !== sandboxWindow) return;

            const { type, payload } = event.data;
            
            switch (type) {
                case 'PLUGIN_REGISTER_CHANNEL':
                    handleRegisterChannel(payload);
                    break;
                case 'PLUGIN_UNREGISTER_CHANNEL':
                    handleUnregisterChannel(payload);
                    break;
                case 'CHANNEL_STREAM_UPDATE':
                    handleChannelStreamUpdate(payload);
                    break;
                case 'CHANNEL_CALL_RESULT':
                case 'CHANNEL_FETCH_MODELS_RESULT':
                    handleRequestResult(payload);
                    break;
                case 'CHANNEL_ERROR':
                    handleRequestError(payload);
                    break;
                case 'PLUGIN_EXECUTED':
                    console.info(`[PluginLoader] Plugin ${payload.id} execution status: ${payload.success}`);
                    if (!payload.success) {
                        console.error(payload.error);
                        window.IdoFront.pluginLoader.lastError = {
                            pluginId: payload.id,
                            message: payload.error.message,
                            stack: payload.error.stack
                        };
                    }
                    break;
                case 'NETWORK_LOG_REQUEST':
                    handleNetworkLogRequest(payload);
                    break;
                case 'NETWORK_LOG_RESPONSE':
                    handleNetworkLogResponse(payload);
                    break;
                case 'NETWORK_LOG_STREAM_START':
                    handleNetworkLogStreamStart(payload);
                    break;
                case 'NETWORK_LOG_STREAM_CHUNK':
                    handleNetworkLogStreamChunk(payload);
                    break;
                case 'NETWORK_LOG_STREAM_COMPLETE':
                    handleNetworkLogStreamComplete(payload);
                    break;
                case 'NETWORK_LOG_ERROR':
                    handleNetworkLogError(payload);
                    break;
            }
        });
    }

    function handleRegisterChannel(payload) {
        const { id, pluginId, definition } = payload;
        // Use the actual pluginId sent from sandbox
        const actualPluginId = pluginId || (definition.source ? definition.source.split(':')[1] : 'unknown');

        // Create a proxy adapter that communicates with the sandbox
        const proxyAdapter = {
            call: (messages, config, onUpdate) => {
                return sendSandboxRequest('CHANNEL_CALL', {
                    pluginId: actualPluginId,
                    messages,
                    config
                }, onUpdate);
            },
            fetchModels: (config) => {
                return sendSandboxRequest('CHANNEL_FETCH_MODELS', {
                    pluginId: actualPluginId,
                    config
                });
            }
        };

        const fullDefinition = {
            ...definition,
            adapter: proxyAdapter
        };

        try {
            channelRegistry.registerType(id, fullDefinition);
            trackChannelType(actualPluginId, id);
            console.info(`[PluginLoader] Proxy channel registered: ${id} for plugin ${actualPluginId}`);
        } catch (e) {
            console.error(`[PluginLoader] Failed to register proxy channel ${id}`, e);
        }
    }

    function handleUnregisterChannel(payload) {
        const { id } = payload;
        try {
            channelRegistry.unregisterType(id);
        } catch (e) {
            console.warn(`[PluginLoader] Failed to unregister proxy channel ${id}`, e);
        }
    }

    function sendSandboxRequest(type, data, onUpdate) {
        return new Promise((resolve, reject) => {
            const requestId = ++requestCounter;
            pendingRequests.set(requestId, { resolve, reject, onUpdate });

            try {
                sandboxWindow.postMessage({
                    type,
                    payload: {
                        requestId,
                        ...data
                    }
                }, '*');
            } catch (error) {
                // 如果 postMessage 失败，立即清理并抛出错误，避免挂起
                pendingRequests.delete(requestId);
                reject(error);
            }

            // 不再对沙箱 RPC 施加额外超时限制，让其行为尽可能接近原生渠道：
            // - 正常完成时由 CHANNEL_CALL_RESULT / CHANNEL_FETCH_MODELS_RESULT 解析并 resolve
            // - 异常时由 CHANNEL_ERROR 解析并 reject
            // 超时控制交由浏览器网络层或插件自身实现
        });
    }

    function handleChannelStreamUpdate(payload) {
        const { requestId, data } = payload;
        const req = pendingRequests.get(requestId);
        if (req && req.onUpdate) {
            req.onUpdate(data);
        }
    }

    function handleRequestResult(payload) {
        const { requestId, result, models } = payload;
        const req = pendingRequests.get(requestId);
        if (req) {
            pendingRequests.delete(requestId);
            // CHANNEL_FETCH_MODELS_RESULT returns 'models', CHANNEL_CALL_RESULT returns 'result'
            req.resolve(result || models);
        }
    }

    function handleRequestError(payload) {
        const { requestId, error } = payload;
        const req = pendingRequests.get(requestId);
        if (req) {
            pendingRequests.delete(requestId);
            req.reject(new Error(error));
        }
    }

    /**
     * 从存储加载所有外部插件并执行
     * 注意：内建插件不走这里，而是通过 loader.js 加载对应文件，在文件内部直接使用
     * Framework / IdoFront API 注册（即“文件直接执行”的方式）。
     */
    async function loadStoredPlugins() {
        const plugins = await window.IdoFront.storage.getAllPlugins();
        if (!plugins || plugins.length === 0) return;
    
        console.info(`[PluginLoader] restoring ${plugins.length} external plugins`);
    
        for (const plugin of plugins) {
            loadedPlugins.set(plugin.id, plugin);
    
            if (!plugin.enabled) continue;
    
            tryRunPlugin(plugin);
        }
    }

    function tryRunPlugin(plugin) {
        if (!sandboxWindow) {
            console.warn('[PluginLoader] Sandbox not ready, skipping plugin execution');
            return;
        }
        try {
            sandboxWindow.postMessage({
                type: 'EXECUTE_PLUGIN',
                payload: {
                    id: plugin.id,
                    code: plugin.code
                }
            }, '*');
            
            // We assume success if message sent, actual status comes back via 'PLUGIN_EXECUTED'
            runtimeHandles.set(plugin.id, true); 
            console.info(`[PluginLoader] sent execution request for ${plugin.name}`);
        } catch (error) {
            console.error(`[PluginLoader] failed to execute ${plugin.name}`, error);
            window.IdoFront.pluginLoader.lastError = {
                pluginId: plugin.id,
                pluginName: plugin.name,
                message: error.message,
                stack: error.stack
            };
        }
    }
    
    window.IdoFront.pluginLoader.addPlugin = async function(name, code, meta = {}) {
        const id = meta.id || `ext-${Date.now()}`;
        const now = new Date().toISOString();
        
        // 再次解析元数据以确保准确性，优先使用传入的 meta，其次是代码中的元数据
        const parsedMeta = window.IdoFront.pluginLoader.parseMetadata(code);
        
        const plugin = {
            id,
            name: name || parsedMeta.name || id,
            code,
            enabled: meta.enabled ?? true,
            version: meta.version || parsedMeta.version || '1.0.0',
            description: meta.description || parsedMeta.description || '',
            author: meta.author || parsedMeta.author || '',
            homepage: meta.homepage || parsedMeta.homepage || '',
            icon: meta.icon || parsedMeta.icon || '',
            createdAt: meta.createdAt || now,
            updatedAt: now,
            source: 'external'
        };
    
        await window.IdoFront.storage.savePlugin(plugin);
        loadedPlugins.set(id, plugin);
    
        if (plugin.enabled) {
            tryRunPlugin(plugin);
        }
    
        return id;
    };

    window.IdoFront.pluginLoader.updatePlugin = async function(id, patch) {
        const plugin = await window.IdoFront.storage.getPlugin(id);
        if (!plugin) throw new Error('Plugin not found');
    
        const next = {
            ...plugin,
            ...patch,
            // external 插件始终标记为 external
            source: plugin.source || 'external',
            updatedAt: new Date().toISOString()
        };
    
        await window.IdoFront.storage.savePlugin(next);
        loadedPlugins.set(id, next);
    
        if (next.enabled) {
            restartPlugin(next.id);
        } else {
            stopPlugin(next.id);
        }
    };

    window.IdoFront.pluginLoader.togglePlugin = async function(id, enabled) {
        // 1) 内建插件：仅更新内存状态与运行态，不写入 IndexedDB
        const inMemory = loadedPlugins.get(id);
        if (inMemory && inMemory.source === 'builtin') {
            inMemory.enabled = enabled;
            loadedPlugins.set(id, inMemory);
    
            if (enabled) {
                restartPlugin(id);
            } else {
                stopPlugin(id);
            }
            return;
        }
    
        // 2) 外部插件：走原有存储路径
        const plugin = await window.IdoFront.storage.getPlugin(id);
        if (!plugin) return;
    
        plugin.enabled = enabled;
        plugin.updatedAt = new Date().toISOString();
    
        await window.IdoFront.storage.savePlugin(plugin);
        loadedPlugins.set(id, plugin);
    
        if (enabled) {
            restartPlugin(id);
        } else {
            stopPlugin(id);
        }
    };

    window.IdoFront.pluginLoader.deletePlugin = async function(id) {
        stopPlugin(id);
        await window.IdoFront.storage.deletePlugin(id);
        loadedPlugins.delete(id);
    };

    window.IdoFront.pluginLoader.getPlugins = function() {
        return Array.from(loadedPlugins.values()).map(plugin => ({
            ...plugin,
            source: plugin.source || 'external',
            runtime: runtimeHandles.has(plugin.id) ? 'running' : 'stopped'
        }));
    };
    
    function stopPlugin(id) {
        const cleanup = runtimeHandles.get(id);
        if (typeof cleanup === 'function') {
            try {
                cleanup();
            } catch (error) {
                console.warn(`[PluginLoader] cleanup failed for ${id}`, error);
            }
        }
        runtimeHandles.delete(id);
        releasePluginResources(id);
    }
    
    function restartPlugin(id) {
        stopPlugin(id);
        const plugin = loadedPlugins.get(id);
        if (plugin && plugin.enabled) {
            tryRunPlugin(plugin);
        }
    }
    
    function attachStoreListeners() {
        if (!store || !store.events) return;
        store.events.on('plugin-states:changed', (payload) => {
            if (!payload || !Array.isArray(payload)) return;
            payload.forEach(({ id, enabled }) => {
                window.IdoFront.pluginLoader.togglePlugin(id, enabled).catch(err => {
                    console.error('[PluginLoader] failed to toggle from store event', err);
                });
            });
        });
    }

    // Network Log Handlers
    function handleNetworkLogRequest(payload) {
        const { logId, timestamp, request } = payload;
        
        const logEntry = {
            id: logId,
            timestamp: timestamp,
            request: request,
            response: null,
            error: null,
            duration: null,
            status: 'pending'
        };

        if (!store.state.networkLogs) {
            store.state.networkLogs = [];
        }
        store.state.networkLogs.unshift(logEntry);
        
        if (store.state.networkLogs.length > 100) {
            store.state.networkLogs = store.state.networkLogs.slice(0, 100);
        }

        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:created', { logId, logEntry });
            } else {
                store.events.emit('network-log:created', { logId, logEntry });
            }
        }
    }

    function handleNetworkLogResponse(payload) {
        const { logId, response, duration } = payload;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;

        logEntry.response = response;
        logEntry.duration = duration;
        logEntry.status = 'success';

        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:response', { logId, logEntry });
            } else {
                store.events.emit('network-log:response', { logId, logEntry });
            }
        }
    }

    function handleNetworkLogStreamStart(payload) {
        const { logId, response } = payload;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;

        logEntry.response = {
            ...response,
            body: null,
            rawBody: '',
            streamChunks: []
        };
        logEntry.status = 'streaming';

        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:response', { logId, logEntry });
            } else {
                store.events.emit('network-log:response', { logId, logEntry });
            }
        }
    }

    function handleNetworkLogStreamChunk(payload) {
        const { logId, chunk, timestamp } = payload;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry || !logEntry.response) return;

        logEntry.response.streamChunks.push({
            timestamp: timestamp,
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

    function handleNetworkLogStreamComplete(payload) {
        const { logId, duration } = payload;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;

        logEntry.status = 'success';
        logEntry.duration = duration;

        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:stream-complete', { logId, logEntry });
            } else {
                store.events.emit('network-log:stream-complete', { logId, logEntry });
            }
        }
    }

    function handleNetworkLogError(payload) {
        const { logId, error, duration } = payload;
        const logEntry = store.state.networkLogs?.find(log => log.id === logId);
        
        if (!logEntry) return;

        logEntry.error = error;
        logEntry.status = 'error';
        logEntry.duration = duration;

        if (store.events) {
            if (typeof store.events.emitAsync === 'function') {
                store.events.emitAsync('network-log:error', { logId, error, logEntry });
            } else {
                store.events.emit('network-log:error', { logId, error, logEntry });
            }
        }
    }

})();