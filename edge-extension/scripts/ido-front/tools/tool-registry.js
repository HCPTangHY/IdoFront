/**
 * Tool Registry - 统一工具注册中心
 * 管理所有工具（内置工具、MCP 工具、插件工具）
 * 提供统一的格式转换和调用接口
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    
    const tools = new Map();           // toolId -> ToolDefinition
    const providers = new Map();       // providerId -> Provider instance
    const enabledTools = new Set();    // 启用的工具 ID 集合
    const functionNameToId = new Map(); // functionName -> toolId
    
    const STORAGE_KEY = 'ido.tools.enabled';
    
    // ========== 工具定义格式 ==========
    /**
     * @typedef {Object} ToolDefinition
     * @property {string} id - 工具唯一标识 (provider:name)
     * @property {string} name - 工具显示名称（用于 UI）
     * @property {string} [functionName] - 提供给模型调用的函数名（需全局唯一）
     * @property {string} description - 工具描述（给 AI 看）
     * @property {Object} parameters - JSON Schema 格式的参数定义
     * @property {string} provider - 来源: 'native' | 'mcp' | 'plugin'
     * @property {string} [serverId] - MCP 服务器 ID（仅 MCP 工具）
     * @property {Function} execute - 执行函数 (args) => Promise<result>
     */
    
    // ========== 存储操作 ==========
    
    function loadEnabledTools() {
        try {
            const saved = Framework?.storage?.getItem(STORAGE_KEY);
            if (Array.isArray(saved)) {
                saved.forEach(id => enabledTools.add(id));
            }
        } catch (e) {
            console.warn('[ToolRegistry] Failed to load enabled tools:', e);
        }
    }
    
    function saveEnabledTools() {
        try {
            Framework?.storage?.setItem(STORAGE_KEY, Array.from(enabledTools));
        } catch (e) {
            console.warn('[ToolRegistry] Failed to save enabled tools:', e);
        }
    }
    
    // ========== 工具管理 ==========
    
    /**
     * 注册工具提供者
     */
    function registerProvider(providerId, provider) {
        providers.set(providerId, provider);
    }
    
    function toSafeFunctionName(input) {
        const raw = String(input || '').trim();
        // 只保留字母数字下划线，其他字符替换为下划线
        let safe = raw.replace(/[^a-zA-Z0-9_]/g, '_');
        // 合并重复下划线
        safe = safe.replace(/_+/g, '_');
        // Gemini/多数 provider 更偏好字母开头
        if (!/^[a-zA-Z]/.test(safe)) {
            safe = `tool_${safe}`;
        }
        // 避免空串
        if (!safe || safe === 'tool_') {
            safe = `tool_${Date.now().toString(36)}`;
        }
        return safe;
    }

    function assignFunctionName(toolDef) {
        if (!toolDef) return;

        const base = toSafeFunctionName(toolDef.functionName || toolDef.name);
        let fn = base;

        const existingId = functionNameToId.get(fn);
        if (existingId && existingId !== toolDef.id) {
            const providerPart = toSafeFunctionName(toolDef.provider || 'tool');
            const serverPart = toolDef.serverId ? toSafeFunctionName(String(toolDef.serverId).slice(-8)) : null;
            fn = serverPart ? `${base}__${providerPart}_${serverPart}` : `${base}__${providerPart}`;
        }

        // 二次冲突兜底
        let counter = 2;
        while (functionNameToId.has(fn)) {
            fn = `${base}__${counter++}`;
        }

        toolDef.functionName = fn;
    }

    function resolveTool(toolNameOrId) {
        if (!toolNameOrId) return null;

        // 1) 直接按 id
        if (tools.has(toolNameOrId)) {
            return tools.get(toolNameOrId);
        }

        // 2) 按 functionName 索引
        const toolId = functionNameToId.get(toolNameOrId);
        if (toolId && tools.has(toolId)) {
            return tools.get(toolId);
        }

        // 3) 兼容按 display name（不推荐，可能不唯一）
        for (const t of tools.values()) {
            if (t.name === toolNameOrId) {
                return t;
            }
        }

        return null;
    }

    /**
     * 注册单个工具
     */
    function register(toolDef) {
        if (!toolDef || !toolDef.name) {
            console.warn('[ToolRegistry] Invalid tool definition (missing name):', toolDef);
            return false;
        }
        
        // 确保 description 有默认值
        if (!toolDef.description) {
            toolDef.description = `Tool: ${toolDef.name}`;
        }
        
        // 生成唯一 ID
        const id = toolDef.id || `${toolDef.provider || 'unknown'}:${toolDef.name}`;
        toolDef.id = id;

        // 如果是重复注册（同一个 id），先清理旧的 functionName 索引
        const existing = tools.get(id);
        if (existing && existing.functionName) {
            functionNameToId.delete(existing.functionName);
        }

        // 为 provider 调用生成稳定且唯一的 functionName
        assignFunctionName(toolDef);

        tools.set(id, toolDef);
        functionNameToId.set(toolDef.functionName, id);

        // 默认启用新工具
        if (!enabledTools.has(id) && toolDef.enabledByDefault !== false) {
            enabledTools.add(id);
        }

        return true;
    }
    
    /**
     * 批量注册工具
     */
    function registerMany(toolDefs, providerId) {
        toolDefs.forEach(def => {
            def.provider = providerId;
            register(def);
        });
    }
    
    /**
     * 注销工具
     */
    function unregister(toolId) {
        const tool = tools.get(toolId);
        if (tool && tool.functionName) {
            functionNameToId.delete(tool.functionName);
        }
        tools.delete(toolId);
        enabledTools.delete(toolId);
    }
    
    /**
     * 清除指定提供者的所有工具
     */
    function clearProvider(providerId) {
        for (const [id, tool] of tools.entries()) {
            if (tool.provider === providerId) {
                if (tool && tool.functionName) {
                    functionNameToId.delete(tool.functionName);
                }
                tools.delete(id);
                enabledTools.delete(id);
            }
        }
    }
    
    // ========== 工具状态 ==========
    
    function isEnabled(toolId) {
        return enabledTools.has(toolId);
    }
    
    function setEnabled(toolId, enabled) {
        if (enabled) {
            enabledTools.add(toolId);
        } else {
            enabledTools.delete(toolId);
        }
        saveEnabledTools();
    }
    
    // ========== 工具查询 ==========
    
    function getAll() {
        return Array.from(tools.values());
    }
    
    function getEnabled() {
        return Array.from(tools.values()).filter(t => enabledTools.has(t.id));
    }
    
    function getByProvider(providerId) {
        return Array.from(tools.values()).filter(t => t.provider === providerId);
    }
    
    function get(toolId) {
        return tools.get(toolId);
    }
    
    // ========== 格式转换 ==========
    
    /**
     * 清理参数对象，移除 Gemini 不支持的字段
     */
    function cleanParametersForGemini(params) {
        if (!params || typeof params !== 'object') return params;
        
        // Gemini 不支持的字段
        const unsupportedFields = ['$schema', 'additionalProperties', 'default', 'examples'];
        
        const cleaned = {};
        for (const [key, value] of Object.entries(params)) {
            if (unsupportedFields.includes(key)) continue;
            
            if (key === 'properties' && typeof value === 'object') {
                // 递归清理 properties 中的每个属性
                cleaned[key] = {};
                for (const [propName, propValue] of Object.entries(value)) {
                    cleaned[key][propName] = cleanParametersForGemini(propValue);
                }
            } else if (key === 'items' && typeof value === 'object') {
                // 递归清理 array 的 items
                cleaned[key] = cleanParametersForGemini(value);
            } else if (typeof value === 'object' && !Array.isArray(value)) {
                cleaned[key] = cleanParametersForGemini(value);
            } else {
                cleaned[key] = value;
            }
        }
        
        return cleaned;
    }
    
    function getEnabledList(options) {
        if (options && typeof options.isEnabled === 'function') {
            return getAll().filter(t => {
                try {
                    return options.isEnabled(t.id) === true;
                } catch (e) {
                    return false;
                }
            });
        }

        if (options && options.enabledToolIds && typeof options.enabledToolIds.has === 'function') {
            return getAll().filter(t => options.enabledToolIds.has(t.id));
        }

        return getEnabled();
    }

    /**
     * 转换为 Gemini functionDeclarations 格式
     */
    function toGeminiFormat(options) {
        const enabledList = getEnabledList(options);
        if (enabledList.length === 0) return null;
        
        const functionDeclarations = enabledList.map(tool => {
            const decl = {
                name: tool.functionName || tool.name,
                description: tool.description || ''
            };
            
            // 参数定义 - 清理不支持的字段
            if (tool.parameters && Object.keys(tool.parameters).length > 0) {
                decl.parameters = cleanParametersForGemini(tool.parameters);
            }
            
            return decl;
        });
        
        return [{ functionDeclarations }];
    }
    
    /**
     * 转换为 OpenAI tools 格式
     */
    function toOpenAIFormat(options) {
        const enabledList = getEnabledList(options);
        if (enabledList.length === 0) return null;
        
        return enabledList.map(tool => ({
            type: 'function',
            function: {
                name: tool.functionName || tool.name,
                description: tool.description,
                parameters: tool.parameters || { type: 'object', properties: {} }
            }
        }));
    }
    
    /**
     * 转换为 Claude tools 格式
     */
    function toClaudeFormat(options) {
        const enabledList = getEnabledList(options);
        if (enabledList.length === 0) return null;
        
        return enabledList.map(tool => ({
            name: tool.functionName || tool.name,
            description: tool.description,
            input_schema: tool.parameters || { type: 'object', properties: {} }
        }));
    }
    
    // ========== 工具执行 ==========
    
    /**
     * 执行工具调用
     * @param {string} toolName - 工具名称
     * @param {Object} args - 调用参数
     * @returns {Promise<Object>} - 执行结果
     */
    async function execute(toolName, args) {
        const tool = resolveTool(toolName);
        
        if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
        }
        
        if (typeof tool.execute !== 'function') {
            throw new Error(`Tool ${toolName} has no execute function`);
        }
        
        try {
            const result = await tool.execute(args);
            return {
                success: true,
                result: result
            };
        } catch (error) {
            return {
                success: false,
                error: error.message || String(error)
            };
        }
    }
    
    /**
     * 批量执行工具调用（用于并行调用）
     */
    async function executeMany(calls) {
        const results = await Promise.all(
            calls.map(call => execute(call.name, call.args))
        );
        return results;
    }
    
    // ========== 初始化 ==========
    
    function init() {
        loadEnabledTools();
    }
    
    // ========== 暴露 API ==========
    
    window.IdoFront.toolRegistry = {
        // 初始化
        init,
        
        // 提供者管理
        registerProvider,
        
        // 工具注册
        register,
        registerMany,
        unregister,
        clearProvider,
        
        // 工具状态
        isEnabled,
        setEnabled,
        
        // 工具查询
        get,
        getAll,
        getEnabled,
        getByProvider,
        resolve: resolveTool,
        
        // 格式转换
        toGeminiFormat,
        toOpenAIFormat,
        toClaudeFormat,
        
        // 工具执行
        execute,
        executeMany
    };
    
})();
