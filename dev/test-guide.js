/* 玩法说明测试
   1) 主界面「玩法说明」进入，「关闭」回主界面
   2) 左右翻页（按钮 / 点示意图左右半边），首页不能往前，最后一页「开始游戏」直接开局
   3) 最后一页「重新体验新手教学」：开一局、从第一步教起
   4) 键盘翻页（浏览器调试用）
   5) 667 / 844 两种屏高：按钮在屏内、互不重叠，最长的说明不压到按钮，主界面入口不压别的按钮
   6) 每一页连续画 3 秒：不抛错、不画 NaN、不碰 shadowBlur */
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
    tt, console, setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
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
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const tap = (E, r) => E.run('onTouchStart({ changedTouches: [{ identifier: 9, clientX: ' + (r.x + r.w / 2) + ', clientY: ' + (r.y + r.h / 2) + ' }] });');

console.log('=== 1. 主界面进入 / 关闭 ===');
{
  const E = makeEnv();
  E.step(20);
  tap(E, E.run('readyGuideBtn()'));
  ok(E.run('state') === 'guide' && E.run('guidePage') === 0, '点「玩法说明」进第一页');
  tap(E, E.run('guideLayout().close'));
  ok(E.run('state') === 'ready', '点「关闭」回主界面，不会误开局');
}

console.log('\n=== 2. 翻页 ===');
{
  const E = makeEnv();
  E.step(20);
  E.run('openGuide(0);');
  const L = E.run('guideLayout()');
  tap(E, L.prev);
  ok(E.run('guidePage') === 0, '第一页点「上一页」不动');
  tap(E, L.next);
  ok(E.run('guidePage') === 1, '点「下一页」翻到第 2 页');
  tap(E, { x: L.art.x, y: L.art.y, w: L.art.w / 4, h: L.art.h });
  ok(E.run('guidePage') === 0, '点示意图左半边 = 上一页');
  tap(E, { x: L.art.x + L.art.w * 0.75, y: L.art.y, w: L.art.w / 4, h: L.art.h });
  ok(E.run('guidePage') === 1, '点示意图右半边 = 下一页');
  const n = E.run('GUIDE.length');
  ok(n >= 8, '至少 8 页（移动 / 轻点 / 按住 / 斩杀圈 / 余光拿 / 余光用 / 敌人 / 进阶）', n);
  for (let i = 0; i < n + 3; i++) { if (E.run('guidePage') === n - 1) break; tap(E, L.next); }
  ok(E.run('guidePage') === n - 1 && E.run('state') === 'guide', '一路翻到最后一页');
  tap(E, L.next);
  ok(E.run('state') === 'play', '最后一页点「开始游戏」直接开局');
}

console.log('\n=== 3. 最后一页：重新体验新手教学 ===');
{
  const E = makeEnv();
  E.run('meta.tut = TUT_DONE;');
  E.step(20);
  E.run('openGuide(GUIDE.length - 1);');
  tap(E, E.run('guideLayout().replay'));
  ok(E.run('state') === 'play', '开局了');
  ok(E.run('tutStep') === 0, '教学从第一步重新开始');
  ok(E.run('meta.tut') === E.run('TUT_DONE'), '这一局照样记为看过，下一局不再出现');
  const F = makeEnv();
  F.run('meta.tut = TUT_DONE;');
  F.step(20);
  F.run('openGuide(2);');
  tap(F, F.run('guideLayout().replay'));
  ok(F.run('state') === 'guide' && F.run('meta.tut') === F.run('TUT_DONE'), '不是最后一页时那个位置点了没反应');
}

console.log('\n=== 4. 键盘（浏览器调试） ===');
{
  const E = makeEnv();
  E.step(20);
  E.run('openGuide(3); guideGo(1);');
  ok(E.run('guidePage') === 4, 'guideGo(+1) 翻页');
  E.run('guideGo(99);');
  ok(E.run('guidePage') === E.run('GUIDE.length - 1'), '越界夹在最后一页');
}

console.log('\n=== 5. 布局 ===');
[667, 844].forEach(h => {
  const E = makeEnv(h);
  E.step(5);
  const L = E.run('guideLayout()');
  const W = E.run('W_CSS'), H = E.run('H_CSS'), SB = E.run('SAFE_BOTTOM');
  const rs = { close: L.close, art: L.art, prev: L.prev, next: L.next, replay: L.replay };
  let out = '';
  for (const k in rs) { const r = rs[k]; if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H - SB + 0.5) out = k; }
  ok(out === '', h + 'px：按钮和示意图都在屏内', out);
  const names = Object.keys(rs);
  let ov = '';
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (overlap(rs[names[i]], rs[names[j]])) ov = names[i] + '×' + names[j];
  ok(ov === '', h + 'px：互不重叠', ov);
  const maxLines = E.run('Math.max.apply(null, GUIDE.map(g => g.lines.length))');
  const textBottom = L.textY + (maxLines - 1) * (L.short ? 24 : 28) + 6;
  ok(textBottom < L.replay.y - 22, h + 'px：最长的说明（' + maxLines + ' 句）不压到页码点和按钮', textBottom.toFixed(0) + ' < ' + (L.replay.y - 22));
  const g = E.run('readyGuideBtn()'), tb = E.run('readyTutBtn()');
  ok(!overlap(g, tb) && [g, tb].every(r => !overlap(r, E.run('readySkillBtn()')) && !overlap(r, E.run('readyVibBtn()'))),
    h + 'px：主界面「玩法说明」「新手教程」互不重叠，也不压别的按钮');
  ok([g, tb].every(r => r.x >= 0 && r.x + r.w <= W), h + 'px：两颗都在屏内');
});

console.log('\n=== 6. 每一页都能画 ===');
[667, 844].forEach(h => {
  const E = makeEnv(h);
  let err = null;
  try {
    E.step(10);
    E.run('meta.runs = 2;'); E.step(5);
    const n = E.run('GUIDE.length');
    for (let p = 0; p < n; p++) {
      E.run('openGuide(' + p + ');');
      for (let k = 0; k < 12; k++) E.step(15);    // 每页走 3 秒，动画转一整圈以上
      E.run('closeGuide();');
    }
  } catch (e) { err = e.message; }
  ok(!err, h + 'px：' + 'GUIDE 每一页连续画 3 秒无异常', err);
  ok(E.bad.length === 0, h + 'px：没有画在 NaN 上', E.bad.slice(0, 5).join(','));
  ok(!E.shadow(), h + 'px：没碰 shadowBlur');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
