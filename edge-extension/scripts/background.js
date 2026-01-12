// 处理工具栏图标点击事件
chrome.action.onClicked.addListener((tab) => {
  // 打开侧边栏
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ========== 自定义请求头覆写功能 ==========
// 使用 declarativeNetRequest API 在网络层修改请求头
// 因为 Referer, Origin 等是浏览器禁止通过 fetch 设置的请求头

// 规则ID基础值，避免冲突
const RULE_ID_BASE = 10000;

// 当前活跃的规则映射：channelId -> ruleIds[]
const activeRules = new Map();

// 需要通过 declarativeNetRequest 处理的禁止请求头
const FORBIDDEN_HEADERS = [
  'referer',
  'origin',
  'host',
  'user-agent',
  'cookie',
  'connection',
  'content-length',
  'accept-encoding'
];

/**
 * 检查请求头是否是需要特殊处理的禁止头
 */
function isForbiddenHeader(headerName) {
  return FORBIDDEN_HEADERS.includes(headerName.toLowerCase());
}

/**
 * 为渠道创建请求头修改规则
 * @param {string} channelId - 渠道ID
 * @param {string} baseUrl - 渠道的API基础URL
 * @param {Array} customHeaders - 自定义请求头数组 [{key, value}]
 */
async function updateChannelHeaderRules(channelId, baseUrl, customHeaders) {
  try {
    // 先移除该渠道的旧规则
    await removeChannelRules(channelId);
    
    // 如果没有自定义头或者URL，直接返回
    if (!customHeaders || !Array.isArray(customHeaders) || customHeaders.length === 0 || !baseUrl) {
      return { success: true, rulesCount: 0 };
    }
    
    // 筛选出需要特殊处理的禁止头
    const forbiddenCustomHeaders = customHeaders.filter(h => 
      h.key && h.value && isForbiddenHeader(h.key)
    );
    
    if (forbiddenCustomHeaders.length === 0) {
      return { success: true, rulesCount: 0, message: 'No forbidden headers to process' };
    }
    
    // 解析URL获取域名用于匹配
    let urlPattern;
    try {
      const url = new URL(baseUrl.replace(/\/+$/, ''));
      // 创建匹配模式：协议 + 主机 + 任意路径
      urlPattern = `${url.protocol}//${url.host}/*`;
    } catch (e) {
      console.error('[Background] Invalid baseUrl:', baseUrl, e);
      return { success: false, error: 'Invalid URL' };
    }
    
    // 生成规则ID
    const ruleIdStart = RULE_ID_BASE + (hashCode(channelId) % 10000);
    const newRuleIds = [];
    const rules = [];
    
    forbiddenCustomHeaders.forEach((header, index) => {
      const ruleId = ruleIdStart + index;
      newRuleIds.push(ruleId);
      
      rules.push({
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            {
              header: header.key,
              operation: 'set',
              value: header.value
            }
          ]
        },
        condition: {
          urlFilter: urlPattern,
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });
    });
    
    // 添加新规则
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: rules,
      removeRuleIds: []
    });
    
    // 记录活跃规则
    activeRules.set(channelId, newRuleIds);
    
    console.log(`[Background] Added ${rules.length} header rules for channel ${channelId}:`, 
      forbiddenCustomHeaders.map(h => h.key).join(', '));
    
    return { success: true, rulesCount: rules.length };
    
  } catch (error) {
    console.error('[Background] Failed to update channel header rules:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 移除渠道的请求头规则
 */
async function removeChannelRules(channelId) {
  const ruleIds = activeRules.get(channelId);
  if (ruleIds && ruleIds.length > 0) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
        addRules: []
      });
      activeRules.delete(channelId);
      console.log(`[Background] Removed ${ruleIds.length} header rules for channel ${channelId}`);
    } catch (error) {
      console.error('[Background] Failed to remove channel rules:', error);
    }
  }
}

/**
 * 清除所有动态规则
 */
async function clearAllRules() {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map(r => r.id);
    if (ruleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
        addRules: []
      });
    }
    activeRules.clear();
    console.log('[Background] Cleared all dynamic header rules');
    return { success: true };
  } catch (error) {
    console.error('[Background] Failed to clear rules:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 简单的字符串哈希函数
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// 监听来自 sidepanel 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_CHANNEL_HEADERS') {
    // 更新渠道的请求头规则
    updateChannelHeaderRules(
      message.channelId,
      message.baseUrl,
      message.customHeaders
    ).then(sendResponse);
    return true; // 表示异步响应
  }
  
  if (message.type === 'REMOVE_CHANNEL_HEADERS') {
    // 移除渠道的请求头规则
    removeChannelRules(message.channelId).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'CLEAR_ALL_HEADER_RULES') {
    // 清除所有规则
    clearAllRules().then(sendResponse);
    return true;
  }
  
  if (message.type === 'GET_ACTIVE_RULES') {
    // 获取当前活跃规则（调试用）
    chrome.declarativeNetRequest.getDynamicRules().then(rules => {
      sendResponse({ success: true, rules });
    });
    return true;
  }
});

// 扩展启动时清理旧规则
chrome.runtime.onStartup.addListener(() => {
  clearAllRules();
});

// 安装/更新时清理规则
chrome.runtime.onInstalled.addListener(() => {
  clearAllRules();
});
