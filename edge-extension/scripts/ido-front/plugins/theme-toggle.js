/**
 * Builtin Theme (Light/Dark/System) Toggle Plugin
 * Registers a small icon button in HEADER_ACTIONS slot to switch theme.
 * Theme is applied via CSS classes on documentElement/body:
 *  - ido-theme-light
 *  - ido-theme-dark
 * Preference is stored in Framework.storage under key 'ido.theme'.
 */
(function() {
  if (typeof Framework === 'undefined' || !Framework || !Framework.registerPlugin) {
    console.warn('[builtin-theme-toggle] Framework API not available');
    return;
  }

  const { registerPlugin, SLOTS, storage, events } = Framework;

  const THEME_STORAGE_KEY = 'ido.theme';
  const THEME_LIGHT = 'light';
  const THEME_DARK = 'dark';
  const THEME_SYSTEM = 'system';
  const THEME_ORDER = [THEME_LIGHT, THEME_DARK, THEME_SYSTEM];

  const DARK_THEME_STYLE_ID = 'ido-theme-toggle-dark-style';
  const DARK_THEME_CSS = `
/* ========================================
   Dark Theme - Complete Rewrite
   基于明亮主题结构重写，确保风格统一
   ======================================== */

/* CSS 变量覆盖 */
:root.ido-theme-dark,
body.ido-theme-dark {
    /* 背景色 - 使用 slate 色系 */
    --ido-color-bg-primary: #0f172a;    /* slate-900 - 主背景 */
    --ido-color-bg-secondary: #1e293b;  /* slate-800 - 次级背景 */
    --ido-color-bg-tertiary: #334155;   /* slate-700 - 第三级背景 */
    --ido-color-bg-hover: #334155;      /* slate-700 - 悬停 */
    --ido-color-bg-active: #475569;     /* slate-600 - 激活 */
    --ido-color-bg-elevated: #1e293b;   /* slate-800 - 提升层 */

    /* 文字色 */
    --ido-color-text-primary: #f1f5f9;   /* slate-100 */
    --ido-color-text-secondary: #94a3b8; /* slate-400 */
    --ido-color-text-tertiary: #64748b;  /* slate-500 */
    --ido-color-text-disabled: #475569;  /* slate-600 */
    --ido-color-text-muted: #64748b;     /* slate-500 */

    /* 边框色 */
    --ido-color-border: #334155;         /* slate-700 */
    --ido-color-border-hover: #475569;   /* slate-600 */
    --ido-color-border-focus: #3b82f6;   /* blue-500 */
    --ido-color-border-strong: #475569;  /* slate-600 */

    /* 主色 */
    --ido-color-primary: #3b82f6;         /* blue-500 */
    --ido-color-primary-hover: #2563eb;   /* blue-600 */
    --ido-color-primary-active: #1d4ed8;  /* blue-700 */
    --ido-color-primary-tint: rgba(59, 130, 246, 0.15);
    --ido-color-primary-tint-2: rgba(59, 130, 246, 0.25);

    /* 链接 */
    --ido-color-link: #60a5fa;            /* blue-400 */
    --ido-color-link-hover: #93c5fd;      /* blue-300 */

    /* 语义色 */
    --ido-color-success: #22c55e;
    --ido-color-success-hover: #16a34a;
    --ido-color-success-tint: rgba(34, 197, 94, 0.15);
    --ido-color-success-text: #4ade80;
    --ido-color-warning: #f59e0b;
    --ido-color-warning-hover: #d97706;
    --ido-color-warning-tint: rgba(245, 158, 11, 0.15);
    --ido-color-warning-text: #fbbf24;
    --ido-color-danger: #ef4444;
    --ido-color-danger-hover: #dc2626;
    --ido-color-danger-tint: rgba(239, 68, 68, 0.15);
    --ido-color-danger-text: #f87171;
    --ido-color-info: #06b6d4;
    --ido-color-info-hover: #0891b2;
    --ido-color-info-tint: rgba(6, 182, 212, 0.15);
    --ido-color-info-text: #22d3ee;

    /* 消息卡片 */
    --card-bg-default: #1e293b;
    --card-bg-edit: #334155;
    --card-border: #334155;
    --card-border-focus: #3b82f6;
    --action-btn-bg: #334155;
    --action-btn-hover: #475569;
    --overlay-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4);

    /* 统计栏 */
    --stats-bg: #1e293b;
    --stats-bg-hover: #334155;

    /* 代码块 */
    --code-bg: #0d1117;
    --code-header-bg: #161b22;
    --code-border: #30363d;
    --code-text: #e6edf3;
    --code-text-muted: #8b949e;
    --code-lang-color: #8b949e;
    --code-copy-hover-bg: rgba(255, 255, 255, 0.1);

    /* 推理/思考链 */
    --reasoning-toggle-bg: #334155;
    --reasoning-toggle-bg-hover: #475569;
    --reasoning-toggle-color: #94a3b8;
    --reasoning-toggle-color-hover: #f1f5f9;
    --reasoning-content-bg: #1e293b;
    --reasoning-content-border: #334155;
    --reasoning-content-color: #94a3b8;

    /* 表格 */
    --table-header-bg: #334155;
    --table-row-bg: #1e293b;
    --table-row-alt-bg: #334155;
    --table-border: #475569;
}

/* ======================================== 
   全局基础覆盖
   ======================================== */

body.ido-theme-dark {
    background-color: #0f172a !important;
    color: #f1f5f9 !important;
}

/* 容器 */
body.ido-theme-dark #app-container {
    background-color: #0f172a !important;
}

/* 主区域 */
body.ido-theme-dark main {
    background-color: #0f172a !important;
}

/* ======================================== 
   左侧面板 (历史记录)
   ======================================== */

body.ido-theme-dark #left-panel {
    background-color: #0f172a !important;
    border-color: #334155 !important;
}

body.ido-theme-dark #sidebar-header {
    background-color: #0f172a !important;
    border-color: #334155 !important;
}

body.ido-theme-dark #history-list {
    background-color: #0f172a !important;
}

body.ido-theme-dark #slot-sidebar-top,
body.ido-theme-dark #slot-sidebar-bottom {
    background-color: #0f172a !important;
}

/* ======================================== 
   右侧面板
   ======================================== */

body.ido-theme-dark #right-panel {
    background-color: #0f172a !important;
    border-color: #334155 !important;
}

body.ido-theme-dark #right-panel-default {
    background-color: #0f172a !important;
}

/* ======================================== 
   顶部 Header
   ======================================== */

body.ido-theme-dark .ido-header {
    background-color: rgba(15, 23, 42, 0.95) !important;
    border-color: #334155 !important;
}

/* ======================================== 
   聊天区域
   ======================================== */

body.ido-theme-dark #chat-stream {
    background-color: #0f172a !important;
}

/* ======================================== 
   输入区域 - 统一风格
   ======================================== */

/* 整个输入区域容器 */
body.ido-theme-dark #input-area {
    background-color: #0f172a !important;
    border-top-color: #334155 !important;
}

/* 工具栏 */
body.ido-theme-dark #slot-input-top {
    background-color: transparent !important;
}

/* 输入框外层容器 */
body.ido-theme-dark #input-area > .relative {
    background-color: #1e293b !important;
    border-color: #334155 !important;
}

/* 输入框聚焦时 */
body.ido-theme-dark #input-area > .relative:focus-within {
    border-color: #3b82f6 !important;
    box-shadow: none !important;
}

/* 输入框本身 */
body.ido-theme-dark #user-input {
    background-color: transparent !important;
    color: #f1f5f9 !important;
}

body.ido-theme-dark #user-input::placeholder {
    color: #64748b !important;
}

/* 发送按钮 */
body.ido-theme-dark #btn-send {
    background-color: #3b82f6 !important;
}

body.ido-theme-dark #btn-send:hover {
    background-color: #2563eb !important;
}

/* 输入区域操作按钮 */
body.ido-theme-dark #slot-input-actions-left,
body.ido-theme-dark #slot-input-actions-right {
    color: #94a3b8 !important;
}

/* ======================================== 
   表单元素
   ======================================== */

body.ido-theme-dark input[type="text"],
body.ido-theme-dark input[type="password"],
body.ido-theme-dark input[type="email"],
body.ido-theme-dark input[type="number"],
body.ido-theme-dark input[type="url"],
body.ido-theme-dark textarea,
body.ido-theme-dark select {
    background-color: #1e293b !important;
    border-color: #334155 !important;
    color: #f1f5f9 !important;
}

body.ido-theme-dark input:focus,
body.ido-theme-dark textarea:focus,
body.ido-theme-dark select:focus {
    border-color: #3b82f6 !important;
    outline: none !important;
    box-shadow: none !important;
}

body.ido-theme-dark input::placeholder,
body.ido-theme-dark textarea::placeholder {
    color: #64748b !important;
}

body.ido-theme-dark label {
    color: #f1f5f9 !important;
}

/* ======================================== 
   滚动条
   ======================================== */

body.ido-theme-dark ::-webkit-scrollbar-thumb {
    background: #475569 !important;
}

body.ido-theme-dark ::-webkit-scrollbar-thumb:hover {
    background: #64748b !important;
}

body.ido-theme-dark ::-webkit-scrollbar-track {
    background: transparent !important;
}

/* ======================================== 
   JSON 语法高亮
   ======================================== */

body.ido-theme-dark .json-key { color: #f472b6 !important; }
body.ido-theme-dark .json-string { color: #4ade80 !important; }
body.ido-theme-dark .json-number { color: #60a5fa !important; }
body.ido-theme-dark .json-boolean { color: #c084fc !important; }
body.ido-theme-dark .json-null { color: #64748b !important; }

/* ======================================== 
   Bottom Sheet
   ======================================== */

body.ido-theme-dark #bottom-sheet-content {
    background-color: #0f172a !important;
}

/* ======================================== 
   快速导航
   ======================================== */

body.ido-theme-dark .ido-quick-nav {
    background-color: #1e293b !important;
    border-color: #334155 !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}

body.ido-theme-dark .ido-quick-nav__btn {
    color: #94a3b8 !important;
    border-color: #334155 !important;
}

body.ido-theme-dark .ido-quick-nav__btn:hover {
    background-color: #334155 !important;
    color: #3b82f6 !important;
}

body.ido-theme-dark .ido-quick-nav__btn:not(:last-child) {
    border-bottom-color: #334155 !important;
}
`;

  function ensureDarkThemeStyle() {
    if (typeof document === 'undefined') return;
    var doc = document;
    var head = doc.head || doc.getElementsByTagName('head')[0];
    if (!head) return;
    if (doc.getElementById(DARK_THEME_STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = DARK_THEME_STYLE_ID;
    style.type = 'text/css';
    style.appendChild(doc.createTextNode(DARK_THEME_CSS));
    head.appendChild(style);
  }

  function removeDarkThemeStyle() {
    if (typeof document === 'undefined') return;
    var style = document.getElementById(DARK_THEME_STYLE_ID);
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  let currentTheme = THEME_SYSTEM;
  let systemMedia = null;
  let systemMediaListener = null;
  let settingsReadyListenerAttached = false;

  function getSystemTheme() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return THEME_DARK;
      }
    } catch (e) {
      // ignore
    }
    return THEME_LIGHT;
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    const body = document.body || null;

    let effectiveTheme = theme;
    if (theme === THEME_SYSTEM) {
      effectiveTheme = getSystemTheme();
    }

    const classes = ['ido-theme-light', 'ido-theme-dark'];
    classes.forEach(function(cls) {
      root.classList.remove(cls);
      if (body) body.classList.remove(cls);
    });

    if (effectiveTheme === THEME_DARK) {
      root.classList.add('ido-theme-dark');
      if (body) body.classList.add('ido-theme-dark');
    } else {
      root.classList.add('ido-theme-light');
      if (body) body.classList.add('ido-theme-light');
    }

    try {
      storage.setItem(THEME_STORAGE_KEY, theme);
    } catch (e) {
      console.warn('[builtin-theme-toggle] failed to persist theme', e);
    }

    if (events && typeof events.emit === 'function') {
      try {
        events.emit('theme:changed', {
          theme,
          effectiveTheme
        });
      } catch (e) {
        console.warn('[builtin-theme-toggle] theme:changed handler error:', e);
      }
    }
  }

  function loadInitialTheme() {
    let saved = THEME_SYSTEM;
    try {
      const v = storage.getItem(THEME_STORAGE_KEY, THEME_SYSTEM);
      if (v === THEME_LIGHT || v === THEME_DARK || v === THEME_SYSTEM) {
        saved = v;
      }
    } catch (e) {
      saved = THEME_SYSTEM;
    }
    currentTheme = saved;
    applyTheme(currentTheme);
  }

  function initSystemListener() {
    if (!window.matchMedia) return;
    try {
      systemMedia = window.matchMedia('(prefers-color-scheme: dark)');
      systemMediaListener = function() {
        if (currentTheme === THEME_SYSTEM) {
          applyTheme(currentTheme);
        }
      };
      if (typeof systemMedia.addEventListener === 'function') {
        systemMedia.addEventListener('change', systemMediaListener);
      } else if (typeof systemMedia.addListener === 'function') {
        systemMedia.addListener(systemMediaListener);
      }
    } catch (e) {
      console.warn('[builtin-theme-toggle] unable to attach system theme listener', e);
    }
  }

  function cleanupSystemListener() {
    if (!systemMedia || !systemMediaListener) return;
    try {
      if (typeof systemMedia.removeEventListener === 'function') {
        systemMedia.removeEventListener('change', systemMediaListener);
      } else if (typeof systemMedia.removeListener === 'function') {
        systemMedia.removeListener(systemMediaListener);
      }
    } catch (e) {
      console.warn('[builtin-theme-toggle] cleanup system listener error', e);
    }
    systemMedia = null;
    systemMediaListener = null;
  }

  function nextTheme(theme) {
    const idx = THEME_ORDER.indexOf(theme);
    if (idx === -1) return THEME_SYSTEM;
    return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
  }

  function getThemeLabel(theme) {
    if (theme === THEME_LIGHT) return '亮';
    if (theme === THEME_DARK) return '暗';
    return '系统';
  }

  function getThemeTitle(theme) {
    if (theme === THEME_LIGHT) return '主题：亮色';
    if (theme === THEME_DARK) return '主题：暗色';
    return '主题：跟随系统';
  }

  function getThemeIcon(theme) {
    if (theme === THEME_LIGHT) return 'light_mode';
    if (theme === THEME_DARK) return 'dark_mode';
    return 'contrast';
  }

  function registerThemeSettingsSection() {
    if (!window.IdoFront || !window.IdoFront.settingsManager || typeof window.IdoFront.settingsManager.registerGeneralSection !== 'function') {
      return;
    }
    try {
      var sm = window.IdoFront.settingsManager;
      sm.registerGeneralSection({
        id: 'theme',
        title: '主题',
        description: '切换界面主题：亮色 / 暗色 / 跟随系统。',
        icon: 'dark_mode',
        category: '外观',
        tags: ['theme', '主题', '亮色', '暗色', 'system'],
        advanced: false,
        order: 10,
        render: function(container) {
          container.innerHTML = '';

          var group = document.createElement('div');
          group.className = 'ido-form-group';

          var label = document.createElement('div');
          label.className = 'ido-form-label';
          label.textContent = '界面主题';
          group.appendChild(label);

          var options = document.createElement('div');
          options.className = 'flex items-center gap-4 text-xs';

          function createOption(value, text) {
            var optLabel = document.createElement('label');
            optLabel.className = 'inline-flex items-center gap-1 cursor-pointer text-gray-600';

            var input = document.createElement('input');
            input.type = 'radio';
            input.name = 'ido-theme-mode';
            input.value = value;
            input.className = 'mr-1';
            if (currentTheme === value) {
              input.checked = true;
            }

            input.onchange = function() {
              if (!this.checked) return;
              currentTheme = value;
              applyTheme(currentTheme);
            };

            var span = document.createElement('span');
            span.textContent = text;

            optLabel.appendChild(input);
            optLabel.appendChild(span);
            return optLabel;
          }

          options.appendChild(createOption(THEME_LIGHT, '亮色'));
          options.appendChild(createOption(THEME_DARK, '暗色'));
          options.appendChild(createOption(THEME_SYSTEM, '跟随系统'));

          group.appendChild(options);
          container.appendChild(group);
        }
      });
    } catch (e) {
      console.warn('[builtin-theme-toggle] registerThemeSettingsSection error:', e);
    }
  }

  registerPlugin(SLOTS.HEADER_ACTIONS, 'builtin-theme-toggle', {
    meta: {
      id: 'builtin-theme-toggle',
      name: '主题切换',
      description: '提供亮色 / 暗色 / 跟随系统的主题切换能力（入口位于“通用设置”）。',
      version: '1.0.0',
      icon: 'dark_mode',
      author: 'IdoFront',
      homepage: '',
      source: 'builtin'
    },
    init: function() {
      ensureDarkThemeStyle();
      loadInitialTheme();
      initSystemListener();

      // 尝试立即注册（兼容 settingsManager 已就绪的情况）
      registerThemeSettingsSection();

      // 监听设置管理器就绪事件，确保在 settingsManager.init 之后也能完成注册
      if (typeof document !== 'undefined' && !settingsReadyListenerAttached) {
        try {
          document.addEventListener('IdoFrontSettingsReady', function() {
            registerThemeSettingsSection();
          });
          settingsReadyListenerAttached = true;
        } catch (e) {
          console.warn('[builtin-theme-toggle] attach IdoFrontSettingsReady listener error:', e);
        }
      }
    },
    destroy: function() {
      cleanupSystemListener();
      try {
        var root = document.documentElement;
        var body = document.body || null;
        ['ido-theme-light', 'ido-theme-dark'].forEach(function(cls) {
          root.classList.remove(cls);
          if (body) body.classList.remove(cls);
        });
      } catch (e) {
        console.warn('[builtin-theme-toggle] cleanup theme classes error', e);
      }
      removeDarkThemeStyle();
    }
  });
})();