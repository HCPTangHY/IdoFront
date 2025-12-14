/**
 * IdoFront 自动更新配置
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.updater = window.IdoFront.updater || {};

    /**
     * 更新配置
     */
    window.IdoFront.updater.config = {
        // GitHub 仓库信息
        github: {
            owner: 'HCPTangHY',       // GitHub 用户名或组织名
            repo: 'IdoFront',           // 仓库名称
            // GitHub API 地址
            apiBase: 'https://api.github.com',
            // 获取最新 Release 的 API
            get latestReleaseUrl() {
                return `${this.apiBase}/repos/${this.owner}/${this.repo}/releases/latest`;
            },
            // Release 页面地址
            get releasesPageUrl() {
                return `https://github.com/${this.owner}/${this.repo}/releases`;
            }
        },

        // 更新检查设置
        check: {
            // 启动时自动检查
            autoCheckOnStartup: true,
            // 检查间隔（毫秒），默认 24 小时
            interval: 24 * 60 * 60 * 1000,
            // 静默检查（不显示"已是最新版本"提示）
            silent: true
        },

        // 平台标识
        platform: {
            // Capacitor Android 检测
            get isAndroid() {
                return typeof window.Capacitor !== 'undefined' &&
                       window.Capacitor.isNativePlatform &&
                       window.Capacitor.getPlatform &&
                       window.Capacitor.getPlatform() === 'android';
            },
            // Electron 检测（通过 preload 暴露的 API）
            get isElectron() {
                return typeof window.electronPlatform !== 'undefined' &&
                       window.electronPlatform.isElectron === true;
            },
            // Web/扩展环境
            get isWeb() {
                return !this.isAndroid && !this.isElectron;
            },
            
            // 获取当前平台
            get current() {
                if (this.isAndroid) return 'android';
                if (this.isElectron) return 'electron';
                return 'web';
            }
        },

        // 下载文件名模式
        filePatterns: {
            android: /IdoFront-v[\d.]+\.apk$/i,
            windows: /IdoFront-v[\d.]+-win\.exe$/i,
            extension: /IdoFront-v[\d.]+-extension\.zip$/i
        }
    };

    console.log('[IdoFront.updater] 配置已加载，平台:', window.IdoFront.updater.config.platform.current);
})();