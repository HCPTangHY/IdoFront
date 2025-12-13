/**
 * Plugin Settings
 * 插件管理页面渲染
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.pluginSettings = window.IdoFront.pluginSettings || {};

    const SLOT_LABELS = {
        'slot-sidebar-top': '侧边栏顶部',
        'slot-sidebar-bottom': '侧边栏底部',
        'slot-header-actions': '顶部栏操作',
        'slot-input-top': '输入框上方',
        'slot-input-actions-left': '输入框左侧',
        'slot-input-actions-right': '输入框右侧',
        'message-footer': '消息底部'
    };

    window.IdoFront.pluginSettings.render = function(container, context, store) {
        container.innerHTML = '';

        if (!context || typeof context.getPlugins !== 'function') {
            container.innerHTML = '<div class="text-red-500">Framework version mismatch</div>';
            return;
        }

        const loader = window.IdoFront.pluginLoader;
        const { root: statusBar, setStatus } = createStatusBar();
        container.appendChild(statusBar);

        if (!loader) {
            container.appendChild(renderLoaderMissing());
            return;
        }

        let externalPlugins = [];
        try {
            externalPlugins = typeof loader.getPlugins === 'function' ? loader.getPlugins() : [];
        } catch (error) {
            setStatus(`外部插件列表读取失败：${error.message}`, 'error');
        }

        const internalPlugins = context.getPlugins() || [];
        const userPlugins = internalPlugins.filter(p => !p.id.startsWith('core-'));
        
        // 使用 settingsManager 的 refreshCurrentTab 来刷新，
        // 而不是在闭包中捕获容器引用（容器可能是临时离屏容器）
        const rerender = () => {
            const manager = window.IdoFront.settingsManager;
            if (manager && typeof manager.refreshCurrentTab === 'function') {
                manager.refreshCurrentTab();
            }
        };

        // 外部插件导入面板（只负责导入，和列表展示解耦）
        container.appendChild(createImportPanel({
            loader,
            rerender,
            setStatus
        }));

        // 统一插件列表：内置插件与外部插件在同一列表中按平等地位展示
        container.appendChild(renderPluginList({
            internalPlugins: userPlugins,
            externalPlugins,
            loader,
            store,
            context,
            rerender,
            setStatus
        }));

        if (loader.lastError) {
            container.appendChild(renderLastError(loader.lastError));
        }
    };

    function createStatusBar() {
        const root = document.createElement('div');
        root.className = 'hidden mb-4 rounded border px-3 py-2 text-sm';
        const setStatus = (message, type = 'info') => {
            if (!message) {
                root.classList.add('hidden');
                root.textContent = '';
                return;
            }
            root.classList.remove('hidden');
            root.textContent = message;
            const palette = {
                info: 'border-blue-200 bg-blue-50 text-blue-700',
                success: 'border-green-200 bg-green-50 text-green-700',
                error: 'border-red-200 bg-red-50 text-red-700'
            };
            root.className = `mb-4 rounded border px-3 py-2 text-sm ${palette[type] || palette.info}`;
        };
        return { root, setStatus };
    }

    function renderLoaderMissing() {
        const card = document.createElement('div');
        card.className = 'ido-card p-4 text-sm text-red-600 bg-red-50 border border-red-200';
        card.textContent = '外部插件加载器未初始化，请确认 window.IdoFront.pluginLoader 已在主线程加载。';
        return card;
    }

    function renderExternalManager({ plugins, loader, rerender, setStatus }) {
        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-4';

        const title = document.createElement('div');
        title.className = 'flex items-center justify-between';
        const heading = document.createElement('h2');
        heading.className = 'text-base font-semibold text-gray-800';
        heading.textContent = '外部插件 (独立导入)';
        title.appendChild(heading);
        wrapper.appendChild(title);

        wrapper.appendChild(createImportPanel({ loader, rerender, setStatus }));
        wrapper.appendChild(renderExternalList({ plugins, loader, rerender, setStatus }));

        return wrapper;
    }

    function createImportPanel({ loader, rerender, setStatus }) {
        const card = document.createElement('div');
        card.className = 'ido-card p-4 space-y-4';

        const intro = document.createElement('p');
        intro.className = 'text-xs text-gray-500';
        intro.textContent = '支持粘贴 JS 代码或上传 .js 文件。系统会自动解析 Userscript 风格的元数据 (如 // @name, // @version)。';
        card.appendChild(intro);

        // 状态管理
        let currentCode = '';
        let currentMeta = {};

        // 预览区域 (初始隐藏)
        const previewArea = document.createElement('div');
        previewArea.className = 'hidden space-y-3 border border-gray-200 rounded-lg p-3 bg-gray-50';
        
        const createField = (label, key, placeholder = '') => {
            const div = document.createElement('div');
            div.className = 'flex flex-col gap-1';
            const lbl = document.createElement('label');
            lbl.className = 'text-xs font-medium text-gray-600';
            lbl.textContent = label;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'ido-input text-sm py-1';
            input.placeholder = placeholder;
            input.dataset.key = key;
            input.oninput = (e) => {
                currentMeta[key] = e.target.value;
            };
            div.appendChild(lbl);
            div.appendChild(input);
            return { div, input };
        };

        const nameField = createField('插件名称', 'name', '必填');
        const versionField = createField('版本', 'version', '1.0.0');
        const descField = createField('描述', 'description', '可选');
        
        const metaRow = document.createElement('div');
        metaRow.className = 'grid grid-cols-2 gap-3';
        metaRow.appendChild(nameField.div);
        metaRow.appendChild(versionField.div);
        
        previewArea.appendChild(metaRow);
        previewArea.appendChild(descField.div);

        // 代码输入区域
        const codeArea = document.createElement('textarea');
        codeArea.className = 'ido-textarea w-full min-h-[160px] font-mono text-xs leading-relaxed';
        codeArea.placeholder = '// ==UserScript==\n// @name My Plugin\n// @version 1.0.0\n// ==/UserScript==\n\n(function() { ... })();';
        
        const updatePreview = (code) => {
            currentCode = code;
            const meta = loader.parseMetadata(code);
            currentMeta = { ...meta }; // Reset to parsed
            
            nameField.input.value = meta.name || '';
            versionField.input.value = meta.version || '1.0.0';
            descField.input.value = meta.description || '';
            
            if (code.trim()) {
                previewArea.classList.remove('hidden');
            } else {
                previewArea.classList.add('hidden');
            }
        };

        codeArea.addEventListener('input', (e) => updatePreview(e.target.value));
        card.appendChild(codeArea);

        // 文件上传与按钮
        const actions = document.createElement('div');
        actions.className = 'flex items-center justify-between mt-2';

        const leftActions = document.createElement('div');
        leftActions.className = 'flex items-center gap-2';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.js,.mjs,text/javascript';
        fileInput.className = 'hidden';
        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            const text = await file.text();
            codeArea.value = text;
            updatePreview(text);
            // 如果还是没有解析出名字，才使用文件名作为兜底
            if (!nameField.input.value.trim()) {
                const fileName = file.name.replace(/\.[^.]+$/, '');
                currentMeta.name = fileName;
                nameField.input.value = fileName;
            }
        });

        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'ido-btn ido-btn--secondary ido-btn--sm';
        uploadBtn.innerHTML = '<span class="material-symbols-outlined text-sm">upload_file</span> 加载文件';
        uploadBtn.onclick = () => fileInput.click();
        
        leftActions.appendChild(uploadBtn);
        leftActions.appendChild(fileInput);
        actions.appendChild(leftActions);

        const importBtn = document.createElement('button');
        importBtn.className = 'ido-btn ido-btn--primary ido-btn--sm';
        importBtn.textContent = '确认导入';
        importBtn.onclick = async () => {
            const name = currentMeta.name || nameField.input.value.trim();
            const code = currentCode.trim();
            
            if (!name || !code) {
                setStatus('请填写插件名称与代码后再导入。', 'error');
                return;
            }
            
            importBtn.disabled = true;
            importBtn.textContent = '导入中...';
            
            try {
                // 合并手动修改的元数据
                const finalMeta = {
                    ...currentMeta,
                    name: nameField.input.value.trim(),
                    version: versionField.input.value.trim(),
                    description: descField.input.value.trim()
                };

                await loader.addPlugin(finalMeta.name, code, finalMeta);
                setStatus(`插件 ${finalMeta.name} 导入成功`, 'success');
                
                // Reset
                codeArea.value = '';
                updatePreview('');
                fileInput.value = '';
                
                // 使用 requestAnimationFrame 确保在下一帧渲染前刷新
                requestAnimationFrame(() => rerender());
            } catch (error) {
                setStatus(`导入失败：${error.message}`, 'error');
                importBtn.disabled = false;
                importBtn.textContent = '确认导入';
            }
        };
        actions.appendChild(importBtn);

        card.appendChild(previewArea);
        card.appendChild(actions);

        return card;
    }

    function renderExternalList({ plugins, loader, rerender, setStatus }) {
        const listWrapper = document.createElement('div');
        listWrapper.className = 'space-y-2';

        if (!plugins || plugins.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ido-empty';
            empty.textContent = '暂无外部插件';
            listWrapper.appendChild(empty);
            return listWrapper;
        }

        plugins.forEach(plugin => {
            const card = document.createElement('div');
            card.className = 'ido-card flex flex-col gap-2 p-4';

            const header = document.createElement('div');
            header.className = 'flex items-start justify-between gap-4';

            const info = document.createElement('div');
            info.className = 'flex flex-col gap-1';

            const nameRow = document.createElement('div');
            nameRow.className = 'flex items-center gap-2';

            // 从插件代码派生元数据，用于老数据的展示兜底
            const derivedMeta = (loader && typeof loader.parseMetadata === 'function' && plugin.code)
                ? loader.parseMetadata(plugin.code)
                : {};
            const displayName = plugin.name || derivedMeta.name || plugin.id;
            const displayDescription = plugin.description || derivedMeta.description || '';

            // Icon: 优先使用存储的 icon，其次使用头部元数据 @icon，最后回退到默认 extension
            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined text-gray-400 text-lg';
            const iconValue =
                (plugin.icon && plugin.icon.trim()) ||
                (derivedMeta.icon && derivedMeta.icon.trim()) ||
                'extension';
            iconSpan.textContent = iconValue;
            nameRow.appendChild(iconSpan);

            const name = document.createElement('span');
            name.className = 'font-semibold text-gray-800';
            name.textContent = displayName;
            nameRow.appendChild(name);

            if (plugin.version) {
                const version = document.createElement('span');
                version.className = 'text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded';
                version.textContent = `v${plugin.version}`;
                nameRow.appendChild(version);
            }

            const runtimeBadge = document.createElement('span');
            runtimeBadge.className = `text-[10px] px-1.5 py-0.5 rounded-full border ${plugin.runtime === 'running' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`;
            runtimeBadge.textContent = plugin.runtime === 'running' ? '运行中' : '已停止';
            nameRow.appendChild(runtimeBadge);

            info.appendChild(nameRow);

            if (displayDescription) {
                const desc = document.createElement('span');
                desc.className = 'text-xs text-gray-500 line-clamp-2';
                desc.textContent = displayDescription;
                info.appendChild(desc);
            }

            const metaRow2 = document.createElement('div');
            metaRow2.className = 'flex items-center gap-3 text-[11px] text-gray-400 mt-1';
            
            if (plugin.author) {
                const author = document.createElement('span');
                author.textContent = `作者: ${plugin.author}`;
                metaRow2.appendChild(author);
            }
            
            const updated = document.createElement('span');
            updated.textContent = `更新: ${new Date(plugin.updatedAt).toLocaleDateString()}`;
            metaRow2.appendChild(updated);

            if (plugin.homepage) {
                const link = document.createElement('a');
                link.href = plugin.homepage;
                link.target = '_blank';
                link.className = 'hover:text-blue-500 flex items-center gap-0.5';
                link.innerHTML = '主页 <span class="material-symbols-outlined text-[10px]">open_in_new</span>';
                metaRow2.appendChild(link);
            }

            info.appendChild(metaRow2);
            header.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-2';

            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'ido-form-switch';
            toggleLabel.title = plugin.enabled ? '点击停用' : '点击启用';
            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.className = 'ido-form-switch__input';
            toggle.checked = !!plugin.enabled;
            toggle.onchange = async (event) => {
                try {
                    await loader.togglePlugin(plugin.id, event.target.checked);
                    setStatus(`已${event.target.checked ? '启用' : '停用'}插件 ${plugin.name}`, 'success');
                    requestAnimationFrame(() => rerender());
                } catch (error) {
                    setStatus(`切换插件失败：${error.message}`, 'error');
                    event.target.checked = !event.target.checked;
                }
            };
            const slider = document.createElement('div');
            slider.className = 'ido-form-switch__slider';
            toggleLabel.appendChild(toggle);
            toggleLabel.appendChild(slider);
            actions.appendChild(toggleLabel);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'ido-icon-btn text-red-400 hover:text-red-600 hover:bg-red-50';
            deleteBtn.title = '删除插件';
            deleteBtn.innerHTML = '<span class="material-symbols-outlined text-lg">delete</span>';
            deleteBtn.onclick = async () => {
                const confirmed = window.confirm(`确认删除插件 ${plugin.name || plugin.id} 吗？`);
                if (!confirmed) return;
                try {
                    await loader.deletePlugin(plugin.id);
                    setStatus(`插件 ${plugin.name || plugin.id} 已删除`, 'success');
                    requestAnimationFrame(() => rerender());
                } catch (error) {
                    setStatus(`删除失败：${error.message}`, 'error');
                }
            };
            actions.appendChild(deleteBtn);

            header.appendChild(actions);
            card.appendChild(header);
            listWrapper.appendChild(card);
        });

        return listWrapper;
    }

    function renderPluginList({ internalPlugins, externalPlugins, loader, store, context, rerender, setStatus }) {
        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-4 mt-8';

        const heading = document.createElement('h2');
        heading.className = 'text-base font-semibold text-gray-800';
        heading.textContent = '插件列表';
        wrapper.appendChild(heading);

        const listWrapper = document.createElement('div');
        listWrapper.className = 'space-y-2';

        const combined = [];
        if (internalPlugins && internalPlugins.length) {
            internalPlugins.forEach((p) => combined.push({ plugin: p, source: 'internal' }));
        }
        if (externalPlugins && externalPlugins.length) {
            externalPlugins.forEach((p) => combined.push({ plugin: p, source: 'external' }));
        }

        if (combined.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ido-empty';
            empty.textContent = '暂无插件';
            wrapper.appendChild(empty);
            return wrapper;
        }

        combined.forEach(({ plugin, source }) => {
            const card = document.createElement('div');
            card.className = 'ido-card flex flex-col gap-2 p-4';

            const header = document.createElement('div');
            header.className = 'flex items-start justify-between gap-4';

            const info = document.createElement('div');
            info.className = 'flex flex-col gap-1';

            const nameRow = document.createElement('div');
            nameRow.className = 'flex items-center gap-2';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined text-gray-400 text-lg';

            let displayName = plugin.id;
            let displayDescription = '';
            let versionText = '';

            if (source === 'external') {
                const derivedMeta = (loader && typeof loader.parseMetadata === 'function' && plugin.code)
                    ? loader.parseMetadata(plugin.code)
                    : {};
                displayName = plugin.name || derivedMeta.name || plugin.id;
                displayDescription = plugin.description || derivedMeta.description || '';
                versionText = plugin.version || derivedMeta.version || '';
                const iconValue =
                    (plugin.icon && plugin.icon.trim()) ||
                    (derivedMeta.icon && derivedMeta.icon.trim()) ||
                    'extension';
                iconSpan.textContent = iconValue;
            } else {
                // 内置插件：使用注册时提供的 meta 信息作为展示元数据
                const meta = plugin.meta || {};
                displayName = meta.name || plugin.id;
                displayDescription = meta.description || '';
                versionText = meta.version || '';
                const iconValue =
                    (meta.icon && meta.icon.trim()) ||
                    'extension';
                iconSpan.textContent = iconValue;
            }

            nameRow.appendChild(iconSpan);

            const name = document.createElement('span');
            name.className = 'font-semibold text-gray-800';
            name.textContent = displayName;
            nameRow.appendChild(name);

            if (versionText) {
                const version = document.createElement('span');
                version.className = 'text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded';
                version.textContent = `v${versionText}`;
                nameRow.appendChild(version);
            }

            const originBadge = document.createElement('span');
            originBadge.className = `text-[10px] px-1.5 py-0.5 rounded-full border ${
                source === 'external'
                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                    : 'bg-gray-50 text-gray-500 border-gray-200'
            }`;
            originBadge.textContent = source === 'external' ? '外部插件' : '内置插件';
            nameRow.appendChild(originBadge);

            info.appendChild(nameRow);

            if (displayDescription) {
                const desc = document.createElement('span');
                desc.className = 'text-xs text-gray-500 line-clamp-2';
                desc.textContent = displayDescription;
                info.appendChild(desc);
            }

            if (source === 'external') {
                const metaRow = document.createElement('div');
                metaRow.className = 'flex items-center gap-3 text-[11px] text-gray-400 mt-1';

                if (plugin.author) {
                    const author = document.createElement('span');
                    author.textContent = `作者: ${plugin.author}`;
                    metaRow.appendChild(author);
                }

                if (plugin.updatedAt) {
                    const updated = document.createElement('span');
                    updated.textContent = `更新: ${new Date(plugin.updatedAt).toLocaleDateString()}`;
                    metaRow.appendChild(updated);
                }

                if (plugin.homepage) {
                    const link = document.createElement('a');
                    link.href = plugin.homepage;
                    link.target = '_blank';
                    link.className = 'hover:text-blue-500 flex items-center gap-0.5';

                    const linkText = document.createElement('span');
                    linkText.textContent = '主页';
                    const linkIcon = document.createElement('span');
                    linkIcon.className = 'material-symbols-outlined text-[10px]';
                    linkIcon.textContent = 'open_in_new';

                    link.appendChild(linkText);
                    link.appendChild(linkIcon);
                    metaRow.appendChild(link);
                }

                info.appendChild(metaRow);
            }

            header.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-2';

            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'ido-form-switch';
            toggleLabel.title = '启用/停用插件';
            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.className = 'ido-form-switch__input';
            if (source === 'external') {
                toggle.checked = !!plugin.enabled;
            } else {
                toggle.checked = plugin.enabled !== false;
            }

            toggle.onchange = async (event) => {
                const enabled = event.target.checked;
                if (source === 'external') {
                    try {
                        await loader.togglePlugin(plugin.id, enabled);
                        setStatus(`已${enabled ? '启用' : '停用'}插件 ${plugin.name || plugin.id}`, 'success');
                        // 使用 requestAnimationFrame 确保在下一帧渲染前刷新
                        requestAnimationFrame(() => rerender());
                    } catch (error) {
                        setStatus(`切换插件失败：${error.message}`, 'error');
                        event.target.checked = !enabled;
                    }
                } else {
                    try {
                        if (store && typeof store.setPluginState === 'function') {
                            store.setPluginState(plugin.slot, plugin.id, enabled);
                        }
                        if (context && typeof context.setPluginEnabled === 'function') {
                            context.setPluginEnabled(plugin.slot, plugin.id, enabled);
                        }
                    } catch (error) {
                        setStatus(`切换插件失败：${error.message}`, 'error');
                        event.target.checked = !enabled;
                    }
                }
            };

            const slider = document.createElement('div');
            slider.className = 'ido-form-switch__slider';
            toggleLabel.appendChild(toggle);
            toggleLabel.appendChild(slider);
            actions.appendChild(toggleLabel);

            if (source === 'external') {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'ido-icon-btn text-red-400 hover:text-red-600 hover:bg-red-50';
                deleteBtn.title = '删除插件';
                deleteBtn.innerHTML = '<span class="material-symbols-outlined text-lg">delete</span>';
                deleteBtn.onclick = async () => {
                    const confirmed = window.confirm(`确认删除插件 ${plugin.name || plugin.id} 吗？`);
                    if (!confirmed) return;
                    try {
                        await loader.deletePlugin(plugin.id);
                        setStatus(`插件 ${plugin.name || plugin.id} 已删除`, 'success');
                        // 使用 requestAnimationFrame 确保在下一帧渲染前刷新
                        requestAnimationFrame(() => rerender());
                    } catch (error) {
                        setStatus(`删除失败：${error.message}`, 'error');
                    }
                };
                actions.appendChild(deleteBtn);
            }

            header.appendChild(actions);
            card.appendChild(header);
            listWrapper.appendChild(card);
        });

        wrapper.appendChild(listWrapper);
        return wrapper;
    }

    function renderInternalManager({ plugins, store, context }) {
        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-4 mt-8';

        const heading = document.createElement('h2');
        heading.className = 'text-base font-semibold text-gray-800';
        heading.textContent = '框架插件 (注册到插槽)';
        wrapper.appendChild(heading);

        if (!plugins || plugins.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ido-empty';
            empty.textContent = '暂无已注册的自定义框架插件';
            wrapper.appendChild(empty);
            return wrapper;
        }

        const grouped = {};
        plugins.forEach(plugin => {
            if (!grouped[plugin.slot]) grouped[plugin.slot] = [];
            grouped[plugin.slot].push(plugin);
        });

        Object.keys(grouped).forEach(slot => {
            const groupDiv = document.createElement('div');
            const groupTitle = document.createElement('h3');
            groupTitle.className = 'text-xs font-bold text-gray-500 uppercase border-b border-gray-100 pb-1 mb-2';
            groupTitle.textContent = SLOT_LABELS[slot] || slot;
            groupDiv.appendChild(groupTitle);

            const items = document.createElement('div');
            items.className = 'flex flex-col gap-2';

            grouped[slot].forEach(plugin => {
                const item = document.createElement('div');
                item.className = 'ido-card ido-card--hover flex items-center justify-between p-3';

                const info = document.createElement('div');
                info.className = 'flex items-center gap-2';
                const icon = document.createElement('span');
                icon.className = 'material-symbols-outlined text-[18px] text-gray-400';
                icon.textContent = 'extension';
                const name = document.createElement('span');
                name.className = 'text-sm text-gray-800';
                name.textContent = plugin.id;
                info.appendChild(icon);
                info.appendChild(name);

                const toggleLabel = document.createElement('label');
                toggleLabel.className = 'ido-form-switch';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.className = 'ido-form-switch__input';
                input.checked = plugin.enabled !== false;
                input.onchange = (event) => {
                    store.setPluginState(plugin.slot, plugin.id, event.target.checked);
                    context.setPluginEnabled(plugin.slot, plugin.id, event.target.checked);
                };
                const slider = document.createElement('div');
                slider.className = 'ido-form-switch__slider';
                toggleLabel.appendChild(input);
                toggleLabel.appendChild(slider);

                item.appendChild(info);
                item.appendChild(toggleLabel);
                items.appendChild(item);
            });

            groupDiv.appendChild(items);
            wrapper.appendChild(groupDiv);
        });

        return wrapper;
    }

    function renderLastError(error) {
        const card = document.createElement('div');
        card.className = 'ido-card border border-red-200 bg-red-50 text-sm text-red-700 space-y-1 mt-4';
        const title = document.createElement('div');
        title.className = 'font-semibold flex items-center gap-2';
        title.innerHTML = '<span class="material-symbols-outlined text-base">error</span> 最近的外部插件错误';
        card.appendChild(title);

        const detail = document.createElement('div');
        detail.textContent = `${error.pluginName || error.pluginId}: ${error.message}`;
        card.appendChild(detail);

        if (error.stack) {
            const pre = document.createElement('pre');
            pre.className = 'bg-white/60 rounded p-2 text-xs overflow-auto mt-2';
            pre.textContent = error.stack;
            card.appendChild(pre);
        }

        return card;
    }

})();
