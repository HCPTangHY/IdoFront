/**
 * IdoFront UI Kit
 * Factory functions for reusable UI building blocks.
 */
(function () {
    // Global namespace
    window.IdoUI = window.IdoUI || {};

    /**
     * Create a button with optional Material icon and text label.
     * Used across Framework and plugins to keep button DOM structure consistent.
     */
    function createIconButton({
        label,
        icon,
        title,
        className = '',
        id = '',
        variant = 'ghost', // 'primary', 'secondary', 'ghost', 'danger'
        size = 'md', // 'sm', 'md', 'lg'
        iconClassName = 'material-symbols-outlined text-[18px]',
        onClick
    } = {}) {
        const btn = document.createElement('button');
        if (id) btn.id = id;
        if (label) {
            // 有标签的按钮使用 ido-btn
            btn.className = `ido-btn ido-btn--${variant} ido-btn--${size}`;
        } else {
            // 纯图标按钮使用 ido-icon-btn
            btn.className = 'ido-icon-btn';
        }
        
        // 添加自定义类名（用于特殊情况）
        if (className) {
            btn.className += ' ' + className;
        }

        if (title) btn.title = title;

        if (icon) {
            if (icon.startsWith('<svg')) {
                // SVG Icon
                const iconDiv = document.createElement('div');
                iconDiv.className = "flex items-center justify-center";
                iconDiv.innerHTML = icon;
                btn.appendChild(iconDiv);
            } else {
                // Material Icon
                const iconSpan = document.createElement('span');
                iconSpan.className = iconClassName;
                iconSpan.textContent = icon;
                btn.appendChild(iconSpan);
            }
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
     * Create a file preview item
     * @param {Object} options - Preview options
     * @returns {HTMLElement} - Preview element
     */
    function createFilePreview({
        file,
        dataUrl,
        onRemove
    } = {}) {
        const container = document.createElement('div');
        container.className = 'relative inline-block group';
        
        const preview = document.createElement('div');
        preview.className = 'w-20 h-20 rounded-lg overflow-hidden border border-gray-200 bg-gray-50';
        
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = dataUrl;
            img.className = 'w-full h-full object-cover';
            img.alt = file.name;
            preview.appendChild(img);
        } else {
            // 非图片文件显示文件图标
            const iconContainer = document.createElement('div');
            iconContainer.className = 'w-full h-full flex flex-col items-center justify-center text-gray-400';
            
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined text-2xl';
            icon.textContent = 'description';
            
            const name = document.createElement('div');
            name.className = 'text-xs mt-1 px-1 text-center truncate w-full';
            name.textContent = file.name;
            
            iconContainer.appendChild(icon);
            iconContainer.appendChild(name);
            preview.appendChild(iconContainer);
        }
        
        container.appendChild(preview);
        
        // 移除按钮
        if (typeof onRemove === 'function') {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600';
            removeBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">close</span>';
            removeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
            };
            container.appendChild(removeBtn);
        }
        
        return container;
    }

    // Export factory functions
    window.IdoUI.createIconButton = createIconButton;
    window.IdoUI.createFilePreview = createFilePreview;
})();