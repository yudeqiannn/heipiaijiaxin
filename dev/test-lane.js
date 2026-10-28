/* 横屏跑酷测试（2.17 节）—— 用户："改成横屏，分为上 中上 中下 下四个区域体育生从左往右跑，嘉豪从右往左阻挡体育生，
   路上有柜子黑板饮水机之类的东西阻挡体育生，后面改成是教导主任在追，体育生如果撞上嘉豪，就会放慢速度，类似地铁跑酷那种，
   然后如果有嘉豪，玩家可以往前划一下给他打掉"；掉血："你学地铁跑酷就行"
   1) 横屏、主界面点开始进跑酷
   2) 上下划换道（到边划不出去）
   3) 往右划斩：同一条道够得着的嘉豪一刀全斩（连斩），斩不动柜子、刀停在柜子前，别的道不斩
   4) 地铁跑酷的掉血：撞嘉豪 / 换道蹭到柜子 = 绊一跤；换道撞到旁边的嘉豪 = 踢飞（算连斩）（慢、教导主任冲到身后、连斩断）；他在身后再绊一跤 = 被抓；正面撞柜子 = 直接被抓
   5) 糖、越跑越快、越连越值钱、每排都留一条道
   6) 被抓那一页：看广告复活（一次）、再来一局、返回主界面；记最远、最高、糖
   7) 第一局停住教两步（换道、斩）；暂停；画得出来 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(store) {
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000, raf = null;
  const ac = { get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(), createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(), createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {} };
  const ops = {}, texts = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (k === 'fillText') return s => { ops.fillText = (ops.fillText || 0) + 1; texts.push(String(s)); };
      if (k === 'fill' || k === 'stroke' || k === 'fillRect' || k === 'drawImage') return () => { ops[k] = (ops[k] || 0) + 1; };
      return t[k] !== undefined ? t[k] : function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const storage = store || {};
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 844, windowHeight: 390, safeArea: { top: 0, bottom: 369, left: 47, right: 797 } }),
    getMenuButtonBoundingClientRect: () => ({ top: 10, bottom: 42, left: 740, right: 827, width: 87, height: 32 }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {}, vibrateShort() {}, vibrateLong() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  const sb = { tt, console, setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {}, performance: { now: () => simT },
    requestAnimationFrame: f => { raf = f; return 1; }, cancelAnimationFrame() {}, Math: Object.create(Math), Date, JSON, Promise, Error, isNaN, parseInt, parseFloat, navigator: { userAgent: 'headless' } };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext('HD.story = false;', sb);
  const run = code => vm.runInContext(code, sb);
  const step = n => { for (let i = 0; i < (n || 1); i++) { const f = raf; raf = null; if (!f) break; simT += 16.7; f(simT); } };
  let tid = 30;
  const down = (x, y) => { const id = ++tid; run('onTouchStart({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });'); return id; };
  const move = (id, x, y) => run('onTouchMove({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });');
  const up = (id, x, y) => run('onTouchEnd({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tap = (x, y) => up(down(x, y), x, y);
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  const swipe = (dx, dy) => { const id = down(420, 200); move(id, 420 + dx, 200 + dy); up(id, 420 + dx, 200 + dy); };
  return { run, step, tap, tapRect, swipe, down, move, up, ops, texts, storage };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局（教过了），清空前面，不再摆新的
function play(E, pre) {
  E.run('meta.lTut = 1;' + (pre || '')); E.step(3);
  E.tap(420, 300); E.step(2);
  E.run('lObs.length = 0; lRowIn = 1e12; lChaseT = 0; lTeachX = -200;');
  E.step(1);
}
// 在第 lane 条道、体育生前面 dx 摆一个
const put = (E, k, lane, dx, extra) => E.run('lAdd("' + k + '", ' + lane + ', lPX() + ' + dx + ', ' + (extra ? JSON.stringify(extra) : 'null') + ')') && E.run('lObs.length - 1');
const L = E => E.run('lCur()');

console.log('1) 横屏、开局');
{
  const gj = JSON.parse(fs.readFileSync(__dirname + '/../game.json', 'utf8'));
  ok(gj.deviceOrientation === 'landscape', 'game.json：横屏');
  const E = makeEnv();
  E.step(3);
  ok(E.run('CFG.mainMode') === 'lane' && E.run('state') === 'ready', '主玩法是横屏跑酷，停在主界面');
  E.run('meta.lTut = 1;'); E.tap(420, 300); E.step(2);
  ok(E.run('state') === 'play' && E.run('laneMode') && !E.run('hordeMode'), '点开始：开跑');
  ok(E.run('lLane') === 1 && E.run('LN.lanes') === 4, '四条道，从第二条（中上）开始跑');
}

console.log('2) 换道');
{
  const E = makeEnv();
  play(E);
  E.swipe(0, 60); E.step(10);
  ok(L(E) === 2, '往下划：换到中下');
  E.swipe(0, -60); E.step(10); E.swipe(0, -60); E.step(10);
  ok(L(E) === 0, '往上划两下：到最上面');
  E.swipe(0, -60); E.step(10);
  ok(L(E) === 0, '最上面再往上划：不动');
  const id = E.down(420, 200); E.move(id, 420, 214); E.up(id, 420, 214); E.step(10);
  ok(L(E) === 1, '划得短一点、松手才够：也认（往下一条）');
}

console.log('3) 往右划斩');
{
  const E = makeEnv();
  play(E);
  put(E, 'jh', 1, 60); put(E, 'jh', 1, 112); put(E, 'jh', 1, 164); put(E, 'jh', 2, 80);
  E.swipe(80, 0); E.step(1);
  ok(E.run('lKills') === 3 && E.run('combo') === 3, '同一条道挨着的三个：一刀全斩，连斩 ×3');
  ok(E.run('lObs.filter(function (o) { return o.k === "jh" && !o.dead; }).length') === 1, '别的道上的不斩');
  E.step(20);
  E.run('lObs.length = 0;');
  put(E, 'cab', 1, 90); put(E, 'jh', 1, 150);
  const k0 = E.run('lKills');
  E.swipe(80, 0); E.step(1);
  ok(E.run('lKills') === k0 && E.run('lObs.every(function (o) { return !o.dead; })'), '柜子斩不动，刀停在柜子前（后面的嘉豪没斩到）');
  E.step(20); E.run('lObs.length = 0;');
  E.swipe(80, 0); E.step(1);
  ok(E.run('lSlashCd') > E.run('LN.slashCd'), '斩空了：隔一会儿才能再斩（乱划没用）');
  E.step(30);
  put(E, 'jh', 1, LN_REACH = E.run('LN.reach') + 60);
  E.swipe(80, 0); E.step(1);
  ok(E.run('lKills') === k0, '够不着（' + E.run('LN.reach') + ' 以外）的不斩');
}

console.log('4) 掉血（地铁跑酷那套）');
{
  const E = makeEnv();
  play(E);
  E.run('combo = 7; lComboT = 9;');
  put(E, 'jh', 1, 20, { vx: 0 });
  E.step(2);
  ok(E.run('state') === 'play' && E.run('lStumbles') === 1 && E.run('lChaseT') > 0, '撞上嘉豪：绊一跤，教导主任冲到身后（没被抓）');
  ok(E.run('combo') === 0 && E.run('lSlowT') > 0, '连斩断了，慢一下');
  E.step(40);
  ok(E.run('lTeachX') > E.run('lPX()') - 140, '教导主任追到身后看得见');
  put(E, 'jh', 1, 20, { vx: 0 });
  E.step(2);
  ok(E.run('state') === 'dead' && /又绊了一跤/.test(E.run('lDeadWhy')), '他还在身后又绊一跤：被抓', E.run('lDeadWhy'));
  const F = makeEnv();
  play(F);
  F.run('lChaseT = 0; lInv = 0;'); F.step(Math.ceil(F.run('LN.chaseT') / 0.0167) + 2);
  put(F, 'jh', 1, 20, { vx: 0 }); F.step(2);
  F.step(Math.ceil((F.run('LN.chaseT') + 0.5) / 0.0167));
  ok(F.run('lChaseT') <= 0, LN0 = F.run('LN.chaseT') + ' 秒后教导主任落回去');
  put(F, 'jh', 1, 20, { vx: 0 }); F.step(2);
  ok(F.run('state') === 'play' && F.run('lStumbles') === 2, '落回去以后再绊：又只是绊一跤');
  const G = makeEnv();
  play(G);
  put(G, 'cab', 1, 20); G.step(2);
  ok(G.run('state') === 'dead' && G.run('lDeadWhy') === '撞上了柜子', '正面撞上柜子：直接被抓');
  const H = makeEnv();
  play(H);
  put(H, 'board', 2, 0);
  H.swipe(0, 60); H.step(3);
  ok(L(H) === 1 && H.run('lStumbles') === 1 && H.run('state') === 'play', '往下换道蹭到旁边的黑板：弹回来、绊一跤');
  // 用户："如果嘉豪在侧面，可以给他踢飞，要不然容易出现死路"
  const K = makeEnv();
  play(K);
  K.run('combo = 4; lComboT = 9;');
  put(K, 'cab', 1, 120); put(K, 'jh', 2, 5, { vx: 0 });
  K.swipe(0, 60); K.step(12);
  ok(L(K) === 2 && K.run('lStumbles') === 0 && K.run('state') === 'play', '前面柜子、旁边那条道贴着一个嘉豪：往下换道，一脚踢飞（不绊、不堵死）');
  ok(K.run('combo') === 5 && K.run('lKills') === 1, '踢飞也算连斩（×5）、加分');
  ok(K.run('meta.seen.lKick') === 1, '第一次踢飞：头上飘「踢飞！」');
  const M = makeEnv();
  play(M);
  put(M, 'jh', 0, 60, { vx: 0 });
  M.swipe(0, -60); M.step(1);
  M.run('lObs[0].x = lPX() + 5;'); M.step(6);
  ok(M.run('lStumbles') === 0 && M.run('lKills') === 1, '换道换到一半、要去那条道的嘉豪撞上来：也踢飞');
}

console.log('5) 糖、速度、倍率、摆法');
{
  const E = makeEnv();
  play(E);
  put(E, 'candy', 1, 15); E.step(2);
  ok(E.run('lCandy') === 1, '跑过嘉欣糖：+1');
  const v0 = E.run('lV');
  E.run('lTime = LN.rampT;'); E.step(1);
  ok(E.run('lV') > v0 * 2, '越跑越快：' + Math.round(v0) + ' → ' + Math.round(E.run('lV')));
  E.run('combo = 9;'); ok(E.run('lMul()') === 1, '连斩 9：分 ×1');
  E.run('combo = 10;'); ok(E.run('lMul()') === 2, '连斩 10：分 ×2（配乐升一档）');
  E.run('combo = 120;'); ok(E.run('lMul()') === 6, '连斩 120：分 ×6');
  // 摆一千排：每排至少一条道没障碍，安全道两排之间最多差两条
  const r = JSON.parse(E.run(`(function () {
    let bad = 0, jump = 0, prev = lSafe, rows = 0, jh = 0, obs = 0;
    lTime = 100;
    for (let i = 0; i < 1000; i++) {
      lObs.length = 0; lRow(); rows++;
      const blocked = [false, false, false, false];
      lObs.forEach(function (o) { if (o.k !== 'jh' && o.k !== 'candy') { blocked[o.lane] = true; obs++; } if (o.k === 'jh') jh++; });
      if (blocked.every(function (b) { return b; }) || blocked[lSafe]) bad++;
      if (Math.abs(lSafe - prev) > 2) jump++;
      prev = lSafe;
    }
    return JSON.stringify({ bad: bad, jump: jump, jh: jh / rows, obs: obs / rows });
  })()`));
  ok(r.bad === 0 && r.jump === 0, '摆 1000 排：每排都留一条没障碍的道，相邻两排的这条道最多差两条（换得过去）', JSON.stringify(r));
  ok(r.jh > 0.8 && r.obs > 1, '一排平均 ' + r.jh.toFixed(1) + ' 个嘉豪、' + r.obs.toFixed(1) + ' 个障碍（第 100 秒）');
}

console.log('6) 被抓那一页');
{
  const store = {};
  const E = makeEnv(store);
  play(E);
  E.run('lCandy = 7; lDist = 500 * LN.m; score = 900;');
  const c0 = E.run('meta.candy');
  put(E, 'cab', 1, 20); E.step(2);
  ok(E.run('meta.candy') === c0 + 7 && E.run('meta.lBest') === 500 && E.run('meta.lScore') >= 900, '被抓就记：糖 +7、最远 500 米、最高分');
  E.step(60);
  E.texts.length = 0; E.step(1);
  ok(E.texts.indexOf('被教导主任抓住了！') >= 0 && E.texts.indexOf('撞上了柜子') >= 0, '写着：被教导主任抓住了！撞上了柜子');
  ok(!!E.run('lDeadLayout().revive'), '有「看广告 · 原地复活」');
  E.run('lRevive();'); E.step(2);
  ok(E.run('state') === 'play' && E.run('lInv') > 0 && E.run('lObs.filter(function (o) { return !o.dead && o.k !== "candy"; }).length') === 0, '复活：接着跑，身前清空，无敌一会儿');
  E.run('lCandy = 9;'); put(E, 'cab', 1, 20); E.run('lInv = 0;'); E.step(2);
  ok(E.run('meta.candy') === c0 + 9, '复活后再被抓：糖只补差额（+2）');
  ok(!E.run('lDeadLayout().revive'), '只能复活一次');
  E.step(60);
  E.tapRect(E.run('lDeadLayout().go')); E.step(2);
  ok(E.run('state') === 'play' && E.run('lMeters()') < 5, '再来一局：直接开跑');
  E.run('lObs.length = 0; lRowIn = 1e12;'); put(E, 'cab', 1, 20); E.step(70);
  E.tapRect(E.run('lDeadLayout().home')); E.step(2);
  ok(E.run('state') === 'ready' && !E.run('laneMode'), '返回主界面');
  const F = makeEnv(store);
  F.step(2);
  ok(F.run('meta.lBest') === 500 && F.run('meta.lTut') === 1, '存档读回来：最远 500 米、教过了');
}

console.log('7) 第一局教两步、暂停、画');
{
  const E = makeEnv();
  E.step(3); E.tap(420, 300); E.step(2);
  ok(E.run('lTut') === 0 && E.run('lChaseT') === 0, '第一局：要教，教导主任先不出来');
  let f = 0; while (!E.run('lTutFz') && f < 600) { E.step(1); f++; }
  ok(E.run('lTutFz && lTutFz.k') === 'move', '柜子来了：停住，教换道');
  const t0 = E.run('lTime'); E.step(30);
  ok(E.run('lTime') === t0, '停着的时候世界不动');
  E.swipe(80, 0); E.step(2);
  ok(E.run('lTutFz && lTutFz.k') === 'move', '划错方向（往右）：还停着');
  E.swipe(0, 60); E.step(2);
  ok(!E.run('lTutFz') && E.run('lLane') === 2, '往下划：换了道，接着走');
  f = 0; while (!E.run('lTutFz') && f < 900) { E.step(1); f++; }
  ok(E.run('lTutFz && lTutFz.k') === 'slash', '嘉豪来了：停住，教斩');
  E.swipe(80, 0); E.step(2);
  ok(E.run('lKills') === 1 && !E.run('lTutFz'), '往右划：斩飞了');
  f = 0; while (E.run('lTut') < 3 && f < 600) { E.step(1); f++; }
  ok(E.run('lTut') === 3 && E.run('meta.lTut') === 1, '一张卡（绊一跤、教导主任）以后：教完了，记下');
  E.texts.length = 0; E.run('drawLaneTut();');
  // 暂停
  E.tapRect(E.run('lPauseBtn()')); E.step(1);
  ok(E.run('state') === 'pause', '点暂停键：停');
  E.texts.length = 0; E.step(1);
  ok(E.texts.some(function (t) { return /跑了 \d+ 米/.test(t); }), '暂停页写着跑了多少米');
  E.run('resumeGame();'); E.step(1);
  ok(E.run('state') === 'play', '继续');
  // 主界面「新手教程」
  const F = makeEnv();
  F.run('meta.lTut = 1;'); F.step(3);
  F.tapRect(F.run('lReadyLayout().tut')); F.step(2);
  ok(F.run('state') === 'play' && F.run('lTut') === 0, '主界面「新手教程」：这一局从头教');
  // 画
  const G = makeEnv();
  G.step(2);
  G.texts.length = 0; G.step(1);
  ok(G.texts.length > 0 || G.ops.drawImage > 0, '主界面画得出来');
  play(G);
  put(G, 'jh', 1, 200); put(G, 'cab', 0, 300); put(G, 'board', 2, 400); put(G, 'water', 3, 500); put(G, 'candy', 1, 260);
  const d0 = G.ops.drawImage || 0;
  G.step(1);
  ok((G.ops.drawImage || 0) - d0 >= 8, '局里：走廊、人、嘉豪、三种障碍、糖都画（' + ((G.ops.drawImage || 0) - d0) + ' 张贴图）');
  ok(G.run('TEST.errs.length') === 0, '一路没报错', JSON.stringify(G.run('TEST.errs')));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
