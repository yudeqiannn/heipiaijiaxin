/* 每层特性（LAYERS[].feat）
   1) 每层的特性和背景主题对得上；第 1 层没特性，深处沿用终末
   2) 低语：主角躲在雾里，远处的怪变慢（迷路）
   3) 裂隙：喷发中的地缝烧掉压在上面的怪和主角；预警时不烧；冲刺中的主角不烧
   4) 空壳：冲刺 + 滑行更远
   5) 核心：站进光核，斩杀圈变大、守望者吸不走光；出来两秒多退回去
   6) 黑潮：潮流推着主角和怪走，到点换方向
   7) 无光：斩杀圈变小
   8) 终末：怪更快、合围更勤
   9) 背景缓存：按主题分开存；破门条快满时提前画下一层 */
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
  // 记下所有带坐标的调用：坐标里出现 NaN / Infinity 就是 UI 数学写错了
  const bad = [];
  let shadow = false;
  const finite = (name, args) => { for (const a of args) if (typeof a === 'number' && !isFinite(a)) { bad.push(name); break; } };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...a) => { finite(k, a); return { addColorStop() {} }; };
      if (k === 'measureText') return s => ({ width: String(s).length * 10 });
      if (['arc', 'fillText', 'strokeText', 'fillRect', 'moveTo', 'lineTo', 'arcTo', 'translate', 'scale', 'quadraticCurveTo'].indexOf(k) >= 0) {
        return (...a) => finite(k, a);
      }
      return t[k] !== undefined ? t[k] : function () {};
    },
    set(t, k, v) {
      if (k === 'shadowBlur' && v) shadow = true;
      if (k === 'globalAlpha' && !isFinite(v)) bad.push('globalAlpha');
      t[k] = v; return true;
    }
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const storage = Object.assign({}, init || {});   // init：带着这份存档启动
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
  vm.runInContext('meta.tut = TUT_DONE;', sb);
  const run = code => vm.runInContext(code, sb);
  function step(n) { for (let i = 0; i < n; i++) { const cb = raf; raf = null; if (!cb) break; simT += 16.7; cb(simT); } }
  return { run, step, storage, bad, shadow: () => shadow };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局到第 n 层：不刷怪、不合围、主角无敌（要测"会不会死"时再关）
function at(n) {
  const E = makeEnv();
  E.step(5);
  E.run('start(); P.inv = 1e6; spawnTimer = 1e9; waveTimer = 1e9; enemies.length = 0; crystals.length = 0; layer = ' + n + '; onEnterLayer(' + n + '); layerFxT = 0; scoutLeft = 0;');
  E.step(2);
  return E;
}
// 一只不会自己乱动的普通怪放在 (dx, dy)，返回它一帧走了多远
const moved = (E, dx, dy) => E.run('(function () { enemies.length = 0; const e = spawnEnemy(P.x + ' + dx + ', P.y + ' + dy + ', "grunt"); e.sp = 100; const x0 = e.x, y0 = e.y; update(1 / 60); return Math.hypot(wdelta(e.x - x0), wdelta(e.y - y0)); })()');

console.log('=== 1. 特性和背景对得上 ===');
{
  const E = at(1);
  ok(E.run('layerFeat()') === null && E.run('groundOf(1).id') === 'echo', '第 1 层：没有特性，残响的背景');
  const want = { 2: ['fog', 'whisper'], 3: ['rift', 'rift'], 4: ['slip', 'hollow'], 5: ['core', 'core'], 6: ['tide', 'tide'], 7: ['void', 'void'], 8: ['end', 'end'] };
  let good = true;
  for (const n in want) { E.run('layer = ' + n + ';'); if (E.run('layerFeat()') !== want[n][0] || E.run('groundOf(' + n + ').id') !== want[n][1]) good = false; }
  ok(good, '第 2~8 层：雾 / 地缝 / 滑 / 光核 / 潮流 / 无光 / 终末，背景主题一一对应');
  E.run('layer = 11;');
  ok(E.run('layerFeat()') === 'end' && E.run('groundOf(11).id') === 'end', '深处沿用终末');
  E.run('layer = 1;');
  ok(Math.abs(E.run('reach()') - E.run('POW.autoReach')) < 1e-9, '没特性的层：斩杀圈不变');
}

console.log('\n=== 2. 低语：躲在雾里，远处的怪迷路 ===');
{
  const E = at(2);
  const c = E.run('(function () { const b = fogOf(5, 5); P.x = b.x; P.y = b.y; return b; })()');
  const inside = moved(E, 300, 0);
  ok(E.run('inFog !== null'), '站在雾团中心：算躲在雾里');
  // 找一处不在任何雾里的地方
  E.run('(function () { for (let y = 0; y < 4500; y += 37) for (let x = 0; x < 4500; x += 41) { P.x = x; P.y = y; tickFeats(0); if (!inFog) return; } })();');
  const outside = moved(E, 300, 0);
  ok(E.run('inFog === null'), '找到一处雾外');
  ok(inside < outside * 0.6, '躲在雾里：远处的怪慢下来（' + inside.toFixed(2) + ' vs ' + outside.toFixed(2) + '）');
}

console.log('\n=== 3. 裂隙：地缝喷发烧人烧怪 ===');
{
  const E = at(3);
  // 把第一条地缝调到"正在喷"，在它第一段中点放一只怪
  const setPhase = (E, want) => E.run('(function () { const c = riftCracks()[0], L = CFG.lf; const fr = (' + want + ') / L.riftCycle; const cur = riftCracks()[0]; ' +
    'const ph = cracksOf(Math.floor(cur.ox / TILE), Math.floor(cur.oy / TILE), groundOf(layer).cracks || 3).find(x => x.pts === cur.pts).ph; ' +
    'gameTime = L.riftCycle * (((fr - ph) % 1 + 1) % 1) + L.riftCycle * 10; return riftCracks()[0].st; })()');
  const mid = 'riftCracks()[0].ox + (riftCracks()[0].pts[0][0] + riftCracks()[0].pts[1][0]) / 2';
  const midy = 'riftCracks()[0].oy + (riftCracks()[0].pts[0][1] + riftCracks()[0].pts[1][1]) / 2';
  const st = setPhase(E, 'L.riftCycle - L.riftBurn + 0.1');
  ok(st === 'burn', '第一条地缝调到喷发中', st);
  E.run('enemies.length = 0; const e = spawnEnemy(' + mid + ', ' + midy + ', "grunt"); e.sp = 0; tickFeats(1 / 60);');
  ok(E.run('enemies.length') === 0, '压在喷发地缝上的怪烧死了');
  const k0 = E.run('runKills');
  ok(k0 >= 1, '烧死的算斩杀（可以故意把怪引过去）', k0);
  // 先把中点算好再挪人：人一挪，"附近的地缝"列表就变了
  E.run('globalThis.__m = [' + mid + ', ' + midy + ']; P.inv = 0; P.dashT = 0; P.glideT = 0; P.x = __m[0]; P.y = __m[1]; tickFeats(1 / 60);');
  ok(E.run('state') === 'dead', '主角站在喷发的地缝上：死');
  const F = at(3);
  const st2 = setPhase(F, 'L.riftCycle - L.riftBurn - 0.5');
  ok(st2 === 'warn', '另一局：调到预警', st2);
  F.run('globalThis.__m = [' + mid + ', ' + midy + ']; P.inv = 0; P.dashT = 0; P.glideT = 0; P.x = __m[0]; P.y = __m[1]; tickFeats(1 / 60);');
  ok(F.run('state') === 'play', '预警时站上去不烧');
  setPhase(F, 'L.riftCycle - L.riftBurn + 0.1');
  F.run('globalThis.__m = [' + mid + ', ' + midy + ']; P.inv = 0; P.dashT = 0.1; P.x = __m[0]; P.y = __m[1]; tickFeats(1 / 60);');
  ok(F.run('state') === 'play', '冲刺中划过喷发的地缝不烧');

  // 新画法：冷却阶段只是画面；第一次在身边发红报一句；喷发第一下冒一串火星；屏幕外的缝不画
  // （人挪过去以后"附近的地缝"列表会变，所以这里按"离主角最近的那条"调相位）
  const C = at(3);
  C.run('globalThis.__m = [' + mid + ', ' + midy + ']; P.inv = 0; P.dashT = 0; P.glideT = 0; P.x = __m[0]; P.y = __m[1]; cam.x = P.x; cam.y = P.y;');
  const near = 'riftCracks().reduce((b, c) => riftNear(c) < riftNear(b) ? c : b)';
  const phaseNear = want => C.run('(function () { const cur = ' + near + ', L = CFG.lf; ' +
    'const ph = cracksOf(Math.floor(cur.ox / TILE), Math.floor(cur.oy / TILE), groundOf(layer).cracks || 3).find(x => x.pts === cur.pts).ph; ' +
    'gameTime = L.riftCycle * ((((' + want + ') / L.riftCycle - ph) % 1 + 1) % 1) + L.riftCycle * 10; return ' + near + '.st; })()');
  ok(C.run('riftNear(' + near + ')') < 5, '主角站在一条地缝上');
  ok(phaseNear('0.3') === 'cool', '刚喷完：冷却阶段');
  C.run('tickFeats(1 / 60);');
  ok(C.run('state') === 'play', '冷却时站上去不烧');
  C.run('riftTold = false; floats.length = 0;');
  phaseNear('L.riftCycle - L.riftBurn - 0.5');
  C.run('tickFeats(1 / 60);');
  ok(C.run('riftTold') === true && C.run('floats.some(f => f.text === "发红的地缝要喷火！")'), '身边的缝第一次发红：头顶报一句');
  C.run('floats.length = 0; tickFeats(1 / 60);');
  ok(!C.run('floats.some(f => f.text === "发红的地缝要喷火！")'), '这一层只报一次');
  phaseNear('L.riftCycle - L.riftBurn + 0.005');
  const p0 = C.run('parts.length');
  C.run('P.inv = 999; tickFeats(1 / 60);');
  ok(C.run('parts.length') - p0 >= 16, '喷发第一下冒一串火星', C.run('parts.length') - p0);
  ok(C.run('riftInView(' + near + ', 0)') === true, '身边这条算在屏幕里');
  ok(C.run('(function () { const c = ' + near + '; return riftInView({ pts: c.pts, ox: c.ox + 2000, oy: c.oy }, 90); })()') === false, '挪远 2000 的缝算屏幕外（不画、不冒火星）');
  let threw = null;
  for (const w of ['L.riftCycle - L.riftBurn - 0.2', 'L.riftCycle - L.riftBurn + 0.2', '0.3']) {
    phaseNear(w);
    try { C.run('drawFeats();'); } catch (e) { threw = e.message; }
  }
  ok(threw === null, '预警 / 喷发 / 冷却三种都画得出来', threw);
}

console.log('\n=== 4. 空壳：冲刺停不住 ===');
{
  const dash = n => { const E = at(n); return E.run('(function () { const x0 = P.x; P.vx = P.vy = 0; tryDash({ x: P.x + 500, y: P.y }); for (let i = 0; i < 60; i++) update(1 / 60); return wdelta(P.x - x0); })()'); };
  const d1 = dash(1), d4 = dash(4);
  ok(d4 > d1 * 1.15, '同样一刀，空壳上冲得更远（' + d4.toFixed(0) + ' vs ' + d1.toFixed(0) + '）');
}

console.log('\n=== 5. 核心：光核撑大斩杀圈 ===');
{
  const E = at(5);
  const base = E.run('POW.autoReach');
  E.run('P.x = 2 * FOG_CELL + FOG_CELL / 2; P.y = 3 * FOG_CELL + FOG_CELL / 2; P.vx = P.vy = 0;');
  E.run('const w = spawnEnemy(P.x + 120, P.y, "watch"); w.sp = 0;');
  E.run('for (let i = 0; i < 60; i++) { P.x = 2 * FOG_CELL + FOG_CELL / 2; P.y = 3 * FOG_CELL + FOG_CELL / 2; update(1 / 60); }');
  ok(E.run('reach()') > base * 1.25, '站在光核里一秒：斩杀圈变大（' + E.run('reach()').toFixed(0) + ' vs ' + base + '）');
  ok(E.run('viewDrain') === 0, '守望者就在旁边，光也没被吸走');
  E.run('enemies.length = 0; for (let i = 0; i < 180; i++) { P.x = 2 * FOG_CELL + 20; P.y = 3 * FOG_CELL + 20; update(1 / 60); }');
  ok(Math.abs(E.run('reach()') - base) < 0.5, '离开光核 3 秒：退回原样');
}

console.log('\n=== 6. 黑潮：潮流推着走 ===');
{
  const E = at(6);
  E.run('tideA = 0; tideT = 100; P.vx = P.vy = 0; enemies.length = 0; const e = spawnEnemy(P.x + 400, P.y + 200, "grunt"); e.sp = 0;');
  const x0 = E.run('P.x'), ex0 = E.run('enemies[0].x');
  E.run('for (let i = 0; i < 60; i++) update(1 / 60);');
  const dx = E.run('wdelta(P.x - ' + x0 + ')'), edx = E.run('wdelta(enemies[0].x - ' + ex0 + ')');
  ok(dx > 40 && edx > 40, '不推摇杆站着：人和怪都被潮流往右推了（' + dx.toFixed(0) + ' / ' + edx.toFixed(0) + '）');
  const a0 = E.run('tideA');
  E.run('tideT = 0.01; update(1 / 60);');
  ok(Math.abs(E.run('tideA') - a0) > 1, '到点换方向（转了 ' + (E.run('tideA') - a0).toFixed(2) + ' 弧度）');
}

console.log('\n=== 7. 无光 / 8. 终末 ===');
{
  const E = at(7);
  ok(Math.abs(E.run('reach() / POW.autoReach') - E.run('CFG.lf.voidReach')) < 1e-9, '无光：斩杀圈缩到 ' + E.run('CFG.lf.voidReach'));
  const s1 = moved(at(1), 300, 0), s8 = moved(at(8), 300, 0);
  ok(s8 > s1 * 1.1, '终末：怪更快（' + s8.toFixed(2) + ' vs ' + s1.toFixed(2) + '）');
  const F = at(8);
  F.run('gameTime = 200; waveTimer = 0; update(1 / 60);');
  ok(F.run('waveTimer') <= F.run('CFG.lf.endWave') + 1e-6, '终末：合围间隔 ' + F.run('CFG.lf.endWave') + ' 秒（原 ' + F.run('CFG.waveEvery') + '）');
}

console.log('\n=== 7b. 无光：整个游戏褪成黑白灰，背景什么都没有 ===');
{
  const E = at(7);
  const G = E.run('groundOf(7)');
  ok(G.bg === '#000000' && !G.dot && !G.line && G.noDebris && G.dustN === 0, '无光的背景：纯黑，没有地纹、光点、残骸、浮尘');
  E.run('combo = 60; comboTimer = 99; FB.tier = tierOf(combo); for (let i = 0; i < 60; i++) update(1 / 60), tickUI(1 / 60);');
  ok(E.run('BGT.a') < 0.01, '高段位也不给地面染色（不然纯黑会被去色成灰）');
  ok(E.run('MONO.k') > 0.95, '进了无光一秒：去色拉满', E.run('MONO.k').toFixed(2));
  ok(E.run('MONO.ok') === false, '测试环境的假画布读不出像素：判定为不支持混合模式，走退路');
  ok(E.run('FOE_C.grunt') === E.run('grayOf(THEME.foe.grunt)') && E.run('FOE_C.charger') === E.run('grayOf(THEME.foe.charger)'), '退路：怪的颜色换成同亮度的灰');
  const h = E.run('heroColor()'); 
  ok(h.slice(1, 3) === h.slice(3, 5) && h.slice(3, 5) === h.slice(5, 7), '退路：主角也是灰的（' + h + '）');
  E.run('layer = 8; for (let i = 0; i < 90; i++) tickUI(1 / 60);');
  ok(E.run('MONO.k') < 0.05 && E.run('FOE_C.grunt') !== E.run('grayOf(THEME.foe.grunt)'), '破门进终末：颜色回来了');
}

console.log('\n=== 9. 背景缓存：按主题存；快走到门时提前画下一层 ===');
{
  const E = at(2);
  E.step(30);
  const keys = () => E.run('Object.keys(BG.tiles)');
  const used = E.run('BG.list.filter(t => t.used === BG.frame).map(t => t.key)');
  ok(used.length > 0 && used.every(k => k.indexOf('whisper:') === 0), '第 2 层：这一帧贴的都是低语的块（' + used.length + ' 块）');
  E.run('candyNext = Math.ceil(door.n * 0.8); candies = candies.filter(c => c.i >= candyNext);');
  E.step(40);
  ok(keys().some(k => k.indexOf('rift:') === 0), '糖路走到 80%：已经在画裂隙的块');
  E.run('candyNext = door.n; candies.length = 0; P.x = P.px = door.x; P.y = P.py = door.y;');
  E.step(2);
  ok(E.run('layer') === 3 && E.run('groundOf(layer).id') === 'rift', '破门进第 3 层：背景换成裂隙');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
