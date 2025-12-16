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
    
    const scheduleIdle = (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
        ? (cb => window.requestIdleCallback(cb))
        : (cb => setTimeout(() => cb({
            didTimeout: true,
            timeRemaining: () => 50
        }), 16));

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

        const chineseRatio = (content.match(/[\u4e00-\u9fa5]/g) || []).length / content.length;
        if (chineseRatio > 0.5) return false;

        const hasLatexCommand = /\\[a-zA-Z]+/.test(content);
        const hasMathSymbol = /[+\-*/=<>^_{}\\|]/.test(content);
        const hasGreekLetter = /\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega)/i.test(content);
        const hasNumber = /\d/.test(content);
        const hasFraction = /\\frac|\\dfrac/.test(content);
        const hasSuperSub = /[\^_]/.test(content);

        return hasLatexCommand || hasFraction || hasGreekLetter || (hasMathSymbol && hasNumber) || hasSuperSub;
    }

    /**
     * 预处理 LaTeX 公式
     */
    function preprocessLatex(text) {
        if (typeof katex === 'undefined' || !text) return text;

        // 块级公式 $$...$$
        text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
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
        text = text.replace(/(?<![a-zA-Z\u4e00-\u9fa5])\$([^\$\n]+?)\$(?![a-zA-Z\u4e00-\u9fa5])/g, (match, formula) => {
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

        return text;
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
    function renderSync(target, markdownText) {
        const mdInstance = getMarkdownIt();
        if (!target || !mdInstance) {
            if (target) target.textContent = markdownText || '';
            return;
        }

        const safeText = typeof markdownText === 'string' ? markdownText : '';

        try {
            const preprocessed = preprocessLatex(safeText);
            target.innerHTML = mdInstance.render(preprocessed);
            target.classList.add('markdown-body');
            enhanceCodeBlocks(target);
        } catch (err) {
            console.warn('Markdown sync render failed:', err);
            target.textContent = safeText;
        }
    }

    /**
     * 异步渲染 Markdown（使用 idle callback）
     */
    function enqueueRender(target, markdownText) {
        if (!target) return;
        const safeText = typeof markdownText === 'string' ? markdownText : '';
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
            renderQueue.length = 0;
            return;
        }

        const start = performance.now();
        const hasDeadline = deadline && typeof deadline.timeRemaining === 'function';

        while (renderQueue.length > 0) {
            if (hasDeadline && deadline.timeRemaining() < 5) break;
            if (!hasDeadline && performance.now() - start > 12) break;

            const { target, markdownText } = renderQueue.shift();
            if (!target) continue;
            
            const isAttached = typeof target.isConnected === 'boolean'
                ? target.isConnected
                : document.documentElement.contains(target);
            if (!isAttached) continue;

            try {
                const preprocessed = preprocessLatex(markdownText || '');
                target.innerHTML = mdInstance.render(preprocessed);
                enhanceCodeBlocks(target);
            } catch (err) {
                console.warn('Markdown render failed:', err);
                target.textContent = markdownText || '';
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
            const text = element.textContent || '';
            enqueueRender(element, text);
        });
    }

    return {
        getMarkdownIt,
        renderSync,
        enqueueRender,
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