/* 诊断：为什么"连击到后面会自己停下来"
   机器人按住「斩」不放，逐帧记录：出刀间隔、空窗原因（够不到目标 / 空刀冷却）、
   死亡瞬间的处境（最近敌人多远、冷却还剩多少、周围几只）。
   不参与打包，纯分析用。 */
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
  return { connect() { return this; }, disconnect() {}, start() {}, stop() {},
    frequency: param(), gain: param(), Q: param(), type: '', buffer: null };
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
vm.runInContext(`
globalThis.__Z = {
  get state() { return state; },
  get gameTime() { return gameTime; },
  get score() { return score; },
  get combo() { return combo; },
  get bestCombo() { return bestCombo; },
  get enemies() { return enemies; },
  get crystals() { return crystals; },
  get view() { return view; },
  get p() { return { x: P.x, y: P.y, cd: P.cd, dashT: P.dashT, inv: P.inv, r: P.r }; },
  get reached() { return POW.autoReach; },
  start() { start(); }
};
`, sandbox);
const Z = sandbox.__Z;

let simT = 1000;
function step(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafCb; rafCb = null;
    if (!cb) throw new Error('no raf');
    simT += 16.7;
    cb(simT);
  }
}
const touch = (id, x, y) => ({ changedTouches: [{ identifier: id, clientX: x, clientY: y }] });

const FRAME = 1 / 60;

function nearestInfo() {
  let best = 9999, n120 = 0, n200 = 0;
  const p = Z.p;
  for (const e of Z.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < best) best = d;
    if (d < 120) n120++;
    if (d < 200) n200++;
  }
  return { best, n120, n200 };
}

function run(withMove) {
  if (Z.state !== 'play') Z.start();
  // 按住斩（按钮在右下，CSS 坐标 316,756）
  handlers.start(touch(2, 316, 756));
  if (withMove) handlers.start(touch(1, 120, 500));

  let f = 0, lastDashT = 0, dashes = 0;
  let prevCombo = 0, breaks = [], lastNear = 9999;
  let gapStart = -1, gapReason = '';
  const gaps = [];              // {from, to, dur, reason, combo}
  let deathSnap = null;
  let prevEnemyCount = Z.enemies.length;

  while (Z.state === 'play' && f < 130 * 60) {
    step(1); f++;
    const p = Z.p;
    const c = Z.combo;
    if (prevCombo >= 10 && c === 0) breaks.push({ t: Z.gameTime, was: prevCombo, near: lastNear });
    prevCombo = c;
    lastNear = nearestInfo().best;
    // 出刀判定：dashT 从 0 变成 >0，或者本帧还在冲刺
    if (p.dashT > 0 && lastDashT <= 0) {
      dashes++;
      if (gapStart >= 0) {
        const dur = Z.gameTime - gapStart;
        if (dur > 0.12) gaps.push({ from: gapStart, to: Z.gameTime, dur, reason: gapReason, combo: Z.combo });
        gapStart = -1;
      }
    }
    lastDashT = p.dashT;

    // 空窗：按着斩但没在冲刺
    if (p.dashT <= 0) {
      const reason = p.cd > 0 ? 'miss' : 'noTarget';
      if (gapStart < 0) { gapStart = Z.gameTime; gapReason = reason; }
      else if (gapReason === 'noTarget' && reason === 'miss') gapReason = 'miss';
    }

    if (withMove && f % 10 === 0) {
      const info = nearestInfo();
      if (info.best < 150) {
        // 被逼脸上了：往威胁反方向挪
        let tx = 0, ty = 0;
        for (const e of Z.enemies) {
          const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
          if (d > 260) continue;
          tx += dx / d * (1 - d / 260); ty += dy / d * (1 - d / 260);
        }
        const l = Math.hypot(tx, ty) || 1;
        handlers.move(touch(1, 120 + tx / l * 60, 500 + ty / l * 60));
      } else handlers.move(touch(1, 120, 500));
    }
  }

  const info = nearestInfo();
  if (Z.state !== 'play') {
    deathSnap = {
      t: Z.gameTime, combo: Z.combo, best: Z.bestCombo, score: Z.score,
      cd: Z.p.cd, inv: Z.p.inv, near: info.best, n120: info.n120, n200: info.n200,
      enemies: Z.enemies.length
    };
  }
  handlers.end(touch(2, 316, 756));
  if (withMove) handlers.end(touch(1, 120, 500));
  return { gaps, breaks, dashes, deathSnap, t: Z.gameTime, combo: Z.bestCombo, score: Z.score };
}

step(30);

function summarize(name, r, total) {
  const gapSum = r.gaps.reduce((a, g) => a + g.dur, 0);
  const byReason = { noTarget: 0, miss: 0 };
  for (const g of r.gaps) byReason[g.reason] += g.dur;
  const long = r.gaps.filter(g => g.dur >= 0.3).length;
  const late = r.gaps.filter(g => g.combo >= 15);
  const lateSum = late.reduce((a, g) => a + g.dur, 0);
  console.log('--- ' + name + ' ---');
  console.log('  存活', r.t.toFixed(1) + 's  出刀', r.dashes, '次  最高连击', r.combo,
    '  空窗合计', gapSum.toFixed(1) + 's (' + (gapSum / r.t * 100).toFixed(0) + '% 的局内时间)');
  console.log('  空窗次数', r.gaps.length, '｜≥0.3s 的长空窗', long, '次',
    '｜原因：够不到目标', byReason.noTarget.toFixed(1) + 's /', '空刀冷却', byReason.miss.toFixed(1) + 's');
  console.log('  连击≥15 时：空窗', late.length, '次，合计', lateSum.toFixed(1) + 's');
  console.log('  连击断链（≥10 → 0）：', r.breaks.length, '次',
    r.breaks.map(b => b.was + '@' + b.t.toFixed(1) + 's(' + Math.round(b.near) + 'px)').join(' '));
  if (r.deathSnap && r.breaks.length) {
    const lastB = r.breaks[r.breaks.length - 1];
    console.log('  死亡距上次断链：', (r.deathSnap.t - lastB.t).toFixed(1) + 's');
  }
  if (r.deathSnap) {
    const d = r.deathSnap;
    console.log('  死亡：', d.t.toFixed(1) + 's  连击', d.combo, ' 最近敌人', d.near.toFixed(0),
      ' 120 内', d.n120, '只 / 200 内', d.n200, '只  当时 cd', d.cd.toFixed(2), ' 无敌', d.inv.toFixed(2));
  } else console.log('  未死');
  console.log('');
}

const N = 6;
for (let i = 0; i < N; i++) {
  summarize('站桩按死 #' + (i + 1), run(false));
}
for (let i = 0; i < N; i++) {
  summarize('边走边砍 #' + (i + 1), run(true));
}
