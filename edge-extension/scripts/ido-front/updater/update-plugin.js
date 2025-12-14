/**
 * IdoFront 更新插件
 * 将更新功能注册为 IdoFront 插件
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.updater = window.IdoFront.updater || {};

    let context = null;
    let store = null;
    let initialized = false;

    /**
     * 初始化更新插件
     * @param {Object} frameworkContext - Framework 上下文
     * @param {Object} storeInstance - Store 实例
     */
    async function init(frameworkContext, storeInstance) {
        if (initialized) return;

        context = frameworkContext;
        store = storeInstance;

        const config = window.IdoFront.updater.config;
        const service = window.IdoFront.updater.service;
        const ui = window.IdoFront.updater.ui;

        if (!config || !service || !ui) {
            console.error('[IdoFront.updater.plugin] 依赖模块未加载');
            return;
        }

        // 监听更新事件
        if (store && store.events) {
            store.events.on('update:available', handleUpdateAvailable);
        }

        // 注册设置项
        registerSettings();

        // 注册工具栏按钮（可选）
        registerToolbarButton();

        // 自动检查更新
        setTimeout(async () => {
            const result = await service.autoCheckIfNeeded();
            if (result && result.hasUpdate) {
                console.log('[IdoFront.updater.plugin] 发现新版本:', result.latestVersion);
            }
        }, 2000); // 延迟 2 秒，等待 UI 完全加载

        initialized = true;
        console.log('[IdoFront.updater.plugin] 更新插件已初始化');
    }

    /**
     * 处理发现更新事件
     * @param {Object} updateInfo - 更新信息
     */
    function handleUpdateAvailable(updateInfo) {
        const ui = window.IdoFront.updater.ui;
        
        // 显示更新徽章
        ui.showUpdateBadge(updateInfo);

        // 根据设置决定是否立即显示对话框
        const autoShowDialog = localStorage.getItem('idofront_update_auto_show') !== 'false';
        
        if (autoShowDialog) {
            // 延迟显示，避免打断用户
            setTimeout(() => {
                ui.createUpdateDialog(updateInfo);
            }, 1000);
        }
    }

    /**
     * 手动检查更新
     */
    async function checkUpdate() {
        const service = window.IdoFront.updater.service;
        const ui = window.IdoFront.updater.ui;

        ui.showToast('正在检查更新...', 'info');

        try {
            const result = await service.checkForUpdate({ silent: false });

            if (result.hasUpdate) {
                ui.createUpdateDialog(result);
            } else {
                ui.showToast('已是最新版本 v' + result.currentVersion, 'success');
            }
        } catch (error) {
            ui.showToast('检查更新失败: ' + error.message, 'error');
        }
    }

    /**
     * 注册设置项
     */
    function registerSettings() {
        if (!context || !context.registerPlugin) return;

        // 添加到设置面板
        const settingsManager = window.IdoFront.settingsManager;
        if (settingsManager && settingsManager.registerSection) {
            settingsManager.registerSection({
                id: 'update',
                title: '更新设置',
                icon: '🔄',
                order: 100,
                render: renderUpdateSettings
            });
        }
    }

    /**
     * 渲染更新设置面板
     * @returns {HTMLElement}
     */
    function renderUpdateSettings() {
        const service = window.IdoFront.updater.service;
        const config = window.IdoFront.updater.config;

        const container = document.createElement('div');
        container.className = 'update-settings';
        container.style.cssText = 'padding: 16px;';

        // 先用同步方式获取版本（回退到全局变量）
        let currentVersion = window.IdoFront.version || '1.0.0';
        const autoCheck = localStorage.getItem('idofront_update_auto_check') !== 'false';
        const autoShowDialog = localStorage.getItem('idofront_update_auto_show') !== 'false';

        // 异步更新版本号（Electron 环境）
        (async () => {
            const asyncVersion = await service.getCurrentVersion();
            const versionEl = container.querySelector('#update-current-version');
            if (versionEl && asyncVersion !== currentVersion) {
                versionEl.textContent = 'v' + asyncVersion;
            }
        })();

        container.innerHTML = `
            <div style="margin-bottom: 24px;">
                <h4 style="margin: 0 0 8px; font-size: 14px; color: var(--text-secondary, #6b7280);">
                    当前版本
                </h4>
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 12px;
                ">
                    <span id="update-current-version" style="
                        font-size: 24px;
                        font-weight: 600;
                        color: var(--text-primary, #111827);
                    ">v${currentVersion}</span>
                    <span style="
                        padding: 4px 12px;
                        background: var(--bg-tertiary, #f3f4f6);
                        border-radius: 16px;
                        font-size: 12px;
                        color: var(--text-secondary, #6b7280);
                    ">${config.platform.current}</span>
                </div>
            </div>

            <div style="margin-bottom: 24px;">
                <button id="update-check-btn" style="
                    padding: 12px 24px;
                    background: var(--primary-color, #3b82f6);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                ">
                    检查更新
                </button>
            </div>

            <div style="border-top: 1px solid var(--border-color, #e5e7eb); padding-top: 16px;">
                <h4 style="margin: 0 0 16px; font-size: 14px; color: var(--text-secondary, #6b7280);">
                    更新偏好
                </h4>
                
                <label style="
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 12px;
                    cursor: pointer;
                ">
                    <input type="checkbox" id="update-auto-check" ${autoCheck ? 'checked' : ''} style="
                        width: 18px;
                        height: 18px;
                        accent-color: var(--primary-color, #3b82f6);
                    ">
                    <span style="font-size: 14px; color: var(--text-primary, #374151);">
                        启动时自动检查更新
                    </span>
                </label>

                <label style="
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    cursor: pointer;
                ">
                    <input type="checkbox" id="update-auto-show" ${autoShowDialog ? 'checked' : ''} style="
                        width: 18px;
                        height: 18px;
                        accent-color: var(--primary-color, #3b82f6);
                    ">
                    <span style="font-size: 14px; color: var(--text-primary, #374151);">
                        发现更新时自动显示提示
                    </span>
                </label>
            </div>

            <div style="
                margin-top: 24px;
                padding: 16px;
                background: var(--bg-tertiary, #f9fafb);
                border-radius: 8px;
            ">
                <p style="margin: 0; font-size: 12px; color: var(--text-secondary, #6b7280);">
                    💡 更新来源: 
                    <a href="${config.github.releasesPageUrl}" target="_blank" style="
                        color: var(--primary-color, #3b82f6);
                        text-decoration: none;
                    ">GitHub Releases</a>
                </p>
            </div>
        `;

        // 绑定事件
        setTimeout(() => {
            const checkBtn = container.querySelector('#update-check-btn');
            const autoCheckBox = container.querySelector('#update-auto-check');
            const autoShowBox = container.querySelector('#update-auto-show');

            if (checkBtn) {
                checkBtn.addEventListener('click', checkUpdate);
            }

            if (autoCheckBox) {
                autoCheckBox.addEventListener('change', (e) => {
                    localStorage.setItem('idofront_update_auto_check', e.target.checked);
                    config.check.autoCheckOnStartup = e.target.checked;
                });
            }

            if (autoShowBox) {
                autoShowBox.addEventListener('change', (e) => {
                    localStorage.setItem('idofront_update_auto_show', e.target.checked);
                });
            }
        }, 0);

        return container;
    }

    /**
     * 注册工具栏按钮
     */
    function registerToolbarButton() {
        // 可以在这里添加工具栏上的更新按钮
        // 暂时使用设置面板中的更新功能
    }

    // 导出插件
    window.IdoFront.updater.plugin = {
        init,
        checkUpdate,
        renderUpdateSettings
    };

    // 自动注册到插件系统
    window.IdoFront.corePlugins.register({
        id: 'core-updater',
        name: '自动更新',
        description: '检查并下载应用更新',
        version: '1.0.0',
        init: init
    });

    console.log('[IdoFront.updater.plugin] 更新插件模块已加载');
})();