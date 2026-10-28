/* 复活测试（不限次数版）
   目标：每次死亡都留一个 5 秒复活窗口，看完整广告就能回来，次数不封顶。
   代价由两件事承担：连击每次折半、无敌时间逐次收紧（2.5 起，1.1 保底）。
   同时验证：广告没看完不生效但还能补看、新开一局复活计数重置。
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
      get canRevive(){return canRevive;}, get reviveT(){return reviveT;},
      get reviveCount(){return reviveCount;}, get deadT(){return deadT;},
      get combo(){return combo;}, set combo(v){combo=v;},
      get inv(){return P.inv;},
      get shield(){return shield;}, get shieldT(){return shieldT;},
      kill: function () { shield = 0; die(); },   // 不管手上有没有盾，直接死（复活会送盾，见第 6 节）
      start, die, doRevive, startAd, endAd
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

console.log('=== 1. 每一次死亡都给复活入口，次数不封顶 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(5);
  ok(K.reviveCount === 0, '开局复活计数为 0', K.reviveCount);

  K.combo = 40;
  K.kill();
  ok(K.canRevive === true, '第 1 次死亡：有复活入口');
  ok(K.reviveT > 4.9, '第 1 次死亡：倒计时从 5 秒开始', K.reviveT.toFixed(2));
  K.doRevive();
  ok(K.reviveCount === 1, '第 1 次复活计入次数', K.reviveCount);
  ok(K.canRevive === false, '复活后入口立刻收起');
  ok(K.state === 'play' && Math.abs(K.inv - 2.5) < 0.01, '首次复活 2.5 秒无敌', K.inv.toFixed(2));
  ok(K.combo === 20, '40 连击 → 复活后 20（只继承一半）', K.combo);

  // 一路死到第 8 次，确认没有硬上限
  for (let i = 2; i <= 8; i++) {
    K.kill();
    const open = K.canRevive === true && K.reviveT > 4.9;
    K.doRevive();
    ok(open && K.state === 'play', '第 ' + i + ' 次死亡照样能复活', K.state);
  }
  ok(K.reviveCount === 8, '本局累计复活 8 次，没有次数上限', K.reviveCount);
  ok(K.combo === 1, '连击折半到底 → 1，复活不再白送连击', K.combo);
}

console.log('\n=== 2. 无敌时间逐次收紧，1.1 秒保底 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(5);
  const seq = [];
  for (let i = 0; i < 6; i++) { K.kill(); K.doRevive(); seq.push(+K.inv.toFixed(2)); }
  ok(seq[0] === 2.5 && seq[1] === 2.1 && seq[2] === 1.7, '前三次：2.5 / 2.1 / 1.7', seq.join(' '));
  ok(seq[5] === 1.1, '第 6 次已经压到保底 1.1s', seq.join(' '));
  ok(seq.every((v, i) => i === 0 || v <= seq[i - 1] + 0.001), '无敌时间单调不回升', seq.join(' '));
}

console.log('\n=== 3. 新开一局复活计数重置 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(5);
  K.kill(); K.doRevive();
  K.kill(); K.doRevive();
  ok(K.reviveCount === 2, '上一局复活 2 次', K.reviveCount);
  K.start();
  ok(K.reviveCount === 0, '新一局清零', K.reviveCount);
  K.kill();
  ok(K.canRevive === true && Math.abs(K.inv - 2.5) > 0, '新一局第一次死亡依旧可复活', K.canRevive);
}

console.log('\n=== 4. 广告没看完：不复活、还能补看 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(5);
  K.kill();
  K.startAd('revive');
  ok(K.state === 'ad', '进入广告');
  K.endAd(false);                        // 没看完 / 拉取失败
  ok(K.reviveCount === 0, '失败路径不记账', K.reviveCount);
  ok(K.canRevive === true && K.reviveT >= 2, '退回死亡页，仍可点复活', K.reviveT.toFixed(2));
  ok(K.state === 'dead', '回到死亡页', K.state);
}

console.log('\n=== 5. 反复复活同样要看完广告才生效 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(5);
  K.kill(); K.doRevive();                 // 第 1 次
  K.kill();
  K.startAd('revive');
  K.endAd(false);
  ok(K.reviveCount === 1, '第 2 次的广告失败不计次', K.reviveCount);
  K.startAd('revive');
  K.endAd(true);
  ok(K.reviveCount === 2 && K.state === 'play', '看完整广告才回到战斗', K.reviveCount + '/' + K.state);
  ok(K.inv < 2.5, '第 2 次复活的护盾已经变短', K.inv.toFixed(2));
}

console.log('\n=== 6. 看广告复活送一面光盾 ===');
{
  const { K, step } = makeEnv(844);
  step(30); K.start(); step(5);
  ok(K.shield === 0, '没学光盾：开局没有盾');
  K.kill(); K.doRevive();
  ok(K.shield === 1 && K.shieldT === 0, '复活：送了一面盾', K.shield);
  K.die();
  ok(K.state === 'play' && K.shield === 0, '再被碰到：盾替你碎，人还活着', K.state);
  ok(K.shieldT === 0, '没学光盾：碎了不再生', K.shieldT);
  K.die();
  ok(K.state === 'dead' && K.canRevive === true, '没盾了再被碰到：死，照样能复活');
  K.doRevive();
  ok(K.shield === 1, '再复活：再送一面', K.shield);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
