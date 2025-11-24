const fs = require('fs');
const path = require('path');

const EXTENSION_DIR = 'edge-extension';
const WEB_DIST_DIR = 'web-dist';
const WEB_TEMPLATE_DIR = 'web';

// ============ 辅助函数 ============

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeDir(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }
  fs.rmdirSync(dir);
}

// ============ 主流程 ============

async function build() {
console.log('📦 开始构建 Web 版...\n');

// 1. 清理并创建输出目录
if (fs.existsSync(WEB_DIST_DIR)) {
  removeDir(WEB_DIST_DIR);
}
ensureDir(WEB_DIST_DIR);

// 2. 自动读取 loader.js 中的脚本列表
const loaderPath = path.join(EXTENSION_DIR, 'scripts/ido-front/loader.js');
const loaderContent = fs.readFileSync(loaderPath, 'utf8');

// 改进的正则提取 scripts 数组
const scriptsMatch = loaderContent.match(/const\s+scripts\s*=\s*\[([\s\S]*?)\];/);
if (!scriptsMatch) {
  console.error('❌ 无法从 loader.js 解析 scripts 数组');
  process.exit(1);
}

const scriptsArrayContent = scriptsMatch[1];
const scriptFiles = [];

// 逐行解析，提取所有字符串字面量
const lines = scriptsArrayContent.split('\n');
for (const line of lines) {
  const trimmed = line.trim();
  // 匹配单引号或双引号包裹的字符串
  const match = trimmed.match(/^['"]([^'"]+)['"]/);
  if (match) {
    scriptFiles.push(match[1]);
  }
}

console.log(`✅ 从 loader.js 读取到 ${scriptFiles.length} 个模块文件`);
if (scriptFiles.length === 0) {
  console.error('❌ 未能解析到任何脚本文件，请检查 loader.js 格式');
  process.exit(1);
}
console.log();

// 3. 构建完整的脚本加载顺序
// 注意：tailwind.js 需要单独处理，不打包进 app.js
const SCRIPT_ORDER = [
  // 基础库（固定顺序）
  'scripts/ui-kit.js',
  'scripts/framework.js',
  
  // IdoFront 核心模块（从 loader.js 读取）
  ...scriptFiles.map(file => `scripts/ido-front/${file}`),
  
  // 桥接和 Markdown（固定顺序）
  'scripts/plugins.js',
  'scripts/marked.min.js'
];

// 4. 按顺序读取并合并所有 JS 文件
console.log('📝 正在合并 JavaScript 文件...');
let bundledCode = '';

for (const scriptPath of SCRIPT_ORDER) {
  const fullPath = path.join(EXTENSION_DIR, scriptPath);
  
  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  文件不存在，跳过: ${scriptPath}`);
    continue;
  }
  
  const content = fs.readFileSync(fullPath, 'utf8');
  bundledCode += `\n// ========== ${scriptPath} ==========\n`;
  bundledCode += content;
  bundledCode += '\n';
}

// 5. 在末尾触发 IdoFrontLoaded 事件（模拟 loader.js 的行为）
bundledCode += `\n// ========== 触发加载完成事件 ==========\n`;
bundledCode += `document.dispatchEvent(new CustomEvent('IdoFrontLoaded'));\n`;

// 6. 使用 terser 压缩代码
let finalCode = bundledCode;
try {
  const { minify } = require('terser');
  console.log('🔧 使用 terser 压缩代码...');
  
  const result = await minify(bundledCode, {
    compress: {
      dead_code: true,
      drop_console: false,
      drop_debugger: true,
      keep_classnames: true,
      keep_fnames: true
    },
    mangle: false, // 不混淆变量名，保持全局对象可访问
    format: {
      comments: false
    }
  });
  
  if (result.code) {
    finalCode = result.code;
    console.log(`✅ 压缩完成 (原始: ${(bundledCode.length / 1024).toFixed(1)}KB → 压缩后: ${(finalCode.length / 1024).toFixed(1)}KB)\n`);
  } else {
    console.warn('⚠️  terser 压缩失败，使用未压缩代码\n');
  }
} catch (e) {
  console.warn('⚠️  terser 未安装或压缩失败，使用未压缩代码');
  console.warn('   提示: 运行 "npm install terser --save-dev" 以启用代码压缩\n');
}

// 7. 写入 app.js
const appJsPath = path.join(WEB_DIST_DIR, 'app.js');
fs.writeFileSync(appJsPath, finalCode, 'utf8');
console.log(`✅ 已生成: ${appJsPath}`);

// 8. 拷贝 Tailwind.js（需要在 head 中独立加载）
const tailwindSource = path.join(EXTENSION_DIR, 'scripts/tailwind.js');
const tailwindDest = path.join(WEB_DIST_DIR, 'tailwind.js');
if (fs.existsSync(tailwindSource)) {
  fs.copyFileSync(tailwindSource, tailwindDest);
  console.log(`✅ 已拷贝: ${tailwindDest}`);
} else {
  console.warn(`⚠️  Tailwind 文件不存在: ${tailwindSource}`);
}

// 9. 拷贝 CSS
const cssSource = path.join(EXTENSION_DIR, 'styles/custom.css');
const cssDest = path.join(WEB_DIST_DIR, 'custom.css');
if (fs.existsSync(cssSource)) {
  fs.copyFileSync(cssSource, cssDest);
  console.log(`✅ 已拷贝: ${cssDest}`);
} else {
  console.warn(`⚠️  CSS 文件不存在: ${cssSource}`);
}

// 10. 拷贝 icons 目录
const iconsSource = path.join(EXTENSION_DIR, 'icons');
const iconsDest = path.join(WEB_DIST_DIR, 'icons');
if (fs.existsSync(iconsSource)) {
  ensureDir(iconsDest);
  const iconFiles = fs.readdirSync(iconsSource);
  iconFiles.forEach(file => {
    fs.copyFileSync(
      path.join(iconsSource, file),
      path.join(iconsDest, file)
    );
  });
  console.log(`✅ 已拷贝: icons/ (${iconFiles.length} 个文件)`);
}

// 11. 生成 index.html
const indexTemplate = path.join(WEB_TEMPLATE_DIR, 'index.html');
const indexDest = path.join(WEB_DIST_DIR, 'index.html');

if (fs.existsSync(indexTemplate)) {
  // 使用模板
  fs.copyFileSync(indexTemplate, indexDest);
  console.log(`✅ 已拷贝: ${indexDest} (来自模板)`);
} else {
  // 自动生成简化版 index.html
  console.log('⚠️  未找到模板，自动生成 index.html...');
  
  const sidepanelPath = path.join(EXTENSION_DIR, 'sidepanel.html');
  let htmlContent = fs.readFileSync(sidepanelPath, 'utf8');
  
  // 移除除 tailwind.js 外的所有 <script src="..."> 标签
  htmlContent = htmlContent.replace(/<script\s+src="scripts\/ui-kit\.js"><\/script>/g, '');
  htmlContent = htmlContent.replace(/<script\s+src="scripts\/framework\.js"><\/script>/g, '');
  htmlContent = htmlContent.replace(/<script\s+src="scripts\/ido-front\/loader\.js"><\/script>/g, '');
  htmlContent = htmlContent.replace(/<script\s+src="scripts\/plugins\.js"><\/script>/g, '');
  htmlContent = htmlContent.replace(/<script\s+src="scripts\/marked\.min\.js"><\/script>/g, '');
  
  // 更新 tailwind.js 路径
  htmlContent = htmlContent.replace(
    /<script\s+src="scripts\/tailwind\.js"><\/script>/,
    '<script src="tailwind.js"></script>'
  );
  
  // 在 </body> 前插入新的 script 标签
  htmlContent = htmlContent.replace(
    '</body>',
    '    <script src="app.js"></script>\n</body>'
  );
  
  // 更新 CSS 引用
  htmlContent = htmlContent.replace(
    /<link\s+rel="stylesheet"\s+href="styles\/custom\.css">/,
    '<link rel="stylesheet" href="custom.css">'
  );
  
  // 添加 favicon 链接（在 </head> 前插入）
  const faviconLinks = `
    <link rel="icon" type="image/png" sizes="16x16" href="icons/icon-16.png">
    <link rel="icon" type="image/png" sizes="32x32" href="icons/icon-32.png">
    <link rel="icon" type="image/png" sizes="64x64" href="icons/icon-64.png">
    <link rel="apple-touch-icon" sizes="128x128" href="icons/icon-128.png">
`;
  htmlContent = htmlContent.replace('</head>', `${faviconLinks}</head>`);
  
  // 添加移动端视口高度修复脚本（解决移动端浏览器地址栏导致的布局问题）
  const viewportHeightFix = `
    <script>
      // 修复移动端 100vh 问题（地址栏/工具栏导致的高度计算错误）
      function setViewportHeight() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', vh + 'px');
      }
      setViewportHeight();
      window.addEventListener('resize', setViewportHeight);
      window.addEventListener('orientationchange', setViewportHeight);
    </script>
  `;
  htmlContent = htmlContent.replace('</head>', `${viewportHeightFix}</head>`);
  
  // 修改 body 的高度样式，使用 CSS 变量而不是 h-screen
  htmlContent = htmlContent.replace(
    'class="bg-gray-50 h-screen w-screen overflow-hidden text-sm font-sans flex flex-col"',
    'class="bg-gray-50 w-screen overflow-hidden text-sm font-sans flex flex-col" style="height: 100vh; height: calc(var(--vh, 1vh) * 100);"'
  );
  
  fs.writeFileSync(indexDest, htmlContent, 'utf8');
  console.log(`✅ 已生成: ${indexDest} (自动转换 + 移动端优化)`);
}

// 12. 读取版本号（用于日志）
const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
let version = 'web';
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  version = manifest.version ? `v${manifest.version}-web` : 'web';
} catch (e) {
  console.warn('⚠️  无法读取版本号');
}

console.log('\n✅ Web 版构建完成！');
console.log(`📁 输出目录: ${WEB_DIST_DIR}/`);
console.log(`\n🚀 使用方法:`);
console.log(`   1. 直接打开 ${WEB_DIST_DIR}/index.html 在浏览器中测试`);
console.log(`   2. 将 ${WEB_DIST_DIR}/ 目录部署到任意静态服务器`);
}

// 运行构建
build().catch(err => {
  console.error('\n❌ 构建失败:', err);
  process.exit(1);
});
console.log(`   3. 或使用 Capacitor/Cordova 打包成 App\n`);