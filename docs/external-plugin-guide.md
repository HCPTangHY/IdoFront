# IdoFront 外部插件开发指南

## 1. 概览

IdoFront 支持通过"外部插件"扩展 UI 和功能。外部插件与核心扩展解耦，采用以下流程：

1. 在设置页 → 插件管理 → 外部插件 中导入 JS 代码或上传 `.js` 文件
2. 插件代码在沙箱 iframe 中安全运行，可使用 `Framework` 和 `IdoFront` API
3. 插件生命周期：注册 → 启动 → 手动启停/删除

> **注意**：外部插件在沙箱环境中运行，与主线程通过消息机制通信。这确保了安全性，同时提供了与内置插件几乎相同的 API。

## 2. 插件类型

IdoFront 支持三种主要插件类型：

### 2.1 UI 插件
向侧边栏、头部、输入区、消息气泡等位置插入控件，增强用户界面。

### 2.2 Channel 插件
注册新的模型调用渠道，支持自定义 API 或代理服务。

### 2.3 主视图插件（规划中）
接管整个主内容区，实现类似图片 gallery 等完全自定义的视图。

## 3. 快速开始：创建第一个插件

### 3.1 基本插件结构

一个最简单的 UI 插件示例：

```javascript
// @name Hello World Plugin
// @version 1.0.0
// @description 我的第一个 IdoFront 插件
// @author Your Name
// @homepage https://github.com/yourname/your-plugin

(function() {
  'use strict';
  
  const { registerPlugin, SLOTS, ui } = Framework;

  registerPlugin(SLOTS.SIDEBAR_BOTTOM, 'hello-world', {
    init() {
      console.log('Hello World 插件已初始化');
    },
    
    renderStatic() {
      const button = ui.createIconButton({
        label: '打招呼',
        icon: 'waving_hand',
        title: '点击打招呼',
        className: 'ido-btn ido-btn--ghost',
        onClick() {
          alert('你好，IdoFront！');
        }
      });
      return button;
    },
    
    destroy() {
      console.log('Hello World 插件已清理');
    }
  });
})();
```

### 3.2 插件元数据

在插件文件开头使用注释声明元数据（类似 Userscript）：

```javascript
// @name 插件名称
// @version 版本号（如 1.0.0）
// @description 插件描述
// @author 作者名称
// @homepage 项目主页 URL
// @icon 图标名称（Material Symbols）
```

这些元数据会被自动解析并显示在插件管理界面中。

## 4. 可用运行环境与 API

### 4.1 沙箱运行机制

外部插件在独立的沙箱 iframe 中运行，与主线程通过 `postMessage` 通信。这种架构带来以下特点：

- **安全隔离**：插件代码无法直接访问主线程的敏感数据
- **API 代理**：`Framework` 和 `IdoFront` 对象通过消息机制代理到主线程
- **异步渲染**：UI 组件在沙箱中创建 DOM，序列化后传递到主线程显示

### 4.2 全局对象

沙箱环境提供以下全局对象：

| 对象 | 说明 |
| --- | --- |
| `window` | 沙箱 window，提供基本浏览器 API |
| `document` | 沙箱 document，可用于创建 DOM 元素 |
| `console` | 标准控制台，日志会显示在浏览器 DevTools |
| `Framework` | 框架核心 API（代理），提供插件注册、UI 工具、消息操作等 |
| `IdoFront` | 业务核心 API（代理），提供 Channel 注册等能力 |
| `fetch` | 网络请求 API，支持网络日志记录 |

### 4.3 Framework API（沙箱版本）

> **重要**：以下 API 在沙箱中通过消息代理实现，行为与主线程版本基本一致，但有少量限制。

#### 4.3.1 插件注册

```javascript
Framework.registerPlugin(slotName, pluginId, definition)
```

**参数：**
- `slotName`：插槽名称，从 `Framework.SLOTS` 中选择
- `pluginId`：插件唯一标识符（字符串）
- `definition`：插件定义对象或渲染函数

**插件定义对象：**
```javascript
{
  // 初始化函数（可选）
  init(frameworkApi) {
    // 插件注册时调用一次
  },
  
  // 静态渲染函数（可选）
  renderStatic(frameworkApi) {
    // 返回 DOM 元素或 HTML 字符串
    return element;
  },
  
  // 动态渲染函数（可选，用于消息级插件）
  renderDynamic(context) {
    // context 包含消息数据等上下文信息
    return element;
  },
  
  // 清理函数（可选）
  destroy(frameworkApi) {
    // 插件卸载时调用
  },
  
  // 元数据（可选）
  meta: {
    name: '插件显示名称',
    description: '插件描述',
    version: '1.0.0',
    author: '作者',
    icon: 'icon_name'
  }
}
```

#### 4.3.1.1 批量注册（Plugin Bundle）

当一个插件需要同时往多个插槽注册多个组件时，推荐使用 [`Framework.registerPluginBundle()`](edge-extension/scripts/framework.js:1045)：

```javascript
Framework.registerPluginBundle(bundleId, definition)
Framework.unregisterPluginBundle(bundleId)
```

**说明：**
- `bundleId`：插件包 ID（字符串）
- `definition.meta`：插件包元数据（可选）
- `definition.slots`：插槽配置（必填），支持：
  - **对象形式（推荐）**：`{ [slotName]: render | { id?, render } | Array<{ id?, render } | render> }`
  - **数组形式**：`[{ slot, id?, render }]`
- `definition.init(frameworkApi)`：初始化函数（可选，调用一次）
- `definition.destroy(frameworkApi)`：销毁函数（可选，调用一次；在你调用 `unregisterPluginBundle` 时触发）

> 建议：为每个 slot 组件显式提供 `id`，避免热更新/重载时因自动生成 ID 导致旧组件残留。

**示例：**

```javascript
(function() {
  const { SLOTS, ui } = Framework;

  Framework.registerPluginBundle('my-bundle', {
    meta: { name: 'My Bundle', version: '1.0.0', icon: 'extension' },
    slots: {
      [SLOTS.HEADER_ACTIONS]: {
        id: 'my-bundle:hello',
        render() {
          return ui.createIconButton({
            label: 'Hello',
            icon: 'waving_hand',
            className: 'ido-btn ido-btn--ghost text-xs gap-1',
            onClick() {
              Framework.addMessage('assistant', { content: 'Hello from bundle!' });
            }
          });
        }
      },
      [SLOTS.SIDEBAR_BOTTOM]: {
        id: 'my-bundle:sidebar',
        render() {
          const el = document.createElement('div');
          el.className = 'text-xs text-gray-500 px-2 py-1';
          el.textContent = 'Sidebar widget from bundle';
          return el;
        }
      }
    }
  });
})();
```

#### 4.3.2 可用插槽（SLOTS）

> **注意**：`Framework.SLOTS` 在沙箱初始化时从主线程同步获取，确保与主线程保持一致。

```javascript
Framework.SLOTS = {
  SIDEBAR_TOP: 'slot-sidebar-top',           // 侧边栏顶部
  SIDEBAR_BOTTOM: 'slot-sidebar-bottom',     // 侧边栏底部
  HEADER_ACTIONS: 'slot-header-actions',     // 聊天头部右侧按钮区
  INPUT_TOP: 'slot-input-top',               // 输入框上方工具栏
  INPUT_ACTIONS_LEFT: 'slot-input-actions-left',   // 输入框内左侧
  INPUT_ACTIONS_RIGHT: 'slot-input-actions-right', // 输入框内右侧
  MESSAGE_FOOTER: 'message-footer',          // 消息气泡下方操作区
  MESSAGE_MORE_ACTIONS: 'message-more-actions'     // 消息更多操作菜单
}
```

#### 4.3.3 UI 工具

沙箱提供的 UI 工具用于创建 DOM 元素。这些元素会被序列化为 HTML 传递到主线程渲染。

```javascript
// 创建图标按钮
Framework.ui.createIconButton({
  label: '按钮文字',           // 可选
  icon: 'icon_name',          // Material Symbols 图标名
  title: '提示文本',           // 可选
  className: 'custom-class',  // 可选
  iconClassName: 'icon-class', // 可选
  onClick: () => {}           // 点击回调
})

// 注意：onClick 回调会通过消息机制异步触发
// 事件对象中只包含可序列化的基本信息
```

#### 4.3.4 消息操作

以下消息操作通过消息代理到主线程执行：

```javascript
// 添加消息
Framework.addMessage(role, content, options)

// 更新最后一条消息
Framework.updateLastMessage(content)

// 完成流式消息（通常在流式结束时调用，触发 Markdown 解析/清理）
Framework.finalizeStreamingMessage()

// 批量解析所有待 Markdown 的元素（历史消息加载后常用）
Framework.renderAllPendingMarkdown()

// 清空消息
Framework.clearMessages()

// ====== Loading 指示器相关 ======

// 添加 loading 气泡（沙箱中是异步的）
const loadingId = await Framework.addLoadingIndicator()

// 移除 loading 气泡
Framework.removeLoadingIndicator(loadingId)

// 将 loading 指示器附着到某条消息下方（沙箱中是异步的）
const ok = await Framework.attachLoadingIndicatorToMessage(loadingId, messageId)

// 移除某条消息下方的 streaming 指示器
Framework.removeMessageStreamingIndicator(messageId)

// 设置发送按钮 loading 状态
Framework.setSendButtonLoading(true)
Framework.setSendButtonLoading(false)
```

#### 4.3.5 面板控制

> 说明：在沙箱中，`renderer` 会在 **沙箱内执行**，其产出的 DOM 会被序列化为 HTML 发送到主线程渲染；交互事件通过消息机制回传到沙箱执行。

```javascript
// 切换左右面板
Framework.togglePanel('left'|'right', force)

// 显示底部抽屉（renderer 在沙箱执行）
Framework.showBottomSheet((container) => {
  container.innerHTML = '<div>hello</div>'
})

// 隐藏底部抽屉
Framework.hideBottomSheet()

// 设置右侧自定义面板（renderer 在沙箱执行）
Framework.setCustomPanel('right', (container) => {
  container.innerHTML = '<div>right panel</div>'
})

// 恢复右侧默认面板
Framework.restoreDefaultRightPanel()
```

#### 4.3.6 视图模式

```javascript
// 切换视图模式（沙箱中仅支持不带 renderers 的调用）
Framework.setMode(modeId)

// 获取当前模式（沙箱中返回 null，需通过消息异步获取）
Framework.getCurrentMode() // 返回 null
```

> **限制**：`setMode` 的 `renderers` 参数（包含渲染函数）在沙箱中不支持，因为函数无法跨 iframe 序列化。

#### 4.3.7 Framework Events（事件系统）

沙箱可使用 `Framework.events` 与主线程共享的事件总线交互：

```javascript
// 订阅事件（返回取消订阅函数）
const off = Framework.events.on('mode:changed', (data) => {
  console.log('mode changed', data)
})

// 取消订阅（方式一）
off()

// 取消订阅（方式二）
Framework.events.off('mode:changed', handler)

// 发射事件
Framework.events.emit('my-event', { ok: true })

// 异步发射事件
Framework.events.emitAsync('my-event', { ok: true })
```

> 注意：事件数据会通过消息机制传递，请确保 `eventData` 可序列化。

#### 4.3.8 Framework Storage（配置存储）

沙箱可使用 `Framework.storage` 做轻量配置持久化（与内置插件风格一致）：

```javascript
// 读取（沙箱中为异步）
const value = await Framework.storage.getItem('my-plugin:key', null)

// 写入（沙箱中为异步）
await Framework.storage.setItem('my-plugin:key', { enabled: true })
```

> 建议：使用插件 ID 作为 key 前缀（如 `my-plugin:key`）避免冲突。
> 另外也可以使用 [`IdoFront.storage.getItem()`](edge-extension/scripts/sandbox-loader.js:193) / [`IdoFront.storage.setItem()`](edge-extension/scripts/sandbox-loader.js:203)（同样是异步代理）。

### 4.4 IdoFront API（沙箱版本）

沙箱中的 `IdoFront` 提供 Channel 注册、Store 访问和 Storage 存储能力。

#### 4.4.1 Channel Registry API

用于注册自定义模型渠道：

```javascript
IdoFront.channelRegistry.registerType(typeId, definition, options)
```

**Channel 定义示例：**
```javascript
IdoFront.channelRegistry.registerType('my-api', {
  label: '我的 API',
  description: '自定义 API 渠道',
  icon: 'api',
  
  defaults: {
    baseUrl: 'https://api.example.com',
    model: 'gpt-4',
    params: {},
    headers: {}
  },
  
  capabilities: {
    streaming: true,    // 是否支持流式输出
    vision: false       // 是否支持图像输入
  },
  
  adapter: {
    // 调用 API
    async call(messages, config, onUpdate) {
      // messages: 对话消息数组
      // config: 配置对象（包含 apiKey、baseUrl、model 等）
      // onUpdate: 流式更新回调（可选）
      
      // 返回完整响应文本
      return 'API response text';
    },
    
    // 获取可用模型列表（可选）
    async fetchModels(config) {
      return [
        { id: 'model-1', name: 'Model 1' },
        { id: 'model-2', name: 'Model 2' }
      ];
    }
  }
}, {
  source: 'plugin:my-plugin'  // 标识插件来源
});
```

#### 4.4.2 Store API（会话状态访问）

沙箱中的 `IdoFront.store` 提供对主线程状态的异步访问：

```javascript
// 获取完整状态快照
const state = await IdoFront.store.getState();
// state 包含：conversations, activeConversationId, channels, personas, activePersonaId

// 获取当前活动会话
const conv = await IdoFront.store.getActiveConversation();
// conv 结构：{ id, title, messages, metadata, ... }

// 获取指定会话
const otherConv = await IdoFront.store.getConversation('conversation-id');

// 更新会话元数据（合并模式）
await IdoFront.store.updateConversationMetadata('conversation-id', {
  myPlugin: {
    lastAction: Date.now(),
    customData: { ... }
  }
});

// 触发状态持久化
await IdoFront.store.persist();
```

> **注意**：所有 Store 方法都是异步的，返回 Promise。状态快照是只读的，如需修改请使用 `updateConversationMetadata`。

#### 4.4.3 Store Events（状态事件监听）

沙箱中的 `IdoFront.store.events` 允许监听主线程的状态变化：

```javascript
// 订阅事件
const unsubscribe = IdoFront.store.events.on('updated', (eventData) => {
  console.log('状态已更新:', eventData);
});

// 可用事件类型：
// - 'updated': 状态更新
// - 'conversation:created': 新建会话
// - 'conversation:deleted': 删除会话
// - 'message:added': 新增消息
// - 更多事件请参考 store.js

// 取消订阅（方式一）
unsubscribe();

// 取消订阅（方式二）
IdoFront.store.events.off('updated', myCallback);
```

> **注意**：事件数据通过消息机制传递，只包含可序列化的内容。

#### 4.4.4 Storage API（配置持久化）

沙箱中的 `IdoFront.storage` 提供简单的键值存储，用于保存插件配置：

```javascript
const CONFIG_KEY = 'my-plugin:config';

// 读取配置
const config = await IdoFront.storage.getItem(CONFIG_KEY);
// 如果不存在，返回 null

// 保存配置（自动 JSON 序列化）
await IdoFront.storage.setItem(CONFIG_KEY, {
  theme: 'dark',
  fontSize: 14,
  customSettings: { ... }
});

// 删除配置
await IdoFront.storage.removeItem(CONFIG_KEY);
```

> **最佳实践**：使用插件 ID 作为键前缀（如 `my-plugin:config`）避免与其他插件冲突。

## 5. 开发规范与最佳实践

### 5.0 沙箱插件的特殊注意事项

由于外部插件在沙箱中运行，需注意以下限制：

1. **函数不可序列化**：渲染函数返回的 DOM 元素会被序列化为 HTML，`onclick` 等事件处理器需通过 `Framework.ui.createIconButton` 的 `onClick` 参数设置
2. **异步渲染**：UI 组件从沙箱到主线程需要一次往返消息，可能有轻微延迟
3. **有限的 DOM 访问**：无法直接访问主线程的 DOM，只能通过 Framework API 操作
4. **状态同步**：Store 状态不会自动同步到沙箱，如需监听需通过消息机制

### 5.1 命名规范

- **插件 ID**：使用 `ext-` 前缀或包含组织名称，避免与内置 `core-` 冲突
  - ✅ 推荐：`ext-my-feature`、`org-my-plugin`
  - ❌ 避免：`core-feature`、`plugin1`

- **Channel 类型**：使用描述性名称，避免通用名称冲突
  - ✅ 推荐：`my-custom-api`、`company-gpt`
  - ❌ 避免：`gpt`、`api`

### 5.2 错误处理

```javascript
registerPlugin(SLOTS.SIDEBAR_BOTTOM, 'my-plugin', {
  renderStatic() {
    try {
      // 插件逻辑
      return element;
    } catch (error) {
      console.error('插件渲染失败:', error);
      
      // 返回错误提示元素
      const errorDiv = document.createElement('div');
      errorDiv.className = 'text-red-500 text-xs p-2';
      errorDiv.textContent = '插件加载失败';
      return errorDiv;
    }
  }
});
```

### 5.3 清理逻辑

如果插件创建了 DOM 元素、事件监听器或定时器，必须在 `destroy()` 中清理：

```javascript
let intervalId = null;

registerPlugin(SLOTS.SIDEBAR_BOTTOM, 'my-plugin', {
  init() {
    // 创建定时器
    intervalId = setInterval(() => {
      console.log('Tick');
    }, 1000);
  },
  
  destroy() {
    // 清理定时器
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    
    // 清理事件监听器
    // 移除创建的 DOM 元素等
  }
});
```

### 5.4 配置存储

使用插件专用存储，避免污染核心 state：

```javascript
const STORAGE_KEY = 'my-plugin-config';

// 保存配置
async function saveConfig(config) {
  const pluginData = {
    id: 'my-plugin-config',
    data: config
  };
  await IdoFront.storage.savePlugin(pluginData);
}

// 读取配置
async function loadConfig() {
  const pluginData = await IdoFront.storage.getPlugin('my-plugin-config');
  return pluginData?.data || defaultConfig;
}
```

### 5.5 性能优化

- 避免在渲染函数中执行耗时操作
- 使用事件委托减少事件监听器数量
- 对频繁更新使用防抖或节流
- 及时清理不再使用的资源

## 6. 导入与管理插件

### 6.1 导入步骤

1. 打开 IdoFront → 设置 → 插件管理 → 外部插件
2. 填写插件名称（或保持自动识别）
3. 选择导入方式：
   - **粘贴代码**：直接粘贴插件 JavaScript 代码
   - **上传文件**：上传 `.js` 文件
4. 点击"导入插件"
5. 在插件列表中查看导入的插件

### 6.2 插件管理

- **启用/禁用**：使用开关控制插件运行状态
- **编辑**：修改插件代码并保存
- **删除**：永久删除插件
- **查看日志**：在"最近的外部插件错误"卡片中查看错误信息

### 6.3 调试技巧

1. **控制台日志**：使用浏览器 DevTools Console 查看 `[Plugin:<Name>]` 前缀的日志
2. **错误提示**：插件设置页会显示最近的错误信息
3. **重新加载**：修改代码后，禁用再启用插件以重新加载
4. **断点调试**：在 DevTools 中搜索插件代码并设置断点

## 7. 完整示例

### 7.1 UI 插件示例

参考 [`examples/external-plugins/hello-panel/plugin.js`](../examples/external-plugins/hello-panel/plugin.js)

### 7.2 Channel 插件示例

参考 [`examples/external-plugins/skugemini-channel/plugin.js`](../examples/external-plugins/skugemini-channel/plugin.js)

### 7.3 复杂插件示例

```javascript
// @name Advanced Counter
// @version 1.0.0
// @description 一个带持久化的计数器插件示例
// @author IdoFront Team

(function() {
  'use strict';
  
  const { registerPlugin, SLOTS, ui } = Framework;
  const PLUGIN_ID = 'ext-counter';
  const STORAGE_KEY = 'ext-counter-data';
  
  let count = 0;
  let counterElement = null;
  
  // 加载保存的计数
  async function loadCount() {
    const data = await IdoFront.storage.getPlugin(STORAGE_KEY);
    count = data?.count || 0;
    updateCounter();
  }
  
  // 保存计数
  async function saveCount() {
    await IdoFront.storage.savePlugin({
      id: STORAGE_KEY,
      count: count
    });
  }
  
  // 更新显示
  function updateCounter() {
    if (counterElement) {
      counterElement.textContent = count;
    }
  }
  
  registerPlugin(SLOTS.SIDEBAR_BOTTOM, PLUGIN_ID, {
    async init() {
      await loadCount();
      console.log('计数器插件已初始化，当前计数:', count);
    },
    
    renderStatic() {
      const container = document.createElement('div');
      container.className = 'flex items-center gap-2 p-2 border border-gray-200 rounded-lg';
      
      // 显示计数
      counterElement = document.createElement('span');
      counterElement.className = 'text-lg font-bold text-gray-700';
      counterElement.textContent = count;
      
      // 减少按钮
      const decreaseBtn = ui.createIconButton({
        icon: 'remove',
        title: '减少',
        className: 'ido-btn ido-btn--ghost ido-btn--sm',
        onClick: async () => {
          count--;
          updateCounter();
          await saveCount();
        }
      });
      
      // 增加按钮
      const increaseBtn = ui.createIconButton({
        icon: 'add',
        title: '增加',
        className: 'ido-btn ido-btn--ghost ido-btn--sm',
        onClick: async () => {
          count++;
          updateCounter();
          await saveCount();
        }
      });
      
      // 重置按钮
      const resetBtn = ui.createIconButton({
        icon: 'refresh',
        title: '重置',
        className: 'ido-btn ido-btn--ghost ido-btn--sm',
        onClick: async () => {
          count = 0;
          updateCounter();
          await saveCount();
        }
      });
      
      container.appendChild(decreaseBtn);
      container.appendChild(counterElement);
      container.appendChild(increaseBtn);
      container.appendChild(resetBtn);
      
      return container;
    },
    
    destroy() {
      counterElement = null;
      console.log('计数器插件已清理');
    }
  });
})();
```

## 8. 发布与共享

### 8.1 发布方式

- 将插件代码托管在 GitHub 等代码仓库
- 提供清晰的 README 说明使用方法
- 在仓库中包含示例配置和截图

### 8.2 打包工具

可以使用项目提供的 [`pack.js`](../pack.js) 将多文件插件合并为单文件：

```bash
node pack.js your-plugin-dir
```

### 8.3 版本管理

- 遵循语义化版本号（Semantic Versioning）
- 在插件元数据中明确声明版本号
- 维护更新日志（CHANGELOG.md）

## 9. 安全注意事项

### 9.1 沙箱安全机制

外部插件运行在独立的沙箱 iframe 中，这提供了以下安全保障：

- **代码隔离**：插件代码无法直接访问主线程的全局变量和 DOM
- **API 白名单**：只有通过 `Framework` 和 `IdoFront` 代理的 API 可用
- **消息验证**：主线程会验证消息来源，只处理来自沙箱的消息
- **资源限制**：沙箱中的网络请求会被记录到网络日志面板

### 9.2 仍需注意

- 插件可以发起网络请求，可能泄露数据
- 不要在插件代码中硬编码敏感信息（如 API 密钥）
- 插件可以通过 `Framework.addMessage` 修改对话内容

### 9.3 用户提示

- 只安装来自可信来源的插件
- 审查插件代码，了解其功能
- 定期检查插件更新和安全公告
- 在网络日志面板中监控插件的网络活动

## 10. 参考资源

- **设计文档**：[`docs/external-plugin-plan.md`](external-plugin-plan.md)
- **示例插件**：[`examples/external-plugins/`](../examples/external-plugins/)
- **框架源码**：[`edge-extension/scripts/framework.js`](../edge-extension/scripts/framework.js)
- **插件加载器**：[`edge-extension/scripts/ido-front/plugin-loader.js`](../edge-extension/scripts/ido-front/plugin-loader.js)

## 11. 常见问题

### Q: 插件无法加载怎么办？
A: 检查浏览器控制台是否有错误信息，确保插件语法正确，并在设置页查看"最近的外部插件错误"。

### Q: 为什么我的 UI 插件不显示？
A: 确保：
1. 使用了正确的 `Framework.SLOTS` 常量
2. `render` 函数返回了有效的 DOM 元素或 HTML 字符串
3. 检查控制台是否有 `[Sandbox]` 或 `[PluginLoader]` 前缀的错误信息

### Q: 如何处理点击事件？
A: 使用 `Framework.ui.createIconButton` 的 `onClick` 参数：
```javascript
Framework.ui.createIconButton({
  icon: 'star',
  onClick: () => {
    // 这个函数会通过消息机制调用
    Framework.addMessage('assistant', { content: '点击了！' });
  }
});
```

### Q: 插件可以修改核心功能吗？
A: 插件只能通过暴露的 API 与核心交互，无法直接修改核心代码，这确保了系统稳定性。

### Q: 如何调试 Channel 插件？
A: 在网络日志面板中可以看到所有 API 调用的请求和响应详情。

### Q: 插件会影响性能吗？
A: 设计良好的插件不会显著影响性能。避免在渲染函数中执行耗时操作，及时清理资源。

---

**Happy Coding!** 🎉 如有问题，欢迎在 GitHub Issues 中讨论。
