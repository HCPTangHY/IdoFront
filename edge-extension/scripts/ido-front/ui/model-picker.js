/**
 * Shared Model Picker
 * 共享的渠道 / 模型选择器
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.modelPicker = window.IdoFront.modelPicker || {};

    let context = null;
    let store = null;

    function init(frameworkInstance, storeInstance) {
        if (frameworkInstance) {
            context = frameworkInstance;
        }
        if (storeInstance) {
            store = storeInstance;
        }
    }

    function open(options) {
        if (!context || !store || !context.setCustomPanel || !context.togglePanel) {
            return;
        }

        const pickerOptions = Object.assign({
            title: '选择模型',
            allowFollowCurrent: true,
            followCurrentLabel: '当前模型',
            followCurrentDescription: '不单独指定时跟随当前会话模型',
            selectedChannelId: null,
            selectedModel: null,
            onSelect: null,
            onClose: null
        }, options || {});

        context.setCustomPanel('right', (container) => {
            renderPanel(container, pickerOptions);
        });
        context.togglePanel('right', true);
    }

    function renderPanel(container, options) {
        container.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'ido-panel__header';

        const title = document.createElement('span');
        title.className = 'ido-panel__title';
        title.textContent = options.title || '选择模型';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ido-icon-btn';
        closeBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">close</span>';
        closeBtn.onclick = () => close(options, { hasSelection: false, channelId: null, model: null });

        header.appendChild(title);
        header.appendChild(closeBtn);
        container.appendChild(header);

        const content = document.createElement('div');
        content.className = 'ido-panel__content';

        if (options.allowFollowCurrent !== false) {
            const followCurrent = document.createElement('button');
            followCurrent.className = 'ido-list__item w-full text-left mb-4';
            followCurrent.style.border = '1px dashed var(--ido-color-border)';
            followCurrent.style.borderRadius = 'var(--ido-radius-md)';

            if (!options.selectedChannelId || !options.selectedModel) {
                followCurrent.classList.add('ido-list__item--active');
            }

            followCurrent.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-[18px]">auto_mode</span>
                    <span>${options.followCurrentLabel || '当前模型'}</span>
                </div>
                <div class="text-xs text-gray-500 mt-1 ml-7">${options.followCurrentDescription || '不单独指定时跟随当前会话模型'}</div>
            `;
            followCurrent.onclick = () => close(options, { hasSelection: true, channelId: null, model: null });
            content.appendChild(followCurrent);

            const divider = document.createElement('div');
            divider.className = 'ido-divider';
            divider.style.margin = 'var(--ido-spacing-md) 0';
            content.appendChild(divider);
        }

        const channels = store && store.state && Array.isArray(store.state.channels)
            ? store.state.channels.filter(channel => channel && channel.enabled)
            : [];

        if (channels.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ido-empty';
            empty.textContent = '无可用渠道，请先在设置中配置';
            content.appendChild(empty);
        } else {
            channels.forEach((channel) => {
                const block = document.createElement('div');
                block.style.marginBottom = 'var(--ido-spacing-lg)';

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

                const modelsList = document.createElement('div');
                modelsList.className = 'ido-list';

                if (!Array.isArray(channel.models) || channel.models.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'text-xs text-gray-400 py-2';
                    empty.textContent = '无可用模型';
                    modelsList.appendChild(empty);
                } else {
                    channel.models.forEach((model) => {
                        const item = document.createElement('button');
                        item.className = 'ido-list__item w-full text-left text-xs';

                        const isSelected = options.selectedChannelId === channel.id && options.selectedModel === model;
                        if (isSelected) {
                            item.classList.add('ido-list__item--active');
                        }

                        item.textContent = model;
                        item.onclick = () => close(options, { hasSelection: true, channelId: channel.id, model });
                        modelsList.appendChild(item);
                    });
                }

                block.appendChild(modelsList);
                content.appendChild(block);
            });
        }

        container.appendChild(content);
    }

    function close(options, payload) {
        const closePayload = payload && typeof payload === 'object'
            ? payload
            : { hasSelection: false, channelId: null, model: null };

        context.togglePanel('right', false);
        setTimeout(() => {
            if (closePayload.hasSelection && typeof options.onSelect === 'function') {
                options.onSelect(closePayload.channelId || null, closePayload.model || null);
            }
            if (typeof options.onClose === 'function') {
                options.onClose(closePayload);
            }
        }, 300);
    }

    window.IdoFront.modelPicker.init = init;
    window.IdoFront.modelPicker.open = open;
})();
