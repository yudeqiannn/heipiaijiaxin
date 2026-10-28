/* 平衡机器人：模拟"站桩按死斩"的玩家，统计死亡时间与分数分布。
   目标：死亡高峰落在 45~70 秒、分数不再轻易上万。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

function makeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : function () {};
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const ctxMock = makeCtx();
const canvasMock = {
  width: 0, height: 0, clientWidth: 390, clientHeight: 844,
  getContext: () => ctxMock,
  addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
};

function node() {
  const param = () => ({
    value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, cancelScheduledValues() {}
  });
  return {
    connect() { return this; }, disconnect() {}, start() {}, stop() {},
    frequency: param(), gain: param(), Q: param(), type: '', buffer: null
  };
}

const handlers = {};
const storage = {};
const ttMock = {
  createCanvas: () => canvasMock,
  getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 40, bottom: 830 } }),
  onTouchStart: (cb) => { handlers.start = cb; },
  onTouchMove: (cb) => { handlers.move = cb; },
  onTouchEnd: (cb) => { handlers.end = cb; },
  onTouchCancel: (cb) => { handlers.cancel = cb; },
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  createWebAudioContext: () => ({
    get currentTime() { return Date.now() / 1000; },
    sampleRate: 44100, state: 'running',
    destination: { connect() {}, disconnect() {} },
    createGain: () => node(), createOscillator: () => node(),
    createBufferSource: () => node(), createBiquadFilter: () => node(),
    createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }),
    resume() {}
  }),
  setKeepScreenOn() {}, onHide() {}, onShow() {},
  createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
  shareAppMessage() {}
};

let rafCb = null;
const sandbox = {
  tt: ttMock, console, setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  cancelAnimationFrame() {},
  Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'headless' }
};
sandbox.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: 844 };
sandbox.document = { getElementById: () => canvasMock, addEventListener() {}, visibilityState: 'visible' };

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.js' });

// 第二个脚本：同一个 vm 上下文能看到 game.js 顶层词法绑定，挂出调试钩子
vm.runInContext(`
globalThis.__Z = {
  get state() { return state; },
  get gameTime() { return gameTime; },
  get score() { return score; },
  get bestCombo() { return bestCombo; },
  get enemies() { return enemies; },
  get crystals() { return crystals; },
  get yingRun() { return yingRun; },
  get broken() { return crystalsBroken; },
  get dbg() { return { px: P.x, py: P.y }; },
  start() { start(); },
  stats: null
};
`, sandbox);
const Z = sandbox.__Z;

let simT = 1000;                       // 单调时钟：跨调用持续走，dt 才不会是 0
function step(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafCb; rafCb = null;
    if (!cb) throw new Error('no raf');
    simT += 16.7;
    cb(simT);
  }
}
const touch = (id, x, y) => ({ changedTouches: [{ identifier: id, clientX: x, clientY: y }] });

const MAX_FRAMES = 130 * 60;   // 单局上限 130 秒

// 风筝流的移动决策：远离威胁重心 + 墙壁反推，没威胁就站住收割
function kiterDir() {
  const px = Z.dbg.px, py = Z.dbg.py;
  let tx = 0, ty = 0, threat = 0;
  const es = Z.enemies;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    const dx = px - e.x, dy = py - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 380) continue;
    const w = (1 - d / 380) * (e.charger ? 1.6 : 1);
    tx += dx / d * w; ty += dy / d * w;
    threat += w;
  }
  // 墙壁反推
  if (px < 170) tx += (170 - px) / 170 * 1.5;
  if (px > 780 - 170) tx -= (px - (780 - 170)) / 170 * 1.5;
  if (py < 170) ty += (170 - py) / 170 * 1.5;
  if (py > 1688 - 170) ty -= (py - (1688 - 170)) / 170 * 1.5;
  const len = Math.hypot(tx, ty);
  if (len < 0.35) return null;                       // 没威胁：站住连斩
  return { x: tx / len, y: ty / len };
}

// 刀诀三选一：随便挑一张（等过 0.4 秒防误触再点）
function autoPick() {
  const r = vm.runInContext('pick && pick.t >= 0.4 && pick.chosen < 0 ? { L: pickLayout(), n: pick.opts.length } : null', sandbox);
  if (!r) return;
  const i = Math.floor(Math.random() * r.n), x = r.L.x + r.L.w / 2, y = r.L.ys[i] + r.L.h / 2;
  handlers.start(touch(3, x, y));
  handlers.end(touch(3, x, y));
}

function runTrial(strategy) {
  if (Z.state !== 'play') Z.start();
  const press = function () {
    if (strategy === 'plant') {
      handlers.start(touch(2, 316, 756));            // 按住攻击，不松手，不移动
    } else {
      // 风筝流：左手摇杆，右手按死攻击
      handlers.start(touch(1, 120, 500));
      handlers.start(touch(2, 316, 756));
    }
  };
  press();
  let f = 0, held = true;
  while ((Z.state === 'play' || Z.state === 'pick') && f < MAX_FRAMES) {
    step(1); f++;
    if (Z.state === 'pick') { autoPick(); held = false; continue; }
    if (!held) { press(); held = true; }             // 挑完卡回来：手指重新按上（三选一会清掉按着的手）
    if (strategy === 'mover') {
      if (f % 10 === 0) {
        const dir = kiterDir();
        if (dir) handlers.move(touch(1, 120 + dir.x * 66, 500 + dir.y * 66));
        else handlers.move(touch(1, 120, 500));    // 收手：tMove 归零
      }
    }
    // 跟着糖走（2.11 节），按着斩不放 —— 像真人那样边走边斩：每 6 帧把摇杆拧向下一颗糖（没糖了就是门），
    // 前面挡路的顺着刀就砍了；侧面、身后有怪贴得很近（拖着的时候只砍拖的方向，它们会撞上来）才松开摇杆，
    // 让刀自己砍最近的，清掉了再接着走
    if (strategy === 'trail' && f % 6 === 0) {
      const d = vm.runInContext('(function () { const t = lightTarget(); if (!t) return null; const dx = wdelta(t.x - P.x), dy = wdelta(t.y - P.y), L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L; if (enemies.some(e => { const ex = wdelta(e.x - P.x), ey = wdelta(e.y - P.y), d = Math.hypot(ex, ey) || 1; return d < reach() * 0.7 && (ex * ux + ey * uy) / d < 0.64; })) return 0; return { x: ux, y: uy }; })()', sandbox);
      if (d === 0) handlers.move(touch(1, 120, 500));
      else if (d) handlers.move(touch(1, 120 + d.x * 66, 500 + d.y * 66));
    }
  }
  if (strategy === 'plant') handlers.end(touch(2, 316, 756));
  else { handlers.end(touch(1, 120, 500)); handlers.end(touch(2, 316, 756)); }
  return { t: Z.gameTime, score: Z.score, combo: Z.bestCombo, ying: Z.yingRun, broken: Z.broken, timeout: f >= MAX_FRAMES,
           cards: vm.runInContext('runPicks.length', sandbox), layer: vm.runInContext('layer', sandbox),
           die: vm.runInContext('runDeaths.length ? runDeaths[runDeaths.length - 1][0] : "-"', sandbox) };
}

function report(name, results) {
  const times = results.map(r => r.t);
  const scores = results.map(r => r.score);
  const sortedT = [...times].sort((a, b) => a - b);
  const sortedS = [...scores].sort((a, b) => a - b);
  const median = (arr) => arr[Math.floor(arr.length / 2)];
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  console.log('===', name, 'x', results.length, '局 ===');
  results.forEach((r, i) => console.log(
    ' #' + (i + 1), '存活', r.t.toFixed(1) + 's', '分数', r.score, '最高连击', r.combo,
    '余光', r.ying, '(碎 ' + r.broken + ' 根)', '刀诀', r.cards + ' 张', '第 ' + r.layer + ' 层', '死于 ' + r.die, r.timeout ? '[未死]' : ''
  ));
  console.log('中位死亡时间:', median(sortedT).toFixed(1) + 's',
    '| 最短', sortedT[0].toFixed(1) + 's', '| 最长', sortedT[sortedT.length - 1].toFixed(1) + 's');
  console.log('中位分数:', median(sortedS), '| 最低', sortedS[0], '| 最高', sortedS[sortedS.length - 1]);
  console.log('平均分:', Math.round(mean(scores)), '平均存活:', mean(times).toFixed(1) + 's');
  const yings = results.map(r => r.ying).sort((a, b) => a - b);
  const brk = results.map(r => r.broken).sort((a, b) => a - b);
  console.log('中位余光:', median(yings), '| 最低', yings[0], '| 最高', yings[yings.length - 1],
    '| 中位碎柱', median(brk), '根 | 每分钟余光约',
    Math.round(mean(results.map(r => r.ying)) / (mean(times) / 60)));
  console.log('45~70s 死亡占比:', (times.filter(t => t >= 45 && t <= 70).length / results.length * 100).toFixed(0) + '%');
}

// 先空跑 30 帧让游戏进 ready
step(30);

const N = 10;
// BAL_ONLY=plant / mover / trail：只跑一种（调数值时省时间）
const ONLY = process.env.BAL_ONLY || '';
const plantR = [], moverR = [], trailR = [];
for (let i = 0; i < N; i++) {
  if (!ONLY || ONLY === 'plant') { plantR.push(runTrial('plant')); step(240); }   // 让死亡流程走完再开下一局
  if (!ONLY || ONLY === 'mover') { moverR.push(runTrial('mover')); step(240); }
  if (!ONLY || ONLY === 'trail') { trailR.push(runTrial('trail')); step(240); }
}

if (plantR.length) report('站桩按死斩', plantR);
if (moverR.length) report('走位+按死攻击', moverR);
if (trailR.length) report('跟着糖走+按死斩（先清身边再走）', trailR);

process.exit(0);   // BGM 调度器还在跑 setInterval，测试结束直接退出
