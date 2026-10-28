/* 用本机 Chrome 无头模式截图，检查重型甲环的三个状态 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(require('os').tmpdir(), 'zhan-chrome-shot');
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
  if (!targets || !targets.length) { console.log('no target'); ch.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await new Promise(r => ws.onopen = r);

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(1200);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) console.log('JS ERR', JSON.stringify(r.result.exceptionDetails.text));
    return r.result && r.result.result ? r.result.result.value : null;
  };

  console.log('state', await ev('typeof start + " " + typeof enemies'));
  await ev(`start(); enemies.length = 0; spawnTimer = 1e6; CFG.spawnBase = 1e6; CFG.spawnMin = 1e6; P.inv = 999;`);

  await ev(`
    enemies.length = 0;
    function mk(x, y, r, o) {
      spawnEnemy(x, y);
      const e = enemies[enemies.length - 1];
      e.x = x; e.y = y; e.r = r; e.born = 1; e.sp = 0;
      for (const k in o) e[k] = o[k];
      return e;
    }
    const P0 = P;
    window.__heavy = mk(P0.x + 40, P0.y - 150, 26, { heavy: true, hp: 2, score: 3, wob: 0.9 });
    mk(P0.x - 120, P0.y - 40, 16, { wob: 1.4 });
    mk(P0.x + 130, P0.y + 80, 15, { wob: 2.2 });
    'ok'
  `);

  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: clip || undefined });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
  };

  await sleep(600);
  await shot('shot-1-armored.png');

  await ev('crackEnemy(window.__heavy)');
  await sleep(90);
  await shot('shot-2-shatter.png');

  await sleep(900);
  await shot('shot-3-cracked.png');

  // 放大对照：满甲 vs 裂甲（3 倍放大）
  const crop = (w, h) => ({ x: w, y: h, width: 110, height: 110, scale: 3 });
  await ev('enemies.length = 0; armorBits.length = 0;');
  await ev(`
    function mk(x, y, r, o) {
      spawnEnemy(x, y);
      const e = enemies[enemies.length - 1];
      e.x = x; e.y = y; e.r = r; e.born = 1; e.sp = 0;
      for (const k in o) e[k] = o[k];
      return e;
    }
    window.__h1 = mk(P.x - 110, P.y - 10, 26, { heavy: true, hp: 2, score: 3, wob: 0.9 });
    window.__h2 = mk(P.x + 110, P.y + 10, 26, { heavy: true, hp: 2, score: 3, wob: 2.4, cracked: true, crackT: 0 });
    'ok'
  `);
  await sleep(400);
  await shot('shot-4-zoom-both.png', { x: 85, y: 357, width: 220, height: 130, scale: 3 });

  ws.close(); ch.kill();
  setTimeout(() => process.exit(0), 300);
})();
