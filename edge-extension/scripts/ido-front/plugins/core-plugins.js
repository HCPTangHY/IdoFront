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
     *  - 思考预算选择：仅在模型名包含 "gpt-5" 时显示，映射为 reasoning_effort 参数
     */
    function registerHeaderActions() {
        if (!context || !store) return;

        // 内部状态：缓存当前控件引用，便于在 store 事件中更新 UI
        const headerState = {
            container: null,
            streamBtn: null,
            divider: null,
            reasoningGroup: null,
            reasoningButtons: {}
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

            // ---- 思考预算：仅在 gpt-5* 模型时显示 ----
            const reasoningGroup = headerState.reasoningGroup;
            if (!reasoningGroup) return;

            if (!conv || !conv.selectedModel) {
                reasoningGroup.style.display = 'none';
                if (headerState.divider) {
                    headerState.divider.style.display = 'none';
                }
                return;
            }

            const modelName = String(conv.selectedModel).toLowerCase();
            const isReasoningModel = modelName.includes('gpt-5');

            if (!isReasoningModel) {
                reasoningGroup.style.display = 'none';
                if (headerState.divider) {
                    headerState.divider.style.display = 'none';
                }
                return;
            }

            reasoningGroup.style.display = 'flex';
            if (headerState.divider) {
                headerState.divider.style.display = 'block';
            }

            // 当前会话的思考预算，默认 medium
            let effort = conv.reasoningEffort || 'medium';
            if (typeof effort === 'string') {
                effort = effort.toLowerCase();
            }
            if (effort !== 'low' && effort !== 'medium' && effort !== 'high') {
                effort = 'medium';
            }

            ['low', 'medium', 'high'].forEach((key) => {
                const btn = headerState.reasoningButtons[key];
                if (!btn) return;
                btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                btn.classList.remove('bg-gray-50', 'text-gray-500', 'border-gray-200');
                if (key === effort) {
                    btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
                } else {
                    btn.classList.add('bg-gray-50', 'text-gray-500', 'border-gray-200');
                }
            });
        };

        // 监听全局状态变化，同步更新按钮显示（对话切换、模型变更等）
        if (store.events && typeof store.events.on === 'function') {
            store.events.on('updated', updateHeaderControls);
        }

        // 向 INPUT_TOP 插槽（输入框上方工具栏）注册实际渲染函数
        context.registerPlugin(context.SLOTS.INPUT_TOP, 'core-chat-toggles', () => {
            const container = document.createElement('div');
            container.className = 'flex items-center gap-3';

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

            // 垂直分隔线
            const divider = document.createElement('div');
            divider.className = 'h-5 w-px bg-gray-200';
            container.appendChild(divider);

            // ---- 思考预算选择控件 ----
            const reasoningGroup = document.createElement('div');
            reasoningGroup.className = 'flex items-center gap-1 text-[11px] text-gray-500';

            const label = document.createElement('span');
            label.className = 'text-[10px] text-gray-400';
            label.textContent = '思考';

            const createEffortBtn = (key, text, title) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'px-1.5 py-0.5 rounded text-[10px] border cursor-pointer transition-colors';
                btn.textContent = text;
                btn.title = title;
                btn.onclick = () => {
                    if (!store || !store.getActiveConversation) return;
                    const conv = store.getActiveConversation();
                    if (!conv) return;

                    if (typeof store.setConversationReasoningEffort === 'function') {
                        store.setConversationReasoningEffort(conv.id, key);
                    } else {
                        conv.reasoningEffort = key;
                        if (typeof store.persist === 'function') {
                            store.persist();
                        }
                    }

                    updateHeaderControls();
                };
                return btn;
            };

            const lowBtn = createEffortBtn('low', 'L', '思考预算：低 (low)');
            const mediumBtn = createEffortBtn('medium', 'M', '思考预算：中 (medium)');
            const highBtn = createEffortBtn('high', 'H', '思考预算：高 (high)');

            reasoningGroup.appendChild(label);
            reasoningGroup.appendChild(lowBtn);
            reasoningGroup.appendChild(mediumBtn);
            reasoningGroup.appendChild(highBtn);

            container.appendChild(reasoningGroup);

            // 缓存引用并进行一次初始同步
            headerState.container = container;
            headerState.streamBtn = streamToggle;
            headerState.divider = divider;
            headerState.reasoningGroup = reasoningGroup;
            headerState.reasoningButtons = {
                low: lowBtn,
                medium: mediumBtn,
                high: highBtn
            };

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
        // 注册核心的复制和删除到 MESSAGE_MORE_ACTIONS 插槽
        context.registerPlugin(context.SLOTS.MESSAGE_MORE_ACTIONS, 'core-copy', {
            render: (msg) => {
                const copyItem = document.createElement('button');
                copyItem.innerHTML = '<span class="material-symbols-outlined text-[14px]">content_copy</span><span>复制</span>';
                copyItem.onclick = () => {
                    const text = msg.text || msg.content;
                    navigator.clipboard.writeText(text);
                };
                return copyItem;
            }
        });
        
        context.registerPlugin(context.SLOTS.MESSAGE_MORE_ACTIONS, 'core-delete', {
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
        });

        // 主操作栏渲染
        context.registerPlugin(context.SLOTS.MESSAGE_FOOTER, 'core-msg-actions', (msg) => {
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
        });
    }
    
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