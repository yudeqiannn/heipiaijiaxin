/* 截图：深度层 / 契约 / 里程碑在四个界面上的样子 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(os.tmpdir(), 'zhan-chrome-shot');
const url = 'file:///' + path.join(__dirname, 'snapshot.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpJson(p) {
  return new Promise((resolve, reject) => {
    require('http').get({ host: '127.0.0.1', port: 9333, path: p }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  fs.rmSync(profile, { recursive: true, force: true });
  const ch = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await httpJson('/json/list'); if (targets.length) break; } catch (e) {}
    await sleep(250);
  }
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await new Promise(r => ws.onopen = r);

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(1200);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) console.log('JS ERR', JSON.stringify(r.result.exceptionDetails.text).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
  };

  // A. 进层提示：正好跨过 30 秒，进第 3 层「裂隙」
  await ev(`
    meta.depthBest = 4;
    meta.kills = 420;
    recalcPowers();
    start();
    CFG.spawnBase = 1e9; CFG.spawnMin = 1e9; CFG.waveFirst = 1e9;
    CFG.chargerAt = 1e9; CFG.heavyAt = 1e9; CFG.bombAt = 1e9; CFG.watchAt = 1e9;
    spawnTimer = 1e9; enemies.length = 0;
    contract = CONTRACTS[0];                 // 连击到 25
    bestCombo = 18; combo = 18; comboTimer = 999;
    yingRun = 50; crystalsBroken = 2;
    gameTime = 29.8; layer = 2;
    'ok'
  `);
  await sleep(500);
  await shot('shot-14-layer.png');

  // B. 常态 HUD：等进层提示淡出
  await sleep(2200);
  await ev('combo = 23; bestCombo = 23; comboTimer = 999; layerFxT = 0;');
  await sleep(200);
  await shot('shot-15-hud.png');

  // C. 死亡页：刷新最深 + 契约达成 + 解锁
  await ev(`
    layer = 5;
    meta.depthBest = 3;
    meta.kills = 999;
    meta.unlocked = {};
    bestCombo = 31;
    score = 3480;
    surviveGain = 262;
    contractDone = true;
    die();
    'ok'
  `);
  await sleep(900);
  await shot('shot-16-dead.png');

  // D. 结算页
  await ev('state = "over"; overT = 0;');
  await sleep(600);
  await shot('shot-17-over.png');

  // E. 技能页：五张卡，最后一张锁着
  await ev(`
    meta.depthBest = 3;
    meta.pts = 2600;
    meta.lv = { reach: 3, window: 2 };
    recalcPowers();
    state = 'skills';
    'ok'
  `);
  await sleep(400);
  await shot('shot-18-skills.png');

  // F. 解锁后的技能页
  await ev('meta.depthBest = 5; recalcPowers();');
  await sleep(300);
  await shot('shot-19-skills-open.png');

  ws.close(); ch.kill();
  setTimeout(() => process.exit(0), 300);
})();
