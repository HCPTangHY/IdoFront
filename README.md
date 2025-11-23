# IdoFront

本项目是一个以插件系统为核心的大模型聊天前端。主功能和外部插件的任何功能都可以通过框架暴露的API来进行注册和应用。

## 📦 打包方式

### 🌐 Web 版打包（推荐）

打包成标准的单页应用（index.html + app.js + custom.css），可部署到任意静态服务器，也可进一步打包成桌面/移动应用。

**首次使用需要安装依赖：**
```bash
npm install
```

**打包命令：**
```bash
npm run build:web
# 或直接运行: node build-web.js
```

**输出目录：** `web-dist/`
- `index.html` - 入口页面
- `app.js` - 打包后的 JavaScript（约 784KB）
- `custom.css` - 样式文件
- `icons/` - 图标资源

**使用方式：**
1. 直接在浏览器中打开 `web-dist/index.html` 测试
2. 将 `web-dist/` 目录部署到静态服务器（Nginx、Apache、GitHub Pages 等）
3. 使用 Capacitor/Cordova 打包成 Android APK 或 iOS IPA
4. 使用 Electron/Tauri 打包成桌面应用（Windows/macOS/Linux）

### 🧩 浏览器扩展打包

打包成 Chrome/Edge 扩展（.zip 格式）。

**打包命令：**
```bash
npm run build:extension
# 或直接运行: node pack.js
```

**输出目录：** `dist/`
- 生成 `IdoFront-vX.Y.zip` 文件，可直接上传到 Chrome Web Store 或 Edge Add-ons

**发布指南：**
- **Microsoft Edge Add-ons**: https://partner.microsoft.com/dashboard/microsoftedge/overview（免费）
- **Chrome Web Store**: https://chrome.google.com/webstore/dev/dashboard（$5 一次性注册费）

## 📁 目录结构

```
IdoFront/
├── edge-extension/          # 扩展源码目录
│   ├── manifest.json       # 扩展配置
│   ├── sidepanel.html      # 侧边栏主界面
│   ├── scripts/            # JavaScript 逻辑
│   │   ├── framework.js    # 核心框架
│   │   ├── ido-front/      # IdoFront 核心模块
│   │   └── ...
│   ├── styles/             # 样式文件
│   └── icons/              # 图标资源
├── web-dist/               # Web 版构建输出（自动生成）
├── dist/                   # 扩展打包输出（自动生成）
├── build-web.js            # Web 版打包脚本
├── pack.js                 # 扩展打包脚本
└── package.json            # 项目配置
```

## 🚀 进阶：打包成 App

### 桌面应用（Electron）

```bash
# 1. 安装 Electron
npm install electron electron-builder --save-dev

# 2. 创建 Electron 入口文件（main.js）
# 3. 配置 package.json 的 build 字段
# 4. 打包
npm run build:electron
```

### 桌面应用（Tauri，更轻量）

```bash
# 1. 安装 Tauri CLI
npm install @tauri-apps/cli --save-dev

# 2. 初始化 Tauri 项目
npx tauri init

# 3. 打包
npm run tauri build
```

### 移动应用（Capacitor）

```bash
# 1. 安装 Capacitor
npm install @capacitor/core @capacitor/cli --save-dev
npm install @capacitor/android @capacitor/ios --save-dev

# 2. 初始化 Capacitor
npx cap init

# 3. 添加平台
npx cap add android
npx cap add ios

# 4. 同步 Web 资源
npx cap sync

# 5. 在 Android Studio / Xcode 中打开并打包
npx cap open android
npx cap open ios
```