# IdoFront

本项目是一个以插件系统为核心的大模型聊天前端。主功能和外部插件的任何功能都可以通过框架暴露的API来进行注册和应用。

## 📦 快速打包

本项目包含一个自动化打包脚本，无需安装任何额外依赖。

1. **更新版本号**：在 `edge-extension/manifest.json` 中修改 `"version"` 字段。
2. **运行打包脚本**：
   ```bash
   node pack.js
   ```
3. **获取文件**：打包好的 `.zip` 文件将生成在 `dist/` 目录下。


## 📁 目录结构

*   `edge-extension/` - 插件源码目录
    *   `manifest.json` - 配置文件
    *   `sidepanel.html` - 侧边栏主界面
    *   `scripts/` - JS 逻辑
    *   `styles/` - 样式文件
*   `pack.js` - 自动化打包脚本
*   `dist/` - 打包输出目录