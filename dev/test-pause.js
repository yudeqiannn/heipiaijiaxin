/* 暂停测试
   1) 局内左上角「Ⅱ」：停住 —— 时间、怪、特效都不走；点了不会顺手开摇杆
   2) 「继续」：接着打，回来给一口无敌
   3) 「结束本局」：直接进结算，这一局照常记（分 / 余光 / 局数 / 测试数据，死因"主动结束"）
   4) 切后台：局内自动停在暂停；不在局内不受影响
   5) 测试无敌：撞不死，靠「结束本局」收尾，记成无敌测试
   6) 左上角一列不打架：暂停、光盾栏、跳层上下错开 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv() {
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
  const storage = {}, cb = {};
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 44, bottom: 810 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {},
    onHide: f => { cb.hide = f; }, onShow: f => { cb.show = f; },
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
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const f = raf; raf = null; if (!f) break; simT += 16.7; f(simT); } }
  const tap = (x, y) => run('onTouchStart({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] }); onTouchEnd({ changedTouches: [{ identifier: 9, clientX: ' + x + ', clientY: ' + y + ' }] });');
  const tapRect = r => tap(r.x + r.w / 2, r.y + r.h / 2);
  return { run, step, tap, tapRect, storage, cb };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
function play(E) {
  E.run('meta.tut = TUT_DONE;'); E.step(3);
  E.run('start(); P.inv = 1e6;'); E.step(120);
}

console.log('1) 暂停：整个停住');
{
  const E = makeEnv();
  play(E);
  E.run('onTouchStart({ changedTouches: [{ identifier: 3, clientX: ' + (E.run('hudPauseBtn().x') + 10) + ', clientY: ' + (E.run('hudPauseBtn().y') + 10) + ' }] });');
  ok(E.run('state') === 'pause', '点左上角「Ⅱ」：暂停', E.run('state'));
  ok(E.run('touchId') === null, '这一下不会顺手开摇杆');
  const g0 = E.run('gameTime'), n0 = E.run('enemies.length'), x0 = E.run('enemies.length ? enemies[0].x : 0'), p0 = E.run('parts.length');
  E.step(120);
  ok(E.run('gameTime') === g0, '停了 2 秒：局内时间没走', g0 + ' / ' + E.run('gameTime'));
  ok(E.run('enemies.length') === n0 && E.run('enemies.length ? enemies[0].x : 0') === x0, '怪没动、没刷新怪');
  ok(E.run('parts.length') === p0, '特效也定住');
}

console.log('2) 继续');
{
  const E = makeEnv();
  play(E);
  E.run('pauseGame(); P.inv = 0;'); E.step(10);
  E.tapRect(E.run('pauseLayout().go'));
  ok(E.run('state') === 'play', '「继续」：回到局内');
  ok(E.run('P.inv') >= 0.5, '回来先给一口无敌（' + E.run('P.inv').toFixed(2) + '）');
  const g0 = E.run('gameTime');
  E.step(30);
  ok(E.run('gameTime') > g0, '时间接着走');
}

console.log('3) 结束本局');
{
  const E = makeEnv();
  play(E);
  E.run('layer = 3; yingRun = 40; score = 1234;');
  const runs0 = E.run('meta.runs'), pts0 = E.run('meta.pts');
  E.run('pauseGame();'); E.step(2);
  E.tapRect(E.run('pauseLayout().end'));
  ok(E.run('state') === 'over', '「结束本局」：直接进结算', E.run('state'));
  ok(E.run('meta.runs') === runs0 + 1 && E.run('meta.pts') >= pts0 + 40, '局数 +1、这局的余光入账', E.run('meta.runs') + ' / ' + E.run('meta.pts'));
  ok(E.run('meta.depthBest') >= 3 && E.run('best') === 1234, '最深层、最高分照常记');
  const r = E.run('TEST.runs[0]');
  ok(r && r.die[r.die.length - 1][0] === '主动结束' && r.layer === 3, '测试数据记了一局，死因"主动结束"', r && JSON.stringify(r.die));
  E.step(30);
  E.tapRect(E.run('overBtns().retry'));
  ok(E.run('state') === 'play', '结算页「再来一局」照常开局', E.run('state'));
}

console.log('4) 切后台');
{
  const E = makeEnv();
  play(E);
  E.cb.hide();
  ok(E.run('state') === 'pause', '局内切后台：停在暂停');
  E.cb.show();
  ok(E.run('state') === 'pause', '回来：还停着，等玩家点「继续」');
  E.run('resumeGame(); finishRun(); toReady();');
  E.cb.hide();
  ok(E.run('state') === 'ready', '主界面切后台：不受影响');
}

console.log('5) 测试无敌靠暂停收尾');
{
  const E = makeEnv();
  E.run('TEST.god = true;');
  play(E);
  E.run('P.inv = 0; shield = 0; die("杂兵");');
  ok(E.run('state') === 'play', '无敌：撞不死');
  E.run('pauseGame();');
  E.tapRect(E.run('pauseLayout().end'));
  ok(E.run('state') === 'over' && E.run('TEST.runs[0].god') === 1, '暂停里「结束本局」：进结算，记成无敌测试');
}

console.log('6) 左上角一列不打架');
{
  const E = makeEnv();
  play(E);
  const p = E.run('hudPauseBtn()'), g = E.run('godSkipBtn()'), top = E.run('hudTop()');
  const yingBottom = E.run('hudYing().y') + 11, shieldTop = top + 136 - 11, shieldBottom = top + 136 + 11;
  ok(p.y >= yingBottom && p.y + p.h <= shieldTop, '暂停在余光和光盾栏之间', JSON.stringify(p));
  ok(g.y >= shieldBottom, '跳层在光盾栏下面', JSON.stringify(g));
  ok(p.x + p.w < E.run('W_CSS') / 2 - 70, '离中间的连斩数字够远');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
