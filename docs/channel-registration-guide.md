# IdoFront 渠道注册开发指南

## 目录

- [概述](#概述)
- [渠道系统架构](#渠道系统架构)
- [渠道定义结构](#渠道定义结构)
- [Adapter 接口规范](#adapter-接口规范)
- [注册渠道](#注册渠道)
- [完整示例](#完整示例)
- [高级功能](#高级功能)
- [常见问题](#常见问题)

---

## 概述

IdoFront 渠道系统是一个可扩展的 API 适配层，允许应用与不同的 AI 服务提供商（如 OpenAI、Google Gemini、Anthropic Claude 等）进行通信。每个渠道封装了特定 API 的请求格式、响应解析和流式处理逻辑。

### 核心概念

| 概念 | 说明 |
|------|------|
| **Channel Type** | 渠道类型标识符，如 `openai`、`gemini` |
| **Adapter** | 渠道适配器，包含 `call()` 和可选的 `fetchModels()` 方法 |
| **Definition** | 渠道定义对象，包含适配器、默认值、能力声明等 |
| **Registry** | 渠道注册中心，管理所有已注册的渠道类型 |

---

## 渠道系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Channel Registry                         │
│  window.IdoFront.channelRegistry                            │
├─────────────────────────────────────────────────────────────┤
│  registerType()  │  getType()  │  listTypes()  │  hasType() │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  OpenAI Channel │  │  Gemini Channel │  │  Custom Channel │
│  type: 'openai' │  │  type: 'gemini' │  │  type: 'custom' │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│  adapter.call() │  │  adapter.call() │  │  adapter.call() │
│  fetchModels()  │  │  fetchModels()  │  │  fetchModels()  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 渠道定义结构

### 完整定义对象

```javascript
{
    // 必需：适配器对象
    adapter: {
        call: async function(messages, config, onUpdate, signal) { ... },
        fetchModels: async function(config) { ... }  // 可选
    },
    
    // 可选：显示名称（默认使用 type）
    label: 'My Custom Channel',
    
    // 可选：描述文本
    description: '自定义 AI 服务渠道',
    
    // 可选：图标（Material Symbols 名称）
    icon: 'science',
    
    // 可选：来源标识（'core' | 'plugin' | 'external'）
    source: 'external',
    
    // 可选：版本号
    version: '1.0.0',
    
    // 可选：默认配置
    defaults: {
        baseUrl: 'https://api.example.com/v1',
        model: 'default-model'
    },
    
    // 可选：能力声明
    capabilities: {
        streaming: true,      // 是否支持流式输出
        vision: true,         // 是否支持图片输入
        fetchModels: true     // 是否支持获取模型列表（自动检测）
    },
    
    // 可选：元数据
    metadata: {
        provider: 'example',
        docs: 'https://docs.example.com'
    }
}
```

### 字段详解

#### `adapter` (必需)

适配器是渠道的核心，必须包含 `call` 方法：

```javascript
adapter: {
    /**
     * 发送消息到 AI 服务
     * @param {Array} messages - 消息历史数组
     * @param {Object} config - 渠道配置（apiKey, baseUrl, model 等）
     * @param {Function} onUpdate - 流式更新回调（可选）
     * @param {AbortSignal} signal - 取消信号（可选）
     * @returns {Promise<Object>} - 标准化响应对象
     */
    async call(messages, config, onUpdate, signal) {
        // 实现 API 调用逻辑
    },
    
    /**
     * 获取可用模型列表（可选）
     * @param {Object} config - 渠道配置
     * @returns {Promise<Array<string>>} - 模型 ID 列表
     */
    async fetchModels(config) {
        // 实现模型列表获取
    }
}
```

#### `defaults`

默认配置会在用户创建渠道实例时预填充：

```javascript
defaults: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    params: null,      // 默认参数覆写
    headers: null      // 默认自定义请求头
}
```

#### `capabilities`

能力声明影响 UI 显示和功能可用性：

```javascript
capabilities: {
    streaming: true,   // 启用流式输出选项
    vision: true,      // 启用图片上传功能
    thinking: true     // 支持思考/推理功能（Gemini/OpenAI o1）
}
```

---

## Adapter 接口规范

### `call()` 方法

#### 输入参数

##### `messages` - 消息数组

```javascript
[
    {
        role: 'system',
        content: '你是一个有帮助的助手'
    },
    {
        role: 'user',
        content: '你好',
        // 可选：附件（图片等）
        attachments: [
            {
                type: 'image/png',
                dataUrl: 'data:image/png;base64,...',
                name: 'screenshot.png'
            }
        ],
        // 或在 metadata 中（兼容旧格式）
        metadata: {
            attachments: [...]
        }
    },
    {
        role: 'assistant',
        content: '你好！有什么可以帮助你的？'
    }
]
```

##### `config` - 渠道配置

```javascript
{
    // 基础配置
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    
    // 可选参数
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 4096,
    
    // 参数覆写（用户自定义）
    paramsOverride: {
        frequency_penalty: 0.5
    },
    
    // 自定义请求头
    customHeaders: [
        { key: 'X-Custom-Header', value: 'value' }
    ]
}
```

##### `onUpdate` - 流式回调

```javascript
// 流式更新回调函数
function onUpdate(data) {
    // data 结构
    {
        content: '累积的文本内容',
        reasoning: '推理/思考内容（可选）',
        attachments: [...],  // 附件（如 Gemini 生成的图片）
        metadata: {...}      // 元数据
    }
}
```

##### `signal` - AbortSignal

用于取消正在进行的请求：

```javascript
signal?.aborted  // 检查是否已取消
```

#### 返回格式

必须返回 OpenAI ChatCompletions 魔改格式：

```javascript
{
    choices: [
        {
            message: {
                role: 'assistant',
                content: '回复内容',
                // 可选字段
                reasoning_content: '推理过程',
                attachments: [...],
                metadata: {...}
            },
            finish_reason: 'stop'  // 'stop' | 'length' | 'content_filter'
        }
    ],
    // 可选：token 使用统计
    usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
    }
}
```

### `fetchModels()` 方法

#### 返回格式

```javascript
// 返回模型 ID 字符串数组
['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
```

---

## 注册渠道

### 基本注册

```javascript
// 获取注册中心
const registry = window.IdoFront.channelRegistry;

// 注册渠道类型
registry.registerType('my-channel', {
    adapter: {
        async call(messages, config, onUpdate, signal) {
            // 实现调用逻辑
        }
    },
    label: 'My Channel',
    source: 'external'
});
```

### 注册选项

```javascript
registry.registerType('my-channel', definition, {
    source: 'plugin'  // 来源标识，用于权限控制
});
```

### 查询与管理

```javascript
// 检查渠道是否存在
registry.hasType('openai');  // true

// 获取渠道定义
const gemini = registry.getType('gemini');

// 列出所有渠道
const channels = registry.listTypes();

// 获取注册数量
registry.size;  // 3

// 注销渠道（需匹配来源）
registry.unregisterType('my-channel', { source: 'external' });

// 按来源批量注销
registry.unregisterBySource('plugin');
```

### 事件监听

```javascript
// 监听渠道注册事件
registry.events.on('channel-type:registered', (definition) => {
    console.log('新渠道注册:', definition.id);
});

// 监听渠道注销事件
registry.events.on('channel-type:unregistered', (definition) => {
    console.log('渠道已注销:', definition.id);
});
```

---

## 完整示例

### 示例 1：简单的 OpenAI 兼容渠道

```javascript
/**
 * 自定义 OpenAI 兼容渠道
 * 适用于任何遵循 OpenAI API 格式的服务
 */
(function() {
    const registry = window.IdoFront.channelRegistry;
    
    const adapter = {
        async call(messages, config, onUpdate, signal) {
            // 1. 构建请求 URL
            let baseUrl = config.baseUrl || 'https://api.example.com/v1';
            baseUrl = baseUrl.replace(/\/+$/, '');
            const endpoint = `${baseUrl}/chat/completions`;
            
            // 2. 构建请求头
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            };
            
            // 应用自定义请求头
            if (config.customHeaders) {
                config.customHeaders.forEach(h => {
                    if (h.key && h.value) headers[h.key] = h.value;
                });
            }
            
            // 3. 构建请求体
            const body = {
                model: config.model,
                messages: messages.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                stream: !!onUpdate
            };
            
            // 应用可选参数
            if (config.temperature !== undefined) {
                body.temperature = parseFloat(config.temperature);
            }
            if (config.maxTokens !== undefined) {
                body.max_tokens = parseInt(config.maxTokens);
            }
            
            // 应用参数覆写
            if (config.paramsOverride) {
                Object.assign(body, config.paramsOverride);
            }
            
            // 4. 发送请求
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API Error ${response.status}: ${error}`);
            }
            
            // 5. 处理响应
            if (onUpdate && body.stream) {
                // 流式响应
                return await this.handleStream(response, onUpdate);
            } else {
                // 非流式响应
                const data = await response.json();
                if (onUpdate) {
                    onUpdate({
                        content: data.choices[0]?.message?.content || ''
                    });
                }
                return data;
            }
        },
        
        async handleStream(response, onUpdate) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (!trimmed.startsWith('data: ')) continue;
                    
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullContent += delta;
                            onUpdate({ content: fullContent });
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
            
            return {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: fullContent
                    }
                }]
            };
        },
        
        async fetchModels(config) {
            let baseUrl = config.baseUrl || 'https://api.example.com/v1';
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            const response = await fetch(`${baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`获取模型失败: ${response.status}`);
            }
            
            const data = await response.json();
            return data.data?.map(m => m.id).sort() || [];
        }
    };
    
    // 注册渠道
    registry.registerType('custom-openai', {
        adapter,
        label: 'Custom OpenAI',
        description: '自定义 OpenAI 兼容服务',
        icon: 'science',
        source: 'external',
        version: '1.0.0',
        defaults: {
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-4o'
        },
        capabilities: {
            streaming: true,
            vision: false
        }
    });
    
    console.log('[CustomChannel] Registered');
})();
```

### 示例 2：支持图片的渠道

```javascript
/**
 * 支持 Vision 功能的渠道
 */
(function() {
    const registry = window.IdoFront.channelRegistry;
    
    const adapter = {
        async call(messages, config, onUpdate, signal) {
            const baseUrl = (config.baseUrl || 'https://api.example.com/v1').replace(/\/+$/, '');
            
            // 转换消息格式，支持图片
            const formattedMessages = messages.map(msg => {
                // 检查是否有附件
                const attachments = msg.attachments || msg.metadata?.attachments || [];
                const imageAttachments = attachments.filter(a => 
                    a.type?.startsWith('image/')
                );
                
                if (imageAttachments.length > 0) {
                    // 转换为 Vision 格式
                    const content = [];
                    
                    // 添加文本
                    if (msg.content) {
                        content.push({
                            type: 'text',
                            text: msg.content
                        });
                    }
                    
                    // 添加图片
                    for (const img of imageAttachments) {
                        content.push({
                            type: 'image_url',
                            image_url: {
                                url: img.dataUrl
                            }
                        });
                    }
                    
                    return {
                        role: msg.role,
                        content
                    };
                }
                
                // 普通文本消息
                return {
                    role: msg.role,
                    content: msg.content
                };
            });
            
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: formattedMessages,
                    stream: false
                }),
                signal
            });
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (onUpdate) {
                onUpdate({
                    content: data.choices[0]?.message?.content || ''
                });
            }
            
            return data;
        }
    };
    
    registry.registerType('vision-channel', {
        adapter,
        label: 'Vision Channel',
        description: '支持图片理解的渠道',
        capabilities: {
            streaming: false,
            vision: true  // 启用图片上传
        }
    });
})();
```

### 示例 3：带思考过程的渠道

```javascript
/**
 * 支持推理/思考过程展示的渠道
 * 类似 OpenAI o1 或 Gemini 2.5
 */
(function() {
    const registry = window.IdoFront.channelRegistry;
    
    const adapter = {
        async call(messages, config, onUpdate, signal) {
            const baseUrl = (config.baseUrl || 'https://api.example.com/v1').replace(/\/+$/, '');
            
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: messages.map(m => ({ role: m.role, content: m.content })),
                    stream: true
                }),
                signal
            });
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let fullReasoning = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                
                for (const line of lines) {
                    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                    
                    try {
                        const json = JSON.parse(line.slice(6));
                        const delta = json.choices?.[0]?.delta;
                        
                        if (delta) {
                            // 处理正常内容
                            if (delta.content) {
                                fullContent += delta.content;
                            }
                            
                            // 处理推理内容（OpenAI o1 格式）
                            if (delta.reasoning_content) {
                                fullReasoning += delta.reasoning_content;
                            }
                            
                            // 更新 UI
                            onUpdate({
                                content: fullContent,
                                reasoning: fullReasoning || null
                            });
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
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
    };
    
    registry.registerType('reasoning-channel', {
        adapter,
        label: 'Reasoning Channel',
        description: '支持展示推理过程的渠道',
        capabilities: {
            streaming: true,
            vision: false,
            thinking: true  // 支持思考功能
        }
    });
})();
```

### 示例 4：Anthropic Claude 渠道

```javascript
/**
 * Anthropic Claude API 渠道
 * 展示如何适配非 OpenAI 格式的 API
 */
(function() {
    const registry = window.IdoFront.channelRegistry;
    
    const adapter = {
        async call(messages, config, onUpdate, signal) {
            const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
            
            // 分离 system 消息
            let systemPrompt = '';
            const chatMessages = [];
            
            for (const msg of messages) {
                if (msg.role === 'system') {
                    systemPrompt = msg.content;
                } else {
                    chatMessages.push({
                        role: msg.role,
                        content: msg.content
                    });
                }
            }
            
            // Claude 要求第一条消息必须是 user
            if (chatMessages.length > 0 && chatMessages[0].role !== 'user') {
                chatMessages.unshift({
                    role: 'user',
                    content: '.'  // 占位
                });
            }
            
            const body = {
                model: config.model || 'claude-3-5-sonnet-20241022',
                messages: chatMessages,
                max_tokens: config.maxTokens || 4096,
                stream: !!onUpdate
            };
            
            if (systemPrompt) {
                body.system = systemPrompt;
            }
            
            const response = await fetch(`${baseUrl}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(body),
                signal
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Claude API Error ${response.status}: ${error}`);
            }
            
            if (onUpdate && body.stream) {
                return await this.handleStream(response, onUpdate);
            } else {
                const data = await response.json();
                const content = data.content?.[0]?.text || '';
                
                if (onUpdate) {
                    onUpdate({ content });
                }
                
                // 转换为 OpenAI 格式
                return {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content
                        }
                    }],
                    usage: {
                        prompt_tokens: data.usage?.input_tokens || 0,
                        completion_tokens: data.usage?.output_tokens || 0,
                        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
                    }
                };
            }
        },
        
        async handleStream(response, onUpdate) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    
                    try {
                        const json = JSON.parse(line.slice(6));
                        
                        // Claude SSE 事件类型
                        if (json.type === 'content_block_delta') {
                            const delta = json.delta?.text || '';
                            fullContent += delta;
                            onUpdate({ content: fullContent });
                        }
                    } catch (e) {
                        // 忽略
                    }
                }
            }
            
            return {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: fullContent
                    }
                }]
            };
        },
        
        async fetchModels(config) {
            // Claude 不提供模型列表 API，返回静态列表
            return [
                'claude-3-5-sonnet-20241022',
                'claude-3-5-haiku-20241022',
                'claude-3-opus-20240229',
                'claude-3-sonnet-20240229',
                'claude-3-haiku-20240307'
            ];
        }
    };
    
    registry.registerType('anthropic', {
        adapter,
        label: 'Anthropic Claude',
        description: 'Anthropic Claude API',
        icon: 'psychology',
        source: 'external',
        defaults: {
            baseUrl: 'https://api.anthropic.com',
            model: 'claude-3-5-sonnet-20241022'
        },
        capabilities: {
            streaming: true,
            vision: true
        },
        metadata: {
            provider: 'anthropic',
            docs: 'https://docs.anthropic.com/claude/reference'
        }
    });
    
    console.log('[AnthropicChannel] Registered');
})();
```

---

## 高级功能

### 深度合并参数覆写

使用 `window.IdoFront.utils.deepMerge()` 进行深度合并，避免覆盖嵌套对象：

```javascript
// 在 adapter.call() 中
if (config.paramsOverride && typeof config.paramsOverride === 'object') {
    window.IdoFront.utils.deepMerge(body, config.paramsOverride);
}
```

### 注册 UI 插件

渠道可以注册关联的 UI 插件，在输入框上方显示控件：

```javascript
// 在渠道文件中
function registerChannelUI() {
    if (typeof Framework === 'undefined') return;
    
    const { registerUIBundle, SLOTS } = Framework;
    
    registerUIBundle('my-channel-ui', {
        slots: {
            [SLOTS.INPUT_TOP]: {
                id: 'my-control',
                render: function() {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'flex items-center gap-2';
                    
                    // 创建控件...
                    
                    return wrapper;
                }
            }
        }
    });
}

// 在渠道注册后调用
registerChannelUI();
```

### 注册设置面板

```javascript
function registerChannelSettings() {
    const sm = window.IdoFront?.settingsManager;
    if (!sm?.registerGeneralSection) return;
    
    sm.registerGeneralSection({
        id: 'my-channel-settings',
        title: '我的渠道设置',
        description: '配置我的渠道参数',
        icon: 'settings',
        order: 20,
        render: function(container) {
            // 渲染设置 UI
            const input = document.createElement('input');
            input.type = 'text';
            // ...
            container.appendChild(input);
        }
    });
}
```

### 错误处理最佳实践

```javascript
async call(messages, config, onUpdate, signal) {
    try {
        const response = await fetch(url, { ... });
        
        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg = `API Error ${response.status}`;
            
            try {
                const errorJson = JSON.parse(errorText);
                // 尝试提取错误消息
                if (errorJson.error?.message) {
                    errorMsg += `: ${errorJson.error.message}`;
                } else if (errorJson.message) {
                    errorMsg += `: ${errorJson.message}`;
                } else {
                    errorMsg += `: ${errorText}`;
                }
            } catch (e) {
                errorMsg += `: ${errorText}`;
            }
            
            throw new Error(errorMsg);
        }
        
        // 处理响应...
        
    } catch (error) {
        // 检查是否是用户取消
        if (signal?.aborted) {
            throw new Error('请求已取消');
        }
        
        console.error('[MyChannel] Error:', error);
        throw error;
    }
}
```

---

## 常见问题

### Q: 如何测试渠道？

在浏览器控制台中测试：

```javascript
// 获取渠道适配器
const channel = window.IdoFront.channelRegistry.getType('my-channel');

// 测试调用
channel.adapter.call(
    [{ role: 'user', content: '你好' }],
    { apiKey: 'your-key', model: 'test-model' },
    (update) => console.log('Update:', update)
).then(result => {
    console.log('Result:', result);
}).catch(err => {
    console.error('Error:', err);
});
```

### Q: 渠道如何获取当前会话信息？

```javascript
const store = window.IdoFront?.store;
if (store) {
    const conv = store.getActiveConversation();
    // conv.selectedModel, conv.metadata 等
}
```

### Q: 如何实现多轮对话的上下文续写？

将交互 ID 保存到会话 metadata 中：

```javascript
// 保存
if (!conv.metadata) conv.metadata = {};
conv.metadata.myChannel = { interactionId: responseId };
store.persist();

// 读取
const interactionId = conv.metadata?.myChannel?.interactionId;
```

### Q: 渠道注册失败怎么办？

检查以下几点：

1. `adapter.call` 必须是函数
2. 渠道 type 不能为空
3. 检查是否与现有渠道冲突（不同 source 不能覆盖）

```javascript
// 查看错误详情
try {
    registry.registerType('test', definition);
} catch (e) {
    console.error('注册失败:', e.message);
}
```

### Q: 如何支持自定义请求头？

在 `config.customHeaders` 中传递：

```javascript
// adapter.call() 中
if (config.customHeaders && Array.isArray(config.customHeaders)) {
    config.customHeaders.forEach(header => {
        if (header.key && header.value) {
            headers[header.key] = header.value;
        }
    });
}
```

---

## 附录：内置渠道类型

| 类型 | 标签 | 说明 |
|------|------|------|
| `openai` | OpenAI Compatible | OpenAI ChatCompletions 兼容接口 |
| `openai-responses` | OpenAI Responses | OpenAI Responses API (/v1/responses) |
| `gemini` | Google Gemini | Google Gemini API，支持思考功能 |
| `claude` | Anthropic Claude | Anthropic Claude API，支持 Extended Thinking |

---

*文档版本: 1.0.0*