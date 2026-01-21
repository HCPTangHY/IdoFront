/**
 * Performance Settings
 * 性能相关设置（注册到通用设置）
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.performanceSettings = window.IdoFront.performanceSettings || {};

    let store = null;
    let context = null;

    window.IdoFront.performanceSettings.init = function(storeInstance, frameworkInstance) {
        store = storeInstance;
        context = frameworkInstance;

        const settingsManager = window.IdoFront.settingsManager;
        if (settingsManager && settingsManager.registerGeneralSection) {
            settingsManager.registerGeneralSection({
                id: 'performance',
                title: '性能',
                description: '性能优化与实验性功能开关',
                icon: 'speed',
                category: '性能',
                tags: ['性能', '实验', 'DOM', '缓存', 'virtual list', '虚拟列表'],
                advanced: true,
                order: 20,
                render: renderSection
            });
        }
    };

    function renderSection(container) {
        container.innerHTML = '';

        const domCacheRow = createToggleRow({
            label: '启用对话 DOM 缓存（实验）',
            description: '切换对话更快，但可能引起流式/工具/计时显示异常；默认关闭',
            checked: store && store.getSetting && store.getSetting('enableDomCache') === true,
            onChange: (checked) => {
                if (!store || !store.setSetting) return;
                store.setSetting('enableDomCache', checked);

                if (!checked) {
                    try {
                        const vlist = window.IdoFront && window.IdoFront.virtualList;
                        if (vlist && typeof vlist.invalidateCache === 'function') {
                            vlist.invalidateCache();
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                // 可选：切换后同步一次 UI，确保行为立刻生效
                try {
                    const convActions = window.IdoFront && window.IdoFront.conversationActions;
                    if (convActions && typeof convActions.syncUI === 'function') {
                        convActions.syncUI({ useCache: checked });
                    }
                } catch (e) {
                    // ignore
                }
            }
        });

        container.appendChild(domCacheRow);
    }

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

        const toggle = document.createElement('label');
        toggle.className = 'ido-form-switch';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'ido-form-switch__input';
        input.checked = !!options.checked;
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
