const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let autoUpdater = null;

// 尝试加载 electron-updater（可能未安装）
try {
    autoUpdater = require('electron-updater').autoUpdater;
    
    // 配置自动更新
    autoUpdater.autoDownload = false; // 不自动下载，让用户选择
    autoUpdater.autoInstallOnAppQuit = true;
    
    // GitHub Release 配置
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'HCPTangHY',
        repo: 'IdoFront',
        releaseType: 'release'
    });
} catch (e) {
    console.log('electron-updater 未安装，自动更新功能不可用');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // 需要关闭以使用 preload
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../web-dist/icons/icon-256.png'),
    title: 'IdoFront',
    show: false
  });

  // 完全隐藏菜单栏
  Menu.setApplicationMenu(null);

  // 加载 web-dist/index.html
  mainWindow.loadFile(path.join(__dirname, '../web-dist/index.html'));

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 打开外部链接使用系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 窗口关闭时清理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Electron 准备就绪
app.whenReady().then(() => {
  createWindow();

  // macOS: 点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // 初始化自动更新
  if (autoUpdater) {
    setupAutoUpdater();
  }
});

// 设置自动更新事件处理
function setupAutoUpdater() {
  // 检查更新时触发
  autoUpdater.on('checking-for-update', () => {
    sendStatusToWindow('update-checking', { message: '正在检查更新...' });
  });

  // 有可用更新
  autoUpdater.on('update-available', (info) => {
    sendStatusToWindow('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  });

  // 没有更新
  autoUpdater.on('update-not-available', (info) => {
    sendStatusToWindow('update-not-available', {
      version: info.version
    });
  });

  // 下载进度
  autoUpdater.on('download-progress', (progressObj) => {
    sendStatusToWindow('update-download-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond
    });
  });

  // 下载完成
  autoUpdater.on('update-downloaded', (info) => {
    sendStatusToWindow('update-downloaded', {
      version: info.version
    });
  });

  // 更新错误
  autoUpdater.on('error', (err) => {
    sendStatusToWindow('update-error', {
      message: err.message || '更新检查失败'
    });
  });

  // 延迟检查更新（给窗口时间加载）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('检查更新失败:', err);
    });
  }, 5000);
}

// 向渲染进程发送更新状态
function sendStatusToWindow(event, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(event, data);
  }
}

// IPC: 检查更新
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) {
    return { success: false, error: '自动更新不可用' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: 下载更新
ipcMain.handle('download-update', async () => {
  if (!autoUpdater) {
    return { success: false, error: '自动更新不可用' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: 安装更新并重启
ipcMain.handle('install-update', async () => {
  if (!autoUpdater) {
    return { success: false, error: '自动更新不可用' };
  }
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

// IPC: 获取应用版本
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 所有窗口关闭时退出（除了 macOS）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 安全性：阻止新窗口创建
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // 只允许 file:// 协议
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
});