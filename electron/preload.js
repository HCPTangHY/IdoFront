/**
 * Electron Preload Script
 * 在隔离的上下文中暴露安全的 API 给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

// 暴露更新相关 API
contextBridge.exposeInMainWorld('electronUpdater', {
    // 检查更新
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    
    // 下载更新
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    
    // 安装更新并重启
    installUpdate: () => ipcRenderer.invoke('install-update'),
    
    // 获取应用版本
    getVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // 监听更新事件
    onUpdateChecking: (callback) => {
        ipcRenderer.on('update-checking', (event, data) => callback(data));
    },
    
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, data) => callback(data));
    },
    
    onUpdateNotAvailable: (callback) => {
        ipcRenderer.on('update-not-available', (event, data) => callback(data));
    },
    
    onDownloadProgress: (callback) => {
        ipcRenderer.on('update-download-progress', (event, data) => callback(data));
    },
    
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, data) => callback(data));
    },
    
    onUpdateError: (callback) => {
        ipcRenderer.on('update-error', (event, data) => callback(data));
    },
    
    // 移除监听器
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('update-checking');
        ipcRenderer.removeAllListeners('update-available');
        ipcRenderer.removeAllListeners('update-not-available');
        ipcRenderer.removeAllListeners('update-download-progress');
        ipcRenderer.removeAllListeners('update-downloaded');
        ipcRenderer.removeAllListeners('update-error');
    }
});

// 暴露平台信息
contextBridge.exposeInMainWorld('electronPlatform', {
    isElectron: true,
    platform: process.platform,
    arch: process.arch
});

console.log('[Electron Preload] API 已暴露到 window.electronUpdater');