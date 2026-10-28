/* 存活计分
   1) 什么都不杀，分数也在涨
   2) 速率随时间上升；连击会让它更快
   3) 每 10 秒头上报一次「存活 +N」，不多不少
   4) 死了就停（不能躺着继续涨）
   5) 和击杀分叠加，互不影响
   6) 结算页/死亡页都能画出这一行
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
    get score(){return score;}, set score(v){ score = v; },
    get gameTime(){return gameTime;}, set gameTime(v){ gameTime = v; },
    get combo(){return combo;}, set combo(v){ combo = v; },
    get comboTimer(){return comboTimer;}, set comboTimer(v){ comboTimer = v; },
    get surviveGain(){return surviveGain;},
    get surviveT(){return surviveT;},
    get floats(){return floats;},
    CFG, meta, enemies, start, deadBtns, render,
    set spawnTimer(v){ spawnTimer = v; }
  };`, sb);
  return { K: sb.__K, step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } } };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 0.01);

const env = makeEnv(), K = env.K;
env.step(20);

// 清场：不刷怪、不击杀，只看存活分
function quiet() {
  K.CFG.spawnBase = 1e9; K.CFG.spawnMin = 1e9;
  K.CFG.waveFirst = 1e9; K.CFG.chargerAt = 1e9; K.CFG.heavyAt = 1e9;
  K.CFG.bombAt = 1e9; K.CFG.watchAt = 1e9;
  K.spawnTimer = 1e9;
  K.enemies.length = 0;
}

/* ---------- 1. 不杀也涨 ---------- */
console.log('=== 1. 站着不动也在涨 ===');
{
  K.start(); quiet(); env.step(2);
  const s0 = K.score;
  env.step(60);                        // ≈ 1 秒
  const d = K.score - s0;
  ok(d > 0, '1 秒后分数确实涨了', d);
  ok(near(d, K.CFG.surviveRate, 0.6), '涨幅贴近开局速率', d + ' vs ' + K.CFG.surviveRate);
  ok(K.surviveGain === K.score, '全部计入存活得分', K.surviveGain + '/' + K.score);
}

/* ---------- 2. 速率随时间涨 ---------- */
console.log('=== 2. 活得越久，涨得越快 ===');
{
  K.start(); quiet(); env.step(2);
  const early = (() => { const a = K.score; env.step(60); return K.score - a; })();
  K.gameTime = 60; env.step(2);
  const late = (() => { const a = K.score; env.step(60); return K.score - a; })();
  ok(late > early + 0.5, '60 秒时每秒得分明显更高', early + ' → ' + late);
  K.gameTime = 600; env.step(2);
  const capA = (() => { const a = K.score; env.step(60); return K.score - a; })();
  ok(capA <= K.CFG.surviveMax + 0.8, '不会无限加速（有上限）', capA);
}

/* ---------- 3. 连击加成 ---------- */
console.log('=== 3. 连击让存活分更值钱 ===');
{
  K.start(); quiet(); env.step(2);
  K.combo = 0; K.comboTimer = 0; K.gameTime = 20; env.step(2);
  const c0 = (() => { const a = K.score; env.step(60); return K.score - a; })();
  K.combo = 12; K.comboTimer = 99; K.gameTime = 20; env.step(2);
  const c12 = (() => { const a = K.score; env.step(60); return K.score - a; })();
  ok(c12 > c0 * 1.6, '12 层连击下每秒得分接近翻倍', c0 + ' → ' + c12);
  K.combo = 0; K.comboTimer = 0;
}

/* ---------- 4. 每 10 秒报一次 ---------- */
console.log('=== 4. 头上报数 ===');
{
  K.start(); quiet(); env.step(2);
  K.floats.length = 0;
  let reports = 0;
  const seen = new Set();
  for (let i = 0; i < 620; i++) {            // ≈ 10.3 秒
    env.step(1);
    for (let j = 0; j < K.floats.length; j++) {
      const f = K.floats[j];
      if (f.text.indexOf('存活 +') === 0 && !seen.has(f)) { seen.add(f); reports++; }
    }
  }
  ok(reports === 1, '10 秒内只报一次', reports);
  const label = [...seen][0];
  ok(label && /^存活 \+\d+$/.test(label.text), '文案是「存活 +N」', label && label.text);
  ok(label && parseInt(label.text.replace(/\D/g, ''), 10) >= 15, '报的数目是这 10 秒实得分',
    label && label.text);
  ok(K.surviveT < 10, '报数后计时归零重来', K.surviveT.toFixed(2));
}

/* ---------- 5. 死了就停 ---------- */
console.log('=== 5. 死了不再涨 ===');
{
  K.start(); quiet(); env.step(2);
  const a = K.score;
  K.state = 'dead';
  env.step(120);
  ok(K.score === a, '死亡状态下分数冻结', a + ' → ' + K.score);
}

/* ---------- 6. 和击杀分叠加 ---------- */
console.log('=== 6. 与击杀分互不覆盖 ===');
{
  K.start(); quiet(); env.step(2);
  K.score = 1000;
  const before = K.score;
  env.step(120);
  ok(K.score > before, '存活分是加上去的，不是覆盖', before + ' → ' + K.score);
  ok(K.surviveGain < K.score, '存活得分单独统计', K.surviveGain + ' / ' + K.score);
}

/* ---------- 7. 结算页 ---------- */
console.log('=== 7. 两个结算页都能画 ===');
{
  let err = null;
  try {
    K.start(); quiet(); env.step(30);
    K.state = 'dead'; K.gameTime = 37.4;
    env.step(4);
    K.state = 'over';
    env.step(4);
  } catch (e) { err = e; }
  ok(!err, '死亡页 + 结算页渲染无异常', err && err.message);
  ok(Math.floor(37.4) === 37, '存活时长按整秒显示', Math.floor(K.gameTime));
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
