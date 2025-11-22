/**
 * Persona Settings
 * 管理面具（助手设定）列表
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.personaSettings = window.IdoFront.personaSettings || {};

    let context = null;
    let store = null;

    /**
     * 渲染面具管理列表
     */
    window.IdoFront.personaSettings.render = function(container, frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;

        container.innerHTML = '';

        // 顶部：添加按钮
        const header = document.createElement('div');
        header.className = "flex justify-between items-center mb-4";
        
        const title = document.createElement('h3');
        title.className = "text-lg font-medium text-gray-800";
        title.textContent = "面具列表";
        
        const addBtn = context.ui.createIconButton({
            label: '新建面具',
            icon: 'add',
            className: "bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1",
            iconClassName: "material-symbols-outlined text-[18px]",
            onClick: () => {
                if (window.IdoFront.personaEditor && window.IdoFront.personaEditor.open) {
                    window.IdoFront.personaEditor.open(null, context, store);
                }
            }
        });

        header.appendChild(title);
        header.appendChild(addBtn);
        container.appendChild(header);

        // 列表容器
        const list = document.createElement('div');
        list.className = "space-y-3";
        
        const personas = store.state.personas || [];
        
        if (personas.length === 0) {
            const empty = document.createElement('div');
            empty.className = "text-center py-8 text-gray-400 text-sm";
            empty.textContent = "暂无自定义面具，正在使用默认助手";
            list.appendChild(empty);
        } else {
            personas.forEach(persona => {
                const item = createPersonaItem(persona, container);
                list.appendChild(item);
            });
        }

        container.appendChild(list);
    };

    function createPersonaItem(persona, container) {
        const item = document.createElement('div');
        // 紧凑型卡片样式
        item.className = "border border-gray-200 rounded-lg p-2.5 hover:border-red-500 hover:shadow-md transition-all bg-white";
        
        // 单行布局
        const row = document.createElement('div');
        row.className = "flex justify-between items-center gap-2";
        
        // 左侧：名称和徽章
        const leftSection = document.createElement('div');
        leftSection.className = "flex items-center gap-2 flex-1 min-w-0";
        
        const name = document.createElement('div');
        name.className = "font-medium text-gray-800 text-sm truncate";
        name.textContent = persona.name;
        
        leftSection.appendChild(name);
        
        if (persona.id === store.state.activePersonaId) {
            const badge = document.createElement('span');
            badge.className = "bg-black text-white text-[9px] px-1.5 py-0.5 transform -skew-x-12 shadow-sm font-bold tracking-wider flex-shrink-0";
            badge.textContent = "当前";
            leftSection.appendChild(badge);
        }
        
        // 中间：参数信息（紧凑显示）
        const params = document.createElement('div');
        params.className = "flex items-center gap-2 text-[10px] text-gray-400 flex-shrink-0";
        
        const temp = document.createElement('span');
        temp.textContent = `T:${persona.temperature}`;
        
        const stream = document.createElement('span');
        stream.textContent = persona.stream ? '流式' : '非流式';
        
        params.appendChild(temp);
        params.appendChild(stream);
        
        // 右侧：操作按钮
        const actions = document.createElement('div');
        actions.className = "flex items-center gap-0.5 flex-shrink-0";
        
        // Edit Button - 更小的图标
        const editBtn = context.ui.createIconButton({
            icon: 'edit',
            title: '编辑',
            className: "p-1 hover:bg-gray-100 rounded text-gray-500",
            iconClassName: "material-symbols-outlined text-[16px]",
            onClick: () => {
                if (window.IdoFront.personaEditor && window.IdoFront.personaEditor.open) {
                    window.IdoFront.personaEditor.open(persona, context, store);
                }
            }
        });
        actions.appendChild(editBtn);
        
        // Delete Button
        if (!persona.isDefault) {
            const deleteBtn = context.ui.createIconButton({
                icon: 'delete',
                title: '删除',
                className: "p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-colors",
                iconClassName: "material-symbols-outlined text-[16px]",
                onClick: () => {
                    if (confirm(`确定要删除面具 "${persona.name}" 吗？相关的对话也将被删除。`)) {
                        const success = store.deletePersona(persona.id);
                        if (success) {
                            window.IdoFront.personaSettings.render(container, context, store);
                        }
                    }
                }
            });
            actions.appendChild(deleteBtn);
        }
        
        row.appendChild(leftSection);
        row.appendChild(params);
        row.appendChild(actions);
        item.appendChild(row);
        
        return item;
    }

})();