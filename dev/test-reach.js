/* 斩杀距离虚线测试
   1) 半径 = POW.autoReach，亮区边缘就落在这圈上（看得见 = 砍得到）
   2) 是虚线：36 段弧，每段只占 58%，不是一整圈
   3) 半透明红色，安静不发亮：没有目标时亮度恒定，不闪
   4) 有目标进圈时亮一档，离开后落回原亮度
   5) 不开启 shadowBlur
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv() {
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }

  let raf = null; let simT = 1000;
  const ac = {
    get currentTime() { return simT / 1000; },
    sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };

  const arcs = [];        // 每次 arc 记录 {r, from, to}
  const strokes = [];     // 每次 stroke 记录当时的状态
  let shadowUsed = false;
  const st = { globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '', shadowBlur: 0, lineCap: '' };
  const ctx = new Proxy(st, {
    get(t, k) {
      if (k === 'arc') return (x, y, r, a0, a1) => { arcs.push({ r: r, from: a0, to: a1 }); };
      if (k === 'stroke') return () => { strokes.push({ r: arcs.length ? arcs[arcs.length - 1].r : 0, lw: t.lineWidth, a: t.globalAlpha, c: t.strokeStyle }); };
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return function () {};
    },
    set(t, k, v) { if (k === 'shadowBlur' && v > 0) shadowUsed = true; t[k] = v; return true; }
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
    get state(){return state;}, set state(v){state=v;},
    get P(){return P;}, get reach(){return POW.autoReach;}, get view(){return view;}, lightR,
    get enemies(){return enemies;}, get crystals(){return crystals;}, get glow(){return reachGlow;}, set glow(v){reachGlow=v;},
    CFG, start, RRG,
    set spawnTimer(v){ spawnTimer = v; }, set spawn(v){ spawnTimer = v; }
  };`, sb);
  return {
    K: sb.__K, arcs, strokes,
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
const K = E.K;

// 只取斩杀线那一笔：颜色是 rgb(255,106,92)
function reachStrokes() { return E.strokes.filter(s => s.c === 'rgb(255,106,92)'); }
function reachArcs() { return E.arcs.filter(a => Math.abs(a.r - K.reach) < 0.01); }

E.step(30);
ok(reachStrokes().length === 0, '开始页不画斩杀线（还没进战斗）', reachStrokes().length);

K.start();
K.RRG.off = true;   // 斩杀圈平时是贴图；这里直接检查矢量画法（半径 / 36 段虚线）
K.CFG.spawnBase = 1e6; K.CFG.spawnMin = 1e6; K.spawnTimer = 1e6;
K.enemies.length = 0;
K.crystals.length = 0;      // 开局那几根柱子也会点亮斩杀线，这里先清掉量基线
E.step(6);

console.log('\n=== 1. 半径 = 斩杀距离，亮区边缘就是它 ===');
E.arcs.length = 0; E.strokes.length = 0;
E.step(1);
const one = reachStrokes();
ok(one.length === 1, '一帧只画一笔（整圈一次 stroke）', one.length);
ok(Math.abs(one[0].r - K.reach) < 0.5, '半径 = POW.autoReach（' + K.reach.toFixed(0) + '）', one[0].r.toFixed(1));
ok(K.lightR() === K.reach, '亮区半径 = 斩杀圈（' + K.reach.toFixed(0) + '）', K.lightR());

console.log('\n=== 2. 是虚线 ===');
const da = reachArcs();
ok(da.length === 36, '一圈 36 段弧', da.length);
const spans = da.map(a => a.to - a.from);
const avg = spans.reduce((x, y) => x + y, 0) / spans.length;
const expect = (Math.PI * 2 / 36) * 0.58;
ok(spans.every(s => Math.abs(s - expect) < 1e-9), '每段只画 ' + (expect / (Math.PI * 2 / 36) * 100).toFixed(0) + '%（留出空隙）', avg.toFixed(4));
ok(avg * 36 < Math.PI * 2 * 0.7, '总弧长不到整圈的 70%（否则就不是虚线了）', (avg * 36 / (Math.PI * 2)).toFixed(2));

console.log('\n=== 3. 半透明红色、安静不闪 ===');
ok(one[0].c === 'rgb(255,106,92)', '颜色是暗红 255,106,92', one[0].c);
ok(one[0].a > 0.18 && one[0].a < 0.32, '没有目标时 alpha 0.18~0.32（半透明）', one[0].a.toFixed(3));
ok(one[0].lw < 2.2, '细线 <2.2px', one[0].lw.toFixed(1));
const seq = [];
for (let i = 0; i < 90; i++) {
  E.strokes.length = 0; E.step(1);
  const s = reachStrokes()[0]; if (s) seq.push(s.a);
}
const dmax = Math.max(...seq) - Math.min(...seq);
ok(dmax < 0.001, '1.5 秒内亮度零变化（不像视野环那样跟着拍子闪）', dmax.toFixed(5));

console.log('\n=== 4. 目标进圈时亮一档 ===');
K.enemies.length = 0;
K.enemies.push({ x: K.P.x + K.reach * 0.5, y: K.P.y, vx: 0, vy: 0, r: 12, sp: 0, heavy: false, charger: false, bomb: false, watch: false, hp: 1, cracked: false, armorT: 0, mode: 'walk', t: 0, cdx: 0, cdy: 0, score: 1, wob: 0, born: 1 });
E.step(40);
E.strokes.length = 0; E.step(1);
const hotA = reachStrokes()[0].a;
ok(hotA > 0.34, '敌人在圈内：alpha 升到 0.34 以上', hotA.toFixed(3));
ok(K.glow > 0.9, 'reachGlow 收敛到 1', K.glow.toFixed(2));

K.enemies.length = 0;
E.step(60);
E.strokes.length = 0; E.step(1);
const coldA = reachStrokes()[0].a;
ok(Math.abs(coldA - one[0].a) < 0.01, '敌人离开后落回原亮度', coldA.toFixed(3));

console.log('\n=== 5. 晶柱进圈也算"够得着" ===');
K.crystals.length = 0;
K.crystals.push({ x: K.P.x + K.reach * 0.5, y: K.P.y, r: 30, spin: 0, age: 9, ying: 25 });
E.step(40);
E.strokes.length = 0; E.step(1);
ok(reachStrokes()[0].a > 0.34, '晶柱在圈内：同样升到 0.34 以上（提示"这一刀下去能炸"）', reachStrokes()[0].a.toFixed(3));
K.crystals.length = 0;
E.step(60);

console.log('\n=== 6. 死亡后收刀，不再画 ===');
K.state = 'dead';
E.strokes.length = 0; E.step(1);
ok(reachStrokes().length === 0, '死亡页没有斩杀线', reachStrokes().length);

console.log('\n=== 7. 没有开启 shadowBlur ===');
ok(E.shadowUsed() === false, '整个渲染过程 shadowBlur 从未被设为非 0');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
