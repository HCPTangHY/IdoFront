/**
 * Prompts Configuration
 * 统一管理所有 AI 服务使用的 prompt 模板
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    
    window.IdoFront.prompts = {
        
        /**
         * 对话标题生成 prompt
         * @param {string} chatContent - 格式化后的对话内容
         * @returns {string} 完整的 prompt
         */
        titleGeneration: function(chatContent) {
            return `请为以下对话生成一个简短的标题。

规则：
- 标题语言必须与对话内容的主要语言一致
- 英文标题：3-5 个单词
- 中文标题：6-10 个汉字
- 格式：一个相关的 emoji + 空格 + 标题文字
- 只输出标题本身，不要任何解释

对话内容：
${chatContent}
示例输出格式：
📝 代码重构建议
🔧 API Integration Help
💡 算法优化思路

请生成标题：`;
        }
        
        // 未来可以在这里添加更多 prompt 模板
        // summaryGeneration: function(content) { ... },
        // translationPrompt: function(text, targetLang) { ... },
    };

})();