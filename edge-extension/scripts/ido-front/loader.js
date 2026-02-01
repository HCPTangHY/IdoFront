/**
 * IdoFront 动态加载器
 * 按正确顺序加载模块化脚本文件。
 * 要添加新文件，只需将它们添加到 'scripts' 数组中。
 */
(function() {
    const BASE_PATH = 'scripts/ido-front/';
    const LIB_PATH = 'scripts/lib/';
    
    // 需要先加载的库文件（在 IdoFront 模块之前）
    const libScripts = [
        'js-yaml.min.js',   // YAML 解析器
        'jexl.min.js',      // 表达式引擎
        'comlink.min.js',   // Comlink RPC 库
        // Markdown 渲染相关
        'markdown-it.min.js', // Markdown-it 解析器
        'katex.min.js',     // LaTeX 数学公式渲染
        'highlight.min.js'  // 代码语法高亮
    ];
    
    const scripts = [
        // 1. 基础模块（无依赖）
        'utils.js',
        'crash-logger.js', // 崩溃/异常日志采集（尽力持久化到 chrome.storage.local）
        'idb-storage.js',  // IndexedDB 存储层（store.js 依赖）
        'attachments.js',  // 附件外置化（Blob 存储 / 引用）
        'store.js',
        'backup.js',       // 数据备份/导出/导入
        'virtual-list.js', // 虚拟列表/DOM缓存管理（性能优化）
        'runtime.js',      // Runtime: 统一对外暴露 store 等核心能力
        'network-logger.js',
        'tools/tool-registry.js',      // 工具注册中心（MCP/原生工具）
        'tools/tool-call-types.js',     // 工具调用数据结构
        'tools/tool-call-renderer.js',  // 工具调用 UI 渲染
        'tools/mcp-client.js',          // MCP 协议客户端
        'channels/channel-registry.js',
        
        // 2. 混合格式插件支持（声明式渲染 + Comlink 通信）
        'hybrid-plugin-parser.js',      // YAML/JS 混合格式解析器
        'declarative/components.js',    // 声明式组件定义（MD3 组件）
        'declarative/ui-manager.js',    // 声明式 UI 管理器
        'declarative-ui-renderer.js',   // 声明式 UI 渲染器入口
        'comlink-bridge.js',            // Comlink 主线程桥接
        
        // 3. 外部插件加载器
        'plugin-loader.js',
        'service.js',
        
        // 3.5. 服务层（AI 服务相关）
        'services/prompts.js',
        'services/title-generator.js',
        
        // 4. Actions 模块（依赖基础模块）
        'actions/conversation.js',
        'actions/message.js',
        
        // 5. Plugins 模块（依赖基础模块和 Actions）
        'plugins/model-selector.js',
        'plugins/network-log-panel.js',
        'plugins/file-upload.js',
        // Builtin image gallery plugin（拆分为 core / view / 入口三层）
        'plugins/image-gallery/core.js',
        'plugins/image-gallery/view.js',
        'plugins/image-gallery.js',
        'plugins/core-plugins.js',  // 必须在渠道之前加载，提供 inputTools API
        
        // 6. Channels（依赖 channel-registry 和 core-plugins 的 inputTools API）
        'channels/openai-channel.js',
        'channels/openai-responses-channel.js',
        'channels/gemini-channel.js',
        'channels/gemini-deep-research-channel.js',  // Gemini Deep Research Agent
        'channels/claude-channel.js',  // Anthropic Claude
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
        'settings/ai-service-settings.js',
        'settings/performance-settings.js', // 性能设置（DOM 缓存开关）
        'settings/data-settings.js',    // 数据管理（备份/导出/导入）
        'settings/mcp-settings.js',     // MCP 服务管理
        'settings/settings-manager.js',
        
        // 5. 主入口（依赖所有模块）
        'main.js'
    ];

    /**
     * 加载单个脚本
     * @param {string} src 脚本路径
     * @returns {Promise<void>}
     */
    function loadScriptAsync(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = (e) => reject(new Error(`Failed to load: ${src}`));
            document.head.appendChild(script);
        });
    }
    
    /**
     * 按顺序加载脚本列表
     * @param {string[]} scriptList 脚本路径列表
     * @param {string} basePath 基础路径
     */
    async function loadScriptsSequentially(scriptList, basePath) {
        for (const scriptName of scriptList) {
            const src = basePath + scriptName;
            try {
                await loadScriptAsync(src);
            } catch (e) {
                console.error(`IdoFront: 加载失败 ${src}`, e);
            }
        }
    }
    
    /**
     * 等待 Framework 加载完成
     */
    function waitForFramework() {
        return new Promise((resolve) => {
            // 如果 Framework 已经存在，直接 resolve
            if (typeof Framework !== 'undefined' && Framework) {
                resolve();
                return;
            }
            
            // 如果有 FrameworkReady Promise，等待它
            if (window.FrameworkReady && typeof window.FrameworkReady.then === 'function') {
                window.FrameworkReady.then(resolve);
                return;
            }
            
            // 否则监听 FrameworkLoaded 事件
            document.addEventListener('FrameworkLoaded', () => resolve(), { once: true });
        });
    }

    /**
     * 主加载流程
     */
    async function startLoading() {
        try {
            // 0. 等待 Framework 加载完成
            console.log('IdoFront: 等待 Framework...');
            await waitForFramework();
            console.log('IdoFront: Framework 已就绪');
            
            // 1. 先加载库文件
            console.log('IdoFront: 加载依赖库...');
            await loadScriptsSequentially(libScripts, LIB_PATH);
            
            // 2. 加载 IdoFront 模块
            console.log('IdoFront: 加载核心模块...');
            await loadScriptsSequentially(scripts, BASE_PATH);
            
            // 3. 所有脚本加载完毕
            console.log('IdoFront: 所有脚本已加载。');
            document.dispatchEvent(new CustomEvent('IdoFrontLoaded'));
        } catch (e) {
            console.error('IdoFront: 加载过程出错', e);
        }
    }

    // Start loading
    startLoading();
})();