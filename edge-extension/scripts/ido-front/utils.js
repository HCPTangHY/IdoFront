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
        }
        
    };
})();