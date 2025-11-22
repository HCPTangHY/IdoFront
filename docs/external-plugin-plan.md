# IdoFront 外部插件支持梳理

## 1. 现有框架快照
- **UI/框架层**：`edge-extension/scripts/framework.js` 负责 slot 注册、插件生命周期钩子（`registerPlugin`、`setPluginEnabled`、`setMode` 等），插件只能在扩展包加载时注入。
- **核心插件**：`edge-extension/scripts/ido-front/plugins/core-plugins.js` 在启动阶段一次性注册固定插件，并通过 store 中的 `pluginStates` 控制启停。
- **设置面板**：`edge-extension/scripts/ido-front/settings/settings-manager.js` + `settings/plugin-settings.js` 仅能读取 Framework registry，无法导入/管理外部脚本。
- **存储层**：`edge-extension/scripts/ido-front/idb-storage.js` 仅保存聊天/会话状态，没有插件对象仓库，也没有 CRUD 门面可供独立 loader 使用。

## 2. 外部插件需求
1. **导入与验证**：支持文本/文件导入 JS 代码，执行前沙箱校验，执行后注册插件。
2. **生命周期**：保持与现有框架一致的 `registerPlugin` 流程，支持启停、卸载、更新；执行上下文需隔离（限定可访问 API）。
3. **持久化**：插件元数据与源码需要 IndexedDB `plugins` store 保存（字段包含 id/name/code/enabled/version/timestamps）。
4. **设置界面**：提供外部插件列表、状态切换、日志/错误提示、重新加载提示。
5. **示例与文档**：提供独立插件样例与开发指南，明确 `window.IdoFront` 可用 API、沙箱限制及调试方式。

## 3. 模块拆解
### 3.1 IndexedDB 层
- 将 `DB_VERSION` bump 到 2，新增 `plugins` object store（keyPath=`id`）。
- 在 `window.IdoFront.storage`（或 `idbStorage`）暴露 `savePlugin/getPlugin/getAllPlugins/deletePlugin/clearPlugins` 等异步函数，供 loader + UI 调用。

### 3.2 插件加载器
- 初始化时批量读取 `storage.getAllPlugins()`，逐个执行并注册。
- 新增沙箱执行器：`new Function('IdoFront', 'Framework', ...)`，禁止访问多余全局；捕获 `console` 输出、错误并回写状态。
- 启停/删除应更新内存 `loadedPlugins`，并在可能时调用 Framework 的 `unregisterPlugin`（需要插件自声明卸载函数）。
- 监听 store/plugin state 变化，保持 UI 显示与运行态一致。

### 3.3 设置 UI
- 扩充 `plugin-settings.js`：
  - **外部插件卡片**：显示名称、slot、启停开关、编辑/删除动作。
  - **导入入口**：文本框 + 上传按钮，调用 loader 的 `addPlugin`。
  - **错误提示**：展示 loader 抛出的异常信息。
- 在 `settings-manager` 中确保 `plugins` 标签默认可打开，必要时提供“刷新所有插件”按钮。

### 3.4 示例插件与工具
- 新建 `examples/external-plugins/hello-panel/idosample.js` 等文件，示范如何注册 slot、使用 `Framework.SLOTS`。
- 提供轻量 `plugin-packager.js`（可复用 `pack.js`）帮助开发者转换成可以复制粘贴的文本。

### 3.5 文档
- 在 `docs/external-plugin-guide.md` 讲解：
  - 环境准备、如何导入插件；
  - Framework API 速查表；
  - 安全/沙箱注意事项；
  - 调试技巧和常见错误；
  - 示例插件的加载步骤。

## 4. 约束与风险
- **安全性**：外部代码仍在扩展上下文执行，需强调只信任来源可靠的脚本；可以考虑未来引入 CSP 或资源限制。
- **清理机制**：插件若提供 `destroy` 函数则可在卸载时调用，否则可能遗留 DOM；需要在指南中说明最佳实践。
- **兼容性**：IndexedDB 升级需处理老用户迁移，确保 onupgradeneeded 的向后兼容。

## 5. 后续实施顺序
1. IndexedDB & storage API 扩展。
2. 插件加载器沙箱 + CRUD 衔接。
3. 设置界面交互。
4. 外部插件示例仓库。
5. 开发指南文档。
6. 端到端测试（含错误路径、刷新场景）。
