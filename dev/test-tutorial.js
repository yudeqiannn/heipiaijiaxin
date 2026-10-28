/* 新手教学测试
   目标：第一次玩点「开始」直接进教学局（玩法说明只从主界面按钮进），开局按
   「拖动 → 轻点斩 → 按住连斩 → 边拖边斩 → 捡糖补光 → 碎晶柱 → 跟着糖走到门」七步走，
   动作驱动、每步有兜底时间；教的东西必须马上做得到（身边送怪 / 送柱子）；
   每人只自动出现一次：第一局一开局就记为看过，不管走没走完，以后都不再自动出现；
   主界面「新手教程」可以再来一遍；教学内容换版后老存档重教一次。
   另外：教学期间刷怪放慢、不合围；新敌人头两次出场弹提示卡；结算页 / 强化页的引导只出现一次。 */
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
  const bad = [];
  let shadow = false;
  const finite = (name, args) => { for (const a of args) if (typeof a === 'number' && !isFinite(a)) { bad.push(name); break; } };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...a) => { finite(k, a); return { addColorStop() {} }; };
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (['arc', 'fillText', 'strokeText', 'fillRect', 'moveTo', 'lineTo', 'arcTo', 'translate', 'scale', 'rotate'].indexOf(k) >= 0) {
        return (...a) => finite(k, a);
      }
      return t[k] !== undefined ? t[k] : function () {};
    },
    set(t, k, v) { if (k === 'shadowBlur' && v) shadow = true; t[k] = v; return true; }
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const storage = Object.assign({}, init || {});
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
    tt, console, setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {},   // 返回非 0：BGM 靠计时器 id 判断"在放"
    performance: { now: () => simT },
    requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
    navigator: { userAgent: 'headless' }
  };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext("CFG.mainMode = 'classic';", sb);   // 这里测的是正式玩法的主界面（主玩法现在是黑潮）
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) break; simT += 16.7; cb(simT); } }
  // 只推进教学（不跑整局 update），dt 秒 × n 次
  const tick = (n, dt) => run('for (let i = 0; i < ' + n + '; i++) tickTutorial(' + (dt || 1 / 60) + ');');
  return { run, step, tick, storage, bad, shadow: () => shadow };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

// 新存档开一局，停在第一步；不刷常规怪，只看教学自己放的
function fresh(E) {
  E.step(10);
  E.run('start(); P.inv = 1e6; spawnTimer = 1e6; CFG.spawnBase = 1e6; CFG.spawnMin = 1e6;');
  E.step(3);
}
const key = E => E.run('tutStep < TUT_DONE ? TUT_STEPS[tutStep].key : "done"');
// 拖动：给一个方向输入，再把人挪过去
const drag = (E, d) => E.run('tMove.x = 1; P.x += ' + d + '; tickTutorial(1 / 60); tMove.x = 0;');
// 一路走到第 n 步（用每一步的"做到了"条件，不靠兜底时间）
function reach(E, target) {
  for (let g = 0; g < 10 && key(E) !== target; g++) {
    const k = key(E);
    if (k === 'move') { drag(E, 120); drag(E, 120); }
    else if (k === 'tap') E.run('runKills += 1; tickTutorial(1 / 60);');
    else if (k === 'hold') E.run('attackHeld = true; tickTutorial(1 / 60); runKills += 3; tickTutorial(1 / 60); attackHeld = false;');
    else if (k === 'candy') E.run('runCandy += 1; tickTutorial(1 / 60);');
    else if (k === 'aim') E.run('tMove.x = 1; tickTutorial(1 / 60); runKills += 2; tickTutorial(1 / 60); tMove.x = 0;');
    else if (k === 'crystal') E.run('crystalsBroken += 1; tickTutorial(1 / 60);');
    else if (k === 'gate') E.run('layer += 1; tickTutorial(1 / 60);');
  }
}

console.log('=== 1. 新存档：开局从「拖动」开始 ===');
{
  const E = makeEnv();
  ok(E.run('meta.tut') === 0 && E.run('meta.tutV') === E.run('TUT_VER'), '还没看过，教学版本记成当前版');
  fresh(E);
  ok(E.run('meta.tut') === E.run('TUT_DONE'), '一开局就记为看过（这一局照样教）');
  ok(JSON.parse(E.storage['dash_meta_v1']).tut === E.run('TUT_DONE'), '而且立刻写进存档，杀进程也不会再来');
  E.step(20);
  ok(key(E) === 'move', '停在「拖动」', key(E));
  ok(E.run('tutText()').indexOf('拖动') === 0, '标题讲拖动', E.run('tutText()'));
  ok(E.run('tutA') > 0.3, '卡片已经淡入', E.run('tutA').toFixed(2));
  ok(E.run('TUT_DONE') === 7, '一共七步');
}

console.log('\n=== 2. 拖动：只认手指在拖，读秒不赶人（但有兜底） ===');
{
  const E = makeEnv();
  fresh(E);
  E.tick(540);
  ok(key(E) === 'move', '站着不动 9 秒还在拖动这一步');
  E.run('P.x += 300; tickTutorial(1 / 60);');
  ok(key(E) === 'move', '没有拖动输入时被冲刺带出去的位移不算');
  drag(E, 120); drag(E, 120);
  ok(key(E) === 'tap', '拖够 200 进「轻点斩」', key(E));
  ok(E.run('tutA') < 0.4, '换步后卡片从头淡入');
  const F = makeEnv();
  fresh(F);
  F.tick(130, 0.1);
  ok(key(F) === 'tap', '一直不拖：' + F.run('TUT_STEPS[0].limit') + ' 秒兜底翻到下一步', key(F));
}

console.log('\n=== 3. 轻点斩：身边一定有怪，砍中才算 ===');
{
  const E = makeEnv();
  fresh(E);
  reach(E, 'tap');
  E.run('enemies.length = 0;');
  E.tick(90);
  ok(E.run('tutNearCount(320)') >= 1, '身边空着 1.5 秒：送一只怪过来', E.run('enemies.length'));
  E.run('tutDashed = 3; tickTutorial(1 / 60);');
  ok(key(E) === 'tap', '只按、没砍中：不翻页');
  E.run('runKills += 1; tickTutorial(1 / 60);');
  ok(key(E) === 'hold', '砍中一只：进「按住连斩」', key(E));
}

console.log('\n=== 4. 按住连斩：送一小群怪，按住期间连砍三只才算 ===');
{
  const E = makeEnv();
  fresh(E);
  E.run('enemies.length = 0;');
  reach(E, 'hold');
  ok(E.run('tutNearCount(260)') >= 3, '一进这一步就在身边长出一小群怪', E.run('tutNearCount(260)'));
  E.run('attackHeld = false; runKills += 3; tickTutorial(1 / 60);');
  ok(key(E) === 'hold', '没按住时砍的不算');
  E.run('attackHeld = true; tickTutorial(1 / 60); runKills += 2; tickTutorial(1 / 60);');
  ok(key(E) === 'hold' && E.run('tutHoldK') === 2, '按住砍了两只：还差一只');
  E.run('attackHeld = false; tickTutorial(1 / 60); attackHeld = true; tickTutorial(1 / 60);');
  ok(E.run('tutHoldK') === 0, '中途松手：从头数');
  E.run('runKills += 3; tickTutorial(1 / 60); attackHeld = false;');
  ok(key(E) === 'aim', '按住连砍三只：进「边拖边斩」', key(E));
}

console.log('\n=== 4b. 边拖边斩：拖着的时候砍中两只才算 ===');
{
  const E = makeEnv();
  fresh(E);
  E.run('enemies.length = 0;');
  reach(E, 'aim');
  ok(E.run('tutNearCount(260)') >= 3, '一进这一步就在身边长出一小群怪', E.run('tutNearCount(260)'));
  E.run('tMove.x = 0; runKills += 3; tickTutorial(1 / 60);');
  ok(key(E) === 'aim', '没拖着砍的不算');
  E.run('tMove.x = 1; tickTutorial(1 / 60); runKills += 1; tickTutorial(1 / 60);');
  ok(key(E) === 'aim' && E.run('tutAimK') === 1, '拖着砍了一只：还差一只');
  E.run('runKills += 1; tickTutorial(1 / 60); tMove.x = 0;');
  ok(key(E) === 'candy', '拖着砍够两只：进「捡糖」', key(E));
}

console.log('\n=== 5. 捡糖 → 碎晶柱 → 破门 → 教学完成 ===');
{
  const E = makeEnv();
  fresh(E);
  reach(E, 'candy');
  ok(E.run('tutText()').indexOf('糖') >= 0, '讲捡糖补光', E.run('tutText()'));
  ok(E.run('candies.length') === 8 && E.run('wdist(candies[0].x, candies[0].y, P.x, P.y)') < 200, '脚下现摆一条短糖路');
  E.tick(30, 0.1);
  ok(key(E) === 'candy', '没捡到：3 秒时还在等');
  E.run('runCandy += 1; tickTutorial(1 / 60);');
  ok(key(E) === 'crystal', '捡到一颗：翻到「碎晶柱」', key(E));
  ok(E.run('tutCrystal() !== null'), '场上有晶柱可以指');
  E.run('crystalsBroken += 1; tickTutorial(1 / 60);');
  ok(key(E) === 'gate', '碎了一根：进「破门」', key(E));
  ok(E.run('tutText()').indexOf('破门') >= 0, '讲破门', E.run('tutText()'));
  E.run('layer += 1; tickTutorial(1 / 60);');
  ok(E.run('tutFinT') > 0 && E.run('tutText()') === '出师了，嘉豪！', '破了门：报"教学完成"');
  E.tick(30, 0.1);
  ok(E.run('tutStep') < E.run('TUT_DONE'), '收尾卡片挂着');
  E.tick(15, 0.1);
  ok(E.run('tutStep') === E.run('TUT_DONE'), '3.2 秒后淡出、彻底消失');
}

console.log('\n=== 6. 每一步都有兜底时间 ===');
{
  const E = makeEnv();
  fresh(E);
  E.run('enemies.length = 0;');
  reach(E, 'hold');
  E.tick(Math.ceil((E.run('TUT_STEPS[2].limit') + 0.5) / 0.1), 0.1);
  ok(key(E) === 'aim', '按住这一步 ' + E.run('TUT_STEPS[2].limit') + ' 秒没做到也翻页', key(E));
  const total = E.run('TUT_STEPS.reduce((a, s) => a + s.limit, 0)');
  ok(total <= 90, '七步兜底加起来不超过一分半', total);
}

console.log('\n=== 7. 每人只自动出现一次；主界面「新手教程」可以再来 ===');
{
  const E = makeEnv();
  fresh(E);
  reach(E, 'gate');
  E.run('layer += 1; tickTutorial(1 / 60);');
  E.run('start();');
  E.step(3);
  ok(E.run('tutStep') === E.run('TUT_DONE'), '走完了：第二局不再出现');
  const F = makeEnv();
  fresh(F);
  reach(F, 'tap');
  F.run('die(); finishRun();');
  const G = makeEnv(844, { dash_meta_v1: F.storage['dash_meta_v1'] });
  G.step(5);
  G.run('start();');
  G.step(3);
  ok(G.run('tutStep') === G.run('TUT_DONE'), '第一局没走完就死了：关掉重开，第二局也不再出现');
  G.run('toReady();');
  G.step(3);
  const b = G.run('readyTutBtn()');
  G.run('onTouchStart({ changedTouches: [{ identifier: 1, clientX: ' + (b.x + b.w / 2) + ', clientY: ' + (b.y + b.h / 2) + ' }] });');
  ok(G.run('state') === 'play' && key(G) === 'move', '主界面点「新手教程」：开一局，从第一步教起', G.run('state') + ' / ' + key(G));
  G.run('die(); finishRun(); start();');
  G.step(3);
  ok(G.run('tutStep') === G.run('TUT_DONE'), '重看完这一局，下一局照样不出现');
}

console.log('\n=== 8. 老存档 ===');
{
  const old = JSON.stringify({ pts: 120, total: 9000, runs: 12, depthBest: 3, kills: 400, lv: {}, unlocked: {}, tut: 3 });
  const E = makeEnv(844, { dash_meta_v1: old });
  ok(E.run('meta.tut') === 0, '旧版教学教完过（tut=3、没有版本号）：新版重新教一次');
  ok(E.run('meta.runs') === 12 && E.run('meta.kills') === 400, '老存档其他进度没被动');
  const v2 = JSON.stringify({ pts: 0, total: 0, runs: 3, kills: 90, lv: {}, unlocked: {}, tut: 5, tutV: 2 });
  const G = makeEnv(844, { dash_meta_v1: v2 });
  ok(G.run('meta.tut') === 0, '上一版（五步）教完过：加了边拖边斩和破门，再教一次');
  const v3 = JSON.stringify({ pts: 0, total: 0, runs: 3, kills: 90, lv: {}, unlocked: {}, tut: 7, tutV: 3, guideV: 1 });
  const H = makeEnv(844, { dash_meta_v1: v3 });
  ok(H.run('meta.tut') === 0, '上一版（v3）教完过：改成了光会灭、跟着糖走到门，再教一次');
  const done = JSON.stringify({ pts: 0, total: 0, runs: 3, kills: 90, lv: {}, unlocked: {}, tut: 7, tutV: 4, guideV: 1 });
  const F = makeEnv(844, { dash_meta_v1: done });
  fresh(F);
  ok(F.run('tutStep') === F.run('TUT_DONE'), '新版教完过的人不再出现');
}

console.log('\n=== 9. 教学期间放慢刷怪、不合围 ===');
{
  const E = makeEnv();
  E.step(10);
  E.run('start(); P.inv = 1e6;');
  E.run('gameTime = 20; spawnTimer = 0; enemies.length = 0; update(1 / 60);');
  const slow = E.run('spawnTimer');
  E.run('tutStep = TUT_DONE; gameTime = 20; spawnTimer = 0; update(1 / 60);');
  const norm = E.run('spawnTimer');
  ok(slow > norm * 1.4, '教学中刷怪间隔约 1.5 倍（' + slow.toFixed(2) + ' vs ' + norm.toFixed(2) + '）');
  const F = makeEnv();
  F.step(10);
  F.run('start(); P.inv = 1e6; gameTime = 40; waveTimer = 0;');
  F.run('for (let i = 0; i < 600; i++) update(1 / 60);');
  ok(F.run('waveWarnT') <= 0 && F.run('waveDirs.length') === 0, '教学没走完，过了 30 秒也不合围');
}

console.log('\n=== 10. 新敌人提示卡：头两次出场才弹 ===');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;');
  fresh(E);
  for (let i = 1; i <= 3; i++) {
    E.run('enemyTip = null; layer = 2; onEnterLayer(2); gameTime = scoutAt; update(1 / 60);');
    const tip = E.run('enemyTip && enemyTip.type');
    if (i <= 2) ok(tip === 'bomb', '第 ' + i + ' 次见爆裂者：弹卡', tip);
    else ok(!tip, '第 3 次不再弹', tip);
  }
  ok(E.run('meta.seen.bomb') === 2, '次数记在 meta.seen');
  E.run('meta.seen = {}; layerFxT = 1.8; banners.length = 0; showEnemyTip("heavy");');
  E.step(10);
  ok(E.run('enemyTip.t') === 0, '进层字幕还在放：卡片先等着，不叠在一起');
  E.step(110);
  ok(E.run('enemyTip.t') > 0, '字幕放完才开始计时');
  E.step(300);
  ok(E.run('enemyTip') === null, '4.2 秒后收起');
}

console.log('\n=== 11. 结算页 / 强化页的引导只出现一次 ===');
{
  const E = makeEnv();
  E.step(5);
  ok(E.run('meta.tipShop') === 0 && E.run('meta.tipSkills') === 0, '新存档两个引导都没看过');
  E.run('openSkills();');
  ok(E.run('meta.tipShop') === 1, '点进强化页：结算页的气泡不再出现');
  E.run('backFromSkills();');
  ok(E.run('meta.tipSkills') === 1, '离开强化页：说明行换回原来那句');
  E.run('clearYingAt = nowMs(); clearYing();');
  ok(E.run('meta.tut') === 0 && E.run('meta.tipShop') === 0, '测试按钮「清空余光 · 教程」把引导一起重置');
}

console.log('\n=== 12. 每一步都能画 ===');
[667, 844].forEach(h => {
  const E = makeEnv(h);
  let err = null;
  try {
    fresh(E);
    for (const k of ['move', 'tap', 'hold', 'aim', 'candy', 'crystal', 'gate']) {
      reach(E, k);
      E.run('attackHeld = ' + (k === 'hold') + ';');
      E.step(20);
    }
    E.run('layer += 1; tickTutorial(1 / 60);');
    E.step(30);
    E.run('touchId = 7; tOrigin = { x: 100, y: 600 }; tMove.x = 0.6; tMove.y = -0.3;');
    E.step(5);
    E.run('showEnemyTip("watch"); tutStep = TUT_DONE;');
    E.step(30);
  } catch (e) { err = e.message; }
  ok(!err, h + 'px：七步 + 收尾 + 摇杆 + 新敌人卡 连续渲染无异常', err);
  ok(E.bad.length === 0, h + 'px：没有画在 NaN 上', E.bad.slice(0, 5).join(','));
  ok(!E.shadow(), h + 'px：没碰 shadowBlur');
});

console.log('\n=== 13. 破门：教到那一步才放；教学期间不会死 ===');
{
  const E = makeEnv();
  fresh(E);
  E.run('P.inv = 0; enemies.length = 0;');
  reach(E, 'hold');
  E.run('candyNext = door.n; candies.length = 0; P.x = P.px = door.x; P.y = P.py = door.y; update(1 / 60);');
  ok(E.run('layer') === 1, '还没教到破门：走到门口也斩不开', E.run('layer'));
  const e = E.run('(function () { const e = spawnEnemy(P.x + 3, P.y, "grunt"); e.sp = 0; P.inv = 0; P.dashT = 0; P.glideT = 0; update(1 / 60); return state; })()');
  ok(e === 'play', '教学期间被怪贴上也不会死', e);
  E.run('enemies.length = 0;');
  reach(E, 'gate');
  E.run('update(1 / 60);');
  ok(E.run('layer') === 1 && E.run('candies.length') === 8, '到了破门这一步：脚下现摆一条短路，门在 8 颗糖之后');
  E.run('candyNext = door.n; candies.length = 0; P.x = P.px = door.x; P.y = P.py = door.y; update(1 / 60);');
  ok(E.run('layer') === 2, '走到门口：破门进第 2 层', E.run('layer'));
  E.run('tickTutorial(1 / 60);');
  ok(E.run('tutFinT') > 0, '破了门：教学完成');
  E.run('tutStep = TUT_DONE; lightL = 0.2; update(1 / 60);');
  ok(E.run('lightL') < 0.2, '教学结束以后：光照常往下掉（不再停在三成）', E.run('lightL'));
}

console.log('\n=== 14. 第一次玩：点开始直接进教学局，不先弹玩法说明 ===');
{
  const E = makeEnv();
  E.step(10);
  ok(E.run('state') === 'ready', '新存档在主界面');
  E.run('onTouchStart({ changedTouches: [{ identifier: 1, clientX: 195, clientY: 300 }] });');
  ok(E.run('state') === 'talk', '点屏幕开始：先放开场（背景故事）', E.run('state'));
  E.run('talkEnd();');                 // 跳过开场
  E.step(3);
  ok(E.run('state') === 'play' && key(E) === 'move', '跳过开场：直接开教学局，从拖动教起', E.run('state') + ' / ' + key(E));
  ok(E.run('S.bgmOn()') === true, '教学局一开始背景音乐就起了');
  ok(E.run('GUIDE.some(g => g.title.indexOf("破门") >= 0)'), '说明里有讲破门的一页');
  ok(!E.run('GUIDE.some(g => g.lines.some(l => l.indexOf("15 秒") >= 0))'), '说明里不再有"每 15 秒下潜一层"');
  E.run('die(); finishRun(); toReady();');
  E.step(3);
  E.run('onTouchStart({ changedTouches: [{ identifier: 3, clientX: 195, clientY: 300 }] });');
  E.run('talkEnd();');                 // 开场每次都放：跳过
  ok(E.run('state') === 'play' && key(E) === 'done', '第二次点开始：不再教', E.run('state') + ' / ' + key(E));

  // 玩法说明只从主界面按钮进：右上角「关闭」回主界面，而且在胶囊（"···"和关闭）下面，不会压在平台的关闭键上
  const F = makeEnv();
  F.step(10);
  const gb = F.run('readyGuideBtn()');
  F.run('onTouchStart({ changedTouches: [{ identifier: 1, clientX: ' + (gb.x + 10) + ', clientY: ' + (gb.y + 10) + ' }] });');
  ok(F.run('state') === 'guide' && F.run('guidePage') === 0, '主界面「玩法说明」：打开第一页');
  const C = F.run('guideLayout().close'), MN = F.run('MENU');
  ok(!MN || C.y >= MN.bottom, '「关闭」在胶囊下面', JSON.stringify(C) + ' / ' + JSON.stringify(MN));
  F.run('onTouchStart({ changedTouches: [{ identifier: 2, clientX: ' + (C.x + 10) + ', clientY: ' + (C.y + 10) + ' }] });');
  ok(F.run('state') === 'ready', '点「关闭」回主界面', F.run('state'));

  const old = JSON.stringify({ pts: 0, total: 0, runs: 9, kills: 300, lv: {}, unlocked: {}, tut: 7, tutV: 3, guideV: 2 });
  const G = makeEnv(844, { dash_meta_v1: old });
  G.step(10);
  G.run('onTouchStart({ changedTouches: [{ identifier: 1, clientX: 195, clientY: 300 }] });');
  G.run('talkEnd();');                 // 跳过开场
  ok(G.run('state') === 'play', '老存档（带着以前的 guideV）：点开始照常开局', G.run('state'));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
