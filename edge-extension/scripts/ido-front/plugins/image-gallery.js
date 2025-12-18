/**
 * Builtin Image Gallery Main-View Plugin
 * 以“外部插件”的方式注册，但代码打包在扩展内：
 * - 使用 Framework.registerPlugin/SLOTS 等 API
 * - 通过 Framework.setMode('image-gallery', ...) 接管主视图
 * - 可被 pluginSettings 作为 "框架插件" 开关（依赖 Framework.getPlugins + setPluginEnabled）
 */
(function() {
    // 在 sidepanel 中 Framework 以全局变量存在，这里直接使用全局绑定
    if (typeof Framework === 'undefined' || !Framework || !Framework.registerPlugin) {
        console.warn('[builtin-image-gallery] Framework API not available');
        return;
    }

    const {
        registerPlugin,
        unregisterPlugin,
        SLOTS,
        ui,
        setMode,
        getCurrentMode
    } = Framework;

    // 引用核心逻辑与视图模块
    const imageGallery = window.IdoFront && window.IdoFront.imageGallery;
    const imageGalleryView = window.IdoFront && window.IdoFront.imageGalleryView;
 
    // 生图视图开关按钮及模式提示 / 控制区引用，用于根据当前模式更新 UI
    let galleryToggleButton = null;
    let galleryModeHintSpan = null;
    let modeChangeHandler = null;
    let settingsBackHandler = null;
    let generationControlsGroup = null;
    let countInputEl = null;
    let sendClickHandler = null;
    // 仅在生图模式下展示的参数按钮与分隔符
    let paramsButton = null;
    let paramsSepBefore = null;
    let controlsSep = null;

    function updateGalleryToggleAppearance(mode) {
        if (!galleryToggleButton) return;
        const isActive = mode === MODE_ID;
 
        // 更新按钮样式
        let className = 'ido-btn ido-btn--ghost text-[11px] gap-1';
        if (isActive) {
            className += ' bg-blue-50 text-blue-600';
        }
        galleryToggleButton.className = className;
 
        // 更新按钮文案
        const labelSpan = galleryToggleButton.querySelector('[data-role="label"]');
        if (labelSpan) {
            labelSpan.textContent = isActive ? '返回对话' : '生图视图';
        }
 
 
        // 生图模式下才展示参数按钮、分隔符以及张数 + 生成按钮
        if (paramsButton) {
            paramsButton.style.display = isActive ? 'inline-flex' : 'none';
        }
        if (paramsSepBefore) {
            paramsSepBefore.style.display = isActive ? 'inline' : 'none';
        }
        if (controlsSep) {
            controlsSep.style.display = isActive ? 'inline' : 'none';
        }
        if (generationControlsGroup) {
            generationControlsGroup.style.display = isActive ? 'flex' : 'none';
        }
    }

    // 插件 ID 不以 core- 开头，这样会自动出现在插件设置页的“框架插件”列表中
    // 将开关放在输入框上方工具栏，更贴近输入区域
    const PLUGIN_SLOT = SLOTS.INPUT_TOP;
    const PLUGIN_ID = 'builtin-image-gallery';
    const MODE_ID = 'image-gallery';
 
    function ensureGalleryViewAvailable() {
        if (!imageGalleryView || typeof imageGalleryView.renderMain !== 'function' || typeof imageGalleryView.renderSidebar !== 'function') {
            console.warn('[builtin-image-gallery] 视图模块未就绪');
            return false;
        }
        return true;
    }
 
    function switchToGalleryMode(api) {
        if (!ensureGalleryViewAvailable()) return;
        const ctx = api || Framework;
        ctx.setMode(MODE_ID, {
            sidebar: function(container) {
                imageGalleryView.renderSidebar(container);
            },
            main: function(container) {
                imageGalleryView.renderMain(container, ctx);
            }
        });
    }
 
    /**
     * 侧边栏内容代理到 view 模块
     */
    function renderGallerySidebar(container) {
        if (!ensureGalleryViewAvailable()) {
            container.innerHTML = '<div class="p-2 text-[11px] text-gray-400">生图视图模块加载中…</div>';
            return;
        }
        imageGalleryView.renderSidebar(container);
    }
 
    /**
     * 主视图内容代理到 view 模块
     */
    function renderGalleryMain(container) {
        if (!ensureGalleryViewAvailable()) {
            container.innerHTML = '<div class="p-2 text-[11px] text-gray-400">生图视图模块加载中…</div>';
            return;
        }
        imageGalleryView.renderMain(container, Framework);
    }
 
    /**
     * 根据给定 Prompt 创建任务并触发并发执行（不关心 Prompt 来源）
     * 会同时从 fileUpload 读取当前附件，在生图模式下支持“传图”。
     */
    function generateFromPrompt(prompt) {
        if (!imageGallery || typeof imageGallery.createTasksFromPrompt !== 'function') {
            console.warn('[builtin-image-gallery] imageGallery core 不可用，无法生成');
            return;
        }
        const text = (prompt || '').trim();
        if (!text) return;
 
        let count = 1;
        if (countInputEl) {
            const parsed = parseInt(countInputEl.value, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                count = Math.min(parsed, 16);
            }
        }

        // 从全局 fileUpload 插件获取当前附件（与 chat 共享同一附件来源）
        let attachments = null;
        try {
            const fileUpload = window.IdoFront && window.IdoFront.fileUpload;
            if (fileUpload && typeof fileUpload.getAttachedFiles === 'function') {
                const files = fileUpload.getAttachedFiles() || [];
                if (files.length > 0) {
                    // 仅保留可序列化且对渠道有用的字段，避免直接传递 File 对象
                    attachments = files.map(function (f) {
                        return {
                            dataUrl: f.dataUrl,
                            type: f.type,
                            name: f.name,
                            size: f.size
                        };
                    });
                }
            }
        } catch (e) {
            console.warn('[builtin-image-gallery] 读取附件失败:', e);
        }
 
        try {
            imageGallery.createTasksFromPrompt({
                prompt: text,
                count: count,
                attachments: attachments || []
            });

            // 生图任务创建后清空附件预览，语义与 chat 发送后清空一致
            try {
                const fileUpload = window.IdoFront && window.IdoFront.fileUpload;
                if (fileUpload && typeof fileUpload.clearAttachments === 'function') {
                    fileUpload.clearAttachments();
                }
            } catch (e) {
                console.warn('[builtin-image-gallery] 清空附件失败:', e);
            }

            if (typeof imageGallery.runPendingTasks === 'function') {
                // 并发数量与张数保持一致
                const concurrency = count || 1;
                Promise.resolve(
                    imageGallery.runPendingTasks({ concurrency })
                ).catch((e) => {
                    console.warn('[builtin-image-gallery] runPendingTasks error:', e);
                });
            }
        } catch (e) {
            console.warn('[builtin-image-gallery] 生成任务失败:', e);
        }
    }
 
    /**
     * 从当前输入框 Prompt 创建任务并触发并发执行（工具条“生成”按钮使用）
     * 在生图模式下统一采用「提交后清空输入框」的语义，与聊天发送保持一致。
     * 同时重置高度，避免长文本撑高后在清空时无法收缩的问题。
     */
    function handleGenerate(frameworkApi) {
        const textarea = document.getElementById('user-input');
        if (!textarea) {
            console.warn('[builtin-image-gallery] 找不到 user-input 文本区域');
            return;
        }
        const prompt = (textarea.value || '').trim();
        if (!prompt) return;

        generateFromPrompt(prompt);

        // 与聊天发送行为保持一致：触发生成后清空输入框并恢复高度
        textarea.value = '';
        textarea.style.height = 'auto';
    }

    /**
     * 在输入框上方插槽中注册生图工具条：
     * - 左侧：生图视图开关（切换 chat / image-gallery，带 on/off 状态）
     * - 右侧：模式提示（对话 / 生图）
     *
     * 输入框本身仍沿用聊天界面的 textarea / 文件 / 发送按钮，
     * 这里只在输入框上方提供与生图相关的附加控制。
     */
    registerPlugin(PLUGIN_SLOT, PLUGIN_ID, {
        meta: {
            id: PLUGIN_ID,
            name: '生图工具',
            description: '在输入框上方提供生图视图开关、参数设置和张数组合生成控制。',
            version: '0.1.0',
            icon: 'photo_library',
            author: 'IdoFront',
            homepage: '',
            source: 'builtin',
            listable: true  // 显式标记为可列出，以便在插件列表中显示
        },
        init(frameworkApi) {
            const api = frameworkApi || Framework;
            if (!api || !api.events || typeof api.events.on !== 'function') return;
 
            modeChangeHandler = (payload) => {
                const mode = payload && payload.mode;
                if (!mode) return;
                updateGalleryToggleAppearance(mode);
            };
            api.events.on('mode:changed', modeChangeHandler);

            // 从设置返回时，如果上一模式是生图，则恢复生图主视图
            settingsBackHandler = (payload) => {
                const prev = payload && payload.previousMode;
                if (prev === MODE_ID) {
                    switchToGalleryMode(api);
                }
            };
            api.events.on('settings:back', settingsBackHandler);
 
            // 监听全局发送按钮点击，在生图模式下复用发送键触发生成
            try {
                const btnSend = document.getElementById('btn-send');
                const inputEl = document.getElementById('user-input');
                if (btnSend && btnSend.addEventListener) {
                    sendClickHandler = function () {
                        const modeNow =
                            typeof api.getCurrentMode === 'function'
                                ? api.getCurrentMode()
                                : 'chat';
                        if (modeNow !== MODE_ID) return;

                        // 在生图模式下复用 handleGenerate，实现统一的「生成并清空输入框」语义
                        handleGenerate(api);
                    };
                    btnSend.addEventListener('click', sendClickHandler);
                }
            } catch (e) {
                console.warn('[builtin-image-gallery] attach send handler error:', e);
            }
        },
        render(frameworkApi) {
            const api = frameworkApi || Framework;

            const container = document.createElement('div');
            container.className = 'flex items-center gap-2'; // 移除 w-full 和 justify-between，让容器自适应内容宽度
            container.style.order = '90'; // 辅助工具，排在右侧
            container.style.marginLeft = 'auto'; // 利用 auto margin 推向右侧

            // 左侧：视图开关
            const leftGroup = document.createElement('div');
            leftGroup.className = 'flex items-center gap-1';

            const currentMode =
                typeof api.getCurrentMode === 'function'
                    ? api.getCurrentMode()
                    : 'chat';

            const btn = document.createElement('button');
            btn.className = 'ido-btn ido-btn--ghost text-[11px] gap-1';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined text-[16px]';
            iconSpan.textContent = 'image';

            const labelSpan = document.createElement('span');
            labelSpan.dataset.role = 'label';
            labelSpan.textContent = currentMode === MODE_ID ? '返回对话' : '生图视图';

            btn.appendChild(iconSpan);
            btn.appendChild(labelSpan);

            btn.onclick = () => {
                const modeNow =
                    typeof api.getCurrentMode === 'function'
                        ? api.getCurrentMode()
                        : 'chat';
                const nextMode = modeNow === MODE_ID ? 'chat' : MODE_ID;
 
                if (nextMode === 'chat') {
                    api.setMode('chat');
                } else {
                    switchToGalleryMode(api);
                }
 
                // 立即更新按钮和提示的外观
                updateGalleryToggleAppearance(nextMode);
            };

            leftGroup.appendChild(btn);

            // 右侧：参数设置按钮 + 模式提示 + 生图控制（仅在生图模式下显示）
            const rightGroup = document.createElement('div');
            rightGroup.className = 'flex items-center gap-2 text-[11px] text-gray-500';
            
            // 参数设置按钮
            const paramsBtn = document.createElement('button');
            paramsBtn.className = 'ido-btn ido-btn--ghost text-[11px] gap-1';
            paramsBtn.title = '生图参数设置';
            
            const paramsIcon = document.createElement('span');
            paramsIcon.className = 'material-symbols-outlined text-[16px]';
            paramsIcon.textContent = 'tune';
            
            const paramsLabel = document.createElement('span');
            paramsLabel.textContent = '参数';
            
            paramsBtn.appendChild(paramsIcon);
            paramsBtn.appendChild(paramsLabel);
            
            paramsBtn.onclick = () => {
                if (imageGalleryView && typeof imageGalleryView.showParametersSheet === 'function') {
                    imageGalleryView.showParametersSheet(api);
                }
            };
            
            rightGroup.appendChild(paramsBtn);
            
            const sep0 = document.createElement('span');
            sep0.className = 'text-gray-300';
            sep0.textContent = '·';
            rightGroup.appendChild(sep0);
 
            const sep = document.createElement('span');
            sep.className = 'text-gray-300';
            sep.textContent = '·';
            rightGroup.appendChild(sep);
 
            const controlsGroup = document.createElement('div');
            controlsGroup.className = 'flex items-center gap-1';
 
            const countLabel = document.createElement('span');
            countLabel.textContent = '张数';
 
            const countInput = document.createElement('input');
            countInput.type = 'number';
            countInput.min = '1';
            countInput.max = '16';
            countInput.value = '4';
            countInput.className =
                'w-12 border border-gray-300 rounded px-1 py-0.5 bg-white ' +
                'focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';
 
            const genBtn = document.createElement('button');
            genBtn.className =
                'ido-btn ido-btn--primary text-[11px] px-2 py-0.5 flex items-center gap-1';
            genBtn.title = '根据下方 Prompt 创建生图任务';
 
            const genIcon = document.createElement('span');
            genIcon.className = 'material-symbols-outlined text-[14px]';
            genIcon.textContent = 'auto_awesome';
 
            const genLabel = document.createElement('span');
            genLabel.textContent = '生成';
 
            genBtn.appendChild(genIcon);
            genBtn.appendChild(genLabel);
 
            genBtn.onclick = () => {
                handleGenerate(api);
            };
 
            controlsGroup.appendChild(countLabel);
            controlsGroup.appendChild(countInput);
            controlsGroup.appendChild(genBtn);
 
            rightGroup.appendChild(controlsGroup);
 
            container.appendChild(leftGroup);
            container.appendChild(rightGroup);
 
            // 保存引用，供模式变化时更新 UI
            galleryToggleButton = btn;
            galleryModeHintSpan = null;
            generationControlsGroup = controlsGroup;
            countInputEl = countInput;
            paramsButton = paramsBtn;
            paramsSepBefore = sep0;
            controlsSep = sep;
            updateGalleryToggleAppearance(currentMode);
 
            return container;
        },
        destroy: () => {
            // 清理模式事件订阅
            try {
                if (modeChangeHandler && Framework && Framework.events && typeof Framework.events.off === 'function') {
                    Framework.events.off('mode:changed', modeChangeHandler);
                }
                if (settingsBackHandler && Framework && Framework.events && typeof Framework.events.off === 'function') {
                    Framework.events.off('settings:back', settingsBackHandler);
                }
            } catch (e) {
                console.warn('[builtin-image-gallery] cleanup mode/settings handlers error:', e);
            }
 
            // 清理发送按钮监听
            try {
                const btnSend = document.getElementById('btn-send');
                if (btnSend && sendClickHandler && btnSend.removeEventListener) {
                    btnSend.removeEventListener('click', sendClickHandler);
                }
            } catch (e) {
                console.warn('[builtin-image-gallery] cleanup send handler error:', e);
            }
 
            modeChangeHandler = null;
            settingsBackHandler = null;
            galleryToggleButton = null;
            galleryModeHintSpan = null;
            generationControlsGroup = null;
            countInputEl = null;
            sendClickHandler = null;
        }
    });

    // 可选：暴露一个 cleanup 函数供调试/热替换使用（不会被框架自动调用）
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.builtinImageGalleryCleanup = function builtinImageGalleryCleanup() {
        try {
            if (typeof unregisterPlugin === 'function') {
                unregisterPlugin(PLUGIN_SLOT, PLUGIN_ID);
            }
            if (typeof getCurrentMode === 'function' && getCurrentMode() === MODE_ID) {
                setMode('chat');
            }
        } catch (e) {
            console.warn('[builtin-image-gallery] manual cleanup error:', e);
        }
    };
})();