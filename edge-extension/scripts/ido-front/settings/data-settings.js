/**
 * Data Settings
 * 数据管理设置页面：备份、导出、导入
 */
(function () {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.dataSettings = window.IdoFront.dataSettings || {};

    let context = null;
    let store = null;

    /**
     * 初始化数据设置模块
     */
    window.IdoFront.dataSettings.init = function (frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;

        // 注册设置标签页
        if (window.IdoFront.settingsManager && window.IdoFront.settingsManager.registerTab) {
            window.IdoFront.settingsManager.registerTab({
                id: 'data',
                icon: 'database',
                label: '数据管理',
                order: 35, // 在插件管理之后，通用设置之前
                render: render
            });
        }
    };

    /**
     * 渲染数据管理页面
     */
    function render(container, ctx, st) {
        container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-4 max-w-2xl';

        // 1. 数据统计卡片
        wrapper.appendChild(createStatsCard());

        // 2. 完整备份区域
        wrapper.appendChild(createBackupSection());

        // 3. 单对话导出区域
        wrapper.appendChild(createExportSection());

        // 4. 诊断与日志
        wrapper.appendChild(createDiagnosticsSection());

        // 5. 危险操作区域
        wrapper.appendChild(createDangerSection());

        container.appendChild(wrapper);
    }

    /**
     * 创建数据统计卡片
     */
    function createStatsCard() {
        const card = document.createElement('div');
        card.className = 'ido-card p-4';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-3';
        header.innerHTML = `
            <span class="material-symbols-outlined text-[18px] text-blue-500">analytics</span>
            <span class="font-medium text-gray-800">数据统计</span>
        `;
        card.appendChild(header);

        const statsGrid = document.createElement('div');
        statsGrid.className = 'grid grid-cols-2 sm:grid-cols-4 gap-3';
        statsGrid.id = 'data-stats-grid';
        statsGrid.innerHTML = '<div class="text-center text-gray-400 text-sm col-span-4">加载中...</div>';
        card.appendChild(statsGrid);

        // 异步加载统计
        loadStats(statsGrid);

        return card;
    }

    /**
     * 加载并显示统计数据
     */
    function loadStats(container) {
        const backup = window.IdoFront.backup;
        if (!backup || typeof backup.getBackupStats !== 'function') {
            container.innerHTML = '<div class="text-center text-red-400 text-sm col-span-4">备份模块未加载</div>';
            return;
        }

        const stats = backup.getBackupStats();
        if (!stats) {
            container.innerHTML = '<div class="text-center text-red-400 text-sm col-span-4">无法获取统计数据</div>';
            return;
        }

        container.innerHTML = '';

        const items = [
            { icon: 'chat', label: '对话', value: stats.conversationCount, color: 'blue' },
            { icon: 'forum', label: '消息', value: stats.messageCount, color: 'green' },
            { icon: 'masks', label: '面具', value: stats.personaCount, color: 'purple' },
            { icon: 'image', label: '附件', value: stats.attachmentCount, color: 'orange' }
        ];

        items.forEach(item => {
            const statItem = document.createElement('div');
            statItem.className = 'text-center p-3 bg-gray-50 rounded-lg';
            statItem.innerHTML = `
                <div class="flex items-center justify-center mb-1">
                    <span class="material-symbols-outlined text-[20px] text-${item.color}-500">${item.icon}</span>
                </div>
                <div class="text-xl font-bold text-gray-800">${item.value}</div>
                <div class="text-xs text-gray-500">${item.label}</div>
            `;
            container.appendChild(statItem);
        });
    }

    /**
     * 创建完整备份区域
     */
    function createBackupSection() {
        const section = document.createElement('div');
        section.className = 'ido-card p-4';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-2';
        header.innerHTML = `
            <span class="material-symbols-outlined text-[18px] text-green-500">backup</span>
            <span class="font-medium text-gray-800">完整备份</span>
        `;
        section.appendChild(header);

        const desc = document.createElement('p');
        desc.className = 'text-xs text-gray-500 mb-4';
        desc.textContent = '导出所有对话、面具、渠道设置和附件图片，可在其他设备上完整恢复。';
        section.appendChild(desc);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex flex-wrap gap-2';

        // 导出按钮
        const exportBtn = document.createElement('button');
        exportBtn.className = 'flex items-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors';
        exportBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">download</span>
            <span>导出备份</span>
        `;
        exportBtn.onclick = () => handleExportAll(exportBtn);
        btnGroup.appendChild(exportBtn);

        // 导入按钮
        const importBtn = document.createElement('button');
        importBtn.className = 'flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors';
        importBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">upload</span>
            <span>导入备份</span>
        `;
        importBtn.onclick = () => handleImportAll();
        btnGroup.appendChild(importBtn);

        section.appendChild(btnGroup);

        // 进度显示区域
        const progressArea = document.createElement('div');
        progressArea.id = 'backup-progress';
        progressArea.className = 'mt-3 hidden';
        section.appendChild(progressArea);

        return section;
    }

    /**
     * 创建单对话导出区域
     */
    function createExportSection() {
        const section = document.createElement('div');
        section.className = 'ido-card p-4';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-2';
        header.innerHTML = `
            <span class="material-symbols-outlined text-[18px] text-purple-500">description</span>
            <span class="font-medium text-gray-800">导出当前对话</span>
        `;
        section.appendChild(header);

        const desc = document.createElement('p');
        desc.className = 'text-xs text-gray-500 mb-4';
        desc.textContent = '将当前对话导出为 Markdown 或 JSON 格式，方便分享或存档。';
        section.appendChild(desc);

        // 当前对话信息
        const convInfo = document.createElement('div');
        convInfo.className = 'mb-3 p-2 bg-gray-50 rounded-lg text-sm';
        const activeConv = store.getActiveConversation();
        if (activeConv) {
            const msgCount = store.getActivePath(activeConv.id).length;
            convInfo.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-[16px] text-gray-400">chat</span>
                    <span class="font-medium text-gray-700 truncate flex-1">${activeConv.title || '新对话'}</span>
                    <span class="text-xs text-gray-400">${msgCount} 条消息</span>
                </div>
            `;
        } else {
            convInfo.innerHTML = '<span class="text-gray-400">无活跃对话</span>';
        }
        section.appendChild(convInfo);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex flex-wrap gap-2';

        // Markdown 导出
        const mdBtn = document.createElement('button');
        mdBtn.className = 'flex items-center gap-1.5 px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors';
        mdBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">article</span>
            <span>导出 Markdown</span>
        `;
        mdBtn.disabled = !activeConv;
        if (!activeConv) mdBtn.className += ' opacity-50 cursor-not-allowed';
        mdBtn.onclick = () => handleExportMarkdown(mdBtn);
        btnGroup.appendChild(mdBtn);

        // JSON 导出
        const jsonBtn = document.createElement('button');
        jsonBtn.className = 'flex items-center gap-1.5 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors';
        jsonBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">data_object</span>
            <span>导出 JSON</span>
        `;
        jsonBtn.disabled = !activeConv;
        if (!activeConv) jsonBtn.className += ' opacity-50 cursor-not-allowed';
        jsonBtn.onclick = () => handleExportJSON(jsonBtn);
        btnGroup.appendChild(jsonBtn);

        section.appendChild(btnGroup);

        // 选项
        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'mt-3 space-y-2';

        const includeImagesLabel = document.createElement('label');
        includeImagesLabel.className = 'flex items-center gap-2 text-sm text-gray-600 cursor-pointer';
        includeImagesLabel.innerHTML = `
            <input type="checkbox" id="export-include-images" class="rounded border-gray-300">
            <span>包含图片（文件会较大）</span>
        `;
        optionsDiv.appendChild(includeImagesLabel);

        section.appendChild(optionsDiv);

        return section;
    }

    /**
     * 创建危险操作区域
     */
    /**
     * 创建诊断与日志区域（用于崩溃前后的问题定位）
     */
    function createDiagnosticsSection() {
        const section = document.createElement('div');
        section.className = 'ido-card p-4';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-2';
        header.innerHTML = `
            <span class="material-symbols-outlined text-[18px] text-amber-500">bug_report</span>
            <span class="font-medium text-gray-800">诊断与日志</span>
        `;
        section.appendChild(header);

        const desc = document.createElement('p');
        desc.className = 'text-xs text-gray-500 mb-3';
        desc.textContent = '用于定位崩溃/数据丢失等问题。日志会尽力在后台持续保存，崩溃后可在下次启动导出。';
        section.appendChild(desc);

        const info = document.createElement('div');
        info.className = 'mb-3 p-2 bg-gray-50 rounded-lg text-sm text-gray-600';
        info.id = 'crash-log-info';
        info.textContent = '崩溃日志：加载中...';
        section.appendChild(info);

        // 加载日志数量
        (async () => {
            try {
                const logger = window.IdoFront.crashLogger;
                if (!logger || typeof logger.getLogs !== 'function') {
                    info.textContent = '崩溃日志：模块未加载（crash-logger.js）';
                    return;
                }
                const logs = await logger.getLogs();
                info.textContent = `崩溃日志：${Array.isArray(logs) ? logs.length : 0} 条（仅保留最近一段）`;
            } catch (e) {
                info.textContent = '崩溃日志：读取失败';
            }
        })();

        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex flex-wrap gap-2';

        // 导出崩溃日志
        const exportBtn = document.createElement('button');
        exportBtn.className = 'flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors';
        exportBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">download</span>
            <span>导出崩溃日志</span>
        `;
        exportBtn.onclick = async () => {
            const logger = window.IdoFront.crashLogger;
            if (!logger || typeof logger.exportLogs !== 'function') {
                alert('崩溃日志模块未加载');
                return;
            }
            await logger.exportLogs();
        };
        btnGroup.appendChild(exportBtn);

        // 清空崩溃日志
        const clearBtn = document.createElement('button');
        clearBtn.className = 'flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors';
        clearBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">delete</span>
            <span>清空崩溃日志</span>
        `;
        clearBtn.onclick = async () => {
            const logger = window.IdoFront.crashLogger;
            if (!logger || typeof logger.clearLogs !== 'function') {
                alert('崩溃日志模块未加载');
                return;
            }
            if (!confirm('确定清空崩溃日志吗？')) return;
            await logger.clearLogs();
            info.textContent = '崩溃日志：0 条';
        };
        btnGroup.appendChild(clearBtn);

        section.appendChild(btnGroup);

        return section;
    }

    function createDangerSection() {
        const section = document.createElement('div');
        section.className = 'ido-card p-4 border-red-200';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-2';
        header.innerHTML = `
            <span class="material-symbols-outlined text-[18px] text-red-500">warning</span>
            <span class="font-medium text-red-600">危险操作</span>
        `;
        section.appendChild(header);

        const desc = document.createElement('p');
        desc.className = 'text-xs text-gray-500 mb-4';
        desc.textContent = '以下操作不可逆，请谨慎使用。建议先导出备份。';
        section.appendChild(desc);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex flex-wrap gap-2';

        // 清空所有数据
        const clearBtn = document.createElement('button');
        clearBtn.className = 'flex items-center gap-1.5 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-medium transition-colors';
        clearBtn.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">delete_forever</span>
            <span>清空所有数据</span>
        `;
        clearBtn.onclick = () => handleClearAll();
        btnGroup.appendChild(clearBtn);

        section.appendChild(btnGroup);

        return section;
    }

    /**
     * 处理导出全部数据
     */
    async function handleExportAll(btn) {
        const backup = window.IdoFront.backup;
        if (!backup) {
            alert('备份模块未加载');
            return;
        }

        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
            <span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            <span>导出中...</span>
        `;

        const progressArea = document.getElementById('backup-progress');
        if (progressArea) {
            progressArea.classList.remove('hidden');
            progressArea.innerHTML = '<div class="text-sm text-gray-500">正在准备数据...</div>';
        }

        const includeAttachments = window.confirm(
            '是否在备份中包含附件（图片/PDF）？\n\n选择“确定”=完整备份（体积大，耗时长）\n选择“取消”=仅文本与配置（更快更稳，适合紧急导出）'
        );

        try {
            const stats = await backup.exportAll({
                includeAttachments,
                onProgress: (current, total, message) => {
                    if (progressArea) {
                        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
                        progressArea.innerHTML = `
                            <div class="text-sm text-gray-600">${message}</div>
                            <div class="mt-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div class="h-full bg-green-500 transition-all" style="width: ${percent}%"></div>
                            </div>
                        `;
                    }
                }
            });

            if (progressArea) {
                const downloadMethod = stats && stats._download ? stats._download.method : '';
                const needsManualSave = downloadMethod && downloadMethod !== 'anchor-download';
                progressArea.innerHTML = `
                    <div class="text-sm text-green-600 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[16px]">check_circle</span>
                        导出完成！共 ${stats.conversationCount} 个对话，${stats.attachmentCount || 0} 个附件（${includeAttachments ? '含附件' : '不含附件'}）
                    </div>
                    ${needsManualSave ? `
                    <div class="text-xs text-amber-600 mt-2">
                        当前浏览器可能不支持直接下载，已尝试在新页面打开文件。若未自动保存，请在新页面使用"分享/存储到文件"。
                    </div>
                    ` : ''}
                `;
                setTimeout(() => {
                    progressArea.classList.add('hidden');
                }, 3000);
            }
        } catch (e) {
            console.error('Export failed:', e);
            if (progressArea) {
                progressArea.innerHTML = `
                    <div class="text-sm text-red-600 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[16px]">error</span>
                        导出失败: ${e.message}
                    </div>
                `;
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    }

    /**
     * 处理导入备份
     */
    function handleImportAll() {
        const backup = window.IdoFront.backup;
        if (!backup) {
            alert('备份模块未加载');
            return;
        }

        // 创建文件选择器
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // 确认对话框
            const mode = confirm(
                '请选择导入模式：\n\n' +
                '点击「确定」= 合并模式（追加不存在的对话）\n' +
                '点击「取消」= 覆盖模式（替换所有数据）\n\n' +
                '注意：覆盖模式会清空现有数据！'
            ) ? 'merge' : 'overwrite';

            if (mode === 'overwrite') {
                if (!confirm('确定要覆盖所有现有数据吗？此操作不可逆！')) {
                    return;
                }
            }

            const progressArea = document.getElementById('backup-progress');
            if (progressArea) {
                progressArea.classList.remove('hidden');
                progressArea.innerHTML = '<div class="text-sm text-gray-500">正在导入...</div>';
            }

            try {
                const stats = await backup.importAll(file, {
                    merge: mode === 'merge',
                    onProgress: (current, total, message) => {
                        if (progressArea) {
                            progressArea.innerHTML = `
                                <div class="text-sm text-gray-600">${message}</div>
                                <div class="mt-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div class="h-full bg-blue-500 transition-all" style="width: ${current}%"></div>
                                </div>
                            `;
                        }
                    }
                });

                if (progressArea) {
                    progressArea.innerHTML = `
                        <div class="text-sm text-green-600 flex items-center gap-1">
                            <span class="material-symbols-outlined text-[16px]">check_circle</span>
                            导入完成！共 ${stats.conversationsImported} 个对话
                        </div>
                    `;
                }

                // 刷新 UI
                setTimeout(() => {
                    window.location.reload();
                }, 1500);

            } catch (e) {
                console.error('Import failed:', e);
                if (progressArea) {
                    progressArea.innerHTML = `
                        <div class="text-sm text-red-600 flex items-center gap-1">
                            <span class="material-symbols-outlined text-[16px]">error</span>
                            导入失败: ${e.message}
                        </div>
                    `;
                }
            }
        };
        input.click();
    }

    /**
     * 处理导出 Markdown
     */
    async function handleExportMarkdown(btn) {
        const backup = window.IdoFront.backup;
        if (!backup) {
            alert('备份模块未加载');
            return;
        }

        const includeImages = document.getElementById('export-include-images')?.checked || false;

        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
            <span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            <span>导出中...</span>
        `;

        try {
            await backup.exportConversationAsMarkdown(null, {
                includeMetadata: true,
                includeImages: includeImages
            });
        } catch (e) {
            console.error('Export Markdown failed:', e);
            alert('导出失败: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    }

    /**
     * 处理导出 JSON
     */
    async function handleExportJSON(btn) {
        const backup = window.IdoFront.backup;
        if (!backup) {
            alert('备份模块未加载');
            return;
        }

        const includeImages = document.getElementById('export-include-images')?.checked || false;

        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
            <span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            <span>导出中...</span>
        `;

        try {
            await backup.exportConversationAsJSON(null, {
                includeAttachments: includeImages,
                activePathOnly: true
            });
        } catch (e) {
            console.error('Export JSON failed:', e);
            alert('导出失败: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    }

    /**
     * 处理清空所有数据
     */
    async function handleClearAll() {
        const confirmText = '清空所有数据';
        const userInput = prompt(
            `此操作将删除所有对话、面具、设置和附件！\n\n` +
            `请输入「${confirmText}」以确认：`
        );

        if (userInput !== confirmText) {
            if (userInput !== null) {
                alert('输入不匹配，操作已取消');
            }
            return;
        }

        try {
            // 清空 IndexedDB
            if (window.IdoFront.idbStorage) {
                await window.IdoFront.idbStorage.clear();
            }

            // 清空 localStorage
            localStorage.removeItem('core.chat.state');

            // 清空附件数据
            if (window.IdoFront.storage && window.IdoFront.attachments) {
                await window.IdoFront.storage.clearPluginData(window.IdoFront.attachments.PLUGIN_ID);
            }

            alert('所有数据已清空，页面将刷新');
            window.location.reload();
        } catch (e) {
            console.error('Clear all failed:', e);
            alert('清空失败: ' + e.message);
        }
    }

    /**
     * 渲染方法（供外部调用）
     */
    window.IdoFront.dataSettings.render = render;

})();
