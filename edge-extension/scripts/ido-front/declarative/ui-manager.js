/**
 * 声明式 UI 管理器
 * 负责组件注册、渲染、上下文管理
 */
const DeclarativeUIManager = (function() {
    'use strict';

    class UIManager {
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
            
            // 桥接到 Framework.registerUIComponent
            this._registerToFramework(slotName, componentId, fullConfig);
            
            console.log(`[DeclarativeUI] Registered ${componentId} to ${slotName}`);
        }
        
        /**
         * 向 Framework 注册 UI 组件
         */
        _registerToFramework(slotName, componentId, config) {
            if (typeof window.Framework === 'undefined') {
                console.warn('[DeclarativeUI] Framework not available, skipping bridge');
                return;
            }
            
            const useUIComponent = typeof window.Framework.registerUIComponent === 'function';
            const resolvedSlotName = this._resolveSlotName(slotName);
            
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
                    window.Framework.registerUIComponent(resolvedSlotName, componentId, renderFn);
                } else if (window.Framework.registerPlugin) {
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
            const context = this._buildRenderContext(frameworkApi);
            
            // 注入 pluginId
            if (config.pluginId) {
                context.pluginId = config.pluginId;
            }
            
            // 检查可见性
            if (config.visible !== undefined) {
                const isVisible = this._expr.resolve(config.visible, context);
                if (!isVisible) {
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
            const context = { ...this._context };
            
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
            
            context.framework = {
                togglePanel: window.Framework?.togglePanel,
                setMode: window.Framework?.setMode,
                getCurrentMode: window.Framework?.getCurrentMode
            };
            
            return context;
        }
        
        /**
         * 注销组件
         */
        unregister(slotName, componentId) {
            if (this._slots.has(slotName)) {
                const slot = this._slots.get(slotName);
                const index = slot.findIndex(c => c.id === componentId);
                if (index !== -1) {
                    slot.splice(index, 1);
                }
            }
            
            const resolvedSlotName = this._resolveSlotName(slotName);
            
            if (this._registeredToFramework.has(resolvedSlotName)) {
                this._registeredToFramework.get(resolvedSlotName).delete(componentId);
                try {
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
        
        /**
         * 获取插槽中的组件列表
         */
        getSlot(slotName) {
            return this._slots.get(slotName) || [];
        }
        
        /**
         * 更新上下文（批量）
         */
        updateContext(newContext) {
            Object.assign(this._context, newContext);
            this._notifyUpdate();
            this._refreshAllSlots();
        }
        
        /**
         * 设置上下文值
         */
        setContext(key, value) {
            this._context[key] = value;
            this._notifyUpdate();
            this._refreshAllSlots();
        }
        
        /**
         * 获取上下文副本
         */
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
        
        /**
         * 渲染插槽到容器
         */
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
        
        /**
         * 渲染动作按钮
         */
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
                        class: actionConfig.class
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
        
        /**
         * 注册更新回调
         */
        onUpdate(callback) {
            this._updateCallbacks.add(callback);
            return () => this._updateCallbacks.delete(callback);
        }
        
        /**
         * 通知更新
         */
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

    return UIManager;
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.DeclarativeUIManager = DeclarativeUIManager;
}
window.DeclarativeUIManager = DeclarativeUIManager;