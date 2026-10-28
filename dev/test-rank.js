/* 排行榜（0.5 节 RK + openDataContext/index.js）测试 —— 用户："我们先加上全服排名和好友排名，每次结束默认给玩家看提升多少名"；
   "分数米数各一个排名，玩家可以点击切换"
   1) 开游戏：悄悄登录、补交没交上的最好成绩（米数榜 'default'、分数榜 'score'）、让开放数据域先记名次
   2) 一局结束：破了纪录才交；不管交没交都让开放数据域拿新名次（带上第几局）；交失败下次再交
   3) 结算第三页：排名单独一页（用户："排名单独放"）—— 切换「米数 / 分数」「好友 / 全服」，下面「再来一局 / 返回主界面」
   4) 主界面「排行榜」：打开同一个榜单那一页；老抖音没有开放数据域才弹两个选项拉平台的
   5) 开放数据域：一页榜单（我第几名、升了几名、前 20 个人），新上榜；拿不到；没人上榜；版本太老；复活后再结算还跟局前比
   6) 没有这些接口（浏览器、微信、老抖音）：什么都不画、不报错；假的全服排名关掉了 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(seed, api) {
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
  if (api) Object.assign(tt, api);
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

// 抖音排行榜的假接口：记下每次调用；succeed = false 时交成绩失败
function rankApi(log, opt) {
  opt = opt || {};
  const odc = { canvas: { width: 0, height: 0 }, msgs: [], postMessage(m) { this.msgs.push(JSON.parse(JSON.stringify(m))); } };
  log.odc = odc;
  return {
    login(o) { log.push(['login', o.force]); if (opt.loginFail) o.fail && o.fail({ errMsg: 'no' }); else o.success && o.success({}); },
    setImRankData(o) { log.push(['set', o.zoneId, o.value, o.dataType]); if (opt.setFail) o.fail && o.fail({ errMsg: 'boom' }); else o.success && o.success({}); },
    getImRankList(o) { log.push(['list', o.zoneId, o.suffix, o.relationType, o.rankType]); },
    getOpenDataContext() { return odc; }
  };
}
function boot(seed, opt) {
  const log = [];
  const E = makeEnv(seed, rankApi(log, opt));
  E.step(3);
  return { E: E, log: log };
}
function play(E, pre) {
  E.run('meta.runs = 5;' + (pre || '')); E.step(3);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9;');
}
function dieNow(E) { E.run('P.inv = 0; hLives = 1; HD.lives = 1;'); E.run('die("黑潮");'); }
function toRank(E) { E.run('hEndGo("rank");'); }     // 结算直接翻到排名页（复活页 / 宝箱页在 test-end.js 里测）
const sets = log => log.filter(x => x[0] === 'set');

console.log('1) 开游戏');
{
  const B = boot({ hBest: 1200, hScore: 34567, rk: { m: 1200, s: 0 } });
  ok(B.log[0] && B.log[0][0] === 'login' && B.log[0][1] === false, '悄悄登录（不弹登录框）');
  const s = sets(B.log);
  ok(s.length === 1 && s[0][1] === 'score' && s[0][2] === '34567' && s[0][3] === 0, '米数 1200 交过了不再交；分数 34567 没交过：交到分数榜（分区 score，数字）', JSON.stringify(s));
  ok(B.E.run('meta.rk.s') === 34567, '交上了记下来');
  ok(B.log.odc.msgs.some(m => m.t === 'fetch' && m.base), '让开放数据域先记一下现在的名次');
  const C = boot({ hBest: 0, hScore: 0 });
  ok(sets(C.log).length === 0, '新玩家没成绩：什么都不交');
}

console.log('2) 一局结束');
{
  const B = boot({ hBest: 100, hScore: 500, rk: { m: 100, s: 500 } });
  play(B.E); B.log.length = 0; B.log.odc.msgs.length = 0;
  B.E.run('hTop = 50 * HD.m; score = 300;');
  dieNow(B.E);
  ok(sets(B.log).length === 0, '没破纪录（50 米 / 300 分）：不交');
  const f1 = B.log.odc.msgs.filter(m => m.t === 'fetch');
  ok(f1.length === 1 && !f1[0].base && f1[0].run === B.E.run('hqRunN'), '照样让开放数据域拿新名次（带上第几局 ' + B.E.run('hqRunN') + '）', JSON.stringify(B.log.odc.msgs));
  B.E.run('hRevive(); P.inv = 1e9; hTop = 260 * HD.m; score = 900;');
  B.log.odc.msgs.length = 0;
  dieNow(B.E);
  const s = sets(B.log);
  ok(s.length === 2 && s.some(x => x[1] === 'default' && x[2] === '260') && s.some(x => x[1] === 'score' && x[2] === '900'), '复活后跑到 260 米 / 900 分（都破纪录）：米数榜交 260，分数榜交 900', JSON.stringify(s));
  const f2 = B.log.odc.msgs.filter(m => m.t === 'fetch');
  ok(f2.length === 1 && f2[0].run === B.E.run('hqRunN'), '两个都交完才让那边拿一次名次（还是同一局）');
  ok(B.E.run('meta.rk.m') === 260 && B.E.run('meta.rk.s') === 900, '记下交上去的');
  // 交失败：下次再交
  const F = boot({ hBest: 100, hScore: 500, rk: { m: 100, s: 500 } }, { setFail: true });
  play(F.E); F.E.run('hTop = 300 * HD.m; score = 10;'); dieNow(F.E);
  ok(F.E.run('meta.rk.m') === 100 && F.E.run('rkErr').indexOf('boom') >= 0 && F.log.odc.msgs.some(m => m.t === 'fetch' && !m.base), '交失败：不记，rkErr 写着原因，照样让那边拿名次');
}

console.log('3) 结算第三页：排名单独一页（用户："排名单独放"）');
{
  const B = boot({ hBest: 100, hScore: 500, rk: { m: 100, s: 500 } });
  play(B.E); dieNow(B.E); toRank(B.E);
  B.E.texts.length = 0; B.E.step(80);
  const L = JSON.parse(B.E.run('JSON.stringify(hordeDeadLayout().board)'));
  ok(L && ['米数', '分数', '好友', '全服', '再来一局', '返回主界面'].every(x => B.E.texts.indexOf(x) >= 0), '有开放数据域：「米数 / 分数」「好友 / 全服」、榜单、下面「再来一局 / 返回主界面」');
  ok(L.odc.h > B.E.run('H_CSS * 0.4'), '榜单占了大半页（' + Math.round(L.odc.h) + ' 高）');
  ok(B.log.odc.canvas.width === Math.round(L.odc.w * 2) && B.log.odc.canvas.height === Math.round(L.odc.h * 2), '那块画布按像素比定大小（' + B.log.odc.canvas.width + '×' + B.log.odc.canvas.height + '）');
  ok(B.E.texts.indexOf(B.E.run('H_QUEST[meta.hq.q[0].id].txt(meta.hq.q[0].n)')) < 0, '任务卡拿掉了（局里、主界面看得到）');
  B.log.odc.msgs.length = 0;
  B.E.tapRect(L.s);
  ok(B.E.run('rkKind') === 's' && B.log.odc.msgs.some(m => m.t === 'show' && m.kind === 's' && m.rel === 'friend'), '点「分数」：切到分数榜（好友）');
  B.E.tapRect(L.all);
  ok(B.E.run('rkRel') === 'all' && B.log.odc.msgs.some(m => m.t === 'show' && m.kind === 's' && m.rel === 'all'), '点「全服」：切到全服');
  ok(B.E.run('state') === 'dead', '点切换键不会误触「再来一局」');
  B.E.tapRect(B.E.run('hordeEndBtns().back'));
  ok(B.E.run('state') === 'ready', '「返回主界面」');
  // 平台的榜单（老抖音没有开放数据域时用）：没登录先登录（弹框）再拉
  const N = boot({}, { loginFail: true });
  N.E.run('rkLogin = 0; MG.login = function (o) { N_LOG.push(o.force); o.success({}); };'.replace('N_LOG', 'globalThis.__lg = globalThis.__lg || []; __lg'));
  N.E.run('rkOpen("m");');
  ok(N.E.run('JSON.stringify(__lg)') === '[true]' && N.log.filter(x => x[0] === 'list').length === 1, '平台榜单：没登录上，拉之前先登录（这次弹框）');
}

console.log('4) 主界面「排行榜」');
{
  const B = boot();
  B.E.run('state = "ready";'); B.E.step(2);
  B.E.texts.length = 0; B.E.step(1);
  ok(B.E.texts.indexOf('排行榜') >= 0, '主界面有「排行榜」');
  B.log.odc.msgs.length = 0;
  B.E.tapRect(B.E.run('readyRankBtn()')); B.E.step(1);
  ok(B.E.run('state') === 'rankView' && B.log.odc.msgs.some(m => m.t === 'fetch' && m.base), '点了：打开排行榜那一页（同一个榜单），重新拿一遍');
  B.E.texts.length = 0; B.E.step(1);
  ok(['排行榜', '米数', '分数', '好友', '全服', '返回'].every(x => B.E.texts.indexOf(x) >= 0), '标题、切换键、「返回」');
  B.E.tapRect(B.E.run('rankViewLayout().board.m'));
  ok(B.E.run('state') === 'rankView' && B.E.run('rkKind') === 'm', '切换键能点，不会开局');
  B.E.tapRect(B.E.run('rankViewLayout().back'));
  ok(B.E.run('state') === 'ready', '「返回」回主界面');
  // 老抖音（没有开放数据域、有平台榜单）：弹两个选项拉平台的
  const O = boot();
  O.E.run('MG.getOpenDataContext = undefined; state = "ready";'); O.E.step(2);
  O.E.tapRect(O.E.run('readyRankBtn()')); O.E.step(1);
  ok(O.E.run('rkPick') && O.E.run('state') === 'ready', '没有开放数据域：弹「最远米数榜 / 最高分数榜」');
  O.E.tapRect(O.E.run('rkPickLayout().m'));
  const li = O.log.filter(x => x[0] === 'list').pop();
  ok(!O.E.run('rkPick') && li && li[1] === 'default' && li[2] === '米', '选米数榜：拉平台的米数榜');
}

console.log('5) 开放数据域：榜单');
{
  const odcSrc = fs.readFileSync(__dirname + '/../openDataContext/index.js', 'utf8');
  const texts = [], timers = [];
  let onMsg = null, R = {}, fail = false;
  const X = new Proxy({}, { get(t, k) { if (k === 'fillText') return s => texts.push(String(s)); if (k === 'measureText') return s => ({ width: String(s).length * 7 }); return t[k] !== undefined ? t[k] : function () {}; }, set(t, k, v) { t[k] = v; return true; } });
  const C = { width: 0, height: 0, getContext: () => X };
  const names = ['隔壁班的', '路人甲', '我', '卷王之王'];
  const tt = { getSharedCanvas: () => C, onMessage: f => { onMsg = f; },
    getImRankData: o => fail ? o.fail({ errMsg: 'x' }) : o.success({ data: {
      self_item: { rank: R[o.zoneId + '.' + o.relationType] || 0, item: { value: o.zoneId === 'score' ? '17838' : '2246' } },
      self_user_info: { openid: 'ME' },
      items: names.map((n, i) => ({ nick_name: o.relationType === 'all' ? '抖音用户' + i : n, value: String(6000 - i * 1000), openid: n === '我' && o.relationType === 'friend' ? 'ME' : 'u' + i, user_img: '' })) } }) };
  const sb = { tt: tt, setTimeout: f => { timers.push(f); return 1; }, String: String, Math: Math };
  vm.createContext(sb);
  vm.runInContext(odcSrc, sb);
  const send = m => { texts.length = 0; onMsg(m); };
  C.width = 700; C.height = 800; send({ t: 'size', k: 2, kind: 'm', rel: 'friend' });
  ok(texts.indexOf('我') >= 0 && texts.indexOf('—') >= 0, '还没拿：「我 —」');
  R = { 'default.friend': 5, 'default.all': 15234, 'score.friend': 0, 'score.all': 0 };
  send({ t: 'fetch', base: true });
  ok(texts.indexOf('第 5 名') >= 0 && !texts.some(t => t.indexOf('↑') === 0) && texts.indexOf('2,246 米') >= 0, '开游戏先拿一遍：我 第 5 名、我的成绩 2,246 米，不挂"升了"');
  ok(['隔壁班的', '路人甲', '卷王之王'].every(n => texts.indexOf(n) >= 0) && texts.indexOf('6,000 米') >= 0 && texts.indexOf('1') >= 0 && texts.indexOf('4') >= 0, '榜单：名次、昵称、成绩（带单位）');
  R = { 'default.friend': 3, 'default.all': 14890, 'score.friend': 2, 'score.all': 900 };
  send({ t: 'fetch', run: 1 });
  ok(texts.indexOf('第 3 名') >= 0 && texts.indexOf('↑ 2 名') >= 0, '一局结束：好友榜 第 3 名 ↑ 2 名', JSON.stringify(texts.slice(0, 6)));
  send({ t: 'show', kind: 'm', rel: 'all' });
  ok(texts.indexOf('第 14,890 名') >= 0 && texts.indexOf('↑ 344 名') >= 0 && texts.indexOf('抖音用户0') >= 0, '切到全服：第 14,890 名 ↑ 344 名，全服的人');
  send({ t: 'show', kind: 's', rel: 'friend' });
  ok(texts.indexOf('第 2 名') >= 0 && texts.indexOf('新上榜！') >= 0 && texts.indexOf('17,838 分') >= 0, '切到分数榜：以前没上榜，这次上了 → 新上榜！，成绩带"分"');
  send({ t: 'show', kind: 'm', rel: 'friend' });
  ok(timers.length === 1, '一局结束那一轮拿完，等一会儿再拿一遍（刚交的可能还没排进去）');
  R['default.friend'] = 2; texts.length = 0; timers.shift()();
  ok(texts.indexOf('↑ 3 名') >= 0, '再拿一遍：第 2 名，跟局前（第 5 名）比 ↑ 3 名');
  R['default.friend'] = 1;
  send({ t: 'fetch', run: 1 });
  ok(texts.indexOf('↑ 4 名') >= 0, '复活后又结算（同一局）：第 1 名，还跟局前比 ↑ 4 名');
  send({ t: 'fetch', run: 2 });
  ok(texts.indexOf('第 1 名') >= 0 && !texts.some(t => t.indexOf('↑') === 0), '下一局没变：不挂"升了"');
  fail = true; send({ t: 'fetch', run: 3 });
  ok(texts.indexOf('第 1 名') >= 0, '拿不到（接口失败）：还显示上次的名次和榜单');
  // 没人上榜
  const t3 = [], sb3 = { tt: { getSharedCanvas: () => ({ width: 700, height: 800, getContext: () => new Proxy({}, { get(t, k) { if (k === 'fillText') return s => t3.push(String(s)); if (k === 'measureText') return s => ({ width: String(s).length * 7 }); return t[k] !== undefined ? t[k] : function () {}; }, set(t, k, v) { t[k] = v; return true; } }) }), onMessage: f => { sb3.f = f; },
    getImRankData: o => o.success({ data: { self_item: { rank: 0 }, items: [] } }) }, setTimeout: () => 1, String: String, Math: Math };
  vm.createContext(sb3); vm.runInContext(odcSrc, sb3);
  sb3.f({ t: 'fetch', base: true });
  ok(t3.indexOf('还没上榜') >= 0 && t3.some(x => x.indexOf('好友里还没人上榜') === 0), '没人上榜：「还没上榜」「好友里还没人上榜，叫他们来玩」');
  // 版本太老：没有 getImRankData
  const t2 = [], sb2 = { tt: { getSharedCanvas: () => ({ width: 700, height: 800, getContext: () => new Proxy({}, { get(t, k) { if (k === 'fillText') return s => t2.push(String(s)); if (k === 'measureText') return s => ({ width: String(s).length * 7 }); return t[k] !== undefined ? t[k] : function () {}; }, set(t, k, v) { t[k] = v; return true; } }) }), onMessage: f => { sb2.f = f; } }, setTimeout: () => 1, String: String, Math: Math };
  vm.createContext(sb2); vm.runInContext(odcSrc, sb2);
  sb2.f({ t: 'fetch', base: true });
  ok(t2.some(x => x.indexOf('抖音版本太老') === 0), '抖音版本太老（没有 getImRankData）：写明白');
}

console.log('6) 没有这些接口');
{
  const E = makeEnv();
  ok(!E.run('rkCan()') && !E.run('rkBoardOn()') && !E.run('rkCanOpen()'), '浏览器 / 微信 / 老抖音：排行榜整个不开');
  play(E); dieNow(E); toRank(E);
  E.texts.length = 0; E.step(80);
  ok(E.run('hordeDeadLayout().board') === null && E.texts.indexOf('米数') < 0 && E.texts.indexOf('再来一局') >= 0 && E.texts.indexOf(E.run('H_QUEST[meta.hq.q[0].id].txt(meta.hq.q[0].n)')) >= 0, '排名页不画榜单，换成三个任务的卡，别的照旧');
  E.run('state = "ready";'); E.texts.length = 0; E.step(2);
  ok(E.texts.indexOf('排行榜') < 0, '主界面不画「排行榜」');
  ok(E.run('CFG.fakeRank') === false, '假的全服排名关掉了');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
