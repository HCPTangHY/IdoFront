/**
 * Channel Settings
 * 渠道管理页面渲染
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.channelSettings = window.IdoFront.channelSettings || {};

    const channelRegistry = window.IdoFront.channelRegistry;
    let channelEditor = null;

    /**
     * 渲染渠道设置页面
     */
    window.IdoFront.channelSettings.render = function(container, context, store) {
        // 获取渠道编辑器模块
        channelEditor = window.IdoFront.channelEditor;

        // 准备渠道类型映射，供徽章/提示使用
        const registryMap = new Map();
        if (channelRegistry && typeof channelRegistry.listTypes === 'function') {
            channelRegistry.listTypes().forEach(def => {
                registryMap.set(def.id, def);
            });
        }

        // Header Actions（仅创建一次，后续复用）
        let actions = container.querySelector('[data-role="channel-actions"]');
        if (!actions) {
            actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.justifyContent = 'space-between';
            actions.style.alignItems = 'center';
            actions.style.marginBottom = 'var(--ido-spacing-lg)';
            actions.setAttribute('data-role', 'channel-actions');
            
            const desc = document.createElement('div');
            desc.style.fontSize = '0.75rem';
            desc.style.color = 'var(--ido-color-text-secondary)';
            desc.textContent = '管理 AI 模型渠道配置';
            
            const addBtn = document.createElement('button');
            addBtn.className = 'ido-btn ido-btn--primary ido-btn--sm';
            addBtn.id = 'btn-add-channel';
            
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined text-[16px]';
            icon.textContent = 'add';
            
            addBtn.appendChild(icon);
            addBtn.appendChild(document.createTextNode(' 新增渠道'));
            
            addBtn.onclick = () => {
                if (channelEditor && channelEditor.open) {
                    channelEditor.open(null, context, store);
                }
            };
            
            actions.appendChild(desc);
            actions.appendChild(addBtn);
            container.appendChild(actions);
        }
        
        // Channel List（同一个容器内进行增量更新）
        let list = container.querySelector('[data-role="channel-list"]');
        if (!list) {
            list = document.createElement('div');
            list.style.display = 'flex';
            list.style.flexDirection = 'column';
            list.style.gap = 'var(--ido-spacing-md)';
            list.setAttribute('data-role', 'channel-list');
            container.appendChild(list);
        }

        const channels = store.state.channels || [];

        // 空列表：保留一个稳定的占位元素，避免频繁创建/销毁
        if (channels.length === 0) {
            // 移除所有已有渠道项，仅保留占位提示
            Array.from(list.children).forEach(child => {
                if (child.getAttribute('data-role') !== 'channel-empty') {
                    list.removeChild(child);
                }
            });

            let empty = list.querySelector('[data-role="channel-empty"]');
            if (!empty) {
                empty = document.createElement('div');
                empty.className = 'ido-empty';
                empty.setAttribute('data-role', 'channel-empty');
                empty.textContent = '暂无渠道';
                list.appendChild(empty);
            }
            return;
        }

        // 有渠道配置时，移除占位提示
        const empty = list.querySelector('[data-role="channel-empty"]');
        if (empty) {
            list.removeChild(empty);
        }

        // 记录现有 DOM 节点，便于复用和删除
        const existingItems = new Map();
        Array.from(list.children).forEach(child => {
            const id = child.getAttribute('data-channel-id');
            if (id) {
                existingItems.set(id, child);
            }
        });

        const nextIds = new Set();

        const typeColors = {
            'openai': 'ido-badge ido-badge--success',
            'gemini': 'ido-badge ido-badge--primary',
            'claude': 'ido-badge ido-badge--warning'
        };

        channels.forEach(channel => {
            const typeDef = registryMap.get(channel.type);
            const isMissingType = !typeDef;
            const badgeLabel = typeDef?.label || channel.type || '未指定';
            const badgeClass = isMissingType
                ? 'ido-badge ido-badge--error'
                : (typeColors[channel.type] || 'ido-badge ido-badge--secondary');

            let item = existingItems.get(channel.id);
            if (!item) {
                item = document.createElement('div');
                item.setAttribute('data-channel-id', channel.id);
            }

            item.className = 'ido-card ido-card--hover ido-card--compact';
            if (isMissingType) {
                item.classList.add('ring-1', 'ring-amber-200');
            }

            // 清空旧内容
            while (item.firstChild) {
                item.removeChild(item.firstChild);
            }

            // 顶部行布局
            const topRow = document.createElement('div');
            topRow.className = 'ido-card__header';
            topRow.style.marginBottom = isMissingType ? 'var(--ido-spacing-xs)' : '0';

            const topLeft = document.createElement('div');
            topLeft.style.display = 'flex';
            topLeft.style.alignItems = 'center';
            topLeft.style.gap = 'var(--ido-spacing-sm)';

            const nameSpan = document.createElement('span');
            nameSpan.style.fontWeight = '500';
            nameSpan.style.color = 'var(--ido-color-text-primary)';
            nameSpan.textContent = channel.name || '';

            const badgeSpan = document.createElement('span');
            badgeSpan.className = badgeClass;
            badgeSpan.textContent = badgeLabel;

            topLeft.appendChild(nameSpan);
            topLeft.appendChild(badgeSpan);

            // 启用状态切换
            const statusWrapper = document.createElement('label');
            statusWrapper.style.display = 'flex';
            statusWrapper.style.alignItems = 'center';
            statusWrapper.style.gap = '4px';
            statusWrapper.style.cursor = isMissingType ? 'not-allowed' : 'pointer';
            statusWrapper.style.marginLeft = 'auto';
            statusWrapper.style.marginRight = 'var(--ido-spacing-sm)';
            statusWrapper.title = isMissingType
                ? '渠道类型未加载，无法启用'
                : (channel.enabled ? '点击禁用' : '点击启用');

            const toggleSwitch = document.createElement('div');
            toggleSwitch.style.position = 'relative';
            toggleSwitch.style.width = '28px';
            toggleSwitch.style.height = '16px';
            toggleSwitch.style.backgroundColor = channel.enabled ? '#10b981' : '#d1d5db';
            toggleSwitch.style.borderRadius = '8px';
            toggleSwitch.style.transition = 'background-color 0.2s';
            toggleSwitch.style.flexShrink = '0';
            toggleSwitch.style.opacity = isMissingType ? '0.5' : '1';

            const toggleKnob = document.createElement('div');
            toggleKnob.style.position = 'absolute';
            toggleKnob.style.top = '2px';
            toggleKnob.style.left = channel.enabled ? '14px' : '2px';
            toggleKnob.style.width = '12px';
            toggleKnob.style.height = '12px';
            toggleKnob.style.backgroundColor = 'white';
            toggleKnob.style.borderRadius = '50%';
            toggleKnob.style.transition = 'left 0.2s';
            toggleKnob.style.boxShadow = '0 1px 2px rgba(0,0,0,0.2)';

            toggleSwitch.appendChild(toggleKnob);

            statusWrapper.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isMissingType) {
                    alert('该渠道所属插件未加载，无法切换启用状态。请确认插件是否启用。');
                    return;
                }
                
                const currentChannels = store.state.channels || [];
                const currentChannel = currentChannels.find(c => c.id === channel.id);
                if (!currentChannel) return;
                
                const newEnabled = !currentChannel.enabled;
                
                const updatedChannels = currentChannels.map(c =>
                    c.id === channel.id ? { ...c, enabled: newEnabled } : c
                );
                store.saveChannels(updatedChannels);
                
                channel.enabled = newEnabled;
                
                toggleSwitch.style.backgroundColor = newEnabled ? '#10b981' : '#d1d5db';
                toggleKnob.style.left = newEnabled ? '14px' : '2px';
                statusWrapper.title = newEnabled ? '点击禁用' : '点击启用';
                
                if (store.events) {
                    store.events.emit('channels:updated');
                }
            };

            statusWrapper.appendChild(toggleSwitch);
            topLeft.appendChild(statusWrapper);

            const topRight = document.createElement('div');
            topRight.className = 'ido-action-group';

            const hasUiHelper = context && context.ui && typeof context.ui.createIconButton === 'function';

            const editBtn = hasUiHelper
                ? context.ui.createIconButton({
                    icon: 'edit',
                    title: isMissingType ? '渠道类型缺失，仍可编辑配置' : '编辑',
                    iconClassName: 'material-symbols-outlined text-[16px]',
                    onClick: () => {
                        if (channelEditor && channelEditor.open) {
                            channelEditor.open(channel, context, store);
                        }
                    }
                })
                : (() => {
                    const btn = document.createElement('button');
                    btn.className = 'ido-icon-btn';
                    btn.title = isMissingType ? '渠道类型缺失，仍可编辑配置' : '编辑';
                    const icon = document.createElement('span');
                    icon.className = 'material-symbols-outlined text-[16px]';
                    icon.textContent = 'edit';
                    btn.appendChild(icon);
                    btn.onclick = () => {
                        if (channelEditor && channelEditor.open) {
                            channelEditor.open(channel, context, store);
                        }
                    };
                    return btn;
                })();

            const deleteBtn = hasUiHelper
                ? context.ui.createIconButton({
                    icon: 'delete',
                    title: '删除',
                    iconClassName: 'material-symbols-outlined text-[16px]',
                    onClick: () => {
                        if (confirm(`确定要删除渠道 "${channel.name}" 吗？`)) {
                            const currentChannels = store.state.channels || [];
                            const updatedChannels = currentChannels.filter(c => c.id !== channel.id);
                            store.saveChannels(updatedChannels);
                            
                            if (store.events) {
                                store.events.emit('channels:updated');
                            }
                        }
                    }
                })
                : (() => {
                    const btn = document.createElement('button');
                    btn.className = 'ido-icon-btn';
                    btn.title = '删除';
                    const icon = document.createElement('span');
                    icon.className = 'material-symbols-outlined text-[16px]';
                    icon.textContent = 'delete';
                    btn.appendChild(icon);
                    btn.onclick = () => {
                        if (confirm(`确定要删除渠道 "${channel.name}" 吗？`)) {
                            const currentChannels = store.state.channels || [];
                            const updatedChannels = currentChannels.filter(c => c.id !== channel.id);
                            store.saveChannels(updatedChannels);
                            
                            if (store.events) {
                                store.events.emit('channels:updated');
                            }
                        }
                    };
                    return btn;
                })();

            topRight.appendChild(editBtn);
            topRight.appendChild(deleteBtn);

            topRow.appendChild(topLeft);
            topRow.appendChild(topRight);

            item.appendChild(topRow);

            if (isMissingType) {
                const warning = document.createElement('div');
                warning.className = 'mt-2 px-3 py-2 rounded border border-amber-200 bg-amber-50 text-xs text-amber-700 flex items-center gap-2';
                warning.innerHTML = '<span class="material-symbols-outlined text-[16px]">warning</span><span>插件未注册该渠道类型，消息发送将跳过该渠道。请确保相关插件已启用或重新配置。</span>';
                item.appendChild(warning);
            } else if (typeDef?.metadata?.description) {
                const description = document.createElement('div');
                description.className = 'mt-2 text-xs text-gray-500';
                description.textContent = typeDef.metadata.description;
                item.appendChild(description);
            }

            nextIds.add(channel.id);
            list.appendChild(item);
        });

        // 删除已经不存在的渠道项
        Array.from(list.children).forEach(child => {
            const id = child.getAttribute('data-channel-id');
            if (id && !nextIds.has(id)) {
                list.removeChild(child);
            }
        });
    };

})();
