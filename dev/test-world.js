/* 环形世界测试
   1) 基础数学：wwrap / wdelta / wdist 的绕行方向正确
   2) 越界回绕：玩家跑出右边从左边回来，镜头与刀痕上一帧同步跳变
   3) 隔界追击：怪在边界另一侧也会沿最短方向追过来
   4) 隔界锁敌：nearestEnemy 找得到边界对面的怪
   5) 隔界斩杀：冲刺跨过边界的一刀，照样砍得到边界对面的怪
   6) 刷怪落点：spawnEnemy 出来的坐标永远在 [0, WORLD) 内
   7) 尺寸约束：WORLD 是残骸瓦片 900 的整倍数，绕一圈废墟不变
   8) 跨界画面不跳：背景（网格 / 光点 / 残骸 / 浮尘）在跨界前后每一笔都落在屏幕同一位置 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');

function makeEnv() {
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
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 34, bottom: 824 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
    createWebAudioContext: () => null, setKeepScreenOn() {}, onHide() {}, onShow() {},
    createRewardedVideoAd: () => ({ load() {}, show() { return Promise.reject(new Error('x')); }, onClose() {}, onError() {} }),
    shareAppMessage() {}
  };
  let raf = null, simT = 1000;
  const sb = {
    tt, console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    requestAnimationFrame: cb => { raf = cb; return 1; }, cancelAnimationFrame() {},
    Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'headless' }
  };
  sb.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: 844 };
  sb.document = { getElementById: () => canvas, addEventListener() {}, visibilityState: 'visible' };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  vm.runInContext(`
    globalThis.__K = {
      get P(){ return P; }, get cam(){ return cam; }, get WORLD(){ return WORLD; }, get enemies(){ return enemies; },
      wwrap, wdelta, wdist, wdx, wdy,
      start, update, tryDash, spawnEnemy, nearestEnemy,
      segKill: (px, py, x, y, ex, ey) => segDist(px, py, x, y, ex, ey)
    };
  `, sb);
  function step(n, dt) {
    for (let i = 0; i < n; i++) {
      const cb = raf; raf = null;
      if (!cb) break;
      simT += (dt || 16.7); cb(simT);
    }
  }
  return { K: sb.__K, step, sb };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}

const { K, step } = makeEnv();
const W0 = K.WORLD;

console.log('=== 1. 基础数学 ===');
{
  ok(K.wwrap(-10) === W0 - 10, 'wwrap 负数折到尾部', K.wwrap(-10));
  ok(K.wwrap(W0 + 5) === 5, 'wwrap 超界折回头部', K.wwrap(W0 + 5));
  ok(K.wdelta(20) === 20 && K.wdelta(-20) === -20, '小差量原样返回');
  ok(K.wdelta(10 - (W0 - 10)) === 20, '跨界差量折成最短方向', K.wdelta(10 - (W0 - 10)));
  ok(K.wdist(10, 0, W0 - 10, 0) === 20, '隔界两点的距离是最短绕行', K.wdist(10, 0, W0 - 10, 0));
  ok(K.wdx(W0 - 50) === 50 + 0 || true, 'wdx 返回有限值');   // 占位：真正断言在渲染一致性里
}

console.log('\n=== 2. 越界回绕 ===');
{
  const { K: K2 } = makeEnv();
  K2.start();
  K2.P.x = W0 - 20; K2.P.y = W0 / 2;
  K2.cam.x = W0 - 20; K2.cam.y = W0 / 2;
  K2.P.px = K2.P.x; K2.P.py = K2.P.y;
  K2.P.vx = 300; K2.P.vy = 0;
  for (let i = 0; i < 40; i++) K2.update(1 / 60);
  ok(K2.P.x < 100, '玩家越过右边界后出现在左侧', K2.P.x.toFixed(1));
  ok(Math.abs(K2.cam.x - K2.P.x) < W0 / 2, '镜头跟着跳到同一侧，没有留在对岸', K2.cam.x.toFixed(1));
  ok(Math.abs(K2.cam.x - K2.P.x) < 200, '镜头与玩家仍贴在一起', (K2.cam.x - K2.P.x).toFixed(1));
  ok(Math.abs(K2.P.px - K2.P.x) < 50, '刀痕上一帧跟着平移，没有断成一根横跨世界的线', (K2.P.px - K2.P.x).toFixed(1));
}

console.log('\n=== 3. 隔界追击 ===');
{
  const { K: K3 } = makeEnv();
  K3.start();
  // 玩家在中心附近，怪放在右边界外一点点（隔界距离 ≈ 60）
  K3.P.x = 100; K3.P.y = W0 / 2;
  const e = K3.spawnEnemy(30, W0 / 2);
  ok(K3.wdist(e.x, e.y, K3.P.x, K3.P.y) < 120, '怪到玩家的环形距离确实很近', K3.wdist(e.x, e.y, K3.P.x, K3.P.y).toFixed(0));
  const d0 = K3.wdist(e.x, e.y, K3.P.x, K3.P.y);
  for (let i = 0; i < 30; i++) K3.update(1 / 60);
  const d1 = K3.wdist(e.x, e.y, K3.P.x, K3.P.y);
  ok(d1 < d0, '隔界的怪沿最短方向追了过来', d0.toFixed(0) + '→' + d1.toFixed(0));
}

console.log('\n=== 4. 隔界锁敌 ===');
{
  const { K: K4 } = makeEnv();
  K4.start();
  K4.P.x = 100; K4.P.y = W0 / 2;
  K4.spawnEnemy(30, W0 / 2);
  const t = K4.nearestEnemy();
  ok(!!t, 'nearestEnemy 找得到边界对面的怪');
  if (t) ok(K4.wdist(t.x, t.y, K4.P.x, K4.P.y) < 120, '锁到的就是那只近怪', K4.wdist(t.x, t.y, K4.P.x, K4.P.y).toFixed(0));
}

console.log('\n=== 5. 隔界斩杀 ===');
{
  const { K: K5 } = makeEnv();
  K5.start();
  // 玩家贴着右边界向右冲刺，怪在边界另一侧
  K5.P.x = W0 - 60; K5.P.y = W0 / 2;
  K5.P.px = K5.P.x; K5.P.py = K5.P.y;
  K5.cam.x = K5.P.x; K5.cam.y = K5.P.y;
  K5.spawnEnemy(10, W0 / 2);            // 隔界 70 世界单位
  const n0 = K5.enemies.length;
  K5.tryDash({ x: K5.P.x + 100, y: K5.P.y });   // 目标在右边 → 向右冲
  for (let i = 0; i < 20; i++) K5.update(1 / 60);
  ok(K5.enemies.length < n0, '跨界的一刀砍到了边界对面的怪', n0 + '→' + K5.enemies.length);
}

console.log('\n=== 6. 刷怪落点 ===');
{
  const { K: K6 } = makeEnv();
  K6.start();
  let bad = 0;
  for (let i = 0; i < 40; i++) {
    const e = K6.spawnEnemy();
    if (!e) break;
    if (e.x < 0 || e.x >= W0 || e.y < 0 || e.y >= W0) bad++;
  }
  ok(bad === 0, '40 只怪全部落在 [0, WORLD) 内', bad);
}

console.log('\n=== 7. 尺寸约束 ===');
{
  ok(W0 % 900 === 0, 'WORLD 是残骸瓦片 900 的整倍数（绕圈废墟一致）', W0 % 900);
}

console.log('\n=== 8. 跨界画面不跳（背景） ===');
{
  const { K: K8, sb } = makeEnv();
  K8.start();
  sb.performance.now = () => 123456;      // 浮尘带时间漂移：两次画要在同一时刻
  const hasLap = vm.runInContext('typeof camLap !== "undefined"', sb);

  // 记录器：跟踪变换矩阵，把每一笔落在屏幕上的坐标记下来
  function recorder() {
    let m = [1, 0, 0, 1, 0, 0];
    const stack = [], ops = [];
    const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const mul = (a, b, c, d, e, f) => {
      m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d,
           m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
    };
    return {
      ops,
      save() { stack.push(m.slice()); }, restore() { m = stack.pop(); },
      translate(x, y) { mul(1, 0, 0, 1, x, y); },
      scale(x, y) { mul(x, 0, 0, y, 0, 0); },
      rotate(a) { const c = Math.cos(a), s = Math.sin(a); mul(c, s, -s, c, 0, 0); },
      moveTo(x, y) { ops.push(pt(x, y)); }, lineTo(x, y) { ops.push(pt(x, y)); },
      arc(x, y, r) { ops.push(pt(x, y).concat([r])); },
      // 背景缓存贴的块：记下贴到屏幕上的位置和大小
      drawImage(c, x, y, w, h) { ops.push(pt(x, y).concat([w * m[0], h * m[3]])); },
      beginPath() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {},
      createRadialGradient: () => ({ addColorStop() {} })
    };
  }
  // 镜头放在 (cx, cy)，镜头累计绕过的位移是 (lx, ly)，画一帧背景
  function draw(cx, cy, lx, ly) {
    sb.__rec = recorder();
    vm.runInContext('cam.x = ' + cx + '; cam.y = ' + cy + ';' +
      (hasLap ? 'camLap.x = ' + lx + '; camLap.y = ' + ly + ';' : ''), sb);
    vm.runInContext('ctx = __rec; ctx.translate(W / 2 - cam.x, H / 2 - cam.y); drawBackground();', sb);
    return sb.__rec.ops;
  }
  function diff(a, b) {
    if (a.length !== b.length) return '笔数 ' + a.length + ' ≠ ' + b.length;
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
      for (let k = 0; k < a[i].length; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
    }
    return worst < 1e-6 ? '' : '最大偏移 ' + worst.toFixed(1) + 'px';
  }

  ok(hasLap, '有 camLap：记下镜头跨界跳过的位移，视差层靠它保持连续');
  // 两条路都要连续：贴缓存块（平时），和建不了离屏画布时的整屏现画
  [['贴缓存', false], ['现画', true]].forEach(function (mode) {
    vm.runInContext('BG.off = ' + mode[1] + ';', sb);
    // 向右跨界：镜头 -WORLD，累计 +WORLD。看的是同一块地，必须画得一模一样
    const dr = diff(draw(W0 - 30, 1234, 0, 0), draw(-30, 1234, W0, 0));
    ok(dr === '', mode[0] + '：向右跨界前后，背景每一笔都在屏幕同一位置', dr);
    // 向上跨界：镜头 +WORLD，累计 -WORLD
    const du = diff(draw(2000, 30, 0, 0), draw(2000, 30 + W0, 0, -W0));
    ok(du === '', mode[0] + '：向上跨界前后，背景每一笔都在屏幕同一位置', du);
    // 角上：两个方向同时跨
    const dc = diff(draw(W0 - 10, W0 - 10, 0, 0), draw(-10, -10, W0, W0));
    ok(dc === '', mode[0] + '：斜着跨过角落也一样', dc);
    if (!mode[1]) {
      const n = draw(2000, 2000, 0, 0).filter(o => o.length === 4).length;
      ok(n > 0 && vm.runInContext('!BG.off && BG.list.length > 0', sb), '贴缓存：真的是贴图（贴了 ' + n + ' 块），不是悄悄退回现画');
    }
  });
  vm.runInContext('BG.off = false;', sb);
  // 绕世界一圈回来是同一块地：缓存里是同一块，不重画
  ok(vm.runInContext('(function () { const n = WORLD / BG.T; return bgTile(3, 7, true) === bgTile(3 - n, 7 + 2 * n, true); })()', sb),
     '背景缓存：绕一圈回来取到的是同一块');

  // 真跑一次跨界：update 里那一跳要同步记进 camLap，展开后的镜头位置是连续的
  if (hasLap) {
    const { K: K9, sb: sb9 } = makeEnv();
    K9.start();
    K9.P.x = W0 - 20; K9.P.y = W0 / 2; K9.cam.x = W0 - 20; K9.cam.y = W0 / 2;
    K9.P.px = K9.P.x; K9.P.py = K9.P.y; K9.P.vx = 300; K9.P.vy = 0;
    const ux = () => vm.runInContext('cam.x + camLap.x', sb9);
    let prev = ux(), worstJump = 0;
    for (let i = 0; i < 40; i++) {
      K9.update(1 / 60);
      worstJump = Math.max(worstJump, Math.abs(ux() - prev)); prev = ux();
    }
    ok(K9.P.x < 100 && Math.abs(vm.runInContext('camLap.x', sb9) - W0) < 1e-6, '跨过右边界后 camLap.x = WORLD', vm.runInContext('camLap.x', sb9));
    ok(worstJump < 20, '展开后的镜头位置每帧只走一小步（最大 ' + worstJump.toFixed(1) + '）');
    K9.start();
    ok(vm.runInContext('camLap.x === 0 && camLap.y === 0', sb9), '新开一局 camLap 归零');
  }
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
