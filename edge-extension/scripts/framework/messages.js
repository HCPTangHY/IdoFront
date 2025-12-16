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
        img.src = images[currentIdx].dataUrl;
        img.alt = images[currentIdx].name || 'Image';

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
            img.src = images[currentIdx].dataUrl;
            img.alt = images[currentIdx].name || 'Image';

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

        if (typeof textOrObj === 'object' && textOrObj !== null) {
            text = textOrObj.content || '';
            reasoning = textOrObj.reasoning || null;
            attachments = textOrObj.attachments || null;
            reasoningDuration = textOrObj.reasoningDuration || null;
            modelName = textOrObj.modelName || null;
            channelName = textOrObj.channelName || null;
            stats = textOrObj.stats || null;
            if (textOrObj.id) id = textOrObj.id;
        }

        const targetContainer = options.targetContainer || ui.chatStream;

        const msg = { role, text, reasoning, id, attachments };
        state.messages.push(msg);

        const card = document.createElement('div');
        card.className = 'ido-message';
        card.dataset.messageId = id;
        card.dataset.role = role;

        // 角色标签
        const roleLabel = document.createElement('div');
        roleLabel.className = 'ido-message__role';
        if (role === 'user') {
            roleLabel.innerHTML = '<span class="material-symbols-outlined ido-message__role-icon">person</span>User';
        } else {
            let aiLabel = 'AI';
            if (modelName && channelName) {
                aiLabel = `<strong>${modelName} | ${channelName}</strong>`;
            }
            roleLabel.innerHTML = `<span class="material-symbols-outlined ido-message__role-icon">auto_awesome</span>${aiLabel}`;
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
        contentSpan.textContent = text || '';
        if (role !== 'user') {
            contentSpan.dataset.needsMarkdown = 'true';
        }
        contentDiv.appendChild(contentSpan);
        container.appendChild(contentDiv);

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

        // 操作栏
        if (plugins) {
            const actionPlugins = plugins.getDynamicPlugins(plugins.SLOTS.MESSAGE_FOOTER, msg);
            if (actionPlugins.length > 0) {
                const actions = document.createElement('div');
                actions.className = 'ido-message__actions';
                actionPlugins.forEach(p => {
                    if (p) actions.appendChild(p);
                });
                card.appendChild(actions);
            }
        }

        targetContainer.appendChild(card);
        
        if (targetContainer === ui.chatStream && !options.noScroll) {
            ui.chatStream.scrollTop = ui.chatStream.scrollHeight;
        }

        return msg.id;
    }

    /**
     * 创建思维链区块
     */
    function createReasoningBlock(reasoning, textOrObj, options) {
        const reasoningBlock = document.createElement('div');
        reasoningBlock.className = 'reasoning-block';

        const toggle = document.createElement('div');
        toggle.className = 'reasoning-toggle';

        let reasoningDuration = null;
        if (typeof textOrObj === 'object' && textOrObj !== null && textOrObj.reasoningDuration !== undefined) {
            reasoningDuration = textOrObj.reasoningDuration;
        }

        const text = typeof textOrObj === 'object' ? textOrObj.content : textOrObj;
        const isHistoricalMessage = (text && text.trim().length > 0) || options.isHistorical;

        if (reasoningDuration !== null && reasoningDuration !== undefined) {
            toggle.innerHTML = `<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="reasoning-timer">${typeof reasoningDuration === 'number' ? reasoningDuration.toFixed(1) : reasoningDuration}s</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>`;
        } else if (isHistoricalMessage) {
            toggle.innerHTML = '<span class="material-symbols-outlined text-[16px]">psychology</span><span>思维链</span><span class="material-symbols-outlined text-[16px] ml-auto transition-transform duration-200">expand_more</span>';
        } else {
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
        content.textContent = reasoning || '';
        content.dataset.needsMarkdown = 'true';

        reasoningBlock.appendChild(toggle);
        reasoningBlock.appendChild(content);

        return reasoningBlock;
    }

    /**
     * 创建附件容器
     */
    function createAttachmentsContainer(attachments) {
        const imageAttachments = attachments.filter(a => a && a.type && a.type.startsWith('image/'));

        if (imageAttachments.length === 0) return null;

        const attachmentsContainer = document.createElement('div');
        if (imageAttachments.length === 1) {
            attachmentsContainer.className = 'ido-message__attachments ido-message__attachments--single';
        } else {
            attachmentsContainer.className = 'ido-message__attachments ido-message__attachments--grid';
        }

        imageAttachments.forEach((attachment, index) => {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'ido-message__attachment-wrapper';
            imgWrapper.dataset.imageIndex = index;
            imgWrapper.dataset.imageTotal = imageAttachments.length;

            const img = document.createElement('img');
            img.src = attachment.dataUrl;
            img.alt = attachment.name || 'Attached image';
            img.loading = 'lazy';

            const overlay = document.createElement('div');
            overlay.className = 'ido-message__attachment-overlay';
            overlay.innerHTML = '<span class="material-symbols-outlined">zoom_in</span>';

            imgWrapper.appendChild(img);
            imgWrapper.appendChild(overlay);

            imgWrapper.onclick = () => {
                openLightbox(imageAttachments, index);
            };

            attachmentsContainer.appendChild(imgWrapper);
        });

        return attachmentsContainer;
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

    /**
     * 更新最后一条消息
     */
    function updateLastMessage(textOrObj) {
        if (state.messages.length === 0) return;

        let text = textOrObj;
        let reasoning = null;
        let attachments;
        let streaming = false;

        if (typeof textOrObj === 'object' && textOrObj !== null) {
            text = textOrObj.content || '';
            reasoning = textOrObj.reasoning || null;
            if (Object.prototype.hasOwnProperty.call(textOrObj, 'attachments')) {
                attachments = textOrObj.attachments;
            }
            streaming = !!textOrObj.streaming;
        }

        const lastMsg = state.messages[state.messages.length - 1];
        lastMsg.text = text;
        if (reasoning !== null) {
            lastMsg.reasoning = reasoning;
        }
        if (typeof attachments !== 'undefined') {
            lastMsg.attachments = attachments;
        }

        pendingUpdate = { text, reasoning, streaming };

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

        const { text, reasoning, streaming } = update;
        const lastMsg = state.messages[state.messages.length - 1];

        const lastCard = getLastMessageCard();
        if (!lastCard) return;

        const container = lastCard.querySelector('.ido-message__container');
        if (!container) return;

        let reasoningBlock = container.querySelector('.reasoning-block');
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

        // 停止思维链计时器
        if (text && reasoningBlock && reasoningBlock.dataset.timerId) {
            const timerId = parseInt(reasoningBlock.dataset.timerId);
            clearInterval(timerId);

            const toggle = reasoningBlock.querySelector('.reasoning-toggle');
            const timerSpan = toggle?.querySelector('.reasoning-timer');
            let finalDuration = 0;

            if (timerSpan && reasoningBlock.dataset.startTime) {
                finalDuration = (Date.now() - parseInt(reasoningBlock.dataset.startTime)) / 1000;
                timerSpan.textContent = finalDuration.toFixed(1) + 's';
            }

            if (finalDuration > 0 && events) {
                if (typeof events.emitAsync === 'function') {
                    events.emitAsync('reasoning:completed', {
                        messageId: lastMsg.id,
                        duration: finalDuration
                    });
                } else if (typeof events.emit === 'function') {
                    events.emit('reasoning:completed', {
                        messageId: lastMsg.id,
                        duration: finalDuration
                    });
                }
            }

            delete reasoningBlock.dataset.timerId;

            const reasoningContentDiv = reasoningBlock.querySelector('.reasoning-content');
            if (reasoningContentDiv && lastMsg.reasoning && markdown) {
                markdown.enqueueRender(reasoningContentDiv, lastMsg.reasoning);
            }
        }

        // 更新正文
        if (contentSpan && lastMsg.role !== 'user' && text && markdown) {
            markdown.renderSync(contentSpan, text);
            contentSpan.removeAttribute('data-needs-markdown');
        } else if (contentSpan) {
            contentSpan.textContent = text;
        }

        // 处理附件
        const currentAttachments = lastMsg.attachments;
        if (currentAttachments && currentAttachments.length > 0) {
            const existingWrapper = container.querySelector('.ido-message__attachment-wrapper');
            if (!existingWrapper) {
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
            const actions = card.querySelector('.ido-message__actions');
            if (actions) {
                card.insertBefore(statsBar, actions);
            } else {
                card.appendChild(statsBar);
            }
        } else {
            const newStatsBar = createStatsBar(stats);
            statsBar.innerHTML = newStatsBar.innerHTML;
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

        // 停止思维链计时器
        const reasoningBlock = container.querySelector('.reasoning-block');
        if (reasoningBlock && reasoningBlock.dataset.timerId) {
            const timerId = parseInt(reasoningBlock.dataset.timerId, 10);
            if (!Number.isNaN(timerId)) {
                clearInterval(timerId);
            }

            let finalDuration = 0;
            if (reasoningBlock.dataset.startTime) {
                const startTime = parseInt(reasoningBlock.dataset.startTime, 10);
                if (!Number.isNaN(startTime)) {
                    finalDuration = (Date.now() - startTime) / 1000;
                }
            }

            const toggle = reasoningBlock.querySelector('.reasoning-toggle');
            const timerSpan = toggle && toggle.querySelector('.reasoning-timer');
            if (timerSpan && finalDuration > 0) {
                timerSpan.textContent = finalDuration.toFixed(1) + 's';
            }

            delete reasoningBlock.dataset.timerId;
            delete reasoningBlock.dataset.startTime;

            if (finalDuration > 0 && lastMsgId && events) {
                if (typeof events.emitAsync === 'function') {
                    events.emitAsync('reasoning:completed', {
                        messageId: lastMsgId,
                        duration: finalDuration
                    });
                } else if (typeof events.emit === 'function') {
                    events.emit('reasoning:completed', {
                        messageId: lastMsgId,
                        duration: finalDuration
                    });
                }
            }
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
        finalizeStreamingMessage,
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
        // 暴露状态供调试
        state
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkMessages = FrameworkMessages;
}