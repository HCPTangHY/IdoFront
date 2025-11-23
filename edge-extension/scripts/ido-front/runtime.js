/**
 * IdoFront Runtime
 * 提供给内建模块与插件的统一 runtime API（首期：store 只读访问）
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const store = window.IdoFront.store;
    if (!store) {
        console.warn('[IdoFront.runtime] store 未初始化，runtime.store 将暂不可用');
    }

    const runtime = window.IdoFront.runtime || {};

    /**
     * 只读访问 Store 状态：
     * - 无参数：返回完整 state 引用（谨慎使用，只读）
     * - 数组：按 key 拿子集快照（浅拷贝）
     * - 函数：selector(state) → 任意派生数据
     */
    function getState(selector) {
        if (!store) return null;

        const base = store.state;
        if (typeof selector === 'function') {
            try {
                return selector(base);
            } catch (e) {
                console.error('[IdoFront.runtime.store.getState] selector error:', e);
                return null;
            }
        }

        if (Array.isArray(selector)) {
            const result = {};
            selector.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(base, key)) {
                    result[key] = base[key];
                }
            });
            return result;
        }

        // 默认返回完整 state 引用（只读约定）
        return base;
    }

    function subscribe(event, handler) {
        if (!store || !store.events || typeof store.events.on !== 'function') {
            return () => {};
        }
        if (typeof handler !== 'function') {
            return () => {};
        }
        store.events.on(event, handler);
        return () => {
            if (store && store.events && typeof store.events.off === 'function') {
                store.events.off(event, handler);
            }
        };
    }

    function unsubscribe(event, handler) {
        if (!store || !store.events || typeof store.events.off !== 'function') {
            return;
        }
        if (typeof handler !== 'function') return;
        store.events.off(event, handler);
    }

    runtime.store = {
        getState,
        subscribe,
        unsubscribe
    };

    window.IdoFront.runtime = runtime;
})();