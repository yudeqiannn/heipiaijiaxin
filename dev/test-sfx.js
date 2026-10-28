/* 抖音版声音（文件版 SF）测试
   1) 平台选择：抖音一律文件版（哪怕有 createWebAudioContext）；微信有 WebAudio → 仍走合成
   2) 用到的每个文件都在 audio/ 里；循环的 mp3 备份也在
   3) 开局：三档 BGM + 嗡鸣都在循环，同一时刻只有一档出声
   4) 换档只发生在小节线上
   5) 心跳落在 16 分网格上，危险越高越密
   6) hit(n) 取最近的一档；刀声四种轮流（冲刺换下一种，砍中用同一种），开机建好、局内不新建，同一帧只响一次；冷门音效最多 SFX_POOL 个，满了掐最早那个
   7) 停 / 续：bgmStop 全部暂停，bgmStart 从头起
   8) 对表：播放进度和墙钟错开时，网格跟播放进度走
   9) 开机预加载、静音键、屏幕上的音频体检
  10) wav 播不了自动换 mp3 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');
const AUDIO = path.join(__dirname, '..', 'audio');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); }
}

// opt.global：'tt'（抖音，默认）或 'wx'；opt.webAudio：平台有没有 createWebAudioContext
function makeEnv(opt) {
  opt = opt || {};
  const canvas = {
    width: 0, height: 0,
    getContext: () => new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        return t[k] !== undefined ? t[k] : function () {};
      },
      set(t, k, v) { t[k] = v; return true; }
    })
  };
  const players = [];
  let clock = 1000;                       // 毫秒，测试自己推
  let interval = null;
  function makeAudio() {
    const a = {
      src: '', loop: false, volume: 1, currentTime: 0, playing: false, plays: 0, stops: 0,
      obeyMuteSwitch: true, endedCb: null, playCb: null, canplayCb: null, errorCb: null,
      play() { this.playing = true; this.plays++; this.startAt = clock; if (this.playCb) this.playCb(); },
      pause() { this.playing = false; },
      stop() { this.playing = false; this.stops++; },
      seek() {}, destroy() {},
      // 回调按"后注册的覆盖前面的"来模拟：哪个平台都不怕
      onEnded(cb) { this.endedCb = cb; }, onPlay(cb) { this.playCb = cb; },
      onCanplay(cb) { this.canplayCb = cb; }, onError(cb) { this.errorCb = cb; }
    };
    players.push(a);
    return a;
  }
  const tt = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844, safeArea: { top: 40, bottom: 830 } }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    getStorageSync: () => '', setStorageSync() {},
    setKeepScreenOn() {}, onHide() {}, onShow() {},
    createInnerAudioContext: makeAudio
  };
  if (opt.webAudio) tt.createWebAudioContext = () => null;
  const sb = {
    console, Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat, Object,
    performance: { now: () => clock },
    setTimeout, clearTimeout,
    setInterval: cb => { interval = cb; return 7; },
    clearInterval: () => { interval = null; },
    requestAnimationFrame: () => 1
  };
  sb[opt.global || 'tt'] = tt;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'game.js' });
  const K = vm.runInContext('({ S, SF, AUD, audioStatus, start, BGM_STEP, BGM_LOOP, BGM_LV, HIT_LEVELS, SFX_POOL, bgmLvOf, CUTS })', sb);
  return {
    K, players,
    // 推进 ms 毫秒，每 30ms 跑一次 BGM 的泵（和 setInterval 一样）
    advance(ms) {
      for (let t = 0; t < ms; t += 30) { clock += 30; if (interval) interval(); }
    },
    get clock() { return clock; },
    byName: name => players.filter(p => p.src.replace(/\.(wav|mp3)$/, '') === 'audio/' + name)
  };
}

console.log('1) 平台选择');
{
  ok(makeEnv().K.AUD.mode === '文件', '抖音（无 WebAudio）→ 文件版');
  ok(makeEnv({ webAudio: true }).K.AUD.mode === '文件', '抖音上就算有 createWebAudioContext 也走文件版');
  ok(makeEnv({ global: 'wx', webAudio: true }).K.AUD.mode === '', '微信有 WebAudio → 仍是合成版（等玩家点屏幕才起）');
  ok(makeEnv({ global: 'wx' }).K.AUD.mode === '文件', '没有 WebAudio 的其它平台 → 文件版');
}

console.log('2) 文件齐全');
{
  const e = makeEnv(), S = e.K.S;
  e.K.start();
  S.whoosh(); S.upgrade(); S.collapse(); S.scream(); S.thump(0.2);
  for (let n = 0; n <= 25; n++) S.hit(n);
  const srcs = Array.from(new Set(e.players.map(p => p.src)));
  const missing = srcs.filter(s => !fs.existsSync(path.join(__dirname, '..', s)));
  ok(srcs.length >= 15, '用到了 ' + srcs.length + ' 个文件');
  ok(missing.length === 0, missing.length ? '缺文件：' + missing.join(', ') : '全部在 audio/ 里');
  const loops = srcs.filter(f => /\.wav$/.test(f));
  const nLoop = e.K.BGM_LV + 1;            // 每档一条 BGM + 嗡鸣
  ok(loops.length === nLoop && loops.every(f => fs.existsSync(path.join(__dirname, '..', f.replace(/\.wav$/, '.mp3')))),
     nLoop + ' 条循环都是 wav，各有 mp3 备份');
  ok(srcs.filter(f => /\.mp3$/.test(f)).length === srcs.length - nLoop, '单发音效全是 mp3');
  const fallback = loops.map(f => f.replace(/\.wav$/, '.mp3'));
  const onDisk = fs.readdirSync(AUDIO).map(f => 'audio/' + f);
  const unused = onDisk.filter(f => srcs.indexOf(f) < 0 && fallback.indexOf(f) < 0);
  ok(unused.length === 0, unused.length ? '包里有用不到的文件：' + unused.join(', ') : 'audio/ 里没有用不到的文件');
}

console.log('3) 开局');
{
  const e = makeEnv(), S = e.K.S;
  e.K.start();
  const bgm = Array.from({ length: e.K.BGM_LV }, (_, i) => e.byName('bgm-' + i)[0]);
  const drone = e.byName('drone')[0];
  ok(e.K.BGM_LV === 6 && bgm.every(a => a && a.loop && a.playing), '六档 BGM 都在循环播放');
  ok(drone && drone.loop && drone.playing, '嗡鸣在循环播放');
  ok(bgm.filter(a => a.volume === 1).length === 1 && bgm.filter(a => a.volume === 0).length === bgm.length - 1, '同一时刻只有一档出声');
  ok(bgm[0].volume === 1, '开局 → 第 0 档');
  ok(S.bgmOn(), 'bgmOn() 为真');
  const bt = e.clock / 1000 - S.bgmEpoch;
  ok(bt >= 0 && bt < 0.05, '拍子原点就是开局那一刻（' + bt + '）');
}

console.log('4) 换档：按连斩数的门槛，往上在拍子上，往下在小节线');
{
  const L = makeEnv().K.bgmLvOf;
  ok([0, 25, 99, 100, 299, 300, 599, 600, 999, 1000, 1499, 1500, 5000].map(L).join() === '0,0,0,1,1,2,2,3,3,4,4,5,5',
     '连斩数 → 档位：×100 / ×300 / ×600 / ×1000 / ×1500 各升一档（开场那一刀 ×25 不升）');

  const e = makeEnv(), S = e.K.S, STEP = e.K.BGM_STEP * 1000;
  e.K.start();
  const bgm = Array.from({ length: e.K.BGM_LV }, (_, i) => e.byName('bgm-' + i)[0]);
  const on = () => bgm.findIndex(a => a.volume === 1);
  const one = () => bgm.filter(a => a.volume === 1).length === 1;
  e.advance(STEP * 1.2);                  // 第 1 格中间
  S.setBgm(L(600));                       // 连到 ×600
  e.advance(STEP * 1.5);                  // 第 2 格多一点，还没到下一拍
  ok(on() === 0, '一拍中间不换（' + on() + '）');
  e.advance(STEP * 1.6);                  // 第 4 格之前 25ms 以内
  ok(on() === 3 && one(), '下一拍就升到第 3 档，不等小节线（' + on() + '）');
  S.setBgm(L(1500));
  e.advance(STEP * 4);
  ok(on() === 5 && one(), '再升到顶档（' + on() + '）');

  S.setBgm(0);                            // 断连
  e.advance(STEP * 5);                    // 第 13 格左右：过了好几拍，还没到第 16 格
  ok(on() === 5, '往下不在拍子上掉，等小节线（' + on() + '）');
  e.advance(STEP * 4);
  ok(on() === 0 && one(), '到小节线回到第 0 档（' + on() + '）');
}

console.log('5) 心跳');
{
  function thumpSteps(danger) {
    const e = makeEnv(), S = e.K.S, STEP = e.K.BGM_STEP * 1000;
    e.K.start();
    S.heartDanger = danger;
    e.advance(STEP * 40);
    return e.byName('thump').reduce((s, p) => s + p.plays, 0);
  }
  const calm = thumpSteps(0), mid = thumpSteps(0.5), hot = thumpSteps(0.9);
  ok(calm >= 2 && mid > calm && hot > mid, '危险越高跳得越密（40 格内：' + calm + ' / ' + mid + ' / ' + hot + ' 次）');

  // 落格：每次心跳都在 16 分网格线之后 30ms（一个泵周期）以内
  const e = makeEnv(), S = e.K.S, STEP = e.K.BGM_STEP * 1000;
  e.K.start();
  const t0 = e.clock;
  S.heartDanger = 0.9;
  const hits = [];
  const orig = S.sfx;
  S.sfx = function (name, vol) { if (name === 'thump') hits.push(e.clock); return orig.call(S, name, vol); };
  e.advance(STEP * 32);
  const off = hits.map(t => ((t - t0) % STEP + STEP) % STEP);
  const worst = Math.max.apply(null, off.map(o => Math.min(o, STEP - o)));
  ok(hits.length >= 6 && worst <= 30, '心跳落在网格上（最大偏差 ' + worst.toFixed(1) + 'ms，≤ 一个泵周期 30ms）');
}

console.log('6) 音效选档与并发');
{
  const e = makeEnv(), S = e.K.S;
  e.K.start();
  const before = e.players.length;
  S.hit(1); e.advance(50); S.hit(6); e.advance(50); S.hit(50);
  ok(e.byName('hit-1-0')[0].plays === 1 && e.byName('hit-8-0')[0].plays === 1 && e.byName('hit-20-0')[0].plays === 1,
     'hit(1)→hit-1，hit(6)→hit-8，hit(50)→hit-20（还没冲刺过：用第一种刀声）');
  // 刀声四种轮流：冲刺一次换下一种，这一刀砍中用同一种
  const NC = e.K.CUTS.length, seq = [];
  for (let i = 0; i < NC * 2; i++) {
    e.advance(50); const tw = e.clock; S.whoosh();
    e.advance(50); const th = e.clock; S.hit(8);
    for (let v = 0; v < NC; v++) {
      const w = e.byName('whoosh-' + v)[0], h = e.byName('hit-8-' + v)[0];
      if (w.startAt === tw && h.startAt === th) seq.push(v);
    }
  }
  ok(NC === 4 && seq.join('') === '01230123', '冲刺 8 次：刀声按 0 1 2 3 0 1 2 3 轮流，砍中声跟着同一种（' + seq.join('') + '）');
  // 开机就建好、局内不再新建（抖音上现建播放器会卡在斩的那一帧）；每种一个播放器，轮到它还在响就掐掉重来
  const w0 = e.byName('whoosh-0');
  ok(w0.length === 1 && e.players.length === before, '刀声都是开机建好的，局内没新建（' + (e.players.length - before) + '）');
  ok(w0[0].plays === 2 && w0[0].stops === 1, '轮回来还在响：掐掉重来（放 ' + w0[0].plays + ' 次，停 ' + w0[0].stops + ' 次）');
  w0[0].endedCb();
  for (let i = 0; i < NC; i++) { e.advance(50); S.whoosh(); }
  ok(w0[0].plays === 3 && w0[0].stops === 1, '放完的播放器直接复用，不用 stop');
  // 一刀砍穿好几只：同一帧里只响一次（四种击中是四个文件，也只响一个）
  e.advance(50);
  const allHits = () => e.players.filter(p => /hit-/.test(p.src)).reduce((s, p) => s + p.plays, 0), hp0 = allHits();
  S.hit(8); S.hit(8); S.hit(3); S.hit(20);
  ok(allHits() === hp0 + 1, '同一帧砍穿 4 只：击中声只响 1 次（' + (allHits() - hp0) + '）');
  e.advance(50);
  S.hit(8);
  ok(allHits() === hp0 + 2, '隔 50ms 的下一刀照响');
  // 没预建的冷门音效照旧按需开，封顶 SFX_POOL
  for (let i = 0; i < 5; i++) { e.advance(50); S.scream(); }
  ok(e.byName('scream').length === e.K.SFX_POOL, '冷门音效按需开，封顶 ' + e.K.SFX_POOL + ' 个');
  S.thump(0.2);
  ok(Math.abs(e.byName('thump')[0].volume - 0.2) < 1e-9, 'thump 的音量照传');
}

console.log('7) 停 / 续');
{
  const e = makeEnv(), S = e.K.S;
  e.K.start();
  const bgm = [0, 1, 2].map(i => e.byName('bgm-' + i)[0]);
  S.bgmStop();
  ok(bgm.every(a => !a.playing) && !e.byName('drone')[0].playing, 'bgmStop：全部暂停');
  ok(!S.bgmOn(), 'bgmStop 后 bgmOn 为假');
  ok(bgm.every(a => a.stops === 0), '第一次起播没有先 stop（刚建好的播放器 stop 再 play，有的机型会吞掉 play）');
  const stops = bgm.map(a => a.stops);
  S.bgmStart();
  ok(bgm.every((a, i) => a.playing && a.stops === stops[i] + 1), 'bgmStart：stop 再 play，从头起');
}

console.log('8) 对表');
{
  const e = makeEnv(), S = e.K.S, L = e.K.BGM_LOOP;
  e.K.start();
  const a0 = e.byName('bgm-0')[0];
  const beat = () => e.clock / 1000 - S.bgmEpoch;   // 墙钟推出来的播放位置
  e.advance(1000);
  // 真实播放比墙钟慢了 0.2 秒（比如起播卡了一下）。下一次泵在 30ms 后，进度也要跟着走 30ms
  a0.currentTime = ((beat() + 0.03 - 0.2) % L + L) % L;
  e.advance(30);
  const lag = ((beat() - a0.currentTime) % L + L) % L;
  ok(Math.min(lag, L - lag) < 0.05, '墙钟跟上了真实进度（误差 ' + (Math.min(lag, L - lag) * 1000).toFixed(0) + 'ms）');
  // 小误差不来回拽
  const ep = S.bgmEpoch;
  a0.currentTime = ((beat() + 0.03 - 0.02) % L + L) % L;
  e.advance(30);
  ok(S.bgmEpoch === ep, '20ms 以内的误差不动（不抖）');
}

console.log('9) 开机预加载 / 静音键 / 体检');
{
  const e = makeEnv(), K = e.K;
  ok(e.players.length === 35 && K.AUD.n === 35, '还没点屏幕就建好了 35 个播放器（6 档 BGM + 嗡鸣 + 4 个常用音效含光盾碎 + 快断滴答 + 7 段升段音 + 四种刀声各 1 个破风、3 档击中）');
  ok(e.players.every(a => a.obeyMuteSwitch === false), '全部 obeyMuteSwitch = false（iOS 静音键开着也出声）');
  e.players.slice(0, 5).forEach(a => a.canplayCb && a.canplayCb());
  ok(K.AUD.ok === 5 && K.audioStatus() === '音频 文件 · 就绪 5/35 · 播放 0', '体检行：' + K.audioStatus());
  K.start();
  ok(K.AUD.plays === 7, '开局 7 条循环都报了 onPlay（' + K.AUD.plays + '）');
  ok(makeEnv({ global: 'wx', webAudio: true }).K.audioStatus() === '音频 未启动', '合成版没点屏幕前：音频 未启动');
}

console.log('9b) 循环第一次 play 被吞：加载好了补一次');
{
  const e = makeEnv(), K = e.K;
  const b0 = e.byName('bgm-0')[0];
  const swallow = b0.play;
  b0.play = function () { this.plays++; };           // 还没加载完：调用了，但没放出来（不触发 onPlay）
  K.start();
  ok(b0.plays === 1 && !b0.playing, '开局叫了 play，但被吞了');
  b0.play = swallow;
  b0.canplayCb();
  ok(b0.playing && b0.plays === 2, '加载好了（canplay）：补放一次');
  b0.canplayCb();
  ok(b0.plays === 2, '已经放出来了：再来 canplay 不重复放');
  const sfx = e.byName('whoosh-0')[0], n0 = sfx.plays;
  sfx.canplayCb && sfx.canplayCb();
  ok(sfx.plays === n0, '单发音效加载好不会自己响');
}

console.log('10) wav 播不了换 mp3');
{
  const e = makeEnv(), S = e.K.S;
  e.K.start();
  const b1 = e.byName('bgm-1')[0], dr = e.byName('drone')[0];
  const plays = b1.plays;
  b1.errorCb({ errCode: 10004, errMsg: 'format not supported' });
  ok(b1.src === 'audio/bgm-1.mp3', '出错后 src 换成 bgm-1.mp3');
  ok(b1.plays === plays + 1, '正在放的循环换完接着放');
  ok(e.K.AUD.err === 1 && /出错 1：bgm-1\.wav format not supported/.test(e.K.audioStatus()), '体检行带上错误：' + e.K.audioStatus());
  S.bgmStop();
  const dp = dr.plays;
  dr.errorCb({ errMsg: 'x' });
  ok(dr.src === 'audio/drone.mp3' && dr.plays === dp, '停着的循环只换 src，不自己响');
  b1.errorCb({ errMsg: 'mp3 也不行' });
  ok(b1.src === 'audio/bgm-1.mp3' && e.K.AUD.err === 3, 'mp3 也出错就停在 mp3，不来回换');
}

console.log('11) 嗡鸣音量少设几次（每设一次走一趟原生；黑潮在屏幕里时危险度一直变，以前一秒设二十多次）');
{
  const e = makeEnv(), S = e.K.S;
  e.K.start();
  const dr = e.byName('drone')[0];
  let sets = 0, v = dr.volume;
  Object.defineProperty(dr, 'volume', { get() { return v; }, set(x) { v = x; sets++; }, configurable: true });
  // 黑潮在屏幕里晃：危险度在 0.4~1 之间来回变，3 秒
  for (let t = 0; t < 3000; t += 30) { S.setTension(0.7 + 0.3 * Math.sin(t / 170)); e.advance(30); }
  ok(sets / 3 <= 7, '危险度一直在变：一秒最多设 ' + (sets / 3).toFixed(1) + ' 次（≤ 7）');
  sets = 0;
  for (let t = 0; t < 2000; t += 30) { S.setTension(1); e.advance(30); }
  const hi = v;
  ok(Math.abs(hi - 0.87) < 0.17, '贴脸（危险 1）：音量跟上去了 ' + hi.toFixed(2));
  for (let t = 0; t < 3000; t += 30) { S.setTension(0); e.advance(30); }
  ok(v < 0.3, '甩开（危险 0）：音量落回来 ' + v.toFixed(2));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
