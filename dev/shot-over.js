/* 结算页截图：确认"回到主界面"按钮的位置和层级 */
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
    if (r.result && r.result.exceptionDetails) console.log('JS ERR', JSON.stringify(r.result.exceptionDetails.text));
    return r.result && r.result.result ? r.result.result.value : null;
  };

  // 造一个"打过一局"的结算页
  await ev(`
    start();
    score = 1842; combo = 0; bestCombo = 37;
    yingRun = 125; crystalsBroken = 5; meta.pts = 420;
    finishRun(); overT = 2;
    'ok'
  `);
  await sleep(500);

  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(__dirname, 'shot-5-over.png'), Buffer.from(r.result.data, 'base64'));
  console.log('saved shot-5-over.png');

  ws.close(); ch.kill();
  setTimeout(() => process.exit(0), 300);
})();
