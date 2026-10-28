/* 重型甲环测试
   要求：
   1) 普通敌人身上没有环（本体轮廓之外不存在额外圆环）
   2) 重型满甲时，本体外面有一圈 r*1.62 的六段甲环 —— 全场唯一的环
   3) 第一刀：环碎成 6 块甲片飞出去，cracked = true
   4) 碎完（0.6 秒后）场上没有甲片，重型身上也不再有 r*1.62 的环
   5) 裂甲后仍是活的，第二刀才死
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
  let arcs = [];
  const canvas = {
    width: 0, height: 0, clientWidth: 390, clientHeight: 844,
    getContext: () => new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'arc') return (x, y, r) => { arcs.push(r); };
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
    get state(){return state;}, get P(){return P;}, get gameTime(){return gameTime;},
    enemies, armorBits, parts, CFG, start, update, crackEnemy, killEnemy, spawnEnemy, W, H,
    set spawnTimer(v){ spawnTimer = v; }
  };`, sb);
  return {
    K: sb.__K,
    frames: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } },
    record() { arcs = []; },
    arcs: () => arcs
  };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.6 : tol);

function quiet(K) {
  K.CFG.spawnBase = 1e6; K.CFG.spawnMin = 1e6;
  K.spawnTimer = 1e6;
  K.enemies.length = 0;
}

function mkEnemy(o) {
  return Object.assign({
    x: 0, y: 0, vx: 0, vy: 0, r: 12, sp: 60,
    heavy: false, charger: false, bomb: false, watch: false,
    hp: 1, cracked: false, armorT: 0, crackT: 0,
    mode: 'walk', t: 0, cdx: 0, cdy: 0, score: 1, wob: 0, born: 1
  }, o);
}

const env = makeEnv();
const K = env.K;
env.frames(30); K.start(); env.frames(2); quiet(K);
K.P.inv = 999;
K.P.x = K.W / 2; K.P.y = K.H / 2;

/* ---------- 1. 普通敌人：没有环 ---------- */
console.log('=== 1. 普通敌人身上没有多余的环 ===');
{
  const e = mkEnemy({ x: K.P.x + 80, y: K.P.y, r: 14, wob: 2.1 });
  K.enemies.push(e);
  env.record(); env.frames(1);
  const a = env.arcs();
  const body = a.filter(r => r > 10 && r < 30);
  ok(body.length >= 1, '本体轮廓还在（半径 ' + (body[0] || 0).toFixed(1) + '）');
  ok(!a.some(r => near(r, 14 * 1.62, 1)), '半径 1.62r 处没有任何环');
  K.enemies.length = 0;
}

/* ---------- 2. 重型满甲：外面一圈六段甲环 ---------- */
console.log('=== 2. 满甲重型：唯一带环的敌人 ===');
{
  const R = 24;
  const e = mkEnemy({ x: K.P.x + 90, y: K.P.y, r: R, heavy: true, hp: 2, score: 3 });
  K.enemies.push(e);
  ok(e.cracked === false && e.crackT === 0, '初始是满甲状态');

  env.record(); env.frames(1);
  const a = env.arcs();
  const ring = a.filter(r => near(r, R * 1.62, 0.8));
  ok(ring.length === 6, '甲环由 6 段圆弧组成', ring.length);
  ok(!a.some(r => near(r, R * 1.62 + 6, 1)), '环的位置在 1.62r，和身体分得开');

  /* ---------- 3. 第一刀：环碎 ---------- */
  console.log('=== 3. 第一刀：环碎成甲片飞走 ===');
  K.crackEnemy(e);
  ok(e.cracked === true, '第一刀后进入裂甲状态');
  ok(e.crackT > 0, '裂痕有 0.22 秒的亮起');
  ok(K.armorBits.length === 6, '碎成 6 块甲片', K.armorBits.length);
  ok(K.armorBits.every(b => near(b.r, R * 1.62, 2)), '甲片出生在原来环的位置上');
  ok(e.hp === 2 && K.enemies.length === 1, '它没有死，第二刀才算');

  env.frames(1);
  const drift = K.armorBits.map(b => b.r);
  ok(drift.some(r => r > R * 1.62), '甲片在往外散');

  // 碎完
  env.frames(40);
  ok(K.armorBits.length === 0, '0.6 秒后甲片散尽');

  /* ---------- 4. 裂甲之后：身上没有环 ---------- */
  console.log('=== 4. 裂甲后：环没了，只剩断根和裂痕 ===');
  env.record(); env.frames(1);
  const a2 = env.arcs();
  ok(!a2.some(r => near(r, R * 1.62, 1.2)), '1.62r 处不再有环');
  const stubs = a2.filter(r => near(r, R * 1.20, 0.5));
  ok(stubs.length === 3, '只剩 3 道断根（半径 1.20r）', stubs.length);

  /* ---------- 5. 第二刀才死 ---------- */
  console.log('=== 5. 第二刀才死 ===');
  K.killEnemy(0);
  ok(K.enemies.length === 0, '第二刀击杀');
  ok(K.parts.length > 0, '死亡有碎片');
}

console.log('\n' + (fail === 0 ? '全部通过' : '失败 ' + fail + ' 项') + '：' + pass + ' 项');
process.exit(fail ? 1 : 0);
