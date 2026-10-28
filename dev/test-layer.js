/* 层与怪物绑定：每层换一种主怪
   1) 层配置：每层比上一层多一种怪，名字与说明对得上
   2) layerNewType：只在"历史上第一次出现"的那层返回它
   3) spawnEnemy 按层出怪，不再看秒数；第 1 层只有杂兵
   4) 进层必刷前哨（第 6 层起两只），前哨怪带标记
   5) 8 层之后锁在终末上叠加密度，单调递增不回落
   6) 进层靠本层斩杀数（破门），时间再久也不会自己进层
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(h) {
  h = h || 844;
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000;
  const ac = {
    get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  const canvas = {
    width: 0, height: 0, clientWidth: 390, clientHeight: h,
    getContext: () => new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        return t[k] !== undefined ? t[k] : function () {};
      },
      set(t, k, v) { t[k] = v; return true; }
    }),
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: h })
  };
  const storage = {};
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: h, safeArea: { top: 40, bottom: h - 14 } }),
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
  sb.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: h };
  sb.document = { getElementById: () => canvas, addEventListener() {}, visibilityState: 'visible' };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext('meta.tut = TUT_DONE;', sb);   // 测正常对局：教学局里破门压着、人也不会死
  vm.runInContext(`globalThis.__K = {
    get state(){return state;}, set state(v){ state = v; },
    get layer(){return layer;}, set layer(v){ layer = v; },
    get gameTime(){return gameTime;}, set gameTime(v){ gameTime = v; },
    get layerFxT(){return layerFxT;},
    get scoutLeft(){return scoutLeft;}, set scoutLeft(v){ scoutLeft = v; },
    get scoutAt(){return scoutAt;}, set scoutAt(v){ scoutAt = v; },
    get scoutType(){return scoutType;}, set scoutType(v){ scoutType = v; },
    get enemies(){return enemies;},
    get view(){return view;},
    CFG, LAYERS, layerCfg, layerNewType, layerName, trailN, breakLayer,
    spawnEnemy, onEnterLayer, start, render,
    set spawnTimer(v){ spawnTimer = v; }
  };`, sb);
  return { K: sb.__K, step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } } };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

const env = makeEnv(), K = env.K;
env.step(20);

function quiet() {
  K.CFG.spawnBase = 1e9; K.CFG.spawnMin = 1e9; K.CFG.waveFirst = 1e9;
  K.spawnTimer = 1e9; K.enemies.length = 0;
}

/* ---------- 1. 层配置 ---------- */
console.log('=== 1. 层配置 ===');
{
  ok(K.LAYERS.length === 8, '一共 8 层有名字', K.LAYERS.length);
  ok(K.trailN(1) === 26 && K.trailN(2) === 30 && K.trailN(5) > K.trailN(4), '每层的糖路逐层变长（26、30、…）');
  ok(K.layerCfg(1).name === '残响' && Object.keys(K.layerCfg(1).w).length === 0,
    '第 1 层只有杂兵', JSON.stringify(K.layerCfg(1).w));
  ok(K.layerCfg(2).w.bomb > 0 && !K.layerCfg(2).w.heavy, '第 2 层只多爆裂者');
  ok(K.layerCfg(3).w.heavy > 0 && !K.layerCfg(3).w.charger, '第 3 层多重型，还没有冲锋者');
  ok(K.layerCfg(4).w.charger > 0 && !K.layerCfg(4).w.watch, '第 4 层多冲锋者，还没有守望者');
  ok(K.layerCfg(5).w.watch > 0, '第 5 层多守望者');

  // 每层怪物种类数不减少，是"递增"而不是"替换"
  let mono = true, prevN = 0;
  for (let i = 1; i <= 8; i++) {
    const n = Object.keys(K.layerCfg(i).w).length;
    if (n < prevN) mono = false;
    prevN = n;
  }
  ok(mono, '怪物种类逐层只增不减');
  // 主怪由前哨 + 新敌人卡讲；进层横幅那一行讲这一层的特性
  ok(!K.layerCfg(1).feat && [2, 3, 4, 5, 6, 7, 8].every(n => !!K.layerCfg(n).feat) && K.layerCfg(12).feat === 'end',
    '第 1 层没有特性，第 2~8 层各有一个，深处沿用终末');
  ok(K.layerCfg(3).note.indexOf('地缝') >= 0 && K.layerCfg(2).note.indexOf('雾') >= 0,
    '层说明写的是这一层的特性', K.layerCfg(3).note + ' / ' + K.layerCfg(2).note);
}

/* ---------- 2. 新登场判定 ---------- */
console.log('=== 2. 新登场判定 ===');
{
  ok(K.layerNewType(1) === null, '第 1 层没有新怪');
  ok(K.layerNewType(2) === 'bomb', '第 2 层新怪是爆裂者', K.layerNewType(2));
  ok(K.layerNewType(3) === 'heavy', '第 3 层新怪是重型', K.layerNewType(3));
  ok(K.layerNewType(4) === 'charger', '第 4 层新怪是冲锋者', K.layerNewType(4));
  ok(K.layerNewType(5) === 'watch', '第 5 层新怪是守望者', K.layerNewType(5));
  ok(K.layerNewType(7) === null, '第 7 层重新引入守望者，不算新怪', K.layerNewType(7));
  ok(K.layerNewType(99) === null, '深处层没有新怪');
}

/* ---------- 3. 按层出怪 ---------- */
console.log('=== 3. 按层出怪 ===');
{
  function sample(lv, n) {
    K.layer = lv;
    const c = { plain: 0, bomb: 0, heavy: 0, charger: 0, watch: 0 };
    for (let i = 0; i < n; i++) {
      K.enemies.length = 0;             // 不撞 maxEnemies 上限
      const e = K.spawnEnemy(0, 0);
      if (!e) continue;
      if (e.bomb) c.bomb++;
      else if (e.heavy) c.heavy++;
      else if (e.charger) c.charger++;
      else if (e.watch) c.watch++;
      else c.plain++;
    }
    K.enemies.length = 0;
    return c;
  }

  const c1 = sample(1, 400);
  ok(c1.plain === 400, '第 1 层 400 次全是杂兵', JSON.stringify(c1));

  const c2 = sample(2, 800);
  ok(c2.bomb > 60 && c2.bomb < 220, '第 2 层爆裂者约 16%', c2.bomb + '/800');
  ok(c2.heavy === 0 && c2.charger === 0 && c2.watch === 0, '第 2 层没有更后面的怪', JSON.stringify(c2));

  const c4 = sample(4, 800);
  ok(c4.heavy > 0 && c4.charger > 0, '第 4 层重型与冲锋者都会出');
  ok(c4.watch === 0, '第 4 层还没有守望者', c4.watch);

  const c5 = sample(5, 1200);
  ok(c5.watch > 0, '第 5 层有守望者', c5.watch);

  // 同样是 t=40 秒，旧逻辑看秒数，新逻辑看层：第 2 层不该有重型
  K.layer = 2;
  K.gameTime = 120;
  ok(sample(2, 300).heavy === 0, '时间再久，第 2 层也不会冒出重型');
}

/* ---------- 4. 前哨 ---------- */
console.log('=== 4. 进层前哨 ===');
{
  K.start(); quiet();
  env.step(2);
  ok(K.scoutLeft === 0, '第 1 层不刷前哨（没有新东西可讲）', K.scoutLeft);

  K.layer = 1; K.breakLayer(); quiet();
  env.step(2);
  ok(K.layer === 2, '破门进第 2 层', K.layer);
  ok(K.scoutLeft === 1, '第 2 层排了 1 只前哨', K.scoutLeft);
  ok(K.scoutType === 'bomb', '前哨指定爆裂者', K.scoutType);
  ok(K.scoutAt > K.gameTime, '前哨延后约 1.2 秒，让过场提示先播完',
    (K.scoutAt - K.gameTime).toFixed(2));

  K.gameTime = K.scoutAt + 0.05;
  env.step(1);
  const fl = K.enemies.filter(e => e.scout > 0);
  ok(fl.length === 1 && fl[0].bomb, '到点必刷，且带讲解标记', fl.length + '/' + (fl[0] && fl[0].bomb));
  ok(fl[0].scout > 2.5, '标记从 2.8 秒开始倒数', fl[0].scout.toFixed(2));
  ok(K.scoutLeft === 0, '刷完就清空，不会一直补', K.scoutLeft);

  // 第 6 层两只
  K.start(); quiet();
  K.layer = 5; K.breakLayer();
  env.step(2);
  ok(K.layer === 6, '进到第 6 层', K.layer);
  ok(K.scoutLeft === 2, '第 6 层排两只前哨', K.scoutLeft);
  ok(K.scoutType === 'heavy', '没有新怪可讲时，刷本层权重最高的那一种', K.scoutType);

  K.gameTime = K.scoutAt + 0.05; env.step(1);
  ok(K.enemies.filter(e => e.scout > 0).length === 1, '第一只到点就刷');
  K.gameTime = K.scoutAt + 0.05; env.step(1);
  ok(K.enemies.filter(e => e.scout > 0).length === 2, '0.9 秒后第二只跟上',
    K.enemies.filter(e => e.scout > 0).length);
}

/* ---------- 5. 8 层之后 ---------- */
console.log('=== 5. 深处 ===');
{
  const a = K.layerCfg(8), b = K.layerCfg(9), c = K.layerCfg(20);
  ok(b.name === '深处 9', '第 9 层开始叫「深处 N」', b.name);
  ok(b.w.heavy > a.w.heavy, '深处比重上升，不会回落', a.w.heavy + ' → ' + b.w.heavy);
  let capped = true, grows = true, prev = 0;
  for (let i = 8; i <= 20; i++) {
    const s = Object.keys(K.layerCfg(i).w).reduce((x, k) => x + K.layerCfg(i).w[k], 0);
    if (s < prev - 1e-9) grows = false;
    prev = s;
    for (const k in K.layerCfg(i).w) if (K.layerCfg(i).w[k] > 0.26) capped = false;
  }
  ok(grows, '第 8~20 层密度只增不减');
  ok(capped, '单项概率封顶 0.26，不会变成必出');
  ok(K.layerCfg(9).note.indexOf('加压') >= 0, '深处的说明写明是加压');
}

/* ---------- 6. 兼容与渲染 ---------- */
console.log('=== 6. 兼容与渲染 ===');
{
  ok(K.layerName(1) === '残响' && K.layerName(8) === '终末' && K.layerName(12) === '深处 12',
    '层名接口保持兼容', K.layerName(12));
  K.start(); quiet(); K.gameTime = 200; env.step(3);
  ok(K.layer === 1, '一只没斩，时间再久也还在第 1 层', K.layer);
  ok(typeof K.CFG.chargerAt === 'number', '旧的按秒配置字段还在（不报错即可）');

  K.start(); quiet();
  K.layer = 3; K.gameTime = 33;
  let err = null;
  try { for (let i = 0; i < 120; i++) { K.render(); env.step(1); } } catch (e) { err = e; }
  ok(!err, '第 3 层连续渲染 120 帧不报错', err && err.message);
}

console.log('\n' + (fail === 0 ? '全部通过' : '有失败') + '：' + pass + ' 过 / ' + fail + ' 败');
process.exit(fail === 0 ? 0 : 1);
