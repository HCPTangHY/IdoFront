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
        budgetModelPattern: 'gemini-2\\.5(?!.*-image)|gemini-2-5(?!.*-image)',
        // 使用 thinkingLevel (low/high) 的模型匹配规则
        // 排除 gemini-3-pro-image 系列（图像生成模型不支持思考功能）
        levelModelPattern: 'gemini-3(?!.*-pro-image)'
    };

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

    // ========== Gemini Image Generation Configuration ==========
    
    // 图像生成模型匹配规则存储键
    const IMAGE_GEN_RULES_STORAGE_KEY = 'ido.gemini.imageGenRules';
    
    // 默认图像生成模型匹配规则
    const DEFAULT_IMAGE_GEN_RULES = {
        // 支持图像生成的模型匹配规则
        imageModelPattern: 'gemini-.*-image|imagen',
        // 支持 imageSize (2K/4K) 的模型匹配规则 (Gemini 3 Pro Image)
        imageSizeModelPattern: 'gemini-3.*-image'
    };
    
    // 宽高比选项
    const ASPECT_RATIO_OPTIONS = [
        { value: '1:1', label: '1:1', description: '正方形', icon: 'crop_square' },
        { value: '16:9', label: '16:9', description: '横向宽屏', icon: 'crop_16_9' },
        { value: '9:16', label: '9:16', description: '纵向竖屏', icon: 'crop_9_16' },
        { value: '4:3', label: '4:3', description: '横向标准', icon: 'crop_landscape' },
        { value: '3:4', label: '3:4', description: '纵向标准', icon: 'crop_portrait' },
        { value: '3:2', label: '3:2', description: '横向照片', icon: 'crop_landscape' },
        { value: '2:3', label: '2:3', description: '纵向照片', icon: 'crop_portrait' },
        { value: '21:9', label: '21:9', description: '超宽屏', icon: 'panorama' }
    ];
    
    // 图片大小选项（仅 Gemini 3 Pro Image 支持）
    const IMAGE_SIZE_OPTIONS = [
        { value: '1K', label: '1K', description: '标准分辨率' },
        { value: '2K', label: '2K', description: '高清分辨率' },
        { value: '4K', label: '4K', description: '超高清分辨率' }
    ];

    // 响应模态选项
    const RESPONSE_MODALITY_OPTIONS = [
        { value: 'default', label: '默认', description: '文本和图片', icon: 'auto_awesome' },
        { value: 'image', label: '仅图片', description: '只返回图片', icon: 'image' }
    ];
    
    // ========== 通用规则加载/保存/匹配工具 ==========
    const rulesCache = {};
    
    function loadRules(storageKey, defaults) {
        if (rulesCache[storageKey]) return rulesCache[storageKey];
        try {
            const saved = Framework?.storage?.getItem(storageKey);
            if (saved && typeof saved === 'object') {
                rulesCache[storageKey] = { ...defaults };
                for (const key of Object.keys(defaults)) {
                    rulesCache[storageKey][key] = saved[key] || defaults[key];
                }
                return rulesCache[storageKey];
            }
        } catch (e) { /* ignore */ }
        return { ...defaults };
    }
    
    function saveRules(storageKey, rules) {
        try {
            Framework?.storage?.setItem(storageKey, rules);
            rulesCache[storageKey] = { ...rules };
        } catch (e) { /* ignore */ }
    }
    
    function matchModel(modelName, pattern) {
        if (!modelName || !pattern) return false;
        try { return new RegExp(pattern, 'i').test(modelName); }
        catch (e) { return false; }
    }
    
    // 图像生成规则
    const loadImageGenRules = () => loadRules(IMAGE_GEN_RULES_STORAGE_KEY, DEFAULT_IMAGE_GEN_RULES);
    const saveImageGenRules = (rules) => saveRules(IMAGE_GEN_RULES_STORAGE_KEY, rules);
    const supportsImageGeneration = (model) => matchModel(model, loadImageGenRules().imageModelPattern);
    const supportsImageSize = (model) => matchModel(model, loadImageGenRules().imageSizeModelPattern);
    
    /**
     * 获取会话的图像生成配置
     */
    function getImageGenConfig(conv) {
        if (!conv) {
            return {
                aspectRatio: 'auto',
                imageSize: '1K',
                responseModality: 'default',
                forceThinking: false
            };
        }
        const geminiMeta = conv.metadata?.gemini || {};
        return {
            aspectRatio: geminiMeta.imageAspectRatio || 'auto',
            imageSize: geminiMeta.imageSize || '1K',
            responseModality: geminiMeta.responseModality || 'default',
            // 生图请求思维链：默认开启，用于获取 thoughtSignature
            forceThinking: geminiMeta.imageForceThinking !== false
        };
    }
    
    /**
     * 设置会话的图像宽高比
     */
    /**
     * 通用 Gemini 元数据设置器
     * @param {Object} store - Store 实例
     * @param {string} convId - 会话 ID
     * @param {string} key - 元数据键名
     * @param {*} value - 值
     * @param {Object} [options] - 选项 { silent: boolean }
     */
    function setGeminiMeta(store, convId, key, value, options) {
        if (!store || !convId) return;
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;
        
        if (!conv.metadata) conv.metadata = {};
        if (!conv.metadata.gemini) conv.metadata.gemini = {};
        conv.metadata.gemini[key] = value;
        
        const persistFn = options?.silent ? store.persistSilent : store.persist;
        if (typeof persistFn === 'function') persistFn.call(store);
    }
    
    // 图像生成设置器
    const setImageAspectRatio = (store, convId, val, opts) => setGeminiMeta(store, convId, 'imageAspectRatio', val, opts);
    const setImageSize = (store, convId, val, opts) => setGeminiMeta(store, convId, 'imageSize', val, opts);
    const setResponseModality = (store, convId, val, opts) => setGeminiMeta(store, convId, 'responseModality', val, opts);
    const setImageForceThinking = (store, convId, val, opts) => setGeminiMeta(store, convId, 'imageForceThinking', !!val, opts);

    // 思考规则
    const loadGlobalThinkingRules = () => loadRules(THINKING_RULES_STORAGE_KEY, DEFAULT_THINKING_RULES);
    const saveGlobalThinkingRules = (rules) => saveRules(THINKING_RULES_STORAGE_KEY, rules);
    const useBudgetMode = (model) => matchModel(model, loadGlobalThinkingRules().budgetModelPattern);
    const useLevelMode = (model) => matchModel(model, loadGlobalThinkingRules().levelModelPattern);

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

    // 思考设置器
    const setThinkingBudget = (store, convId, val) => setGeminiMeta(store, convId, 'thinkingBudget', val);
    const setThinkingLevel = (store, convId, val) => setGeminiMeta(store, convId, 'thinkingLevel', val);
    
    // 工具设置器
    const setCodeExecution = (store, convId, val, opts) => setGeminiMeta(store, convId, 'codeExecution', val, opts);
    const setGoogleSearch = (store, convId, val, opts) => setGeminiMeta(store, convId, 'googleSearch', val, opts);
    const setUrlContext = (store, convId, val, opts) => setGeminiMeta(store, convId, 'urlContext', val, opts);
    const setYouTubeVideo = (store, convId, val, opts) => setGeminiMeta(store, convId, 'youtubeVideo', val, opts);
    
    // Getter 辅助函数
    const getGeminiMeta = (conv, key, defaultVal = false) => conv?.metadata?.gemini?.[key] ?? defaultVal;
    const getCodeExecutionConfig = (conv) => !!getGeminiMeta(conv, 'codeExecution');
    const getGoogleSearchConfig = (conv) => !!getGeminiMeta(conv, 'googleSearch');
    const getUrlContextConfig = (conv) => !!getGeminiMeta(conv, 'urlContext');
    const getYouTubeVideoConfig = (conv) => !!getGeminiMeta(conv, 'youtubeVideo');

    /**
     * 处理 URL Context Metadata
     * @param {Object} urlContextMetadata - Gemini API 返回的 URL context 元数据
     * @returns {Object|null} 处理后的 URL 上下文信息
     */
    function processUrlContextMetadata(urlContextMetadata) {
        if (!urlContextMetadata) return null;
        
        // 支持 camelCase (urlMetadata) 和 snake_case (url_metadata)
        const urlMetadata = urlContextMetadata.urlMetadata || urlContextMetadata.url_metadata || [];
        
        if (!urlMetadata.length) return null;
        
        const urls = urlMetadata.map(meta => {
            // 支持 camelCase 和 snake_case
            const retrievedUrl = meta.retrievedUrl || meta.retrieved_url;
            const status = meta.urlRetrievalStatus || meta.url_retrieval_status;
            
            return {
                url: retrievedUrl,
                status: status,
                success: status === 'URL_RETRIEVAL_STATUS_SUCCESS'
            };
        });
        
        return {
            urls: urls,
            successCount: urls.filter(u => u.success).length,
            totalCount: urls.length
        };
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

     // Helper: Convert Gemini parts to displayable content, reasoning, attachments, thoughtSignature and functionCalls
    // 同时保留「轻量 parts 蓝图」用于严格回放 thoughtSignature（不包含 base64）。
    function partsToContent(parts, options) {
        if (!parts || !Array.isArray(parts)) {
            return {
                content: '',
                reasoning: null,
                attachments: null,
                // 思维链中的预览图（仅 UI 展示，不持久化/不回传）
                thoughtAttachments: null,
                thoughtSignature: null,
                imagePartSignatures: null,
                partsBlueprint: null,
                functionCalls: null
            };
        }

        const opt = (options && typeof options === 'object') ? options : {};
        // Gemini 生图模型可能在 thought 段返回预览图：默认不记录/不展示/不回传
        const skipInlineData = !!opt.skipInlineData;
        const dropThoughtImages = !!opt.dropThoughtImages;
        const inlineDataSource = (typeof opt.inlineDataSource === 'string' && opt.inlineDataSource)
            ? opt.inlineDataSource
            : 'gemini-inlineData';

        let content = '';
        let reasoning = '';
        const attachments = [];
        // 思维链中的预览图（仅 UI 展示，不持久化/不回传）
        const thoughtAttachments = [];
        const imagePartSignatures = [];
        const partsBlueprint = [];
        const functionCalls = [];
        let imageIndex = 1;
        let thoughtSignature = null;

        for (const part of parts) {
            const partThoughtSignature = part.thoughtSignature || part.thought_signature || null;
            if (partThoughtSignature) {
                thoughtSignature = partThoughtSignature;
            }

            // Handle function call from AI
            const functionCall = part.functionCall || part.function_call;
            if (functionCall) {
                functionCalls.push({
                    name: functionCall.name,
                    args: functionCall.args || {}
                });
                partsBlueprint.push({
                    type: 'functionCall',
                    functionCall: {
                        name: functionCall.name,
                        args: functionCall.args || {}
                    },
                    thoughtSignature: partThoughtSignature || undefined
                });
            }

            // Handle text (包括空字符串；流式时签名可能挂在空 text part 上)
            if (Object.prototype.hasOwnProperty.call(part, 'text') && typeof part.text === 'string') {
                if (part.thought === true) {
                    reasoning += part.text;
                    // 不回放 thought 文本；但如果该 thought part 用于承载签名（常见：text="" + thoughtSignature），保留一个空 text 占位。
                    if (partThoughtSignature && part.text === '') {
                        partsBlueprint.push({
                            type: 'text',
                            text: '',
                            thoughtSignature: partThoughtSignature
                        });
                    }
                } else {
                    content += part.text;
                    // 保留原始 text part（含空文本 + 签名占位）
                    if (part.text !== '' || partThoughtSignature) {
                        partsBlueprint.push({
                            type: 'text',
                            text: part.text,
                            thoughtSignature: partThoughtSignature || undefined
                        });
                    }
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

            // Handle inline data
            // Support both camelCase (JS SDK) and snake_case (REST API) formats
            const inlineData = part.inlineData || part.inline_data;
            if (inlineData) {
                if (skipInlineData) {
                    continue;
                }

                const mimeType = inlineData.mimeType || inlineData.mime_type;
                const data = inlineData.data;

                if (mimeType && typeof data === 'string') {
                    const isImage = mimeType.startsWith('image/');
                    const isThought = part.thought === true;

                    // ★ 思维链里的预览图：收进思维链（仅 UI 展示），不进入 attachments（不持久化、不回传）
                    if (dropThoughtImages && isThought && isImage) {
                        const dataUrl = `data:${mimeType};base64,${data}`;

                        let approximateSize = undefined;
                        try {
                            approximateSize = Math.round((data.length * 3) / 4);
                        } catch (e) {
                            approximateSize = undefined;
                        }

                        const attachmentName = `预览图 ${imageIndex++}`;
                        thoughtAttachments.push({
                            dataUrl: dataUrl,
                            type: mimeType,
                            name: attachmentName,
                            size: approximateSize,
                            source: 'gemini-thought-preview',
                            thought_signature: partThoughtSignature || undefined
                        });

                        // 注意：不写入 partsBlueprint / imagePartSignatures，避免后续回放/回传
                        continue;
                    }

                    const dataUrl = `data:${mimeType};base64,${data}`;

                    let approximateSize = undefined;
                    try {
                        approximateSize = Math.round((data.length * 3) / 4);
                    } catch (e) {
                        approximateSize = undefined;
                    }

                    const attachmentIndex = attachments.length;
                    const attachmentName = isImage ? `图片 ${imageIndex++}` : `Gemini Attachment ${imageIndex++}`;

                    attachments.push({
                        dataUrl: dataUrl,
                        type: mimeType,
                        name: attachmentName,
                        size: approximateSize,
                        source: inlineDataSource,
                        thought_signature: partThoughtSignature || undefined
                    });

                    // 仅对“实际输出到 UI 的图片附件”记录签名
                    if (isImage) {
                        imagePartSignatures.push(partThoughtSignature || null);
                    }
                    partsBlueprint.push({
                        type: 'inlineData',
                        inlineData: {
                            mimeType: mimeType,
                            attachmentIndex: attachmentIndex
                        },
                        thoughtSignature: partThoughtSignature || undefined
                    });
                }
            }
        }

        return {
            content,
            reasoning: reasoning || null,
            attachments: attachments.length > 0 ? attachments : null,
            // 思维链中的预览图（仅 UI 展示，不持久化/不回传）
            thoughtAttachments: thoughtAttachments.length > 0 ? thoughtAttachments : null,
            thoughtSignature: thoughtSignature,
            imagePartSignatures: imagePartSignatures.length > 0 ? imagePartSignatures : null,
            partsBlueprint: partsBlueprint.length > 0 ? partsBlueprint : null,
            functionCalls: functionCalls.length > 0 ? functionCalls : null
        };
    }

    /**
     * 过滤流式 parts 中的 thought 预览图 base64，降低 Android WebView 内存峰值。
     * - 仅在 dropThoughtImages=true 时生效
     * - 保留 thought/text/signature 等轻量字段
     */
    function sanitizeStreamParts(parts, options) {
        if (!Array.isArray(parts) || parts.length === 0) return [];
        const opt = (options && typeof options === 'object') ? options : {};
        if (!opt.dropThoughtImages) {
            return parts;
        }

        const out = [];
        for (const part of parts) {
            if (!part || typeof part !== 'object') {
                out.push(part);
                continue;
            }

            const inlineData = part.inlineData || part.inline_data;
            if (!inlineData) {
                out.push(part);
                continue;
            }

            const mimeType = inlineData.mimeType || inlineData.mime_type;
            const isThought = part.thought === true;
            const isImage = typeof mimeType === 'string' && mimeType.startsWith('image/');

            if (!isThought || !isImage) {
                out.push(part);
                continue;
            }

            // thought 图片仅用于中间推理预览，去掉 inlineData 但保留可能有用的签名/文本占位
            const slimPart = {};
            if (part.thought === true) {
                slimPart.thought = true;
            }
            const thoughtSig = part.thoughtSignature || part.thought_signature;
            if (typeof part.text === 'string') {
                slimPart.text = part.text;
            } else if (thoughtSig) {
                // 保留一个空 text 占位，确保后续 partsToContent 可生成签名蓝图
                slimPart.text = '';
            }
            if (thoughtSig) {
                slimPart.thoughtSignature = thoughtSig;
            }

            if (Object.keys(slimPart).length > 0) {
                out.push(slimPart);
            }
        }

        return out;
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

    /**
     * 检测并提取文本中的 YouTube URL
     * @param {string} text - 输入文本
     * @returns {Object} { urls: string[], cleanedText: string }
     */
    function extractYouTubeUrls(text) {
        if (!text) return { urls: [], cleanedText: text };
        
        // YouTube URL 匹配正则
        // 支持: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, m.youtube.com/watch?v=
        const youtubeRegex = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/gi;
        
        const urls = [];
        let match;
        
        while ((match = youtubeRegex.exec(text)) !== null) {
            // 标准化 URL 格式
            const videoId = match[1];
            const fullUrl = match[0];
            urls.push({
                original: fullUrl,
                normalized: `https://www.youtube.com/watch?v=${videoId}`,
                videoId: videoId
            });
        }
        
        // 从文本中移除 YouTube URL（保留其他内容）
        let cleanedText = text.replace(youtubeRegex, '').trim();
        // 清理多余的空格
        cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
        
        return { urls, cleanedText };
    }

    // Helper: Convert message to Gemini format
    // options: { youtubeVideo: boolean } - 是否启用 YouTube 视频处理
    function convertMessages(messages, options = {}) {
        const contents = [];
        let systemInstruction = undefined;
        const enableYouTube = options.youtubeVideo || false;

        for (const msg of messages) {
            if (msg.role === 'system') {
                // System instruction - always use text content
                systemInstruction = {
                    parts: [{ text: msg.content || '' }]
                };
            } else if (msg.role === 'tool') {
                // 工具响应消息 - 转换为 Gemini 的 functionResponse 格式
                // 按官方说明：thought_signature 需要回填在 functionCall part 上；functionResponse 不要求携带。
                const parts = [];
                
                if (msg.toolResponses && Array.isArray(msg.toolResponses)) {
                    for (const tr of msg.toolResponses) {
                        parts.push({
                            functionResponse: {
                                name: tr.name,
                                response: tr.response
                            }
                        });
                    }
                }
                
                if (parts.length > 0) {
                    contents.push({
                        role: 'user',  // Gemini 中工具响应用 user role
                        parts: parts
                    });
                }
            } else {
                const role = msg.role === 'assistant' ? 'model' : 'user';

                // Gemini：如果已保存 parts 蓝图，则按蓝图严格回放（保持 part 顺序 + thoughtSignature 位置）
                const savedBlueprint = (role === 'model' && Array.isArray(msg.metadata?.gemini?.partsBlueprint))
                    ? msg.metadata.gemini.partsBlueprint
                    : null;

                if (savedBlueprint && savedBlueprint.length > 0) {
                    const attachmentList = Array.isArray(msg.attachments)
                        ? msg.attachments
                        : (Array.isArray(msg.metadata?.attachments) ? msg.metadata.attachments : []);

                    const replayParts = [];

                    for (const bp of savedBlueprint) {
                        if (!bp || typeof bp !== 'object') continue;

                        if (bp.type === 'text' && Object.prototype.hasOwnProperty.call(bp, 'text')) {
                            const p = { text: typeof bp.text === 'string' ? bp.text : '' };
                            if (bp.thoughtSignature) {
                                p.thoughtSignature = bp.thoughtSignature;
                            }
                            replayParts.push(p);
                            continue;
                        }

                        if (bp.type === 'functionCall' && bp.functionCall && bp.functionCall.name) {
                            const p = {
                                functionCall: {
                                    name: bp.functionCall.name,
                                    args: bp.functionCall.args || {}
                                }
                            };

                            if (bp.thoughtSignature) {
                                p.thoughtSignature = bp.thoughtSignature;
                            }

                            replayParts.push(p);
                            continue;
                        }

                        if (bp.type === 'inlineData' && bp.inlineData && typeof bp.inlineData.attachmentIndex === 'number') {
                            // 文档要求：inlineData 的签名必须回填在该图片 part 上。

                            const att = attachmentList[bp.inlineData.attachmentIndex];
                            const dataUrl = att && typeof att.dataUrl === 'string' ? att.dataUrl : null;
                            const mimeType = (att && att.type) || bp.inlineData.mimeType;
                            if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
                                continue;
                            }
                            const base64Data = dataUrl.split(',')[1];
                            if (!base64Data) {
                                continue;
                            }
                            const p = {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data
                                }
                            };
                            if (bp.thoughtSignature) {
                                p.thoughtSignature = bp.thoughtSignature;
                            }
                            replayParts.push(p);
                            continue;
                        }
                    }

                    if (replayParts.length > 0) {
                        contents.push({ role: role, parts: replayParts });
                        continue;
                    }
                }
                
                let parts = [];
                
                // 从 metadata 中读取 thoughtSignature（仅对 assistant/model 消息）
                const thoughtSig = (role === 'model' && msg.metadata?.gemini?.thoughtSignature)
                    ? msg.metadata.gemini.thoughtSignature
                    : null;

                const hasFunctionCalls = (role === 'model' && msg.functionCalls && Array.isArray(msg.functionCalls) && msg.functionCalls.length > 0);

                // Gemini：记录每个 inlineData part 的签名（按附件顺序）。
                const imagePartSignatures = (role === 'model' && Array.isArray(msg.metadata?.gemini?.imagePartSignatures))
                    ? msg.metadata.gemini.imagePartSignatures
                    : null;
                let inlineDataPartIndex = 0;
                
                // 构建 parts：从消息顶层字段读取
                
                // 1. 添加附件（用户消息或助手消息，从消息顶层的 attachments 读取）
                // 支持图片 (image/*) 和 PDF (application/pdf) 文件
                if (msg.attachments && Array.isArray(msg.attachments)) {
                    for (const attachment of msg.attachments) {
                        const isImage = attachment.type && attachment.type.startsWith('image/');
                        const isPdf = attachment.type === 'application/pdf';
                        if (isImage || isPdf) {
                            // 提取 base64 数据
                            const base64Data = attachment.dataUrl.split(',')[1];
                            const part = {
                                inlineData: {
                                    mimeType: attachment.type,
                                    data: base64Data
                                }
                            };

                            if (role === 'model') {
                                // 文档要求：thoughtSignature 必须回填到“收到它的那个 part”。
                                // 对 inlineData：优先使用该图片 part 自己的签名；不要用 message 级签名兜底（可能被校验为缺失/无效）。
                                const sig = attachment.thought_signature
                                    || attachment.thoughtSignature
                                    || (imagePartSignatures ? imagePartSignatures[inlineDataPartIndex] : null)
                                    || null;
                                if (sig) {
                                    part.thoughtSignature = sig;
                                }
                            }

                            parts.push(part);
                            inlineDataPartIndex += 1;
                        }
                    }
                } else if (msg.metadata?.attachments && Array.isArray(msg.metadata.attachments)) {
                    // 兼容旧数据：从 metadata.attachments 读取
                    for (const attachment of msg.metadata.attachments) {
                        const isImage = attachment.type && attachment.type.startsWith('image/');
                        const isPdf = attachment.type === 'application/pdf';
                        if (isImage || isPdf) {
                            const base64Data = attachment.dataUrl.split(',')[1];
                            const part = {
                                inlineData: {
                                    mimeType: attachment.type,
                                    data: base64Data
                                }
                            };

                            if (role === 'model') {
                                const sig = attachment.thought_signature
                                    || attachment.thoughtSignature
                                    || (imagePartSignatures ? imagePartSignatures[inlineDataPartIndex] : null)
                                    || null;
                                if (sig) {
                                    part.thoughtSignature = sig;
                                }
                            }

                            parts.push(part);
                            inlineDataPartIndex += 1;
                        }
                    }
                }
                
                // 2. 处理文本内容
                if (msg.content) {
                    let textContent = msg.content;
                    
                    // 如果启用了 YouTube 视频功能，检测并转换 YouTube URL
                    if (enableYouTube && role === 'user') {
                        const { urls, cleanedText } = extractYouTubeUrls(msg.content);
                        
                        // 为每个 YouTube URL 创建 fileData part
                        for (const urlInfo of urls) {
                            const videoPart = {
                                fileData: {
                                    fileUri: urlInfo.normalized,
                                    mimeType: 'video/*'
                                }
                            };
                            parts.push(videoPart);
                        }
                        
                        textContent = cleanedText;
                    }
                    
                    // 添加文本部分（如果还有内容）
                    if (textContent) {
                        const part = { text: textContent };
                        parts.push(part);
                    }
                }
                
                // 3. 处理 function calls（仅 assistant/model 消息）
                if (role === 'model' && msg.functionCalls && Array.isArray(msg.functionCalls)) {
                    let signatureAttached = false;
                    for (const fc of msg.functionCalls) {
                        const part = {
                            functionCall: {
                                name: fc.name,
                                args: fc.args || {}
                            }
                        };

                        // Gemini 3：并行 FC 时签名只挂在第一个 functionCall part；顺序多步则每步各有一个签名。
                        if (thoughtSig && !signatureAttached) {
                            part.thoughtSignature = thoughtSig;
                            signatureAttached = true;
                        }

                        parts.push(part);
                    }
                }
                
                // 2.5. 处理 thought_signature（仅对 model 消息）：
                // - 有 functionCall：签名只应附在该 step 的第一个 functionCall part 上（上面已处理）
                // - 无 functionCall：Gemini 3 通常在最后一个 part 返回签名；这里回填到最后一个 part
                if (role === 'model' && thoughtSig && !hasFunctionCalls) {
                    if (parts.length === 0) {
                        parts.push({ text: '', thoughtSignature: thoughtSig });
                    } else {
                        parts[parts.length - 1].thoughtSignature = thoughtSig;
                    }
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

            // partsToContent 的解析选项（用于过滤 thought 段图片等特殊情况）
            const partsToContentOpt = {
                dropThoughtImages: false,
                inlineDataSource: 'gemini-inlineData'
            };
            
            // Construct URL
            // Standard: https://generativelanguage.googleapis.com/v1beta/models/{model}:{action}
            // If streaming, add alt=sse
            let url = `${baseUrl}/models/${model}:${action}`;
            if (isStream) {
                url += '?alt=sse';
            }

            // 获取当前会话的 gemini 配置（需要在 convertMessages 之前获取，因为需要传递 youtubeVideo 选项）
            let geminiMeta = {};
            let activeConv = null;
            try {
                const store = window.IdoFront && window.IdoFront.store;
                if (store && typeof store.getActiveConversation === 'function') {
                    activeConv = store.getActiveConversation();
                    if (activeConv && activeConv.metadata && activeConv.metadata.gemini) {
                        geminiMeta = activeConv.metadata.gemini;
                    }
                }
            } catch (e) {
                console.warn('[GeminiChannel] Failed to get conversation metadata:', e);
            }

            // 预判本次请求是否会开启 includeThoughts（开启时会要求历史 model parts 回填 thought_signature）
            const isImageGenModel = supportsImageGeneration(model, config);

            // 生图模型：过滤思维链预览图（不显示、不记录、也不回传）
            partsToContentOpt.dropThoughtImages = !!isImageGenModel;
            partsToContentOpt.inlineDataSource = isImageGenModel ? 'gemini-imagegen' : 'gemini-inlineData';

            // 说明：
            // - 文本模型：thinking 由 thinkingBudget/thinkingLevel 控制
            // - 图片模型：多数后端不允许设置 thinkingConfig（包括 thinkingBudget）。
            //   因此这里仅提供一个开关：允许用户“尝试 includeThoughts（拿 thoughtSignature）”。
            //   若后端不支持，将直接报错，由用户手动关闭开关后重试。

            const isBudgetModel = (!isImageGenModel && useBudgetMode(model, config));
            const isLevelModel = (!isImageGenModel && useLevelMode(model, config));

            // 生图：是否尝试 includeThoughts（用于 thoughtSignature）- 默认开启
            const imageForceThinking = isImageGenModel && (geminiMeta.imageForceThinking !== false);

            // 预算模型：budget>0 视为启用 thinking；-1(自动)/0(关闭) 则不启用。
            const budget = isBudgetModel
                ? ((geminiMeta.thinkingBudget !== undefined) ? geminiMeta.thinkingBudget : -1)
                : -1;

            const wantsThinking = (
                (isBudgetModel && typeof budget === 'number' && budget > 0) ||
                (isLevelModel === true)
            );

            // includeThoughts：
            // - 文本模型：启用 thinking 时默认尝试
            // - 图片模型：仅当用户打开开关时尝试
            const wantsIncludeThoughts = wantsThinking || imageForceThinking;

            // 砍掉预检/自动处理：includeThoughts 是否发送完全由开关/思考设置决定。
            // 若后端要求历史 thoughtSignature 而当前历史不满足，将直接 400 报错。
            const enableIncludeThoughts = wantsIncludeThoughts;

            // 转换消息，传递 YouTube 视频选项
            const { contents, systemInstruction } = convertMessages(messages, {
                youtubeVideo: !!geminiMeta.youtubeVideo
            });

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
            
            const thinkingConfig = {};
            // Image generation 的响应模态（默认 Text + Image）
            const responseModality = geminiMeta.responseModality || 'default';
            
            // 注意：thinkingConfig.includeThoughts 可能触发“历史 thoughtSignature 回填”校验。
            // 因此把 includeThoughts 与 thinking 启用解耦：
            // - thinking 可以开（预算/等级）
            // - includeThoughts 只有在历史可回放时才开（避免 400）

            if (wantsThinking) {
                if (isBudgetModel && typeof budget === 'number' && budget > 0) {
                    thinkingConfig.thinkingBudget = budget;
                } else if (isLevelModel) {
                    const level = geminiMeta.thinkingLevel || 'low';
                    thinkingConfig.thinkingLevel = level;
                }
            }

            // 图片模型：开启 includeThoughts 时，同时带上 thinkingBudget=-1（自动）。
            // Vertex 要求：includeThoughts 只有在 thinking 启用时才允许。
            if (enableIncludeThoughts) {
                thinkingConfig.includeThoughts = true;
                // 如果还没设置 thinkingBudget/thinkingLevel，补一个 -1（自动）让 Vertex 认为 thinking 已启用
                if (!thinkingConfig.thinkingBudget && !thinkingConfig.thinkingLevel) {
                    thinkingConfig.thinkingBudget = -1;
                }
            }

            // 将 thinkingConfig 合并到 generationConfig
            if (Object.keys(thinkingConfig).length > 0) {
                generationConfig.thinkingConfig = thinkingConfig;
            }
            
            // Image Generation Config - 图像生成配置
            if (isImageGenModel) {
                // 响应模态配置
                if (responseModality === 'image') {
                    generationConfig.responseModalities = ['Image'];
                } else {
                    // 默认返回文本和图片
                    generationConfig.responseModalities = ['Text', 'Image'];
                }
                
                // 图像配置
                const imageConfig = {};
                
                // 宽高比：auto 表示不传参数，让模型自动决定
                const aspectRatio = geminiMeta.imageAspectRatio || 'auto';
                if (aspectRatio && aspectRatio !== 'auto') {
                    imageConfig.aspectRatio = aspectRatio;
                }
                
                // 图像大小（仅 Gemini 3 Pro Image 支持）：1K 是默认值，不传参数
                if (supportsImageSize(model, config)) {
                    const imageSize = geminiMeta.imageSize || '1K';
                    if (imageSize && imageSize !== '1K') {
                        imageConfig.imageSize = imageSize;
                    }
                }
                
                if (Object.keys(imageConfig).length > 0) {
                    generationConfig.imageConfig = imageConfig;
                }
            }
            
            if (Object.keys(generationConfig).length > 0) {
                body.generationConfig = generationConfig;
            }

            // Tools Config - 代码执行、Google Search、URL Context 和自定义工具
            const tools = [];
            if (geminiMeta.codeExecution) {
                tools.push({ codeExecution: {} });
            }
            if (geminiMeta.googleSearch) {
                tools.push({ google_search: {} });
            }
            if (geminiMeta.urlContext) {
                tools.push({ url_context: {} });
            }
            
            // 添加 MCP/自定义工具（来自 toolRegistry）
            const toolRegistry = window.IdoFront.toolRegistry;
            if (toolRegistry && geminiMeta.enableTools !== false) {
                const store = window.IdoFront && window.IdoFront.store;
                const customTools = toolRegistry.toGeminiFormat({
                    isEnabled: (toolId) => {
                        if (!store || typeof store.getToolStateForConversation !== 'function') return true;
                        if (!activeConv || !activeConv.id) return true;
                        return store.getToolStateForConversation(activeConv.id, toolId);
                    }
                });
                if (customTools && customTools.length > 0) {
                    tools.push(...customTools);
                }
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
                function formatGeminiError(status, errorText) {
                    let errorMsg = `Gemini API Error ${status}`;
                    try {
                        const errorJson = JSON.parse(errorText);
                        if (errorJson?.error?.message) {
                            errorMsg += `: ${errorJson.error.message}`;
                        } else {
                            errorMsg += `: ${errorText}`;
                        }
                    } catch (e) {
                        errorMsg += `: ${errorText}`;
                    }
                    return errorMsg;
                }

                async function postGemini(bodyObj) {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(bodyObj),
                        signal: signal // 传递取消信号
                    });

                    if (res.ok) {
                        return { ok: true, response: res, errorText: null };
                    }

                    const errorText = await res.text();
                    return { ok: false, response: res, errorText };
                }

                // 发送请求：只发一次，不做任何自动重试/自动降级。
                const attempt = await postGemini(body);

                if (!attempt.ok) {
                    throw new Error(formatGeminiError(attempt.response?.status, attempt.errorText));
                }

                const response = attempt.response;

                if (isStream) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let buffer = '';
                    let accumulatedParts = [];
                    let lastThoughtSignature = null;
                    let lastFinishReason = null;
                    let streamUsageMetadata = null; // 流式响应中的 usage 信息
                    let lastGroundingMetadata = null; // 流式响应中的 grounding 信息
                    // Gemini 生图模型中，inlineData 可能非常大。
                    // 一旦检测到 inlineData，流式阶段仅在结束时做一次完整解析，
                    // 避免每个 chunk 都重建 dataUrl 导致 Android WebView 内存峰值。
                    let imageStreamHasInlineData = false;
                    const streamPreviewPartsOpt = isImageGenModel ? { ...partsToContentOpt, skipInlineData: true } : partsToContentOpt;

                    let lastUrlContextMetadata = null; // 流式响应中的 URL context 信息

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
                                        
                                        // 提取 urlContextMetadata
                                        // 支持 camelCase (urlContextMetadata) 和 snake_case (url_context_metadata)
                                        const urlCtxMeta = candidate?.urlContextMetadata || candidate?.url_context_metadata;
                                        if (urlCtxMeta) {
                                            lastUrlContextMetadata = urlCtxMeta;
                                        }
                                        
                                        // 检测 finishReason - Gemini 的流式结束标志
                                        if (candidate?.finishReason) {
                                            lastFinishReason = candidate.finishReason;
                                        }
                                        
                                        if (candidate && candidate.content && candidate.content.parts) {
                                            const newParts = candidate.content.parts;
                                            const thoughtSignature = candidate.thoughtSignature;
                                            
                                            if (isImageGenModel && Array.isArray(newParts) && newParts.length > 0) {
                                                const hasInlineData = newParts.some(part => {
                                                    if (!part || typeof part !== 'object') return false;
                                                    return !!(part.inlineData || part.inline_data);
                                                });
                                                if (hasInlineData) {
                                                    imageStreamHasInlineData = true;
                                                }
                                            }

                                            // 过滤 thought 预览图的大 base64，避免流式阶段内存膨胀
                                            const incomingParts = isImageGenModel
                                                ? sanitizeStreamParts(newParts, partsToContentOpt)
                                                : newParts;

                                            // Accumulate parts incrementally
                                            accumulatedParts = accumulatedParts.concat(incomingParts);
                                            lastThoughtSignature = thoughtSignature;

                                            if (isImageGenModel && imageStreamHasInlineData && !lastFinishReason) {
                                                // 生图流式中，出现 inlineData 后先不做逐帧 attachments 回放，
                                                // 只在结束时解析一次完整结果。
                                                continue;
                                            }

                                            const parseOpt = (isImageGenModel && !lastFinishReason)
                                                ? streamPreviewPartsOpt
                                                : partsToContentOpt;
                                            
                                            const { content, reasoning, attachments, thoughtAttachments, thoughtSignature: extractedSignature, imagePartSignatures: extractedImagePartSignatures, partsBlueprint: extractedPartsBlueprint } = partsToContent(accumulatedParts, parseOpt);
                                            
                                            const updateData = {
                                                content: content,
                                                reasoning: reasoning,
                                                attachments: attachments,
                                                // 思维链预览图：仅用于 UI 展示，不进入 metadata/store
                                                thoughtAttachments: thoughtAttachments,
                                                metadata: {
                                                    gemini: {
                                                        thoughtSignature: extractedSignature || thoughtSignature,
                                                        imagePartSignatures: extractedImagePartSignatures || null,
                                                        partsBlueprint: extractedPartsBlueprint || null
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
                                            const { content, reasoning, attachments, thoughtAttachments, thoughtSignature: extractedSignature, imagePartSignatures: extractedImagePartSignatures, partsBlueprint: extractedPartsBlueprint } = partsToContent(accumulatedParts, partsToContentOpt);
                                            const updateData = {
                                                content: content,
                                                reasoning: reasoning,
                                                finishReason: lastFinishReason,
                                                attachments: attachments,
                                                // 思维链预览图：仅用于 UI 展示，不进入 metadata/store
                                                thoughtAttachments: thoughtAttachments,
                                                metadata: {
                                                    gemini: {
                                                        thoughtSignature: extractedSignature || lastThoughtSignature,
                                                        imagePartSignatures: extractedImagePartSignatures || null,
                                                        partsBlueprint: extractedPartsBlueprint || null
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

                    let { content, reasoning, attachments, thoughtSignature: extractedSignature, imagePartSignatures: extractedImagePartSignatures, partsBlueprint: extractedPartsBlueprint, functionCalls } = partsToContent(accumulatedParts, partsToContentOpt);
                    
                    // 处理 Grounding Metadata，添加引用
                    let citations = null;
                    let searchQueries = null;
                    if (lastGroundingMetadata) {
                        const groundingResult = processGroundingMetadata(lastGroundingMetadata, content);
                        content = groundingResult.content;
                        citations = groundingResult.citations;
                        searchQueries = groundingResult.searchQueries;
                    }
                    
                    // 处理 URL Context Metadata
                    let urlContextInfo = null;
                    if (lastUrlContextMetadata) {
                        urlContextInfo = processUrlContextMetadata(lastUrlContextMetadata);
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
                                tool_calls: functionCalls,  // AI 请求的工具调用
                                metadata: {
                                    gemini: {
                                        thoughtSignature: extractedSignature || lastThoughtSignature,
                                        imagePartSignatures: extractedImagePartSignatures || null,
                                        partsBlueprint: extractedPartsBlueprint || null,
                                        citations: citations,
                                        searchQueries: searchQueries,
                                        urlContext: urlContextInfo
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
                    // 支持 camelCase 和 snake_case
                    const urlContextMetadata = candidate?.urlContextMetadata || candidate?.url_context_metadata;
                    let { content, reasoning, attachments, thoughtSignature: extractedSignature, imagePartSignatures: extractedImagePartSignatures, partsBlueprint: extractedPartsBlueprint, functionCalls } = partsToContent(parts, partsToContentOpt);
                    
                    // 处理 Grounding Metadata，添加引用
                    let citations = null;
                    let searchQueries = null;
                    if (groundingMetadata) {
                        const groundingResult = processGroundingMetadata(groundingMetadata, content);
                        content = groundingResult.content;
                        citations = groundingResult.citations;
                        searchQueries = groundingResult.searchQueries;
                    }
                    
                    // 处理 URL Context Metadata
                    let urlContextInfo = null;
                    if (urlContextMetadata) {
                        urlContextInfo = processUrlContextMetadata(urlContextMetadata);
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
                                tool_calls: functionCalls,  // AI 请求的工具调用
                                metadata: {
                                    gemini: {
                                        thoughtSignature: extractedSignature || thoughtSignature,
                                        imagePartSignatures: extractedImagePartSignatures || null,
                                        partsBlueprint: extractedPartsBlueprint || null,
                                        citations: citations,
                                        searchQueries: searchQueries,
                                        urlContext: urlContextInfo
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
            
            const { h, sheetHeader, cardItem } = window.IdoUI;
            const model = conv.selectedModel;
            const isBudgetMode = useBudgetMode(model, channelConfig);
            const thinkingCfg = getThinkingConfig(conv);
            
            showBottomSheet((sheetContainer) => {
                const header = sheetHeader({
                    title: isBudgetMode ? '思考预算设置' : '思考等级设置',
                    onClose: hideBottomSheet
                });
                
                const body = h('div.flex-1.overflow-y-auto.px-6.py-4.space-y-2');
                const footer = h('div.px-6.py-4.border-t.border-gray-100.bg-gray-50.flex-shrink-0.hidden');

                if (isBudgetMode) {
                    const currentBudget = thinkingCfg.budget;
                    footer.classList.remove('hidden');
                    
                    const budgetOptions = [
                        { value: 0, label: '关闭', description: '关闭思考功能', icon: 'block' },
                        { value: 1024, label: '最小', description: '1024 tokens - 基础思考', bars: 1 },
                        { value: 4096, label: '低', description: '4096 tokens - 轻度思考', bars: 2 },
                        { value: 16384, label: '中', description: '16384 tokens - 适中思考', bars: 3 },
                        { value: 32768, label: '高', description: '32768 tokens - 深度思考', bars: 4 },
                        { value: -1, label: '自动', description: '由模型动态决定思考深度', icon: 'magic_button' }
                    ];

                    budgetOptions.forEach(opt => {
                        body.appendChild(cardItem({
                            active: currentBudget === opt.value,
                            visual: opt.icon ? { icon: opt.icon } : { bars: opt.bars },
                            label: opt.label,
                            description: opt.description,
                            onClick: () => {
                                setThinkingBudget(store, conv.id, opt.value);
                                hideBottomSheet();
                                updateThinkingControls();
                            }
                        }));
                    });

                    // 自定义滑块
                    footer.appendChild(h('div.text-xs.font-medium.text-gray-500.mb-3', '自定义 Token 预算'));
                    const sliderVal = h('div.text-center.text-blue-600.font-mono.font-bold.mt-2', 
                        currentBudget > 0 ? String(currentBudget) : '---');
                    const slider = h('input', {
                        type: 'range', min: '0', max: '32768', step: '128',
                        value: currentBudget > 0 ? currentBudget : 16384,
                        class: 'w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600',
                        oninput: (e) => { sliderVal.textContent = e.target.value; },
                        onchange: (e) => {
                            setThinkingBudget(store, conv.id, parseInt(e.target.value));
                            updateThinkingControls();
                        }
                    });
                    footer.appendChild(slider);
                    footer.appendChild(sliderVal);
                } else {
                    LEVEL_OPTIONS.forEach(opt => {
                        body.appendChild(cardItem({
                            active: opt.value === thinkingCfg.level,
                            visual: { bars: opt.bars },
                            label: opt.label,
                            description: opt.description,
                            onClick: () => {
                                setThinkingLevel(store, conv.id, opt.value);
                                hideBottomSheet();
                                updateThinkingControls();
                            }
                        }));
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
            
            const { h, sheetHeader, switchItem } = window.IdoUI;
            
            showBottomSheet((sheetContainer) => {
                const header = sheetHeader({ title: '工具设置', onClose: hideBottomSheet });
                const body = h('div.flex-1.overflow-y-auto.px-6.py-4.space-y-6');
                
                body.appendChild(switchItem({
                    label: '代码执行 (Code Execution)',
                    description: '允许模型生成并运行 Python 代码以解决复杂问题。',
                    checked: getCodeExecutionConfig(conv),
                    onChange: (checked) => {
                        setCodeExecution(store, conv.id, checked);
                        updateThinkingControls();
                    }
                }));
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
            });
        }

        function updateThinkingControls() {
            const wrapper = getThinkingWrapper();
            if (!wrapper) return;
            
            const store = getStore();
            const conv = store?.getActiveConversation?.();
            const model = conv?.selectedModel;
            const channelConfig = conv ? getChannelConfig(store, conv) : null;
            
            // 隐藏条件：无会话、无模型、非 Gemini 渠道、或不支持思考
            if (!model || channelConfig?.type !== 'gemini' || !supportsThinking(model, channelConfig)) {
                wrapper.style.display = 'none';
                return;
            }
            
            wrapper.style.display = 'flex';
            const budgetBtnEl = wrapper.querySelector('[data-gemini-budget-btn]');
            const levelGroupEl = wrapper.querySelector('[data-gemini-level-group]');
            if (levelGroupEl) levelGroupEl.style.display = 'none';
            
            if (budgetBtnEl) {
                budgetBtnEl.style.display = 'inline-flex';
                const thinkingCfg = getThinkingConfig(conv);
                if (useBudgetMode(model)) {
                    const preset = BUDGET_PRESETS.find(p => p.value === thinkingCfg.budget);
                    budgetBtnEl.textContent = preset?.label || `${thinkingCfg.budget}`;
                } else {
                    const opt = LEVEL_OPTIONS.find(o => o.value === thinkingCfg.level) || LEVEL_OPTIONS[1];
                    budgetBtnEl.textContent = opt.label;
                }
            }
        }

        /**
         * 更新所有 Gemini 渠道控件
         */
        function updateAllGeminiControls() {
            updateThinkingControls();
            // 图像生成控件会在 renderImageGenSettings 中定义
            if (typeof updateImageGenControls === 'function') {
                updateImageGenControls();
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
                store.events.on('updated', updateAllGeminiControls);
                storeEventRegistered = true;
                // 注册成功后立即更新一次
                setTimeout(() => updateAllGeminiControls(), 0);
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
                        setTimeout(() => updateAllGeminiControls(), 50);
                    }
                });
            }
        }

        /**
         * 渲染思考控件
         * 抽取为独立函数，使用与 OpenAI 渠道相同的数组格式注册
         */
        function renderThinkingBudget() {
            ensureStoreEventRegistered();
            const { h } = window.IdoUI;
            
            // Budget 模式按钮
            const budgetBtn = h('button', {
                type: 'button',
                class: 'px-2 py-0.5 text-[10px] rounded border border-gray-300 bg-white hover:border-blue-400 text-gray-700 font-medium transition-colors',
                'data-gemini-budget-btn': 'true',
                text: '自动',
                style: { display: 'none' },
                onclick: (e) => {
                    e.stopPropagation();
                    const store = getStore();
                    const conv = store?.getActiveConversation?.();
                    if (!conv) return;
                    showThinkingBottomSheet(conv, getChannelConfig(store, conv));
                }
            });
            
            // Level 模式按钮组
            const buttonRefs = {};
            const levelGroup = h('div', {
                class: 'flex items-center gap-px bg-gray-100 rounded p-px',
                'data-gemini-level-group': 'true',
                style: { display: 'none' }
            }, LEVEL_OPTIONS.map(opt => {
                const btn = h('button', {
                    type: 'button',
                    class: 'px-1.5 py-0.5 rounded text-[10px] border cursor-pointer transition-colors font-medium',
                    text: opt.label,
                    title: `思考等级：${opt.description}`,
                    onclick: () => {
                        const store = getStore();
                        const conv = store?.getActiveConversation?.();
                        if (!conv) return;
                        setThinkingLevel(store, conv.id, opt.value);
                        updateThinkingControls();
                    }
                });
                buttonRefs[opt.value] = btn;
                return btn;
            }));
            levelState.buttons = buttonRefs;
            
            const wrapper = h('div', {
                id: WRAPPER_ID,
                class: 'flex items-center gap-2',
                style: { display: 'none', order: '1' }
            }, [
                h('div.flex.items-center.gap-1', [
                    h('span.text-\[10px\].text-gray-400', '思考'),
                    budgetBtn,
                    levelGroup
                ])
            ]);
            
            setTimeout(() => updateThinkingControls(), 0);
            setTimeout(() => updateThinkingControls(), 100);
            return wrapper;
        }

        // ========== 图像生成设置 UI ==========
        const IMAGE_GEN_WRAPPER_ID = 'core-gemini-image-gen-wrapper';
        
        /**
         * 获取图像生成控件的 wrapper 元素
         */
        function getImageGenWrapper() {
            return document.getElementById(IMAGE_GEN_WRAPPER_ID);
        }
        
        /**
         * 显示图像生成设置底部弹窗
         */
        function showImageGenBottomSheet(conv, channelConfig) {
            const store = getStore();
            if (!store) return;
            
            const { h, icon: uiIcon, section, sheetHeader, switchItem } = window.IdoUI;
            const model = conv.selectedModel;
            const hasImageSize = supportsImageSize(model, channelConfig);
            
            showBottomSheet((sheetContainer) => {
                const header = sheetHeader({ title: '图像生成设置', onClose: hideBottomSheet });
                
                const body = h('div.flex-1.overflow-y-auto.px-6.py-4.space-y-6');
                const imageGenCfg = getImageGenConfig(conv);
                let currentConfig = { ...imageGenCfg };
                
                // 通用选项渲染器
                const renderOptions = (container, options, configKey, setter, { columns = 4, allowDeselect = false, layout = 'vertical' } = {}) => {
                    container.innerHTML = '';
                    options.forEach(opt => {
                        const isActive = opt.value === currentConfig[configKey];
                        const isHorizontal = layout === 'horizontal';
                        
                        const baseClass = `cursor-pointer transition-all border-2 rounded-${isHorizontal ? 'xl' : 'lg'}`;
                        const activeClass = isActive ? 'border-purple-500 bg-purple-50' : 'border-gray-100 hover:border-gray-200 bg-white';
                        const layoutClass = isHorizontal ? 'p-3 flex items-center gap-3' : 'p-2 text-center';
                        
                        const item = h('div', { class: `${baseClass} ${activeClass} ${layoutClass}` });
                        
                        if (opt.icon) {
                            item.appendChild(uiIcon(opt.icon, `text-[${isHorizontal ? '24' : '20'}px] ${isActive ? 'text-purple-600' : 'text-gray-400'}`));
                        }
                        
                        if (isHorizontal) {
                            const info = h('div.flex-1', [
                                h('div', { class: `font-medium ${isActive ? 'text-purple-700' : 'text-gray-700'}` }, opt.label),
                                opt.description && h('div.text-\[10px\].text-gray-500', opt.description)
                            ].filter(Boolean));
                            item.appendChild(info);
                            if (isActive) item.appendChild(uiIcon('check_circle', 'text-purple-500 text-[20px]'));
                        } else {
                            item.appendChild(h('div', { class: `text-xs font-medium mt-1 ${isActive ? 'text-purple-700' : 'text-gray-600'}` }, opt.label || opt.value));
                        }
                        
                        item.onclick = () => {
                            const newValue = (allowDeselect && isActive) ? 'auto' : opt.value;
                            currentConfig[configKey] = newValue;
                            setter(store, conv.id, newValue, { silent: true });
                            renderOptions(container, options, configKey, setter, { columns, allowDeselect, layout });
                            updateImageGenControls();
                        };
                        
                        container.appendChild(item);
                    });
                };
                
                // 1. 输出类型
                const modalityGrid = h('div.grid.grid-cols-2.gap-3');
                renderOptions(modalityGrid, RESPONSE_MODALITY_OPTIONS, 'responseModality', setResponseModality, { layout: 'horizontal' });
                body.appendChild(section({ label: '输出类型', children: modalityGrid }));

                // 1.5 生图思考
                body.appendChild(section({
                    label: '思考',
                    hint: 'Gemini 3 Pro及以上图片模型强制开启思考',
                    children: h('div.space-y-3', [
                        switchItem({
                            label: '',
                            description: '开启后将请求图片模型的思维链',
                            checked: !!currentConfig.forceThinking,
                            onChange: (checked) => {
                                currentConfig.forceThinking = !!checked;
                                setImageForceThinking(store, conv.id, !!checked, { silent: true });
                            }
                        })
                    ])
                }));
                
                // 2. 宽高比（可取消）
                const aspectGrid = h('div.grid.grid-cols-4.gap-2');
                renderOptions(aspectGrid, ASPECT_RATIO_OPTIONS, 'aspectRatio', setImageAspectRatio, { allowDeselect: true });
                body.appendChild(section({ label: '宽高比', hint: '不选择 = 自动', children: aspectGrid }));
                
                // 3. 图像分辨率（仅特定模型）
                if (hasImageSize) {
                    const sizeGrid = h('div.grid.grid-cols-3.gap-3');
                    renderOptions(sizeGrid, IMAGE_SIZE_OPTIONS, 'imageSize', setImageSize, { layout: 'horizontal' });
                    body.appendChild(section({ label: '图像分辨率', children: sizeGrid }));
                }
                
                sheetContainer.appendChild(header);
                sheetContainer.appendChild(body);
            });
        }
        
        /**
         * 更新图像生成控件的显示状态
         */
        function updateImageGenControls() {
            const wrapper = getImageGenWrapper();
            if (!wrapper) return;
            
            const store = getStore();
            const conv = store?.getActiveConversation?.();
            const model = conv?.selectedModel;
            const channelConfig = conv ? getChannelConfig(store, conv) : null;
            
            if (!model || channelConfig?.type !== 'gemini' || !supportsImageGeneration(model)) {
                wrapper.style.display = 'none';
                return;
            }
            
            wrapper.style.display = 'flex';
            const btnEl = wrapper.querySelector('[data-gemini-imagegen-btn]');
            if (btnEl) {
                const ratio = getImageGenConfig(conv).aspectRatio;
                btnEl.innerHTML = `<span class="material-symbols-outlined text-[12px]">aspect_ratio</span> ${ratio === 'auto' ? '自动' : ratio}`;
            }
        }
        
        /**
         * 渲染图像生成设置控件
         */
        function renderImageGenSettings() {
            const { h } = window.IdoUI;
            
            const settingsBtn = h('button', {
                type: 'button',
                class: 'px-2 py-0.5 text-[10px] rounded border border-purple-300 bg-purple-50 hover:border-purple-400 text-purple-700 font-medium transition-colors flex items-center gap-1',
                'data-gemini-imagegen-btn': 'true',
                html: '<span class="material-symbols-outlined text-[12px]">aspect_ratio</span> 自动',
                onclick: (e) => {
                    e.stopPropagation();
                    const store = getStore();
                    const conv = store?.getActiveConversation?.();
                    if (!conv) return;
                    showImageGenBottomSheet(conv, getChannelConfig(store, conv));
                }
            });
            
            const wrapper = h('div', {
                id: IMAGE_GEN_WRAPPER_ID,
                class: 'flex items-center gap-2',
                style: { display: 'none', order: '2' }
            }, [
                h('div.flex.items-center.gap-1', [
                    h('span.text-\[10px\].text-gray-400', '图像'),
                    settingsBtn
                ])
            ]);
            
            setTimeout(() => updateImageGenControls(), 0);
            setTimeout(() => updateImageGenControls(), 100);
            return wrapper;
        }

        // 使用 registerUIBundle 注册 Gemini 渠道 UI 组件
        // 注意：id 必须唯一，避免与 Claude 渠道的 thinking-budget 冲突
        try {
            registerBundle('core-gemini-channel-ui', {
                slots: {
                    [SLOTS.INPUT_TOP]: [
                        { id: 'gemini-thinking-budget', render: renderThinkingBudget },
                        { id: 'gemini-image-gen-settings', render: renderImageGenSettings }
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
        
        // URL Context 工具
        window.IdoFront.inputTools.register({
            id: 'gemini-url-context',
            icon: 'link',
            label: 'URL 上下文',
            description: '允许模型访问消息中提供的 URL 内容来增强回答',
            shouldShow: (ctx) => {
                // 仅在 Gemini 渠道时显示
                if (!ctx.activeChannel) return false;
                return ctx.activeChannel.type === 'gemini';
            },
            getState: () => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return false;
                const conv = store.getActiveConversation();
                return getUrlContextConfig(conv);
            },
            setState: (enabled) => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return;
                const conv = store.getActiveConversation();
                if (!conv) return;
                // 使用静默模式，避免触发全局 UI 更新导致卡顿
                setUrlContext(store, conv.id, enabled, { silent: true });
            }
        });
        
        // YouTube 视频工具
        window.IdoFront.inputTools.register({
            id: 'gemini-youtube-video',
            icon: 'smart_display',
            label: 'YouTube 视频',
            description: '自动识别消息中的 YouTube 链接并分析视频内容',
            shouldShow: (ctx) => {
                // 仅在 Gemini 渠道时显示
                if (!ctx.activeChannel) return false;
                return ctx.activeChannel.type === 'gemini';
            },
            getState: () => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return false;
                const conv = store.getActiveConversation();
                return getYouTubeVideoConfig(conv);
            },
            setState: (enabled) => {
                const store = getStore();
                if (!store || !store.getActiveConversation) return;
                const conv = store.getActiveConversation();
                if (!conv) return;
                // 使用静默模式，避免触发全局 UI 更新导致卡顿
                setYouTubeVideo(store, conv.id, enabled, { silent: true });
            }
        });
    }
    
    /**
     * 通过 Framework API 显示工具设置底部弹窗
     */
    function showToolsBottomSheetViaFramework(conv) {
        const store = getStore();
        if (!store) return;
        
        const { h, sheetHeader, switchItem } = window.IdoUI;
        
        Framework.showBottomSheet((sheetContainer) => {
            const header = sheetHeader({ title: 'Gemini 工具设置', onClose: () => Framework.hideBottomSheet() });
            const body = h('div.flex-1.overflow-y-auto.px-6.py-4.space-y-6');
            
            body.appendChild(switchItem({
                label: '代码执行 (Code Execution)',
                description: '允许模型生成并运行 Python 代码以解决复杂问题，如数据分析、数学计算、图表绘制等。',
                checked: getCodeExecutionConfig(conv),
                onChange: (checked) => {
                    setCodeExecution(store, conv.id, checked);
                    if (window.IdoFront?.inputTools?.refresh) {
                        window.IdoFront.inputTools.refresh();
                    }
                }
            }));
            
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
        const sm = window.IdoFront?.settingsManager;
        if (!sm?.registerGeneralSection) return;
        
        try {
            const { h, formInput } = window.IdoUI;
            sm.registerGeneralSection({
                id: 'gemini-thinking',
                title: 'Gemini 思考功能',
                description: '配置 Gemini 模型的思考预算和思考等级匹配规则（正则表达式）',
                icon: 'psychology',
                category: '模型特性',
                tags: ['Gemini', 'thinking', 'thinkingBudget', 'thinkingLevel', '正则', '模型'],
                advanced: false,
                order: 20,
                render: function(container, ctx, st) {
                    container.innerHTML = '';
                    const rules = loadGlobalThinkingRules();
                    
                    container.appendChild(formInput({
                        label: '数值预算模式 (thinkingBudget)',
                        hint: '匹配的模型将显示数值预算滑槽（适用于 Gemini 2.5 系列）',
                        value: rules.budgetModelPattern,
                        placeholder: 'gemini-2\\.5|gemini-2-5',
                        onChange: (val) => {
                            const r = loadGlobalThinkingRules();
                            r.budgetModelPattern = val || DEFAULT_THINKING_RULES.budgetModelPattern;
                            saveGlobalThinkingRules(r);
                        }
                    }));
                    
                    const levelGroup = formInput({
                        label: '等级选择模式 (thinkingLevel)',
                        hint: '匹配的模型将显示 Low/High 等级选择（适用于 Gemini 3 系列）',
                        value: rules.levelModelPattern,
                        placeholder: 'gemini-3',
                        onChange: (val) => {
                            const r = loadGlobalThinkingRules();
                            r.levelModelPattern = val || DEFAULT_THINKING_RULES.levelModelPattern;
                            saveGlobalThinkingRules(r);
                        }
                    });
                    levelGroup.classList.add('mt-3');
                    container.appendChild(levelGroup);
                    
                    container.appendChild(h('div.text-\[10px\].text-gray-400.mt-3', {
                        html: '提示：使用正则表达式匹配模型名称。例如 <code class="bg-gray-100 px-1 rounded">gemini-2\\.5</code> 匹配包含 "gemini-2.5" 的模型名。'
                    }));
                }
            });
        } catch (e) {
            console.warn('[GeminiChannel] registerGeminiThinkingSettingsSection error:', e);
        }
    }
    
    /**
     * 注册 Gemini 图像生成规则设置分区到通用设置
     */
    function registerGeminiImageGenSettingsSection() {
        const sm = window.IdoFront?.settingsManager;
        if (!sm?.registerGeneralSection) return;
        
        try {
            const { h, formInput } = window.IdoUI;
            sm.registerGeneralSection({
                id: 'gemini-image-gen',
                title: 'Gemini 图像生成',
                description: '配置支持图像生成的模型匹配规则（正则表达式）',
                icon: 'image',
                category: '模型特性',
                tags: ['Gemini', 'image', 'image-gen', 'imagen', '正则', '模型'],
                advanced: false,
                order: 21,
                render: function(container, ctx, st) {
                    container.innerHTML = '';
                    const rules = loadImageGenRules();
                    
                    container.appendChild(formInput({
                        label: '图像生成模型',
                        hint: '匹配的模型将显示图像生成设置（宽高比、输出类型等）',
                        value: rules.imageModelPattern,
                        placeholder: 'gemini-.*-image|imagen',
                        onChange: (val) => {
                            const r = loadImageGenRules();
                            r.imageModelPattern = val || DEFAULT_IMAGE_GEN_RULES.imageModelPattern;
                            saveImageGenRules(r);
                        }
                    }));
                    
                    const sizeGroup = formInput({
                        label: '支持分辨率选择的模型',
                        hint: '匹配的模型将显示 1K/2K/4K 分辨率选项（适用于 Gemini 3 Pro Image）',
                        value: rules.imageSizeModelPattern,
                        placeholder: 'gemini-3.*-image',
                        onChange: (val) => {
                            const r = loadImageGenRules();
                            r.imageSizeModelPattern = val || DEFAULT_IMAGE_GEN_RULES.imageSizeModelPattern;
                            saveImageGenRules(r);
                        }
                    });
                    sizeGroup.classList.add('mt-3');
                    container.appendChild(sizeGroup);
                    
                    container.appendChild(h('div.text-\[10px\].text-gray-400.mt-3', {
                        html: '提示：图像生成模型支持设置宽高比（1:1、16:9、9:16 等）和输出类型（文本+图片 或 仅图片）。'
                    }));
                }
            });
        } catch (e) {
            console.warn('[GeminiChannel] registerGeminiImageGenSettingsSection error:', e);
        }
    }
    
    // 尝试立即注册（兼容 settingsManager 已就绪的情况）
    registerGeminiThinkingSettingsSection();
    registerGeminiImageGenSettingsSection();
    
    // 监听设置管理器就绪事件，确保在 settingsManager.init 之后也能完成注册
    if (typeof document !== 'undefined') {
        try {
            document.addEventListener('IdoFrontSettingsReady', function() {
                registerGeminiThinkingSettingsSection();
                registerGeminiImageGenSettingsSection();
            }, { once: true });
        } catch (e) {
            console.warn('[GeminiChannel] attach IdoFrontSettingsReady listener error:', e);
        }
    }

    // 暴露工具函数供外部使用
    window.IdoFront.geminiChannel.useBudgetMode = useBudgetMode;
    window.IdoFront.geminiChannel.useLevelMode = useLevelMode;
    window.IdoFront.geminiChannel.supportsThinking = supportsThinking;
    window.IdoFront.geminiChannel.getThinkingConfig = getThinkingConfig;
    window.IdoFront.geminiChannel.getThinkingRules = loadGlobalThinkingRules; // 别名，兼容旧代码
    window.IdoFront.geminiChannel.loadGlobalThinkingRules = loadGlobalThinkingRules;
    window.IdoFront.geminiChannel.saveGlobalThinkingRules = saveGlobalThinkingRules;
    window.IdoFront.geminiChannel.setThinkingBudget = setThinkingBudget;
    window.IdoFront.geminiChannel.setThinkingLevel = setThinkingLevel;
    window.IdoFront.geminiChannel.getCodeExecutionConfig = getCodeExecutionConfig;
    window.IdoFront.geminiChannel.setCodeExecution = setCodeExecution;
    window.IdoFront.geminiChannel.getGoogleSearchConfig = getGoogleSearchConfig;
    window.IdoFront.geminiChannel.setGoogleSearch = setGoogleSearch;
    window.IdoFront.geminiChannel.getUrlContextConfig = getUrlContextConfig;
    window.IdoFront.geminiChannel.setUrlContext = setUrlContext;
    window.IdoFront.geminiChannel.getYouTubeVideoConfig = getYouTubeVideoConfig;
    window.IdoFront.geminiChannel.setYouTubeVideo = setYouTubeVideo;
    window.IdoFront.geminiChannel.extractYouTubeUrls = extractYouTubeUrls;
    window.IdoFront.geminiChannel.processGroundingMetadata = processGroundingMetadata;
    window.IdoFront.geminiChannel.processUrlContextMetadata = processUrlContextMetadata;
    window.IdoFront.geminiChannel.BUDGET_PRESETS = BUDGET_PRESETS;
    window.IdoFront.geminiChannel.LEVEL_OPTIONS = LEVEL_OPTIONS;
    window.IdoFront.geminiChannel.DEFAULT_THINKING_RULES = DEFAULT_THINKING_RULES;
    
    // 图像生成相关
    window.IdoFront.geminiChannel.supportsImageGeneration = supportsImageGeneration;
    window.IdoFront.geminiChannel.supportsImageSize = supportsImageSize;
    window.IdoFront.geminiChannel.getImageGenConfig = getImageGenConfig;
    window.IdoFront.geminiChannel.setImageAspectRatio = setImageAspectRatio;
    window.IdoFront.geminiChannel.setImageSize = setImageSize;
    window.IdoFront.geminiChannel.setResponseModality = setResponseModality;
    window.IdoFront.geminiChannel.setImageForceThinking = setImageForceThinking;
    window.IdoFront.geminiChannel.loadImageGenRules = loadImageGenRules;
    window.IdoFront.geminiChannel.saveImageGenRules = saveImageGenRules;
    window.IdoFront.geminiChannel.ASPECT_RATIO_OPTIONS = ASPECT_RATIO_OPTIONS;
    window.IdoFront.geminiChannel.IMAGE_SIZE_OPTIONS = IMAGE_SIZE_OPTIONS;
    window.IdoFront.geminiChannel.RESPONSE_MODALITY_OPTIONS = RESPONSE_MODALITY_OPTIONS;
    window.IdoFront.geminiChannel.DEFAULT_IMAGE_GEN_RULES = DEFAULT_IMAGE_GEN_RULES;

})();