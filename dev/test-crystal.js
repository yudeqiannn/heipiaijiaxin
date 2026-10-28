/* 晶柱刷新机制测试
   1) 开局 3 根，都长在光里（看得见、砍得到）
   2) 碎一根 → 约 5 秒后从光外补一根（1.10~1.45 倍视野）
   3) 场上永远不超过 crystalN
   4) 场上清空时加速补（1.6 秒内）
   5) 一根柱子给 25 余光，且补出来的柱子照样给
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv() {
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let raf = null; let simT = 1000;
  const ac = {
    get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  const canvas = {
    width: 0, height: 0, clientWidth: 390, clientHeight: 844,
    getContext: () => new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        return t[k] !== undefined ? t[k] : function () {};
      },
      set(t, k, v) { t[k] = v; return true; }
    }),
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
  };
  const storage = {};
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 40, bottom: 830 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => simT },
    requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'headless' }
  };
  sb.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: 844 };
  sb.document = { getElementById: () => canvas, addEventListener() {}, visibilityState: 'visible' };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext('meta.tut = TUT_DONE;', sb);   // 新手教学会往身边送怪 / 补晶柱，这里只测正常对局
  vm.runInContext(`
    globalThis.__K = {
      get state(){return state;}, get P(){return P;},
      get crystals(){return crystals;}, get view(){return view;},
      get yingRun(){return yingRun;}, get gameTime(){return gameTime;},
      get timer(){return crystalTimer;},
      CFG, start, shatterCrystal, YING_CRYSTAL,
      set spawnTimer(v){ spawnTimer = v; }, set inv(v){ P.inv = v; }
    };
  `, sb);
  return {
    K: sb.__K,
    step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } }
  };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

const E = makeEnv(), K = E.K;
E.step(30);
K.start();
K.CFG.spawnBase = 1e6; K.CFG.spawnMin = 1e6; K.spawnTimer = 1e6;   // 关掉刷怪，专注测晶柱
K.CFG.lightT0 = Infinity;      // 光不掉（2.11 节）：这里站着不动测晶柱，光灭了人就死了、时间也停了
K.inv = 1e6;
E.step(2);

console.log('=== 1. 开局晶柱 ===');
ok(K.crystals.length === 3, '开局 3 根', K.crystals.length);
const d0 = K.crystals.map(c => Math.hypot(c.x - K.P.x, c.y - K.P.y));
ok(d0.every(d => d < K.view * 0.95), '都在光里（距离 < 0.95 视野）', d0.map(d => d.toFixed(0)).join(' / '));
ok(d0.every(d => d > 100), '不会贴脸生成', d0.map(d => d.toFixed(0)).join(' / '));

console.log('\n=== 2. 碎一根，从光外补一根 ===');
const t0 = K.gameTime;
K.shatterCrystal(0);
ok(K.crystals.length === 2, '碎掉后剩 2 根', K.crystals.length);
// 补柱用的是"补出来那一刻"的视野（碎柱的光尘会临时撑大视野），所以量距离也按那一帧的视野算
let viewNow = K.view;
let waited = 0;
while (K.crystals.length < 3 && waited < 10) { E.step(1); waited = K.gameTime - t0; viewNow = K.view; }
ok(K.crystals.length === 3, '补上了一根', K.crystals.length);
ok(Math.abs(waited - K.CFG.crystalRespawn) < 0.1, '用时 ≈ ' + K.CFG.crystalRespawn + ' 秒', waited.toFixed(2) + 's');

const nc = K.crystals.find(c => c.age < 5);
ok(!!nc, '补出来的那根带生长动画（age 从 0 开始）', nc ? nc.age.toFixed(2) : 'none');
if (nc) {
  const d = Math.hypot(nc.x - K.P.x, nc.y - K.P.y) / viewNow;
  ok(d >= K.CFG.crystalOutMin - 0.02 && d <= K.CFG.crystalOutMax + 0.02,
    '落在光外 ' + K.CFG.crystalOutMin + '~' + K.CFG.crystalOutMax + ' 倍视野之间', d.toFixed(2) + 'x');
}

console.log('\n=== 3. 生长动画 0.5 秒到位 ===');
{
  const c = K.crystals.find(x => x.age < 5);
  if (c) {
    const a0 = c.age;
    E.step(6);
    ok(c.age > a0, 'age 在增长', a0.toFixed(2) + ' → ' + c.age.toFixed(2));
    E.step(40);
    ok(c.age >= K.CFG.crystalGrow, '0.5 秒后长满', c.age.toFixed(2));
  } else { ok(false, '没找到新柱子'); }
}

console.log('\n=== 4. 正常节奏（每 5 秒一根）：不会断供 ===');
{
  let breaks = 0, maxSeen = 0, starved = 0;
  const y0 = K.yingRun;
  for (let f = 0; f < 60 * 60; f++) {
    E.step(1);
    maxSeen = Math.max(maxSeen, K.crystals.length);
    if (K.crystals.length === 0) starved++;
    // 每 5 秒砍一根已长成的柱子（和刷新速度持平）
    if (f % 300 === 0) {
      const i = K.crystals.findIndex(c => c.age >= K.CFG.crystalGrow);
      if (i >= 0) { K.shatterCrystal(i); breaks++; }
    }
  }
  ok(maxSeen <= K.CFG.crystalN, '场上最多 ' + maxSeen + ' 根（上限 ' + K.CFG.crystalN + '）', maxSeen);
  ok(breaks === 12, '一分钟碎了 12 根（每 5 秒一根）', breaks);
  ok(starved === 0, '任何一帧场上都不是空的', starved);
  ok(K.yingRun - y0 === breaks * K.YING_CRYSTAL, '余光 = 碎数 × ' + K.YING_CRYSTAL, K.yingRun - y0);
}

console.log('\n=== 5. 贪婪节奏（每 0.5 秒一根）：收入被刷新速度卡住 ===');
{
  let breaks = 0, starved = 0;
  const y0 = K.yingRun;
  const t0 = K.gameTime;
  for (let f = 0; f < 60 * 60; f++) {
    E.step(1);
    if (K.crystals.length === 0) starved++;
    if (f % 30 === 0 && K.crystals.length > 0) { K.shatterCrystal(0); breaks++; }
  }
  // 供给上限 = 开场 3 根 + 空场时 2.5 秒一根
  const cap = 3 + Math.ceil(60 / (K.CFG.crystalRespawn * 0.5));
  ok(breaks <= cap, '一分钟最多碎 ' + breaks + ' 根（供给上限约 ' + cap + '）', breaks);
  ok(breaks <= 27, '砍空后补一根要 2.5 秒，收入被供给卡死', breaks);
  ok(starved > 0, '柱子被砍光后要等刷新（这就是节奏）', starved);
  ok(K.yingRun - y0 === breaks * K.YING_CRYSTAL, '余光只按真正碎掉的根数算', K.yingRun - y0);
  ok(K.gameTime - t0 > 57, '跑满了 60 秒', (K.gameTime - t0).toFixed(1));
}

console.log('\n=== 6. 场上清空时加速补 ===');
{
  while (K.crystals.length > 0) K.shatterCrystal(0);
  const t1 = K.gameTime;
  let w = 0;
  while (K.crystals.length === 0 && w < 5) { E.step(1); w = K.gameTime - t1; }
  ok(K.crystals.length >= 1, '补上了', K.crystals.length);
  ok(w < 2.8, '用时 < 2.8 秒（不是干等 5 秒）', w.toFixed(2) + 's');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
