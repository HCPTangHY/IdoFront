/**
 * Tool Call Renderer - 工具调用 UI 渲染
 * 在聊天流中展示工具调用状态和结果
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    
    const Status = {
        PENDING: 'pending',
        RUNNING: 'running',
        SUCCESS: 'success',
        ERROR: 'error'
    };
    
    /**
     * 状态配置
     */
    const STATUS_CONFIG = {
        [Status.PENDING]: {
            icon: 'schedule',
            color: 'text-gray-500',
            bgColor: 'bg-gray-100',
            borderColor: 'border-gray-200',
            label: '等待执行'
        },
        [Status.RUNNING]: {
            icon: 'sync',
            color: 'text-blue-500',
            bgColor: 'bg-blue-50',
            borderColor: 'border-blue-200',
            label: '执行中',
            spin: true
        },
        [Status.SUCCESS]: {
            icon: 'check_circle',
            color: 'text-green-500',
            bgColor: 'bg-green-50',
            borderColor: 'border-green-200',
            label: '成功'
        },
        [Status.ERROR]: {
            icon: 'error',
            color: 'text-red-500',
            bgColor: 'bg-red-50',
            borderColor: 'border-red-200',
            label: '失败'
        }
    };
    
    /**
     * 渲染工具调用区块
     * @param {Array} toolCalls - 工具调用列表
     * @param {Object} options - 渲染选项
     * @returns {HTMLElement}
     */
    function renderToolCalls(toolCalls, options = {}) {
        if (!toolCalls || toolCalls.length === 0) return null;
        
        const container = document.createElement('div');
        container.className = 'tool-calls-container my-3 space-y-2';
        container.dataset.toolCallsCount = toolCalls.length;
        
        // 标题
        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 text-xs text-gray-500 mb-2';
        header.innerHTML = `
            <span class="material-symbols-outlined text-[14px]">build</span>
            <span>工具调用 (${toolCalls.length})</span>
        `;
        container.appendChild(header);
        
        // 渲染每个工具调用
        toolCalls.forEach((tc, index) => {
            const tcElement = renderSingleToolCall(tc, index, options);
            container.appendChild(tcElement);
        });
        
        return container;
    }
    
    /**
     * 渲染单个工具调用
     */
    function renderSingleToolCall(toolCall, index, options = {}) {
        const status = toolCall.status || Status.PENDING;
        const config = STATUS_CONFIG[status] || STATUS_CONFIG[Status.PENDING];
        
        const wrapper = document.createElement('div');
        wrapper.className = `tool-call-item rounded-xl border ${config.borderColor} ${config.bgColor} overflow-hidden transition-all duration-300`;
        wrapper.dataset.toolCallId = toolCall.id;
        wrapper.dataset.toolCallStatus = status;
        
        // 头部（总是显示）
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-black/5 transition-colors';
        header.onclick = () => toggleExpand(wrapper);
        
        const headerLeft = document.createElement('div');
        headerLeft.className = 'flex items-center gap-3 flex-1 min-w-0';
        
        // 状态图标
        const iconWrapper = document.createElement('div');
        iconWrapper.className = `w-8 h-8 rounded-lg flex items-center justify-center ${config.bgColor}`;
        iconWrapper.setAttribute('data-tc-icon-wrapper', '1');
        iconWrapper.innerHTML = `
            <span data-tc-icon class="material-symbols-outlined text-[18px] ${config.color} ${config.spin ? 'animate-spin' : ''}">
                ${config.icon}
            </span>
        `;
        
        // 工具信息
        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0';
        
        const nameRow = document.createElement('div');
        nameRow.className = 'flex items-center gap-2';
        nameRow.innerHTML = `
            <span class="font-mono text-sm font-medium text-gray-800 truncate">${escapeHtml(toolCall.displayName || toolCall.name)}</span>
            <span data-tc-status class="text-xs ${config.color} font-medium">${config.label}</span>
        `;
        
        info.appendChild(nameRow);
        
        // 耗时（如果有）
        if (toolCall.duration !== null && toolCall.duration !== undefined) {
            const durationEl = document.createElement('div');
            durationEl.className = 'text-xs text-gray-400 mt-0.5';
            durationEl.setAttribute('data-tc-duration', '1');
            durationEl.textContent = `耗时 ${toolCall.duration.toFixed(2)}s`;
            info.appendChild(durationEl);
        }
        
        headerLeft.appendChild(iconWrapper);
        headerLeft.appendChild(info);
        
        // 展开/收起按钮
        const expandBtn = document.createElement('span');
        expandBtn.className = 'material-symbols-outlined text-[20px] text-gray-400 transition-transform expand-icon';
        expandBtn.textContent = 'expand_more';
        
        header.appendChild(headerLeft);
        header.appendChild(expandBtn);
        wrapper.appendChild(header);
        
        // 详情区域（默认收起）
        const details = document.createElement('div');
        details.className = 'tool-call-details hidden border-t border-gray-200/50';
        
        // 参数
        if (toolCall.args && Object.keys(toolCall.args).length > 0) {
            const argsSection = createSection('输入参数', 'input', toolCall.args);
            details.appendChild(argsSection);
        }
        
        // 结果
        if (status === Status.SUCCESS && toolCall.result !== null) {
            const resultSection = createSection('执行结果', 'output', toolCall.result, 'text-green-600');
            details.appendChild(resultSection);
        }
        
        // 错误
        if (status === Status.ERROR && toolCall.error) {
            const errorSection = createSection('错误信息', 'error', toolCall.error, 'text-red-600');
            details.appendChild(errorSection);
        }
        
        wrapper.appendChild(details);
        
        return wrapper;
    }
    
    /**
     * 创建详情区块
     */
    function createSection(title, icon, content, titleColor = 'text-gray-600') {
        const section = document.createElement('div');
        section.className = 'px-4 py-3 border-b border-gray-200/50 last:border-b-0';
        
        const sectionHeader = document.createElement('div');
        sectionHeader.className = `flex items-center gap-1.5 text-xs font-medium ${titleColor} mb-2`;
        sectionHeader.innerHTML = `
            <span class="material-symbols-outlined text-[14px]">${icon}</span>
            <span>${title}</span>
        `;
        section.appendChild(sectionHeader);
        
        const contentEl = document.createElement('div');
        contentEl.className = 'text-xs font-mono bg-white/50 rounded-lg p-3 max-h-48 overflow-auto';
        
        if (typeof content === 'string') {
            contentEl.textContent = content;
        } else {
            try {
                contentEl.textContent = JSON.stringify(content, null, 2);
            } catch (e) {
                contentEl.textContent = String(content);
            }
        }
        
        section.appendChild(contentEl);
        return section;
    }
    
    /**
     * 切换展开/收起
     */
    function toggleExpand(wrapper) {
        const details = wrapper.querySelector('.tool-call-details');
        const expandIcon = wrapper.querySelector('.expand-icon');
        
        if (details.classList.contains('hidden')) {
            details.classList.remove('hidden');
            expandIcon.style.transform = 'rotate(180deg)';
        } else {
            details.classList.add('hidden');
            expandIcon.style.transform = 'rotate(0deg)';
        }
    }
    
    /**
     * 更新工具调用状态（实时更新 UI）
     * @param {string} messageId - 消息 ID
     * @param {string} toolCallId - 工具调用 ID
     * @param {Object} updates - 更新内容 { status, result, error, duration }
     */
    function updateToolCallUI(messageId, toolCallId, updates) {
        const msgCard = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!msgCard) return;
        
        const tcItem = msgCard.querySelector(`[data-tool-call-id="${toolCallId}"]`);
        if (!tcItem) return;
        
        const status = updates.status || tcItem.dataset.toolCallStatus;
        const config = STATUS_CONFIG[status] || STATUS_CONFIG[Status.PENDING];
        
        // 更新状态
        tcItem.dataset.toolCallStatus = status;
        
        // 更新样式
        tcItem.className = `tool-call-item rounded-xl border ${config.borderColor} ${config.bgColor} overflow-hidden transition-all duration-300`;
        
        // 更新图标
        const iconEl = tcItem.querySelector('[data-tc-icon]');
        if (iconEl) {
            iconEl.textContent = config.icon;
            iconEl.className = `material-symbols-outlined text-[18px] ${config.color} ${config.spin ? 'animate-spin' : ''}`;
        }
        
        const iconWrapper = tcItem.querySelector('[data-tc-icon-wrapper]');
        if (iconWrapper) {
            iconWrapper.className = `w-8 h-8 rounded-lg flex items-center justify-center ${config.bgColor}`;
        }
        
        // 更新状态文本
        const statusText = tcItem.querySelector('[data-tc-status]');
        if (statusText) {
            statusText.textContent = config.label;
            statusText.className = `text-xs ${config.color} font-medium`;
        }
        
        // 更新耗时
        if (updates.duration !== undefined) {
            let durationEl = tcItem.querySelector('[data-tc-duration]');
            if (!durationEl) {
                const info = tcItem.querySelector('.flex-1.min-w-0');
                if (info) {
                    durationEl = document.createElement('div');
                    durationEl.className = 'text-xs text-gray-400 mt-0.5';
                    durationEl.setAttribute('data-tc-duration', '1');
                    info.appendChild(durationEl);
                }
            }
            if (durationEl) {
                durationEl.textContent = `耗时 ${updates.duration.toFixed(2)}s`;
            }
        }
        
        // 更新详情区域
        const details = tcItem.querySelector('.tool-call-details');
        if (details) {
            // 添加结果
            if (status === Status.SUCCESS && updates.result !== undefined) {
                const oldError = details.querySelector('[data-section="error"]');
                if (oldError) oldError.remove();

                const oldResult = details.querySelector('[data-section="result"]');
                if (oldResult) oldResult.remove();
                
                const resultSection = createSection('执行结果', 'output', updates.result, 'text-green-600');
                resultSection.dataset.section = 'result';
                details.appendChild(resultSection);
            }
            
            // 添加错误
            if (status === Status.ERROR && updates.error) {
                const oldResult = details.querySelector('[data-section="result"]');
                if (oldResult) oldResult.remove();

                const oldError = details.querySelector('[data-section="error"]');
                if (oldError) oldError.remove();
                
                const errorSection = createSection('错误信息', 'error', updates.error, 'text-red-600');
                errorSection.dataset.section = 'error';
                details.appendChild(errorSection);
            }
        }
    }
    
    /**
     * HTML 转义
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 暴露 API
    window.IdoFront.toolCallRenderer = {
        render: renderToolCalls,
        renderSingle: renderSingleToolCall,
        updateUI: updateToolCallUI,
        STATUS: Status
    };
    
})();
