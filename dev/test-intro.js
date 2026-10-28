/* 开场（背景故事，2.10 节）测试
   1) 主界面点开始：先放开场 5 句（停电、嘉欣被卷到最深处）；说话时世界停着、不刷怪
   2) 对话：刚出来的一下点了不算；字没打完先全显示，打完再换下一句；说完开打
   3) 「跳过」直接开打；测试数据记打开 / 看完 / 跳过、第几句跳的
   4) 每次从主界面开局都放；结算页「再来一局」不放（重开要快）
   5) 新玩家：放完开场接着走新手教学
   6) 主界面副标题、死亡页那一句接上"去救嘉欣"
   7) 画面：两种屏高下开场每一句都画得出来，长句子按框宽折行
   8) 黑潮的开场剧情（体育生追嘉欣）：主界面开始才放（先问广告再放）、再来一局不放、能跳过；死因叫嘉豪 */
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
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
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
  vm.runInContext("CFG.mainMode = 'classic';", sb);   // 这里测的是正式玩法的主界面（主玩法现在是黑潮）
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const f = raf; raf = null; if (!f) break; simT += 16.7; f(simT); } }
  const tap = (x, y) => run('onTouchStart({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] }); onTouchEnd({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  return { run, step, tap, tapRect };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

console.log('1) 主界面点开始：先放开场');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;'); E.step(5);
  E.tap(195, 300);
  ok(E.run('state') === 'talk' && E.run('talk.lines.length') === 5, '点屏幕：先放开场 5 句', E.run('state'));
  ok(/最深处/.test(E.run('INTRO.map(l => l[1]).join("")')), '开场交代：嘉欣被卷到了最深处');
  const g0 = E.run('gameTime');
  E.step(90);
  ok(E.run('gameTime') === g0 && E.run('enemies.length') === 0, '说话的时候世界停着、不刷怪');
}

console.log('2) 对话：防连点、先补全、说完开打');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;'); E.step(5);
  E.tap(195, 300);
  E.step(3);
  E.tap(195, 500);
  ok(E.run('talk.i') === 0 && E.run('talkShown()') < 3, '刚出来就点：不算');
  E.step(10);
  E.tap(195, 500);
  const n0 = E.run('Array.from(talk.lines[0][1]).length');
  ok(E.run('talk.i') === 0 && E.run('talkShown()') >= n0, '字没打完：先一下子全显示', E.run('talkShown()') + '/' + n0);
  E.step(10);
  E.tap(195, 500);
  ok(E.run('talk.i') === 1, '打完了再点：下一句');
  for (let i = 0; i < 20 && E.run('state') === 'talk'; i++) { E.step(40); E.tap(195, 500); }
  ok(E.run('state') === 'play' && E.run('talk') === null, '五句说完：开打', E.run('state'));
  ok(E.run('layerFxT') > 1, '开打先放"第 1 层"横幅');
  const a = E.run('TEST.talk["开场"]');
  ok(a && a[0] === 1 && a[2] === 1 && a[1] === 0, '测试数据：开场打开 1 次、看完 1 次', JSON.stringify(a));
  E.step(120);
  ok(E.run('state') === 'play' && E.run('gameTime') > 1.5, '开打以后时间照常走');
}

console.log('3) 跳过');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;'); E.step(5);
  E.tap(195, 300);
  E.step(30);
  E.tap(195, 500);                 // 第 1 句补全
  E.step(10);
  E.tap(195, 500);                 // 到第 2 句
  E.tapRect(E.run('talkSkipBtn()'));
  ok(E.run('state') === 'play' && E.run('talk') === null, '「跳过」：直接开打', E.run('state'));
  const a = E.run('TEST.talk["开场"]');
  ok(a && a[1] === 1 && a[3] === 2, '测试数据：跳过 1 次，第 2 句跳的', JSON.stringify(a));
  ok(/【剧情】累计 打开\/看完\/跳过：开场 1\/0\/1（平均第 2.0 句跳）/.test(E.run('testReport().join("\\n")')), '报告里写着');
}

console.log('4) 每次从主界面开局都放；结算页再来一局不放');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;'); E.step(5);
  E.tap(195, 300);
  E.tapRect(E.run('talkSkipBtn()'));
  E.run('P.inv = 0; shield = 0; die("杂兵"); finishRun();');
  ok(E.run('state') === 'over', '（死了，结算页）');
  E.step(40);
  E.tapRect(E.run('overBtns().retry'));
  ok(E.run('state') === 'play' && E.run('talk') === null, '「再来一局」：直接开打，不放开场', E.run('state'));
  E.run('P.inv = 0; shield = 0; die("杂兵"); finishRun();');
  E.step(40);
  E.tapRect(E.run('overBtns().home'));
  ok(E.run('state') === 'ready', '（回主界面）');
  E.tap(195, 300);
  ok(E.run('state') === 'talk', '主界面再开一局：又放开场', E.run('state'));
  ok(E.run('TEST.talk["开场"][0]') === 2, '测试数据：开场打开 2 次');
  E.tapRect(E.run('talkSkipBtn()'));
  E.run('pauseGame();');
  E.tapRect(E.run('pauseLayout().end'));
  ok(E.run('state') === 'over', '暂停里结束本局：照常结算', E.run('state'));
}

console.log('5) 新玩家：放完开场接着教');
{
  const E = makeEnv();
  E.run('meta.tut = 0;'); E.step(5);
  E.tap(195, 300);
  ok(E.run('state') === 'talk', '先放开场');
  ok(E.run('tutOn()'), '教学已经备好');
  E.tapRect(E.run('talkSkipBtn()'));
  ok(E.run('state') === 'play' && E.run('tutOn()') && E.run('tutStep') === 0, '跳过开场：从教学第一步开始');
}

console.log('6) 文案接上"去救嘉欣"');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;'); E.step(5);
  ok(E.run('THEME.subtitle') === '嘉欣被卷走了。往下斩，去救她。', '主界面副标题');
  E.run('start(); P.inv = 0; shield = 0; meta.depthBest = 9; die("杂兵");');
  E.step(30);
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err && !E.run('layerBestNew'), '死亡页画得出来（没破最深：嘉欣还在更深处）', err && err.message);
  E.run('toReady(); meta.depthBest = 0; start(); P.inv = 0; shield = 0; layer = 2; die("杂兵");');
  E.step(30);
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err && E.run('layerBestNew'), '死亡页画得出来（破了最深：从没斩到过这么深）', err && err.message);
}

console.log('7) 画面');
for (const h of [844, 667]) {
  const E = makeEnv(h);
  E.run('meta.tut = TUT_DONE;'); E.step(5);
  let err = null;
  try {
    E.tap(195, 300);
    for (let i = 0; i < 5; i++) { E.step(40); E.run('render();'); E.run('talk.t = 9; talkNext();'); }
  } catch (e) { err = e; }
  ok(!err && E.run('state') === 'play', h + 'px：开场每一句（旁白、全班、子涵、嘉豪）都画得出来', err && err.message);
  // 测试画布量字按每字 10 像素：30 个字、框宽 200 → 要折成两行，每行不超宽
  const lines = E.run('wrapCJK("嘉豪，嘉欣呢？刚才还坐你后面。她明明说好一起逃晚自习的。", 200)');
  ok(lines.length === 2 && lines.every(s => s.length * 10 <= 200), h + 'px：长句子按框宽折行', JSON.stringify(lines));
}

console.log('8) 黑潮的开场剧情（用户："最好你可以开局做个剧情，嘉欣被嘉豪吸引走了，然后体育生发怒要追回嘉欣"）');
{
  const E = makeEnv();
  E.run("CFG.mainMode = 'horde'; HD.tut = false; HD.preAd = false; meta.runs = 5; meta.htut = H_TUT_VER; meta.tut = TUT_DONE;"); E.step(5);
  const all = E.run('INTRO_H.map(l => l[1]).join("")'), who = E.run('INTRO_H.map(l => l[0]).join(",")');
  ok(/嘉欣被嘉豪们吸引走了/.test(all) && /体育生/.test(E.run('TALKERS.tiyu.name')) && /tiyu/.test(who) && /jiaxin/.test(who) && /jiahao/.test(who),
    '剧情：嘉欣、嘉豪、体育生都出场；嘉欣被嘉豪们吸引走了');
  ok(E.run('INTRO_H[INTRO_H.length - 1][0]') === 'tiyu' && /嘉欣/.test(E.run('INTRO_H[INTRO_H.length - 1][1]')), '最后一句：体育生发怒，要追回嘉欣', E.run('INTRO_H[INTRO_H.length - 1][1]'));
  E.tap(195, 420);
  ok(E.run('state') === 'talk' && E.run('talk.key') === '黑潮开场' && E.run('talk.lines === INTRO_H'), '主界面点开始：先放剧情', E.run('state'));
  // 一句一句点过去：说完开打
  let n = 0;
  while (E.run('state') === 'talk' && n < 40) { E.step(10); E.tap(195, 600); n++; }
  ok(E.run('state') === 'play' && E.run('hordeMode') && E.run('TEST.talk["黑潮开场"][2]') === 1, '说完：开打（黑潮）', E.run('state'));
  // 死了 →「再来一局」：不放
  E.run('P.inv = 0; hLives = 1; HD.lives = 1; hRevives = H_REVIVE.max; die("黑潮");'); E.step(Math.ceil((E.run('DEAD_LOOK') + 0.6) / 0.0167));
  E.tapRect(JSON.parse(E.run('JSON.stringify(hordeEndBtns().go)'))); E.step(1);
  ok(E.run('state') === 'play' && E.run('talk') === null, '「再来一局」：直接开打，不放剧情', E.run('state'));
  // 回主界面再开：又放；右上角跳过直接开打
  E.run('P.inv = 0; hLives = 1; hRevives = H_REVIVE.max; die("黑潮");'); E.step(Math.ceil((E.run('DEAD_LOOK') + 0.6) / 0.0167));
  E.tapRect(JSON.parse(E.run('JSON.stringify(hordeEndBtns().back)'))); E.step(5);
  ok(E.run('state') === 'ready', '（回主界面）', E.run('state'));
  E.tap(195, 420); E.step(10);
  ok(E.run('state') === 'talk', '主界面再开：又放剧情', E.run('state'));
  E.tapRect(E.run('talkSkipBtn()'));
  ok(E.run('state') === 'play' && E.run('hordeMode'), '跳过：直接开打');
  // 开局前问广告那一页：先问，选完再放剧情
  E.run('P.inv = 0; hLives = 1; hRevives = H_REVIVE.max; die("黑潮");'); E.step(Math.ceil((E.run('DEAD_LOOK') + 0.6) / 0.0167));
  E.tapRect(JSON.parse(E.run('JSON.stringify(hordeEndBtns().back)'))); E.step(5);
  E.run('HD.preAd = true; PROP.on = true;');
  E.tap(195, 420); E.step(2);
  ok(E.run('state') === 'preAd', '有「带个道具开局？」那一页：先问', E.run('state'));
  E.step(20);                                                  // 刚出来 0.25 秒内点了不算
  E.tapRect(E.run('preAdLayout().go')); E.step(2);
  ok(E.run('state') === 'talk' && E.run('talk.key') === '黑潮开场', '选完（不带）：再放剧情', E.run('state'));
  E.tapRect(E.run('talkSkipBtn()'));
  ok(E.run('state') === 'play', '跳过：开打');
  // 关掉（HD.story = false）就不放
  const F = makeEnv();
  F.run("CFG.mainMode = 'horde'; HD.tut = false; HD.preAd = false; HD.story = false; meta.runs = 5; meta.htut = H_TUT_VER;"); F.step(5);
  F.tap(195, 420);
  ok(F.run('state') === 'play', 'HD.story 关掉：直接开打', F.run('state'));
  // 死因换成嘉豪的叫法：撞上杂兵 = 撞上了小嘉豪；被黑潮追上 = 嘉豪潮
  const G = makeEnv();
  G.run("CFG.mainMode = 'horde'; runDeaths = [['杂兵', 0, 1]];");
  const a = JSON.parse(G.run('JSON.stringify(hDeathWhy())'));
  G.run("runDeaths = [['黑潮', 0, 1]];");
  const b = JSON.parse(G.run('JSON.stringify(hDeathWhy())'));
  ok(a[1] === '撞上了小嘉豪' && /嘉豪潮/.test(b[0] + b[1]), '死因：撞上了小嘉豪 / 被嘉豪潮淹没了', JSON.stringify([a, b]));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
