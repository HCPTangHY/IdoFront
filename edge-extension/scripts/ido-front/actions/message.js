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
        
        // 监听思维链完成事件，存储时间到 metadata
        if (context && context.events) {
            context.events.on('reasoning:completed', (data) => {
                const { messageId, duration } = data;
                const conv = store.getActiveConversation();
                if (!conv) return;
                
                const message = conv.messages.find(m => m.id === messageId);
                if (message && message.reasoning) {
                    // 初始化或更新 metadata
                    if (!message.metadata) {
                        message.metadata = {};
                    }
                    message.metadata.reasoningDuration = duration;
                    
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

        // 如果有附件，保存到 metadata
        if (attachments && attachments.length > 0) {
            userMessage.metadata = {
                attachments: attachments
            };
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
     * 编辑消息
     * @param {string} messageId - 要编辑的消息ID
     */
    window.IdoFront.messageActions.edit = function(messageId) {
        const conv = store.getActiveConversation();
        if (!conv) return;

        const targetMsg = conv.messages.find(m => m.id === messageId);
        if (!targetMsg) return;

        // 获取消息的 DOM 元素
        const chatStream = document.getElementById('chat-stream');
        if (!chatStream) return;
        
        const messageWrapper = chatStream.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageWrapper) return;

        const bubble = messageWrapper.querySelector('.ido-message__bubble');
        const contentSpan = bubble.querySelector('.message-content');
        if (!bubble || !contentSpan) return;

        // 获取气泡的父容器（bubbleContainer）——在编辑态下承担布局外壳
        const bubbleContainer = bubble.parentElement;
        if (bubbleContainer) {
            bubbleContainer.classList.add('message-edit-shell');
        }
        // 保存当前 wrapper / container / bubble 的原始内联样式，用于取消编辑时恢复
        const originalStyles = {
            wrapper: {
                justifyContent: messageWrapper.style.justifyContent
            },
            container: bubbleContainer ? {
                flex: bubbleContainer.style.flex,
                maxWidth: bubbleContainer.style.maxWidth,
                minWidth: bubbleContainer.style.minWidth,
                width: bubbleContainer.style.width,
                alignItems: bubbleContainer.style.alignItems
            } : null,
            bubble: {
                width: bubble.style.width,
                maxWidth: bubble.style.maxWidth,
                minWidth: bubble.style.minWidth,
                alignSelf: bubble.style.alignSelf
            }
        };

        // 保存原始内容、附件
        const originalContent = targetMsg.content;
        const originalAttachments = targetMsg.metadata?.attachments || [];
        
        // 当前编辑中的附件列表（克隆原始附件）
        let editingAttachments = JSON.parse(JSON.stringify(originalAttachments));

        // 创建编辑界面容器
        const editContainer = document.createElement('div');
        editContainer.className = 'message-edit-container-new';

        // 创建输入框
        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'message-edit-input-wrapper';

        const textarea = document.createElement('textarea');
        textarea.className = 'message-edit-input';
        textarea.value = originalContent;
        textarea.placeholder = '编辑消息...';

        // 根据文本内容估算需要的行数（兼顾换行符和纯长段落），更偏向紧凑展示
        const baseText = originalContent || '';
        const newlineLines = (baseText.match(/\n/g) || []).length + 1;
        // 粗略估算：每行约 60 个字符，避免没有换行符的长段落只占几行高度
        const lengthLines = Math.ceil(baseText.length / 60) || 1;
        // 默认最少展开 3 行，最多 20 行，具体像素高度仍由 CSS 的 max-height 兜底
        const estimatedLines = Math.max(3, Math.min(20, Math.max(newlineLines, lengthLines)));
        textarea.rows = estimatedLines;
        
        // 自动调整高度（按内容真实高度展开，具体上限交给 CSS max-height 控制）
        const adjustHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        };
        textarea.oninput = adjustHeight;
        // 初次进入编辑模式时，立刻按已有内容计算高度
        adjustHeight();
        
        inputWrapper.appendChild(textarea);
        editContainer.appendChild(inputWrapper);

        // 创建附件管理区域（优先放在按钮组上方，视觉上更贴近输入框）
        if (originalAttachments.length > 0 || targetMsg.role === 'user') {
            const attachmentArea = document.createElement('div');
            attachmentArea.className = 'message-edit-attachments';
            
            const updateAttachmentPreview = () => {
                attachmentArea.innerHTML = '';
                
                if (editingAttachments.length > 0) {
                    const attachmentList = document.createElement('div');
                    attachmentList.className = 'message-edit-attachment-list';
                    
                    editingAttachments.forEach((attachment, index) => {
                        const attachmentItem = createAttachmentPreview(attachment, () => {
                            // 删除附件
                            editingAttachments.splice(index, 1);
                            updateAttachmentPreview();
                        });
                        attachmentList.appendChild(attachmentItem);
                    });
                    
                    attachmentArea.appendChild(attachmentList);
                }
                
                // 只有用户消息才显示添加附件按钮
                if (targetMsg.role === 'user') {
                    const addBtn = document.createElement('button');
                    addBtn.className = 'message-edit-add-attachment';
                    addBtn.innerHTML = '<span class="material-symbols-outlined">add</span><span>添加附件</span>';
                    addBtn.onclick = () => {
                        const fileInput = document.createElement('input');
                        fileInput.type = 'file';
                        fileInput.multiple = true;
                        fileInput.accept = 'image/*,application/pdf,.txt,.doc,.docx';
                        
                        fileInput.onchange = async (e) => {
                            const files = Array.from(e.target.files);
                            for (const file of files) {
                                if (file.size > 10 * 1024 * 1024) {
                                    alert(`文件 ${file.name} 超过10MB限制`);
                                    continue;
                                }
                                
                                const dataUrl = await readFileAsDataURL(file);
                                editingAttachments.push({
                                    dataUrl: dataUrl,
                                    type: file.type,
                                    name: file.name,
                                    size: file.size
                                });
                            }
                            updateAttachmentPreview();
                        };
                        
                        fileInput.click();
                    };
                    attachmentArea.appendChild(addBtn);
                }
            };
            
            updateAttachmentPreview();

            // 支持在编辑输入框中直接粘贴图片（仅用户消息）
            if (targetMsg.role === 'user') {
                textarea.addEventListener('paste', async (e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;

                    const imageFiles = [];
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        if (item.type && item.type.startsWith('image/')) {
                            // 阻止默认将图片粘为文本的行为
                            e.preventDefault();
                            const file = item.getAsFile();
                            if (file) {
                                imageFiles.push(file);
                            }
                        }
                    }

                    if (imageFiles.length === 0) return;

                    for (const file of imageFiles) {
                        if (file.size > 10 * 1024 * 1024) {
                            alert(`文件 ${file.name} 超过10MB限制`);
                            continue;
                        }
                        const dataUrl = await readFileAsDataURL(file);
                        editingAttachments.push({
                            dataUrl,
                            type: file.type,
                            name: file.name,
                            size: file.size
                        });
                    }

                    updateAttachmentPreview();
                });
            }

            editContainer.appendChild(attachmentArea);
        }

        // 创建按钮组
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'message-edit-actions';

        // 取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'message-edit-icon-btn message-edit-icon-btn--cancel';
        cancelBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
        cancelBtn.title = '取消编辑';
        
        // 发送按钮
        const sendBtn = document.createElement('button');
        sendBtn.className = 'message-edit-icon-btn message-edit-icon-btn--send';
        sendBtn.innerHTML = '<span class="material-symbols-outlined">send</span>';
        sendBtn.title = '保存并重新发送';

        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(sendBtn);

        editContainer.appendChild(buttonGroup);

        // 隐藏原内容，显示编辑界面
        contentSpan.style.display = 'none';
        bubble.classList.add('message-editing-new');
        // 布局交由 CSS (.message-editing-new / .message-edit-shell) 控制，JS 不再强制注入内联宽度样式

        bubble.appendChild(editContainer);

        // 聚焦并再次校正高度（确保插入 DOM 之后 scrollHeight 正确）
        setTimeout(() => {
            adjustHeight();
            textarea.focus();
            textarea.select();
        }, 0);

        // 取消编辑
        const cancelEdit = () => {
            editContainer.remove();
            contentSpan.style.display = '';
            bubble.classList.remove('message-editing-new');
            
            // 恢复messageWrapper、bubbleContainer和bubble的原始样式
            if (originalStyles.wrapper) {
                messageWrapper.style.justifyContent = originalStyles.wrapper.justifyContent;
            }
            
            if (bubbleContainer && originalStyles.container) {
                bubbleContainer.style.flex = originalStyles.container.flex;
                bubbleContainer.style.maxWidth = originalStyles.container.maxWidth;
                bubbleContainer.style.minWidth = originalStyles.container.minWidth;
                bubbleContainer.style.width = originalStyles.container.width;
                bubbleContainer.style.alignItems = originalStyles.container.alignItems;
            }
            
            if (originalStyles.bubble) {
                bubble.style.width = originalStyles.bubble.width;
                bubble.style.maxWidth = originalStyles.bubble.maxWidth;
                bubble.style.minWidth = originalStyles.bubble.minWidth;
                bubble.style.alignSelf = originalStyles.bubble.alignSelf;
            }
        };

        // 保存编辑
        const saveEdit = async () => {
            const newContent = textarea.value.trim();
            if (!newContent && editingAttachments.length === 0) {
                alert('消息内容和附件不能同时为空');
                return;
            }

            // 更新消息内容和附件
            const updateData = { content: newContent };
            if (editingAttachments.length > 0) {
                updateData.metadata = { attachments: editingAttachments };
            } else if (targetMsg.metadata) {
                // 如果删除了所有附件，清除metadata中的attachments
                updateData.metadata = { ...targetMsg.metadata };
                delete updateData.metadata.attachments;
            }
            
            store.updateMessage(conv.id, messageId, updateData);

            // 删除该消息之后的所有消息
            store.truncateFromMessage(conv.id, messageId);

            // 同步UI
            if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                window.IdoFront.conversationActions.syncUI();
            }

            // 如果是用户消息，重新发送；如果是AI消息，重新生成
            if (targetMsg.role === 'user') {
                await window.IdoFront.messageActions.send(newContent, editingAttachments.length > 0 ? editingAttachments : null);
            } else {
                // AI消息：找到上一条用户消息并重新生成
                const msgIndex = conv.messages.findIndex(m => m.id === messageId);
                if (msgIndex > 0) {
                    const prevMsg = conv.messages[msgIndex - 1];
                    if (prevMsg && prevMsg.role === 'user') {
                        await generateResponse(conv, prevMsg.id);
                    }
                }
            }
        };

        sendBtn.onclick = saveEdit;
        cancelBtn.onclick = cancelEdit;

        // 支持快捷键
        textarea.onkeydown = (e) => {
            if (e.key === 'Escape') {
                cancelEdit();
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

        // 如果当前对话仍有进行中的请求，先清理其 loading / 流式状态并标记为已结束，
        // 避免旧请求和新的重试请求同时更新 UI，导致多个助手气泡同时 loading。
        if (store.state.isTyping && store.state.typingConversationId === conv.id) {
            store.state.isTyping = false;
            store.state.typingConversationId = null;
            store.state.typingMessageId = null;
            store.persist();

            if (context) {
                // 清理消息下方的流式指示器
                if (context.removeMessageStreamingIndicator) {
                    try {
                        context.removeMessageStreamingIndicator(null);
                    } catch (e) {
                        console.warn('removeMessageStreamingIndicator error during retry:', e);
                    }
                }
                // 清理任何遗留的独立 loading 气泡
                try {
                    const chatStream = document.getElementById('chat-stream');
                    if (chatStream) {
                        chatStream.querySelectorAll('[data-loading-id]').forEach(el => el.remove());
                        chatStream.querySelectorAll('.message-streaming-indicator').forEach(el => el.remove());
                    }
                } catch (e) {
                    console.warn('cleanup loading indicators during retry failed:', e);
                }
            }
        }

        let truncateTargetId = null;

        // 确定截断点
        if (targetMsg.role === 'user') {
            // 如果是用户消息，保留该消息，清除后面的所有内容
            truncateTargetId = messageId;
        } else if (targetMsg.role === 'assistant') {
            // 如果是助手消息，清除该消息及后面的内容，从上一条用户消息处重新生成
            const index = conv.messages.indexOf(targetMsg);
            if (index > 0) {
                const prevMsg = conv.messages[index - 1];
                if (prevMsg) {
                    truncateTargetId = prevMsg.id;
                }
            }
        }

        if (truncateTargetId) {
            // 执行截断
            store.truncateConversation(conv.id, truncateTargetId);
            
            // 同步UI
            // 局部更新 UI：避免完整重渲染导致卡顿
            try {
                const chatStream = document.getElementById('chat-stream');
                if (chatStream) {
                    // 移除聊天流中目标消息之后的所有节点（包括独立 loading 气泡）
                    const targetWrapper = chatStream.querySelector(`[data-message-id="${truncateTargetId}"]`);
                    if (targetWrapper) {
                        // 先移除目标气泡内可能存在的流式指示器
                        const indicators = targetWrapper.querySelectorAll('.message-streaming-indicator');
                        indicators.forEach(ind => ind.remove());
                        // 移除目标消息之后的所有兄弟节点
                        let cursor = targetWrapper.nextElementSibling;
                        while (cursor) {
                            const next = cursor.nextElementSibling;
                            cursor.remove();
                            cursor = next;
                        }
                    } else {
                        // 如果目标消息在屏幕上不可见（例如刚初始化或切换过视图），降级到清空并稍后增量渲染
                        chatStream.querySelectorAll('[data-message-id]').forEach(el => el.remove());
                        chatStream.querySelectorAll('[data-loading-id]').forEach(el => el.remove());
                    }
                    // 兜底清理任何残留的独立 loading 提示
                    chatStream.querySelectorAll('[data-loading-id]').forEach(el => el.remove());
                }
            } catch (e) {
                console.warn('Partial UI cleanup during retry failed:', e);
            }

            // 更新侧边历史列表（不触发全部消息重绘）
            if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.renderConversationList) {
                try {
                    window.IdoFront.conversationActions.renderConversationList();
                } catch (e) {
                    console.warn('renderConversationList error during retry:', e);
                }
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
            
            // 如果消息有附件元数据，添加到消息中
            if (m.metadata) {
                msg.metadata = m.metadata;
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
                    if (m.metadata) {
                        const meta = { ...m.metadata };
                        if (Array.isArray(meta.attachments)) {
                            if (m.id === relatedUserMessageId) {
                                meta.attachments = meta.attachments.map(att => ({
                                    name: att.name,
                                    type: att.type,
                                    size: att.size
                                }));
                            } else {
                                delete meta.attachments;
                            }
                        }
                        out.metadata = meta;
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
                    
                    // 在外层作用域定义变量，确保在 catch 和 finally 块中可访问
                    let assistantMessage = null;
                    let fullContent = '';
                    let fullReasoning = null;

            const onUpdate = (data) => {
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
                
                // 从当前元数据中提取附件（例如 Gemini inlineData 转换的图片）
                let currentAttachments = null;
                if (currentMetadata && Array.isArray(currentMetadata.attachments)) {
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
                    assistantMessage.content = fullContent;
                    if (fullReasoning) {
                        assistantMessage.reasoning = fullReasoning;
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
                
                addAssistantMessage(conv.id, {
                    content,
                    reasoning,
                    metadata
                });
                fullContent = content;
                if (reasoning) fullReasoning = reasoning;
            } else {
                // 流式更新完成，解析 Markdown（仅在当前对话处于激活状态时处理当前屏幕）
                if (context && context.finalizeStreamingMessage && isActiveConv()) {
                    context.finalizeStreamingMessage();
                }
                store.persist();
            }

            store.addLog({
                 id: utils.createId('log'),
                 direction: 'incoming',
                 label: '200 OK',
                 timestamp: Date.now(),
                 data: response,
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
        }
        
        // 从 metadata 中提取附件（用于 Gemini 等渠道返回的图片），
        // 让 UI 层以 DOM <img> 方式渲染，而不是依赖 Markdown 图片语法。
        if (metadata && Array.isArray(metadata.attachments)) {
            attachments = metadata.attachments;
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

})();