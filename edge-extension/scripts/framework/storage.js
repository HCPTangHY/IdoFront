/**
 * 存储模块
 * 提供统一的本地存储接口
 */
const FrameworkStorage = (function() {
    'use strict';

    /**
     * 保存数据到 localStorage
     * @param {string} key - 存储键
     * @param {*} value - 要存储的值（会被 JSON 序列化）
     */
    function setItem(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error('Storage save error:', e);
        }
    }

    /**
     * 从 localStorage 读取数据
     * @param {string} key - 存储键
     * @param {*} defaultValue - 默认值
     * @returns {*} 存储的值或默认值
     */
    function getItem(key, defaultValue) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.error('Storage load error:', e);
            return defaultValue;
        }
    }

    /**
     * 从 localStorage 删除数据
     * @param {string} key - 存储键
     */
    function removeItem(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.error('Storage remove error:', e);
        }
    }

    /**
     * 检查是否存在某个键
     * @param {string} key - 存储键
     * @returns {boolean}
     */
    function hasItem(key) {
        try {
            return localStorage.getItem(key) !== null;
        } catch (e) {
            return false;
        }
    }

    /**
     * 获取所有以指定前缀开头的键
     * @param {string} prefix - 键前缀
     * @returns {string[]}
     */
    function getKeysWithPrefix(prefix) {
        const keys = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix)) {
                    keys.push(key);
                }
            }
        } catch (e) {
            console.error('Storage keys error:', e);
        }
        return keys;
    }

    return {
        setItem,
        getItem,
        removeItem,
        hasItem,
        getKeysWithPrefix
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkStorage = FrameworkStorage;
}