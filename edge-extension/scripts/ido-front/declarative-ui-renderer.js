/**
 * Declarative UI Renderer
 * 声明式 UI 渲染器 - 主线程直接执行，无需沙箱
 * 
 * 使用工厂模式和 MD3 规范
 * 
 * 依赖模块：
 * - declarative/components.js (DeclarativeComponents)
 * - declarative/ui-manager.js (DeclarativeUIManager)
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
    // 组件工厂
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
            const store = window.IdoFront?.store;
            if (store?.events?.emit) {
                store.events.emit(action.event, action.data);
            } else {
                window.dispatchEvent(new CustomEvent(action.event, { detail: action.data }));
            }
        }
    };

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
                header.className = 'ido-panel__header';
                
                if (config.section.icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.className = 'material-symbols-outlined';
                    iconSpan.textContent = config.section.icon;
                    header.appendChild(iconSpan);
                }
                
                const title = document.createElement('h3');
                title.className = 'ido-panel__title';
                title.textContent = config.section.title || pluginId;
                header.appendChild(title);
                
                container.appendChild(header);
            }
            
            // 字段
            if (config.fields && typeof DeclarativeComponents !== 'undefined') {
                for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
                    const fieldEl = DeclarativeComponents.createSettingsField(
                        fieldName, 
                        fieldConfig, 
                        currentValues[fieldName],
                        (newValue) => {
                            currentValues[fieldName] = newValue;
                        }
                    );
                    if (fieldEl) container.appendChild(fieldEl);
                }
            }
        }
        
        collectValues(container) {
            const values = {};
            const fields = container.querySelectorAll('.ido-form-group');
            
            for (const field of fields) {
                const name = field.dataset.fieldName;
                const input = field.querySelector('input, select, textarea');
                
                if (input && name) {
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
    
    function waitForModules() {
        return new Promise((resolve) => {
            const check = () => {
                if (
                    typeof DeclarativeComponents !== 'undefined' &&
                    typeof DeclarativeUIManager !== 'undefined'
                ) {
                    resolve();
                } else {
                    setTimeout(check, 10);
                }
            };
            check();
        });
    }
    
    async function initializeDeclarativeSystem() {
        // 等待依赖模块加载
        await waitForModules();
        
        // 创建核心实例
        const expressionEngine = new ExpressionEngine();
        expressionEngine.init();
        
        const componentFactory = new ComponentFactory(expressionEngine);
        const actionRegistry = new ActionRegistry(expressionEngine);
        
        // 注册组件（从 DeclarativeComponents 模块）
        Object.entries(DeclarativeComponents.components).forEach(([name, factory]) => {
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
        
        // 订阅 store 更新事件
        setupStoreSubscription(declarativeUI);
        
        console.log('[DeclarativeUIRenderer] Initialized');
    }
    
    /**
     * 设置 store 事件订阅
     */
    function setupStoreSubscription(declarativeUI) {
        const trySubscribe = () => {
            const store = window.IdoFront?.store;
            if (!store || !store.events) {
                setTimeout(trySubscribe, 500);
                return;
            }
            
            store.events.on('updated', () => {
                declarativeUI._refreshAllSlots();
            });
            
            store.events.on('conversation:switched', () => {
                declarativeUI._refreshAllSlots();
            });
            
            store.events.on('channel:selected', () => {
                declarativeUI._refreshAllSlots();
            });
            
            console.log('[DeclarativeUIRenderer] Subscribed to store events');
        };
        
        setTimeout(trySubscribe, 100);
    }

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDeclarativeSystem);
    } else {
        initializeDeclarativeSystem();
    }

})();