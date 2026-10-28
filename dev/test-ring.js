/* 视野环已去掉
   原先视野边界有一圈跟着拍子闪的淡蓝环（三层描边），现在去掉了：
   1) 游戏中任何一帧都不再画淡蓝的整圈描边
   2) 暗红的斩杀圈照常画，半径 = POW.autoReach
   3) 亮区 = 斩杀圈：暗场在圈上过渡，圈里的怪画本体，圈外只剩核；延锋把圈撑大，光跟着大
   4) 整个渲染过程 shadowBlur 从未被设为非 0
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv() {
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }

  let raf = null; let simT = 1000;
  const ac = {
    // 音频时钟和模拟帧同步推进，这样"视觉踩拍"才测得出来
    get currentTime() { return simT / 1000; },
    sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };

  // 记录描边：每次 stroke 记下当时的半径 / 线宽 / 透明度
  const strokes = [], fills = [], grads = [], images = [];
  let lastArcR = 0, shadowUsed = false;
  const state = { globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '', shadowBlur: 0 };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === 'arc') return (x, y, r) => { lastArcR = r; };
      if (k === 'stroke') return () => { strokes.push({ r: lastArcR, lw: t.lineWidth, a: t.globalAlpha, c: t.strokeStyle }); };
      if (k === 'fill') return () => { fills.push({ r: lastArcR, a: t.globalAlpha, c: t.fillStyle }); };
      if (k === 'createRadialGradient') {
        return (x0, y0, r0, x1, y1, r1) => {
          const g = { r1, stops: [], addColorStop(at, c) { this.stops.push([at, c]); } };
          grads.push(g);
          return g;
        };
      }
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'drawImage') return function () { images.push(Array.from(arguments).slice(1)); };
      if (k in t) return t[k];
      return function () {};
    },
    set(t, k, v) {
      if (k === 'shadowBlur' && v > 0) shadowUsed = true;
      t[k] = v; return true;
    }
  });

  const canvas = {
    width: 0, height: 0, clientWidth: 390, clientHeight: 844,
    getContext: () => ctx,
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
  vm.runInContext(`globalThis.__K = {
    get view(){return view;}, set view(v){view=v;},
    get state(){return state;}, set state(v){state=v;},
    get P(){return P;},
    get epoch(){return S.bgmEpoch;}, get acNow(){return S.ac ? S.ac.currentTime : -1;},
    get bgmOn(){return S.bgmOn();},
    get reach(){return POW.autoReach;}, get POW(){return POW;}, get enemies(){return enemies;},
    lightR, litAt, spawnEnemy,
    BGM_BPM, start, CFG
  };`, sb);
  return {
    K: sb.__K, strokes, fills, grads, images,
    run: code => vm.runInContext(code, sb),
    step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } },
    shadowUsed: () => shadowUsed
  };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

const E = makeEnv();
E.step(30);
E.K.start();
E.run('RRG.off = true;');   // 斩杀圈平时是先画进贴图再贴；这里关掉贴图，直接检查矢量画法的半径 / 虚线
E.step(10);

const blue = s => s.c === 'rgb(150,224,255)' && s.r > 100;   // 原视野环的颜色和尺度
const red = s => s.c === 'rgb(255,106,92)';                       // 斩杀圈

console.log('=== 1. 视野环不再出现 ===');
// 跑满两个小节（原来的环每小节亮一次），每一帧都检查
const FRAMES = Math.round((60 / E.K.BGM_BPM) * 8 * 60);
let blueFrames = 0, redFrames = 0, redR = 0;
for (let i = 0; i < FRAMES; i++) {
  E.strokes.length = 0;
  E.step(1);
  if (E.strokes.some(blue)) blueFrames++;
  const r = E.strokes.filter(red);
  if (r.length) { redFrames++; redR = r[0].r; }
}
ok(blueFrames === 0, FRAMES + ' 帧里没有一帧画淡蓝整圈', blueFrames + ' 帧');

console.log('\n=== 2. 斩杀圈照常画 ===');
ok(redFrames === FRAMES, '每一帧都画了暗红斩杀圈', redFrames + '/' + FRAMES);
ok(Math.abs(redR - E.K.reach) < 0.01, '斩杀圈半径 = POW.autoReach（' + E.K.reach + '）', redR);

console.log('\n=== 2b. 贴图版：每帧贴一次、贴在主角身上、大小对 ===');
{
  E.run('RRG.off = false; RRG.c = null;');
  E.step(1);
  const half = E.K.reach + 16;
  let okFrames = 0;
  for (let i = 0; i < 30; i++) {
    E.images.length = 0;
    E.step(1);
    const P = E.K.P;
    const hit = E.images.filter(a => a.length === 4 && Math.abs(a[2] - half * 2) < 2 && Math.abs(a[0] + a[2] / 2 - P.x) < 0.5 && Math.abs(a[1] + a[3] / 2 - P.y) < 0.5);
    if (hit.length === 1) okFrames++;
  }
  ok(okFrames === 30, '30 帧每帧都把斩杀圈贴图贴在主角身上一次，边长 = 2 ×（半径 + 16）', okFrames);
  ok(E.run('RRG.r') === E.K.reach, '贴图按当前斩杀距离画的', E.run('RRG.r'));
  E.run('POW.autoReach *= 1.05;'); E.step(2);
  ok(E.run('RRG.r') !== E.K.reach, '半径只差 5%：不重画，拿原图缩放', E.run('RRG.r'));
  E.run('POW.autoReach *= 1.2;'); E.step(2);
  ok(Math.abs(E.run('RRG.r') - E.K.reach) < 0.01, '差一成以上：重画一张', E.run('RRG.r') + ' / ' + E.K.reach);
  E.run('POW.autoReach = CFG.autoReach; RRG.off = true;');
}

console.log('\n=== 3. 亮区 = 斩杀圈 ===');
{
  const K = E.K, L = K.reach;
  E.run('spawnTimer = 1e9; enemies.length = 0; crystals.length = 0;');
  ok(K.lightR() === L, '亮区半径 = 斩杀圈（' + L + '），不再跟 view（' + K.view.toFixed(0) + '）走', K.lightR());
  ok(K.litAt(L * 0.7) === 1 && Math.abs(K.litAt(L) - 0.5) < 1e-9 && K.litAt(L * 1.25) === 0,
     '圈里 0.8 倍以内全亮、圈线上一半、出圈 0.2 倍全黑');

  // 默认不画暗场遮罩和暗角（抖音真机上时有时无，看着就是"斩完屏幕暗一下"，见 CFG.veil）
  const isDark = g => g.stops.some(st => /^rgba\(2,5,10,/.test(st[1]));
  const isVig = g => g.stops.some(st => st[1] === E.run('THEME.vigOuter'));
  E.grads.length = 0; E.step(1);
  ok(E.run('CFG.veil') === false && !E.grads.some(isDark) && !E.grads.some(isVig), '默认：局内不画暗场遮罩、也不画暗角');

  // 遮罩打开时的样子（代码留着）：外径 1.25 圈；0.8 圈以内透明，往外单调变黑，最外 0.94
  E.run('CFG.veil = true;');
  E.grads.length = 0; E.step(1);
  const dark = E.grads.filter(isDark)[0];
  const alpha = st => parseFloat(st[1].split(',')[3]);
  ok(dark && Math.abs(dark.r1 - L * 1.25) < 0.01, '暗场渐变外径 = 斩杀圈 × 1.25', dark && dark.r1);
  ok(dark && dark.stops.filter(st => st[0] * 1.25 <= 0.8).every(st => alpha(st) === 0), '圈的 0.8 倍以内完全不压暗');
  ok(dark && dark.stops.every((st, i) => i === 0 || alpha(st) >= alpha(dark.stops[i - 1])) &&
     alpha(dark.stops[dark.stops.length - 1]) === 0.94, '往外单调变黑，最外 0.94');

  // 一只怪放在圈里、一只放在圈外（但还在感知范围里）：圈里画本体，圈外只画核
  const P = K.P;
  const inE = K.spawnEnemy(P.x + L * 0.6, P.y);
  const outE = K.spawnEnemy(P.x - L * 1.5, P.y);
  inE.born = outE.born = 1;
  E.strokes.length = 0; E.fills.length = 0;
  E.run('state = "play"; hitstop = 0;');
  E.step(1);
  const bodies = E.strokes.filter(st => st.c === 'rgba(255,59,74,0.9)');   // 普通怪的轮廓色（THEME.foe.grunt）
  const cores = E.fills.filter(f => f.c === '#ff3b4a' && f.a > 0.05);
  ok(bodies.length === 1, '只有圈里那只画了本体（' + bodies.length + '）');
  ok(cores.length >= 1, '圈外那只画了核（' + cores.length + ' 笔）');
  ok(K.view * 1.9 > L * 1.5, '圈外那只仍在感知范围内（感知 ' + (K.view * 1.9).toFixed(0) + '）');

  // 延锋：斩杀圈变大，亮区跟着变大
  K.POW.autoReach = L * 1.3;
  E.grads.length = 0; E.step(1);
  const dark2 = E.grads.filter(g => g.stops.some(st => /^rgba\(2,5,10,/.test(st[1])))[0];
  ok(K.lightR() === L * 1.3 && dark2 && Math.abs(dark2.r1 - L * 1.3 * 1.25) < 0.01, '斩杀圈变大，亮区跟着变大');
  K.POW.autoReach = L;
  E.run('CFG.veil = false;');
}

console.log('\n=== 4. 没有开启 shadowBlur ===');
ok(E.shadowUsed() === false, '整个渲染过程 shadowBlur 从未被设为非 0');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
