/**
 * IdoFront Store
 * Manages state and persistence
 *
 * 消息分支（Branching）数据结构说明：
 * - 每条消息有 parentId 字段，指向其父消息（第一条消息 parentId 为 null）
 * - 同一个 parentId 下的多条消息构成"兄弟节点"，即分支
 * - conversation.activeBranchMap 记录每个分支点选中的消息 ID
 *   格式: { [parentId]: selectedChildId }
 * - getActivePath() 方法根据 activeBranchMap 计算当前活跃路径
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const STORAGE_KEY = 'core.chat.state';

    window.IdoFront.store = {
        
        _initialized: false,
        _initPromise: null,
        // 持久化节流状态
        _lastPersistAt: 0,
        _persistTimer: null,
        _pendingSnapshot: null,
        _hasPendingWrite: false, // 标记是否有待写入的数据
        _backgroundSaveTimer: null, // 后台保存定时器
        // 活跃路径缓存
        _activePathCache: {},
        
        state: {
            personas: [], // 面具列表
            activePersonaId: null, // 当前激活的面具ID
            conversations: [],
            activeConversationId: null,
            inputText: '',
            logs: [],
            networkLogs: [], // 网络日志
            isTyping: false,
            channels: [],
            pluginStates: {}, // Format: "slot::id": boolean
            settings: {
                autoGenerateTitle: true  // AI 自动生成对话标题
            }
        },

        // 统一状态源事件总线：所有对外的状态变更都通过 Store 自己发出
        events: {
            listeners: {},
            on(event, callback) {
                if (!this.listeners[event]) this.listeners[event] = [];
                this.listeners[event].push(callback);
            },
            off(event, callback) {
                if (!this.listeners[event]) return;
                this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
            },
            emit(event, payload) {
                if (!this.listeners[event]) return;
                this.listeners[event].forEach(cb => {
                    try {
                        cb(payload);
                    } catch (e) {
                        console.error('Store event handler error:', event, e);
                    }
                });
            },
            /**
             * 异步派发事件：将每个回调放入微任务队列，避免阻塞主线程
             * 不合并/不丢弃事件，仅异步化回调执行。
             */
            emitAsync(event, payload) {
                if (!this.listeners[event]) return;
                const handlers = this.listeners[event].slice(); // 防止回调修改监听数组
                for (const cb of handlers) {
                    Promise.resolve().then(() => {
                        try {
                            cb(payload);
                        } catch (e) {
                            console.error('Store event handler error:', event, e);
                        }
                    });
                }
            }
        },

        async init() {
            if (this._initPromise) return this._initPromise;

            this._initPromise = (async () => {
                await this.restore();

                // 附件外置化迁移：把历史消息中的 base64 dataUrl 挪到 pluginData (Blob) 存储，
                // 避免 core.chat.state 写入 IndexedDB 时发生秒级 structured clone 卡顿。
                await this.migrateAttachmentsToBlobStorage();

                this.state.networkLogs = [];
                if (this.state.conversations.length === 0) {
                    this.createConversationInternal('新对话');
                }
                if (!this.state.channels || this.state.channels.length === 0) {
                    this.initDefaultChannels();
                }
                if (!this.state.personas || this.state.personas.length === 0) {
                    this.initDefaultPersona();
                }
                // Migration: Ensure all conversations have a personaId
                this.migrateConversations();

                // Final validation to ensure state consistency
                this.validateIntegrity();

                // 注册页面关闭时的数据保存
                this._registerBeforeUnload();

                this._initialized = true;
            })();

            return this._initPromise;
        },

        /**
         * 注册 beforeunload 事件，确保页面关闭前保存数据
         */
        _registerBeforeUnload() {
            window.addEventListener('beforeunload', () => {
                if (this._hasPendingWrite) {
                    this.persistImmediately();
                }
            });
            // visibilitychange 作为补充（移动端/标签页切换）
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden' && this._hasPendingWrite) {
                    this.persistImmediately();
                }
            });
        },

        validateIntegrity() {
            let updated = false;
            
            // 1. Ensure Personas List is Valid
            if (!Array.isArray(this.state.personas) || this.state.personas.length === 0) {
                this.initDefaultPersona(); // This saves internally, so we can return
                return;
            }

            // 2. Ensure Active Persona Exists
            const activePersonaExists = this.state.personas.some(p => p.id === this.state.activePersonaId);
            if (!this.state.activePersonaId || !activePersonaExists) {
                console.warn('Active persona invalid or missing, resetting to default');
                this.state.activePersonaId = this.state.personas[0].id;
                updated = true;
            }

            // 3. Ensure Active Conversation Belongs to Active Persona
            if (this.state.activeConversationId) {
                const activeConv = this.state.conversations.find(c => c.id === this.state.activeConversationId);
                if (activeConv && activeConv.personaId !== this.state.activePersonaId) {
                    // Try to find a valid conversation for current persona
                    const validConv = this.state.conversations.find(c => c.personaId === this.state.activePersonaId);
                    this.state.activeConversationId = validConv ? validConv.id : null;
                    updated = true;
                }
            }

            if (updated) this.persist();
        },

        initDefaultPersona() {
            const defaultPersona = {
                id: 'persona-default',
                name: '默认助手',
                description: '默认助手设置',
                systemPrompt: '',
                temperature: 0.7,
                topP: 1.0,
                stream: true,
                contextMessages: [], // 伪造对话/预设对话
                isDefault: true
            };
            this.state.personas = [defaultPersona];
            this.state.activePersonaId = defaultPersona.id;
            this.persist();
        },

        migrateConversations() {
            let updated = false;
            const defaultPersonaId = this.state.personas[0]?.id || 'persona-default';
            
            this.state.conversations.forEach(conv => {
                if (!conv.personaId) {
                    conv.personaId = defaultPersonaId;
                    updated = true;
                }
                
                // 迁移消息到树形结构（兼容旧版本数据）
                if (conv.messages && conv.messages.length > 0) {
                    const needsTreeMigration = conv.messages.some(m => m.parentId === undefined);
                    if (needsTreeMigration) {
                        this.migrateMessagesToTree(conv.id);
                        updated = true;
                    }
                }
            });
            
            // Ensure activePersonaId is set if missing
            if (!this.state.activePersonaId && this.state.personas.length > 0) {
                this.state.activePersonaId = this.state.personas[0].id;
                updated = true;
            }

            // Ensure active conversation belongs to active persona
            if (this.state.activeConversationId && this.state.activePersonaId) {
                const activeConv = this.state.conversations.find(c => c.id === this.state.activeConversationId);
                if (activeConv && activeConv.personaId !== this.state.activePersonaId) {
                    // Current conversation doesn't belong to active persona
                    // Find the most recent conversation for the active persona
                    const personaConvs = this.state.conversations.filter(c => c.personaId === this.state.activePersonaId);
                    if (personaConvs.length > 0) {
                        this.state.activeConversationId = personaConvs[0].id;
                        updated = true;
                    } else {
                        // No conversations for this persona, clear active conversation
                        this.state.activeConversationId = null;
                        updated = true;
                    }
                }
            }

            if (updated) this.persist();
        },

        /**
         * 附件外置化迁移：
         * - 将历史消息中的 attachments（尤其是 base64 dataUrl）迁移到 IndexedDB pluginData（Blob）
         * - 消息里仅保留轻量引用：{ id, name, type, size, source }
         *
         * 迁移后会调用 persistSilent() 标记脏数据（写入将由后台/关键时刻触发）。
         */
        async migrateAttachmentsToBlobStorage() {
            const attachmentsApi = window.IdoFront && window.IdoFront.attachments;
            if (!attachmentsApi || typeof attachmentsApi.normalizeAttachmentsForState !== 'function') {
                return;
            }

            if (!Array.isArray(this.state.conversations) || this.state.conversations.length === 0) {
                return;
            }

            let hasChanges = false;
            let migratedMsgCount = 0;
            let migratedAttachmentCount = 0;

            for (const conv of this.state.conversations) {
                if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) continue;

                for (const msg of conv.messages) {
                    if (!msg) continue;

                    // 兼容：优先读 msg.attachments，否则从 msg.metadata.attachments 迁移
                    const directAttachments = Array.isArray(msg.attachments) ? msg.attachments : null;
                    const metaAttachments = msg.metadata && Array.isArray(msg.metadata.attachments)
                        ? msg.metadata.attachments
                        : null;

                    const fromMeta = (!directAttachments || directAttachments.length === 0)
                        && metaAttachments
                        && metaAttachments.length > 0;

                    const rawAttachments = (directAttachments && directAttachments.length > 0)
                        ? directAttachments
                        : (fromMeta ? metaAttachments : null);

                    if (!rawAttachments || rawAttachments.length === 0) {
                        continue;
                    }

                    // 判断是否存在需要迁移/剥离的大字段
                    const needsStrip = rawAttachments.some(a => a && (a.dataUrl || a.file));
                    const needsId = rawAttachments.some(a => a && !a.id);

                    if (!needsStrip && !needsId && !fromMeta) {
                        // 已经是轻量引用，无需处理
                        continue;
                    }

                    let normalized = [];
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        const result = await attachmentsApi.normalizeAttachmentsForState(rawAttachments, {
                            source: msg.role === 'assistant' ? 'assistant' : 'user'
                        });
                        normalized = result && Array.isArray(result.attachments) ? result.attachments : [];
                    } catch (e) {
                        console.warn('[store] migrateAttachmentsToBlobStorage failed:', e);
                        // 保底：不影响启动流程
                        continue;
                    }

                    if (normalized.length > 0) {
                        msg.attachments = normalized;
                    } else {
                        delete msg.attachments;
                    }

                    // 移除旧字段，避免重复/继续持久化大对象
                    if (msg.metadata && msg.metadata.attachments) {
                        delete msg.metadata.attachments;
                    }

                    hasChanges = true;
                    migratedMsgCount += 1;
                    migratedAttachmentCount += normalized.length;
                }
            }

            if (hasChanges) {
                console.log(
                    `[store] migrateAttachmentsToBlobStorage: migrated ${migratedAttachmentCount} attachments in ${migratedMsgCount} messages.`
                );
                // 仅标记脏数据，不阻塞初始化流程
                this.persistSilent();
            }
        },

        initDefaultChannels() {
            this.state.channels = [
                { id: 'openai', name: 'OpenAI', type: 'openai', enabled: true },
                { id: 'gemini', name: 'Gemini', type: 'gemini', enabled: true },
                { id: 'claude', name: 'Claude', type: 'claude', enabled: true }
            ];
            this.persist();
        },

        /**
         * 构建持久化快照（内部方法，避免重复代码）
         */
        _buildSnapshot() {
            const MAX_LOGS = 200;
            return {
                personas: this.state.personas,
                activePersonaId: this.state.activePersonaId,
                conversations: this.state.conversations,
                activeConversationId: this.state.activeConversationId,
                logs: Array.isArray(this.state.logs) ? this.state.logs.slice(0, MAX_LOGS) : [],
                channels: this.state.channels,
                pluginStates: this.state.pluginStates,
                settings: this.state.settings
            };
        },

        /**
         * 执行保存操作（内部方法）
         *
         * 性能优化：在扩展环境下 IndexedDB 写入会阻塞主线程（约 2.5 秒），
         * 因此普通 persist 只标记脏数据，不实际写入。
         * 实际写入只在 persistImmediately() 中触发（页面关闭/发送消息等关键时刻）。
         */
        _doSave(snap) {
            // 不实际写入，只更新待保存快照
            // 实际写入由 persistImmediately() 在关键时刻触发
            this._pendingSnapshot = snap;
            this._hasPendingWrite = true;
        },

        /**
         * 真正执行 IndexedDB 写入（内部方法）
         */
        _doSaveToIDB(snap) {
            if (window.IdoFront.idbStorage) {
                return window.IdoFront.idbStorage.save(snap);
            }
            return Promise.resolve();
        },

        /**
         * 静默持久化：只标记脏数据，不实际写入，不广播事件
         * 用于分支切换等高频场景，避免阻塞主线程
         *
         * 实际写入时机：
         * - 页面关闭/隐藏时 (beforeunload/visibilitychange)
         * - 30 秒后台静默保存
         */
        persistSilent() {
            const snapshot = this._buildSnapshot();
            this._pendingSnapshot = snapshot;
            this._hasPendingWrite = true;
            // 触发 30 秒后台保存
            this.persistInBackground();
            // 不触发事件
        },

        persist() {
            const snapshot = this._buildSnapshot();
            this._pendingSnapshot = snapshot;
            this._hasPendingWrite = true;
            // 触发 30 秒后台保存
            this.persistInBackground();

            // 通知所有订阅者：状态已更新（单一数据源）
            if (this.events) {
                if (typeof this.events.emitAsync === 'function') {
                    this.events.emitAsync('updated', this.state);
                } else if (typeof this.events.emit === 'function') {
                    this.events.emit('updated', this.state);
                }
            }
        },

        /**
         * 强制立即保存（用于页面关闭、发送消息等关键时刻）
         * 直接写入 IndexedDB
         */
        persistImmediately() {
            if (this._persistTimer) {
                clearTimeout(this._persistTimer);
                this._persistTimer = null;
            }
            const snapshot = this._pendingSnapshot || this._buildSnapshot();
            this._pendingSnapshot = null;
            this._hasPendingWrite = false;

            // 直接写入 IndexedDB（关键时刻必须保存）
            this._doSaveToIDB(snapshot).catch(e => {
                console.error('persistImmediately: IndexedDB 保存失败', e);
            });
        },

        /**
         * 后台静默保存（用于非关键时刻，如用户空闲一段时间后）
         * 使用较长延迟，避免打断用户操作
         */
        persistInBackground() {
            if (this._backgroundSaveTimer) return;

            this._backgroundSaveTimer = setTimeout(() => {
                this._backgroundSaveTimer = null;
                if (this._hasPendingWrite) {
                    const snapshot = this._pendingSnapshot || this._buildSnapshot();
                    this._pendingSnapshot = null;
                    this._hasPendingWrite = false;
                    this._doSaveToIDB(snapshot).catch(e => {
                        console.warn('后台保存失败:', e);
                    });
                }
            }, 30000); // 30 秒后保存
        },

        async restore() {
            try {
                let snapshot = null;
                
                // 优先从 IndexedDB 加载
                if (window.IdoFront.idbStorage) {
                    try {
                        snapshot = await window.IdoFront.idbStorage.load();
                    } catch (error) {
                        console.warn('IndexedDB 加载失败，尝试 localStorage:', error);
                    }
                }
                
                // 降级到 localStorage
                if (!snapshot) {
                    const item = localStorage.getItem(STORAGE_KEY);
                    snapshot = item ? JSON.parse(item) : null;
                }
                
                if (snapshot) {
                    if (Array.isArray(snapshot.conversations)) {
                        this.state.conversations = snapshot.conversations;
                    }
                    if (Array.isArray(snapshot.personas)) {
                        this.state.personas = snapshot.personas;
                    }
                    this.state.activePersonaId = snapshot.activePersonaId || null;
                    this.state.activeConversationId = snapshot.activeConversationId || null;
                    if (Array.isArray(snapshot.logs)) {
                        this.state.logs = snapshot.logs;
                    }
                    if (Array.isArray(snapshot.channels)) {
                        this.state.channels = snapshot.channels;
                    }
                    if (snapshot.pluginStates) {
                        this.state.pluginStates = snapshot.pluginStates;
                    }
                    if (snapshot.settings) {
                        this.state.settings = { ...this.state.settings, ...snapshot.settings };
                    }
                }
            } catch (e) {
                console.error('Storage load error:', e);
            }
        },

        // --- Core State Mutators ---

        createConversationInternal(title) {
            const now = Date.now();
            
            // 获取当前活动对话的模型设置
            const activeConv = this.getActiveConversation();
            const channelId = activeConv?.selectedChannelId || null;
            const model = activeConv?.selectedModel || null;

            // 获取当前激活面具以继承默认流式和思考预算设置
            const activePersona = this.state.personas.find(p => p.id === this.state.activePersonaId);
            const defaultStream = activePersona ? activePersona.stream !== false : true;
            const defaultReasoningEffort = 'medium';
            
            const conversation = {
                id: window.IdoFront.utils.createId('conv'),
                title: title || '新对话',
                createdAt: now,
                updatedAt: now,
                messages: [],
                selectedChannelId: channelId, // 沿用当前对话的渠道
                selectedModel: model, // 沿用当前对话的模型
                personaId: this.state.activePersonaId, // 绑定当前面具
                // 会话级别的流式开关（优先于面具），以及思考预算
                streamOverride: defaultStream,
                reasoningEffort: defaultReasoningEffort
            };
            this.state.conversations.unshift(conversation);
            if (!this.state.activeConversationId) {
                this.state.activeConversationId = conversation.id;
            }
            this.persist();
            return conversation;
        },

        getActiveConversation() {
            if (this.state.activeConversationId) {
                return this.state.conversations.find(c => c.id === this.state.activeConversationId);
            }
            return null;
        },

        getActivePersona() {
            if (this.state.activePersonaId) {
                return this.state.personas.find(p => p.id === this.state.activePersonaId);
            }
            return this.state.personas[0] || null;
        },

        /**
         * 获取当前活跃对话使用的渠道配置
         * @returns {Object|null} 渠道配置对象
         */
        getActiveChannel() {
            const conv = this.getActiveConversation();
            if (!conv || !conv.selectedChannelId) return null;
            return this.state.channels.find(c => c.id === conv.selectedChannelId) || null;
        },

        setActivePersona(id) {
            const persona = this.state.personas.find(p => p.id === id);
            if (persona) {
                this.state.activePersonaId = id;
                
                // Switch to the most recent conversation for this persona
                const personaConvs = this.state.conversations.filter(c => c.personaId === id);
                if (personaConvs.length > 0) {
                    this.state.activeConversationId = personaConvs[0].id;
                } else {
                    this.state.activeConversationId = null; // Will trigger creation of new one if needed
                }
                
                this.persist();
                if (this.events) {
                    if (typeof this.events.emitAsync === 'function') {
                        this.events.emitAsync('persona:changed', id);
                    } else if (typeof this.events.emit === 'function') {
                        this.events.emit('persona:changed', id);
                    }
                }
            }
        },

        savePersona(persona) {
            const index = this.state.personas.findIndex(p => p.id === persona.id);
            if (index !== -1) {
                this.state.personas[index] = persona;
            } else {
                this.state.personas.push(persona);
            }
            this.persist();
            if (this.events) {
                if (typeof this.events.emitAsync === 'function') {
                    this.events.emitAsync('personas:updated', this.state.personas);
                } else if (typeof this.events.emit === 'function') {
                    this.events.emit('personas:updated', this.state.personas);
                }
            }
        },

        deletePersona(id) {
            // Don't delete the last persona or default if possible (logic can be refined)
            if (this.state.personas.length <= 1) return false;
            
            this.state.personas = this.state.personas.filter(p => p.id !== id);
            
            // Reassign conversations or delete them? Requirement says "workspaces", implies deletion or hiding.
            // Usually safer to keep them but maybe orphan them or delete.
            // For now let's keep them but they won't show up. Or maybe delete.
            // Let's delete conversations associated with this persona to be clean.
            this.state.conversations = this.state.conversations.filter(c => c.personaId !== id);

            if (this.state.activePersonaId === id) {
                this.state.activePersonaId = this.state.personas[0].id;
                // Trigger switch logic
                this.setActivePersona(this.state.activePersonaId);
            } else {
                this.persist();
                if (this.events) {
                    if (typeof this.events.emitAsync === 'function') {
                        this.events.emitAsync('personas:updated', this.state.personas);
                    } else if (typeof this.events.emit === 'function') {
                        this.events.emit('personas:updated', this.state.personas);
                    }
                }
            }
            return true;
        },

        ensureActiveConversation() {
            let active = this.getActiveConversation();
            if (!active) {
                active = this.createConversationInternal('新对话');
            }
            return active;
        },
        
        /**
         * 添加消息到对话（支持分支）
         * @param {string} convId - 对话 ID
         * @param {Object} message - 消息对象
         * @param {string} [parentId] - 父消息 ID（可选，不传则自动设为当前路径最后一条消息）
         */
        addMessageToConversation(convId, message, parentId) {
             const conv = this.state.conversations.find(c => c.id === convId);
             if (conv) {
                 // 初始化 activeBranchMap
                 if (!conv.activeBranchMap) {
                     conv.activeBranchMap = {};
                 }
                 
                 // 确定父消息 ID
                 if (parentId === undefined) {
                     // 未指定父消息时，自动设为当前活跃路径的最后一条消息
                     const activePath = this.getActivePath(convId);
                     if (activePath.length > 0) {
                         parentId = activePath[activePath.length - 1].id;
                     } else {
                         parentId = null; // 第一条消息
                     }
                 }
                 
                 // 设置消息的 parentId
                 message.parentId = parentId;
                 
                 conv.messages.push(message);
                 conv.updatedAt = Date.now();
                 
                 // 更新 activeBranchMap：将新消息设为其父节点的选中分支
                 if (parentId !== null) {
                     conv.activeBranchMap[parentId] = message.id;
                 } else {
                     // 根消息的特殊处理：使用 'root' 作为虚拟父节点
                     conv.activeBranchMap['root'] = message.id;
                 }
                 
                 // Auto-title
                 if(message.role === 'user' && !conv.titleEditedByUser && !conv.titleGeneratedByAI) {
                     const activePath = this.getActivePath(convId);
                     conv.title = window.IdoFront.utils.deriveTitleFromConversation(conv, activePath) || conv.title;
                 }
                 this.persist();
             }
        },

        addLog(logEntry) {
            this.state.logs.unshift(logEntry);
            // 裁剪日志长度，避免状态过大
            if (this.state.logs.length > 200) {
                this.state.logs.length = 200;
            }
            this.persist();
        },

        updateMessage(convId, msgId, updates) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (conv) {
                const msg = conv.messages.find(m => m.id === msgId);
                if (msg) {
                    Object.assign(msg, updates);
                    conv.updatedAt = Date.now();
                    this.persist();
                    return true;
                }
            }
            return false;
        },

        /**
         * 删除消息（支持分支）
         * 删除指定消息及其所有后代消息，并更新 activeBranchMap
         * @param {string} convId - 对话 ID
         * @param {string} msgId - 要删除的消息 ID
         */
        deleteMessage(convId, msgId) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv) return;
            
            const targetMsg = conv.messages.find(m => m.id === msgId);
            if (!targetMsg) return;
            
            // 在删除前，获取被删除消息在兄弟中的索引
            const parentKey = targetMsg.parentId === null || targetMsg.parentId === undefined ? 'root' : targetMsg.parentId;
            const siblingsBeforeDelete = conv.messages.filter(m => {
                const pId = m.parentId === null || m.parentId === undefined ? 'root' : m.parentId;
                return pId === parentKey;
            }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            const originalIndex = siblingsBeforeDelete.findIndex(m => m.id === msgId);
            
            // 收集要删除的所有消息 ID（包括目标消息及其所有后代）
            const toDelete = new Set();
            const queue = [msgId];
            
            while (queue.length > 0) {
                const currentId = queue.shift();
                toDelete.add(currentId);
                
                // 找到所有以当前消息为父节点的子消息
                conv.messages.forEach(m => {
                    if (m.parentId === currentId && !toDelete.has(m.id)) {
                        queue.push(m.id);
                    }
                });
            }
            
            // 删除消息
            conv.messages = conv.messages.filter(m => !toDelete.has(m.id));
            
            // 清理 activeBranchMap 中引用被删除消息的条目
            if (conv.activeBranchMap) {
                // 1. 删除指向被删除消息的分支选择
                for (const parentKey in conv.activeBranchMap) {
                    if (toDelete.has(conv.activeBranchMap[parentKey])) {
                        delete conv.activeBranchMap[parentKey];
                    }
                }
                
                // 2. 删除以被删除消息为键的条目（因为父节点已不存在）
                for (const deletedId of toDelete) {
                    delete conv.activeBranchMap[deletedId];
                }
                
                // 3. 对于目标消息的父节点，如果还有其他兄弟，选择相邻的（优先后一个，否则前一个）
                const parentKey = targetMsg.parentId === null || targetMsg.parentId === undefined ? 'root' : targetMsg.parentId;
                
                // 需要获取删除前的兄弟顺序来确定应该选择哪个
                // 但消息已经被删除了，所以我们需要在删除前记录原始索引
                // 由于我们在前面已经过滤了消息，这里只能基于剩余兄弟选择
                const siblings = conv.messages.filter(m => {
                    const pId = m.parentId === null || m.parentId === undefined ? 'root' : m.parentId;
                    return pId === parentKey;
                }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                
                if (siblings.length > 0) {
                    // 由于被删除消息的原始索引已无法获取，使用删除前记录的索引
                    // originalIndex 在函数开头已计算
                    // 优先选择原索引位置的消息（即后一个顺延），如果不存在则选择前一个
                    let newIndex = originalIndex;
                    if (newIndex >= siblings.length) {
                        newIndex = siblings.length - 1;
                    }
                    conv.activeBranchMap[parentKey] = siblings[newIndex].id;
                } else {
                    delete conv.activeBranchMap[parentKey];
                }
            }
            
            conv.updatedAt = Date.now();
            this.persist();
        },

        truncateConversation(convId, msgId) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (conv) {
                const index = conv.messages.findIndex(m => m.id === msgId);
                if (index !== -1) {
                    // Keep messages up to and including msgId
                    conv.messages = conv.messages.slice(0, index + 1);
                    conv.updatedAt = Date.now();
                    this.persist();
                }
            }
        },

        truncateFromMessage(convId, msgId) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (conv) {
                const index = conv.messages.findIndex(m => m.id === msgId);
                if (index !== -1) {
                    // Remove this message and all following messages
                    conv.messages = conv.messages.slice(0, index);
                    conv.updatedAt = Date.now();
                    this.persist();
                    return true;
                }
            }
            return false;
        },

        // ==================== 分支管理方法 ====================

        /**
         * 获取对话的活跃路径（从根到当前选中的叶子节点）
         * 性能优化：使用缓存避免重复计算
         * @param {string} convId - 对话 ID
         * @returns {Array} 按顺序排列的消息数组
         */
        getActivePath(convId) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv || !conv.messages || conv.messages.length === 0) {
                return [];
            }
            
            // 确保 activeBranchMap 存在
            if (!conv.activeBranchMap) {
                conv.activeBranchMap = {};
            }
            
            // 性能优化：简化缓存键
            // 分支切换时会主动调用 _invalidateActivePathCache 失效缓存
            // 因此缓存键只需要基于消息数量（消息增删时自动失效）
            const cacheKey = convId + ':' + conv.messages.length;
            const cached = this._activePathCache[convId];
            if (cached && cached.key === cacheKey) {
                return cached.path;
            }
            
            // 构建父子关系映射
            const childrenMap = {}; // parentId -> [children]
            conv.messages.forEach(msg => {
                const pId = msg.parentId === undefined || msg.parentId === null ? 'root' : msg.parentId;
                if (!childrenMap[pId]) {
                    childrenMap[pId] = [];
                }
                childrenMap[pId].push(msg);
            });
            
            // 预排序所有分支
            for (const key in childrenMap) {
                childrenMap[key].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            }
            
            // 从根开始遍历
            const path = [];
            let currentParentId = 'root';
            
            while (childrenMap[currentParentId] && childrenMap[currentParentId].length > 0) {
                const children = childrenMap[currentParentId];
                let selectedChild = null;
                
                // 查找 activeBranchMap 中选中的子节点
                const selectedId = conv.activeBranchMap[currentParentId];
                if (selectedId) {
                    selectedChild = children.find(c => c.id === selectedId);
                }
                
                // 如果没有选中或选中的不存在，默认选择第一个（已排序）
                if (!selectedChild) {
                    selectedChild = children[0];
                    // 更新 activeBranchMap
                    conv.activeBranchMap[currentParentId] = selectedChild.id;
                }
                
                path.push(selectedChild);
                currentParentId = selectedChild.id;
            }
            
            // 更新缓存
            this._activePathCache[convId] = { key: cacheKey, path };
            
            return path;
        },
        
        /**
         * 清除活跃路径缓存（当消息结构发生变化时调用）
         */
        _invalidateActivePathCache(convId) {
            if (convId) {
                delete this._activePathCache[convId];
            } else {
                this._activePathCache = {};
            }
        },

        /**
         * 获取某条消息的所有兄弟节点（包括自己）
         * @param {string} convId - 对话 ID
         * @param {string} msgId - 消息 ID
         * @returns {Object} { siblings: Array, currentIndex: number, total: number }
         */
        getSiblings(convId, msgId) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv) {
                return { siblings: [], currentIndex: -1, total: 0 };
            }
            
            const targetMsg = conv.messages.find(m => m.id === msgId);
            if (!targetMsg) {
                return { siblings: [], currentIndex: -1, total: 0 };
            }
            
            const parentId = targetMsg.parentId === undefined || targetMsg.parentId === null ? 'root' : targetMsg.parentId;
            
            // 找到所有具有相同 parentId 的消息
            const siblings = conv.messages.filter(m => {
                const pId = m.parentId === undefined || m.parentId === null ? 'root' : m.parentId;
                return pId === parentId;
            });
            
            // 按创建时间排序
            siblings.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            
            const currentIndex = siblings.findIndex(s => s.id === msgId);
            
            return {
                siblings,
                currentIndex,
                total: siblings.length
            };
        },

        /**
         * 切换到指定分支
         * @param {string} convId - 对话 ID
         * @param {string} msgId - 要切换到的消息 ID
         * @returns {boolean} 是否成功切换
         */
        /**
         * 切换到指定分支
         * @param {string} convId - 对话 ID
         * @param {string} msgId - 要切换到的消息 ID
         * @param {Object} [options] - 选项
         * @param {boolean} [options.silent=false] - 是否静默模式（不触发事件广播，由调用者负责 UI 更新）
         * @returns {boolean} 是否成功切换
         */
        switchBranch(convId, msgId, options) {
            options = options || {};
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv) return false;
            
            const targetMsg = conv.messages.find(m => m.id === msgId);
            if (!targetMsg) return false;
            
            if (!conv.activeBranchMap) {
                conv.activeBranchMap = {};
            }
            
            const parentId = targetMsg.parentId === undefined || targetMsg.parentId === null ? 'root' : targetMsg.parentId;
            
            // 更新选中的分支
            conv.activeBranchMap[parentId] = msgId;

            // 使活跃路径缓存失效（分支切换后路径改变）
            this._invalidateActivePathCache(convId);
            
            // 静默模式：只保存，不广播事件（调用者会自行处理 UI 更新）
            if (options.silent) {
                this.persistSilent();
            } else {
                this.persist();
            }
            return true;
        },

        /**
         * 在指定位置创建分支（用于编辑重试）
         * 创建一条新消息作为指定父消息的另一个子节点
         * @param {string} convId - 对话 ID
         * @param {string} parentMsgId - 父消息 ID（新消息将作为其子节点）
         * @param {Object} newMessage - 新消息对象（不含 parentId，会自动设置）
         * @returns {Object|null} 创建的消息对象
         */
        createBranch(convId, parentMsgId, newMessage) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv) return null;
            
            if (!conv.activeBranchMap) {
                conv.activeBranchMap = {};
            }
            
            // 设置父消息 ID
            newMessage.parentId = parentMsgId;
            
            // 添加到消息列表
            conv.messages.push(newMessage);
            conv.updatedAt = Date.now();
            
            // 自动切换到新分支
            const parentKey = parentMsgId === null ? 'root' : parentMsgId;
            conv.activeBranchMap[parentKey] = newMessage.id;
            
            // Auto-title
            if (newMessage.role === 'user' && !conv.titleEditedByUser && !conv.titleGeneratedByAI) {
                const activePath = this.getActivePath(convId);
                conv.title = window.IdoFront.utils.deriveTitleFromConversation(conv, activePath) || conv.title;
            }
            
            this.persist();
            return newMessage;
        },

        /**
         * 迁移旧数据：为没有 parentId 的消息添加 parentId
         * 按照原有顺序建立线性的父子关系
         */
        migrateMessagesToTree(convId) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv || !conv.messages) return;
            
            // 检查是否需要迁移（如果有任何消息没有 parentId 字段）
            const needsMigration = conv.messages.some(m => m.parentId === undefined);
            if (!needsMigration) return;
            
            // 按 createdAt 排序
            const sortedMessages = [...conv.messages].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            
            // 初始化 activeBranchMap
            if (!conv.activeBranchMap) {
                conv.activeBranchMap = {};
            }
            
            // 为每条消息设置 parentId
            sortedMessages.forEach((msg, index) => {
                if (msg.parentId === undefined) {
                    if (index === 0) {
                        msg.parentId = null;
                        conv.activeBranchMap['root'] = msg.id;
                    } else {
                        msg.parentId = sortedMessages[index - 1].id;
                        conv.activeBranchMap[msg.parentId] = msg.id;
                    }
                }
            });
            
            this.persist();
        },

        /**
         * 重命名对话
         * @param {string} convId - 对话 ID
         * @param {string} newTitle - 新标题
         * @param {string} [source='user'] - 来源：'user' 表示用户手动编辑，'ai' 表示 AI 生成
         * @returns {boolean} 是否成功
         */
        renameConversation(convId, newTitle, source) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv) return false;
            
            const trimmed = (newTitle || '').trim();
            if (!trimmed) return false;
            
            // 如果用户已编辑过标题，AI 不能再修改
            if (source === 'ai' && conv.titleEditedByUser) {
                return false;
            }
            
            conv.title = trimmed;
            conv.updatedAt = Date.now();
            
            // 标记用户编辑
            if (source === 'user') {
                conv.titleEditedByUser = true;
            } else if (source === 'ai') {
                conv.titleGeneratedByAI = true;
            }
            
            this.persist();
            
            // 触发事件通知 UI 更新
            if (this.events) {
                this.events.emit('conversation:renamed', { id: convId, title: trimmed, source: source || 'user' });
            }
            return true;
        },

        // ==================== 全局设置方法 ====================

        /**
         * 获取全局设置
         * @param {string} [key] - 设置键名，不传返回所有设置
         * @returns {*} 设置值或所有设置对象
         */
        getSetting(key) {
            if (!this.state.settings) {
                this.state.settings = { autoGenerateTitle: true };
            }
            if (key) {
                return this.state.settings[key];
            }
            return { ...this.state.settings };
        },

        /**
         * 设置全局设置
         * @param {string} key - 设置键名
         * @param {*} value - 设置值
         */
        setSetting(key, value) {
            if (!this.state.settings) {
                this.state.settings = { autoGenerateTitle: true };
            }
            this.state.settings[key] = value;
            this.persist();
            
            // 触发设置变更事件
            if (this.events) {
                this.events.emit('settings:changed', { key, value });
            }
        },

        deleteConversation(id) {
            this.state.conversations = this.state.conversations.filter(c => c.id !== id);
            
            if (this.state.activeConversationId === id) {
                // 删除的是当前激活的对话，需要选择新的激活对话
                // 优先选择当前面具的其他对话
                const personaConvs = this.state.conversations.filter(c => c.personaId === this.state.activePersonaId);
                
                if (personaConvs.length > 0) {
                    // 选择当前面具的第一个对话
                    this.state.activeConversationId = personaConvs[0].id;
                } else {
                    // 当前面具没有对话了，创建新对话
                    this.state.activeConversationId = null;
                }
            }
            
            // 如果没有激活对话且当前面具没有对话，创建新对话
            if (!this.state.activeConversationId) {
                const personaConvs = this.state.conversations.filter(c => c.personaId === this.state.activePersonaId);
                if (personaConvs.length === 0) {
                    this.createConversationInternal('新对话');
                }
            }
            
            this.persist();
            return this.state.activeConversationId;
        },

        saveChannels(channels) {
            this.state.channels = channels;
            this.persist();
        },

        setPluginState(slot, id, enabled) {
            const key = `${slot}::${id}`;
            this.state.pluginStates[key] = enabled;
            this.persist();
        },

        setConversationModel(convId, channelId, model) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (conv) {
                conv.selectedChannelId = channelId;
                conv.selectedModel = model;
                this.persist();
            }
        },

        /**
         * 设置会话级别的流式开关
         * @param {string} convId
         * @param {boolean} streamOverride - true=流式, false=非流式
         */
        setConversationStreamOverride(convId, streamOverride) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (conv) {
                conv.streamOverride = !!streamOverride;
                this.persist();
            }
        },

        /**
         * 设置会话级别的思考预算（reasoning_effort）
         * 仅当模型支持（如 gpt-5*）时由上层逻辑决定是否生效
         * @param {string} convId
         * @param {'low'|'medium'|'high'} effort
         */
        setConversationReasoningEffort(convId, effort) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (conv) {
                let normalized = effort;
                if (normalized !== 'low' && normalized !== 'medium' && normalized !== 'high') {
                    normalized = 'medium';
                }
                conv.reasoningEffort = normalized;
                this.persist();
            }
        },

        /**
         * 更新会话元数据
         * @param {string} convId - 会话 ID
         * @param {Object} updates - 要更新的元数据键值对（值为 null 时删除该键）
         */
        updateConversationMetadata(convId, updates) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv) return false;
            
            if (!conv.metadata) {
                conv.metadata = {};
            }
            
            for (const [key, value] of Object.entries(updates)) {
                if (value === null || value === undefined) {
                    delete conv.metadata[key];
                } else {
                    conv.metadata[key] = value;
                }
            }
            
            conv.updatedAt = Date.now();
            this.persist();
            return true;
        },

        /**
         * 获取会话元数据
         * @param {string} convId - 会话 ID
         * @param {string} [key] - 可选的键名，不传返回全部元数据
         * @returns {*} 元数据值或全部元数据对象
         */
        getConversationMetadata(convId, key) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (!conv || !conv.metadata) return key ? undefined : {};
            
            if (key) {
                return conv.metadata[key];
            }
            return { ...conv.metadata };
        }
    };

})();