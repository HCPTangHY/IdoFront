# IdoFront 外部插件开发指南

## 1. 概览

IdoFront 支持通过"外部插件"扩展 UI 和功能。外部插件与核心扩展解耦，采用以下流程：

1. 在设置页 → 插件管理 → 外部插件 中导入 JS 代码或上传 `.js` 文件
2. 插件代码在沙箱执行器中运行，可使用 `window.IdoFront` 与 `Framework` API
3. 插件生命周期：注册 → 启动 → 手动启停/删除

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

### 4.1 全局对象

沙箱环境提供以下全局对象：

| 对象 | 说明 |
| --- | --- |
| `window` | 提供大部分浏览器 API，但请勿依赖 `localStorage/sessionStorage` 等敏感对象 |
| `document` | 可用于创建 DOM 元素 |
| `console` | 日志会以 `[Plugin:<Name>]` 前缀输出到控制台 |
| `Framework` | 框架核心 API，提供插件注册、UI 工具等 |
| `IdoFront` | 业务核心 API，提供对话、消息、存储等能力 |
| `PluginRuntime` | 插件运行时信息（`pluginId`、`dryRun` 等） |

### 4.2 Framework API

#### 4.2.1 插件注册

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

#### 4.2.2 可用插槽（SLOTS）

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

#### 4.2.3 UI 工具

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

// 创建自定义 Header
Framework.ui.createCustomHeader({
  center: '标题内容',         // 字符串、元素或渲染函数
  right: rightElement,        // 可选，右侧内容
  showOpenInNew: true         // 是否显示"全屏打开"按钮
})
```

#### 4.2.4 消息操作

```javascript
// 添加消息
Framework.addMessage(role, content, options)

// 更新最后一条消息
Framework.updateLastMessage(content)

// 完成流式消息
Framework.finalizeStreamingMessage()

// 清空消息
Framework.clearMessages()
```

#### 4.2.5 面板控制

```javascript
// 切换左右面板
Framework.togglePanel('left'|'right', force)

// 显示底部抽屉
Framework.showBottomSheet(renderer)

// 隐藏底部抽屉
Framework.hideBottomSheet()

// 设置自定义面板
Framework.setCustomPanel('right', renderer)
```

#### 4.2.6 视图模式

```javascript
// 切换视图模式
Framework.setMode(modeId, {
  sidebar: (container) => {},  // 侧边栏渲染函数
  main: (container) => {}      // 主视图渲染函数
})

// 获取当前模式
Framework.getCurrentMode()
```

### 4.3 IdoFront API

#### 4.3.1 对话操作

```javascript
// 通过 IdoFront.conversationActions 访问
IdoFront.conversationActions.create()      // 创建新对话
IdoFront.conversationActions.select(id)    // 切换对话
IdoFront.conversationActions.delete(id)    // 删除对话
```

#### 4.3.2 消息操作

```javascript
// 通过 IdoFront.messageActions 访问
IdoFront.messageActions.send(text)         // 发送消息
IdoFront.messageActions.edit(messageId)    // 编辑消息
IdoFront.messageActions.retry(messageId)   // 重试消息
```

#### 4.3.3 Store 状态访问

```javascript
// 访问全局状态
IdoFront.store.state.conversations        // 对话列表
IdoFront.store.state.activeConversationId // 当前对话 ID
IdoFront.store.state.personas             // 面具列表
IdoFront.store.state.activePersonaId      // 当前面具 ID
IdoFront.store.state.channels             // 渠道列表
IdoFront.store.state.pluginStates         // 插件状态

// 获取当前激活对话
IdoFront.store.getActiveConversation()

// 获取当前激活面具
IdoFront.store.getActivePersona()
```

#### 4.3.4 事件监听

```javascript
// 监听状态变化
IdoFront.store.events.on('updated', (state) => {
  console.log('状态已更新', state);
});

IdoFront.store.events.on('persona:changed', (personaId) => {
  console.log('面具已切换', personaId);
});

// 取消监听
IdoFront.store.events.off('updated', callback);
```

#### 4.3.5 存储 API

```javascript
// 插件专用存储（IndexedDB）
await IdoFront.storage.savePlugin(pluginData)
await IdoFront.storage.getPlugin(pluginId)
await IdoFront.storage.getAllPlugins()
await IdoFront.storage.deletePlugin(pluginId)
```

### 4.4 Channel Registry API

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

## 5. 开发规范与最佳实践

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

### 9.1 沙箱限制

- 外部插件在沙箱 iframe 中运行，但仍可访问扩展内部 API
- 不要在插件中存储敏感信息（如 API 密钥）
- 避免执行不受信任的代码

### 9.2 用户提示

- 只安装来自可信来源的插件
- 审查插件代码，了解其功能
- 定期检查插件更新和安全公告

## 10. 参考资源

- **设计文档**：[`docs/external-plugin-plan.md`](external-plugin-plan.md)
- **示例插件**：[`examples/external-plugins/`](../examples/external-plugins/)
- **框架源码**：[`edge-extension/scripts/framework.js`](../edge-extension/scripts/framework.js)
- **插件加载器**：[`edge-extension/scripts/ido-front/plugin-loader.js`](../edge-extension/scripts/ido-front/plugin-loader.js)

## 11. 常见问题

### Q: 插件无法加载怎么办？
A: 检查浏览器控制台是否有错误信息，确保插件语法正确，并在设置页查看"最近的外部插件错误"。

### Q: 如何访问插件自己的配置？
A: 使用 `IdoFront.storage.savePlugin()` 和 `getPlugin()` 存储插件专用数据。

### Q: 插件可以修改核心功能吗？
A: 插件只能通过暴露的 API 与核心交互，无法直接修改核心代码，这确保了系统稳定性。

### Q: 如何调试 Channel 插件？
A: 在网络日志面板中可以看到所有 API 调用的请求和响应详情。

### Q: 插件会影响性能吗？
A: 设计良好的插件不会显著影响性能。避免在渲染函数中执行耗时操作，及时清理资源。

---

**Happy Coding!** 🎉 如有问题，欢迎在 GitHub Issues 中讨论。
