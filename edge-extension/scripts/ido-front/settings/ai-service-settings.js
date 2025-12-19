/**
 * AI Service Settings
 * AI 服务相关设置（注册到通用设置）
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.aiServiceSettings = window.IdoFront.aiServiceSettings || {};

    let store = null;
    let context = null;

    /**
     * 初始化并注册到设置管理器
     */
    window.IdoFront.aiServiceSettings.init = function(storeInstance, frameworkInstance) {
        store = storeInstance;
        context = frameworkInstance;
        
        const settingsManager = window.IdoFront.settingsManager;
        if (settingsManager && settingsManager.registerGeneralSection) {
            settingsManager.registerGeneralSection({
                id: 'ai-services',
                title: 'AI 服务',
                description: '配置 AI 自动化服务功能',
                icon: 'auto_awesome',
                order: 10,
                render: renderSection
            });
        }
    };

    /**
     * 渲染设置分区内容
     */
    function renderSection(container, ctx, st) {
        container.innerHTML = '';
        
        // 自动生成标题开关
        const autoTitleRow = createToggleRow({
            id: 'autoGenerateTitle',
            label: '自动生成对话标题',
            description: '首轮对话后由 AI 自动总结生成简短标题',
            checked: store.getSetting('autoGenerateTitle') !== false,
            onChange: (checked) => {
                store.setSetting('autoGenerateTitle', checked);
                // 显示/隐藏模型选择行
                const modelRow = document.getElementById('titleModelRow');
                if (modelRow) {
                    modelRow.style.display = checked ? 'flex' : 'none';
                }
            }
        });
        container.appendChild(autoTitleRow);
        
        // 标题生成模型选择
        const modelRow = createModelSelectorRow();
        modelRow.id = 'titleModelRow';
        // 如果自动生成关闭，隐藏模型选择
        if (store.getSetting('autoGenerateTitle') === false) {
            modelRow.style.display = 'none';
        }
        container.appendChild(modelRow);
    }

    /**
     * 创建模型选择行
     */
    function createModelSelectorRow() {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between py-2 pl-4 border-l-2 border-gray-200 ml-2';
        
        const left = document.createElement('div');
        left.className = 'flex-1';
        
        const label = document.createElement('div');
        label.className = 'text-sm font-medium text-gray-700';
        label.textContent = '总结模型';
        left.appendChild(label);
        
        const desc = document.createElement('div');
        desc.className = 'text-xs text-gray-500 mt-0.5';
        desc.textContent = '选择用于生成标题的模型';
        left.appendChild(desc);
        
        // 模型选择按钮
        const selectBtn = document.createElement('button');
        selectBtn.className = 'ido-btn ido-btn--secondary ido-btn--sm';
        selectBtn.style.minWidth = '100px';
        selectBtn.style.maxWidth = '180px';
        selectBtn.style.justifyContent = 'space-between';
        selectBtn.style.gap = '4px';
        
        // 更新按钮文本
        const updateBtnText = () => {
            const channelId = store.getSetting('titleGeneratorChannelId');
            const model = store.getSetting('titleGeneratorModel');
            
            if (channelId && model) {
                const channel = store.state.channels.find(c => c.id === channelId);
                if (channel) {
                    // 只显示模型名称，渠道信息通过 tooltip 显示
                    selectBtn.title = `${channel.name} / ${model}`;
                    selectBtn.innerHTML = `
                        <span class="truncate">${model}</span>
                        <span class="material-symbols-outlined text-[16px] flex-shrink-0">expand_more</span>
                    `;
                    return;
                }
            }
            
            selectBtn.title = '点击选择模型';
            selectBtn.innerHTML = `
                <span class="text-gray-400">跟随对话</span>
                <span class="material-symbols-outlined text-[16px] flex-shrink-0">expand_more</span>
            `;
        };
        
        updateBtnText();
        
        selectBtn.onclick = () => {
            openModelSelector(updateBtnText);
        };
        
        row.appendChild(left);
        row.appendChild(selectBtn);
        
        return row;
    }

    /**
     * 打开模型选择面板
     */
    function openModelSelector(onSelect) {
        if (!context || !context.setCustomPanel) return;
        
        context.setCustomPanel('right', (container) => {
            renderModelSelectorPanel(container, onSelect);
        });
        
        context.togglePanel('right', true);
    }

    /**
     * 渲染模型选择面板
     */
    function renderModelSelectorPanel(container, onSelect) {
        // Header
        const header = document.createElement('div');
        header.className = 'ido-panel__header';
        
        const title = document.createElement('span');
        title.className = 'ido-panel__title';
        title.textContent = '选择总结模型';
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ido-icon-btn';
        closeBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">close</span>';
        closeBtn.onclick = () => {
            context.togglePanel('right', false);
        };
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        container.appendChild(header);
        
        // Content
        const content = document.createElement('div');
        content.className = 'ido-panel__content';
        
        // 默认选项：使用当前对话模型
        const defaultOption = document.createElement('button');
        defaultOption.className = 'ido-list__item w-full text-left mb-4';
        defaultOption.style.border = '1px dashed var(--ido-color-border)';
        defaultOption.style.borderRadius = 'var(--ido-radius-md)';
        
        const currentChannelId = store.getSetting('titleGeneratorChannelId');
        if (!currentChannelId) {
            defaultOption.classList.add('ido-list__item--active');
        }
        
        defaultOption.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[18px]">auto_mode</span>
                <span>使用当前对话模型</span>
            </div>
            <div class="text-xs text-gray-500 mt-1 ml-7">每次生成时使用当前对话所选的模型</div>
        `;
        
        defaultOption.onclick = () => {
            closeModelSelectorAndSave(null, null, onSelect);
        };
        
        content.appendChild(defaultOption);
        
        // 分隔线
        const divider = document.createElement('div');
        divider.className = 'ido-divider';
        divider.style.margin = 'var(--ido-spacing-md) 0';
        content.appendChild(divider);
        
        // 指定模型标题
        // const specifyTitle = document.createElement('div');
        // specifyTitle.className = 'text-xs text-gray-500 mb-2';
        // specifyTitle.textContent = '或选择指定模型：';
        // content.appendChild(specifyTitle);
        
        // 渠道列表
        const enabledChannels = store.state.channels.filter(c => c.enabled);
        
        if (enabledChannels.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ido-empty';
            empty.textContent = '无可用渠道，请先在设置中配置';
            content.appendChild(empty);
        } else {
            enabledChannels.forEach(channel => {
                const channelBlock = createChannelBlock(channel, onSelect);
                content.appendChild(channelBlock);
            });
        }
        
        container.appendChild(content);
    }

    /**
     * 创建渠道块
     */
    function createChannelBlock(channel, onSelect) {
        const block = document.createElement('div');
        block.style.marginBottom = 'var(--ido-spacing-lg)';
        
        // Channel Header
        const channelHeader = document.createElement('div');
        channelHeader.className = 'flex items-center gap-2 pb-2 border-b border-gray-100 mb-2';
        
        const channelName = document.createElement('span');
        channelName.className = 'font-medium text-sm text-gray-700';
        channelName.textContent = channel.name;
        
        const channelBadge = document.createElement('span');
        channelBadge.className = 'ido-badge ido-badge--primary';
        channelBadge.textContent = channel.type;
        
        channelHeader.appendChild(channelName);
        channelHeader.appendChild(channelBadge);
        block.appendChild(channelHeader);
        
        // Models List
        const modelsList = document.createElement('div');
        modelsList.className = 'ido-list';
        
        const currentChannelId = store.getSetting('titleGeneratorChannelId');
        const currentModel = store.getSetting('titleGeneratorModel');
        
        if (!channel.models || channel.models.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'text-xs text-gray-400 py-2';
            empty.textContent = '无可用模型';
            modelsList.appendChild(empty);
        } else {
            channel.models.forEach(model => {
                const item = document.createElement('button');
                item.className = 'ido-list__item w-full text-left text-xs';
                
                const isSelected = currentChannelId === channel.id && currentModel === model;
                if (isSelected) {
                    item.classList.add('ido-list__item--active');
                }
                
                item.textContent = model;
                
                item.onclick = () => {
                    closeModelSelectorAndSave(channel.id, model, onSelect);
                };
                
                modelsList.appendChild(item);
            });
        }
        
        block.appendChild(modelsList);
        return block;
    }

    /**
     * 关闭模型选择器并保存设置
     */
    function closeModelSelectorAndSave(channelId, model, onSelect) {
        const layout = window.FrameworkLayout;
        
        if (layout && layout.customContainers && layout.customContainers.right) {
            const container = layout.customContainers.right;
            container.innerHTML = '';
            container.dataset.hasCustomContent = 'false';
            // 隐藏容器，避免看到默认面板内容在关闭过程中渲染
            container.style.visibility = 'hidden';
        }
        
        // 关闭面板
        context.togglePanel('right', false);
        
        // 等面板关闭动画完成后恢复可见性并保存设置
        setTimeout(() => {
            if (layout && layout.customContainers && layout.customContainers.right) {
                layout.customContainers.right.style.visibility = '';
            }
            store.setSetting('titleGeneratorChannelId', channelId);
            store.setSetting('titleGeneratorModel', model);
            if (onSelect) onSelect();
        }, 300);
    }

    /**
     * 创建开关行
     */
    function createToggleRow(options) {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between py-2';
        
        const left = document.createElement('div');
        left.className = 'flex-1';
        
        const label = document.createElement('div');
        label.className = 'text-sm font-medium text-gray-700';
        label.textContent = options.label;
        left.appendChild(label);
        
        if (options.description) {
            const desc = document.createElement('div');
            desc.className = 'text-xs text-gray-500 mt-0.5';
            desc.textContent = options.description;
            left.appendChild(desc);
        }
        
        // Toggle switch
        const toggle = document.createElement('label');
        toggle.className = 'relative inline-flex items-center cursor-pointer';
        
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'sr-only peer';
        input.checked = options.checked;
        input.onchange = () => options.onChange(input.checked);
        
        const slider = document.createElement('div');
        slider.className = 'w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500';
        
        toggle.appendChild(input);
        toggle.appendChild(slider);
        
        row.appendChild(left);
        row.appendChild(toggle);
        
        return row;
    }

})();