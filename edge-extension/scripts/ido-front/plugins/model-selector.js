/**
 * Model Selector Plugin
 * 按钮 + 右侧面板的模型选择器
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.modelSelector = window.IdoFront.modelSelector || {};

    let context = null;
    let store = null;
    let buttonElement = null;

    window.IdoFront.modelSelector.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;

        // 监听对话切换，更新按钮显示
        store.events.on('updated', () => {
            updateButtonState();
        });
        
        // 监听渠道更新事件，自动刷新模型选择面板
        store.events.on('channels:updated', () => {
            // 如果模型选择面板当前是打开的，则刷新它
            const rightPanel = context.panels?.right;
            if (rightPanel && rightPanel.visible) {
                // 检查当前显示的是否是模型选择面板
                const panelContainer = document.querySelector('[data-panel="right"] .ido-panel__content');
                if (panelContainer) {
                    // 重新渲染模型选择面板
                    openModelPanel();
                }
            }
        });
    };

    window.IdoFront.modelSelector.render = function(container) {
        // 创建模型选择按钮（紧凑图标模式）
        const button = document.createElement('button');
        button.className = 'ido-icon-btn';
        button.id = 'model-selector-button';
        button.title = '选择模型';
        
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-[20px]';
        icon.textContent = 'tune';
        
        // 指示点（已选择时显示）
        const indicator = document.createElement('span');
        indicator.className = 'ido-status-dot ido-status-dot--active hidden';
        indicator.style.position = 'absolute';
        indicator.style.top = '0.125rem';
        indicator.style.right = '0.125rem';
        indicator.id = 'model-indicator';
        
        button.style.position = 'relative';
        button.appendChild(icon);
        button.appendChild(indicator);
        
        button.onclick = () => {
            openModelPanel();
        };
        
        buttonElement = button;
        container.appendChild(button);
        
        // 初始化按钮状态
        updateButtonState();
    };

    function updateButtonState() {
        if (!buttonElement) return;
        
        const indicator = buttonElement.querySelector('#model-indicator');
        if (!indicator) return;
        
        const conv = store.getActiveConversation();
        const modelInfoEl = document.getElementById('model-info');
        
        if (!conv || !conv.selectedChannelId || !conv.selectedModel) {
            // 未选择时显示蓝点提示
            indicator.classList.remove('hidden');
            buttonElement.title = "选择模型";
            if (modelInfoEl) {
                modelInfoEl.textContent = '';
            }
            return;
        }
        
        const channel = store.state.channels.find(c => c.id === conv.selectedChannelId);
        if (channel) {
            // 已选择时隐藏蓝点
            indicator.classList.add('hidden');
            const modelText = `${channel.name} / ${conv.selectedModel}`;
            buttonElement.title = modelText;
            if (modelInfoEl) {
                modelInfoEl.textContent = modelText;
            }
        } else {
            // 渠道不存在时显示蓝点提示
            indicator.classList.remove('hidden');
            buttonElement.title = "选择模型";
            if (modelInfoEl) {
                modelInfoEl.textContent = '';
            }
        }
    }

    function openModelPanel() {
        if (!context || !context.setCustomPanel) return;
        
        context.setCustomPanel('right', (container) => {
            renderModelPanel(container);
        });
        
        context.togglePanel('right', true);
    }

    function renderModelPanel(container) {
        // Header
        const header = document.createElement('div');
        header.className = 'ido-panel__header';
        
        const title = document.createElement('span');
        title.className = 'ido-panel__title';
        title.textContent = '选择模型';
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ido-icon-btn';
        closeBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">close</span>';
        closeBtn.onclick = () => {
            // 尝试关闭面板（框架会根据当前状态决定是切换回默认面板还是真正关闭）
            context.togglePanel('right', false);
        };
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        container.appendChild(header);
        
        // Content
        const content = document.createElement('div');
        content.className = 'ido-panel__content';
        
        const conv = store.getActiveConversation();
        const enabledChannels = store.state.channels.filter(c => c.enabled);
        
        if (enabledChannels.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ido-empty';
            empty.textContent = '无可用渠道，请先在设置中配置';
            content.appendChild(empty);
        } else {
            enabledChannels.forEach(channel => {
                const channelBlock = createChannelBlock(channel, conv);
                content.appendChild(channelBlock);
            });
        }
        
        container.appendChild(content);
    }

    function createChannelBlock(channel, conv) {
        const block = document.createElement('div');
        block.style.marginBottom = 'var(--ido-spacing-xl)';
        
        // Channel Header
        const channelHeader = document.createElement('div');
        channelHeader.className = 'ido-card__header';
        channelHeader.style.paddingBottom = 'var(--ido-spacing-sm)';
        channelHeader.style.borderBottom = '1px solid var(--ido-color-border)';
        channelHeader.style.marginBottom = 'var(--ido-spacing-sm)';
        channelHeader.style.display = 'flex';
        channelHeader.style.alignItems = 'center';
        channelHeader.style.justifyContent = 'space-between';
        
        // 左侧：渠道名称和类型
        const leftGroup = document.createElement('div');
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = 'var(--ido-spacing-sm)';
        
        const channelName = document.createElement('span');
        channelName.style.fontWeight = '500';
        channelName.style.color = 'var(--ido-color-text-primary)';
        channelName.textContent = channel.name;
        
        const channelBadge = document.createElement('span');
        channelBadge.className = 'ido-badge ido-badge--primary';
        channelBadge.textContent = channel.type;
        
        leftGroup.appendChild(channelName);
        leftGroup.appendChild(channelBadge);
        
        // 右侧：编辑按钮
        const editBtn = document.createElement('button');
        editBtn.className = 'ido-icon-btn';
        editBtn.title = '编辑渠道';
        editBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">edit</span>';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            // 打开渠道编辑器，保存后返回到模型选择面板
            const channelEditor = window.IdoFront.channelEditor;
            if (channelEditor && channelEditor.open) {
                channelEditor.open(channel, context, store, {
                    onSave: () => {
                        // 保存后重新打开模型选择面板
                        openModelPanel();
                    }
                });
            }
        };
        
        channelHeader.appendChild(leftGroup);
        channelHeader.appendChild(editBtn);
        block.appendChild(channelHeader);
        
        // Models List
        const modelsList = document.createElement('div');
        modelsList.className = 'ido-list';
        
        if (!channel.models || channel.models.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ido-empty';
            empty.style.fontSize = '0.75rem';
            empty.style.padding = 'var(--ido-spacing-sm) 0';
            empty.textContent = '无可用模型';
            modelsList.appendChild(empty);
        } else {
            channel.models.forEach(model => {
                const modelItem = createModelItem(channel, model, conv);
                modelsList.appendChild(modelItem);
            });
        }
        
        block.appendChild(modelsList);
        return block;
    }

    function createModelItem(channel, model, conv) {
        const item = document.createElement('button');
        item.className = 'ido-list__item';
        item.style.width = '100%';
        item.style.textAlign = 'left';
        item.style.fontSize = '0.75rem';
        
        const isSelected = conv && conv.selectedChannelId === channel.id && conv.selectedModel === model;
        if (isSelected) {
            item.classList.add('ido-list__item--active');
        }
        
        item.textContent = model;
        
        item.onclick = () => {
            if (conv) {
                store.setConversationModel(conv.id, channel.id, model);
                updateButtonState();
                
                // 关闭面板（框架会自动恢复到默认面板）
                if (context) {
                    context.togglePanel('right', false);
                }
            }
        };
        
        return item;
    }

})();