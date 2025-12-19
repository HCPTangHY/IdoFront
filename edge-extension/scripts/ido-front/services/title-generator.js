/**
 * Title Generator Service
 * AI 自动生成对话标题服务
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.titleGenerator = window.IdoFront.titleGenerator || {};

    let store = null;
    let service = null;

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
        
        // 用户已编辑过标题或 AI 已生成过标题，不再自动生成
        if (conv.titleEditedByUser || conv.titleGeneratedByAI) return false;
        
        // 获取活跃路径
        const activePath = store.getActivePath(convId);
        
        // 条件：第一轮问答完成（2条消息：用户+AI）
        if (activePath.length !== 2) return false;
        
        // 最后一条必须是 AI 回复
        if (activePath[1].role !== 'assistant') return false;
        
        // AI 回复必须有内容
        if (!activePath[1].content || activePath[1].content.trim().length === 0) return false;
        
        return true;
    };

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
        const settingModel = store.getSetting('titleGeneratorModel');
        
        if (settingChannelId && settingModel) {
            const channel = store.state.channels.find(c => c.id === settingChannelId);
            if (channel && channel.enabled) {
                return { channel, model: settingModel };
            }
        }
        
        // 否则使用当前对话的模型
        const channel = store.state.channels.find(c => c.id === conv.selectedChannelId);
        if (channel && channel.enabled) {
            return {
                channel,
                model: conv.selectedModel || channel.models?.[0]
            };
        }
        
        return null;
    }

    /**
     * 生成对话标题
     * @param {string} convId - 对话 ID
     */
    window.IdoFront.titleGenerator.generate = async function(convId) {
        if (!store || !service) {
            console.warn('[TitleGenerator] Store or Service not initialized');
            return;
        }

        const conv = store.state.conversations.find(c => c.id === convId);
        if (!conv) return;

        // 获取活跃路径
        const activePath = store.getActivePath(convId);
        if (activePath.length < 2) return;

        // 构建 prompt
        const prompt = buildPrompt(activePath);

        // 获取渠道和模型配置
        const config = getTitleGeneratorConfig(conv);
        if (!config) {
            console.warn('[TitleGenerator] No valid channel for title generation');
            return;
        }

        const { channel, model } = config;

        try {
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
            const response = await service.callAI(messages, channelConfig, null);
            
            // 提取标题
            const choice = response.choices?.[0];
            let title = choice?.message?.content || '';
            
            // 清理标题
            title = title.trim()
                .split('\n')[0]  // 只取第一行
                .replace(/^[`"'""'']+|[`"'""'']+$/g, '');  // 去除引号
            
            // 如果标题有效，更新对话
            if (title && title.length > 0 && title.length <= 50) {
                store.renameConversation(convId, title, 'ai');
                console.log(`[TitleGenerator] Generated title for ${convId}: ${title}`);
            }
        } catch (error) {
            console.error('[TitleGenerator] Failed to generate title:', error);
        }
    };

})();