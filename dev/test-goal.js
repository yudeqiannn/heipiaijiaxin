/* 目标感三件套：深度层 / 每局契约 / 里程碑
   1) 跟着糖走到门才进层（只靠时间、只靠斩杀都不行），层名、提示、门条都对；破门震碎身边的怪、给余光、换新路
   2) 契约能抽到、能判定、达成才给余光
   3) 死亡时历史最深与解锁落账，新纪录标记只在真刷新时亮
   4) 里程碑：300 斩解锁断水（刀变长）、1000 斩白刃、第 5 层开第五技能
   5) 第五技能锁着时买不了，解锁后能买
   6) 四个界面都能画
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(h) {
  h = h || 844;
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000;
  const ac = {
    get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  const canvas = {
    width: 0, height: 0, clientWidth: 390, clientHeight: h,
    getContext: () => new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        return t[k] !== undefined ? t[k] : function () {};
      },
      set(t, k, v) { t[k] = v; return true; }
    }),
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: h })
  };
  const storage = {};
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: h, safeArea: { top: 40, bottom: h - 14 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  let raf = null;
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => simT },
    requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'headless' }
  };
  sb.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: h };
  sb.document = { getElementById: () => canvas, addEventListener() {}, visibilityState: 'visible' };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext('meta.tut = TUT_DONE;', sb);   // 测正常对局：教学局里破门压着、人也不会死
  vm.runInContext(`globalThis.__K = {
    get state(){return state;}, set state(v){ state = v; },
    get layer(){return layer;}, set layer(v){ layer = v; },
    get layerFxT(){return layerFxT;},
    get layerBestNew(){return layerBestNew;},
    get runKills(){return runKills;}, set runKills(v){ runKills = v; },
    get contract(){return contract;}, set contract(v){ contract = v; },
    get contractDone(){return contractDone;},
    get contractFx(){return contractFx;},
    get contractReward(){return contractReward;},
    get gameTime(){return gameTime;}, set gameTime(v){ gameTime = v; },
    get bestCombo(){return bestCombo;}, set bestCombo(v){ bestCombo = v; },
    get combo(){return combo;}, set combo(v){ combo = v; },
    get comboTimer(){return comboTimer;}, set comboTimer(v){ comboTimer = v; },
    get crystalsBroken(){return crystalsBroken;}, set crystalsBroken(v){ crystalsBroken = v; },
    get unlockNew(){return unlockNew;},
    get score(){return score;}, set score(v){ score = v; },
    get yingRun(){return yingRun;}, set yingRun(v){ yingRun = v; },
    meta, POW, CFG, CONTRACTS, MILESTONES, SKILLS, crystals, enemies,
    start, die, finishRun, checkContract, contractProgress, recalcPowers,
    get candies(){return candies;}, get door(){return door;},
    get candyNext(){return candyNext;}, set candyNext(v){ candyNext = v; },
    get layerBroke(){return layerBroke;},
    trailN, gateText, layerName, layerProgress, breakLayer, RANK, fmtNum, fifthOpen, skillOpen, buySkill, lvOf,
    P_set(x, y){ P.x = P.px = x; P.y = P.py = y; },
    skillLayout, spawnEnemy, shatterCrystal, killEnemy, render, buildCrystals,
    P_x(){ return P.x; }, P_y(){ return P.y; },
    __storage: null,
    set spawnTimer(v){ spawnTimer = v; }
  };`, sb);
  sb.__K.__storage = storage;
  return { K: sb.__K, storage, step: n => { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) throw new Error('no raf'); simT += 16.7; cb(simT); } } };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

const env = makeEnv(), K = env.K;
env.step(20);
K.CFG.cards = false;       // 这里只测深度 / 契约 / 里程碑：破门不弹刀诀三选一，免得停在挑卡上

function quiet() {
  K.CFG.spawnBase = 1e9; K.CFG.spawnMin = 1e9;
  K.CFG.waveFirst = 1e9; K.CFG.chargerAt = 1e9; K.CFG.heavyAt = 1e9;
  K.CFG.bombAt = 1e9; K.CFG.watchAt = 1e9;
  K.spawnTimer = 1e9; K.enemies.length = 0;
}

/* ---------- 1. 深度层 ---------- */
console.log('=== 1. 深度层：跟着糖走到门 ===');
{
  ok(K.trailN(1) === 26 && K.trailN(2) === 30 && K.trailN(7) === 50 && K.trailN(20) === 50,
    '一层的糖：26、30、34…… 最多 50 颗', [1, 2, 7, 20].map(K.trailN).join('/'));
  ok(K.layerName(1) === '残响' && K.layerName(3) === '裂隙', '层名对得上',
    K.layerName(1) + '/' + K.layerName(3));
  ok(K.layerName(99) === '深处 99', '超出名单的层用「深处 N」', K.layerName(99));

  K.start(); quiet(); env.step(2);
  ok(K.layer === 1, '开局 layer=1');
  ok(K.layerFxT > 0, '开局先报一次层名');
  // 光会灭：这一组里一直补满，只看进层
  K.gameTime = 90;
  for (let i = 0; i < 40; i++) { K.spawnEnemy(K.P_x() + 600, K.P_y(), 'grunt'); K.killEnemy(K.enemies.length - 1); }
  env.step(3);
  ok(K.layer === 1, '只靠时间、只靠斩杀都不进层（90 秒、斩了 40 只还在第 1 层）', K.layer);
  ok(/^还有 \d+ 米$/.test(K.gateText()) && K.layerProgress() === 0, '一颗糖没捡：门条写还有多少米、是空的', K.gateText());
  K.candyNext = K.door.n / 2;
  ok(Math.abs(K.layerProgress() - 0.5) < 0.01, '走到一半：门条到一半', K.layerProgress().toFixed(2));
  // 走到门口：身边放两只怪，破门的冲击波把近的那只震碎，奖励余光
  K.candyNext = K.door.n; K.candies.length = 0;
  K.enemies.length = 0;
  const dx = K.door.x, dy = K.door.y;
  const near = K.spawnEnemy(dx + 60, dy, 'grunt'), far = K.spawnEnemy(dx + 400, dy, 'grunt');   // 冲击波外、又没远到被当成甩掉的怪收走
  near.sp = far.sp = 0;
  const y0 = K.yingRun;
  K.P_set(dx, dy); env.step(2);
  ok(K.layer === 2 && K.layerBroke, '碰到门：破门进第 2 层', K.layer);
  ok(K.layerFxT > 1.5, '进层提示重新计时', K.layerFxT.toFixed(2));
  ok(K.enemies.indexOf(near) < 0 && K.enemies.indexOf(far) >= 0, '冲击波震碎了身边那只，远处那只还在');
  ok(K.yingRun - y0 === 5 + 3 * 2, '破门奖励余光 ' + (K.yingRun - y0), K.yingRun - y0);
  ok(K.candies.length === 30 && K.candyNext === 0, '第 2 层换一条新路（30 颗糖）', K.candies.length);
}

/* ---------- 1b. 全服排名（假的，已关掉：换成抖音排行榜了，见 test-rank.js） ---------- */
console.log('=== 1b. 全服排名（假数据，已关） ===');
{
  const a = K.RANK.of(1000), b = K.RANK.of(5000), c = K.RANK.of(20000);
  ok(a.rank > b.rank && b.rank > c.rank && c.rank >= 1, '分数越高名次越靠前（' + a.rank + ' → ' + b.rank + ' → ' + c.rank + '）');
  ok(a.pct < b.pct && b.pct < c.pct && c.pct < 1, '强于的比例跟着涨，到不了 100%');
  ok(K.fmtNum(13985) === '13,985' && K.fmtNum(65) === '65', '名次带千分位：13,985');
  ok(K.CFG.fakeRank === false, '假排名关掉了（换成抖音排行榜，0.5 节 RK）');
}

/* ---------- 2. 契约 ---------- */
console.log('=== 2. 每局契约 ===');
{
  K.start();
  const ids = K.CONTRACTS.map(c => c.id);
  ok(K.contract && ids.indexOf(K.contract.id) >= 0, '开局抽到一个合法契约', K.contract && K.contract.text);

  // 同一局里反复开始，应该抽到不止一种（随机性）
  const seen = {};
  for (let i = 0; i < 40; i++) { K.start(); seen[K.contract.id] = 1; }
  ok(Object.keys(seen).length >= 3, '契约是随机的，不是永远同一个', Object.keys(seen).join(','));

  // 连击型
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[0];          // 连击到 25
  K.bestCombo = 24; K.checkContract();
  ok(!K.contractDone, '差 1 层连击不算达成');
  K.bestCombo = 25; K.checkContract();
  ok(K.contractDone, '连击够了就达成');
  ok(K.contractFx > 2, '达成时有提示动画', K.contractFx.toFixed(2));

  // 碎柱型
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[1];          // 碎 4 根
  K.crystalsBroken = 3; K.checkContract();
  ok(!K.contractDone, '碎 3 根还没到 4 根');
  K.crystalsBroken = 4; K.checkContract();
  ok(K.contractDone, '碎够 4 根达成');

  // 斩杀型
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[2];          // 35 只
  K.runKills = 35; K.checkContract();
  ok(K.contractDone, '斩杀数够了达成');

  // 层型
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[3];          // 活到第 4 层
  K.layer = 3; K.checkContract();
  ok(!K.contractDone, '第 3 层还不算');
  K.layer = 4; K.checkContract();
  ok(K.contractDone, '到第 4 层达成');

  // 纯净型：中途碎柱就作废
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[4];          // 不碎柱活到第 3 层
  K.layer = 3; K.crystalsBroken = 1; K.checkContract();
  ok(!K.contractDone, '碎了柱就不算纯净');
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[4];
  K.layer = 3; K.crystalsBroken = 0; K.checkContract();
  ok(K.contractDone, '没碎柱到第 3 层达成');
}

/* ---------- 3. 契约余光入账 ---------- */
console.log('=== 3. 契约奖励 ===');
{
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[0];
  K.bestCombo = 30; K.checkContract();
  const before = K.meta.pts;
  K.yingRun = 40;                        // 本局晶柱余光
  K.finishRun();
  ok(K.contractReward === 50, '契约奖励是 50', K.contractReward);
  ok(K.meta.pts === before + 40 + 50, '晶柱余光与契约奖励都入账', (K.meta.pts - before));

  // 没达成的契约不给钱
  K.start(); quiet(); env.step(2);
  K.contract = K.CONTRACTS[0];
  K.yingRun = 30;
  const b2 = K.meta.pts;
  K.finishRun();
  ok(K.contractReward === 0, '未达成奖励为 0');
  ok(K.meta.pts === b2 + 30, '只进晶柱那 30', (K.meta.pts - b2));
}

/* ---------- 4. 历史最深 / 新纪录 ---------- */
console.log('=== 4. 历史最深 ===');
{
  K.meta.depthBest = 3;
  K.start(); quiet(); env.step(2);
  K.layer = 3; K.state = 'play';
  K.die();
  ok(K.meta.depthBest === 3, '平了纪录不算刷新');
  ok(!K.layerBestNew, '没有新纪录标记');

  K.start(); quiet(); env.step(2);
  K.layer = 6; K.state = 'play';
  K.die();
  ok(K.meta.depthBest === 6, '刷新历史最深', K.meta.depthBest);
  ok(K.layerBestNew, '亮了新纪录');

  const saved = JSON.parse(env.storage['dash_meta_v1'] || '{}');
  ok(saved.depthBest === 6, '深度立刻写进存档', saved.depthBest);
}

/* ---------- 5. 里程碑 ---------- */
console.log('=== 5. 里程碑 ===');
{
  K.meta.unlocked = {};
  K.meta.kills = 299;
  K.POW.blade = 1;
  K.start(); quiet(); env.step(2);
  K.state = 'play'; K.die();
  ok(!K.meta.unlocked.blade, '299 斩还没解锁断水');

  K.meta.kills = 300;
  K.start(); quiet(); env.step(2);
  K.state = 'play'; K.die();
  ok(K.meta.unlocked.blade === 1, '300 斩解锁断水');
  ok(K.unlockNew.length >= 1 && K.unlockNew[0].name === '断水', '死亡页能报出解锁名',
    K.unlockNew.map(m => m.name).join(','));
  ok(K.POW.blade > 1.2, '刀真的变长了', K.POW.blade.toFixed(2));

  K.meta.kills = 1000;
  K.start(); quiet(); env.step(2);
  K.state = 'play'; K.die();
  ok(K.meta.unlocked.white === 1, '1000 斩解锁白刃');
  ok(K.POW.white === true, '刀光转白热已生效');

  // 存档能读回来
  const saved = JSON.parse(env.storage['dash_meta_v1'] || '{}');
  ok(saved.kills === 1000, '累计斩杀已落盘', saved.kills);
  ok(saved.unlocked && saved.unlocked.blade === 1, '解锁状态已落盘');
}

/* ---------- 6. 第五技能 ---------- */
console.log('=== 6. 第五项强化（剑气） ===');
{
  K.meta.depthBest = 2;
  K.recalcPowers();
  ok(!K.fifthOpen(), '没到第 4 层时是锁的');
  K.meta.pts = 9999;
  const qi = K.SKILLS[4];
  ok(qi.id === 'qi', '第五项是剑气', qi.id);
  ok(K.skillOpen(qi) === false, 'skillOpen 对剑气返回 false');
  ok(K.buySkill(qi) === false, '锁着时买不了', K.lvOf('qi'));
  ok(K.lvOf('qi') === 0, '等级没变');

  K.meta.depthBest = 4;
  K.recalcPowers();
  ok(K.fifthOpen(), '第 4 层解锁');
  ok(K.buySkill(qi) === true, '解锁后能买');
  ok(K.lvOf('qi') === 1, '买到 1 级');
  ok(K.POW.qiEvery === 10, '连斩每 10 刀放一圈剑气', K.POW.qiEvery);

  // 其余技能不受影响
  ok(K.skillOpen(K.SKILLS[0]) === true, '其他技能一直是开的');
}

/* ---------- 7. 界面 ---------- */
console.log('=== 7. 界面 ===');
{
  let err = null;
  try {
    K.start(); quiet();
    K.contract = K.CONTRACTS[0];
    K.layer = 2; K.gameTime = 18;
    env.step(3);                 // 战斗中：层数 + 契约都在画
    K.state = 'play'; K.die();
    env.step(3);                 // 死亡页：最深 / 契约 / 解锁
    K.state = 'over';
    env.step(2);                 // 结算页：契约奖励
    K.meta.depthBest = 6;
    K.state = 'skills';
    env.step(2);                 // 技能页：5 张卡 + 锁定态
    K.meta.depthBest = 1;
    env.step(2);                 // 再画一次锁定态
  } catch (e) { err = e; }
  ok(!err, '四个界面渲染无异常', err && err.message);
}

/* ---------- 8. 矮屏 ---------- */
console.log('=== 8. 667px 矮屏 ===');
{
  const e2 = makeEnv(667);
  e2.step(20);
  const L = e2.K.skillLayout();
  ok(L.ys.length === 5, '五张卡都排上了');
  ok(L.ch >= 64, '卡高不低于 64', L.ch.toFixed(1));
  ok(L.reset.y + L.reset.h <= 667, '底部按钮在屏内', (L.reset.y + L.reset.h).toFixed(0));
  let err = null;
  try { e2.K.state = 'skills'; e2.step(2); } catch (e) { err = e; }
  ok(!err, '矮屏技能页能画', err && err.message);
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
