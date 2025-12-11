/**
 * IdoFront Utils
 * Shared helper functions
 */
(function() {
    // Ensure namespace exists
    window.IdoFront = window.IdoFront || {};

    let idCounter = 1;

    window.IdoFront.utils = {
        
        createId(prefix) {
            const now = Date.now().toString(36);
            const counter = (idCounter++).toString(36);
            return String(prefix || 'id') + '-' + now + '-' + counter;
        },

        deriveTitleFromConversation(conversation) {
            if (!conversation || !Array.isArray(conversation.messages)) {
                return conversation && conversation.title ? conversation.title : 'New Chat';
            }
            for (let i = 0; i < conversation.messages.length; i += 1) {
                const msg = conversation.messages[i];
                if (msg.role === 'user' && msg.content) {
                    const trimmed = String(msg.content).trim().replace(/\s+/g, ' ');
                    if (!trimmed) continue;
                    if (trimmed.length <= 30) return trimmed;
                    return trimmed.slice(0, 30) + '…';
                }
            }
            return conversation.title || 'New Chat';
        },

        /**
         * 深度合并对象，source 的值覆盖 target（嵌套对象递归合并）
         * @param {Object} target - 目标对象
         * @param {Object} source - 源对象
         * @returns {Object} 合并后的对象
         */
        deepMerge(target, source) {
            if (!source || typeof source !== 'object') return target;
            for (const key of Object.keys(source)) {
                const sourceVal = source[key];
                const targetVal = target[key];
                if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
                    targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
                    window.IdoFront.utils.deepMerge(targetVal, sourceVal);
                } else {
                    target[key] = sourceVal;
                }
            }
            return target;
        }
        
    };
})();