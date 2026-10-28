/* 一直跑甩不掉怪
   场上最多 maxEnemies 只，玩家又比所有怪都快：一直朝一个方向跑，身后拖出一串追不上的怪，
   名额被占满后什么都刷不出来，前面空无一物。这里让玩家无敌、按住方向一直跑 120 秒：
   1) 跑了 60 秒以后，前方照样有怪堵路（每一秒都有）
   2) 跑的过程中照样会撞上怪（无敌穿过，计次数）
   3) 收掉的怪当时在感知外（view × 1.9 外，黑暗里连核都看不见），不会在眼前凭空消失
   4) 补出来的怪落在光外，而且在前进方向上
   5) 站着不动打的时候一只都不收 */
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
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => simT },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
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
      get P(){ return P; }, get enemies(){ return enemies; }, get view(){ return view; },
      get gameTime(){ return gameTime; }, get runKills(){ return runKills; }, get state(){ return state; },
      CFG, wdist, wdelta, start, update,
      move(x, y) { tMove.x = x; tMove.y = y; }
    };
  `, sb);
  return sb.__K;
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

// 跑 sec 秒（无敌，不挥刀），方向 (mx, my)；每帧记下谁没了、谁是新来的
function run(K, sec, mx, my) {
  const dt = 1 / 60, len = Math.hypot(mx, my) || 1;
  const hx = mx / len, hy = my / len;
  const r = {
    secs: 0, blockedSecs: 0, hits: 0,
    gone: 0, goneSeen: 0, born: 0, bornLit: 0, bornAhead: 0
  };
  const touching = new Set();
  let prev = new Map(), blockedThisSec = false, secT = 0;
  K.move(mx, my);
  for (let f = 0; f < sec * 60; f++) {
    K.P.inv = 9;
    const vPrev = K.view;
    K.update(dt);
    if (K.state !== 'play') break;

    const now = new Map();
    let removedHere = 0;
    for (const e of K.enemies) {
      const dx = K.wdelta(e.x - K.P.x), dy = K.wdelta(e.y - K.P.y);
      now.set(e, { dx, dy, d: Math.hypot(dx, dy) });
    }
    for (const [e, p] of prev) {
      if (now.has(e)) continue;
      removedHere++;
      r.gone++;
      if (p.d < vPrev * 1.9) r.goneSeen++;
    }
    for (const [e, p] of now) {
      if (prev.has(e)) continue;
      // 只看和"收掉"同一帧冒出来的：那些是补位，不是常规刷怪。
      // 前哨本来就刷在光的内缘（讲解员要让人看见），不算
      if (!removedHere || e.scout > 0) continue;
      r.born++;
      if (p.d < K.view * 1.15) r.bornLit++;
      const cos = (p.dx * hx + p.dy * hy) / (p.d || 1);
      if (cos > 0.5) r.bornAhead++;         // 前进方向左右 60° 以内
    }
    prev = now;

    if (K.gameTime >= 60) {
      for (const [e, p] of now) {
        const cos = (p.dx * hx + p.dy * hy) / (p.d || 1);
        if (p.d < K.view * 1.5 && cos > 0.5) blockedThisSec = true;
        const hit = p.d < K.P.r + e.r;
        if (hit && !touching.has(e)) { r.hits++; touching.add(e); }
        if (!hit) touching.delete(e);
      }
      secT += dt;
      if (secT >= 1) {
        r.secs++; if (blockedThisSec) r.blockedSecs++;
        secT -= 1; blockedThisSec = false;
      }
    }
  }
  return r;
}

console.log('=== 1. 一直朝一个方向跑 120 秒 ===');
{
  const K = makeEnv();
  K.CFG.lightT0 = Infinity; K.CFG.candyShow = -1e9;   // 光不掉、糖和门都不出来（2.11 节）：这里只测逃跑会不会被追上（直着跑会绕地图好几圈，碰巧撞开门就弹刀诀了）
  K.start();
  const r = run(K, 120, 1, 0.37);
  console.log('    60~120 秒：' + r.blockedSecs + '/' + r.secs + ' 秒前方有怪，撞上 ' + r.hits + ' 次；收掉 ' + r.gone + ' 只');
  ok(r.secs >= 59, '真的跑满了 120 秒', K.gameTime.toFixed(1));
  ok(r.blockedSecs >= r.secs - 1, '60 秒以后每一秒前方都有怪', r.blockedSecs + '/' + r.secs);
  ok(r.hits >= 20, '后 60 秒照样一路撞上怪', r.hits);
  ok(r.gone > 0, '甩掉的怪会被收回去', r.gone);
  ok(r.goneSeen === 0, '收掉的怪都在感知外（view × 1.9），不会在眼前凭空消失', r.goneSeen + '/' + r.gone);
  ok(r.born > 0 && r.bornLit === 0, '补出来的怪都在光外（≥ view × 1.15）', r.bornLit + '/' + r.born);
  ok(r.born > 0 && r.bornAhead >= r.born * 0.95, '补出来的怪落在前进方向上', r.bornAhead + '/' + r.born);
}

console.log('\n=== 2. 绕着斜线跑也一样 ===');
{
  const K = makeEnv();
  K.CFG.lightT0 = Infinity; K.CFG.candyShow = -1e9;   // 光不掉、糖和门都不出来（2.11 节）：这里只测逃跑会不会被追上（直着跑会绕地图好几圈，碰巧撞开门就弹刀诀了）
  K.start();
  const r = run(K, 120, 1, 1);
  console.log('    60~120 秒：' + r.blockedSecs + '/' + r.secs + ' 秒前方有怪，撞上 ' + r.hits + ' 次');
  ok(r.blockedSecs >= r.secs - 1, '45° 斜跑，60 秒以后每一秒前方都有怪', r.blockedSecs + '/' + r.secs);
}

console.log('\n=== 3. 站着不动 ===');
{
  const K = makeEnv();
  K.CFG.lightT0 = Infinity; K.CFG.candyShow = -1e9;   // 光不掉、糖和门都不出来（2.11 节）：这里只测逃跑会不会被追上（直着跑会绕地图好几圈，碰巧撞开门就弹刀诀了）
  K.start();
  const r = run(K, 60, 0, 0);
  ok(r.gone === 0, '站桩时怪都围上来了，一只都不收', r.gone);
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
