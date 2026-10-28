/* 两把斩（HD.twoBlades）测试 —— 用户："不要让玩家控制方向了，给玩家两个斩，左手的就让玩家偏向斩左边，右手斩就偏向右边，
   我发现好像玩家控制方向没啥意思，我们优先斩道具和糖然后剩下的就优先斩最前面的，对了还有个问题，如果玩家拿了尺子现在优先斩最远的判断距离还是原来的"
   1) 拖屏幕不再换方向：一直自己往上跑
   2) 左半屏点 = 左斩（锁左边的），右半屏点 = 右斩（锁右边的）；正前方两边都算；身后的、黑潮的边不锁
   3) 先锁道具，再锁糖（最前面那颗），都没有锁最前面的挡路怪
   4) 黑板尺：够得着的范围跟着翻倍（480），远的也锁、也冲得到
   5) 鬼火冲的时候按住哪边往哪边挪
   6) 画得出来：两个斩键、两个准星、前面半圈范围弧 */
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
      if (k === 'stroke' && ops.sc) return () => { ops.stroke++; ops.sc.push(t.strokeStyle); };   // 记下每一笔描的什么颜色（§7）
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
  vm.runInContext('HD.intro = false; HD.preAd = false; HD.story = false; CFG.mainMode = "horde"; HD.tut = false; HD.autoRun = false; HD.lives = 1; HD.fillWait = 0; HD.heat0 = 1e9; HD.peakFrom = 1e9; HD.path = false;', sb);   // 新手教程在 test-htut.js 里测；路线（HD.path）在 test-path.js 里测，这里测一组组随机摆 / 手摆的怪；难度不涨（越来越难在 test-heat.js 里测）
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


// 开一局：自动往上跑，挡路的清掉，黑潮停在屏幕外
function go() {
  const E = makeEnv();
  E.run('meta.runs = 5; HD.autoRun = true;'); E.step(5);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hCandy = []; hCandyNext = 1e12; hPropNext = 1e12; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9;');
  E.step(2);
  return E;
}
const foe = (E, dx, dy, k) => E.run('{ const e = spawnEnemy(P.x + ' + dx + ', wwrap(P.y + ' + dy + '), "' + (k || 'grunt') + '"); e.sp = 0; e.born = 1; }');
const L = (E) => E.run('hLockSide(-1) && hLockSide(-1).ref'), R = (E) => E.run('hLockSide(1) && hLockSide(1).ref');

console.log('1) 拖屏幕不管用；按住斩键往那边斜前方走（用户："一直按着左边的斩，那么主角就往左前方走，右边同样"）');
{
  const E = go();
  ok(E.run('HD.twoBlades') === true, '默认就是两把斩');
  E.step(20);
  const walk = -E.run('P.vy');
  ok(walk > 250 && Math.abs(E.run('P.vx')) < 5, '不碰：笔直往上跑', walk.toFixed(0));
  // 轻点一下：不带歪
  const x0 = E.run('P.x');
  let id = E.down(60, 600); E.step(5); E.up(id, 60, 600); E.step(1);
  ok(Math.abs(E.run('P.vx')) < 5 && E.run('P.vy') < -250, '轻点左斩（0.08 秒）松手：下一帧就回到笔直往上', E.run('P.vx').toFixed(0));
  E.step(20);
  ok(Math.abs(E.run('P.x') - x0) < 30, '轻点：只往左挪了一点点（' + (x0 - E.run('P.x')).toFixed(0) + '，人身子一半多）', (E.run('P.x') - x0).toFixed(1));
  // 按住左边：按下那一帧就往左前方 45° 走（用户："为什么斜向移动不是实时的？有一个延迟？"）
  id = E.down(60, 600);
  E.step(1);
  ok(Math.abs(Math.atan2(-E.run('P.vx'), -E.run('P.vy')) * 57.3 - 45) < 3, '按下那一帧就斜过去了（没有延迟）', (Math.atan2(-E.run('P.vx'), -E.run('P.vy')) * 57.3).toFixed(0) + '°');
  E.run('onTouchMove({ changedTouches: [{ identifier: ' + id + ', clientX: 300, clientY: 400 }] });');   // 拖到哪都一样
  E.step(40);
  const vx = E.run('P.vx'), vy = E.run('P.vy'), deg = Math.atan2(-vx, -vy) * 180 / Math.PI;
  ok(vx < -150 && Math.abs(deg - 45) < 6, '按住左斩：往左前方斜着走（偏 ' + deg.toFixed(0) + '°）', vx.toFixed(0) + ' / ' + vy.toFixed(0));
  ok(Math.abs(Math.hypot(vx, vy) - walk) < 15, '速度跟平时跑一样', Math.hypot(vx, vy).toFixed(0));
  // 两边都按住：笔直（右边按在右斩键附近 —— 再往上是「连斩」键，不算右斩）
  const id2 = E.down(330, 770); E.step(40);
  ok(Math.abs(E.run('P.vx')) < 20 && E.run('P.vy') < -250, '两边都按住：笔直往上', E.run('P.vx').toFixed(0));
  E.up(id2, 330, 770); E.step(40);
  ok(E.run('P.vx') < -150, '松开右边：又往左前方走');
  E.up(id, 300, 400); E.step(40);
  ok(Math.abs(E.run('P.vx')) < 20 && E.run('P.vy') < -250 && E.run('Object.keys(hSideTouch).length') === 0, '松手：回到笔直往上', E.run('P.vx').toFixed(0));
  // 按住右边一直走：到走廊边上停住
  id = E.down(330, 770); E.step(400);
  ok(E.run('P.x') <= E.run('hX0 + W / 2') && E.run('P.x') > E.run('hX0 + W / 2 - 60'), '一直按住右边：走到走廊边上就贴着边往上', (E.run('P.x - hX0')).toFixed(0));
  E.up(id, 330, 770);
  // 按下去那一下照样斩
  E.step(30);
  E.run('enemies.length = 0;'); foe(E, -110, -150); E.step(1);
  const k0 = E.run('runKills');
  id = E.down(60, 600); E.step(14);
  ok(E.run('runKills') === k0 + 1, '按住左斩：按下去那一下照样斩了左边那只');
  E.up(id, 60, 600);
}

console.log('2) 左斩锁左边、右斩锁右边');
{
  const E = go();
  foe(E, -120, -150); foe(E, 130, -170);
  E.step(1);
  ok(L(E) === E.run('enemies[0]') && R(E) === E.run('enemies[1]'), '左边一只、右边一只：左斩锁左边那只，右斩锁右边那只');
  const k0 = E.run('runKills');
  E.tap(60, 600); E.step(14);
  ok(E.run('runKills') === k0 + 1 && E.run('enemies.length') === 1 && E.run('enemies[0].x > P.x - 60'), '点左半屏：斩了左边那只', E.run('enemies.length'));
  E.run('enemies.length = 0;'); foe(E, 10, -160); E.step(1);
  ok(L(E) === E.run('enemies[0]') && R(E) === E.run('enemies[0]'), '正前方那只：左斩右斩都锁得上');
  E.run('enemies.length = 0;'); foe(E, -150, 120); foe(E, 150, 60); E.step(1);
  ok(L(E) === null && R(E) === null, '身后的不锁');
  E.run('enemies.length = 0; hFront = wwrap(P.y + 60);'); E.step(1);
  ok(L(E) === null && R(E) === null && E.run('hAimT') === null, '黑潮的边不锁（不能回头砍了）');
  E.run('hFront = wwrap(P.y + hGapMax());');
  // 用户："我要的斩不要横着，你的判定应该是斜向最靠前的"
  E.run('enemies.length = 0;'); foe(E, -200, -40); E.step(1);
  ok(L(E) === null && R(E) === null, '左边差不多横着的（偏 79°）：不锁，不横着斩');
  E.run('enemies.length = 0;'); foe(E, -150, -110); E.step(1);
  ok(L(E) === E.run('enemies[0]') && R(E) === null, '左前方斜着的（偏 54°）：左斩锁，右斩不管');
  E.run('enemies.length = 0;'); foe(E, -70, -210); foe(E, -150, -150); E.step(1);
  ok(L(E) === E.run('enemies[1]'), '两只：锁顺着斜线更靠前的那只（45° 那只），不是更靠上的那只');
  E.run('enemies.length = 0;'); foe(E, 0, -120); E.step(1);
  ok(L(E) === E.run('enemies[0]') && R(E) === E.run('enemies[0]'), '正前方挡路的：两边都斩得到');
}

console.log('3) 先道具，再糖，再最前面的怪');
{
  const E = go();
  foe(E, -90, -150); foe(E, -90, -220);
  E.step(1);
  ok(L(E) === E.run('enemies[1]'), '两只怪（都不贴脸）：锁斜着最靠前的那只（220 那只）');
  // 糖、道具摆在判定外面（不然跑一步就自己捡到了）
  E.run('hCandy = [{ x: P.x - 80, y: wwrap(P.y - 130), ph: 0 }, { x: P.x - 100, y: wwrap(P.y - 200), ph: 0 }];'); E.step(1);
  ok(L(E) === E.run('hCandy[1]'), '有糖：先锁糖（哪怕比怪近），两颗锁斜着靠前那颗');
  E.run('hItem = { k: "stink", x: P.x - 70, y: wwrap(P.y - 100), t: 0 };'); E.step(1);
  ok(L(E) === E.run('hItem'), '有道具：先锁道具（哪怕最近）');
  ok(R(E) === null || R(E) !== E.run('hItem'), '道具在左边：右斩不锁它');
  E.run('hItem = null; hCandy = [];');
}

console.log('3b) 贴脸的先斩（用户："你斩了最远的，正好屁股碰到后面那个"）');
{
  const E = go();
  foe(E, -40, -100); foe(E, -150, -150);
  E.run('hCandy = [{ x: P.x - 100, y: wwrap(P.y - 200), ph: 0 }]; hItem = { k: "stink", x: P.x - 60, y: wwrap(P.y - 210), t: 0 };');
  E.step(1);
  ok(L(E) === E.run('enemies[0]'), '左前方 108 有一只：先斩它（排在道具、糖、更远的怪前面）');
  E.run('enemies[0].y = wwrap(P.y - 165); enemies[0].x = P.x - 40;'); E.step(1);
  ok(L(E) === E.run('hItem'), '离到 170（不贴脸）：照旧先锁道具');
  E.run('hItem = null; hCandy = [];');
  E.run('enemies.length = 0;'); foe(E, -30, -60); foe(E, -70, -120); E.step(1);
  ok(L(E) === E.run('enemies[0]'), '两只都贴脸：先斩最近的');
  E.run('enemies.length = 0;'); foe(E, 60, -70); E.step(1);
  ok(L(E) === null && R(E) === E.run('enemies[0]'), '贴脸的在右前方：左斩不管，右斩锁它');
}

console.log('4) 黑板尺：够得着的范围跟着翻倍');
{
  const E = go();
  // 用户："斩杀判定范围，占横向屏幕的70%吧"：左右斜前方合起来横着多宽 / 屏幕（世界）宽
  const span = E.run('2 * HD.aimR * Math.sin(HD.sideMax * Math.PI / 180) / W');
  ok(Math.abs(span - 0.7) < 0.01, '平时的斩击范围横着占屏幕宽 ' + (span * 100).toFixed(0) + '%', span);
  E.run('HD.autoRun = false; P.vx = 0; P.vy = 0; enemies.length = 0;'); foe(E, 265, -160); foe(E, -265, -160); E.step(1);
  ok(L(E) === E.run('enemies[1]') && R(E) === E.run('enemies[0]'), '左右各偏出 265（屏幕宽的 34%）的也锁得上');
  E.run('HD.autoRun = true; enemies.length = 0;');
  foe(E, -40, -420); E.step(1);
  ok(L(E) === null, '没尺子：420 远的够不着');
  E.run('hUseProp("ruler", P.x, P.y);'); E.step(2);
  ok(E.run('hAimR()') === E.run('HD.aimR') * 2 && L(E) === E.run('enemies[0]'), '拿了尺子（' + E.run('hAimR()') + '）：420 远的锁得上（用户："拿了尺子……判断距离还是原来的"）');
  foe(E, -20, -170); E.step(1);
  ok(L(E) === E.run('enemies[0]'), '近处还有一只（170，不贴脸）：照样锁最前面那只（420）');
  const y0 = E.run('P.y'), k0 = E.run('runKills');
  E.tap(60, 600);
  for (let i = 0; i < 40; i++) E.step(1);
  ok(E.run('runKills') === k0 + 2 && y0 - E.run('P.y') > 400, '一刀冲到 420 那只，路上那只顺手斩了', (y0 - E.run('P.y')).toFixed(0));
}

console.log('5) 鬼火：按住哪边往哪边挪');
{
  const E = go();
  E.run('hUseProp("ghost", P.x, P.y);'); E.step(5);
  const x0 = E.run('P.x');
  const id = E.down(40, 600);
  E.step(30);
  ok(E.run('P.x') < x0 - 60, '按住左半屏：往左挪', (E.run('P.x') - x0).toFixed(0));
  E.up(id, 40, 600);
  const x1 = E.run('P.x');
  E.step(20);
  ok(Math.abs(E.run('P.vx')) < 60, '松手：不再往左', E.run('P.vx').toFixed(0));
}

console.log('5b) 按住走：这一边锁着东西就头对着它走，不往最边上 45° 拐（用户："在范围内有怪物的时候，玩家的头部，指向怪物"）');
{
  const E = go();
  const head = () => Math.atan2(E.run('P.vx'), -E.run('P.vy')) * 180 / Math.PI;          // 往右偏几度（往左为负）
  const toFoe = (j) => Math.atan2(E.run('wdelta(enemies[' + (j || 0) + '].x - P.x)'), -E.run('wdelta(enemies[' + (j || 0) + '].y - P.y)')) * 180 / Math.PI;
  let id = E.down(330, 700); E.step(3);
  ok(Math.abs(head() - 45) < 3, '按住右边、前面没东西：照旧往右前 45° 走', head().toFixed(0) + '°');
  foe(E, 60, -170); E.step(2);
  ok(R(E) === E.run('enemies[0]') && Math.abs(head() - toFoe()) < 3 && head() < 30, '右前方 ' + toFoe().toFixed(0) + '° 有一只：头对着它走（' + head().toFixed(0) + '°），不拐到 45°');
  E.step(8);
  ok(E.run('enemies.length') === 1 && Math.abs(head() - toFoe()) < 3, '走着走着也一直对着它', head().toFixed(0) + '° / ' + toFoe().toFixed(0) + '°');
  E.run('enemies.length = 0;'); foe(E, 150, -100); E.step(2);
  ok(R(E) === E.run('enemies[0]') && Math.abs(head() - 45) < 3, '锁着的那只偏 ' + toFoe().toFixed(0) + '°（比 45° 还横）：最多拐到 45°', head().toFixed(0) + '°');
  E.run('enemies.length = 0;'); foe(E, -20, -200); E.step(2);
  ok(R(E) === E.run('enemies[0]') && Math.abs(head()) < 3, '锁着的那只稍微偏左（' + toFoe().toFixed(0) + '°）：按着右边就笔直往上，不往左拐', head().toFixed(0) + '°');
  E.run('enemies.length = 0; hCandy = [{ x: P.x + 50, y: wwrap(P.y - 200), ph: 0 }];'); E.step(2);
  ok(R(E) === E.run('hCandy[0]') && Math.abs(head() - Math.atan2(E.run('wdelta(hCandy[0].x - P.x)'), -E.run('wdelta(hCandy[0].y - P.y)')) * 57.3) < 3, '锁着的是糖：对着糖走（' + head().toFixed(0) + '°）');
  E.run('hCandy = [];'); foe(E, 120, -150); E.step(2);
  E.up(id, 330, 700); E.step(1);
  ok(Math.abs(E.run('P.vx')) < 5 && E.run('P.vy') < -250, '松手：照旧笔直往上（不追着它拐）', E.run('P.vx').toFixed(0));
  id = E.down(60, 700); E.step(2);
  ok(L(E) === null && Math.abs(head() + 45) < 3, '按住左边、怪只在右边：照旧往左前 45° 走', head().toFixed(0) + '°');
  E.up(id, 60, 700);
}

console.log('5c) 碰到身侧、身后的怪不掉命，只有身子前三分之一碰到才算（用户："只要在玩家身体三分之一后面的怪物都改成没有伤害"）');
{
  // 头朝上（P.ang = -90°）；怪摆在身边刚好碰上（中心距 = 两个半径 - 2），看掉不掉命
  const hit = (deg, kind) => {
    const E = go();
    E.run('HD.lives = 3; hLives = 3; HD.autoRun = false; P.inv = 0; P.vx = 0; P.vy = 0; P.dashT = 0; P.glideT = 0; lastDashEnd = -1e9; P.ang = -Math.PI / 2;');
    const a = (deg - 90) * Math.PI / 180;
    E.run('{ const e = spawnEnemy(0, 0, "' + (kind || 'grunt') + '"); e.sp = 0; e.born = 1; const d = P.r + e.r - 2; e.x = wwrap(P.x + Math.cos(' + a + ') * d); e.y = wwrap(P.y + Math.sin(' + a + ') * d); }');
    E.step(1);
    return E.run('hLives') < 3;
  };
  ok(hit(0), '正前方碰上：掉命');
  ok(hit(60) && hit(-60), '前面偏 60°（还在身子前三分之一）：掉命');
  ok(!hit(75) && !hit(-75), '偏 75°（过了前三分之一那条线，约 70.5°）：不掉命');
  ok(!hit(90) && !hit(-90), '正侧面：不掉命');
  ok(!hit(135) && !hit(180), '斜后方、正后方：不掉命');
  ok(!hit(110, 'charger'), '冲锋者从侧后撞上来：也不掉命');
  const E = go();
  E.run('HD.lives = 3; hLives = 3; P.inv = 0; P.dashT = 0; P.glideT = 0; lastDashEnd = -1e9; hFront = wwrap(P.y + 4);'); E.step(2);
  ok(E.run('hLives') < 3, '黑潮从身后追上：照旧掉命（它本来就在身后追）');
}

console.log('5d) 点空（点了灰着的那边）：偶尔点错一下不罚，0.5 秒里点空第二次才两把都停 0.3 秒（用户："左手点右手是不是可以无限切"、"有了惩罚之后，手感差了好多"，选了"只罚狂点"）');
{
  const E = go();
  E.run('HD.autoRun = false; P.vx = 0; P.vy = 0;');
  foe(E, 100, -200); E.step(2);           // 只有右边有怪
  ok(!E.run('hAimTL') && !!E.run('hAimTR'), '（摆好：左边灰着、右边锁着）');
  const cd = E.run('HD.whiffCd');
  E.tap(60, 600);
  ok(E.run('P.cd') === 0, '点错一下（灰着的左边）：不罚', E.run('P.cd'));
  E.step(6);
  E.tap(60, 600);
  ok(Math.abs(E.run('P.cd') - cd) < 1e-6, '0.1 秒后又点空：两把斩都停 ' + cd + ' 秒', E.run('P.cd'));
  const k0 = E.run('runKills');
  E.tap(330, 770); E.step(14);
  ok(E.run('runKills') === k0 && E.run('P.dashT') <= 0, '停着的时候点锁着怪的右边：不出刀');
  const c1 = E.run('P.cd');
  E.tap(60, 600);
  ok(c1 > 0 && E.run('P.cd') === c1, '停着的时候再点空：不加时（狂点不会一直停下去）', c1 + ' → ' + E.run('P.cd'));
  E.step(Math.ceil(c1 / 0.0167) + 1);
  E.tap(330, 770); E.step(14);
  ok(E.run('runKills') === k0 + 1, '停完了：右边照常斩');
  ok(E.run('P.cd') === 0, '点中了（斩死）不罚', E.run('P.cd'));
  // 两次点空隔了 0.5 秒以上：都不罚
  E.run('enemies.length = 0;'); E.step(40);
  E.tap(60, 600); E.step(36); E.tap(60, 600);
  ok(E.run('P.cd') === 0, '两次点空隔了 0.6 秒：都不罚（正常玩偶尔点错）', E.run('P.cd'));
  // 按住走（按住超过 HD.whiffTap 秒才松）不算点空，也不算进"0.5 秒里第二次"
  E.step(40);
  let id = E.down(60, 600); E.step(18); E.up(id, 60, 600);
  E.step(6); E.tap(60, 600);
  ok(E.run('P.cd') === 0, '按住灰着的左边走了 0.3 秒再松手，紧接着点空一下：都不罚', E.run('P.cd'));
  // 一只手按住空的一边走，另一只手照样斩
  E.step(40);
  E.run('P.vx = 0; P.vy = 0;'); foe(E, 100, -200); E.step(2);
  const k1 = E.run('runKills');
  id = E.down(60, 600); E.step(3);
  E.tap(330, 770); E.step(14);
  ok(E.run('runKills') === k1 + 1, '左手按住空的左边走，右手点右边：照样斩');
  E.up(id, 60, 600);
  // 新手教程里不罚
  E.run('enemies.length = 0; P.cd = 0;'); E.step(40);
  E.run('var _tOn = hTutOn; hTutOn = function () { return true; };');
  E.tap(60, 600); E.step(6); E.tap(60, 600);
  ok(E.run('P.cd') === 0, '新手教程里连着点空：不罚', E.run('P.cd'));
  E.run('hTutOn = _tOn;');
}

console.log('5e) 土狼时间：点下去斩刚才看到的那只（试玩反馈："索敌切换的也太快了……如果当前范围内没有可斩击目标，攻击0.2秒前锁定的目标"）');
{
  // 站着不动、怪不走；A 先在右边锁 0.25 秒（人看见了），再出事
  const setup = () => {
    const E = go();
    E.run('HD.autoRun = false; P.vx = 0; P.vy = 0;');
    foe(E, 60, -180); E.step(15);
    return E;
  };
  const A = 'enemies[0]', B = 'enemies[1]';
  let E = setup();
  ok(R(E) === E.run(A), '（摆好：右边锁着 A）');
  E.run(A + '.x = wwrap(P.x + 250); ' + A + '.y = wwrap(P.y - 100);'); E.step(1);   // 偏 68°：出了斜前方，还在前面、够得着
  ok(R(E) === null, '（A 偏出斜前方：右斩灰了）');
  E.step(3); E.tap(330, 770);
  ok(E.run('P.dashT') <= 0 && !E.run('P.dashRef'), '0.07 秒后点右边：A 已经横过来了，不斩它（用户："切不到横向的怪物"），照旧点空');

  E = setup();
  foe(E, 250, -100); E.step(1);                                     // 横着的 B（偏 68°）：本来就锁不上
  E.run('enemies.splice(0, 1);'); E.step(3);                        // 看到的 A 没了
  E.tap(330, 770);
  ok(E.run('P.dashT') <= 0, '看到的 A 没了、旁边只有横着的：也不冲过去');

  E = setup();
  E.run(A + '.x = wwrap(P.x + 125); ' + A + '.y = wwrap(P.y - 95);'); E.step(1);   // 偏 53°（离 157，不算贴脸）：还在斜前方
  foe(E, 40, -300); E.step(2);                                      // 更远的 B 把准星抢走
  E.tap(330, 770);
  ok(E.run('P.dashRef') === E.run(A), '看到的 A 偏到 53°（还在斜前方 60° 以内）：照样斩 A');

  E = setup();
  foe(E, 100, -290); E.step(2);                                     // 更远的 B 进来，准星跳到 B
  ok(R(E) === E.run(B), '（更远的 B 进来：右边的准星跳到 B）');
  E.tap(330, 770);
  ok(E.run('P.dashRef') === E.run(A), '准星刚跳走 0.03 秒就点：斩看到的 A');

  E = setup();
  foe(E, 100, -290); E.step(20);
  E.tap(330, 770);
  ok(E.run('P.dashRef') === E.run(B), 'B 已经锁了 0.33 秒：斩 B');

  E = setup();
  foe(E, 100, -290); E.run('enemies.splice(0, 1);'); E.step(2);       // A 死了（被别的斩掉 / 撞死）
  E.tap(330, 770);
  ok(E.run('P.dashRef') === E.run('enemies[0]'), '看到的 A 已经死了：斩现在锁的 B');

  E = setup();
  E.run(A + '.y = wwrap(P.y + 40);'); E.step(3);                      // A 跑到身后了
  E.tap(330, 770);
  ok(E.run('P.dashT') <= 0, '看到的 A 跑到身后了：不回头斩（照旧点空）');

  E = setup();
  E.run('HD.coyote = 0;');
  foe(E, 100, -290); E.step(2);
  E.tap(330, 770);
  ok(E.run('P.dashRef') === E.run(B), 'HD.coyote = 0 关掉：照旧斩现在锁的');
}

console.log('6) 画得出来');
{
  const E = go();
  foe(E, -120, -150); foe(E, 130, -170); E.step(2);
  E.run('isTouch = true;');
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '两个斩键、两个准星、范围半圈都画得出来', err && err.message);
  E.ops.drawImage = 0; E.run('drawDashBtn();');
  ok(E.ops.drawImage === 2, '两个斩键', E.ops.drawImage);
}

console.log('7) 分得清左手右手：用颜色，不用字（用户先要"在那个范围显示的中间，放个分左右的"，又说"用颜色去表示，不要用文字"）');
{
  const E = go();
  const BL = E.run('HD.sideC[0]'), YE = E.run('HD.sideC[1]'), RED = '#ff4a3a';
  // 这一段代码描了哪些颜色（按顺序）；顺便数写了几个字
  const cols = code => { E.ops.sc = []; E.ops.fillText = 0; E.run(code); const c = E.ops.sc; E.ops.sc = null; return c; };
  let c = cols('drawHRange()');
  ok(JSON.stringify(c) === JSON.stringify([BL, YE]) && E.ops.fillText === 0, '范围弧：左半蓝、右半黄（各一笔），不写字', JSON.stringify(c));
  foe(E, -120, -150); foe(E, 130, -170); E.step(1);
  ok(E.run('hAimTL.ref === enemies[0] && hAimTR.ref === enemies[1]'), '（左边那只左斩锁、右边那只右斩锁）');
  c = cols('drawHordeAim()');
  ok(JSON.stringify(c) === JSON.stringify([BL, BL, YE, YE]) && E.ops.fillText === 0, '左斩的准星和细线全蓝、右斩的全黄，不挂字', JSON.stringify(c));
  E.run('enemies.length = 0;'); foe(E, 0, -160); E.step(1);
  c = cols('drawHordeAim()');
  ok(E.run('hAimTL.ref === hAimTR.ref') && c.indexOf(BL) >= 0 && c.indexOf(YE) >= 0 && c.length === 3, '正前方那只两边都锁：一个准星，右边两个角黄、左边两个角蓝（哪只手都行）', JSON.stringify(c));
  E.run('enemies.length = 0;'); foe(E, 130, -170, 'bomb'); E.step(1);
  c = cols('drawHordeAim()');
  ok(c.indexOf(YE) >= 0 && c[c.length - 1] === RED && c.indexOf(BL) < 0, '右边的爆裂者：右斩的黄准星，里面再套一圈红', JSON.stringify(c));
  E.run('isTouch = true;');
  c = cols('drawDashBtn()');
  const has = (rgb, hex) => c.some(x => x === hex || x.indexOf(rgb) >= 0);   // 灰着的那个是半透明的同一个颜色
  ok(has('58,168,255', BL) && has('255,201,40', YE), '两个斩键：左蓝、右黄', JSON.stringify(c));
  E.run('HD.twoBlades = false;');
  c = cols('drawHordeAim()').concat(cols('drawHRange()'));
  ok(c.indexOf(BL) < 0 && c.indexOf(YE) < 0, '一把斩（HD.twoBlades 关了）：不分左右的颜色', JSON.stringify(c));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
