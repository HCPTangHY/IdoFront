
/**
 * External Plugin Loader
 * 外部插件加载器：负责管理和运行用户导入的第三方插件脚本
 * Refactored for Manifest V3: Uses Sandboxed Iframe
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.pluginLoader = window.IdoFront.pluginLoader || {};

    const channelRegistry = window.IdoFront.channelRegistry;
    const pluginResources = new Map(); // pluginId -> { cleanupFns: Set, channelTypes: Set, uiComponents: Map }
    
    // Sandbox Communication
    let sandboxFrame = null;
    let sandboxWindow = null;
    let sandboxInitialized = false;
    const pendingRequests = new Map(); // requestId -> { resolve, reject, onUpdate }
    const pendingUIRenders = new Map(); // requestId -> { resolve, reject }
    let requestCounter = 0;

    // 等待沙箱完成初始化（拿到 SLOTS 等配置），避免外部插件在 SLOTS 未就绪时注册 UI 失败
    let sandboxReadyPromise = null;
    let sandboxReadyResolve = null;
    let sandboxReadyTimeoutId = null;

    function resolveSandboxReady() {
        if (sandboxReadyTimeoutId) {
            clearTimeout(sandboxReadyTimeoutId);
            sandboxReadyTimeoutId = null;
        }
        if (typeof sandboxReadyResolve === 'function') {
            try {
                sandboxReadyResolve();
            } catch (e) {
                // ignore
            }
        }
        sandboxReadyPromise = null;
        sandboxReadyResolve = null;
    }

    function waitForSandboxReady(timeoutMs = 3000) {
        if (sandboxInitialized) return Promise.resolve();
        if (sandboxReadyPromise) return sandboxReadyPromise;

        sandboxReadyPromise = new Promise((resolve) => {
            sandboxReadyResolve = resolve;

            sandboxReadyTimeoutId = setTimeout(() => {
                if (!sandboxInitialized) {
                    console.warn('[PluginLoader] Sandbox ready timeout, continue anyway');
                }
                resolveSandboxReady();
            }, timeoutMs);
        });

        return sandboxReadyPromise;
    }
    
    // 外部插件 UI 注册表：pluginId -> Map<slotName, Map<componentId, proxyDef>>
    const externalUIRegistry = new Map();
    
    // 外部插件 Bundle 注册表：pluginId -> Map<bundleId, internalBundleId>
    const externalBundleRegistry = new Map();
    
    // 沙箱事件订阅注册表：eventName -> Map<listenerId, { pluginId }>
    const sandboxEventSubscriptions = new Map();
    
    // Framework events 订阅注册表：eventName -> { listeners: Map<listenerId, { pluginId }>, handler: Function }
    const sandboxFrameworkEventSubscriptions = new Map();

    function ensureResourceBucket(pluginId) {
        if (!pluginId) return null;
        if (!pluginResources.has(pluginId)) {
            pluginResources.set(pluginId, {
                cleanupFns: new Set(),
                channelTypes: new Set(),
                bundleIds: new Set(), // internal bundle id
                uiComponents: new Map() // slotName -> Set<componentId>
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
        
        // 注销 Bundle
        if (bucket.bundleIds && bucket.bundleIds.size > 0) {
            bucket.bundleIds.forEach(bundleId => {
                try {
                    if (window.Framework && window.Framework.unregisterPluginBundle) {
                        window.Framework.unregisterPluginBundle(bundleId);
                    }
                } catch (error) {
                    console.warn(`[PluginLoader] unregister plugin bundle failed ${bundleId}`, error);
                }
            });
            bucket.bundleIds.clear();
        }
        
        // 注销 UI 组件
        if (bucket.uiComponents && bucket.uiComponents.size > 0) {
            bucket.uiComponents.forEach((componentIds, slotName) => {
                componentIds.forEach(componentId => {
                    try {
                        if (window.Framework && window.Framework.unregisterPlugin) {
                            window.Framework.unregisterPlugin(slotName, componentId);
                        }
                    } catch (error) {
                        console.warn(`[PluginLoader] unregister UI component failed ${slotName}/${componentId}`, error);
                    }
                });
            });
            bucket.uiComponents.clear();
        }

        if (bucket.cleanupFns.size === 0 && bucket.channelTypes.size === 0 && (!bucket.bundleIds || bucket.bundleIds.size === 0) && (!bucket.uiComponents || bucket.uiComponents.size === 0)) {
            pluginResources.delete(pluginId);
        }
        
        // 清理事件订阅映射（避免 stop 后仍向沙箱派发）
        const storeEventsToDelete = [];
        for (const [eventName, listeners] of sandboxEventSubscriptions.entries()) {
            for (const [listenerId, info] of listeners.entries()) {
                if (info && info.pluginId === pluginId) {
                    listeners.delete(listenerId);
                }
            }
            if (listeners.size === 0) {
                storeEventsToDelete.push(eventName);
            }
        }
        storeEventsToDelete.forEach((eventName) => sandboxEventSubscriptions.delete(eventName));
        
        const frameworkEventsToDelete = [];
        for (const [eventName, bucketInfo] of sandboxFrameworkEventSubscriptions.entries()) {
            const listeners = bucketInfo && bucketInfo.listeners ? bucketInfo.listeners : null;
            if (!listeners) continue;
            
            for (const [listenerId, info] of listeners.entries()) {
                if (info && info.pluginId === pluginId) {
                    listeners.delete(listenerId);
                }
            }
            
            if (listeners.size === 0) {
                // 清理主线程的事件订阅
                if (bucketInfo.handler && window.Framework && window.Framework.events && typeof window.Framework.events.off === 'function') {
                    try {
                        window.Framework.events.off(eventName, bucketInfo.handler);
                    } catch (error) {
                        console.warn(`[PluginLoader] Framework.events.off failed for ${eventName}`, error);
                    }
                }
                frameworkEventsToDelete.push(eventName);
            }
        }
        frameworkEventsToDelete.forEach((eventName) => sandboxFrameworkEventSubscriptions.delete(eventName));
        
        // 清理外部注册表
        externalUIRegistry.delete(pluginId);
        externalBundleRegistry.delete(pluginId);
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
                // 重新设置监听器
                setupSandboxListener();
                // 发送初始化配置
                sendSandboxInit();
                // 等待沙箱回应 SANDBOX_READY，确保 SLOTS 已同步
                waitForSandboxReady().then(resolve);
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
                console.info('[PluginLoader] Sandbox iframe loaded');
                setupSandboxListener();

                // 兜底：sandbox 可能在 onload 前已发送 SANDBOX_LOADED（导致主线程错过），
                // 这里强制发送一次初始化配置，确保沙箱拿到 SLOTS 后外部插件才能注册 UI。
                sendSandboxInit();

                // 等待沙箱回应 SANDBOX_READY，确保 SLOTS 已同步
                waitForSandboxReady().then(resolve);
            };
        });
    }
    
    /**
     * 发送沙箱初始化配置
     */
    function sendSandboxInit() {
        if (!sandboxWindow) return;
        
        // 从 Framework 获取 SLOTS 常量
        const SLOTS = window.Framework && window.Framework.SLOTS ? window.Framework.SLOTS : {};
        
        sandboxWindow.postMessage({
            type: 'SANDBOX_INIT',
            payload: {
                SLOTS
            }
        }, '*');
        
        console.info('[PluginLoader] Sent SANDBOX_INIT with SLOTS:', Object.keys(SLOTS));
    }

    function setupSandboxListener() {
        window.addEventListener('message', (event) => {
            // Security check: ensure message comes from our sandbox
            if (event.source !== sandboxWindow) return;

            const { type, payload } = event.data;
            
            switch (type) {
                case 'SANDBOX_LOADED':
                    // 沙箱脚本已加载，发送初始化配置
                    console.info('[PluginLoader] Sandbox script loaded, sending init config');
                    sendSandboxInit();
                    break;
                case 'SANDBOX_READY':
                    // 沙箱已完成初始化
                    sandboxInitialized = true;
                    console.info('[PluginLoader] Sandbox fully initialized');
                    resolveSandboxReady();
                    break;
                case 'PLUGIN_REGISTER_CHANNEL':
                    handleRegisterChannel(payload);
                    break;
                case 'PLUGIN_UNREGISTER_CHANNEL':
                    handleUnregisterChannel(payload);
                    break;
                case 'PLUGIN_REGISTER_UI':
                    handleRegisterUI(payload);
                    break;
                case 'PLUGIN_UNREGISTER_UI':
                    handleUnregisterUI(payload);
                    break;
                case 'FRAMEWORK_REGISTER_PLUGIN_BUNDLE':
                    handleFrameworkRegisterPluginBundle(payload);
                    break;
                case 'FRAMEWORK_UNREGISTER_PLUGIN_BUNDLE':
                    handleFrameworkUnregisterPluginBundle(payload);
                    break;
                case 'UI_RENDER_RESULT':
                    handleUIRenderResult(payload);
                    break;
                case 'UI_PUSH_UPDATE':
                    handleUIPushUpdate(payload);
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
                case 'FRAMEWORK_ADD_MESSAGE':
                    // 代理 Framework.addMessage
                    if (window.Framework && window.Framework.addMessage) {
                        window.Framework.addMessage(payload.role, payload.content, payload.options);
                    }
                    break;
                case 'FRAMEWORK_UPDATE_LAST_MESSAGE':
                    // 代理 Framework.updateLastMessage
                    if (window.Framework && window.Framework.updateLastMessage) {
                        window.Framework.updateLastMessage(payload.content);
                    }
                    break;
                case 'FRAMEWORK_CLEAR_MESSAGES':
                    // 代理 Framework.clearMessages
                    if (window.Framework && window.Framework.clearMessages) {
                        window.Framework.clearMessages();
                    }
                    break;
                case 'FRAMEWORK_TOGGLE_PANEL':
                    // 代理 Framework.togglePanel
                    if (window.Framework && window.Framework.togglePanel) {
                        window.Framework.togglePanel(payload.side, payload.force);
                    }
                    break;
                case 'FRAMEWORK_SET_MODE':
                    // 代理 Framework.setMode（不带 renderers）
                    if (window.Framework && window.Framework.setMode) {
                        window.Framework.setMode(payload.mode);
                    }
                    break;
                case 'FRAMEWORK_REFRESH_SLOT':
                    if (window.Framework && typeof window.Framework.refreshSlot === 'function') {
                        window.Framework.refreshSlot(payload.slotName);
                    }
                    break;
                case 'FRAMEWORK_SHOW_BOTTOM_SHEET':
                    handleFrameworkShowBottomSheet(payload);
                    break;
                case 'FRAMEWORK_HIDE_BOTTOM_SHEET':
                    if (window.Framework && window.Framework.hideBottomSheet) {
                        window.Framework.hideBottomSheet();
                    }
                    break;
                case 'FRAMEWORK_SET_CUSTOM_PANEL':
                    handleFrameworkSetCustomPanel(payload);
                    break;
                case 'FRAMEWORK_RESTORE_DEFAULT_RIGHT_PANEL':
                    if (window.Framework && window.Framework.restoreDefaultRightPanel) {
                        window.Framework.restoreDefaultRightPanel();
                    }
                    break;
                case 'FRAMEWORK_FINALIZE_STREAMING_MESSAGE':
                    if (window.Framework && window.Framework.finalizeStreamingMessage) {
                        window.Framework.finalizeStreamingMessage();
                    }
                    break;
                case 'FRAMEWORK_RENDER_ALL_PENDING_MARKDOWN':
                    if (window.Framework && window.Framework.renderAllPendingMarkdown) {
                        window.Framework.renderAllPendingMarkdown();
                    }
                    break;
                case 'FRAMEWORK_REMOVE_MESSAGE_STREAMING_INDICATOR':
                    if (window.Framework && window.Framework.removeMessageStreamingIndicator) {
                        window.Framework.removeMessageStreamingIndicator(payload.messageId);
                    }
                    break;
                case 'FRAMEWORK_REMOVE_LOADING_INDICATOR':
                    if (window.Framework && window.Framework.removeLoadingIndicator) {
                        window.Framework.removeLoadingIndicator(payload.loadingId);
                    }
                    break;
                case 'FRAMEWORK_SET_SEND_BUTTON_LOADING':
                    if (window.Framework && window.Framework.setSendButtonLoading) {
                        window.Framework.setSendButtonLoading(payload.isLoading);
                    }
                    break;
                case 'FRAMEWORK_SUBSCRIBE_EVENT':
                    handleFrameworkSubscribeEvent(payload);
                    break;
                case 'FRAMEWORK_UNSUBSCRIBE_EVENT':
                    handleFrameworkUnsubscribeEvent(payload);
                    break;
                case 'FRAMEWORK_EMIT_EVENT':
                    handleFrameworkEmitEvent(payload);
                    break;
                case 'FRAMEWORK_EMIT_ASYNC_EVENT':
                    handleFrameworkEmitAsyncEvent(payload);
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
                // Store 请求处理
                case 'STORE_GET_STATE':
                    handleStoreGetState(payload);
                    break;
                case 'STORE_GET_ACTIVE_CONVERSATION':
                    handleStoreGetActiveConversation(payload);
                    break;
                case 'STORE_GET_CONVERSATION':
                    handleStoreGetConversation(payload);
                    break;
                case 'STORE_UPDATE_METADATA':
                    handleStoreUpdateMetadata(payload);
                    break;
                case 'STORE_PERSIST':
                    handleStorePersist(payload);
                    break;
                case 'STORE_SUBSCRIBE_EVENT':
                    handleStoreSubscribeEvent(payload);
                    break;
                case 'STORE_UNSUBSCRIBE_EVENT':
                    handleStoreUnsubscribeEvent(payload);
                    break;
                // Storage 请求处理
                case 'STORAGE_GET_ITEM':
                    handleStorageGetItem(payload);
                    break;
                case 'STORAGE_SET_ITEM':
                    handleStorageSetItem(payload);
                    break;
                case 'STORAGE_REMOVE_ITEM':
                    handleStorageRemoveItem(payload);
                    break;
                // Framework Loading / Storage（需要返回结果）
                case 'FRAMEWORK_ADD_LOADING_INDICATOR':
                    handleFrameworkAddLoadingIndicator(payload);
                    break;
                case 'FRAMEWORK_ATTACH_LOADING_INDICATOR':
                    handleFrameworkAttachLoadingIndicator(payload);
                    break;
                case 'FRAMEWORK_STORAGE_GET_ITEM':
                    handleFrameworkStorageGetItem(payload);
                    break;
                case 'FRAMEWORK_STORAGE_SET_ITEM':
                    handleFrameworkStorageSetItem(payload);
                    break;
            }
        });
    }
    
    // ============ Store 代理处理器 ============
    
    /**
     * 处理 STORE_GET_STATE 请求
     */
    function handleStoreGetState(payload) {
        const { requestId } = payload;
        
        try {
            // 返回状态的安全副本（移除不可序列化的内容）
            const state = store ? {
                conversations: store.state.conversations,
                activeConversationId: store.state.activeConversationId,
                channels: store.state.channels,
                personas: store.state.personas,
                activePersonaId: store.state.activePersonaId
                // 不包含 networkLogs 等可能很大的数据
            } : null;
            
            sendStoreResult(requestId, true, state);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 处理 STORE_GET_ACTIVE_CONVERSATION 请求
     */
    function handleStoreGetActiveConversation(payload) {
        const { requestId } = payload;
        
        try {
            const conv = store && typeof store.getActiveConversation === 'function'
                ? store.getActiveConversation()
                : null;
            
            sendStoreResult(requestId, true, conv);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 处理 STORE_GET_CONVERSATION 请求
     */
    function handleStoreGetConversation(payload) {
        const { requestId, conversationId } = payload;
        
        try {
            const conv = store && store.state.conversations
                ? store.state.conversations.find(c => c.id === conversationId)
                : null;
            
            sendStoreResult(requestId, true, conv || null);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 处理 STORE_UPDATE_METADATA 请求
     */
    function handleStoreUpdateMetadata(payload) {
        const { requestId, conversationId, metadata } = payload;
        
        try {
            if (!store || !store.state.conversations) {
                throw new Error('Store not available');
            }
            
            const conv = store.state.conversations.find(c => c.id === conversationId);
            if (!conv) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            
            // 合并元数据
            conv.metadata = {
                ...(conv.metadata || {}),
                ...metadata
            };
            
            sendStoreResult(requestId, true);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 处理 STORE_PERSIST 请求
     */
    function handleStorePersist(payload) {
        const { requestId } = payload;
        
        try {
            if (store && typeof store.persist === 'function') {
                store.persist();
            }
            sendStoreResult(requestId, true);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 处理 STORE_SUBSCRIBE_EVENT 请求
     */
    function handleStoreSubscribeEvent(payload) {
        const { eventName, listenerId, pluginId } = payload;
        
        if (!sandboxEventSubscriptions.has(eventName)) {
            sandboxEventSubscriptions.set(eventName, new Map());
            
            // 首次订阅此事件时，注册到 store.events
            if (store && store.events && typeof store.events.on === 'function') {
                store.events.on(eventName, (eventData) => {
                    dispatchEventToSandbox(eventName, eventData);
                });
            }
        }
        
        sandboxEventSubscriptions.get(eventName).set(listenerId, { pluginId });
        console.info(`[PluginLoader] Sandbox subscribed to event: ${eventName} (${listenerId})`);
    }
    
    /**
     * 处理 STORE_UNSUBSCRIBE_EVENT 请求
     */
    function handleStoreUnsubscribeEvent(payload) {
        const { eventName, listenerId } = payload;
        
        const listeners = sandboxEventSubscriptions.get(eventName);
        if (listeners) {
            listeners.delete(listenerId);
            console.info(`[PluginLoader] Sandbox unsubscribed from event: ${eventName} (${listenerId})`);
            
            // 注意：这里不会从 store.events 取消订阅，因为可能还有其他监听器
            // 如果需要完全清理，可以在所有监听器都取消后再处理
        }
    }
    
    /**
     * 向沙箱转发事件
     * @param {string} eventName - 事件名称
     * @param {any} eventData - 事件数据
     */
    function dispatchEventToSandbox(eventName, eventData) {
        const listeners = sandboxEventSubscriptions.get(eventName);
        if (!listeners || listeners.size === 0) return;
        
        // 构建增强的事件 payload，附带常用上下文以减少异步查询
        let enhancedEventData = eventData;
        
        // 对于 'updated' 事件，附带活动会话信息以便插件快速判断是否需要显示
        if (eventName === 'updated' && store) {
            try {
                const activeConv = store.getActiveConversation ? store.getActiveConversation() : null;
                const activeChannel = activeConv && store.state.channels
                    ? store.state.channels.find(c => c && c.id === activeConv.selectedChannelId)
                    : null;
                
                enhancedEventData = {
                    ...(eventData && typeof eventData === 'object' ? eventData : {}),
                    __context: {
                        activeConversationId: activeConv ? activeConv.id : null,
                        activeChannelId: activeConv ? activeConv.selectedChannelId : null,
                        activeChannelType: activeChannel ? activeChannel.type : null,
                        activeConversationMetadata: activeConv ? activeConv.metadata : null
                    }
                };
            } catch (e) {
                // 如果获取上下文失败，使用原始数据
                enhancedEventData = eventData;
            }
        }
        
        // 只要有订阅者，就发送事件到沙箱
        if (sandboxWindow) {
            sandboxWindow.postMessage({
                type: 'STORE_EVENT_DISPATCH',
                payload: { eventName, eventData: enhancedEventData }
            }, '*');
        }
    }
    
    // ============ Storage 代理处理器 ============
    
    /**
     * 处理 STORAGE_GET_ITEM 请求
     */
    function handleStorageGetItem(payload) {
        const { requestId, key } = payload;
        
        try {
            let value = null;
            
            // 优先使用 Framework.storage
            if (window.Framework && window.Framework.storage && typeof window.Framework.storage.getItem === 'function') {
                value = window.Framework.storage.getItem(key);
            } else {
                // 回退到 localStorage
                const raw = localStorage.getItem(key);
                if (raw) {
                    try {
                        value = JSON.parse(raw);
                    } catch (e) {
                        value = raw;
                    }
                }
            }
            
            sendStoreResult(requestId, true, value);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 处理 STORAGE_SET_ITEM 请求
     */
    function handleStorageSetItem(payload) {
        const { requestId, key, value } = payload;
        
        try {
            // 优先使用 Framework.storage
            if (window.Framework && window.Framework.storage && typeof window.Framework.storage.setItem === 'function') {
                window.Framework.storage.setItem(key, value);
            } else {
                // 回退到 localStorage
                localStorage.setItem(key, JSON.stringify(value));
            }
            
            sendStoreResult(requestId, true);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 处理 STORAGE_REMOVE_ITEM 请求
     */
    function handleStorageRemoveItem(payload) {
        const { requestId, key } = payload;
        
        try {
            // 优先使用 Framework.storage
            if (window.Framework && window.Framework.storage && typeof window.Framework.storage.removeItem === 'function') {
                window.Framework.storage.removeItem(key);
            } else {
                // 回退到 localStorage
                localStorage.removeItem(key);
            }
            
            sendStoreResult(requestId, true);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    /**
     * 发送 Store 请求结果到沙箱
     */
    function sendStoreResult(requestId, success, result = null, error = null) {
        if (sandboxWindow) {
            sandboxWindow.postMessage({
                type: 'STORE_REQUEST_RESULT',
                payload: { requestId, success, result, error }
            }, '*');
        }
    }
    
    /**
     * 处理外部插件 UI 注册
     */
    function handleRegisterUI(payload) {
        const { pluginId, slotName, componentId, meta } = payload;
        
        // 确保插件资源桶存在
        const bucket = ensureResourceBucket(pluginId);
        if (!bucket.uiComponents.has(slotName)) {
            bucket.uiComponents.set(slotName, new Set());
        }
        bucket.uiComponents.get(slotName).add(componentId);
        
        // 确保外部 UI 注册表存在
        if (!externalUIRegistry.has(pluginId)) {
            externalUIRegistry.set(pluginId, new Map());
        }
        const pluginSlots = externalUIRegistry.get(pluginId);
        if (!pluginSlots.has(slotName)) {
            pluginSlots.set(slotName, new Map());
        }
        pluginSlots.get(slotName).set(componentId, { meta });
        
        // 创建代理插件定义，注册到 Framework
        const proxyDefinition = {
            meta: {
                ...meta,
                source: `plugin:${pluginId}`,
                isExternal: true
            },
            render: (frameworkApi) => {
                // 返回一个占位元素，稍后异步填充
                return renderExternalUIComponent(pluginId, slotName, componentId, frameworkApi);
            },
            destroy: () => {
                console.log(`[PluginLoader] External UI component destroyed: ${pluginId}/${slotName}/${componentId}`);
            }
        };
        
        // 注册到 Framework
        if (window.Framework && window.Framework.registerPlugin) {
            window.Framework.registerPlugin(slotName, componentId, proxyDefinition);
            console.info(`[PluginLoader] External UI registered: ${pluginId}/${slotName}/${componentId}`);
        } else {
            console.warn('[PluginLoader] Framework.registerPlugin not available');
        }
    }
    
    /**
     * 处理外部插件 UI 注销
     */
    function handleUnregisterUI(payload) {
        const { pluginId, slotName, componentId } = payload;
        
        // 从 Framework 注销
        if (window.Framework && window.Framework.unregisterPlugin) {
            window.Framework.unregisterPlugin(slotName, componentId);
        }
        
        // 清理注册表
        const bucket = pluginResources.get(pluginId);
        if (bucket && bucket.uiComponents.has(slotName)) {
            bucket.uiComponents.get(slotName).delete(componentId);
        }
        
        const pluginSlots = externalUIRegistry.get(pluginId);
        if (pluginSlots && pluginSlots.has(slotName)) {
            pluginSlots.get(slotName).delete(componentId);
        }
        
        console.info(`[PluginLoader] External UI unregistered: ${pluginId}/${slotName}/${componentId}`);
    }
    
    // ============ Framework Bundle 代理处理器 ============
    
    function ensureExternalBundleMap(pluginId) {
        if (!externalBundleRegistry.has(pluginId)) {
            externalBundleRegistry.set(pluginId, new Map());
        }
        return externalBundleRegistry.get(pluginId);
    }
    
    function getInternalBundleId(pluginId, bundleId) {
        return `extbundle:${pluginId}:${bundleId}`;
    }
    
    function handleFrameworkRegisterPluginBundle(payload) {
        const { pluginId, bundleId, meta, slotsKind, slots } = payload || {};
        if (!pluginId || !bundleId) return;
        
        if (!window.Framework || typeof window.Framework.registerPluginBundle !== 'function') {
            console.warn('[PluginLoader] Framework.registerPluginBundle not available');
            return;
        }
        
        const bucket = ensureResourceBucket(pluginId);
        const bundleMap = ensureExternalBundleMap(pluginId);
        const internalBundleId = getInternalBundleId(pluginId, bundleId);
        
        // 避免重复注册
        const existingInternal = bundleMap.get(bundleId);
        if (existingInternal) {
            if (bucket && bucket.bundleIds) {
                bucket.bundleIds.delete(existingInternal);
            }
            if (window.Framework && typeof window.Framework.unregisterPluginBundle === 'function') {
                try {
                    window.Framework.unregisterPluginBundle(existingInternal);
                } catch (error) {
                    console.warn(`[PluginLoader] unregister existing bundle failed ${existingInternal}`, error);
                }
            }
        }
        
        bundleMap.set(bundleId, internalBundleId);
        if (bucket && bucket.bundleIds) {
            bucket.bundleIds.add(internalBundleId);
        }
        
        const safeMeta = (meta && typeof meta === 'object') ? meta : {};
        const proxyMeta = {
            ...safeMeta,
            source: `plugin:${pluginId}`,
            isExternal: true,
            externalBundleId: bundleId
        };
        
        let proxySlots;
        
        if (slotsKind === 'array' && Array.isArray(slots)) {
            proxySlots = slots.map(item => {
                if (!item || !item.slot || !item.id) return null;
                return {
                    slot: item.slot,
                    id: item.id,
                    render: (ctx) => renderExternalUIComponent(pluginId, item.slot, item.id, ctx)
                };
            }).filter(Boolean);
        } else if (slots && typeof slots === 'object') {
            proxySlots = {};
            Object.keys(slots).forEach((slotName) => {
                const slotDef = slots[slotName];
                
                if (Array.isArray(slotDef)) {
                    const arr = slotDef.map(entry => {
                        if (!entry || !entry.id) return null;
                        return {
                            id: entry.id,
                            render: (ctx) => renderExternalUIComponent(pluginId, slotName, entry.id, ctx)
                        };
                    }).filter(Boolean);
                    if (arr.length > 0) {
                        proxySlots[slotName] = arr;
                    }
                    return;
                }
                
                if (slotDef && slotDef.id) {
                    proxySlots[slotName] = {
                        id: slotDef.id,
                        render: (ctx) => renderExternalUIComponent(pluginId, slotName, slotDef.id, ctx)
                    };
                }
            });
        } else {
            console.warn('[PluginLoader] Invalid bundle slots payload', payload);
            return;
        }
        
        try {
            window.Framework.registerPluginBundle(internalBundleId, {
                meta: proxyMeta,
                slots: proxySlots
            });
            console.info(`[PluginLoader] External bundle registered: ${pluginId}/${bundleId} -> ${internalBundleId}`);
        } catch (error) {
            console.error(`[PluginLoader] Failed to register external bundle ${internalBundleId}`, error);
        }
    }
    
    function handleFrameworkUnregisterPluginBundle(payload) {
        const { pluginId, bundleId } = payload || {};
        if (!pluginId || !bundleId) return;
        
        const bundleMap = externalBundleRegistry.get(pluginId);
        const internalBundleId = bundleMap && bundleMap.get(bundleId)
            ? bundleMap.get(bundleId)
            : getInternalBundleId(pluginId, bundleId);
        
        try {
            if (window.Framework && typeof window.Framework.unregisterPluginBundle === 'function') {
                window.Framework.unregisterPluginBundle(internalBundleId);
            }
        } catch (error) {
            console.warn(`[PluginLoader] Failed to unregister external bundle ${internalBundleId}`, error);
        }
        
        const bucket = pluginResources.get(pluginId);
        if (bucket && bucket.bundleIds) {
            bucket.bundleIds.delete(internalBundleId);
        }
        
        if (bundleMap) {
            bundleMap.delete(bundleId);
            if (bundleMap.size === 0) {
                externalBundleRegistry.delete(pluginId);
            }
        }
        
        console.info(`[PluginLoader] External bundle unregistered: ${pluginId}/${bundleId}`);
    }

    /**
     * 渲染外部 UI 组件
     * 创建占位元素并异步请求沙箱渲染
     */
    function renderExternalUIComponent(pluginId, slotName, componentId, context) {
        // 创建占位容器
        const container = document.createElement('div');
        container.className = 'external-plugin-container';
        container.dataset.pluginId = pluginId;
        container.dataset.slotName = slotName;
        container.dataset.componentId = componentId;
        
        // 1. 尝试从缓存中同步渲染（避免 refreshSlot 时的闪烁/延迟）
        const cached = getCachedUI(pluginId, slotName, componentId);
        if (cached && cached.html) {
            container.innerHTML = cached.html;
            if (cached.clickHandlers && cached.clickHandlers.length > 0) {
                bindClickHandlers(container, cached.clickHandlers);
            }
        }

        // 2. 仍然发起异步请求以确保状态最新（Stale-While-Revalidate）
        // 如果是 Push 触发的刷新，缓存通常是最新的，这个请求只是确认
        requestUIRender(pluginId, slotName, componentId, context)
            .then(result => {
                if (result.success && result.html) {
                    // 更新缓存
                    updateCachedUI(pluginId, slotName, componentId, result.html, result.clickHandlers);

                    // 更新 DOM
                    container.innerHTML = result.html;
                    
                    // 绑定点击处理器
                    if (result.clickHandlers && result.clickHandlers.length > 0) {
                        bindClickHandlers(container, result.clickHandlers);
                    }
                } else if (!result.success) {
                    console.error(`[PluginLoader] UI render failed: ${result.error}`);
                    // 只有在没有缓存内容时才显示错误，避免覆盖旧内容
                    if (!container.hasChildNodes()) {
                        container.innerHTML = `<span class="text-red-500 text-xs">插件渲染失败</span>`;
                    }
                }
            })
            .catch(error => {
                console.error(`[PluginLoader] UI render error:`, error);
                if (!container.hasChildNodes()) {
                    container.innerHTML = `<span class="text-red-500 text-xs">插件错误</span>`;
                }
            });
        
        return container;
    }

    function getCachedUI(pluginId, slotName, componentId) {
        const pluginSlots = externalUIRegistry.get(pluginId);
        if (!pluginSlots) return null;
        const slotComponents = pluginSlots.get(slotName);
        if (!slotComponents) return null;
        return slotComponents.get(componentId);
    }

    function updateCachedUI(pluginId, slotName, componentId, html, clickHandlers) {
        const pluginSlots = externalUIRegistry.get(pluginId);
        if (!pluginSlots) return;
        const slotComponents = pluginSlots.get(slotName);
        if (!slotComponents) return;
        
        const entry = slotComponents.get(componentId);
        if (entry) {
            entry.html = html;
            entry.clickHandlers = clickHandlers;
        }
    }
    
    /**
     * 请求沙箱渲染 UI 组件
     */
    function requestUIRender(pluginId, slotName, componentId, context) {
        return new Promise((resolve, reject) => {
            const requestId = ++requestCounter;
            pendingUIRenders.set(requestId, { resolve, reject });
            
            // 序列化 context（移除不可序列化的内容）
            const serializableContext = {
                pluginId,
                // 只传递基本信息，不传递函数
            };
            
            sandboxWindow.postMessage({
                type: 'UI_RENDER_REQUEST',
                payload: {
                    requestId,
                    pluginId,
                    slotName,
                    componentId,
                    context: serializableContext
                }
            }, '*');
            
            // 超时处理
            setTimeout(() => {
                if (pendingUIRenders.has(requestId)) {
                    pendingUIRenders.delete(requestId);
                    reject(new Error('UI render timeout'));
                }
            }, 5000);
        });
    }
    
    /**
     * 处理 UI 渲染结果
     */
    function handleUIRenderResult(payload) {
        const { requestId, success, html, clickHandlers, error } = payload;
        
        const pending = pendingUIRenders.get(requestId);
        if (pending) {
            pendingUIRenders.delete(requestId);
            pending.resolve({ success, html, clickHandlers, error });
        }
    }
    
    /**
     * 处理沙箱主动推送的 UI 更新
     * 这是优化路径：沙箱在 refreshSlot 时同时执行渲染并推送结果，无需往返
     */
    function handleUIPushUpdate(payload) {
        const { pluginId, slotName, componentId, html, clickHandlers } = payload;
        
        if (!pluginId || !slotName || !componentId) return;
        
        // 1. 无论 DOM 是否存在，先更新缓存
        // 这样随后的 Framework.refreshSlot -> renderExternalUIComponent 就能直接使用最新内容
        updateCachedUI(pluginId, slotName, componentId, html, clickHandlers);

        // 2. 查找并更新现有的容器元素
        const containers = document.querySelectorAll(
            `.external-plugin-container[data-plugin-id="${pluginId}"][data-slot-name="${slotName}"][data-component-id="${componentId}"]`
        );
        
        if (containers.length > 0) {
            // 容器存在，直接更新内容
            containers.forEach(container => {
                container.innerHTML = html || '';
                
                // 绑定点击处理器
                if (clickHandlers && clickHandlers.length > 0) {
                    bindClickHandlers(container, clickHandlers);
                }
            });
        } else {
            // 容器不存在（可能被其他 refreshSlot 调用销毁）
            // 触发主线程的 refreshSlot 重新创建容器
            // 由于缓存已更新，renderExternalUIComponent 会从缓存中同步渲染，无延迟
            if (window.Framework && typeof window.Framework.refreshSlot === 'function') {
                window.Framework.refreshSlot(slotName);
            }
        }
    }
    
    /**
     * 绑定点击处理器到 DOM 元素
     */
    function bindClickHandlers(container, handlers) {
        handlers.forEach(({ handlerId, selector }) => {
            const element = container.querySelector(selector);
            if (element) {
                element.addEventListener('click', (event) => {
                    // 发送点击事件到沙箱
                    sandboxWindow.postMessage({
                        type: 'UI_CLICK_EVENT',
                        payload: {
                            handlerId,
                            eventData: {
                                // 只传递可序列化的事件数据
                                type: event.type,
                                target: {
                                    tagName: event.target.tagName,
                                    className: event.target.className
                                }
                            }
                        }
                    }, '*');
                });
            }
        });
    }
    
    // ============ Framework UI / Events / Storage 代理处理器 ============
    
    function handleFrameworkShowBottomSheet(payload) {
        const { html, clickHandlers } = payload || {};
        
        if (!window.Framework || typeof window.Framework.showBottomSheet !== 'function') {
            console.warn('[PluginLoader] Framework.showBottomSheet not available');
            return;
        }
        
        window.Framework.showBottomSheet((container) => {
            container.innerHTML = html || '';
            if (clickHandlers && Array.isArray(clickHandlers) && clickHandlers.length > 0) {
                bindClickHandlers(container, clickHandlers);
            }
        });
    }
    
    function handleFrameworkSetCustomPanel(payload) {
        const { side, html, clickHandlers } = payload || {};
        
        if (!window.Framework || typeof window.Framework.setCustomPanel !== 'function') {
            console.warn('[PluginLoader] Framework.setCustomPanel not available');
            return;
        }
        
        window.Framework.setCustomPanel(side, (container) => {
            container.innerHTML = html || '';
            if (clickHandlers && Array.isArray(clickHandlers) && clickHandlers.length > 0) {
                bindClickHandlers(container, clickHandlers);
            }
        });
    }
    
    function ensureFrameworkEventBucket(eventName) {
        if (!sandboxFrameworkEventSubscriptions.has(eventName)) {
            sandboxFrameworkEventSubscriptions.set(eventName, {
                listeners: new Map(),
                handler: null
            });
        }
        const bucket = sandboxFrameworkEventSubscriptions.get(eventName);
        
        if (!bucket.handler && window.Framework && window.Framework.events && typeof window.Framework.events.on === 'function') {
            bucket.handler = (eventData) => {
                dispatchFrameworkEventToSandbox(eventName, eventData);
            };
            window.Framework.events.on(eventName, bucket.handler);
        }
        
        return bucket;
    }
    
    function handleFrameworkSubscribeEvent(payload) {
        const { eventName, listenerId, pluginId } = payload || {};
        if (!eventName || !listenerId) return;
        
        const bucket = ensureFrameworkEventBucket(eventName);
        bucket.listeners.set(listenerId, { pluginId });
        
        console.info(`[PluginLoader] Sandbox subscribed to Framework event: ${eventName} (${listenerId})`);
    }
    
    function handleFrameworkUnsubscribeEvent(payload) {
        const { eventName, listenerId } = payload || {};
        if (!eventName || !listenerId) return;
        
        const bucket = sandboxFrameworkEventSubscriptions.get(eventName);
        if (!bucket) return;
        
        bucket.listeners.delete(listenerId);
        console.info(`[PluginLoader] Sandbox unsubscribed from Framework event: ${eventName} (${listenerId})`);
        
        if (bucket.listeners.size === 0) {
            // 清理主线程的事件订阅
            if (bucket.handler && window.Framework && window.Framework.events && typeof window.Framework.events.off === 'function') {
                try {
                    window.Framework.events.off(eventName, bucket.handler);
                } catch (error) {
                    console.warn(`[PluginLoader] Framework.events.off failed for ${eventName}`, error);
                }
            }
            sandboxFrameworkEventSubscriptions.delete(eventName);
        }
    }
    
    function handleFrameworkEmitEvent(payload) {
        const { eventName, eventData } = payload || {};
        if (!eventName) return;
        
        if (window.Framework && window.Framework.events && typeof window.Framework.events.emit === 'function') {
            window.Framework.events.emit(eventName, eventData);
        }
    }
    
    function handleFrameworkEmitAsyncEvent(payload) {
        const { eventName, eventData } = payload || {};
        if (!eventName) return;
        
        if (window.Framework && window.Framework.events && typeof window.Framework.events.emitAsync === 'function') {
            window.Framework.events.emitAsync(eventName, eventData);
        } else if (window.Framework && window.Framework.events && typeof window.Framework.events.emit === 'function') {
            window.Framework.events.emit(eventName, eventData);
        }
    }
    
    function dispatchFrameworkEventToSandbox(eventName, eventData) {
        const bucket = sandboxFrameworkEventSubscriptions.get(eventName);
        if (!bucket || bucket.listeners.size === 0) return;
        if (!sandboxWindow) return;
        
        try {
            sandboxWindow.postMessage({
                type: 'FRAMEWORK_EVENT_DISPATCH',
                payload: { eventName, eventData }
            }, '*');
        } catch (error) {
            console.warn(`[PluginLoader] Failed to dispatch Framework event to sandbox: ${eventName}`, error);
        }
    }
    
    function handleFrameworkAddLoadingIndicator(payload) {
        const { requestId } = payload || {};
        if (!requestId) return;
        
        try {
            if (!window.Framework || typeof window.Framework.addLoadingIndicator !== 'function') {
                throw new Error('Framework.addLoadingIndicator not available');
            }
            const loadingId = window.Framework.addLoadingIndicator();
            sendStoreResult(requestId, true, loadingId);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    function handleFrameworkAttachLoadingIndicator(payload) {
        const { requestId, loadingId, messageId } = payload || {};
        if (!requestId) return;
        
        try {
            if (!window.Framework || typeof window.Framework.attachLoadingIndicatorToMessage !== 'function') {
                throw new Error('Framework.attachLoadingIndicatorToMessage not available');
            }
            const ok = window.Framework.attachLoadingIndicatorToMessage(loadingId, messageId);
            sendStoreResult(requestId, true, ok);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    function handleFrameworkStorageGetItem(payload) {
        const { requestId, key, defaultValue } = payload || {};
        if (!requestId) return;
        
        try {
            let value = defaultValue;
            
            if (window.Framework && window.Framework.storage && typeof window.Framework.storage.getItem === 'function') {
                value = window.Framework.storage.getItem(key, defaultValue);
            } else {
                const raw = localStorage.getItem(key);
                if (raw != null) {
                    try {
                        value = JSON.parse(raw);
                    } catch (e) {
                        value = raw;
                    }
                }
                if (raw == null) value = defaultValue;
            }
            
            sendStoreResult(requestId, true, value);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }
    
    function handleFrameworkStorageSetItem(payload) {
        const { requestId, key, value } = payload || {};
        if (!requestId) return;
        
        try {
            if (window.Framework && window.Framework.storage && typeof window.Framework.storage.setItem === 'function') {
                window.Framework.storage.setItem(key, value);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
            sendStoreResult(requestId, true);
        } catch (error) {
            sendStoreResult(requestId, false, null, error.message);
        }
    }

    function handleRegisterChannel(payload) {
        const { id, pluginId, definition } = payload;
        // Use the actual pluginId sent from sandbox
        const actualPluginId = pluginId || (definition.source ? definition.source.split(':')[1] : 'unknown');

        // Create a proxy adapter that communicates with the sandbox
        const proxyAdapter = {
            call: (messages, config, onUpdate, signal) => {
                return sendSandboxRequest('CHANNEL_CALL', {
                    pluginId: actualPluginId,
                    messages,
                    config
                }, onUpdate, signal);
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

    function sendSandboxRequest(type, data, onUpdate, signal) {
        return new Promise((resolve, reject) => {
            const requestId = ++requestCounter;

            const requestRecord = { resolve, reject, onUpdate, signal: null, abortHandler: null };
            pendingRequests.set(requestId, requestRecord);

            // Bridge AbortSignal from 主线程到沙箱（外部渠道也能响应“停止生成”）
            if (signal && typeof signal.addEventListener === 'function') {
                if (signal.aborted) {
                    pendingRequests.delete(requestId);
                    const abortError = new Error('Request aborted');
                    abortError.name = 'AbortError';
                    reject(abortError);
                    return;
                }

                requestRecord.signal = signal;
                requestRecord.abortHandler = () => {
                    try {
                        if (sandboxWindow) {
                            sandboxWindow.postMessage({
                                type: 'CHANNEL_ABORT',
                                payload: { requestId }
                            }, '*');
                        }
                    } catch (e) {
                        // ignore
                    }

                    if (!pendingRequests.has(requestId)) return;
                    pendingRequests.delete(requestId);

                    const abortError = new Error('Request aborted');
                    abortError.name = 'AbortError';
                    reject(abortError);
                };

                try {
                    signal.addEventListener('abort', requestRecord.abortHandler, { once: true });
                } catch (e) {
                    // ignore
                }
            }

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
                const pending = pendingRequests.get(requestId);
                pendingRequests.delete(requestId);

                if (pending && pending.signal && pending.abortHandler && typeof pending.signal.removeEventListener === 'function') {
                    try {
                        pending.signal.removeEventListener('abort', pending.abortHandler);
                    } catch (e) {
                        // ignore
                    }
                }

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

            if (req.signal && req.abortHandler && typeof req.signal.removeEventListener === 'function') {
                try {
                    req.signal.removeEventListener('abort', req.abortHandler);
                } catch (e) {
                    // ignore
                }
            }

            // CHANNEL_FETCH_MODELS_RESULT returns 'models', CHANNEL_CALL_RESULT returns 'result'
            req.resolve(result || models);
        }
    }

    function handleRequestError(payload) {
        const { requestId, error } = payload;
        const req = pendingRequests.get(requestId);
        if (req) {
            pendingRequests.delete(requestId);

            if (req.signal && req.abortHandler && typeof req.signal.removeEventListener === 'function') {
                try {
                    req.signal.removeEventListener('abort', req.abortHandler);
                } catch (e) {
                    // ignore
                }
            }

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