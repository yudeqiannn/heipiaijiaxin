/* 刀诀测试（2.9 节）
   1) 破门才给：斩多少只都不弹；破门 → 等一下 → 弹三选一（三张不重样）
   2) 三选一：世界整个停住；弹出 0.4 秒内的点击不算；点了 → 亮一下回局内、升一级、给一口无敌
   3) 教学局 / CFG.cards = false：破门也不弹
   4) 六张刀诀各自管用：连锁 / 余震 / 残影 / 打碟 / 飞刃 / 围观
   5) 只有刀砍的才触发连锁 / 余震 / 围观：刀诀杀的、炸死的都不再连下去
   6) 刀诀杀的不给无敌帧（唱片一直在切，不然人一直无敌）
   7) 奥义：连锁斩 + 余震 都满级 → 连环炸；连锁跳到的每一只都炸一圈
   8) 全满级以后不再弹；复活留着这一局的刀诀，新开一局清零
   9) 画面：三选一、HUD 小签、场上特效都画得出来不报错；测试数据记了挑的顺序 */
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
  const tapCard = i => { const L = run('pickLayout()'); tap(L.x + L.w / 2, L.ys[i] + L.h / 2); };
  return { run, step, tap, tapCard, cb };
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra === undefined ? '' : '→ ' + extra); }
}
// 开一局干净的场：教学已过、不刷怪、不合围、没有晶柱，怪全由测试自己摆
function fresh(E) {
  E.run('meta.tut = TUT_DONE;'); E.step(3);
  E.run('start(); enemies.length = 0; crystals.length = 0; crystalTimer = 1e9; spawnTimer = 1e9; waveTimer = 1e9; scoutLeft = 0; P.inv = 0;');
  E.step(2);
  E.run('enemies.length = 0; spawnTimer = 1e9; waveTimer = 1e9;');
}
// 摆一只不动的杂兵，返回它（相对主角的位置）
const put = (E, dx, dy) => E.run('(function () { const e = spawnEnemy(P.x + ' + dx + ', P.y + ' + dy + ', "grunt"); e.sp = 0; e.born = 1; return enemies.length - 1; })()');
const alive = (E, i) => E.run('enemies.indexOf(__E' + i + ') >= 0');
const tagE = (E, idx, i) => E.run('__E' + i + ' = enemies[' + idx + ']; 0');
// 斩够 n 只（远处摆一只、直接斩掉）
const killN = (E, n) => E.run('for (let i = 0; i < ' + n + '; i++) { spawnEnemy(P.x + 300, P.y, "grunt"); killEnemy(enemies.length - 1); } 0');

console.log('1) 破门才给');
{
  const E = makeEnv();
  fresh(E);
  killN(E, 40);
  E.step(30);
  ok(E.run('state') === 'play' && E.run('pickWait') <= 0, '斩了 40 只：不弹（不再攒豪气）', E.run('state'));
  E.run('breakLayer();');
  ok(E.run('pickWait') > 0 && E.run('state') === 'play', '破门：先让冲击波和横幅出来，等一下再弹');
  for (let i = 0; i < 60 && E.run('state') !== 'pick'; i++) E.step(1);
  ok(E.run('state') === 'pick', '然后弹三选一', E.run('state'));
  const ids = E.run('pick.opts.map(c => c.id)');
  ok(ids.length === 3 && new Set(ids).size === 3, '三张不重样', ids.join(','));
}

console.log('2) 三选一：停住、防误触、挑完回来');
{
  const E = makeEnv();
  fresh(E);
  put(E, 0, -260);
  E.run('breakLayer();');
  for (let i = 0; i < 60 && E.run('state') !== 'pick'; i++) E.step(1);
  const g0 = E.run('gameTime'), y0 = E.run('enemies[0].y');
  E.tapCard(0);
  ok(E.run('pick.chosen') === -1, '刚弹出来就点：不算（防的是按着斩的那根手指）');
  E.step(40);
  ok(E.run('gameTime') === g0 && E.run('enemies[0].y') === y0, '挑的时候世界停住', g0 + ' / ' + E.run('gameTime'));
  ok(E.run('state') === 'pick', '不点就一直等着');
  const id = E.run('pick.opts[1].id');
  E.tapCard(1);
  ok(E.run('pick.chosen') === 1, '过了 0.4 秒再点：挑中第二张');
  ok(E.run('touchId') === null && E.run('P.dashT') <= 0, '这一下不会顺手开摇杆、挥刀');
  E.step(20);
  ok(E.run('state') === 'play', '亮一下就回局内', E.run('state'));
  ok(E.run('clv("' + id + '")') === 1, '这张升到 1 级', id);
  ok(E.run('runPicks.length') === 1 && E.run('runPicks[0][0]') === id, '记下挑的顺序');
  ok(E.run('P.inv') > 0.1, '回来给一口无敌', E.run('P.inv').toFixed(2));
  ok(E.run('floats.some(f => f.text && f.text.indexOf(CARD_MAP["' + id + '"].name) === 0)'), '头顶报刀诀名');

  // 切后台：停在三选一，回来接着挑
  E.run('breakLayer();');
  for (let i = 0; i < 60 && E.run('state') !== 'pick'; i++) E.step(1);
  E.cb.hide();
  ok(E.run('state') === 'pick', '三选一时切后台：还停在三选一');
  E.cb.show();
  E.step(30);
  E.run('pickChoose(0);'); E.step(20);
  ok(E.run('state') === 'play' && E.run('runPicks.length') === 2, '回来照样能挑');
}

console.log('3) 教学局 / 关掉刀诀：破门也不弹');
{
  const E = makeEnv();
  E.run('meta.tut = 0;'); E.step(3);
  E.run('start();');
  ok(E.run('tutOn()'), '（教学局）');
  E.run('breakLayer();');
  E.step(30);
  ok(E.run('pickWait') <= 0 && E.run('state') !== 'pick', '教学局破门：不弹');

  const F = makeEnv();
  F.run('CFG.cards = false;');
  fresh(F);
  F.run('breakLayer();');
  F.step(30);
  ok(F.run('state') === 'play' && F.run('pickWait') <= 0, 'CFG.cards = false：整个关掉');
}

console.log('4) 六张刀诀各自管用');
{
  // 连锁斩：斩掉 a，刀光跳到 b；1 级只跳一只，c 还在
  let E = makeEnv();
  fresh(E);
  E.run('cardLv.chain = 1;');
  tagE(E, put(E, 0, -200), 'a'); tagE(E, put(E, 100, -200), 'b'); tagE(E, put(E, 200, -200), 'c');
  E.run('killEnemy(enemies.indexOf(__Ea));');
  E.step(1);
  ok(!alive(E, 'b') && alive(E, 'c'), '连锁斩 1 级：跳 1 只', E.run('enemies.length'));
  ok(E.run('zaps.length') === 1, '画一道电光');
  E = makeEnv(); fresh(E);
  E.run('cardLv.chain = 2;');
  tagE(E, put(E, 0, -200), 'a'); tagE(E, put(E, 100, -200), 'b'); tagE(E, put(E, 200, -200), 'c');
  E.run('killEnemy(enemies.indexOf(__Ea));');
  E.step(1);
  ok(!alive(E, 'b') && !alive(E, 'c'), '连锁斩 2 级：跳 2 只');

  // 余震：斩掉 a，旁边 40 的 b 一起炸掉，150 外的 c 不受影响
  E = makeEnv(); fresh(E);
  E.run('cardLv.quake = 1;');
  tagE(E, put(E, 0, -200), 'a'); tagE(E, put(E, 40, -200), 'b'); tagE(E, put(E, 150, -200), 'c');
  E.run('killEnemy(enemies.indexOf(__Ea));');
  E.step(1);
  ok(!alive(E, 'b') && alive(E, 'c'), '余震：一圈里的炸掉，圈外的不动');

  // 残影：往右砍一刀（砍空），刀路上之后站上去的怪，0.45 秒后被再割一次
  E = makeEnv(); fresh(E);
  E.run('cardLv.echo = 1; tryDash({ x: P.x + 400, y: P.y });');
  E.step(10);
  const m = E.run('echoes[0] ? { x0: echoes[0].x0, y0: echoes[0].y0, len: Math.hypot(echoes[0].x1 - echoes[0].x0, echoes[0].y1 - echoes[0].y0) } : null');
  ok(m && m.len > 60, '记下了这一刀的刀路', m && m.len.toFixed(0));
  E.run('P.vx = 0; P.vy = 0; P.glideT = 0; P.x = P.x + 0; ');
  E.run('(function () { const e = spawnEnemy(' + (m ? m.x0 + m.len * 0.4 : 0) + ', ' + (m ? m.y0 : 0) + ', "grunt"); e.sp = 0; __Ee = e; })()');
  ok(alive(E, 'e'), '（刀路上站了一只）');
  E.step(30);
  ok(!alive(E, 'e'), '0.45 秒后刀痕再割一次：斩掉');

  // 打碟：唱片转到哪切到哪
  E = makeEnv(); fresh(E);
  E.run('cardLv.disc = 1; discA = 0; calmT = 1;');
  tagE(E, put(E, 70, 0), 'd');
  E.step(1);
  ok(!alive(E, 'd'), '打碟：碰到唱片的怪被切掉');
  ok(E.run('P.inv') === 0, '刀诀杀的不给无敌帧', E.run('P.inv'));

  // 飞刃：收刀那一下甩出去，前面 150 的怪被穿掉
  E = makeEnv(); fresh(E);
  E.run('cardLv.blade = 1; tryDash({ x: P.x + 400, y: P.y });');
  for (let i = 0; i < 20 && E.run('blades.length') === 0; i++) E.step(1);
  ok(E.run('blades.length') === 1, '收刀时甩出一道飞刃');
  E.run('blades.length = 0; P.vx = 0; P.vy = 0; P.glideT = 0; P.dx = 1; P.dy = 0; launchBlades();');
  tagE(E, put(E, 150, 0), 'f'); tagE(E, put(E, 150, 200), 'g');
  E.step(15);
  ok(!alive(E, 'f') && alive(E, 'g'), '飞刃穿掉正前方的，旁边的不碰');
  ok(E.run('blades.length') === 0, '飞完 240 就没了');

  // 围观：斩一只，周围的怪凑到刀前、看呆；看呆的撞上来不死
  E = makeEnv(); fresh(E);
  E.run('cardLv.pull = 1; P.dx = 0; P.dy = -1;');
  tagE(E, put(E, 0, -100), 'a'); tagE(E, put(E, 100, -170), 'b'); tagE(E, put(E, 400, -170), 'c');
  E.run('killEnemy(enemies.indexOf(__Ea));');
  E.step(1);
  ok(E.run('__Eb.stun') > 0 && E.run('__Ec.stun') <= 0, '圈里的看呆，圈外的不管');
  E.step(12);
  ok(E.run('Math.hypot(wdelta(__Eb.x - P.x), wdelta(__Eb.y - (P.y - 170)))') < 40, '看呆的凑到刀前那一点',
    E.run('Math.hypot(wdelta(__Eb.x - P.x), wdelta(__Eb.y - (P.y - 170)))').toFixed(0));
  E.run('__Eb.stun = 0.3; __Eb.x = P.x; __Eb.y = P.y; P.inv = 0; P.dashT = 0; P.glideT = 0; shield = 0;');
  E.step(1);
  ok(E.run('state') === 'play', '看呆的撞上来：不死', E.run('state'));
  E.run('killEnemy(enemies.indexOf(__Ec));');
  ok(!E.run('cardQ.some(q => q.k === "pull")'), '围观有冷却：1.2 秒内再斩不再吸');
}

console.log('5) 只有刀砍的才连下去');
{
  let E = makeEnv(); fresh(E);
  E.run('cardLv.chain = 1; cardLv.quake = 1;');
  tagE(E, put(E, 0, -200), 'a'); tagE(E, put(E, 100, -200), 'b');
  E.run('killEnemy(enemies.indexOf(__Ea), "blast");');
  E.step(1);
  ok(alive(E, 'b') && E.run('zaps.length') === 0, '炸死的：不连锁、不余震');
  E.run('cardQ.length = 0; killEnemy(enemies.indexOf(__Eb), "disc");');
  ok(E.run('cardQ.length') === 0, '刀诀杀的：不再触发别的刀诀');
}

console.log('6) 奥义：连环炸');
{
  const E = makeEnv(); fresh(E);
  E.run('cardLv.chain = 3; cardLv.quake = 2; pick = { opts: [CARD_MAP.quake], t: 1, chosen: 0, ct: 0 }; state = "pick";');
  E.step(20);
  ok(E.run('state') === 'play' && E.run('clv("quake")') === 3, '余震升满');
  ok(E.run('ultOn.boom') === 1, '连锁斩 + 余震 都满级：合成连环炸');
  ok(E.run('banners.some(b => b.text.indexOf("连环炸") >= 0)'), '横幅报奥义');
  tagE(E, put(E, 0, -300), 'x');
  E.run('cardQ.length = 0; killEnemy(enemies.indexOf(__Ex), "chain");');
  ok(E.run('cardQ.some(q => q.k === "quake" && Math.abs(q.r - CD.quakeR[3] * CD.boomK) < 0.01)'), '连锁跳到的那只原地炸一圈（满级余震再放大）');
}

console.log('7) 全满级 / 复活 / 新开一局');
{
  const E = makeEnv(); fresh(E);
  E.run('CARDS.forEach(c => cardLv[c.id] = 3); breakLayer();');
  E.step(30);
  ok(E.run('state') === 'play' && E.run('pickWait') <= 0, '全满级：破门也不再弹');
  E.run('CARDS.forEach(c => cardLv[c.id] = 0); cardLv.chain = 2; runPicks = [["chain", 1, 3], ["chain", 2, 9]];');
  E.run('P.inv = 0; shield = 0; die("杂兵");');
  ok(E.run('state') === 'dead', '（死了）');
  E.run('doRevive();');
  ok(E.run('clv("chain")') === 2, '复活：这一局的刀诀还在');
  E.run('P.inv = 0; shield = 0; die("杂兵"); finishRun();');
  const rep = E.run('testReport().join("\\n")');
  ok(/刀诀（挑的顺序 · 第几秒）：连锁斩1@3 连锁斩2@9/.test(rep), '测试数据记了挑的顺序', (rep.match(/刀诀[^\n]*/) || [''])[0]);
  E.run('start();');
  ok(E.run('clv("chain")') === 0 && E.run('pickWait') === 0 && E.run('runPicks.length') === 0, '新开一局：清零');
}

console.log('8) 画面：都画得出来');
{
  const E = makeEnv(); fresh(E);
  E.run('CARDS.forEach(c => cardLv[c.id] = 2); ultOn.boom = 1; runPicks = [["chain", 1, 3]];');
  E.run('zaps.push({ pts: [P.x, P.y, P.x + 80, P.y + 20, P.x + 150, P.y - 30], life: 0.1, max: 0.16 });');
  E.run('echoes.push({ seq: 99, x0: P.x - 100, y0: P.y, x1: P.x + 100, y1: P.y, t: 0.2, n: 1, w: 28, fl: 0.1 });');
  E.run('P.dx = 1; P.dy = 0; launchBlades();');
  tagE(E, put(E, 0, -300), 's'); E.run('__Es.stun = 1;');
  let err = null;
  try { E.run('render();'); } catch (e) { err = e; }
  ok(!err, '局内：电光 / 刀痕 / 飞刃 / 唱片 / 看呆的圈 / 小签', err && err.message);
  E.run('openPick();');
  err = null;
  try { E.step(5); E.run('render();'); E.step(30); E.run('pickChoose(2);'); E.step(3); } catch (e) { err = e; }
  ok(!err, '三选一界面（含已有刀诀、点中那张的亮）', err && err.message);
  const L = E.run('pickLayout()');
  ok(L.ys[0] > E.run('SAFE_TOP') + 100 && L.ys[2] + L.h < E.run('H_CSS - SAFE_BOTTOM') - 100, '三张卡在屏幕中间，上面留标题、下面留已有刀诀', JSON.stringify(L));
  // 标题顶（第一张卡上面 68）不能压到身后的连斩块（数字 / 倍率行 / 剑气珠到 hudTop() + 167）
  ok(L.ys[0] - 68 >= E.run('hudTop()') + 167, '标题不压身后的连斩数和倍率行', (L.ys[0] - 68) + ' vs ' + (E.run('hudTop()') + 167));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
