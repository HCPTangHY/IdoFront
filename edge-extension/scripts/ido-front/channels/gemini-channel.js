/**
 * Gemini Channel Adapter
 * Handles communication with Google Gemini API
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channels = window.IdoFront.channels || {};
    window.IdoFront.geminiChannel = window.IdoFront.geminiChannel || {};

    const registry = window.IdoFront.channelRegistry;
    const CHANNEL_ID = 'gemini';

    // ========== Gemini Thinking Budget Configuration ==========
    
    // 存储键
    const THINKING_RULES_STORAGE_KEY = 'ido.gemini.thinkingRules';
    
    // 默认思考规则配置（正则表达式字符串）
    const DEFAULT_THINKING_RULES = {
        // 使用 thinkingBudget (数值) 的模型匹配规则
        budgetModelPattern: 'gemini-2\\.5|gemini-2-5',
        // 使用 thinkingLevel (low/high) 的模型匹配规则
        // 排除 gemini-3-pro-image 系列（图像生成模型不支持思考功能）
        levelModelPattern: 'gemini-3(?!.*-pro-image)'
    };
    
    // 全局规则缓存
    let cachedGlobalRules = null;

    // thinkingBudget 预设选项（用于数值模式）
    const BUDGET_PRESETS = [
        { value: -1, label: '自动', description: '动态思考，模型自行决定' },
        { value: 0, label: '关闭', description: '关闭思考功能' },
        { value: 1024, label: '低', description: '1024 tokens' },
        { value: 8192, label: '中', description: '8192 tokens' },
        { value: 24576, label: '高', description: '24576 tokens' },
        { value: 32768, label: '最高', description: '32768 tokens' }
    ];

    // thinkingLevel 选项（用于等级模式）- N/L/H 三档
    const LEVEL_OPTIONS = [
        { value: 'none', label: 'N', description: '无 (None) - 不使用思考' },
        { value: 'low', label: 'L', description: '低 (Low) - 较少思考' },
        { value: 'high', label: 'H', description: '高 (High) - 深度思考' }
    ];

    /**
     * 从 Framework.storage 加载全局思考规则
     * @returns {Object} 全局思考规则
     */
    function loadGlobalThinkingRules() {
        if (cachedGlobalRules) return cachedGlobalRules;
        
        try {
            if (typeof Framework !== 'undefined' && Framework.storage) {
                const saved = Framework.storage.getItem(THINKING_RULES_STORAGE_KEY);
                if (saved && typeof saved === 'object') {
                    cachedGlobalRules = {
                        budgetModelPattern: saved.budgetModelPattern || DEFAULT_THINKING_RULES.budgetModelPattern,
                        levelModelPattern: saved.levelModelPattern || DEFAULT_THINKING_RULES.levelModelPattern
                    };
                    return cachedGlobalRules;
                }
            }
        } catch (e) {
            console.warn('[GeminiChannel] Failed to load global thinking rules:', e);
        }
        
        return { ...DEFAULT_THINKING_RULES };
    }
    
    /**
     * 保存全局思考规则到 Framework.storage
     * @param {Object} rules - 思考规则
     */
    function saveGlobalThinkingRules(rules) {
        try {
            if (typeof Framework !== 'undefined' && Framework.storage) {
                Framework.storage.setItem(THINKING_RULES_STORAGE_KEY, rules);
                cachedGlobalRules = { ...rules };
            }
        } catch (e) {
            console.warn('[GeminiChannel] Failed to save global thinking rules:', e);
        }
    }

    /**
     * 获取思考规则配置（优先使用全局配置）
     * @param {Object} channelConfig - 渠道配置对象（可选，用于未来扩展渠道级覆盖）
     * @returns {Object} 思考规则配置
     */
    function getThinkingRules(channelConfig) {
        // 加载全局规则
        return loadGlobalThinkingRules();
    }

    /**
     * 判断模型是否使用 thinkingBudget 模式（数值预算）
     * @param {string} modelName - 模型名称
     * @param {Object} channelConfig - 渠道配置
     * @returns {boolean}
     */
    function useBudgetMode(modelName, channelConfig) {
        if (!modelName) return false;
        const rules = getThinkingRules(channelConfig);
        if (!rules.budgetModelPattern) return false;
        try {
            const regex = new RegExp(rules.budgetModelPattern, 'i');
            return regex.test(modelName);
        } catch (e) {
            console.warn('[GeminiChannel] Invalid budget model pattern:', rules.budgetModelPattern, e);
            return false;
        }
    }

    /**
     * 判断模型是否使用 thinkingLevel 模式（等级选择）
     * @param {string} modelName - 模型名称
     * @param {Object} channelConfig - 渠道配置
     * @returns {boolean}
     */
    function useLevelMode(modelName, channelConfig) {
        if (!modelName) return false;
        const rules = getThinkingRules(channelConfig);
        if (!rules.levelModelPattern) return false;
        try {
            const regex = new RegExp(rules.levelModelPattern, 'i');
            return regex.test(modelName);
        } catch (e) {
            console.warn('[GeminiChannel] Invalid level model pattern:', rules.levelModelPattern, e);
            return false;
        }
    }

    /**
     * 判断模型是否支持思考功能
     * @param {string} modelName - 模型名称
     * @param {Object} channelConfig - 渠道配置
     * @returns {boolean}
     */
    function supportsThinking(modelName, channelConfig) {
        return useBudgetMode(modelName, channelConfig) || useLevelMode(modelName, channelConfig);
    }

    /**
     * 获取会话的 Gemini 思考配置
     * @param {Object} conv - 会话对象
     * @returns {Object} 思考配置
     */
    function getThinkingConfig(conv) {
        if (!conv) return { budget: -1, level: 'none' };
        const geminiMeta = conv.metadata?.gemini || {};
        return {
            budget: geminiMeta.thinkingBudget !== undefined ? geminiMeta.thinkingBudget : -1,
            level: geminiMeta.thinkingLevel || 'none'
        };
    }

    /**
     * 设置会话的 Gemini 思考预算 (Gemini 2.5)
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {number} budget - 思考预算
     */
    function setThinkingBudget(store, convId, budget) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;
        
        if (!conv.metadata) conv.metadata = {};
        if (!conv.metadata.gemini) conv.metadata.gemini = {};
        conv.metadata.gemini.thinkingBudget = budget;
        
        if (typeof store.persist === 'function') {
            store.persist();
        }
    }

    /**
     * 设置会话的 Gemini 思考等级 (Gemini 3)
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {string} level - 思考等级
     */
    function setThinkingLevel(store, convId, level) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;
        
        if (!conv.metadata) conv.metadata = {};
        if (!conv.metadata.gemini) conv.metadata.gemini = {};
        conv.metadata.gemini.thinkingLevel = level;
        
        if (typeof store.persist === 'function') {
            store.persist();
        }
    }

     // Helper: Convert Gemini parts to displayable content, reasoning, attachments and thoughtSignature
    function partsToContent(parts) {
        if (!parts || !Array.isArray(parts)) return { content: '', reasoning: null, attachments: null, thoughtSignature: null };
        
        let content = '';
        let reasoning = '';
        const attachments = [];
        let imageIndex = 1;
        let thoughtSignature = null;
        
        for (const part of parts) {
            if (part.text) {
                // Check if this is a thought part
                if (part.thought === true) {
                    reasoning += part.text;
                } else {
                    content += part.text;
                }
            }
            if (part.inlineData) {
                const { mimeType, data } = part.inlineData;
                
                // 将 Gemini 的 inlineData 转为浏览器可直接使用的 data URL，交给 DOM <img> 渲染，
                // 避免把超长 Base64 串拼进 Markdown 再交给 marked 解析，降低性能开销。
                if (mimeType && typeof data === 'string') {
                    const dataUrl = `data:${mimeType};base64,${data}`;
                    
                    // 尽量估算原始字节大小（Base64 长度 * 3/4），仅作为展示/调试用途
                    let approximateSize = undefined;
                    try {
                        approximateSize = Math.round((data.length * 3) / 4);
                    } catch (e) {
                        approximateSize = undefined;
                    }
                    
                    attachments.push({
                        dataUrl: dataUrl,
                        type: mimeType,
                        name: `Gemini Image ${imageIndex++}`,
                        size: approximateSize,
                        source: 'gemini'
                    });
                }
            }
            // 提取 thoughtSignature（per-part 级别，但对于简单文本对话通常只有一个）
            if (part.thoughtSignature) {
                thoughtSignature = part.thoughtSignature;
            }
        }
        
        return {
            content,
            reasoning: reasoning || null,
            attachments: attachments.length > 0 ? attachments : null,
            thoughtSignature: thoughtSignature
        };
    }

    /**
     * 判断 finishReason 是否表示正常结束
     * @param {string} finishReason - Gemini 的结束原因
     * @returns {boolean} 是否正常结束
     */
    function isNormalFinish(finishReason) {
        // STOP: 正常结束
        // OTHER: 其他原因但仍然正常
        // FINISH_REASON_UNSPECIFIED: 未指定，视为正常
        // null/undefined: 流式中尚未结束
        return !finishReason || finishReason === 'STOP' || finishReason === 'OTHER' || finishReason === 'FINISH_REASON_UNSPECIFIED';
    }

    /**
     * 根据 finishReason 返回警告提示
     * @param {string} finishReason - Gemini 的结束原因
     * @returns {string|null} 警告提示文本，正常结束返回 null
     */
    function getFinishReasonWarning(finishReason) {
        if (isNormalFinish(finishReason)) return null;
        
        const warnings = {
            'SAFETY': '⚠️ 内容因安全原因被过滤',
            'IMAGE_SAFETY': '⚠️ 图片因安全原因被过滤',
            'RECITATION': '⚠️ 内容因引用/版权问题被截断',
            'MAX_TOKENS': '⚠️ 内容因达到最大 token 限制被截断',
            'BLOCKLIST': '⚠️ 内容因触发屏蔽列表被过滤',
            'PROHIBITED_CONTENT': '⚠️ 内容因包含禁止内容被过滤',
            'SPII': '⚠️ 内容因包含敏感个人信息被过滤',
            'MALFORMED_FUNCTION_CALL': '⚠️ 函数调用格式错误',
            'LANGUAGE': '⚠️ 不支持的语言'
        };
        
        return warnings[finishReason] || `⚠️ 生成异常终止 (${finishReason})`;
    }

    // Helper: Convert message to Gemini format
    function convertMessages(messages) {
        const contents = [];
        let systemInstruction = undefined;

        for (const msg of messages) {
            if (msg.role === 'system') {
                // System instruction - always use text content
                systemInstruction = {
                    parts: [{ text: msg.content || '' }]
                };
            } else {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                
                let parts = [];
                
                // 从 metadata 中读取 thoughtSignature（仅对 assistant/model 消息）
                const thoughtSig = (role === 'model' && msg.metadata?.gemini?.thoughtSignature)
                    ? msg.metadata.gemini.thoughtSignature
                    : null;
                
                // 构建 parts：从消息顶层字段读取
                
                // 1. 添加附件（用户消息或助手消息，从消息顶层的 attachments 读取）
                if (msg.attachments && Array.isArray(msg.attachments)) {
                    for (const attachment of msg.attachments) {
                        if (attachment.type && attachment.type.startsWith('image/')) {
                            // 提取 base64 数据
                            const base64Data = attachment.dataUrl.split(',')[1];
                            const part = {
                                inlineData: {
                                    mimeType: attachment.type,
                                    data: base64Data
                                }
                            };
                            // thought_signature 与 inlineData 平级
                            if (thoughtSig) {
                                part.thought_signature = thoughtSig;
                            }
                            parts.push(part);
                        }
                    }
                } else if (msg.metadata?.attachments && Array.isArray(msg.metadata.attachments)) {
                    // 兼容旧数据：从 metadata.attachments 读取
                    for (const attachment of msg.metadata.attachments) {
                        if (attachment.type && attachment.type.startsWith('image/')) {
                            const base64Data = attachment.dataUrl.split(',')[1];
                            const part = {
                                inlineData: {
                                    mimeType: attachment.type,
                                    data: base64Data
                                }
                            };
                            // thought_signature 与 inlineData 平级
                            if (thoughtSig) {
                                part.thought_signature = thoughtSig;
                            }
                            parts.push(part);
                        }
                    }
                }
                
                // 2. 添加文本内容（可能为空，Gemini 允许纯图片消息）
                if (msg.content) {
                    const part = { text: msg.content };
                    // thought_signature 与 text 平级
                    if (thoughtSig) {
                        part.thought_signature = thoughtSig;
                    }
                    parts.push(part);
                }
                
                const geminiMsg = {
                    role: role,
                    parts: parts
                };
                
                contents.push(geminiMsg);
            }
        }
        return { contents, systemInstruction };
    }

    const adapter = {
        /**
         * Send message to Gemini API
         * @param {Array} messages - Chat history
         * @param {Object} config - Channel configuration
         * @param {Function} onUpdate - Optional callback for streaming updates
         * @param {AbortSignal} signal - Optional abort signal for cancellation
         * @returns {Promise<Object>} - Response content
         */
        async call(messages, config, onUpdate, signal) {
            let baseUrl = config.baseUrl;
            if (!baseUrl || !baseUrl.trim()) {
                baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
            }
            // Normalize URL: remove trailing slash
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            // Handle model name (strip models/ prefix if present to avoid double prefixing)
            let model = config.model;
            if (model.startsWith('models/')) {
                model = model.substring(7);
            }

            // Use SSE for streaming if requested
            const isStream = !!onUpdate;
            const action = isStream ? 'streamGenerateContent' : 'generateContent';
            
            // Construct URL
            // Standard: https://generativelanguage.googleapis.com/v1beta/models/{model}:{action}
            // If streaming, add alt=sse
            let url = `${baseUrl}/models/${model}:${action}`;
            if (isStream) {
                url += '?alt=sse';
            }

            const { contents, systemInstruction } = convertMessages(messages);

            const body = {
                contents: contents
            };
            
            if (systemInstruction) {
                body.systemInstruction = systemInstruction;
            }

            // Generation Config
            const generationConfig = {};
            if (config.temperature !== undefined) generationConfig.temperature = parseFloat(config.temperature);
            if (config.topP !== undefined) generationConfig.topP = parseFloat(config.topP);
            if (config.maxTokens !== undefined) generationConfig.maxOutputTokens = parseInt(config.maxTokens);

            // Thinking Config - 根据模型规则添加思考配置
            // 直接从 store 获取当前会话的 gemini 配置
            let geminiMeta = {};
            try {
                const store = window.IdoFront && window.IdoFront.store;
                if (store && typeof store.getActiveConversation === 'function') {
                    const conv = store.getActiveConversation();
                    if (conv && conv.metadata && conv.metadata.gemini) {
                        geminiMeta = conv.metadata.gemini;
                    }
                }
            } catch (e) {
                console.warn('[GeminiChannel] Failed to get conversation metadata:', e);
            }
            
            const thinkingConfig = {};
            
            if (useBudgetMode(model, config)) {
                // 数值预算模式：使用 thinkingBudget
                const budget = geminiMeta.thinkingBudget !== undefined
                    ? geminiMeta.thinkingBudget
                    : -1; // 默认动态思考
                if (budget !== -1) {
                    thinkingConfig.thinkingBudget = budget;
                }
                // 启用思考摘要
                thinkingConfig.includeThoughts = true;
            } else if (useLevelMode(model, config)) {
                // 等级模式：使用 thinkingLevel
                const level = geminiMeta.thinkingLevel || 'none';
                if (level !== 'none') {
                    thinkingConfig.thinkingLevel = level;
                    // 启用思考摘要（仅当非 none 时）
                    thinkingConfig.includeThoughts = true;
                }
            }

            // 将 thinkingConfig 合并到 generationConfig
            if (Object.keys(thinkingConfig).length > 0) {
                generationConfig.thinkingConfig = thinkingConfig;
            }
            
            if (Object.keys(generationConfig).length > 0) {
                body.generationConfig = generationConfig;
            }

            // Apply params override - 使用深度合并，避免覆盖嵌套对象
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                    window.IdoFront.utils.deepMerge(body, config.paramsOverride);
            }

            const headers = {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey
            };

            // Apply custom headers
            if (config.customHeaders && Array.isArray(config.customHeaders)) {
                config.customHeaders.forEach(header => {
                    if (header.key && header.value) {
                        headers[header.key] = header.value;
                    }
                });
            }

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body),
                    signal: signal // 传递取消信号
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMsg = `Gemini API Error ${response.status}`;
                    try {
                        const errorJson = JSON.parse(errorText);
                        if (errorJson.error && errorJson.error.message) {
                            errorMsg += `: ${errorJson.error.message}`;
                        } else {
                            errorMsg += `: ${errorText}`;
                        }
                    } catch (e) {
                        errorMsg += `: ${errorText}`;
                    }
                    throw new Error(errorMsg);
                }

                if (isStream) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let buffer = '';
                    let accumulatedParts = [];
                    let lastThoughtSignature = null;
                    let lastFinishReason = null;

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop(); // Keep the last incomplete line

                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed) continue;
                                
                                // SSE format: data: {json}
                                if (trimmed.startsWith('data: ')) {
                                    const jsonStr = trimmed.substring(6);
                                    if (jsonStr === '[DONE]') continue;

                                    try {
                                        const json = JSON.parse(jsonStr);
                                        const candidate = json.candidates?.[0];
                                        
                                        // 检测 finishReason - Gemini 的流式结束标志
                                        if (candidate?.finishReason) {
                                            lastFinishReason = candidate.finishReason;
                                        }
                                        
                                        if (candidate && candidate.content && candidate.content.parts) {
                                            const newParts = candidate.content.parts;
                                            const thoughtSignature = candidate.thoughtSignature;
                                            
                                            // Accumulate parts incrementally
                                            accumulatedParts = accumulatedParts.concat(newParts);
                                            lastThoughtSignature = thoughtSignature;
                                            
                                            const { content, reasoning, attachments, thoughtSignature: extractedSignature } = partsToContent(accumulatedParts);
                                            
                                            const updateData = {
                                                content: content,
                                                reasoning: reasoning,
                                                attachments: attachments,
                                                metadata: {
                                                    gemini: {
                                                        thoughtSignature: extractedSignature || thoughtSignature
                                                    }
                                                }
                                            };
                                            
                                            // 传递 finishReason 给上层，用于判断流式是否结束
                                            if (lastFinishReason) {
                                                updateData.finishReason = lastFinishReason;
                                            }
                                            
                                            onUpdate(updateData);
                                        } else if (lastFinishReason) {
                                            // 收到 finishReason 但没有新内容，仍需通知上层流式已结束
                                            const { content, reasoning, attachments, thoughtSignature: extractedSignature } = partsToContent(accumulatedParts);
                                            const updateData = {
                                                content: content,
                                                reasoning: reasoning,
                                                finishReason: lastFinishReason,
                                                attachments: attachments,
                                                metadata: {
                                                    gemini: {
                                                        thoughtSignature: extractedSignature || lastThoughtSignature
                                                    }
                                                }
                                            };
                                            onUpdate(updateData);
                                        }
                                    } catch (e) {
                                        console.warn('Error parsing Gemini stream data:', e);
                                    }
                                }
                            }
                        }
                    } catch (streamError) {
                        console.error('Stream reading error:', streamError);
                        throw streamError;
                    }

                    let { content, reasoning, attachments, thoughtSignature: extractedSignature } = partsToContent(accumulatedParts);
                    
                    // 处理非正常结束的情况，添加警告提示
                    const finishWarning = getFinishReasonWarning(lastFinishReason);
                    if (finishWarning) {
                        content = content ? `${content}\n\n${finishWarning}` : finishWarning;
                    }
                    
                    const result = {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: content,
                                reasoning_content: reasoning,
                                attachments: attachments,
                                metadata: {
                                    gemini: {
                                        thoughtSignature: extractedSignature || lastThoughtSignature
                                    }
                                }
                            },
                            finish_reason: lastFinishReason
                        }]
                    };
                    
                    return result;

                } else {
                    // Non-streaming response
                    const data = await response.json();
                    const candidate = data.candidates?.[0];
                    const parts = candidate?.content?.parts || [];
                    const thoughtSignature = candidate?.thoughtSignature;
                    const finishReason = candidate?.finishReason;
                    let { content, reasoning, attachments, thoughtSignature: extractedSignature } = partsToContent(parts);
                    
                    // 处理非正常结束的情况，添加警告提示
                    const finishWarning = getFinishReasonWarning(finishReason);
                    if (finishWarning) {
                        content = content ? `${content}\n\n${finishWarning}` : finishWarning;
                    }
                    
                    // Mimic OpenAI response structure for compatibility
                    const result = {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: content,
                                reasoning_content: reasoning,
                                attachments: attachments,
                                metadata: {
                                    gemini: {
                                        thoughtSignature: extractedSignature || thoughtSignature
                                    }
                                }
                            },
                            finish_reason: finishReason
                        }]
                    };
                    
                    return result;
                }

            } catch (error) {
                console.error('Gemini Channel Error:', error);
                throw error;
            }
        },

        /**
         * Fetch available models from Gemini API
         * @param {Object} config - Channel configuration
         * @returns {Promise<Array>} - List of model IDs
         */
        async fetchModels(config) {
            let baseUrl = config.baseUrl;
            if (!baseUrl || !baseUrl.trim()) {
                baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
            }
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            let allModels = [];
            let pageToken = null;
            
            try {
                do {
                    // Construct URL with pageSize and pageToken
                    let url = `${baseUrl}/models?pageSize=1000`;
                    if (pageToken) {
                        url += `&pageToken=${encodeURIComponent(pageToken)}`;
                    }
                    
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-goog-api-key': config.apiKey
                        }
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`获取模型失败 ${response.status}: ${errorText}`);
                    }

                    const data = await response.json();
                    
                    if (data.models && Array.isArray(data.models)) {
                        // Extract model names and strip 'models/' prefix
                        const models = data.models.map(m => m.name.replace(/^models\//, ''));
                        allModels = allModels.concat(models);
                    }
                    
                    // Update pageToken for next iteration
                    pageToken = data.nextPageToken;
                    
                } while (pageToken); // Continue until no next page token

                return allModels.sort();
                
            } catch (error) {
                console.error('Fetch Gemini Models Error:', error);
                throw error;
            }
        }
    };

    // Register with channelRegistry
    if (registry) {
        registry.registerType(CHANNEL_ID, {
            adapter: adapter,
            label: 'Google Gemini',
            source: 'core',
            version: '1.0.0',
            defaults: {
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
            },
            capabilities: {
                streaming: true,
                vision: true,
                thinking: true // 支持思考功能
            },
            metadata: {
                provider: 'google'
            }
        });
    } else {
        // Fallback for older versions or if registry is not available
        window.IdoFront.channels[CHANNEL_ID] = adapter;
    }

    // ========== Gemini Thinking Budget UI Components ==========
    // 使用 Framework API 直接注册插件，无需外部调用
    
    /**
     * 获取当前渠道配置
     * @param {Object} store - Store 实例
     * @param {Object} conv - 会话对象
     * @returns {Object|null} 渠道配置
     */
    function getChannelConfig(store, conv) {
        if (!store || !conv || !conv.selectedChannelId) return null;
        return store.state.channels.find(c => c.id === conv.selectedChannelId) || null;
    }
    
    /**
     * 获取 Store 实例
     */
    function getStore() {
        return window.IdoFront && window.IdoFront.store ? window.IdoFront.store : null;
    }

    /**
     * 注册 Gemini 思考预算 UI 插件
     * 直接使用 Framework.registerPlugin，无需外部调用
     */
    function registerThinkingBudgetPlugin() {
        if (typeof Framework === 'undefined' || !Framework) {
            console.warn('[GeminiChannel] Framework API not available for UI registration');
            return;
        }
        
        // 优先使用 registerUIBundle（纯 UI 组件），回退到 registerPluginBundle
        const registerBundle = Framework.registerUIBundle || Framework.registerPluginBundle;
        if (!registerBundle) {
            console.warn('[GeminiChannel] No bundle registration API available');
            return;
        }
        
        const { SLOTS, events, showBottomSheet, hideBottomSheet } = Framework;
        
        if (!SLOTS || !SLOTS.INPUT_TOP) {
            console.warn('[GeminiChannel] INPUT_TOP slot not available');
            return;
        }

        // 使用唯一 ID 来查找 DOM 元素，避免引用失效问题
        const WRAPPER_ID = 'core-gemini-thinking-budget-wrapper';
        
        // UI 状态（仅存储非 DOM 状态）
        let storeEventRegistered = false;
        
        // 缓存 Level 模式按钮引用（类似 GPT 的 headerState）
        const levelState = {
            buttons: {}
        };

        /**
         * 显示数值预算底部弹窗（用于匹配 budgetModelPattern 的模型）
         * 使用 Framework.showBottomSheet
         */
        function showBudgetBottomSheet(conv, channelConfig) {
            const store = getStore();
            if (!store) return;
            
            showBottomSheet((sheetContainer) => {
                // Header
                const header = document.createElement('div');
                header.className = 'px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white';
                
                const title = document.createElement('h3');
                title.className = 'text-lg font-semibold text-gray-800';
                title.textContent = '思考预算 (thinkingBudget)';
                
                const closeBtn = document.createElement('button');
                closeBtn.className = 'text-gray-400 hover:text-gray-600 transition-colors';
                closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                closeBtn.onclick = () => hideBottomSheet();
                
                header.appendChild(title);
                header.appendChild(closeBtn);
                
                // Body
                const body = document.createElement('div');
                body.className = 'flex-1 overflow-y-auto px-6 py-4';
                
                const thinkingCfg = getThinkingConfig(conv);
                let currentBudget = thinkingCfg.budget;
                
                // 说明文字
                const description = document.createElement('div');
                description.className = 'text-sm text-gray-600 mb-4';
                description.textContent = '设置模型思考时使用的 token 预算。较高的预算会让模型进行更深入的思考，但响应速度会变慢。';
                body.appendChild(description);

                // 预设按钮组
                const presetsWrapper = document.createElement('div');
                presetsWrapper.className = 'grid grid-cols-3 gap-3 mb-6';

                const presetButtons = [];
                BUDGET_PRESETS.forEach(preset => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'px-3 py-2.5 text-sm rounded-lg border transition-all transform hover:-translate-y-0.5 duration-200';
                    
                    const labelDiv = document.createElement('div');
                    labelDiv.className = 'font-medium';
                    labelDiv.textContent = preset.label;
                    
                    const descDiv = document.createElement('div');
                    descDiv.className = 'text-[10px] mt-0.5 opacity-70';
                    descDiv.textContent = preset.description;
                    
                    btn.appendChild(labelDiv);
                    btn.appendChild(descDiv);
                    
                    const updateBtnStyle = () => {
                        presetButtons.forEach(b => {
                            b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                            b.classList.add('bg-white', 'text-gray-700', 'border-gray-200', 'hover:border-blue-400', 'hover:shadow-sm');
                        });
                        if (currentBudget === preset.value) {
                            btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-200', 'hover:border-blue-400', 'hover:shadow-sm');
                            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                        }
                    };
                    
                    btn.onclick = () => {
                        currentBudget = preset.value;
                        setThinkingBudget(store, conv.id, currentBudget);
                        updateBtnStyle();
                        updateSlider();
                        updateCustomInput();
                        updateThinkingControls(); // 更新工具栏按钮
                    };
                    
                    presetButtons.push(btn);
                    presetsWrapper.appendChild(btn);
                });
                body.appendChild(presetsWrapper);

                // 滑槽调节区域
                const sliderSection = document.createElement('div');
                sliderSection.className = 'mb-6';
                
                const sliderTitle = document.createElement('div');
                sliderTitle.className = 'text-sm font-medium text-gray-700 mb-2';
                sliderTitle.textContent = '自定义数值';
                sliderSection.appendChild(sliderTitle);

                const sliderWrapper = document.createElement('div');
                sliderWrapper.className = 'space-y-2';

                const sliderLabel = document.createElement('div');
                sliderLabel.className = 'flex justify-between text-xs text-gray-500';
                sliderLabel.innerHTML = '<span>128</span><span>32768</span>';
                sliderWrapper.appendChild(sliderLabel);

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '128';
                slider.max = '32768';
                slider.step = '128';
                slider.className = 'w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600';
                
                const updateSlider = () => {
                    if (currentBudget <= 0) {
                        slider.value = '128';
                        slider.disabled = true;
                        slider.classList.add('opacity-50');
                    } else {
                        slider.value = String(Math.max(128, Math.min(32768, currentBudget)));
                        slider.disabled = false;
                        slider.classList.remove('opacity-50');
                    }
                };

                // oninput: 只更新 UI，不保存到 store（避免卡顿）
                slider.oninput = () => {
                    currentBudget = parseInt(slider.value, 10);
                    updateCustomInput();
                    // 更新预设按钮高亮
                    presetButtons.forEach((btn, idx) => {
                        const preset = BUDGET_PRESETS[idx];
                        btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                        btn.classList.add('bg-white', 'text-gray-700', 'border-gray-200');
                        if (currentBudget === preset.value) {
                            btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-200');
                            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                        }
                    });
                };
                
                // onchange: 拖动结束时才保存到 store
                slider.onchange = () => {
                    currentBudget = parseInt(slider.value, 10);
                    setThinkingBudget(store, conv.id, currentBudget);
                    updateThinkingControls(); // 更新工具栏按钮
                };

                sliderWrapper.appendChild(slider);
                sliderSection.appendChild(sliderWrapper);
                body.appendChild(sliderSection);

                // 自定义输入
                const customSection = document.createElement('div');
                customSection.className = 'flex items-center gap-3';

                const customLabel = document.createElement('span');
                customLabel.className = 'text-sm text-gray-600';
                customLabel.textContent = '精确值:';

                const customInput = document.createElement('input');
                customInput.type = 'number';
                customInput.min = '-1';
                customInput.max = '32768';
                customInput.className = 'flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
                customInput.placeholder = '-1 表示自动';
                
                const updateCustomInput = () => {
                    customInput.value = currentBudget === -1 ? '' : String(currentBudget);
                };

                customInput.onchange = () => {
                    const val = parseInt(customInput.value, 10);
                    if (isNaN(val) || customInput.value === '') {
                        currentBudget = -1;
                    } else {
                        currentBudget = Math.max(-1, Math.min(32768, val));
                    }
                    setThinkingBudget(store, conv.id, currentBudget);
                    updateSlider();
                    // 更新预设按钮
                    presetButtons.forEach((btn, idx) => {
                        const preset = BUDGET_PRESETS[idx];
                        btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                        btn.classList.add('bg-white', 'text-gray-700', 'border-gray-200');
                        if (currentBudget === preset.value) {
                            btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-200');
                            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                        }
                    });
                    updateThinkingControls(); // 更新工具栏按钮
                };

                customSection.appendChild(customLabel);
                customSection.appendChild(customInput);
                body.appendChild(customSection);

                // 初始化状态
                updateSlider();
                updateCustomInput();
                presetButtons.forEach((btn, idx) => {
                    const preset = BUDGET_PRESETS[idx];
                    if (currentBudget === preset.value) {
                        btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-200');
                        btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                    }
                });
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
            });
        }

        /**
         * 获取思考控件的 wrapper 元素（每次从 DOM 中查询，避免引用失效）
         */
        function getThinkingWrapper() {
            return document.getElementById(WRAPPER_ID);
        }

        /**
         * 更新思考控件的显示状态
         * 对于 Budget 模式：显示一个按钮，点击打开 BottomSheet
         * 对于 Level 模式：显示三个并排按钮（自动/低/高）
         */
        function updateThinkingControls() {
            const wrapper = getThinkingWrapper();
            if (!wrapper) {
                return;
            }
            
            const store = getStore();
            if (!store || !store.getActiveConversation) {
                wrapper.style.display = 'none';
                return;
            }

            const conv = store.getActiveConversation();
            if (!conv) {
                wrapper.style.display = 'none';
                return;
            }
            
            // 获取选中的模型名称
            const model = conv.selectedModel;
            if (!model) {
                wrapper.style.display = 'none';
                return;
            }

            // 获取渠道配置
            const channelConfig = getChannelConfig(store, conv);
            
            // 检查渠道类型 - 如果没有渠道配置或不是 Gemini 渠道，隐藏
            if (!channelConfig || channelConfig.type !== 'gemini') {
                wrapper.style.display = 'none';
                return;
            }
            
            // 检查模型是否支持思考功能
            if (!supportsThinking(model, channelConfig)) {
                wrapper.style.display = 'none';
                return;
            }

            // 显示控件
            wrapper.style.display = 'flex';

            const thinkingCfg = getThinkingConfig(conv);
            
            // 获取容器内的元素
            const budgetBtnEl = wrapper.querySelector('[data-gemini-budget-btn]');
            const levelGroupEl = wrapper.querySelector('[data-gemini-level-group]');
            
            if (useBudgetMode(model, channelConfig)) {
                // Budget 模式：显示单个按钮，隐藏三按钮组
                if (budgetBtnEl) {
                    budgetBtnEl.style.display = 'inline-flex';
                    const budget = thinkingCfg.budget;
                    const preset = BUDGET_PRESETS.find(p => p.value === budget);
                    budgetBtnEl.textContent = preset ? preset.label : `${budget}`;
                }
                if (levelGroupEl) {
                    levelGroupEl.style.display = 'none';
                }
            } else if (useLevelMode(model, channelConfig)) {
                // Level 模式：隐藏按钮，显示三按钮组
                if (budgetBtnEl) {
                    budgetBtnEl.style.display = 'none';
                }
                if (levelGroupEl) {
                    levelGroupEl.style.display = 'flex';
                    
                    // 更新按钮状态
                    const currentLevel = thinkingCfg.level;
                    ['none', 'low', 'high'].forEach(key => {
                        const btn = levelState.buttons[key];
                        if (!btn) return;
                        btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                        btn.classList.remove('bg-gray-50', 'text-gray-500', 'border-gray-200');
                        if (key === currentLevel) {
                            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
                        } else {
                            btn.classList.add('bg-gray-50', 'text-gray-500', 'border-gray-200');
                        }
                    });
                }
            }
        }

        /**
         * 确保 store 事件监听器已注册
         * 如果 store 尚未就绪，会延迟重试
         */
        function ensureStoreEventRegistered() {
            if (storeEventRegistered) return;
            
            const store = getStore();
            if (store && store.events && typeof store.events.on === 'function') {
                store.events.on('updated', updateThinkingControls);
                storeEventRegistered = true;
                console.log('[GeminiChannel] Store event listener registered');
                // 注册成功后立即更新一次
                setTimeout(() => updateThinkingControls(), 0);
            } else {
                // Store 尚未就绪，延迟重试（最多重试 50 次，约 5 秒）
                if (!ensureStoreEventRegistered.retryCount) {
                    ensureStoreEventRegistered.retryCount = 0;
                }
                ensureStoreEventRegistered.retryCount++;
                if (ensureStoreEventRegistered.retryCount < 50) {
                    setTimeout(ensureStoreEventRegistered, 100);
                }
            }
        }
        
        /**
         * 确保 Framework 事件监听器已注册（备用）
         */
        function ensureFrameworkEventRegistered() {
            if (typeof Framework !== 'undefined' && Framework.events) {
                // 监听模式切换事件，确保在聊天模式下更新
                Framework.events.on('mode:changed', (data) => {
                    if (data && data.mode === 'chat') {
                        setTimeout(() => updateThinkingControls(), 50);
                    }
                });
            }
        }

        // 使用 registerUIBundle 注册 Gemini 渠道 UI 组件（纯 UI，无需 meta）
        registerBundle('core-gemini-channel-ui', {
            init: function() {
                // 尝试注册 store 更新事件监听器
                ensureStoreEventRegistered();
                // 注册 Framework 事件作为备用
                ensureFrameworkEventRegistered();
            },
            slots: {
                [SLOTS.INPUT_TOP]: {
                    id: 'thinking-budget',
                    render: function() {
                        // 每次渲染时也尝试注册事件（防止 init 时 store 未就绪）
                        ensureStoreEventRegistered();
                        
                        const wrapper = document.createElement('div');
                        wrapper.id = WRAPPER_ID;
                        wrapper.className = 'flex items-center gap-2';
                        wrapper.style.display = 'none'; // 初始隐藏，由 updateThinkingControls 控制

                        // 分隔线
                        const divider = document.createElement('div');
                        divider.className = 'h-5 w-px bg-gray-200';
                        wrapper.appendChild(divider);

                        // 思考控件组
                        const controlGroup = document.createElement('div');
                        controlGroup.className = 'flex items-center gap-1';

                        const label = document.createElement('span');
                        label.className = 'text-[10px] text-gray-400';
                        label.textContent = '思考';
                        controlGroup.appendChild(label);

                        // ===== Budget 模式的按钮（点击打开 BottomSheet）=====
                        const budgetBtn = document.createElement('button');
                        budgetBtn.type = 'button';
                        budgetBtn.className = 'px-2 py-0.5 text-[10px] rounded border border-gray-300 bg-white hover:border-blue-400 text-gray-700 font-medium transition-colors';
                        budgetBtn.setAttribute('data-gemini-budget-btn', 'true');
                        budgetBtn.textContent = '自动';
                        budgetBtn.style.display = 'none'; // 初始隐藏

                        budgetBtn.onclick = (e) => {
                            e.stopPropagation();
                            
                            const store = getStore();
                            if (!store || !store.getActiveConversation) return;
                            
                            const conv = store.getActiveConversation();
                            if (!conv) return;

                            const channelConfig = getChannelConfig(store, conv);
                            showBudgetBottomSheet(conv, channelConfig);
                        };
                        
                        controlGroup.appendChild(budgetBtn);

                        // ===== Level 模式的三按钮组（类似 GPT 的 L/M/H）=====
                        const levelGroup = document.createElement('div');
                        levelGroup.className = 'flex items-center gap-0.5';
                        levelGroup.setAttribute('data-gemini-level-group', 'true');
                        levelGroup.style.display = 'none'; // 初始隐藏

                        const createLevelBtn = (key, text, title) => {
                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'px-1.5 py-0.5 rounded text-[10px] border cursor-pointer transition-colors';
                            btn.textContent = text;
                            btn.title = title;
                            btn.onclick = () => {
                                const store = getStore();
                                if (!store || !store.getActiveConversation) return;
                                const conv = store.getActiveConversation();
                                if (!conv) return;

                                setThinkingLevel(store, conv.id, key);
                                updateThinkingControls();
                            };
                            return btn;
                        };

                        const noneBtn = createLevelBtn('none', 'N', '思考等级：无 (None) - 不使用思考');
                        const lowBtn = createLevelBtn('low', 'L', '思考等级：低 (Low)');
                        const highBtn = createLevelBtn('high', 'H', '思考等级：高 (High)');

                        levelGroup.appendChild(noneBtn);
                        levelGroup.appendChild(lowBtn);
                        levelGroup.appendChild(highBtn);

                        // 缓存按钮引用
                        levelState.buttons = {
                            none: noneBtn,
                            low: lowBtn,
                            high: highBtn
                        };

                        controlGroup.appendChild(levelGroup);
                        wrapper.appendChild(controlGroup);

                        // 延迟调用 updateThinkingControls，确保元素已添加到 DOM
                        setTimeout(() => updateThinkingControls(), 0);
                        setTimeout(() => updateThinkingControls(), 100);
                        setTimeout(() => updateThinkingControls(), 300);

                        return wrapper;
                    }
                }
            }
        });
    }
    
    // 自动注册 UI 插件
    registerThinkingBudgetPlugin();

    // ========== 通用设置分区注册 ==========
    
    /**
     * 注册 Gemini 思考规则设置分区到通用设置
     */
    function registerGeminiThinkingSettingsSection() {
        if (!window.IdoFront || !window.IdoFront.settingsManager ||
            typeof window.IdoFront.settingsManager.registerGeneralSection !== 'function') {
            return;
        }
        
        try {
            const sm = window.IdoFront.settingsManager;
            sm.registerGeneralSection({
                id: 'gemini-thinking',
                title: 'Gemini 思考功能',
                description: '配置 Gemini 模型的思考预算和思考等级匹配规则（正则表达式）',
                icon: 'psychology',
                order: 20,
                render: function(container) {
                    container.innerHTML = '';
                    
                    // 加载当前规则
                    const rules = loadGlobalThinkingRules();
                    
                    // Budget 模式规则输入框
                    const budgetGroup = document.createElement('div');
                    budgetGroup.className = 'ido-form-group';
                    
                    const budgetLabel = document.createElement('div');
                    budgetLabel.className = 'ido-form-label';
                    budgetLabel.textContent = '数值预算模式 (thinkingBudget)';
                    budgetGroup.appendChild(budgetLabel);
                    
                    const budgetHint = document.createElement('div');
                    budgetHint.className = 'text-[10px] text-gray-500 mb-1';
                    budgetHint.textContent = '匹配的模型将显示数值预算滑槽（适用于 Gemini 2.5 系列）';
                    budgetGroup.appendChild(budgetHint);
                    
                    const budgetInput = document.createElement('input');
                    budgetInput.type = 'text';
                    budgetInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors font-mono';
                    budgetInput.value = rules.budgetModelPattern;
                    budgetInput.placeholder = 'gemini-2\\.5|gemini-2-5';
                    
                    budgetInput.onchange = () => {
                        const currentRules = loadGlobalThinkingRules();
                        currentRules.budgetModelPattern = budgetInput.value || DEFAULT_THINKING_RULES.budgetModelPattern;
                        saveGlobalThinkingRules(currentRules);
                    };
                    
                    budgetGroup.appendChild(budgetInput);
                    container.appendChild(budgetGroup);
                    
                    // Level 模式规则输入框
                    const levelGroup = document.createElement('div');
                    levelGroup.className = 'ido-form-group mt-3';
                    
                    const levelLabel = document.createElement('div');
                    levelLabel.className = 'ido-form-label';
                    levelLabel.textContent = '等级选择模式 (thinkingLevel)';
                    levelGroup.appendChild(levelLabel);
                    
                    const levelHint = document.createElement('div');
                    levelHint.className = 'text-[10px] text-gray-500 mb-1';
                    levelHint.textContent = '匹配的模型将显示 Low/High 等级选择（适用于 Gemini 3 系列）';
                    levelGroup.appendChild(levelHint);
                    
                    const levelInput = document.createElement('input');
                    levelInput.type = 'text';
                    levelInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors font-mono';
                    levelInput.value = rules.levelModelPattern;
                    levelInput.placeholder = 'gemini-3';
                    
                    levelInput.onchange = () => {
                        const currentRules = loadGlobalThinkingRules();
                        currentRules.levelModelPattern = levelInput.value || DEFAULT_THINKING_RULES.levelModelPattern;
                        saveGlobalThinkingRules(currentRules);
                    };
                    
                    levelGroup.appendChild(levelInput);
                    container.appendChild(levelGroup);
                    
                    // 说明文字
                    const helpText = document.createElement('div');
                    helpText.className = 'text-[10px] text-gray-400 mt-3';
                    helpText.innerHTML = '提示：使用正则表达式匹配模型名称。例如 <code class="bg-gray-100 px-1 rounded">gemini-2\\.5</code> 匹配包含 "gemini-2.5" 的模型名。';
                    container.appendChild(helpText);
                }
            });
        } catch (e) {
            console.warn('[GeminiChannel] registerGeminiThinkingSettingsSection error:', e);
        }
    }
    
    // 尝试立即注册（兼容 settingsManager 已就绪的情况）
    registerGeminiThinkingSettingsSection();
    
    // 监听设置管理器就绪事件，确保在 settingsManager.init 之后也能完成注册
    if (typeof document !== 'undefined') {
        try {
            document.addEventListener('IdoFrontSettingsReady', function() {
                registerGeminiThinkingSettingsSection();
            });
        } catch (e) {
            console.warn('[GeminiChannel] attach IdoFrontSettingsReady listener error:', e);
        }
    }

    // 暴露工具函数供外部使用
    window.IdoFront.geminiChannel.useBudgetMode = useBudgetMode;
    window.IdoFront.geminiChannel.useLevelMode = useLevelMode;
    window.IdoFront.geminiChannel.supportsThinking = supportsThinking;
    window.IdoFront.geminiChannel.getThinkingConfig = getThinkingConfig;
    window.IdoFront.geminiChannel.getThinkingRules = getThinkingRules;
    window.IdoFront.geminiChannel.loadGlobalThinkingRules = loadGlobalThinkingRules;
    window.IdoFront.geminiChannel.saveGlobalThinkingRules = saveGlobalThinkingRules;
    window.IdoFront.geminiChannel.setThinkingBudget = setThinkingBudget;
    window.IdoFront.geminiChannel.setThinkingLevel = setThinkingLevel;
    window.IdoFront.geminiChannel.BUDGET_PRESETS = BUDGET_PRESETS;
    window.IdoFront.geminiChannel.LEVEL_OPTIONS = LEVEL_OPTIONS;
    window.IdoFront.geminiChannel.DEFAULT_THINKING_RULES = DEFAULT_THINKING_RULES;

})();