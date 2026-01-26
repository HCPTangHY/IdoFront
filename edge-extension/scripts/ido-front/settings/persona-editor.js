/**
 * Persona Editor
 * 面具编辑器（新增/编辑面具）
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.personaEditor = window.IdoFront.personaEditor || {};

    const utils = window.IdoFront.utils;

    /**
     * 打开面具编辑器（自动判断：极简右侧面板或高级模态框）
     * @param {Object|null} persona - 要编辑的面具对象，null 表示新增
     * @param {Object} context - Framework 实例
     * @param {Object} store - Store 实例
     */
    window.IdoFront.personaEditor.open = function(persona, context, store) {
        if (!context || !context.ui) return;

        // 自动判断使用哪种模式
        if (isSimpleConfig(persona)) {
            renderSimpleEditor(context, store, persona);
        } else {
            openAdvancedModal(persona, context, store);
        }
    };

    /**
     * 判断一个面具预设是否为"极简"配置
     * 极简标准：无 user/assistant 块，最多 1 个 system 块，无禁用的块
     */
    function isSimpleConfig(persona) {
        if (!persona) return true; // 新增面具默认为简单模式

        // 如果存在旧版上下文消息，视为复杂模式
        if (persona.contextMessages && persona.contextMessages.length > 0) return false;

        // 如果没有高级流配置，视为简单模式
        if (!persona.streamConfig || persona.streamConfig.length === 0) return true;

        // 检查流配置
        const config = persona.streamConfig;
        
        const systemCount = config.filter(m => m.type === 'system').length;
        const userCount = config.filter(m => m.type === 'user').length;
        const assistantCount = config.filter(m => m.type === 'assistant').length;
        const disabledCount = config.filter(m => m.enabled === false).length;

        // 只要有 User/Assistant 块，或者多于 1 个 System 块，或者存在禁用的块，就认为是复杂模式
        if (userCount > 0 || assistantCount > 0 || systemCount > 1 || disabledCount > 0) {
            return false;
        }

        return true;
    }

    /**
     * 渲染极简模式编辑器 (右侧面板)
     */
    function renderSimpleEditor(context, store, persona) {
        context.setCustomPanel('right', (container) => {
            // 1. Header
            const header = document.createElement('div');
            header.className = "h-12 border-b border-gray-200 flex items-center justify-between px-3 bg-white flex-shrink-0";
            
            const titleGroup = document.createElement('div');
            titleGroup.className = "flex items-center gap-2";
            
            const title = document.createElement('span');
            title.className = "font-semibold text-gray-700";
            title.textContent = persona ? '面具设置' : '新建面具';
            
            titleGroup.appendChild(title);
            
            const headerActions = document.createElement('div');
            headerActions.className = "flex items-center gap-1";

            const advancedBtn = window.IdoUI.createIconButton({
                label: '高级设置',
                icon: 'tune',
                variant: 'secondary',
                size: 'sm',
                onClick: () => {
                    context.setCustomPanel('right', null);
                    context.togglePanel('right', false);
                    openAdvancedModal(persona, context, store);
                }
            });

            const closeBtn = window.IdoUI.createIconButton({
                icon: 'close',
                title: '关闭',
                onClick: () => {
                    context.setCustomPanel('right', null);
                    context.togglePanel('right', false);
                }
            });

            headerActions.appendChild(advancedBtn);
            headerActions.appendChild(closeBtn);
            header.appendChild(titleGroup);
            header.appendChild(headerActions);
            container.appendChild(header);

            // 2. Content
            const content = document.createElement('div');
            content.className = "flex-1 overflow-y-auto p-4 space-y-4 bg-white";

            const nameInput = createInput('名称', 'text', persona?.name, '输入面具名称...');
            content.appendChild(nameInput.wrapper);

            const systemPromptWrapper = document.createElement('div');
            systemPromptWrapper.className = "space-y-1.5 flex-1 flex flex-col h-[calc(100vh-280px)]";
            
            const spLabel = document.createElement('label');
            spLabel.className = "ido-form-label";
            spLabel.textContent = "系统提示词 (System Prompt)";
            
            const spInput = document.createElement('textarea');
            spInput.className = "ido-form-textarea flex-1 min-h-0";
            spInput.style.resize = 'none';
            spInput.value = persona?.systemPrompt || '';
            spInput.placeholder = "定义助手的核心设定...";
            
            systemPromptWrapper.appendChild(spLabel);
            systemPromptWrapper.appendChild(spInput);
            content.appendChild(systemPromptWrapper);

            container.appendChild(content);

            // 3. Footer
            const footer = document.createElement('div');
            footer.className = "p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2 flex-shrink-0";
            
            const cancelBtn = document.createElement('button');
            cancelBtn.className = "ido-btn ido-btn--secondary ido-btn--md";
            cancelBtn.textContent = "取消";
            cancelBtn.onclick = () => {
                context.setCustomPanel('right', null);
                context.togglePanel('right', false);
            };
            
            const saveBtn = document.createElement('button');
            saveBtn.className = "ido-btn ido-btn--primary ido-btn--md";
            saveBtn.textContent = "保存";
            saveBtn.onclick = () => {
                const name = nameInput.input.value.trim();
                if (!name) {
                    alert('请输入面具名称');
                    return;
                }

                // 在极简模式下保存时，保留其他高级字段的原始值
                const newPersona = {
                    ...(persona || {}),
                    id: persona?.id || utils.createId('persona'),
                    name: name,
                    systemPrompt: spInput.value.trim(),
                    // 如果是新建，给一些默认值
                    temperature: persona?.temperature ?? 0.7,
                    topP: persona?.topP ?? 1.0,
                    stream: persona?.stream ?? true,
                    contextMessages: persona?.contextMessages || [],
                    isDefault: persona?.isDefault || false
                };
                
                // 注意：极简模式下修改了 systemPrompt，为了保证数据一致性，
                // 如果用户之前用高级模式编辑过 streamConfig，我们需要更新或重置它。
                // 这里我们选择简单处理：如果只是修改了 systemPrompt，我们同步更新 streamConfig 中的第一个 system 块（如果存在）
                if (newPersona.streamConfig && newPersona.streamConfig.length > 0) {
                    const sysIndex = newPersona.streamConfig.findIndex(m => m.type === 'system');
                    if (sysIndex !== -1) {
                        newPersona.streamConfig[sysIndex].content = newPersona.systemPrompt;
                    } else {
                        newPersona.streamConfig.unshift({type: 'system', content: newPersona.systemPrompt, enabled: true});
                    }
                }

                store.savePersona(newPersona);
                context.setCustomPanel('right', null);
                context.togglePanel('right', false);
                
                if (store.events) {
                    store.events.emit('personas:updated');
                }
            };
            
            footer.appendChild(cancelBtn);
            footer.appendChild(saveBtn);
            container.appendChild(footer);
        });
        
        context.togglePanel('right', true);
    }

    /**
     * 打开高级模式编辑器
     */
    function openAdvancedModal(persona, context, store) {
        const show = context?.showBottomSheet || globalThis.FrameworkLayout?.showBottomSheet;
        const hide = context?.hideBottomSheet || globalThis.FrameworkLayout?.hideBottomSheet;
        if (typeof show !== 'function' || typeof hide !== 'function') return;

        show((sheetContent) => {
            const closeModal = () => hide();

            // 不直接覆盖 bottom-sheet-content 的 class，避免丢失圆角/阴影；在内部包一层
            const wrapper = document.createElement('div');
            wrapper.className = 'w-full h-full flex justify-center';

            const root = document.createElement('div');
            root.className = 'w-full max-w-[900px] h-full flex flex-col bg-gray-50 overflow-hidden';

            wrapper.appendChild(root);
            sheetContent.appendChild(wrapper);

            renderAdvancedEditor(root, context, store, persona, closeModal);
        });
    }

    /**
     * 渲染面具编辑器内容
     */
    function renderAdvancedEditor(container, context, store, persona, closeModal) {
        // 1. Header
        const header = document.createElement('div');
        header.className = "h-14 border-b border-gray-200 flex items-center justify-between px-4 bg-white flex-shrink-0";
        
        const titleGroup = document.createElement('div');
        titleGroup.className = "flex items-center gap-2";
        
        const title = document.createElement('span');
        title.className = "font-bold text-lg text-gray-800";
        title.textContent = persona ? '高级编辑：' + persona.name : '新建面具预设 (高级)';
        
        titleGroup.appendChild(title);
        
        // 导入预设按钮
        const importBtn = window.IdoUI.createIconButton({
            label: '导入酒馆预设',
            icon: 'file_upload',
            variant: 'secondary',
            size: 'sm'
        });
        
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.className = "hidden";
        importBtn.appendChild(fileInput);

        // 导入逻辑处理
        importBtn.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    applyTavernPreset(data);
                } catch (err) {
                    alert('导入失败：不是有效的 JSON 文件');
                    console.error(err);
                }
            };
            reader.readAsText(file);
            // 重置 input，允许重复选择同一文件
            fileInput.value = '';
        };

        titleGroup.appendChild(importBtn);

        const closeBtn = window.IdoUI.createIconButton({
            icon: 'close',
            variant: 'ghost',
            className: "text-gray-500",
            onClick: closeModal
        });

        header.appendChild(titleGroup);
        header.appendChild(closeBtn);
        container.appendChild(header);

        // 2. Content Container (两栏布局)
        // 断点对齐 FrameworkLayout.MOBILE_BREAKPOINT(768)：<=767 视为移动端
        const mainContent = document.createElement('div');
        mainContent.className = "flex-1 overflow-hidden flex flex-col md:flex-row bg-gray-50";

        // 基础设置栏：移动端纵向紧凑 + 限高可滚动，避免挤占 Prompt Stream
        const baseSettings = document.createElement('div');
        baseSettings.className = "w-full md:w-[280px] bg-white border-b md:border-b-0 md:border-r border-gray-200 overflow-y-auto flex-shrink-0 p-3 md:p-4 flex flex-col gap-3 md:gap-4 max-h-[34vh] md:max-h-none min-h-0";

        // 名称和描述
        const nameInput = createInput('面具名称', 'text', persona?.name, '例如：编程助手');
        baseSettings.appendChild(nameInput.wrapper);

        const descInput = createTextarea('描述', persona?.description, '简要描述这个面具的用途', 3);
        baseSettings.appendChild(descInput.wrapper);

        // 模型参数
        const paramsSection = document.createElement('div');
        paramsSection.className = "pt-4 border-t border-gray-100 space-y-4";
        
        const paramsTitle = document.createElement('h3');
        paramsTitle.className = "text-sm font-semibold text-gray-700";
        paramsTitle.textContent = "模型参数";
        paramsSection.appendChild(paramsTitle);

        const tempInput = createRangeInput('Temperature', persona?.temperature ?? 0.7, 0, 2, 0.1);
        paramsSection.appendChild(tempInput.wrapper);

        const topPInput = createRangeInput('Top P', persona?.topP ?? 1.0, 0, 1, 0.05);
        paramsSection.appendChild(topPInput.wrapper);

        const streamToggle = createToggle('流式输出', persona?.stream !== false);
        paramsSection.appendChild(streamToggle.wrapper);

        baseSettings.appendChild(paramsSection);

        // 提示词流编辑栏 (右侧)
        const promptStream = document.createElement('div');
        promptStream.className = "flex-1 flex flex-col overflow-hidden min-h-0";

        const streamHeader = document.createElement('div');
        streamHeader.className = "px-3 md:px-4 py-2 bg-white border-b border-gray-200 flex flex-col md:flex-row md:justify-between md:items-center gap-2";
        streamHeader.innerHTML = `
            <span class="text-sm font-medium text-gray-700">预设提示词流 (Prompt Stream)</span>
            <div class="flex items-center gap-2 flex-wrap justify-end" data-stream-header-actions="1">
                <span class="text-xs text-gray-500 flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">info</span> 自定义消息插入顺序</span>
            </div>
        `;

        // 布局：允许收起左侧参数区，给 Prompt Stream 更多宽度
        const headerActions = streamHeader.querySelector('[data-stream-header-actions="1"]');
        let settingsCollapsed = false;
        const toggleSettingsBtn = window.IdoUI?.createIconButton?.({
            icon: 'left_panel_close',
            title: '收起参数区'
        });
        if (toggleSettingsBtn && headerActions) {
            const updateToggleIcon = () => {
                const iconEl = toggleSettingsBtn.querySelector('.material-symbols-outlined');
                if (iconEl) {
                    iconEl.textContent = settingsCollapsed ? 'left_panel_open' : 'left_panel_close';
                }
                toggleSettingsBtn.title = settingsCollapsed ? '展开参数区' : '收起参数区';
            };
            updateToggleIcon();
            toggleSettingsBtn.onclick = () => {
                settingsCollapsed = !settingsCollapsed;
                baseSettings.style.display = settingsCollapsed ? 'none' : '';
                updateToggleIcon();
            };
            headerActions.prepend(toggleSettingsBtn);
        }

        const streamList = document.createElement('div');
        streamList.className = "flex-1 min-h-0 overflow-y-auto p-3 md:p-4 space-y-4";

        // 提升作用域，以便在导入预设时可以修改
        let messages = [];
        let renderStream;
        
        // 初始化消息列表
        // 1. 系统提示词
        if (persona?.systemPrompt) {
            messages.push({ type: 'system', content: persona.systemPrompt });
        } else {
            messages.push({ type: 'system', content: '' }); // 默认给一个空的system
        }

        // 2. 上下文消息
        if (persona?.contextMessages) {
            persona.contextMessages.forEach(msg => {
                messages.push({ type: msg.role, content: msg.content }); // role: 'user' or 'assistant'
            });
        }

        // 3. 聊天历史占位符 (如果不存在，默认放在最后)
        const hasHistory = messages.some(m => m.type === 'history');
        if (!hasHistory) {
            messages.push({ type: 'history' });
        }

        // 渲染消息流
        renderStream = () => {
            streamList.innerHTML= '';
            messages.forEach((msg, index) => {
                const item = createStreamItem(msg, index, () => {
                    // 删除
                    messages.splice(index, 1);
                    renderStream();
                }, (newType, newContent, newName) => {
                    // 更新
                    const oldType = messages[index].type;
                    messages[index].type = newType;
                    messages[index].content = newContent;
                    messages[index].name = newName;
                    
                    // 如果角色类型变了，需要重新渲染以更新图标和样式
                    if (oldType !== newType) {
                        renderStream();
                    }
                }, (dir) => {
                    // 移动
                    if (dir === 'up' && index > 0) {
                        [messages[index-1], messages[index]] = [messages[index], messages[index-1]];
                        renderStream();
                    } else if (dir === 'down' && index < messages.length - 1) {
                        [messages[index], messages[index+1]] = [messages[index+1], messages[index]];
                        renderStream();
                    }
                }, (enabled) => {
                    // 切换 enabled
                    messages[index].enabled = enabled;
                    renderStream();
                });
                streamList.appendChild(item);
            });
        };

        renderStream();

        // 底部工具栏
        const streamToolbar = document.createElement('div');
        streamToolbar.className = "p-3 bg-white border-t border-gray-200 flex flex-wrap gap-2 justify-start md:justify-center";

        const addTypes = [
            { label: '系统 (System)', type: 'system', icon: 'settings' },
            { label: '用户 (User)', type: 'user', icon: 'person' },
            { label: '助手 (Assistant)', type: 'assistant', icon: 'smart_toy' },
            { label: '历史记录', type: 'history', icon: 'history' }
        ];

        addTypes.forEach(type => {
            const btn = window.IdoUI?.createIconButton
                ? window.IdoUI.createIconButton({
                    label: type.label,
                    icon: type.icon,
                    variant: 'secondary',
                    size: 'sm'
                })
                : document.createElement('button');

            if (!btn.classList.contains('ido-btn')) {
                btn.className = "ido-btn ido-btn--secondary ido-btn--sm";
                btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">${type.icon}</span><span>${type.label}</span>`;
            }

            btn.onclick = () => {
                if (type.type === 'history' && messages.some(m => m.type === 'history')) {
                    alert('历史记录占位符已存在，只能有一个。');
                    return;
                }
                messages.push({ type: type.type, content: '' });
                renderStream();
                streamList.scrollTop = streamList.scrollHeight;
            };
            streamToolbar.appendChild(btn);
        });

        promptStream.appendChild(streamHeader);
        promptStream.appendChild(streamList);
        promptStream.appendChild(streamToolbar);

        mainContent.appendChild(baseSettings);
        mainContent.appendChild(promptStream);
        container.appendChild(mainContent);

        // 3. Footer Actions
        const footer = document.createElement('div');
        footer.className = "p-4 bg-white border-t border-gray-200 flex justify-end gap-3 flex-shrink-0";
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = "ido-btn ido-btn--secondary ido-btn--md";
        cancelBtn.textContent = "取消";
        cancelBtn.onclick = closeModal;
        
        const saveBtn = document.createElement('button');
        saveBtn.className = "ido-btn ido-btn--primary ido-btn--md";
        saveBtn.textContent = "保存预设";
        saveBtn.onclick = () => {
            const name = nameInput.input.value.trim();
            if (!name) {
                alert('请输入面具名称');
                return;
            }

            // 解析提示词流
            let systemPrompt = '';
            let contextMessages = [];
            
            // 需要记录 history 的位置，以及前后的消息
            // 为了兼容之前的存储结构，我们这里做一些转换
            // 注意：只有 enabled 的块才会最终生效
            systemPrompt = messages.filter(m => m.type === 'system' && m.enabled !== false).map(m => m.content).join('\n\n');

            contextMessages = messages
                .filter(m => (m.type === 'user' || m.type === 'assistant') && m.enabled !== false)
                .map(m => ({ role: m.type, content: m.content }));

            const newPersona = {
                id: persona?.id || utils.createId('persona'),
                name: name,
                description: descInput.input.value.trim(),
                systemPrompt: systemPrompt,
                temperature: parseFloat(tempInput.number.value),
                topP: parseFloat(topPInput.number.value),
                stream: streamToggle.checkbox.checked,
                contextMessages: contextMessages.filter(m => m.content.trim()),
                isDefault: persona?.isDefault || false,
                // 新增 streamConfig 保存完整流配置，供下次编辑使用
                streamConfig: messages
            };
            
            store.savePersona(newPersona);
            closeModal();
            
            if (store.events) {
                store.events.emit('personas:updated');
            }
        };

        // 如果 persona 有 streamConfig，则使用它初始化 messages
        if (persona?.streamConfig) {
            messages = [...persona.streamConfig];
            renderStream();
        }
        
        function applyTavernPreset(data) {
            // 1. 设置基础参数
            if (typeof data.temperature === 'number') {
                tempInput.range.value = data.temperature;
                tempInput.number.value = data.temperature;
            }
            if (typeof data.top_p === 'number') {
                topPInput.range.value = data.top_p;
                topPInput.number.value = data.top_p;
            }
            if (typeof data.stream_openai === 'boolean') {
                streamToggle.checkbox.checked = data.stream_openai;
            }

            // 2. 解析提示词流
            // Tavern 的预设结构中，prompts 存放所有块，prompt_order 存放启用状态和顺序
            const promptMap = {};
            (data.prompts || []).forEach(p => {
                promptMap[p.identifier] = p;
            });

            // 获取排序配置：酒馆预设可能有多个 order (针对不同角色)，我们取长度最长的那个 (通常是主配置)
            const promptOrderList = data.prompt_order || [];
            let orderConfig = [];
            promptOrderList.forEach(po => {
                if (po.order && po.order.length > orderConfig.length) {
                    orderConfig = po.order;
                }
            });
            
            const importedMessages = [];
            let hasHistory = false;

            orderConfig.forEach(item => {
                const prompt = promptMap[item.identifier];
                if (!prompt) return;

                // 确定启用状态：优先看 order 里的配置，其次看 prompt 自身的默认配置，都没有则默认 true
                const isEnabled = item.enabled ?? prompt.enabled ?? true;

                // 1. 判断是否是历史记录标记
                if (prompt.identifier === 'chatHistory') {
                    importedMessages.push({ type: 'history', enabled: isEnabled });
                    hasHistory = true;
                } 
                // 2. 处理酒馆的其他特殊标记 (如 World Info, Char Description 等)
                else if (prompt.marker) {
                    // 暂时不需要显示酒馆的占位符（如世界书/角色卡锚点），这里留空忽略
                    // console.log(`Skipped Tavern marker: ${prompt.name}`);
                } 
                // 3. 标准内容块 (包括 system, user, assistant)
                else {
                    let type = prompt.role || 'system';
                    if (!['system', 'user', 'assistant'].includes(type)) {
                        type = 'system'; // 默认转为 system
                    }
                    importedMessages.push({ 
                        type: type, 
                        content: prompt.content || '', 
                        enabled: isEnabled,
                        name: prompt.name || ''
                    });
                }
            });

            // 如果没有明确的历史记录插入点，默认放在最后
            if (!hasHistory) {
                importedMessages.push({ type: 'history' });
            }

            messages = importedMessages;
            renderStream();
            streamList.scrollTop = 0; // 滚到顶部
            alert('预设导入成功！');
        }

        footer.appendChild(cancelBtn);
        footer.appendChild(saveBtn);
        container.appendChild(footer);
    }

    // 辅助组件生成函数
    function createStreamItem(msg, index, onDelete, onChange, onMove, onToggleEnabled) {
        const item = document.createElement('div');
        const isEnabled = msg.enabled !== false;
        item.className = `ido-card ido-card--compact ido-card--hover ${isEnabled ? '' : 'opacity-60'}`;
        if (!isEnabled) {
            item.style.borderStyle = 'dashed';
        }

        const isHistory = msg.type === 'history';

        // Header
        const header = document.createElement('div');
        header.className = `px-3 py-2 border-b border-gray-100 flex flex-col md:flex-row md:justify-between md:items-center gap-2 rounded-t-xl ${isHistory ? 'bg-yellow-50' : 'bg-gray-50'}`;

        const typeGroup = document.createElement('div');
        typeGroup.className = "flex items-center flex-wrap gap-2 min-w-0";

        const toggleBtn = document.createElement('button');
        toggleBtn.className = `p-1 rounded-full flex items-center justify-center transition-colors ${isEnabled ? 'text-green-600 hover:bg-green-50' : 'text-gray-500 hover:bg-gray-200'}`;
        toggleBtn.innerHTML = `<span class="material-symbols-outlined text-[14px]">${isEnabled ? 'check_circle' : 'radio_button_unchecked'}</span>`;
        toggleBtn.title = isEnabled ? "已启用" : "已禁用";
        toggleBtn.onclick = () => onToggleEnabled(!isEnabled);

        const icon = document.createElement('span');
        icon.className = `material-symbols-outlined text-[16px] ${isHistory ? 'text-orange-600' : 'text-gray-500'}`;
        icon.textContent = isHistory ? 'history' : (msg.type === 'system' ? 'settings' : (msg.type === 'user' ? 'person' : 'smart_toy'));

        typeGroup.appendChild(toggleBtn);
        typeGroup.appendChild(icon);

        if (isHistory) {
            const title = document.createElement('span');
            title.className = "text-xs font-bold text-orange-700";
            title.textContent = '[聊天记录插入点]';
            typeGroup.appendChild(title);
        } else {
            // 1. 角色选择下拉框
            const roleSelect = document.createElement('select');
            roleSelect.className = "text-xs font-bold text-gray-700 bg-transparent border-b border-dashed border-gray-300 focus:border-blue-500 focus:outline-none cursor-pointer pr-1 mr-1";
            ['system', 'user', 'assistant'].forEach(r => {
                const opt = document.createElement('option');
                opt.value = r;
                opt.textContent = r.toUpperCase();
                if (r === msg.type) opt.selected = true;
                roleSelect.appendChild(opt);
            });
            roleSelect.onchange = (e) => onChange(e.target.value, msg.content, msg.name);

            // 2. 名称输入框
            const nameInput = document.createElement('input');
            nameInput.type = "text";
            nameInput.className = "text-xs text-gray-500 bg-transparent border-b border-dashed border-gray-300 focus:border-blue-500 focus:outline-none w-24 md:w-28 max-w-[50vw] min-w-0 px-1 placeholder-gray-300 font-medium";
            nameInput.placeholder = "未命名块";
            nameInput.value = msg.name || '';
            nameInput.onchange = (e) => onChange(msg.type, msg.content, e.target.value);

            typeGroup.appendChild(roleSelect);
            typeGroup.appendChild(nameInput);
        }

        const actions = document.createElement('div');
        actions.className = "flex items-center gap-1 self-end md:self-auto flex-shrink-0";

        const moveUp = document.createElement('button');
        moveUp.className = "p-1 text-gray-500 hover:text-black hover:bg-gray-200 rounded transition-colors";
        moveUp.innerHTML = '<span class="material-symbols-outlined text-[16px]">arrow_upward</span>';
        moveUp.onclick = () => onMove('up');

        const moveDown = document.createElement('button');
        moveDown.className = "p-1 text-gray-500 hover:text-black hover:bg-gray-200 rounded transition-colors";
        moveDown.innerHTML = '<span class="material-symbols-outlined text-[16px]">arrow_downward</span>';
        moveDown.onclick = () => onMove('down');

        const delBtn = document.createElement('button');
        delBtn.className = "p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors";
        delBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete</span>';
        delBtn.onclick = onDelete;

        actions.appendChild(moveUp);
        actions.appendChild(moveDown);
        actions.appendChild(delBtn);

        header.appendChild(typeGroup);
        header.appendChild(actions);
        item.appendChild(header);

        // Content
        if (!isHistory) {
            const content = document.createElement('div');
            content.className = "p-3";

            const textarea = document.createElement('textarea');
            textarea.className = "w-full min-h-[80px] text-sm text-gray-700 focus:outline-none resize-y placeholder-gray-400";
            textarea.placeholder = msg.type === 'system' ? '输入系统指令...' : (msg.type === 'user' ? '输入用户示例...' : '输入助手示例...');
            textarea.value = msg.content || '';
            textarea.oninput = (e) => {
                onChange(msg.type, e.target.value, msg.name);
            };

            content.appendChild(textarea);
            item.appendChild(content);
        } else {
            const hint = document.createElement('div');
            hint.className = "p-3 text-xs text-orange-600 bg-yellow-50 rounded-b-xl";
            hint.textContent = "实际对话过程中的历史记录将会插入在此处。";
            item.appendChild(hint);
        }

        return item;
    }

    function createInput(label, type, value, placeholder) {
        const wrapper = document.createElement('div');
        wrapper.className = "ido-form-group";
        
        const labelEl = document.createElement('label');
        labelEl.className = "ido-form-label";
        labelEl.textContent = label;
        
        const input = document.createElement('input');
        input.type = type;
        input.className = "ido-form-input";
        input.value = value || '';
        input.placeholder = placeholder || '';
        
        wrapper.appendChild(labelEl);
        wrapper.appendChild(input);
        return { wrapper, input };
    }

    function createTextarea(label, value, placeholder, rows) {
        const wrapper = document.createElement('div');
        wrapper.className = "ido-form-group";
        
        const labelEl = document.createElement('label');
        labelEl.className = "ido-form-label";
        labelEl.textContent = label;
        
        const input = document.createElement('textarea');
        input.rows = rows;
        input.className = "ido-form-textarea";
        input.style.resize = 'none';
        input.value = value || '';
        input.placeholder = placeholder || '';
        
        wrapper.appendChild(labelEl);
        wrapper.appendChild(input);
        return { wrapper, input };
    }

    function createRangeInput(label, value, min, max, step) {
        const wrapper = document.createElement('div');
        wrapper.className = "ido-form-group";
        
        const labelEl = document.createElement('label');
        labelEl.className = "ido-form-label";
        labelEl.textContent = label;
        
        const group = document.createElement('div');
        group.className = "flex items-center gap-3";
        
        const range = document.createElement('input');
        range.type = "range";
        range.min = min;
        range.max = max;
        range.step = step;
        range.value = value;
        range.className = "flex-1";
        range.style.accentColor = 'var(--ido-color-primary)';
        
        const number = document.createElement('input');
        number.type = "number";
        number.min = min;
        number.max = max;
        number.step = step;
        number.value = value;
        number.className = "ido-form-input w-16 px-2 py-1 text-center";
        number.style.padding = '0.25rem 0.5rem';
        number.style.fontSize = '0.75rem';
        
        range.oninput = (e) => number.value = e.target.value;
        number.oninput = (e) => range.value = e.target.value;
        
        group.appendChild(range);
        group.appendChild(number);
        wrapper.appendChild(labelEl);
        wrapper.appendChild(group);
        return { wrapper, range, number };
    }

    function createToggle(label, checked) {
        const wrapper = document.createElement('div');
        wrapper.className = "flex items-center justify-between py-2";

        const labelEl = document.createElement('span');
        labelEl.className = "text-gray-700 text-sm font-medium";
        labelEl.textContent = label;

        const toggleWrapper = document.createElement('label');
        toggleWrapper.className = "ido-form-switch";

        const checkbox = document.createElement('input');
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.className = "ido-form-switch__input";

        const slider = document.createElement('div');
        slider.className = "ido-form-switch__slider";

        toggleWrapper.appendChild(checkbox);
        toggleWrapper.appendChild(slider);

        wrapper.appendChild(labelEl);
        wrapper.appendChild(toggleWrapper);

        return { wrapper, checkbox };
    }

})();