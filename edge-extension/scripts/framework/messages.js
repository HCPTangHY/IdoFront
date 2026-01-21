/**
 * 消息管理模块
 * 负责消息的添加、更新、渲染和流式处理
 */
const FrameworkMessages = (function() {
    'use strict';

    // 依赖模块引用
    let layout = null;
    let plugins = null;
    let markdown = null;
    let events = null;

    // 消息状态
    const state = {
        messages: []
    };

    // RAF 节流状态
    let rafUpdatePending = false;
    let pendingUpdate = null;

    /**
     * 初始化依赖
     */
    function init(deps) {
        layout = deps.layout;
        plugins = deps.plugins;
        markdown = deps.markdown;
        events = deps.events;
    }

    /**
     * 获取 UI 引用
     */
    function getUI() {
        return layout ? layout.getUI() : {};
    }

    /**
     * 清空所有消息
     */
    function clearMessages() {
        state.messages = [];
        const ui = getUI();
        if (ui.chatStream) {
            ui.chatStream.innerHTML = '';
        }
    }

    /**
     * 打开图片 Lightbox
     */
    function openLightbox(images, currentIndex) {
        if (!images || images.length === 0) return;

        let currentIdx = currentIndex;

        const lightbox = document.createElement('div');
        lightbox.className = 'ido-lightbox';
        lightbox.id = 'ido-lightbox';

        const content = document.createElement('div');
        content.className = 'ido-lightbox__content';

        const img = document.createElement('img');
        img.className = 'ido-lightbox__image';
        img.alt = images[currentIdx].name || 'Image';

        // 支持附件外置化：如果没有 dataUrl，则按 attachment.id 从 IdoFront.attachments 取 objectURL
        const initialSrc = images[currentIdx].dataUrl;
        if (initialSrc) {
            img.src = initialSrc;
        } else if (
            images[currentIdx].id &&
            window.IdoFront &&
            window.IdoFront.attachments &&
            typeof window.IdoFront.attachments.getObjectUrl === 'function'
        ) {
            window.IdoFront.attachments.getObjectUrl(images[currentIdx].id).then((url) => {
                if (url) img.src = url;
            }).catch(() => {
                // ignore
            });
        }

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ido-lightbox__close';
        closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
        closeBtn.onclick = closeLightbox;

        content.appendChild(img);
        content.appendChild(closeBtn);

        if (images.length > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'ido-lightbox__nav ido-lightbox__nav--prev';
            prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
            prevBtn.onclick = () => navigateLightbox(-1);

            const nextBtn = document.createElement('button');
            nextBtn.className = 'ido-lightbox__nav ido-lightbox__nav--next';
            nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
            nextBtn.onclick = () => navigateLightbox(1);

            const counter = document.createElement('div');
            counter.className = 'ido-lightbox__counter';
            counter.id = 'lightbox-counter';
            counter.textContent = `${currentIdx + 1} / ${images.length}`;

            content.appendChild(prevBtn);
            content.appendChild(nextBtn);
            content.appendChild(counter);
        }

        lightbox.appendChild(content);
        document.body.appendChild(lightbox);

        requestAnimationFrame(() => {
            lightbox.classList.add('ido-lightbox--visible');
        });

        function handleKeydown(e) {
            if (e.key === 'Escape') {
                closeLightbox();
            } else if (e.key === 'ArrowLeft' && images.length > 1) {
                navigateLightbox(-1);
            } else if (e.key === 'ArrowRight' && images.length > 1) {
                navigateLightbox(1);
            }
        }

        document.addEventListener('keydown', handleKeydown);

        lightbox.onclick = (e) => {
            if (e.target === lightbox) {
                closeLightbox();
            }
        };

        function navigateLightbox(direction) {
            currentIdx = (currentIdx + direction + images.length) % images.length;
            img.alt = images[currentIdx].name || 'Image';

            const nextSrc = images[currentIdx].dataUrl;
            if (nextSrc) {
                img.src = nextSrc;
            } else {
                img.removeAttribute('src');
                if (
                    images[currentIdx].id &&
                    window.IdoFront &&
                    window.IdoFront.attachments &&
                    typeof window.IdoFront.attachments.getObjectUrl === 'function'
                ) {
                    window.IdoFront.attachments.getObjectUrl(images[currentIdx].id).then((url) => {
                        if (url) img.src = url;
                    }).catch(() => {
                        // ignore
                    });
                }
            }

            const counter = document.getElementById('lightbox-counter');
            if (counter) {
                counter.textContent = `${currentIdx + 1} / ${images.length}`;
            }
        }

        function closeLightbox() {
            document.removeEventListener('keydown', handleKeydown);
            lightbox.classList.remove('ido-lightbox--visible');

            setTimeout(() => {
                lightbox.remove();
            }, 300);
        }
    }

    /**
     * 创建统计信息栏
     */
    function createStatsBar(stats) {
        const statsBar = document.createElement('div');
        statsBar.className = 'ido-message__stats';

        const items = [];

        if (stats.duration !== undefined && stats.duration !== null) {
            items.push(`<span class="ido-stats__item" title="总用时"><span class="material-symbols-outlined">timer</span>${stats.duration.toFixed(1)}s</span>`);
        }

        if (stats.usage) {
            if (stats.usage.prompt_tokens) {
                items.push(`<span class="ido-stats__item" title="输入 tokens"><span class="material-symbols-outlined">login</span>${stats.usage.prompt_tokens}</span>`);
            }
            if (stats.usage.completion_tokens) {
                items.push(`<span class="ido-stats__item" title="输出 tokens"><span class="material-symbols-outlined">logout</span>${stats.usage.completion_tokens}</span>`);
            }
        }

        if (stats.tps !== undefined && stats.tps !== null) {
            items.push(`<span class="ido-stats__item" title="生成速度 (tokens/秒)"><span class="material-symbols-outlined">speed</span>${stats.tps.toFixed(1)} t/s</span>`);
        }

        statsBar.innerHTML = items.join('<span class="ido-stats__divider">·</span>');

        return statsBar;
    }

    /**
     * 格式化消息时间
     */
    function formatMessageTime(timestamp) {
        if (!timestamp) return '';
        
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        const timeStr = date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        if (isToday) {
            return timeStr;
        } else {
            const dateStr = date.toLocaleDateString('zh-CN', {
                month: 'numeric',
                day: 'numeric'
            });
            return `${dateStr} ${timeStr}`;
        }
    }

    /**
     * 添加消息
     */
    function addMessage(role, textOrObj, options) {
        options = options || {};
        const ui = getUI();

        let text = textOrObj;
        let reasoning = null;
        let id = Date.now();
        let attachments = null;
        let reasoningDuration = null;
        let modelName = null;
        let channelName = null;
        let stats = null;
        let branchInfo = null;
        let createdAt = null;
        let toolCalls = null;  // 工具调用

        // 累计计时所需的额外字段
        let reasoningAccumulatedTime = null;
        let reasoningSegmentStart = null;

        if (typeof textOrObj === 'object' && textOrObj !== null) {
            text = textOrObj.content || '';
            reasoning = textOrObj.reasoning || null;
            attachments = textOrObj.attachments || null;
            reasoningDuration = textOrObj.reasoningDuration || null;
            reasoningAccumulatedTime = textOrObj.reasoningAccumulatedTime || null;
            reasoningSegmentStart = textOrObj.reasoningSegmentStart || null;
            modelName = textOrObj.modelName || null;
            channelName = textOrObj.channelName || null;
            stats = textOrObj.stats || null;
            branchInfo = textOrObj.branchInfo || null;
            createdAt = textOrObj.createdAt || null;
            toolCalls = textOrObj.toolCalls || null;  // 工具调用
            if (textOrObj.id) id = textOrObj.id;
        }

        const targetContainer = options.targetContainer || ui.chatStream;

        const msg = { role, text, reasoning, id, attachments, branchInfo };
        state.messages.push(msg);

        const card = document.createElement('div');
        card.className = 'ido-message';
        card.dataset.messageId = id;
        card.dataset.role = role;

        // 角色标签和时间
        const roleLabel = document.createElement('div');
        roleLabel.className = 'ido-message__role';
        
        const timeHtml = createdAt ? `<span class="ido-message__time">${formatMessageTime(createdAt)}</span>` : '';
        
        if (role === 'user') {
            roleLabel.innerHTML = `<span class="material-symbols-outlined ido-message__role-icon">person</span>User${timeHtml}`;
        } else {
            let aiLabel = 'AI';
            if (modelName && channelName) {
                aiLabel = `<strong>${modelName} | ${channelName}</strong>`;
            }
            roleLabel.innerHTML = `<span class="material-symbols-outlined ido-message__role-icon">auto_awesome</span>${aiLabel}${timeHtml}`;
        }
        card.appendChild(roleLabel);

        // 内容容器
        const container = document.createElement('div');
        container.className = 'ido-message__container';

        // 思维链
        if (reasoning) {
            const reasoningBlock = createReasoningBlock(reasoning, textOrObj, options);
            container.appendChild(reasoningBlock);
        }

        // 主要内容
        const contentDiv = document.createElement('div');
        contentDiv.className = 'ido-message__content';

        const contentSpan = document.createElement('div');
        contentSpan.className = 'message-content markdown-body';
        
        if (role !== 'user') {
            if (options.renderMarkdownSync && markdown) {
                markdown.renderSync(contentSpan, text || '');
            } else {
                contentSpan.textContent = text || '';
                contentSpan.dataset.needsMarkdown = 'true';
            }
        } else {
            contentSpan.textContent = text || '';
        }
        contentDiv.appendChild(contentSpan);
        container.appendChild(contentDiv);

        // 工具调用（在正文之后显示）
        if (toolCalls && toolCalls.length > 0) {
            const toolCallRenderer = window.IdoFront && window.IdoFront.toolCallRenderer;
            if (toolCallRenderer) {
                const toolCallsEl = toolCallRenderer.render(toolCalls);
                if (toolCallsEl) {
                    container.appendChild(toolCallsEl);
                }
            }
        }

        // 附件预览
        if (attachments && attachments.length > 0) {
            const attachmentsContainer = createAttachmentsContainer(attachments);
            if (attachmentsContainer) {
                container.appendChild(attachmentsContainer);
            }
        }

        card.appendChild(container);

        // 统计信息栏
        if (role !== 'user' && stats) {
            const statsBar = createStatsBar(stats);
            card.appendChild(statsBar);
        }

        // 消息控制区（包含操作栏和分支切换器）
        const controls = document.createElement('div');
        controls.className = 'ido-message__controls';

        // 操作栏 (Action Bar) - 放在第一位
        if (plugins) {
            const actionPlugins = plugins.getDynamicPlugins(plugins.SLOTS.MESSAGE_FOOTER, msg);
            if (actionPlugins.length > 0) {
                const actions = document.createElement('div');
                actions.className = 'ido-message__actions';
                
                actionPlugins.forEach(p => {
                    if (p) actions.appendChild(p);
                });
                
                controls.appendChild(actions);
            }
        }

        // 分支切换器 - 放在第二位
        if (branchInfo && branchInfo.total > 1) {
            const switcher = createBranchSwitcher(id, branchInfo);
            controls.appendChild(switcher);
        }

        if (controls.hasChildNodes()) {
            card.appendChild(controls);
        }

        targetContainer.appendChild(card);
        
        if (targetContainer === ui.chatStream && !options.noScroll) {
            ui.chatStream.scrollTop = ui.chatStream.scrollHeight;
        }

        return msg.id;
    }

    /**
     * 创建思维链区块
     * 支持三种状态：
     * 1. 已完成（有 reasoningDuration）→ 静态显示最终时长
     * 2. 进行中（有 reasoningAccumulatedTime + reasoningSegmentStart）→ 恢复计时器
     * 3. 新消息（无上述字段）→ 根据 isHistorical 决定
     */
    function createReasoningBlock(reasoning, textOrObj, options) {
        options = options || {};  // 确保 options 存在
        
        const reasoningBlock = document.createElement('div');
        reasoningBlock.className = 'reasoning-block';

        const toggle = document.createElement('div');
        toggle.className = 'reasoning-toggle';

        // 从传入数据中提取计时相关字段
        let reasoningDuration = null;
        let reasoningAccumulatedTime = null;
        let reasoningSegmentStart = null;
        
        if (typeof textOrObj === 'object' && textOrObj !== null) {
            // 使用 undefined 检查，避免 0 被误判为 falsy
            reasoningDuration = textOrObj.reasoningDuration !== undefined ? textOrObj.reasoningDuration : null;
            reasoningAccumulatedTime = textOrObj.reasoningAccumulatedTime !== undefined ? textOrObj.reasoningAccumulatedTime : null;
            reasoningSegmentStart = textOrObj.reasoningSegmentStart !== undefined ? textOrObj.reasoningSegmentStart : null;
        }

        const text = typeof textOrObj === 'object' ? textOrObj.content : textOrObj;
        // 老对话可能没有 reasoningDuration，但有 content，应该被视为历史消息
        // 新增：如果有 reasoning 但没有任何计时字段，也视为历史消息
        const hasAnyTimingData = reasoningDuration != null || reasoningAccumulatedTime != null || reasoningSegmentStart != null;
        const isHistoricalMessage = (text && text.trim().length > 0) || options.isHistorical || (reasoning && !hasAnyTimingData);

        // 状态1：已完成，静态显示最终时长
        if (reasoningDuration != null) {
            toggle.innerHTML = `<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">${typeof reasoningDuration === 'number' ? reasoningDuration.toFixed(1) : reasoningDuration}s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>`;
        }
        // 状态2：进行中，恢复计时器（从 Store 恢复状态）
        // 使用 != null 同时检查 null 和 undefined，避免老对话被误判
        else if (reasoningAccumulatedTime != null || reasoningSegmentStart != null) {
            const accumulated = reasoningAccumulatedTime || 0;
            const segmentStart = reasoningSegmentStart || null;
            
            // 计算初始显示值
            let initialDisplay = accumulated;
            if (segmentStart) {
                initialDisplay = accumulated + (Date.now() - segmentStart) / 1000;
            }
            
            toggle.innerHTML = `<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">${initialDisplay.toFixed(1)}s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>`;
            
            // 只有在思维链段进行中时才启动计时器
            if (segmentStart) {
                const timerSpan = toggle.querySelector('.reasoning-timer');
                const timerId = setInterval(() => {
                    const currentTime = accumulated + (Date.now() - segmentStart) / 1000;
                    if (timerSpan) timerSpan.textContent = currentTime.toFixed(1) + 's';
                }, 100);
                
                reasoningBlock.dataset.timerId = timerId;
                reasoningBlock.dataset.accumulatedTime = accumulated;
                reasoningBlock.dataset.segmentStart = segmentStart;
            } else {
                // 只有累计时间，无进行中的段，静态显示
            }
        }
        // 状态3：历史消息，无计时数据
        else if (isHistoricalMessage) {
            toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';
        }
        // 状态4：新生成的消息（不应该走到这里，因为 Store 会先设置 segmentStart）
        else {
            toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">0.0s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';

            const timerSpan = toggle.querySelector('.reasoning-timer');
            const startTime = Date.now();
            const timerId = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                if (timerSpan) timerSpan.textContent = elapsed.toFixed(1) + 's';
            }, 100);

            reasoningBlock.dataset.timerId = timerId;
            reasoningBlock.dataset.startTime = startTime;
        }

        toggle.onclick = (e) => {
            const content = e.currentTarget.nextElementSibling;
            const icon = e.currentTarget.querySelector('.material-symbols-outlined:last-child');
            content.classList.toggle('open');
            if (content.classList.contains('open')) {
                icon.style.transform = 'rotate(180deg)';
            } else {
                icon.style.transform = 'rotate(0deg)';
            }
        };

        const content = document.createElement('div');
        content.className = 'reasoning-content markdown-body';
        
        if (options.renderMarkdownSync && markdown) {
            markdown.renderSync(content, reasoning || '');
        } else {
            content.textContent = reasoning || '';
            content.dataset.needsMarkdown = 'true';
        }

        reasoningBlock.appendChild(toggle);
        reasoningBlock.appendChild(content);

        return reasoningBlock;
    }

    /**
     * 创建附件容器
     */
    function createAttachmentsContainer(attachments) {
        const imageAttachments = attachments.filter(a => a && a.type && a.type.startsWith('image/'));
        const pdfAttachments = attachments.filter(a => a && a.type === 'application/pdf');

        if (imageAttachments.length === 0 && pdfAttachments.length === 0) return null;

        const attachmentsContainer = document.createElement('div');
        
        // 处理图片附件
        if (imageAttachments.length > 0) {
            const imageContainer = document.createElement('div');
            if (imageAttachments.length === 1) {
                imageContainer.className = 'ido-message__attachments ido-message__attachments--single';
            } else {
                imageContainer.className = 'ido-message__attachments ido-message__attachments--grid';
            }

            imageAttachments.forEach((attachment, index) => {
                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'ido-message__attachment-wrapper';
                imgWrapper.dataset.imageIndex = index;
                imgWrapper.dataset.imageTotal = imageAttachments.length;

                const img = document.createElement('img');
                img.alt = attachment.name || 'Attached image';
                img.loading = 'lazy';

                const thumbSrc = attachment.dataUrl;
                if (thumbSrc) {
                    img.src = thumbSrc;
                } else if (
                    attachment.id &&
                    window.IdoFront &&
                    window.IdoFront.attachments &&
                    typeof window.IdoFront.attachments.getObjectUrl === 'function'
                ) {
                    window.IdoFront.attachments.getObjectUrl(attachment.id).then((url) => {
                        if (url) img.src = url;
                    }).catch(() => {
                        // ignore
                    });
                }

                const overlay = document.createElement('div');
                overlay.className = 'ido-message__attachment-overlay';
                overlay.innerHTML = '<span class="material-symbols-outlined">zoom_in</span>';

                imgWrapper.appendChild(img);
                imgWrapper.appendChild(overlay);

                imgWrapper.onclick = () => {
                    openLightbox(imageAttachments, index);
                };

                imageContainer.appendChild(imgWrapper);
            });
            
            attachmentsContainer.appendChild(imageContainer);
        }
        
        // 处理 PDF 附件
        if (pdfAttachments.length > 0) {
            const pdfContainer = document.createElement('div');
            pdfContainer.className = 'ido-message__attachments ido-message__attachments--files';
            
            pdfAttachments.forEach((attachment) => {
                const fileItem = document.createElement('div');
                fileItem.className = 'ido-message__file-item';
                
                const icon = document.createElement('span');
                icon.className = 'material-symbols-outlined ido-message__file-icon';
                icon.textContent = 'picture_as_pdf';
                
                const info = document.createElement('div');
                info.className = 'ido-message__file-info';
                
                const name = document.createElement('span');
                name.className = 'ido-message__file-name';
                name.textContent = attachment.name || 'PDF 文件';
                name.title = attachment.name || 'PDF 文件';
                
                const size = document.createElement('span');
                size.className = 'ido-message__file-size';
                if (attachment.size) {
                    const sizeKB = (attachment.size / 1024).toFixed(1);
                    const sizeMB = (attachment.size / (1024 * 1024)).toFixed(2);
                    size.textContent = attachment.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
                }
                
                info.appendChild(name);
                info.appendChild(size);
                
                fileItem.appendChild(icon);
                fileItem.appendChild(info);
                
                pdfContainer.appendChild(fileItem);
            });
            
            attachmentsContainer.appendChild(pdfContainer);
        }

        return attachmentsContainer;
    }

    /**
     * 创建分支切换器
     * @param {string} messageId - 当前消息 ID
     * @param {Object} branchInfo - 分支信息 { currentIndex, total, siblings }
     */
    function createBranchSwitcher(messageId, branchInfo) {
        const switcher = document.createElement('div');
        switcher.className = 'ido-branch-switcher';
        
        // 左箭头
        const prevBtn = document.createElement('button');
        prevBtn.className = 'ido-branch-switcher__btn';
        prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
        prevBtn.disabled = branchInfo.currentIndex === 0;
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (branchInfo.currentIndex > 0) {
                const prevId = branchInfo.siblings[branchInfo.currentIndex - 1];
                switchToBranch(prevId);
            }
        };
        
        // 计数器
        const counter = document.createElement('span');
        counter.className = 'ido-branch-switcher__counter';
        counter.textContent = `${branchInfo.currentIndex + 1}/${branchInfo.total}`;
        
        // 右箭头
        const nextBtn = document.createElement('button');
        nextBtn.className = 'ido-branch-switcher__btn';
        nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
        nextBtn.disabled = branchInfo.currentIndex === branchInfo.total - 1;
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            if (branchInfo.currentIndex < branchInfo.total - 1) {
                const nextId = branchInfo.siblings[branchInfo.currentIndex + 1];
                switchToBranch(nextId);
            }
        };
        
        switcher.appendChild(prevBtn);
        switcher.appendChild(counter);
        switcher.appendChild(nextBtn);
        
        return switcher;
    }

    /**
     * 切换到指定分支
     * @param {string} messageId - 要切换到的消息 ID
     */
    function switchToBranch(messageId) {
        const store = window.IdoFront && window.IdoFront.store;
        if (!store) return;
        
        const conv = store.getActiveConversation();
        if (!conv) return;
        
        // 获取要切换消息的父消息 ID（父消息在切换前后的 DOM 中都存在）
        const targetMsg = conv.messages.find(m => m.id === messageId);
        const parentId = targetMsg ? targetMsg.parentId : null;
        
        // 切换分支（静默模式：不触发全局事件广播，由下方 syncUI 负责 UI 更新）
        store.switchBranch(conv.id, messageId, { silent: true });
        
        // 重新渲染 UI，使用增量更新模式：只更新 parentId 之后的消息
        // 性能优化：
        // 1. skipConversationListUpdate: 分支切换不改变对话列表
        // 2. asyncMarkdown: 使用异步 Markdown 渲染减少主线程阻塞
        if (window.IdoFront.conversationActions && window.IdoFront.conversationActions.syncUI) {
            if (parentId) {
                window.IdoFront.conversationActions.syncUI({
                    focusMessageId: parentId,
                    incrementalFromParent: true,
                    skipConversationListUpdate: true,
                    asyncMarkdown: true
                });
            } else {
                window.IdoFront.conversationActions.syncUI({
                    preserveScroll: true,
                    skipConversationListUpdate: true,
                    asyncMarkdown: true
                });
            }
        }
    }

    /**
     * 添加加载指示器
     */
    function addLoadingIndicator() {
        const ui = getUI();
        const loadingId = `loading_${Date.now()}`;

        const card = document.createElement('div');
        card.className = 'ido-message';
        card.dataset.loadingId = loadingId;

        let aiLabel = 'AI';
        try {
            const store = window.IdoFront && window.IdoFront.store;
            if (store && store.state) {
                const conv = store.getActiveConversation && store.getActiveConversation();
                if (conv && conv.selectedModel && conv.selectedChannelId) {
                    const channel = store.state.channels && store.state.channels.find(c => c.id === conv.selectedChannelId);
                    if (channel) {
                        aiLabel = `<strong>${conv.selectedModel} | ${channel.name}</strong>`;
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to get model/channel info for loading indicator:', e);
        }

        const roleLabel = document.createElement('div');
        roleLabel.className = 'ido-message__role';
        roleLabel.innerHTML = `<span class="material-symbols-outlined ido-message__role-icon">auto_awesome</span>${aiLabel}`;
        card.appendChild(roleLabel);

        const container = document.createElement('div');
        container.className = 'ido-message__container ido-message__container--loading';

        const loadingDots = document.createElement('div');
        loadingDots.className = 'ido-loading-dots';
        loadingDots.innerHTML = `
            <span class="ido-loading-dots__dot"></span>
            <span class="ido-loading-dots__dot"></span>
            <span class="ido-loading-dots__dot"></span>
        `;

        container.appendChild(loadingDots);
        card.appendChild(container);

        ui.chatStream.appendChild(card);
        ui.chatStream.scrollTop = ui.chatStream.scrollHeight;

        return loadingId;
    }

    /**
     * 移除加载指示器
     */
    function removeLoadingIndicator(loadingId) {
        if (!loadingId) return;
        const ui = getUI();
        const loadingElement = ui.chatStream.querySelector(`[data-loading-id="${loadingId}"]`);
        if (loadingElement) {
            loadingElement.remove();
        }
    }

    /**
     * 获取消息包装器
     */
    function getMessageWrapperById(messageId) {
        if (!messageId) return null;
        const ui = getUI();
        return ui.chatStream.querySelector(`[data-message-id="${messageId}"]`);
    }

    /**
     * 获取最后一条消息卡片
     */
    function getLastMessageCard() {
        const ui = getUI();
        if (!ui.chatStream) return null;
        const cards = ui.chatStream.querySelectorAll('[data-message-id]');
        if (!cards || cards.length === 0) return null;
        return cards[cards.length - 1];
    }

    /**
     * 将加载指示器附着到消息下方
     */
    function attachLoadingIndicatorToMessage(loadingId, messageId) {
        const ui = getUI();
        if (!loadingId || !messageId) return false;
        const loadingElement = ui.chatStream.querySelector(`[data-loading-id="${loadingId}"]`);
        const targetWrapper = getMessageWrapperById(messageId);
        if (!loadingElement || !targetWrapper) return false;

        const loadingDots = loadingElement.querySelector('.ido-loading-dots');
        if (!loadingDots) return false;

        const container = targetWrapper.querySelector('.ido-message__container') || targetWrapper;
        if (!container) return false;

        const indicatorWrapper = document.createElement('div');
        indicatorWrapper.className = 'message-streaming-indicator';
        indicatorWrapper.appendChild(loadingDots);

        container.appendChild(indicatorWrapper);
        loadingElement.remove();
        return true;
    }

    /**
     * 移除消息的流式指示器
     */
    function removeMessageStreamingIndicator(messageId) {
        const ui = getUI();
        let removed = false;
        if (messageId) {
            const targetWrapper = getMessageWrapperById(messageId);
            if (targetWrapper) {
                const indicators = targetWrapper.querySelectorAll('.message-streaming-indicator');
                indicators.forEach(indicator => {
                    indicator.remove();
                    removed = true;
                });
            }
        }
        if (!removed) {
            const orphanIndicators = ui.chatStream.querySelectorAll('.message-streaming-indicator');
            orphanIndicators.forEach(indicator => indicator.remove());
        }
    }

    // ========== 定向更新（按 messageId） ==========
    const pendingUpdatesById = new Map();
    const rafPendingById = new Set();

    function findMessageIndexById(messageId) {
        if (!messageId) return -1;
        return state.messages.findIndex(m => m && m.id === messageId);
    }

    function getMessageCardById(messageId) {
        if (!messageId) return null;
        const ui = getUI();
        return ui.chatStream.querySelector(`[data-message-id="${messageId}"]`);
    }

    function performUIUpdateOnTarget(message, card, update) {
        if (!message || !card || !update) return;

        const container = card.querySelector('.ido-message__container');
        if (!container) return;

        const { text, reasoning, toolCalls, streaming, reasoningEnded } = update;

        let reasoningBlock = container.querySelector('.reasoning-block');
        let toolCallsContainer = container.querySelector('.tool-calls-container');
        let contentSpan = container.querySelector('.message-content');

        if (!contentSpan) {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'ido-message__content';
            contentSpan = document.createElement('div');
            contentSpan.className = 'message-content markdown-body';
            contentDiv.appendChild(contentSpan);
            container.appendChild(contentDiv);
        }

        // 处理思维链
        if (reasoning) {
            if (!reasoningBlock) {
                reasoningBlock = document.createElement('div');
                reasoningBlock.className = 'reasoning-block';

                const toggle = document.createElement('div');
                toggle.className = 'reasoning-toggle';
                toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">0.0s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';

                const timerSpan = toggle.querySelector('.reasoning-timer');
                const startTime = Date.now();
                const timerId = setInterval(() => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    timerSpan.textContent = elapsed.toFixed(1) + 's';
                }, 100);

                reasoningBlock.dataset.timerId = timerId;
                reasoningBlock.dataset.startTime = startTime;

                toggle.onclick = (e) => {
                    const content = e.currentTarget.nextElementSibling;
                    const icon = e.currentTarget.querySelector('.material-symbols-outlined:last-child');
                    content.classList.toggle('open');
                    if (content.classList.contains('open')) {
                        icon.style.transform = 'rotate(180deg)';
                    } else {
                        icon.style.transform = 'rotate(0deg)';
                    }
                };

                const content = document.createElement('div');
                content.className = 'reasoning-content markdown-body';

                reasoningBlock.appendChild(toggle);
                reasoningBlock.appendChild(content);

                const contentDiv = contentSpan.parentElement;
                container.insertBefore(reasoningBlock, contentDiv);
            }

            const reasoningContentDiv = reasoningBlock.querySelector('.reasoning-content');
            if (reasoningContentDiv && markdown) {
                markdown.renderSync(reasoningContentDiv, reasoning);
                reasoningContentDiv.removeAttribute('data-needs-markdown');
            }
        }

        // 思维链计时器控制逻辑（支持多段）
        if (reasoningBlock) {
            const hasTimer = !!reasoningBlock.dataset.timerId;

            if (reasoningEnded && hasTimer) {
                const timerId = parseInt(reasoningBlock.dataset.timerId, 10);
                if (!Number.isNaN(timerId)) {
                    clearInterval(timerId);
                }
                delete reasoningBlock.dataset.timerId;
                if (reasoningBlock.dataset.startTime) {
                    const startTime = parseInt(reasoningBlock.dataset.startTime, 10);
                    const elapsed = (Date.now() - startTime) / 1000;
                    reasoningBlock.dataset.accumulatedTime = elapsed;
                }
            } else if (!reasoningEnded && reasoning && !hasTimer) {
                const prevAccumulated = parseFloat(reasoningBlock.dataset.accumulatedTime) || 0;
                const toggle = reasoningBlock.querySelector('.reasoning-toggle');
                const timerSpan = toggle && toggle.querySelector('.reasoning-timer');

                if (timerSpan) {
                    const startTime = Date.now();
                    const timerId = setInterval(() => {
                        const newElapsed = prevAccumulated + (Date.now() - startTime) / 1000;
                        timerSpan.textContent = newElapsed.toFixed(1) + 's';
                    }, 100);

                    reasoningBlock.dataset.timerId = timerId;
                    reasoningBlock.dataset.startTime = startTime;
                }
            }
        }

        // 更新正文
        if (contentSpan && message.role !== 'user' && text && markdown) {
            markdown.renderSync(contentSpan, text);
            contentSpan.removeAttribute('data-needs-markdown');
        } else if (contentSpan) {
            contentSpan.textContent = text;
        }

        // 处理工具调用
        if (toolCalls && toolCalls.length > 0) {
            const toolCallRenderer = window.IdoFront && window.IdoFront.toolCallRenderer;
            if (toolCallRenderer && !toolCallsContainer) {
                toolCallsContainer = toolCallRenderer.render(toolCalls);
                if (toolCallsContainer) {
                    const contentDiv = contentSpan ? contentSpan.parentElement : null;
                    if (contentDiv && contentDiv.nextSibling) {
                        container.insertBefore(toolCallsContainer, contentDiv.nextSibling);
                    } else {
                        container.appendChild(toolCallsContainer);
                    }
                }
            }
        }

        // 处理附件（沿用现有逻辑）
        const currentAttachments = message.attachments;
        if (currentAttachments && currentAttachments.length > 0) {
            const existingAttachmentsContainer = container.querySelector('.ido-message__attachments');

            if (existingAttachmentsContainer) {
                const currentImgs = existingAttachmentsContainer.querySelectorAll('img');
                const imageAttachments = currentAttachments.filter(a => a && a.type && a.type.startsWith('image/'));

                if (currentImgs.length !== imageAttachments.length) {
                    existingAttachmentsContainer.remove();
                    const attachmentsContainer = createAttachmentsContainer(currentAttachments);
                    if (attachmentsContainer) {
                        container.appendChild(attachmentsContainer);
                    }
                }
            } else {
                const attachmentsContainer = createAttachmentsContainer(currentAttachments);
                if (attachmentsContainer) {
                    container.appendChild(attachmentsContainer);
                }
            }
        }

        // 滚动（仅流式时）
        if (streaming) {
            const ui = getUI();
            const stream = ui.chatStream;
            const isNearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
            if (isNearBottom) {
                stream.scrollTop = stream.scrollHeight;
            }
        }
    }

    /**
     * 更新指定消息
     */
    function updateMessageById(messageId, textOrObj) {
        const idx = findMessageIndexById(messageId);
        if (idx < 0) return;

        let text = textOrObj;
        let reasoning = null;
        let attachments;
        let toolCalls = null;
        let streaming = false;
        let reasoningEnded = false;

        if (typeof textOrObj === 'object' && textOrObj !== null) {
            text = textOrObj.content || '';
            reasoning = textOrObj.reasoning || null;
            if (Object.prototype.hasOwnProperty.call(textOrObj, 'attachments')) {
                attachments = textOrObj.attachments;
            }
            if (Object.prototype.hasOwnProperty.call(textOrObj, 'toolCalls')) {
                toolCalls = textOrObj.toolCalls;
            }
            streaming = !!textOrObj.streaming;
            reasoningEnded = !!textOrObj.reasoningEnded;
        }

        const msg = state.messages[idx];
        msg.text = text;
        if (reasoning !== null) {
            msg.reasoning = reasoning;
        }
        if (typeof attachments !== 'undefined') {
            msg.attachments = attachments;
        }
        if (toolCalls !== null) {
            msg.toolCalls = toolCalls;
        }

        pendingUpdatesById.set(messageId, { text, reasoning, toolCalls, streaming, reasoningEnded });

        if (!rafPendingById.has(messageId)) {
            rafPendingById.add(messageId);
            requestAnimationFrame(() => {
                const update = pendingUpdatesById.get(messageId);
                pendingUpdatesById.delete(messageId);
                rafPendingById.delete(messageId);
                const card = getMessageCardById(messageId);
                if (card && update) {
                    performUIUpdateOnTarget(msg, card, update);
                }
            });
        }
    }

    /**
     * 更新最后一条消息
     */
    function updateLastMessage(textOrObj) {
        if (state.messages.length === 0) return;

        const lastMsg = state.messages[state.messages.length - 1];
        updateMessageById(lastMsg.id, textOrObj);

        // 保留旧的 pendingUpdate 机制：保证 finalizeStreamingMessage 行为不变
        let text = textOrObj;
        let reasoning = null;
        let attachments;
        let toolCalls = null;
        let streaming = false;
        let reasoningEnded = false;

        if (typeof textOrObj === 'object' && textOrObj !== null) {
            text = textOrObj.content || '';
            reasoning = textOrObj.reasoning || null;
            if (Object.prototype.hasOwnProperty.call(textOrObj, 'attachments')) {
                attachments = textOrObj.attachments;
            }
            if (Object.prototype.hasOwnProperty.call(textOrObj, 'toolCalls')) {
                toolCalls = textOrObj.toolCalls;
            }
            streaming = !!textOrObj.streaming;
            reasoningEnded = !!textOrObj.reasoningEnded;
        }

        pendingUpdate = { text, reasoning, toolCalls, streaming, reasoningEnded };

        if (!rafUpdatePending) {
            rafUpdatePending = true;
            requestAnimationFrame(() => {
                performUIUpdate(pendingUpdate);
                rafUpdatePending = false;
                pendingUpdate = null;
            });
        }
    }

    /**
     * 执行 UI 更新
     */
    function performUIUpdate(update) {
        if (!update) return;

        const { text, reasoning, toolCalls, streaming, reasoningEnded } = update;
        const lastMsg = state.messages[state.messages.length - 1];

        const lastCard = getLastMessageCard();
        if (!lastCard) return;

        const container = lastCard.querySelector('.ido-message__container');
        if (!container) return;

        let reasoningBlock = container.querySelector('.reasoning-block');
        let toolCallsContainer = container.querySelector('.tool-calls-container');
        let contentSpan = container.querySelector('.message-content');

        if (!contentSpan) {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'ido-message__content';
            contentSpan = document.createElement('div');
            contentSpan.className = 'message-content markdown-body';
            contentDiv.appendChild(contentSpan);
            container.appendChild(contentDiv);
        }

        // 处理思维链
        if (reasoning) {
            if (!reasoningBlock) {
                reasoningBlock = document.createElement('div');
                reasoningBlock.className = 'reasoning-block';

                const toggle = document.createElement('div');
                toggle.className = 'reasoning-toggle';
                toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">0.0s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';

                const timerSpan = toggle.querySelector('.reasoning-timer');
                const startTime = Date.now();
                const timerId = setInterval(() => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    timerSpan.textContent = elapsed.toFixed(1) + 's';
                }, 100);

                reasoningBlock.dataset.timerId = timerId;
                reasoningBlock.dataset.startTime = startTime;

                toggle.onclick = (e) => {
                    const content = e.currentTarget.nextElementSibling;
                    const icon = e.currentTarget.querySelector('.material-symbols-outlined:last-child');
                    content.classList.toggle('open');
                    if (content.classList.contains('open')) {
                        icon.style.transform = 'rotate(180deg)';
                    } else {
                        icon.style.transform = 'rotate(0deg)';
                    }
                };

                const content = document.createElement('div');
                content.className = 'reasoning-content markdown-body';

                reasoningBlock.appendChild(toggle);
                reasoningBlock.appendChild(content);

                const contentDiv = contentSpan.parentElement;
                container.insertBefore(reasoningBlock, contentDiv);
            }

            const reasoningContentDiv = reasoningBlock.querySelector('.reasoning-content');
            if (reasoningContentDiv && markdown) {
                markdown.renderSync(reasoningContentDiv, reasoning);
                reasoningContentDiv.removeAttribute('data-needs-markdown');
            }
        }

        // ★ 思维链计时器控制逻辑（支持多段思维链）
        // reasoningEnded = true 表示当前思维链段已结束（正在输出正文）
        // reasoningEnded = false 表示当前在思维链段中（可能是新段开始）
        if (reasoningBlock) {
            const hasTimer = !!reasoningBlock.dataset.timerId;
            
            if (reasoningEnded && hasTimer) {
                // 思维链段结束，停止计时器
                const timerId = parseInt(reasoningBlock.dataset.timerId, 10);
                if (!Number.isNaN(timerId)) {
                    clearInterval(timerId);
                }
                delete reasoningBlock.dataset.timerId;
                // 保留 startTime 等数据，记录最后停止时的时间用于后续可能的恢复
                if (reasoningBlock.dataset.startTime) {
                    const startTime = parseInt(reasoningBlock.dataset.startTime, 10);
                    const elapsed = (Date.now() - startTime) / 1000;
                    // 将当前累计时间保存到 dataset 中
                    reasoningBlock.dataset.accumulatedTime = elapsed;
                }
            } else if (!reasoningEnded && reasoning && !hasTimer) {
                // 新的思维链段开始，重新启动计时器
                // 从之前累计的时间继续
                const prevAccumulated = parseFloat(reasoningBlock.dataset.accumulatedTime) || 0;
                const toggle = reasoningBlock.querySelector('.reasoning-toggle');
                const timerSpan = toggle && toggle.querySelector('.reasoning-timer');
                
                if (timerSpan) {
                    const startTime = Date.now();
                    const timerId = setInterval(() => {
                        const newElapsed = prevAccumulated + (Date.now() - startTime) / 1000;
                        timerSpan.textContent = newElapsed.toFixed(1) + 's';
                    }, 100);
                    
                    reasoningBlock.dataset.timerId = timerId;
                    reasoningBlock.dataset.startTime = startTime;
                }
            }
        }

        // 更新正文
        if (contentSpan && lastMsg.role !== 'user' && text && markdown) {
            markdown.renderSync(contentSpan, text);
            contentSpan.removeAttribute('data-needs-markdown');
        } else if (contentSpan) {
            contentSpan.textContent = text;
        }

        // 处理工具调用（在正文之后、附件之前）
        if (toolCalls && toolCalls.length > 0) {
            const toolCallRenderer = window.IdoFront && window.IdoFront.toolCallRenderer;
            if (toolCallRenderer && !toolCallsContainer) {
                // 首次创建工具调用容器
                toolCallsContainer = toolCallRenderer.render(toolCalls);
                if (toolCallsContainer) {
                    // 插入到正文之后
                    const contentDiv = contentSpan ? contentSpan.parentElement : null;
                    if (contentDiv && contentDiv.nextSibling) {
                        container.insertBefore(toolCallsContainer, contentDiv.nextSibling);
                    } else {
                        container.appendChild(toolCallsContainer);
                    }
                }
            }
            // 工具调用状态更新由 toolCallRenderer.updateUI 单独处理
        }

        // 处理附件：如果是流式全量累加模式，需要重新渲染附件容器
        const currentAttachments = lastMsg.attachments;
        if (currentAttachments && currentAttachments.length > 0) {
            // 查找现有的附件容器
            const existingAttachmentsContainer = container.querySelector('.ido-message__attachments');
            
            // 如果已存在附件，且附件数量改变了，需要重新渲染整个附件区域
            if (existingAttachmentsContainer) {
                const currentImgs = existingAttachmentsContainer.querySelectorAll('img');
                const imageAttachments = currentAttachments.filter(a => a && a.type && a.type.startsWith('image/'));
                
                // 只有当图片数量变化时才重新渲染，避免闪烁
                if (currentImgs.length !== imageAttachments.length) {
                    existingAttachmentsContainer.remove();
                    const attachmentsContainer = createAttachmentsContainer(currentAttachments);
                    if (attachmentsContainer) {
                        container.appendChild(attachmentsContainer);
                    }
                }
            } else {
                // 首次渲染附件
                const attachmentsContainer = createAttachmentsContainer(currentAttachments);
                if (attachmentsContainer) {
                    container.appendChild(attachmentsContainer);
                }
            }
        }

        // 滚动
        const ui = getUI();
        const stream = ui.chatStream;
        const isNearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
        if (isNearBottom) {
            stream.scrollTop = stream.scrollHeight;
        }
    }

    /**
     * 更新消息统计信息
     */
    function updateMessageStats(messageId, stats) {
        const ui = getUI();
        if (!messageId || !stats) return;

        const card = ui.chatStream.querySelector(`[data-message-id="${messageId}"]`);
        if (!card) return;

        let statsBar = card.querySelector('.ido-message__stats');

        if (!statsBar) {
            statsBar = createStatsBar(stats);
            // 查找 controls 容器（包含 actions 和 branchSwitcher），它是 card 的直接子元素
            const controls = card.querySelector('.ido-message__controls');
            if (controls) {
                // 在 controls 之前插入 statsBar
                card.insertBefore(statsBar, controls);
            } else {
                card.appendChild(statsBar);
            }
        } else {
            const newStatsBar = createStatsBar(stats);
            statsBar.innerHTML = newStatsBar.innerHTML;
        }
    }

    function finalizeStreamingMessageById(messageId, stats) {
        const ui = getUI();
        if (!messageId) return;

        // 应用该消息的待更新（如果有）
        const pending = pendingUpdatesById.get(messageId);
        if (pending) {
            pendingUpdatesById.delete(messageId);
            const idx = findMessageIndexById(messageId);
            const msg = idx >= 0 ? state.messages[idx] : null;
            const card = getMessageCardById(messageId);
            if (msg && card) {
                performUIUpdateOnTarget(msg, card, pending);
            }
        }

        const card = ui.chatStream.querySelector(`[data-message-id="${messageId}"]`);
        if (!card) return;

        const container = card.querySelector('.ido-message__container');
        if (!container) return;

        const idx = findMessageIndexById(messageId);
        const msgState = idx >= 0 ? state.messages[idx] : null;

        // 停止思维链计时器（如果还有运行中的）
        const reasoningBlock = container.querySelector('.reasoning-block');
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

        // 从 Store 获取最终时长并更新 UI
        try {
            const store = window.IdoFront && window.IdoFront.store;
            if (store) {
                const conv = store.getActiveConversation && store.getActiveConversation();
                if (conv) {
                    const storeMsg = conv.messages.find(m => m.id === messageId);
                    if (storeMsg && storeMsg.reasoningDuration !== undefined) {
                        const toggle = reasoningBlock && reasoningBlock.querySelector('.reasoning-toggle');
                        const timerSpan = toggle && toggle.querySelector('.reasoning-timer');
                        if (timerSpan) {
                            timerSpan.textContent = storeMsg.reasoningDuration.toFixed(1) + 's';
                        }
                    }
                }
            }
        } catch (e) {
            // ignore
        }

        // 渲染思维链 Markdown
        const reasoningContent = container.querySelector('.reasoning-content[data-needs-markdown="true"]');
        if (reasoningContent && markdown) {
            const reasoningText = reasoningContent.textContent || '';
            if (reasoningText) {
                markdown.renderSync(reasoningContent, reasoningText);
            }
            reasoningContent.removeAttribute('data-needs-markdown');
        }

        // 渲染正文 Markdown
        const contentSpan = container.querySelector('.message-content[data-needs-markdown="true"]');
        if (contentSpan && markdown) {
            const contentText = contentSpan.textContent || '';
            if (contentText) {
                markdown.renderSync(contentSpan, contentText);
            }
            contentSpan.removeAttribute('data-needs-markdown');
        }

        // 移除该消息的流式指示器
        removeMessageStreamingIndicator(messageId);
        const strayIndicators = container.querySelectorAll('.message-streaming-indicator');
        strayIndicators.forEach(indicator => indicator.remove());

        // 渲染统计栏
        if (stats) {
            updateMessageStats(messageId, stats);
        }

        // 确保附件被渲染
        if (msgState && msgState.attachments && msgState.attachments.length > 0) {
            const existingWrapper = container.querySelector('.ido-message__attachment-wrapper');
            if (!existingWrapper) {
                const attachmentsContainer = createAttachmentsContainer(msgState.attachments);
                if (attachmentsContainer) {
                    container.appendChild(attachmentsContainer);
                }
            }
        }
    }

    /**
     * 完成流式消息更新
     */
    function finalizeStreamingMessage(stats) {
        const ui = getUI();
        
        if (pendingUpdate) {
            performUIUpdate(pendingUpdate);
            rafUpdatePending = false;
            pendingUpdate = null;
        }

        if (state.messages.length === 0) return;

        const lastCard = getLastMessageCard();
        if (!lastCard) return;

        const container = lastCard.querySelector('.ido-message__container');
        if (!container) return;

        const lastMsg = state.messages[state.messages.length - 1];
        const lastMsgId = lastMsg?.id;

        // 停止思维链计时器（如果还有运行中的）
        const reasoningBlock = container.querySelector('.reasoning-block');
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
        
        // 从 Store 获取最终时长并更新 UI
        // message.js 已经在生成结束时计算了 reasoningDuration 并保存到 Store
        // 这里尝试从 Store 读取最新的消息状态来更新显示
        try {
            const store = window.IdoFront && window.IdoFront.store;
            if (store && lastMsgId) {
                const conv = store.getActiveConversation && store.getActiveConversation();
                if (conv) {
                    const storeMsg = conv.messages.find(m => m.id === lastMsgId);
                    if (storeMsg && storeMsg.reasoningDuration !== undefined) {
                        const toggle = reasoningBlock && reasoningBlock.querySelector('.reasoning-toggle');
                        const timerSpan = toggle && toggle.querySelector('.reasoning-timer');
                        if (timerSpan) {
                            timerSpan.textContent = storeMsg.reasoningDuration.toFixed(1) + 's';
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to read reasoningDuration from store:', e);
        }

        // 渲染思维链 Markdown
        const reasoningContent = container.querySelector('.reasoning-content[data-needs-markdown="true"]');
        if (reasoningContent && markdown) {
            const reasoningText = reasoningContent.textContent || '';
            if (reasoningText) {
                markdown.renderSync(reasoningContent, reasoningText);
            }
            reasoningContent.removeAttribute('data-needs-markdown');
        }

        // 渲染正文 Markdown
        const contentSpan = container.querySelector('.message-content[data-needs-markdown="true"]');
        if (contentSpan && markdown) {
            const contentText = contentSpan.textContent || '';
            if (contentText) {
                markdown.renderSync(contentSpan, contentText);
            }
            contentSpan.removeAttribute('data-needs-markdown');
        }

        // 移除加载指示器
        if (lastMsgId) {
            removeMessageStreamingIndicator(lastMsgId);
        }
        const strayIndicators = container.querySelectorAll('.message-streaming-indicator');
        strayIndicators.forEach(indicator => indicator.remove());
        const floatingIndicators = ui.chatStream.querySelectorAll('[data-loading-id]');
        floatingIndicators.forEach(indicator => indicator.remove());

        // 渲染统计栏
        if (stats && lastMsgId) {
            updateMessageStats(lastMsgId, stats);
        }

        // 确保附件被渲染（修复流式更新期间附件可能未被渲染的问题）
        const lastMsgForAttachments = state.messages[state.messages.length - 1];
        if (lastMsgForAttachments && lastMsgForAttachments.attachments && lastMsgForAttachments.attachments.length > 0) {
            const existingWrapper = container.querySelector('.ido-message__attachment-wrapper');
            if (!existingWrapper) {
                const attachmentsContainer = createAttachmentsContainer(lastMsgForAttachments.attachments);
                if (attachmentsContainer) {
                    container.appendChild(attachmentsContainer);
                }
            }
        }
    }

    /**
     * 批量渲染所有待处理 Markdown
     */
    function renderAllPendingMarkdown() {
        const ui = getUI();
        if (markdown && ui.chatStream) {
            markdown.renderAllPending(ui.chatStream);
        }
    }

    /**
     * 获取消息状态
     */
    function getMessages() {
        return state.messages;
    }

    return {
        init,
        clearMessages,
        addMessage,
        updateLastMessage,
        updateMessageById,
        finalizeStreamingMessage,
        finalizeStreamingMessageById,
        renderAllPendingMarkdown,
        addLoadingIndicator,
        removeLoadingIndicator,
        attachLoadingIndicatorToMessage,
        removeMessageStreamingIndicator,
        updateMessageStats,
        getMessageWrapperById,
        getLastMessageCard,
        getMessages,
        openLightbox,
        createStatsBar,
        createBranchSwitcher,
        switchToBranch,
        // 暴露状态供调试
        state
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkMessages = FrameworkMessages;
}