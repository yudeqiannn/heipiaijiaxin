/* 越来越难（用户："难度就没有尽头，随着时间越来越难"；会玩的一局活两三分钟；选了"队形越来越难""黑潮越追越近""紧一阵松一阵"）
   1) 难度档：前 heat0 秒 0，之后每分钟 +1、不封顶；开场 / 教程 / 连斩里不走
   2) 黑潮：越来越快但不超过 vMax（用户："黑潮追的速度都比连斩速度快了"）、能甩开的距离越来越短；涌浪越来越勤，冲多猛不涨
   3) 潮峰：每 peakEvery 秒的最后 peakLen 秒难度再加一截、涌浪一个接一个；冲过潮峰黑潮先慢下来
   4) 连斩越往后越难攒、放完喘口气越短；掉一命难度退一点、黑潮慢几秒（不会两秒连掉两命）
   5) 队形：开头只有斜线、弧，之字、台阶后出；越往后越长；夹着爆裂者 / 冲锋者 / 重型（不连着、刚重摆的头两步不放）
   6) 随机摆的：名额越来越多、隔得越来越近、离路越来越近，特别怪的比例越来越高（都有上限）
   7) 前 heat0 秒跟以前一模一样 */
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
  vm.runInContext('HD.intro = false; HD.preAd = false; HD.story = false; CFG.mainMode = "horde"; HD.tut = false; HD.autoRun = false; HD.lives = 1; HD.fillWait = 0; HD.trailUntil = 0;', sb);   // 前期松散的路（HD.trailUntil）在 test-path.js 9 里测   // 新手教程在 test-htut.js 里测
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


// extra 开局前跑（改 HD），after 开局后跑（开局会重置 P.inv 这些）
function go(extra, after) {
  const E = makeEnv();
  E.run('meta.runs = 5; HD.autoRun = true; HD.fillWait = 0.45; HD.lives = 3;' + (extra || '')); E.step(5);
  E.tap(195, 420);
  if (after) E.run(after);
  E.step(2);
  return E;
}
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);

console.log('1) 难度档');
{
  const E = go('', 'P.inv = 1e9;');
  const h0 = E.run('HD.heat0');
  E.run('hDiffT = ' + (h0 - 1) + ';');
  ok(E.run('hHeat()') === 0 && !E.run('hPeak()'), '前 ' + h0 + ' 秒：0（跟以前一样）');
  E.run('hDiffT = ' + (h0 + 60) + ';');
  ok(near(E.run('hHeat()'), 1), '再过一分钟：1');
  E.run('hDiffT = 10 * 60 + ' + h0 + ';');
  ok(E.run('hHeat()') >= 10, '十分钟：' + E.run('hHeat()').toFixed(1) + '（不封顶）');
  E.run('hDiffT = 0;');
  const t0 = E.run('hDiffT'); E.step(60);
  ok(near(E.run('hDiffT') - t0, 1, 0.05), '在跑：一秒走一秒', E.run('hDiffT'));
  E.run('hRage = 100; hBurstGo();'); const t1 = E.run('hDiffT');
  for (let i = 0; i < 30 && E.run('!!hBurst'); i++) E.step(1);
  ok(E.run('hDiffT') === t1, '回头连斩里不走');
  const F = makeEnv(); F.run('meta.runs = 0; HD.tut = true; HD.lives = 3;'); F.step(5); F.tap(195, 420); F.step(60);
  ok(F.run('hTutOn()') && F.run('hDiffT') === 0, '新手教程里不走');
  const G = makeEnv(); G.run('meta.runs = 5; HD.intro = true;'); G.step(5); G.tap(195, 420); G.step(30);
  ok(G.run('!!hIntro') && G.run('hDiffT') === 0, '开场里不走');
}

console.log('2) 黑潮越来越快（不超过 vMax）、越追越近；涌浪越来越勤');
{
  const E = go('HD.peakFrom = 1e9;', 'P.inv = 1e9;');
  E.run('hWave = 1; hWaveT = 100; hSurge = 0; hSurgeT = 1e9; hFront = wwrap(P.y + 300);');
  const vAt = h => { E.run('hDiffT = HD.heat0 + ' + h * 60 + '; hTickHorde(0);'); return E.run('hV'); };
  const u0 = vAt(0), u1 = vAt(1), u2 = vAt(2), u9 = vAt(9);
  ok(near(u1 - u0, E.run('HD.vHeat'), 0.01) && near(u2 - u0, 2 * E.run('HD.vHeat'), 0.01), '第 1 波：每档快 vHeat：' + u0 + ' → ' + u1 + ' → ' + u2);
  ok(near(u9, E.run('HD.vMax')), '难度 9：封在 vMax（' + u9 + '）');
  E.run('hWave = 20;');
  const v0 = vAt(0), v3 = vAt(3), v99 = vAt(99);
  ok(near(v0, E.run('HD.vMax')) && near(v3, v0) && near(v99, v0), '第 20 波：难度 0 / 3 / 99 都是 vMax（' + v0 + ' / ' + v3 + ' / ' + v99 + '），不再往上涨');
  E.run('hDiffT = 0;'); const g0 = E.run('hGapMax() - hBottomGap()');
  E.run('hDiffT = HD.heat0 + 60;'); const g1 = E.run('hGapMax() - hBottomGap()');
  E.run('hDiffT = HD.heat0 + 600;'); const g9 = E.run('hGapMax() - hBottomGap()');
  ok(near(g0, E.run('HD.offMax')) && g1 < g0 * 0.75 && near(g9, E.run('HD.offMax * HD.offMin')), '能把黑潮甩到屏幕外多远：' + g0 + ' → ' + g1.toFixed(0) + ' → 最少 ' + g9.toFixed(0));
  const gap = h => { E.run('hDiffT = HD.heat0 + ' + h * 60 + ';'); let s = 0; for (let i = 0; i < 200; i++) s += E.run('hSurgeGap()'); return s / 200; };
  const s0 = gap(0), s2 = gap(2);
  ok(s0 > 9 && s0 < 11 && s2 < s0 / 1.6, '涌浪平均隔多久：' + s0.toFixed(1) + ' 秒 → 难度 2：' + s2.toFixed(1) + ' 秒');
  E.run('hDiffT = HD.heat0 + 60; hSurge = 2; hSurgeP = 0; hWaveT = 100; hTickHorde(0);'); const k1 = E.run('hV');
  E.run('hSurge = 0; hTickHorde(0);'); const b1 = E.run('hV');
  E.run('hDiffT = HD.heat0 + 6000; hSurge = 2; hSurgeP = 0; hTickHorde(0);'); const k9 = E.run('hV');
  E.run('hSurge = 0; hTickHorde(0);'); const b9 = E.run('hV');
  const vt = E.run('HD.vTop');
  ok(near(k1, Math.min(vt, b1 * E.run('HD.surgeK')), 0.01) && near(k9, k1) && k9 <= vt, '猛涌（第 20 波 ' + b1 + '）：难度 1 冲到 ' + k1 + '，难度 100 还是 ' + k9 + '（不涨，不超过 vTop ' + vt + '）');
  E.run('hWave = 1; hDiffT = 0; hSurge = 2; hSurgeP = 0; hTickHorde(0);'); const k0 = E.run('hV');
  E.run('hSurge = 0; hTickHorde(0);'); const b0 = E.run('hV');
  ok(near(k0 / b0, E.run('HD.surgeK'), 0.01), '第 1 波：照旧冲 ' + (k0 / b0).toFixed(2) + ' 倍（' + b0 + ' → ' + k0 + '）');
  ok(E.run('HD.surgeTell') === 1.2, '预警照旧 1.2 秒');
}

console.log('2b) 潮头漫过你：一刀带的那点无敌挡不住（用户截图："我死的时候，这玩意都跑屏幕多少了"）');
{
  // 站住不动、清场，潮头摆到身后 gap，无敌 inv、一闪一闪 hurt 秒；走一帧看掉没掉命
  const hit = (gap, inv, hurt) => {
    const E = go('HD.peakFrom = 1e9; HD.autoRun = false;', 'enemies.length = 0; hNext = 1e9; hPathLive = false; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.vHeat = 0; HD.catchK = 0;');
    E.run('P.vx = 0; P.vy = 0; hFront = wwrap(P.y + ' + gap + '); P.inv = ' + inv + '; hHurtT = ' + hurt + ';');
    E.step(1);
    return E.run('hLives') < 3 || E.run('state') !== 'play';
  };
  ok(hit(-40, 0.2, 0), '潮头已经漫过你、只剩一刀带的 0.2 秒无敌：被追上（掉一命）');
  ok(!hit(-40, 1.2, 1.2), '掉命后一闪一闪的那段：照旧挡得住');
  ok(!hit(-40, 1e9, 0), '长的无敌（测试里的 / 教完那一秒）：照旧挡得住');
  ok(!hit(30, 0.2, 0), '潮头还在身后、只是前排扑上来碰到：一刀带的无敌照旧挡');
}

console.log('3) 潮峰：紧一阵松一阵');
{
  const E = go('', 'P.inv = 1e9;');
  const F = E.run('HD.peakFrom'), V = E.run('HD.peakEvery'), L = E.run('HD.peakLen');
  const at = t => { E.run('hDiffT = ' + t + ';'); return E.run('hPeak()'); };
  ok(!at(F - 1) && !at(F + V - L - 0.1) && at(F + V - L) && at(F + V - 0.1) && !at(F + V) && at(F + 2 * V - L + 1), '第 ' + (F + V - L) + '~' + (F + V) + ' 秒、之后每 ' + V + ' 秒一次，每次 ' + L + ' 秒');
  E.run('hDiffT = ' + (F + V - L - 0.01) + '; hWaveT = 100; hSurge = 0; hSurgeT = 7; hPeakWas = false; hTickHorde(0);');
  ok(!E.run('hPeakWas'), '潮峰前一刻');
  E.run('hDiffT = ' + (F + V - L + 0.01) + '; hTickHorde(0);');
  ok(E.run('hPeakWas') && E.run('hSurgeT') <= 0.3, '一进潮峰：涌浪马上来', E.run('hSurgeT'));
  ok(near(E.run('hHeat()'), (F + V - L + 0.01 - E.run('HD.heat0')) / 60 + E.run('HD.peakK'), 1e-6), '潮峰里难度再加 peakK');
  ok(near(E.run('hSurgeGap()'), E.run('HD.peakSurgeGap')), '涌浪一个接一个（隔 ' + E.run('HD.peakSurgeGap') + ' 秒）');
  E.run('hDiffT = ' + (F + V + 0.01) + '; hSurge = 2; hTickHorde(0);');
  ok(!E.run('hPeakWas') && E.run('hWaveT') === 0 && E.run('hSurge') === 0, '冲过潮峰：黑潮先慢下来（喘口气），不涌');
  // 真跑一段：潮峰里涌浪比平时多
  const G = go('', 'P.inv = 1e9;');
  G.run('hDiffT = ' + (F + V - L) + '; hWaveT = 100; hSurge = 0; hSurgeT = 0.2;');
  let n = 0, was = 0;
  for (let i = 0; i < L * 60; i++) { G.step(1); const s = G.run('hSurge'); if (s === 2 && was !== 2) n++; was = s; }
  ok(n >= 2, '潮峰 ' + L + ' 秒里涌了 ' + n + ' 次（平时 8~12 秒一次）');
}

console.log('4) 连斩越来越难攒、放完喘口气越来越短；掉一命喘口气');
{
  const E = go('HD.peakFrom = 1e9;', 'P.inv = 1e9;');
  E.run('hDiffT = 0; hRage = 0; hAddRage(3);');
  ok(E.run('hRage') === 3, '难度 0：斩一只 +3（跟以前一样）');
  E.run('hDiffT = HD.heat0 + 60; hRage = 0; hAddRage(3);');
  ok(near(E.run('hRage'), 3 / (1 + E.run('HD.rageHeat'))), '难度 1：+' + E.run('hRage').toFixed(2));
  E.run('hDiffT = 0;'); const c0 = E.run('hCalm()');
  E.run('hDiffT = HD.heat0 + 120;'); const c2 = E.run('hCalm()');
  E.run('hDiffT = HD.heat0 + 6000;'); const c9 = E.run('hCalm()');
  ok(c0 === E.run('HD.calm') && c2 < c0 && near(c9, E.run('HD.calm * HD.calmMin')), '放完连斩黑潮慢慢涌几秒：' + c0 + ' → ' + c2.toFixed(2) + ' → 最少 ' + c9.toFixed(2));
  E.run('P.inv = 0; hDiffT = HD.heat0 + 100; hWaveT = 100; hFront = wwrap(P.y + 10);');
  const d0 = E.run('hDiffT'), l0 = E.run('hLives');
  E.step(3);
  ok(E.run('hLives') === l0 - 1, '被黑潮追上：掉一命', E.run('hLives'));
  ok(near(E.run('hDiffT'), d0 - E.run('HD.hitEase'), 0.2), '难度退回 ' + E.run('HD.hitEase') + ' 秒前', d0 + ' → ' + E.run('hDiffT'));
  ok(E.run('hWaveT') < 0 && E.run('hSurge') === 0, '黑潮慢慢涌 ' + E.run('HD.hitCalm') + ' 秒、不涌浪', E.run('hWaveT'));
  E.run('P.inv = 0; hDiffT = 10; hLoseLife("测试");');
  ok(E.run('hDiffT') === 10, '还在前 ' + E.run('HD.heat0') + ' 秒：不往回退');
  // 掉了一命：黑潮不会一两秒就又追上（以前推回屏幕下沿就接着全速追，后面几档两秒连掉两命）。光往上跑、一刀不斩也撑得过喘口气那几秒
  const run2 = calm => {
    const G = go('HD.peakFrom = 1e9; HD.hitCalm = ' + calm + '; HD.hitEase = ' + (calm ? 12 : 0) + ';', 'enemies.length = 0; hNext = 1e9; hPathLive = false; hPath.length = 0;');
    G.run('hDiffT = HD.heat0 + 150; hWaveT = 100; P.inv = 0; hFront = wwrap(P.y + 5);');
    G.step(2);
    const lA = G.run('hLives'); let f = 0;
    for (; f < 900 && G.run('hLives') === lA && G.run('state') === 'play'; f++) { G.step(1); G.run('enemies.length = 0;'); }
    return f / 60;
  };
  const tNo = run2(0), tYes = run2(E.run('HD.hitCalm'));
  ok(tYes >= E.run('HD.hitCalm') && tYes > tNo + 1, '难度 2.5、掉一命以后光往上跑：撑了 ' + tYes.toFixed(1) + ' 秒才再被追上（不喘口气只撑 ' + tNo.toFixed(1) + ' 秒）');
}

console.log('5) 队形越来越难');
{
  const E = go('HD.peakFrom = 1e9;', 'P.inv = 1e9;');
  const kinds = t => { E.run('hDiffT = ' + t + '; hPathK = ""; var _KS = {}; for (var i = 0; i < 60; i++) { hPathQ.length = 0; hPathX = hX0; hPathForm(); _KS[hPathQ[0].k] = 1; }'); return Object.keys(E.run('_KS')).sort().join(','); };
  ok(kinds(0) === 'arc,line', '开头只有斜线、弧（一直点同一边）：' + kinds(0));
  ok(kinds(E.run('HD.zigAt')) === 'arc,line,zig', '第 ' + E.run('HD.zigAt') + ' 秒起有之字：' + kinds(E.run('HD.zigAt')));
  ok(kinds(E.run('HD.stairAt')) === 'arc,line,stair,zig', '第 ' + E.run('HD.stairAt') + ' 秒起有台阶：' + kinds(E.run('HD.stairAt')));
  const len = t => { E.run('hDiffT = ' + t + '; var _NS = 0; for (var i = 0; i < 300; i++) { hPathQ.length = 0; hPathX = hX0; hPathK = "line"; hPathForm(); _NS += hPathQ.length; }'); return E.run('_NS') / 300; };
  const n0 = len(100), n2 = len(E.run('HD.heat0') + 120 + 100);
  ok(n2 > n0 + 1, '越往后队形越长：平均 ' + n0.toFixed(1) + ' 步 → ' + n2.toFixed(1) + ' 步');
  // 特别的怪
  const spec = (t, top) => {
    E.run('hDiffT = ' + t + '; hTop = ' + (top || 200) + ' * HD.m; enemies.length = 0; hPathStart(); var _SK = {}, _SEQ = []; var _kd = function (n) { var k = n.bomb ? "bomb" : n.charger ? "charger" : n.heavy ? "heavy" : "grunt"; _SK[k] = (_SK[k] || 0) + 1; _SEQ.push(k); }; hPath.forEach(_kd); for (var i = 0; i < 400; i++) { hPathStep(); _kd(hPath[hPath.length - 1]); if (enemies.length > 40) { enemies.length = 0; hPath.length = 0; hPathMid.length = 0; } }');
    return { k: E.run('_SK'), seq: E.run('_SEQ') };
  };
  const a = spec(30);
  ok(Object.keys(a.k).join() === 'grunt', '难度 0：路上只有小怪', JSON.stringify(a.k));
  const b = spec(E.run('HD.heat0') + 180);
  const total = b.seq.length, sp = total - (b.k.grunt || 0);
  let consec = false; for (let i = 1; i < b.seq.length; i++) if (b.seq[i] !== 'grunt' && b.seq[i - 1] !== 'grunt') consec = true;
  ok(b.k.bomb > 0 && b.k.charger > 0 && b.k.heavy > 0 && sp / total > 0.15 && sp / total <= E.run('HD.specMax') + 0.05,
     '难度 3：路上夹着爆裂者 ' + b.k.bomb + ' / 冲锋者 ' + b.k.charger + ' / 重型 ' + b.k.heavy + '（共 ' + (sp / total * 100).toFixed(0) + '%）', JSON.stringify(b.k));
  ok(!consec && b.seq[0] === 'grunt' && b.seq[1] === 'grunt', '不连着放；路刚摆的头两步都是小怪', b.seq.slice(0, 12).join(' ') + ' … ' + (consec ? '有连着的' : ''));
  ok(E.run('hPathMid.every(function (m) { return !m.bomb && !m.charger && !m.heavy; })'), '中间站的那只还是小怪（斩过去顺手带走）');
  const c = spec(E.run('HD.heat0') + 6000);
  ok((c.seq.length - c.k.grunt) / c.seq.length <= E.run('HD.specMax') + 0.05, '再往后特别怪也最多 ' + E.run('HD.specMax * 100') + '% 左右（不全是）', JSON.stringify(c.k));
  const d = spec(E.run('HD.heat0') + 180, 10);
  ok(!d.k.bomb, '前 ' + E.run('HD.bombFromM') + ' 米不放爆裂者', JSON.stringify(d.k));
}

console.log('6) 能纠错的越来越少，最少一半（用户："越到后面 能够给玩家纠错的怪物会减少，但是有个底线"；选了"两种都算""留一半"）');
{
  const E = go('HD.peakFrom = 1e9;', 'P.inv = 1e9;');
  const at = (t, code) => { E.run('hDiffT = ' + t + ';'); return E.run(code); };
  const H0 = E.run('HD.heat0');
  ok(at(0, 'hFixK()') === 1 && at(H0, 'hFixK()') === 1 && at(H0 + 60, 'hFixK()') < 0.75 && at(H0 + 100, 'hFixK()') === 0.5 && at(H0 + 6000, 'hFixK()') === 0.5,
     '还剩几成：前 ' + H0 + ' 秒 1 → 再过一分钟 ' + at(H0 + 60, 'hFixK()').toFixed(2) + ' → 再过 100 秒（约 2 分半）到底 ' + at(H0 + 6000, 'hFixK()'));
  ok(at(0, 'hBlockMax()') === E.run('HD.blockMax') && at(H0 + 6000, 'hBlockMax()') === E.run('HD.blockMax'), '同屏名额不再越往后越多：一直 ' + E.run('HD.blockMax'));
  E.run('hWave = 20;');
  const avgGap = t => { let s = 0; for (let i = 0; i < 300; i++) s += at(t, 'hBlockGap()'); return s / 300; };
  const ga = avgGap(0), gb = avgGap(H0 + 60), gc = avgGap(H0 + 6000);
  ok(Math.abs(gb / ga - 1 / 0.7) < 0.1 && Math.abs(gc / ga - 2) < 0.12, '随机的一组组隔多远：' + ga.toFixed(0) + ' → ' + gb.toFixed(0) + ' → 最远 ' + gc.toFixed(0) + '（拉开一倍 = 稀到一半）');
  // 给路留的道不再越往后越窄：随机摆的照样离路 pathClear 以外（道窄了，本来要跳过的都摆得下，间隔拉开了随机的反而变多）
  const near0 = t => { E.run('hDiffT = ' + t + '; enemies.length = 0; hPathStart();'); return E.run('(function () { let n = 0, bad = 0; for (let r = 0; r < 60; r++) { for (let i = enemies.length - 1; i >= 0; i--) { const e = enemies[i]; if (e.pth) continue; n++; if (hPathNear(e.x, e.y, HD.pathClear - 1)) bad++; enemies.splice(i, 1); } hBlock(wwrap(P.y - 250 - r * 9)); } return [n, bad]; })()'); };
  const c0 = near0(0), c9 = near0(H0 + 6000);
  ok(c0[0] > 20 && c9[0] > 20 && c0[1] === 0 && c9[1] === 0, '给路留的道一直 ' + E.run('HD.pathClear') + '（摆了 ' + c0[0] + ' / ' + c9[0] + ' 只，没有一只离路更近）', JSON.stringify([c0, c9]));
  // 跟丢了多久才重摆：还在斜前方远处（压下来就够得着）等 fillWait ÷ hFixK()（0.45 → 0.9 秒）；横着够不着了马上重摆（HD.lostQuick）
  const lost = (t, side) => {
    const F = go('HD.peakFrom = 1e9;', 'P.inv = 1e9;');
    F.run('hDiffT = ' + t + '; var RER = 0; var _rr = hPathReroute; hPathReroute = function () { RER++; return _rr(); };');
    if (side) F.run('P.x = hX0 - 330; for (var i = 0; i < hPath.length; i++) { hPath[i].x = hX0 + 330; hPath[i].sp = 0; }');
    // 站着不动，路在斜前方一刀 + 90 开外（横着够得着）、不往下压：一直不进范围
    else F.run('HD.autoRun = false; P.vx = 0; P.vy = 0; for (var i = 0; i < hPath.length; i++) { hPath[i].x = P.x + 100; hPath[i].y = wwrap(P.y - 700 - 250 * i); hPath[i].sp = 0; }');
    let f = 0;
    while (F.run('RER') === 0 && f < 120) { F.step(1); f++; }
    return f * 0.0167;
  };
  const w0 = lost(0), w9 = lost(H0 + 6000);
  ok(Math.abs(w0 - 0.45) < 0.06 && Math.abs(w9 - 0.9) < 0.06, '路在斜前方远处：等多久才从身前重摆路：' + w0.toFixed(2) + ' 秒 → 越往后 ' + w9.toFixed(2) + ' 秒', w0 + ' / ' + w9);
  const q0 = lost(0, true), q9 = lost(H0 + 6000, true), lq = E.run('HD.lostQuick');
  ok(Math.abs(q0 - lq) < 0.06 && Math.abs(q9 - lq) < 0.06, '路横着够不着了（人在左边、路在右边）：不管多往后都 ' + q0.toFixed(2) + ' / ' + q9.toFixed(2) + ' 秒就重摆，不干等', q0 + ' / ' + q9);
  const share = t => { E.run('hDiffT = ' + t + '; hTop = 200 * HD.m; hWave = 20; var _KC = {}; var _sp = spawnEnemy; spawnEnemy = function (x, y, k) { _KC[k] = (_KC[k] || 0) + 1; return _sp(x, y, k); }; HD.pathMix = false; for (var i = 0; i < 400; i++) { enemies.length = 0; hBlock(P.y - 500); } HD.pathMix = true; spawnEnemy = _sp;'); const k = E.run('_KC'), n = Object.values(k).reduce((a, b) => a + b, 0); return (n - (k.grunt || 0)) / n; };
  const s0 = share(0), s4 = share(H0 + 240), s9 = share(H0 + 6000);
  // 一组里多半是小怪（一排只有一只挑种类、一串斜线全是小怪），所以整体比例涨得不多；挑种类的那一只从 44% 涨到 68%
  ok(s4 > s0 * 1.1 && Math.abs(s9 - s4) < 0.04, '重型 / 冲锋者 / 爆裂者占 ' + (s0 * 100).toFixed(0) + '% → ' + (s4 * 100).toFixed(0) + '%（到第 ' + E.run('HD.kindHeat') + ' 档封顶：' + (s9 * 100).toFixed(0) + '%）');
}

console.log('7) 前 heat0 秒跟以前一模一样（难度相关的都还是老值）');
{
  const E = go('', 'P.inv = 1e9;');
  E.run('hDiffT = HD.heat0 - 0.5; hWave = 3;');
  ok(E.run('hHeat()') === 0 && E.run('hBlockMax()') === E.run('HD.blockMax') && E.run('hCalm()') === E.run('HD.calm') &&
     near(E.run('hGapMax() - hBottomGap()'), E.run('HD.offMax')) && E.run('hFixK()') === 1,
     '名额、喘口气、甩开距离、能纠错的（随机的多稀、跟丢了多久重摆）：都是老值');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
