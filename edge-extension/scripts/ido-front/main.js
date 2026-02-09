/**
 * IdoFront Main Entry 
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const store = window.IdoFront.store;
    let context = null; // Framework instance

    function getStartupFlags() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const rawRecovery = params.get('recovery') || params.get('safe') || '';
            const recoveryValue = String(rawRecovery).trim().toLowerCase();
            return {
                recoveryMode:
                    recoveryValue === '1' ||
                    recoveryValue === 'true' ||
                    recoveryValue === 'yes' ||
                    recoveryValue === 'on',
                mode: String(params.get('mode') || '').trim().toLowerCase()
            };
        } catch (e) {
            return { recoveryMode: false, mode: '' };
        }
    }

    /**
     * 初始化 IdoFront
     * @param {Object} frameworkInstance - Framework 实例
     * @returns {Promise<Object>} 对外暴露的 API
     */
    window.IdoFront.init = async function(frameworkInstance) {
        context = frameworkInstance;
        const startup = getStartupFlags();
        const isRecoveryMode = startup.recoveryMode;
        
        // 1. 初始化 Store（异步）
        await store.init();
        
        // 1.5 初始化工具注册中心
        const toolRegistry = window.IdoFront.toolRegistry;
        if (toolRegistry && toolRegistry.init) {
            toolRegistry.init();
        }
        
        // 2. 初始化各功能模块
        const conversationActions = window.IdoFront.conversationActions;
        const messageActions = window.IdoFront.messageActions;
        const modelSelector = window.IdoFront.modelSelector;
        const fileUpload = window.IdoFront.fileUpload;
        const corePlugins = window.IdoFront.corePlugins;
        const settingsManager = window.IdoFront.settingsManager;
        const pluginLoader = window.IdoFront.pluginLoader;
        const titleGenerator = window.IdoFront.titleGenerator;
        const aiServiceSettings = window.IdoFront.aiServiceSettings;
        const performanceSettings = window.IdoFront.performanceSettings;
        const dataSettings = window.IdoFront.dataSettings;
        const mcpSettings = window.IdoFront.mcpSettings;

        if (conversationActions && conversationActions.init) {
            conversationActions.init(context, store);
        }

        if (messageActions && messageActions.init) {
            messageActions.init(context, store);
        }

        if (modelSelector && modelSelector.init) {
            modelSelector.init(context, store);
        }

        if (fileUpload && fileUpload.init) {
            fileUpload.init(context, store);
        }

        if (corePlugins && corePlugins.init) {
            corePlugins.init(context, store);
        }
 
        if (pluginLoader && pluginLoader.init) {
            if (!isRecoveryMode) {
                await pluginLoader.init(context, store);
            } else {
                console.warn('[main] Recovery mode: 跳过外部插件初始化');
            }
        }

        // 初始化 AI 服务模块
        if (titleGenerator && titleGenerator.init) {
            titleGenerator.init(store);
        }
        
        if (settingsManager && settingsManager.init) {
            settingsManager.init(context, store);
        }
        
        // 数据管理设置（在 settingsManager 之后初始化以注册标签页）
        if (dataSettings && dataSettings.init) {
            dataSettings.init(context, store);
        }
        
        // AI 服务设置需要在 settingsManager 之后初始化
        if (aiServiceSettings && aiServiceSettings.init) {
            aiServiceSettings.init(store, context);
        }

        // 性能设置（DOM 缓存开关）
        if (performanceSettings && performanceSettings.init) {
            performanceSettings.init(store, context);
        }
        
        // MCP 服务设置
        if (mcpSettings && mcpSettings.init) {
            mcpSettings.init(context, store);
        }

        // framework 在 IdoFront 初始化前就会触发一次 restore-state-from-url，
        // 因此这里主动再应用一次 URL 状态，确保 mode=settings 能生效。
        if (settingsManager && typeof settingsManager.applyUrlStateFromCurrentLocation === 'function') {
            settingsManager.applyUrlStateFromCurrentLocation();
        }

        // 3. 同步初始 UI
        if (conversationActions && conversationActions.syncUI) {
            const shouldSkipInitialSync = isRecoveryMode || startup.mode === 'settings';
            if (!shouldSkipInitialSync) {
                conversationActions.syncUI();
            } else {
                console.warn('[main] Skip initial conversation sync:', {
                    recovery: isRecoveryMode,
                    mode: startup.mode
                });
            }
        }

        console.log('IdoFront Core (Modular) Initialized');
        
        // 4. 返回对外 API
        return {
            // Store 作为唯一业务状态源对外暴露
            state: store.state,
            
            // 事件总线：外部（如 plugins.js）应订阅这里
            events: store.events,
            
            // Actions API
            actions: {
                sendMessage: messageActions ? messageActions.send : null,
                createConversation: conversationActions ? conversationActions.create : null,
                selectConversation: conversationActions ? conversationActions.select : null,
                deleteConversation: conversationActions ? conversationActions.delete : null,
                saveChannels: store.saveChannels,
                togglePlugin: corePlugins ? corePlugins.togglePlugin : null
            }
        };
    };

})();