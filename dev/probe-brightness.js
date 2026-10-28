// 轻量亮度探针：不建真 canvas、不读像素，只算"主角那块亮区被暗角压掉了多少"
// （旧版每帧 getImageData + 存 PNG，把服务器跑挂过，别再用那种做法）
// 用法：timeout 60 nice -n 19 node --max-old-space-size=256 dev/probe-brightness.js [秒数=30] [种子=1]
'use strict';
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');
const SECS = Math.min(+(process.argv[2] || 30), 120);
let seed = (+(process.argv[3] || 1)) * 2654435761 >>> 0;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const M = Object.create(Math); M.random = rnd;

const CW = 390, CH = 844;
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    return t[k] !== undefined ? t[k] : function () {};
  },
  set(t, k, v) { t[k] = v; return true; }
});
const cv = { width: 0, height: 0, clientWidth: CW, clientHeight: CH, getContext: () => ctxStub,
  addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CW, height: CH }) };
const handlers = {}, storage = {};
const audioStub = () => ({ play() {}, stop() {}, pause() {}, seek() {}, destroy() {}, onError() {}, onCanplay() {}, onEnded() {}, offError() {}, offCanplay() {}, src: '', loop: false, volume: 1 });
const tt = {
  createCanvas: () => cv,
  getWindowInfo: () => ({ pixelRatio: 1, windowWidth: CW, windowHeight: CH, safeArea: { top: 34, bottom: 830 } }),
  onTouchStart: cb => { handlers.start = cb; }, onTouchMove: cb => { handlers.move = cb; },
  onTouchEnd: cb => { handlers.end = cb; }, onTouchCancel: cb => { handlers.cancel = cb; },
  getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
  createInnerAudioContext: audioStub, setInnerAudioOption() {},
  setKeepScreenOn() {}, onHide() {}, onShow() {}, onAudioInterruptionBegin() {}, onAudioInterruptionEnd() {},
  createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
  shareAppMessage() {}, showShareMenu() {}, onShareAppMessage() {}, vibrateShort() {}
};
let raf = null, simT = 1000;
const sb = {
  tt, console, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  performance: { now: () => simT },
  requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
  Math: M, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'headless' }
};
sb.window = { devicePixelRatio: 1, addEventListener() {}, innerWidth: CW, innerHeight: CH };
sb.document = { getElementById: () => cv, addEventListener() {}, visibilityState: 'visible' };
vm.createContext(sb);
vm.runInContext(src, sb, { filename: 'game.js' });
vm.runInContext(`globalThis.__Z = {
  get state(){return state}, get enemies(){return enemies}, get P(){return P}, get cam(){return cam},
  get W(){return W}, get H(){return H}, lightR, vigOn: typeof vignetteOn === 'function' ? vignetteOn : () => true,
  start(){ start(); }
};`, sb);
const Z = sb.__Z;
const touch = (id, x, y) => ({ changedTouches: [{ identifier: id, clientX: x, clientY: y }], touches: [] });

// 暗角在离镜头 d 处的不透明度（和 drawBackground 里的渐变同一条线）
function vigA(d) {
  const r0 = Math.min(Z.W, Z.H) * 0.25, r1 = Math.max(Z.W, Z.H) * 0.75;
  return 0.86 * Math.max(0, Math.min(1, (d - r0) / (r1 - r0)));
}

// 机器人：游走 + 一直按住斩
const WORLD = 4500, wd = d => d - WORLD * Math.round(d / WORLD);
let wander = rnd() * Math.PI * 2;
Z.start();
handlers.start(touch(1, 120, 500));
handlers.start(touch(2, 316, 756));
const frames = SECS * 60, DIP = 0.08;
let n = 0, over = 0, dips = 0, max = 0, prev = 0;
for (let f = 0; f < frames && Z.state === 'play'; f++) {
  if (f % 60 === 0) wander += (rnd() - 0.5) * 1.6;
  if (f % 8 === 0) handlers.move(touch(1, 120 + Math.cos(wander) * 66, 500 + Math.sin(wander) * 66));
  const cb = raf; raf = null; simT += 16.7; cb(simT);
  // 亮区中心（主角）和亮区朝外那一侧边缘各被暗角压掉多少
  const P = Z.P, c = Z.cam;
  const off = Math.hypot(wd(P.x - c.x), wd(P.y - c.y));
  const a = Z.vigOn() ? vigA(off + Z.lightR() * 0.8) : 0;
  n++; if (a > DIP) over++; if (a > DIP && prev <= DIP) dips++; if (a > max) max = a; prev = a;
}
console.log(`帧 ${n}  亮区被暗角压暗>${DIP * 100}% 的帧 ${(over / n * 100).toFixed(1)}%  次数 ${dips}（每分钟 ${(dips / (n / 3600)).toFixed(1)}）  最深 ${(max * 100).toFixed(0)}%`);
process.exit(0);
