/**
 * Title Generator Service
 * AI 自动生成对话标题服务
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.titleGenerator = window.IdoFront.titleGenerator || {};

    let store = null;
    let service = null;

    // 并发/去重控制
    const inFlightByConversation = new Map();
    const lastGeneratedFingerprintByConversation = new Map();
    const pendingScheduleByConversation = new Map();

    const TITLE_SCHEDULE_DELAY_MS = 1200;

    function clearScheduledTask(convId) {
        const task = pendingScheduleByConversation.get(convId);
        if (!task) return;
        if (task.type === 'idle' && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(task.id);
        } else {
            clearTimeout(task.id);
        }
        pendingScheduleByConversation.delete(convId);
    }

    /**
     * 初始化服务
     */
    window.IdoFront.titleGenerator.init = function(storeInstance) {
        store = storeInstance;
        service = window.IdoFront.service;
    };

    /**
     * 检查是否应该生成标题
     * @param {string} convId - 对话 ID
     * @returns {boolean}
     */
    window.IdoFront.titleGenerator.shouldGenerate = function(convId) {
        if (!store) return false;
        
        // 检查全局设置
        const autoGenerateTitle = store.getSetting('autoGenerateTitle');
        if (autoGenerateTitle === false) return false;
        
        // 获取对话
        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return false;
        
        // 用户已手动编辑过标题，不再自动生成
        // 注意：AI 生成过标题不阻止，这样切换到新分支时可以根据新内容更新标题
        if (conv.titleEditedByUser) return false;
        
        // 获取当前活跃路径
        const activePath = store.getActivePath(convId);
        
        // 条件：当前活跃路径恰好是第一轮问答完成（2条消息）
        // 这样无论在哪个分支，只要是第一轮问答完成就会生成标题
        if (activePath.length !== 2) return false;
        
        // 第一条必须是用户消息
        if (activePath[0].role !== 'user') return false;
        
        // 第二条必须是有内容的助手消息
        if (activePath[1].role !== 'assistant') return false;
        if (!activePath[1].content || activePath[1].content.trim().length === 0) return false;
        
        return true;
    };

    function buildTitleFingerprint(activePath) {
        if (!Array.isArray(activePath) || activePath.length < 2) return '';

        const toPart = (msg) => {
            if (!msg) return '';
            const content = typeof msg.content === 'string' ? msg.content.trim() : '';
            const compact = content.replace(/\s+/g, ' ').slice(0, 220);
            return [
                msg.id || '',
                msg.role || '',
                compact.length,
                compact
            ].join('#');
        };

        return `${toPart(activePath[0])}|${toPart(activePath[1])}`;
    }

    function runWhenIdle(task) {
        if (typeof window.requestIdleCallback === 'function') {
            const id = window.requestIdleCallback(() => task(), { timeout: TITLE_SCHEDULE_DELAY_MS + 1200 });
            return { type: 'idle', id };
        }

        const id = setTimeout(task, 16);
        return { type: 'timeout', id };
    }

    /**
     * 构建标题生成 prompt
     * @param {Array} messages - 对话消息数组
     * @returns {string} prompt
     */
    function buildPrompt(messages) {
        // 构建对话内容
        let chatContent = '';
        messages.forEach(m => {
            const role = m.role === 'user' ? '用户' : '助手';
            // 截取避免过长
            const content = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content;
            chatContent += `${role}: ${content}\n\n`;
        });

        // 使用 prompts 配置
        const prompts = window.IdoFront.prompts;
        if (prompts && prompts.titleGeneration) {
            return prompts.titleGeneration(chatContent);
        }
    }

    /**
     * 获取用于标题生成的渠道和模型配置
     * @param {Object} conv - 对话对象
     * @returns {Object|null} { channel, model } 或 null
     */
    function getTitleGeneratorConfig(conv) {
        // 优先使用用户设置的专用模型
        const settingChannelId = store.getSetting('titleGeneratorChannelId');
        let settingModel = store.getSetting('titleGeneratorModel');
        
        if (settingChannelId && settingModel) {
            const channel = store.state.channels.find(c => c.id === settingChannelId);
            if (channel && channel.enabled) {
                return { channel, model: settingModel };
            }
        }
        
        // 否则使用当前对话的模型
        const channel = store.state.channels.find(c => c.id === conv.selectedChannelId);
        if (channel && !settingModel) {
            // 默认优先轻量模型，避免标题生成抢占主链路资源
            const modelCandidates = Array.isArray(channel.models) ? channel.models : [];
            settingModel = modelCandidates.find(m => /mini|flash|haiku|nano|small/i.test(String(m))) || null;
        }

        if (channel && channel.enabled) {
            return {
                channel,
                model: settingModel || conv.selectedModel || channel.models?.[0]
            };
        }
        
        return null;
    }

    /**
     * 生成对话标题
     * @param {string} convId - 对话 ID
     */
    window.IdoFront.titleGenerator.generate = async function(convId) {
        clearScheduledTask(convId);

        if (!store || !service) {
            console.warn('[TitleGenerator] Store or Service not initialized');
            return;
        }

        if (!window.IdoFront.titleGenerator.shouldGenerate(convId)) {
            return;
        }

        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;

        // 获取活跃路径
        const activePath = store.getActivePath(convId);
        if (activePath.length < 2) return;
        const fingerprint = buildTitleFingerprint(activePath);
        if (!fingerprint) return;

        if (lastGeneratedFingerprintByConversation.get(convId) === fingerprint) {
            return;
        }

        const inflight = inFlightByConversation.get(convId);
        if (inflight) {
            return inflight;
        }

        // 构建 prompt
        const prompt = buildPrompt(activePath);

        // 获取渠道和模型配置
        const config = getTitleGeneratorConfig(conv);
        if (!config) {
            console.warn('[TitleGenerator] No valid channel for title generation');
            return;
        }

        const { channel, model } = config;

        let run = null;
        run = (async () => {
            // 构建请求消息
            const messages = [
                { role: 'user', content: prompt }
            ];

            // 配置：使用较低的温度以获得更一致的结果，不使用流式
            const channelConfig = {
                ...channel,
                model: model,
                temperature: 0.3,
                stream: false,
                paramsOverride: {
                    ...(channel.paramsOverride || {}),
                }
            };

            console.log(`[TitleGenerator] Using ${channel.name} / ${model} for title generation`);

            // 调用 AI
            const response = await service.callAI(messages, channelConfig, null, {
                setAsCurrent: false,
                requestId: `title_${convId}_${Date.now().toString(36)}`
            });
            
            // 提取标题
            const choice = response.choices?.[0];
            let title = choice?.message?.content || '';
            
            // 清理标题
            title = title.trim()
                .split('\n')[0]  // 只取第一行
                .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '');  // 去除引号
            
            // 如果标题有效，更新对话
            if (title && title.length > 0 && title.length <= 50) {
                store.renameConversation(convId, title, 'ai');
                lastGeneratedFingerprintByConversation.set(convId, fingerprint);
                console.log(`[TitleGenerator] Generated title for ${convId}: ${title}`);
            }
        })().catch((error) => {
            console.error('[TitleGenerator] Failed to generate title:', error);
        }).finally(() => {
            if (inFlightByConversation.get(convId) === run) {
                inFlightByConversation.delete(convId);
            }
        });

        inFlightByConversation.set(convId, run);
        return run;
    };

    /**
     * 延迟 + idle 调度标题生成，避免抢占消息主流程
     */
    window.IdoFront.titleGenerator.scheduleGenerate = function(convId, options) {
        if (!convId) return;

        if (!store || !service) return;
        if (!window.IdoFront.titleGenerator.shouldGenerate(convId)) return;

        clearScheduledTask(convId);

        const delay = (options && Number.isFinite(options.delayMs))
            ? Math.max(0, options.delayMs)
            : TITLE_SCHEDULE_DELAY_MS;

        const timerId = setTimeout(() => {
            pendingScheduleByConversation.delete(convId);
            const idleTask = runWhenIdle(() => {
                if (!window.IdoFront.titleGenerator.shouldGenerate(convId)) return;
                window.IdoFront.titleGenerator.generate(convId);
            });
            pendingScheduleByConversation.set(convId, idleTask);
        }, delay);

        pendingScheduleByConversation.set(convId, { type: 'timeout', id: timerId });
    };

    /**
     * 提供可选取消入口
     */
    window.IdoFront.titleGenerator.cancelScheduledGenerate = function(convId) {
        clearScheduledTask(convId);
    };

    window.IdoFront.titleGenerator.resetGenerationCache = function(convId) {
        if (convId) {
            lastGeneratedFingerprintByConversation.delete(convId);
            inFlightByConversation.delete(convId);
            clearScheduledTask(convId);
            return;
        }
        lastGeneratedFingerprintByConversation.clear();
        inFlightByConversation.clear();
        pendingScheduleByConversation.forEach((task, id) => {
            clearScheduledTask(id);
        });
    };

})();