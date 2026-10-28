/* 光和嘉欣糖（2.11 节）测试
   1) 开局：光满、第 1 层一条 30 颗糖的路，门还没出来；HUD 写离门还有多少米
   2) 光一直掉，越深掉得越快；站着不动光会灭 → 死（死因"光灭了"，光盾挡不住）；测试无敌不死
   3) 捡糖：走过去 / 冲刺穿过去都算，一颗补一截；只亮出前面那几颗，远的捡不到
   4) 门：快走到头才出来；碰到 → 破门进下一层，补光、换一条新路、弹刀诀
   5) 新手教学：光会变小但不灭；没教到「破门」那一步门斩不开
   6) 复活：光补满；箭头先指下一颗糖，没糖了指门
   7) 测试数据记捡了几颗糖；画面（糖、门、光圈、箭头、快灭了）都画得出来 */
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
// 开一局干净的场：教学已过、不刷怪、不合围，主角无敌帧拉满（只测光，不让怪撞死）
function fresh(E) {
  E.run('meta.tut = TUT_DONE;'); E.step(3);
  E.run('start(); enemies.length = 0; spawnTimer = 1e9; waveTimer = 1e9; scoutLeft = 0; layerFxT = 0; P.inv = 1e9;');
  E.step(1);
}
// 把主角挪到某个世界坐标（这一帧不算走过的路）
const moveTo = (E, expr) => E.run('{ const q = ' + expr + '; P.x = P.px = q.x; P.y = P.py = q.y; P.vx = P.vy = 0; }');

console.log('1) 开局');
{
  const E = makeEnv();
  fresh(E);
  ok(E.run('lightL') > 0.99, '光满的');
  ok(E.run('candies.length') === 26 && E.run('door.n') === 26, '第 1 层：26 颗糖通到门', E.run('candies.length'));
  ok(!E.run('doorOn()'), '门还没出来');
  ok(E.run('wdist(candies[0].x, candies[0].y, P.x, P.y)') < 200, '第一颗就在眼前');
  ok(/^还有 \d+ 米$/.test(E.run('gateText()')), 'HUD：门 · ' + E.run('gateText()'));
}

console.log('2) 光会灭');
{
  const E = makeEnv();
  fresh(E);
  E.step(300);                         // 5 秒，站着不动
  const L = E.run('lightL');
  ok(Math.abs(L - (1 - 5 / 18)) < 0.03, '第 1 层：满光 18 秒灭完（5 秒后剩 ' + L.toFixed(2) + '）');
  ok(Math.abs(E.run('lightDrain(10)') - 1 / 8) < 1e-9 && Math.abs(E.run('lightDrain(30)') - 1 / 8) < 1e-9 && E.run('lightDrain(4)') > E.run('lightDrain(1)'), '越深灭得越快，最快 8 秒');
  E.run('lightL = 0.25;'); E.step(2);
  ok(E.run('lightWarn') && E.run('floats.some(f => f.text === "光快灭了！")'), '低于三成：头顶报"光快灭了！"');
  E.run('shield = 1;');
  for (let i = 0; i < 900 && E.run('state') === 'play'; i++) E.step(1);
  ok(E.run('state') === 'dead', '站着不动：光灭了就死', E.run('state'));
  ok(E.run('runDeaths[runDeaths.length - 1][0]') === '光灭了', '死因：光灭了');
  let err = null;
  try { E.step(30); E.run('render();'); } catch (e) { err = e; }
  ok(!err, '死亡页画得出来（光灭了 —— 卷潮把嘉豪吞了）', err && err.message);
  E.run('doRevive();');
  ok(E.run('state') === 'play' && E.run('lightL') === 1, '看广告复活：光补满');

  const G = makeEnv();
  G.run('TEST.god = true;');
  fresh(G);
  G.run('lightL = 0.01;'); G.step(60);
  ok(G.run('state') === 'play' && G.run('lightL') === 0, '测试无敌：光灭了也不死');
}

console.log('3) 捡糖');
{
  const E = makeEnv();
  fresh(E);
  E.run('lightL = 0.5;');
  moveTo(E, 'candies[0]');
  E.step(1);
  ok(E.run('runCandy') === 1 && E.run('candyNext') === 1, '走到糖上：捡到');
  ok(E.run('lightL') > 0.5 + 0.08, '补一截光', E.run('lightL').toFixed(3));
  // 一帧冲过去：起点在糖前面 80，终点在糖后面 80，中间没有哪一帧落在糖上
  E.run('{ const c = candies[0], dx = c.x - P.x, dy = c.y - P.y, L = Math.hypot(dx, dy); __ux = dx / L; __uy = dy / L; __c = c; }');
  E.run('P.px = __c.x - __ux * 80; P.py = __c.y - __uy * 80; P.x = __c.x + __ux * 80; P.y = __c.y + __uy * 80; tickLight(0.001);');
  ok(E.run('runCandy') === 2, '冲刺一帧穿过去也算捡到');
  const far = E.run('candies.find(c => c.i > candyNext + CFG.candyShow).i');
  moveTo(E, 'candies.find(c => c.i === ' + far + ')');
  E.run('tickLight(0.001);');
  ok(E.run('runCandy') === 2, '还没亮出来的远处的糖：捡不到（第 ' + far + ' 颗）');
  ok(E.run('lightTarget().i') === E.run('candyNext'), '箭头指下一颗');
}

console.log('4) 门');
{
  const E = makeEnv();
  fresh(E);
  moveTo(E, 'door');
  E.run('tickLight(0.001);');
  ok(E.run('layer') === 1, '门还没出来时站到它的位置：不算');
  E.run('candyNext = door.n - 1; candies = candies.filter(c => c.i >= candyNext); lightL = 0.4;');
  ok(E.run('doorOn()') && E.run('gateText()') === '就在前面', '走到最后几颗：门出来了，HUD「就在前面」');
  E.run('candies.length = 0;');
  ok(E.run('lightTarget() === door'), '没糖了：箭头指门');
  moveTo(E, 'door');
  E.step(1);
  ok(E.run('layer') === 2, '碰到门：破门进第 2 层', E.run('layer'));
  ok(Math.abs(E.run('lightL') - 0.75) < 0.02, '破门补一大截光', E.run('lightL').toFixed(2));
  ok(E.run('candies.length') === 30 && E.run('candyNext') === 0 && !E.run('doorOn()'), '第 2 层：新的一条路（30 颗）');
  ok(E.run('pickWait') > 0 || E.run('state') === 'pick', '每破一扇门：弹刀诀');
}

console.log('5) 新手教学');
{
  const E = makeEnv();
  E.run('meta.tut = 0;'); E.step(3);
  E.run('start(); P.inv = 1e9;');
  ok(E.run('tutOn()'), '（教学局）');
  E.run('lightL = 0.35;'); E.step(300);
  ok(E.run('state') === 'play' && Math.abs(E.run('lightL') - 0.3) < 1e-6, '光会变小，但停在三成、不会灭', E.run('lightL'));
  E.run('candyNext = door.n; candies.length = 0;');
  moveTo(E, 'door');
  E.step(1);
  ok(E.run('layer') === 1, '还没教到「破门」：门斩不开');
  E.run('tutGo(TUT_STEPS.findIndex(s => s.key === "candy"));');
  ok(E.run('candies.length') === 8 && E.run('wdist(candies[0].x, candies[0].y, P.x, P.y)') < 200, '教「捡糖」：脚下现摆一条 8 颗的短路');
  moveTo(E, 'candies[0]');
  E.step(2);
  ok(E.run('tutKey()') === 'crystal', '捡到一颗：翻到下一步', E.run('tutKey()'));
  E.run('tutGo(TUT_STEPS.findIndex(s => s.key === "gate"));');
  E.run('candyNext = door.n; candies.length = 0;');
  moveTo(E, 'door');
  E.step(1);
  ok(E.run('layer') === 2, '教到「破门」：碰到门就破', E.run('layer'));
  ok(E.run('pickWait') <= 0 && E.run('state') !== 'pick', '教学局破门不弹刀诀');
}

console.log('6) 测试数据 / 画面');
for (const h of [844, 667]) {
  const E = makeEnv(h);
  fresh(E);
  let err = null;
  try {
    E.run('render();');                                  // 开局：糖、光圈
    E.run('lightL = 0.12;'); E.step(3); E.run('render();');  // 快灭了：红圈
    E.run('candyNext = door.n - 1; candies = candies.filter(c => c.i >= candyNext);'); E.step(2); E.run('render();');   // 门
    E.run('P.x = wwrap(P.x + 1600); P.px = P.x; cam.x = P.x;'); E.step(2); E.run('render();');                       // 走远了：屏幕边的箭头
  } catch (e) { err = e; }
  ok(!err, h + 'px：糖 / 门 / 光圈 / 快灭了 / 屏幕边箭头都画得出来', err && err.message);
}
{
  const E = makeEnv();
  fresh(E);
  moveTo(E, 'candies[0]'); E.step(1);
  moveTo(E, 'candies[0]'); E.step(1);
  E.run('P.inv = 0; shield = 0; die("杂兵"); finishRun();');
  const rep = E.run('testReport().join("\\n")');
  ok(/ · 糖 2 颗/.test(rep), '测试数据：这一局捡了 2 颗糖', (rep.match(/第 \d+ 层 · 活[^\n]*/) || [''])[0]);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
