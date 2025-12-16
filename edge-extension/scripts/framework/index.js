/**
 * Framework 入口文件
 * 加载所有模块并创建统一的 API
 */
(function() {
    'use strict';

    // 等待所有模块加载完成
    function waitForModules() {
        return new Promise((resolve) => {
            const check = () => {
                if (
                    typeof FrameworkEvents !== 'undefined' &&
                    typeof FrameworkStorage !== 'undefined' &&
                    typeof FrameworkLayout !== 'undefined' &&
                    typeof FrameworkGesture !== 'undefined' &&
                    typeof FrameworkPlugins !== 'undefined' &&
                    typeof FrameworkMarkdown !== 'undefined' &&
                    typeof FrameworkMessages !== 'undefined' &&
                    typeof FrameworkUIHelpers !== 'undefined' &&
                    typeof FrameworkCore !== 'undefined'
                ) {
                    resolve();
                } else {
                    setTimeout(check, 10);
                }
            };
            check();
        });
    }

    /**
     * 创建 Framework API
     */
    function createFramework() {
        const events = FrameworkEvents;
        const storage = FrameworkStorage;
        const layout = FrameworkLayout;
        const gesture = FrameworkGesture;
        const plugins = FrameworkPlugins;
        const markdown = FrameworkMarkdown;
        const messages = FrameworkMessages;
        const uiHelpers = FrameworkUIHelpers;
        const core = FrameworkCore;

        // 内部 API 引用
        let publicApi = null;

        /**
         * 初始化 Framework
         */
        function init() {
            core.init({
                events,
                storage,
                layout,
                gesture,
                plugins,
                markdown,
                messages,
                uiHelpers
            });
        }

        /**
         * 销毁 Framework
         */
        function destroy() {
            core.destroy();
        }

        // 构建公共 API
        publicApi = {
            // 初始化与销毁
            init,
            destroy,

            // 模式管理
            setMode: (...args) => core.setMode(...args),
            getCurrentMode: () => core.getCurrentMode(),

            // 插件系统
            registerPlugin: (...args) => plugins.registerPlugin(...args),
            registerUIComponent: (...args) => plugins.registerUIComponent(...args),
            unregisterUIComponent: (...args) => plugins.unregisterUIComponent(...args),
            registerUIBundle: (...args) => plugins.registerUIBundle(...args),
            unregisterUIBundle: (...args) => plugins.unregisterUIBundle(...args),
            refreshSlot: (...args) => plugins.refreshSlot(...args),
            registerPluginBundle: (...args) => plugins.registerPluginBundle(...args),
            unregisterPlugin: (...args) => plugins.unregisterPlugin(...args),
            unregisterPluginBundle: (...args) => plugins.unregisterPluginBundle(...args),
            setPluginEnabled: (...args) => plugins.setPluginEnabled(...args),
            getPlugins: (...args) => plugins.getPlugins(...args),
            getDynamicPlugins: (...args) => plugins.getDynamicPlugins(...args),
            SLOTS: plugins.SLOTS,

            // 布局
            togglePanel: (...args) => layout.togglePanel(...args),
            setCustomPanel: (...args) => layout.setCustomPanel(...args),
            setDefaultRightPanel: (...args) => layout.setDefaultRightPanel(...args),
            restoreDefaultRightPanel: (...args) => layout.restoreDefaultRightPanel(...args),
            showBottomSheet: (...args) => layout.showBottomSheet(...args),
            hideBottomSheet: (...args) => layout.hideBottomSheet(...args),

            // 消息
            addMessage: (...args) => messages.addMessage(...args),
            updateLastMessage: (...args) => messages.updateLastMessage(...args),
            finalizeStreamingMessage: (...args) => messages.finalizeStreamingMessage(...args),
            renderAllPendingMarkdown: (...args) => messages.renderAllPendingMarkdown(...args),
            clearMessages: (...args) => messages.clearMessages(...args),
            addLoadingIndicator: (...args) => messages.addLoadingIndicator(...args),
            removeLoadingIndicator: (...args) => messages.removeLoadingIndicator(...args),
            attachLoadingIndicatorToMessage: (...args) => messages.attachLoadingIndicatorToMessage(...args),
            removeMessageStreamingIndicator: (...args) => messages.removeMessageStreamingIndicator(...args),

            // UI Helpers
            setSendButtonLoading: (...args) => uiHelpers.setSendButtonLoading(...args),

            // renderMessageEdit 由外部注入
            renderMessageEdit: null,
            set renderMessageEdit(fn) {
                this._renderMessageEdit = fn;
            },
            get renderMessageEdit() {
                return this._renderMessageEdit;
            },

            // 事件与存储
            events,
            storage,

            // UI 组件工厂
            ui: {
                createIconButton: (...args) => uiHelpers.createIconButton(...args),
                createCustomHeader: (...args) => uiHelpers.createCustomHeader(...args),
                createModal: (...args) => uiHelpers.createModal(...args),
                showToast: (...args) => uiHelpers.showToast(...args),
                createDropdown: (...args) => uiHelpers.createDropdown(...args)
            }
        };

        // 设置插件系统的公共 API 引用
        plugins.setPublicApi(publicApi);

        return publicApi;
    }

    // 自动初始化或等待手动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            await waitForModules();
            const Framework = createFramework();
            
            // 暴露到全局
            if (typeof globalThis !== 'undefined') {
                globalThis.Framework = Framework;
            }
            window.Framework = Framework;
        });
    } else {
        waitForModules().then(() => {
            const Framework = createFramework();
            
            // 暴露到全局
            if (typeof globalThis !== 'undefined') {
                globalThis.Framework = Framework;
            }
            window.Framework = Framework;
        });
    }
})();