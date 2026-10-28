/* 任务和嘉豪等级 · 糖升级道具（2.15 节）测试 —— 玩家反馈"感觉玩着没什么目标，也没什么进度积累，游戏过程更是单一"，
   用户定了照跑酷的做法（每局挂三个任务，做完三个升一级；糖升级道具）
   1) 发任务：三个不重样、都在任务表里，目标跟着等级涨、不超过上限
   2) 进度：斩爆裂者 / 劈开重型 / 趁蓄力斩冲锋者 / 涌浪里斩 / 跑多远 / 一条命不掉 / 捡糖 / 连斩 / 道具；开场、回头连斩扫到的不算刀砍的
   3) 做完一个马上给糖、弹卡；三个都做完结算时升一级、换一批，新的一批这一局（复活接着跑）不算
   4) 等级加成：捡的糖结算时多给；复活后再结算不重复给
   5) 存档：存进去读得回来；坏数据（不认识的任务、等级越界）读进来修好
   6) 糖升级道具：扣糖、升级、道具管得更久、写着几秒的字跟着变；不够 / 满级说清楚
   7) 画得出来：主界面、暂停、失败页（升级那一页）、商店「道具升级」页 */
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
  return { run, step, tap, tapRect, tapDash, ops, storage, texts };
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

// 开一局黑潮（主界面点任意处）：挡路的清掉、黑潮停在屏幕外不动
function fresh(seed, pre) {
  const E = makeEnv(seed);
  E.run('meta.runs = 5;' + (pre || '')); E.step(5);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9;');
  E.run('hCandy = []; hCandyNext = 1e12; hItem = null; hPropNext = 1e12;');   // 路上的糖、道具不出（别顺手把任务做了）
  return E;
}
// 挂上指定的三个任务（这一局就算）
function setQ(E, list) {
  E.run('meta.hq.q = ' + JSON.stringify(list.map(function (x) { return { id: x[0], n: x[1], d: x[2] || 0, b: 0, t0: -99 }; })) + ';');
}
// 身前摆一只、直接斩死（killEnemy 走的是刀砍那条路）
function killKind(E, kind, extra) {
  E.run('{ const e = spawnEnemy(P.x, wwrap(P.y - 200), "' + kind + '"); ' + (extra || '') + ' killEnemy(enemies.indexOf(e)); }');
}
const Q = (E, i) => E.run('JSON.stringify(meta.hq.q[' + i + '])');

console.log('1) 发任务');
{
  const E = makeEnv();
  ok(E.run('meta.hq.lv') === 1 && E.run('meta.hq.q.length') === 3, '新存档：嘉豪 Lv.1，挂着三个任务');
  let distinct = true, inTable = true, need1 = true;
  for (let r = 0; r < 40; r++) {
    E.run('meta.hq.q = []; hqDeal();');
    const ids = E.run('meta.hq.q.map(function (q) { return q.id; }).join(",")').split(',');
    if (new Set(ids).size !== 3) distinct = false;
    if (!ids.every(id => E.run('!!H_QUEST["' + id + '"]'))) inTable = false;
    if (!E.run('meta.hq.q.every(function (q) { return q.n === hqNeed(H_QUEST[q.id], 1); })')) need1 = false;
  }
  ok(distinct && inTable && need1, '发 40 批：每批三种不重样、都在任务表里、目标是 Lv.1 的');
  E.run('meta.hq.q = [{ id: "dist" }, { id: "bomb" }, { id: "candy" }]; hqDeal();');
  ok(E.run('meta.hq.q.every(function (q) { return ["dist", "bomb", "candy"].indexOf(q.id) < 0; })'), '换一批：跟上一批不重样');
  ok(E.run('H_QUESTS.every(function (Q) { return hqNeed(Q, 10) > hqNeed(Q, 1) && hqNeed(Q, 1000) <= Q.t[2]; })'),
    '目标跟着等级涨（Lv.10 都比 Lv.1 多），再高也不超过上限：' + E.run('H_QUESTS.map(function (Q) { return Q.id + " " + hqNeed(Q, 1) + "→" + hqNeed(Q, 10); }).join("，")'));
}

console.log('2) 进度');
{
  const E = fresh();
  setQ(E, [['bomb', 2], ['heavy', 1], ['charge', 2]]);
  killKind(E, 'bomb');
  ok(E.run('hqRun.bomb') === 1 && E.run('hqCur(meta.hq.q[0])') === 1, '斩一只爆裂者：1 / 2', Q(E, 0));
  killKind(E, 'grunt');
  ok(E.run('hqRun.foe') === 2 && E.run('hqCur(meta.hq.q[0])') === 1, '斩小怪：只算"斩怪"，不算爆裂者');
  E.run('{ const e = spawnEnemy(P.x, wwrap(P.y - 200), "heavy"); crackEnemy(e); }');
  ok(E.run('meta.hq.q[1].id') !== 'heavy' && E.run('hqRunDone.length') === 1 && E.run('hqRunDone[0].id') === 'heavy', '劈开一只重型（砍开外壳就算）：做完，这一格马上换了个新的（' + E.run('meta.hq.q[1].id') + '）');
  killKind(E, 'charger');
  ok(E.run('hqCur(meta.hq.q[2])') === 0, '冲锋者没在蓄力：不算');
  killKind(E, 'charger', 'e.mode = "wind";');
  ok(E.run('hqCur(meta.hq.q[2])') === 1, '趁蓄力斩掉：1 / 2', Q(E, 2));
  // 回头连斩扫到的：只算斩怪
  E.run('{ const e = spawnEnemy(P.x, wwrap(P.y - 200), "bomb"); hClearFoe(enemies.indexOf(e)); }');
  ok(E.run('hqRun.bomb') === 1 && E.run('hqRun.foe') === 5, '回头连斩扫到的爆裂者：只算斩怪，不算"斩爆裂者"');
  // 开场里斩的一律不算
  E.run('hIntro = { t: 0 };'); killKind(E, 'bomb'); E.run('hIntro = null;');
  ok(E.run('hqRun.bomb') === 1 && E.run('hqRun.foe') === 5, '开场里斩的不算');
  // 涌浪里斩
  setQ(E, [['surge', 2], ['candy', 3], ['prop', 1]]);
  E.run('hSurge = 2;'); killKind(E, 'grunt'); E.run('hSurge = 1;'); killKind(E, 'grunt'); E.run('hSurge = 0;');
  ok(E.run('hqCur(meta.hq.q[0])') === 1, '涌浪猛涌的时候斩的才算（憋着的时候不算）', Q(E, 0));
  E.run('hEatCandy(P.x, P.y); hEatCandy(P.x, P.y);');
  ok(E.run('hqCur(meta.hq.q[1])') === 2, '捡糖：2 / 3', Q(E, 1));
  E.run('hUseProp("ruler", P.x, P.y);');
  ok(E.run('meta.hq.q[2].id') !== 'prop', '用一个道具：做完、换新的');
  // 跑多远、一条命不掉、累计跑
  const E2 = fresh();
  setQ(E2, [['dist', 40], ['nohit', 60], ['far', 200, 70]]);
  E2.run('HD.autoRun = true;');
  let f = 0;
  while (E2.run('Math.floor(hTop / HD.m)') < 45 && f < 2000) { E2.step(1); f++; }
  ok(E2.run('meta.hq.q[0].id') !== 'dist' && E2.run('hqCur(meta.hq.q[1])') >= 44 && E2.run('meta.hq.q[2].d') >= 113, '往上跑 45 米：跑 40 米那个做完换掉了、一条命不掉也在涨、累计跑从 70 接着涨',
    [Q(E2, 0), Q(E2, 1), Q(E2, 2)].join(' '));
  E2.run('HD.lives = 3; hLives = 3; P.inv = 0; hLoseLife("测试"); P.inv = 1e9;');
  ok(E2.run('hqCur(meta.hq.q[1])') === 0, '掉了一条命：一条命不掉的从 0 重新算');
  f = 0;
  while (E2.run('Math.floor(hTop / HD.m)') < 55 && f < 2000) { E2.step(1); f++; }
  const nh = E2.run('hqCur(meta.hq.q[1])');
  ok(nh >= 8 && nh <= 12, '再跑 10 米：一条命不掉 ' + nh + ' 米（从掉命那儿算）');
}

console.log('3) 轮着来（用户："游戏内的任务是轮动的，就是完成一个直接下一个，让玩家一直有目标？然后单次奖励减少"）');
{
  const E = fresh(null, 'meta.hq.lv = 1; meta.hq.k = 0; meta.bx.n = 0;');
  setQ(E, [['bomb', 1], ['burst', 1], ['candy', 1]]);
  const c0 = E.run('meta.candy'), r = E.run('hqReward()');
  ok(r === 10 && E.run('(function () { meta.hq.lv = 5; var x = hqReward(); meta.hq.lv = 1; return x; })()') === 30, '一个给的糖减半：Lv.1 10 颗（以前 20）、Lv.5 30 颗（以前 60）');
  killKind(E, 'bomb');
  ok(E.run('meta.candy') === c0 + r && E.run('hqGot') === r && !E.run('hqPop') && E.run('hqFlash && hqFlash.i === 0 && hqFlash.s === "斩打碟嘉豪"'), '做完一个：马上给 ' + r + ' 颗糖；不弹大卡，任务框那一行闪"✓ 斩打碟嘉豪 +' + r + ' 糖"');
  E.texts.length = 0; E.step(2);
  ok(E.texts.indexOf('✓ 斩打碟嘉豪') >= 0 && E.texts.indexOf('+' + r + ' 糖') >= 0, '任务框里画着"✓ 斩打碟嘉豪 +' + r + ' 糖"');
  const n0 = E.run('meta.hq.q[0]');
  ok(n0.id !== 'bomb' && n0.id !== 'burst' && n0.id !== 'candy' && n0.d === 0 && E.run('meta.hq.k') === 1, '这一格马上补一个新的（' + n0.id + '），跟另外两格、刚做完的都不重样；离升级 1 / 3');
  ok(E.run('meta.hq.q.length') === 3, '一直挂着三个');
  E.run('hqFlash.at -= 1600;'); E.texts.length = 0; E.step(30);     // 小框最多 0.4 秒重画一次
  ok(E.texts.indexOf('✓ 斩打碟嘉豪') < 0 && E.texts.indexOf(E.run('H_QUEST[meta.hq.q[0].id].s')) >= 0, '闪 1.5 秒以后露出新补的那个');
  E.run('hRage = 100; hBurstGo();');
  ok(E.run('meta.hq.k') === 2 && E.run('meta.hq.lv') === 1, '做完第二个：2 / 3');
  E.run('hEatCandy(P.x, P.y);');
  ok(E.run('meta.hq.lv') === 2 && E.run('meta.hq.k') === 0 && E.run('meta.bx.n') === 1 && E.run('hqPop && hqPop.up && hqPop.up.lv === 2 && hqPop.up.box === 1'), '做完第三个：局里当场升到 Lv.2、送 1 个宝箱，弹大卡写着');
  E.step(Math.ceil(E.run('HQ.popT') * 60) + 40);   // 斩中那一下有顿帧，多走一点
  ok(!E.run('hqPop'), '卡挂 ' + E.run('HQ.popT') + ' 秒就收');
  ok(E.run('hqUp.lv === 2 && hqUp.box === 1 && hqUp.q.length === 3'), '宝箱页要报的（升到几级、送几个、最近做完的三个）记下了');
  // 新补的一局任务：从补上那一刻算
  setQ(E, [['dist', 30], ['foe', 9999], ['far', 99999]]);
  E.run('hqRun.dist = 100;');
  E.run('meta.hq.q[0] = { id: "dist", n: 30, d: 0, b: hqBase("dist"), t0: gameTime };');
  ok(E.run('hqCur(meta.hq.q[0])') === 0, '跑到 100 米时补上的"跑 30 米"：从 0 算（不是一补上就做完）');
  E.run('hqSet("dist", 125);');
  ok(E.run('hqCur(meta.hq.q[0])') === 25, '跑到 125 米：25 / 30');
  E.run('hqSet("dist", 131);');
  ok(E.run('meta.hq.q[0].id') !== 'dist', '跑到 131 米：做完换掉');
  // 下一局：一局的任务从 0 算
  E.run('meta.hq.q[0] = { id: "bomb", n: 3, d: 0, b: 5, t0: 0 };');
  E.run('state = "dead"; startHorde(); enemies.length = 0; P.inv = 1e9;');
  ok(E.run('meta.hq.q[0].b') === 0, '新开一局：一局的任务起点归零');
}

console.log('4) 升级送宝箱（以前是"每级糖多 10%"，用户定了升级改给宝箱，2.16 节）');
{
  const E = fresh(null, 'meta.hq.lv = 3; meta.hq.k = 2; meta.bx.n = 0;');
  ok(E.run('hqCandyK()') === 1 && E.run('HQ.candyLv') === 0, '糖不再按等级加成');
  setQ(E, [['bomb', 1], ['burst', 9], ['candy', 9]]);
  E.run('hCandyRun = 50; meta.candy = 0;');
  killKind(E, 'bomb');
  ok(E.run('meta.hq.lv') === 4 && E.run('meta.bx.n') === 1, '离升级差 1 个，做完：升到 Lv.4、送 1 个宝箱');
  E.run('P.inv = 0; hLives = 1; HD.lives = 1;'); E.run('die("测试");');
  ok(E.run('meta.candy') === 50 + 20 && E.run('hqUp.box') === 1, '结算：捡的 50 颗糖照给（不加成）+ 任务 20 颗（Lv.3 做完的）');
  const F = fresh(null, 'meta.hq.lv = 4; meta.hq.k = 2; meta.bx.n = 2;');
  setQ(F, [['bomb', 1], ['burst', 9], ['candy', 9]]);
  killKind(F, 'bomb');
  ok(F.run('meta.hq.lv') === 5 && F.run('meta.bx.n') === 12 && F.run('hqUp.box') === 10, '升到 Lv.5（每 5 级）：送 10 个宝箱（原来有 2 个，一共 12）');
}

console.log('5) 存档');
{
  const E = fresh();
  setQ(E, [['bomb', 3, 2], ['dist', 900], ['far', 5000, 1234]]);
  E.run('meta.hq.lv = 7; meta.pu.ghost = 3; saveMeta();');
  const saved = JSON.parse(E.storage.dash_meta_v1);
  const F = makeEnv(saved);
  ok(F.run('meta.hq.lv') === 7 && F.run('meta.hq.q.map(function (q) { return q.id + q.n + "/" + q.d; }).join(",")') === 'bomb3/2,dist900/0,far5000/1234' && F.run('meta.pu.ghost') === 3,
    '存进去读得回来：Lv.7、三个任务和进度、鬼火 3 级');
  const G = makeEnv({ hq: { lv: 99, q: [{ id: 'nope', n: 5 }, { id: 'bomb', n: 'x' }] }, pu: { ruler: 9, ghost: -2, wat: 4 } });
  ok(G.run('meta.hq.lv') === G.run('HQ.maxLv') && G.run('meta.hq.q.length') === 3 && G.run('meta.hq.q.every(function (q) { return !!H_QUEST[q.id] && q.n >= 1; })'),
    '坏数据：等级越界夹回 ' + G.run('HQ.maxLv') + '，不认识的任务换成一批新的');
  ok(G.run('meta.pu.ruler') === 9 && G.run('meta.pu.ghost') === 0 && G.run('meta.pu.wat') === undefined, '道具等级：9 级照读（软上限，不封顶），负数夹回 0，不认识的道具不读');
  const L = makeEnv({ hq: { lv: 2, q: [{ id: 'bomb', n: 2, d: 2, ok: 1 }, { id: 'dist', n: 500, d: 30 }, { id: 'far', n: 2000, d: 100 }] } });
  ok(L.run('meta.hq.q[0].id') !== 'bomb' && L.run('meta.hq.k') === 1 && L.run('meta.hq.q[1].id') === 'dist', '以前的存档里做完了还挂着的：算进升级进度（1 / 3），换成新的');
  const H = makeEnv({ candy: 10 });
  ok(H.run('meta.hq.lv') === 1 && H.run('meta.hq.q.length') === 3 && H.run('meta.pu.ruler') === 0, '老存档（没有任务、道具等级）：Lv.1、发一批新的、道具 0 级');
}

console.log('6) 糖升级道具');
{
  const E = fresh(null, 'meta.candy = 250;');
  ok(E.run('hPropT("ruler")') === 10 && E.run('PROP_DESC.ruler').indexOf('10 秒') >= 0, '没升级：黑板尺 10 秒');
  ok(E.run('propUpBuy("ruler")').indexOf('11 秒') >= 0 && E.run('meta.candy') === 150 && E.run('meta.pu.ruler') === 1, '花 100 颗升到 1 级：11 秒');
  ok(E.run('PROP_DESC.ruler').indexOf('11 秒') >= 0, '写着几秒的字跟着变：「' + E.run('PROP_DESC.ruler') + '」');
  E.run('hUseProp("ruler", P.x, P.y);');
  ok(E.run('hProp.T') === 11 && E.run('hProp.t') === 11, '拿到黑板尺：管 11 秒');
  ok(E.run('propUpBuy("ruler")').indexOf('还差 50') === 0 && E.run('meta.pu.ruler') === 1, '糖不够：说还差几颗，不升');
  E.run('meta.candy = 99999;');
  for (let i = 0; i < 5; i++) E.run('propUpBuy("magnet")');
  ok(E.run('meta.pu.magnet') === 5 && E.run('hPropT("magnet")') === 20, '吸铁石升到 5 级：20 秒（前 5 级每级 +2 秒）');
  // 软上限（用户："玩家升级道具有上限，能不能改成软上限？"）：还能升，越往后加得越少、越贵
  ok(E.run('propUpCost("magnet")') === 1100 && E.run('propUpBuy("magnet")').indexOf('21 秒') >= 0, '还能升：第 6 级 1100 颗，只多 1 秒（21 秒）');
  for (let i = 0; i < 5; i++) E.run('propUpBuy("magnet")');
  ok(E.run('meta.pu.magnet') === 11 && E.run('hPropT("magnet")') === 25.5, '升到 11 级：6~10 级每级 +1、第 11 级 +0.5 → 25.5 秒', E.run('hPropT("magnet")'));
  ok(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return 50 + 25 * n * (n + 1); })) === JSON.stringify([100, 200, 350, 550, 800, 1100, 1450, 1850]) && E.run('propUpCost("ruler")') === 200,
    '价格：100 / 200 / 350 / 550 / 800（跟以前一样）/ 1100 / 1450 / 1850 …');
  ok(E.run('PROP_DESC.magnet').indexOf('25.5 秒') >= 0, '写着几秒的字带小数：「' + E.run('PROP_DESC.magnet') + '」');
  E.run('meta.candy = 0; meta.hs.own = {}; meta.bx.n = 0;');
  ok(!E.run('shopCanBuy()'), '没糖、没宝箱：主界面商店入口不挂"可买"');
  E.run('meta.candy = 100;');
  ok(E.run('shopCanBuy()'), '够升一级道具：挂"可买"');
}

console.log('6b) 局里也看得到任务（用户："玩家现在局内看不到任务……"；后来："能不能把连斩的数据和做任务放在左下方"）');
{
  const E = fresh();
  setQ(E, [['bomb', 2], ['far', 3000, 1200], ['candy', 1]]);
  killKind(E, 'bomb');
  E.run('hEatCandy(P.x, P.y);');      // 一局捡糖 1 个：做完，换一个新的
  const nid = E.run('meta.hq.q[2].id'), ns = E.run('H_QUEST["' + nid + '"].s');
  E.run('hqFlash.at -= 1600;');        // "✓ 一局捡糖"闪完了
  E.texts.length = 0; E.step(30);
  ok(E.texts.indexOf('斩打碟嘉豪') >= 0 && E.texts.indexOf('1/2') >= 0 && E.texts.indexOf('累计跑') >= 0 && E.texts.indexOf('1200/3000 米') >= 0 && E.texts.indexOf(ns) >= 0 && E.texts.indexOf('新') >= 0,
    '小框：斩打碟嘉豪 1/2、累计跑 1200/3000 米、刚补上的「' + ns + '」挂着"新"', JSON.stringify(E.texts.filter(t => /\d+\/\d+/.test(t))));
  const B = E.run('hQuestBox()'), D = E.run('DASH_BTN'), pb = E.run('hPropBtn()'), cb = E.run('hComboAt()');
  ok(B.x < 20 && B.y > E.run('H_CSS * 0.45') && B.y + B.h <= D.y - D.r - 8 && pb.x > E.run('W_CSS / 2'), '任务框在左下角、左斩键正上方，不压着它（道具键在右边）');
  ok(cb.x === B.x + B.w / 2 && cb.y < B.y && cb.y > E.run('H_CSS * 0.35'), '连斩数在任务框上面（也在左下半边）');
  E.texts.length = 0; E.step(30);
  ok(E.texts.indexOf('斩打碟嘉豪') < 0, '进度没变：不重画（贴图）');
  E.run('hTut = 0;'); E.texts.length = 0; E.run('drawQuestHud();');
  ok(E.texts.indexOf('斩打碟嘉豪') < 0 && E.run('hTutOn()'), '新手教程里不画（那时也不算）');
}

console.log('7) 画得出来');
{
  const E = fresh(null, 'meta.hq.lv = 3; meta.candy = 500;');
  setQ(E, [['bomb', 2, 1], ['dist', 500], ['far', 3000, 1200]]);
  E.run('meta.hq.k = 1;');
  E.texts.length = 0; E.run('pauseGame();'); E.step(2);
  ok(E.run('state') === 'pause' && E.texts.indexOf('体育生 Lv.3') >= 0 && E.texts.indexOf(E.run('H_QUEST.bomb.txt(2)')) >= 0 && E.texts.indexOf('最好 1 / 2') >= 0 && E.texts.indexOf('再做 2 个升级送宝箱') >= 0,
    '暂停：体育生 Lv.3、三个任务、"最好 1 / 2"、"再做 2 个升级送宝箱"');
  E.run('resumeGame();');
  E.run('meta.hq.k = 0; for (var i = 0; i < 3; i++) hqComplete(0);');      // 做完三个：升到 Lv.4
  E.run('P.inv = 0; hLives = 1; HD.lives = 1;'); E.run('die("黑潮");');
  E.step(60); E.tapRect(E.run('hordeEndBtns().skip')); E.step(20);     // 复活页「不用了」→ 宝箱页（升级送了宝箱）
  E.texts.length = 0; E.step(2);
  ok(E.run('hEnd') === 'box' && E.texts.indexOf('升级！体育生 Lv.4') >= 0 && E.texts.indexOf(E.run('hqText(hqUp.q[2])')) >= 0 && E.texts.indexOf('拿到 1 个宝箱') >= 0,
    '宝箱页：「拿到 1 个宝箱」+「升级！体育生 Lv.4」+ 最近做完的三个');
  ok(E.texts.some(function (t) { return t.indexOf('送 1 个宝箱') >= 0; }), '写着升级送了几个宝箱');
  E.run('toReady();'); E.texts.length = 0; E.step(3);
  ok(E.run('state') === 'ready' && E.texts.indexOf('体育生 Lv.4') >= 0 && E.texts.indexOf('商') >= 0 && E.texts.indexOf('店') >= 0, '主界面：任务卡（Lv.4）、左上角入口叫"商店"');
  E.run('openShop();'); E.step(1);
  E.tapRect(E.run('shopLayout().tabs.prop')); E.texts.length = 0; E.step(2);
  ok(E.run('shopTab') === 'prop' && E.texts.indexOf('黑板尺') >= 0 && E.texts.indexOf('吸铁石') >= 0 && E.texts.indexOf('100 糖') >= 0, '商店点「道具升级」：四个道具、价格');
  const c0 = E.run('meta.candy');
  E.tapRect(E.run('shopLayout().props[1].buy')); E.step(1);
  ok(E.run('meta.pu.stink') === 1 && E.run('meta.candy') === c0 - 100 && E.run('shopMsg').indexOf('臭水') === 0, '点臭水那一行的价格：升到 1 级（' + E.run('shopMsg') + '）');
  E.tapRect(E.run('shopLayout().tabs.skin')); E.step(1);
  ok(E.run('shopTab') === 'skin', '点「皮肤」回皮肤那一页');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
