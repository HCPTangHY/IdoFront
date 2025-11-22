/**
 * Persona Editor
 * 面具编辑器（新增/编辑面具）
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.personaEditor = window.IdoFront.personaEditor || {};

    const utils = window.IdoFront.utils;

    /**
     * 打开面具编辑器（使用右侧面板）
     * @param {Object|null} persona - 要编辑的面具对象，null 表示新增
     * @param {Object} context - Framework 实例
     * @param {Object} store - Store 实例
     */
    window.IdoFront.personaEditor.open = function(persona, context, store) {
        if (!context || !context.setCustomPanel) return;

        context.setCustomPanel('right', (container) => {
            renderEditor(container, context, store, persona);
        });
        
        // 显示右侧面板
        context.togglePanel('right', true);
    };

    /**
     * 渲染面具编辑器内容
     * @param {HTMLElement} container - 容器元素
     * @param {Object} context - Framework 实例
     * @param {Object} store - Store 实例
     * @param {Object|null} persona - 要编辑的面具对象，null 表示新增
     */
    function renderEditor(container, context, store, persona) {
        // 1. Header
        const header = document.createElement('div');
        header.className = "h-12 border-b border-gray-200 flex items-center justify-between px-3 bg-white flex-shrink-0";
        
        const titleGroup = document.createElement('div');
        titleGroup.className = "flex items-center gap-2";
        
        const title = document.createElement('span');
        title.className = "font-semibold text-gray-700";
        title.textContent = persona ? '编辑面具' : '新建面具';
        
        titleGroup.appendChild(title);
        
        const closeBtn = document.createElement('button');
        closeBtn.className = "p-1 hover:bg-gray-100 rounded text-gray-500";
        closeBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">close</span>';
        closeBtn.onclick = () => {
            context.setCustomPanel('right', null);
            context.togglePanel('right', false);
        };

        header.appendChild(titleGroup);
        header.appendChild(closeBtn);
        container.appendChild(header);

        // 2. Form Content
        const content = document.createElement('div');
        content.className = "flex-1 overflow-y-auto p-4 space-y-4 bg-white";

        // Helper for form fields
        const createField = (label, type, value, placeholder, hint = null) => {
            const wrapper = document.createElement('div');
            wrapper.className = "space-y-1";
            
            const labelEl = document.createElement('label');
            labelEl.className = "block text-xs font-medium text-gray-700";
            labelEl.textContent = label;
            
            let input;
            if (type === 'textarea') {
                input = document.createElement('textarea');
                input.rows = 3;
            } else {
                input = document.createElement('input');
                input.type = type;
            }
            
            input.className = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors";
            input.value = value || '';
            input.placeholder = placeholder || '';
            
            wrapper.appendChild(labelEl);
            
            if (hint) {
                const hintEl = document.createElement('div');
                hintEl.className = "text-[10px] text-gray-500 mb-1";
                hintEl.textContent = hint;
                wrapper.appendChild(hintEl);
            }
            
            wrapper.appendChild(input);
            return { wrapper, input };
        };

        // Name
        const nameField = createField('面具名称', 'text', persona?.name, '例如：编程助手');
        content.appendChild(nameField.wrapper);

        // Description
        const descField = createField('描述', 'textarea', persona?.description, '简要描述这个面具的用途');
        content.appendChild(descField.wrapper);

        // System Prompt
        const systemPromptField = createField(
            '系统提示词 (System Prompt)', 
            'textarea', 
            persona?.systemPrompt, 
            '你是一个专业的编程助手...',
            '定义助手的角色和行为方式'
        );
        systemPromptField.input.rows = 6;
        content.appendChild(systemPromptField.wrapper);

        // Temperature
        const tempWrapper = document.createElement('div');
        tempWrapper.className = "space-y-1";
        
        const tempLabel = document.createElement('label');
        tempLabel.className = "block text-xs font-medium text-gray-700";
        tempLabel.textContent = "Temperature (温度)";
        
        const tempHint = document.createElement('div');
        tempHint.className = "text-[10px] text-gray-500 mb-1";
        tempHint.textContent = "控制输出的随机性，0-2之间，值越高越随机";
        
        const tempInputGroup = document.createElement('div');
        tempInputGroup.className = "flex items-center gap-2";
        
        const tempRange = document.createElement('input');
        tempRange.type = "range";
        tempRange.min = "0";
        tempRange.max = "2";
        tempRange.step = "0.1";
        tempRange.value = persona?.temperature ?? 0.7;
        tempRange.className = "flex-1";
        
        const tempNumber = document.createElement('input');
        tempNumber.type = "number";
        tempNumber.min = "0";
        tempNumber.max = "2";
        tempNumber.step = "0.1";
        tempNumber.value = persona?.temperature ?? 0.7;
        tempNumber.className = "w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500";
        
        tempRange.oninput = (e) => {
            tempNumber.value = e.target.value;
        };
        tempNumber.oninput = (e) => {
            tempRange.value = e.target.value;
        };
        
        tempInputGroup.appendChild(tempRange);
        tempInputGroup.appendChild(tempNumber);
        
        tempWrapper.appendChild(tempLabel);
        tempWrapper.appendChild(tempHint);
        tempWrapper.appendChild(tempInputGroup);
        content.appendChild(tempWrapper);

        // Top P
        const topPWrapper = document.createElement('div');
        topPWrapper.className = "space-y-1";
        
        const topPLabel = document.createElement('label');
        topPLabel.className = "block text-xs font-medium text-gray-700";
        topPLabel.textContent = "Top P (核采样)";
        
        const topPHint = document.createElement('div');
        topPHint.className = "text-[10px] text-gray-500 mb-1";
        topPHint.textContent = "控制输出的多样性，0-1之间";
        
        const topPInputGroup = document.createElement('div');
        topPInputGroup.className = "flex items-center gap-2";
        
        const topPRange = document.createElement('input');
        topPRange.type = "range";
        topPRange.min = "0";
        topPRange.max = "1";
        topPRange.step = "0.05";
        topPRange.value = persona?.topP ?? 1.0;
        topPRange.className = "flex-1";
        
        const topPNumber = document.createElement('input');
        topPNumber.type = "number";
        topPNumber.min = "0";
        topPNumber.max = "1";
        topPNumber.step = "0.05";
        topPNumber.value = persona?.topP ?? 1.0;
        topPNumber.className = "w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500";
        
        topPRange.oninput = (e) => {
            topPNumber.value = e.target.value;
        };
        topPNumber.oninput = (e) => {
            topPRange.value = e.target.value;
        };
        
        topPInputGroup.appendChild(topPRange);
        topPInputGroup.appendChild(topPNumber);
        
        topPWrapper.appendChild(topPLabel);
        topPWrapper.appendChild(topPHint);
        topPWrapper.appendChild(topPInputGroup);
        content.appendChild(topPWrapper);

        // 参数覆写JSON输入框
        const paramsWrapper = document.createElement('div');
        paramsWrapper.className = "space-y-2 pt-2 border-t border-gray-100";
        
        const paramsLabel = document.createElement('label');
        paramsLabel.className = "block text-xs font-medium text-gray-700";
        paramsLabel.textContent = "参数覆写 (JSON)";
        
        const paramsHint = document.createElement('div');
        paramsHint.className = "text-[10px] text-gray-500 mb-1";
        paramsHint.textContent = "设置的参数会覆盖或新增到请求体中，例如: {\"max_tokens\": 2000, \"presence_penalty\": 0.5}";
        
        const paramsTextarea = document.createElement('textarea');
        paramsTextarea.className = "w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors";
        paramsTextarea.rows = 6;
        paramsTextarea.placeholder = '{\n  "max_tokens": 2000,\n  "presence_penalty": 0.5\n}';
        paramsTextarea.value = persona?.paramsOverride ? JSON.stringify(persona.paramsOverride, null, 2) : '';
        
        // 失去焦点时自动格式化JSON
        paramsTextarea.addEventListener('blur', () => {
            const value = paramsTextarea.value.trim();
            if (!value) return; // 空值不处理
            
            try {
                const parsed = JSON.parse(value);
                paramsTextarea.value = JSON.stringify(parsed, null, 2);
            } catch (e) {
                // JSON无效时不格式化，保留用户输入
            }
        });
        
        paramsWrapper.appendChild(paramsLabel);
        paramsWrapper.appendChild(paramsHint);
        paramsWrapper.appendChild(paramsTextarea);
        content.appendChild(paramsWrapper);

        // Stream Toggle
        const streamWrapper = document.createElement('div');
        streamWrapper.className = "flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg";
        
        const streamLabel = document.createElement('div');
        streamLabel.className = "flex flex-col";
        
        const streamTitle = document.createElement('span');
        streamTitle.className = "text-xs font-medium text-gray-700";
        streamTitle.textContent = "流式输出";
        
        const streamHint = document.createElement('span');
        streamHint.className = "text-[10px] text-gray-500";
        streamHint.textContent = "逐字显示回复内容";
        
        streamLabel.appendChild(streamTitle);
        streamLabel.appendChild(streamHint);
        
        const streamToggle = document.createElement('input');
        streamToggle.type = "checkbox";
        streamToggle.checked = persona?.stream !== false;
        streamToggle.className = "w-10 h-5 appearance-none bg-gray-300 rounded-full relative cursor-pointer transition-colors checked:bg-blue-600 before:content-[''] before:absolute before:w-4 before:h-4 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 before:transition-transform checked:before:translate-x-5";
        
        streamWrapper.appendChild(streamLabel);
        streamWrapper.appendChild(streamToggle);
        content.appendChild(streamWrapper);

        // Context Messages (Fake Dialogues)
        const contextWrapper = document.createElement('div');
        contextWrapper.className = "space-y-2 pt-2 border-t border-gray-100";
        
        const contextHeader = document.createElement('div');
        contextHeader.className = "flex justify-between items-center";
        
        const contextLabel = document.createElement('span');
        contextLabel.className = "text-xs font-medium text-gray-700";
        contextLabel.textContent = "预设对话";
        
        const contextHint = document.createElement('div');
        contextHint.className = "text-[10px] text-gray-500 mb-2";
        contextHint.textContent = "添加预设的对话示例，帮助模型理解期望的回复风格";
        
        const addContextBtn = context.ui.createIconButton({
            label: '添加',
            icon: 'add',
            className: "text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1",
            iconClassName: "material-symbols-outlined text-[14px]",
            onClick: () => {
                contextMessages.push({ role: 'user', content: '' });
                renderContextMessages();
            }
        });
        
        contextHeader.appendChild(contextLabel);
        contextHeader.appendChild(addContextBtn);
        
        let contextMessages = persona?.contextMessages ? [...persona.contextMessages] : [];
        
        const contextList = document.createElement('div');
        contextList.className = "space-y-2";
        
        const renderContextMessages = () => {
            contextList.innerHTML = '';
            
            if (contextMessages.length === 0) {
                const emptyHint = document.createElement('div');
                emptyHint.className = "p-4 text-xs text-gray-400 text-center border border-gray-200 rounded-lg";
                emptyHint.textContent = "暂无预设对话";
                contextList.appendChild(emptyHint);
            } else {
                contextMessages.forEach((msg, index) => {
                    const msgItem = document.createElement('div');
                    msgItem.className = "border border-gray-200 rounded-lg p-3 space-y-2";
                    
                    const msgHeader = document.createElement('div');
                    msgHeader.className = "flex justify-between items-center";
                    
                    const roleSelect = document.createElement('select');
                    roleSelect.className = "px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-500";
                    roleSelect.innerHTML = `
                        <option value="user" ${msg.role === 'user' ? 'selected' : ''}>用户</option>
                        <option value="assistant" ${msg.role === 'assistant' ? 'selected' : ''}>助手</option>
                    `;
                    roleSelect.onchange = (e) => {
                        contextMessages[index].role = e.target.value;
                    };
                    
                    const deleteBtn = context.ui.createIconButton({
                        icon: 'delete',
                        title: '删除',
                        className: "p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-colors",
                        iconClassName: "material-symbols-outlined text-[16px]",
                        onClick: () => {
                            contextMessages.splice(index, 1);
                            renderContextMessages();
                        }
                    });
                    
                    msgHeader.appendChild(roleSelect);
                    msgHeader.appendChild(deleteBtn);
                    
                    const contentTextarea = document.createElement('textarea');
                    contentTextarea.className = "w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-500";
                    contentTextarea.rows = 2;
                    contentTextarea.placeholder = msg.role === 'user' ? '用户说的话...' : '助手的回复...';
                    contentTextarea.value = msg.content || '';
                    contentTextarea.oninput = (e) => {
                        contextMessages[index].content = e.target.value;
                    };
                    
                    msgItem.appendChild(msgHeader);
                    msgItem.appendChild(contentTextarea);
                    contextList.appendChild(msgItem);
                });
            }
        };
        
        contextWrapper.appendChild(contextHeader);
        contextWrapper.appendChild(contextHint);
        contextWrapper.appendChild(contextList);
        content.appendChild(contextWrapper);
        
        renderContextMessages();

        container.appendChild(content);

        // 3. Footer Actions
        const footer = document.createElement('div');
        footer.className = "p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2 flex-shrink-0";
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = "px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors";
        cancelBtn.textContent = "取消";
        cancelBtn.onclick = () => {
            context.setCustomPanel('right', null);
            context.togglePanel('right', false);
        };
        
        const saveBtn = document.createElement('button');
        saveBtn.className = "px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm transition-colors font-medium";
        saveBtn.textContent = "保存";
        saveBtn.onclick = () => {
                const name = nameField.input.value.trim();
                if (!name) {
                    alert('请输入面具名称');
                    return;
                }
                
                // 解析参数覆写JSON
                let paramsOverride = null;
                if (paramsTextarea.value.trim()) {
                    try {
                        paramsOverride = JSON.parse(paramsTextarea.value);
                    } catch (e) {
                        alert('参数覆写JSON格式错误，请检查后重试');
                        return;
                    }
                }
                
                const newPersona = {
                    id: persona?.id || utils.createId('persona'),
                    name: name,
                    description: descField.input.value.trim(),
                    systemPrompt: systemPromptField.input.value.trim(),
                    temperature: parseFloat(tempNumber.value),
                    topP: parseFloat(topPNumber.value),
                    stream: streamToggle.checked,
                    contextMessages: contextMessages.filter(m => m.content.trim()),
                    paramsOverride: paramsOverride,
                    isDefault: persona?.isDefault || false
                };
                
                store.savePersona(newPersona);
                
                // 关闭编辑面板
                context.setCustomPanel('right', null);
                context.togglePanel('right', false);
                
                // 触发面具列表刷新事件
                if (store.events) {
                    store.events.emit('personas:updated');
                }
            };
        
        footer.appendChild(cancelBtn);
        footer.appendChild(saveBtn);
        container.appendChild(footer);
    }

})();