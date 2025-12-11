const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// ============ 配置 ============
const WEB_DIST_DIR = 'web-dist';
const ANDROID_DIR = 'android';
const APK_OUTPUT_DIR = 'dist';

// ============ 辅助函数 ============
function run(command, options = {}) {
  console.log(`\n🔧 执行: ${command}\n`);
  try {
    execSync(command, { 
      stdio: 'inherit', 
      shell: true,
      ...options 
    });
    return true;
  } catch (error) {
    console.error(`❌ 命令执行失败: ${command}`);
    return false;
  }
}

function checkCommand(command) {
  try {
    execSync(`${command} --version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

// ============ 主流程 ============
async function main() {
  const args = process.argv.slice(2);
  const buildType = args[0] || 'debug'; // debug 或 release
  const skipWeb = args.includes('--skip-web');
  const openStudio = args.includes('--open');

  console.log('╔════════════════════════════════════════════╗');
  console.log('║       IdoFront APP 打包工具 v1.0           ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n📱 构建类型: ${buildType.toUpperCase()}`);
  
  // 1. 检查环境
  console.log('\n📋 检查构建环境...');
  
  const hasNode = checkCommand('node');
  const hasNpm = checkCommand('npm');
  const hasJava = checkCommand('java');
  
  if (!hasNode || !hasNpm) {
    console.error('❌ 需要安装 Node.js 和 npm');
    process.exit(1);
  }
  console.log('✅ Node.js 和 npm 已安装');
  
  if (!hasJava) {
    console.warn('⚠️  未检测到 Java，Android 构建可能失败');
    console.warn('   请安装 JDK 17 或更高版本');
  } else {
    console.log('✅ Java 已安装');
  }

  // 检查 Android SDK
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!androidHome) {
    console.warn('⚠️  未设置 ANDROID_HOME 环境变量');
    console.warn('   请安装 Android Studio 并配置 SDK');
  } else {
    console.log(`✅ Android SDK: ${androidHome}`);
  }

  // 2. 检查依赖
  if (!fs.existsSync('node_modules/@capacitor/cli')) {
    console.log('\n📦 安装依赖...');
    if (!run('npm install')) {
      console.error('❌ 依赖安装失败');
      process.exit(1);
    }
  }

  // 3. 构建 Web 版本
  if (!skipWeb) {
    console.log('\n🌐 构建 Web 版本...');
    if (!run('npm run build:web')) {
      console.error('❌ Web 构建失败');
      process.exit(1);
    }
  } else {
    console.log('\n⏭️  跳过 Web 构建');
  }

  // 检查 web-dist 是否存在
  if (!fs.existsSync(WEB_DIST_DIR)) {
    console.error(`❌ 未找到 ${WEB_DIST_DIR} 目录，请先运行 npm run build:web`);
    process.exit(1);
  }

  // 4. 初始化 Android 项目（如果不存在）
  if (!fs.existsSync(ANDROID_DIR)) {
    console.log('\n📱 初始化 Android 项目...');
    if (!run('npx cap add android')) {
      console.error('❌ Android 项目初始化失败');
      process.exit(1);
    }
  }

  // 5. 同步 Web 资源到 Android
  console.log('\n🔄 同步资源到 Android...');
  if (!run('npx cap sync android')) {
    console.error('❌ 资源同步失败');
    process.exit(1);
  }

  // 6. 如果只是打开 Android Studio
  if (openStudio) {
    console.log('\n🚀 打开 Android Studio...');
    run('npx cap open android');
    return;
  }

  // 7. 构建 APK
  console.log(`\n🏗️  构建 ${buildType.toUpperCase()} APK...`);
  
  const isWindows = process.platform === 'win32';
  const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
  const buildTask = buildType === 'release' ? 'assembleRelease' : 'assembleDebug';
  
  // 检查 gradlew 是否存在
  const gradlePath = path.join(ANDROID_DIR, isWindows ? 'gradlew.bat' : 'gradlew');
  if (!fs.existsSync(gradlePath)) {
    console.error(`❌ 未找到 ${gradlePath}`);
    console.log('   请先用 Android Studio 打开项目进行初始化');
    console.log('   或运行: npm run build:app -- --open');
    process.exit(1);
  }

  // 执行 Gradle 构建
  if (!run(`${gradleCmd} ${buildTask}`, { cwd: ANDROID_DIR })) {
    console.error('❌ APK 构建失败');
    process.exit(1);
  }

  // 8. 复制 APK 到 dist 目录
  console.log('\n📁 复制 APK 文件...');
  ensureDir(APK_OUTPUT_DIR);

  const apkDir = buildType === 'release' 
    ? path.join(ANDROID_DIR, 'app/build/outputs/apk/release')
    : path.join(ANDROID_DIR, 'app/build/outputs/apk/debug');
  
  const apkName = buildType === 'release' ? 'app-release.apk' : 'app-debug.apk';
  const srcApk = path.join(apkDir, apkName);

  // 读取版本号
  let version = '1.0.0';
  try {
    const manifest = JSON.parse(fs.readFileSync('edge-extension/manifest.json', 'utf8'));
    version = manifest.version || version;
  } catch {}

  const destApkName = `IdoFront-v${version}-${buildType}.apk`;
  const destApk = path.join(APK_OUTPUT_DIR, destApkName);

  if (copyFile(srcApk, destApk)) {
    const stats = fs.statSync(destApk);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║           ✅ APK 构建成功！                 ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n📱 文件: ${destApk}`);
    console.log(`📦 大小: ${sizeMB} MB`);
    console.log(`🏷️  版本: v${version} (${buildType})`);
    
    if (buildType === 'debug') {
      console.log('\n💡 提示: Debug 版本可直接安装测试');
      console.log('         Release 版本需要签名才能安装');
    }
  } else {
    console.error(`❌ 未找到 APK 文件: ${srcApk}`);
    console.log('\n💡 可能的原因:');
    console.log('   1. Gradle 构建实际上失败了');
    console.log('   2. APK 输出路径不正确');
    console.log(`   3. 请检查 ${apkDir} 目录`);
  }
}

// 显示帮助信息
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
IdoFront APP 打包工具

用法: node build-app.js [选项]

选项:
  debug         构建 Debug 版本 APK (默认)
  release       构建 Release 版本 APK
  --skip-web    跳过 Web 构建步骤
  --open        只同步资源并打开 Android Studio
  --help, -h    显示帮助信息

示例:
  node build-app.js                  # 构建 Debug APK
  node build-app.js release          # 构建 Release APK
  node build-app.js --skip-web       # 跳过 Web 构建
  node build-app.js --open           # 打开 Android Studio

环境要求:
  - Node.js 16+
  - Java JDK 17+
  - Android SDK (通过 Android Studio 安装)
  - 设置 ANDROID_HOME 环境变量
`);
  process.exit(0);
}

// 运行
main().catch(err => {
  console.error('\n❌ 构建过程中发生错误:', err.message);
  process.exit(1);
});