/* 宝箱 · 皮肤碎片 · 仓库道具（2.16 节）测试 —— 用户："升级抽宝箱……皮肤抽箱子碎片……箱子还能得到道具……场内使用按钮……
   看广告可以获得十连抽"；"糖可以买箱子，不可以买皮肤了"；"我的糖买箱子呢？我的箱子呢？？？"
   1) 概率：普通宝箱 碎片 9 / 道具 15 / 糖 75 / 整套 1；广告十连 35 / 15 / 48 / 2（开一万个量一下）；碎片翻倍
   2) 保底：广告十连至少 2 次碎片、普通一次开 10 个至少 1 次；连开 BOX.pity 个没出整套，下一个必出
   3) 皮肤都有了：碎片、整套换成糖
   4) 糖买一个：不够说差几颗；够了扣糖、攒起来（不当场开）
   5) 看广告十连：没看完不给；一天 BOX.adPerDay 次，第二天重来
   6) 自己攒的宝箱：开一个 / 全部打开 / 开箱页「再开一个」「收下」
   7) 仓库道具：挑一种带上场；局里左斩上面的键，点了生效、每局最多 BOX.useMax 个、道具生效时不能叠；没带就照常算左斩
   8) 存档：存进去读得回来，坏数据修好
   9) 画得出来：商店「宝箱」页、概率、开箱页、局里的键 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(seed) {
  const h = 844;
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000, raf = null;
  const ac = {
    get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  const ops = { fill: 0, stroke: 0 }, texts = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (k === 'fillText') return s => { ops.fillText = (ops.fillText || 0) + 1; texts.push(String(s)); };
      if (k === 'fill' || k === 'stroke' || k === 'fillRect' || k === 'drawImage' || k === 'strokeText') return () => { ops[k] = (ops[k] || 0) + 1; };
      return t[k] !== undefined ? t[k] : function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const storage = {};
  if (seed) storage.dash_meta_v1 = JSON.stringify(seed);
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: h, safeArea: { top: 44, bottom: h - 34 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
    vibrateShort() {}, vibrateLong() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {},
    performance: { now: () => simT },
    requestAnimationFrame: f => { raf = f; return 1; }, cancelAnimationFrame() {},
    Math: Object.create(Math), Date,   // 每个环境自己一个 Math：测试里改 Math.random 不影响别的环境 JSON, Promise, Error, isNaN, parseInt, parseFloat,
    navigator: { userAgent: 'headless' }
  };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext('HD.intro = false; HD.preAd = false; HD.story = false; CFG.mainMode = "horde"; HD.tut = false; HD.autoRun = false; HD.lives = 1; HD.fillWait = 0;', sb);   // 新手教程在 test-htut.js 里测
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const f = raf; raf = null; if (!f) break; simT += 16.7; f(simT); } }
  let tid = 20;
  const down = (x, y) => { const id = ++tid; run('onTouchStart({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });'); return id; };
  const up = (id, x, y) => run('onTouchEnd({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tap = (x, y) => up(down(x, y), x, y);
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  const tapDash = () => tap(run('DASH_BTN.x'), run('DASH_BTN.y'));
  return { run, step, tap, tapRect, tapDash, ops, storage, texts };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

const J = (E, c) => JSON.parse(E.run('JSON.stringify(' + c + ')'));
function play(E, pre) {
  E.run('state = "ready"; bxRes = null; shopOdds = false; meta.runs = 5;' + (pre || '')); E.step(3);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hPath.length = 0; hPathLive = false; hCandy = []; hCandyNext = 1e12; hPropNext = 1e12; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9;');
  E.step(2);
}

console.log('1) 概率（用户："道具在箱子里出现的频率太高，而且皮肤碎片也太容易得到了，根本没有看广告的动力，平衡一下"）');
{
  const E = makeEnv();
  const measure = ad => { E.run('BOX.pity = 1e9; var __C = {}; for (var i = 0; i < 10000; i++) { meta.hs.own = {}; meta.bx.sh = {}; var __r = bxPull(false, ' + ad + '); __C[__r.k] = (__C[__r.k] || 0) + 1; }'); const C = J(E, '__C'); return k => (C[k] || 0) / 100; };
  let pc = measure(false);
  ok(Math.abs(pc('shard') - 9) < 1.5 && Math.abs(pc('prop') - 15) < 1.5 && Math.abs(pc('candy') - 75) < 2 && Math.abs(pc('skin') - 1) < 0.5,
    '普通宝箱开一万个：碎片 ' + pc('shard') + '% / 道具 ' + pc('prop') + '% / 糖 ' + pc('candy') + '% / 整套 ' + pc('skin') + '%（应为 9 / 15 / 75 / 1）');
  pc = measure(true);
  ok(Math.abs(pc('shard') - 35) < 2 && Math.abs(pc('prop') - 15) < 1.5 && Math.abs(pc('candy') - 48) < 2 && Math.abs(pc('skin') - 2) < 0.7,
    '广告十连开一万个：碎片 ' + pc('shard') + '% / 道具 ' + pc('prop') + '% / 糖 ' + pc('candy') + '% / 整套 ' + pc('skin') + '%（应为 35 / 15 / 48 / 2）');
  E.run('var __S = {}; for (var i = 0; i < 3000; i++) { meta.hs.own = {}; meta.bx.sh = {}; var __r = bxPull(true); __S[__r.n] = (__S[__r.n] || 0) + 1; }');
  ok(Object.keys(J(E, '__S')).join() === '1', '普通宝箱的碎片一次 1 片');
  E.run('var __S = {}; for (var i = 0; i < 3000; i++) { meta.hs.own = {}; meta.bx.sh = {}; var __r = bxPull(true, true); __S[__r.n] = (__S[__r.n] || 0) + 1; }');
  ok(Object.keys(J(E, '__S')).sort().join() === '1,2', '广告十连的碎片一次 1~2 片');
  E.run('var __W = {}; for (var i = 0; i < 6000; i++) { meta.hs.own = {}; meta.bx.sh = {}; var __r = bxPull(true); __W[__r.id] = (__W[__r.id] || 0) + 1; }');
  const W = J(E, '__W');
  ok(W.rain > W.dj && W.dj > W.flashy && W.flashy > W.revenge && W.revenge > W.king && !W.base, '要的片数越少越容易出：' + JSON.stringify(W) + '（原版不出）');
  ok(JSON.stringify(J(E, 'BOX.need')) === JSON.stringify({ rain: 20, dj: 30, flashy: 50, revenge: 70, king: 120 }), '集齐要的碎片翻倍：20 / 30 / 50 / 70 / 120');
  // 平均一次广告十连拿几片：雨中嘉豪大约几次广告
  E.run('BOX.pity = 50; var __tot = 0; for (var i = 0; i < 300; i++) { meta.hs.own = {}; meta.bx.sh = {}; bxOpenN(10, true).forEach(function (r) { if (r.k === "shard") __tot += r.n; }); }');
  const per = J(E, '__tot') / 300;
  ok(per > 4 && per < 7, '一次广告十连平均 ' + per.toFixed(1) + ' 片碎片（雨中嘉豪 20 片 ≈ ' + Math.ceil(20 / per) + ' 次广告）');
}

console.log('2) 保底');
{
  const E = makeEnv();
  E.run('Math.random = function () { return 0.8; };');    // 0.8 → 普通宝箱、广告十连都是糖
  const L = J(E, 'bxOpenN(10, true).map(function (r) { return r.k; })');
  ok(L.filter(k => k === 'candy').length === 8 && L[8] === 'shard' && L[9] === 'shard', '广告十连一次碎片都没出：最后两个换成碎片（至少 ' + E.run('BOX.adMinShard') + ' 次）', L.join(','));
  const L10 = J(E, 'bxOpenN(10).map(function (r) { return r.k; })');
  ok(L10.filter(k => k === 'shard').length === 1 && L10[9] === 'shard', '普通宝箱一次开 10 个：至少 1 次碎片');
  const L1 = J(E, 'bxOpenN(1).map(function (r) { return r.k; })');
  ok(L1[0] === 'candy', '只开一个不保底');
  E.run('meta.bx.pity = BOX.pity - 1;');
  const r = J(E, 'bxPull(false)');
  ok(r.k === 'skin' && E.run('meta.bx.pity') === 0 && E.run('heroOwned(HERO_SKIN["' + r.id + '"])'), '连开 ' + E.run('BOX.pity') + ' 个没出整套：这一个必出（' + r.id + '），重新数');
}

console.log('3) 皮肤都有了');
{
  const E = makeEnv();
  E.run('HERO_SKINS.forEach(function (s) { meta.hs.own[s.id] = 1; }); meta.candy = 0;');
  const r = J(E, 'bxPull(true)');
  ok(r.k === 'candy' && r.was === 'shard' && E.run('meta.candy') === r.n && r.n % E.run('BOX.shardCandy') === 0, '碎片换成糖（每片 ' + E.run('BOX.shardCandy') + ' 颗）：+' + r.n);
  E.run('meta.bx.pity = BOX.pity - 1;');
  const r2 = J(E, 'bxPull(false)');
  ok(r2.k === 'candy' && r2.n === E.run('BOX.skinCandy'), '整套换成 ' + E.run('BOX.skinCandy') + ' 颗糖');
  E.run('Math.random = function () { return 0.8; };');
  ok(J(E, 'bxOpenN(10, true).filter(function (r) { return r.k === "shard"; }).length') === 0, '十连保底不硬塞碎片（没有要攒的了）');
}

console.log('4) 糖买一个');
{
  const E = makeEnv();
  E.run('meta.runs = 5; meta.candy = 100;'); E.step(2);
  E.run('openShop("box");'); E.step(1);
  E.tapRect(E.run('shopLayout().box.buy'));
  ok(E.run('state') === 'shop' && E.run('meta.candy') === 100 && /还差 50/.test(E.run('shopMsg')), '100 颗：不够，说还差 50 颗', E.run('shopMsg'));
  E.run('meta.candy = 1000; meta.bx.n = 2;');
  E.tapRect(E.run('shopLayout().box.buy'));
  ok(E.run('state') === 'shop' && E.run('meta.bx.n') === 3 && E.run('meta.candy') === 850 && /买了 1 个宝箱，现在有 3 个/.test(E.run('shopMsg')), '够了：扣 150 颗，攒起来不当场开（用户："不要买了默认开，买了可以攒起来"）', E.run('shopMsg'));
  E.tapRect(E.run('shopLayout().box.buy'));
  ok(E.run('meta.bx.n') === 4 && E.run('meta.candy') === 700, '再买一个：4 个');
}

console.log('5) 看广告十连');
{
  const E = makeEnv();
  E.run('meta.runs = 5;'); E.step(2);
  E.run('openShop("box");'); E.step(1);
  E.tapRect(E.run('shopLayout().box.ad'));
  ok(E.run('state') === 'ad' && E.run('adAction') === 'box', '点「看广告 · 十连抽」：先看广告');
  E.run('endAd(false);');
  ok(E.run('state') === 'shop' && E.run('meta.bx.ad.n') === 0, '没看完：回商店，不给、不算次数');
  for (let i = 1; i <= 3; i++) {
    E.run('state = "shop";'); E.tapRect(E.run('shopLayout().box.ad')); E.run('finishAd();');
    ok(E.run('state') === 'box' && E.run('bxRes.list.length') === 10 && E.run('meta.bx.ad.n') === i && E.run('bxAdLeft()') === 3 - i, '看完第 ' + i + ' 次：开 10 个，今天还剩 ' + (3 - i) + ' 次');
    E.run('bxRes.at = -1e9;'); E.tapRect(E.run('boxLayout().back'));
    ok(E.run('state') === 'shop', '「收下」回商店');
  }
  E.run('bxRes = null; state = "shop";');
  E.tapRect(E.run('shopLayout().box.ad'));
  ok(E.run('state') === 'shop' && /用完/.test(E.run('shopMsg')), '第 4 次：今天用完了，不放广告');
  E.run('meta.bx.ad.d = "2000-1-1";');
  ok(E.run('bxAdLeft()') === 3, '第二天：又是 3 次');
}

console.log('6) 自己攒的宝箱');
{
  const E = makeEnv();
  E.run('meta.runs = 5; meta.bx.n = 0;'); E.step(2);
  E.run('openShop("box");'); E.step(1);
  E.tapRect(E.run('shopLayout().box.open1'));
  ok(E.run('state') === 'shop' && /还没有宝箱/.test(E.run('shopMsg')), '没有宝箱：说怎么拿');
  E.run('meta.bx.n = 3;');
  E.tapRect(E.run('shopLayout().box.open1'));
  ok(E.run('state') === 'box' && E.run('meta.bx.n') === 2 && E.run('bxRes.list.length') === 1, '开一个：剩 2 个');
  E.tap(5, 5);
  E.run('bxRes.at = -1e9;');
  E.tapRect(E.run('boxLayout().again'));
  ok(E.run('meta.bx.n') === 1 && E.run('state') === 'box', '开箱页「再开一个」：剩 1 个');
  E.run('bxRes.at = -1e9;');
  E.tapRect(E.run('boxLayout().back'));
  ok(E.run('state') === 'shop' && !E.run('bxRes'), '「收下」：回商店');
  E.run('meta.bx.n = 12;');
  E.tapRect(E.run('shopLayout().box.openAll'));
  ok(E.run('meta.bx.n') === 0 && E.run('bxRes.list.length') === 12, '全部打开：12 个一起开');
}

console.log('7) 仓库道具');
{
  const E = makeEnv();
  E.run('meta.runs = 5; meta.bx.inv = { ruler: 0, stink: 2, ghost: 1, magnet: 0 };'); E.step(2);
  E.run('openShop("box");'); E.step(1);
  E.tapRect(E.run('shopLayout().box.slots[2]'));
  ok(E.run('meta.bx.carry') === 'ghost' && E.run('bxCarry()') === 'ghost', '点仓库里的鬼火：带它上场');
  E.tapRect(E.run('shopLayout().box.slots[0]'));
  ok(E.run('meta.bx.carry') === 'ghost' && /没有黑板尺/.test(E.run('shopMsg')), '点没有的黑板尺：不换，说开宝箱能开出来');
  E.run('meta.bx.carry = "stink";');
  play(E);
  ok(E.run('bxCanUse()'), '开局：左斩上面的道具键能点');
  const pb = E.run('hPropBtn()');
  E.tap(pb.x, pb.y); E.step(1);
  ok(E.run('hPropOn("stink")') && E.run('meta.bx.inv.stink') === 1 && E.run('bxUsed') === 1, '点了：臭水生效，仓库剩 1 个');
  E.tap(pb.x, pb.y); E.step(1);
  ok(E.run('meta.bx.inv.stink') === 1 && E.run('bxUsed') === 1, '臭水还在生效：再点不叠');
  E.run('hProp.t = 0.01;'); E.step(3);
  E.tap(pb.x, pb.y); E.step(1);
  ok(E.run('hPropOn("stink")') && E.run('meta.bx.inv.stink') === 0 && E.run('bxUsed') === 2, '用完了再点：第二个');
  E.run('hEndProp(); meta.bx.inv.ghost = 3;'); E.step(1);
  ok(!E.run('bxCanUse()') && E.run('bxCarry()') === 'ghost', '一局最多 ' + E.run('BOX.useMax') + ' 个：不能再用（臭水没了，换成剩得多的鬼火，也不行）');
  E.run('hPressSide = 0;');
  E.tap(pb.x, pb.y); E.step(1);
  ok(E.run('meta.bx.inv.ghost') === 3 && E.run('hPressSide') === 0, '用满了：键还在（灰着），点了不用、也不误斩右边');
  const bb = E.run('hBurstBtn()');
  ok(pb.x === bb.x && pb.y + pb.r < bb.y - bb.r, '道具键在右边「连斩」键正上方（用户："道具放在连斩的上面，而且整局都在"）');
  // 下一局又能用
  E.run('state = "dead";'); E.run('startHorde();'); E.run('P.inv = 1e9;'); E.step(2);
  ok(E.run('bxUsed') === 0 && E.run('bxCanUse()'), '下一局：又能用 2 个');
}

console.log('8) 存档');
{
  const E = makeEnv();
  E.run('meta.bx = { n: 4, pity: 17, sh: { rain: 3, king: 20 }, inv: { ruler: 1, stink: 0, ghost: 2, magnet: 5 }, carry: "magnet", ad: { d: bxToday(), n: 2 }, mig: 1 }; saveMeta();');
  const F = makeEnv(JSON.parse(E.storage.dash_meta_v1));
  ok(JSON.stringify(J(F, 'meta.bx')) === JSON.stringify(J(E, 'meta.bx')), '存进去读得回来（攒的箱子、保底数、碎片、仓库、带哪个、今天看了几次广告）');
  const G = makeEnv({ bx: { n: -3, pity: 'x', sh: { rain: -1 }, inv: { stink: 'a', wat: 9 }, carry: 'wat', ad: 7 } });
  ok(G.run('meta.bx.n') === 0 && G.run('meta.bx.pity') === 0 && G.run('meta.bx.sh.rain') === 0 && G.run('meta.bx.inv.stink') === 0 && G.run('meta.bx.inv.wat') === undefined && G.run('meta.bx.carry') === '',
    '坏数据：负数、乱写的都修好，不认识的道具不读');
}

console.log('9) 画得出来');
{
  const E = makeEnv();
  E.run('meta.runs = 5; meta.bx.n = 3; meta.bx.inv.stink = 2;'); E.step(2);
  E.run('openShop("box");'); E.texts.length = 0; E.step(1);
  ok(E.texts.indexOf('有 3 个宝箱没开') >= 0 && E.texts.indexOf('开一个') >= 0 && E.texts.indexOf('150 颗嘉欣糖 · 买一个') >= 0 && E.texts.some(t => t.indexOf('看广告 · 十连抽') === 0) && E.texts.indexOf('臭水 ×2') >= 0,
    '「宝箱」页：有几个、开一个、糖买、广告十连、仓库');
  E.tapRect(E.run('shopLayout().box.odds')); E.texts.length = 0; E.step(1);
  ok(E.run('shopOdds') && E.texts.indexOf('宝箱概率') >= 0 && E.texts.indexOf('普通宝箱') >= 0 && E.texts.indexOf('广告十连') >= 0 && E.texts.indexOf('9%') >= 0 && E.texts.indexOf('35%') >= 0, '「概率」：普通宝箱、广告十连两列，公示概率和保底');
  E.tap(10, 10);
  ok(!E.run('shopOdds') && E.run('state') === 'shop', '点任意处关掉');
  E.run('Math.random = function () { return 0.1; };');
  E.run('bxOpenOwn(3); bxRes.at = -1e9;'); E.texts.length = 0; E.step(1);
  ok(E.texts.indexOf('开了 3 个宝箱') >= 0 && E.texts.indexOf('收下') >= 0, '开箱页：开了几个、每个开出什么、「收下」');
  play(E, 'meta.bx.carry = "stink";');
  let err = null; try { E.run('render();'); } catch (e) { err = e; }
  ok(!err && E.run('bxCanUse()'), '局里的道具键画得出来', err && err.message);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
