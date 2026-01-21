/**
 * 布局管理模块
 * 负责面板宽度、响应式布局、bottom sheet 等
 */
const FrameworkLayout = (function() {
    'use strict';

    // --- 配置常量 ---
    const LAYOUT_DEFAULTS = {
        LEFT_WIDTH: 260,
        RIGHT_WIDTH: 320,
        MOBILE_PANEL_WIDTH: '85vw',
        MOBILE_BREAKPOINT: 768
    };

    // --- 状态 ---
    const state = {
        leftWidth: LAYOUT_DEFAULTS.LEFT_WIDTH,
        rightWidth: LAYOUT_DEFAULTS.RIGHT_WIDTH,
        leftOpen: window.innerWidth >= LAYOUT_DEFAULTS.MOBILE_BREAKPOINT,
        rightOpen: window.innerWidth >= LAYOUT_DEFAULTS.MOBILE_BREAKPOINT,
        isDragging: false,
        lastScreenWidth: window.innerWidth
    };

    // --- UI 元素引用 ---
    const ui = {};

    // --- 自定义面板容器 ---
    const customContainers = {
        sidebar: null,
        main: null,
        right: null
    };

    // 右侧面板的默认渲染器
    let defaultRightPanelRenderer = null;

    // Resize 监听器状态
    let resizeHandlerBound = false;
    let resizeRafId = 0;
    let resizeListener = null;

    /**
     * 绑定 UI 元素
     */
    function bindUI() {
        ui.app = document.getElementById('app-container');
        ui.leftPanel = document.getElementById('left-panel');
        ui.rightPanel = document.getElementById('right-panel');
        ui.resizerLeft = document.getElementById('resizer-left');
        ui.resizerRight = document.getElementById('resizer-right');
        ui.backdrop = document.getElementById('backdrop');
        ui.bottomSheet = document.getElementById('bottom-sheet');
        ui.bottomSheetContent = document.getElementById('bottom-sheet-content');
        ui.bottomSheetBackdrop = document.getElementById('bottom-sheet-backdrop');
        ui.chatStream = document.getElementById('chat-stream');
        ui.userInput = document.getElementById('user-input');

        // View Containers
        ui.sidebarSlots = {
            header: document.getElementById('sidebar-header'),
            top: document.getElementById('slot-sidebar-top'),
            list: document.getElementById('history-list'),
            bottom: document.getElementById('slot-sidebar-bottom')
        };
        ui.mainSlots = {
            header: document.getElementById('main-header'),
            stream: document.getElementById('chat-stream'),
            input: document.getElementById('input-area')
        };
    }

    /**
     * 获取 UI 元素引用
     */
    function getUI() {
        return ui;
    }

    /**
     * 获取布局状态
     */
    function getState() {
        return { ...state };
    }

    // --- Resizer 逻辑 ---

    function initResizers() {
        if (ui.resizerLeft) {
            ui.resizerLeft.addEventListener('mousedown', (e) => startResize(e, 'left'));
        }
        if (ui.resizerRight) {
            ui.resizerRight.addEventListener('mousedown', (e) => startResize(e, 'right'));
        }
        checkResponsive();
        bindResponsiveListener();
    }

    function startResize(e, side) {
        e.preventDefault();
        state.isDragging = true;
        document.body.classList.add('is-resizing');
        ui.leftPanel.classList.remove('transition-width');
        ui.rightPanel.classList.remove('transition-width');

        const resizer = side === 'left' ? ui.resizerLeft : ui.resizerRight;
        resizer.classList.add('active');

        const startX = e.clientX;
        const startWidth = side === 'left' ? state.leftWidth : state.rightWidth;

        const doDrag = (moveEvent) => {
            if (!state.isDragging) return;
            const delta = moveEvent.clientX - startX;

            if (side === 'left') {
                const newW = Math.max(150, Math.min(600, startWidth + delta));
                state.leftWidth = newW;
                ui.leftPanel.style.width = `${newW}px`;
            } else {
                const newW = Math.max(200, Math.min(800, startWidth - delta));
                state.rightWidth = newW;
                ui.rightPanel.style.width = `${newW}px`;
            }
        };

        const stopDrag = () => {
            state.isDragging = false;
            document.body.classList.remove('is-resizing');
            resizer.classList.remove('active');
            ui.leftPanel.classList.add('transition-width');
            ui.rightPanel.classList.add('transition-width');
            window.removeEventListener('mousemove', doDrag);
            window.removeEventListener('mouseup', stopDrag);
        };

        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', stopDrag);
    }

    // --- 响应式监听 ---

    function bindResponsiveListener() {
        if (resizeHandlerBound) return;
        resizeListener = function() {
            if (resizeRafId) return;
            resizeRafId = requestAnimationFrame(() => {
                resizeRafId = 0;
                checkResponsive();
            });
        };
        window.addEventListener('resize', resizeListener);
        resizeHandlerBound = true;
    }

    function unbindResponsiveListener() {
        if (!resizeHandlerBound) return;
        if (resizeListener) {
            window.removeEventListener('resize', resizeListener);
            resizeListener = null;
        }
        resizeHandlerBound = false;
    }

    function checkResponsive() {
        const currentWidth = window.innerWidth;
        const isMobile = currentWidth < LAYOUT_DEFAULTS.MOBILE_BREAKPOINT;
        const wasMobile = state.lastScreenWidth < LAYOUT_DEFAULTS.MOBILE_BREAKPOINT;

        // 仅在从桌面切换到移动端时关闭面板
        if (isMobile && !wasMobile) {
            if (state.leftOpen) state.leftOpen = false;
            if (state.rightOpen) state.rightOpen = false;
        }

        state.lastScreenWidth = currentWidth;
        updatePanelWidths();
    }

    // --- 面板切换 ---

    function togglePanel(side, force) {
        const isLeft = side === 'left';
        const currentState = isLeft ? state.leftOpen : state.rightOpen;
        const newState = force !== undefined ? force : !currentState;

        if (isLeft) {
            state.leftOpen = newState;
        } else {
            const isMobile = window.innerWidth < LAYOUT_DEFAULTS.MOBILE_BREAKPOINT;

            if (!newState) {
                if (!isMobile) {
                    const container = customContainers.right;
                    const hasCustomContent = container && container.dataset.hasCustomContent === 'true';
                    if (hasCustomContent) {
                        restoreDefaultRightPanel();
                        state.rightOpen = true;
                    } else {
                        state.rightOpen = false;
                    }
                } else {
                    state.rightOpen = false;
                    restoreDefaultRightPanel();
                }
            } else {
                state.rightOpen = true;
                const container = customContainers.right;
                const hasCustomContent = container && container.dataset.hasCustomContent === 'true';
                if (!hasCustomContent && defaultRightPanelRenderer) {
                    restoreDefaultRightPanel();
                }
            }
        }

        updatePanelWidths();
    }

    function updatePanelWidths() {
        const isMobile = window.innerWidth < LAYOUT_DEFAULTS.MOBILE_BREAKPOINT;

        // Left Panel
        if (state.leftOpen) {
            if (isMobile) {
                ui.leftPanel.style.width = LAYOUT_DEFAULTS.MOBILE_PANEL_WIDTH;
                ui.backdrop.classList.remove('hidden');
            } else {
                ui.leftPanel.style.width = `${state.leftWidth}px`;
                ui.backdrop.classList.add('hidden');
            }
            ui.resizerLeft.style.display = isMobile ? 'none' : 'block';
        } else {
            ui.leftPanel.style.width = '0px';
            ui.resizerLeft.style.display = 'none';
        }

        // Right Panel
        if (state.rightOpen) {
            if (isMobile) {
                ui.rightPanel.style.width = LAYOUT_DEFAULTS.MOBILE_PANEL_WIDTH;
                ui.backdrop.classList.remove('hidden');
            } else {
                ui.rightPanel.style.width = `${state.rightWidth}px`;
                ui.backdrop.classList.add('hidden');
            }
            ui.resizerRight.style.display = isMobile ? 'none' : 'block';
        } else {
            ui.rightPanel.style.width = '0px';
            ui.resizerRight.style.display = 'none';
        }

        // Hide backdrop if both closed (mobile)
        if (isMobile && !state.leftOpen && !state.rightOpen) {
            ui.backdrop.classList.add('hidden');
        }
    }

    // --- 面板内容管理 ---

    /**
     * 统一的面板内容切换动画函数
     */
    async function animatePanelTransition(container, renderer) {
        if (!container) return;

        const hasOldContent = container.innerHTML.trim() !== '';

        // 退出动画
        if (hasOldContent) {
            container.classList.add('panel-transition-exit');
            await new Promise(resolve => {
                const onAnimationEnd = () => {
                    container.removeEventListener('animationend', onAnimationEnd);
                    resolve();
                };
                container.addEventListener('animationend', onAnimationEnd);
                setTimeout(resolve, 250);
            });
            container.classList.remove('panel-transition-exit');
        }

        // 更新内容
        container.innerHTML = '';
        if (renderer && typeof renderer === 'function') {
            renderer(container);
        }

        // 进入动画
        if (renderer) {
            container.classList.add('panel-transition-enter');
            await new Promise(resolve => {
                const onAnimationEnd = () => {
                    container.removeEventListener('animationend', onAnimationEnd);
                    container.classList.remove('panel-transition-enter');
                    resolve();
                };
                container.addEventListener('animationend', onAnimationEnd);
                setTimeout(() => {
                    container.classList.remove('panel-transition-enter');
                    resolve();
                }, 300);
            });
        }
    }

    /**
     * 获取或创建自定义容器
     */
    function getOrCreateContainer(type, parent) {
        if (!customContainers[type]) {
            const el = document.createElement('div');
            el.className = "flex-1 flex flex-col min-h-0 overflow-hidden h-full w-full panel-transition-container";
            if (type === 'main' && ui.mainSlots && ui.mainSlots.input && ui.mainSlots.input.parentNode === parent) {
                parent.insertBefore(el, ui.mainSlots.input);
            } else {
                parent.appendChild(el);
            }
            customContainers[type] = el;
        }
        return customContainers[type];
    }

    /**
     * 设置右侧面板的默认渲染器
     */
    function setDefaultRightPanel(renderer) {
        defaultRightPanelRenderer = renderer;
        if (state.rightOpen) {
            const container = customContainers.right;
            const hasCustomContent = container && container.dataset.hasCustomContent === 'true';
            if (!hasCustomContent) {
                restoreDefaultRightPanel();
            }
        }
    }

    /**
     * 恢复右侧面板到默认状态
     */
    async function restoreDefaultRightPanel() {
        if (!ui.rightPanel) return;

        const defaultContent = document.getElementById('right-panel-default');
        const container = getOrCreateContainer('right', ui.rightPanel);

        if (defaultRightPanelRenderer) {
            if (defaultContent) defaultContent.style.display = 'none';
            container.style.display = 'flex';
            container.dataset.hasCustomContent = 'false';
            await animatePanelTransition(container, defaultRightPanelRenderer);
        } else {
            container.innerHTML = '';
            container.style.display = 'none';
            if (defaultContent) defaultContent.style.display = 'flex';
            delete container.dataset.hasCustomContent;
        }
    }

    /**
     * 设置自定义面板内容
     */
    async function setCustomPanel(side, renderer) {
        if (side !== 'right') return;

        const defaultContent = document.getElementById('right-panel-default');
        const parent = ui.rightPanel;
        const container = getOrCreateContainer('right', parent);

        if (renderer) {
            if (defaultContent) defaultContent.style.display = 'none';
            container.style.display = 'flex';
            container.dataset.hasCustomContent = 'true';
            await animatePanelTransition(container, renderer);
        } else {
            await restoreDefaultRightPanel();
        }
    }

    // --- Bottom Sheet ---

    function showBottomSheet(renderer) {
        if (!ui.bottomSheet || !ui.bottomSheetContent || !ui.bottomSheetBackdrop) return;

        ui.bottomSheetContent.innerHTML = '';

        if (typeof renderer === 'function') {
            renderer(ui.bottomSheetContent);
        }

        ui.bottomSheetBackdrop.style.opacity = '';
        ui.bottomSheet.style.transform = '';

        // 先显示元素（初始状态）
        ui.bottomSheetBackdrop.classList.remove('hidden');
        ui.bottomSheet.classList.remove('hidden');

        // 等待浏览器渲染初始状态后再添加动画类
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                ui.bottomSheetBackdrop.classList.add('ido-bottom-sheet-backdrop--visible');
                ui.bottomSheet.classList.add('ido-bottom-sheet--visible');
            });
        });
    }

    function hideBottomSheet() {
        if (!ui.bottomSheet || !ui.bottomSheetBackdrop) return;

        ui.bottomSheetBackdrop.classList.remove('ido-bottom-sheet-backdrop--visible');
        ui.bottomSheet.classList.remove('ido-bottom-sheet--visible');

        setTimeout(() => {
            ui.bottomSheetBackdrop.classList.add('hidden');
            ui.bottomSheet.classList.add('hidden');
            if (ui.bottomSheetContent) {
                ui.bottomSheetContent.innerHTML = '';
            }
        }, 300);
    }

    // --- 初始化与销毁 ---

    /**
     * 初始化快速导航按钮
     */
    function initQuickNav() {
        if (!ui.chatStream) return;

        const quickNav = document.createElement('div');
        quickNav.className = 'ido-quick-nav';
        quickNav.id = 'quick-nav-container';
        quickNav.innerHTML = `
            <button class="ido-quick-nav__btn" id="nav-top" title="跳转到顶部">
                <span class="material-symbols-outlined">vertical_align_top</span>
            </button>
            <button class="ido-quick-nav__btn" id="nav-prev" title="上条消息">
                <span class="material-symbols-outlined">keyboard_arrow_up</span>
            </button>
            <button class="ido-quick-nav__btn" id="nav-next" title="下条消息">
                <span class="material-symbols-outlined">keyboard_arrow_down</span>
            </button>
            <button class="ido-quick-nav__btn" id="nav-bottom" title="跳转到底部">
                <span class="material-symbols-outlined">vertical_align_bottom</span>
            </button>
        `;

        // 插入到 chat-stream 的父容器中，确保它悬浮在聊天流上方且不随内容滚动，也不被输入框挡住
        const streamContainer = ui.chatStream.parentElement;
        streamContainer.appendChild(quickNav);

        const btnTop = quickNav.querySelector('#nav-top');
        const btnPrev = quickNav.querySelector('#nav-prev');
        const btnNext = quickNav.querySelector('#nav-next');
        const btnBottom = quickNav.querySelector('#nav-bottom');

        // 滚动监听，控制显示/隐藏
        ui.chatStream.addEventListener('scroll', () => {
            if (ui.chatStream.scrollTop > 200) {
                quickNav.classList.add('ido-quick-nav--visible');
            } else {
                quickNav.classList.remove('ido-quick-nav--visible');
            }
        });

        btnTop.onclick = () => {
            ui.chatStream.scrollTo({ top: 0, behavior: 'smooth' });
        };

        btnBottom.onclick = () => {
            ui.chatStream.scrollTo({ top: ui.chatStream.scrollHeight, behavior: 'smooth' });
        };

        const getVisibleMessages = () => {
            const messages = Array.from(ui.chatStream.querySelectorAll('.ido-message'));
            const containerRect = ui.chatStream.getBoundingClientRect();
            return messages.map(msg => {
                const rect = msg.getBoundingClientRect();
                return {
                    el: msg,
                    top: rect.top - containerRect.top + ui.chatStream.scrollTop,
                    bottom: rect.bottom - containerRect.top + ui.chatStream.scrollTop,
                    inView: rect.top < containerRect.bottom && rect.bottom > containerRect.top
                };
            });
        };

        btnPrev.onclick = () => {
            const msgs = getVisibleMessages();
            const currentScroll = ui.chatStream.scrollTop;
            // 找到第一个顶部在当前视口上方的消息
            for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].top < currentScroll - 10) {
                    ui.chatStream.scrollTo({ top: msgs[i].top, behavior: 'smooth' });
                    break;
                }
            }
        };

        btnNext.onclick = () => {
            const msgs = getVisibleMessages();
            const currentScroll = ui.chatStream.scrollTop;
            // 找到第一个顶部在当前视口下方的消息
            for (let i = 0; i < msgs.length; i++) {
                if (msgs[i].top > currentScroll + 10) {
                    ui.chatStream.scrollTo({ top: msgs[i].top, behavior: 'smooth' });
                    break;
                }
            }
        };
    }

    function init() {
        bindUI();
        initResizers();
        updatePanelWidths();
        initQuickNav();

        // Backdrop 点击关闭
        if (ui.backdrop) {
            ui.backdrop.onclick = () => {
                togglePanel('left', false);
                togglePanel('right', false);
            };
        }

        // Bottom sheet backdrop
        if (ui.bottomSheetBackdrop) {
            ui.bottomSheetBackdrop.onclick = hideBottomSheet;
        }
    }

    function destroy() {
        unbindResponsiveListener();
    }

    return {
        init,
        destroy,
        bindUI,
        getUI,
        getState,
        togglePanel,
        updatePanelWidths,
        setCustomPanel,
        setDefaultRightPanel,
        restoreDefaultRightPanel,
        showBottomSheet,
        hideBottomSheet,
        getOrCreateContainer,
        animatePanelTransition,
        LAYOUT_DEFAULTS,
        // 暴露自定义容器供其他模块使用
        get customContainers() { return customContainers; }
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkLayout = FrameworkLayout;
}