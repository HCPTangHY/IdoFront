/**
 * Channel Editor
 * 渠道编辑器（新增/编辑渠道）
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channelEditor = window.IdoFront.channelEditor || {};

    const utils = window.IdoFront.utils;
    const channelRegistry = window.IdoFront.channelRegistry;

    /**
     * 打开渠道编辑器
     * @param {Object|null} channel - 要编辑的渠道对象，null 表示新增
     * @param {Object} context - Framework 实例
     * @param {Object} store - Store 实例
     * @param {Object} options - 可选配置
     * @param {Function} options.onSave - 保存后的回调函数
     * @param {boolean} options.keepPanelOpen - 保存后是否保持面板打开
     */
    window.IdoFront.channelEditor.open = function(channel, context, store, options = {}) {
        if (!context || !context.setCustomPanel) return;

        context.setCustomPanel('right', (container) => {
            // 1. Header
            const header = document.createElement('div');
            header.className = "h-12 border-b border-gray-200 flex items-center justify-between px-3 bg-white flex-shrink-0";
            
            const titleGroup = document.createElement('div');
            titleGroup.className = "flex items-center gap-2";
            
            const title = document.createElement('span');
            title.className = "font-semibold text-gray-700";
            title.textContent = channel ? '编辑渠道' : '新增渠道';
            
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
            const createField = (label, type, value, placeholder, key) => {
                const wrapper = document.createElement('div');
                wrapper.className = "space-y-1";
                
                const labelEl = document.createElement('label');
                labelEl.className = "block text-xs font-medium text-gray-700";
                labelEl.textContent = label;
                
                const input = document.createElement('input');
                input.type = type;
                input.className = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors";
                input.value = value || '';
                input.placeholder = placeholder || '';
                input.setAttribute('data-key', key);
                
                wrapper.appendChild(labelEl);
                wrapper.appendChild(input);
                return { wrapper, input };
            };

            // Name
            const nameField = createField('渠道名称', 'text', channel?.name, '例如：My OpenAI', 'name');
            content.appendChild(nameField.wrapper);

            // Type (Select)
            const typeWrapper = document.createElement('div');
            typeWrapper.className = "space-y-1";
            const typeLabel = document.createElement('label');
            typeLabel.className = "block text-xs font-medium text-gray-700";
            typeLabel.textContent = "渠道类型";
            
            const typeSelect = document.createElement('select');
            typeSelect.className = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white";
            
            const registeredTypes = channelRegistry ? channelRegistry.listTypes() : [];
            const defaultUrls = {};

            // 检查当前渠道的类型是否存在于注册列表中
            const currentTypeExists = channel?.type && registeredTypes.some(t => t.id === channel.type);
            
            // 如果不存在，添加一个临时的禁用选项
            if (channel?.type && !currentTypeExists) {
                const opt = document.createElement('option');
                opt.value = channel.type;
                opt.textContent = `${channel.type} (插件未加载)`;
                opt.selected = true;
                opt.disabled = true;
                typeSelect.appendChild(opt);
            }

            registeredTypes.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.label;
                if (channel?.type === t.id) opt.selected = true;
                typeSelect.appendChild(opt);

                if (t.defaults?.baseUrl) {
                    defaultUrls[t.id] = t.defaults.baseUrl;
                }
            });

            typeWrapper.appendChild(typeLabel);
            typeWrapper.appendChild(typeSelect);
            content.appendChild(typeWrapper);

            // API URL - with dynamic placeholder based on channel type
            const urlField = createField('API 地址', 'text', channel?.baseUrl, defaultUrls[channel?.type || registeredTypes[0]?.id] || '', 'baseUrl');
            content.appendChild(urlField.wrapper);
            
            // Update placeholder when type changes
            typeSelect.addEventListener('change', () => {
                const selectedType = typeSelect.value;
                urlField.input.placeholder = defaultUrls[selectedType] || '请输入 API 地址';
            });

            // API Key - 带显示/隐藏切换
            const keyWrapper = document.createElement('div');
            keyWrapper.className = "space-y-1";
            
            const keyLabel = document.createElement('label');
            keyLabel.className = "block text-xs font-medium text-gray-700";
            keyLabel.textContent = "密钥 (API Key)";
            
            const keyInputWrapper = document.createElement('div');
            keyInputWrapper.className = "relative";
            
            const keyInput = document.createElement('input');
            keyInput.type = "password";
            keyInput.className = "w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors";
            keyInput.value = channel?.apiKey || '';
            keyInput.placeholder = 'sk-...';
            keyInput.setAttribute('data-key', 'apiKey');
            
            const toggleBtn = document.createElement('button');
            toggleBtn.type = "button";
            toggleBtn.className = "absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors";
            toggleBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">visibility_off</span>';
            toggleBtn.onclick = () => {
                if (keyInput.type === 'password') {
                    keyInput.type = 'text';
                    toggleBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">visibility</span>';
                } else {
                    keyInput.type = 'password';
                    toggleBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">visibility_off</span>';
                }
            };
            
            keyInputWrapper.appendChild(keyInput);
            keyInputWrapper.appendChild(toggleBtn);
            keyWrapper.appendChild(keyLabel);
            keyWrapper.appendChild(keyInputWrapper);
            content.appendChild(keyWrapper);
            
            // 保存 keyField 引用以便后续使用
            const keyField = { wrapper: keyWrapper, input: keyInput };

            // 自定义请求头表格
            const headersWrapper = document.createElement('div');
            headersWrapper.className = "space-y-2 pt-2 border-t border-gray-100";
            
            const headersHeader = document.createElement('div');
            headersHeader.className = "flex justify-between items-center";
            headersHeader.innerHTML = `
                <span class="text-xs font-medium text-gray-700">自定义请求头</span>
            `;
            
            const addHeaderBtn = document.createElement('button');
            addHeaderBtn.className = "text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1";
            addHeaderBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">add</span> 添加';
            
            // 当前自定义请求头列表
            let customHeaders = channel?.customHeaders || [];
            
            // 请求头表格容器
            const headersTable = document.createElement('div');
            headersTable.className = "border border-gray-200 rounded-lg overflow-hidden bg-white";
            
            const renderHeadersTable = () => {
                headersTable.innerHTML = '';
                
                if (customHeaders.length === 0) {
                    const emptyHint = document.createElement('div');
                    emptyHint.className = "p-4 text-xs text-gray-400 text-center";
                    emptyHint.textContent = "暂无自定义请求头";
                    headersTable.appendChild(emptyHint);
                } else {
                    const table = document.createElement('table');
                    table.className = "w-full text-xs";
                    
                    const thead = document.createElement('thead');
                    thead.className = "bg-gray-50 border-b border-gray-200";
                    thead.innerHTML = `
                        <tr>
                            <th class="p-2 text-left font-medium text-gray-600 w-1/3">键名</th>
                            <th class="p-2 text-left font-medium text-gray-600">值</th>
                            <th class="p-2 text-center font-medium text-gray-600 w-16">操作</th>
                        </tr>
                    `;
                    
                    const tbody = document.createElement('tbody');
                    customHeaders.forEach((header, index) => {
                        const tr = document.createElement('tr');
                        tr.className = "border-b border-gray-100 last:border-b-0";
                        
                        const keyTd = document.createElement('td');
                        keyTd.className = "p-2";
                        const keyInput = document.createElement('input');
                        keyInput.type = "text";
                        keyInput.className = "w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-500";
                        keyInput.value = header.key || '';
                        keyInput.placeholder = "例如: X-Custom-Header";
                        keyInput.oninput = (e) => {
                            customHeaders[index].key = e.target.value;
                        };
                        keyTd.appendChild(keyInput);
                        
                        const valueTd = document.createElement('td');
                        valueTd.className = "p-2";
                        const valueInput = document.createElement('input');
                        valueInput.type = "text";
                        valueInput.className = "w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-500";
                        valueInput.value = header.value || '';
                        valueInput.placeholder = "请求头的值";
                        valueInput.oninput = (e) => {
                            customHeaders[index].value = e.target.value;
                        };
                        valueTd.appendChild(valueInput);
                        
                        const actionTd = document.createElement('td');
                        actionTd.className = "p-2 text-center";
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = "text-red-600 hover:text-red-700 transition-colors";
                        deleteBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete</span>';
                        deleteBtn.onclick = () => {
                            customHeaders.splice(index, 1);
                            renderHeadersTable();
                        };
                        actionTd.appendChild(deleteBtn);
                        
                        tr.appendChild(keyTd);
                        tr.appendChild(valueTd);
                        tr.appendChild(actionTd);
                        tbody.appendChild(tr);
                    });
                    
                    table.appendChild(thead);
                    table.appendChild(tbody);
                    headersTable.appendChild(table);
                }
            };
            
            addHeaderBtn.onclick = () => {
                customHeaders.push({ key: '', value: '' });
                renderHeadersTable();
            };
            
            headersHeader.appendChild(addHeaderBtn);
            headersWrapper.appendChild(headersHeader);
            headersWrapper.appendChild(headersTable);
            content.appendChild(headersWrapper);
            
            renderHeadersTable();

            // 参数覆写JSON输入框
            const paramsWrapper = document.createElement('div');
            paramsWrapper.className = "space-y-2 pt-2 border-t border-gray-100";
            
            const paramsLabel = document.createElement('label');
            paramsLabel.className = "block text-xs font-medium text-gray-700";
            paramsLabel.textContent = "参数覆写 (JSON)";
            
            const paramsHint = document.createElement('div');
            paramsHint.className = "text-[10px] text-gray-500 mb-1";
            paramsHint.textContent = "设置的参数会覆盖或新增到请求体中，例如: {\"temperature\": 0.7, \"max_tokens\": 2000}";
            
            const paramsTextarea = document.createElement('textarea');
            paramsTextarea.className = "w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors";
            paramsTextarea.rows = 6;
            paramsTextarea.placeholder = '{\n  "temperature": 0.7,\n  "max_tokens": 2000\n}';
            paramsTextarea.value = channel?.paramsOverride ? JSON.stringify(channel.paramsOverride, null, 2) : '';
            
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

            // Models Block - 使用按钮组显示
            const modelsWrapper = document.createElement('div');
            modelsWrapper.className = "space-y-2 pt-2 border-t border-gray-100";
            
            const modelsHeader = document.createElement('div');
            modelsHeader.className = "flex justify-between items-center";
            
            const headerLeft = document.createElement('div');
            headerLeft.className = "flex items-center gap-2";
            headerLeft.innerHTML = `<span class="text-xs font-medium text-gray-700">模型列表</span>`;
            
            const clearAllBtn = document.createElement('button');
            clearAllBtn.className = "text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1";
            clearAllBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">delete_sweep</span> 清空全部';
            clearAllBtn.onclick = () => {
                if (selectedModels.length === 0) return;
                if (confirm('确定要清空所有模型吗？')) {
                    selectedModels = [];
                    renderModelButtons();
                }
            };
            
            headerLeft.appendChild(clearAllBtn);
            
            const fetchBtn = document.createElement('button');
            fetchBtn.className = "text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1";
            fetchBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">sync</span> 获取模型';
            
            // 当前选中的模型列表
            let selectedModels = channel?.models || [];
            
            // 渲染模型按钮组
            const modelsContainer = document.createElement('div');
            modelsContainer.className = "flex flex-wrap gap-2 min-h-[60px] p-2 border border-gray-200 rounded-lg bg-gray-50";
            
            const renderModelButtons = () => {
                modelsContainer.innerHTML = '';
                if (selectedModels.length === 0) {
                    const emptyHint = document.createElement('span');
                    emptyHint.className = "text-xs text-gray-400 italic";
                    emptyHint.textContent = "暂无模型，点击「获取模型」添加";
                    modelsContainer.appendChild(emptyHint);
                } else {
                    selectedModels.forEach(model => {
                        const modelBtn = document.createElement('div');
                        modelBtn.className = "inline-flex items-center gap-1 px-2 py-1 bg-white border border-gray-300 rounded-md text-xs hover:border-gray-400 transition-colors";
                        
                        const modelName = document.createElement('span');
                        modelName.className = "text-gray-700 font-medium cursor-pointer hover:text-blue-600 transition-colors";
                        modelName.textContent = model;
                        modelName.title = "点击复制模型名称";
                        modelName.onclick = async (e) => {
                            e.stopPropagation();
                            try {
                                await navigator.clipboard.writeText(model);
                                // 显示复制成功提示
                                const originalText = modelName.textContent;
                                modelName.textContent = '✓ 已复制';
                                modelName.className = "text-green-600 font-medium cursor-pointer transition-colors";
                                setTimeout(() => {
                                    modelName.textContent = originalText;
                                    modelName.className = "text-gray-700 font-medium cursor-pointer hover:text-blue-600 transition-colors";
                                }, 1000);
                            } catch (err) {
                                console.error('复制失败:', err);
                                alert('复制失败，请手动复制');
                            }
                        };
                        
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = "text-gray-400 hover:text-red-600 transition-colors";
                        deleteBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">close</span>';
                        deleteBtn.onclick = () => {
                            selectedModels = selectedModels.filter(m => m !== model);
                            renderModelButtons();
                        };
                        
                        modelBtn.appendChild(modelName);
                        modelBtn.appendChild(deleteBtn);
                        modelsContainer.appendChild(modelBtn);
                    });
                }
            };
            
            // 创建模型选择底部抽屉
            const showModelSelectionSheet = (availableModels) => {
                context.showBottomSheet((container) => {
                    // Header
                    const header = document.createElement('div');
                    header.className = "px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0 bg-white";
                    
                    const title = document.createElement('h3');
                    title.className = "text-lg font-semibold text-gray-800";
                    title.textContent = "选择模型";
                    
                    const closeBtn = document.createElement('button');
                    closeBtn.className = "text-gray-400 hover:text-gray-600 transition-colors";
                    closeBtn.innerHTML = '<span class="material-symbols-outlined text-[24px]">close</span>';
                    closeBtn.onclick = () => context.hideBottomSheet();
                    
                    header.appendChild(title);
                    header.appendChild(closeBtn);
                    
                    // Body - 响应式布局
                    const body = document.createElement('div');
                    body.className = "flex-1 overflow-y-auto px-6 py-4";
                
                    // 工具栏
                    const toolbar = document.createElement('div');
                    toolbar.className = "flex items-center justify-between mb-4 pb-3 border-b border-gray-100";
                    
                    const selectionInfo = document.createElement('span');
                    selectionInfo.className = "text-xs text-gray-500";
                    
                    const updateSelectionInfo = (count) => {
                        selectionInfo.textContent = `已选择 ${count} 个模型`;
                    };
                    
                    const buttonsGroup = document.createElement('div');
                    buttonsGroup.className = "flex gap-2";

                    const selectAllBtn = document.createElement('button');
                    selectAllBtn.className = "px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors";
                    selectAllBtn.textContent = "全选";
                    
                    const deselectAllBtn = document.createElement('button');
                    deselectAllBtn.className = "px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors";
                    deselectAllBtn.textContent = "清空";
                    
                    buttonsGroup.appendChild(selectAllBtn);
                    buttonsGroup.appendChild(deselectAllBtn);
                    
                    toolbar.appendChild(selectionInfo);
                    toolbar.appendChild(buttonsGroup);
                    
                    // 模型列表容器 - 响应式
                    const modelsContainer = document.createElement('div');
                    modelsContainer.className = "model-selection-container";
                    
                    const tempSelected = new Set(selectedModels);
                    updateSelectionInfo(tempSelected.size);
                    
                    const modelElements = [];
                    
                    // 检测是否为移动端
                    const isMobile = window.innerWidth < 768;
                    
                    if (isMobile) {
                        // 移动端：手风琴布局
                        modelsContainer.className = "space-y-2";
                        
                        availableModels.forEach(model => {
                            const isSelected = tempSelected.has(model);
                            
                            const item = document.createElement('div');
                            item.className = `border rounded-lg overflow-hidden transition-all ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`;
                            
                            const itemHeader = document.createElement('div');
                            itemHeader.className = "flex items-center justify-between p-4 cursor-pointer";
                            itemHeader.onclick = () => {
                                const newChecked = !tempSelected.has(model);
                                if (newChecked) {
                                    tempSelected.add(model);
                                    item.className = "border rounded-lg overflow-hidden transition-all border-blue-500 bg-blue-50";
                                    checkIcon.className = "w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center";
                                } else {
                                    tempSelected.delete(model);
                                    item.className = "border rounded-lg overflow-hidden transition-all border-gray-200";
                                    checkIcon.className = "w-6 h-6 rounded-full bg-gray-200 text-transparent flex items-center justify-center";
                                }
                                updateSelectionInfo(tempSelected.size);
                            };
                            
                            const modelName = document.createElement('span');
                            modelName.className = `font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`;
                            modelName.textContent = model;
                            
                            const checkIcon = document.createElement('div');
                            checkIcon.className = `w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-200 text-transparent'}`;
                            checkIcon.innerHTML = '<span class="material-symbols-outlined text-[16px]">check</span>';
                            
                            itemHeader.appendChild(modelName);
                            itemHeader.appendChild(checkIcon);
                            item.appendChild(itemHeader);
                            modelsContainer.appendChild(item);
                            
                            modelElements.push({
                                element: item,
                                update: (checked) => {
                                    if (checked) {
                                        tempSelected.add(model);
                                        item.className = "border rounded-lg overflow-hidden transition-all border-blue-500 bg-blue-50";
                                        checkIcon.className = "w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center";
                                        modelName.className = "font-medium text-blue-700";
                                    } else {
                                        tempSelected.delete(model);
                                        item.className = "border rounded-lg overflow-hidden transition-all border-gray-200";
                                        checkIcon.className = "w-6 h-6 rounded-full bg-gray-200 text-transparent flex items-center justify-center";
                                        modelName.className = "font-medium text-gray-700";
                                    }
                                }
                            });
                        });
                    } else {
                        // 桌面端：多列网格
                        modelsContainer.className = "grid grid-cols-3 gap-3";
                        
                        availableModels.forEach(model => {
                            const isSelected = tempSelected.has(model);
                            
                            const baseClass = "relative cursor-pointer rounded-xl border p-3 flex items-center gap-2 transition-all duration-200 select-none group";
                            const selectedClass = "border-blue-500 bg-blue-50/50 shadow-sm";
                            const unselectedClass = "border-gray-200 hover:border-blue-300 hover:bg-gray-50";
                            
                            const wrapper = document.createElement('div');
                            wrapper.className = `${baseClass} ${isSelected ? selectedClass : unselectedClass}`;
                            
                            const icon = document.createElement('div');
                            icon.className = `w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-transparent group-hover:text-gray-300'}`;
                            icon.innerHTML = '<span class="material-symbols-outlined text-[14px] font-bold">check</span>';
                            
                            const label = document.createElement('span');
                            label.className = `text-sm font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-700'}`;
                            label.textContent = model;
                            label.title = model;
                            
                            wrapper.onclick = () => {
                                const newChecked = !tempSelected.has(model);
                                if (newChecked) {
                                    tempSelected.add(model);
                                    wrapper.className = `${baseClass} ${selectedClass}`;
                                    icon.className = "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-blue-500 text-white";
                                    label.className = "text-sm font-medium truncate text-blue-700";
                                } else {
                                    tempSelected.delete(model);
                                    wrapper.className = `${baseClass} ${unselectedClass}`;
                                    icon.className = "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-gray-100 text-transparent group-hover:text-gray-300";
                                    label.className = "text-sm font-medium truncate text-gray-700";
                                }
                                updateSelectionInfo(tempSelected.size);
                            };
                            
                            wrapper.appendChild(icon);
                            wrapper.appendChild(label);
                            modelsContainer.appendChild(wrapper);
                            
                            modelElements.push({
                                element: wrapper,
                                update: (checked) => {
                                    if (checked) {
                                        tempSelected.add(model);
                                        wrapper.className = `${baseClass} ${selectedClass}`;
                                        icon.className = "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-blue-500 text-white";
                                        label.className = "text-sm font-medium truncate text-blue-700";
                                    } else {
                                        tempSelected.delete(model);
                                        wrapper.className = `${baseClass} ${unselectedClass}`;
                                        icon.className = "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-gray-100 text-transparent group-hover:text-gray-300";
                                        label.className = "text-sm font-medium truncate text-gray-700";
                                    }
                                }
                            });
                        });
                    }
                    
                    // 全选/清空事件
                    selectAllBtn.onclick = () => {
                        modelElements.forEach(item => item.update(true));
                        updateSelectionInfo(tempSelected.size);
                    };
                    
                    deselectAllBtn.onclick = () => {
                        modelElements.forEach(item => item.update(false));
                        updateSelectionInfo(tempSelected.size);
                    };
                    
                    body.appendChild(toolbar);
                    body.appendChild(modelsContainer);
                    
                    // Footer
                    const footer = document.createElement('div');
                    footer.className = "px-6 py-4 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0 bg-white";
                    
                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = "px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors";
                    cancelBtn.textContent = "取消";
                    cancelBtn.onclick = () => context.hideBottomSheet();
                    
                    const confirmBtn = document.createElement('button');
                    confirmBtn.className = "px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-medium";
                    confirmBtn.textContent = "确定";
                    confirmBtn.onclick = () => {
                        selectedModels = Array.from(tempSelected);
                        renderModelButtons();
                        context.hideBottomSheet();
                    };
                    
                    footer.appendChild(cancelBtn);
                    footer.appendChild(confirmBtn);
                    
                    container.appendChild(header);
                    container.appendChild(body);
                    container.appendChild(footer);
                });
            };
            
            // 获取模型按钮点击事件
            fetchBtn.onclick = async () => {
                const currentConfig = {
                    type: typeSelect.value,
                    baseUrl: urlField.input.value,
                    apiKey: keyField.input.value
                };

                if (!currentConfig.apiKey) {
                    alert('请先填写 API Key');
                    return;
                }

                fetchBtn.disabled = true;
                fetchBtn.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">sync</span> 获取中...';
                
                try {
                    const service = window.IdoFront.service;
                    const models = await service.fetchModels(currentConfig);
                    
                    if (models && models.length > 0) {
                        showModelSelectionSheet(models);
                    } else {
                        alert('未获取到模型列表');
                    }
                } catch (error) {
                    console.error('Fetch models error:', error);
                    alert(`获取模型失败: ${error.message}`);
                } finally {
                    fetchBtn.disabled = false;
                    fetchBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">sync</span> 获取模型';
                }
            };
            
            modelsHeader.appendChild(headerLeft);
            modelsHeader.appendChild(fetchBtn);
            modelsWrapper.appendChild(modelsHeader);
            modelsWrapper.appendChild(modelsContainer);
            
            // 手动添加模型输入框
            const manualAddWrapper = document.createElement('div');
            manualAddWrapper.className = "flex gap-2 mt-2";
            
            const manualInput = document.createElement('input');
            manualInput.type = "text";
            manualInput.className = "flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors";
            manualInput.placeholder = "手动输入模型名称";
            
            const manualAddBtn = document.createElement('button');
            manualAddBtn.className = "px-4 py-2 text-sm bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors font-medium flex items-center gap-1";
            manualAddBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">add</span> 添加';
            manualAddBtn.onclick = () => {
                const modelName = manualInput.value.trim();
                if (modelName) {
                    if (!selectedModels.includes(modelName)) {
                        selectedModels.push(modelName);
                        renderModelButtons();
                        manualInput.value = '';
                    } else {
                        alert('该模型已存在');
                    }
                } else {
                    alert('请输入模型名称');
                }
            };
            
            // 支持回车键添加
            manualInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    manualAddBtn.click();
                }
            });
            
            manualAddWrapper.appendChild(manualInput);
            manualAddWrapper.appendChild(manualAddBtn);
            modelsWrapper.appendChild(manualAddWrapper);
            
            content.appendChild(modelsWrapper);
            
            // 初始渲染
            renderModelButtons();

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
                
                // 过滤掉空的自定义请求头
                const validHeaders = customHeaders.filter(h => h.key && h.value);
                
                const newChannel = {
                    id: channel?.id || utils.createId('chan'),
                    name: nameField.input.value,
                    type: typeSelect.value,
                    baseUrl: urlField.input.value,
                    apiKey: keyField.input.value,
                    models: selectedModels,
                    customHeaders: validHeaders.length > 0 ? validHeaders : undefined,
                    paramsOverride: paramsOverride,
                    enabled: channel?.enabled !== false // Default true for new
                };
                
                // Update Store
                const currentChannels = store.state.channels || [];
                const index = currentChannels.findIndex(c => c.id === newChannel.id);
                
                let updatedChannels;
                if (index >= 0) {
                    updatedChannels = [...currentChannels];
                    updatedChannels[index] = newChannel;
                } else {
                    updatedChannels = [...currentChannels, newChannel];
                }
                
                store.saveChannels(updatedChannels);
                
                // 触发渠道列表刷新事件
                if (store.events) {
                    store.events.emit('channels:updated');
                }
                
                // 根据配置决定保存后的行为
                if (options.onSave && typeof options.onSave === 'function') {
                    // 如果提供了自定义回调，执行回调
                    options.onSave();
                } else if (options.keepPanelOpen) {
                    // 如果需要保持面板打开，清空自定义面板内容让框架恢复默认面板
                    context.setCustomPanel('right', null);
                } else {
                    // 默认行为：关闭面板
                    context.setCustomPanel('right', null);
                    context.togglePanel('right', false);
                }
            };

            footer.appendChild(cancelBtn);
            footer.appendChild(saveBtn);
            container.appendChild(footer);
        });
        
        // 显示右侧面板
        context.togglePanel('right', true);
    };

})();