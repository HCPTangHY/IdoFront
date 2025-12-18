/**
 * 插件系统模块
 * 负责插件注册、管理和渲染
 */
const FrameworkPlugins = (function() {
    'use strict';

    // 插槽名称常量
    const SLOTS = {
        SIDEBAR_TOP: 'slot-sidebar-top',
        SIDEBAR_BOTTOM: 'slot-sidebar-bottom',
        HEADER_ACTIONS: 'slot-header-actions',
        INPUT_TOP: 'slot-input-top',
        INPUT_ACTIONS_LEFT: 'slot-input-actions-left',
        INPUT_ACTIONS_RIGHT: 'slot-input-actions-right',
        INPUT_ACTIONS_TOOLS: 'slot-input-actions-tools',
        MESSAGE_FOOTER: 'message-footer',
        MESSAGE_MORE_ACTIONS: 'message-more-actions',
        SETTINGS_GENERAL: 'slot-settings-general'
    };

    // 插件注册表
    const registry = {};
    
    // 纯 UI 组件注册表（与插件分开）
    const uiComponents = {};

    // 公共 API 引用（稍后由 core 模块注入）
    let publicApi = null;

    /**
     * 设置公共 API 引用
     */
    function setPublicApi(api) {
        publicApi = api;
    }

    // ================== UI 组件 ==================

    /**
     * 注册纯 UI 组件
     */
    function registerUIComponent(slotName, id, renderFn) {
        if (!uiComponents[slotName]) uiComponents[slotName] = [];

        const existing = uiComponents[slotName].findIndex(c => c.id === id);
        const component = {
            id,
            enabled: true,
            render: renderFn
        };

        if (existing !== -1) {
            uiComponents[slotName][existing] = component;
        } else {
            uiComponents[slotName].push(component);
        }

        setTimeout(() => refreshSlot(slotName), 0);
    }

    /**
     * 注销 UI 组件
     */
    function unregisterUIComponent(slotName, id) {
        if (!uiComponents[slotName]) return;
        uiComponents[slotName] = uiComponents[slotName].filter(c => c.id !== id);
        refreshSlot(slotName);
    }

    /**
     * 批量注册纯 UI 组件包
     */
    function registerUIBundle(bundleId, definition) {
        if (!bundleId || !definition || !definition.slots) {
            console.error('registerUIBundle: Invalid arguments', { bundleId, definition });
            return;
        }

        const initFn = definition.init || null;
        const destroyFn = definition.destroy || null;

        if (typeof initFn === 'function') {
            try {
                initFn(publicApi);
            } catch (e) {
                console.error(`UIBundle init error [${bundleId}]:`, e);
            }
        }

        const slotEntries = parseSlotDefinition(bundleId, definition.slots);

        if (slotEntries.length === 0) {
            console.warn(`registerUIBundle: No valid slots found for bundle "${bundleId}"`);
            return;
        }

        slotEntries.forEach((entry) => {
            registerUIComponent(entry.slotName, entry.id, entry.render);
        });

        if (!uiComponents._bundles) {
            uiComponents._bundles = {};
        }
        uiComponents._bundles[bundleId] = {
            entries: slotEntries.map(e => ({ slot: e.slotName, id: e.id })),
            destroy: destroyFn
        };
    }

    /**
     * 注销整个 UI 组件包
     */
    function unregisterUIBundle(bundleId) {
        if (!uiComponents._bundles || !uiComponents._bundles[bundleId]) {
            console.warn(`unregisterUIBundle: Bundle "${bundleId}" not found`);
            return;
        }

        const bundle = uiComponents._bundles[bundleId];

        if (typeof bundle.destroy === 'function') {
            try {
                bundle.destroy(publicApi);
            } catch (e) {
                console.error(`UIBundle destroy error [${bundleId}]:`, e);
            }
        }

        bundle.entries.forEach(({ slot, id }) => {
            unregisterUIComponent(slot, id);
        });

        delete uiComponents._bundles[bundleId];
    }

    // ================== 插件 ==================

    /**
     * 注册插件
     */
    function registerPlugin(slotName, id, definition) {
        if (!registry[slotName]) registry[slotName] = [];

        let plugin;
        if (typeof definition === 'function' || definition == null) {
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
                    tags: undefined,
                    listable: false
                }
            };
        } else {
            const meta = definition.meta || {};
            const isCore = id.startsWith('core-');
            const listable = meta.listable !== undefined
                ? meta.listable
                : (isCore || meta.bundleId !== undefined);

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
                    tags: meta.tags || definition.tags || undefined,
                    bundleId: meta.bundleId || undefined,
                    listable: listable
                }
            };
        }

        if (typeof plugin.init === 'function') {
            try {
                plugin.init(publicApi);
            } catch (e) {
                console.error(`Plugin init error in ${slotName}/${id}:`, e);
            }
        }

        registry[slotName].push(plugin);
        setTimeout(() => refreshSlot(slotName), 0);
    }

    /**
     * 注销插件
     */
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

    /**
     * 批量注册插件包
     */
    function registerPluginBundle(bundleId, definition) {
        if (!bundleId || !definition || !definition.slots) {
            console.error('registerPluginBundle: Invalid arguments', { bundleId, definition });
            return;
        }

        const meta = definition.meta || {};
        const initFn = definition.init || null;
        const destroyFn = definition.destroy || null;

        let initCalled = false;
        const callInitOnce = () => {
            if (!initCalled && typeof initFn === 'function') {
                initCalled = true;
                try {
                    initFn(publicApi);
                } catch (e) {
                    console.error(`PluginBundle init error [${bundleId}]:`, e);
                }
            }
        };

        const slotEntries = parseSlotDefinition(bundleId, definition.slots);

        if (slotEntries.length === 0) {
            console.warn(`registerPluginBundle: No valid slots found for bundle "${bundleId}"`);
            return;
        }

        slotEntries.forEach((entry, index) => {
            const isLast = index === slotEntries.length - 1;

            const pluginDef = {
                meta: {
                    ...meta,
                    id: entry.id,
                    bundleId: bundleId,
                    source: meta.source || 'bundle'
                },
                render: entry.render,
                init: index === 0 ? callInitOnce : null,
                destroy: isLast ? destroyFn : null
            };

            registerPlugin(entry.slotName, entry.id, pluginDef);
        });

        if (!registry._bundles) {
            registry._bundles = {};
        }
        registry._bundles[bundleId] = slotEntries.map(e => ({ slot: e.slotName, id: e.id }));
    }

    /**
     * 注销整个插件包
     */
    function unregisterPluginBundle(bundleId) {
        if (!registry._bundles || !registry._bundles[bundleId]) {
            console.warn(`unregisterPluginBundle: Bundle "${bundleId}" not found`);
            return;
        }

        const entries = registry._bundles[bundleId];
        entries.forEach(({ slot, id }) => {
            unregisterPlugin(slot, id);
        });

        delete registry._bundles[bundleId];
    }

    /**
     * 设置插件启用状态
     */
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

    /**
     * 获取已注册的插件列表
     */
    function getPlugins(options = {}) {
        const all = [];
        const bundlesSeen = new Set();
        const returnAll = options.all === true;

        Object.keys(registry).forEach(slot => {
            if (slot === '_bundles') return;
            if (!Array.isArray(registry[slot])) return;

            registry[slot].forEach(p => {
                const meta = p.meta || {};
                const bundleId = meta.bundleId;

                if (bundleId) {
                    if (bundlesSeen.has(bundleId)) return;
                    bundlesSeen.add(bundleId);

                    if (!returnAll && meta.listable === false) return;

                    all.push({
                        slot,
                        id: bundleId,
                        enabled: p.enabled,
                        meta: {
                            ...meta,
                            id: bundleId,
                            isBundle: true,
                            listable: true
                        }
                    });
                } else {
                    if (!returnAll && !meta.listable) return;

                    all.push({
                        slot,
                        id: p.id,
                        enabled: p.enabled,
                        meta: meta
                    });
                }
            });
        });
        return all;
    }

    // ================== 插槽渲染 ==================

    /**
     * 刷新静态插槽
     */
    function refreshSlot(slotName) {
        const el = document.getElementById(slotName);
        if (!el) return;

        el.innerHTML = '';

        // 渲染 UI 组件
        const components = uiComponents[slotName] || [];
        components.forEach(component => {
            if (!component || component.enabled === false) return;
            if (typeof component.render !== 'function') return;
            try {
                const content = component.render(publicApi);
                if (content instanceof HTMLElement) {
                    el.appendChild(content);
                } else if (typeof content === 'string') {
                    el.insertAdjacentHTML('beforeend', content);
                }
            } catch (e) {
                console.error(`UI component error in ${slotName}/${component.id}:`, e);
            }
        });

        // 渲染插件
        const plugins = registry[slotName] || [];
        plugins.forEach(plugin => {
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

        el.classList.toggle('hidden', el.childNodes.length === 0);

    }

    /**
     * 获取动态插件渲染结果
     */
    function getDynamicPlugins(slotName, context) {
        const results = [];

        // UI 组件
        const components = uiComponents[slotName] || [];
        components.forEach(component => {
            if (!component || component.enabled === false) return;
            if (typeof component.render !== 'function') return;
            try {
                const content = component.render(context || publicApi);
                if (content) results.push(content);
            } catch (e) {
                console.error(`Dynamic UI component error ${slotName}/${component.id}:`, e);
            }
        });

        // 插件
        const plugins = registry[slotName] || [];
        plugins.forEach(plugin => {
            if (!plugin || plugin.enabled === false) return;
            const renderer = plugin.renderDynamic || plugin.renderStatic;
            if (typeof renderer !== 'function') return;
            try {
                const content = renderer(context || publicApi);
                if (content) results.push(content);
            } catch (e) {
                console.error(`Dynamic plugin error ${slotName}/${plugin.id}:`, e);
            }
        });

        return results;
    }

    // ================== 辅助函数 ==================

    /**
     * 解析插槽定义
     */
    function parseSlotDefinition(bundleId, slots) {
        const entries = [];

        if (Array.isArray(slots)) {
            slots.forEach((item, index) => {
                if (!item.slot || typeof item.render !== 'function') {
                    console.warn(`parseSlotDefinition: Invalid slot entry at index ${index}`, item);
                    return;
                }
                entries.push({
                    slotName: item.slot,
                    id: item.id || `${bundleId}-${index}`,
                    render: item.render
                });
            });
        } else if (typeof slots === 'object') {
            Object.keys(slots).forEach((slotName) => {
                const slotDef = slots[slotName];

                if (typeof slotDef === 'function') {
                    entries.push({
                        slotName,
                        id: `${bundleId}-${slotName.replace(/[^a-zA-Z0-9]/g, '-')}`,
                        render: slotDef
                    });
                } else if (Array.isArray(slotDef)) {
                    slotDef.forEach((item, itemIndex) => {
                        if (typeof item === 'function') {
                            entries.push({
                                slotName,
                                id: `${bundleId}-${slotName.replace(/[^a-zA-Z0-9]/g, '-')}-${itemIndex}`,
                                render: item
                            });
                        } else if (item && typeof item.render === 'function') {
                            entries.push({
                                slotName,
                                id: item.id || `${bundleId}-${slotName.replace(/[^a-zA-Z0-9]/g, '-')}-${itemIndex}`,
                                render: item.render
                            });
                        }
                    });
                } else if (slotDef && typeof slotDef.render === 'function') {
                    entries.push({
                        slotName,
                        id: slotDef.id || `${bundleId}-${slotName.replace(/[^a-zA-Z0-9]/g, '-')}`,
                        render: slotDef.render
                    });
                }
            });
        }

        return entries;
    }

    return {
        SLOTS,
        setPublicApi,
        registerUIComponent,
        unregisterUIComponent,
        registerUIBundle,
        unregisterUIBundle,
        registerPlugin,
        unregisterPlugin,
        registerPluginBundle,
        unregisterPluginBundle,
        setPluginEnabled,
        getPlugins,
        refreshSlot,
        getDynamicPlugins,
        // 暴露注册表供调试
        registry,
        uiComponents
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkPlugins = FrameworkPlugins;
}