/**
 * Crash / Error Logger
 *
 * 目标：在浏览器崩溃/侧边栏被杀进程前，尽可能把关键日志持久化，方便下次启动导出。
 *
 * 设计原则：
 * - 只采集高价值日志（error/warn + window.onerror/unhandledrejection）
 * - 写入 chrome.storage.local（不依赖 IndexedDB）
 * - 采用缓冲 + 延迟 + idle + 节流，避免影响主线程性能
 */
(function () {
    window.IdoFront = window.IdoFront || {};

    const STORAGE_KEY = 'idofront.crash.logs.v1';

    // 保留最近 N 条日志（ring buffer）
    const MAX_ENTRIES = 2000;

    // 缓冲写入：减少 storage.local.set 频率
    const FLUSH_DELAY_MS = 1500;
    const FLUSH_IDLE_TIMEOUT_MS = 5000;

    let flushTimer = null;
    let flushing = false;
    const buffer = [];

    function canUseChromeStorage() {
        try {
            return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
        } catch (e) {
            return false;
        }
    }

    function safeToString(value) {
        try {
            if (typeof value === 'string') return value;
            if (value instanceof Error) return value.stack || value.message || String(value);
            return JSON.stringify(value);
        } catch (e) {
            try {
                return String(value);
            } catch (e2) {
                return '[Unserializable]';
            }
        }
    }

    function nowIso() {
        try {
            return new Date().toISOString();
        } catch (e) {
            return '';
        }
    }

    function enqueue(level, message, extra) {
        if (!canUseChromeStorage()) return;

        const entry = {
            t: nowIso(),
            level: level || 'info',
            message: message || '',
            extra: extra && typeof extra === 'object' ? extra : undefined
        };

        buffer.push(entry);

        // 避免缓冲无限增长
        if (buffer.length > 200) {
            buffer.splice(0, buffer.length - 200);
        }

        scheduleFlush();
    }

    function scheduleFlush() {
        if (!canUseChromeStorage()) return;
        if (flushTimer) return;

        const run = () => {
            flushTimer = null;
            flush().catch(() => {
                // ignore
            });
        };

        // 尽量在空闲时写入
        if (typeof requestIdleCallback === 'function') {
            flushTimer = requestIdleCallback(run, { timeout: FLUSH_IDLE_TIMEOUT_MS });
        } else {
            flushTimer = setTimeout(run, FLUSH_DELAY_MS);
        }
    }

    async function flush() {
        if (!canUseChromeStorage()) return;
        if (flushing) return;
        if (buffer.length === 0) return;

        flushing = true;
        const batch = buffer.splice(0, buffer.length);

        try {
            const existing = await new Promise(resolve => {
                chrome.storage.local.get([STORAGE_KEY], result => {
                    const list = result && Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
                    resolve(list);
                });
            });

            const merged = existing.concat(batch);

            // 裁剪：只保留最后 MAX_ENTRIES 条
            const trimmed = merged.length > MAX_ENTRIES
                ? merged.slice(merged.length - MAX_ENTRIES)
                : merged;

            await new Promise(resolve => {
                chrome.storage.local.set({ [STORAGE_KEY]: trimmed }, () => resolve());
            });
        } catch (e) {
            // 写入失败：丢弃本批，避免无限重试造成卡顿
        } finally {
            flushing = false;
        }
    }

    async function getLogs() {
        if (!canUseChromeStorage()) return [];
        return await new Promise(resolve => {
            chrome.storage.local.get([STORAGE_KEY], result => {
                resolve(result && Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
            });
        });
    }

    async function clearLogs() {
        if (!canUseChromeStorage()) return;
        try {
            await new Promise(resolve => {
                chrome.storage.local.remove([STORAGE_KEY], () => resolve());
            });
        } catch (e) {
            // ignore
        }
    }

    function downloadText(content, filename, mimeType) {
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

    function getTimestamp() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    async function exportLogs() {
        try {
            // 先尽力把缓冲刷盘
            await flush();
            const logs = await getLogs();

            const payload = {
                _type: 'IdoFrontCrashLogs',
                _exportedAt: nowIso(),
                _manifestVersion: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
                    ? chrome.runtime.getManifest().version
                    : null,
                _userAgent: navigator.userAgent,
                logs
            };

            downloadText(
                JSON.stringify(payload, null, 2),
                `IdoFront_CrashLogs_${getTimestamp()}.json`,
                'application/json'
            );
        } catch (e) {
            // ignore
        }
    }

    // ========== Hook: window.onerror / unhandledrejection ==========

    window.addEventListener('error', (event) => {
        try {
            enqueue('error', safeToString(event.message || 'window.error'), {
                source: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error && (event.error.stack || String(event.error))
            });
        } catch (e) {
            // ignore
        }
    });

    window.addEventListener('unhandledrejection', (event) => {
        try {
            enqueue('error', 'unhandledrejection', {
                reason: safeToString(event.reason)
            });
        } catch (e) {
            // ignore
        }
    });

    // ========== Hook: console.warn / console.error ==========

    const originalConsole = {
        warn: console.warn ? console.warn.bind(console) : null,
        error: console.error ? console.error.bind(console) : null
    };

    if (originalConsole.warn) {
        console.warn = (...args) => {
            try {
                enqueue('warn', args.map(safeToString).join(' '));
            } catch (e) {
                // ignore
            }
            return originalConsole.warn(...args);
        };
    }

    if (originalConsole.error) {
        console.error = (...args) => {
            try {
                enqueue('error', args.map(safeToString).join(' '));
            } catch (e) {
                // ignore
            }
            return originalConsole.error(...args);
        };
    }

    // 退出/切后台时尽力刷盘
    window.addEventListener('beforeunload', () => {
        flush().catch(() => {});
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flush().catch(() => {});
        }
    });

    // Session start marker
    enqueue('info', 'session_start', {
        at: nowIso(),
        manifestVersion: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
            ? chrome.runtime.getManifest().version
            : null
    });

    // 对外暴露：允许其他模块写入结构化诊断事件（例如 network-logger）
    function record(level, message, extra) {
        enqueue(level, message, extra);
    }

    window.IdoFront.crashLogger = {
        getLogs,
        clearLogs,
        exportLogs,
        flush,
        record
    };
})();
