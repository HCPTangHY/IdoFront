/**
 * Message Actions
 * 消息发送和接收处理
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.messageActions = window.IdoFront.messageActions || {};

    let context = null;
    let store = null;
    let service = null;
    let utils = null;

    /**
     * 初始化消息处理模块
     */
    window.IdoFront.messageActions.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        service = window.IdoFront.service;
        utils = window.IdoFront.utils;
        

        // 注入编辑渲染器到 Framework
        if (context) {
            context.renderMessageEdit = window.IdoFront.messageActions.edit;
        }
    };

    /**
     * 判断某个对话是否有活跃的生成
     * 统一判断：检查 typingMessageId 是否存在且对话匹配
     */
    window.IdoFront.messageActions.hasActiveGeneration = function(convId) {
        if (!convId) return false;
        if (store.state.typingConversationId === convId && !!store.state.typingMessageId) {
            return true;
        }
        if (store.state.activeConversationId !== convId) {
            return false;
        }
        return !!(service && typeof service.hasActiveRequest === 'function' && service.hasActiveRequest());
    };

    function getMultiRoutePlugin() {
        return window.IdoFront && window.IdoFront.multiRoute;
    }

    function getMessageNodeBehaviors() {
        return window.IdoFront && window.IdoFront.messageNodeBehaviors;
    }

    function shouldHideMessageInConversationTree(message, conv) {
        const behaviors = getMessageNodeBehaviors();
        if (behaviors && typeof behaviors.shouldHideInConversationTree === 'function') {
            return behaviors.shouldHideInConversationTree(message, { conversation: conv }) === true;
        }
        return false;
    }

    function resolveExecutionPlan(conv) {
        const multiRoute = getMultiRoutePlugin();
        if (multiRoute && typeof multiRoute.getExecutionPlan === 'function') {
            const plan = multiRoute.getExecutionPlan(conv);
            if (Array.isArray(plan) && plan.length > 0) {
                return plan;
            }
        }

        return [{ index: 1, useCurrent: true, channelId: null, model: null }];
    }

    function shouldIncludeMessageInRequestContext(message, conv) {
        const behaviors = getMessageNodeBehaviors();
        if (behaviors && typeof behaviors.shouldIncludeInRequestContext === 'function') {
            return behaviors.shouldIncludeInRequestContext(message, { conversation: conv }) !== false;
        }
        return true;
    }

    function getMessageSendConstraint(message, conv) {
        const behaviors = getMessageNodeBehaviors();
        if (behaviors && typeof behaviors.getSendConstraint === 'function') {
            return behaviors.getSendConstraint(message, { conversation: conv });
        }
        return null;
    }

    function getMessageAttachmentList(message) {
        if (!message) return null;
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
            return message.attachments;
        }
        if (message.metadata && Array.isArray(message.metadata.attachments) && message.metadata.attachments.length > 0) {
            return message.metadata.attachments;
        }
        return null;
    }

    function showMessageActionToast(message, duration) {
        const text = typeof message === 'string' ? message.trim() : '';
        if (!text) return;
        try {
            const toast = window.Framework && window.Framework.ui && window.Framework.ui.showToast;
            if (typeof toast === 'function') {
                toast(text, duration || 2600);
                return;
            }
        } catch (e) {
            // ignore
        }
        try {
            alert(text);
        } catch (e) {
            // ignore
        }
    }

    function inferAttachmentKind(attachment) {
        const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
        if (attachmentsApi && typeof attachmentsApi.getAttachmentKind === 'function') {
            return attachmentsApi.getAttachmentKind(attachment && attachment.type, attachment && attachment.name);
        }

        const type = typeof attachment?.type === 'string' ? attachment.type.trim().toLowerCase() : '';
        const name = typeof attachment?.name === 'string' ? attachment.name.trim().toLowerCase() : '';
        if (type.startsWith('image/')) return 'image';
        if (type === 'application/pdf') return 'pdf';
        if (type.startsWith('audio/')) return 'audio';
        if (
            type.startsWith('text/') ||
            type === 'application/json' ||
            type === 'application/xml' ||
            type === 'application/javascript' ||
            type === 'application/x-javascript' ||
            type === 'application/typescript' ||
            type === 'application/x-typescript' ||
            type === 'application/x-yaml' ||
            type === 'application/yaml'
        ) {
            return 'text';
        }
        if (/\.(txt|md|markdown|json|xml|html|htm|csv|tsv|log|yaml|yml|toml|ini|cfg|conf|js|ts|jsx|tsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|sql|sh|bat|ps1)$/i.test(name)) {
            return 'text';
        }
        if (/\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|weba|webm)$/i.test(name)) {
            return 'audio';
        }
        return 'other';
    }

    function validateMusicAttachmentsForTarget(target, attachments) {
        if (!target || target.error || !target.channel || target.channel.type !== 'gemini') {
            return { valid: true };
        }

        const geminiChannel = window.IdoFront && window.IdoFront.geminiChannel;
        if (!geminiChannel || typeof geminiChannel.supportsMusicGeneration !== 'function') {
            return { valid: true };
        }

        const modelName = target.selectedModel || target.channel.model || '';
        if (!geminiChannel.supportsMusicGeneration(modelName, target.channel)) {
            return { valid: true };
        }

        const list = Array.isArray(attachments) ? attachments : [];
        let imageCount = 0;
        for (const attachment of list) {
            const kind = inferAttachmentKind(attachment);
            if (kind === 'image') {
                imageCount += 1;
                continue;
            }
            if (kind === 'text') {
                continue;
            }
            return {
                valid: false,
                message: `${modelName || 'Lyria 3'} 仅支持文本和图片输入。`
            };
        }

        if (imageCount > 10) {
            return {
                valid: false,
                message: `${modelName || 'Lyria 3'} 一次请求最多支持 10 张图片。`
            };
        }

        return { valid: true };
    }

    function validateMusicAttachmentsForConversation(conv, attachments) {
        if (!conv) return { valid: true };
        const plan = resolveExecutionPlan(conv);
        for (const route of plan) {
            const target = resolveGenerationTarget(conv, {
                overrideChannelId: route && route.useCurrent ? null : route && route.channelId,
                overrideModel: route && route.useCurrent ? null : route && route.model
            });
            const validation = validateMusicAttachmentsForTarget(target, attachments);
            if (!validation.valid) {
                return validation;
            }
        }
        return { valid: true };
    }

    function getAttachmentsFromConversationMessage(conv, messageId) {
        if (!conv || !messageId || !Array.isArray(conv.messages)) return [];
        const message = conv.messages.find(item => item && item.id === messageId);
        return getMessageAttachmentList(message) || [];
    }

    function updateSendButtonLoadingState() {
        if (!context || typeof context.setSendButtonLoading !== 'function') {
            return;
        }

        if (service && typeof service.hasActiveRequest === 'function' && service.hasActiveRequest()) {
            context.setSendButtonLoading(true);
            return;
        }

        const activeConv = store && typeof store.getActiveConversation === 'function'
            ? store.getActiveConversation()
            : null;
        if (activeConv && store.state.typingMessageId) {
            const activePath = store.getActivePath(activeConv.id);
            const stillGenerating = activePath.some(m => m.id === store.state.typingMessageId);
            context.setSendButtonLoading(stillGenerating);
            return;
        }

        context.setSendButtonLoading(false);
    }

    async function dispatchResponses(conv, relatedUserMessageId, parentIdForNewBranch, dispatchOptions) {
        const options = dispatchOptions && typeof dispatchOptions === 'object' ? dispatchOptions : {};
        const plan = resolveExecutionPlan(conv);
        const activePath = store.getActivePath(conv.id).slice();
        const branchParentMessageId = parentIdForNewBranch !== undefined ? parentIdForNewBranch : relatedUserMessageId;
        const groupAnchorMessageId = options.groupAnchorMessageId || branchParentMessageId;
        const anchorIndex = branchParentMessageId ? activePath.findIndex(m => m.id === branchParentMessageId) : -1;
        const pathSnapshot = anchorIndex >= 0
            ? activePath.slice(0, anchorIndex + 1)
            : activePath;
        const multiRoute = window.IdoFront && window.IdoFront.multiRoute;

        if (plan.length <= 1) {
            await generateResponse(conv, relatedUserMessageId, parentIdForNewBranch, {
                pathSnapshot,
                routeIndex: 1,
                clearBranchSelection: !!options.clearBranchSelection
            });
            return;
        }

        const group = multiRoute && typeof multiRoute.createExecutionGroup === 'function'
            ? multiRoute.createExecutionGroup(conv.id, groupAnchorMessageId, plan, {
                source: options.source || 'send',
                branchParentId: branchParentMessageId,
                reuseGroupId: options.reuseMultiRouteGroupId || null,
                replaceExistingBranchGroup: options.replaceExistingBranchGroup === true
            })
            : null;

        if (!group) {
            for (const route of plan) {
                await generateResponse(conv, relatedUserMessageId, parentIdForNewBranch, {
                    pathSnapshot,
                    routeIndex: route.index || 1,
                    overrideChannelId: route.useCurrent ? null : route.channelId,
                    overrideModel: route.useCurrent ? null : route.model
                });
            }
            return;
        }

        const branchParentKey = branchParentMessageId === undefined || branchParentMessageId === null ? 'root' : branchParentMessageId;
        if (conv.activeBranchMap) {
            conv.activeBranchMap[branchParentKey] = group.nodeMessageId;
            delete conv.activeBranchMap[group.nodeMessageId];
            if (typeof store._invalidateActivePathCache === 'function') {
                store._invalidateActivePathCache(conv.id);
            }
            if (typeof store.persistSilent === 'function') {
                store.persistSilent();
            } else {
                store.persist();
            }
        }

        const conversationActions = window.IdoFront && window.IdoFront.conversationActions;
        if (conversationActions && typeof conversationActions.syncUI === 'function') {
            requestAnimationFrame(() => {
                try {
                    if (groupAnchorMessageId) {
                        conversationActions.syncUI({
                            focusMessageId: groupAnchorMessageId,
                            incrementalFromParent: true,
                            skipConversationListUpdate: true,
                            asyncMarkdown: true
                        });
                    } else {
                        conversationActions.syncUI({ asyncMarkdown: true });
                    }
                } catch (e) {
                    console.warn('[MessageActions] multi-route syncUI failed:', e);
                }
            });
        }

        const tasks = plan.map((route, index) => {
            const routeIndex = route.index || (index + 1);
            const groupRoute = Array.isArray(group.routes)
                ? group.routes.find(item => item && item.routeIndex === routeIndex)
                : null;

            return generateResponse(conv, relatedUserMessageId, group.nodeMessageId, {
                pathSnapshot,
                routeIndex,
                overrideChannelId: route.useCurrent ? null : route.channelId,
                overrideModel: route.useCurrent ? null : route.model,
                streamOverride: index === 0 ? undefined : false,
                setAsCurrent: index === 0,
                trackTyping: false,
                keepBranchActive: false,
                clearBranchSelection: true,
                multiRouteGroupId: group.id,
                multiRouteRouteId: groupRoute ? groupRoute.id : null,
                multiRouteDetached: false,
                multiRouteEmbedded: true
            });
        });

        await Promise.allSettled(tasks);
    }

    /**
     * 统一的 UI 渲染判断函数
     * 核心逻辑：正在生成的消息 ID 是否在当前活跃路径中
     * @param {string} convId - 对话 ID
     * @param {string} messageId - 消息 ID
     * @returns {boolean} 是否应该渲染 UI
     */
    function shouldRenderUI(convId, messageId) {
        if (!convId || !messageId) return false;
        if (store.state.activeConversationId !== convId) return false;
        
        const activePath = store.getActivePath(convId);
        return activePath.some(m => m.id === messageId);
    }

    async function buildMessagesPayloadWithToolTurns(conv, excludeMessageId, channelConfig, sourcePath) {
        const activePersona = store.getActivePersona();
        const messagesPayload = [];

        if (activePersona && activePersona.systemPrompt) {
            messagesPayload.push({ role: 'system', content: activePersona.systemPrompt });
        }

        if (activePersona && activePersona.contextMessages && activePersona.contextMessages.length > 0) {
            activePersona.contextMessages.forEach(msg => {
                messagesPayload.push({ role: msg.role, content: msg.content });
            });
        }

        const activePath = Array.isArray(sourcePath) ? sourcePath : store.getActivePath(conv.id);
        const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
        const attachmentDataUrlCache = new Map();
        const toolCallTypes = window.IdoFront.toolCallTypes;

        const isGemini = channelConfig && (channelConfig.type === 'gemini' || channelConfig.type === 'gemini-deep-research');

        let isGeminiMusicGen = false;

        if (isGemini) {
            try {
                const geminiChannel = window.IdoFront && window.IdoFront.geminiChannel;
                const currentModel = (channelConfig && channelConfig.model) || conv.selectedModel || '';
                if (geminiChannel && typeof geminiChannel.supportsMusicGeneration === 'function') {
                    isGeminiMusicGen = !!geminiChannel.supportsMusicGeneration(currentModel, channelConfig);
                }
            } catch (e) {
                isGeminiMusicGen = false;
            }
        }


        let isGeminiImageGen = false;

        if (isGemini) {
            try {
                const geminiChannel = window.IdoFront && window.IdoFront.geminiChannel;
                const currentModel = (channelConfig && channelConfig.model) || conv.selectedModel || '';
                if (geminiChannel && typeof geminiChannel.supportsImageGeneration === 'function') {
                    isGeminiImageGen = !!geminiChannel.supportsImageGeneration(currentModel, channelConfig);
                }
            } catch (e) {
                isGeminiImageGen = false;
            }
        }

        // Android + Gemini 生图：请求侧使用 Blob 模式传递历史图片附件，
        // 避免多张 base64 dataUrl 同时驻留 JS 堆导致内存峰值过高。
        const useImageBlobMode = isGeminiImageGen && (function() {
            try {
                if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return true;
                const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? String(navigator.userAgent) : '';
                return /Android/i.test(ua);
            } catch (e) {
                return false;
            }
        })();

        let geminiMusicAttachmentMessageId = null;
        if (isGeminiMusicGen) {
            for (let i = activePath.length - 1; i >= 0; i -= 1) {
                const item = activePath[i];
                if (!item || item.id === excludeMessageId || item.role !== 'user') continue;
                const atts = getMessageAttachmentList(item);
                if (!atts || atts.length === 0) continue;
                geminiMusicAttachmentMessageId = item.id;
                break;
            }
        }

        for (const m of activePath) {
            if (!m || m.id === excludeMessageId) continue;

            // 不持久化/不透传历史中的 tool 消息（旧数据兼容：避免重复 functionResponse）
            if (m.role === 'tool') continue;
            if (!shouldIncludeMessageInRequestContext(m, conv)) continue;
            // 多路候选仅在被选中并位于 activePath 时才应进入上下文；
            // 这里 activePath 已经保证了这一点，因此无需额外过滤 embedded 消息。

            const msg = { role: m.role, content: m.content };

            // 附件：从 store 的轻量引用解析为 dataUrl
            let rawAttachments = getMessageAttachmentList(m);

            if (rawAttachments && rawAttachments.length > 0 && m.role !== 'user') {
                rawAttachments = rawAttachments.filter(att => inferAttachmentKind(att) !== 'audio');
                if (rawAttachments.length === 0) {
                    rawAttachments = null;
                }
            }

            if (isGeminiMusicGen && rawAttachments && rawAttachments.length > 0) {
                if (m.role !== 'user') {
                    rawAttachments = null;
                } else if (geminiMusicAttachmentMessageId && m.id !== geminiMusicAttachmentMessageId) {
                    rawAttachments = null;
                }
            }

            if (rawAttachments && rawAttachments.length > 0) {
                if (!msg.metadata) msg.metadata = {};

                if (attachmentsApi && typeof attachmentsApi.resolveAttachmentsForPayload === 'function') {
                    // eslint-disable-next-line no-await-in-loop
                    const payloadAttachments = await attachmentsApi.resolveAttachmentsForPayload(rawAttachments, {
                        cache: useImageBlobMode ? null : attachmentDataUrlCache,
                        allowAudio: !isGeminiMusicGen,
                        allowPdf: !isGeminiMusicGen,
                        allowText: true,
                        allowImages: true,
                        // Blob 模式下仍需限制图片数量：convertMessages 最终会把所有 Blob
                        // 转为 base64 并序列化到同一个 JSON 请求体，图片过多时峰值仍然很高。
                        maxImages: isGeminiMusicGen ? 10 : (useImageBlobMode ? 4 : undefined),
                        returnBlobs: useImageBlobMode
                    });
                    if (payloadAttachments && payloadAttachments.length > 0) {
                        msg.metadata.attachments = payloadAttachments;
                    }
                } else {
                    msg.metadata.attachments = rawAttachments;
                }
            }

            // 透传渠道 metadata（如 Gemini 的 thoughtSignature）
            if (m.metadata) {
                const meta = { ...m.metadata };
                if (meta.attachments) delete meta.attachments;
                msg.metadata = { ...(msg.metadata || {}), ...meta };
            }

            // Gemini：把 toolCalls 展开为 functionCall + functionResponse（必须成对出现）
            // 为了避免“历史不完整”导致 Gemini 报错：只有当 toolCalls 全部完成时才展开。
            if (isGemini && m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
                const completed = !!(toolCallTypes && toolCallTypes.allCompleted({ toolCalls: m.toolCalls }));
                if (completed) {
                    msg.functionCalls = m.toolCalls.map(tc => ({ name: tc.name, args: tc.args || {} }));
                    messagesPayload.push(msg);

                    const toolResponses = m.toolCalls.map(tc => ({
                        name: tc.name,
                        response: tc.status === toolCallTypes.Status.SUCCESS
                            ? { result: tc.result }
                            : { error: tc.error || 'Tool execution failed' }
                    }));

                    const toolMessage = { role: 'tool', toolResponses };
                    const thoughtSignature = m.metadata?.gemini?.thoughtSignature;
                    if (thoughtSignature) {
                        toolMessage.metadata = { gemini: { thoughtSignature } };
                    }

                    messagesPayload.push(toolMessage);
                    continue;
                }
                // 未完成：只发送文本/附件/metadata，不发送 functionCall，避免历史断裂
            }

            messagesPayload.push(msg);
        }

        return messagesPayload;
    }

    async function continueAfterToolCalls(conv, channelConfig, fromAssistantMessage, options) {
        const toolCallTypes = window.IdoFront.toolCallTypes;
        const toolRegistry = window.IdoFront.toolRegistry;
        const toolCallRenderer = window.IdoFront.toolCallRenderer;
        const multiRoute = window.IdoFront && window.IdoFront.multiRoute;

        if (!toolCallTypes || !toolRegistry) return;

        const continuationOptions = options && typeof options === 'object' ? options : {};
        const trackTyping = continuationOptions.trackTyping !== false;
        const setAsCurrent = continuationOptions.setAsCurrent !== false;
        const maxTurns = 6;
        let parent = fromAssistantMessage;
        let lastTypingMessageId = null;
        let parentMultiRouteMeta = null;

        try {
            for (let turn = 0; turn < maxTurns; turn++) {
            // 创建新消息作为后续模型回复
            const nextAssistant = {
                id: utils.createId('msg_a'),
                role: 'assistant',
                content: '',
                createdAt: Date.now(),
                timestamp: new Date().toISOString(),
                modelName: parent.modelName,
                channelName: parent.channelName
            };

            parentMultiRouteMeta = parent && parent.metadata && parent.metadata.multiRoute
                ? parent.metadata.multiRoute
                : null;
            if (parentMultiRouteMeta) {
                nextAssistant.metadata = nextAssistant.metadata || {};
                nextAssistant.metadata.multiRoute = {
                    groupId: parentMultiRouteMeta.groupId,
                    routeId: parentMultiRouteMeta.routeId,
                    routeIndex: parentMultiRouteMeta.routeIndex,
                    rootMessageId: parentMultiRouteMeta.rootMessageId || parent.id
                };
            }

            store.addMessageToConversation(conv.id, nextAssistant, parent.id);

            if (parentMultiRouteMeta && multiRoute && typeof multiRoute.adoptContinuationMessage === 'function') {
                multiRoute.adoptContinuationMessage(conv.id, parentMultiRouteMeta.groupId, parentMultiRouteMeta.routeId, nextAssistant);
            }

            if (context && context.addMessage && shouldRenderUI(conv.id, nextAssistant.id)) {
                context.addMessage('ai', {
                    content: '',
                    id: nextAssistant.id,
                    modelName: nextAssistant.modelName,
                    channelName: nextAssistant.channelName
                });
            }

            // 标记当前正在生成（避免外层 finally 清理状态）
            if (trackTyping) {
                store.state.isTyping = true;
                store.state.typingConversationId = conv.id;
                store.state.typingMessageId = nextAssistant.id;
                lastTypingMessageId = nextAssistant.id;
                store.persist();
            }

            // 发送按钮进入 loading（仅当前活跃路径）
            if (trackTyping && context && context.setSendButtonLoading && shouldRenderUI(conv.id, nextAssistant.id)) {
                context.setSendButtonLoading(true);
            }

            // ========== 流式生成后续消息 ==========
            const requestStartTime = Date.now();
            let firstTokenTime = null;
            let firstContentTime = null;
            let streamEnded = false;
            let fullContent = '';
            let fullReasoning = null;
            let finalAssistantAttachments = null;

            // 绑定流式指示器到该条消息
            let loadingId = null;
            let loadingAttached = false;
            if (context && shouldRenderUI(conv.id, nextAssistant.id) && context.addLoadingIndicator && context.attachLoadingIndicatorToMessage) {
                loadingId = context.addLoadingIndicator();
                loadingAttached = context.attachLoadingIndicatorToMessage(loadingId, nextAssistant.id);
                if (!loadingAttached && context.removeLoadingIndicator) {
                    context.removeLoadingIndicator(loadingId);
                    loadingId = null;
                }
            }

            const onUpdate = (data) => {
                if (streamEnded) return;
                if (trackTyping && store.state.typingMessageId !== nextAssistant.id) return;

                parentMultiRouteMeta = nextAssistant && nextAssistant.metadata && nextAssistant.metadata.multiRoute ? nextAssistant.metadata.multiRoute : parentMultiRouteMeta;

                let currentContent = '';
                let currentReasoning = null;
                let currentMetadata = null;

                if (typeof data === 'string') {
                    currentContent = data;
                } else if (typeof data === 'object' && data !== null) {
                    currentContent = data.content || '';
                    currentReasoning = data.reasoning || null;
                    currentMetadata = data.metadata || null;
                }

                if (!firstTokenTime && (currentContent || currentReasoning)) {
                    firstTokenTime = Date.now();
                }

                // 思维链计时（复用主流程逻辑）
                const currentReasoningLength = currentReasoning ? currentReasoning.length : 0;
                const prevReasoningLength = nextAssistant._prevReasoningLength || 0;
                const hasNewReasoning = currentReasoningLength > prevReasoningLength;

                if (hasNewReasoning && !nextAssistant.reasoningSegmentStart) {
                    nextAssistant.reasoningSegmentStart = Date.now();
                    if (nextAssistant.reasoningAccumulatedTime === undefined) {
                        nextAssistant.reasoningAccumulatedTime = 0;
                    }
                }

                if (currentReasoningLength > prevReasoningLength) {
                    nextAssistant._prevReasoningLength = currentReasoningLength;
                }

                if (currentContent && nextAssistant.reasoningSegmentStart) {
                    const segmentDuration = (Date.now() - nextAssistant.reasoningSegmentStart) / 1000;
                    nextAssistant.reasoningAccumulatedTime = (nextAssistant.reasoningAccumulatedTime || 0) + segmentDuration;
                    delete nextAssistant.reasoningSegmentStart;
                }

                if (!firstContentTime && currentContent) {
                    firstContentTime = Date.now();
                }

                fullContent = currentContent;
                fullReasoning = currentReasoning;

                // 附件：只用于 UI 展示，避免写入 Store（base64）
                let currentAttachments = null;
                if (data && Array.isArray(data.attachments)) {
                    currentAttachments = data.attachments;
                } else if (currentMetadata && Array.isArray(currentMetadata.attachments)) {
                    currentAttachments = currentMetadata.attachments;
                }

                if (currentAttachments && currentAttachments.length > 0) {
                    if (!finalAssistantAttachments) {
                        finalAssistantAttachments = [...currentAttachments];
                    } else {
                        currentAttachments.forEach(newAtt => {
                            const exists = finalAssistantAttachments.find(
                                existing => existing.name === newAtt.name && existing.size === newAtt.size
                            );
                            if (!exists) {
                                finalAssistantAttachments.push(newAtt);
                            }
                        });
                    }
                }

                nextAssistant.content = fullContent;
                if (fullReasoning) {
                    nextAssistant.reasoning = fullReasoning;
                }

                if (currentMetadata) {
                    const existingMultiRouteMeta = nextAssistant.metadata && nextAssistant.metadata.multiRoute
                        ? nextAssistant.metadata.multiRoute
                        : null;
                    const meta = { ...currentMetadata };
                    if (Array.isArray(meta.attachments)) delete meta.attachments;
                    nextAssistant.metadata = existingMultiRouteMeta ? { ...meta, multiRoute: existingMultiRouteMeta } : meta;
                }

                if (context && shouldRenderUI(conv.id, nextAssistant.id)) {
                    const isReasoningSegmentEnded = !!currentContent && !nextAssistant.reasoningSegmentStart;
                    const updatePayload = {
                        content: fullContent,
                        reasoning: fullReasoning,
                        streaming: true,
                        reasoningEnded: isReasoningSegmentEnded
                    };
                    if (finalAssistantAttachments && finalAssistantAttachments.length > 0) {
                        updatePayload.attachments = finalAssistantAttachments;
                    }

                    if (typeof context.updateMessageById === 'function') {
                        context.updateMessageById(nextAssistant.id, updatePayload);
                    } else if (typeof context.updateLastMessage === 'function') {
                        context.updateLastMessage(updatePayload);
                    }
                }

                if (parentMultiRouteMeta && multiRoute && typeof multiRoute.syncRoutePreview === 'function') {
                    multiRoute.syncRoutePreview(conv.id, parentMultiRouteMeta.groupId, parentMultiRouteMeta.routeId);
                }
            };

            // 构建 payload：包含历史中的 tool call / tool result turn
            const messagesPayload = await buildMessagesPayloadWithToolTurns(conv, nextAssistant.id, channelConfig);

            let response = null;
            try {
                const continuationConfig = { ...channelConfig, stream: true };
                response = await service.callAI(messagesPayload, continuationConfig, onUpdate, {
                    requestId: nextAssistant.id,
                    setAsCurrent
                });
            } catch (apiError) {
                if (apiError && apiError.name === 'AbortError') {
                    streamEnded = true;
                    fullContent = '✋ 已停止生成';
                    nextAssistant._stoppedByAbort = true;
                    nextAssistant.content = fullContent;
                    store.persist();

                    if (context && shouldRenderUI(conv.id, nextAssistant.id)) {
                        const updatePayload = { content: fullContent };
                        if (typeof context.updateMessageById === 'function') {
                            context.updateMessageById(nextAssistant.id, updatePayload);
                        } else if (typeof context.updateLastMessage === 'function') {
                            context.updateLastMessage(updatePayload);
                        }
                    }

                    // 停止后直接结束本轮
                    if (parentMultiRouteMeta && multiRoute && typeof multiRoute.markRouteFinished === 'function') {
                        multiRoute.markRouteFinished(conv.id, parentMultiRouteMeta.groupId, parentMultiRouteMeta.routeId, { status: 'stopped', currentMessageId: nextAssistant.id, messageId: nextAssistant.id, error: fullContent });
                    }

                    parent = nextAssistant;
                    break;
                }
                throw apiError;
            } finally {
                streamEnded = true;

                if (context && context.removeMessageStreamingIndicator && shouldRenderUI(conv.id, nextAssistant.id)) {
                    context.removeMessageStreamingIndicator(nextAssistant.id);
                }

                // 如果未成功附着（仍存在独立 loading bubble），需要移除
                if (loadingId && !loadingAttached && context && context.removeLoadingIndicator) {
                    context.removeLoadingIndicator(loadingId);
                }
            }

            const requestEndTime = Date.now();
            const totalDuration = (requestEndTime - requestStartTime) / 1000;
            let generationTime = null;
            if (firstContentTime) {
                generationTime = (requestEndTime - firstContentTime) / 1000;
            } else if (firstTokenTime) {
                generationTime = (requestEndTime - firstTokenTime) / 1000;
            }

            const usage = response?.usage || null;
            let tps = null;
            if (usage && usage.completion_tokens && generationTime && generationTime > 0) {
                tps = usage.completion_tokens / generationTime;
            } else if (usage && usage.completion_tokens && totalDuration > 0) {
                tps = usage.completion_tokens / totalDuration;
            }

            const stats = {
                duration: totalDuration,
                ttft: firstTokenTime ? (firstTokenTime - requestStartTime) / 1000 : null,
                ttfc: firstContentTime ? (firstContentTime - requestStartTime) / 1000 : null,
                generationTime: generationTime,
                usage: usage,
                tps: tps
            };

            // 从最终响应中兜底获取内容/思维链/附件
            const choice = response?.choices?.[0];
            const responseToolCalls = choice?.message?.tool_calls || null;

            if (!fullContent) {
                fullContent = choice?.message?.content || '';
                fullReasoning = choice?.message?.reasoning_content || null;
                if (fullContent) nextAssistant.content = fullContent;
                if (fullReasoning) nextAssistant.reasoning = fullReasoning;
            }

            // 处理 reasoningDuration（沿用主流程的累计逻辑）
            if (nextAssistant.reasoningSegmentStart) {
                const lastSegmentDuration = (Date.now() - nextAssistant.reasoningSegmentStart) / 1000;
                nextAssistant.reasoningAccumulatedTime = (nextAssistant.reasoningAccumulatedTime || 0) + lastSegmentDuration;
                delete nextAssistant.reasoningSegmentStart;
            }
            if (nextAssistant.reasoningAccumulatedTime !== undefined && nextAssistant.reasoningAccumulatedTime > 0) {
                nextAssistant.reasoningDuration = nextAssistant.reasoningAccumulatedTime;
                delete nextAssistant.reasoningAccumulatedTime;
            }

            // 保存 stats
            nextAssistant.stats = stats;

            // 附件外置化：写入 Store 的引用
            const finalFromResponse = choice?.message?.attachments || null;
            const attachmentsToPersist = (finalAssistantAttachments && finalAssistantAttachments.length > 0)
                ? finalAssistantAttachments
                : (finalFromResponse && Array.isArray(finalFromResponse) ? finalFromResponse : null);

            if (attachmentsToPersist && attachmentsToPersist.length > 0) {
                const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
                if (attachmentsApi && typeof attachmentsApi.normalizeAttachmentsForState === 'function') {
                    try {
                        const normalized = await attachmentsApi.normalizeAttachmentsForState(attachmentsToPersist, { source: 'assistant' });
                        if (normalized && Array.isArray(normalized.attachments) && normalized.attachments.length > 0) {
                            nextAssistant.attachments = normalized.attachments;
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }

            // 释放 Blob 模式 / Gemini 生图产生的临时 ObjectURL，避免内存泄漏
            if (attachmentsToPersist) {
                for (const att of attachmentsToPersist) {
                    if (!att) continue;
                    try {
                        if (typeof att.dataUrl === 'string' && att.dataUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(att.dataUrl);
                        }
                        att.blob = null;
                        att.dataUrl = null;
                    } catch (_) {}
                }
            }

            // 保存 metadata（剥离 attachments）
            const metadata = choice?.message?.metadata || null;
            if (metadata) {
                const existingMultiRouteMeta = nextAssistant.metadata && nextAssistant.metadata.multiRoute
                    ? nextAssistant.metadata.multiRoute
                    : null;
                const meta = { ...metadata };
                if (Array.isArray(meta.attachments)) delete meta.attachments;
                nextAssistant.metadata = existingMultiRouteMeta ? { ...meta, multiRoute: existingMultiRouteMeta } : meta;
            }

            // 最终持久化
            store.persist();

            if (context && shouldRenderUI(conv.id, nextAssistant.id)) {
                const updatePayload = {
                    content: nextAssistant.content,
                    reasoning: nextAssistant.reasoning || null,
                    attachments: nextAssistant.attachments || null
                };

                if (typeof context.updateMessageById === 'function') {
                    context.updateMessageById(nextAssistant.id, updatePayload);
                } else if (typeof context.updateLastMessage === 'function') {
                    context.updateLastMessage(updatePayload);
                }

                if (typeof context.finalizeStreamingMessageById === 'function') {
                    context.finalizeStreamingMessageById(nextAssistant.id, stats);
                } else if (typeof context.finalizeStreamingMessage === 'function') {
                    context.finalizeStreamingMessage(stats);
                }
            } else if (parentMultiRouteMeta && multiRoute && typeof multiRoute.syncRoutePreview === 'function') {
                multiRoute.syncRoutePreview(conv.id, parentMultiRouteMeta.groupId, parentMultiRouteMeta.routeId);
            }

            // 没有新的工具调用：结束循环
            if (!responseToolCalls || responseToolCalls.length === 0) {
                parent = nextAssistant;
                break;
            }

            // 记录新的工具调用，并在这一条消息内执行
            const toolCalls = toolCallTypes.createFromResponse(responseToolCalls);
            // 补充 displayName（用于 UI 展示）
            if (toolRegistry && typeof toolRegistry.resolve === 'function') {
                toolCalls.forEach(tc => {
                    const def = toolRegistry.resolve(tc.name);
                    if (def && def.name) {
                        tc.displayName = def.name;
                    }
                });
            }
            nextAssistant.toolCalls = toolCalls;
            nextAssistant.updatedAt = Date.now();
            store.persist();

            // 工具开始执行时，停止该条消息的“流式三点”指示器
            if (context && context.removeMessageStreamingIndicator && shouldRenderUI(conv.id, nextAssistant.id)) {
                context.removeMessageStreamingIndicator(nextAssistant.id);
            }

            if (context && shouldRenderUI(conv.id, nextAssistant.id)) {
                const updatePayload = { content: nextAssistant.content || '', toolCalls };
                if (typeof context.updateMessageById === 'function') {
                    context.updateMessageById(nextAssistant.id, updatePayload);
                } else if (typeof context.updateLastMessage === 'function') {
                    context.updateLastMessage(updatePayload);
                }
            }

            for (const tc of toolCalls) {
                toolCallTypes.updateStatus(tc, 'running');
                nextAssistant.updatedAt = Date.now();
                if (toolCallRenderer && shouldRenderUI(conv.id, nextAssistant.id)) {
                    toolCallRenderer.updateUI(nextAssistant.id, tc.id, { status: 'running' });
                }

                try {
                    const def = toolRegistry && typeof toolRegistry.resolve === 'function'
                        ? toolRegistry.resolve(tc.name)
                        : null;

                    if (def && def.id && store && typeof store.getToolStateForConversation === 'function') {
                        const enabled = store.getToolStateForConversation(conv.id, def.id);
                        if (!enabled) {
                            toolCallTypes.updateStatus(tc, 'error', null, '该工具在当前会话已禁用');
                            nextAssistant.updatedAt = Date.now();
                            if (toolCallRenderer && shouldRenderUI(conv.id, nextAssistant.id)) {
                                toolCallRenderer.updateUI(nextAssistant.id, tc.id, {
                                    status: tc.status,
                                    result: tc.result,
                                    error: tc.error,
                                    duration: tc.duration
                                });
                            }
                            continue;
                        }
                    }

                    const result = await toolRegistry.execute(tc.name, tc.args);
                    if (result.success) {
                        toolCallTypes.updateStatus(tc, 'success', result.result);
                        nextAssistant.updatedAt = Date.now();
                    } else {
                        toolCallTypes.updateStatus(tc, 'error', null, result.error);
                        nextAssistant.updatedAt = Date.now();
                    }
                } catch (e) {
                    toolCallTypes.updateStatus(tc, 'error', null, e.message);
                    nextAssistant.updatedAt = Date.now();
                }

                if (toolCallRenderer && shouldRenderUI(conv.id, nextAssistant.id)) {
                    toolCallRenderer.updateUI(nextAssistant.id, tc.id, {
                        status: tc.status,
                        result: tc.result,
                        error: tc.error,
                        duration: tc.duration
                    });
                }
            }

            store.persist();
            parent = nextAssistant;

            if (parentMultiRouteMeta && multiRoute && typeof multiRoute.syncRoutePreview === 'function') {
                multiRoute.syncRoutePreview(conv.id, parentMultiRouteMeta.groupId, parentMultiRouteMeta.routeId);
            }
        }
            return parent;
        } finally {
            // 清理 typing 状态（仅当本函数仍是最新生成）
            if (trackTyping && lastTypingMessageId && store.state.typingMessageId === lastTypingMessageId) {
                store.state.isTyping = false;
                store.state.typingConversationId = null;
                store.state.typingMessageId = null;
                store.persist();
            }

            // 恢复发送按钮状态
            updateSendButtonLoadingState();
        }
    }

    /**
     * 发送消息
     */
    window.IdoFront.messageActions.send = async function(text, attachments = null) {
        // 在非 chat 主视图模式下，不走聊天消息管线（供自定义主视图模式接管）
        if (context && typeof context.getCurrentMode === 'function') {
            const mode = context.getCurrentMode();
            if (mode && mode !== 'chat') {
                return;
            }
        }
 
        if (!text && (!attachments || attachments.length === 0)) return;
 
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const conv = store.ensureActiveConversation();

        // 分层恢复场景：发送前确保当前会话历史已加载，避免把新消息挂到“空历史”上
        if (conv && conv.messagesLoaded === false && typeof store.ensureConversationMessagesLoaded === 'function') {
            try {
                await store.ensureConversationMessagesLoaded(conv.id);
            } catch (e) {
                console.warn('[messageActions.send] ensureConversationMessagesLoaded failed:', conv.id, e);
            }
        }

        const activePathBeforeSend = conv ? store.getActivePath(conv.id) : [];
        const activeLeaf = activePathBeforeSend.length > 0 ? activePathBeforeSend[activePathBeforeSend.length - 1] : null;
        const sendConstraint = getMessageSendConstraint(activeLeaf, conv);
        if (sendConstraint && sendConstraint.blocked) {
            showMessageActionToast(sendConstraint.message || '当前节点不可直接继续发送');
            return;
        }

        const musicInputValidation = validateMusicAttachmentsForConversation(conv, attachments);
        if (!musicInputValidation.valid) {
            showMessageActionToast(musicInputValidation.message);
            return;
        }

        // 1. Create User Message
        const userMessage = {
            id: utils.createId('msg_u'),
            role: 'user',
            content: text || '',
            createdAt: now,
            timestamp,
            plugin: null
        };

        // 附件外置化：Blob 存 pluginData（IndexedDB），消息里只保存轻量引用，
        // 避免 base64 dataUrl 被写入 core.chat.state 导致秒级卡顿。
        let attachmentRefs = null;
        if (attachments && attachments.length > 0) {
            const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
            if (attachmentsApi && typeof attachmentsApi.normalizeAttachmentsForState === 'function') {
                try {
                    const normalized = await attachmentsApi.normalizeAttachmentsForState(attachments, { source: 'user' });
                    attachmentRefs = normalized && Array.isArray(normalized.attachments) ? normalized.attachments : [];
                } catch (e) {
                    console.warn('[messageActions.send] normalizeAttachmentsForState failed:', e);
                    attachmentRefs = [];
                }
            } else {
                attachmentRefs = attachments;
            }
        }

        if (attachmentRefs && attachmentRefs.length > 0) {
            userMessage.attachments = attachmentRefs;
        }

        store.addMessageToConversation(conv.id, userMessage);
        
        // UI Update - 传递附件信息和ID
        if (context) {
            context.addMessage('user', {
                content: userMessage.content,
                attachments: attachments,
                id: userMessage.id
            });
        }

        await dispatchResponses(conv, userMessage.id);
    };

    /**
     * 编辑消息 - 新卡片设计
     * @param {string} messageId - 要编辑的消息ID
     */
    window.IdoFront.messageActions.edit = function(messageId) {
        const conv = store.getActiveConversation();
        if (!conv) return;

        const targetMsg = conv.messages.find(m => m.id === messageId);
        if (!targetMsg) return;

        // 获取消息卡片
        const chatStream = document.getElementById('chat-stream');
        if (!chatStream) return;
        
        const messageCard = chatStream.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageCard) return;

        const container = messageCard.querySelector('.ido-message__container');
        const contentDiv = container.querySelector('.ido-message__content');
        const contentSpan = contentDiv?.querySelector('.message-content');
        if (!container || !contentDiv || !contentSpan) return;

        // 保存原始内容和附件
        const originalContent = targetMsg.content;
        const originalAttachments = targetMsg.attachments || [];
        
        // 编辑中的附件列表
        let editingAttachments = JSON.parse(JSON.stringify(originalAttachments));

        // 进入编辑模式
        messageCard.classList.add('ido-message--editing');
        
        // 隐藏原始内容
        contentSpan.style.display = 'none';
        
        // 移除原始附件预览（含大图/灯箱），编辑态由新的附件列表接管
        // 匹配新版附件容器类名 .ido-message__attachments
        const originalAttachmentBlocks = Array.from(container.querySelectorAll('.ido-message__attachments, .flex.gap-2.flex-wrap.mb-2'));
        originalAttachmentBlocks.forEach(block => block.remove());

        // 创建 textarea
        const textarea = document.createElement('textarea');
        textarea.className = 'ido-message__edit-textarea';
        textarea.value = originalContent;
        textarea.placeholder = '编辑消息...';
        
        // 自适应高度
        const adjustHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 500) + 'px';
        };
        textarea.oninput = adjustHeight;
        
        contentDiv.insertBefore(textarea, contentSpan);

        // 附件区域：列表 + 添加按钮 + 隐藏文件输入，样式沿用底部输入区的附件样式
        const attachmentsWrapper = document.createElement('div');
        attachmentsWrapper.className = 'message-edit-attachments';

        const attachmentList = document.createElement('div');
        attachmentList.className = 'message-edit-attachment-list';

        const fallbackAcceptedFileTypes = [
            'image/*',
            'application/pdf',
            '.pdf',
            'text/*',
            'application/json',
            'application/xml',
            'application/javascript',
            'application/x-javascript',
            'application/typescript',
            'application/x-typescript',
            'application/x-yaml',
            'application/yaml',
            '.txt,.md,.markdown,.json,.xml,.html,.htm,.csv,.tsv,.log,.yaml,.yml,.toml,.ini,.cfg,.conf,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.bat,.ps1'
        ].join(',');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = (window.IdoFront && window.IdoFront.fileUpload && typeof window.IdoFront.fileUpload.getAcceptedFileTypes === 'function') ? window.IdoFront.fileUpload.getAcceptedFileTypes() : fallbackAcceptedFileTypes;
        fileInput.style.display = 'none';

        const renderAttachments = () => {
            attachmentList.innerHTML = '';
            editingAttachments.forEach((att, index) => {
                const preview = createAttachmentPreview(att, () => {
                    editingAttachments.splice(index, 1);
                    renderAttachments();
                });
                attachmentList.appendChild(preview);
            });
            // 当没有附件时收起列表，只保留添加按钮的紧凑布局
            attachmentList.style.display = editingAttachments.length > 0 ? 'flex' : 'none';
        };

        // 支持粘贴图片到编辑态（与底部输入框体验一致）
        textarea.addEventListener('paste', async (e) => {
            const clipboardData = e.clipboardData;
            if (!clipboardData) return;

            // 1. 处理超长文本粘贴
            const text = clipboardData.getData('text/plain');
            if (text && text.length >= 12 * 1024) {
                e.preventDefault();
                const fileName = `pasted-text-${Date.now().toString(36)}.txt`;
                const file = new File([text], fileName, { type: 'text/plain' });
                editingAttachments.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    file: file
                });
                renderAttachments();
                return;
            }

            // 2. 处理图片粘贴
            const items = clipboardData.items;
            const files = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }

            if (files.length === 0) return;
            e.preventDefault();

            for (const file of files) {
                // 10MB 限制，与底部上传一致
                if (file.size > 10 * 1024 * 1024) {
                    alert(`文件 ${file.name} 超过10MB限制`);
                    continue;
                }
                try {
                    const dataUrl = await readFileAsDataURL(file);
                    editingAttachments.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        dataUrl
                    });
                } catch (err) {
                    console.warn('粘贴图片读取失败:', err);
                }
            }
            renderAttachments();
        });

        const addButton = document.createElement('button');
        addButton.className = 'message-edit-add-attachment';
        addButton.type = 'button';
        addButton.innerHTML = '<span class="material-symbols-outlined">attach_file</span><span>添加附件</span>';
        addButton.onclick = () => fileInput.click();

        fileInput.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            for (const file of files) {
                try {
                    const dataUrl = await readFileAsDataURL(file);
                    editingAttachments.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        dataUrl
                    });
                } catch (err) {
                    console.warn('读取附件失败:', err);
                }
            }
            fileInput.value = '';
            renderAttachments();
        };

        attachmentsWrapper.appendChild(attachmentList);
        attachmentsWrapper.appendChild(addButton);
        attachmentsWrapper.appendChild(fileInput);
        contentDiv.insertBefore(attachmentsWrapper, contentSpan);
        renderAttachments();
        
        // 调整初始高度
        setTimeout(() => {
            adjustHeight();
            textarea.focus();
            textarea.select();
        }, 0);

        // 取消编辑
        const cancelEdit = () => {
            textarea.remove();
            attachmentsWrapper.remove();
            // 恢复原始附件预览显示
            originalAttachmentBlocks.forEach(block => block.style.display = '');
            contentSpan.style.display = '';
            messageCard.classList.remove('ido-message--editing');
        };

        // 保存编辑
        const saveEdit = async () => {
            const newContent = textarea.value.trim();
            if (!newContent && editingAttachments.length === 0) {
                alert('消息内容不能为空');
                return;
            }

            // 用户消息：创建分支而非截断
            // AI 消息：只保存修改，不截断，不重新生成
            if (targetMsg.role === 'user') {
                const musicInputValidation = validateMusicAttachmentsForConversation(conv, editingAttachments);
                if (!musicInputValidation.valid) {
                    showMessageActionToast(musicInputValidation.message);
                    return;
                }

                // 找到被编辑消息的父消息 ID
                const parentId = targetMsg.parentId !== undefined ? targetMsg.parentId : null;
                
                // 创建新的用户消息作为分支
                const now = Date.now();
                const newUserMessage = {
                    id: utils.createId('msg_u'),
                    role: 'user',
                    content: newContent,
                    createdAt: now,
                    timestamp: new Date(now).toISOString(),
                    plugin: null
                };
                
                if (editingAttachments.length > 0) {
                    const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
                    if (attachmentsApi && typeof attachmentsApi.normalizeAttachmentsForState === 'function') {
                        try {
                            const normalized = await attachmentsApi.normalizeAttachmentsForState(editingAttachments, { source: 'user' });
                            if (normalized && Array.isArray(normalized.attachments) && normalized.attachments.length > 0) {
                                newUserMessage.attachments = normalized.attachments;
                            }
                        } catch (e) {
                            console.warn('[messageActions.edit] normalizeAttachmentsForState failed:', e);
                        }
                    } else {
                        // fallback：保持原逻辑（可能包含 dataUrl）
                        newUserMessage.attachments = editingAttachments;
                    }
                }
                
                // 使用 createBranch 创建分支（会自动设置 parentId 并切换到新分支）
                store.createBranch(conv.id, parentId, newUserMessage);
                
                // 同步UI
                if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                    window.IdoFront.conversationActions.syncUI();
                }
                
                // 生成新的响应
                await dispatchResponses(conv, newUserMessage.id);
            } else {
                // AI 消息：如果内容或附件有变化，则创建分支
                const isContentChanged = newContent !== originalContent;
                const isAttachmentsChanged = JSON.stringify(editingAttachments) !== JSON.stringify(originalAttachments);

                if (isContentChanged || isAttachmentsChanged) {
                    // 找到被编辑消息的父消息 ID
                    const parentId = targetMsg.parentId !== undefined ? targetMsg.parentId : null;
                    
                    // 创建新的 AI 消息作为分支
                    const now = Date.now();
                    const newAssistantMessage = {
                        ...targetMsg, // 继承模型名、渠道名等元数据
                        id: utils.createId('msg_b'),
                        role: 'assistant',
                        content: newContent,
                        createdAt: now,
                        timestamp: new Date(now).toISOString()
                    };

                    // 附件外置化：保存 Blob 并仅保留轻量引用
                    if (editingAttachments.length > 0) {
                        const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
                        if (attachmentsApi && typeof attachmentsApi.normalizeAttachmentsForState === 'function') {
                            try {
                                const normalized = await attachmentsApi.normalizeAttachmentsForState(editingAttachments, { source: 'assistant' });
                                if (normalized && Array.isArray(normalized.attachments) && normalized.attachments.length > 0) {
                                    newAssistantMessage.attachments = normalized.attachments;
                                } else {
                                    delete newAssistantMessage.attachments;
                                }
                            } catch (e) {
                                console.warn('[messageActions.edit] normalizeAttachmentsForState failed:', e);
                                newAssistantMessage.attachments = editingAttachments;
                            }
                        } else {
                            newAssistantMessage.attachments = editingAttachments;
                        }
                    } else {
                        delete newAssistantMessage.attachments;
                    }
                    
                    // 使用 createBranch 创建分支
                    store.createBranch(conv.id, parentId, newAssistantMessage);
                }
                
                // 同步 UI（如果没变也会刷新掉编辑态）
                if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                    // 传入当前消息 ID 以便 syncUI 尝试保持视觉焦点
                    window.IdoFront.conversationActions.syncUI({ focusMessageId: isContentChanged || isAttachmentsChanged ? undefined : messageId });
                }
            }
        };

        // 修改操作栏按钮行为
        const actions = messageCard.querySelector('.ido-message__actions');
        if (actions) {
            // 保存原始按钮以便恢复
            const originalActions = actions.innerHTML;
            
            // 恢复原始操作栏的函数
            const restoreOriginalActions = () => {
                cancelEdit();
                // 重新渲染原始按钮（通过 syncUI 刷新整个消息会更可靠）
                if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                    window.IdoFront.conversationActions.syncUI();
                }
            };
            
            // 替换为编辑模式按钮
            actions.innerHTML = '';
            
            // 确认按钮（双对勾）- 绿色
            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'material-symbols-outlined text-[14px]';
            confirmBtn.textContent = 'done_all';
            // 用户消息会重新生成，AI 消息只保存
            confirmBtn.title = targetMsg.role === 'user' ? '确认并重新生成' : '确认保存';
            confirmBtn.style.color = '#10b981'; // 绿色
            confirmBtn.onclick = saveEdit;
            actions.appendChild(confirmBtn);
            
            // 取消按钮（X）- 直接显示，更直观
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'material-symbols-outlined text-[14px]';
            cancelBtn.textContent = 'close';
            cancelBtn.title = '取消编辑 (Esc)';
            cancelBtn.style.color = '#6b7280'; // 灰色
            cancelBtn.onclick = restoreOriginalActions;
            actions.appendChild(cancelBtn);
        }

        // 快捷键支持
        textarea.onkeydown = (e) => {
            if (e.key === 'Escape') {
                // 取消编辑并刷新UI
                cancelEdit();
                if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                    window.IdoFront.conversationActions.syncUI();
                }
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveEdit();
            }
        };
    };

    /**
     * 创建附件预览
     */
    function createAttachmentPreview(attachment, onRemove) {
        const preview = document.createElement('div');
        preview.className = 'message-edit-attachment-item';
        
        if (attachment.type && attachment.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.alt = attachment.name;

            // 优先使用 dataUrl（编辑态新增附件），否则从附件仓库读取 objectURL（已外置化的历史附件）
            if (attachment.dataUrl) {
                img.src = attachment.dataUrl;
            } else if (attachment.id) {
                const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
                if (attachmentsApi && typeof attachmentsApi.getObjectUrl === 'function') {
                    attachmentsApi.getObjectUrl(attachment.id).then((url) => {
                        if (url) {
                            img.src = url;
                        }
                    }).catch(() => {
                        // ignore
                    });
                }
            }

            preview.appendChild(img);
        } else {
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = attachment.type && attachment.type.startsWith('audio/') ? 'music_note' : 'description';
            preview.appendChild(icon);
            
            const name = document.createElement('span');
            name.className = 'attachment-name';
            name.textContent = attachment.name;
            preview.appendChild(name);
        }
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'attachment-remove-btn';
        removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
        removeBtn.onclick = onRemove;
        preview.appendChild(removeBtn);
        
        return preview;
    }

    /**
     * 读取文件为 Data URL
     */
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * 重试/重新生成（分支模式）
     * @param {string} messageId - 触发重试的消息ID
     *
     * 分支逻辑：
     * - 如果是 AI 消息：在同一个父节点下创建新的 AI 响应分支
     * - 如果是用户消息：重新生成该用户消息的 AI 响应（作为新分支）
     */
    window.IdoFront.messageActions.retry = async function(messageId) {
        const conv = store.getActiveConversation();
        if (!conv) return;

        const targetMsg = conv.messages.find(m => m.id === messageId);
        if (!targetMsg) return;

        // 如果当前对话仍有进行中的请求，先清理其 loading / 流式状态并标记为已结束
        if (store.state.isTyping && store.state.typingConversationId === conv.id) {
            store.state.isTyping = false;
            store.state.typingConversationId = null;
            store.state.typingMessageId = null;
            // 延迟持久化，避免阻塞主线程
            Promise.resolve().then(() => store.persist());
        }

        // 分支模式：不再截断，而是创建新分支
        let relatedUserMessageId = null;
        let parentIdForNewBranch = null;

        if (targetMsg.role === 'user') {
            // 用户消息重试：重新生成该用户消息的 AI 响应
            // 新的 AI 响应将作为该用户消息的子节点（可能已有其他 AI 响应作为兄弟）
            relatedUserMessageId = messageId;
            parentIdForNewBranch = messageId;
        } else if (targetMsg.role === 'assistant') {
            // AI 消息重试：在同一个父节点（用户消息）下创建新的 AI 响应
            // 找到触发这个 AI 响应的用户消息（即父消息）
            const parentId = targetMsg.parentId;
            if (parentId) {
                relatedUserMessageId = parentId;
                parentIdForNewBranch = parentId;
            } else {
                // 异常情况：AI 消息没有父消息
                console.warn('AI message has no parent, cannot retry');
                return;
            }
        }

        if (relatedUserMessageId && parentIdForNewBranch !== null) {
            // 在重新生成之前，移除当前分支下显示的 AI 消息的 DOM 节点
            // 这样 generateResponse 创建的新消息才不会与原消息同时显示
            const activePath = store.getActivePath(conv.id);
            const parentMsgIndex = activePath.findIndex(m => m.id === parentIdForNewBranch);
            if (parentMsgIndex !== -1) {
                const chatStream = document.getElementById('chat-stream');
                if (chatStream) {
                    // 性能优化：批量收集要删除的消息 ID，使用单次 querySelectorAll
                    const idsToRemove = activePath.slice(parentMsgIndex + 1).map(m => m.id);
                    if (idsToRemove.length > 0) {
                        // 构建选择器，一次性查询所有要删除的元素
                        const selector = idsToRemove.map(id => `[data-message-id="${id}"]`).join(',');
                        const elementsToRemove = chatStream.querySelectorAll(selector);
                        // 批量删除（现代浏览器会合并重排）
                        elementsToRemove.forEach(el => el.remove());
                    }
                }
            }

            // 异步更新侧边栏，不阻塞主流程
            if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.renderConversationList) {
                requestAnimationFrame(() => {
                    try {
                        window.IdoFront.conversationActions.renderConversationList();
                    } catch (e) {
                        console.warn('renderConversationList error during retry:', e);
                    }
                });
            }
            
            // 重新生成响应（generateResponse 会自动基于当前活跃路径构建上下文）
            // 传入 parentIdForNewBranch 作为新 AI 消息的父节点
            await dispatchResponses(conv, relatedUserMessageId, parentIdForNewBranch, {
                source: 'retry',
                clearBranchSelection: true
            });
        }
    };

    function resolveGenerationTarget(conv, executionOptions) {
        const channels = Array.isArray(store.state.channels) ? store.state.channels : [];
        const currentChannelId = conv && conv.selectedChannelId ? conv.selectedChannelId : null;
        const currentChannel = currentChannelId
            ? channels.find(c => c.id === currentChannelId)
            : null;
        const currentModel = conv && conv.selectedModel
            ? conv.selectedModel
            : ((currentChannel && Array.isArray(currentChannel.models) && currentChannel.models[0]) || null);

        const hasExplicitOverride = !!(executionOptions && (executionOptions.overrideChannelId || executionOptions.overrideModel));
        let requestedChannelId = executionOptions && executionOptions.overrideChannelId
            ? executionOptions.overrideChannelId
            : currentChannelId;
        let channel = requestedChannelId ? channels.find(c => c.id === requestedChannelId) : null;
        let usedFallbackCurrent = false;

        if ((!channel || channel.enabled === false) && hasExplicitOverride && currentChannel && currentChannel.enabled !== false) {
            requestedChannelId = currentChannelId;
            channel = currentChannel;
            usedFallbackCurrent = true;
        }

        if (!requestedChannelId) {
            return { error: '请先在顶部选择渠道和模型' };
        }
        if (!channel) {
            return { error: '所选渠道不存在，请重新选择' };
        }
        if (channel.enabled === false) {
            return { error: '所选渠道已禁用，请选择其他渠道或在设置中启用该渠道' };
        }

        let selectedModel = null;
        if (!usedFallbackCurrent && executionOptions && executionOptions.overrideModel) {
            selectedModel = executionOptions.overrideModel;
        } else if ((!executionOptions || !executionOptions.overrideChannelId || requestedChannelId === currentChannelId || usedFallbackCurrent) && currentModel) {
            selectedModel = currentModel;
        } else if (Array.isArray(channel.models) && channel.models.length > 0) {
            selectedModel = channel.models[0];
        }

        if (!selectedModel) {
            return { error: '所选渠道无可用模型，请重新选择' };
        }
        return { channel, selectedModel };
    }

    /**
     * 核心响应生成逻辑
     * 重构：在开始时立即创建空的 AI 消息，统一使用 typingMessageId 判断 UI 渲染
     * @param {Object} conv - 对话对象
     * @param {string} relatedUserMessageId - 触发生成的用户消息 ID
     * @param {string} [parentIdForNewBranch] - 可选，新 AI 消息的父节点 ID（用于分支模式）
     */
    async function generateResponse(conv, relatedUserMessageId, parentIdForNewBranch, options) {
        const executionOptions = options && typeof options === 'object' ? options : {};
        const multiRoute = window.IdoFront && window.IdoFront.multiRoute;
        const multiRouteGroupId = executionOptions.multiRouteGroupId || null;
        const multiRouteRouteId = executionOptions.multiRouteRouteId || null;
        const isMultiRouteCandidate = !!(multiRouteGroupId && multiRouteRouteId);
        // 如果未指定 parentIdForNewBranch，使用 relatedUserMessageId（即用户消息ID）
        // 因为新的 AI 响应将作为用户消息的子节点
        const effectiveParentId = parentIdForNewBranch !== undefined ? parentIdForNewBranch : relatedUserMessageId;
        const branchParentKey = effectiveParentId === undefined || effectiveParentId === null ? 'root' : effectiveParentId;
        const previousSelectedBranchId = conv && conv.activeBranchMap ? conv.activeBranchMap[branchParentKey] : undefined;
        const shouldTrackTyping = executionOptions.trackTyping !== false;
        const keepBranchActive = executionOptions.keepBranchActive !== false;
        const generationTarget = resolveGenerationTarget(conv, executionOptions);
        let channel = generationTarget.channel || null;
        let selectedModel = generationTarget.selectedModel || null;
        const requestPath = Array.isArray(executionOptions.pathSnapshot) ? executionOptions.pathSnapshot : null;

        if (!generationTarget.error) {
            const relatedAttachments = getAttachmentsFromConversationMessage(conv, relatedUserMessageId);
            const musicInputValidation = validateMusicAttachmentsForTarget(generationTarget, relatedAttachments);
            if (!musicInputValidation.valid) {
                showMessageActionToast(musicInputValidation.message);
                if (isMultiRouteCandidate && multiRoute && typeof multiRoute.markRouteFinished === 'function') {
                    multiRoute.markRouteFinished(conv.id, multiRouteGroupId, multiRouteRouteId, {
                        status: 'error',
                        currentMessageId: null,
                        messageId: null,
                        error: musicInputValidation.message
                    });
                }
                return;
            }
        }

        // 记录请求开始时间，用于计算持续时长
        const requestStartTime = Date.now();
        // 首字时间（收到第一个任何内容的时间，包括思维链）
        let firstTokenTime = null;
        // 正文首字时间（收到第一个正文内容的时间，用于计算 TPS）
        let firstContentTime = null;

        // ★ 核心改动：在开始时立即创建空的 AI 消息
        const now = Date.now();
        const assistantMessage = {
            id: utils.createId('msg_b'),
            role: 'assistant',
            content: '',  // 空内容，后续流式更新
            createdAt: now,
            timestamp: new Date(now).toISOString(),
            plugin: null
        };

        if (isMultiRouteCandidate) {
            assistantMessage.metadata = assistantMessage.metadata || {};
            assistantMessage.metadata.multiRoute = {
                groupId: multiRouteGroupId,
                routeId: multiRouteRouteId,
                routeIndex: executionOptions.routeIndex || 1,
                rootMessageId: assistantMessage.id,
                detached: executionOptions.multiRouteDetached === true,
                embedded: executionOptions.multiRouteEmbedded === true
            };
        }
        
        // 保存模型名和渠道名到消息中
        if (selectedModel) {
            assistantMessage.modelName = selectedModel;
        }
        if (channel && channel.name) {
            assistantMessage.channelName = channel.name;
        }
        
        // 添加消息到对话（这会更新 activeBranchMap）
        store.addMessageToConversation(conv.id, assistantMessage, effectiveParentId);

        if (isMultiRouteCandidate && multiRoute && typeof multiRoute.registerRouteMessage === 'function') {
            multiRoute.registerRouteMessage(conv.id, multiRouteGroupId, multiRouteRouteId, assistantMessage);
        }

        if (!keepBranchActive && conv && conv.activeBranchMap) {
            if (executionOptions.clearBranchSelection) {
                delete conv.activeBranchMap[branchParentKey];
            } else if (previousSelectedBranchId) {
                conv.activeBranchMap[branchParentKey] = previousSelectedBranchId;
            } else {
                delete conv.activeBranchMap[branchParentKey];
            }
            if (typeof store._invalidateActivePathCache === 'function') {
                store._invalidateActivePathCache(conv.id);
            }
            store.persist();
        }
        
        // 标记当前正在生成回复的对话
        // ★ 使用 typingMessageId 作为唯一真相来源
        if (shouldTrackTyping) {
            store.state.isTyping = true;
            store.state.typingConversationId = conv.id;
            store.state.typingMessageId = assistantMessage.id;
            store.persist();
        }

        // 标记流式是否已结束，防止 setTimeout 延迟的 onUpdate 覆盖已渲染的 Markdown
        let streamEnded = false;
        // 当模型返回 tool_calls 时，需要提前 finalize 这条消息的流式 UI（否则会一直“思考中”）
        let finalizedBeforeTools = false;
        
        // 设置发送按钮为加载状态
        // 和 loading 一样，只有消息在活跃路径上时才禁用发送按钮
        // 这样用户可以在其他分支继续发送消息
        if (context && context.setSendButtonLoading && shouldRenderUI(conv.id, assistantMessage.id)) {
            context.setSendButtonLoading(true);
        }

        // 渲染空的 AI 消息卡片 + 附着 loading（如果在活跃路径上）
        let loadingId = null;
        if (!isMultiRouteCandidate && context && shouldRenderUI(conv.id, assistantMessage.id)) {
            // 添加空的 AI 消息卡片
            const payload = {
                content: '',
                id: assistantMessage.id,
                modelName: assistantMessage.modelName,
                channelName: assistantMessage.channelName
            };
            
            // 计算分支信息
            const msgParentId = assistantMessage.parentId === undefined || assistantMessage.parentId === null ? 'root' : assistantMessage.parentId;
            const siblings = conv.messages.filter(m => {
                const pId = m.parentId === undefined || m.parentId === null ? 'root' : m.parentId;
                return pId === msgParentId && !shouldHideMessageInConversationTree(m, conv);
            }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            
            if (siblings.length > 1) {
                const currentIndex = siblings.findIndex(s => s.id === assistantMessage.id);
                payload.branchInfo = {
                    currentIndex,
                    total: siblings.length,
                    siblings: siblings.map(s => s.id)
                };
            }
            
            context.addMessage('ai', payload);
            
            // 创建并附着 loading 指示器
            if (context.addLoadingIndicator && context.attachLoadingIndicatorToMessage) {
                loadingId = context.addLoadingIndicator();
                const attached = context.attachLoadingIndicatorToMessage(loadingId, assistantMessage.id);
                if (!attached && context.removeLoadingIndicator) {
                    context.removeLoadingIndicator(loadingId);
                    loadingId = null;
                }
            }
        }

        // 2. Prepare API Call
        if (generationTarget.error) {
            assistantMessage.content = generationTarget.error;
            cleanupAndFinish(generationTarget.error);
            return;
        }
        
        // 辅助函数：清理并结束生成
        function cleanupAndFinish(errorMsg) {
            streamEnded = true;
            if (loadingId && context && context.removeLoadingIndicator) {
                context.removeLoadingIndicator(loadingId);
            }
            if (context && context.removeMessageStreamingIndicator && shouldRenderUI(conv.id, assistantMessage.id)) {
                context.removeMessageStreamingIndicator(assistantMessage.id);
            }
            // 更新 UI 显示错误信息
            if (context && shouldRenderUI(conv.id, assistantMessage.id)) {
                const updatePayload = { content: assistantMessage.content };
                if (typeof context.updateMessageById === 'function') {
                    context.updateMessageById(assistantMessage.id, updatePayload);
                } else if (typeof context.updateLastMessage === 'function') {
                    context.updateLastMessage(updatePayload);
                }
            }
            if (store.state.typingMessageId === assistantMessage.id) {
                store.state.isTyping = false;
                store.state.typingConversationId = null;
                store.state.typingMessageId = null;
            }
            if (isMultiRouteCandidate && multiRoute && typeof multiRoute.markRouteFinished === 'function') {
                multiRoute.markRouteFinished(conv.id, multiRouteGroupId, multiRouteRouteId, {
                    status: 'error',
                    currentMessageId: assistantMessage.id,
                    messageId: assistantMessage.id,
                    error: assistantMessage.content
                });
            }
            store.persist();
            updateSendButtonLoadingState();
        }

        // Get active persona settings
        const activePersona = store.getActivePersona();
        
        // Build messages payload with persona context（包含 tool call / tool result turn）
        const messagesPayload = await buildMessagesPayloadWithToolTurns(
            conv,
            assistantMessage.id,
            { ...channel, model: selectedModel },
            requestPath
        );

        // 用于请求日志（精简版），仍然基于活跃路径
        const activePath = Array.isArray(requestPath) ? requestPath : store.getActivePath(conv.id);
        
                // Log Request（使用精简版，避免将大量 base64 附件写入日志导致卡顿）
                const sanitizedMessages = [];
                if (activePersona && activePersona.systemPrompt) {
                    sanitizedMessages.push({ role: 'system', content: activePersona.systemPrompt });
                }
                if (activePersona && activePersona.contextMessages && activePersona.contextMessages.length > 0) {
                    activePersona.contextMessages.forEach(msg => {
                        sanitizedMessages.push({ role: msg.role, content: msg.content });
                    });
                }
                // 精简实际对话消息：仅对触发本次生成的用户消息保留附件的元信息（去除 dataUrl）
                activePath.forEach(m => {
                    if (!m || !shouldIncludeMessageInRequestContext(m, conv)) return;
                    const out = { role: m.role, content: m.content };
                    if (m.attachments && Array.isArray(m.attachments)) {
                        if (m.id === relatedUserMessageId) {
                            out.attachments = m.attachments.map(att => ({
                                name: att.name,
                                type: att.type,
                                size: att.size
                            }));
                        }
                    }
                    sanitizedMessages.push(out);
                });
                const requestPayload = {
                    model: selectedModel,
                    messages: sanitizedMessages,
                    channel: channel.name
                };
                
                const logId = (context && typeof context.logRequest === 'function')
                    ? context.logRequest('POST', '/chat/completions', requestPayload)
                    : null;
                store.addLog({
                     id: utils.createId('log'),
                     direction: 'outgoing',
                     label: `POST ${channel.baseUrl || 'OpenAI'}`,
                     timestamp: Date.now(),
                     data: requestPayload,
                     relatedMessageId: relatedUserMessageId
                });
        
                // 3. Call Service with persona parameters + 会话级别覆写（流式 / 思考预算）
                
                // 流式更新的内容
                let fullContent = '';
                let fullReasoning = null;
                let finalRouteMessage = assistantMessage;
                
                try {
                    // 判断当前模型是否为启用思考预算的模型（暂仅识别名称中包含 gpt-5）
                    const isReasoningModel = typeof selectedModel === 'string'
                        && selectedModel.toLowerCase().includes('gpt-5');
        
                    // 构建配置，按优先级合并参数：chat基础 -> 面具覆写 -> 渠道覆写 -> 会话覆写
                    const personaStream = activePersona ? activePersona.stream !== false : true;
                    const streamOverride = typeof executionOptions.streamOverride === 'boolean'
                        ? executionOptions.streamOverride
                        : null;
                    const effectiveStream = streamOverride !== null
                        ? streamOverride
                        : (typeof conv.streamOverride === 'boolean' ? conv.streamOverride : personaStream);
        
                    const channelConfig = {
                        ...channel,
                        model: selectedModel,
                        // Apply persona parameters
                        temperature: activePersona?.temperature,
                        topP: activePersona?.topP,
                        stream: effectiveStream
                    };
                    
                    // 合并paramsOverride：面具的paramsOverride会被渠道的paramsOverride覆盖
                    // 最终优先级：基础参数 < 面具paramsOverride < 渠道paramsOverride
                    if (activePersona?.paramsOverride || channel.paramsOverride) {
                        channelConfig.paramsOverride = {
                            ...(activePersona?.paramsOverride || {}),
                            ...(channel.paramsOverride || {})
                        };
                    }
        
                    // 会话级别思考预算（仅在 gpt-5* 模型上生效），优先级最高
                    if (isReasoningModel) {
                        let effort = conv.reasoningEffort || 'medium';
                        if (typeof effort === 'string') {
                            effort = effort.toLowerCase();
                        }
                        if (effort !== 'low' && effort !== 'medium' && effort !== 'high') {
                            effort = 'medium';
                        }
                        if (!channelConfig.paramsOverride) {
                            channelConfig.paramsOverride = {};
                        }
                        channelConfig.paramsOverride.reasoning_effort = effort;
                    }

                    // 流式/非流式都可能返回附件。为了避免把 base64 写进 Store，先暂存原始附件，
                    // 在生成结束时统一外置化并写回 assistantMessage.attachments（仅保存引用）。
                    let finalAssistantAttachments = null;

            const onUpdate = (data) => {
                // 如果流式已结束，忽略后续延迟到达的更新
                if (streamEnded) {
                    return;
                }
                // 如果本对话已经有了新的请求（typingMessageId 不匹配），忽略旧请求
                if (shouldTrackTyping && store.state.typingMessageId !== assistantMessage.id) {
                    return;
                }

                let currentContent = '';
                let currentReasoning = null;
                let currentMetadata = null;

                if (typeof data === 'string') {
                    currentContent = data;
                } else if (typeof data === 'object') {
                    currentContent = data.content || '';
                    currentReasoning = data.reasoning || null;
                    currentMetadata = data.metadata || null;
                }
                
                // 记录首字时间（第一次收到任何内容，包括思维链）
                if (!firstTokenTime && (currentContent || currentReasoning)) {
                    firstTokenTime = Date.now();
                }
                
                // ★ 思维链累计计时逻辑
                // 通过检测 reasoning 内容是否增长来判断是否有新的思维链
                // 这样可以同时支持：
                // 1. 某些模型在正文输出时仍携带相同的 reasoning 字段 → 不会重新开始计时
                // 2. 真正的多段思维链（reasoning 继续增长）→ 会继续计时
                const currentReasoningLength = currentReasoning ? currentReasoning.length : 0;
                const prevReasoningLength = assistantMessage._prevReasoningLength || 0;
                const hasNewReasoning = currentReasoningLength > prevReasoningLength;
                
                // 收到新的 reasoning 内容且无 segmentStart → 开始新段
                if (hasNewReasoning && !assistantMessage.reasoningSegmentStart) {
                    assistantMessage.reasoningSegmentStart = Date.now();
                    // 初始化累计时间（如果还没有）
                    if (assistantMessage.reasoningAccumulatedTime === undefined) {
                        assistantMessage.reasoningAccumulatedTime = 0;
                    }
                }
                
                // 更新记录的 reasoning 长度
                if (currentReasoningLength > prevReasoningLength) {
                    assistantMessage._prevReasoningLength = currentReasoningLength;
                }
                
                // 收到 content 且有 segmentStart → 累加当前段时间，清除 segmentStart
                // 不设置全局结束标记，允许后续多段思维链继续计时
                if (currentContent && assistantMessage.reasoningSegmentStart) {
                    const segmentDuration = (Date.now() - assistantMessage.reasoningSegmentStart) / 1000;
                    assistantMessage.reasoningAccumulatedTime = (assistantMessage.reasoningAccumulatedTime || 0) + segmentDuration;
                    delete assistantMessage.reasoningSegmentStart;
                }
                
                // 记录正文首字时间（第一次收到正文内容，用于计算 TPS）
                if (!firstContentTime && currentContent) {
                    firstContentTime = Date.now();
                }
                
                fullContent = currentContent;
                fullReasoning = currentReasoning;
                
                // 从流式更新数据中提取附件
                let currentAttachments = null;
                if (data.attachments && Array.isArray(data.attachments)) {
                    currentAttachments = data.attachments;
                } else if (currentMetadata && Array.isArray(currentMetadata.attachments)) {
                    currentAttachments = currentMetadata.attachments;
                }
                
                // 更新助手消息的内容（始终更新 Store）
                assistantMessage.content = fullContent;
                if (fullReasoning) {
                    assistantMessage.reasoning = fullReasoning;
                }

                // ⚠️ 不要把 base64 dataUrl 直接写进 Store（会在持久化时导致卡顿）
                // 这里只暂存，等流式结束后统一外置化。
                // 考虑到流式过程中附件可能是增量返回（如 Gemini 生图可能分多次返回），
                // 我们需要合并并去重附件列表。
                if (currentAttachments && currentAttachments.length > 0) {
                    if (!finalAssistantAttachments) {
                        finalAssistantAttachments = [...currentAttachments];
                    } else {
                        currentAttachments.forEach(newAtt => {
                            const exists = finalAssistantAttachments.find(
                                existing => existing.name === newAtt.name && existing.size === newAtt.size
                            );
                            if (!exists) {
                                finalAssistantAttachments.push(newAtt);
                            }
                        });
                    }
                }

                // metadata 也可能带 attachments，这里写入 Store 前先剥离
                if (currentMetadata) {
                    const existingMultiRouteMeta = assistantMessage.metadata && assistantMessage.metadata.multiRoute
                        ? assistantMessage.metadata.multiRoute
                        : null;
                    const meta = { ...currentMetadata };
                    if (Array.isArray(meta.attachments)) {
                        delete meta.attachments;
                    }
                    assistantMessage.metadata = existingMultiRouteMeta ? { ...meta, multiRoute: existingMultiRouteMeta } : meta;
                }
                
                // 仅当在活跃路径上时才更新 UI
                if (shouldRenderUI(conv.id, assistantMessage.id)) {
                    const isReasoningSegmentEnded = !!currentContent && !assistantMessage.reasoningSegmentStart;
                    const updatePayload = {
                        content: fullContent,
                        reasoning: fullReasoning,
                        streaming: true,
                        reasoningEnded: isReasoningSegmentEnded
                    };
                    if (finalAssistantAttachments && finalAssistantAttachments.length > 0) {
                        updatePayload.attachments = finalAssistantAttachments;
                    }
                    // Gemini 生图：思维链预览图（仅 UI 展示，不持久化、不回传）
                    if (data && Array.isArray(data.thoughtAttachments) && data.thoughtAttachments.length > 0) {
                        updatePayload.thoughtAttachments = data.thoughtAttachments;
                    }

                    if (context && typeof context.updateMessageById === 'function') {
                        context.updateMessageById(assistantMessage.id, updatePayload);
                    } else if (context && typeof context.updateLastMessage === 'function') {
                        context.updateLastMessage(updatePayload);
                    }
                }
                if (isMultiRouteCandidate && multiRoute && typeof multiRoute.syncRoutePreview === 'function') {
                    multiRoute.syncRoutePreview(conv.id, multiRouteGroupId, multiRouteRouteId);
                }
                // 流式更新时不持久化，避免频繁的 IndexedDB 写入
            };

            let response = null;
            try {
                const streamingEnabled = !!channelConfig.stream;
                const streamingCallback = streamingEnabled ? onUpdate : null;
                response = await service.callAI(messagesPayload, channelConfig, streamingCallback, {
                    requestId: assistantMessage.id,
                    setAsCurrent: executionOptions.setAsCurrent !== false
                });
            } catch (apiError) {
                // 检查是否是用户取消
                if (apiError.name === 'AbortError') {
                    // 用户主动取消，不视为错误
                    console.log('请求已被用户取消');
                    
                    streamEnded = true;
                    fullContent = '✋ 已停止生成';
                    assistantMessage._stoppedByAbort = true;

                    // 清理加载指示器
                    if (loadingId && context && context.removeLoadingIndicator) {
                        context.removeLoadingIndicator(loadingId);
                        loadingId = null;
                    }
                    
                    // 清理流式指示器
                    if (context && context.removeMessageStreamingIndicator && shouldRenderUI(conv.id, assistantMessage.id)) {
                        context.removeMessageStreamingIndicator(assistantMessage.id);
                    }
                    
                    // 停止思维链计时器（直接通过 DOM 操作，避免状态不一致问题）
                    try {
                        const chatStream = document.getElementById('chat-stream');
                        if (chatStream) {
                            const msgCard = chatStream.querySelector(`[data-message-id="${assistantMessage.id}"]`);
                            if (msgCard) {
                                const reasoningBlock = msgCard.querySelector('.reasoning-block');
                                if (reasoningBlock && reasoningBlock.dataset.timerId) {
                                    const timerId = parseInt(reasoningBlock.dataset.timerId, 10);
                                    if (!Number.isNaN(timerId)) {
                                        clearInterval(timerId);
                                    }
                                    delete reasoningBlock.dataset.timerId;
                                    delete reasoningBlock.dataset.startTime;
                                    delete reasoningBlock.dataset.accumulatedTime;
                                    delete reasoningBlock.dataset.segmentStart;
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('清理思维链计时器失败:', e);
                    }
                    
                    // 更新消息内容为停止提示
                    assistantMessage.content = fullContent;
                    store.persist();

                    if (isMultiRouteCandidate && multiRoute && typeof multiRoute.markRouteFinished === 'function') {
                        multiRoute.markRouteFinished(conv.id, multiRouteGroupId, multiRouteRouteId, {
                            status: 'stopped',
                            currentMessageId: assistantMessage.id,
                            messageId: assistantMessage.id,
                            error: fullContent
                        });
                    }
                    
                    // 重置全局打字状态
                    if (store.state.typingMessageId === assistantMessage.id) {
                        store.state.isTyping = false;
                        store.state.typingConversationId = null;
                        store.state.typingMessageId = null;
                        store.persist();
                    }
                    
                    // 恢复发送按钮状态
                    updateSendButtonLoadingState();
                    
                    // 不继续抛出错误
                    return;
                }
                
                // API 调用失败，确保清理加载指示器
                if (loadingId && context && context.removeLoadingIndicator) {
                    context.removeLoadingIndicator(loadingId);
                    loadingId = null;
                }
                throw apiError;
            }
            
            // 计算时间统计
            const requestEndTime = Date.now();
            const totalDuration = (requestEndTime - requestStartTime) / 1000; // 总用时（秒）
            
            // 首字延迟：从发送请求到收到第一个 token 的时间（包含思维链）
            let ttft = null;
            if (firstTokenTime) {
                ttft = (firstTokenTime - requestStartTime) / 1000;
            }
            
            // 正文首字延迟：从发送请求到收到第一个正文内容的时间
            let ttfc = null;
            if (firstContentTime) {
                ttfc = (firstContentTime - requestStartTime) / 1000;
            }
            
            // 正文生成时间：从正文首字到最后一个字的时间（用于计算 TPS）
            let generationTime = null;
            if (firstContentTime) {
                generationTime = (requestEndTime - firstContentTime) / 1000;
            } else if (firstTokenTime) {
                // 降级：如果没有正文首字时间，使用首字时间
                generationTime = (requestEndTime - firstTokenTime) / 1000;
            }
            
            // 提取 usage 信息并计算 TPS
            const usage = response.usage || null;
            let tps = null;
            // TPS 基于正文生成时间计算（从正文首字开始）
            if (usage && usage.completion_tokens && generationTime && generationTime > 0) {
                tps = usage.completion_tokens / generationTime;
            } else if (usage && usage.completion_tokens && totalDuration > 0) {
                // 降级：如果没有首字时间，使用总用时计算
                tps = usage.completion_tokens / totalDuration;
            }
            
            // 构建统计信息对象
            const stats = {
                duration: totalDuration,        // 总用时
                ttft: ttft,                     // 首字延迟 (Time to First Token，包含思维链)
                ttfc: ttfc,                     // 正文首字延迟 (Time to First Content)
                generationTime: generationTime, // 正文生成时间
                usage: usage,
                tps: tps
            };
            
            // 处理非流式响应或流式完成
            const choice = response.choices?.[0];
            const responseToolCalls = choice?.message?.tool_calls || null;
            
            if (!fullContent) {
                // 非流式模式：从响应中提取内容
                fullContent = choice?.message?.content || '';
                fullReasoning = choice?.message?.reasoning_content || null;
                const metadata = choice?.message?.metadata || null;
                const attachments = choice?.message?.attachments
                    || (metadata && Array.isArray(metadata.attachments) ? metadata.attachments : null);
                
                assistantMessage.content = fullContent;
                if (fullReasoning) assistantMessage.reasoning = fullReasoning;

                if (metadata) {
                    const existingMultiRouteMeta = assistantMessage.metadata && assistantMessage.metadata.multiRoute
                        ? assistantMessage.metadata.multiRoute
                        : null;
                    const meta = { ...metadata };
                    if (Array.isArray(meta.attachments)) {
                        delete meta.attachments;
                    }
                    assistantMessage.metadata = existingMultiRouteMeta ? { ...meta, multiRoute: existingMultiRouteMeta } : meta;
                }

                if (attachments && Array.isArray(attachments) && attachments.length > 0) {
                    finalAssistantAttachments = attachments;
                }

                // ★ 非流式：立即把最终内容同步到 UI（否则 message card 仍是初始空内容，Markdown 也不会触发渲染）
                if (context && shouldRenderUI(conv.id, assistantMessage.id)) {
                    const updatePayload = {
                        content: fullContent,
                        reasoning: fullReasoning,
                        streaming: false,
                        reasoningEnded: true
                    };
                    if (finalAssistantAttachments && finalAssistantAttachments.length > 0) {
                        updatePayload.attachments = finalAssistantAttachments;
                    }
                    if (typeof context.updateMessageById === 'function') {
                        context.updateMessageById(assistantMessage.id, updatePayload);
                    } else if (typeof context.updateLastMessage === 'function') {
                        context.updateLastMessage(updatePayload);
                    }
                }

                if (isMultiRouteCandidate && multiRoute && typeof multiRoute.syncRoutePreview === 'function') {
                    multiRoute.syncRoutePreview(conv.id, multiRouteGroupId, multiRouteRouteId);
                }
            }
            
            // ========== 工具调用处理 ==========
            if (responseToolCalls && responseToolCalls.length > 0) {
                const toolCallTypes = window.IdoFront.toolCallTypes;
                const toolRegistry = window.IdoFront.toolRegistry;
                const toolCallRenderer = window.IdoFront.toolCallRenderer;
                
                if (toolCallTypes && toolRegistry) {
                    // 创建工具调用记录
                    const toolCalls = toolCallTypes.createFromResponse(responseToolCalls);
                    // 补充 displayName（用于 UI 展示）
                    if (toolRegistry && typeof toolRegistry.resolve === 'function') {
                        toolCalls.forEach(tc => {
                            const def = toolRegistry.resolve(tc.name);
                            if (def && def.name) {
                                tc.displayName = def.name;
                            }
                        });
                    }
                    assistantMessage.toolCalls = toolCalls;
                    assistantMessage.updatedAt = Date.now();

                    // ========== 提前结束该条消息的流式 UI（思维链计时/三点） ==========
                    if (!finalizedBeforeTools) {
                        // 停止接收后续流式更新
                        streamEnded = true;

                        // 结束最后一段思维链计时
                        if (assistantMessage.reasoningSegmentStart) {
                            const lastSegmentDuration = (Date.now() - assistantMessage.reasoningSegmentStart) / 1000;
                            assistantMessage.reasoningAccumulatedTime = (assistantMessage.reasoningAccumulatedTime || 0) + lastSegmentDuration;
                            delete assistantMessage.reasoningSegmentStart;
                        }
                        if (assistantMessage.reasoningAccumulatedTime !== undefined && assistantMessage.reasoningAccumulatedTime > 0) {
                            assistantMessage.reasoningDuration = assistantMessage.reasoningAccumulatedTime;
                            delete assistantMessage.reasoningAccumulatedTime;
                        }

                        // 工具开始执行时，停止该条消息的“流式三点”指示器
                        if (context && context.removeMessageStreamingIndicator && shouldRenderUI(conv.id, assistantMessage.id)) {
                            context.removeMessageStreamingIndicator(assistantMessage.id);
                        }
                        // 如果 loading 没有成功附着到消息，移除独立 loading bubble
                        if (loadingId && context && context.removeLoadingIndicator) {
                            context.removeLoadingIndicator(loadingId);
                            loadingId = null;
                        }

                        assistantMessage.stats = stats;
                        store.persist();

                        // finalizeStreamingMessage 只作用于“最后一条 UI 消息”，优先使用按 messageId 的版本
                        if (context && shouldRenderUI(conv.id, assistantMessage.id)) {
                            if (typeof context.finalizeStreamingMessageById === 'function') {
                                context.finalizeStreamingMessageById(assistantMessage.id, stats);
                            } else if (typeof context.finalizeStreamingMessage === 'function') {
                                context.finalizeStreamingMessage(stats);
                            }
                        }

                        finalizedBeforeTools = true;
                    }

                    // 更新 UI 显示工具调用
                    if (context && shouldRenderUI(conv.id, assistantMessage.id)) {
                        const updatePayload = {
                            content: fullContent,
                            toolCalls: toolCalls
                        };
                        if (typeof context.updateMessageById === 'function') {
                            context.updateMessageById(assistantMessage.id, updatePayload);
                        } else if (typeof context.updateLastMessage === 'function') {
                            context.updateLastMessage(updatePayload);
                        }
                    }
                    
                    // 依次执行每个工具
                    for (const tc of toolCalls) {
                        // 更新状态为执行中
                        toolCallTypes.updateStatus(tc, 'running');
                        assistantMessage.updatedAt = Date.now();
                        if (toolCallRenderer && shouldRenderUI(conv.id, assistantMessage.id)) {
                            toolCallRenderer.updateUI(assistantMessage.id, tc.id, { status: 'running' });
                        }
                        
                        try {
                            const def = toolRegistry && typeof toolRegistry.resolve === 'function'
                                ? toolRegistry.resolve(tc.name)
                                : null;

                            if (def && def.id && store && typeof store.getToolStateForConversation === 'function') {
                                const enabled = store.getToolStateForConversation(conv.id, def.id);
                                if (!enabled) {
                                    toolCallTypes.updateStatus(tc, 'error', null, '该工具在当前会话已禁用');
                                    assistantMessage.updatedAt = Date.now();
                                    if (toolCallRenderer && shouldRenderUI(conv.id, assistantMessage.id)) {
                                        toolCallRenderer.updateUI(assistantMessage.id, tc.id, {
                                            status: tc.status,
                                            result: tc.result,
                                            error: tc.error,
                                            duration: tc.duration
                                        });
                                    }
                                    continue;
                                }
                            }

                            // 执行工具
                            const result = await toolRegistry.execute(tc.name, tc.args);
                            
                            if (result.success) {
                                toolCallTypes.updateStatus(tc, 'success', result.result);
                                assistantMessage.updatedAt = Date.now();
                            } else {
                                toolCallTypes.updateStatus(tc, 'error', null, result.error);
                                assistantMessage.updatedAt = Date.now();
                            }
                        } catch (execError) {
                            toolCallTypes.updateStatus(tc, 'error', null, execError.message);
                            assistantMessage.updatedAt = Date.now();
                        }
                        
                        // 更新 UI
                        if (toolCallRenderer && shouldRenderUI(conv.id, assistantMessage.id)) {
                            toolCallRenderer.updateUI(assistantMessage.id, tc.id, {
                                status: tc.status,
                                result: tc.result,
                                error: tc.error,
                                duration: tc.duration
                            });
                        }
                    }
                    
                    // 持久化工具调用结果
                    store.persist();
                    
                    // ========== 工具调用完成后：用新消息承接后续模型回复 ==========
                    try {
                        const continuedMessage = await continueAfterToolCalls(conv, channelConfig, assistantMessage, {
                            trackTyping: shouldTrackTyping,
                            setAsCurrent: executionOptions.setAsCurrent !== false
                        });
                        if (continuedMessage && continuedMessage.id) {
                            finalRouteMessage = continuedMessage;
                        }
                    } catch (e) {
                        console.warn('[MessageActions] continueAfterToolCalls failed:', e);
                    }
                }
            }
            
            // 如果没有内容且没有工具调用，显示默认提示
            if (!fullContent && (!responseToolCalls || responseToolCalls.length === 0)) {
                fullContent = '无内容响应';
                assistantMessage.content = fullContent;
            }
            
            {
                // 标记流式结束
                streamEnded = true;
                
                // ★ 保存最终思维链时长
                // 如果还有进行中的思维链段，累加最后一段
                if (assistantMessage.reasoningSegmentStart) {
                    const lastSegmentDuration = (Date.now() - assistantMessage.reasoningSegmentStart) / 1000;
                    assistantMessage.reasoningAccumulatedTime = (assistantMessage.reasoningAccumulatedTime || 0) + lastSegmentDuration;
                    delete assistantMessage.reasoningSegmentStart;
                }
                
                // 将累计时间保存为最终时长
                if (assistantMessage.reasoningAccumulatedTime !== undefined && assistantMessage.reasoningAccumulatedTime > 0) {
                    assistantMessage.reasoningDuration = assistantMessage.reasoningAccumulatedTime;
                    delete assistantMessage.reasoningAccumulatedTime;
                }
                
                // 更新助手消息的统计信息
                assistantMessage.stats = stats;

                // 将最终附件外置化后再落盘（避免把 base64 写进 core.chat.state）
                // 性能优化：不在热路径逐个校验 objectUrl，可读性校验改为后台兜底处理。
                if (finalAssistantAttachments && Array.isArray(finalAssistantAttachments) && finalAssistantAttachments.length > 0) {
                    const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
                    if (attachmentsApi && typeof attachmentsApi.normalizeAttachmentsForState === 'function') {
                        try {
                            const normalized = await attachmentsApi.normalizeAttachmentsForState(finalAssistantAttachments, { source: 'assistant' });
                            if (normalized && Array.isArray(normalized.attachments) && normalized.attachments.length > 0) {
                                assistantMessage.attachments = normalized.attachments.filter(att => att && att.id);
                            } else {
                                delete assistantMessage.attachments;
                            }
                        } catch (e) {
                            console.warn('[generateResponse] normalizeAttachmentsForState failed:', e);

                            // 保底：尽量不要把大图 base64 写回 core.chat.state（性能风险）。
                            // 但如果附件总量很小，则允许以内联方式保留，避免“切回分支为空”。
                            let total = 0;
                            try {
                                for (const a of finalAssistantAttachments) {
                                    if (!a) continue;
                                    if (typeof a.size === 'number') {
                                        total += a.size;
                                    } else if (typeof a.dataUrl === 'string') {
                                        // base64 长度粗略换算
                                        const b64 = a.dataUrl.split(',')[1] || '';
                                        total += Math.round((b64.length * 3) / 4);
                                    }
                                }
                            } catch (err) {
                                total = 0;
                            }

                            const INLINE_FALLBACK_MAX_BYTES = 512 * 1024; // 512KB
                            if (total > 0 && total <= INLINE_FALLBACK_MAX_BYTES) {
                                assistantMessage.attachments = finalAssistantAttachments;
                                if (!assistantMessage.metadata) assistantMessage.metadata = {};
                                assistantMessage.metadata.attachmentsInlineFallback = true;
                            } else {
                                delete assistantMessage.attachments;
                                if (!assistantMessage.metadata) assistantMessage.metadata = {};
                                assistantMessage.metadata.attachmentsPersistFailed = true;
                            }
                        }
                    }
                }

                // 释放 Blob 模式 / Gemini 生图产生的临时 ObjectURL，避免内存泄漏
                if (finalAssistantAttachments) {
                    for (const att of finalAssistantAttachments) {
                        if (!att) continue;
                        try {
                            if (typeof att.dataUrl === 'string' && att.dataUrl.startsWith('blob:')) {
                                URL.revokeObjectURL(att.dataUrl);
                            }
                            att.blob = null;
                            att.dataUrl = null;
                        } catch (_) {}
                    }
                }

                // AI 回复完成：先让出主线程，随后尽快刷盘
                // 避免在流结束同一帧执行写盘造成 UI 卡顿
                store.persistSilent();
                setTimeout(() => {
                    try {
                        store.persistImmediately();
                    } catch (e) {
                        console.warn('[generateResponse] deferred persistImmediately failed:', e);
                        // 兜底至少标记一次普通持久化
                        try {
                            store.persist();
                        } catch (_) {
                            // ignore
                        }
                    }
                }, 0);
                
                // 流式更新完成，解析 Markdown（仅在活跃路径上时）
                // 如果已在 tool_calls 阶段提前 finalize，则不要再对“最后一条消息”调用 finalize（会误伤后续消息）
                if (!finalizedBeforeTools && context && context.finalizeStreamingMessage && shouldRenderUI(conv.id, assistantMessage.id)) {
                    context.finalizeStreamingMessage(stats);
                }
                
                // 触发 AI 自动生成标题
                const titleGenerator = window.IdoFront.titleGenerator;
                if (titleGenerator && titleGenerator.shouldGenerate && titleGenerator.shouldGenerate(conv.id)) {
                    if (typeof titleGenerator.scheduleGenerate === 'function') {
                        titleGenerator.scheduleGenerate(conv.id);
                    } else {
                        // 兼容旧实现
                        Promise.resolve().then(() => {
                            titleGenerator.generate(conv.id);
                        });
                    }
                }

                if (isMultiRouteCandidate && multiRoute && typeof multiRoute.markRouteFinished === 'function') {
                    multiRoute.markRouteFinished(conv.id, multiRouteGroupId, multiRouteRouteId, {
                        status: finalRouteMessage && finalRouteMessage._stoppedByAbort ? 'stopped' : 'completed',
                        currentMessageId: finalRouteMessage && finalRouteMessage.id ? finalRouteMessage.id : assistantMessage.id,
                        messageId: assistantMessage.id,
                        model: (finalRouteMessage && finalRouteMessage.modelName) || assistantMessage.modelName,
                        channelName: (finalRouteMessage && finalRouteMessage.channelName) || assistantMessage.channelName
                    });
                }
            }

            // 精简响应日志，去除大型 base64 图片数据
            const sanitizedResponse = sanitizeResponseForLog(response);
            store.addLog({
                 id: utils.createId('log'),
                 direction: 'incoming',
                 label: '200 OK',
                 timestamp: Date.now(),
                 data: sanitizedResponse,
                 relatedMessageId: null
            });
            
            if (context && logId && typeof context.completeRequest === 'function') {
                context.completeRequest(logId, 200, response);
            }

        } catch (error) {
            console.error('Message Send Error:', error);
            
            streamEnded = true;
            const errorText = `请求失败: ${error.message}`;
            fullContent = errorText; // 同步更新闭包变量，防止被后续逻辑误用
            
            // 更新消息内容为错误信息
            assistantMessage.content = errorText;
            store.persist();
            
            // 更新 UI 显示错误信息
            if (context && shouldRenderUI(conv.id, assistantMessage.id)) {
                const updatePayload = { content: errorText };
                if (typeof context.updateMessageById === 'function') {
                    context.updateMessageById(assistantMessage.id, updatePayload);
                } else if (typeof context.updateLastMessage === 'function') {
                    context.updateLastMessage(updatePayload);
                }
            }

            if (context && logId && typeof context.completeRequest === 'function') {
                context.completeRequest(logId, 500, { error: error.message });
            }

            if (isMultiRouteCandidate && multiRoute && typeof multiRoute.markRouteFinished === 'function') {
                multiRoute.markRouteFinished(conv.id, multiRouteGroupId, multiRouteRouteId, {
                    status: 'error',
                    currentMessageId: assistantMessage.id,
                    messageId: assistantMessage.id,
                    error: errorText
                });
            }
        } finally {
            // 始终清理自己的 loading（无论是否是最新请求）
            // 这支持多分支/多对话并行生成
            if (context && context.removeMessageStreamingIndicator) {
                context.removeMessageStreamingIndicator(assistantMessage.id);
            }
            if (loadingId && context && context.removeLoadingIndicator) {
                context.removeLoadingIndicator(loadingId);
            }
            
            // 只有当自己仍是最新请求时，才清理全局状态
            if (store.state.typingMessageId === assistantMessage.id) {
                store.state.isTyping = false;
                store.state.typingConversationId = null;
                store.state.typingMessageId = null;
                store.persist();
            }
            
            // 恢复发送按钮状态（基于当前活跃路径是否还有生成中的消息）
            updateSendButtonLoadingState();
        }
    }

    // addAssistantMessage 函数已移除，不再需要
    // 所有消息创建都在 generateResponse 开始时完成

    const LOG_MAX_TEXT_LENGTH = 2000;
    const LOG_MAX_ATTACHMENTS = 6;
    const LOG_MAX_TOOL_CALLS = 8;
    const LOG_MAX_GEMINI_PARTS = 8;
    const LOG_MAX_PAYLOAD_BYTES = 64 * 1024;

    function truncateForLog(value, maxLen) {
        if (typeof value !== 'string') return value;
        if (value.length <= maxLen) return value;
        return `${value.slice(0, maxLen)}... [truncated ${value.length - maxLen} chars]`;
    }

    function sanitizeAttachmentForLog(att) {
        if (!att || typeof att !== 'object') return null;
        return {
            id: att.id || undefined,
            name: att.name || att.filename || undefined,
            type: att.type || att.mimeType || undefined,
            size: Number.isFinite(att.size) ? att.size : undefined,
            source: att.source || undefined,
            // 仅记录是否存在大字段，不记录原文
            hasDataUrl: typeof att.dataUrl === 'string',
            dataUrlLength: typeof att.dataUrl === 'string' ? att.dataUrl.length : undefined
        };
    }

    function sanitizeGeminiPartForLog(part) {
        if (!part || typeof part !== 'object') return null;

        const sanitized = {};

        if (typeof part.text === 'string') {
            sanitized.text = truncateForLog(part.text, LOG_MAX_TEXT_LENGTH);
        }

        if (part.inlineData && typeof part.inlineData === 'object') {
            const inlineData = part.inlineData;
            const rawData = typeof inlineData.data === 'string' ? inlineData.data : '';
            sanitized.inlineData = {
                mimeType: inlineData.mimeType || undefined,
                data: rawData ? '[BASE64_TRUNCATED]' : undefined,
                originalLength: rawData ? rawData.length : undefined
            };
        }

        if (part.fileData && typeof part.fileData === 'object') {
            sanitized.fileData = {
                mimeType: part.fileData.mimeType || undefined,
                fileUri: part.fileData.fileUri || undefined
            };
        }

        return Object.keys(sanitized).length > 0 ? sanitized : null;
    }

    function sanitizeMessageMetadataForLog(meta) {
        if (!meta || typeof meta !== 'object') return undefined;

        const out = {};

        if (Array.isArray(meta.attachments)) {
            out.attachments = meta.attachments
                .slice(0, LOG_MAX_ATTACHMENTS)
                .map(sanitizeAttachmentForLog)
                .filter(Boolean);
        }

        if (meta.gemini && typeof meta.gemini === 'object') {
            const geminiOut = {};
            const geminiMeta = meta.gemini;

            if (geminiMeta.thoughtSignature) {
                geminiOut.thoughtSignature = truncateForLog(String(geminiMeta.thoughtSignature), 400);
            }
            if (Array.isArray(geminiMeta.parts)) {
                geminiOut.parts = geminiMeta.parts
                    .slice(0, LOG_MAX_GEMINI_PARTS)
                    .map(sanitizeGeminiPartForLog)
                    .filter(Boolean);
            }

            if (Object.keys(geminiOut).length > 0) {
                out.gemini = geminiOut;
            }
        }

        if (meta.urlContextMetadata && typeof meta.urlContextMetadata === 'object') {
            out.urlContextMetadata = meta.urlContextMetadata;
        }
        if (Array.isArray(meta.searchQueries)) {
            out.searchQueries = meta.searchQueries.slice(0, 10).map(q => truncateForLog(String(q), 200));
        }
        if (Array.isArray(meta.citations)) {
            out.citations = meta.citations.slice(0, 20);
        }
        if (meta.attachmentsInlineFallback) {
            out.attachmentsInlineFallback = true;
        }
        if (meta.attachmentsPersistFailed) {
            out.attachmentsPersistFailed = true;
        }

        return Object.keys(out).length > 0 ? out : undefined;
    }

    function sanitizeToolCallForLog(tc) {
        if (!tc || typeof tc !== 'object') return null;
        const fn = tc.function || {};
        let argsText = '';
        if (typeof fn.arguments === 'string') {
            argsText = fn.arguments;
        } else if (tc.args) {
            try {
                argsText = JSON.stringify(tc.args);
            } catch (e) {
                argsText = '[UNSERIALIZABLE_ARGS]';
            }
        }
        return {
            id: tc.id || undefined,
            type: tc.type || undefined,
            function: {
                name: fn.name || tc.name || undefined,
                arguments: truncateForLog(argsText, 1200)
            }
        };
    }

    function sanitizeChoiceForLog(choice) {
        if (!choice || typeof choice !== 'object') return null;

        const out = {
            index: Number.isFinite(choice.index) ? choice.index : undefined,
            finish_reason: choice.finish_reason || undefined
        };

        const message = choice.message;
        if (message && typeof message === 'object') {
            const msgOut = {
                role: message.role || undefined,
                content: truncateForLog(typeof message.content === 'string' ? message.content : '', LOG_MAX_TEXT_LENGTH)
            };

            if (typeof message.reasoning_content === 'string') {
                msgOut.reasoning_content = truncateForLog(message.reasoning_content, LOG_MAX_TEXT_LENGTH);
            }

            if (Array.isArray(message.attachments)) {
                msgOut.attachments = message.attachments
                    .slice(0, LOG_MAX_ATTACHMENTS)
                    .map(sanitizeAttachmentForLog)
                    .filter(Boolean);
            }

            if (Array.isArray(message.tool_calls)) {
                msgOut.tool_calls = message.tool_calls
                    .slice(0, LOG_MAX_TOOL_CALLS)
                    .map(sanitizeToolCallForLog)
                    .filter(Boolean);
            }

            const meta = sanitizeMessageMetadataForLog(message.metadata);
            if (meta) {
                msgOut.metadata = meta;
            }

            out.message = msgOut;
        }

        // 删除 undefined 字段
        Object.keys(out).forEach((key) => {
            if (out[key] === undefined) delete out[key];
        });

        return out;
    }

    /**
     * 精简响应数据用于日志记录，去除大型 base64 数据
     * @param {Object} response - 原始响应
     * @returns {Object} 精简后的响应
     */
    function sanitizeResponseForLog(response) {
        if (!response || typeof response !== 'object') return response;

        try {
            const sanitized = {
                id: response.id || undefined,
                object: response.object || undefined,
                created: response.created || undefined,
                model: response.model || undefined,
                provider: response.provider || undefined
            };

            if (response.usage && typeof response.usage === 'object') {
                sanitized.usage = {
                    prompt_tokens: response.usage.prompt_tokens,
                    completion_tokens: response.usage.completion_tokens,
                    total_tokens: response.usage.total_tokens
                };
            }

            if (Array.isArray(response.choices)) {
                sanitized.choices = response.choices
                    .slice(0, 4)
                    .map(sanitizeChoiceForLog)
                    .filter(Boolean);
            }

            if (response.error) {
                sanitized.error = {
                    code: response.error.code,
                    message: truncateForLog(String(response.error.message || ''), 500)
                };
            }

            if (response.timing && typeof response.timing === 'object') {
                sanitized.timing = response.timing;
            }

            Object.keys(sanitized).forEach((key) => {
                if (sanitized[key] === undefined) delete sanitized[key];
            });

            const serialized = JSON.stringify(sanitized);
            if (serialized.length > LOG_MAX_PAYLOAD_BYTES) {
                const fallbackChoice = Array.isArray(sanitized.choices) && sanitized.choices[0]
                    ? sanitized.choices[0]
                    : null;
                const fallbackMessage = fallbackChoice && fallbackChoice.message
                    ? {
                        role: fallbackChoice.message.role || undefined,
                        content: truncateForLog(String(fallbackChoice.message.content || ''), 400)
                    }
                    : undefined;
                return {
                    id: sanitized.id,
                    model: sanitized.model,
                    usage: sanitized.usage,
                    truncated: true,
                    originalLength: serialized.length,
                    choice: fallbackMessage ? { message: fallbackMessage } : undefined
                };
            }

            return sanitized;
        } catch (e) {
            console.warn('Failed to sanitize response for log:', e);
            return {
                id: response.id || undefined,
                model: response.model || undefined,
                error: 'sanitize_failed'
            };
        }
    }

})();