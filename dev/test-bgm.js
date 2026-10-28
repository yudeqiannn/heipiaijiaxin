/* BGM 节奏体检 v2：
   1) 排拍间隔是否稳定在 16 分音符（98.7ms）
   2) 主线程卡顿后，拍子会不会被挤到一起 / 会不会补拍
   3) 心跳是否严格落在曲子的网格线上（偏移应为 0）
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function param() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }; }
function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }

const T0 = Date.now();
const ac = {
  get currentTime() { return (Date.now() - T0) / 1000; },   // 音频时钟 = 真实时间
  sampleRate: 44100, state: 'running', destination: node(),
  createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
  createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }),
  resume() {}
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
const handlers = {};
const tt = {
  createCanvas: () => canvas,
  getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 40, bottom: 830 } }),
  onTouchStart: cb => handlers.start = cb, onTouchMove: cb => handlers.move = cb,
  onTouchEnd: cb => handlers.end = cb, onTouchCancel: () => {},
  getStorageSync: () => null, setStorageSync() {},
  createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
  createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
  shareAppMessage() {}
};
let raf = null;
const sb = {
  tt, console, setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
  Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'x' }
};
sb.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: 844 };
sb.document = { getElementById: () => canvas, addEventListener() {}, visibilityState: 'visible' };
vm.createContext(sb);
vm.runInContext(src, sb, { filename: 'game.js' });
vm.runInContext('globalThis.__S=S;', sb);
const S = sb.__S;

const STEP = 60 / 152 / 4;
const beats = [];      // 排出去的 BGM 拍：{st, t, now}
const thumps = [];     // 心跳：{t, now}

const origVoice = S.bgmVoice.bind(S);
S.bgmVoice = function (st, t) { beats.push({ st, t, now: ac.currentTime }); return origVoice(st, t); };
const origThump = S.thump.bind(S);
S.thump = function (v, when) { thumps.push({ t: typeof when === 'number' ? when : ac.currentTime, now: ac.currentTime }); return origThump(v, when); };

S.init();
S.setHeart(0.6);          // 中等危险 → 8 个 16 分 = 76 BPM
S.bgmStart();

// 模拟真实渲染负载：每 16.7ms 忙 8ms；第 90~100 帧插一次 180ms 大卡顿
let frame = 0;
const iv = setInterval(() => {
  frame++;
  S.setHeart(0.6);        // 每帧递一次危险度（和游戏里一样）
  const stall = (frame >= 90 && frame <= 100) ? 180 : 8;
  const until = Date.now() + stall;
  while (Date.now() < until) { /* busy */ }
}, 16.7);

setTimeout(() => {
  clearInterval(iv);
  S.bgmStop();

  const dur = (Date.now() - T0) / 1000;

  console.log('=== 1. 排拍间隔（理论 ' + (STEP * 1000).toFixed(1) + ' ms）===');
  const d = [];
  for (let i = 1; i < beats.length; i++) d.push((beats[i].t - beats[i - 1].t) * 1000);
  const bad = d.filter(x => Math.abs(x - STEP * 1000) > 1);
  console.log('排了', beats.length, '拍 /', dur.toFixed(1), 's（理论', Math.round(dur / STEP), '拍）');
  console.log('间隔偏差 >1ms 的拍子:', bad.length, '个');
  if (bad.length) {
    d.forEach((x, i) => { if (Math.abs(x - STEP * 1000) > 1) console.log('  #' + (i + 1), x.toFixed(1) + 'ms'); });
  }
  // 步进是否连续（断步 = 漏了一拍）
  const gaps = [];
  for (let i = 1; i < beats.length; i++) {
    if (beats[i].st !== (beats[i - 1].st + 1) % 32) gaps.push(i);
  }
  console.log('漏拍/跳步:', gaps.length, '处');

  const late = beats.filter(b => b.t < b.now).length;
  console.log('排到"过去时间"的拍子:', late, '个（>0 会被挤成立即播放）');

  console.log('\n=== 2. 卡顿恢复 ===');
  // 找 180ms 卡顿之后最密的一串拍子
  let minGap = Infinity, at = -1;
  for (let i = 1; i < beats.length; i++) {
    const gap = (beats[i].t - beats[i - 1].t) * 1000;
    if (gap < minGap) { minGap = gap; at = i; }
  }
  console.log('最小相邻间隔:', minGap.toFixed(1), 'ms（应为', (STEP * 1000).toFixed(1), '）');

  console.log('\n=== 3. 心跳与网格的对齐度 ===');
  const t0 = beats[0].t;
  const offs = thumps.map(x => {
    const k = Math.round((x.t - t0) / STEP);
    return Math.abs((x.t - t0) - k * STEP) * 1000;
  });
  const spacing = [];
  for (let i = 1; i < thumps.length; i++) spacing.push((thumps[i].t - thumps[i - 1].t) * 1000);
  console.log('心跳', thumps.length, '次 | 离最近网格线：最大', Math.max(0, ...offs).toFixed(3), 'ms');
  console.log('心跳平均间隔:', (spacing.reduce((a, b) => a + b, 0) / spacing.length).toFixed(1), 'ms =',
    (60 / (spacing.reduce((a, b) => a + b, 0) / spacing.length)).toFixed(1), 'BPM');
  console.log('落格内(<1ms)占比:', (offs.filter(x => x < 1).length / offs.length * 100).toFixed(0) + '%');
  process.exit(0);
}, 5000);
