/**
 * Builtin Image Gallery - View layer
 * 负责：
 *  - 渲染主视图（Gallery 网格）
 *  - 渲染左侧队列视图
 *  - 订阅 core 状态并增量更新 UI
 *
 * 纯视图模块，不直接发请求，仅依赖：
 *  - window.IdoFront.imageGallery（由 core.js 提供）
 *  - 可选 Framework UI helper（createCustomHeader）
 */
(function () {
  window.IdoFront = window.IdoFront || {};

  var gallery = window.IdoFront.imageGallery;
  if (!gallery) {
    console.warn('[imageGallery.view] core 未初始化，视图模块将跳过');
    return;
  }

  var view = window.IdoFront.imageGalleryView = window.IdoFront.imageGalleryView || {};
  var modelSelector = window.IdoFront && window.IdoFront.modelSelector;

  function formatTime(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      return d.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function renderStatusChip(task) {
    var span = document.createElement('span');
    span.className = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px]';

    var status = task.status || 'pending';
    if (status === 'running') {
      span.className += ' bg-blue-50 text-blue-600';
      span.textContent = '运行中';
    } else if (status === 'done') {
      span.className += ' bg-green-50 text-green-600';
      span.textContent = '完成';
    } else if (status === 'error') {
      span.className += ' bg-red-50 text-red-600';
      span.textContent = '错误';
    } else {
      span.className += ' bg-gray-100 text-gray-500';
      span.textContent = '待处理';
    }
    return span;
  }

  // 用全局 marked 渲染 Markdown，与 chat 相同风格
  function renderMarkdown(target, text) {
    if (!target) return;
    var safe = typeof text === 'string' ? text : '';
    if (typeof marked === 'undefined') {
      target.textContent = safe;
      return;
    }
    try {
      target.innerHTML = marked.parse(safe);
      target.classList.add('markdown-body');
    } catch (e) {
      console.warn('[imageGallery.view] markdown 渲染失败:', e);
      target.textContent = safe;
    }
  }

  function openTaskDetail(taskId, frameworkApi) {
    if (!gallery || typeof gallery.getTaskById !== 'function') {
      console.warn('[imageGallery.view] gallery.getTaskById 不可用');
      return;
    }
    var task = gallery.getTaskById(taskId);
    if (!task) {
      console.warn('[imageGallery.view] 未找到任务', taskId);
      return;
    }
 
    var fw = frameworkApi || (typeof Framework !== 'undefined' ? Framework : null);
    if (!fw || typeof fw.showBottomSheet !== 'function') {
      console.warn('[imageGallery.view] Framework.showBottomSheet 不可用');
      return;
    }
 
    fw.showBottomSheet(function (sheet) {
      sheet.innerHTML = '';
      sheet.style.padding = '0';
 
      // 整体容器：沉浸式全屏体验
      var root = document.createElement('div');
      root.className = 'relative flex flex-col h-[92vh] bg-white overflow-hidden';
      root.style.borderRadius = '16px 16px 0 0';
 
      // 顶部浮动栏：半透明毛玻璃效果
      var topBar = document.createElement('div');
      topBar.className = 'absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4';
      topBar.style.background = 'linear-gradient(to bottom, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 70%, transparent 100%)';
      topBar.style.backdropFilter = 'blur(12px)';
      topBar.style.WebkitBackdropFilter = 'blur(12px)';
 
      var titleGroup = document.createElement('div');
      titleGroup.className = 'flex items-center gap-3';
 
      var statusChip = renderStatusChip(task);
      statusChip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
 
      titleGroup.appendChild(statusChip);
 
      var closeBtn = document.createElement('button');
      closeBtn.className = 'w-9 h-9 flex items-center justify-center rounded-full bg-gray-100/80 hover:bg-gray-200/80 transition-all duration-200';
      closeBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
      closeBtn.innerHTML = '<span class="material-symbols-outlined text-gray-700 text-[20px]">close</span>';
      closeBtn.onclick = function() {
        if (fw && typeof fw.hideBottomSheet === 'function') {
          fw.hideBottomSheet();
        }
      };
 
      topBar.appendChild(titleGroup);
      topBar.appendChild(closeBtn);
 
      // 主内容区：绝对主角，占据全部空间
      var mainContent = document.createElement('div');
      mainContent.className = 'flex-1 flex items-center justify-center overflow-auto px-6 py-20';
      mainContent.style.scrollBehavior = 'smooth';
 
      var contentWrapper = document.createElement('div');
      contentWrapper.className = 'w-full max-w-5xl mx-auto';
 
      if (task.status === 'done' && task.displayText) {
        var md = document.createElement('div');
        md.className = 'prose prose-lg max-w-none';
        md.style.fontSize = '15px';
        md.style.lineHeight = '1.75';
        md.style.color = '#1f2937';
        renderMarkdown(md, task.displayText);
        
        // 为 markdown 中的图片添加优雅样式
        setTimeout(function() {
          var images = md.querySelectorAll('img');
          images.forEach(function(img) {
            img.style.borderRadius = '12px';
            img.style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)';
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            img.style.margin = '2rem auto';
          });
        }, 50);
        
        contentWrapper.appendChild(md);
      } else if (task.status === 'error') {
        var errContainer = document.createElement('div');
        errContainer.className = 'flex flex-col items-center justify-center gap-4 py-12';
        
        var errIcon = document.createElement('div');
        errIcon.className = 'w-16 h-16 rounded-full bg-red-50 flex items-center justify-center';
        errIcon.innerHTML = '<span class="material-symbols-outlined text-red-500 text-[32px]">error</span>';
        
        var errText = document.createElement('div');
        errText.className = 'text-sm text-red-600 text-center max-w-md';
        errText.textContent = task.error || '未知错误';
        
        errContainer.appendChild(errIcon);
        errContainer.appendChild(errText);
        contentWrapper.appendChild(errContainer);
      } else {
        var placeholderContainer = document.createElement('div');
        placeholderContainer.className = 'flex flex-col items-center justify-center gap-4 py-12';
        
        var spinner = document.createElement('div');
        spinner.className = 'w-12 h-12 rounded-full border-4 border-gray-200 border-t-blue-500 animate-spin';
        
        var placeholderText = document.createElement('div');
        placeholderText.className = 'text-sm text-gray-500';
        placeholderText.textContent = task.status === 'running' ? '任务正在运行…' : '任务尚未开始执行';
        
        placeholderContainer.appendChild(spinner);
        placeholderContainer.appendChild(placeholderText);
        contentWrapper.appendChild(placeholderContainer);
      }
 
      mainContent.appendChild(contentWrapper);
 
      // 底部浮动栏：信息 + 操作
      var bottomBar = document.createElement('div');
      bottomBar.className = 'absolute bottom-0 left-0 right-0 z-10 px-6 py-4';
      bottomBar.style.background = 'linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 70%, transparent 100%)';
      bottomBar.style.backdropFilter = 'blur(12px)';
      bottomBar.style.WebkitBackdropFilter = 'blur(12px)';
 
      // Prompt 可展开区域
      var promptToggle = document.createElement('button');
      promptToggle.className = 'flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 mb-3 transition-colors group';
      
      var promptIcon = document.createElement('span');
      promptIcon.className = 'material-symbols-outlined text-[16px] transition-transform duration-200';
      promptIcon.textContent = 'expand_more';
      
      var promptLabel = document.createElement('span');
      promptLabel.textContent = 'Prompt';
      
      promptToggle.appendChild(promptIcon);
      promptToggle.appendChild(promptLabel);
 
      var promptContent = document.createElement('div');
      promptContent.className = 'hidden text-xs text-gray-700 bg-gray-50/80 rounded-xl px-4 py-3 mb-3 max-h-24 overflow-auto';
      promptContent.style.backdropFilter = 'blur(8px)';
      promptContent.style.WebkitBackdropFilter = 'blur(8px)';
      promptContent.style.border = '1px solid rgba(0,0,0,0.06)';
      promptContent.textContent = task.prompt || '(空 Prompt)';
 
      promptToggle.onclick = function() {
        var isHidden = promptContent.classList.contains('hidden');
        promptContent.classList.toggle('hidden');
        promptIcon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      };
 
      // Meta 信息行：极简设计
      var metaRow = document.createElement('div');
      metaRow.className = 'flex items-center justify-between text-[10px] text-gray-400 mb-3';
 
      var leftMeta = document.createElement('div');
      leftMeta.className = 'flex items-center gap-3';
      
      var createdTime = formatTime(task.createdAt) || '-';
      var updatedTime = formatTime(task.updatedAt) || '-';
      leftMeta.innerHTML = '<span>' + createdTime + '</span><span class="text-gray-300">·</span><span>' + updatedTime + '</span>';
 
      var rightMeta = document.createElement('div');
      rightMeta.className = 'flex items-center gap-3';
      var retries = task.meta && task.meta.retries != null ? task.meta.retries : 0;
      rightMeta.innerHTML = '<span>#' + task.id + '</span><span class="text-gray-300">·</span><span>重试 ' + retries + '</span>';
 
      metaRow.appendChild(leftMeta);
      metaRow.appendChild(rightMeta);
 
      // 操作按钮：现代化设计
      var actions = document.createElement('div');
      actions.className = 'flex items-center justify-end gap-2';
 
      if (typeof gallery.retryTask === 'function' && (task.status === 'error' || task.status === 'done')) {
        var retryBtn = document.createElement('button');
        retryBtn.className = 'px-5 py-2.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-xs font-medium rounded-xl transition-all duration-200 shadow-sm hover:shadow-md';
        retryBtn.textContent = '重试';
        retryBtn.onclick = function() {
          try {
            gallery.retryTask(task.id);
          } catch (e) {
            console.warn('[imageGallery.view] retryTask error:', e);
          }
        };
        actions.appendChild(retryBtn);
      }
 
      // 调试信息（折叠在底部）
      if (task.status === 'done' && (!task.displayText && task.result)) {
        var debugBtn = document.createElement('button');
        debugBtn.className = 'px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-xl transition-all duration-200';
        debugBtn.textContent = '调试';
        debugBtn.onclick = function() {
          var debugSheet = document.createElement('div');
          debugSheet.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
          debugSheet.onclick = function(e) {
            if (e.target === debugSheet) debugSheet.remove();
          };
          
          var debugContent = document.createElement('div');
          debugContent.className = 'bg-white rounded-2xl p-6 max-w-2xl max-h-[80vh] overflow-auto';
          
          var debugTitle = document.createElement('div');
          debugTitle.className = 'text-sm font-semibold mb-3';
          debugTitle.textContent = '调试信息';
          
          var debugPre = document.createElement('pre');
          debugPre.className = 'text-xs text-gray-700 whitespace-pre-wrap break-all bg-gray-50 rounded-lg p-4';
          try {
            debugPre.textContent = JSON.stringify(task.result, null, 2);
          } catch (e) {
            debugPre.textContent = String(task.result);
          }
          
          debugContent.appendChild(debugTitle);
          debugContent.appendChild(debugPre);
          debugSheet.appendChild(debugContent);
          document.body.appendChild(debugSheet);
        };
        actions.appendChild(debugBtn);
      }
 
      bottomBar.appendChild(promptToggle);
      bottomBar.appendChild(promptContent);
      bottomBar.appendChild(metaRow);
      bottomBar.appendChild(actions);
 
      root.appendChild(topBar);
      root.appendChild(mainContent);
      root.appendChild(bottomBar);
 
      sheet.appendChild(root);
    });
  }

  function renderSidebarTaskList(listEl, tasks) {
    listEl.innerHTML = '';

    if (!tasks || !tasks.length) {
      var empty = document.createElement('div');
      empty.className = 'text-[11px] text-gray-400 px-2 py-1';
      empty.textContent = '暂无生图任务';
      listEl.appendChild(empty);
      return;
    }

    tasks.forEach(function (task) {
      var row = document.createElement('div');
      row.className = 'px-2 py-1 rounded hover:bg-gray-100 cursor-pointer flex flex-col gap-0.5';

      var titleLine = document.createElement('div');
      titleLine.className = 'flex items-center justify-between gap-2';

      var promptSpan = document.createElement('div');
      promptSpan.className = 'text-[11px] text-gray-800 truncate max-w-full';
      promptSpan.textContent = task.prompt || '(空 Prompt)';

      var statusChip = renderStatusChip(task);

      titleLine.appendChild(promptSpan);
      titleLine.appendChild(statusChip);

      var metaLine = document.createElement('div');
      metaLine.className = 'flex items-center justify-between gap-2 text-[10px] text-gray-400';

      var idSpan = document.createElement('span');
      idSpan.textContent = '#' + task.id;

      var timeSpan = document.createElement('span');
      timeSpan.textContent = formatTime(task.createdAt);

      metaLine.appendChild(idSpan);
      metaLine.appendChild(timeSpan);

      row.appendChild(titleLine);
      row.appendChild(metaLine);
      row.dataset.taskId = task.id;
      row.onclick = function () {
        openTaskDetail(task.id);
      };
      listEl.appendChild(row);
    });
  }

  function renderSidebar(container) {
    container.innerHTML = '';

    var wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col h-full';

    var header = document.createElement('div');
    header.className = 'h-10 px-3 flex items-center justify-between border-b border-gray-200';
    
    var headerTitle = document.createElement('div');
    headerTitle.className = 'text-xs font-semibold text-gray-700';
    headerTitle.textContent = '画廊保存';
    
    var saveBtn = document.createElement('button');
    saveBtn.className = 'ido-icon-btn';
    saveBtn.title = '保存当前画廊';
    saveBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">save</span>';
    saveBtn.onclick = async function() {
      var currentState = gallery.getState();
      if (!currentState || !currentState.tasks || currentState.tasks.length === 0) {
        alert('当前画廊为空，无需保存');
        return;
      }
      
      var name = prompt('请输入画廊名称：', '画廊 ' + new Date().toLocaleString('zh-CN'));
      if (!name) return;
      
      // 深拷贝当前任务快照，避免后续状态修改影响已保存画廊
      var snapshotTasks = currentState.tasks.map(function(t) {
        return Object.assign({}, t);
      });
      
      var storageFacade = window.IdoFront && window.IdoFront.storage;
      if (!storageFacade) {
        alert('存储服务不可用');
        return;
      }
      
      try {
        // 使用插件存储API保存画廊
        var galleryId = 'image-gallery.saved.' + Date.now();
        await storageFacade.savePlugin({
          id: galleryId,
          enabled: true,
          updatedAt: Date.now(),
          data: {
            name: name,
            tasks: snapshotTasks,
            savedAt: Date.now()
          }
        });
        
        // 重新渲染侧边栏
        renderSidebar(container);
      } catch (e) {
        alert('保存失败：' + e.message);
      }
    };
    
    header.appendChild(headerTitle);
    header.appendChild(saveBtn);

    var body = document.createElement('div');
    body.className = 'flex-1 overflow-y-auto px-3 py-2';

    // 加载已保存的画廊列表
    var storageFacade = window.IdoFront && window.IdoFront.storage;
    
    if (!storageFacade) {
      var error = document.createElement('div');
      error.className = 'text-[11px] text-red-500 text-center py-4';
      error.textContent = '存储服务不可用';
      body.appendChild(error);
    } else {
      storageFacade.getAllPlugins().then(function(allPlugins) {
        // 筛选出画廊数据（ID以'image-gallery.saved.'开头）
        var galleries = allPlugins.filter(function(p) {
          return p.id && p.id.startsWith('image-gallery.saved.');
        }).map(function(p) {
          return {
            id: p.id,
            name: p.data && p.data.name || '未命名画廊',
            tasks: p.data && p.data.tasks || [],
            savedAt: p.data && p.data.savedAt || p.updatedAt
          };
        }).sort(function(a, b) {
          return b.savedAt - a.savedAt;
        });
        
        if (galleries.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'text-[11px] text-gray-400 text-center py-4';
          empty.textContent = '暂无保存的画廊';
          body.appendChild(empty);
        } else {
          galleries.forEach(function(item) {
            var card = document.createElement('div');
            card.className = 'mb-2 p-2 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors';
            
            var cardHeader = document.createElement('div');
            cardHeader.className = 'flex items-center justify-between mb-1';
            
            var cardTitle = document.createElement('div');
            cardTitle.className = 'text-[11px] font-medium text-gray-800 truncate flex-1';
            cardTitle.textContent = item.name;
            
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'text-gray-400 hover:text-red-500 transition-colors';
            deleteBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete</span>';
            deleteBtn.title = '删除此画廊';
            deleteBtn.onclick = function(e) {
              e.stopPropagation();
              if (!confirm('确定要删除画廊"' + item.name + '"吗？')) return;
              
              storageFacade.deletePlugin(item.id).then(function() {
                renderSidebar(container);
              }).catch(function(e) {
                alert('删除失败：' + e.message);
              });
            };
            
            cardHeader.appendChild(cardTitle);
            cardHeader.appendChild(deleteBtn);
            
            var cardMeta = document.createElement('div');
            cardMeta.className = 'text-[10px] text-gray-400';
            var taskCount = item.tasks ? item.tasks.length : 0;
            var savedTime = new Date(item.savedAt).toLocaleString('zh-CN');
            cardMeta.textContent = taskCount + ' 个任务 · ' + savedTime;
            
            card.appendChild(cardHeader);
            card.appendChild(cardMeta);
            
            card.onclick = function() {
              if (!confirm('加载画廊"' + item.name + '"？当前画廊将被替换。')) return;
              
              try {
                if (gallery && typeof gallery.replaceTasks === 'function') {
                  gallery.replaceTasks(item.tasks || []);
                } else if (gallery && typeof gallery.clearAllTasks === 'function') {
                  gallery.clearAllTasks();
                } else {
                  alert('当前画廊模块不支持加载操作');
                }
              } catch (e) {
                alert('加载失败：' + e.message);
              }
            };
            
            body.appendChild(card);
          });
        }
      }).catch(function(e) {
        var error = document.createElement('div');
        error.className = 'text-[11px] text-red-500 text-center py-4';
        error.textContent = '加载失败：' + e.message;
        body.appendChild(error);
      });
    }

    // 底部设置按钮
    var footer = document.createElement('div');
    footer.className = 'px-3 py-2 border-t border-gray-100';

    var settingsBtn = document.createElement('button');
    settingsBtn.className =
      'w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors';
    settingsBtn.title = '打开设置';

    var iconSpan = document.createElement('span');
    iconSpan.className = 'material-symbols-outlined text-[18px]';
    iconSpan.textContent = 'settings';

    var labelSpan = document.createElement('span');
    labelSpan.textContent = '设置';

    settingsBtn.appendChild(iconSpan);
    settingsBtn.appendChild(labelSpan);

    settingsBtn.onclick = function () {
      var mgr = window.IdoFront && window.IdoFront.settingsManager;
      if (mgr && typeof mgr.toggleSettingsMode === 'function') {
        mgr.toggleSettingsMode();
      } else if (mgr && typeof mgr.openTab === 'function') {
        mgr.openTab('channels');
      } else {
        console.warn('[imageGallery.view] settingsManager 不可用，无法打开设置');
      }
    };

    footer.appendChild(settingsBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    wrapper.appendChild(footer);
    container.appendChild(wrapper);

    if (container.__gallerySidebarUnsub) {
      try {
        container.__gallerySidebarUnsub();
      } catch (e) {}
      container.__gallerySidebarUnsub = null;
    }
  }
  
   // 新增：渲染参数设置 Bottom Sheet
  function showParametersSheet(frameworkApi) {
    var fw = frameworkApi || (typeof Framework !== 'undefined' ? Framework : null);
    if (!fw || typeof fw.showBottomSheet !== 'function') {
      console.warn('[imageGallery.view] Framework.showBottomSheet 不可用');
      return;
    }
  
    var galleryApi = gallery || (window.IdoFront && window.IdoFront.imageGallery);
    var initialSettings = galleryApi && typeof galleryApi.getSettings === 'function'
      ? galleryApi.getSettings() || {}
      : { systemPrompt: '', params: [] };
  
    var advancedParams = Array.isArray(initialSettings.params)
      ? initialSettings.params.map(function(p) {
          return {
            key: p && typeof p.key === 'string' ? p.key : '',
            value: p && typeof p.value === 'string' ? p.value : ''
          };
        })
      : [];
  
    fw.showBottomSheet(function(sheet) {
      sheet.innerHTML = '';
  
      var root = document.createElement('div');
      root.className = 'flex flex-col max-h-[70vh] p-4';
  
      // Header
      var header = document.createElement('div');
      header.className = 'flex items-center justify-between mb-4';
  
      var title = document.createElement('div');
      title.className = 'text-sm font-semibold text-gray-900';
      title.textContent = '生图参数设置';
  
      var closeBtn = document.createElement('button');
      closeBtn.className = 'ido-icon-btn';
      closeBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">close</span>';
      closeBtn.onclick = function() {
        if (fw && typeof fw.hideBottomSheet === 'function') {
          fw.hideBottomSheet();
        }
      };
  
      header.appendChild(title);
      header.appendChild(closeBtn);
  
      // Body
      var body = document.createElement('div');
      body.className = 'flex-1 overflow-y-auto space-y-4';
  
      // 系统提示词（作为 system role 注入，适配各渠道的系统提示语语义）
      var sysGroup = document.createElement('div');
  
      var sysLabel = document.createElement('label');
      sysLabel.className = 'block text-xs font-medium text-gray-700 mb-1';
      sysLabel.textContent = '系统提示词';
  
      var sysHint = document.createElement('div');
      sysHint.className = 'text-[10px] text-gray-500 mb-1';
      sysHint.textContent = '将作为 system 消息发送，适配 OpenAI / Gemini 等渠道各自的系统提示词语义。';
  
      var sysTextarea = document.createElement('textarea');
      sysTextarea.className =
        'w-full min-h-[100px] text-xs border border-gray-300 rounded-lg px-3 py-2 resize-none ' +
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
      sysTextarea.placeholder = '例如：你是一名图像生成助手，擅长输出高质量、统一风格的图片描述…';
      sysTextarea.value = initialSettings.systemPrompt || '';
  
      sysGroup.appendChild(sysLabel);
      sysGroup.appendChild(sysHint);
      sysGroup.appendChild(sysTextarea);
  
      // 高级参数：key 对应请求体 JSON 字段，value 是 JSON 值
      var advGroup = document.createElement('div');
  
      var advHeader = document.createElement('div');
      advHeader.className = 'flex items-center justify-between mb-2';
  
      var advLabel = document.createElement('div');
      advLabel.className = 'text-xs font-medium text-gray-700';
      advLabel.textContent = '高级参数（JSON）';
  
      var addParamBtn = document.createElement('button');
      addParamBtn.className = 'text-[11px] text-blue-600 hover:text-blue-700 flex items-center gap-1';
      addParamBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">add</span> 新增参数';
  
      advHeader.appendChild(advLabel);
      advHeader.appendChild(addParamBtn);
  
      var advHint = document.createElement('div');
      advHint.className = 'text-[10px] text-gray-500 bg-gray-50 rounded-lg p-2 mb-2';
      advHint.textContent =
        '用于覆盖请求体中的模型参数。例如：temperature、max_tokens、size、style 等。' +
        'Key 为 JSON 字段名（如 "temperature"），Value 为合法 JSON（如 0.7、"square"、[256,256]、{"style":"anime"}）。';
  
      var paramsTable = document.createElement('div');
      paramsTable.className = 'border border-gray-200 rounded-lg overflow-hidden bg-white';
  
      function renderParamsTable() {
        paramsTable.innerHTML = '';
  
        if (!advancedParams.length) {
          var emptyHint = document.createElement('div');
          emptyHint.className = 'p-3 text-[11px] text-gray-400 text-center';
          emptyHint.textContent = '暂无高级参数，点击右上角「新增参数」开始配置。';
          paramsTable.appendChild(emptyHint);
          return;
        }
  
        var table = document.createElement('table');
        table.className = 'w-full text-[11px]';
  
        var thead = document.createElement('thead');
        thead.className = 'bg-gray-50 border-b border-gray-200';
        thead.innerHTML =
          '<tr>' +
          '<th class="p-2 text-left font-medium text-gray-600 w-1/4">Key</th>' +
          '<th class="p-2 text-left font-medium text-gray-600">Value（JSON）</th>' +
          '<th class="p-2 text-center font-medium text-gray-600 w-14">操作</th>' +
          '</tr>';
  
        var tbody = document.createElement('tbody');
  
        advancedParams.forEach(function(param, index) {
          var tr = document.createElement('tr');
          tr.className = 'border-b border-gray-100 last:border-b-0 align-top';
  
          var keyTd = document.createElement('td');
          keyTd.className = 'p-2';
          var keyInput = document.createElement('input');
          keyInput.type = 'text';
          keyInput.className =
            'w-full px-2 py-1 border border-gray-300 rounded text-[11px] ' +
            'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
          keyInput.placeholder = '如: temperature';
          keyInput.value = param.key || '';
          keyInput.oninput = function(e) {
            advancedParams[index].key = e.target.value;
          };
          keyTd.appendChild(keyInput);
  
          var valueTd = document.createElement('td');
          valueTd.className = 'p-2';
          var valueInput = document.createElement('textarea');
          valueInput.className =
            'w-full min-h-[40px] px-2 py-1 border border-gray-300 rounded text-[11px] font-mono ' +
            'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y';
          valueInput.placeholder = '合法 JSON 值，如: 0.7 / "hd" / [256,256] / {"style":"anime"}';
          valueInput.value = param.value || '';
          valueInput.oninput = function(e) {
            advancedParams[index].value = e.target.value;
          };
          valueTd.appendChild(valueInput);
  
          var actionTd = document.createElement('td');
          actionTd.className = 'p-2 text-center align-middle';
          var delBtn = document.createElement('button');
          delBtn.className = 'text-red-500 hover:text-red-600';
          delBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete</span>';
          delBtn.onclick = function() {
            advancedParams.splice(index, 1);
            renderParamsTable();
          };
          actionTd.appendChild(delBtn);
  
          tr.appendChild(keyTd);
          tr.appendChild(valueTd);
          tr.appendChild(actionTd);
          tbody.appendChild(tr);
        });
  
        table.appendChild(thead);
        table.appendChild(tbody);
        paramsTable.appendChild(table);
      }
  
      addParamBtn.onclick = function() {
        advancedParams.push({ key: '', value: '' });
        renderParamsTable();
      };
  
      advGroup.appendChild(advHeader);
      advGroup.appendChild(advHint);
      advGroup.appendChild(paramsTable);
  
      // 初始渲染高级参数表
      renderParamsTable();
  
      body.appendChild(sysGroup);
      body.appendChild(advGroup);
  
      // Footer
      var footer = document.createElement('div');
      footer.className = 'flex items-center justify-end gap-2 mt-4 pt-4 border-t border-gray-200';
  
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'ido-btn ido-btn--ghost text-xs px-4 py-2';
      cancelBtn.textContent = '取消';
      cancelBtn.onclick = function() {
        if (fw && typeof fw.hideBottomSheet === 'function') {
          fw.hideBottomSheet();
        }
      };
  
      var saveBtn = document.createElement('button');
      saveBtn.className = 'ido-btn ido-btn--primary text-xs px-4 py-2';
      saveBtn.textContent = '保存';
      saveBtn.onclick = function() {
        var sysText = (sysTextarea.value || '').trim();
  
        // 清洗并校验高级参数
        var cleaned = [];
        for (var i = 0; i < advancedParams.length; i += 1) {
          var item = advancedParams[i];
          if (!item) continue;
  
          var key = (item.key || '').trim();
          var rawValue = (item.value || '').trim();
  
          if (!key) {
            // 空 key 直接忽略该行
            continue;
          }
          if (!rawValue) {
            alert('高级参数 "' + key + '" 的值不能为空');
            return;
          }
  
          try {
            // 验证是否为合法 JSON
            JSON.parse(rawValue);
          } catch (e) {
            alert('高级参数 "' + key + '" 的值不是合法 JSON：' + e.message);
            return;
          }
  
          cleaned.push({
            key: key,
            value: rawValue
          });
        }
  
        var nextSettings = {
          systemPrompt: sysText,
          params: cleaned
        };
  
        if (galleryApi && typeof galleryApi.setSettings === 'function') {
          try {
            galleryApi.setSettings(nextSettings);
          } catch (e) {
            console.warn('[imageGallery.view] 保存参数到 core 失败:', e);
          }
        }
  
        if (fw && typeof fw.hideBottomSheet === 'function') {
          fw.hideBottomSheet();
        }
      };
  
      footer.appendChild(cancelBtn);
      footer.appendChild(saveBtn);
  
      root.appendChild(header);
      root.appendChild(body);
      root.appendChild(footer);
  
      sheet.appendChild(root);
    });
  }
  
  view.showParametersSheet = showParametersSheet;

  function renderMainGrid(gridEl, tasks, frameworkApi) {
    gridEl.innerHTML = '';

    if (!tasks || !tasks.length) {
      var emptyWrapper = document.createElement('div');
      emptyWrapper.className = 'flex flex-col items-center justify-center text-gray-400 text-xs h-full';

      var line1 = document.createElement('div');
      line1.textContent = '暂无生图结果';

      var line2 = document.createElement('div');
      line2.textContent = '在下方输入 Prompt，切换到「生图视图」后点击生成即可开始。';

      emptyWrapper.appendChild(line1);
      emptyWrapper.appendChild(line2);
      gridEl.appendChild(emptyWrapper);
      return;
    }

    tasks.forEach(function (task) {
      var card = document.createElement('div');
      card.className = 'border border-gray-200 rounded-md p-2 bg-gray-50 flex flex-col gap-1 text-xs';

      var headerRow = document.createElement('div');
      headerRow.className = 'flex items-center justify-between gap-2';

      var promptDiv = document.createElement('div');
      promptDiv.className = 'font-medium text-gray-800 text-[11px] line-clamp-2';
      promptDiv.style.display = '-webkit-box';
      promptDiv.style.webkitBoxOrient = 'vertical';
      promptDiv.style.webkitLineClamp = '2';
      promptDiv.style.overflow = 'hidden';
      promptDiv.textContent = task.prompt || '(空 Prompt)';

      var statusChip = renderStatusChip(task);

      headerRow.appendChild(promptDiv);
      headerRow.appendChild(statusChip);

      var metaRow = document.createElement('div');
      metaRow.className = 'flex items-center justify-between text-[10px] text-gray-400';

      var idSpan = document.createElement('span');
      idSpan.textContent = '#' + task.id;

      var timeSpan = document.createElement('span');
      timeSpan.textContent = formatTime(task.createdAt);

      metaRow.appendChild(idSpan);
      metaRow.appendChild(timeSpan);

      var previewArea = document.createElement('div');
      previewArea.className = 'mt-1';

      if (task.status === 'done') {
        var text = task.displayText || '';
        var mdPreview = document.createElement('div');
        mdPreview.className = 'text-[11px] text-gray-700 max-h-32 overflow-hidden';
        if (text) {
          renderMarkdown(mdPreview, text);
        } else {
          mdPreview.textContent = '[无内容]';
        }
        previewArea.appendChild(mdPreview);
      } else if (task.status === 'error') {
        var err = document.createElement('div');
        err.className = 'text-[10px] text-red-500';
        err.textContent = task.error || '未知错误';
        previewArea.appendChild(err);
      } else {
        var placeholder = document.createElement('div');
        placeholder.className = 'text-[10px] text-gray-400';
        placeholder.textContent = '等待生成或进行中…';
        previewArea.appendChild(placeholder);
      }

      card.appendChild(headerRow);
      card.appendChild(metaRow);
      card.appendChild(previewArea);
      card.dataset.taskId = task.id;
      card.onclick = function () {
        openTaskDetail(task.id, frameworkApi);
      };

      gridEl.appendChild(card);
    });
  }

  function renderMain(container, frameworkApi) {
    container.innerHTML = '';

    var ui = frameworkApi && frameworkApi.ui ? frameworkApi.ui : (window.Framework && window.Framework.ui ? window.Framework.ui : null);

    // 保存 subtitle 引用
    var subtitleElement = null;
    
    // 更新 subtitle 文本的函数
    function updateSubtitle() {
      // 优先使用保存的引用，如果没有则尝试查找（用于事件处理）
      var element = subtitleElement || container.querySelector('[data-gallery-subtitle]');
      if (!element) return;
      
      if (typeof gallery.getActiveChannelConfig === 'function') {
        var cfg = gallery.getActiveChannelConfig();
        if (cfg) {
          var label = (cfg.name || cfg.type || '渠道') + ' / ' + (cfg.model || '模型');
          element.textContent = label;
        } else {
          element.textContent = '未选择渠道 / 模型';
        }
      }
    }

    var header;
    if (ui && typeof ui.createCustomHeader === 'function') {
      header = ui.createCustomHeader({
        center: function () {
          var wrap = document.createElement('div');
          wrap.className = 'flex flex-col min-w-0 max-w-full';

          var title = document.createElement('div');
          title.className = 'font-medium text-gray-700 truncate';
          title.textContent = '生图视图';

          subtitleElement = document.createElement('div');
          subtitleElement.className = 'text-[10px] text-gray-400 truncate';
          subtitleElement.setAttribute('data-gallery-subtitle', 'true');
          
          // 初始化 subtitle
          updateSubtitle();

          wrap.appendChild(title);
          wrap.appendChild(subtitleElement);
          return wrap;
        },
        right: function () {
          var rightRoot = document.createElement('div');
          rightRoot.className = 'flex items-center gap-1';
          
          // 清空列表按钮
          var clearBtn = document.createElement('button');
          clearBtn.className = 'ido-icon-btn';
          clearBtn.title = '清空生图列表';
          clearBtn.innerHTML = '<span class="material-symbols-outlined text-[20px]">delete_sweep</span>';
          clearBtn.onclick = function() {
            if (!gallery || typeof gallery.clearAllTasks !== 'function') return;
            
            // 确认对话框
            var currentState = gallery.getState();
            if (currentState && currentState.tasks && currentState.tasks.length > 0) {
              var confirmed = confirm('确定要清空所有生图任务吗？此操作不可撤销。');
              if (!confirmed) return;
            }
            
            gallery.clearAllTasks();
          };
          rightRoot.appendChild(clearBtn);
          
          return rightRoot;
        }
      });
    } else {
      header = document.createElement('div');
      header.className = 'h-10 px-3 flex items-center border-b border-gray-200 text-xs font-semibold text-gray-700';
      header.textContent = '生图视图';
    }

    var body = document.createElement('div');
    body.className = 'flex-1 overflow-y-auto px-3 py-2 min-h-0';

    var tip = document.createElement('div');
    tip.className = 'text-[11px] text-gray-500 mb-2';
    tip.textContent = '提示：在下方输入 Prompt 后，使用工具条中的生成按钮创建生图任务。';

    var grid = document.createElement('div');
    grid.className = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3 auto-rows-auto';

    body.appendChild(tip);
    body.appendChild(grid);

    var root = document.createElement('div');
    root.className = 'flex-1 flex flex-col bg-white min-h-0';
    root.appendChild(header);
    root.appendChild(body);

    container.appendChild(root);

    // 清理之前的订阅
    if (container.__galleryMainUnsub) {
      try {
        container.__galleryMainUnsub();
      } catch (e) {}
      container.__galleryMainUnsub = null;
    }
    
    if (container.__galleryModelUnsub) {
      try {
        container.__galleryModelUnsub();
      } catch (e) {}
      container.__galleryModelUnsub = null;
    }

    var initialState = typeof gallery.getState === 'function' ? gallery.getState() : { tasks: [] };
    renderMainGrid(grid, initialState.tasks || [], frameworkApi);

    // 订阅任务状态变化
    if (typeof gallery.subscribe === 'function') {
      var unsub = gallery.subscribe(function (nextState) {
        renderMainGrid(grid, nextState.tasks || [], frameworkApi);
      });
      container.__galleryMainUnsub = unsub;
    }
    
    // 订阅模型切换事件以更新 header subtitle
    var runtime = window.IdoFront && window.IdoFront.runtime;
    if (runtime && runtime.store && typeof runtime.store.subscribe === 'function') {
      var modelUpdateHandler = function() {
        updateSubtitle();
      };
      var modelUnsub = runtime.store.subscribe('updated', modelUpdateHandler);
      container.__galleryModelUnsub = modelUnsub;
    }
  }

  view.renderSidebar = renderSidebar;
  view.renderMain = renderMain;
})();