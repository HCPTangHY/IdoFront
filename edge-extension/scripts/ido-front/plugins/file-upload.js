/**
 * File Upload Plugin
 * 文件上传和图片粘贴功能
 */
(function() {
    window.IdoFront = window.IdoFront || {};
    window.IdoFront.fileUpload = window.IdoFront.fileUpload || {};

    let context = null;
    let store = null;
    let attachedFiles = []; // 当前附加的文件列表

    /**
     * 初始化文件上传插件
     */
    window.IdoFront.fileUpload.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        
        // 添加上传按钮到输入区域
        addUploadButton();
        
        // 添加预览容器
        addPreviewContainer();
        
        // 监听粘贴事件
        setupPasteListener();
        
        console.log('File Upload Plugin Initialized');
    };

    /**
     * 添加上传按钮
     */
    function addUploadButton() {
        const leftActions = document.getElementById('slot-input-actions-left');
        if (!leftActions) return;

        const uploadBtn = window.IdoUI.createIconButton({
            icon: 'attach_file',
            title: '上传文件或图片',
            className: 'text-gray-600 hover:text-blue-600',
            onClick: () => {
                // 创建隐藏的文件输入
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = 'image/*,application/pdf,.txt,.doc,.docx';
                
                fileInput.onchange = (e) => {
                    const files = Array.from(e.target.files);
                    handleFiles(files);
                };
                
                fileInput.click();
            }
        });

        leftActions.appendChild(uploadBtn);
    }

    /**
     * 添加预览容器
     * 位置策略：
     *  - 不再挂在 slot-input-top 里面，避免和工具栏挤在一行
     *  - 统一插在整个 input-area 的最上方，这样无论 chat 还是生图模式都在工具栏之上独立一行
     */
    function addPreviewContainer() {
        // 已存在则不重复创建
        if (document.getElementById('file-preview-container')) return;
 
        const inputArea = document.getElementById('input-area');
        if (!inputArea) return;
 
        const previewContainer = document.createElement('div');
        previewContainer.id = 'file-preview-container';
        previewContainer.className = 'flex gap-2 flex-wrap empty:hidden mb-2';
        // 独占一整行
        previewContainer.style.width = '100%';
 
        const inputTop = document.getElementById('slot-input-top');
        if (inputTop && inputArea.contains(inputTop)) {
            // 插在工具栏所在 slot 之前
            inputArea.insertBefore(previewContainer, inputTop);
        } else {
            // 没有工具栏时，插在 input-area 的最前面
            inputArea.insertBefore(previewContainer, inputArea.firstChild);
        }
    }

    /**
     * 设置粘贴监听
     */
    function setupPasteListener() {
        const userInput = document.getElementById('user-input');
        if (!userInput) return;

        userInput.addEventListener('paste', async (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            const imageFiles = [];
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                // 检查是否为图片
                if (item.type.startsWith('image/')) {
                    e.preventDefault(); // 阻止默认粘贴行为
                    
                    const file = item.getAsFile();
                    if (file) {
                        imageFiles.push(file);
                    }
                }
            }

            if (imageFiles.length > 0) {
                handleFiles(imageFiles);
            }
        });
    }

    /**
     * 处理文件
     */
    async function handleFiles(files) {
        for (const file of files) {
            // 检查文件大小（限制为10MB）
            if (file.size > 10 * 1024 * 1024) {
                alert(`文件 ${file.name} 超过10MB限制`);
                continue;
            }

            // 读取文件为 Data URL
            const dataUrl = await readFileAsDataURL(file);
            
            // 添加到附件列表
            const fileData = {
                file: file,
                dataUrl: dataUrl,
                type: file.type,
                name: file.name,
                size: file.size
            };
            
            attachedFiles.push(fileData);
            
            // 更新预览
            updatePreview();
        }
    }

    /**
     * 读取文件为 Data URL
     */
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * 更新预览
     */
    function updatePreview() {
        const container = document.getElementById('file-preview-container');
        if (!container) return;

        container.innerHTML = '';

        attachedFiles.forEach((fileData, index) => {
            const preview = window.IdoUI.createFilePreview({
                file: fileData.file,
                dataUrl: fileData.dataUrl,
                onRemove: () => {
                    attachedFiles.splice(index, 1);
                    updatePreview();
                }
            });
            
            container.appendChild(preview);
        });
    }

    /**
     * 获取当前附加的文件
     */
    window.IdoFront.fileUpload.getAttachedFiles = function() {
        return attachedFiles;
    };

    /**
     * 清除所有附件
     */
    window.IdoFront.fileUpload.clearAttachments = function() {
        attachedFiles = [];
        updatePreview();
    };

    /**
     * 将文件转换为 Gemini 格式的 parts
     */
    window.IdoFront.fileUpload.convertToGeminiParts = async function(text) {
        const parts = [];
        
        // 添加文本部分
        if (text) {
            parts.push({ text: text });
        }
        
        // 添加图片部分
        for (const fileData of attachedFiles) {
            if (fileData.type.startsWith('image/')) {
                // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
                const base64Data = fileData.dataUrl.split(',')[1];
                
                parts.push({
                    inlineData: {
                        mimeType: fileData.type,
                        data: base64Data
                    }
                });
            }
        }
        
        return parts;
    };

})();