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

    // ========== Lightweight DOM Builder ==========
    
    /**
     * Hyperscript-like DOM builder
     * @param {string} tag - Tag name (e.g., 'div', 'span.class1.class2', 'button#id.class')
     * @param {Object|string|Array|Node} propsOrChildren - Props object or children
     * @param {Array|string|Node} children - Children elements
     * @returns {HTMLElement}
     * 
     * @example
     * // Simple element
     * h('div', 'Hello')  // <div>Hello</div>
     * 
     * // With classes in tag
     * h('div.p-2.rounded', 'Text')  // <div class="p-2 rounded">Text</div>
     * 
     * // With props
     * h('button', { onclick: () => alert('Hi') }, 'Click')
     * 
     * // Nested
     * h('div.flex', [
     *     h('span.icon', 'home'),
     *     h('span', 'Label')
     * ])
     */
    function h(tag, propsOrChildren, children) {
        // Parse tag: 'div.class1.class2#id' -> { tag: 'div', classes: ['class1', 'class2'], id: 'id' }
        // Handle escaped dots (\.) by temporarily replacing them
        const ESCAPED_DOT = '\x00DOT\x00';
        const escapedTag = tag.replace(/\\\./g, ESCAPED_DOT);
        const parts = escapedTag.split(/(?=[.#])/);
        const tagName = parts[0].replace(new RegExp(ESCAPED_DOT, 'g'), '.') || 'div';
        const classes = [];
        let id = '';
        
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i].replace(new RegExp(ESCAPED_DOT, 'g'), '.');
            if (part.startsWith('.')) {
                classes.push(part.slice(1));
            } else if (part.startsWith('#')) {
                id = part.slice(1);
            }
        }
        
        const el = document.createElement(tagName);
        if (classes.length) el.className = classes.join(' ');
        if (id) el.id = id;
        
        // Handle arguments
        let props = null;
        let childNodes = null;
        
        if (propsOrChildren !== undefined) {
            if (propsOrChildren === null) {
                // h('div', null, children)
                childNodes = children;
            } else if (typeof propsOrChildren === 'string' || typeof propsOrChildren === 'number') {
                // h('div', 'text')
                childNodes = propsOrChildren;
            } else if (Array.isArray(propsOrChildren)) {
                // h('div', [children])
                childNodes = propsOrChildren;
            } else if (propsOrChildren instanceof Node) {
                // h('div', childElement)
                childNodes = propsOrChildren;
            } else if (typeof propsOrChildren === 'object') {
                // h('div', { props }, children)
                props = propsOrChildren;
                childNodes = children;
            }
        }
        
        // Apply props
        if (props) {
            for (const [key, value] of Object.entries(props)) {
                if (value === undefined || value === null) continue;
                
                if (key === 'class' || key === 'className') {
                    // Append to existing classes
                    el.className = el.className ? `${el.className} ${value}` : value;
                } else if (key === 'style' && typeof value === 'object') {
                    Object.assign(el.style, value);
                } else if (key.startsWith('on') && typeof value === 'function') {
                    // Event handler: onclick, onchange, etc.
                    el[key] = value;
                } else if (key === 'html') {
                    el.innerHTML = value;
                } else if (key === 'text') {
                    el.textContent = value;
                } else {
                    // Attribute
                    el.setAttribute(key, value);
                }
            }
        }
        
        // Append children
        if (childNodes !== undefined && childNodes !== null) {
            if (Array.isArray(childNodes)) {
                childNodes.forEach(child => {
                    if (child === null || child === undefined) return;
                    if (child instanceof Node) {
                        el.appendChild(child);
                    } else {
                        el.appendChild(document.createTextNode(String(child)));
                    }
                });
            } else if (childNodes instanceof Node) {
                el.appendChild(childNodes);
            } else {
                el.textContent = String(childNodes);
            }
        }
        
        return el;
    }
    
    /**
     * Create a Material Symbol icon
     * @param {string} name - Icon name
     * @param {string} className - Additional classes
     * @returns {HTMLElement}
     */
    function icon(name, className = '') {
        return h('span.material-symbols-outlined', { class: className }, name);
    }
    
    /**
     * Create a selectable option item (for settings panels)
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function selectableItem({
        active = false,
        icon: iconName,
        label,
        description,
        onClick,
        layout = 'vertical', // 'vertical' | 'horizontal'
        size = 'md' // 'sm' | 'md'
    }) {
        const isVertical = layout === 'vertical';
        const isSm = size === 'sm';
        
        const baseClass = `cursor-pointer transition-all border-2 rounded-${isSm ? 'lg' : 'xl'}`;
        const activeClass = active ? 'border-purple-500 bg-purple-50' : 'border-gray-100 hover:border-gray-200 bg-white';
        const layoutClass = isVertical 
            ? `p-${isSm ? '2' : '3'} text-center`
            : `p-3 flex items-center gap-3`;
        
        const children = [];
        
        if (iconName) {
            children.push(icon(iconName, `text-[${isSm ? '20' : '24'}px] ${active ? 'text-purple-600' : 'text-gray-400'}`));
        }
        
        if (isVertical) {
            if (label) {
                children.push(h('div', {
                    class: `text-xs font-medium mt-1 ${active ? 'text-purple-700' : 'text-gray-600'}`
                }, label));
            }
        } else {
            const info = h('div.flex-1', [
                label && h('div', { class: `font-medium ${active ? 'text-purple-700' : 'text-gray-700'}` }, label),
                description && h('div.text-\[10px\].text-gray-500', description)
            ].filter(Boolean));
            children.push(info);
            
            if (active) {
                children.push(icon('check_circle', 'text-purple-500 text-[20px]'));
            }
        }
        
        return h('div', {
            class: `${baseClass} ${activeClass} ${layoutClass}`,
            onclick: onClick
        }, children);
    }
    
    /**
     * Create a grid of selectable options
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function optionGrid({
        options,
        value,
        onChange,
        columns = 4,
        gap = 2,
        layout = 'vertical',
        size = 'sm',
        allowDeselect = false // 是否允许取消选择
    }) {
        const grid = h(`div.grid.grid-cols-${columns}.gap-${gap}`);
        
        options.forEach(opt => {
            const isActive = opt.value === value;
            grid.appendChild(selectableItem({
                active: isActive,
                icon: opt.icon,
                label: opt.label || opt.value,
                description: opt.description,
                layout,
                size,
                onClick: () => {
                    const newValue = (allowDeselect && isActive) ? null : opt.value;
                    onChange(newValue, opt);
                }
            }));
        });
        
        return grid;
    }
    
    /**
     * Create a labeled section
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function section({ label, hint, children }) {
        return h('div.space-y-3', [
            h('div.flex.items-center.justify-between', [
                h('div.text-sm.font-medium.text-gray-700', label),
                hint && h('div.text-\[10px\].text-gray-400', hint)
            ].filter(Boolean)),
            ...(Array.isArray(children) ? children : [children])
        ]);
    }
    
    /**
     * Create a bottom sheet header
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function sheetHeader({ title, onClose }) {
        return h('div.px-6.py-4.border-b.border-gray-200.flex.justify-between.items-center.flex-shrink-0.bg-white', [
            h('h3.text-lg.font-semibold.text-gray-800', title),
            h('button.text-gray-400.hover\:text-gray-600.transition-colors', { onclick: onClose },
                icon('close', 'text-[24px]'))
        ]);
    }
    
    /**
     * Create a bars indicator (for thinking level visualization)
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function barsIndicator({ bars = 0, maxBars = 4, active = false, activeColor = '#3b82f6' }) {
        const children = [];
        for (let i = 1; i <= maxBars; i++) {
            children.push(h('div', {
                class: 'w-1.5 rounded-t-sm transition-all',
                style: {
                    height: `${(i/maxBars)*100}%`,
                    backgroundColor: i <= bars ? (active ? activeColor : '#cbd5e1') : '#f1f5f9'
                }
            }));
        }
        return h('div', { class: 'flex gap-0.5 items-end h-6 w-8 flex-shrink-0' }, children);
    }
    
    /**
     * Create a switch toggle item
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function switchItem({ label, description, checked = false, onChange }) {
        const switchInput = h('input', {
            type: 'checkbox',
            class: 'ido-form-switch__input'
        });
        switchInput.checked = checked;
        switchInput.onchange = () => onChange(switchInput.checked);
        
        return h('div.flex.items-center.justify-between.p-4.rounded-xl.bg-gray-50.border.border-gray-100', [
            h('div.flex-1.pr-4', [
                h('div.font-bold.text-gray-800', label),
                description && h('div.text-xs.text-gray-500.mt-1', description)
            ].filter(Boolean)),
            h('label.ido-form-switch', [
                switchInput,
                h('div.ido-form-switch__slider')
            ])
        ]);
    }
    
    /**
     * Create a card item with visual, info and optional check mark
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function cardItem({
        active = false,
        visual,           // HTMLElement or { bars, icon }
        label,
        description,
        onClick,
        color = 'blue'    // 'blue' | 'purple'
    }) {
        const colorMap = {
            blue: { border: 'border-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', check: 'text-blue-500' },
            purple: { border: 'border-purple-500', bg: 'bg-purple-50', text: 'text-purple-700', check: 'text-purple-500' }
        };
        const c = colorMap[color] || colorMap.blue;
        
        const baseClass = 'p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-4';
        const activeClass = active ? `${c.border} ${c.bg}` : 'border-gray-100 hover:border-gray-200 bg-white';
        
        // Build visual element
        let visualEl;
        if (visual instanceof HTMLElement) {
            visualEl = visual;
        } else if (visual) {
            if (visual.icon) {
                visualEl = h('div.flex.items-center.justify-center.w-8.h-6', 
                    icon(visual.icon, 'text-gray-400 text-[20px]'));
            } else if (typeof visual.bars === 'number') {
                visualEl = barsIndicator({ bars: visual.bars, active, activeColor: color === 'purple' ? '#9333ea' : '#3b82f6' });
            }
        }
        
        const children = [];
        if (visualEl) children.push(visualEl);
        
        children.push(h('div.flex-1', [
            h('div', { class: `font-bold ${active ? c.text : 'text-gray-700'}` }, label),
            description && h('div', { class: 'text-xs text-gray-500 mt-0.5' }, description)
        ].filter(Boolean)));
        
        if (active) {
            children.push(icon('check_circle', `${c.check} text-[20px]`));
        }
        
        return h('div', { class: `${baseClass} ${activeClass}`, onclick: onClick }, children);
    }
    
    /**
     * Create a form input group with label, hint, and input
     * @param {Object} options
     * @returns {HTMLElement}
     */
    function formInput({
        label,
        hint,
        value = '',
        placeholder = '',
        type = 'text',
        className = '',
        onChange
    }) {
        const input = h('input', {
            type,
            class: `w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors font-mono ${className}`,
            value,
            placeholder
        });
        if (onChange) input.onchange = () => onChange(input.value);
        
        return h('div.ido-form-group', [
            label && h('div.ido-form-label', label),
            hint && h('div.text-\[10px\].text-gray-500.mb-1', hint),
            input
        ].filter(Boolean));
    }

    // Export factory functions
    window.IdoUI.createIconButton = createIconButton;
    window.IdoUI.createFilePreview = createFilePreview;
    
    // Export DOM builder utilities
    window.IdoUI.h = h;
    window.IdoUI.icon = icon;
    window.IdoUI.selectableItem = selectableItem;
    window.IdoUI.optionGrid = optionGrid;
    window.IdoUI.section = section;
    window.IdoUI.sheetHeader = sheetHeader;
    window.IdoUI.barsIndicator = barsIndicator;
    window.IdoUI.switchItem = switchItem;
    window.IdoUI.cardItem = cardItem;
    window.IdoUI.formInput = formInput;
})();