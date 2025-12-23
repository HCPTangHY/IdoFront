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
        { value: 1024, label: '最小', description: '1024 tokens' },
        { value: 4096, label: '低', description: '4096 tokens' },
        { value: 16384, label: '中', description: '16384 tokens' },
        { value: 32768, label: '高', description: '32768 tokens' }
    ];

    // thinkingLevel 选项（用于等级模式）- 四档：minimal/low/medium/high
    const LEVEL_OPTIONS = [
        { value: 'minimal', label: '最小', description: '基础响应，不进行额外思考', color: '#94a3b8', bars: 1 },
        { value: 'low', label: '低', description: '轻度思考，平衡速度与质量', color: '#60a5fa', bars: 2 },
        { value: 'medium', label: '中', description: '适中思考，处理复杂逻辑', color: '#3b82f6', bars: 3 },
        { value: 'high', label: '高', description: '深度思考，追求最佳结果', color: '#2563eb', bars: 4 }
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
        if (!conv) return { budget: -1, level: 'low' };
        const geminiMeta = conv.metadata?.gemini || {};
        return {
            budget: geminiMeta.thinkingBudget !== undefined ? geminiMeta.thinkingBudget : -1,
            level: geminiMeta.thinkingLevel || 'low'
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

    /**
     * 获取会话的 Gemini 代码执行配置
     * @param {Object} conv - 会话对象
     * @returns {boolean} 是否启用代码执行
     */
    function getCodeExecutionConfig(conv) {
        if (!conv) return false;
        const geminiMeta = conv.metadata?.gemini || {};
        return !!geminiMeta.codeExecution;
    }

    /**
     * 获取会话的 Gemini Google Search 配置
     * @param {Object} conv - 会话对象
     * @returns {boolean} 是否启用 Google Search
     */
    function getGoogleSearchConfig(conv) {
        if (!conv) return false;
        const geminiMeta = conv.metadata?.gemini || {};
        return !!geminiMeta.googleSearch;
    }

    /**
     * 设置会话的 Gemini Google Search 开关
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {boolean} enabled - 是否启用
     * @param {Object} [options] - 选项
     * @param {boolean} [options.silent=false] - 是否静默模式（不触发事件广播）
     */
    function setGoogleSearch(store, convId, enabled, options) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;
        
        if (!conv.metadata) conv.metadata = {};
        if (!conv.metadata.gemini) conv.metadata.gemini = {};
        conv.metadata.gemini.googleSearch = enabled;
        
        // 使用静默持久化避免触发全局 UI 更新
        if (options && options.silent) {
            if (typeof store.persistSilent === 'function') {
                store.persistSilent();
            }
        } else {
            if (typeof store.persist === 'function') {
                store.persist();
            }
        }
    }

    /**
     * 设置会话的 Gemini 代码执行开关
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {boolean} enabled - 是否启用
     */
    /**
     * 设置会话的 Gemini 代码执行开关
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {boolean} enabled - 是否启用
     * @param {Object} [options] - 选项
     * @param {boolean} [options.silent=false] - 是否静默模式（不触发事件广播）
     */
    function setCodeExecution(store, convId, enabled, options) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;
        
        if (!conv.metadata) conv.metadata = {};
        if (!conv.metadata.gemini) conv.metadata.gemini = {};
        conv.metadata.gemini.codeExecution = enabled;
        
        // 使用静默持久化避免触发全局 UI 更新
        if (options && options.silent) {
            if (typeof store.persistSilent === 'function') {
                store.persistSilent();
            }
        } else {
            if (typeof store.persist === 'function') {
                store.persist();
            }
        }
    }

    /**
     * 处理 Grounding Metadata，生成引用链接
     * @param {Object} groundingMetadata - Gemini API 返回的 grounding 元数据
     * @param {string} content - 原始内容
     * @returns {Object} 处理后的内容和引用信息
     */
    function processGroundingMetadata(groundingMetadata, content) {
        if (!groundingMetadata) {
            return { content, citations: null, searchQueries: null };
        }
        
        const chunks = groundingMetadata.groundingChunks || [];
        const supports = groundingMetadata.groundingSupports || [];
        const searchQueries = groundingMetadata.webSearchQueries || [];
        
        // 如果没有引用支持，直接返回原内容
        if (!supports.length || !chunks.length) {
            return { content, citations: null, searchQueries };
        }
        
        // 按 endIndex 降序排序，从后往前插入避免索引偏移
        const sortedSupports = [...supports].sort((a, b) => {
            const aEnd = a.segment?.endIndex ?? 0;
            const bEnd = b.segment?.endIndex ?? 0;
            return bEnd - aEnd;
        });
        
        let processedContent = content;
        const usedCitations = new Set();
        
        for (const support of sortedSupports) {
            const endIndex = support.segment?.endIndex;
            if (endIndex === undefined || !support.groundingChunkIndices?.length) {
                continue;
            }
            
            // 构建引用链接
            const citationLinks = support.groundingChunkIndices
                .map(i => {
                    if (i < chunks.length) {
                        const chunk = chunks[i];
                        const uri = chunk.web?.uri;
                        const title = chunk.web?.title || `来源 ${i + 1}`;
                        if (uri) {
                            usedCitations.add(i);
                            return `[${i + 1}](${uri} "${title}")`;
                        }
                    }
                    return null;
                })
                .filter(Boolean);
            
            if (citationLinks.length > 0) {
                const citationString = ' ' + citationLinks.join(' ');
                processedContent = processedContent.slice(0, endIndex) + citationString + processedContent.slice(endIndex);
            }
        }
        
        // 提取引用列表
        const citations = chunks
            .filter((_, i) => usedCitations.has(i))
            .map((chunk, i) => ({
                index: i + 1,
                uri: chunk.web?.uri,
                title: chunk.web?.title
            }));
        
        return {
            content: processedContent,
            citations: citations.length > 0 ? citations : null,
            searchQueries
        };
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
            // Handle executable code from code execution tool
            // Support both camelCase (JS SDK) and snake_case (REST API) formats
            const executableCode = part.executableCode || part.executable_code;
            if (executableCode) {
                const lang = (executableCode.language || 'PYTHON').toLowerCase();
                const code = executableCode.code || '';
                content += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
            }
            // Handle code execution result
            // Support both camelCase (JS SDK) and snake_case (REST API) formats
            const codeExecutionResult = part.codeExecutionResult || part.code_execution_result;
            if (codeExecutionResult) {
                const outcome = codeExecutionResult.outcome || '';
                const output = codeExecutionResult.output || '';
                if (outcome === 'OUTCOME_OK' || outcome === '' || outcome === 'OUTCOME_UNSPECIFIED') {
                    if (output && output.trim()) {
                        content += `\n**执行结果:**\n\`\`\`\n${output}\n\`\`\`\n`;
                    }
                } else {
                    content += `\n**执行错误 (${outcome}):**\n\`\`\`\n${output}\n\`\`\`\n`;
                }
            }
            // Handle inline data (images from code execution or other sources)
            // Support both camelCase (JS SDK) and snake_case (REST API) formats
            const inlineData = part.inlineData || part.inline_data;
            if (inlineData) {
                const mimeType = inlineData.mimeType || inlineData.mime_type;
                const data = inlineData.data;
                
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
                    
                    // 判断是否为代码执行生成的图表
                    const isCodeExecOutput = mimeType.startsWith('image/');
                    
                    attachments.push({
                        dataUrl: dataUrl,
                        type: mimeType,
                        name: isCodeExecOutput ? `图表 ${imageIndex++}` : `Gemini Image ${imageIndex++}`,
                        size: approximateSize,
                        source: 'gemini-code-execution'
                    });
                }
            }
            // 提取 thoughtSignature（per-part 级别，但对于简单文本对话通常只有一个）
            // Support both camelCase and snake_case
            const partThoughtSignature = part.thoughtSignature || part.thought_signature;
            if (partThoughtSignature) {
                thoughtSignature = partThoughtSignature;
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
                
                // 只有当 parts 非空时才添加到 contents
                // Gemini API 要求每个 content 对象必须包含至少一个 parts
                if (parts.length > 0) {
                    const geminiMsg = {
                        role: role,
                        parts: parts
                    };
                    
                    contents.push(geminiMsg);
                }
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
                // 等级模式：使用 thinkingLevel（四档：minimal/low/medium/high）
                const level = geminiMeta.thinkingLevel || 'low';
                thinkingConfig.thinkingLevel = level;
                // 始终启用思考摘要（思维链）
                thinkingConfig.includeThoughts = true;
            }

            // 将 thinkingConfig 合并到 generationConfig
            if (Object.keys(thinkingConfig).length > 0) {
                generationConfig.thinkingConfig = thinkingConfig;
            }
            
            if (Object.keys(generationConfig).length > 0) {
                body.generationConfig = generationConfig;
            }

            // Tools Config - 代码执行和 Google Search
            const tools = [];
            if (geminiMeta.codeExecution) {
                tools.push({ codeExecution: {} });
            }
            if (geminiMeta.googleSearch) {
                tools.push({ google_search: {} });
            }
            if (tools.length > 0) {
                body.tools = tools;
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
                    let streamUsageMetadata = null; // 流式响应中的 usage 信息
                    let lastGroundingMetadata = null; // 流式响应中的 grounding 信息

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
                                        
                                        // 提取 usageMetadata（Gemini API 的 usage 信息）
                                        if (json.usageMetadata) {
                                            streamUsageMetadata = json.usageMetadata;
                                        }
                                        
                                        // 提取 groundingMetadata
                                        if (candidate?.groundingMetadata) {
                                            lastGroundingMetadata = candidate.groundingMetadata;
                                        }
                                        
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
                    
                    // 处理 Grounding Metadata，添加引用
                    let citations = null;
                    let searchQueries = null;
                    if (lastGroundingMetadata) {
                        const groundingResult = processGroundingMetadata(lastGroundingMetadata, content);
                        content = groundingResult.content;
                        citations = groundingResult.citations;
                        searchQueries = groundingResult.searchQueries;
                    }
                    
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
                                        thoughtSignature: extractedSignature || lastThoughtSignature,
                                        citations: citations,
                                        searchQueries: searchQueries
                                    }
                                }
                            },
                            finish_reason: lastFinishReason
                        }]
                    };
                    
                    // 添加 usage 信息（转换为 OpenAI 格式）
                    if (streamUsageMetadata) {
                        result.usage = {
                            prompt_tokens: streamUsageMetadata.promptTokenCount || 0,
                            completion_tokens: streamUsageMetadata.candidatesTokenCount || 0,
                            total_tokens: streamUsageMetadata.totalTokenCount || 0
                        };
                    }
                    
                    return result;

                } else {
                    // Non-streaming response
                    const data = await response.json();
                    const candidate = data.candidates?.[0];
                    const parts = candidate?.content?.parts || [];
                    const thoughtSignature = candidate?.thoughtSignature;
                    const finishReason = candidate?.finishReason;
                    const usageMetadata = data.usageMetadata;
                    const groundingMetadata = candidate?.groundingMetadata;
                    let { content, reasoning, attachments, thoughtSignature: extractedSignature } = partsToContent(parts);
                    
                    // 处理 Grounding Metadata，添加引用
                    let citations = null;
                    let searchQueries = null;
                    if (groundingMetadata) {
                        const groundingResult = processGroundingMetadata(groundingMetadata, content);
                        content = groundingResult.content;
                        citations = groundingResult.citations;
                        searchQueries = groundingResult.searchQueries;
                    }
                    
                    // 处理非正常结束的情况，添加警告提示
                    const finishWarning = getFinishReasonWarning(finishReason);
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
                                        thoughtSignature: extractedSignature || thoughtSignature,
                                        citations: citations,
                                        searchQueries: searchQueries
                                    }
                                }
                            },
                            finish_reason: finishReason
                        }]
                    };
                    
                    // 添加 usage 信息
                    if (usageMetadata) {
                        result.usage = {
                            prompt_tokens: usageMetadata.promptTokenCount || 0,
                            completion_tokens: usageMetadata.candidatesTokenCount || 0,
                            total_tokens: usageMetadata.totalTokenCount || 0
                        };
                    }
                    
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
        /**
         * 显示统一的思考设置底部弹窗
         * 自动适配 Budget 模式 (Gemini 2.5) 和 Level 模式 (Gemini 3)
         */
        function showThinkingBottomSheet(conv, channelConfig) {
            const store = getStore();
            if (!store) return;
            
            const model = conv.selectedModel;
            const isBudgetMode = useBudgetMode(model, channelConfig);
            
            showBottomSheet((sheetContainer) => {
                // Header
                const header = document.createElement('div');
                header.className = 'px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white';
                
                const title = document.createElement('h3');
                title.className = 'text-lg font-semibold text-gray-800';
                title.textContent = isBudgetMode ? '思考预算设置' : '思考等级设置';
                
                const closeBtn = document.createElement('button');
                closeBtn.className = 'text-gray-400 hover:text-gray-600 transition-colors';
                closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                closeBtn.onclick = () => hideBottomSheet();
                
                header.appendChild(title);
                header.appendChild(closeBtn);
                
                // Body (可滚动区域)
                const body = document.createElement('div');
                body.className = 'flex-1 overflow-y-auto px-6 py-4 space-y-4';
                
                // Footer (固定在底部)
                const footer = document.createElement('div');
                footer.className = 'px-6 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0 hidden';
                
                const thinkingCfg = getThinkingConfig(conv);

                if (isBudgetMode) {
                    // ========== Budget 模式 UI ==========
                    let currentBudget = thinkingCfg.budget;
                    footer.classList.remove('hidden');
                    
                    // 1. 预设列表（采用卡片样式）
                    const budgetOptions = [
                        { value: 0, label: '关闭', description: '关闭思考功能', bars: 0, icon: 'block' },
                        { value: 1024, label: '最小', description: '1024 tokens - 基础思考', bars: 1 },
                        { value: 4096, label: '低', description: '4096 tokens - 轻度思考', bars: 2 },
                        { value: 16384, label: '中', description: '16384 tokens - 适中思考', bars: 3 },
                        { value: 32768, label: '高', description: '32768 tokens - 深度思考', bars: 4 },
                        { value: -1, label: '自动', description: '由模型动态决定思考深度', bars: 0, icon: 'magic_button' }
                    ];

                    budgetOptions.forEach(opt => {
                        const item = document.createElement('div');
                        const isActive = currentBudget === opt.value;
                        
                        item.className = `p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-4 mb-2 ${
                            isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200 bg-white'
                        }`;
                        
                        const visual = document.createElement('div');
                        visual.className = 'flex gap-0.5 items-end h-5 w-8 flex-shrink-0';
                        if (opt.icon) {
                            visual.innerHTML = `<span class="material-symbols-outlined text-gray-400 text-[20px]">${opt.icon}</span>`;
                        } else {
                            for(let i=1; i<=4; i++) {
                                const bar = document.createElement('div');
                                bar.className = 'w-1.5 rounded-t-sm transition-all';
                                bar.style.height = `${(i/4)*100}%`;
                                bar.style.backgroundColor = i <= opt.bars ? (isActive ? '#3b82f6' : '#cbd5e1') : '#f1f5f9';
                                visual.appendChild(bar);
                            }
                        }
                        
                        const info = document.createElement('div');
                        info.className = 'flex-1';
                        const label = document.createElement('div');
                        label.className = `text-sm font-bold ${isActive ? 'text-blue-700' : 'text-gray-700'}`;
                        label.textContent = opt.label;
                        const desc = document.createElement('div');
                        desc.className = 'text-[10px] text-gray-500';
                        desc.textContent = opt.description;
                        info.appendChild(label);
                        info.appendChild(desc);
                        
                        item.appendChild(visual);
                        item.appendChild(info);
                        if (isActive) {
                            const check = document.createElement('span');
                            check.className = 'material-symbols-outlined text-blue-500 text-[20px]';
                            check.textContent = 'check_circle';
                            item.appendChild(check);
                        }
                        
                        item.onclick = () => {
                            setThinkingBudget(store, conv.id, opt.value);
                            hideBottomSheet();
                            updateThinkingControls();
                        };
                        body.appendChild(item);
                    });

                    // 2. 自定义滑块 (移至 Footer)
                    footer.innerHTML = '<div class="text-xs font-medium text-gray-500 mb-3">自定义 Token 预算</div>';
                    
                    const slider = document.createElement('input');
                    slider.type = 'range';
                    slider.min = '0';
                    slider.max = '32768';
                    slider.step = '128';
                    slider.value = currentBudget > 0 ? currentBudget : 16384;
                    slider.className = 'w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600';
                    
                    const sliderVal = document.createElement('div');
                    sliderVal.className = 'text-center text-blue-600 font-mono font-bold mt-2';
                    sliderVal.textContent = currentBudget > 0 ? currentBudget : '---';

                    slider.oninput = () => {
                        sliderVal.textContent = slider.value;
                    };
                    slider.onchange = () => {
                        setThinkingBudget(store, conv.id, parseInt(slider.value));
                        updateThinkingControls();
                    };

                    footer.appendChild(slider);
                    footer.appendChild(sliderVal);

                } else {
                    // ========== Level 模式 UI ==========
                    LEVEL_OPTIONS.forEach(opt => {
                        const item = document.createElement('div');
                        const isActive = opt.value === thinkingCfg.level;
                        
                        item.className = `p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-4 ${
                            isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200 bg-white'
                        }`;
                        
                        const visual = document.createElement('div');
                        visual.className = 'flex gap-0.5 items-end h-6 w-8 flex-shrink-0';
                        for(let i=1; i<=4; i++) {
                            const bar = document.createElement('div');
                            bar.className = 'w-1.5 rounded-t-sm transition-all';
                            bar.style.height = `${(i/4)*100}%`;
                            bar.style.backgroundColor = i <= opt.bars ? (isActive ? '#3b82f6' : '#cbd5e1') : '#f1f5f9';
                            visual.appendChild(bar);
                        }
                        
                        const info = document.createElement('div');
                        info.className = 'flex-1';
                        const label = document.createElement('div');
                        label.className = `font-bold ${isActive ? 'text-blue-700' : 'text-gray-700'}`;
                        label.textContent = opt.label;
                        const desc = document.createElement('div');
                        desc.className = 'text-xs text-gray-500 mt-0.5';
                        desc.textContent = opt.description;
                        info.appendChild(label);
                        info.appendChild(desc);
                        
                        item.appendChild(visual);
                        item.appendChild(info);
                        if (isActive) {
                            const check = document.createElement('span');
                            check.className = 'material-symbols-outlined text-blue-500';
                            check.textContent = 'check_circle';
                            item.appendChild(check);
                        }
                        
                        item.onclick = () => {
                            setThinkingLevel(store, conv.id, opt.value);
                            hideBottomSheet();
                            updateThinkingControls();
                        };
                        body.appendChild(item);
                    });
                }
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
                sheetContainer.appendChild(footer);
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
        /**
         * 显示工具设置底部弹窗 (Tools)
         */
        function showToolsBottomSheet(conv) {
            const store = getStore();
            if (!store) return;
            
            showBottomSheet((sheetContainer) => {
                // Header
                const header = document.createElement('div');
                header.className = 'px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white';
                
                const title = document.createElement('h3');
                title.className = 'text-lg font-semibold text-gray-800';
                title.textContent = '工具设置';
                
                const closeBtn = document.createElement('button');
                closeBtn.className = 'text-gray-400 hover:text-gray-600 transition-colors';
                closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                closeBtn.onclick = () => hideBottomSheet();
                
                header.appendChild(title);
                header.appendChild(closeBtn);
                
                // Body
                const body = document.createElement('div');
                body.className = 'flex-1 overflow-y-auto px-6 py-4 space-y-6';
                
                // 代码执行开关
                const codeExecItem = document.createElement('div');
                codeExecItem.className = 'flex items-center justify-between p-4 rounded-xl bg-gray-50 border border-gray-100';
                
                const info = document.createElement('div');
                info.className = 'flex-1 pr-4';
                const label = document.createElement('div');
                label.className = 'font-bold text-gray-800';
                label.textContent = '代码执行 (Code Execution)';
                const desc = document.createElement('div');
                desc.className = 'text-xs text-gray-500 mt-1';
                desc.textContent = '允许模型生成并运行 Python 代码以解决复杂问题。';
                info.appendChild(label);
                info.appendChild(desc);
                
                const isEnabled = getCodeExecutionConfig(conv);
                
                // 使用 DeclarativeComponents 的开关样式
                const switchLabel = document.createElement('label');
                switchLabel.className = 'ido-form-switch';
                const switchInput = document.createElement('input');
                switchInput.type = 'checkbox';
                switchInput.className = 'ido-form-switch__input';
                switchInput.checked = isEnabled;
                const slider = document.createElement('div');
                slider.className = 'ido-form-switch__slider';
                
                switchInput.onchange = () => {
                    setCodeExecution(store, conv.id, switchInput.checked);
                    updateThinkingControls();
                };
                
                switchLabel.appendChild(switchInput);
                switchLabel.appendChild(slider);
                
                codeExecItem.appendChild(info);
                codeExecItem.appendChild(switchLabel);
                
                body.appendChild(codeExecItem);
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
            });
        }

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
            
            // 检查模型是否支持思考功能或代码执行
            const hasThinking = supportsThinking(model, channelConfig);
            const hasTools = true; // Gemini 渠道通常都支持 tools
            
            if (!hasThinking && !hasTools) {
                wrapper.style.display = 'none';
                return;
            }

            // 显示控件
            wrapper.style.display = 'flex';

            const thinkingCfg = getThinkingConfig(conv);
            
            // 获取容器内的元素
            const budgetBtnEl = wrapper.querySelector('[data-gemini-budget-btn]');
            const levelGroupEl = wrapper.querySelector('[data-gemini-level-group]');

            // 更新思考控件
            if (!hasThinking) {
                if (budgetBtnEl) budgetBtnEl.style.display = 'none';
                if (levelGroupEl) levelGroupEl.style.display = 'none';
            } else {
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
                // Level 模式：显示单个按钮，点击打开 BottomSheet
                if (budgetBtnEl) {
                    budgetBtnEl.style.display = 'inline-flex';
                    const level = thinkingCfg.level;
                    const opt = LEVEL_OPTIONS.find(o => o.value === level) || LEVEL_OPTIONS[1];
                    budgetBtnEl.textContent = opt.label;
                }
                if (levelGroupEl) {
                    levelGroupEl.style.display = 'none';
                }
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

        /**
         * 渲染思考控件
         * 抽取为独立函数，使用与 OpenAI 渠道相同的数组格式注册
         */
        function renderThinkingBudget() {
            // 每次渲染时也尝试注册事件（防止 init 时 store 未就绪）
            ensureStoreEventRegistered();
            
            const wrapper = document.createElement('div');
            wrapper.id = WRAPPER_ID;
            wrapper.className = 'flex items-center gap-2';
            wrapper.style.display = 'none'; // 初始隐藏，由 updateThinkingControls 控制
            wrapper.style.order = '1'; // 核心渠道参数，排在左侧

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
                showThinkingBottomSheet(conv, channelConfig);
            };
            
            controlGroup.appendChild(budgetBtn);

            // ===== Level 模式的四按钮组（minimal/low/medium/high）=====
            const levelGroup = document.createElement('div');
            levelGroup.className = 'flex items-center gap-px bg-gray-100 rounded p-px';
            levelGroup.setAttribute('data-gemini-level-group', 'true');
            levelGroup.style.display = 'none'; // 初始隐藏

            const createLevelBtn = (opt) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'px-1.5 py-0.5 rounded text-[10px] border cursor-pointer transition-colors font-medium';
                btn.textContent = opt.label;
                btn.title = `思考等级：${opt.description}`;
                btn.onclick = () => {
                    const store = getStore();
                    if (!store || !store.getActiveConversation) return;
                    const conv = store.getActiveConversation();
                    if (!conv) return;

                    setThinkingLevel(store, conv.id, opt.value);
                    updateThinkingControls();
                };
                return btn;
            };

            // 根据 LEVEL_OPTIONS 动态创建按钮
            const buttonRefs = {};
            LEVEL_OPTIONS.forEach(opt => {
                const btn = createLevelBtn(opt);
                buttonRefs[opt.value] = btn;
                levelGroup.appendChild(btn);
            });

            // 缓存按钮引用
            levelState.buttons = buttonRefs;

            controlGroup.appendChild(levelGroup);
            wrapper.appendChild(controlGroup);

            // 延迟调用 updateThinkingControls，确保元素已添加到 DOM
            setTimeout(() => updateThinkingControls(), 0);
            setTimeout(() => updateThinkingControls(), 100);
            setTimeout(() => updateThinkingControls(), 300);

            return wrapper;
        }

        // 使用 registerUIBundle 注册 Gemini 渠道 UI 组件
        // 注意：id 必须唯一，避免与 Claude 渠道的 thinking-budget 冲突
        try {
            registerBundle('core-gemini-channel-ui', {
                slots: {
                    [SLOTS.INPUT_TOP]: [
                        { id: 'gemini-thinking-budget', render: renderThinkingBudget }
                    ]
                },
                init: function() {
                    // 尝试注册 store 更新事件监听器
                    ensureStoreEventRegistered();
                    // 注册 Framework 事件作为备用
                    ensureFrameworkEventRegistered();
                }
            });
        } catch (e) {
            console.error('[GeminiChannel] registerBundle failed:', e);
        }
    }
    
    /**
     * 注册 Gemini Tools 到工具按钮插槽
     * 使用 shouldShow 来判断是否在 Gemini 渠道下显示
     * 使用 getState/setState 模式，直接在工具面板中显示开关
     *
     * 注意：inputTools API 使用队列机制，即使在 API 完全就绪前调用 register 也是安全的
     */
    function registerGeminiInputTools() {
        // 代码执行工具
        window.IdoFront.inputTools.register({
            id: 'gemini-code-execution',
            icon: 'code',
            label: '代码执行',
            description: '允许模型执行 Python 代码',
            shouldShow: (ctx) => {
                // 仅在 Gemini 渠道时显示
                if (!ctx.activeChannel) return false;
                return ctx.activeChannel.type === 'gemini';
            },
            getState: () => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return false;
                const conv = store.getActiveConversation();
                return getCodeExecutionConfig(conv);
            },
            setState: (enabled) => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return;
                const conv = store.getActiveConversation();
                if (!conv) return;
                // 使用静默模式，避免触发全局 UI 更新导致卡顿
                setCodeExecution(store, conv.id, enabled, { silent: true });
            }
        });
        
        // Google Search 工具
        window.IdoFront.inputTools.register({
            id: 'gemini-google-search',
            icon: 'travel_explore',
            label: 'Google 搜索',
            description: '使用 Google 搜索增强回答的准确性',
            shouldShow: (ctx) => {
                // 仅在 Gemini 渠道时显示
                if (!ctx.activeChannel) return false;
                return ctx.activeChannel.type === 'gemini';
            },
            getState: () => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return false;
                const conv = store.getActiveConversation();
                return getGoogleSearchConfig(conv);
            },
            setState: (enabled) => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return;
                const conv = store.getActiveConversation();
                if (!conv) return;
                // 使用静默模式，避免触发全局 UI 更新导致卡顿
                setGoogleSearch(store, conv.id, enabled, { silent: true });
            }
        });
    }
    
    /**
     * 通过 Framework API 显示工具设置底部弹窗
     */
    function showToolsBottomSheetViaFramework(conv) {
        const store = getStore();
        if (!store) return;
        
        Framework.showBottomSheet((sheetContainer) => {
            // Header
            const header = document.createElement('div');
            header.className = 'px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white';
            
            const title = document.createElement('h3');
            title.className = 'text-lg font-semibold text-gray-800';
            title.textContent = 'Gemini 工具设置';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'text-gray-400 hover:text-gray-600 transition-colors';
            closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
            closeBtn.onclick = () => Framework.hideBottomSheet();
            
            header.appendChild(title);
            header.appendChild(closeBtn);
            
            // Body
            const body = document.createElement('div');
            body.className = 'flex-1 overflow-y-auto px-6 py-4 space-y-6';
            
            // 代码执行开关
            const codeExecItem = document.createElement('div');
            codeExecItem.className = 'flex items-center justify-between p-4 rounded-xl bg-gray-50 border border-gray-100';
            
            const info = document.createElement('div');
            info.className = 'flex-1 pr-4';
            const label = document.createElement('div');
            label.className = 'font-bold text-gray-800';
            label.textContent = '代码执行 (Code Execution)';
            const desc = document.createElement('div');
            desc.className = 'text-xs text-gray-500 mt-1';
            desc.textContent = '允许模型生成并运行 Python 代码以解决复杂问题，如数据分析、数学计算、图表绘制等。';
            info.appendChild(label);
            info.appendChild(desc);
            
            const isEnabled = getCodeExecutionConfig(conv);
            
            // 使用 DeclarativeComponents 的开关样式
            const switchLabel = document.createElement('label');
            switchLabel.className = 'ido-form-switch';
            const switchInput = document.createElement('input');
            switchInput.type = 'checkbox';
            switchInput.className = 'ido-form-switch__input';
            switchInput.checked = isEnabled;
            const slider = document.createElement('div');
            slider.className = 'ido-form-switch__slider';
            
            switchInput.onchange = () => {
                setCodeExecution(store, conv.id, switchInput.checked);
                // 刷新工具按钮状态
                if (window.IdoFront.inputTools && window.IdoFront.inputTools.refresh) {
                    window.IdoFront.inputTools.refresh();
                }
            };
            
            switchLabel.appendChild(switchInput);
            switchLabel.appendChild(slider);
            
            codeExecItem.appendChild(info);
            codeExecItem.appendChild(switchLabel);
            
            body.appendChild(codeExecItem);
            
            sheetContainer.appendChild(header);
            sheetContainer.appendChild(body);
        });
    }

    // 自动注册 UI 插件
    registerThinkingBudgetPlugin();
    
    // 注册 Gemini 工具（使用队列机制，无需延迟）
    registerGeminiInputTools();

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
    window.IdoFront.geminiChannel.getCodeExecutionConfig = getCodeExecutionConfig;
    window.IdoFront.geminiChannel.setCodeExecution = setCodeExecution;
    window.IdoFront.geminiChannel.getGoogleSearchConfig = getGoogleSearchConfig;
    window.IdoFront.geminiChannel.setGoogleSearch = setGoogleSearch;
    window.IdoFront.geminiChannel.processGroundingMetadata = processGroundingMetadata;
    window.IdoFront.geminiChannel.BUDGET_PRESETS = BUDGET_PRESETS;
    window.IdoFront.geminiChannel.LEVEL_OPTIONS = LEVEL_OPTIONS;
    window.IdoFront.geminiChannel.DEFAULT_THINKING_RULES = DEFAULT_THINKING_RULES;

})();