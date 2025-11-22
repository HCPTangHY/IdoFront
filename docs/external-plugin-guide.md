# IdoFront 独立插件开发指南

## 1. 概览
IdoFront 现在支持通过 "外部插件" 扩展 UI/功能。外部插件与核心扩展解耦，采用以下流程：

1. 在设置页 → 插件管理 → 外部插件 中导入 JS 代码或上传 `.js` 文件。
2. 插件代码在沙箱执行器中运行，可使用 `window.IdoFront` 与 `Framework` API。
3. 插件生命周期：注册 → 启动 → 手动启停/删除。

## 2. 可用运行环境
沙箱提供以下全局：

| 对象 | 说明 |
| --- | --- |
| `window` | 提供大部分浏览器 API（但不保证持久存在），请勿依赖 `localStorage/sessionStorage` 等敏感对象。|
| `document` | 可用于创建 DOM 元素。|
| `console` | 已添加命名空间，日志以 `[Plugin:<Name>]` 前缀输出。|
| `IdoFront` | 与扩展内一致，包含 `conversationActions`、`messageActions` 等。|
| `Framework` | 即 `edge-extension/scripts/framework.js` 导出的 API，提供 `registerPlugin`、`SLOTS`、`ui.createIconButton` 等。|
| `PluginRuntime` | 目前包含 `pluginId`、`dryRun`、`unregister(slot, id)`。未来可扩展更多助手函数。|

## 3. 插槽与注册示例
```js
(function() {
  const { registerPlugin, SLOTS, ui } = Framework;

  registerPlugin(SLOTS.SIDEBAR_BOTTOM, 'external-hello', {
    init() {
      console.log('Hello plugin ready');
    },
    renderStatic() {
      const button = ui.createIconButton({
        label: '外部问候',
        icon: 'waving_hand',
        onClick() {
          alert('这是外部插件注入的按钮');
        }
      });
      return button;
    },
    destroy() {
      console.log('Hello plugin cleanup');
    }
  });
})();
```

## 4. 导入步骤
1. 从示例目录 `examples/external-plugins` 选择一个插件脚本（如 `hello-panel/plugin.js`）。
2. 打开 IdoFront 设置 → 插件管理 → 外部插件。
3. 填写名称（示例：`Hello Panel`），粘贴代码或上传文件。
4. 点击“导入插件”，成功后会在列表中显示。
5. 可随时通过启用开关、删除按钮管理插件。

## 5. 插件最佳实践
- **命名约定**：使用 `ext-` 前缀或包含组织名称，避免与内置 `core-` 冲突。
- **清理逻辑**：如果插件会创建 DOM/事件，建议提供 `destroy()`，在停用或删除时执行。
- **错误处理**：捕获异常并通过 `console.error` 输出，插件设置页会显示最近错误。
- **配置存储**：若需要持久化，请使用 `window.IdoFront.storage` 提供的插件存储 API 或自维护结构，避免污染核心 state。

## 6. 调试技巧
- 使用 DevTools Console 查看 `[Plugin:YourPlugin]` 日志。
- 遇到加载失败，可在插件设置页查看“最近的外部插件错误”卡片。
- 如需重新加载插件，可点击停用再启用，或更新代码后保存。

## 7. 发布与共享
- 建议将插件代码放在独立仓库/文件中，用户以复制粘贴方式导入。
- 可提供自定义打包脚本（示例：`pack.js`）将多文件合并成单一 JS。

## 8. 参考资源
- [`docs/external-plugin-plan.md`](external-plugin-plan.md)
- 示例插件：[`examples/external-plugins/hello-panel/plugin.js`](../examples/external-plugins/hello-panel/plugin.js)
