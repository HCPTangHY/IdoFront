# IdoFront 外部插件开发指南

## 1. 概览

IdoFront 支持通过"外部插件"扩展 UI 和功能。新版插件系统采用 **混合 YAML/JS 格式**，将声明式配置与脚本逻辑分离：

- **YAML 声明部分**：元数据、UI 组件、**自定义样式**、设置表单、Channel 配置（主线程直接解析，零延迟）
- **JS 脚本部分**：复杂逻辑如 Channel adapter（在沙箱中安全执行）

这种设计让 80% 的简单插件可以纯声明式实现，只有复杂场景才需要编写 JS。

## 2. 插件格式

### 2.1 混合 YAML 格式（推荐）

使用 `.yaml` 或 `.plugin.yaml` 扩展名，YAML 中使用 `script: |` 多行字符串嵌入 JS：

```yaml
# plugin.yaml
id: my-plugin
version: 1.0.0
name: 我的插件
description: 插件描述
author: Your Name
icon: extension

# 自定义样式（可选）
styles: |
  .my-btn { background: #007bff; }

# 声明式 UI（主线程渲染，零延迟）
ui:
  INPUT_TOP:
    - id: my-status
      component: md-chip
      props:
        text: 状态
        color: blue

# 声明式设置表单
settings:
  fields:
    enabled:
      type: boolean
      label: 启用功能
      default: true

# Channel 配置
channel:
  type: my-channel
  label: My Channel
  defaults:
    baseUrl: https://api.example.com
  capabilities:
    streaming: true
    vision: false

# JS 脚本（复杂逻辑，沙箱执行）
script: |
  const adapter = {
    async call(messages, config, onUpdate, signal) {
      // Channel 逻辑
    }
  };
  Plugin.registerChannel(adapter);
```

### 2.2 纯 JS 格式（向后兼容）

仍然支持传统的纯 JS 插件格式：

```javascript
// @name My Plugin
// @version 1.0.0

(function() {
  'use strict';
  // 插件代码
})();
```

## 3. 插件类型

| 类型 | 描述 | 推荐格式 |
|-----|------|---------|
| 纯 UI 插件 | 添加按钮、状态指示器等 | 纯 YAML |
| 纯 Channel 插件 | 自定义 API 渠道 | YAML + JS |
| UI + Channel 组合 | 带 UI 的渠道插件 | YAML + JS |
| 简单 API 代理 | 继承现有渠道类型 | 纯 YAML |

## 4. 自定义样式

插件可以通过 `styles` 字段注入自定义 CSS，主线程直接注入 `<head>`，零延迟生效。

### 4.1 基础用法

```yaml
styles: |
  /* 自定义按钮样式 */
  .my-plugin-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
    transition: all 0.3s ease;
  }
  
  .my-plugin-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }
  
  /* 动画 */
  @keyframes my-animation {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
```

### 4.2 结合 UI 组件使用

在组件的 `props.class` 中引用自定义类：

```yaml
styles: |
  .fancy-chip {
    background: linear-gradient(45deg, #ff6b6b, #feca57) !important;
    color: white !important;
    font-weight: bold !important;
  }

ui:
  HEADER_ACTIONS:
    - component: md-chip
      props:
        text: 花哨标签
        class: fancy-chip
```

### 4.3 Scoped 样式（可选）

为避免样式污染，可启用作用域模式：

```yaml
styles:
  scoped: true
  css: |
    .btn { color: red; }
```

启用后，选择器会自动添加 `[data-plugin-scope="plugin-id"]` 前缀。

### 4.4 注意事项

- 使用 `!important` 覆盖框架默认样式
- 类名建议使用插件前缀避免冲突（如 `.my-plugin-xxx`）
- 支持 `@keyframes`、`@media` 等 CSS 规则
- 插件禁用/删除时样式自动清理

## 5. 声明式 UI 系统

### 5.1 UI 插槽（SLOTS）

```yaml
ui:
  SIDEBAR_TOP:        # 侧边栏顶部
  SIDEBAR_BOTTOM:     # 侧边栏底部
  HEADER_ACTIONS:     # 聊天头部右侧
  INPUT_TOP:          # 输入框上方工具栏
  INPUT_ACTIONS_LEFT: # 输入框内左侧
  INPUT_ACTIONS_RIGHT:# 输入框内右侧
  MESSAGE_FOOTER:     # 消息气泡下方
  SETTINGS_GENERAL:   # 通用设置面板
```

### 5.2 内置组件

#### md-chip（标签）

```yaml
- component: md-chip
  props:
    text: 状态文本
    color: blue      # blue/green/red/yellow/gray
    class: text-xs
    title: 提示文本
    # 多状态变体
    variants:
      - when: $meta.isActive    # jexl 表达式
        text: 活动状态
        color: green
      - default: true
        text: 默认状态
        color: gray
```

#### md-icon-button（图标按钮）

```yaml
- component: md-icon-button
  props:
    icon: star        # Material Symbols 图标名
    label: 收藏       # 可选标签
    title: 点击收藏
    class: ido-btn ido-btn--ghost
  onClick:
    action: storage:push
    key: favorites
    value: $conversation.id
```

#### md-text（文本）

```yaml
- component: md-text
  props:
    text: 显示文本
    class: text-xs text-gray-500
```

#### md-divider（分隔线）

```yaml
- component: md-divider
  props:
    class: h-5 w-px bg-gray-200
```

#### div / span / element（原生元素）

```yaml
# 使用 div
- component: div
  props:
    class: flex items-center gap-2
    children:
      - component: span
        props:
          text: 标签1
          class: text-blue-500
      - component: span
        props:
          text: 标签2
          class: text-green-500

# 使用 element 指定任意标签
- component: element
  props:
    tag: article
    class: my-article
    children:
      - component: p
        props:
          text: 段落内容
```

支持的原生元素：`div`, `span`, `p`, `section`, `header`, `footer`, `article`, `nav`, `aside`, `ul`, `ol`, `li`

#### md-container（容器）

```yaml
- component: md-container
  props:
    class: flex items-center gap-2
    children:
      - component: md-text
        props:
          text: 子组件1
      - component: md-chip
        props:
          text: 子组件2
```

#### custom（自定义 HTML）

```yaml
- component: custom
  props:
    html: <span class="my-custom-class">自定义内容</span>
```

#### settings-form（设置表单）

```yaml
- component: settings-form
  props:
    title: 插件设置
    icon: settings
    order: 10
    fields:
      option1:
        type: select
        label: 选项1
        default: auto
        options:
          - { value: auto, label: 自动 }
          - { value: manual, label: 手动 }
      option2:
        type: number
        label: 选项2
        default: 10
        min: 1
        max: 100
```

### 5.3 条件显示

使用 jexl 表达式控制组件可见性：

```yaml
- component: md-chip
  visible: $channel.type == 'my-channel'  # 仅在特定渠道显示
  props:
    text: 当前渠道专属
```

### 5.4 动作系统

```yaml
onClick:
  action: clearMeta           # 动作类型
  key: previousInteractionId  # 动作参数

# 可用动作：
# - clearMeta: 清除会话元数据
# - storage:push: 向存储数组追加值
# - storage:set: 设置存储值
```

### 5.5 表达式上下文

在 YAML 中可使用 `$` 前缀访问运行时上下文：

| 变量 | 说明 |
|-----|------|
| `$channel` | 当前渠道信息（type, label 等） |
| `$meta` | 当前会话元数据 |
| `$conversation` | 当前会话对象 |
| `$settings` | 插件设置值 |

## 6. Channel 开发

### 6.1 声明式 Channel 配置

```yaml
channel:
  type: my-channel        # 渠道类型 ID
  label: My Channel       # 显示名称
  extends: openai-compat  # 可选：继承基础类型
  defaults:
    baseUrl: https://api.example.com
    model: gpt-4
  capabilities:
    streaming: true
    vision: false
```

### 6.2 Channel Adapter（JS）

```yaml
script: |
  const adapter = {
    /**
     * 调用 API
     * @param {Array} messages - 对话历史
     * @param {Object} config - 渠道配置（apiKey, baseUrl, model 等）
     * @param {Function} onUpdate - 流式更新回调（可选）
     * @param {AbortSignal} signal - 取消信号（可选）
     * @returns {Promise<Object>} - OpenAI 兼容的响应格式
     */
    async call(messages, config, onUpdate, signal) {
      const response = await fetch(`${config.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({ messages, model: config.model }),
        signal
      });
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: data.content,
            reasoning_content: data.reasoning || null
          }
        }]
      };
    },
    
    /**
     * 获取可用模型列表
     * @param {Object} config - 渠道配置
     * @returns {Promise<Array>} - 模型 ID 列表
     */
    async fetchModels(config) {
      return ['model-1', 'model-2'];
    }
  };
  
  Plugin.registerChannel(adapter);
```

### 6.3 流式响应

```javascript
async call(messages, config, onUpdate, signal) {
  const response = await fetch(url, { ...options, signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let fullContent = '';
  let fullReasoning = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    // 解析 SSE 数据...
    
    fullContent += newContent;
    
    // 流式更新
    onUpdate({
      content: fullContent,
      reasoning: fullReasoning || null
    });
  }
  
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: fullContent,
        reasoning_content: fullReasoning || null
      }
    }]
  };
}
```

## 7. Plugin API

在 `script:` 部分可使用的 API：

### 7.1 Channel 注册

```javascript
Plugin.registerChannel(adapter);
```

自动使用 YAML 中声明的 `channel` 配置（type, label, defaults, capabilities）。

### 7.2 设置读写

```javascript
// 获取设置（使用 YAML 中声明的默认值）
const settings = await Plugin.getSettings();

// 保存设置
await Plugin.saveSettings({ option1: 'value' });
```

### 7.3 会话元数据

```javascript
// 获取当前会话的元数据
const meta = await Plugin.getConversationMeta();

// 设置会话元数据
await Plugin.setConversationMeta('myKey', 'myValue');
```

### 7.4 插件元数据

```javascript
// 访问插件配置
const { id, name, version, channel, settings } = Plugin.meta;
```

## 8. 完整示例

### 8.1 带样式的 UI 插件（hello-panel）

```yaml
# hello-panel/plugin.yaml
id: hello-panel
version: 2.0.0
name: Hello Panel
description: 示例 UI 插件（带自定义样式）
author: IdoFront Team
icon: waving_hand

# 自定义样式
styles: |
  .hello-panel-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    border-radius: 12px !important;
    transition: all 0.3s ease !important;
  }
  
  .hello-panel-btn:hover {
    transform: scale(1.1) !important;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4) !important;
  }
  
  @keyframes hello-wave {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(20deg); }
    75% { transform: rotate(-15deg); }
  }
  
  .hello-panel-btn:active .material-symbols-rounded {
    animation: hello-wave 0.5s ease-in-out;
  }

ui:
  HEADER_ACTIONS:
    - id: hello-btn
      component: md-icon-button
      props:
        icon: waving_hand
        label: 打招呼
        title: 点击打招呼
        class: hello-panel-btn

  SETTINGS_GENERAL:
    - id: hello-settings
      component: settings-form
      props:
        title: Hello Panel 设置
        icon: waving_hand
        order: 99
        fields:
          greeting:
            type: text
            label: 问候语
            default: Hello, World!
```

### 8.2 UI + Channel 组合（deep-research）

```yaml
# gemini-deep-research/plugin.yaml
id: gemini-deep-research
version: 1.0.0
name: Gemini Deep Research
description: 多步骤研究任务
author: IdoFront Team
icon: science

channel:
  type: gemini-deep-research
  label: Gemini Deep Research
  defaults:
    baseUrl: https://generativelanguage.googleapis.com/v1beta
    model: deep-research-pro-preview-12-2025
  capabilities:
    streaming: true
    vision: false

ui:
  INPUT_TOP:
    - id: deep-research-status
      component: md-container
      visible: $channel.type == 'gemini-deep-research'
      props:
        class: flex items-center gap-2
        children:
          - component: md-chip
            props:
              variants:
                - when: $meta.previousInteractionId
                  text: 续写模式
                  color: green
                - default: true
                  text: 新研究
                  color: blue
      actions:
        clear:
          icon: close
          visible: $meta.previousInteractionId
          onClick:
            action: clearMeta
            key: previousInteractionId

  SETTINGS_GENERAL:
    - id: deep-research-settings
      component: settings-form
      props:
        title: Deep Research 设置
        icon: science
        fields:
          thinkingSummaries:
            type: select
            label: 思考摘要
            default: auto
            options:
              - { value: auto, label: 自动 }
              - { value: none, label: 不显示 }

script: |
  const adapter = {
    async call(messages, config, onUpdate, signal) {
      const settings = await Plugin.getSettings();
      const meta = await Plugin.getConversationMeta();
      // Deep Research 逻辑...
    }
  };
  
  Plugin.registerChannel(adapter);
```

## 9. 导入与管理

### 9.1 导入步骤

1. 打开 IdoFront → 设置 → 插件管理 → 外部插件
2. 选择导入方式：
   - **粘贴 YAML**：直接粘贴 `.yaml` 内容
   - **上传文件**：上传 `.yaml` 或 `.js` 文件
3. 点击"导入插件"
4. 在插件列表中启用/禁用

### 9.2 调试技巧

1. **控制台日志**：查看 `[HybridParser]`、`[PluginLoader]`、`[Sandbox]` 前缀的日志
2. **网络日志**：在右侧面板查看 API 调用
3. **热重载**：修改后禁用再启用插件



## 10. 安全说明

- **CSP 策略**：CSS 支持 `'unsafe-inline'`，允许动态 `<style>` 标签
- **样式隔离**：使用 `scoped: true` 或插件前缀类名避免冲突
- **自动清理**：插件禁用/删除时，相关样式标签自动移除

## 11. 架构图

```
┌───────────────────────────────────────────────────────┐
│                    声明式层（无需沙箱）                  │
├─────────────────────────┬─────────────────────────────┤
│         UI 声明          │        Channel 声明         │
│  - 组件、样式、条件       │  - type/label/defaults     │
│  - 表达式绑定            │  - capabilities            │
├─────────────────────────┴─────────────────────────────┤
│                    脚本层（需要沙箱）                    │
├─────────────────────────┬─────────────────────────────┤
│      Plugin API          │      Channel Adapter       │
│  - getSettings()         │  - call()                  │
│  - setConversationMeta() │  - fetchModels()           │
└─────────────────────────┴─────────────────────────────┘
```

## 12. 参考资源

- **示例插件**：[`examples/external-plugins/`](../examples/external-plugins/)
  - [`hello-panel/plugin.yaml`](../examples/external-plugins/hello-panel/plugin.yaml) - 纯 UI 插件
  - [`skugemini-channel/plugin.yaml`](../examples/external-plugins/skugemini-channel/plugin.yaml) - 纯 Channel 插件
  - [`gemini-deep-research-channel/plugin.yaml`](../examples/external-plugins/gemini-deep-research-channel/plugin.yaml) - UI + Channel 组合
- **框架源码**：
  - [`hybrid-plugin-parser.js`](../edge-extension/scripts/ido-front/hybrid-plugin-parser.js) - 混合格式解析器
  - [`declarative-ui-renderer.js`](../edge-extension/scripts/ido-front/declarative-ui-renderer.js) - 声明式 UI 渲染器
  - [`plugin-loader.js`](../edge-extension/scripts/ido-front/plugin-loader.js) - 插件加载器

---

**Happy Coding!** 🎉
