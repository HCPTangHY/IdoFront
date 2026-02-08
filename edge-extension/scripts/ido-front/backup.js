/**
 * Backup & Export Module
 * 数据备份、导出、导入功能
 *
 * 功能：
 * 1. exportAll() - 完整备份（JSON 格式，含所有对话、设置、附件）
 * 2. importAll(file) - 从备份文件恢复
 * 3. exportConversationAsMarkdown(convId) - 单对话导出为 Markdown
 * 4. exportConversationAsJSON(convId) - 单对话导出为 JSON
 */
(function () {
    window.IdoFront = window.IdoFront || {};

    const BACKUP_VERSION = 1;
    const BACKUP_MAGIC = 'IdoFront_Backup';

    // 导出保护阈值：避免超大字段（尤其 dataUrl / 运行时缓存）导致 JSON.stringify 崩溃
    const MAX_BACKUP_STRING_CHARS = 500000; // 约 500KB/字段
    const MAX_BACKUP_ARRAY_ITEMS = 5000;
    const MAX_BACKUP_DEPTH = 20;

    function isLikelyDataUrl(value) {
        return typeof value === 'string' && value.startsWith('data:') && value.includes(';base64,');
    }

    function truncateString(value, maxChars) {
        if (typeof value !== 'string') return '';
        if (value.length <= maxChars) return value;
        return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
    }

    function sanitizeAttachmentRef(att) {
        if (!att || typeof att !== 'object') return null;
        return {
            id: att.id,
            name: att.name,
            type: att.type,
            size: att.size,
            source: att.source
        };
    }

    function sanitizeValueForBackup(value, depth, seen) {
        if (value === null || value === undefined) return value;

        const t = typeof value;
        if (t === 'number' || t === 'boolean') return value;
        if (t === 'string') {
            if (isLikelyDataUrl(value)) {
                return `[omitted dataUrl, length=${value.length}]`;
            }
            return truncateString(value, MAX_BACKUP_STRING_CHARS);
        }
        if (t !== 'object') return undefined;

        if (depth >= MAX_BACKUP_DEPTH) {
            return '[omitted: max depth reached]';
        }

        if (seen.has(value)) {
            return '[omitted: circular reference]';
        }
        seen.add(value);

        if (Array.isArray(value)) {
            return value
                .slice(0, MAX_BACKUP_ARRAY_ITEMS)
                .map(item => sanitizeValueForBackup(item, depth + 1, seen))
                .filter(v => typeof v !== 'undefined');
        }

        const out = {};
        const keys = Object.keys(value).slice(0, MAX_BACKUP_ARRAY_ITEMS);
        for (const key of keys) {
            // runtime 临时字段，不进入备份
            if (key === 'thoughtAttachments') continue;
            if (key.startsWith('_')) continue;
            if (key === 'dataUrl' || key === 'blob' || key === 'file' || key === 'arrayBuffer' || key === 'objectUrl' || key === 'previewUrl') continue;

            const sanitized = sanitizeValueForBackup(value[key], depth + 1, seen);
            if (typeof sanitized !== 'undefined') {
                out[key] = sanitized;
            }
        }
        return out;
    }

    function sanitizeMessageForBackup(msg) {
        if (!msg || typeof msg !== 'object') return null;
        const out = {
            id: msg.id,
            role: msg.role,
            content: truncateString(typeof msg.content === 'string' ? msg.content : '', MAX_BACKUP_STRING_CHARS),
            createdAt: msg.createdAt,
            timestamp: msg.timestamp,
            parentId: msg.parentId
        };

        if (typeof msg.reasoning === 'string') {
            out.reasoning = truncateString(msg.reasoning, MAX_BACKUP_STRING_CHARS);
        }

        if (Array.isArray(msg.attachments)) {
            out.attachments = msg.attachments.map(sanitizeAttachmentRef).filter(Boolean);
        }

        if (msg.modelName) out.modelName = msg.modelName;
        if (msg.channelName) out.channelName = msg.channelName;
        if (msg.plugin) out.plugin = sanitizeValueForBackup(msg.plugin, 0, new WeakSet());
        if (msg.metadata) out.metadata = sanitizeValueForBackup(msg.metadata, 0, new WeakSet());
        if (msg.toolCalls) out.toolCalls = sanitizeValueForBackup(msg.toolCalls, 0, new WeakSet());
        if (msg.toolResults) out.toolResults = sanitizeValueForBackup(msg.toolResults, 0, new WeakSet());

        return out;
    }

    function sanitizeConversationForBackup(conv) {
        if (!conv || typeof conv !== 'object') return null;
        return {
            id: conv.id,
            title: conv.title,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            personaId: conv.personaId,
            selectedChannelId: conv.selectedChannelId,
            selectedModel: conv.selectedModel,
            streamOverride: conv.streamOverride,
            reasoningEffort: conv.reasoningEffort,
            activeBranchMap: sanitizeValueForBackup(conv.activeBranchMap || {}, 0, new WeakSet()),
            titleEditedByUser: !!conv.titleEditedByUser,
            titleGeneratedByAI: !!conv.titleGeneratedByAI,
            metadata: sanitizeValueForBackup(conv.metadata || null, 0, new WeakSet()),
            messages: Array.isArray(conv.messages) ? conv.messages.map(sanitizeMessageForBackup).filter(Boolean) : []
        };
    }

    function safeStringifyBackup(backupObject) {
        try {
            // 使用紧凑 JSON，避免 pretty-print 造成额外内存放大
            return JSON.stringify(backupObject);
        } catch (e) {
            if (e && e.name === 'RangeError') {
                throw new Error('备份数据体积过大（可能包含超长文本或异常字段），请先清理超大对话后重试。');
            }
            throw e;
        }
    }

    /**
     * 获取当前时间的格式化字符串（用于文件名）
     */
    function getTimestamp() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    }

    /**
     * 触发文件下载
     */
    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * 读取文件内容
     */
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    /**
     * 收集所有活跃的附件 ID
     */
    function collectAllAttachmentIds(state) {
        const ids = new Set();
        if (!state || !state.conversations) return ids;

        for (const conv of state.conversations) {
            if (!conv || !conv.messages) continue;
            for (const msg of conv.messages) {
                if (!msg || !msg.attachments) continue;
                for (const att of msg.attachments) {
                    if (att && att.id) {
                        ids.add(att.id);
                    }
                }
            }
        }
        return ids;
    }

    /**
     * 导出所有数据（完整备份）
     * 包含：对话、面具、渠道设置、插件状态、所有附件
     *
     * @param {Object} [options] - 选项
     * @param {boolean} [options.includeAttachments=true] - 是否包含附件（图片等）
     * @param {Function} [options.onProgress] - 进度回调 (current, total, message)
     * @returns {Promise<void>}
     */
    async function exportAll(options) {
        const opts = options || {};
        const includeAttachments = opts.includeAttachments !== false;
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

        const store = window.IdoFront.store;
        const attachmentsApi = window.IdoFront.attachments;

        if (!store || !store.state) {
            throw new Error('Store 未初始化');
        }

        // 1. 构建基础备份数据
        const sanitizedConversations = Array.isArray(store.state.conversations)
            ? store.state.conversations.map(sanitizeConversationForBackup).filter(Boolean)
            : [];

        const backup = {
            _magic: BACKUP_MAGIC,
            _version: BACKUP_VERSION,
            _exportedAt: new Date().toISOString(),
            _stats: {
                conversationCount: sanitizedConversations.length,
                personaCount: store.state.personas?.length || 0,
                channelCount: store.state.channels?.length || 0
            },
            // 核心数据（均做过清洗，避免运行时脏字段造成导出崩溃）
            personas: sanitizeValueForBackup(store.state.personas || [], 0, new WeakSet()),
            activePersonaId: store.state.activePersonaId,
            personaLastActiveConversationIdMap: sanitizeValueForBackup(store.state.personaLastActiveConversationIdMap || {}, 0, new WeakSet()),
            conversations: sanitizedConversations,
            activeConversationId: store.state.activeConversationId,
            channels: sanitizeValueForBackup(store.state.channels || [], 0, new WeakSet()),
            pluginStates: sanitizeValueForBackup(store.state.pluginStates || {}, 0, new WeakSet()),
            settings: sanitizeValueForBackup(store.state.settings || {}, 0, new WeakSet()),
            // 附件数据（稍后填充）
            attachments: {}
        };

        // 2. 导出附件
        if (includeAttachments && attachmentsApi) {
            const attachmentIds = collectAllAttachmentIds(store.state);
            const total = attachmentIds.size;
            let current = 0;

            if (onProgress && total > 0) {
                onProgress(0, total, '正在导出附件...');
            }

            for (const id of attachmentIds) {
                try {
                    const dataUrl = await attachmentsApi.getDataUrl(id);
                    if (dataUrl) {
                        backup.attachments[id] = dataUrl;
                    }
                } catch (e) {
                    console.warn(`[backup] Failed to export attachment ${id}:`, e);
                }
                current++;
                if (onProgress) {
                    onProgress(current, total, `正在导出附件 (${current}/${total})...`);
                }
            }

            backup._stats.attachmentCount = Object.keys(backup.attachments).length;
        }

        // 3. 序列化并下载
        const json = safeStringifyBackup(backup);
        const filename = `IdoFront_Backup_${getTimestamp()}.json`;
        downloadFile(json, filename, 'application/json');

        console.log(`[backup] Exported: ${backup._stats.conversationCount} conversations, ${backup._stats.attachmentCount || 0} attachments`);

        return backup._stats;
    }

    /**
     * 从备份文件导入数据
     *
     * @param {File} file - 备份文件
     * @param {Object} [options] - 选项
     * @param {boolean} [options.merge=false] - 是否合并（true=合并，false=覆盖）
     * @param {Function} [options.onProgress] - 进度回调
     * @returns {Promise<Object>} 导入统计
     */
    async function importAll(file, options) {
        const opts = options || {};
        const merge = opts.merge === true;
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

        const store = window.IdoFront.store;
        const attachmentsApi = window.IdoFront.attachments;
        const storage = window.IdoFront.storage;

        if (!store || !store.state) {
            throw new Error('Store 未初始化');
        }

        // 1. 读取并解析文件
        if (onProgress) onProgress(0, 100, '正在读取文件...');

        const content = await readFileAsText(file);
        let backup;
        try {
            backup = JSON.parse(content);
        } catch (e) {
            throw new Error('无效的备份文件格式');
        }

        // 2. 验证备份文件
        if (backup._magic !== BACKUP_MAGIC) {
            throw new Error('不是有效的 IdoFront 备份文件');
        }

        if (backup._version > BACKUP_VERSION) {
            throw new Error(`备份文件版本过高 (v${backup._version})，请升级应用后重试`);
        }

        if (onProgress) onProgress(10, 100, '正在验证数据...');

        // 3. 导入附件
        let attachmentImported = 0;
        if (backup.attachments && attachmentsApi && storage) {
            const attachmentEntries = Object.entries(backup.attachments);
            const total = attachmentEntries.length;

            for (let i = 0; i < attachmentEntries.length; i++) {
                const [id, dataUrl] = attachmentEntries[i];
                try {
                    // 直接存储 dataUrl（attachments 模块会自动转换为 Blob）
                    await storage.setPluginData(attachmentsApi.PLUGIN_ID, id, dataUrl);
                    attachmentImported++;
                } catch (e) {
                    console.warn(`[backup] Failed to import attachment ${id}:`, e);
                }

                if (onProgress) {
                    const progress = 10 + Math.floor((i / total) * 60);
                    onProgress(progress, 100, `正在导入附件 (${i + 1}/${total})...`);
                }
            }
        }

        if (onProgress) onProgress(70, 100, '正在恢复数据...');

        // 4. 恢复 state 数据
        if (merge) {
            // 合并模式：追加对话和面具，不覆盖现有数据
            const existingConvIds = new Set(store.state.conversations.map(c => c.id));
            const existingPersonaIds = new Set(store.state.personas.map(p => p.id));

            // 追加不存在的对话
            for (const conv of (backup.conversations || [])) {
                if (!existingConvIds.has(conv.id)) {
                    store.state.conversations.push(conv);
                }
            }

            // 追加不存在的面具
            for (const persona of (backup.personas || [])) {
                if (!existingPersonaIds.has(persona.id)) {
                    store.state.personas.push(persona);
                }
            }

            // 追加不存在的渠道
            const existingChannelIds = new Set(store.state.channels.map(c => c.id));
            for (const channel of (backup.channels || [])) {
                if (!existingChannelIds.has(channel.id)) {
                    store.state.channels.push(channel);
                }
            }

            // 合并“面具上次活跃会话”映射（可选字段）
            if (backup.personaLastActiveConversationIdMap && typeof backup.personaLastActiveConversationIdMap === 'object') {
                if (!store.state.personaLastActiveConversationIdMap || typeof store.state.personaLastActiveConversationIdMap !== 'object') {
                    store.state.personaLastActiveConversationIdMap = {};
                }
                Object.assign(store.state.personaLastActiveConversationIdMap, backup.personaLastActiveConversationIdMap);
            }
        } else {
            // 覆盖模式：完全替换
            if (backup.personas) store.state.personas = backup.personas;
            if (backup.activePersonaId) store.state.activePersonaId = backup.activePersonaId;
            if (backup.personaLastActiveConversationIdMap && typeof backup.personaLastActiveConversationIdMap === 'object') {
                store.state.personaLastActiveConversationIdMap = backup.personaLastActiveConversationIdMap;
            }
            if (backup.conversations) store.state.conversations = backup.conversations;
            if (backup.activeConversationId) store.state.activeConversationId = backup.activeConversationId;
            if (backup.channels) store.state.channels = backup.channels;
            if (backup.pluginStates) store.state.pluginStates = backup.pluginStates;
            if (backup.settings) store.state.settings = { ...store.state.settings, ...backup.settings };
        }

        if (onProgress) onProgress(90, 100, '正在保存...');

        // 5. 持久化并刷新 UI
        store.persistImmediately();

        if (onProgress) onProgress(100, 100, '导入完成');

        const stats = {
            conversationsImported: backup.conversations?.length || 0,
            personasImported: backup.personas?.length || 0,
            attachmentsImported: attachmentImported,
            mode: merge ? 'merge' : 'overwrite'
        };

        console.log('[backup] Import complete:', stats);

        return stats;
    }

    /**
     * 导出单个对话为 Markdown
     * 只导出当前活跃路径（忽略其他分支）
     *
     * @param {string} [convId] - 对话 ID，不传则使用当前活跃对话
     * @param {Object} [options] - 选项
     * @param {boolean} [options.includeMetadata=true] - 是否包含元信息（时间、模型等）
     * @param {boolean} [options.includeImages=false] - 是否包含图片（base64 内嵌）
     * @returns {Promise<void>}
     */
    async function exportConversationAsMarkdown(convId, options) {
        const opts = options || {};
        const includeMetadata = opts.includeMetadata !== false;
        const includeImages = opts.includeImages === true;

        const store = window.IdoFront.store;
        const attachmentsApi = window.IdoFront.attachments;

        if (!store || !store.state) {
            throw new Error('Store 未初始化');
        }

        const targetId = convId || store.state.activeConversationId;
        const conv = store.state.conversations.find(c => c.id === targetId);
        if (!conv) {
            throw new Error('对话不存在');
        }

        // 获取活跃路径
        const activePath = store.getActivePath(targetId);
        if (activePath.length === 0) {
            throw new Error('对话为空');
        }

        // 构建 Markdown
        const lines = [];

        // 标题
        lines.push(`# ${conv.title || '对话'}`);
        lines.push('');

        // 元信息
        if (includeMetadata) {
            lines.push(`> 导出时间: ${new Date().toLocaleString()}`);
            lines.push(`> 消息数量: ${activePath.length}`);
            if (conv.selectedModel) {
                lines.push(`> 模型: ${conv.selectedModel}`);
            }
            lines.push('');
            lines.push('---');
            lines.push('');
        }

        // 消息内容
        for (const msg of activePath) {
            const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
            const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';

            lines.push(`## ${role}`);
            if (includeMetadata && time) {
                lines.push(`*${time}*`);
            }
            lines.push('');

            // 处理附件
            if (msg.attachments && msg.attachments.length > 0) {
                for (const att of msg.attachments) {
                    if (att.type && att.type.startsWith('image/')) {
                        if (includeImages && attachmentsApi) {
                            try {
                                const dataUrl = await attachmentsApi.getDataUrl(att.id);
                                if (dataUrl) {
                                    lines.push(`![${att.name || 'image'}](${dataUrl})`);
                                    lines.push('');
                                }
                            } catch (e) {
                                lines.push(`*[图片: ${att.name || att.id}]*`);
                                lines.push('');
                            }
                        } else {
                            lines.push(`*[图片: ${att.name || att.id}]*`);
                            lines.push('');
                        }
                    } else {
                        lines.push(`*[附件: ${att.name || att.id}]*`);
                        lines.push('');
                    }
                }
            }

            // 消息正文
            lines.push(msg.content || '');
            lines.push('');
            lines.push('---');
            lines.push('');
        }

        // 下载
        const markdown = lines.join('\n');
        const safeTitle = (conv.title || 'conversation').replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
        const filename = `${safeTitle}_${getTimestamp()}.md`;
        downloadFile(markdown, filename, 'text/markdown; charset=utf-8');

        console.log(`[backup] Exported conversation as Markdown: ${activePath.length} messages`);
    }

    /**
     * 导出单个对话为 JSON（含附件）
     *
     * @param {string} [convId] - 对话 ID
     * @param {Object} [options] - 选项
     * @param {boolean} [options.includeAttachments=true] - 是否包含附件
     * @param {boolean} [options.activePathOnly=false] - 是否只导出活跃路径
     * @returns {Promise<void>}
     */
    async function exportConversationAsJSON(convId, options) {
        const opts = options || {};
        const includeAttachments = opts.includeAttachments !== false;
        const activePathOnly = opts.activePathOnly === true;

        const store = window.IdoFront.store;
        const attachmentsApi = window.IdoFront.attachments;

        if (!store || !store.state) {
            throw new Error('Store 未初始化');
        }

        const targetId = convId || store.state.activeConversationId;
        const conv = store.state.conversations.find(c => c.id === targetId);
        if (!conv) {
            throw new Error('对话不存在');
        }

        // 决定导出哪些消息
        let messages;
        if (activePathOnly) {
            messages = store.getActivePath(targetId);
        } else {
            messages = conv.messages || [];
        }

        // 构建导出数据
        const exportData = {
            _magic: BACKUP_MAGIC,
            _version: BACKUP_VERSION,
            _type: 'conversation',
            _exportedAt: new Date().toISOString(),
            conversation: {
                ...conv,
                messages: messages
            },
            attachments: {}
        };

        // 导出附件
        if (includeAttachments && attachmentsApi) {
            for (const msg of messages) {
                if (!msg.attachments) continue;
                for (const att of msg.attachments) {
                    if (att.id && !exportData.attachments[att.id]) {
                        try {
                            const dataUrl = await attachmentsApi.getDataUrl(att.id);
                            if (dataUrl) {
                                exportData.attachments[att.id] = dataUrl;
                            }
                        } catch (e) {
                            console.warn(`[backup] Failed to export attachment ${att.id}:`, e);
                        }
                    }
                }
            }
        }

        // 下载
        const json = JSON.stringify(exportData, null, 2);
        const safeTitle = (conv.title || 'conversation').replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
        const filename = `${safeTitle}_${getTimestamp()}.json`;
        downloadFile(json, filename, 'application/json');

        console.log(`[backup] Exported conversation as JSON: ${messages.length} messages, ${Object.keys(exportData.attachments).length} attachments`);
    }

    /**
     * 导入单个对话
     *
     * @param {File} file - JSON 文件
     * @returns {Promise<Object>} 导入的对话对象
     */
    async function importConversation(file) {
        const store = window.IdoFront.store;
        const attachmentsApi = window.IdoFront.attachments;
        const storage = window.IdoFront.storage;

        if (!store || !store.state) {
            throw new Error('Store 未初始化');
        }

        const content = await readFileAsText(file);
        let data;
        try {
            data = JSON.parse(content);
        } catch (e) {
            throw new Error('无效的 JSON 文件');
        }

        if (data._magic !== BACKUP_MAGIC || data._type !== 'conversation') {
            throw new Error('不是有效的对话导出文件');
        }

        const conv = data.conversation;
        if (!conv || !conv.id) {
            throw new Error('对话数据无效');
        }

        // 导入附件
        if (data.attachments && storage && attachmentsApi) {
            for (const [id, dataUrl] of Object.entries(data.attachments)) {
                try {
                    await storage.setPluginData(attachmentsApi.PLUGIN_ID, id, dataUrl);
                } catch (e) {
                    console.warn(`[backup] Failed to import attachment ${id}:`, e);
                }
            }
        }

        // 检查是否已存在同 ID 的对话
        const existingIndex = store.state.conversations.findIndex(c => c.id === conv.id);
        if (existingIndex !== -1) {
            // 生成新 ID 避免冲突
            const utils = window.IdoFront.utils;
            const oldId = conv.id;
            conv.id = utils ? utils.createId('conv') : `conv-${Date.now()}`;

            // 更新消息中的引用（如果有 activeBranchMap）
            if (conv.activeBranchMap && conv.activeBranchMap[oldId]) {
                conv.activeBranchMap[conv.id] = conv.activeBranchMap[oldId];
                delete conv.activeBranchMap[oldId];
            }
        }

        // 绑定到当前面具
        conv.personaId = store.state.activePersonaId;

        // 添加到对话列表
        store.state.conversations.unshift(conv);
        store.state.activeConversationId = conv.id;
        store.persistImmediately();

        console.log(`[backup] Imported conversation: ${conv.title}`);

        return conv;
    }

    /**
     * 获取备份信息（不下载，只返回统计）
     */
    function getBackupStats() {
        const store = window.IdoFront.store;
        if (!store || !store.state) return null;

        const attachmentIds = collectAllAttachmentIds(store.state);

        return {
            conversationCount: store.state.conversations?.length || 0,
            personaCount: store.state.personas?.length || 0,
            channelCount: store.state.channels?.length || 0,
            attachmentCount: attachmentIds.size,
            messageCount: store.state.conversations?.reduce((sum, c) => sum + (c.messages?.length || 0), 0) || 0
        };
    }

    /**
     * 清除所有数据
     */
    async function clear() {
        if (!store || !store.state) {
            throw new Error('Store 未初始化');
        }

        // 1. 清除核心数据
        store.state.conversations = [];
        store.state.activeConversationId = null;
        store.state.personaLastActiveConversationIdMap = {};
        store.state.logs = [];
        store.state.networkLogs = [];

        // 2. 重置渠道和面具到默认状态
        store.initDefaultChannels();
        store.initDefaultPersona();

        // 3. 强制持久化
        store.persistImmediately();

        // 4. 清除 IndexedDB 中的附件
        const attachmentsApi = window.IdoFront.attachments;
        if (attachmentsApi && typeof attachmentsApi.gc === 'function') {
            await attachmentsApi.gc(new Set()); // 空 Set 代表清除所有附件
        }

        console.log('[backup] Storage cleared');
    }

    // 暴露 API
    window.IdoFront.backup = {
        exportAll,
        importAll,
        exportConversationAsMarkdown,
        exportConversationAsJSON,
        importConversation,
        getBackupStats,
        clear,
        BACKUP_VERSION
    };

})();
