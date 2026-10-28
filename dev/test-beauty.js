/* 美化后的无头冒烟测试 v2：
   ready → tap 开始 → 按住攻击跑 60 秒游戏时间
   覆盖：新背景（残骸/浮尘）、披风刀客、软体敌人、
         15s+ 重型（六边甲壳）、40s+ 冲锋者（锯齿尖刺）、死亡界面 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

function makeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : function () {};
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const ctxMock = makeCtx();
const canvasMock = {
  width: 0, height: 0, clientWidth: 390, clientHeight: 844,
  getContext: () => ctxMock,
  addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
};

// Web Audio mock：currentTime 走真实时间，BGM 调度器能真的排拍，合成路径被完整执行
function audioMock() {
  const param = () => ({
    value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, cancelScheduledValues() {}
  });
  const node = () => ({
    connect() { return this; }, disconnect() {}, start() {}, stop() {},
    frequency: param(), gain: param(), Q: param(), type: '', buffer: null
  });
  const ac = {
    get currentTime() { return Date.now() / 1000; },
    sampleRate: 44100,
    state: 'running',
    destination: node(),
    createGain: node, createOscillator: node,
    createBufferSource: node, createBiquadFilter: node,
    createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }),
    resume() { ac.state = 'running'; }
  };
  return ac;
}

const handlers = {};
const storage = {};
const ttMock = {
  createCanvas: () => canvasMock,
  getWindowInfo: () => ({
    pixelRatio: 2, windowWidth: 390, windowHeight: 844,
    safeArea: { top: 40, bottom: 830 }
  }),
  onTouchStart: (cb) => { handlers.start = cb; },
  onTouchMove: (cb) => { handlers.move = cb; },
  onTouchEnd: (cb) => { handlers.end = cb; },
  onTouchCancel: (cb) => { handlers.cancel = cb; },
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  createWebAudioContext: audioMock,
  setKeepScreenOn() {},
  onHide() {}, onShow() {},
  createRewardedVideoAd: () => ({
    load() {}, show() { return Promise.reject(new Error('no ad')); },
    onClose(cb) { this._cb = cb; }, onError() {}
  }),
  shareAppMessage() {}
};

let rafCb = null;
const sandbox = {
  tt: ttMock, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  cancelAnimationFrame() {},
  Math, Date, JSON, Promise, Error, isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'headless' }
};
sandbox.window = { devicePixelRatio: 2, addEventListener() {}, innerWidth: 390, innerHeight: 844 };
sandbox.document = { getElementById: () => canvasMock, addEventListener() {}, visibilityState: 'visible' };

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.js' });

const touch = (id, x, y) => ({ changedTouches: [{ identifier: id, clientX: x, clientY: y }] });
// 刀诀三选一：弹出来就点第一张（点之前要等 0.4 秒防误触），回到局内再把攻击键按上
let picked = 0, repress = false;
function autoPick() {
  const st = vm.runInContext('state', sandbox);
  if (st === 'pick') {
    const r = vm.runInContext('pick && pick.t >= 0.4 && pick.chosen < 0 ? pickLayout() : null', sandbox);
    if (r) {
      handlers.start(touch(3, r.x + r.w / 2, r.ys[0] + r.h / 2));
      handlers.end(touch(3, r.x + r.w / 2, r.ys[0] + r.h / 2));
      picked++;
    }
    repress = true;
  } else if (repress && st === 'play') {
    handlers.start(touch(2, 316, 756));
    repress = false;
  }
}
function step(n, msPer) {
  let t = 1000;
  for (let i = 0; i < n; i++) {
    const cb = rafCb; rafCb = null;
    if (!cb) throw new Error('第 ' + i + ' 步没有安排下一帧');
    t += msPer;
    cb(t);
    autoPick();
  }
}

// 1) ready 界面 60 帧
step(60, 16.7);

// 2) 点屏幕中央开始游戏（避开右上角技能按钮）
if (!handlers.start) throw new Error('onTouchStart 未绑定');
handlers.start(touch(1, 195, 500));
handlers.end(touch(1, 195, 500));
// 主界面开局先放开场（2.10 节）：跳过，直接打
vm.runInContext('if (state === "talk") talkEnd();', sandbox);

// 3) 按住右下角攻击按钮（DASH_BTN: x=390-74=316, y=844-14-74=756），不松手 → 自动连斩
handlers.start(touch(2, 316, 756));

// 4) 跑 60 秒游戏时间（约 3600 帧）
const t0 = Date.now();
let frames = 0;
try {
  step(3600, 16.7);
  frames = 3600;
} catch (e) {
  console.error('FAIL at frame', frames, '\n', e);
  process.exit(1);
}
const ms = Date.now() - t0;

// 5) 再跑 10 秒，无论死没死都能覆盖 dead/over 界面绘制
try { step(600, 16.7); } catch (e) {
  console.error('FAIL in late phase\n', e);
  process.exit(1);
}

console.log('PASS: 共', frames + 600, '帧（60s 战斗 + 10s 收尾），战斗段耗时', ms, 'ms，平均',
  (ms / frames).toFixed(3), 'ms/帧');
console.log('已覆盖：新背景（晶墟残骸/浮尘/交点光斑）、披风刀客（太刀/刀镡/刃口高光）、软体敌人、15s+ 六边甲壳、40s+ 锯齿冲锋者、死亡与结算界面、刀诀三选一（挑了 ' + picked + ' 张）');

process.exit(0);   // BGM 调度器还在跑 setInterval，测试结束直接退出
