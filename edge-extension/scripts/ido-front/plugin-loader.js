/**
 * External Plugin Loader - Comlink 版本
 * 负责管理外部插件的加载和执行
 * 
 * 使用 Comlink 进行主线程与沙箱之间的 RPC 通信
 * 
 * 此加载器负责：
 * 1. 加载和管理插件生命周期
 * 2. 与沙箱通信处理 Channel adapter 调用
 * 3. 管理插件资源（Channel、UI 组件等）
 */
(function() {
    'use strict';
    
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.pluginLoader = window.IdoFront.pluginLoader || {};

    const channelRegistry = window.IdoFront.channelRegistry;
    const pluginResources = new Map(); // pluginId -> { channelTypes: Set, uiComponents: Map, styleElement: HTMLStyleElement }
    
    // 沙箱状态
    let sandboxFrame = null;
    let sandboxInitialized = false;

    let context = null;
    let store = null;
    const loadedPlugins = new Map();
    const runtimeHandles = new Map();

    // ============================================================
    // 资源管理
    // ============================================================
    
    function ensureResourceBucket(pluginId) {
        if (!pluginId) return null;
        if (!pluginResources.has(pluginId)) {
            pluginResources.set(pluginId, {
                channelTypes: new Set(),
                uiComponents: new Map(),
                styleElement: null
            });
        }
        return pluginResources.get(pluginId);
    }

    /**
     * 追踪插件注册的 Channel 类型
     * 暴露给 comlink-bridge 使用
     */
    function trackChannelType(pluginId, typeId) {
        const bucket = ensureResourceBucket(pluginId);
        if (bucket) bucket.channelTypes.add(typeId);
    }
    
    // 暴露给 comlink-bridge
    window.IdoFront.pluginLoader.trackChannelType = trackChannelType;

    /**
     * 注入插件 CSS 样式
     * @param {string} pluginId
     * @param {Object} stylesConfig - { css: string, scoped: boolean }
     */
    function injectPluginStyles(pluginId, stylesConfig) {
        if (!stylesConfig || !stylesConfig.css) return;

        const bucket = ensureResourceBucket(pluginId);
        
        // 移除旧的样式（如果存在）
        if (bucket.styleElement) {
            bucket.styleElement.remove();
            bucket.styleElement = null;
        }

        let css = stylesConfig.css;

        // 如果是 scoped 模式，为所有选择器添加插件 ID 前缀
        if (stylesConfig.scoped) {
            css = scopeCSS(css, pluginId);
        }

        const styleElement = document.createElement('style');
        styleElement.setAttribute('data-plugin', pluginId);
        styleElement.textContent = css;
        document.head.appendChild(styleElement);

        bucket.styleElement = styleElement;
        console.info(`[PluginLoader] Injected CSS for plugin: ${pluginId}`);
    }

    /**
     * 为 CSS 添加作用域前缀
     * @param {string} css
     * @param {string} pluginId
     * @returns {string}
     */
    function scopeCSS(css, pluginId) {
        const scopeAttr = `[data-plugin-scope="${pluginId}"]`;
        
        // 简单的 CSS 选择器前缀添加
        // 处理规则块: selector { ... }
        return css.replace(/([^\{\}]+)\{/g, (match, selectors) => {
            // 跳过 @规则（如 @keyframes, @media）
            if (selectors.trim().startsWith('@')) {
                return match;
            }
            
            // 为每个选择器添加前缀
            const scopedSelectors = selectors
                .split(',')
                .map(selector => {
                    selector = selector.trim();
                    if (!selector) return selector;
                    
                    // 对于 :root, html, body 等特殊选择器，使用后代选择器
                    if (/^(:root|html|body|\*)/.test(selector)) {
                        return `${scopeAttr} ${selector.replace(/^(:root|html|body|\*)/, '')}`.trim() || scopeAttr;
                    }
                    
                    return `${scopeAttr} ${selector}`;
                })
                .join(', ');
            
            return `${scopedSelectors} {`;
        });
    }

    /**
     * 移除插件 CSS 样式
     * @param {string} pluginId
     */
    function removePluginStyles(pluginId) {
        const bucket = pluginResources.get(pluginId);
        if (bucket?.styleElement) {
            bucket.styleElement.remove();
            bucket.styleElement = null;
            console.info(`[PluginLoader] Removed CSS for plugin: ${pluginId}`);
        }
    }

    /**
     * 释放插件注册的所有资源
     */
    async function releasePluginResources(pluginId) {
        const bucket = pluginResources.get(pluginId);
        if (!bucket) return;

        // 清理 CSS 样式
        removePluginStyles(pluginId);

        // 清理 Channel 类型
        if (channelRegistry) {
            bucket.channelTypes.forEach(typeId => {
                try {
                    channelRegistry.unregisterType(typeId, { source: `plugin:${pluginId}` });
                    console.log(`[PluginLoader] Unregistered channel: ${typeId}`);
                } catch (error) {
                    console.warn(`[PluginLoader] Failed to unregister channel ${typeId}:`, error);
                }
            });
        }
        bucket.channelTypes.clear();
        
        // 清理声明式 UI 组件
        if (bucket.uiComponents && window.IdoFront.declarativeUI) {
            bucket.uiComponents.forEach((componentIds, slotName) => {
                componentIds.forEach(compId => {
                    try {
                        window.IdoFront.declarativeUI.unregister(slotName, compId);
                        console.log(`[PluginLoader] Unregistered UI component: ${slotName}:${compId}`);
                    } catch (error) {
                        console.warn(`[PluginLoader] Failed to unregister UI ${slotName}:${compId}:`, error);
                    }
                });
            });
            bucket.uiComponents.clear();
        }
        
        pluginResources.delete(pluginId);
        
        // 通知沙箱停止插件
        const bridge = window.IdoFront.comlinkBridge;
        if (bridge && bridge.isInitialized()) {
            try {
                await bridge.stopPlugin(pluginId);
                console.log(`[PluginLoader] Stopped plugin in sandbox: ${pluginId}`);
            } catch (e) {
                console.warn(`[PluginLoader] Failed to stop plugin in sandbox:`, e);
            }
        }
    }

    // ============================================================
    // 元数据解析
    // ============================================================

    /**
     * 解析插件代码中的元数据注释
     */
    window.IdoFront.pluginLoader.parseMetadata = function(code) {
        const meta = {
            name: '',
            version: '1.0.0',
            description: '',
            author: '',
            homepage: '',
            icon: ''
        };

        if (!code) return meta;

        const lineRegex = /^\s*\/\/\s*@([\w-]+)\s+(.+)$/gm;
        let match;
        while ((match = lineRegex.exec(code)) !== null) {
            const key = match[1].trim().toLowerCase();
            const value = match[2].trim();

            switch (key) {
                case 'name': meta.name = value; break;
                case 'version': if (value) meta.version = value; break;
                case 'description':
                case 'desc': meta.description = value; break;
                case 'author': meta.author = value; break;
                case 'homepage':
                case 'home':
                case 'url': meta.homepage = value; break;
                case 'icon': meta.icon = value; break;
            }
        }

        return meta;
    };

    // ============================================================
    // 初始化
    // ============================================================

    /**
     * 初始化插件加载器
     */
    window.IdoFront.pluginLoader.init = async function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        
        // 将 store 暴露给 comlink-bridge
        window.IdoFront.store = storeInstance;
    
        console.info('[PluginLoader] Initializing...');
        await initSandbox();
        await loadStoredPlugins();
        attachStoreListeners();
        console.info('[PluginLoader] Ready');
    };

    /**
     * 初始化沙箱 iframe 和 Comlink 桥接
     */
    async function initSandbox() {
        return new Promise((resolve, reject) => {
            const existing = document.getElementById('ido-plugin-sandbox');
            if (existing) {
                sandboxFrame = existing;
                initComlinkBridge(existing).then(resolve).catch(reject);
                return;
            }

            const iframe = document.createElement('iframe');
            iframe.src = 'sandbox.html';
            iframe.style.display = 'none';
            iframe.id = 'ido-plugin-sandbox';
            document.body.appendChild(iframe);

            iframe.onload = async () => {
                sandboxFrame = iframe;
                console.info('[PluginLoader] Sandbox iframe loaded');
                
                try {
                    await initComlinkBridge(iframe);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };
            
            iframe.onerror = (error) => {
                console.error('[PluginLoader] Sandbox iframe failed to load:', error);
                reject(error);
            };
        });
    }
    
    /**
     * 初始化 Comlink 桥接
     */
    async function initComlinkBridge(iframe) {
        const bridge = window.IdoFront.comlinkBridge;
        if (!bridge) {
            throw new Error('ComlinkBridge not available');
        }
        
        await bridge.init(iframe);
        sandboxInitialized = true;
        console.info('[PluginLoader] Comlink bridge initialized');
    }

    // ============================================================
    // 插件加载
    // ============================================================

    /**
     * 加载存储的插件
     */
    async function loadStoredPlugins() {
        const plugins = await window.IdoFront.storage.getAllPlugins();
        if (!plugins || plugins.length === 0) return;
    
        console.info(`[PluginLoader] Restoring ${plugins.length} external plugins`);
    
        for (const plugin of plugins) {
            loadedPlugins.set(plugin.id, plugin);
            if (plugin.enabled) {
                await tryRunPlugin(plugin);
            }
        }
    }

    /**
     * 尝试运行插件
     */
    async function tryRunPlugin(plugin) {
        if (!sandboxInitialized) {
            console.warn('[PluginLoader] Sandbox not ready');
            return;
        }
        
        // 混合格式插件
        if (plugin.format === 'hybrid') {
            await tryRunHybridPlugin(plugin);
            return;
        }
        
        // 纯 JS 插件
        const bridge = window.IdoFront.comlinkBridge;
        try {
            const result = await bridge.executePlugin(plugin.id, plugin.code);
            runtimeHandles.set(plugin.id, true);
            
            if (result.success) {
                console.info(`[PluginLoader] Plugin executed: ${plugin.name}`);
            } else {
                console.error(`[PluginLoader] Plugin failed: ${plugin.name}`, result.error);
                window.IdoFront.pluginLoader.lastError = {
                    pluginId: plugin.id,
                    pluginName: plugin.name,
                    message: result.error?.message,
                    stack: result.error?.stack
                };
            }
        } catch (error) {
            console.error(`[PluginLoader] Failed to execute ${plugin.name}:`, error);
            window.IdoFront.pluginLoader.lastError = {
                pluginId: plugin.id,
                pluginName: plugin.name,
                message: error.message,
                stack: error.stack
            };
        }
    }
    
    /**
     * 运行混合格式插件
     */
    async function tryRunHybridPlugin(plugin) {
        const hybridParser = window.IdoFront.hybridParser;
        if (!hybridParser) {
            console.warn('[PluginLoader] Hybrid parser not available');
            return;
        }
        
        try {
            const parsed = hybridParser.parse(plugin.code);
            const normalized = hybridParser.normalize(parsed);
            await executeHybridPlugin(plugin.id, normalized);
        } catch (error) {
            console.error(`[PluginLoader] Failed to execute hybrid plugin ${plugin.id}:`, error);
        }
    }
        
    /**
     * 加载混合格式插件
     */
    window.IdoFront.pluginLoader.addHybridPlugin = async function(yamlContent, meta = {}) {
        const hybridParser = window.IdoFront.hybridParser;
        if (!hybridParser) {
            throw new Error('Hybrid parser not available');
        }
        
        const parsed = hybridParser.parse(yamlContent);
        const validation = hybridParser.validate(parsed);
        
        if (!validation.valid) {
            throw new Error(`Plugin validation failed: ${validation.errors.join(', ')}`);
        }
        
        const normalized = hybridParser.normalize(parsed);
        const now = new Date().toISOString();
        const pluginId = meta.id || normalized.id;
        
        // 如果已存在同 ID 的插件，先停止并清理旧插件资源
        const existingPlugin = loadedPlugins.get(pluginId);
        if (existingPlugin) {
            console.info(`[PluginLoader] Replacing existing plugin: ${pluginId}`);
            await stopPlugin(pluginId);
        }
        
        const plugin = {
            id: pluginId,
            name: meta.name || normalized.name,
            code: yamlContent,
            format: 'hybrid',
            enabled: meta.enabled ?? true,
            version: meta.version || normalized.version,
            description: meta.description || normalized.description,
            author: meta.author || normalized.author,
            homepage: meta.homepage || normalized.homepage,
            icon: meta.icon || normalized.icon,
            createdAt: existingPlugin?.createdAt || meta.createdAt || now,
            updatedAt: now,
            source: 'external'
        };
        
        await window.IdoFront.storage.savePlugin(plugin);
        loadedPlugins.set(pluginId, plugin);
        
        if (plugin.enabled) {
            await executeHybridPlugin(pluginId, normalized);
        }
        
        return pluginId;
    };
    
    /**
     * 执行混合格式插件
     */
    async function executeHybridPlugin(pluginId, normalized) {
        const hybridParser = window.IdoFront.hybridParser;
        const bridge = window.IdoFront.comlinkBridge;
        
        console.info(`[PluginLoader] Executing hybrid plugin: ${pluginId}`, {
            hasUI: !!normalized.ui,
            uiSlots: normalized.ui ? Object.keys(normalized.ui) : [],
            hasStyles: !!normalized.styles,
            hasScript: !!normalized.script,
            hasChannel: !!normalized.channel
        });
        
        // 0. 注入 CSS 样式（主线程直接执行）
        if (normalized.styles) {
            injectPluginStyles(pluginId, normalized.styles);
        }
        
        // 1. 注册声明式 UI（主线程直接执行）
        if (normalized.ui && window.IdoFront.declarativeUI) {
            Object.keys(normalized.ui).forEach(slotName => {
                const components = normalized.ui[slotName];
                components.forEach(comp => {
                    const compWithPluginId = {
                        ...comp,
                        pluginId: pluginId,
                        props: { ...comp.props, pluginId: pluginId }
                    };
                    window.IdoFront.declarativeUI.register(slotName, comp.id, compWithPluginId);
                    
                    const bucket = ensureResourceBucket(pluginId);
                    if (!bucket.uiComponents.has(slotName)) {
                        bucket.uiComponents.set(slotName, new Set());
                    }
                    bucket.uiComponents.get(slotName).add(comp.id);
                });
            });
            console.info(`[PluginLoader] Declarative UI registered for ${pluginId}`);
        }
        
        // 2. JS 脚本发送到沙箱执行
        if (normalized.script) {
            const sandboxCode = hybridParser.generateSandboxCode(normalized);
            
            if (!bridge || !bridge.isInitialized()) {
                console.warn('[PluginLoader] Sandbox not ready for hybrid plugin script');
                return;
            }
            
            try {
                const result = await bridge.executePlugin(pluginId, sandboxCode, {
                    id: normalized.id,
                    name: normalized.name,
                    version: normalized.version,
                    channel: normalized.channel,
                    settings: normalized.settings
                });
                
                runtimeHandles.set(pluginId, true);
                
                if (result.success) {
                    console.info(`[PluginLoader] Hybrid plugin script executed: ${pluginId}`);
                } else {
                    console.error(`[PluginLoader] Hybrid plugin script failed: ${pluginId}`, result.error);
                }
            } catch (error) {
                console.error(`[PluginLoader] Failed to execute hybrid plugin script: ${pluginId}`, error);
            }
        } else if (normalized.channel?.extends) {
            // 3. 纯声明式 Channel
            if (window.IdoFront.declarativeChannel) {
                const channelId = normalized.channel.type || pluginId;
                window.IdoFront.declarativeChannel.register(channelId, normalized.channel);
                trackChannelType(pluginId, channelId);
                console.info(`[PluginLoader] Declarative channel registered: ${channelId}`);
            }
        }
    }
    
    /**
     * 添加纯 JS 插件
     */
    window.IdoFront.pluginLoader.addPlugin = async function(name, code, meta = {}) {
        const id = meta.id || `ext-${Date.now()}`;
        const now = new Date().toISOString();
        const parsedMeta = window.IdoFront.pluginLoader.parseMetadata(code);
        
        // 如果已存在同 ID 的插件，先停止并清理旧插件资源
        const existingPlugin = loadedPlugins.get(id);
        if (existingPlugin) {
            console.info(`[PluginLoader] Replacing existing plugin: ${id}`);
            await stopPlugin(id);
        }
        
        const plugin = {
            id,
            name: name || parsedMeta.name || id,
            code,
            enabled: meta.enabled ?? true,
            version: meta.version || parsedMeta.version || '1.0.0',
            description: meta.description || parsedMeta.description || '',
            author: meta.author || parsedMeta.author || '',
            homepage: meta.homepage || parsedMeta.homepage || '',
            icon: meta.icon || parsedMeta.icon || '',
            createdAt: existingPlugin?.createdAt || meta.createdAt || now,
            updatedAt: now,
            source: 'external'
        };
    
        await window.IdoFront.storage.savePlugin(plugin);
        loadedPlugins.set(id, plugin);
    
        if (plugin.enabled) {
            await tryRunPlugin(plugin);
        }
    
        return id;
    };

    /**
     * 更新插件
     */
    window.IdoFront.pluginLoader.updatePlugin = async function(id, patch) {
        const plugin = await window.IdoFront.storage.getPlugin(id);
        if (!plugin) throw new Error('Plugin not found');
    
        const next = {
            ...plugin,
            ...patch,
            source: plugin.source || 'external',
            updatedAt: new Date().toISOString()
        };
    
        await window.IdoFront.storage.savePlugin(next);
        loadedPlugins.set(id, next);
    
        if (next.enabled) {
            await restartPlugin(next.id);
        } else {
            await stopPlugin(next.id);
        }
    };

    /**
     * 切换插件启用状态
     */
    window.IdoFront.pluginLoader.togglePlugin = async function(id, enabled) {
        const inMemory = loadedPlugins.get(id);
        if (inMemory?.source === 'builtin') {
            inMemory.enabled = enabled;
            loadedPlugins.set(id, inMemory);
            if (enabled) await restartPlugin(id);
            else await stopPlugin(id);
            return;
        }
    
        const plugin = await window.IdoFront.storage.getPlugin(id);
        if (!plugin) return;
    
        plugin.enabled = enabled;
        plugin.updatedAt = new Date().toISOString();
    
        await window.IdoFront.storage.savePlugin(plugin);
        loadedPlugins.set(id, plugin);
    
        if (enabled) await restartPlugin(id);
        else await stopPlugin(id);
    };

    /**
     * 删除插件
     */
    window.IdoFront.pluginLoader.deletePlugin = async function(id) {
        await stopPlugin(id);
        await window.IdoFront.storage.deletePlugin(id);
        loadedPlugins.delete(id);
    };

    /**
     * 获取所有插件
     */
    window.IdoFront.pluginLoader.getPlugins = function() {
        return Array.from(loadedPlugins.values()).map(plugin => ({
            ...plugin,
            source: plugin.source || 'external',
            runtime: runtimeHandles.has(plugin.id) ? 'running' : 'stopped'
        }));
    };
    
    /**
     * 停止插件
     */
    async function stopPlugin(id) {
        const cleanup = runtimeHandles.get(id);
        if (typeof cleanup === 'function') {
            try { cleanup(); } catch (error) { 
                console.warn(`[PluginLoader] Cleanup failed for ${id}:`, error); 
            }
        }
        runtimeHandles.delete(id);
        await releasePluginResources(id);
    }
    
    /**
     * 重启插件
     */
    async function restartPlugin(id) {
        await stopPlugin(id);
        const plugin = loadedPlugins.get(id);
        if (plugin?.enabled) {
            await tryRunPlugin(plugin);
        }
    }
    
    /**
     * 监听 Store 事件
     */
    function attachStoreListeners() {
        if (!store?.events) return;
        store.events.on('plugin-states:changed', (payload) => {
            if (!payload || !Array.isArray(payload)) return;
            payload.forEach(({ id, enabled }) => {
                window.IdoFront.pluginLoader.togglePlugin(id, enabled).catch(err => {
                    console.error('[PluginLoader] Failed to toggle from store event:', err);
                });
            });
        });
    }

    console.log('[PluginLoader] Module loaded');
})();