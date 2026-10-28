/* 黑潮新手教程 + 拿到道具报名字（2.14 节）—— 用户："做个新手教程，还有每个道具拾起之后弹出个名字和介绍，说明是干什么的"
   1) 第一局：开局就记"看过"；开场里不教，开场那一刀斩完从「点左边」教起
   2) 看过的不再自动教；主界面「新手教程」点了再教一局
   3) 点左边 / 点右边：人站住；怪摆在那一边的斜前方、一刀够得着；点错边不出刀；斩掉翻页
   4) 按住走：糖摆在横着 200 开外（笔直跑捡不到）；按住那一边就斜着走过去；按够了 / 捡到了翻页
   5) 往前斩：放开刷怪、撒糖；黑潮进屏幕但追不到人；斩 6 只翻页
   6) 连斩：怒气直接给满；点「连斩」放出去、收了刀才翻页
   7) 斩道具：摆在前面偏一点；斩到就生效 + 弹道具卡；「出师了」挂一会儿淡掉；之后道具照常在路上出
   8) 教的时候：撞怪、被黑潮碰到都不掉命；前三步不刷别的
   9) 什么都不做：停在第一步等着（不自己翻页、不死）；照着做：一路教完
   10) 道具卡：不管教不教，拿到道具（路上的 / 开局看广告带的）都弹，写名字 + 干什么用，两秒多就没
   11) 以前头三局开场挂的"怎么玩"两行没了（教程接管）
   12) 停住 + 暗屏高光（用户："新手教程，可以让游戏先停，用高光暗屏方式引导"）：东西摆好、做得到时停住，世界不动；
       只认对的那一下（点错边、点「连斩」键都不算），点对了放行、这一下照常斩出去；暂停键照常；暗屏挖洞画得出来；
       按住走松手太早再停一次；看过旧版（htut 1）的再教一遍
   13) 用户："连斩怎么不暂停"：「连斩」一进这一步就停（以前等 0.3 秒，人先点了，放完才停 —— 怒气空了点不出来，卡死）；
       做到了 / 做不到的不停；一直连着斩也停得下来；狂点也能一路教完
   14) 用户："怎么连斩没有引导啊"：每一步停住时，暗屏、卡片、手指真的画出来了（以前「连斩」一进来就停，卡片还没淡入就停住了，
       停着时卡片不淡入 —— 游戏停着，屏幕上什么引导都没有） */
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
  const texts = [], arcs = { ccw: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'arc') return (x, y, r, a0, a1, ccw) => { if (ccw) arcs.ccw++; };
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (k === 'fillText' || k === 'strokeText') return s => { texts.push(String(s)); };
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
  vm.runInContext('HD.intro = false; HD.preAd = false; HD.story = false; CFG.mainMode = "horde"; HD.autoRun = true; HD.lives = 3; HD.fillWait = 0.45;', sb);
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const f = raf; raf = null; if (!f) break; simT += 16.7; f(simT); } }
  let tid = 20;
  const down = (x, y) => { const id = ++tid; run('onTouchStart({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });'); return id; };
  const up = (id, x, y) => run('onTouchEnd({ changedTouches: [{ identifier: ' + id + ', clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tap = (x, y) => up(down(x, y), x, y);
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  return { run, step, tap, tapRect, down, up, storage, texts, arcs };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 主界面点标题那块开一局（别点到「新手教程」「看广告」）
function go(seed, pre) {
  const E = makeEnv(seed);
  if (pre) E.run(pre);
  E.step(5);
  E.tap(195, 300);
  E.step(2);
  return E;
}
const key = E => E.run('hTutKey()');
// 点左半屏 / 右半屏（躲开「连斩」键）= 左斩 / 右斩
const tapSide = (E, s) => E.tap(s < 0 ? 80 : 300, 400);
// 停住时点它要的那一下（「连斩」键 / 对的那边，两边都行就点右边）
function tapWanted(E) {
  if (key(E) === 'burst') { const b = E.run('hBurstBtn()'); E.tap(b.x, b.y); }
  else tapSide(E, E.run('hTutSide') || 1);
}
// 跟着卡片做，直到翻到下一步（最多 sec 秒）：停住了就点它要的；没停时每 12 帧斩一下锁得上的那边
function botUntil(E, k0, sec) {
  for (let f = 0; f < sec * 60 && key(E) === k0; f++) {
    E.step(1);
    if (E.run('hTutFz')) { tapWanted(E); continue; }
    if (f % 12) continue;
    if (E.run('!!hAimTL')) tapSide(E, -1); else if (E.run('!!hAimTR')) tapSide(E, 1);
  }
  return key(E);
}
// 照着做一整遍：停住了就照做（按住走那一步按住 1.6 秒），往前斩那一步一路斩；返回走过的步
// mash：每 2 帧点一下锁得上的那边、「连斩」金了就点（手快、不看卡片的人）
function follow(E, sec, mash) {
  const seen = [];
  seen.fz = {};                                  // 哪几步停住过
  seen.shown = {};                               // 停住时引导画出来没有：停 20 帧后卡片淡入了、暗屏挖了洞、卡片标题写过
  let hold = null;
  for (let f = 0; f < sec * 60 && E.run('hTutOn()'); f++) {
    E.step(1);
    const k = key(E);
    if (k && seen[seen.length - 1] !== k) seen.push(k);
    if (hold && (f >= hold.end || k !== 'steer')) { E.up(hold.id, hold.x, 400); hold = null; }
    if (E.run('hTutFz')) {
      seen.fz[k] = true;
      if (!(k in seen.shown)) {
        E.step(20);
        E.arcs.ccw = 0; E.run('render();');
        seen.shown[k] = E.run('hTutFz') && E.run('hTutA') > 0.9 && E.arcs.ccw > 0 && E.texts.indexOf(E.run('H_TUT[hTut].title')) >= 0;
      }
      if (k === 'steer') { const x = E.run('hTutSide') < 0 ? 80 : 300; hold = { id: E.down(x, 400), x: x, end: f + 96 }; }
      else tapWanted(E);
    } else if (mash || (k === 'run' && f % 12 === 0 && seen.fz.run)) {   // 「往前斩」停住以后才斩：先斩够 6 只就不停了（对的），这一项就看不到停住时的引导
      if (mash && f % 2) continue;
      if (mash && E.run('hRage >= 100 && !hBurst')) { const b = E.run('hBurstBtn()'); E.tap(b.x, b.y); continue; }
      if (E.run('!!hAimTL')) tapSide(E, -1); else if (E.run('!!hAimTR')) tapSide(E, 1);
    }
  }
  return seen;
}

console.log('1) 第一局：开局就记看过；开场里不教，开场完了从「点左边」教起');
{
  const E = go(null, 'HD.intro = true;');
  ok(E.run('meta.htut') === E.run('H_TUT_VER') && JSON.parse(E.storage.dash_meta_v1).htut === E.run('H_TUT_VER'), '一开局就记看过、存进存档（这一局教到哪算哪）');
  ok(!E.run('hTutOn()') && E.run('!!hIntro'), '开场里不教（开场照原样：黑潮压上来、一刀全斩）');
  for (let i = 0; i < 600 && E.run('!!hIntro'); i++) E.step(1);
  ok(key(E) === 'left', '开场一完：第一步「点左边」', key(E));
  E.step(30);
  ok(E.texts.indexOf('点左边 · 斩左前方的嘉豪') >= 0, '卡片写着这一步要做什么');
}

console.log('2) 看过的不再自动教；主界面「新手教程」再教一局');
{
  const E = go({ htut: 2, runs: 3 });
  ok(E.run('state') === 'play' && !E.run('hTutOn()'), '看过的：开局直接玩');
  const O = go({ htut: 1, runs: 3 });
  ok(key(O) === 'left', '看过旧版（不停的那版，htut 1）的：再教一遍', key(O));
  const M = makeEnv({ htut: 2, runs: 3 });
  M.step(5);
  ok(M.texts.indexOf('新手教程') >= 0 && M.run('!!readyHTut'), '主界面有「新手教程」');
  M.tapRect(M.run('readyHTut'));
  M.step(3);
  ok(M.run('state') === 'play' && key(M) === 'left', '点了：开一局，从第一步教起', key(M));
  const N = makeEnv({ htut: 2, runs: 3 });
  N.run('HD.tut = false;'); N.step(5);
  ok(!N.run('readyHTut'), '教程关了（HD.tut）就不画入口');
}

console.log('3) 点左边 / 点右边：人站住，怪在那一边的斜前方，点错边不出刀');
{
  const E = go();
  ok(key(E) === 'left', '第一局（没开场）：一开就教', key(E));
  const y0 = E.run('P.y');
  E.step(60);
  ok(Math.abs(E.run('P.y') - y0) < 2, '人站住不跑（不按也不往上跑）', (E.run('P.y') - y0).toFixed(1));
  const ok1 = E.run('(function(){ const e = hTutRef; return !!e && enemies.indexOf(e) >= 0 && hSideOk(-1, wdelta(e.x - P.x), wdelta(e.y - P.y), hAimR()) && !hSideOk(1, wdelta(e.x - P.x), wdelta(e.y - P.y), hAimR()); })()');
  ok(ok1, '怪在左前方、左斩够得着、右斩够不着');
  ok(E.run('enemies.length') === 1 && E.run('hCandy.length') === 0 && !E.run('hItem'), '场上只有它（不刷别的）');
  ok(E.run('hTutFz') && E.run('hTutSide') === -1 && E.run('hTutFzA') > 0.95, '怪摆出来、左斩锁上它：停住、压暗，等着点左边');
  tapSide(E, 1); E.step(20);
  ok(key(E) === 'left' && E.run('hTutFz') && E.run('enemies.indexOf(hTutRef) >= 0') && E.run('P.dashT') <= 0, '点右边：不算，照样停着、不出刀');
  const b = E.run('hBurstBtn()'); E.tap(b.x, b.y); E.step(5);
  ok(E.run('hTutFz') && key(E) === 'left', '点「连斩」键：也不算');
  tapSide(E, -1); E.step(1);
  ok(!E.run('hTutFz') && E.run('P.dashT') > 0, '点左边：放行，这一下照常斩出去');
  E.step(30);
  ok(key(E) === 'right', '斩掉了：翻到「点右边」', key(E));
  ok(E.run('hTutRef && hTutRef.x > P.x'), '这只摆在右边');
  E.step(40);
  ok(E.run('hTutFz') && E.run('hTutSide') === 1, '又停住，等着点右边');
  tapSide(E, 1); E.step(30);
  ok(key(E) === 'steer', '斩掉了：翻到「按住走」', key(E));
}

console.log('4) 按住走：糖在横着 200 开外，按住那一边斜着走过去');
{
  const E = go();
  E.run('hTutGo(2);'); E.step(2);
  const s = E.run('hTutRef.side'), dx = E.run('Math.min.apply(null, hTutRef.map(c => Math.abs(c.x - P.x)))');
  ok(E.run('hTutRef.length') === 3 && dx >= 199, '三颗糖，横着最近也隔 ' + dx.toFixed(0) + '（捡糖判定 120，笔直跑捡不到）');
  const x0 = E.run('P.x'), id = E.down(s < 0 ? 80 : 300, 400);
  E.step(40);
  ok((E.run('P.x') - x0) * s > 30, '按住那一边：往那边斜着走（横着走了 ' + ((E.run('P.x') - x0) * s).toFixed(0) + '）');
  for (let i = 0; i < 120 && key(E) === 'steer'; i++) E.step(1);
  E.up(id, s < 0 ? 80 : 300, 400);
  ok(key(E) === 'run', '按够了 / 捡到糖：翻到「往前斩」', key(E));
}

console.log('5) 往前斩：放开刷怪撒糖，黑潮进屏幕但追不到；斩 6 只翻页');
{
  const E = go();
  E.run('hTutGo(3);'); E.step(2);
  ok(E.run('enemies.length') >= 3, '前面接着摆上挡路的（' + E.run('enemies.length') + ' 只）');
  ok(E.run('hCandyNext - hTop') < 1e6, '糖照常撒');
  let minGap = 1e9;
  for (let f = 0; f < 240; f++) { E.step(1); minGap = Math.min(minGap, E.run('hGap()')); }
  ok(minGap >= E.run('hTutFloor()') - 1 && minGap < E.run('hBottomGap()'), '黑潮进了屏幕（最近 ' + minGap.toFixed(0) + '，屏幕底边 ' + E.run('hBottomGap()').toFixed(0) + '），追不到人');
  ok(E.run('hTutFz') && E.run('hTutSide') === 0 && E.run('hTutHoles().y1') < E.run('H_CSS') && !!E.run('hTutHoles().rect'), '黑潮进了屏幕就停住：底下黑潮那一截亮着、命那一排挖亮，点哪边都行');
  const k0 = E.run('runKills');
  ok(botUntil(E, 'run', 14) === 'burst' && E.run('runKills') - k0 >= 6, '斩够 6 只：翻到「连斩」', E.run('runKills') - k0);
}

console.log('6) 连斩：怒气给满，点了放出去，收了刀才翻页');
{
  const E = go();
  E.run('hTutGo(4);'); E.step(30);
  ok(E.run('hRage') >= 100, '怒气直接给满');
  ok(E.run('hTutFz'), '停住，等着点「连斩」');
  tapSide(E, -1); tapSide(E, 1); E.step(5);
  ok(E.run('hTutFz') && !E.run('hBurst') && E.run('P.dashT') <= 0, '点左右两边：都不算');
  const b = E.run('hBurstBtn()');
  E.tap(b.x, b.y); E.step(1);
  ok(E.run('!!hBurst') && key(E) === 'burst', '点「连斩」：放出去了，这一步还挂着（不在慢动作里翻页）');
  for (let i = 0; i < 600 && E.run('!!hBurst'); i++) E.step(1);
  E.step(1);
  ok(key(E) === 'prop', '收了刀：翻到「斩道具」', key(E));
}

console.log('7) 斩道具：摆在前面偏一点，斩到就生效 + 弹卡；出师了挂一会儿淡掉；之后道具照常出');
{
  const E = go();
  E.run('hTutGo(5);'); E.step(2);
  ok(E.run('!!hItem') && E.run('Math.abs(hItem.x - P.x)') >= 100 && E.run('wdelta(hItem.y - P.y)') < -250, '道具摆在前面偏一点（笔直跑碰不到，得斩）');
  E.texts.length = 0;
  botUntil(E, 'prop', 10);
  ok(E.run('!!hProp') && E.run('hTutFinT') > 0, '斩到了：道具生效，卡片换成「出师了」');
  ok(E.run('hPropPop && hPropPop.k === hProp.k'), '弹出道具卡');
  E.step(20);
  const k = E.run('hProp.k');
  ok(E.texts.indexOf(E.run('PROP_NAME.' + k)) >= 0 && E.texts.indexOf(E.run('PROP_DESC.' + k)) >= 0, '道具卡写着名字和干什么用（' + E.run('PROP_NAME.' + k) + '：' + E.run('PROP_DESC.' + k) + '）');
  ok(E.texts.indexOf('出师了，体育生！') >= 0, '「出师了，体育生！」');
  ok(E.run('hTutCardY() + 33 < hTutCardY() + 82 - 37'), '道具卡往下让开教程卡，不叠在一起');
  for (let i = 0; i < 60 * 6 && E.run('hTutOn()'); i++) E.step(1);
  ok(!E.run('hTutOn()'), '「出师了」挂一会儿就淡掉，教完');
  E.run('hProp.t = 0;'); E.step(2);
  ok(!E.run('hProp') && E.run('hPropNext') < Infinity, '道具用完：路上照常出下一个（隔 ' + E.run('Math.round((hPropNext - hTop) / HD.m)') + ' 米）');
}

console.log('8) 教的时候不掉命；前三步不刷别的');
{
  const E = go();
  for (let f = 0; f < 300; f++) E.step(1);
  ok(key(E) === 'left' && E.run('enemies.length') === 1 && E.run('hCandy.length') === 0 && !E.run('hItem'), '「点左边」挂 5 秒：场上还是只有那一只，没刷别的、没撒糖、没冒道具');
  E.run('hTutGo(3);'); E.step(2);
  E.run('const e = spawnEnemy(P.x, P.y, "grunt"); e.sp = 0;'); E.step(5);
  ok(E.run('hLives') === 3 && E.run('state') === 'play', '撞上怪：不掉命');
  E.run('hFront = wwrap(P.y);'); E.step(3);
  ok(E.run('hLives') === 3 && E.run('state') === 'play' && E.run('hGap()') >= E.run('hTutFloor()') - 1, '黑潮贴上来：推回去，不掉命');
}

console.log('9) 什么都不做：停在第一步等着；照着做：一路教完');
{
  const E = go();
  E.step(60 * 20);
  ok(key(E) === 'left' && E.run('hTutFz'), '20 秒什么都不做：还停在「点左边」等着（不自己翻页）');
  ok(E.run('hLives') === 3 && E.run('state') === 'play', '没死（' + E.run('hLives') + ' 命）');
  const F = go();
  const t0 = F.run('gameTime');
  const seen = follow(F, 90);
  ok(seen.join() === 'left,right,steer,run,burst,prop', '六步都走到了（' + seen.join(' → ') + '）');
  ok(!F.run('hTutOn()'), '教完了（局内时间 ' + (F.run('gameTime') - t0).toFixed(0) + ' 秒）');
  ok(F.run('hLives') === 3 && F.run('state') === 'play', '一路没掉命（' + F.run('hLives') + ' 命）');
  ok(F.run('!!hItem || !!hProp || hPropNext < Infinity'), '教完道具照常出');
  ok(!F.run('hTutFz') && F.run('hTutFzA') === 0, '教完不再停、暗屏退掉了');
}

console.log('10) 道具卡：不管教不教，拿到就弹，两秒多就没');
{
  const E = go({ htut: 2, runs: 3 });
  E.texts.length = 0;
  E.run('hUseProp("stink", P.x, P.y - 100);'); E.step(10);
  ok(E.run('hPropPop && hPropPop.k') === 'stink' && E.texts.indexOf('臭水') >= 0 && E.texts.indexOf(E.run('PROP_DESC.stink')) >= 0, '路上拿到臭水：弹「臭水 · ' + E.run('PROP_DESC.stink') + '」');
  E.step(Math.round(E.run('H_POP_T') * 60) + 5);
  ok(!E.run('hPropPop'), E.run('H_POP_T') + ' 秒后没了');
  const F = makeEnv({ htut: 2, runs: 3 });
  F.step(5);
  F.run('startHorde("ruler");'); F.step(2);
  ok(F.run('hPropPop && hPropPop.k') === 'ruler', '开局看广告带的黑板尺：开场完了生效，也弹');
}

console.log('11) 以前头三局开场挂的"怎么玩"两行没了');
{
  const E = go({ htut: 2, runs: 0 }, 'HD.intro = true;');
  for (let i = 0; i < 600 && E.run('!!hIntro'); i++) E.step(1);
  E.step(60);
  ok(E.texts.every(t => t.indexOf('点左 / 右斩：斩那一边') < 0 && t.indexOf('先斩道具和糖') < 0), '新玩家看过教程：开局不再挂那两行');
  ok(E.run('typeof hTaught') === 'undefined', 'hTaught 删掉了');
}

console.log('12) 停住 + 暗屏高光');
{
  const E = go();
  E.step(60);
  ok(E.run('hTutFz'), '「点左边」停住了');
  const snap = () => E.run('[gameTime, P.x, P.y, hFront, comboTimer, hTutT, enemies.length].join()');
  const s0 = snap(); E.step(90);
  ok(snap() === s0, '停着的 1.5 秒里世界一点没动（时间、人、黑潮、连斩倒计时、教程计时）');
  E.arcs.ccw = 0; E.run('render();');
  const holes = E.arcs.ccw;
  ok(holes === E.run('hTutHoles().c.length') && holes === 3, '暗屏挖了 ' + holes + ' 个洞（要斩的怪、人、左斩键）');
  const pb = E.run('hudPauseBtn()'); E.tapRect(pb); E.step(2);
  ok(E.run('state') === 'pause', '停着也能按暂停');
  E.run('resumeGame();'); E.step(30);
  ok(E.run('state') === 'play' && E.run('hTutFz') && key(E) === 'left', '回来：还停着等点左边');
  tapSide(E, -1); E.step(40);
  ok(key(E) === 'right' && E.run('hTutFzA') === 0, '点了左边：暗屏很快退掉');
  E.arcs.ccw = 0; E.run('hTutFz = false; hTutFzA = 0;'); E.run('render();');
  ok(E.arcs.ccw === 0, '不停的时候不画暗屏');
}
{
  // 按住走：停住 → 按住放行 → 松手太早 → 再停一次
  const E = go();
  E.run('hTutGo(2);'); E.step(40);
  const s = E.run('hTutRef.side'), x = s < 0 ? 80 : 300, xw = s < 0 ? 300 : 80;
  ok(E.run('hTutFz') && E.run('hTutSide') === s, '「按住走」停住，等着按糖那一边');
  let id = E.down(xw, 400); E.step(5);
  ok(E.run('hTutFz') && E.run('Object.keys(hSideTouch).length') === 0, '按另一边：不算（也不当成按住走）');
  E.up(id, xw, 400);
  id = E.down(x, 400); E.step(12);
  ok(!E.run('hTutFz') && E.run('P.vx') * s > 100, '按住糖那一边：放行，往那边斜着走');
  E.up(id, x, 400); E.step(50);
  ok(E.run('hTutFz') && E.run('hTutFzN') === 2 && key(E) === 'steer', '松手太早（没捡到、没按够）：过一会儿再停一次');
  id = E.down(x, 400); E.step(110); E.up(id, x, 400);
  ok(key(E) === 'run', '这回按够了：翻到「往前斩」', key(E));
}
{
  // 斩道具：锁上了才停，停住时只认道具那一边
  const E = go();
  E.run('hTutGo(5);'); E.step(2);
  ok(!E.run('hTutFz'), '道具还够不着：先不停（照常往前跑）');
  for (let i = 0; i < 120 && !E.run('hTutFz'); i++) E.step(1);
  const sd = E.run('hTutSide'), lk = sd < 0 ? E.run('hAimTL && hAimTL.ref === hItem') : E.run('hAimTR && hAimTR.ref === hItem');
  ok(E.run('hTutFz') && sd !== 0 && lk, '道具锁上了：停住，等着点' + (sd < 0 ? '左' : '右') + '边');
  tapSide(E, -sd); E.step(5);
  ok(E.run('hTutFz') && !E.run('hProp'), '点另一边：不算');
  tapSide(E, sd); E.step(30);
  ok(E.run('!!hProp') && E.run('hTutFinT') > 0, '点对了：斩到道具，出师了');
}

console.log('13) 「连斩」一进来就停；做到了 / 做不到的不停；连着斩也停得下来');
{
  const E = go();
  E.run('hTutGo(3);'); E.step(2);
  E.run('P.dashT = 0.1; hTutGo(4);');
  ok(E.run('hTutFz') && key(E) === 'burst' && E.run('hRage') >= 100, '翻到「连斩」的同一帧就停住（冲刺到一半也停），「连斩」键变金和停住是同时的');
  const b = E.run('hBurstBtn()'); E.tap(b.x, b.y); E.step(1);
  ok(!E.run('hTutFz') && E.run('!!hBurst'), '点「连斩」：放行、放出去');
  for (let i = 0; i < 600 && E.run('!!hBurst'); i++) E.step(1);
  E.step(2);
  ok(key(E) === 'prop', '收了刀：翻到「斩道具」（不会放完了又停住）', key(E));
}
{
  // 往前斩那一步自己放了连斩，斩够了直接翻到「连斩」：已经在放了，不停；放完就翻页，不卡
  const E = go();
  E.run('hTutGo(3);'); E.step(2);
  E.run('hRage = 100; hBurstGo(); hTutGo(4);'); E.step(1);
  ok(!E.run('hTutFz') && E.run('!!hBurst'), '翻到「连斩」时已经在放连斩：不停');
  for (let i = 0; i < 600 && E.run('!!hBurst'); i++) E.step(1);
  E.step(2);
  ok(key(E) === 'prop' && E.run('!hTutFz || hTutKey() === "prop"'), '放完就翻到「斩道具」，没卡在「连斩」', key(E));
}
{
  const E = go();
  E.run('hTutGo(4); hTutFz = false; hRage = 40;'); E.step(5);
  ok(!E.run('hTutFz'), '怒气不满（点了也放不出来）：不停');
  E.run('hTutGo(2);'); E.step(2);
  E.run('hCandyRun += 1;'); E.step(40);
  ok(!E.run('hTutFz') && key(E) === 'run', '按住走：糖已经捡到了，不再停，直接翻页', key(E));
  E.run('hTutGo(3); runKills += 6;'); E.step(5);
  ok(key(E) === 'burst', '往前斩：一进来就已经斩够 6 只（黑潮还没进屏幕）：不停，直接翻页', key(E));
}
{
  // 连着斩：上一刀刚收、下一下又要出刀 —— 这一下先停住，不出刀
  const E = go();
  E.step(2);
  ok(!E.run('hTutFz') && E.run('hAimTL && hAimTL.ref === hTutRef'), '「点左边」：怪摆好、左斩锁上了，还没到停的时候');
  E.run('hTutT = 1;'); tapSide(E, -1);
  ok(E.run('hTutFz') && E.run('P.dashT') <= 0 && E.run('enemies.indexOf(hTutRef) >= 0'), '该停了、正好这时点了左边：先停住（不出刀）');
  tapSide(E, -1); E.step(30);
  ok(key(E) === 'right', '再点左边：放行、斩掉、翻页', key(E));
}
{
  const E = go(null, 'HD.intro = true;');
  for (let i = 0; i < 900 && E.run('!!hIntro'); i++) E.step(1);
  const seen = follow(E, 90, true);
  ok(seen.join() === 'left,right,steer,run,burst,prop' && !E.run('hTutOn()'), '狂点（每 2 帧一下、「连斩」金了就点）：照样六步教完（' + seen.join(' → ') + '）');
  ok(seen.fz.burst, '狂点也在「连斩」那一步停住了（停过的：' + Object.keys(seen.fz).join(' ') + '；左右两步怪一摆出来就被斩了 = 已经做到，不用停）');
}

console.log('14) 每一步停住时，引导真的画出来了');
{
  const E = go();
  const seen = follow(E, 90);
  for (const k of ['left', 'right', 'steer', 'run', 'burst', 'prop']) {
    ok(seen.shown[k] === true, '「' + E.run('H_TUT.find(t => t.key === "' + k + '").title') + '」停住时：卡片、暗屏、手指都画出来了', seen.shown[k]);
  }
  const F = go();
  F.run('hTutGo(4);'); F.texts.length = 0; F.step(20);
  F.arcs.ccw = 0; F.run('render();');
  ok(F.run('hTutFz') && F.run('hTutA') > 0.9 && F.arcs.ccw === 1 && F.texts.indexOf('怒气满了 · 点「连斩」') >= 0,
     '「连斩」一进来就停：0.3 秒内卡片淡入、「连斩」键挖亮（以前停着什么都不画）', F.run('hTutA').toFixed(2) + ' / ' + F.arcs.ccw);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
