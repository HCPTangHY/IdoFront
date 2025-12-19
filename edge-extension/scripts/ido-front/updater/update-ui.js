/**
 * IdoFront 更新 UI
 * 负责显示更新提示、更新对话框
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.updater = window.IdoFront.updater || {};

    const config = window.IdoFront.updater.config;
    const service = window.IdoFront.updater.service;

    let updateDialogElement = null;
    let updateBadgeElement = null;

    let downloadProgressElement = null;

    /**
     * 创建更新对话框
     * @param {Object} updateInfo - 更新信息
     */
    function createUpdateDialog(updateInfo) {
        // 如果已存在，先移除
        removeUpdateDialog();

        const { currentVersion, latestVersion, latestRelease, platform } = updateInfo;
        const downloadUrl = service.getDownloadUrl(latestRelease);
        const isElectron = config.platform.isElectron;
        const isAndroid = config.platform.isAndroid;
        const isWeb = platform === 'web';
        const supportsInAppDownload = (isElectron || isAndroid) && !isWeb;

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.id = 'idofront-update-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.2s ease-out;
        `;

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--bg-secondary, #ffffff);
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 400px;
            width: 90%;
            overflow: hidden;
            animation: slideUp 0.3s ease-out;
        `;

        // 平台信息
        const platformNames = {
            android: 'Android APK',
            electron: 'Windows 桌面版',
            extension: '浏览器扩展',
            web: '网页版'
        };

        // 更新内容（简化 Markdown）
        let changelog = latestRelease.body || '暂无更新说明';
        // 简单处理 markdown
        changelog = changelog
            .replace(/^##\s+/gm, '')
            .replace(/^###\s+/gm, '')
            .replace(/\*\*/g, '')
            .replace(/\n{3,}/g, '\n\n');

        dialog.innerHTML = `
            <div style="padding: 24px; border-bottom: 1px solid var(--border-color, #e5e7eb);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="
                        width: 48px;
                        height: 48px;
                        background: linear-gradient(135deg, #10b981, #059669);
                        border-radius: 12px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-size: 24px;
                    ">
                        🚀
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary, #111827);">
                            发现新版本
                        </h3>
                        <p style="margin: 4px 0 0; font-size: 14px; color: var(--text-secondary, #6b7280);">
                            ${platformNames[platform] || '应用'}
                        </p>
                    </div>
                </div>
                
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 16px;
                    background: var(--bg-tertiary, #f3f4f6);
                    border-radius: 8px;
                    margin-bottom: 16px;
                ">
                    <span style="font-size: 14px; color: var(--text-secondary, #6b7280);">
                        v${currentVersion}
                    </span>
                    <span style="color: var(--text-secondary, #9ca3af);">→</span>
                    <span style="
                        font-size: 14px;
                        font-weight: 600;
                        color: #10b981;
                    ">
                        v${latestVersion}
                    </span>
                </div>

                <div style="
                    max-height: 200px;
                    overflow-y: auto;
                    font-size: 14px;
                    line-height: 1.6;
                    color: var(--text-secondary, #4b5563);
                    white-space: pre-wrap;
                ">
                    ${escapeHtml(changelog)}
                </div>
            </div>

            <!-- 下载进度区域 -->
            <div id="idofront-download-progress" style="
                padding: 0 24px;
                display: none;
            ">
                <div style="
                    background: var(--bg-tertiary, #f3f4f6);
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 16px;
                ">
                    <div id="idofront-progress-bar" style="
                        height: 8px;
                        background: linear-gradient(135deg, #10b981, #059669);
                        width: 0%;
                        transition: width 0.3s ease;
                    "></div>
                </div>
                <p id="idofront-progress-text" style="
                    margin: 0;
                    font-size: 12px;
                    color: var(--text-secondary, #6b7280);
                    text-align: center;
                ">准备下载...</p>
            </div>

            <div id="idofront-update-buttons" style="
                padding: 16px 24px;
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                background: var(--bg-tertiary, #f9fafb);
            ">
                <button id="idofront-update-skip" style="
                    padding: 10px 20px;
                    border: 1px solid var(--border-color, #d1d5db);
                    background: var(--bg-secondary, #ffffff);
                    color: var(--text-primary, #374151);
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                ">
                    稍后提醒
                </button>
                <button id="idofront-update-download" style="
                    padding: 10px 20px;
                    border: none;
                    background: linear-gradient(135deg, #10b981, #059669);
                    color: white;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s ease;
                ">
                    ${isWeb ? '查看更新' : (supportsInAppDownload ? '下载并安装' : '立即下载')}
                </button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        updateDialogElement = overlay;

        // 添加动画样式
        if (!document.getElementById('idofront-update-styles')) {
            const style = document.createElement('style');
            style.id = 'idofront-update-styles';
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { 
                        opacity: 0;
                        transform: translateY(20px) scale(0.95);
                    }
                    to { 
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                #idofront-update-skip:hover {
                    background: var(--bg-tertiary, #f3f4f6) !important;
                }
                #idofront-update-download:hover {
                    filter: brightness(1.1);
                    transform: translateY(-1px);
                }
            `;
            document.head.appendChild(style);
        }

        // 绑定事件
        document.getElementById('idofront-update-skip').addEventListener('click', () => {
            removeUpdateDialog();
        });

        document.getElementById('idofront-update-download').addEventListener('click', async () => {
            if (supportsInAppDownload) {
                // Electron/Android: 显示下载进度
                showDownloadProgress();
                
                // 定义进度回调（用于 Android）
                const onProgress = (data) => {
                    updateDownloadProgress(data);
                };
                
                const result = await service.downloadUpdate(downloadUrl, onProgress);
                
                if (!result.success) {
                    showToast('下载失败: ' + result.error, 'error');
                    hideDownloadProgress();
                } else if (result.message) {
                    // Android: 可能需要用户手动操作
                    handleAndroidDownloadComplete(result);
                } else if (!isElectron) {
                    // Android 下载成功且已自动打开安装
                    showToast('正在打开安装程序...', 'success');
                    removeUpdateDialog();
                }
                // Electron 下载完成后由事件监听器处理
            } else {
                // Web/扩展：打开下载链接
                service.openDownloadUrl(downloadUrl);
                removeUpdateDialog();
            }
        });

        // Electron: 监听下载进度
        if (isElectron && window.IdoFront.store && window.IdoFront.store.events) {
            window.IdoFront.store.events.on('electron:download-progress', updateDownloadProgress);
            window.IdoFront.store.events.on('electron:update-downloaded', handleUpdateDownloaded);
            window.IdoFront.store.events.on('electron:update-error', handleUpdateError);
        }

        // 点击遮罩关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                removeUpdateDialog();
            }
        });
    }

    /**
     * 显示下载进度
     */
    function showDownloadProgress() {
        const progressEl = document.getElementById('idofront-download-progress');
        const buttonsEl = document.getElementById('idofront-update-buttons');
        
        if (progressEl) {
            progressEl.style.display = 'block';
        }
        if (buttonsEl) {
            buttonsEl.style.display = 'none';
        }
    }

    /**
     * 隐藏下载进度
     */
    function hideDownloadProgress() {
        const progressEl = document.getElementById('idofront-download-progress');
        const buttonsEl = document.getElementById('idofront-update-buttons');
        
        if (progressEl) {
            progressEl.style.display = 'none';
        }
        if (buttonsEl) {
            buttonsEl.style.display = 'flex';
        }
    }

    /**
     * 更新下载进度
     * @param {Object} data - 进度数据
     */
    function updateDownloadProgress(data) {
        const progressBar = document.getElementById('idofront-progress-bar');
        const progressText = document.getElementById('idofront-progress-text');
        
        // 处理不确定进度（原生 HTTP 下载不支持进度回调）
        if (data.indeterminate || data.percent === -1) {
            if (progressBar) {
                // 添加不确定进度动画
                progressBar.style.width = '100%';
                progressBar.style.animation = 'indeterminate-progress 1.5s infinite ease-in-out';
                progressBar.style.background = 'linear-gradient(90deg, transparent, #10b981, transparent)';
                progressBar.style.backgroundSize = '200% 100%';
            }
            if (progressText) {
                progressText.textContent = data.message || '正在下载，请稍候...';
            }
            
            // 添加动画样式
            if (!document.getElementById('idofront-indeterminate-styles')) {
                const style = document.createElement('style');
                style.id = 'idofront-indeterminate-styles';
                style.textContent = `
                    @keyframes indeterminate-progress {
                        0% { background-position: 200% 0; }
                        100% { background-position: -200% 0; }
                    }
                `;
                document.head.appendChild(style);
            }
            return;
        }
        
        // 正常进度显示
        if (progressBar) {
            // 移除不确定动画
            progressBar.style.animation = '';
            progressBar.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            progressBar.style.backgroundSize = '';
            progressBar.style.width = `${data.percent.toFixed(1)}%`;
        }
        
        if (progressText) {
            if (data.message) {
                progressText.textContent = data.message;
            } else {
                const transferred = formatBytes(data.transferred);
                const total = formatBytes(data.total);
                const speed = formatBytes(data.bytesPerSecond);
                progressText.textContent = `${transferred} / ${total} (${speed}/s)`;
            }
        }
    }

    /**
     * 处理下载完成
     * @param {Object} data - 更新数据
     */
    function handleUpdateDownloaded(data) {
        const progressText = document.getElementById('idofront-progress-text');
        const progressEl = document.getElementById('idofront-download-progress');
        const buttonsEl = document.getElementById('idofront-update-buttons');
        
        if (progressText) {
            progressText.textContent = '下载完成！';
        }
        
        // 显示安装按钮
        if (buttonsEl) {
            buttonsEl.innerHTML = `
                <button id="idofront-update-later" style="
                    padding: 10px 20px;
                    border: 1px solid var(--border-color, #d1d5db);
                    background: var(--bg-secondary, #ffffff);
                    color: var(--text-primary, #374151);
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                ">
                    稍后安装
                </button>
                <button id="idofront-update-install" style="
                    padding: 10px 20px;
                    border: none;
                    background: linear-gradient(135deg, #10b981, #059669);
                    color: white;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                ">
                    立即安装并重启
                </button>
            `;
            buttonsEl.style.display = 'flex';
            
            document.getElementById('idofront-update-later').addEventListener('click', () => {
                showToast('更新将在下次启动时安装', 'info');
                removeUpdateDialog();
            });
            
            document.getElementById('idofront-update-install').addEventListener('click', async () => {
                await service.installUpdate();
            });
        }
        
        if (progressEl) {
            progressEl.style.display = 'none';
        }
    }

    /**
     * 处理 Android 下载完成
     * @param {Object} result - 下载结果
     */
    function handleAndroidDownloadComplete(result) {
        const progressText = document.getElementById('idofront-progress-text');
        const progressEl = document.getElementById('idofront-download-progress');
        const buttonsEl = document.getElementById('idofront-update-buttons');
        
        if (progressText) {
            progressText.textContent = '下载完成！';
        }
        
        // 显示提示和操作按钮
        if (buttonsEl) {
            buttonsEl.innerHTML = `
                <div style="
                    flex: 1;
                    font-size: 12px;
                    color: var(--text-secondary, #6b7280);
                    line-height: 1.4;
                ">
                    ${result.message || 'APK 已下载完成'}
                    ${result.filePath ? `<br><code style="font-size: 11px; word-break: break-all;">${result.filePath}</code>` : ''}
                </div>
                <button id="idofront-update-close" style="
                    padding: 10px 20px;
                    border: none;
                    background: linear-gradient(135deg, #10b981, #059669);
                    color: white;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    flex-shrink: 0;
                ">
                    知道了
                </button>
            `;
            buttonsEl.style.display = 'flex';
            buttonsEl.style.alignItems = 'center';
            
            document.getElementById('idofront-update-close').addEventListener('click', () => {
                removeUpdateDialog();
            });
        }
        
        if (progressEl) {
            progressEl.style.display = 'none';
        }
    }

    /**
     * 处理更新错误
     * @param {Object} data - 错误数据
     */
    function handleUpdateError(data) {
        hideDownloadProgress();
        showToast('更新失败: ' + data.message, 'error');
    }

    /**
     * 格式化字节大小
     * @param {number} bytes - 字节数
     * @returns {string} 格式化后的字符串
     */
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 移除更新对话框
     */
    function removeUpdateDialog() {
        // 移除事件监听
        if (window.IdoFront.store && window.IdoFront.store.events) {
            window.IdoFront.store.events.off('electron:download-progress', updateDownloadProgress);
            window.IdoFront.store.events.off('electron:update-downloaded', handleUpdateDownloaded);
            window.IdoFront.store.events.off('electron:update-error', handleUpdateError);
        }
        
        if (updateDialogElement) {
            updateDialogElement.remove();
            updateDialogElement = null;
        }
    }

    /**
     * 显示更新徽章（小红点）
     * @param {Object} updateInfo - 更新信息
     */
    function showUpdateBadge(updateInfo) {
        // 查找设置按钮
        const settingsBtn = document.querySelector('[data-action="settings"]') || 
                           document.querySelector('.settings-btn') ||
                           document.querySelector('#settings-btn');

        if (!settingsBtn) {
            console.warn('[IdoFront.updater] 未找到设置按钮，无法显示更新徽章');
            return;
        }

        // 如果已有徽章，不重复添加
        if (settingsBtn.querySelector('.update-badge')) {
            return;
        }

        // 创建徽章
        const badge = document.createElement('span');
        badge.className = 'update-badge';
        badge.style.cssText = `
            position: absolute;
            top: -4px;
            right: -4px;
            width: 12px;
            height: 12px;
            background: #ef4444;
            border-radius: 50%;
            border: 2px solid var(--bg-primary, #ffffff);
            animation: pulse 2s infinite;
        `;

        // 确保父元素是相对定位
        if (getComputedStyle(settingsBtn).position === 'static') {
            settingsBtn.style.position = 'relative';
        }

        settingsBtn.appendChild(badge);
        updateBadgeElement = badge;

        // 添加脉冲动画
        if (!document.getElementById('idofront-badge-styles')) {
            const style = document.createElement('style');
            style.id = 'idofront-badge-styles';
            style.textContent = `
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `;
            document.head.appendChild(style);
        }

        // 保存更新信息，点击时显示
        settingsBtn._updateInfo = updateInfo;
    }

    /**
     * 移除更新徽章
     */
    function removeUpdateBadge() {
        if (updateBadgeElement) {
            updateBadgeElement.remove();
            updateBadgeElement = null;
        }
    }

    /**
     * 显示 Toast 提示
     * @param {string} message - 提示消息
     * @param {string} type - 类型：success, error, info
     */
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6'
        };

        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            background: ${colors[type] || colors.info};
            color: white;
            border-radius: 8px;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10001;
            animation: slideUp 0.3s ease-out;
        `;
        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeIn 0.2s ease-out reverse';
            setTimeout(() => toast.remove(), 200);
        }, 3000);
    }

    /**
     * HTML 转义
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 导出 UI 模块
    window.IdoFront.updater.ui = {
        createUpdateDialog,
        removeUpdateDialog,
        showUpdateBadge,
        removeUpdateBadge,
        showToast
    };

    console.log('[IdoFront.updater] UI 模块已加载');
})();