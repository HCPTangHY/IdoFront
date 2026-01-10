/**
 * Attachment Storage
 *
 * 目标：把大体积附件（尤其是图片 base64 dataUrl）从 core.chat.state 中剥离出来，
 * 仅在消息里保存轻量引用（{ id, name, type, size, source }）。
 *
 * 存储位置：IndexedDB 的 pluginData store（idb-storage.js 已内置），pluginId = "core.attachments"
 */
(function () {
    window.IdoFront = window.IdoFront || {};

    const PLUGIN_ID = 'core.attachments';
    const storage = window.IdoFront.storage;
    const utils = window.IdoFront.utils;

    // objectURL 缓存（避免频繁从 IDB 读取 + createObjectURL）
    const MAX_OBJECT_URLS = 128;
    const objectUrlCache = new Map(); // id -> url (LRU via Map insertion order)
    const pendingObjectUrl = new Map(); // id -> Promise<string|null>

    function createAttachmentId() {
        if (utils && typeof utils.createId === 'function') {
            return utils.createId('att');
        }
        return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function pickString(value, fallback) {
        return typeof value === 'string' && value ? value : fallback;
    }

    function normalizeMimeType(type) {
        if (typeof type !== 'string') return '';
        const t = type.trim().toLowerCase();
        if (t === 'image/jpg') return 'image/jpeg';
        return t;
    }

    function extractMimeFromDataUrl(dataUrl) {
        if (typeof dataUrl !== 'string') return '';
        const m = /^data:([^;]+);base64,/.exec(dataUrl);
        return m ? normalizeMimeType(m[1]) : '';
    }

    async function dataUrlToBlob(dataUrl) {
        // 优先用 fetch(data:)，Chromium 下通常更快且更省内存
        try {
            const res = await fetch(dataUrl);
            return await res.blob();
        } catch (e) {
            // fallback: 手动解码（大文件可能较慢）
            const parts = String(dataUrl).split(',');
            if (parts.length < 2) {
                throw new Error('Invalid dataUrl');
            }
            const header = parts[0];
            const b64 = parts.slice(1).join(',');
            const mimeMatch = /data:([^;]+);base64/.exec(header);
            const mime = mimeMatch ? normalizeMimeType(mimeMatch[1]) : '';

            const binary = atob(b64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new Blob([bytes], { type: mime });
        }
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('readAsDataURL failed'));
            reader.readAsDataURL(blob);
        });
    }

    function setCachedObjectUrl(id, url) {
        if (!id || !url) return;

        // revoke old
        const existing = objectUrlCache.get(id);
        if (existing && existing !== url) {
            try {
                URL.revokeObjectURL(existing);
            } catch (e) {
                // ignore
            }
        }

        // refresh LRU
        if (objectUrlCache.has(id)) {
            objectUrlCache.delete(id);
        }
        objectUrlCache.set(id, url);

        // enforce max
        while (objectUrlCache.size > MAX_OBJECT_URLS) {
            const oldestKey = objectUrlCache.keys().next().value;
            const oldestUrl = objectUrlCache.get(oldestKey);
            objectUrlCache.delete(oldestKey);
            if (oldestUrl) {
                try {
                    URL.revokeObjectURL(oldestUrl);
                } catch (e) {
                    // ignore
                }
            }
        }
    }

    function getCachedObjectUrl(id) {
        if (!id || !objectUrlCache.has(id)) return null;
        const url = objectUrlCache.get(id);
        // refresh
        objectUrlCache.delete(id);
        objectUrlCache.set(id, url);
        return url;
    }

    async function setStoredValue(id, value) {
        if (!storage || typeof storage.setPluginData !== 'function') {
            throw new Error('storage.setPluginData not available');
        }
        await storage.setPluginData(PLUGIN_ID, id, value);
    }

    async function getStoredValue(id) {
        if (!storage || typeof storage.getPluginData !== 'function') {
            return null;
        }
        try {
            return await storage.getPluginData(PLUGIN_ID, id);
        } catch (e) {
            console.warn('[attachments] getPluginData failed:', e);
            return null;
        }
    }

    async function saveBlob(blob, meta) {
        if (!blob) return null;

        const m = meta && typeof meta === 'object' ? meta : {};
        const id = pickString(m.id, '') || createAttachmentId();
        const name = pickString(m.name, pickString(blob.name, 'attachment'));
        const type = normalizeMimeType(pickString(m.type, pickString(blob.type, '')));
        const source = pickString(m.source, undefined);

        // 1) 优先存 Blob
        try {
            await setStoredValue(id, blob);
        } catch (e) {
            // 2) fallback：如果落 Blob 失败（例如退化到 localStorage），存 dataUrl 字符串
            console.warn('[attachments] saveBlob -> setPluginData(blob) failed, fallback to dataUrl string:', e);
            const dataUrl = await blobToDataUrl(blob);
            await setStoredValue(id, dataUrl);
        }

        // 缓存 objectURL（UI 使用）
        try {
            const url = URL.createObjectURL(blob);
            setCachedObjectUrl(id, url);
        } catch (e) {
            // ignore
        }

        const ref = {
            id,
            name,
            type,
            size: blob.size
        };
        if (source) ref.source = source;
        return ref;
    }

    async function saveDataUrl(dataUrl, meta) {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            return null;
        }
        const blob = await dataUrlToBlob(dataUrl);
        const m = meta && typeof meta === 'object' ? { ...meta } : {};
        if (!m.type) {
            m.type = extractMimeFromDataUrl(dataUrl) || blob.type;
        }
        return saveBlob(blob, m);
    }

    async function getBlob(id) {
        const value = await getStoredValue(id);
        if (!value) return null;
        if (value instanceof Blob) return value;
        if (typeof value === 'string' && value.startsWith('data:')) {
            try {
                return await dataUrlToBlob(value);
            } catch (e) {
                console.warn('[attachments] dataUrlToBlob failed:', e);
                return null;
            }
        }
        return null;
    }

    async function getDataUrl(id) {
        const value = await getStoredValue(id);
        if (!value) return null;
        if (typeof value === 'string' && value.startsWith('data:')) return value;
        if (value instanceof Blob) {
            try {
                return await blobToDataUrl(value);
            } catch (e) {
                console.warn('[attachments] blobToDataUrl failed:', e);
                return null;
            }
        }
        return null;
    }

    async function getObjectUrl(id) {
        if (!id) return null;

        const cached = getCachedObjectUrl(id);
        if (cached) return cached;

        if (pendingObjectUrl.has(id)) {
            return pendingObjectUrl.get(id);
        }

        const p = (async () => {
            const blob = await getBlob(id);
            if (!blob) return null;
            try {
                const url = URL.createObjectURL(blob);
                setCachedObjectUrl(id, url);
                return url;
            } catch (e) {
                return null;
            }
        })();

        pendingObjectUrl.set(id, p);
        try {
            return await p;
        } finally {
            pendingObjectUrl.delete(id);
        }
    }

    function sanitizeRef(ref) {
        if (!ref || typeof ref !== 'object') return null;
        if (!ref.id) return null;
        const out = {
            id: String(ref.id),
            name: pickString(ref.name, 'attachment'),
            type: normalizeMimeType(pickString(ref.type, '')),
            size: typeof ref.size === 'number' ? ref.size : undefined
        };
        if (ref.source) out.source = ref.source;
        return out;
    }

    function attachmentSignature(list) {
        const arr = Array.isArray(list) ? list : [];
        return JSON.stringify(
            arr
                .filter(Boolean)
                .map(a => ({
                    id: a.id || null,
                    name: a.name || null,
                    type: a.type || null,
                    size: a.size || null,
                    source: a.source || null
                }))
        );
    }

    /**
     * 将任意来源的 attachment 对象规整成可持久化引用（并确保 Blob 已存到 IDB）。
     * 支持输入：
     * - 已是 ref：{ id, name, type, size }
     * - fileUpload 产生：{ file, dataUrl, name, type, size }
     * - 仅 dataUrl：{ dataUrl, name, type, size }
     */
    async function normalizeAttachmentForState(att, options) {
        if (!att || typeof att !== 'object') return null;

        // 已经是 ref（无 dataUrl / file 等大字段）
        if (att.id && !att.dataUrl && !att.file) {
            return sanitizeRef(att);
        }

        const opt = options && typeof options === 'object' ? options : {};

        const name = pickString(att.name, att.file && att.file.name ? att.file.name : 'attachment');
        const type = normalizeMimeType(
            pickString(att.type, att.file && att.file.type ? att.file.type : extractMimeFromDataUrl(att.dataUrl))
        );
        const source = pickString(att.source, opt.source);

        // 如果外部已提供 id（例如迁移/重写），尽量复用，避免产生新引用
        const existingId = pickString(att.id, '');
        const meta = { name, type, source };
        if (existingId) meta.id = existingId;

        // 对图片：优先用 dataUrl（因为可能已经做过格式转换/尺寸优化）
        const isImage = type && type.startsWith('image/');

        if (typeof att.dataUrl === 'string' && att.dataUrl.startsWith('data:') && (isImage || !att.file)) {
            return await saveDataUrl(att.dataUrl, meta);
        }

        if (att.file instanceof Blob) {
            return await saveBlob(att.file, meta);
        }

        if (typeof att.dataUrl === 'string' && att.dataUrl.startsWith('data:')) {
            return await saveDataUrl(att.dataUrl, meta);
        }

        return null;
    }

    /**
     * 批量规整，返回 { attachments, changed }
     */
    async function normalizeAttachmentsForState(list, options) {
        if (!Array.isArray(list) || list.length === 0) {
            return { attachments: [], changed: false };
        }

        const beforeSig = attachmentSignature(list);

        const out = [];
        for (const a of list) {
            // eslint-disable-next-line no-await-in-loop
            const ref = await normalizeAttachmentForState(a, options);
            if (ref) out.push(ref);
        }

        const afterSig = attachmentSignature(out);
        return {
            attachments: out,
            changed: beforeSig !== afterSig
        };
    }

    /**
     * 将 attachments 转换成「适配器可消费」的 payload（包含 dataUrl），用于请求模型。
     * 不会写回 Store。
     */
    async function resolveAttachmentsForPayload(list, options) {
        const opt = options && typeof options === 'object' ? options : {};
        const cache = opt.cache && opt.cache instanceof Map ? opt.cache : null;

        const attachments = Array.isArray(list) ? list : [];
        const out = [];

        for (const a of attachments) {
            if (!a) continue;
            const type = normalizeMimeType(pickString(a.type, ''));
            // 当前仅对 image/* 生效，其他类型在渠道侧也不会被处理
            if (type && !type.startsWith('image/')) continue;

            let dataUrl = null;
            if (typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:')) {
                dataUrl = a.dataUrl;
            } else if (a.id) {
                const key = String(a.id);
                if (cache && cache.has(key)) {
                    dataUrl = cache.get(key);
                } else {
                    // eslint-disable-next-line no-await-in-loop
                    dataUrl = await getDataUrl(key);
                    if (cache && dataUrl) {
                        cache.set(key, dataUrl);
                    }
                }
            } else if (a.file instanceof Blob) {
                // eslint-disable-next-line no-await-in-loop
                dataUrl = await blobToDataUrl(a.file);
            }

            if (!dataUrl) continue;

            const payloadType = type || extractMimeFromDataUrl(dataUrl);
            out.push({
                dataUrl,
                type: payloadType,
                name: pickString(a.name, 'image'),
                size: typeof a.size === 'number' ? a.size : undefined,
                source: a.source,
                id: a.id
            });
        }

        return out;
    }

    window.IdoFront.attachments = {
        PLUGIN_ID,
        saveBlob,
        saveDataUrl,
        getBlob,
        getDataUrl,
        getObjectUrl,
        normalizeAttachmentForState,
        normalizeAttachmentsForState,
        resolveAttachmentsForPayload
    };
})();
