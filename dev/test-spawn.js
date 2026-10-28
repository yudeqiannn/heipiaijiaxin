/* 刷怪（2.12 节 hBlock / hFillAhead / hFillDry）测试 —— 用户："还是怪物刷新问题，现在容易出现真空期，想个办法修改下刷新机制"
   1) 一组接一组：下一组从上一组最靠前那只往上隔 blockGap 摆（不扎堆、不断一大截）
   2) 身后跑过去、掉出屏幕底边的收掉；屏幕里身后的还在
   3) 名额满了：这一组等一等再摆，不跳过
   4) 只摆在中间（左右 blockHalf 以内）：斩只往斜前方，横着够不着整条走廊
   5) 兜底：fillWait 秒没东西可斩，前面一刀外长出一只（贴边时长在靠中间那侧）；有得斩、冲刺里、关掉时不冒
   6) 两把斩机器人跑一分钟：没东西可斩最长不到一秒 */
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
  return { run, step, tap, tapRect, tapDash, ops, storage, down, up };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局黑潮：挡路的清掉、不自己摆，黑潮停在屏幕外不动，无敌
function go(autoRun) {
  const E = makeEnv();
  E.run('meta.runs = 5; HD.autoRun = ' + !!autoRun + ';'); E.step(5);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hCandy = []; hCandyNext = 1e12; hPropNext = 1e12; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9;');
  E.step(2);
  return E;
}
const foe = (E, dx, dy) => E.run('{ const e = spawnEnemy(P.x + ' + dx + ', wwrap(P.y + ' + dy + '), "grunt"); e.sp = 0; e.born = 1; e; }');

console.log('1) 一组接一组往上摆：从上一组最靠前那只往上隔 blockGap');
{
  const E = go(true);
  // 每摆一组记下：这一组的底（摆在哪）、最靠前那只（摆的那一刻）
  E.run('var _g = []; var _hb = hBlock; hBlock = function (y) { const t = _hb(y); if (t) _g.push({ y: y, top: t.y }); return t; };');
  E.run('hNext = hTop;');
  for (let i = 0; i < 900; i++) { E.step(1); E.run('enemies.forEach(e => e.sp = 0);'); }   // 怪站着不动：量的就是摆的时候的间隔
  const g = JSON.parse(E.run('JSON.stringify(_g.map(o => [o.y, o.top]))'));
  const gaps = [];
  for (let i = 1; i < g.length; i++) gaps.push(E.run('wdelta(' + g[i - 1][1] + ' - ' + g[i][0] + ')'));
  const lo = Math.min.apply(null, gaps), hi = Math.max.apply(null, gaps);
  ok(g.length > 12, '（跑了 15 秒，摆了 ' + g.length + ' 组）', g.length);
  ok(lo >= 150 * E.run('Math.max(0.6, 1 - 0.06 * (hLevel() - 1))') - 25 && hi <= 210 + 25, '上一组最靠前那只 → 下一组：隔 ' + lo.toFixed(0) + ' ~ ' + hi.toFixed(0) + '（blockGap 150~210，越往后越密）', lo.toFixed(0) + ' / ' + hi.toFixed(0));
  ok(gaps.every(d => d > 0), '不扎堆：下一组一定在上一组最靠前那只的前面（以前一串斜线高 250~500，后一组常摆进它中间）');
}

console.log('2) 身后跑过去、掉出屏幕底边的收掉');
{
  const E = go();
  E.run('var _a = spawnEnemy(P.x, wwrap(P.y + hBottomGap() + 120), "grunt"); _a.sp = 0; var _b = spawnEnemy(P.x + 100, wwrap(P.y + 300), "grunt"); _b.sp = 0;');
  E.step(2);
  ok(E.run('enemies.indexOf(_a)') < 0, '掉出屏幕底边的：收掉（不再占名额）');
  ok(E.run('enemies.indexOf(_b)') >= 0, '屏幕里身后的：还在');
}

console.log('3) 名额满了：等一等再摆，不跳过');
{
  const E = go(true);
  E.run('for (let i = 0; enemies.length < HD.blockMax; i++) { const e = spawnEnemy(P.x + (i % 2 ? 300 : -300), wwrap(P.y - 400 - 40 * i), "grunt"); e.sp = 0; }');
  E.run('hNext = hTop + 1;');
  const n0 = E.run('enemies.length'), h0 = E.run('hNext');
  E.step(30);
  ok(E.run('enemies.length') === n0 && E.run('hNext') === h0, '满了：不摆，hNext 不往前跳（以前直接跳过这一组）', E.run('enemies.length') + ' / ' + E.run('hNext - ' + h0));
  E.run('enemies.splice(0, 6);');
  E.step(1);
  const top = E.run('cam.y - H / 2');
  ok(E.run('enemies.length') > n0 - 6, '空出名额：下一帧就摆上', E.run('enemies.length'));
  ok(E.run('enemies.slice(' + (n0 - 6) + ').every(e => wdelta(e.y - ' + top + ') < 0)'), '摆在屏幕顶外（不在眼前冒出来）');
  ok(E.run('hNext') > E.run('hTop') + 100, '间隔从现在算（不一下摆好几组补回来）', E.run('hNext - hTop').toFixed(0));
}

console.log('4) 只摆在中间：左右 blockHalf 以内');
{
  const E = go();
  E.run('HD.blockMax = 1e9; HD.blockTop = 1e9; CFG.maxEnemies = 1e9; for (let k = 0; k < 300; k++) { hWave = 1 + (k % 6); hTop = 2400 + k; hBlock(P.y - 400 - (k % 10) * 60); hTop = 0; hWave = 1; }');
  const far = E.run('Math.max.apply(null, enemies.map(e => Math.abs(e.x - hX0)))');
  ok(E.run('enemies.length') > 400, '（摆了 ' + E.run('enemies.length') + ' 只，各种花样都有）');
  ok(far <= E.run('HD.blockHalf') + 0.5, '离中线最远 ' + far.toFixed(0) + '（以前整条走廊 ±320 都摆，人斩到一边，另一边的怪锁不上）', far.toFixed(0));
  ok(E.run('HD.blockHalf') < E.run('W / 2 - 70'), '比走廊窄（走廊左右 ' + E.run('W / 2 - 70').toFixed(0) + '）');
}

console.log('5) 兜底：fillWait 秒没东西可斩，前面一刀外长出一只');
{
  const E = go();
  E.run('HD.fillWait = 0.45;');
  E.step(Math.round(0.3 / 0.0167));
  ok(E.run('enemies.length') === 0, '0.3 秒：还不冒');
  let f = 0;
  for (; f < 30 && !E.run('enemies.length'); f++) E.step(1);
  ok(E.run('enemies.length') === 1 && Math.abs(0.3 + f * 0.0167 - 0.45) < 0.05, '过了 0.45 秒：冒一只', E.run('enemies.length') + ' / ' + (0.3 + f * 0.0167).toFixed(2));
  ok(E.run('enemies[0].sp') <= 35 && E.run('enemies[0].born') === 0, '慢吞吞的、从地里长出来', E.run('enemies[0].sp').toFixed(0) + ' / ' + E.run('enemies[0].born').toFixed(2));
  const dx = E.run('enemies[0].x - P.x'), dy = E.run('wdelta(enemies[0].y - P.y)'), R = E.run('hAimR()');
  ok(dy <= -(R + 30) + 1 && dy >= -(R + 80) - 1, '在前面一刀外（' + (-dy).toFixed(0) + '，一刀 ' + R + '）：往前一跑就进范围，不会贴脸冒出来', dy.toFixed(0));
  ok(Math.abs(dx) >= 29 && Math.abs(dx) <= 131, '横着偏一点（' + dx.toFixed(0) + '）：在斜前方，两把斩锁得上', dx.toFixed(0));
  // 让它站住：它一秒走 30 左右，冒在一刀外 30~80，两秒有时正好走进范围（锁上了，等的时间就清零了，下面"马上补"就不灵 —— 以前时好时坏就是这个）
  E.run('enemies[0].sp = 0;');
  E.step(Math.round(2 / 0.0167));
  ok(E.run('enemies.length') === 1, '冒出来的那只还没走进范围（人站着不动）：不接着冒（站两秒）', E.run('enemies.length'));
  E.run('enemies.length = 0;');
  E.step(Math.round(0.1 / 0.0167));
  ok(E.run('enemies.length') === 1, '它一没（还是没东西可斩、早就等够了）：马上补一只', E.run('enemies.length'));
}
{
  const E = go();
  E.run('HD.fillWait = 0.45; P.x = hX0 + 250;');
  E.step(Math.round(0.5 / 0.0167));
  ok(E.run('enemies.length') === 1 && E.run('enemies[0].x') < E.run('P.x'), '人贴着右边：长在左前方（靠中间那侧，把人带回来）', E.run('enemies.length && (enemies[0].x - P.x).toFixed(0)'));
  E.run('enemies.length = 0; P.x = hX0 - 250;');
  E.step(Math.round(0.5 / 0.0167));
  ok(E.run('enemies.length') === 1 && E.run('enemies[0].x') > E.run('P.x'), '人贴着左边：长在右前方', E.run('enemies.length && (enemies[0].x - P.x).toFixed(0)'));
}
{
  const E = go();
  E.run('HD.fillWait = 0.45;');
  foe(E, -60, -160);
  E.step(Math.round(2 / 0.0167));
  ok(E.run('enemies.length') === 1, '有得斩：不冒（站着两秒）', E.run('enemies.length'));
  E.run('HD.fillWait = 0; enemies.length = 0;');
  E.step(Math.round(2 / 0.0167));
  ok(E.run('enemies.length') === 0, 'fillWait = 0：关掉，不冒');
}
{
  const E = go(true);
  E.run('HD.fillWait = 0.45;');
  let t = 0;
  for (let i = 0; i < 60 && !E.run('enemies.length'); i++) E.step(1);
  for (; t < 60 && !E.run('!!hAimT'); t++) E.step(1);
  ok(E.run('!!hAimT') && t * 16.7 < 400, '自动往上跑：冒出来 ' + Math.round(t * 16.7) + ' 毫秒就锁得上', t);
}
{
  const E = go(true);
  E.run('HD.fillWait = 0.45; hUseProp("ghost", P.x, P.y);');
  E.step(Math.round(2 / 0.0167));
  ok(E.run('hPropOn("ghost")') && E.run('enemies.length') === 0, '鬼火往前冲（剑气在斩）：不冒');
}

console.log('6) 两把斩机器人跑一分钟（反应 0.12 秒，怒气满了就连斩）：没东西可斩最长不到一秒');
{
  const E = makeEnv();
  E.run('meta.runs = 5; HD.autoRun = true;'); E.step(5);
  E.tap(195, 420);
  E.run('HD.fillWait = 0.45; HD.lives = 999; hLives = 999;');
  let dry = 0, worst = 0, seen = 0, played = 0;
  for (let f = 0; f < 7200 && played < 3600 && E.run('state') === 'play'; f++) {   // 连斩、鬼火的时间不算，凑满一分钟
    E.step(1);
    E.run('hLives = 999;');
    if (E.run('!!hIntro || !!hBurst || hPropOn("ghost")')) { dry = 0; continue; }
    played++;
    const L = E.run('!!hAimTL'), R = E.run('!!hAimTR'), dash = E.run('P.dashT > 0');
    if (!L && !R && !dash) { dry++; worst = Math.max(worst, dry); } else dry = 0;
    if (L || R) seen++; else seen = 0;
    if (E.run('hRage >= 100')) E.run('hBurstGo()');
    else if ((L || R) && !dash && seen >= 7) E.run('hTap(' + (L && R ? (f % 2 ? 1 : -1) : L ? -1 : 1) + ')');
  }
  ok(played > 2400, '（玩了 ' + (played / 60).toFixed(0) + ' 秒，' + E.run('Math.floor(hTop / HD.m)') + ' 米）', played);
  ok(worst * 16.7 < 1000, '最长 ' + Math.round(worst * 16.7) + ' 毫秒没东西可斩（以前每分钟 3~5 次超过一秒，最长两三秒）', worst);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
