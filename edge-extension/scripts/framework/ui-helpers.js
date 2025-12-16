/**
 * UI 组件工厂模块
 * 提供可复用的 UI 组件创建函数
 */
const FrameworkUIHelpers = (function() {
    'use strict';

    // 依赖引用
    let layout = null;
    let events = null;

    /**
     * 初始化依赖
     */
    function init(deps) {
        layout = deps.layout;
        events = deps.events;
    }

    /**
     * 创建图标按钮
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

    /**
     * 创建自定义模式的统一 header
     */
    function createCustomHeader(options = {}) {
        const { center, right, showOpenInNew = true } = options;

        const header = document.createElement('header');
        header.className = 'ido-header';

        // 左侧：收起左边栏按钮
        const leftGroup = document.createElement('div');
        leftGroup.className = 'ido-header__left';

        const toggleLeftBtn = document.createElement('button');
        toggleLeftBtn.className = 'ido-icon-btn';
        toggleLeftBtn.title = '切换左侧边栏';
        toggleLeftBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">side_navigation</span>';
        toggleLeftBtn.onclick = () => layout && layout.togglePanel('left');

        leftGroup.appendChild(toggleLeftBtn);
        header.appendChild(leftGroup);

        // 中间内容区域
        if (center) {
            const centerContainer = document.createElement('div');
            centerContainer.className = 'ido-header__center';

            if (typeof center === 'function') {
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

        // 右侧
        const rightGroup = document.createElement('div');
        rightGroup.className = 'ido-header__right';

        // 自定义右侧内容
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

        // 全屏打开按钮（仅在浏览器扩展环境）
        const isExtensionEnv = typeof chrome !== 'undefined' &&
                               chrome.runtime &&
                               typeof chrome.runtime.id === 'string';

        if (showOpenInNew && isExtensionEnv) {
            const openInNewBtn = document.createElement('button');
            openInNewBtn.className = 'ido-icon-btn';
            openInNewBtn.title = '全屏打开';
            openInNewBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">open_in_new</span>';
            openInNewBtn.onclick = () => {
                let url = 'sidepanel.html';
                const params = new URLSearchParams();

                // 触发保存状态事件
                if (events) {
                    if (typeof events.emitAsync === 'function') {
                        events.emitAsync('save-state-for-new-tab', params);
                    } else if (typeof events.emit === 'function') {
                        events.emit('save-state-for-new-tab', params);
                    }
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
        toggleRightBtn.style.transform = 'scaleX(-1)';
        toggleRightBtn.onclick = () => layout && layout.togglePanel('right');

        rightGroup.appendChild(toggleRightBtn);
        header.appendChild(rightGroup);

        return header;
    }

    /**
     * 设置发送按钮状态
     */
    function setSendButtonLoading(isLoading) {
        const btnSend = document.getElementById('btn-send');
        if (!btnSend) return;

        if (isLoading) {
            btnSend.classList.add('btn-send--loading');
            btnSend.title = '点击停止生成';
            const icon = btnSend.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.textContent = 'stop_circle';
            }
        } else {
            btnSend.classList.remove('btn-send--loading');
            btnSend.title = '发送';
            const icon = btnSend.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.textContent = 'arrow_upward';
            }
        }
    }

    /**
     * 创建简单的模态对话框
     */
    function createModal(options = {}) {
        const {
            title = '',
            content = '',
            confirmText = '确定',
            cancelText = '取消',
            onConfirm = null,
            onCancel = null,
            showCancel = true
        } = options;

        const overlay = document.createElement('div');
        overlay.className = 'ido-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'ido-modal';

        // 标题
        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'ido-modal__title';
            titleEl.textContent = title;
            modal.appendChild(titleEl);
        }

        // 内容
        const contentEl = document.createElement('div');
        contentEl.className = 'ido-modal__content';
        if (typeof content === 'string') {
            contentEl.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            contentEl.appendChild(content);
        }
        modal.appendChild(contentEl);

        // 按钮区域
        const buttonsEl = document.createElement('div');
        buttonsEl.className = 'ido-modal__buttons';

        if (showCancel) {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'ido-modal__btn ido-modal__btn--cancel';
            cancelBtn.textContent = cancelText;
            cancelBtn.onclick = () => {
                overlay.remove();
                if (typeof onCancel === 'function') onCancel();
            };
            buttonsEl.appendChild(cancelBtn);
        }

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'ido-modal__btn ido-modal__btn--confirm';
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = () => {
            overlay.remove();
            if (typeof onConfirm === 'function') onConfirm();
        };
        buttonsEl.appendChild(confirmBtn);

        modal.appendChild(buttonsEl);
        overlay.appendChild(modal);

        // 点击遮罩关闭
        overlay.onclick = (e) => {
            if (e.target === overlay && showCancel) {
                overlay.remove();
                if (typeof onCancel === 'function') onCancel();
            }
        };

        document.body.appendChild(overlay);

        // 返回关闭函数
        return () => overlay.remove();
    }

    /**
     * 创建 Toast 提示
     */
    function showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = 'ido-toast';
        toast.textContent = message;

        document.body.appendChild(toast);

        // 触发进入动画
        requestAnimationFrame(() => {
            toast.classList.add('ido-toast--visible');
        });

        // 自动消失
        setTimeout(() => {
            toast.classList.remove('ido-toast--visible');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * 创建下拉菜单
     */
    function createDropdown(options = {}) {
        const {
            trigger,
            items = [],
            position = 'bottom-right'
        } = options;

        const dropdown = document.createElement('div');
        dropdown.className = `ido-dropdown ido-dropdown--${position}`;

        items.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'ido-dropdown__separator';
                dropdown.appendChild(sep);
                return;
            }

            const menuItem = document.createElement('button');
            menuItem.className = 'ido-dropdown__item';
            if (item.icon) {
                menuItem.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span>`;
            }
            const label = document.createElement('span');
            label.textContent = item.label || '';
            menuItem.appendChild(label);

            if (item.disabled) {
                menuItem.disabled = true;
            }

            menuItem.onclick = () => {
                hideDropdown();
                if (typeof item.onClick === 'function') {
                    item.onClick();
                }
            };

            dropdown.appendChild(menuItem);
        });

        let isOpen = false;

        function showDropdown() {
            if (isOpen) return;
            isOpen = true;

            // 定位到触发元素附近
            const rect = trigger.getBoundingClientRect();
            dropdown.style.position = 'fixed';

            if (position.includes('bottom')) {
                dropdown.style.top = `${rect.bottom + 4}px`;
            } else {
                dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            }

            if (position.includes('right')) {
                dropdown.style.right = `${window.innerWidth - rect.right}px`;
            } else {
                dropdown.style.left = `${rect.left}px`;
            }

            document.body.appendChild(dropdown);

            // 点击外部关闭
            setTimeout(() => {
                document.addEventListener('click', handleOutsideClick);
            }, 0);
        }

        function hideDropdown() {
            if (!isOpen) return;
            isOpen = false;
            dropdown.remove();
            document.removeEventListener('click', handleOutsideClick);
        }

        function handleOutsideClick(e) {
            if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
                hideDropdown();
            }
        }

        // 绑定触发器
        if (trigger) {
            trigger.onclick = (e) => {
                e.stopPropagation();
                if (isOpen) {
                    hideDropdown();
                } else {
                    showDropdown();
                }
            };
        }

        return {
            show: showDropdown,
            hide: hideDropdown,
            element: dropdown
        };
    }

    return {
        init,
        createIconButton,
        createCustomHeader,
        setSendButtonLoading,
        createModal,
        showToast,
        createDropdown
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkUIHelpers = FrameworkUIHelpers;
}