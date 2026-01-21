/**
 * MCP Client - Model Context Protocol 客户端
 * 支持 SSE、WebSocket 和 Streamable HTTP 传输
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    
    // 活跃的连接
    const connections = new Map();  // serverId -> { transport, eventSource/ws, tools }
    
    /**
     * MCP 协议版本
     */
    const PROTOCOL_VERSION = '2024-11-05';
    
    /**
     * 生成请求 ID
     */
    function generateId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Streamable HTTP 传输
     * 每个请求都是独立的 POST，响应直接返回 JSON
     */
    class StreamableHTTPTransport {
        constructor(url) {
            this.url = url;
            this.sessionId = null;
            this.onMessage = null;
            this.onError = null;
            this.onClose = null;
        }
        
        async connect() {
            // Streamable HTTP 不需要持久连接，直接返回
            console.log('[MCP-HTTP] Ready for requests to:', this.url);
            return Promise.resolve();
        }
        
        async send(method, params = {}) {
            const id = generateId();
            const message = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };
            
            console.log('[MCP-HTTP] Sending:', method, params);
            
            try {
                const response = await fetch(this.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream'
                    },
                    body: JSON.stringify(message)
                });
                
                console.log('[MCP-HTTP] Response status:', response.status);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
                }
                
                const contentType = response.headers.get('content-type') || '';
                
                // 如果是 SSE 流，需要解析流
                if (contentType.includes('text/event-stream')) {
                    return await this.parseSSEResponse(response);
                }
                
                // 普通 JSON 响应
                const data = await response.json();
                console.log('[MCP-HTTP] Response:', data);
                
                if (data.error) {
                    throw new Error(data.error.message || 'Unknown error');
                }
                
                return data.result;
                
            } catch (error) {
                console.error('[MCP-HTTP] Request failed:', error);
                throw error;
            }
        }
        
        async parseSSEResponse(response) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let result = null;
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    
                    // 解析 SSE 事件
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.result !== undefined) {
                                    result = data.result;
                                }
                                if (data.error) {
                                    throw new Error(data.error.message || 'Unknown error');
                                }
                            } catch (e) {
                                if (e.message !== 'Unexpected end of JSON input') {
                                    console.warn('[MCP-HTTP] Failed to parse SSE data:', e);
                                }
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
            
            return result;
        }
        
        close() {
            // HTTP 传输没有持久连接需要关闭
            console.log('[MCP-HTTP] Transport closed');
            if (this.onClose) this.onClose();
        }
    }
    
    /**
     * SSE 传输连接
     */
    class SSETransport {
        constructor(url) {
            this.url = url;
            this.baseUrl = url.replace(/\/sse\/?$/, '');  // 移除 /sse 后缀
            this.eventSource = null;
            this.messageHandlers = new Map();
            this.onMessage = null;
            this.onError = null;
            this.onClose = null;
            this.sessionId = null;
        }
        
        async connect() {
            return new Promise((resolve, reject) => {
                try {
                    console.log('[MCP-SSE] Connecting to:', this.url);
                    this.eventSource = new EventSource(this.url);
                    
                    let resolved = false;
                    let connectionTimeout = null;
                    
                    // 连接超时
                    connectionTimeout = setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            this.close();
                            reject(new Error('SSE 连接超时'));
                        }
                    }, 15000);
                    
                    this.eventSource.onopen = () => {
                        console.log('[MCP-SSE] EventSource opened:', this.url);
                    };
                    
                    this.eventSource.onerror = (error) => {
                        console.error('[MCP-SSE] Connection error:', error);
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(connectionTimeout);
                            if (this.onError) this.onError(error);
                            reject(new Error('SSE 连接失败，请检查服务器地址是否正确'));
                        }
                    };
                    
                    // 处理 endpoint 事件（MCP SSE 规范）- 收到此事件表示连接成功
                    this.eventSource.addEventListener('endpoint', (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            console.log('[MCP-SSE] Received endpoint event:', data);
                            if (data.uri) {
                                // 保存消息端点 URI
                                this.messageEndpoint = data.uri;
                                console.log('[MCP-SSE] Message endpoint:', this.messageEndpoint);
                                
                                // 收到 endpoint 事件才算真正连接成功
                                if (!resolved) {
                                    resolved = true;
                                    clearTimeout(connectionTimeout);
                                    resolve();
                                }
                            }
                        } catch (e) {
                            console.warn('[MCP-SSE] Failed to parse endpoint event:', e);
                        }
                    });
                    
                    // 处理消息事件
                    this.eventSource.addEventListener('message', (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            this.handleMessage(data);
                        } catch (e) {
                            console.warn('[MCP-SSE] Failed to parse message:', e);
                        }
                    });
                    
                } catch (error) {
                    reject(error);
                }
            });
        }
        
        handleMessage(data) {
            // 处理响应
            if (data.id && this.messageHandlers.has(data.id)) {
                const handler = this.messageHandlers.get(data.id);
                this.messageHandlers.delete(data.id);
                
                if (data.error) {
                    handler.reject(new Error(data.error.message || 'Unknown error'));
                } else {
                    handler.resolve(data.result);
                }
            }
            
            // 通知上层
            if (this.onMessage) {
                this.onMessage(data);
            }
        }
        
        async send(method, params = {}) {
            const id = generateId();
            const message = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };
            
            console.log('[MCP-SSE] Sending:', method, params);
            
            return new Promise((resolve, reject) => {
                this.messageHandlers.set(id, { resolve, reject });
                
                // 超时处理
                const timeoutId = setTimeout(() => {
                    if (this.messageHandlers.has(id)) {
                        this.messageHandlers.delete(id);
                        reject(new Error(`请求超时: ${method}`));
                    }
                }, 30000);
                
                // 发送 HTTP POST 请求到消息端点
                const endpoint = this.messageEndpoint || `${this.baseUrl}/message`;
                console.log('[MCP-SSE] POST to:', endpoint);
                
                fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(message)
                }).then(response => {
                    console.log('[MCP-SSE] POST response status:', response.status);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    // 响应会通过 SSE 事件返回，这里只检查 POST 是否成功
                }).catch(error => {
                    console.error('[MCP-SSE] POST error:', error);
                    clearTimeout(timeoutId);
                    this.messageHandlers.delete(id);
                    reject(error);
                });
            });
        }
        
        close() {
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
            this.messageHandlers.clear();
            if (this.onClose) this.onClose();
        }
    }
    
    /**
     * MCP 客户端
     */
    class MCPClient {
        constructor(server) {
            this.server = server;
            this.transport = null;
            this.serverInfo = null;
            this.tools = [];
        }
        
        /**
         * 连接到服务器
         */
        async connect() {
            // 根据传输类型创建连接
            switch (this.server.transport) {
                case 'sse':
                    this.transport = new SSETransport(this.server.url);
                    break;
                case 'streamable-http':
                    this.transport = new StreamableHTTPTransport(this.server.url);
                    break;
                case 'stdio':
                    throw new Error('Stdio 传输需要桌面版支持');
                default:
                    throw new Error(`不支持的传输类型: ${this.server.transport}`);
            }
            
            // 建立连接
            await this.transport.connect();
            
            // 初始化 MCP 协议
            await this.initialize();
            
            // 获取工具列表
            await this.listTools();
            
            return {
                serverInfo: this.serverInfo,
                tools: this.tools
            };
        }
        
        /**
         * 初始化 MCP 协议
         */
        async initialize() {
            const result = await this.transport.send('initialize', {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: {
                    roots: { listChanged: false },
                    sampling: {}
                },
                clientInfo: {
                    name: 'IdoFront',
                    version: '1.0.0'
                }
            });
            
            this.serverInfo = result;
            console.log('[MCP] Server info:', result);
            
            // 发送 initialized 通知
            await this.transport.send('notifications/initialized', {});
            
            return result;
        }
        
        /**
         * 获取工具列表
         */
        async listTools() {
            const result = await this.transport.send('tools/list', {});
            this.tools = result.tools || [];
            console.log('[MCP] Tools:', this.tools);
            return this.tools;
        }
        
        /**
         * 调用工具
         */
        async callTool(name, args = {}) {
            const result = await this.transport.send('tools/call', {
                name,
                arguments: args
            });
            return result;
        }
        
        /**
         * 断开连接
         */
        disconnect() {
            if (this.transport) {
                this.transport.close();
                this.transport = null;
            }
            this.tools = [];
        }
        
        /**
         * 检查连接状态
         */
        isConnected() {
            return this.transport !== null;
        }
    }
    
    // ========== 对外 API ==========
    
    /**
     * 连接到 MCP 服务器
     */
    async function connect(server) {
        // 检查是否已连接
        if (connections.has(server.id)) {
            console.warn('[MCP] Already connected to:', server.id);
            return connections.get(server.id);
        }
        
        const client = new MCPClient(server);
        const result = await client.connect();
        
        connections.set(server.id, {
            client,
            tools: result.tools,
            serverInfo: result.serverInfo
        });
        
        // 注册工具到 toolRegistry
        registerTools(server.id, result.tools);
        
        return result;
    }
    
    /**
     * 断开连接
     */
    function disconnect(serverId) {
        const conn = connections.get(serverId);
        if (conn) {
            conn.client.disconnect();
            connections.delete(serverId);
            
            // 从 toolRegistry 注销工具
            unregisterTools(serverId);
        }
    }
    
    /**
     * 调用工具
     */
    async function callTool(serverId, toolName, args) {
        const conn = connections.get(serverId);
        if (!conn) {
            throw new Error(`服务器未连接: ${serverId}`);
        }
        
        return await conn.client.callTool(toolName, args);
    }
    
    /**
     * 获取连接的服务器列表
     */
    function getConnectedServers() {
        return Array.from(connections.keys());
    }
    
    /**
     * 检查服务器是否已连接
     */
    function isConnected(serverId) {
        return connections.has(serverId);
    }
    
    /**
     * 注册工具到 toolRegistry
     */
    function registerTools(serverId, tools) {
        const toolRegistry = window.IdoFront.toolRegistry;
        if (!toolRegistry) return;

        const mcpSettings = window.IdoFront.mcpSettings;
        
        const toolDefs = tools.map(tool => {
            const enabledByDefault = (mcpSettings && typeof mcpSettings.getToolState === 'function')
                ? mcpSettings.getToolState(`${serverId}:${tool.name}`)
                : true;

            return {
                id: `mcp:${serverId}:${tool.name}`,
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema || { type: 'object', properties: {} },
                provider: 'mcp',
                serverId: serverId,
                enabledByDefault,
                execute: async (args) => {
                    const result = await callTool(serverId, tool.name, args);
                    // MCP 工具结果格式转换
                    if (result.content && Array.isArray(result.content)) {
                        // 提取文本内容
                        const textParts = result.content
                            .filter(c => c.type === 'text')
                            .map(c => c.text);
                        return textParts.join('\n');
                    }
                    return result;
                }
            };
        });
        
        toolRegistry.registerMany(toolDefs, 'mcp');

        // 覆盖历史 enable 状态（避免 ido.tools.enabled 与 MCP 工具开关不同步）
        toolDefs.forEach(def => {
            toolRegistry.setEnabled(def.id, def.enabledByDefault !== false);
        });

        console.log(`[MCP] Registered ${toolDefs.length} tools from ${serverId}`);
    }
    
    /**
     * 从 toolRegistry 注销工具
     */
    function unregisterTools(serverId) {
        const toolRegistry = window.IdoFront.toolRegistry;
        if (!toolRegistry) return;
        
        // 清除该服务器的所有工具
        const allTools = toolRegistry.getByProvider('mcp');
        allTools.forEach(tool => {
            if (tool.serverId === serverId) {
                toolRegistry.unregister(tool.id);
            }
        });
    }
    
    // 暴露 API
    window.IdoFront.mcpClient = {
        connect,
        disconnect,
        callTool,
        getConnectedServers,
        isConnected
    };
    
})();
