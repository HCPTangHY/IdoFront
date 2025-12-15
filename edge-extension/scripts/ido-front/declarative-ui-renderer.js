/**
 * Declarative UI Renderer
 * 声明式 UI 渲染器 - 主线程直接执行，无需沙箱
 * 
 * 使用工厂模式和 MD3 规范
 */
(function() {
    'use strict';

    window.IdoFront = window.IdoFront || {};

    // ============================================================
    // 表达式引擎（使用 jexl）
    // ============================================================
    
    class ExpressionEngine {
        constructor() {
            this._jexl = null;
        }
        
        init() {
            if (typeof jexl !== 'undefined') {
                this._jexl = jexl;
                this._setupBuiltins();
                console.log('[ExpressionEngine] Initialized with jexl');
            } else {
                console.warn('[ExpressionEngine] jexl not found, using fallback parser');
            }
        }
        
        _setupBuiltins() {
            if (!this._jexl) return;
            
            // 转换函数
            const transforms = {
                upper: val => String(val).toUpperCase(),
                lower: val => String(val).toLowerCase(),
                trim: val => String(val).trim(),
                default: (val, def) => val ?? def,
                json: val => JSON.stringify(val),
                last: arr => Array.isArray(arr) ? arr[arr.length - 1] : arr,
                first: arr => Array.isArray(arr) ? arr[0] : arr,
                length: val => val?.length ?? 0,
                keys: obj => obj ? Object.keys(obj) : [],
                values: obj => obj ? Object.values(obj) : []
            };
            
            Object.entries(transforms).forEach(([name, fn]) => {
                this._jexl.addTransform(name, fn);
            });
            
            // 函数
            const functions = {
                now: () => Date.now(),
                date: (timestamp) => new Date(timestamp).toISOString(),
                isEmpty: val => {
                    if (val == null) return true;
                    if (Array.isArray(val)) return val.length === 0;
                    if (typeof val === 'object') return Object.keys(val).length === 0;
                    if (typeof val === 'string') return val.trim() === '';
                    return false;
                },
                isNotEmpty: val => !functions.isEmpty(val)
            };
            
            Object.entries(functions).forEach(([name, fn]) => {
                this._jexl.addFunction(name, fn);
            });
        }
        
        eval(expr, context = {}) {
            if (!expr) return null;
            
            try {
                if (this._jexl) {
                    return this._jexl.evalSync(expr, context);
                }
                return this._fallbackEval(expr, context);
            } catch (e) {
                console.warn('[ExpressionEngine] Eval error:', expr, e.message);
                return null;
            }
        }
        
        async evalAsync(expr, context = {}) {
            if (!expr) return null;
            
            try {
                if (this._jexl) {
                    return await this._jexl.eval(expr, context);
                }
                return this._fallbackEval(expr, context);
            } catch (e) {
                console.warn('[ExpressionEngine] Async eval error:', expr, e.message);
                return null;
            }
        }
        
        resolve(value, context = {}) {
            if (value === null || value === undefined) return value;
            
            if (typeof value === 'string') {
                // 完整表达式: $expr
                if (value.startsWith('$') && !value.startsWith('${')) {
                    return this.eval(value.substring(1), context);
                }
                
                // 模板字符串: "Hello ${name}"
                if (value.includes('${')) {
                    return value.replace(/\$\{([^}]+)\}/g, (_, expr) => {
                        const result = this.eval(expr, context);
                        return result !== null && result !== undefined ? String(result) : '';
                    });
                }
                
                return value;
            }
            
            if (Array.isArray(value)) {
                return value.map(item => this.resolve(item, context));
            }
            
            if (typeof value === 'object') {
                const resolved = {};
                for (const key of Object.keys(value)) {
                    resolved[key] = this.resolve(value[key], context);
                }
                return resolved;
            }
            
            return value;
        }
        
        _fallbackEval(expr, context) {
            const parts = expr.split('.');
            let current = context;
            
            for (const part of parts) {
                if (current === null || current === undefined) return null;
                
                const match = part.match(/^(\w+)\[(\d+)\]$/);
                if (match) {
                    current = current[match[1]];
                    if (Array.isArray(current)) {
                        current = current[parseInt(match[2], 10)];
                    }
                } else {
                    current = current[part];
                }
            }
            
            return current;
        }
    }

    // ============================================================
    // 动作注册表
    // ============================================================
    
    class ActionRegistry {
        constructor(expressionEngine) {
            this._handlers = new Map();
            this._expr = expressionEngine;
        }
        
        register(actionType, handler) {
            this._handlers.set(actionType, handler);
            return this;
        }
        
        async execute(action, context = {}) {
            if (!action) return;
            
            if (Array.isArray(action)) {
                for (const a of action) {
                    await this.execute(a, context);
                }
                return;
            }
            
            // 检查条件
            if (action.$if !== undefined) {
                const condition = this._expr.resolve(action.$if, context);
                if (!condition) return;
            }
            
            const actionType = action.action;
            if (!actionType) {
                console.warn('[ActionRegistry] No action type specified:', action);
                return;
            }
            
            const resolvedAction = this._expr.resolve(action, context);
            const handler = this._handlers.get(actionType);
            
            if (handler) {
                try {
                    return await handler(resolvedAction, context);
                } catch (e) {
                    console.error('[ActionRegistry] Action error:', actionType, e);
                }
            } else {
                console.warn('[ActionRegistry] Unknown action:', actionType);
            }
        }
    }

    // ============================================================
    // MD3 组件工厂
    // ============================================================
    
    class ComponentFactory {
        constructor(expressionEngine) {
            this._factories = new Map();
            this._expr = expressionEngine;
        }
        
        register(name, factory) {
            this._factories.set(name, factory);
            return this;
        }
        
        create(name, props, context) {
            const factory = this._factories.get(name);
            if (!factory) {
                console.warn('[ComponentFactory] Unknown component:', name);
                return null;
            }
            
            try {
                const resolvedProps = this._expr.resolve(props, context);
                return factory(resolvedProps, context, this);
            } catch (e) {
                console.error('[ComponentFactory] Create error:', name, e);
                return null;
            }
        }
        
        has(name) {
            return this._factories.has(name);
        }
    }

    // ============================================================
    // MD3 组件定义
    // ============================================================
    
    const MD3Components = {
        /**
         * MD3 Icon Button (FAB style or standard)
         */
        'md-icon-button': (props, ctx, factory) => {
            // 复用 IdoUI 工厂
            if (window.IdoUI?.createIconButton) {
                return window.IdoUI.createIconButton({
                    icon: props.icon,
                    label: props.label,
                    title: props.title || props.label,
                    variant: props.variant || 'ghost',
                    size: props.size || 'md',
                    className: props.class,
                    onClick: props._onClick
                });
            }
            
            // Fallback
            const btn = document.createElement('button');
            btn.className = `ido-icon-btn ${props.class || ''}`.trim();
            btn.title = props.title || props.label || '';
            
            if (props.icon) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'material-symbols-outlined text-[18px]';
                iconSpan.textContent = props.icon;
                btn.appendChild(iconSpan);
            }
            
            if (props.label) {
                const labelSpan = document.createElement('span');
                labelSpan.textContent = props.label;
                btn.appendChild(labelSpan);
            }
            
            return btn;
        },
        
        /**
         * MD3 Filled Button
         */
        'md-filled-button': (props, ctx, factory) => {
            if (window.IdoUI?.createIconButton) {
                return window.IdoUI.createIconButton({
                    icon: props.icon,
                    label: props.label,
                    title: props.title,
                    variant: 'primary',
                    size: props.size || 'md',
                    className: props.class,
                    onClick: props._onClick
                });
            }
            
            const btn = document.createElement('button');
            btn.className = `ido-btn ido-btn--primary ${props.class || ''}`.trim();
            btn.textContent = props.label || '';
            return btn;
        },
        
        /**
         * MD3 Outlined Button
         */
        'md-outlined-button': (props, ctx, factory) => {
            if (window.IdoUI?.createIconButton) {
                return window.IdoUI.createIconButton({
                    icon: props.icon,
                    label: props.label,
                    title: props.title,
                    variant: 'secondary',
                    size: props.size || 'md',
                    className: props.class,
                    onClick: props._onClick
                });
            }
            
            const btn = document.createElement('button');
            btn.className = `ido-btn ido-btn--secondary ${props.class || ''}`.trim();
            btn.textContent = props.label || '';
            return btn;
        },
        
        /**
         * MD3 Text Button
         */
        'md-text-button': (props, ctx, factory) => {
            if (window.IdoUI?.createIconButton) {
                return window.IdoUI.createIconButton({
                    icon: props.icon,
                    label: props.label,
                    title: props.title,
                    variant: 'ghost',
                    size: props.size || 'md',
                    className: props.class,
                    onClick: props._onClick
                });
            }
            
            const btn = document.createElement('button');
            btn.className = `ido-btn ido-btn--ghost ${props.class || ''}`.trim();
            btn.textContent = props.label || '';
            return btn;
        },
        
        /**
         * MD3 Chip / Badge
         *
         * 支持的颜色: blue, green, red, yellow, purple, gray
         * 可通过 variants 实现条件样式
         */
        'md-chip': (props, ctx, factory) => {
            // 颜色映射表：color -> tailwind 类名
            const colorMap = {
                blue: 'text-blue-600 bg-blue-50',
                green: 'text-green-600 bg-green-50',
                red: 'text-red-600 bg-red-50',
                yellow: 'text-yellow-600 bg-yellow-50',
                purple: 'text-purple-600 bg-purple-50',
                gray: 'text-gray-600 bg-gray-50',
                default: 'text-gray-600 bg-gray-100'
            };
            
            const chip = document.createElement('span');
            // 基础样式
            let baseClass = 'px-2 py-0.5 rounded inline-flex items-center gap-1';
            
            // 应用默认颜色
            let colorClass = colorMap[props.color] || colorMap.default;
            
            // 条件变体处理
            let finalText = props.label || props.text || '';
            let finalIcon = props.icon;
            let finalTitle = props.title || '';
            
            if (props.variants && Array.isArray(props.variants)) {
                for (const variant of props.variants) {
                    let isActive = false;
                    
                    if (variant.default) {
                        isActive = true;
                    } else if (variant.when) {
                        // 使用表达式引擎解析条件
                        isActive = window.IdoFront?.expressionEngine?.resolve(variant.when, ctx);
                    }
                    
                    if (isActive) {
                        if (variant.text) finalText = variant.text;
                        if (variant.color && colorMap[variant.color]) {
                            colorClass = colorMap[variant.color];
                        }
                        if (variant.icon) finalIcon = variant.icon;
                        if (variant.title) finalTitle = variant.title;
                        
                        // 如果不是 default 变体，找到匹配后就停止
                        if (!variant.default) break;
                    }
                }
            }
            
            // 合并类名
            chip.className = `${baseClass} ${colorClass} ${props.class || ''}`.trim();
            
            // 添加图标
            if (finalIcon) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'material-symbols-outlined text-[14px]';
                iconSpan.textContent = finalIcon;
                chip.appendChild(iconSpan);
            }
            
            // 添加文本
            if (finalText) {
                const labelSpan = document.createElement('span');
                labelSpan.textContent = finalText;
                chip.appendChild(labelSpan);
            }
            
            // 设置 title
            if (finalTitle) {
                chip.title = finalTitle;
            }
            
            return chip;
        },
        
        /**
         * MD3 Switch
         */
        'md-switch': (props, ctx, factory) => {
            const container = document.createElement('label');
            container.className = `ido-switch ${props.class || ''}`.trim();
            
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!props.checked;
            input.className = 'ido-switch__input';
            
            const track = document.createElement('span');
            track.className = 'ido-switch__track';
            
            const thumb = document.createElement('span');
            thumb.className = 'ido-switch__thumb';
            track.appendChild(thumb);
            
            container.appendChild(input);
            container.appendChild(track);
            
            if (props.label) {
                const label = document.createElement('span');
                label.className = 'ido-switch__label';
                label.textContent = props.label;
                container.appendChild(label);
            }
            
            return container;
        },
        
        /**
         * MD3 Text Field (Outlined)
         */
        'md-outlined-text-field': (props, ctx, factory) => {
            const container = document.createElement('div');
            container.className = `ido-text-field ido-text-field--outlined ${props.class || ''}`.trim();
            
            const input = document.createElement('input');
            input.type = props.type || 'text';
            input.className = 'ido-text-field__input';
            input.placeholder = props.placeholder || ' ';
            input.value = props.value || '';
            
            if (props.min !== undefined) input.min = props.min;
            if (props.max !== undefined) input.max = props.max;
            if (props.step !== undefined) input.step = props.step;
            if (props.disabled) input.disabled = true;
            
            container.appendChild(input);
            
            if (props.label) {
                const label = document.createElement('label');
                label.className = 'ido-text-field__label';
                label.textContent = props.label;
                container.appendChild(label);
            }
            
            return container;
        },
        
        /**
         * MD3 Select (Menu)
         */
        'md-outlined-select': (props, ctx, factory) => {
            const container = document.createElement('div');
            container.className = `ido-select ido-select--outlined ${props.class || ''}`.trim();
            
            const select = document.createElement('select');
            select.className = 'ido-select__input';
            
            if (props.options && Array.isArray(props.options)) {
                for (const opt of props.options) {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label || opt.value;
                    if (props.value === opt.value) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                }
            }
            
            container.appendChild(select);
            
            if (props.label) {
                const label = document.createElement('label');
                label.className = 'ido-select__label';
                label.textContent = props.label;
                container.appendChild(label);
            }
            
            return container;
        },
        
        /**
         * MD3 Divider
         */
        'md-divider': (props, ctx, factory) => {
            const divider = document.createElement('div');
            divider.className = `ido-divider ${props.inset ? 'ido-divider--inset' : ''} ${props.class || ''}`.trim();
            return divider;
        },
        
        /**
         * Text span
         */
        'md-text': (props, ctx, factory) => {
            const el = document.createElement(props.tag || 'span');
            el.className = `ido-text ${props.class || ''}`.trim();
            el.textContent = props.text || props.content || '';
            
            if (props.typography) {
                el.classList.add(`ido-text--${props.typography}`);
            }
            
            return el;
        },
        
        /**
         * Container / Layout
         */
        'md-container': (props, ctx, factory) => {
            const el = document.createElement('div');
            el.className = `ido-container ${props.class || ''}`.trim();
            
            if (props.direction) {
                el.style.flexDirection = props.direction;
            }
            
            if (props.gap) {
                el.style.gap = typeof props.gap === 'number' ? `${props.gap}px` : props.gap;
            }
            
            // 渲染子组件
            if (props.children && Array.isArray(props.children)) {
                for (const child of props.children) {
                    const childEl = factory.create(
                        child.component || 'md-text',
                        child.props || {},
                        ctx
                    );
                    if (childEl) el.appendChild(childEl);
                }
            }
            
            return el;
        },
        
        /**
         * Settings Form - 设置表单组件
         * 用于 SETTINGS_GENERAL 插槽，自动渲染设置字段
         */
        'settings-form': (props, ctx, factory) => {
            const card = document.createElement('div');
            // 支持自定义 class，默认使用 ido-card 样式
            card.className = props.class || props.className || 'ido-card p-4 space-y-2';
            
            // 头部（图标 + 标题）
            const header = document.createElement('div');
            header.className = props.headerClass || 'flex items-center gap-2';
            
            if (props.icon) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'material-symbols-outlined text-[18px] text-gray-500';
                iconSpan.textContent = props.icon;
                header.appendChild(iconSpan);
            }
            
            const title = document.createElement('span');
            title.className = 'font-medium text-gray-800';
            title.textContent = props.title || 'Settings';
            header.appendChild(title);
            
            card.appendChild(header);
            
            // 描述
            if (props.description) {
                const desc = document.createElement('p');
                desc.className = 'text-xs text-gray-500';
                desc.textContent = props.description;
                card.appendChild(desc);
            }
            
            // 字段表单
            const form = document.createElement('div');
            form.className = 'mt-3 space-y-3';
            
            // 获取存储的设置值
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
            
            // 渲染每个字段
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
         * 通过 tag 属性指定标签名，默认 div
         */
        'element': (props, ctx, factory) => {
            const tag = props.tag || 'div';
            const el = document.createElement(tag);
            el.className = props.class || '';
            
            // 文本内容
            if (props.text) {
                el.textContent = props.text;
            }
            
            // 内联样式
            if (props.style && typeof props.style === 'object') {
                Object.assign(el.style, props.style);
            }
            
            // data 属性
            if (props.data && typeof props.data === 'object') {
                Object.entries(props.data).forEach(([key, value]) => {
                    el.dataset[key] = value;
                });
            }
            
            // 子组件
            if (props.children && Array.isArray(props.children)) {
                for (const child of props.children) {
                    const childEl = factory.create(
                        child.component || 'div',
                        child.props || {},
                        ctx
                    );
                    if (childEl) el.appendChild(childEl);
                }
            }
            
            return el;
        },
        
        /**
         * 兼容别名
         */
        'icon-button': (props, ctx, factory) => MD3Components['md-icon-button'](props, ctx, factory),
        'status-badge': (props, ctx, factory) => MD3Components['md-chip'](props, ctx, factory),
        'toggle': (props, ctx, factory) => MD3Components['md-switch'](props, ctx, factory),
        'select': (props, ctx, factory) => MD3Components['md-outlined-select'](props, ctx, factory),
        'input': (props, ctx, factory) => MD3Components['md-outlined-text-field'](props, ctx, factory),
        'text': (props, ctx, factory) => MD3Components['md-text'](props, ctx, factory),
        'divider': (props, ctx, factory) => MD3Components['md-divider'](props, ctx, factory),
        'container': (props, ctx, factory) => MD3Components['md-container'](props, ctx, factory),
        
        // 原生元素别名
        'div': (props, ctx, factory) => MD3Components['element']({ tag: 'div', ...props }, ctx, factory),
        'span': (props, ctx, factory) => MD3Components['element']({ tag: 'span', ...props }, ctx, factory),
        'p': (props, ctx, factory) => MD3Components['element']({ tag: 'p', ...props }, ctx, factory),
        'section': (props, ctx, factory) => MD3Components['element']({ tag: 'section', ...props }, ctx, factory),
        'header': (props, ctx, factory) => MD3Components['element']({ tag: 'header', ...props }, ctx, factory),
        'footer': (props, ctx, factory) => MD3Components['element']({ tag: 'footer', ...props }, ctx, factory),
        'article': (props, ctx, factory) => MD3Components['element']({ tag: 'article', ...props }, ctx, factory),
        'nav': (props, ctx, factory) => MD3Components['element']({ tag: 'nav', ...props }, ctx, factory),
        'aside': (props, ctx, factory) => MD3Components['element']({ tag: 'aside', ...props }, ctx, factory),
        'ul': (props, ctx, factory) => MD3Components['element']({ tag: 'ul', ...props }, ctx, factory),
        'ol': (props, ctx, factory) => MD3Components['element']({ tag: 'ol', ...props }, ctx, factory),
        'li': (props, ctx, factory) => MD3Components['element']({ tag: 'li', ...props }, ctx, factory)
    };
    
    /**
     * 创建设置字段元素
     */
    function createSettingsField(fieldName, field, currentValue, onChange) {
        const wrapper = document.createElement('div');
        // 支持字段级别的自定义 class
        wrapper.className = field.wrapperClass || 'ido-form-group';

        // 标签（支持自定义 class）
        const label = document.createElement('div');
        label.className = field.labelClass || 'ido-form-label';
        label.textContent = field.label || fieldName;
        wrapper.appendChild(label);
        
        // 提示文字（放在输入框之前，支持自定义 class）
        if (field.hint) {
            const hint = document.createElement('div');
            hint.className = field.hintClass || 'text-[10px] text-gray-500 mb-1';
            hint.textContent = field.hint;
            wrapper.appendChild(hint);
        }

        // 输入框通用样式（支持自定义覆盖）
        const inputBaseClass = field.inputClass || field.class || 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';

        // 根据类型创建输入控件
        let input;
        const value = currentValue !== undefined ? currentValue : field.default;
        
        switch (field.type) {
            case 'select':
                input = document.createElement('select');
                input.className = inputBaseClass;
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
                input.className = inputBaseClass;
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
                input = document.createElement('input');
                input.type = 'checkbox';
                input.className = 'ido-form-switch__input';
                input.checked = !!value;
                const slider = document.createElement('div');
                slider.className = 'ido-form-switch__slider';
                input.addEventListener('change', () => onChange(input.checked));
                toggleWrapper.appendChild(input);
                toggleWrapper.appendChild(slider);
                wrapper.appendChild(toggleWrapper);
                input = null; // 已经添加了
                break;
                
            case 'textarea':
                input = document.createElement('textarea');
                input.className = inputBaseClass;
                input.value = value ?? '';
                input.rows = field.rows || 3;
                input.placeholder = field.placeholder || '';
                input.addEventListener('change', () => onChange(input.value));
                break;
                
            case 'text':
            default:
                input = document.createElement('input');
                input.type = 'text';
                input.className = inputBaseClass;
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
    // 内置动作
    // ============================================================
    
    const BuiltinActions = {
        // Storage 动作
        'storage:set': async (action) => {
            await Framework.storage.setItem(action.key, action.value);
        },
        
        'storage:get': async (action) => {
            return await Framework.storage.getItem(action.key);
        },
        
        'storage:push': async (action) => {
            const arr = await Framework.storage.getItem(action.key, []);
            if (!arr.includes(action.value)) {
                arr.push(action.value);
                await Framework.storage.setItem(action.key, arr);
            }
        },
        
        'storage:remove': async (action) => {
            const arr = await Framework.storage.getItem(action.key, []);
            const index = arr.indexOf(action.value);
            if (index !== -1) {
                arr.splice(index, 1);
                await Framework.storage.setItem(action.key, arr);
            }
        },
        
        // 元数据动作
        'setMeta': async (action) => {
            const conv = await window.IdoFront?.store?.getActiveConversation?.();
            if (conv) {
                await window.IdoFront.store.updateConversationMetadata(conv.id, {
                    [action.key]: action.value
                });
            }
        },
        
        'clearMeta': async (action) => {
            const conv = await window.IdoFront?.store?.getActiveConversation?.();
            if (conv) {
                await window.IdoFront.store.updateConversationMetadata(conv.id, {
                    [action.key]: null
                });
            }
        },
        
        // UI 动作
        'toast': (action) => {
            if (typeof Framework !== 'undefined' && Framework.toast) {
                Framework.toast(action.message, action.type || 'info');
            }
        },
        
        'togglePanel': (action) => {
            if (typeof Framework !== 'undefined' && Framework.togglePanel) {
                Framework.togglePanel(action.panel, action.visible);
            }
        },
        
        'navigate': (action) => {
            if (action.url) {
                window.open(action.url, action.target || '_blank');
            }
        },
        
        'emit': (action) => {
            // 使用 store 事件总线，确保沙箱中的监听器也能收到
            const store = window.IdoFront?.store;
            if (store?.events?.emit) {
                store.events.emit(action.event, action.data);
            } else {
                // 降级到 window 事件
                window.dispatchEvent(new CustomEvent(action.event, { detail: action.data }));
            }
        }
    };

    // ============================================================
    // 声明式 UI 管理器
    // ============================================================
    
    class DeclarativeUIManager {
        constructor(componentFactory, actionRegistry, expressionEngine) {
            this._slots = new Map();
            this._context = {};
            this._updateCallbacks = new Set();
            this._factory = componentFactory;
            this._actions = actionRegistry;
            this._expr = expressionEngine;
            this._registeredToFramework = new Map(); // slotName -> Set<componentId>
        }
        
        /**
         * 将 YAML 中的插槽名称转换为 Framework 实际使用的插槽 ID
         * 支持两种格式：
         * - 常量形式：INPUT_TOP -> Framework.SLOTS.INPUT_TOP -> 'slot-input-top'
         * - 直接使用 slot id：slot-input-top -> slot-input-top
         */
        _resolveSlotName(slotName) {
            // 如果已经是 slot-xxx 格式，直接返回
            if (slotName.startsWith('slot-') || slotName.startsWith('message-')) {
                return slotName;
            }
            // 尝试从 Framework.SLOTS 获取
            if (window.Framework?.SLOTS?.[slotName]) {
                return window.Framework.SLOTS[slotName];
            }
            // 未找到映射，返回原值
            console.warn(`[DeclarativeUI] Slot "${slotName}" not found in Framework.SLOTS, using as-is`);
            return slotName;
        }
        
        /**
         * 注册声明式 UI 组件
         * 同时向 Framework.registerPlugin 注册，实现与原有插件系统的桥接
         */
        register(slotName, componentId, config) {
            if (!this._slots.has(slotName)) {
                this._slots.set(slotName, []);
            }
            
            const slot = this._slots.get(slotName);
            const existing = slot.findIndex(c => c.id === componentId);
            
            const fullConfig = { id: componentId, ...config };
            
            if (existing !== -1) {
                slot[existing] = fullConfig;
            } else {
                slot.push(fullConfig);
            }
            
            // 桥接到 Framework.registerUIComponent（纯 UI 组件，不需要元数据）
            this._registerToFramework(slotName, componentId, fullConfig);
            
            console.log(`[DeclarativeUI] Registered ${componentId} to ${slotName}`);
        }
        
        /**
         * 向 Framework 注册 UI 组件（不是插件，不会出现在插件列表）
         */
        _registerToFramework(slotName, componentId, config) {
            // 确保 Framework 存在
            if (typeof window.Framework === 'undefined') {
                console.warn('[DeclarativeUI] Framework not available, skipping bridge');
                return;
            }
            
            // 优先使用 registerUIComponent（纯 UI 组件），降级到 registerPlugin
            const useUIComponent = typeof window.Framework.registerUIComponent === 'function';
            
            // 解析插槽名称
            const resolvedSlotName = this._resolveSlotName(slotName);
            
            // 记录已注册的组件（使用解析后的名称）
            if (!this._registeredToFramework.has(resolvedSlotName)) {
                this._registeredToFramework.set(resolvedSlotName, new Set());
            }
            
            // 如果已经注册过，先注销
            if (this._registeredToFramework.get(resolvedSlotName).has(componentId)) {
                try {
                    if (useUIComponent && window.Framework.unregisterUIComponent) {
                        window.Framework.unregisterUIComponent(resolvedSlotName, componentId);
                    } else if (window.Framework.unregisterPlugin) {
                        window.Framework.unregisterPlugin(resolvedSlotName, componentId);
                    }
                } catch (e) {
                    // ignore
                }
            }
            
            const self = this;
            
            // 创建渲染函数
            const renderFn = (frameworkApi) => {
                return self._renderComponent(config, frameworkApi);
            };
            
            // 注册到 Framework
            try {
                if (useUIComponent) {
                    // 使用新的 registerUIComponent：不需要元数据，不会出现在插件列表
                    window.Framework.registerUIComponent(resolvedSlotName, componentId, renderFn);
                } else if (window.Framework.registerPlugin) {
                    // 降级：使用 registerPlugin，但设置 listable: false
                    window.Framework.registerPlugin(resolvedSlotName, componentId, {
                        meta: {
                            id: componentId,
                            name: config.name || componentId,
                            source: 'declarative',
                            isDeclarative: true,
                            listable: false
                        },
                        render: renderFn
                    });
                }
                this._registeredToFramework.get(resolvedSlotName).add(componentId);
            } catch (e) {
                console.error(`[DeclarativeUI] Failed to register to Framework: ${resolvedSlotName}/${componentId}`, e);
            }
        }
        
        /**
         * 渲染单个组件（供 Framework 调用）
         */
        _renderComponent(config, frameworkApi) {
            // 构建渲染上下文
            const context = this._buildRenderContext(frameworkApi);
            
            // 将 pluginId 注入到上下文，供 settings-form 等组件使用
            if (config.pluginId) {
                context.pluginId = config.pluginId;
            }
            
            // 检查可见性
            if (config.visible !== undefined) {
                const isVisible = this._expr.resolve(config.visible, context);
                if (!isVisible) {
                    // 返回一个空的、隐藏的占位元素
                    const placeholder = document.createElement('span');
                    placeholder.style.display = 'none';
                    placeholder.dataset.declarativeHidden = 'true';
                    placeholder.dataset.componentId = config.id;
                    return placeholder;
                }
            }
            
            // 创建组件
            const element = this._factory.create(
                config.component || 'md-text',
                config.props || {},
                context
            );
            
            if (!element) {
                const fallback = document.createElement('span');
                fallback.style.display = 'none';
                return fallback;
            }
            
            // 绑定点击事件
            if (config.onClick) {
                element.addEventListener('click', async (e) => {
                    e.preventDefault();
                    await this._actions.execute(config.onClick, context);
                });
                element.style.cursor = 'pointer';
            }
            
            // 渲染动作按钮
            if (config.actions) {
                this._renderActions(element, config.actions, context);
            }
            
            element.dataset.componentId = config.id;
            element.dataset.declarative = 'true';
            
            return element;
        }
        
        /**
         * 构建渲染上下文
         */
        _buildRenderContext(frameworkApi) {
            // 基础上下文
            const context = { ...this._context };
            
            // 添加 store 数据
            try {
                const store = window.IdoFront?.store;
                if (store) {
                    const activeConv = store.getActiveConversation?.();
                    const activeChannel = activeConv && store.state?.channels
                        ? store.state.channels.find(c => c.id === activeConv.selectedChannelId)
                        : null;
                    
                    context.conversation = activeConv || {};
                    context.channel = activeChannel || {};
                    context.meta = activeConv?.metadata || {};
                    context.state = store.state || {};
                }
            } catch (e) {
                console.warn('[DeclarativeUI] Failed to build context from store:', e);
            }
            
            // 添加 Framework API（部分）
            context.framework = {
                togglePanel: window.Framework?.togglePanel,
                setMode: window.Framework?.setMode,
                getCurrentMode: window.Framework?.getCurrentMode
            };
            
            return context;
        }
        
        unregister(slotName, componentId) {
            if (this._slots.has(slotName)) {
                const slot = this._slots.get(slotName);
                const index = slot.findIndex(c => c.id === componentId);
                if (index !== -1) {
                    slot.splice(index, 1);
                }
            }
            
            // 解析插槽名称
            const resolvedSlotName = this._resolveSlotName(slotName);
            
            // 同步从 Framework 注销
            if (this._registeredToFramework.has(resolvedSlotName)) {
                this._registeredToFramework.get(resolvedSlotName).delete(componentId);
                try {
                    // 优先使用 unregisterUIComponent
                    if (window.Framework?.unregisterUIComponent) {
                        window.Framework.unregisterUIComponent(resolvedSlotName, componentId);
                    } else if (window.Framework?.unregisterPlugin) {
                        window.Framework.unregisterPlugin(resolvedSlotName, componentId);
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
        
        getSlot(slotName) {
            return this._slots.get(slotName) || [];
        }
        
        updateContext(newContext) {
            Object.assign(this._context, newContext);
            this._notifyUpdate();
            this._refreshAllSlots();
        }
        
        setContext(key, value) {
            this._context[key] = value;
            this._notifyUpdate();
            this._refreshAllSlots();
        }
        
        getContext() {
            return { ...this._context };
        }
        
        /**
         * 刷新所有已注册的插槽
         */
        _refreshAllSlots() {
            if (!window.Framework?.refreshSlot) return;
            
            for (const slotName of this._registeredToFramework.keys()) {
                try {
                    window.Framework.refreshSlot(slotName);
                } catch (e) {
                    // ignore
                }
            }
        }
        
        /**
         * 刷新指定插槽
         */
        refreshSlot(slotName) {
            if (window.Framework?.refreshSlot) {
                window.Framework.refreshSlot(slotName);
            }
        }
        
        renderSlot(slotName, container, additionalContext = {}) {
            if (!container) return;
            
            const components = this._slots.get(slotName) || [];
            const context = { ...this._context, ...additionalContext };
            
            container.innerHTML = '';
            
            for (const config of components) {
                // 检查可见性
                if (config.visible !== undefined) {
                    const isVisible = this._expr.resolve(config.visible, context);
                    if (!isVisible) continue;
                }
                
                // 创建组件
                const element = this._factory.create(
                    config.component || 'md-text',
                    config.props || {},
                    context
                );
                
                if (!element) continue;
                
                // 绑定点击事件
                if (config.onClick) {
                    element.addEventListener('click', async (e) => {
                        e.preventDefault();
                        await this._actions.execute(config.onClick, context);
                    });
                    element.style.cursor = 'pointer';
                }
                
                // 渲染动作按钮
                if (config.actions) {
                    this._renderActions(element, config.actions, context);
                }
                
                element.dataset.componentId = config.id;
                container.appendChild(element);
            }
        }
        
        _renderActions(parent, actions, context) {
            for (const [actionKey, actionConfig] of Object.entries(actions)) {
                if (actionConfig.visible !== undefined) {
                    const isVisible = this._expr.resolve(actionConfig.visible, context);
                    if (!isVisible) continue;
                }
                
                if (actionConfig.icon || actionConfig.text) {
                    const actionEl = this._factory.create('md-icon-button', {
                        icon: actionConfig.icon,
                        label: actionConfig.text,
                        title: actionConfig.title || actionConfig.label || actionKey,
                        class: actionConfig.class  // 传递自定义 class 给组件追加
                    }, context);
                    
                    if (actionEl) {
                        actionEl.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            await this._actions.execute(actionConfig.onClick || actionConfig, context);
                        });
                        parent.appendChild(actionEl);
                    }
                }
            }
        }
        
        onUpdate(callback) {
            this._updateCallbacks.add(callback);
            return () => this._updateCallbacks.delete(callback);
        }
        
        _notifyUpdate() {
            for (const callback of this._updateCallbacks) {
                try {
                    callback(this._context);
                } catch (e) {
                    console.error('[DeclarativeUI] Update callback error:', e);
                }
            }
        }
    }

    // ============================================================
    // 声明式设置管理器
    // ============================================================
    
    class DeclarativeSettingsManager {
        constructor(componentFactory) {
            this._plugins = new Map();
            this._factory = componentFactory;
        }
        
        register(pluginId, settingsConfig) {
            this._plugins.set(pluginId, settingsConfig);
            console.log(`[DeclarativeSettings] Registered settings for ${pluginId}`);
        }
        
        get(pluginId) {
            return this._plugins.get(pluginId) || null;
        }
        
        getAll() {
            return Object.fromEntries(this._plugins);
        }
        
        async renderForm(pluginId, container, currentValues = {}) {
            const config = this._plugins.get(pluginId);
            if (!config || !container) return;
            
            container.innerHTML = '';
            
            // Section 标题
            if (config.section) {
                const header = document.createElement('div');
                header.className = 'ido-settings-header';
                
                if (config.section.icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.className = 'material-symbols-outlined';
                    iconSpan.textContent = config.section.icon;
                    header.appendChild(iconSpan);
                }
                
                const title = document.createElement('h3');
                title.className = 'ido-settings-title';
                title.textContent = config.section.title || pluginId;
                header.appendChild(title);
                
                container.appendChild(header);
            }
            
            // 字段
            if (config.fields) {
                for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
                    const fieldEl = this._createField(fieldName, fieldConfig, currentValues[fieldName]);
                    if (fieldEl) container.appendChild(fieldEl);
                }
            }
        }
        
        _createField(name, config, value) {
            const wrapper = document.createElement('div');
            wrapper.className = 'ido-settings-field';
            wrapper.dataset.fieldName = name;
            
            const currentValue = value !== undefined ? value : config.default;
            
            // 字段类型映射到组件
            const fieldTypeMap = {
                select: () => this._factory.create('md-outlined-select', {
                    label: config.label || name,
                    value: currentValue,
                    options: config.options || []
                }),
                number: () => this._factory.create('md-outlined-text-field', {
                    type: 'number',
                    label: config.label || name,
                    value: currentValue,
                    min: config.min,
                    max: config.max,
                    step: config.step
                }),
                boolean: () => this._factory.create('md-switch', {
                    label: config.label || name,
                    checked: !!currentValue
                }),
                toggle: () => this._factory.create('md-switch', {
                    label: config.label || name,
                    checked: !!currentValue
                }),
                textarea: () => {
                    const textarea = document.createElement('textarea');
                    textarea.className = 'ido-textarea';
                    textarea.value = currentValue ?? '';
                    textarea.rows = config.rows || 3;
                    textarea.placeholder = config.placeholder || '';
                    return textarea;
                },
                text: () => this._factory.create('md-outlined-text-field', {
                    type: 'text',
                    label: config.label || name,
                    value: currentValue,
                    placeholder: config.placeholder
                })
            };
            
            const createFn = fieldTypeMap[config.type] || fieldTypeMap.text;
            const inputEl = createFn();
            
            if (inputEl) {
                wrapper.appendChild(inputEl);
            }
            
            // 提示文本
            if (config.hint) {
                const hint = document.createElement('p');
                hint.className = 'ido-field-hint';
                hint.textContent = config.hint;
                wrapper.appendChild(hint);
            }
            
            return wrapper;
        }
        
        collectValues(container) {
            const values = {};
            const fields = container.querySelectorAll('.ido-settings-field');
            
            for (const field of fields) {
                const name = field.dataset.fieldName;
                const input = field.querySelector('input, select, textarea');
                
                if (input) {
                    if (input.type === 'checkbox') {
                        values[name] = input.checked;
                    } else if (input.type === 'number') {
                        values[name] = input.value ? parseFloat(input.value) : null;
                    } else {
                        values[name] = input.value;
                    }
                }
            }
            
            return values;
        }
    }

    // ============================================================
    // 声明式 Channel 管理器
    // ============================================================
    
    class DeclarativeChannelManager {
        constructor() {
            this._channels = new Map();
        }
        
        register(channelId, config) {
            this._channels.set(channelId, config);
            
            if (config.extends) {
                this._createAdapter(channelId, config);
            }
            
            console.log(`[DeclarativeChannel] Registered ${channelId}`);
        }
        
        get(channelId) {
            return this._channels.get(channelId) || null;
        }
        
        _createAdapter(channelId, config) {
            const registry = window.IdoFront?.channelRegistry;
            if (!registry) {
                console.warn('[DeclarativeChannel] Channel registry not available');
                return;
            }
            
            const baseType = registry.getType(config.extends);
            if (!baseType) {
                console.warn(`[DeclarativeChannel] Base type not found: ${config.extends}`);
                return;
            }
            
            const adapter = {
                async call(messages, userConfig, onUpdate, signal) {
                    const mergedConfig = { ...config.defaults, ...userConfig };
                    return await baseType.adapter.call(messages, mergedConfig, onUpdate, signal);
                },
                
                async fetchModels(userConfig) {
                    const mergedConfig = { ...config.defaults, ...userConfig };
                    if (baseType.adapter.fetchModels) {
                        return await baseType.adapter.fetchModels(mergedConfig);
                    }
                    return [];
                }
            };
            
            registry.registerType(channelId, {
                adapter,
                label: config.label || channelId,
                defaults: config.defaults || {},
                capabilities: config.capabilities || { streaming: true, vision: false },
                source: 'declarative'
            });
        }
    }

    // ============================================================
    // 初始化和导出
    // ============================================================
    
    function initializeDeclarativeSystem() {
        // 创建核心实例
        const expressionEngine = new ExpressionEngine();
        expressionEngine.init();
        
        const componentFactory = new ComponentFactory(expressionEngine);
        const actionRegistry = new ActionRegistry(expressionEngine);
        
        // 注册 MD3 组件
        Object.entries(MD3Components).forEach(([name, factory]) => {
            componentFactory.register(name, factory);
        });
        
        // 注册内置动作
        Object.entries(BuiltinActions).forEach(([name, handler]) => {
            actionRegistry.register(name, handler);
        });
        
        // 创建管理器
        const declarativeUI = new DeclarativeUIManager(componentFactory, actionRegistry, expressionEngine);
        const declarativeSettings = new DeclarativeSettingsManager(componentFactory);
        const declarativeChannel = new DeclarativeChannelManager();
        
        // 导出
        window.IdoFront.expressionEngine = expressionEngine;
        window.IdoFront.componentFactory = componentFactory;
        window.IdoFront.actionSystem = actionRegistry;
        window.IdoFront.declarativeUI = declarativeUI;
        window.IdoFront.declarativeSettings = declarativeSettings;
        window.IdoFront.declarativeChannel = declarativeChannel;
        
        // 订阅 store 更新事件，自动刷新声明式 UI
        setupStoreSubscription(declarativeUI);
        
        console.log('[DeclarativeUIRenderer] Initialized with MD3 components');
    }
    
    /**
     * 设置 store 事件订阅
     * 当会话/渠道切换时自动刷新声明式 UI 组件
     */
    function setupStoreSubscription(declarativeUI) {
        // 延迟订阅，确保 store 已初始化
        const trySubscribe = () => {
            const store = window.IdoFront?.store;
            if (!store || !store.events) {
                // 重试
                setTimeout(trySubscribe, 500);
                return;
            }
            
            // 订阅 store 更新事件
            store.events.on('updated', () => {
                declarativeUI._refreshAllSlots();
            });
            
            // 订阅会话切换事件
            store.events.on('conversation:switched', () => {
                declarativeUI._refreshAllSlots();
            });
            
            // 订阅渠道切换事件
            store.events.on('channel:selected', () => {
                declarativeUI._refreshAllSlots();
            });
            
            console.log('[DeclarativeUIRenderer] Subscribed to store events');
        };
        
        // 使用 setTimeout 延迟，避免阻塞初始化
        setTimeout(trySubscribe, 100);
    }

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDeclarativeSystem);
    } else {
        initializeDeclarativeSystem();
    }

})();