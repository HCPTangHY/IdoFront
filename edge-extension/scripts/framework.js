/**
 * =============================================================================
 * LLM 框架核心 (可调整大小)
 * =============================================================================
 */
const Framework = (function() {
    
    // --- 配置与状态 ---
    const LAYOUT_DEFAULTS = {
        LEFT_WIDTH: 260,
        RIGHT_WIDTH: 320,
        MOBILE_PANEL_WIDTH: '85vw'
    };

    const state = {
        leftWidth: LAYOUT_DEFAULTS.LEFT_WIDTH,
        rightWidth: LAYOUT_DEFAULTS.RIGHT_WIDTH,
        leftOpen: window.innerWidth >= 768,   // Desktop default open
        rightOpen: window.innerWidth >= 768,  // Desktop default open
        messages: [],
        isDragging: false,
        lastScreenWidth: window.innerWidth    // 记录上次屏幕宽度，用于检测真正的屏幕尺寸变化
    };

    const ui = {};

    // --- 0. UI BINDING ---
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

    // --- 0.5 VIEW MANAGEMENT ---

    let currentMode = 'chat';
    const customContainers = {
        sidebar: null,
        main: null,
        right: null
    };
    
    // 右侧面板的默认渲染器（网络日志面板）
    let defaultRightPanelRenderer = null;

    // Track global window resize listener for cleanup
    let resizeHandlerBound = false;
    let resizeRafId = 0;
    let resizeListener = null;

    /**
     * 统一的面板内容切换动画函数
     * @param {HTMLElement} container - 要执行动画的容器
     * @param {Function|null} renderer - 渲染新内容的函数，null 表示清空
     * @returns {Promise<void>}
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
                // 备用超时，防止动画事件未触发
                setTimeout(resolve, 250);
            });
            container.classList.remove('panel-transition-exit');
        }
        
        // 更新内容
        container.innerHTML = '';
        if (renderer && typeof renderer === 'function') {
            renderer(container);
        }
        
        // 进入动画（仅当有新内容时）
        if (renderer) {
            container.classList.add('panel-transition-enter');
            await new Promise(resolve => {
                const onAnimationEnd = () => {
                    container.removeEventListener('animationend', onAnimationEnd);
                    container.classList.remove('panel-transition-enter');
                    resolve();
                };
                container.addEventListener('animationend', onAnimationEnd);
                // 备用超时
                setTimeout(() => {
                    container.classList.remove('panel-transition-enter');
                    resolve();
                }, 300);
            });
        }
    }

    /**
     * 获取或创建自定义容器
     * @param {string} type - 容器类型 ('sidebar', 'main', 'right')
     * @param {HTMLElement} parent - 父容器
     * @returns {HTMLElement}
     */
    function getOrCreateContainer(type, parent) {
        if (!customContainers[type]) {
            const el = document.createElement('div');
            el.className = "flex-1 flex flex-col min-h-0 overflow-hidden h-full w-full panel-transition-container";
            if (type === 'main' && ui.mainSlots && ui.mainSlots.input && ui.mainSlots.input.parentNode === parent) {
                // 主视图容器插入到输入区之前，保证输入区始终处于底部
                parent.insertBefore(el, ui.mainSlots.input);
            } else {
                parent.appendChild(el);
            }
            customContainers[type] = el;
        }
        return customContainers[type];
    }

    async function setMode(mode, renderers = {}) {
        const previousMode = currentMode;
        currentMode = mode;
        
        // Helper to toggle 标准布局元素
        // 默认：输入区在大多数模式下始终保留（复用底部输入框），
        // 但某些"全屏视图"（如 settings）需要隐藏输入。
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
            
            // 输入区按当前 mode 决定是否显示，使用 CSS class 控制动画，尽量避免内联样式
            if (ui.mainSlots.input) {
                const inputArea = ui.mainSlots.input;
                
                if (hideInputInThisMode) {
                    // 使用 CSS 类触发隐藏动画（translateY / opacity / max-height）
                    inputArea.classList.add('ido-input-area--hidden');
                    
                    // 动画结束后完全隐藏，避免影响布局高度
                    setTimeout(() => {
                        if (currentMode === mode && hideInputInThisMode) {
                            inputArea.style.display = 'none';
                        }
                    }, 300);
                } else {
                    // 恢复显示：先清除 display:none，再移除隐藏类
                    inputArea.style.display = '';
                    
                    // 清理可能残留的内联样式（兼容旧版本）
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
            if (customContainers.sidebar) customContainers.sidebar.style.display = 'none';
            if (customContainers.main) customContainers.main.style.display = 'none';
        } else {
            toggleStandard(false);
            
            // Setup Custom Sidebar with animation
            const sbContainer = getOrCreateContainer('sidebar', ui.leftPanel);
            sbContainer.style.display = 'flex';
            await animatePanelTransition(sbContainer, renderers.sidebar || null);
 
            // Setup Custom Main with animation
            const mainParent = ui.mainSlots.header.parentNode; // <main>
            const mContainer = getOrCreateContainer('main', mainParent);
            mContainer.style.display = 'flex';
            await animatePanelTransition(mContainer, renderers.main || null);
        }
 
        // 通知模式切换（供主视图插件/外部模块感知）
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
     * 设置右侧面板的默认渲染器（底层面板）
     * @param {Function} renderer - 默认面板的渲染函数
     */
    function setDefaultRightPanel(renderer) {
        defaultRightPanelRenderer = renderer;
        // 如果右侧面板已打开且没有自定义内容，立即渲染默认面板
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
            // 渲染默认面板（网络日志）
            if (defaultContent) defaultContent.style.display = 'none';
            container.style.display = 'flex';
            container.dataset.hasCustomContent = 'false';
            await animatePanelTransition(container, defaultRightPanelRenderer);
        } else {
            // 没有默认渲染器，清空并显示默认内容
            container.innerHTML = '';
            container.style.display = 'none';
            if (defaultContent) defaultContent.style.display = 'flex';
            delete container.dataset.hasCustomContent;
        }
    }

    async function setCustomPanel(side, renderer) {
        if (side !== 'right') return; // Currently only supporting right panel customization

        const defaultContent = document.getElementById('right-panel-default');
        const parent = ui.rightPanel;
        const container = getOrCreateContainer('right', parent);

        if (renderer) {
            // 显示自定义内容
            if (defaultContent) defaultContent.style.display = 'none';
            container.style.display = 'flex';
            container.dataset.hasCustomContent = 'true';
            await animatePanelTransition(container, renderer);
        } else {
            // 恢复到默认面板
            await restoreDefaultRightPanel();
        }
    }

    // --- 0.6 BOTTOM SHEET MANAGEMENT ---
    
    function showBottomSheet(renderer) {
        if (!ui.bottomSheet || !ui.bottomSheetContent || !ui.bottomSheetBackdrop) return;
        
        // 清空内容
        ui.bottomSheetContent.innerHTML = '';
        
        // 渲染内容
        if (typeof renderer === 'function') {
            renderer(ui.bottomSheetContent);
        }
        
        // 清理旧版残留的内联样式，避免覆盖 CSS 规则
        ui.bottomSheetBackdrop.style.opacity = '';
        ui.bottomSheet.style.transform = '';
        
        // 显示元素本身
        ui.bottomSheetBackdrop.classList.remove('hidden');
        ui.bottomSheet.classList.remove('hidden');
        
        // 使用 CSS 状态类触发过渡动画（不再直接写 style.opacity/transform）
        ui.bottomSheetBackdrop.classList.add('ido-bottom-sheet-backdrop--visible');
        ui.bottomSheet.classList.add('ido-bottom-sheet--visible');
    }
    
    function hideBottomSheet() {
        if (!ui.bottomSheet || !ui.bottomSheetBackdrop) return;
        
        // 移除可见状态类，由 CSS 负责过渡动画
        ui.bottomSheetBackdrop.classList.remove('ido-bottom-sheet-backdrop--visible');
        ui.bottomSheet.classList.remove('ido-bottom-sheet--visible');
        
        // 动画结束后隐藏元素并清空内容
        setTimeout(() => {
            ui.bottomSheetBackdrop.classList.add('hidden');
            ui.bottomSheet.classList.add('hidden');
            if (ui.bottomSheetContent) {
                ui.bottomSheetContent.innerHTML = '';
            }
        }, 300);
    }

    // --- 1. RESIZE & LAYOUT LOGIC ---

    function initResizers() {
        // Left Resizer
        ui.resizerLeft.addEventListener('mousedown', (e) => startResize(e, 'left'));
        
        // Right Resizer
        ui.resizerRight.addEventListener('mousedown', (e) => startResize(e, 'right'));

        // Check Initial Screen Size & Apply Default State
        checkResponsive();
        bindResponsiveListener();
    }

    // --- 1.1 MOBILE SWIPE GESTURE ---
    
    // 移动端触摸手势状态
    const swipeState = {
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        isSwiping: false,
        isDragging: false, // 是否正在拖动（跟手）
        swipeTarget: null, // 'open-left' | 'open-right' | 'close-left' | 'close-right' | null
        startTime: 0
    };
    
    // 手势配置
    const SWIPE_CONFIG = {
        EDGE_THRESHOLD: 30,      // 边缘触发区域宽度（像素）
        MIN_SWIPE_DISTANCE: 50,  // 最小滑动距离
        MAX_SWIPE_TIME: 300,     // 最大滑动时间（毫秒）
        VELOCITY_THRESHOLD: 0.3, // 速度阈值（像素/毫秒）
        DRAG_THRESHOLD: 10       // 开始拖动的最小距离
    };
    
    /**
     * 获取面板最大宽度（用于拖动计算）
     */
    function getPanelMaxWidth() {
        // 移动端面板宽度为 85vw
        return window.innerWidth * 0.85;
    }
    
    /**
     * 初始化移动端滑动手势
     */
    function initMobileSwipe() {
        // 监听整个文档，以便能够在面板上也捕获手势
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false }); // 需要 preventDefault
        document.addEventListener('touchend', handleTouchEnd, { passive: true });
        document.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    }
    
    /**
     * 处理触摸开始事件
     */
    function handleTouchStart(e) {
        // 仅在移动端生效
        if (window.innerWidth >= 768) return;
        
        const touch = e.touches[0];
        swipeState.startX = touch.clientX;
        swipeState.startY = touch.clientY;
        swipeState.currentX = touch.clientX;
        swipeState.currentY = touch.clientY;
        swipeState.startTime = Date.now();
        swipeState.isSwiping = false;
        swipeState.isDragging = false;
        swipeState.swipeTarget = null;
        
        const screenWidth = window.innerWidth;
        
        // 检测是否在边缘区域开始触摸
        if (!state.leftOpen && !state.rightOpen) {
            // 两个面板都关闭时，检测边缘触摸
            if (touch.clientX < SWIPE_CONFIG.EDGE_THRESHOLD) {
                // 左边缘 - 准备打开左侧面板
                swipeState.swipeTarget = 'open-left';
            } else if (touch.clientX > screenWidth - SWIPE_CONFIG.EDGE_THRESHOLD) {
                // 右边缘 - 准备打开右侧面板
                swipeState.swipeTarget = 'open-right';
            }
        } else if (state.leftOpen) {
            // 左面板打开时，准备关闭
            swipeState.swipeTarget = 'close-left';
        } else if (state.rightOpen) {
            // 右面板打开时，准备关闭
            swipeState.swipeTarget = 'close-right';
        }
    }
    
    /**
     * 处理触摸移动事件
     */
    function handleTouchMove(e) {
        if (!swipeState.swipeTarget) return;
        if (window.innerWidth >= 768) return;
        
        const touch = e.touches[0];
        swipeState.currentX = touch.clientX;
        swipeState.currentY = touch.clientY;
        
        const deltaX = swipeState.currentX - swipeState.startX;
        const deltaY = swipeState.currentY - swipeState.startY;
        
        // 如果垂直滑动距离大于水平滑动距离，取消手势（用户可能在滚动）
        if (!swipeState.isDragging && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
            swipeState.swipeTarget = null;
            return;
        }
        
        // 开始拖动
        if (Math.abs(deltaX) > SWIPE_CONFIG.DRAG_THRESHOLD) {
            swipeState.isSwiping = true;
            
            // 首次进入拖动状态时，禁用面板过渡动画
            if (!swipeState.isDragging) {
                swipeState.isDragging = true;
                ui.leftPanel.classList.remove('transition-width');
                ui.rightPanel.classList.remove('transition-width');
                ui.leftPanel.classList.add('ido-panel--dragging');
                ui.rightPanel.classList.add('ido-panel--dragging');
            }
            
            // 阻止默认行为（防止页面滚动）
            e.preventDefault();
            
            // 根据目标类型更新面板位置
            updatePanelDragPosition(deltaX);
        }
    }
    
    /**
     * 更新面板拖动位置
     */
    function updatePanelDragPosition(deltaX) {
        const maxWidth = getPanelMaxWidth();
        
        switch (swipeState.swipeTarget) {
            case 'open-left': {
                // 从关闭状态向右拖动打开左面板
                // deltaX > 0 表示向右拖
                const progress = Math.max(0, Math.min(1, deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.leftPanel.style.width = `${width}px`;
                // 更新遮罩透明度
                ui.backdrop.classList.remove('hidden');
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
            case 'close-left': {
                // 从打开状态向左拖动关闭左面板
                // deltaX < 0 表示向左拖
                const progress = Math.max(0, Math.min(1, 1 + deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.leftPanel.style.width = `${width}px`;
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
            case 'open-right': {
                // 从关闭状态向左拖动打开右面板
                // deltaX < 0 表示向左拖
                const progress = Math.max(0, Math.min(1, -deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.rightPanel.style.width = `${width}px`;
                ui.backdrop.classList.remove('hidden');
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
            case 'close-right': {
                // 从打开状态向右拖动关闭右面板
                // deltaX > 0 表示向右拖
                const progress = Math.max(0, Math.min(1, 1 - deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.rightPanel.style.width = `${width}px`;
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
        }
    }
    
    /**
     * 处理触摸结束事件
     */
    function handleTouchEnd(e) {
        if (!swipeState.swipeTarget) {
            resetSwipeState();
            return;
        }
        if (window.innerWidth >= 768) {
            resetSwipeState();
            return;
        }
        
        const deltaX = swipeState.currentX - swipeState.startX;
        const deltaTime = Date.now() - swipeState.startTime;
        const velocity = Math.abs(deltaX) / deltaTime;
        const maxWidth = getPanelMaxWidth();
        
        // 恢复过渡动画
        ui.leftPanel.classList.remove('ido-panel--dragging');
        ui.rightPanel.classList.remove('ido-panel--dragging');
        ui.leftPanel.classList.add('transition-width');
        ui.rightPanel.classList.add('transition-width');
        
        // 清除拖动时设置的内联样式
        ui.backdrop.style.opacity = '';
        
        // 如果进行过拖动，根据最终位置和速度决定结果
        if (swipeState.isDragging) {
            // 计算进度
            let progress = 0;
            let shouldOpen = false;
            
            switch (swipeState.swipeTarget) {
                case 'open-left':
                    progress = Math.max(0, Math.min(1, deltaX / maxWidth));
                    // 如果进度超过 50% 或速度足够快，则打开
                    shouldOpen = progress > 0.5 || (velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX > 0);
                    togglePanel('left', shouldOpen);
                    break;
                case 'close-left':
                    progress = Math.max(0, Math.min(1, 1 + deltaX / maxWidth));
                    // 如果进度低于 50% 或速度足够快，则关闭
                    shouldOpen = progress > 0.5 && !(velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX < 0);
                    togglePanel('left', shouldOpen);
                    break;
                case 'open-right':
                    progress = Math.max(0, Math.min(1, -deltaX / maxWidth));
                    shouldOpen = progress > 0.5 || (velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX < 0);
                    togglePanel('right', shouldOpen);
                    break;
                case 'close-right':
                    progress = Math.max(0, Math.min(1, 1 - deltaX / maxWidth));
                    shouldOpen = progress > 0.5 && !(velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX > 0);
                    togglePanel('right', shouldOpen);
                    break;
            }
        } else if (swipeState.isSwiping) {
            // 没有拖动但有滑动，使用原来的逻辑
            const isValidSwipe = Math.abs(deltaX) >= SWIPE_CONFIG.MIN_SWIPE_DISTANCE ||
                                (velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaTime <= SWIPE_CONFIG.MAX_SWIPE_TIME);
            
            if (isValidSwipe) {
                switch (swipeState.swipeTarget) {
                    case 'open-left':
                        if (deltaX > 0) togglePanel('left', true);
                        break;
                    case 'open-right':
                        if (deltaX < 0) togglePanel('right', true);
                        break;
                    case 'close-left':
                        if (deltaX < 0) togglePanel('left', false);
                        break;
                    case 'close-right':
                        if (deltaX > 0) togglePanel('right', false);
                        break;
                }
            }
        }
        
        resetSwipeState();
    }
    
    /**
     * 重置滑动状态
     */
    function resetSwipeState() {
        swipeState.startX = 0;
        swipeState.startY = 0;
        swipeState.currentX = 0;
        swipeState.currentY = 0;
        swipeState.isSwiping = false;
        swipeState.isDragging = false;
        swipeState.swipeTarget = null;
        swipeState.startTime = 0;
    }

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
        const isMobile = currentWidth < 768;
        const wasMobile = state.lastScreenWidth < 768;
        
        // 只在真正从桌面切换到移动端时才关闭侧边栏
        // 避免移动端键盘弹出导致的 resize 事件误触发关闭
        if (isMobile && !wasMobile) {
            // 从桌面切换到移动端：关闭侧边栏
            if (state.leftOpen) state.leftOpen = false;
            if (state.rightOpen) state.rightOpen = false;
        }
        
        // 更新记录的屏幕宽度
        state.lastScreenWidth = currentWidth;
        
        // Always update width visuals based on current state
        updatePanelWidths();
    }

    function startResize(e, side) {
        e.preventDefault();
        state.isDragging = true;
        document.body.classList.add('is-resizing');
        ui.leftPanel.classList.remove('transition-width');
        ui.rightPanel.classList.remove('transition-width');

        // Visual feedback on resizer
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
                // Right panel resizing is inverted (pull left to increase)
                const newW = Math.max(200, Math.min(800, startWidth - delta));
                state.rightWidth = newW;
                ui.rightPanel.style.width = `${newW}px`;
            }
        };

        const stopDrag = () => {
            state.isDragging = false;
            document.body.classList.remove('is-resizing');
            resizer.classList.remove('active');
            
            // Re-enable transitions
            ui.leftPanel.classList.add('transition-width');
            ui.rightPanel.classList.add('transition-width');

            window.removeEventListener('mousemove', doDrag);
            window.removeEventListener('mouseup', stopDrag);
        };

        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', stopDrag);
    }

    function togglePanel(side, force) {
        const isLeft = side === 'left';
        const currentState = isLeft ? state.leftOpen : state.rightOpen;
        const newState = force !== undefined ? force : !currentState;
        
        if (isLeft) {
            state.leftOpen = newState;
        } else {
            // 右侧面板特殊处理
            const isMobile = window.innerWidth < 768;
            
            if (!newState) {
                // 尝试关闭时
                if (!isMobile) {
                    // 桌面端：检查是否有自定义内容
                    const container = customContainers.right;
                    const hasCustomContent = container && container.dataset.hasCustomContent === 'true';
                    
                    if (hasCustomContent) {
                        // 有自定义内容：不关闭，而是切换到默认面板
                        restoreDefaultRightPanel();
                        state.rightOpen = true; // 保持打开状态
                    } else {
                        // 已经是默认面板：真正关闭
                        state.rightOpen = false;
                    }
                } else {
                    // 移动端：直接关闭，并恢复到默认面板状态
                    state.rightOpen = false;
                    // 清除自定义内容标记，确保下次打开时显示默认面板
                    restoreDefaultRightPanel();
                }
            } else {
                // 打开时
                state.rightOpen = true;
                
                // 如果没有自定义内容，渲染默认面板
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
        const isMobile = window.innerWidth < 768;
        
        // Left Panel
        if (state.leftOpen) {
            if (isMobile) {
                ui.leftPanel.style.width = LAYOUT_DEFAULTS.MOBILE_PANEL_WIDTH;
                ui.backdrop.classList.remove('hidden');
            } else {
                ui.leftPanel.style.width = `${state.leftWidth}px`;
                ui.backdrop.classList.add('hidden'); // No backdrop on desktop
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
        
        // Hide backdrop if both closed (mobile check)
        if (isMobile && !state.leftOpen && !state.rightOpen) {
             ui.backdrop.classList.add('hidden');
        }
    }


    function clearMessages() {
        state.messages = [];
        ui.chatStream.innerHTML = '';
    }

    // --- 1.5 UTILITIES (Events & Storage) ---
    
    const events = {
        listeners: {},
        on(event, callback) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(callback);
        },
        emit(event, data) {
            if (this.listeners[event]) {
                this.listeners[event].forEach(cb => cb(data));
            }
        },
        emitAsync(event, data) {
            if (!this.listeners[event]) return;
            const handlers = this.listeners[event].slice();
            for (const cb of handlers) {
                Promise.resolve().then(() => {
                    try {
                        cb(data);
                    } catch (e) {
                        console.warn('Framework async handler error:', e);
                    }
                });
            }
        },
        off(event, callback) {
            if (!this.listeners[event]) return;
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    };

    const storage = {
        setItem(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) { console.error('Storage save error:', e); }
        },
        getItem(key, defaultValue) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                console.error('Storage load error:', e);
                return defaultValue;
            }
        }
    };

    // --- 2. PLUGIN SYSTEM ---
    
    const SLOTS = {
        SIDEBAR_TOP: 'slot-sidebar-top',
        SIDEBAR_BOTTOM: 'slot-sidebar-bottom',
        HEADER_ACTIONS: 'slot-header-actions',
        INPUT_TOP: 'slot-input-top',
        INPUT_ACTIONS_LEFT: 'slot-input-actions-left',
        INPUT_ACTIONS_RIGHT: 'slot-input-actions-right',
        MESSAGE_FOOTER: 'message-footer',
        MESSAGE_MORE_ACTIONS: 'message-more-actions'  // 更多操作下拉菜单插槽
    };
    
    const registry = {};
    let publicApi = null;
    
    function registerPlugin(slotName, id, definition) {
        if (!registry[slotName]) registry[slotName] = [];
    
        // 兼容旧签名：第三个参数为函数时，视为 render 函数
        let plugin;
        if (typeof definition === 'function' || definition == null) {
            // 函数签名的插件：只有渲染函数，没有显式元数据
            plugin = {
                id,
                enabled: true,
                renderStatic: definition || null,
                renderDynamic: definition || null,
                init: null,
                destroy: null,
                meta: {
                    id: id,
                    name: id,
                    description: '',
                    version: '',
                    icon: '',
                    author: '',
                    homepage: '',
                    source: 'internal',
                    tags: undefined
                }
            };
        } else {
            // 对象签名的插件：支持 meta / name / description 等元数据字段
            var meta = definition.meta || {};
            plugin = {
                id,
                enabled: definition.enabled !== false,
                renderStatic: definition.render || definition.renderStatic || definition.renderer || null,
                renderDynamic: definition.renderDynamic || definition.render || definition.renderer || null,
                init: definition.init || null,
                destroy: definition.destroy || null,
                meta: {
                    id: meta.id || id,
                    name: meta.name || definition.name || id,
                    description: meta.description || definition.description || '',
                    version: meta.version || definition.version || '',
                    icon: meta.icon || definition.icon || '',
                    author: meta.author || definition.author || '',
                    homepage: meta.homepage || definition.homepage || '',
                    source: meta.source || definition.source || 'internal',
                    tags: meta.tags || definition.tags || undefined
                }
            };
        }
    
        // 生命周期：init 仅在注册时调用一次
        if (typeof plugin.init === 'function') {
            try {
                plugin.init(publicApi);
            } catch (e) {
                console.error(`Plugin init error in ${slotName}/${id}:`, e);
            }
        }
    
        registry[slotName].push(plugin);
        // Defer refresh until DOM is likely ready or called manually
        setTimeout(() => refreshSlot(slotName), 0);
    }
    
    function refreshSlot(slotName) {
        // Static slots only
        const el = document.getElementById(slotName);
        if (!el || !registry[slotName]) return;
        
        el.innerHTML = '';
        registry[slotName].forEach(plugin => {
            if (!plugin || plugin.enabled === false) return;
            const renderer = plugin.renderStatic || plugin.renderDynamic;
            if (typeof renderer !== 'function') return;
            try {
                const content = renderer(publicApi);
                if (content instanceof HTMLElement) {
                    el.appendChild(content);
                } else if (typeof content === 'string') {
                    el.insertAdjacentHTML('beforeend', content);
                }
            } catch (e) {
                console.error(`Plugin error in ${slotName}/${plugin.id}:`, e);
            }
        });
        // Show if content exists
        el.classList.toggle('hidden', el.childNodes.length === 0);
    }
    
    function getDynamicPlugins(slotName, context) {
        if (!registry[slotName]) return [];
        return registry[slotName].map(plugin => {
            if (!plugin || plugin.enabled === false) return null;
            const renderer = plugin.renderDynamic || plugin.renderStatic;
            if (typeof renderer !== 'function') return null;
            try {
                // 保持向后兼容：优先传入调用方上下文，其次传入 Framework API
                return renderer(context || publicApi);
            } catch(e) {
                console.error(`Dynamic plugin error ${slotName}/${plugin.id}:`, e);
                return null;
            }
        }).filter(Boolean);
    }
    
    function setPluginEnabled(slotName, id, enabled) {
        const list = registry[slotName];
        if (!list) return;
        list.forEach(plugin => {
            if (plugin.id === id) {
                plugin.enabled = enabled !== false;
            }
        });
        refreshSlot(slotName);
    }
    
    function unregisterPlugin(slotName, id) {
        const list = registry[slotName];
        if (!list) return;
        registry[slotName] = list.filter(plugin => {
            const keep = plugin.id !== id;
            if (!keep && typeof plugin.destroy === 'function') {
                try {
                    plugin.destroy(publicApi);
                } catch (e) {
                    console.error(`Plugin destroy error in ${slotName}/${plugin.id}:`, e);
                }
            }
            return keep;
        });
        refreshSlot(slotName);
    }

    function getPlugins() {
        const all = [];
        Object.keys(registry).forEach(slot => {
            registry[slot].forEach(p => {
                all.push({
                    slot,
                    id: p.id,
                    enabled: p.enabled,
                    meta: p.meta || null
                });
            });
        });
        return all;
    }
    
    // --- 2.5 CHAT HEADER INITIALIZATION ---
    
    /**
     * 初始化聊天界面的 header
     */
    function initChatHeader() {
        const headerContainer = ui.mainSlots.header;
        if (!headerContainer) return;
        
        // 创建统一的 header
        const header = createCustomHeader({
            center: () => {
                const centerContent = document.createElement('div');
                // 使用 Tailwind 类控制溢出，避免重复写内联样式
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
                
                // 插件槽位
                const pluginSlot = document.createElement('div');
                pluginSlot.id = "slot-header-actions";
                pluginSlot.className = "flex gap-1";
                
                // 分隔线
                const divider = document.createElement('div');
                divider.className = "h-4 w-px bg-gray-300 mx-2";
                
                rightContent.appendChild(pluginSlot);
                rightContent.appendChild(divider);
                
                return rightContent;
            }
        });
        
        headerContainer.appendChild(header);

        // Header actions 插槽是在这里动态创建的，
        // 此时需要主动刷新该插槽，让通过 Framework.registerPlugin
        // 注册到 HEADER_ACTIONS 的插件（如 builtin-theme-toggle）真正渲染出来。
        try {
            if (typeof refreshSlot === 'function' && SLOTS && SLOTS.HEADER_ACTIONS) {
                refreshSlot(SLOTS.HEADER_ACTIONS);
            }
        } catch (e) {
            console.warn('Framework: failed to refresh HEADER_ACTIONS slot:', e);
        }
    }
    
    // --- 2.5 UI Helper Components ---
    
    /**
     * 创建自定义模式的统一 header
     * @param {Object} options - 配置选项
     * @param {string|HTMLElement|Function} options.center - 中间内容（字符串、元素或渲染函数）
     * @param {HTMLElement|Function} options.right - 右侧内容（元素或渲染函数，可选）
     * @param {boolean} options.showOpenInNew - 是否显示"全屏打开"按钮（默认true）
     * @returns {HTMLElement} header 元素
     */
    function createCustomHeader(options = {}) {
        const { center, right, showOpenInNew = true } = options;
        
        // 创建 header 容器
        const header = document.createElement('header');
        header.className = 'ido-header';
        
        // 左侧：收起左边栏按钮
        const leftGroup = document.createElement('div');
        leftGroup.className = 'ido-header__left';
        
        const toggleLeftBtn = document.createElement('button');
        toggleLeftBtn.className = 'ido-icon-btn';
        toggleLeftBtn.title = '切换左侧边栏';
        toggleLeftBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">side_navigation</span>';
        toggleLeftBtn.onclick = () => togglePanel('left');
        
        leftGroup.appendChild(toggleLeftBtn);
        header.appendChild(leftGroup);
        
        // 中间内容区域（独立于左右两侧）
        if (center) {
            const centerContainer = document.createElement('div');
            centerContainer.className = 'ido-header__center';
            
            if (typeof center === 'function') {
                // 如果是函数，调用它来渲染内容
                const content = center();
                if (content instanceof HTMLElement) {
                    centerContainer.appendChild(content);
                } else if (typeof content === 'string') {
                    centerContainer.innerHTML = content;
                }
            } else if (center instanceof HTMLElement) {
                centerContainer.appendChild(center);
            } else if (typeof center === 'string') {
                centerContainer.innerHTML = center;
            }
            
            header.appendChild(centerContainer);
        }
        
        // 右侧：收起右边栏按钮
        const rightGroup = document.createElement('div');
        rightGroup.className = 'ido-header__right';
        
        // 自定义右侧内容（可选）
        if (right) {
            const rightContainer = document.createElement('div');
            rightContainer.style.display = 'flex';
            rightContainer.style.alignItems = 'center';
            rightContainer.style.gap = 'var(--ido-spacing-sm)';
            
            if (typeof right === 'function') {
                const content = right();
                if (content instanceof HTMLElement) {
                    rightContainer.appendChild(content);
                } else if (typeof content === 'string') {
                    rightContainer.innerHTML = content;
                }
            } else if (right instanceof HTMLElement) {
                rightContainer.appendChild(right);
            }
            
            rightGroup.appendChild(rightContainer);
        }
        
        // 全屏打开按钮（统一添加到所有 header）
        if (showOpenInNew) {
            const openInNewBtn = document.createElement('button');
            openInNewBtn.className = 'ido-icon-btn';
            openInNewBtn.title = '全屏打开';
            openInNewBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">open_in_new</span>';
            openInNewBtn.onclick = () => {
                // 构建包含当前状态的URL
                let url = 'sidepanel.html';
                const params = new URLSearchParams();
                
                // 保存当前模式
                if (currentMode && currentMode !== 'chat') {
                    params.set('mode', currentMode);
                }
                
                // 触发事件让各模块保存自己的状态
                if (events && typeof events.emitAsync === 'function') {
                    events.emitAsync('save-state-for-new-tab', params);
                } else if (events && typeof events.emit === 'function') {
                    events.emit('save-state-for-new-tab', params);
                }
                
                const queryString = params.toString();
                if (queryString) {
                    url += '?' + queryString;
                }
                
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    chrome.tabs.create({ url }, () => {
                        window.close();
                    });
                } else {
                    window.open(url, '_blank');
                    window.close();
                }
            };
            rightGroup.appendChild(openInNewBtn);
        }
        
        const toggleRightBtn = document.createElement('button');
        toggleRightBtn.className = 'ido-icon-btn';
        toggleRightBtn.title = '切换右侧边栏';
        toggleRightBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">side_navigation</span>';
        toggleRightBtn.style.transform = 'scaleX(-1)'; // 镜像翻转图标
        toggleRightBtn.onclick = () => togglePanel('right');
        
        rightGroup.appendChild(toggleRightBtn);
        header.appendChild(rightGroup);
        
        return header;
    }
    
    /**
     * Helper to create icon + label buttons with consistent DOM structure.
     * Delegates to global IdoUI.createIconButton when available, so that
     * external plugins can also reuse the same UI factory.
     */
    function createIconButton(options = {}) {
        const globalFactory = window.IdoUI && typeof window.IdoUI.createIconButton === 'function'
            ? window.IdoUI.createIconButton
            : null;

        if (globalFactory) {
            return globalFactory(options);
        }

        const {
            label,
            icon,
            title,
            className = '',
            iconClassName = 'material-symbols-outlined text-[18px]',
            onClick
        } = options;

        const btn = document.createElement('button');
        if (className) btn.className = className;
        if (title) btn.title = title;
    
        if (icon) {
            const iconSpan = document.createElement('span');
            iconSpan.className = iconClassName;
            iconSpan.textContent = icon;
            btn.appendChild(iconSpan);
        }
    
        if (label) {
            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            btn.appendChild(labelSpan);
        }
    
        if (typeof onClick === 'function') {
            btn.onclick = onClick;
        }
    
        return btn;
    }
    
    // --- 2.6 LIGHTBOX FUNCTIONALITY ---
    
    /**
     * 打开图片 Lightbox
     * @param {Array} images - 图片数组
     * @param {number} currentIndex - 当前图片索引
     */
    function openLightbox(images, currentIndex) {
        if (!images || images.length === 0) return;
        
        let currentIdx = currentIndex;
        
        // 创建 lightbox 容器
        const lightbox = document.createElement('div');
        lightbox.className = 'ido-lightbox';
        lightbox.id = 'ido-lightbox';
        
        const content = document.createElement('div');
        content.className = 'ido-lightbox__content';
        
        // 图片元素
        const img = document.createElement('img');
        img.className = 'ido-lightbox__image';
        img.src = images[currentIdx].dataUrl;
        img.alt = images[currentIdx].name || 'Image';
        
        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ido-lightbox__close';
        closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
        closeBtn.onclick = closeLightbox;
        
        content.appendChild(img);
        content.appendChild(closeBtn);
        
        // 多图时添加导航按钮和计数器
        if (images.length > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'ido-lightbox__nav ido-lightbox__nav--prev';
            prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
            prevBtn.onclick = () => navigateLightbox(-1);
            
            const nextBtn = document.createElement('button');
            nextBtn.className = 'ido-lightbox__nav ido-lightbox__nav--next';
            nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
            nextBtn.onclick = () => navigateLightbox(1);
            
            const counter = document.createElement('div');
            counter.className = 'ido-lightbox__counter';
            counter.id = 'lightbox-counter';
            counter.textContent = `${currentIdx + 1} / ${images.length}`;
            
            content.appendChild(prevBtn);
            content.appendChild(nextBtn);
            content.appendChild(counter);
        }
        
        lightbox.appendChild(content);
        document.body.appendChild(lightbox);
        
        // 触发显示动画
        requestAnimationFrame(() => {
            lightbox.classList.add('ido-lightbox--visible');
        });
        
        // 键盘导航
        function handleKeydown(e) {
            if (e.key === 'Escape') {
                closeLightbox();
            } else if (e.key === 'ArrowLeft' && images.length > 1) {
                navigateLightbox(-1);
            } else if (e.key === 'ArrowRight' && images.length > 1) {
                navigateLightbox(1);
            }
        }
        
        document.addEventListener('keydown', handleKeydown);
        
        // 点击背景关闭
        lightbox.onclick = (e) => {
            if (e.target === lightbox) {
                closeLightbox();
            }
        };
        
        // 导航函数
        function navigateLightbox(direction) {
            currentIdx = (currentIdx + direction + images.length) % images.length;
            img.src = images[currentIdx].dataUrl;
            img.alt = images[currentIdx].name || 'Image';
            
            const counter = document.getElementById('lightbox-counter');
            if (counter) {
                counter.textContent = `${currentIdx + 1} / ${images.length}`;
            }
        }
        
        // 关闭函数
        function closeLightbox() {
            document.removeEventListener('keydown', handleKeydown);
            lightbox.classList.remove('ido-lightbox--visible');
            
            setTimeout(() => {
                lightbox.remove();
            }, 300);
        }
    }
    
    // --- 3. MESSAGING ---

    function addMessage(role, textOrObj, options) {
        options = options || {};
        // Support object with {content, reasoning, id, attachments}
        let text = textOrObj;
        let reasoning = null;
        let id = Date.now();
        let attachments = null;
        let reasoningDuration = null;
        
        if (typeof textOrObj === 'object' && textOrObj !== null) {
            text = textOrObj.content || '';
            reasoning = textOrObj.reasoning || null;
            attachments = textOrObj.attachments || null;
            reasoningDuration = textOrObj.reasoningDuration || null;
            if (textOrObj.id) id = textOrObj.id;
        }
        
        // 支持目标容器（用于批量渲染时传入 DocumentFragment）
        const targetContainer = options.targetContainer || ui.chatStream;
        
        const msg = { role, text, reasoning, id, attachments };
        state.messages.push(msg);

        // 新卡片设计：统一的消息卡片容器
        const card = document.createElement('div');
        card.className = 'ido-message';
        card.dataset.messageId = id;
        card.dataset.role = role;
        
        // 角色标签
        const roleLabel = document.createElement('div');
        roleLabel.className = 'ido-message__role';
        roleLabel.textContent = role === 'user' ? 'User' : 'AI';
        card.appendChild(roleLabel);
        
        // 内容容器
        const container = document.createElement('div');
        container.className = 'ido-message__container';
        
        // 思维链区块
        if (reasoning) {
            const reasoningBlock = document.createElement('div');
            reasoningBlock.className = 'reasoning-block';
            
            const toggle = document.createElement('div');
            toggle.className = 'reasoning-toggle';
            
            let reasoningDuration = null;
            if (typeof textOrObj === 'object' && textOrObj !== null && textOrObj.reasoningDuration !== undefined) {
                reasoningDuration = textOrObj.reasoningDuration;
            }
            
            const isHistoricalMessage = (text && text.trim().length > 0) || options.isHistorical;
            
            if (reasoningDuration !== null && reasoningDuration !== undefined) {
                toggle.innerHTML = `<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">${typeof reasoningDuration === 'number' ? reasoningDuration.toFixed(1) : reasoningDuration}s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>`;
            } else if (isHistoricalMessage) {
                toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';
            } else {
                toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">0.0s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';
                
                const timerSpan = toggle.querySelector('.reasoning-timer');
                const startTime = Date.now();
                const timerId = setInterval(() => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    if (timerSpan) timerSpan.textContent = elapsed.toFixed(1) + 's';
                }, 100);
                
                reasoningBlock.dataset.timerId = timerId;
                reasoningBlock.dataset.startTime = startTime;
            }
            
            toggle.onclick = (e) => {
                const content = e.currentTarget.nextElementSibling;
                const icon = e.currentTarget.querySelector('.material-symbols-outlined:last-child');
                content.classList.toggle('open');
                if (content.classList.contains('open')) {
                    icon.style.transform = 'rotate(180deg)';
                } else {
                    icon.style.transform = 'rotate(0deg)';
                }
            };
            
            const content = document.createElement('div');
            content.className = 'reasoning-content markdown-body';
            content.textContent = reasoning || '';
            content.dataset.needsMarkdown = 'true';
            
            reasoningBlock.appendChild(toggle);
            reasoningBlock.appendChild(content);
            container.appendChild(reasoningBlock);
        }
        
        // 主要内容
        const contentDiv = document.createElement('div');
        contentDiv.className = 'ido-message__content';
        
        const contentSpan = document.createElement('div');
        contentSpan.className = 'message-content markdown-body';
        contentSpan.textContent = text || '';
        if (role !== 'user') {
            contentSpan.dataset.needsMarkdown = 'true';
        }
        contentDiv.appendChild(contentSpan);
        container.appendChild(contentDiv);
        
        // 附件预览（放在内容之后）
        if (attachments && attachments.length > 0) {
            const imageAttachments = attachments.filter(a => a && a.type && a.type.startsWith('image/'));
            
            if (imageAttachments.length > 0) {
                const attachmentsContainer = document.createElement('div');
                // 根据图片数量选择布局类
                if (imageAttachments.length === 1) {
                    attachmentsContainer.className = 'ido-message__attachments ido-message__attachments--single';
                } else {
                    attachmentsContainer.className = 'ido-message__attachments ido-message__attachments--grid';
                }
                
                imageAttachments.forEach((attachment, index) => {
                    const imgWrapper = document.createElement('div');
                    imgWrapper.className = 'ido-message__attachment-wrapper';
                    imgWrapper.dataset.imageIndex = index;
                    imgWrapper.dataset.imageTotal = imageAttachments.length;
                    
                    const img = document.createElement('img');
                    img.src = attachment.dataUrl;
                    img.alt = attachment.name || 'Attached image';
                    img.loading = 'lazy';
                    
                    // 放大覆盖层
                    const overlay = document.createElement('div');
                    overlay.className = 'ido-message__attachment-overlay';
                    overlay.innerHTML = '<span class="material-symbols-outlined">zoom_in</span>';
                    
                    imgWrapper.appendChild(img);
                    imgWrapper.appendChild(overlay);
                    
                    // 点击打开 lightbox
                    imgWrapper.onclick = () => {
                        openLightbox(imageAttachments, index);
                    };
                    
                    attachmentsContainer.appendChild(imgWrapper);
                });
                
                container.appendChild(attachmentsContainer);
            }
        }
        
        card.appendChild(container);
        
        // 操作栏（通过插件系统注入）
        const actionPlugins = getDynamicPlugins(SLOTS.MESSAGE_FOOTER, msg);
        if (actionPlugins.length > 0) {
            const actions = document.createElement('div');
            actions.className = 'ido-message__actions';
            actionPlugins.forEach(p => {
                if (p) actions.appendChild(p);
            });
            card.appendChild(actions);
        }
        
        targetContainer.appendChild(card);
        // 仅在直接添加到 chatStream 时处理滚动
        if (targetContainer === ui.chatStream && !options.noScroll) {
            ui.chatStream.scrollTop = ui.chatStream.scrollHeight;
        }
        
        return msg.id;
    }
    
    /**
     * 添加加载指示器（三个浮动的点）
     * @returns {string} 加载指示器的ID
     */
    function addLoadingIndicator() {
        const loadingId = `loading_${Date.now()}`;
        
        const card = document.createElement('div');
        card.className = 'ido-message';
        card.dataset.loadingId = loadingId;
        
        const roleLabel = document.createElement('div');
        roleLabel.className = 'ido-message__role';
        roleLabel.textContent = 'AI';
        card.appendChild(roleLabel);
        
        const container = document.createElement('div');
        container.className = 'ido-message__container ido-message__container--loading';
        
        const loadingDots = document.createElement('div');
        loadingDots.className = 'ido-loading-dots';
        loadingDots.innerHTML = `
            <span class="ido-loading-dots__dot"></span>
            <span class="ido-loading-dots__dot"></span>
            <span class="ido-loading-dots__dot"></span>
        `;
        
        container.appendChild(loadingDots);
        card.appendChild(container);
        
        ui.chatStream.appendChild(card);
        ui.chatStream.scrollTop = ui.chatStream.scrollHeight;
        
        return loadingId;
    }
    
    /**
     * 移除加载指示器
     * @param {string} loadingId - 加载指示器的ID
     */
    function removeLoadingIndicator(loadingId) {
        if (!loadingId) return;
        
        const loadingElement = ui.chatStream.querySelector(`[data-loading-id="${loadingId}"]`);
        if (loadingElement) {
            loadingElement.remove();
        }
    }
 
    function getMessageWrapperById(messageId) {
        if (!messageId) return null;
        return ui.chatStream.querySelector(`[data-message-id="${messageId}"]`);
    }
 
    // 获取当前列表中的最后一条消息卡片（忽略 loading 气泡）
    function getLastMessageCard() {
        if (!ui.chatStream) return null;
        const cards = ui.chatStream.querySelectorAll('[data-message-id]');
        if (!cards || cards.length === 0) return null;
        return cards[cards.length - 1];
    }
 
    /**
     * 将加载指示器附着到指定消息下方，形成"下一行"效果
     * @returns {boolean} 是否成功附着
     */
    function attachLoadingIndicatorToMessage(loadingId, messageId) {
        if (!loadingId || !messageId) return false;
        const loadingElement = ui.chatStream.querySelector(`[data-loading-id="${loadingId}"]`);
        const targetWrapper = getMessageWrapperById(messageId);
        if (!loadingElement || !targetWrapper) return false;
 
        const loadingDots = loadingElement.querySelector('.ido-loading-dots');
        if (!loadingDots) return false;
 
        // 兼容新版消息结构：使用容器而非不存在的 .ido-message__bubble
        const container = targetWrapper.querySelector('.ido-message__container') || targetWrapper;
        if (!container) return false;
 
        // 包裹指示器，便于统一样式与后续删除
        const indicatorWrapper = document.createElement('div');
        indicatorWrapper.className = 'message-streaming-indicator';
        indicatorWrapper.appendChild(loadingDots);
 
        container.appendChild(indicatorWrapper);
        loadingElement.remove();
        return true;
    }
 
    /**
     * 移除附着在消息下方的加载指示器
     */
    function removeMessageStreamingIndicator(messageId) {
        let removed = false;
        if (messageId) {
            const targetWrapper = getMessageWrapperById(messageId);
            if (targetWrapper) {
                const indicators = targetWrapper.querySelectorAll('.message-streaming-indicator');
                indicators.forEach(indicator => {
                    indicator.remove();
                    removed = true;
                });
            }
        }
        // 兜底：若未找到特定消息，移除所有残留指示器
        if (!removed) {
            const orphanIndicators = ui.chatStream.querySelectorAll('.message-streaming-indicator');
            orphanIndicators.forEach(indicator => indicator.remove());
        }
    }
 
    // Markdown 渲染调度，利用 requestIdleCallback 或定时器批处理
    const markdownRenderQueue = [];
    let markdownRenderHandle = null;
    const scheduleIdle = (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
        ? (cb => window.requestIdleCallback(cb))
        : (cb => setTimeout(() => cb({
            didTimeout: true,
            timeRemaining: () => 50
        }), 16));
 
    /**
     * 同步渲染 Markdown（用于流式更新，避免闪烁）
     * @param {HTMLElement} target - 目标元素
     * @param {string} markdownText - Markdown 文本
     */
    function renderMarkdownSync(target, markdownText) {
        if (!target || typeof marked === 'undefined') {
            target.textContent = markdownText || '';
            return;
        }
        
        const safeText = typeof markdownText === 'string' ? markdownText : '';
        
        try {
            // 同步渲染，避免先显示纯文本导致闪烁
            target.innerHTML = marked.parse(safeText);
            target.classList.add('markdown-body');
        } catch (err) {
            console.warn('Markdown sync render failed:', err);
            target.textContent = safeText;
        }
    }
    
    function enqueueMarkdownRender(target, markdownText) {
        if (!target) return;
        const safeText = typeof markdownText === 'string' ? markdownText : '';
        if (!target.textContent) {
            target.textContent = safeText;
        }
 
        for (let i = markdownRenderQueue.length - 1; i >= 0; i -= 1) {
            if (markdownRenderQueue[i].target === target) {
                markdownRenderQueue.splice(i, 1);
            }
        }
 
        markdownRenderQueue.push({ target, markdownText: safeText });
 
        if (!markdownRenderHandle) {
            markdownRenderHandle = scheduleIdle(processMarkdownRenderQueue);
        }
    }
 
    function processMarkdownRenderQueue(deadline) {
        markdownRenderHandle = null;
        if (typeof marked === 'undefined') {
            markdownRenderQueue.length = 0;
            return;
        }
 
        const start = performance.now();
        const hasDeadline = deadline && typeof deadline.timeRemaining === 'function';
 
        while (markdownRenderQueue.length > 0) {
            if (hasDeadline && deadline.timeRemaining() < 5) break;
            if (!hasDeadline && performance.now() - start > 12) break;
 
            const { target, markdownText } = markdownRenderQueue.shift();
            if (!target) continue;
            const isAttached = typeof target.isConnected === 'boolean'
                ? target.isConnected
                : document.documentElement.contains(target);
            if (!isAttached) continue;
 
            try {
                target.innerHTML = marked.parse(markdownText || '');
            } catch (err) {
                console.warn('Markdown render failed:', err);
                target.textContent = markdownText || '';
            } finally {
                target.classList.add('markdown-body');
                target.removeAttribute('data-needs-markdown');
            }
        }
 
        if (markdownRenderQueue.length > 0) {
            markdownRenderHandle = scheduleIdle(processMarkdownRenderQueue);
        }
    }
 
     // RAF 节流状态
    let rafUpdatePending = false;
    let pendingUpdate = null;
    
    function updateLastMessage(textOrObj) {
        if (state.messages.length === 0) return;
        
        // Determine content
        let text = textOrObj;
        let reasoning = null;
        let attachments;
        let streaming = false;
        
        if (typeof textOrObj === 'object' && textOrObj !== null) {
            text = textOrObj.content || '';
            reasoning = textOrObj.reasoning || null;
            // 仅当调用方显式传入 attachments 字段时才更新，避免把已有附件意外清空
            if (Object.prototype.hasOwnProperty.call(textOrObj, 'attachments')) {
                attachments = textOrObj.attachments;
            }
            streaming = !!textOrObj.streaming;
        }
        
        // Update state immediately
        const lastMsg = state.messages[state.messages.length - 1];
        lastMsg.text = text;
        if (reasoning !== null) {
            lastMsg.reasoning = reasoning;
        }
        if (typeof attachments !== 'undefined') {
            lastMsg.attachments = attachments;
        }
        
        // 缓存待更新的内容（附带 attachments 信息，供 UI 层按需使用）
        pendingUpdate = { text, reasoning, streaming };
        
        // 使用 RAF 节流 UI 更新
        if (!rafUpdatePending) {
            rafUpdatePending = true;
            requestAnimationFrame(() => {
                performUIUpdate(pendingUpdate);
                rafUpdatePending = false;
                pendingUpdate = null;
            });
        }
    }
    
    function performUIUpdate(update) {
        if (!update) return;
        
        const { text, reasoning, streaming } = update;
        const lastMsg = state.messages[state.messages.length - 1];
        
        // Update UI
        const lastCard = getLastMessageCard();
        if (!lastCard) return;
        
        const container = lastCard.querySelector('.ido-message__container');
        if (!container) return;
        
        // 处理思维链
        let reasoningBlock = container.querySelector('.reasoning-block');
        let contentSpan = container.querySelector('.message-content');
        
        if (!contentSpan) {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'ido-message__content';
            contentSpan = document.createElement('div');
            contentSpan.className = 'message-content markdown-body';
            contentDiv.appendChild(contentSpan);
            container.appendChild(contentDiv);
        }
        
        if (reasoning) {
            if (!reasoningBlock) {
                reasoningBlock = document.createElement('div');
                reasoningBlock.className = 'reasoning-block';
                
                const toggle = document.createElement('div');
                toggle.className = 'reasoning-toggle';
                toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">0.0s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';
                
                const timerSpan = toggle.querySelector('.reasoning-timer');
                const startTime = Date.now();
                const timerId = setInterval(() => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    timerSpan.textContent = elapsed.toFixed(1) + 's';
                }, 100);
                
                reasoningBlock.dataset.timerId = timerId;
                reasoningBlock.dataset.startTime = startTime;
                
                toggle.onclick = (e) => {
                    const content = e.currentTarget.nextElementSibling;
                    const icon = e.currentTarget.querySelector('.material-symbols-outlined:last-child');
                    content.classList.toggle('open');
                    if (content.classList.contains('open')) {
                        icon.style.transform = 'rotate(180deg)';
                    } else {
                        icon.style.transform = 'rotate(0deg)';
                    }
                };
                
                const content = document.createElement('div');
                content.className = 'reasoning-content markdown-body';
                
                reasoningBlock.appendChild(toggle);
                reasoningBlock.appendChild(content);
                
                const contentDiv = contentSpan.parentElement;
                container.insertBefore(reasoningBlock, contentDiv);
            }
            
            const reasoningContentDiv = reasoningBlock.querySelector('.reasoning-content');
            if (reasoningContentDiv) {
                // 同步渲染思维链Markdown，避免闪烁
                renderMarkdownSync(reasoningContentDiv, reasoning);
                reasoningContentDiv.removeAttribute('data-needs-markdown');
            }
        }
        
        // 停止思维链计时器
        if (text && reasoningBlock && reasoningBlock.dataset.timerId) {
            const timerId = parseInt(reasoningBlock.dataset.timerId);
            clearInterval(timerId);
            
            const toggle = reasoningBlock.querySelector('.reasoning-toggle');
            const timerSpan = toggle?.querySelector('.reasoning-timer');
            let finalDuration = 0;
            
            if (timerSpan && reasoningBlock.dataset.startTime) {
                finalDuration = (Date.now() - parseInt(reasoningBlock.dataset.startTime)) / 1000;
                timerSpan.textContent = finalDuration.toFixed(1) + 's';
            }
            
            if (finalDuration > 0) {
                if (events && typeof events.emitAsync === 'function') {
                    events.emitAsync('reasoning:completed', {
                        messageId: lastMsg.id,
                        duration: finalDuration
                    });
                } else if (events && typeof events.emit === 'function') {
                    events.emit('reasoning:completed', {
                        messageId: lastMsg.id,
                        duration: finalDuration
                    });
                }
            }
            
            delete reasoningBlock.dataset.timerId;
            
            const reasoningContentDiv = reasoningBlock.querySelector('.reasoning-content');
            if (reasoningContentDiv && lastMsg.reasoning) {
                enqueueMarkdownRender(reasoningContentDiv, lastMsg.reasoning);
            }
        }
        
        // 更新正文内容
        if (contentSpan && lastMsg.role !== 'user' && text) {
            renderMarkdownSync(contentSpan, text);
            contentSpan.removeAttribute('data-needs-markdown');
        } else if (contentSpan) {
            contentSpan.textContent = text;
        }
        
        // 处理附件（放在内容之后）
        const currentAttachments = lastMsg.attachments;
        if (currentAttachments && currentAttachments.length > 0) {
            const existingWrapper = container.querySelector('.ido-message__attachment-wrapper');
            if (!existingWrapper) {
                const imageAttachments = currentAttachments.filter(a => a && a.type && a.type.startsWith('image/'));
                
                if (imageAttachments.length > 0) {
                    const attachmentsContainer = document.createElement('div');
                    // 根据图片数量选择布局类
                    if (imageAttachments.length === 1) {
                        attachmentsContainer.className = 'ido-message__attachments ido-message__attachments--single';
                    } else {
                        attachmentsContainer.className = 'ido-message__attachments ido-message__attachments--grid';
                    }
                    
                    imageAttachments.forEach((attachment, index) => {
                        const imgWrapper = document.createElement('div');
                        imgWrapper.className = 'ido-message__attachment-wrapper';
                        imgWrapper.dataset.imageIndex = index;
                        imgWrapper.dataset.imageTotal = imageAttachments.length;
                        
                        const img = document.createElement('img');
                        img.src = attachment.dataUrl;
                        img.alt = attachment.name || 'Attached image';
                        img.loading = 'lazy';
                        
                        // 放大覆盖层
                        const overlay = document.createElement('div');
                        overlay.className = 'ido-message__attachment-overlay';
                        overlay.innerHTML = '<span class="material-symbols-outlined">zoom_in</span>';
                        
                        imgWrapper.appendChild(img);
                        imgWrapper.appendChild(overlay);
                        
                        // 点击打开 lightbox
                        imgWrapper.onclick = () => {
                            openLightbox(imageAttachments, index);
                        };
                        
                        attachmentsContainer.appendChild(imgWrapper);
                    });
                    
                    // 附件添加到容器末尾（在内容之后）
                    container.appendChild(attachmentsContainer);
                }
            }
        }
        
        // 优化滚动
        const stream = ui.chatStream;
        const isNearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
        if (isNearBottom) {
            stream.scrollTop = stream.scrollHeight;
        }
    }
    
    /**
     * 完成流式消息更新，解析 Markdown
     */
    function finalizeStreamingMessage() {
        // 强制刷新任何待处理的 RAF 更新，确保 DOM 内容是最新的
        // 这也会触发 performUIUpdate 中的思维链计时器停止逻辑
        if (pendingUpdate) {
            performUIUpdate(pendingUpdate);
            rafUpdatePending = false;
            pendingUpdate = null;
        }
        
        if (state.messages.length === 0) return;
        
        const lastCard = getLastMessageCard();
        if (!lastCard) return;
        
        const container = lastCard.querySelector('.ido-message__container');
        if (!container) return;
        
        const lastMsg = state.messages[state.messages.length - 1];
        const lastMsgId = lastMsg?.id;
        
        // 停止思维链计时器
        const reasoningBlock = container.querySelector('.reasoning-block');
        if (reasoningBlock && reasoningBlock.dataset.timerId) {
            const timerId = parseInt(reasoningBlock.dataset.timerId, 10);
            if (!Number.isNaN(timerId)) {
                clearInterval(timerId);
            }
            
            let finalDuration = 0;
            if (reasoningBlock.dataset.startTime) {
                const startTime = parseInt(reasoningBlock.dataset.startTime, 10);
                if (!Number.isNaN(startTime)) {
                    finalDuration = (Date.now() - startTime) / 1000;
                }
            }
            
            const toggle = reasoningBlock.querySelector('.reasoning-toggle');
            const timerSpan = toggle && toggle.querySelector('.reasoning-timer');
            if (timerSpan && finalDuration > 0) {
                timerSpan.textContent = finalDuration.toFixed(1) + 's';
            }
            
            delete reasoningBlock.dataset.timerId;
            delete reasoningBlock.dataset.startTime;
            
            if (finalDuration > 0 && lastMsgId) {
                if (events && typeof events.emitAsync === 'function') {
                    events.emitAsync('reasoning:completed', {
                        messageId: lastMsgId,
                        duration: finalDuration
                    });
                } else if (events && typeof events.emit === 'function') {
                    events.emit('reasoning:completed', {
                        messageId: lastMsgId,
                        duration: finalDuration
                    });
                }
            }
        }
        
        // 解析思维链的 Markdown（从 DOM 获取文本，避免因 setTimeout 延迟导致 state 未更新）
        const reasoningContent = container.querySelector('.reasoning-content[data-needs-markdown="true"]');
        if (reasoningContent) {
            const reasoningText = reasoningContent.textContent || '';
            if (reasoningText) {
                renderMarkdownSync(reasoningContent, reasoningText);
            }
            reasoningContent.removeAttribute('data-needs-markdown');
        }
 
        // 解析正文的 Markdown（从 DOM 获取文本，避免因 setTimeout 延迟导致 state 未更新）
        const contentSpan = container.querySelector('.message-content[data-needs-markdown="true"]');
        if (contentSpan) {
            const contentText = contentSpan.textContent || '';
            if (contentText) {
                renderMarkdownSync(contentSpan, contentText);
            }
            contentSpan.removeAttribute('data-needs-markdown');
        }
        
        // 移除加载指示器
        if (lastMsgId) {
            removeMessageStreamingIndicator(lastMsgId);
        }
        const strayIndicators = container.querySelectorAll('.message-streaming-indicator');
        strayIndicators.forEach(indicator => indicator.remove());
        const floatingIndicators = ui.chatStream.querySelectorAll('[data-loading-id]');
        floatingIndicators.forEach(indicator => indicator.remove());
    }
    
    /**
     * 批量渲染所有标记为需要 Markdown 解析的元素
     * 用于历史消息加载后的一次性渲染
     */
    function renderAllPendingMarkdown() {
        if (!ui.chatStream) return;
        
        // 收集所有需要渲染的元素
        const pendingElements = ui.chatStream.querySelectorAll('[data-needs-markdown="true"]');
        
        if (pendingElements.length === 0) return;
        
        // 批量加入渲染队列
        pendingElements.forEach(element => {
            const text = element.textContent || '';
            enqueueMarkdownRender(element, text);
        });
    }

    function init() {
        bindUI();
        initResizers();
        // 初始化移动端滑动手势
        initMobileSwipe();
        // Force update initially
        updatePanelWidths();
        
        // Initialize chat header
        initChatHeader();
        
        // 恢复URL参数中的状态
        restoreStateFromURL();

        // Close buttons are now created dynamically by plugins
        ui.backdrop.onclick = () => { togglePanel('left', false); togglePanel('right', false); };
        
        // Bottom sheet backdrop click to close
        if (ui.bottomSheetBackdrop) {
            ui.bottomSheetBackdrop.onclick = hideBottomSheet;
        }

        // Send button - 实际发送逻辑由 IdoFront 插件处理
        // 这里只保留基本的 UI 交互
        const btnSend = document.getElementById('btn-send');
        if (btnSend) {
            btnSend.onclick = () => {
                // 检查是否正在加载（通过按钮状态判断）
                if (btnSend.classList.contains('btn-send--loading')) {
                    // 正在加载时，点击取消请求
                    if (events && typeof events.emitAsync === 'function') {
                        events.emitAsync('cancel-request');
                    } else if (events && typeof events.emit === 'function') {
                        events.emit('cancel-request');
                    }
                } else {
                    // 正常发送
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
        
        // Auto-resize text
        ui.userInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }
    
    /**
     * 从URL参数恢复状态
     */
    function restoreStateFromURL() {
        const params = new URLSearchParams(window.location.search);
        
        // 恢复模式
        const mode = params.get('mode');
        if (mode) {
            // 触发事件让各模块恢复自己的状态
            if (events && typeof events.emitAsync === 'function') {
                events.emitAsync('restore-state-from-url', params);
            } else if (events && typeof events.emit === 'function') {
                events.emit('restore-state-from-url', params);
            }
        }
    }

    function destroy() {
        unbindResponsiveListener();
    }
    
    /**
     * 设置发送按钮状态
     * @param {boolean} isLoading - 是否处于加载状态
     */
    function setSendButtonLoading(isLoading) {
        const btnSend = document.getElementById('btn-send');
        if (!btnSend) return;
        
        if (isLoading) {
            btnSend.classList.add('btn-send--loading');
            btnSend.title = '点击停止生成';
            // 替换图标为停止图标
            const icon = btnSend.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.textContent = 'stop_circle';
            }
        } else {
            btnSend.classList.remove('btn-send--loading');
            btnSend.title = '发送';
            // 恢复为发送图标
            const icon = btnSend.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.textContent = 'arrow_upward';
            }
        }
    }
    
    // Public API object shared with plugins
    const uiHelpers = {
        createIconButton,
        createCustomHeader
    };
    
    publicApi = {
        init,
        registerPlugin,
        unregisterPlugin,
        setPluginEnabled,
        getPlugins,
        setMode,
        setCustomPanel,
        setDefaultRightPanel,
        restoreDefaultRightPanel,
        togglePanel,
        showBottomSheet,
        hideBottomSheet,
        SLOTS,
        addMessage,
        updateLastMessage,
        finalizeStreamingMessage,
        renderAllPendingMarkdown,
        clearMessages,
        addLoadingIndicator,
        removeLoadingIndicator,
        attachLoadingIndicatorToMessage,
        removeMessageStreamingIndicator,
        setSendButtonLoading,
        // RenderMessageEdit will be injected by messageActions
        renderMessageEdit: null,
        getCurrentMode: () => currentMode,
        events,
        storage,
        ui: uiHelpers
    };
    
    return {
        init,
        registerPlugin,
        unregisterPlugin,
        setPluginEnabled,
        getPlugins,
        setMode,
        setCustomPanel,
        setDefaultRightPanel,
        restoreDefaultRightPanel,
        togglePanel,
        showBottomSheet,
        hideBottomSheet,
        SLOTS,
        addMessage,
        updateLastMessage,
        finalizeStreamingMessage,
        renderAllPendingMarkdown,
        clearMessages,
        addLoadingIndicator,
        removeLoadingIndicator,
        attachLoadingIndicatorToMessage,
        removeMessageStreamingIndicator,
        setSendButtonLoading,
        // Allow messageActions to inject this
        set renderMessageEdit(fn) {
            publicApi.renderMessageEdit = fn;
        },
        get renderMessageEdit() {
            return publicApi.renderMessageEdit;
        },
        getCurrentMode: () => currentMode,
        events,
        storage,
        ui: uiHelpers,
        destroy
    };
    
})();