/**
 * Anthropic Claude Channel Adapter
 * Handles communication with Anthropic Claude API
 * 
 * @see https://docs.anthropic.com/claude/reference/messages_post
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channels = window.IdoFront.channels || {};
    window.IdoFront.claudeChannel = window.IdoFront.claudeChannel || {};

    const registry = window.IdoFront.channelRegistry;
    const CHANNEL_ID = 'claude';

    // ========== Claude Extended Thinking Configuration ==========
    
    // 存储键
    const THINKING_RULES_STORAGE_KEY = 'ido.claude.thinkingRules';
    
    // 默认思考规则配置（正则表达式字符串）
    const DEFAULT_THINKING_RULES = {
        // 支持 extended thinking 的模型匹配规则
        thinkingModelPattern: 'claude-3-7|claude-3\\.7|claude-4'
    };
    
    // 全局规则缓存
    let cachedGlobalRules = null;

    // Extended Thinking Budget 预设选项
    const THINKING_BUDGET_PRESETS = [
        { value: 0, label: '关闭', description: '不使用扩展思考' },
        { value: 5000, label: '低', description: '5000 tokens' },
        { value: 10000, label: '中', description: '10000 tokens' },
        { value: 20000, label: '高', description: '20000 tokens' },
        { value: 50000, label: '最高', description: '50000 tokens' }
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
                        thinkingModelPattern: saved.thinkingModelPattern || DEFAULT_THINKING_RULES.thinkingModelPattern
                    };
                    return cachedGlobalRules;
                }
            }
        } catch (e) {
            console.warn('[ClaudeChannel] Failed to load global thinking rules:', e);
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
            console.warn('[ClaudeChannel] Failed to save global thinking rules:', e);
        }
    }

    /**
     * 判断模型是否支持 extended thinking
     * @param {string} modelName - 模型名称
     * @returns {boolean}
     */
    function supportsExtendedThinking(modelName) {
        if (!modelName) return false;
        const rules = loadGlobalThinkingRules();
        if (!rules.thinkingModelPattern) return false;
        try {
            const regex = new RegExp(rules.thinkingModelPattern, 'i');
            return regex.test(modelName);
        } catch (e) {
            console.warn('[ClaudeChannel] Invalid thinking model pattern:', rules.thinkingModelPattern, e);
            return false;
        }
    }

    /**
     * 获取会话的 Claude 思考配置
     * @param {Object} conv - 会话对象
     * @returns {Object} 思考配置
     */
    function getThinkingConfig(conv) {
        if (!conv) return { budget: 0 };
        const claudeMeta = conv.metadata?.claude || {};
        return {
            budget: claudeMeta.thinkingBudget !== undefined ? claudeMeta.thinkingBudget : 0
        };
    }

    /**
     * 设置会话的 Claude 思考预算
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {number} budget - 思考预算
     */
    function setThinkingBudget(store, convId, budget) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;
        
        if (!conv.metadata) conv.metadata = {};
        if (!conv.metadata.claude) conv.metadata.claude = {};
        conv.metadata.claude.thinkingBudget = budget;
        
        if (typeof store.persist === 'function') {
            store.persist();
        }
    }

    /**
     * 转换消息格式为 Claude API 格式
     * @param {Array} messages - 消息数组
     * @returns {Object} { system, messages }
     */
    function convertMessages(messages) {
        let systemPrompt = '';
        const claudeMessages = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                // Claude 的 system 是单独的字段
                systemPrompt = msg.content || '';
                continue;
            }

            // Claude 只接受 user 和 assistant 角色
            if (msg.role !== 'user' && msg.role !== 'assistant') {
                continue;
            }

            const content = [];

            // 处理附件（图片）
            const attachments = msg.attachments || msg.metadata?.attachments || [];
            for (const attachment of attachments) {
                if (attachment.type && attachment.type.startsWith('image/')) {
                    // Claude 使用 base64 格式
                    const base64Data = attachment.dataUrl.split(',')[1];
                    content.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: attachment.type,
                            data: base64Data
                        }
                    });
                }
            }

            // 添加文本内容
            if (msg.content) {
                content.push({
                    type: 'text',
                    text: msg.content
                });
            }

            // Claude 要求 content 不能为空
            if (content.length > 0) {
                claudeMessages.push({
                    role: msg.role,
                    content: content
                });
            }
        }

        // Claude 要求第一条消息必须是 user
        if (claudeMessages.length > 0 && claudeMessages[0].role !== 'user') {
            claudeMessages.unshift({
                role: 'user',
                content: [{ type: 'text', text: '.' }]
            });
        }

        // Claude 要求消息必须交替出现（user, assistant, user, ...）
        const normalizedMessages = [];
        let lastRole = null;
        
        for (const msg of claudeMessages) {
            if (lastRole === msg.role) {
                // 相同角色，合并内容
                const lastMsg = normalizedMessages[normalizedMessages.length - 1];
                if (Array.isArray(lastMsg.content) && Array.isArray(msg.content)) {
                    lastMsg.content = lastMsg.content.concat(msg.content);
                }
            } else {
                normalizedMessages.push(msg);
                lastRole = msg.role;
            }
        }

        return { 
            system: systemPrompt, 
            messages: normalizedMessages 
        };
    }

    /**
     * 解析 Claude SSE 事件
     * @param {string} data - SSE 数据
     * @returns {Object|null}
     */
    function parseSSEEvent(data) {
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch (e) {
            return null;
        }
    }

    const adapter = {
        /**
         * Send message to Claude API
         * @param {Array} messages - Chat history
         * @param {Object} config - Channel configuration
         * @param {Function} onUpdate - Optional callback for streaming updates
         * @param {AbortSignal} signal - Optional abort signal for cancellation
         * @returns {Promise<Object>} - Response content
         */
        async call(messages, config, onUpdate, signal) {
            let baseUrl = config.baseUrl;
            if (!baseUrl || !baseUrl.trim()) {
                baseUrl = 'https://api.anthropic.com';
            }
            // Normalize URL: remove trailing slash
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            const model = config.model || 'claude-3-5-sonnet-20241022';
            const isStream = !!onUpdate;

            // Convert messages
            const { system, messages: claudeMessages } = convertMessages(messages);

            // Build request body
            const body = {
                model: model,
                messages: claudeMessages,
                max_tokens: config.maxTokens || 8192,
                stream: isStream
            };

            // Add system prompt if present
            if (system) {
                body.system = system;
            }

            // Add optional parameters
            if (config.temperature !== undefined) {
                body.temperature = parseFloat(config.temperature);
            }
            if (config.topP !== undefined) {
                body.top_p = parseFloat(config.topP);
            }
            if (config.topK !== undefined) {
                body.top_k = parseInt(config.topK);
            }

            // Extended Thinking configuration
            let claudeMeta = {};
            try {
                const store = window.IdoFront && window.IdoFront.store;
                if (store && typeof store.getActiveConversation === 'function') {
                    const conv = store.getActiveConversation();
                    if (conv && conv.metadata && conv.metadata.claude) {
                        claudeMeta = conv.metadata.claude;
                    }
                }
            } catch (e) {
                console.warn('[ClaudeChannel] Failed to get conversation metadata:', e);
            }

            if (supportsExtendedThinking(model)) {
                const budget = claudeMeta.thinkingBudget || 0;
                if (budget > 0) {
                    body.thinking = {
                        type: 'enabled',
                        budget_tokens: budget
                    };
                }
            }

            // Apply params override
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                if (window.IdoFront && window.IdoFront.utils && window.IdoFront.utils.deepMerge) {
                    window.IdoFront.utils.deepMerge(body, config.paramsOverride);
                } else {
                    Object.assign(body, config.paramsOverride);
                }
            }

            // Build headers
            const headers = {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
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
                const response = await fetch(`${baseUrl}/v1/messages`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body),
                    signal: signal
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMsg = `Claude API Error ${response.status}`;
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
                    return await this.handleStreamResponse(response, onUpdate);
                } else {
                    return await this.handleNonStreamResponse(response, onUpdate);
                }

            } catch (error) {
                if (signal?.aborted) {
                    throw new Error('请求已取消');
                }
                console.error('[ClaudeChannel] Error:', error);
                throw error;
            }
        },

        /**
         * Handle streaming response
         */
        async handleStreamResponse(response, onUpdate) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let fullContent = '';
            let fullThinking = '';
            let inputTokens = 0;
            let outputTokens = 0;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        // Claude SSE format: event: xxx \n data: {...}
                        if (trimmed.startsWith('data: ')) {
                            const jsonStr = trimmed.substring(6);
                            const event = parseSSEEvent(jsonStr);
                            if (!event) continue;

                            // Handle different event types
                            switch (event.type) {
                                case 'message_start':
                                    // 消息开始，可以获取 usage 信息
                                    if (event.message?.usage) {
                                        inputTokens = event.message.usage.input_tokens || 0;
                                    }
                                    break;

                                case 'content_block_start':
                                    // 内容块开始
                                    if (event.content_block?.type === 'thinking') {
                                        // Extended thinking 开始
                                    }
                                    break;

                                case 'content_block_delta':
                                    // 内容增量
                                    if (event.delta?.type === 'text_delta') {
                                        fullContent += event.delta.text || '';
                                        onUpdate({
                                            content: fullContent,
                                            reasoning: fullThinking || null
                                        });
                                    } else if (event.delta?.type === 'thinking_delta') {
                                        // Extended thinking 增量
                                        fullThinking += event.delta.thinking || '';
                                        onUpdate({
                                            content: fullContent,
                                            reasoning: fullThinking
                                        });
                                    }
                                    break;

                                case 'message_delta':
                                    // 消息增量，包含 stop_reason 和 usage
                                    if (event.usage) {
                                        outputTokens = event.usage.output_tokens || 0;
                                    }
                                    break;

                                case 'message_stop':
                                    // 消息结束
                                    break;

                                case 'error':
                                    throw new Error(`Claude API Error: ${event.error?.message || 'Unknown error'}`);
                            }
                        }
                    }
                }
            } catch (streamError) {
                console.error('[ClaudeChannel] Stream error:', streamError);
                throw streamError;
            }

            // Build final response in OpenAI-compatible format
            const result = {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: fullContent,
                        reasoning_content: fullThinking || null
                    },
                    finish_reason: 'stop'
                }]
            };

            // Add usage info
            if (inputTokens > 0 || outputTokens > 0) {
                result.usage = {
                    prompt_tokens: inputTokens,
                    completion_tokens: outputTokens,
                    total_tokens: inputTokens + outputTokens
                };
            }

            return result;
        },

        /**
         * Handle non-streaming response
         */
        async handleNonStreamResponse(response, onUpdate) {
            const data = await response.json();

            // Extract content from Claude response
            let content = '';
            let thinking = '';

            if (data.content && Array.isArray(data.content)) {
                for (const block of data.content) {
                    if (block.type === 'text') {
                        content += block.text || '';
                    } else if (block.type === 'thinking') {
                        thinking += block.thinking || '';
                    }
                }
            }

            // Trigger update callback
            if (onUpdate) {
                onUpdate({
                    content: content,
                    reasoning: thinking || null
                });
            }

            // Build response in OpenAI-compatible format
            const result = {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: content,
                        reasoning_content: thinking || null
                    },
                    finish_reason: data.stop_reason || 'stop'
                }]
            };

            // Add usage info
            if (data.usage) {
                result.usage = {
                    prompt_tokens: data.usage.input_tokens || 0,
                    completion_tokens: data.usage.output_tokens || 0,
                    total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
                };
            }

            return result;
        },

        /**
         * Fetch available models from Claude API
         * Note: Anthropic doesn't provide a models list API, returning static list
         * @param {Object} config - Channel configuration
         * @returns {Promise<Array>} - List of model IDs
         */
        async fetchModels(config) {
            // Anthropic 目前不提供模型列表 API，返回静态列表
            return [];
        }
    };

    // Register with channelRegistry
    if (registry) {
        registry.registerType(CHANNEL_ID, {
            adapter: adapter,
            label: 'Anthropic Claude',
            source: 'core',
            version: '1.0.0',
            defaults: {
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-5-sonnet-20241022'
            },
            capabilities: {
                streaming: true,
                vision: true,
                thinking: true  // 支持 extended thinking
            },
            metadata: {
                provider: 'anthropic',
                docs: 'https://docs.anthropic.com/claude/reference/messages_post'
            },
            icon: 'psychology'
        });
        console.log('[ClaudeChannel] Registered as channel type:', CHANNEL_ID);
    } else {
        // Fallback for older versions
        window.IdoFront.channels[CHANNEL_ID] = adapter;
    }

    // ========== Claude Extended Thinking UI Components ==========
    
    function registerThinkingBudgetPlugin() {
        if (typeof Framework === 'undefined' || !Framework) {
            console.warn('[ClaudeChannel] Framework API not available for UI registration');
            return;
        }
        
        const registerBundle = Framework.registerUIBundle || Framework.registerPluginBundle;
        if (!registerBundle) {
            console.warn('[ClaudeChannel] No bundle registration API available');
            return;
        }
        
        const { SLOTS, showBottomSheet, hideBottomSheet } = Framework;
        
        if (!SLOTS || !SLOTS.INPUT_TOP) {
            console.warn('[ClaudeChannel] INPUT_TOP slot not available');
            return;
        }

        const WRAPPER_ID = 'core-claude-thinking-budget-wrapper';
        let storeEventRegistered = false;

        function getStore() {
            return window.IdoFront && window.IdoFront.store ? window.IdoFront.store : null;
        }

        function getChannelConfig(store, conv) {
            if (!store || !conv || !conv.selectedChannelId) return null;
            return store.state.channels.find(c => c.id === conv.selectedChannelId) || null;
        }

        function showBudgetBottomSheet(conv) {
            const store = getStore();
            if (!store) return;
            
            showBottomSheet((sheetContainer) => {
                // Header
                const header = document.createElement('div');
                header.className = 'px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white';
                
                const title = document.createElement('h3');
                title.className = 'text-lg font-semibold text-gray-800';
                title.textContent = 'Extended Thinking 预算';
                
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
                
                // Description
                const description = document.createElement('div');
                description.className = 'text-sm text-gray-600 mb-4';
                description.textContent = '设置 Claude 扩展思考功能的 token 预算。启用后，Claude 会在回答前进行更深入的思考。';
                body.appendChild(description);

                // Preset buttons
                const presetsWrapper = document.createElement('div');
                presetsWrapper.className = 'grid grid-cols-3 gap-3 mb-6';

                const presetButtons = [];
                THINKING_BUDGET_PRESETS.forEach(preset => {
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
                    
                    const updateBtnStyles = () => {
                        presetButtons.forEach(b => {
                            b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                            b.classList.add('bg-white', 'text-gray-700', 'border-gray-200');
                        });
                        if (currentBudget === preset.value) {
                            btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-200');
                            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                        }
                    };
                    
                    btn.onclick = () => {
                        currentBudget = preset.value;
                        setThinkingBudget(store, conv.id, currentBudget);
                        updateBtnStyles();
                        updateThinkingControls();
                    };
                    
                    if (currentBudget === preset.value) {
                        btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                    } else {
                        btn.classList.add('bg-white', 'text-gray-700', 'border-gray-200');
                    }
                    
                    presetButtons.push(btn);
                    presetsWrapper.appendChild(btn);
                });
                body.appendChild(presetsWrapper);

                // Help text
                const helpText = document.createElement('div');
                helpText.className = 'text-xs text-gray-500 p-3 bg-gray-50 rounded-lg';
                helpText.innerHTML = `
                    <div class="font-medium text-gray-600 mb-1">💡 说明</div>
                    <ul class="list-disc list-inside space-y-1">
                        <li>Extended Thinking 适用于 Claude 3.7 及更新版本</li>
                        <li>启用后，Claude 会先进行内部推理，再给出回答</li>
                        <li>更高的预算允许更深入的思考，但会增加响应时间</li>
                    </ul>
                `;
                body.appendChild(helpText);
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
            });
        }

        function updateThinkingControls() {
            const wrapper = document.getElementById(WRAPPER_ID);
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
            
            // 检查是否是 Claude 渠道且模型支持思考
            if (!channelConfig || channelConfig.type !== 'claude') {
                wrapper.style.display = 'none';
                return;
            }
            
            if (!supportsExtendedThinking(model)) {
                wrapper.style.display = 'none';
                return;
            }

            wrapper.style.display = 'flex';

            const thinkingCfg = getThinkingConfig(conv);
            const budgetBtn = wrapper.querySelector('[data-claude-budget-btn]');
            
            if (budgetBtn) {
                const budget = thinkingCfg.budget;
                const preset = THINKING_BUDGET_PRESETS.find(p => p.value === budget);
                budgetBtn.textContent = preset ? preset.label : `${budget}`;
            }
        }

        function ensureStoreEventRegistered() {
            if (storeEventRegistered) return;
            
            const store = getStore();
            if (store && store.events && typeof store.events.on === 'function') {
                store.events.on('updated', updateThinkingControls);
                store.events.on('conversation:switched', updateThinkingControls);
                storeEventRegistered = true;
                setTimeout(() => updateThinkingControls(), 0);
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

        // Register UI bundle
        // 注意：id 必须唯一，避免与 Gemini 渠道冲突
        registerBundle('core-claude-channel-ui', {
            init: function() {
                ensureStoreEventRegistered();
            },
            slots: {
                [SLOTS.INPUT_TOP]: {
                    id: 'claude-thinking-budget',
                    render: function() {
                        ensureStoreEventRegistered();
                        
                        const wrapper = document.createElement('div');
                        wrapper.id = WRAPPER_ID;
                        wrapper.className = 'flex items-center gap-2';
                        wrapper.style.display = 'none';
                        wrapper.style.order = '1'; // 核心渠道参数，排在左侧

                        // Divider
                        const divider = document.createElement('div');
                        divider.className = 'h-5 w-px bg-gray-200';
                        wrapper.appendChild(divider);

                        // Control group
                        const controlGroup = document.createElement('div');
                        controlGroup.className = 'flex items-center gap-1';

                        const label = document.createElement('span');
                        label.className = 'text-[10px] text-gray-400';
                        label.textContent = '思考';
                        controlGroup.appendChild(label);

                        // Budget button
                        const budgetBtn = document.createElement('button');
                        budgetBtn.type = 'button';
                        budgetBtn.className = 'px-2 py-0.5 text-[10px] rounded border border-gray-300 bg-white hover:border-blue-400 text-gray-700 font-medium transition-colors';
                        budgetBtn.setAttribute('data-claude-budget-btn', 'true');
                        budgetBtn.textContent = '关闭';

                        budgetBtn.onclick = (e) => {
                            e.stopPropagation();
                            const store = getStore();
                            if (!store || !store.getActiveConversation) return;
                            const conv = store.getActiveConversation();
                            if (!conv) return;
                            showBudgetBottomSheet(conv);
                        };
                        
                        controlGroup.appendChild(budgetBtn);
                        wrapper.appendChild(controlGroup);

                        setTimeout(() => updateThinkingControls(), 0);
                        setTimeout(() => updateThinkingControls(), 100);

                        return wrapper;
                    }
                }
            }
        });
    }
    
    // Auto-register UI plugin
    registerThinkingBudgetPlugin();

    // ========== Settings Section Registration ==========
    
    function registerClaudeSettingsSection() {
        if (!window.IdoFront || !window.IdoFront.settingsManager ||
            typeof window.IdoFront.settingsManager.registerGeneralSection !== 'function') {
            return;
        }
        
        try {
            const sm = window.IdoFront.settingsManager;
            sm.registerGeneralSection({
                id: 'claude-thinking',
                title: 'Claude Extended Thinking',
                description: '配置 Claude 模型的扩展思考功能匹配规则（正则表达式）',
                icon: 'psychology',
                category: '模型特性',
                tags: ['Claude', 'extended thinking', 'thinking', '正则', '模型'],
                advanced: false,
                order: 22,
                render: function(container, ctx, st) {
                    container.innerHTML = '';
                    
                    const rules = loadGlobalThinkingRules();
                    
                    const formGroup = document.createElement('div');
                    formGroup.className = 'ido-form-group';
                    
                    const labelEl = document.createElement('div');
                    labelEl.className = 'ido-form-label';
                    labelEl.textContent = '支持 Extended Thinking 的模型';
                    formGroup.appendChild(labelEl);
                    
                    const hintEl = document.createElement('div');
                    hintEl.className = 'text-[10px] text-gray-500 mb-1';
                    hintEl.textContent = '匹配的模型将显示思考预算配置按钮';
                    formGroup.appendChild(hintEl);
                    
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors font-mono';
                    input.value = rules.thinkingModelPattern;
                    input.placeholder = 'claude-3-7|claude-4';
                    
                    input.onchange = () => {
                        const currentRules = loadGlobalThinkingRules();
                        currentRules.thinkingModelPattern = input.value || DEFAULT_THINKING_RULES.thinkingModelPattern;
                        saveGlobalThinkingRules(currentRules);
                    };
                    
                    formGroup.appendChild(input);
                    container.appendChild(formGroup);
                    
                    const helpText = document.createElement('div');
                    helpText.className = 'text-[10px] text-gray-400 mt-3';
                    helpText.innerHTML = '提示：Extended Thinking 是 Claude 3.7+ 的高级功能，允许模型在回答前进行更深入的推理。';
                    container.appendChild(helpText);
                }
            });
        } catch (e) {
            console.warn('[ClaudeChannel] registerClaudeSettingsSection error:', e);
        }
    }
    
    // Try immediate registration
    registerClaudeSettingsSection();
    
    // Listen for settings ready event
    if (typeof document !== 'undefined') {
        try {
            document.addEventListener('IdoFrontSettingsReady', function() {
                registerClaudeSettingsSection();
            }, { once: true });
        } catch (e) {
            console.warn('[ClaudeChannel] attach IdoFrontSettingsReady listener error:', e);
        }
    }

    // Export utility functions
    window.IdoFront.claudeChannel.supportsExtendedThinking = supportsExtendedThinking;
    window.IdoFront.claudeChannel.getThinkingConfig = getThinkingConfig;
    window.IdoFront.claudeChannel.setThinkingBudget = setThinkingBudget;
    window.IdoFront.claudeChannel.loadGlobalThinkingRules = loadGlobalThinkingRules;
    window.IdoFront.claudeChannel.saveGlobalThinkingRules = saveGlobalThinkingRules;
    window.IdoFront.claudeChannel.THINKING_BUDGET_PRESETS = THINKING_BUDGET_PRESETS;
    window.IdoFront.claudeChannel.DEFAULT_THINKING_RULES = DEFAULT_THINKING_RULES;

})();