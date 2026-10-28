/* 余光经济测试
   1) 余光只从晶柱来：分数不再换钱
   2) 斩一根 +25，入账在结算时发生
   3) 看广告 +80：一局只能领一次
   4) 翻倍广告：把本局余光翻一倍
   5) 强化页布局在 844 / 667 两种屏高下都不出界
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
      get state(){return state;}, set state(v){state=v;},
      get score(){return score;}, set score(v){score=v;},
      get runEcho(){return runEcho;}, get echoAdLeft(){return echoAdLeft;},
      get meta(){return meta;}, get yingRun(){return yingRun;},
      get broken(){return crystalsBroken;}, get crystals(){return crystals;},
      start, finishRun, onEchoAd, finishAd, startAd, openSkills, skillLayout, endAd,
      shatterCrystal, YING_CRYSTAL, ECHO_AD, H_CSS
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

/* ---------- 1. 分数不再换钱 ---------- */
console.log('=== 1. 余光只从晶柱来 ===');
{
  const { K, step } = makeEnv(844);
  step(30);
  K.start();
  K.score = 900;
  K.finishRun();
  ok(K.runEcho === 0, '900 分、一根柱子没砍 → 0 余光', K.runEcho);
  ok(K.meta.pts === 0, '余额不变', K.meta.pts);
  ok(K.meta.total === 900, '"累计"仍记分数 900', K.meta.total);
}

/* ---------- 2. 斩一根 +25 ---------- */
console.log('\n=== 2. 斩碎晶柱 = 唯一的余光来源 ===');
{
  const { K, step } = makeEnv(844);
  step(30);
  K.start();
  ok(K.crystals.length === 3, '开局 3 根晶柱', K.crystals.length);
  ok(K.yingRun === 0, '开局余光是 0', K.yingRun);

  K.shatterCrystal(0);
  K.shatterCrystal(0);
  ok(K.yingRun === K.YING_CRYSTAL * 2, '碎 2 根 → 余光 ' + K.YING_CRYSTAL * 2, K.yingRun);
  ok(K.broken === 2, '计数 2 根', K.broken);
  ok(K.score === 0, '斩晶柱不加分（分数和货币彻底分开）', K.score);

  K.score = 600;
  K.finishRun();
  ok(K.runEcho === K.YING_CRYSTAL * 2, '结算 = 本局余光（与 600 分无关）', K.runEcho);
  ok(K.meta.pts === K.YING_CRYSTAL * 2, '余额 +50', K.meta.pts);
}

/* ---------- 3. 看广告 +80 ---------- */
console.log('\n=== 3. 看广告换余光 ===');
{
  const { K, step } = makeEnv(844);
  step(30);
  K.start();
  K.shatterCrystal(0); K.shatterCrystal(0); K.shatterCrystal(0);
  K.finishRun();
  const before = K.meta.pts;
  ok(before === K.YING_CRYSTAL * 3, '3 根 → ' + K.YING_CRYSTAL * 3 + ' 余光', before);

  K.openSkills();
  ok(K.state === 'skills', '进入强化页', K.state);
  ok(K.echoAdLeft === 1, '本局可领 1 次', K.echoAdLeft);

  K.onEchoAd();
  ok(K.state === 'ad', '点击广告条 → 进入广告', K.state);
  K.finishAd();
  ok(K.meta.pts === before + K.ECHO_AD, '看完 +' + K.ECHO_AD + ' 余光', K.meta.pts);
  ok(K.echoAdLeft === 0, '领取次数用掉', K.echoAdLeft);
  ok(K.state === 'skills', '广告结束回到强化页（不是结算页）', K.state);

  K.onEchoAd();
  ok(K.state === 'skills' && K.meta.pts === before + K.ECHO_AD, '第二次点击无效，余额不变', K.meta.pts);

  K.start();
  ok(K.echoAdLeft === 1, '新一局重新给 1 次', K.echoAdLeft);
  ok(K.yingRun === 0 && K.broken === 0, '新一局余光与本局计数归零', K.yingRun + '/' + K.broken);
}

/* ---------- 4. 没看完不发奖励 ---------- */
console.log('\n=== 4. 没看完不发奖励 ===');
{
  const { K, step } = makeEnv(844);
  step(30);
  K.start();
  K.shatterCrystal(0);
  K.finishRun();
  const before = K.meta.pts;
  K.openSkills();
  K.onEchoAd();
  ok(K.state === 'ad', '进入广告', K.state);
  K.endAd(false);
  ok(K.meta.pts === before, '没看完：余额不变', K.meta.pts);
  ok(K.echoAdLeft === 1, '没看完：领取次数还在', K.echoAdLeft);
  ok(K.state === 'skills', '没看完：退回强化页', K.state);
  K.onEchoAd(); K.finishAd();
  ok(K.meta.pts === before + K.ECHO_AD, '补看成功：正常发放', K.meta.pts);
}

/* ---------- 5. 翻倍广告 ---------- */
console.log('\n=== 5. 余光翻倍 ===');
{
  const { K, step } = makeEnv(844);
  step(30);
  K.start();
  K.shatterCrystal(0); K.shatterCrystal(0);
  K.finishRun();
  const pts = K.meta.pts;
  ok(pts === K.YING_CRYSTAL * 2, '先入账 ' + K.YING_CRYSTAL * 2, pts);
  K.startAd('double');
  K.finishAd();
  ok(K.meta.pts === pts * 2, '翻倍后余额 ' + pts * 2, K.meta.pts);
  ok(K.state === 'over', '翻倍后停在结算页', K.state);
}

/* ---------- 6. 强化页布局 ---------- */
console.log('\n=== 6. 强化页布局 ===');
[844, 667].forEach(h => {
  const { K, step } = makeEnv(h);
  step(30);
  K.openSkills();
  const L = K.skillLayout();
  const bottom = L.reset.y + L.reset.h;
  ok(bottom <= h - 8, h + 'px：最低按钮底边 ' + bottom.toFixed(0) + ' ≤ ' + (h - 8), bottom);
  ok(L.ad.y + L.ad.h < L.ys[0], h + 'px：广告条不压住技能卡', (L.ad.y + L.ad.h).toFixed(0) + ' < ' + L.ys[0].toFixed(0));
  // 技能从 4 项变 5 项（第五项默认锁着），卡片会矮一档：
  // 下限从 78 放到 64，矮卡内部会自动切成单行排版（见 drawSkills 的 tall 分支）。
  ok(L.ch >= 64, h + 'px：技能卡高度 ' + L.ch.toFixed(0) + ' ≥ 64（文字不挤）', L.ch);
  let threw = null;
  try { K.state = 'skills'; step(1); } catch (e) { threw = e.message; }
  ok(!threw, h + 'px：drawSkills 渲染无异常', threw);
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
