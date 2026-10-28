/* 技能系统测试（第二版：五项、每项三级、每一级都看得见）
   1) 零技能 = 默认手感
   2) 延锋：斩杀圈 / 冲刺 +15% / +30% / +50%，刀身变长，光跟着变大
   3) 续势：断连保留三成 / 五成 / 七成连斩，一直不砍就一截截往下掉；后两级窗口加长
   4) 光盾：挡一次死、推开身边的怪；1 级不再生，2 级 40 秒、3 级 20 秒再生且碎时放震波；炸弹也挡
   5) 聚光：每根晶柱 +10 / +20 / +35 余光；2 级长得更快，3 级场上多一根
   6) 剑气：连斩每 10 / 8 / 6 刀放一圈，杀圈里的怪、重型先裂甲；剑气杀的不再蓄力；断连清零
   7) 价格与买卖：每项三级、第一级不贵；满级不能再买；重置全额退回
   8) 旧存档：旧技能花掉的余光全额退回，只退一次
   9) 强化页：各种等级 / 锁定状态在 667 / 844 下都能画 */
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
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);

// 带着某些技能开一局：不刷常规怪、教学已完成，主角默认不无敌（要测光盾）
function runWith(lv, extra) {
  const E = makeEnv();
  E.step(5);
  E.run('meta.tut = TUT_DONE; meta.lv = ' + JSON.stringify(lv) + '; ' + (extra || '') +
        '; start(); spawnTimer = 1e6; CFG.spawnBase = 1e6; CFG.spawnMin = 1e6; waveTimer = 1e6; enemies.length = 0;');
  E.step(2);
  return E;
}
// 在主角身边 d 处放一只怪（type 可选）
const put = (E, d, type) => E.run('spawnEnemy(P.x + ' + d + ', P.y' + (type ? ", '" + type + "'" : '') + ')');

console.log('=== 1. 零技能 = 默认手感 ===');
{
  const E = runWith({});
  ok(E.run('POW.autoReach === CFG.autoReach && POW.dashSpeed === CFG.dashSpeed'), '斩杀圈、冲刺不变');
  ok(E.run('POW.comboWindow === CFG.comboWindow && POW.keep === 0'), '连击窗口不变、断连清零');
  ok(E.run('shield === 0 && POW.yingBonus === 0 && POW.qiEvery === 0'), '没盾、晶柱原价、没剑气');
  ok(E.run('crystals.length') === E.run('CFG.crystalN'), '晶柱数量不变');
}

console.log('\n=== 2. 延锋 ===');
[[1, 1.15], [2, 1.30], [3, 1.50]].forEach(([l, k]) => {
  const E = runWith({ reach: l });
  ok(near(E.run('POW.autoReach'), E.run('CFG.autoReach') * k, 0.01) && near(E.run('POW.dashSpeed'), E.run('CFG.dashSpeed') * k, 0.01),
    l + ' 级：斩杀圈 / 冲刺 ×' + k);
  ok(E.run('lightR()') === E.run('POW.autoReach'), l + ' 级：光跟着变大');
  if (l === 3) ok(E.run('POW.blade') > 1.25, '满级刀身明显变长', E.run('POW.blade'));
});

console.log('\n=== 3. 续势 ===');
{
  const E = runWith({ keep: 1 });
  E.run('combo = 20; comboTimer = 0.001; update(1 / 60);');
  ok(E.run('combo') === 6, '1 级：连斩 20 断了留下 6', E.run('combo'));
  ok(E.run('comboTimer') > 1, '留下的那截重新给一个窗口');
  ok(E.run("floats.some(f => f.text === '续势 ×6')"), '头顶报"续势"');
  E.run('for (let i = 0; i < 600; i++) update(1 / 60);');
  ok(E.run('combo') === 0, '一直不砍：一截截掉到 0', E.run('combo'));
  const F = runWith({ keep: 3 });
  ok(near(F.run('POW.comboWindow'), F.run('CFG.comboWindow') + 0.4), '3 级：连击窗口 +0.4 秒');
  F.run('combo = 20; comboTimer = 0.001; update(1 / 60);');
  ok(F.run('combo') === 14, '3 级：连斩 20 断了留下 14', F.run('combo'));
  ok(F.run('FB.tier') === F.run('tierOf(14)'), '段位跟着留下的连斩走');
  // 一直不砍：14 → 9 → 6 → 4 → 2 → 0，只在第一次报名字
  let again = false;
  for (let i = 0; i < 900; i++) {
    F.run('update(1 / 60);');
    if (F.run("floats.some(f => /^续势/.test(f.text) && f.text !== '续势 ×14')")) again = true;
  }
  ok(F.run('combo') === 0 && !again, '一截截往下掉到 0，路上不重复报"续势"');
  const G = runWith({});
  G.run('combo = 20; comboTimer = 0.001; update(1 / 60);');
  ok(G.run('combo') === 0, '没点续势：照旧清零');
}

console.log('\n=== 4. 光盾 ===');
{
  const E = runWith({ shield: 1 });
  ok(E.run('shield') === 1, '1 级：开局挂一面盾');
  put(E, 3); put(E, 60);
  E.run('P.inv = 0; update(1 / 60);');
  ok(E.run('state') === 'play', '被碰到不死');
  ok(E.run('shield') === 0 && E.run('P.inv') > 0.5, '盾碎了，给一段无敌');
  ok(E.run('enemies.every(e => wdist(e.x, e.y, P.x, P.y) >= 140)'), '身边的怪被推开一圈');
  ok(E.run("floats.some(f => f.text === '光盾碎了')"), '头顶报"光盾碎了"');
  E.run('for (let i = 0; i < 3000; i++) { P.inv = 1; lightL = 1; update(1 / 60); }');   // 光一直补满：这里只看光盾
  ok(E.run('shield') === 0, '1 级：这一局不再生');
  E.run('enemies.length = 0; P.inv = 0;'); put(E, 3);
  E.run('update(1 / 60);');
  ok(E.run('state') === 'dead', '盾没了，第二下照常死');

  const F = runWith({ shield: 2 });
  F.run('die();');
  ok(F.run('state') === 'play' && F.run('shieldT') === 40, '2 级：碎后 40 秒再生倒计时');
  F.run('for (let i = 0; i < 60 * 41; i++) { P.inv = 1; lightL = 1; update(1 / 60); }');
  ok(F.run('shield') === 1, '40 秒后长回来');

  const G = runWith({ shield: 3 });
  put(G, 100); put(G, 120); put(G, 400);
  G.run('die(); update(1 / 60);');
  ok(G.run('enemies.length') === 1, '3 级：碎时放震波，身边两只死了、远处那只还在', G.run('enemies.length'));
  ok(G.run('shieldT') > 19.9 && G.run('shieldT') <= 20, '3 级：20 秒再生');

  const H = runWith({ shield: 1 });
  H.run('P.inv = 0; blasts.push({ x: P.x, y: P.y, t: 0, fuse: 0.01, r: 96 }); update(1 / 60); update(1 / 60);');
  ok(H.run('state') === 'play' && H.run('shield') === 0, '爆裂者炸到脚下：盾也挡');
}

console.log('\n=== 5. 聚光 ===');
[[1, 35], [2, 45], [3, 60]].forEach(([l, v]) => {
  const E = runWith({ focus: l });
  const y0 = E.run('yingRun');
  E.run('shatterCrystal(0);');
  ok(E.run('yingRun') - y0 === v, l + ' 级：一根晶柱 ' + v + ' 余光', E.run('yingRun') - y0);
  if (l >= 2) ok(E.run('POW.crystalRe') < E.run('CFG.crystalRespawn'), l + ' 级：晶柱长得更快');
  if (l === 3) {
    const F = runWith({ focus: 3 });
    ok(F.run('crystals.length') === F.run('CFG.crystalN') + 1, '3 级：开局多一根晶柱');
  }
});

console.log('\n=== 6. 剑气 ===');
{
  const E = runWith({ qi: 1 }, 'meta.depthBest = 4');
  ok(E.run('POW.qiEvery') === 10 && E.run('POW.qiR') > 100, '1 级：每 10 刀、半径 ' + E.run('POW.qiR'));
  for (let i = 0; i < 9; i++) E.run('spawnEnemy(P.x + 2, P.y); killEnemy(enemies.length - 1);');
  ok(E.run('qiCharge') === 9, '砍了 9 刀：蓄力 9');
  put(E, 80); put(E, 110); put(E, 120, 'heavy'); put(E, 600);
  E.run('spawnEnemy(P.x + 2, P.y); killEnemy(enemies.length - 1); P.inv = 1; update(1 / 60);');
  ok(E.run('qiCharge') === 0, '第 10 刀：放出剑气、蓄力清零');
  ok(E.run('enemies.length') === 2, '圈里两只普通怪死了，重型和远处那只还在', E.run('enemies.length'));
  ok(E.run('enemies.some(e => e.heavy && e.cracked)'), '重型被剑气劈裂了甲');
  ok(E.run('qiCharge') === 0, '剑气自己杀的不蓄力（不会无限连放）');
  E.run('qiCharge = 5; combo = 8; comboTimer = 0.001; update(1 / 60);');
  ok(E.run('qiCharge') === 0, '断连：蓄力清零');
  const F = runWith({ qi: 3 }, 'meta.depthBest = 4');
  ok(F.run('POW.qiEvery') === 6 && F.run('POW.qiR') > E.run('POW.qiR'), '3 级：每 6 刀、范围更大');
}

console.log('\n=== 7. 价格与买卖 ===');
{
  const E = makeEnv();
  E.step(3);
  const S = E.run('SKILLS');
  ok(S.length === 5 && S.every(s => s.cost.length === 3 && s.eff.length === 3), '五项，每项三级、三句效果');
  ok(S.every(s => s.cost[0] <= 150 && s.cost[0] < s.cost[1] && s.cost[1] < s.cost[2]), '第一级都不贵（≤150），越往上越贵');
  // 按显示宽度算：汉字算 1，数字 / 符号算 0.55
  const wid = t => [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 1 : 0.55), 0);
  const widest = Math.max.apply(null, S.map(s => Math.max.apply(null, s.eff.map(wid))));
  ok(widest <= 14, '每句效果不超过 14 个汉字宽（卡片放得下）', widest.toFixed(1));
  E.run("meta.pts = 10000; meta.lv = {}; meta.depthBest = 0;");
  const sk = "SKILL_MAP.reach";
  ok(E.run('buySkill(' + sk + ')') === true && E.run("lvOf('reach')") === 1, '买到 1 级');
  E.run('buySkill(' + sk + '); buySkill(' + sk + ');');
  ok(E.run("lvOf('reach')") === 3 && E.run('nextCost(' + sk + ')') === -1, '买到满级后没有下一级');
  ok(E.run('buySkill(' + sk + ')') === false && E.run("lvOf('reach')") === 3, '满级不能再买');
  const spent = 10000 - E.run('meta.pts');
  ok(spent === S[0].cost.reduce((a, b) => a + b, 0), '一共花了 ' + spent);
  E.run('resetSkills();');
  ok(E.run('meta.pts') === 10000 && E.run("lvOf('reach')") === 0, '重置全额退回');
}

console.log('\n=== 8. 旧存档：旧技能全额退款 ===');
{
  const old = JSON.stringify({ pts: 50, runs: 5, kills: 200, lv: { reach: 2, window: 1, haste: 1 }, unlocked: {}, tut: 5, tutV: 2 });
  const E = makeEnv(844, { dash_meta_v1: old });
  ok(E.run('meta.pts') === 50 + 100 + 300 + 100 + 150, '退回 650（旧价格），余额 700', E.run('meta.pts'));
  ok(E.run('Object.keys(meta.lv).length') === 0, '旧等级清空');
  ok(E.run('meta.refund') === 650, '记下退了多少，强化页报一次', E.run('meta.refund'));
  E.run('saveMeta();');
  const F = makeEnv(844, { dash_meta_v1: E.storage['dash_meta_v1'] });
  ok(F.run('meta.pts') === 700, '再读一次不会重复退', F.run('meta.pts'));
  F.run('openSkills(); backFromSkills();');
  ok(F.run('meta.refund') === 0, '看过强化页之后不再提');
  const neu = JSON.stringify({ pts: 0, lv: { reach: 2, qi: 1 }, skillV: 2, tut: 5, tutV: 2 });
  const G = makeEnv(844, { dash_meta_v1: neu });
  ok(G.run("lvOf('reach')") === 2 && G.run("lvOf('qi')") === 1 && G.run('meta.refund') === 0, '新版存档原样读回');
}

console.log('\n=== 9. 强化页 ===');
[667, 844].forEach(h => {
  const E = makeEnv(h);
  let err = null;
  try {
    E.step(5);
    const states = [
      'meta.pts = 0; meta.lv = {}; meta.depthBest = 0;',
      'meta.pts = 500; meta.lv = { reach: 1, keep: 2 }; meta.depthBest = 2; meta.refund = 300;',
      'meta.pts = 9999; meta.lv = { reach: 3, keep: 3, shield: 3, focus: 3, qi: 3 }; meta.depthBest = 9; meta.refund = 0;'
    ];
    for (const st of states) {
      E.run(st + ' openSkills();');
      E.step(10);
      E.run('buySkill(SKILL_MAP.shield);');
      E.step(20);
      E.run('backFromSkills();');
    }
  } catch (e) { err = e.message; }
  ok(!err, h + 'px：没学 / 学了一半 / 满级、锁着 / 解锁，各画一遍无异常', err);
  ok(E.bad.length === 0, h + 'px：没有画在 NaN 上', E.bad.slice(0, 5).join(','));
});

console.log('\n=== 10. 局内画面 ===');
{
  const E = runWith({ shield: 2, qi: 2, keep: 1 }, 'meta.depthBest = 4');
  let err = null;
  try {
    E.run('P.inv = 1e6;');
    for (let i = 0; i < 5; i++) E.run('spawnEnemy(P.x + 2, P.y); killEnemy(enemies.length - 1);');
    E.step(20);                       // 挂着盾、剑气蓄了一半
    E.run('die();'); E.step(30);      // 盾碎、再生倒计时
    E.run('combo = 9; comboTimer = 0.001;'); E.step(20);   // 续势
  } catch (e) { err = e.message; }
  ok(!err, '光盾 / 剑气蓄力 / 续势 在场上连续画无异常', err);
  ok(E.bad.length === 0, '没有画在 NaN 上', E.bad.slice(0, 5).join(','));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
