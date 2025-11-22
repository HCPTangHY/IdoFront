# IdoFront Extension - 发布指南

本项目是一个基于 Manifest V3 的浏览器扩展，**一套代码完美兼容 Microsoft Edge 和 Google Chrome**。

## 📦 快速打包

本项目包含一个自动化打包脚本，无需安装任何额外依赖。

1. **更新版本号**：在 `edge-extension/manifest.json` 中修改 `"version"` 字段。
2. **运行打包脚本**：
   ```bash
   node pack.js
   ```
3. **获取文件**：打包好的 `.zip` 文件将生成在 `dist/` 目录下。

## 🌍 双平台发布说明

由于 Edge 基于 Chromium 内核，本插件的代码在两个平台上是**完全通用**的。

### 🔵 Microsoft Edge Add-ons (Edge 商店)
*   **兼容性**：原生支持，无需任何修改。
*   **开发者中心**：[Partner Center](https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview)
*   **费用**：免费。
*   **审核速度**：通常 1-3 个工作日。

### 🔴 Chrome Web Store (Chrome 商店)
*   **兼容性**：原生支持，直接上传同一个 `.zip` 文件即可。
*   **开发者中心**：[Chrome Web Store Dashboard](https://chrome.google.com/webstore/dev/dashboard)
*   **费用**：需支付 $5 美元的一次性注册费。
*   **Side Panel 支持**：Chrome 114+ 已全面支持 Side Panel API，与 Edge 保持一致。

## 🛠️ 开发注意事项 (Manifest V3)

1. **权限最小化**：只申请必要的权限。目前的 `manifest.json` 已优化，移除了未使用的 `cdn.tailwindcss.com` 权限。
2. **API 差异**：
   *   代码中已使用标准的 `chrome.*` API（如 `chrome.runtime`），Edge 会自动兼容这些 API。
   *   无需将 `chrome` 替换为 `browser` 或 `msBrowser`。
3. **CSP (内容安全策略)**：
   *   Manifest V3 禁止加载远程代码。本项目已使用本地 `tailwind.js`，完全符合安全规范。

## 📁 目录结构

*   `edge-extension/` - 插件源码目录
    *   `manifest.json` - 配置文件
    *   `sidepanel.html` - 侧边栏主界面
    *   `scripts/` - JS 逻辑
    *   `styles/` - 样式文件
*   `pack.js` - 自动化打包脚本
*   `dist/` - 打包输出目录