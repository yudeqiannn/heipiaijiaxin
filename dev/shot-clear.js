/* 截图：技能页「清空余光」按钮的普通态与待确认态 */
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
  const shot = async (name, clip) => {
    const p = { format: 'png', fromSurface: true };
    if (clip) p.clip = Object.assign({ scale: 1 }, clip);
    const r = await send('Page.captureScreenshot', p);
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
  };

  // 有一点余光、有技能等级，接近真实中后期
  await ev(`
    meta.pts = 1840;
    meta.lv = { reach: 3, window: 2 };
    recalcPowers();
    state = 'skills';
    'ok'
  `);
  await sleep(300);
  await shot('shot-8-skills.png');

  // 点一下清空按钮 → 待确认态
  const btn = await ev(`
    (function(){ var L = skillLayout(); return { x: L.clearYing.x, y: L.clearYing.y, w: L.clearYing.w, h: L.clearYing.h }; })()
  `);
  await ev(`clearYing()`);
  await sleep(250);
  await shot('shot-9-confirm.png', { x: btn.x - 14, y: btn.y - 16, width: btn.w + 28, height: btn.h + 32 });

  ws.close(); ch.kill();
  setTimeout(() => process.exit(0), 300);
})();
