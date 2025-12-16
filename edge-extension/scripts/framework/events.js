/**
 * 事件总线模块
 * 提供发布/订阅模式的事件系统
 */
const FrameworkEvents = (function() {
    'use strict';

    const listeners = {};

    /**
     * 订阅事件
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    function on(event, callback) {
        if (!listeners[event]) {
            listeners[event] = [];
        }
        listeners[event].push(callback);
    }

    /**
     * 同步触发事件
     * @param {string} event - 事件名称
     * @param {*} data - 事件数据
     */
    function emit(event, data) {
        if (listeners[event]) {
            listeners[event].forEach(cb => cb(data));
        }
    }

    /**
     * 异步触发事件（使用 microtask 队列）
     * @param {string} event - 事件名称
     * @param {*} data - 事件数据
     */
    function emitAsync(event, data) {
        if (!listeners[event]) return;
        const handlers = listeners[event].slice();
        for (const cb of handlers) {
            Promise.resolve().then(() => {
                try {
                    cb(data);
                } catch (e) {
                    console.warn('Framework async handler error:', e);
                }
            });
        }
    }

    /**
     * 取消订阅
     * @param {string} event - 事件名称
     * @param {Function} callback - 要移除的回调函数
     */
    function off(event, callback) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    }

    /**
     * 订阅事件（仅触发一次）
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    function once(event, callback) {
        const wrapper = (data) => {
            off(event, wrapper);
            callback(data);
        };
        on(event, wrapper);
    }

    /**
     * 清除指定事件的所有监听器
     * @param {string} event - 事件名称
     */
    function clear(event) {
        if (event) {
            delete listeners[event];
        }
    }

    return {
        on,
        emit,
        emitAsync,
        off,
        once,
        clear,
        listeners // 暴露用于调试
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkEvents = FrameworkEvents;
}