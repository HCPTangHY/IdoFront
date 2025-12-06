/**
 * OpenAI Channel Adapter
 * Handles communication with OpenAI-compatible APIs
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channels = window.IdoFront.channels || {};

    const registry = window.IdoFront.channelRegistry;
    const CHANNEL_ID = 'openai';

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

            // 应用参数覆写
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                Object.assign(body, config.paramsOverride);
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

                    return {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: fullContent
                            }
                        }]
                    };
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
})();