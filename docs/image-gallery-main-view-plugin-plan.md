# 生图主视图插件可行性评估

## 1. 背景与目标

- 现有 IdoFront 已支持通过外部插件扩展 UI 和 Channel，但主内容区（气泡聊天区）仍由核心代码直接控制。
- 希望实现一个“生图视图独立插件”（以插件形式注册、受插件管理），将主内容区改造成类似 gallery 的任务队列：
  - 底部输入 prompt，选择模型、设置生成次数/重试策略；
  - 一次操作并发发出多次调用；
  - 主视图以图片任务卡片和详情页展示结果。
- 要求：
  - 不为任何单一插件（包括生图插件）写特例逻辑；
  - 内建插件和外部插件在架构上“平权”，都通过统一的插件体系管理。

## 2. 关键约束

- 主内容区必须通过统一的 API / 插槽暴露出来，现有气泡聊天也需要迁移到该体系下，而不是写死在框架里。
- 调用层（Channel Registry + adapter）尽量保持不改；gallery 只改变“接受层”和 UI。
- Store 的访问和扩展方式需要统一抽象，对内建 / 外部插件一视同仁：
  - 核心业务状态（persona / conversation / channel 等）只读暴露；
  - 插件私有状态通过独立命名空间或独立存储，而不是随意读写核心 state 对象。

## 3. 当前架构要点快照

### 3.1 框架层（布局 + 插槽 + 主视图容器）

- 文件：[`framework.js`](edge-extension/scripts/framework.js)
- 布局与主容器：在 [`bindUI()`](edge-extension/scripts/framework.js:26) 中收集 DOM 引用：
  - `ui.mainSlots.header` / `ui.mainSlots.stream` / `ui.mainSlots.input` 对应当前聊天主区域。
- 视图模式管理：[`setMode(mode, renderers)`](edge-extension/scripts/framework.js:136) 已经支持：
  - `mode === 'chat'`：显示默认的聊天主视图（使用 `ui.mainSlots`）；
  - 其他 mode：隐藏默认主视图，使用 `getOrCreateContainer('main', ...)` 创建自定义主容器，并调用传入的 `renderers.main` / `renderers.sidebar`。
- 右侧面板已经是“默认 + 可覆盖”的插件化模型：
  - [`setDefaultRightPanel(renderer)`](edge-extension/scripts/framework.js:174) 定义默认底层内容（当前为网络日志面板）；
  - [`setCustomPanel('right', renderer)`](edge-extension/scripts/framework.js:214) 可以为右侧面板注入自定义视图或恢复默认。
- 插件系统：通过 [`registerPlugin(slot, id, definition)`](edge-extension/scripts/framework.js:514) 提供 Sidebar / Header / Input / Message Footer 等 slot；
  - `SLOTS.MESSAGE_FOOTER` 用于注册消息操作按钮（复制 / 重试 / 删除等）。

结论：框架已经具备“替换主视图容器”的基础能力（`setMode` + 自定义容器），目前只是聊天视图被硬编码为 `mode='chat'` 的默认态，还没有正式抽象成“主视图插件”。

### 3.2 Store 层（业务状态）

- 文件：[`store.js`](edge-extension/scripts/ido-front/store.js)
- 单一业务状态源：[`window.IdoFront.store.state`](edge-extension/scripts/ido-front/store.js:15) 包含：
  - `personas` / `activePersonaId`
  - `conversations` / `activeConversationId`
  - `channels`（渠道列表）
  - `pluginStates`（`slot::id`: enabled）
  - `networkLogs` 等辅助结构。
- Store 内部封装了一系列修改器：
  - `createConversationInternal()` / `addMessageToConversation()` / `setConversationModel()` 等，保证状态结构的一致性（参见 [`store.js`](edge-extension/scripts/ido-front/store.js:254) 一段）。
- 事件总线：[`store.events`](edge-extension/scripts/ido-front/store.js:28) 用于对外广播 `updated` / `persona:changed` / `personas:updated` 等事件。
- 当前只有内建模块（conversationActions / messageActions / corePlugins / pluginLoader 等）直接持有 `store` 引用，外部插件看不到这个内部对象。

### 3.3 Channel 层（调用适配器）

- 文件：[`channel-registry.js`](edge-extension/scripts/ido-front/channels/channel-registry.js)
- 作用：统一注册 / 查询 / 卸载各类渠道 type；每个渠道通过 `adapter.call()` / 可选 `adapter.fetchModels()` 提供实际调用能力。
- 注册入口：[`registerType(type, definition, options)`](edge-extension/scripts/ido-front/channels/channel-registry.js:77)，内部做：
  - 定义 `defaults` / `capabilities`；
  - 记录 `source`（如 `core` / `external` / `plugin:xxx`）；
  - 同步一个兼容层到 `legacyChannels[type] = adapter`。
- 插件（包括沙箱中的外部插件）可以走 `channelRegistry.registerType` 注册自己的 Channel 类型，由主应用统一消费。

### 3.4 外部插件加载器（沙箱）

- 文件：[`plugin-loader.js`](edge-extension/scripts/ido-front/plugin-loader.js)
- 功能：
  - 通过 IndexedDB 恢复外部插件列表，使用隐藏的 [`sandbox.html`](edge-extension/sandbox.html) iframe 沙箱执行插件代码；
  - 把沙箱内插件注册的 Channel 映射为主进程中的代理 Channel：[`handleRegisterChannel(payload)`](edge-extension/scripts/ido-front/plugin-loader.js:226)。
- 插件在沙箱内通过 `postMessage` 发送：
  - `CHANNEL_CALL` / `CHANNEL_FETCH_MODELS` 等消息，由 Loader 转发到真实 Channel 适配器。
- Loader 自身也直接操作 Store 的 `networkLogs` 字段，构造统一的网络日志记录。

## 4. 目标：生图 gallery 主视图插件（作为统一主视图体系的一种实现）

希望实现的插件形态：

- 以“插件”的方式注册和管理（可以在插件设置中启用 / 禁用 / 切换），但实现代码可以是 builtin。
- 激活后接管主内容区：
  - 使用 Framework 提供的主视图容器 API，在聊天区域渲染一个“生图任务队列 + gallery”；
  - 底部输入区上的工具栏用于控制生成次数 / 重试 / 并发等参数。
- 业务逻辑：
  - 一次操作可以拆成多次 Channel 调用（同模型多次或多模型并发）；
  - 结果以图片任务卡片形式展示，点击可展开详情页（大图、参数、调用日志等）；
  - 在 Store 中为该插件维护自己的任务队列 / 历史记录。
- 架构约束：
  - 与现有聊天主视图平权：同样通过“主视图插件能力”接管主内容区，而不是在 Framework 里 hardcode 一个 gallery 模式；
  - 与外部插件共用同一套 runtime / Store / Channel API，只是 builtin 插件的代码打包在扩展内。

## 5. 可行性评估结论

### 5.1 主内容区：抽象为“主视图插件能力”是可行的

- 现有 [`Framework.setMode(mode, renderers)`](edge-extension/scripts/framework.js:136) 已经支持：
  - 根据 `mode` 决定使用默认聊天主视图还是自定义主视图容器；
  - 在自定义模式下，为 sidebar / main 分别提供容器，并带有统一的切换动画。
- 因此，只需做“通用化”的演进即可：
  1) 定义“主视图插件”的约定（不限于 gallery）：
     - 插件通过某种形式声明 `modeId` + `renderMain(container, runtime)` / `renderSidebar(container, runtime)`；
     - 插件管理层保证同一时间只启用一个主视图插件，并在切换时调用 `setMode(activeModeId, renderers)`。
  2) 把现有聊天主视图迁移为一个主视图插件：
     - 将目前散落在 [`framework.js`](edge-extension/scripts/framework.js) 中的聊天渲染逻辑（如 `addMessage` / `updateLastMessage` / `finalizeStreamingMessage` 等）收拢到一个 `core-chat-view` 插件；
     - 该插件启用时调用 `setMode('core-chat-view', ...)`，禁用或切换时恢复默认。
  3) 生图 gallery 插件仅是“主视图插件”的一种实现：
     - 同样通过 `setMode('image-gallery', ...)` 接管主视图，不需要 Framework 针对 gallery 增加专用逻辑。

### 5.2 调用层（Channel）：无需为 gallery 做结构性改动

- Channel 层已经通过 [`channelRegistry`](edge-extension/scripts/ido-front/channels/channel-registry.js) 抽象：
  - 插件可以注册新的 Channel type（包括生图模型通道）；
  - 主应用通过统一的 `adapter.call()` / `adapter.fetchModels()` 消费。
- 生图 gallery 插件的职责是：
  - 将用户一次操作拆解为多次 Channel 调用（带上 prompt、seed、尺寸、采样步数等生图参数）；
  - 消费返回的图片数据（URL / base64 等），在自己的 UI 中以任务卡片形式展示。
- 因此：
  - 调用层不需要新增任何“gallery 特有 API”；
  - 只要为生图模型定义合适的 Channel type，gallery 插件可以完全复用现有 Channel 体系。

### 5.3 Store：需要设计统一的插件访问与扩展 API（但对所有插件一视同仁）

- 当前 Store 对内建模块暴露的是“强引用 + 完整读写权限”，对外部插件完全隐藏。要达到“内外一视同仁”，需要拆成两类能力：

1) 核心业务状态的只读访问（所有插件共用）

- 对所有插件（内建 / 外部）暴露一个统一的 runtime API，例如：
  - `runtime.getState(selector)`：内部读取 `store.state`，只返回 selector 关注的部分；
  - `runtime.onStore(event, handler)`：代理 `store.events.on`，允许插件订阅 `updated` / `persona:changed` 等。
- 对外部插件（沙箱）通过 [`plugin-loader`](edge-extension/scripts/ido-front/plugin-loader.js) 的 `postMessage` 协议桥接：
  - 在 Loader 中增加 `STORE_GET` / `STORE_SUBSCRIBE` 消息类型，由主进程读写真实 Store 并转发结果；
  - 沙箱内插件只知道 `PluginRuntime.store.getState(...)` / `PluginRuntime.store.on(...)`。
- 对内建插件，可以直接用同一个 runtime 抽象（性能更好，但不暴露裸 `store` 对象）。

2) 插件私有状态 / 持久化（不污染核心 state 结构）

- 为插件准备一个受控的扩展空间，例如：
  - 在 Store 中增加 `pluginData[pluginId]` 字段，仅由该插件访问；或
  - 直接通过 `IdoFront.storage` / IndexedDB 提供“插件命名空间存储”。
- 生图 gallery 插件可以将自己的任务队列、生成历史、UI 状态等放在该空间：
  - 不需要改动核心 `conversations` 结构；
  - 不会为 gallery 单独增加特殊字段。

结论：Store 需要做一定的抽象工作，但这些工作都是“对所有插件统一开放能力”，而不是为生图插件写特例。

## 6. 重构建议（高层步骤）

1) 主视图插件化基础设施

- 在 Framework 层正式定义“主视图插件”的约定：以 `modeId + renderers` 的形式使用 [`setMode()`](edge-extension/scripts/framework.js:136)。
- 把现有聊天主视图迁移成 `core-chat-view` 插件，验证：启用 / 禁用 / 切换逻辑是否正常。

2) Store runtime API 抽象

- 为插件定义统一的 `runtime.store` API：`getState` / `onStore` / 插件私有存储。
- 在 [`plugin-loader`](edge-extension/scripts/ido-front/plugin-loader.js) 中通过消息桥接这套 API 到沙箱内外部插件。

3) 生图 gallery 主视图插件（builtin 实现）

- 基于上述“主视图插件能力”和 `runtime.store` / Channel 体系：
  - 实现一个 builtin 的 `image-gallery` 插件，代码打包在扩展中；
  - 在插件管理 UI 中以普通插件身份展示和控制（可启用 / 禁用）；
  - 启用时通过 `setMode('image-gallery', ...)` 接管主内容区并渲染 gallery。

4) 后续增强

- 为外部插件提供开发文档和示例，说明如何：
  - 注册主视图插件；
  - 使用 `runtime.store` 访问核心状态；
  - 使用 Channel 注册和调用生图 / 其他类型模型。
- 逐步让更多 UI 能力（例如 inspector、network log 视图等）也迁移到统一的插件体系中，减少内建特例逻辑。

## 7. 总结

- 在“不为任何插件搞特殊”的前提下，目前架构通过适度的通用化重构，可以支持：
  - 将聊天主视图和未来的生图 gallery 都视为“主视图插件”；
  - 内建插件和外部插件共用一套 runtime / Store / Channel 抽象；
  - 生图 gallery 插件作为其中一种实现，以插件形态接管主内容区，负责把 Channel 调用结果渲染成 gallery 队列和详情页。