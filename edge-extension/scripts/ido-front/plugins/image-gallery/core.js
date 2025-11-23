/**
 * Builtin Image Gallery - Core logic
 * 负责任务状态、并发调度以及与 service / runtime.store 的交互。
 *
 * 这是一个「无 UI」模块，只暴露纯 JS API：
 *   window.IdoFront.imageGallery = {
 *     MODE_ID,
 *     getState(),
 *     subscribe(listener),
 *     unsubscribe(listener),
 *     createTasksFromPrompt({ prompt, count }),
 *     runPendingTasks({ concurrency })
 *   }
 */
(function () {
  window.IdoFront = window.IdoFront || {};

  const runtime = window.IdoFront.runtime;
  const service = window.IdoFront.service;

  const gallery = window.IdoFront.imageGallery = window.IdoFront.imageGallery || {};

  const MODE_ID = 'image-gallery';
  const SETTINGS_STORAGE_KEY = 'image-gallery-params'; // 旧版本 localStorage 兼容用
  const SETTINGS_PLUGIN_ID = 'builtin-image-gallery.settings';
  const storageFacade = window.IdoFront.storage;

  function normalizeSettingsInput(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const systemPrompt =
      typeof base.systemPrompt === 'string' ? base.systemPrompt : '';
    const srcParams = Array.isArray(base.params) ? base.params : [];
    const params = srcParams.map(function(item) {
      return {
        key: item && typeof item.key === 'string' ? item.key : '',
        value: item && typeof item.value === 'string' ? item.value : ''
      };
    });
    return {
      systemPrompt: systemPrompt,
      params: params
    };
  }

  function loadSettings() {
    // 初始同步返回默认配置；真实存储内容稍后通过 hydrateSettingsFromStorage 异步覆盖
    return normalizeSettingsInput(null);
  }

  async function hydrateSettingsFromStorage() {
    // 1. 优先从统一的 storage 插件存储中加载
    if (storageFacade && typeof storageFacade.getPlugin === 'function') {
      try {
        const record = await storageFacade.getPlugin(SETTINGS_PLUGIN_ID);
        if (record && record.data && record.data.settings) {
          state.settings = normalizeSettingsInput(record.data.settings);
          notify();
          return;
        }
      } catch (e) {
        console.warn('[imageGallery.core] 从 storage 加载生图参数失败:', e);
      }
    }

    // 2. 兼容旧版本：从 localStorage 迁移一次
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          state.settings = normalizeSettingsInput(parsed);
          notify();

          // 写回到统一 storage 中，便于以后统一管理
          if (storageFacade && typeof storageFacade.savePlugin === 'function') {
            try {
              const payload = {
                id: SETTINGS_PLUGIN_ID,
                enabled: true,
                updatedAt: Date.now(),
                data: {
                  settings: state.settings
                }
              };
              storageFacade.savePlugin(payload);
            } catch (e) {
              console.warn(
                '[imageGallery.core] 迁移生图参数到 storage 失败:',
                e
              );
            }
          }

          // 迁移成功后可以删除旧 key，避免脏数据
          try {
            localStorage.removeItem(SETTINGS_STORAGE_KEY);
          } catch (e) {
            console.warn(
              '[imageGallery.core] 清理旧生图参数 localStorage 失败:',
              e
            );
          }
        }
      } catch (e) {
        console.warn('[imageGallery.core] 兼容加载旧生图参数失败:', e);
      }
    }
  }

  const state = {
    tasks: [],
    lastTaskId: 0,
    settings: loadSettings()
  };

  // 异步从统一存储中加载/迁移生图参数（不会阻塞主流程）
  hydrateSettingsFromStorage();
 
  const listeners = new Set();

  function persistSettings() {
    if (!storageFacade || typeof storageFacade.savePlugin !== 'function') {
      return;
    }
    try {
      const payload = {
        id: SETTINGS_PLUGIN_ID,
        enabled: true,
        updatedAt: Date.now(),
        data: {
          settings: state.settings
        }
      };
      // 异步保存，失败时仅记录日志，不阻塞调用方
      Promise.resolve(storageFacade.savePlugin(payload)).catch(function(e) {
        console.warn('[imageGallery.core] 保存生图参数设置失败:', e);
      });
    } catch (e) {
      console.warn('[imageGallery.core] 保存生图参数设置失败:', e);
    }
  }

  function getSettings() {
    return state.settings;
  }

  function setSettings(next) {
    if (!next || typeof next !== 'object') return;

    const systemPrompt =
      typeof next.systemPrompt === 'string' ? next.systemPrompt : '';

    const rawParams = Array.isArray(next.params) ? next.params : [];
    const normalizedParams = rawParams.map(function(item) {
      return {
        key: item && typeof item.key === 'string' ? item.key : '',
        value: item && typeof item.value === 'string' ? item.value : ''
      };
    });

    state.settings = {
      systemPrompt: systemPrompt,
      params: normalizedParams
    };

    persistSettings();
    notify();
  }

  function buildParamsOverrideFromSettings() {
    const settings = state.settings;
    if (!settings || !Array.isArray(settings.params)) return null;

    const result = {};
    settings.params.forEach(function(item) {
      if (!item || typeof item.key !== 'string') return;
      const key = item.key.trim();
      if (!key) return;
      const raw = typeof item.value === 'string' ? item.value.trim() : '';
      if (!raw) return;

      try {
        // 值为任意合法 JSON：字符串 / 数字 / 布尔 / 数组 / 对象
        const parsed = JSON.parse(raw);
        result[key] = parsed;
      } catch (e) {
        console.warn(
          '[imageGallery.core] 跳过无法解析的高级参数:',
          key,
          e
        );
      }
    });

    return Object.keys(result).length ? result : null;
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (e) {
        console.error('[imageGallery.core] listener error', e);
      }
    });
  }

  function getState() {
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    // 首次订阅立即推送一次当前状态
    try {
      listener(state);
    } catch (e) {
      console.error('[imageGallery.core] listener initial call error', e);
    }
    return () => {
      listeners.delete(listener);
    };
  }

  function unsubscribe(listener) {
    listeners.delete(listener);
  }

  function getActiveChannelConfig() {
    if (!runtime || !runtime.store || typeof runtime.store.getState !== 'function') {
      return null;
    }
    const s = runtime.store.getState(['conversations', 'activeConversationId', 'channels']);
    const conversations = s.conversations || [];
    const activeId = s.activeConversationId;
    const channels = s.channels || [];

    const conv = conversations.find((c) => c.id === activeId) || null;
    if (!conv || !conv.selectedChannelId || !conv.selectedModel) {
      return null;
    }
    const channel = channels.find((ch) => ch.id === conv.selectedChannelId) || null;
    if (!channel) {
      return null;
    }

    return Object.assign({}, channel, {
      model: conv.selectedModel
    });
  }

  function createTask(prompt, extra) {
    if (!prompt || !prompt.trim()) return null;
    const now = Date.now();
    const id = String(++state.lastTaskId);
    const task = {
      id,
      prompt: prompt.trim(),
      status: 'pending', // pending | running | done | error
      createdAt: now,
      updatedAt: now,
      // 用于 Gallery 显示的标准文本（来自渠道适配器 onUpdate 的 data.content）
      displayText: '',
      displayReasoning: null,
      // 原始返回结果（用于调试 / 详情查看）
      result: null,
      error: null,
      meta: Object.assign(
        {
          retries: 0
        },
        extra || {}
      )
    };
    state.tasks.unshift(task);
    return task;
  }

  function createTasksFromPrompt(options) {
    const prompt = (options && options.prompt) || '';
    let count = (options && options.count) || 1;
    if (count < 1) count = 1;
    if (count > 16) count = 16;

    // 允许从 options 透传附件，用于生图模式的传图
    const baseExtra = {};
    if (options && Array.isArray(options.attachments) && options.attachments.length > 0) {
      // 浅拷贝一层，避免外部对数组本身的修改影响内部状态
      baseExtra.attachments = options.attachments.map(function (a) {
        return Object.assign({}, a);
      });
    }

    const created = [];
    for (let i = 0; i < count; i += 1) {
      const extra = Object.assign({ index: i }, baseExtra);
      const t = createTask(prompt, extra);
      if (t) created.push(t);
    }
    if (created.length) {
      notify();
    }
    return created;
  }

  function getTaskById(id) {
    if (!id) return null;
    return state.tasks.find((t) => t.id === String(id)) || null;
  }

  async function runTask(task) {
    if (!service || typeof service.callAI !== 'function') {
      task.status = 'error';
      task.error = 'service.callAI 不可用';
      task.updatedAt = Date.now();
      notify();
      return;
    }
    const channelConfig = getActiveChannelConfig();
    if (!channelConfig) {
      task.status = 'error';
      task.error = '未选择有效的渠道/模型';
      task.updatedAt = Date.now();
      notify();
      return;
    }

    task.status = 'running';
    task.error = null;
    task.updatedAt = Date.now();
    notify();

    // 构造消息：优先注入当前生图视图的系统提示词，再接用户 Prompt
    const messages = [];
    const settings = state.settings || {};

    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      messages.push({
        role: 'system',
        content: settings.systemPrompt.trim()
      });
    }

    const userMessage = {
      role: 'user',
      content: task.prompt
    };

    // 如果任务元数据中带有附件，则按 chat 的约定放入 metadata.attachments
    if (
      task.meta &&
      Array.isArray(task.meta.attachments) &&
      task.meta.attachments.length > 0
    ) {
      userMessage.metadata = {
        attachments: task.meta.attachments
      };
    }

    messages.push(userMessage);

    // 累积来自渠道适配器 onUpdate 的标准化文本（与聊天视图一致：data.content / data.reasoning）
    let fullContent = '';
    let fullReasoning = null;

    const onUpdate = (data) => {
      let text = '';
      let reasoning = null;

      if (typeof data === 'string') {
        text = data;
      } else if (data && typeof data === 'object') {
        if (typeof data.content === 'string') {
          text = data.content;
        }
        if (typeof data.reasoning === 'string') {
          reasoning = data.reasoning;
        }
      }

      if (!text && !reasoning) return;

      if (text) {
        fullContent = text;
      }
      if (reasoning !== null) {
        fullReasoning = reasoning;
      }

      task.displayText = fullContent;
      task.displayReasoning = fullReasoning;
      task.updatedAt = Date.now();
      notify();
    };

    // 应用高级参数：将参数表合并到 channelConfig.paramsOverride，覆盖同名键
    const galleryParamsOverride = buildParamsOverrideFromSettings();
    let effectiveChannelConfig = channelConfig;
    if (galleryParamsOverride) {
      effectiveChannelConfig = Object.assign({}, channelConfig, {
        paramsOverride: Object.assign(
          {},
          channelConfig.paramsOverride || {},
          galleryParamsOverride
        )
      });
    }

    try {
      const result = await service.callAI(
        messages,
        effectiveChannelConfig,
        onUpdate
      );
      task.status = 'done';
      task.result = result;

      // 兜底：如果没有收到任何 onUpdate，但 result 中有通用字段，则尝试填充 displayText
      if (!task.displayText && result && typeof result === 'object') {
        let fallback = '';
        if (typeof result.content === 'string') {
          fallback = result.content;
        } else if (typeof result.text === 'string') {
          fallback = result.text;
        }
        if (fallback) {
          task.displayText = fallback;
        }
      }

      task.updatedAt = Date.now();
      notify();
    } catch (e) {
      task.status = 'error';
      task.error = e && e.message ? e.message : String(e);
      task.updatedAt = Date.now();
      notify();
    }
  }

  async function retryTask(id) {
    const task = getTaskById(id);
    if (!task) {
      return;
    }
    // 只允许在 done / error 状态下重试，避免打断正在运行的任务
    if (task.status === 'running') {
      return;
    }

    task.status = 'pending';
    task.result = null;
    task.error = null;
    task.updatedAt = Date.now();
    if (task.meta) {
      task.meta.retries = (task.meta.retries || 0) + 1;
    } else {
      task.meta = { retries: 1 };
    }
    notify();

    // 异步重新执行该任务
    runTask(task).catch((e) => {
      console.warn('[imageGallery.core] retryTask runTask error:', e);
    });
  }

  async function runPendingTasks(options) {
    const concurrency = (options && options.concurrency) || 4;
    const pending = state.tasks.filter((t) => t.status === 'pending');
    if (!pending.length) return;

    const queue = pending.slice();
    const workers = [];

    const takeNext = async () => {
      while (queue.length) {
        const task = queue.shift();
        if (!task) return;
        // eslint-disable-next-line no-await-in-loop
        await runTask(task);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(takeNext());
    }

    await Promise.all(workers);
  }

  function clearAllTasks() {
    state.tasks = [];
    state.lastTaskId = 0;
    notify();
  }

  /**
   * 用一组已存在的任务完全替换当前画廊（用于“加载已保存画廊”场景）
   * 不做字段校验，假定传入任务结构与内部 state.tasks 一致。
   */
  function replaceTasks(tasks) {
    const incoming = Array.isArray(tasks) ? tasks : [];
    // 深拷贝一层，避免后续外部修改影响内部状态
    state.tasks = incoming.map(function(t) {
      return Object.assign({}, t);
    });

    // 重新计算 lastTaskId，保证后续新任务 ID 递增不冲突
    let maxId = 0;
    state.tasks.forEach(function(t) {
      const idNum = parseInt(t.id, 10);
      if (!Number.isNaN(idNum) && idNum > maxId) {
        maxId = idNum;
      }
    });
    state.lastTaskId = maxId;

    notify();
  }
 
  gallery.MODE_ID = MODE_ID;
  gallery.getState = getState;
  gallery.subscribe = subscribe;
  gallery.unsubscribe = unsubscribe;
  gallery.createTasksFromPrompt = createTasksFromPrompt;
  gallery.runPendingTasks = runPendingTasks;
  gallery.getActiveChannelConfig = getActiveChannelConfig;
  gallery.getTaskById = getTaskById;
  gallery.retryTask = retryTask;
  gallery.clearAllTasks = clearAllTasks;
  gallery.replaceTasks = replaceTasks;
  gallery.getSettings = getSettings;
  gallery.setSettings = setSettings;
})();