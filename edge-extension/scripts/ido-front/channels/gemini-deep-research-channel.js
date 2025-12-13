/**
 * Gemini Deep Research Channel Adapter
 * 
 * Gemini Deep Research Agent 使用 Interactions API 进行多步骤研究任务。
 * 由 Gemini 3 Pro 驱动，能够自主规划、执行并综合多步骤研究任务。
 * 
 * 特点：
 * - 必须使用 background=true 异步执行（研究任务可能需要几分钟）
 * - 支持流式输出（实时进度更新）
 * - 支持文件搜索（file_search）工具
 * - 支持后续问题（previous_interaction_id）
 * 
 * @see https://ai.google.dev/gemini-api/docs/deep-research
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channels = window.IdoFront.channels || {};
    window.IdoFront.deepResearchChannel = window.IdoFront.deepResearchChannel || {};

    const registry = window.IdoFront.channelRegistry;
    const CHANNEL_ID = 'gemini-deep-research';
    
    // ========== Deep Research 配置 ==========
    
    // 存储键
    const DEEP_RESEARCH_CONFIG_KEY = 'ido.deepResearch.config';
    
    // 默认配置（仅包含行为参数）
    const DEFAULT_CONFIG = {
        // 是否启用思考摘要
        thinkingSummaries: 'auto',
        // 轮询间隔（毫秒）
        pollInterval: 10000,
        // 最大研究时间（分钟）
        maxResearchTime: 60
    };
    
    // 缓存配置
    let cachedConfig = null;
    
    /**
     * 加载全局配置
     * @returns {Object} 配置对象
     */
    function loadGlobalConfig() {
        if (cachedConfig) return cachedConfig;
        
        try {
            if (typeof Framework !== 'undefined' && Framework.storage) {
                const saved = Framework.storage.getItem(DEEP_RESEARCH_CONFIG_KEY);
                if (saved && typeof saved === 'object') {
                    cachedConfig = { ...DEFAULT_CONFIG, ...saved };
                    return cachedConfig;
                }
            }
        } catch (e) {
            console.warn('[DeepResearchChannel] Failed to load config:', e);
        }
        
        return { ...DEFAULT_CONFIG };
    }
    
    /**
     * 保存全局配置
     * @param {Object} config - 配置对象
     */
    function saveGlobalConfig(config) {
        try {
            if (typeof Framework !== 'undefined' && Framework.storage) {
                Framework.storage.setItem(DEEP_RESEARCH_CONFIG_KEY, config);
                cachedConfig = { ...config };
            }
        } catch (e) {
            console.warn('[DeepResearchChannel] Failed to save config:', e);
        }
    }
    
    /**
     * 获取会话的 Deep Research 元数据
     * @param {Object} conv - 会话对象
     * @returns {Object} 元数据
     */
    function getDeepResearchMeta(conv) {
        if (!conv) return {};
        return conv.metadata?.deepResearch || {};
    }
    
    /**
     * 设置会话的 previous_interaction_id（用于后续问题）
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {string} interactionId - 交互 ID
     */
    function setPreviousInteractionId(store, convId, interactionId) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;
        
        if (!conv.metadata) conv.metadata = {};
        if (!conv.metadata.deepResearch) conv.metadata.deepResearch = {};
        conv.metadata.deepResearch.previousInteractionId = interactionId;
        
        if (typeof store.persist === 'function') {
            store.persist();
        }
    }
    
    /**
     * 清除会话的 previous_interaction_id
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     */
    function clearPreviousInteractionId(store, convId) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv || !conv.metadata?.deepResearch) return;
        
        delete conv.metadata.deepResearch.previousInteractionId;
        
        if (typeof store.persist === 'function') {
            store.persist();
        }
    }

    /**
     * 延迟函数
     * @param {number} ms - 毫秒数
     * @returns {Promise}
     */
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 解析 SSE 事件流
     * @param {string} data - SSE 数据
     * @returns {Object|null} 解析后的事件对象
     */
    function parseSSEEvent(data) {
        if (!data || data === '[DONE]') return null;
        
        try {
            return JSON.parse(data);
        } catch (e) {
            console.warn('[DeepResearchChannel] Failed to parse SSE data:', data, e);
            return null;
        }
    }

    const adapter = {
        /**
         * 发送消息到 Gemini Deep Research API
         * 
         * @param {Array} messages - 聊天历史
         * @param {Object} config - 渠道配置
         * @param {Function} onUpdate - 可选的流式更新回调
         * @param {AbortSignal} signal - 可选的取消信号
         * @returns {Promise<Object>} - 响应内容
         */
        async call(messages, config, onUpdate, signal) {
            let baseUrl = config.baseUrl;
            if (!baseUrl || !baseUrl.trim()) {
                baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
            }
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            // 获取全局配置
            const globalConfig = loadGlobalConfig();
            
            // 使用渠道配置的 model 字段作为 Agent 名称
            let agentName = config.model || 'deep-research-pro-preview-12-2025';
            
            // 获取会话元数据
            let deepResearchMeta = {};
            try {
                const store = window.IdoFront && window.IdoFront.store;
                if (store && typeof store.getActiveConversation === 'function') {
                    const conv = store.getActiveConversation();
                    if (conv) {
                        deepResearchMeta = getDeepResearchMeta(conv);
                    }
                }
            } catch (e) {
                console.warn('[DeepResearchChannel] Failed to get conversation metadata:', e);
            }
            
            // 构建输入文本（使用最后一条用户消息）
            let inputText = '';
            let systemInstruction = '';
            
            for (const msg of messages) {
                if (msg.role === 'system') {
                    systemInstruction = msg.content || '';
                } else if (msg.role === 'user') {
                    inputText = msg.content || '';
                }
            }
            
            // 如果有系统指令，将其添加到输入前面
            if (systemInstruction) {
                inputText = `${systemInstruction}\n\n${inputText}`;
            }
            
            // 检查是否是续写模式（后续问题）
            const isFollowUp = !!deepResearchMeta.previousInteractionId;
            
            // 构建请求体
            const body = {
                input: inputText,
                agent: agentName
            };
            
            // 续写模式不需要 background=true，是同步调用
            // 新研究任务需要 background=true
            if (!isFollowUp) {
                body.background = true;
                body.store = true;  // background=true 时需要 store=true
            }
            
            // 添加流式配置（仅新研究任务使用流式）
            const isStream = !!onUpdate && !isFollowUp;
            if (isStream) {
                body.stream = true;
                body.agent_config = {
                    type: 'deep-research',
                    thinking_summaries: globalConfig.thinkingSummaries || 'auto'
                };
            }
            
            // 添加 previous_interaction_id（用于后续问题）
            if (isFollowUp) {
                body.previous_interaction_id = deepResearchMeta.previousInteractionId;
            }
            
            // 添加 file_search 工具（如果配置了）
            if (config.paramsOverride?.tools) {
                body.tools = config.paramsOverride.tools;
            }
            
            // 应用参数覆写
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                const { tools, ...otherParams } = config.paramsOverride;
                if (window.IdoFront && window.IdoFront.utils && window.IdoFront.utils.deepMerge) {
                    window.IdoFront.utils.deepMerge(body, otherParams);
                } else {
                    Object.assign(body, otherParams);
                }
            }
            
            const headers = {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey
            };
            
            // 应用自定义请求头
            if (config.customHeaders && Array.isArray(config.customHeaders)) {
                config.customHeaders.forEach(header => {
                    if (header.key && header.value) {
                        headers[header.key] = header.value;
                    }
                });
            }
            
            try {
                // 构建 URL
                let url = `${baseUrl}/interactions`;
                if (isStream) {
                    url += '?alt=sse';
                }
                
                console.log('[DeepResearchChannel] Starting research task...', { url, agent: agentName });
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body),
                    signal: signal
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMsg = `Deep Research API Error ${response.status}`;
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
                
                if (isFollowUp) {
                    // 续写模式：同步响应，直接解析
                    return await this.handleFollowUpResponse(response, onUpdate);
                } else if (isStream) {
                    // 新研究 + 流式处理
                    return await this.handleStreamResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig);
                } else {
                    // 新研究 + 非流式：需要轮询获取结果
                    return await this.handlePollingResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig);
                }
                
            } catch (error) {
                console.error('[DeepResearchChannel] Error:', error);
                throw error;
            }
        },
        
        /**
         * 处理流式响应
         *
         * Deep Research 流式响应特点：
         * 1. 流可能只包含 thought_summary（思考过程），最终报告需要轮询获取
         * 2. 流结束（[DONE]）不等于研究完成，需要检查 interaction.complete
         * 3. 如果流结束但没有 interaction.complete，需要继续轮询
         */
        async handleStreamResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let fullContent = '';
            let fullReasoning = '';
            let interactionId = null;
            let lastEventId = null;
            let isComplete = false;
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log('[DeepResearchChannel] Stream ended (reader done)');
                        break;
                    }
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        
                        // 检测 [DONE] 标记
                        if (trimmed === 'data: [DONE]') {
                            console.log('[DeepResearchChannel] Received [DONE] marker');
                            continue;
                        }
                        
                        // SSE 格式: data: {json} 或 event: xxx
                        if (trimmed.startsWith('data: ')) {
                            const jsonStr = trimmed.substring(6);
                            const event = parseSSEEvent(jsonStr);
                            if (!event) continue;
                            
                            // 提取 interaction_id
                            if (event.event_type === 'interaction.start' && event.interaction?.id) {
                                interactionId = event.interaction.id;
                                console.log('[DeepResearchChannel] Interaction started:', interactionId);
                                
                                // 通知前端研究已开始
                                onUpdate({
                                    content: '🔬 深度研究任务已启动，正在规划研究步骤...\n\n*研究进度可在左侧"推理过程"中查看*',
                                    reasoning: fullReasoning || null
                                });
                            }
                            
                            // 提取 event_id（用于重连）
                            if (event.event_id) {
                                lastEventId = event.event_id;
                            }
                            
                            // 处理内容增量
                            if (event.event_type === 'content.delta') {
                                if (event.delta?.type === 'text') {
                                    // 实际报告文本
                                    fullContent += event.delta.text || '';
                                    onUpdate({
                                        content: fullContent,
                                        reasoning: fullReasoning || null
                                    });
                                } else if (event.delta?.type === 'thought_summary') {
                                    // 思考过程摘要
                                    const thoughtText = event.delta.content?.text || '';
                                    fullReasoning += thoughtText + '\n\n';
                                    
                                    // 如果还没有正式内容，显示研究进度
                                    const displayContent = fullContent || '🔬 正在研究中...\n\n*研究进度可在左侧"推理过程"中查看*';
                                    onUpdate({
                                        content: displayContent,
                                        reasoning: fullReasoning
                                    });
                                }
                            }
                            
                            // 检查完成状态
                            if (event.event_type === 'interaction.complete') {
                                isComplete = true;
                                const completeStatus = event.interaction?.status || 'unknown';
                                console.log('[DeepResearchChannel] Research complete via interaction.complete, status:', completeStatus);
                                
                                // 只有当完成状态为 failed 时才抛出错误
                                if (completeStatus === 'failed') {
                                    const errorMsg = event.interaction?.error?.message || 'Research failed';
                                    throw new Error(`Research failed: ${errorMsg}`);
                                }
                            }
                            
                            // 检查错误事件（仅在研究未成功完成时处理）
                            // 有时会在 interaction.complete 后收到延迟的 error 事件（如 deadline_exceeded），
                            // 如果研究已成功完成则应忽略这些错误
                            if (event.event_type === 'error' && !isComplete) {
                                throw new Error(`Research failed: ${event.error?.message || 'Unknown error'}`);
                            }
                        }
                    }
                }
            } catch (streamError) {
                // 连接中断，尝试轮询获取结果
                if (!isComplete && interactionId && !signal?.aborted) {
                    console.log('[DeepResearchChannel] Stream error, will poll for results:', streamError.message);
                    return await this.pollForCompletion(interactionId, fullContent, fullReasoning, config, onUpdate, signal, baseUrl, headers, globalConfig);
                }
                if (!signal?.aborted) {
                    throw streamError;
                }
            }
            
            // 流正常结束但研究可能还没完成
            // Deep Research 任务在后台运行，流可能提前结束（只提供思考摘要）
            if (!isComplete && interactionId) {
                console.log('[DeepResearchChannel] Stream ended without interaction.complete, polling for results...');
                return await this.pollForCompletion(interactionId, fullContent, fullReasoning, config, onUpdate, signal, baseUrl, headers, globalConfig);
            }
            
            // 研究已完成，保存 interaction_id 用于后续问题
            if (interactionId) {
                this.saveInteractionId(interactionId);
            }
            
            return {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: fullContent || '研究已完成，但未返回内容。',
                        reasoning_content: fullReasoning || null
                    },
                    finish_reason: 'stop'
                }]
            };
        },
        
        /**
         * 保存交互 ID
         */
        saveInteractionId(interactionId) {
            try {
                const store = window.IdoFront && window.IdoFront.store;
                if (store) {
                    const conv = store.getActiveConversation();
                    if (conv) {
                        setPreviousInteractionId(store, conv.id, interactionId);
                    }
                }
            } catch (e) {
                console.warn('[DeepResearchChannel] Failed to save interaction ID:', e);
            }
        },
        
        /**
         * 处理续写（后续问题）的同步响应
         */
        async handleFollowUpResponse(response, onUpdate) {
            const data = await response.json();
            console.log('[DeepResearchChannel] Follow-up response:', data);
            
            // 提取输出
            let content = '';
            if (data.outputs && data.outputs.length > 0) {
                const lastOutput = data.outputs[data.outputs.length - 1];
                content = lastOutput.text || '';
            }
            
            // 更新 UI
            if (onUpdate && content) {
                onUpdate({ content: content, reasoning: null });
            }
            
            // 保存新的 interaction_id
            if (data.id) {
                this.saveInteractionId(data.id);
            }
            
            return {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: content || '未返回内容。'
                    },
                    finish_reason: 'stop'
                }]
            };
        },
        
        /**
         * 轮询等待研究完成
         */
        async pollForCompletion(interactionId, currentContent, currentReasoning, config, onUpdate, signal, baseUrl, headers, globalConfig) {
            console.log('[DeepResearchChannel] Starting poll for completion, interaction:', interactionId);
            
            const pollInterval = globalConfig.pollInterval || 10000;
            const maxTime = (globalConfig.maxResearchTime || 60) * 60 * 1000;
            const startTime = Date.now();
            
            let fullContent = currentContent;
            let fullReasoning = currentReasoning;
            let pollCount = 0;
            
            while (Date.now() - startTime < maxTime) {
                if (signal?.aborted) {
                    throw new Error('Research cancelled');
                }
                
                pollCount++;
                const elapsedSec = Math.round((Date.now() - startTime) / 1000);
                console.log(`[DeepResearchChannel] Poll attempt ${pollCount}, elapsed: ${elapsedSec}s`);
                
                // 更新状态显示
                const statusContent = fullContent || `🔬 研究进行中... (已等待 ${elapsedSec} 秒)\n\n*研究进度可在左侧"推理过程"中查看*`;
                onUpdate({
                    content: statusContent,
                    reasoning: fullReasoning || null
                });
                
                await delay(pollInterval);
                
                try {
                    const pollUrl = `${baseUrl}/interactions/${interactionId}`;
                    const pollResponse = await fetch(pollUrl, {
                        method: 'GET',
                        headers: headers,
                        signal: signal
                    });
                    
                    if (!pollResponse.ok) {
                        console.warn('[DeepResearchChannel] Poll request failed:', pollResponse.status);
                        continue;
                    }
                    
                    const result = await pollResponse.json();
                    console.log('[DeepResearchChannel] Poll result:', { status: result.status, outputsCount: result.outputs?.length || 0 });
                    
                    if (result.status === 'completed') {
                        console.log('[DeepResearchChannel] Research completed!');
                        
                        // 提取输出
                        const outputs = result.outputs || [];
                        let finalContent = '';
                        
                        for (const output of outputs) {
                            if (output.text) {
                                finalContent += output.text;
                            }
                        }
                        
                        // 如果有内容，使用轮询结果；否则使用流式积累的内容
                        if (finalContent) {
                            fullContent = finalContent;
                        }
                        
                        // 保存交互 ID
                        this.saveInteractionId(interactionId);
                        
                        // 最终更新
                        onUpdate({
                            content: fullContent,
                            reasoning: fullReasoning || null
                        });
                        
                        return {
                            choices: [{
                                message: {
                                    role: 'assistant',
                                    content: fullContent || '研究已完成。',
                                    reasoning_content: fullReasoning || null
                                },
                                finish_reason: 'stop'
                            }]
                        };
                    }
                    
                    if (result.status === 'failed') {
                        throw new Error(`Research failed: ${result.error || 'Unknown error'}`);
                    }
                    
                    // 状态为 in_progress，检查是否有部分输出
                    if (result.status === 'in_progress') {
                        if (result.outputs && result.outputs.length > 0) {
                            const latestOutput = result.outputs[result.outputs.length - 1];
                            if (latestOutput.text && latestOutput.text !== fullContent) {
                                fullContent = latestOutput.text;
                                onUpdate({
                                    content: fullContent,
                                    reasoning: fullReasoning || null
                                });
                            }
                        }
                    }
                    
                } catch (pollError) {
                    if (signal?.aborted) throw pollError;
                    console.warn('[DeepResearchChannel] Poll error:', pollError.message);
                }
            }
            
            // 超时
            throw new Error(`Research timed out after ${globalConfig.maxResearchTime} minutes`);
        },
        
        /**
         * 重连流式响应
         */
        async reconnectStream(interactionId, lastEventId, currentContent, currentReasoning, config, onUpdate, signal, baseUrl, headers, globalConfig) {
            const maxRetries = 5;
            let retryCount = 0;
            let fullContent = currentContent;
            let fullReasoning = currentReasoning;
            
            while (retryCount < maxRetries && !signal?.aborted) {
                retryCount++;
                await delay(2000); // 等待 2 秒后重试
                
                console.log(`[DeepResearchChannel] Reconnect attempt ${retryCount}/${maxRetries}...`);
                
                try {
                    let url = `${baseUrl}/interactions/${interactionId}?stream=true&alt=sse`;
                    if (lastEventId) {
                        url += `&last_event_id=${encodeURIComponent(lastEventId)}`;
                    }
                    
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: headers,
                        signal: signal
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Reconnect failed: ${response.status}`);
                    }
                    
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let buffer = '';
                    let isComplete = false;
                    
                    while (!isComplete) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data: ')) continue;
                            
                            const jsonStr = trimmed.substring(6);
                            const event = parseSSEEvent(jsonStr);
                            if (!event) continue;
                            
                            if (event.event_id) {
                                lastEventId = event.event_id;
                            }
                            
                            if (event.event_type === 'content.delta') {
                                if (event.delta?.type === 'text') {
                                    fullContent += event.delta.text || '';
                                    onUpdate({
                                        content: fullContent,
                                        reasoning: fullReasoning || null
                                    });
                                } else if (event.delta?.type === 'thought_summary') {
                                    const thoughtText = event.delta.content?.text || '';
                                    fullReasoning += `${thoughtText}\n`;
                                    onUpdate({
                                        content: fullContent,
                                        reasoning: fullReasoning
                                    });
                                }
                            }
                            
                            if (event.event_type === 'interaction.complete') {
                                isComplete = true;
                            }
                            
                            if (event.event_type === 'error') {
                                throw new Error(`Research failed: ${event.error?.message || 'Unknown error'}`);
                            }
                        }
                    }
                    
                    // 成功完成
                    return {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: fullContent,
                                reasoning_content: fullReasoning || null
                            },
                            finish_reason: 'stop'
                        }]
                    };
                    
                } catch (e) {
                    console.warn(`[DeepResearchChannel] Reconnect attempt ${retryCount} failed:`, e);
                    if (retryCount >= maxRetries) {
                        throw new Error(`Failed to reconnect after ${maxRetries} attempts`);
                    }
                }
            }
            
            throw new Error('Reconnection aborted');
        },
        
        /**
         * 处理轮询响应
         */
        async handlePollingResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig) {
            const data = await response.json();
            const interactionId = data.id;
            
            if (!interactionId) {
                throw new Error('No interaction ID returned');
            }
            
            console.log('[DeepResearchChannel] Polling for results, interaction ID:', interactionId);
            
            const pollInterval = globalConfig.pollInterval || 10000;
            const maxTime = (globalConfig.maxResearchTime || 60) * 60 * 1000; // 转换为毫秒
            const startTime = Date.now();
            
            while (Date.now() - startTime < maxTime) {
                if (signal?.aborted) {
                    throw new Error('Research cancelled');
                }
                
                await delay(pollInterval);
                
                try {
                    const pollUrl = `${baseUrl}/interactions/${interactionId}`;
                    const pollResponse = await fetch(pollUrl, {
                        method: 'GET',
                        headers: headers,
                        signal: signal
                    });
                    
                    if (!pollResponse.ok) {
                        console.warn('[DeepResearchChannel] Poll failed:', pollResponse.status);
                        continue;
                    }
                    
                    const result = await pollResponse.json();
                    
                    if (result.status === 'completed') {
                        console.log('[DeepResearchChannel] Research completed');
                        
                        // 提取最后一个输出
                        const outputs = result.outputs || [];
                        const lastOutput = outputs[outputs.length - 1];
                        const content = lastOutput?.text || '';
                        
                        // 保存 interaction_id
                        try {
                            const store = window.IdoFront && window.IdoFront.store;
                            if (store) {
                                const conv = store.getActiveConversation();
                                if (conv) {
                                    setPreviousInteractionId(store, conv.id, interactionId);
                                }
                            }
                        } catch (e) {
                            console.warn('[DeepResearchChannel] Failed to save interaction ID:', e);
                        }
                        
                        // 如果有 onUpdate 回调，更新内容
                        if (onUpdate) {
                            onUpdate({ content: content, reasoning: null });
                        }
                        
                        return {
                            choices: [{
                                message: {
                                    role: 'assistant',
                                    content: content
                                },
                                finish_reason: 'stop'
                            }]
                        };
                    }
                    
                    if (result.status === 'failed') {
                        throw new Error(`Research failed: ${result.error || 'Unknown error'}`);
                    }
                    
                    // 仍在进行中
                    console.log('[DeepResearchChannel] Research in progress...');
                    
                } catch (pollError) {
                    if (signal?.aborted) throw pollError;
                    console.warn('[DeepResearchChannel] Poll error:', pollError);
                }
            }
            
            throw new Error('Research timed out');
        },
        
        /**
         * 获取可用模型（Agent）列表
         * Deep Research 目前只有一个预览版 Agent
         * @param {Object} config - 渠道配置
         * @returns {Promise<Array>} - Agent 列表
         */
        async fetchModels(config) {
            // Deep Research 目前只支持预览版 Agent
            return [
                'deep-research-pro-preview-12-2025'
            ];
        }
    };

    // 注册到 channelRegistry
    if (registry) {
        registry.registerType(CHANNEL_ID, {
            adapter: adapter,
            label: 'Gemini Deep Research',
            source: 'core',
            version: '1.0.0',
            defaults: {
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                model: 'deep-research-pro-preview-12-2025'
            },
            capabilities: {
                streaming: true,
                vision: false  // Deep Research 不支持音频/多模态输入
            },
            metadata: {
                provider: 'google',
                docs: 'https://ai.google.dev/gemini-api/docs/deep-research',
                description: '多步骤研究任务，适用于市场分析、文献综述、竞品分析等场景'
            },
            icon: 'science'
        });
        console.log('[DeepResearchChannel] Registered as channel type:', CHANNEL_ID);
    } else {
        // 兼容旧版本
        window.IdoFront.channels[CHANNEL_ID] = adapter;
    }
    
    // ========== UI 插件：Deep Research 状态指示器 ==========
    
    function registerDeepResearchStatusPlugin() {
        if (typeof Framework === 'undefined' || !Framework || !Framework.registerPluginBundle) {
            console.warn('[DeepResearchChannel] Framework API not available for UI registration');
            return;
        }
        
        const { registerPluginBundle, SLOTS } = Framework;
        
        if (!SLOTS || !SLOTS.INPUT_TOP) {
            console.warn('[DeepResearchChannel] INPUT_TOP slot not available');
            return;
        }
        
        const WRAPPER_ID = 'core-deep-research-status-wrapper';
        
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
        
        let storeEventRegistered = false;
        
        /**
         * 更新状态显示
         */
        function updateStatusDisplay() {
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
            
            const channelConfig = getChannelConfig(store, conv);
            if (!channelConfig || channelConfig.type !== CHANNEL_ID) {
                wrapper.style.display = 'none';
                return;
            }
            
            // 显示 Deep Research 状态
            wrapper.style.display = 'flex';
            
            const meta = getDeepResearchMeta(conv);
            const statusEl = wrapper.querySelector('[data-dr-status]');
            const clearBtn = wrapper.querySelector('[data-dr-clear-btn]');
            
            if (statusEl) {
                if (meta.previousInteractionId) {
                    statusEl.textContent = '续写模式';
                    statusEl.title = `交互 ID: ${meta.previousInteractionId}\n点击清除可开始新的研究`;
                    statusEl.className = 'text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded';
                } else {
                    statusEl.textContent = '新研究';
                    statusEl.title = '将开始一个全新的深度研究任务';
                    statusEl.className = 'text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded';
                }
            }
            
            if (clearBtn) {
                clearBtn.style.display = meta.previousInteractionId ? 'inline-flex' : 'none';
            }
        }
        
        /**
         * 确保 store 事件监听器已注册
         */
        function ensureStoreEventRegistered() {
            if (storeEventRegistered) return;
            
            const store = getStore();
            if (store && store.events && typeof store.events.on === 'function') {
                store.events.on('updated', updateStatusDisplay);
                storeEventRegistered = true;
                setTimeout(() => updateStatusDisplay(), 0);
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
        
        // 使用 registerPluginBundle 注册 Deep Research 渠道 UI 组件
        // 使用 source: 'core' 标记为核心插件，不在插件管理中显示
        registerPluginBundle('core-deep-research-channel-ui', {
            meta: {
                name: 'Deep Research 渠道 UI',
                description: '显示 Gemini Deep Research 的研究状态',
                version: '1.0.0',
                icon: 'science',
                author: 'IdoFront',
                source: 'core'  // 核心插件，不在插件管理中显示
            },
            init: function() {
                ensureStoreEventRegistered();
            },
            slots: {
                [SLOTS.INPUT_TOP]: {
                    id: 'research-status',
                    render: function() {
                        ensureStoreEventRegistered();
                        
                        const wrapper = document.createElement('div');
                        wrapper.id = WRAPPER_ID;
                        wrapper.className = 'flex items-center gap-2';
                        wrapper.style.display = 'none';
                        
                        // 分隔线
                        const divider = document.createElement('div');
                        divider.className = 'h-5 w-px bg-gray-200';
                        wrapper.appendChild(divider);
                        
                        // 标签
                        const label = document.createElement('span');
                        label.className = 'text-[10px] text-gray-400';
                        label.textContent = '研究';
                        wrapper.appendChild(label);
                        
                        // 状态指示器
                        const statusEl = document.createElement('span');
                        statusEl.setAttribute('data-dr-status', 'true');
                        statusEl.className = 'text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded cursor-help';
                        statusEl.textContent = '新研究';
                        wrapper.appendChild(statusEl);
                        
                        // 清除按钮
                        const clearBtn = document.createElement('button');
                        clearBtn.type = 'button';
                        clearBtn.setAttribute('data-dr-clear-btn', 'true');
                        clearBtn.className = 'text-[10px] text-gray-400 hover:text-red-500 transition-colors';
                        clearBtn.title = '清除续写状态，开始新的研究';
                        clearBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">close</span>';
                        clearBtn.style.display = 'none';
                        clearBtn.onclick = (e) => {
                            e.stopPropagation();
                            const store = getStore();
                            if (!store) return;
                            const conv = store.getActiveConversation();
                            if (!conv) return;
                            clearPreviousInteractionId(store, conv.id);
                            updateStatusDisplay();
                        };
                        wrapper.appendChild(clearBtn);
                        
                        setTimeout(() => updateStatusDisplay(), 0);
                        setTimeout(() => updateStatusDisplay(), 100);
                        
                        return wrapper;
                    }
                }
            }
        });
    }
    
    // 自动注册 UI 插件
    registerDeepResearchStatusPlugin();
    
    // ========== 通用设置分区注册 ==========
    
    function registerDeepResearchSettingsSection() {
        if (!window.IdoFront || !window.IdoFront.settingsManager ||
            typeof window.IdoFront.settingsManager.registerGeneralSection !== 'function') {
            return;
        }
        
        try {
            const sm = window.IdoFront.settingsManager;
            sm.registerGeneralSection({
                id: 'deep-research',
                title: 'Deep Research 行为设置',
                description: '配置 Deep Research 的运行时行为参数',
                icon: 'science',
                order: 21,
                render: function(container) {
                    container.innerHTML = '';
                    
                    const config = loadGlobalConfig();
                    
                    // 思考摘要
                    const thinkingGroup = document.createElement('div');
                    thinkingGroup.className = 'ido-form-group';
                    
                    const thinkingLabel = document.createElement('div');
                    thinkingLabel.className = 'ido-form-label';
                    thinkingLabel.textContent = '思考摘要';
                    thinkingGroup.appendChild(thinkingLabel);
                    
                    const thinkingHint = document.createElement('div');
                    thinkingHint.className = 'text-[10px] text-gray-500 mb-1';
                    thinkingHint.textContent = '是否在流式输出中显示中间思考过程';
                    thinkingGroup.appendChild(thinkingHint);
                    
                    const thinkingSelect = document.createElement('select');
                    thinkingSelect.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';
                    
                    const thinkingOptions = [
                        { value: 'auto', label: '自动 (auto)' },
                        { value: 'none', label: '不显示 (none)' }
                    ];
                    
                    thinkingOptions.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        option.selected = config.thinkingSummaries === opt.value;
                        thinkingSelect.appendChild(option);
                    });
                    
                    thinkingSelect.onchange = () => {
                        const currentConfig = loadGlobalConfig();
                        currentConfig.thinkingSummaries = thinkingSelect.value;
                        saveGlobalConfig(currentConfig);
                    };
                    
                    thinkingGroup.appendChild(thinkingSelect);
                    container.appendChild(thinkingGroup);
                    
                    // 轮询间隔
                    const pollGroup = document.createElement('div');
                    pollGroup.className = 'ido-form-group mt-3';
                    
                    const pollLabel = document.createElement('div');
                    pollLabel.className = 'ido-form-label';
                    pollLabel.textContent = '轮询间隔（秒）';
                    pollGroup.appendChild(pollLabel);
                    
                    const pollHint = document.createElement('div');
                    pollHint.className = 'text-[10px] text-gray-500 mb-1';
                    pollHint.textContent = '非流式模式下检查研究进度的间隔';
                    pollGroup.appendChild(pollHint);
                    
                    const pollInput = document.createElement('input');
                    pollInput.type = 'number';
                    pollInput.min = '5';
                    pollInput.max = '60';
                    pollInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';
                    pollInput.value = String(config.pollInterval / 1000);
                    
                    pollInput.onchange = () => {
                        const currentConfig = loadGlobalConfig();
                        const val = parseInt(pollInput.value, 10);
                        currentConfig.pollInterval = (isNaN(val) ? 10 : Math.max(5, Math.min(60, val))) * 1000;
                        saveGlobalConfig(currentConfig);
                    };
                    
                    pollGroup.appendChild(pollInput);
                    container.appendChild(pollGroup);
                    
                    // 最大研究时间
                    const maxTimeGroup = document.createElement('div');
                    maxTimeGroup.className = 'ido-form-group mt-3';
                    
                    const maxTimeLabel = document.createElement('div');
                    maxTimeLabel.className = 'ido-form-label';
                    maxTimeLabel.textContent = '最大研究时间（分钟）';
                    maxTimeGroup.appendChild(maxTimeLabel);
                    
                    const maxTimeHint = document.createElement('div');
                    maxTimeHint.className = 'text-[10px] text-gray-500 mb-1';
                    maxTimeHint.textContent = '研究任务的超时时间（官方限制为 60 分钟）';
                    maxTimeGroup.appendChild(maxTimeHint);
                    
                    const maxTimeInput = document.createElement('input');
                    maxTimeInput.type = 'number';
                    maxTimeInput.min = '5';
                    maxTimeInput.max = '60';
                    maxTimeInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';
                    maxTimeInput.value = String(config.maxResearchTime);
                    
                    maxTimeInput.onchange = () => {
                        const currentConfig = loadGlobalConfig();
                        const val = parseInt(maxTimeInput.value, 10);
                        currentConfig.maxResearchTime = isNaN(val) ? 60 : Math.max(5, Math.min(60, val));
                        saveGlobalConfig(currentConfig);
                    };
                    
                    maxTimeGroup.appendChild(maxTimeInput);
                    container.appendChild(maxTimeGroup);
                    
                    // 说明文字
                    const helpText = document.createElement('div');
                    helpText.className = 'text-[10px] text-gray-400 mt-4 p-3 bg-gray-50 rounded-lg';
                    helpText.innerHTML = `
                        <div class="font-medium text-gray-600 mb-1">💡 说明</div>
                        <ul class="list-disc list-inside space-y-1">
                            <li>这些是 Deep Research 的运行时行为参数，影响所有使用该渠道的会话</li>
                            <li>Agent/模型选择请在渠道配置中设置</li>
                            <li>轮询间隔和最大时间影响非流式模式的性能</li>
                            <li>思考摘要显示研究的中间推理过程</li>
                        </ul>
                    `;
                    container.appendChild(helpText);
                }
            });
        } catch (e) {
            console.warn('[DeepResearchChannel] registerDeepResearchSettingsSection error:', e);
        }
    }
    
    // 尝试立即注册
    registerDeepResearchSettingsSection();
    
    // 监听设置管理器就绪事件
    if (typeof document !== 'undefined') {
        try {
            document.addEventListener('IdoFrontSettingsReady', function() {
                registerDeepResearchSettingsSection();
            });
        } catch (e) {
            console.warn('[DeepResearchChannel] attach IdoFrontSettingsReady listener error:', e);
        }
    }
    
    // 暴露工具函数供外部使用
    window.IdoFront.deepResearchChannel.loadGlobalConfig = loadGlobalConfig;
    window.IdoFront.deepResearchChannel.saveGlobalConfig = saveGlobalConfig;
    window.IdoFront.deepResearchChannel.getDeepResearchMeta = getDeepResearchMeta;
    window.IdoFront.deepResearchChannel.setPreviousInteractionId = setPreviousInteractionId;
    window.IdoFront.deepResearchChannel.clearPreviousInteractionId = clearPreviousInteractionId;
    window.IdoFront.deepResearchChannel.DEFAULT_CONFIG = DEFAULT_CONFIG;

})();