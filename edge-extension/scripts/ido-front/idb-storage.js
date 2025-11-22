/**
 * IndexedDB Storage Layer
 * 提供异步的、高性能的数据持久化方案
 */
(function() {
    window.IdoFront = window.IdoFront || {};

    const DB_NAME = 'IdoFrontDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'state';
    const PLUGINS_STORE = 'plugins';
    const STATE_KEY = 'core.chat.state';
    const PLUGINS_FALLBACK_KEY = 'idofront.external.plugins.v1';

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

                    request.onsuccess = () => resolve();
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

                    request.onsuccess = () => resolve();
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
            }
        };
    }

    window.IdoFront.storage = window.IdoFront.storage || createStorageFacade(window.IdoFront.idbStorage);

})();