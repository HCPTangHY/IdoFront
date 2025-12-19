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
/* Dark theme overrides (applied when plugin adds ido-theme-dark on <html>/<body>) */
:root.ido-theme-dark,
body.ido-theme-dark {
    /* Backgrounds */
    --ido-color-bg-primary: #020617;   /* slate-950 */
    --ido-color-bg-secondary: #0f172a; /* slate-900 */
    --ido-color-bg-tertiary: #1e293b;  /* slate-800 */
    --ido-color-bg-hover: #1e293b;     /* slate-800 */
    --ido-color-bg-active: #334155;    /* slate-700 */
    --ido-color-bg-elevated: #0f172a;  /* slate-900 */

    /* Text */
    --ido-color-text-primary: #f1f5f9;  /* slate-100 */
    --ido-color-text-secondary: #cbd5e1; /* slate-300 */
    --ido-color-text-tertiary: #94a3b8;  /* slate-400 */
    --ido-color-text-disabled: #475569;  /* slate-600 */
    --ido-color-text-muted: #64748b;     /* slate-500 */

    /* Borders */
    --ido-color-border: #1e293b;        /* slate-800 */
    --ido-color-border-hover: #334155;  /* slate-700 */
    --ido-color-border-focus: #60a5fa;  /* blue-400 */
    --ido-color-border-strong: #334155; /* slate-700 */

    /* Primary brand color - brighter for dark background */
    --ido-color-primary: #60a5fa;        /* blue-400 */
    --ido-color-primary-hover: #3b82f6;  /* blue-500 */
    --ido-color-primary-active: #2563eb; /* blue-600 */
    --ido-color-primary-tint: rgba(96, 165, 250, 0.15);
    --ido-color-primary-tint-2: rgba(96, 165, 250, 0.25);

    /* Links */
    --ido-color-link: #60a5fa;           /* blue-400 */
    --ido-color-link-hover: #93c5fd;     /* blue-300 */

    /* Semantic Colors - Dark Theme */
    --ido-color-success-tint: rgba(34, 197, 94, 0.2);
    --ido-color-success-text: #4ade80;   /* green-400 */
    --ido-color-warning-tint: rgba(251, 191, 36, 0.2);
    --ido-color-warning-text: #fbbf24;   /* amber-400 */
    --ido-color-danger-tint: rgba(248, 113, 113, 0.2);
    --ido-color-danger-text: #f87171;    /* red-400 */
    --ido-color-info-tint: rgba(96, 165, 250, 0.2);
    --ido-color-info-text: #60a5fa;      /* blue-400 */

    /* Message Card Colors */
    --card-bg-default: #0f172a;
    --card-bg-edit: #1e293b;
    --card-border: #1e293b;
    --card-border-focus: #60a5fa;
    --action-btn-bg: #1e293b;
    --action-btn-hover: #334155;
    --overlay-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);

    /* Stats Bar Colors */
    --stats-bg: #0f172a;
    --stats-bg-hover: #1e293b;

    /* Code Block Colors (Dark theme) */
    --code-bg: #0d1117;
    --code-header-bg: #161b22;
    --code-border: #30363d;
    --code-text: #e6edf3;
    --code-text-muted: #8b949e;
    --code-lang-color: #8b949e;
    --code-copy-hover-bg: rgba(255, 255, 255, 0.1);

    /* Reasoning/Chain of Thought Colors */
    --reasoning-toggle-bg: #1e293b;
    --reasoning-toggle-bg-hover: #334155;
    --reasoning-toggle-color: #94a3b8;
    --reasoning-toggle-color-hover: #f1f5f9;
    --reasoning-content-bg: #0f172a;
    --reasoning-content-border: #1e293b;
    --reasoning-content-color: #94a3b8;

    /* Table Colors */
    --table-header-bg: #1e293b;
    --table-row-bg: #0f172a;
    --table-row-alt-bg: #1e293b;
    --table-border: #334155;

    /* Base page background & text (override tailwind body bg-light) */
    background-color: #020617;
    color: #f1f5f9;
}

/* Structural layout overrides for dark theme */
/* 整体页面与主容器背景 */
body.ido-theme-dark {
    background-color: #020617 !important;
}

body.ido-theme-dark #app-container {
    background-color: #020617 !important;
}

/* 主视图和左右侧边栏背景与边框 */
body.ido-theme-dark main,
body.ido-theme-dark #left-panel,
body.ido-theme-dark #right-panel {
    background-color: var(--ido-color-bg-primary) !important;
    border-color: var(--ido-color-border) !important;
}

/* 左侧 sidebar 插槽区域 */
body.ido-theme-dark #sidebar-header,
body.ido-theme-dark #slot-sidebar-top,
body.ido-theme-dark #history-list,
body.ido-theme-dark #slot-sidebar-bottom {
    background-color: var(--ido-color-bg-primary) !important;
    border-color: var(--ido-color-border) !important;
}

/* 聊天区域背景 */
body.ido-theme-dark #chat-stream {
    background-color: var(--ido-color-bg-primary) !important;
}

/* 输入区域整体背景与边框 */
body.ido-theme-dark #input-area {
    background-color: var(--ido-color-bg-secondary) !important;
    border-top-color: var(--ido-color-border) !important;
}

/* 文本输入容器 */
body.ido-theme-dark #input-area > .relative {
    background-color: var(--ido-color-bg-primary) !important;
    border-color: var(--ido-color-border) !important;
}

/* 输入框文字颜色 */
body.ido-theme-dark #input-area textarea {
    color: var(--ido-color-text-primary) !important;
}

body.ido-theme-dark #input-area textarea::placeholder {
    color: var(--ido-color-text-tertiary) !important;
}

/* 顶部 Header 在暗色模式下使用深色半透明背景 */
body.ido-theme-dark .ido-header {
    background-color: rgba(15, 23, 42, 0.9) !important;
}

/* 发送按钮在暗色模式下使用主色 */
body.ido-theme-dark #btn-send {
    background-color: var(--ido-color-primary) !important;
}

/* 右侧面板默认容器（网络日志等） */
body.ido-theme-dark #right-panel-default {
    background-color: var(--ido-color-bg-primary) !important;
}

/* Bottom sheet 内容背景 */
body.ido-theme-dark #bottom-sheet-content {
    background-color: var(--ido-color-bg-primary) !important;
}

/* Form elements */
body.ido-theme-dark .ido-form-input,
body.ido-theme-dark .ido-form-textarea,
body.ido-theme-dark .ido-form-select,
body.ido-theme-dark .ido-textarea,
body.ido-theme-dark textarea,
body.ido-theme-dark input[type="text"],
body.ido-theme-dark input[type="password"],
body.ido-theme-dark input[type="email"],
body.ido-theme-dark input[type="number"],
body.ido-theme-dark input[type="url"],
body.ido-theme-dark select {
    background-color: var(--ido-color-bg-secondary) !important;
    border-color: var(--ido-color-border) !important;
    color: var(--ido-color-text-primary) !important;
}

body.ido-theme-dark .ido-form-input:focus,
body.ido-theme-dark .ido-form-textarea:focus,
body.ido-theme-dark .ido-form-select:focus,
body.ido-theme-dark .ido-textarea:focus,
body.ido-theme-dark textarea:focus,
body.ido-theme-dark input:focus,
body.ido-theme-dark select:focus {
    border-color: var(--ido-color-primary) !important;
    box-shadow: 0 0 0 3px var(--ido-color-primary-tint) !important;
}

body.ido-theme-dark textarea::placeholder,
body.ido-theme-dark input::placeholder {
    color: var(--ido-color-text-tertiary) !important;
}

body.ido-theme-dark label {
    color: var(--ido-color-text-primary) !important;
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