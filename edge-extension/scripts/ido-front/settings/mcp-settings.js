/**
 * MCP (Model Context Protocol) Settings
 * MCP 服务器管理与工具配置
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.mcpSettings = {};

    const STORAGE_KEY = 'ido.mcp.servers';
    const TOOL_STATES_KEY = 'ido.mcp.toolStates';
    
    // MCP 传输类型（按 MCP 协议规范）
    const TRANSPORT_TYPES = [
        { value: 'sse', label: 'SSE', description: 'HTTP + Server-Sent Events', placeholder: 'http://localhost:3100/sse' },
        { value: 'streamable-http', label: 'Streamable HTTP', description: '纯 HTTP 流式传输', placeholder: 'https://mcp.example.com/mcp' },
        { value: 'stdio', label: 'Stdio (仅桌面版)', description: '本地进程通信', placeholder: 'npx -y @anthropic/mcp-server-demo' }
    ];

    let context = null;
    let store = null;
    let servers = [];
    let toolStates = {};  // { toolId: boolean }
    let settingsContainer = null;  // 保存设置容器引用

    // ========== 存储操作 ==========

    function loadServers() {
        try {
            const saved = Framework?.storage?.getItem(STORAGE_KEY);
            servers = Array.isArray(saved) ? saved : [];
        } catch (e) {
            servers = [];
        }
        return servers;
    }

    function saveServers() {
        try {
            Framework?.storage?.setItem(STORAGE_KEY, servers);
        } catch (e) {
            console.error('[MCP] Failed to save servers:', e);
        }
    }

    function loadToolStates() {
        try {
            const saved = Framework?.storage?.getItem(TOOL_STATES_KEY);
            toolStates = (saved && typeof saved === 'object') ? saved : {};
        } catch (e) {
            toolStates = {};
        }
        return toolStates;
    }

    function saveToolStates() {
        try {
            Framework?.storage?.setItem(TOOL_STATES_KEY, toolStates);
        } catch (e) {
            console.error('[MCP] Failed to save tool states:', e);
        }
    }

    // ========== 服务器管理 ==========

    function generateId() {
        return 'mcp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    function addServer(serverConfig) {
        const server = {
            id: generateId(),
            name: serverConfig.name || '未命名服务',
            transport: serverConfig.transport || 'sse',  // sse | websocket | stdio
            url: serverConfig.url || '',
            command: serverConfig.command || '',  // stdio 模式的命令
            args: serverConfig.args || [],        // stdio 模式的参数
            enabled: serverConfig.enabled !== false,
            status: 'disconnected',  // disconnected | connecting | connected | error
            tools: [],
            lastError: null,
            createdAt: Date.now()
        };
        servers.push(server);
        saveServers();
        return server;
    }

    function updateServer(id, updates) {
        const index = servers.findIndex(s => s.id === id);
        if (index >= 0) {
            servers[index] = { ...servers[index], ...updates };
            saveServers();
            return servers[index];
        }
        return null;
    }

    function deleteServer(id) {
        const index = servers.findIndex(s => s.id === id);
        if (index >= 0) {
            servers.splice(index, 1);
            saveServers();
            return true;
        }
        return false;
    }

    function getServer(id) {
        return servers.find(s => s.id === id);
    }

    function getAllServers() {
        return [...servers];
    }

    function getEnabledServers() {
        return servers.filter(s => s.enabled !== false);
    }

    // ========== 工具状态管理 ==========

    function getToolState(toolId) {
        return toolStates[toolId] !== false;  // 默认启用
    }

    function setToolState(toolId, enabled) {
        toolStates[toolId] = enabled;
        saveToolStates();
    }

    // ========== 设置界面渲染 ==========

    // 刷新设置页面（供外部调用）
    function refreshSettingsUI() {
        // 方法1：使用保存的容器引用
        if (settingsContainer && settingsContainer.isConnected) {
            renderMCPSettings(settingsContainer);
            return;
        }
        
        // 方法2：查找当前活动的 MCP 设置面板
        const mcpPanel = document.querySelector('[data-settings-tab="mcp"]');
        if (mcpPanel) {
            settingsContainer = mcpPanel;
            renderMCPSettings(mcpPanel);
            return;
        }
        
        // 方法3：通过 settingsManager 重新渲染
        if (window.IdoFront.settingsManager?.refreshCurrentTab) {
            window.IdoFront.settingsManager.refreshCurrentTab();
        }
    }

    function renderMCPSettings(container) {
        container.innerHTML = '';
        container.setAttribute('data-settings-tab', 'mcp'); // 添加标识
        settingsContainer = container; // 保存引用

        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-4 max-w-2xl';
        container.appendChild(wrapper);

        // 标题区域 + 快捷操作
        const header = document.createElement('div');
        header.className = 'flex items-start justify-between gap-3';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'min-w-0';
        titleGroup.innerHTML = `
            <div class="flex items-center gap-2 mb-1">
                <span class="material-symbols-outlined text-[22px] text-blue-500">dns</span>
                <h3 class="text-base font-semibold text-gray-800">MCP 服务器</h3>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">工具扩展</span>
            </div>
            <p class="text-sm text-gray-500">连接外部工具服务，扩展 AI 能力</p>
        `;

        const addBtn = document.createElement('button');
        addBtn.className = 'ido-btn ido-btn--primary ido-btn--sm flex items-center gap-1.5 flex-shrink-0';
        addBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">add</span><span>添加服务器</span>';
        addBtn.onclick = () => showAddServerDialog(container);

        header.appendChild(titleGroup);
        header.appendChild(addBtn);
        wrapper.appendChild(header);

        // 服务器列表
        const list = document.createElement('div');
        list.className = 'space-y-3';

        if (servers.length > 0) {
            servers.forEach(server => {
                const item = createServerItem(server, list);
                list.appendChild(item);
            });
        } else {
            const emptyCard = document.createElement('div');
            emptyCard.className = 'ido-card p-6 text-center text-gray-500';
            emptyCard.innerHTML = `
                <div class="flex flex-col items-center gap-2">
                    <span class="material-symbols-outlined text-[44px] text-gray-300">dns</span>
                    <div class="text-sm font-medium text-gray-700">暂无 MCP 服务器</div>
                    <div class="text-xs text-gray-400">点击右上角按钮添加</div>
                </div>
            `;
            list.appendChild(emptyCard);
        }

        wrapper.appendChild(list);

        // 帮助信息
        const helpInfo = document.createElement('div');
        helpInfo.className = 'ido-card p-4 bg-blue-50 border border-blue-100';
        helpInfo.innerHTML = `
            <div class="flex items-start gap-3">
                <span class="material-symbols-outlined text-blue-500 text-[20px] mt-0.5">info</span>
                <div class="text-sm text-gray-600">
                    <p class="font-medium text-gray-700 mb-1">什么是 MCP？</p>
                    <p>MCP (Model Context Protocol) 是一个开放协议，让 AI 可以连接外部工具和数据源。</p>
                    <p class="mt-2">你需要在本地运行 MCP 代理服务来使用此功能。</p>
                </div>
            </div>
        `;
        wrapper.appendChild(helpInfo);
    }

    function createServerItem(server, listContainer) {
        const item = document.createElement('div');
        item.className = 'p-4 rounded-xl border border-gray-200 bg-white hover:shadow-sm transition-shadow';
        item.dataset.serverId = server.id;

        const statusConfig = {
            connected: { color: 'text-green-500', bg: 'bg-green-500', text: '已连接' },
            connecting: { color: 'text-yellow-500', bg: 'bg-yellow-500', text: '连接中...' },
            disconnected: { color: 'text-gray-400', bg: 'bg-gray-300', text: '未连接' },
            error: { color: 'text-red-500', bg: 'bg-red-500', text: '连接失败' }
        };
        const status = statusConfig[server.status] || statusConfig.disconnected;
        const toolCount = server.tools?.length || 0;
        
        // 传输类型配置
        const transportConfig = {
            sse: { label: 'SSE', icon: 'cloud', color: 'text-blue-500' },
            'streamable-http': { label: 'HTTP', icon: 'http', color: 'text-green-500' },
            stdio: { label: 'Stdio', icon: 'terminal', color: 'text-orange-500' }
        };
        const transport = transportConfig[server.transport] || transportConfig.sse;
        
        // 根据传输类型显示不同的连接信息
        const connectionInfo = server.transport === 'stdio' 
            ? `${server.command} ${(server.args || []).join(' ')}`.trim()
            : server.url;

        item.innerHTML = `
            <div class="flex items-start justify-between">
                <div class="flex items-start gap-3 flex-1 min-w-0">
                    <div class="w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center flex-shrink-0">
                        <span class="material-symbols-outlined text-[20px] ${transport.color}">${transport.icon}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="font-medium text-gray-800 truncate">${server.name}</span>
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium ${transport.color} bg-gray-100 rounded">
                                <span class="material-symbols-outlined text-[12px]">${transport.icon}</span>
                                ${transport.label}
                            </span>
                        </div>
                        <div class="text-xs text-gray-500 mt-0.5 truncate font-mono">${connectionInfo}</div>
                        <div class="flex items-center gap-3 mt-2">
                            <span class="flex items-center gap-1.5 text-xs ${status.color}">
                                <span class="w-1.5 h-1.5 rounded-full ${status.bg}"></span>
                                ${status.text}
                            </span>
                            ${toolCount > 0 ? `<span class="text-xs text-gray-400">${toolCount} 个工具</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-2 ml-3">
                    ${server.status === 'disconnected' || server.status === 'error' ? `
                        <button class="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors" data-action="connect">
                            ${server.status === 'error' ? '重试' : '连接'}
                        </button>
                    ` : ''}
                    ${server.status === 'connecting' ? `
                        <button class="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed" disabled>
                            连接中...
                        </button>
                    ` : ''}
                    ${server.status === 'connected' ? `
                        <button class="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors" data-action="disconnect">
                            断开
                        </button>
                    ` : ''}
                    <button class="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors" data-action="edit">
                        <span class="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button class="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors" data-action="delete">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                </div>
            </div>
        `;

        // 事件绑定
        item.querySelector('[data-action="connect"]')?.addEventListener('click', () => {
            connectServer(server.id, item);
        });

        item.querySelector('[data-action="disconnect"]')?.addEventListener('click', () => {
            disconnectServer(server.id, item);
        });

        item.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
            showEditServerDialog(server, listContainer);
        });

        item.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
            if (confirm(`确定要删除服务器 "${server.name}" 吗？`)) {
                // 如果已连接，先断开
                const mcpClient = window.IdoFront.mcpClient;
                if (mcpClient && mcpClient.isConnected(server.id)) {
                    mcpClient.disconnect(server.id);
                }
                
                deleteServer(server.id);
                
                // 刷新设置页面
                refreshSettingsUI();
                
                store?.events?.emit('mcp:tools:updated');
            }
        });

        return item;
    }

    // 连接服务器
    async function connectServer(serverId, itemEl) {
        const server = servers.find(s => s.id === serverId);
        if (!server) return;

        // 更新状态为连接中
        server.status = 'connecting';
        updateServer(serverId, { status: 'connecting' });
        refreshSettingsUI();

        try {
            const mcpClient = window.IdoFront.mcpClient;
            if (!mcpClient) {
                throw new Error('MCP 客户端未加载');
            }
            
            // 连接到 MCP 服务器
            const result = await mcpClient.connect(server);
            
            // 更新服务器状态
            server.status = 'connected';
            server.tools = result.tools.map(t => ({
                name: t.name,
                description: t.description || ''
            }));
            server.serverInfo = result.serverInfo;
            server.lastError = null;
            
            updateServer(serverId, {
                status: 'connected',
                tools: server.tools,
                serverInfo: server.serverInfo,
                lastError: null
            });
            refreshSettingsUI();
            
            // 触发工具更新事件
            store?.events?.emit('mcp:tools:updated');
            
            console.log('[MCP] Connected successfully:', serverId, result);
            
        } catch (error) {
            server.status = 'error';
            server.lastError = error.message;
            updateServer(serverId, { status: 'error', lastError: error.message });
            refreshSettingsUI();
            
            // 显示错误提示
            console.error('[MCP] Connection failed:', error);
            alert(`连接失败: ${error.message}`);
        }
    }

    // 断开服务器连接
    function disconnectServer(serverId, itemEl) {
        const server = servers.find(s => s.id === serverId);
        if (!server) return;

        // 断开 MCP 连接
        const mcpClient = window.IdoFront.mcpClient;
        if (mcpClient) {
            mcpClient.disconnect(serverId);
        }
        
        server.status = 'disconnected';
        server.tools = [];
        updateServer(serverId, { status: 'disconnected', tools: [] });
        refreshSettingsUI();
        
        store?.events?.emit('mcp:tools:updated');
    }

    function updateServerItemUI(itemEl, server) {
        console.log('[MCP] updateServerItemUI called, server:', server.id, server.status);
        
        // 优先刷新整个设置页面，确保状态一致
        if (settingsContainer && settingsContainer.isConnected) {
            console.log('[MCP] Refreshing via settingsContainer');
            renderMCPSettings(settingsContainer);
            return;
        }
        
        // 降级：尝试通过 ID 查找 item
        const existingItem = document.querySelector(`[data-server-id="${server.id}"]`);
        if (existingItem && existingItem.parentNode) {
            console.log('[MCP] Refreshing via existing item');
            const parent = existingItem.parentNode;
            try {
                const newItem = createServerItem(server, parent);
                parent.replaceChild(newItem, existingItem);
            } catch (e) {
                console.warn('[MCP] Failed to update server item:', e);
            }
            return;
        }
        
        console.warn('[MCP] Cannot refresh UI - no valid container or item found');
    }

    // 通用的服务器表单渲染
    function renderServerForm(container, server, onSubmit) {
        const isEdit = !!server;
        const currentTransport = server?.transport || 'sse';
        
        container.innerHTML = `
            <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 class="text-lg font-semibold text-gray-800">${isEdit ? '编辑' : '添加'} MCP 服务器</h3>
                <button class="text-gray-400 hover:text-gray-600" id="mcp-form-close">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="p-6 space-y-4 overflow-y-auto">
                <!-- 服务器名称 -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1.5">服务器名称</label>
                    <input type="text" id="mcp-server-name" value="${server?.name || ''}" 
                        class="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" 
                        placeholder="如: 本地文件系统">
                </div>
                
                <!-- 传输类型 -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">传输类型</label>
                    <div class="grid grid-cols-3 gap-2" id="mcp-transport-selector">
                        ${TRANSPORT_TYPES.map(t => `
                            <button type="button" data-transport="${t.value}" 
                                class="p-3 rounded-xl border-2 transition-all text-center ${
                                    t.value === currentTransport 
                                        ? 'border-blue-500 bg-blue-50' 
                                        : 'border-gray-200 hover:border-gray-300'
                                }">
                                <div class="text-sm font-medium text-gray-800">${t.label}</div>
                                <div class="text-xs text-gray-500 mt-0.5">${t.description}</div>
                            </button>
                        `).join('')}
                    </div>
                </div>
                
                <!-- 动态字段区域 -->
                <div id="mcp-dynamic-fields"></div>
                
                <button id="mcp-form-submit" class="w-full py-3 bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 transition-colors">
                    ${isEdit ? '保存' : '添加服务器'}
                </button>
            </div>
        `;
        
        let selectedTransport = currentTransport;
        const dynamicFields = container.querySelector('#mcp-dynamic-fields');
        
        // 渲染动态字段
        function renderDynamicFields(transport) {
            const config = TRANSPORT_TYPES.find(t => t.value === transport);
            
            if (transport === 'stdio') {
                dynamicFields.innerHTML = `
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1.5">命令</label>
                            <input type="text" id="mcp-server-command" value="${server?.command || ''}" 
                                class="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm" 
                                placeholder="${config?.placeholder || 'npx'}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1.5">参数 (每行一个)</label>
                            <textarea id="mcp-server-args" rows="3"
                                class="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm resize-none" 
                                placeholder="-y\n@anthropic/mcp-server-demo">${(server?.args || []).join('\n')}</textarea>
                        </div>
                        <div class="p-3 bg-orange-50 rounded-xl">
                            <div class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-orange-500 text-[18px] mt-0.5">warning</span>
                                <div class="text-xs text-orange-700">
                                    <p class="font-medium">仅桌面版可用</p>
                                    <p class="mt-0.5">Stdio 传输需要在 Electron 桌面应用中使用，浏览器扩展不支持。</p>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                const urlLabel = transport === 'websocket' ? 'WebSocket 地址' : 'SSE 端点地址';
                dynamicFields.innerHTML = `
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1.5">${urlLabel}</label>
                        <input type="text" id="mcp-server-url" value="${server?.url || ''}" 
                            class="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm" 
                            placeholder="${config?.placeholder || ''}">
                    </div>
                `;
            }
        }
        
        // 初始渲染
        renderDynamicFields(selectedTransport);
        
        // 传输类型切换
        container.querySelectorAll('[data-transport]').forEach(btn => {
            btn.addEventListener('click', () => {
                // 更新选中状态
                container.querySelectorAll('[data-transport]').forEach(b => {
                    b.classList.remove('border-blue-500', 'bg-blue-50');
                    b.classList.add('border-gray-200');
                });
                btn.classList.remove('border-gray-200');
                btn.classList.add('border-blue-500', 'bg-blue-50');
                
                selectedTransport = btn.dataset.transport;
                renderDynamicFields(selectedTransport);
            });
        });
        
        // 关闭按钮
        container.querySelector('#mcp-form-close').onclick = () => context.hideBottomSheet();
        
        // 提交按钮
        container.querySelector('#mcp-form-submit').onclick = () => {
            const name = container.querySelector('#mcp-server-name').value.trim();
            
            if (!name) {
                alert('请输入服务器名称');
                return;
            }
            
            const serverConfig = {
                name,
                transport: selectedTransport
            };
            
            if (selectedTransport === 'stdio') {
                serverConfig.command = container.querySelector('#mcp-server-command')?.value.trim() || '';
                const argsText = container.querySelector('#mcp-server-args')?.value.trim() || '';
                serverConfig.args = argsText ? argsText.split('\n').map(a => a.trim()).filter(Boolean) : [];
                
                if (!serverConfig.command) {
                    alert('请输入命令');
                    return;
                }
            } else {
                serverConfig.url = container.querySelector('#mcp-server-url')?.value.trim() || '';
                
                if (!serverConfig.url) {
                    alert('请输入地址');
                    return;
                }
            }
            
            onSubmit(serverConfig);
        };
    }

    function showAddServerDialog(containerRef) {
        context?.showBottomSheet((sheetContainer) => {
            renderServerForm(sheetContainer, null, (serverConfig) => {
                const newServer = addServer(serverConfig);
                console.log('[MCP] Server added:', newServer);
                context.hideBottomSheet();
                
                // 延迟刷新，确保 BottomSheet 完全关闭
                setTimeout(() => {
                    refreshSettingsUI();
                }, 100);
            });
        });
    }

    function showEditServerDialog(server, listContainer) {
        context?.showBottomSheet((sheetContainer) => {
            renderServerForm(sheetContainer, server, (serverConfig) => {
                updateServer(server.id, serverConfig);
                console.log('[MCP] Server updated:', server.id);
                context.hideBottomSheet();
                
                // 延迟刷新，确保 BottomSheet 完全关闭
                setTimeout(() => {
                    refreshSettingsUI();
                }, 100);
            });
        });
    }

    // ========== 初始化 ==========

    window.IdoFront.mcpSettings.init = function(ctx, storeInstance) {
        context = ctx;
        store = storeInstance;

        loadServers();
        loadToolStates();

        // 注册设置标签页
        if (window.IdoFront.settingsManager?.registerTab) {
            window.IdoFront.settingsManager.registerTab({
                id: 'mcp',
                label: 'MCP 服务',
                icon: 'dns',
                order: 34,
                render: renderMCPSettings
            });
        }

        // 重连之前已连接的服务器
        reconnectPreviouslyConnectedServers();

        console.log('[MCP] Settings initialized');
    };

    /**
     * 重连之前已连接的服务器
     * APP 重新加载时，存储中的状态可能是 connected，但实际连接已断开
     */
    async function reconnectPreviouslyConnectedServers() {
        const serversToReconnect = servers.filter(s => s.status === 'connected');
        
        if (serversToReconnect.length === 0) {
            console.log('[MCP] No servers to reconnect');
            return;
        }
        
        console.log('[MCP] Reconnecting', serversToReconnect.length, 'servers...');
        
        // 先将状态重置为 disconnected（因为实际连接已断开）
        serversToReconnect.forEach(server => {
            server.status = 'disconnected';
            server.tools = [];
        });
        saveServers();
        
        // 延迟一点再开始重连，确保 mcpClient 已加载
        setTimeout(async () => {
            for (const server of serversToReconnect) {
                try {
                    console.log('[MCP] Auto-reconnecting:', server.name);
                    
                    server.status = 'connecting';
                    updateServer(server.id, { status: 'connecting' });
                    
                    const mcpClient = window.IdoFront.mcpClient;
                    if (!mcpClient) {
                        throw new Error('MCP 客户端未加载');
                    }
                    
                    const result = await mcpClient.connect(server);
                    
                    server.status = 'connected';
                    server.tools = result.tools.map(t => ({
                        name: t.name,
                        description: t.description || ''
                    }));
                    server.serverInfo = result.serverInfo;
                    server.lastError = null;
                    
                    updateServer(server.id, {
                        status: 'connected',
                        tools: server.tools,
                        serverInfo: server.serverInfo,
                        lastError: null
                    });
                    
                    console.log('[MCP] Auto-reconnected:', server.name, 'tools:', server.tools.length);
                    
                } catch (error) {
                    console.warn('[MCP] Auto-reconnect failed:', server.name, error.message);
                    server.status = 'disconnected';
                    server.lastError = error.message;
                    updateServer(server.id, { 
                        status: 'disconnected', 
                        lastError: error.message,
                        tools: []
                    });
                }
            }
            
            // 刷新设置页面（如果已打开）
            refreshSettingsUI();
            
            // 触发工具更新事件
            store?.events?.emit('mcp:tools:updated');
            
        }, 500);  // 延迟 500ms 确保所有模块已加载
    }

    // ========== 对外 API ==========

    window.IdoFront.mcpSettings.getServers = getAllServers;
    window.IdoFront.mcpSettings.getEnabledServers = getEnabledServers;
    window.IdoFront.mcpSettings.getServer = getServer;
    window.IdoFront.mcpSettings.addServer = addServer;
    window.IdoFront.mcpSettings.updateServer = updateServer;
    window.IdoFront.mcpSettings.deleteServer = deleteServer;
    window.IdoFront.mcpSettings.getToolState = getToolState;
    window.IdoFront.mcpSettings.setToolState = setToolState;

    // 获取所有可用的 MCP 工具（用于工具面板显示）
    window.IdoFront.mcpSettings.getAllTools = function() {
        const allTools = [];
        
        servers.forEach(server => {
            if (server.status === 'connected' && server.tools) {
                server.tools.forEach(tool => {
                    allTools.push({
                        id: `${server.id}:${tool.name}`,
                        name: tool.name,
                        description: tool.description,
                        serverId: server.id,
                        serverName: server.name,
                        enabled: getToolState(`${server.id}:${tool.name}`)
                    });
                });
            }
        });
        
        return allTools;
    };

    // 获取用于工具面板显示的服务器分组
    window.IdoFront.mcpSettings.getServerGroups = function() {
        return servers.map(server => ({
            id: server.id,
            name: server.name,
            status: server.status,
            tools: (server.tools || []).map(tool => ({
                id: `${server.id}:${tool.name}`,
                name: tool.name,
                description: tool.description,
                enabled: getToolState(`${server.id}:${tool.name}`)
            }))
        }));
    };

})();
