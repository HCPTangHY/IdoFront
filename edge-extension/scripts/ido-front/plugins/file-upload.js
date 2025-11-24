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
            let dataUrl = await readFileAsDataURL(file);
            let finalType = file.type;
            let finalName = file.name;
            
            // 如果是图片但不是标准格式，转换为PNG
            if (file.type.startsWith('image/') && !isStandardImageFormat(file.type)) {
                try {
                    console.log(`转换图片格式: ${file.name} (${file.type}) -> PNG`);
                    dataUrl = await convertImageToPNG(dataUrl, file.type);
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