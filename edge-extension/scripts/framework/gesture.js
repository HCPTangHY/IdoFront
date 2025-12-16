/**
 * 移动端手势模块
 * 处理触摸滑动手势来控制面板开关
 */
const FrameworkGesture = (function() {
    'use strict';

    // 依赖 FrameworkLayout
    let layout = null;

    // 手势状态
    const swipeState = {
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        isSwiping: false,
        isDragging: false,
        swipeTarget: null,
        startTime: 0,
        directionLocked: false
    };

    // 手势配置
    const SWIPE_CONFIG = {
        MIN_SWIPE_DISTANCE: 50,
        MAX_SWIPE_TIME: 300,
        VELOCITY_THRESHOLD: 0.3,
        DRAG_THRESHOLD: 15,
        DIRECTION_LOCK_RATIO: 1.5,
        MOBILE_BREAKPOINT: 768
    };

    /**
     * 获取面板最大宽度
     */
    function getPanelMaxWidth() {
        return window.innerWidth * 0.85;
    }

    /**
     * 初始化移动端滑动手势
     */
    function init(layoutModule) {
        layout = layoutModule;
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd, { passive: true });
        document.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    }

    /**
     * 销毁手势监听
     */
    function destroy() {
        document.removeEventListener('touchstart', handleTouchStart);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('touchcancel', handleTouchEnd);
    }

    /**
     * 处理触摸开始
     */
    function handleTouchStart(e) {
        if (window.innerWidth >= SWIPE_CONFIG.MOBILE_BREAKPOINT) return;

        const touch = e.touches[0];
        swipeState.startX = touch.clientX;
        swipeState.startY = touch.clientY;
        swipeState.currentX = touch.clientX;
        swipeState.currentY = touch.clientY;
        swipeState.startTime = Date.now();
        swipeState.isSwiping = false;
        swipeState.isDragging = false;
        swipeState.swipeTarget = null;
        swipeState.directionLocked = false;
    }

    /**
     * 根据滑动方向确定目标操作
     */
    function determineSwipeTarget(deltaX) {
        const state = layout.getState();
        
        if (state.leftOpen) {
            if (deltaX < 0) return 'close-left';
        } else if (state.rightOpen) {
            if (deltaX > 0) return 'close-right';
        } else {
            if (deltaX > 0) return 'open-left';
            if (deltaX < 0) return 'open-right';
        }
        return null;
    }

    /**
     * 处理触摸移动
     */
    function handleTouchMove(e) {
        if (window.innerWidth >= SWIPE_CONFIG.MOBILE_BREAKPOINT) return;

        const touch = e.touches[0];
        swipeState.currentX = touch.clientX;
        swipeState.currentY = touch.clientY;

        const deltaX = swipeState.currentX - swipeState.startX;
        const deltaY = swipeState.currentY - swipeState.startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        // 方向锁定
        if (swipeState.directionLocked) {
            if (!swipeState.swipeTarget) return;
        } else if (absDeltaX > SWIPE_CONFIG.DRAG_THRESHOLD || absDeltaY > SWIPE_CONFIG.DRAG_THRESHOLD) {
            swipeState.directionLocked = true;

            if (absDeltaY > absDeltaX * SWIPE_CONFIG.DIRECTION_LOCK_RATIO) {
                swipeState.swipeTarget = null;
                return;
            }

            swipeState.swipeTarget = determineSwipeTarget(deltaX);
            if (!swipeState.swipeTarget) return;
        } else {
            return;
        }

        if (!swipeState.swipeTarget) return;

        swipeState.isSwiping = true;

        const ui = layout.getUI();

        // 首次进入拖动状态
        if (!swipeState.isDragging) {
            swipeState.isDragging = true;
            ui.leftPanel.classList.remove('transition-width');
            ui.rightPanel.classList.remove('transition-width');
            ui.leftPanel.classList.add('ido-panel--dragging');
            ui.rightPanel.classList.add('ido-panel--dragging');
        }

        e.preventDefault();
        updatePanelDragPosition(deltaX);
    }

    /**
     * 更新面板拖动位置
     */
    function updatePanelDragPosition(deltaX) {
        const maxWidth = getPanelMaxWidth();
        const ui = layout.getUI();

        switch (swipeState.swipeTarget) {
            case 'open-left': {
                const progress = Math.max(0, Math.min(1, deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.leftPanel.style.width = `${width}px`;
                ui.backdrop.classList.remove('hidden');
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
            case 'close-left': {
                const progress = Math.max(0, Math.min(1, 1 + deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.leftPanel.style.width = `${width}px`;
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
            case 'open-right': {
                const progress = Math.max(0, Math.min(1, -deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.rightPanel.style.width = `${width}px`;
                ui.backdrop.classList.remove('hidden');
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
            case 'close-right': {
                const progress = Math.max(0, Math.min(1, 1 - deltaX / maxWidth));
                const width = progress * maxWidth;
                ui.rightPanel.style.width = `${width}px`;
                ui.backdrop.style.opacity = progress * 0.5;
                break;
            }
        }
    }

    /**
     * 处理触摸结束
     */
    function handleTouchEnd(e) {
        if (!swipeState.swipeTarget) {
            resetSwipeState();
            return;
        }
        if (window.innerWidth >= SWIPE_CONFIG.MOBILE_BREAKPOINT) {
            resetSwipeState();
            return;
        }

        const deltaX = swipeState.currentX - swipeState.startX;
        const deltaTime = Date.now() - swipeState.startTime;
        const velocity = Math.abs(deltaX) / deltaTime;
        const maxWidth = getPanelMaxWidth();

        const ui = layout.getUI();

        // 恢复过渡动画
        ui.leftPanel.classList.remove('ido-panel--dragging');
        ui.rightPanel.classList.remove('ido-panel--dragging');
        ui.leftPanel.classList.add('transition-width');
        ui.rightPanel.classList.add('transition-width');

        ui.backdrop.style.opacity = '';

        if (swipeState.isDragging) {
            let progress = 0;
            let shouldOpen = false;

            switch (swipeState.swipeTarget) {
                case 'open-left':
                    progress = Math.max(0, Math.min(1, deltaX / maxWidth));
                    shouldOpen = progress > 0.5 || (velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX > 0);
                    layout.togglePanel('left', shouldOpen);
                    break;
                case 'close-left':
                    progress = Math.max(0, Math.min(1, 1 + deltaX / maxWidth));
                    shouldOpen = progress > 0.5 && !(velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX < 0);
                    layout.togglePanel('left', shouldOpen);
                    break;
                case 'open-right':
                    progress = Math.max(0, Math.min(1, -deltaX / maxWidth));
                    shouldOpen = progress > 0.5 || (velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX < 0);
                    layout.togglePanel('right', shouldOpen);
                    break;
                case 'close-right':
                    progress = Math.max(0, Math.min(1, 1 - deltaX / maxWidth));
                    shouldOpen = progress > 0.5 && !(velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaX > 0);
                    layout.togglePanel('right', shouldOpen);
                    break;
            }
        } else if (swipeState.isSwiping) {
            const isValidSwipe = Math.abs(deltaX) >= SWIPE_CONFIG.MIN_SWIPE_DISTANCE ||
                                (velocity >= SWIPE_CONFIG.VELOCITY_THRESHOLD && deltaTime <= SWIPE_CONFIG.MAX_SWIPE_TIME);

            if (isValidSwipe) {
                switch (swipeState.swipeTarget) {
                    case 'open-left':
                        if (deltaX > 0) layout.togglePanel('left', true);
                        break;
                    case 'open-right':
                        if (deltaX < 0) layout.togglePanel('right', true);
                        break;
                    case 'close-left':
                        if (deltaX < 0) layout.togglePanel('left', false);
                        break;
                    case 'close-right':
                        if (deltaX > 0) layout.togglePanel('right', false);
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
        swipeState.directionLocked = false;
    }

    return {
        init,
        destroy,
        SWIPE_CONFIG
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkGesture = FrameworkGesture;
}