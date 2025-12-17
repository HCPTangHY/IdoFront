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

/**
 * 从 JS 文件中解析数组变量（支持多行注释）
 * @param {string} content 文件内容
 * @param {string} varName 变量名
 * @returns {string[]} 解析出的字符串数组
 */
function parseArrayFromJS(content, varName) {
  const regex = new RegExp(`const\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = content.match(regex);
  if (!match) return [];
  
  const arrayContent = match[1];
  const files = [];
  
  // 逐行解析，提取所有字符串字面量
  for (const line of arrayContent.split('\n')) {
    const trimmed = line.trim();
    // 匹配单引号或双引号包裹的字符串（忽略注释行）
    if (trimmed.startsWith('//')) continue;
    const strMatch = trimmed.match(/^['"]([^'"]+)['"]/);
    if (strMatch) {
      files.push(strMatch[1]);
    }
  }
  
  return files;
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ============ 主流程 ============

async function build() {
console.log('📦 开始构建 Web 版...\n');

// 1. 清理并创建输出目录
if (fs.existsSync(WEB_DIST_DIR)) {
  removeDir(WEB_DIST_DIR);
}
ensureDir(WEB_DIST_DIR);

// ============================================================
// 2. 从 framework.js 和 loader.js 自动解析模块列表
//    ★ 这是唯一的配置源，新增文件只需修改这两个文件 ★
// ============================================================

// 2.1 解析 framework.js 中的 modules 数组
const frameworkLoaderPath = path.join(EXTENSION_DIR, 'scripts/framework.js');
const frameworkLoaderContent = fs.readFileSync(frameworkLoaderPath, 'utf8');
const frameworkModules = parseArrayFromJS(frameworkLoaderContent, 'modules');
console.log(`✅ 从 framework.js 解析到 ${frameworkModules.length} 个 Framework 模块`);

// 2.2 解析 loader.js 中的 libScripts 和 scripts 数组
const loaderPath = path.join(EXTENSION_DIR, 'scripts/ido-front/loader.js');
const loaderContent = fs.readFileSync(loaderPath, 'utf8');

const libScripts = parseArrayFromJS(loaderContent, 'libScripts');
console.log(`✅ 从 loader.js 解析到 ${libScripts.length} 个依赖库`);

const idoFrontScripts = parseArrayFromJS(loaderContent, 'scripts');
console.log(`✅ 从 loader.js 解析到 ${idoFrontScripts.length} 个 IdoFront 模块`);

// 2.3 构建完整的脚本加载顺序
const SCRIPT_ORDER = [
  // 基础 UI 工具
  'scripts/ui-kit.js',
  
  // Framework 模块（直接打包，跳过 framework.js 动态加载器）
  ...frameworkModules.map(file => `scripts/framework/${file}`),
  
  // IdoFront 依赖库
  ...libScripts.map(file => `scripts/lib/${file}`),
  
  // IdoFront 核心模块（跳过 loader.js 动态加载器）
  ...idoFrontScripts.map(file => `scripts/ido-front/${file}`),
  
  // 其他脚本
  'scripts/plugins.js'
];

console.log(`\n📋 总计 ${SCRIPT_ORDER.length} 个文件待打包\n`);

// 3. 按顺序读取并合并所有 JS 文件
console.log('📝 正在合并 JavaScript 文件...');
let bundledCode = '';
let loadedCount = 0;
let skippedFiles = [];

for (const scriptPath of SCRIPT_ORDER) {
  const fullPath = path.join(EXTENSION_DIR, scriptPath);
  
  if (!fs.existsSync(fullPath)) {
    skippedFiles.push(scriptPath);
    continue;
  }
  
  const content = fs.readFileSync(fullPath, 'utf8');
  bundledCode += `\n// ========== ${scriptPath} ==========\n`;
  bundledCode += content;
  bundledCode += '\n';
  loadedCount++;
}

if (skippedFiles.length > 0) {
  console.log(`⚠️  跳过 ${skippedFiles.length} 个不存在的文件:`);
  skippedFiles.forEach(f => console.log(`   - ${f}`));
}

// 4. 读取版本号
const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
let appVersion = '1.0.0';
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  appVersion = manifest.version || appVersion;
} catch (e) {
  console.warn('⚠️  无法读取 manifest.json 版本号');
}

// 5. 添加头部和尾部
const preamble = `// IdoFront Web Bundle
// Version: ${appVersion}
// Built: ${new Date().toISOString()}
// Files: ${loadedCount}
window.IdoFront = window.IdoFront || {};
window.IdoFront.version = '${appVersion}';
window.IdoFront.platform = 'web';

`;

// Framework 是异步创建的（在 framework/index.js 中），需要等待它完成
const epilogue = `
// ========== 等待 Framework 创建并触发加载完成事件 ==========
(function waitAndTrigger() {
  function trigger() {
    // Framework 创建完成后触发事件
    document.dispatchEvent(new CustomEvent('FrameworkLoaded'));
    console.log('Framework: 所有模块已加载');
    document.dispatchEvent(new CustomEvent('IdoFrontLoaded'));
    console.log('IdoFront: 所有脚本已加载。');
  }
  
  // 检查 Framework 是否已创建
  if (typeof Framework !== 'undefined' && Framework) {
    trigger();
  } else {
    // Framework 尚未创建，等待它
    var checkInterval = setInterval(function() {
      if (typeof Framework !== 'undefined' && Framework) {
        clearInterval(checkInterval);
        trigger();
      }
    }, 10);
    
    // 超时保护（5秒）
    setTimeout(function() {
      clearInterval(checkInterval);
      if (typeof Framework === 'undefined') {
        console.error('Framework 初始化超时');
      }
    }, 5000);
  }
})();
`;

bundledCode = preamble + bundledCode + epilogue;

// 6. 压缩代码
let finalCode = bundledCode;
try {
  const { minify } = require('terser');
  console.log('🔧 压缩代码...');
  
  const result = await minify(bundledCode, {
    compress: {
      dead_code: true,
      drop_console: false,
      drop_debugger: true,
      keep_classnames: true,
      keep_fnames: true
    },
    mangle: false,
    format: { comments: false }
  });
  
  if (result.code) {
    finalCode = result.code;
    const ratio = ((1 - finalCode.length / bundledCode.length) * 100).toFixed(1);
    console.log(`✅ 压缩完成 (${(bundledCode.length / 1024).toFixed(1)}KB → ${(finalCode.length / 1024).toFixed(1)}KB, -${ratio}%)\n`);
  }
} catch (e) {
  console.warn('⚠️  terser 未安装，跳过压缩\n');
}

// 7. 写入 app.js
fs.writeFileSync(path.join(WEB_DIST_DIR, 'app.js'), finalCode, 'utf8');
console.log(`✅ 生成: app.js`);

// 8. 拷贝 tailwind.js
const tailwindSrc = path.join(EXTENSION_DIR, 'scripts/tailwind.js');
if (fs.existsSync(tailwindSrc)) {
  fs.copyFileSync(tailwindSrc, path.join(WEB_DIST_DIR, 'tailwind.js'));
  console.log(`✅ 拷贝: tailwind.js`);
}

// 9. 拷贝 styles 目录
const stylesSrc = path.join(EXTENSION_DIR, 'styles');
if (fs.existsSync(stylesSrc)) {
  copyDir(stylesSrc, path.join(WEB_DIST_DIR, 'styles'));
  console.log(`✅ 拷贝: styles/`);
}

// 10. 拷贝 icons 目录
const iconsSrc = path.join(EXTENSION_DIR, 'icons');
if (fs.existsSync(iconsSrc)) {
  copyDir(iconsSrc, path.join(WEB_DIST_DIR, 'icons'));
  console.log(`✅ 拷贝: icons/`);
}

// 11. 生成 index.html
const indexTemplate = path.join(WEB_TEMPLATE_DIR, 'index.html');
const indexDest = path.join(WEB_DIST_DIR, 'index.html');

if (fs.existsSync(indexTemplate)) {
  fs.copyFileSync(indexTemplate, indexDest);
  console.log(`✅ 拷贝: index.html (模板)`);
} else {
  // 自动生成
  const sidepanelPath = path.join(EXTENSION_DIR, 'sidepanel.html');
  let html = fs.readFileSync(sidepanelPath, 'utf8');
  
  // 移除所有旧脚本
  html = html.replace(/<script\s+src="scripts\/[^"]+"><\/script>\s*/g, '');
  
  // 添加新脚本
  html = html.replace('</body>', '  <script src="tailwind.js"></script>\n  <script src="app.js"></script>\n</body>');
  
  // 添加 favicon
  html = html.replace('</head>', '  <link rel="icon" href="icons/icon-32.png">\n</head>');
  
  // 移动端视口修复
  html = html.replace('</head>', `  <script>
    (function(){var h=function(){document.documentElement.style.setProperty('--vh',window.innerHeight*0.01+'px')};h();window.addEventListener('resize',h)})();
  </script>\n</head>`);
  
  // 修复高度
  html = html.replace(/class="([^"]*?)h-screen([^"]*?)"/, 'class="$1$2" style="height:calc(var(--vh,1vh)*100)"');
  
  fs.writeFileSync(indexDest, html, 'utf8');
  console.log(`✅ 生成: index.html`);
}

// 完成
console.log(`\n✅ 构建完成！`);
console.log(`📁 输出: ${WEB_DIST_DIR}/`);
console.log(`📊 打包: ${loadedCount} 个文件`);
console.log(`\n💡 提示: 新增文件只需修改 framework.js 或 loader.js\n`);
}

build().catch(err => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});