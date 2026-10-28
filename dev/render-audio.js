#!/usr/bin/env node
/*
 * 把 game.js 里现场合成的声音离线渲染成 audio/ 下的文件（抖音版用，见 game.js「抖音版声音」）
 *
 *   npm i --no-save node-web-audio-api @breezystack/lamejs   （装在项目根目录，不进包也不进 git）
 *   node dev/render-audio.js            全部重渲（先清空 audio/）
 *   node dev/render-audio.js shatter    只渲染列出来的单发音效，不清空、不碰别的文件（加新音效时用）
 *   node dev/render-audio.js bgm        只重渲 BGM 的几档循环（改了 bgmVoice / BGM_LV 时用），别的文件不动
 *
 * 渲染用的就是 game.js 里那个 S —— 不另抄一份合成参数，改了 S 重跑一遍就对得上。
 * Linux 上报 libasound.so.2 找不到：apt-get download libasound2t64，dpkg-deb -x 解出来，
 * 再用 LD_LIBRARY_PATH 指到解出来的 usr/lib/x86_64-linux-gnu。
 *
 * 产物：
 *   bgm-0..5.wav    每档（BGM_LV）一份 BGM 完整混音，各一个 2 小节的无缝循环
 *   drone.wav       嗡鸣循环（按 DRONE_REF 增益渲染）
 *   上面两种的 .mp3 wav 播不了时的备份；mp3 首尾有编码器补的静音，所以做成 4 个循环长，少断几次
 *   其余 .mp3       单发音效；thump 按 vol = 1 渲染，播放时再缩
 */
const fs = require('fs'), vm = require('vm'), path = require('path');

let OfflineAudioContext;
try {
  OfflineAudioContext = require('node-web-audio-api').OfflineAudioContext;
} catch (e) {
  console.error('[render] 缺 node-web-audio-api：先在项目根目录跑 npm i --no-save node-web-audio-api');
  console.error('         ' + e.message.split('\n')[0]);
  process.exit(1);
}

let Mp3Encoder;            // ESM 包，main() 里 import

const SR = 44100;          // 踩镲在 8kHz 以上，采样率不能低
const SR_BGM = 32000;      // BGM 一档一份、同时在包里：32k 还留得住 16k 以下的踩镲，体积少四分之一
const SR_DRONE = 22050;    // 嗡鸣过了 190Hz 低通，用不着高采样率
const OUT = path.join(__dirname, '..', 'audio');

/* ---------- 把 game.js 跑在沙箱里（浏览器分支），拿到 S ---------- */
const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
let current = null;        // 下一次 new AudioContext() 拿到的离线上下文
function AC() { return current; }

const canvas = {
  width: 0, height: 0, clientWidth: 390, clientHeight: 844,
  getContext: function () {
    return new Proxy({}, {
      get(t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return function () { return { addColorStop() {} }; };
        if (k === 'measureText') return function () { return { width: 10 }; };
        return t[k] !== undefined ? t[k] : function () {};
      },
      set(t, k, v) { t[k] = v; return true; }
    });
  },
  addEventListener() {}, getBoundingClientRect: function () { return { left: 0, top: 0, width: 390, height: 844 }; }
};
const sb = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 1; },
  localStorage: { getItem: function () { return null; }, setItem() {} },
  window: { devicePixelRatio: 2, addEventListener() {}, AudioContext: AC },
  document: { getElementById: function () { return canvas; } }
};
vm.createContext(sb);
vm.runInContext(src, sb, { filename: 'game.js' });
const K = vm.runInContext('({ S, BGM_LV, BGM_STEP, BGM_LOOP, HIT_LEVELS, DRONE_REF, CUTS })', sb);
const S = K.S;

/* ---------- 渲染 ---------- */
// 每次一个全新的离线上下文、一个全新初始化的 S；嗡鸣默认摘掉，别混进每个音效里
async function render(seconds, sr, play) {
  const ac = new OfflineAudioContext(1, Math.ceil(seconds * sr), sr);
  ac.resume = function () { return Promise.resolve(); };   // 离线上下文开始渲染前不能 resume
  current = ac;
  S.ac = null; S.ready = false; S.bgmTimer = null;
  S.init();
  if (!S.ready) throw new Error('S.init 失败');
  S.droneGain.disconnect();
  play(S, ac);
  const buf = await ac.startRendering();
  return buf.getChannelData(0);
}

function peakOf(data) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
  return peak;
}

function save(file, buf, seconds, peak) {
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log('  ' + file.padEnd(14) + seconds.toFixed(3).padStart(7) + 's  峰值 ' + peak.toFixed(3) +
    '  ' + (buf.length / 1024).toFixed(0).padStart(4) + ' KB' + (peak > 1 ? '  ⚠ 削波' : ''));
  return buf.length;
}

function toPcm16(data) {
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, data[i])) * 32767);
  return pcm;
}

function writeWav(name, data, sr) {
  const n = data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const pcm = toPcm16(data);
  for (let i = 0; i < n; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return save(name + '.wav', buf, n / sr, peakOf(data));
}

// repeat：循环的备份版要把同一段接几遍再编码
function writeMp3(name, data, sr, kbps, repeat) {
  const reps = repeat || 1;
  const one = toPcm16(data), pcm = new Int16Array(one.length * reps);
  for (let r = 0; r < reps; r++) pcm.set(one, r * one.length);
  const enc = new Mp3Encoder(1, sr, kbps), out = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (b.length) out.push(Buffer.from(b));
  }
  out.push(Buffer.from(enc.flush()));
  return save(name + '.mp3', Buffer.concat(out), pcm.length / sr, peakOf(data));
}

// 单发音效：尾巴低于 -80dB 的部分剪掉
function trim(d) {
  let end = d.length;
  while (end > 1 && Math.abs(d[end - 1]) < 1e-4) end--;
  return d.subarray(0, Math.min(d.length, end + 64));
}

// 单发音效：名字 = 文件名
const shots = {
  thump:    function (S) { S.thump(1, 0); },
  upgrade:  function (S) { S.upgrade(); },
  collapse: function (S) { S.collapse(); },
  scream:   function (S) { S.scream(); },
  shatter:  function (S) { S.shatter(); }
  // whisper 不渲染：S.whisper 在 forEach 回调里用了 this.master，严格模式下 this 是 undefined，
  // 一直是抛错后被吞掉、从来没响过（只有恐怖版皮肤会调它）。修好之后再加回来
};
// 刀声四种（CUTS）：每种一个破风 whoosh-v，每档击中一个 hit-<档>-v
for (let v = 0; v < K.CUTS.length; v++) {
  shots['whoosh-' + v] = function (S) { S.whoosh(v); };
  K.HIT_LEVELS.forEach(function (lv) { shots['hit-' + lv + '-' + v] = function (S) { S.hit(lv, v); }; });
}
// 升段音：每一段一个文件（tier-0 … tier-6），逐段升调
for (let i = 0; i < 7; i++) shots['tier-' + i] = (function (k) { return function (S) { S.tierUp(k); }; })(i);
shots.tick = function (S) { S.tick(1); };

// BGM：连排两轮，取第二轮。第一轮的尾音落进第二轮开头，正好就是循环接回来时的样子
async function renderBgm() {
  const L = K.BGM_LOOP, n = Math.round(L * SR_BGM);
  let total = 0;
  for (let i = 0; i < K.BGM_LV; i++) {
    const d = await render(2 * L + 0.8, SR_BGM, function (S) {
      S.bgmLv = i;
      for (let k = 0; k < 64; k++) S.bgmVoice(k % 32, k * K.BGM_STEP);
    });
    const loop = d.subarray(n, 2 * n);
    total += writeWav('bgm-' + i, loop, SR_BGM);
    total += writeMp3('bgm-' + i, loop, SR_BGM, 48, 4);
  }
  return total;
}

async function main() {
  try {
    Mp3Encoder = (await import('@breezystack/lamejs')).Mp3Encoder;
  } catch (e) {
    console.error('[render] 缺 @breezystack/lamejs：先在项目根目录跑 npm i --no-save @breezystack/lamejs');
    process.exit(1);
  }
  const only = process.argv.slice(2);
  if (only.length === 1 && only[0] === 'bgm') {
    for (const f of fs.readdirSync(OUT)) if (/^bgm-\d+\.(wav|mp3)$/.test(f)) fs.rmSync(path.join(OUT, f));
    const n = await renderBgm();
    console.log('[render] 只重渲了 BGM，共 ' + (n / 1024).toFixed(0) + ' KB');
    return;
  }
  if (only.length) {
    let n = 0;
    for (const name of only) {
      if (!shots[name]) { console.error('[render] 没有这个单发音效：' + name); process.exit(1); }
      n += writeMp3(name, trim(await render(2, SR, shots[name])), SR, 64);
    }
    console.log('[render] 只渲染了 ' + only.join(' / ') + '，共 ' + (n / 1024).toFixed(0) + ' KB');
    return;
  }

  // 先清空：改名 / 删掉的声音不能留个旧文件在包里
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let total = 0;
  console.log('[render] → ' + OUT);

  total += await renderBgm();

  // 嗡鸣：41Hz / 82Hz 在 2 秒里都是整周期，取稳态的 2 秒就是无缝循环。LFO 交给播放端模拟
  {
    const d = await render(4, SR_DRONE, function (S) {
      S.droneLfo.disconnect();
      S.droneGain.gain.value = K.DRONE_REF;
      S.droneGain.connect(S.master);
    });
    const loop = d.subarray(2 * SR_DRONE, 4 * SR_DRONE);
    total += writeWav('drone', loop, SR_DRONE);
    total += writeMp3('drone', loop, SR_DRONE, 32, 4);
  }

  for (const name in shots) total += writeMp3(name, trim(await render(2, SR, shots[name])), SR, 64);

  console.log('[render] 完成，共 ' + (total / 1024).toFixed(0) + ' KB');
}

main().catch(function (e) { console.error('[render] ' + (e && e.stack || e)); process.exit(1); });
