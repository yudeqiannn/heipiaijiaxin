/* 余光清空按钮（测试用）
   1) 布局：和「重置技能」并排各半，不重叠、不出屏
   2) 两次确认：第一下不生效，第二下才清，超时自动撤销
   3) 只清余光，不动技能等级、不动累计分
   4) 清空后确实写进存档，重启不会复活
   5) 技能页三种状态都能画
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
  vm.runInContext(`globalThis.__K = {
    get state(){return state;}, set state(v){ state = v; },
    get meta(){return meta;}, set meta(v){},
    skillLayout, skillTap, clearYingArmed, clearYing, render,
    CFG, meta, W_CSS, H_CSS, SAFE_TOP,
    __storage: null
  };`, sb);
  sb.__K.__storage = storage;
  return { K: sb.__K, storage, step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } }, tick: ms => { simT += ms; } };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
const R = (b) => ({ clientX: b.x + b.w / 2, clientY: b.y + b.h / 2 });
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

const env = makeEnv(), K = env.K;
env.step(20);
K.meta.pts = 1234;
K.meta.total = 9999;
K.meta.lv = { reach: 3, keep: 2 };
K.state = 'skills';
env.step(2);

/* ---------- 1. 布局 ---------- */
console.log('=== 1. 布局 ===');
{
  const L = K.skillLayout();
  ok(!!L.clearYing, '布局里有 clearYing 按钮');
  ok(!overlap(L.clearYing, L.reset), '与「重置技能」不重叠');
  ok(!overlap(L.clearYing, L.back), '与「返回」不重叠');
  ok(Math.abs(L.clearYing.y - L.reset.y) < 0.5, '与重置按钮同一行');
  ok(Math.abs(L.clearYing.w - L.reset.w) < 0.5, '两个按钮等宽', L.clearYing.w.toFixed(1));
  ok(Math.abs((L.reset.w + L.clearYing.w + 10) - L.cw) < 0.5, '两个按钮加间隙正好占满一行');
  ok(L.clearYing.x + L.clearYing.w <= K.W_CSS + 0.5, '右边界不出版面');
  ok(L.clearYing.y + L.clearYing.h <= K.H_CSS, '底边界不出版面',
    (L.clearYing.y + L.clearYing.h).toFixed(1) + ' / ' + K.H_CSS);
  ok(L.clearYing.h >= 30, '按钮高度够手指点', L.clearYing.h);
}

/* ---------- 2. 两次确认 ---------- */
console.log('=== 2. 两次确认 ===');
{
  const L = K.skillLayout();
  ok(!K.clearYingArmed(), '初始不是待确认态');
  K.skillTap(R(L.clearYing));
  ok(K.meta.pts === 1234, '第一下不清空', K.meta.pts);
  ok(K.clearYingArmed(), '第一下进入待确认态');

  env.tick(1200);
  K.skillTap(R(L.clearYing));
  ok(K.meta.pts === 0, '确认后清空余光', K.meta.pts);
  ok(!K.clearYingArmed(), '清完退出确认态');
}

/* ---------- 3. 超时自动撤销 ---------- */
console.log('=== 3. 超时自动撤销 ===');
{
  K.meta.pts = 800;
  const L = K.skillLayout();
  K.skillTap(R(L.clearYing));
  ok(K.clearYingArmed() && K.meta.pts === 800, '进入确认态且未清');
  env.tick(3300);                         // 超过 3 秒
  ok(!K.clearYingArmed(), '超时后退出确认态');
  K.skillTap(R(L.clearYing));
  ok(K.meta.pts === 800, '超时后那一下只是重新进入确认态，不会清掉', K.meta.pts);
  ok(K.clearYingArmed(), '超时后又进入确认态');
  env.tick(300);
  K.skillTap(R(L.clearYing));
  ok(K.meta.pts === 0, '紧接着第二下才清空');
}

/* ---------- 4. 只清余光 ---------- */
console.log('=== 4. 只清余光，不动别的 ===');
{
  K.meta.pts = 500;
  const L = K.skillLayout();
  K.skillTap(R(L.clearYing));
  env.tick(200);
  K.skillTap(R(L.clearYing));
  ok(K.meta.lv.reach === 3 && K.meta.lv.keep === 2, '技能等级保持不变',
    JSON.stringify(K.meta.lv));
  ok(K.meta.total === 9999, '累计得分不受影响', K.meta.total);
}

/* ---------- 5. 写进存档 ---------- */
console.log('=== 5. 存档 ===');
{
  const raw = env.storage['dash_meta_v1'];
  ok(typeof raw === 'string' && raw.length > 0, '存档已写入');
  const saved = JSON.parse(raw || '{}');
  ok(saved.pts === 0, '存档里的余光为 0', saved.pts);
  ok(saved.lv && saved.lv.reach === 3, '存档里技能等级还在');
}

/* ---------- 6. 渲染 ---------- */
console.log('=== 6. 渲染 ===');
{
  let err = null;
  try {
    K.state = 'skills';
    env.step(3);                          // 普通态
    K.meta.pts = 300;
    const L = K.skillLayout();
    K.skillTap(R(L.clearYing));           // 待确认态
    env.step(3);
    env.tick(1400);
    env.step(3);                          // 确认态计数在走
    K.skillTap(R(L.clearYing));           // 清完
    env.step(3);
  } catch (e) { err = e; }
  ok(!err, '技能页三种状态都能画', err && err.message);
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
