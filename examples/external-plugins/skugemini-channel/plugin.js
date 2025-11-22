// ==UserScript==
// @name         SKU Gemini Channel
// @version      1.0.0
// @description  外部渠道插件示例 - 基于 Gemini API，但使用替换模式而非增量模式
// @author       IdoFront Team
// @homepage     https://
// @icon         smart_toy
// ==/UserScript==


(function() {
    'use strict';

    const PLUGIN_ID = 'skugemini-channel';
    const CHANNEL_ID = 'skugemini';

    // Helper: Convert Gemini parts to displayable content and reasoning
    function partsToContent(parts) {
        if (!parts || !Array.isArray(parts)) return { content: '', reasoning: null };
        
        let content = '';
        let reasoning = '';
        
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
                content += `\n![Generated Image](data:${mimeType};base64,${data})\n`;
            }
        }
        
        return {
            content,
            reasoning: reasoning || null
        };
    }

    // Helper: Convert message to Gemini format
    function convertMessages(messages) {
        const contents = [];
        let systemInstruction = undefined;

        for (const msg of messages) {
            if (msg.role === 'system') {
                const geminiData = msg.metadata?.gemini;
                systemInstruction = {
                    parts: geminiData?.parts || [{ text: msg.content || '' }]
                };
            } else {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                const geminiData = msg.metadata?.gemini;
                
                let parts = [];
                
                if (geminiData?.parts) {
                    parts = geminiData.parts;
                } else {
                    if (msg.content) {
                        parts.push({ text: msg.content });
                    }
                    
                    if (role === 'user' && msg.metadata?.attachments) {
                        for (const attachment of msg.metadata.attachments) {
                            if (attachment.type && attachment.type.startsWith('image/')) {
                                const base64Data = attachment.dataUrl.split(',')[1];
                                parts.push({
                                    inlineData: {
                                        mimeType: attachment.type,
                                        data: base64Data
                                    }
                                });
                            }
                        }
                    }
                }
                
                const geminiMsg = {
                    role: role,
                    parts: parts
                };
                
                if (geminiData?.thoughtSignature && role === 'model') {
                    geminiMsg.thoughtSignature = geminiData.thoughtSignature;
                }
                
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
         * @returns {Promise<Object>} - Response content
         */
        async call(messages, config, onUpdate) {
            let baseUrl = config.baseUrl;
            if (!baseUrl || !baseUrl.trim()) {
                baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
            }
            baseUrl = baseUrl.replace(/\/+$/, '');
            
            let model = config.model;
            if (model.startsWith('models/')) {
                model = model.substring(7);
            }

            const isStream = !!onUpdate;
            const action = isStream ? 'streamGenerateContent' : 'generateContent';
            
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

            const generationConfig = {};
            if (config.temperature !== undefined) generationConfig.temperature = parseFloat(config.temperature);
            if (config.topP !== undefined) generationConfig.topP = parseFloat(config.topP);
            if (config.maxTokens !== undefined) generationConfig.maxOutputTokens = parseInt(config.maxTokens);
            
            if (Object.keys(generationConfig).length > 0) {
                body.generationConfig = generationConfig;
            }

            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                Object.assign(body, config.paramsOverride);
            }

            const headers = {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey
            };

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
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMsg = `SKUgemini API Error ${response.status}`;
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
                    let lastParts = [];
                    let lastThoughtSignature = null;

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop();

                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed) continue;
                                
                                if (trimmed.startsWith('data: ')) {
                                    const jsonStr = trimmed.substring(6);
                                    if (jsonStr === '[DONE]') continue;

                                    try {
                                        const json = JSON.parse(jsonStr);
                                        const candidate = json.candidates?.[0];
                                        if (candidate && candidate.content && candidate.content.parts) {
                                            const newParts = candidate.content.parts;
                                            const thoughtSignature = candidate.thoughtSignature;
                                            
                                            // SKUgemini 特性：直接替换而非累积
                                            // 每次都传递完整的当前 parts，而不是累积的
                                            lastParts = newParts;
                                            lastThoughtSignature = thoughtSignature;
                                            
                                            const { content, reasoning } = partsToContent(newParts);
                                            
                                            const updateData = {
                                                content: content,
                                                reasoning: reasoning,
                                                metadata: {
                                                    gemini: {
                                                        parts: newParts,
                                                        thoughtSignature: thoughtSignature
                                                    }
                                                }
                                            };
                                            
                                            onUpdate(updateData);
                                        }
                                    } catch (e) {
                                        console.warn('Error parsing SKUgemini stream data:', e);
                                    }
                                }
                            }
                        }
                    } catch (streamError) {
                        console.error('Stream reading error:', streamError);
                        throw streamError;
                    }

                    const { content, reasoning } = partsToContent(lastParts);
                    
                    const result = {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: content,
                                reasoning_content: reasoning,
                                metadata: {
                                    gemini: {
                                        parts: lastParts,
                                        thoughtSignature: lastThoughtSignature
                                    }
                                }
                            }
                        }]
                    };
                    
                    return result;

                } else {
                    const data = await response.json();
                    const candidate = data.candidates?.[0];
                    const parts = candidate?.content?.parts || [];
                    const thoughtSignature = candidate?.thoughtSignature;
                    const { content, reasoning } = partsToContent(parts);
                    
                    const result = {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: content,
                                reasoning_content: reasoning,
                                metadata: {
                                    gemini: {
                                        parts: parts,
                                        thoughtSignature: thoughtSignature
                                    }
                                }
                            }
                        }]
                    };
                    
                    return result;
                }

            } catch (error) {
                console.error('SKUgemini Channel Error:', error);
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
                        const models = data.models.map(m => m.name.replace(/^models\//, ''));
                        allModels = allModels.concat(models);
                    }
                    
                    pageToken = data.nextPageToken;
                    
                } while (pageToken);

                return allModels.sort();
                
            } catch (error) {
                console.error('Fetch SKUgemini Models Error:', error);
                throw error;
            }
        }
    };

    // 插件初始化函数
    function init() {
        console.log('[SKUgemini Plugin] 正在初始化...');

        // 检查依赖
        if (!window.IdoFront || !window.IdoFront.channelRegistry) {
            console.error('[SKUgemini Plugin] channelRegistry 未找到，插件加载失败');
            return false;
        }

        // 注册渠道类型
        try {
            window.IdoFront.channelRegistry.registerType(CHANNEL_ID, {
                adapter: adapter,
                label: 'SKU Gemini',
                source: `plugin:${PLUGIN_ID}`,
                version: '1.0.0',
                defaults: {
                    baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
                },
                capabilities: {
                    streaming: true,
                    vision: true
                },
                metadata: {
                    provider: 'google',
                    description: 'SKU Gemini - 替换模式流式传输'
                }
            });

            console.log('[SKUgemini Plugin] 渠道类型注册成功');
            return true;
        } catch (error) {
            console.error('[SKUgemini Plugin] 注册失败:', error);
            return false;
        }
    }

    // 插件清理函数
    function cleanup() {
        console.log('[SKUgemini Plugin] 正在清理...');
        
        if (window.IdoFront && window.IdoFront.channelRegistry) {
            try {
                window.IdoFront.channelRegistry.unregisterType(CHANNEL_ID);
                console.log('[SKUgemini Plugin] 渠道类型已注销');
            } catch (error) {
                console.error('[SKUgemini Plugin] 注销失败:', error);
            }
        }
    }

    // 导出插件接口
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { init, cleanup };
    } else {
        window.SKUgeminiPlugin = { init, cleanup };
    }

    // 如果在浏览器环境中直接加载，自动初始化
    if (typeof window !== 'undefined' && window.IdoFront) {
        init();
    }
})();