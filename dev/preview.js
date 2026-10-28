#!/usr/bin/env node
/*
 * 一键真机预览：node dev/preview.js
 *
 * 做的事：
 *   1. 清掉会和 Electron 打架的环境变量（ELECTRON_RUN_AS_NODE / NODE_OPTIONS）
 *   2. 用 --cli 模式拉起微信开发者工具（带 --no-sandbox --disable-gpu-sandbox，
 *      否则无界面环境下 GPU 进程会崩溃退出）
 *   3. 等本地服务端口 /upgrade 返回 200
 *   4. 用纯 Node 跑开发者工具自带的 CLI（避开 cli.bat 触发的 reg.exe 拦截）
 *   5. 把二维码写到 dev/preview-qr.png
 *
 * 产物：dev/preview-qr.png（微信扫码即可真机预览，约 25 分钟有效）
 *       dev/preview-info.json（本次代码包体积）
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PROJ = path.resolve(__dirname, '..');
const IDE_EXE = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\微信开发者工具.exe';
const IDE_CLI = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\resources\\app.asar.unpacked\\js\\common\\cli\\index.js';
const PORT = 9420;
// 纯 Node 跑 CLI 时它推导出的用户目录（与 IDE 自身的 2ca4... 目录不同）
const CLI_USER_DIR = 'C:\\Users\\123\\AppData\\Local\\微信开发者工具\\User Data\\e0ad2000ed909e00a121aa8cac83fa50\\Default';

const QR_OUT = path.join(__dirname, 'preview-qr.png');
const INFO_OUT = path.join(__dirname, 'preview-info.json');

function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/upgrade', timeout: 1200 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(res.statusCode === 200 ? body : null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ideRunning() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq 微信开发者工具.exe', '/NH'], { encoding: 'utf8' });
  return /微信开发者工具\.exe/i.test(r.stdout || '');
}

async function ensureIde() {
  const alive = await probe();
  if (alive) {
    console.log('[preview] IDE 已在监听 ' + PORT + '，直接复用');
    return true;
  }

  // 有进程但端口没开：说明是普通方式启动的窗口，CLI 连不上，先关掉再以 CLI 模式起
  if (ideRunning()) {
    console.log('[preview] 检测到旧实例且端口未开，关闭后重启');
    spawnSync('taskkill', ['/F', '/IM', '微信开发者工具.exe'], { stdio: 'ignore' });
    await sleep(2500);
  }

  console.log('[preview] 启动开发者工具…');
  const child = spawn(IDE_EXE, ['--cli', '--remote-port', String(PORT), '--no-sandbox', '--disable-gpu-sandbox', '--disable-gpu'], {
    detached: true,
    stdio: 'ignore',
    env: cleanEnv(),
    cwd: path.dirname(IDE_EXE)
  });
  child.unref();

  for (let i = 0; i < 80; i++) {
    await sleep(500);
    if (await probe()) {
      console.log('[preview] IDE 就绪（' + (i * 0.5).toFixed(1) + 's）');
      return true;
    }
  }
  throw new Error('IDE 启动超时：端口 ' + PORT + ' 没有响应');
}

function prepareCliUserDir() {
  fs.mkdirSync(CLI_USER_DIR, { recursive: true });
  fs.writeFileSync(path.join(CLI_USER_DIR, '.ide-status'), 'On', 'utf8');
  fs.writeFileSync(path.join(CLI_USER_DIR, '.ide'), String(PORT), 'utf8');
}

async function main() {
  prepareCliUserDir();
  await ensureIde();

  if (fs.existsSync(QR_OUT)) fs.unlinkSync(QR_OUT);

  console.log('[preview] 编译并生成二维码…');
  const r = spawnSync(process.execPath, [
    IDE_CLI, 'preview',
    '--project', PROJ,
    '--port', String(PORT),
    '--qr-format', 'image',
    '--qr-output', QR_OUT,
    '--info-output', INFO_OUT
  ], { stdio: 'inherit', env: cleanEnv(), cwd: PROJ });

  if (!fs.existsSync(QR_OUT)) {
    console.error('[preview] 失败：没有生成二维码（退出码 ' + r.status + '）');
    process.exit(1);
  }

  const kb = (fs.statSync(QR_OUT).size / 1024).toFixed(1);
  let pack = '';
  try {
    const info = JSON.parse(fs.readFileSync(INFO_OUT, 'utf8'));
    if (info && info.size && info.size.total) pack = '，代码包 ' + (info.size.total / 1024).toFixed(1) + ' KB';
  } catch (e) { /* 体积信息拿不到不影响预览 */ }

  console.log('[preview] 完成：' + QR_OUT + '（' + kb + ' KB' + pack + '）');
}

main().catch((e) => {
  console.error('[preview] ' + e.message);
  process.exit(1);
});
