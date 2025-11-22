const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置
const EXTENSION_DIR = 'edge-extension';
const DIST_DIR = 'dist';
const MANIFEST_PATH = path.join(EXTENSION_DIR, 'manifest.json');

// 1. 检查插件目录是否存在
if (!fs.existsSync(EXTENSION_DIR)) {
    console.error(`错误: 找不到插件目录 "${EXTENSION_DIR}"`);
    process.exit(1);
}

// 2. 读取 Manifest 获取版本号
let version = 'unknown';
try {
    const manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(manifestContent);
    version = manifest.version || 'unknown';
    console.log(`📦 正在打包 IdoFront 扩展 (v${version})...`);
} catch (e) {
    console.warn('警告: 无法读取 manifest.json，将使用默认版本号。');
}

// 3. 创建输出目录
if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR);
}

// 4. 打包文件名
const zipFileName = `IdoFront-v${version}.zip`;
const zipFilePath = path.join(DIST_DIR, zipFileName);

// 5. 执行打包命令 (使用 Windows PowerShell Compress-Archive)
// 注意：Compress-Archive 默认在 Windows 10/11 上可用
try {
    // 删除旧文件以免冲突
    if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
    }

    // 使用 path.join 可能会导致反斜杠转义问题在 powershell 命令中，这里直接构建适合 Windows 的命令
    // Compress-Archive 需要明确的路径
    const command = `powershell -Command "Compress-Archive -Path '${EXTENSION_DIR}\\*' -DestinationPath '${zipFilePath}' -Force"`;
    
    console.log(`正在执行打包命令...`);
    execSync(command, { stdio: 'inherit' });
    
    console.log(`\n✅ 打包成功!`);
    console.log(`📁 文件位置: ${zipFilePath}`);
    console.log(`\n🚀 发布指南 (Manifest V3):`);
    console.log(`生成的文件完全兼容 Chrome 和 Edge 商店，无需修改代码。`);
    console.log(`\n🔵 Microsoft Edge Add-ons:`);
    console.log(`   网址: https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview`);
    console.log(`   费用: 免费`);
    console.log(`\n🔴 Chrome Web Store:`);
    console.log(`   网址: https://chrome.google.com/webstore/dev/dashboard`);
    console.log(`   费用: $5 (一次性注册费)`);
} catch (error) {
    console.error('\n❌ 打包失败:', error.message);
    console.error('请确保您的系统支持 PowerShell 命令 "Compress-Archive"');
    process.exit(1);
}