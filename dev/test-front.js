/* 推着摇杆按斩 / 正面留出拉扯空间
   1) 推着摇杆按住斩：先砍推的方向上的怪，身后更近的那只不管
   2) 推的方向上没有怪：不挥刀，人顺着摇杆走，不往回砍
   3) 不推摇杆：照旧砍最近的
   4) 推着摇杆点一下斩：那个方向上够得着的怪就对准它
   5) 走着的时候常规刷怪不落在正面左右 frontDeg 度以内；站着不动四面都刷
   6) 甩掉回收的怪补在前方，但在 frontFar 倍感知半径的远处
   7) 合围波落在正面的那一路推到远处，别的方向照旧
   8) 斩完一只、紧挨着的下一只刚好在冲刺终点后面：收刀余势照样斩到，人不死（关掉余势就会死 —— 复现）
   9) 冲刺路上有甲硬直中的重型：刀滑过去，人也不死
   10) 余势过了照旧：站着被怪碰到会死 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv() {
  function param() { const o = { value: 0 }; ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues'].forEach(m => o[m] = function () {}); return o; }
  function node() { return { connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }; }
  let simT = 1000;
  const ac = {
    get currentTime() { return simT / 1000; }, sampleRate: 44100, state: 'running', destination: node(),
    createGain: () => node(), createOscillator: () => node(), createBufferSource: () => node(),
    createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }), resume() {}
  };
  const canvas = {
    width: 0, height: 0, clientWidth: 390, clientHeight: 844,
    getContext: () => new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        return t[k] !== undefined ? t[k] : function () {};
      },
      set(t, k, v) { t[k] = v; return true; }
    }),
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
  };
  const storage = {};
  const tt = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 40, bottom: 830 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => ac, setKeepScreenOn() {}, onHide() {}, onShow() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => simT },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'headless' }
  };
  sb.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: 844 };
  sb.document = { getElementById: () => canvas, addEventListener() {}, visibilityState: 'visible' };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext('meta.tut = TUT_DONE;', sb);   // 新手教学会往身边送怪 / 补晶柱，这里只测正常对局
  vm.runInContext(`
    globalThis.__K = {
      get P(){ return P; }, get enemies(){ return enemies; }, get view(){ return view; },
      get gameTime(){ return gameTime; }, get crystals(){ return crystals; }, get runKills(){ return runKills; }, get state(){ return state; },
      CFG, POW, wdist, wdelta, start, update, spawnEnemy, spawnWave, lockOn, inputDir, headingDir, tryDash,
      get waveDirs(){ return waveDirs; }, set waveDirs(v){ waveDirs = v; },
      set attackHeld(v){ attackHeld = v; }, set spawnTimer(v){ spawnTimer = v; }, set waveTimer(v){ waveTimer = v; },
      move(x, y) { tMove.x = x; tMove.y = y; }
    };
  `, sb);
  return sb.__K;
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局：无敌、不自己刷怪、不合围，场上清空
function fresh() {
  const K = makeEnv();
  K.start();
  K.P.inv = 1e6; K.spawnTimer = 1e9; K.waveTimer = 1e9;
  K.enemies.length = 0; K.crystals.length = 0;
  return K;
}
const put = (K, dx, dy) => { const e = K.spawnEnemy(K.P.x + dx, K.P.y + dy, 'grunt'); e.sp = 0; return e; };
const dashDir = K => Math.atan2(K.P.dy, K.P.dx) * 180 / Math.PI;

console.log('=== 1. 推着摇杆按住斩：先砍推的方向上的 ===');
{
  const K = fresh();
  const back = put(K, -110, 0);             // 身后，更近（但还没贴上来：贴上来的见 1b）
  const front = put(K, 140, 10);            // 推的方向上，够得着
  K.move(1, 0); K.attackHeld = true;
  let dashed = false;
  for (let f = 0; f < 30 && !dashed; f++) { K.update(1 / 60); if (K.P.dashT > 0) dashed = true; }
  ok(dashed && Math.abs(dashDir(K)) < 15, '冲向右边那只（' + dashDir(K).toFixed(0) + '°），不回头砍身后更近的', dashed);
}

console.log('\n=== 1b. 贴身保护：身后那只马上要撞上了，先回头砍它 ===');
{
  const K = fresh();
  put(K, -40, 0);                           // 身后，离碰到只剩十几
  put(K, 140, 10);
  K.move(1, 0); K.attackHeld = true;
  let dashed = false;
  for (let f = 0; f < 30 && !dashed; f++) { K.update(1 / 60); if (K.P.dashT > 0) dashed = true; }
  ok(dashed && Math.abs(dashDir(K)) > 165, '马上要撞上的：不管摇杆指哪，先砍它（' + dashDir(K).toFixed(0) + '°）', dashed);
}

console.log('\n=== 2. 推的方向上没有怪：不往回砍，顺着走 ===');
{
  const K = fresh();
  put(K, -110, 0); put(K, -70, 120);        // 都在身后 / 侧后，够得着（还没贴上来）
  const x0 = K.P.x;
  K.move(1, 0); K.attackHeld = true;
  let back = 0, dashed = 0;
  for (let f = 0; f < 60; f++) { K.update(1 / 60); if (K.P.dashT > 0) { dashed++; if (K.P.dx < 0.4) back++; } }
  ok(back === 0, '没有一刀往回砍（挥刀 ' + dashed + ' 帧，往回 ' + back + ' 帧）');
  ok(dashed === 0, '场上只有身后的怪、没有晶柱：一刀都没挥');
  ok(K.P.x - x0 > 150, '人顺着摇杆往右走了（' + (K.P.x - x0).toFixed(0) + '）');
}

console.log('\n=== 3. 不推摇杆：照旧砍最近的 ===');
{
  const K = fresh();
  put(K, -60, 0); put(K, 140, 10);
  K.move(0, 0); K.attackHeld = true;
  let dashed = false;
  for (let f = 0; f < 30 && !dashed; f++) { K.update(1 / 60); if (K.P.dashT > 0) dashed = true; }
  ok(dashed && Math.abs(Math.abs(dashDir(K)) - 180) < 15, '冲向最近的（左边那只，' + dashDir(K).toFixed(0) + '°）');
}

console.log('\n=== 4. 推着摇杆选目标：越正越近越优先，斜后方不算 ===');
{
  const K = fresh();
  const side = put(K, 60, 110);             // 右下 61°，在 65° 以内
  const ahead = put(K, 150, 0);             // 正前方
  const t1 = K.lockOn({ x: 1, y: 0 });
  ok(t1 === ahead || t1 === side, '选的是推的方向上的');
  K.enemies.length = 0;
  put(K, 20, 120);                          // 81°：在锥外
  ok(K.lockOn({ x: 1, y: 0 }) === null, '只有侧后的怪：不选（返回 null）');
}

console.log('\n=== 5. 走着的时候正面不刷，站着四面刷 ===');
{
  const K = fresh();
  K.move(1, 0);
  for (let f = 0; f < 30; f++) K.update(1 / 60);           // 跑起来
  let front = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    const e = K.spawnEnemy(); if (!e) { K.enemies.length = 0; continue; }
    const dx = K.wdelta(e.x - K.P.x), dy = K.wdelta(e.y - K.P.y);
    n++; if (dx / Math.hypot(dx, dy) > Math.cos(K.CFG.frontDeg * Math.PI / 180)) front++;
    K.enemies.length = 0;
  }
  ok(n > 250 && front === 0, '跑着刷 ' + n + ' 只，正面左右 ' + K.CFG.frontDeg + '° 以内 0 只', front + '/' + n);
  const K2 = fresh();
  let front2 = 0, n2 = 0;
  for (let i = 0; i < 300; i++) {
    const e = K2.spawnEnemy(); if (!e) { K2.enemies.length = 0; continue; }
    const dx = K2.wdelta(e.x - K2.P.x), dy = K2.wdelta(e.y - K2.P.y);
    n2++; if (dx / Math.hypot(dx, dy) > Math.cos(60 * Math.PI / 180)) front2++;
    K2.enemies.length = 0;
  }
  ok(front2 > n2 * 0.08, '站着不动：四面都刷（右侧 60° 以内 ' + front2 + '/' + n2 + '）');
}

console.log('\n=== 6. 甩掉回收的怪：补在前方远处 ===');
{
  const K = fresh();
  K.move(1, 0);
  for (let f = 0; f < 30; f++) K.update(1 / 60);
  const far = put(K, -K.view * 3, 0);       // 早就甩掉了
  const before = new Set(K.enemies);
  K.update(1 / 60);
  const born = K.enemies.filter(e => !before.has(e));
  const ok1 = born.length === 1 && born[0] !== far;
  const b = born[0], dx = b ? K.wdelta(b.x - K.P.x) : 0, dy = b ? K.wdelta(b.y - K.P.y) : 0, d = Math.hypot(dx, dy);
  ok(ok1 && dx / d > 0.5, '补了一只，在前方左右 60° 以内');
  ok(ok1 && d >= K.view * (K.CFG.frontFar - 0.02), '补在 ' + (d / K.view).toFixed(2) + ' 倍感知半径（≥ ' + K.CFG.frontFar + '）');
}

console.log('\n=== 7. 合围波：正面那一路推远 ===');
{
  const K = fresh();
  K.move(1, 0);
  for (let f = 0; f < 30; f++) K.update(1 / 60);
  K.waveDirs = [0, Math.PI];                 // 正前方一路、正后方一路
  K.spawnWave();
  const ds = K.enemies.map(e => ({ dx: K.wdelta(e.x - K.P.x), d: Math.hypot(K.wdelta(e.x - K.P.x), K.wdelta(e.y - K.P.y)) / K.view }));
  const fr = ds.filter(o => o.dx > 0), bk = ds.filter(o => o.dx < 0);
  ok(fr.length === 2 && fr.every(o => o.d > K.CFG.frontFar - 0.15), '正前方那一路在 ' + fr.map(o => o.d.toFixed(2)).join('/') + ' 倍');
  ok(bk.length === 2 && bk.every(o => o.d < 1.7), '身后那一路照旧 1.5 倍左右（' + bk.map(o => o.d.toFixed(2)).join('/') + '）');
}

console.log('\n=== 8. 斩到就停：斩完一只停在它身后，不再冲过头滑进下一只 ===');
{
  // 以前一刀固定冲满（≈ 180）：怪离得近也冲过头，斩完第一只滑进后面那只就死了（用户："斩完被甩进怪堆"）
  const M = fresh(); const x0 = M.P.x, y0 = M.P.y;
  M.tryDash(null);                          // 空挥（没锁目标，朝面朝的方向）：照旧冲满
  for (let f = 0; f < 30; f++) M.update(1 / 60);
  const full = Math.hypot(M.P.x - x0, M.P.y - y0);
  ok(full > 150, '空挥（没有目标）：照旧冲满一刀（' + full.toFixed(0) + '）');
  const trial = function (glide) {
    const K = fresh(); K.P.inv = 0;
    K.CFG.glideCut = glide;
    const a = put(K, 90, 0), b = put(K, 160, 0);   // 以前冲过头会撞上的那只
    const ax = a.x;
    K.tryDash({ x: a.x, y: a.y, ref: a });
    for (let f = 0; f < 40 && K.state === 'play'; f++) K.update(1 / 60);
    return { alive: K.state === 'play', aDead: K.enemies.indexOf(a) < 0, bDead: K.enemies.indexOf(b) < 0, past: Math.round(K.P.x - ax) };
  };
  const off = trial(0), on = trial(M.CFG.glideCut);
  ok(off.alive && off.aDead && !off.bDead && off.past < 50, '没有收刀余势：斩完第一只就停在它身后（多走 ' + off.past + '），不会滑进第二只', JSON.stringify(off));
  ok(on.alive && on.aDead && !on.bDead, '有收刀余势也一样：人活着', JSON.stringify(on));
}

console.log('\n=== 9. 冲刺路上有甲硬直中的重型 ===');
{
  const K = fresh(); K.P.inv = 0;
  const h = put(K, 120, 0); h.heavy = true; h.r = 22; h.cracked = true; h.armorT = 9; h.hp = 2;
  K.tryDash({ x: K.P.x + 160, y: K.P.y });
  for (let f = 0; f < 40 && K.state === 'play'; f++) K.update(1 / 60);
  ok(K.state === 'play' && K.enemies.indexOf(h) >= 0, '刀滑过重型，人没死，重型也还在');
}

console.log('\n=== 10. 余势过了照旧：站着被碰到会死 ===');
{
  const K = fresh(); K.P.inv = 0;
  for (let f = 0; f < 30; f++) K.update(1 / 60);       // 站一会儿，没有任何余势
  put(K, 5, 0);
  K.update(1 / 60);
  ok(K.state !== 'play', '站着不动被怪贴上：死');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
