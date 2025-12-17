/**
 * 声明式 UI 组件定义
 * MD3 规范组件工厂，遵循 ido- 前缀 BEM 命名规范
 */
const DeclarativeComponents = (function() {
    'use strict';

    // ============================================================
    // 辅助函数
    // ============================================================

    /**
     * 创建设置字段元素
     */
    function createSettingsField(fieldName, field, currentValue, onChange) {
        const wrapper = document.createElement('div');
        wrapper.className = field.wrapperClass || 'ido-form-group';

        // 标签
        const label = document.createElement('div');
        label.className = field.labelClass || 'ido-form-label';
        label.textContent = field.label || fieldName;
        wrapper.appendChild(label);
        
        // 提示文字
        if (field.hint) {
            const hint = document.createElement('div');
            hint.className = field.hintClass || 'ido-form-hint';
            hint.textContent = field.hint;
            wrapper.appendChild(hint);
        }

        let input;
        const value = currentValue !== undefined ? currentValue : field.default;
        
        switch (field.type) {
            case 'select':
                input = document.createElement('select');
                input.className = field.inputClass || 'ido-form-select';
                (field.options || []).forEach(opt => {
                    const option = document.createElement('option');
                    if (typeof opt === 'object') {
                        option.value = opt.value;
                        option.textContent = opt.label || opt.value;
                    } else {
                        option.value = opt;
                        option.textContent = opt;
                    }
                    if (option.value === value) option.selected = true;
                    input.appendChild(option);
                });
                input.addEventListener('change', () => onChange(input.value));
                break;
                
            case 'number':
                input = document.createElement('input');
                input.type = 'number';
                input.className = field.inputClass || 'ido-form-input';
                input.value = value ?? '';
                if (field.min !== undefined) input.min = field.min;
                if (field.max !== undefined) input.max = field.max;
                if (field.step !== undefined) input.step = field.step;
                input.placeholder = field.placeholder || '';
                input.addEventListener('change', () => {
                    const val = parseFloat(input.value);
                    if (!isNaN(val)) onChange(val);
                });
                break;
                
            case 'boolean':
            case 'checkbox':
                const toggleWrapper = document.createElement('label');
                toggleWrapper.className = 'ido-form-switch';
                const checkboxInput = document.createElement('input');
                checkboxInput.type = 'checkbox';
                checkboxInput.className = 'ido-form-switch__input';
                checkboxInput.checked = !!value;
                const slider = document.createElement('div');
                slider.className = 'ido-form-switch__slider';
                checkboxInput.addEventListener('change', () => onChange(checkboxInput.checked));
                toggleWrapper.appendChild(checkboxInput);
                toggleWrapper.appendChild(slider);
                wrapper.appendChild(toggleWrapper);
                input = null;
                break;
                
            case 'textarea':
                input = document.createElement('textarea');
                input.className = field.inputClass || 'ido-form-textarea';
                input.value = value ?? '';
                input.rows = field.rows || 3;
                input.placeholder = field.placeholder || '';
                input.addEventListener('change', () => onChange(input.value));
                break;
                
            case 'text':
            default:
                input = document.createElement('input');
                input.type = 'text';
                input.className = field.inputClass || 'ido-form-input';
                input.value = value ?? '';
                input.placeholder = field.placeholder || '';
                input.addEventListener('change', () => onChange(input.value));
                break;
        }
        
        if (input) wrapper.appendChild(input);
        return wrapper;
    }

    /**
     * 保存设置到存储
     */
    function saveSettings(storageKey, settings) {
        try {
            if (window.Framework?.storage?.setItem) {
                window.Framework.storage.setItem(storageKey, settings);
            } else {
                localStorage.setItem(storageKey, JSON.stringify(settings));
            }
        } catch (e) {
            console.error('[SettingsForm] Failed to save:', e);
        }
    }

    // ============================================================
    // 按钮组件工厂
    // ============================================================

    /**
     * 创建按钮组件
     * @param {Object} props - 组件属性
     * @param {string} variant - 变体: ghost | primary | secondary | danger
     */
    function createButton(props, variant) {
        // 优先使用 IdoUI 工厂
        if (window.IdoUI?.createIconButton) {
            return window.IdoUI.createIconButton({
                icon: props.icon,
                label: props.label,
                title: props.title || props.label,
                variant: variant,
                size: props.size || 'md',
                className: props.class,
                onClick: props._onClick
            });
        }
        
        // Fallback: 手动创建
        const btn = document.createElement('button');
        
        // 根据是否有 label 决定使用 ido-btn 还是 ido-icon-btn
        if (props.label) {
            const variantClass = {
                ghost: 'ido-btn--ghost',
                primary: 'ido-btn--primary',
                secondary: 'ido-btn--secondary',
                danger: 'ido-btn--danger'
            }[variant] || 'ido-btn--ghost';
            
            const sizeClass = {
                sm: 'ido-btn--sm',
                md: 'ido-btn--md',
                lg: 'ido-btn--lg'
            }[props.size] || '';
            
            btn.className = `ido-btn ${variantClass} ${sizeClass} ${props.class || ''}`.trim();
        } else {
            btn.className = `ido-icon-btn ${props.class || ''}`.trim();
        }
        
        btn.title = props.title || props.label || '';
        
        if (props.icon) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined';
            iconSpan.textContent = props.icon;
            btn.appendChild(iconSpan);
        }
        
        if (props.label) {
            const labelSpan = document.createElement('span');
            labelSpan.textContent = props.label;
            btn.appendChild(labelSpan);
        }
        
        return btn;
    }

    // ============================================================
    // MD3 组件定义
    // ============================================================

    const components = {
        /**
         * MD3 Icon Button (ghost 风格)
         */
        'md-icon-button': (props, ctx, factory) => createButton(props, 'ghost'),
        
        /**
         * MD3 Filled Button (primary 风格)
         */
        'md-filled-button': (props, ctx, factory) => createButton(props, 'primary'),
        
        /**
         * MD3 Outlined Button (secondary 风格)
         */
        'md-outlined-button': (props, ctx, factory) => createButton(props, 'secondary'),
        
        /**
         * MD3 Text Button (ghost 风格)
         */
        'md-text-button': (props, ctx, factory) => createButton(props, 'ghost'),
        
        /**
         * MD3 Chip / Badge
         * 使用 ido-badge 样式系统
         */
        'md-chip': (props, ctx, factory) => {
            // 颜色到 ido-badge 变体的映射
            const colorToVariant = {
                blue: 'ido-badge--primary',
                green: 'ido-badge--success',
                red: 'ido-badge--danger',
                yellow: 'ido-badge--warning',
                purple: 'ido-badge--info',
                gray: 'ido-badge--secondary',
                default: 'ido-badge--secondary'
            };
            
            const chip = document.createElement('span');
            let variantClass = colorToVariant[props.color] || colorToVariant.default;
            
            let finalText = props.label || props.text || '';
            let finalIcon = props.icon;
            let finalTitle = props.title || '';
            
            // 处理条件变体
            if (props.variants && Array.isArray(props.variants)) {
                for (const variant of props.variants) {
                    let isActive = false;
                    
                    if (variant.default) {
                        isActive = true;
                    } else if (variant.when) {
                        isActive = window.IdoFront?.expressionEngine?.resolve(variant.when, ctx);
                    }
                    
                    if (isActive) {
                        if (variant.text) finalText = variant.text;
                        if (variant.color && colorToVariant[variant.color]) {
                            variantClass = colorToVariant[variant.color];
                        }
                        if (variant.icon) finalIcon = variant.icon;
                        if (variant.title) finalTitle = variant.title;
                        if (!variant.default) break;
                    }
                }
            }
            
            chip.className = `ido-badge ${variantClass} ${props.class || ''}`.trim();
            
            if (finalIcon) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'material-symbols-outlined';
                iconSpan.style.fontSize = '14px';
                iconSpan.textContent = finalIcon;
                chip.appendChild(iconSpan);
            }
            
            if (finalText) {
                const labelSpan = document.createElement('span');
                labelSpan.textContent = finalText;
                chip.appendChild(labelSpan);
            }
            
            if (finalTitle) chip.title = finalTitle;
            
            return chip;
        },
        
        /**
         * MD3 Switch
         * 使用 ido-form-switch 样式
         */
        'md-switch': (props, ctx, factory) => {
            const container = document.createElement('label');
            container.className = `ido-form-switch ${props.class || ''}`.trim();
            
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!props.checked;
            input.className = 'ido-form-switch__input';
            
            const slider = document.createElement('div');
            slider.className = 'ido-form-switch__slider';
            
            container.appendChild(input);
            container.appendChild(slider);
            
            if (props.label) {
                const label = document.createElement('span');
                label.className = 'ido-form-switch__label';
                label.textContent = props.label;
                container.appendChild(label);
            }
            
            return container;
        },
        
        /**
         * MD3 Text Field (Outlined)
         * 使用 ido-form-input 样式
         */
        'md-outlined-text-field': (props, ctx, factory) => {
            const container = document.createElement('div');
            container.className = `ido-form-group ${props.class || ''}`.trim();
            
            if (props.label) {
                const label = document.createElement('label');
                label.className = 'ido-form-label';
                label.textContent = props.label;
                container.appendChild(label);
            }
            
            const input = document.createElement('input');
            input.type = props.type || 'text';
            input.className = 'ido-form-input';
            input.placeholder = props.placeholder || '';
            input.value = props.value || '';
            
            if (props.min !== undefined) input.min = props.min;
            if (props.max !== undefined) input.max = props.max;
            if (props.step !== undefined) input.step = props.step;
            if (props.disabled) input.disabled = true;
            
            container.appendChild(input);
            
            return container;
        },
        
        /**
         * MD3 Select
         * 使用 ido-form-select 样式
         */
        'md-outlined-select': (props, ctx, factory) => {
            const container = document.createElement('div');
            container.className = `ido-form-group ${props.class || ''}`.trim();
            
            if (props.label) {
                const label = document.createElement('label');
                label.className = 'ido-form-label';
                label.textContent = props.label;
                container.appendChild(label);
            }
            
            const select = document.createElement('select');
            select.className = 'ido-form-select';
            
            if (props.options && Array.isArray(props.options)) {
                for (const opt of props.options) {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label || opt.value;
                    if (props.value === opt.value) option.selected = true;
                    select.appendChild(option);
                }
            }
            
            container.appendChild(select);
            
            return container;
        },
        
        /**
         * MD3 Divider
         * 使用 ido-divider 样式
         */
        'md-divider': (props, ctx, factory) => {
            const divider = document.createElement('div');
            const verticalClass = props.vertical ? 'ido-divider--vertical' : '';
            divider.className = `ido-divider ${verticalClass} ${props.class || ''}`.trim();
            return divider;
        },
        
        /**
         * Text span
         */
        'md-text': (props, ctx, factory) => {
            const el = document.createElement(props.tag || 'span');
            el.className = props.class || '';
            el.textContent = props.text || props.content || '';
            return el;
        },
        
        /**
         * Container / Layout
         */
        'md-container': (props, ctx, factory) => {
            const el = document.createElement('div');
            el.className = props.class || '';
            
            if (props.direction) el.style.flexDirection = props.direction;
            if (props.gap) el.style.gap = typeof props.gap === 'number' ? `${props.gap}px` : props.gap;
            
            if (props.children && Array.isArray(props.children)) {
                for (const child of props.children) {
                    const childEl = factory.create(child.component || 'md-text', child.props || {}, ctx);
                    if (childEl) el.appendChild(childEl);
                }
            }
            
            return el;
        },
        
        /**
         * Settings Form
         * 设置表单组件，使用 ido-card 和 ido-form 样式
         */
        'settings-form': (props, ctx, factory) => {
            const card = document.createElement('div');
            card.className = props.class || props.className || 'ido-card';
            
            // 头部
            const header = document.createElement('div');
            header.className = props.headerClass || 'ido-card__header';
            
            if (props.icon) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'material-symbols-outlined';
                iconSpan.style.fontSize = '18px';
                iconSpan.textContent = props.icon;
                header.appendChild(iconSpan);
            }
            
            const title = document.createElement('span');
            title.className = 'ido-panel__title';
            title.textContent = props.title || 'Settings';
            header.appendChild(title);
            card.appendChild(header);
            
            // 描述
            if (props.description) {
                const desc = document.createElement('p');
                desc.className = 'ido-card__body';
                desc.textContent = props.description;
                card.appendChild(desc);
            }
            
            // 字段表单
            const form = document.createElement('div');
            form.className = 'ido-panel__content';
            
            const pluginId = props.pluginId || ctx.pluginId || 'unknown';
            const storageKey = `plugin:${pluginId}:settings`;
            
            let currentSettings = {};
            try {
                if (window.Framework?.storage?.getItem) {
                    currentSettings = window.Framework.storage.getItem(storageKey, {}) || {};
                } else {
                    const raw = localStorage.getItem(storageKey);
                    if (raw) currentSettings = JSON.parse(raw);
                }
            } catch (e) {
                currentSettings = {};
            }
            
            if (props.fields && typeof props.fields === 'object') {
                for (const [fieldName, fieldConfig] of Object.entries(props.fields)) {
                    const fieldEl = createSettingsField(
                        fieldName,
                        fieldConfig,
                        currentSettings[fieldName],
                        (newValue) => {
                            currentSettings[fieldName] = newValue;
                            saveSettings(storageKey, currentSettings);
                        }
                    );
                    if (fieldEl) form.appendChild(fieldEl);
                }
            }
            
            card.appendChild(form);
            return card;
        },
        
        /**
         * 原生 HTML 元素组件
         */
        'element': (props, ctx, factory) => {
            const tag = props.tag || 'div';
            const el = document.createElement(tag);
            el.className = props.class || '';
            
            if (props.text) el.textContent = props.text;
            if (props.style && typeof props.style === 'object') Object.assign(el.style, props.style);
            
            if (props.data && typeof props.data === 'object') {
                Object.entries(props.data).forEach(([key, value]) => {
                    el.dataset[key] = value;
                });
            }
            
            if (props.children && Array.isArray(props.children)) {
                for (const child of props.children) {
                    const childEl = factory.create(child.component || 'div', child.props || {}, ctx);
                    if (childEl) el.appendChild(childEl);
                }
            }
            
            return el;
        }
    };

    // ============================================================
    // 别名注册
    // ============================================================

    // 兼容别名
    components['icon-button'] = components['md-icon-button'];
    components['status-badge'] = components['md-chip'];
    components['toggle'] = components['md-switch'];
    components['select'] = components['md-outlined-select'];
    components['input'] = components['md-outlined-text-field'];
    components['text'] = components['md-text'];
    components['divider'] = components['md-divider'];
    components['container'] = components['md-container'];

    // 原生元素别名（使用循环生成减少代码重复）
    const nativeElements = ['div', 'span', 'p', 'section', 'header', 'footer', 'article', 'nav', 'aside', 'ul', 'ol', 'li'];
    nativeElements.forEach(tag => {
        components[tag] = (props, ctx, factory) => components['element']({ tag, ...props }, ctx, factory);
    });

    return {
        components,
        createSettingsField,
        saveSettings
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.DeclarativeComponents = DeclarativeComponents;
}
window.DeclarativeComponents = DeclarativeComponents;