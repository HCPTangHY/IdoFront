# IdoFront

一个以“插件系统”为核心的大模型聊天前端，支持浏览器扩展和纯 Web 单页应用两种形态。主功能和外部插件共享同一套运行时和 UI 插槽体系，任何能力都可以通过框架暴露的 API 注册进来。

## ✨ 特性概览

- 模块化框架：布局、面板、消息流完全由插件驱动。
- 插件友好：支持内置插件和沙箱外部插件，UI / Channel / 主视图都可扩展。
- 多通道支持：通过 Channel Registry 统一适配 OpenAI、Gemini 等模型服务。
- 强调可观测性：内置网络日志面板、流式输出控制、思考链展示。
- 一次构建，多处部署：同一代码可打包为 Edge/Chrome 扩展或任意静态 Web 应用。

## 🏗 整体架构

IdoFront 主要分为三层：

1. 框架层（Framework）：负责布局、插槽系统、面板切换等。
2. 业务核心（IdoFront Core）：负责会话 / 消息 / 通道 / 设置等业务逻辑。
3. 插件与扩展层：包括内置核心插件和通过沙箱加载的外部插件。

### 1. 框架层（Framework）

框架入口在 [`framework.js`](edge-extension/scripts/framework.js)，通过一组公开 API 向上层暴露布局和插件能力：

- 插槽与插件系统：[`Framework.SLOTS`](edge-extension/scripts/framework.js:547)、[`Framework.registerPlugin()`](edge-extension/scripts/framework.js:560)、[`Framework.unregisterPlugin()`](edge-extension/scripts/framework.js:676)、[`Framework.setPluginEnabled()`](edge-extension/scripts/framework.js:665)
- 视图模式与主视图切换：[`Framework.setMode()`](edge-extension/scripts/framework.js:142) 允许在“聊天”等模式与自定义主视图之间切换。
- 右侧面板控制：[`Framework.setDefaultRightPanel()`](edge-extension/scripts/framework.js:225)、[`Framework.setCustomPanel()`](edge-extension/scripts/framework.js:261)
- 底部抽屉：[`Framework.showBottomSheet()`](edge-extension/scripts/framework.js:282)、[`Framework.hideBottomSheet()`](edge-extension/scripts/framework.js:306)
- 消息渲染管线：[`Framework.addMessage()`](edge-extension/scripts/framework.js:947)、[`Framework.updateLastMessage()`](edge-extension/scripts/framework.js:1299)、[`Framework.finalizeStreamingMessage()`](edge-extension/scripts/framework.js:1465)

Header / 输入区等核心 UI 由 Framework 负责创建，并在中间区域预留多个插件插槽（例如 [`HEADER_ACTIONS`](edge-extension/scripts/framework.js:547)、[`INPUT_TOP`](edge-extension/scripts/framework.js:547)、[`MESSAGE_FOOTER`](edge-extension/scripts/framework.js:547)），供内置和外部插件挂载控件。

### 2. 业务核心（IdoFront Core）

业务初始化入口为 [`window.IdoFront.init()`](edge-extension/scripts/ido-front/main.js:15)，由浏览器扩展页面或 Web 入口在加载时调用，注入 Framework 实例：

- 状态管理：[`store.js`](edge-extension/scripts/ido-front/store.js) 是唯一业务状态源，管理 persona、conversation、channel、pluginStates、networkLogs 等。
- 入口装配：[`main.js`](edge-extension/scripts/ido-front/main.js) 在初始化时依次装配：
  - 对话相关动作 [`conversationActions`](edge-extension/scripts/ido-front/actions/conversation.js)
  - 消息相关动作 [`messageActions`](edge-extension/scripts/ido-front/actions/message.js)
  - 模型选择器插件 [`model-selector`](edge-extension/scripts/ido-front/plugins/model-selector.js)
  - 主插件集合 [`corePlugins`](edge-extension/scripts/ido-front/plugins/core-plugins.js)
  - 外部插件加载器 [`plugin-loader`](edge-extension/scripts/ido-front/plugin-loader.js)
  - 设置中心 [`settings-manager`](edge-extension/scripts/ido-front/settings/settings-manager.js)

对外，`IdoFront.init` 返回一个轻量级 API，用于宿主或上层脚本访问当前状态和常用动作（发送消息、新建/切换对话、保存 Channel 等）。

### 3. 通道与网络日志

- 通道注册中心：[`channel-registry.js`](edge-extension/scripts/ido-front/channels/channel-registry.js) 提供注册和调用各类模型通道的统一入口（如 `openai`、`gemini` 等）。
- OpenAI 通道：[`openai-channel.js`](edge-extension/scripts/ido-front/channels/openai-channel.js) 负责适配 OpenAI / 兼容协议 API，支持流式输出与 `reasoning_effort` 等高级参数。
- Gemini 通道：[`gemini-channel.js`](edge-extension/scripts/ido-front/channels/gemini-channel.js) 负责适配 Google Gemini。
- 网络日志：[`network-logger.js`](edge-extension/scripts/ido-front/network-logger.js) + [`network-log-panel.js`](edge-extension/scripts/ido-front/plugins/network-log-panel.js) 提供统一的请求 / 响应可视化面板。

### 4. 插件与扩展层

核心插件由 [`core-plugins.js`](edge-extension/scripts/ido-front/plugins/core-plugins.js) 在启动时统一注册，包括：

- 侧边栏头部、历史记录、新建会话按钮。
- 面具切换器、主题切换、模型选择器。
- 输入框上方工具栏：流式开关、思考预算 (reasoning_effort) 控件等。
- 消息气泡脚部操作：编辑 / 复制 / 重试 / 删除。

外部插件通过沙箱加载器 [`plugin-loader.js`](edge-extension/scripts/ido-front/plugin-loader.js) 引入，并在设置面板中集中管理。外部插件可以：

- 向不同插槽注入 UI（按钮、面板、工具条）。
- 注册新的模型通道类型（如自定义 API 或代理）。
- 使用统一的 runtime API 访问 Store、Channel、日志等能力。

更详细的外部插件机制设计见文档：[`docs/external-plugin-plan.md`](docs/external-plugin-plan.md)。

## 📦 构建与打包

在开始之前，请先安装依赖：

```bash
npm install
```

### 1. 构建 Web 单页应用（推荐）

使用打包脚本 [`build-web.js`](build-web.js) 生成可直接部署的 SPA：

```bash
npm run build:web
# 或
node build-web.js
```

输出目录：`web-dist/`

- `index.html` - 入口页面
- `app.js` - 打包后的 JavaScript
- `custom.css` - 样式文件
- `icons/` - 图标资源

使用方式示例：

- 在本地浏览器直接打开 `web-dist/index.html` 进行测试。
- 将 `web-dist/` 部署到任意静态服务器（Nginx / Apache / GitHub Pages 等）。
- 作为静态资源挂载到 Electron / Tauri / Capacitor 等容器中。

### 2. 构建浏览器扩展（Edge / Chrome）

使用打包脚本 [`pack.js`](pack.js) 生成浏览器扩展压缩包：

```bash
npm run build:extension
# 或
node pack.js
```

输出目录：`dist/`

- `IdoFront-vX.Y.zip`：可直接上传到 Edge Add-ons 或 Chrome Web Store。

扩展入口配置见 [`manifest.json`](edge-extension/manifest.json)，默认以 `sidepanel.html` 作为侧边栏页面。

### 3. 打包为桌面 / 移动应用（思路）

基于 `web-dist/` 输出，可以进一步：

- Electron / Tauri：打包为 Windows / macOS / Linux 桌面应用。
- Capacitor：打包为 Android / iOS 原生壳应用。

这些流程可参考官方文档，并将 `web-dist/` 作为 Web 资源目录接入。

## 📁 目录结构概览

```text
IdoFront/
├── edge-extension/                 # 浏览器扩展源码
│   ├── manifest.json               # 扩展配置
│   ├── sidepanel.html              # 侧边栏主界面
│   ├── sandbox.html                # 外部插件沙箱页面
│   ├── scripts/
│   │   ├── framework.js            # 框架与插件系统核心
│   │   ├── plugins.js              # 与 IdoFront 集成的入口脚本
│   │   ├── ido-front/
│   │   │   ├── main.js             # IdoFront 初始化入口
│   │   │   ├── store.js            # 业务状态管理
│   │   │   ├── actions/            # conversation / message 等动作
│   │   │   ├── channels/           # 通道适配器与注册中心
│   │   │   ├── plugins/            # 内置插件（模型选择、文件上传、主题切换等）
│   │   │   ├── settings/           # 设置页面及插件管理 UI
│   │   │   └── runtime.js          # 对外暴露的 runtime 辅助
│   ├── styles/
│   │   └── custom.css              # Tailwind + 自定义样式
│   └── icons/                      # 扩展图标
├── docs/
│   ├── external-plugin-guide.md    # 外部插件开发指南（详细版）
│   ├── external-plugin-plan.md     # 外部插件架构设计与演进计划
│   └── image-gallery-main-view-plugin-plan.md # 生图主视图插件方案
├── examples/
│   └── external-plugins/
│       ├── hello-panel/            # 外部 UI 插件示例
│       │   └── plugin.js
│       └── skugemini-channel/      # 外部 Channel 插件示例
│           └── plugin.js
├── src/                            # 构建前的源代码入口（Web 打包）
│   ├── web-entry.js                # Web 构建入口
│   └── plugins/                    # 部分插件源码（构建后注入）
├── build-web.js                    # Web 打包脚本（基于 esbuild）
├── pack.js                         # 扩展打包脚本
└── package.json
```

## 🔌 插件体系与编写指南（概要）

IdoFront 的目标是“所有能力都通过插件接入”。插件大致分为三类：

1. UI 插件：向侧边栏、头部、输入区、消息气泡等位置插入控件。
2. Channel 插件：注册新的模型调用通道。
3. 主视图插件（规划中）：接管整个主内容区，例如图片 gallery 视图。

更完整的开发说明请参考详细文档 [`docs/external-plugin-guide.md`](docs/external-plugin-guide.md)。下面是缩略版快速入门。

### 1. 插槽（Slots）与生命周期

所有插件都挂载到某个插槽（Slot）上，由 [`Framework.SLOTS`](edge-extension/scripts/framework.js:547) 预定义：

- `SIDEBAR_TOP` / `SIDEBAR_BOTTOM`：侧边栏顶部 / 底部。
- `HEADER_ACTIONS`：聊天头部右侧按钮区域。
- `INPUT_TOP`：输入框上方工具栏（如流式开关、思考预算）。
- `INPUT_ACTIONS_LEFT` / `INPUT_ACTIONS_RIGHT`：输入框内左 / 右侧操作区域。
- `MESSAGE_FOOTER`：每条消息气泡下方的操作区（复制 / 重试 / 删除等）。

注册插件时，需要提供唯一 id 和渲染函数 / 对象定义，通过 [`Framework.registerPlugin()`](edge-extension/scripts/framework.js:560) 完成：

- 注册后，Framework 会在对应 DOM 容器中调用插件的 `render` / `renderStatic`，并根据 `enabled` 字段决定是否渲染。
- 插件可以实现 `init(frameworkApi)` 和 `destroy(frameworkApi)`，用于初始化资源和清理 DOM / 事件监听。

### 2. 内置插件（Core Plugins）

内置插件集中定义在 [`core-plugins.js`](edge-extension/scripts/ido-front/plugins/core-plugins.js)，并在初始化时由 [`corePlugins.init()`](edge-extension/scripts/ido-front/plugins/core-plugins.js:17) 统一注册：

- 侧边栏头部 / 新建对话按钮：[`registerSidebarHeader()`](edge-extension/scripts/ido-front/plugins/core-plugins.js:56)、[`registerNewChatButton()`](edge-extension/scripts/ido-front/plugins/core-plugins.js:93)
- 面具切换器：[`registerPersonaSwitcher()`](edge-extension/scripts/ido-front/plugins/core-plugins.js:117)
- 模型选择器挂载：[`registerModelSelector()`](edge-extension/scripts/ido-front/plugins/core-plugins.js:308)
- 输入框上方工具栏：[`registerHeaderActions()`](edge-extension/scripts/ido-front/plugins/core-plugins.js:322)（流式开关 + 思考预算）
- 消息操作按钮：[`registerMessageActions()`](edge-extension/scripts/ido-front/plugins/core-plugins.js:552)

熟悉这些实现有助于编写风格一致且与核心能力高度集成的自定义插件。

### 3. 外部 UI 插件快速上手

外部 UI 插件的典型运行流程：

1. 在沙箱页面中执行插件脚本。
2. 插件脚本通过全局 [`Framework`](edge-extension/scripts/framework.js) 和 [`IdoFront`](edge-extension/scripts/ido-front/main.js) API 注册自己。
3. 插件的 UI 渲染函数会收到 `frameworkApi`，可以使用其中的 `ui.createIconButton`、`addMessage` 等能力。

例如示例插件 [`examples/external-plugins/hello-panel/plugin.js`](examples/external-plugins/hello-panel/plugin.js) 会在头部右侧插入一个“Hello”按钮，点击后在对话中插入一条问候消息。

该插件使用的核心 API：

- 插槽常量：[`Framework.SLOTS.HEADER_ACTIONS`](edge-extension/scripts/framework.js:547)
- 注册函数：[`Framework.registerPlugin()`](edge-extension/scripts/framework.js:560)
- UI 工具：[`Framework.ui.createIconButton()`](edge-extension/scripts/framework.js:903)
- 消息写入：[`Framework.addMessage()`](edge-extension/scripts/framework.js:947)

外部插件的导入与管理流程详见 [`docs/external-plugin-guide.md`](docs/external-plugin-guide.md) 第 4 节“导入步骤”。

### 4. 外部 Channel 插件概览

除了 UI 插件，插件还可以注册新的通道类型，供 IdoFront 统一调用。例如：

- 在沙箱中调用 [`channelRegistry.registerType()`](edge-extension/scripts/ido-front/channels/channel-registry.js:77) 注册新的通道类型。
- 由 Loader 把该通道暴露给主应用，出现在 Channel 列表中。
- 消息发送时，`messageActions` 会通过 Channel Registry 调用该适配器。

示例可参考 [`examples/external-plugins/skugemini-channel/plugin.js`](examples/external-plugins/skugemini-channel/plugin.js) 以及设计文档 [`docs/external-plugin-plan.md`](docs/external-plugin-plan.md) 第 3.3 节。

### 5. 主视图插件（规划与实践）

未来计划将“聊天主视图”与“生图 gallery”等视图统一抽象为“主视图插件”，通过 [`Framework.setMode()`](edge-extension/scripts/framework.js:142) 接管整个主内容区。

相关设计讨论见：[`docs/image-gallery-main-view-plugin-plan.md`](docs/image-gallery-main-view-plugin-plan.md)。

## 🧪 开发与调试建议

- 使用浏览器 DevTools 查看 `[Plugin:Name]` 前缀日志，调试外部插件行为。
- 借助网络日志面板观察每次模型调用的请求体与响应，用于排查参数传递（如 `stream`、`reasoning_effort`）是否正确。
- 如需在本地反复尝试插件脚本，可使用“插件管理”页的外部插件区域反复导入 / 更新。
- 对于较复杂的主视图或 Channel 逻辑，建议先以内置插件形式在仓库中迭代成熟，再抽象为外部插件示例对外公开。

本 README 仅作为 IdoFront 的整体概览与插件编写速查入口，更细节的接口说明与演进规划请直接查阅 [`docs/`](docs) 与 [`edge-extension/scripts/ido-front/`](edge-extension/scripts/ido-front) 目录下的源码与注释。