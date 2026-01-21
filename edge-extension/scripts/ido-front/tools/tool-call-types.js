/**
 * Tool Call Types - 工具调用数据结构定义
 * 
 * 消息中的工具调用数据结构：
 * 
 * message.toolCalls = [
 *   {
 *     id: 'tc_xxx',           // 工具调用 ID
 *     name: 'read_file',      // 工具名称
 *     args: { path: '...' },  // 调用参数
 *     status: 'pending' | 'running' | 'success' | 'error',
 *     result: { ... },        // 执行结果
 *     error: '...',           // 错误信息
 *     startTime: 1234567890,  // 开始时间
 *     endTime: 1234567890,    // 结束时间
 *     duration: 0.5           // 耗时（秒）
 *   }
 * ]
 * 
 * 工具调用在对话历史中的表示：
 * - AI 请求调用工具时：记录在该条 assistant 消息的 toolCalls 中
 * - 工具执行结果：写回同一条 toolCalls（result/error），不新增 role='tool' 消息
 * - 发送给 Gemini 时：在请求构建阶段把 toolCalls 展开为 functionCall + functionResponse 两个 turn
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    
    const utils = window.IdoFront.utils;
    
    /**
     * 工具调用状态
     */
    const ToolCallStatus = {
        PENDING: 'pending',     // 等待执行
        RUNNING: 'running',     // 执行中
        SUCCESS: 'success',     // 执行成功
        ERROR: 'error'          // 执行失败
    };
    
    /**
     * 创建工具调用对象
     */
    function createToolCall(name, args, callId) {
        return {
            // 内部 ID：用于 UI 更新/本地状态
            id: utils ? utils.createId('tc') : `tc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            // 外部调用 ID：用于回传给提供者（如 OpenAI 的 tool_call_id）
            callId: callId || null,
            name: name,
            args: args || {},
            status: ToolCallStatus.PENDING,
            result: null,
            error: null,
            startTime: null,
            endTime: null,
            duration: null
        };
    }
    
    /**
     * 从 AI 响应创建工具调用列表
     */
    function createToolCallsFromResponse(toolCalls) {
        if (!toolCalls || !Array.isArray(toolCalls)) return [];
        
        // 兼容：OpenAI tool_calls 可能包含 id；Gemini functionCalls 可能不包含 id
        return toolCalls.map(tc => createToolCall(tc.name, tc.args, tc.id || null));
    }
    
    /**
     * 更新工具调用状态
     */
    function updateToolCallStatus(toolCall, status, result, error) {
        toolCall.status = status;
        
        if (status === ToolCallStatus.RUNNING) {
            toolCall.startTime = Date.now();
        } else if (status === ToolCallStatus.SUCCESS || status === ToolCallStatus.ERROR) {
            toolCall.endTime = Date.now();
            if (toolCall.startTime) {
                toolCall.duration = (toolCall.endTime - toolCall.startTime) / 1000;
            }
        }
        
        if (result !== undefined) {
            toolCall.result = result;
        }
        
        if (error !== undefined) {
            toolCall.error = error;
        }
        
        return toolCall;
    }
    
    /**
     * 创建工具结果消息（用于发送给 AI）
     */
    function createToolResultMessage(toolCall) {
        return {
            role: 'tool',
            toolCallId: toolCall.callId || toolCall.id,
            name: toolCall.name,
            content: toolCall.status === ToolCallStatus.SUCCESS
                ? JSON.stringify(toolCall.result)
                : JSON.stringify({ error: toolCall.error || 'Unknown error' })
        };
    }
    
    /**
     * 转换工具结果为 Gemini 格式
     */
    function toGeminiFunctionResponse(toolCall) {
        return {
            functionResponse: {
                name: toolCall.name,
                response: toolCall.status === ToolCallStatus.SUCCESS
                    ? toolCall.result
                    : { error: toolCall.error || 'Unknown error' }
            }
        };
    }
    
    /**
     * 判断消息是否包含待处理的工具调用
     */
    function hasPendingToolCalls(message) {
        if (!message || !message.toolCalls) return false;
        return message.toolCalls.some(tc => 
            tc.status === ToolCallStatus.PENDING || tc.status === ToolCallStatus.RUNNING
        );
    }
    
    /**
     * 判断所有工具调用是否已完成
     */
    function allToolCallsCompleted(message) {
        if (!message || !message.toolCalls || message.toolCalls.length === 0) return true;
        return message.toolCalls.every(tc => 
            tc.status === ToolCallStatus.SUCCESS || tc.status === ToolCallStatus.ERROR
        );
    }
    
    // 暴露 API
    window.IdoFront.toolCallTypes = {
        Status: ToolCallStatus,
        create: createToolCall,
        createFromResponse: createToolCallsFromResponse,
        updateStatus: updateToolCallStatus,
        createResultMessage: createToolResultMessage,
        toGeminiFunctionResponse: toGeminiFunctionResponse,
        hasPending: hasPendingToolCalls,
        allCompleted: allToolCallsCompleted
    };
    
})();
