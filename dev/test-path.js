/* 路线（HD.path）测试 —— 用户："刷怪机制也得改，搞成就是让玩家明确跟着怪物斩杀，然后往上走，不要现在这样随机生成，
   有的时候多个让玩家判断不了。就让玩家明确就得跟着怪物打。就是往左，往右"；选了"看得到后面几步""先只放普通小怪"
   1) 开局摆好一条路：一只接一只，每只在上一只的左前或右前（偏 20~32°、隔 230~270），不出正前方；只在中间；摆到屏幕顶外
   2) 只锁路上的下一只：它那一边锁它，另一边什么都不锁；后面几步够得着也不锁（走到贴脸的除外）；
      用户又说"怎么现在定住不动了？我要的怪物是动的！而且怎么怪物都黑了！根本看不清"：怪朝你走，后面几步跟下一只一样亮
   3) 照着点一路斩上去：每斩一只，下一只马上锁得上；点错边 = 点空，罚停
   4) 嘉欣糖摆在两步中间那段路上，斩过去顺手捡；道具是路上的一步
   5) 跟丢了：剩下的路散掉，从你身前重新摆；连斩清屏完、看广告复活也重新摆
   6) 只有普通小怪；机器人（反应 0.3 秒）跑一分钟：没东西可斩最长不到一秒
   （1~6 测的是"只有路线"（HD.pathMix = false）。用户试了说"不行，现在怪物太分散了"，接着说
   "要不这样，就还是可以有其他的怪，但是要给留出一条能看出来是能直接砍上去的路"：默认改成混着随机的，见 7）
   7) 混着随机的（默认）：一组组随机摆照旧（各种怪），离路太近的不摆；点下一只那边顺着路斩，另一边照以前斩别的；
      路跟丢了照样重摆；机器人跑一分钟
   8) 用户又说"我指的不是放个线，把路放出来，是怪物组成不同的队形拼出来"：不画线；路由一段段队形拼成（斜线 / 之字 / 台阶 / 弧），
      段里间隔、角度一样；两步中间再站一只（连成形），斩过去顺手带走；整队往下压，队形不散 */
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
  return { run, step, tap, tapRect, tapDash, ops, storage, down, up };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

// 开一局（自动往上跑），黑潮停在屏幕外不动、无敌；路已经摆好
// mix：混着随机摆的（默认）；不传 = 只有路线
function go(noProps, mix) {
  const E = makeEnv();
  // 难度不涨、四种队形一开始就全有（越来越难在 test-heat.js 里测）
  E.run('meta.runs = 5; HD.autoRun = true; HD.fillWait = 0.45; HD.pathMix = ' + !!mix + '; HD.heat0 = 1e9; HD.peakFrom = 1e9; HD.zigAt = 0; HD.stairAt = 0; HD.trailUntil = 0;' + (noProps ? ' PROP.on = false;' : '')); E.step(5);   // fillWait 照默认：跟丢了要重摆
  E.tap(195, 420);
  E.run('hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9;');
  E.step(2);
  return E;
}
const LX = 60, RX = 330, LY = 600, RY = 770;      // 左半屏、右半屏（右边避开「连斩」键）
const tapSide = (E, s) => s < 0 ? E.tap(LX, LY) : E.tap(RX, RY);
// 下一只在哪一边（-1 左 / 1 右 / 0 没有）
const headSide = E => E.run('hPathHead ? (wdelta(hPathHead.x - P.x) < 0 ? -1 : 1) : 0');
const rad = Math.PI / 180;
// 等这一刀走完（路上一步比一刀 184 远：冲完剩下那截用收刀的速度走，一刀约 0.3 秒）
const dashOut = E => { for (let j = 0; j < 60 && E.run('P.dashT > 0'); j++) E.step(1); E.step(2); };

console.log('1) 开局摆好一条路（只有路线）');
{
  const E = go(true);
  ok(E.run('HD.path') === true && E.run('hPathLive') === true, '路线开着');
  E.run('hPathStart();');                  // 刚摆好、还没开始走的时候量
  const n = E.run('hPath.length');
  ok(n >= 4, '路上摆了 ' + n + ' 步', n);
  let angOk = true, dOk = true, bandOk = true, kindOk = true, worst = '';
  for (let i = 1; i < n; i++) {
    const dx = E.run('wdelta(hPath[' + i + '].x - hPath[' + (i - 1) + '].x)'), dy = E.run('wdelta(hPath[' + i + '].y - hPath[' + (i - 1) + '].y)');
    const a = Math.atan2(Math.abs(dx), -dy) / rad, d = Math.hypot(dx, dy);
    if (!(a >= 15.9 && a <= 34.1)) { angOk = false; worst = a.toFixed(1) + '°'; }
    if (!(d >= 153.5 && d <= 315.5)) { dOk = false; worst = d.toFixed(0); }
  }
  for (let i = 0; i < n; i++) {
    if (Math.abs(E.run('hPath[' + i + '].x - hX0')) > E.run('HD.pathHalf') + 0.5) bandOk = false;
    if (!E.run('enemies.indexOf(hPath[' + i + ']) >= 0 && !hPath[' + i + '].heavy && !hPath[' + i + '].bomb && !hPath[' + i + '].charger && hPath[' + i + '].sp > 50')) kindOk = false;
  }
  ok(angOk, '每一步都在上一步的左前或右前，偏 16~34°（不出正前方）', worst);
  ok(dOk, '每一步隔 154~315（队形分挤 / 照旧 / 散，最散的接头也一刀够得着）', worst);
  ok(bandOk, '路只在中间左右 ' + E.run('HD.pathHalf') + ' 以内拐');
  ok(kindOk, '路上全是普通小怪，跟以前一样会走（用户："我要的怪物是动的"）');
  ok(E.run('enemies.every(function (e) { return e.pth; })'), '路外没有别的怪');
  ok(E.run('-wdelta(hPath[hPath.length - 1].y - P.y)') > E.run('-wdelta(cam.y - H / 2 - P.y)'), '摆到了屏幕顶外');
  const fx = E.run('wdelta(hPath[0].x - P.x)'), fy = E.run('wdelta(hPath[0].y - P.y)');
  ok(Math.hypot(fx, fy) < E.run('hAimR()') && Math.hypot(fx, fy) > 200, '第一只离你 ' + Math.hypot(fx, fy).toFixed(0) + '：一刀够得着，又不贴脸', fx.toFixed(0) + ', ' + fy.toFixed(0));
}

console.log('2) 只锁路上的下一只；后面几步暗着');
{
  const E = go(true);
  const s = headSide(E);
  ok(E.run('hPathHead === hPath[0]'), '下一只 = 路上第一只');
  ok(E.run((s < 0 ? 'hAimTL' : 'hAimTR') + '.ref === hPathHead') && E.run(s < 0 ? 'hAimTR' : 'hAimTL') === null,
    '它在' + (s < 0 ? '左' : '右') + '边：' + (s < 0 ? '左' : '右') + '斩锁它，另一边什么都不锁');
  // 后面那只挪到够得着的地方（另一边斜前方），也不锁
  E.run('hPath[1].x = P.x - ' + s + ' * 120; hPath[1].y = wwrap(P.y - 200);'); E.step(1);
  ok(E.run(s < 0 ? 'hAimTR' : 'hAimTL') === null, '后面那只就在另一边一刀够得着的地方：照样不锁（只认下一只）');
  // 画的时候每只怪身子那一笔的透明度：下一只和后面几步一样亮（用户："怎么怪物都黑了！根本看不清"）
  E.run('var AL = [], IN = false, _de = drawEnemies; drawEnemies = function () { IN = true; _de(); IN = false; }; ctx.closePath = function () { if (IN) AL.push(ctx.globalAlpha); };');
  let err = null;
  try { E.run('isTouch = true; render();'); } catch (e) { err = e; }
  ok(!err, '画得出来', err && err.message);
  const al = E.run('AL'), lo = Math.min.apply(null, al), hi = Math.max.apply(null, al);
  ok(al.length >= 3 && hi - lo < 1e-9, '屏幕里的 ' + al.length + ' 只：后面几步跟下一只一样亮（' + lo + '）', lo + ' ~ ' + hi);
  // 怪朝你走
  // 量的时候不判跟丢（人站着不动，路上的走过去了会重摆，"最后一只"就换了一只；队形散的那档隔得远，常碰上）
  E.run('HD.autoRun = false; HD.fillWait = 0; P.vx = 0; P.vy = 0;'); E.step(10);
  E.run('var FAR = hPath[hPath.length - 1];');
  const d0 = E.run('Math.hypot(wdelta(FAR.x - P.x), wdelta(FAR.y - P.y))');
  E.step(60);
  const d1 = E.run('Math.hypot(wdelta(FAR.x - P.x), wdelta(FAR.y - P.y))');
  ok(d0 - d1 > 40, '路上的怪朝你走（一秒近了 ' + (d0 - d1).toFixed(0) + '）', d0.toFixed(0) + ' → ' + d1.toFixed(0));
  E.run('HD.fillWait = 0.45;');
  // 后面哪只走到贴脸了：先斩它
  E.run('hPath[2].x = P.x + 60; hPath[2].y = wwrap(P.y - 100);'); E.step(1);
  ok(E.run('hPathHead === hPath[2]') && E.run('hAimTR && hAimTR.ref === hPath[2]'), '后面那只走到贴脸（' + E.run('HD.nearR') + ' 以内）：先锁它，不会撞上来了还斩不了');
  E.run('HD.autoRun = true;');
}

console.log('3) 照着点一路斩上去；点错边 = 点空');
{
  const E = go(true);
  const k0 = E.run('runKills');
  let wrong = 0, slow = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    let s = headSide(E), w = 0;
    while (!E.run('hAimT') && w < 60) { E.step(1); w++; }
    if (w > 2) slow++;
    s = headSide(E);
    const h = E.run('hPathHead');
    tapSide(E, s); n++;
    if (E.run('P.dashT') <= 0) wrong++;
    dashOut(E);
  }
  ok(E.run('runKills') - k0 >= 30 && wrong === 0, '照着下一只那边点了 ' + n + ' 下：斩了 ' + (E.run('runKills') - k0) + ' 只，一下没空', wrong);
  ok(slow === 0, '每斩完一只，下一只马上就锁得上（不用等）', slow);
  // 点错边
  let w = 0;
  while (!E.run('hAimT') && w < 60) { E.step(1); w++; }
  const s = headSide(E), k1 = E.run('runKills');
  tapSide(E, -s);
  ok(E.run('P.dashT') <= 0 && E.run('P.cd') === 0, '点了另一边（那边没东西）：不出刀；点错一下不罚', E.run('P.cd'));
  E.step(5); tapSide(E, -s);
  ok(E.run('P.dashT') <= 0 && Math.abs(E.run('P.cd') - E.run('HD.whiffCd')) < 1e-6, '紧接着又点空：罚停 ' + E.run('HD.whiffCd') + ' 秒（只罚狂点）', E.run('P.cd'));
  let dashed = false;
  for (let j = 0; j < 10; j++) { E.step(1); if (E.run('P.dashT > 0')) dashed = true; }
  ok(!dashed, '没出刀（点空不斩）');
}

console.log('4) 嘉欣糖在两步中间的路上，斩过去顺手捡；道具是路上的一步');
{
  const E = go();
  E.run('hCandy.length = 0; hPathCandy = 1; hPathGen();');
  // 在屏幕顶外接着摆一步：这一步前面那段路的正中间放一颗糖（摆的那一刻量：怪会走）
  const m = JSON.parse(E.run('(function () { var ax = hPathX, ay = hPathY; hPathCandy = 1; hPathStep(); var b = hPath[hPath.length - 1], c = hCandy[hCandy.length - 1]; ' +
    'return JSON.stringify({ dx: c.x - (ax + b.x) / 2, dy: wdelta(c.y - wwrap(ay + wdelta(b.y - ay) / 2)) }); })()'));
  const c = E.run('hCandy[hCandy.length - 1]');
  ok(Math.abs(m.dx) < 0.01 && Math.abs(m.dy) < 0.01, '糖在两步正中间', m.dx + ', ' + m.dy);
  ok(!c.pth, '糖不算一步（不锁它、不等它）');
  // 斩过去顺手捡：把一颗糖摆在你和下一只中间
  E.run('hCandy.length = 0; hCandy.push({ x: (P.x + hPathHead.x) / 2, y: wwrap(P.y + wdelta(hPathHead.y - P.y) / 2), ph: 0 });');
  const c0 = E.run('hCandyRun'); E.step(1);
  tapSide(E, headSide(E)); dashOut(E);
  ok(E.run('hCandyRun') === c0 + 1, '斩下一只的路上顺手捡了糖');
  // 道具到点了：路上下一步就是它
  E.run('hItem = null; hProp = null; hPropNext = 0; hPathStep();');
  ok(E.run('!!hItem && hItem.pth && hPath[hPath.length - 1] === hItem'), '道具到点了：路上的下一步就是它');
  // 让它当下一只：前面的都斩了（直接收掉）
  E.run('for (var i = 0; i < hPath.length - 1; i++) { var j = enemies.indexOf(hPath[i]); if (j >= 0) enemies.splice(j, 1); } hPath.splice(0, hPath.length - 1);');
  E.run('hItem.x = P.x + 110; hItem.y = wwrap(P.y - 220);'); E.step(1);
  ok(E.run('hPathHead === hItem && hAimTR && hAimTR.ref === hItem'), '轮到道具：锁它');
  tapSide(E, 1); dashOut(E);
  ok(!E.run('hItem') && !!E.run('hProp'), '斩过去拿到了', E.run('JSON.stringify({ item: hItem, prop: hProp, cd: P.cd })'));
}

console.log('5) 跟丢了重新摆；连斩清屏完也重新摆');
{
  const E = go(true);
  const old = E.run('hPath.length');
  E.run('var RER = 0; var _rr = hPathReroute; hPathReroute = function () { RER++; return _rr(); };');
  // 一直不点、笔直往上跑：路就在两边，一路都有得斩，不算跑丢
  for (let i = 0; i < 300; i++) E.step(1);
  ok(E.run('RER') === 0, '一直不点、笔直往上跑：路一直在两边够得着，不重摆', E.run('RER'));
  // 路上的全挪到够不着的地方（离你横着 700：比"算没跟丢"的 一刀 + 90 = 405 还远）：跑丢了。
  // 以前是各自往右挪 500，路本来在左边的话挪完离你才 360 左右，还算够得着，偶尔要 0.8 秒才重摆
  E.run('for (var i = 0; i < hPath.length; i++) { hPath[i].x = P.x + 700; hPath[i].sp = 0; }');   // 站住：不然朝你走又走回来
  let t = 0;
  while (E.run('RER') === 0 && t < 120) { E.step(1); t++; }
  ok(E.run('RER') === 1 && t < 45, '路上的都够不着了：' + (t / 60).toFixed(2) + ' 秒后从你身前重新摆', t);
  ok(E.run('enemies.every(function (e) { return e.pth; })') && E.run('hPath.length') >= 4, '旧的路散掉了（化成烟），新的一条从你身前摆起');
  E.step(15);
  ok(!!E.run('hAimT') && E.run('hAimT.ref === hPathHead'), '新路的第一只马上锁得上');
  // 连斩清屏完
  E.run('hRage = 100;'); E.run('hBurstGo();');
  let b = 0;
  while (E.run('!!hBurst') && b < 900) { E.step(1); b++; }
  E.step(2);
  ok(!E.run('hBurst') && E.run('hPath.length') >= 1 && E.run('hPathHead === hPath[0]'), '连斩清屏完：从你身前重新摆一条路');
  ok(E.run('enemies.every(function (e) { return hPath.indexOf(e) >= 0 || hPathMid.indexOf(e) >= 0 || wdelta(e.y - P.y) > 0; })'), '旧路剩下的（镜头回头时在屏幕顶外、没被清掉的）都散了：前面只有新路',
    E.run('JSON.stringify(enemies.filter(function (e) { return hPath.indexOf(e) < 0; }).map(function (e) { return [Math.round(e.x - P.x), Math.round(wdelta(e.y - P.y))]; }))'));
  E.step(60);
  ok(E.run('hPath.length') >= 4, '镜头转回来，路接着摆到屏幕顶外（' + E.run('hPath.length') + ' 步）');
  E.step(15);
  ok(!!E.run('hAimT') && E.run('hAimT.ref === hPathHead'), '清屏后第一只马上锁得上');
}

console.log('5b) 看广告复活：从你身前重新摆一条路');
{
  const E = go(true);
  E.run('for (var i = 0; i < hPath.length; i++) hPath[i].x += 500;');   // 旧路已经歪到够不着了
  E.run('state = "dead"; hRevive();'); E.step(15);
  ok(E.run('state') === 'play' && E.run('hPath.length') >= 1 && E.run('enemies.every(function (e) { return hPath.indexOf(e) >= 0 || hPathMid.indexOf(e) >= 0 || wdelta(e.y - P.y) > 0; })'), '复活：旧路散掉，新的一条从你身前摆起');
  ok(!!E.run('hAimT') && E.run('hAimT.ref === hPathHead'), '新路的第一只马上锁得上');
}

console.log('6) 机器人（反应 0.3 秒，只点下一只那边）跑一分钟');
{
  const E = go();
  E.run('HD.lives = 999; hLives = 999; P.inv = 0;');
  E.run('var RER = 0; var _rr = hPathReroute; hPathReroute = function () { RER++; return _rr(); };');
  let dry = 0, worst = 0, seen = 0, played = 0, odd = 0, two = 0;
  for (let f = 0; f < 7200 && played < 3600 && E.run('state') === 'play'; f++) {
    E.step(1);
    E.run('hLives = 999;');
    if (E.run('!!hBurst || hPropOn("ghost")')) { dry = 0; seen = 0; continue; }
    played++;
    if (E.run('enemies.some(function (e) { return !e.pth || e.heavy || e.bomb || e.charger; })')) odd++;
    const L = E.run('!!hAimTL'), R = E.run('!!hAimTR'), dash = E.run('P.dashT > 0');
    if (!L && !R && !dash) { dry++; worst = Math.max(worst, dry); } else dry = 0;
    if (L && R && E.run('hAimTL.ref !== hAimTR.ref')) two++;
    if (L || R) seen++; else seen = 0;
    if (E.run('hRage >= 100')) E.run('hBurstGo()');
    else if ((L || R) && !dash && seen >= 18 && E.run('P.cd <= 0')) tapSide(E, L ? -1 : 1);
  }
  ok(played >= 3600, '（玩了 ' + (played / 60).toFixed(0) + ' 秒，' + E.run('Math.floor(hTop / HD.m)') + ' 米，跑丢重摆 ' + E.run('RER') + ' 次）', played);
  ok(worst * 16.7 < 1000, '最长 ' + Math.round(worst * 16.7) + ' 毫秒没东西可斩', worst);
  ok(odd === 0, '一直只有路上的普通小怪', odd);
  ok(two === 0, '任何时候都不会左右各锁一只（判断不了点哪边）', two);
}

console.log('7) 混着随机的（默认）：留出一条能直接斩上去的路');
{
  const E0 = makeEnv();
  ok(E0.run('HD.path === true && HD.pathMix === true'), '默认：路线 + 一组组随机摆');
  const E = go(false, true);
  // 随机摆的离路太近不摆：hBlock 里每冒一只都量一下
  E.run('var BAD = [], NB = 0, KINDS = {}, inB = false, _hb = hBlock; hBlock = function (y) { inB = true; var r = _hb(y); inB = false; return r; };' +
    'var _se = spawnEnemy; spawnEnemy = function (x, y, k) { var e = _se(x, y, k); if (inB && e) { NB++; KINDS[k] = 1; var r = (k === "bomb" ? HD.bombR + 30 : HD.pathClear) - 1; if (hPathNear(e.x, e.y, r)) BAD.push(k); } return e; };');
  ok(E.run('enemies.some(function (e) { return !e.pth; })') && E.run('hPath.length') >= 4, '开局：路摆好了，旁边也有随机摆的怪');
  // 一开局就摆着的随机怪也躲开了路（含你到下一只那一段）
  ok(!E.run('enemies.some(function (e) { return !e.pth && hPathNear(e.x, e.y, (e.bomb ? HD.bombR + 30 : HD.pathClear) - 1, true); })'), '开局摆着的随机怪都离路 ' + E.run('HD.pathClear') + ' 开外（爆裂者 ' + E.run('HD.bombR + 30') + ' 开外）');
  // 锁：下一只那边顺着路斩；路边更靠前的随机怪不抢；另一边照以前斩别的
  E.run('for (var i = enemies.length - 1; i >= 0; i--) if (!enemies[i].pth || enemies[i].pmid) enemies.splice(i, 1);');
  E.run('HD.autoRun = false; P.vx = 0; P.vy = 0;');
  E.run('var h = hPath[0]; h.x = P.x + 90; h.y = wwrap(P.y - 200); h.sp = 0;'); E.step(1);
  ok(E.run('hPathHead === hPath[0] && hAimTR && hAimTR.ref === hPathHead'), '下一只在右边：右斩锁它');
  E.run('{ const e = spawnEnemy(P.x + 160, wwrap(P.y - 260), "grunt"); e.sp = 0; e.born = 1; }'); E.step(1);
  ok(E.run('hAimTR.ref === hPathHead'), '右边更靠前还有一只随机的（以前会锁最前面那只）：照样顺着路锁下一只');
  E.run('for (var i = 1; i < hPath.length; i++) hPath[i].x += 800;');   // 路后面几步挪开，别占左边
  E.run('{ const e = spawnEnemy(P.x - 120, wwrap(P.y - 220), "grunt"); e.sp = 0; e.born = 1; }'); E.step(1);
  ok(E.run('hAimTL && !hAimTL.ref.pth'), '左边有随机的怪：左斩照以前锁它（不算点空）');
  // 跟丢了：旁边有随机的能斩，也照样重摆
  E.run('HD.autoRun = true; var RER = 0; var _rr = hPathReroute; hPathReroute = function () { RER++; return _rr(); };');
  // 人在走廊左边、路全挪到右边站住（走廊有边，挪出去会被夹回边上；站住：不然朝你走又走回够得着的地方，那就不算跟丢）
  E.run('P.x = hX0 - 330; for (var i = 0; i < hPath.length; i++) { hPath[i].x = hX0 + 330; hPath[i].sp = 0; }');
  E.run('{ const e = spawnEnemy(P.x - 100, wwrap(P.y - 400), "grunt"); e.sp = 0; e.born = 1; }');
  let t = 0;
  while (E.run('RER') === 0 && t < 120) { E.step(1); t++; }
  ok(E.run('RER') === 1 && t < 45, '路歪到够不着了（旁边还有随机的能斩）：' + (t / 60).toFixed(2) + ' 秒后从你身前重新摆', t);
  ok(!E.run('enemies.some(function (e) { return !e.pth && hPathNear(e.x, e.y, HD.pathClear - 1, true); })'), '重摆的路上挡着的随机怪散掉了');
  // 机器人跑一分钟：有路就顺着路斩，没路斩别的
  E.run('HD.lives = 999; hLives = 999; P.inv = 0; RER = 0;');
  let dry = 0, worst = 0, seen = 0, played = 0, onPath = 0;
  for (let f = 0; f < 7200 && played < 3600 && E.run('state') === 'play'; f++) {
    E.step(1);
    E.run('hLives = 999;');
    if (E.run('!!hBurst || hPropOn("ghost")')) { dry = 0; seen = 0; continue; }
    played++;
    const L = E.run('!!hAimTL'), R = E.run('!!hAimTR'), dash = E.run('P.dashT > 0');
    if (E.run('!!hPathHead')) onPath++;
    if (!L && !R && !dash) { dry++; worst = Math.max(worst, dry); } else dry = 0;
    if (L || R) seen++; else seen = 0;
    if (E.run('hRage >= 100')) E.run('hBurstGo()');
    else if ((L || R) && !dash && seen >= 18 && E.run('P.cd <= 0')) {
      const pl = E.run('hAimTL && hAimTL.ref === hPathHead'), pr = E.run('hAimTR && hAimTR.ref === hPathHead');
      tapSide(E, pl ? -1 : pr ? 1 : L ? -1 : 1);
    }
  }
  ok(played >= 3600, '（玩了 ' + (played / 60).toFixed(0) + ' 秒，' + E.run('Math.floor(hTop / HD.m)') + ' 米，随机摆了 ' + E.run('NB') + ' 只，跑丢重摆 ' + E.run('RER') + ' 次）', played);
  ok(E.run('BAD.length') === 0, '随机摆的 ' + E.run('NB') + ' 只全都离路够远', E.run('JSON.stringify(BAD)'));
  ok(Object.keys(E.run('KINDS')).length >= 2, '随机摆的照以前有好几种：' + Object.keys(E.run('KINDS')).join(' / '));
  ok(onPath / played > 0.9, '一直有路（' + (onPath / played * 100).toFixed(0) + '% 的时间）', onPath / played);
  ok(worst * 16.7 < 1000, '最长 ' + Math.round(worst * 16.7) + ' 毫秒没东西可斩', worst);
}

console.log('8) 路由一段段队形拼成，不画线');
{
  const E = go(false, true);
  ok(E.run('typeof drawHPathLine') === 'undefined', '不画线（用户："我指的不是放个线"）');
  // 摆 20 回，每回从你身前摆到屏幕顶外、再多摆 2 步（摆的那一刻量：怪还没走；一回别摆太远：世界一圈 4500，量距离超过半圈就绕错了）
  let N = [], M = [], R = null;
  for (let b = 0; b < 20; b++) {
    R = JSON.parse(E.run('(function () { enemies.length = 0; hPathStart(); for (var i = 0; i < 2; i++) hPathStep(); ' +
      'return JSON.stringify({ n: hPath.map(function (n) { return [n.x - hX0, wdelta(n.y - P.y), n.pf, n.pk, n.pi, n.pd]; }), m: hPathMid.map(function (n) { return [n.x - hX0, wdelta(n.y - P.y), n.pf]; }), F: H_FORMS, gap: HD.pathGap, half: HD.pathHalf }); })()'));
    N = N.concat(R.n.map((n, j) => n.slice(0, 5).concat(b, j ? '' : 'start', n[5]))); M = M.concat(R.m.map(m => m.concat(b)));
  }
  const F = {}; R.F.forEach(f => F[f.k] = f);
  const kinds = {};
  let shapeBad = '', dBad = '', midBad = '', band = true;
  for (let j = 1; j < N.length; j++) {
    if (N[j][6] === 'start') continue;              // 每回第一步从你身前起，不跟上一回接
    const [x, y, f, k, , b] = N[j], [px, py, pf] = N[j - 1];
    if (Math.abs(x) > R.half + 0.5) band = false;
    const first = f !== pf, d = Math.hypot(x - px, y - py), want = N[j][7] + (first ? R.gap : 0);
    if (Math.abs(d - want) > 0.5) dBad = k + ' ' + d.toFixed(1) + '≠' + want;
    // 这一步中间有没有站一只：一段的第一步（两段接头）没有，段里的每一步正中间一只
    const mids = M.filter(m => m[3] === b && Math.hypot(m[0] - (x + px) / 2, m[1] - (y + py) / 2) < 1);
    if (mids.length !== (first ? 0 : 1)) midBad = k + (first ? ' 接头' : ' 段里') + ' 中间 ' + mids.length + ' 只';
  }
  // 按段看形状：每一步往哪边（-1 左 / 1 右）、偏几度
  const segs = {};
  for (let j = 1; j < N.length; j++) {
    if (N[j][6] === 'start') continue;
    const [x, y, f, k, i] = N[j], [px, py] = N[j - 1];
    const g = segs[f] = segs[f] || { k: k, s: [], a: [], i: [] };
    g.s.push(Math.sign(x - px)); g.a.push(Math.atan2(Math.abs(x - px), -(y - py)) * 180 / Math.PI); g.i.push(i);
  }
  Object.keys(segs).forEach(f => {
    const g = segs[f], s = g.s, k = g.k;
    kinds[k] = (kinds[k] || 0) + 1;
    // 这一段第一步往哪边（按段里第几步倒推：有时一段的第一步是"从你身前起"那步，没量）
    const pat = i => k === 'zig' ? (i % 2 ? -1 : 1) : k === 'stair' ? (Math.floor(i / 2) % 2 ? -1 : 1) : 1;
    const s0 = s[0] * pat(g.i[0]);
    let okShape = s.every((v, j) => v === s0 * pat(g.i[j]));
    if (k === 'line' || k === 'zig' || k === 'stair') okShape = okShape && g.a.every(a => Math.abs(a - F[k].a) < 0.5);
    if (k === 'arc') okShape = okShape && g.a.every((a, j) => !j || a < g.a[j - 1]);
    if (!okShape && !shapeBad) shapeBad = k + ' ' + JSON.stringify(s) + ' 第' + g.i.join(',') + '步 ' + g.a.map(a => a.toFixed(0)).join('/');
  });
  ok(Object.keys(kinds).length === 4, '摆了 ' + Object.keys(segs).length + ' 段：' + Object.keys(kinds).map(k => k + '×' + kinds[k]).join(' '), JSON.stringify(kinds));
  ok(!shapeBad, '每段都是规整的队形：斜线一直同一边、之字左右交替、台阶两步一拐、弧同一边越来越正', shapeBad);
  ok(!dBad, '段里每步隔得一样；两段接头多隔 ' + R.gap, dBad);
  // 每段挑一档间隔（用户："现在怪物刷新的距离太一致了"）：挤 / 照旧 / 散都有，连着两段不一样，路刚摆的第一段是照旧那档
  const tierOf = (k, pd) => Math.round(pd / F[k].d * 100) / 100;
  const segT = [], tiers = {};
  let firstBad = '', repBad = '';
  for (let j = 0; j < N.length; j++) {
    const [, , f, k, , b] = N[j], t = tierOf(k, N[j][7]);
    tiers[t] = (tiers[t] || 0) + 1;
    if (N[j][6] === 'start' && t !== 1) firstBad = k + ' ×' + t;
    const last = segT[segT.length - 1];
    if (!last || last.f !== f) {
      if (last && last.b === b && Math.abs(last.t - t) < 0.01) repBad = last.t + ' → ' + t;
      segT.push({ f: f, t: t, b: b });
    }
  }
  ok(Object.keys(tiers).length === 3, '队形间隔分三档：' + Object.keys(tiers).sort().map(t => '×' + t).join(' / '), JSON.stringify(tiers));
  ok(!repBad, '连着两段不是同一档', repBad);
  ok(!firstBad, '路刚摆的第一段用照旧那档（散的第一只离你太远够不着）', firstBad);
  ok(!midBad, '段里每两步正中间站一只（连成形），两段接头不站（看得出是两段拼的）', midBad);
  ok(band, '整条路都在中间左右 ' + R.half + ' 以内');
  // 整队往下压，队形不散（人站着；记住第二段的那几只，看它们彼此的位置变没变）
  E.run('HD.autoRun = false; P.vx = 0; P.vy = 0; hPathStart(); var GC = {}, GF = 0; hPath.concat(hPathMid).forEach(function (n) { GC[n.pf] = (GC[n.pf] || 0) + 1; if (!GF || GC[n.pf] > GC[GF]) GF = n.pf; }); ' +
    'var GA = hPath.filter(function (n) { return n.pf === GF; }).concat(hPathMid.filter(function (n) { return n.pf === GF; }));');
  const rel = () => E.run('JSON.stringify(GA.map(function (n) { return [Math.round((n.x - GA[0].x) * 10) / 10, Math.round(wdelta(n.y - GA[0].y) * 10) / 10]; }))');
  const r0 = rel(), y0 = E.run('GA[0].y');
  E.step(60);
  const moved = E.run('wdelta(GA[0].y - ' + y0 + ')');
  ok(rel() === r0 && moved > 40 && E.run('GA.length') >= 2, '走了一秒：一段 ' + E.run('GA.length') + ' 只整队往下压了 ' + moved.toFixed(0) + '，队形一点没变', r0 + ' → ' + rel());
  // 中间站的那只：不锁、不抢贴脸先斩；顺着路斩过去顺手带走
  // 随机的不再摆；重摆路以后旧路上的怪变成普通怪留着（pathMix），也收掉 —— 不然偶尔一只就在刀路上，一刀三只
  E.run('HD.autoRun = false; P.vx = 0; P.vy = 0; hNext = hTop + 1e9; hPathStart(); for (var i = enemies.length - 1; i >= 0; i--) if (!enemies[i].pth) enemies.splice(i, 1);');
  E.step(1);
  // 摆一段：下一只在右前 210，中间那只在右前 105（贴脸 150 以内）
  E.run('var h = hPath[0], m = hPathMid[0] || spawnEnemy(0, 0, "grunt"); m.pth = true; m.pmid = true; if (hPathMid.indexOf(m) < 0) hPathMid.push(m); ' +
    'h.x = P.x + 90; h.y = wwrap(P.y - 190); h.sp = 0; m.x = P.x + 45; m.y = wwrap(P.y - 95); m.sp = 0; m.born = 1; for (var i = 1; i < hPath.length; i++) hPath[i].x += 800;');
  E.run('for (var i = 0; i < hPathMid.length; i++) if (hPathMid[i] !== m) hPathMid[i].x += 800;'); E.step(1);
  ok(E.run('hAimTR && hAimTR.ref === hPathHead'), '中间那只就在右前 100（贴脸）：右斩照样锁路上的下一只，不锁它');
  const k0 = E.run('runKills');
  tapSide(E, 1); dashOut(E);
  ok(E.run('runKills') - k0 === 2 && E.run('enemies.indexOf(m)') < 0, '斩过去：中间那只顺手带走，一刀两只', E.run('runKills') - k0);
}

console.log('9) 前期一条松散的路（用户画了张图："有一条路，但是这条路上的圈有些偏左有些偏右"；选了"前 60 秒""路旁留少量随机怪"）');
{
  const E = go(false, true);
  E.run('HD.trailUntil = 60; hDiffT = 5;');
  ok(E.run('hTrailOn()') === true, '第 5 秒：前期');
  let N = [], mids = 0, firstD = [];
  for (let b = 0; b < 20; b++) {
    const R = JSON.parse(E.run('(function () { enemies.length = 0; hPathStart(); for (var i = 0; i < 2; i++) hPathStep(); ' +
      'return JSON.stringify({ n: hPath.map(function (n) { return [n.x - hX0, wdelta(n.y - P.y), n.pk]; }), m: hPathMid.length, half: HD.pathHalf }); })()'));
    mids += R.m;
    const f = R.n[0]; firstD.push(Math.hypot(f[0] - E.run('P.x - hX0'), f[1]));
    N.push(R.n);
  }
  const all = [].concat.apply([], N), T = E.run('JSON.stringify(HD.trail)') && JSON.parse(E.run('JSON.stringify(HD.trail)'));
  ok(all.every(n => n[2] === 'trail'), '路上全是松散的路，不摆队形（' + all.length + ' 只）', [...new Set(all.map(n => n[2]))].join(','));
  ok(mids === 0, '两只中间不站怪', mids);
  let angBad = '', dBad = '', band = true, sw = 0, steps = 0, sides = { '-1': 0, '1': 0 }, run1 = 1, longest = 1;
  N.forEach(L => {
    let ps = 0;
    for (let j = 1; j < L.length; j++) {
      const dx = L[j][0] - L[j - 1][0], dy = L[j][1] - L[j - 1][1], a = Math.atan2(Math.abs(dx), -dy) / rad, d = Math.hypot(dx, dy), sd = Math.sign(dx);
      if (!(a >= T.a[0] - 0.1 && a <= T.a[1] + 0.1)) angBad = a.toFixed(1) + '°';
      if (!(d >= T.d[0] - 0.5 && d <= T.d[1] + 0.5)) dBad = d.toFixed(0);
      sides[sd]++; steps++;
      if (ps && sd !== ps) { sw++; run1 = 1; } else if (ps) { run1++; longest = Math.max(longest, run1); }
      ps = sd;
    }
    L.forEach(n => { if (Math.abs(n[0]) > E.run('HD.pathHalf') + 0.5) band = false; });
  });
  ok(!angBad, '每只在上一只的左前或右前，偏 ' + T.a[0] + '~' + T.a[1] + '°（随机）', angBad);
  ok(!dBad, '隔 ' + T.d[0] + '~' + T.d[1] + '（随机，有远有近）', dBad);
  ok(sides['-1'] > steps * 0.3 && sides['1'] > steps * 0.3, '有些偏左有些偏右：左 ' + sides['-1'] + ' / 右 ' + sides['1']);
  ok(sw / steps > 0.45 && sw / steps < 0.85 && longest <= 6, '多半换边，也有连着同一边的（换边 ' + Math.round(sw / steps * 100) + '%，最长连着 ' + longest + ' 步同一边）', sw / steps + ' / ' + longest);
  ok(band, '只在中间左右 ' + E.run('HD.pathHalf') + ' 以内');
  ok(firstD.every(d => d > 195 && d < E.run('hAimR()')), '路刚摆的第一只离你 ' + Math.round(Math.min.apply(null, firstD)) + '~' + Math.round(Math.max.apply(null, firstD)) + '：不贴脸、一刀够得着', firstD.map(Math.round).join(','));
  // 路旁随机的：稀一半
  E.run('hWave = 3;');
  const avgGap = () => { let s = 0; for (let i = 0; i < 400; i++) s += E.run('hBlockGap()'); return s / 400; };
  const g1 = avgGap(); E.run('hDiffT = 70;'); const g2 = avgGap();
  ok(Math.abs(g1 / g2 - 2) < 0.25, '路旁随机的一组组隔开 ' + g1.toFixed(0) + '（前期） / ' + g2.toFixed(0) + '（之后）：稀一半', g1 / g2);
  // 过了 60 秒：接着摆队形
  E.run('enemies.length = 0; hPathStart();');
  const ks = JSON.parse(E.run('JSON.stringify(hPath.map(function (n) { return n.pk; }))'));
  ok(ks.length > 2 && ks.every(k => k !== 'trail') && E.run('hPathMid.length') > 0, '第 70 秒：回到队形（' + [...new Set(ks)].join(' / ') + '，中间站怪）', ks.join(','));
}
{
  // 机器人：前期跟着这条路斩（反应 0.12 秒），一直有得斩
  const E = go(false, true);
  E.run('HD.trailUntil = 60; hDiffT = 0; HD.lives = 999; hLives = 999; P.inv = 0; enemies.length = 0; hPathStart(); hFillAhead(P.y - 200);');
  let dry = 0, worst = 0, seen = 0, played = 0, onPath = 0, hits = 0, l0 = 999;
  for (let f = 0; f < 3600 && E.run('state') === 'play' && E.run('hTrailOn()'); f++) {   // 鬼火、连斩的时间不算 played，可 hDiffT 照走：前期 60 秒里能玩的约 40 秒
    E.step(1);
    if (E.run('hLives') < l0) { hits++; E.run('hLives = 999;'); }
    if (E.run('!!hBurst || hPropOn("ghost")')) { dry = 0; seen = 0; continue; }
    played++;
    const L = E.run('!!hAimTL'), R = E.run('!!hAimTR'), dash = E.run('P.dashT > 0');
    if (E.run('!!hPathHead')) onPath++;
    if (!L && !R && !dash) { dry++; worst = Math.max(worst, dry); } else dry = 0;
    if (L || R) seen++; else seen = 0;
    if (E.run('hRage >= 100')) E.run('hBurstGo()');
    else if ((L || R) && !dash && seen >= 7 && E.run('P.cd <= 0')) {
      const pl = E.run('hAimTL && hAimTL.ref === hPathHead'), pr = E.run('hAimTR && hAimTR.ref === hPathHead');
      tapSide(E, pl ? -1 : pr ? 1 : L ? -1 : 1);
    }
  }
  ok(played > 1800, '（前期玩了 ' + (played / 60).toFixed(0) + ' 秒，' + E.run('Math.floor(hTop / HD.m)') + ' 米，挨打 ' + hits + ' 次）', played);
  ok(onPath / played > 0.85, '一直有路（' + (onPath / played * 100).toFixed(0) + '% 的时间）', onPath / played);
  ok(worst * 16.7 < 1000, '最长 ' + Math.round(worst * 16.7) + ' 毫秒没东西可斩', worst);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
