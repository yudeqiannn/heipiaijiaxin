/* 嘉豪皮肤（2.13 节）测试 —— 用户："加一个皮肤系统"：换"嘉豪本人、刀和刀光、还有专属技能"，"糖买或看广告都行"，
   "你出一版，但是必须要常规玩的时候感觉肝，有看广告的欲望"
   1) 皮肤表：原版 + 五款，价格 1200 / 1800 / 3000 / 4400 / 8000 颗，或看 3 / 4 / 6 / 8 / 15 次广告
   2) 商店：糖够就买下穿上，不够说差几颗；有了的点一下换上；存进存档
   3) 看广告：看完一次进度 +1，没看完不算，够了就有了、马上穿上
   4) 技能（只在黑潮里）：雨中漫步 / 虚空打碟 / 太显眼了 / 十年前的仇 / 豪无敌手
   5) 画得出来：商店、局里每一款；装饰一两笔 */
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
  const ops = { fill: 0, stroke: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (k === 'fill' || k === 'stroke' || k === 'fillRect' || k === 'drawImage' || k === 'fillText' || k === 'strokeText') return () => { ops[k] = (ops[k] || 0) + 1; };
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
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
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
  return { run, step, tap, tapRect, tapDash, ops, storage };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局黑潮（主界面点任意处）：挡路的清掉、黑潮停在屏幕外不动，场面由各项自己摆
function fresh(seed) {
  const E = makeEnv(seed);
  E.run('meta.runs = 5;'); E.step(5);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 0;');
  return E;
}
// 把道具摆到身前 dy、往右 dx
function putItem(E, k, dx, dy) {
  E.run('hItem = { k: "' + k + '", x: P.x + ' + (dx || 0) + ', y: wwrap(P.y - ' + dy + '), t: 0 }; hPropNext = Infinity;');
}


const wanted = [['base', 0, 0], ['rain', 1200, 3], ['dj', 1800, 4], ['flashy', 3000, 6], ['revenge', 4400, 8], ['king', 8000, 15]];

console.log('1) 皮肤表');
{
  const E = makeEnv();
  const t = JSON.parse(E.run('JSON.stringify(HERO_SKINS.map(s => [s.id, s.price, s.ads]))'));
  ok(JSON.stringify(t) === JSON.stringify(wanted), '原版 + 五款，价格 / 广告次数照方案', JSON.stringify(t));
  ok(E.run('heroSkin().id') === 'base' && E.run('heroOwned(HERO_SKIN.base)'), '默认穿原版');
  ok(E.run('HERO_SKINS.slice(1).every(s => s.light && s.cloak && s.blade && s.body && s.deco && s.skill && s.sname && s.sdesc)'), '每款都有自己的样子、刀光、装饰、技能');
}

console.log('2) 商店「皮肤」页：糖不能买（用户："糖可以买箱子，不可以买皮肤了"），有了的点一下穿上');
{
  const E = makeEnv();
  E.run('meta.runs = 5; meta.candy = 5000;'); E.step(3);
  E.tapRect(E.run('readyCandyBtn()'));
  ok(E.run('state') === 'shop' && E.run('shopTab') === 'box', '主界面左上角进商店（先到「宝箱」页）');
  E.tapRect(E.run('shopLayout().tabs.skin'));
  ok(E.run('shopTab') === 'skin', '点「皮肤」');
  const L = E.run('shopLayout()');
  ok(L.cards.length === 6 && L.cards[5].y + L.cards[5].h <= L.back.y, '六行，不压到「返回」');
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '商店画得出来', err && err.message);
  E.tapRect(L.cards[1]);
  ok(E.run('heroOwned(HERO_SKIN.rain)') === false && E.run('meta.candy') === 5000 && /碎片：0 \/ 20/.test(E.run('shopMsg')), '糖再多也买不了：说碎片攒了几片', E.run('shopMsg'));
  E.run('meta.hs.own.rain = 1;');
  E.tapRect(L.cards[1]);
  ok(E.run('heroSkin().id') === 'rain' && E.run('meta.candy') === 5000, '有了：点这一行穿上，不花糖');
  const saved = JSON.parse(E.storage.dash_meta_v1);
  ok(saved.hs.own.rain === 1 && saved.hs.on === 'rain', '存进存档');
  E.tapRect(L.cards[0]);
  ok(E.run('heroSkin().id') === 'base', '点原版那一行：换回原版');
  E.tapRect(L.cards[1]);
  ok(E.run('heroSkin().id') === 'rain', '再点雨中嘉豪：换回来');
  const E2 = makeEnv(JSON.parse(E.storage.dash_meta_v1));
  ok(E2.run('heroSkin().id') === 'rain', '下次打开：还穿着');
  const E3 = makeEnv({ candy: 5, hs: { own: {}, ads: {}, on: 'king' } });
  ok(E3.run('heroSkin().id') === 'base', '存档里穿着没有的：当原版');
}

console.log('3) 碎片：开宝箱攒，集齐就有（2.16 节）；以前看过的皮肤广告折成碎片');
{
  const E = makeEnv();
  E.run('meta.hs.own = { dj: 1, flashy: 1, revenge: 1, king: 1 }; meta.bx.sh = { rain: 19 }; meta.bx.pity = 0;');
  const r = JSON.parse(E.run('JSON.stringify(bxPull(true))'));
  ok(r.k === 'shard' && r.id === 'rain' && r.done && E.run('heroOwned(HERO_SKIN.rain)'), '雨中嘉豪 19 / 20 片，再开出碎片：集齐了、有了', JSON.stringify(r));
  const M = makeEnv({ hs: { own: {}, ads: { dj: 2, rain: 3 }, on: 'base' } });
  ok(M.run('meta.bx.sh.dj') === 15 && M.run('heroOwned(HERO_SKIN.rain)') && M.run('meta.bx.mig') === 1,
    '以前看过广告：打碟 2 / 4 次 → 15 / 30 片；雨中嘉豪看满 3 次 → 直接有了', M.run('JSON.stringify(meta.bx.sh)'));
  const M2 = makeEnv(JSON.parse(M.storage.dash_meta_v1));
  ok(M2.run('meta.bx.sh.dj') === 15, '只折一次（再打开不会再加）');
}

// 穿上某款开一局黑潮
function run(id, extra) {
  const E = makeEnv({ hs: { own: { [id]: 1 }, ads: {}, on: id } });
  E.run('HD.lives = 3; meta.runs = 5; HD.autoRun = true;' + (extra || '')); E.step(3);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hPath.length = 0; hPathLive = false; hCandy = []; hCandyNext = 1e12; hPropNext = 1e12; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax());');   // 不刷怪（路线也停）
  E.step(2);
  return E;
}

console.log('4) 技能');
{
  // 雨中漫步：涌浪的时候跑快 30%
  const B = run('base'), Rn = run('rain');
  for (const E of [B, Rn]) { E.run('hSurge = 2; hSurgeP = 0; HD.surgeTime = 99;'); E.step(40); }
  const vb = -B.run('P.vy'), vr = -Rn.run('P.vy');
  ok(Math.abs(vr / vb - 1.3) < 0.03, '雨中漫步：涌浪时跑 ' + vr.toFixed(0) + '（原版 ' + vb.toFixed(0) + '）', (vr / vb).toFixed(2));
  Rn.run('hSurge = 0;'); Rn.step(40);
  ok(Math.abs(-Rn.run('P.vy') - vb) < 5, '没涌浪：跟原版一样快', Rn.run('P.vy'));
  // 虚空打碟：连斩每满 10 一圈音波
  const D = run('dj');
  D.run('P.inv = 1e9; combo = 9; comboTimer = 9; hDjN = 0; [[60, -40, "grunt"], [-90, 60, "charger"], [40, 120, "bomb"], [-50, -100, "heavy"], [400, -400, "grunt"]].forEach(a => { const e = spawnEnemy(P.x + a[0], P.y + a[1], a[2]); e.sp = 0; e.born = 1; });');
  D.step(1);
  ok(D.run('enemies.length') === 5, '连斩 9：还没响');
  D.run('combo = 10;'); D.step(1);
  ok(D.run('enemies.filter(e => !e.heavy && !e.bomb && Math.hypot(e.x - P.x, wdelta(e.y - P.y)) < 300).length') === 0 && D.run('enemies.length') === 3,
     '连斩满 10：身边的杂兵、冲锋者斩了；重型、爆裂者、远处的不管', D.run('enemies.map(e => e.heavy ? "重" : e.bomb ? "爆" : "远").join()'));
  const n1 = D.run('enemies.length'); D.step(5);
  ok(D.run('enemies.length') === n1, '一个 10 只响一次');
  const B2 = run('base');
  B2.run('P.inv = 1e9; combo = 9; comboTimer = 9; { const e = spawnEnemy(P.x + 60, P.y - 40, "grunt"); e.sp = 0; e.born = 1; } combo = 10;'); B2.step(2);
  ok(B2.run('enemies.length') === 1, '原版：不响');
  // 太显眼了：糖多拿 50%
  const F = run('flashy');
  F.run('for (let i = 0; i < 4; i++) hEatCandy(P.x, P.y);');
  ok(F.run('hCandyRun') === 6, '太显眼了：捡 4 颗算 6 颗', F.run('hCandyRun'));
  // 十年前的仇：掉命时自动回头连斩
  const V = run('revenge');
  V.run('hRage = 20; P.inv = 0; hHurtT = 0; hFront = wwrap(P.y - 5);'); V.step(2);   // 潮头已经漫过嘉豪：一定掉命（放在身后 20 的话，墨里的怪是随机摆的，偶尔两帧都碰不到）
  ok(V.run('hLives') === 2 && V.run('hBurst !== null'), '十年前的仇：掉一条命，马上回头连斩', V.run('hLives'));
  ok(V.run('hRage') === 20, '不用怒气（攒的怒气还在）', V.run('hRage'));
  const B3 = run('base');
  B3.run('hRage = 20; P.inv = 0; hHurtT = 0; hFront = wwrap(P.y - 5);'); B3.step(2);   // 潮头已经漫过嘉豪：一定掉命（放在身后 20 的话，墨里的怪是随机摆的，偶尔两帧都碰不到）
  ok(B3.run('hLives') === 2 && B3.run('hBurst') === null, '原版：掉命不连斩');
  // 豪无敌手：4 条命、怒气快 30%
  const K = run('king');
  ok(K.run('hLives') === 4 && K.run('hMaxLives()') === 4, '豪无敌手：4 条命', K.run('hLives'));
  K.run('hRage = 0; hAddRage(10);');
  ok(Math.abs(K.run('hRage') - 13) < 1e-6, '怒气快 30%（10 → 13）', K.run('hRage'));
  K.run('P.inv = 0; hHurtT = 0; hLives = 1; hFront = wwrap(P.y + 20);'); K.step(3);
  K.step(Math.ceil((K.run('DEAD_LOOK') + 0.4) / 0.0167));
  K.tapRect(K.run('hordeEndBtns().revive')); K.run('finishAd();');
  ok(K.run('hLives') === 4, '看广告复活：回来也是 4 条');
  ok(run('base').run('hLives') === 3, '原版：3 条');
}

console.log('5) 画得出来');
{
  for (const [id] of wanted) {
    const E = run(id);
    E.run('isTouch = true;');
    let err = null;
    try { E.step(5); E.run('render();'); } catch (e) { err = e; }
    ok(!err, HERO_N(E, id) + '：局里画得出来', err && err.message);
    const n = (() => { E.ops.fill = 0; E.ops.stroke = 0; E.run('const s = heroSkin(); if (s.deco) drawHeroDeco(s, P.x, P.y, P.ang, P.r, gameTime);'); return E.ops.fill + E.ops.stroke; })();
    ok(n <= 2, '  装饰 ' + n + ' 笔', n);
  }
}
function HERO_N(E, id) { return E.run('HERO_SKIN["' + id + '"].name'); }

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
