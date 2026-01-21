/**
 * 核心模块
 * 负责模式管理、初始化和 API 聚合
 */
const FrameworkCore = (function() {
    'use strict';

    // 依赖模块引用
    let events = null;
    let storage = null;
    let layout = null;
    let gesture = null;
    let plugins = null;
    let markdown = null;
    let messages = null;
    let uiHelpers = null;

    // 当前模式
    let currentMode = 'chat';

    /**
     * 初始化所有模块
     */
    function init(modules) {
        events = modules.events || FrameworkEvents;
        storage = modules.storage || FrameworkStorage;
        layout = modules.layout || FrameworkLayout;
        gesture = modules.gesture || FrameworkGesture;
        plugins = modules.plugins || FrameworkPlugins;
        markdown = modules.markdown || FrameworkMarkdown;
        messages = modules.messages || FrameworkMessages;
        uiHelpers = modules.uiHelpers || FrameworkUIHelpers;

        // 初始化各模块
        layout.init();
        gesture.init(layout);
        uiHelpers.init({ layout, events });
        messages.init({ layout, plugins, markdown, events });
        plugins.setPublicApi(getPublicApi());

        // 初始化聊天 header
        initChatHeader();

        // 恢复 URL 参数状态
        restoreStateFromURL();

        // 绑定发送按钮
        bindSendButton();

        // 绑定输入框自动调整
        bindInputAutoResize();
    }

    /**
     * 销毁所有模块
     */
    function destroy() {
        if (layout) layout.destroy();
        if (gesture) gesture.destroy();
    }

    /**
     * 设置模式
     */
    async function setMode(mode, renderers = {}) {
        const previousMode = currentMode;
        currentMode = mode;

        const ui = layout.getUI();

        // Helper to toggle 标准布局元素
        const hideInputInThisMode = (mode === 'settings');
        const toggleStandard = (show) => {
            const display = show ? '' : 'none';

            // Sidebar
            Object.values(ui.sidebarSlots).forEach(el => {
                if (el) el.style.display = display;
            });

            // Main header & stream
            if (ui.mainSlots.header) ui.mainSlots.header.style.display = display;
            if (ui.mainSlots.stream) ui.mainSlots.stream.style.display = display;
            
            // 快速导航按钮（跟随 chat-stream 显示/隐藏）
            const quickNav = document.getElementById('quick-nav-container');
            if (quickNav) {
                quickNav.style.display = display;
            }
            
            // 聊天流父容器（Chat Stream Container）
            if (ui.mainSlots.stream && ui.mainSlots.stream.parentElement) {
                ui.mainSlots.stream.parentElement.style.display = display;
            }

            // 输入区
            if (ui.mainSlots.input) {
                const inputArea = ui.mainSlots.input;

                if (hideInputInThisMode) {
                    inputArea.classList.add('ido-input-area--hidden');
                    setTimeout(() => {
                        if (currentMode === mode && hideInputInThisMode) {
                            inputArea.style.display = 'none';
                        }
                    }, 300);
                } else {
                    inputArea.style.display = '';
                    inputArea.style.transform = '';
                    inputArea.style.opacity = '';
                    inputArea.style.maxHeight = '';
                    inputArea.style.overflow = '';
                    inputArea.style.pointerEvents = '';
                    inputArea.classList.remove('ido-input-area--hidden');
                }
            }
        };

        if (mode === 'chat') {
            toggleStandard(true);
            const customContainers = layout.customContainers;
            if (customContainers.sidebar) customContainers.sidebar.style.display = 'none';
            if (customContainers.main) customContainers.main.style.display = 'none';
        } else {
            toggleStandard(false);

            // Setup Custom Sidebar
            const sbContainer = layout.getOrCreateContainer('sidebar', ui.leftPanel);
            sbContainer.style.display = 'flex';
            await layout.animatePanelTransition(sbContainer, renderers.sidebar || null);

            // Setup Custom Main
            const mainParent = ui.mainSlots.header.parentNode;
            const mContainer = layout.getOrCreateContainer('main', mainParent);
            mContainer.style.display = 'flex';
            await layout.animatePanelTransition(mContainer, renderers.main || null);
        }

        // 通知模式切换
        if (events) {
            try {
                if (typeof events.emitAsync === 'function') {
                    events.emitAsync('mode:changed', { mode, previousMode });
                } else if (typeof events.emit === 'function') {
                    events.emit('mode:changed', { mode, previousMode });
                }
            } catch (e) {
                console.warn('Framework mode:changed handler error:', e);
            }
        }
    }

    /**
     * 获取当前模式
     */
    function getCurrentMode() {
        return currentMode;
    }

    /**
     * 初始化聊天 header
     */
    function initChatHeader() {
        const ui = layout.getUI();
        const headerContainer = ui.mainSlots.header;
        if (!headerContainer) return;

        const header = uiHelpers.createCustomHeader({
            center: () => {
                const centerContent = document.createElement('div');
                centerContent.className = "flex flex-col min-w-0 max-w-full overflow-hidden";

                const title = document.createElement('div');
                title.id = "chat-title";
                title.className = "font-medium text-gray-700 truncate";
                title.textContent = "新对话";

                const modelInfo = document.createElement('div');
                modelInfo.id = "model-info";
                modelInfo.className = "text-[10px] text-gray-400 truncate";

                centerContent.appendChild(title);
                centerContent.appendChild(modelInfo);

                return centerContent;
            },
            right: () => {
                const rightContent = document.createElement('div');
                rightContent.className = "flex items-center gap-1";

                const pluginSlot = document.createElement('div');
                pluginSlot.id = "slot-header-actions";
                pluginSlot.className = "flex gap-1";

                const divider = document.createElement('div');
                divider.className = "h-4 w-px bg-gray-300 mx-2";

                rightContent.appendChild(pluginSlot);
                rightContent.appendChild(divider);

                return rightContent;
            }
        });

        headerContainer.appendChild(header);

        // 刷新 header actions 插槽
        try {
            if (plugins && plugins.SLOTS) {
                plugins.refreshSlot(plugins.SLOTS.HEADER_ACTIONS);
            }
        } catch (e) {
            console.warn('Framework: failed to refresh HEADER_ACTIONS slot:', e);
        }
    }

    /**
     * 从 URL 参数恢复状态
     */
    function restoreStateFromURL() {
        const params = new URLSearchParams(window.location.search);
        const mode = params.get('mode');
        if (mode && events) {
            if (typeof events.emitAsync === 'function') {
                events.emitAsync('restore-state-from-url', params);
            } else if (typeof events.emit === 'function') {
                events.emit('restore-state-from-url', params);
            }
        }
    }

    /**
     * 绑定发送按钮
     */
    function bindSendButton() {
        const ui = layout.getUI();
        const btnSend = document.getElementById('btn-send');
        if (btnSend) {
            btnSend.onclick = () => {
                if (btnSend.classList.contains('btn-send--loading')) {
                    if (events && typeof events.emitAsync === 'function') {
                        events.emitAsync('cancel-request');
                    } else if (events && typeof events.emit === 'function') {
                        events.emit('cancel-request');
                    }
                } else {
                    if (events && typeof events.emitAsync === 'function') {
                        events.emitAsync('send-message', {
                            text: ui.userInput.value.trim()
                        });
                    } else if (events && typeof events.emit === 'function') {
                        events.emit('send-message', {
                            text: ui.userInput.value.trim()
                        });
                    }
                }
            };
        }
    }

    /**
     * 绑定输入框自动调整高度
     */
    function bindInputAutoResize() {
        const ui = layout.getUI();
        if (ui.userInput) {
            ui.userInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
            });
        }
    }

    /**
     * 获取公共 API
     */
    function getPublicApi() {
        return {
            // 初始化与销毁
            init,
            destroy,

            // 模式管理
            setMode,
            getCurrentMode,

            // 插件系统
            registerPlugin: plugins ? plugins.registerPlugin : null,
            registerUIComponent: plugins ? plugins.registerUIComponent : null,
            unregisterUIComponent: plugins ? plugins.unregisterUIComponent : null,
            registerUIBundle: plugins ? plugins.registerUIBundle : null,
            unregisterUIBundle: plugins ? plugins.unregisterUIBundle : null,
            refreshSlot: plugins ? plugins.refreshSlot : null,
            registerPluginBundle: plugins ? plugins.registerPluginBundle : null,
            unregisterPlugin: plugins ? plugins.unregisterPlugin : null,
            unregisterPluginBundle: plugins ? plugins.unregisterPluginBundle : null,
            setPluginEnabled: plugins ? plugins.setPluginEnabled : null,
            getPlugins: plugins ? plugins.getPlugins : null,
            getDynamicPlugins: plugins ? plugins.getDynamicPlugins : null,
            SLOTS: plugins ? plugins.SLOTS : {},

            // 布局
            togglePanel: layout ? layout.togglePanel : null,
            setCustomPanel: layout ? layout.setCustomPanel : null,
            setDefaultRightPanel: layout ? layout.setDefaultRightPanel : null,
            restoreDefaultRightPanel: layout ? layout.restoreDefaultRightPanel : null,
            showBottomSheet: layout ? layout.showBottomSheet : null,
            hideBottomSheet: layout ? layout.hideBottomSheet : null,

            // 消息
            addMessage: messages ? messages.addMessage : null,
            updateLastMessage: messages ? messages.updateLastMessage : null,
            updateMessageById: messages ? messages.updateMessageById : null,
            finalizeStreamingMessage: messages ? messages.finalizeStreamingMessage : null,
            finalizeStreamingMessageById: messages ? messages.finalizeStreamingMessageById : null,
            renderAllPendingMarkdown: messages ? messages.renderAllPendingMarkdown : null,
            clearMessages: messages ? messages.clearMessages : null,
            addLoadingIndicator: messages ? messages.addLoadingIndicator : null,
            removeLoadingIndicator: messages ? messages.removeLoadingIndicator : null,
            attachLoadingIndicatorToMessage: messages ? messages.attachLoadingIndicatorToMessage : null,
            removeMessageStreamingIndicator: messages ? messages.removeMessageStreamingIndicator : null,

            // UI Helpers
            setSendButtonLoading: uiHelpers ? uiHelpers.setSendButtonLoading : null,
            renderMessageEdit: null, // 由 messageActions 注入

            // 事件与存储
            events,
            storage,

            // UI 组件工厂
            ui: uiHelpers ? {
                createIconButton: uiHelpers.createIconButton,
                createCustomHeader: uiHelpers.createCustomHeader,
                createModal: uiHelpers.createModal,
                showToast: uiHelpers.showToast,
                createDropdown: uiHelpers.createDropdown
            } : {}
        };
    }

    return {
        init,
        destroy,
        setMode,
        getCurrentMode,
        getPublicApi
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkCore = FrameworkCore;
}