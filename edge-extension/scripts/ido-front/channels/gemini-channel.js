/**
 * Gemini Channel Adapter
 * Handles communication with Google Gemini API
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channels = window.IdoFront.channels || {};

    const registry = window.IdoFront.channelRegistry;
    const CHANNEL_ID = 'gemini';

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
            
            if (Object.keys(generationConfig).length > 0) {
                body.generationConfig = generationConfig;
            }

            // Apply params override
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                Object.assign(body, config.paramsOverride);
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
                vision: true
            },
            metadata: {
                provider: 'google'
            }
        });
    } else {
        // Fallback for older versions or if registry is not available
        window.IdoFront.channels[CHANNEL_ID] = adapter;
    }
})();