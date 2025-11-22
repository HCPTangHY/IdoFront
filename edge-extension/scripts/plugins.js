/**
 * =============================================================================
 * IDOFRONT MAIN ENTRY
 * Connects Framework UI with IdoFront Core Plugin
 * =============================================================================
 */
document.addEventListener('IdoFrontLoaded', async () => {
    
    // 1. Initialize Framework
    Framework.init();

    // 2. Initialize Core Plugin (异步初始化)
    // Now using the namespace IdoFront from loader
    const ido = await IdoFront.init(Framework);

    // --- UI Bindings ---

    // Override Send Button
    const btnSend = document.getElementById('btn-send');
    const input = document.getElementById('user-input');

    // Remove default framework listener if any (it was set in init, but we can overwrite onclick)
    btnSend.onclick = () => {
        const val = input.value.trim();
        const fileUpload = window.IdoFront.fileUpload;
        const attachedFiles = fileUpload ? fileUpload.getAttachedFiles() : [];
        
        // 至少需要文本或附件之一
        if(!val && attachedFiles.length === 0) return;
        
        // 发送消息（带附件）
        ido.actions.sendMessage(val, attachedFiles);
        
        // 清空输入和附件
        input.value = '';
        input.style.height = 'auto';
        
        if (fileUpload && fileUpload.clearAttachments) {
            fileUpload.clearAttachments();
        }
    };

    // Handle Enter key in textarea
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            btnSend.click();
        }
    });

    // Render History List（增量更新，避免每次全量重绘）
    function renderHistory() {
        const list = document.getElementById('history-list');
        if (!list) return;

        // 使用面具过滤后的对话列表
        const conversationActions = window.IdoFront.conversationActions;
        const conversations = conversationActions && conversationActions.getPersonaConversations
            ? conversationActions.getPersonaConversations()
            : (ido.state.conversations || []);

        // 记录当前 DOM 中的会话项，按 conv.id 建立索引，便于复用
        const existingItems = new Map();
        Array.from(list.children).forEach(child => {
            const convId = child.getAttribute('data-conv-id');
            if (convId) {
                existingItems.set(convId, child);
            }
        });

        const nextIds = new Set();

        conversations.forEach(conv => {
            const isActive = conv.id === ido.state.activeConversationId;
            let item = existingItems.get(conv.id);

            if (!item) {
                // 新建节点
                item = document.createElement('div');
                item.setAttribute('data-conv-id', conv.id);

                const titleSpan = document.createElement('span');
                titleSpan.className = "flex items-center gap-2 truncate";
                titleSpan.setAttribute('data-role', 'title');

                const iconSpan = document.createElement('span');
                iconSpan.className = "material-symbols-outlined text-[16px]";
                iconSpan.setAttribute('data-role', 'icon');

                const textSpan = document.createElement('span');
                textSpan.className = "truncate";
                textSpan.setAttribute('data-role', 'title-text');

                titleSpan.appendChild(iconSpan);
                titleSpan.appendChild(textSpan);

                const delBtn = document.createElement('button');
                delBtn.className = "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1";
                delBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">delete</span>';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (confirm('确定要删除此对话吗？')) {
                        ido.actions.deleteConversation(conv.id);
                    }
                };

                item.appendChild(titleSpan);
                item.appendChild(delBtn);
            }

            // 更新样式和点击行为（避免重新绑定列表级事件）
            item.className = `p-2 rounded cursor-pointer text-gray-600 truncate text-xs flex items-center justify-between group ${
                isActive ? 'bg-blue-50 text-blue-600 font-medium' : 'hover:bg-gray-100'
            }`;
            item.onclick = () => ido.actions.selectConversation(conv.id);

            // 更新标题内容（包含图标和会话标题），避免将动态数据直接拼接进 innerHTML
            const titleSpan = item.querySelector('[data-role="title"]');
            if (titleSpan) {
                let iconSpan = titleSpan.querySelector('[data-role="icon"]');
                if (!iconSpan) {
                    iconSpan = document.createElement('span');
                    iconSpan.className = "material-symbols-outlined text-[16px]";
                    iconSpan.setAttribute('data-role', 'icon');
                    titleSpan.appendChild(iconSpan);
                }

                let textSpan = titleSpan.querySelector('[data-role="title-text"]');
                if (!textSpan) {
                    textSpan = document.createElement('span');
                    textSpan.className = "truncate";
                    textSpan.setAttribute('data-role', 'title-text');
                    titleSpan.appendChild(textSpan);
                }

                iconSpan.textContent = isActive ? 'chat_bubble' : 'chat_bubble_outline';
                textSpan.textContent = conv.title || '';
            }

            nextIds.add(conv.id);
            // 使用 appendChild 来确保顺序与 conversations 一致，已有节点会被移动而不是重建
            list.appendChild(item);
        });

        // 移除已不存在的会话项以及初始的占位节点
        Array.from(list.children).forEach(child => {
            const convId = child.getAttribute('data-conv-id');
            if (!convId || !nextIds.has(convId)) {
                list.removeChild(child);
            }
        });
    }

    // Listen for Store updates（以 Store 为唯一业务状态源）
    if (ido.events && typeof ido.events.on === 'function') {
        ido.events.on('updated', () => {
            renderHistory();
            // Update title
            const activeConv = ido.state.conversations.find(c => c.id === ido.state.activeConversationId);
            const titleEl = document.getElementById('chat-title');
            if (titleEl && activeConv) {
                titleEl.textContent = activeConv.title;
            }
        });
    }

    // Initial Render
    renderHistory();



});