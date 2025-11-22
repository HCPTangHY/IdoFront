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
     * 4. 模型选择器（顶部栏）
     */
    function registerModelSelector() {
        const headerActions = document.getElementById(context.SLOTS.HEADER_ACTIONS);
        if (headerActions && window.IdoFront.modelSelector) {
            window.IdoFront.modelSelector.render(headerActions);
        }
    }

    /**
     * 5. 顶部栏操作按钮
     * 注意："全屏打开"按钮已统一集成到 createCustomHeader 中，无需在此重复添加
     */
    function registerHeaderActions() {
        // 预留插槽，供其他插件使用
        // 例如：清空日志等功能可以在这里添加
    }

    /**
     * 6. 消息操作按钮 (复制、重试、删除)
     */
    function registerMessageActions() {
        context.registerPlugin(context.SLOTS.MESSAGE_FOOTER, 'core-msg-actions', (msg) => {
            const container = document.createElement('div');
            container.className = 'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity';
            
            // 1. Edit Button (All messages)
            const editBtn = context.ui.createIconButton({
                icon: 'edit',
                title: '编辑',
                className: 'p-1 hover:bg-gray-100 rounded text-gray-500',
                iconClassName: 'material-symbols-outlined text-[16px]',
                onClick: () => {
                    // Use custom edit renderer if available in framework
                    if (context.renderMessageEdit) {
                        context.renderMessageEdit(msg.id);
                    } else if (messageActions && messageActions.edit) {
                        messageActions.edit(msg.id);
                    }
                }
            });
            container.appendChild(editBtn);
            
            // 2. Copy Button (All messages)
            const copyBtn = context.ui.createIconButton({
                icon: 'content_copy',
                title: '复制',
                className: 'p-1 hover:bg-gray-100 rounded text-gray-500',
                iconClassName: 'material-symbols-outlined text-[16px]',
                onClick: () => {
                    const text = msg.text || msg.content; // Handle both structures
                    navigator.clipboard.writeText(text);
                    // Optional: Show toast/tooltip feedback
                }
            });
            container.appendChild(copyBtn);

            // 3. Retry Button (Latest message only, or specific logic?)
            // Logic: User message -> Resend this message (clearing subsequent)
            //        AI message -> Regenerate this message (clearing this and subsequent)
            // For now, we allow retry on any message, which triggers truncation from that point
            const retryBtn = context.ui.createIconButton({
                icon: 'refresh',
                title: '重试',
                className: 'p-1 hover:bg-gray-100 rounded text-gray-500',
                iconClassName: 'material-symbols-outlined text-[16px]',
                onClick: () => {
                    if (messageActions && messageActions.retry) {
                        messageActions.retry(msg.id);
                    }
                }
            });
            container.appendChild(retryBtn);

            // 4. Delete Button
            const deleteBtn = context.ui.createIconButton({
                icon: 'delete',
                title: '删除',
                className: 'p-1 hover:bg-gray-100 rounded text-gray-500',
                iconClassName: 'material-symbols-outlined text-[16px]',
                onClick: () => {
                    if (conversationActions && conversationActions.deleteMessage) {
                        conversationActions.deleteMessage(msg.id);
                    }
                }
            });
            container.appendChild(deleteBtn);

            return container;
        });
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