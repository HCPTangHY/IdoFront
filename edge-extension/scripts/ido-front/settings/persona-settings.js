/**
 * Persona Settings
 * 管理面具（助手设定）列表
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.personaSettings = window.IdoFront.personaSettings || {};

    let context = null;
    let store = null;

    const utils = window.IdoFront.utils;

    const PERSONA_EXPORT_VERSION = 1;
    const PERSONA_MAGIC_SINGLE = 'IdoFront_Persona';
    const PERSONA_MAGIC_MULTI = 'IdoFront_Personas';

    /**
     * 渲染面具管理列表
     */
    window.IdoFront.personaSettings.render = function(container, frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;

        container.innerHTML = '';

        // 顶部：标题 + 导入/导出 + 新建
        const header = document.createElement('div');
        header.className = "flex justify-between items-center mb-4 gap-2";

        const title = document.createElement('h3');
        title.className = "text-lg font-medium text-gray-800";
        title.textContent = "面具列表";

        const actions = document.createElement('div');
        actions.className = 'flex items-center gap-2 flex-shrink-0';

        const createBtn = window.IdoUI?.createIconButton
            ? window.IdoUI.createIconButton
            : (context?.ui?.createIconButton ? context.ui.createIconButton.bind(context.ui) : null);

        if (!createBtn) {
            container.innerHTML = '<div class="text-red-500 text-sm">UI 按钮组件未加载</div>';
            return;
        }

        // 导入（IdoFront 面具）
        const importBtn = createBtn({
            label: '导入',
            icon: 'upload',
            variant: 'secondary',
            size: 'sm',
            className: 'whitespace-nowrap'
        });

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.className = 'hidden';
        importBtn.appendChild(fileInput);

        importBtn.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            handleImportPersonas(file, container);
            // 重置 input，允许重复选择同一文件
            fileInput.value = '';
        };

        // 导出全部
        const exportAllBtn = createBtn({
            label: '导出全部',
            icon: 'download',
            variant: 'secondary',
            size: 'sm',
            className: 'whitespace-nowrap',
            onClick: () => {
                try {
                    exportAllPersonas();
                } catch (e) {
                    console.error(e);
                    alert('导出失败：' + (e && e.message ? e.message : '未知错误'));
                }
            }
        });

        // 新建面具
        const addBtn = createBtn({
            label: '新建面具',
            icon: 'add',
            variant: 'primary',
            size: 'sm',
            className: 'whitespace-nowrap',
            onClick: () => {
                if (window.IdoFront.personaEditor && window.IdoFront.personaEditor.open) {
                    window.IdoFront.personaEditor.open(null, context, store);
                }
            }
        });

        actions.appendChild(importBtn);
        actions.appendChild(exportAllBtn);
        actions.appendChild(addBtn);

        header.appendChild(title);
        header.appendChild(actions);
        container.appendChild(header);

        // 列表容器
        const list = document.createElement('div');
        list.className = "space-y-3";

        const personas = store.state.personas || [];

        if (personas.length === 0) {
            const empty = document.createElement('div');
            empty.className = "text-center py-8 text-gray-400 text-sm";
            empty.textContent = "暂无自定义面具，正在使用默认助手";
            list.appendChild(empty);
        } else {
            personas.forEach(persona => {
                const item = createPersonaItem(persona, container);
                list.appendChild(item);
            });
        }

        container.appendChild(list);
    };

    function createPersonaItem(persona, container) {
        const item = document.createElement('div');
        // 紧凑型卡片样式
        item.className = "border border-gray-200 rounded-lg p-2.5 hover:border-red-500 hover:shadow-md transition-all bg-white";
        
        // 单行布局
        const row = document.createElement('div');
        row.className = "flex justify-between items-center gap-2";
        
        // 左侧：名称和徽章
        const leftSection = document.createElement('div');
        leftSection.className = "flex items-center gap-2 flex-1 min-w-0";
        
        const name = document.createElement('div');
        name.className = "font-medium text-gray-800 text-sm truncate";
        name.textContent = persona.name;
        
        leftSection.appendChild(name);
        
        if (persona.id === store.state.activePersonaId) {
            const badge = document.createElement('span');
            badge.className = "bg-black text-white text-[9px] px-1.5 py-0.5 transform -skew-x-12 shadow-sm font-bold tracking-wider flex-shrink-0";
            badge.textContent = "当前";
            leftSection.appendChild(badge);
        }
        
        // 中间：参数信息（紧凑显示）
        const params = document.createElement('div');
        params.className = "flex items-center gap-2 text-[10px] text-gray-400 flex-shrink-0";
        
        const temp = document.createElement('span');
        temp.textContent = `T:${persona.temperature}`;
        
        const stream = document.createElement('span');
        stream.textContent = persona.stream ? '流式' : '非流式';
        
        params.appendChild(temp);
        params.appendChild(stream);
        
        // 右侧：操作按钮
        const actions = document.createElement('div');
        actions.className = "flex items-center gap-0.5 flex-shrink-0";
        
        // Edit Button - 更小的图标
        const editBtn = context.ui.createIconButton({
            icon: 'edit',
            title: '编辑',
            className: "p-1 hover:bg-gray-100 rounded text-gray-500",
            iconClassName: "material-symbols-outlined text-[16px]",
            onClick: () => {
                if (window.IdoFront.personaEditor && window.IdoFront.personaEditor.open) {
                    window.IdoFront.personaEditor.open(persona, context, store);
                }
            }
        });
        actions.appendChild(editBtn);

        // Export Button
        const exportBtn = context.ui.createIconButton({
            icon: 'download',
            title: '导出',
            className: "p-1 hover:bg-gray-100 rounded text-gray-500",
            iconClassName: "material-symbols-outlined text-[16px]",
            onClick: () => {
                try {
                    exportSinglePersona(persona);
                } catch (e) {
                    console.error(e);
                    alert('导出失败：' + (e && e.message ? e.message : '未知错误'));
                }
            }
        });
        actions.appendChild(exportBtn);
        
        // Delete Button
        if (!persona.isDefault) {
            const deleteBtn = context.ui.createIconButton({
                icon: 'delete',
                title: '删除',
                className: "p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-colors",
                iconClassName: "material-symbols-outlined text-[16px]",
                onClick: () => {
                    if (confirm(`确定要删除面具 "${persona.name}" 吗？相关的对话也将被删除。`)) {
                        const success = store.deletePersona(persona.id);
                        if (success) {
                            window.IdoFront.personaSettings.render(container, context, store);
                        }
                    }
                }
            });
            actions.appendChild(deleteBtn);
        }
        
        row.appendChild(leftSection);
        row.appendChild(params);
        row.appendChild(actions);
        item.appendChild(row);
        
        return item;
    }

    // ==================== Import / Export ====================

    function getTimestamp() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    }

    function safeFilename(name) {
        return String(name || 'persona')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 64) || 'persona';
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType || 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    function sanitizePersonaForExport(persona) {
        if (!persona || typeof persona !== 'object') return null;
        // 只导出面具本身，不导出对话数据
        return {
            id: persona.id,
            name: persona.name,
            description: persona.description || '',
            systemPrompt: persona.systemPrompt || '',
            temperature: typeof persona.temperature === 'number' ? persona.temperature : 0.7,
            topP: typeof persona.topP === 'number' ? persona.topP : 1.0,
            stream: persona.stream !== false,
            contextMessages: Array.isArray(persona.contextMessages) ? persona.contextMessages : [],
            streamConfig: Array.isArray(persona.streamConfig) ? persona.streamConfig : undefined,
            isDefault: !!persona.isDefault
        };
    }

    function exportSinglePersona(persona) {
        const payload = {
            _magic: PERSONA_MAGIC_SINGLE,
            _version: PERSONA_EXPORT_VERSION,
            _exportedAt: new Date().toISOString(),
            persona: sanitizePersonaForExport(persona)
        };

        if (!payload.persona || !payload.persona.name) {
            throw new Error('面具数据无效');
        }

        const json = JSON.stringify(payload, null, 2);
        const filename = `IdoFront_Persona_${safeFilename(payload.persona.name)}_${getTimestamp()}.json`;
        downloadFile(json, filename, 'application/json');
    }

    function exportAllPersonas() {
        const personas = Array.isArray(store?.state?.personas) ? store.state.personas : [];
        const payload = {
            _magic: PERSONA_MAGIC_MULTI,
            _version: PERSONA_EXPORT_VERSION,
            _exportedAt: new Date().toISOString(),
            personas: personas.map(sanitizePersonaForExport).filter(Boolean)
        };

        const json = JSON.stringify(payload, null, 2);
        const filename = `IdoFront_Personas_${getTimestamp()}.json`;
        downloadFile(json, filename, 'application/json');
    }

    function extractPersonasFromImportPayload(data) {
        if (!data) return [];

        // 1) IdoFront 面具导出文件（单个）
        if (data._magic === PERSONA_MAGIC_SINGLE) {
            if (data.persona && typeof data.persona === 'object') return [data.persona];
            return [];
        }

        // 2) IdoFront 面具导出文件（多个）
        if (data._magic === PERSONA_MAGIC_MULTI) {
            return Array.isArray(data.personas) ? data.personas : [];
        }

        // 3) IdoFront 全量备份文件：允许用户直接选备份文件，只导入其中的 personas
        if (data._magic === 'IdoFront_Backup') {
            return Array.isArray(data.personas) ? data.personas : [];
        }

        // 4) 宽松兼容：
        // - { personas: [...] }
        // - 直接数组
        // - 直接 persona 对象
        if (Array.isArray(data.personas)) {
            return data.personas;
        }
        if (Array.isArray(data)) {
            return data;
        }
        if (typeof data === 'object' && (data.name || data.systemPrompt || data.streamConfig)) {
            return [data];
        }

        return [];
    }

    function normalizeImportedPersona(raw) {
        const p = raw && typeof raw === 'object' ? raw : {};
        const id = (typeof p.id === 'string' && p.id.trim()) ? p.id.trim() : (utils?.createId ? utils.createId('persona') : `persona-${Date.now()}`);

        const name = (typeof p.name === 'string' && p.name.trim()) ? p.name.trim() : '未命名面具';

        const temperature = (typeof p.temperature === 'number' && isFinite(p.temperature)) ? p.temperature : 0.7;
        const topP = (typeof p.topP === 'number' && isFinite(p.topP)) ? p.topP : 1.0;
        const stream = p.stream !== false;

        const contextMessages = Array.isArray(p.contextMessages)
            ? p.contextMessages
                .filter(m => m && typeof m === 'object')
                .map(m => ({
                    role: m.role || m.type || 'user',
                    content: typeof m.content === 'string' ? m.content : ''
                }))
                .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
            : [];

        const normalized = {
            id,
            name,
            description: typeof p.description === 'string' ? p.description : '',
            systemPrompt: typeof p.systemPrompt === 'string' ? p.systemPrompt : '',
            temperature,
            topP,
            stream,
            contextMessages,
            // 导入时永远不允许设置为默认面具，避免破坏内置逻辑
            isDefault: false
        };

        if (Array.isArray(p.streamConfig)) {
            normalized.streamConfig = p.streamConfig.map(m => {
                if (!m || typeof m !== 'object') return null;
                const type = m.type || m.role || 'system';
                return {
                    type,
                    content: typeof m.content === 'string' ? m.content : '',
                    enabled: m.enabled !== false,
                    name: typeof m.name === 'string' ? m.name : ''
                };
            }).filter(Boolean);
        }

        // 兜底生成 streamConfig（让高级编辑器能直接打开）
        if (!normalized.streamConfig || normalized.streamConfig.length === 0) {
            normalized.streamConfig = [];
            normalized.streamConfig.push({ type: 'system', content: normalized.systemPrompt || '', enabled: true, name: '' });
            for (const m of contextMessages) {
                normalized.streamConfig.push({ type: m.role, content: m.content, enabled: true, name: '' });
            }
            normalized.streamConfig.push({ type: 'history', enabled: true, name: '' });
        } else {
            // 确保存在 history
            const hasHistory = normalized.streamConfig.some(m => m && m.type === 'history');
            if (!hasHistory) {
                normalized.streamConfig.push({ type: 'history', enabled: true, name: '' });
            }
            // 尽量保持 systemPrompt 与 streamConfig 一致
            const sys = normalized.streamConfig.find(m => m && m.type === 'system' && m.enabled !== false);
            if (sys && typeof sys.content === 'string') {
                normalized.systemPrompt = sys.content;
            }
        }

        return normalized;
    }

    function makeUniqueName(baseName) {
        const existingNames = new Set((store?.state?.personas || []).map(p => p && p.name).filter(Boolean));
        if (!existingNames.has(baseName)) return baseName;

        const n1 = `${baseName} (导入)`;
        if (!existingNames.has(n1)) return n1;

        let i = 2;
        while (existingNames.has(`${baseName} (导入${i})`)) i++;
        return `${baseName} (导入${i})`;
    }

    function applyImportedPersonas(personas) {
        if (!store || !store.state) throw new Error('Store 未初始化');
        if (!Array.isArray(store.state.personas)) store.state.personas = [];

        let imported = 0;
        let overwritten = 0;
        let duplicated = 0;

        const existingById = new Map(store.state.personas.map(p => [p.id, p]));
        const hasConflicts = personas.some(p => {
            const normalized = normalizeImportedPersona(p);
            return existingById.has(normalized.id);
        });

        // 对“重复 ID 是否覆盖”只问一次，避免连续弹窗
        let overwriteConflicts = null;
        if (hasConflicts) {
            overwriteConflicts = confirm('检测到导入面具有与现有面具相同的 ID，是否覆盖同 ID 面具？\n\n- 确定：覆盖\n- 取消：为重复面具自动生成新 ID');
        }

        for (const raw of personas) {
            const persona = normalizeImportedPersona(raw);

            // 永远不要使用默认 ID（避免“默认助手”被覆盖/被当作内置）
            if (persona.id === 'persona-default' || persona.isDefault) {
                persona.id = utils?.createId ? utils.createId('persona') : `persona-${Date.now()}`;
                persona.isDefault = false;
            }

            const existed = existingById.get(persona.id);
            if (existed) {
                // 默认面具不允许覆盖
                if (existed.isDefault) {
                    persona.id = utils?.createId ? utils.createId('persona') : `persona-${Date.now()}`;
                    persona.name = makeUniqueName(persona.name);
                    store.state.personas.push(persona);
                    existingById.set(persona.id, persona);
                    imported++;
                    duplicated++;
                    continue;
                }

                if (overwriteConflicts) {
                    const idx = store.state.personas.findIndex(p => p.id === persona.id);
                    if (idx !== -1) {
                        store.state.personas[idx] = persona;
                        existingById.set(persona.id, persona);
                        imported++;
                        overwritten++;
                    }
                } else {
                    persona.id = utils?.createId ? utils.createId('persona') : `persona-${Date.now()}`;
                    persona.name = makeUniqueName(persona.name);
                    store.state.personas.push(persona);
                    existingById.set(persona.id, persona);
                    imported++;
                    duplicated++;
                }
            } else {
                // 名称去重（可选，但可以减少用户困惑）
                if (store.state.personas.some(p => p && p.name === persona.name)) {
                    persona.name = makeUniqueName(persona.name);
                }

                store.state.personas.push(persona);
                existingById.set(persona.id, persona);
                imported++;
            }
        }

        // 兜底：确保 activePersonaId 合法
        if (!store.state.activePersonaId || !store.state.personas.some(p => p && p.id === store.state.activePersonaId)) {
            store.state.activePersonaId = store.state.personas[0]?.id || null;
        }

        return { imported, overwritten, duplicated };
    }

    async function handleImportPersonas(file, container) {
        try {
            const text = await readFileAsText(file);
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error('不是有效的 JSON 文件');
            }

            const personas = extractPersonasFromImportPayload(data);
            if (!personas || personas.length === 0) {
                throw new Error('文件中未找到可导入的面具数据');
            }

            const result = applyImportedPersonas(personas);

            // 持久化并刷新
            if (typeof store.persist === 'function') store.persist();
            if (typeof store.persistImmediately === 'function') store.persistImmediately();

            if (store.events) {
                if (typeof store.events.emitAsync === 'function') {
                    store.events.emitAsync('personas:updated', store.state.personas);
                } else if (typeof store.events.emit === 'function') {
                    store.events.emit('personas:updated', store.state.personas);
                }
            }

            window.IdoFront.personaSettings.render(container, context, store);

            const extra = [];
            if (result.overwritten) extra.push(`覆盖 ${result.overwritten} 个`);
            if (result.duplicated) extra.push(`重复 ID 自动新建 ${result.duplicated} 个`);

            alert(`导入完成：成功导入 ${result.imported} 个面具${extra.length ? `（${extra.join('，')}）` : ''}`);
        } catch (e) {
            console.error(e);
            alert('导入失败：' + (e && e.message ? e.message : '未知错误'));
        }
    }

})();