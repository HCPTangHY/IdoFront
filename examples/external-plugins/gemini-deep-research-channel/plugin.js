// @name Gemini Deep Research Channel (External)
 // @version 1.0.0
 // @description 外部渠道插件：Gemini Deep Research（多步骤研究 / 续写 / 状态指示与行为设置）
 // @author IdoFront Team
 // @icon science

(function() {
    'use strict';

    const CHANNEL_ID = 'gemini-deep-research';

    // ====== 全局行为配置（存储在 Framework.storage）======
    const DEEP_RESEARCH_CONFIG_KEY = 'ido.deepResearch.config';

    const DEFAULT_CONFIG = {
        thinkingSummaries: 'auto', // 'auto' | 'none'
        pollInterval: 10000, // ms
        maxResearchTime: 60 // minutes
    };

    let cachedConfig = null;
    let cachedConfigPromise = null;

    function isPlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function deepMerge(target, source) {
        if (!isPlainObject(target) || !isPlainObject(source)) return target;
        Object.keys(source).forEach((key) => {
            const srcVal = source[key];
            const dstVal = target[key];
            if (isPlainObject(dstVal) && isPlainObject(srcVal)) {
                deepMerge(dstVal, srcVal);
            } else if (Array.isArray(srcVal)) {
                target[key] = srcVal.slice();
            } else {
                target[key] = srcVal;
            }
        });
        return target;
    }

    async function loadGlobalConfig() {
        if (cachedConfig) return cachedConfig;
        if (cachedConfigPromise) return cachedConfigPromise;

        cachedConfigPromise = (async () => {
            try {
                if (typeof Framework !== 'undefined' && Framework.storage && typeof Framework.storage.getItem === 'function') {
                    const saved = await Framework.storage.getItem(DEEP_RESEARCH_CONFIG_KEY, null);
                    if (saved && typeof saved === 'object') {
                        cachedConfig = { ...DEFAULT_CONFIG, ...saved };
                        return cachedConfig;
                    }
                }
            } catch (e) {
                console.warn('[DeepResearchExternal] Failed to load config:', e);
            } finally {
                cachedConfigPromise = null;
            }

            cachedConfig = { ...DEFAULT_CONFIG };
            return cachedConfig;
        })();

        return cachedConfigPromise;
    }

    async function saveGlobalConfig(nextConfig) {
        const normalized = {
            thinkingSummaries: nextConfig?.thinkingSummaries === 'none' ? 'none' : 'auto',
            pollInterval: typeof nextConfig?.pollInterval === 'number' ? nextConfig.pollInterval : DEFAULT_CONFIG.pollInterval,
            maxResearchTime: typeof nextConfig?.maxResearchTime === 'number' ? nextConfig.maxResearchTime : DEFAULT_CONFIG.maxResearchTime
        };

        cachedConfig = { ...DEFAULT_CONFIG, ...normalized };

        try {
            if (typeof Framework !== 'undefined' && Framework.storage && typeof Framework.storage.setItem === 'function') {
                await Framework.storage.setItem(DEEP_RESEARCH_CONFIG_KEY, cachedConfig);
            }
        } catch (e) {
            console.warn('[DeepResearchExternal] Failed to save config:', e);
        }

        return cachedConfig;
    }

    function createAbortError() {
        const err = new Error('Request aborted');
        err.name = 'AbortError';
        return err;
    }

    function throwIfAborted(signal) {
        if (signal && signal.aborted) {
            throw createAbortError();
        }
    }

    function delay(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal && signal.aborted) {
                reject(createAbortError());
                return;
            }

            const timer = setTimeout(() => {
                cleanup();
                resolve();
            }, ms);

            const onAbort = () => {
                cleanup();
                reject(createAbortError());
            };

            function cleanup() {
                clearTimeout(timer);
                if (signal && typeof signal.removeEventListener === 'function') {
                    try {
                        signal.removeEventListener('abort', onAbort);
                    } catch (e) {
                        // ignore
                    }
                }
            }

            if (signal && typeof signal.addEventListener === 'function') {
                try {
                    signal.addEventListener('abort', onAbort, { once: true });
                } catch (e) {
                    // ignore
                }
            }
        });
    }

    function parseSSEEvent(data) {
        if (!data || data === '[DONE]') return null;
        try {
            return JSON.parse(data);
        } catch (e) {
            console.warn('[DeepResearchExternal] Failed to parse SSE data:', data, e);
            return null;
        }
    }

    function getDeepResearchMeta(conv) {
        if (!conv) return {};
        return (conv.metadata && conv.metadata.deepResearch && typeof conv.metadata.deepResearch === 'object')
            ? conv.metadata.deepResearch
            : {};
    }

    async function setConversationDeepResearchMeta(convId, patch) {
        if (!convId) return;

        const conv = await IdoFront.store.getConversation(convId);
        if (!conv) return;

        const current = getDeepResearchMeta(conv);
        const next = { ...current, ...(patch || {}) };

        await IdoFront.store.updateConversationMetadata(convId, { deepResearch: next });
        await IdoFront.store.persist();
    }

    async function setPreviousInteractionIdForActiveConversation(interactionId) {
        try {
            const conv = await IdoFront.store.getActiveConversation();
            if (!conv) return;
            await setConversationDeepResearchMeta(conv.id, { previousInteractionId: interactionId });
        } catch (e) {
            console.warn('[DeepResearchExternal] Failed to save interaction ID:', e);
        }
    }

    async function clearPreviousInteractionIdForActiveConversation() {
        try {
            const conv = await IdoFront.store.getActiveConversation();
            if (!conv) return;
            await setConversationDeepResearchMeta(conv.id, { previousInteractionId: null });
        } catch (e) {
            console.warn('[DeepResearchExternal] Failed to clear interaction ID:', e);
        }
    }

    // ====== Deep Research Channel Adapter ======
    const adapter = {
        async call(messages, config, onUpdate, signal) {
            throwIfAborted(signal);

            let baseUrl = config.baseUrl;
            if (!baseUrl || !String(baseUrl).trim()) {
                baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
            }
            baseUrl = String(baseUrl).replace(/\/+$/, '');

            const globalConfig = await loadGlobalConfig();

            const agentName = config.model || 'deep-research-pro-preview-12-2025';

            // 获取会话元数据（previous_interaction_id）
            let deepResearchMeta = {};
            try {
                const conv = await IdoFront.store.getActiveConversation();
                if (conv) {
                    deepResearchMeta = getDeepResearchMeta(conv);
                }
            } catch (e) {
                console.warn('[DeepResearchExternal] Failed to get conversation metadata:', e);
            }

            // 使用最后一条 user 消息作为 input
            let inputText = '';
            let systemInstruction = '';

            for (const msg of (messages || [])) {
                if (msg.role === 'system') {
                    systemInstruction = msg.content || '';
                } else if (msg.role === 'user') {
                    inputText = msg.content || '';
                }
            }

            if (systemInstruction) {
                inputText = `${systemInstruction}\n\n${inputText}`;
            }

            const isFollowUp = !!deepResearchMeta.previousInteractionId;

            const body = {
                input: inputText,
                agent: agentName
            };

            if (!isFollowUp) {
                body.background = true;
                body.store = true;
            }

            const isStream = !!onUpdate && !isFollowUp;
            if (isStream) {
                body.stream = true;
                body.agent_config = {
                    type: 'deep-research',
                    thinking_summaries: globalConfig.thinkingSummaries || 'auto'
                };
            }

            if (isFollowUp) {
                body.previous_interaction_id = deepResearchMeta.previousInteractionId;
            }

            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                if (config.paramsOverride.tools) {
                    body.tools = config.paramsOverride.tools;
                }

                const { tools, ...otherParams } = config.paramsOverride;
                deepMerge(body, otherParams);
            }

            const headers = {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey
            };

            if (config.customHeaders && Array.isArray(config.customHeaders)) {
                config.customHeaders.forEach((header) => {
                    if (header && header.key && header.value) {
                        headers[header.key] = header.value;
                    }
                });
            }

            let url = `${baseUrl}/interactions`;
            if (isStream) {
                url += '?alt=sse';
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal
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
                return await this.handleFollowUpResponse(response, onUpdate, signal);
            }
            if (isStream) {
                return await this.handleStreamResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig);
            }
            return await this.handlePollingResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig);
        },

        async handleFollowUpResponse(response, onUpdate, signal) {
            throwIfAborted(signal);

            const data = await response.json();

            let content = '';
            if (data.outputs && data.outputs.length > 0) {
                const lastOutput = data.outputs[data.outputs.length - 1];
                content = lastOutput.text || '';
            }

            if (onUpdate && content) {
                onUpdate({ content, reasoning: null });
            }

            if (data.id) {
                await setPreviousInteractionIdForActiveConversation(data.id);
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

        async handleStreamResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let fullContent = '';
            let fullReasoning = '';
            let interactionId = null;
            let isComplete = false;

            try {
                while (true) {
                    throwIfAborted(signal);

                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        if (trimmed === 'data: [DONE]') {
                            continue;
                        }

                        if (!trimmed.startsWith('data: ')) continue;

                        const jsonStr = trimmed.substring(6);
                        const event = parseSSEEvent(jsonStr);
                        if (!event) continue;

                        if (event.event_type === 'interaction.start' && event.interaction && event.interaction.id) {
                            interactionId = event.interaction.id;
                            if (onUpdate) {
                                onUpdate({
                                    content: '🔬 深度研究任务已启动，正在规划研究步骤...\n\n*研究进度可在左侧“推理过程”中查看*',
                                    reasoning: fullReasoning || null
                                });
                            }
                        }

                        if (event.event_type === 'content.delta') {
                            if (event.delta && event.delta.type === 'text') {
                                fullContent += event.delta.text || '';
                                onUpdate && onUpdate({
                                    content: fullContent,
                                    reasoning: fullReasoning || null
                                });
                            } else if (event.delta && event.delta.type === 'thought_summary') {
                                const thoughtText = (event.delta.content && event.delta.content.text) ? event.delta.content.text : '';
                                fullReasoning += thoughtText + '\n\n';
                                const displayContent = fullContent || '🔬 正在研究中...\n\n*研究进度可在左侧“推理过程”中查看*';
                                onUpdate && onUpdate({
                                    content: displayContent,
                                    reasoning: fullReasoning
                                });
                            }
                        }

                        if (event.event_type === 'interaction.complete') {
                            isComplete = true;
                            const completeStatus = event.interaction && event.interaction.status ? event.interaction.status : 'unknown';
                            if (completeStatus === 'failed') {
                                const errorMsg = event.interaction && event.interaction.error && event.interaction.error.message
                                    ? event.interaction.error.message
                                    : 'Research failed';
                                throw new Error(`Research failed: ${errorMsg}`);
                            }
                        }

                        if (event.event_type === 'error' && !isComplete) {
                            const msg = event.error && event.error.message ? event.error.message : 'Unknown error';
                            throw new Error(`Research failed: ${msg}`);
                        }
                    }
                }
            } catch (streamError) {
                // Abort 直接抛出，走上层统一取消逻辑
                if (streamError && streamError.name === 'AbortError') throw streamError;

                // 其他错误：若已有 interactionId，则尝试轮询拿最终结果
                if (!isComplete && interactionId && !(signal && signal.aborted)) {
                    return await this.pollForCompletion(interactionId, fullContent, fullReasoning, config, onUpdate, signal, baseUrl, headers, globalConfig);
                }
                throw streamError;
            }

            if (!isComplete && interactionId) {
                return await this.pollForCompletion(interactionId, fullContent, fullReasoning, config, onUpdate, signal, baseUrl, headers, globalConfig);
            }

            if (interactionId) {
                await setPreviousInteractionIdForActiveConversation(interactionId);
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

        async pollForCompletion(interactionId, currentContent, currentReasoning, config, onUpdate, signal, baseUrl, headers, globalConfig) {
            const pollInterval = globalConfig.pollInterval || 10000;
            const maxTime = (globalConfig.maxResearchTime || 60) * 60 * 1000;
            const startTime = Date.now();

            let fullContent = currentContent || '';
            let fullReasoning = currentReasoning || '';
            let pollCount = 0;

            while (Date.now() - startTime < maxTime) {
                throwIfAborted(signal);

                pollCount += 1;
                const elapsedSec = Math.round((Date.now() - startTime) / 1000);

                if (onUpdate) {
                    const statusContent = fullContent || `🔬 研究进行中... (已等待 ${elapsedSec} 秒)\n\n*研究进度可在左侧“推理过程”中查看*`;
                    onUpdate({
                        content: statusContent,
                        reasoning: fullReasoning || null
                    });
                }

                await delay(pollInterval, signal);

                const pollUrl = `${baseUrl}/interactions/${encodeURIComponent(interactionId)}`;
                let pollResponse;
                try {
                    pollResponse = await fetch(pollUrl, { method: 'GET', headers, signal });
                } catch (e) {
                    if (e && e.name === 'AbortError') throw e;
                    continue;
                }

                if (!pollResponse.ok) {
                    continue;
                }

                let result;
                try {
                    result = await pollResponse.json();
                } catch (e) {
                    continue;
                }

                if (result.status === 'completed') {
                    const outputs = result.outputs || [];
                    let finalContent = '';
                    for (const output of outputs) {
                        if (output && output.text) finalContent += output.text;
                    }
                    if (finalContent) {
                        fullContent = finalContent;
                    }

                    await setPreviousInteractionIdForActiveConversation(interactionId);

                    onUpdate && onUpdate({
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

                if (result.status === 'in_progress') {
                    if (result.outputs && result.outputs.length > 0) {
                        const latestOutput = result.outputs[result.outputs.length - 1];
                        if (latestOutput && latestOutput.text && latestOutput.text !== fullContent) {
                            fullContent = latestOutput.text;
                            onUpdate && onUpdate({
                                content: fullContent,
                                reasoning: fullReasoning || null
                            });
                        }
                    }
                }
            }

            throw new Error(`Research timed out after ${globalConfig.maxResearchTime || 60} minutes`);
        },

        async handlePollingResponse(response, config, onUpdate, signal, baseUrl, headers, globalConfig) {
            throwIfAborted(signal);

            const data = await response.json();
            const interactionId = data.id;

            if (!interactionId) {
                throw new Error('No interaction ID returned');
            }

            return await this.pollForCompletion(interactionId, '', '', config, onUpdate, signal, baseUrl, headers, globalConfig);
        },

        async fetchModels(config) {
            return [
                'deep-research-pro-preview-12-2025'
            ];
        }
    };

    // ====== Channel 注册 ======
    if (!IdoFront || !IdoFront.channelRegistry || typeof IdoFront.channelRegistry.registerType !== 'function') {
        console.warn('[DeepResearchExternal] IdoFront.channelRegistry not available');
        return;
    }

    IdoFront.channelRegistry.registerType(CHANNEL_ID, {
        adapter,
        label: 'Gemini Deep Research',
        version: '1.0.0',
        defaults: {
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            model: 'deep-research-pro-preview-12-2025'
        },
        capabilities: {
            streaming: true,
            vision: false
        },
        metadata: {
            provider: 'google',
            docs: 'https://ai.google.dev/gemini-api/docs/deep-research',
            description: '多步骤研究任务，适用于市场分析、文献综述、竞品分析等场景'
        },
        icon: 'science',
        description: 'Gemini Deep Research（Interactions API）'
    });

    // ====== UI：INPUT_TOP 状态指示器 + 行为设置入口（BottomSheet）======
    (function registerStatusIndicator() {
        if (!Framework || typeof Framework.registerPluginBundle !== 'function' || !Framework.SLOTS) return;

        const { SLOTS } = Framework;
        const SLOT = SLOTS.INPUT_TOP;
        if (!SLOT) return;

        const BUNDLE_ID = 'deep-research-ui';
        const COMPONENT_ID = 'deep-research-status';

        let unsubscribe = null;

        let viewState = {
            visible: false,
            isFollowUp: false,
            previousInteractionId: null
        };

        let updateInFlight = false;
        let pendingEventContext = null;

        /**
         * 同步刷新插槽（无 setTimeout 延迟）
         */
        function triggerSlotRefresh() {
            if (Framework && typeof Framework.refreshSlot === 'function') {
                Framework.refreshSlot(SLOT);
            }
        }

        function computeNextViewState(state, conv) {
            if (!state || !conv) {
                return { visible: false, isFollowUp: false, previousInteractionId: null };
            }

            const channel = Array.isArray(state.channels)
                ? state.channels.find(c => c && c.id === conv.selectedChannelId)
                : null;

            if (!channel || channel.type !== CHANNEL_ID) {
                return { visible: false, isFollowUp: false, previousInteractionId: null };
            }

            const meta = getDeepResearchMeta(conv);
            const prevId = meta.previousInteractionId || null;

            return {
                visible: true,
                isFollowUp: !!prevId,
                previousInteractionId: prevId
            };
        }

        /**
         * 刷新视图状态（同步快速路径）
         * @param {Object} eventContext - 可选的事件上下文（从 store 'updated' 事件附带）
         */
        function refreshViewState(eventContext) {
            // 如果已有更新在进行，保存最新的上下文以便稍后使用
            if (updateInFlight) {
                pendingEventContext = eventContext || pendingEventContext;
                return;
            }
            updateInFlight = true;
            
            try {
                let next;
                
                // 优先使用事件附带的上下文，避免异步查询延迟
                if (eventContext && eventContext.__context) {
                    const ctx = eventContext.__context;
                    
                    // 快速路径：直接使用上下文信息判断是否显示
                    if (ctx.activeChannelType !== CHANNEL_ID) {
                        next = { visible: false, isFollowUp: false, previousInteractionId: null };
                    } else {
                        // 渠道类型匹配，从 metadata 中提取 deepResearch 信息
                        const meta = ctx.activeConversationMetadata && ctx.activeConversationMetadata.deepResearch
                            ? ctx.activeConversationMetadata.deepResearch
                            : {};
                        const prevId = meta.previousInteractionId || null;
                        
                        next = {
                            visible: true,
                            isFollowUp: !!prevId,
                            previousInteractionId: prevId
                        };
                    }
                } else {
                    // 无上下文时使用当前 viewState，不做异步查询
                    // 只有初始化时才需要异步加载
                    next = viewState;
                }

                const changed =
                    next.visible !== viewState.visible ||
                    next.isFollowUp !== viewState.isFollowUp ||
                    next.previousInteractionId !== viewState.previousInteractionId;

                viewState = next;

                if (changed) {
                    // 同步刷新，无延迟
                    triggerSlotRefresh();
                }
            } catch (e) {
                // ignore
            } finally {
                updateInFlight = false;
                
                // 处理排队的更新
                if (pendingEventContext !== null) {
                    const ctx = pendingEventContext;
                    pendingEventContext = null;
                    refreshViewState(ctx);
                }
            }
        }
        
        /**
         * 初始加载状态（异步）
         */
        async function initViewState() {
            try {
                const state = await IdoFront.store.getState();
                const conv = await IdoFront.store.getActiveConversation();
                const next = computeNextViewState(state, conv);
                
                const changed =
                    next.visible !== viewState.visible ||
                    next.isFollowUp !== viewState.isFollowUp ||
                    next.previousInteractionId !== viewState.previousInteractionId;
                
                viewState = next;
                
                if (changed) {
                    triggerSlotRefresh();
                }
            } catch (e) {
                // ignore
            }
        }

        async function openSettingsSheet() {
            const cfg = await loadGlobalConfig();

            Framework.showBottomSheet((container) => {
                container.innerHTML = '';

                const header = document.createElement('div');
                header.className = 'px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white';

                const title = document.createElement('h3');
                title.className = 'text-lg font-semibold text-gray-800';
                title.textContent = 'Deep Research 行为设置';

                const closeBtn = document.createElement('button');
                closeBtn.className = 'text-gray-400 hover:text-gray-600 transition-colors';
                closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                closeBtn.onclick = () => Framework.hideBottomSheet();

                header.appendChild(title);
                header.appendChild(closeBtn);

                const body = document.createElement('div');
                body.className = 'flex-1 overflow-y-auto px-6 py-4';

                const form = document.createElement('div');
                form.className = 'space-y-4';

                // thinking summaries
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

                [
                    { value: 'auto', label: '自动 (auto)' },
                    { value: 'none', label: '不显示 (none)' }
                ].forEach(opt => {
                    const option = document.createElement('option');
                    option.setAttribute('value', opt.value);
                    option.textContent = opt.label;
                    // 使用 setAttribute 设置 selected，因为 innerHTML 序列化不会包含 DOM 属性
                    if (cfg.thinkingSummaries === opt.value) {
                        option.setAttribute('selected', '');
                    }
                    thinkingSelect.appendChild(option);
                });

                thinkingSelect.onchange = async () => {
                    const next = await saveGlobalConfig({
                        ...cfg,
                        thinkingSummaries: thinkingSelect.value
                    });
                    Object.assign(cfg, next);
                };

                thinkingGroup.appendChild(thinkingSelect);

                // poll interval
                const pollGroup = document.createElement('div');
                pollGroup.className = 'ido-form-group';

                const pollLabel = document.createElement('div');
                pollLabel.className = 'ido-form-label';
                pollLabel.textContent = '轮询间隔（秒）';
                pollGroup.appendChild(pollLabel);

                const pollHint = document.createElement('div');
                pollHint.className = 'text-[10px] text-gray-500 mb-1';
                pollHint.textContent = '非流式/流式结束后的后台任务检查间隔';
                pollGroup.appendChild(pollHint);

                const pollInput = document.createElement('input');
                pollInput.setAttribute('type', 'number');
                pollInput.setAttribute('min', '5');
                pollInput.setAttribute('max', '60');
                pollInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';
                // 使用 setAttribute 设置 value，因为 innerHTML 序列化不会包含 DOM 属性
                pollInput.setAttribute('value', String(Math.round((cfg.pollInterval || 10000) / 1000)));

                pollInput.onchange = async () => {
                    const val = parseInt(pollInput.value, 10);
                    const nextSec = Number.isFinite(val) ? Math.max(5, Math.min(60, val)) : 10;
                    const next = await saveGlobalConfig({
                        ...cfg,
                        pollInterval: nextSec * 1000
                    });
                    Object.assign(cfg, next);
                };

                pollGroup.appendChild(pollInput);

                // max time
                const maxGroup = document.createElement('div');
                maxGroup.className = 'ido-form-group';

                const maxLabel = document.createElement('div');
                maxLabel.className = 'ido-form-label';
                maxLabel.textContent = '最大研究时间（分钟）';
                maxGroup.appendChild(maxLabel);

                const maxHint = document.createElement('div');
                maxHint.className = 'text-[10px] text-gray-500 mb-1';
                maxHint.textContent = '研究任务的超时时间（官方限制为 60 分钟）';
                maxGroup.appendChild(maxHint);

                const maxInput = document.createElement('input');
                maxInput.setAttribute('type', 'number');
                maxInput.setAttribute('min', '5');
                maxInput.setAttribute('max', '60');
                maxInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';
                // 使用 setAttribute 设置 value，因为 innerHTML 序列化不会包含 DOM 属性
                maxInput.setAttribute('value', String(cfg.maxResearchTime || 60));

                maxInput.onchange = async () => {
                    const val = parseInt(maxInput.value, 10);
                    const nextMin = Number.isFinite(val) ? Math.max(5, Math.min(60, val)) : 60;
                    const next = await saveGlobalConfig({
                        ...cfg,
                        maxResearchTime: nextMin
                    });
                    Object.assign(cfg, next);
                };

                maxGroup.appendChild(maxInput);

                form.appendChild(thinkingGroup);
                form.appendChild(pollGroup);
                form.appendChild(maxGroup);

                const help = document.createElement('div');
                help.className = 'text-[10px] text-gray-400 mt-2 p-3 bg-gray-50 rounded-lg';
                help.innerHTML = `
                    <div class="font-medium text-gray-600 mb-1">💡 说明</div>
                    <ul class="list-disc list-inside space-y-1">
                        <li>这些是 Deep Research 的运行时行为参数，影响所有使用该渠道的会话</li>
                        <li>Agent/模型选择请在渠道配置中设置</li>
                        <li>轮询间隔和最大时间影响后台轮询性能与等待体验</li>
                    </ul>
                `;

                body.appendChild(form);
                body.appendChild(help);

                container.appendChild(header);
                container.appendChild(body);
            });
        }

        function renderStatus() {
            const wrapper = document.createElement('div');
            wrapper.className = 'flex items-center gap-2';
            wrapper.style.display = viewState.visible ? 'flex' : 'none';

            const divider = document.createElement('div');
            divider.className = 'h-5 w-px bg-gray-200';
            wrapper.appendChild(divider);

            const label = document.createElement('span');
            label.className = 'text-[10px] text-gray-400';
            label.textContent = '研究';
            wrapper.appendChild(label);

            const status = document.createElement('span');
            status.className = viewState.isFollowUp
                ? 'text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded cursor-help'
                : 'text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded cursor-help';
            status.textContent = viewState.isFollowUp ? '续写模式' : '新研究';
            status.title = viewState.isFollowUp && viewState.previousInteractionId
                ? `交互 ID: ${viewState.previousInteractionId}\n点击清除可开始新的研究`
                : '将开始一个全新的深度研究任务';
            wrapper.appendChild(status);

            const btnGroup = document.createElement('div');
            btnGroup.className = 'flex items-center gap-1';

            // 设置按钮（齿轮）
            const settingsBtn = Framework.ui.createIconButton({
                icon: 'tune',
                title: 'Deep Research 行为设置',
                className: 'ido-btn ido-btn--ghost p-1 text-gray-400 hover:text-gray-600',
                iconClassName: 'material-symbols-outlined text-[14px]',
                onClick: () => {
                    openSettingsSheet().catch((e) => console.warn('[DeepResearchExternal] openSettingsSheet error:', e));
                }
            });
            btnGroup.appendChild(settingsBtn);

            // 清除按钮（仅续写模式显示）
            if (viewState.isFollowUp) {
                const clearBtn = Framework.ui.createIconButton({
                    icon: 'close',
                    title: '清除续写状态，开始新的研究',
                    className: 'ido-btn ido-btn--ghost p-1 text-gray-400 hover:text-red-500',
                    iconClassName: 'material-symbols-outlined text-[14px]',
                    onClick: () => {
                        clearPreviousInteractionIdForActiveConversation()
                            .then(() => refreshViewState())
                            .catch((e) => console.warn('[DeepResearchExternal] clear error:', e));
                    }
                });
                btnGroup.appendChild(clearBtn);
            }

            wrapper.appendChild(btnGroup);

            return wrapper;
        }

        Framework.registerPluginBundle(BUNDLE_ID, {
            meta: {
                name: 'Deep Research 渠道 UI',
                description: '显示 Gemini Deep Research 的研究状态，并提供行为设置入口',
                version: '1.0.0',
                icon: 'science'
            },
            init: function() {
                // 初始加载使用异步方式
                initViewState();
                
                // 后续更新使用同步快速路径
                if (IdoFront && IdoFront.store && IdoFront.store.events && typeof IdoFront.store.events.on === 'function') {
                    unsubscribe = IdoFront.store.events.on('updated', (eventData) => {
                        // 利用事件附带的上下文信息，同步刷新
                        refreshViewState(eventData);
                    });
                }
            },
            destroy: function() {
                if (typeof unsubscribe === 'function') {
                    try {
                        unsubscribe();
                    } catch (e) {
                        // ignore
                    }
                }
                unsubscribe = null;
            },
            slots: {
                [SLOT]: {
                    id: COMPONENT_ID,
                    render: function() {
                        return renderStatus();
                    }
                }
            }
        });
    })();

    console.log('[DeepResearchExternal] Registered channel type:', CHANNEL_ID);
})();