/* 班主任 + 提前按也算 测试 —— 用户："干脆就叫班主任好了"；"班主任眼前不能打架之类的，我觉得可能更有创意"；
   （之前说"现在玩家基本上就是无脑左右，不会判断"）
   1) 提前按也算：闪的过程中按的，落地马上出刀；太早按的（落地后 tapBuf 秒以外）不算
   2) 班主任什么时候出：第 teachFrom 秒以前不出；之后摆在屏幕顶外、走廊边上；掉到身后收掉
   3) 视线：扇形里面算、外面 / 太远不算；左右慢慢扫
   4) 被抓：要斩的那只在视线里、或者人在视线里，出刀就被抓（不出刀、愣一下、黑潮往前扑）；愣着的时候点了没用，过了照常
   5) 画：视线里的准星打红叉；第一次见到弹一张卡，只弹一次
   6) 势头：斩中 +、点空 / 被抓 −、发呆慢慢掉、掉命回 1 档；速度跟着变；闪的时候按、落地点空也掉；
      3 档以上撞上小怪撞飞（掉 1 档、爆裂者不行）、第一次够档弹卡；脚下小格、速度线 */
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
  return { run, step, tap, tapRect, tapDash, down, up, ops, storage, texts };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

const J = (E, c) => JSON.parse(E.run('JSON.stringify(' + c + ')'));
function play(E, pre) {
  E.run('state = "ready"; meta.runs = 5;' + (pre || '')); E.step(3);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hPath.length = 0; hPathLive = false; hCandy = []; hCandyNext = 1e12; hPropNext = 1e12; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9; HD.autoRun = false; P.vx = 0; P.vy = 0;');
  E.step(2);
}
// 身前右边摆一只站着不动的
function foe(E, dx, dy) { return E.run('(function () { var e = spawnEnemy(P.x + ' + dx + ', wwrap(P.y - ' + dy + '), "grunt"); e.sp = 0; e.born = 1; return enemies.indexOf(e); })()'); }
const tapR = E => E.tap(290, 790), tapL = E => E.tap(100, 790);

console.log('1) 提前按也算');
{
  const E = makeEnv();
  play(E);
  foe(E, 90, 200); foe(E, 160, 420);
  E.step(1);
  tapR(E); E.step(1);
  ok(E.run('P.dashT > 0'), '第一刀出去了');
  const n0 = E.run('enemies.length');
  tapR(E);
  ok(E.run('!!hTapBuf && hTapBuf.s === 1'), '还在闪的时候按右斩：先记着');
  let f = 0;
  while (E.run('enemies.length') > n0 - 2 && f < 120) { E.step(1); f++; }
  ok(E.run('enemies.length') === n0 - 2, '落地以后自己出了第二刀，两只都斩了（只按了两下）', E.run('enemies.length'));
  // 太早按的不算：记下来以后过了好久才落地
  E.step(60);
  E.run('hTapBuf = { s: 1, t: gameTime - 2 };');
  foe(E, 90, 200); E.step(3);
  ok(E.run('!hTapBuf') && E.run('P.dashT <= 0'), '按了两秒多以前的那一下：不算，不自己出刀', E.run('JSON.stringify({ b: hTapBuf, d: P.dashT, cd: P.cd })'));
}

console.log('2) 什么时候出');
{
  const E = makeEnv();
  play(E);
  E.run('hDiffT = 30; hTop = 2000 * HD.m;'); E.step(5);
  ok(E.run('hTeach.length') === 0, '第 30 秒（' + E.run('HD.teachFrom') + ' 秒以前）：不出');
  E.run('hDiffT = 70; hTeachNext = 0;'); E.step(2);
  E.run('hTop += 30 * HD.m;'); E.step(2);
  const T = J(E, 'hTeach[0] || null');
  ok(T && Math.abs(Math.abs(T.x - E.run('hX0')) - (E.run('W') / 2 - 60)) < 1 && E.run('wdelta(hTeach[0].y - cam.y)') < -E.run('H / 2'), '第 70 秒以后：摆在屏幕顶外、走廊边上');
  E.run('hTeach[0].y = wwrap(P.y + H);'); E.step(2);
  ok(E.run('hTeach.length') === 0, '掉到身后：收掉');
  E.run('hTeach = []; hTeachNext = hTop; hDiffT = 70;'); E.step(1);
  const gap1 = E.run('(hTeachNext - hTop) / HD.m');
  E.run('hTeach = []; hTeachNext = hTop; hDiffT = HD.heat0 + 300;'); E.step(1);
  const gap2 = E.run('(hTeachNext - hTop) / HD.m');
  ok(gap1 >= 0.79 * (E.run('HD.teachEvery') - E.run('HD.teachHeat') * (70 - E.run('HD.heat0')) / 60) && gap2 < gap1 && gap2 >= E.run('HD.teachMin') * 0.79, '越往后越密：下一个隔 ' + Math.round(gap1) + ' 米 → ' + Math.round(gap2) + ' 米（最近 ' + E.run('HD.teachMin') + '）');
}

console.log('3) 视线');
{
  const E = makeEnv();
  play(E);
  // 站在主角左边 300，视线正对右边（不扫）
  E.run('HD.teachSweep = 0; hTeach = [{ x: P.x - 300, y: P.y, base: 0, ph: 0, angry: 0 }];');
  ok(!!E.run('hInGaze(P.x, P.y)'), '正对着：主角在视线里');
  ok(!E.run('hInGaze(P.x, P.y - 200)'), '偏出半角以外：不算');
  ok(!E.run('hInGaze(P.x + 200, P.y)'), '比视线远：不算（视线 ' + E.run('HD.teachR') + '）');
  E.run('HD.teachSweep = 38;');
  const a0 = E.run('hTeachDir(hTeach[0])'); E.step(40);
  ok(Math.abs(E.run('hTeachDir(hTeach[0])') - a0) > 0.05, '视线左右慢慢扫');
}

console.log('4) 被抓');
{
  const E = makeEnv();
  play(E);
  const i = foe(E, 90, 200);
  E.run('HD.teachSweep = 0; var __e = enemies[' + i + ']; hTeach = [{ x: __e.x - 250, y: __e.y, base: 0, ph: 0, angry: 0 }];');   // 正对着那只怪，人不在视线里
  E.step(1);
  ok(!E.run('hInGaze(P.x, P.y)') && !!E.run('hInGaze(__e.x, __e.y)'), '摆好：怪在视线里、人不在');
  const g0 = E.run('hGap()'), n0 = E.run('enemies.length');
  tapR(E); E.step(1);
  ok(E.run('P.dashT <= 0') && E.run('enemies.length') === n0 && E.run('hCaughtT') > 0 && E.run('hCaughtN') === 1, '斩视线里的那只：不出刀，被抓（愣 ' + E.run('HD.teachStun') + ' 秒）');
  ok(E.run('hGap()') < g0 - 100 && E.run('hGap()') >= 80, '黑潮往前扑了一截（' + Math.round(g0) + ' → ' + Math.round(E.run('hGap()')) + '），不会扑过头');
  ok(E.run('hTeach[0].angry') > 0, '班主任发红');
  E.run('hTeach[0].x = __e.x + 2000;'); tapR(E); E.step(1);
  ok(E.run('P.dashT <= 0') && E.run('enemies.length') === n0, '愣着的时候：视线挪开了也出不了刀');
  E.step(Math.ceil(E.run('HD.teachStun') * 60) + 5);
  tapR(E); E.step(1);
  ok(E.run('P.dashT > 0'), '愣完了、视线也不看着：照常斩');
  // 人在视线里：斩哪只都被抓
  const F = makeEnv();
  play(F);
  foe(F, 90, 200);
  F.run('HD.teachSweep = 0; hTeach = [{ x: P.x - 200, y: P.y + 40, base: -0.2, ph: 0, angry: 0 }];');
  F.step(1);
  ok(!!F.run('hInGaze(P.x, P.y)'), '摆好：人在视线里');
  tapR(F); F.step(1);
  ok(F.run('hCaughtN') === 1 && F.run('P.dashT <= 0'), '人在视线里：出刀就被抓');
}

console.log('5) 画');
{
  const E = makeEnv();
  play(E);
  const i = foe(E, 90, 200);
  E.texts.length = 0;
  E.run('meta.seen.teach = 0; HD.teachSweep = 0; var __e = enemies[' + i + ']; hTeach = [{ x: __e.x - 250, y: __e.y, base: 0, ph: 0, angry: 0 }];');
  E.step(2);
  const popTexts = E.texts.slice();
  const s0 = E.ops.stroke || 0;
  E.run('drawAimAt(hAimTR, 1);');
  const withX = (E.ops.stroke || 0) - s0;
  E.run('hTeach = [];');
  const s1 = E.ops.stroke || 0;
  E.run('drawAimAt(hAimTR, 1);');
  ok(withX === (E.ops.stroke || 0) - s1 + 1, '视线里的准星多画一笔红叉');
  E.run('hTeach = [{ x: __e.x - 250, y: __e.y, base: 0, ph: 0, angry: 0 }];');
  ok(E.run('!!hTeachPop') && E.run('meta.seen.teach') === 1 && popTexts.indexOf('班主任') >= 0 && popTexts.indexOf('她看着的时候不能打架：') >= 0, '第一次见到：弹卡「班主任 · 她看着的时候不能打架」');
  E.run('hTeachPop = null;'); E.step(3);
  ok(!E.run('hTeachPop'), '只弹一次');
  let err = null; try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '画得出来', err && err.message);
}

console.log('6) 势头（用户："现在玩家基本上就是无脑左右，不会判断"；"就按照你感觉最好的改"）');
{
  const E = makeEnv();
  play(E);
  ok(E.run('hMom') === 0 && E.run('hMomK()') === 1, '开局 0 档，速度 1 倍');
  for (let i = 0; i < 4; i++) {
    foe(E, 90, 200); E.step(1); tapR(E);
    let f = 0; while (E.run('P.dashT > 0 || P.cd > 0') && f < 60) { E.step(1); f++; }
    E.step(2);
  }
  ok(Math.abs(E.run('hMom') - 4 * E.run('HD.momHit')) < 0.3, '斩中 4 只：' + E.run('hMom.toFixed(2)') + ' 档（每只 +' + E.run('HD.momHit') + '）');
  E.run('hMom = 3;');
  ok(Math.abs(E.run('hMomK()') - (1 + 3 * E.run('HD.momK'))) < 1e-9, '3 档：快 ' + Math.round(3 * E.run('HD.momK') * 100) + '%');
  // 点空（点一下就松）：掉档
  E.run('enemies.length = 0; P.cd = 0; P.dashT = 0;'); E.step(2);
  tapL(E); E.step(1);
  ok(Math.abs(E.run('hMom') - (3 - E.run('HD.momWhiff'))) < 0.05, '点空：掉 ' + E.run('HD.momWhiff') + ' 档（' + E.run('hMom.toFixed(2)') + '）');
  // 按住走（不是点一下）：不算点空
  E.run('hMom = 3;');
  const id = E.down(100, 790); E.step(30); E.up(id, 100, 790); E.step(1);
  ok(Math.abs(E.run('hMom') - 3) < 0.05, '按住往左斜着走（不是点一下就松）：不掉', E.run('hMom'));
  // 发呆：有能斩的却不斩
  E.run('hMom = 3; hMomLastT = gameTime;');
  foe(E, 90, 260); E.step(3);
  ok(E.run('!!hAimTR'), '右边有能斩的');
  E.step(Math.ceil((E.run('HD.momIdle') + 1) * 60));
  ok(E.run('hMom') < 2.5, '能斩却停着 ' + (E.run('HD.momIdle') + 1) + ' 秒：慢慢掉到 ' + E.run('hMom.toFixed(2)'));
  // 被班主任抓、掉命
  E.run('hMom = 4; HD.teachSweep = 0; var __e2 = hAimTR.ref; hTeach = [{ x: __e2.x - 250, y: __e2.y, base: 0, ph: 0, angry: 0 }]; hCaughtT = 0;');
  tapR(E); E.step(1);
  ok(Math.abs(E.run('hMom') - (4 - E.run('HD.momCaught'))) < 0.1, '被班主任抓：掉 ' + E.run('HD.momCaught') + ' 档');
  E.run('hTeach = []; hMom = 4.5; HD.lives = 3; hLives = 3; P.inv = 0; hLoseLife("测试"); P.inv = 1e9;');
  ok(E.run('hMom') === E.run('HD.momLife'), '掉一条命：回到 ' + E.run('HD.momLife') + ' 档');
  // 速度真的变快：闪的速度、走路的速度
  E.run('hMom = 0;'); const w0 = E.run('HD.walk * hTempo() * hSpeedK()');
  E.run('hMom = 5;'); const w5 = E.run('HD.walk * hTempo() * hSpeedK()');
  ok(Math.abs(w5 / w0 - (1 + 5 * E.run('HD.momK'))) < 1e-6, '满档走路快 ' + Math.round((w5 / w0 - 1) * 100) + '%（闪也一样）');
  // 闪的时候按、落地时那边没东西：也掉（狂点不能躲进"提前按也算"）
  E.run('hMom = 3; enemies.length = 0; hCaughtT = 0;'); foe(E, 90, 200); E.step(1);   // 刚才被抓的那 0.5 秒出不了刀
  tapR(E); E.step(1);
  ok(E.run('P.dashT > 0'), '出刀了');
  const m0 = E.run('hMom');
  tapL(E);
  let f = 0; while (E.run('!!hTapBuf') && f < 60) { E.step(1); f++; }
  E.step(1);
  ok(E.run('hMom') < m0 - 0.5, '闪的时候点了左边、落地时左边没东西：也算点空，掉档（' + m0.toFixed(2) + ' → ' + E.run('hMom.toFixed(2)') + '）');
  // 撞飞：3 档以上撞上小怪不死，掉 1 档；不够档撞上就掉命；爆裂者撞不得
  E.run('enemies.length = 0; hMom = 3.4; P.ang = -Math.PI / 2; P.vx = 0; P.vy = 0; P.inv = 0; P.cd = 0; P.dashT = 0; P.glideT = 0; lastDashEnd = -99; hLives = 3; meta.seen.mom = 0; hMomPop = null;');
  E.run('var __r = spawnEnemy(P.x, wwrap(P.y - 6), "grunt"); __r.sp = 0; __r.born = 1;');
  E.step(1);
  ok(E.run('enemies.indexOf(__r) < 0') && E.run('hLives') === 3, '3.4 档撞上小怪：撞飞了，没掉命');
  ok(Math.abs(E.run('hMom') - (3.4 - E.run('HD.momRamCost'))) < 0.05, '撞一下掉 ' + E.run('HD.momRamCost') + ' 档（' + E.run('hMom.toFixed(2)') + '）');
  E.run('P.inv = 0; hMom = 2.9; var __r2 = spawnEnemy(P.x, wwrap(P.y - 6), "grunt"); __r2.sp = 0; __r2.born = 1;');
  E.step(1);
  ok(E.run('hLives') === 2, '2.9 档撞上：不够，掉一条命');
  E.run('enemies.length = 0; P.inv = 0; hMom = 5; var __b = spawnEnemy(P.x, wwrap(P.y - 6), "bomb"); __b.sp = 0; __b.born = 1;');
  E.step(1);
  ok(E.run('hLives') === 1, '满档撞上爆裂者：照样掉命（爆裂者撞不得）');
  E.run('enemies.length = 0; P.inv = 1e9; hLives = 3; hMom = 2.5; hMomPop = null; meta.seen.mom = 0;');
  E.run('hMomAdd(0.6);');
  ok(E.run('!!hMomPop') && E.run('meta.seen.mom') === 1, '第一次攒到 3 档：弹一张卡');
  const p0 = E.ops.fillText || 0;
  E.run('drawMomPop();');
  ok(E.run('!!hMomPop'), '卡画得出来');
  E.step(Math.ceil(3.6 * 60));
  ok(!E.run('hMomPop'), '3.5 秒后收起');
  E.run('hMom = 2.5; hMomAdd(0.6);');
  ok(!E.run('hMomPop'), '只弹一次');
  // 画：脚下一排小格、3 档以上速度线
  E.run('hMom = 3.5;');
  const s0 = E.ops.stroke || 0;
  E.run('drawMomPips(); drawMomLines();');
  ok((E.ops.stroke || 0) - s0 === 3, '脚下小格（暗的一笔、亮的一笔）+ 速度线一笔');
  E.run('hMom = 1;');
  const s1 = E.ops.stroke || 0;
  E.run('drawMomLines();');
  ok((E.ops.stroke || 0) === s1, '3 档以下没有速度线');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
