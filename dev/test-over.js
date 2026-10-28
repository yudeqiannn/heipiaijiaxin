/* 结算页"回到主界面"测试
   1) 六个按钮都在屏内、互不重叠，home 在最下面，"再来一局"最大
   2) 点 home → 回主界面
   3) 回主界面后场上干净（没有残留敌人 / 碎屑），也不会自己刷怪
   4) 主界面点一下 → 正常开新局
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv() {
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000;
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
  let raf = null;
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
  vm.runInContext("CFG.mainMode = 'classic';", sb);   // 这里测的是正式玩法的主界面（主玩法现在是黑潮）
  vm.runInContext(`globalThis.__K = {
    get state(){return state;}, get P(){return P;}, get W_CSS(){return W_CSS;}, get H_CSS(){return H_CSS;}, get WORLD(){return WORLD;},
    get SAFE_BOTTOM(){return SAFE_BOTTOM;}, get view(){return view;}, get gameTime(){return gameTime;},
    get overT(){return overT;}, set overT(v){ overT = v; },
    get meta(){return meta;}, get score(){return score;},
    enemies, parts, stains, floats, armorBits, CFG,
    start, finishRun, toReady, overBtns, onTouchStart, drawOver, resetInput, talkSkipBtn,
    W, H
  };`, sb);
  return { K: sb.__K, step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } } };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

const { K, step } = makeEnv();
step(30); K.start(); step(20);

/* ---------- 1. 布局 ---------- */
console.log('=== 1. 结算页按钮布局 ===');
{
  const b = K.overBtns();
  ok(!!b.home, '有一个 home 按钮');
  const names = Object.keys(b);
  ok(names.length === 6, '共 6 个按钮', names.join(','));
  let inScreen = true, bad = '';
  for (const n of names) {
    const r = b[n];
    if (r.x < 0 || r.y < 0 || r.x + r.w > K.W_CSS || r.y + r.h > K.H_CSS - K.SAFE_BOTTOM + 0.5) { inScreen = false; bad = n; }
  }
  ok(inScreen, '所有按钮都在安全区内（含底部）', bad);
  let ov = null;
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (overlap(b[names[i]], b[names[j]])) ov = names[i] + '×' + names[j];
    }
  }
  ok(ov === null, '按钮互不重叠', ov);
  ok(b.home.y > b.skills.y + b.skills.h && b.home.y > b.retry.y + b.retry.h, 'home 在最后一排之下（不抢"再来一局"的手）');
  ok(b.home.w === b.doubleUp.w && b.home.x === b.doubleUp.x, 'home 占满整行');
  ok(b.retry.w === b.doubleUp.w && b.retry.h >= Math.max(b.doubleUp.h, b.skills.h), '"再来一局"占满整行、是最高的一颗');
}

/* ---------- 2. 点击回到主界面 ---------- */
console.log('=== 2. 点 home → 主界面 ===');
{
  K.finishRun();
  ok(K.state === 'over', '先进入结算页', K.state);
  K.overT = 1;                       // 跳过 0.35s 的防误触
  const b = K.overBtns();
  const h = b.home;
  K.onTouchStart({ changedTouches: [{ identifier: 1, clientX: h.x + h.w / 2, clientY: h.y + h.h / 2 }] });
  ok(K.state === 'ready', '回到主界面', K.state);

  ok(K.enemies.length === 0, '场上没有残留敌人', K.enemies.length);
  ok(K.parts.length === 0 && K.stains.length === 0 && K.armorBits.length === 0, '碎屑与残迹清空');
  ok(K.score === 0 && K.gameTime === 0, '分数与计时归零');
  ok(Math.abs(K.P.x - K.WORLD / 2) < 0.01 && Math.abs(K.P.y - K.WORLD / 2) < 0.01, '主角回到环形世界中心');

  // 标题页不刷怪：跑 3 秒看看
  step(180);
  ok(K.enemies.length === 0, '停在主界面 3 秒也不会自己刷怪', K.enemies.length);
  ok(K.state === 'ready', '仍然是主界面', K.state);
}

/* ---------- 3. 主界面点一下开新局 ---------- */
console.log('=== 3. 主界面点一下 = 新的一局 ===');
{
  K.onTouchStart({ changedTouches: [{ identifier: 2, clientX: 100, clientY: 500 }] });
  ok(K.state === 'talk', '点了先放开场（背景故事）', K.state);
  const sk = K.talkSkipBtn();
  K.onTouchStart({ changedTouches: [{ identifier: 3, clientX: sk.x + 10, clientY: sk.y + 10 }] });
  ok(K.state === 'play', '跳过开场：开始新局', K.state);
  ok(K.score === 0, '分数从 0 开始');
  step(120);
  ok(K.state === 'play', '2 秒后仍在战斗');
  ok(K.enemies.length > 0, '新局正常刷怪', K.enemies.length);
}

/* ---------- 4. 渲染不炸 ---------- */
console.log('=== 4. 结算页渲染 ===');
{
  K.finishRun();
  let err = null;
  try { step(40); } catch (e) { err = e.message; }
  ok(!err, '结算页连续渲染 40 帧无异常', err);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
