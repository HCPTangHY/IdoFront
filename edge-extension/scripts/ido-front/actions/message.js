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

        // 根据文本内容估算需要的行数（兼顾换行符和纯长段落）
        const baseText = originalContent || '';
        const newlineLines = (baseText.match(/\n/g) || []).length + 1;
        // 粗略估算：每行约 60 个字符，避免没有换行符的长段落只占几行高度
        const lengthLines = Math.ceil(baseText.length / 60) || 1;
        // 对长文本更激进：至少展开 10 行，最多 30 行，具体像素高度由 CSS max-height 再兜底
        const estimatedLines = Math.max(10, Math.min(30, Math.max(newlineLines, lengthLines)));
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

        // 创建附件管理区域
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

        // 隐藏原内容，显示编辑界面
        contentSpan.style.display = 'none';
        bubble.classList.add('message-editing-new');
        
        // 终极方案：完全移除align-items限制
        
        // 1. 确保messageWrapper占满整行
        messageWrapper.style.setProperty('width', '100%', 'important');
        messageWrapper.style.setProperty('max-width', '100%', 'important');
        
        // 2. 修改bubbleContainer的布局方式
        if (bubbleContainer) {
            // 完全移除所有可能的限制属性
            bubbleContainer.style.removeProperty('max-width');
            bubbleContainer.style.removeProperty('width');
            bubbleContainer.style.removeProperty('flex');
            bubbleContainer.style.removeProperty('align-items'); // 关键：移除align-items
            bubbleContainer.style.removeProperty('flex-direction');
            bubbleContainer.style.removeProperty('display');
            
            // 重新设置：使用block布局，移除flex-direction限制
            bubbleContainer.style.setProperty('display', 'block', 'important');
            // 不设置flex-direction，让容器能够正常延展
            bubbleContainer.style.setProperty('width', '100%', 'important');
            bubbleContainer.style.setProperty('max-width', 'none', 'important');
            bubbleContainer.style.setProperty('box-sizing', 'border-box', 'important');
        }
        
        // 3. 对于user消息，调整wrapper布局
        if (targetMsg.role === 'user') {
            // 使用 flex-start 确保头像在左侧，内容在右侧占满剩余空间
            messageWrapper.style.setProperty('justify-content', 'flex-start', 'important');
            
            // 调整头像顺序：默认 user 头像在右侧 (order: 2)，现在需要保持在右侧但布局改变
            // 实际上，我们希望编辑框占据左侧大部分空间，头像保持在最右侧
            // 所以 justify-content: space-between 是合理的，但需要确保宽度计算正确
            messageWrapper.style.setProperty('justify-content', 'space-between', 'important');

            if (bubbleContainer) {
                bubbleContainer.style.setProperty('margin-right', 'var(--ido-spacing-sm)', 'important');
                // 计算实际可用宽度：总宽度 - 头像宽度 - 间距
                bubbleContainer.style.setProperty('width', 'calc(100% - 3rem)', 'important');
                bubbleContainer.style.setProperty('flex', '1', 'important');
            }
        } else {
            // AI 消息
            if (bubbleContainer) {
                bubbleContainer.style.setProperty('width', 'calc(100% - 3rem)', 'important');
                bubbleContainer.style.setProperty('flex', '1', 'important');
            }
        }
        
        // 4. 强制bubble占满容器宽度
        bubble.style.removeProperty('max-width');
        bubble.style.removeProperty('width');
        bubble.style.setProperty('width', '100%', 'important');
        bubble.style.setProperty('max-width', 'none', 'important');
        bubble.style.setProperty('box-sizing', 'border-box', 'important');
        
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
            if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
                window.IdoFront.conversationActions.syncUI();
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

        store.state.isTyping = true;
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
        
        // Log Request
        const requestPayload = {
            model: selectedModel,
            messages: messagesPayload,
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

        // 3. Call Service with persona parameters
        try {
            // 构建配置，按优先级合并参数：chat基础 -> 面具覆写 -> 渠道覆写
            const channelConfig = {
                ...channel,
                model: selectedModel,
                // Apply persona parameters
                temperature: activePersona?.temperature,
                topP: activePersona?.topP,
                stream: activePersona?.stream !== false
            };
            
            // 合并paramsOverride：面具的paramsOverride会被渠道的paramsOverride覆盖
            // 最终优先级：基础参数 < 面具paramsOverride < 渠道paramsOverride
            if (activePersona?.paramsOverride || channel.paramsOverride) {
                channelConfig.paramsOverride = {
                    ...(activePersona?.paramsOverride || {}),
                    ...(channel.paramsOverride || {})
                };
            }
            
            // 在外层作用域定义变量，确保在 catch 和 finally 块中可访问
            let assistantMessage = null;
            let fullContent = '';
            let fullReasoning = null;

            const onUpdate = (data) => {
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
                
                const updatePayload = {
                    content: fullContent,
                    reasoning: fullReasoning
                };
                
                if (!assistantMessage) {
                    // 第一次收到内容：创建真实消息（总是写入 Store）
                    assistantMessage = addAssistantMessage(conv.id, {
                        content: fullContent,
                        reasoning: fullReasoning,
                        metadata: currentMetadata
                    });
                    
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
                response = await service.callAI(messagesPayload, channelConfig, onUpdate);
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
            // 清理加载指示器：同时尝试两种方式，确保清理干净
            // 仅对当前激活的对话执行 UI 清理，避免误删其他对话中的加载状态
            if (assistantMessage && context && context.removeMessageStreamingIndicator && isActiveConv()) {
                context.removeMessageStreamingIndicator(assistantMessage.id);
            }
            if (loadingId && context && context.removeLoadingIndicator && isActiveConv()) {
                context.removeLoadingIndicator(loadingId);
            }
            
            store.state.isTyping = false;
            store.persist();
        }
    }

    function addAssistantMessage(convId, contentOrObj) {
        const now = Date.now();
        let content = contentOrObj;
        let reasoning = null;
        let metadata = null;
        
        if (typeof contentOrObj === 'object' && contentOrObj !== null) {
            content = contentOrObj.content || '';
            reasoning = contentOrObj.reasoning || null;
            metadata = contentOrObj.metadata || null;
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
            context.addMessage('ai', { content, reasoning, id: msg.id });
        }
        return msg;
    }

})();