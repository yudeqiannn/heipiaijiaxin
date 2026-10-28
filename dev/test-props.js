/* 道具和嘉欣糖（2.13 节）测试 —— 用户写的：
   黑板尺"可斩的范围扩大一倍持续10秒"；臭水"驱赶黑潮5秒"；鬼火"高速往前冲10秒，四周扩散剑气，周围全部怪物都被斩杀"；
   嘉欣糖"随机在游戏内刷新，局外可以买道具皮肤"；"道具是及时使用的……在使用的过程中不刷新新的道具"
   1) 第一个道具在 120 米摆到前面路上；斩到 / 碰到就拿到、马上生效
   2) 生效期间不出新的；用完（或者没捡到）再往上逃 300 米才出下一个
   3) 黑板尺：10 秒里锁得上两倍远（315 → 630），这一刀够得着、冲得到
   4) 臭水：黑潮退到屏幕底边外，5 秒里不涌、不追；完了照常追
   5) 鬼火：10 秒往前猛冲、不掉命，身边的怪（重型、爆裂者也算，不留引信）和黑潮的边全斩；不出刀；冲完再无敌一会儿
   6) 嘉欣糖：一次 1~3 颗随机、各摆各的，撒得勤；离 60 以内就捡到；一局结束存进存档
   7) 道具只有一个颜色（用户后来说"道具颜色改回去，就一个颜色"）：换色去掉、买过的退糖；商店没东西卖先不开
   8) 画面：各种道具生效 / 路上的道具和糖 / 商店 / 主界面 / 失败页都画得出来，笔数不随糖的多少涨
   10) 开局看广告带道具（用户："开局看广告获得道具"，选"开局前自己挑一个"）：主界面 / 失败页一个金按钮 → 看完广告 →
       三个挑一个 → 开局，开场一结束就生效；没看完不给；不占路上的名额 */
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
  vm.runInContext('HD.intro = false; HD.preAd = false; HD.story = false; CFG.mainMode = "horde"; HD.tut = false; HD.autoRun = false; HD.lives = 1; HD.fillWait = 0; HD.heat0 = 1e9; HD.peakFrom = 1e9; HD.path = false;', sb);   // 新手教程在 test-htut.js 里测；路线（HD.path）在 test-path.js 里测，这里测一组组随机摆 / 手摆的怪；难度不涨（越来越难在 test-heat.js 里测）
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

console.log('1) 第一个道具：120 米摆到前面路上，斩到就拿到');
{
  const E = fresh();
  ok(E.run('state') === 'play' && E.run('hordeMode') && E.run('PROP.on'), '主界面点一下就进黑潮');
  ok(E.run('hItem') === null && E.run('hProp') === null && E.run('hPropNext') === 120 * E.run('HD.m'), '开局路上没有道具，第一个在 120 米', E.run('hPropNext'));
  E.run('hTop = hPropNext - 1; hSpawnProps();');
  ok(E.run('hItem') === null, '不到 120 米不出');
  E.run('hTop = hPropNext; hSpawnProps();');
  ok(E.run('hItem !== null && ["ruler", "stink", "ghost", "magnet"].indexOf(hItem.k) >= 0'), '到了 120 米：出一个（四个里随机）', E.run('hItem && hItem.k'));
  ok(E.run('wdelta(hItem.y - P.y)') < -E.run('H * 0.5') && Math.abs(E.run('hItem.x - hX0')) <= E.run('W * 0.3'), '摆在前面（屏幕顶上外面）、走廊中间这一片', E.run('wdelta(hItem.y - P.y)'));
  const seen = {};
  for (let i = 0; i < 60; i++) { E.run('hItem = null; hPropNext = 0; hSpawnProps();'); seen[E.run('hItem.k')] = 1; }
  ok(Object.keys(seen).length === 4, '四个都会出（黑板尺 / 臭水 / 鬼火 / 吸铁石）', Object.keys(seen).join(','));
  // 斩到
  putItem(E, 'ruler', 20, 160);
  ok(E.run('hLock({ x: 0, y: -1 }) && hLock({ x: 0, y: -1 }).ref === hItem'), '点「斩」锁得上它');
  E.tapDash(); E.step(12);
  ok(E.run('hItem') === null && E.run('hProp && hProp.k') === 'ruler', '斩到就拿到、马上生效（不存）', E.run('hProp && hProp.k'));
  ok(E.run('hPropUsed') === 1, '测试数据记一个');
  // 碰到也算
  E.run('hProp = null;');
  putItem(E, 'stink', 0, 10);
  E.step(2);
  ok(E.run('hProp && hProp.k') === 'stink', '直接碰到也算拿到');
}

console.log('2) 用着的时候不出新的；用完 / 没捡到，再往上 300 米出下一个');
{
  const E = fresh();
  putItem(E, 'ruler', 0, 10); E.step(2);
  ok(E.run('hProp && hProp.k') === 'ruler', '拿到黑板尺');
  E.run('hTop += 5000 * HD.m; hSpawnProps();');
  ok(E.run('hItem') === null, '生效期间走多远都不出新的（不会新的顶掉旧的）');
  E.step(Math.ceil(10 / 0.0167) + 5);
  ok(E.run('hProp') === null, '10 秒后用完', E.run('hProp && hProp.t'));
  const t0 = E.run('hTop'), next = E.run('hPropNext');
  ok(Math.abs(next - t0 - 300 * E.run('HD.m')) < 400, '下一个在用完的地方再往上 300 米', (next - t0) / 40);
  E.run('hTop = hPropNext - 1; hSpawnProps();');
  ok(E.run('hItem') === null, '不到 300 米不出');
  E.run('hTop = hPropNext; hSpawnProps();');
  ok(E.run('hItem') !== null, '到了就出');
  // 没捡到：落到身后屏幕外
  E.run('hItem.x = P.x + 200; hItem.y = wwrap(P.y + hBottomGap() + 100);'); E.step(2);
  ok(E.run('hItem') === null && E.run('hProp') === null, '没捡到、落到屏幕底下：没了');
  ok(Math.abs(E.run('hPropNext - hTop') - 300 * E.run('HD.m')) < 1, '照样再往上 300 米出下一个');
}

console.log('3) 黑板尺：10 秒里能斩的范围翻倍');
{
  const E = fresh();
  ok(E.run('hAimR()') === E.run('HD.aimR'), '平时锁得上 ' + E.run('HD.aimR'));
  E.run('spawnEnemy(P.x, P.y - 400, "grunt"); enemies[0].sp = 0; enemies[0].born = 1;');
  ok(E.run('hLock({ x: 0, y: -1 })') === null, '400 远的够不着');
  putItem(E, 'ruler', 0, 10); E.step(2);
  ok(E.run('hAimR()') === E.run('HD.aimR') * 2, '拿到黑板尺：' + E.run('hAimR()') + '（扩大一倍）');
  ok(E.run('hLock({ x: 0, y: -1 }) && hLock({ x: 0, y: -1 }).ref === enemies[0]'), '400 远的锁得上');
  const y0 = E.run('P.y');
  E.tapDash();
  let f = 0;
  while (E.run('enemies.length') > 0 && f < 40) { E.step(1); f++; }
  ok(E.run('enemies.length') === 0 && E.run('state') === 'play', '这一刀冲得到、斩得死', f + ' 帧');
  ok(f <= 20, '冲得快（不是一刀的时间走完了再慢慢滑过去）：' + (f * 16.7).toFixed(0) + ' 毫秒', f);
  ok(y0 - E.run('P.y') > 340, '人真的冲出去了 400 左右（斩到那一帧就停下来量，差一个身位）', y0 - E.run('P.y'));
  E.step(Math.ceil(10 / 0.0167));
  ok(E.run('hProp') === null && E.run('hAimR()') === E.run('HD.aimR'), '10 秒后回到 ' + E.run('HD.aimR'));
}

console.log('4) 臭水：黑潮赶开 5 秒');
{
  const E = fresh();
  E.run('HD.v0 = 390; HD.catchK = 0.8; hWaveT = 99; hFront = wwrap(P.y + 120); hSurgeT = 0.01;');
  putItem(E, 'stink', 0, 10); E.step(2);
  ok(E.run('hProp && hProp.k') === 'stink', '拿到臭水');
  ok(E.run('hGap()') >= E.run('hBottomGap() + PROP.stink.back') - 1, '黑潮一下子退到屏幕底边外', E.run('hGap()') + ' / ' + E.run('hBottomGap()'));
  let minGap = 1e9, surge = 0;
  for (let i = 0; i < 270; i++) { E.step(1); minGap = Math.min(minGap, E.run('hGap()')); surge = Math.max(surge, E.run('hSurge')); }
  ok(minGap > E.run('hBottomGap()') && E.run('state') === 'play', '站着不动 4.5 秒：一直在屏幕外，没追上来', minGap);
  ok(surge === 0, '也不涌');
  E.run('P.y -= 0; P.vy = 300;');   // 往回（往下）走：它也往后退
  E.step(20);
  ok(E.run('hGap()') >= E.run('hBottomGap() + PROP.stink.back') - 1, '往回走它也往后退', E.run('hGap()'));
  E.step(60);
  ok(E.run('hProp') === null, '5 秒后没了');
  const g0 = E.run('hGap()');
  E.step(60);
  ok(E.run('hGap()') < g0 - 100, '照常追上来', g0 + ' → ' + E.run('hGap()'));
}

console.log('5) 鬼火：往前猛冲 10 秒，剑气斩光身边');
{
  const E = fresh();
  E.run('HD.v0 = 390; hWaveT = 99;');
  putItem(E, 'ghost', 0, 10); E.step(2);
  ok(E.run('hProp && hProp.k') === 'ghost', '拿到鬼火');
  E.step(40);
  ok(-E.run('P.vy') > 650, '自己往前冲：' + Math.round(-E.run('P.vy')) + '（走路 320）', E.run('P.vy'));
  ok(E.run('hQi.length') > 0, '四周飞着剑气');
  // 正前方摆一排：小怪、重型、爆裂者、冲锋者；身后贴上黑潮
  E.run('["grunt", "heavy", "bomb", "charger"].forEach((k, i) => { const e = spawnEnemy(P.x - 90 + 60 * i, P.y - 330, k); e.sp = 0; e.born = 1; });');
  const k0 = E.run('runKills');
  E.step(12);
  ok(E.run('enemies.length') === 0 && E.run('runKills') - k0 >= 4, '前面那一排全斩了（重型、爆裂者也一刀）', E.run('enemies.length'));
  ok(E.run('blasts.length') === 0, '爆裂者不留引信');
  ok(E.run('state') === 'play', '没撞死');
  // 直接撞上去：也不掉命
  E.run(`{ const e = spawnEnemy(P.x, P.y - 4, "heavy"); e.sp = 0; e.born = 1; }`); E.step(2);
  ok(E.run('state') === 'play', '撞上也不死');
  const k1 = E.run('runKills');
  E.run('hFront = wwrap(P.y + 60);'); E.step(2);
  ok(E.run('runKills') > k1 && E.run('horde.every(m => Math.hypot(m.x - P.x, hMemberY(m) - P.y) > PROP.ghost.qiR)') && E.run('state') === 'play',
     '黑潮贴上来：身边那一截全斩、人没事', E.run('runKills') - k1);
  // 不出刀
  E.run(`{ const e = spawnEnemy(P.x, P.y - 200, "grunt"); e.sp = 0; }`);
  E.tapDash();
  ok(E.run('P.dashT') === 0, '点「斩」不出刀（剑气在斩）');
  const y0 = E.run('hTop'), t0 = E.run('gameTime - (10 - hProp.t)');   // 走多远看 hTop（P.y 跨过世界边界会绕回来）
  for (let i = 0; i < 700 && E.run('hProp'); i++) E.step(1);
  ok(E.run('hProp') === null && Math.abs(E.run('gameTime') - t0 - 10) < 0.1, '10 秒后没了', E.run('gameTime') - t0);
  ok(E.run('P.inv') > 0.9, '冲完再无敌一会儿', E.run('P.inv'));
  ok((E.run('hTop') - y0) / 40 > 120, '这一下又往前冲了 ' + Math.round((E.run('hTop') - y0) / 40) + ' 米（后 9 秒）');
  E.step(90);
  ok(-E.run('P.vy') < 400 && E.run('state') === 'play', '慢回走路的速度', E.run('P.vy'));
}

console.log('6) 嘉欣糖：路上撒、碰到就捡、存进存档（用户："获取判定距离更大，也不要连续三个这样放，一次一到三个随机，放置概率增加"）');
{
  const E = fresh();
  ok(E.run('hCandy.length') === 0 && E.run('hCandyNext') >= 20 * 40 && E.run('hCandyNext') <= 40 * 40, '开局 20~40 米撒第一次', E.run('hCandyNext') / 40);
  // 一次 1~3 颗随机，各摆各的
  const cnt = {}; let apart = true, ahead = true, sameRow = 0;
  for (let i = 0; i < 300; i++) {
    E.run('hCandy = []; hTop = hCandyNext; hSpawnProps();');
    const cs = E.run('hCandy.map(c => [c.x, wdelta(c.y - P.y)])');
    cnt[cs.length] = (cnt[cs.length] || 0) + 1;
    for (let a = 0; a < cs.length; a++) {
      if (cs[a][1] > -E.run('H * 0.5')) ahead = false;
      for (let b = a + 1; b < cs.length; b++) if (Math.hypot(cs[a][0] - cs[b][0], cs[a][1] - cs[b][1]) < E.run('PROP.candyGap') - 0.01) apart = false;
    }
    // 以前：三颗排成一条等距斜线（横 34、竖 58）
    if (cs.length === 3 && Math.abs(cs[1][0] - cs[0][0] - (cs[2][0] - cs[1][0])) < 1 && Math.abs(cs[1][1] - cs[0][1] - (cs[2][1] - cs[1][1])) < 1) sameRow++;
  }
  ok(cnt[1] > 60 && cnt[2] > 60 && cnt[3] > 60 && !cnt[0] && !cnt[4], '一次 1~3 颗随机', JSON.stringify(cnt));
  ok(apart && sameRow === 0, '不再排成一条斜线：各摆各的、彼此隔开');
  ok(ahead, '都摆在前面（屏幕顶上外面）');
  const gaps = [];
  for (let i = 0; i < 200; i++) { const t0 = E.run('hCandyNext'); E.run('hTop = hCandyNext; hSpawnProps();'); gaps.push((E.run('hCandyNext') - t0) / 40); }
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  ok(avg < 35 && Math.min.apply(null, gaps) >= 20 && Math.max.apply(null, gaps) <= 40, '撒得更勤：平均每 ' + avg.toFixed(0) + ' 米撒一次（以前 55~85 米）', avg);
  // 判定距离更大
  ok(E.run('P.r + PROP.candyR') >= 120, '离主角 ' + E.run('P.r + PROP.candyR') + ' 以内就捡到（以前 30，后来 60）');
  E.run('hCandy = [{ x: P.x + 100, y: P.y - 40, ph: 0 }, { x: P.x - 180, y: P.y - 60, ph: 0 }];'); E.step(2);
  ok(E.run('hCandyRun') === 1 && E.run('hCandy.length') === 1, '离 108 的捡到了，离 190 的没捡', E.run('hCandyRun'));
  E.run('hCandy[0].x = P.x + 200; hCandy[0].y = wwrap(P.y + hBottomGap() + 100);'); E.step(2);
  ok(E.run('hCandy.length') === 0, '落到屏幕底下的没了');
  // 走六百米大概撒多少
  E.run('hCandy = []; hCandyNext = rand(PROP.candyEvery[0], PROP.candyEvery[1]) * HD.m; hTop = 0; for (; hTop < 600 * HD.m; hTop += 20) { hSpawnProps(); }');
  const n6 = E.run('hCandy.length');
  ok(n6 >= 28 && n6 <= 60, '六百米撒 ' + n6 + ' 颗（以前约 27）', n6);
  E.run('hCandy = []; hCandyRun = 7; meta.candy = 5;');
  E.run('hFront = wwrap(P.y + 10);'); E.step(3);
  ok(E.run('state') === 'dead', '死了');
  ok(E.run('meta.candy') === 12 && JSON.parse(E.storage.dash_meta_v1).candy === 12, '这一局的 7 颗存进去了（5 → 12）', E.run('meta.candy'));
  let err = null;
  try { E.step(80); E.run('render();'); } catch (e) { err = e; }
  ok(!err, '失败页画得出来（报捡了几颗）', err && err.message);
}

console.log('7) 道具只有一个颜色（用户："道具颜色改回去，就一个颜色"）；商店改卖嘉豪皮肤（见 test-skins.js）');
{
  const E = makeEnv();
  E.run('meta.runs = 5;'); E.step(5);
  ok(E.run('PROP_KINDS.every(k => PROP_SKINS[k].length === 1)'), '每个道具一个颜色');
  ok(E.run('skinOf("ruler").id') === 'wood' && E.run('skinOf("stink").id') === 'green' && E.run('skinOf("ghost").id') === 'cyan', '木尺 / 绿臭水 / 青鬼火');
  ok(E.run('shopOn()') && E.run('readyVibBtn().x') > 195, '商店开着（卖嘉豪皮肤）：入口在左上角，振动开关在右边', E.run('readyVibBtn().x'));
  let err = null;
  try { E.run('toReady();'); E.step(3); E.run('render();'); } catch (e) { err = e; }
  ok(!err, '主界面画得出来', err && err.message);
  // 1024.1817 买过换色的：按原价退回嘉欣糖，装着的换回默认
  const E2 = makeEnv({ candy: 33, skins: { 'stink.purple': 1, 'ghost.red': 1, 'ruler.gold': 0 }, skinOn: { stink: 'purple', ghost: 'red' } });
  ok(E2.run('meta.candy') === 33 + 60 + 150, '买过的换色按原价退回（33 + 60 + 150）', E2.run('meta.candy'));
  ok(E2.run('Object.keys(meta.skins).length') === 0 && E2.run('skinOf("stink").id') === 'green' && E2.run('skinOf("ghost").id') === 'cyan', '装着的换回原来的颜色');
  ok(JSON.parse(E2.storage.dash_meta_v1).candy === 243, '退的糖存进存档');
  const E3 = makeEnv({ candy: 243, skins: {}, skinOn: {} });
  ok(E3.run('meta.candy') === 243, '退过一次，下次读档不再退');
  E.tapRect(E.run('readyCandyBtn()'));
  ok(E.run('state') === 'shop', '点左上角：进皮肤商店');
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '商店画得出来', err && err.message);
}

console.log('8) 画面：笔数');
{
  const E = fresh();
  const cost = code => { E.ops.fill = 0; E.ops.stroke = 0; E.ops.fillRect = 0; E.ops.drawImage = 0; E.run(code); return E.ops.fill + E.ops.stroke + E.ops.fillRect + E.ops.drawImage; };
  E.run('hCandy = []; for (let i = 0; i < 3; i++) hCandy.push({ x: P.x + i * 30, y: P.y - 100 - i * 50, ph: 0 });');
  const c3 = cost('drawHCandy()');
  E.run('hCandy = []; for (let i = 0; i < 30; i++) hCandy.push({ x: P.x + (i % 6) * 30 - 90, y: P.y - 100 - i * 20, ph: 0 });');
  const c30 = cost('drawHCandy()');
  ok(c3 === c30 && c30 <= 4, '糖 3 颗、30 颗都是 ' + c30 + ' 笔', c3 + ' / ' + c30);
  putItem(E, 'ruler', 100, 300);
  E.run('drawHItem()');                     // 头一次先把贴图画好
  const ci = cost('drawHItem()');
  ok(ci <= 3, '路上的道具 ' + ci + ' 笔（光、环、贴图）', ci);
  for (const k of ['ruler', 'stink', 'ghost', 'magnet']) {
    E.run('hItem = null; hProp = { k: "' + k + '", t: 5, T: 10, qiT: 0, fxT: 0 }; hQi.length = 0;');
    if (k === 'ghost') E.run('for (let i = 0; i < 40; i++) hQi.push({ a: i, d: 100, life: 0.1 });');
    const c = cost('drawPropFx()');
    ok(c <= 5, PROP_N(k) + '生效：' + c + ' 笔', c);
    let err = null;
    try { E.run('render(); state = "pause"; render(); state = "play";'); } catch (e) { err = e; }
    ok(!err, PROP_N(k) + '生效时整屏画得出来（局内 / 暂停）', err && err.message);
  }
  E.run('hProp = null; hQi.length = 0;');
  ok(cost('drawPropFx()') === 0, '没道具：不画');
}
function PROP_N(k) { return { ruler: '黑板尺', stink: '臭水', ghost: '鬼火', magnet: '吸铁石' }[k]; }

console.log('9) 关掉道具（PROP.on = false）：不摆、不撒、主界面左上角还是振动开关');
{
  const E = makeEnv();
  E.run('PROP.on = false; meta.runs = 5;'); E.step(5);
  ok(E.run('readyVibBtn().x') < 60, '振动开关回到左上角');
  E.tap(195, 420);
  E.run('hTop = 1e6;'); E.step(10);
  ok(E.run('hItem') === null && E.run('hCandy.length') === 0, '路上什么都不出');
}

console.log('10) 开局看广告带道具（用户："开局是否看广告开始，我们放在开始动画之前，单独搞一个画面，让他选择，选择时间五秒"）');
{
  const E = makeEnv();
  E.run('meta.runs = 5; HD.intro = true; HD.preAd = true;'); E.step(5);
  ok(E.run('readyPropAd') === null, '主界面不再有「看广告 · 带道具开局」');
  E.tap(195, 420); E.step(1);
  ok(E.run('state') === 'preAd', '点「开始」：先到「带个道具开局？」那一页（开场还没放）', E.run('state'));
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '这一页画得出来', err && err.message);
  const L = JSON.parse(E.run('JSON.stringify(preAdLayout())'));
  E.step(20);
  E.tapRect(L.ad);
  ok(E.run('state') === 'ad' && E.run('adAction') === 'prop', '点「看广告 · 带道具开局」：先看广告', E.run('state'));
  E.run('endAd(false);');
  ok(E.run('state') === 'preAd' && E.run('preAdLeft()') > 4.5 && E.run('hStartProp') === null, '没看完：回这一页，重新数 5 秒，不给道具', E.run('state'));
  E.step(20); E.tapRect(L.ad); E.step(Math.ceil(3 / 0.0167) + 5);
  ok(E.run('state') === 'propPick', '看完：四个道具挑一个', E.run('state'));
  const cards = JSON.parse(E.run('JSON.stringify(propPickLayout().cards)'));
  ok(cards.length === 4 && cards.map(c => c.k).join() === 'ruler,stink,ghost,magnet', '四张卡：黑板尺 / 臭水 / 鬼火 / 吸铁石');
  ok(cards[3].y + cards[3].h <= E.run('H_CSS - SAFE_BOTTOM') && cards[3].h >= 80, '四张都在屏幕里、够大好点', cards[3].h);
  E.tapRect(cards[2]);
  ok(E.run('state') === 'play' && E.run('hordeMode') && E.run('hIntro !== null'), '挑了就开局（开场照常放）');
  ok(E.run('hProp') === null && E.run('hStartProp') === 'ghost', '开场里还没生效');
  for (let i = 0; i < 400 && E.run('hIntro !== null'); i++) E.step(1);
  ok(E.run('hIntro') === null && E.run('hProp && hProp.k') === 'ghost' && E.run('hProp.start'), '开场一结束：鬼火生效', E.run('hProp && hProp.k'));
  ok(E.run('hStartProp') === null && E.run('hPropUsed') === 1, '只生效一次，测试数据记一个');
  E.run('hProp.t = 0;'); E.step(2);
  const nx = E.run('hPropNext'), top = E.run('hTop'), m = E.run('HD.m');
  ok(E.run('hProp') === null && nx <= Math.max(120 * m, top) + 1, '用完：不占路上的名额，第一个照常在 120 米出（过了就马上出）', nx / m);
  E.run('hStartProp = "stink"; startHorde();');
  ok(E.run('hStartProp') === null, '平常开局不带');
  // 5 秒没选：直接开始；点「直接开始」也一样
  E.run('toReady();'); E.step(3); E.tap(195, 420); E.step(1);
  ok(E.run('state') === 'preAd', '再点开始：又问一遍');
  E.step(Math.ceil(5.2 / 0.0167));
  ok(E.run('state') === 'play' && E.run('hStartProp') === null, '5 秒没选：直接开始（不带道具）');
  E.run('toReady();'); E.step(3); E.tap(195, 420); E.step(20);
  E.tapRect(JSON.parse(E.run('JSON.stringify(preAdLayout().go)')));
  ok(E.run('state') === 'play', '点「直接开始」：马上开');
  // 第一次玩（要上新手教程）、道具关着：不问
  E.run('toReady(); HD.tut = true; meta.htut = 0;'); E.step(3); E.tap(195, 420); E.step(1);
  ok(E.run('state') === 'play', '第一次玩（要教）：不问，直接开局上教程');
  E.run('toReady(); HD.tut = false; PROP.on = false;'); E.step(3); E.tap(195, 420); E.step(1);
  ok(E.run('state') === 'play', '道具关着：不问');
}
{
  const E = fresh();
  E.run('HD.preAd = true; hRevives = H_REVIVE.max;');      // 这局复活过了：死了直接到排名页
  E.run('hFront = wwrap(P.y + 10);'); E.step(3);
  ok(E.run('state') === 'dead', '死了');
  E.step(Math.ceil((E.run('DEAD_LOOK') + 0.4) / 0.0167));
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err && E.run('hEnd') === 'rank', '排名页画得出来', err && err.message);
  const b = JSON.parse(E.run('JSON.stringify(hordeEndBtns())'));
  ok(!b.ad && b.back.y >= b.go.y + b.go.h && b.back.y + b.back.h <= E.run('H_CSS - SAFE_BOTTOM'), '排名页只有「再来一局」「返回主界面」（带道具挪到开局前那一页），不重叠');
  E.tapRect(b.go); E.step(1);
  ok(E.run('state') === 'preAd', '「再来一局」：先到「带个道具开局？」那一页');
  E.step(20); E.tapRect(JSON.parse(E.run('JSON.stringify(preAdLayout().ad)'))); E.run('finishAd();');
  ok(E.run('state') === 'propPick', '看完：挑道具');
  E.tapRect(JSON.parse(E.run('JSON.stringify(propPickLayout().cards[1])')));
  ok(E.run('state') === 'play' && E.run('hProp && hProp.k') === 'stink', '挑了臭水就开局（这里没开场：马上生效）', E.run('hProp && hProp.k'));
}

console.log('11) 用户："玩到后面鬼火跑不过黑潮"、"道具和糖也改为可以斩"、"道具判定和图形再大一圈"');
{
  // 后面的波：黑潮照常追（潮速、加速追、涌浪都开着），身后贴着，拿鬼火冲 10 秒
  const E = fresh();
  E.run('HD.v0 = 390; HD.vWave = 15; HD.catchK = 0.8; hWave = 14; hWaveT = 99; hSurgeT = 0.01; hFront = wwrap(P.y + 150);');
  ok(E.run('Math.min(HD.vMax, HD.v0 * hTempo() + HD.vWave * (hWave - 1))') >= 690, '第 14 波：潮速 ' + E.run('Math.min(HD.vMax, HD.v0 * hTempo() + HD.vWave * (hWave - 1))'));
  putItem(E, 'ghost', 0, 10); E.step(2);
  ok(E.run('hProp && hProp.k') === 'ghost', '拿到鬼火');
  let surge = 0;
  for (let i = 0; i < 560 && E.run('hProp'); i++) { E.step(1); surge = Math.max(surge, E.run('hSurge')); }
  ok(-E.run('P.vy') > 1.4 * 700, '冲得比黑潮快得多：' + Math.round(-E.run('P.vy')) + '（黑潮最快 700）', E.run('P.vy'));
  ok(surge === 0, '冲的时候黑潮不涌');
  ok(E.run('hGap() > hBottomGap() + 300'), '冲了 9 秒：黑潮被甩到屏幕底下外面老远', Math.round(E.run('hGap() - hBottomGap()')));
  for (let i = 0; i < 120 && E.run('hProp'); i++) E.step(1);
  E.step(30);
  ok(E.run('state') === 'play' && E.run('hGap() > hBottomGap()'), '冲完半秒：黑潮还在屏幕外，没被贴上');
  // 糖也能斩：前面只有一颗糖，点「斩」锁它、冲过去捡到
  const F = fresh();
  F.run('hCandy = [{ x: P.x + 10, y: wwrap(P.y - 200), ph: 0 }]; hCandyRun = 0;');
  ok(F.run('hLock({ x: 0, y: -1 }) && hLock({ x: 0, y: -1 }).ref === hCandy[0]'), '前面只有糖：点「斩」锁得上它');
  F.tapDash();
  for (let i = 0; i < 12 && F.run('hCandyRun') === 0; i++) F.step(1);
  ok(F.run('hCandyRun') === 1 && F.run('hCandy.length') === 0, '斩过去就捡到');
  ok(F.run('P.cd') === 0, '捡到那一下冷却清零（跟斩死怪一样，马上能接下一刀）', F.run('P.cd'));
  // 用户："有道具优先斩道具，没有道具 优先斩前面最远的"：糖和怪一样排，前面最远的先锁
  F.run('hCandy = [{ x: P.x, y: wwrap(P.y - 220), ph: 0 }]; { const e = spawnEnemy(P.x, P.y - 150, "grunt"); e.sp = 0; e.born = 1; }');
  ok(F.run('hLock({ x: 0, y: -1 }).ref === hCandy[0]'), '糖在怪后面：锁更远的糖（路上的怪顺手斩）');
  F.run('hCandy[0].y = wwrap(P.y - 100);');
  ok(F.run('hLock({ x: 0, y: -1 }).ref === enemies[0]'), '怪更远：锁怪（路上的糖顺手捡）');
  F.run('{ const e = spawnEnemy(P.x + 60, P.y - 225, "grunt"); e.sp = 0; e.born = 1; }');
  ok(F.run('hLock({ x: 0, y: -1 }).ref === enemies[1]'), '两只怪：锁前面更远的那只');
  ok(F.run('hLock({ x: 1, y: 0 })') === null, '往右推：前面（右边）够不着的不锁');
  putItem(F, 'ruler', -30, 90);
  ok(F.run('hLock({ x: 0, y: -1 }).ref === hItem'), '有道具：先锁道具（哪怕它最近）');
  F.run('hItem.y = wwrap(P.y + 120);');
  ok(F.run('hLock({ x: 0, y: -1 }).ref === enemies[1]'), '道具在身后（够不着）：照常锁前面最远的');
  F.run('hItem = null; enemies.length = 0; hCandy = [];');
  // 道具判定、图形再大一圈
  ok(F.run('P.r + PROP.pickR') >= 64, '道具：离主角 ' + F.run('P.r + PROP.pickR') + ' 以内就拿到（以前 44）');
  F.run('enemies.length = 0; hCandy = []; hProp = null;'); putItem(F, 'stink', 55, 10); F.step(2);
  ok(F.run('hProp && hProp.k') === 'stink', '离 55 也拿到了');
}

console.log('12) 吸铁石（用户："加一个道具，类似磁铁，有嘉欣糖直接吸进去"）');
{
  const E = fresh();
  E.run('hCandy = [{ x: P.x + 250, y: wwrap(P.y - 300), ph: 0 }, { x: P.x - 200, y: wwrap(P.y - 420), ph: 0 }, { x: P.x + 100, y: wwrap(P.y - 900), ph: 0 }]; hCandyRun = 0;');
  putItem(E, 'magnet', 0, 10); E.step(2);
  ok(E.run('hProp && hProp.k') === 'magnet' && E.run('PROP_NAME.magnet') === '吸铁石', '拿到吸铁石');
  E.step(50);
  ok(E.run('hCandyRun') === 2, '离 600 以内的两颗：一秒内吸过来捡到', E.run('hCandyRun'));
  ok(E.run('hCandy.length') === 1 && Math.abs(E.run('wdelta(hCandy[0].y - P.y)')) > 600, '600 外那颗不动');
  E.run('hCandy.push({ x: P.x - 150, y: wwrap(P.y - 500), ph: 0 });');
  E.step(40);
  ok(E.run('hCandyRun') === 3, '后来撒下来的进了范围也吸');
  for (let i = 0; i < 700 && E.run('hProp'); i++) E.step(1);
  ok(E.run('hProp') === null, '10 秒后没了');
  E.run('hCandy = [{ x: P.x + 250, y: wwrap(P.y - 300), ph: 0 }];'); E.step(30);
  ok(E.run('hCandy.length') === 1, '没了就不吸');
}

console.log('13) 斩击范围（用户："在玩家界面加一个斩击范围，和拿了尺子之后有个更好的对比"）');
{
  const E = fresh();
  const cost = code => { E.ops.fill = 0; E.ops.stroke = 0; E.ops.fillRect = 0; E.ops.drawImage = 0; E.run(code); return E.ops.fill + E.ops.stroke + E.ops.fillRect + E.ops.drawImage; };
  E.step(3);
  ok(cost('drawHRange()') === 2 && Math.abs(E.run('hRangeR') - E.run('HD.aimR')) < 1, '平时：一道弧，标在能斩的 ' + E.run('HD.aimR') + '，左半蓝右半黄（两笔）', E.run('hRangeR'));
  putItem(E, 'ruler', 0, 10); E.step(3);
  const r1 = E.run('hRangeR');
  E.step(40);
  const r2 = E.run('hRangeR');
  const R0 = E.run('HD.aimR');
  ok(r1 < R0 * 1.5 && r2 > R0 * 1.7, '拿了黑板尺：弧往外扩到两倍（看得出是扩开的）', Math.round(r1) + ' → ' + Math.round(r2));
  ok(cost('drawHRange()') === 3, '尺子的弧左半蓝右半黄 + 原来那道淡弧对比（三笔）');
  E.run('hProp.t = 0;'); E.step(3); E.step(40);
  ok(Math.abs(E.run('hRangeR') - E.run('HD.aimR')) < 3, '用完缩回来', E.run('hRangeR'));
  putItem(E, 'ghost', 0, 10); E.step(3);
  ok(cost('drawHRange()') === 0, '鬼火（不出刀）：不画');
}

console.log('14) 看广告复活（用户："看广告复活这个功能要上线了"）');
{
  const E = fresh();
  E.run('meta.candy = 100; meta.runs = 5; meta.total = 0; TEST.runs.length = 0;');
  E.run('hCandyRun = 7; score = 50; hTop = 300 * HD.m;');
  E.run('hFront = wwrap(P.y + 10);'); E.step(3);
  ok(E.run('state') === 'dead', '最后一条命没了');
  ok(E.run('meta.candy') === 107 && E.run('meta.runs') === 6 && E.run('TEST.runs.length') === 1, '先记进存档（关掉游戏也不丢）：糖 +7、局数 +1', E.run('meta.candy') + ' / ' + E.run('meta.runs'));
  E.step(Math.ceil((E.run('DEAD_LOOK') + 0.4) / 0.0167));
  let b = JSON.parse(E.run('JSON.stringify(hordeEndBtns())'));
  ok(E.run('hEnd') === 'revive' && b.revive && b.skip && b.skip.y >= b.revive.y + b.revive.h, '先到复活页：「看广告 · 复活」下面「不用了」');
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '画得出来', err && err.message);
  E.tapRect(b.revive);
  ok(E.run('state') === 'ad' && E.run('adAction') === 'revive', '点它先看广告');
  E.run('endAd(false);');
  ok(E.run('state') === 'dead' && E.run('hEnd') === 'revive' && Math.abs(E.run('hEndLeft()') - 3) < 0.05, '没看完：回复活页，再给 3 秒', E.run('hEndLeft()'));
  E.step(20); E.tapRect(b.revive); E.run('finishAd();');
  ok(E.run('state') === 'play' && E.run('hLives') === E.run('HD.lives'), '看完：原地回来，满命', E.run('hLives'));
  ok(E.run('P.inv') > 2 && E.run('hGap() > hBottomGap()'), '回来无敌一会儿，黑潮推回屏幕外');
  ok(E.run('TEST.runs.length') === 0, '测试数据：死的那条先撤掉（等真正结束再记）');
  E.step(200);
  ok(E.run('state') === 'play', '回来两秒多没死');
  E.run('hCandyRun = 12; score = 80; P.inv = 0; hHurtT = 0; hFront = wwrap(P.y + 10);'); E.step(3);
  ok(E.run('state') === 'dead', '又死了');
  ok(E.run('meta.candy') === 112 && E.run('meta.runs') === 6 && E.run('meta.total') === 80, '再记一次只补差额：糖一共 +12、局数还是 +1、分 80', E.run('meta.candy') + ' / ' + E.run('meta.runs') + ' / ' + E.run('meta.total'));
  ok(E.run('TEST.runs.length') === 1 && E.run('TEST.runs[0].rev') === 1, '测试数据：这一局一条，记着复活 1 次');
  E.step(Math.ceil((E.run('DEAD_LOOK') + 0.4) / 0.0167));
  ok(E.run('hEnd') === 'rank' && !E.run('hordeEndBtns().revive'), '每局只能复活一次：第二次死直接到排名页');
  E.run('startHorde();');
  ok(E.run('hCanRevive()'), '下一局又能复活');
}

console.log('15) HUD 数字不再重画字（1025.1500 测试数据：分数每 0.3 秒重画一次贴图就掉一帧，一局 390 次卡顿）');
{
  const E = makeEnv();
  E.run('meta.runs = 5;');
  E.step(2);
  const n0 = E.run('Object.keys(NSTRIP).length');
  E.step(30);
  const n1 = E.run('Object.keys(NSTRIP).length'), want = 3 + 2 * (E.run('COMBO_TIERS.length') + 1);
  ok(n0 <= 3 && n1 === want, '主界面上一帧画一张数字条（不一下全画）：' + n1 + ' 张', n0 + ' → ' + n1);
  E.tap(195, 420);
  const texts = code => { E.ops.fillText = 0; E.ops.strokeText = 0; E.run(code); return E.ops.fillText + E.ops.strokeText; };
  E.run('FB.chain = 0; FB.tierPop = 0;');
  E.run('FB.tier = 3; combo = 40; drawHordeUI();');     // 段位签一段才变一次：先画好
  let worst = 0;
  for (let i = 0; i < 20; i++) {
    worst = Math.max(worst, texts('FB.score = ' + (1234 + i * 997) + '; combo = ' + (40 + i * 37) + '; hTop += 3 * HD.m; drawHordeUI();'));
  }
  ok(worst === 0, '分数、连斩数、米数一直在变：一个字都不重写（全贴数字条）', worst);
  let wt = 0;
  for (let t = -1; t < 7; t++) wt = Math.max(wt, texts('FB.tier = ' + t + '; combo = 3; drawHudCombo(hudTop()); FB.tierPop = 0;') - (t >= 0 ? 6 : 0));
  ok(wt <= 0, '每个段位颜色的连斩数也都是贴的（只有段位签换段时重画一次）', wt);
  E.run('FB.score = 98765; FB.record = true; drawHudScore(hudTop());');      // 底下那条换成"新纪录"：画一次
  ok(texts('FB.score = 99999; drawHudScore(hudTop());') === 0, '新纪录（金色）的分数也是贴的');
  E.ops.drawImage = 0; E.run('drawHudScore(hudTop());');
  ok(E.ops.drawImage <= 7, '分数 5 位：' + E.ops.drawImage + ' 次贴图（一位一次 + 底下那条）', E.ops.drawImage);
}

console.log('15b) 局里不在一帧画到一半去重画贴图（1025.2000 测试数据：「分数」「米数」轮流一帧好几到十几毫秒）');
{
  const E = makeEnv();
  E.run('meta.runs = 5;'); E.step(40);
  E.tap(195, 420);
  E.run('isTouch = true; var midBake = 0, txBake0 = txBake; txBake = function (e, k, w, h, d) { if (txDefer) midBake++; return txBake0(e, k, w, h, d); };');
  E.run('FB.score += 137; combo = 40; comboTimer = 2; hRage = 7; hCandyRun++; hTop += 2 * HD.m; P.inv = 9;'); E.step(5);   // 每张贴图先出现一次（头一次没有旧的可贴，只能当场画）
  E.run('midBake = 0;');
  for (let i = 0; i < 30; i++) { E.run('FB.score += 137; combo += 3; comboTimer = 2; hRage = (hRage + 7) % 100; hCandyRun++; hTop += 2 * HD.m; P.inv = 9;'); E.step(1); }
  ok(E.run('midBake') === 0, '分数 / 连斩 / 怒气 / 糖数 / 米数一直在变：画到一半一次都不重画（都排到下一帧开头）', E.run('midBake'));
  ok(E.run('PERF.bake') > 20, '下一帧开头照样重画了（数字跟得上）', E.run('PERF.bake'));
  E.ops.drawImage = 0; E.run('drawHudScore(hudTop());');
  ok(E.ops.drawImage === 2, '分数一张图 + 底下那条：2 次贴图', E.ops.drawImage);
  // 数笔数：包一层主画布的填 / 描 / 贴图 / 写字（这里的假画布自己接管了这几个，拿一个普通对象试）
  E.run('var g0 = { n: 0, fill() { this.n++; }, drawImage() { this.n++; } }; wrapOps(g0); OPS = 0; g0.fill(); g0.drawImage(); g0.fill();');
  ok(E.run('OPS') === 3 && E.run('g0.n') === 3, '每画一笔数一笔，原来的照样画', E.run('OPS'));
  E.run('PERF.ops = [600, 9]; PERF.frames = 3; testRecord();');
  ok(E.run('JSON.stringify(TEST.runs[0].ops.slice(0, 2))') === '[200,9]' && E.run('TEST.runs[0].ops[2]') > 0, '测试数据记每帧画几笔（平均 / 最多）、贴图每秒重画几次', E.run('JSON.stringify(TEST.runs[0].ops)'));
  ok(/每帧画几笔 平均 200 · 最多 9/.test(E.run('[].concat(testReport()).join("\\n")')), '测试数据页写出来', '');
}

console.log('16) 收刀后 0.3 秒里碰到挡路的还算斩到（1025.1500 测试数据：4 次被杂兵撞死全在收刀后 0.08~0.17 秒）');
{
  const E = fresh();
  E.step(3);
  E.run('enemies.length = 0; P.inv = 0; lastDashEnd = gameTime - 0.15; { const e = spawnEnemy(P.x, P.y - 2, "grunt"); e.sp = 0; e.born = 1; }');
  const k0 = E.run('runKills');
  E.step(2);
  ok(E.run('state') === 'play' && E.run('enemies.length') === 0 && E.run('runKills') === k0 + 1, '收刀后 0.15 秒撞上杂兵：斩掉了，人没事');
  E.run('P.inv = 0; lastDashEnd = gameTime - 0.6; { const e = spawnEnemy(P.x, P.y - 2, "grunt"); e.sp = 0; e.born = 1; }');
  E.step(2);
  ok(E.run('state') === 'dead', '收刀 0.6 秒以后再撞：照常撞死（不是一直无敌）', E.run('state'));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
