/* 测试数据页测试（CFG.testPanel，见 game.js「14.9 测试数据」）
   1) 一局打完记一条：层 / 秒 / 分 / 斩 / 连斩 / 复活、每次死因、帧数、每层帧数、每帧分段毫秒；存进本地，重开还在
   2) 死因：碰到怪记怪名，炸到记"爆炸"
   3) 最多留 10 局
   4) 主界面左下角点进去；「复制」把整份报告交给剪贴板；「清空」要连点两下；「返回」回主界面
   5) 报错：每帧里的错记下来，下一帧照跑（不再往外抛，见 frame），同一句只数次数
   6) 关掉 CFG.testPanel：不记、左下角点了照常开局 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv(init) {
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
  const storage = Object.assign({}, init || {});
  const clip = [];
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 44, bottom: 810 } }),
    getSystemInfoSync: () => ({ brand: 'Xiaomi', model: 'TEST-1', system: 'Android 13', appName: 'Douyin', version: '30.1.0', SDKVersion: '3.38.0', pixelRatio: 3 }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
    vibrateShort() {}, vibrateLong() {},
    setClipboardData: o => { clip.push(o.data); if (o.success) o.success(); },
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {},
    performance: { now: () => simT },
    requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, TypeError, isNaN, parseInt, parseFloat,
    navigator: { userAgent: 'headless' }
  };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext("CFG.mainMode = 'classic';", sb);   // 这里测的是正式玩法的主界面（主玩法现在是黑潮）
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) break; simT += 16.7; cb(simT); } }
  const tap = (x, y) => run('onTouchStart({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] }); onTouchEnd({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  return { run, step, tap, tapRect, storage, clip, raf: () => raf };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

// 打一局：无敌跑 n 帧（第 1 层），换到第 2 层再跑一会儿，然后死在 who 手上、进结算
function playRun(E, frames, who) {
  E.run('meta.tut = TUT_DONE;');
  E.step(3);
  E.run('start(); P.inv = 1e6;');
  E.step(frames);
  E.run('layer = 2;');
  E.step(frames);
  E.run('P.inv = 0; shield = 0; die(' + JSON.stringify(who) + '); finishRun();');
}

console.log('1) 一局打完记一条');
{
  const E = makeEnv();
  E.step(5);
  ok(E.run('TEST.runs.length') === 0, '新存档：还没有记录');
  playRun(E, 120, '重型');
  const r = E.run('TEST.runs[0]');
  ok(r && r.layer === 2 && r.sec > 0 && r.kills >= 0 && r.combo >= 0 && r.rev === 0, '记下层 / 秒 / 斩 / 连斩 / 复活', JSON.stringify(r));
  ok(r.die.length === 1 && r.die[0][0] === '重型' && r.die[0][1] === 2, '死因：重型，第 2 层', JSON.stringify(r.die));
  ok(r.fps > 0 && r.lag >= 0 && r.ms.length === 7, '帧数 / 卡顿 / 每帧分段毫秒都有', r.fps + ' / ' + r.ms.join(','));
  ok(r.lay.length === 2 && r.lay[0][0] === 1 && r.lay[1][0] === 2 && r.lay.every(x => x[2] > 0), '第 1、2 层各有自己的帧数', JSON.stringify(r.lay));
  ok(r.v === E.run('BUILD_TAG') && r.tut === 0, '带版本号，不是教学局');
  const saved = JSON.parse(E.storage.dash_test_v1);
  ok(saved.runs.length === 1 && saved.runs[0].s === r.s, '写进了本地存档');
  const F = makeEnv({ dash_test_v1: E.storage.dash_test_v1 });
  ok(F.run('TEST.runs.length') === 1, '重开游戏：记录还在');
}

console.log('2) 死因');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;'); E.step(3);
  E.run('start(); P.inv = 0; shield = 0; enemies.length = 0; spawnTimer = 1e6;');
  E.run('{ const e = spawnEnemy(P.x + 5, P.y, "charger"); e.mode = "chase"; } update(1 / 60);');
  ok(E.run('runDeaths.length') === 1 && E.run('runDeaths[0][0]') === '冲锋者', '撞上冲锋者：死因记"冲锋者"', E.run('JSON.stringify(runDeaths)'));
  E.run('doRevive(); P.inv = 0; shield = 0; die("爆炸");');
  ok(E.run('runDeaths.length') === 2 && E.run('runDeaths[1][0]') === '爆炸', '复活后再死：第二条死因接着记');
  E.run('start();');
  ok(E.run('runDeaths.length') === 0, '新开一局清零');
}

console.log('3) 最多留 10 局');
{
  const E = makeEnv();
  for (let i = 0; i < 12; i++) { playRun(E, 20, '杂兵'); E.run('toReady();'); }
  ok(E.run('TEST.runs.length') === 10, '打了 12 局，只留最近 10 局', E.run('TEST.runs.length'));
}

console.log('4) 页面：进 / 复制 / 清空 / 返回');
{
  const E = makeEnv();
  playRun(E, 60, '爆裂者');
  E.run('toReady();'); E.step(5);
  E.tapRect(E.run('readyDataBtn()'));
  ok(E.run('state') === 'data', '主界面左下角：进测试数据页', E.run('state'));
  E.step(3);
  const L = E.run('dataLayout()');
  const C = E.run('MENU');
  ok(!C || L.top >= C.bottom, '标题在右上角胶囊下面');
  E.tapRect(L.copy);
  const txt = E.clip[0] || '';
  ok(/【手机】/.test(txt) && /Xiaomi TEST-1/.test(txt) && /【最近一局】/.test(txt) && /死因：爆裂者/.test(txt) && /各层 帧数\/卡顿/.test(txt) && /每帧ms/.test(txt),
     '「复制」：整份报告（机型、最近一局、死因、各层帧数、每帧分段）', txt.split('\n').slice(0, 6).join(' | '));
  E.tapRect(L.clear);
  ok(E.run('TEST.runs.length') === 1, '「清空」点一下不清（防误触）');
  E.tapRect(L.clear);
  ok(E.run('TEST.runs.length') === 0 && JSON.parse(E.storage.dash_test_v1).runs.length === 0, '连点第二下：清空并存档');
  E.tapRect(L.back);
  ok(E.run('state') === 'ready', '「返回」回主界面');
  E.run('openData();'); E.step(30);
  ok(E.raf() !== null, '空记录时画页面不出错');
}

console.log('5) 报错');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;'); E.step(3);
  E.run('start(); P.inv = 1e6;'); E.step(3);
  E.run('globalThis.__d = drawUI; drawUI = function () { throw new TypeError("测试用的错"); };');
  let thrown = false;
  try { E.step(1); } catch (e) { thrown = true; }
  ok(!thrown, '每帧里的错不再往外抛（以前抛出去就不排下一帧，整个游戏卡死）');
  ok(E.run('TEST.errs.length') === 1 && E.run('TEST.errs[0].msg') === '测试用的错' && /play/.test(E.run('TEST.errs[0].where')), '先记进了测试数据：哪句、在哪个界面', E.run('JSON.stringify(TEST.errs[0])'));
  E.run('logErr(new TypeError("测试用的错"), "每帧");');
  ok(E.run('TEST.errs.length') === 1 && E.run('TEST.errs[0].n') === 2, '同一句再出：只数次数（×2）');
  ok(/×2 测试用的错/.test(E.run('testReport().join("\\n")')), '报告里有这条报错');
}

console.log('6) 关掉 CFG.testPanel');
{
  const E = makeEnv();
  E.run('CFG.testPanel = false;');
  playRun(E, 30, '杂兵');
  ok(E.run('TEST.runs.length') === 0, '不记');
  E.run('toReady();'); E.step(5);
  E.tapRect(E.run('readyDataBtn()'));
  ok(E.run('state') === 'talk', '左下角点了照常开局（先放开场）', E.run('state'));
}

console.log('7) 测试无敌 / 跳层');
{
  const E = makeEnv();
  E.run('toReady(); openData();'); E.step(3);
  const L = E.run('dataLayout()');
  E.tapRect(L.god);
  ok(E.run('TEST.god') === true && JSON.parse(E.storage.dash_test_v1).god === true, '测试数据页「无敌」：打开并存档');
  E.tapRect(L.back);
  E.run('meta.tut = TUT_DONE; start(); P.inv = 0; shield = 0; enemies.length = 0; spawnTimer = 1e6;');
  E.run('{ const e = spawnEnemy(P.x + 5, P.y, "grunt"); } update(1 / 60); update(1 / 60);');
  ok(E.run('state') === 'play' && E.run('runDeaths.length') === 0, '无敌：撞上怪不死');
  E.run('die("爆炸");');
  ok(E.run('state') === 'play', '无敌：炸到也不死');
  E.step(2);
  const lay0 = E.run('layer');
  E.tapRect(E.run('godSkipBtn()'));
  ok(E.run('layer') === lay0 + 1, '「跳层」：直接破门进下一层', lay0 + ' → ' + E.run('layer'));
  E.tapRect(E.run('godSkipBtn()'));
  ok(E.run('layer') === lay0 + 2, '再点再进一层');
  E.step(30);
  E.run('TEST.god = false; die("杂兵"); finishRun();');
  ok(E.run('TEST.runs[0].god') === 1 && /无敌测试/.test(E.run('testReport().join("\\n")')), '这一局记成"无敌测试"');
  E.run('toReady(); start();'); E.step(2);
  const lay1 = E.run('layer');
  E.tapRect(E.run('godSkipBtn()'));
  ok(E.run('layer') === lay1, '无敌关了：左上角那块点了不跳层');
}

console.log('8) 画布测速');
{
  const E = makeEnv();
  E.run('openData();'); E.step(3);
  E.tapRect(E.run('dataLayout()').bench);
  const b = E.run('TEST.bench');
  ok(b && b.items.length >= 10 && b.items.every(x => typeof x[1] === 'number' && x[1] >= 0), '测出 ' + (b ? b.items.length : 0) + ' 项，每项都有微秒数');
  ok(/【画布测速】/.test(E.run('testReport().join("\\n")')), '报告里有测速结果');
  ok(JSON.parse(E.storage.dash_test_v1).bench.items.length === b.items.length, '存进了本地');
  E.step(10);
  ok(E.raf() !== null, '测完页面照常画');
}

console.log('9) 补充的数据');
{
  const E = makeEnv();
  E.run('meta.lv = { reach: 2, focus: 1 }; meta.tut = TUT_DONE;'); E.step(3);
  E.run('start(); P.inv = 1e6; attackHeld = true; touchId = 5;');
  E.step(200);
  E.run('layer = 2;'); E.step(100);
  E.run('touchId = null; attackHeld = false; P.inv = 0; shield = 0; die("重型"); finishRun();');
  const r = E.run('TEST.runs[0]');
  ok(r.hist.length === 6 && Math.abs(r.hist.reduce((a, b) => a + b, 0) - 100) < 1, '帧间隔分布加起来 100%', r.hist.join(','));
  ok(r.layTop.length === 2 && r.layTop[0][1].length > 0, '各层各自最慢的几项', JSON.stringify(r.layTop));
  ok(r.cnt.length === 6 && r.cnt[1] >= r.cnt[0], '同屏怪 / 粒子 / 墨渍 平均和最多', r.cnt.join(','));
  ok(r.dash > 0 && r.auto > 0 && r.auto <= r.dash, '冲刺次数和其中按住自动接的', r.dash + ' / ' + r.auto);
  ok(r.drag > 90, '拖着移动的时间占比', r.drag);
  ok(r.lv.reach === 2 && r.lv.focus === 1, '开局带的技能');
  ok(Array.isArray(r.big) && r.big.length <= 3, '最卡的几帧（最多 3 帧）');
  const txt = E.run('testReport().join("\\n")');
  ['各层最慢：', '帧间隔：', '同屏 平均/最多', '操作：冲刺', '技能：延锋2 聚光1', '音频'].forEach(k => ok(txt.indexOf(k) >= 0, '报告里有「' + k + '」'));
  E.run('toReady(); start(); die("杂兵"); startAd("revive"); endAd(true); P.inv = 0; shield = 0; die("杂兵"); startAd("revive"); endAd(false);');
  ok(JSON.stringify(E.run('TEST.ads.revive')) === '[2,1,1]', '广告：复活 点 2 次、看完 1 次、没看成 1 次', JSON.stringify(E.run('TEST.ads.revive')));
  ok(/【广告】累计/.test(E.run('testReport().join("\\n")')), '报告里有广告累计');
}

console.log('10) 黑潮：在屏幕里 / 不在 各自最慢的几项；最卡的几帧卡在哪一项、有没有现做贴图 / 地面块（用户："现在黑潮出现在屏幕还是会卡"）');
{
  const E = makeEnv();
  E.run('meta.runs = 5; meta.htut = H_TUT_VER; HD.intro = false; HD.tut = false;'); E.step(3);
  E.run('startHorde(); P.inv = 1e6;'); E.step(30);
  // 模拟里一帧之内时间不走，ptFn 量不出毫秒：直接往回拨 ptFnAt 造出"这一项花了几毫秒"
  E.run('ptOn = true; hInkFrac = 0.5; ptFnAt = nowMs() - 6; ptFn("黑潮"); ptFnAt = nowMs() - 2; ptFn("敌人");');
  E.run('hInkFrac = 0; ptFnAt = nowMs() - 3; ptFn("背景"); PERF.ink[0][0] += 1; PERF.ink[1][0] += 1;');
  ok(E.run('PTFI[0]["黑潮"]') >= 6 && !E.run('PTFI[1]["黑潮"]') && E.run('PTFI[1]["背景"]') >= 3, '黑潮在屏幕里 / 不在 分开记', E.run('JSON.stringify(PTFI)'));
  ok(E.run('FR.n') === '黑潮' && E.run('FR.d') >= 6, '这一帧最慢的一项', E.run('JSON.stringify(FR)'));
  E.run('FR.tx = 2; FR.bg = 1; testSample(90);');
  const b = E.run('PERF.big[0]');
  ok(b[0] === 90 && b[6] === '黑潮' && b[7] >= 6 && b[8] === 2 && b[9] === 1, '最卡的一帧：记上卡在哪一项、几毫秒、现做了几张贴图 / 几块地面', JSON.stringify(b));
  E.run('FR.tx = 99; FR.bg = 99;'); E.step(1);
  ok(E.run('FR.tx') < 99 && E.run('FR.bg') < 99, '下一帧重新数（上一帧的清掉）', E.run('JSON.stringify(FR)'));
  E.run('hLives = 1; P.inv = 0; die("杂兵"); finishRun();');
  const txt = E.run('testReport().join("\\n")');
  ok(/黑潮在屏幕里最慢：黑潮 [\d.]+/.test(txt) && /｜ 不在：背景 /.test(txt), '报告里有「黑潮在屏幕里最慢 / 不在」', (txt.match(/黑潮在屏幕里最慢.*/) || [''])[0]);
  ok(/90ms（[^）]*最慢 黑潮 \d+ms · 现做贴图 2 · 地面块 1）/.test(txt), '报告的最卡几帧里有卡在哪一项', (txt.match(/最卡的几帧.*/) || [''])[0]);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
