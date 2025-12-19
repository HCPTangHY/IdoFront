/**
 * IdoFront 更新服务
 * 负责检查版本更新、获取下载链接
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.updater = window.IdoFront.updater || {};

    const config = window.IdoFront.updater.config;

    /**
     * 版本比较函数
     * @param {string} v1 - 版本 1
     * @param {string} v2 - 版本 2
     * @returns {number} 1: v1 > v2, -1: v1 < v2, 0: v1 == v2
     */
    function compareVersions(v1, v2) {
        const parts1 = v1.replace(/^v/, '').split('.').map(Number);
        const parts2 = v2.replace(/^v/, '').split('.').map(Number);
        
        const maxLen = Math.max(parts1.length, parts2.length);
        
        for (let i = 0; i < maxLen; i++) {
            const num1 = parts1[i] || 0;
            const num2 = parts2[i] || 0;
            
            if (num1 > num2) return 1;
            if (num1 < num2) return -1;
        }
        
        return 0;
    }

    /**
     * 获取当前版本
     * @returns {Promise<string>} 当前版本号
     */
    async function getCurrentVersion() {
        // 1. Electron 环境 - 从主进程获取
        if (config.platform.isElectron && window.electronUpdater) {
            try {
                const version = await window.electronUpdater.getVersion();
                if (version) return version;
            } catch (e) {}
        }
        
        // 2. 从全局配置
        if (window.IdoFront && window.IdoFront.version) {
            return window.IdoFront.version;
        }
        
        // 3. 从 manifest (扩展环境)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
            try {
                return chrome.runtime.getManifest().version;
            } catch (e) {}
        }
        
        // 4. 默认值
        return '1.0.0';
    }

    /**
     * 从 GitHub Releases 获取最新版本信息
     * @returns {Promise<Object>} 最新版本信息
     */
    async function fetchLatestRelease() {
        try {
            const response = await fetch(config.github.latestReleaseUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) {
                throw new Error(`GitHub API 请求失败: ${response.status}`);
            }

            const release = await response.json();
            
            // 解析资源文件
            const assets = release.assets || [];
            const downloadUrls = {};

            assets.forEach(asset => {
                const name = asset.name;
                
                if (config.filePatterns.android.test(name)) {
                    downloadUrls.android = asset.browser_download_url;
                } else if (config.filePatterns.windows.test(name)) {
                    downloadUrls.windows = asset.browser_download_url;
                } else if (config.filePatterns.extension.test(name)) {
                    downloadUrls.extension = asset.browser_download_url;
                }
            });

            return {
                version: release.tag_name.replace(/^v/, ''),
                tagName: release.tag_name,
                name: release.name,
                body: release.body,
                publishedAt: release.published_at,
                htmlUrl: release.html_url,
                downloadUrls,
                assets
            };
        } catch (error) {
            console.error('[IdoFront.updater] 获取最新版本失败:', error);
            throw error;
        }
    }

    /**
     * 检查更新
     * @param {Object} options - 选项
     * @param {boolean} options.silent - 静默模式（无更新时不提示）
     * @returns {Promise<Object>} 更新检查结果
     */
    async function checkForUpdate(options = {}) {
        const silent = options.silent ?? config.check.silent;
        
        try {
            const currentVersion = await getCurrentVersion();
            const latestRelease = await fetchLatestRelease();
            const latestVersion = latestRelease.version;

            const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

            const result = {
                hasUpdate,
                currentVersion,
                latestVersion,
                latestRelease,
                platform: config.platform.current
            };

            // 触发事件
            if (window.IdoFront.store && window.IdoFront.store.events) {
                window.IdoFront.store.events.emit('update:checked', result);
                
                if (hasUpdate) {
                    window.IdoFront.store.events.emit('update:available', result);
                }
            }

            console.log(`[IdoFront.updater] 版本检查完成: 当前 v${currentVersion}, 最新 v${latestVersion}, 有更新: ${hasUpdate}`);

            return result;
        } catch (error) {
            console.error('[IdoFront.updater] 检查更新失败:', error);
            
            if (!silent) {
                throw error;
            }
            
            return {
                hasUpdate: false,
                error: error.message
            };
        }
    }

    /**
     * 下载更新（支持 Electron 和 Android）
     * @param {string} downloadUrl - 下载地址
     * @param {Function} onProgress - 进度回调
     * @returns {Promise<Object>}
     */
    async function downloadUpdate(downloadUrl, onProgress) {
        const platform = config.platform.current;
        
        // Electron: 使用原生更新器
        if (platform === 'electron' && window.electronUpdater) {
            return await window.electronUpdater.downloadUpdate();
        }
        
        // Android/Web: 检查下载地址
        if (!downloadUrl) {
            return { success: false, error: '下载地址无效' };
        }

        // Android: 使用原生 HTTP 下载（绕过 CORS）
        if (platform === 'android') {
            return await downloadApkWithNativeHttp(downloadUrl, onProgress);
        }

        // Web/扩展环境: 尝试使用 fetch 下载
        try {
            const response = await fetch(downloadUrl);
            
            if (!response.ok) {
                throw new Error(`下载失败: ${response.status}`);
            }

            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            
            const reader = response.body.getReader();
            const chunks = [];
            let transferred = 0;

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                chunks.push(value);
                transferred += value.length;

                // 触发进度回调
                if (onProgress && total > 0) {
                    onProgress({
                        percent: (transferred / total) * 100,
                        transferred,
                        total,
                        bytesPerSecond: 0 // 简化处理
                    });
                }
            }

            // 合并数据块
            const blob = new Blob(chunks);
            
            // Web: 创建下载链接
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = downloadUrl.split('/').pop() || 'IdoFront.apk';
            a.click();
            URL.revokeObjectURL(blobUrl);
            
            return { success: true };
        } catch (error) {
            console.error('[IdoFront.updater] 下载失败:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Android: 使用 Capacitor 原生 HTTP 下载 APK
     * CapacitorHttp 在原生层执行请求，绕过 CORS 限制
     * @param {string} downloadUrl - 下载地址
     * @param {Function} onProgress - 进度回调
     * @returns {Promise<Object>}
     */
    async function downloadApkWithNativeHttp(downloadUrl, onProgress) {
        try {
            const Capacitor = window.Capacitor;
            const CapacitorHttp = Capacitor?.Plugins?.CapacitorHttp;
            const Filesystem = Capacitor?.Plugins?.Filesystem;
            const FileOpener = Capacitor?.Plugins?.FileOpener;
            
            // 检查必需的插件是否可用
            if (!CapacitorHttp) {
                console.warn('[IdoFront.updater] CapacitorHttp 不可用，降级到系统浏览器下载');
                return await openAndroidDownloadInBrowser(downloadUrl);
            }
            
            if (!Filesystem) {
                console.warn('[IdoFront.updater] Filesystem 不可用，降级到系统浏览器下载');
                return await openAndroidDownloadInBrowser(downloadUrl);
            }

            console.log('[IdoFront.updater] 开始使用原生 HTTP 下载 APK:', downloadUrl);
            
            // 显示下载中状态（CapacitorHttp 不支持进度回调）
            if (onProgress) {
                onProgress({
                    percent: -1, // -1 表示不确定进度
                    transferred: 0,
                    total: 0,
                    bytesPerSecond: 0,
                    indeterminate: true
                });
            }

            // 使用原生 HTTP 下载（返回 base64 编码的数据）
            const response = await CapacitorHttp.get({
                url: downloadUrl,
                responseType: 'blob', // 返回 base64 编码的二进制数据
                headers: {
                    'Accept': 'application/vnd.android.package-archive,application/octet-stream,*/*'
                }
            });

            if (response.status !== 200) {
                throw new Error(`下载失败: HTTP ${response.status}`);
            }

            // 获取下载的数据（base64 编码）
            let base64Data = response.data;
            
            // 如果返回的数据包含 data URL 前缀，去掉它
            if (typeof base64Data === 'string' && base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
            }

            console.log('[IdoFront.updater] 下载完成，保存文件...');

            // 更新进度
            if (onProgress) {
                onProgress({
                    percent: 50,
                    transferred: 0,
                    total: 0,
                    bytesPerSecond: 0,
                    message: '正在保存文件...'
                });
            }

            // 保存到下载目录
            const fileName = downloadUrl.split('/').pop() || 'IdoFront.apk';
            const Directory = Capacitor.Plugins.Directory || { ExternalStorage: 'EXTERNAL_STORAGE', Cache: 'CACHE' };
            
            // 尝试保存到外部存储的下载目录
            let saveResult;
            let savedPath;
            
            try {
                // 首先尝试保存到外部存储
                saveResult = await Filesystem.writeFile({
                    path: 'Download/' + fileName,
                    data: base64Data,
                    directory: 'EXTERNAL_STORAGE',
                    recursive: true
                });
                savedPath = saveResult.uri;
            } catch (extError) {
                console.warn('[IdoFront.updater] 无法保存到外部存储，尝试缓存目录:', extError);
                
                // 降级到缓存目录
                saveResult = await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: 'CACHE'
                });
                savedPath = saveResult.uri;
            }

            console.log('[IdoFront.updater] APK 已保存:', savedPath);

            // 更新进度
            if (onProgress) {
                onProgress({
                    percent: 100,
                    transferred: 0,
                    total: 0,
                    bytesPerSecond: 0,
                    message: '下载完成'
                });
            }

            // 尝试打开 APK 进行安装
            if (FileOpener && FileOpener.open) {
                try {
                    console.log('[IdoFront.updater] 尝试打开 APK 安装...');
                    await FileOpener.open({
                        filePath: savedPath,
                        contentType: 'application/vnd.android.package-archive',
                        openWithDefault: true
                    });
                    return {
                        success: true,
                        message: '正在打开安装程序...',
                        filePath: savedPath
                    };
                } catch (openError) {
                    console.warn('[IdoFront.updater] 打开 APK 失败:', openError);
                    return {
                        success: true,
                        message: `APK 已保存\n请从文件管理器打开安装`,
                        filePath: savedPath
                    };
                }
            } else {
                return {
                    success: true,
                    message: `APK 已保存到下载目录\n请从文件管理器打开安装`,
                    filePath: savedPath
                };
            }
        } catch (error) {
            console.error('[IdoFront.updater] 原生下载失败:', error);
            
            // 降级到系统浏览器下载
            console.log('[IdoFront.updater] 降级到系统浏览器下载');
            return await openAndroidDownloadInBrowser(downloadUrl);
        }
    }

    /**
     * Android: 使用系统浏览器下载 APK（降级方案）
     * @param {string} downloadUrl - 下载地址
     * @returns {Promise<Object>}
     */
    async function openAndroidDownloadInBrowser(downloadUrl) {
        try {
            // 优先使用 Capacitor Browser 插件
            const Browser = window.Capacitor?.Plugins?.Browser;
            
            if (Browser && Browser.open) {
                await Browser.open({
                    url: downloadUrl,
                    windowName: '_system'
                });
                return {
                    success: true,
                    message: '已在浏览器中打开下载链接\n下载完成后请从通知栏或下载目录安装 APK'
                };
            }
            
            // 降级：使用 window.open
            window.open(downloadUrl, '_system');
            
            return {
                success: true,
                message: '已在浏览器中打开下载链接\n下载完成后请从通知栏或下载目录安装 APK'
            };
        } catch (error) {
            console.error('[IdoFront.updater] 打开浏览器失败:', error);
            return {
                success: false,
                error: '打开下载链接失败: ' + error.message
            };
        }
    }

    /**
     * Android: 保存 APK 并打开安装
     * @param {Blob} blob - APK 文件
     * @param {string} url - 原始 URL（用于获取文件名）
     * @returns {Promise<Object>}
     */
    async function saveAndInstallApk(blob, url) {
        try {
            // 检查 Capacitor Filesystem 是否可用
            const { Filesystem, Directory } = window.Capacitor?.Plugins || {};
            
            if (!Filesystem) {
                // 降级：使用浏览器下载
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = url.split('/').pop() || 'IdoFront.apk';
                a.click();
                URL.revokeObjectURL(blobUrl);
                return { success: true, message: '请从下载目录手动安装 APK' };
            }

            // 将 Blob 转换为 Base64
            const base64 = await blobToBase64(blob);
            const fileName = url.split('/').pop() || 'IdoFront.apk';

            // 保存到下载目录（使用 External 目录以便其他应用可以访问）
            const result = await Filesystem.writeFile({
                path: 'Download/' + fileName,
                data: base64,
                directory: Directory.ExternalStorage,
                recursive: true
            });

            console.log('[IdoFront.updater] APK 已保存:', result.uri);

            // 尝试打开 APK 进行安装
            // 使用 @capacitor-community/file-opener 插件
            const FileOpener = window.Capacitor?.Plugins?.FileOpener;
            
            if (FileOpener && FileOpener.open) {
                try {
                    await FileOpener.open({
                        filePath: result.uri,
                        contentType: 'application/vnd.android.package-archive',
                        openWithDefault: true
                    });
                    return { success: true, message: '正在打开安装程序...' };
                } catch (openError) {
                    console.warn('[IdoFront.updater] 打开 APK 失败:', openError);
                    // 如果打开失败，仍然返回成功但提示手动安装
                    return {
                        success: true,
                        message: `APK 已保存到下载目录\n请从文件管理器打开安装`,
                        filePath: result.uri
                    };
                }
            } else {
                // 没有 FileOpener 插件，提示用户手动安装
                return {
                    success: true,
                    message: `APK 已保存到下载目录\n请从文件管理器打开安装`,
                    filePath: result.uri
                };
            }
        } catch (error) {
            console.error('[IdoFront.updater] 保存/安装 APK 失败:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Blob 转 Base64
     * @param {Blob} blob
     * @returns {Promise<string>}
     */
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * 安装更新
     * @returns {Promise<Object>}
     */
    async function installUpdate() {
        if (config.platform.isElectron && window.electronUpdater) {
            return await window.electronUpdater.installUpdate();
        }
        
        return { success: false, error: '当前平台不支持自动安装' };
    }

    /**
     * 初始化 Electron 更新事件监听
     */
    function initElectronUpdateListeners() {
        if (!config.platform.isElectron || !window.electronUpdater) {
            return;
        }

        // 监听更新可用
        window.electronUpdater.onUpdateAvailable((data) => {
            if (window.IdoFront.store && window.IdoFront.store.events) {
                window.IdoFront.store.events.emit('electron:update-available', data);
            }
        });

        // 监听下载进度
        window.electronUpdater.onDownloadProgress((data) => {
            if (window.IdoFront.store && window.IdoFront.store.events) {
                window.IdoFront.store.events.emit('electron:download-progress', data);
            }
        });

        // 监听下载完成
        window.electronUpdater.onUpdateDownloaded((data) => {
            if (window.IdoFront.store && window.IdoFront.store.events) {
                window.IdoFront.store.events.emit('electron:update-downloaded', data);
            }
        });

        // 监听错误
        window.electronUpdater.onUpdateError((data) => {
            if (window.IdoFront.store && window.IdoFront.store.events) {
                window.IdoFront.store.events.emit('electron:update-error', data);
            }
        });

        console.log('[IdoFront.updater] Electron 更新事件监听已初始化');
    }

    /**
     * 获取当前平台的下载链接
     * @param {Object} latestRelease - 最新版本信息
     * @returns {string|null} 下载链接
     */
    function getDownloadUrl(latestRelease) {
        if (!latestRelease || !latestRelease.downloadUrls) {
            return null;
        }

        const platform = config.platform.current;
        
        switch (platform) {
            case 'android':
                return latestRelease.downloadUrls.android;
            case 'electron':
                return latestRelease.downloadUrls.windows;
            case 'extension':
                return latestRelease.downloadUrls.extension;
            case 'web':
                return null; // 网页版通常不需要下载更新，直接刷新即可
            default:
                return latestRelease.downloadUrls.extension;
        }
    }

    /**
     * 打开下载页面
     * @param {string} url - 下载链接
     */
    function openDownloadUrl(url) {
        if (!url) {
            // 没有直接下载链接，打开 Releases 页面
            url = config.github.releasesPageUrl;
        }

        // 在新窗口/标签页打开
        if (typeof window.open === 'function') {
            window.open(url, '_blank');
        }
    }

    /**
     * 保存最后检查时间
     */
    function saveLastCheckTime() {
        try {
            localStorage.setItem('idofront_last_update_check', Date.now().toString());
        } catch (e) {}
    }

    /**
     * 获取最后检查时间
     * @returns {number|null} 时间戳
     */
    function getLastCheckTime() {
        try {
            const time = localStorage.getItem('idofront_last_update_check');
            return time ? parseInt(time, 10) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 检查是否需要自动检查更新
     * @returns {boolean}
     */
    function shouldAutoCheck() {
        if (!config.check.autoCheckOnStartup) {
            return false;
        }

        const lastCheck = getLastCheckTime();
        if (!lastCheck) {
            return true;
        }

        const elapsed = Date.now() - lastCheck;
        return elapsed >= config.check.interval;
    }

    /**
     * 自动检查更新（如果需要）
     */
    async function autoCheckIfNeeded() {
        if (shouldAutoCheck()) {
            console.log('[IdoFront.updater] 执行自动更新检查...');
            saveLastCheckTime();
            return await checkForUpdate({ silent: true });
        }
        return null;
    }

    // 导出服务
    window.IdoFront.updater.service = {
        getCurrentVersion,
        fetchLatestRelease,
        checkForUpdate,
        getDownloadUrl,
        openDownloadUrl,
        compareVersions,
        autoCheckIfNeeded,
        getLastCheckTime,
        saveLastCheckTime,
        // Electron 专用
        downloadUpdate,
        installUpdate,
        initElectronUpdateListeners
    };

    // 初始化 Electron 监听
    if (config.platform.isElectron) {
        initElectronUpdateListeners();
    }

    console.log('[IdoFront.updater] 更新服务已加载');
})();