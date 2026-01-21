/**
 * Core Plugins
 * 核心插件注册和管理
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.corePlugins = window.IdoFront.corePlugins || {};

    let context = null;
    let store = null;
    let conversationActions = null;
    let messageActions = null;

    // 支持其他模块在加载期注册“核心插件”（如 updater），并在 corePlugins.init 时统一初始化
    const corePluginRegistry = new Map(); // id -> plugin definition
    const corePluginInitialized = new Set(); // id

    function initCorePluginIfNeeded(id, pluginDef) {
        if (!id || corePluginInitialized.has(id)) return;
        if (!pluginDef || pluginDef.enabled === false) return;
        if (!context || !store) return;
        if (typeof pluginDef.init !== 'function') return;

        try {
            const ret = pluginDef.init(context, store);
            if (ret && typeof ret.then === 'function') {
                ret.catch((error) => {
                    console.warn(`[CorePlugins] core plugin init failed (async): ${id}`, error);
                });
            }
            corePluginInitialized.add(id);
        } catch (error) {
            console.warn(`[CorePlugins] core plugin init failed: ${id}`, error);
        }
    }

    function initRegisteredCorePlugins() {
        for (const [id, def] of corePluginRegistry.entries()) {
            initCorePluginIfNeeded(id, def);
        }
    }

    window.IdoFront.corePlugins.register = function(pluginDef) {
        if (!pluginDef || typeof pluginDef !== 'object') return false;
        const id = String(pluginDef.id || '').trim();
        if (!id) {
            console.warn('[CorePlugins] register() requires pluginDef.id');
            return false;
        }

        corePluginRegistry.set(id, pluginDef);

        // 如果 corePlugins 已完成 init，则立即初始化该插件
        initCorePluginIfNeeded(id, pluginDef);

        return true;
    };

    /**
     * 初始化核心插件
     */
    window.IdoFront.corePlugins.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        conversationActions = window.IdoFront.conversationActions;
        messageActions = window.IdoFront.messageActions;

        if (!context) return;

        // 覆盖 registerPlugin 以捕获 MESSAGE_MORE_ACTIONS
        setupMoreActionsRegistry();

        // 注册所有核心插件
        registerSidebarHeader();
        registerNewChatButton();
        registerPersonaSwitcher();
        registerModelSelector();
        registerHeaderActions();
        registerMessageActions();
        registerInputTools();
        
        // 恢复插件状态
        restorePluginStates();
        
        // 初始化网络日志面板作为右侧面板的默认底层内容
        if (window.IdoFront.networkLogPanel) {
            window.IdoFront.networkLogPanel.init(context, store);
            // 设置网络日志面板为默认右侧面板
            if (context.setDefaultRightPanel) {
                context.setDefaultRightPanel((container) => {
                    window.IdoFront.networkLogPanel.render(container);
                });
            }
        }
        
        // 安装网络日志拦截器
        if (window.IdoFront.networkLogger) {
            window.IdoFront.networkLogger.installInterceptor();
        }

        // 初始化通过 corePlugins.register 注册的核心插件（如 updater）
        initRegisteredCorePlugins();
    };

    /**
     * 1. 侧边栏标题栏
     */
    function registerSidebarHeader() {
        const sidebarHeader = document.getElementById('sidebar-header');
        if (sidebarHeader) {
            // 使用新的CSS类系统
            sidebarHeader.className = 'ido-sidebar__header';
            sidebarHeader.innerHTML = '';
            
            // 创建标题
            const title = document.createElement('span');
            title.className = 'ido-panel__title';
            title.textContent = '历史记录';
            
            // 创建按钮容器
            const btnContainer = document.createElement('div');
            btnContainer.className = 'ido-panel__actions';
            
            // 创建关闭按钮
            const closeBtn = context.ui.createIconButton({
                icon: 'close',
                title: '关闭侧边栏',
                iconClassName: 'material-symbols-outlined text-[20px]',
                onClick: () => {
                    if (context && context.togglePanel) {
                        context.togglePanel('left', false);
                    }
                }
            });
            
            btnContainer.appendChild(closeBtn);
            sidebarHeader.appendChild(title);
            sidebarHeader.appendChild(btnContainer);
        }
    }

    /**
     * 2. 新建对话按钮（侧边栏顶部）
     */
    function registerNewChatButton() {
        const sidebarTop = document.getElementById(context.SLOTS.SIDEBAR_TOP);
        if (sidebarTop) {
            const btn = context.ui.createIconButton({
                label: '新建对话',
                icon: 'add',
                title: '新建对话',
                variant: 'primary',
                size: 'md',
                className: 'w-full',
                iconClassName: 'material-symbols-outlined text-[18px]',
                onClick: () => {
                    if (conversationActions && conversationActions.create) {
                        conversationActions.create();
                    }
                }
            });
            sidebarTop.appendChild(btn);
        }
    }

    /**
     * 3. 面具切换器（侧边栏底部）
     */
    function registerPersonaSwitcher() {
        const sidebarBottom = document.getElementById(context.SLOTS.SIDEBAR_BOTTOM);
        if (!sidebarBottom) return;
        
        const container = document.createElement('div');
        container.className = "w-full";
        
        const renderPersonaSwitcher = () => {
            container.innerHTML = '';
            
            const personas = store.state.personas || [];
            const activePersonaId = store.state.activePersonaId;
            const activePersona = personas.find(p => p.id === activePersonaId) || personas[0];
            
            if (!activePersona) return;
            
            // 创建下拉按钮
            const button = document.createElement('button');
            button.className = "w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-red-50 text-gray-700 rounded-lg text-xs font-medium transition-colors group border border-transparent hover:border-red-200";
            
            const leftContent = document.createElement('div');
            leftContent.className = "flex items-center gap-2 min-w-0 flex-1";
            
            const icon = document.createElement('div');
            icon.className = "text-gray-500 flex items-center justify-center w-[18px] h-[18px] flex-shrink-0";
            // P5 Phantom Mask Style Icon
            icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="text-red-600"><path d="M19.5,3.5L18,5l-1.5-1.5L15,2l-1.5,1.5L12,5L10.5,3.5L9,2L7.5,3.5L6,5L4.5,3.5L2,6v12c0,2.2,1.8,4,4,4h12c2.2,0,4-1.8,4-4V6L19.5,3.5z M6,16c-1.1,0-2-0.9-2-2s0.9-2,2-2s2,0.9,2,2S7.1,16,6,16z M18,16c-1.1,0-2-0.9-2-2s0.9-2,2-2s2,0.9,2,2S19.1,16,18,16z" /></svg>`;
            
            const label = document.createElement('span');
            label.className = "truncate";
            label.textContent = activePersona.name;
            label.title = activePersona.name;
            
            leftContent.appendChild(icon);
            leftContent.appendChild(label);
            
            const arrow = document.createElement('span');
            arrow.className = "material-symbols-outlined text-[18px] flex-shrink-0 transition-transform";
            arrow.textContent = "expand_more";
            
            button.appendChild(leftContent);
            button.appendChild(arrow);
            
            // 点击显示面具选择底部抽屉
            button.onclick = () => {
                showPersonaSelectionSheet();
            };
            
            container.appendChild(button);
        };
        
        const showPersonaSelectionSheet = () => {
            context.showBottomSheet((sheetContainer) => {
                // Header
                const header = document.createElement('div');
                header.className = "px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white";
                
                const title = document.createElement('h3');
                title.className = "text-lg font-semibold text-gray-800";
                title.textContent = "选择面具";
                
                const closeBtn = document.createElement('button');
                closeBtn.className = "text-gray-400 hover:text-gray-600 transition-colors";
                closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                closeBtn.onclick = () => context.hideBottomSheet();
                
                header.appendChild(title);
                header.appendChild(closeBtn);
                
                // Body
                const body = document.createElement('div');
                body.className = "flex-1 overflow-y-auto px-6 py-4";
                
                const personas = store.state.personas || [];
                const activePersonaId = store.state.activePersonaId;
                
                const personaList = document.createElement('div');
                personaList.className = "space-y-2";
                
                personas.forEach(persona => {
                    const isActive = persona.id === activePersonaId;
                    
                    const item = document.createElement('div');
                    item.className = `border rounded-lg p-4 cursor-pointer transition-all transform hover:-translate-y-0.5 duration-200 ${
                        isActive ? 'border-red-600 bg-red-50 shadow-md' : 'border-gray-200 hover:border-red-400 hover:shadow-sm'
                    }`;
                    
                    const itemHeader = document.createElement('div');
                    itemHeader.className = "flex items-center justify-between mb-2";
                    
                    const nameGroup = document.createElement('div');
                    nameGroup.className = "flex items-center gap-2";
                    
                    const name = document.createElement('span');
                    name.className = `font-bold tracking-wide ${isActive ? 'text-red-700' : 'text-gray-800'}`;
                    name.textContent = persona.name;
                    
                    if (isActive) {
                        const badge = document.createElement('span');
                        badge.className = "bg-black text-white text-[10px] px-2 py-0.5 transform -skew-x-12 ml-2 font-bold";
                        badge.textContent = "当前面具";
                        nameGroup.appendChild(name);
                        nameGroup.appendChild(badge);
                    } else {
                        nameGroup.appendChild(name);
                    }
                    
                    const checkIcon = document.createElement('div');
                    checkIcon.className = `w-6 h-6 rounded-full flex items-center justify-center ${
                        isActive ? 'bg-red-600 text-white transform rotate-12' : 'bg-transparent'
                    }`;
                    if (isActive) {
                        checkIcon.innerHTML = '<span class="material-symbols-outlined text-[16px]">check</span>';
                    }
                    
                    itemHeader.appendChild(nameGroup);
                    itemHeader.appendChild(checkIcon);
                    
                    const desc = document.createElement('div');
                    desc.className = "text-xs text-gray-500 mb-2";
                    desc.textContent = persona.description || '暂无描述';
                    
                    const details = document.createElement('div');
                    details.className = "flex items-center gap-3 text-[10px] text-gray-400";
                    details.innerHTML = `
                        <span>Temp: ${persona.temperature}</span>
                        <span>Top P: ${persona.topP}</span>
                        <span>${persona.stream ? '流式' : '非流式'}</span>
                    `;
                    
                    item.appendChild(itemHeader);
                    item.appendChild(desc);
                    item.appendChild(details);
                    
                    item.onclick = () => {
                        if (persona.id !== activePersonaId) {
                            store.setActivePersona(persona.id);
                            context.hideBottomSheet();
                            // 刷新UI
                            if (conversationActions && conversationActions.syncUI) {
                                conversationActions.syncUI();
                            }
                            renderPersonaSwitcher();
                        }
                    };
                    
                    personaList.appendChild(item);
                });
                
                body.appendChild(personaList);
                
                // Footer
                const footer = document.createElement('div');
                footer.className = "px-6 py-4 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0 bg-white";
                
                const manageBtn = document.createElement('button');
                manageBtn.className = "px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium";
                manageBtn.textContent = "管理面具";
                manageBtn.onclick = () => {
                    context.hideBottomSheet();
                    // 打开设置页面的面具管理标签
                    if (window.IdoFront.settingsManager && window.IdoFront.settingsManager.openTab) {
                        window.IdoFront.settingsManager.openTab('personas');
                    }
                };
                
                footer.appendChild(manageBtn);
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
                sheetContainer.appendChild(footer);
            });
        };
        
        // 初始渲染
        renderPersonaSwitcher();
        
        // 监听面具变更事件
        if (store.events) {
            store.events.on('persona:changed', renderPersonaSwitcher);
            store.events.on('personas:updated', renderPersonaSwitcher);
        }
        
        sidebarBottom.appendChild(container);
    }

    /**
     * 4. 模型选择器（输入框工具栏）
     * 原始行为：挂在顶部栏右侧 HEADER_ACTIONS。
     * 现在改为：挂在输入框右侧操作区，更贴近发送区域。
     */
    function registerModelSelector() {
        const inputActionsRight = document.getElementById(context.SLOTS.INPUT_ACTIONS_RIGHT);
        if (inputActionsRight && window.IdoFront.modelSelector) {
            window.IdoFront.modelSelector.render(inputActionsRight);
        }
    }

    /**
     * 5. 输入框上方工具栏按钮
     * 注意：主插件在输入框上方的工具栏插槽 (INPUT_TOP) 注册按钮
     * 这里注册：
     *  - 流式开关：作用于当前对话，覆盖面具的 stream 设置
     */
    function registerHeaderActions() {
        if (!context || !store) return;

        // 内部状态：缓存当前控件引用，便于在 store 事件中更新 UI
        const headerState = {
            container: null,
            streamBtn: null
        };

        /**
         * 依据当前激活对话和面具，更新按钮显示状态
         */
        const updateHeaderControls = () => {
            if (!store || !store.getActiveConversation) return;
            if (!headerState.streamBtn) return;

            const conv = store.getActiveConversation();
            const activePersona = typeof store.getActivePersona === 'function'
                ? store.getActivePersona()
                : null;

            // ---- 流式状态 - Toggle Switch ----
            let streamEffective = true;
            if (conv && typeof conv.streamOverride === 'boolean') {
                streamEffective = conv.streamOverride;
            } else if (activePersona) {
                streamEffective = activePersona.stream !== false;
            }

            const streamBtn = headerState.streamBtn;
            if (streamBtn) {
                const slider = streamBtn.querySelector('[data-role="stream-slider"]');
                
                // 移除所有状态类
                streamBtn.classList.remove('bg-blue-500', 'bg-gray-300');
                
                if (streamEffective) {
                    // 开启状态：蓝色背景，滑块向右
                    streamBtn.classList.add('bg-blue-500');
                    if (slider) {
                        slider.style.transform = 'translateX(1rem)'; // 16px = 1rem
                    }
                } else {
                    // 关闭状态：灰色背景，滑块向左
                    streamBtn.classList.add('bg-gray-300');
                    if (slider) {
                        slider.style.transform = 'translateX(0.125rem)'; // 2px = 0.125rem
                    }
                }
            }
        };

        // 监听全局状态变化，同步更新按钮显示（对话切换、模型变更等）
        if (store.events && typeof store.events.on === 'function') {
            store.events.on('updated', updateHeaderControls);
        }

        // 向 INPUT_TOP 插槽（输入框上方工具栏）注册纯 UI 组件
        const registerUI = context.registerUIComponent || context.registerPlugin;
        registerUI(context.SLOTS.INPUT_TOP, 'core-chat-toggles', () => {
            const container = document.createElement('div');
            container.id = 'stream-toggle-container'; // 添加 ID 方便定位
            container.className = 'flex items-center gap-3';
            container.style.order = '10'; // 使用 order 控制顺序，确保在核心参数之后

            // ---- 流式开关 - iOS风格Toggle Switch ----
            const streamToggleWrapper = document.createElement('div');
            streamToggleWrapper.className = 'flex items-center gap-2';
            
            const streamLabel = document.createElement('span');
            streamLabel.className = 'text-xs text-gray-600 font-medium';
            streamLabel.textContent = '流式';
            
            const streamToggle = document.createElement('button');
            streamToggle.type = 'button';
            streamToggle.className = 'relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1';
            streamToggle.title = '流式输出开关（仅作用于当前对话）';
            
            const streamSlider = document.createElement('span');
            streamSlider.className = 'inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-300 ease-in-out';
            streamSlider.dataset.role = 'stream-slider';
            
            streamToggle.appendChild(streamSlider);
            streamToggleWrapper.appendChild(streamLabel);
            streamToggleWrapper.appendChild(streamToggle);
            
            streamToggle.onclick = () => {
                if (!store || !store.getActiveConversation) return;
                const conv = store.getActiveConversation();
                if (!conv) return;
                
                const activePersona = typeof store.getActivePersona === 'function'
                    ? store.getActivePersona()
                    : null;
                
                let current = true;
                if (typeof conv.streamOverride === 'boolean') {
                    current = conv.streamOverride;
                } else if (activePersona) {
                    current = activePersona.stream !== false;
                }
                
                const next = !current;
                if (typeof store.setConversationStreamOverride === 'function') {
                    store.setConversationStreamOverride(conv.id, next);
                } else {
                    conv.streamOverride = next;
                    if (typeof store.persist === 'function') {
                        store.persist();
                    }
                }
                
                updateHeaderControls();
            };
            
            container.appendChild(streamToggleWrapper);

            // 缓存引用并进行一次初始同步
            headerState.container = container;
            headerState.streamBtn = streamToggle;

            updateHeaderControls();

            return container;
        });
    }

    /**
     * 6. 消息操作按钮 - 新卡片设计
     * 固定按钮：编辑、重试
     * 更多操作：复制、删除 + 插件注册的按钮
     */
    function registerMessageActions() {
        // 优先使用 registerUIBundle（纯 UI 组件），回退到 registerPluginBundle
        const registerBundle = context.registerUIBundle || context.registerPluginBundle;
        
        // 定义 MESSAGE_MORE_ACTIONS 的组件
        const moreActionsComponents = [
            {
                id: 'copy',
                enabled: true,
                render: (msg) => {
                    const copyItem = document.createElement('button');
                    copyItem.innerHTML = '<span class="material-symbols-outlined text-[14px]">content_copy</span><span>复制</span>';
                    copyItem.onclick = () => {
                        const text = msg.text || msg.content;
                        navigator.clipboard.writeText(text);
                    };
                    return copyItem;
                }
            },
            {
                id: 'delete',
                enabled: true,
                render: (msg) => {
                    const deleteItem = document.createElement('button');
                    deleteItem.className = 'danger';
                    deleteItem.innerHTML = '<span class="material-symbols-outlined text-[14px]">delete</span><span>删除</span>';
                    deleteItem.onclick = () => {
                        if (conversationActions && conversationActions.deleteMessage) {
                            conversationActions.deleteMessage(msg.id);
                        }
                    };
                    return deleteItem;
                }
            }
        ];
        
        // 手动添加到 moreActionsRegistry
        moreActionsComponents.forEach(comp => {
            moreActionsRegistry.push(comp);
        });
        
        // 使用 registerUIBundle 统一注册消息操作相关的所有 UI（无需 meta）
        registerBundle('core-message-actions', {
            slots: {
                // 同一个 slot 注册多个组件：复制和删除按钮
                [context.SLOTS.MESSAGE_MORE_ACTIONS]: moreActionsComponents,
                // 主操作栏
                [context.SLOTS.MESSAGE_FOOTER]: (msg) => {
                    const container = document.createElement('div');
                    container.className = 'flex items-center gap-1';
                    
                    // 1. 编辑按钮（固定）
                    const editBtn = document.createElement('button');
                    editBtn.className = 'material-symbols-outlined text-[14px]';
                    editBtn.textContent = 'edit';
                    editBtn.title = '编辑';
                    editBtn.onclick = () => {
                        if (context.renderMessageEdit) {
                            context.renderMessageEdit(msg.id);
                        } else if (messageActions && messageActions.edit) {
                            messageActions.edit(msg.id);
                        }
                    };
                    container.appendChild(editBtn);
                    
                    // 2. 重试按钮（固定）
                    const retryBtn = document.createElement('button');
                    retryBtn.className = 'material-symbols-outlined text-[14px]';
                    retryBtn.textContent = 'refresh';
                    retryBtn.title = '重试';
                    retryBtn.onclick = () => {
                        if (messageActions && messageActions.retry) {
                            messageActions.retry(msg.id);
                        }
                    };
                    container.appendChild(retryBtn);
                    
                    // 3. 更多按钮（下拉菜单，开放插件注册）
                    const moreBtn = document.createElement('button');
                    moreBtn.className = 'material-symbols-outlined text-[14px]';
                    moreBtn.textContent = 'more_horiz';
                    moreBtn.title = '更多';
                    
                    // 创建 Popover
                    const popover = document.createElement('div');
                    popover.className = 'ido-message__popover';
                    
                    // 从 MESSAGE_MORE_ACTIONS 插槽获取插件注册的按钮
                    const moreActionPlugins = getDynamicPluginsForMoreActions(msg);
                    moreActionPlugins.forEach(item => {
                        if (item) {
                            item.onclick = ((originalOnclick) => (e) => {
                                if (originalOnclick) originalOnclick(e);
                                popover.classList.remove('ido-message__popover--visible');
                            })(item.onclick);
                            popover.appendChild(item);
                        }
                    });
                    
                    // 更多按钮点击事件
                    let popoverVisible = false;
                    moreBtn.onclick = (e) => {
                        e.stopPropagation();
                        popoverVisible = !popoverVisible;
                        popover.classList.toggle('ido-message__popover--visible', popoverVisible);
                    };
                    
                    // 点击外部关闭 Popover
                    document.addEventListener('click', () => {
                        if (popoverVisible) {
                            popover.classList.remove('ido-message__popover--visible');
                            popoverVisible = false;
                        }
                    });
                    
                    // 相对定位容器
                    const moreWrapper = document.createElement('div');
                    moreWrapper.style.position = 'relative';
                    moreWrapper.appendChild(moreBtn);
                    moreWrapper.appendChild(popover);
                    container.appendChild(moreWrapper);

                    return container;
                }
            }
        });
    }

    /**
     * 7. 输入框工具按钮（插槽）
     *
     * 工具注册格式：
     * {
     *   id: string,           // 工具唯一标识
     *   icon: string,         // Material icon 名称
     *   label: string,        // 工具显示名称
     *   description?: string, // 工具描述（可选）
     *   shouldShow?: (context) => boolean,  // 动态判断是否显示（可选）
     *   onClick: () => void   // 点击回调
     * }
     */
    
    // 工具注册表
    const inputToolsRegistry = [];
    // 待处理的注册请求队列（在 API 就绪前调用的注册）
    const pendingToolRegistrations = [];
    
    function registerInputTools() {
        // 获取当前可见的工具列表
        const getVisibleTools = () => {
            const toolContext = {
                store: store,
                activeChannel: store.getActiveChannel ? store.getActiveChannel() : null,
                activeConversation: store.getActiveConversation ? store.getActiveConversation() : null,
                activePersona: store.getActivePersona ? store.getActivePersona() : null
            };
            
            return inputToolsRegistry.filter(tool => {
                if (typeof tool.shouldShow === 'function') {
                    try {
                        return tool.shouldShow(toolContext);
                    } catch (e) {
                        console.error(`[InputTools] shouldShow error for ${tool.id}:`, e);
                        return false;
                    }
                }
                return true; // 默认显示
            });
        };

        // 更新触发按钮的可见性
        const updateToolsTriggerVisibility = () => {
            const triggerBtn = document.getElementById('core-input-tools-trigger');
            if (triggerBtn) {
                const visibleTools = getVisibleTools();
                // 检查是否有 MCP 服务器
                const mcpSettings = window.IdoFront.mcpSettings;
                const hasMCPServers = mcpSettings && mcpSettings.getServerGroups && mcpSettings.getServerGroups().length > 0;
                // 有内置工具或 MCP 服务器时显示
                triggerBtn.classList.toggle('hidden', visibleTools.length === 0 && !hasMCPServers);
            }
        };

        // 注册触发按钮到左侧操作区
        context.registerUIComponent(context.SLOTS.INPUT_ACTIONS_LEFT, 'core-input-tools-trigger', () => {
            const btn = context.ui.createIconButton({
                icon: 'construction',
                title: '工具',
                className: 'text-gray-600 hover:text-blue-600 hidden', // 默认隐藏
                iconClassName: 'material-symbols-outlined text-[18px]',
                id: 'core-input-tools-trigger',
                onClick: () => {
                    showInputToolsSheet();
                }
            });
            
            // 延迟检查
            setTimeout(updateToolsTriggerVisibility, 100);
            return btn;
        });

        // 监听状态变化，动态更新工具按钮可见性
        if (store.events && typeof store.events.on === 'function') {
            store.events.on('updated', updateToolsTriggerVisibility);
            store.events.on('channel:changed', updateToolsTriggerVisibility);
            store.events.on('conversation:switched', updateToolsTriggerVisibility);
            store.events.on('mcp:tools:updated', updateToolsTriggerVisibility);
        }

        const showInputToolsSheet = () => {
            context.showBottomSheet((sheetContainer) => {
                // Header
                const header = document.createElement('div');
                header.className = "px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white";
                
                const title = document.createElement('h3');
                title.className = "text-lg font-semibold text-gray-800";
                title.textContent = "工具";
                
                const closeBtn = document.createElement('button');
                closeBtn.className = "text-gray-400 hover:text-gray-600 transition-colors";
                closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                closeBtn.onclick = () => context.hideBottomSheet();
                
                header.appendChild(title);
                header.appendChild(closeBtn);
                
                // Body - 分组显示工具
                const body = document.createElement('div');
                body.className = "flex-1 overflow-y-auto px-6 py-4 space-y-6";
                
                // 获取当前可见的内置工具
                const visibleTools = getVisibleTools();
                
                // ========== 内置工具分组 ==========
                if (visibleTools.length > 0) {
                    const builtinSection = createToolSection('内置工具', 'build', visibleTools);
                    body.appendChild(builtinSection);
                }
                
                // ========== MCP 工具分组 ==========
                const mcpSettings = window.IdoFront.mcpSettings;
                if (mcpSettings) {
                    const serverGroups = mcpSettings.getServerGroups ? mcpSettings.getServerGroups() : [];
                    
                    serverGroups.forEach(server => {
                        const mcpSection = createMCPSection(server);
                        body.appendChild(mcpSection);
                    });
                }
                
                // 如果没有任何工具
                if (visibleTools.length === 0 && (!mcpSettings || !mcpSettings.getServerGroups)) {
                    const emptyContent = document.createElement('div');
                    emptyContent.className = "text-center text-gray-500 py-10";
                    emptyContent.textContent = "暂无可用工具";
                    body.appendChild(emptyContent);
                }
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
            });
        };
        
        // 创建工具分组区域
        function createToolSection(title, icon, tools) {
            const section = document.createElement('div');
            section.className = 'space-y-3';
            
            // 分组标题
            const sectionHeader = document.createElement('div');
            sectionHeader.className = 'flex items-center gap-2 text-sm font-medium text-gray-500 px-1';
            sectionHeader.innerHTML = `<span class="material-symbols-outlined text-[18px]">${icon}</span> ${title}`;
            section.appendChild(sectionHeader);
            
            // 工具列表
            tools.forEach(tool => {
                const toolItem = createToolItem(tool);
                section.appendChild(toolItem);
            });
            
            return section;
        }
        
        // 创建 MCP 服务器分组
        function createMCPSection(server) {
            const section = document.createElement('div');
            section.className = 'space-y-3';
            
            // 状态配置
            const statusConfig = {
                connected: { dot: 'bg-green-500', text: '已连接', textColor: 'text-green-600' },
                connecting: { dot: 'bg-yellow-500', text: '连接中...', textColor: 'text-yellow-600' },
                disconnected: { dot: 'bg-gray-300', text: '未连接', textColor: 'text-gray-400' },
                error: { dot: 'bg-red-500', text: '连接失败', textColor: 'text-red-500' }
            };
            const status = statusConfig[server.status] || statusConfig.disconnected;
            
            // 分组标题
            const sectionHeader = document.createElement('div');
            sectionHeader.className = 'flex items-center justify-between px-1';
            
            const headerLeft = document.createElement('div');
            headerLeft.className = 'flex items-center gap-2 text-sm font-medium text-gray-500';
            headerLeft.innerHTML = `
                <span class="material-symbols-outlined text-[18px] text-purple-500">extension</span>
                <span>MCP: ${server.name}</span>
                <span class="flex items-center gap-1 text-xs ${status.textColor}">
                    <span class="w-1.5 h-1.5 rounded-full ${status.dot}"></span>
                    ${status.text}
                </span>
            `;
            sectionHeader.appendChild(headerLeft);
            
            // 如果未连接，显示连接按钮
            if (server.status === 'disconnected') {
                const connectBtn = document.createElement('button');
                connectBtn.className = 'text-xs text-blue-500 hover:text-blue-600 font-medium';
                connectBtn.textContent = '连接';
                connectBtn.onclick = () => {
                    // TODO: 实际连接逻辑
                    console.log('[MCP] Connect to:', server.name);
                };
                sectionHeader.appendChild(connectBtn);
            }
            
            section.appendChild(sectionHeader);
            
            // 工具列表（仅已连接时显示）
            if (server.status === 'connected' && server.tools && server.tools.length > 0) {
                server.tools.forEach(tool => {
                    const toolItem = createMCPToolItem(tool, server);
                    section.appendChild(toolItem);
                });
            } else if (server.status === 'connected' && (!server.tools || server.tools.length === 0)) {
                const emptyHint = document.createElement('div');
                emptyHint.className = 'text-xs text-gray-400 px-1 py-2';
                emptyHint.textContent = '该服务器暂无可用工具';
                section.appendChild(emptyHint);
            }
            
            return section;
        }
        
        // 创建内置工具项
        function createToolItem(tool) {
            const toolItem = document.createElement('div');
            toolItem.className = 'flex items-center justify-between p-4 rounded-xl bg-gray-50 border border-gray-100';
            
            const info = document.createElement('div');
            info.className = 'flex items-center gap-3 flex-1';
            
            // 图标
            const iconEl = document.createElement('span');
            iconEl.className = 'material-symbols-outlined text-[24px] text-gray-600';
            iconEl.textContent = tool.icon || 'build';
            
            const textGroup = document.createElement('div');
            textGroup.className = 'flex-1';
            
            const labelEl = document.createElement('div');
            labelEl.className = 'font-medium text-gray-800';
            labelEl.textContent = tool.label || tool.id;
            
            if (tool.description) {
                const descEl = document.createElement('div');
                descEl.className = 'text-xs text-gray-500 mt-0.5';
                descEl.textContent = tool.description;
                textGroup.appendChild(labelEl);
                textGroup.appendChild(descEl);
            } else {
                textGroup.appendChild(labelEl);
            }
            
            info.appendChild(iconEl);
            info.appendChild(textGroup);
            
            // 如果工具有 render 函数，使用自定义渲染
            if (typeof tool.render === 'function') {
                const customEl = tool.render(null, context);
                if (customEl) return customEl;
            }
            
            // 开关（如果工具提供 getState/setState）
            if (typeof tool.getState === 'function' && typeof tool.setState === 'function') {
                const switchLabel = document.createElement('label');
                switchLabel.className = 'ido-form-switch';
                const switchInput = document.createElement('input');
                switchInput.type = 'checkbox';
                switchInput.className = 'ido-form-switch__input';
                switchInput.checked = tool.getState();
                const slider = document.createElement('div');
                slider.className = 'ido-form-switch__slider';
                
                switchInput.onchange = () => {
                    tool.setState(switchInput.checked);
                };
                
                switchLabel.appendChild(switchInput);
                switchLabel.appendChild(slider);
                
                toolItem.appendChild(info);
                toolItem.appendChild(switchLabel);
            } else if (typeof tool.onClick === 'function') {
                // 没有开关，但有点击事件
                toolItem.className += ' cursor-pointer hover:bg-gray-100';
                toolItem.onclick = () => {
                    context.hideBottomSheet();
                    tool.onClick();
                };
                toolItem.appendChild(info);
                
                const arrow = document.createElement('span');
                arrow.className = 'material-symbols-outlined text-gray-400';
                arrow.textContent = 'chevron_right';
                toolItem.appendChild(arrow);
            } else {
                toolItem.appendChild(info);
            }
            
            return toolItem;
        }
        
        // 创建 MCP 工具项
        function createMCPToolItem(tool, server) {
            const toolItem = document.createElement('div');
            toolItem.className = 'flex items-center justify-between p-4 rounded-xl bg-purple-50/50 border border-purple-100';
            
            const info = document.createElement('div');
            info.className = 'flex items-center gap-3 flex-1';
            
            // 图标
            const iconEl = document.createElement('span');
            iconEl.className = 'material-symbols-outlined text-[24px] text-purple-500';
            iconEl.textContent = 'function';
            
            const textGroup = document.createElement('div');
            textGroup.className = 'flex-1';
            
            const labelEl = document.createElement('div');
            labelEl.className = 'font-medium text-gray-800 font-mono text-sm';
            labelEl.textContent = tool.name;
            
            if (tool.description) {
                const descEl = document.createElement('div');
                descEl.className = 'text-xs text-gray-500 mt-0.5';
                descEl.textContent = tool.description;
                textGroup.appendChild(labelEl);
                textGroup.appendChild(descEl);
            } else {
                textGroup.appendChild(labelEl);
            }
            
            info.appendChild(iconEl);
            info.appendChild(textGroup);
            
            // 开关
            const mcpSettings = window.IdoFront.mcpSettings;
            const switchLabel = document.createElement('label');
            switchLabel.className = 'ido-form-switch';
            const switchInput = document.createElement('input');
            switchInput.type = 'checkbox';
            switchInput.className = 'ido-form-switch__input';
            switchInput.checked = tool.enabled !== false;
            const slider = document.createElement('div');
            slider.className = 'ido-form-switch__slider';
            
            switchInput.onchange = () => {
                if (mcpSettings && mcpSettings.setToolState) {
                    mcpSettings.setToolState(tool.id, switchInput.checked);
                }
            };
            
            switchLabel.appendChild(switchInput);
            switchLabel.appendChild(slider);
            
            toolItem.appendChild(info);
            toolItem.appendChild(switchLabel);
            
            return toolItem;
        }

        // 内部注册函数
        const doRegister = (toolDef) => {
            if (!toolDef || !toolDef.id) {
                console.warn('[InputTools] register() requires toolDef.id');
                return false;
            }
            
            // 检查是否已存在
            const existingIndex = inputToolsRegistry.findIndex(t => t.id === toolDef.id);
            if (existingIndex >= 0) {
                inputToolsRegistry[existingIndex] = toolDef;
            } else {
                inputToolsRegistry.push(toolDef);
            }
            
            // 更新按钮可见性
            updateToolsTriggerVisibility();
            return true;
        };

        // 暴露工具注册 API
        window.IdoFront.inputTools = {
            /**
             * 注册一个输入工具
             * @param {Object} toolDef - 工具定义
             * @param {string} toolDef.id - 工具唯一标识
             * @param {string} toolDef.icon - Material icon 名称
             * @param {string} toolDef.label - 工具显示名称
             * @param {string} [toolDef.description] - 工具描述
             * @param {function} [toolDef.shouldShow] - 动态判断是否显示 (context) => boolean
             * @param {function} toolDef.onClick - 点击回调
             */
            register: doRegister,
            
            /**
             * 注销一个输入工具
             * @param {string} id - 工具 ID
             */
            unregister: (id) => {
                const index = inputToolsRegistry.findIndex(t => t.id === id);
                if (index >= 0) {
                    inputToolsRegistry.splice(index, 1);
                    updateToolsTriggerVisibility();
                    return true;
                }
                return false;
            },
            
            /**
             * 获取所有已注册的工具
             */
            getAll: () => [...inputToolsRegistry],
            
            /**
             * 获取当前可见的工具
             */
            getVisible: getVisibleTools,
            
            /**
             * 手动刷新工具按钮可见性
             */
            refresh: updateToolsTriggerVisibility
        };
        
        // 处理在 API 就绪前排队的注册请求
        while (pendingToolRegistrations.length > 0) {
            const toolDef = pendingToolRegistrations.shift();
            doRegister(toolDef);
        }
        
        // 触发就绪事件
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('IdoFrontInputToolsReady'));
        }
    }
    
    // 提供一个早期可用的注册入口（在 corePlugins.init 之前也能调用）
    // 如果 API 已就绪，直接注册；否则加入队列
    window.IdoFront.inputTools = window.IdoFront.inputTools || {
        register: (toolDef) => {
            pendingToolRegistrations.push(toolDef);
            return true;
        },
        unregister: () => false,
        getAll: () => [],
        getVisible: () => [],
        refresh: () => {}
    };
    
    /**
     * 获取 MESSAGE_MORE_ACTIONS 插槽的插件
     */
    function getDynamicPluginsForMoreActions(msg) {
        const slotName = context.SLOTS.MESSAGE_MORE_ACTIONS;
        if (!slotName) return [];
        
        // 访问 Framework 内部 registry（通过 getPlugins 获取列表后手动渲染）
        const allPlugins = context.getPlugins ? context.getPlugins() : [];
        const moreActionPlugins = allPlugins.filter(p => p.slot === slotName && p.enabled !== false);
        
        // 手动渲染每个插件
        const results = [];
        moreActionPlugins.forEach(pluginInfo => {
            // 需要从 registry 获取实际的 render 函数
            // 由于 getPlugins 只返回元数据，我们需要另一种方式
            // 这里使用一个 hack：通过 refreshSlot 的逻辑
        });
        
        // 简化方案：直接使用 Framework 暴露的 getDynamicPlugins（如果存在）
        // 或者在 core-plugins 内部维护一个 registry
        return getMoreActionsFromRegistry(msg);
    }
    
    // 内部 registry 用于 MESSAGE_MORE_ACTIONS
    const moreActionsRegistry = [];
    let originalRegisterPlugin = null;
    
    function getMoreActionsFromRegistry(msg) {
        return moreActionsRegistry.map(plugin => {
            if (!plugin.enabled) return null;
            try {
                return plugin.render(msg);
            } catch (e) {
                console.error('More action plugin error:', e);
                return null;
            }
        }).filter(Boolean);
    }
    
    // 在 init 时调用，覆盖 registerPlugin 以捕获 MESSAGE_MORE_ACTIONS
    function setupMoreActionsRegistry() {
        if (!context || originalRegisterPlugin) return; // 避免重复覆盖
        
        originalRegisterPlugin = context.registerPlugin;
        context.registerPlugin = function(slotName, id, definition) {
            if (slotName === context.SLOTS.MESSAGE_MORE_ACTIONS) {
                const plugin = typeof definition === 'function'
                    ? { id, enabled: true, render: definition }
                    : { id, enabled: definition.enabled !== false, render: definition.render || definition.renderer };
                moreActionsRegistry.push(plugin);
                return;
            }
            return originalRegisterPlugin.call(context, slotName, id, definition);
        };
    }

    /**
     * 恢复插件状态
     */
    function restorePluginStates() {
        if (store.state.pluginStates) {
            Object.keys(store.state.pluginStates).forEach(key => {
                const [slot, id] = key.split('::');
                if (slot && id) {
                    const enabled = store.state.pluginStates[key];
                    if (context && context.setPluginEnabled) {
                        context.setPluginEnabled(slot, id, enabled);
                    }
                }
            });
        }
    }

    /**
     * 切换插件状态
     */
    window.IdoFront.corePlugins.togglePlugin = function(slot, id, enabled) {
        store.setPluginState(slot, id, enabled);
        if (context && context.setPluginEnabled) {
            context.setPluginEnabled(slot, id, enabled);
        }
    };

})();