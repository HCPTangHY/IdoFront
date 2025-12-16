/**
 * Framework 模块加载器
 * 按正确顺序加载 framework 目录下的模块化脚本
 */
(function() {
    'use strict';

    const BASE_PATH = 'scripts/framework/';

    // Framework 模块加载顺序（有依赖关系）
    const modules = [
        // 1. 基础模块（无依赖）
        'events.js',
        'storage.js',
        
        // 2. 布局模块
        'layout.js',
        'gesture.js',
        
        // 3. 功能模块
        'plugins.js',
        'markdown.js',
        'messages.js',
        'ui-helpers.js',
        
        // 4. 核心聚合模块
        'core.js',
        
        // 5. 入口（创建统一 API）
        'index.js'
    ];

    /**
     * 加载单个脚本
     */
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = (e) => reject(new Error(`Failed to load: ${src}`));
            document.head.appendChild(script);
        });
    }

    /**
     * 按顺序加载所有模块
     */
    async function loadModules() {
        console.log('Framework: 开始加载模块...');
        
        for (const moduleName of modules) {
            const src = BASE_PATH + moduleName;
            try {
                await loadScript(src);
            } catch (e) {
                console.error(`Framework: 加载失败 ${src}`, e);
            }
        }
        
        console.log('Framework: 所有模块已加载');
        
        // 触发 Framework 加载完成事件
        document.dispatchEvent(new CustomEvent('FrameworkLoaded'));
    }

    // 暴露加载完成 Promise 供外部等待
    window.FrameworkReady = loadModules();
})();