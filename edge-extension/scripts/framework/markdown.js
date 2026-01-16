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