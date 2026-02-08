/**
 * Markdown 渲染模块
 * 负责 Markdown 解析、代码高亮、LaTeX 公式渲染
 */
const FrameworkMarkdown = (function() {
    'use strict';

    // markdown-it 实例（延迟初始化）
    let md = null;

    // 渲染队列与调度
    const renderQueue = [];
    let renderHandle = null;
    const sourceByTarget = new WeakMap();
    const renderedSourceByTarget = new WeakMap();
    
    const scheduleIdle = (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
        ? (cb => window.requestIdleCallback(cb, { timeout: 120 }))
        : (cb => setTimeout(() => cb({
            didTimeout: true,
            timeRemaining: () => 50
        }), 16));

    const scheduleSoon = (cb => setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 50 }), 60));

    const IDLE_BATCH_BUDGET_MS = 12;
    const IDLE_BATCH_MAX_TASKS = 1;
    const IDLE_MIN_TIME_REMAINING_MS = 8;
    const MAX_CODE_HIGHLIGHT_CHARS = 12000;
    const MAX_CODE_HIGHLIGHT_LINES = 400;

    function rememberSource(target, markdownText) {
        if (!target) return '';
        const safeText = typeof markdownText === 'string' ? markdownText : '';
        sourceByTarget.set(target, safeText);
        return safeText;
    }

    function getRememberedSource(target, fallbackText) {
        if (!target) return '';
        if (sourceByTarget.has(target)) {
            return sourceByTarget.get(target) || '';
        }
        return typeof fallbackText === 'string' ? fallbackText : '';
    }

    function isLargeCodeBlock(text) {
        if (typeof text !== 'string' || text.length === 0) return false;
        if (text.length > MAX_CODE_HIGHLIGHT_CHARS) return true;

        let lines = 1;
        for (let i = 0; i < text.length; i += 1) {
            if (text.charCodeAt(i) === 10) {
                lines += 1;
                if (lines > MAX_CODE_HIGHLIGHT_LINES) return true;
            }
        }
        return false;
    }

    /**
     * 获取或初始化 markdown-it 实例
     */
    function getMarkdownIt() {
        if (md) return md;

        if (typeof markdownit === 'undefined') {
            console.warn('markdown-it not loaded yet');
            return null;
        }

        md = markdownit({
            html: true,
            linkify: true,
            typographer: true,
            breaks: false,
            highlight: function(str, lang) {
                if (isLargeCodeBlock(str)) {
                    return md.utils.escapeHtml(str);
                }

                if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
                    } catch (e) {
                        console.warn('Highlight.js error:', e);
                    }
                }
                return md.utils.escapeHtml(str);
            }
        });

        return md;
    }

    /**
     * 检查内容是否像有效的 LaTeX 公式
     */
    function isValidLatexContent(content) {
        if (!content || content.trim().length === 0) return false;

        // 如果包含太多中文，通常不是公式
        const chineseMatch = content.match(/[\u4e00-\u9fa5]/g);
        const chineseRatio = chineseMatch ? chineseMatch.length / content.length : 0;
        if (chineseRatio > 0.4) return false;

        // 只要不是纯空格，且通过了中文比例检查，就允许 KaTeX 尝试渲染
        // KaTeX 渲染失败会安全地返回原文本，所以我们可以放宽限制
        return true;
    }

    /**
     * 预处理 LaTeX 公式
     */
    function preprocessLatex(text) {
        if (typeof katex === 'undefined' || !text) return text;
        if (text.indexOf('$') === -1) return text;

        const codeBlocks = [];
        // 提取代码块并用占位符替换
        // The regex matches both fenced code blocks (```...```) and inline code (`...`)
        let processedText = text.replace(/(`{3,})[\s\S]*?\1|`[^`]*`/g, (match) => {
            const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
            codeBlocks.push(match);
            return placeholder;
        });

        // 块级公式 $$...$$
        processedText = processedText.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
            if (!isValidLatexContent(formula)) return match;
            try {
                return '<div class="katex-display">' + katex.renderToString(formula.trim(), {
                    throwOnError: false,
                    displayMode: true,
                    strict: false
                }) + '</div>';
            } catch (e) {
                console.warn('KaTeX block error:', e);
                return match;
            }
        });

        // 行内公式 $...$
        // 改进正则：
        // 1. 前面不能是字母、数字或反斜杠（防止匹配 $10 和 $20）
        // 2. $ 后面不能紧跟空格，且结束的 $ 前面不能是空格（标准 Markdown 数学语法）
        // 3. 后面不能是字母或数字
        processedText = processedText.replace(/(?<![\\a-zA-Z0-9])\$([^\s\$](?:[^\$]*[^\s\$])?)\$(?![a-zA-Z0-9])/g, (match, formula) => {
            if (!isValidLatexContent(formula)) return match;
            try {
                return katex.renderToString(formula.trim(), {
                    throwOnError: false,
                    displayMode: false,
                    strict: false
                });
            } catch (e) {
                console.warn('KaTeX inline error:', e);
                return match;
            }
        });

        // 恢复代码块
        if (codeBlocks.length > 0) {
            processedText = processedText.replace(/__CODE_BLOCK_PLACEHOLDER_(\d+)__/g, (match, index) => {
                return codeBlocks[parseInt(index, 10)] || match;
            });
        }

        return processedText;
    }

    /**
     * 为代码块添加工具栏
     */
    function enhanceCodeBlocks(container) {
        const codeBlocks = container.querySelectorAll('pre > code');

        codeBlocks.forEach((code) => {
            const pre = code.parentElement;
            if (!pre || pre.dataset.enhanced) return;
            pre.dataset.enhanced = 'true';

            const langClass = Array.from(code.classList).find(c => c.startsWith('language-') || c.startsWith('hljs-'));
            let lang = 'text';
            if (langClass) {
                lang = langClass.replace('language-', '').replace('hljs-', '');
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';

            const header = document.createElement('div');
            header.className = 'code-block-header';
            header.title = '点击折叠/展开代码';

            const collapseIcon = document.createElement('span');
            collapseIcon.className = 'code-collapse-icon material-symbols-outlined';
            collapseIcon.textContent = 'expand_more';

            const rightSection = document.createElement('div');
            rightSection.className = 'code-header-right';

            const langLabel = document.createElement('span');
            langLabel.className = 'code-lang';
            langLabel.textContent = lang;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-copy-btn';
            copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span><span>复制</span>';
            copyBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(code.textContent);
                    copyBtn.innerHTML = '<span class="material-symbols-outlined">check</span><span>已复制</span>';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span><span>复制</span>';
                    }, 2000);
                } catch (err) {
                    console.warn('Copy failed:', err);
                }
            };

            header.onclick = () => {
                wrapper.classList.toggle('collapsed');
            };

            rightSection.appendChild(langLabel);
            rightSection.appendChild(copyBtn);

            header.appendChild(collapseIcon);
            header.appendChild(rightSection);

            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(header);
            wrapper.appendChild(pre);
        });
    }

    /**
     * 同步渲染 Markdown（用于流式更新）
     */
    function renderSync(target, markdownText, options) {
        if (!target) return;
        const renderOptions = options && typeof options === 'object' ? options : {};

        const safeText = typeof markdownText === 'string' ? markdownText : '';
        rememberSource(target, safeText);

        const mdInstance = getMarkdownIt();
        if (!mdInstance) {
            target.textContent = safeText;
            target.dataset.needsMarkdown = 'true';
            enqueueRender(target, safeText);
            return;
        }

        try {
            const preprocessed = preprocessLatex(getRememberedSource(target, safeText));
            target.innerHTML = mdInstance.render(preprocessed);
            target.classList.add('markdown-body');
            const skipEnhance = !!renderOptions.skipEnhance || isLargeCodeBlock(safeText);
            if (!skipEnhance) {
                enhanceCodeBlocks(target);
            }
            renderedSourceByTarget.set(target, getRememberedSource(target, safeText));
            target.removeAttribute('data-needs-markdown');
        } catch (err) {
            console.warn('Markdown sync render failed:', err);
            target.textContent = safeText;
            renderedSourceByTarget.set(target, safeText);
        }
    }

    /**
     * 异步渲染 Markdown（使用 idle callback）
     */
    function enqueueRender(target, markdownText) {
        if (!target) return;
        const safeText = rememberSource(target, markdownText);
        if (renderedSourceByTarget.get(target) === safeText) {
            target.removeAttribute('data-needs-markdown');
            return;
        }

        if (!target.textContent) {
            target.textContent = safeText;
        }

        // 移除队列中同一目标的旧任务
        for (let i = renderQueue.length - 1; i >= 0; i -= 1) {
            if (renderQueue[i].target === target) {
                renderQueue.splice(i, 1);
            }
        }

        renderQueue.push({ target, markdownText: safeText });

        if (!renderHandle) {
            renderHandle = scheduleIdle(processRenderQueue);
        }
    }

    /**
     * 处理渲染队列
     */
    function processRenderQueue(deadline) {
        renderHandle = null;
        const mdInstance = getMarkdownIt();
        if (!mdInstance) {
            if (renderQueue.length > 0) renderHandle = scheduleSoon(processRenderQueue);
            return;
        }

        const start = performance.now();
        const hasDeadline = deadline && typeof deadline.timeRemaining === 'function';
        let processedCount = 0;

        while (renderQueue.length > 0) {
            const elapsed = performance.now() - start;
            if (elapsed > IDLE_BATCH_BUDGET_MS) break;
            if (processedCount >= IDLE_BATCH_MAX_TASKS) break;
            if (hasDeadline && deadline.timeRemaining() < IDLE_MIN_TIME_REMAINING_MS) break;

            const { target, markdownText } = renderQueue.shift();
            if (!target) continue;
            processedCount += 1;
            
            const isAttached = typeof target.isConnected === 'boolean'
                ? target.isConnected
                : document.documentElement.contains(target);
            if (!isAttached) continue;

            try {
                const sourceText = getRememberedSource(target, markdownText || '');
                if (renderedSourceByTarget.get(target) === sourceText) {
                    target.removeAttribute('data-needs-markdown');
                    continue;
                }

                const preprocessed = preprocessLatex(sourceText);
                target.innerHTML = mdInstance.render(preprocessed);
                if (!isLargeCodeBlock(sourceText)) {
                    enhanceCodeBlocks(target);
                }
                renderedSourceByTarget.set(target, sourceText);
            } catch (err) {
                console.warn('Markdown render failed:', err);
                const fallbackSource = getRememberedSource(target, markdownText || '');
                target.textContent = fallbackSource;
                renderedSourceByTarget.set(target, fallbackSource);
            } finally {
                target.classList.add('markdown-body');
                target.removeAttribute('data-needs-markdown');
            }
        }

        if (renderQueue.length > 0) {
            renderHandle = scheduleIdle(processRenderQueue);
        }
    }

    /**
     * 批量渲染所有待处理元素
     */
    function renderAllPending(container) {
        if (!container) return;

        const pendingElements = container.querySelectorAll('[data-needs-markdown="true"]');

        if (pendingElements.length === 0) return;

        pendingElements.forEach(element => {
            const text = getRememberedSource(element, element.textContent || '');
            enqueueRender(element, text);
        });
    }

    return {
        getMarkdownIt,
        renderSync,
        enqueueRender,
        rememberSource,
        renderAllPending,
        preprocessLatex,
        enhanceCodeBlocks,
        isValidLatexContent
    };
})();

// 暴露到全局
if (typeof globalThis !== 'undefined') {
    globalThis.FrameworkMarkdown = FrameworkMarkdown;
}