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
    const SUPPORTED_ATTACHMENT_ACCEPT = [
        'image/*',
        'audio/*',
        '.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.opus,.weba,.webm',
        'application/pdf',
        '.pdf',
        'text/*',
        'application/json',
        'application/xml',
        'application/javascript',
        'application/x-javascript',
        'application/typescript',
        'application/x-typescript',
        'application/x-yaml',
        'application/yaml',
        '.txt,.md,.markdown,.json,.xml,.html,.htm,.csv,.tsv,.log,.yaml,.yml,.toml,.ini,.cfg,.conf,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.bat,.ps1'
    ].join(',');

    window.IdoFront.fileUpload.getAcceptedFileTypes = function() {
        return SUPPORTED_ATTACHMENT_ACCEPT;
    };

    /**
     * 初始化文件上传插件
     */
    window.IdoFront.fileUpload.init = function(frameworkInstance, storeInstance) {
        context = frameworkInstance;
        store = storeInstance;
        
        // 使用插件系统注册上传按钮
        registerUploadButton();
        
        // 添加预览容器
        addPreviewContainer();
        
        // 监听粘贴事件
        setupPasteListener();
        
        console.log('File Upload Plugin Initialized');
    };

    /**
     * 注册上传按钮到插件系统
     */
    function registerUploadButton() {
        if (!context || !context.registerUIComponent) {
            // 回退到直接添加
            addUploadButtonDirect();
            return;
        }
        
        // 使用插件系统注册按钮，避免被 refreshSlot 清除
        context.registerUIComponent(context.SLOTS.INPUT_ACTIONS_LEFT, 'core-file-upload', () => {
            return createUploadButton();
        });
    }
    
    /**
     * 创建上传按钮元素
     */
    function createUploadButton() {
        const uploadBtn = window.IdoUI.createIconButton({
            icon: 'attach_file',
            title: '上传文件或图片',
            className: 'text-gray-600 hover:text-blue-600',
            onClick: () => {
                // 创建隐藏的文件输入
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = SUPPORTED_ATTACHMENT_ACCEPT;
                
                fileInput.onchange = (e) => {
                    const files = Array.from(e.target.files);
                    handleFiles(files);
                };
                
                fileInput.click();
            }
        });
        return uploadBtn;
    }
    
    /**
     * 直接添加上传按钮（回退方案）
     */
    function addUploadButtonDirect() {
        const leftActions = document.getElementById('slot-input-actions-left');
        if (!leftActions) return;
        leftActions.appendChild(createUploadButton());
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
            const clipboardData = e.clipboardData;
            if (!clipboardData) return;

            // 1. 处理超长文本粘贴 (阈值 12KB)
            const text = clipboardData.getData('text/plain');
            const TEXT_FILE_THRESHOLD = 12 * 1024;

            if (text && text.length >= TEXT_FILE_THRESHOLD) {
                e.preventDefault();
                const blob = new Blob([text], { type: 'text/plain' });
                const file = new File([blob], `pasted-text-${Date.now().toString(36)}.txt`, { type: 'text/plain' });
                
                // 提示用户已转为附件
                if (window.Framework && typeof window.Framework.toast === 'function') {
                    window.Framework.toast('粘贴文本过长，已自动转换为附件', 'info');
                }
                
                handleFiles([file]);
                return;
            }

            // 2. 处理图片粘贴
            const items = clipboardData.items;
            const files = [];
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }

            if (files.length > 0) {
                handleFiles(files);
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
            let dataUrl = await readFileAsDataURL(file);
            let finalType = resolveFileMimeType(file, dataUrl);
            let finalName = file.name;
            
            // 如果是图片但不是标准格式，转换为PNG
            if (finalType.startsWith('image/') && !isStandardImageFormat(finalType)) {
                try {
                    console.log(`转换图片格式: ${file.name} (${finalType}) -> PNG`);
                    dataUrl = await convertImageToPNG(dataUrl, finalType);
                    finalType = 'image/png';
                    finalName = file.name.replace(/\.[^.]+$/, '.png');
                } catch (error) {
                    console.error('图片格式转换失败:', error);
                    alert(`图片 ${file.name} 格式转换失败，将使用原格式`);
                }
            }
            
            // 添加到附件列表
            const fileData = {
                file: file,
                dataUrl: dataUrl,
                type: finalType,
                name: finalName,
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

    function inferMimeTypeFromName(name) {
        const lowerName = typeof name === 'string' ? name.trim().toLowerCase() : '';
        if (!lowerName) return '';
        if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
        if (lowerName.endsWith('.wav')) return 'audio/wav';
        if (lowerName.endsWith('.m4a')) return 'audio/mp4';
        if (lowerName.endsWith('.aac')) return 'audio/aac';
        if (lowerName.endsWith('.ogg') || lowerName.endsWith('.oga')) return 'audio/ogg';
        if (lowerName.endsWith('.flac')) return 'audio/flac';
        if (lowerName.endsWith('.opus')) return 'audio/opus';
        if (lowerName.endsWith('.weba')) return 'audio/webm';
        if (lowerName.endsWith('.webm')) return 'audio/webm';
        return '';
    }

    function resolveFileMimeType(file, dataUrl) {
        if (file && typeof file.type === 'string' && file.type.trim()) {
            return file.type.trim();
        }
        if (typeof dataUrl === 'string') {
            const match = /^data:([^;]+);base64,/i.exec(dataUrl);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        return inferMimeTypeFromName(file && file.name);
    }

    /**
     * 检查是否为标准图片格式（PNG/JPG/JPEG）
     */
    function isStandardImageFormat(mimeType) {
        const standardFormats = ['image/png', 'image/jpeg', 'image/jpg'];
        return standardFormats.includes(mimeType.toLowerCase());
    }

    /**
     * 将图片转换为PNG格式，并进行尺寸优化
     */
    function convertImageToPNG(dataUrl, originalType) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            img.onload = () => {
                try {
                    let width = img.width;
                    let height = img.height;
                    
                    // 限制最大尺寸为2048px，避免超大图片影响性能
                    const MAX_SIZE = 2048;
                    if (width > MAX_SIZE || height > MAX_SIZE) {
                        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
                        width = Math.floor(width * ratio);
                        height = Math.floor(height * ratio);
                        console.log(`图片尺寸优化: ${img.width}x${img.height} -> ${width}x${height}`);
                    }
                    
                    // 创建canvas
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    
                    // 绘制图片（如果尺寸改变，会自动缩放）
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // 转换为PNG格式的Data URL
                    const pngDataUrl = canvas.toDataURL('image/png');
                    resolve(pngDataUrl);
                } catch (error) {
                    reject(error);
                }
            };
            
            img.onerror = () => {
                reject(new Error('图片加载失败'));
            };
            
            img.src = dataUrl;
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