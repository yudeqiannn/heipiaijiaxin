/* 越打越爽：段位 / 连斩入账 / 刃阶 / 正反馈
   1) 连斩跨过门槛升段：头顶炸段名、刀环换段位色，同一段里不重复报
   2) 连斩分先挂着，断了才飞进总分；HUD 分数最后和真分数对上
   3) 死在连斩中途：没飞完的分直接入账，历史最高连斩记进存档
   4) 碎柱：余光光点飞到 HUD 才加数，最后等于本局余光
   5) 新纪录：分数滚过最高分报一次，之后不再报
   6) 一刀多杀：同一瞬间砍穿两只报"双斩"，第三只把同一行字改成"三斩"
   7) 刃阶：门槛递增；300 / 1000 两阶顺带解锁断水 / 白刃；封顶后进度满
   8) 复活：连斩折半后段位悄悄落回去，不再放一次升段
   9) 最近的强化目标：价格最低的那一项，锁着的不算
   10) 各界面在 667 / 844 两种屏高下连续渲染：不抛错、不画 NaN、不碰 shadowBlur
   11b) 斩完不冻帧：打击的顿帧是短暂慢放，死亡照冻
   11c) 越连越燃：场地染色 / 升段爆发 / 火星 / 击杀特效 / 快断滴答 / 险！ */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(h, init) {
  const H = h || 844;
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000, raf = null;
  const ac = {
    get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  // 记下所有带坐标的调用：坐标里出现 NaN / Infinity 就是 UI 数学写错了
  const bad = [];
  let shadow = false;
  const finite = (name, args) => { for (const a of args) if (typeof a === 'number' && !isFinite(a)) { bad.push(name); break; } };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...a) => { finite(k, a); return { addColorStop() {} }; };
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (['arc', 'fillText', 'strokeText', 'fillRect', 'moveTo', 'lineTo', 'arcTo', 'translate', 'scale', 'quadraticCurveTo'].indexOf(k) >= 0) {
        return (...a) => finite(k, a);
      }
      return t[k] !== undefined ? t[k] : function () {};
    },
    set(t, k, v) {
      if (k === 'shadowBlur' && v) shadow = true;
      if (k === 'globalAlpha' && !isFinite(v)) bad.push('globalAlpha');
      t[k] = v; return true;
    }
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const storage = Object.assign({}, init || {});   // init：带着这份存档启动
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: H, safeArea: { top: 44, bottom: H - 34 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
    vibrateShort() {}, vibrateLong() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    performance: { now: () => simT },
    requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
    navigator: { userAgent: 'headless' }
  };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) break; simT += 16.7; cb(simT); } }
  return { run, step, storage, bad, shadow: () => shadow };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

// 开一局：主角无敌、不刷怪，只看我们自己砍的那几刀
function freshRun(E, pre) {
  E.step(5);
  E.run((pre || '') + '; meta.tut = 3; start(); P.inv = 1e6; spawnTimer = 1e6; CFG.spawnBase = 1e6; CFG.spawnMin = 1e6; waveTimer = 1e6;');
  E.step(2);
}
// 在主角脚下放一只怪并砍掉
const KILL = 'spawnEnemy(P.x + 5, P.y); killEnemy(enemies.length - 1);';

console.log('=== 1. 升段 ===');
{
  const E = makeEnv();
  freshRun(E);
  const T = E.run('COMBO_TIERS');
  let inc = true;
  for (let i = 1; i < T.length; i++) if (!(T[i].at > T[i - 1].at)) inc = false;
  ok(inc && T[0].at >= 3, '段位门槛从小到大', T.map(t => t.at).join(','));
  ok(new Set(T.map(t => t.name)).size === T.length, '段名不重复');

  E.run('combo = 3;' + KILL);
  ok(E.run('FB.tier') === -1, '连斩 4：还没到第一段');
  E.run(KILL);
  ok(E.run('FB.tier') === 0, '连斩 5：升到「' + T[0].name + '」', E.run('FB.tier'));
  ok(E.run(`floats.some(f => f.pop && f.text === '${T[0].name}')`), '头顶炸出段名');
  ok(E.run(`rings.some(r => r.color === '${T[0].c}' && r.r1 > 150)`), '主角身边荡开一圈段位色的大环');
  const n0 = E.run(`floats.filter(f => f.text === '${T[0].name}').length`);
  E.run(KILL + KILL);
  ok(E.run(`floats.filter(f => f.text === '${T[0].name}').length`) === n0, '同一段里再砍不重复报段名');
  ok(E.run(`rings[rings.length - 1].color`) === T[0].c, '普通怪的刀环换成段位色', E.run('rings[rings.length - 1].color'));
  E.run('combo = ' + (T[1].at - 1) + ';' + KILL);
  ok(E.run('FB.tier') === 1, '跨过第二道坎升到「' + T[1].name + '」');
}

console.log('\n=== 2. 连斩入账 ===');
{
  const E = makeEnv();
  freshRun(E);
  for (let i = 0; i < 8; i++) E.run(KILL);
  const chain = E.run('FB.chain'), sc = E.run('score');
  ok(chain > 0 && E.run('FB.pend') === chain, '这一串的击杀分挂在连斩下面（' + chain + '）');
  E.step(10);
  ok(Math.abs(E.run('FB.score') - (E.run('score') - E.run('FB.pend'))) < 1, 'HUD 分数 = 真分数 - 没入账的连斩分', E.run('FB.score') + ' / ' + E.run('score'));
  ok(E.run('FB.score') < sc, '连斩没断，HUD 分数先不算这一串');
  E.run('comboTimer = 0.001;');
  E.step(1);
  ok(E.run('combo') === 0 && E.run('FB.chain') === 0, '连斩断了，这一串清零');
  ok(E.run(`flyers.some(f => f.kind === 'score' && f.v === ${chain})`), '整串分化成一个飞向总分的"入账"');
  E.step(80);
  ok(E.run('FB.pend') === 0 && E.run('flyers.length') === 0, '飞到之后不再挂账');
  ok(Math.abs(E.run('FB.score') - E.run('score')) < 1, 'HUD 分数最后和真分数对上', E.run('FB.score') + ' / ' + E.run('score'));
}

console.log('\n=== 3. 死在连斩中途 ===');
{
  const E = makeEnv();
  freshRun(E, 'meta.comboBest = 4');
  for (let i = 0; i < 12; i++) E.run(KILL);
  E.run('die();');
  ok(E.run('FB.pend') === 0 && E.run('FB.score') === E.run('score'), '没飞完的连斩分直接入账');
  ok(E.run('meta.comboBest') === 12, '历史最高连斩更新为 12', E.run('meta.comboBest'));
  const saved = JSON.parse(E.storage['dash_meta_v1'] || '{}');
  ok(saved.comboBest === 12, '最高连斩写进了存档', saved.comboBest);
  const E2 = makeEnv(844, { dash_meta_v1: E.storage['dash_meta_v1'] });
  ok(E2.run('meta.comboBest') === 12, '重开游戏后从存档读回最高连斩', E2.run('meta.comboBest'));
  ok(makeEnv().run('meta.comboBest') === 0, '新存档的最高连斩从 0 开始');
}

console.log('\n=== 4. 余光光点 ===');
{
  const E = makeEnv();
  freshRun(E);
  E.run('shatterCrystal(0);');
  ok(E.run(`flyers.some(f => f.kind === 'ying')`), '碎柱放出一颗飞向 HUD 的光点');
  ok(E.run('FB.ying') === 0, '光点还没落地，HUD 余光不加');
  E.step(60);
  ok(E.run('FB.ying') === E.run('yingRun') && E.run('yingRun') > 0, '落地后 HUD 余光 = 本局余光（' + E.run('yingRun') + '）');
}

console.log('\n=== 5. 新纪录 ===');
{
  const E = makeEnv();
  freshRun(E, 'best = 50');
  ok(E.run('FB.best0') === 50, '开局记下了之前的最高分');
  E.run('score += 200;');
  E.step(40);
  ok(E.run('FB.record') === true, '分数滚过最高分，报新纪录');
  ok(E.run(`banners.filter(b => b.text === '新纪录').length`) === 1, '横幅只有一条');
  E.run('score += 500;');
  E.step(40);
  ok(E.run(`banners.filter(b => b.text === '新纪录').length`) <= 1, '再涨也不重复报');
  const F = makeEnv();
  freshRun(F, 'best = 0');
  F.run('score += 200;');
  F.step(40);
  ok(F.run('FB.record') === false, '第一局（没有最高分）不报新纪录');
}

console.log('\n=== 6. 一刀多杀 ===');
{
  const E = makeEnv();
  freshRun(E);
  E.run(KILL);
  ok(!E.run(`floats.some(f => f.text === '双斩')`), '单杀不报');
  E.step(30);
  E.run(KILL + KILL);
  ok(E.run(`floats.some(f => f.pop && f.text === '双斩')`), '同一瞬间砍穿两只：双斩');
  E.run(KILL);
  ok(E.run(`floats.some(f => f.text === '三斩')`) && !E.run(`floats.some(f => f.text === '双斩')`), '第三只把同一行字改成三斩');
  E.run(KILL + KILL);
  ok(E.run(`floats.some(f => f.text === '群斩 ×5')`), '再多就是群斩 ×N');
}

console.log('\n=== 7. 刃阶 ===');
{
  const E = makeEnv();
  const R = E.run('RANKS');
  let inc = R[0].at === 0;
  for (let i = 1; i < R.length; i++) if (!(R[i].at > R[i - 1].at)) inc = false;
  ok(inc, '门槛从 0 开始递增');
  ok(E.run('rankOf(0).name') === R[0].name && E.run('rankOf(0).p') === 0, '0 斩：第一阶，进度 0');
  ok(E.run('rankOf(299).next.at') === 300 && E.run('rankUnlock(rankOf(299).next).id') === 'blade', '299 斩：下一阶在 300，顺带解锁断水');
  ok(E.run('rankOf(999).next.at') === 1000 && E.run('rankUnlock(rankOf(999).next).id') === 'white', '999 斩：下一阶在 1000，顺带解锁白刃');
  ok(E.run('rankOf(300).i') === E.run('rankOf(299).i') + 1, '300 斩正好升一阶');
  ok(E.run('rankOf(1e7).next') === null && E.run('rankOf(1e7).p') === 1, '封顶后没有下一阶，进度满');
  ok(E.run('rankUnlock(rankOf(10).next)') === null, '其他阶不挂里程碑');
}

console.log('\n=== 8. 复活 ===');
{
  const E = makeEnv();
  freshRun(E);
  E.run('combo = 22;' + KILL);
  ok(E.run('FB.tier') === E.run('tierOf(23)'), '连斩 23 的段位');
  E.run('die(); doRevive();');
  ok(E.run('combo') === 11 && E.run('FB.tier') === E.run('tierOf(11)'), '复活后连斩折半，段位落回 ×11 那一段');
  const tierPops = "floats.filter(f => f.pop && COMBO_TIERS.some(t => t.name === f.text)).length";
  E.step(20);
  const pops = E.run(tierPops);
  E.run(KILL);
  ok(E.run(tierPops) === pops, '下一刀不会重新报一次已经到过的段');
}

console.log('\n=== 9. 最近的强化目标 ===');
{
  const E = makeEnv();
  E.run('meta.pts = 0; meta.lv = {}; meta.depthBest = 0;');
  const cheapest = E.run('Math.min.apply(null, SKILLS.filter(s => !s.gate).map(s => s.cost[0]))');
  ok(E.run('nextSkillGoal().cost') === cheapest, '全没点过：目标是最便宜的第一级（' + cheapest + '）');
  ok(E.run('canUpgrade()') === false, '0 余光：不能升级');
  E.run('meta.pts = ' + cheapest + ';');
  ok(E.run('canUpgrade()') === true, '攒够就能升级');
  E.run("meta.lv = { reach: 3, keep: 3, shield: 3, focus: 3 };");
  ok(E.run('nextSkillGoal()') === null, '四项满级、第五项锁着：没有可升的');
  E.run('meta.depthBest = QI_GATE;');
  ok(E.run('nextSkillGoal().sk.id') === 'qi', '解锁后第五项成为目标');
}

console.log('\n=== 11. 主角颜色跟着段位走，断了回原色 ===');
{
  const E = makeEnv();
  freshRun(E);
  ok(E.run('heroColor()') === E.run('THEME.player'), '开局是原色');
  E.run('combo = 4;' + KILL);
  E.step(30);
  ok(E.run('heroColor()') === E.run('tierColor(0)'), '连斩到第一段：变成段位色', E.run('heroColor()'));
  E.run('combo = 9;' + KILL);
  E.step(2);
  ok(E.run('heroColor()') !== E.run('tierColor(1)'), '升段时不是一下跳过去（有过渡）');
  E.step(30);
  ok(E.run('heroColor()') === E.run('tierColor(1)'), '过渡完是新段位色');
  ok(E.run('FB.heat') > 0.99, '段位里热度满格', E.run('FB.heat'));
  E.run('comboTimer = 0.001;');
  E.step(1);
  ok(E.run('combo') === 0 && E.run('FB.heat') > 0.9, '连斩断的那一帧：热度不掉档（脚下的光不会一下暗掉）', E.run('FB.heat'));
  E.step(12);
  const h12 = E.run('FB.heat');
  ok(h12 > 0.2 && h12 < 0.8, '0.2 秒后：热度在半路，是慢慢褪的', h12);
  E.step(90);
  ok(E.run('combo') === 0 && E.run('heroColor()') === E.run('THEME.player'), '连斩断了：回到原色', E.run('heroColor()'));
  ok(E.run('FB.heat') < 0.01, '热度也褪干净了', E.run('FB.heat'));
}

console.log('\n=== 11b. 斩完不冻帧：顿帧是短暂慢放，世界一直在动 ===');
{
  const E = makeEnv();
  freshRun(E);
  E.step(40);                                                     // 离上一次打击够远，这一刀会顿
  E.run(KILL);
  const t0 = E.run('gameTime');
  E.step(1);
  const d1 = E.run('gameTime') - t0;
  ok(d1 > 0, '斩完下一帧：局内时间还在走（不冻帧）', d1);
  ok(d1 < 0.0167 * 0.5, '但走得慢：这一下是慢放', d1.toFixed(4));
  E.step(10);
  const t1 = E.run('gameTime'); E.step(1);
  ok(Math.abs(E.run('gameTime') - t1 - 0.0167) < 1e-6, '慢放很短，之后恢复正常速度');
  E.run('P.inv = 0; shield = 0; die();');
  const t2 = E.run('gameTime'); E.step(2);
  ok(E.run('gameTime') === t2 && E.run('hitstop') > 0, '死亡那一下照旧冻住');
}

console.log('\n=== 11c. 越连越燃：场地染色 / 升段爆发 / 火星 / 击杀特效 / 快断滴答 / 险！ ===');
{
  const E = makeEnv();
  freshRun(E);
  E.run('S.__ticks = 0; S.__tiers = []; S.__tk = S.tick; S.__tu = S.tierUp;' +
        'S.tick = function (u) { S.__ticks++; return S.__tk(u); }; S.tierUp = function (t) { S.__tiers.push(t); return S.__tu(t); };');
  E.step(10);
  ok(E.run('BGT.a') === 0 && E.run('embers.length') === 0, '没段位：场地不染色、身上没火星');
  const parts0 = (function () { E.run('parts.length = 0;' + KILL); return E.run('parts.length'); })();

  // 升段：光框、逐段升调的音、场地慢慢染上段位色
  E.run('combo = 4;' + KILL);
  ok(E.run('FB.tier') === 0 && E.run('FB.flash') === 1 && E.run('S.__tiers.join()') === '0', '升到第一段：屏幕四周亮光框，放第 0 段的升段音');
  E.step(1);
  const a1 = E.run('BGT.a');
  ok(a1 > 0 && a1 < E.run('bgtTarget()'), '场地染色是慢慢染上去的，不是一帧到位', a1);
  E.step(40);
  ok(Math.abs(E.run('BGT.a') - E.run('bgtTarget()')) < 0.005 && E.run('FB.flash') === 0, '0.7 秒后染到位，光框已退掉');
  ok(E.run('embers.length') > 3, '有段位：身上冒火星（' + E.run('embers.length') + '）');
  E.run('combo = 99;' + KILL);
  ok(E.run('S.__tiers.join()') === '0,6' && E.run('BGT.a') < E.run('bgtTarget()'), '跳到最高段：放第 6 段的升段音，染色往更浓走');
  E.step(60);
  ok(E.run('embers.length') <= 80, '火星有上限（' + E.run('embers.length') + ' ≤ 80）');

  // 击杀特效随段位升级
  E.run('parts.length = 0;' + KILL);
  const partsHi = E.run('parts.length');
  ok(partsHi > parts0, '高段位一刀的碎屑比没段位多（' + partsHi + ' > ' + parts0 + '）');
  ok(E.run('cuts[cuts.length - 1].w') > 1.5, '高段位斩线更粗');
  E.run('for (let i = 0; i < 40; i++) {' + KILL + '}');
  ok(E.run('parts.length') <= 360, '碎屑总数封顶 360（' + E.run('parts.length') + '）');

  // 快断滴答：窗口剩最后四成才响，越到最后越密
  // 窗口 1.4 秒：前 0.8 秒（剩 0.6 秒以上）不响；再走 0.5 秒（剩约 0.1 秒）至少响 3 声
  E.run('S.__ticks = 0; comboTimer = POW.comboWindow;');
  E.step(48);
  const early = E.run('S.__ticks');
  E.step(30);
  const late = E.run('S.__ticks');
  ok(E.run('combo') > 0 && early === 0 && late >= 3, '前六成不响，最后四成滴答（' + late + ' 声）', early + ' / ' + late);

  // 险！：最后关头续上多给半刀分；窗口还早时砍不算
  const clutch = function (timer) {
    return E.run('(function () { combo = 8; comboTimer = ' + timer + '; const e = spawnEnemy(P.x + 5, P.y);' +
      'const n0 = floats.filter(f => f.text === "险！").length;' +
      'const base = e.score * Math.min(combo + 1, CFG.scoreCap), s0 = score; killEnemy(enemies.indexOf(e));' +
      'return [score - s0, base, floats.filter(f => f.text === "险！").length > n0]; })()');
  };
  const c1 = clutch('0.2'), c2 = clutch('1.2');
  ok(c1[0] === c1[1] + Math.round(c1[1] * 0.5) && c1[2], '剩 0.2 秒续上：弹「险！」，这一刀多给半刀分（' + c1[0] + ' = ' + c1[1] + ' × 1.5）');
  ok(c2[0] === c2[1] && !c2[2], '窗口还早：照常给分，不弹「险！」');

  // 断连：染色和火星都慢慢退，不是一帧消失
  E.run('comboTimer = 0.001;');
  E.step(1);
  const af = E.run('BGT.a');
  ok(E.run('combo') === 0 && af > E.run('0.12 + 0.03 * 6') * 0.8, '断连那一帧：场地染色还在（慢慢退，不闪）', af);
  E.step(90);
  ok(E.run('BGT.a') < 0.01, '1.5 秒后染色退干净');
  E.step(60);
  ok(E.run('embers.length') === 0, '火星也熄了');
}

console.log('\n=== 11d. 场地染色时怪跟着提亮，认怪的色系不变 ===');
{
  const E = makeEnv();
  freshRun(E);
  const col = t => E.run('foeColor({ ' + (t === 'grunt' ? '' : t + ': true') + ' })');
  const lum = h => { const n = parseInt(h.slice(1), 16); return 0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255); };
  const hue = h => { const n = parseInt(h.slice(1), 16); return E.run('hueOf(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ')'); };
  E.step(5);
  ok(['grunt', 'bomb', 'charger'].every(t => col(t) === E.run('THEME.foe.' + t)), '没段位：五种怪都是原色');
  E.run('combo = 99;' + KILL); E.step(60);
  const dh = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const types = ['grunt', 'heavy', 'bomb', 'charger', 'watch'];
  ok(types.every(t => lum(col(t)) > lum(E.run('THEME.foe.' + t)) + 10), '最高段：五种怪都提亮了');
  ok(types.every(t => dh(hue(col(t)), hue(E.run('THEME.foe.' + t))) < 8), '色系不变（色相差 < 8°），红还是红、蓝还是蓝');
  // 破晓的场地是深蓝紫：蓝色的冲锋者和场地撞色，要比不撞色的爆裂者提得更多
  const lift = t => (lum(col(t)) - lum(E.run('THEME.foe.' + t))) / (255 - lum(E.run('THEME.foe.' + t)));
  ok(lift('charger') > lift('bomb') + 0.1, '和场地撞色的那种多提一截（冲锋者 ' + lift('charger').toFixed(2) + ' > 爆裂者 ' + lift('bomb').toFixed(2) + '）');
  E.run('comboTimer = 0.001;'); E.step(120);
  ok(col('charger') === E.run('THEME.foe.charger'), '断连、染色退干净后回到原色');
}

console.log('\n=== 12. 五种怪五个颜色 ===');
{
  const E = makeEnv();
  const foe = E.run('THEME.foe');
  const hue = h => {
    const n = parseInt(h.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let x = mx === r ? ((g - b) / d) % 6 : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
    return (x * 60 + 360) % 360;
  };
  const ks = Object.keys(foe);
  ok(ks.length === 5 && new Set(ks.map(k => foe[k])).size === 5, '五种怪五个颜色');
  let worst = 360, pair = '';
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    let d = Math.abs(hue(foe[ks[i]]) - hue(foe[ks[j]]));
    d = Math.min(d, 360 - d);
    if (d < worst) { worst = d; pair = ks[i] + '/' + ks[j]; }
  }
  ok(worst >= 25, '任意两种的色相至少差 25°（最近的是 ' + pair + '：' + worst.toFixed(0) + '°）');
  ok(E.run("foeColor({ bomb: true }) === THEME.foe.bomb && foeColor({}) === THEME.foe.grunt"), 'foeColor 按种类取色');
}

console.log('\n=== 10. 各界面连续渲染 ===');
[667, 844].forEach(h => {
  const E = makeEnv(h);
  let err = null;
  try {
    E.run('meta.runs = 3; meta.kills = 290; best = 300;');
    E.step(30);                                                    // 主界面
    E.run('meta.runs = 0;'); E.step(10);                           // 新玩家主界面
    freshRun(E);
    E.run('contract = CONTRACTS[0];');
    for (let i = 0; i < 26; i++) E.run(KILL);                      // 升到第三段，带辉光
    E.run('shatterCrystal(0); score += 900;'); E.step(20);         // 光点 / 横幅 / 进层
    E.run('comboTimer = 0.001;'); E.step(30);                      // 连斩入账
    E.run('layer = 6; onEnterLayer(6);'); E.step(30);
    E.run('meta.kills = 320; die();'); E.step(60);                 // 死亡页
    E.run('finishRun();');
    for (let i = 0; i < 12; i++) E.step(15);                       // 结算页整段动画
    E.run('openSkills(); meta.pts = 999;'); E.step(20);            // 强化页
    E.run('backFromSkills(); toReady();'); E.step(10);
  } catch (e) { err = e.message; }
  ok(!err, h + 'px：主界面 → 游戏 → 死亡 → 结算 → 强化 → 主界面 全程无异常', err);
  ok(E.bad.length === 0, h + 'px：没有任何一笔画在 NaN / Infinity 上', E.bad.slice(0, 5).join(','));
  ok(!E.shadow(), h + 'px：shadowBlur 从未被设为非 0');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
