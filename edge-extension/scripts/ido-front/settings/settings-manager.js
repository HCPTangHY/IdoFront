/**
 * Settings Manager
 * 管理设置模式的切换和渲染（支持动态注册标签页）
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.settingsManager = window.IdoFront.settingsManager || {};

    let context = null;
    let store = null;
    let activeSettingsTab = 'channels';

    // 设置标签注册表
    const settingsTabs = [];
    
    // 保存容器引用，用于局部更新
    let mainContainer = null;
    let sidebarContainer = null;

    /**
     * 注册设置标签页
     * @param {Object} tab - 标签配置
     * @param {string} tab.id - 标签ID
     * @param {string} tab.icon - Material Icons 图标名
     * @param {string} tab.label - 显示标签
     * @param {Function} tab.render - 渲染函数 (container, context, store) => void
     * @param {number} tab.order - 排序优先级（数字越小越靠前）
     */
    window.IdoFront.settingsManager.registerTab = function(tab) {
        if (!tab.id || !tab.label || typeof tab.render !== 'function') {
            console.error('Invalid settings tab registration:', tab);
            return;
        }
        
        // 检查是否已存在
        const existingIndex = settingsTabs.findIndex(t => t.id === tab.id);
        if (existingIndex !== -1) {
            settingsTabs[existingIndex] = tab;
        } else {
            settingsTabs.push(tab);
        }
        
        // 按 order 排序
        settingsTabs.sort((a, b) => (a.order || 999) - (b.order || 999));
    };

    /**
     * 初始化设置管理器
     */
    window.IdoFront.settingsManager.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        
        // 注册核心设置标签
        registerCoreSettingsTabs();

        // 初始化设置 UI
        initSettingsUI();
        
        // 监听渠道更新事件
        if (store.events) {
            store.events.on('channels:updated', () => {
                // 如果当前在渠道设置页面，刷新列表
                if (activeSettingsTab === 'channels' && mainContainer) {
                    const content = mainContainer.querySelector('.flex-1.overflow-y-auto');
                    const channelSettings = window.IdoFront.channelSettings;
                    if (content && channelSettings && channelSettings.render) {
                        channelSettings.render(content, context, store);
                    }
                }
            });
        }
        
        // 监听状态保存事件（用于新标签页）
        if (context.events) {
            context.events.on('save-state-for-new-tab', (params) => {
                // 保存当前设置标签页
                if (activeSettingsTab) {
                    params.set('settings_tab', activeSettingsTab);
                }
            });
            
            // 监听状态恢复事件
            context.events.on('restore-state-from-url', (params) => {
                const mode = params.get('mode');
                const settingsTab = params.get('settings_tab');
                
                if (mode === 'settings') {
                    // 恢复设置标签页
                    if (settingsTab) {
                        activeSettingsTab = settingsTab;
                    }
                    // 切换到设置模式
                    toggleSettingsMode();
                }
            });
        }
    };

    /**
     * 注册核心设置标签页
     */
    function registerCoreSettingsTabs() {
        // 1. 渠道管理
        window.IdoFront.settingsManager.registerTab({
            id: 'channels',
            icon: 'hub',
            label: '渠道管理',
            order: 10,
            render: (container, ctx, st) => {
                const channelSettings = window.IdoFront.channelSettings;
                if (channelSettings && channelSettings.render) {
                    channelSettings.render(container, ctx, st);
                } else {
                    container.innerHTML = '<div class="text-red-500">渠道设置模块未加载</div>';
                }
            }
        });

        // 2. 面具管理
        window.IdoFront.settingsManager.registerTab({
            id: 'personas',
            // P5 Phantom Mask Style Icon
            icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.5,3.5L18,5l-1.5-1.5L15,2l-1.5,1.5L12,5L10.5,3.5L9,2L7.5,3.5L6,5L4.5,3.5L2,6v12c0,2.2,1.8,4,4,4h12c2.2,0,4-1.8,4-4V6L19.5,3.5z M6,16c-1.1,0-2-0.9-2-2s0.9-2,2-2s2,0.9,2,2S7.1,16,6,16z M18,16c-1.1,0-2-0.9-2-2s0.9-2,2-2s2,0.9,2,2S19.1,16,18,16z" /></svg>`,
            label: '面具管理',
            order: 20,
            render: (container, ctx, st) => {
                const personaSettings = window.IdoFront.personaSettings;
                if (personaSettings && personaSettings.render) {
                    personaSettings.render(container, ctx, st);
                } else {
                    container.innerHTML = '<div class="text-red-500">面具设置模块未加载</div>';
                }
            }
        });

        // 3. 插件管理
        window.IdoFront.settingsManager.registerTab({
            id: 'plugins',
            icon: 'extension',
            label: '插件管理',
            order: 30,
            render: (container, ctx, st) => {
                const pluginSettings = window.IdoFront.pluginSettings;
                if (pluginSettings && pluginSettings.render) {
                    pluginSettings.render(container, ctx, st);
                } else {
                    container.innerHTML = '<div class="text-red-500">插件设置模块未加载</div>';
                }
            }
        });

        // 4. 通用设置（占位）
        window.IdoFront.settingsManager.registerTab({
            id: 'general',
            icon: 'tune',
            label: '通用设置',
            order: 40,
            render: (container) => {
                container.innerHTML = '<div class="text-gray-400 text-center mt-10">暂未开放</div>';
            }
        });

        // 5. 关于（占位）
        window.IdoFront.settingsManager.registerTab({
            id: 'about',
            icon: 'info',
            label: '关于',
            order: 50,
            render: (container) => {
                container.innerHTML = '<div class="text-gray-400 text-center mt-10">暂未开放</div>';
            }
        });
    }

    /**
     * 初始化设置按钮
     */
    function initSettingsUI() {
        if (!context) return;
        
        const sidebarBottom = document.getElementById(context.SLOTS.SIDEBAR_BOTTOM);
        if (sidebarBottom) {
            const btn = context.ui.createIconButton({
                label: '设置',
                icon: 'settings',
                title: '打开设置',
                className: "w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors",
                iconClassName: "material-symbols-outlined text-[18px]",
                onClick: () => toggleSettingsMode()
            });
            sidebarBottom.appendChild(btn);
        }
    }

    /**
     * 切换到设置模式
     * @param {string} tab - 可选，指定要打开的标签页
     */
    function toggleSettingsMode(tab) {
        if (tab) {
            activeSettingsTab = tab;
        }
        context.setMode('settings', {
            sidebar: renderSettingsSidebar,
            main: renderSettingsMain
        });
    }

    /**
     * 渲染设置侧边栏
     */
    function renderSettingsSidebar(container) {
        // 保存容器引用
        sidebarContainer = container;
        
        // 1. Header with Back Button
        const header = document.createElement('div');
        header.className = "h-12 border-b border-gray-100 flex items-center gap-2 px-3 flex-shrink-0";
        
        const backBtn = document.createElement('button');
        backBtn.className = "p-1 hover:bg-gray-100 rounded text-gray-500";
        backBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">arrow_back</span>';
        backBtn.onclick = () => context.setMode('chat');
        
        const title = document.createElement('span');
        title.className = "font-semibold text-gray-700";
        title.textContent = "设置";

        header.appendChild(backBtn);
        header.appendChild(title);
        container.appendChild(header);

        // 2. Tabs List
        const list = document.createElement('div');
        list.className = "flex-1 overflow-y-auto p-2 space-y-1";
        
        settingsTabs.forEach(tab => {
            const btn = document.createElement('button');
            const isActive = tab.id === activeSettingsTab;
            btn.className = `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
            }`;
            if (tab.icon.startsWith('<svg')) {
                 btn.innerHTML = `<div class="text-gray-500 flex items-center justify-center w-[18px] h-[18px]">${tab.icon}</div> <span class="ml-2">${tab.label}</span>`;
            } else {
                 btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">${tab.icon}</span> <span class="ml-2">${tab.label}</span>`;
            }
            
            btn.onclick = () => {
                activeSettingsTab = tab.id;
                // 只更新主面板内容，不重新渲染整个模式
                updateSettingsContent();
            };
            list.appendChild(btn);
        });
        container.appendChild(list);
    }

    /**
     * 更新设置主面板内容（不触发动画）
     */
    function updateSettingsContent() {
        if (!mainContainer) return;
        
        // 找到内容区域并更新
        const content = mainContainer.querySelector('.flex-1.overflow-y-auto');
        if (!content) return;
        
        // 更新标题
        const title = mainContainer.querySelector('.font-medium.text-gray-700');
        if (title) {
            const activeTab = settingsTabs.find(t => t.id === activeSettingsTab);
            title.textContent = activeTab ? activeTab.label : '设置';
        }
        
        // 更新内容
        content.innerHTML = '';
        renderSettingsContent(content);
        
        // 重新渲染侧边栏以更新激活状态（不触发动画）
        if (sidebarContainer) {
            // 清空并重新渲染侧边栏
            sidebarContainer.innerHTML = '';
            renderSettingsSidebar(sidebarContainer);
        }
    }
    
    /**
     * 渲染设置内容区域（动态查找渲染器）
     */
    function renderSettingsContent(content) {
        const activeTab = settingsTabs.find(t => t.id === activeSettingsTab);
        
        if (activeTab && typeof activeTab.render === 'function') {
            try {
                activeTab.render(content, context, store);
            } catch (e) {
                console.error(`Settings tab render error (${activeSettingsTab}):`, e);
                content.innerHTML = `<div class="text-red-500">渲染错误: ${e.message}</div>`;
            }
        } else {
            content.innerHTML = `<div class="text-gray-400 text-center mt-10">未找到设置页面</div>`;
        }
    }
    
    /**
     * 渲染设置主面板
     */
    function renderSettingsMain(container) {
        // 保存容器引用
        mainContainer = container;
        
        // 1. Header - 使用统一的 header 模板
        const activeTab = settingsTabs.find(t => t.id === activeSettingsTab);
        const tabLabel = activeTab ? activeTab.label : '设置';
        
        const header = context.ui.createCustomHeader({
            center: () => {
                const title = document.createElement('div');
                title.className = "font-medium text-gray-700";
                title.textContent = tabLabel;
                return title;
            }
        });
        
        container.appendChild(header);

        // 2. Content Body
        const content = document.createElement('div');
        content.className = "flex-1 overflow-y-auto p-6 bg-white";
        
        renderSettingsContent(content);
        container.appendChild(content);
    }

    // 暴露 API
    window.IdoFront.settingsManager.toggleSettingsMode = toggleSettingsMode;
    window.IdoFront.settingsManager.openTab = function(tab) {
        toggleSettingsMode(tab);
    };

})();