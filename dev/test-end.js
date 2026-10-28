/* 结算三页 + 开局前那一页测试 —— 用户："结算画面要改成三个，刚死的时候，给他5秒钟选择是否复活，如果他选择不复活，那就跳转到获得多少箱子的页面，
   如果他选择继续或者没获得箱子，那么就进入排名界面，直接在排名的下面选择是否再来一局或者返回主界面"；
   "开局是否看广告开始，我们放在开始动画之前，单独搞一个画面，让他选择，选择时间五秒"
   1) 复活页：5 秒没选 = 不复活；「不用了」；看完广告原地回来；没看完再给 3 秒；刚换页的手指不算
   2) 宝箱页：这局升级送了宝箱才有；「开箱」开完「收下」到排名页；「继续」留着以后开
   3) 没得复活、没宝箱：直接排名页
   4) 排名页：「再来一局」先到开局前那一页；「返回主界面」
   5) 键盘（浏览器）：空格一页页往下翻 */
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
    Math: Object.create(Math), Date,   // 每个环境自己一个 Math：测试里改 Math.random 不影响别的环境 JSON, Promise, Error, isNaN, parseInt, parseFloat,
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

const J = (E, c) => JSON.parse(E.run('JSON.stringify(' + c + ')'));
function play(E, pre) {
  E.run('state = "ready"; meta.runs = 5;' + (pre || '')); E.step(3);
  E.tap(195, 420);
  E.run('enemies.length = 0; hNext = 1e9; hPath.length = 0; hPathLive = false; hCandy = []; hCandyNext = 1e12; hPropNext = 1e12; hSurgeT = 1e9; HD.v0 = 0; HD.vWave = 0; HD.catchK = 0; hFront = wwrap(P.y + hGapMax()); P.inv = 1e9;');
  E.step(2);
}
// 死了，等到结算页能点（死的那一下有 0.1 秒顿帧不走表）
function dieNow(E) { E.run('P.inv = 0; hLives = 1; HD.lives = 1;'); E.run('die("黑潮");'); E.step(Math.ceil((E.run('DEAD_LOOK') + 0.6) / 0.0167)); }

const btn = (E, k) => { const s = E.run('JSON.stringify(hordeEndBtns().' + k + ' || null)'); return JSON.parse(s); };
// 这一局做完三个任务（任务轮着来：做完第三个当场升级送宝箱）
const allDone = E => E.run('meta.hq.k = 0; for (var i = 0; i < 3; i++) hqComplete(0);');

console.log('1) 复活页');
{
  const E = makeEnv();
  play(E); dieNow(E);
  ok(E.run('state') === 'dead' && E.run('hEnd') === 'revive' && btn(E, 'revive') && btn(E, 'skip'), '死了：先到复活页（「看广告 · 复活」「不用了」）');
  E.texts.length = 0; E.step(1);
  ok(E.texts.indexOf('看广告 · 复活') >= 0 && E.texts.indexOf('不用了') >= 0 && E.texts.indexOf('5') >= 0, '画着倒计时 5');
  E.step(Math.ceil(5.1 / 0.0167));
  ok(E.run('hEnd') === 'rank', '5 秒没选：当不复活，到排名页（没升级、没宝箱）');
  // 「不用了」
  const F = makeEnv();
  play(F); dieNow(F);
  F.tapRect(btn(F, 'skip'));
  ok(F.run('hEnd') === 'rank', '点「不用了」：到排名页');
  F.tapRect(btn(F, 'go'));
  ok(F.run('state') === 'dead', '刚换页的那一下手指不算（不会顺手点到「再来一局」）');
  // 看完广告：原地回来
  const G = makeEnv();
  play(G); dieNow(G);
  G.tapRect(btn(G, 'revive')); G.run('finishAd();');
  ok(G.run('state') === 'play' && G.run('hLives') >= 1, '看完广告：原地回来');
  G.run('P.inv = 0; hHurtT = 0; hLives = 1;'); G.run('die("黑潮");'); G.step(60);
  ok(G.run('hEnd') === 'rank', '这局复活过了：再死直接到排名页');
}

console.log('2) 宝箱页');
{
  const E = makeEnv();
  play(E, 'meta.bx.n = 0; meta.hq.lv = 1;'); allDone(E); dieNow(E);
  E.tapRect(btn(E, 'skip')); E.step(20);
  ok(E.run('hEnd') === 'box' && E.run('meta.bx.n') === 1, '升级送了 1 个宝箱：不复活 → 宝箱页');
  E.texts.length = 0; E.step(1);
  ok(E.texts.indexOf('拿到 1 个宝箱') >= 0 && E.texts.indexOf('开箱') >= 0 && E.texts.indexOf('继续（留着以后开）') >= 0, '「拿到 1 个宝箱」「开箱」「继续（留着以后开）」');
  E.tapRect(btn(E, 'open'));
  ok(E.run('state') === 'box' && E.run('bxRes.list.length') === 1 && E.run('meta.bx.n') === 0, '「开箱」：开这局拿到的 1 个');
  E.run('bxRes.at = -1e9;'); E.tapRect(E.run('boxLayout().back'));
  ok(E.run('state') === 'dead' && E.run('hEnd') === 'rank', '「收下」：到排名页');
  // 「继续」：留着
  const F = makeEnv();
  play(F, 'meta.bx.n = 2; meta.hq.lv = 4;'); allDone(F); dieNow(F);
  F.tapRect(btn(F, 'skip')); F.step(20);
  ok(F.run('hEnd') === 'box' && F.run('hqUp.box') === 10 && F.run('meta.bx.n') === 12, '升到 Lv.5：送 10 个（原来 2 个，一共 12）');
  F.tapRect(btn(F, 'next'));
  ok(F.run('hEnd') === 'rank' && F.run('meta.bx.n') === 12, '「继续」：到排名页，宝箱留着');
  // 宝箱页「开箱」只开这局拿到的
  const G = makeEnv();
  play(G, 'meta.bx.n = 5; meta.hq.lv = 4;'); allDone(G); dieNow(G);
  G.tapRect(btn(G, 'skip')); G.step(20); G.tapRect(btn(G, 'open'));
  ok(G.run('bxRes.list.length') === 10 && G.run('meta.bx.n') === 5, '开这局拿到的 10 个，原来攒的 5 个还留着');
}

console.log('3) 没得复活、没宝箱：直接排名页');
{
  const E = makeEnv();
  play(E, 'hRevives = 0;'); E.run('hRevives = H_REVIVE.max;'); dieNow(E);
  ok(E.run('hEnd') === 'rank', '复活用过了、没升级：直接排名页');
  E.texts.length = 0; E.step(1);
  ok(E.texts.indexOf('再来一局') >= 0 && E.texts.indexOf('返回主界面') >= 0 && E.texts.some(t => t.indexOf('逃了') === 0), '排名页：跑了多少、「再来一局」「返回主界面」');
  // 复活过、升级了：直接宝箱页
  const F = makeEnv();
  play(F); F.run('hRevives = H_REVIVE.max;'); allDone(F); dieNow(F);
  ok(F.run('hEnd') === 'box', '复活用过了、升级了：直接宝箱页');
}

console.log('4) 排名页');
{
  const E = makeEnv();
  play(E); E.run('hRevives = H_REVIVE.max; HD.preAd = true;'); dieNow(E);
  E.tapRect(btn(E, 'go')); E.step(1);
  ok(E.run('state') === 'preAd', '「再来一局」：先到「带个道具开局？」那一页');
  E.step(Math.ceil(5.2 / 0.0167));
  ok(E.run('state') === 'play' && E.run('hordeMode'), '5 秒没选：直接开始');
  E.run('hRevives = H_REVIVE.max;'); dieNow(E);
  E.tapRect(btn(E, 'back'));
  ok(E.run('state') === 'ready' && !E.run('hordeMode'), '「返回主界面」');
}

console.log('5) 键盘（浏览器）');
{
  const E = makeEnv();
  play(E, 'meta.hq.lv = 1;'); allDone(E); dieNow(E);
  const key = k => E.run('onKeyDown && onKeyDown({ key: "' + k + '", preventDefault: function () {} })');
  const has = E.run('typeof onKeyDown === "function"');
  if (has) {
    key(' ');
    ok(E.run('hEnd') === 'box', '复活页按空格：不复活 → 宝箱页');
    key(' ');
    ok(E.run('hEnd') === 'rank', '宝箱页按空格：继续 → 排名页');
    key(' ');
    ok(E.run('state') === 'play', '排名页按空格：再来一局（测试里不问广告）');
  } else ok(true, '（没有键盘入口，跳过）');
}

console.log('6) 出错不卡死（用户："每次玩到这个附近就开始卡死"：以前一帧出错就不排下一帧，整个游戏定住）');
{
  const E = makeEnv();
  play(E);
  E.run('TEST.errs = []; var __n = 0, __u = hTickHorde; hTickHorde = function (dt) { if (++__n === 3) throw new Error("测试出错"); return __u(dt); };');
  let thrown = null;
  try { E.step(10); } catch (e) { thrown = e; }
  ok(!thrown && E.run('__n') >= 9 && E.run('state') === 'play', '这一帧出错：不往外抛，下一帧照跑（又跑了 ' + (E.run('__n') - 3) + ' 帧）', thrown && thrown.message);
  ok(E.run('TEST.errs.length') === 1 && E.run('TEST.errs[0].msg') === '测试出错' && E.run('TEST.errs[0].v') === E.run('BUILD_TAG'), '错误记进测试数据（带版本号）');
  // 一直出错：一秒多以后这局直接结束
  E.run('hTickHorde = function () { throw new Error("一直出错"); };');
  for (let i = 0; i < 100 && E.run('state') === 'play'; i++) E.step(1);
  ok(E.run('state') === 'dead' && E.run('runDeaths[runDeaths.length - 1][0]') === '出错' && E.run('TEST.errs[0].n') >= 90, '一直出错：一秒多以后这局结束（死因"出错"），不卡在那');
  E.run('hTickHorde = __u;'); E.step(60); E.run('hEndGo("rank");'); E.texts.length = 0; E.step(2);
  ok(E.texts.some(x => x.indexOf('这局先结束，错误记在测试数据里') === 0), '排名页那一行写"这局先结束，错误记在测试数据里"');
  E.run('toReady();'); E.texts.length = 0; E.step(2);
  ok(E.texts.some(t => /^出错 \d+ 次/.test(t)), '主界面左下角红字：这一版出过错，提醒复制测试数据');
}

console.log('7) 每块画布只取一次上下文（1028.0035 真机：跑到 2200 米左右"Maximum call stack size exceeded"——米数贴图每米重画一次、每次都现取上下文）');
{
  const E = makeEnv();
  // 从这儿起新建的画布都记着被 getContext 了几次
  E.run('globalThis.__cvs = []; var __mainG = ctx; MG.createCanvas = function () { var c = { width: 0, height: 0, n: 0, getContext: function () { this.n++; return __mainG; } }; __cvs.push(c); return c; };');
  play(E);
  for (let m = 1; m <= 600; m++) { E.run('hTop = hClimb = ' + m + ' * HD.m;'); E.step(1); }   // 跑 600 米：米数贴图重画 600 次
  E.run('combo = 950; hRage = 100;'); E.step(30);
  const n = J(E, '__cvs.length'), worst = J(E, '__cvs.reduce(function (a, c) { return Math.max(a, c.n); }, 0)');
  ok(n > 3 && worst === 1, '局里新建了 ' + n + ' 块画布（贴图、飘字……），每块只取了一次上下文（最多 ' + worst + ' 次）');
}

console.log('8) 涌浪预警（用户："涌浪要来的时候给个提示吧，也是别用文字直接，现在涌浪来都看不出来啥时候来"）');
{
  const E = makeEnv();
  play(E);
  E.run('hFront = wwrap(P.y + hGapMax()); hWaveT = 0; hSurge = 0; hSurgeT = 0.5;');
  ok(E.run('hSurgeWarn()') === 0, '新一波喘口气的时候（涌浪不倒数）：不提示');
  E.run('hWaveT = 99; hSurgeT = 5;');
  ok(E.run('hSurgeWarn()') === 0, '离涌浪还早：不提示');
  E.run('hSurgeT = 1.5;');
  ok(E.run('hSurgeWarn()') === 1, '还有 ' + E.run('HD.surgePre') + ' 秒以内：第一档（底边淡红光）');
  const o = E.ops, f0 = o.fillRect || 0, s0 = o.stroke || 0, t0 = E.texts.length;
  E.run('drawSurgeWarn();');
  ok((o.fillRect || 0) - f0 === 4 && (o.stroke || 0) === s0 && E.texts.length === t0, '第一档：四笔实心条，没有箭头、没有字');
  E.run('hSurge = 1; hSurgeP = 0.3;');
  ok(E.run('hSurgeWarn()') === 2, '憋着：第二档');
  const s1 = o.stroke || 0;
  E.run('drawSurgeWarn();');
  ok((o.stroke || 0) - s1 === 3 && E.texts.length === t0, '第二档：再加三个往上的箭头（还是没有字）');
  E.run('hSurge = 2;');
  ok(E.run('hSurgeWarn()') === 3, '猛涌：第三档');
  E.run('hProp = { k: "stink", t: 3, T: 5 };');
  ok(E.run('hSurgeWarn()') === 0, '臭水生效（不涌）：不提示');
  E.run('hProp = null; hTut = 0;');
  ok(E.run('hSurgeWarn()') === 0, '新手教程里：不提示');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
