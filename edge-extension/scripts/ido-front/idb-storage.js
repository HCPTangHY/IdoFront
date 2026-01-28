/**
 * IndexedDB Storage Layer
 * 提供异步的、高性能的数据持久化方案
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const DB_NAME = 'IdoFrontDB';
    const DB_VERSION = 3;  // v3: 确保 pluginData store 存在
    const STORE_NAME = 'state';
    const PLUGINS_STORE = 'plugins';
    const PLUGIN_DATA_STORE = 'pluginData';  // 插件运行时数据存储
    const STATE_KEY = 'core.chat.state';
    const PLUGINS_FALLBACK_KEY = 'idofront.external.plugins.v1';
    const PLUGIN_DATA_FALLBACK_KEY = 'idofront.plugin.data.v1';

    // 冗余副本：用于 IndexedDB 数据被清理/损坏时恢复
    // 1) localStorage：无需额外权限，但可能被“清理站点数据”影响，且有配额限制
    // 2) chrome.storage.local：通常不随站点数据被清理，更适合扩展（需要 manifest 权限 storage）
    function persistStateShadowToLocalStorage(state) {
        try {
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (e) {
            // localStorage 可能空间不足/被禁用，忽略即可
        }
    }

    function removeStateShadowFromLocalStorage() {
        try {
            localStorage.removeItem(STATE_KEY);
        } catch (e) {
            // ignore
        }
    }

    function persistStateShadowToChromeStorage(state) {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
            chrome.storage.local.set({ [STATE_KEY]: state }, () => {
                // ignore runtime errors
            });
        } catch (e) {
            // ignore
        }
    }

    function removeStateShadowFromChromeStorage() {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
            chrome.storage.local.remove([STATE_KEY], () => {
                // ignore
            });
        } catch (e) {
            // ignore
        }
    }

    class IDBStorage {
        constructor() {
            this.db = null;
            this.initPromise = null;
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

        /**
         * 保存状态
         * @param {Object} state - 要保存的状态对象
         */
        async save(state) {
            try {
                await this.init();

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.put(state, STATE_KEY);

                    request.onsuccess = () => {
                        // 额外保存一份到 localStorage / chrome.storage.local，作为 IDB 被清理/损坏时的兜底
                        persistStateShadowToLocalStorage(state);
                        persistStateShadowToChromeStorage(state);
                        resolve();
                    };
                    request.onerror = () => {
                        console.error('IndexedDB 保存失败:', request.error);
                        reject(request.error);
                    };
                });
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
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.get(STATE_KEY);

                    request.onsuccess = () => {
                        resolve(request.result || null);
                    };
                    request.onerror = () => {
                        console.error('IndexedDB 加载失败:', request.error);
                        reject(request.error);
                    };
                });
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

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.clear();

                    request.onsuccess = () => {
                        // 同步清理 localStorage / chrome.storage.local 影子副本
                        removeStateShadowFromLocalStorage();
                        removeStateShadowFromChromeStorage();
                        console.log('IndexedDB 数据已清除');
                        resolve();
                    };
                    request.onerror = () => {
                        console.error('IndexedDB 清除失败:', request.error);
                        reject(request.error);
                    };
                });
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

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.delete(key);

                    request.onsuccess = () => {
                        if (key === STATE_KEY) {
                            removeStateShadowFromLocalStorage();
                            removeStateShadowFromChromeStorage();
                        }
                        resolve();
                    };
                    request.onerror = () => {
                        console.error('IndexedDB 删除失败:', request.error);
                        reject(request.error);
                    };
                });
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
            async setPluginData(pluginId, key, value) {
                try {
                    const all = await this.getAllPluginDataRaw();
                    if (!all[pluginId]) all[pluginId] = {};
                    all[pluginId][key] = { value, updatedAt: Date.now() };
                    localStorage.setItem(PLUGIN_DATA_FALLBACK_KEY, JSON.stringify(all));
                } catch (error) {
                    console.error('localStorage 保存插件数据失败', error);
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