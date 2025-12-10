/**
 * IdoFront Store
 * Manages state and persistence
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
            pluginStates: {} // Format: "slot::id": boolean
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
                
                this._initialized = true;
            })();
            
            return this._initPromise;
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

        initDefaultChannels() {
            this.state.channels = [
                { id: 'openai', name: 'OpenAI', type: 'openai', enabled: true },
                { id: 'gemini', name: 'Gemini', type: 'gemini', enabled: true },
                { id: 'claude', name: 'Claude', type: 'claude', enabled: true }
            ];
            this.persist();
        },

        persist() {
            // 轻量节流 + 日志裁剪，避免频繁 JSON 序列化和 IDB 写入导致卡顿
            const now = Date.now();
    
            // 构建快照，裁剪日志长度以降低序列化成本
            const MAX_LOGS = 200;
            const snapshot = {
                personas: this.state.personas,
                activePersonaId: this.state.activePersonaId,
                conversations: this.state.conversations,
                activeConversationId: this.state.activeConversationId,
                logs: Array.isArray(this.state.logs) ? this.state.logs.slice(0, MAX_LOGS) : [],
                channels: this.state.channels,
                pluginStates: this.state.pluginStates
            };
    
            // 合并并延后保存
            this._pendingSnapshot = snapshot;
    
            const doSave = (snap) => {
                // 使用 IndexedDB 异步保存，失败则回退 localStorage
                if (window.IdoFront.idbStorage) {
                    window.IdoFront.idbStorage.save(snap).catch(error => {
                        console.error('IndexedDB 保存失败:', error);
                        try {
                            localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
                        } catch (e) {
                            console.error('localStorage 保存也失败:', e);
                        }
                    });
                } else {
                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
                    } catch (e) {
                        console.error('Storage save error:', e);
                    }
                }
            };
    
            // 节流：250ms 内的重复持久化合并到一次保存
            const THROTTLE_MS = 250;
            if (now - this._lastPersistAt < THROTTLE_MS) {
                if (!this._persistTimer) {
                    this._persistTimer = setTimeout(() => {
                        this._persistTimer = null;
                        this._lastPersistAt = Date.now();
                        // 关键修复：保存当前快照的引用，然后只有当 _pendingSnapshot 仍然是这个引用时才清空
                        const snapToSave = this._pendingSnapshot;
                        if (this._pendingSnapshot === snapToSave) {
                            this._pendingSnapshot = null;
                        }
                        // 防御性检查：确保不会保存 null
                        if (snapToSave) {
                            doSave(snapToSave);
                        }
                    }, THROTTLE_MS);
                }
            } else {
                this._lastPersistAt = now;
                const snapToSave = this._pendingSnapshot;
                this._pendingSnapshot = null;
                // 防御性检查：确保不会保存 null
                if (snapToSave) {
                    doSave(snapToSave);
                }
            }
    
            // 通知所有订阅者：状态已更新（单一数据源）
            if (this.events) {
                if (typeof this.events.emitAsync === 'function') {
                    this.events.emitAsync('updated', this.state);
                } else if (typeof this.events.emit === 'function') {
                    this.events.emit('updated', this.state);
                }
            }
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
        
        addMessageToConversation(convId, message) {
             const conv = this.state.conversations.find(c => c.id === convId);
             if (conv) {
                 conv.messages.push(message);
                 conv.updatedAt = Date.now();
                 // Auto-title
                 if(message.role === 'user') {
                     conv.title = window.IdoFront.utils.deriveTitleFromConversation(conv) || conv.title;
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

        deleteMessage(convId, msgId) {
            const conv = this.state.conversations.find(c => c.id === convId);
            if (conv) {
                conv.messages = conv.messages.filter(m => m.id !== msgId);
                conv.updatedAt = Date.now();
                this.persist();
            }
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
        }
    };

})();