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
    // 每个对话当前活跃的生成请求标识（用于忽略旧请求的流式更新和清理）
    const activeGenerationTokens = {};

    /**
     * 初始化消息处理模块
     */
    window.IdoFront.messageActions.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        service = window.IdoFront.service;
        utils = window.IdoFront.utils;
        
        // 监听思维链完成事件，存储时间到消息顶层
        if (context && context.events) {
            context.events.on('reasoning:completed', (data) => {
                const { messageId, duration } = data;
                const conv = store.getActiveConversation();
                if (!conv) return;
                
                const message = conv.messages.find(m => m.id === messageId);
                if (message && message.reasoning) {
                    // 直接存储到消息顶层
                    message.reasoningDuration = duration;
                    
                    // 持久化
                    store.persist();
                }
            });
        }

        // 注入编辑渲染器到 Framework
        if (context) {
            context.renderMessageEdit = window.IdoFront.messageActions.edit;
        }
    };

    // 判断某个对话是否有活跃的生成（用于恢复 UI 时去掉幽灵 loading）
    window.IdoFront.messageActions.hasActiveGeneration = function(convId) {
        if (!convId) return false;
        return !!activeGenerationTokens[convId];
    };

    /**
     * 发送消息
     */
    window.IdoFront.messageActions.send = async function(text, attachments = null) {
        // 在非 chat 主视图模式下，不走聊天消息管线（例如 image-gallery 等自定义主视图）
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

        // 1. Create User Message
        const userMessage = {
            id: utils.createId('msg_u'),
            role: 'user',
            content: text,
            createdAt: now,
            timestamp,
            plugin: null
        };

        // 如果有附件，保存到消息顶层
        if (attachments && attachments.length > 0) {
            userMessage.attachments = attachments;
        }

        store.addMessageToConversation(conv.id, userMessage);
        
        // UI Update - 传递附件信息和ID
        if (context) {
            context.addMessage('user', {
                content: text,
                attachments: attachments,
                id: userMessage.id
            });
        }

        await generateResponse(conv, userMessage.id);
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
        const originalAttachmentBlocks = Array.from(container.querySelectorAll('.flex.gap-2.flex-wrap.mb-2'));
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

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = 'image/*';
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
            const items = e.clipboardData?.items;
            if (!items || items.length === 0) return;

            const images = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) images.push(file);
                }
            }

            if (images.length === 0) return;
            e.preventDefault();

            for (const file of images) {
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

            // 更新消息内容
            const updateData = { content: newContent };
            if (editingAttachments.length > 0) {
                updateData.attachments = editingAttachments;
            } else {
                updateData.attachments = null;
            }
            
            store.updateMessage(conv.id, messageId, updateData);
            store.truncateFromMessage(conv.id, messageId);

            // 同步UI
            if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                window.IdoFront.conversationActions.syncUI();
            }

            // 重新生成
            if (targetMsg.role === 'user') {
                await window.IdoFront.messageActions.send(newContent, editingAttachments.length > 0 ? editingAttachments : null);
            } else {
                const msgIndex = conv.messages.findIndex(m => m.id === messageId);
                if (msgIndex > 0) {
                    const prevMsg = conv.messages[msgIndex - 1];
                    if (prevMsg && prevMsg.role === 'user') {
                        await generateResponse(conv, prevMsg.id);
                    }
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
            confirmBtn.title = '确认并重新生成';
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
        
        if (attachment.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = attachment.dataUrl;
            img.alt = attachment.name;
            preview.appendChild(img);
        } else {
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = 'description';
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
     * 重试/重新生成
     * @param {string} messageId - 触发重试的消息ID
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

        let truncateTargetId = null;

        // 确定截断点
        if (targetMsg.role === 'user') {
            truncateTargetId = messageId;
        } else if (targetMsg.role === 'assistant') {
            const index = conv.messages.indexOf(targetMsg);
            if (index > 0) {
                const prevMsg = conv.messages[index - 1];
                if (prevMsg) {
                    truncateTargetId = prevMsg.id;
                }
            }
        }

        if (truncateTargetId) {
            // 执行截断（内部会调用 persist，但已优化为节流）
            store.truncateConversation(conv.id, truncateTargetId);
            
            // 优化：增量 DOM 更新，避免完整重渲染
            const chatStream = document.getElementById('chat-stream');
            if (chatStream) {
                // 移除目标消息之后的所有节点
                const targetWrapper = chatStream.querySelector(`[data-message-id="${truncateTargetId}"]`);
                if (targetWrapper) {
                    // 清理流式指示器
                    targetWrapper.querySelectorAll('.message-streaming-indicator').forEach(ind => ind.remove());
                    // 移除后续所有节点
                    let cursor = targetWrapper.nextElementSibling;
                    while (cursor) {
                        const next = cursor.nextElementSibling;
                        cursor.remove();
                        cursor = next;
                    }
                } else {
                    // 降级：清空后面的内容
                    const allMessages = chatStream.querySelectorAll('[data-message-id]');
                    let foundTarget = false;
                    allMessages.forEach(el => {
                        if (foundTarget) {
                            el.remove();
                        } else if (el.dataset.messageId === truncateTargetId) {
                            foundTarget = true;
                            el.querySelectorAll('.message-streaming-indicator').forEach(ind => ind.remove());
                        }
                    });
                }
                // 清理所有独立的 loading 气泡
                chatStream.querySelectorAll('[data-loading-id]').forEach(el => el.remove());
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
            
            // 重新生成响应
            await generateResponse(conv, truncateTargetId);
        }
    };

    /**
     * 核心响应生成逻辑
     */
    async function generateResponse(conv, relatedUserMessageId) {
        const isActiveConv = () => store.state.activeConversationId === conv.id;

        // 为当前对话生成一个唯一的请求标识，用于忽略旧请求的流式更新/清理
        const generationToken = (utils && typeof utils.createId === 'function')
            ? utils.createId('gen')
            : `${Date.now()}_${Math.random()}`;
        activeGenerationTokens[conv.id] = generationToken;
        const isCurrentGeneration = () => activeGenerationTokens[conv.id] === generationToken;

        // 标记当前正在生成回复的对话，用于在切换对话后恢复 loading 状态
        store.state.isTyping = true;
        store.state.typingConversationId = conv.id;
        store.state.typingMessageId = null;
        store.persist();

        // 设置发送按钮为加载状态（仅在当前对话处于激活状态时）
        if (context && context.setSendButtonLoading && isActiveConv()) {
            context.setSendButtonLoading(true);
        }

        // 显示加载指示器（仅在当前对话处于激活状态时渲染到 UI）
        let loadingId = null;
        if (context && context.addLoadingIndicator && isActiveConv()) {
            loadingId = context.addLoadingIndicator();
        }

        // 2. Prepare API Call
        let channel = null;
        let selectedModel = null;

        // 检查对话是否已选择渠道
        if (!conv.selectedChannelId) {
            if (loadingId && context && context.removeLoadingIndicator) {
                context.removeLoadingIndicator(loadingId);
            }
            const errorMsg = '请先在顶部选择渠道和模型';
            addAssistantMessage(conv.id, errorMsg);
            store.state.isTyping = false;
            store.persist();
            return;
        }

        // 查找选中的渠道
        channel = store.state.channels.find(c => c.id === conv.selectedChannelId);
        
        if (!channel) {
            if (loadingId && context && context.removeLoadingIndicator) {
                context.removeLoadingIndicator(loadingId);
            }
            const errorMsg = '所选渠道不存在，请重新选择';
            addAssistantMessage(conv.id, errorMsg);
            store.state.isTyping = false;
            store.persist();
            return;
        }

        if (!channel.enabled) {
            if (loadingId && context && context.removeLoadingIndicator) {
                context.removeLoadingIndicator(loadingId);
            }
            const errorMsg = '所选渠道已禁用，请选择其他渠道或在设置中启用该渠道';
            addAssistantMessage(conv.id, errorMsg);
            store.state.isTyping = false;
            store.persist();
            return;
        }

        // 使用对话中选择的模型
        if (conv.selectedModel && channel.models && channel.models.includes(conv.selectedModel)) {
            selectedModel = conv.selectedModel;
        } else {
            selectedModel = channel.models?.[0];
        }

        // Get active persona settings
        const activePersona = store.getActivePersona();
        
        // Build messages payload with persona context
        let messagesPayload = [];
        
        // 1. Add system prompt if exists
        if (activePersona && activePersona.systemPrompt) {
            messagesPayload.push({
                role: 'system',
                content: activePersona.systemPrompt
            });
        }
        
        // 2. Add context messages (fake dialogues) if exists
        if (activePersona && activePersona.contextMessages && activePersona.contextMessages.length > 0) {
            activePersona.contextMessages.forEach(msg => {
                messagesPayload.push({
                    role: msg.role,
                    content: msg.content
                });
            });
        }
        
        // 3. Add actual conversation messages
        conv.messages.forEach(m => {
            const msg = {
                role: m.role,
                content: m.content
            };
            
            // 传递附件和metadata给渠道适配器
            if (m.attachments && m.attachments.length > 0) {
                if (!msg.metadata) msg.metadata = {};
                msg.metadata.attachments = m.attachments;
            }
            
            // 传递渠道特有的 metadata（如 Gemini 的 thoughtSignature）
            if (m.metadata) {
                msg.metadata = {
                    ...(msg.metadata || {}),
                    ...m.metadata
                };
            }
            
            messagesPayload.push(msg);
        });
        
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
                conv.messages.forEach(m => {
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
                
                // 在外层作用域定义变量，确保在 catch 和 finally 块中可访问
                let assistantMessage = null;
                let fullContent = '';
                let fullReasoning = null;
                // 标记流式是否已结束，防止 setTimeout 延迟的 onUpdate 覆盖已渲染的 Markdown
                let streamEnded = false;
                
                try {
                    // 判断当前模型是否为启用思考预算的模型（暂仅识别名称中包含 gpt-5）
                    const isReasoningModel = typeof selectedModel === 'string'
                        && selectedModel.toLowerCase().includes('gpt-5');
        
                    // 构建配置，按优先级合并参数：chat基础 -> 面具覆写 -> 渠道覆写 -> 会话覆写
                    const personaStream = activePersona ? activePersona.stream !== false : true;
                    const effectiveStream = typeof conv.streamOverride === 'boolean'
                        ? conv.streamOverride
                        : personaStream;
        
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

            const onUpdate = (data) => {
                // 如果流式已结束，忽略后续延迟到达的更新
                if (streamEnded) {
                    return;
                }
                // 如果本对话已经发起了新的请求，忽略旧请求的流式更新，避免多个助手气泡同时 loading 或内容错乱
                if (!isCurrentGeneration()) {
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
                
                fullContent = currentContent;
                fullReasoning = currentReasoning;
                
                // 从流式更新数据中提取附件（渠道适配器会直接返回在顶层或 metadata 中）
                let currentAttachments = null;
                if (data.attachments && Array.isArray(data.attachments)) {
                    // 渠道适配器直接在顶层返回 attachments
                    currentAttachments = data.attachments;
                } else if (currentMetadata && Array.isArray(currentMetadata.attachments)) {
                    // 兼容：某些渠道可能在 metadata 中返回
                    currentAttachments = currentMetadata.attachments;
                }
                
                const updatePayload = {
                    content: fullContent,
                    reasoning: fullReasoning
                };
                // 若本次增量包含附件，则一并传给 UI，便于框架层在流式过程中直接渲染图片
                if (currentAttachments && currentAttachments.length > 0) {
                    updatePayload.attachments = currentAttachments;
                }
                 
                if (!assistantMessage) {
                    // 第一次收到内容：创建真实消息（总是写入 Store）
                    assistantMessage = addAssistantMessage(conv.id, {
                        content: fullContent,
                        reasoning: fullReasoning,
                        attachments: currentAttachments,
                        metadata: currentMetadata
                    });

                    // 记录当前流式消息的 ID，方便在切换对话后复原 loading 到这条消息上
                    store.state.typingMessageId = assistantMessage.id;
                    
                    // 将加载指示器附着到消息下方（仅对当前激活的对话操作 UI）
                    if (context && context.attachLoadingIndicatorToMessage && isActiveConv()) {
                        let attached = false;
                        
                        if (loadingId) {
                            attached = context.attachLoadingIndicatorToMessage(loadingId, assistantMessage.id);
                        }
                        
                        // 如果原始加载气泡已经因为切换对话被清空，则重新创建一个并附着
                        if (!attached && context.addLoadingIndicator) {
                            const tmpLoadingId = context.addLoadingIndicator();
                            context.attachLoadingIndicatorToMessage(tmpLoadingId, assistantMessage.id);
                        }
                        
                        // 之后统一通过 messageId 来清理流式指示器
                        loadingId = null;
                    }
                } else {
                    // 仅当该对话当前处于激活状态时才更新屏幕上的最后一条消息
                    if (context && context.updateLastMessage && isActiveConv()) {
                        // 标记为流式阶段，避免频繁 Markdown 解析
                        updatePayload.streaming = true;
                        context.updateLastMessage(updatePayload);
                    }
                    // 更新助手消息的内容
                    assistantMessage.content = fullContent;
                    if (fullReasoning) {
                        assistantMessage.reasoning = fullReasoning;
                    }
                    if (currentAttachments && currentAttachments.length > 0) {
                        assistantMessage.attachments = currentAttachments;
                    }
                    if (currentMetadata) {
                        assistantMessage.metadata = currentMetadata;
                    }
                    // 流式更新时不持久化，避免频繁的 IndexedDB 写入
                    // 持久化将在流式完成后统一进行
                }
            };

            let response = null;
            try {
                const streamingEnabled = !!channelConfig.stream;
                const streamingCallback = streamingEnabled ? onUpdate : null;
                response = await service.callAI(messagesPayload, channelConfig, streamingCallback);
            } catch (apiError) {
                // 检查是否是用户取消
                if (apiError.name === 'AbortError') {
                    // 用户主动取消，不视为错误
                    console.log('请求已被用户取消');
                    
                    // 清理加载指示器
                    if (loadingId && context && context.removeLoadingIndicator) {
                        context.removeLoadingIndicator(loadingId);
                        loadingId = null;
                    }
                    
                    // 清理流式指示器（如果助手消息已存在）
                    if (assistantMessage && context && context.removeMessageStreamingIndicator && isActiveConv()) {
                        context.removeMessageStreamingIndicator(assistantMessage.id);
                    }
                    
                    // 如果还没有助手消息，添加一条提示
                    if (!assistantMessage) {
                        addAssistantMessage(conv.id, '✋ 已停止生成');
                    }
                    
                    // 重置全局打字状态
                    store.state.isTyping = false;
                    store.state.typingConversationId = null;
                    store.state.typingMessageId = null;
                    store.persist();
                    
                    // 清除当前生成标记，防止 finally 块重复处理
                    delete activeGenerationTokens[conv.id];
                    
                    // 恢复发送按钮状态
                    if (context && context.setSendButtonLoading && isActiveConv()) {
                        context.setSendButtonLoading(false);
                    }
                    
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
            
            if (!assistantMessage) {
                const choice = response.choices?.[0];
                const content = choice?.message?.content || '无内容响应';
                const reasoning = choice?.message?.reasoning_content || null;
                const metadata = choice?.message?.metadata || null;
                
                const attachments = choice?.message?.attachments || null;
                addAssistantMessage(conv.id, {
                    content,
                    reasoning,
                    attachments,
                    metadata
                });
                fullContent = content;
                if (reasoning) fullReasoning = reasoning;
            } else {
                // 标记流式结束，防止 setTimeout 延迟的 onUpdate 覆盖已渲染的内容
                streamEnded = true;
                
                // 流式更新完成，解析 Markdown（仅在当前对话处于激活状态时处理当前屏幕）
                if (context && context.finalizeStreamingMessage && isActiveConv()) {
                    context.finalizeStreamingMessage();
                }
                store.persist();
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
            
            const errorContent = `请求失败: ${error.message}`;
            addAssistantMessage(conv.id, errorContent);

            if (context && logId && typeof context.completeRequest === 'function') {
                context.completeRequest(logId, 500, { error: error.message });
            }
        } finally {
            // 如果本对话已经有了更新的请求，则不再负责清理全局打字状态和 UI，交由最新请求处理
            if (!isCurrentGeneration()) {
                return;
            }

            // 清理加载指示器：同时尝试两种方式，确保清理干净
            // 仅对当前激活的对话执行 UI 清理，避免误删其他对话中的加载状态
            if (assistantMessage && context && context.removeMessageStreamingIndicator && isActiveConv()) {
                context.removeMessageStreamingIndicator(assistantMessage.id);
            }
            if (loadingId && context && context.removeLoadingIndicator && isActiveConv()) {
                context.removeLoadingIndicator(loadingId);
            }
            
            // 重置全局打字状态和当前流式消息标记
            store.state.isTyping = false;
            store.state.typingConversationId = null;
            store.state.typingMessageId = null;
            store.persist();
            
            // 恢复发送按钮状态（仅在当前对话处于激活状态时）
            if (context && context.setSendButtonLoading && isActiveConv()) {
                context.setSendButtonLoading(false);
            }
        }
    }

    function addAssistantMessage(convId, contentOrObj) {
        const now = Date.now();
        let content = contentOrObj;
        let reasoning = null;
        let metadata = null;
        let attachments = null;
        
        if (typeof contentOrObj === 'object' && contentOrObj !== null) {
            content = contentOrObj.content || '';
            reasoning = contentOrObj.reasoning || null;
            metadata = contentOrObj.metadata || null;
            // 直接从顶层提取 attachments
            attachments = contentOrObj.attachments || null;
        }
        
        const msg = {
            id: utils.createId('msg_b'),
            role: 'assistant',
            content: content,
            createdAt: now,
            timestamp: new Date(now).toISOString(),
            plugin: null
        };
        
        if (reasoning) {
            msg.reasoning = reasoning;
        }
        if (attachments && attachments.length > 0) {
            msg.attachments = attachments;
        }
        // 持久化 metadata（框架层不关心具体内容，直接存储）
        if (metadata) {
            msg.metadata = metadata;
        }
        
        store.addMessageToConversation(convId, msg);
        // 仅当该对话当前处于激活状态时才立即写入当前聊天流 UI，
        // 否则只更新 Store，待下次 syncUI 时再统一渲染，避免串台。
        if (context && store.state.activeConversationId === convId) {
            const payload = { content, reasoning, id: msg.id };
            if (attachments && attachments.length > 0) {
                payload.attachments = attachments;
            }
            context.addMessage('ai', payload);
        }
        return msg;
    }

    /**
     * 精简响应数据用于日志记录，去除大型 base64 数据
     * @param {Object} response - 原始响应
     * @returns {Object} 精简后的响应
     */
    function sanitizeResponseForLog(response) {
        if (!response || typeof response !== 'object') return response;
        
        try {
            // 深拷贝以避免修改原始数据
            const sanitized = JSON.parse(JSON.stringify(response));
            
            // 处理 choices 中的 metadata
            if (sanitized.choices && Array.isArray(sanitized.choices)) {
                sanitized.choices.forEach(choice => {
                    if (choice.message && choice.message.metadata) {
                        const meta = choice.message.metadata;
                        
                        // 处理 Gemini 的 parts（可能包含 inlineData）
                        if (meta.gemini && Array.isArray(meta.gemini.parts)) {
                            meta.gemini.parts = meta.gemini.parts.map(part => {
                                if (part.inlineData && part.inlineData.data) {
                                    return {
                                        inlineData: {
                                            mimeType: part.inlineData.mimeType,
                                            data: '[BASE64_TRUNCATED]',
                                            originalLength: part.inlineData.data.length
                                        }
                                    };
                                }
                                return part;
                            });
                        }
                        
                        // 处理 attachments 中的 dataUrl
                        if (Array.isArray(meta.attachments)) {
                            meta.attachments = meta.attachments.map(att => ({
                                name: att.name,
                                type: att.type,
                                size: att.size,
                                source: att.source,
                                dataUrl: att.dataUrl ? '[DATA_URL_TRUNCATED]' : undefined
                            }));
                        }
                    }
                });
            }
            
            return sanitized;
        } catch (e) {
            console.warn('Failed to sanitize response for log:', e);
            return response;
        }
    }

})();