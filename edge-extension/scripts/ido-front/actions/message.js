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

            // 用户消息：创建分支而非截断
            // AI 消息：只保存修改，不截断，不重新生成
            if (targetMsg.role === 'user') {
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
                    newUserMessage.attachments = editingAttachments;
                }
                
                // 使用 createBranch 创建分支（会自动设置 parentId 并切换到新分支）
                store.createBranch(conv.id, parentId, newUserMessage);
                
                // 同步UI
                if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                    window.IdoFront.conversationActions.syncUI();
                }
                
                // 生成新的响应
                await generateResponse(conv, newUserMessage.id);
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
                        timestamp: new Date(now).toISOString(),
                        attachments: editingAttachments.length > 0 ? editingAttachments : null
                    };
                    
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
                    // 移除 parentIdForNewBranch 之后的所有消息的 DOM 节点
                    for (let i = parentMsgIndex + 1; i < activePath.length; i++) {
                        const msgToRemove = activePath[i];
                        const msgEl = chatStream.querySelector(`[data-message-id="${msgToRemove.id}"]`);
                        if (msgEl) msgEl.remove();
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
            await generateResponse(conv, relatedUserMessageId, parentIdForNewBranch);
        }
    };

    /**
     * 核心响应生成逻辑
     * @param {Object} conv - 对话对象
     * @param {string} relatedUserMessageId - 触发生成的用户消息 ID
     * @param {string} [parentIdForNewBranch] - 可选，新 AI 消息的父节点 ID（用于分支模式）
     */
    async function generateResponse(conv, relatedUserMessageId, parentIdForNewBranch) {
        const isActiveConv = () => store.state.activeConversationId === conv.id;

        // 记录请求开始时间，用于计算持续时长
        const requestStartTime = Date.now();
        // 首字时间（收到第一个任何内容的时间，包括思维链）
        let firstTokenTime = null;
        // 正文首字时间（收到第一个正文内容的时间，用于计算 TPS）
        let firstContentTime = null;

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
            addAssistantMessage(conv.id, errorMsg, parentIdForNewBranch);
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
            addAssistantMessage(conv.id, errorMsg, parentIdForNewBranch);
            store.state.isTyping = false;
            store.persist();
            return;
        }

        if (!channel.enabled) {
            if (loadingId && context && context.removeLoadingIndicator) {
                context.removeLoadingIndicator(loadingId);
            }
            const errorMsg = '所选渠道已禁用，请选择其他渠道或在设置中启用该渠道';
            addAssistantMessage(conv.id, errorMsg, parentIdForNewBranch);
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
        
        // 3. Add actual conversation messages - 使用活跃路径而非全部消息
        // 这确保了在分支模式下只发送当前选中路径的消息给 AI
        const activePath = store.getActivePath(conv.id);
        activePath.forEach(m => {
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
                activePath.forEach(m => {
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
                
                // 记录首字时间（第一次收到任何内容，包括思维链）
                if (!firstTokenTime && (currentContent || currentReasoning)) {
                    firstTokenTime = Date.now();
                }
                
                // 记录正文首字时间（第一次收到正文内容，用于计算 TPS）
                if (!firstContentTime && currentContent) {
                    firstContentTime = Date.now();
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
                    // 传入 parentIdForNewBranch 以支持分支模式
                    assistantMessage = addAssistantMessage(conv.id, {
                        content: fullContent,
                        reasoning: fullReasoning,
                        attachments: currentAttachments,
                        metadata: currentMetadata
                    }, parentIdForNewBranch);

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
                        addAssistantMessage(conv.id, '✋ 已停止生成', parentIdForNewBranch);
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
                    metadata,
                    stats
                }, parentIdForNewBranch);
                fullContent = content;
                if (reasoning) fullReasoning = reasoning;
            } else {
                // 标记流式结束，防止 setTimeout 延迟的 onUpdate 覆盖已渲染的内容
                streamEnded = true;
                
                // 更新助手消息的统计信息
                assistantMessage.stats = stats;
                
                // 流式更新完成，解析 Markdown（仅在当前对话处于激活状态时处理当前屏幕）
                if (context && context.finalizeStreamingMessage && isActiveConv()) {
                    context.finalizeStreamingMessage(stats);
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
            addAssistantMessage(conv.id, errorContent, parentIdForNewBranch);

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

    /**
     * 添加助手消息
     * @param {string} convId - 对话 ID
     * @param {string|Object} contentOrObj - 消息内容或包含内容的对象
     * @param {string} [parentId] - 可选，父消息 ID（用于分支模式）
     */
    function addAssistantMessage(convId, contentOrObj, parentId) {
        const now = Date.now();
        let content = contentOrObj;
        let reasoning = null;
        let metadata = null;
        let attachments = null;
        let stats = null;
        
        if (typeof contentOrObj === 'object' && contentOrObj !== null) {
            content = contentOrObj.content || '';
            reasoning = contentOrObj.reasoning || null;
            metadata = contentOrObj.metadata || null;
            // 直接从顶层提取 attachments
            attachments = contentOrObj.attachments || null;
            // 提取统计信息
            stats = contentOrObj.stats || null;
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
        // 保存统计信息
        if (stats) {
            msg.stats = stats;
        }
        
        // 保存模型名和渠道名到消息中
        const conv = store.state.conversations.find(c => c.id === convId);
        if (conv) {
            if (conv.selectedModel) {
                msg.modelName = conv.selectedModel;
            }
            if (conv.selectedChannelId) {
                const channel = store.state.channels && store.state.channels.find(c => c.id === conv.selectedChannelId);
                if (channel) {
                    msg.channelName = channel.name;
                }
            }
        }
        
        // 添加消息到对话，支持指定父消息 ID（用于分支模式）
        store.addMessageToConversation(convId, msg, parentId);
        // 仅当该对话当前处于激活状态时才立即写入当前聊天流 UI，
        // 否则只更新 Store，待下次 syncUI 时再统一渲染，避免串台。
        if (context && store.state.activeConversationId === convId) {
            const payload = { content, reasoning, id: msg.id };
            if (attachments && attachments.length > 0) {
                payload.attachments = attachments;
            }
            
            // 使用已保存到消息中的模型和渠道名称
            if (msg.modelName) {
                payload.modelName = msg.modelName;
            }
            if (msg.channelName) {
                payload.channelName = msg.channelName;
            }
            // 传递统计信息
            if (stats) {
                payload.stats = stats;
            }
            
            // 计算分支信息（用于显示分支切换器）
            if (conv) {
                const msgParentId = msg.parentId === undefined || msg.parentId === null ? 'root' : msg.parentId;
                const siblings = conv.messages.filter(m => {
                    const pId = m.parentId === undefined || m.parentId === null ? 'root' : m.parentId;
                    return pId === msgParentId;
                }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                
                if (siblings.length > 1) {
                    const currentIndex = siblings.findIndex(s => s.id === msg.id);
                    payload.branchInfo = {
                        currentIndex,
                        total: siblings.length,
                        siblings: siblings.map(s => s.id)
                    };
                }
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