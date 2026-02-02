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
    // 记录进入设置前的主视图模式（chat / image-gallery 等）
    let previousMode = 'chat';
 
    // 设置标签注册表
    const settingsTabs = [];
    
    // 通用设置分区注册表（供主插件 / 其他插件往“通用设置”标签注入内容）
    // 说明：每个 section 支持可选字段 category/tags/advanced，用于在 UI 中分类、检索与折叠。
    const generalSections = [];

    const GENERAL_UI_STATE_STORAGE_KEY = 'ido.ui.settingsGeneral';

    // 通用设置页状态（仅会话内，避免每次重渲染丢失输入）
    const generalTabState = {
        query: '',
        showAdvanced: false,
        collapsedCategories: Object.create(null) // category -> boolean
    };

    function loadGeneralUIState() {
        let saved = null;
        try {
            saved = Framework?.storage?.getItem(GENERAL_UI_STATE_STORAGE_KEY);
        } catch (e) {
            saved = null;
        }

        if (!saved || typeof saved !== 'object') return;

        if (typeof saved.showAdvanced === 'boolean') {
            generalTabState.showAdvanced = saved.showAdvanced;
        }

        if (saved.collapsedCategories && typeof saved.collapsedCategories === 'object') {
            generalTabState.collapsedCategories = Object.assign(Object.create(null), saved.collapsedCategories);
        }
    }

    function saveGeneralUIState() {
        try {
            Framework?.storage?.setItem(GENERAL_UI_STATE_STORAGE_KEY, {
                showAdvanced: !!generalTabState.showAdvanced,
                collapsedCategories: generalTabState.collapsedCategories || {}
            });
        } catch (e) {
            // ignore
        }
    }
    
    // 保存容器引用，用于局部更新
    let mainContainer = null;
    let sidebarContainer = null;
    // 设置侧边栏列表容器引用（用于仅切换激活态）
    let sidebarListEl = null;
    // 主面板异步更新排队标记，避免同一宏任务内重复重建
    let pendingMainUpdate = false;

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
    
    function normalizeGeneralTags(tags) {
        if (!tags) return [];
        if (Array.isArray(tags)) {
            return tags
                .map(t => String(t || '').trim())
                .filter(Boolean);
        }
        if (typeof tags === 'string') {
            return tags
                .split(',')
                .map(t => t.trim())
                .filter(Boolean);
        }
        return [];
    }

    function inferGeneralCategory(section) {
        const id = String(section?.id || '').trim();
        const title = String(section?.title || '').trim();

        if (id === 'theme' || title.includes('主题')) return '外观';
        if (id === 'ai-services' || title.includes('AI 服务')) return 'AI 服务';
        if (id === 'performance' || title.includes('性能')) return '性能';

        // Channel/provider 级“规则/能力”设置：更适合归入“模型特性”而不是“通用”杂项
        if (
            id.startsWith('openai-') ||
            id.startsWith('gemini-') ||
            id.startsWith('claude-') ||
            id.includes('thinking') ||
            id.includes('reasoning')
        ) {
            return '模型特性';
        }

        return '其它';
    }

    function inferGeneralAdvanced(section) {
        const id = String(section?.id || '').trim();
        // 性能/实验性开关默认视为高级
        if (id === 'performance') return true;
        return false;
    }

    /**
     * 注册“通用设置”页面中的一个分区
     * @param {Object} section
     * @param {string} section.id - 分区 ID
     * @param {string} section.title - 分区标题
     * @param {string} [section.description] - 分区说明
     * @param {string} [section.icon] - Material 图标名或 SVG 片段
     * @param {string} [section.category] - 分类（用于通用设置页分组）
     * @param {string[]|string} [section.tags] - 搜索标签（数组或逗号分隔字符串）
     * @param {boolean} [section.advanced] - 是否为高级设置（默认隐藏，可在通用设置页开启显示）
     * @param {number} [section.order] - 排序权重（越小越靠前）
     * @param {Function} section.render - 渲染函数 (container, context, store) => void
     */
    window.IdoFront.settingsManager.registerGeneralSection = function(section) {
        if (!section || !section.id || typeof section.render !== 'function') {
            console.error('Invalid general settings section registration:', section);
            return;
        }
        
        const normalized = {
            id: section.id,
            title: section.title || section.id,
            description: section.description || '',
            icon: section.icon || 'tune',
            category: (section.category && String(section.category).trim()) || inferGeneralCategory(section),
            tags: normalizeGeneralTags(section.tags),
            advanced: (typeof section.advanced === 'boolean') ? section.advanced : inferGeneralAdvanced(section),
            order: (typeof section.order === 'number') ? section.order : 999,
            render: section.render
        };
        
        const existingIndex = generalSections.findIndex(s => s.id === normalized.id);
        if (existingIndex !== -1) {
            generalSections[existingIndex] = normalized;
        } else {
            generalSections.push(normalized);
        }
        
        generalSections.sort((a, b) => (a.order || 999) - (b.order || 999));
    };

    /**
     * 初始化设置管理器
     */
    window.IdoFront.settingsManager.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;

        // 读取通用设置 UI 状态（高级开关/折叠状态）
        loadGeneralUIState();
        
        // 注册核心设置标签
        registerCoreSettingsTabs();

        // 初始化设置 UI
        initSettingsUI();
        
        // 监听渠道/面具更新事件
        if (store.events) {
            // 渠道更新：保持原有刷新逻辑
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

            // 面具更新：若当前在“面具管理”标签，及时刷新列表
            store.events.on('personas:updated', () => {
                if (activeSettingsTab === 'personas' && mainContainer) {
                    // 使用统一刷新逻辑，更新标题、内容与侧边栏选中状态
                    try {
                        updateSettingsContent();
                    } catch (e) {
                        // 兜底：直接重渲染当前标签内容
                        const content = mainContainer.querySelector('.flex-1.overflow-y-auto');
                        const personaSettings = window.IdoFront.personaSettings;
                        if (content && personaSettings && personaSettings.render) {
                            personaSettings.render(content, context, store);
                        }
                    }
                }
            });

            // 当前面具切换（activePersonaId 变化）也需要刷新“面具列表”的【当前】徽章
            // 注意：切换面具不会触发 personas:updated，因此需要单独监听 persona:changed
            store.events.on('persona:changed', () => {
                if (activeSettingsTab === 'personas' && mainContainer) {
                    try {
                        updateSettingsContent();
                    } catch (e) {
                        const content = mainContainer.querySelector('.flex-1.overflow-y-auto');
                        const personaSettings = window.IdoFront.personaSettings;
                        if (content && personaSettings && personaSettings.render) {
                            personaSettings.render(content, context, store);
                        }
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

        // 通知外部：“设置系统已就绪”，供主题等插件延迟注册通用设置分区
        if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
            try {
                document.dispatchEvent(new CustomEvent('IdoFrontSettingsReady', {
                    detail: { manager: window.IdoFront.settingsManager }
                }));
            } catch (e) {
                console.warn('[settingsManager] failed to dispatch IdoFrontSettingsReady', e);
            }
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

        // 4. 通用设置（支持通过 registerGeneralSection 动态扩展）
        window.IdoFront.settingsManager.registerTab({
            id: 'general',
            icon: 'tune',
            label: '通用设置',
            order: 40,
            render: (container, ctx, st) => {
                renderGeneralTab(container, ctx, st);
            }
        });

        // 5. 关于
        window.IdoFront.settingsManager.registerTab({
            id: 'about',
            icon: 'info',
            label: '关于',
            order: 50,
            render: (container, ctx, st) => {
                renderAboutTab(container, ctx, st);
            }
        });
    }
    
    /**
     * 渲染"通用设置"标签页内容
     * 同时支持：
     * 1. 通过 registerGeneralSection() 注册的设置分区
     * 2. 通过 Framework.registerPlugin(SLOTS.SETTINGS_GENERAL, ...) 注册的插件设置
     */
    function renderGeneralTab(container, ctx, st) {
        container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-4';

        // ===== 顶部：搜索 + 高级开关 =====
        const controlsCard = document.createElement('div');
        controlsCard.className = 'ido-card p-4 space-y-3';

        const searchRow = document.createElement('div');
        searchRow.className = 'flex items-center gap-2';

        const searchIcon = document.createElement('span');
        searchIcon.className = 'material-symbols-outlined text-[18px] text-gray-400';
        searchIcon.textContent = 'search';
        searchRow.appendChild(searchIcon);

        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'ido-input w-full text-sm';
        searchInput.placeholder = '搜索设置（标题 / 描述 / 标签）';
        searchInput.value = generalTabState.query || '';
        searchRow.appendChild(searchInput);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded';
        clearBtn.title = '清空搜索';
        clearBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">close</span>';
        clearBtn.onclick = () => {
            generalTabState.query = '';
            searchInput.value = '';
            rerender();
            try { searchInput.focus(); } catch (e) {}
        };
        searchRow.appendChild(clearBtn);

        const hint = document.createElement('div');
        hint.className = 'text-[11px] text-gray-400';
        hint.textContent = '提示：支持搜索标题、说明与标签；插件插槽内容不参与搜索。';

        // 高级开关
        const advancedRow = document.createElement('div');
        advancedRow.className = 'flex items-center justify-between';

        const advancedLeft = document.createElement('div');
        const advancedLabel = document.createElement('div');
        advancedLabel.className = 'text-sm font-medium text-gray-700';
        advancedLabel.textContent = '显示实验性/高级选项';
        const advancedDesc = document.createElement('div');
        advancedDesc.className = 'text-xs text-gray-500 mt-0.5';
        advancedDesc.textContent = '包含性能优化、实验性与调试相关选项';
        advancedLeft.appendChild(advancedLabel);
        advancedLeft.appendChild(advancedDesc);

        const advancedToggle = document.createElement('label');
        advancedToggle.className = 'ido-form-switch';
        const advancedInput = document.createElement('input');
        advancedInput.type = 'checkbox';
        advancedInput.className = 'ido-form-switch__input';
        advancedInput.checked = !!generalTabState.showAdvanced;
        const advancedSlider = document.createElement('div');
        advancedSlider.className = 'ido-form-switch__slider';
        advancedToggle.appendChild(advancedInput);
        advancedToggle.appendChild(advancedSlider);

        advancedRow.appendChild(advancedLeft);
        advancedRow.appendChild(advancedToggle);

        controlsCard.appendChild(searchRow);
        controlsCard.appendChild(hint);
        controlsCard.appendChild(advancedRow);
        wrapper.appendChild(controlsCard);

        // ===== 主体：分类分组后的 sections =====
        const list = document.createElement('div');
        list.className = 'space-y-4';
        wrapper.appendChild(list);

        function normalizeText(value) {
            return String(value || '').trim().toLowerCase();
        }

        function matchesSection(section, query) {
            const q = normalizeText(query);
            if (!q) return true;

            const haystacks = [
                section.id,
                section.title,
                section.description,
                section.category,
                ...(Array.isArray(section.tags) ? section.tags : [])
            ].map(normalizeText);

            return haystacks.some(s => s.includes(q));
        }

        function getCategoryOrderIndex(category) {
            const order = ['常用', '外观', 'AI 服务', '模型特性', '性能', '其它'];
            const idx = order.indexOf(category);
            return idx === -1 ? 999 : idx;
        }

        function renderCategoryGroup(category, sections, queryActive) {
            const group = document.createElement('div');
            group.className = 'space-y-3';

            const headerBtn = document.createElement('button');
            headerBtn.type = 'button';
            headerBtn.className = 'w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors';

            const left = document.createElement('div');
            left.className = 'flex items-center gap-2';

            const title = document.createElement('div');
            title.className = 'text-sm font-semibold text-gray-800';
            title.textContent = category;

            const count = document.createElement('span');
            count.className = 'text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500';
            count.textContent = `${sections.length}`;

            left.appendChild(title);
            left.appendChild(count);

            const right = document.createElement('div');
            right.className = 'flex items-center gap-2 text-gray-400';

            const arrow = document.createElement('span');
            arrow.className = 'material-symbols-outlined text-[18px] transition-transform';
            arrow.textContent = 'expand_more';
            right.appendChild(arrow);

            headerBtn.appendChild(left);
            headerBtn.appendChild(right);

            const collapsed = queryActive
                ? false
                : (generalTabState.collapsedCategories[category] === true);

            if (!collapsed) {
                arrow.style.transform = 'rotate(180deg)';
            }

            const body = document.createElement('div');
            body.className = 'space-y-4';
            body.style.display = collapsed ? 'none' : '';

            sections.forEach(section => {
                body.appendChild(renderSettingsSection(section, ctx, st));
            });

            headerBtn.onclick = () => {
                if (queryActive) return;
                const next = !(generalTabState.collapsedCategories[category] === true);
                generalTabState.collapsedCategories[category] = next;
                saveGeneralUIState();
                rerender();
            };

            group.appendChild(headerBtn);
            group.appendChild(body);
            return group;
        }

        function renderPluginGroup(pluginComponents) {
            const group = document.createElement('div');
            group.className = 'space-y-3';

            const header = document.createElement('div');
            header.className = 'px-2';

            const title = document.createElement('div');
            title.className = 'text-sm font-semibold text-gray-800';
            title.textContent = '插件提供的设置';

            const desc = document.createElement('div');
            desc.className = 'text-[11px] text-gray-400 mt-0.5';
            desc.textContent = '来自 slot-settings-general（当前不参与搜索/分类）。';

            header.appendChild(title);
            header.appendChild(desc);

            const body = document.createElement('div');
            body.className = 'space-y-4';

            pluginComponents.forEach(component => {
                if (component instanceof HTMLElement) {
                    body.appendChild(component);
                } else if (typeof component === 'string') {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = component;
                    body.appendChild(wrapper);
                }
            });

            group.appendChild(header);
            group.appendChild(body);
            return group;
        }

        function collectPluginComponents() {
            if (!ctx || typeof ctx.getDynamicPlugins !== 'function') {
                return [];
            }
            const slotName = ctx.SLOTS?.SETTINGS_GENERAL || 'slot-settings-general';
            try {
                const comps = ctx.getDynamicPlugins(slotName, { context: ctx, store: st });
                return Array.isArray(comps) ? comps : [];
            } catch (e) {
                console.warn('[settingsManager] getDynamicPlugins(SETTINGS_GENERAL) failed', e);
                return [];
            }
        }

        function rerender() {
            list.innerHTML = '';

            const query = String(generalTabState.query || '').trim();
            const queryActive = query.length > 0;

            clearBtn.style.visibility = queryActive ? '' : 'hidden';

            const visibleSections = generalSections
                .filter(section => {
                    if (queryActive) return matchesSection(section, query);
                    if (generalTabState.showAdvanced) return true;
                    return section.advanced !== true;
                });

            if (visibleSections.length > 0) {
                const byCategory = new Map();
                visibleSections.forEach(section => {
                    const category = section.category || '其它';
                    if (!byCategory.has(category)) byCategory.set(category, []);
                    byCategory.get(category).push(section);
                });

                const categories = Array.from(byCategory.keys()).sort((a, b) => {
                    const ai = getCategoryOrderIndex(a);
                    const bi = getCategoryOrderIndex(b);
                    if (ai !== bi) return ai - bi;
                    return a.localeCompare(b, 'zh-Hans-CN');
                });

                categories.forEach(category => {
                    const sections = byCategory.get(category) || [];
                    // 维持原 section.order 顺序
                    sections.sort((a, b) => (a.order || 999) - (b.order || 999));
                    list.appendChild(renderCategoryGroup(category, sections, queryActive));
                });
            }

            const pluginComponents = collectPluginComponents();
            if (pluginComponents.length > 0) {
                list.appendChild(renderPluginGroup(pluginComponents));
            }

            if (list.childNodes.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'ido-empty';
                empty.textContent = queryActive ? '没有匹配的设置项' : '暂无通用设置';
                list.appendChild(empty);
            }
        }

        // 事件绑定
        searchInput.oninput = () => {
            generalTabState.query = searchInput.value;
            rerender();
        };

        advancedInput.onchange = () => {
            generalTabState.showAdvanced = advancedInput.checked;
            saveGeneralUIState();
            rerender();
        };

        rerender();
        container.appendChild(wrapper);
    }
    
    /**
     * 渲染单个设置分区
     */
    function renderSettingsSection(section, ctx, st) {
        const card = document.createElement('div');
        card.className = 'ido-card p-4 space-y-2';
        
        const header = document.createElement('div');
        header.className = 'flex items-center gap-2';
        
        if (section.icon) {
            if (section.icon.indexOf('<svg') === 0) {
                const iconWrapper = document.createElement('div');
                iconWrapper.className = 'text-gray-500 flex items-center justify-center w-[18px] h-[18px]';
                iconWrapper.innerHTML = section.icon;
                header.appendChild(iconWrapper);
            } else {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'material-symbols-outlined text-[18px] text-gray-500';
                iconSpan.textContent = section.icon;
                header.appendChild(iconSpan);
            }
        }
        
        const title = document.createElement('span');
        title.className = 'font-medium text-gray-800';
        title.textContent = section.title || section.id;
        header.appendChild(title);
        
        card.appendChild(header);
        
        if (section.description) {
            const desc = document.createElement('p');
            desc.className = 'text-xs text-gray-500';
            desc.textContent = section.description;
            card.appendChild(desc);
        }
        
        const body = document.createElement('div');
        body.className = 'mt-2 space-y-2';
        
        try {
            section.render(body, ctx, st);
        } catch (e) {
            console.error('General settings section render error:', e);
            body.innerHTML = '<div class="text-red-500 text-xs">渲染错误: ' + (e.message || e) + '</div>';
        }
        
        card.appendChild(body);
        return card;
    }
    
    /**
     * 渲染"关于"标签页内容
     */
    function renderAboutTab(container, ctx, st) {
        container.innerHTML = '';
        
        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-3 max-w-md mx-auto';
        
        // Logo 和应用名称（紧凑版）
        const header = document.createElement('div');
        header.className = 'text-center py-3';
        header.innerHTML = `
            <img src="icons/icon-256.png" alt="IdoFront" class="w-12 h-12 mx-auto mb-2 rounded-xl shadow">
            <h1 class="text-lg font-bold text-gray-800">IdoFront</h1>
            <p class="text-xs text-gray-500">模块化的大模型聊天前端</p>
        `;
        wrapper.appendChild(header);
        
        // 获取平台信息
        const config = window.IdoFront?.updater?.config;
        let platformName = '浏览器扩展';
        if (config?.platform) {
            if (config.platform.isElectron) {
                platformName = 'Windows 桌面版';
            } else if (config.platform.isAndroid) {
                platformName = 'Android 应用';
            }
        }
        
        // 版本信息卡片（紧凑版）
        const versionCard = document.createElement('div');
        versionCard.className = 'ido-card p-3';
        versionCard.innerHTML = `
            <div class="flex items-center justify-between text-xs">
                <div>
                    <div class="text-gray-500">当前版本</div>
                    <div id="about-version-display" class="text-sm font-semibold text-gray-800">加载中...</div>
                </div>
                <div class="text-right">
                    <div class="text-gray-500">运行平台</div>
                    <div class="text-sm font-medium text-gray-700">${platformName}</div>
                </div>
            </div>
        `;
        wrapper.appendChild(versionCard);
        
        // 异步获取版本号并更新显示
        const updaterService = window.IdoFront?.updater?.service;
        if (updaterService && typeof updaterService.getCurrentVersion === 'function') {
            updaterService.getCurrentVersion().then(version => {
                const versionEl = document.getElementById('about-version-display');
                if (versionEl) {
                    versionEl.textContent = 'v' + version;
                }
            }).catch(e => {
                console.warn('[About] 获取版本号失败:', e);
                const versionEl = document.getElementById('about-version-display');
                if (versionEl) {
                    versionEl.textContent = 'v1.0.0';
                }
            });
        } else {
            // 无更新服务，尝试从 manifest 获取
            setTimeout(() => {
                const versionEl = document.getElementById('about-version-display');
                if (versionEl) {
                    let version = '1.0.0';
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
                        try {
                            version = chrome.runtime.getManifest().version;
                        } catch (e) {}
                    }
                    versionEl.textContent = 'v' + version;
                }
            }, 0);
        }
        
        // 检查更新按钮（紧凑版）
        const updateSection = document.createElement('div');
        updateSection.className = 'ido-card p-3';
        
        const updateBtn = document.createElement('button');
        updateBtn.className = 'w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors';
        updateBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">sync</span>
            <span>检查更新</span>
        `;
        
        const updateStatus = document.createElement('div');
        updateStatus.className = 'text-center text-xs text-gray-500 mt-2 hidden';
        
        updateBtn.onclick = async () => {
            updateBtn.disabled = true;
            updateBtn.innerHTML = `
                <span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>检查中...</span>
            `;
            updateBtn.className = 'w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-400 text-white rounded-lg text-sm font-medium cursor-not-allowed';
            
            try {
                if (updaterService && typeof updaterService.checkForUpdate === 'function') {
                    const result = await updaterService.checkForUpdate({ silent: false });
                    
                    if (result.hasUpdate) {
                        // 有更新，显示更新对话框
                        const updaterUI = window.IdoFront?.updater?.ui;
                        if (updaterUI && typeof updaterUI.createUpdateDialog === 'function') {
                            updaterUI.createUpdateDialog(result);
                        }
                        updateStatus.textContent = `发现新版本 v${result.latestVersion}`;
                        updateStatus.className = 'text-center text-sm text-green-600 mt-3';
                    } else {
                        updateStatus.textContent = '已是最新版本';
                        updateStatus.className = 'text-center text-xs text-gray-500 mt-2';
                    }
                } else {
                    updateStatus.textContent = '更新服务不可用';
                    updateStatus.className = 'text-center text-xs text-red-500 mt-2';
                }
            } catch (error) {
                console.error('[About] 检查更新失败:', error);
                updateStatus.textContent = '检查更新失败: ' + (error.message || '网络错误');
                updateStatus.className = 'text-center text-xs text-red-500 mt-2';
            } finally {
                updateBtn.disabled = false;
                updateBtn.innerHTML = `
                    <span class="material-symbols-outlined text-[16px]">sync</span>
                    <span>检查更新</span>
                `;
                updateBtn.className = 'w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors';
            }
        };
        
        updateSection.appendChild(updateBtn);
        updateSection.appendChild(updateStatus);
        wrapper.appendChild(updateSection);
        
        // 项目信息（紧凑版）
        const infoCard = document.createElement('div');
        infoCard.className = 'ido-card p-3 space-y-1';
        
        const githubConfig = config?.github || { owner: 'HCPTangHY', repo: 'IdoFront' };
        const repoUrl = `https://github.com/${githubConfig.owner}/${githubConfig.repo}`;
        
        const linkItemClass = 'flex items-center gap-2 p-1.5 -mx-1.5 hover:bg-gray-50 rounded transition-colors group';
        const linkTitleClass = 'text-xs font-medium text-gray-800 group-hover:text-blue-600 transition-colors';
        const linkIconClass = 'material-symbols-outlined text-[14px] text-gray-400 group-hover:text-blue-500 transition-colors';
        
        infoCard.innerHTML = `
            <div class="text-xs font-medium text-gray-700 mb-1">项目链接</div>
            <a href="${repoUrl}" target="_blank" rel="noopener noreferrer" class="${linkItemClass}">
                <div class="w-6 h-6 bg-gray-900 rounded flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-white text-[14px]">code</span>
                </div>
                <span class="${linkTitleClass} flex-1">GitHub 仓库</span>
                <span class="${linkIconClass}">open_in_new</span>
            </a>
            <a href="${repoUrl}/releases" target="_blank" rel="noopener noreferrer" class="${linkItemClass}">
                <div class="w-6 h-6 bg-green-500 rounded flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-white text-[14px]">package_2</span>
                </div>
                <span class="${linkTitleClass} flex-1">版本发布</span>
                <span class="${linkIconClass}">open_in_new</span>
            </a>
            <a href="${repoUrl}/issues" target="_blank" rel="noopener noreferrer" class="${linkItemClass}">
                <div class="w-6 h-6 bg-orange-500 rounded flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-white text-[14px]">bug_report</span>
                </div>
                <span class="${linkTitleClass} flex-1">问题反馈</span>
                <span class="${linkIconClass}">open_in_new</span>
            </a>
        `;
        wrapper.appendChild(infoCard);
        
        // 技术栈和特性（紧凑版）
        const featuresCard = document.createElement('div');
        featuresCard.className = 'ido-card p-3';
        featuresCard.innerHTML = `
            <div class="text-xs font-medium text-gray-700 mb-2">特性</div>
            <div class="flex flex-wrap gap-1">
                <span class="px-1.5 py-0.5 text-[10px] bg-blue-50 text-blue-600 rounded">插件系统</span>
                <span class="px-1.5 py-0.5 text-[10px] bg-purple-50 text-purple-600 rounded">多渠道</span>
                <span class="px-1.5 py-0.5 text-[10px] bg-green-50 text-green-600 rounded">流式输出</span>
                <span class="px-1.5 py-0.5 text-[10px] bg-orange-50 text-orange-600 rounded">思考链</span>
                <span class="px-1.5 py-0.5 text-[10px] bg-pink-50 text-pink-600 rounded">面具</span>
                <span class="px-1.5 py-0.5 text-[10px] bg-cyan-50 text-cyan-600 rounded">跨平台</span>
            </div>
        `;
        wrapper.appendChild(featuresCard);
        
        // 版权信息（紧凑版）
        const footer = document.createElement('div');
        footer.className = 'text-center text-[10px] text-gray-400 pt-2';
        footer.innerHTML = `© ${new Date().getFullYear()} IdoFront · MIT`;
        wrapper.appendChild(footer);
        
        container.appendChild(wrapper);
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

        // 记录进入设置前的模式（避免从 settings 再次进入 settings 覆盖）
        if (context && typeof context.getCurrentMode === 'function') {
            const modeNow = context.getCurrentMode();
            if (modeNow && modeNow !== 'settings') {
                previousMode = modeNow;
            }
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
        backBtn.onclick = () => {
            // 计算返回目标模式（默认为 chat）
            const targetMode = previousMode && previousMode !== 'settings' ? previousMode : 'chat';

            // 默认情况：直接回到 chat
            if (targetMode === 'chat') {
                if (context && typeof context.setMode === 'function') {
                    context.setMode('chat');
                }
                return;
            }

            // 非 chat 模式（例如 image-gallery），交由对应主视图插件通过事件接管返回逻辑
            if (context && context.events && typeof context.events.emit === 'function') {
                try {
                    context.events.emit('settings:back', { previousMode: targetMode });
                } catch (e) {
                    console.warn('[settingsManager] settings:back handler error:', e);
                }
            }
        };
        
        const title = document.createElement('span');
        title.className = "font-semibold text-gray-700";
        title.textContent = "设置";

        header.appendChild(backBtn);
        header.appendChild(title);
        container.appendChild(header);

        // 2. Tabs List
        const list = document.createElement('div');
        list.className = "flex-1 overflow-y-auto p-2 space-y-1";
        sidebarListEl = list;
        
        settingsTabs.forEach(tab => {
            const btn = document.createElement('button');
            const isActive = tab.id === activeSettingsTab;
            btn.className = `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
            }`;
            btn.dataset.tabId = tab.id;
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
        
        // 异步重建内容（离屏渲染后一次性替换，减少同步 innerHTML 操作）
        if (!pendingMainUpdate) {
            pendingMainUpdate = true;
            setTimeout(() => {
                pendingMainUpdate = false;
                renderSettingsContent(content);
            }, 0);
        }
        
        // 更新侧边栏激活态（不重建侧边栏也不清空）
        if (sidebarListEl) {
            const buttons = sidebarListEl.querySelectorAll('button[data-tab-id]');
            buttons.forEach(btn => {
                const isActive = btn.dataset.tabId === activeSettingsTab;
                btn.className = `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
                }`;
            });
        }
    }
    
    /**
     * 渲染设置内容区域（动态查找渲染器）
     */
    function renderSettingsContent(content) {
        const activeTab = settingsTabs.find(t => t.id === activeSettingsTab);
        const temp = document.createElement('div');
        
        if (activeTab && typeof activeTab.render === 'function') {
            try {
                // 离屏容器渲染，避免直接在可见 DOM 上多次 innerHTML
                activeTab.render(temp, context, store);
            } catch (e) {
                console.error(`Settings tab render error (${activeSettingsTab}):`, e);
                const err = document.createElement('div');
                err.className = 'text-red-500';
                err.textContent = `渲染错误: ${e.message}`;
                temp.appendChild(err);
            }
        } else {
            const empty = document.createElement('div');
            empty.className = 'text-gray-400 text-center mt-10';
            empty.textContent = '未找到设置页面';
            temp.appendChild(empty);
        }
        
        // 一次性替换子节点，减少多次写入
        content.replaceChildren(...Array.from(temp.childNodes));
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
    
    /**
     * 刷新当前设置标签页内容
     * 供设置子模块在数据变化后调用
     */
    window.IdoFront.settingsManager.refreshCurrentTab = function() {
        if (activeSettingsTab && mainContainer) {
            updateSettingsContent();
        }
    };

})();