/* 手感修复测试：收刀滑行 + 空场呼吸
   背景：疯狂连斩之后突然没对手，角色会"钉"在原地，玩家反应不过来就被下一波撞死。
   这里验证两件事：
   ① 冲刺结束保留余速，滑行一段再停（不是一帧归零）
   ② 场上 320 内没怪时进入 0.9 秒缓冲：短暂无敌 + 光撑开
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(hCss) {
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  const ac = {
    get currentTime() { return 0; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  const canvas = {
    width: 0, height: 0, clientWidth: 390, clientHeight: hCss,
    getContext: () => new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        return t[k] !== undefined ? t[k] : function () {};
      },
      set(t, k, v) { t[k] = v; return true; }
    }),
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: hCss })
  };
  const storage = {};
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: hCss, safeArea: { top: 34, bottom: hCss - 20 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  let raf = null; let simT = 1000;
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'headless' }
  };
  sb.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: hCss };
  sb.document = { getElementById: () => canvas, addEventListener() {}, visibilityState: 'visible' };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext(`
    globalThis.__K = {
      get state(){return state;},
      get p(){return P;},
      get enemies(){return enemies;},
      get calmT(){return calmT;},
      get view(){return view;},
      get viewBase(){return POW.viewBase;},
      get maxSpeed(){return CFG.maxSpeed;},
      get speed(){return Math.hypot(P.vx,P.vy);},
      CFG, start, tryDash, spawnEnemy, killEnemy, update, die
    };
  `, sb);
  function step(n) {
    for (let i = 0; i < n; i++) {
      const cb = raf; raf = null;
      if (!cb) throw new Error('no raf');
      simT += 16.7; cb(simT);
    }
  }
  return { K: sb.__K, step };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

console.log('=== 1. 收刀滑行：冲刺结束不瞬停 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(2);
  const x0 = K.p.x, y0 = K.p.y;
  K.tryDash(null);                       // 朝初始朝向冲一刀
  ok(K.p.dashT > 0, '进入冲刺', K.p.dashT.toFixed(2));

  // 冲到冲刺结束的那一帧
  let guard = 0;
  while (K.p.dashT > 0 && guard++ < 60) step(1);
  const vEnd = K.speed;
  ok(vEnd > K.maxSpeed, '冲刺刚结束时仍高于走路上限', vEnd.toFixed(0));
  ok(vEnd > 600, '保留了大半冲刺余速（旧版这里直接砍到 0.3 倍以下）', vEnd.toFixed(0));

  // 再走 0.1 秒：仍应在滑行，速度高于走路上限
  step(6);
  ok(K.speed > K.maxSpeed * 0.95, '0.1 秒后还在滑，不是一帧停住', K.speed.toFixed(0));

  // 0.35 秒后应该已经收住
  step(15);
  ok(K.speed <= K.maxSpeed + 1, '0.35 秒内收回到走路上限', K.speed.toFixed(0));

  const glide = Math.hypot(K.p.x - x0, K.p.y - y0);
  ok(glide > 180, '整刀（含滑行）推进了足够距离', glide.toFixed(0));
}

console.log('\n=== 2. 空场呼吸：最后一刀砍空 → 无敌 + 光撑开 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(2);
  ok(K.calmT === 0, '开局不处于空场缓冲', K.calmT);

  K.spawnEnemy(K.p.x + 40, K.p.y);       // 一只贴脸的怪
  K.killEnemy(0);
  ok(K.enemies.length === 0, '场上清空', K.enemies.length);
  ok(K.calmT > 0.8, '立刻进入 0.9 秒缓冲', K.calmT.toFixed(2));
  ok(K.p.inv >= 0.45, '缓冲期给 0.5 秒无敌', K.p.inv.toFixed(2));

  const v0 = K.view;
  step(20);                              // 0.33 秒
  ok(K.view > v0 * 1.08, '光临时撑开（看得见下一波从哪来）', (K.view / v0).toFixed(2));
  ok(K.calmT < 0.7 && K.calmT > 0, '缓冲在倒数', K.calmT.toFixed(2));

  step(60);                              // 再 1 秒
  ok(K.calmT === 0, '1 秒后缓冲结束', K.calmT);
}

console.log('\n=== 3. 有怪在附近时不触发（不能白送无敌） ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(2);
  K.spawnEnemy(K.p.x + 40, K.p.y);
  K.spawnEnemy(K.p.x + 200, K.p.y);      // 场边还有一只，320 内
  K.killEnemy(0);
  ok(K.calmT === 0, '还有近处的怪：不给缓冲', K.calmT);
  ok(K.enemies.length === 1, '剩下的怪还在', K.enemies.length);
}

console.log('\n=== 4. 缓冲只给一次，不叠加 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(2);
  K.spawnEnemy(K.p.x + 40, K.p.y);
  K.killEnemy(0);
  const c0 = K.calmT;
  step(5);
  K.spawnEnemy(K.p.x + 40, K.p.y);
  K.killEnemy(0);
  ok(K.calmT <= c0, '缓冲不会被重新拉满', K.calmT.toFixed(2));
}

console.log('\n=== 5. 新开一局清除缓冲 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(2);
  K.spawnEnemy(K.p.x + 40, K.p.y);
  K.killEnemy(0);
  ok(K.calmT > 0, '先进缓冲', K.calmT.toFixed(2));
  K.start(); step(2);
  ok(K.calmT === 0, '重开后缓冲清零', K.calmT);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
