/* 死得明白、不冤死（用户："斩完他往一个方向去，那个方向正好有一个怪物，根本反应不过来"）
   1) 重型：砍开外壳也清冷却；硬甲那段时间愣在原地、撞不死人、自动连斩不锁它
   2) 砍空：锁了目标却让它挪开了只等 aimMissCd；目标先被别的东西弄死了不算砍空；空挥照旧等满；砍碎晶柱清冷却
   3) 爆裂者：斩它的那一刀穿出爆炸圈；自己的冲击波 / 剑气引爆的炸怪不炸你；快炸圈里的怪不锁，落点在圈里冲出去
   4) 死因记清楚：收刀后多少毫秒、凶手亮着多久、冤死统计；死亡页先晚 DEAD_LOOK 秒出来（凶手圈红），这段时间点了不算
   5) 按住斩：下一刀去哪画准星（画得出来） */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(h) {
  h = h || 844;
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000, raf = null;
  const ac = {
    get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      return t[k] !== undefined ? t[k] : function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const storage = {};
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
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const f = raf; raf = null; if (!f) break; simT += 16.7; f(simT); } }
  const tap = (x, y) => run('onTouchStart({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] }); onTouchEnd({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  return { run, step, tap, tapRect };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局干净的场：不刷怪、不合围、没有晶柱、光不掉
function fresh(E) {
  E.run('meta.tut = TUT_DONE; CFG.lightT0 = Infinity;'); E.step(3);
  E.run('start(); enemies.length = 0; crystals.length = 0; spawnTimer = 1e9; waveTimer = 1e9; scoutLeft = 0; crystalTimer = 1e9; layerFxT = 0; P.inv = 0;');
  E.step(2);
  E.run('enemies.length = 0; spawnTimer = 1e9; waveTimer = 1e9; P.inv = 0;');
}
const put = (E, dx, dy, type) => E.run('(function () { const e = spawnEnemy(P.x + ' + dx + ', P.y + ' + dy + ', "' + (type || 'grunt') + '"); e.sp = 0; e.born = 1; __L = e; return enemies.length; })()');
const upd = (E, n) => E.run('for (let i = 0; i < ' + (n || 1) + ' && state === "play"; i++) update(1 / 60);');

console.log('1) 重型');
{
  const E = makeEnv();
  fresh(E);
  put(E, 100, 0, 'heavy');
  E.run('__H = __L; P.cd = 0; tryDash(null);');
  upd(E, 12);
  ok(E.run('__H.cracked') && E.run('enemies.indexOf(__H) >= 0'), '第一刀砍开外壳，它还活着');
  ok(E.run('P.cd') === 0, '砍开外壳也算砍中：冷却清零', E.run('P.cd'));
  ok(E.run('wdist(P.x, P.y, __H.x, __H.y)') > E.run('P.r + __H.r'), '这一刀穿过它的身子，不停在它身上', E.run('wdist(P.x, P.y, __H.x, __H.y)').toFixed(0));
  E.run('__H.sp = 200; __hx = __H.x; __hy = __H.y; __H.armorT = 0.3;');
  upd(E, 6);
  ok(E.run('__H.x === __hx && __H.y === __hy'), '硬甲那段时间：愣在原地不追人');
  E.run('P.x = __H.x + 5; P.y = __H.y; P.px = P.x; P.py = P.y; P.inv = 0; P.dashT = 0; P.glideT = 0;');
  upd(E, 1);
  ok(E.run('state') === 'play', '碰到愣住的重型：撞不死人');
  ok(E.run('lockOn(null)') === null, '圈里只有愣住的重型：自动连斩不锁它（砍了也滑开）');
}

console.log('2) 砍空');
{
  const E = makeEnv();
  fresh(E);
  put(E, 120, 0);
  E.run('__A = __L; tryDash({ x: __A.x, y: __A.y, ref: __A }); __A.y += 200;');     // 冲出去以后它挪开了
  upd(E, 12);
  ok(E.run('enemies.indexOf(__A) >= 0') && E.run('P.cd') <= E.run('CFG.aimMissCd') + 1e-9, '对准了却让它挪开：只等 ' + E.run('CFG.aimMissCd') + ' 秒', E.run('P.cd'));
  E.run('P.cd = 0; P.dashT = 0;');
  put(E, -120, 0);
  E.run('__B = __L; tryDash({ x: __B.x, y: __B.y, ref: __B }); enemies.splice(enemies.indexOf(__B), 1);');   // 冲到之前它被别的东西弄死了
  upd(E, 12);
  ok(E.run('P.cd') === 0, '目标先被别的东西弄死了：不算砍空', E.run('P.cd'));
  E.run('P.cd = 0; P.dashT = 0; enemies.length = 0; tryDash(null);');
  upd(E, 12);
  ok(E.run('P.cd') > 0.2, '对着空气乱挥：照旧等满', E.run('P.cd'));
  E.run('P.cd = 0.5; buildCrystals(); shatterCrystal(0);');
  ok(E.run('P.cd') === 0, '砍碎晶柱也算砍中：冷却清零');
}

console.log('3) 爆裂者');
{
  const E = makeEnv();
  fresh(E);
  put(E, 100, 0, 'bomb');
  E.run('__Bm = __L; __bx = __Bm.x; __by = __Bm.y; P.cd = 0; tryDash({ x: __Bm.x, y: __Bm.y, bomb: true, ref: __Bm });');
  upd(E, 14);
  ok(E.run('enemies.indexOf(__Bm) < 0') && E.run('blasts.length') === 1, '斩了它：留下一条引信');
  ok(E.run('wdist(P.x, P.y, __bx, __by)') > E.run('CFG.bombR + P.r'), '这一刀穿出爆炸圈才停', E.run('wdist(P.x, P.y, __bx, __by)').toFixed(0));
  upd(E, 60);
  ok(E.run('state') === 'play', '引信到了炸开：人在圈外，没事');

  const F = makeEnv();
  fresh(F);
  put(F, 40, 0, 'bomb');
  F.run('killEnemy(enemies.indexOf(__L), "shield"); P.inv = 0; P.dashT = 0;');
  upd(F, 60);
  ok(F.run('state') === 'play', '自己的冲击波引爆的：炸怪不炸你');

  const G = makeEnv();
  fresh(G);
  G.run('blasts.push({ x: P.x + 150, y: P.y, t: 0, fuse: 9, r: CFG.bombR });');
  put(G, 150, 0);
  ok(G.run('lockOn(null)') === null && G.run('lockOn({ x: 1, y: 0 })') === null, '快炸的圈里的怪：自动连斩不锁（反正要被炸死）');
  put(G, 60, 0);
  G.run('__C = __L; P.cd = 0; tryDash({ x: __C.x, y: __C.y, ref: __C });');
  upd(G, 40);
  ok(!G.run('inBlast(P.x, P.y, P.r)'), '落点在快炸的圈里：顺着方向冲出圈再停', G.run('Math.round(P.x - (blasts[0].x))'));
}

console.log('4) 死因记清楚');
{
  const E = makeEnv();
  fresh(E);
  E.run('lastDashEnd = gameTime - 0.12;');
  put(E, 200, 0);
  E.run('__K = __L; __K.litT = 0.25; __K.x = P.x + 10; P.inv = 0; P.dashT = 0; P.glideT = 0;');
  upd(E, 1);
  ok(E.run('state') === 'dead', '撞上：死');
  const d = E.run('runDeaths[runDeaths.length - 1]');
  ok(d[0] === '杂兵' && Math.abs(d[3] - 137) < 25 && d[4] >= 250 && d[4] < 300, '记下收刀后 ' + d[3] + 'ms、凶手亮着 ' + d[4] + 'ms', JSON.stringify(d));
  ok(E.run('deathMark && !deathMark.blast && Math.abs(deathMark.ux + 1) < 0.01'), '凶手：从右边撞过来的（标记方向朝左指向你）');
  ok(E.run('JSON.stringify(unfairDeaths(runDeaths))') === '[1,1]', '冤死统计：1 / 1');
  E.step(10);
  E.tapRect(E.run('deadBtns().revive'));
  ok(E.run('state') === 'dead', '死亡页还没出来（先看清是谁）：点了不算');
  let err = null;
  try { E.run('render();'); E.step(40); E.run('render();'); } catch (e) { err = e; }
  ok(!err, '凶手圈红 / 死亡页都画得出来', err && err.message);
  E.run('finishRun();');
  ok(/冤死（收刀 0.3 秒内被撞、它亮出来不到 0.4 秒）：1 \/ 1 次撞死/.test(E.run('testReport().join("\\n")')), '报告里写着冤死统计');
  ok(/杂兵（第1层 \d+秒 · 收刀后 \d+ms · 它亮着 0\.\d 秒）/.test(E.run('testReport().join("\\n")')), '死因后面带上细节');
}

console.log('5) 准星');
for (const h of [844, 667]) {
  const E = makeEnv(h);
  fresh(E);
  put(E, 120, 0); put(E, -90, 40, 'bomb');
  E.run('attackHeld = true; P.cd = 1;');
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err && E.run('lockOn(inputDir()) !== null'), h + 'px：按住斩，下一刀的目标画准星', err && err.message);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
