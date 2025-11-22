/*
 * Hello Panel External Plugin
 * 展示如何在 IdoFront 中注册自定义按钮，点击后在消息区插入问候语。
 */
(function() {
    if (!window.Framework || !window.Framework.registerPlugin) {
        console.warn('[HelloPanel] Framework API 不可用');
        return;
    }

    const SLOT = window.Framework.SLOTS.HEADER_ACTIONS;
    const PLUGIN_ID = 'external-hello-panel';

    function createButton(frameworkApi) {
        const button = frameworkApi.ui.createIconButton({
            label: 'Hello',
            icon: 'waving_hand',
            title: '插入问候语',
            className: 'ido-btn ido-btn--ghost text-xs gap-1',
            iconClassName: 'material-symbols-outlined text-[16px]',
            onClick: () => {
                frameworkApi.addMessage('assistant', {
                    content: '来自外部插件的问候 👋',
                    reasoning: '示例插件输出固定问候语'
                });
            }
        });
        return button;
    }

    window.Framework.registerPlugin(SLOT, PLUGIN_ID, {
        init(frameworkApi) {
            console.log('[HelloPanel] init');
        },
        render(frameworkApi) {
            return createButton(frameworkApi);
        },
        destroy() {
            console.log('[HelloPanel] destroy');
        }
    });

    return function cleanup() {
        if (window.Framework && window.Framework.unregisterPlugin) {
            window.Framework.unregisterPlugin(SLOT, PLUGIN_ID);
        }
    };
})();