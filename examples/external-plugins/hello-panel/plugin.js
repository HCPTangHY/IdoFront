// @name Hello Panel
// @version 2.0.0
// @description 展示如何在 IdoFront 中注册自定义 UI 按钮，使用 Store 和 Storage API
// @author IdoFront Team
// @icon waving_hand

/*
 * Hello Panel External Plugin (v2.0)
 *
 * 这是一个外部插件示例，展示如何：
 * 1. 在沙箱环境中注册 UI 组件
 * 2. 使用 Framework.ui.createIconButton 创建按钮
 * 3. 通过 Framework.addMessage 与主线程交互
 * 4. 使用 IdoFront.store 访问会话状态
 * 5. 使用 IdoFront.storage 持久化插件配置
 * 6. 使用 IdoFront.store.events 监听状态变化
 *
 * 外部插件在沙箱 iframe 中运行，通过消息机制与主线程通信。
 */
(function() {
    'use strict';
    
    // 检查 Framework API 是否可用
    // 注意：在沙箱中 Framework 由 sandbox-loader.js 注入
    if (!Framework || !Framework.registerPlugin) {
        console.warn('[HelloPanel] Framework API 不可用');
        return;
    }

    const { SLOTS } = Framework;
    const SLOT = SLOTS.HEADER_ACTIONS;
    const PLUGIN_ID = 'external-hello-panel';
    const CONFIG_KEY = 'hello-panel:config';

    // 插件状态
    let clickCount = 0;
    let unsubscribe = null;

    /**
     * 加载保存的配置
     */
    async function loadConfig() {
        try {
            const config = await IdoFront.storage.getItem(CONFIG_KEY);
            if (config && typeof config.clickCount === 'number') {
                clickCount = config.clickCount;
                console.log('[HelloPanel] 已恢复点击计数:', clickCount);
            }
        } catch (error) {
            console.warn('[HelloPanel] 加载配置失败:', error);
        }
    }

    /**
     * 保存配置
     */
    async function saveConfig() {
        try {
            await IdoFront.storage.setItem(CONFIG_KEY, {
                clickCount,
                lastUpdated: Date.now()
            });
        } catch (error) {
            console.warn('[HelloPanel] 保存配置失败:', error);
        }
    }

    /**
     * 创建按钮元素
     * 在沙箱中创建的 DOM 会被序列化为 HTML 传递到主线程
     */
    function createButton(frameworkApi) {
        const button = Framework.ui.createIconButton({
            label: 'Hello',
            icon: 'waving_hand',
            title: '点击插入问候语（显示会话信息）',
            className: 'ido-btn ido-btn--ghost text-xs gap-1',
            iconClassName: 'material-symbols-outlined text-[16px]',
            onClick: async () => {
                clickCount++;
                await saveConfig();
                
                // 获取当前会话信息
                let conversationInfo = '';
                try {
                    const conv = await IdoFront.store.getActiveConversation();
                    if (conv) {
                        conversationInfo = `\n当前会话：「${conv.title || '未命名'}」，共 ${conv.messages?.length || 0} 条消息`;
                    }
                } catch (error) {
                    console.warn('[HelloPanel] 获取会话信息失败:', error);
                }
                
                // 通过 Framework.addMessage 向主线程发送消息
                Framework.addMessage('assistant', {
                    content: `来自外部插件的问候 👋 (第 ${clickCount} 次点击)${conversationInfo}`,
                    reasoning: '这是一个外部插件示例，展示沙箱插件如何使用 Store API 访问会话状态'
                });
            }
        });
        return button;
    }

    // 注册插件
    Framework.registerPlugin(SLOT, PLUGIN_ID, {
        // 插件元数据
        meta: {
            name: 'Hello Panel',
            description: '外部插件示例：使用 Store 和 Storage API',
            version: '2.0.0',
            icon: 'waving_hand'
        },
        
        // 初始化函数：插件注册时调用一次
        async init(frameworkApi) {
            console.log('[HelloPanel] 插件初始化中...');
            
            // 加载保存的配置
            await loadConfig();
            
            // 订阅状态更新事件
            unsubscribe = IdoFront.store.events.on('updated', (eventData) => {
                console.log('[HelloPanel] 收到状态更新事件');
            });
            
            console.log('[HelloPanel] 插件已初始化');
        },
        
        // 渲染函数：返回 DOM 元素或 HTML 字符串
        render(frameworkApi) {
            return createButton(frameworkApi);
        },
        
        // 销毁函数：插件注销时调用
        destroy() {
            console.log('[HelloPanel] 插件清理中...');
            
            // 取消事件订阅
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            
            clickCount = 0;
            console.log('[HelloPanel] 插件已销毁');
        }
    });

    console.log('[HelloPanel] 插件注册完成');
})();