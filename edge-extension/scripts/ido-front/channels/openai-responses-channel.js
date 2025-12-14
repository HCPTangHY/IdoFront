/**
 * OpenAI Responses Channel Adapter
 * Calls OpenAI Responses API (/v1/responses) and normalizes output to ChatCompletions-like shape
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channels = window.IdoFront.channels || {};
    window.IdoFront.openaiResponsesChannel = window.IdoFront.openaiResponsesChannel || {};

    const registry = window.IdoFront.channelRegistry;
    const utils = window.IdoFront.utils;
    const CHANNEL_ID = 'openai-responses';

    function normalizeBaseUrl(baseUrl) {
        let resolved = baseUrl;
        if (!resolved || !String(resolved).trim()) {
            resolved = 'https://api.openai.com/v1';
        }
        resolved = String(resolved).replace(/\/+$/, '');
        return resolved;
    }

    function applyCustomHeaders(headers, customHeaders) {
        if (!customHeaders || !Array.isArray(customHeaders)) return;
        customHeaders.forEach((header) => {
            if (header && header.key && header.value) {
                headers[String(header.key)] = String(header.value);
            }
        });
    }

    function normalizeSystemText(message) {
        if (!message) return '';
        const content = message.content;
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (!part || typeof part !== 'object') return '';
                    if (part.type === 'text' && typeof part.text === 'string') return part.text;
                    if (part.type === 'input_text' && typeof part.text === 'string') return part.text;
                    return '';
                })
                .filter(Boolean)
                .join('');
        }
        return '';
    }

    function buildResponsesInput(messages) {
        const systemChunks = [];
        const input = [];

        const safeMessages = Array.isArray(messages) ? messages : [];
        safeMessages.forEach((msg) => {
            if (!msg || typeof msg !== 'object') return;

            const role = msg.role;
            if (role === 'system') {
                const text = normalizeSystemText(msg);
                if (text && text.trim()) {
                    systemChunks.push(text.trim());
                }
                return;
            }

            if (role !== 'user' && role !== 'assistant') return;

            const parts = [];

            if (Array.isArray(msg.content)) {
                msg.content.forEach((part) => {
                    if (!part || typeof part !== 'object') return;

                    if (part.type === 'text' && typeof part.text === 'string') {
                        parts.push({ type: 'input_text', text: part.text });
                        return;
                    }

                    if (part.type === 'image_url') {
                        const url = (typeof part.image_url === 'string')
                            ? part.image_url
                            : part.image_url && typeof part.image_url.url === 'string'
                                ? part.image_url.url
                                : null;
                        if (url) {
                            parts.push({ type: 'input_image', image_url: url });
                        }
                        return;
                    }

                    if (part.type === 'input_text' && typeof part.text === 'string') {
                        parts.push({ type: 'input_text', text: part.text });
                        return;
                    }

                    if (part.type === 'input_image') {
                        const url = (typeof part.image_url === 'string') ? part.image_url : null;
                        if (url) {
                            parts.push({ type: 'input_image', image_url: url });
                        }
                        return;
                    }
                });
            } else if (typeof msg.content === 'string') {
                if (msg.content) {
                    parts.push({ type: 'input_text', text: msg.content });
                }
            }

            const attachments = msg.metadata && Array.isArray(msg.metadata.attachments)
                ? msg.metadata.attachments
                : null;
            if (attachments && attachments.length > 0) {
                attachments.forEach((attachment) => {
                    if (!attachment || typeof attachment !== 'object') return;
                    if (!attachment.type || typeof attachment.type !== 'string') return;
                    if (!attachment.type.startsWith('image/')) return;

                    const url = attachment.dataUrl || attachment.url || attachment.imageUrl;
                    if (typeof url === 'string' && url) {
                        parts.push({ type: 'input_image', image_url: url });
                    }
                });
            }

            if (parts.length === 0) return;
            input.push({
                role,
                content: parts
            });
        });

        const instructions = systemChunks.length > 0 ? systemChunks.join('\n\n') : null;
        return { instructions, input };
    }

    function extractTextFromResponseObject(responseObj) {
        if (!responseObj || typeof responseObj !== 'object') return '';

        if (typeof responseObj.output_text === 'string') {
            return responseObj.output_text;
        }

        // Some implementations may wrap the response object
        if (responseObj.response && typeof responseObj.response === 'object') {
            return extractTextFromResponseObject(responseObj.response);
        }

        const output = Array.isArray(responseObj.output) ? responseObj.output : null;
        if (!output) return '';

        let text = '';
        output.forEach((item) => {
            if (!item || typeof item !== 'object') return;

            if (item.type === 'message' && Array.isArray(item.content)) {
                item.content.forEach((part) => {
                    if (!part || typeof part !== 'object') return;
                    if (part.type === 'output_text' && typeof part.text === 'string') {
                        text += part.text;
                    }
                });
                return;
            }

            if (item.type === 'output_text' && typeof item.text === 'string') {
                text += item.text;
            }
        });

        return text;
    }

    function normalizeToChatCompletions(content, reasoning, raw) {
        const message = {
            role: 'assistant',
            content: content || ''
        };

        if (reasoning) {
            message.reasoning_content = reasoning;
        }

        const result = {
            choices: [{
                message
            }]
        };

        if (raw) {
            result._raw = raw;
        }

        return result;
    }

    async function parseSse(response, onEvent) {
        if (!response.body) {
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        let buffer = '';
        let currentEventName = null;
        let dataLines = [];

        const dispatch = () => {
            if (!currentEventName && dataLines.length === 0) return;

            const eventName = currentEventName;
            const dataText = dataLines.join('\n');

            currentEventName = null;
            dataLines = [];

            if (!dataText) return;

            if (dataText === '[DONE]') {
                onEvent({ eventName: eventName || 'done', data: '[DONE]' });
                return;
            }

            let json = null;
            try {
                json = JSON.parse(dataText);
            } catch (error) {
                onEvent({ eventName, data: dataText, parseError: error });
                return;
            }

            onEvent({ eventName, data: json });
        };

        const processLine = (rawLine) => {
            const line = rawLine.replace(/\r$/, '');

            if (line === '') {
                dispatch();
                return;
            }

            if (line.startsWith('event:')) {
                currentEventName = line.slice(6).trim();
                return;
            }

            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
                return;
            }

            // Ignore "id:", "retry:" and other fields
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            lines.forEach(processLine);
        }

        buffer += decoder.decode();
        buffer.split('\n').forEach(processLine);
        dispatch();
    }

    function getErrorMessageFromJson(errorJson, fallback) {
        if (!errorJson || typeof errorJson !== 'object') return fallback;
        if (errorJson.error && typeof errorJson.error === 'object' && typeof errorJson.error.message === 'string') {
            return errorJson.error.message;
        }
        if (typeof errorJson.message === 'string') return errorJson.message;
        return fallback;
    }

    const adapter = {
        async call(messages = [], config = {}, onUpdate, signal) {
            const baseUrl = normalizeBaseUrl(config.baseUrl);
            const endpoint = `${baseUrl}/responses`;
            const model = config.model;

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            };

            applyCustomHeaders(headers, config.customHeaders);

            const { instructions, input } = buildResponsesInput(messages);

            const body = {
                model,
                input,
                stream: !!onUpdate
            };

            if (instructions) {
                body.instructions = instructions;
            }

            if (typeof config.temperature === 'number') {
                body.temperature = config.temperature;
            }

            if (typeof config.topP === 'number') {
                body.top_p = config.topP;
            }

            // Merge overrides (deep)
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                if (utils && typeof utils.deepMerge === 'function') {
                    utils.deepMerge(body, config.paramsOverride);
                } else {
                    Object.assign(body, config.paramsOverride);
                }
            }

            // Compatibility mappings for common params from chat/completions
            if (config.paramsOverride && typeof config.paramsOverride === 'object') {
                const override = config.paramsOverride;

                if (override.reasoning_effort && (!body.reasoning || typeof body.reasoning !== 'object')) {
                    body.reasoning = { effort: override.reasoning_effort };
                } else if (override.reasoning_effort && body.reasoning && typeof body.reasoning === 'object' && !body.reasoning.effort) {
                    body.reasoning.effort = override.reasoning_effort;
                }

                if (typeof override.max_tokens === 'number' && typeof body.max_output_tokens !== 'number') {
                    body.max_output_tokens = override.max_tokens;
                }
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMsg = `API Error ${response.status}`;

                try {
                    const errorJson = JSON.parse(errorText);
                    errorMsg += `: ${getErrorMessageFromJson(errorJson, errorText)}`;
                } catch (error) {
                    errorMsg += `: ${errorText}`;
                }

                throw new Error(errorMsg);
            }

            const contentType = response.headers.get('content-type') || '';
            const isStream = contentType.includes('text/event-stream') && !!onUpdate;

            let fullContent = '';
            let fullReasoning = '';
            let rawCompletedResponse = null;

            if (isStream) {
                await parseSse(response, (evt) => {
                    if (!evt) return;
                    if (evt.data === '[DONE]') return;

                    if (evt.parseError) {
                        return;
                    }

                    const data = evt.data;
                    const eventType = (data && typeof data === 'object' && typeof data.type === 'string')
                        ? data.type
                        : evt.eventName;

                    if (data && typeof data === 'object') {
                        if (data.error) {
                            const msg = getErrorMessageFromJson(data, 'Unknown error');
                            throw new Error(msg);
                        }

                        // Primary: output text delta
                        if (eventType === 'response.output_text.delta' && typeof data.delta === 'string') {
                            fullContent += data.delta;
                            onUpdate({ content: fullContent, reasoning: fullReasoning || null });
                            return;
                        }

                        // Optional: reasoning delta (best-effort)
                        if ((eventType === 'response.reasoning_text.delta' || (eventType && eventType.includes('reasoning') && eventType.endsWith('.delta')))
                            && typeof data.delta === 'string') {
                            fullReasoning += data.delta;
                            onUpdate({ content: fullContent, reasoning: fullReasoning });
                            return;
                        }

                        // Completed event may carry the full response
                        if ((eventType === 'response.completed' || eventType === 'response.done') && data.response && typeof data.response === 'object') {
                            rawCompletedResponse = data.response;
                            const finalText = extractTextFromResponseObject(data.response);
                            if (finalText) {
                                fullContent = finalText;
                                onUpdate({ content: fullContent, reasoning: fullReasoning || null });
                            }
                            return;
                        }

                        // Failed events
                        if (eventType === 'response.failed') {
                            const msg = getErrorMessageFromJson(data, 'Response failed');
                            throw new Error(msg);
                        }
                    }
                });

                return normalizeToChatCompletions(fullContent, fullReasoning || null, rawCompletedResponse);
            }

            const data = await response.json();
            const content = extractTextFromResponseObject(data);
            const normalized = normalizeToChatCompletions(content, null, data);

            // If streaming was requested but server returned JSON, still push one update for UI sync
            if (onUpdate) {
                onUpdate({ content, reasoning: null });
            }

            return normalized;
        },

        async fetchModels(config) {
            const baseUrl = normalizeBaseUrl(config.baseUrl);
            const endpoint = `${baseUrl}/models`;

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            };

            applyCustomHeaders(headers, config.customHeaders);

            const response = await fetch(endpoint, {
                method: 'GET',
                headers
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`获取模型失败 ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (data && Array.isArray(data.data)) {
                return data.data.map((m) => m.id).sort();
            }
            return [];
        }
    };

    if (registry) {
        registry.registerType(CHANNEL_ID, {
            adapter,
            label: 'OpenAI Responses',
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
                docs: 'https://platform.openai.com/docs/api-reference/responses',
                description: 'Uses /v1/responses and adapts output to chat UI.'
            },
            icon: 'science'
        });
    } else {
        window.IdoFront.channels[CHANNEL_ID] = adapter;
    }
})();