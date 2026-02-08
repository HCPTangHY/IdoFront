/**
 * IndexedDB Storage Layer
 * 提供异步的、高性能的数据持久化方案
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const DB_NAME = 'IdoFrontDB';
    const DB_VERSION = 4;  // v4: 状态存储升级为分片增量写入（会话/消息归一化）
    const STORE_NAME = 'state'; // legacy store（兼容旧版本）
    const META_STORE = 'meta';
    const CONVERSATIONS_STORE = 'conversations';
    const MESSAGES_STORE = 'messages';
    const PLUGINS_STORE = 'plugins';
    const PLUGIN_DATA_STORE = 'pluginData';  // 插件运行时数据存储
    const APP_META_KEY = 'appMeta';
    const PERSONAS_KEY = 'personas';
    const CHANNELS_KEY = 'channels';
    const PLUGIN_STATES_KEY = 'pluginStates';
    const SETTINGS_KEY = 'settings';
    const LOGS_KEY = 'logs';
    const NORMALIZED_MAGIC = 'IdoFront_NormalizedState';
    const NORMALIZED_VERSION = 1;
    const MAX_PERSIST_LOGS = 200;
    const MAX_TEXT_SIGNATURE = 80;
    const EMPTY_ARRAY = Object.freeze([]);
    const messageSignatureCache = new Map();
    const conversationSignatureCache = new Map();
    const STATE_KEY = 'core.chat.state';
    const PLUGINS_FALLBACK_KEY = 'idofront.external.plugins.v1';
    const PLUGIN_DATA_FALLBACK_KEY = 'idofront.plugin.data.v1';

    // 轻量影子备份：用于 IndexedDB 数据被清理/损坏时“尽力恢复”（避免影响主线程性能）
    // 说明：不要把完整 state（可能几十/上百 MB）写入 chrome.storage/localStorage，会造成明显卡顿。
    // 这里只存：渠道/面具/设置 + 当前活跃会话最近一段消息（可恢复近期工作）。
    const STATE_SHADOW_KEY = 'core.chat.state.shadow.v1';

    const SHADOW_MIN_INTERVAL_MS = 60 * 1000; // 最多 1 分钟写一次
    const SHADOW_WRITE_DELAY_MS = 3000;       // 延迟写入，避免卡在响应结束关键路径
    const MAX_SHADOW_MESSAGES = 80;           // 仅保留活跃会话最后 N 条消息（减小序列化压力）
    const MAX_SHADOW_TEXT_CHARS = 12000;      // 单条消息文本上限，避免超长内容拖垮主线程
    const MAX_SHADOW_ATTACHMENTS_PER_MESSAGE = 12;
    const MAX_SHADOW_TOOL_CALLS = 10;

    function clampString(value, maxLen) {
        if (typeof value !== 'string') return '';
        if (value.length <= maxLen) return value;
        return value.slice(0, maxLen);
    }

    function sanitizeToolCallsForShadow(toolCalls) {
        if (!Array.isArray(toolCalls)) return undefined;
        return toolCalls
            .slice(0, MAX_SHADOW_TOOL_CALLS)
            .map(call => {
                if (!call || typeof call !== 'object') return null;
                const out = {
                    id: call.id,
                    name: call.name || call.toolName || '',
                    status: call.status || ''
                };
                if (typeof call.summary === 'string') {
                    out.summary = clampString(call.summary, 2000);
                }
                return out;
            })
            .filter(Boolean);
    }

    function sanitizeAttachmentsForShadow(attachments) {
        if (!Array.isArray(attachments)) return undefined;
        return attachments
            .slice(0, MAX_SHADOW_ATTACHMENTS_PER_MESSAGE)
            .map(a => {
                if (!a || typeof a !== 'object') return null;
                return {
                    id: a.id,
                    name: a.name,
                    type: a.type,
                    size: a.size,
                    source: a.source
                };
            })
            .filter(Boolean);
    }

    function getMessageTextForShadow(msg) {
        if (!msg || typeof msg !== 'object') return '';
        if (typeof msg.content === 'string') return msg.content;
        if (typeof msg.text === 'string') return msg.text;
        return '';
    }

    function pickLightConversationMeta(conv) {
        if (!conv || typeof conv !== 'object') return undefined;
        const meta = conv.metadata;
        if (!meta || typeof meta !== 'object') return undefined;
        // 仅保留轻量元信息，避免把大型 provider 原始响应写进 shadow
        const light = {};
        if (typeof meta.topic === 'string') light.topic = clampString(meta.topic, 200);
        if (typeof meta.source === 'string') light.source = clampString(meta.source, 80);
        if (Object.keys(light).length === 0) return undefined;
        return light;
    }

    
    let shadowLastWrittenAt = 0;
    let shadowWriteTimer = null;
    let pendingShadowState = null;

    function canUseChromeStorage() {
        try {
            return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
        } catch (e) {
            return false;
        }
    }

    function sanitizeMessageForShadow(msg) {
        if (!msg || typeof msg !== 'object') return null;

        const clean = {
            id: msg.id,
            role: msg.role,
            content: clampString(getMessageTextForShadow(msg), MAX_SHADOW_TEXT_CHARS),
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
            parentId: msg.parentId
        };

        if (typeof msg.reasoning === 'string') {
            clean.reasoning = clampString(msg.reasoning, MAX_SHADOW_TEXT_CHARS);
        }

        const attachments = sanitizeAttachmentsForShadow(msg.attachments);
        if (attachments && attachments.length > 0) {
            clean.attachments = attachments;
        }

        const toolCalls = sanitizeToolCallsForShadow(msg.toolCalls);
        if (toolCalls && toolCalls.length > 0) {
            clean.toolCalls = toolCalls;
        }

        return clean;
    }

    function buildShadowSnapshot(state) {
        const base = state && typeof state === 'object' ? state : {};
        const conversations = Array.isArray(base.conversations) ? base.conversations : [];
        const activeConversationId = base.activeConversationId || null;
        const activeConv = activeConversationId
            ? conversations.find(c => c && c.id === activeConversationId)
            : null;

        let convShadow = null;
        if (activeConv) {
            const allMessages = Array.isArray(activeConv.messages) ? activeConv.messages : [];
            const tail = allMessages.slice(Math.max(0, allMessages.length - MAX_SHADOW_MESSAGES));
            convShadow = {
                id: activeConv.id,
                title: activeConv.title,
                createdAt: activeConv.createdAt,
                updatedAt: activeConv.updatedAt,
                personaId: activeConv.personaId,
                selectedChannelId: activeConv.selectedChannelId,
                selectedModel: activeConv.selectedModel,
                streamOverride: activeConv.streamOverride,
                reasoningEffort: activeConv.reasoningEffort,
                activeBranchMap: activeConv.activeBranchMap,
                titleEditedByUser: activeConv.titleEditedByUser,
                titleGeneratedByAI: activeConv.titleGeneratedByAI,
                metadata: pickLightConversationMeta(activeConv),
                messages: tail.map(sanitizeMessageForShadow).filter(Boolean)
            };
        }

        return {
            _shadowMagic: 'IdoFront_StateShadow',
            _shadowVersion: 1,
            _shadowSavedAt: new Date().toISOString(),
            personas: Array.isArray(base.personas) ? base.personas : [],
            activePersonaId: base.activePersonaId || null,
            personaLastActiveConversationIdMap: (base.personaLastActiveConversationIdMap && typeof base.personaLastActiveConversationIdMap === 'object')
                ? base.personaLastActiveConversationIdMap
                : {},
            activeConversationId,
            conversations: convShadow ? [convShadow] : [],
            channels: Array.isArray(base.channels) ? base.channels : [],
            pluginStates: base.pluginStates && typeof base.pluginStates === 'object' ? base.pluginStates : {},
            settings: base.settings && typeof base.settings === 'object' ? base.settings : {}
        };
    }

    function flushShadowWrite() {
        shadowWriteTimer = null;
        if (!pendingShadowState || !canUseChromeStorage()) return;

        const now = Date.now();
        if (now - shadowLastWrittenAt < SHADOW_MIN_INTERVAL_MS) {
            // 仍在节流窗口内，下次再写
            return;
        }

        shadowLastWrittenAt = now;
        const source = pendingShadowState;
        pendingShadowState = null;

        const snapshot = buildShadowSnapshot(source);
        try {
            chrome.storage.local.set({ [STATE_SHADOW_KEY]: snapshot }, () => {
                // ignore
            });
        } catch (e) {
            // ignore
        }
    }

    function scheduleShadowWrite(state) {
        if (!canUseChromeStorage()) return;

        // 始终更新待写入 state（取最新），但写入频率受控
        pendingShadowState = state;

        if (shadowWriteTimer) return;

        const run = () => flushShadowWrite();
        if (typeof requestIdleCallback === 'function') {
            shadowWriteTimer = requestIdleCallback(run, { timeout: 5000 });
        } else {
            shadowWriteTimer = setTimeout(run, SHADOW_WRITE_DELAY_MS);
        }
    }

    function clearShadow() {
        pendingShadowState = null;
        if (shadowWriteTimer) {
            try {
                if (typeof cancelIdleCallback === 'function') {
                    cancelIdleCallback(shadowWriteTimer);
                } else {
                    clearTimeout(shadowWriteTimer);
                }
            } catch (e) {
                // ignore
            }
            shadowWriteTimer = null;
        }

        if (!canUseChromeStorage()) return;
        try {
            chrome.storage.local.remove([STATE_SHADOW_KEY], () => {
                // ignore
            });
        } catch (e) {
            // ignore
        }
    }

    function sanitizeLogs(logs) {
        if (!Array.isArray(logs)) return [];
        return logs.slice(0, MAX_PERSIST_LOGS);
    }

    function getTextSignature(text) {
        if (typeof text !== 'string') return '0:';
        const head = text.slice(0, MAX_TEXT_SIGNATURE);
        const tail = text.slice(Math.max(0, text.length - MAX_TEXT_SIGNATURE));
        return `${text.length}:${head}|${tail}`;
    }

    function getStructuredSignature(value, depth) {
        const currentDepth = Number.isFinite(depth) ? depth : 0;
        if (value === null) return 'null';

        const valueType = typeof value;
        if (valueType === 'undefined') return 'undef';
        if (valueType === 'string') return `str:${getTextSignature(value)}`;
        if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
            return `${valueType}:${String(value)}`;
        }
        if (valueType === 'function') return 'fn';
        if (value instanceof Date) return `date:${value.getTime()}`;

        if (Array.isArray(value)) {
            if (currentDepth >= 2) return `arr:${value.length}`;
            const MAX_ITEMS = 8;
            const items = value.slice(0, MAX_ITEMS).map(item => getStructuredSignature(item, currentDepth + 1));
            return `arr:${value.length}[${items.join(',')}]`;
        }

        if (valueType === 'object') {
            let keys = [];
            try {
                keys = Object.keys(value).sort();
            } catch (e) {
                return 'obj:?';
            }

            if (currentDepth >= 2) {
                const keyHead = keys.slice(0, 8).join(',');
                return `obj:${keys.length}:${keyHead}`;
            }

            const MAX_KEYS = 10;
            const pairs = keys.slice(0, MAX_KEYS).map(key => {
                return `${key}=${getStructuredSignature(value[key], currentDepth + 1)}`;
            });
            return `obj:${keys.length}{${pairs.join(',')}}`;
        }

        return valueType;
    }

    function buildAttachmentsSignature(attachments) {
        if (!Array.isArray(attachments) || attachments.length === 0) return '';
        return attachments.map(att => {
            if (!att || typeof att !== 'object') return 'x';
            const dataUrlSig = typeof att.dataUrl === 'string' ? getTextSignature(att.dataUrl) : '';
            const urlSig = typeof att.url === 'string' ? getTextSignature(att.url) : '';
            const pathSig = typeof att.path === 'string' ? getTextSignature(att.path) : '';
            const thoughtSig = att.thought_signature || att.thoughtSignature || '';
            return [
                att.id || '',
                att.name || '',
                att.type || '',
                att.size || 0,
                att.source || '',
                att.mimeType || '',
                thoughtSig,
                dataUrlSig,
                urlSig,
                pathSig
            ].join('~');
        }).join('||');
    }

    function buildToolCallsSignature(toolCalls) {
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
        return toolCalls.map(tc => {
            if (!tc || typeof tc !== 'object') return 'x';
            const argsSig = getStructuredSignature(tc.args, 0);
            const resultSig = getStructuredSignature(tc.result, 0);
            const errorSig = tc.error === null || tc.error === undefined
                ? ''
                : getTextSignature(typeof tc.error === 'string' ? tc.error : String(tc.error));
            return [
                tc.id || '',
                tc.callId || '',
                tc.name || '',
                tc.status || '',
                tc.startTime || '',
                tc.endTime || '',
                tc.duration || '',
                argsSig,
                resultSig,
                errorSig
            ].join('~');
        }).join('||');
    }

    function buildBranchMapSignature(map) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) return '';
        const keys = Object.keys(map).sort();
        const MAX_ITEMS = 256;
        const items = keys.slice(0, MAX_ITEMS).map(key => {
            return `${key}>${map[key] === undefined || map[key] === null ? '' : String(map[key])}`;
        });
        return `${keys.length}:${items.join(',')}`;
    }

    function toTimestamp(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const asNumber = Number(value);
            if (Number.isFinite(asNumber)) return asNumber;
            const asDate = Date.parse(value);
            if (Number.isFinite(asDate)) return asDate;
        }
        return 0;
    }

    function getMessageFingerprint(msg) {
        if (!msg || typeof msg !== 'object') return 'invalid';
        const id = msg.id || '';
        const updatedAt = msg.updatedAt || '';
        const role = msg.role || '';
        const parentId = msg.parentId || '';
        const createdAt = msg.createdAt || '';
        const contentSig = getTextSignature(typeof msg.content === 'string' ? msg.content : (typeof msg.text === 'string' ? msg.text : ''));
        const reasoningSig = getTextSignature(typeof msg.reasoning === 'string' ? msg.reasoning : '');
        const attachmentsSig = buildAttachmentsSignature(msg.attachments);
        const toolCallsSig = buildToolCallsSignature(msg.toolCalls);
        const metadataSig = getStructuredSignature(msg.metadata, 0);
        const status = msg.status || '';
        const finishReason = msg.finishReason || '';
        return [
            id,
            updatedAt,
            createdAt,
            role,
            parentId,
            status,
            finishReason,
            contentSig,
            reasoningSig,
            attachmentsSig,
            toolCallsSig,
            metadataSig
        ].join('|');
    }

    function getConversationFingerprint(conv) {
        if (!conv || typeof conv !== 'object') return 'invalid';
        const messages = Array.isArray(conv.messages) ? conv.messages : EMPTY_ARRAY;
        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        const firstMsg = messages.length > 0 ? messages[0] : null;
        const activeBranchSig = buildBranchMapSignature(conv.activeBranchMap);
        const metadataSig = getStructuredSignature(conv.metadata, 0);
        return [
            conv.id || '',
            conv.updatedAt || '',
            conv.title || '',
            conv.personaId || '',
            conv.selectedChannelId || '',
            conv.selectedModel || '',
            conv.streamOverride === true ? '1' : (conv.streamOverride === false ? '0' : ''),
            conv.reasoningEffort || '',
            conv.titleEditedByUser ? '1' : '0',
            conv.titleGeneratedByAI ? '1' : '0',
            activeBranchSig,
            metadataSig,
            messages.length,
            firstMsg ? (firstMsg.id || '') : '',
            firstMsg ? (firstMsg.updatedAt || '') : '',
            lastMsg ? (lastMsg.id || '') : '',
            lastMsg ? (lastMsg.updatedAt || '') : ''
        ].join('|');
    }

    class IDBStorage {
        constructor() {
            this.db = null;
            this.initPromise = null;
            this._persistedConversationIds = new Set();
            this._conversationMessageIds = new Map();
            this._conversationOrderCache = new Map();
            this._metaSerializedCache = new Map();
        }

        /**
         * 初始化数据库
         */
        async init() {
            if (this.initPromise) return this.initPromise;

            this.initPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onerror = () => {
                    console.error('IndexedDB 打开失败:', request.error);
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    this.db.onversionchange = () => {
                        console.warn('IndexedDB 版本变化，连接即将关闭');
                        this.db.close();
                    };
                    resolve(this.db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME);
                    }

                    if (!db.objectStoreNames.contains(META_STORE)) {
                        db.createObjectStore(META_STORE, { keyPath: 'key' });
                    }

                    if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
                        const convStore = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
                        convStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
                        convStore.createIndex('by_persona', 'personaId', { unique: false });
                    }

                    if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
                        const msgStore = db.createObjectStore(MESSAGES_STORE, { keyPath: ['conversationId', 'id'] });
                        msgStore.createIndex('by_conversation', 'conversationId', { unique: false });
                        msgStore.createIndex('by_conversation_createdAt', ['conversationId', 'createdAt'], { unique: false });
                        msgStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
                    }

                    if (!db.objectStoreNames.contains(PLUGINS_STORE)) {
                        const store = db.createObjectStore(PLUGINS_STORE, { keyPath: 'id' });
                        store.createIndex('by_enabled', 'enabled', { unique: false });
                        store.createIndex('by_updated', 'updatedAt', { unique: false });
                    }

                    // 插件运行时数据存储：使用复合键 [pluginId, key]
                    if (!db.objectStoreNames.contains(PLUGIN_DATA_STORE)) {
                        const dataStore = db.createObjectStore(PLUGIN_DATA_STORE, { keyPath: ['pluginId', 'key'] });
                        dataStore.createIndex('by_plugin', 'pluginId', { unique: false });
                    }
                };
            });

            return this.initPromise;
        }

        #hasNormalizedStores() {
            try {
                const names = this.db && this.db.objectStoreNames;
                return !!(names && names.contains(META_STORE) && names.contains(CONVERSATIONS_STORE) && names.contains(MESSAGES_STORE));
            } catch (e) {
                return false;
            }
        }

        #requestToPromise(request) {
            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        #transactionToPromise(transaction) {
            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
            });
        }

        #writeMetaRecord(store, key, value) {
            let serialized = null;
            try {
                serialized = JSON.stringify(value);
            } catch (e) {
                serialized = null;
            }

            if (serialized !== null) {
                if (this._metaSerializedCache.get(key) === serialized) return;
                this._metaSerializedCache.set(key, serialized);
            } else {
                this._metaSerializedCache.delete(key);
            }

            store.put({ key, value, updatedAt: Date.now() });
        }

        #refreshDiffCacheFromState(state) {
            this._persistedConversationIds.clear();
            this._conversationMessageIds.clear();
            this._conversationOrderCache.clear();
            messageSignatureCache.clear();
            conversationSignatureCache.clear();

            const conversations = Array.isArray(state && state.conversations) ? state.conversations : [];
            conversations.forEach((conv, index) => {
                if (!conv || !conv.id) return;
                const convId = conv.id;
                this._persistedConversationIds.add(convId);
                this._conversationOrderCache.set(convId, index);
                conversationSignatureCache.set(convId, getConversationFingerprint(conv));
                const messages = Array.isArray(conv.messages) ? conv.messages : [];
                const msgIdSet = new Set();
                messages.forEach(msg => {
                    if (!msg || !msg.id) return;
                    msgIdSet.add(msg.id);
                    messageSignatureCache.set(`${convId}::${msg.id}`, getMessageFingerprint(msg));
                });
                this._conversationMessageIds.set(convId, msgIdSet);
            });
        }

        async #saveLegacyState(state) {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            store.put(state, STATE_KEY);
            await this.#transactionToPromise(transaction);
        }

        async #loadLegacyState() {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(STATE_KEY);
            return await this.#requestToPromise(request) || null;
        }

        async #clearLegacyState() {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            store.clear();
            await this.#transactionToPromise(transaction);
        }

        async #clearNormalizedState() {
            const transaction = this.db.transaction([META_STORE, CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
            transaction.objectStore(META_STORE).clear();
            transaction.objectStore(CONVERSATIONS_STORE).clear();
            transaction.objectStore(MESSAGES_STORE).clear();
            await this.#transactionToPromise(transaction);
            this._persistedConversationIds.clear();
            this._conversationMessageIds.clear();
            this._conversationOrderCache.clear();
            this._metaSerializedCache.clear();
            messageSignatureCache.clear();
            conversationSignatureCache.clear();
        }

        async #saveNormalizedState(state, options = {}) {
            const source = state && typeof state === 'object' ? state : {};
            const forceFull = !!options.forceFull;

            const transaction = this.db.transaction([META_STORE, CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
            const metaStore = transaction.objectStore(META_STORE);
            const convStore = transaction.objectStore(CONVERSATIONS_STORE);
            const msgStore = transaction.objectStore(MESSAGES_STORE);

            const appMeta = {
                activePersonaId: source.activePersonaId || null,
                activeConversationId: source.activeConversationId || null,
                personaLastActiveConversationIdMap: (source.personaLastActiveConversationIdMap && typeof source.personaLastActiveConversationIdMap === 'object')
                    ? source.personaLastActiveConversationIdMap
                    : {},
                _normalizedMagic: NORMALIZED_MAGIC,
                _normalizedVersion: NORMALIZED_VERSION
            };

            this.#writeMetaRecord(metaStore, APP_META_KEY, appMeta);
            this.#writeMetaRecord(metaStore, PERSONAS_KEY, Array.isArray(source.personas) ? source.personas : []);
            this.#writeMetaRecord(metaStore, CHANNELS_KEY, Array.isArray(source.channels) ? source.channels : []);
            this.#writeMetaRecord(metaStore, PLUGIN_STATES_KEY, source.pluginStates && typeof source.pluginStates === 'object' ? source.pluginStates : {});
            this.#writeMetaRecord(metaStore, SETTINGS_KEY, source.settings && typeof source.settings === 'object' ? source.settings : {});
            this.#writeMetaRecord(metaStore, LOGS_KEY, sanitizeLogs(source.logs));

            const nextConversationIds = new Set();
            const nextConversationMessageIds = new Map();
            const nextConversationSignatures = new Map();
            const nextConversationOrders = new Map();
            const nextMessageSignatures = new Map();
            const conversations = Array.isArray(source.conversations) ? source.conversations : [];

            conversations.forEach((conv, convOrder) => {
                if (!conv || !conv.id) return;
                const convId = conv.id;
                nextConversationIds.add(convId);
                nextConversationOrders.set(convId, convOrder);

                const convFingerprint = getConversationFingerprint(conv);
                const prevConvFingerprint = conversationSignatureCache.get(convId);
                const prevConvOrder = this._conversationOrderCache.get(convId);
                const orderChanged = prevConvOrder !== convOrder;
                nextConversationSignatures.set(convId, convFingerprint);
                if (forceFull || prevConvFingerprint !== convFingerprint || orderChanged) {
                    const convRecord = { ...conv };
                    convRecord.id = convId;
                    convRecord.__order = convOrder;
                    delete convRecord.messages;
                    convStore.put(convRecord);
                }

                const prevMsgIds = this._conversationMessageIds.get(convId) || new Set();
                const nextMsgIds = new Set();
                const messages = Array.isArray(conv.messages) ? conv.messages : [];

                messages.forEach(msg => {
                    if (!msg || !msg.id) return;
                    const msgId = msg.id;
                    nextMsgIds.add(msgId);
                    const msgKey = `${convId}::${msgId}`;
                    const msgFingerprint = getMessageFingerprint(msg);
                    const prevMsgFingerprint = messageSignatureCache.get(msgKey);
                    nextMessageSignatures.set(msgKey, msgFingerprint);

                    if (forceFull || prevMsgFingerprint !== msgFingerprint) {
                        const msgRecord = { ...msg };
                        msgRecord.id = msgId;
                        msgRecord.conversationId = convId;
                        msgStore.put(msgRecord);
                    }
                });

                prevMsgIds.forEach(msgId => {
                    if (!nextMsgIds.has(msgId)) {
                        msgStore.delete([convId, msgId]);
                    }
                });

                nextConversationMessageIds.set(convId, nextMsgIds);
            });

            this._persistedConversationIds.forEach(convId => {
                if (nextConversationIds.has(convId)) return;
                convStore.delete(convId);
                const oldMsgIds = this._conversationMessageIds.get(convId);
                if (oldMsgIds) {
                    oldMsgIds.forEach(msgId => {
                        msgStore.delete([convId, msgId]);
                    });
                }
            });

            await this.#transactionToPromise(transaction);

            this._persistedConversationIds = nextConversationIds;
            this._conversationMessageIds = nextConversationMessageIds;
            this._conversationOrderCache = nextConversationOrders;
            conversationSignatureCache.clear();
            messageSignatureCache.clear();
            nextConversationSignatures.forEach((value, key) => conversationSignatureCache.set(key, value));
            nextMessageSignatures.forEach((value, key) => messageSignatureCache.set(key, value));
        }

        async #loadNormalizedState() {
            const transaction = this.db.transaction([META_STORE, CONVERSATIONS_STORE, MESSAGES_STORE], 'readonly');
            const metaStore = transaction.objectStore(META_STORE);
            const convStore = transaction.objectStore(CONVERSATIONS_STORE);
            const msgStore = transaction.objectStore(MESSAGES_STORE);

            const [metaRows, convRows, msgRows] = await Promise.all([
                this.#requestToPromise(metaStore.getAll()),
                this.#requestToPromise(convStore.getAll()),
                this.#requestToPromise(msgStore.getAll())
            ]);

            const metaMap = new Map();
            (metaRows || []).forEach(row => {
                if (row && typeof row.key === 'string') {
                    metaMap.set(row.key, row.value);
                }
            });

            const appMeta = metaMap.get(APP_META_KEY) || null;
            const hasNormalizedMarker = !!(appMeta && appMeta._normalizedMagic === NORMALIZED_MAGIC);
            const hasAnyData = (convRows && convRows.length > 0) || (msgRows && msgRows.length > 0) || hasNormalizedMarker;
            if (!hasAnyData) return null;

            const messagesByConversation = new Map();
            (msgRows || []).forEach(msg => {
                if (!msg || !msg.conversationId) return;
                if (!messagesByConversation.has(msg.conversationId)) {
                    messagesByConversation.set(msg.conversationId, []);
                }
                messagesByConversation.get(msg.conversationId).push(msg);
            });

            messagesByConversation.forEach(list => {
                list.sort((a, b) => {
                    const ta = toTimestamp(a && a.createdAt);
                    const tb = toTimestamp(b && b.createdAt);
                    return ta - tb;
                });
            });

            const conversations = (convRows || []).map(conv => ({
                ...conv,
                messages: messagesByConversation.get(conv.id) || []
            }));

            conversations.sort((a, b) => {
                const ao = Number.isFinite(a && a.__order) ? a.__order : Number.MAX_SAFE_INTEGER;
                const bo = Number.isFinite(b && b.__order) ? b.__order : Number.MAX_SAFE_INTEGER;
                if (ao !== bo) return ao - bo;
                const au = toTimestamp(a && a.updatedAt);
                const bu = toTimestamp(b && b.updatedAt);
                return bu - au;
            });

            const state = {
                personas: Array.isArray(metaMap.get(PERSONAS_KEY)) ? metaMap.get(PERSONAS_KEY) : [],
                activePersonaId: appMeta && appMeta.activePersonaId ? appMeta.activePersonaId : null,
                personaLastActiveConversationIdMap: (appMeta && appMeta.personaLastActiveConversationIdMap && typeof appMeta.personaLastActiveConversationIdMap === 'object')
                    ? appMeta.personaLastActiveConversationIdMap
                    : {},
                conversations,
                activeConversationId: appMeta && appMeta.activeConversationId ? appMeta.activeConversationId : null,
                logs: sanitizeLogs(metaMap.get(LOGS_KEY)),
                channels: Array.isArray(metaMap.get(CHANNELS_KEY)) ? metaMap.get(CHANNELS_KEY) : [],
                pluginStates: metaMap.get(PLUGIN_STATES_KEY) && typeof metaMap.get(PLUGIN_STATES_KEY) === 'object' ? metaMap.get(PLUGIN_STATES_KEY) : {},
                settings: metaMap.get(SETTINGS_KEY) && typeof metaMap.get(SETTINGS_KEY) === 'object' ? metaMap.get(SETTINGS_KEY) : {}
            };

            state.conversations.forEach(conv => {
                if (!conv || typeof conv !== 'object') return;
                if (Object.prototype.hasOwnProperty.call(conv, '__order')) {
                    delete conv.__order;
                }
            });

            this._metaSerializedCache.clear();
            const appMetaForCache = {
                activePersonaId: state.activePersonaId || null,
                activeConversationId: state.activeConversationId || null,
                personaLastActiveConversationIdMap: state.personaLastActiveConversationIdMap || {},
                _normalizedMagic: NORMALIZED_MAGIC,
                _normalizedVersion: NORMALIZED_VERSION
            };
            const cacheEntries = [
                [APP_META_KEY, appMetaForCache],
                [PERSONAS_KEY, state.personas],
                [CHANNELS_KEY, state.channels],
                [PLUGIN_STATES_KEY, state.pluginStates],
                [SETTINGS_KEY, state.settings],
                [LOGS_KEY, state.logs]
            ];
            cacheEntries.forEach(([key, value]) => {
                try {
                    this._metaSerializedCache.set(key, JSON.stringify(value));
                } catch (e) {
                    // ignore
                }
            });

            this.#refreshDiffCacheFromState(state);
            return state;
        }

        /**
         * 保存状态
         * @param {Object} state - 要保存的状态对象
         */
        async save(state) {
            try {
                await this.init();

                if (this.#hasNormalizedStores()) {
                    await this.#saveNormalizedState(state);
                } else {
                    await this.#saveLegacyState(state);
                }

                // 轻量影子备份：异步 + 节流 + 延迟，避免主线程卡顿
                scheduleShadowWrite(state);
            } catch (error) {
                console.error('IndexedDB 保存错误:', error);
                throw error;
            }
        }

        /**
         * 加载状态
         * @returns {Promise<Object|null>} 返回保存的状态或 null
         */
        async load() {
            try {
                await this.init();

                if (this.#hasNormalizedStores()) {
                    const normalized = await this.#loadNormalizedState();
                    if (normalized) {
                        return normalized;
                    }
                }

                const legacy = await this.#loadLegacyState();
                if (legacy && this.#hasNormalizedStores()) {
                    try {
                        await this.#saveNormalizedState(legacy, { forceFull: true });
                        this.#refreshDiffCacheFromState(legacy);
                        // 迁移成功后清理 legacy 大对象，避免占用双份空间
                        await this.#clearLegacyState();
                    } catch (e) {
                        console.warn('旧版 state 迁移到分片存储失败:', e);
                    }
                }
                return legacy || null;
            } catch (error) {
                console.error('IndexedDB 加载错误:', error);
                return null;
            }
        }

        /**
         * 清除所有数据
         */
        async clear() {
            try {
                await this.init();
                await this.#clearLegacyState();
                if (this.#hasNormalizedStores()) {
                    await this.#clearNormalizedState();
                }

                // 同步清理影子副本
                clearShadow();
                console.log('IndexedDB 数据已清除');
            } catch (error) {
                console.error('IndexedDB 清除错误:', error);
                throw error;
            }
        }

        /**
         * 删除特定键
         * @param {string} key - 要删除的键
         */
        async delete(key) {
            try {
                await this.init();

                if (key === STATE_KEY) {
                    await this.#clearLegacyState();
                    if (this.#hasNormalizedStores()) {
                        await this.#clearNormalizedState();
                    }
                    clearShadow();
                    return;
                }

                const transaction = this.db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                store.delete(key);
                await this.#transactionToPromise(transaction);
            } catch (error) {
                console.error('IndexedDB 删除错误:', error);
                throw error;
            }
        }

        /**
         * 检查是否支持 IndexedDB
         */
        static isSupported() {
            return 'indexedDB' in window;
        }
 
        async savePlugin(plugin) {
            return this.#pluginTx('readwrite', store => store.put(plugin));
        }
 
        async getPlugin(id) {
            return this.#pluginTx('readonly', store => store.get(id));
        }
 
        async getAllPlugins() {
            return this.#pluginTx('readonly', store => store.getAll());
        }
 
        async deletePlugin(id) {
            return this.#pluginTx('readwrite', store => store.delete(id));
        }
 
        async clearPlugins() {
            return this.#pluginTx('readwrite', store => store.clear());
        }
 
        async #pluginTx(mode, executor) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([PLUGINS_STORE], mode);
                const store = transaction.objectStore(PLUGINS_STORE);
                const request = executor(store);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        }

        // ========== 插件运行时数据存储 API ==========

        /**
         * 保存插件数据
         * @param {string} pluginId - 插件 ID
         * @param {string} key - 数据键
         * @param {any} value - 数据值
         */
        async setPluginData(pluginId, key, value) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([PLUGIN_DATA_STORE], 'readwrite');
                const store = transaction.objectStore(PLUGIN_DATA_STORE);
                const record = {
                    pluginId,
                    key,
                    value,
                    updatedAt: Date.now()
                };
                const request = store.put(record);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * 获取插件数据
         * @param {string} pluginId - 插件 ID
         * @param {string} key - 数据键
         * @returns {Promise<any|null>} 数据值
         */
        async getPluginData(pluginId, key) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([PLUGIN_DATA_STORE], 'readonly');
                const store = transaction.objectStore(PLUGIN_DATA_STORE);
                const request = store.get([pluginId, key]);
                request.onsuccess = () => {
                    const record = request.result;
                    resolve(record ? record.value : null);
                };
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * 删除插件数据
         * @param {string} pluginId - 插件 ID
         * @param {string} key - 数据键
         */
        async deletePluginData(pluginId, key) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([PLUGIN_DATA_STORE], 'readwrite');
                const store = transaction.objectStore(PLUGIN_DATA_STORE);
                const request = store.delete([pluginId, key]);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * 获取插件的所有数据键
         * @param {string} pluginId - 插件 ID
         * @returns {Promise<string[]>} 该插件的所有数据键
         */
        async getPluginDataKeys(pluginId) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([PLUGIN_DATA_STORE], 'readonly');
                const store = transaction.objectStore(PLUGIN_DATA_STORE);
                const index = store.index('by_plugin');
                const request = index.getAllKeys(pluginId);
                request.onsuccess = () => {
                    // 复合键 [pluginId, key]，提取 key 部分
                    const keys = (request.result || []).map(k => k[1]);
                    resolve(keys);
                };
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * 获取插件的所有数据
         * @param {string} pluginId - 插件 ID
         * @returns {Promise<Array<{key: string, value: any, updatedAt: number}>>}
         */
        async getAllPluginData(pluginId) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([PLUGIN_DATA_STORE], 'readonly');
                const store = transaction.objectStore(PLUGIN_DATA_STORE);
                const index = store.index('by_plugin');
                const request = index.getAll(pluginId);
                request.onsuccess = () => {
                    resolve(request.result || []);
                };
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * 清除插件的所有数据
         * @param {string} pluginId - 插件 ID
         */
        async clearPluginData(pluginId) {
            await this.init();
            const keys = await this.getPluginDataKeys(pluginId);
            
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([PLUGIN_DATA_STORE], 'readwrite');
                const store = transaction.objectStore(PLUGIN_DATA_STORE);
                
                let completed = 0;
                let hasError = false;
                
                if (keys.length === 0) {
                    resolve();
                    return;
                }
                
                keys.forEach(key => {
                    const request = store.delete([pluginId, key]);
                    request.onsuccess = () => {
                        completed++;
                        if (completed === keys.length && !hasError) {
                            resolve();
                        }
                    };
                    request.onerror = () => {
                        if (!hasError) {
                            hasError = true;
                            reject(request.error);
                        }
                    };
                });
            });
        }
    }
 
    window.IdoFront.idbStorage = new IDBStorage();

    function createStorageFacade(idbInstance) {
        const supportsIDB = IDBStorage.isSupported() && !!idbInstance;

        const fallback = {
            async saveState(state) {
                try {
                    localStorage.setItem(STATE_KEY, JSON.stringify(state));
                } catch (error) {
                    console.error('localStorage 保存失败', error);
                }
            },
            async loadState() {
                try {
                    const snapshot = localStorage.getItem(STATE_KEY);
                    return snapshot ? JSON.parse(snapshot) : null;
                } catch (error) {
                    console.error('localStorage 读取失败', error);
                    return null;
                }
            },
            async savePlugin(plugin) {
                const list = await this.getAllPlugins();
                const idx = list.findIndex(p => p.id === plugin.id);
                if (idx >= 0) {
                    list[idx] = plugin;
                } else {
                    list.push(plugin);
                }
                try {
                    localStorage.setItem(PLUGINS_FALLBACK_KEY, JSON.stringify(list));
                } catch (error) {
                    console.error('localStorage 保存插件失败', error);
                }
            },
            async getPlugin(id) {
                const list = await this.getAllPlugins();
                return list.find(p => p.id === id) || null;
            },
            async getAllPlugins() {
                try {
                    const raw = localStorage.getItem(PLUGINS_FALLBACK_KEY);
                    return raw ? JSON.parse(raw) : [];
                } catch (error) {
                    console.error('localStorage 读取插件失败', error);
                    return [];
                }
            },
            async deletePlugin(id) {
                const list = await this.getAllPlugins();
                const next = list.filter(p => p.id !== id);
                try {
                    localStorage.setItem(PLUGINS_FALLBACK_KEY, JSON.stringify(next));
                } catch (error) {
                    console.error('localStorage 删除插件失败', error);
                }
            },
            async clearPlugins() {
                try {
                    localStorage.removeItem(PLUGINS_FALLBACK_KEY);
                } catch (error) {
                    console.error('localStorage 清理插件失败', error);
                }
            },
            // 插件数据存储的 localStorage 兜底实现
            // 注意：localStorage 无法可靠保存 Blob（JSON.stringify 会变成 {} 丢数据）。
            // 因此遇到 Blob 时转换为 dataUrl 字符串再存。
            async setPluginData(pluginId, key, value) {
                try {
                    const all = await this.getAllPluginDataRaw();
                    if (!all[pluginId]) all[pluginId] = {};

                    let storedValue = value;
                    if (value instanceof Blob) {
                        storedValue = await new Promise((resolve, reject) => {
                            try {
                                const reader = new FileReader();
                                reader.onload = () => resolve(reader.result);
                                reader.onerror = () => reject(reader.error || new Error('readAsDataURL failed'));
                                reader.readAsDataURL(value);
                            } catch (e) {
                                reject(e);
                            }
                        });
                    }

                    all[pluginId][key] = { value: storedValue, updatedAt: Date.now() };
                    localStorage.setItem(PLUGIN_DATA_FALLBACK_KEY, JSON.stringify(all));
                } catch (error) {
                    console.error('localStorage 保存插件数据失败', error);
                    // 重要：向上抛出，让调用方有机会做降级/提示（避免“静默丢附件”）
                    throw error;
                }
            },
            async getPluginData(pluginId, key) {
                try {
                    const all = await this.getAllPluginDataRaw();
                    const pluginData = all[pluginId];
                    if (!pluginData || !pluginData[key]) return null;
                    return pluginData[key].value;
                } catch (error) {
                    console.error('localStorage 读取插件数据失败', error);
                    return null;
                }
            },
            async deletePluginData(pluginId, key) {
                try {
                    const all = await this.getAllPluginDataRaw();
                    if (all[pluginId]) {
                        delete all[pluginId][key];
                        localStorage.setItem(PLUGIN_DATA_FALLBACK_KEY, JSON.stringify(all));
                    }
                } catch (error) {
                    console.error('localStorage 删除插件数据失败', error);
                }
            },
            async getPluginDataKeys(pluginId) {
                try {
                    const all = await this.getAllPluginDataRaw();
                    const pluginData = all[pluginId];
                    return pluginData ? Object.keys(pluginData) : [];
                } catch (error) {
                    console.error('localStorage 读取插件数据键失败', error);
                    return [];
                }
            },
            async getAllPluginData(pluginId) {
                try {
                    const all = await this.getAllPluginDataRaw();
                    const pluginData = all[pluginId];
                    if (!pluginData) return [];
                    return Object.entries(pluginData).map(([key, data]) => ({
                        pluginId,
                        key,
                        value: data.value,
                        updatedAt: data.updatedAt
                    }));
                } catch (error) {
                    console.error('localStorage 读取插件所有数据失败', error);
                    return [];
                }
            },
            async clearPluginData(pluginId) {
                try {
                    const all = await this.getAllPluginDataRaw();
                    delete all[pluginId];
                    localStorage.setItem(PLUGIN_DATA_FALLBACK_KEY, JSON.stringify(all));
                } catch (error) {
                    console.error('localStorage 清理插件数据失败', error);
                }
            },
            async getAllPluginDataRaw() {
                try {
                    const raw = localStorage.getItem(PLUGIN_DATA_FALLBACK_KEY);
                    return raw ? JSON.parse(raw) : {};
                } catch (error) {
                    return {};
                }
            }
        };

        async function preferIdb(fn, fallbackFn) {
            if (supportsIDB) {
                try {
                    return await fn();
                } catch (error) {
                    console.warn('IndexedDB 操作失败，回退到 localStorage', error);
                    if (fallbackFn) {
                        return fallbackFn();
                    }
                    throw error;
                }
            }
            if (fallbackFn) return fallbackFn();
            return undefined;
        }

        return {
            saveState(state) {
                return preferIdb(() => idbInstance.save(state), () => fallback.saveState(state));
            },
            loadState() {
                return preferIdb(() => idbInstance.load(), () => fallback.loadState());
            },
            savePlugin(plugin) {
                return preferIdb(() => idbInstance.savePlugin(plugin), () => fallback.savePlugin(plugin));
            },
            getPlugin(id) {
                return preferIdb(() => idbInstance.getPlugin(id), () => fallback.getPlugin(id));
            },
            getAllPlugins() {
                return preferIdb(() => idbInstance.getAllPlugins(), () => fallback.getAllPlugins());
            },
            deletePlugin(id) {
                return preferIdb(() => idbInstance.deletePlugin(id), () => fallback.deletePlugin(id));
            },
            clearPlugins() {
                return preferIdb(() => idbInstance.clearPlugins(), () => fallback.clearPlugins());
            },
            // 插件运行时数据存储 API
            setPluginData(pluginId, key, value) {
                return preferIdb(
                    () => idbInstance.setPluginData(pluginId, key, value),
                    () => fallback.setPluginData(pluginId, key, value)
                );
            },
            getPluginData(pluginId, key) {
                return preferIdb(
                    () => idbInstance.getPluginData(pluginId, key),
                    () => fallback.getPluginData(pluginId, key)
                );
            },
            deletePluginData(pluginId, key) {
                return preferIdb(
                    () => idbInstance.deletePluginData(pluginId, key),
                    () => fallback.deletePluginData(pluginId, key)
                );
            },
            getPluginDataKeys(pluginId) {
                return preferIdb(
                    () => idbInstance.getPluginDataKeys(pluginId),
                    () => fallback.getPluginDataKeys(pluginId)
                );
            },
            getAllPluginData(pluginId) {
                return preferIdb(
                    () => idbInstance.getAllPluginData(pluginId),
                    () => fallback.getAllPluginData(pluginId)
                );
            },
            clearPluginData(pluginId) {
                return preferIdb(
                    () => idbInstance.clearPluginData(pluginId),
                    () => fallback.clearPluginData(pluginId)
                );
            }
        };
    }

    window.IdoFront.storage = window.IdoFront.storage || createStorageFacade(window.IdoFront.idbStorage);

})();