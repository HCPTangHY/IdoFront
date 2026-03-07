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

        const modelPicker = window.IdoFront.modelPicker;
        if (modelPicker && typeof modelPicker.init === 'function') {
            modelPicker.init(context, store);
        }
        
        const settingsManager = window.IdoFront.settingsManager;
        if (settingsManager && settingsManager.registerGeneralSection) {
            settingsManager.registerGeneralSection({
                id: 'ai-services',
                title: 'AI 服务',
                description: '配置 AI 自动化服务功能',
                icon: 'auto_awesome',
                category: 'AI 服务',
                tags: ['title', '标题', '自动生成', '总结', '模型'],
                advanced: false,
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
        const modelPicker = window.IdoFront.modelPicker;
        if (!modelPicker || typeof modelPicker.open !== 'function') return;

        modelPicker.open({
            title: '选择总结模型',
            allowFollowCurrent: true,
            followCurrentLabel: '使用当前对话模型',
            followCurrentDescription: '每次生成时使用当前对话所选的模型',
            selectedChannelId: store.getSetting('titleGeneratorChannelId') || null,
            selectedModel: store.getSetting('titleGeneratorModel') || null,
            onSelect: (channelId, model) => {
                store.setSetting('titleGeneratorChannelId', channelId);
                store.setSetting('titleGeneratorModel', model);
                if (onSelect) onSelect();
            }
        });
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
        toggle.className = 'ido-form-switch';
        
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'ido-form-switch__input';
        input.checked = options.checked;
        input.onchange = () => options.onChange(input.checked);
        
        const slider = document.createElement('div');
        slider.className = 'ido-form-switch__slider';
        
        toggle.appendChild(input);
        toggle.appendChild(slider);
        
        row.appendChild(left);
        row.appendChild(toggle);
        
        return row;
    }

})();