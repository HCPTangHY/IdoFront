/**
 * IdoFront 动态加载器
 * 按正确顺序加载模块化脚本文件。
 * 要添加新文件，只需将它们添加到 'scripts' 数组中。
 */
(function() {
    const BASE_PATH = 'scripts/ido-front/';
    
    const scripts = [
        // 1. 基础模块（无依赖）
        'utils.js',
        'idb-storage.js',  // IndexedDB 存储层（store.js 依赖）
        'store.js',
        'runtime.js',      // Runtime: 统一对外暴露 store 等核心能力
        'network-logger.js',
        'channels/channel-registry.js',
        'plugin-loader.js',  // 外部插件加载器（依赖 channel-registry）
        'channels/openai-channel.js',
        'channels/gemini-channel.js',
        'channels/gemini-deep-research-channel.js',  // Gemini Deep Research Agent
        'service.js',
        
        // 2. Actions 模块（依赖基础模块）
        'actions/conversation.js',
        'actions/message.js',
        
        // 3. Plugins 模块（依赖基础模块和 Actions）
        'plugins/model-selector.js',
        'plugins/network-log-panel.js',
        'plugins/file-upload.js',
        // Builtin image gallery plugin（拆分为 core / view / 入口三层）
        'plugins/image-gallery/core.js',
        'plugins/image-gallery/view.js',
        'plugins/image-gallery.js',
        'plugins/core-plugins.js',
        // Builtin theme toggle (light / dark / system)
        'plugins/theme-toggle.js',
        
        // Updater 模块（自动更新检查）
        'updater/update-config.js',
        'updater/update-service.js',
        'updater/update-ui.js',
        'updater/update-plugin.js',
        
        // 4. Settings 模块（依赖基础模块）
        'settings/channel-editor.js',
        'settings/channel-settings.js',
        'settings/persona-editor.js',
        'settings/persona-settings.js',
        'settings/plugin-settings.js',
        'settings/settings-manager.js',
        
        // 5. 主入口（依赖所有模块）
        'main.js'
    ];

    function loadScript(index) {
        if (index >= scripts.length) {
            // 所有脚本加载完毕
            console.log('IdoFront: 所有脚本已加载。');
            document.dispatchEvent(new CustomEvent('IdoFrontLoaded'));
            return;
        }

        const src = BASE_PATH + scripts[index];
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => loadScript(index + 1);
        script.onerror = (e) => console.error(`IdoFront: 加载失败 ${src}`, e);
        document.head.appendChild(script);
    }

    // Start loading
    loadScript(0);
})();