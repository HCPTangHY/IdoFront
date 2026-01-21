# IdoFront 设置注册开发指南

本文档说明如何为 IdoFront 注册设置页面（Tab）与“通用设置”分区（Section），并给出推荐的字段规范与注册时机。

## 1. 概览：两类注册入口

IdoFront 的设置系统由 `window.IdoFront.settingsManager` 管理，主要有两种扩展方式：

1) **注册设置标签页（Tab）**：出现在设置左侧菜单（一级导航）
- API：`settingsManager.registerTab(tab)`

2) **注册通用设置分区（General Section）**：出现在“通用设置”标签页中（按分类分组、支持搜索/折叠）
- API：`settingsManager.registerGeneralSection(section)`

此外还有一条补充通道：
- **Framework 插槽注入**：通过 `SLOTS.SETTINGS_GENERAL`（`slot-settings-general`）注入自定义组件到“通用设置”。
- 注意：当前仅能拿到渲染结果（HTMLElement/string），无法读取 meta，因此默认不参与通用设置的“分类/搜索”。

## 2. 标准 API：registerTab

### 2.1 字段约定

```js
window.IdoFront.settingsManager.registerTab({
  id: 'mcp',                // 必填：唯一 ID
  label: 'MCP 服务',         // 必填：左侧菜单显示名称
  icon: 'dns',              // 必填：Material Symbols 名称，或以 <svg 开头的 SVG 字符串
  order: 34,                // 可选：排序，越小越靠前
  render: (container, ctx, st) => {
    // 必填：渲染函数
    // container: 容器元素
    // ctx: Framework 实例
    // st: store 实例
  }
});
```

### 2.2 建议

- `id` 不要复用，建议使用稳定前缀（例如 `mcp`、`data`、`model-features`）。
- `icon` 避免与其他常用菜单冲突（例如插件使用 `extension`，MCP 更适合 `dns`/`api`/`hub` 这类）。
- `render` 统一使用签名：`render(container, ctx, st)`。

## 3. 标准 API：registerGeneralSection

### 3.1 字段约定（推荐）

```js
window.IdoFront.settingsManager.registerGeneralSection({
  id: 'gemini-thinking',
  title: 'Gemini 思考功能',
  description: '配置 Gemini 模型的思考预算/等级匹配规则（正则表达式）',
  icon: 'psychology',

  // ===== 推荐字段（用于通用设置页的分类/搜索/高级开关） =====
  category: '模型特性',
  tags: ['Gemini', 'thinking', 'thinkingBudget', 'thinkingLevel', '正则', '模型'],
  advanced: false, // 仅在确实属于实验/调试/风险项时设为 true

  order: 20,
  render: (container, ctx, st) => {
    container.innerHTML = '';
    // ...渲染表单
  }
});
```

### 3.2 分类建议（可按需扩展）

- `外观`
- `AI 服务`
- `模型特性`
- `性能`
- `其它`

### 3.3 advanced 的含义

- `advanced: true`：默认隐藏，仅在用户开启“显示实验性/高级选项”时显示。
- 适用场景：实验功能、性能/缓存策略、调试开关、可能引入兼容性问题的选项。
- 不建议把“正常使用必看的设置”（例如模型能力规则）放进 advanced。

## 4. 注册时机：如何保证可用

由于脚本加载顺序/初始化时机不同（例如 channel 模块可能早于 `settingsManager.init` 执行），推荐使用“双保险”模式：

```js
function registerMySection() {
  const sm = window.IdoFront?.settingsManager;
  if (!sm?.registerGeneralSection) return;
  sm.registerGeneralSection({ /* ... */ });
}

// 1) 尝试立即注册（如果 settingsManager 已经就绪）
registerMySection();

// 2) 监听 settings 就绪事件（只注册一次）
if (typeof document !== 'undefined') {
  document.addEventListener('IdoFrontSettingsReady', () => {
    registerMySection();
  }, { once: true });
}
```

## 5. 常见问题

### Q1：为什么我注册了 section，但通用设置里没看到？

- 检查是否真的执行到了注册逻辑（脚本是否加载）。
- 检查 `settingsManager` 是否已就绪：`window.IdoFront.settingsManager?.registerGeneralSection`。
- 如果 section 标记了 `advanced: true`，需要在通用设置页打开“显示实验性/高级选项”。
- 如果你在搜索状态下找不到，检查 `title/description/tags` 是否包含你搜索的关键词。

### Q2：我的插件通过 SETTINGS_GENERAL 注入了内容，但无法被搜索/分类？

- 这是当前架构限制：Framework 插槽只返回渲染结果，缺少 meta。
- 推荐：核心功能/重要设置使用 `registerGeneralSection`，插件 UI 适合用 `SETTINGS_GENERAL` 插槽补充。
