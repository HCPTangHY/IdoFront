/**
 * Network Log Panel Plugin
 * 网络日志面板插件 - 显示所有网络请求和响应
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.networkLogPanel = window.IdoFront.networkLogPanel || {};

    let context = null;
    let store = null;
    let currentLogId = null;

    /**
     * 初始化网络日志面板
     */
    window.IdoFront.networkLogPanel.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
    };

    /**
     * 渲染网络日志面板
     */
    window.IdoFront.networkLogPanel.render = function(container) {
        if (!container) return;

        container.innerHTML = '';
        container.className = 'flex flex-col h-full w-full bg-white';

        // 头部
        const header = createHeader();
        container.appendChild(header);

        // 主体区域（分为列表和详情）
        const mainArea = document.createElement('div');
        mainArea.className = 'flex-1 flex flex-col min-h-0 overflow-hidden relative';
        mainArea.id = 'network-log-main-area';
        
        // 日志列表
        const listContainer = createLogList();
        mainArea.appendChild(listContainer);

        // 分隔条
        const resizer = createResizer();
        mainArea.appendChild(resizer);

        // 详情面板
        const detailContainer = createDetailPanel();
        mainArea.appendChild(detailContainer);

        container.appendChild(mainArea);

        // 监听日志更新事件
        setupEventListeners();

        // 初始渲染
        refreshLogList();
    };

    /**
     * 创建头部
     */
    function createHeader() {
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50';

        const title = document.createElement('div');
        title.className = 'flex items-center gap-2';
        title.innerHTML = `
            <span class="material-symbols-outlined text-blue-600 text-[20px]">network_check</span>
            <span class="font-semibold text-gray-800">网络日志</span>
            <span id="network-log-count" class="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-full font-medium">0</span>
        `;

        const actions = document.createElement('div');
        actions.className = 'flex gap-2';

        // 清空按钮
        const clearBtn = document.createElement('button');
        clearBtn.className = 'px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded transition-colors flex items-center gap-1';
        clearBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">delete_sweep</span>
            <span>清空</span>
        `;
        clearBtn.onclick = () => {
            if (confirm('确定要清空所有网络日志吗？')) {
                window.IdoFront.networkLogger.clearLogs();
            }
        };

        actions.appendChild(clearBtn);
        header.appendChild(title);
        header.appendChild(actions);

        return header;
    }

    /**
     * 创建日志列表
     */
    function createLogList() {
        const container = document.createElement('div');
        container.className = 'flex-1 overflow-y-auto border-b border-gray-200';
        container.id = 'network-log-list';

        const table = document.createElement('table');
        table.className = 'w-full text-xs';
        
        const thead = document.createElement('thead');
        thead.className = 'bg-gray-50 sticky top-0 z-10';
        thead.innerHTML = `
            <tr class="border-b border-gray-200">
                <th class="p-2 text-left font-medium text-gray-600 w-8"></th>
                <th class="p-2 text-left font-medium text-gray-600">请求</th>
                <th class="p-2 text-left font-medium text-gray-600 w-20">状态</th>
                <th class="p-2 text-right font-medium text-gray-600 w-24">耗时</th>
                <th class="p-2 text-right font-medium text-gray-600 w-32">时间</th>
            </tr>
        `;

        const tbody = document.createElement('tbody');
        tbody.id = 'network-log-tbody';

        table.appendChild(thead);
        table.appendChild(tbody);
        container.appendChild(table);

        return container;
    }

    /**
     * 创建分隔条
     */
    function createResizer() {
        const resizer = document.createElement('div');
        resizer.className = 'h-1 bg-gray-200 hover:bg-blue-400 cursor-row-resize flex-shrink-0 transition-colors';
        resizer.id = 'network-log-resizer';
        
        let startY = 0;
        let startHeight = 0;
        let isDragging = false;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            startY = e.clientY;
            
            const detailPanel = document.getElementById('network-log-detail');
            if (detailPanel) {
                const rect = detailPanel.getBoundingClientRect();
                startHeight = rect.height;
            }
            
            resizer.classList.add('bg-blue-500');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const detailPanel = document.getElementById('network-log-detail');
            const mainArea = document.getElementById('network-log-main-area');
            
            if (!detailPanel || !mainArea) return;
            
            const deltaY = startY - e.clientY; // 向上拖动为正
            const newHeight = Math.max(100, Math.min(startHeight + deltaY, mainArea.clientHeight - 150));
            
            detailPanel.style.height = `${newHeight}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('bg-blue-500');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });

        return resizer;
    }

    /**
     * 创建详情面板
     */
    function createDetailPanel() {
        const container = document.createElement('div');
        container.className = 'overflow-hidden flex flex-col bg-gray-50 flex-shrink-0';
        container.style.height = '40%'; // 默认高度40%
        container.id = 'network-log-detail';

        const header = document.createElement('div');
        header.className = 'p-2 border-b border-gray-200 bg-white';
        header.innerHTML = `
            <span class="text-xs font-medium text-gray-600">请求详情</span>
        `;

        const content = document.createElement('div');
        content.className = 'flex-1 overflow-y-auto p-3';
        content.id = 'network-log-detail-content';
        content.innerHTML = '<div class="text-xs text-gray-400 text-center py-8">选择一个请求查看详情</div>';

        container.appendChild(header);
        container.appendChild(content);

        return container;
    }

    /**
     * 刷新日志列表
     */
    function refreshLogList() {
        const tbody = document.getElementById('network-log-tbody');
        const countBadge = document.getElementById('network-log-count');
        
        if (!tbody) return;

        const logs = window.IdoFront.networkLogger.getLogs();
        
        // 更新计数
        if (countBadge) {
            countBadge.textContent = logs.length;
        }

        tbody.innerHTML = '';

        if (logs.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td colspan="5" class="p-8 text-center text-gray-400 text-xs">暂无网络请求</td>';
            tbody.appendChild(tr);
            return;
        }

        logs.forEach(log => {
            const tr = createLogRow(log);
            tbody.appendChild(tr);
        });

        // 如果有选中的日志，保持高亮
        if (currentLogId) {
            const selectedRow = tbody.querySelector(`tr[data-log-id="${currentLogId}"]`);
            if (selectedRow) {
                selectedRow.classList.add('bg-blue-50');
            }
        }
    }

    /**
     * 创建日志行
     */
    function createLogRow(log) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors';
        tr.dataset.logId = log.id;

        // 状态图标
        let statusIcon = 'pending';
        let statusColor = 'text-gray-400';
        
        if (log.status === 'success') {
            statusIcon = 'check_circle';
            statusColor = 'text-green-600';
        } else if (log.status === 'error') {
            statusIcon = 'error';
            statusColor = 'text-red-600';
        } else if (log.status === 'streaming') {
            statusIcon = 'stream';
            statusColor = 'text-blue-600';
        }

        // 提取URL路径
        const urlPath = extractUrlPath(log.request.url);
        
        // 状态码
        const statusCode = log.response?.status || '-';
        const statusClass = getStatusClass(statusCode);

        // 耗时
        const duration = log.duration ? `${log.duration}ms` : '-';

        // 时间
        const time = formatTime(log.timestamp);

        tr.innerHTML = `
            <td class="p-2 ${statusColor}">
                <span class="material-symbols-outlined text-[14px]">${statusIcon}</span>
            </td>
            <td class="p-2">
                <div class="font-medium text-gray-800 truncate" title="${log.request.url}">${urlPath}</div>
                <div class="text-[10px] text-gray-500">${log.request.method}</div>
            </td>
            <td class="p-2">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium ${statusClass}">${statusCode}</span>
            </td>
            <td class="p-2 text-right text-gray-600">${duration}</td>
            <td class="p-2 text-right text-gray-500">${time}</td>
        `;

        tr.onclick = () => {
            // 取消其他行的高亮
            document.querySelectorAll('#network-log-tbody tr').forEach(row => {
                row.classList.remove('bg-blue-50');
            });
            
            // 高亮当前行
            tr.classList.add('bg-blue-50');
            
            // 显示详情
            currentLogId = log.id;
            showLogDetail(log);
        };

        return tr;
    }

    /**
     * 显示日志详情
     */
    function showLogDetail(log) {
        const content = document.getElementById('network-log-detail-content');
        if (!content) return;

        content.innerHTML = '';

        // 请求信息
        const requestSection = createDetailSection('请求信息', [
            { label: 'URL', value: log.request.url, mono: true },
            { label: '方法', value: log.request.method },
            { label: '时间', value: new Date(log.timestamp).toLocaleString('zh-CN') }
        ]);
        content.appendChild(requestSection);

        // 请求头
        if (log.request.headers && Object.keys(log.request.headers).length > 0) {
            const headersSection = createJsonSection('请求头', log.request.headers);
            content.appendChild(headersSection);
        }

        // 请求体
        if (log.request.body) {
            const bodySection = createJsonSection('请求体', log.request.body);
            content.appendChild(bodySection);
        }

        // 响应信息
        if (log.response) {
            const responseInfo = createDetailSection('响应信息', [
                { label: '状态码', value: `${log.response.status} ${log.response.statusText}` },
                { label: '耗时', value: log.duration ? `${log.duration}ms` : '-' },
                { label: '类型', value: log.response.isStream ? '流式响应' : '普通响应' }
            ]);
            content.appendChild(responseInfo);

            // 响应头
            if (log.response.headers && Object.keys(log.response.headers).length > 0) {
                const respHeadersSection = createJsonSection('响应头', log.response.headers);
                content.appendChild(respHeadersSection);
            }

            // 响应体
            if (log.response.isStream && log.response.streamChunks) {
                const streamSection = createStreamSection(log.response.streamChunks);
                content.appendChild(streamSection);
            } else if (log.response.body) {
                const respBodySection = createJsonSection('响应体', log.response.body);
                content.appendChild(respBodySection);
            }
        }

        // 错误信息
        if (log.error) {
            const errorSection = createErrorSection(log.error);
            content.appendChild(errorSection);
        }
    }

    /**
     * 创建详情区块
     */
    function createDetailSection(title, items) {
        const section = document.createElement('div');
        section.className = 'mb-4';

        const header = document.createElement('div');
        header.className = 'text-xs font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-200';
        header.textContent = title;

        const content = document.createElement('div');
        content.className = 'space-y-1';

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'flex text-xs';
            row.innerHTML = `
                <span class="text-gray-500 w-20 flex-shrink-0">${item.label}:</span>
                <span class="text-gray-800 flex-1 ${item.mono ? 'font-mono break-all' : ''}">${item.value}</span>
            `;
            content.appendChild(row);
        });

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    /**
     * 创建JSON区块
     */
    function createJsonSection(title, data) {
        const section = document.createElement('div');
        section.className = 'mb-4';

        const header = document.createElement('div');
        header.className = 'text-xs font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-200';
        header.textContent = title;

        const pre = document.createElement('pre');
        pre.className = 'text-[10px] bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto font-mono';
        pre.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

        section.appendChild(header);
        section.appendChild(pre);
        return section;
    }

    /**
     * 创建流式响应区块
     */
    function createStreamSection(chunks) {
        const section = document.createElement('div');
        section.className = 'mb-4';

        const header = document.createElement('div');
        header.className = 'text-xs font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-200 flex items-center justify-between';
        header.innerHTML = `
            <span>流式响应体 (${chunks.length} 个数据块)</span>
            <span class="text-[10px] text-gray-500 font-normal">完整内容</span>
        `;

        // 合并所有数据块
        const fullContent = chunks.map(chunk => chunk.data).join('');

        const pre = document.createElement('pre');
        pre.className = 'text-[10px] bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto font-mono max-h-96 overflow-y-auto';
        pre.textContent = fullContent;

        section.appendChild(header);
        section.appendChild(pre);
        return section;
    }

    /**
     * 创建错误区块
     */
    function createErrorSection(error) {
        const section = document.createElement('div');
        section.className = 'mb-4';

        const header = document.createElement('div');
        header.className = 'text-xs font-semibold text-red-600 mb-2 pb-1 border-b border-red-200';
        header.textContent = '错误信息';

        const content = document.createElement('div');
        content.className = 'bg-red-50 border border-red-200 rounded p-3';
        content.innerHTML = `
            <div class="text-xs text-red-800 font-medium mb-1">${error.name}: ${error.message}</div>
            ${error.stack ? `<pre class="text-[10px] text-red-700 mt-2 overflow-x-auto">${error.stack}</pre>` : ''}
        `;

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    /**
     * 设置事件监听
     */
    function setupEventListeners() {
        if (!store || !store.events) return;

        // 监听日志创建
        store.events.on('network-log:created', () => {
            refreshLogList();
        });

        // 监听日志响应
        store.events.on('network-log:response', ({ logId }) => {
            refreshLogList();
            // 如果当前选中的是这个日志，更新详情
            if (currentLogId === logId) {
                const log = window.IdoFront.networkLogger.getLog(logId);
                if (log) showLogDetail(log);
            }
        });

        // 监听流式数据块
        store.events.on('network-log:stream-chunk', ({ logId }) => {
            refreshLogList();
            if (currentLogId === logId) {
                const log = window.IdoFront.networkLogger.getLog(logId);
                if (log) showLogDetail(log);
            }
        });

        // 监听流式完成
        store.events.on('network-log:stream-complete', ({ logId }) => {
            refreshLogList();
            if (currentLogId === logId) {
                const log = window.IdoFront.networkLogger.getLog(logId);
                if (log) showLogDetail(log);
            }
        });

        // 监听错误
        store.events.on('network-log:error', ({ logId }) => {
            refreshLogList();
            if (currentLogId === logId) {
                const log = window.IdoFront.networkLogger.getLog(logId);
                if (log) showLogDetail(log);
            }
        });

        // 监听清空
        store.events.on('network-log:cleared', () => {
            currentLogId = null;
            refreshLogList();
            const content = document.getElementById('network-log-detail-content');
            if (content) {
                content.innerHTML = '<div class="text-xs text-gray-400 text-center py-8">选择一个请求查看详情</div>';
            }
        });
    }

    /**
     * 工具函数：提取URL路径
     */
    function extractUrlPath(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname.split('/').filter(Boolean).pop() || '/';
            return path;
        } catch (e) {
            return url.split('/').pop() || url;
        }
    }

    /**
     * 工具函数：获取状态码样式
     */
    function getStatusClass(status) {
        if (status === '-') return 'bg-gray-100 text-gray-600';
        if (status >= 200 && status < 300) return 'bg-green-100 text-green-700';
        if (status >= 300 && status < 400) return 'bg-blue-100 text-blue-700';
        if (status >= 400 && status < 500) return 'bg-orange-100 text-orange-700';
        if (status >= 500) return 'bg-red-100 text-red-700';
        return 'bg-gray-100 text-gray-600';
    }

    /**
     * 工具函数：格式化时间
     */
    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', { hour12: false });
    }

})();