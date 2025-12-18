/**
 * OpenAI Channel Adapter
 * Handles communication with OpenAI-compatible APIs
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channels = window.IdoFront.channels || {};
    window.IdoFront.openaiChannel = window.IdoFront.openaiChannel || {};

    const registry = window.IdoFront.channelRegistry;
    const CHANNEL_ID = 'openai';
    
    // ========== OpenAI Reasoning Effort Configuration ==========
    
    // 存储键
    const REASONING_RULES_STORAGE_KEY = 'ido.openai.reasoningRules';
    
    // 默认思考规则配置（正则表达式字符串）
    const DEFAULT_REASONING_RULES = {
        // 使用 reasoning_effort 的模型匹配规则
        modelPattern: 'gpt-5|o1|o3'
    };
    
    // 全局规则缓存
    let cachedGlobalRules = null;
    
    // reasoning_effort 选项
    const EFFORT_OPTIONS = [
        { value: 'low', label: 'L', description: '思考预算：低 (low)' },
        { value: 'medium', label: 'M', description: '思考预算：中 (medium)' },
        { value: 'high', label: 'H', description: '思考预算：高 (high)' }
    ];
    
    // ========== Gemini 模型适配（通过 OpenAI 兼容接口调用 Gemini）==========
    
    /**
     * 获取 Gemini 渠道的思考规则
     * @returns {Object|null} Gemini 思考规则，若 Gemini 渠道未加载则返回 null
     */
    function getGeminiThinkingRules() {
        if (window.IdoFront && window.IdoFront.geminiChannel &&
            typeof window.IdoFront.geminiChannel.loadGlobalThinkingRules === 'function') {
            return window.IdoFront.geminiChannel.loadGlobalThinkingRules();
        }
        return null;
    }
    
    /**
     * 检查模型是否匹配 Gemini Budget 模式
     * @param {string} modelName - 模型名称
     * @returns {boolean}
     */
    function isGeminiBudgetModel(modelName) {
        if (!modelName) return false;
        const rules = getGeminiThinkingRules();
        if (!rules || !rules.budgetModelPattern) return false;
        try {
            const regex = new RegExp(rules.budgetModelPattern, 'i');
            return regex.test(modelName);
        } catch (e) {
            return false;
        }
    }
    
    /**
     * 检查模型是否匹配 Gemini Level 模式
     * @param {string} modelName - 模型名称
     * @returns {boolean}
     */
    function isGeminiLevelModel(modelName) {
        if (!modelName) return false;
        const rules = getGeminiThinkingRules();
        if (!rules || !rules.levelModelPattern) return false;
        try {
            const regex = new RegExp(rules.levelModelPattern, 'i');
            return regex.test(modelName);
        } catch (e) {
            return false;
        }
    }
    
    /**
     * 检查模型是否是 Gemini 思考模型
     * @param {string} modelName - 模型名称
     * @returns {boolean}
     */
    function isGeminiThinkingModel(modelName) {
        return isGeminiBudgetModel(modelName) || isGeminiLevelModel(modelName);
    }
    
    /**
     * 获取当前会话的 Gemini 思考配置
     * @returns {Object} 思考配置 { budget, level }
     */
    function getGeminiThinkingConfig() {
        if (window.IdoFront && window.IdoFront.geminiChannel &&
            typeof window.IdoFront.geminiChannel.getThinkingConfig === 'function') {
            const store = window.IdoFront && window.IdoFront.store;
            if (store && typeof store.getActiveConversation === 'function') {
                const conv = store.getActiveConversation();
                return window.IdoFront.geminiChannel.getThinkingConfig(conv);
            }
        }
        return { budget: -1, level: 'none' };
    }
    
    /**
     * 从 Framework.storage 加载全局规则
     * @returns {Object} 全局规则
     */
    function loadGlobalReasoningRules() {
        if (cachedGlobalRules) return cachedGlobalRules;
        
        try {
            if (typeof Framework !== 'undefined' && Framework.storage) {
                const saved = Framework.storage.getItem(REASONING_RULES_STORAGE_KEY);
                if (saved && typeof saved === 'object') {
                    cachedGlobalRules = {
                        modelPattern: saved.modelPattern || DEFAULT_REASONING_RULES.modelPattern
                    };
                    return cachedGlobalRules;
                }
            }
        } catch (e) {
            console.warn('[OpenAIChannel] Failed to load global reasoning rules:', e);
        }
        
        return { ...DEFAULT_REASONING_RULES };
    }
    
    /**
     * 保存全局规则到 Framework.storage
     * @param {Object} rules - 规则
     */
    function saveGlobalReasoningRules(rules) {
        try {
            if (typeof Framework !== 'undefined' && Framework.storage) {
                Framework.storage.setItem(REASONING_RULES_STORAGE_KEY, rules);
                cachedGlobalRules = { ...rules };
            }
        } catch (e) {
            console.warn('[OpenAIChannel] Failed to save global reasoning rules:', e);
        }
    }
    
    /**
     * 判断模型是否支持 reasoning_effort
     * @param {string} modelName - 模型名称
     * @returns {boolean}
     */
    function supportsReasoningEffort(modelName) {
        if (!modelName) return false;
        const rules = loadGlobalReasoningRules();
        if (!rules.modelPattern) return false;
        try {
            const regex = new RegExp(rules.modelPattern, 'i');
            return regex.test(modelName);
        } catch (e) {
            console.warn('[OpenAIChannel] Invalid reasoning model pattern:', rules.modelPattern, e);
            return false;
        }
    }
    
    /**
     * 获取会话的 reasoning effort
     * @param {Object} conv - 会话对象
     * @returns {string} 思考等级 (low/medium/high)
     */
    function getReasoningEffort(conv) {
        if (!conv) return 'medium';
        let effort = conv.reasoningEffort || 'medium';
        if (typeof effort === 'string') {
            effort = effort.toLowerCase();
        }
        if (effort !== 'low' && effort !== 'medium' && effort !== 'high') {
            effort = 'medium';
        }
        return effort;
    }
    
    /**
     * 设置会话的 reasoning effort
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {string} effort - 思考等级
     */
    function setReasoningEffort(store, convId, effort) {
        if (!store || !convId) return;
        
        if (typeof store.setConversationReasoningEffort === 'function') {
            store.setConversationReasoningEffort(convId, effort);
        } else {
            const conv = store.state.conversations.find(c => c.id === convId);
            if (!conv) return;
            conv.reasoningEffort = effort;
            if (typeof store.persist === 'function') {
                store.persist();
            }
        }
    }

    const adapter = {
        /**
         * Send message to OpenAI API
         * @param {Array} messages - Chat history
         * @param {Object} config - Channel configuration (apiKey, baseUrl, model, etc.)
         * @param {Function} onUpdate - Optional callback for streaming updates
         * @param {AbortSignal} signal - Optional abort signal for cancellation
         * @returns {Promise<Object>} - Response content
         */
        async call(messages = [], config = {}, onUpdate, signal) {
            let baseUrl = config.baseUrl;
            if (!baseUrl || !baseUrl.trim()) {
                baseUrl = 'https://api.openai.com/v1';
            }
            // Normalize URL: remove trailing slash
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            // Append /chat/completions if not present
            // Assuming Base URL is the root API path (e.g. https://api.openai.com/v1)
            const endpoint = `${baseUrl}/chat/completions`;
            
            // Use the model passed in config, or fallback to default
            const model = config.model;

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            };

            // 应用自定义请求头
            if (config.customHeaders && Array.isArray(config.customHeaders)) {
                config.customHeaders.forEach(header => {
                    if (header.key && header.value) {
                        headers[header.key] = header.value;
                    }
                });
            }

            // 转换消息格式以支持图片
            const formattedMessages = messages.map(msg => {
                // 如果消息有附件，转换为 OpenAI Vision 格式
                if (msg.metadata?.attachments && msg.metadata.attachments.length > 0) {
                    const content = [];
                    
                    // 添加文本内容
                    if (msg.content) {
                        content.push({
                            type: 'text',
                            text: msg.content
                        });
                    }
                    
                    // 添加图片
                    for (const attachment of msg.metadata.attachments) {
                        if (attachment.type && attachment.type.startsWith('image/')) {
                            content.push({
                                type: 'image_url',
                                image_url: {
                                    url: attachment.dataUrl
                                }
                            });
                        }
                    }
                    
                    return {
                        role: msg.role,
                        content: content
                    };
                } else {
                    // 普通消息
                    return {
                        role: msg.role,
                        content: msg.content
                    };
                }
            });

            const body = {
                model: model,
                messages: formattedMessages,
                stream: !!onUpdate
            };
            
            // 添加 reasoning_effort 参数
            // message.js 会将 conv.reasoningEffort 放入 config.paramsOverride.reasoning_effort
            if (supportsReasoningEffort(model)) {
                const effort = config.paramsOverride?.reasoning_effort || 'medium';
                // 同时传递两种格式以兼容不同 API 实现
                body.reasoning_effort = effort;              // 平级格式
                body.reasoning = { effort: effort };         // 嵌套格式
            }
            
            // ========== Gemini 模型思考配置适配 ==========
            // 通过 OpenAI 兼容接口调用 Gemini 时，使用 extra_body.google.thinking_config 传递原生参数
            // 这比简单的 reasoning_effort 映射更灵活，保持与 Gemini 渠道相同的精细控制能力
            if (isGeminiThinkingModel(model)) {
                const thinkingCfg = getGeminiThinkingConfig();
                const thinkingConfig = {};
                
                if (isGeminiBudgetModel(model)) {
                    // Budget 模式 (Gemini 2.5 系列)：使用 thinking_budget 数值
                    const budget = thinkingCfg.budget;
                    if (budget !== -1) {
                        // -1 表示动态思考，不设置 thinking_budget 让 Gemini 自动决定
                        thinkingConfig.thinking_budget = budget;
                    }
                    // 启用思考摘要
                    thinkingConfig.include_thoughts = true;
                } else if (isGeminiLevelModel(model)) {
                    // Level 模式 (Gemini 3 系列)：使用 thinking_level
                    const level = thinkingCfg.level;
                    thinkingConfig.thinking_level = level;
                    // 始终启用思考摘要（思维链）
                    thinkingConfig.include_thoughts = true;
                }
                
                // 如果有配置，添加到 extra_body.google
                if (Object.keys(thinkingConfig).length > 0) {
                    if (!body.extra_body) {
                        body.extra_body = {};
                    }
                    body.extra_body.google = {
                        thinking_config: thinkingConfig
                    };
                }
            }

            // 应用参数覆写 - 使用深度合并，避免覆盖嵌套对象
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                window.IdoFront.utils.deepMerge(body, config.paramsOverride);
            }

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body),
                    signal: signal // 传递取消信号
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMsg = `API Error ${response.status}`;
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

                // Check for SSE content type
                const contentType = response.headers.get('content-type') || '';
                const isStream = contentType.includes('text/event-stream') && onUpdate;

                if (isStream) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let fullContent = '';
                    let fullReasoning = '';
                    let buffer = '';
                    let streamUsage = null; // 流式响应中的 usage 信息

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop(); // Keep the last incomplete line

                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed || trimmed === 'data: [DONE]') continue;
                                if (trimmed.startsWith('data: ')) {
                                    try {
                                        const json = JSON.parse(trimmed.substring(6));
                                        const delta = json.choices?.[0]?.delta;
                                        
                                        // 提取流式响应中的 usage 信息（通常在最后一个 chunk 中）
                                        if (json.usage) {
                                            streamUsage = json.usage;
                                        }
                                        
                                        if (delta) {
                                            let updated = false;
                                            if (delta.content) {
                                                fullContent += delta.content;
                                                updated = true;
                                            }
                                            if (delta.reasoning_content) {
                                                fullReasoning += delta.reasoning_content;
                                                updated = true;
                                            }
                                            
                                            if (updated) {
                                                onUpdate({
                                                    content: fullContent,
                                                    reasoning: fullReasoning
                                                });
                                            }
                                        }
                                    } catch (e) {
                                        console.warn('Error parsing stream data:', e);
                                    }
                                }
                            }
                        }

                        // Process remaining buffer
                        if (buffer && buffer.trim()) {
                            const trimmed = buffer.trim();
                            if (trimmed !== 'data: [DONE]' && trimmed.startsWith('data: ')) {
                                try {
                                    const json = JSON.parse(trimmed.substring(6));
                                    const delta = json.choices?.[0]?.delta;
                                    
                                    // 提取 usage 信息
                                    if (json.usage) {
                                        streamUsage = json.usage;
                                    }
                                    
                                    if (delta) {
                                        let updated = false;
                                        if (delta.content) {
                                            fullContent += delta.content;
                                            updated = true;
                                        }
                                        if (delta.reasoning_content) {
                                            fullReasoning += delta.reasoning_content;
                                            updated = true;
                                        }
                                        
                                        if (updated) {
                                            onUpdate({
                                                content: fullContent,
                                                reasoning: fullReasoning
                                            });
                                        }
                                    }
                                } catch (e) {
                                    console.warn('Error parsing final stream buffer:', e);
                                }
                            }
                        }
                    } catch (streamError) {
                        console.error('Stream reading error:', streamError);
                        throw streamError;
                    }

                    const result = {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: fullContent
                            }
                        }]
                    };
                    
                    // 添加 usage 信息到响应
                    if (streamUsage) {
                        result.usage = streamUsage;
                    }
                    
                    return result;
                } else {
                    // Fallback for non-streaming or non-SSE responses (even if streaming was requested)
                    const data = await response.json();
                    
                    // If streaming was requested but we got a full JSON response,
                    // we should still trigger the onUpdate callback with the full content
                    // so that the UI updates correctly (since message.js expects callbacks for stream:true)
                    if (onUpdate && data.choices && data.choices[0] && data.choices[0].message) {
                        const message = data.choices[0].message;
                        const content = message.content || '';
                        const reasoning = message.reasoning_content || null;
                        
                        onUpdate({
                            content: content,
                            reasoning: reasoning
                        });
                    }
                    
                    // 非流式响应通常已包含 usage，直接返回
                    return data;
                }
            } catch (error) {
                console.error('OpenAI Channel Error:', error);
                throw error;
            }
        },

        /**
         * Fetch available models from OpenAI API
         * @param {Object} config - Channel configuration (apiKey, baseUrl)
         * @returns {Promise<Array>} - List of model IDs
         */
        async fetchModels(config) {
            let baseUrl = config.baseUrl;
            if (!baseUrl || !baseUrl.trim()) {
                baseUrl = 'https://api.openai.com/v1';
            }
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            const endpoint = `${baseUrl}/models`;

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            };

            try {
                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: headers
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`获取模型失败 ${response.status}: ${errorText}`);
                }

                const data = await response.json();
                // Extract model IDs from response
                if (data.data && Array.isArray(data.data)) {
                    return data.data.map(m => m.id).sort();
                }
                return [];
            } catch (error) {
                console.error('Fetch Models Error:', error);
                throw error;
            }
        }
    };

    // Register with channelRegistry
    if (registry) {
        registry.registerType(CHANNEL_ID, {
            adapter: adapter,
            label: 'OpenAI Compatible',
            source: 'core',
            version: '1.0.0',
            defaults: {
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o-mini'
            },
            capabilities: {
                streaming: true,
                vision: true
            },
            metadata: {
                provider: 'openai',
                docs: 'https://platform.openai.com/docs/api-reference/chat'
            },
            icon: 'science'
        });
    } else {
        // Fallback for older versions or if registry is not available
        window.IdoFront.channels[CHANNEL_ID] = adapter;
    }
    
    // ========== OpenAI Reasoning Effort UI Components ==========
    
    /**
     * 获取 Store 实例
     */
    function getStore() {
        return window.IdoFront && window.IdoFront.store ? window.IdoFront.store : null;
    }
    
    /**
     * 获取当前渠道配置
     */
    function getChannelConfig(store, conv) {
        if (!store || !conv || !conv.selectedChannelId) return null;
        return store.state.channels.find(c => c.id === conv.selectedChannelId) || null;
    }
    
    /**
     * 注册 OpenAI 渠道 UI 插件
     * 使用 registerPluginBundle 统一注册所有 OpenAI 渠道相关的 UI 组件
     */
    function registerOpenAIChannelPlugins() {
        if (typeof Framework === 'undefined' || !Framework) {
            console.warn('[OpenAIChannel] Framework API not available for UI registration');
            return;
        }

        // 优先使用 registerUIBundle（纯 UI 组件），降级到 registerPluginBundle
        const registerBundle = Framework.registerUIBundle || Framework.registerPluginBundle;
        if (!registerBundle) {
            console.warn('[OpenAIChannel] No bundle registration API available');
            return;
        }

        const { SLOTS, showBottomSheet, hideBottomSheet } = Framework;
        
        if (!SLOTS || !SLOTS.INPUT_TOP) {
            console.warn('[OpenAIChannel] INPUT_TOP slot not available');
            return;
        }
        
        // ===== 共享状态 =====
        const REASONING_WRAPPER_ID = 'openai-reasoning-effort-wrapper';
        const GEMINI_WRAPPER_ID = 'openai-gemini-thinking-wrapper';
        
        let storeEventRegistered = false;
        
        // 缓存按钮引用
        const effortState = { buttons: {} };
        const levelState = { buttons: {} };
        
        // ===== OpenAI Reasoning Effort 相关函数 =====
        
        function updateReasoningControls() {
            const wrapper = document.getElementById(REASONING_WRAPPER_ID);
            if (!wrapper) return;
            
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
            
            const model = conv.selectedModel;
            if (!model) {
                wrapper.style.display = 'none';
                return;
            }
            
            const channelConfig = getChannelConfig(store, conv);
            if (!channelConfig || channelConfig.type !== 'openai') {
                wrapper.style.display = 'none';
                return;
            }
            
            if (!supportsReasoningEffort(model)) {
                wrapper.style.display = 'none';
                return;
            }
            
            wrapper.style.display = 'flex';
            
            const currentEffort = getReasoningEffort(conv);
            ['low', 'medium', 'high'].forEach(key => {
                const btn = effortState.buttons[key];
                if (!btn) return;
                btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                btn.classList.remove('bg-gray-50', 'text-gray-500', 'border-gray-200');
                if (key === currentEffort) {
                    btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
                } else {
                    btn.classList.add('bg-gray-50', 'text-gray-500', 'border-gray-200');
                }
            });
        }
        
        function renderReasoningEffort() {
            const wrapper = document.createElement('div');
            wrapper.id = REASONING_WRAPPER_ID;
            wrapper.className = 'flex items-center gap-2';
            wrapper.style.display = 'none';
            wrapper.style.order = '1'; // 核心渠道参数，排在左侧
            
            const divider = document.createElement('div');
            divider.className = 'h-5 w-px bg-gray-200';
            wrapper.appendChild(divider);
            
            const controlGroup = document.createElement('div');
            controlGroup.className = 'flex items-center gap-1';
            
            const label = document.createElement('span');
            label.className = 'text-[10px] text-gray-400';
            label.textContent = '思考';
            controlGroup.appendChild(label);
            
            const createEffortBtn = (key, text, title) => {
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
                    setReasoningEffort(store, conv.id, key);
                    updateReasoningControls();
                };
                return btn;
            };
            
            const lowBtn = createEffortBtn('low', 'L', '思考预算：低 (low)');
            const mediumBtn = createEffortBtn('medium', 'M', '思考预算：中 (medium)');
            const highBtn = createEffortBtn('high', 'H', '思考预算：高 (high)');
            
            controlGroup.appendChild(lowBtn);
            controlGroup.appendChild(mediumBtn);
            controlGroup.appendChild(highBtn);
            
            effortState.buttons = { low: lowBtn, medium: mediumBtn, high: highBtn };
            wrapper.appendChild(controlGroup);
            
            setTimeout(() => updateReasoningControls(), 0);
            setTimeout(() => updateReasoningControls(), 100);
            
            return wrapper;
        }
        
        // ===== OpenAI 渠道下 Gemini 模型思考配置相关函数 =====
        
        function getGeminiBudgetPresets() {
            if (window.IdoFront && window.IdoFront.geminiChannel && window.IdoFront.geminiChannel.BUDGET_PRESETS) {
                return window.IdoFront.geminiChannel.BUDGET_PRESETS;
            }
            return [
                { value: -1, label: '自动', description: '动态思考，模型自行决定', bars: 0, icon: 'magic_button' },
                { value: 0, label: '关闭', description: '关闭思考功能', bars: 0, icon: 'block' },
                { value: 1024, label: '最小', description: '1024 tokens', bars: 1 },
                { value: 4096, label: '低', description: '4096 tokens', bars: 2 },
                { value: 16384, label: '中', description: '16384 tokens', bars: 3 },
                { value: 32768, label: '高', description: '32768 tokens', bars: 4 }
            ];
        }
        
        function setThinkingBudget(store, convId, budget) {
            if (window.IdoFront && window.IdoFront.geminiChannel &&
                typeof window.IdoFront.geminiChannel.setThinkingBudget === 'function') {
                window.IdoFront.geminiChannel.setThinkingBudget(store, convId, budget);
            }
        }
        
        function setThinkingLevel(store, convId, level) {
            if (window.IdoFront && window.IdoFront.geminiChannel &&
                typeof window.IdoFront.geminiChannel.setThinkingLevel === 'function') {
                window.IdoFront.geminiChannel.setThinkingLevel(store, convId, level);
            }
        }
        
        function showBudgetBottomSheet(conv) {
            const store = getStore();
            if (!store) return;
            
            const BUDGET_PRESETS = getGeminiBudgetPresets();
            
            showBottomSheet((sheetContainer) => {
                const header = document.createElement('div');
                header.className = 'px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white';
                
                const title = document.createElement('h3');
                title.className = 'text-lg font-semibold text-gray-800';
                title.textContent = 'Gemini 思考预算';
                
                const closeBtn = document.createElement('button');
                closeBtn.className = 'text-gray-400 hover:text-gray-600 transition-colors';
                closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                closeBtn.onclick = () => hideBottomSheet();
                
                header.appendChild(title);
                header.appendChild(closeBtn);
                
                const body = document.createElement('div');
                body.className = 'flex-1 overflow-y-auto px-6 py-4 space-y-4';
                
                const thinkingCfg = getGeminiThinkingConfig();
                let currentBudget = thinkingCfg.budget;
                
                BUDGET_PRESETS.forEach(opt => {
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
                        updateGeminiThinkingControls();
                    };
                    body.appendChild(item);
                });
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
            });
        }
        
        function updateGeminiThinkingControls() {
            const wrapper = document.getElementById(GEMINI_WRAPPER_ID);
            if (!wrapper) return;
            
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
            
            const model = conv.selectedModel;
            if (!model) {
                wrapper.style.display = 'none';
                return;
            }
            
            const channelConfig = getChannelConfig(store, conv);
            if (!channelConfig || channelConfig.type !== 'openai') {
                wrapper.style.display = 'none';
                return;
            }
            
            if (!isGeminiThinkingModel(model)) {
                wrapper.style.display = 'none';
                return;
            }
            
            wrapper.style.display = 'flex';
            
            const thinkingCfg = getGeminiThinkingConfig();
            const BUDGET_PRESETS = getGeminiBudgetPresets();
            
            const budgetBtnEl = wrapper.querySelector('[data-openai-gemini-budget-btn]');
            const levelGroupEl = wrapper.querySelector('[data-openai-gemini-level-group]');
            
            if (isGeminiBudgetModel(model)) {
                if (budgetBtnEl) {
                    budgetBtnEl.style.display = 'inline-flex';
                    const budget = thinkingCfg.budget;
                    const preset = BUDGET_PRESETS.find(p => p.value === budget);
                    budgetBtnEl.textContent = preset ? preset.label : `${budget}`;
                }
                if (levelGroupEl) levelGroupEl.style.display = 'none';
            } else if (isGeminiLevelModel(model)) {
                if (budgetBtnEl) budgetBtnEl.style.display = 'none';
                if (levelGroupEl) {
                    levelGroupEl.style.display = 'flex';
                    const currentLevel = thinkingCfg.level;
                    ['minimal', 'low', 'medium', 'high'].forEach(key => {
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
        
        function renderGeminiThinking() {
            const wrapper = document.createElement('div');
            wrapper.id = GEMINI_WRAPPER_ID;
            wrapper.className = 'flex items-center gap-2';
            wrapper.style.display = 'none';
            wrapper.style.order = '1'; // 核心渠道参数，排在左侧
            
            const divider = document.createElement('div');
            divider.className = 'h-5 w-px bg-gray-200';
            wrapper.appendChild(divider);
            
            const controlGroup = document.createElement('div');
            controlGroup.className = 'flex items-center gap-1';
            
            const label = document.createElement('span');
            label.className = 'text-[10px] text-gray-400';
            label.textContent = '思考';
            controlGroup.appendChild(label);
            
            const budgetBtn = document.createElement('button');
            budgetBtn.type = 'button';
            budgetBtn.className = 'px-2 py-0.5 text-[10px] rounded border border-gray-300 bg-white hover:border-blue-400 text-gray-700 font-medium transition-colors';
            budgetBtn.setAttribute('data-openai-gemini-budget-btn', 'true');
            budgetBtn.textContent = '自动';
            budgetBtn.style.display = 'none';
            
            budgetBtn.onclick = (e) => {
                e.stopPropagation();
                const store = getStore();
                if (!store || !store.getActiveConversation) return;
                const conv = store.getActiveConversation();
                if (!conv) return;
                showBudgetBottomSheet(conv);
            };
            
            controlGroup.appendChild(budgetBtn);
            
            const levelGroup = document.createElement('div');
            levelGroup.className = 'flex items-center gap-0.5';
            levelGroup.setAttribute('data-openai-gemini-level-group', 'true');
            levelGroup.style.display = 'none';
            
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
                    updateGeminiThinkingControls();
                };
                return btn;
            };
            
            const minimalBtn = createLevelBtn('minimal', 'Min', '思考等级：最小 (Minimal)');
            const lowBtn = createLevelBtn('low', 'L', '思考等级：低 (Low)');
            const mediumBtn = createLevelBtn('medium', 'M', '思考等级：中 (Medium)');
            const highBtn = createLevelBtn('high', 'H', '思考等级：高 (High)');
            
            levelGroup.appendChild(minimalBtn);
            levelGroup.appendChild(lowBtn);
            levelGroup.appendChild(mediumBtn);
            levelGroup.appendChild(highBtn);
            
            levelState.buttons = { minimal: minimalBtn, low: lowBtn, medium: mediumBtn, high: highBtn };
            
            controlGroup.appendChild(levelGroup);
            wrapper.appendChild(controlGroup);
            
            setTimeout(() => updateGeminiThinkingControls(), 0);
            setTimeout(() => updateGeminiThinkingControls(), 100);
            
            return wrapper;
        }
        
        // ===== 共享事件注册 =====
        
        function ensureStoreEventRegistered() {
            if (storeEventRegistered) return;
            
            const store = getStore();
            if (store && store.events && typeof store.events.on === 'function') {
                store.events.on('updated', () => {
                    updateReasoningControls();
                    updateGeminiThinkingControls();
                });
                storeEventRegistered = true;
            } else {
                if (!ensureStoreEventRegistered.retryCount) {
                    ensureStoreEventRegistered.retryCount = 0;
                }
                ensureStoreEventRegistered.retryCount++;
                if (ensureStoreEventRegistered.retryCount < 50) {
                    setTimeout(ensureStoreEventRegistered, 100);
                }
            }
        }
        
        function ensureFrameworkEventRegistered() {
            if (typeof Framework !== 'undefined' && Framework.events) {
                Framework.events.on('mode:changed', (data) => {
                    if (data && data.mode === 'chat') {
                        setTimeout(() => {
                            updateReasoningControls();
                            updateGeminiThinkingControls();
                        }, 50);
                    }
                });
            }
        }
        
        // ===== 使用 registerUIBundle 注册纯 UI 组件 =====
        
        registerBundle('core-openai-channel-ui', {
            slots: {
                [SLOTS.INPUT_TOP]: [
                    { id: 'reasoning-effort', render: renderReasoningEffort },
                    { id: 'gemini-thinking', render: renderGeminiThinking }
                ]
            },
            init: function() {
                ensureStoreEventRegistered();
                ensureFrameworkEventRegistered();
            }
        });
    }
    
    // 注册 OpenAI 渠道 UI 插件
    registerOpenAIChannelPlugins();
    
    // ========== 通用设置分区注册 ==========
    
    function registerOpenAIReasoningSettingsSection() {
        if (!window.IdoFront || !window.IdoFront.settingsManager ||
            typeof window.IdoFront.settingsManager.registerGeneralSection !== 'function') {
            return;
        }
        
        try {
            const sm = window.IdoFront.settingsManager;
            sm.registerGeneralSection({
                id: 'openai-reasoning',
                title: 'OpenAI 思考功能',
                description: '配置 OpenAI 模型的 reasoning_effort 匹配规则（正则表达式）',
                icon: 'psychology',
                order: 19,
                render: function(container) {
                    container.innerHTML = '';
                    
                    const rules = loadGlobalReasoningRules();
                    
                    const formGroup = document.createElement('div');
                    formGroup.className = 'ido-form-group';
                    
                    const labelEl = document.createElement('div');
                    labelEl.className = 'ido-form-label';
                    labelEl.textContent = '模型匹配规则 (reasoning_effort)';
                    formGroup.appendChild(labelEl);
                    
                    const hintEl = document.createElement('div');
                    hintEl.className = 'text-[10px] text-gray-500 mb-1';
                    hintEl.textContent = '匹配的模型将显示 L/M/H 思考预算按钮';
                    formGroup.appendChild(hintEl);
                    
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors font-mono';
                    input.value = rules.modelPattern;
                    input.placeholder = 'gpt-5|o1|o3';
                    
                    input.onchange = () => {
                        const currentRules = loadGlobalReasoningRules();
                        currentRules.modelPattern = input.value || DEFAULT_REASONING_RULES.modelPattern;
                        saveGlobalReasoningRules(currentRules);
                    };
                    
                    formGroup.appendChild(input);
                    container.appendChild(formGroup);
                    
                    const helpText = document.createElement('div');
                    helpText.className = 'text-[10px] text-gray-400 mt-3';
                    helpText.innerHTML = '提示：使用正则表达式匹配模型名称。例如 <code class="bg-gray-100 px-1 rounded">gpt-5|o1|o3</code> 匹配 GPT-5、o1、o3 系列模型。';
                    container.appendChild(helpText);
                }
            });
        } catch (e) {
            console.warn('[OpenAIChannel] registerOpenAIReasoningSettingsSection error:', e);
        }
    }
    
    registerOpenAIReasoningSettingsSection();
    
    if (typeof document !== 'undefined') {
        try {
            document.addEventListener('IdoFrontSettingsReady', function() {
                registerOpenAIReasoningSettingsSection();
            });
        } catch (e) {
            console.warn('[OpenAIChannel] attach IdoFrontSettingsReady listener error:', e);
        }
    }
    
    // 暴露工具函数
    window.IdoFront.openaiChannel.supportsReasoningEffort = supportsReasoningEffort;
    window.IdoFront.openaiChannel.getReasoningEffort = getReasoningEffort;
    window.IdoFront.openaiChannel.setReasoningEffort = setReasoningEffort;
    window.IdoFront.openaiChannel.loadGlobalReasoningRules = loadGlobalReasoningRules;
    window.IdoFront.openaiChannel.saveGlobalReasoningRules = saveGlobalReasoningRules;
    window.IdoFront.openaiChannel.EFFORT_OPTIONS = EFFORT_OPTIONS;
    window.IdoFront.openaiChannel.DEFAULT_REASONING_RULES = DEFAULT_REASONING_RULES;
})();