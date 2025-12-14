/**
 * Sandbox Loader
 * 在沙箱 iframe 中运行插件代码
 */
(function() {
    const plugins = new Map(); // id -> { instance, cleanup, adapter, uiPlugins }
    let currentExecutingPluginId = null; // 跟踪当前正在执行的插件 ID
    let networkLoggerInstalled = false;
    let sandboxReady = false;
    
    // UI 插件注册表：pluginId -> Map<slotName, Map<componentId, { render, init, destroy }>>
    const uiPluginRegistry = new Map();
    
    // 可用插槽常量（从主线程同步获取，避免重复定义）
    let SLOTS = {};
    
    // Store 请求计数器和待处理请求
    let storeRequestCounter = 0;
    const pendingStoreRequests = new Map(); // requestId -> { resolve, reject }
    
    // 渠道请求中断（Abort）控制器：requestId -> AbortController
    const pendingChannelCalls = new Map();
    const abortedChannelCalls = new Set();
    
    // 活动点击上下文：用于异步操作期间保持 pluginId
    let activeClickPluginId = null;
    let activeClickPluginIdTimeout = null;
    
    // 事件监听器注册表：eventName -> Set<{ pluginId, callback, listenerId }>
    const eventListeners = new Map();
    let eventListenerId = 0;

    // Bundle 注册表：bundleKey -> entries / destroy
    let bundleAutoComponentIdCounter = 0;
    const bundleComponents = new Map(); // `${pluginId}:${bundleId}` -> Array<{ slotName, componentId }>
    const bundleDestroyFunctions = new Map(); // `${pluginId}:${bundleId}` -> Function

    // Framework events 监听器注册表：eventName -> Set<{ pluginId, callback, listenerId }>
    const frameworkEventListeners = new Map();
    let frameworkEventListenerId = 0;

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
        },
        
        /**
         * Store 代理 - 访问主线程的数据存储
         */
        store: {
            /**
             * 异步获取完整状态
             * @returns {Promise<Object>}
             */
            getState() {
                return sendStoreRequest('STORE_GET_STATE', {});
            },
            
            /**
             * 异步获取当前活动会话
             * @returns {Promise<Object|null>}
             */
            getActiveConversation() {
                return sendStoreRequest('STORE_GET_ACTIVE_CONVERSATION', {});
            },
            
            /**
             * 异步获取指定会话
             * @param {string} conversationId
             * @returns {Promise<Object|null>}
             */
            getConversation(conversationId) {
                return sendStoreRequest('STORE_GET_CONVERSATION', { conversationId });
            },
            
            /**
             * 异步更新会话元数据
             * @param {string} conversationId
             * @param {Object} metadata - 要合并的元数据对象
             * @returns {Promise<void>}
             */
            updateConversationMetadata(conversationId, metadata) {
                return sendStoreRequest('STORE_UPDATE_METADATA', { conversationId, metadata });
            },
            
            /**
             * 触发状态持久化
             * @returns {Promise<void>}
             */
            persist() {
                return sendStoreRequest('STORE_PERSIST', {});
            },
            
            /**
             * 事件监听
             */
            events: {
                /**
                 * 订阅事件
                 * @param {string} eventName
                 * @param {Function} callback
                 * @returns {Function} 取消订阅函数
                 */
                on(eventName, callback) {
                    const pluginId = currentExecutingPluginId;
                    const listenerId = `listener-${++eventListenerId}`;
                    
                    if (!eventListeners.has(eventName)) {
                        eventListeners.set(eventName, new Set());
                    }
                    
                    const listenerInfo = { pluginId, callback, listenerId };
                    eventListeners.get(eventName).add(listenerInfo);
                    
                    // 通知主线程订阅事件
                    window.parent.postMessage({
                        type: 'STORE_SUBSCRIBE_EVENT',
                        payload: { eventName, listenerId, pluginId }
                    }, '*');
                    
                    // 返回取消订阅函数
                    return () => {
                        IdoFront.store.events.off(eventName, callback);
                    };
                },
                
                /**
                 * 取消订阅事件
                 * @param {string} eventName
                 * @param {Function} callback
                 */
                off(eventName, callback) {
                    const listeners = eventListeners.get(eventName);
                    if (!listeners) return;
                    
                    for (const info of listeners) {
                        if (info.callback === callback) {
                            listeners.delete(info);
                            
                            // 通知主线程取消订阅
                            window.parent.postMessage({
                                type: 'STORE_UNSUBSCRIBE_EVENT',
                                payload: { eventName, listenerId: info.listenerId }
                            }, '*');
                            break;
                        }
                    }
                    
                    // 如果没有监听器了，清理 Map
                    if (listeners.size === 0) {
                        eventListeners.delete(eventName);
                    }
                }
            }
        },
        
        /**
         * Storage 代理 - 访问主线程的配置存储
         */
        storage: {
            /**
             * 异步获取配置项
             * @param {string} key
             * @returns {Promise<any>}
             */
            getItem(key) {
                return sendStoreRequest('STORAGE_GET_ITEM', { key });
            },
            
            /**
             * 异步设置配置项
             * @param {string} key
             * @param {any} value
             * @returns {Promise<void>}
             */
            setItem(key, value) {
                return sendStoreRequest('STORAGE_SET_ITEM', { key, value });
            },
            
            /**
             * 异步删除配置项
             * @param {string} key
             * @returns {Promise<void>}
             */
            removeItem(key) {
                return sendStoreRequest('STORAGE_REMOVE_ITEM', { key });
            }
        }
    };
    
    /**
     * 发送 Store 请求到主线程
     * @param {string} type - 请求类型
     * @param {Object} data - 请求数据
     * @returns {Promise<any>}
     */
    function sendStoreRequest(type, data) {
        return new Promise((resolve, reject) => {
            const requestId = `store-${++storeRequestCounter}`;
            pendingStoreRequests.set(requestId, { resolve, reject });
            
            window.parent.postMessage({
                type,
                payload: {
                    requestId,
                    ...data
                }
            }, '*');
            
            // 超时处理（10秒）
            setTimeout(() => {
                if (pendingStoreRequests.has(requestId)) {
                    pendingStoreRequests.delete(requestId);
                    reject(new Error(`Store request timeout: ${type}`));
                }
            }, 10000);
        });
    }
    
    /**
     * 处理 Store 请求结果
     */
    function handleStoreResult(payload) {
        const { requestId, success, result, error } = payload;
        
        const pending = pendingStoreRequests.get(requestId);
        if (pending) {
            pendingStoreRequests.delete(requestId);
            if (success) {
                pending.resolve(result);
            } else {
                pending.reject(new Error(error || 'Store request failed'));
            }
        }
    }
    
    /**
     * 处理从主线程转发的事件
     */
    function handleStoreEvent(payload) {
        const { eventName, eventData } = payload;
        
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

    /**
     * 处理从主线程转发的 Framework events 事件
     */
    function handleFrameworkEvent(payload) {
        const { eventName, eventData } = payload;

        const listeners = frameworkEventListeners.get(eventName);
        if (!listeners) return;

        for (const info of listeners) {
            const prevPluginId = currentExecutingPluginId;
            if (info && info.pluginId) {
                currentExecutingPluginId = info.pluginId;
            }

            try {
                info.callback(eventData);
            } catch (error) {
                console.error(`[Sandbox] Framework event handler error for ${eventName}:`, error);
            } finally {
                currentExecutingPluginId = prevPluginId;
            }
        }
    }
    
    function createBundleKey(pluginId, bundleId) {
        return `${pluginId}:${bundleId}`;
    }

    function sanitizeIdPart(value) {
        return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
    }

    function createAutoBundleComponentId(pluginId, bundleId, slotName, index) {
        const safePluginId = sanitizeIdPart(pluginId);
        const safeBundleId = sanitizeIdPart(bundleId);
        const safeSlotName = sanitizeIdPart(slotName);
        bundleAutoComponentIdCounter += 1;
        return `${safePluginId}__${safeBundleId}__${safeSlotName}__${index}__${bundleAutoComponentIdCounter}`;
    }

    function registerBundleUIRenderer(pluginId, slotName, componentId, renderFn, meta) {
        if (!uiPluginRegistry.has(pluginId)) {
            uiPluginRegistry.set(pluginId, new Map());
        }
        const pluginSlots = uiPluginRegistry.get(pluginId);

        if (!pluginSlots.has(slotName)) {
            pluginSlots.set(slotName, new Map());
        }
        const slotComponents = pluginSlots.get(slotName);

        slotComponents.set(componentId, {
            render: renderFn,
            init: null,
            destroy: null,
            meta: meta || {}
        });
    }

    /**
     * Sandbox Framework Proxy
     * - 这里不是主线程的框架实现（主线程在 edge-extension/scripts/framework.js）
     * - 目的：为外部插件提供同名 API，并在必要时（render/callback）在沙箱内保存函数，再通过消息与主线程协作渲染/交互
     */
    const Framework = {
        // SLOTS 通过 getter 访问，确保获取到从主线程同步的值
        get SLOTS() { return SLOTS; },
        
        /**
         * 注册 UI 插件
         * @param {string} slotName - 插槽名称
         * @param {string} componentId - 组件 ID
         * @param {Object|Function} definition - 插件定义
         */
        registerPlugin(slotName, componentId, definition) {
            const pluginId = currentExecutingPluginId;
            if (!pluginId) {
                console.warn('[Sandbox] registerPlugin called outside plugin execution context');
                return;
            }
            
            // 确保插件的 UI 注册表存在
            if (!uiPluginRegistry.has(pluginId)) {
                uiPluginRegistry.set(pluginId, new Map());
            }
            const pluginSlots = uiPluginRegistry.get(pluginId);
            
            if (!pluginSlots.has(slotName)) {
                pluginSlots.set(slotName, new Map());
            }
            const slotComponents = pluginSlots.get(slotName);
            
            // 规范化定义
            let normalizedDef;
            if (typeof definition === 'function') {
                normalizedDef = {
                    render: definition,
                    init: null,
                    destroy: null,
                    meta: {}
                };
            } else {
                normalizedDef = {
                    render: definition.render || definition.renderStatic || definition.renderer || null,
                    init: definition.init || null,
                    destroy: definition.destroy || null,
                    meta: definition.meta || {
                        name: definition.name || componentId,
                        description: definition.description || '',
                        version: definition.version || '',
                        icon: definition.icon || ''
                    }
                };
            }
            
            // 保存到本地注册表
            slotComponents.set(componentId, normalizedDef);
            
            // 调用 init（如果存在）
            if (typeof normalizedDef.init === 'function') {
                try {
                    normalizedDef.init(createFrameworkApiForPlugin(pluginId));
                } catch (e) {
                    console.error(`[Sandbox] Plugin ${pluginId}/${componentId} init error:`, e);
                }
            }
            
            // 通知主线程注册 UI 插件
            window.parent.postMessage({
                type: 'PLUGIN_REGISTER_UI',
                payload: {
                    pluginId,
                    slotName,
                    componentId,
                    meta: normalizedDef.meta
                }
            }, '*');
            
            console.log(`[Sandbox] UI plugin registered: ${pluginId}/${slotName}/${componentId}`);
        },
        
        /**
         * 注销 UI 插件
         */
        unregisterPlugin(slotName, componentId) {
            const pluginId = currentExecutingPluginId;
            if (!pluginId) return;
            
            const pluginSlots = uiPluginRegistry.get(pluginId);
            if (!pluginSlots) return;
            
            const slotComponents = pluginSlots.get(slotName);
            if (!slotComponents) return;
            
            const def = slotComponents.get(componentId);
            if (def && typeof def.destroy === 'function') {
                try {
                    def.destroy(createFrameworkApiForPlugin(pluginId));
                } catch (e) {
                    console.error(`[Sandbox] Plugin ${pluginId}/${componentId} destroy error:`, e);
                }
            }
            
            slotComponents.delete(componentId);
            
            // 通知主线程注销
            window.parent.postMessage({
                type: 'PLUGIN_UNREGISTER_UI',
                payload: {
                    pluginId,
                    slotName,
                    componentId
                }
            }, '*');
        },

        /**
         * 批量注册插件（Bundle）
         * - 沙箱侧保存 render 函数（可执行）
         * - 主线程侧复用 Framework.registerPluginBundle 完成真正注册
         */
        registerPluginBundle(bundleId, definition) {
            const pluginId = currentExecutingPluginId;
            if (!pluginId) {
                console.warn('[Sandbox] registerPluginBundle called outside plugin execution context');
                return;
            }

            if (!bundleId || !definition || !definition.slots) {
                console.warn('[Sandbox] registerPluginBundle: Invalid arguments', { bundleId, definition });
                return;
            }

            const meta = (definition.meta && typeof definition.meta === 'object') ? definition.meta : {};
            const bundleKey = createBundleKey(pluginId, bundleId);

            // init 由沙箱执行（插件逻辑）
            if (typeof definition.init === 'function') {
                try {
                    definition.init(createFrameworkApiForPlugin(pluginId));
                } catch (e) {
                    console.error(`[Sandbox] Bundle ${bundleId} init error:`, e);
                }
            }

            // destroy 保存起来，unregister 时由沙箱执行（插件逻辑）
            if (typeof definition.destroy === 'function') {
                bundleDestroyFunctions.set(bundleKey, definition.destroy);
            }

            const entries = [];
            const slotsKind = Array.isArray(definition.slots) ? 'array' : 'object';

            // 将 slots 转成“可序列化”的结构，并为每个条目生成确定的 componentId
            let slotsPayload;
            if (slotsKind === 'array') {
                slotsPayload = [];
                definition.slots.forEach((item, index) => {
                    if (!item || !item.slot) return;
                    if (typeof item.render !== 'function') return;

                    const slotName = item.slot;
                    const componentId = item.id || createAutoBundleComponentId(pluginId, bundleId, slotName, index);

                    registerBundleUIRenderer(pluginId, slotName, componentId, item.render, meta);
                    entries.push({ slotName, componentId });

                    slotsPayload.push({
                        slot: slotName,
                        id: componentId
                    });
                });
            } else {
                slotsPayload = {};
                Object.keys(definition.slots).forEach((slotName) => {
                    const slotDef = definition.slots[slotName];

                    // 单个 render 函数
                    if (typeof slotDef === 'function') {
                        const componentId = createAutoBundleComponentId(pluginId, bundleId, slotName, 0);
                        registerBundleUIRenderer(pluginId, slotName, componentId, slotDef, meta);
                        entries.push({ slotName, componentId });
                        slotsPayload[slotName] = { id: componentId };
                        return;
                    }

                    // 同一个 slot 注册多个组件
                    if (Array.isArray(slotDef)) {
                        const payloadArr = [];
                        slotDef.forEach((item, itemIndex) => {
                            if (typeof item === 'function') {
                                const componentId = createAutoBundleComponentId(pluginId, bundleId, slotName, itemIndex);
                                registerBundleUIRenderer(pluginId, slotName, componentId, item, meta);
                                entries.push({ slotName, componentId });
                                payloadArr.push({ id: componentId });
                                return;
                            }
                            if (item && typeof item.render === 'function') {
                                const componentId = item.id || createAutoBundleComponentId(pluginId, bundleId, slotName, itemIndex);
                                registerBundleUIRenderer(pluginId, slotName, componentId, item.render, meta);
                                entries.push({ slotName, componentId });
                                payloadArr.push({ id: componentId });
                            }
                        });
                        if (payloadArr.length > 0) {
                            slotsPayload[slotName] = payloadArr;
                        }
                        return;
                    }

                    // 对象形式：{ id?, render }
                    if (slotDef && typeof slotDef.render === 'function') {
                        const componentId = slotDef.id || createAutoBundleComponentId(pluginId, bundleId, slotName, 0);
                        registerBundleUIRenderer(pluginId, slotName, componentId, slotDef.render, meta);
                        entries.push({ slotName, componentId });
                        slotsPayload[slotName] = { id: componentId };
                    }
                });
            }

            bundleComponents.set(bundleKey, entries);

            window.parent.postMessage({
                type: 'FRAMEWORK_REGISTER_PLUGIN_BUNDLE',
                payload: {
                    pluginId,
                    bundleId,
                    meta,
                    slotsKind,
                    slots: slotsPayload
                }
            }, '*');

            console.log(`[Sandbox] Plugin bundle registered: ${pluginId}/${bundleId} (${entries.length} components)`);
        },

        /**
         * 注销插件包（Bundle）
         */
        unregisterPluginBundle(bundleId) {
            const pluginId = currentExecutingPluginId;
            if (!pluginId) return;

            const bundleKey = createBundleKey(pluginId, bundleId);

            // destroy 由沙箱执行（插件逻辑）
            const destroyFn = bundleDestroyFunctions.get(bundleKey);
            if (typeof destroyFn === 'function') {
                try {
                    destroyFn(createFrameworkApiForPlugin(pluginId));
                } catch (e) {
                    console.error(`[Sandbox] Bundle ${bundleId} destroy error:`, e);
                }
            }
            bundleDestroyFunctions.delete(bundleKey);

            // 清理本地 renderer 注册表
            const entries = bundleComponents.get(bundleKey) || [];
            bundleComponents.delete(bundleKey);

            const pluginSlots = uiPluginRegistry.get(pluginId);
            if (pluginSlots) {
                entries.forEach(({ slotName, componentId }) => {
                    const slotComponents = pluginSlots.get(slotName);
                    if (!slotComponents) return;
                    slotComponents.delete(componentId);
                    if (slotComponents.size === 0) {
                        pluginSlots.delete(slotName);
                    }
                });

                if (pluginSlots.size === 0) {
                    uiPluginRegistry.delete(pluginId);
                }
            }

            // 通知主线程注销（主线程复用 Framework.unregisterPluginBundle）
            window.parent.postMessage({
                type: 'FRAMEWORK_UNREGISTER_PLUGIN_BUNDLE',
                payload: { pluginId, bundleId }
            }, '*');
        },
        
        // UI 工具函数
        ui: {
            /**
             * 创建图标按钮（在沙箱中生成 HTML）
             */
            createIconButton(options = {}) {
                const {
                    label,
                    icon,
                    title,
                    className = '',
                    iconClassName = 'material-symbols-outlined text-[18px]',
                    onClick
                } = options;
                
                const btn = document.createElement('button');
                if (className) btn.className = className;
                if (title) btn.title = title;
                
                if (icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.className = iconClassName;
                    iconSpan.textContent = icon;
                    btn.appendChild(iconSpan);
                }
                
                if (label) {
                    const labelSpan = document.createElement('span');
                    labelSpan.textContent = label;
                    btn.appendChild(labelSpan);
                }
                
                // onClick 需要通过消息机制回调
                if (typeof onClick === 'function') {
                    btn.dataset.hasClickHandler = 'true';
                    btn._sandboxClickHandler = onClick;
                }
                
                return btn;
            }
        },
        
        // 消息操作（代理到主线程）
        addMessage(role, content, options) {
            window.parent.postMessage({
                type: 'FRAMEWORK_ADD_MESSAGE',
                payload: { role, content, options }
            }, '*');
        },
        
        updateLastMessage(content) {
            window.parent.postMessage({
                type: 'FRAMEWORK_UPDATE_LAST_MESSAGE',
                payload: { content }
            }, '*');
        },
        
        clearMessages() {
            window.parent.postMessage({
                type: 'FRAMEWORK_CLEAR_MESSAGES',
                payload: {}
            }, '*');
        },
        
        // 面板操作
        togglePanel(side, force) {
            window.parent.postMessage({
                type: 'FRAMEWORK_TOGGLE_PANEL',
                payload: { side, force }
            }, '*');
        },
        
        setMode(mode, renderers) {
            // 注意：renderers 中的函数无法直接传递，需要特殊处理
            console.warn('[Sandbox] setMode with renderers is not fully supported in sandbox');
            window.parent.postMessage({
                type: 'FRAMEWORK_SET_MODE',
                payload: { mode }
            }, '*');
        },

        /**
         * 显示底部抽屉（BottomSheet）
         * - 沙箱侧执行 renderer，产出 HTML + clickHandlers
         * - 主线程侧复用 Framework.showBottomSheet 完成展示
         */
        showBottomSheet(renderer) {
            // 优先使用 currentExecutingPluginId，其次使用 activeClickPluginId（异步操作上下文）
            const pluginId = currentExecutingPluginId || activeClickPluginId;
            if (!pluginId) {
                console.warn('[Sandbox] showBottomSheet called outside plugin execution context');
                return;
            }

            const container = document.createElement('div');
            let result;
            try {
                if (typeof renderer === 'function') {
                    result = renderer(container);
                }
            } catch (e) {
                console.error('[Sandbox] showBottomSheet renderer error:', e);
            }

            if (result instanceof HTMLElement) {
                container.appendChild(result);
            } else if (typeof result === 'string') {
                container.insertAdjacentHTML('beforeend', result);
            }

            const clickHandlers = [];
            collectClickHandlers(container, clickHandlers, `${pluginId}:bottom-sheet`);

            window.parent.postMessage({
                type: 'FRAMEWORK_SHOW_BOTTOM_SHEET',
                payload: {
                    pluginId,
                    html: container.innerHTML,
                    clickHandlers: clickHandlers.map(h => ({
                        handlerId: h.handlerId,
                        selector: h.selector
                    }))
                }
            }, '*');
        },

        /**
         * 隐藏底部抽屉（BottomSheet）
         */
        hideBottomSheet() {
            window.parent.postMessage({
                type: 'FRAMEWORK_HIDE_BOTTOM_SHEET',
                payload: {}
            }, '*');
        },

        /**
         * 设置自定义面板（目前仅支持 right）
         * - 沙箱侧执行 renderer，产出 HTML + clickHandlers
         * - 主线程侧复用 Framework.setCustomPanel 完成展示
         */
        setCustomPanel(side, renderer) {
            // 优先使用 currentExecutingPluginId，其次使用 activeClickPluginId（异步操作上下文）
            const pluginId = currentExecutingPluginId || activeClickPluginId;
            if (!pluginId) {
                console.warn('[Sandbox] setCustomPanel called outside plugin execution context');
                return;
            }

            // 兼容内部框架签名：renderer 为空表示恢复默认面板
            if (!renderer) {
                Framework.restoreDefaultRightPanel();
                return;
            }

            const container = document.createElement('div');
            let result;
            try {
                if (typeof renderer === 'function') {
                    result = renderer(container);
                }
            } catch (e) {
                console.error('[Sandbox] setCustomPanel renderer error:', e);
            }

            if (result instanceof HTMLElement) {
                container.appendChild(result);
            } else if (typeof result === 'string') {
                container.insertAdjacentHTML('beforeend', result);
            }

            const clickHandlers = [];
            collectClickHandlers(container, clickHandlers, `${pluginId}:panel:${side || 'right'}`);

            window.parent.postMessage({
                type: 'FRAMEWORK_SET_CUSTOM_PANEL',
                payload: {
                    pluginId,
                    side,
                    html: container.innerHTML,
                    clickHandlers: clickHandlers.map(h => ({
                        handlerId: h.handlerId,
                        selector: h.selector
                    }))
                }
            }, '*');
        },

        /**
         * 恢复默认右侧面板
         */
        restoreDefaultRightPanel() {
            window.parent.postMessage({
                type: 'FRAMEWORK_RESTORE_DEFAULT_RIGHT_PANEL',
                payload: {}
            }, '*');
        },

        /**
         * 完成流式消息（解析 Markdown/清理 loading 等）
         */
        finalizeStreamingMessage() {
            window.parent.postMessage({
                type: 'FRAMEWORK_FINALIZE_STREAMING_MESSAGE',
                payload: {}
            }, '*');
        },

        /**
         * 批量渲染所有待 Markdown 解析的元素（历史消息加载后常用）
         */
        renderAllPendingMarkdown() {
            window.parent.postMessage({
                type: 'FRAMEWORK_RENDER_ALL_PENDING_MARKDOWN',
                payload: {}
            }, '*');
        },

        /**
         * 刷新指定插槽
         * 优化：同时执行本地渲染并推送结果，无需等待主线程请求
         *
         * 注意：我们只推送 UI_PUSH_UPDATE，不再通知主线程调用 Framework.refreshSlot。
         * 原因：主线程的 refreshSlot 会清空整个插槽并重新渲染所有插件，
         * 这会导致外部插件的容器被重新创建，从而触发新的异步渲染请求。
         * 而 UI_PUSH_UPDATE 已经直接更新了外部插件的 DOM，不需要额外刷新。
         */
        refreshSlot(slotName) {
            // 遍历所有注册的外部插件，推送该插槽的渲染结果
            // 这样即使在异步回调中（没有 currentExecutingPluginId）也能正确工作
            for (const [pluginId, pluginSlots] of uiPluginRegistry.entries()) {
                const slotComponents = pluginSlots.get(slotName);
                if (!slotComponents) continue;
                
                slotComponents.forEach((def, componentId) => {
                    if (typeof def.render !== 'function') return;
                    
                    try {
                        const result = def.render(createFrameworkApiForPlugin(pluginId));
                        let html = '';
                        const clickHandlers = [];
                        
                        if (result instanceof HTMLElement) {
                            collectClickHandlers(result, clickHandlers, `${pluginId}:${componentId}`);
                            html = result.outerHTML;
                        } else if (typeof result === 'string') {
                            html = result;
                        }
                        
                        // 推送渲染结果，直接更新主线程的 DOM
                        window.parent.postMessage({
                            type: 'UI_PUSH_UPDATE',
                            payload: {
                                pluginId,
                                slotName,
                                componentId,
                                html,
                                clickHandlers: clickHandlers.map(h => ({
                                    handlerId: h.handlerId,
                                    selector: h.selector
                                }))
                            }
                        }, '*');
                    } catch (e) {
                        console.error('[Sandbox] refreshSlot render error:', e);
                    }
                });
            }
            
            // 不再通知主线程调用 Framework.refreshSlot
            // UI_PUSH_UPDATE 已经直接更新了外部插件的 DOM
        },

        /**
         * 添加 loading 气泡（沙箱返回 Promise<string>）
         */
        addLoadingIndicator() {
            return sendStoreRequest('FRAMEWORK_ADD_LOADING_INDICATOR', {});
        },

        /**
         * 移除 loading 气泡
         */
        removeLoadingIndicator(loadingId) {
            window.parent.postMessage({
                type: 'FRAMEWORK_REMOVE_LOADING_INDICATOR',
                payload: { loadingId }
            }, '*');
        },

        /**
         * 将 loading 指示器附着到消息下方
         * @returns {Promise<boolean>}
         */
        attachLoadingIndicatorToMessage(loadingId, messageId) {
            return sendStoreRequest('FRAMEWORK_ATTACH_LOADING_INDICATOR', { loadingId, messageId });
        },

        /**
         * 移除消息下方的 streaming 指示器
         */
        removeMessageStreamingIndicator(messageId) {
            window.parent.postMessage({
                type: 'FRAMEWORK_REMOVE_MESSAGE_STREAMING_INDICATOR',
                payload: { messageId }
            }, '*');
        },

        /**
         * 设置发送按钮 loading 状态
         */
        setSendButtonLoading(isLoading) {
            window.parent.postMessage({
                type: 'FRAMEWORK_SET_SEND_BUTTON_LOADING',
                payload: { isLoading: !!isLoading }
            }, '*');
        },

        /**
         * Framework events（沙箱代理）
         */
        events: {
            on(eventName, callback) {
                const pluginId = currentExecutingPluginId;
                if (!pluginId) {
                    console.warn('[Sandbox] Framework.events.on called outside plugin execution context');
                    return () => {};
                }

                const listenerId = `fw-${++frameworkEventListenerId}`;

                if (!frameworkEventListeners.has(eventName)) {
                    frameworkEventListeners.set(eventName, new Set());
                }

                const info = { pluginId, callback, listenerId };
                frameworkEventListeners.get(eventName).add(info);

                window.parent.postMessage({
                    type: 'FRAMEWORK_SUBSCRIBE_EVENT',
                    payload: { eventName, listenerId, pluginId }
                }, '*');

                return () => {
                    Framework.events.off(eventName, callback);
                };
            },

            off(eventName, callback) {
                const listeners = frameworkEventListeners.get(eventName);
                if (!listeners) return;

                for (const info of listeners) {
                    if (info.callback === callback) {
                        listeners.delete(info);

                        window.parent.postMessage({
                            type: 'FRAMEWORK_UNSUBSCRIBE_EVENT',
                            payload: { eventName, listenerId: info.listenerId }
                        }, '*');
                        break;
                    }
                }

                if (listeners.size === 0) {
                    frameworkEventListeners.delete(eventName);
                }
            },

            emit(eventName, eventData) {
                window.parent.postMessage({
                    type: 'FRAMEWORK_EMIT_EVENT',
                    payload: { eventName, eventData }
                }, '*');
            },

            emitAsync(eventName, eventData) {
                window.parent.postMessage({
                    type: 'FRAMEWORK_EMIT_ASYNC_EVENT',
                    payload: { eventName, eventData }
                }, '*');
            }
        },

        /**
         * Framework.storage（沙箱代理，异步）
         */
        storage: {
            getItem(key, defaultValue) {
                return sendStoreRequest('FRAMEWORK_STORAGE_GET_ITEM', { key, defaultValue });
            },
            setItem(key, value) {
                return sendStoreRequest('FRAMEWORK_STORAGE_SET_ITEM', { key, value });
            }
        },
        
        getCurrentMode() {
            // 同步获取不可行，返回 null
            console.warn('[Sandbox] getCurrentMode is not supported in sandbox, use async message');
            return null;
        }
    };
    
    /**
     * 为插件创建 Framework API 上下文
     */
    function createFrameworkApiForPlugin(pluginId) {
        return {
            ...Framework,
            pluginId
        };
    }

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
            case 'SANDBOX_INIT':
                // 从主线程接收初始化配置（包括 SLOTS）
                if (payload && payload.SLOTS) {
                    SLOTS = payload.SLOTS;
                }
                sandboxReady = true;
                console.log('[Sandbox] Initialized with SLOTS:', Object.keys(SLOTS));
                // 通知主线程沙箱已就绪
                window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
                break;
            case 'EXECUTE_PLUGIN':
                executePlugin(payload.id, payload.code);
                break;
            case 'CHANNEL_CALL':
                handleChannelCall(payload);
                break;
            case 'CHANNEL_ABORT':
                handleChannelAbort(payload);
                break;
            case 'CHANNEL_FETCH_MODELS':
                handleFetchModels(payload);
                break;
            case 'UI_RENDER_REQUEST':
                handleUIRenderRequest(payload);
                break;
            case 'UI_CLICK_EVENT':
                handleUIClickEvent(payload);
                break;
            // Store 请求结果
            case 'STORE_REQUEST_RESULT':
                handleStoreResult(payload);
                break;
            // Store 事件转发
            case 'STORE_EVENT_DISPATCH':
                handleStoreEvent(payload);
                break;
            // Framework events 事件转发
            case 'FRAMEWORK_EVENT_DISPATCH':
                handleFrameworkEvent(payload);
                break;
        }
    });
    
    // 通知主线程沙箱脚本已加载，请求初始化配置
    window.parent.postMessage({ type: 'SANDBOX_LOADED' }, '*');

    function executePlugin(id, code) {
        try {
            // 确保网络日志拦截器已安装
            if (!networkLoggerInstalled) {
                installNetworkLogger();
                networkLoggerInstalled = true;
            }
            
            // 在沙箱中可以安全使用 new Function / eval
            // 注入模拟的 window.IdoFront 和 window.Framework
            const runner = new Function('window', 'IdoFront', 'Framework', code);
            
            // 创建插件实例容器
            plugins.set(id, { uiPlugins: new Map() });
            
            // 设置当前执行的插件 ID
            currentExecutingPluginId = id;
            
            // 执行插件
            // 注意：我们需要拦截 window.IdoFront 和 window.Framework 的访问
            const sandboxWindow = new Proxy(window, {
                get(target, prop) {
                    if (prop === 'IdoFront') return IdoFront;
                    if (prop === 'Framework') return Framework;
                    return target[prop];
                }
            });
            
            runner(sandboxWindow, IdoFront, Framework);
            
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
    
    /**
     * 处理 UI 渲染请求
     * 主线程请求沙箱执行渲染函数并返回 HTML
     */
    function handleUIRenderRequest(payload) {
        const { requestId, pluginId, slotName, componentId, context } = payload;
        
        try {
            const pluginSlots = uiPluginRegistry.get(pluginId);
            if (!pluginSlots) {
                throw new Error(`Plugin ${pluginId} not found`);
            }
            
            const slotComponents = pluginSlots.get(slotName);
            if (!slotComponents) {
                throw new Error(`Slot ${slotName} not found for plugin ${pluginId}`);
            }
            
            const def = slotComponents.get(componentId);
            if (!def || typeof def.render !== 'function') {
                throw new Error(`Component ${componentId} not found or has no render function`);
            }
            
            // 执行渲染函数
            const frameworkApi = createFrameworkApiForPlugin(pluginId);
            const renderContext = (context && typeof context === 'object')
                ? Object.assign({}, frameworkApi, context)
                : frameworkApi;
            const result = def.render(renderContext);
            
            // 将结果序列化为 HTML
            let html = '';
            let clickHandlers = [];
            
            if (result instanceof HTMLElement) {
                // 收集点击处理器
                collectClickHandlers(result, clickHandlers, `${pluginId}:${componentId}`);
                html = result.outerHTML;
            } else if (typeof result === 'string') {
                html = result;
            }
            
            window.parent.postMessage({
                type: 'UI_RENDER_RESULT',
                payload: {
                    requestId,
                    success: true,
                    html,
                    clickHandlers: clickHandlers.map(h => ({
                        handlerId: h.handlerId,
                        selector: h.selector
                    }))
                }
            }, '*');
        } catch (error) {
            console.error('[Sandbox] UI render error:', error);
            window.parent.postMessage({
                type: 'UI_RENDER_RESULT',
                payload: {
                    requestId,
                    success: false,
                    error: error.message
                }
            }, '*');
        }
    }
    
    // 点击处理器存储：handlerId -> { handler, pluginId }
    const clickHandlerRegistry = new Map();
    let handlerIdCounter = 0;
    
    /**
     * 收集元素中的点击处理器
     * @param {HTMLElement} element - 要扫描的元素
     * @param {Array} handlers - 处理器信息数组
     * @param {string} prefix - 前缀，格式为 pluginId:componentId
     */
    function collectClickHandlers(element, handlers, prefix) {
        if (element.dataset && element.dataset.hasClickHandler === 'true' && element._sandboxClickHandler) {
            const handlerId = `${prefix}:${++handlerIdCounter}`;
            // 从 prefix 提取 pluginId（第一个冒号前的部分）
            const pluginId = (typeof prefix === 'string' && prefix.includes(':'))
                ? prefix.split(':')[0]
                : prefix;
            
            clickHandlerRegistry.set(handlerId, {
                handler: element._sandboxClickHandler,
                pluginId: pluginId
            });
            element.dataset.clickHandlerId = handlerId;
            handlers.push({
                handlerId,
                selector: `[data-click-handler-id="${handlerId}"]`
            });
        }
        
        // 递归处理子元素
        if (element.children) {
            Array.from(element.children).forEach(child => {
                collectClickHandlers(child, handlers, prefix);
            });
        }
    }
    
    /**
     * 处理来自主线程的点击事件
     */
    function handleUIClickEvent(payload) {
        const { handlerId, eventData } = payload;
        
        const entry = clickHandlerRegistry.get(handlerId);
        if (!entry) {
            console.warn('[Sandbox] Click handler not found:', handlerId);
            return;
        }
        
        const { handler, pluginId } = entry;
        if (typeof handler !== 'function') {
            console.warn('[Sandbox] Click handler is not a function:', handlerId);
            return;
        }
        
        const prevPluginId = currentExecutingPluginId;
        const targetPluginId = pluginId || null;

        if (targetPluginId) {
            currentExecutingPluginId = targetPluginId;
            
            // 设置活动点击上下文，用于异步操作期间保持 pluginId
            // 清除之前的超时
            if (activeClickPluginIdTimeout) {
                clearTimeout(activeClickPluginIdTimeout);
                activeClickPluginIdTimeout = null;
            }
            activeClickPluginId = targetPluginId;
            
            // 30 秒后清除活动上下文（足够长以覆盖大多数异步操作）
            activeClickPluginIdTimeout = setTimeout(() => {
                if (activeClickPluginId === targetPluginId) {
                    activeClickPluginId = null;
                }
                activeClickPluginIdTimeout = null;
            }, 30000);
        }

        try {
            handler(eventData);
        } catch (error) {
            console.error('[Sandbox] Click handler error:', error);
        } finally {
            // 立即恢复 currentExecutingPluginId（同步代码）
            // 但 activeClickPluginId 保持有效，供异步代码使用
            currentExecutingPluginId = prevPluginId;
        }
    }

    function handleChannelAbort(payload) {
        const requestId = payload && payload.requestId;
        if (!requestId) return;

        const controller = pendingChannelCalls.get(requestId);
        if (controller) {
            try {
                controller.abort();
            } catch (e) {
                // ignore
            }
            return;
        }

        // abort 先于 CHANNEL_CALL 到达时，记录下来，等 call 建立 controller 后立即 abort
        abortedChannelCalls.add(requestId);
    }

    async function handleChannelCall(payload) {
        const { requestId, pluginId, messages, config } = payload;
        const plugin = plugins.get(pluginId);
        
        console.log('[Sandbox] handleChannelCall', { pluginId, hasPlugin: !!plugin, hasAdapter: !!plugin?.adapter, allPlugins: Array.from(plugins.keys()) });
        
        if (!plugin || !plugin.adapter) {
            sendError(requestId, `Plugin adapter not found for ${pluginId}. Available plugins: ${Array.from(plugins.keys()).join(', ')}`);
            return;
        }

        const abortController = new AbortController();
        pendingChannelCalls.set(requestId, abortController);

        if (abortedChannelCalls.has(requestId)) {
            abortedChannelCalls.delete(requestId);
            try {
                abortController.abort();
            } catch (e) {
                // ignore
            }
        }

        try {
            const onUpdate = (data) => {
                window.parent.postMessage({
                    type: 'CHANNEL_STREAM_UPDATE',
                    payload: { requestId, data }
                }, '*');
            };

            const result = await plugin.adapter.call(messages, config, onUpdate, abortController.signal);
            
            window.parent.postMessage({
                type: 'CHANNEL_CALL_RESULT',
                payload: { requestId, result }
            }, '*');
        } catch (error) {
            const message = (error && typeof error.message === 'string') ? error.message : String(error);
            sendError(requestId, message);
        } finally {
            pendingChannelCalls.delete(requestId);
            abortedChannelCalls.delete(requestId);
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