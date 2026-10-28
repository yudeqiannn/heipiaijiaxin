/* 黑潮试玩（2.12 节）测试
   1) 主界面「黑潮 · 试玩」：直接开打（不放开场、不教学），身后一整片黑潮、前面摆好挡路的
   2) 黑潮往上涌：站着不动会被追上吞掉（死因"黑潮"、凶手圈红）；不给复活，测试数据记一笔
   3) 点「斩」：前面够得着的怪对准它砍，斩中攒怒气、马上能再斩；面前没有能打的 = 不出刀（斩键灰着），人照常走
   4) 按住不会自己接刀（平时没有连斩）
   5) 回头砍黑潮的边：斩一只、往回弹、没死；砍掉的会从后面补回来（砍不完）
   6) 怒气满了「连斩」：时间几乎停住，来回斩穿整片黑潮、回到原地，剩下的连同屏幕里挡路的全炸；前面马上冒出一串斩得上去的
   18) 分波按往上逃了多远：每 200 米一波，弹"第 N 波"、黑潮更快；放连斩不进下一波、也不让黑潮变慢
   7) 往上走：米数涨、前面接着摆挡路的；落到潮头后面的被黑潮吞掉；跨过世界边界照样连续
   8) 爆裂者炸到黑潮：圈里的一起死
   9) 画面：两种屏高下 局内 / 暂停 / 失败页 / 主界面都画得出来；主界面金刃不压开始键
   10) 黑潮几笔画完：几十只和几百只填色、描边次数一样
   13) 黑潮铺满身后：从潮头一直排到屏幕底边外，每列中间没有空当；潮头压近了屏幕里也照样铺满
   11) 退出：暂停里结束 / 失败页返回 → 主界面，正式玩法一点不受影响 */
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
  const ops = { fill: 0, stroke: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (k === 'fill' || k === 'stroke' || k === 'fillRect' || k === 'drawImage') return () => { ops[k] = (ops[k] || 0) + 1; };
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
  // 下面大多数场面要人站着不动、一开局就摆好：开场动画、自动往上跑先关掉，24) 单独测
  // 这一套测的是拖屏幕换方向 + 一个斩（两把斩在 test-blades.js）
  vm.runInContext('HD.intro = false; HD.preAd = false; HD.story = false; CFG.mainMode = "horde"; HD.tut = false; HD.autoRun = false; HD.lives = 1; HD.fillWait = 0; HD.heat0 = 1e9; HD.peakFrom = 1e9; PROP.on = false; HD.twoBlades = false; HD.path = false;', sb);   // 一条命：撞一下就死（三条命在 27) 单独测）；道具、嘉欣糖在 test-props.js 里测；路线（HD.path）在 test-path.js 里测；难度不涨（越来越难在 test-heat.js 里测）
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const f = raf; raf = null; if (!f) break; simT += 16.7; f(simT); } }
  let tid = 20;
  const down = (x, y) => { const id = ++tid; run('onTouchStart({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });'); return id; };
  const up = (id, x, y) => run('onTouchEnd({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tap = (x, y) => up(down(x, y), x, y);
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  const tapDash = () => tap(E0(run, 'DASH_BTN.x'), E0(run, 'DASH_BTN.y'));
  return { run, step, tap, tapRect, down, up, tapDash, ops };
}
function E0(run, s) { return run(s); }

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局黑潮：先把挡路的都清掉，场面由各项自己摆
function fresh(h) {
  const E = makeEnv(h);
  E.run('meta.tut = TUT_DONE; meta.runs = 5;'); E.step(5);
  E.tapRect(E.run('readyHordeBtn()'));
  return E;
}

console.log('1) 主界面进黑潮试玩');
{
  const E = makeEnv();
  E.run('meta.tut = 0;'); E.step(5);                      // 新玩家也不教
  ok(E.run('readyHordeOn()'), '竖屏：主界面有「黑潮 · 试玩」');
  E.tapRect(E.run('readyHordeBtn()'));
  ok(E.run('state') === 'play' && E.run('hordeMode') && E.run('talk') === null, '点它：直接开打，不放开场', E.run('state'));
  ok(!E.run('tutOn()') && E.run('meta.tut') === 0, '不教学，也不把存档记成教过了');
  ok(E.run('horde.length') >= E.run('HD.cols * HD.minRows') && E.run('hGap() > hBottomGap()'), '身后一整片黑潮：开局先在屏幕外', E.run('horde.length') + ' / ' + E.run('hGap()'));
  ok(Math.abs(E.run('(P.y - (cam.y - H / 2)) / H') - 0.58) < 0.02, '人在屏幕从上往下不到六成的地方（不在手指那儿，身后四成留给黑潮）', E.run('(P.y - (cam.y - H / 2)) / H').toFixed(3));
  ok(E.run('enemies.length') >= 2 && E.run('enemies.every(e => wdelta(e.y - P.y) < 0)'), '前面已经摆好挡路的', E.run('enemies.length'));
  ok(E.run('candies.length') === 0 && E.run('door') === null && E.run('crystals.length') === 0 && E.run('lightR()') > 2000, '没有糖 / 门 / 晶柱，全场都亮');
}

console.log('2) 站着不动：被黑潮追上');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 1e9;');
  const g0 = E.run('hGap()');
  E.step(60);
  ok(E.run('hGap()') < g0 - 100, '黑潮一直往上涌', g0 + ' → ' + E.run('hGap()'));
  for (let i = 0; i < 80 && E.run('state') === 'play'; i++) E.step(10);
  ok(E.run('state') === 'dead', '站着不动：被追上', E.run('state'));
  ok(E.run('runDeaths[0][0]') === '黑潮' && E.run('deathMark') && !E.run('deathMark.blast'), '死因"黑潮"，撞你的那只圈红');
  ok(!E.run('canRevive') && E.run('reviveT') === 0, '不给复活');
  ok(E.run('TEST.runs[0].hd') && E.run('TEST.runs[0].hd[1]') === 1, '测试数据记了一局（黑潮试玩 · 第 1 波）', JSON.stringify(E.run('TEST.runs[0].hd')));
  ok(/黑潮试玩 逃了 \d+ 米（第 1 波/.test(E.run('testReport().join("\\n")')), '报告里写着逃了几米、到第几波');
  E.step(10);
  ok(E.run('state') === 'dead', '不会自己跳去结算页');
}

console.log('3) 点「斩」');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0;');      // 黑潮先别追（这一项只看斩）
  E.run('enemies.length = 0; hNext = 1e9; spawnEnemy(P.x, P.y - 120, "grunt"); enemies[0].sp = 0;');
  E.tapDash();
  ok(E.run('P.dashT') > 0 && E.run('P.dashRef') === E.run('enemies[0]'), '前面够得着的怪：对准它砍（没推摇杆 = 往前）');
  E.step(15);
  ok(E.run('enemies.length') === 0 && E.run('hRage') === E.run('HD.rage.foe'), '斩中：怒气 +' + E.run('HD.rage.foe'), E.run('hRage'));
  ok(E.run('P.cd') === 0, '斩中了马上能斩下一刀');
  E.step(2);
  ok(E.run('hAimT') === null, '面前没有能打的：斩键灰着');
  const y0 = E.run('P.y'), n0 = E.run('dashSeq');
  E.tapDash();
  ok(E.run('P.dashT') === 0 && E.run('dashSeq') === n0, '点了不出刀（斩键本来就灰着，不再写"前面没有怪"）');
  E.step(12);
  ok(Math.abs(y0 - E.run('P.y')) < 5 && E.run('P.cd') === 0, '人没冲出去，也不用等冷却', (y0 - E.run('P.y')).toFixed(0));
  E.run('tMove.y = -1;'); E.step(20); E.run('tMove.y = 0;');
  ok(y0 - E.run('P.y') > 60, '推着摇杆照常往上走');
  // 推着摇杆往右：只砍右边的
  E.step(40);
  E.run('spawnEnemy(P.x + 120, P.y, "grunt"); spawnEnemy(P.x, P.y - 100, "grunt"); enemies.forEach(e => e.sp = 0); tMove.x = 1; tMove.y = 0;');
  E.tapDash();
  ok(E.run('P.dashRef') === E.run('enemies[0]'), '推着摇杆：往推的方向砍');
  E.run('tMove.x = 0;');
}

console.log('4) 按住不会自己接刀');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0;');
  E.run('enemies.length = 0; hNext = 1e9; for (let i = 1; i <= 5; i++) spawnEnemy(P.x, P.y - 90 * i, "grunt"); enemies.forEach(e => e.sp = 0);');
  const id = E.down(E.run('DASH_BTN.x'), E.run('DASH_BTN.y'));
  const n0 = E.run('dashSeq');
  E.step(60);
  // 按下去那一刀锁够得着的最远那只（范围 315：270 那只，用户："优先斩前面最远的"），路上 90、180 两只顺手斩掉
  ok(E.run('dashSeq') === n0 && E.run('enemies.length') === 2, '按住一秒：只斩了按下去的那一刀（锁 270 那只，路上 90、180 顺手斩了）', (E.run('dashSeq') - n0) + ' / ' + E.run('enemies.length'));
  E.up(id, 0, 0);
  for (let i = 0; i < 4; i++) { E.tapDash(); E.step(14); }
  ok(E.run('enemies.length') === 0, '一下一下点：一刀接一刀斩上去', E.run('enemies.length'));
}

console.log('5) 回头砍黑潮的边');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 1e9; hFront = wwrap(P.y + 130); hV = 0; HD.v0 = 0; HD.vRamp = 0; HD.lunge = 0;');
  E.step(1);
  E.run('tMove.x = 0; tMove.y = 1;');
  const k0 = E.run('runKills');
  E.run('var hKill0 = hKill, killC = []; hKill = function (i, how) { killC.push(horde[i].c); return hKill0(i, how); };');
  E.tapDash();
  ok(E.run('P.dashT') > 0 && E.run('horde.indexOf(P.dashRef) >= 0'), '推着摇杆往下：对准黑潮最前面那只砍（黑潮的边不按"最远"锁）');
  E.run('tMove.y = 0;');
  let up = false;
  for (let i = 0; i < 20; i++) { E.step(1); if (E.run('P.vy') < -300) up = true; }
  ok(E.run('state') === 'play' && E.run('runKills') > k0, '斩掉了，人没死', E.run('runKills') - k0);
  ok(E.run('killC.length') <= 3, '只斩了边上几只（不会一刀连穿一串；黑潮随机摆，挨着的偶尔一下碰到 3 只）', E.run('killC.length'));
  const col = E.run('killC[0]');
  E.run('hKill = hKill0;');
  ok(up, '斩完往回弹（往上）');
  ok(E.run('hRage') >= E.run('HD.rage.horde'), '斩黑潮的边：攒怒气', E.run('hRage'));
  E.step(30);
  const fr = E.run('Math.min(...horde.filter(m => m.c === ' + col + ').map(m => m.yb))');
  const deep = E.run('Math.max(...horde.filter(m => m.c === ' + col + ').map(m => hMemberY(m))) - (cam.y + H / 2)');
  ok(fr < 30 && deep > 0, '砍掉的那一列：后面的补上来，照样一直排到屏幕底边外（砍不完）', fr.toFixed(0) + ' / ' + deep.toFixed(0));
}

console.log('6) 回头连斩');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 1e9;');
  const bb = E.run('hBurstBtn()');
  E.tap(bb.x, bb.y);
  ok(E.run('hBurst') === null, '怒气没满：「连斩」点了没用');
  E.run('hFront = wwrap(P.y + 260); hRage = 100;');
  E.run('for (const q of [[-200, -500], [150, -700], [0, -880]]) { const e = spawnEnemy(P.x + q[0], wwrap(P.y + q[1]), "grunt"); e.sp = 0; e.born = 1; }');
  E.step(1);
  const x0 = E.run('P.x'), y0 = E.run('P.y'), g0 = E.run('gameTime'), n0 = E.run('horde.length'), e0 = E.run('enemies.length');
  var olds = E.run('var _olds = enemies.slice(); _olds.length');
  E.tap(bb.x, bb.y);
  ok(E.run('hBurst') !== null && E.run('hRage') === 0, '满了：点「连斩」放出来，怒气清零');
  let done = false, maxDown = 0, k = 0;
  for (; k < 200; k++) {
    E.step(1);
    maxDown = Math.max(maxDown, E.run('wdelta(P.y - ' + y0 + ')'));
    if (E.run('hBurst') === null) { done = true; break; }
  }
  ok(done && k * 16.7 < 2500, '两秒多以内斩完', (k * 16.7).toFixed(0) + 'ms');
  ok(maxDown > 300, '回头冲进黑潮里来回斩', maxDown.toFixed(0));
  ok(Math.abs(E.run('P.x') - x0) < 6 && Math.abs(E.run('wdelta(P.y - ' + y0 + ')')) < 6, '斩完回到原地');
  ok(E.run('gameTime') - g0 < 0.4, '斩的时候别的东西几乎停住', (E.run('gameTime') - g0).toFixed(2));
  ok(E.run('hBestBurst') === n0 + e0 && E.run('state') === 'play', '清全屏：整片黑潮 ' + n0 + ' 只 + 屏幕里挡路的 ' + e0 + ' 只全斩光，人没事', E.run('hBestBurst'));
  ok(E.run('_olds.every(e => enemies.indexOf(e) < 0)'), '原来屏幕里挡路的一只不剩');
  ok(E.run('hWave') === 1 && E.run('horde.length') > 0 && E.run('hGap() > hBottomGap()'), '放连斩不进下一波；身后的黑潮从屏幕外重新涌上来，不是一下贴到屏幕里', E.run('hWave') + ' / ' + E.run('hGap()'));
  const near0 = E.run('Math.min(...enemies.map(e => Math.hypot(e.x - P.x, wdelta(e.y - P.y))))');
  ok(near0 >= 260, '清屏后冒出来最近的那只离你 ' + Math.round(near0) + '（用户：最近的那只容易直接撞上主角）', near0);
  E.run('P.inv = 0;');
  E.step(90);
  ok(E.run('state') === 'play', '站着不动一秒半：它不会自己扑过来撞死你');
  E.run('P.inv = 1e9; tMove.y = -1;'); E.step(15); E.run('tMove.y = 0;');
  ok(E.run('!!hAimT') && E.run('enemies.length') >= E.run('HD.refillN'), '往前推一下就够得着：一串斩得上去的（连斩接着斩，不白斩）', E.run('enemies.length'));
  const combo1 = E.run('combo');
  E.run('P.inv = 1e9;');
  for (let i = 0; i < 150; i++) { if (E.run('P.cd <= 0 && P.dashT <= 0 && !!hAimT')) E.tapDash(); E.step(1); }
  ok(E.run('combo') >= combo1 + 5, '一刀接一刀斩上去，连斩没断（×' + combo1 + ' → ×' + E.run('combo') + '）', E.run('combo'));
  const combo0 = E.run('bestCombo');
  // 喘口气：站着不动，头三秒黑潮都还没进屏幕；之后几秒内涌上来
  E.run('P.inv = 1e9; enemies.length = 0; hNext = 1e9; hNewWave();');
  let seen = -1;
  for (let i = 0; i < 480 && seen < 0; i++) { E.step(1); if (E.run('P.y + hGap() < cam.y + H / 2')) seen = i * 16.7; }
  ok(seen > 3000, '清完一波，站着不动也有三秒多喘口气（' + (seen / 1000).toFixed(1) + ' 秒后黑潮才进屏幕）', seen);
  ok(seen > 0 && seen < 6500, '之后黑潮涌回屏幕里', seen);
  ok(combo0 >= n0, '连斩数一路涨上去', combo0);
}

console.log('7) 往上走');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 300; P.inv = 1e9; hWaveT = 10; hFront = wwrap(P.y + 500);');
  E.run('tMove.x = 0; tMove.y = -1;');
  E.step(120);
  E.run('tMove.y = 0;');
  ok(E.run('Math.floor(hTop / HD.m)') > 10, '米数涨了', E.run('Math.floor(hTop / HD.m)'));
  ok(E.run('hNext') > 600 && E.run('enemies.length') > 0, '前面接着摆挡路的', E.run('hNext') + ' / ' + E.run('enemies.length'));
  ok(E.run('hGap()') < 1000, '满速跑也甩不掉黑潮', E.run('hGap()'));
  E.run('var _e = spawnEnemy(P.x, wwrap(hFront + HD.gap * HD.inkEdge + 80), "grunt");');
  ok(E.run('enemies.indexOf(_e) >= 0'), '（在墨里摆一只）');
  E.step(1);
  ok(E.run('enemies.indexOf(_e) < 0'), '落到潮头后面的：被黑潮吞掉');
  // 跨世界边界：潮头离你多远是连续的
  E.run('P.y = 60; P.py = 60; cam.y = P.y - HD.camY * H; hFront = wwrap(P.y + 300); tMove.y = -1;');
  let jump = 0, gp = E.run('hGap()');
  for (let i = 0; i < 30; i++) { E.step(1); const g = E.run('hGap()'); jump = Math.max(jump, Math.abs(g - gp)); gp = g; }
  ok(jump < 60 && E.run('P.y') > 4000, '跨过世界边界：黑潮照样跟着，不跳', jump.toFixed(1));
  E.run('tMove.y = 0;');
}

console.log('8) 爆裂者炸到黑潮');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 1e9; P.inv = 1e9; hFront = wwrap(P.y + 300);');
  E.step(1);
  const n0 = E.run('horde.length');
  E.run('explodeBlast({ x: P.x, y: wwrap(hFront + 20), t: 0, fuse: 0, r: CFG.bombR, safe: true });');
  ok(E.run('horde.length') < n0 - 3 && E.run('hRage') > 0, '圈里的一起死，也攒怒气', n0 + ' → ' + E.run('horde.length'));
}

console.log('9) 画面');
for (const h of [844, 667]) {
  const E = fresh(h);
  let err = null;
  try {
    E.step(30); E.run('render();');
    E.run('hRage = 100; hFront = wwrap(P.y + 300);'); E.step(2); E.run('render();');
    E.run('hBurstGo();'); E.step(6); E.run('render();');
    for (let i = 0; i < 300 && E.run('hBurst'); i++) E.step(1);
    E.run('render(); pauseGame(); render(); resumeGame();');
    E.run('P.inv = 0; hFront = wwrap(P.y + 10);'); E.step(3); E.step(60); E.run('render();');
  } catch (e) { err = e; }
  ok(!err && E.run('state') === 'dead', h + 'px：局内 / 回头连斩 / 暂停 / 失败页都画得出来', err && err.message);
  E.step(20);
  E.tapRect(E.run('hordeEndBtns().skip')); E.step(20);     // 复活页「不用了」→ 排名页（没升级没宝箱）
  E.tapRect(E.run('hordeEndBtns().go'));
  ok(E.run('state') === 'play' && E.run('hordeMode') && E.run('hWave') === 1, h + 'px：失败页「再来一局」：重新开一局黑潮');
  E.run('P.inv = 0; shield = 0; die("黑潮");'); E.step(60);
  E.tapRect(E.run('hordeEndBtns().skip')); E.step(20);
  E.tapRect(E.run('hordeEndBtns().back'));
  ok(E.run('state') === 'ready' && !E.run('hordeMode') && E.run('horde.length') === 0, h + 'px：「返回主界面」');
  try { E.run('render();'); } catch (e) { err = e; }
  const hb = E.run('readyHordeBtn()'), gb = E.run('readyGuideBtn()');
  ok(!err && hb.y + hb.h <= gb.y, h + 'px：主界面画得出来，金刃在「玩法说明」上面', err && err.message);
}

console.log('10) 黑潮几笔画完');
{
  const E = fresh();
  E.run('hFront = wwrap(P.y + 700); hWaveT = 0;'); E.step(1);
  const count = () => { E.ops.fill = 0; E.ops.stroke = 0; E.ops.fillRect = 0; E.run('drawHorde(); drawHordeInk();'); return E.ops.fill + E.ops.stroke + E.ops.fillRect; };
  const n1 = E.run('horde.length'), a = count();
  E.run('hFront = wwrap(P.y + 60);'); E.step(1);
  const n = E.run('horde.length'), b = count();
  ok(n > 2 * n1 && a <= b && b <= 9, n1 + ' 只和 ' + n + ' 只：最多 ' + b + ' 笔', a + ' / ' + b);
}

console.log('11) 退出以后正式玩法不受影响');
{
  const E = fresh();
  E.step(30);
  E.run('pauseGame();');
  E.tapRect(E.run('pauseLayout().end'));
  ok(E.run('state') === 'ready' && !E.run('hordeMode'), '暂停里「结束本局」：回主界面', E.run('state'));
  ok(E.run('TEST.runs[0].hd') && E.run('TEST.runs[0].die[0][0]') === '主动结束', '这一局也记进测试数据');
  E.run('meta.depthBest = 0; CFG.mainMode = "classic";');
  E.tap(195, 300);
  ok(E.run('state') === 'talk', '（主玩法切回正式玩法时）正式开局照旧放开场');
  E.tapRect(E.run('talkSkipBtn()'));
  ok(E.run('state') === 'play' && !E.run('hordeMode') && E.run('lightR()') === E.run('reach()') && E.run('candies.length') > 0, '正式玩法：光、糖照旧');
  E.step(30);
  ok(E.run('horde.length') === 0 && E.run('layerFeat()') === null && E.run('layer') === 1, '没有黑潮');
}


console.log('12) 走得慢一些 + 辅助瞄准（用户：移动速度太快、瞄准不便）');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 1e9; P.inv = 1e9; hWaveT = 10; HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0; hFront = wwrap(P.y + hGapMax());');
  E.run('tMove.x = 0; tMove.y = -1;');
  E.step(60);
  const v = E.run('Math.hypot(P.vx, P.vy)');
  ok(v <= E.run('HD.walk') + 1 && v > E.run('HD.walk') - 10, '推满摇杆一直走：稳在 ' + E.run('HD.walk') + '（以前实际 624）', v.toFixed(0));
  E.run('P.vx = 0; P.vy = -700;');      // 空挥收刀的余速
  E.step(30);
  ok(Math.hypot(E.run('P.vx'), E.run('P.vy')) <= E.run('HD.walk') + 1, '收刀滑行推着摇杆也会慢下来（不再一直滑在 1.45 倍）', Math.hypot(E.run('P.vx'), E.run('P.vy')).toFixed(0));
  E.run('tMove.y = 0; P.vx = 0; P.vy = 0;');
  E.step(30);
  // 斜前方 60°、210 远：以前锁不上（45° / 175），现在锁得上、也砍得到
  E.run('enemies.length = 0; spawnEnemy(P.x + Math.sin(1.05) * 210, P.y - Math.cos(1.05) * 210, "grunt"); enemies[0].sp = 0; enemies[0].born = 1;');
  ok(E.run('!!hLock({ x: 0, y: -1 })'), '斜前方 60°、210 远的怪：锁得上');
  E.tapDash();
  E.step(20);
  ok(E.run('enemies.length') === 0, '点一下就砍到了', E.run('enemies.length'));
  // 斜前方 60° 以内锁得上；正侧面（80°）、身后的不锁 —— 得把摇杆往那边推
  E.step(40);
  E.run('enemies.length = 0; spawnEnemy(P.x - 100, P.y - 60, "grunt"); spawnEnemy(P.x + 30, P.y + 90, "grunt"); spawnEnemy(P.x + 120, P.y - 20, "grunt"); enemies.forEach(e => { e.sp = 0; e.born = 1; }); tMove.x = 0; tMove.y = -1;');
  ok(E.run('hLock(inputDir()) && hLock(inputDir()).ref === enemies[0]'), '往上推着：斜前方 60° 那只锁得上');
  E.run('enemies.splice(0, 1);');
  ok(E.run('hLock(inputDir())') === null, '正侧面 80° 的不锁（得把摇杆往它那边推）');
  E.run('tMove.x = 1; tMove.y = 0;');
  ok(E.run('hLock(inputDir()) && hLock(inputDir()).ref === enemies[1]'), '往右推：锁上右边那只');
  E.run('enemies.splice(1, 1); tMove.x = 0; tMove.y = -1;');
  E.run('enemies.splice(0, 1);');
  ok(E.run('hLock(inputDir())') === null, '身后的不锁（斩是往前闪，不往回送）');
  E.run('tMove.y = 0;');
  // 黑潮在身后够得着，但往上推着：不会回头扎进黑潮
  E.run('enemies.length = 0; hFront = wwrap(P.y + 120); hV = 0; HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0; tMove.y = -1;');
  E.step(1);
  ok(E.run('hLock(inputDir())') === null, '往上推着：身后的黑潮不算（不会被拽回去）');
  E.run('tMove.y = 0; hFront = wwrap(P.y + 1200);'); E.step(30);
  // 横着跑的怪：冲的路上跟着它拐，照样砍到
  E.run('enemies.length = 0; spawnEnemy(P.x + 40, P.y - 200, "grunt"); enemies[0].born = 1; enemies[0].sp = 0; P.cd = 0;');
  E.tapDash();
  let hit = false;
  for (let i = 0; i < 25 && !hit; i++) { E.run('if (enemies[0]) enemies[0].x += 9;'); E.step(1); hit = E.run('enemies.length') === 0; }
  ok(hit, '横着跑的怪：冲的路上跟着拐，照样砍到');
  E.run('P.vx = 0; P.vy = 0;'); E.step(30);
  // 面前没怪：不出刀
  E.run('enemies.length = 0; P.cd = 0;'); E.step(1);
  const y0 = E.run('P.y');
  E.tapDash(); E.step(14);
  ok(Math.abs(y0 - E.run('P.y')) < 5 && E.run('hAimExtra') === -1, '面前没怪：不出刀');
  // 画面：瞄准线
  E.run('spawnEnemy(P.x + 60, P.y - 180, "bomb"); enemies[0].sp = 0; enemies[0].born = 1; P.cd = 0;'); E.step(2);
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '瞄准线 + 准星画得出来', err && err.message);
}


console.log('13) 黑潮铺满身后');
for (const h of [844, 667]) {
  const E = fresh(h);
  E.run('enemies.length = 0; hNext = 1e9; P.inv = 1e9; hWaveT = 10;');
  for (const g of [420, 120]) {
    E.run('hFront = wwrap(P.y + ' + g + '); HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0; HD.farK = 0;'); E.step(40);
    const bottom = E.run('cam.y + H / 2'), fy = E.run('P.y + hGap()');
    // 每列：从潮头到屏幕底边，前后两只之间不超过一排半
    const holes = E.run(`(function () {
      let bad = 0, short = 0;
      for (let c = 0; c < HD.cols; c++) {
        const ys = horde.filter(m => m.c === c).map(m => hMemberY(m)).sort((a, b) => a - b);
        if (!ys.length || ys[ys.length - 1] < cam.y + H / 2) short++;
        for (let k = 2; k < ys.length; k++) if (ys[k] - ys[k - 1] > HD.gap * 1.5) bad++;   // 最前面那只会扑出来，不算空当
      }
      return [bad, short];
    })()`);
    const n = E.run('horde.length');
    ok(holes[0] === 0 && holes[1] === 0 && n > 13 * (bottom - fy) / 34 - 13, h + 'px · 潮头在身后 ' + g + '：从潮头一直排到屏幕底边外、没有空当（' + n + ' 只）', JSON.stringify(holes));
  }
  E.run('hFront = wwrap(P.y + 2000);'); E.step(2);
  ok(E.run('hGap() <= hGapMax() + 1 && hGap() > hBottomGap()'), h + 'px · 甩得再开，最远也就屏幕底边外 ' + E.run('HD.offMax') + '（被你拖着走）', E.run('hGap()'));
  E.run('HD.v0 = 390; hWaveT = 10;');
  let back = -1;
  for (let i = 0; i < 180 && back < 0; i++) { E.step(1); if (E.run('hGap() < hBottomGap()')) back = i * 16.7; }
  ok(back > 0 && back < 1500, h + 'px · 一停下来：' + (back / 1000).toFixed(1) + ' 秒就涌回屏幕里', back);
  const n2 = E.run('horde.length');
  E.step(5);
  ok(E.run('horde.length') <= n2 + 13 && E.run('horde.length') < 26 * 13, h + 'px · 只养屏幕里看得见的那一截', E.run('horde.length'));
}


console.log('14) 斩 = 闪现：光走会被慢慢追上，一直斩才拉得开（最远甩出屏幕一点，一停就涌回来）');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 1e9; P.inv = 1e9; hWaveT = 10; hFront = wwrap(P.y + hBottomGap() - 200);');
  E.run('tMove.x = 0; tMove.y = -1;');
  const g0 = E.run('hGap()');
  E.step(180);
  const g1 = E.run('hGap()');
  ok(g1 < g0 - 40 && E.run('hV') > E.run('HD.walk'), '推满摇杆走 3 秒：黑潮比走路快，慢慢追上来', g0.toFixed(0) + ' → ' + g1.toFixed(0));
  // 一路斩上去：前面每隔 200 摆一只（先把黑潮放回身后 250，免得一开始就贴在身上）
  E.run('hFront = wwrap(P.y + 250); HD.lunge = 0;');
  const g1b = E.run('hGap()');
  E.run('for (let k = 1; k <= 12; k++) { const e = spawnEnemy(P.x + (k % 2 ? 40 : -40), P.y - 200 * k, "grunt"); e.sp = 0; e.born = 1; }');
  let g2 = 0, gEnd = 0;
  for (let i = 0; i < 240; i++) { if (E.run('P.cd <= 0 && P.dashT <= 0 && !!hAimT')) E.tapDash(); E.step(1); g2 = Math.max(g2, E.run('hGap()')); }
  ok(g2 > g1b + 100, '一路斩上去：拉开了', g1b.toFixed(0) + ' → ' + g2.toFixed(0));
  ok(g2 <= E.run('hGapMax()') + 1, '但最远也就屏幕底边外 ' + E.run('HD.offMax'), g2.toFixed(0));
  gEnd = E.run('hGap()');
  E.step(120);
  ok(E.run('hGap()') < gEnd - 30, '斩完了光走：又慢慢追上来', gEnd.toFixed(0) + ' → ' + E.run('hGap()').toFixed(0));
  E.run('tMove.y = 0;');
}


console.log('15) 连斩断得慢一些（用户：连斩的判定时间要延长一点）');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0; enemies.length = 0; hNext = 1e9; P.inv = 1e9;');
  ok(E.run('POW.comboWindow') === E.run('HD.comboWindow') && E.run('HD.comboWindow') > E.run('CFG.comboWindow'), '黑潮试玩：' + E.run('HD.comboWindow') + ' 秒不斩才断（正式玩法 ' + E.run('CFG.comboWindow') + '）');
  E.run('spawnEnemy(P.x, P.y - 120, "grunt"); enemies[0].sp = 0; enemies[0].born = 1;');
  E.tapDash(); E.step(15);
  ok(E.run('combo') === 1, '斩了一只：连斩 ×1');
  E.step(Math.round(2.0 / 0.0167));
  E.run('spawnEnemy(P.x, P.y - 120, "grunt"); enemies[0].sp = 0; enemies[0].born = 1;');
  E.tapDash(); E.step(15);
  ok(E.run('combo') === 2, '隔 2 秒再斩一只：连斩接上 ×2（以前 1.4 秒就断了）', E.run('combo'));
  E.run('toReady(); start();');
  ok(E.run('POW.comboWindow') === E.run('CFG.comboWindow'), '回到正式玩法：照旧 ' + E.run('CFG.comboWindow') + ' 秒');
}


console.log('16) 墨潮盖在怪上面（用户：墨潮的边缘遮挡不到后面追逐的怪物）');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0; hWaveT = 10; hFront = wwrap(P.y + 300); P.inv = 1e9;'); E.step(5);
  E.run(`var _order = []; var _dh = drawHorde, _de = drawEnemies, _di = drawHordeInk, _dp = drawPlayer;
         drawHorde = function () { _order.push('前排'); _dh(); }; drawEnemies = function () { _order.push('挡路'); _de(); };
         drawHordeInk = function () { _order.push('墨'); _di(); }; drawPlayer = function () { _order.push('人'); _dp(); }; render();`);
  ok(E.run('_order.join(",")') === '前排,挡路,墨,人', '先画黑潮前排、挡路的，再盖墨，人画在最上面', E.run('_order.join(",")'));
  // 挡路的掉进墨里：整只没进去就被吞，在墨边上的还在（被墨盖住一截）
  E.run('enemies.length = 0; var _a = spawnEnemy(P.x, wwrap(hFront + HD.gap * HD.inkEdge + 10), "grunt"); _a.sp = 0; var _b = spawnEnemy(P.x + 100, wwrap(hFront + HD.gap * HD.inkEdge + 90), "grunt"); _b.sp = 0;');
  E.step(1);
  ok(E.run('enemies.indexOf(_a) >= 0 && enemies.indexOf(_b) < 0'), '挡路的掉到墨边：还在（被盖住半截）；整只没进墨里：被吞');
}


console.log('17) 黑潮被甩出屏幕：什么都不提示，慢慢追上来');
{
  const E = fresh();
  E.run('HD.vRamp = 0; HD.vWave = 0; hWaveT = 10; P.inv = 1e9; enemies.length = 0; hNext = 1e9;');
  E.run('var _txt = []; ctx.fillText = function (t) { _txt.push(String(t)); }; ctx.strokeText = function (t) { _txt.push(String(t)); };');
  E.run('for (const k in TXC) delete TXC[k]; hFront = wwrap(P.y + hBottomGap() + 300);'); E.step(1);
  E.ops.fillRect = 0;
  E.run('render();');
  ok(E.run('_txt.every(t => t.indexOf("黑潮还有") < 0)') && E.run('typeof drawHordeChase') === 'undefined', '不写几米、底边不冒墨也不压红光');
  // 走着：从最远处约两秒涌回屏幕；站着：一秒多
  for (const walk of [true, false]) {
    E.run('hFront = wwrap(P.y + hGapMax()); tMove.x = 0; tMove.y = ' + (walk ? -1 : 0) + '; P.vx = 0; P.vy = ' + (walk ? -320 : 0) + ';');
    let back = -1;
    for (let i = 0; i < 300 && back < 0; i++) { E.step(1); if (E.run('hGap() < hBottomGap()')) back = i * 16.7; }
    ok(back > (walk ? 1200 : 700) && back < (walk ? 3500 : 2200), (walk ? '走着' : '站着') + '：' + (back / 1000).toFixed(1) + ' 秒慢慢涌回屏幕', back);
  }
  E.run('tMove.y = 0;');
}


console.log('18) 分波按往上逃了多远（放不放连斩都一样往前推）');
{
  const E = fresh();
  E.run('enemies.length = 0; hNext = 1e9; P.inv = 1e9;');
  const v1 = E.run('HD.v0 + HD.vWave * (hWave - 1)');
  E.run('hClimb = hTop = HD.waveM * HD.m - 5; banners.length = 0; tMove.y = -1;'); E.step(10); E.run('tMove.y = 0;');
  ok(E.run('hWave') === 2 && E.run('banners.length') === 0, '逃过 ' + E.run('HD.waveM') + ' 米：第 2 波（不弹"更快了"的横幅）');
  E.run('hWaveT = 10;'); E.step(1);
  ok(E.run('hV') >= v1 + E.run('HD.vWave') - 1, '黑潮快了 ' + E.run('HD.vWave'), E.run('hV'));
  E.run('hRage = 100; hFront = wwrap(P.y + 260);'); E.step(1);
  E.run('hBurstGo();');
  for (let i = 0; i < 300 && E.run('hBurst'); i++) E.step(1);
  E.run('hWaveT = 10;'); E.step(1);
  ok(E.run('hWave') === 2 && E.run('hV') >= v1 + E.run('HD.vWave') - 1, '放了连斩：还是第 2 波，黑潮不会变慢', E.run('hWave') + ' / ' + E.run('hV'));
}


console.log('19) 掉帧（1024.1253 真机：墨潮贴近时一帧 7 毫秒、分数 4 毫秒、飘字 2~4 毫秒）');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; enemies.length = 0; hNext = 1e9; P.inv = 1e9; hWaveT = 10; hFront = wwrap(P.y + 40);'); E.step(3);
  E.ops.fill = 0; E.ops.stroke = 0; E.ops.fillRect = 0; E.ops.drawImage = 0;
  E.run('var _ga = 0; var _gaSet = Object.getOwnPropertyDescriptor(ctx, "globalAlpha"); drawHordeInk();');
  ok(E.ops.drawImage <= 4 && E.ops.fillRect === 0 && E.ops.fill === 1 && E.ops.stroke === 2,
     '黑潮贴到身后：墨潮一笔填、两笔描、眼睛每块一张（不叠半透明、不压全宽的黑）', JSON.stringify(E.ops));
  E.run('spawnEnemy(P.x, P.y - 120, "grunt"); enemies[0].sp = 0; enemies[0].born = 1; floats.length = 0;');
  E.tapDash(); E.step(15);
  ok(E.run('enemies.length') === 0 && E.run('floats.filter(f => !f.pop).length') === 0, '斩挡路的：不冒"+N"');
  E.run('for (let i = 0; i < 8; i++) { const e = spawnEnemy(P.x + (i - 4) * 60, P.y - 300 - i * 40, i % 3 ? "grunt" : "bomb"); e.sp = 0; e.born = 1; } hRage = 100; hFront = wwrap(P.y + 260);');
  E.step(1);
  E.run('var _hit = 0; var _sh = S.hit; S.hit = function () { _hit++; return _sh.apply(S, arguments); };');
  E.run('hBurstGo();');
  for (let i = 0; i < 300 && E.run('hBurst'); i++) E.step(1);
  // 往上跑每秒要现画几块地面：一块地面十几笔（以前碎片一片三笔，一块一百多笔）
  E.ops.fill = 0; E.ops.stroke = 0; E.ops.fillRect = 0;
  E.run('drawGround(900, 900, BG.T || 450, BG.T || 450, GROUNDS[0]);');
  const gOps = E.ops.fill + E.ops.stroke + E.ops.fillRect;
  ok(gOps <= 12, '现画一块地面：' + gOps + ' 笔', gOps);
  ok(E.run('blasts.length') === 0 && E.run('_hit') <= 40, '清全屏斩掉的挡路怪：不一只只放斩击声、爆裂者不留引信（斩击声 ' + E.run('_hit') + ' 次）', E.run('_hit'));
}


console.log('19b) 黑潮进了屏幕（用户："黑潮一旦进入视野就很明显掉帧"）：墨下面的地面不画、眼睛图不透明铺满');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; enemies.length = 0; hNext = 1e9; P.inv = 1e9; hWaveT = 10; hFront = wwrap(P.y + 150);'); E.step(3);
  // 录下这一笔笔贴图贴在世界里哪儿（drawImage 的目标框，5 个 / 9 个参数两种写法）
  const rects = code => E.run('(function () { var R = [], c0 = ctx; ctx = new Proxy(c0, { get: function (t, k) { if (k === "drawImage") return function () { var a = arguments, n = a.length; R.push(n >= 9 ? [a[5], a[6], a[7], a[8]] : [a[1], a[2], a[3], a[4]]); }; var v = t[k]; return typeof v === "function" ? v.bind(t) : v; }, set: function (t, k, v) { t[k] = v; return true; } }); try { ' + code + ' } finally { ctx = c0; } return JSON.stringify(R); })()');
  const cut = E.run('hInkSolid()'), vy = E.run('cam.y - H / 2'), vb = E.run('cam.y + H / 2');
  ok(cut > vy && cut < vb - 100 && Math.abs(cut - E.run('P.y + hGap() + HD.gap * HD.inkEdge + HD.inkSolid')) < 1e-6, '潮面往下 inkSolid 起整片是墨（在屏幕里）', cut.toFixed(0) + ' / ' + vy.toFixed(0) + '~' + vb.toFixed(0));
  // 潮面最深起伏：猛涌时也不会比 inkSolid 更深（不然不透明的图会把潮面的凹处盖平）
  let deep = -1e9;
  for (const sg of [0, 1, 2]) { E.run('hSurge = ' + sg + ';'); for (let x = -400; x <= 400; x += 7) for (let t = 0; t < 12; t += 0.37) deep = Math.max(deep, E.run('hInkEdge(hX0 + ' + x + ', ' + t + ')')); }
  E.run('hSurge = 0;');
  ok(deep < E.run('HD.gap * HD.inkEdge + HD.inkSolid') - 0.5, '潮面最深 ' + deep.toFixed(1) + '：比整片墨开始的地方浅', deep);
  const bg = JSON.parse(rects('drawBackground();'));
  const bgBot = Math.max(...bg.map(r => r[1] + r[3])), bgTop = Math.min(...bg.map(r => r[1]));
  ok(bg.length > 0 && bgBot <= cut + 1 && bgBot >= cut - 0.01 && bgTop <= vy, '地面只贴到墨开始的地方（' + bgBot.toFixed(0) + '），下面不画', bgTop.toFixed(0) + '~' + bgBot.toFixed(0) + ' / ' + cut.toFixed(0));
  const ink = JSON.parse(rects('drawHordeInk();'));
  let gapOk = true;
  for (let i = 1; i < ink.length; i++) if (ink[i][1] > ink[i - 1][1] + ink[i - 1][3]) gapOk = false;
  const xl = E.run('cam.x - W / 2'), xr = E.run('cam.x + W / 2');
  ok(ink.length >= 1 && Math.abs(ink[0][1] - cut) < 1e-6 && ink[ink.length - 1][1] + ink[ink.length - 1][3] >= vb && gapOk &&
     ink.every(r => r[0] <= xl - 11 && r[0] + r[2] >= xr + 11),
     '眼睛图从墨开始的地方一块接一块铺到屏幕底，左右各宽出一截（晃、抖屏都露不出底）', JSON.stringify(ink.map(r => r.map(v => Math.round(v)))));
  ok(/^rgb\(/.test(E.run('HD.inkTileC')) && E.run('!!hEyeTile(0)'), '眼睛图连墨底一起烤（不透明的颜色）');
  ok(E.run('hInkFrac') > 0.2, '这一帧记下墨盖了屏幕几成（测试数据分开记帧数）', E.run('hInkFrac'));
  // 黑潮在屏幕外：地面整屏照贴
  E.run('hFront = wwrap(P.y + hGapMax());'); E.step(1);
  const bg2 = JSON.parse(rects('drawBackground();'));
  ok(E.run('hInkSolid()') > vb && Math.max(...bg2.map(r => r[1] + r[3])) >= E.run('cam.y + H / 2'), '黑潮不在屏幕里：地面整屏照贴');
  E.run('drawHordeInk();');
  ok(E.run('hInkFrac') === 0, '墨不在屏幕里：记 0');
  // 测试数据：在 / 不在 分开记
  E.run('hFront = wwrap(P.y + 150);'); E.step(30);
  E.run('P.inv = 0; die("黑潮");'); E.step(120);
  const r = E.run('TEST.runs[0] && TEST.runs[0].ink');
  ok(r && r[0][0] >= 0 && r[0][1] > 0 && r.length === 2 && E.run('testReport().some(function (l) { return l.indexOf("黑潮在屏幕里") === 0; })'), '测试数据：黑潮在屏幕里 / 不在 各记帧数、卡顿、画面和声音毫秒', JSON.stringify(r));
}
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE; meta.runs = 5;'); E.step(5);
  ok(E.run('hInkSolid()') === Infinity && !E.run('TEST.runs.length || false'), '正式玩法：地面不切');
}

console.log('20) 黑潮落在后面很远：屏幕顶上新摆的怪不会被当成"被吞了"删掉（用户：连斩之后往前走还是有一大片无怪区）');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; P.inv = 1e9; enemies.length = 0; hWaveT = 10; hFront = wwrap(P.y + hGapMax());');
  E.run('hBlock(cam.y - H / 2 - 70); var _top = enemies.slice();');
  ok(E.run('_top.length') > 0, '（屏幕顶上摆了一组：离身后的潮头 ' + Math.round(E.run('hGapMax() + 0.7 * H + 70')) + '，超过半圈世界 ' + E.run('WORLD / 2') + '）');
  E.step(2);
  ok(E.run('_top.every(e => enemies.indexOf(e) >= 0)'), '还在，没被删');
  // 连斩完一路往上冲：前面屏幕里一直有怪
  E.run('HD.v0 = 390; HD.catchK = 0.8; hRage = 100; hFront = wwrap(P.y + 260); enemies.length = 0; hNext = hTop + 200;'); E.step(1);
  E.run('hBurstGo();');
  for (let i = 0; i < 300 && E.run('hBurst'); i++) E.step(1);
  let empty = 0, worst = 0;
  E.run('tMove.y = -1;');
  for (let i = 0; i < 360; i++) {
    if (E.run('P.cd <= 0 && P.dashT <= 0 && !!hAimT')) E.tapDash();
    E.step(1);
    const n = E.run('enemies.filter(e => { const y = wdelta(e.y - P.y); return y < 0 && y > -(0.7 * H); }).length');
    if (n === 0) empty++; else empty = 0;
    worst = Math.max(worst, empty);
  }
  E.run('tMove.y = 0;');
  ok(worst * 16.7 < 500, '连斩完一路往上斩 6 秒：前面屏幕里没怪的时候最长 ' + Math.round(worst * 16.7) + ' 毫秒', worst);
}


console.log('21) 按新玩法改的怪（用户：自爆的那个，玩家直接往前斩了，根本爆不到玩家）');
{
  // 爆裂者：斩它停在它身上，它很快就炸；前面没有下一只可闪就被炸死
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); enemies.length = 0; hNext = 1e9; hSurgeT = 1e9;');
  E.run('spawnEnemy(P.x, P.y - 150, "bomb"); enemies[0].sp = 0; enemies[0].born = 1; var _by = enemies[0].y;');
  E.tapDash(); E.step(14);
  ok(E.run('blasts.length') === 1 && Math.abs(E.run('wdelta(P.y - _by)')) < 30, '斩爆裂者：停在它身上，不穿过去', E.run('wdelta(P.y - _by)').toFixed(0));
  ok(E.run('blasts[0].r') === E.run('HD.bombR') && E.run('blasts[0].fuse') === E.run('HD.bombFuse'), '它 ' + E.run('HD.bombFuse') + ' 秒后炸，半径 ' + E.run('HD.bombR'));
  ok(E.run('hAimT') === null, '前面没有下一只：斩键灰着（没退路）');
  E.step(40);
  ok(E.run('state') === 'dead' && E.run('runDeaths[0][0]') === '爆炸', '没退路：被炸死了');
}
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); enemies.length = 0; hNext = 1e9; hSurgeT = 1e9;');
  E.run('spawnEnemy(P.x, P.y - 150, "bomb"); spawnEnemy(P.x + 40, P.y - 330, "grunt"); spawnEnemy(P.x - 50, P.y - 200, "grunt"); enemies.forEach(e => { e.sp = 0; e.born = 1; }); var _side = enemies[2];');
  E.tapDash(); E.step(14);
  ok(E.run('!!hAimT') && E.run('hAimT.ref') === E.run('enemies.find(e => !e.bomb && e !== _side)'), '前面还有一只（在炸的圈外）：准星跳到它身上（圈里那只不锁）');
  E.tapDash(); E.step(40);
  ok(E.run('state') === 'play', '马上再斩一刀闪出去：没被炸到');
  ok(E.run('enemies.indexOf(_side)') < 0, '旁边那只被炸死了（爆炸连周围的一起炸）');
}
{
  // 冲锋者：离你不到 chargeR 站住蓄力 0.6 秒，然后直冲
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); enemies.length = 0; hNext = 1e9; hSurgeT = 1e9;');
  E.run('spawnEnemy(P.x, P.y - 300, "charger"); enemies[0].born = 1; var _c = enemies[0];');
  E.step(2);
  ok(E.run('_c.mode') === 'wind', '冲锋者到了 ' + E.run('HD.chargeR') + ' 以内：站住蓄力');
  E.step(36);
  ok(E.run('_c.mode') === 'charge', '0.6 秒后：照你的方向直冲');
  E.step(30);
  ok(E.run('state') === 'dead', '站着不动：被冲死');
  const F = fresh();
  F.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); enemies.length = 0; hNext = 1e9; hSurgeT = 1e9;');
  F.run('spawnEnemy(P.x, P.y - 220, "charger"); enemies[0].born = 1;');
  F.step(3);
  F.tapDash(); F.step(15);
  ok(F.run('enemies.length') === 0 && F.run('state') === 'play', '趁它蓄力斩掉');
}

console.log('22) 黑潮的压迫感（用户：黑潮的压迫感不够）');
{
  const E = fresh();
  E.run('HD.vWave = 0; P.inv = 1e9; enemies.length = 0; hNext = 1e9; hWaveT = 10; hFront = wwrap(P.y + 380); hSurge = 0; hSurgeT = 0.05;');
  E.step(5);
  ok(E.run('hSurge') === 1, '涌浪：先憋着（潮边一闪一闪地亮、手机一震）');
  const v0 = E.run('HD.v0');
  E.step(Math.ceil(E.run('HD.surgeTell') / 0.0167) + 2);
  ok(E.run('hSurge') === 2 && E.run('hV') >= v0 * E.run('HD.surgeK') - 1, '再猛涌：潮速 × ' + E.run('HD.surgeK'), E.run('hV'));
  ok(E.run('shake') >= 3, '猛涌时屏幕在抖');
  E.step(Math.ceil(E.run('HD.surgeTime') / 0.0167) + 2);
  ok(E.run('hSurge') === 0 && E.run('hSurgeT') >= E.run('HD.surgeEvery[0]') - 0.1, '涌完：隔几秒再来');
  E.run('hFront = wwrap(P.y + 60); shake = 0;'); E.step(1);
  ok(E.run('shake') < 0.3, '黑潮贴到身后：屏幕不再一直抖（用户："振动太多看起来像掉帧"）', E.run('shake'));
  let err = null;
  try { E.run('hSurge = 1; hSurgeP = 0.2; render(); hSurge = 2; render();'); } catch (e) { err = e; }
  ok(!err, '涌浪时的潮边画得出来', err && err.message);
}


console.log('23) 黑潮做成主玩法（用户：把最早玩法的入口先删了，玩法保留）');
{
  const E = makeEnv();
  E.run('meta.tut = 0; meta.runs = 0;'); E.step(5);
  ok(E.run('CFG.mainMode') === 'horde', '主玩法是黑潮');
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '主界面画得出来（新玩家）', err && err.message);
  E.tapRect(E.run('readyGuideBtn()'));
  ok(E.run('state') === 'play' && E.run('hordeMode') && E.run('talk') === null, '点主界面哪儿都是开局：直接进黑潮（不放开场、不教学，原来的玩法说明 / 新手教程 / 商店入口都没了）');
  E.run('P.inv = 0; enemies.length = 0; hTop = hClimb = 37 * HD.m; score = 321; die("黑潮");');
  ok(E.run('meta.hBest') === 37 && E.run('meta.hScore') === 321 && E.run('meta.runs') === 1, '死了：记下最远 37 米、最高 321 分、局数 +1');
  E.step(60);
  E.tapRect(E.run('hordeEndBtns().skip')); E.step(20);     // 复活页「不用了」→ 排名页
  E.tapRect(E.run('hordeEndBtns().back'));
  ok(E.run('state') === 'ready', '回主界面');
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '主界面画得出来（打过一局：写着最远几米）', err && err.message);
  E.tap(195, 300);
  E.run('P.inv = 0; enemies.length = 0; hTop = hClimb = 50 * HD.m; die("黑潮");');
  ok(E.run('meta.hBest') === 50 && E.run('hNewBest'), '逃得更远：新纪录');
}


console.log('24) 开场动画 + 自动往上跑（用户：后面黑潮压过来，前面各种怪物占满，前后压迫然后主角全斩，之后开始往前跑；默认自动往上跑）');
{
  const E = makeEnv();
  E.run('HD.intro = true; HD.autoRun = true; meta.tut = TUT_DONE; meta.runs = 3;'); E.step(5);
  E.tap(195, 300);
  const N = E.run('HD.introRows * HD.introCols');
  ok(E.run('state') === 'play' && E.run('!!hIntro') && E.run('hIntro.ring.length') === N, '开局：前面一大片 ' + N + ' 只怪（' + E.run('[...new Set(hIntro.ring.map(e => foeType(e)))].join("、")') + '）');
  ok(E.run('new Set(hIntro.ring.map(e => foeType(e))).size') >= 4, '各种怪都有');
  ok(E.run('hGap() > hBottomGap()') && E.run('hIntro.ring.every(e => wdelta(e.y - P.y) < -H * 0.5)'), '一开始：黑潮在屏幕底下外面、前面那片在屏幕顶上外面');
  for (let i = 0; i < 80 && E.run('hIntro && hIntro.phase === 0'); i++) E.step(1);
  ok(E.run('hGap()') <= E.run('HD.introBack') + 30 && E.run('hIntro.ring.every(e => wdelta(e.y - P.y) < 0 && wdelta(e.y - P.y) > -H * 0.6)'),
     '前后夹击：黑潮压到身后 ' + Math.round(E.run('hGap()')) + '，前面那片涌下来占满屏幕');
  const y0 = E.run('P.y'), k0 = E.run('runKills');
  let k = 0;
  for (; k < 300 && E.run('!!hIntro'); k++) E.step(1);
  ok(!E.run('hIntro') && E.run('runKills') - k0 === N && E.run('combo') >= N, '一个连斩全斩了（连斩 ×' + E.run('combo') + '，' + (k * 16.7 / 1000).toFixed(1) + ' 秒）');
  ok(E.run('state') === 'play' && E.run(y0 + ' - P.y') > 400, '人一路斩到那片最前头（往前 ' + Math.round(E.run(y0 + ' - P.y')) + '），没事');
  ok(E.run('hGap()') > 300 && E.run('enemies.filter(e => wdelta(e.y - P.y) < 0).length') >= 5, '黑潮在后面追（离你 ' + Math.round(E.run('hGap()')) + '），前面接着有得斩');
  E.run('P.inv = 1e9; enemies.length = 0; hNext = 1e9;');
  const ya = E.run('P.y');
  E.step(60);
  ok(ya - E.run('P.y') > 200 && Math.abs(E.run('P.vy') + E.run('HD.walk')) < 10, '不碰屏幕：自己往上跑（每秒 ' + E.run('HD.walk') + '）', (ya - E.run('P.y')).toFixed(0));
  E.step(90);
  ok(E.run('P.y + hGap() < cam.y + H / 2'), '黑潮追上来，在屏幕下面', E.run('hGap()'));
  E.run('P.x = hX0 - 200; tMove.x = 1; tMove.y = 0;'); E.step(30);
  ok(E.run('P.vx') > 250 && Math.abs(E.run('P.vy')) < 40, '拖动屏幕往右：就往右跑', E.run('P.vx').toFixed(0) + ' / ' + E.run('P.vy').toFixed(0));
  E.run('tMove.x = 0; tMove.y = 1;'); E.step(30);
  ok(E.run('P.vy') <= 0.5 && E.run('Math.hypot(P.vx, P.vy)') < 60, '往下拖：不往后走，站住（用户："不能往后走"）', E.run('P.vy').toFixed(0));
  E.run('tMove.y = 0;');
}
{
  // 开场不能跳过（用户："改成不能跳过"）：点屏幕、点「斩」、按键都不打断；暂停照常
  const E = makeEnv();
  E.run('HD.intro = true; meta.tut = TUT_DONE;'); E.step(5);
  E.tap(195, 300); E.step(10);
  ok(E.run('!!hIntro'), '（开场放着）');
  const ph = E.run('hIntro.phase'), n = E.run('hIntro.ring.filter(e => enemies.indexOf(e) >= 0).length');
  E.tap(100, 400); E.tapDash(); E.step(1);
  ok(E.run('!!hIntro') && E.run('hIntro.phase') === ph && E.run('hIntro.ring.filter(e => enemies.indexOf(e) >= 0).length') === n, '点屏幕、点「斩」：开场照常放，不跳过');
  E.run('pauseGame();');
  ok(E.run('state') === 'pause', '暂停照常');
  E.run('resumeGame();');
  for (let i = 0; i < 300 && E.run('!!hIntro'); i++) E.step(1);
  ok(!E.run('hIntro') && E.run('state') === 'play' && E.run('hIntro === null'), '放完了才开始跑');
}
{
  // 自动往上跑时，斩了爆裂者没有下一只可闪，照样会被炸到（圈够大，自己跑不出去）
  const E = makeEnv();
  E.run('HD.autoRun = true; meta.tut = TUT_DONE;'); E.step(5);
  E.tap(195, 300);
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); enemies.length = 0; hNext = 1e9; hSurgeT = 1e9; P.inv = 0;');
  E.run('spawnEnemy(P.x, P.y - 150, "bomb"); enemies[0].sp = 0; enemies[0].born = 1;');
  E.tapDash(); E.step(50);
  ok(E.run('state') === 'dead' && E.run('runDeaths[0][0]') === '爆炸', '自动往上跑也跑不出炸的圈：没退路照样被炸死');
}


console.log('25) 越往后整体越快（用户：黑潮提速了，玩家的移速和怪物的移速也提升）');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); enemies.length = 0; hNext = 1e9; hSurgeT = 1e9; P.inv = 1e9;');
  E.run('tMove.x = 0; tMove.y = -1;'); E.step(60);
  const v1 = Math.hypot(E.run('P.vx'), E.run('P.vy')), d1 = E.run('POW.dashSpeed');
  E.run('tMove.y = 0; hClimb = hTop = HD.waveM * HD.m * 4 + 10; tMove.y = -1;'); E.step(3);
  ok(E.run('hWave') === 5 && Math.abs(E.run('hTempo()') - 1.2) < 1e-6, '第 5 波：整体快到 1.2 倍');
  E.step(60);
  const v5 = Math.hypot(E.run('P.vx'), E.run('P.vy'));
  ok(Math.abs(v5 / v1 - 1.2) < 0.02, '跑得快了：' + Math.round(v1) + ' → ' + Math.round(v5), v5);
  ok(Math.abs(E.run('POW.dashSpeed') / d1 - 1.2) < 1e-6, '往前闪也快了：' + d1 + ' → ' + Math.round(E.run('POW.dashSpeed')));
  E.run('tMove.y = 0; P.vx = 0; P.vy = 0; spawnEnemy(P.x, P.y - 500, "grunt"); var _g = enemies[0]; _g.born = 1; var _gy = _g.y, _gs = _g.sp;');
  E.step(30);
  const moved = E.run('Math.abs(wdelta(_g.y - _gy))');
  ok(Math.abs(moved / (E.run('_gs') * 0.5) - 1.2) < 0.08, '挡路的走得也快了（1.2 倍）', (moved / (E.run('_gs') * 0.5)).toFixed(2));
  E.run('hTop = HD.waveM * HD.m * 30; hClimb = hTop + 5;'); E.step(2);
  ok(E.run('hTempo()') === E.run('HD.tempoMax'), '最多快到 ' + E.run('HD.tempoMax') + ' 倍');
  E.run('toReady(); meta.tut = TUT_DONE;'); E.step(2); E.tap(195, 300);
  ok(E.run('hTempo()') === 1 && E.run('POW.dashSpeed') === E.run('CFG.dashSpeed'), '下一局从原速开始');
}


console.log('26) 没意义的提示都去了（用户：你不要每波都提示更快了，这些没意义）');
{
  const E = fresh();
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; P.inv = 1e9; enemies.length = 0; hNext = 1e9; hSurgeT = 1e9;');
  E.run('var _txt = []; var _co = callout; callout = function (t) { _txt.push(String(t)); return _co.apply(null, arguments); };');
  E.run('hRage = 100;'); E.step(2);
  ok(E.run('hFull') && E.run('_txt.indexOf("怒气满了！")') < 0, '怒气满了：不在头顶写"怒气满了！"（「连斩」键自己变金）');
  E.run('hFront = wwrap(P.y + 260);'); E.step(1); E.run('hBurstGo();');
  ok(E.run('_txt.indexOf("回头连斩！")') < 0, '放连斩：不写"回头连斩！"');
  for (let i = 0; i < 300 && E.run('hBurst'); i++) E.step(1);
  ok(E.run('_txt.some(t => /^一口气 \\d+ 斩$/.test(t))'), '收刀"一口气 N 斩"留着（斩了多少）', E.run('_txt.join(",")'));
  const F = makeEnv();
  F.run('HD.intro = true; HD.tut = true; meta.tut = TUT_DONE; meta.runs = 8; meta.htut = H_TUT_VER;'); F.step(5); F.tap(195, 300);
  for (let i = 0; i < 300 && F.run('!!hIntro'); i++) F.step(1);
  ok(!F.run('hTutOn()'), '看过新手教程的：开场完了直接玩');
  const G = makeEnv();
  G.run('HD.intro = true; HD.tut = true; meta.tut = TUT_DONE; meta.runs = 0;'); G.step(5); G.tap(195, 300);
  for (let i = 0; i < 300 && G.run('!!hIntro'); i++) G.step(1);
  ok(G.run('hTutOn()'), '新玩家：开场完了接着教（以前是挂"怎么玩"那两行，见 test-htut.js）');
}


console.log('27) 三条命（有人反馈：改成三条命，增加容错）');
{
  const E = fresh();
  E.run('toReady(); HD.lives = 3;'); E.step(2); E.tap(195, 300);
  E.run('HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); enemies.length = 0; hNext = 1e9; hSurgeT = 1e9; P.inv = 0;');
  ok(E.run('hLives') === 3, '开局 3 条命');
  E.run('spawnEnemy(P.x, P.y - 40, "grunt"); enemies[0].sp = 200; enemies[0].born = 1; spawnEnemy(P.x + 120, P.y - 60, "grunt"); enemies[1].sp = 0;');
  E.step(20);
  ok(E.run('state') === 'play' && E.run('hLives') === 2, '撞上挡路的：掉一条（剩 2），没死');
  ok(E.run('P.inv') > 1 && E.run('hHurtT') > 1, '无敌一会儿、人一闪一闪');
  ok(E.run('enemies.length') === 0, '身边的挡路怪震飞了');
  ok(E.run('runDeaths.length') === 1 && /掉一命，剩 2/.test(E.run('runDeaths[0][0]')), '测试数据记了这一下', E.run('runDeaths[0][0]'));
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '画得出来（左上角三颗心，掉了一颗）', err && err.message);
  // 被黑潮追上：掉一条，黑潮推回屏幕下面
  E.step(100);
  E.run('P.inv = 0; hHurtT = 0; hFront = wwrap(P.y + 20);'); E.step(3);
  ok(E.run('state') === 'play' && E.run('hLives') === 1 && E.run('hGap()') >= E.run('hBottomGap() * 0.79'), '被黑潮追上：掉一条（剩 1），黑潮推回屏幕下面', E.run('hGap()'));
  E.step(100);
  E.run('P.inv = 0; hHurtT = 0; hFront = wwrap(P.y + 20);'); E.step(3);
  ok(E.run('state') === 'dead' && E.run('hLives') === 1, '最后一条也没了：结束');
  ok(E.run('runDeaths.length') === 3 && E.run('runDeaths[2][0]') === '黑潮', '死因：两次掉命 + 最后那一下', JSON.stringify(E.run('runDeaths.map(d => d[0])')));
  E.run('toReady();'); E.step(2); E.tap(195, 300);
  ok(E.run('hLives') === 3, '下一局又是 3 条命');
}

console.log('不能往后走（用户："给玩家一个限制，不能往后走"）');
{
  const E = fresh();
  E.run('HD.autoRun = true; HD.v0 = 0; HD.vRamp = 0; HD.vWave = 0; HD.catchK = 0; hSurgeT = 1e9; enemies.length = 0; hNext = 1e9; P.inv = 1e9; hFront = wwrap(P.y + hGapMax());');
  E.step(30);
  ok(E.run('P.vy') < -200, '不碰屏幕：自己往上跑', E.run('P.vy'));
  E.run('tMove.x = 0; tMove.y = 1;');
  let maxVy = -1e9;
  for (let i = 0; i < 90; i++) { E.step(1); maxVy = Math.max(maxVy, E.run('P.vy')); }
  ok(maxVy <= 0.5, '往正下方拖：一步都不往下走', maxVy.toFixed(1));
  ok(E.run('Math.hypot(P.vx, P.vy)') < 30, '往正下方拖：站住', E.run('Math.hypot(P.vx, P.vy)').toFixed(1));
  E.run('tMove.x = -0.6; tMove.y = 0.8;');
  maxVy = -1e9;
  for (let i = 0; i < 40; i++) { E.step(1); maxVy = Math.max(maxVy, E.run('P.vy')); }
  ok(maxVy <= 0.5 && E.run('P.vx') < -200, '往左下拖：只往左挪，不往下', E.run('P.vx').toFixed(0) + ' / ' + maxVy.toFixed(1));
  E.run('tMove.x = 0.6; tMove.y = -0.8;'); E.step(30);
  ok(E.run('P.vx') > 100 && E.run('P.vy') < -150, '往右上拖：照常往右上走');
  E.run('tMove.x = 0; tMove.y = 0;');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
