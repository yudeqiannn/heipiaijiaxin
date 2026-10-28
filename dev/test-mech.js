/* 三类"读一眼再决定"的机制测试
   1) 爆裂者：死后留引信 → 0.62 秒后炸 → 炸死范围内的敌人 / 站在里面会死 / 会连锁
   2) 守望者：靠近时吸走视野（最多 35%），黑暗里几乎不动
   3) 晶柱：刀砍中会碎 → 碎片杀敌 → 光尘把视野撑大 3.2 秒
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
  vm.runInContext('meta.tut = TUT_DONE;', sb);   // 测正常对局：教学局里破门压着、人也不会死
  vm.runInContext(`globalThis.__K = {
    get state(){return state;}, get P(){return P;}, get view(){return view;},
    get viewDrain(){return viewDrain;}, get viewBoost(){return viewBoost;},
    get combo(){return combo;}, get score(){return score;}, get gameTime(){return gameTime;},
    enemies, blasts, shards, crystals, CFG, start, update, killEnemy, shatterCrystal,
    spawnEnemy, buildCrystals, W, H,
    set spawnTimer(v){ spawnTimer = v; }
  };`, sb);
  return {
    K: sb.__K,
    step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } }
  };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

// 静场：关掉刷怪、给玩家无敌，只测机制本身
function quiet(K) {
  K.CFG.spawnBase = 1e6;
  K.CFG.spawnMin = 1e6;
  K.spawnTimer = 1e6;      // 已经排上的那一只也要拦掉
  K.enemies.length = 0;
}

function mkEnemy(o) {
  return Object.assign({
    x: 0, y: 0, vx: 0, vy: 0, r: 12, sp: 60,
    heavy: false, charger: false, bomb: false, watch: false,
    hp: 1, cracked: false, armorT: 0,
    mode: 'walk', t: 0, cdx: 0, cdy: 0, score: 1, wob: 0, born: 1
  }, o);
}

/* ---------- 1. 爆裂者 ---------- */
console.log('=== 1. 爆裂者：死了才炸 ===');
{
  const { K, step } = makeEnv();
  step(30); K.start(); step(2); quiet(K); K.P.inv = 999;

  // 玩家在圆心，炸弹敌人离 200（炸不到），另一个普通敌人在炸弹旁边
  K.P.x = K.W / 2; K.P.y = K.H / 2;
  K.enemies.length = 0;
  K.enemies.push(mkEnemy({ x: K.P.x + 200, y: K.P.y, r: 18, bomb: true, score: 2 }));
  K.enemies.push(mkEnemy({ x: K.P.x + 210, y: K.P.y + 30, r: 12 }));

  K.killEnemy(0);
  ok(K.blasts.length === 1, '击杀爆裂者后留下一条引信', K.blasts.length);
  ok(K.blasts[0].fuse === K.CFG.bombFuse, '引信 ' + K.CFG.bombFuse + ' 秒', K.blasts[0].fuse);

  step(20);   // ~0.33s，还没炸
  ok(K.blasts.length === 1, '0.33 秒时还没爆');
  step(24);   // 累计 ~0.73s，已过引信
  ok(K.blasts.length === 0, '过了引信就消失（炸了）');
  ok(K.enemies.length === 0, '爆炸把旁边的敌人也带走了', K.enemies.length);
  ok(K.state === 'play', '玩家在 200 外，没被炸到', K.state);
}

console.log('\n=== 2. 爆裂者：站在爆心里会死 ===');
{
  const { K, step } = makeEnv();
  step(30); K.start(); step(2); quiet(K);
  K.P.x = K.W / 2; K.P.y = K.H / 2;
  K.enemies.push(mkEnemy({ x: K.P.x + 40, y: K.P.y, r: 18, bomb: true }));
  K.killEnemy(0);
  K.P.inv = 0;                 // 假设无敌帧已过
  step(45);                    // 0.75s
  ok(K.state === 'dead', '0.62 秒后炸死站在爆心里的玩家', K.state);
}

console.log('\n=== 3. 爆裂者：会连锁 ===');
{
  const { K, step } = makeEnv();
  step(30); K.start(); step(2); quiet(K); K.P.inv = 999;
  const bx = K.P.x + 400, by = K.P.y;
  K.P.x = bx - 320; K.P.y = by;                   // 玩家躲在炸不到的地方（别躲出感知外：那里的怪算甩掉了，会被收走）
  K.enemies.push(mkEnemy({ x: bx, y: by, r: 18, bomb: true }));
  K.enemies.push(mkEnemy({ x: bx + 70, y: by, r: 18, bomb: true }));
  K.killEnemy(0);
  ok(K.blasts.length === 1, '第一颗留下引信');
  step(45);
  ok(K.blasts.length === 1, '第二颗被第一颗炸死，又留下一条新引信', K.blasts.length);
  step(45);
  ok(K.blasts.length === 0 && K.enemies.length === 0, '连锁结束后场上清空', K.blasts.length + '/' + K.enemies.length);
}

/* ---------- 4. 守望者 ---------- */
console.log('\n=== 4. 守望者：黑暗里不动，靠近吸视野 ===');
{
  const { K, step } = makeEnv();
  step(30); K.start(); step(2); quiet(K); K.P.inv = 999;
  const baseView = K.view;

  const far = mkEnemy({ x: K.P.x + 600, y: K.P.y, r: 16, watch: true, sp: 100 });
  K.enemies.push(far);
  const x0 = far.x;
  step(30);                                  // 0.5s，在光外
  ok(Math.abs(far.x - x0) < 20, '光外的守望者几乎不动（0.5 秒挪了 ' + Math.abs(far.x - x0).toFixed(1) + 'px）');

  K.enemies.length = 0;
  K.enemies.push(mkEnemy({ x: K.P.x + 60, y: K.P.y, r: 16, watch: true, sp: 100 }));
  step(60);                                  // 1 秒
  ok(K.viewDrain > 0.25, '贴脸时吸走视野 ' + (K.viewDrain * 100).toFixed(0) + '%', K.viewDrain.toFixed(3));
  ok(K.view < baseView * 0.95, '视野真的缩了：' + baseView.toFixed(0) + ' → ' + K.view.toFixed(0));

  K.enemies.length = 0;
  step(150);                                 // 2.5 秒，守望者没了
  ok(K.viewDrain < 0.02, '守望者死后视野停止被吸', K.viewDrain.toFixed(3));
  ok(K.view > baseView * 0.98, '视野恢复', K.view.toFixed(0));
}

/* ---------- 5. 晶柱 ---------- */
console.log('\n=== 5. 晶柱：砍碎 → 碎片杀敌 → 光尘扩视野 ===');
{
  const { K, step } = makeEnv();
  step(30); K.start(); step(2); quiet(K); K.P.inv = 999;

  ok(K.crystals.length === K.CFG.crystalN, '开局 ' + K.CFG.crystalN + ' 根晶柱', K.crystals.length);

  // 把一根柱子挪到玩家正前方，旁边放两个敌人
  const c = K.crystals[0];
  c.x = K.P.x + 60; c.y = K.P.y; c.r = 30;
  K.enemies.length = 0;
  K.enemies.push(mkEnemy({ x: c.x + 25, y: c.y + 10, r: 12 }));
  K.enemies.push(mkEnemy({ x: c.x - 25, y: c.y - 10, r: 12 }));

  const n0 = K.crystals.length;
  K.shatterCrystal(0);
  ok(K.crystals.length === n0 - 1, '柱子碎了就没了', K.crystals.length);
  ok(K.shards.length === 10, '炸成 10 片碎片', K.shards.length);
  ok(K.viewBoost > 3, '光尘计时开始（' + K.viewBoost.toFixed(1) + 's）', K.viewBoost);

  const v0 = K.view;
  step(12);                                  // 0.2 秒，碎片飞出去
  ok(K.enemies.length === 0, '碎片把旁边的两个敌人带走了', K.enemies.length);
  step(60);                                  // 再给 1 秒让视野缓动跟上
  ok(K.view > v0, '视野被光尘撑大：' + v0.toFixed(0) + ' → ' + K.view.toFixed(0));
  ok(K.view > K.CFG.viewBase * 1.1, '比基础视野大 10% 以上', (K.view / K.CFG.viewBase).toFixed(2) + 'x');

  step(240);                                 // 4 秒后光尘散尽、视野收回
  ok(K.viewBoost === 0, '光尘结束');
  ok(K.view < K.CFG.viewBase * 1.05, '视野回到常态', K.view.toFixed(0));
}

console.log('\n=== 6. 刀砍到柱子才碎（不是走过去就碎） ===');
{
  const { K, step } = makeEnv();
  step(30); K.start(); step(2); quiet(K); K.P.inv = 999;
  const c = K.crystals[0];
  c.x = K.P.x; c.y = K.P.y;                  // 柱子就在脚下
  const n0 = K.crystals.length;
  K.P.dashT = 0;
  step(3);
  ok(K.crystals.length === n0, '没出刀时不碎', K.crystals.length);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
