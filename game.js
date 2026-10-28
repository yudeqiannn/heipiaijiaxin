'use strict';
/* =========================================================
   斩 · DASH  —— 抖音小游戏版
   ---------------------------------------------------------
   这份文件是网页版的移植（先做的微信版，现在主平台是抖音）：
   · 玩法逻辑（冲刺 / 连斩 / 冷却返还 / 刷怪曲线）一行没改
   · 换了平台层：canvas、触摸、存储、音频
   · 加了世界缩放：以 1200 逻辑宽度为基准，手机横屏不会变得拥挤
   · 绘制层拆成两套皮肤（见 THEMES），默认用合规版
   ========================================================= */

/* =========================================================
   0. 平台适配层 —— 所有和抖音 / 微信 / 浏览器不同的事都收在这里
   ---------------------------------------------------------
   抖音的全局对象是 tt，微信是 wx，两边 API 名字基本一一对应，
   所以下面统一走 MG。tt 优先；wx 只是兜底，同一份代码在微信里也能跑。
   ========================================================= */
const MG = (typeof tt !== 'undefined' && typeof tt.createCanvas === 'function') ? tt
         : (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') ? wx
         : null;
const IS_MG = !!MG;

let canvas = null, ctx = null;

let W_CSS = 0, H_CSS = 0;        // 屏幕尺寸（CSS 像素，UI 用这套坐标）
let W = 0, H = 0;                // 世界尺寸（= CSS / SC，玩法用这套坐标）
let DPR = 1;                     // 物理像素比
let SC = 1;                      // 世界缩放
let SAFE_TOP = 0, SAFE_BOTTOM = 0;
let SAFE_LEFT = 0, SAFE_RIGHT = 0;   // 横屏（2.17 节）：左右两边的刘海 / 圆角
// 小游戏右上角的胶囊（"···"和关闭）：平台画在最上层，挡住的东西点不到也看不见。
// 能取到就用平台给的位置；取不到按常见尺寸估一个。浏览器里没有胶囊 = null
let MENU = null;

// 每块画布的 2d 上下文只取一次，之后复用（1028.0035 真机测试数据：跑到 2200 米左右必出"Maximum call stack size exceeded"，
// 出在抖音画布内部）。抖音上对同一块画布反复 getContext('2d')，平台会把画图的方法一层层再包一遍；米数贴图每跑 1 米重画一次、
// 以前每次重画都现取一次上下文，包到两千来层，调用一次画图就把调用栈撑爆 —— 每次都死在差不多同一个距离
const CTX2D = typeof WeakMap === 'function' ? new WeakMap() : null;
function ctx2d(c) {
  if (!c) return null;
  if (CTX2D) {
    let g = CTX2D.get(c);
    if (!g) { g = c.getContext('2d'); if (g) CTX2D.set(c, g); }
    return g;
  }
  return c.__g2d || (c.__g2d = c.getContext('2d'));
}

const nowMs = (typeof performance !== 'undefined' && performance.now)
  ? function () { return performance.now(); }
  : function () { return Date.now(); };

// 构建标记：每次改动后改一下，主界面右下角会显示。
// 扫码后第一眼就能确认手机上跑的是不是刚编出来的这一版，
// 不用靠"分数好像涨了"去猜。
const BUILD_TAG = '1028.1445';

const Store = {
  get: function (k, d) {
    try {
      if (IS_MG) {
        const v = MG.getStorageSync(k);
        return (v === '' || v === undefined || v === null) ? d : v;
      }
      const v = localStorage.getItem(k);
      return v === null ? d : v;
    } catch (e) { return d; }
  },
  set: function (k, v) {
    try {
      if (IS_MG) MG.setStorageSync(k, v);
      else localStorage.setItem(k, String(v));
    } catch (e) {}
  }
};

function createAudioContext() {
  try {
    if (IS_MG) {
      return (typeof MG.createWebAudioContext === 'function') ? MG.createWebAudioContext() : null;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    return AC ? new AC() : null;
  } catch (e) { return null; }
}

/* =========================================================
   0.5 变现与社交
   ---------------------------------------------------------
   广告位 ID 在抖音开放平台「运营 → 流量主 → 广告管理」里创建后填进来。
   · 填了 → 走真实激励视频
   · 没填 / 拉取失败 → 自动退回 3 秒占位，开发期流程照样能跑通
   奖励只在「完整看完」时发放，这是平台的硬性要求。
   ========================================================= */
const ADS = {
  units: {
    revive: '',      // 复活广告位，填抖音后台给的广告位 ID
    double: '',      // 双倍余光广告位
    echo:   '',      // 直接换余光的广告位
    prop:   '',      // 黑潮开局看广告带道具（2.13 节）
    skin:   '',      // 看广告解锁嘉豪皮肤（2.13 节；皮肤改成宝箱碎片以后不用了）
    box:    ''       // 看广告宝箱十连（2.16 节）
  }
};

/* —— 余光经济 ——
   余光不是分数换来的：分数只是成绩，余光只从晶柱里取。
   斩碎一根晶柱 = 固定 25 点余光，晶柱会不断从光外的黑暗里重新长出来，
   所以唯一的收入来源是"活得更久 + 敢出光去砍柱子"。
   这样站桩按死不但拿不到高分，连货币也拿不到 —— 收入本身就是走位的奖励。 */
const ECHO_AD  = 80;      // 看一次广告得到的余光（约等于一局正常收入）
const YING_CRYSTAL = 25;  // 斩碎一根晶柱得到的余光
let echoAdLeft  = 1;      // 每局可领几次（防止无限刷）

// 分享标题：嘉豪梗。打过分的人带上自己的最高分（"豪意值" = 分数），没分就用通用那句
const SHARE_TITLE = '黑皮爱嘉欣：教导主任在后面追，嘉豪们在前面挡，冲去找嘉欣！你能跑多远？';
function shareTitle() {
  return (meta.lBest || 0) > 0 ? '我在黑皮爱嘉欣跑了 ' + meta.lBest + ' 米，教导主任都没追上。你来试试？' : SHARE_TITLE;
}

let adMode = 'idle';       // idle | placeholder | real
let adHome = 'dead';       // 广告中断后退回哪个界面
let adWatch = 0;           // 真实广告的看门狗（秒）；<=0 表示不启用
let adObj = null, adObjId = '';

function adUnitFor(action) {
  if (action === 'double') return ADS.units.double;
  if (action === 'echo') return ADS.units.echo;
  if (action === 'prop') return ADS.units.prop;
  if (action === 'skin') return ADS.units.skin;
  if (action === 'box') return ADS.units.box;
  return ADS.units.revive;
}

function canUseRealAd() {
  return IS_MG && typeof MG.createRewardedVideoAd === 'function';
}

function ensureAdObj(unitId) {
  if (adObj && adObjId === unitId) return adObj;
  try {
    const o = MG.createRewardedVideoAd({ adUnitId: unitId });
    o.onClose(function (res) {
      if (state !== 'ad') return;
      endAd(!!(res && res.isEnded));      // 必须判断 isEnded
    });
    o.onError(function () { if (state === 'ad') endAd(false); });
    adObj = o;
    adObjId = unitId;
  } catch (e) { adObj = null; adObjId = ''; }
  return adObj;
}

function initShare() {
  if (!IS_MG) return;
  try {
    if (typeof MG.showShareMenu === 'function') {
      MG.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage'] });
    }
    if (typeof MG.onShareAppMessage === 'function') {
      MG.onShareAppMessage(function () { return { title: shareTitle() }; });
    }
  } catch (e) {}
}

function shareGame() {
  if (!IS_MG) return false;
  try {
    if (typeof MG.shareAppMessage === 'function') { MG.shareAppMessage({ title: shareTitle() }); return true; }
  } catch (e) {}
  return false;
}

/* —— 排行榜（抖音官方「游戏排行榜」：tt.setImRankData 交成绩，平台排好总榜 + 好友榜，不用自己的服务器）——
   用户："我们先加上全服排名和好友排名，每次结束默认给玩家看提升多少名"；"分数米数各一个排名，玩家可以点击切换"。
   · 两个榜：米数榜用默认分区 'default'，分数榜单独一个分区 'score'（分区之间数据互不影响）
   · 只交最好成绩：比交上去的（meta.rk）大才交；没交上的下次开游戏 / 下一局再补
   · 完整榜单：平台自己画（tt.getImRankList，好友榜 + 总榜），主界面「排行榜」、失败页那一条右边「榜单」
   · 失败页那一条"好友第几名 / 全服第几名 ↑几名"：自己的名次只有开放数据域拿得到（tt.getImRankData），
     那边画在 sharedCanvas 上，主域画到屏幕上（开放数据域不能给主域发消息，见 openDataContext/index.js）
   · 拿不到（浏览器、微信、抖音版本太老）：这些都不画、不点，玩法不受影响。出错记在 rkErr（测试数据页）
   以前那个假的全服排名（RANK、CFG.fakeRank）关掉了 */
const RK = { zone: { m: 'default', s: 'score' }, suffix: { m: '米', s: '分' }, title: { m: '最远排行', s: '最高分排行' } };
let rkKind = 'm', rkRel = 'friend';   // 榜单看哪个：米数 'm' / 分数 's'，好友 'friend' / 全服 'all'（点上面的键切换）
let rkLogin = 0;           // 0 没登录 / 1 登录中 / 2 登录了 / -1 没登录上
let rkErr = '';            // 最后一次出错（测试数据页）
const rkSending = { m: 0, s: 0 };
function rkCan() { return IS_MG && typeof MG.setImRankData === 'function'; }
function rkODC() {
  try { return IS_MG && typeof MG.getOpenDataContext === 'function' ? MG.getOpenDataContext() || null : null; } catch (e) { return null; }
}
function rkPost(msg) {
  const o = rkODC();
  if (o && typeof o.postMessage === 'function') { try { o.postMessage(msg); } catch (e) { rkErr = 'post ' + e; } }
}
// 开游戏：悄悄登录（不弹框），补交没交上的成绩，让开放数据域先记一下现在的名次（结束时跟它比）
function rkInit() {
  if (!rkCan()) return;
  rkLogin = 1;
  const done = function (ok, e) {
    rkLogin = ok ? 2 : -1;
    if (!ok) rkErr = 'login ' + ((e && e.errMsg) || '');
    rkSync(false);
    rkPost({ t: 'fetch', base: true });
  };
  try {
    if (typeof MG.login === 'function') MG.login({ force: false, success: function () { done(true); }, fail: function (e) { done(false, e); } });
    else done(true);
  } catch (e) { done(false, { errMsg: String(e) }); }
}
// 交最好成绩（比交上去的大才交）。fetch：都交完了（或者不用交）让开放数据域去拿新名次
// （run：第几局 —— 开放数据域按它记"这一局之前的名次"，复活后再结算也跟同一个比）
function rkSync(fetch) {
  if (!rkCan()) return;
  const todo = [];
  const vm = { m: meta.hBest, s: meta.hScore };
  for (const k in vm) {
    const v = Math.min(2147483646, Math.floor(vm[k]));
    if (v > (meta.rk[k] || 0) && !rkSending[k]) todo.push([k, v]);
  }
  let wait = todo.length;
  const done = function () { if (--wait === 0 && fetch) rkPost({ t: 'fetch', run: hqRunN }); };
  if (!wait) { if (fetch) rkPost({ t: 'fetch', run: hqRunN }); return; }
  todo.forEach(function (kv) {
    const k = kv[0], v = kv[1];
    rkSending[k] = 1;
    const fin = function (ok, e) {
      rkSending[k] = 0;
      if (ok) { meta.rk[k] = Math.max(meta.rk[k] || 0, v); saveMeta(); } else rkErr = 'set ' + k + ' ' + ((e && e.errMsg) || '');
      done();
    };
    try {
      MG.setImRankData({ dataType: 0, value: String(v), zoneId: RK.zone[k], extra: '',
        success: function () { fin(true); }, fail: function (e) { fin(false, e); } });
    } catch (e) { fin(false, { errMsg: String(e) }); }
  });
}
// 平台画的完整榜单（好友榜 + 总榜）。没登录先登录（拉榜单前必须登录，不然可能拉不起来）
function rkCanOpen() { return IS_MG && typeof MG.getImRankList === 'function'; }
function rkOpen(k) {
  if (!rkCanOpen()) return;
  const go = function () {
    try {
      MG.getImRankList({ relationType: 'default', dataType: 0, rankType: 'all', suffix: RK.suffix[k], rankTitle: RK.title[k], zoneId: RK.zone[k],
        fail: function (e) { rkErr = 'list ' + ((e && e.errMsg) || ''); } });
    } catch (e) { rkErr = 'list ' + e; }
  };
  if (rkLogin !== 2 && typeof MG.login === 'function') {
    MG.login({ force: true, success: function () { rkLogin = 2; rkSync(false); go(); }, fail: function (e) { rkErr = 'login ' + ((e && e.errMsg) || ''); } });
  } else go();
}
// 一整页榜单（用户："结算画面……排名单独放"）：结算第三页、主界面「排行榜」都用它。上面两组切换键（米数 / 分数、好友 / 全服），
// 下面一块是开放数据域画的榜单（我第几名、↑几名，前 20 个人）。切了发消息过去重画
function rkBoardOn() { return !!rkODC(); }
function rkBoardLayout(x, y, w, h) {
  const th = 34;
  return { x: x, y: y, w: w, h: h,
    m: { x: x, y: y, w: 62, h: th }, s: { x: x + 68, y: y, w: 62, h: th },
    fr: { x: x + w - 130, y: y, w: 62, h: th }, all: { x: x + w - 62, y: y, w: 62, h: th },
    odc: { x: x, y: y + th + 10, w: w, h: h - th - 10 } };
}
function drawRankBoard(L) {
  const o = rkODC();
  if (!o) return;
  const on = { kind: 'plain', size: 14, weight: 900, color: '#ffffff', glow: UI.cyan }, off = { kind: 'ghost', size: 13, weight: 700, color: 'rgba(214,236,242,0.55)' };
  drawButton(L.m, '米数', rkKind === 'm' ? on : off);
  drawButton(L.s, '分数', rkKind === 's' ? on : off);
  drawButton(L.fr, '好友', rkRel === 'friend' ? on : off);
  drawButton(L.all, '全服', rkRel === 'all' ? on : off);
  bladeBox(L.odc.x, L.odc.y, L.odc.w, L.odc.h, { c: 10, top: UI.panelTop, bot: UI.panelBot, border: UI.line });
  // sharedCanvas 的大小主域来定（物理像素），变了告诉那边重画
  const c = o.canvas, pw = Math.round(L.odc.w * DPR), ph = Math.round(L.odc.h * DPR);
  if (!c) return;
  if (c.width !== pw || c.height !== ph) {
    try { c.width = pw; c.height = ph; } catch (e) {}
    rkPost({ t: 'size', k: DPR, kind: rkKind, rel: rkRel });
  }
  try { ctx.drawImage(c, L.odc.x, L.odc.y, L.odc.w, L.odc.h); } catch (e) {}
}
function rankBoardTap(t, L) {
  const k = inRect(t, L.m) ? 'm' : inRect(t, L.s) ? 's' : null, r = inRect(t, L.fr) ? 'friend' : inRect(t, L.all) ? 'all' : null;
  if (!k && !r) return false;
  if (k) rkKind = k;
  if (r) rkRel = r;
  rkPost({ t: 'show', kind: rkKind, rel: rkRel });
  return true;
}
// 主界面「排行榜」那一页（state 'rankView'）：标题、榜单、「返回」
function openRankView() { state = 'rankView'; resetInput(); rkPost({ t: 'fetch', base: true }); rkPost({ t: 'show', kind: rkKind, rel: rkRel }); }
function rankViewLayout() {
  const top = MENU ? Math.max(SAFE_TOP + 14, MENU.bottom + 12) : SAFE_TOP + 14, w = Math.min(380, W_CSS - 24), x = (W_CSS - w) / 2;
  const back = { x: x, y: H_CSS - SAFE_BOTTOM - 62, w: w, h: 46 };
  return { top: top, board: rkBoardLayout(x, top + 44, w, back.y - 16 - top - 44), back: back };
}
function drawRankView() {
  inkBg(1);
  const L = rankViewLayout();
  ctx.textAlign = 'left';
  uf(900, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('排行榜', L.board.x, L.top + 26);
  drawRankBoard(L.board);
  drawButton(L.back, '返回', { kind: 'plain', size: 15 });
  ctx.textAlign = 'left';
}
function rankViewTap(t) {
  const L = rankViewLayout();
  if (rankBoardTap(t, L.board)) return;
  if (inRect(t, L.back)) { state = 'ready'; resetInput(); }
}
// 主界面「排行榜」：商店下面一个小键。开放数据域能用就开 rankView 那一页；不能用（老抖音）才弹两个选项拉平台自己的榜单
let rkPick = false;
function readyRankBtn() { const c = readyCandyBtn(); return { x: c.x, y: c.y + c.h + 8, w: 88, h: 36 }; }
function rkPickLayout() {
  const w = Math.min(300, W_CSS - 48), x = (W_CSS - w) / 2, y = H_CSS * 0.36;
  return { x: x, y: y, w: w, h: 196, m: { x: x + 20, y: y + 52, w: w - 40, h: 48 }, s: { x: x + 20, y: y + 108, w: w - 40, h: 48 }, close: { x: x + w - 44, y: y + 6, w: 38, h: 34 } };
}
function drawRankPick() {
  ctx.fillStyle = 'rgba(4,6,9,0.78)';
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  const L = rkPickLayout();
  bladeBox(L.x, L.y, L.w, L.h, { c: 12, top: UI.panelTop, bot: UI.panelBot, border: rgba(UI.gold, 0.5), ticks: UI.gold });
  ctx.textAlign = 'center';
  uf(900, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('排行榜', W_CSS / 2, L.y + 32);
  drawButton(L.m, '最远米数榜', { kind: 'primary', size: 16, weight: 900 });
  drawButton(L.s, '最高分数榜', { kind: 'plain', size: 16, weight: 900 });
  uf(500, 11);
  ctx.fillStyle = 'rgba(214,236,242,0.5)';
  ctx.fillText('每个榜都有好友榜和全服榜', W_CSS / 2, L.y + L.h - 18);
  drawButton(L.close, '×', { kind: 'ghost', size: 18, weight: 700 });
}
function rkPickTap(t) {
  const L = rkPickLayout();
  if (inRect(t, L.m)) { rkPick = false; rkKind = 'm'; rkOpen('m'); }
  else if (inRect(t, L.s)) { rkPick = false; rkKind = 's'; rkOpen('s'); }
  else if (inRect(t, L.close) || !inRect(t, L)) rkPick = false;
}


/* =========================================================
   1. 皮肤
   ---------------------------------------------------------
   rift   = 合规版（默认）。冷色光刃 × 暗色晶核。没有血、没有红眼、没有尖叫。
   horror = 你在网页版里做的那一版。想自己玩就把下面这行改掉。

   ★ 上架审核前，请保持 'rift'。
   ========================================================= */
const THEME_NAME = 'rift';

const THEMES = {

  /* ---------- 合规版 ---------- */
  rift: {
    bg: '#080a0b',
    grid: 'rgba(120,160,190,0.085)',
    vigInner: 'rgba(0,0,0,0)',
    vigOuter: 'rgba(0,0,0,0.86)',

    player: '#4df7ff',
    playerCore: '#ffffff',
    blade: 'rgba(234,252,255,0.92)',
    ghost: '#4df7ff',
    cloak: 'rgba(16,68,88,0.72)',        // 主角披风/尾迹
    hilt: '#16323b',                     // 刀柄
    debris: 'rgba(110,160,195,0.05)',    // 背景晶墟残骸
    debrisEdge: 'rgba(130,185,215,0.10)',
    dust: '150,215,245',                 // 浮尘（rgb 串，绘制时配 alpha）

    enemyBody: '#14060a',
    enemyEdge: 'rgba(255,72,80,0.80)',
    enemyEdgeHeavy: 'rgba(255,120,60,0.85)',
    enemyCore: 'rgba(255,70,60,0.50)',
    enemyCoreHeavy: 'rgba(255,140,70,0.55)',

    pA: '#4df7ff',            // 击杀主粒子（刀光色，跟主角走）
    pB: '#ffffff',            // 点缀
    pHeavy: '#ff8a5c',        // 重型碎裂的暖色碎片
    stain: 'rgba(60,110,140,0.22)',   // 地面残留（不是血，是冷却的残迹）
    stainLife: 6,
    ring: '#9df8ff',
    ringHeavy: '#ffb072',

    // 五种怪五个颜色：轮廓、内核、光外露出的那个点都用它 —— 黑暗里一个点就知道是什么在过来。
    // 色相尽量拉开：红（普通）/ 橙（重型）/ 黄绿（爆裂者）/ 蓝（冲锋者）/ 品红（守望者）
    foe: { grunt: '#ff3b4a', heavy: '#ff9a3c', bomb: '#b6ff45', charger: '#3fa0ff', watch: '#e85cff' },

    dimEnemies: true,         // 光照不到的敌人不画，只留光外那个核
    eyes: false,              // 不画红眼
    remote: 'core',           // 光外只露一个微弱的能量核
    remoteColor: '#ff3b4a',

    darkBase: '2,5,10',
    viewRing: '150,224,255',   // 视野边界那圈淡蓝呼吸环（rgb 串）
    reachRing: '255,106,92',   // 斩杀距离的暗红虚线
    whisper: false,
    scream: false,

    floatColor: '#9fe8ff',
    uiDim: 'rgba(255,255,255,0.35)',
    // 游戏叫「嘉豪斩」：主界面画成小号"嘉豪" + 大号"斩"（titlePre 在前）
    title: '斩',
    titlePre: '嘉豪',
    subtitle: '嘉欣被卷走了。往下斩，去救她。',
    tipMain: '按住不放 = 连斩：砍到第一个之后，它会自己一直砍下去',
    tipSub: '光会一直灭 —— 跟着嘉欣的糖走，捡糖补光',
    dieLabel: '耍 帅 失 败'
  },

  /* ---------- 恐怖版（网页版原样） ---------- */
  horror: {
    bg: '#040407',
    grid: 'rgba(120,40,60,0.055)',
    vigInner: 'rgba(0,0,0,0)',
    vigOuter: 'rgba(0,0,0,0.85)',

    player: '#4df7ff',
    playerCore: '#ffffff',
    blade: 'rgba(234,252,255,0.92)',
    ghost: '#4df7ff',
    cloak: 'rgba(72,16,32,0.72)',        // 主角披风/尾迹
    hilt: '#33121a',                     // 刀柄
    debris: 'rgba(125,48,66,0.05)',      // 背景晶墟残骸
    debrisEdge: 'rgba(165,62,84,0.10)',
    dust: '225,150,165',                 // 浮尘（rgb 串，绘制时配 alpha）

    enemyBody: '#07030a',
    enemyEdge: 'rgba(150,20,45,0.75)',
    enemyEdgeHeavy: 'rgba(200,90,40,0.75)',
    enemyCore: 'rgba(255,59,107,0.5)',
    enemyCoreHeavy: 'rgba(255,161,59,0.55)',

    pA: '#ff2d4a',
    pB: '#ffffff',
    pHeavy: '#ffa13b',
    stain: 'rgba(92,0,17,0.55)',
    stainLife: 9,
    ring: '#ff6b8a',
    ringHeavy: '#ffb057',

    foe: { grunt: '#ff2d4a', heavy: '#ffa13b', bomb: '#a6ef3a', charger: '#3a8cff', watch: '#d04cff' },

    dimEnemies: true,
    eyes: true,
    remote: 'eyes',
    remoteColor: '#ff2d4a',

    darkBase: '2,2,4',
    viewRing: '176,214,245',   // 恐怖版的边界环偏冷灰，别抢红眼的注意力
    reachRing: '255,84,72',    // 恐怖版的斩杀线更血红一点
    whisper: true,
    scream: true,

    floatColor: '#ffd166',
    uiDim: 'rgba(255,255,255,0.35)',
    title: '斩',
    titlePre: '嘉豪',
    subtitle: '你打不过它们，只能穿过它们。',
    tipMain: '按住不放 = 连斩：砍到第一个之后，它会自己一直砍下去',
    tipSub: '斩杀圈就是你的光源 —— 圈外的东西，只看得见眼睛',
    dieLabel: '被 围 住 了'
  }
};

const THEME = THEMES[THEME_NAME] || THEMES.rift;

function foeType(e) {
  return e.charger ? 'charger' : (e.heavy ? 'heavy' : (e.bomb ? 'bomb' : (e.watch ? 'watch' : 'grunt')));
}
function foeColor(e) { return FOE_C[foeType(e)] || THEME.foe[foeType(e)]; }

// 怪的颜色跟着场地染色提亮（每帧在 tickUI 里算一次）：同一种怪始终是同一个色系 —— 红还是红、蓝还是蓝，
// 认怪不受影响；场地染得越浓，怪越往白里提（最浓时三成五）。和当前场地撞色的那种（色相差 < 45°，
// 比如蓝底上的冲锋者）再多提两成。没段位时就是原色
const FOE_C = {};
function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return (h * 60 + 360) % 360;
}
// 无光：整个画面褪成黑白灰。最后用 'saturation' 混合在整屏铺一层纯灰 —— 保留下面的明暗、把颜色清掉，一笔搞定。
// 抖音的画布不一定支持混合模式：不支持时那一层灰会直接把整屏盖住。所以第一次要用时先在 4×4 的小画布上实测：
// 画红 → 用 saturation 铺灰 → 读回来，变成了"保留明暗的深灰"才算支持（MONO.ok）。
// 不支持就退一步：只把怪 / 主角 / 段位色换成灰（monoFallback），HUD 保留颜色
const MONO = { ok: null, k: 0 };
function monoProbe() {
  if (MONO.ok !== null) return MONO.ok;
  try {
    const c = IS_MG ? MG.createCanvas() : document.createElement('canvas');
    c.width = 4; c.height = 4;
    const g = ctx2d(c);
    g.fillStyle = '#ff0000'; g.fillRect(0, 0, 4, 4);
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#808080'; g.fillRect(0, 0, 4, 4);
    const d = g.getImageData(1, 1, 1, 1).data;
    MONO.ok = Math.abs(d[0] - d[1]) < 14 && Math.abs(d[1] - d[2]) < 14 && Math.abs(d[0] - 128) > 24;
  } catch (e) { MONO.ok = false; }
  return MONO.ok;
}
function monoTarget() { return layerFeat() === 'void' && (state === 'play' || state === 'dead') ? 1 : 0; }
function monoFallback() { return MONO.k > 0.5 && !monoProbe(); }
// 一种颜色的灰：亮度不变
function grayOf(hex) {
  const n = parseInt(hex.slice(1), 16), v = Math.round(0.3 * (n >> 16 & 255) + 0.59 * (n >> 8 & 255) + 0.11 * (n & 255));
  const x = (v < 16 ? '0' : '') + v.toString(16);
  return '#' + x + x + x;
}
function drawMono() {
  if (MONO.k <= 0.01 || !monoProbe()) return;
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'saturation';
  ctx.globalAlpha = MONO.k;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function foeAdapt() {
  if (monoFallback()) { for (const type in THEME.foe) FOE_C[type] = grayOf(THEME.foe[type]); return; }
  const k = clamp(BGT.a / 0.3, 0, 1), hb = hueOf(BGT.r, BGT.g, BGT.b);
  for (const type in THEME.foe) {
    const n = parseInt(THEME.foe[type].slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    let w = 0.35 * k;
    const dh = Math.abs(((hueOf(r, g, b) - hb + 540) % 360) - 180);
    if (dh < 45) w += 0.2 * clamp(BGT.a / 0.12, 0, 1);
    w = Math.min(w, 0.55);
    const h = function (v) { const x = Math.round(v + (255 - v) * w).toString(16); return x.length < 2 ? '0' + x : x; };
    FOE_C[type] = w > 0.004 ? '#' + h(r) + h(g) + h(b) : THEME.foe[type];
  }
}


/* =========================================================
   2. 可调参数 —— 想改手感，只改这一块
   ========================================================= */
const CFG = {
  playerR:   14,
  accel:     3200,
  maxSpeed:  430,
  damping:   10,
  dashSpeed: 1750,
  dashTime:  0.15,
  dashCd:    0.5,     // 击杀会立刻清零
  // 收刀余势：冲刺结束后这么多秒里（滑行的那一小段）碰到怪，照样算斩到，而不是被撞死。
  // 冲刺距离是固定的，两只怪挨得近时，斩完前一只、刚好滑进后一只 —— 以前就死在这一下
  glideCut:  0.08,
  // —— 斩到就停 ——
  // 以前一刀固定冲 0.15 秒（≈ 180），怪离得近也冲过头，把人甩进没看清的地方：实测撞死里八成是
  // "收刀 0.1 秒后、被一只刚亮出来的怪撞死"（用户："斩完他往一个方向去，那个方向正好有一个怪物，根本反应不过来"）。
  // 现在锁了目标的一刀只冲到目标身后 dashFollow 就停，再用 dashStopV 的速度滑一小步；没锁目标的空挥照旧冲满。
  // 爆裂者例外：斩了它会炸，停在它身边就是送死 —— 这一刀穿过去，冲到爆炸圈外 bombFollow 才停（准星提前变红）。
  // 重型的第一刀只砍开外壳、它还活着：也穿过去，冲出它的身子 heavyFollow 才停，不然停在它身上
  dashFollow: 24,
  bombFollow: 26,
  heavyFollow: 56,     // 含被砍开时往前击退的 30（crackEnemy）
  threatGap: 60,      // 贴身保护：怪离你只剩这么远就要撞上，长按连斩先砍它（不管摇杆指哪）
  aimMissCd: 0.1,     // 锁了目标却让它挪开了：只等这么久（对着空气乱挥照旧等 dashCd）
  dashOver: 140,      // 穿过爆裂者 / 重型 / 爆炸圈时，最多比一刀的长度多走这么多
  dashStopV:  160,
  breakR:    200,
  // 排名现在是假的（见 RANK）：只为先看效果，界面上标"测试数据"。正式发布前必须关掉或接上真后端
  fakeRank:  false,     // 假的全服排名：换成真的抖音排行榜了（0.5 节 RK）
  // 测试数据页（见 TEST）：主界面最下面「测试数据」进去 —— 每局数据 / 机型 / 报错，可一键复制。正式发布前也要关掉
  // 主玩法（用户："把最早玩法的入口先删了，玩法保留，我们先把现在这个做成主要玩法"）：
  // 'horde' = 主界面「开始」进黑潮（2.12 节），正式玩法、玩法说明、新手教程、余光商店的入口都不画；
  // 'classic' = 原来那套（代码一点没删，测试用它）
  mainMode: 'lane',
  testPanel: true,     // 破门冲击波半径：这圈里的怪震碎（重型裂甲），给一口喘息，也是这一刻的爽点    // 原 0.15：站着按死斩时几乎一直无敌，太简单（用户反馈）
  // 刀诀（局内三选一，见 2.9 节）：false = 整个关掉，回到只有局外技能的玩法
  cards:     true,

  // —— 光和嘉欣糖（2.11 节）——
  lightT0: 18, lightTStep: 1.2, lightMinT: 8, // 满光几秒灭完：第 1 层 18 秒，每深一层快 1.2 秒，最快 8 秒
  lightLow: 0.3,       // 低于这个：头顶报"光快灭了"、光圈变橙；再低一截（× 0.6）变红、开始滴答
  lightTutMin: 0.3,    // 新手教学里光最低掉到这儿：会变小，不会灭
  candyGain: 0.11,     // 一颗糖补多少光：边打边顺着走补得比掉得快，停下来打太久就补不上；越深越要走得快
  candyGap: 170,       // 糖和糖隔多远（世界单位；一刀冲刺 ≈ 260）
  candyR: 26,          // 捡糖的判定：主角半径再加这么多
  candyShow: 10,       // 只亮出前面这么多颗（路很长、世界首尾相接，全亮出来会绕回眼前、分不清先后）
  trailTurn: 0.18,     // 糖路每一颗最多拐多少（弧度）：弯，但不打结
  trailN0: 26, trailNStep: 4, trailNMax: 50,  // 一层多少颗糖：第 1 层 26（≈ 440 米、边打边走二三十秒），每层多 4，最多 50
  trailNTut: 8,        // 新手教学「捡糖」「破门」那两步现摆一条短路
  doorR: 44,           // 碰门的判定
  breakLight: 0.35,    // 破门补多少光

  // —— 收刀滑行 ——
  // 冲刺结束不"钉"在地上：最后一刀砍空时，人还停在连斩的高速节奏里，
  // 速度从 1750 直接归零会让人失去方位感。留一段减速滑行，
  // 让"停下"是个动作，不是一个断点。
  coastCap:  1.45,    // 滑行段速度上限（× maxSpeed）
  coastDamp: 2.0,     // 滑行阻尼：比走路松得多，0.2 秒内收住

  // —— 空场呼吸 ——
  // 砍空、四周一时没怪的那 0.9 秒：短暂无敌 + 光撑开一圈。
  // 这一下不是加血，是把"下一波从哪来"提前摆到玩家眼前。
  calmT:     0.9,
  calmInv:   0.5,
  calmRange: 320,     // 这个距离内没怪才算空场
  calmView:  1.22,    // 光临时放大多少
  calmSpeed: 1.15,    // 空场时移动略快，方便自己找位
  comboWindow: 1.4,

  // —— 压力曲线 ——
  // 目标：站桩按死 ~30-45 秒必死，会走位的玩家 50~80 秒。
  // 重型的甲负责打断"无限连"，其余数值控制整体压力。
  spawnBase: 0.78,
  spawnMin:  0.26,    // 刷怪间隔下限（原 0.20：后期刷得比杀得还快，纯送分）
  scoreCap:  24,      // 连击计分上限（原 30：通货膨胀的主力）
  spawnRamp: 0.024,   // 每秒收紧多少
  maxEnemies: 55,
  lostView:   2.2,    // 离玩家超过 2.2 倍感知半径算"甩掉了"：收掉，在前进方向补一只（见 update）
  // 正面留出拉扯空间：走着的时候（推着摇杆，或者还在高速滑行），前进方向左右 frontDeg 度以内
  // 常规刷怪不刷；甩掉回收的怪照样补在前方（不然一直跑就无敌），但补在 frontFar 倍感知半径的远处，
  // 远远就看得见、有空间绕；合围波落在正面的那几路也推到这么远
  frontDeg:   40,     // 原 60 / 1.95：收紧，正面留的空间小一点
  frontFar:   1.65,
  // 推着摇杆按斩：只砍推的方向左右 aimDeg 度以内的怪；正面没有就不挥刀，顺着方向走，不往回拽
  aimDeg:     45,     // 原 65

  // —— 长按自动连斩 ——
  // 自动接刀故意慢 0.03 秒，手动点击没有延迟。
  // 这不是削弱玩家，是让"操作"重新有价格：死了会怪自己手慢，而不是怪数值。
  autoAim:   true,
  autoRepeat: true,
  autoReach: 175,     // 走位杀追兵的距离；站桩反正等怪上门，这个甜头只给会跑的人
  autoDelay: 0.03,

  // —— 顿帧只给一串的第一刀 ——
  // 连斩约 0.15~0.2 秒一刀，每刀都冻 50ms 的话，连斩时两成多的帧是静止的、
  // 一秒停好几下 —— 看起来就是卡顿。离上一次打击不到这么久的接刀不再顿帧。
  hitstopGap: 0.4,
  // 顿的方式：不再整帧冻住（画面停 3 帧，手机上看就是"斩完掉帧"），改成这么慢的短暂慢放，世界一直在动
  hitSlowK: 0.3,
  // 连斩快断：窗口剩最后这么多（比例）开始滴答、越到最后越急；剩不到 clutch 时续上算"险！"，多给 clutchBonus 刀的分
  comboWarn:   0.4,
  clutch:      0.25,
  clutchBonus: 0.5,

  // 黑暗视野是核心玩法，不能因为换了皮肤就关掉 —— 它只是"看不见"，
  // 不是恐怖内容。真正要按皮肤切的只有红眼 / 血 / 尖叫。
  darkness:  true,
  horror:    (THEME_NAME === 'horror'),
  // 暗场遮罩（圈外压 0.94 的黑）和四周暗角，这两层整屏的径向渐变：抖音真机上大多数帧画不出来，
  // 偶尔几帧又画出来了 —— 玩家看到的就是"斩完屏幕暗一下"（2026-10-23 录屏逐帧量出来的：
  // 平时离主角远近一样亮，暗的那几帧才有一圈圈往外变黑）。玩家平时看到的一直是没遮罩的样子，
  // 选了保持这个样子：两层都不画。亮区、圈外只露核这些玩法规则不变（darkness 仍为 true）
  veil:      false,

  // 下面三项现在是"感知"半径（刷怪距离、黑暗里看得见核的范围、守望者）；
  // 看得清的亮区固定等于斩杀圈，见 lightR
  viewBase:  258,     // 静止时的视野半径（平滑暗场曲线后中段略暗，半径补偿 +18）
  viewCombo: 4,       // 每层连击把视野撑大多少（很小，避免一下撑满屏幕）
  viewMax:   305,     // 上限：连击再高也不会把整个屏幕照亮

  // —— 新增威胁 ——
  waveFirst: 30,      // 第几秒开始合围
  waveEvery: 13,      // 合围间隔
  // 每层特性（LAYERS[].feat）的数值
  lf: {
    fogSlow: 0.45,      // 低语：主角在雾里时，离主角 90 以外的怪速度乘这个、方向乱晃（迷路）
    riftCycle: 5.5,     // 裂隙：每条地缝多久喷一次
    riftWarn: 1.1,      //       喷之前亮多久（预警）
    riftBurn: 0.45,     //       喷多久（这段时间压在缝上的人和怪都烧死）
    riftW: 12,          //       缝两边多宽算"压在上面"
    slipDash: 1.15,     // 空壳：冲刺速度倍数
    slipCoast: 0.45,    //       收刀滑行的阻尼倍数（越小越滑）
    slipDamp: 0.3,      //       走路的阻尼倍数
    coreR: 62,          // 核心：光核半径
    coreReach: 0.3,     //       站满光核，斩杀圈最多变大多少
    tideSp: 60,         // 黑潮：潮流速度
    tideEvery: 9,       //       多久换一次方向
    voidReach: 0.8,     // 无光：斩杀圈倍数
    endSpeed: 1.15,     // 终末：怪的速度倍数
    endWave: 8          //       合围间隔（原 13）
  },
  waveWarn:  0.9,     // 预警时长（给玩家 0.9 秒做决定）
  chargerAt: 38,      // 第几秒开始出现冲锋者
  chargerP:  0.10,    // 之后每次刷怪有多大概率是冲锋者
  heavyAt:   20,      // 第几秒开始出现重型（两刀死的那种）
  heavyP:    0.15,    // 之后每次刷怪有多大概率是重型

  // —— 重型的甲 ——
  // 第一刀只裂甲：不加分、不返冲刺、把怪击退，并给 0.35 秒甲硬直。
  // 这是打断"按死连斩"的钥匙：你的自动刀会在裂甲的怪身上空转一拍，
  // 链条一断，0.5 秒真空期就来了 —— 那才是真的危险。
  armorT: 0.35,

  // —— 三种"必须读一眼"的东西 ——
  // 它们不改数值，只改"下一步该往哪走"的判断。
  bombAt: 14,         // 第几秒开始出现爆裂者
  bombP:  0.14,       // 之后每次刷怪多大概率是爆裂者
  bombFuse: 0.62,     // 引信：死后多久炸
  bombR:  96,         // 爆炸半径
  watchAt: 24,        // 第几秒开始出现守望者
  watchP: 0.10,
  // —— 晶柱：唯一的余光来源 ——
  // 斩碎一根 → 余光 +25 + 一片光尘（视野 +35%）。
  // 它必须一直有，否则"想升级就得祈祷刷得巧"，所以会从光外的黑暗里重新长出来。
  crystalN: 3,        // 场上同时存在的晶柱数量
  crystalLight: 3.2,  // 斩碎晶柱后，光尘让视野扩大多久（秒）
  crystalGain: 0.35,  // 扩大多少（+35%）
  crystalGrow: 0.5,   // 长出来的动画时长（秒）：先给个反应时间，别凭空冒出来
  crystalRespawn: 5.0,// 每隔几秒补一根（场上不满时才补）
  crystalOutMin: 1.10,// 补的柱子至少长在 1.1 倍视野外 —— 想拿余光就得走出光
  crystalOutMax: 1.45,// 最远 1.45 倍视野，再远就成了"去找"，不是"去拿"

  // —— 存活计分 ——
  // 活着本身就在赚分，但不是"挂机送分"：
  // 速率随时间缓慢上扬，再乘连击系数 —— 光跑不打只有 1~3 分/秒，
  // 杀得顺能到 5~6 分/秒，所以它奖励的是"又久又凶"，不是"躲得远"。
  surviveRate:  2.2,   // 开局每秒得分
  surviveRamp:  0.030, // 每秒再涨多少（60 秒时约 4 分/秒）
  surviveMax:   5.5,   // 速率上限（还没乘连击）
  surviveCombo: 0.10,  // 每层连击再加 10%，12 层封顶
  surviveEvery: 10     // 每几秒把这段时间的存活分报一次
};


/* =========================================================
   2.5 余光与技能
   ---------------------------------------------------------
   分数是成绩，余光是货币。花余光不会影响最高分记录。
   第二版技能（第一版每级只加一点点数值，玩家感觉不到，"远目""疾影"几乎没用）：
   · 每项只有三级，每一级都是一眼看得见的变化，第一级很便宜 —— 打一两局就能买到第一样
   · 每一项都改变"怎么打"，而不只是数字：圈变大、断连不清零、多一条命、晶柱更值钱、自动放剑气
   · 场上看得见：盾挂在主角身上、剑气蓄力点挂在连斩下面、续势和剑气触发时头顶报名字
   ========================================================= */
const QI_GATE = 4;          // 剑气：最深打到第几层才解锁
// eff：每一级"现在是什么样"（强化页照抄这一行，控制在 15 个字以内）；c：图标颜色；gate：最深打到第几层才解锁
const SKILLS = [
  { id: 'reach', name: '延锋', c: '#4df7ff', brief: '刀更长 · 光更大 · 够得更远',
    cost: [80, 240, 600],
    eff: ['斩杀圈 +15%', '斩杀圈 +30%', '斩杀圈 +50%'] },

  { id: 'keep', name: '续势', c: '#c38bff', brief: '连斩断了不清零，段位接着叠',
    cost: [80, 240, 600],
    eff: ['断连保留 30% 连斩', '保留 50% · 窗口 +0.2 秒', '保留 70% · 窗口 +0.4 秒'] },

  { id: 'shield', name: '光盾', c: '#ffd166', brief: '被碰到不死，盾替你碎',
    cost: [120, 320, 700],
    eff: ['每局一面光盾', '碎后 40 秒再生', '20 秒再生 · 碎时放震波'] },

  { id: 'focus', name: '聚光', c: '#7dffd2', brief: '晶柱给更多余光 · 越早点越赚',
    cost: [60, 200, 500],
    eff: ['每根晶柱 +10 余光', '每根 +20 · 长得更快', '每根 +35 · 多长一根'] },

  // 第五项要"打到第 4 层"才开，是深度系统给的第一份真奖励
  { id: 'qi', name: '剑气', c: '#ff8a5c', brief: '连斩自动放剑气，清掉身边的怪', gate: QI_GATE,
    cost: [150, 400, 800],
    eff: ['连斩每 10 刀放一圈', '每 8 刀一圈 · 更大', '每 6 刀一圈 · 最大'] }
];

// 每一级的实际数值（下标 = 等级，0 = 没点）
const SK = {
  reach:    [0, 0.15, 0.30, 0.50],   // 斩杀圈（= 光）放大多少
  keep:     [0, 0.30, 0.50, 0.70],   // 断连时保留多少连斩
  keepWin:  [0, 0, 0.2, 0.4],        // 连击窗口加长（秒）
  shieldRe: [0, 0, 40, 20],          // 光盾碎后多久再生（0 = 这一局不再生）
  focus:    [0, 10, 20, 35],         // 每根晶柱多给的余光
  qiEvery:  [0, 10, 8, 6],           // 剑气：连斩每几刀放一次
  qiR:      [0, 140, 165, 200]       // 剑气半径（世界单位）
};

// 技能换过一版就加一：存档里旧版技能花掉的余光全额退回，让玩家按新技能重新挑
const SKILL_VER = 2;
const OLD_SKILL_COST = {
  reach: [100, 300, 650, 1200, 2000], window: [100, 300, 650, 1200, 2000],
  sight: [100, 300, 650, 1200, 2000], ghost: [100, 300, 650, 1200, 2000],
  haste: [150, 400, 800, 1500, 2400]
};

const SKILL_MAP = {};
for (let i = 0; i < SKILLS.length; i++) SKILL_MAP[SKILLS[i].id] = SKILLS[i];

/* =========================================================
   2.6 深度层 / 每局契约 / 里程碑
   ---------------------------------------------------------
   这三样解决的是"没有目标感"：
   · 深度层 —— 单局有了看得见的刻度：第几层、还差几秒进下一层
   · 契约   —— 单局有一件具体要干的事，而且完成就给实打实的余光
   · 里程碑 —— 跨局有"我玩得多，所以手里的东西变了"的证据
   ========================================================= */
// 进层：跟着嘉欣的糖走到这一层的门，碰到就破门（见 2.11 节）。
// 以前是每 15 秒自动进一层（没有目标感），后来是"本层斩够几只、又待够几秒"（站着按死斩就能过，
// 用户反馈"该干什么说不清"）。糖路的长度管每层玩多久：第 1 层二十来秒，越深越长

/* 每层长什么样：一个层 = 一个名字 + 一套怪物权重。
   ---------------------------------------------------------
   以前怪物是按"秒"解锁的（14/20/24/38 秒），层只是个计时器，
   玩家进层时画面不会有任何变化。现在把两条轴并成一条：
   · 第 2 层才有爆裂者，第 3 层才有重型…… 层 = 内容进度
   · 每层开场 1.2 秒后必刷一只"本层新怪"当讲解员，
     常规刷怪概率不动，所以难度曲线是"加了确定性"而不是"拉高"
   · 8 层之后不再发明新东西，改成"终末"加密度，单调递增不回落 */
// feat：这一层的特性（只在这层生效，破门就换），背景主题按特性画（见 GROUNDS）。note 是进层横幅上那一行：
// 破折号前讲清楚特性，破折号后是嘉豪梗（13 号字，360 宽的屏上别超过 22 个字）
const LAYERS = [
  { name: '残响', feat: null,   note: '只有杂兵 —— 先热个身，子涵在看',          w: {} },
  { name: '低语', feat: 'fog',  note: '躲进雾里，怪会迷路 —— 神秘感拉满',        w: { bomb: 0.16 } },
  { name: '裂隙', feat: 'rift', note: '地缝会喷火，人和怪都烧 —— 别站缝上耍帅',  w: { bomb: 0.12, heavy: 0.16 } },
  { name: '空壳', feat: 'slip', note: '地面很滑，冲刺停不住 —— 雨中漫步既视感',  w: { bomb: 0.10, heavy: 0.15, charger: 0.12 } },
  { name: '核心', feat: 'core', note: '站进光核，光圈变大 —— 全场焦点就是你',    w: { bomb: 0.10, heavy: 0.14, charger: 0.11, watch: 0.10 } },
  { name: '黑潮', feat: 'tide', note: '潮流推着所有东西走 —— 嘉豪也得跟潮流',    w: { bomb: 0.18, heavy: 0.19, charger: 0.10, watch: 0.04 } },
  { name: '无光', feat: 'void', note: '世界褪成黑白 · 光圈变小 —— 跟你卫衣一个色', w: { bomb: 0.12, heavy: 0.16, charger: 0.14, watch: 0.17 } },
  { name: '终末', feat: 'end',  note: '怪更快，合围更勤 —— 十年前的仇不报了吗',  w: { bomb: 0.16, heavy: 0.19, charger: 0.16, watch: 0.13 } }
];


// 第 n 层的配置。8 层之后锁在"终末"上叠加密度：越深越挤，但不会有第二种规则
function layerCfg(n) {
  if (n <= LAYERS.length) return LAYERS[n - 1];
  const base = LAYERS[LAYERS.length - 1];
  const k = Math.min(1.6, 1 + (n - LAYERS.length) * 0.08);
  const w = {};
  for (const key in base.w) w[key] = Math.min(0.26, base.w[key] * k);
  return { name: '深处 ' + n, feat: 'end', note: '全面加压 —— 事情开始变得有趣起来了', w: w };
}
function layerFeat() { return hordeMode ? null : layerCfg(layer).feat; }   // 黑潮试玩没有层特性（layer 借来记第几波）
function layerName(n) { return layerCfg(n).name; }

// 这一层"新登场"的怪：之前所有层都没出现过、这层才有。
// 用"历史上出现过没有"而不是"上一层有没有"，否则第 7 层重新引入守望者
// 会被当成新怪，又给它挂一次讲解标记。
function layerNewType(n) {
  const order = ['bomb', 'heavy', 'charger', 'watch'];
  const cur = layerCfg(n).w;
  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    if (!cur[t]) continue;
    let seen = false;
    for (let k = 1; k < n; k++) if (layerCfg(k).w[t]) { seen = true; break; }
    if (!seen) return t;
  }
  return null;
}
// 离门还有多远（0~1，HUD 的门条；到 0.75 先把下一层的地面铺起来）：按糖路上走到第几颗算
function layerProgress() { return door ? clamp(candyNext / door.n, 0, 1) : 0; }

// short 是 HUD 右上角那颗契约胶囊里的短名：位置只够放四五个字
// text 前半句是要做的事，后半句是嘉豪梗；整句会进横幅副标题和死亡页，别超过 14 个字
const CONTRACTS = [
  { id: 'combo',   text: '连击到 25 · 子涵在看',     short: '连击',     need: 25, reward: 50 },
  { id: 'crystal', text: '碎 4 根晶柱 · 碎得显眼',   short: '碎柱',     need: 4,  reward: 50 },
  { id: 'kill',    text: '本局斩杀 35 只',           short: '斩杀',     need: 35, reward: 50 },
  { id: 'layer',   text: '打到第 4 层',              short: '深度',     need: 4,  reward: 50 },
  { id: 'pure',    text: '不碎柱打到第 3 层 · 难得低调', short: '不碎柱', need: 3,  reward: 70 }
];

// 里程碑：达成即解锁，效果立刻体现在手里这把刀上，而不是面板数字 +1
const MILESTONES = [
  // kills：按累计斩杀解锁的里程碑记下门槛，刃阶进度条要报"下一阶顺带解锁什么"
  { id: 'blade', name: '断水', note: '刀身长出一截', kills: 300,
    need: function () { return meta.kills >= 300; },
    prog: function () { return Math.min(meta.kills, 300) + ' / 300 斩'; } },
  { id: 'fifth', name: '剑气', note: '第五项强化解锁',
    need: function () { return meta.depthBest >= QI_GATE; },
    prog: function () { return '最深 第 ' + meta.depthBest + ' / ' + QI_GATE + ' 层'; } },
  { id: 'white', name: '白刃', note: '刀光转白热', kills: 1000,
    need: function () { return meta.kills >= 1000; },
    prog: function () { return Math.min(meta.kills, 1000) + ' / 1000 斩'; } }
];

function milestoneOn(id) {
  for (let i = 0; i < MILESTONES.length; i++) {
    if (MILESTONES[i].id === id) return MILESTONES[i].need();
  }
  return false;
}

// 死亡时结算：条件够了就永久解锁，并把"这局新解锁了什么"记下来给死亡页用
function checkMilestones() {
  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];
    if (meta.unlocked[m.id]) continue;
    if (!m.need()) continue;
    meta.unlocked[m.id] = 1;
    unlockNew.push(m);
  }
  if (unlockNew.length) recalcPowers();
}

// 第五项技能的门槛：已解锁过就一直开着（不因为历史最深被重置而关掉）
function fifthOpen() { return meta.depthBest >= QI_GATE; }

const META_KEY = 'dash_meta_v1';
// tut：新手教程进度，0/1/2 = 正教到第几步，3 = 已教完（永久不再出现）
// tutV：存档里的教学是哪一版（版本不同就重新教，见 2.7 节）
// comboBest：历史最高连斩，结算页报"连斩纪录"用
// seen：每种新敌人的提示卡弹过几次；tipShop / tipSkills：结算页 / 强化页的引导气泡看过没有
// skillV：存档里的技能是哪一版；refund：技能换版时退回了多少余光（强化页报一次就清零）
const meta = { pts: 0, total: 0, runs: 0, lv: {}, depthBest: 0, kills: 0, unlocked: {}, tut: 0, tutV: 0, vib: 1, comboBest: 0,
               seen: {}, tipShop: 0, tipSkills: 0, skillV: SKILL_VER, refund: 0,
               hBest: 0, hScore: 0,       // 黑潮：最远逃了几米、最高分
               candy: 0, skins: {}, skinOn: {},     // 嘉欣糖（2.13 节）：攒了几颗；买了哪些道具皮肤（'ruler.gold': 1）；每个道具装着哪套
               hs: { own: {}, ads: {}, on: 'base' },     // 嘉豪皮肤（2.13 节）：有了哪些、每款看了几次广告、穿着哪套
               htut: 0,                   // 黑潮新手教程看过哪一版（2.14 节，H_TUT_VER）
               hq: { lv: 1, k: 0, q: [] },   // 嘉豪等级、离下一级做完了几个、挂着的三个任务（2.15 节）
               pu: { ruler: 0, stink: 0, ghost: 0, magnet: 0 },     // 道具升到几级（2.15 节，PROP_UP）
               rk: { m: 0, s: 0 },        // 交到排行榜上的最远米数 / 最高分（0.5 节，RK）
               // 宝箱（2.16 节）：n 攒着没开的、pity 连开几个没出整套皮肤、sh 每款皮肤的碎片、inv 仓库道具、carry 带哪种上场、
               // ad 今天看了几次广告十连 { d 哪天, n }、mig 以前看的皮肤广告折过碎片没有
               bx: { n: 0, pity: 0, sh: {}, inv: { ruler: 0, stink: 0, ghost: 0, magnet: 0 }, carry: '', ad: { d: '', n: 0 }, mig: 0 } };

try {
  let raw = Store.get(META_KEY, null);
  if (typeof raw === 'string' && raw) raw = JSON.parse(raw);
  if (raw && typeof raw === 'object') {
    meta.pts   = Math.max(0, parseInt(raw.pts, 10) || 0);
    meta.total = Math.max(0, parseInt(raw.total, 10) || 0);
    meta.runs  = Math.max(0, parseInt(raw.runs, 10) || 0);
    meta.depthBest = Math.max(0, parseInt(raw.depthBest, 10) || 0);
    meta.kills     = Math.max(0, parseInt(raw.kills, 10) || 0);
    meta.comboBest = Math.max(0, parseInt(raw.comboBest, 10) || 0);
    meta.hBest  = Math.max(0, parseInt(raw.hBest, 10) || 0);
    meta.hScore = Math.max(0, parseInt(raw.hScore, 10) || 0);
    meta.candy  = Math.max(0, parseInt(raw.candy, 10) || 0);
    meta.lBest  = Math.max(0, parseInt(raw.lBest, 10) || 0);     // 横屏跑酷（2.17 节）：最远几米、最高分、教过没有
    meta.lScore = Math.max(0, parseInt(raw.lScore, 10) || 0);
    meta.lTut   = raw.lTut === 1 ? 1 : 0;
    // 皮肤只原样读进来（皮肤表在 2.13 节，这里还没定义）：买没买、装没装，用的时候再对着皮肤表查
    if (raw.skins && typeof raw.skins === 'object') for (const k in raw.skins) if (raw.skins[k]) meta.skins[k] = 1;
    if (raw.skinOn && typeof raw.skinOn === 'object') for (const k in raw.skinOn) if (typeof raw.skinOn[k] === 'string') meta.skinOn[k] = raw.skinOn[k];
    if (raw.hs && typeof raw.hs === 'object') {
      if (raw.hs.own && typeof raw.hs.own === 'object') for (const k in raw.hs.own) if (raw.hs.own[k]) meta.hs.own[k] = 1;
      if (raw.hs.ads && typeof raw.hs.ads === 'object') for (const k in raw.hs.ads) meta.hs.ads[k] = Math.max(0, parseInt(raw.hs.ads[k], 10) || 0);
      if (typeof raw.hs.on === 'string') meta.hs.on = raw.hs.on;
    }
    // 任务、道具等级原样读进来，2.15 节对着任务表 / 道具表再查一遍（hqLoad）
    if (raw.hq && typeof raw.hq === 'object') {
      meta.hq.lv = parseInt(raw.hq.lv, 10) || 1;
      meta.hq.k = parseInt(raw.hq.k, 10) || 0;
      if (Array.isArray(raw.hq.q)) meta.hq.q = raw.hq.q.slice(0, 3);
    }
    if (raw.pu && typeof raw.pu === 'object') for (const k in meta.pu) meta.pu[k] = parseInt(raw.pu[k], 10) || 0;
    if (raw.rk && typeof raw.rk === 'object') for (const k in meta.rk) meta.rk[k] = Math.max(0, parseInt(raw.rk[k], 10) || 0);
    if (raw.bx && typeof raw.bx === 'object') {
      const b = raw.bx, int = function (v) { return Math.max(0, parseInt(v, 10) || 0); };
      meta.bx.n = int(b.n); meta.bx.pity = int(b.pity); meta.bx.mig = b.mig ? 1 : 0;
      if (b.sh && typeof b.sh === 'object') for (const k in b.sh) meta.bx.sh[k] = int(b.sh[k]);
      if (b.inv && typeof b.inv === 'object') for (const k in meta.bx.inv) meta.bx.inv[k] = int(b.inv[k]);
      if (typeof b.carry === 'string' && meta.bx.inv[b.carry] !== undefined) meta.bx.carry = b.carry;
      if (b.ad && typeof b.ad === 'object') meta.bx.ad = { d: String(b.ad.d || ''), n: int(b.ad.n) };
    }
    // 教学进度原样读进来；版本不对 / 越界在 2.7 节里统一处理（那时才知道一共几步）
    meta.tut = parseInt(raw.tut, 10) || 0;
    meta.tutV = parseInt(raw.tutV, 10) || 0;
    meta.htut = parseInt(raw.htut, 10) || 0;
    meta.tipShop = raw.tipShop ? 1 : 0;
    meta.tipSkills = raw.tipSkills ? 1 : 0;
    if (raw.seen && typeof raw.seen === 'object') {
      for (const k in raw.seen) meta.seen[k] = Math.max(0, parseInt(raw.seen[k], 10) || 0);
    }
    meta.vib = raw.vib === 0 ? 0 : 1;          // 振动默认开，只有玩家自己关过才是 0
    if (raw.unlocked && typeof raw.unlocked === 'object') {
      for (const k in raw.unlocked) if (raw.unlocked[k]) meta.unlocked[k] = 1;
    }
    meta.refund = Math.max(0, parseInt(raw.refund, 10) || 0);
    if (raw.lv && (parseInt(raw.skillV, 10) || 0) !== SKILL_VER) {
      // 旧版技能：按旧价格把花掉的余光全额退回，等级清空
      let back = 0;
      for (const k in raw.lv) {
        const c = OLD_SKILL_COST[k] || [];
        const l = clamp(parseInt(raw.lv[k], 10) || 0, 0, c.length);
        for (let i = 0; i < l; i++) back += c[i];
      }
      meta.pts += back;
      meta.refund += back;
    } else if (raw.lv) {
      for (const k in raw.lv) {
        const sk = SKILL_MAP[k];
        if (sk) meta.lv[k] = clamp(parseInt(raw.lv[k], 10) || 0, 0, sk.cost.length);
      }
    }
  }
} catch (e) {}

function saveMeta() {
  try { Store.set(META_KEY, JSON.stringify(meta)); } catch (e) {}
}

/* 派生属性：技能只改这里，玩法代码统一读 POW。
   默认值必须等于"零技能"，这样第一次打开的手感和以前完全一致。 */
const POW = {
  dashSpeed:   CFG.dashSpeed,
  autoReach:   CFG.autoReach,
  comboWindow: CFG.comboWindow,
  viewBase:    CFG.viewBase,      // 下面四项现在没有技能动它们，留着给玩法代码统一读
  viewMax:     CFG.viewMax,
  invBonus:    0,
  dashCd:      CFG.dashCd,
  ghostLv:     0,
  blade:       1,      // 刀身视觉长度倍率（延锋 + 里程碑）
  white:       false,  // 白刃：刀光转白热
  windowLv:    0,      // >0 时主角身上画连击倒计时圈（续势）
  keep:        0,      // 续势：断连保留几成连斩
  shieldLv:    0,      // 光盾
  shieldRe:    0,      //   碎后多久再生（0 = 不再生）
  shieldBoom:  false,  //   碎时放一圈震波
  yingBonus:   0,      // 聚光：每根晶柱多给的余光
  crystalN:    CFG.crystalN,
  crystalRe:   CFG.crystalRespawn,
  qiEvery:     0,      // 剑气：连斩每几刀放一次（0 = 没有）
  qiR:         0
};

function lvOf(id) { return meta.lv[id] || 0; }

/* 技能只改这里，玩法代码统一读 POW。零技能时每一项都等于默认值，第一次打开的手感和以前一样 */
function recalcPowers() {
  const lReach = lvOf('reach'), lKeep = lvOf('keep'), lShield = lvOf('shield');
  const lFocus = lvOf('focus'), lQi = lvOf('qi');

  // 延锋：圈大了冲刺也要冲得到圈边，所以冲刺速度同比例加
  const k = SK.reach[lReach];
  POW.dashSpeed   = CFG.dashSpeed * (1 + k);
  POW.autoReach   = CFG.autoReach * (1 + k);
  // 刀长 = 延锋 + 里程碑（"断水"是白送的视觉奖励，不占技能点）
  POW.blade       = 1 + 0.6 * k + (milestoneOn('blade') ? 0.26 : 0);
  POW.white       = milestoneOn('white');

  POW.keep        = SK.keep[lKeep];
  POW.comboWindow = CFG.comboWindow + SK.keepWin[lKeep];
  POW.windowLv    = lKeep;

  POW.shieldLv    = lShield;
  POW.shieldRe    = SK.shieldRe[lShield];
  POW.shieldBoom  = lShield >= 3;

  POW.yingBonus   = SK.focus[lFocus];
  POW.crystalN    = CFG.crystalN + (lFocus >= 3 ? 1 : 0);
  POW.crystalRe   = CFG.crystalRespawn * (lFocus >= 2 ? 0.7 : 1);

  POW.qiEvery     = SK.qiEvery[lQi];
  POW.qiR         = SK.qiR[lQi];
}

function nextCost(sk) {
  const l = lvOf(sk.id);
  return l >= sk.cost.length ? -1 : sk.cost[l];
}

// 技能是否可用：只有"剑气"有门槛（最深打到第 4 层），其余一直是开的
function skillOpen(sk) {
  return !sk.gate || meta.depthBest >= sk.gate;
}

let skillFxId = '';      // 刚买的是哪一项
let skillFxAt = -1e9;    // 买下的时刻（毫秒），用来做卡片闪光

function buySkill(sk) {
  if (!skillOpen(sk)) { S.hit(1); return false; }   // 锁着的技能点了只给一声闷响
  const c = nextCost(sk);
  if (c < 0 || meta.pts < c) return false;
  meta.pts -= c;
  meta.lv[sk.id] = lvOf(sk.id) + 1;
  saveMeta();
  recalcPowers();
  S.upgrade();
  skillFxId = sk.id;
  skillFxAt = nowMs();
  return true;
}

function resetSkills() {
  let back = 0;
  for (const k in meta.lv) {
    const sk = SKILL_MAP[k];
    if (!sk) continue;
    const l = meta.lv[k] || 0;
    for (let i = 0; i < l; i++) back += sk.cost[i];
    meta.lv[k] = 0;
  }
  meta.pts += back;
  saveMeta();
  recalcPowers();
}

/* 测试用：清空余光。第一次点只是「待确认」，3 秒内点第二下才真的清，
   免得测试时手滑把攒了半天的余光点没了。 */
let clearYingAt = -1e9;
const CLEAR_YING_ARM = 3000;

function clearYingArmed() {
  return nowMs() - clearYingAt < CLEAR_YING_ARM;
}

function clearYing() {
  if (!clearYingArmed()) {          // 第一下：进入确认态
    clearYingAt = nowMs();
    S.hit(1);
    return false;
  }
  clearYingAt = -1e9;
  meta.pts = 0;
  meta.tut = 0;          // 测试用：顺手把新手教学和各种引导也重置，方便反复验
  meta.seen = {}; meta.tipShop = 0; meta.tipSkills = 0;
  saveMeta();
  S.whoosh();
  return true;
}

/* =========================================================
   2.7 新手教学
   ---------------------------------------------------------
   第一次玩：点「开始」直接进教学局，一边打一边教，七步：
   拖动移动 → 轻点「斩」→ 按住「斩」自动连斩 → 边拖边斩只砍那个方向 → 捡嘉欣的糖补光 →
   斩碎晶柱拿余光 → 跟着糖走到门、斩开它（这一局的目标）。
   教学期间主角不会死、光也不会灭（七步最长一分半，新手第一条命撑不到）；门要等教到那一步才斩得开。
   原则：
   · 不暂停、不遮罩 —— 一张小卡片 + 场上的手势 / 箭头，黑暗本身才是第一印象
   · 动作驱动 —— 做出那个动作才翻页；每一步都有兜底时间，不会卡死在某一步
   · 教的东西必须马上做得到 —— 教轻点时身边一定有一只怪，教按住时身边一定有一小群
   · 每人只自动出现一次 —— 第一局一开局就记为"看过"（meta.tut = TUT_DONE），
     不管这一局走没走完、死没死，以后都不再自动出现。
     以前是"没走完下局接着教"，可五步最长要一分多钟、新手第一条命只有半分钟，结果每局都来一次。
     想再看：主界面「新手教程」，或者「玩法说明」最后一页。
   ========================================================= */
// limit：这一步最多挂几秒，到点没做到也翻页
const TUT_STEPS = [
  { key: 'move',    limit: 10,
    title: '拖动屏幕 · 移动',            sub: '按住任意空白处往哪拖，人就往哪走 · 雨中漫步' },
  { key: 'tap',     limit: 10,
    title: IS_MG ? '轻点「斩」· 扑向最近的敌人' : '空格 / 左键 · 扑向最近的敌人',
    sub: '砍中了冷却立刻清零，可以马上再斩 —— 帅' },
  { key: 'hold',    limit: 12,
    title: IS_MG ? '按住「斩」不放 · 自动连斩' : '按住空格 · 自动连斩',
    sub: '砍完一只自动扑向圈里的下一只，松手就停 · 像虚空打碟' },
  { key: 'aim',     limit: 12,
    title: '边拖边斩 · 只砍拖的方向',     sub: '拖着屏幕按「斩」：只砍那边的，不会被拽回去' },
  { key: 'candy',   limit: 8,
    title: '捡嘉欣的糖 · 补光',            sub: '身边这圈光会一直变小，光灭了就输 · 斩怪不补光' },
  { key: 'crystal', limit: 15,
    title: '斩碎晶柱 → 拿余光',           sub: '跟着箭头走过去斩它；按住「斩」也会自己去砍' },
  { key: 'gate',    limit: 20,
    title: '跟着糖走 · 走到门口就破门',   sub: '糖路的尽头是这一层的门 · 屏幕边的箭头指着路' }
];
const TUT_DONE = TUT_STEPS.length;
const TUT_VER = 4;        // 教学内容换过就加一：存档里版本不同的人会重新看一遍（3：加了边拖边斩、破门；4：光会灭、跟着糖走到门）
const TUT_FIN = 3.2;      // 五步走完后"教学完成"挂几秒

// 存档里的教学是旧版（或者压根没有）：从头教一遍新版。
// 这份游戏还没发出去，带旧存档的只有自己和帮忙试玩的人，让他们看一遍新教学比"猜他会不会"更划算
if (meta.tutV !== TUT_VER) { meta.tut = 0; meta.tutV = TUT_VER; }
meta.tut = clamp(meta.tut, 0, TUT_DONE);

let tutStep = TUT_DONE;   // 当前教到第几步；TUT_DONE = 不显示
let tutT = 0;             // 这一步已经挂了多久
let tutA = 0;             // 透明度（淡入 + 收尾淡出都用它）
let tutOut = false;       // 正在收尾淡出
let tutFinT = 0;          // >0：五步都走完了，正在报"教学完成"
let tutDrag = 0;          // 本步累计拖动距离（世界坐标）
let tutLx = 0, tutLy = 0; // 上一帧位置，用来算拖动
let tutDashed = 0;        // 进入本步后按过几次「斩」
let tutK0 = 0;            // 进入本步时的斩杀数
let tutC0 = 0;            // 进入本步时碎过几根柱子
let tutLastK = 0;         // 上一帧的斩杀数
let tutHoldT = 0;         // 这一次按住了多久
let tutHoldK = 0;         // 这一次按住期间砍了几只（一松手清零）
let tutHelpT = 0;         // 距离上一次"给你送怪"过了多久
let tutAimK = 0;          // 边拖边斩这一步：拖着的时候砍了几只
let tutL0 = 1;            // 进入「破门」这一步时在第几层
let tutCandy0 = 0;        // 进入「捡糖」这一步时捡过几颗

function tutReset() {
  tutStep = meta.tut < TUT_DONE ? 0 : TUT_DONE;
  // 一开局就记为看过：这一局教到哪算哪，以后不再自动出现
  if (tutStep < TUT_DONE) { meta.tut = TUT_DONE; saveMeta(); }
  tutOut = false; tutFinT = 0;
  tutLx = P.x; tutLy = P.y;
  tutEnter();
}

// 进入一步：记下起点，把这一步要用到的东西摆到玩家身边
function tutEnter() {
  tutT = 0; tutA = 0;
  tutDrag = 0; tutDashed = 0;
  tutK0 = runKills; tutLastK = runKills; tutC0 = crystalsBroken;
  tutHoldT = 0; tutHoldK = 0; tutHelpT = 0; tutAimK = 0; tutL0 = layer; tutCandy0 = runCandy;
  if (tutStep >= TUT_DONE) return;
  const key = TUT_STEPS[tutStep].key;
  if (key === 'hold' || key === 'aim') tutSpawnPack(4);
  // 「捡糖」「破门」：从脚下现摆一条短糖路（这一层的长路可能早走偏了），门就在 8 颗糖之后
  if (key === 'candy' || key === 'gate') buildTrail(CFG.trailNTut);
  if (key === 'crystal' && !tutCrystal()) { const s = crystalSpot(view * 0.55, view * 0.9); if (s) addCrystal(s, true); }
}

function tutGo(n) {
  tutStep = n;
  tutEnter();
}

// 五步走完：卡片换成"教学完成"
function tutFinish() {
  if (tutFinT > 0 || tutOut) return;
  tutFinT = 0.001;
  tutA = 0;
  S.upgrade();
}

// 再来一遍新手教学：主界面「新手教程」/ 玩法说明最后一页。开一局新的，从第一步教起
function replayTutorial() {
  meta.tut = 0;
  start();
}

function tutOn() { return tutStep < TUT_DONE; }

// 在主角身边"长"出 n 只普通怪：教按住连斩时，圈里必须有东西可砍
function tutSpawnPack(n) {
  const a0 = rand(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = rand(150, 210);
    const e = spawnEnemy(P.x + Math.cos(a) * d, P.y + Math.sin(a) * d, 'grunt');
    if (!e) break;
    rings.push({ x: e.x, y: e.y, r0: 6, r1: e.r * 3.2, life: 0.45, max: 0.45, color: 'rgba(191,239,255,0.5)', w: 2 });
  }
  tutHelpT = 0;
}

function tutNearCount(R) {
  let n = 0;
  for (let i = 0; i < enemies.length; i++) if (wdist(enemies[i].x, enemies[i].y, P.x, P.y) < R) n++;
  return n;
}

// 离主角最近的一根晶柱（不论远近）：教碎柱时箭头指着它
function tutCrystal() {
  let b = null, bd = Infinity;
  for (let i = 0; i < crystals.length; i++) {
    const d = wdist(crystals[i].x, crystals[i].y, P.x, P.y);
    if (d < bd) { bd = d; b = crystals[i]; }
  }
  return b;
}

function tickTutorial(dt) {
  if (tutStep >= TUT_DONE) return;

  if (tutOut) {
    tutA -= dt * 1.9;
    if (tutA <= 0) { tutA = 0; tutStep = TUT_DONE; }
    return;
  }

  tutT += dt;
  tutHelpT += dt;
  tutA = Math.min(1, tutA + dt * 3.4);

  // 按住期间砍了几只：一松手就从头数（教的就是"按住不放"）
  const dk = runKills - tutLastK;
  tutLastK = runKills;
  tutHoldT = attackHeld ? tutHoldT + dt : 0;
  tutHoldK = attackHeld ? tutHoldK + dk : 0;

  if (tutFinT > 0) {
    tutFinT += dt;
    if (tutFinT > TUT_FIN) tutOut = true;
    return;
  }

  const key = TUT_STEPS[tutStep].key;
  let done = tutT > TUT_STEPS[tutStep].limit;
  if (key === 'move') {
    // 只认"手指在拖"时走的路：冲刺带出去的位移不算
    if (inputDir()) tutDrag += Math.hypot(wdelta(P.x - tutLx), wdelta(P.y - tutLy));
    // 200 世界像素 ≈ 走过四分之一个屏，够确认"他会拖了"
    if (tutDrag > 200) done = true;
  } else if (key === 'tap') {
    if (runKills > tutK0) done = true;
    // 身边空着就送一只过来：教"点一下就扑过去"，眼前得有东西
    else if (tutHelpT > 1.2 && tutNearCount(320) === 0) {
      const a = P.ang + rand(-0.6, 0.6);
      const e = spawnEnemy(P.x + Math.cos(a) * 210, P.y + Math.sin(a) * 210, 'grunt');
      if (e) rings.push({ x: e.x, y: e.y, r0: 6, r1: e.r * 3.2, life: 0.45, max: 0.45, color: 'rgba(191,239,255,0.5)', w: 2 });
      tutHelpT = 0;
    }
  } else if (key === 'hold') {
    if (tutHoldK >= 3) done = true;
    else if (tutHelpT > 2.5 && tutNearCount(POW.autoReach * 1.4) < 2) tutSpawnPack(3);
  } else if (key === 'aim') {
    // 只认"拖着的时候"砍中的
    if (dk > 0 && inputDir()) tutAimK += dk;
    if (tutAimK >= 2) done = true;
    else if (tutHelpT > 2.5 && tutNearCount(POW.autoReach * 1.4) < 2) tutSpawnPack(3);
  } else if (key === 'crystal') {
    if (crystalsBroken > tutC0) done = true;
  } else if (key === 'candy') {
    if (runCandy > tutCandy0) done = true;
  } else if (key === 'gate') {
    if (layer > tutL0) done = true;
  }
  tutLx = P.x; tutLy = P.y;

  if (!done) return;
  if (tutStep + 1 < TUT_DONE) tutGo(tutStep + 1);
  else tutFinish();
}

// 当前卡片的标题（测试和绘制共用）
function tutText() {
  if (tutFinT > 0) return '出师了，嘉豪！';
  return TUT_STEPS[Math.min(tutStep, TUT_DONE - 1)].title;
}
function tutSub() {
  if (tutFinT > 0) return '跟着糖一层层往下打 · 想再看点主界面「新手教程」';
  const sub = TUT_STEPS[Math.min(tutStep, TUT_DONE - 1)].sub;
  return typeof sub === 'function' ? sub() : sub;
}
function tutKey() { return tutStep < TUT_DONE ? TUT_STEPS[tutStep].key : ''; }
// 教到「破门」那一步才斩得开门：前面几步就走到门口也先压着，免得半路破门、和卡片对不上
function gateHeld() { return tutOn() && tutKey() !== 'gate'; }

// 卡片位置：教「斩」的两步贴在按钮上方，其余在屏幕中下 —— 字永远靠近它说的那个东西
function tutAnchor() {
  const key = TUT_STEPS[Math.min(tutStep, TUT_DONE - 1)].key;
  if (tutFinT <= 0 && isTouch && (key === 'tap' || key === 'hold')) {
    return { x: W_CSS / 2, y: DASH_BTN.y - DASH_BTN.r - 84 };
  }
  return { x: W_CSS / 2, y: H_CSS * 0.68 };
}

function drawTutorial() {
  if (state !== 'play' || tutStep >= TUT_DONE || tutA <= 0.01) return;
  const a = tutA;
  if (tutFinT <= 0) {
    const key = TUT_STEPS[tutStep].key;
    if (key === 'move') drawTutDrag(a);
    else if (key === 'tap' || key === 'hold') drawTutPress(a, key === 'hold');
    else if (key === 'crystal') { const cr = tutCrystal(); if (cr) drawTutPoint(cr.x, cr.y, cr.r, '晶柱', UI.ice, a); }
    else if (key === 'candy') { const c = lightTarget(); if (c && c !== door) drawTutPoint(c.x, c.y, 10, '嘉欣糖', CANDY_C, a); }
    else if (key === 'gate') { const c = lightTarget(); if (c) drawTutPoint(c.x, c.y, c === door ? 40 : 10, c === door ? '门' : '嘉欣糖', c === door ? UI.gold : CANDY_C, a); }
  }
  drawTutCard(a);
  ctx.globalAlpha = 1;
}

// 卡片：顶上一排步骤点（走过的青色、当前的白色），标题 + 一行说明。收尾那张描金边
function drawTutCard(a) {
  const fin = tutFinT > 0;
  const title = tutText(), sub = tutSub();
  const p = tutAnchor();
  uf(800, 16);
  const tw = textW(title);
  uf(500, 12);
  const sw = textW(sub);
  const w = Math.min(W_CSS - 24, Math.max(tw, sw) + 40), h = 72;
  const s = 0.9 + 0.1 * easeOut((fin ? tutFinT : tutT) / 0.25);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(p.x, p.y);
  ctx.scale(s, s);
  bladeBox(-w / 2, -h / 2, w, h, { c: 12, top: '#0f1a20', bot: '#070c10',
    border: fin ? rgba(UI.gold, 0.8) : rgba(UI.cyan, 0.45), lw: 1.2, ticks: fin ? rgba(UI.gold, 0.8) : rgba(UI.cyan, 0.6) });

  const n = TUT_DONE, cur = fin ? n : tutStep;
  for (let i = 0; i < n; i++) {
    gem((i - (n - 1) / 2) * 14, -h / 2 + 12, i === cur ? 5 : 3.5,
      i < cur ? UI.cyan : (i === cur ? '#ffffff' : 'rgba(255,255,255,0.18)'));
  }
  ctx.textAlign = 'center';
  uf(800, 16);
  ctx.fillStyle = fin ? UI.gold : '#eafcff';
  ctx.fillText(title, 0, 4);
  uf(500, 12);
  ctx.fillStyle = 'rgba(214,240,255,0.62)';
  ctx.fillText(sub, 0, 24);
  ctx.restore();
}

// 一根"手指"：按下时外面多一圈
function drawFinger(x, y, down, a) {
  ctx.globalAlpha = a;
  if (down) {
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, down ? 11 : 12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,' + (down ? 0.92 : 0.6) + ')';
  ctx.fill();
}

// 第一步：左下方演示"按住往外拖"。玩家自己一按下去，演示就让位给真实的摇杆
function drawTutDrag(a) {
  if (touchId !== null) return;
  const ox = W_CSS * 0.3, oy = H_CSS * 0.8;
  const ph = (nowMs() / 1700) % 1;
  const down = ph > 0.12 && ph < 0.82;
  const k = easeOut((ph - 0.18) / 0.5);
  const ang = -0.75 + Math.sin(nowMs() / 2300) * 0.6;
  const fx = ox + Math.cos(ang) * 56 * (down ? k : 0), fy = oy + Math.sin(ang) * 56 * (down ? k : 0);
  ctx.globalAlpha = a * (down ? 1 : 0.5);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(ox, oy, 56, 0, Math.PI * 2);
  ctx.stroke();
  if (down && k > 0.05) {
    // 拖出来的方向：一串越来越亮的小点
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      ctx.beginPath();
      ctx.arc(ox + (fx - ox) * t, oy + (fy - oy) * t, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(191,246,255,' + (0.2 + t * 0.5) + ')';
      ctx.fill();
    }
  }
  drawFinger(fx, fy, down, a);
}

// 教「斩」：手指在按钮上点（一下一下）或按住（按钮外圈一路转），点下去时荡开一圈
function drawTutPress(a, hold) {
  if (!isTouch) return;
  const x = DASH_BTN.x, y = DASH_BTN.y, R = DASH_BTN.r;
  const ph = (nowMs() / 1300) % 1;
  const real = attackHeld;
  const down = hold ? (real || ph < 0.85) : (real || (ph > 0.2 && ph < 0.36));
  if (!hold && !real && ph > 0.2 && ph < 0.7) {
    const k = (ph - 0.2) / 0.5;
    ctx.globalAlpha = a * (1 - k) * 0.8;
    ctx.lineWidth = 2;
    ctx.strokeStyle = UI.cyan;
    ctx.beginPath();
    ctx.arc(x, y, R + 8 + k * 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (hold) {
    // 按住的进度：真按住时跟着真实时长走，没按时循环演示
    const p = real ? clamp(tutHoldT / 0.8, 0, 1) : clamp(ph / 0.8, 0, 1);
    ctx.globalAlpha = a;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.arc(x, y, R + 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = UI.gold;
    ctx.beginPath();
    ctx.arc(x, y, R + 12, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    // 已经连上几刀
    if (real && tutHoldK > 0) {
      ctx.textAlign = 'center';
      uf(900, 14);
      outlineText('连斩 ' + Math.min(tutHoldK, 3) + ' / 3', x, y - R - 22, UI.gold, 3);
    }
  }
  if (!real) drawFinger(x + R * 0.3, y + R * 0.42, down, a);
  ctx.globalAlpha = 1;
}

// 斩杀圈：沿着圈画一圈流动的亮虚线，四个方向各一个箭头指着圈
// 小三角箭头：尖朝 ang
function drawArrow(x, y, ang, c) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(-6, -7);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fillStyle = c;
  ctx.fill();
  ctx.restore();
}

// 教学指一个东西（晶柱 / 糖 / 门）：在屏幕里就绕两道弧、头顶一个箭头 + 名字；在屏幕外就在边上指着它
function drawTutPoint(x, y, wr, label, c, a) {
  const p = toScreen(x, y);
  const t = nowMs() / 1000;
  const m = 34;
  ctx.globalAlpha = a;
  if (p.x > m && p.x < W_CSS - m && p.y > m + SAFE_TOP && p.y < H_CSS - m) {
    const r = wr * SC + 12;
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(c, (0.55 + 0.35 * Math.sin(t * 5)).toFixed(3));
    for (let i = 0; i < 2; i++) {
      const a0 = t * 1.2 + i * Math.PI - 0.7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, a0, a0 + 1.4);
      ctx.stroke();
    }
    drawArrow(p.x, p.y - r - 16 + Math.sin(t * 6) * 5, Math.PI / 2, c);
    ctx.textAlign = 'center';
    uf(800, 12);
    outlineText(label, p.x, p.y - r - 30, c, 3);
  } else {
    const o = toScreen(P.x, P.y);
    const ang = Math.atan2(p.y - o.y, p.x - o.x);
    const ex = clamp(p.x, m, W_CSS - m), ey = clamp(p.y, hudTop() + 190, H_CSS - SAFE_BOTTOM - 170);   // 躲开顶上的 HUD、底下的斩按钮
    drawArrow(ex - Math.cos(ang) * Math.sin(t * 6) * 4, ey - Math.sin(ang) * Math.sin(t * 6) * 4, ang, c);
  }
}


/* =========================================================
   2.8 越打越爽：连斩段位 / 刃阶 / 正反馈
   ---------------------------------------------------------
   两条刻度，一条管这一局，一条管这个人：
   · 段位 —— 连斩跨过门槛就升一段：段名从主角头上炸出来，
     HUD 的连斩数、刀光拖尾、击杀刀环一起换成这一段的颜色。越连越烫。
   · 刃阶 —— 按累计斩杀算的称号。每一局的斩杀都会让进度条往前走，
     结算页一定看得见"这局让我亮了多少"。只是称号，不改任何数值。
   连斩断掉也不是"丢了"：这一串攒下的分先挂在连斩数下面，
   断刀那一下从那里飞进总分 —— 断的那一拍变成一次入账。
   ========================================================= */
// bg：这一段整个场地染的颜色（见 BGT）。挑和主角段位色冷暖相对的深色，主角暖、场地就冷；
// 避开红色 —— 红色留给怪和危险提示
const COMBO_TIERS = [
  // 体育生追嘉欣的故事以后（用户定的新故事）：段位改成体育生口吻，最高一档"嘉欣回头"
  { at: 5,   name: '热身',     c: '#ffd166', bg: '#2a4cff' },
  { at: 10,  name: '起跑',     c: '#ffb347', bg: '#2f6bff' },
  { at: 20,  name: '加速跑',   c: '#ff7a45', bg: '#0a9cd0' },
  { at: 35,  name: '冲刺',     c: '#ff5ea8', bg: '#00b38f' },
  { at: 50,  name: '破纪录',   c: '#c38bff', bg: '#2fae5e' },
  { at: 75,  name: '全校沸腾', c: '#5ff4ff', bg: '#8a3cff' },
  { at: 100, name: '嘉欣回头', c: '#fff1c9', bg: '#3b2bff' }
];
function tierOf(c) {
  let t = -1;
  for (let i = 0; i < COMBO_TIERS.length; i++) if (c >= COMBO_TIERS[i].at) t = i;
  return t;
}
function tierColor(t) { return t >= 0 ? COMBO_TIERS[t].c : '#eafcff'; }

// 主角的颜色：连斩到第一段（×5）起换成段位色，越连越烫；连斩断了回到原来的青色。
// 不是一下跳过去（tickUI 里缓动）：升段 0.2 秒左右滑过去，看得出是"烧"起来的；
// 断了半秒左右慢慢褪回去，和 FB.heat 同一条缓动
const HERO = { r: 77, g: 247, b: 255 };
// 场地染色：颜色和浓度都跟着段位缓动（和 HERO 同一条曲线）。断连时只把浓度退掉，颜色不动，
// 免得退的半路扫过一串别的色
const BGT = { r: 0, g: 0, b: 0, a: 0 };
function bgtTarget() { return FB.tier >= 0 && layerFeat() !== 'void' ? 0.12 + 0.03 * FB.tier : 0; }
function heroTarget() { const c = FB.tier >= 0 ? tierColor(FB.tier) : (hordeMode && heroSkin().body) || THEME.player; return monoFallback() ? grayOf(c) : c; }   // 没连斩：皮肤的身体色（2.13 节）
function heroColor() {
  const h = function (v) { const x = Math.round(clamp(v, 0, 255)).toString(16); return x.length < 2 ? '0' + x : x; };
  return '#' + h(HERO.r) + h(HERO.g) + h(HERO.b);
}
function heroSnap() {
  const n = parseInt(heroTarget().slice(1), 16);
  HERO.r = n >> 16 & 255; HERO.g = n >> 8 & 255; HERO.b = n & 255;
  FB.heat = FB.tier >= 0 ? 1 : 0;
  if (FB.tier >= 0) {
    const m = parseInt(COMBO_TIERS[FB.tier].bg.slice(1), 16);
    BGT.r = m >> 16 & 255; BGT.g = m >> 8 & 255; BGT.b = m & 255;
  }
  BGT.a = bgtTarget();
}

// —— 全服排名（现在是假的）——
// 抖音自带的排行只能看同玩好友；"全服第几名 / 强于多少人"要所有人的分数存在一处才算得出（抖音云或自己的服务器）。
// 后端接好之前，用一条假的分数分布估一个名次，只为先看效果（CFG.fakeRank，界面上标"测试数据"）。
// 接真后端时只换这里：of(分数) → { rank 第几名, pct 强于多少比例的玩家 }
const RANK = {
  total: 48000,                                  // 假的总人数
  pct: function (s) { return s > 0 ? 1 - Math.exp(-Math.pow(s / 2900, 1.15)) : 0; },   // 中位约 2100 分
  of: function (s) { const p = this.pct(s); return { rank: Math.max(1, Math.round((1 - p) * this.total) + 1), pct: p }; }
};
function fmtNum(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// 刃阶：光从一点点亮到永昼。300 / 1000 两档正好对上"断水""白刃"两个里程碑
const RANKS = [
  { at: 0,    name: '路人甲',     c: '#86b3c4' },
  { at: 50,   name: '见习嘉豪',   c: '#9fe8ff' },
  { at: 150,  name: '黑衣嘉豪',   c: '#7df0ff' },
  { at: 300,  name: '雨中嘉豪',   c: '#4df7ff' },
  { at: 600,  name: '打碟嘉豪',   c: '#7dffd2' },
  { at: 1000, name: '显眼嘉豪',   c: '#d8f9ff' },
  { at: 1600, name: '隔壁班嘉豪', c: '#ffe08a' },
  { at: 2500, name: '全校嘉豪',   c: '#ffd166' },
  { at: 4000, name: '全网嘉豪',   c: '#ffb347' },
  { at: 6000, name: '嘉豪本豪',   c: '#ffffff' }
];
function rankOf(kills) {
  let i = 0;
  while (i + 1 < RANKS.length && kills >= RANKS[i + 1].at) i++;
  const r = RANKS[i], nx = RANKS[i + 1] || null;
  return { i: i, name: r.name, c: r.c, at: r.at, next: nx,
           p: nx ? clamp((kills - r.at) / (nx.at - r.at), 0, 1) : 1 };
}
// 下一阶顺带解锁的里程碑（断水 / 白刃）；没有就是 null
function rankUnlock(next) {
  if (!next) return null;
  for (let i = 0; i < MILESTONES.length; i++) if (MILESTONES[i].kills === next.at) return MILESTONES[i];
  return null;
}

// 离得最近的一次强化：已解锁、没满级的里面，价格最低的那一项。
// 结算页的余光进度条、主界面"可升级"角标都看它 —— 每一局都要看得见"离下一刀更强还差多少"
function nextSkillGoal() {
  let g = null;
  for (let i = 0; i < SKILLS.length; i++) {
    const sk = SKILLS[i], c = nextCost(sk);
    if (c < 0 || !skillOpen(sk)) continue;
    if (!g || c < g.cost) g = { sk: sk, cost: c, lv: lvOf(sk.id) + 1 };
  }
  return g;
}
function canUpgrade() { const g = nextSkillGoal(); return !!g && meta.pts >= g.cost; }

// 正反馈的全部状态。HUD 上的数字都是"显示值"，追着真实值跑，才有跳动和入账的过程
const FB = {
  score: 0, scorePop: 0,   // HUD 分数 = score - pend，一路往上滚
  pend: 0,                 // 还没飞进总分的连斩分
  chain: 0,                // 这一串连斩攒的击杀分（挂在连斩数下面）
  ying: 0, yingPop: 0,     // HUD 余光：光点飞到才加
  comboPop: 0,             // 每一刀让连斩数弹一下
  tier: -1, tierPop: 0,    // 当前段位 / 刚升段的那一下
  heat: 0,                 // 段位的"热度" 0~1：脚下的光、主角光晕亮几分，跟着主角颜色一起缓动
  flash: 0, flashC: '#ffffff', flashT: 0,     // 升段那一下屏幕四周的光框（drawTierFrame）
  best0: 0, depth0: 0, combo0: 0, kills0: 0,   // 开局时的各项纪录：判断这局破了没有
  record: false, comboRec: false,              // 本局已经报过"新纪录" / "连斩纪录"
  burst: 0, burstT: -1e9, burstDash: -1, burstF: null,   // 一刀多杀
  overFx: 0                // 结算页的音效走到第几拍
};
let banners = [];          // 屏幕上方的横幅（新纪录 / 契约达成），一次只放一条
let flyers = [];           // 从世界飞进 HUD 的东西：余光光点、连斩入账
let dashSeq = 0;           // 第几刀：一刀多杀按"同一刀"算

function fbReset() {
  FB.score = 0; FB.scorePop = 0; FB.pend = 0; FB.chain = 0;
  FB.ying = 0; FB.yingPop = 0; FB.comboPop = 0;
  FB.tier = -1; FB.tierPop = 0; FB.flash = 0;
  FB.best0 = best; FB.depth0 = meta.depthBest; FB.combo0 = meta.comboBest; FB.kills0 = meta.kills;
  FB.record = false; FB.comboRec = false;
  FB.burst = 0; FB.burstT = -1e9; FB.burstDash = -1; FB.burstF = null;
  FB.overFx = 0;
  banners.length = 0; flyers.length = 0;
  enemyTip = null;
  heroSnap();
}

// 世界坐标 → 屏幕 CSS 坐标（不含震屏）：光点从这里起飞
function toScreen(x, y) {
  return { x: (wdx(x) - cam.x + W / 2) * SC, y: (wdy(y) - cam.y + H / 2) * SC };
}
// HUD 几个落点：绘制和飞行光点共用，飞过去一定落在字上
function hudTop()   { return SAFE_TOP + 14; }
function hudScore() { return { x: laneMode ? lPauseBtn().x + lPauseBtn().w + 14 : 20, y: hudTop() + 30 }; }
function hudYing()  { return { x: 34, y: hudTop() + 69 }; }
function hudCombo() { return laneMode ? { x: W_CSS / 2, y: SAFE_TOP + 50, k: 0.6 } : hordeMode ? hComboAt() : { x: W_CSS / 2, y: hudTop() + 108 }; }

function pushBanner(text, sub, c) {
  if (banners.length >= 3) banners.shift();      // 堆太多就丢最旧的，别让横幅排队排到下一层
  banners.push({ text: text, sub: sub, c: c, t: 0, dur: 1.7 });
}

// 主角头顶炸出来的大字：段位、多杀、剑气、光盾。世界坐标，跟着刀走；size 是世界单位（手机上约一半）。
// 剑气一下清一片时会同时冒出好几行：和头顶还挂着的大字错开，往上叠，不压在一起
function callout(text, c, size, up) {
  // 头顶最多挂三行：再来新的，最旧的那行马上淡出，把位置让出来（不然一路叠到 HUD 上）
  const live = [];
  for (let i = 0; i < floats.length; i++) if (floats[i].pop && floats[i].life >= floats[i].max * 0.35) live.push(floats[i]);
  live.sort(function (p, q) { return p.life - q.life; });
  for (let i = 0; i + 2 < live.length; i++) live[i].life = Math.min(live[i].life, live[i].max * 0.3);
  let y = P.y - up;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i];
      if (!f.pop || f.life < f.max * 0.35 || Math.abs(wdelta(f.x - P.x)) > 220) continue;
      const gap = (f.size + size) * 0.75;
      if (Math.abs(f.y - y) < gap) { y = f.y - gap; moved = true; }
    }
    if (!moved) break;
  }
  const f = { x: P.x, y: y, text: text, life: 0.95, max: 0.95, size: size, c: c, pop: 1 };
  floats.push(f);
  return f;
}

// 升段爆发：段位越高越猛 —— 屏幕四周的光框、两道冲击环、一下加重的震屏、逐段升调的音效
function onTierUp(t) {
  const T = COMBO_TIERS[t];
  FB.tier = t; FB.tierPop = 1;
  FB.flash = 1; FB.flashC = T.c; FB.flashT = t;
  callout(T.name, T.c, Math.min(64 + t * 3, Math.floor((W_CSS - 40) / Array.from(T.name).length)), 124);   // 四个字的名号按屏宽收一收，别撑出屏
  rings.push({ x: P.x, y: P.y, r0: 22, r1: 220 + t * 40, life: 0.5 + t * 0.03, max: 0.5 + t * 0.03, color: T.c, w: 4 + t });
  rings.push({ x: P.x, y: P.y, r0: 10, r1: 140 + t * 25, life: 0.32, max: 0.32, color: '#ffffff', w: 2 + t * 0.5 });
  shake = Math.max(shake, Math.min(24, 10 + t * 2));
  S.tierUp(t);
  vibrate(1);
}

// 每一刀砍穿：连斩分先挂着、连斩数弹一下、看要不要升段、看是不是一刀多杀
function fbKill(gain) {
  FB.pend += gain;
  FB.chain += gain;
  FB.comboPop = 1;
  const t = tierOf(combo);
  if (t > FB.tier) onTierUp(t);

  // 一刀多杀：同一刀里砍穿几只，或者同一瞬间被炸死几只（连锁爆炸）
  const same = (P.dashT > 0 && FB.burstDash === dashSeq) || gameTime - FB.burstT < 0.09;
  FB.burst = same ? FB.burst + 1 : 1;
  FB.burstT = gameTime;
  FB.burstDash = P.dashT > 0 ? dashSeq : -1;
  if (FB.burst >= 2) {
    const txt = FB.burst === 2 ? '双斩' : (FB.burst === 3 ? '三斩' : '群斩 ×' + FB.burst);
    const f = FB.burstF;
    if (f && f.life > 0 && floats.indexOf(f) >= 0) {
      f.text = txt; f.life = f.max; f.pop = 1;
      f.size = Math.min(62, f.size + 5);
    } else {
      FB.burstF = callout(txt, '#ffffff', 44, 50);
    }
  }
}

// 连斩断了：这一串的分从连斩数那里飞进总分
function fbChainEnd(n) {
  FB.tier = -1; FB.tierPop = 0;
  if (FB.chain > 0) {
    const a = hudCombo(), b = hudScore();
    flyers.push({ kind: 'score', v: FB.chain, n: n, c: tierOf(n) >= 0 ? tierColor(tierOf(n)) : '#ffd166',
                  x0: a.x, y0: a.y + 30, x1: b.x + 46, y1: b.y - 12, t: 0, hold: 0.42, dur: 0.5 });
  }
  FB.chain = 0;
  // 打破历史最高连斩：在断的这一刻报，不在连斩中途抢画面
  if (!FB.comboRec && FB.combo0 >= 10 && n > FB.combo0) {
    FB.comboRec = true;
    pushBanner('连斩纪录', '×' + n + '　超过了 ×' + FB.combo0, tierColor(tierOf(n)));
  }
}

// 死了：没飞完的连斩分直接入账，死亡页 / 结算页看的都是真分数
function fbBankAll() {
  for (let i = flyers.length - 1; i >= 0; i--) if (flyers[i].kind === 'score') flyers.splice(i, 1);
  FB.pend = 0; FB.chain = 0;
  FB.score = score;
}

function fbCrystal(c) {
  const a = toScreen(c.x, c.y), b = hudYing();
  flyers.push({ kind: 'ying', v: c.ying, x0: a.x, y0: a.y, x1: b.x, y1: b.y, t: 0, hold: 0.1, dur: 0.62 });
}

// 结算页的节拍：分数滚完报纪录，刃阶进度条走完报升阶（各响一次）
const OVER_REC_T = 1.05;     // 分数滚完的时刻
const OVER_RANK_T = 2.55;    // 刃阶进度条走完的时刻

function tickUI(dt) {
  // HUD 分数：追着"真分数 - 没入账的连斩分"跑，差得越多跑得越快
  const target = score - FB.pend;
  if (FB.score < target) FB.score = Math.min(target, FB.score + Math.max(dt * 30, (target - FB.score) * Math.min(1, dt * 8)));
  else FB.score = target;
  FB.scorePop = Math.max(0, FB.scorePop - dt * 3.2);
  FB.yingPop = Math.max(0, FB.yingPop - dt * 3.2);
  {
    // 升温快、降温慢。热度和颜色走同一条缓动：亮度要是一帧切回原档、颜色却还没褪完，
    // 连斩一断亮区就会先猛暗一下再回来（真机上就是"连斩结束屏幕暗一下"）
    const hot = FB.tier >= 0, k = Math.min(1, dt * (hot ? 14 : 4.5));
    const n = parseInt(heroTarget().slice(1), 16);
    HERO.r += ((n >> 16 & 255) - HERO.r) * k;
    HERO.g += ((n >> 8 & 255) - HERO.g) * k;
    HERO.b += ((n & 255) - HERO.b) * k;
    FB.heat += ((hot ? 1 : 0) - FB.heat) * k;
    if (hot) {
      const m = parseInt(COMBO_TIERS[FB.tier].bg.slice(1), 16);
      BGT.r += ((m >> 16 & 255) - BGT.r) * k;
      BGT.g += ((m >> 8 & 255) - BGT.g) * k;
      BGT.b += ((m & 255) - BGT.b) * k;
    }
    BGT.a += (bgtTarget() - BGT.a) * k;
  }
  MONO.k += (monoTarget() - MONO.k) * Math.min(1, dt * 4);
  foeAdapt();
  FB.flash = Math.max(0, FB.flash - dt / 0.55);
  FB.comboPop = Math.max(0, FB.comboPop - dt * 5);
  FB.tierPop = Math.max(0, FB.tierPop - dt * 1.4);

  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    f.t += dt;
    if (f.t < f.hold + f.dur) continue;
    flyers.splice(i, 1);
    if (f.kind === 'score') { FB.pend = Math.max(0, FB.pend - f.v); FB.scorePop = 1; }
    else { FB.ying += f.v; FB.yingPop = 1; }
  }

  // 新敌人卡：和横幅共用屏幕上方那个位置，进层字幕 / 横幅 / 教学卡都放完了才轮到它
  if (enemyTip && state === 'play' && enemyTipFree()) {
    enemyTip.t += dt;
    if (enemyTip.t > ENEMY_TIP_T) enemyTip = null;
  }

  // 横幅：进层的层名在放的时候先等着，不叠在一起
  if (banners.length && layerFxT <= 0.2) {
    const b = banners[0];
    b.t += dt;
    if (b.t >= b.dur) banners.shift();
  }

  // 新纪录：按 HUD 上滚到的分数算 —— 连斩入账、分数滚过最高分的那一下才报
  if (state === 'play' && !FB.record && FB.best0 > 0 && FB.score > FB.best0) {
    FB.record = true;
    pushBanner('新纪录', '超过了 ' + FB.best0, '#ffd166');
    S.upgrade();
    vibrate(1);
  }

  if (state === 'over') {
    if (FB.overFx === 0 && overT > OVER_REC_T) {
      FB.overFx = 1;
      if (FB.best0 > 0 && score > FB.best0) { S.upgrade(); vibrate(1); }
    }
    if (FB.overFx === 1 && overT > OVER_RANK_T) {
      FB.overFx = 2;
      if (rankOf(meta.kills).i > rankOf(FB.kills0).i) { S.upgrade(); vibrate(2); }
    }
  }
}


/* =========================================================
   2.9 刀诀：局内三选一
   ---------------------------------------------------------
   技能（2.5 节）在局外、有上限：买满之后余光没处花，每一局开局都一样（用户反馈：砍几回就腻了）。
   刀诀是这一局里的：每斩开一扇门（破门，见 2.11 节），三张刀诀挑一张 → 斩法变了 → 斩开路往下走得更快 →
   再破门、再挑……每局从零开始，每局抽到的不一样。
   （以前是斩杀攒「豪气」攒满就挑：刀诀杀的也攒，越挑越快，几秒就弹一次 —— 用户嫌太简单，选了"破门才给"）
   每张都改"怎么斩"，不只是加数：刀光跳到下一只、斩完原地炸一圈、刀路过一会儿再割一遍、
   身边转唱片、收刀甩出飞刃、把怪吸过来看呆。两张特定的都满级，合成奥义。
   刀诀杀的怪照样算斩杀（加连斩、加分），但只有"刀砍到的"才触发连锁 / 余震 / 围观，
   刀诀杀的不再触发 —— 不然一刀就连成一整屏、停不下来。CFG.cards = false 整个关掉
   ========================================================= */
// eff：挑了这一级是什么样（卡上照抄，15 个字以内）；ab：HUD 底下那排小签上的一个字
const CARDS = [
  { id: 'chain', name: '连锁斩', ab: '连', c: '#7df0ff', brief: '斩杀时，刀光跳到旁边一只',
    eff: ['跳 1 只', '跳 2 只 · 跳得更远', '跳 3 只 · 跳得最远'] },
  { id: 'quake', name: '余震', ab: '震', c: '#ff9a5c', brief: '斩完原地炸一圈，炸到的也算斩杀',
    eff: ['炸一小圈', '圈更大', '圈最大'] },
  { id: 'echo', name: '残影', ab: '影', c: '#c38bff', brief: '刀路留一道刀痕，过一会儿再割一次',
    eff: ['0.45 秒后再割一次', '刀痕更宽', '割两次 · 刀痕最宽'] },
  { id: 'disc', name: '打碟', ab: '碟', c: '#ff5ea8', brief: '身边转出唱片，碰到的怪就切',
    eff: ['一张唱片', '两张 · 转得更快', '三张 · 转得更远'] },
  { id: 'blade', name: '飞刃', ab: '刃', c: '#ffd166', brief: '每次收刀，往前甩出一道飞刃',
    eff: ['飞得近 · 穿 2 只', '飞得远 · 穿 4 只', '三道飞刃 · 一路穿到底'] },
  { id: 'pull', name: '围观', ab: '围', c: '#7dffd2', brief: '斩杀时周围的怪凑过来看呆，撞不死你',
    eff: ['每 1.2 秒吸一小圈', '每 1 秒 · 吸得更远', '每 0.8 秒 · 吸得最远'] }
];
// 奥义：need 里的刀诀都满级，挑完最后一级的那一下自动合成
const ULTS = [
  { id: 'boom', name: '连环炸', need: ['chain', 'quake'], c: '#ffb347', brief: '连锁跳到的每一只都炸一圈' }
];
// 每一级的数值（下标 = 等级，0 = 没有）。距离都是世界单位（斩杀圈 175）
const CD = {
  chainN: [0, 1, 2, 3], chainR: [0, 150, 175, 200],          // 跳几只 / 一跳够多远
  quakeR: [0, 60, 80, 100], boomK: 1.2,                     // 余震半径；合成连环炸后再放大
  echoW: [0, 20, 28, 36], echoN: [0, 1, 1, 2],              // 刀痕宽 / 割几次
  echoT: 0.45, echoGap: 0.35,                               // 多久后割第一次 / 两次之间隔多久
  discN: [0, 1, 2, 3], discR: [0, 70, 78, 92], discW: [0, 3.0, 3.6, 3.6], discHit: 15,   // 张数 / 转多远 / 角速度 / 唱片半径
  bladeR: [0, 240, 320, 400], bladeHit: [0, 2, 4, 99], bladeN: [0, 1, 1, 3], bladeSp: 1100,
  pullR: [0, 160, 210, 260], pullT: [0, 0.45, 0.55, 0.7], pullCd: [0, 1.2, 1.0, 0.8],
  pullAhead: 70                                             // 往刀前面多远的那一点凑
};
const CARD_MAP = {};
for (let i = 0; i < CARDS.length; i++) CARD_MAP[CARDS[i].id] = CARDS[i];

let cardLv = {};              // 这一局每张刀诀几级
let ultOn = {};               // 这一局合成了哪些奥义
let pickWait = 0;             // 破门以后再等这么久（局内时间）弹三选一
let pick = null;              // 三选一：{ opts 三张卡, t 弹出了多久（真实秒）, chosen 点了第几张, ct 点完多久 }
let cardQ = [];               // 待放的连锁 / 余震 / 围观：在 update 末尾统一放，不在碰撞循环里改敌人数组
let zaps = [];                // 连锁的电光：{ pts: [x, y, …]（首点之后按最短绕行接上，不跨界跳）, life, max }
let echoes = [];              // 残影刀痕：{ seq 第几刀, x0, y0, x1, y1（x1 按 x0 展开）, t 离下一割, n 还割几次, w, fl 刚割完的亮 }
let blades = [];              // 飞刃：{ x, y, dx, dy, left 还能飞多远, hits 还能穿几只, done 已经碰过的怪 }
let discA = 0;                // 唱片转到的角度
let pullAt = 0;               // 围观：gameTime 到这里才能再吸一次
let runPicks = [];            // 这一局挑的顺序：[id, 挑完几级, 第几秒]（HUD 小签的顺序 / 测试数据）

function cardsOn() { return CFG.cards && !tutOn(); }      // 教学局不给刀诀：先把斩学会
function clv(id) { return cardLv[id] || 0; }
function cardsLeft() {
  const out = [];
  for (let i = 0; i < CARDS.length; i++) if (clv(CARDS[i].id) < 3) out.push(CARDS[i]);
  return out;
}
function ultOf(cd) {
  for (let i = 0; i < ULTS.length; i++) if (ULTS[i].need.indexOf(cd.id) >= 0) return ULTS[i];
  return null;
}

function cardReset() {
  cardLv = {}; ultOn = {};
  pickWait = 0; pick = null;
  cardQ.length = 0; zaps.length = 0; echoes.length = 0; blades.length = 0;
  discA = 0; pullAt = 0; runPicks = [];
}

// 每斩一只（killEnemy 末尾）：刀砍到的（src 为空）才触发连锁 / 余震 / 围观
function cardOnKill(e, src) {
  if (!cardsOn()) return;
  if (src === 'chain' && ultOn.boom) cardQ.push({ k: 'quake', x: e.x, y: e.y, r: CD.quakeR[3] * CD.boomK });
  if (src) return;
  const lc = clv('chain'), lq = clv('quake'), lp = clv('pull');
  if (lc) cardQ.push({ k: 'chain', x: e.x, y: e.y, n: CD.chainN[lc], R: CD.chainR[lc] });
  if (lq) cardQ.push({ k: 'quake', x: e.x, y: e.y, r: CD.quakeR[lq] * (ultOn.boom ? CD.boomK : 1) });
  if (lp && gameTime >= pullAt) { pullAt = gameTime + CD.pullCd[lp]; cardQ.push({ k: 'pull', x: e.x, y: e.y }); }
}

// 刀诀碰到一只怪：重型先裂甲，甲硬直中滑过去，其余斩杀。返回 0 没碰动 / 1 裂甲 / 2 斩杀
function cardHit(j, src) {
  const e = enemies[j];
  if (e.heavy && !e.cracked) { crackEnemy(e); return 1; }
  if (e.heavy && e.armorT > 0) return 0;
  killEnemy(j, src);
  return 2;
}

// 连锁斩：从斩掉的那只开始，一只一只跳向离得最近的（够得着的里面），刀光连成一道电光
function runChain(q) {
  let x = q.x, y = q.y;
  const pts = [x, y], hit = [];
  for (let n = 0; n < q.n; n++) {
    let b = -1, bd = q.R;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (hit.indexOf(e) >= 0 || (e.heavy && e.cracked && e.armorT > 0)) continue;
      const d = wdist(e.x, e.y, x, y);
      if (d < bd) { bd = d; b = j; }
    }
    if (b < 0) break;
    const e = enemies[b];
    x += wdelta(e.x - x); y += wdelta(e.y - y);
    pts.push(x, y);
    hit.push(e);
    cardHit(b, 'chain');
  }
  if (pts.length > 2) zaps.push({ pts: pts, life: 0.16, max: 0.16 });
}

// 余震：原地炸一圈（不伤主角）
function runQuake(q) {
  const c = CARD_MAP.quake.c;
  rings.push({ x: q.x, y: q.y, r0: q.r * 0.3, r1: q.r * 1.1, life: 0.26, max: 0.26, color: c, w: 4 });
  for (let k = 0; k < 8; k++) {
    const a = rand(0, Math.PI * 2), s = q.r * rand(2.5, 4);
    parts.push({ x: q.x, y: q.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                 life: rand(0.15, 0.3), max: 0.3, r: rand(1.2, 2.4), c: k % 3 ? c : '#ffffff' });
  }
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (wdist(e.x, e.y, q.x, q.y) <= q.r + e.r) cardHit(j, 'quake');
  }
}

// 围观：刀前面 pullAhead 处是"焦点"，一圈里的怪都往那儿凑、看呆一会儿（看呆时撞不死人，见 update 碰撞）。
// 凑成一团，下一刀直线穿过去就是一串
function runPull(q) {
  const L = clv('pull'), R = CD.pullR[L];
  const cx = q.x + P.dx * CD.pullAhead, cy = q.y + P.dy * CD.pullAhead;
  let n = 0;
  for (let j = 0; j < enemies.length; j++) {
    const e = enemies[j];
    if (Math.hypot(wdelta(cx - e.x), wdelta(cy - e.y)) > R) continue;
    const a = rand(0, Math.PI * 2), s = rand(0, 26);
    e.stun = CD.pullT[L];
    e.gx = wwrap(cx + Math.cos(a) * s); e.gy = wwrap(cy + Math.sin(a) * s);
    if (e.charger) { e.mode = 'walk'; e.t = 0; }       // 冲锋者蓄力 / 冲到一半也停下来看
    n++;
  }
  if (n) rings.push({ x: cx, y: cy, r0: R, r1: 16, life: 0.3, max: 0.3, color: CARD_MAP.pull.c, w: 2.5 });
}

// 残影：这一刀的刀路（冲刺中每帧往后接，update 里调），过 echoT 秒再割一遍
function trackEcho() {
  const L = clv('echo');
  let m = echoes.length ? echoes[echoes.length - 1] : null;
  if (!m || m.seq !== dashSeq) {
    m = { seq: dashSeq, x0: P.px, y0: P.py, x1: P.x, y1: P.y, t: CD.echoT, n: CD.echoN[L], w: CD.echoW[L], fl: 0 };
    echoes.push(m);
    if (echoes.length > 10) echoes.shift();
  } else {
    m.x1 = m.x0 + wdelta(P.x - m.x0); m.y1 = m.y0 + wdelta(P.y - m.y0);
  }
}

// 飞刃：收刀那一下往前甩出去（满级三道，左右各偏一点）
function launchBlades() {
  const L = clv('blade'), n = CD.bladeN[L], a0 = Math.atan2(P.dy, P.dx);
  for (let k = 0; k < n; k++) {
    const a = a0 + (k - (n - 1) / 2) * 0.28;
    blades.push({ x: P.x, y: P.y, dx: Math.cos(a), dy: Math.sin(a), left: CD.bladeR[L], hits: CD.bladeHit[L], done: [] });
  }
  if (blades.length > 12) blades.splice(0, blades.length - 12);
}

// 每帧一次（update 末尾，剑气之后）：唱片、飞刃、残影走一步，再把这一帧攒下的连锁 / 余震 / 围观放掉
function tickCards(dt) {
  if (!CFG.cards) return;
  const ld = clv('disc');
  if (ld) {
    discA += CD.discW[ld] * dt;
    const n = CD.discN[ld], R = CD.discR[ld];
    for (let k = 0; k < n; k++) {
      const a = discA + k * Math.PI * 2 / n, x = P.x + Math.cos(a) * R, y = P.y + Math.sin(a) * R;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (wdist(e.x, e.y, x, y) <= e.r + CD.discHit) cardHit(j, 'disc');
      }
    }
  }

  for (let i = blades.length - 1; i >= 0; i--) {
    const b = blades[i];
    const st = Math.min(b.left, CD.bladeSp * dt);
    const x1 = b.x + b.dx * st, y1 = b.y + b.dy * st;
    for (let j = enemies.length - 1; j >= 0 && b.hits > 0; j--) {
      const e = enemies[j];
      if (b.done.indexOf(e) >= 0) continue;
      if (segDist(b.x, b.y, x1, y1, b.x + wdelta(e.x - b.x), b.y + wdelta(e.y - b.y)) > e.r + 14) continue;
      if (cardHit(j, 'blade')) { b.done.push(e); b.hits--; }
    }
    b.x = wwrap(x1); b.y = wwrap(y1); b.left -= st;
    if (b.left <= 0.5 || b.hits <= 0) blades.splice(i, 1);
  }

  for (let i = 0; i < echoes.length; i++) {
    const m = echoes[i];
    if (m.n <= 0) continue;
    m.t -= dt;
    if (m.t > 0) continue;
    const dx = m.x1 - m.x0, dy = m.y1 - m.y0;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (segDist(0, 0, dx, dy, wdelta(e.x - m.x0), wdelta(e.y - m.y0)) <= e.r + m.w / 2) cardHit(j, 'echo');
    }
    m.fl = 0.14;
    m.n--;
    m.t = CD.echoGap;
  }

  for (let guard = 0; cardQ.length && guard < 120; guard++) {
    const q = cardQ.shift();
    if (q.k === 'chain') runChain(q);
    else if (q.k === 'quake') runQuake(q);
    else runPull(q);
  }
  cardQ.length = 0;
}

// 只管画面的部分（updateFX 里调，死亡慢放时也接着褪）：电光、刀痕的亮
function tickCardFX(dt) {
  for (let i = zaps.length - 1; i >= 0; i--) {
    zaps[i].life -= dt;
    if (zaps[i].life <= 0) zaps.splice(i, 1);
  }
  for (let i = echoes.length - 1; i >= 0; i--) {
    const m = echoes[i];
    if (m.fl > 0) m.fl = Math.max(0, m.fl - dt);
    if (m.n <= 0 && m.fl <= 0) echoes.splice(i, 1);
  }
}

// 破门（breakLayer）：门炸开以后等一小会儿（让冲击波和"破门"横幅先出来）再弹三选一
function cardGate() {
  if (cardsOn() && cardsLeft().length) pickWait = 0.4;
}
// update 末尾调：等够了就弹
function checkHao(dt) {
  if (!cardsOn() || pickWait <= 0) return;
  pickWait -= dt;
  if (pickWait <= 0) openPick();
}

function openPick() {
  const pool = cardsLeft();
  if (!pool.length) return;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)), t = pool[i];
    pool[i] = pool[j]; pool[j] = t;
  }
  pick = { opts: pool.slice(0, 3), t: 0, chosen: -1, ct: 0 };
  state = 'pick';
  resetInput();          // 按着斩的那根手指不算数：回来要重新按
}

// 三选一时每帧（frameStep，真实时间）：点完那张亮一下再回局内
function tickPick(raw) {
  if (!pick) { state = 'play'; return; }
  pick.t += raw;
  if (pick.chosen >= 0) {
    pick.ct += raw;
    if (pick.ct >= 0.22) closePick();
  }
}

// 弹出来 0.4 秒内的点击不算：破门那一下手指多半正按着斩
function pickChoose(i) {
  if (!pick || pick.chosen >= 0 || pick.t < 0.4 || i < 0 || i >= pick.opts.length) return;
  pick.chosen = i; pick.ct = 0;
  S.upgrade();
  vibrate(1);
}

function pickTap(t) {
  if (!pick) return;
  const L = pickLayout();
  for (let i = 0; i < pick.opts.length; i++) {
    if (inRect(t, { x: L.x, y: L.ys[i], w: L.w, h: L.h })) { pickChoose(i); return; }
  }
}

function closePick() {
  const cd = pick.opts[pick.chosen];
  pick = null;
  state = 'play';
  const l = cardLv[cd.id] = clv(cd.id) + 1;
  runPicks.push([cd.id, l, Math.floor(gameTime)]);
  P.inv = Math.max(P.inv, 0.5);           // 回来先给一口气：手指还没放回去
  callout(cd.name + (l > 1 ? ' ' + l + '级' : ''), cd.c, 40, 120);
  rings.push({ x: P.x, y: P.y, r0: 20, r1: 200, life: 0.45, max: 0.45, color: cd.c, w: 5 });
  for (let i = 0; i < ULTS.length; i++) {
    const u = ULTS[i];
    if (ultOn[u.id]) continue;
    let full = true;
    for (let k = 0; k < u.need.length; k++) if (clv(u.need[k]) < 3) full = false;
    if (!full) continue;
    ultOn[u.id] = 1;
    pushBanner('奥义 · ' + u.name, u.brief, u.c);
    FB.flash = 1; FB.flashC = u.c; FB.flashT = 6;
    rings.push({ x: P.x, y: P.y, r0: 30, r1: 320, life: 0.7, max: 0.7, color: u.c, w: 8 });
    shake = Math.max(shake, 20);
    S.tierUp(6);
    vibrate(2);
  }
}


/* =========================================================
   2.10 开场：背景故事
   ---------------------------------------------------------
   只做无尽模式，故事只当背景（用户定的："嘉豪要救嘉欣，完事了"）：晚自习停电，嘉欣被"卷潮"卷到了最深处，
   嘉豪往下斩去救她 —— 越往下越接近她。每次从主界面开一局都先放这几句，可以跳过；
   结算页「再来一局」直接开打，不再放（死了马上重来的节奏不能断）。
   人像先画剪影；美工交了立绘，把文件名写进 ART_FILES 就换成图（见 artImg）
   ========================================================= */
// [谁, 这句话]；谁见 TALKERS（'nar' = 旁白：没有人像，字压在屏幕中间）
const INTRO = [
  ['nar', '那一夜，晚自习停电了。'],
  ['class', '耶——！！！'],
  ['zihan', '嘉豪，嘉欣呢？刚才还坐你后面。'],
  ['nar', '她被卷走了，卷到了最深处。'],
  ['jiahao', '事情，开始变得有趣起来了。']
];
// 黑潮的开场剧情（用户："玩家是体育生，怪物是嘉豪，然后女朋友嘉欣被嘉豪给吸引走了，体育生打嘉豪们，要追回女朋友嘉欣"；
// "最好你可以开局做个剧情，嘉欣被嘉豪吸引走了，然后体育生发怒要追回嘉欣"；游戏名还是嘉豪斩）。
// 主界面点「开始」才放（「再来一局」不放），右上角可以跳过；说完接着开打（hStartFlow）
const INTRO_H = [
  ['nar', '晚自习下课，操场边。'],
  ['jiaxin', '体育生，我去小卖部买瓶水，等我哦～'],
  ['nar', '走廊里涌出来一大群一身纯黑的人。'],
  ['jiahao', '就很……你懂吧。'],
  ['jiaxin', '哇……好帅。'],
  ['nar', '嘉欣被嘉豪们吸引走了。'],
  ['tiyu', '嘉欣！！！今天谁也别想拦我！']
];
// 说话的人：名字、代表色（名字签 / 剪影描边）、站哪边、立绘文件（见 ART_FILES）
const TALKERS = {
  nar:    { name: '旁白' },
  jiahao: { name: '嘉豪', c: '#9aa3b5', side: 'R', art: 'portrait/jiahao_cool' },
  zihan:  { name: '子涵', c: '#ffd166', side: 'R', art: 'portrait/zihan_meh' },
  class:  { name: '全班', c: '#bfefff', side: 'R' },
  tiyu:   { name: '体育生', c: '#4df7ff', side: 'L', art: 'portrait/tiyu' },
  jiaxin: { name: '嘉欣', c: '#ff7ac8', side: 'R', art: 'portrait/jiaxin' }
};
const TALK_CPS = 24;          // 对话打字速度：每秒几个字

let talk = null;              // 对话：{ lines, i 第几句, t 这一句出来多久（真实秒）, then 说完做什么, key 测试数据里记成哪段 }

// 主界面开一局（点「开始」/ 点屏幕 / 空格回车）：照常开局，先放开场，说完（或跳过）再开打
function startFromMenu() {
  start();
  openTalk(INTRO, '开场', function () { state = 'play'; last = 0; });
}

/* ---------- 对话 ----------
   一句一句往外打字；点一下：字没打完先全显示，打完了换下一句。右上角「跳过」直接说完。
   测试数据记每段对话打开 / 看完 / 跳过几次、平均第几句跳的 —— 看大家到底看不看剧情 */
function openTalk(lines, key, then) {
  talk = { lines: lines, i: 0, t: 0, then: then, key: key };
  state = 'talk';
  resetInput();
  testTalk(key, 0);
}
function talkSkipBtn() { return { x: W_CSS - 96, y: readyTopY(), w: 80, h: 34 }; }
function talkShown() { return Math.floor(talk.t * TALK_CPS); }
function talkTap(t) {
  if (!talk) return;
  if (inRect(t, talkSkipBtn())) { testTalk(talk.key, 1, talk.i); talkEnd(); return; }
  talkNext();
}
function talkNext() {
  if (!talk || talk.t < 0.12) return;            // 防连点：上一句的那一下别把这一句也点过去
  const n = Array.from(talk.lines[talk.i][1]).length;
  if (talkShown() < n) { talk.t = n / TALK_CPS + 0.12; return; }
  talk.i++;
  talk.t = 0;
  if (talk.i >= talk.lines.length) { testTalk(talk.key, 2); talkEnd(); }
}
function talkEnd() {
  const then = talk.then;
  talk = null;
  then();
}
function tickTalk(raw) { if (talk) talk.t += raw; }

/* =========================================================
   2.11 光会灭：跟着嘉欣的糖往下走
   ---------------------------------------------------------
   以前"该干什么"说不清：站着按死斩就能活很久 —— 怪会自己冲过来送（实测站桩每秒斩 6 只）。
   现在（用户选的 B 方案）：身边的光一直在灭，越深灭得越快；斩怪不补光，只有捡到嘉欣撒的糖才补。
   糖连成一条弯路，路的尽头是这一层的门：碰到门就斩开它，进下一层（以前是"斩够几只、待够几秒"）。
   一句话：跟着糖往下走，斩开挡路的怪。光灭了 = 被卷潮吞了（死因"光灭了"，光盾挡不住）。
   只亮出前面 candyShow 颗，快到头了门才出来；下一颗在屏幕外时，屏幕边上有箭头指着。
   新手教学里光照样变小但不会灭；挑刀诀 / 暂停 / 开场对话时世界停着，光也不掉
   ========================================================= */
const CANDY_C = '#ff7ac8';    // 糖的颜色：嘉欣的粉
let lightL = 1;               // 光：1 满，0 灭
let lightWarn = false;        // 已经报过"光快灭了"（回到警戒线以上才重新报）
let lightTickT = 0;           // 快灭时滴答的间隔
let candies = [];             // 这一层的糖：{ x, y, i 第几颗（从入口往门数） }，捡掉就删
let candyNext = 0;            // 下一颗该捡第几颗（捡了更远的，前面漏下的就不再指）
let door = null;              // 这一层的门：{ x, y, n 路上一共几颗糖, t 出现了多久 }
let runCandy = 0;             // 这一局捡了几颗（测试数据）

// 第 n 层的光每秒掉多少
function lightDrain(n) { return 1 / Math.max(CFG.lightMinT, CFG.lightT0 - CFG.lightTStep * (n - 1)); }
function trailN(n) { return Math.min(CFG.trailNMax, CFG.trailN0 + CFG.trailNStep * (n - 1)); }

// 进一层（开局、破门；教学那两步）：从主角脚下往随机一个方向，一颗一颗往前摆，每颗拐一点点，最后是门
function buildTrail(n) {
  n = n || trailN(layer);
  let a = rand(0, Math.PI * 2), x = P.x, y = P.y;
  const step = function () {
    a += rand(-CFG.trailTurn, CFG.trailTurn);
    x += Math.cos(a) * CFG.candyGap;
    y += Math.sin(a) * CFG.candyGap;
  };
  candies = [];
  for (let i = 0; i < n; i++) { step(); candies.push({ x: wwrap(x), y: wwrap(y), i: i }); }
  step();
  door = { x: wwrap(x), y: wwrap(y), n: n, t: 0 };
  candyNext = 0;
}
// 亮着的糖：下一颗往前 candyShow 颗（往回留两颗：刚冲过头的还能回去捡）；门在这个范围里才出来
function candyOn(c) { return c.i >= candyNext - 2 && c.i <= candyNext + CFG.candyShow; }
function doorOn() { return !!door && candyNext + CFG.candyShow >= door.n; }
// 箭头指的：下一颗糖；后面没糖了就指门
function lightTarget() {
  let b = null;
  for (let i = 0; i < candies.length; i++) {
    const c = candies[i];
    if (c.i >= candyNext && (!b || c.i < b.i)) b = c;
  }
  return b || (doorOn() ? door : null);
}

// 每帧（update 里，破门判定原来的位置）：光往下掉、捡糖、碰门
function tickLight(dt) {
  lightL -= lightDrain(layer) * dt;
  if (tutOn()) lightL = Math.max(lightL, CFG.lightTutMin);
  // 捡糖：冲刺一帧能走几十，按这一帧走过的线段算，不会穿过去
  for (let i = candies.length - 1; i >= 0; i--) {
    const c = candies[i];
    if (!candyOn(c)) continue;
    const cx = P.x + wdelta(c.x - P.x), cy = P.y + wdelta(c.y - P.y);
    if (segDist(P.px, P.py, P.x, P.y, cx, cy) > P.r + CFG.candyR) continue;
    candies.splice(i, 1);
    eatCandy(c, cx, cy);
  }
  if (doorOn() && !gateHeld()) {
    door.t += dt;
    const dx = P.x + wdelta(door.x - P.x), dy = P.y + wdelta(door.y - P.y);
    if (segDist(P.px, P.py, P.x, P.y, dx, dy) <= P.r + CFG.doorR) {
      rings.push({ x: dx, y: dy, r0: 20, r1: 160, life: 0.5, max: 0.5, color: UI.gold, w: 6 });
      breakLayer();
      return;
    }
  }
  if (lightL < CFG.lightLow) {
    if (!lightWarn) { lightWarn = true; callout('光快灭了！', '#ff9a5c', 34, 90); vibrate(1); }
    lightTickT -= dt;
    if (lightL < CFG.lightLow * 0.6 && lightTickT <= 0) { S.tick(1); lightTickT = 0.45; }
  } else if (lightL > CFG.lightLow + 0.1) lightWarn = false;
  if (lightL <= 0) {
    lightL = 0;
    if (!testGod()) { shield = 0; die('光灭了'); }     // 光盾挡得住怪，挡不住卷潮
  }
}
function eatCandy(c, x, y) {
  lightL = Math.min(1, lightL + CFG.candyGain);
  runCandy++;
  if (c.i >= candyNext) candyNext = c.i + 1;
  rings.push({ x: x, y: y, r0: 6, r1: 44, life: 0.3, max: 0.3, color: CANDY_C, w: 2.5 });
  for (let k = 0; k < 5; k++) {
    const a = rand(0, Math.PI * 2), sp = rand(80, 200);
    parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.35), max: 0.35, r: rand(1.2, 2.2), c: k % 2 ? CANDY_C : '#ffffff' });
  }
  S.tick(0.25);
}

/* =========================================================
   2.12 黑潮（试玩）
   ---------------------------------------------------------
   用户的想法："怪物庞大的数量本身就是黑潮。玩家上来就狂砍身后的怪物群，砍不完的，必须朝着一个方向逃跑；
   攒怒气到了连斩线，就可以把身后的怪物群全连斩掉。"方向定了往上（"必须往上，手要在下面控制"）。
   · 黑潮从下面追上来：一大片怪，碰到就被吞。越追越快；甩得太远它会加速追上来（甩不掉）
   · 往上逃：前面零星有怪挡路（一只、一对、一排、一串斜线；第 2 波起有爆裂者，第 3 波起有重型），斩开往上冲
   · 平时没有连斩：点一下「斩」斩一刀（不推摇杆 = 往前斩），按住不会自己接；斩中了马上能斩下一刀
   · 回头砍黑潮的边：斩一只、往回一弹；砍不完 —— 后面的马上补上来
   · 斩怪攒怒气（斩黑潮的边攒得更多），满了「连斩」亮起：点它，时间几乎停住，嘉豪回头来回斩穿整片黑潮，
     回到原地收刀，剩下的全炸。清掉一波 = 下一波（更多、更快）
   · 纪录：往上逃了多少米
   黑潮里的怪不进 enemies：一百多只要几笔画完（drawHorde），单独走一套（horde）；挡路的怪还是普通的怪。
   别的系统（教学、开场、契约、晶柱、技能、刀诀、光 / 糖 / 门、层特性、复活）在这个模式里都不跑；
   主界面「黑潮 · 试玩」进，正式玩法一点不动
   ========================================================= */
const HD = {
  cols: 13,             // 黑潮横着分几列：每列从前往后排成一串，前面的死了后面的往前补
  gap: 34,              // 一列里前后隔多远（单双列错开半排）
  adv: 170,             // 往前补位的速度（相对潮头）
  // 铺满身后（用户："下面的怪物无数……能不能让他铺满玩家的身后"）：每列从潮头一直排到屏幕底边外 fillPad，
  // 看上去身后全是、无穷无尽；看不见的更深处不养，潮头往前压、屏幕里露出来多少就在屏幕外补多少（砍不完）
  minRows: 4,           // 潮头还在屏幕外时，每列至少留几只
  fillPad: 70,
  // 样子（用户："黑潮的怪物效果太差了"——一格一格的圆圈像波点）：改成一片涌上来的墨潮。
  // 潮面是一整片黑，边上起伏、时不时伸出几根墨刺，镶一道暗红的光；墨里全是一对对发红的眼睛（忽明忽灭）；
  // 只有最前面 frontRows 排是一只只的怪（跟挡路的同一个样子：软体 + 红边 + 红芯），斩得到、碰到就死的就是它们，
  // 后排的淹在墨里，前面的死了就从墨里钻出来补上
  frontRows: 2,
  inkEdge: 0.8,         // 潮面在潮头后面几排：最前排的怪半个身子露在墨外，后面的都淹在墨里
  // 用户："黑潮一旦进入视野就很明显掉帧"：以前墨占半屏时那一半画三层 —— 地面、整片墨、几乎全透明的眼睛图。
  // 现在潮面往下 inkSolid 以后只贴眼睛图（连墨底 inkTileC 一起烤成不透明的），下面的地面也不画；
  // 潮边那一条照旧 inkC 半透明一笔（前排淹进墨里的怪还隐约看得见）
  inkC: 'rgba(6,2,9,0.95)', inkTileC: 'rgb(6,2,9)',
  inkSolid: 30,         // 潮面往下多远起整片都是墨：潮面最深只起伏到 15 × 1.9（猛涌），再留点余量
  eyeTileRows: 8,       // 墨里的眼睛预先画成 8 排高的贴图（两张交替淡入淡出 = 眨眼），一屏贴三四块
  // 走路：用户试完"玩家移动速度太快"（正式玩法 430）。潮速跟着压下来，后面几波照样比走路快、得斩着往上冲
  walk: 320, accel: 2300,   // 1024.1100 时实际走 624（见 stepPlayer 的老毛病），现在真的是 320
  // 斩 = 闪现（用户："玩家斩等于是给自己一个闪现……一直不斩，怪物潮就会慢慢追上来，必须一直斩和怪物潮拉开距离"）：
  // 潮比走路快一点，光走会被慢慢追上；斩一刀往前闪一截（一刀约 200，比潮 0.15 秒走的远得多），一直斩才拉得开
  // 用户："黑潮速度太慢"：起步 390（光走约 9 秒被追上）。
  // 分波按往上逃了多远（用户同意"每往上逃一段算下一波，放不放连斩都一样往前推"）：每 waveM 米一波，每波快 vWave，最快 600。
  // 以前只有放连斩才进下一波，而且放连斩会把"这一波里越来越快"清零 —— 等于放连斩反而变简单
  // 整体节奏（用户："是不是应该黑潮提速了，玩家的移速和怪物的移速也提升"）：每进一波，嘉豪跑步 / 往前闪、挡路的走路 /
  // 冲锋者冲刺都快 tempo，最多 tempoMax 倍（约第 9 波封顶）。黑潮 = v0 × 同样的倍数，再每波 +vWave：比整体快得多一点，
  // 越往后越紧（第 1 波是走路的 1.22 倍，第 9 波约 1.5 倍）。只按每波加固定值的话，人一起变快以后黑潮反而显得慢了
  v0: 390, vWave: 15, vMax: 700, waveM: 200,   // 走路 320
  tempo: 0.05, tempoMax: 1.4,
  // 拉开的距离（像滑雪大冒险的雪崩）：
  // 用户先说"这个距离有一个限度……只要停止斩，怪物就出现在屏幕内……最多就这么远"，
  // 又说"黑潮一直在视野内，这不行……如果玩家跑的特别快，那么黑潮可以离开视线一部分时间"。
  // - 在屏幕里：按潮速走（比走路快一点）。
  // - 离你超过 catchFromK × 到底边的距离：每远 1 就快 catchK，最多快 catchMax。
  //   一路斩上去，它多半贴在屏幕最下面；斩得特别快才甩得出屏幕，一慢下来就慢慢涌回来（走着约两秒，站着约一秒多）。
  // - 最远就是屏幕底边外 offMax，再远就被你拖着走。
  // 开始加速追的地方按屏幕算：主角挪到屏幕不到六成以后，身后空了四成，以前固定"离底边 140"让黑潮多半待在屏幕外（机器人 70%），
  // 压迫感没了。现在离你超过 catchFromK × 主角到底边的距离就开始追：多半露在屏幕下半截
  offMax: 700, catchFromK: 0.55, catchK: 0.8, catchMax: 420,
  // 新一波（用户："连斩之后马上后面怪物又上来了，几乎是瞬间……没有一个缓冲的余地"）：从屏幕底边外 back 涌上来，
  // 头 calm 秒只按潮速的 calmK 走、也不加速追（喘口气：站着不动也要三四秒才进屏幕）
  back: 650, calm: 3, calmK: 0.35,
  lungeR: 340, lungeX: 170, lunge: 150,   // 你离潮头不到 340：正下方那几列往前扑，最多扑出 150
  recoil: 460, recoilInv: 0.2,             // 斩了黑潮里的一只：往回弹多快、弹的时候无敌多久
  overrunInv: 0.5,                         // 无敌只剩这么点（一刀带的、往回弹的）：潮头漫过你照样算被追上（见 updateHorde 碰黑潮）
  // 连斩多久不斩就断（用户："连斩的判定时间要延长一点，现在不能一键连斩了"）：只能一刀一刀点，正式玩法的 1.4 秒太紧
  comboWindow: 2.4,
  nibbleCd: 0.35,       // 斩了黑潮里的一只，隔这么久才能再点（不然钻进黑潮里一直狂点，刀刀无敌，死不了）
  // 点空（用户："左手点右手是不是可以无限切"：不看屏幕左右轮流狂点，跟看准了点差不多）：点了灰着的那一边（没东西可斩），
  // 松手以后两把斩都停 whiffCd 秒；按住超过 whiffTap 秒才松的是按住走，不算。
  // 用户又说"有了惩罚之后，手感差了好多"、选了"只罚狂点"：偶尔点错一下不罚，whiffWin 秒里点空第二次才停
  whiffCd: 0.3, whiffTap: 0.2, whiffWin: 0.5,
  // 辅助瞄准（用户："瞄准不便，需要辅助瞄准"）：点「斩」时摇杆方向左右 aimDeg 度以内（整个前半边）、aimR 以内的都能锁上
  // （正式玩法 45° / 175）；冲过去的路上跟着目标拐（它在走也砍得到）。身后的不锁：斩是往前闪，回头砍等于往黑潮里送
  // 用户又说"现在完全不需要用反应和判断，只要不断按斩就行了"：前半边全锁太宽，收到左右 65°（还是比正式玩法 45° 宽），
  // 得把摇杆往要斩的那只推一推
  // 用户又说"默认的斩范围稍微小了点，需要扩大一点"：240 → 280（黑板尺照旧翻倍：560）
  // 点空要罚停（whiffCd）以后用户说"现在手感非常奇怪……斩杀判定范围，占横向屏幕的70%吧"：280 → 315，
  // 左右两边斜前方 sideMax° 合起来横着 2 × 315 × sin60° ≈ 546 = 竖屏世界宽 780 的 70%（以前 62%；黑板尺翻倍 630）
  aimR: 315, aimDeg: 65,
  rage: { foe: 3, heavy: 6, horde: 3, blast: 1 },    // 斩一只攒多少怒气（满 100，一路斩上去约 15~20 秒一满）：挡路的 / 重型 / 黑潮的边 / 炸死的黑潮
  // 刷怪（用户："现在容易出现真空期，想个办法修改下刷新机制"）。机器人量出来以前每分钟 3~5 次干跑一秒多（最长两三秒），原因三条：
  // 1) 每往上走 250~330 摆一组、量的是这一组的底：一串斜线本身就高 250~500，一会儿挤成一堆、一会儿断一大截。
  //    现在从上一组最靠前那只往上隔 blockGap 才摆下一组（越往后越密）。总的怪数跟以前差不多，只是不扎堆、不断档
  // 2) 场上最多 blockMax 只，以前身后跑过去还没被吞的也占着，黑潮落在后面时一局约五分之一的组被跳过。
  //    现在掉出屏幕底边的直接收掉；满了这一组等一等再摆，不跳过
  // 3) 斩只往斜前方，横着只够得着左右约 208，可怪摆满整条走廊（左右 320），人一被斩到一边，另一边的怪一辈子锁不上，
  //    长时间干跑八成是这样。现在只摆在中间左右 blockHalf 以内
  blockGap: [150, 210], blockHalf: 240,
  blockMax: 22,
  // 兜底：还是有 fillWait 秒没东西可斩（不在冲刺里），斜前方一刀 + 90 以内也没有马上要进来的，就在前面一刀外
  // （aimR + 30~80）长出一只慢吞吞的，人贴着一边时长在靠中间那一侧（顺便把人带回来）。机器人一分钟冒 5~8 只，最长干跑不到一秒
  fillWait: 0.45,
  // 路线（用户："刷怪机制也得改，搞成就是让玩家明确跟着怪物斩杀，然后往上走，不要现在这样随机生成，有的时候多个让玩家判断不了。
  // 就让玩家明确就得跟着怪物打。就是往左，往右"；选了"看得到后面几步""先只放普通小怪"）：不再一组组随机摆（上面 hBlock 那套只在 path 关掉时用），
  // 怪一只接一只摆成一条往上的路：每一只在上一只的左前或右前（偏多少、隔多远见 H_FORMS），不摆正前方 —— 每一步只有"点左"或"点右"一个答案。
  // 只有路线（pathMix 关掉）时：只有路上的下一只（hPathHead）锁得上（锁上了有准星）；道具也是路上的一步，嘉欣糖摆在两步中间的路上。
  // 用户又说"怎么现在定住不动了？我要的怪物是动的！而且怎么怪物都黑了！根本看不清"：路上的怪会走，后面几步也不再画暗（以前暗到 0.38，黑底上看不见）。
  // 路只在中间左右 pathHalf 以内拐
  // 用户试了说"不行，现在怪物太分散了"，接着说"要不这样，就还是可以有其他的怪，但是要给留出一条能看出来是能直接砍上去的路"：
  // pathMix —— 以前那套一组组随机摆（hBlock，重型 / 冲锋者 / 爆裂者都在）照旧，另外摆这一条路：
  //   随机摆的怪离路 pathClear 以内的不摆（爆裂者离 bombR + 30 以内不摆），给路留出一条道；路往前多摆 pathLead（屏幕顶外），随机的才知道躲哪；
  //   路上只有小怪（不放糖、道具：糖、道具照以前 hSpawnProps 随机撒）；
  //   锁：贴脸的先斩 → 道具 → 路上的下一只（点它那一边就顺着路斩）→ 糖 → 最前面的（点另一边照以前斩别的）。
  // 用户又说"我指的不是放个线，把路放出来，是怪物组成不同的队形拼出来"：不画线了，路由一段段队形拼成（H_FORMS：斜线 / 之字 / 台阶 / 弧），
  //   段里间隔、角度都一样，一看就是排好的阵；段和段之间多隔 pathGap，看得出是两个阵拼起来的（还是一刀够得着）。
  //   段里每两步正中间再站一只（hPathMid：不锁它、不算贴脸先斩，斩过去顺手斩掉，一刀两只）—— 一只只隔 200 多看不出队形，隔 100 才连成形。
  //   路上的怪整队往下压（朝你这边），一段一个速度 —— 走着队形也不散（各自朝你走的话越走越歪）。
  // 路跟丢了（下一只 fillWait 秒都不在、也不会马上进斜前方）：剩下的路散掉，从你身前重新摆（hPathLostT）
  path: true, pathMix: true, pathHalf: 250, path0: 40, pathGap: 25, pathClear: 110, pathLead: 300,
  m: 40,                // 多少世界单位算 1 米
  burstSp: 5000,        // 回头连斩冲多快（扫一整屏深的黑潮再回来，约一秒半）
  burstSlow: 0.08,      // 连斩时别的东西慢到几成
  burstR: 72,           // 连斩刀路两边多宽都斩
  burstLegs: 5,         // 来回扫几趟（黑潮铺得深就扫 6 趟）
  // 主角在屏幕正中往下多少（占屏高）。用户先要"偏后，大概在屏幕三七分"（0.2），
  // 又说"再往前挪一些，现在这个位置正好是手放着的位置"：0.08 —— 前面约六成，身后四成留给黑潮
  camY: 0.08,
  // 连斩清全屏以后（用户："连斩要斩就清全屏……刚用了连斩清了黑潮，结果没有怪物让他往前，那不就给玩家一种白斩了的感觉吗"）：
  // 前面马上冒出一串一刀接一刀斩得上去的怪（从身前 refill0 起、每级往上 refillStep、左右错开），再接着照常摆到屏幕顶
  // 第一只离身前 refill0（用户："连斩之后刷新的那个最近的怪物，容易直接撞上主角，让他生成的远一点"：170 → 280），
  // 这一串刚冒出来走得慢（refillSp）：往前推一下就够得着，不会自己扑到你身上
  refillN: 5, refill0: 280, refillStep: 150, refillSp: 30,
  // 爆裂者（用户："自爆的那个，玩家直接就往前斩了，根本就爆不到玩家"）：斩它不再穿过去，停在它身上，
  // 它 bombFuse 秒后炸、半径 bombR —— 斩之前得看好前面还有没有下一只能闪出去（或者赶紧往外走），不然就被炸死。
  // 炸开连周围的怪和黑潮一起炸
  // 半径 150：自动往上跑以后，斩完人还会被带着往前走半秒（约 140），圈小了自己就跑出去了
  bombFuse: 0.5, bombR: 150, bombStop: 8,
  bombFromM: 60,        // 前 60 米不出爆裂者（机器人不看退路，开局两秒就被炸死；新手多半也是）
  // 自动往上跑（用户："主角默认自动往上跑，只有玩家控制的时候才朝着不同方向"）：不碰屏幕就往上跑，拖动屏幕就往拖的方向
  autoRun: true,
  // 开场（用户："我要的开场是后面黑潮压过来，前面各种怪物占满，前后压迫然后主角全斩，之后开始往前跑"）：
  // 前后夹击 introClose 秒 —— 黑潮从屏幕底下压到身后 introBack，前面 introRows 排各种怪从屏幕顶上涌下来占满（第一排离你 introFront，
  // 一排隔 introRowGap）→ 嘉豪一个连斩，从近到远左右来回把前面这一片全斩穿（introSp 的速度，黑潮照常追）→
  // 停在最前面收刀（introHold 秒）→ 开始往前跑，黑潮在后面追。每局都放，不能跳过（用户："改成不能跳过"）：
  // 开场时点「斩」不出刀、点「连斩」没用；暂停照常；手指先按着拖也行，开场一完就照拖的方向跑
  // 连斩、收刀那一段黑潮只按潮速的 calmK 慢慢跟（不然斩着斩着就被贴上、开场一完就撞死），开场完了再慢一秒才正常追
  // 三条命（有人反馈"改成三条命，增加容错"）：撞到挡路的 / 被炸到 / 被黑潮追上都掉一条，最后一条没了才结束。
  // 掉一条：无敌 hitInv 秒（人一闪一闪）、身边 hitClearR 以内的挡路怪震飞、贴在身后的黑潮推回屏幕下面，屏幕四周闪红
  lives: 3, hitInv: 1.5, hitClearR: 220,
  tut: true,            // 第一局开场完了接着教（2.14 节）；测试里关掉
  preAd: true,          // 开局前问一下看不看广告带道具（hStartFlow）；测试里关掉
  story: true,          // 主界面点「开始」先放开场剧情（INTRO_H，可以跳过）；测试里关掉
  intro: true, introRows: 5, introCols: 5, introFront: 150, introRowGap: 130, introBack: 150,
  introClose: 1.1, introSp: 3200, introHold: 0.35,
  // 冲锋者：离你不到 chargeR 就站住蓄力 0.6 秒（一圈收紧的红环），然后照那个方向直冲 —— 趁它蓄力斩掉，或者躲开
  chargeR: 330,
  // 涌浪（用户："黑潮的压迫感不够"）：每隔 surgeEvery 秒，黑潮先憋 surgeTell 秒（潮边发亮、手机一震），
  // 再猛涌 surgeTime 秒（潮速 × surgeK，屏幕跟着抖）—— 看到潮边亮就得赶紧往前斩
  // 用户说"有点难了"：隔 6~9 → 8~12 秒、预警 0.8 → 1.2 秒、× 1.9 → 1.5（第 1 波一次多冲约 10 米 → 5 米）
  surgeEvery: [8, 12], surgeTell: 1.2, surgeTime: 1.1, surgeK: 1.5,
  // 预警（用户："涌浪要来的时候给个提示吧，也是别用文字直接，现在涌浪来都看不出来啥时候来"）：潮边发亮常在屏幕外看不见，
  // 再加屏幕底边一道红光 + 底部正中三个往上冒的箭头（drawSurgeWarn）。离憋还有 surgePre 秒就开始淡淡地亮
  surgePre: 2,
  // 势头（用户："现在玩家基本上就是无脑左右，不会判断"；"就按照你感觉最好的改"）。机器人量出来：无脑左右狂点比看准了点活得还长六七成
  // （狂点一秒 8 下从不停，冲得最快；罚停只罚连着点空两次）。现在罚的是速度、不卡操作（以前罚停太重，用户说"手感差了好多"）：
  // 斩中一只 +momHit；点空（点一下就松，按住走不算）−momWhiff；被班主任抓 −momCaught；掉命回到 momLife；
  // 能斩却停着超过 momIdle 秒，每秒掉 momDecay。势头 0~momMax，往前跑、往前闪都快 (1 + momK × 势头) 倍。
  // 嘉豪脚下一排 momMax 个小格（亮几格几档），升档白圈、掉档红圈；3 档以上屏幕两边有速度线
  mom: true, momMax: 5, momK: 0.12, momHit: 0.25, momWhiff: 1.5, momCaught: 1.5, momLife: 1, momIdle: 1, momDecay: 0.8,
  // 光快还拉不开（机器人：狂点的照样活到看准的七八成，死的几乎都是撞上杂兵）：势头 momRam 档以上撞上杂兵 / 冲锋者不死，
  // 直接撞飞，掉 momRamCost 档（爆裂者、重型撞不得）。看准了斩的人势头攒得住，就多一层保护；狂点的攒不起来。
  // 机器人（反应 0.25 秒，各 4 局）：看准了点 平均活 189 秒、势头约 3.5；无脑左右狂点 151 秒、势头约 1.7（没有势头时狂点 160~187、看准 ~100）
  momRam: 3, momRamCost: 1,
  // 提前按也算：闪的过程中按的斩键，落地以后 tapBuf 秒以内还算数，落地马上出刀（以前直接丢掉，人是凭节奏提前按的，常觉得"按了没反应"）
  tapBuf: 0.25,
  // 班主任（用户："干脆就叫班主任好了"；"班主任眼前不能打架之类的，我觉得可能更有创意"）：站在走廊边上，
  // 前面一道扇形视线（半径 teachR、半角 teachHalf°）左右慢慢扫（±teachSweep°，teachPeriod 秒一个来回）。
  // 人在视线里、或者要斩的那只在视线里，出刀就"当场被抓"：愣 teachStun 秒出不了刀（自动跑照旧），黑潮趁机往前扑 teachLunge。
  // 她本人斩不到、碰到也没事。第 teachFrom 秒以后才出，隔 teachEvery 米一个，每档难度近 teachHeat 米，最近 teachMin 米
  teachFrom: 60, teachEvery: 320, teachMin: 160, teachHeat: 60,
  teachR: 400, teachHalf: 22, teachSweep: 38, teachPeriod: 3.2,
  teachStun: 0.5, teachLunge: 260,
  // 越来越难（用户："难度就没有尽头，随着时间越来越难"；看准了点的一局活两三分钟；选了"队形越来越难""黑潮越追越近""紧一阵松一阵"）。
  // 以前只有前两分钟在涨（第 3 波怪种齐、第 8 波密度到顶、第 11 波潮速到顶），之后一直不变，反应 0.25 秒的机器人 5 分钟一条命不掉。
  // hDiffT = 真在跑的秒数（开场、教程、连斩里不算）。前 heat0 秒跟以前一样；之后 hHeat() 每分钟涨 1、不封顶，下面各项按它加码。
  // 机器人（3 条命，落地后隔多久点下一刀）：0.12 秒活约 150 秒、0.25 秒约 115 秒、0.45 秒约 70 秒（以前 0.25 秒 5 分钟一条命不掉）。
  // 1027 黑潮封顶（vMax、涌浪不过 vTop）以后：0.15 秒约 350 秒（6500 米，以前 120~140 秒）、0.25 秒约 180 秒（以前 116 秒）、0.35 秒 40~80 秒（死在杂兵上，没变）：
  heat0: 45,
  // 黑潮每档快 vHeat，但不超过 vMax（用户："玩到后面完全没法继续，黑潮追的速度都比连斩速度快了"）。
  // 以前不封顶：第 3 分钟 900 多、第 4 分钟上千，一直在斩也甩不开（机器人一直斩往上冲：反应 0.12 秒约 800、0.2 秒约 750、0.3 秒约 680）。
  // 现在难度只让它早点涨到 vMax（约第 1 分半），之后难的是下面这些：涌浪越来越勤、怒气越攒越慢、队形 / 特殊怪越来越多、纠错的越来越少
  vHeat: 100,
  offHeat: 0.3, offMin: 0.3,     // 能把黑潮甩开多远（offMax）：每档少三成，最少剩三成 —— 越往后黑潮越一直露在屏幕下面
  // 涌浪：每档隔得短四成（预警照旧 surgeTell）；冲多猛不再跟着涨（以前每档 +0.2、最猛 2.3 倍 = 1600 多，比连斩快一倍），
  // 而且再猛也不超过 vTop —— 一直斩的人（机器人反应 0.12 秒约 800）顶得住，一停下来就被追上。
  // 机器人量出来潮峰里 700 × 1.5 = 1050 的涌浪两秒一个，反应 0.15 ~ 0.25 秒的十次掉命九次死在这上面。
  // 涌浪越来越勤就是越往后越难的那一条：涌着的时间越来越多，平均潮速一点点逼近 vTop（不会超过）
  surgeHeat: 0.4, vTop: 800,
  // 能纠错的越来越少（用户："越到后面 能够给玩家纠错的怪物会减少，但是有个底线"；选了"两种都算""留一半"）：
  // 纠错的 = 路旁随机摆的（斩歪了还能斩它们接着走）+ 跟丢了从你身前重摆的路。hFixK() 从 1 每档少 fixHeat，最少 fixMin：
  // 随机摆的一组组隔开 ÷ hFixK()（第 45 秒起越来越稀，约 2 分半稀到一半）；跟丢了等 fillWait ÷ hFixK() 才重摆（0.45 → 0.9 秒；横着够不着的不等，见 lostQuick）。
  // 以前随机的越往后越密、名额越多（每档 +5，最多 34），正好反过来，去掉了；按波数变密只到第 4 波（约第 45 秒，跟上面接上）
  // 给路留的道也不再越来越窄（以前每档窄 clearHeat 20、最窄 50）：道窄了，离路太近、本来要跳过的随机怪都摆得下了，
  // 机器人量出来间隔拉开一倍，随机的反而从每百米 18 只多到 24 只
  fixHeat: 0.3, fixMin: 0.5, gapWaveMin: 0.82,
  // 路横着够不着了（用户："玩到大概3000多四千米左右的时候，会出现由于怪物中断而出现的根本没法和黑潮拉开距离"）：
  // 斩了路边的怪 / 糖被带到一边，路在另一边 —— 路上的怪只往下压、不横着走，你不按住走就永远够不着，等多久都是白等。
  // 以前照样等 fillWait ÷ hFixK()（后期 0.9 秒），机器人量出来 2500 米以后每千米干等 1.5~1.7 秒、0.5 秒以上的约一次，最长 1.3 秒。
  // 现在下一只横着偏出一刀能够到的宽度（一刀 × sin sideMax + 30），或者路上一只都不剩：lostQuick 秒就从你身前重摆。
  // 还在斜前方远处、压下来就够得着的，照旧等 fillWait ÷ hFixK()
  lostQuick: 0.15,
  kindHeat: 4,                   // 随机的里重型 / 冲锋者 / 爆裂者比例跟着涨，涨到第 4 档为止（再多就几乎没有小怪了）
  formHeat: 1, formMax: 3,       // 队形每档长一步，最多长 3 步（太长了左右放不下，照样截短）
  specHeat: 0.12, specMax: 0.45, // 队形里的怪换成爆裂者 / 重型 / 冲锋者的比例（hPathStep）
  zigAt: 30, stairAt: 60,        // 开头只有斜线、弧（一直点同一边），之字第 30 秒、台阶第 60 秒才出（要左右换着点）
  // 前期一条松散的路（用户画了张图："我希望前期是这样的，就是他是有一条路，但是这条路上的圈有些偏左有些偏右"；
  // 选了"前 60 秒""路旁留少量随机怪"）：前 trailUntil 秒不摆队形，路上一只接一只，每只在上一只的左前或右前，
  // 偏几度、隔多远都随机（trail.a / trail.d）；多半换边（flip），偏出中间 pull 就往回拐；两只中间不站怪。
  // 路旁随机的照摆，只是稀一半（trailRand）。过了 trailUntil 秒接着摆下面的队形
  trailUntil: 60, trailRand: 0.5,
  trail: { n: 6, a: [10, 38], d: [130, 230], flip: 0.6, pull: 120, first: 190 },
  // 队形的间隔（用户："现在怪物刷新的距离太一致了"；选了"按队形变"）：以前每段都隔 205~215，刀刀一个节奏。
  // 现在每段挑一档 —— 挤（× 0.75）/ 照旧 / 散（× 1.35，快够不着），不连着两段一样；同一段里还是等距，队形照样看得出来。
  // 机器人（反应 0.2 秒）顺着路一刀冲多远（中位）：照旧 150、散 215。挤的那段下一只太近，收刀后往前一跑就撞上
  // （cutGrace 里算斩到），所以是一路冲过去、隔一只点一下（中位 163）
  formGap: [0.75, 1, 1.35],
  // 潮峰（紧一阵松一阵）：从 peakFrom 秒起，每 peakEvery 秒的最后 peakLen 秒难度临时再加 peakK、涌浪一个接一个（隔 peakSurgeGap 秒）；
  // 冲过潮峰黑潮先慢下来（跟连斩完一样喘口气：hWaveT 从 0 算）。不弹字、不提示，就是怪更狠、潮边一直在亮
  peakFrom: 60, peakEvery: 40, peakLen: 10, peakK: 0.4, peakSurgeGap: 2,
  // 连斩：以前斩一路两三秒就攒满（路上一刀两只），放完黑潮退回屏幕外、头 calm 秒慢慢涌 —— 一直放一直安全，黑潮根本追不上。
  // 越往后怒气攒得越慢（每档 ÷ (1 + rageHeat × 档)）、放完喘口气的时间越短（每档少 calmHeat，最少剩 calmMin）
  rageHeat: 1, calmHeat: 0.25, calmMin: 0.3,
  // 掉一命喘口气：难度退回 hitEase 秒前、黑潮 hitCalm 秒慢慢涌不涌浪（以前黑潮推回屏幕下沿就接着全速追，后面几档两秒连掉两命）
  hitEase: 12, hitCalm: 3,
  closeShake: 0,        // 黑潮离你不到这么远：屏幕一直微微抖（原 230；用户嫌"振动太多看起来像掉帧"，关掉）
  // 收刀后 cutGrace 秒里碰到挡路的还算斩到（1025.1500 测试数据：4 次被杂兵撞死全在收刀后 0.08~0.17 秒 ——
  // 一刀停在目标身后 24，自动往上跑马上撞进同一排 / 同一串的下一只，人根本来不及反应）。只管挡路的，黑潮照旧
  cutGrace: 0.3,
  // 两把斩（用户："不要让玩家控制方向了，给玩家两个斩，左手的就让玩家偏向斩左边，右手斩就偏向右边……
  // 我们优先斩道具和糖然后剩下的就优先斩最前面的"，先试一试）：人一直自己往上跑，拖屏幕不管用了；
  // 左半屏点 = 左斩、右半屏点 = 右斩（两个角上画着斩键）。
  // 用户又说"我要的斩不要横着，你的判定应该是斜向最靠前的"：只往斜前方斩 —— 从正前方往这一边偏 sideMax° 以内
  // （再平就不锁，不会横着闪），往另一边偏 sideIn° 以内也算（正前方挡路的两边都斩得到）；够得着（hAimR，黑板尺两倍）。
  // 比的是顺着这一边 45° 斜线走了多远（斜着最靠前的）：先锁道具，再锁糖，都没有锁怪；黑潮的边不锁。
  // 鬼火冲的时候按住哪边就往哪边挪。false = 回到拖屏幕换方向 + 一个斩（见 hLock）
  twoBlades: true, sideMax: 60, sideIn: 10,
  // 左右各一个颜色（用户："用颜色去表示，不要用文字"）：左斩蓝、右斩黄 —— 斩键、准星、范围弧的两半都按这个上色。
  // 蓝 / 黄色弱也分得开，也不跟爆裂者的红、糖的粉撞
  sideC: ['#3aa8ff', '#ffc928'],
  // 按住走（用户："玩家如果一直按着左边的斩，那么主角就往左前方走，右边同样，让他有个能主动控制去找的功能"）：
  // 点一下照旧斩；按住就往那一边斜前方 steerDeg° 走，松手回到笔直往上；两边都按着 = 笔直。
  // 用户又说"为什么斜向移动不是实时的？有一个延迟？"：以前按住 0.15 秒才走、还要慢慢加速转过去，现在按下就走（steerHold 0）、
  // 不滑行的时候方向一帧就换过去（见 stepPlayer）
  steerHold: 0, steerDeg: 45,
  // 贴脸的先斩（用户："现在斩的是最远的对吧，但是有些怪物离得很近，你斩了最远的，正好屁股碰到后面那个"）：
  // 这一边斜前方 nearR 以内有怪，先斩最近的那只（排在道具、糖前面 —— 先保命），没有才按道具 → 糖 → 斜着最远的
  nearR: 150,
  // 土狼时间（试玩反馈："索敌切换的也太快了，搞得更难确认按下的效果了……如果当前范围内没有可斩击目标，攻击0.2秒前锁定的目标"）：
  // 机器人量出来两个准星一秒换 10 次左右，一半多锁不到 0.2 秒；照着看到的点下去，反应 0.2 秒的人每 6 刀、0.3 秒的人每 2 刀
  // 就有一刀砍的不是看到的那只（看到的那只还没点下去就偏出斜前方了、更远的进来把准星抢走了）。
  // 现在点下去斩这一边在 coyote ~ coyoteMin 秒前那一段里锁得最久的那只（人反应过来点的就是它；更新的还来不及看见）——
  // 它还活着、还在这一边的斜前方（跟平常锁一样，sideMax° 以内）、够得着就行；没有才斩现在锁的。砍错：0.2 秒的人 16% → 4%，0.3 秒的人 45% → 8%。
  // 以前偏出斜前方也算，用户说"由于这个土狼，他有几率会切到横向的怪物，反而影响了进度……切不到横向的怪物"：改成照样不斩横着的
  // 只往回看固定 0.2 秒那一刻：0.2 秒的人最准，可反应快的（0.15）反而更差（8% → 11%）；锁得最久的那只快的慢的都准。
  // 试过"锁上就不换"（准星粘住）：更糟 —— 粘住的那只越走越近，人还没点下去就被顺路撞死、跑到身后了
  coyote: 0.3, coyoteMin: 0.08,
  // 碰到怪只有身子前三分之一算（hBehind）：碰到的那一点在头的方向上投影 / r 要大于这个
  hurtFront: 1 / 3
};
let hordeMode = false;
let horde = [];           // 黑潮：{ c 第几列, x 世界 x, yb 在潮头后面多远（负 = 扑到了潮头前面）, r, wob }
const hCols = [];         // 每帧按列分好（复用，不每帧新建）
let hFront = 0;           // 潮头的世界 y（首尾相接：一律 wdelta 算远近）
let hV = 0;               // 潮速
let hWave = 1, hWaveT = 0;   // 第几波（按往上逃了多远）；这一片黑潮涌上来多久了（新开局 / 清屏后从 0 算，管喘口气）
let hDiffT = 0, hPeakWas = false;   // 真在跑了多少秒（越来越难按它算，HD.heat0）；上一帧是不是潮峰
let hRage = 0;            // 怒气 0~100
let hBurst = null;        // 正在回头连斩：{ pts 路点（世界坐标，跟主角同一圈）, k 下一个点, kills, end 收刀后过了多久（-1 = 还在斩）, boom }
let hClimb = 0, hTop = 0; // 往上走了多远（来回都算）；最高到过哪（米数、摆挡路的都按它）
let hNext = 0;            // hTop 到这儿再摆下一组挡路的
let hDryT = 0;            // 已经多久没东西可斩了（兜底，HD.fillWait）
// 路线（HD.path）：路上按顺序的每一步（怪 / 道具，都带 pth）；下一只；最后摆的那一步在哪；这一局路摆起来了没有；再隔几步摆糖
const hPath = [];
let hPathHead = null, hPathX = 0, hPathY = 0, hPathLive = false, hPathCandy = 0, hPathLostT = 0;   // hPathLostT：下一只已经多久不在斜前方了
const hPathMid = [];      // 队形里两步中间站的那几只（不在路上锁，斩过去顺手斩）
const hPathQ = [];        // 这一段队形还没摆的几步 { s 往哪边, a 偏几度, d 隔多远, sp 这一段的速度, f 第几段, k 什么队形 }
let hPathF = 0, hPathK = '', hPathGi = -1, hPathTs = 0;   // hPathTs：前期松散的路上一只往哪边（HD.trail）   // hPathGi：上一段挑的哪档间隔（HD.formGap，不连着两段一样）
let hPathN = 0, hPathSpec = 0;       // 路重摆以后摆了几步；还要隔几步才能再放特别的怪（hPathKind）   // 摆到第几段了；上一段是什么队形（不连着两段一样）
let hBestBurst = 0;       // 这一局一次连斩最多斩几只
let hRecoil = false;      // 这一刀斩到了黑潮：收刀往回弹
let hFull = false;        // 怒气满了报过没有
let hHitAt = -1e9;        // 黑潮成片死时，斩击声节流（真实毫秒）
let hX0 = 0;              // 走廊中线（世界 x）：走廊就是一屏宽
let hFps = 60, hFpsAt = 0;   // 屏幕上的帧数（左上，试玩看卡不卡）
let hAimExtra = -1;       // 这一刀冲到目标身后还要多走多远（-1 = 空挥，不跟着拐）
let hNibbleAt = -1e9;     // 上一次斩到黑潮里的那只是什么时候（局内时间）
let hAimT = null;         // 这一帧点「斩」会砍谁（没有 = 斩键灰着，点了不出刀）
let hAimTL = null, hAimTR = null;   // 两把斩（HD.twoBlades）：左斩 / 右斩这一帧会砍谁
// 两把斩：这一边准星最近几次换成了谁 { r 锁的谁（null = 没锁）, t 从什么时候（gameTime） }，旧的在前（土狼时间，HD.coyote）
const hLockLog = { '-1': [], '1': [] };
const hSideTouch = {};    // 两把斩：按着的手指 { s 哪半边（-1 左 / 1 右）, t 按下的时刻 }：按住往那边走、鬼火冲的时候往那边挪
let hPressSide = 0, hPressAt = -1e9;   // 刚按了哪边的斩键（按下去缩一下）
let hWhiffAt = -1e9;      // 上一次点空（两把斩点了灰着的那边、点一下就松）是什么时候（nowMs）：HD.whiffWin 里再点空才罚
let hLives = 3, hHurtT = 0;   // 还剩几条命；刚掉了一条，还在一闪一闪（秒）
let hIntro = null;        // 开场：{ t, phase 0 前后压上来 / 1 连斩 / 2 收刀, ring 前面那一片怪, pts 刀路, k, sx, sy 起点, f0 黑潮起点 }
const HUP = { x: 0, y: -1 };   // 自动往上跑的方向
// 不能往后走（用户："给玩家一个限制，不能往后走"）：往下拖只取左右那一份，差不多正下方（左右 15° 以内）= 站住（null）。
// 只管走路：「斩」照旧往拖的方向找目标（回头砍黑潮的边那一下砍完会弹回来，不算往后走）
function hNoBack(d) {
  if (!d || d.y <= 0) return d;
  return Math.abs(d.x) < 0.26 ? null : { x: d.x > 0 ? 1 : -1, y: 0 };
}
let hSurge = 0, hSurgeT = 0, hSurgeP = 0;   // 涌浪：0 没有 / 1 憋着（潮边发亮）/ 2 猛涌；离下一次还有几秒；这一段过了几秒

// 掉一条命：测试数据记一笔；无敌一会儿、身边的挡路怪震飞、贴在身后的黑潮推回屏幕下面（别刚掉一条紧接着又掉）
function hLoseLife(by) {
  hLives--;
  hqLoseLife();                                  // 任务：一条命不掉的从这儿重新算（2.15 节）
  hMom = Math.min(hMom, HD.momLife);             // 势头：掉回 1 档
  runDeaths.push([(by || '?') + '（掉一命，剩 ' + hLives + '）', layer, Math.floor(gameTime)].concat(deathInfo || []));
  deathInfo = null; deathMark = null;
  P.inv = HD.hitInv; hHurtT = HD.hitInv;
  P.dashT = 0; P.glideT = 0; P.dashLeft = Infinity; P.dashRef = null; hRecoil = false;
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (Math.hypot(e.x - P.x, wdelta(e.y - P.y)) < HD.hitClearR) hClearFoe(j);
  }
  const back = hBottomGap() * 0.8;
  if (hGap() < back) hFront = wwrap(P.y + back);
  hDiffT = Math.max(Math.min(hDiffT, HD.heat0), hDiffT - HD.hitEase);   // 喘口气（HD.hitEase）
  hWaveT = hCalm() - HD.hitCalm; hSurge = 0; hSurgeP = 0; hSurgeT = hSurgeGap();
  shake = 22; vibrate(3); S.thump(0.8);
  FB.flash = 1; FB.flashC = '#ff3a3a'; FB.flashT = 3;
  rings.push({ x: P.x, y: P.y, r0: 20, r1: HD.hitClearR, life: 0.4, max: 0.4, color: '#ff5a5a', w: 4 });
  if (hSkill('revenge') && !hBurst) hBurstGo(true);   // 复仇嘉豪：掉命就回头连斩一次，不用怒气（2.13 节）
}
// 黑潮一局结束：记最远几米 / 最高分，局数 +1（死了、暂停里结束都走这里）。
// 死了就先记（失败页上直接关掉游戏也不丢糖）；看广告复活以后再死只补差额：局数不重复加、糖和分只加多出来的那些
let hNewBest = false, hBest0 = 0, hSettled = null;    // 开局时的最远；这一局已经记进存档的 { candy, score }
function hSettle() {
  const m = Math.floor(hTop / HD.m), S0 = hSettled || { candy: 0, score: 0 };
  hNewBest = m > hBest0 && hBest0 > 0;
  if (m > meta.hBest) meta.hBest = m;
  if (score > meta.hScore) meta.hScore = score;
  const c = hCandyRun + hCandyBonus();
  meta.candy += c - S0.candy;               // 这一局捡的嘉欣糖（2.13 节）+ 嘉豪等级的加成（2.15 节）
  if (!hSettled) meta.runs += 1;
  meta.total += score - S0.score;
  hSettled = { candy: c, score: score };
  saveMeta();
  rkSync(true);                             // 破了纪录交排行榜，交完让开放数据域拿新名次（0.5 节）
}
function hCandyBonus() { return Math.floor(hCandyRun * HQ.candyLv * (hqLv0 - 1) + 1e-6); }   // 嘉豪等级多给的糖（2.15 节；+1e-6：50 × 0.2 算出来是 9.999…）

/* ---------- 看广告复活（用户："看广告复活这个功能要上线了"） ----------
   三条命都没了：失败页最上面一个金按钮「看广告 · 复活」，看完整条广告回到原地接着跑。用户没说的先这样：
   · 每局只能复活 reviveMax 次（不然一直看一直跑，最远纪录就没意义了）；回来是满命（lives 条）
   · 回来无敌 reviveInv 秒（人一闪一闪），身边 hitClearR 以内的挡路怪震飞，黑潮推回屏幕底边外 reviveBack，
     先慢慢涌 2 秒（喘口气）；怒气、连斩、道具照旧
   · 没看完 / 拉不到广告：回失败页，按钮还在 */
const H_REVIVE = { max: 1, inv: 2.5, back: 260 };
let hRevives = 0, hTestRec = null;        // 这一局复活了几次；死的时候记的那条测试数据（复活了就撤掉，等真正结束再记）
function hCanRevive() { return hRevives < H_REVIVE.max; }
function hRevive() {
  hRevives++; reviveCount++;
  if (hTestRec) { const i = TEST.runs.indexOf(hTestRec); if (i >= 0) TEST.runs.splice(i, 1); hTestRec = null; }
  state = 'play'; deadT = 0; hitstop = 0;
  hLives = hMaxLives();
  P.inv = H_REVIVE.inv; hHurtT = H_REVIVE.inv;
  P.dashT = 0; P.glideT = 0; P.dashLeft = Infinity; P.dashRef = null; P.cd = 0; P.vx = 0; P.vy = 0; hRecoil = false;
  deathMark = null; deathInfo = null;
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (Math.hypot(e.x - P.x, wdelta(e.y - P.y)) < HD.hitClearR) hClearFoe(j);
  }
  blasts.length = 0;
  if (hPathOn()) hPathStart();             // 路线：从你身前重新摆一条（身边那几步刚被清掉了）
  hFront = wwrap(P.y + hBottomGap() + H_REVIVE.back);
  hWaveT = hCalm() - 2; hSurge = 0; hSurgeP = 0; hSurgeT = hSurgeGap();
  rings.push({ x: P.x, y: P.y, r0: 14, r1: HD.hitClearR + 60, life: 0.55, max: 0.55, color: '#ffffff', w: 5 });
  floats.push({ x: P.x, y: P.y - 50, text: '体育生归来', life: 1.2, max: 1.2, size: 26 });
  shake = 22; S.hit(3); vibrate(2);
  S.heartStart();
}
// k：开局看广告挑的道具（2.13 节），开场一结束就生效；平常开局不传
function startHorde(k) {
  hStartProp = PROP_NAME[k] ? k : null;
  hordeMode = true;
  start();
  hBest0 = meta.hBest; hSettled = null; hRevives = 0; hTestRec = null;
  FB.best0 = meta.hScore;                   // 左上角"最高"、新纪录都按黑潮自己的
  enemies.length = 0; crystals.length = 0; candies = []; door = null; contract = null;
  shield = 0; layerFxT = 0; lightL = 1;
  hX0 = P.x; cam.x = hX0; cam.y = P.y - HD.camY * H;
  POW.comboWindow = HD.comboWindow;          // 开局 recalcPowers 会按正式玩法算回来，这里改成黑潮试玩的
  POW.dashSpeed = CFG.dashSpeed;             // 往前闪的速度跟着每波的节奏涨（见 hTempo）
  hWave = 1; layer = 1; hRage = 0; hBurst = null; hClimb = 0; hTop = 0; hNext = 200; hDryT = 0; hBestBurst = 0; hDiffT = 0; hPeakWas = false;
  hPath.length = 0; hPathHead = null; hPathLive = false; hPathCandy = hPathCandyGap(); hPathLostT = 0; hPathQ.length = 0; hPathMid.length = 0; hPathK = ''; hPathGi = -1; hPathTs = 0; hPathN = 0; hPathSpec = 0;
  hLives = hMaxLives(); hHurtT = 0; hDjN = 0;
  hRecoil = false; hFull = false; hHitAt = -1e9; hFps = 60; hFpsAt = 0; hAimExtra = -1; hNibbleAt = -1e9; hWhiffAt = -1e9; hAimT = null;
  hLockLog['-1'].length = 0; hLockLog['1'].length = 0; hSurge = 0; hSurgeP = 0; hSurgeT = hSurgeGap();
  hNewWave();
  hPropReset();                              // 道具、嘉欣糖（2.13 节）
  hqStart();                                 // 任务（2.15 节）
  bxUsed = 0;                                // 仓库道具这一局用了几个（2.16 节）
  hTeachReset(); hTapBuf = null;             // 班主任、提前按的那一下
  hMom = 0; hMomLastT = 0; hMomPop = null;   // 势头从 0 起
  hTutReset();                               // 新手教程（2.14 节）：第一局要教
  hEyeTile(0);                               // 墨里眼睛的贴图先画好，别等第一帧
  hIntro = null;
  if (HD.intro) hIntroStart();
  // 一上来前面就一路有得斩（有开场的话等开场完了再摆：开场那一片占着名额）；要教的话由教程现摆
  if (!HD.intro) {
    if (!hTutStart()) {
      if (HD.path) hPathStart();             // 路先摆（随机摆的要躲开它）
      if (!HD.path || HD.pathMix) for (let y = 230; y < 1030; y += 205) hBlock(P.y - y);
    }
    hUseStartProp();
  }
}

/* ---------- 开场：后面黑潮压过来、前面各种怪占满 → 一个连斩全斩穿 → 往前跑，黑潮在后面追 ---------- */
// 前面那一片：introRows 排 × introCols 只，排与排错开；多半是小怪，夹着爆裂者、冲锋者、重型（各种怪都露个脸）。
// 一开始都在屏幕顶上外面，前后夹击那 introClose 秒里涌下来站好
function hIntroStart() {
  enemies.length = 0;
  const ring = [], xl = hX0 - W / 2 + 70, xr = hX0 + W / 2 - 70;
  const kinds = { '1,1': 'bomb', '2,0': 'charger', '2,3': 'heavy', '3,2': 'bomb', '4,4': 'charger', '4,1': 'heavy' };
  for (let r = 0; r < HD.introRows; r++) {
    for (let c = 0; c < HD.introCols; c++) {
      const fx = xl + (xr - xl) * (c + (r % 2 ? 0.75 : 0.25)) / HD.introCols + rand(-18, 18);
      const fy = P.y - HD.introFront - HD.introRowGap * r + rand(-14, 14);
      const e = spawnEnemy(fx, wwrap(fy - H * 0.6 - r * 60), kinds[r + ',' + c] || 'grunt');
      if (!e) break;
      e.sp = 0; e.born = 1; e.fx = fx; e.fy = fy; e.sy0 = fy - H * 0.6 - r * 60; e.row = r;
      if (e.charger) e.t = 99;        // 开场里不蓄力
      ring.push(e);
    }
  }
  hIntro = { t: 0, phase: 0, ring: ring, pts: null, k: 0, sx: P.x, sy: P.y, f0: P.y + hBottomGap() + 120 };
  hFront = wwrap(hIntro.f0);
  P.inv = 1e9;
  S.thump(0.6);
}
function hIntroStep(dt) {
  const I = hIntro;
  I.t += dt;
  P.px = P.x; P.py = P.y;
  if (I.phase === 0) {
    // 前后压上来：黑潮从屏幕底下压到身后 introBack，前面那一片从屏幕顶上涌下来站好；越压越抖
    const k = easeOut(I.t / HD.introClose);
    hFront = wwrap(I.f0 + (I.sy + HD.introBack - I.f0) * k);
    for (let i = 0; i < I.ring.length; i++) {
      const e = I.ring[i];
      e.x = e.fx; e.y = wwrap(e.sy0 + (e.fy - e.sy0) * k);
      e.wob += dt * 4;
    }
    shake = Math.max(shake, 2 + 5 * k);
    if (I.t >= HD.introClose) {
      // 刀路：从近到远一排一排，左右来回（蛇形）把前面这一片全斩穿，停在最前面那只身后
      I.phase = 1; I.t = 0; I.k = 0; I.pts = [];
      for (let r = 0; r < HD.introRows; r++) {
        const row = I.ring.filter(function (e) { return e.row === r; }).sort(function (a, b) { return a.x - b.x; });
        if (r % 2 === (P.x > hX0 ? 0 : 1)) row.reverse();
        for (let i = 0; i < row.length; i++) I.pts.push(row[i].x, I.sy + wdelta(row[i].y - I.sy));
      }
      S.whoosh(); vibrate(1);
    }
    return;
  }
  if (I.phase === 1) {
    let left = HD.introSp * dt;
    while (left > 0 && I.k < I.pts.length) {
      const tx = I.pts[I.k], ty = I.pts[I.k + 1], dx = tx - P.x, dy = ty - P.y, d = Math.hypot(dx, dy);
      const st = Math.min(left, d), ux = d > 0 ? dx / d : P.dx, uy = d > 0 ? dy / d : P.dy;
      const x0 = P.x, y0 = P.y;
      P.x += ux * st; P.y += uy * st;
      P.dx = ux; P.dy = uy; P.ang = Math.atan2(uy, ux);
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (I.ring.indexOf(e) < 0) continue;
        if (segDist(x0, y0, P.x, P.y, e.x, P.y + wdelta(e.y - P.y)) <= e.r + P.r + 6) killEnemy(j, 'shield');   // 爆裂者炸了也不伤你
      }
      left -= st;
      if (st >= d - 0.01) I.k += 2;
    }
    P.dashT = 0.05;                        // 画成冲刺的样子
    ghosts.push({ x: P.x, y: P.y, r: P.r, a: P.ang, life: 0.26, max: 0.26 });
    trail.push({ x: P.x, y: P.y, life: 0.13, max: 0.13 });
    if (trail.length > 16) trail.shift();
    // 环形世界跨界：刀路、镜头跟着挪（同 hBurstStep）
    const jy = P.y - wwrap(P.y);
    if (jy) {
      P.y -= jy; P.py -= jy; cam.y -= jy; camLap.y += jy; I.sy -= jy;
      for (let q = 1; q < I.pts.length; q += 2) I.pts[q] -= jy;
    }
    if (I.k >= I.pts.length) {
      I.phase = 2; I.t = 0;
      P.dashT = 0; P.vx = 0; P.vy = 0; P.ang = -Math.PI / 2; P.dx = 0; P.dy = -1;
      shake = Math.max(shake, 14);
      rings.push({ x: P.x, y: P.y, r0: 20, r1: 260, life: 0.45, max: 0.45, color: UI.gold, w: 5 });
      rings.push({ x: P.x, y: P.y, r0: 10, r1: 150, life: 0.3, max: 0.3, color: '#ffffff', w: 2.5 });
      vibrate(2);
    }
    return;
  }
  if (I.t >= HD.introHold) hIntroEnd();
}
// 开场完了：黑潮还压在后面（连斩那一下它慢慢跟上来了），开始往前跑；再慢一秒才按潮速追
function hIntroEnd() {
  hIntro = null;
  P.inv = 0.6; P.dashT = 0;
  hWaveT = hCalm() - 1;
  if (!hTutStart()) hPathFill(P.y - 260);  // 斩完那一片，往前接着有得斩（第一局：接着教，要斩的东西由教程现摆，2.14 节）
  hUseStartProp();                          // 开局看广告挑的道具：现在生效（2.13 节）
}

function hColX(c) { return hX0 - W / 2 + (c + 0.5) * W / HD.cols; }
// 每列要排几只：从潮头一直排到屏幕底边外 fillPad（潮头还在屏幕外就只留 minRows）
function hRowsNeed() {
  const fy = P.y + hGap(), bottom = cam.y + H / 2 + HD.fillPad;
  return Math.max(HD.minRows, Math.ceil((bottom - fy) / HD.gap) + 1);
}
function hNewMember(c) {
  return { c: c, x: hColX(c) + rand(-0.3, 0.3) * W / HD.cols, yb: 0, oy: rand(-7, 7), r: rand(12, 16), wob: rand(0, 6.28) };
}
// 第 c 列第 j 只排在潮头后面多远：单双列错开半排，每只再错一点，不像在站队
function hRowY(c, j, m) { return j * HD.gap + (c % 2) * HD.gap * 0.5 + m.oy; }
// 新一波：整片从身后 HD.start 远的地方涌上来
function hNewWave() {
  horde.length = 0;
  hWaveT = 0;
  hFront = wwrap(P.y + hBottomGap() + HD.back);
  hSurge = 0; hSurgeP = 0; hSurgeT = hSurgeGap();
  const n = hRowsNeed();
  for (let c = 0; c < HD.cols; c++) {
    for (let j = 0; j < n; j++) { const m = hNewMember(c); m.yb = hRowY(c, j, m); horde.push(m); }
  }
}
function hMemberY(m) { return P.y + wdelta(hFront + m.yb - P.y); }   // 跟主角同一圈的世界 y
function hGap() { return wdelta(hFront - P.y); }                     // 潮头在你身后多远（正 = 在下面）
function hBottomGap() { return H / 2 - HD.camY * H; }             // 主角到屏幕底边多远
function hTempo() { return Math.min(HD.tempoMax, 1 + HD.tempo * (hWave - 1)); }   // 这一波整体快几倍
function hGapMax() { return hBottomGap() + HD.offMax * Math.max(HD.offMin, 1 - HD.offHeat * hHeat()); }   // 最远就这么远：屏幕底边外 offMax（越往后越近）
// 难度档（HD.heat0）：前 heat0 秒 0，之后每分钟 +1、不封顶；潮峰里再加 peakK
function hHeat() { return Math.max(0, hDiffT - HD.heat0) / 60 + (hPeak() ? HD.peakK : 0); }
// 新一波 / 连斩完 / 冲过潮峰：头几秒黑潮慢慢涌、不涌浪（越往后越短）
function hCalm() { return HD.calm * Math.max(HD.calmMin, 1 - HD.calmHeat * hHeat()); }
// 潮峰：从 peakFrom 秒起，每 peakEvery 秒的最后 peakLen 秒
function hPeak() {
  if (!hordeMode || hDiffT < HD.peakFrom) return false;
  return (hDiffT - HD.peakFrom) % HD.peakEvery >= HD.peakEvery - HD.peakLen;
}
// 下一次涌浪隔多久：越往后越勤；潮峰里一个接一个
function hSurgeGap() { return hPeak() ? HD.peakSurgeGap : rand(HD.surgeEvery[0], HD.surgeEvery[1]) / (1 + HD.surgeHeat * hHeat()); }
function byYb(a, b) { return a.yb - b.yb; }

// 黑潮往上涌：潮头按潮速走（比走路快一点），被甩出屏幕就加速追，最远不超过 hGapMax；每列最前面那只扑向你、后面的排好往前补位；
// 屏幕里露出来多少，就在屏幕底边外补多少（砍不完、看着无穷无尽），更深处多出来的收掉
function hTickHorde(dt) {
  hV = Math.min(HD.vMax, HD.v0 * hTempo() + HD.vWave * (hWave - 1) + HD.vHeat * hHeat());   // 难度档只让它早点到 vMax，不再往上涨（HD.vHeat）
  // 潮峰：一进来涌浪马上来；一出去先喘口气（hWaveT 从 0 算：慢慢涌、不涌浪）
  const peak = hPeak();
  if (peak && !hPeakWas && !hSurge) hSurgeT = Math.min(hSurgeT, 0.3);
  if (!peak && hPeakWas) { hWaveT = 0; hSurge = 0; hSurgeP = 0; hSurgeT = hSurgeGap(); }
  hPeakWas = peak;
  const stink = hPropOn('stink'), ghost = hPropOn('ghost');
  // 涌浪：憋 surgeTell 秒（潮边发亮、手机一震）→ 猛涌 surgeTime 秒 → 隔 surgeEvery 秒再来（新一波喘口气的时候不涌）
  // 鬼火冲的时候也不涌（2.13 节）
  if (ghost) { hSurge = 0; hSurgeP = 0; }
  else if (hWaveT > hCalm() && !stink) {
    if (!hSurge) {
      hSurgeT -= dt;
      if (hSurgeT <= 0) { hSurge = 1; hSurgeP = 0; vibrate(1); S.thump(0.5); }
    } else {
      hSurgeP += dt;
      if (hSurge === 1 && hSurgeP >= HD.surgeTell) { hSurge = 2; hSurgeP = 0; S.whoosh(); shake = Math.max(shake, 7); }
      else if (hSurge === 2 && hSurgeP >= HD.surgeTime) { hSurge = 0; hSurgeT = hSurgeGap(); hqAdd('surgeLive'); }   // 任务：挺过涌浪
    }
  }
  if (hSurge === 2) hV = Math.max(hV, Math.min(HD.vTop, hV * HD.surgeK));   // 涌浪：不超过 vTop（连斩的速度）
  const off = hGap() - hBottomGap() * HD.catchFromK;                    // 离你超过这么远就开始追
  if (hWaveT <= hCalm()) hV *= HD.calmK;                                // 新一波：先慢慢涌（喘口气）
  else if (off > 0 && !ghost) hV += Math.min(HD.catchMax, off * HD.catchK);   // 快被甩开：加速追（鬼火冲的时候不追：让它甩开）
  if (stink) {
    // 臭水（2.13 节）：黑潮被赶在屏幕底边外，不涌、不追；你往回走它也往后退
    hSurge = 0; hSurgeP = 0; hV = 0;
    const b = hBottomGap() + PROP.stink.back;
    if (hGap() < b) hFront = wwrap(P.y + b);
  }
  if (hTutOn()) { hSurge = 0; hSurgeP = 0; }                            // 教的时候不涌（2.14 节）
  hFront = wwrap(hFront - hV * dt);
  if (hTutOn()) {
    // 教的时候追不到人；教「往前斩」「连斩」时还在屏幕外就快点涌进来（连斩要扫得到它；停住时要看得见它，2.14 节）
    const f = hTutFloor(), k = hTutKey(), ex = hGap() - f - 60;
    if ((k === 'run' || k === 'burst') && ex > 0) hFront = wwrap(hFront - Math.min(ex, Math.max(500, ex * 5) * dt));
    if (hGap() < f) hFront = wwrap(P.y + f);
  }
  if (hGap() > hGapMax()) hFront = wwrap(P.y + hGapMax());              // 最远就这么远：被你拖着走
  const g = hGap();
  if (hCols.length !== HD.cols) { hCols.length = 0; for (let c = 0; c < HD.cols; c++) hCols.push([]); }
  for (let c = 0; c < HD.cols; c++) hCols[c].length = 0;
  for (let i = 0; i < horde.length; i++) hCols[horde[i].c].push(horde[i]);
  const near = clamp((HD.lungeR - g) / HD.lungeR, 0, 1), step = HD.adv * dt, need = hRowsNeed();
  for (let c = 0; c < HD.cols; c++) {
    const L = hCols[c];
    L.sort(byYb);
    while (L.length > need + 2) { const m = L.pop(); horde.splice(horde.indexOf(m), 1); }
    while (L.length < need) {
      const m = hNewMember(c);
      m.yb = L.length ? L[L.length - 1].yb + HD.gap : hRowY(c, 0, m);
      L.push(m); horde.push(m);
    }
    const lunge = HD.lunge * near * clamp(1 - Math.abs(hColX(c) - P.x) / HD.lungeX, 0, 1);
    let prev = -Infinity;
    for (let j = 0; j < L.length; j++) {
      const m = L[j];
      const tgt = j ? Math.max(hRowY(c, j, m), prev + HD.gap * 0.75) : hRowY(c, 0, m) - lunge;
      m.yb += clamp(tgt - m.yb, -step, step);
      m.wob += dt * 4;
      prev = m.yb;
    }
  }
}

// 挡路的有多难：就是第几波（按往上逃了多远）
function hLevel() { return hWave; }
// 前面摆一组挡路的（世界 y = y）。花样跟着难度变多。
// 返回这一组最靠前的那只（下一组接着它往上摆），满了 / 一只没摆出来 = null（整组都给路线让了路：返回这一组的位置）
function hBlock(y) {
  if (enemies.length >= hBlockMax()) return null;
  const half = Math.min(W / 2 - 70, HD.blockHalf), w = hLevel(), xl = hX0 - half, xr = hX0 + half;   // 只摆在中间（HD.blockHalf）
  let top = null;
  const hk = Math.min(HD.kindHeat, hHeat());    // 越往后小怪越少（重型 26%、冲锋者 24%、爆裂者 18% 封顶）
  const kindOf = function () {
    const r = Math.random();
    if (w >= 3 && r < 0.14 + 0.03 * hk) return 'heavy';
    if (w >= 2 && r < 0.30 + 0.06 * hk) return 'charger';
    if (r < (w >= 2 ? 0.44 + 0.06 * hk : 0.14) && hTop / HD.m >= HD.bombFromM) return 'bomb';
    return 'grunt';
  };
  let skip = false;
  const put = function (x, yy, kind) {
    // 给路留出一条道（HD.pathMix）：离路太近的不摆；爆裂者要离开它炸的圈
    if (hPathOn() && hPathNear(clamp(x, xl, xr), wwrap(yy), kind === 'bomb' ? HD.bombR + 30 : HD.pathClear)) { skip = true; return; }
    const e = spawnEnemy(clamp(x, xl, xr), wwrap(yy), kind);
    if (!e) return;
    e.sp = (kind === 'heavy' ? 45 : kind === 'bomb' ? 50 : kind === 'charger' ? 55 : 65 + 9 * w) * rand(0.85, 1.15);
    e.born = 0.4;
    if (!top || wdelta(e.y - top.y) < 0) top = e;
    // 第 1 波的爆裂者身后一定带一只（一刀够得着、在炸的圈外）：先学会"斩它之前看好下一步"
    if (kind === 'bomb' && w === 1) put(x + (x < hX0 ? 1 : -1) * 70, yy - 190, 'grunt');
  };
  const r = Math.random(), x = rand(xl, xr);
  if (r < 0.25) put(x, y, kindOf());                                     // 一只
  else if (r < 0.45) { put(x - 60, y, kindOf()); put(x + 60, y - 30, 'grunt'); }   // 一对
  else if (r < 0.7) {                                                    // 一排，中间留个口子
    const n = 3 + (w >= 2 ? 1 : 0), hole = Math.floor(rand(0, n + 1));
    for (let i = 0; i <= n; i++) if (i !== hole) put(xl + (xr - xl) * i / n, y + rand(-12, 12), i === 1 ? kindOf() : 'grunt');
  } else {                                                               // 一串斜线：一刀接一刀斩上去
    const dir = x < hX0 ? 1 : -1, n = 3 + Math.min(2, w - 1);
    for (let i = 0; i < n; i++) put(x + dir * 105 * i, y - 125 * i, 'grunt');
  }
  return top || (skip ? { x: x, y: wwrap(y) } : null);   // 整组都让路了：也算摆过了，下一组照常往上接
}
// 下一组离上一组最靠前那只多远（越往后越密）
function hBlockGap() { return rand(HD.blockGap[0], HD.blockGap[1]) * Math.max(HD.gapWaveMin, 1 - 0.06 * (hLevel() - 1)) / hFixK() / (hTrailOn() ? HD.trailRand : 1); }
// 能纠错的还剩几成（HD.fixHeat / fixMin）：随机摆的多稀、跟丢了等多久才重摆
function hFixK() { return Math.max(HD.fixMin, 1 - HD.fixHeat * hHeat()); }
// 同屏挡路的名额
function hBlockMax() { return HD.blockMax; }
// 从世界 y 往上一组接一组摆到屏幕顶外（开场完、连斩清屏后：前面马上就有得斩），之后照常往上接着摆（hNext）
function hFillAhead(y) {
  const line = cam.y - H / 2 - 70;
  while (y > line) {
    const t = hBlock(y);
    if (!t) break;
    y -= Math.max(0, -wdelta(t.y - y)) + hBlockGap();
  }
  hNext = hTop + Math.max(0, line - y);
}

/* ---------- 路线（HD.path）：怪一只接一只摆成一条往上的路，每一步只有"点左"或"点右" ---------- */
// 从你身前重新摆一条路（开局、开场完、连斩清屏后、教程放开、跟丢了），一直摆到屏幕顶外。
// 旧路上还剩的先散掉（连斩时镜头回头看黑潮，屏幕顶外那几步没被清掉，不散的话就成了挡在新路边上、又锁不上的怪）
function hPathStart() {
  hPathClear();
  hPathHead = null; hPathLive = true; hPathLostT = 0; hPathQ.length = 0; hPathN = 0; hPathSpec = 0;
  hPathX = clamp(P.x, hX0 - HD.pathHalf, hX0 + HD.pathHalf);
  hPathY = wwrap(P.y - HD.path0);
  hPathGen();
  hPathTick();
  // 混着随机的（HD.pathMix）：已经摆着的、挡在新路上的散掉，给路让出一条道
  if (HD.pathMix) for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.pth || !hPathNear(e.x, e.y, e.bomb ? HD.bombR + 30 : HD.pathClear, true)) continue;
    enemies.splice(i, 1);
    rings.push({ x: e.x, y: e.y, r0: e.r, r1: e.r * 2, life: 0.3, max: 0.3, color: '#bfe9f2', w: 2 });
  }
}
// 开局、开场完、连斩清屏后、教程放开：摆路；混着随机的话再从 y 往上一组组摆到屏幕顶外（躲开路）
function hPathFill(y) {
  if (HD.path) hPathStart();
  if (!HD.path || HD.pathMix) hFillAhead(y);
}
// (x, y) 离路（路上相邻两步之间那一段；fromHero：再加上你到下一只那一段）有没有 r 那么近
function hPathNear(x, y, r, fromHero) {
  for (let i = 0; i < hPath.length; i++) {
    const b = hPath[i], bx = b.x - x, by = wdelta(b.y - y);
    if (bx * bx + by * by < r * r) return true;
    const a = i ? hPath[i - 1] : fromHero ? P : null;
    if (a && segDist(a.x - x, wdelta(a.y - y), bx, by, 0, 0) < r) return true;
  }
  return false;
}
// 再隔几步摆一颗糖（以前每往上 20~40 米撒 1~3 颗，平均约 600 一颗；一步约往上 240）
function hPathCandyGap() { return 2 + Math.floor(Math.random() * 3); }
// 往上接着摆到屏幕顶外（再多摆 pathLead：随机摆的在屏幕顶外那条线上摆，得先知道路从哪过）
function hPathGen() {
  const top = -wdelta(cam.y - H / 2 - 70 - P.y) + HD.pathLead;   // 屏幕顶外那条线在你前面多远
  while (-wdelta(hPathY - P.y) < top) hPathStep();   // 路不受 blockMax 限（随机摆的满了也得有路）；路上的也占随机摆的名额
}
// 摆下一步：在上一步的左前或右前（左右随机，挨着中间 pathHalf 的边就往回拐）；轮到了就是道具，不然是一只朝你走的小怪。
// 嘉欣糖不算一步：摆在两步中间那段路上，斩过去顺手捡（糖离 120 就捡到，要是算一步，人从旁边跑过就捡了、没冲到那儿，
// 下一只按糖的位置摆，就偏出去够不着了）
function hPathStep() {
  if (!hPathQ.length) hPathForm();
  const st = hPathQ.shift(), a = st.a * Math.PI / 180, d = st.d, dx = Math.sin(a) * d, dy = Math.cos(a) * d, s = st.s;
  // 队形里（不是一段的第一步）：两步正中间站一只，跟这一段一起往下压
  if (st.i > 0 && st.mid !== false) {
    const m = spawnEnemy(hPathX + s * dx / 2, wwrap(hPathY - dy / 2), 'grunt');
    if (m) { m.sp = st.sp; m.born = 0; m.pth = true; m.pmid = true; m.pf = st.f; m.pk = st.k; m.pi = st.i; hPathMid.push(m); }
  }
  if (!HD.pathMix && PROP.on && --hPathCandy <= 0) {      // 混着随机的：糖照以前随机撒（hSpawnProps）
    hCandy.push({ x: hPathX + s * dx / 2, y: wwrap(hPathY - dy / 2), ph: rand(0, 6.28) });
    hPathCandy = hPathCandyGap();
  }
  hPathX += s * dx; hPathY = wwrap(hPathY - dy);
  let n = null;
  if (!HD.pathMix && PROP.on && !hItem && !hProp && hTop - wdelta(hPathY - P.y) >= hPropNext) {
    n = hItem = { k: PROP_KINDS[Math.floor(Math.random() * PROP_KINDS.length)], x: hPathX, y: hPathY, t: 0 };
    hPropNext = Infinity;
  } else {
    n = spawnEnemy(hPathX, hPathY, hPathKind(st));
    if (!n) return;
    n.sp = st.sp;                               // 整队往下压，一段一个速度（hTickBlockers）
    n.born = 0;                                 // 从地里长出来
  }
  n.pth = true; n.pf = st.f; n.pk = st.k; n.pi = st.i; n.pd = st.fd;   // 第几段、什么队形、段里第几步、这一段隔多远
  hPath.push(n);
}
// 路上这一步摆什么怪（越来越难：队形里夹着特别的怪，HD.specHeat）：
// 爆裂者 —— 斩了停在它身上，得马上斩下一只闪出去；冲锋者 —— 走近了会蓄力冲过来，趁蓄力斩掉；重型 —— 第一刀只砍开壳、穿过去。
// 路刚重摆的头两步、连着两步都不放（刚接上路、刚炸完都得有一步喘气的），前 bombFromM 米不放爆裂者
function hPathKind(st) {
  const p = Math.min(HD.specMax, HD.specHeat * hHeat());
  hPathSpec = hPathSpec > 0 ? hPathSpec - 1 : 0;
  if (hPathSpec > 0 || hPathN < 2 || Math.random() >= p) { hPathN++; return 'grunt'; }
  hPathN++; hPathSpec = 2;
  const r = Math.random();
  if (r < 0.5 && hTop / HD.m >= HD.bombFromM) return 'bomb';
  return r < 0.8 ? 'charger' : 'heavy';
}
// 路上的队形：每段一种，段里间隔、角度都一样（弧：同一边、越往上越正）。n 几只；a 偏几度（离正上方）；d 隔多远。
// 偏 25~34°、隔 205~215（这是"照旧"那档，每段再按 HD.formGap 挤 / 散）：斩到上一只落地后，下一只还在斜前方的时间约 0.25~0.35 秒
// （整队往下压，比站着不动短一点）
const H_FORMS = [
  { k: 'line', n: [3, 4], a: 28, d: 205 },         // 斜线：一直往同一边，连着点同一边斩上去
  { k: 'zig', n: [4, 6], a: 25, d: 215 },          // 之字：左右交替
  { k: 'stair', n: [4, 6], a: 27, d: 205 },        // 台阶：两步一拐（左左右右）
  { k: 'arc', n: [3, 4], a: [34, 16], d: 210 }     // 弧：同一边，越往上越正
];
// 排下一段队形进 hPathQ：不连着两段一样；出了中间 pathHalf 就整段左右翻过来，还出就只摆放得下的那几步。
// 越来越难（HD.heat0）：开头只有斜线、弧，之字 zigAt 秒、台阶 stairAt 秒才出；每档长 formHeat 步
// 前期（HD.trailUntil 秒以前）：路线不摆队形，是一条松散的路
function hTrailOn() { return hPathOn() && hDiffT < HD.trailUntil; }
// 排下一截松散的路进 hPathQ（HD.trail）：每步在上一步的左前或右前，偏几度、隔多远随机；多半换边，偏出中间 pull 就往回拐，
// 出了中间 pathHalf 就这一步换边。一截一个速度（整截一起往下压，路形不散）
function hPathTrail() {
  const T = HD.trail, sp = (65 + 9 * hLevel()) * rand(0.85, 1.15);
  hPathK = 'trail'; hPathF++;
  let x = hPathX, s = hPathTs || (Math.random() < 0.5 ? -1 : 1);
  for (let i = 0; i < T.n; i++) {
    const off = x - hX0;
    if (Math.abs(off) > T.pull) s = off > 0 ? -1 : 1;
    else if (Math.random() < T.flip) s = -s;
    // 路刚重摆的第一步至少隔 first（跟队形接头多隔 pathGap 一个意思：一开始别贴着你）
    const a = rand(T.a[0], T.a[1]), d = Math.max(rand(T.d[0], T.d[1]), !i && hPathN === 0 ? T.first : 0), dx = Math.sin(a * Math.PI / 180) * d;
    if (Math.abs(x + s * dx - hX0) > HD.pathHalf) s = -s;
    hPathQ.push({ s: s, a: a, d: d, sp: sp, f: hPathF, k: 'trail', i: i, fd: Math.round(d), mid: false });
    x += s * dx;
  }
  hPathTs = s;
}
function hPathForm() {
  if (hTrailOn()) { hPathTrail(); return; }
  const can = H_FORMS.filter(function (F) { return (F.k !== 'zig' || hDiffT >= HD.zigAt) && (F.k !== 'stair' || hDiffT >= HD.stairAt); });
  let F = can[Math.floor(Math.random() * can.length)];
  if (F.k === hPathK && can.length > 1) F = can[(can.indexOf(F) + 1 + Math.floor(Math.random() * (can.length - 1))) % can.length];
  hPathK = F.k; hPathF++;
  // 这一段隔多远（HD.formGap）：挤 / 照旧 / 散，不连着两段一样。路刚重摆的第一段用照旧那档（散的第一只离你 340 多，够不着又跟丢）
  let gi = Math.floor(Math.random() * HD.formGap.length);
  if (gi === hPathGi && HD.formGap.length > 1) gi = (gi + 1 + Math.floor(Math.random() * (HD.formGap.length - 1))) % HD.formGap.length;
  if (hPathN === 0) gi = HD.formGap.indexOf(1);
  hPathGi = gi;
  const fd = Math.round(F.d * HD.formGap[gi]);
  const n = F.n[0] + Math.floor(Math.random() * (F.n[1] - F.n[0] + 1)) + Math.min(HD.formMax, Math.floor(HD.formHeat * hHeat())), off = hPathX - hX0;
  // 斜线、弧往中间那边走（地方大）；之字、台阶随便哪边起
  const s0 = (F.k === 'line' || F.k === 'arc') && Math.abs(off) > 40 ? -Math.sign(off) : (Math.random() < 0.5 ? -1 : 1);
  const sp = (65 + 9 * hLevel()) * rand(0.85, 1.15), steps = [];
  for (let i = 0; i < n; i++) {
    const s = F.k === 'zig' ? (i % 2 ? -s0 : s0) : F.k === 'stair' ? (Math.floor(i / 2) % 2 ? -s0 : s0) : s0;
    const a = Array.isArray(F.a) ? F.a[0] + (F.a[1] - F.a[0]) * i / Math.max(1, n - 1) : F.a;
    steps.push({ s: s, a: a, d: fd + (i ? 0 : HD.pathGap), sp: sp, f: hPathF, k: F.k, i: i, fd: fd });
  }
  const fits = function (m) {
    let x = hPathX;
    for (let i = 0; i < m; i++) { x += steps[i].s * Math.sin(steps[i].a * Math.PI / 180) * steps[i].d; if (Math.abs(x - hX0) > HD.pathHalf) return false; }
    return true;
  };
  // 两个方向都试：哪边放得下的步数多就用哪边（以前先整段翻过来再截短，翻过来以后第一步就出去了也照摆；间隔拉开以后常碰上）
  const most = function () { let m = n; while (m > 0 && !fits(m)) m--; return m; };
  let m = most();
  if (m < n) {
    for (let i = 0; i < n; i++) steps[i].s = -steps[i].s;
    const m2 = most();
    if (m2 > m) m = m2;
    else for (let i = 0; i < n; i++) steps[i].s = -steps[i].s;
  }
  for (let i = 0; i < Math.max(1, m); i++) hPathQ.push(steps[i]);
}
// 路上这一步还在不在（怪没死、道具没被拿）
function hPathAlive(n) { return n === hItem || enemies.indexOf(n) >= 0; }
// 从你这儿看错过了没有：到身后了，或者横着偏出斜前方 sideMax°（不按住走的话只会越偏越多）
function hPathMissed(n) {
  const dx = wdelta(n.x - P.x), dy = wdelta(n.y - P.y);
  return dy > -8 || Math.abs(dx) > -dy * Math.tan(HD.sideMax * Math.PI / 180);
}
// 每帧：没了的、到身后的从路上去掉；下一只 = 路上第一个还没错过的。
// 怪会朝你走：后面哪只走到贴脸（HD.nearR 以内、在斜前方）了，先斩它（不然撞上来了却锁不上）
function hPathTick() {
  let k = 0;
  for (let i = 0; i < hPath.length; i++) {
    const n = hPath[i];
    if (hPathAlive(n) && wdelta(n.y - P.y) < 40) hPath[k++] = n;
  }
  hPath.length = k;
  let km = 0;
  for (let i = 0; i < hPathMid.length; i++) { const m = hPathMid[i]; if (enemies.indexOf(m) >= 0 && wdelta(m.y - P.y) < 40) hPathMid[km++] = m; }
  hPathMid.length = km;
  hPathHead = null;
  let nd = HD.nearR * HD.nearR;
  for (let i = 0; i < k; i++) {
    const n = hPath[i];
    if (hPathMissed(n)) continue;
    if (!hPathHead) hPathHead = n;
    const dx = wdelta(n.x - P.x), dy = wdelta(n.y - P.y);
    if (dx * dx + dy * dy < nd) { nd = dx * dx + dy * dy; hPathHead = n; }
  }
}
// 只锁路上的下一只：在这一边斜前方、够得着才锁（HD.path）
function hPathLock(side, R) {
  const n = hPathHead;
  if (!n || !hSideOk(side, wdelta(n.x - P.x), wdelta(n.y - P.y), R)) return null;
  if (n === hItem) return { x: n.x, y: n.y, r: PROP.pickR, ref: n };
  return { x: n.x, y: n.y, r: n.r, ref: n };
}
// 路上还剩的散掉：怪化一圈烟；道具收回去，过一会儿出在新路上；路上的糖留着，路过照样捡。
// 混着随机的（HD.pathMix）：旧路上的怪不散，留下来当普通的怪（各自朝你走）—— 不顺着路斩的人一局要重摆好多回，一串怪凭空没了很怪；
// 挡在新路上的由 hPathStart 散掉
function hPathClear() {
  if (HD.pathMix) {
    for (let i = 0; i < hPath.length; i++) hPath[i].pth = false;
    for (let i = 0; i < hPathMid.length; i++) { hPathMid[i].pth = false; hPathMid[i].pmid = false; }
    hPath.length = 0; hPathMid.length = 0;
    return;
  }
  for (let i = 0; i < hPath.length; i++) {
    const n = hPath[i], j = enemies.indexOf(n);
    if (j >= 0) enemies.splice(j, 1);
    else if (n === hItem) { hItem = null; hPropNext = hTop + 4 * HD.m; }
    else continue;
    rings.push({ x: n.x, y: n.y, r0: n.r || 30, r1: (n.r || 30) * 2, life: 0.3, max: 0.3, color: '#bfe9f2', w: 2 });
  }
  hPath.length = 0;
  for (let i = 0; i < hPathMid.length; i++) {         // 队形里中间站的那几只也一起散
    const m = hPathMid[i], j = enemies.indexOf(m);
    if (j < 0 || wdelta(m.y - P.y) > 0) continue;     // 已经斩了、到身后了的不管
    enemies.splice(j, 1);
    rings.push({ x: m.x, y: m.y, r0: m.r, r1: m.r * 2, life: 0.3, max: 0.3, color: '#bfe9f2', w: 2 });
  }
  hPathMid.length = 0;
}
// 跟丢了：剩下的路散掉，从你身前重新摆
function hPathReroute() { hPathStart(); }

function hPathOn() { return HD.path && hordeMode && hPathLive; }

// 点「斩」：推着摇杆就往那边，没推就往前（往上）；够得着的怪（挡路的 / 黑潮的边）对准它砍，没有就不出刀
// side：两把斩（HD.twoBlades）时 -1 左斩 / 1 右斩
/* ---------- 势头（HD.mom*）：斩得准越跑越快，点空 / 被抓 / 发呆掉速 ---------- */
let hMom = 0, hMomLastT = 0;   // 势头（0~momMax，小数）；上一刀什么时候出的（发呆多久了）
function hMomK() { return HD.mom ? 1 + HD.momK * hMom : 1; }
function hMomAdd(d) {
  if (!HD.mom || !hordeMode) return;
  const l0 = Math.floor(hMom);
  hMom = clamp(hMom + d, 0, HD.momMax);
  const l1 = Math.floor(hMom);
  if (l1 > l0) {           // 升一档：一圈白（满档金）+ 叮
    if (l1 >= HD.momRam && !hMomPop && !meta.seen.mom && !hTutOn()) { hMomPop = { t: 0 }; meta.seen.mom = 1; saveMeta(); }
    rings.push({ x: P.x, y: P.y, r0: P.r + 4, r1: P.r + 46, life: 0.3, max: 0.3, color: l1 >= HD.momMax ? UI.gold : '#ffffff', w: 3 });
    S.tick(0.35 + 0.1 * l1);
  } else if (l1 < l0) {    // 掉档：一圈红 + 闷一声
    rings.push({ x: P.x, y: P.y, r0: P.r + 40, r1: P.r + 6, life: 0.3, max: 0.3, color: '#ff5a46', w: 4 });
    S.thump(0.35);
  }
}
// 每帧：能斩（有准星）却停着不斩超过 momIdle 秒，慢慢掉
function hMomTick(dt) {
  if (!HD.mom || P.dashT > 0 || hBurst || hIntro || hTutOn()) { hMomLastT = Math.max(hMomLastT, gameTime - HD.momIdle * 0.5); return; }
  if ((hAimTL || hAimTR) && gameTime - hMomLastT > HD.momIdle) hMomAdd(-HD.momDecay * dt);
}
function hMomPopTick(dt) { if (hMomPop && (hMomPop.t += dt) > 3.5) hMomPop = null; }
// 撞上了：势头够就撞飞（掉档），不够就是死。第一次够档弹一张卡说一声（hMomPop）
function hMomRam(e) {
  if (!HD.mom || hMom < HD.momRam || e.bomb || e.heavy) return false;
  hMomAdd(-HD.momRamCost);
  shake = Math.max(shake, 8);
  return true;
}
let hMomPop = null;        // 第一次攒到 momRam 档：一张卡（{ t }）
function drawMomPop() {
  if (!hMomPop || state !== 'play') return;
  const t = hMomPop.t, w = Math.min(W_CSS - 40, 300), h = 64, y = hTutCardY() + (hPropPop ? 84 : 0) + (hTeachPop ? 72 : 0);
  ctx.save();
  ctx.globalAlpha = clamp((3.5 - t) / 0.5, 0, 1) * clamp(t / 0.15, 0, 1);
  hText('momPop', 'mom', W_CSS / 2 - w / 2, y - h / 2, w, h, function () {
    bladeBox(1, 1, w - 2, h - 2, { c: 10, border: 'rgba(255,224,138,0.8)', lw: 1.4, ticks: '#ffe08a' });
    ctx.textAlign = 'left';
    uf(900, 16);
    ctx.fillStyle = '#ffe08a';
    ctx.fillText('势头 ' + HD.momRam + ' 格', 16, 24);
    uf(600, 12);
    ctx.fillStyle = 'rgba(234,246,248,0.9)';
    ctx.fillText('脚下亮的格子：斩中涨，点空、被抓掉', 16, 42);
    ctx.fillText(HD.momRam + ' 格以上撞上小嘉豪直接撞飞（掉 1 格）', 16, 57);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}
// 嘉豪脚下一排小格：亮几格就是几档（最后一格按小数亮一截），一笔亮的一笔暗的；档越高越金
function drawMomPips() {
  if (!HD.mom || !hordeMode || state !== 'play' || hIntro || hTutOn()) return;
  const n = HD.momMax, r = P.r + 13, a0 = Math.PI * 0.62, span = Math.PI * 0.76, gap = 0.06, seg = span / n;
  const lv = Math.floor(hMom), c = lv >= n ? UI.gold : lv >= 3 ? '#ffe08a' : '#bff6ff';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = a0 + seg * i; ctx.moveTo(P.x + Math.cos(a + gap) * r, P.y + Math.sin(a + gap) * r); ctx.arc(P.x, P.y, r, a + gap, a + seg - gap); }
  ctx.strokeStyle = 'rgba(214,236,242,0.18)';
  ctx.stroke();
  if (hMom > 0.02) {
    ctx.beginPath();
    for (let i = 0; i < n && i < hMom; i++) {
      const a = a0 + seg * i, e = a + gap + (seg - gap * 2) * Math.min(1, hMom - i);
      ctx.moveTo(P.x + Math.cos(a + gap) * r, P.y + Math.sin(a + gap) * r);
      ctx.arc(P.x, P.y, r, a + gap, e);
    }
    ctx.strokeStyle = c;
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}
// 3 档以上：屏幕两边往下流的速度线（一笔），越高越多越亮
function drawMomLines() {
  if (!HD.mom || !hordeMode || state !== 'play' || hMom < 3) return;
  const k = (hMom - 3) / (HD.momMax - 3), t = nowMs() / 1000, n = 3 + Math.round(k * 3);
  ctx.beginPath();
  for (let side = 0; side < 2; side++) for (let i = 0; i < n; i++) {
    const x = side ? W_CSS - 8 - i * 9 : 8 + i * 9, len = 40 + 30 * k, y = ((t * (900 + i * 130) + i * 211) % (H_CSS + len)) - len;
    ctx.moveTo(x, y); ctx.lineTo(x, y + len);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.12 + 0.18 * k).toFixed(3) + ')';
  ctx.stroke();
}

// 提前按的那一下（HD.tapBuf）：{ s 哪一边, t 什么时候按的 }
let hTapBuf = null;
function hTapBufTick() {
  if (!hTapBuf || P.dashT > 0 || P.cd > 0) return;
  const b = hTapBuf;
  hTapBuf = null;
  // 闪的过程中按的，落地时还算数（落地后 tapBuf 秒以内）；落地时那一边没东西 = 点空，照样掉势头（不然狂点的全躲进这里）
  if (gameTime - b.t <= HD.tapBuf + CFG.dashTime && hTap(b.s) === true && !hTutOn()) hMomAdd(-HD.momWhiff);
}
function hTap(side) {
  if (hIntro) return;                       // 开场不能跳过（用户："改成不能跳过"）
  if (hTutFz) {                             // 新手教程停住了：点对了那一边才放行，这一下照常斩（2.14 节）
    if (hTutKey() === 'burst' || (hTutSide && side !== hTutSide)) return;
    hTutFz = false;
  } else if (hTutOn()) {
    // 该停了还没停（上一刀刚收、这一下又要出刀：一直连着斩就永远停不下来）：这一下先停住，不出刀
    const fz = hTutWant();
    if (fz) { hTutFreeze(fz); return; }
  }
  if (hPropOn('ghost')) return;             // 鬼火往前冲：剑气在斩，不出刀（2.13 节）
  if (hCaughtT > 0) return;                 // 被班主任抓了：愣着出不了刀
  // 提前按也算（HD.tapBuf）：还在闪，先记着，落地马上出（见 hTapBufTick）。点空罚停（P.cd）的时候按的不记 —— 不然罚停被绕过去了
  if (state === 'play' && !hBurst && P.dashT > 0) { hTapBuf = { s: side, t: gameTime }; return; }
  if (state !== 'play' || hBurst || P.cd > 0 || P.dashT > 0 || gameTime - hNibbleAt < HD.nibbleCd) return;
  let t = HD.twoBlades ? hLockSide(side || 1) : hLock(inputDir() || { x: 0, y: -1 });
  // 土狼时间（HD.coyote）：斩刚才这一边锁得最久的那只（人反应过来点下去，照着的是那时候看到的）
  if (HD.twoBlades && HD.coyote) {
    const p = hLockSeen(side || 1);
    if (p && (!t || t.ref !== p)) t = hLockOf(p);
  }
  hAimExtra = -1;
  // 面前没有能打的：不出刀，人照常走（用户："玩家在面前没有能打的怪物的时候不能斩，只能默认跑"）
  if (!t) return true;                      // 斩键本来就灰着，不再写"前面没有怪"；true = 点空了（松手时罚停，见 onTouchEnd）
  // 班主任看着（人或它在视线里）：不出刀，当场被抓
  const seen = hTeach.length ? hTeachSees(t) : null;
  if (seen) { hCaught(seen); return; }
  hMomLastT = gameTime;                     // 势头：出刀了，不算发呆
  tryDash(t);
  // 锁得比一刀远（aimR > 一刀约 184）：冲到它身后再停；冲的路上跟着它拐（见 hHome）
  const len = Math.hypot(wdelta(t.x - P.x), wdelta(t.y - P.y));
  const want = len + (t.bomb ? HD.bombStop : (t.heavy && !t.cracked) ? (t.r || 24) + P.r + CFG.heavyFollow : CFG.dashFollow);
  // 爆裂者：停在它身上（不穿过去），之后自己想办法出圈
  P.dashLeft = t.bomb ? want : Math.max(P.dashLeft, want);
  hAimExtra = P.dashLeft - len;
  // 黑板尺（2.13 节）：锁得上两倍远，这一刀也拉长 —— 按要冲多远把冲刺时间拉长（起手更快），
  // 不然一刀的时间走完了，后面那一大截只能按收刀的速度慢慢滑过去
  const L0 = POW.dashSpeed * CFG.dashTime * 0.7, r = P.dashLeft / L0;
  if (hPropOn('ruler') && r > 1) P.dashT = CFG.dashTime * (Math.sqrt(0.16 + 0.84 * r) - 0.4) / 0.6;
}
// 两把斩（HD.twoBlades）：side -1 左斩 / 1 右斩会砍谁。(dx, dy) 在不在这一边的斜前方：够得着、在前面，
// 从正前方往这一边偏 -sideIn° ~ sideMax° 以内（不横着斩）
function hSideOk(side, dx, dy, R) {
  const d2 = dx * dx + dy * dy;
  if (dy >= 0 || d2 > R * R || d2 < 64) return false;
  const a = Math.atan2(dx * side, -dy) * 180 / Math.PI;
  return a >= -HD.sideIn && a <= HD.sideMax;
}
// 每帧记下这一边的准星换成了谁（土狼时间，HD.coyote）
function hLockNote(side, t) {
  const L = hLockLog[side], r = t ? t.ref : null;
  if (L.length && L[L.length - 1].r === r) return;
  L.push({ r: r, t: gameTime });
  if (L.length > 12) L.shift();
}
// 人刚才看到这一边锁的是谁：coyote ~ coyoteMin 秒前那一段里锁得最久、现在还斩得了的那只（没有 = null）
function hLockSeen(side) {
  const L = hLockLog[side], a = gameTime - HD.coyote, b = gameTime - HD.coyoteMin;
  let best = null, bw = 0;
  for (let i = 0; i < L.length; i++) {
    const w = Math.min(i + 1 < L.length ? L[i + 1].t : gameTime, b) - Math.max(L[i].t, a);
    if (w > bw && hCoyoteOk(L[i].r, side)) { bw = w; best = L[i].r; }
  }
  return best;
}
// 土狼时间斩得了它：还在、还砍得了、还在这一边的斜前方、够得着（横着的不斩：用户"切不到横向的怪物"）
function hCoyoteOk(r, side) {
  if (!r) return false;
  if (r !== hItem && hCandy.indexOf(r) < 0 && (enemies.indexOf(r) < 0 || (r.heavy && r.cracked && r.armorT > 0) || inBlast(r.x, r.y, 0))) return false;
  return hSideOk(side, wdelta(r.x - P.x), wdelta(r.y - P.y), hAimR());
}
function hLockOf(r) {
  if (r === hItem) return { x: r.x, y: r.y, r: PROP.pickR, ref: r };
  if (hCandy.indexOf(r) >= 0) return { x: r.x, y: r.y, r: 18, ref: r };
  return { x: r.x, y: r.y, bomb: r.bomb, heavy: r.heavy, cracked: r.cracked, r: r.r, ref: r };
}
function hLockSide(side) {
  const R = hAimR();
  // 只有路线（HD.path、不混随机的）：只锁路上的下一只（新手教程现摆的道具除外：教的就是斩它）
  if (hPathOn() && !HD.pathMix) {
    if (hItem && !hItem.pth && hSideOk(side, wdelta(hItem.x - P.x), wdelta(hItem.y - P.y), R)) return { x: hItem.x, y: hItem.y, r: PROP.pickR, ref: hItem };
    return hPathLock(side, R);
  }
  let nb = null, nd = HD.nearR * HD.nearR;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i], dx = wdelta(e.x - P.x), dy = wdelta(e.y - P.y), d2 = dx * dx + dy * dy;
    if (d2 >= nd || e.pmid || !hSideOk(side, dx, dy, R)) continue;     // 队形里中间站的那只不抢（顺着路斩过去就带走了）
    if ((e.heavy && e.cracked && e.armorT > 0) || inBlast(e.x, e.y, 0)) continue;
    nd = d2; nb = e;
  }
  if (nb) return { x: nb.x, y: nb.y, bomb: nb.bomb, heavy: nb.heavy, cracked: nb.cracked, r: nb.r, ref: nb };   // 贴脸的先斩（HD.nearR）
  if (hItem) {
    const dx = wdelta(hItem.x - P.x), dy = wdelta(hItem.y - P.y);
    if (hSideOk(side, dx, dy, R)) return { x: hItem.x, y: hItem.y, r: PROP.pickR, ref: hItem };
  }
  // 路线混着随机的（HD.pathMix）：路上的下一只在这一边，就顺着路斩它
  if (hPathOn()) { const t = hPathLock(side, R); if (t) return t; }
  // 斜着最靠前：顺着这一边 45° 斜线走了多远（dx·side − dy，省掉 √½）
  let it = null, ip = -Infinity;
  for (let i = 0; i < hCandy.length; i++) {
    const c = hCandy[i], dx = wdelta(c.x - P.x), dy = wdelta(c.y - P.y), pr = dx * side - dy;
    if (pr > ip && hSideOk(side, dx, dy, R)) { ip = pr; it = c; }
  }
  if (it) return { x: it.x, y: it.y, r: 18, ref: it };
  let b = null, bp = -Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i], dx = wdelta(e.x - P.x), dy = wdelta(e.y - P.y), pr = dx * side - dy;
    if (pr <= bp || !hSideOk(side, dx, dy, R)) continue;
    if ((e.heavy && e.cracked && e.armorT > 0) || inBlast(e.x, e.y, 0)) continue;
    bp = pr; b = e;
  }
  return b ? { x: b.x, y: b.y, bomb: b.bomb, heavy: b.heavy, cracked: b.cracked, r: b.r, ref: b } : null;
}
// 两把斩：按着的手指往哪边（鬼火冲的时候往那边挪）
// minMs：按住超过这么久才算（按住走用，轻点斩不算）
function hSideDir(minMs) {
  let s = 0;
  const now = nowMs();
  for (const id in hSideTouch) { const h = hSideTouch[id]; if (!minMs || now - h.t >= minMs) s += h.s; }
  if (!IS_MG) { if (keys['a'] || keys['arrowleft']) s -= 1; if (keys['d'] || keys['arrowright']) s += 1; }
  return s ? { x: s > 0 ? 1 : -1, y: 0 } : null;
}
// 按住走：按住哪边就往那边斜前方走（单位向量）；没按住 = null（照旧笔直往上跑）。
// 用户："在范围内有怪物的时候，玩家的头部，指向怪物，不要直接往那个转弯最边缘朝向"：这一边的准星锁着东西
// （够得着的怪；有道具、糖时是它们 —— 跟点下去斩的是同一个），就对着它走，最多偏到 steerDeg°、不往另一边偏；
// 没锁着才往最边上 steerDeg° 走
function hSteerDir() {
  const d = hSideDir(HD.steerHold * 1000);
  if (!d) return null;
  let a = HD.steerDeg * Math.PI / 180;
  const t = d.x < 0 ? hAimTL : hAimTR, r = t && (t.ref || t);
  if (r) a = clamp(Math.atan2(wdelta(r.x - P.x) * d.x, -wdelta(r.y - P.y)), 0, a);
  return { x: Math.sin(a) * d.x, y: -Math.cos(a) };
}
function hHeld(side) { for (const id in hSideTouch) if (hSideTouch[id].s === side) return true; return false; }
// 这一刀会砍谁（辅助瞄准）：d 方向左右 HD.aimDeg 度以内、hAimR() 以内的才锁（黑板尺：两倍远，2.13 节）。
// 用户："有道具优先斩道具，没有道具 优先斩前面最远的"：路上的道具够得着就锁它；没有就锁顺着 d 方向最远的那个
// （挡路的、嘉欣糖，比的是往 d 方向走了多远），一刀闪得最远，路上碰到的顺手斩掉、糖顺手捡了。
// 黑潮的边不算"前面的"：上面都没有才锁它，还是锁最近、最正的那只（锁深了一刀会连穿好几只，怒气攒得太快）
function hLock(d) {
  let b = null, bp = -Infinity, hm = null, it = null, bs = Infinity;
  const R = hAimR();
  if (hItem) {
    const dx = wdelta(hItem.x - P.x), dy = wdelta(hItem.y - P.y), dd = Math.hypot(dx, dy);
    if (dd >= 8 && dd <= R && inCone(d, dx, dy, HD.aimDeg)) return { x: hItem.x, y: hItem.y, r: PROP.pickR, ref: hItem };
  }
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i], dx = wdelta(e.x - P.x), dy = wdelta(e.y - P.y), dd = Math.hypot(dx, dy);
    if (dd < 8 || dd > R || !inCone(d, dx, dy, HD.aimDeg)) continue;
    if ((e.heavy && e.cracked && e.armorT > 0) || inBlast(e.x, e.y, 0)) continue;
    const pr = dx * d.x + dy * d.y;
    if (pr > bp) { bp = pr; b = e; }
  }
  for (let i = 0; i < hCandy.length; i++) {
    const c = hCandy[i], dx = wdelta(c.x - P.x), dy = wdelta(c.y - P.y), dd = Math.hypot(dx, dy);
    if (dd < 8 || dd > R || !inCone(d, dx, dy, HD.aimDeg)) continue;
    const pr = dx * d.x + dy * d.y;
    if (pr > bp) { bp = pr; b = null; it = c; }
  }
  if (it) return { x: it.x, y: it.y, r: 18, ref: it };
  if (!b) {
    for (let i = 0; i < horde.length; i++) {
      const m = horde[i], my = hMemberY(m), dx = m.x - P.x, dy = my - P.y, dd = Math.hypot(dx, dy);
      if (dd < 8 || dd > R || !inCone(d, dx, dy, HD.aimDeg)) continue;
      const sc = dd * (2 - (dx * d.x + dy * d.y) / dd);
      if (sc < bs) { bs = sc; hm = m; }
    }
  }
  if (hm) return { x: hm.x, y: wwrap(hMemberY(hm)), r: hm.r, ref: hm };
  return b ? { x: b.x, y: b.y, bomb: b.bomb, heavy: b.heavy, cracked: b.cracked, r: b.r, ref: b } : null;
}
// 冲的路上跟着目标拐：它还活着、还在前面（偏不到 70°），刀就对着它现在的位置，冲到它身后同样远再停
function hHome() {
  const r = P.dashRef;
  let tx, ty;
  if (enemies.indexOf(r) >= 0) { tx = P.x + wdelta(r.x - P.x); ty = P.y + wdelta(r.y - P.y); }
  else if (horde.indexOf(r) >= 0) { tx = r.x; ty = hMemberY(r); }
  else return;
  const dx = tx - P.x, dy = ty - P.y, d = Math.hypot(dx, dy);
  if (d < 1 || (dx * P.dx + dy * P.dy) / d < 0.35) return;
  P.dx = dx / d; P.dy = dy / d;
  P.dashLeft = d + hAimExtra;
}

// 碰到的挡路怪在身子前三分之一后面（身侧、身后）：不伤人（用户："依然会出现我斩过去结果正好碰上身后身侧的怪物……
// 只要在玩家身体三分之一后面的怪物都改成没有伤害"）。头朝 P.ang，身子从头到尾长 2r，前三分之一那条线在中心往前 r/3：
// 碰到的那一点（身子边上、朝怪的那一点）在这条线后面 = 和头的方向夹角大于 acos(1/3) ≈ 70.5° 就不算。
// 只管挡路的怪（冲锋者也算）；黑潮照旧（它本来就在身后追，追上了就是追上了）。正好重在中心上的照旧算
function hBehind(e) {
  const dx = wdelta(e.x - P.x), dy = wdelta(e.y - P.y), d = Math.hypot(dx, dy);
  return d > 0.5 && (dx * Math.cos(P.ang) + dy * Math.sin(P.ang)) / d <= HD.hurtFront;
}

// 斩死黑潮里的一只。how：'cut' 刀砍的 / 'burst' 回头连斩扫到的 / 'boom' 收刀炸掉的 / 'blast' 爆裂者炸的
function hKill(i, how) {
  const m = horde[i], x = m.x, y = wwrap(hMemberY(m));
  horde.splice(i, 1);
  hqAdd('horde');                                  // 任务：斩黑潮（2.15 节）
  combo += 1;
  if (combo > bestCombo) bestCombo = combo;
  comboTimer = POW.comboWindow;
  runKills += 1;
  const gain = Math.min(combo, CFG.scoreCap);
  score += gain;
  // 回头连斩扫过去的、收刀炸掉的：分照记、段位照升，但不在头顶一只只报"群斩 / 段位名"（人在来回冲，字会撒满一屏）
  if (how === 'burst' || how === 'boom') {
    FB.pend += gain; FB.chain += gain; FB.comboPop = 1;
    const t = tierOf(combo);
    if (t > FB.tier) { FB.tier = t; FB.tierPop = 1; FB.flash = 1; FB.flashC = COMBO_TIERS[t].c; FB.flashT = t; }
  } else fbKill(gain);
  P.cd = 0;
  if (how === 'cut') { hAddRage(HD.rage.horde); hNibbleAt = gameTime; }
  if (how === 'blast') hAddRage(HD.rage.blast);
  // 一只只给几颗碎屑（成百只一起死，不能每只十几颗）。颜色用定死的几种（段位色 / 小怪色）：主角色、怪色升段后
  // 每帧都在渐变，每帧冒出一个新颜色，碎屑按颜色分的组就散成几十组、几十笔
  const n = how === 'boom' ? 2 : 4, hc = heroTarget(), fc = THEME.foe.grunt;
  for (let k = 0; k < n; k++) {
    const a = rand(0, Math.PI * 2), s = rand(80, 420);
    parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.5), max: 0.5, r: rand(1.2, 2.8), c: k % 2 ? fc : hc });
  }
  if (parts.length > 360) parts.splice(0, parts.length - 360);
  // 刀痕一道三笔：回头连斩扫过去一秒斩上百只，只给每 4 只留一道（不然一直顶着 24 道 = 一帧七十多笔）
  if (how === 'cut' || how === 'blast' || (how === 'burst' && runKills % 4 === 0)) {
    cuts.push({ x: x, y: y, a: P.dashT > 0 || hBurst ? Math.atan2(P.dy, P.dx) : rand(0, Math.PI * 2),
                len: m.r * 6, w: 1, c: heroSkin().light || hc, life: 0.24, max: 0.24 });
    if (cuts.length > 24) cuts.shift();
  }
  if (Math.random() < 0.3) {
    stains.push({ x: x, y: y, r: m.r * rand(1.4, 2.2), life: THEME.stainLife, max: THEME.stainLife, a: rand(0, 6.28) });
    if (stains.length > 40) stains.shift();
  }
  const now = nowMs();
  if (now - hHitAt > (how === 'cut' ? 45 : 140)) { hHitAt = now; S.hit(combo); vibrate(0); }   // 成片死时少响几声（每一声都要走一趟原生音频）
}
// 回头连斩斩到挡路的怪（扫过去的、收刀清全屏的）：只记数、记分、几颗碎屑，不留刀痕、不放声音、不冒字、
// 爆裂者也不留引信 —— 一帧里十几只走一遍 killEnemy（每只一声斩击 + 一把碎屑 + 刀环 + 飘字），真机上会顿一下
function hClearFoe(j) {
  const e = enemies[j];
  enemies.splice(j, 1);
  hqKill(e, 'burst');
  combo += 1;
  if (combo > bestCombo) bestCombo = combo;
  comboTimer = POW.comboWindow;
  runKills += 1;
  const gain = e.score * Math.min(combo, CFG.scoreCap);
  score += gain;
  FB.pend += gain; FB.chain += gain; FB.comboPop = 1;
  const fc = THEME.foe[foeType(e)] || THEME.foe.grunt, hc = heroTarget();
  for (let k = 0; k < 6; k++) {
    const a = rand(0, Math.PI * 2), sp = rand(90, 460);
    parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.55), max: 0.55, r: rand(1.4, 3.2), c: k % 2 ? fc : hc });
  }
  if (parts.length > 360) parts.splice(0, parts.length - 360);
}
// 爆裂者炸到黑潮：圈里的一起死（explodeBlast 里调）
function hBlastHorde(b) {
  for (let i = horde.length - 1; i >= 0; i--) {
    const m = horde[i];
    if (Math.hypot(m.x - b.x, wdelta(hFront + m.yb - b.y)) <= b.r + m.r) hKill(i, 'blast');
  }
}

// 回头连斩：怒气满了才能放。从潮头开始左右来回扫 burstLegs 趟（扫到后面看得见的深处），最后回到原地收刀
// free：复仇嘉豪掉命时白送的一次（不要怒气、也不扣怒气）
function hBurstGo(free) {
  if (state !== 'play' || hBurst || (hRage < 100 && !free)) return;
  if (hTutFz) { if (hTutKey() !== 'burst') return; hTutFz = false; }    // 新手教程停住了：只有「连斩」那一步放行（2.14 节）
  if (!free) { hRage = 0; hFull = false; }
  hqAdd('burst');
  hRecoil = false;
  const fy = P.y + Math.max(hGap(), 0), xl = hX0 - W / 2 + 50, xr = hX0 + W / 2 - 50;
  let deep = 0;
  for (let i = 0; i < horde.length; i++) if (horde[i].yb > deep) deep = horde[i].yb;
  deep = clamp(Math.min(deep, cam.y + H / 2 - fy), 120, 900);      // 扫到屏幕底边（更深的收刀时一起炸）
  const pts = [], left = P.x > hX0, legs = deep > 480 ? HD.burstLegs + 1 : HD.burstLegs;
  for (let i = 0; i < legs; i++) {
    pts.push((i % 2 === 0) === left ? xl : xr, fy + 20 + deep * i / (legs - 1));
  }
  pts.push(P.x, P.y);
  hBurst = { pts: pts, k: 0, kills: 0, end: -1, boom: false };
  P.dashT = 0; P.glideT = 0; P.dashLeft = Infinity; P.dashRef = null;
  P.inv = 1e9;
  shake = Math.min(shake + 12, 24);
  FB.flash = 1; FB.flashC = UI.gold; FB.flashT = 4;
  S.whoosh(); S.tierUp(4); vibrate(2);
}
function hBurstStep(dt) {
  const b = hBurst;
  P.px = P.x; P.py = P.y;
  if (b.end >= 0) {
    b.end += dt;
    if (!b.boom && b.end >= 0.22) hBurstBoom();
    if (b.end >= 0.6) hBurstDone();
    return;
  }
  let left = HD.burstSp * dt;
  while (left > 0 && b.k < b.pts.length) {
    const tx = b.pts[b.k], ty = b.pts[b.k + 1], dx = tx - P.x, dy = ty - P.y, d = Math.hypot(dx, dy);
    const st = Math.min(left, d), ux = d > 0 ? dx / d : P.dx, uy = d > 0 ? dy / d : P.dy;
    const x0 = P.x, y0 = P.y, x1 = x0 + ux * st, y1 = y0 + uy * st;
    for (let i = horde.length - 1; i >= 0; i--) {
      const m = horde[i];
      if (segDist(x0, y0, x1, y1, m.x, hMemberY(m)) <= HD.burstR) { hKill(i, 'burst'); b.kills++; }
    }
    // 刀路上挡路的怪也一起斩
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (segDist(x0, y0, x1, y1, P.x + wdelta(e.x - P.x), P.y + wdelta(e.y - P.y)) > HD.burstR * 0.6 + e.r) continue;
      hClearFoe(j);
      b.kills++;
    }
    P.x = x1; P.y = y1;
    P.dx = ux; P.dy = uy; P.ang = Math.atan2(uy, ux);
    P.vx = ux * HD.burstSp; P.vy = uy * HD.burstSp;
    left -= st;
    if (st >= d - 0.01) b.k += 2;
  }
  P.dashT = 0.05;                        // 画成冲刺的样子
  ghosts.push({ x: P.x, y: P.y, r: P.r, a: P.ang, life: 0.3, max: 0.3 });
  trail.push({ x: P.x, y: P.y, life: 0.13, max: 0.13 });
  if (trail.length > 16) trail.shift();
  // 环形世界跨界：路点、镜头跟着挪（同 stepPlayer）
  const jy = P.y - wwrap(P.y);
  if (jy) {
    P.y -= jy; P.py -= jy; cam.y -= jy; camLap.y += jy;
    for (let k = 1; k < b.pts.length; k += 2) b.pts[k] -= jy;
  }
  if (b.k >= b.pts.length) { b.end = 0; P.dashT = 0; P.vx = 0; P.vy = 0; P.ang = -Math.PI / 2; P.dx = 0; P.dy = -1; }
}
// 收刀：剩下的黑潮、屏幕里挡路的，全炸
function hBurstBoom() {
  const b = hBurst;
  b.boom = true;
  const n0 = horde.length;
  for (let i = horde.length - 1; i >= 0; i--) hKill(i, 'boom');
  b.kills += n0;
  // 清全屏：屏幕里挡路的怪也一起斩了
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (Math.abs(wdelta(e.y - cam.y)) > H / 2 + 60) continue;
    hClearFoe(j);
    b.kills++;
  }
  if (b.kills > hBestBurst) hBestBurst = b.kills;
  hqMax('burstMax', b.kills);                      // 任务：一次回头连斩斩几只（2.15 节）
  // 整片墨潮炸开：墨块和红火星从潮面上四散
  const fy = P.y + Math.max(hGap(), 0), y1 = cam.y + H / 2;
  for (let k = 0; k < 70; k++) {
    const x = hX0 + rand(-W / 2, W / 2), y = rand(fy, Math.max(fy + 40, y1)), a = rand(0, Math.PI * 2), sp = rand(120, 560);
    parts.push({ x: x, y: wwrap(y), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: rand(0.35, 0.9), max: 0.9,
                 r: k % 3 ? rand(3, 7) : rand(1.5, 3), c: k % 3 ? '#1c0812' : '#ff4a5e' });
  }
  if (parts.length > 360) parts.splice(0, parts.length - 360);
  shake = 30;
  rings.push({ x: P.x, y: P.y, r0: 30, r1: W * 0.7, life: 0.5, max: 0.5, color: UI.gold, w: 6 });
  rings.push({ x: P.x, y: P.y, r0: 12, r1: W * 0.4, life: 0.32, max: 0.32, color: '#ffffff', w: 3 });
  callout('一口气 ' + b.kills + ' 斩', UI.gold, Math.min(64, 40 + b.kills / 8), 150);
  S.tierUp(6); vibrate(3);
}
// 清完全屏：身后的黑潮从屏幕外重新慢慢涌上来（喘口气）；前面马上冒出一串斩得上去的怪，连斩接着往上斩
function hBurstDone() {
  hBurst = null;
  P.inv = 0.5;
  hNewWave();
  if (HD.path) hPathFill(P.y - 260); else hRefillAhead();   // 路线：从你身前重新摆一条（混着随机的：再往上照常一组组摆）
}
// 清屏后前面冒出来的一串：身前 refill0 起，每级往上 refillStep、左右交替错开 —— 一刀够得着下一只，一刀接一刀斩上去；
// 再往上照常一组组摆到屏幕顶（冒出来的时候从地里长出来，不是凭空出现）
function hRefillAhead() {
  const xl = hX0 - W / 2 + 70, xr = hX0 + W / 2 - 70, side = P.x > hX0 ? -1 : 1;
  let y = P.y - HD.refill0;
  for (let i = 0; i < HD.refillN; i++, y -= HD.refillStep) {
    const e = spawnEnemy(clamp(P.x + side * (i % 2 ? 1 : -1) * 70 + rand(-20, 20), xl, xr), wwrap(y), 'grunt');
    if (!e) break;
    e.sp = HD.refillSp * rand(0.85, 1.15);
    e.born = 0;
  }
  hFillAhead(y + HD.refillStep - hBlockGap());         // 接着这一串最后那只往上摆
}

// 挡路的怪：慢慢朝你走（重型被砍开外壳那一下愣住）；落到潮头后面的被黑潮吞掉
function hTickBlockers(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.born = Math.min(1, e.born + dt * 4);
    e.wob += dt * 4;
    if (e.armorT > 0) e.armorT -= dt;
    if (e.crackT > 0) e.crackT -= dt;
    // 整只没进墨里：被吞了。远近一律从主角这儿量（e.y - hFront 直接 wdelta 的话，黑潮落在身后一屏多、怪刚摆在屏幕顶，
    // 两者隔了大半圈世界，会被绕成"在潮头后面"当场删掉 —— 1024.1253 连斩完往前冲，前面一大片没怪就是这么来的）。
    // 跑过去、掉出屏幕底边的也收掉（它们比你慢，追不回来了）：不然占着名额，前面摆不出新的（HD.blockMax）
    const ey = wdelta(e.y - P.y);
    if (ey - hGap() > HD.gap * HD.inkEdge + e.r + 30 || ey > hBottomGap() + e.r + 40) { enemies.splice(i, 1); continue; }
    if (e.heavy && e.armorT > 0) continue;
    const dx = P.x - e.x, dy = wdelta(P.y - e.y), d = Math.hypot(dx, dy) || 1;
    // 冲锋者：蓄力（站住，红环收紧）→ 照蓄力时你在的方向直冲 0.42 秒 → 接着慢慢走
    if (e.charger && e.mode === 'wind') {
      e.t -= dt;
      if (e.t <= 0) { e.mode = 'charge'; e.t = 0.42; }
      continue;
    }
    if (e.charger && e.mode === 'charge') {
      e.t -= dt;
      const cv = 640 * hTempo();
      e.x = clamp(e.x + e.cdx * cv * dt, hX0 - W / 2 + e.r, hX0 + W / 2 - e.r);
      e.y = wwrap(e.y + e.cdy * cv * dt);
      if (e.t <= 0) { e.mode = 'walk'; e.t = 1.4; }       // 冲完歇一会儿才会再蓄力
      continue;
    }
    if (e.charger && e.t > 0) e.t -= dt;
    else if (e.charger && d < HD.chargeR && dy > -40) { e.mode = 'wind'; e.t = 0.6 / Math.sqrt(hTempo()); e.cdx = dx / d; e.cdy = dy / d; }
    const sp = e.sp * hTempo();
    if (e.pth && dy > 0) { e.y = wwrap(e.y + sp * dt); continue; }   // 路上的队形（HD.path）：整队往下压，队形不散
    e.x = clamp(e.x + dx / d * sp * dt, hX0 - W / 2 + e.r, hX0 + W / 2 - e.r);
    e.y = wwrap(e.y + dy / d * sp * dt);
  }
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j], dx = b.x - a.x, dy = wdelta(b.y - a.y), d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d > 0.001 && d < min) {
        const push = (min - d) / d * 0.25;
        a.x -= dx * push; a.y = wwrap(a.y - dy * push);
        b.x += dx * push; b.y = wwrap(b.y + dy * push);
      }
    }
  }
}

// 黑潮试玩每一帧（update 开头就转到这里，原来那一大套都不跑）
function updateHorde(dt) {
  if (hIntro) {
    // 开场：只放这一段（挡路的不动、人不受控制）；连斩那一下黑潮照常追
    gameTime += dt;
    hWaveT = 0;     // 压上来那一段潮头由开场推着走（下面 hIntroStep 覆盖）；连斩、收刀时只慢慢跟，不涌浪
    hTickHorde(dt);
    hIntroStep(dt);
    cam.x = hX0;
    cam.y += wdelta(P.y - HD.camY * H - cam.y) * (1 - Math.exp(-6 * dt));
    if (combo > 0 && !hIntro) comboTimer = POW.comboWindow;
    updateFX(dt);
    return;
  }
  // 新手教程停住了（暗屏 + 高光，2.14 节）：整个世界不动（时间、黑潮、怪、连斩倒计时、镜头），只等玩家照着点
  // 卡片也在这里淡入：「连斩」那一步一进来就停，卡片还没来得及淡入（以前停着时卡片、暗屏、手指一样都不画 —— 用户："怎么连斩没有引导啊"）
  if (hTutFz) { hTutFzA = Math.min(1, hTutFzA + dt * 5); hTutA = Math.min(1, hTutA + dt * 3.4); return; }
  const wdt = hBurst ? dt * HD.burstSlow : dt;       // 回头连斩时，别的东西几乎停住
  gameTime += wdt;
  if (!hBurst) hWaveT += dt;
  if (!hBurst && !hTutOn()) hDiffT += dt;    // 越来越难（HD.heat0）：开场、教程、连斩里不算
  hTutTick(dt);                              // 新手教程 / 道具卡（2.14 节）：真实时间走，连斩的慢动作里也照走
  hTeachTick(wdt);                           // 班主任（HD.teach*）
  hMomTick(wdt); hMomPopTick(wdt);                             // 势头：发呆慢慢掉
  hTapBufTick();                             // 提前按的那一下：落地了就出刀
  if (P.cd > 0) P.cd = Math.max(0, P.cd - dt);
  if (P.glideT > 0) P.glideT = Math.max(0, P.glideT - dt);
  if (P.inv > 0 && !hBurst) P.inv = Math.max(0, P.inv - dt);
  if (hHurtT > 0) hHurtT = Math.max(0, hHurtT - dt);

  if (hBurst) hBurstStep(dt);
  else {
    if (hPropOn('ghost')) hGhostStep(dt);    // 鬼火：自己往前猛冲（2.13 节）
    else {
      if (P.dashT > 0 && P.dashRef && hAimExtra >= 0) hHome();
      stepPlayer(dt);
    }
    const xl = hX0 - W / 2 + P.r + 4, xr = hX0 + W / 2 - P.r - 4;     // 走廊就是一屏宽
    if (P.x < xl) { P.x = xl; if (P.vx < 0) P.vx = 0; }
    if (P.x > xr) { P.x = xr; if (P.vx > 0) P.vx = 0; }
    // 斩了黑潮里的：收刀往回弹（往上），弹的时候无敌一小下
    if (hRecoil && P.dashT <= 0) {
      hRecoil = false;
      P.vx = 0; P.vy = -HD.recoil;
      P.inv = Math.max(P.inv, HD.recoilInv);
    }
  }
  hClimb += P.py - P.y;
  if (hClimb > hTop) {
    const m0 = Math.floor(hTop / HD.m);
    hTop = hClimb;
    score += 2 * (Math.floor(hTop / HD.m) - m0);     // 每往上一米 2 分
    if (Math.floor(hTop / HD.m) > m0) hqMeters(Math.floor(hTop / HD.m));   // 任务：跑多远（2.15 节）
    // 每往上逃 waveM 米进下一波：黑潮更快、挡路的更难。不弹横幅、不响（用户："你不要每波都提示更快了，这些没意义"）
    const w = 1 + Math.floor(hTop / HD.m / HD.waveM);
    if (w > hWave) {
      hWave = w; layer = w;
      hqSet('wave', w);                            // 任务：再闯过几波（2.15 节）
      POW.dashSpeed = CFG.dashSpeed * hTempo();
    }
  }
  if (!hBurst) {
    hTickHorde(dt);
    // 一组接一组往上摆（HD.blockGap）：这一组摆在屏幕顶外，hNext = 再往上走多远摆下一组（这一组有多高 + 间隔）。
    // 名额满了就等一等（不跳过）；等过了的照样摆在屏幕顶外，间隔从现在算
    if (HD.path && hPathLive && !hTutQuiet()) hPathGen();   // 路线：往上接着摆（只有路线的话糖、道具也在路上）
    if (!HD.path || HD.pathMix) {
      while (hTop >= hNext && enemies.length < hBlockMax()) {
        const late = Math.min(hTop - hNext, 40), y = cam.y - H / 2 - 70 + late;
        const t = hBlock(y);
        if (!t) break;
        hNext = hTop - late + Math.max(0, -wdelta(t.y - y)) + hBlockGap();
      }
      if (PROP.on) hSpawnProps();                     // 道具、嘉欣糖（2.13 节）
    }
  }
  // 黑潮贴近不再一直微微抖、猛涌也不再一路抖（用户："振动太多看起来像掉帧"：震屏是每帧随机偏一下，一直开着就是一顿一顿的）。
  // 猛涌只在涌起来那一下抖一次（见 hSurge = 2）；贴近的压迫感交给潮边、心跳和嗡鸣
  if (!hBurst && horde.length && HD.closeShake > 0) {
    const g = hGap();
    if (g < HD.closeShake) shake = Math.max(shake, 3.5 * (1 - Math.max(0, g) / HD.closeShake));
  }
  hTickBlockers(wdt);
  updateProps(wdt);                                  // 爆裂者的引信 / 爆炸
  if (state !== 'play') return;
  if (PROP.on) hTickProps(wdt);                      // 捡道具 / 糖、道具倒计时、鬼火的剑气（在碰撞之前：剑气先斩）
  if (hSkill('dj')) hDjTick();                       // 打碟嘉豪：连斩每满 10 一圈音波（2.13 节）

  // ---- 碰撞：冲刺 / 收刀余势里碰到就是斩到；别的时候碰到就死 ----
  if (!hBurst) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (segDist(P.px, P.py, P.x, P.y, P.x + wdelta(e.x - P.x), P.y + wdelta(e.y - P.y)) > P.r + e.r) continue;
      if (P.dashT > 0 || P.glideT > 0 || gameTime - lastDashEnd < HD.cutGrace) {
        if (e.heavy && e.cracked && e.armorT > 0) continue;
        if (e.heavy && !e.cracked) { crackEnemy(e); continue; }
        hAddRage(e.heavy ? HD.rage.heavy : HD.rage.foe);
        killEnemy(i);
      } else if (P.inv > 0 || hTutOn() || (e.heavy && e.armorT > 0) || hBehind(e)) { /* 无敌 / 新手教程里 / 被砍开外壳愣住的重型 / 碰在身侧身后：穿过 */ }
      else if (hMomRam(e)) killEnemy(i, 'ram');   // 势头够：撞飞
      else { markDeath(e); die(FOE_NAME[foeType(e)]); return; }
    }
    for (let i = horde.length - 1; i >= 0; i--) {
      const m = horde[i], my = hMemberY(m);
      if (segDist(P.px, P.py, P.x, P.y, m.x, my) > P.r + m.r) continue;
      if (P.dashT > 0 || P.glideT > 0) { hKill(i, 'cut'); hRecoil = true; continue; }
      // 每一刀带的（dashTime + 0.1）、斩了黑潮往回弹的（recoilInv）这种零点几秒的无敌，只挡潮头扑上来的那几只；
      // 潮头已经漫过你（hGap() <= 0）就是被追上了。以前照样穿过去，等无敌完了才算死：
      // 用户截图里死的时候潮头已经冲过嘉豪大半屏（"我死的时候，这玩意都跑屏幕多少了"）。
      // 掉命 / 复活后一闪一闪的那段（hHurtT）、长的无敌（教完、鬼火冲完的那一秒，测试里的）照旧全挡
      if (hTutOn() || (P.inv > 0 && (hHurtT > 0 || P.inv > HD.overrunInv || hGap() > 0))) continue;
      deathMark = { x: m.x, y: wwrap(my), r: m.r, ux: 0, uy: -1, blast: false };
      deathInfo = [Math.round((gameTime - lastDashEnd) * 1000), -1];
      die('黑潮');
      return;
    }
  }
  // 怒气满了：「连斩」键自己会变金、呼吸，只响一声，不在头顶再写字
  if (hRage >= 100 && !hFull) {
    hFull = true;
    S.tierUp(2);
  }

  // ---- 连斩窗口（回头连斩时不断）----
  if (combo > 0 && !hBurst) {
    comboTimer -= dt;
    if (comboTimer <= 0) { fbChainEnd(combo); combo = 0; comboTimer = 0; }
  }

  // ---- 氛围：黑潮越近，心跳越急 ----
  danger += (clamp(1 - (hGap() - 60) / 600, 0, 1) - danger) * Math.min(1, dt * 3);
  S.setTension(danger);
  S.setBgm(bgmLvOf(combo));   // 音乐只跟连斩走：过一道门槛，曲子厚一层（危险度交给心跳和嗡鸣）
  if (S.bgmOn()) S.setHeart(danger);

  // ---- 镜头：横着不动（走廊一屏宽），竖着跟人，人在正中略往下 ----
  cam.x = hX0;
  if (hBurst) {
    // 回头连斩：整片黑潮就在屏幕里，镜头不跟着来回冲（跟着冲还得一路重画地面，1024.1129 那几帧 66 毫秒的卡顿就在这儿），
    // 人快冲出屏幕边才挪一点
    const m = 90;
    cam.y = clamp(cam.y, P.y - H / 2 + m, P.y + H / 2 - m);
  } else {
    const ty = P.y - HD.camY * H;
    cam.y += wdelta(ty - cam.y) * (1 - Math.exp(-9 * dt));
  }
  if (hPathOn() && !hBurst) {                // 路线：路上的下一只是谁（锁、画都看它）
    hPathTick();
    // 跟丢了：下一只一阵子都不在斜前方（一刀 + 90 以内）、也没有下一只 —— 剩下的路散掉，从你身前重新摆
    const n = hPathHead, R = hAimR() + 90, dx = n ? wdelta(n.x - P.x) : 0, dy = n ? wdelta(n.y - P.y) : 0;
    if (!HD.fillWait || state !== 'play' || P.dashT > 0 || hPropOn('ghost') || hTutQuiet() || (n && (hSideOk(-1, dx, dy, R) || hSideOk(1, dx, dy, R)))) hPathLostT = 0;
    else if ((hPathLostT += dt) > (!n || Math.abs(dx) > hAimR() * Math.sin(HD.sideMax * Math.PI / 180) + 30 ? HD.lostQuick : HD.fillWait / hFixK())) { hPathLostT = 0; hPathReroute(); }   // 横着够不着：马上重摆（HD.lostQuick）；不然越往后等得越久（HD.fixHeat）
  }
  if (HD.twoBlades) {                        // 两把斩：左右各锁各的
    hAimTL = hBurst ? null : hLockSide(-1); hAimTR = hBurst ? null : hLockSide(1);
    hLockNote(-1, hAimTL); hLockNote(1, hAimTR);
    hAimT = hAimTR || hAimTL;
  } else hAimT = hBurst ? null : hLock(inputDir() || { x: 0, y: -1 });   // 准星、斩键亮不亮都看它
  hFillDry(dt);
  updateFX(dt);
}
// 兜底（HD.fillWait）：fillWait 秒没东西可斩（不在冲刺里、不在连斩 / 鬼火里），前面一刀外长出一只
function hFillDry(dt) {
  if (!HD.fillWait || state !== 'play' || hBurst || hPropOn('ghost') || hAimT || P.dashT > 0 || hTutQuiet()) { hDryT = 0; return; }
  hDryT += dt;
  if (hDryT < HD.fillWait) return;
  // 斜前方再远一点（一刀 + 110）已经有怪、马上就进范围（比如上一只冒出来的还没走到）：不再冒。
  // 冒的地方最远在一刀 + 80、横着偏 130，离你 √(130² + (一刀+80)²) ≈ 一刀 + 101 —— 以前只看到 + 90，偶尔冒在外面又接着冒一只
  const R = hAimR() + 110;
  if (hPathOn()) { hDryT = 0; return; }      // 路线：跟丢了从你身前重新摆（hPathLostT），不另外冒
  for (let i = 0; i < enemies.length; i++) {
    const dx = wdelta(enemies[i].x - P.x), dy = wdelta(enemies[i].y - P.y);
    if (hSideOk(-1, dx, dy, R) || hSideOk(1, dx, dy, R)) return;
  }
  hDryT = 0;
  const off = P.x - hX0, s = Math.abs(off) > 120 ? -Math.sign(off) : (Math.random() < 0.5 ? -1 : 1);
  const e = spawnEnemy(clamp(P.x + s * rand(30, 130), hX0 - W / 2 + 70, hX0 + W / 2 - 70), wwrap(P.y - hAimR() - rand(30, 80)), 'grunt');
  if (!e) return;
  e.sp = HD.refillSp * rand(0.85, 1.15);     // 慢吞吞的：等你斩，不自己扑上来
  e.born = 0;                                // 从地里长出来
}

/* ---------- 黑潮（2.12 节）的画面 ---------- */
// 墨里的眼睛：三张贴图 —— 两张亮的（眼睛位置不一样，贴在潮面下第一块、隔一会儿换一张 = 眨眼）、
// 一张暗的（更深处，眼睛又少又暗 = 越往后越看不清），按 DPR × SC 画；建不出来就不画眼睛。
// 眼睛的光是两圈半透明的圆叠出来的（不用渐变：真机上渐变时有时无）。
// 以前两张半透明交替叠着贴、再压两层全宽的黑：黑潮贴近时墨占半屏，1024.1253 真机一帧 7 毫秒。
// 现在贴图连墨底一起烤（不透明），左右各宽出 HEY_PAD（贴图左右晃 4、抖屏最多约 11，露不出底下）
const HBT = { k: 0, c: [], off: false }, HEY_PAD = 16;
let hInkFrac = 0;     // 这一帧墨潮盖了屏幕几成（测试数据：黑潮在屏幕里 / 不在 分开记帧数）
function hEyeTile(v) {
  const k = DPR * SC;
  if (HBT.off) return null;
  if (HBT.k !== k || HBT.c.length < 3) {
    HBT.k = k; HBT.c = [];
    try {
      const th = HD.eyeTileRows * HD.gap, tw = W + HEY_PAD * 2;
      for (let t = 0; t < 3; t++) {
        const dim = t === 2;
        const cv = IS_MG ? MG.createCanvas() : document.createElement('canvas');
        cv.width = Math.ceil(tw * k); cv.height = Math.ceil(th * k);
        const g = ctx2d(cv);
        g.setTransform(k, 0, 0, k, 0, 0);
        g.fillStyle = HD.inkTileC;
        g.fillRect(0, 0, tw, th);
        const eyes = [];
        for (let i = 0, n = Math.round(W * th / (dim ? 9000 : 5200)); i < n; i++) {
          eyes.push(HEY_PAD + rand(14, W - 14), rand(10, th - 10), rand(2.3, 3.6) * (dim ? 0.8 : 1), rand(6, 9));
        }
        const pass = function (rk, c) {
          g.beginPath();
          for (let i = 0; i < eyes.length; i += 4) {
            const x = eyes[i], y = eyes[i + 1], r = eyes[i + 2] * rk, d = eyes[i + 3];
            g.moveTo(x - d + r, y); g.arc(x - d, y, r, 0, Math.PI * 2);
            g.moveTo(x + d + r, y); g.arc(x + d, y, r, 0, Math.PI * 2);
          }
          g.fillStyle = c;
          g.fill();
        };
        pass(3.2, dim ? 'rgba(255,40,60,0.05)' : 'rgba(255,40,60,0.10)');
        pass(1.9, dim ? 'rgba(255,50,70,0.10)' : 'rgba(255,50,70,0.22)');
        pass(1, dim ? 'rgba(200,40,60,0.55)' : '#ff4a5e');
        HBT.c.push(cv);
      }
    } catch (e) { HBT.off = true; HBT.c = []; return null; }
  }
  return HBT.c[v];
}
// 世界 y 从这往下整片都是不透明的墨（贴着眼睛图），地面不用画；墨不画 / 贴图建不出来 = Infinity
function hInkSolid() {
  if (!hordeMode || !horde.length || !hEyeTile(0)) return Infinity;
  return P.y + hGap() + HD.gap * HD.inkEdge + HD.inkSolid;
}
// 潮面在 x 处比潮线往后多少：两道波叠起来慢慢起伏，再时不时伸出几根墨刺（往前，负的）
function hInkEdge(x, t) {
  const a = hSurge === 2 ? 1.9 : hSurge === 1 ? 1.3 : 1;              // 涌浪：翻得更凶
  let y = HD.gap * HD.inkEdge + a * (9 * Math.sin(x * 0.021 + t * 2.1) + 6 * Math.sin(x * 0.053 - t * 3.3));
  for (let k = 0; k < 4; k++) {
    const sx = hX0 - W / 2 + ((k * W / 4 + t * (30 + 12 * k)) % W), d = (x - sx) / 20;
    y -= a * 55 * Math.max(0, Math.sin(t * 1.3 + k * 2.2)) * Math.exp(-d * d);
  }
  return y;
}

const HEY = new Float32Array(98);    // 潮面那条线的点（每帧重用，不新建数组）
/* 黑潮的样子分两层画：
   drawHorde —— 最前面两排的怪一只只画（身子一笔、两道边各一笔、红芯一笔），先画；
   drawHordeInk —— 一片涌上来的墨（潮面一笔填、边上的光两笔描），墨里的眼睛贴三四块图，往后压两层黑，
   在挡路的怪之后画、盖在它们上面（用户："墨潮的边缘遮挡不到后面追逐的怪物，要改成能遮挡"）：
   潮面以前的怪露在外面，潮面以后的（半个身子、掉进墨里的挡路怪）都淹在墨里。十几笔，跟有多少只无关 */
// 潮面那条线：这一帧算一次（drawHorde 先用来挑露在墨外的怪，drawHordeInk 再用来画墨）
let hEyN = -1;
function hInkEdgeLine() {
  const n = 48, xl = hX0 - W / 2 - 12, xr = hX0 + W / 2 + 12, fy = P.y + hGap(), t = nowMs() / 1000;
  for (let i = 0; i <= n; i++) { const x = xl + (xr - xl) * i / n; HEY[i * 2] = x; HEY[i * 2 + 1] = fy + hInkEdge(x, t); }
  hEyN = BG.frame;
}
// 潮面在 x 处的世界 y（HEY 上插值）
function hInkEdgeAt(x) {
  const n = 48, xl = HEY[0], xr = HEY[n * 2], f = clamp((x - xl) / (xr - xl), 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  return HEY[i * 2 + 1] + (HEY[i * 2 + 3] - HEY[i * 2 + 1]) * k;
}
function drawHorde() {
  if (!horde.length) return;
  const top = cam.y - H / 2 - 30, bot = cam.y + H / 2 + 30, fy = P.y + hGap();
  hInkEdgeLine();
  // 一只只的怪，跟挡路的同一个样子（淹在墨里的那截等会儿被墨盖住）。
  // 黑潮一进屏幕就卡（1027.0950 测试数据：黑潮这一项每帧 1.3 毫秒，一笔 300 多微秒）：真机上贵的是路径的点数，
  // 前两排二三十只、每只 11 个点、填一遍描两遍，比全场挡路的怪加起来还多。现在每只 8 个点（半径才十来个像素，看不出来），
  // 整只淹在潮面下的不画（墨 0.95 盖着，本来就只透出一丝）
  const lim = HD.frontRows * HD.gap, fc = foeColor(horde[0]);
  let any = false;
  ctx.beginPath();
  for (let i = 0; i < horde.length; i++) {
    const m = horde[i], y = fy + m.yb;
    if (y < top || y > bot || m.yb >= lim || y - m.r * 1.1 - 4 > hInkEdgeAt(m.x)) continue;
    for (let s2 = 0; s2 < 8; s2++) {
      const a = (s2 / 8) * Math.PI * 2, rr = m.r * (1 + 0.10 * Math.sin(m.wob * 1.7 + s2 * 2.6));
      if (s2) ctx.lineTo(m.x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(m.x + rr, y);
    }
    ctx.closePath();
    any = true;
  }
  if (!any) return;
  ctx.fillStyle = THEME.enemyBody;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = rgba(fc, 0.16);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(fc, 0.9);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < horde.length; i++) {
    const m = horde[i], y = fy + m.yb;
    if (y < top || y > bot || m.yb >= lim || y - m.r * 1.1 - 4 > hInkEdgeAt(m.x)) continue;
    const r = m.r * (0.42 + Math.sin(m.wob) * 0.08);
    ctx.moveTo(m.x + r, y);
    ctx.arc(m.x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = rgba(fc, 0.6);
  ctx.fill();
}
function drawHordeInk() {
  hInkFrac = 0;
  if (!horde.length) return;
  const top = cam.y - H / 2 - 30, bot = cam.y + H / 2 + 30, fy = P.y + hGap(), t = nowMs() / 1000;
  const xl = hX0 - W / 2 - 12, xr = hX0 + W / 2 + 12, ey = HEY;
  if (hEyN !== BG.frame) hInkEdgeLine();       // 一般 drawHorde 已经算过这一帧的
  const solid = hInkSolid();
  hInkFrac = clamp((cam.y + H / 2 - fy) / H, 0, 1);
  if (fy - 60 < bot) {
    // 潮面：只填到贴图开始的地方（再往下是不透明的眼睛图），多盖 2 免得接缝漏底
    const yb = Math.min(bot, solid + 2);
    ctx.beginPath();
    ctx.moveTo(xl, yb);
    for (let i = 0; i < ey.length; i += 2) ctx.lineTo(ey[i], ey[i + 1]);
    ctx.lineTo(xr, yb);
    ctx.closePath();
    ctx.fillStyle = HD.inkC;
    ctx.fill();
    // 潮面镶一道暗红的光
    ctx.beginPath();
    for (let i = 0; i < ey.length; i += 2) { if (i) ctx.lineTo(ey[i], ey[i + 1]); else ctx.moveTo(ey[i], ey[i + 1]); }
    // 涌浪憋着的时候潮边一闪一闪地亮、猛涌时一直亮：看到就该往前斩了
    const hot = hSurge === 1 ? 0.5 + 0.5 * Math.sin(hSurgeP * 28) : hSurge === 2 ? 1 : 0;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8 + 10 * hot;
    ctx.strokeStyle = 'rgba(255,40,70,' + (0.12 + 0.2 * hot).toFixed(3) + ')';
    ctx.stroke();
    ctx.lineWidth = 2.5 + 1.5 * hot;
    ctx.strokeStyle = hot ? 'rgba(255,110,120,' + (0.75 + 0.25 * hot).toFixed(3) + ')' : 'rgba(255,72,96,0.75)';
    ctx.stroke();
    ctx.lineJoin = 'miter';
    // 墨里的眼睛：潮面下第一块贴亮的（0.7 秒换一张 = 眨眼），更深的贴暗的；每块一笔、不透明（墨底一起烤在图里）
    const th = HD.eyeTileRows * HD.gap;
    if (solid < Infinity) {
      for (let k = 0, y = solid; y < bot; k++, y += th) {
        if (y + th < top) continue;
        const sx = Math.sin(t * 0.8 + k) * 4;
        ctx.drawImage(hEyeTile(k ? 2 : Math.floor(t / 0.7) % 2), hX0 - W / 2 - HEY_PAD + sx, y, W + HEY_PAD * 2, th + 1);   // 多 1：块和块之间不留缝
      }
    }
  }
}
// 这一刀会砍谁：四个转着的角 + 一根细线连过去（爆裂者红）。点「斩」就是它
/* ---------- 班主任（HD.teach*）：她看着的时候不能打架 ---------- */
let hTeach = [];           // 路边的班主任：{ x, y, base 视线正中朝哪（弧度）, ph 扫的相位, angry 被抓那一下红多久 }
let hTeachNext = 0;        // hTop 到这儿摆下一个
let hCaughtT = 0;          // 被抓：还要愣几秒（出不了刀）
let hCaughtN = 0;          // 这一局被抓了几次（测试数据）
let hTeachPop = null;      // 第一次见到班主任：弹一张卡说怎么回事（{ t }）
function hTeachReset() { hTeach = []; hTeachNext = 0; hCaughtT = 0; hCaughtN = 0; hTeachPop = null; }
// 这一刻视线朝哪
function hTeachDir(T) { return T.base + HD.teachSweep * Math.PI / 180 * Math.sin(gameTime * Math.PI * 2 / HD.teachPeriod + T.ph); }
// (x, y) 在不在哪个班主任的视线里
function hInGaze(x, y) {
  for (let i = 0; i < hTeach.length; i++) {
    const T = hTeach[i], dx = wdelta(x - T.x), dy = wdelta(y - T.y);
    if (dx * dx + dy * dy > HD.teachR * HD.teachR) continue;
    let da = Math.atan2(dy, dx) - hTeachDir(T);
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) <= HD.teachHalf * Math.PI / 180) return T;
  }
  return null;
}
// 斩 t 会不会被抓（人在视线里、或者 t 在视线里）
function hTeachSees(t) { return hInGaze(P.x, P.y) || (t ? hInGaze(t.x, t.y) : null); }
// 被抓：愣一下、黑潮往前扑（不扑过头），班主任红一下
function hCaught(T) {
  hCaughtT = HD.teachStun; hCaughtN++;
  hMomAdd(-HD.momCaught);                   // 势头：被抓掉一档半
  if (T) T.angry = 0.8;
  const g = hGap();
  if (g > 0) hFront = wwrap(P.y + Math.max(Math.min(g, 80), g - HD.teachLunge));
  rings.push({ x: P.x, y: P.y, r0: P.r, r1: 70, life: 0.4, max: 0.4, color: '#ff4a3a', w: 5 });
  if (T) rings.push({ x: T.x, y: T.y, r0: 20, r1: 90, life: 0.4, max: 0.4, color: '#ff4a3a', w: 4 });
  shake = Math.max(shake, 6);
  S.thump(0.8); vibrate(2);
}
// 每帧：往前摆、掉到身后的收掉、被抓的倒计时、第一次见到弹卡
function hTeachTick(dt) {
  if (hCaughtT > 0) hCaughtT = Math.max(0, hCaughtT - dt);
  for (let i = hTeach.length - 1; i >= 0; i--) {
    const T = hTeach[i];
    if (T.angry > 0) T.angry -= dt;
    if (wdelta(T.y - P.y) > H * 0.8) hTeach.splice(i, 1);
  }
  if (!hTeachPop && !meta.seen.teach && hTeach.some(function (T) { return Math.abs(wdelta(T.y - cam.y)) < H * 0.4; })) {
    hTeachPop = { t: 0 }; meta.seen.teach = 1; saveMeta();
  }
  if (hTeachPop && (hTeachPop.t += dt) > 3.5) hTeachPop = null;
  if (hDiffT < HD.teachFrom || hTutOn() || hIntro) return;
  if (!hTeachNext) hTeachNext = hTop + 20 * HD.m;
  if (hTop < hTeachNext) return;
  // 摆在屏幕顶外、走廊一边，视线朝走廊中间、稍微朝下（朝你来的方向）
  const side = Math.random() < 0.5 ? -1 : 1, x = hX0 + side * (W / 2 - 60);
  hTeach.push({ x: x, y: wwrap(cam.y - H / 2 - 120), base: (side < 0 ? 0 : Math.PI) + (side < 0 ? 1 : -1) * 0.3, ph: rand(0, 6.28), angry: 0 });
  hTeachNext = hTop + Math.max(HD.teachMin, HD.teachEvery - HD.teachHeat * hHeat()) * HD.m * rand(0.8, 1.2);
}
// 画：视线一道半透明红扇形（一填一描），人是一个紫灰的身子 + 脑袋 + 一道眼镜；被抓那一下全身发红
function drawTeachers() {
  for (let i = 0; i < hTeach.length; i++) {
    const T = hTeach[i], x = wdx(T.x), y = wdy(T.y);
    if (Math.abs(wdelta(T.y - cam.y)) > H / 2 + HD.teachR) continue;
    const a = hTeachDir(T), h = HD.teachHalf * Math.PI / 180, mad = T.angry > 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, HD.teachR, a - h, a + h);
    ctx.closePath();
    ctx.fillStyle = mad ? 'rgba(255,60,40,0.3)' : 'rgba(255,70,50,0.14)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,90,70,0.55)';
    ctx.stroke();
    ctx.fillStyle = mad ? '#ff5a46' : '#8a7aa8';
    ctx.fillRect(x - 22, y - 8, 44, 48);
    ctx.beginPath();
    ctx.arc(x, y - 25, 18, 0, Math.PI * 2);
    ctx.fillStyle = mad ? '#ffb0a0' : '#e8d8c8';
    ctx.fill();
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(x - 14 + Math.cos(a) * 4, y - 29, 28, 5);   // 眼镜：跟着视线往那边偏一点
  }
  // 人在视线里：身上一圈红（这时候出刀就被抓）
  if (state === 'play' && hInGaze(P.x, P.y)) {
    ctx.beginPath();
    ctx.arc(P.x, P.y, P.r + 10, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,74,58,0.85)';
    ctx.stroke();
  }
}
// 第一次见到班主任：弹一张卡（不再弹第二次）
function drawTeachPop() {
  if (!hTeachPop || state !== 'play') return;
  const t = hTeachPop.t, w = Math.min(W_CSS - 40, 300), h = 64, y = hTutCardY() + (hPropPop ? 84 : 0);
  ctx.save();
  ctx.globalAlpha = clamp((3.5 - t) / 0.5, 0, 1) * clamp(t / 0.15, 0, 1);
  hText('teachPop', 'teach', W_CSS / 2 - w / 2, y - h / 2, w, h, function () {
    bladeBox(1, 1, w - 2, h - 2, { c: 10, top: 'rgba(40,14,14,0.92)', bot: 'rgba(18,8,8,0.92)', border: 'rgba(255,90,70,0.8)', lw: 1.4, ticks: '#ff5a46' });
    ctx.textAlign = 'left';
    uf(900, 16);
    ctx.fillStyle = '#ff8a7a';
    ctx.fillText('班主任', 16, 24);
    uf(600, 12);
    ctx.fillStyle = 'rgba(255,235,230,0.9)';
    ctx.fillText('她看着的时候不能打架：', 16, 42);
    ctx.fillText('人或嘉豪在红色视线里出刀，会被抓', 16, 57);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawHordeAim() {
  if (state !== 'play' || hBurst || P.dashT > 0) return;
  if (!HD.twoBlades) { drawAimAt(hAimT); return; }
  // 两把斩：左斩、右斩各一个（锁的是同一个就画一个，左半蓝、右半黄）
  const both = !!(hAimTL && hAimTR && hAimTL.ref === hAimTR.ref);
  drawAimAt(hAimTL, both ? 0 : -1);
  if (!both) drawAimAt(hAimTR, 1);
}
function hSideC(s) { return HD.sideC[s < 0 ? 0 : 1]; }
// side（两把斩）：-1 / 1 准星是左斩的蓝 / 右斩的黄，0 = 两边都锁它：左半边两个角蓝、右半边两个角黄（不转，转起来就分不清哪边了）。
// 用户："用颜色去表示，不要用文字"。爆裂者：里面再套一圈红（一笔）
function drawAimAt(t, side) {
  if (!t) return;
  const x = wdx(t.x), y = wdy(t.y), r = t.r + 14, L = 0.6, a0 = side === 0 ? Math.PI / 4 : gameTime * 2.4;
  const c = side ? hSideC(side) : side === 0 ? '#ffffff' : t.bomb ? '#ff4a3a' : '#ffffff';
  // 一根细线从主角连过去：点下去就往这儿斩
  const dx = x - P.x, dy = y - P.y, d = Math.hypot(dx, dy) || 1;
  if (d > r + P.r + 4) {
    ctx.beginPath();
    ctx.moveTo(P.x + dx / d * (P.r + 4), P.y + dy / d * (P.r + 4));
    ctx.lineTo(x - dx / d * r, y - dy / d * r);
    ctx.strokeStyle = c;
    ctx.globalAlpha = P.cd > 0 ? 0.12 : 0.3;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = P.cd > 0 ? 0.35 : 0.95;
  ctx.lineWidth = 4;
  // 四个角：两边都锁的时候右边两个（i 0、1：-45°、45°）一笔黄、左边两个（135°、225°）一笔蓝
  for (let h = 0; h < (side === 0 ? 2 : 1); h++) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      if (side === 0 && (i < 2) !== (h === 0)) continue;
      const a = a0 + i * Math.PI / 2 - (side === 0 ? Math.PI / 2 : 0);
      ctx.moveTo(x + Math.cos(a - L / 2) * r, y + Math.sin(a - L / 2) * r);
      ctx.arc(x, y, r, a - L / 2, a + L / 2);
    }
    ctx.strokeStyle = side === 0 ? hSideC(h ? -1 : 1) : c;
    ctx.stroke();
  }
  if (t.bomb && side !== undefined) {
    ctx.beginPath();
    ctx.arc(x, y, r - 7, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ff4a3a';
    ctx.stroke();
  }
  // 班主任看着（人或它在视线里）：准星上打一个红叉 —— 现在斩它会被抓
  if (hordeMode && hTeach.length && hTeachSees(t)) {
    const k = r * 0.6;
    ctx.beginPath();
    ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
    ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ff4a3a';
    ctx.globalAlpha = 0.95;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 「连斩」键：斩键正上方。没满是一圈怒气进度，满了金色呼吸
function hBurstBtn() { return { x: DASH_BTN.x, y: DASH_BTN.y - DASH_BTN.r - 62, r: 38 }; }
function drawBurstBtn() {
  if (!(isTouch && state === 'play')) return;
  const b = hBurstBtn(), full = hRage >= 100, k = 0.5 + 0.5 * Math.sin(nowMs() / 160), S = (b.r + 12) * 2;
  // 底盘、字：贴图（只在满没满、怒气数变了才重画）；每帧现画的只有怒气那一圈和满了的呼吸圈
  hText('hdBurst', full ? 'full' : String(Math.floor(hRage)), b.x - S / 2, b.y - S / 2, S, S + 22, function () {
    const c = S / 2;
    ctx.beginPath();
    ctx.arc(c, c, b.r, 0, Math.PI * 2);
    ctx.fillStyle = full ? 'rgba(70,46,8,0.92)' : 'rgba(10,12,17,0.8)';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();
    ctx.textAlign = 'center';
    uf(900, 17);
    ctx.fillStyle = full ? '#fff1c9' : 'rgba(255,255,255,0.32)';
    ctx.fillText('连斩', c, c + 6);
    uf(700, 10);
    ctx.fillStyle = full ? UI.gold : 'rgba(255,190,140,0.6)';
    ctx.fillText(full ? '点我！' : '怒气 ' + Math.floor(hRage), c, c + b.r + 15);
  });
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + hRage / 100 * Math.PI * 2);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = full ? UI.gold : 'rgba(255,154,92,0.75)';
  ctx.stroke();
  if (full) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 6 + 4 * k, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(UI.gold, 0.3 + 0.4 * k);
    ctx.stroke();
  }
}

// 黑潮试玩的字一律贴图：手机上写一个字就要 30~60 微秒，带描边的长句子更贵 ——
// 1024.1129 实测开局那两行提示一帧吃掉十来毫秒（界面 6 毫秒 / 帧的大头）。draw 在 (0, 0)~(w, h) 里画
function hText(id, key, x, y, w, h, draw, minMs) {
  const spr = textSprite(id, key, w, h, draw, minMs);
  if (spr) { ctx.drawImage(spr, x, y, w, h); return; }
  ctx.save();
  ctx.translate(x, y);
  draw();
  ctx.restore();
}

// HUD：分数、连斩照旧；右上米数 + 第几波；怒气是「连斩」键上那一圈；左上帧数。
// 黑潮被甩出屏幕时什么都不提示（用户："底边不用出现一截墨也不用出现红光，就慢慢让他追上来就好"）
// 涌浪预警（HD.surgePre）：不写字。三档 —— 快来了：底边淡红光慢慢一明一暗；憋着（surgeTell）：红光变强、闪得快，
// 底部正中（两个斩键中间）三个红箭头一个接一个往上冒；猛涌：红光一直亮、箭头冲得更快。
// 只用实心色块叠出一道渐变（抖音上每帧的渐变会让画面忽明忽暗，见 THEME 那边的说明），一共五六笔
const SURGE_C = '255,74,52';
function hSurgeWarn() {
  if (!hordeMode || state !== 'play' || hBurst || hTutOn() || hPropOn('ghost') || hPropOn('stink')) return 0;
  if (hSurge === 2) return 3;
  if (hSurge === 1) return 2;
  return hWaveT > hCalm() && hSurgeT < HD.surgePre ? 1 : 0;
}
function drawSurgeWarn() {
  const lv = hSurgeWarn();
  if (!lv) return;
  const t = nowMs() / 1000;
  let a;
  if (lv === 1) a = (0.12 + 0.22 * (1 - hSurgeT / HD.surgePre)) * (0.6 + 0.4 * Math.sin(t * 6));
  else if (lv === 2) a = 0.45 + 0.3 * Math.abs(Math.sin(t * 14));
  else a = 0.6;
  // 底边一道红光：四条越往上越淡的实心条
  const hs = [56, 34, 18, 7], as = [0.18, 0.3, 0.5, 0.9];
  for (let i = 0; i < hs.length; i++) {
    ctx.fillStyle = 'rgba(' + SURGE_C + ',' + (a * as[i]).toFixed(3) + ')';
    ctx.fillRect(0, H_CSS - hs[i], W_CSS, hs[i]);
  }
  if (lv < 2) return;
  // 底部正中三个往上的箭头：一个接一个往上冒（猛涌时冒得快）
  const cx = W_CSS / 2, y0 = DASH_BTN.y + 20, sp = lv === 3 ? 2.6 : 1.6, ph = (t * sp) % 1;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const k = (i + ph) / 3, y = y0 - k * 70, al = Math.sin(k * Math.PI);
    ctx.strokeStyle = 'rgba(' + SURGE_C + ',' + (al * (lv === 3 ? 1 : 0.85)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(cx - 18, y + 9); ctx.lineTo(cx, y - 7); ctx.lineTo(cx + 18, y + 9);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}
function drawHordeUI() {
  const top = hudTop();
  ptFn('(收尾)');
  drawTierFrame();      ptFn('段位光框');
  drawSurgeWarn();      ptFn('涌浪预警');
  drawMomLines();       ptFn('速度线');
  drawHudScore(top);    ptFn('分数');
  // 命：分数底下三颗心（剩的红、掉的只剩个框），只在掉命时重画
  hText('hdLives', hLives + '/' + hMaxLives(), 16, top + 50, 124, 26, function () {
    for (let i = 0; i < hMaxLives(); i++) {
      const x = 14 + i * 26, y = 5, sz = 16, on = i < hLives;
      ctx.beginPath();
      ctx.moveTo(x, y + sz * 0.3);
      ctx.bezierCurveTo(x, y, x - sz * 0.5, y, x - sz * 0.5, y + sz * 0.3);
      ctx.bezierCurveTo(x - sz * 0.5, y + sz * 0.6, x, y + sz * 0.78, x, y + sz);
      ctx.bezierCurveTo(x, y + sz * 0.78, x + sz * 0.5, y + sz * 0.6, x + sz * 0.5, y + sz * 0.3);
      ctx.bezierCurveTo(x + sz * 0.5, y, x, y, x, y + sz * 0.3);
      ctx.closePath();
      if (on) { ctx.fillStyle = '#ff4a5e'; ctx.fill(); }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = on ? 'rgba(255,220,225,0.85)' : 'rgba(255,255,255,0.25)';
      ctx.stroke();
    }
  });
  ptFn('命');
  // 这一局捡了几颗嘉欣糖（2.13 节）：心的右边一颗小糖 + 数（心底下是暂停键），捡到才重画
  if (PROP.on) {
    hText('hdCandy', String(hCandyRun), 16 + hMaxLives() * 26 + 8, top + 52, 80, 22, function () {
      candyIcon(12, 11, 0.8);
      ctx.textAlign = 'left';
      uf(800, 14);
      ctx.fillStyle = '#ffd0ea';
      ctx.fillText(String(hCandyRun), 27, 16);
    });
  }
  ptFn('嘉欣糖数');
  drawHudCombo(top);    ptFn('连斩');
  drawFlyers();         ptFn('飞字');
  drawStick();          ptFn('摇杆');
  drawDashBtn();        ptFn('斩按钮');
  drawBurstBtn();       ptFn('连斩键');
  drawPropBtn();        ptFn('道具键');
  // 米数 + 第几波：右上角胶囊下面（正中留给连斩数；怒气看「连斩」键那一圈）
  // 米数：一张贴图（一笔），变了用数字条拼（不写字，见 numStrip）；"第几波"一波才变一次，另一张贴图
  const mx = W_CSS - 16, my = (MENU ? MENU.bottom : top + 22) + 34, mt = Math.floor(hTop / HD.m) + ' 米', ms = meterStrip();
  if (ms) hText('hdM', mt, mx - 176, my - 30, 180, 40, function () { stripText(ms, mt, 176 - stripW(ms, mt), 30); });
  else { ctx.textAlign = 'right'; uf(900, 26); outlineText(mt, mx, my, '#ffffff', 4); }
  ptFn('米数');
  hText('hdWave', String(hWave), mx - 176, my, 180, 24, function () {
    ctx.textAlign = 'right';
    uf(700, 11);
    ctx.fillStyle = 'rgba(214,236,242,0.6)';
    ctx.fillText('第 ' + hWave + ' 波', 176, 18);
  });
  ptFn('第几波');
  // 帧数：屏幕上直接看卡不卡（算的是每一帧的真实间隔；字最多 0.4 秒换一次）
  const now = nowMs();
  if (hFpsAt) { const gp = now - hFpsAt; if (gp > 0 && gp < 500) hFps += (1000 / gp - hFps) * 0.05; }
  hFpsAt = now;
  const pb = hudPauseBtn(), fv = Math.round(hFps);
  hText('hdFps', String(fv), pb.x, pb.y + pb.h + 3, 64, 18, function () {
    ctx.textAlign = 'left';
    uf(700, 11);
    ctx.fillStyle = fv < 45 ? 'rgba(255,150,120,0.9)' : 'rgba(214,236,242,0.55)';
    ctx.fillText('帧 ' + fv, 2, 13);
  }, 400);
  ptFn('帧数');
  drawBanner();         ptFn('横幅');
  // 新手教程（以前头三局开场挂两行"怎么玩"，现在由教程接管）、拿到道具的卡（2.14 节）：
  // 画在最上面（停住时的暗屏要盖住整个界面），暂停键再盖在暗屏上面（停着也能暂停）
  drawHordeTut();       ptFn('教程');
  drawPropPop();        ptFn('道具卡');
  drawQuestPop();       ptFn('任务卡');
  drawTeachPop();       ptFn('班主任卡');
  drawMomPop();         ptFn('势头卡');
  drawQuestHud();       ptFn('任务框');
  if (state === 'play') drawHudPause();
  ctx.textAlign = 'left';
}

/* ---------- 结算三页（用户："结算画面要改成三个，刚死的时候，给他5秒钟选择是否复活，如果他选择不复活，那就跳转到获得多少箱子的页面，
   如果他选择继续或者没获得箱子，那么就进入排名界面，直接在排名的下面选择是否再来一局或者返回主界面"） ----------
   hEnd：'revive' 复活页（这局还能复活才有；H_END.reviveT 秒没选 = 不复活）
       → 'box' 宝箱页（这局升级送了宝箱才有：「开箱」开完回来 / 「继续」留着以后开）
       → 'rank' 排名页（这局跑了多少、好友 / 全服名次、三个任务，下面「再来一局」「返回主界面」）
   死的那一下照旧先停 DEAD_LOOK 秒让人看清是谁（凶手圈红）。原来失败页上的「看广告 · 带道具再来」挪到开局前那一页（hStartFlow） */
const H_END = { reviveT: 5, preAdT: 5 };
let hEnd = 'rank', hEndAt = 0;      // 在哪一页、这一页从 deadT 几秒开始的
function hEndGo(p) { hEnd = p; hEndAt = Math.max(deadT, DEAD_LOOK); }
function hEndAfterRevive() { hEndGo(hqUp && hqUp.box > 0 ? 'box' : 'rank'); }
function hEndStart() { hEndGo(hCanRevive() ? 'revive' : 'box'); if (hEnd === 'box') hEndAfterRevive(); }
// 复活页还剩几秒（到 0 就当不复活）
function hEndLeft() { return Math.max(0, H_END.reviveT - (deadT - hEndAt)); }
function hEndTick() { if (state === 'dead' && hEnd === 'revive' && deadT > DEAD_LOOK && hEndLeft() <= 0) hEndAfterRevive(); }
function hordeEndBtns() {
  const w = Math.min(300, W_CSS - 56), x = (W_CSS - w) / 2, y = H_CSS - SAFE_BOTTOM - 150;
  if (hEnd === 'revive') return { revive: { x: x, y: H_CSS * 0.5, w: w, h: 60 }, skip: { x: x + 40, y: H_CSS * 0.5 + 76, w: w - 80, h: 44 } };
  if (hEnd === 'box') return { open: { x: x, y: y, w: w, h: 56 }, next: { x: x, y: y + 68, w: w, h: 46 } };
  return { go: { x: x, y: y, w: w, h: 56 }, back: { x: x, y: y + 68, w: w, h: 46 } };
}
function drawHordeDead() {
  const a = clamp((deadT - DEAD_LOOK) * 2.2, 0, 1);
  drawDeathMark(1 - a);
  if (a <= 0.01) return;
  ctx.fillStyle = 'rgba(4,6,9,' + (0.78 * a).toFixed(3) + ')';
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  ctx.globalAlpha = a;
  if (hEnd === 'revive') drawEndRevive();
  else if (hEnd === 'box') drawEndBox();
  else drawEndRank();
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
function hDeathWhy() {
  const d = runDeaths.length ? runDeaths[runDeaths.length - 1][0] : '';
  if (d === '出错') return ['出了点问题', '这局先结束，错误记在测试数据里'];   // 一直出错，强行结束的（见 frame）
  const who = { '杂兵': '小嘉豪', '重型': '胖嘉豪', '冲锋者': '冲锋嘉豪', '爆裂者': '打碟嘉豪' };     // 故事里的叫法（死因记录还用老名字）
  return [d === '黑潮' ? '被嘉豪潮淹没了' : '倒下了', d === '黑潮' ? '嘉豪潮追上来了' : (d === '爆炸' ? '被打碟嘉豪炸到了' : '撞上了' + (who[d] || d || '嘉豪'))];
}
// 第一页：复活（5 秒）
function drawEndRevive() {
  const b = hordeEndBtns(), cx = W_CSS / 2, w = hDeathWhy(), y0 = H_CSS * 0.24, left = hEndLeft();
  ctx.textAlign = 'center';
  uf(900, 38);
  outlineText(w[0], cx, y0, '#ffffff', 5);
  uf(800, 16);
  ctx.fillStyle = '#ff8a7a';
  ctx.fillText(w[1], cx, y0 + 40);
  uf(900, 30);
  outlineText('逃了 ' + Math.floor(hTop / HD.m) + ' 米', cx, y0 + 96, UI.gold, 4);
  uf(700, 15);
  ctx.fillStyle = 'rgba(234,246,248,0.85)';
  ctx.fillText('看个广告，原地满命回来？', cx, b.revive.y - 22);
  drawButton(b.revive, '看广告 · 复活', { kind: 'gold', size: 20, weight: 900, glow: UI.gold });
  // 倒计时：按钮右边一圈，越走越少
  const rx = b.revive.x + b.revive.w - 30, ry = b.revive.y + b.revive.h / 2;
  ctx.beginPath();
  ctx.arc(rx, ry, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left / H_END.reviveT);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();
  uf(900, 13);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(Math.ceil(left)), rx, ry + 5);
  drawButton(b.skip, '不用了', { kind: 'ghost', size: 15, weight: 800 });
}
// 第二页：这局拿到几个宝箱（升级送的）
function drawEndBox() {
  const b = hordeEndBtns(), cx = W_CSS / 2, n = hqUp ? hqUp.box : 0, cw = Math.min(330, W_CSS - 32), rowH = H_CSS < 720 ? 19 : 21;
  const qh = 36 + rowH * 3, qy = b.open.y - 20 - qh, y0 = Math.max(SAFE_TOP + 60, Math.min(H_CSS * 0.2, qy - 200));
  ctx.textAlign = 'center';
  uf(900, 30);
  outlineText('拿到 ' + n + ' 个宝箱', cx, y0, UI.gold, 5);
  uf(700, 14);
  ctx.fillStyle = 'rgba(234,246,248,0.75)';
  ctx.fillText('这局做完 ' + hqRunDone.length + ' 个任务，体育生升到 Lv.' + hqUp.lv, cx, y0 + 30);
  const t = deadT - hEndAt, bob = Math.sin(t * 4) * 3;
  drawChest(cx, y0 + 110 + bob, 1.8, true);
  if (n > 1) { uf(900, 18); outlineText('×' + n, cx + 66, y0 + 130, UI.gold, 4); }
  drawQuestCard(cx - cw / 2, qy, cw, rowH, hqUp.q);
  ctx.textAlign = 'center';
  drawButton(b.open, '开箱', { kind: 'gold', size: 20, weight: 900, glow: UI.gold });
  drawButton(b.next, '继续（留着以后开）', { kind: 'plain', size: 15, weight: 800 });
}
// 第三页：排名单独一页（用户："排名单独放"）—— 上面一行这局跑了多少，中间一整块榜单，下面「再来一局」「返回主界面」。
// 开放数据域用不了（老抖音、浏览器）：中间换成三个任务的卡
function drawEndRank() {
  const L = hordeDeadLayout(), b = L.b, cx = W_CSS / 2, y = L.sumY;
  ctx.textAlign = 'center';
  uf(900, 26);
  outlineText('逃了 ' + Math.floor(hTop / HD.m) + ' 米' + (hNewBest ? '　新纪录！' : ''), cx, y, hNewBest ? UI.gold : '#ffffff', 4);
  uf(700, 12);
  ctx.fillStyle = 'rgba(214,236,242,0.6)';
  const bonus = hCandyBonus();
  ctx.fillText(hDeathWhy()[1] + '　·　第 ' + hWave + ' 波　·　' + score + ' 分' + (PROP.on ? '　·　嘉欣糖 +' + (hCandyRun + bonus) + (hqGot ? '（任务 +' + hqGot + '）' : '') : ''), cx, y + 22);
  if (L.board) drawRankBoard(L.board);
  else drawQuestCard(cx - L.cw / 2, L.cy, L.cw, L.rowH);
  ctx.textAlign = 'center';
  drawButton(b.go, '再来一局', { kind: 'primary', size: 19, weight: 900, glow: UI.cyan });
  drawButton(b.back, '返回主界面', { kind: 'ghost', size: 15 });
}
// 排名页从上往下：一行这局跑了多少（躲开右上角胶囊）→ 榜单（一直铺到按钮上面）→ 按钮
function hordeDeadLayout() {
  const b = hordeEndBtns(), top = MENU ? Math.max(SAFE_TOP + 16, MENU.bottom + 8) : SAFE_TOP + 16;
  const sumY = top + 26, w = Math.min(380, W_CSS - 24), bx = (W_CSS - w) / 2, by = sumY + 40;
  const cw = Math.min(330, W_CSS - 32), rowH = H_CSS < 720 ? 19 : 21;
  return { b: b, sumY: sumY, board: rkBoardOn() ? rkBoardLayout(bx, by, w, b.go.y - 16 - by) : null, cw: cw, rowH: rowH, cy: by };
}
function hordeDeadTap(t) {
  if (deadT < DEAD_LOOK + 0.3 || deadT - hEndAt < 0.25) return;    // 刚换页：别把上一页的手指算进来
  const b = hordeEndBtns();
  if (hEnd === 'revive') {
    if (inRect(t, b.revive)) startAd('revive');
    else if (inRect(t, b.skip)) hEndAfterRevive();
  } else if (hEnd === 'box') {
    if (inRect(t, b.open)) { hEndGo('rank'); bxOpenOwn(Math.min(meta.bx.n, hqUp ? hqUp.box : 0)); }   // 开完「收下」回到排名页
    else if (inRect(t, b.next)) hEndGo('rank');
  } else {
    const L = hordeDeadLayout();
    if (L.board && rankBoardTap(t, L.board)) return;
    if (inRect(t, b.go)) hStartFlow();
    else if (inRect(t, b.back)) toReady();
  }
}

/* ---------- 开局前：看不看广告带道具（用户："开局是否看广告开始，我们放在开始动画之前，单独搞一个画面，让他选择，选择时间五秒"） ----------
   主界面「开始」、排名页「再来一局」都先到这一页；H_END.preAdT 秒没选 = 直接开始。看完广告照旧挑一个道具（propPick）再开局。
   不弹：道具关着、这一局要上新手教程（第一次玩）、HD.preAd 关着（测试） */
let preAdAt = 0;
// story：主界面点「开始」才放开场剧情（INTRO_H，可以跳过）；「再来一局」不放
let hStoryNext = false;
function hStartFlow(story) {
  hStoryNext = !!story && HD.story;
  if (!PROP.on || !HD.preAd || (HD.tut && meta.htut !== H_TUT_VER)) { hStartGo(); return; }
  state = 'preAd'; preAdAt = nowMs(); resetInput();
}
// 真正开局：要放剧情就先放（openTalk 说完 / 跳过再开打），带着挑好的道具（看完广告挑的）
function hStartGo(k) {
  if (!hStoryNext) { startHorde(k); return; }
  hStoryNext = false;
  openTalk(INTRO_H, '黑潮开场', function () { startHorde(k); });
}
function preAdLeft() { return Math.max(0, H_END.preAdT - (nowMs() - preAdAt) / 1000); }
function preAdTick() { if (state === 'preAd' && preAdLeft() <= 0) hStartGo(); }
function preAdLayout() {
  const w = Math.min(320, W_CSS - 48), x = (W_CSS - w) / 2, y = H_CSS * 0.3;
  return { x: x, w: w, y: y, ad: { x: x, y: y + 170, w: w, h: 60 }, go: { x: x + 30, y: y + 246, w: w - 60, h: 46 } };
}
function drawPreAd() {
  inkBg(1);
  const L = preAdLayout(), cx = W_CSS / 2, left = preAdLeft();
  ctx.textAlign = 'center';
  uf(900, 24);
  outlineText('带个道具开局？', cx, L.y, '#ffffff', 4);
  uf(600, 13);
  ctx.fillStyle = 'rgba(255,209,102,0.8)';
  ctx.fillText('看个广告，四个道具挑一个，开场一结束就生效', cx, L.y + 28);
  for (let i = 0; i < PROP_KINDS.length; i++) {
    const k = PROP_KINDS[i], px = cx + (i - 1.5) * 70, sk = skinOf(k);
    drawPropIcon(k, sk, px, L.y + 90, 0.42);
    uf(700, 11);
    ctx.fillStyle = sk.c;
    ctx.fillText(PROP_NAME[k], px, L.y + 132);
  }
  drawButton(L.ad, '看广告 · 带道具开局', { kind: 'gold', size: 19, weight: 900, glow: UI.gold });
  drawButton(L.go, '直接开始（' + Math.ceil(left) + '）', { kind: 'plain', size: 16, weight: 800 });
}
function preAdTap(t) {
  if (nowMs() - preAdAt < 250) return;
  const L = preAdLayout();
  if (inRect(t, L.ad)) startAd('prop');
  else if (inRect(t, L.go)) hStartGo();
}
// 主界面：开始键和「玩法说明 / 新手教程」之间的一把金刃（横屏太挤，不放）
function readyHordeBtn() { return { x: W_CSS / 2 - 118, y: readyGuideBtn().y - 12 - 48, w: 236, h: 48 }; }
function readyHordeOn() { return H_CSS >= 430; }

/* =========================================================
   2.13 道具和嘉欣糖（黑潮玩法）
   ---------------------------------------------------------
   用户写的（Z 盘「道具方案.html」）：
   · 黑板尺："拿了这个道具之后，可斩的范围扩大一倍持续10秒"
   · 臭水："有了这个道具可以驱赶黑潮5秒"
   · 鬼火："效果是高速往前冲10秒，四周扩散剑气，周围全部怪物都被斩杀"
   · 嘉欣糖："游戏里加入嘉欣糖这个货币，随机在游戏内刷新，局外可以买道具皮肤"
   · "道具是及时使用的，不存在新的顶掉旧的的情况，在使用的过程中不刷新新的道具"
   用户没写到的先这样做（方案里"还没写到的"那一栏，用户改了就照改）：
   · 道具摆在前面路上，点「斩」闪过去斩到（直接碰到也算）就拿到，马上生效
   · 第一个在 first 米；上一个用完（或者没捡到、掉进黑潮）以后再往上逃 every 米出下一个，三个随机
   · 臭水：黑潮退到屏幕底边外，这 5 秒不追上来；鬼火：冲的这 10 秒不掉命
   · 嘉欣糖碰到就捡（后来用户要判定距离更大、一次一到三颗随机摆、摆得更勤，见 PROP.candy*）
   · 道具皮肤：先做过两套换色（60 / 150 颗），用户说"道具颜色改回去，就一个颜色"——每个道具只留一个颜色；
     皮肤做成什么样等用户写，商店在有东西卖之前不开（入口不画，振动开关回左上角），糖照样攒
   画面照"每一笔都贵"：道具一张贴图 + 两笔，糖不管几颗四笔，生效时脚下一圈倒计时 + 每种一两笔
   ========================================================= */
const PROP = {
  on: true,
  first: 120, every: 300,            // 米
  // 道具多大（斩到 / 碰到就拿）。用户："道具判定和图形再大一圈"：30 → 50，画面 × 1.5（见 drawHItem）
  pickR: 50,
  ruler: { t: 10, k: 2 },            // 黑板尺：10 秒，能斩的范围 × 2（HD.aimR 240 → 480）
  stink: { t: 5, back: 240 },        // 臭水：5 秒，黑潮退到屏幕底边外 back，不涌、不追
  // 鬼火：10 秒往前冲 sp × 这一波的节奏 hTempo()（走路 320 × 同样的倍数），拖屏幕左右挪 side；剑气每 qiEvery 秒往四周飞一圈 qiN 道，
  // （用户："玩到后面鬼火跑不过黑潮，导致还不如不拿道具"：以前固定 720，后面黑潮 700 再加速追就贴上来了。
  //  现在冲得跟着每波变快（最快 1008），冲的时候黑潮也不涌、不加速追，只按潮速跟，甩开就被拖在屏幕底下外面）
  // 身边 qiR 以内的挡路怪、黑潮的边全斩；冲完再无敌 after 秒（别一停下就撞上）
  ghost: { t: 10, sp: 720, side: 420, qiR: 260, qiEvery: 0.16, qiN: 6, qiSp: 1100, after: 1 },
  // 吸铁石（用户："加一个道具，类似磁铁，有嘉欣糖直接吸进去"）：t 秒里离你 r 以内的糖都往你身上飞（sp 起，越近越快），
  // 飞进判定就照常捡。r 600 差不多整屏（屏幕顶上外面刚撒下来的也吸得到）
  magnet: { t: 10, r: 600, sp: 900 },
  // 嘉欣糖（用户："获取判定距离更大，也不要连续三个这样放，一次一到三个随机，放置概率增加"）：
  // 每往上 candyEvery 米撒一次（以前 55~85），一次 1~candyN 颗、各摆各的（走廊里随便放，上下错开 candyBand 以内，
  // 彼此隔开 candyGap），以前一次 3 颗排成一条斜线；离主角 P.r + candyR 以内就捡到（以前 14 + 16 = 30，后来 60；
  // 用户又说"还得放大，太小了，图标判定再放大一倍"：糖画大一倍（见 drawHCandy），判定 120）
  candyEvery: [20, 40], candyN: 3, candyBand: 260, candyGap: 110, candyR: 106
};
const PROP_KINDS = ['ruler', 'stink', 'ghost', 'magnet'];
const PROP_NAME = { ruler: '黑板尺', stink: '臭水', ghost: '鬼火', magnet: '吸铁石' };
// 糖升级道具（2.15 节）。用户："玩家升级道具有上限，能不能改成软上限？" —— 不封顶（最多 max 级只是防存档出错），
// 越往后每级加得越少、越贵：1~5 级每级多 dt 秒，6~10 级多一半，11 级起多四分之一（吸铁石 dt 2，其余 1）；
// 第 n 级要 50 + 25·n·(n+1) 颗糖：100 / 200 / 350 / 550 / 800（跟以前一样），再往后 1100 / 1450 / 1850 / 2300 / 2800 …
// 最便宜那级约两局的糖，头几局就有东西可买
const PROP_UP = { max: 99, dt: { ruler: 1, stink: 1, ghost: 1, magnet: 2 } };
function propUpDt(k, n) { return PROP_UP.dt[k] * (n <= 5 ? 1 : n <= 10 ? 0.5 : 0.25); }   // 第 n 级多几秒
function hPropT(k) {
  let t = PROP[k].t;
  for (let n = 1; n <= (meta.pu[k] || 0); n++) t += propUpDt(k, n);
  return Math.round(t * 100) / 100;
}
// 写着几秒的那句跟着升级变（道具卡、开局挑道具、商店都读它）
const PROP_DESC_T = { ruler: '能斩的范围翻倍 {t} 秒', stink: '把嘉豪潮赶开 {t} 秒', ghost: '往前猛冲 {t} 秒，剑气斩光身边', magnet: '嘉欣糖全吸过来 {t} 秒' };
const PROP_DESC = {};
for (const k in PROP_DESC_T) Object.defineProperty(PROP_DESC, k, { enumerable: true, get: function () { return PROP_DESC_T[k].replace('{t}', hPropT(k)); } });
// 皮肤：每个道具一个颜色（用户："道具颜色改回去，就一个颜色"）。以后有了皮肤往后加一项、写上价格，商店就开。c 主色、c2 暗色
const PROP_SKINS = {
  ruler: [{ id: 'wood', name: '木尺', c: '#e8b765', c2: '#6b4520', price: 0 }],
  stink: [{ id: 'green', name: '绿臭水', c: '#9be15d', c2: '#3c6b1c', price: 0 }],
  ghost: [{ id: 'cyan', name: '青鬼火', c: '#5cf2e0', c2: '#0e6b66', price: 0 }],
  magnet: [{ id: 'red', name: '红吸铁石', c: '#ff5f5f', c2: '#7a1d1d', price: 0 }]
};
// 1024.1817 卖过的两套换色：去掉了，买过的按原价退回嘉欣糖
const OLD_SKIN_PRICE = { 'ruler.gold': 60, 'ruler.jade': 150, 'stink.purple': 60, 'stink.amber': 150, 'ghost.violet': 60, 'ghost.red': 150 };
(function () {
  let back = 0;
  for (const id in meta.skins) if (OLD_SKIN_PRICE[id]) { back += OLD_SKIN_PRICE[id]; delete meta.skins[id]; }
  if (back) { meta.candy += back; meta.skinOn = {}; saveMeta(); }
})();
/* ---------- 嘉豪皮肤（用户："加一个皮肤系统"：换"嘉豪本人、刀和刀光、还有专属技能"，"糖买或看广告都行"，
   "你出一版，但是必须要常规玩的时候感觉肝，有看广告的欲望"） ----------
   我出的这一版：一局大约捡 60 颗糖（1025.1500 真机：1862 米 61 颗），最便宜的 1200 颗 ≈ 20 局，嘉豪本豪 8000 颗 ≈ 130 局；
   看一次广告 ≈ 7~9 局的糖。广告进度每款单独记、不过期；糖和广告各算各的。一次穿一套，技能跟着皮肤走（只在黑潮里生效）。
   样子：body 没连斩时身体的颜色、cloak 披风、hilt 刀柄、blade 刀身、light 刀光（拖尾外层 + 刀痕）、deco 身上的小装饰（见 drawHeroDeco） */
const HERO_SKINS = [
  { id: 'base', name: '体育生', price: 0, ads: 0, skill: '', sname: '', sdesc: '原版：运动服、青色刀光，没有技能' },
  { id: 'rain', name: '长跑队', price: 1200, ads: 3, body: '#7fb8ff', cloak: 'rgba(22,48,96,0.82)', hilt: '#1a2c4a', blade: '#d6ecff', light: '#6fb6ff', deco: 'rain',
    skill: 'rain', sname: '雨中长跑', sdesc: '黑潮涌浪的时候，你跑快 30%' },
  { id: 'dj', name: '篮球队', price: 1800, ads: 4, body: '#c58bff', cloak: 'rgba(64,22,96,0.82)', hilt: '#2c1640', blade: '#ffd6f4', light: '#ff6fd2', deco: 'dj',
    skill: 'dj', sname: '暴扣', sdesc: '连斩每满 10，脚下"咚"一圈冲击波，身边小嘉豪全拍飞' },
  { id: 'flashy', name: '校草', price: 3000, ads: 6, body: '#d8ff4a', cloak: 'rgba(92,106,10,0.82)', hilt: '#3c4410', blade: '#fff6b0', light: '#ffd84a', deco: 'flashy',
    skill: 'flashy', sname: '太受欢迎', sdesc: '嘉欣糖多拿 50%' },
  { id: 'revenge', name: '拳击队', price: 4400, ads: 8, body: '#ff5a4a', cloak: 'rgba(96,12,16,0.86)', hilt: '#3a0c10', blade: '#ffd0c4', light: '#ff3a2a', deco: 'revenge',
    skill: 'revenge', sname: '挨打必还手', sdesc: '掉一条命的时候，自动回头连斩一次（不用怒气）' },
  { id: 'king', name: '体育委员', price: 8000, ads: 15, body: '#fff4d0', cloak: 'rgba(214,200,150,0.8)', hilt: '#6b5420', blade: '#ffffff', light: '#ffd166', deco: 'king',
    skill: 'king', sname: '体委无敌', sdesc: '4 条命，怒气攒得快 30%' }
];
const HERO_SKIN = {};
for (let i = 0; i < HERO_SKINS.length; i++) HERO_SKIN[HERO_SKINS[i].id] = HERO_SKINS[i];
function heroOwned(sk) { return !sk.price || !!meta.hs.own[sk.id]; }
// 穿着哪套（存档里那套没有 / 不认识，就是原版）
function heroSkin() { const sk = HERO_SKIN[meta.hs.on]; return sk && heroOwned(sk) ? sk : HERO_SKINS[0]; }
// 这一局有没有这个皮肤技能（只在黑潮里）
function hSkill(k) { return hordeMode && heroSkin().skill === k; }
function hMaxLives() { return HD.lives + (hSkill('king') ? 1 : 0); }                  // 嘉豪本豪：多一条命
function hAddRage(n) { hRage = Math.min(100, hRage + n * (hSkill('king') ? 1.3 : 1) / (1 + HD.rageHeat * hHeat())); }   // 嘉豪本豪：怒气快 30%；越往后越难攒（HD.rageHeat）
function hSpeedK() { return (hSkill('rain') && hSurge > 0 ? 1.3 : 1) * hMomK(); }      // 雨中嘉豪：涌浪时跑快 30%；势头越高跑得越快
// 刀光（拖尾外层、刀痕）的颜色：皮肤有自己的刀光就用它，原版照旧跟着连斩段位
function slashColor() { return heroSkin().light || heroColor(); }
// 买 / 装（买得起就扣糖、装上）。返回给商店那一行字
function heroBuy(sk) {
  if (heroOwned(sk)) { meta.hs.on = sk.id; saveMeta(); heroSnap(); return '换上了' + sk.name; }
  // 用户："糖可以买箱子，不可以买皮肤了"：皮肤只能开宝箱攒碎片（2.16 节）
  return '开宝箱攒碎片：' + (meta.bx.sh[sk.id] || 0) + ' / ' + bxNeed(sk.id);
}
// 看广告解锁：看完一次进度 +1，够了就有了、马上穿上
let heroAdSkin = null;
function heroSkinAd(sk) { heroAdSkin = sk.id; startAd('skin'); }
function heroSkinAdDone() {
  const sk = HERO_SKIN[heroAdSkin];
  heroAdSkin = null;
  if (!sk || heroOwned(sk)) return;
  meta.hs.ads[sk.id] = (meta.hs.ads[sk.id] || 0) + 1;
  if (meta.hs.ads[sk.id] >= sk.ads) { meta.hs.own[sk.id] = 1; meta.hs.on = sk.id; shopMsg = '解锁了，换上了' + sk.name; S.upgrade(); }
  else shopMsg = sk.name + '：广告 ' + meta.hs.ads[sk.id] + ' / ' + sk.ads;
  shopMsgAt = nowMs();
  saveMeta(); heroSnap();
}
// 打碟嘉豪：连斩每满 10 放一圈音波（回头连斩时只跟着数，不放）
let hDjN = 0;
function hDjTick() {
  const n = Math.floor(combo / 10);
  if (n <= hDjN || hBurst) { hDjN = n; return; }
  hDjN = n;
  const R = 210, c = heroSkin().light;
  rings.push({ x: P.x, y: P.y, r0: P.r, r1: R, life: 0.35, max: 0.35, color: c, w: 6 });
  rings.push({ x: P.x, y: P.y, r0: P.r, r1: R * 0.6, life: 0.25, max: 0.25, color: '#ffffff', w: 2.5 });
  // 小怪（杂兵、冲锋者）全斩；重型、爆裂者不管（爆裂者斩了会炸到自己）
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (e.heavy || e.bomb || Math.hypot(wdelta(e.x - P.x), wdelta(e.y - P.y)) > R + e.r) continue;
    hAddRage(HD.rage.foe);
    killEnemy(j);
  }
  S.thump(0.7); vibrate(1); shake = Math.max(shake, 4);     // 每 10 连斩一下：原 8，一秒一抖太多
}
// 商店开不开：黑潮主玩法、道具开着就开（嘉豪皮肤在里面卖）
function shopOn() { return !!PROP.on; }
function skinOwned(k, s) { return !s.price || !!meta.skins[k + '.' + s.id]; }
// 这个道具现在装着哪套（存档里装的那套没买 / 不认识，就是默认）
function skinOf(k) {
  const L = PROP_SKINS[k], id = meta.skinOn[k];
  for (let i = 0; i < L.length; i++) if (L[i].id === id && skinOwned(k, L[i])) return L[i];
  return L[0];
}

let hItem = null;          // 路上摆着的道具（一次最多一个）：{ k, x, y, t }
let hProp = null;          // 正在生效的道具：{ k, t 还剩几秒, T 一共几秒, qiT 离下一圈剑气几秒, fxT 冒臭气, start 开局看广告带的 }
let hPropNext = 0;         // hTop 到这儿摆下一个道具（路上有一个 / 正在用 = Infinity）
let hPropUsed = 0;         // 这一局用了几个（测试数据）
let hCandy = [];           // 路上的嘉欣糖：{ x, y, ph }
let hCandyNext = 0, hCandyRun = 0, hCandyHalf = 0;   // hTop 到这儿撒下一串；这一局捡了几颗；显眼包多拿的半颗攒着
const hQi = [];            // 鬼火的剑气：{ a 往哪飞, d 飞出去多远, life }，跟着主角走

function hPropReset() {
  hItem = null; hProp = null; hPropUsed = 0; hQi.length = 0;
  hPropNext = PROP.first * HD.m;
  hCandy = []; hCandyRun = 0; hCandyHalf = 0; hCandyNext = rand(PROP.candyEvery[0], PROP.candyEvery[1]) * HD.m;
}
function hPropOn(k) { return !!hProp && hProp.k === k; }
// 能斩多远（辅助瞄准锁得上多远）：黑板尺生效时翻倍
function hAimR() { return HD.aimR * (hPropOn('ruler') ? PROP.ruler.k : 1); }

// 往前摆（和挡路的一起摆在屏幕顶上外面）：道具到了该出的米数、路上没有、也没在用才出；糖每隔一段撒一到三颗
function hSpawnProps() {
  const y = cam.y - H / 2 - 70;
  if (!hItem && !hProp && hTop >= hPropNext) {
    hItem = { k: PROP_KINDS[Math.floor(Math.random() * PROP_KINDS.length)], x: hX0 + rand(-0.3, 0.3) * W, y: wwrap(y), t: 0 };
    hPropNext = Infinity;
  }
  while (hTop >= hCandyNext) {
    const n = 1 + Math.floor(Math.random() * PROP.candyN), put = [];
    for (let tries = 0; put.length < n * 2 && tries < 24; tries++) {
      const x = hX0 + rand(-0.4, 0.4) * W, yy = y - 30 - rand(0, PROP.candyBand);
      let near = false;
      for (let j = 0; j < put.length; j += 2) if (Math.hypot(put[j] - x, put[j + 1] - yy) < PROP.candyGap) near = true;
      if (!near) put.push(x, yy);
    }
    for (let j = 0; j < put.length; j += 2) hCandy.push({ x: put[j], y: wwrap(put[j + 1]), ph: rand(0, 6.28) });
    hCandyNext += rand(PROP.candyEvery[0], PROP.candyEvery[1]) * HD.m;
  }
}

// 每帧（碰撞之前）：捡道具 / 捡糖；落到屏幕底下、掉进墨里的就没了；正在生效的倒计时
function hTickProps(dt) {
  const live = !hBurst, sink = HD.gap * HD.inkEdge + 30, out = hBottomGap() + 80;
  if (hItem) {
    hItem.t += dt;
    const ix = P.x + wdelta(hItem.x - P.x), iy = P.y + wdelta(hItem.y - P.y), ey = iy - P.y;
    if (live && segDist(P.px, P.py, P.x, P.y, ix, iy) <= P.r + PROP.pickR) {
      if (P.dashRef === hItem) P.cd = 0;          // 斩过去拿到的：跟斩死怪一样，马上能接下一刀
      hUseProp(hItem.k, ix, iy);
    }
    else if (ey > out || ey - hGap() > sink) { hItem = null; hPropNext = hTop + PROP.every * HD.m; }   // 没捡到：照样隔 every 米再出
  }
  // 吸铁石：离你 r 以内的糖往你身上飞（越近越快），飞进判定就照常捡
  if (live && hPropOn('magnet')) {
    const M = PROP.magnet;
    for (let i = 0; i < hCandy.length; i++) {
      const c = hCandy[i], dx = wdelta(P.x - c.x), dy = wdelta(P.y - c.y), d = Math.hypot(dx, dy);
      if (d > M.r || d < 1) continue;
      const step = Math.min(d, (M.sp + (M.r - d) * 2) * dt);
      c.x = wwrap(c.x + dx / d * step); c.y = wwrap(c.y + dy / d * step);
    }
  }
  for (let i = hCandy.length - 1; i >= 0; i--) {
    const c = hCandy[i], cx = P.x + wdelta(c.x - P.x), cy = P.y + wdelta(c.y - P.y), ey = cy - P.y;
    if (live && segDist(P.px, P.py, P.x, P.y, cx, cy) <= P.r + PROP.candyR) {
      if (P.dashRef === c) P.cd = 0;              // 斩过去捡到的：同上
      hCandy.splice(i, 1); hEatCandy(cx, cy);
    }
    else if (ey > out || ey - hGap() > sink) hCandy.splice(i, 1);
  }
  for (let i = hQi.length - 1; i >= 0; i--) {
    const q = hQi[i];
    q.life -= dt; q.d += PROP.ghost.qiSp * dt;
    if (q.life <= 0) hQi.splice(i, 1);
  }
  if (!hProp) return;
  hProp.t -= dt;
  if (hProp.k === 'ghost' && live) hGhostQi(dt);
  if (hProp.k === 'stink') {
    // 身上一直冒臭气（几颗往上飘的粒子，跟碎屑一起画）
    hProp.fxT -= dt;
    if (hProp.fxT <= 0) {
      hProp.fxT = 0.07;
      const sk = skinOf('stink');
      parts.push({ x: P.x + rand(-14, 14), y: P.y + rand(-6, 10), vx: rand(-30, 30), vy: rand(-110, -60), life: rand(0.4, 0.7), max: 0.7, r: rand(2, 3.6), c: sk.c });
    }
  }
  if (hProp.t <= 0) hEndProp();
}

// 拿到道具：马上生效（不存）
function hUseProp(k, x, y) {
  const sk = skinOf(k), T = hPropT(k);
  hItem = null;
  hPropUsed++;
  hqAdd('prop');
  hqAdd('use_' + k);                               // 任务：用某一种道具
  hProp = { k: k, t: T, T: T, qiT: 0, fxT: 0 };
  hPropPop = { k: k, t: 0 };                    // 屏幕上方弹一张卡：名字 + 干什么用（2.14 节）
  rings.push({ x: x, y: y, r0: 20, r1: 150, life: 0.45, max: 0.45, color: sk.c, w: 6 });
  rings.push({ x: P.x, y: P.y, r0: 10, r1: 90, life: 0.3, max: 0.3, color: '#ffffff', w: 2.5 });
  for (let i = 0; i < 12; i++) {
    const a = rand(0, Math.PI * 2), s = rand(120, 420);
    parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.55), max: 0.55, r: rand(1.6, 3.2), c: i % 3 ? sk.c : '#ffffff' });
  }
  if (parts.length > 360) parts.splice(0, parts.length - 360);
  S.tierUp(3); vibrate(2);
  if (k === 'stink') {
    // 黑潮一下子退到屏幕底边外：一道臭水的波往下冲过去
    const b = hBottomGap() + PROP.stink.back;
    if (hGap() < b) hFront = wwrap(P.y + b);
    hSurge = 0; hSurgeP = 0;
    rings.push({ x: P.x, y: P.y, r0: 40, r1: H * 0.7, life: 0.6, max: 0.6, color: sk.c, w: 10 });
    for (let i = 0; i < 16; i++) {
      const a = Math.PI / 2 + rand(-0.9, 0.9), s = rand(300, 700);
      parts.push({ x: P.x, y: P.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), max: 0.6, r: rand(2.5, 5), c: sk.c });
    }
  }
  if (k === 'ghost') {
    // 鬼火：这一刀不用走完了，直接冲起来
    P.dashT = 0; P.glideT = 0; P.dashLeft = Infinity; P.dashRef = null; hRecoil = false;
    P.inv = Math.max(P.inv, 0.3);
    shake = Math.max(shake, 10);
  }
}
function hEndProp() {
  if (hProp.k === 'ghost') P.inv = Math.max(P.inv, PROP.ghost.after);
  // 开局看广告带的那个不占路上的名额：路上第一个照常在 first 米出（已经过了就马上出）
  hPropNext = hProp.start ? Math.max(PROP.first * HD.m, hTop) : hTop + PROP.every * HD.m;
  hProp = null;
}
function hEatCandy(x, y) {
  hCandyRun++;
  if (hSkill('flashy')) { hCandyHalf += 0.5; if (hCandyHalf >= 1) { hCandyHalf -= 1; hCandyRun++; } }   // 显眼包嘉豪：多拿 50%
  hqSet('candy', hCandyRun);
  hqAdd('candyAll');
  rings.push({ x: x, y: y, r0: 12, r1: 80, life: 0.28, max: 0.28, color: CANDY_C, w: 3 });
  for (let k = 0; k < 4; k++) {
    const a = rand(0, Math.PI * 2), sp = rand(80, 200);
    parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.35), max: 0.35, r: rand(1.2, 2.2), c: k % 2 ? CANDY_C : '#ffffff' });
  }
  S.tick(0.25);
}

// 鬼火往前冲：不碰屏幕就笔直往上，拖屏幕只管左右；不出刀（剑气在斩）
function hGhostStep(dt) {
  const G = PROP.ghost, d = HD.twoBlades ? hSideDir() : inputDir();
  P.px = P.x; P.py = P.y;
  P.vx += ((d ? d.x : 0) * G.side - P.vx) * Math.min(1, dt * 8);
  P.vy += (-G.sp * hTempo() - P.vy) * Math.min(1, dt * 5);
  P.x += P.vx * dt; P.y += P.vy * dt;
  const sp = Math.hypot(P.vx, P.vy) || 1;
  P.dx = P.vx / sp; P.dy = P.vy / sp; P.ang = Math.atan2(P.vy, P.vx);
  P.dashT = 0; P.glideT = 0; P.dashLeft = Infinity; P.dashRef = null;
  P.inv = Math.max(P.inv, 0.25);                 // 冲的这 10 秒不掉命
  const jy = P.y - wwrap(P.y);
  if (jy) { P.y -= jy; cam.y -= jy; P.py -= jy; camLap.y += jy; }
  trail.push({ x: P.x, y: P.y, life: 0.13, max: 0.13 });
  if (trail.length > 16) trail.shift();
}
// 剑气：每 qiEvery 秒往四周飞一圈；身边 qiR 以内的全斩（挡路的不管什么怪，黑潮的边也斩）
function hGhostQi(dt) {
  const G = PROP.ghost;
  hProp.qiT -= dt;
  if (hProp.qiT <= 0) {
    hProp.qiT += G.qiEvery;
    const a0 = rand(0, Math.PI * 2);
    for (let i = 0; i < G.qiN; i++) hQi.push({ a: a0 + i * Math.PI * 2 / G.qiN, d: P.r + 6, life: (G.qiR - P.r) / G.qiSp });
    if (hQi.length > 48) hQi.splice(0, hQi.length - 48);
  }
  const c = skinOf('ghost').c;
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j], dx = wdelta(e.x - P.x), dy = wdelta(e.y - P.y);
    if (Math.hypot(dx, dy) > G.qiR + e.r) continue;
    cuts.push({ x: e.x, y: e.y, a: Math.atan2(dy, dx) + Math.PI / 2, len: e.r * 5, w: 1, c: c, life: 0.22, max: 0.22 });
    if (cuts.length > 24) cuts.shift();
    hClearFoe(j);
    const now = nowMs();
    if (now - hHitAt > 60) { hHitAt = now; S.hit(combo); vibrate(0); }
  }
  for (let i = horde.length - 1; i >= 0; i--) {
    const m = horde[i];
    if (Math.hypot(m.x - P.x, hMemberY(m) - P.y) <= G.qiR + m.r) hKill(i, 'boom');
  }
}

/* ---------- 画面 ---------- */
// 道具的样子（60 × 60 的格子，中心 cx, cy，s 倍）：路上那个和商店里的预览同一份
function drawPropIcon(k, sk, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  if (k === 'ruler') {
    // 黑板尺：一把斜着的长尺，一边刻度
    ctx.rotate(-0.62);
    ctx.beginPath();
    ctx.rect(-26, -7, 52, 14);
    ctx.fillStyle = sk.c;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = sk.c2;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) { const x = -22 + i * 4.4; ctx.moveTo(x, -7); ctx.lineTo(x, -7 + (i % 5 ? 4 : 8)); }
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(-24, 3, 48, 2);
  } else if (k === 'stink') {
    // 臭水：一瓶冒着臭气的水（瓶底一半是水，瓶口塞子，上面三道弯弯的臭气）
    ctx.beginPath();
    ctx.arc(0, 8, 15, 0, Math.PI * 2);
    ctx.rect(-5, -12, 10, 8);
    ctx.fillStyle = 'rgba(20,24,30,0.9)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 8, 13, -0.1 * Math.PI, 1.1 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = sk.c;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 8, 15, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(235,245,250,0.75)';
    ctx.stroke();
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(-6, -18, 12, 7);
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const x = i * 11;
      ctx.moveTo(x, -20 + Math.abs(i) * 6);
      ctx.quadraticCurveTo(x + 5, -25 + Math.abs(i) * 6, x, -30 + Math.abs(i) * 6);
      ctx.quadraticCurveTo(x - 5, -34 + Math.abs(i) * 6, x, -38 + Math.abs(i) * 6);
    }
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = sk.c;
    ctx.stroke();
  } else if (k === 'magnet') {
    // 吸铁石：一块斜着的红色马蹄形磁铁，两只脚是银的
    ctx.rotate(0.35);
    ctx.beginPath();
    ctx.arc(0, -4, 20, Math.PI, 0);
    ctx.lineTo(20, 18); ctx.lineTo(9, 18); ctx.lineTo(9, -4);
    ctx.arc(0, -4, 9, 0, Math.PI, true);
    ctx.lineTo(-9, 18); ctx.lineTo(-20, 18);
    ctx.closePath();
    ctx.fillStyle = sk.c;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = sk.c2;
    ctx.stroke();
    ctx.fillStyle = '#e8eef2';
    ctx.fillRect(-19, 9, 9, 8);
    ctx.fillRect(10, 9, 9, 8);
  } else {
    // 鬼火：一团往上蹿的火，里面一团亮的，两只小眼睛
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.bezierCurveTo(6, -14, 18, -6, 16, 8);
    ctx.bezierCurveTo(15, 18, 7, 22, 0, 22);
    ctx.bezierCurveTo(-7, 22, -15, 18, -16, 8);
    ctx.bezierCurveTo(-18, -6, -6, -14, 0, -26);
    ctx.fillStyle = sk.c;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.bezierCurveTo(4, -2, 10, 2, 9, 10);
    ctx.bezierCurveTo(8, 16, 4, 18, 0, 18);
    ctx.bezierCurveTo(-4, 18, -8, 16, -9, 10);
    ctx.bezierCurveTo(-10, 2, -4, -2, 0, -8);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-5, 9, 2.6, 0, Math.PI * 2);
    ctx.moveTo(7.6, 9);
    ctx.arc(5, 9, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = sk.c2;
    ctx.fill();
  }
  ctx.restore();
}
// 路上的道具：一圈光（一笔）、一圈呼吸的环（一笔）、道具贴图（一张）
function drawHItem() {
  if (!hItem) return;
  const it = hItem, sk = skinOf(it.k), x = wdx(it.x), y = wdy(it.y) + Math.sin(gameTime * 3) * 4, k = 0.5 + 0.5 * Math.sin(gameTime * 5);
  if (Math.abs(y - cam.y) > H / 2 + 100) return;
  ctx.beginPath();
  ctx.arc(x, y, 63 + 9 * k, 0, Math.PI * 2);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = sk.c;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 48, 0, Math.PI * 2);
  ctx.globalAlpha = 0.45 + 0.45 * k;
  ctx.lineWidth = 4;
  ctx.strokeStyle = sk.c;
  ctx.stroke();
  ctx.globalAlpha = 1;
  hText('hdItem', it.k + '.' + sk.id, x - 45, y - 45, 90, 90, function () { drawPropIcon(it.k, sk, 45, 45, 1.5); });
}
// 路上的嘉欣糖（同 drawCandies 的样子：粉光、黑糖纸、粉糖心，画大一倍：一颗 64 宽），不管几颗四笔
function drawHCandy() {
  if (!hCandy.length) return;
  const t = gameTime, vis = HCV;
  let n = 0;
  for (let i = 0; i < hCandy.length && n < HCV.length; i++) {
    const c = hCandy[i], x = wdx(c.x), y = wdy(c.y) + Math.sin(t * 3 + c.ph) * 5;
    if (Math.abs(y - cam.y) > H / 2 + 60) continue;
    vis[n++] = x; vis[n++] = y;
  }
  if (!n) return;
  ctx.beginPath();
  for (let k = 0; k < n; k += 2) { ctx.moveTo(vis[k] + 40, vis[k + 1]); ctx.arc(vis[k], vis[k + 1], 40, 0, Math.PI * 2); }
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = CANDY_C;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (let k = 0; k < n; k += 2) {
    const x = vis[k], y = vis[k + 1];
    ctx.moveTo(x - 14, y); ctx.lineTo(x - 32, y - 14); ctx.lineTo(x - 32, y + 14); ctx.closePath();
    ctx.moveTo(x + 14, y); ctx.lineTo(x + 32, y - 14); ctx.lineTo(x + 32, y + 14); ctx.closePath();
  }
  ctx.fillStyle = '#2a1020';
  ctx.fill();
  ctx.strokeStyle = CANDY_C;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < n; k += 2) { ctx.moveTo(vis[k] + 18, vis[k + 1]); ctx.arc(vis[k], vis[k + 1], 18, 0, Math.PI * 2); }
  ctx.fillStyle = CANDY_C;
  ctx.fill();
}
const HCV = new Float32Array(120);    // 屏幕里的糖（每帧重用）
// 道具生效：脚下一圈倒计时（一笔）；黑板尺 = 前面一道带刻度的弧，标出现在斩得到多远（一笔）；
// 鬼火 = 身后一团火（两笔）+ 往四周飞的剑气（两笔）；臭水只冒臭气（粒子）
function drawPropFx() {
  if (hQi.length) {
    // 一道剑气 = 一弯月牙（外弧是刀口，里弧圆心往回挪：中间厚、两头尖），飞得越远越窄。月牙一笔填色、刀口一笔描白
    const c = skinOf('ghost').c;
    ctx.beginPath();
    for (let i = 0; i < hQi.length; i++) {
      const q = hQi[i], w = 0.42 * clamp(q.life / 0.18, 0.35, 1), t = 14 * clamp(q.life / 0.18, 0.4, 1);
      const ux = Math.cos(q.a), uy = Math.sin(q.a), bx = P.x - ux * t * 2, by = P.y - uy * t * 2, r2 = q.d + t;
      ctx.moveTo(P.x + Math.cos(q.a - w) * q.d, P.y + Math.sin(q.a - w) * q.d);
      ctx.arc(P.x, P.y, q.d, q.a - w, q.a + w);
      ctx.arc(bx, by, r2, q.a + w * 0.92, q.a - w * 0.92, true);
      ctx.closePath();
    }
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = c;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < hQi.length; i++) {
      const q = hQi[i], w = 0.42 * clamp(q.life / 0.18, 0.35, 1);
      ctx.moveTo(P.x + Math.cos(q.a - w) * q.d, P.y + Math.sin(q.a - w) * q.d);
      ctx.arc(P.x, P.y, q.d, q.a - w, q.a + w);
    }
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (!hProp || (state !== 'play' && state !== 'pause')) return;
  const sk = skinOf(hProp.k);
  if (hProp.k === 'magnet') {
    // 吸铁石：两圈往里收的波纹（一笔）
    const f = (gameTime * 1.6) % 1;
    ctx.beginPath();
    for (let j = 0; j < 2; j++) {
      const r = P.r + 10 + (1 - (f + j * 0.5) % 1) * 150;
      ctx.moveTo(P.x + r, P.y);
      ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
    }
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2;
    ctx.strokeStyle = sk.c;
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (hProp.k === 'ghost') {
    // 往上冲，火苗往身后（下面）拖
    const f = 1 + 0.12 * Math.sin(gameTime * 31), r = P.r + 10;
    ctx.beginPath();
    ctx.moveTo(P.x - r, P.y);
    ctx.arc(P.x, P.y, r, Math.PI, 0);
    ctx.quadraticCurveTo(P.x + r * 0.7, P.y + r * 2.2 * f, P.x, P.y + r * 3.2 * f);
    ctx.quadraticCurveTo(P.x - r * 0.7, P.y + r * 2.2 * f, P.x - r, P.y);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = sk.c;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(P.x, P.y, r * 0.75, 0, Math.PI * 2);
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(P.x, P.y, P.r + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(hProp.t / hProp.T, 0, 1));
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = sk.c;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
// 斩击范围（用户："在玩家界面加一个斩击范围，和拿了尺子之后有个更好的对比"）：平时一道淡弧标出点「斩」够得着多远
// （摇杆方向左右 aimDeg 度、aimR 远，跟锁目标的范围一样），两头各一道短刻度（一笔）。
// 拿了黑板尺：弧往外扩到两倍（约 0.4 秒扩开，用完缩回来）、变成尺子的颜色带 12 格刻度，原来那道淡弧留在里面对比（再一笔）。
// 开场、回头连斩、鬼火（不出刀）时不画
let hRangeR = 0, hRangeAt = 0;
function drawHRange() {
  if ((state !== 'play' && state !== 'pause') || hIntro || hBurst || hPropOn('ghost')) { hRangeR = 0; return; }
  const R0 = hAimR(), dt = clamp(gameTime - hRangeAt, 0, 0.1);
  hRangeAt = gameTime;
  hRangeR = hRangeR ? hRangeR + (R0 - hRangeR) * Math.min(1, dt * 7) : R0;
  // 两把斩：正前方左右各 sideMax°（左斩、右斩合起来管的斜前方）
  const big = hRangeR > HD.aimR + 2, d = HD.twoBlades ? HUP : inputDir() || HUP, a = Math.atan2(d.y, d.x), h = (HD.twoBlades ? HD.sideMax : HD.aimDeg) * Math.PI / 180;
  // s：-1 只画左半、1 只画右半、不给 = 整道（刻度 n 格按画的这一段分）
  const arc = function (R, n, l0, l1, s) {
    const b0 = s > 0 ? a : a - h, b1 = s < 0 ? a : a + h;
    ctx.moveTo(P.x + Math.cos(b0) * R, P.y + Math.sin(b0) * R);
    ctx.arc(P.x, P.y, R, b0, b1);
    for (let i = 0; i <= n; i++) {
      const b = b0 + (b1 - b0) * i / n, l = i % 3 ? l0 : l1;
      ctx.moveTo(P.x + Math.cos(b) * R, P.y + Math.sin(b) * R);
      ctx.lineTo(P.x + Math.cos(b) * (R - l), P.y + Math.sin(b) * (R - l));
    }
  };
  // 两把斩：现在够得着的那道弧（拿了黑板尺是外面那道）左半蓝、右半黄，正中间那道刻度就是分界
  // （用户先要"在那个范围显示的中间，放个分左右的"，又说"用颜色去表示，不要用文字"）。各一笔
  const lr = HD.twoBlades;
  if (!big && lr) {
    for (let s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      arc(HD.aimR, 1, 12, 12, s);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.strokeStyle = hSideC(s);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    arc(HD.aimR, 1, 12, 12);
    ctx.globalAlpha = big ? 0.14 : 0.24;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#bfe9f2';
    ctx.stroke();
  }
  if (big) {
    for (let s = lr ? -1 : 0; s <= (lr ? 1 : 0); s += 2) {
      ctx.beginPath();
      arc(hRangeR, lr ? 6 : 12, 10, 20, s);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = lr ? hSideC(s) : skinOf('ruler').c;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
// 小糖（HUD、主界面、商店里用）：糖纸两头 + 糖心
function candyIcon(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - 5 * s, y); ctx.lineTo(x - 11 * s, y - 5 * s); ctx.lineTo(x - 11 * s, y + 5 * s); ctx.closePath();
  ctx.moveTo(x + 5 * s, y); ctx.lineTo(x + 11 * s, y - 5 * s); ctx.lineTo(x + 11 * s, y + 5 * s); ctx.closePath();
  ctx.fillStyle = '#2a1020';
  ctx.fill();
  ctx.strokeStyle = CANDY_C;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 6 * s, 0, Math.PI * 2);
  ctx.fillStyle = CANDY_C;
  ctx.fill();
}

/* ---------- 嘉欣糖商店（局外）：三个道具，每个道具的皮肤（默认 + 卖的），买了就装上；没东西卖不开（见 shopOn） ---------- */
let shopMsg = '', shopMsgAt = -1e9;
function readyCandyBtn() { return { x: 20, y: readyTopY(), w: 120, h: 46 }; }
// 有买得起、还没买的皮肤（主界面入口描边呼吸 + 角上挂"可买"）
function shopCanBuy() {
  if (meta.bx.n > 0 || meta.candy >= BOX.price) return true;      // 有宝箱没开 / 糖够买一个（2.16 节）
  for (let i = 0; i < PROP_KINDS.length; i++) { const c = propUpCost(PROP_KINDS[i]); if (c && meta.candy >= c) return true; }
  return false;
}
let shopTab = 'box';       // 商店哪一页：'box' 宝箱（2.16 节）/ 'skin' 嘉豪皮肤 / 'prop' 道具升级（2.15 节）
let shopOdds = false;      // 宝箱页「概率」开着
function openShop(tab) { state = 'shop'; shopMsg = ''; shopOdds = false; if (tab) shopTab = tab; resetInput(); }
// 道具升下一级要几颗糖（到了 PROP_UP.max 才是 0）
function propUpCost(k) { const n = meta.pu[k] + 1; return n > PROP_UP.max ? 0 : 50 + 25 * n * (n + 1); }
// 糖升级道具：买得起就扣糖、升一级。返回给商店那一行字
function propUpBuy(k) {
  const c = propUpCost(k);
  if (!c) return PROP_NAME[k] + '已经满级了';
  if (meta.candy < c) return '还差 ' + (c - meta.candy) + ' 颗嘉欣糖';
  meta.candy -= c; meta.pu[k]++; saveMeta();
  S.upgrade(); vibrate(1);
  return PROP_NAME[k] + '升到 ' + meta.pu[k] + ' 级：' + hPropT(k) + ' 秒';
}
// 皮肤商店（2.13 节）：一款一行 —— 左边穿上的样子，中间名字和技能，右边"糖买 / 看广告"（有了就是"穿上 / 穿着"）
function shopLayout() {
  const top = MENU ? Math.max(SAFE_TOP + 14, MENU.bottom + 12) : SAFE_TOP + 14;   // 躲开右上角胶囊
  const w = Math.min(390, W_CSS - 24), x = (W_CSS - w) / 2;
  const back = { x: x, y: H_CSS - SAFE_BOTTOM - 58, w: w, h: 44 };
  const y0 = top + 66, n = HERO_SKINS.length, gap = 8, ch = Math.min(100, (back.y - 28 - y0) / n - gap), bw = 96;
  const cards = [];
  for (let i = 0; i < n; i++) {
    const y = y0 + i * (ch + gap), bx = x + w - bw - 8, hh = (ch - 16) / 2;
    cards.push({ sk: HERO_SKINS[i], x: x, y: y, w: w, h: ch,
      buy: { x: bx, y: y + 6, w: bw, h: hh }, ad: { x: bx, y: y + 10 + hh, w: bw, h: hh }, one: { x: bx, y: y + 6, w: bw, h: ch - 12 } });
  }
  // 道具升级那一页：一个道具一行，右边一个"糖买"键
  const props = [], ph = Math.min(96, (back.y - 28 - y0) / PROP_KINDS.length - gap);
  for (let i = 0; i < PROP_KINDS.length; i++) {
    const y = y0 + i * (ph + gap);
    props.push({ k: PROP_KINDS[i], x: x, y: y, w: w, h: ph, buy: { x: x + w - bw - 8, y: y + (ph - 44) / 2, w: bw, h: 44 } });
  }
  const tabs = { box: { x: x, y: top + 2, w: 80, h: 34 }, skin: { x: x + 86, y: top + 2, w: 80, h: 34 }, prop: { x: x + 172, y: top + 2, w: 104, h: 34 } };
  // 宝箱那一页：上面画个箱子 + 有几个，下面开 / 买 / 看广告十连，最下面仓库道具（点一个 = 带它上场）
  const bw2 = (w - 50) / 2, sw = (w - 40 - 3 * 8) / 4, by = y0 + 150;
  const box = { chestY: y0 + 56, open1: { x: x + 20, y: by, w: bw2, h: 48 }, openAll: { x: x + 30 + bw2, y: by, w: bw2, h: 48 },
    buy: { x: x + 20, y: by + 58, w: w - 40, h: 46 }, ad: { x: x + 20, y: by + 114, w: w - 40, h: 50 },
    odds: { x: x + w - 74, y: y0 + 2, w: 64, h: 30 }, invY: by + 196, slots: [] };
  for (let i = 0; i < PROP_KINDS.length; i++) box.slots.push({ k: PROP_KINDS[i], x: x + 20 + i * (sw + 8), y: by + 206, w: sw, h: 74 });
  return { x: x, w: w, top: top, cards: cards, props: props, tabs: tabs, box: box, back: back, msgY: back.y - 12 };
}
// 一行字按宽度折成几行
function wrapLines(txt, maxW) {
  const out = [], cs = Array.from(txt);
  let line = '';
  for (let i = 0; i < cs.length; i++) {
    // 标点不放到行首（宁可这一行超一点）
    if (line && textW(line + cs[i]) > maxW && '，。、：；！？）」'.indexOf(cs[i]) < 0) { out.push(line); line = cs[i]; } else line += cs[i];
  }
  if (line) out.push(line);
  return out;
}
// 皮肤穿上的样子（朝右上斜着，放大 k 倍）：商店里用
function drawHeroPreview(sk, x, y, k) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 4);
  ctx.scale(k, k);
  drawHeroBody(sk, sk.body || THEME.player, 0);
  ctx.restore();
  if (sk.deco) drawHeroDeco(sk, x, y, -Math.PI / 4, P.r * k, nowMs() / 1000);
}
function drawShop() {
  inkBg(1);
  const L = shopLayout(), on = heroSkin(), pt = shopTab === 'prop', bt = shopTab === 'box';
  // 三页：宝箱（2.16 节）/ 嘉豪皮肤 / 道具升级（2.15 节）
  const tabOn = { kind: 'plain', size: 15, weight: 900, color: '#ffffff', glow: UI.cyan }, tabOff = { kind: 'ghost', size: 14, weight: 800, color: 'rgba(214,236,242,0.6)' };
  drawButton(L.tabs.box, '宝箱', bt ? tabOn : tabOff);
  if (meta.bx.n > 0) cornerBadge(L.tabs.box, String(meta.bx.n));
  drawButton(L.tabs.skin, '皮肤', shopTab === 'skin' ? tabOn : tabOff);
  drawButton(L.tabs.prop, '道具升级', pt ? tabOn : tabOff);
  ctx.textAlign = 'left';
  uf(500, 11);
  ctx.fillStyle = 'rgba(255,190,225,0.6)';
  ctx.fillText(bt ? '升级送、嘉欣糖买、看广告十连 · 开出皮肤碎片、道具、糖' : pt ? '嘉欣糖升级道具：每升一级，拿到时管用得更久' : '开宝箱攒碎片，集齐就有 · 换样子、换刀光、带专属技能', L.x, L.top + 54);
  ctx.textAlign = 'right';
  uf(900, 22);
  ctx.fillStyle = CANDY_C;
  ctx.fillText(String(meta.candy), L.x + L.w, L.top + 26);
  candyIcon(L.x + L.w - textW(String(meta.candy)) - 18, L.top + 18, 1.1);
  if (pt) drawShopProps(L);
  if (bt) drawShopBox(L);
  for (let i = 0; i < (shopTab === 'skin' ? L.cards.length : 0); i++) {
    const cd = L.cards[i], sk = cd.sk, own = heroOwned(sk), cur = sk === on, c = sk.light || UI.cyan;
    bladeBox(cd.x, cd.y, cd.w, cd.h, { c: 8, top: cur ? '#22301a' : '#111b21', bot: cur ? '#141c10' : '#0a1014',
      border: cur ? UI.gold : (own ? 'rgba(150,225,240,0.3)' : 'rgba(150,225,240,0.13)') });
    // 预览裁在这一格左边那块里（刀身斜着伸出去，别画到上一行）
    const pk = clamp(cd.h / 72, 0.9, 1.3), pw = cd.h * 0.95, px = cd.x + 8 + pw * 0.4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cd.x + 2, cd.y + 2, pw, cd.h - 4);
    ctx.clip();
    drawHeroPreview(sk, px, cd.y + cd.h * 0.6, pk);
    ctx.restore();
    const tx = cd.x + 14 + pw, tw = cd.buy.x - tx - 8;
    ctx.textAlign = 'left';
    uf(900, 15);
    ctx.fillStyle = c;
    ctx.fillText(sk.name, tx, cd.y + 22);
    let ty = cd.y + 40;
    if (sk.sname) {
      uf(800, 12);
      ctx.fillStyle = UI.gold;
      ctx.fillText('「' + sk.sname + '」', tx - 5, ty);
      ty += 16;
    }
    uf(500, 11);
    ctx.fillStyle = 'rgba(214,236,242,0.7)';
    const ls = wrapLines(sk.sdesc, tw);
    for (let j = 0; j < Math.min(2, ls.length); j++) ctx.fillText(ls[j], tx, ty + j * 14);
    if (own) {
      drawButton(cd.one, cur ? '穿着' : '穿上', cur ? { kind: 'ghost', size: 15, weight: 900, color: UI.gold } : { kind: 'primary', size: 15, weight: 900 });
    } else {
      // 还没有：碎片进度（开宝箱攒，2.16 节）
      const n = meta.bx.sh[sk.id] || 0, need = bxNeed(sk.id), b = cd.one;
      ctx.textAlign = 'center';
      uf(900, 14);
      ctx.fillStyle = c;
      ctx.fillText(n + ' / ' + need, b.x + b.w / 2, b.y + b.h / 2 - 4);
      bar(b.x + 8, b.y + b.h / 2 + 6, b.w - 16, 5, n / need, c);
      uf(600, 10);
      ctx.fillStyle = 'rgba(214,236,242,0.5)';
      ctx.fillText('碎片', b.x + b.w / 2, b.y + b.h / 2 + 24);
    }
  }
  if (shopMsg && nowMs() - shopMsgAt < 1800) {
    ctx.textAlign = 'center';
    uf(800, 13);
    ctx.fillStyle = shopMsg.charAt(0) === '还' ? '#ff9a8a' : UI.gold;
    ctx.fillText(shopMsg, W_CSS / 2, L.msgY);
  }
  drawButton(L.back, '返回', { kind: 'plain', size: 15 });
  if (shopOdds) drawBoxOdds();
  ctx.textAlign = 'left';
}
// 宝箱那一页（2.16 节）
function drawShopBox(L) {
  const B = L.box, cx = W_CSS / 2, n = meta.bx.n;
  drawChest(cx, B.chestY, 1.2, n > 0);
  ctx.textAlign = 'center';
  uf(900, 16);
  ctx.fillStyle = n > 0 ? UI.gold : 'rgba(214,236,242,0.6)';
  ctx.fillText(n > 0 ? '有 ' + n + ' 个宝箱没开' : '还没有宝箱', cx, B.chestY + 64);
  uf(500, 11);
  ctx.fillStyle = 'rgba(214,236,242,0.5)';
  ctx.fillText('体育生升一级送 1 个，每 5 级送 10 个', cx, B.chestY + 82);
  drawButton(B.odds, '概率', { kind: 'ghost', size: 12, weight: 700, color: 'rgba(214,236,242,0.7)' });
  drawButton(B.open1, '开一个', n > 0 ? { kind: 'primary', size: 16, weight: 900 } : { kind: 'off', size: 15, weight: 800 });
  drawButton(B.openAll, n > 1 ? '全部打开（' + n + '）' : '全部打开', n > 1 ? { kind: 'plain', size: 14, weight: 900 } : { kind: 'off', size: 14, weight: 800 });
  const can = meta.candy >= BOX.price;
  drawButton(B.buy, BOX.price + ' 颗嘉欣糖 · 买一个', { kind: can ? 'plain' : 'ghost', size: 15, weight: 900, color: can ? '#ffd0ea' : 'rgba(255,170,215,0.45)', glow: can ? CANDY_C : null });
  const left = bxAdLeft();
  drawButton(B.ad, left ? '看广告 · 十连抽（今天还剩 ' + left + ' 次）' : '看广告十连：今天用完了', left ? { kind: 'gold', size: 15, weight: 900, glow: UI.gold } : { kind: 'off', size: 14, weight: 800 });
  // 仓库道具：点一个 = 带它上场（局里左斩上面那个键，每局最多用 BOX.useMax 个）
  ctx.textAlign = 'left';
  uf(800, 12);
  ctx.fillStyle = 'rgba(214,236,242,0.75)';
  ctx.fillText('仓库道具 · 点一个带上场（每局最多用 ' + BOX.useMax + ' 个）', L.x + 20, B.invY);
  const carry = bxCarry();
  for (let i = 0; i < B.slots.length; i++) {
    const sl = B.slots[i], k = sl.k, sk = skinOf(k), cnt = meta.bx.inv[k], on = carry === k;
    bladeBox(sl.x, sl.y, sl.w, sl.h, { c: 6, top: on ? '#22301a' : '#111b21', bot: on ? '#141c10' : '#0a1014', border: on ? UI.gold : rgba(sk.c, cnt ? 0.4 : 0.15) });
    ctx.globalAlpha = cnt ? 1 : 0.35;
    drawPropIcon(k, sk, sl.x + sl.w / 2, sl.y + 28, 0.34);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    uf(800, 11);
    ctx.fillStyle = on ? UI.gold : 'rgba(234,246,248,0.8)';
    ctx.fillText(PROP_NAME[k] + ' ×' + cnt, sl.x + sl.w / 2, sl.y + sl.h - 10);
  }
}
// 宝箱：一个简单的箱子（箱体 + 盖 + 锁扣），有没开的就亮一点
function drawChest(x, y, s, lit) {
  const w = 56 * s, h = 40 * s;
  ctx.fillStyle = lit ? '#7a4a1c' : '#3a2a1a';
  ctx.fillRect(x - w / 2, y - h * 0.15, w, h * 0.7);
  ctx.fillStyle = lit ? '#9a5e24' : '#4a3520';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h * 0.15); ctx.lineTo(x - w / 2 + 6 * s, y - h * 0.55); ctx.lineTo(x + w / 2 - 6 * s, y - h * 0.55); ctx.lineTo(x + w / 2, y - h * 0.15);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = lit ? UI.gold : 'rgba(255,209,102,0.4)';
  ctx.fillRect(x - w / 2, y - h * 0.2, w, 4 * s);
  ctx.fillRect(x - 5 * s, y - h * 0.24, 10 * s, 14 * s);
  if (lit) { ctx.strokeStyle = rgba(UI.gold, 0.5); ctx.lineWidth = 2; ctx.strokeRect(x - w / 2 - 4, y - h * 0.6, w + 8, h * 1.2); }
}
// 概率公示（宝箱页「概率」）
function drawBoxOdds() {
  ctx.fillStyle = 'rgba(4,6,9,0.86)';
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  const w = Math.min(340, W_CSS - 24), x = (W_CSS - w) / 2, y = H_CSS * 0.2, cx = W_CSS / 2, h = 330;
  bladeBox(x, y, w, h, { c: 12, top: UI.panelTop, bot: UI.panelBot, border: rgba(UI.gold, 0.5), ticks: UI.gold });
  ctx.textAlign = 'center';
  uf(900, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('宝箱概率', cx, y + 32);
  const pct = function (t, k) { for (let i = 0; i < t.length; i++) if (t[i][0] === k) return t[i][1] + '%'; return '0%'; };
  const c1 = x + w - 104, c2 = x + w - 22;
  uf(800, 11);
  ctx.fillStyle = 'rgba(214,236,242,0.6)';
  ctx.textAlign = 'right';
  ctx.fillText('普通宝箱', c1, y + 58);
  ctx.fillStyle = UI.gold;
  ctx.fillText('广告十连', c2, y + 58);
  const rows = [['皮肤碎片（还没有的皮肤）', 'shard'], ['道具（四种随机 1 个，进仓库）', 'prop'], ['嘉欣糖（' + BOX.candyN[0] + '~' + BOX.candyN[1] + ' 颗）', 'candy'], ['整套皮肤（还没有的随机一套）', 'skin']];
  for (let i = 0; i < rows.length; i++) {
    const ry = y + 84 + i * 28;
    ctx.textAlign = 'left'; uf(600, 12); ctx.fillStyle = 'rgba(234,246,248,0.85)';
    ctx.fillText(rows[i][0], x + 16, ry);
    ctx.textAlign = 'right'; uf(900, 13);
    ctx.fillStyle = 'rgba(234,246,248,0.85)'; ctx.fillText(pct(BOX.odds, rows[i][1]), c1, ry);
    ctx.fillStyle = UI.gold; ctx.fillText(pct(BOX.adOdds, rows[i][1]), c2, ry);
  }
  ctx.textAlign = 'left'; uf(500, 11); ctx.fillStyle = 'rgba(214,236,242,0.6)';
  const notes = ['碎片：普通宝箱一次 ' + BOX.shardN[1] + ' 片，广告十连一次 ' + BOX.adShardN[0] + '~' + BOX.adShardN[1] + ' 片；',
    '广告十连至少出 ' + BOX.adMinShard + ' 次碎片；',
    '连开 ' + BOX.pity + ' 个没出整套皮肤，下一个必出（已开 ' + meta.bx.pity + ' 个）；',
    '皮肤都有了：碎片每片换 ' + BOX.shardCandy + ' 颗糖，整套换 ' + BOX.skinCandy + ' 颗。'];
  for (let i = 0; i < notes.length; i++) ctx.fillText(notes[i], x + 16, y + 214 + i * 20);
  ctx.textAlign = 'center'; uf(600, 11); ctx.fillStyle = 'rgba(214,236,242,0.45)';
  ctx.fillText('点任意处关闭', cx, y + h - 14);
}
// 道具升级那一页：左边道具图标，中间名字、现在管几秒 → 下一级几秒、几格等级，右边"糖买"
function drawShopProps(L) {
  for (let i = 0; i < L.props.length; i++) {
    const r = L.props[i], k = r.k, sk = skinOf(k), lv = meta.pu[k], c = propUpCost(k);
    bladeBox(r.x, r.y, r.w, r.h, { c: 8, top: '#111b21', bot: '#0a1014', border: rgba(sk.c, lv ? 0.45 : 0.2) });
    const ix = r.x + 14 + r.h * 0.36;
    drawPropIcon(k, sk, ix, r.y + r.h / 2, clamp(r.h / 110, 0.5, 0.85));
    const tx = ix + r.h * 0.36 + 12;
    ctx.textAlign = 'left';
    uf(900, 16);
    ctx.fillStyle = sk.c;
    ctx.fillText(PROP_NAME[k], tx, r.y + r.h / 2 - 12);
    uf(600, 11);
    ctx.fillStyle = 'rgba(214,236,242,0.72)';
    ctx.fillText(PROP_DESC[k], tx, r.y + r.h / 2 + 6);
    // 几级 + 下一级多几秒（软上限：越往后加得越少）
    uf(900, 11);
    ctx.fillStyle = lv ? sk.c : 'rgba(214,236,242,0.4)';
    ctx.fillText('Lv.' + lv, tx, r.y + r.h / 2 + 24);
    uf(700, 10);
    ctx.fillStyle = 'rgba(255,209,102,0.75)';
    ctx.fillText('下一级 +' + propUpDt(k, lv + 1) + ' 秒', tx + 40, r.y + r.h / 2 + 24);
    if (c) {
      const can = meta.candy >= c;
      drawButton(r.buy, c + ' 糖', { kind: can ? 'plain' : 'ghost', size: 14, weight: 900, color: can ? '#ffd0ea' : 'rgba(255,170,215,0.45)', glow: can ? CANDY_C : null });
    } else drawButton(r.buy, '满级', { kind: 'ghost', size: 14, weight: 900, color: UI.gold });
  }
}
function shopTap(t) {
  const L = shopLayout();
  if (shopOdds) { shopOdds = false; return; }
  if (inRect(t, L.back)) { state = 'ready'; resetInput(); return; }
  if (inRect(t, L.tabs.box)) { shopTab = 'box'; shopMsg = ''; return; }
  if (inRect(t, L.tabs.skin)) { shopTab = 'skin'; shopMsg = ''; return; }
  if (inRect(t, L.tabs.prop)) { shopTab = 'prop'; shopMsg = ''; return; }
  if (shopTab === 'box') {
    const B = L.box, say = function (m) { if (m) { shopMsg = m; shopMsgAt = nowMs(); vibrate(0); } };
    if (inRect(t, B.odds)) shopOdds = true;
    else if (inRect(t, B.open1)) { if (!bxOpenOwn(1)) say('还没有宝箱：升级送，或者买一个'); }
    else if (inRect(t, B.openAll)) { if (!bxOpenOwn(meta.bx.n)) say('还没有宝箱：升级送，或者买一个'); }
    else if (inRect(t, B.buy)) { const m = bxBuy(); if (m.charAt(0) === '还') say(m); else { shopMsg = m; shopMsgAt = nowMs(); } }
    else if (inRect(t, B.ad)) say(bxAd());
    else for (let i = 0; i < B.slots.length; i++) if (inRect(t, B.slots[i])) {
      const k = B.slots[i].k;
      if (meta.bx.inv[k] > 0) { meta.bx.carry = k; saveMeta(); say(''); shopMsg = '带' + PROP_NAME[k] + '上场'; shopMsgAt = nowMs(); }
      else say('仓库里没有' + PROP_NAME[k] + '：开宝箱能开出来');
    }
    return;
  }
  if (shopTab === 'prop') {
    for (let i = 0; i < L.props.length; i++) if (inRect(t, L.props[i].buy)) {
      shopMsg = propUpBuy(L.props[i].k); shopMsgAt = nowMs();
      if (shopMsg.charAt(0) === '还') vibrate(0);
      return;
    }
    return;
  }
  for (let i = 0; i < L.cards.length; i++) {
    const cd = L.cards[i], sk = cd.sk;
    if (!inRect(t, cd)) continue;
    shopMsg = heroBuy(sk); shopMsgAt = nowMs();       // 有了：点这一行就穿上；没有：说碎片攒了几片（2.16 节）
    return;
  }
}

/* ---------- 开局看广告带道具（用户："开局看广告获得道具"，选的是"开局前自己挑一个"） ----------
   主界面「开始」下面、失败页「再来一局」下面各一个金按钮 → 看完整条广告 → 三个道具挑一个 → 开局，
   开场一结束就生效（跟路上捡到的一样：效果、时长都一样，生效时路上不出新的）。每次开局都能看一次 */
let hStartProp = null;     // 这一局开场完了要生效的道具（startHorde 传进来，平常开局是 null）
let readyPropAd = null;    // 主界面那个金按钮画在哪（跟着「开始」走，drawReady 里记下来）
let readyHTut = null;      // 主界面「新手教程」画在哪（操作说明那行下面，放不下就不画；2.14 节）
function openPropPick() { state = 'propPick'; resetInput(); }
function hUseStartProp() {
  if (!hStartProp) return;
  hUseProp(hStartProp, P.x, P.y);
  hProp.start = true;
  hStartProp = null;
}
function propPickLayout() {
  const top = MENU ? Math.max(SAFE_TOP + 14, MENU.bottom + 12) : SAFE_TOP + 14;
  const w = Math.min(360, W_CSS - 32), x = (W_CSS - w) / 2;
  const y0 = Math.max(top + 90, H_CSS * 0.22), ch = Math.min(108, (H_CSS - SAFE_BOTTOM - 30 - y0) / PROP_KINDS.length - 12);
  const cards = [];
  for (let i = 0; i < PROP_KINDS.length; i++) cards.push({ k: PROP_KINDS[i], x: x, y: y0 + i * (ch + 12), w: w, h: ch });
  return { x: x, w: w, titleY: y0 - 48, cards: cards };
}
function drawPropPick() {
  inkBg(1);
  const L = propPickLayout(), cx = W_CSS / 2;
  ctx.textAlign = 'center';
  uf(900, 24);
  outlineText('挑一个道具带上场', cx, L.titleY, '#ffffff', 4);
  uf(600, 13);
  ctx.fillStyle = 'rgba(255,209,102,0.8)';
  ctx.fillText('开场一结束就生效', cx, L.titleY + 26);
  for (let i = 0; i < L.cards.length; i++) {
    const b = L.cards[i], sk = skinOf(b.k), ix = b.x + 18 + b.h * 0.42;
    bladeBox(b.x, b.y, b.w, b.h, { c: 10, top: '#16232b', bot: '#0b1217', border: rgba(sk.c, 0.55) });
    drawPropIcon(b.k, sk, ix, b.y + b.h / 2, clamp(b.h / 90, 0.6, 1.25));
    ctx.textAlign = 'left';
    uf(900, 20);
    ctx.fillStyle = sk.c;
    ctx.fillText(PROP_NAME[b.k], ix + b.h * 0.42 + 14, b.y + b.h / 2 - 4);
    uf(600, 13);
    ctx.fillStyle = 'rgba(234,246,248,0.75)';
    ctx.fillText(PROP_DESC[b.k], ix + b.h * 0.42 + 14, b.y + b.h / 2 + 20);
  }
  ctx.textAlign = 'left';
}
function propPickTap(t) {
  const L = propPickLayout();
  for (let i = 0; i < L.cards.length; i++) if (inRect(t, L.cards[i])) { hStartGo(L.cards[i].k); return; }
}

/* =========================================================
   2.14 黑潮新手教程 · 拿到道具报名字
   ---------------------------------------------------------
   用户："做个新手教程，还有每个道具拾起之后弹出个名字和介绍，说明是干什么的"
   教程：开场那一刀斩完接着教六步，规矩照正式玩法那套（见 TUT_STEPS 上面）——
   · 停住 + 暗屏高光（用户："新手教程，可以让游戏先停，用高光暗屏方式引导"）：每一步要做的东西摆好、现在就做得到时，
     游戏停住、整屏压暗，要看的（要斩的怪 / 糖 / 道具、人、要按的键、黑潮、命）挖成亮的洞，卡片 + 按钮上的手指说做什么；
     只认这一下（点对的那边 / 「连斩」键），点对了就放行、这一下照常斩出去，别的地方点了不算（暂停键照常）
   · 做到了才翻页；放行以后每一步还有兜底时间（limit 秒，停着的时候不算），不会卡死
   · 教的东西马上做得到：要斩的怪、要捡的糖、道具都是现摆的；教左右斩时人站住不跑，怪就在那一边的斜前方等着
   · 教的时候不掉命，黑潮压在屏幕外（教到「往前斩」「连斩」才放进屏幕下面，追不到人），前三步不刷别的、不涌
   · 每人自动教一次：第一局一开就记"看过"（meta.htut = H_TUT_VER），这一局教到哪算哪；想再看点主界面「新手教程」
   这一套接管了以前头三局开场挂的"怎么玩"那两行
   道具：每拿到一个（路上斩到 / 碰到的、开局看广告带的），屏幕上方弹一张卡：图标 + 名字 + 干什么用，两秒多淡掉
   ========================================================= */
const H_TUT = [
  { key: 'left',  limit: 12, title: '点左边 · 斩左前方的嘉豪',     sub: '斩 = 往那边闪过去，比跑得快' },
  { key: 'right', limit: 12, title: '点右边 · 斩右前方的嘉豪',     sub: '嘉豪在哪边，就点哪边' },
  { key: 'steer', limit: 12, title: '按住不放 · 往那边斜着走',   sub: '去捡嘉欣糖 · 攒着换皮肤' },
  { key: 'run',   limit: 14, title: '一路往前斩 · 别被嘉豪潮追上', sub: '撞到嘉豪、被追上都掉一颗心，三颗掉完就输' },
  { key: 'burst', limit: 15, title: '怒气满了 · 点「连斩」',      sub: '回头一刀，把一整屏斩光' },
  { key: 'prop',  limit: 15, title: '斩道具 · 拿到马上生效',      sub: '一次只有一个，用完了路上才出下一个' }
];
const H_TUT_DONE = H_TUT.length;
const H_TUT_VER = 2;       // 教程换过内容就加一：存档里看过旧版的人再教一遍（2：改成停住 + 暗屏高光）
const H_TUT_FIN = 3;       // 六步走完"出师了"挂几秒
const H_POP_T = 2.6;       // 道具卡挂几秒（最后 0.5 秒淡掉）

let hTut = H_TUT_DONE;     // 教到第几步；H_TUT_DONE = 不教
let hTutT = 0;             // 这一步挂了多久
let hTutA = 0;             // 卡片透明度（淡入 / 收尾淡出）
let hTutOut = false;       // 正在收尾淡出
let hTutFinT = 0;          // >0：六步走完，正在报"出师了"
let hTutRef = null;        // 这一步现摆的东西：怪 / 几颗糖 / 道具
let hTutK0 = 0;            // 进这一步时斩了几只
let hTutCandy0 = 0;        // 进这一步时捡了几颗糖
let hTutHold = 0;          // 这一步按住走了多久
let hTutBurst = false;     // 这一步的连斩放出去了（等收了刀再翻页）
let hTutAgain = false;     // 主界面点了「新手教程」：这一局从头教
let hTutPend = false;      // 这一局要教，等开场那一刀斩完（hTutStart）再开始
let hPropPop = null;       // 道具卡：{ k, t 弹出来多久了 }
let hTutFz = false;        // 停住了（暗屏 + 高光）：等玩家照着做（hTutLet / hTap / hBurstGo 放行）
let hTutFzA = 0;           // 暗屏透明度：停住时淡入，放行后淡出
let hTutFzN = 0;           // 这一步停过几次（按住走松手太早会再停一次）
let hTutSide = 0;          // 停住时要点哪边：-1 左 / 1 右 / 0 两边都行（「连斩」那一步看的是键）
let hTutIdle = 0;          // 按住走：放行以后松手多久了

function hTutOn() { return hordeMode && hTut < H_TUT_DONE; }
function hTutKey() { return hTut < H_TUT_DONE && hTutFinT <= 0 ? H_TUT[hTut].key : ''; }
// 前三步：只有现摆的东西（不刷挡路的、不撒糖、不兜底冒怪），黑潮在屏幕外
function hTutQuiet() { const k = hTutKey(); return k === 'left' || k === 'right' || k === 'steer'; }
// 教左右斩：人站住，不自己往上跑
function hTutStill() { const k = hTutKey(); return k === 'left' || k === 'right'; }
// 黑潮离你至少多远：教「往前斩」「连斩」放它进屏幕下面（连斩要扫到它），别的时候压在屏幕底边外
function hTutFloor() { const k = hTutKey(); return k === 'run' || k === 'burst' ? hBottomGap() * 0.55 : hBottomGap() + 120; }

// 开局（startHorde）：要不要教。真正开始教在开场那一刀斩完（hIntroEnd → hTutStart）
function hTutReset() {
  hTut = H_TUT_DONE; hTutA = 0; hTutOut = false; hTutFinT = 0; hTutRef = null; hPropPop = null; hTutPend = false;
  hTutFz = false; hTutFzA = 0;
  if (!HD.tut || (!hTutAgain && meta.htut === H_TUT_VER)) return;
  hTutAgain = false;
  meta.htut = H_TUT_VER; saveMeta();        // 一开就记看过：死了、退了都不再自动教
  hTutPend = true;
}
// 开场完了：要教就从第一步教起（返回 true = 教，要斩的东西教程自己摆）
function hTutStart() {
  if (!hTutPend) return false;
  hTutPend = false;
  hTutGo(0);
  return true;
}
// 主界面「新手教程」：开一局，从头教
function hTutReplay() { hTutAgain = true; startHorde(); }

function hTutGo(n) {
  hTut = n;
  hTutEnter();
}
// 进一步：记下起点，把这一步要用到的东西摆好
function hTutEnter() {
  hTutT = 0; hTutA = 0; hTutRef = null; hTutHold = 0; hTutBurst = false;
  hTutFz = false; hTutFzN = 0; hTutSide = 0; hTutIdle = 0;
  hTutK0 = runKills; hTutCandy0 = hCandyRun;
  if (hTut >= H_TUT_DONE) return;
  const k = H_TUT[hTut].key;
  if (k === 'left' || k === 'right') hTutFoe(k === 'left' ? -1 : 1);
  else if (k === 'steer') hTutCandy();
  else if (k === 'run') {
    // 放开：前面接着一路有得斩，糖照常撒
    hPathFill(P.y - 260);
    hCandyNext = hTop + rand(PROP.candyEvery[0], PROP.candyEvery[1]) * HD.m;
  } else if (k === 'burst') {
    hRage = 100; hFull = false;
    const fz = hTutWant();
    if (fz) hTutFreeze(fz);                 // 一进来就停：「连斩」键变金、卡片出来的同一帧（不给先点的空子）
  } else if (k === 'prop') { if (hProp) hTutNext(); else hTutItem(); }
}
function hTutNext() {
  // 到点了没斩掉的那只：收掉（站着不动的怪留在路上只会挡道）
  const i = hTutRef ? enemies.indexOf(hTutRef) : -1;
  if (i >= 0) enemies.splice(i, 1);
  if (hTut + 1 < H_TUT_DONE) hTutGo(hTut + 1);
  else { hTutFinT = 0.001; hTutA = 0; S.upgrade(); }
}
// 走廊里能摆的横向范围
function hTutX(x, m) { return clamp(x, hX0 - W / 2 + m, hX0 + W / 2 - m); }
// 左 / 右斩要斩的那只：摆在那一边的斜前方、一刀够得着，不动
function hTutFoe(side) {
  const e = spawnEnemy(hTutX(P.x + side * 130, 60), wwrap(P.y - 190), 'grunt');
  if (!e) return;
  e.sp = 0;
  hTutRef = e;
  rings.push({ x: e.x, y: e.y, r0: 6, r1: e.r * 3.2, life: 0.45, max: 0.45, color: 'rgba(191,239,255,0.5)', w: 2 });
}
// 按住走去捡的糖：往靠走廊中间那边斜着摆三颗，笔直跑捡不到（捡糖判定 120，横着至少隔 200）；
// 往前摆在一刀够不着的地方（停住时还在一刀外）：不然按下去那一下就把糖斩了，教不到"按住斜着走"
function hTutCandy() {
  const s = P.x > hX0 + 40 ? -1 : P.x < hX0 - 40 ? 1 : (Math.random() < 0.5 ? -1 : 1);
  hTutRef = [];
  for (let i = 0; i < 3; i++) {
    const c = { x: hTutX(P.x + s * (200 + 60 * i), 90), y: wwrap(P.y - hAimR() - 140 - 130 * i), ph: rand(0, 6.28) };
    hCandy.push(c); hTutRef.push(c);
  }
  hTutRef.side = s;
}
// 要斩的道具：前面偏一点（笔直跑碰不到，得斩），哪种随机
function hTutItem() {
  const s = P.x > hX0 ? -1 : 1;
  hItem = { k: PROP_KINDS[Math.floor(Math.random() * PROP_KINDS.length)], x: hTutX(P.x + s * 110, 80), y: wwrap(P.y - 340), t: 0 };
  hPropNext = Infinity;
  hTutRef = hItem;
}

function hTutTick(dt) {
  if (hPropPop && (hPropPop.t += dt) > H_POP_T) hPropPop = null;
  if (hqPop && (hqPop.t += dt) > HQ.popT) hqPop = null;        // 任务完成的卡（2.15 节）
  if (hTutFzA > 0) hTutFzA = Math.max(0, hTutFzA - dt * 6);      // 放行了：暗屏很快退掉
  if (hTut >= H_TUT_DONE) return;
  if (hTutOut) {
    hTutA -= dt * 1.9;
    if (hTutA <= 0) { hTutA = 0; hTut = H_TUT_DONE; hTutEnd(); }
    return;
  }
  hTutT += dt;
  hTutA = Math.min(1, hTutA + dt * 3.4);
  if (hTutFinT > 0) {
    hTutFinT += dt;
    if (hTutFinT > H_TUT_FIN) hTutOut = true;
    return;
  }
  // 前三步：不刷别的
  if (hTutQuiet()) { hNext = hTop + 1e9; hCandyNext = hTop + 1e9; hDryT = 0; }
  if (hPropNext !== Infinity) hPropNext = Infinity;       // 道具只在教到那一步现摆

  const k = H_TUT[hTut].key;
  const fz = hTutWant();
  if (fz) { hTutFreeze(fz); return; }
  let done = hTutT > H_TUT[hTut].limit;
  if (k === 'left' || k === 'right') {
    if (hTutRef && enemies.indexOf(hTutRef) < 0) done = true;
    else if (!hTutRef) hTutFoe(k === 'left' ? -1 : 1);
  } else if (k === 'steer') {
    if (hSteerDir()) { hTutHold += dt; hTutIdle = 0; } else hTutIdle += dt;
    if (hCandyRun > hTutCandy0 || hTutHold > 1.5) done = true;
    // 三颗都跑过去了还没捡到：前面再摆三颗
    else if (hTutRef && !hTutRef.some(function (c) { return hCandy.indexOf(c) >= 0; })) hTutCandy();
  } else if (k === 'run') {
    if (runKills - hTutK0 >= 6) done = true;
  } else if (k === 'burst') {
    if (hBurst) hTutBurst = true;
    if (hTutBurst) done = !hBurst;                          // 放出去了：等收了刀再翻页
    else if (done) hRage = Math.max(hRage, 100);            // 到点也没点：怒气留着，自己想用再用
  } else if (k === 'prop') {
    if (hProp) done = true;
    else if (!hItem) { hTutItem(); hTutFzN = 0; }           // 没斩到、跑过去了：前面再摆一个（够得着时再停一次）
  }
  if (done) hTutNext();
}
// 教完（收尾淡完）：道具照常在路上出；再无敌 1 秒（教的时候是穿过怪的，别一教完正好在怪身上就掉命）
function hTutEnd() {
  if (!hItem && !hProp && hPropNext === Infinity) hPropNext = hTop + PROP.every * HD.m;
  P.inv = Math.max(P.inv, 1);
}

// 该停了没有：这一步要做的东西摆好了、现在点下去就做得到、还没做到（冲刺 / 连斩 / 鬼火里不停）。
// 已经做到了、或者现在做不到的不停 —— 停了就只能等那一下，做不到就卡死（以前「连斩」先放了再停：怒气空了，点不出来）。
// 返回要点哪边：-1 / 1；2 = 两边都行（往前斩）/ 「连斩」键；0 = 不停
function hTutWant() {
  if (hTut >= H_TUT_DONE || hTutFinT > 0 || hTutOut || hTutFz || hBurst || hPropOn('ghost')) return 0;
  const k = H_TUT[hTut].key;
  // 「连斩」：一进这一步就停（用户："连斩怎么不暂停" —— 以前等 0.3 秒，「连斩」键先亮了，人先点了），冲刺到一半也停（放连斩会把冲刺收掉）
  if (k === 'burst') return !hTutFzN && !hTutBurst && hRage >= 100 ? 2 : 0;
  if (P.dashT > 0) return 0;
  if (k === 'left' || k === 'right') {
    const s = k === 'left' ? -1 : 1, t = s < 0 ? hAimTL : hAimTR;
    return !hTutFzN && hTutT > 0.45 && t && t.ref === hTutRef ? s : 0;      // 怪摆出来、这一边锁上它了
  }
  if (k === 'steer') {
    if (!hTutRef || hHeld(hTutRef.side)) return 0;                            // 已经按着了：不打断
    if (hCandyRun > hTutCandy0 || hTutHold > 1.5 || !hTutRef.some(function (c) { return hCandy.indexOf(c) >= 0; })) return 0;   // 捡到了 / 按够了 / 糖都跑过去了
    return (!hTutFzN ? hTutT > 0.5 : hTutIdle > 0.6) ? hTutRef.side : 0;      // 松手太早：再停一次
  }
  if (k === 'run') return !hTutFzN && runKills - hTutK0 < 6 && (hGap() < hTutFloor() + 80 || hTutT > 2.5) ? 2 : 0;   // 黑潮进了屏幕
  if (k === 'prop' && !hTutFzN && hItem && !hProp) return hAimTL && hAimTL.ref === hItem ? -1 : hAimTR && hAimTR.ref === hItem ? 1 : 0;   // 道具锁上了
  return 0;
}
function hTutFreeze(r) {
  hTutFz = true; hTutFzN++;
  hTutSide = r === 2 ? 0 : r;
  P.cd = 0; hNibbleAt = -1e9;                // 点下去马上出得了刀
}
// 停住时这根手指算不算：「连斩」那一步只认「连斩」键；别的步只认对的那一边（「连斩」键上不算）
function hTutLet(t) {
  const b = hBurstBtn(), onB = Math.hypot(t.clientX - b.x, t.clientY - b.y) < b.r * 1.25;
  if (hTutKey() === 'burst') return onB;
  return !onB && (!hTutSide || (t.clientX < W_CSS / 2 ? -1 : 1) === hTutSide);
}

// 卡片放顶上 HUD 下面（躲开暂停键、帧数）：要斩的东西都在人前面，人和按钮之间太挤
function hTutCardY() { return hudTop() + 180; }
function drawHordeTut() {
  if (state !== 'play' || hTut >= H_TUT_DONE || hTutA <= 0.01 || hBurst) return;
  const a = hTutA, fin = hTutFinT > 0, k = hTutKey(), bx = s => s < 0 ? W_CSS - DASH_BTN.x : DASH_BTN.x;
  if (hTutFzA > 0.01) drawHTutDim(hTutFzA);           // 停住了：暗屏 + 挖亮的洞，手指、卡片画在它上面
  if (k === 'left' || k === 'right') {
    const sd = k === 'left' ? -1 : 1;
    if (hTutRef && enemies.indexOf(hTutRef) >= 0) drawHTutPoint(hTutRef.x, hTutRef.y, hTutRef.r, '斩它', UI.ice, a);
    drawHTutTap(bx(sd), DASH_BTN.y, DASH_BTN.r, false, a);
  } else if (k === 'steer') {
    const sd = hTutRef ? hTutRef.side : 1;
    if (hTutRef) for (let i = 0; i < hTutRef.length; i++) if (hCandy.indexOf(hTutRef[i]) >= 0) { drawHTutPoint(hTutRef[i].x, hTutRef[i].y, 18, '嘉欣糖', CANDY_C, a); break; }
    drawHTutTap(bx(sd), DASH_BTN.y, DASH_BTN.r, true, a);
  } else if (k === 'run') {
    if (hTutFz) {                                      // 停着：指一下黑潮，两个斩键都点
      drawHTutPoint(hX0, P.y + hGap(), 0, '黑潮在追你', '#ff6b7c', a, true);
      drawHTutTap(bx(-1), DASH_BTN.y, DASH_BTN.r, false, a);
      drawHTutTap(bx(1), DASH_BTN.y, DASH_BTN.r, false, a);
    }
  } else if (k === 'burst') {
    const b = hBurstBtn();
    drawHTutTap(b.x, b.y, b.r, false, a);
  } else if (k === 'prop') {
    if (hItem) drawHTutPoint(hItem.x, hItem.y, PROP.pickR, PROP_NAME[hItem.k], skinOf(hItem.k).c, a);
    if (hTutFz && hTutSide) drawHTutTap(bx(hTutSide), DASH_BTN.y, DASH_BTN.r, false, a);
  }
  // 卡片：一张贴图（换一步才重画），淡入时从 0.9 放大到 1
  const w = Math.min(W_CSS - 60, 320), h = 66, y = hTutCardY();
  const s = 0.9 + 0.1 * easeOut(fin ? hTutFinT / 0.25 : hTutA);      // 跟着淡入放大（停着时 hTutT 不走）
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W_CSS / 2, y);
  ctx.scale(s, s);
  hText('hdTut', fin ? 'fin' : String(hTut), -w / 2, -h / 2, w, h, function () {
    bladeBox(1, 1, w - 2, h - 2, { c: 12, top: '#0f1a20', bot: '#070c10',
      border: fin ? rgba(UI.gold, 0.8) : rgba(UI.cyan, 0.45), lw: 1.2, ticks: fin ? rgba(UI.gold, 0.8) : rgba(UI.cyan, 0.6) });
    const n = H_TUT_DONE, cur = fin ? n : hTut;
    for (let i = 0; i < n; i++) {
      gem(w / 2 + (i - (n - 1) / 2) * 14, 11, i === cur ? 5 : 3.5,
        i < cur ? UI.cyan : (i === cur ? '#ffffff' : 'rgba(255,255,255,0.18)'));
    }
    ctx.textAlign = 'center';
    uf(800, 16);
    ctx.fillStyle = fin ? UI.gold : '#eafcff';
    ctx.fillText(fin ? '出师了，体育生！' : H_TUT[hTut].title, w / 2, 37);
    uf(500, 12);
    ctx.fillStyle = 'rgba(214,240,255,0.62)';
    ctx.fillText(fin ? '逃得越远越好 · 想再看，主界面点「新手教程」' : H_TUT[hTut].sub, w / 2, 56);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}
// 手指在按钮上：点（一下一下，点下去荡开一圈）或按住（外圈一路转满）
function drawHTutTap(x, y, R, hold, a) {
  const ph = (nowMs() / 1300) % 1;
  if (hold) {
    const p = clamp(hTutHold > 0 ? hTutHold / 1.5 : ph / 0.8, 0, 1);
    ctx.globalAlpha = a;
    ctx.lineWidth = 3;
    ctx.strokeStyle = UI.gold;
    ctx.beginPath();
    ctx.arc(x, y, R + 12, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    if (!hTutHold) drawFinger(x - R * 0.2, y + R * 0.35, ph < 0.85, a);
  } else {
    if (ph > 0.2 && ph < 0.7) {
      const k = (ph - 0.2) / 0.5;
      ctx.globalAlpha = a * (1 - k) * 0.8;
      ctx.lineWidth = 2;
      ctx.strokeStyle = UI.cyan;
      ctx.beginPath();
      ctx.arc(x, y, R + 8 + k * 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawFinger(x - R * 0.2, y + R * 0.35, ph > 0.2 && ph < 0.36, a);
  }
  ctx.globalAlpha = 1;
}
// 指着场上的东西：两道转着的弧 + 头顶一个往下的箭头 + 名字（名字是贴图）；noRing：只要箭头和名字（指黑潮）
function drawHTutPoint(x, y, wr, label, c, a, noRing) {
  const p = toScreen(x, y), t = nowMs() / 1000, r = wr * SC + 12;
  if (p.y < hudTop() + 60 || p.y > H_CSS) return;
  ctx.globalAlpha = a;
  if (!noRing) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = c;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const a0 = t * 1.2 + i * Math.PI - 0.7;
      ctx.moveTo(p.x + Math.cos(a0) * r, p.y + Math.sin(a0) * r);
      ctx.arc(p.x, p.y, r, a0, a0 + 1.4);
    }
    ctx.stroke();
  }
  drawArrow(p.x, p.y - r - 14 + Math.sin(t * 6) * 4, Math.PI / 2, c);
  hText('hdTutL', label + c, p.x - 60, p.y - r - 46, 120, 22, function () {
    ctx.textAlign = 'center';
    uf(800, 12);
    outlineText(label, 60, 15, c, 3);
  });
  ctx.globalAlpha = 1;
}

// 停住时挖亮的洞（屏幕坐标）：c = 圆 [x, y, r]；rect = 方的（命那一排）；y1 = 压暗压到哪（往前斩：底下黑潮那一截整条亮着）
function hTutHoles() {
  const k = hTutKey(), c = [], o = { c: c, rect: null, y1: H_CSS };
  const at = (x, y, r) => { const p = toScreen(x, y); c.push([p.x, p.y, r]); };
  const btn = sd => c.push([sd < 0 ? W_CSS - DASH_BTN.x : DASH_BTN.x, DASH_BTN.y, DASH_BTN.r + 10]);
  if (k === 'left' || k === 'right' || k === 'prop') {
    btn(hTutSide || (k === 'left' ? -1 : 1));
    const t = k === 'prop' ? hItem : hTutRef;
    if (t) at(t.x, t.y, (k === 'prop' ? 22 : t.r || 14) * SC + 20);
  } else if (k === 'steer') {
    btn(hTutSide || 1);
    if (hTutRef) for (let i = 0; i < hTutRef.length; i++) if (hCandy.indexOf(hTutRef[i]) >= 0) at(hTutRef[i].x, hTutRef[i].y, 18 * SC + 16);
  } else if (k === 'run') {
    o.y1 = Math.min(toScreen(P.x, P.y + hGap()).y - 40, DASH_BTN.y - DASH_BTN.r - 14);
    o.rect = [8, hudTop() + 46, 98, 34];
  } else if (k === 'burst') {
    const b = hBurstBtn();
    c.push([b.x, b.y, b.r + 14]);
  }
  if (k !== 'burst') at(P.x, P.y, P.r * SC + 16);     // 人在哪
  // 两个洞叠在一起会被填回去（非零环绕）：叠上的后一个不挖；被卡片压着的也不挖（往上斜着的糖）
  const cb = hTutCardY() + 33 + 4;
  for (let i = c.length - 1; i >= 0; i--) {
    let drop = c[i][1] - c[i][2] < cb;
    for (let j = 0; j < i && !drop; j++) drop = Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]) < c[i][2] + c[j][2];
    if (drop) c.splice(i, 1);
  }
  return o;
}
// 暗屏：一笔填完 —— 外面一个方框，洞逆时针画（非零环绕 = 挖空）；洞边一圈呼吸的亮线（一笔）。
// 不用径向渐变：抖音上每帧画全屏渐变时好时坏（见 CFG.veil）
function drawHTutDim(a) {
  const o = hTutHoles(), c = o.c, r = o.rect;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(2,5,9,0.76)';
  ctx.beginPath();
  ctx.rect(0, 0, W_CSS, o.y1);
  for (let i = 0; i < c.length; i++) { ctx.moveTo(c[i][0] + c[i][2], c[i][1]); ctx.arc(c[i][0], c[i][1], c[i][2], Math.PI * 2, 0, true); }
  if (r) { ctx.moveTo(r[0], r[1]); ctx.lineTo(r[0], r[1] + r[3]); ctx.lineTo(r[0] + r[2], r[1] + r[3]); ctx.lineTo(r[0] + r[2], r[1]); ctx.closePath(); }
  ctx.fill();
  ctx.globalAlpha = a * (0.5 + 0.3 * Math.sin(nowMs() / 1000 * 5));
  ctx.lineWidth = 2;
  ctx.strokeStyle = UI.cyan;
  ctx.beginPath();
  for (let i = 0; i < c.length; i++) { ctx.moveTo(c[i][0] + c[i][2], c[i][1]); ctx.arc(c[i][0], c[i][1], c[i][2], 0, Math.PI * 2); }
  if (r) ctx.rect(r[0], r[1], r[2], r[3]);
  if (o.y1 < H_CSS) { ctx.moveTo(0, o.y1); ctx.lineTo(W_CSS, o.y1); }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// 道具卡：屏幕上方正中（连斩数下面），图标 + 名字 + 干什么用。弹出来 0.15 秒从 0.85 放大到 1，最后 0.5 秒淡掉
function drawPropPop() {
  if (!hPropPop || state !== 'play') return;
  const k = hPropPop.k, t = hPropPop.t, sk = skinOf(k);
  // 教程卡也在（拿到教程摆的道具那一下）：往下让开一张卡
  const w = Math.min(W_CSS - 40, 300), h = 74, y = hTutCardY() + (hTutOn() && hTutA > 0.01 ? 82 : 0);
  const s = 0.85 + 0.15 * easeOut(t / 0.15);
  ctx.save();
  ctx.globalAlpha = clamp((H_POP_T - t) / 0.5, 0, 1);
  ctx.translate(W_CSS / 2, y);
  ctx.scale(s, s);
  hText('hdPop', k + hPropT(k), -w / 2, -h / 2, w, h, function () {   // 升级了秒数会变：key 带上秒数
    bladeBox(1, 1, w - 2, h - 2, { c: 12, top: 'rgba(16,26,32,0.92)', bot: 'rgba(7,12,16,0.92)', border: rgba(sk.c, 0.7), lw: 1.4, ticks: rgba(sk.c, 0.9) });
    drawPropIcon(k, sk, 44, h / 2, 0.62);
    ctx.textAlign = 'left';
    uf(900, 20);
    ctx.fillStyle = sk.c;
    ctx.fillText(PROP_NAME[k], 82, h / 2 - 5);
    uf(600, 13);
    ctx.fillStyle = 'rgba(234,246,248,0.82)';
    ctx.fillText(PROP_DESC[k], 82, h / 2 + 18);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* =========================================================
   2.15 任务和嘉豪等级 · 糖升级道具（黑潮玩法）
   ---------------------------------------------------------
   玩家反馈"感觉玩着没什么目标，也没什么进度积累，游戏过程更是单一"。用户问了地铁跑酷 / 滑雪大冒险 / 神庙逃亡怎么做，
   定了照跑酷的做法（"我决定可以，你试试"）：
   · 任务：一次挂三个（H_QUESTS 里随机挑三种，不重样），目标跟着嘉豪等级涨。"一局"的只算这一局（记最好的一局），
     "累计"的跨局攒。开场那一片、新手教程里斩的不算
   · 做完一个：屏幕上方弹一张小卡，马上给糖（hqReward）；三个都做完：这一局结算时嘉豪升一级、换一批新的
     （新的一批从下一局才开始算：看广告复活接着跑的那一段不算）
   · 等级：每升一级，之后每局捡的嘉欣糖多 10%（hqCandyK，结算时补上），最高 HQ.maxLv 级
   · 糖升级道具（PROP_UP）：每个道具 5 级，每级多几秒；商店里「道具」那一页
   具体数都是我先定的，用户改了照改
   ========================================================= */
// candyLv：每级糖多几成。以前 0.1，用户定了升级改给宝箱（2.16 节 BOX）以后改成 0；box / box5：升一级给几个宝箱、每 5 级给几个
const HQ = { maxLv: 30, candyLv: 0, popT: 2.4, box: 1, box5: 10, per: 3 };   // per：做完几个升一级
// 任务：id、run 一局的（true）/ 累计的（false）、t [起步, 每级多多少, 最多]、txt 怎么写
// s / u：局里左上角那个小框写的短名字、单位（drawQuestHud）
// 起步按机器人量的定（反应 0.35 秒的一局 30~80 秒、340~1170 米：爆裂者 0~2、连斩 1~3、糖 11~39、涌浪里斩 0~7、
// 不掉命 50~440 米，头一两局能做完一两个）；每级多的那一截按反应 0.25 秒的（一局 2000 米上下）第 10 级左右够得着
const H_QUESTS = [
  { id: 'dist', run: true, t: [400, 150, 6000], txt: function (n) { return '一局跑到 ' + n + ' 米'; }, s: '一局跑', u: ' 米' },
  { id: 'nohit', run: true, t: [200, 100, 3000], txt: function (n) { return '一条命不掉，跑到 ' + n + ' 米'; }, s: '不掉命跑', u: ' 米' },
  { id: 'candy', run: true, t: [20, 8, 200], txt: function (n) { return '一局捡 ' + n + ' 颗嘉欣糖'; }, s: '一局捡糖', u: '' },
  { id: 'bomb', run: true, t: [1, 1, 15], txt: function (n) { return '一局斩 ' + n + ' 只打碟嘉豪'; }, s: '斩打碟嘉豪', u: '' },
  { id: 'heavy', run: true, t: [1, 0.4, 8], txt: function (n) { return '一局劈开 ' + n + ' 只胖嘉豪'; }, s: '劈开胖嘉豪', u: '' },
  { id: 'burst', run: true, t: [2, 1, 12], txt: function (n) { return '一局放 ' + n + ' 次回头连斩'; }, s: '回头连斩', u: ' 次' },
  { id: 'surge', run: true, t: [5, 4, 80], txt: function (n) { return '一局在涌浪里斩 ' + n + ' 只嘉豪'; }, s: '涌浪里斩', u: '' },
  { id: 'charge', run: false, t: [3, 1, 20], txt: function (n) { return '趁冲锋嘉豪蓄力，斩掉它 ' + n + ' 次'; }, s: '蓄力时斩冲锋', u: '' },
  { id: 'prop', run: false, t: [3, 1, 20], txt: function (n) { return '用 ' + n + ' 个道具'; }, s: '用道具', u: '' },
  { id: 'foe', run: false, t: [200, 60, 3000], txt: function (n) { return '累计斩 ' + n + ' 只嘉豪（不算嘉豪潮）'; }, s: '斩嘉豪', u: '' },
  { id: 'far', run: false, t: [2000, 800, 50000], txt: function (n) { return '累计跑 ' + n + ' 米'; }, s: '累计跑', u: ' 米' },
  // 用户："任务种类要多些，现在太少了"：再加 14 种（max：一次里最多到多少，不是攒的 —— 一次回头连斩斩几只、顺着队形连着斩几只）。
  // 起步按机器人一局量的：反应 0.35 秒的一局 80~90 秒斩黑潮 380~750、一次连斩 200 上下、顺着队形连斩 24~34、黑潮露头时斩 80 多、
  // 挺过涌浪 2 次、冲锋者 0~2；反应 0.25 秒的翻一倍上下
  { id: 'horde', run: true, t: [150, 60, 3000], txt: function (n) { return '一局斩 ' + n + ' 只嘉豪潮里的'; }, s: '斩嘉豪潮', u: '' },
  { id: 'burstMax', run: true, max: true, t: [120, 25, 600], txt: function (n) { return '一次回头连斩斩到 ' + n + ' 只'; }, s: '一次连斩斩', u: ' 只' },
  { id: 'wave', run: true, t: [2, 0.5, 15], txt: function (n) { return '一局里再闯过 ' + n + ' 波'; }, s: '再闯过', u: ' 波' },
  { id: 'chain', run: true, max: true, t: [12, 4, 80], txt: function (n) { return '顺着队形连着斩 ' + n + ' 只'; }, s: '顺着队形连斩', u: '' },
  { id: 'surgeLive', run: true, t: [1, 0.4, 15], txt: function (n) { return '一局挺过 ' + n + ' 次涌浪'; }, s: '挺过涌浪', u: ' 次' },
  { id: 'charger', run: true, t: [1, 0.5, 15], txt: function (n) { return '一局斩 ' + n + ' 只冲锋嘉豪'; }, s: '斩冲锋嘉豪', u: '' },
  { id: 'nearHorde', run: true, t: [30, 15, 600], txt: function (n) { return '嘉豪潮露头的时候斩 ' + n + ' 只嘉豪'; }, s: '潮边上斩', u: '' },
  { id: 'ghostKill', run: false, t: [20, 10, 500], txt: function (n) { return '鬼火冲的时候斩 ' + n + ' 只嘉豪'; }, s: '鬼火里斩', u: '' },
  { id: 'heavyKill', run: false, t: [1, 0.5, 20], txt: function (n) { return '补刀砍死 ' + n + ' 只胖嘉豪'; }, s: '砍死胖嘉豪', u: '' },
  { id: 'candyAll', run: false, t: [80, 40, 3000], txt: function (n) { return '累计捡 ' + n + ' 颗嘉欣糖'; }, s: '累计捡糖', u: '' },
  { id: 'use_ruler', run: false, t: [1, 0.25, 6], txt: function (n) { return '用 ' + n + ' 次黑板尺'; }, s: '用黑板尺', u: ' 次' },
  { id: 'use_stink', run: false, t: [1, 0.25, 6], txt: function (n) { return '用 ' + n + ' 次臭水'; }, s: '用臭水', u: ' 次' },
  { id: 'use_ghost', run: false, t: [1, 0.25, 6], txt: function (n) { return '用 ' + n + ' 次鬼火'; }, s: '用鬼火', u: ' 次' },
  { id: 'use_magnet', run: false, t: [1, 0.25, 6], txt: function (n) { return '用 ' + n + ' 次吸铁石'; }, s: '用吸铁石', u: ' 次' }
];
const H_QUEST = {};
for (let i = 0; i < H_QUESTS.length; i++) H_QUEST[H_QUESTS[i].id] = H_QUESTS[i];
// 这一级这个任务要多少（取个整：过百按 10、过千按 50）
function hqNeed(Q, lv) {
  const v = Math.min(Q.t[2], Math.round(Q.t[0] + Q.t[1] * (lv - 1)));
  return v >= 1000 ? Math.round(v / 50) * 50 : v >= 100 ? Math.round(v / 10) * 10 : v;
}
// 任务轮着来（用户："游戏内的任务是轮动的，就是完成一个直接下一个，让玩家一直有目标？然后单次奖励减少"）：
// 做完一个马上在这一格补一个新的（从现在开始算）；每做完 HQ.per 个嘉豪升一级、送宝箱（局里当场升，不等结算）。
// 一个给的糖减半：20 + 10·(级−1) → 10 + 5·(级−1)
function hqReward() { return 10 + 5 * (meta.hq.lv - 1); }            // 做完一个给几颗糖
function hqCandyK() { return 1 + HQ.candyLv * (meta.hq.lv - 1); }    // 捡的糖结算时乘几（现在是 1）
// 新任务的起点：一局的任务从现在这局攒到多少开始算（跑多远 = 现在几米）；累计的从 0 起
function hqBase(id) { return id === 'dist' || id === 'nohit' ? (hqRun.dist || 0) : id === 'wave' ? (hqRun.wave || 1) : (hqRun[id] || 0); }
// 挑一个新任务：不跟另外两格、刚做完的那个重样
// t0：什么时候补上的（局里挂"新"字用）；读存档时还没开局，传 -99
function hqNew(skip, t0) {
  const pool = H_QUESTS.filter(function (Q) { return skip.indexOf(Q.id) < 0; });
  const Q = pool[Math.floor(Math.random() * pool.length)] || H_QUESTS[0];
  return { id: Q.id, n: hqNeed(Q, meta.hq.lv), d: 0, b: H_QUEST[Q.id].run ? hqBase(Q.id) : 0, m: 0, t0: t0 === undefined ? gameTime : t0 };
}
// 换一批：三种不重样，跟上一批也尽量不一样（新存档、坏存档）
function hqDeal() {
  const old = meta.hq.q.map(function (q) { return q.id; }), pool = H_QUESTS.filter(function (Q) { return old.indexOf(Q.id) < 0; });
  const all = pool.length >= 3 ? pool : H_QUESTS.slice(), q = [];
  while (q.length < 3) {      // 挑一个从池子里拿掉一个（不会挑重，随机数再怪也不会转圈）
    const Q = all.splice(Math.floor(Math.random() * all.length), 1)[0];
    q.push({ id: Q.id, n: hqNeed(Q, meta.hq.lv), d: 0, b: 0, t0: -99 });
  }
  meta.hq.q = q;
}
// 存档里的（2.x 存档读进来的是原样，这里对着任务表查一遍；没有 / 坏了就发一批新的）。
// 以前的存档里做完了还挂着的（ok）：算进升级进度，换成新的
function hqLoad() {
  const q = (meta.hq.q || []).filter(function (x) { return x && H_QUEST[x.id]; });
  meta.hq.lv = clamp(parseInt(meta.hq.lv, 10) || 1, 1, HQ.maxLv);
  meta.hq.k = clamp(parseInt(meta.hq.k, 10) || 0, 0, HQ.per - 1);
  meta.hq.q = q.slice(0, 3).map(function (x) { return { id: x.id, n: Math.max(1, parseInt(x.n, 10) || 1), d: Math.max(0, parseInt(x.d, 10) || 0), ok: x.ok ? 1 : 0, b: 0, t0: -99 }; });
  if (meta.hq.q.length < 3) { meta.hq.q = []; hqDeal(); }
  for (let i = 0; i < meta.hq.q.length; i++) if (meta.hq.q[i].ok) {
    meta.hq.k = Math.min(HQ.per - 1, meta.hq.k + 1);
    meta.hq.q[i] = hqNew(meta.hq.q.map(function (x) { return x.id; }), -99);
  }
  for (let i = 0; i < PROP_KINDS.length; i++) meta.pu[PROP_KINDS[i]] = clamp(parseInt(meta.pu[PROP_KINDS[i]], 10) || 0, 0, PROP_UP.max);
}

let hqRunN = 0;            // 第几局
let hqRun = {};            // 这一局各项攒了多少（一局的任务看它；dist 现在几米，hitM 上次掉命时几米）
let hqHit = false;         // 这一局掉过命没有
let hqGot = 0;             // 这一局任务给了几颗糖
let hqUp = null;           // 这一局升了级：{ lv 升到几级, box 一共送了几个宝箱, q 最近做完的三个 }（宝箱页报）
let hqRunDone = [];        // 这一局做完的任务（宝箱页列最近三个）
let hqPop = null;          // 升级那一下弹的卡：{ text 做完的那个, c 给几颗糖, up { lv, box }, t }
let hqFlash = null;        // 普通做完一个：任务框里那一行闪一下金色"✓ 名字 +糖"：{ i 第几格, s 短名字, c, at }（任务多了，不再每个都弹大卡挡前面）
let hqLv0 = 1;             // 这一局开局时的嘉豪等级（糖加成按它算：中途升级不改这一局的）
hqLoad();
function hqStart() {
  hqRunN++; hqRun = { wave: 1 }; hqHit = false; hqGot = 0; hqUp = null; hqPop = null; hqFlash = null; hqLv0 = meta.hq.lv; hqRunDone = [];
  for (let i = 0; i < meta.hq.q.length; i++) { const q = meta.hq.q[i]; q.b = hqBase(q.id); q.m = 0; q.t0 = -99; }   // 一局的任务：这局从头算
}
// 算不算：黑潮主玩法、在玩、不在开场 / 教程里
function hqLive() { return hordeMode && state === 'play' && !hIntro && !hTutOn(); }
// 这一格现在做到多少：一局的 = 这局攒的 − 起点（一条命不掉 = 从起点和上次掉命里晚的那个算起）；累计的 = 存档里的
function hqCur(q) {
  const Q = H_QUEST[q.id];
  if (!Q.run) return q.d;
  if (Q.max) return q.m || 0;
  if (q.id === 'nohit') return Math.max(0, (hqRun.dist || 0) - Math.max(q.b || 0, hqRun.hitM || 0));
  if (q.id === 'wave') return Math.max(0, (hqRun.wave || 1) - (q.b || 1));
  return Math.max(0, (hqRun[q.id === 'dist' ? 'dist' : q.id] || 0) - (q.b || 0));
}
// 一局的：记这一局到了多少（v）；累计的：加 v
function hqSet(id, v) {
  if (!hqLive()) return;
  if ((hqRun[id] || 0) >= v) return;
  hqRun[id] = v;
  hqCheck(id);
}
function hqAdd(id, v) {
  if (!hqLive()) return;
  hqRun[id] = (hqRun[id] || 0) + (v || 1);
  hqCheck(id, v || 1);
}
// "一次里最多到多少"的（max）：这一次是 v，比这一格补上以后最好的那次多就记下
function hqMax(id, v) {
  if (!hqLive()) return;
  const qs = meta.hq.q;
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (q.id !== id) continue;
    q.m = Math.max(q.m || 0, v);
    q.d = Math.max(q.d, Math.min(q.n, q.m));
    if (q.m >= q.n) hqComplete(i);
  }
}
function hqCheck(id, add) {
  const qs = meta.hq.q;
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (q.id !== id) continue;
    if (!H_QUEST[id].run) { if (add) q.d = Math.min(q.n, q.d + add); }
    else q.d = Math.max(q.d, Math.min(q.n, hqCur(q)));      // 一局的：记最好的一次（主界面写"最好"）
    if (hqCur(q) >= q.n) hqComplete(i);
  }
}
// 做完一格：给糖、弹卡；够 HQ.per 个就升一级送宝箱；这一格马上补一个新的
function hqComplete(i) {
  const qs = meta.hq.q, q = qs[i], c = hqReward();
  meta.candy += c; hqGot += c;
  hqRunDone.push({ id: q.id, n: q.n });
  let up = null;
  meta.hq.k = (meta.hq.k || 0) + 1;
  if (meta.hq.k >= HQ.per) {
    meta.hq.k = 0;
    const lv = Math.min(HQ.maxLv, meta.hq.lv + 1), box = lv % 5 === 0 ? HQ.box5 : HQ.box;   // 升级给宝箱（2.16 节）
    meta.hq.lv = lv; meta.bx.n += box;
    hqUp = { lv: lv, box: (hqUp ? hqUp.box : 0) + box, q: hqRunDone.slice(-3) };
    up = { lv: lv, box: box };
  }
  hqFlash = { i: i, s: H_QUEST[q.id].s, c: c, at: nowMs() };
  if (up) hqPop = { text: H_QUEST[q.id].txt(q.n), c: c, up: up, t: 0 };   // 升级才弹大卡
  qs[i] = hqNew(qs.map(function (x) { return x.id; }));
  S.upgrade(); vibrate(up ? 2 : 1);
  saveMeta();
}
// 斩死一只挡路的（killEnemy / 回头连斩扫到的）：种类、怎么斩的
function hqKill(e, src) {
  if (!hqLive()) return;
  hqAdd('foe');
  if (hPropOn('ghost')) hqAdd('ghostKill');         // 鬼火的剑气斩的也算
  if (src || hBurst) return;                       // 下面这些只算刀砍的
  if (e.bomb) hqAdd('bomb');
  if (e.charger) hqAdd('charger');
  if (e.charger && e.mode === 'wind') hqAdd('charge');
  if (e.heavy) hqAdd('heavyKill');                 // 砍开壳以后又补了一刀
  if (hSurge === 2) hqAdd('surge');
  if (hGap() < hBottomGap()) hqAdd('nearHorde');   // 黑潮露在屏幕里
  // 顺着队形连着斩：路上的（不算两步中间那只）一只接一只；斩了路边的就断
  if (e.pth && !e.pmid) { hqRun.chainCur = (hqRun.chainCur || 0) + 1; hqMax('chain', hqRun.chainCur); }
  else if (!e.pth) hqRun.chainCur = 0;
}
// 往上逃了几米（每多一米调一次）
function hqMeters(m) {
  if (!hqLive()) return;
  hqSet('dist', m);
  hqCheck('nohit');
  const d = m - (hqRun.m0 === undefined ? (hqRun.m0 = m - 1) : hqRun.m0);
  if (d > 0) { hqRun.m0 = m; hqAdd('far', d); }
}
// 掉了一条命：一条命不掉的从这儿重新算
function hqLoseLife() { hqHit = true; hqRun.hitM = hqRun.dist || 0; hqRun.chainCur = 0; }
function hqText(q) { return H_QUEST[q.id].txt(q.n); }
function hqDone() { return meta.hq.k || 0; }       // 离下一级做完了几个

// 做完一个弹的卡（贴图）：在道具卡下面一点，两张不叠
function drawQuestPop() {
  if (!hqPop || state !== 'play') return;
  const t = hqPop.t, up = hqPop.up, w = Math.min(W_CSS - 40, 300), h = up ? 72 : 52, y = hTutCardY() + (hPropPop ? 84 : 0);
  ctx.save();
  ctx.globalAlpha = clamp((HQ.popT - t) / 0.5, 0, 1) * clamp(t / 0.12, 0, 1);
  ctx.translate(W_CSS / 2, y);
  const s = 0.9 + 0.1 * easeOut(t / 0.15);
  ctx.scale(s, s);
  hText('hqPop', hqPop.text + (up ? '|' + up.lv : ''), -w / 2, -h / 2, w, h, function () {
    bladeBox(1, 1, w - 2, h - 2, { c: 10, top: 'rgba(30,26,12,0.92)', bot: 'rgba(14,12,6,0.92)', border: rgba(UI.gold, 0.7), lw: 1.4, ticks: UI.gold });
    ctx.textAlign = 'left';
    uf(900, 13);
    ctx.fillStyle = UI.gold;
    ctx.fillText('任务完成', 16, 21);
    uf(600, 12);
    ctx.fillStyle = 'rgba(255,240,210,0.9)';
    ctx.fillText(hqPop.text, 16, 40);
    ctx.textAlign = 'right';
    uf(900, 15);
    ctx.fillStyle = '#ffd0ea';
    ctx.fillText('+' + hqPop.c, w - 34, 32);
    candyIcon(w - 20, 27, 0.8);
    if (up) {                                   // 这一个凑够了：当场升级、送宝箱
      ctx.textAlign = 'left';
      uf(900, 14);
      ctx.fillStyle = UI.gold;
      ctx.fillText('升级！体育生 Lv.' + up.lv + ' · 宝箱 +' + up.box, 16, 62);
    }
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}
// 局里也看得到任务（用户："玩家现在局内看不到任务，你要找个地方在玩游戏的时候也能看到任务，没人会暂停看任务的"）：
// 左上角暂停键、帧数下面一个半透明小框，三行"短名字 这局 / 累计到多少 / 要多少"，做完的金色打勾。
// 一张贴图一笔；进度一变才重画，而且最多 0.4 秒重画一次（斩怪、米数一直在涨，每帧重画字太贵）。新手教程里不画（那时也不算）
function hqHudVal(q) { return Math.min(q.n, hqCur(q)); }
// 用户："能不能把连斩的数据和做任务放在左下方，现在那个位置耽误我看前面的怪物"：任务框挪到左下角，左斩键正上方；
// 连斩数（hComboAt）再往上叠一块。前面（屏幕上半截）只留分数、命、米数
const HQ_BOX = { w: 172, lh: 18 };
function hQuestBox() {
  const h = 10 + HQ_BOX.lh * 3, bottom = DASH_BTN.y - DASH_BTN.r - 18;   // 左斩键顶上再空一点（道具键挪到右边「连斩」上面了）
  return { x: 12, y: bottom - h, w: HQ_BOX.w, h: h };
}
// 黑潮的连斩数：任务框上面，缩小 HUD_COMBO_K 倍（左下角地方小）
const HUD_COMBO_K = 0.72;
function hComboAt() { const b = hQuestBox(); return { x: b.x + b.w / 2, y: b.y - 14 - 46 * HUD_COMBO_K, k: HUD_COMBO_K }; }
function drawQuestHud() {
  if (!hordeMode || state !== 'play' || hTutOn() || hIntro) return;
  const B = hQuestBox(), x = B.x, y = B.y, w = B.w, lh = HQ_BOX.lh, h = B.h;
  // 刚补上的新任务：挂一个金色"新"字 2.5 秒
  const fresh = function (q) { return gameTime - (q.t0 === undefined ? -99 : q.t0) < 2.5; };
  const fl = hqFlash && nowMs() - hqFlash.at < 1500 ? hqFlash : null;      // 刚做完的那一格先闪 1.5 秒"✓ +糖"，再露出新的
  const qs = meta.hq.q, key = (fl ? 'F' + fl.i + fl.s : '') + qs.map(function (q) { return q.id + (fresh(q) ? '*' : '') + hqHudVal(q); }).join('|');
  hText('hqHud', key, x, y, w, h, function () {
    ctx.fillStyle = 'rgba(6,10,14,0.42)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i], Q = H_QUEST[q.id], ry = 5 + lh * i + 13, nw = fresh(q);
      if (fl && fl.i === i) {
        ctx.fillStyle = 'rgba(255,209,102,0.18)';
        ctx.fillRect(2, ry - 12, w - 4, lh - 1);
        ctx.textAlign = 'left';
        uf(900, 12);
        ctx.fillStyle = UI.gold;
        ctx.fillText('✓ ' + fl.s, 6, ry);
        ctx.textAlign = 'right';
        ctx.fillText('+' + fl.c + ' 糖', w - 5, ry);
        continue;
      }
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = nw ? UI.gold : 'rgba(214,236,242,0.45)';
      ctx.strokeRect(5, ry - 9, 10, 10);
      ctx.textAlign = 'left';
      uf(700, 12);
      ctx.fillStyle = nw ? UI.gold : 'rgba(234,246,248,0.85)';
      ctx.fillText(Q.s, 19, ry);
      if (nw) { uf(900, 10); ctx.fillStyle = UI.gold; ctx.fillText('新', 19 + textW(Q.s) + 4, ry); }
      ctx.textAlign = 'right';
      uf(800, 12);
      ctx.fillStyle = nw ? UI.gold : '#ffffff';
      ctx.fillText(hqHudVal(q) + '/' + q.n + Q.u, w - 5, ry);
    }
  }, 400);
}
// 三个任务的卡（主界面 / 暂停 / 失败页）：上面一行"嘉豪 Lv.N · 嘉欣糖 +x%"，下面三行打勾 + 进度。返回卡多高。
// done：刚做完、已经换掉的那一批（失败页报升级用）
function drawQuestCard(x, y, w, rowH, done) {
  const qs = done || meta.hq.q, h = 30 + rowH * 3 + 6;
  bladeBox(x, y, w, h, { c: 10, top: UI.panelTop, bot: UI.panelBot, border: done ? rgba(UI.gold, 0.6) : UI.line, ticks: done ? UI.gold : null });
  ctx.textAlign = 'left';
  uf(900, 13);
  ctx.fillStyle = UI.gold;
  const lv = done ? hqUp.lv : meta.hq.lv;
  ctx.fillText(done ? '升级！体育生 Lv.' + lv : '体育生 Lv.' + lv, x + 14, y + 20);
  ctx.textAlign = 'right';
  uf(600, 11);
  ctx.fillStyle = 'rgba(255,208,234,0.75)';
  const k = Math.round((hqCandyK() - 1) * 100);
  ctx.fillText(done ? '送 ' + hqUp.box + ' 个宝箱' : (k ? '每局嘉欣糖 +' + k + '%　·　' : '') + '再做 ' + (HQ.per - hqDone()) + ' 个升级送宝箱', x + w - 14, y + 20);
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i], ok = !!done, ry = y + 30 + rowH * i + rowH * 0.5;
    // 勾：做完了金色方块打勾，没做完一个空框
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ok ? UI.gold : 'rgba(214,236,242,0.4)';
    ctx.strokeRect(x + 14, ry - 6, 12, 12);
    if (ok) {
      ctx.beginPath(); ctx.moveTo(x + 16.5, ry); ctx.lineTo(x + 19.5, ry + 3.5); ctx.lineTo(x + 24, ry - 3.5);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    uf(ok ? 700 : 600, 12);
    ctx.fillStyle = ok ? 'rgba(255,209,102,0.85)' : 'rgba(234,246,248,0.82)';
    ctx.fillText(hqText(q), x + 34, ry + 4);
    if (!ok && !done) {
      ctx.textAlign = 'right';
      uf(700, 11);
      ctx.fillStyle = 'rgba(214,236,242,0.5)';
      ctx.fillText((H_QUEST[q.id].run ? '最好 ' : '') + q.d + ' / ' + q.n, x + w - 14, ry + 4);
    }
  }
  return h;
}

/* =========================================================
   2.16 宝箱 · 皮肤碎片 · 仓库道具（黑潮玩法）
   ---------------------------------------------------------
   用户："升级抽宝箱如何，取消皮肤看广告，改成皮肤抽箱子碎片？然后箱子还能得到道具？这种场外道具可以加个场内使用按钮，
   类似滑雪大冒险和地铁跑酷，然后看广告可以获得十连抽"；"糖可以买箱子，不可以买皮肤了"。规则表是我出的（用户没改，先这样）：
   · 宝箱从哪来：嘉豪升一级给 1 个，每 5 级给 10 个（2.15 节 hqComplete）；150 颗糖买 1 个（先攒着，不当场开）；看广告十连（当场开），每天 BOX.adPerDay 次
   · 一次开出（后来用户说道具太多、碎片太好拿，没有看广告的动力，分成两张表，见 BOX）：普通宝箱多半是糖、碎片少；广告十连碎片多
   · 保底：广告十连至少 BOX.adMinShard 次碎片；连开 BOX.pity 个没出整套皮肤，下一个必出
   · 碎片只出还没有的皮肤（便宜的出得多一点：按要几片的倒数挑），集齐就有了（雨中 20 / 打碟 30 / 显眼包 50 / 复仇 70 / 本豪 120 片）；皮肤都有了，碎片、整套换成糖
   · 仓库道具：在商店「宝箱」页挑一种带上场；局里「连斩」对面（左斩上面）一个按钮，点了马上生效，每局最多 BOX.useMax 次
   · 皮肤不能再用糖买、看广告解锁；以前看过的皮肤广告按比例折成碎片（bxMigrate）
   · 概率写在宝箱页「概率」里（公示）
   ========================================================= */
// 平衡（用户："道具在箱子里出现的频率太高，而且皮肤碎片也太容易得到了，根本没有看广告的动力，平衡一下"）：
// 分两种开法 —— 普通宝箱（升级送的、糖买的）多半是糖，碎片少（9%、一次 1 片）；看广告十连碎片多（35%、一次 1~2 片，一次十连至少 2 次碎片）。
// 道具 35% → 15%；集齐要的碎片翻倍。算下来：靠广告十连，雨中嘉豪大约 4 次广告、嘉豪本豪大约 24 次（以前直接看广告是 3 / 15 次）
const BOX = {
  price: 150, adPulls: 10, adPerDay: 3,
  odds: [['shard', 9], ['prop', 15], ['candy', 75], ['skin', 1]],      // 普通宝箱
  adOdds: [['shard', 35], ['prop', 15], ['candy', 48], ['skin', 2]],   // 看广告十连
  shardN: [1, 1], adShardN: [1, 2], candyN: [20, 60],
  pity: 50, adMinShard: 2,
  need: { rain: 20, dj: 30, flashy: 50, revenge: 70, king: 120 },
  shardCandy: 20, skinCandy: 500,
  useMax: 2
};
function bxNeed(id) { return BOX.need[id] || 99; }
function bxUnowned() { return HERO_SKINS.filter(function (sk) { return sk.price && !heroOwned(sk); }); }
// 碎片给谁：还没有的皮肤里挑，要的片数越少越容易出（权重 1 / 要几片）
function bxShardSkin() {
  const L = bxUnowned();
  if (!L.length) return null;
  let tot = 0;
  for (let i = 0; i < L.length; i++) tot += 1 / bxNeed(L[i].id);
  let r = Math.random() * tot;
  for (let i = 0; i < L.length; i++) { r -= 1 / bxNeed(L[i].id); if (r <= 0) return L[i]; }
  return L[L.length - 1];
}
function bxGiveSkin(sk) { meta.hs.own[sk.id] = 1; delete meta.bx.sh[sk.id]; heroSnap(); }
// 开一个：返回 { k: 'shard' | 'prop' | 'candy' | 'skin', ... }，已经记进存档（没 saveMeta，调的人存）。ad：看广告十连那张表
function bxPull(forceShard, ad) {
  let k = 'candy';
  const odds = ad ? BOX.adOdds : BOX.odds, sn = ad ? BOX.adShardN : BOX.shardN;
  meta.bx.pity++;
  if (meta.bx.pity >= BOX.pity) k = 'skin';
  else if (forceShard) k = 'shard';
  else {
    let r = Math.random() * 100;
    for (let i = 0; i < odds.length; i++) { r -= odds[i][1]; if (r < 0) { k = odds[i][0]; break; } }
  }
  if (k === 'skin') {
    meta.bx.pity = 0;
    const L = bxUnowned();
    if (!L.length) { meta.candy += BOX.skinCandy; return { k: 'candy', n: BOX.skinCandy, was: 'skin' }; }
    const sk = L[Math.floor(Math.random() * L.length)];
    bxGiveSkin(sk);
    return { k: 'skin', id: sk.id };
  }
  if (k === 'shard') {
    const n = sn[0] + Math.floor(Math.random() * (sn[1] - sn[0] + 1)), sk = bxShardSkin();
    if (!sk) { meta.candy += n * BOX.shardCandy; return { k: 'candy', n: n * BOX.shardCandy, was: 'shard' }; }
    meta.bx.sh[sk.id] = (meta.bx.sh[sk.id] || 0) + n;
    const got = meta.bx.sh[sk.id] >= bxNeed(sk.id);
    if (got) bxGiveSkin(sk);
    return { k: 'shard', id: sk.id, n: n, have: got ? bxNeed(sk.id) : meta.bx.sh[sk.id], done: got };
  }
  if (k === 'prop') {
    const p = PROP_KINDS[Math.floor(Math.random() * PROP_KINDS.length)];
    meta.bx.inv[p] = (meta.bx.inv[p] || 0) + 1;
    return { k: 'prop', p: p };
  }
  const n = BOX.candyN[0] + Math.floor(Math.random() * (BOX.candyN[1] - BOX.candyN[0] + 1));
  meta.candy += n;
  return { k: 'candy', n: n };
}
// 一次开 n 个。ad：看广告十连（用广告那张表，至少 BOX.adMinShard 次碎片 —— 还差几次就把最后几个换成碎片）；
// 普通宝箱一次开 10 个以上至少 1 次碎片。都只在还有没集齐的皮肤时才保底
function bxOpenN(n, ad) {
  const out = [], min = ad ? BOX.adMinShard : n >= 10 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const got = out.filter(function (r) { return r.k === 'shard' || r.k === 'skin'; }).length;
    const force = got < min && n - i <= min - got && bxUnowned().length > 0;
    out.push(bxPull(force, ad));
  }
  saveMeta();
  return out;
}
// 今天还能看几次广告十连
function bxToday() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function bxAdLeft() { return meta.bx.ad.d === bxToday() ? Math.max(0, BOX.adPerDay - meta.bx.ad.n) : BOX.adPerDay; }

let bxRes = null;          // 刚开出来的：{ list, at 什么时候开的, from 关了回哪 }（开箱页）
function bxShow(list, from) { bxRes = { list: list, at: nowMs(), from: from || state }; state = 'box'; resetInput(); S.upgrade(); vibrate(1); }
// 开自己攒的宝箱（升级送的）
function bxOpenOwn(n) {
  n = Math.min(n, meta.bx.n);
  if (n <= 0) return false;
  meta.bx.n -= n;
  bxShow(bxOpenN(n), state);
  return true;
}
// 糖买一个：先攒着，不当场开（用户："不要买了默认开，买了可以攒起来"），想开再点「开一个 / 全部打开」
function bxBuy() {
  if (meta.candy < BOX.price) return '还差 ' + (BOX.price - meta.candy) + ' 颗嘉欣糖';
  meta.candy -= BOX.price;
  meta.bx.n++;
  saveMeta();
  S.upgrade();
  return '买了 1 个宝箱，现在有 ' + meta.bx.n + ' 个';
}
// 看广告十连
let bxAdFrom = 'shop';
function bxAd() {
  if (bxAdLeft() <= 0) return '今天的广告十连用完了，明天再来';
  bxAdFrom = state;
  startAd('box');
  return '';
}
function bxAdDone() {
  if (meta.bx.ad.d !== bxToday()) meta.bx.ad = { d: bxToday(), n: 0 };
  meta.bx.ad.n++;
  bxShow(bxOpenN(BOX.adPulls, true), bxAdFrom);
}
// 以前看过的皮肤广告折成碎片（看过 a 次、原来要 A 次：给 ⌈a / A × 要几片⌉ 片），只折一次
function bxMigrate() {
  if (meta.bx.mig) return;
  meta.bx.mig = 1;
  for (let i = 0; i < HERO_SKINS.length; i++) {
    const sk = HERO_SKINS[i], a = meta.hs.ads[sk.id] || 0;
    if (!a || !sk.ads || heroOwned(sk)) continue;
    meta.bx.sh[sk.id] = Math.max(meta.bx.sh[sk.id] || 0, Math.ceil(a / sk.ads * bxNeed(sk.id)));
    if (meta.bx.sh[sk.id] >= bxNeed(sk.id)) bxGiveSkin(sk);
  }
  saveMeta();
}
bxMigrate();

/* ---------- 仓库道具：局里「连斩」对面的按钮 ---------- */
let bxUsed = 0;            // 这一局用了几个仓库道具
// 带上场的是哪种：挑的那种还有就用它，没有就用剩得最多的那种；都没有 null
function bxCarry() {
  const inv = meta.bx.inv, c = meta.bx.carry;
  if (c && inv[c] > 0) return c;
  let best = null;
  for (let i = 0; i < PROP_KINDS.length; i++) if (inv[PROP_KINDS[i]] > 0 && (!best || inv[PROP_KINDS[i]] > inv[best])) best = PROP_KINDS[i];
  return best;
}
// 用户："道具放在连斩的上面，而且整局都在"：右边「连斩」键正上方，整局都画（没带 / 用完了灰着，点了不误斩）
function hPropBtn() { const b = hBurstBtn(); return { x: b.x, y: b.y - b.r - 14 - 32, r: 32 }; }
// 这会儿能不能点：带了、这局还没用满、没有道具正在生效、不在连斩 / 开场 / 教程里
function bxCanUse() { return hordeMode && state === 'play' && !!bxCarry() && bxUsed < BOX.useMax && !hProp && !hBurst && !hIntro && !hTutOn(); }
function bxUse() {
  if (!bxCanUse()) return false;
  const k = bxCarry();
  meta.bx.inv[k]--;
  bxUsed++;
  saveMeta();
  hUseProp(k, P.x, P.y);
  return true;
}
function drawPropBtn() {
  if (!(isTouch && hordeMode && state === 'play') || hTutOn()) return;
  const k = bxCarry(), b = hPropBtn(), on = bxCanUse(), S = (b.r + 10) * 2, n = k ? meta.bx.inv[k] : 0, left = BOX.useMax - bxUsed;
  hText('hdPropBtn', (k || '-') + n + '|' + bxUsed + '|' + on, b.x - S / 2, b.y - S / 2 - 16, S, S + 16, function () {
    const c = S / 2, cy = c + 16, sk = k ? skinOf(k) : null;
    ctx.beginPath();
    ctx.arc(c, cy, b.r, 0, Math.PI * 2);
    ctx.fillStyle = on ? 'rgba(20,30,36,0.85)' : 'rgba(14,18,22,0.6)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = on ? sk.c : 'rgba(214,236,242,0.25)';
    ctx.stroke();
    ctx.textAlign = 'center';
    if (k) {
      ctx.globalAlpha = on ? 1 : 0.4;
      drawPropIcon(k, sk, c, cy - 1, 0.4);
      ctx.globalAlpha = 1;
      uf(900, 11);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('×' + n, c + b.r * 0.55, cy + b.r * 0.8);
    } else {
      uf(800, 12);
      ctx.fillStyle = 'rgba(214,236,242,0.45)';
      ctx.fillText('道具', c, cy + 4);
    }
    // 上面一行：还能用几个 / 为什么灰着
    uf(700, 10);
    ctx.fillStyle = on ? 'rgba(214,236,242,0.7)' : 'rgba(214,236,242,0.4)';
    ctx.fillText(!k ? '仓库空了' : left <= 0 ? '这局用完了' : '还能用 ' + left, c, 11);
  });
}

// 开箱页：开出来的一个个弹出来（一个 0.08 秒），十连排两行五列
function boxLayout() {
  const w = Math.min(360, W_CSS - 24), x = (W_CSS - w) / 2, n = bxRes ? bxRes.list.length : 0, cols = n > 1 ? 5 : 1;
  const cw = n > 1 ? (w - 4 * 8) / 5 : 150, ch = n > 1 ? 96 : 150, rows = Math.ceil(n / cols);
  const y0 = Math.max(SAFE_TOP + 90, H_CSS * 0.3 - (rows > 1 ? 60 : 0)), cells = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols, cx = n > 1 ? x + c * (cw + 8) : W_CSS / 2 - cw / 2;
    cells.push({ x: cx, y: y0 + r * (ch + 10), w: cw, h: ch });
  }
  const by = y0 + rows * (ch + 10) + 30;
  return { x: x, w: w, y0: y0, cells: cells, again: { x: x + 20, y: by, w: w - 40, h: 50 }, back: { x: x + 20, y: by + (meta.bx.n > 0 ? 62 : 0), w: w - 40, h: 46 } };
}
function bxResText(r) {
  if (r.k === 'skin') return [HERO_SKIN[r.id].name, '整套皮肤！'];
  if (r.k === 'shard') return [HERO_SKIN[r.id].name, '碎片 +' + r.n + '（' + r.have + '/' + bxNeed(r.id) + '）'];
  if (r.k === 'prop') return [PROP_NAME[r.p], '+1 进仓库'];
  return ['嘉欣糖', '+' + r.n + (r.was ? '（' + (r.was === 'skin' ? '皮肤' : '碎片') + '都有了）' : '')];
}
function drawBox() {
  inkBg(1);
  if (!bxRes) return;
  const L = boxLayout(), t = (nowMs() - bxRes.at) / 1000, cx = W_CSS / 2;
  ctx.textAlign = 'center';
  uf(900, 24);
  outlineText(bxRes.list.length > 1 ? '开了 ' + bxRes.list.length + ' 个宝箱' : '开宝箱', cx, L.y0 - 34, UI.gold, 4);
  for (let i = 0; i < L.cells.length; i++) {
    const k = clamp((t - i * 0.08) / 0.18, 0, 1);
    if (k <= 0) continue;
    const c = L.cells[i], r = bxRes.list[i], big = r.k === 'skin' || (r.k === 'shard' && r.done);
    const col = r.k === 'skin' || r.k === 'shard' ? (HERO_SKIN[r.id].light || UI.gold) : r.k === 'prop' ? skinOf(r.p).c : CANDY_C;
    const y = c.y + (1 - easeOut(k)) * 14, mx = c.x + c.w / 2, sc = c.h / 96, iy = y + c.h * 0.38;
    ctx.globalAlpha = k;
    bladeBox(c.x, y, c.w, c.h, { c: 8, top: big ? '#2a2410' : '#121c22', bot: big ? '#16120a' : '#0a1014', border: rgba(big ? UI.gold : col, big ? 0.9 : 0.5), ticks: big ? UI.gold : null });
    if (r.k === 'prop') drawPropIcon(r.p, skinOf(r.p), mx, iy, 0.4 * sc);
    else if (r.k === 'candy') candyIcon(mx, iy, 1.3 * sc);
    else {
      ctx.save();
      ctx.beginPath(); ctx.rect(c.x + 2, y + 2, c.w - 4, c.h * 0.62); ctx.clip();
      drawHeroPreview(HERO_SKIN[r.id], mx - 4 * sc, iy + 6 * sc, 0.8 * sc);
      ctx.restore();
      if (r.k === 'shard') gem(mx + c.w * 0.3, y + 12 * sc, 5 * sc, col);
    }
    const tx = bxResText(r);
    ctx.textAlign = 'center';
    uf(900, Math.round(11 * Math.max(1, sc * 0.9)));
    ctx.fillStyle = col;
    ctx.fillText(tx[0], mx, y + c.h - 26 * sc);
    uf(700, Math.round(10 * Math.max(1, sc * 0.9)));
    ctx.fillStyle = big ? UI.gold : 'rgba(234,246,248,0.8)';
    ctx.fillText(r.k === 'shard' && r.done ? '集齐了！' : tx[1], mx, y + c.h - 11 * sc);
  }
  ctx.globalAlpha = 1;
  if (t > L.cells.length * 0.08 + 0.2) {
    if (meta.bx.n > 0) drawButton(L.again, '再开一个（还有 ' + meta.bx.n + ' 个）', { kind: 'gold', size: 16, weight: 900 });
    drawButton(L.back, '收下', { kind: meta.bx.n > 0 ? 'plain' : 'primary', size: 16, weight: 900 });
  }
  ctx.textAlign = 'left';
}
function boxTap(t) {
  if (!bxRes || (nowMs() - bxRes.at) / 1000 < bxRes.list.length * 0.08 + 0.2) return;
  const L = boxLayout();
  if (meta.bx.n > 0 && inRect(t, L.again)) { const from = bxRes.from; meta.bx.n--; bxRes = { list: bxOpenN(1), at: nowMs(), from: from }; S.upgrade(); return; }
  if (inRect(t, L.back)) { state = bxRes.from === 'box' ? 'shop' : bxRes.from; bxRes = null; resetInput(); }
}

// 美工的图（见故事模式策划卷）：文件放进 art/，路径写进这里才会去加载；没写的一律画剪影，不去碰不存在的文件
const ART_FILES = {};          // 例：'portrait/jiahao_cool': 1
const ART = {};
function artImg(key) {
  if (!key || !ART_FILES[key]) return null;
  let a = ART[key];
  if (!a) {
    a = ART[key] = { ok: false, img: null };
    try {
      const img = IS_MG && typeof MG.createImage === 'function' ? MG.createImage() : (typeof Image !== 'undefined' ? new Image() : null);
      if (img) { img.onload = function () { a.ok = true; }; img.src = 'art/' + key + '.png'; a.img = img; }
    } catch (e) {}
  }
  return a.ok ? a.img : null;
}


/* =========================================================
   3. 状态
   ========================================================= */
const P = {
  x: 0, y: 0, px: 0, py: 0,
  vx: 0, vy: 0,
  r: CFG.playerR,
  ang: -Math.PI / 2,
  dx: 0, dy: -1,
  cd: 0, dashT: 0, inv: 0, squash: 0,
  glideT: 0,                      // 收刀余势还剩几秒（见 CFG.glideCut）
  dashLeft: Infinity,             // 这一刀还能冲多远（斩到就停；空挥 = 不限，冲满 dashTime）
  dashRef: null                   // 这一刀锁的那只怪（冲到之前它就死了 = 不算砍空）
};

const DASH_BTN = { x: 0, y: 0, r: 46 };

let state = 'ready';            // ready | play | dead | ad | over | skills | guide
let enemies = [], parts = [], ghosts = [], floats = [], stains = [];
let trail = [];                 // 刀光拖尾：最近 0.13 秒的刀路（只管画，不参与判定）
let turns = [];                 // 连斩急转时的转身刀弧
let score = 0, best = 0, bestCombo = 0;
let combo = 0, comboTimer = 0;
let gameTime = 0, spawnTimer = 0;
// 存活计分：acc 是没凑够 1 分的小数，pend 是这段时间攒了多少（用于报数）
let surviveT = 0, surviveAcc = 0, surviveGain = 0, survivePend = 0;
let shake = 0, hitstop = 0, deadT = 0;
let lastHitT = -1e9;             // 上一次打击（击杀 / 碎柱 / 爆炸）的 gameTime，见 hitPause
let hitSlow = 0;                 // 打击慢放还剩几秒（真实时间），见 hitPause

// —— 复活与结算 ——
// 复活不设次数上限：每次死亡都给一个 5 秒窗口，看完整广告就能回来。
// 代价不靠"次数上限"卡，而靠连击折半 + 无敌时间逐次收紧（见 doRevive），
// 所以反复复活不会变成白送命，但也没必要拦住玩家多看几条广告。
let reviveT = 0;                // 死亡后的复活窗口倒计时
let canRevive = false;          // 这一次死亡有没有复活入口（现在恒为真）
let reviveCount = 0;            // 本局已复活次数：只用于递减无敌与文案
let adT = 0, adAction = null;   // 假广告占位：真机换成激励视频回调
let overT = 0;
let runEcho = 0;                // 本局结算得到的余光
let echoDoubled = false;        // 本局是否已经领过双倍
let rings = [];                 // 击杀时的刀环：局部反馈，不再整屏闪
let cuts = [];                  // 斩击刀痕：每砍死一只，顺着刀的方向在它身上留一道一闪即逝的斩线
let embers = [], emberAcc = 0;  // 主角燃烧：上了段位身上往外冒的火星
let tickT = 0;                  // 连斩快断的滴答：离下一声还有几秒

let view = CFG.viewBase;

// 亮区 = 斩杀圈：看得清的就是砍得到的，圈外全黑、只露怪物的核（延锋把圈撑大，光也跟着大）。
// view 不再决定"看得清多远"，退成感知半径：黑暗里能看见多远的核、怪刷在多远、守望者何时扑上来
// 斩杀圈半径：技能（延锋）× 本层特性（核心的光核撑大、无光缩小）。玩法和绘制都读这个
function reachMul() {
  return (layerFeat() === 'void' ? CFG.lf.voidReach : 1) * (1 + CFG.lf.coreReach * coreK);
}
function reach() { return POW.autoReach * reachMul(); }
// 黑潮试玩：不要黑暗 —— 黑潮多近、前面有什么都得看得见（2.12 节）
function lightR() { return hordeMode ? 2400 : (CFG.darkness ? reach() : view); }

// —— 每层特性的状态（见 LAYERS[].feat、CFG.lf）——
let inFog = null;               // 低语：主角站着的那团雾（不在雾里 = null）
let coreK = 0;                  // 核心：在光核里攒的补光 0~1，出来慢慢退
let coreNow = null;             // 核心：主角站着的那颗光核
let tideA = 0, tideT = 0;       // 黑潮：潮流方向、离下次换向还有几秒
// 离主角 d 处被照亮了多少（0~1）：圈的 0.8 倍以内全亮，出圈 0.2 倍全黑，圈线落在过渡正中
function litAt(d) {
  const L = lightR();
  return clamp((L * 1.2 - d) / (L * 0.4), 0, 1);
}
let danger = 0;

// —— 三类"读一眼再决定"的场上一员 ——
let blasts = [];                // 爆裂者死后留下的引信
let shards = [];                // 晶柱碎片的飞行体
let armorBits = [];             // 重型甲环碎掉时飞出去的甲片
let crystals = [];              // 晶柱（会从光外重新长出来，是唯一的余光来源）
let crystalTimer = 0;           // 下一根晶柱什么时候长出来
let yingRun = 0;                // 本局已取到的余光
let crystalsBroken = 0;         // 本局斩碎了几根（结算页显示）
let viewDrain = 0;              // 守望者吸走的视野比例（0~0.35）
let viewBoost = 0;              // 光尘：临时视野加成剩余秒数
let calmT = 0;                  // 空场呼吸剩余秒数（见 CFG.calmT）

// —— 技能的局内状态 ——
let shield = 0;                 // 光盾：现在挂着几面（0 / 1）
let shieldT = 0;                // 碎了之后还要多久再生
let shieldFx = 0;               // 碎掉 / 长回来那一下的闪光（0~1）
let qiCharge = 0;               // 剑气：这一串连斩攒了几刀
let qiShown = 0;                // 本局已经报过几次"剑气"的名字（前三次报，之后只放不报）
let keptIdle = false;           // 续势刚保留过一次、还没砍到新的 —— 往下掉时不再重复报名字
let burstQ = [];                // 待放的剑气 / 光盾震波：在 update 末尾统一放，不在别的循环里改敌人数组

/* —— 相机 ——
   世界不再是"一屏打完"：玩家可以一直跑，镜头追着他走。
   cam 是镜头中心的世界坐标。跟随分三层：
   死区（人在屏幕中央一小块里动，镜头不动）→
   前瞻（朝移动方向先偏一点，像人在"看路"）→
   缓动（追的速度略慢于人，冲刺时被甩开一点再追上）。
   偏移总量封顶 maxOff，玩家永远不会跑出画面。 */
let cam = { x: 0, y: 0 };
// 镜头跨界时跳过的累计位移。cam + camLap = "展开"后的镜头位置，跨界也是连续的 ——
// 视差层（浮尘）得用它，否则一跨界整层浮尘就跳到别处
let camLap = { x: 0, y: 0 };
const CAM = {
  zoneX: 0.13,     // 死区半宽（占视口宽）
  zoneY: 0.10,     // 死区半高
  maxOff: 0.20,    // 镜头偏离玩家上限（占视口，各轴）
  look: 95,        // 前瞻最远距离（世界单位）
  smooth: 5.2      // 追踪速率：越大跟得越紧
};

function updateCamera(dt) {
  // 死区：以镜头为中心的矩形。玩家在里面随便动，镜头一步不动；
  // 出界后追踪点被拉回矩形边缘 —— 从这里开始镜头才追。
  const hw = W * CAM.zoneX, hh = H * CAM.zoneY;
  let fx = clamp(P.x, cam.x - hw, cam.x + hw);
  let fy = clamp(P.y, cam.y - hh, cam.y + hh);

  // 前瞻：叠在追踪点上，朝速度方向先看一段路。
  // 速度越快看得越远，封顶 look。冲刺（1750）时正好顶满。
  const sp = Math.hypot(P.vx, P.vy);
  const la = Math.min(CAM.look, sp * 0.085);
  if (sp > 1) { fx += P.vx / sp * la; fy += P.vy / sp * la; }

  // 缓动：指数逼近，帧率无关
  const t = 1 - Math.exp(-CAM.smooth * dt);
  cam.x += (fx - cam.x) * t;
  cam.y += (fy - cam.y) * t;

  // 封顶：镜头永远把玩家留在画面里
  const mox = W * CAM.maxOff, moy = H * CAM.maxOff;
  cam.x = P.x + clamp(cam.x - P.x, -mox, mox);
  cam.y = P.y + clamp(cam.y - P.y, -moy, moy);
}
let reachGlow = 0;              // 斩杀线在"够得着"时的加亮量（0~1，缓动）
let heartTimer = 0;
let whisperTimer = 12;

/* —— 环形世界 ——
   世界是一块 4500×4500 的封闭环面：跑出右边从左边绕回来，上下同理。
   4500 = 残骸瓦片 900 的整 5 倍，所以绕一整圈回来时，废墟长得一模一样 ——
   "同一块场地"在逻辑上成立。所有坐标都存在 [0, WORLD) 区间内，
   任何"两点距离"都必须走 wdist（取最短绕行方向），
   任何"画在某处"都必须走 wdx/wdy（取离镜头最近的那个分身）。 */
const WORLD = 4500;
function wwrap(v) { return ((v % WORLD) + WORLD) % WORLD; }
function wdelta(d) { return d - WORLD * Math.round(d / WORLD); }
function wdist(ax, ay, bx, by) {
  const dx = wdelta(ax - bx), dy = wdelta(ay - by);
  return Math.sqrt(dx * dx + dy * dy);
}
function wdx(x) { return cam.x + wdelta(x - cam.x); }
function wdy(y) { return cam.y + wdelta(y - cam.y); }

// —— 深度层 / 每局契约 ——
let layer = 1;                  // 当前第几层（跟着糖走到门、破门 +1）
// 死得明白（用户：连斩时"斩完被甩进怪堆、根本反应不过来"）：
// 死的那一下把凶手圈红、标出它从哪边来；测试数据记收刀后多久被撞、它在亮处待了多久 —— 量"冤死"有多少
let lastDashEnd = -1e9;         // 上一刀收刀的局内时刻
let deathMark = null;           // 凶手：{ x, y, r, ux, uy 它冲过来的方向, blast 是爆炸 }
let deathInfo = null;           // 这一下死的细节：[收刀后多少毫秒, 凶手在亮处待了多少毫秒（-1 = 不适用）]
let layerBroke = false;         // 这一层是破门打进来的（进层横幅写"破门"，开局那一层不写）
let layerFxT = 0;               // 进层提示的剩余秒数
let layerBestNew = false;       // 本局是否刷新了历史最深
let scoutLeft = 0;              // 本层前哨还要刷几只（进层讲解用）
let scoutAt = 0;                // 前哨最早在什么时候刷
let scoutType = null;           // 前哨刷哪种怪
let runKills = 0;               // 本局斩杀数（契约判定用）
let contract = null;            // 本局契约
let contractDone = false;
let contractFx = 0;             // 契约达成提示的剩余秒数
let contractReward = 0;         // 本局契约实际拿到的余光（结算页用）
let unlockNew = [];             // 本局新解锁的里程碑（死亡页展示）

let attackHeld = false;
let autoTimer = 0;              // 自动接刀的累计延迟
let waveTimer = 0;              // 距离下次合围
let waveWarnT = 0;              // > 0 表示预警中
let waveDirs = [];              // 这次合围的方向
let isTouch = IS_MG;
let touchId = null, tOrigin = { x: 0, y: 0 }, tMove = { x: 0, y: 0 };
let btnTouchId = null;

best = parseInt(Store.get('dash_best', 0), 10) || 0;


/* =========================================================
   4. 布局
   ========================================================= */
function layout() {
  if (IS_MG) {
    canvas = MG.createCanvas();
    const info = (typeof MG.getWindowInfo === 'function')
      ? MG.getWindowInfo() : MG.getSystemInfoSync();

    DPR = Math.min(info.pixelRatio || 2, 2);
    W_CSS = info.windowWidth;
    H_CSS = info.windowHeight;

    if (info.safeArea) {
      SAFE_TOP = info.safeArea.top || 0;
      SAFE_BOTTOM = Math.max(0, H_CSS - info.safeArea.bottom);
      SAFE_LEFT = Math.max(0, info.safeArea.left || 0);
      SAFE_RIGHT = info.safeArea.right ? Math.max(0, W_CSS - info.safeArea.right) : 0;
    }
    MENU = null;
    try {
      const f = MG.getMenuButtonBoundingClientRect || MG.getMenuButtonLayout;
      const r = typeof f === 'function' ? f.call(MG) : null;
      if (r && r.width > 0 && r.height > 0) {
        const top = r.top || 0, left = r.left !== undefined ? r.left : (r.right - r.width);
        const m = { left: left, right: left + r.width, top: top, bottom: top + r.height };
        if (m.bottom > 0 && m.bottom < H_CSS / 3 && m.left > W_CSS / 2) MENU = m;
      }
    } catch (e) {}
    // 取不到：安全区顶往下 4、高 32、宽 88、离右边 7（抖音 / 微信的胶囊都差不多这么大）
    if (!MENU) MENU = { left: W_CSS - 95, right: W_CSS - 7, top: SAFE_TOP + 4, bottom: SAFE_TOP + 36 };
  } else {
    canvas = document.getElementById('game');
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W_CSS = canvas.clientWidth;
    H_CSS = canvas.clientHeight;
  }

  // 世界缩放：以 1200 逻辑宽度为基准。桌面端 SC = 1，逻辑完全不变。
  // 世界缩放：屏幕短边固定映射成 780 个世界单位。
  // 竖屏 390 宽 → SC 正好 0.5；世界 780 × 1688，比横屏开阔得多。
  SC = Math.max(0.42, Math.min(Math.min(W_CSS, H_CSS) / 780, 1.3));
  W = W_CSS / SC;
  H = H_CSS / SC;

  canvas.width  = Math.round(W_CSS * DPR);
  canvas.height = Math.round(H_CSS * DPR);
  ctx = ctx2d(canvas);
  wrapOps(ctx);

  // 冲刺按钮放在 CSS 坐标里：手指大小不该跟着世界缩放变
  DASH_BTN.r = 46;
  DASH_BTN.x = W_CSS - 74;
  DASH_BTN.y = H_CSS - SAFE_BOTTOM - 74;
}


/* =========================================================
   5. 小工具
   ========================================================= */
function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function inputDir() {
  let x = 0, y = 0;
  if (!IS_MG) {
    if (keys['a'] || keys['arrowleft'])  x -= 1;
    if (keys['d'] || keys['arrowright']) x += 1;
    if (keys['w'] || keys['arrowup'])    y -= 1;
    if (keys['s'] || keys['arrowdown'])  y += 1;
  }
  x += tMove.x; y += tMove.y;
  const len = Math.hypot(x, y);
  if (len < 0.15) return null;
  return { x: x / len, y: y / len };
}

// 玩家正往哪走：推着摇杆就是摇杆方向；没推但还在高速滑行 / 冲刺就是速度方向；站着 = null
function headingDir() {
  const d = inputDir();
  if (d) return d;
  const v = Math.hypot(P.vx, P.vy);
  return v > 120 ? { x: P.vx / v, y: P.vy / v } : null;
}
// (dx, dy) 这个方向在不在 dir 左右 deg 度以内
function inCone(dir, dx, dy, deg) {
  const d = Math.hypot(dx, dy);
  return d > 0 && (dx * dir.x + dy * dir.y) / d >= Math.cos(deg * Math.PI / 180);
}

// (x, y) 在不在一颗正在烧引信、会炸到你的爆裂者的圈里（pad：再往外放多少）。
// 圈里的怪反正要被炸死：自动连斩不去砍它们 —— 斩到就停会把你停在快炸的圈里
function inBlast(x, y, pad) {
  for (let i = 0; i < blasts.length; i++) {
    const b = blasts[i];
    if (!b.safe && wdist(x, y, b.x, b.y) < b.r + pad) return b;
  }
  return null;
}
// 贴身保护：离你只剩 CFG.threatGap 就要撞上的那只（不管摇杆指哪，长按连斩先砍它）。
// 拖着摇杆时只砍那个方向，侧面贴上来的就没人管 —— 实测"边走边斩"的死几乎全是这种
function closeThreat() {
  let b = null, bd = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.heavy && e.cracked && e.armorT > 0) continue;
    const d = wdist(e.x, e.y, P.x, P.y) - e.r - P.r;
    if (d < CFG.threatGap && d < bd) { bd = d; b = e; }
  }
  return b;
}
function nearestEnemy(minDist, except) {
  const skip = minDist || 8;
  let b = null, bd = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e === except) continue;
    const d = wdist(e.x, e.y, P.x, P.y);
    if (d < skip) continue;
    if (d < bd) { bd = d; b = e; }
  }
  return b;
}

// 长按连斩时选目标："一刀够得着"的里面挑。
// dir（推着摇杆的方向）：只看那个方向左右 aimDeg 度以内的，越正、越近越优先；正面没有就返回 null ——
// 不挥刀，人顺着摇杆走，不会被身后更近的怪拽回去。没推摇杆：最近的那只
function lockOn(dir) {
  if (!CFG.autoAim) return null;
  if (dir) {
    let b = null, bs = Infinity, ba = null, bas = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = wdelta(e.x - P.x), dy = wdelta(e.y - P.y), d = Math.hypot(dx, dy);
      if (d < 8 || d > reach() || !inCone(dir, dx, dy, CFG.aimDeg)) continue;
      const sc = d * (2 - (dx * dir.x + dy * dir.y) / d);     // 越正越近越小
      // 甲硬直中的重型砍不动：不锁它（刀会滑开，白白等 0.5 秒）；快炸的圈里的也不锁（反正要被炸死）
      if (e.heavy && e.cracked && e.armorT > 0) continue;
      if (inBlast(e.x, e.y, 0)) continue;
      if (sc < bs) { bs = sc; b = e; }
    }
    return b;
  }
  let e = nearestEnemy();
  if (e && inBlast(e.x, e.y, 0)) {            // 最近的那只在快炸的圈里：换圈外最近的一只
    e = null;
    let bd = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const q = enemies[i], d = wdist(q.x, q.y, P.x, P.y);
      if (d >= 8 && d < bd && !inBlast(q.x, q.y, 0)) { bd = d; e = q; }
    }
  }
  if (!e) return null;
  if (wdist(e.x, e.y, P.x, P.y) > reach()) return null;
  // 甲硬直中的重型刀砍不动，锁它就是白白浪费一整个冲刺真空期 —— 换个目标，没有就不砍
  if (e.heavy && e.cracked && e.armorT > 0) {
    const alt = nearestEnemy(8, e);
    if (alt && wdist(alt.x, alt.y, P.x, P.y) <= reach() &&
        !(alt.heavy && alt.cracked && alt.armorT > 0)) return alt;
    return null;
  }
  return e;
}

// 够得着的晶柱里最近的一根（没长成的不算，扑过去会砍个空）；dir 同 lockOn：只看推的那个方向
function nearestCrystal(dir) {
  let b = null, bd = Infinity;
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    if (c.age < CFG.crystalGrow * 0.6) continue;
    const d = wdist(c.x, c.y, P.x, P.y);
    if (d > reach() || d >= bd) continue;
    if (dir && !inCone(dir, wdelta(c.x - P.x), wdelta(c.y - P.y), CFG.aimDeg)) continue;
    bd = d; b = c;
  }
  return b;
}

// 点到线段的距离：防止高速冲刺时"穿过"敌人不判定
function segDist(x1, y1, x2, y2, cx, cy) {
  const vx = x2 - x1, vy = y2 - y1;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? ((cx - x1) * vx + (cy - y1) * vy) / L2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(x1 + vx * t - cx, y1 + vy * t - cy);
}


/* =========================================================
   6. 声音 —— 全部 Web Audio 现场合成，不需要任何音频文件
   （抖音没有 WebAudio，改放这套合成器离线渲染出来的文件，见本节末尾 SF）
   ========================================================= */

/* —— BGM ——
   152 BPM 的电子推进：四拍底鼓 + 16 分踩镲 + 八分贝斯。
   只有这一首。连斩数每过一道门槛（BGM_AT），这首曲子就"变厚"一层（见 bgmVoice），
   不叠第二条旋律 —— 旋律层一进来就会被听成另一首曲子，
   而且它的重音周期和鼓组对不齐，听感就是"两首歌在抢拍"。
   加的层都踩在贝斯的拍点或反拍上、只用根音的八度 / 五度，最后一档整首升一个全音。
   全部现场合成，不占一个字节包体。曲式是 2 小节 32 个 16 分音符的循环。 */
const BGM_BPM = 152;
const BGM_STEP = 60 / BGM_BPM / 4;      // 一个 16 分音符多少秒
const BGM_BASS = [
  110, 110, 110, 130.81, 110, 110, 164.81, 146.83,     // A A A C | A A E D
  110, 110, 110, 130.81, 87.31, 87.31, 98, 98           // A A A C | F F G G
];
// 音乐档位按连斩数：×100 / ×300 / ×600 / ×1000 / ×1500 各升一档。
// 不跟连斩段位（×5~×100）走：黑潮里连斩几乎不断（掉命也不断），每秒涨 12 左右，开场一刀就 ×25，
// 跟着段位 10 秒就到顶了（用户："太快了…现在玩家很容易就到最高等级的音乐"）。现在机器人约 15 / 32 / 55 / 90 / 130 秒到
const BGM_AT = [100, 300, 600, 1000, 1500];
const BGM_LV = BGM_AT.length + 1;
function bgmLvOf(c) { let lv = 0; while (lv < BGM_AT.length && c >= BGM_AT[lv]) lv++; return lv; }
// 换档的时机：往上在下一拍就换（升段那一下马上听得出来），往下只在小节线（断连别半句掉下去）
function bgmShift(cur, want, step) {
  if (step % 4 !== 0 || want === cur) return cur;
  return (want > cur || step % 16 === 0) ? want : cur;
}
// 每档的贝斯低通 / 和声层音量 / 反拍和弦音量。
// 手机小喇叭放不出 400Hz 以下，底鼓和贝斯的根音在手机上几乎听不见 ——
// 所以"变厚"必须加在 400Hz 以上，每档在这一段要响出 1.5~2.5dB，不然升了档也听不出来
const BGM_LP   = [555, 780, 1095, 1250, 1350, 1450];
const BGM_ARP  = [0, 0.06, 0.065, 0.07, 0.07, 0.075];
const BGM_STAB = [0, 0, 0, 0, 0.12, 0.13];

// 音频体检：主界面右下角版本号上面那行。没声音时一眼看出卡在哪一步
//   mode：合成 / 文件 / 没有音频接口 / …    n、ok：建了几个播放器、几个加载成功
//   plays：真正开始播放的次数              err、msg：出错次数和最后一条错误
const AUD = { mode: '', n: 0, ok: 0, plays: 0, err: 0, msg: '' };

const S = {
  ac: null, master: null, droneGain: null, droneLfo: null, noise: null, ready: false,
  bgmTimer: null, bgmStep: 0, bgmNext: 0, bgmLv: 0, bgmWant: 0, bgmBus: null,
  // 心跳挂在 BGM 的拍子上，不再另走一套时钟
  heartLeft: 8, heartDanger: 0, heartOn: true,
  bgmEpoch: 0,                   // 第 0 个 16 分音符在音频时钟上的位置
  hitAt: -1, cutI: -1,           // 上一次斩中声的音频时间（同一刻只响一刀）/ 轮到第几种刀声（见 CUTS）

  init: function () {
    if (this.ac) {
      try { if (this.ac.state === 'suspended') this.ac.resume(); } catch (e) {}
      return;
    }
    const ac = createAudioContext();
    if (!ac) { AUD.mode = '没有音频接口'; return; }

    try {
      // 能力探测：小游戏的 WebAudioContext 是 WebAudio 的子集，先确认关键接口在
      if (typeof ac.createGain !== 'function' ||
          typeof ac.createOscillator !== 'function' ||
          typeof ac.createBuffer !== 'function') { AUD.mode = '音频接口不全'; return; }

      this.ac = ac;

      this.master = ac.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(ac.destination);

      // 预生成一段噪声，破风 / 斩击 / 踩镲都复用它
      const n = Math.floor(ac.sampleRate * 1.0);
      this.noise = ac.createBuffer(1, n, ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.hitAt = -1; this.cutI = -1;

      // BGM 单独一条总线：以后要加静音/压低，只动这一个节点
      this.bgmBus = ac.createGain();
      this.bgmBus.gain.value = 0.5;
      this.bgmBus.connect(this.master);

      this.startDrone();
      this.ready = true;
      AUD.mode = '合成';
      if (ac.state === 'suspended') ac.resume();
    } catch (e) {
      this.ready = false;
      AUD.mode = '合成失败'; AUD.err++; AUD.msg = String((e && e.message) || e);
    }
  },

  // 低频嗡鸣：两个差 0.8Hz 的锯齿波互相"打架"，产生缓慢脉动
  startDrone: function () {
    const ac = this.ac;
    const g = ac.createGain();
    g.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 190;
    lp.Q.value = 4;

    // 只用严格八度关系的两层，不做任何失谐：
    // 失谐会产生一个和曲子无关的低频脉动（41 与 41.8 差频 0.8Hz = 每 1.25 秒一次），
    // 那个"咚、咚"听起来像另一个速度在打拍子，是"节奏对不上"的主要来源之一。
    const o1 = ac.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41;
    const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82;
    const g2 = ac.createGain(); g2.gain.value = 0.35;
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(this.master);
    o1.start(); o2.start();

    this.droneGain = g;

    const lfo = ac.createOscillator(); lfo.frequency.value = 0.11;
    const lfoGain = ac.createGain(); lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    lfo.start();
    this.droneLfo = lfoGain;   // 离线渲染嗡鸣循环时要把它摘掉（dev/render-audio.js）
  },

  setTension: function (danger) {
    if (!this.ready) return;
    const t = this.ac.currentTime;
    // 不用 setTargetAtTime：部分小游戏基础库没实现，统一改用线性斜坡
    this.droneGain.gain.linearRampToValueAtTime(0.012 + danger * 0.075, t + 0.3);
  },

  /* ---------------- BGM ---------------- */

  bgmStart: function () {
    if (!this.ready || this.bgmTimer) return;
    // 每次都从小节头起：中途续播会落在半拍上，听起来像"卡了一下"
    this.bgmStep = 0;
    this.heartLeft = 8;
    this.bgmLv = this.bgmWant;
    this.bgmNext = this.ac.currentTime + 0.06;
    this.bgmEpoch = this.bgmNext;      // 第 0 拍落在哪，视觉也拿这个当节拍原点
    const self = this;
    // 提前 0.45 秒排拍（约 4.5 个 16 分）：主线程被渲染卡住半秒也不会漏拍。
    // 音乐预排不怕早，只怕晚 —— 晚了就只能丢拍，听感上是一个洞。
    this.bgmTimer = setInterval(function () { self.bgmPump(); }, 30);
  },

  bgmStop: function () {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  },

  bgmOn: function () { return !!(this.ready && this.bgmTimer); },

  // 心跳只在活着的时候跳：死了还"咚咚"地急跳，既出戏又抢音乐的拍子
  heartStart: function () { this.heartOn = true; },
  heartStop: function () { this.heartOn = false; this.heartLeft = 8; },

  // 想要的音乐档位 0 ~ BGM_LV-1（bgmLvOf）。真正换档在拍子上（bgmShift）
  setBgm: function (lv) {
    this.bgmWant = clamp(lv | 0, 0, BGM_LV - 1);
  },

  // 心跳速度：只存危险度，实际"什么时候跳"由 BGM 的拍子决定
  setHeart: function (d) {
    this.heartDanger += (clamp(d, 0, 1) - this.heartDanger) * 0.05;
  },

  bgmPump: function () {
    if (!this.ready || !this.ac) return;
    const now = this.ac.currentTime;
    // 真卡死了才重锚（超过 4 拍没排上），否则保持原相位，绝不跳拍
    if (this.bgmNext < now - 0.40) this.bgmNext = now + 0.05;
    while (this.bgmNext < now + 0.45) {
      const t = this.bgmNext;
      // 已经过期的拍子直接跳过，不补：补会把好几个音挤在同一瞬间，听着就是一串"哒哒哒"
      this.bgmLv = bgmShift(this.bgmLv, this.bgmWant, this.bgmStep);
      if (t > now - 0.005) {
        try { this.bgmVoice(this.bgmStep, t); } catch (e) {}
        this.heartTick(t);
      }
      this.bgmStep = (this.bgmStep + 1) % 32;
      this.bgmNext += BGM_STEP;
    }
  },

  // 心跳：12/8/4 个 16 分音符 = 51/76/152 BPM（152 的整数分频，全是整拍），
  // 永远落在正拍上，不会和鼓点错位。危险越高跳得越急，最急时和底鼓重合。
  heartTick: function (t) {
    if (!this.heartOn) return;
    this.heartLeft--;
    if (this.heartLeft > 0) return;
    const d = this.heartDanger;
    const every = d > 0.66 ? 4 : (d > 0.34 ? 8 : 12);
    this.heartLeft = every;
    this.thump(0.1 + d * 0.22, t);
  },

  bgmVoice: function (step, t) {
    const ac = this.ac, bus = this.bgmBus;
    if (!bus) return;
    const lv = this.bgmLv;
    const key = lv >= 5 ? 1.1225 : 1;   // 最后一档（×1500）整首升一个全音：情绪往上顶的那一下

    // 底鼓：每拍一下
    if (step % 4 === 0) {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.10);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(g); g.connect(bus);
      o.start(t); o.stop(t + 0.2);

      // 鼓皮的"啪"：手机小喇叭放不出 44Hz，靠这一下让人听见拍子在哪
      const clk = ac.createBufferSource(); clk.buffer = this.noise;
      const hp2 = ac.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 2600;
      const gc = ac.createGain();
      gc.gain.setValueAtTime(0.07, t);
      gc.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      clk.connect(hp2); hp2.connect(gc); gc.connect(bus);
      clk.start(t); clk.stop(t + 0.04);
    }

    // 军鼓：2、4 拍
    if (step % 16 === 4 || step % 16 === 12) {
      const src = ac.createBufferSource(); src.buffer = this.noise;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 1900; bp.Q.value = 0.9;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      src.connect(bp); bp.connect(g); g.connect(bus);
      src.start(t); src.stop(t + 0.15);

      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(196, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0.07, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g2); g2.connect(bus);
      o.start(t); o.stop(t + 0.1);
    }

    // 踩镲：低强度只走八分（留白，让人听得清拍子在哪），
    // 打起来之后（2 档）铺满十六分，密度跟着手感涨。反拍加重；
    // 3 档起反拍换成拉长的开镲"嚓——"，打碟那种一直往前推的劲
    const hatStep = lv >= 2 ? 1 : 2;
    if (step % hatStep === 0) {
      const accent = step % 4 === 2, open = accent && lv >= 3;
      const src = ac.createBufferSource(); src.buffer = this.noise;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass';
      hp.frequency.value = open ? 7000 : 8200;
      const g = ac.createGain();
      g.gain.setValueAtTime(open ? 0.12 : (accent ? 0.052 : 0.02), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.2 : (accent ? 0.06 : 0.03)));
      src.connect(hp); hp.connect(g); g.connect(bus);
      src.start(t, open ? 0.5 : 0); src.stop(t + (open ? 0.22 : 0.08));
    }

    // 贝斯：八分音符，锯齿波过低通。
    // 档位越高，低通开得越大（BGM_LP）：同一句贝斯从"闷"变"亮"，
    // 是这首曲子在加厚，而不是另起一条旋律。
    // 3 档起后半个 16 分补一个高八度的短音，贝斯"滚"起来（低-高-低-高）
    if (step % 2 === 0 || lv >= 3) {
      const up = step % 2 === 1;
      const f = BGM_BASS[(step >> 1) % 16] * key * (up ? 2 : 1);
      const o = ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = BGM_LP[lv]; lp.Q.value = up ? 3 : 5;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(up ? 0.11 : 0.15, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (up ? 0.07 : 0.15));
      o.connect(lp); lp.connect(g); g.connect(bus);
      o.start(t); o.stop(t + 0.18);
    }

    // 上方和声层：八分音符，**和贝斯同一个拍点**（step % 2 === 0），
    // 所以它的节奏就是贝斯的节奏，不存在错位。
    // 只叠根音的 4/6/8 倍（双八度、上面的五度、三个八度），任何和弦下都不会撞音；
    // 放在 400Hz 以上：手机喇叭才放得出来（以前的 2/3/4 倍在 220~440Hz，手机上几乎听不见）。
    // 轮廓 4-6-8-6 两拍一轮，正好是 4/4 的偶数分句。
    // 5 档改走十六分（一拍一轮），和踩镲同一张网格，跑得更急
    if (lv >= 1 && (step % 2 === 0 || lv >= 5)) {
      const root = BGM_BASS[(step >> 1) % 16] * key;
      const shape = [4, 6, 8, 6][(lv >= 5 ? step : step >> 1) % 4];
      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(root * shape, t);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = 2600;
      const g = ac.createGain();
      const amp = BGM_ARP[lv] * (step % 2 ? 0.7 : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(lp); lp.connect(g); g.connect(bus);
      o.start(t); o.stop(t + 0.18);
    }

    // 拍手：2 档才加进来，叠在 2、4 拍的军鼓上，只是让反拍更实。
    // 刻意用鼓组而不是旋律 —— 旋律一进来就会被听成"另一首曲子"。
    if (lv >= 2 && (step % 16 === 4 || step % 16 === 12)) {
      const src = ac.createBufferSource(); src.buffer = this.noise;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 1250; bp.Q.value = 1.4;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.09, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      src.connect(bp); bp.connect(g); g.connect(bus);
      src.start(t); src.stop(t + 0.11);
    }

    // 4 档：反拍的强力和弦"嘣"（根音的双八度 + 上面的五度，两个锯齿波，滤波一下子收回去），和贝斯同一个和声
    if (lv >= 4 && step % 4 === 2) {
      const root = BGM_BASS[(step >> 1) % 16] * key;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
      lp.frequency.setValueAtTime(lv >= 5 ? 3000 : 2400, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.12);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(BGM_STAB[lv], t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      lp.connect(g); g.connect(bus);
      for (let k = 4; k <= 6; k += 2) {
        const o = ac.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(root * k, t);
        o.connect(lp); o.start(t); o.stop(t + 0.18);
      }
    }

    // 4 档：两小节末尾军鼓"嗒嗒"加花，一轮一轮往前推
    if (lv >= 4 && (step === 30 || step === 31)) {
      const src = ac.createBufferSource(); src.buffer = this.noise;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 1900; bp.Q.value = 0.9;
      const g = ac.createGain();
      g.gain.setValueAtTime(step === 30 ? 0.08 : 0.11, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      src.connect(bp); bp.connect(g); g.connect(bus);
      src.start(t, 0.25); src.stop(t + 0.1);
    }

    // 5 档：每拍"吸"一口的铺底（根音双八度 + 五度，跟着这一拍的贝斯根音），底鼓一响就压下去、拍尾涨回来 ——
    // 电子乐里"整首在呼吸、往前顶"的那种泵感。和弦只用八度 / 五度，跟贝斯不会撞
    if (lv >= 5 && step % 4 === 0) {
      const root = BGM_BASS[(step >> 1) % 16] * key;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 0.7;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.065, t + 0.26);
      g.gain.linearRampToValueAtTime(0.0001, t + 4 * BGM_STEP);
      lp.connect(g); g.connect(bus);
      for (let k = 4; k <= 6; k += 2) {
        const o = ac.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(root * k, t);
        o.connect(lp); o.start(t); o.stop(t + 4 * BGM_STEP + 0.01);
      }
    }

    // 5 档：每轮第一拍一声镲"嚓——"（噪声，不是音高），接住上面的加花
    if (lv >= 5 && step === 0) {
      const src = ac.createBufferSource(); src.buffer = this.noise;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass';
      hp.frequency.value = 4500;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      src.connect(hp); hp.connect(g); g.connect(bus);
      src.start(t, 0.2); src.stop(t + 0.75);
    }
  },

  // 心跳：两下"咚"—"咚"。when 不传就是立刻，传了就跟着 BGM 的拍子走。
  thump: function (vol, when) {
    if (!this.ready) return;
    const ac = this.ac, t0 = (typeof when === 'number') ? when : ac.currentTime;
    for (let i = 0; i < 2; i++) {
      const st = t0 + i * 0.17;
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(66, st);
      o.frequency.exponentialRampToValueAtTime(34, st + 0.17);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(vol * (i ? 0.65 : 1), st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.26);
      o.connect(g); g.connect(this.master);
      o.start(st); o.stop(st + 0.3);
    }
  },

  // 折线包络：pts = [[秒, 值], ...]。lin 为真时第一段线性推上去（起音），其余都走指数（衰减听着自然）
  ramp: function (p, t, pts, lin) {
    p.setValueAtTime(pts[0][1], t + pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      if (lin && i === 1) p.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
      else p.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
    }
  },

  // 一段滤过的噪声。o.f：滤波器频率折线；o.v：音量折线（最后一点就是结束）；
  // o.off：从噪声的第几秒读起 —— 同一刀的几层错开读，不然是同一段噪声叠在一起，会叠出梳子一样的怪音；
  // o.grit：[起 Hz, 止 Hz, 深度]，锯齿波调幅打出颗粒（"撕开"的质感）
  nz: function (t, o) {
    const ac = this.ac, end = t + o.v[o.v.length - 1][0] + 0.02;
    const src = ac.createBufferSource(); src.buffer = this.noise;
    const fl = ac.createBiquadFilter(); fl.type = o.type; fl.Q.value = o.q;
    this.ramp(fl.frequency, t, o.f, false);
    const g = ac.createGain();
    this.ramp(g.gain, t, o.v, true);
    src.connect(fl); fl.connect(g);
    let out = g;
    if (o.grit) {
      const am = ac.createGain(); am.gain.value = 1 - o.grit[2];
      const lfo = ac.createOscillator(); lfo.type = 'sawtooth';
      this.ramp(lfo.frequency, t, [[0, o.grit[0]], [end - t, o.grit[1]]], false);
      const d = ac.createGain(); d.gain.value = o.grit[2];
      lfo.connect(d); d.connect(am.gain);
      g.connect(am); out = am;
      lfo.start(t); lfo.stop(end);
    }
    out.connect(this.master);
    src.start(t + o.v[0][0], o.off || 0); src.stop(end);   // 第一个点之前增益还是默认的 1，不能先响
  },

  // 一个振荡器。o.f：频率折线；o.v：音量折线；
  // o.h：[[倍数, 音量], ...] 跟着同一条频率线走的泛音 —— 低频"咚"在手机小喇叭上放不出来，靠泛音才听得出"沉"
  tone: function (t, o) {
    const ac = this.ac, end = t + o.v[o.v.length - 1][0] + 0.02;
    const g = ac.createGain();
    this.ramp(g.gain, t, o.v, true);
    g.connect(this.master);
    const h = [[1, 1]].concat(o.h || []);
    for (let i = 0; i < h.length; i++) {
      const osc = ac.createOscillator(); osc.type = o.type;
      this.ramp(osc.frequency, t, o.f.map(function (p) { return [p[0], p[1] * h[i][0]]; }), false);
      let out = osc;
      if (h[i][1] !== 1) { out = ac.createGain(); out.gain.value = h[i][1]; osc.connect(out); }
      out.connect(g);
      osc.start(t + o.v[0][0]); osc.stop(end);
    }
  },

  /* —— 刀声：whoosh 是冲刺那一下的破风，hit(n) 是砍中那一下（n = 当前连斩数）——
     以前的斩中是三角波 190→42Hz 滑 130ms + 一下高通噪声"嗒"：手机小喇叭放不出低频，只剩泛音往下滑的"啵"和那一下"嗒"，
     破风又小到听不见 —— 合起来就是"捏泡泡"。现在一刀分几层（每种怎么配见 CUTS）：
       唰：破风 —— 带通噪声先推上去再收，中心频率走一个弧
       嚓：切进去 —— 噪声从高往低急扫，锯齿波调幅打出颗粒（"撕开"，不是"喷一口气"）
       噗：被切开的东西 —— 低通噪声，落在手机也放得出的 200~600Hz
       咚：分量 —— 正弦几十毫秒内掉到 40~70Hz，快到听不出滑音（滑得慢就是"啵"），带一点泛音让手机上也觉得沉
       余音：一小段暗下去的风声，让这一刀有"空间"
     连斩越高只加分量，不升调（升调就是敲玻璃）。
     四种刀声轮流放：每次冲刺换下一种，这一刀砍中用同一种。v 传了就用第 v 种（渲染文件用） */
  whoosh: function (v) {
    if (!this.ready) return;
    if (v === undefined) v = this.cutI = (this.cutI + 1) % CUTS.length;
    CUTS[v].whoosh(this, this.ac.currentTime);
  },

  hit: function (n, v) {
    if (!this.ready) return;
    const t = this.ac.currentTime;
    if (t - this.hitAt < 0.04) return;     // 一刀砍穿好几只：同一刻只响一刀（文件版同样 40ms 去重）
    this.hitAt = t;
    CUTS[v === undefined ? Math.max(0, this.cutI) : v].hit(this, t, clamp((n - 1) / 19, 0, 1));
  },

  // 光盾碎：玻璃一样"锵"地裂开 + 一记低频撞击。和斩中、死亡都不像，一听就知道是盾没了
  shatter: function () {
    if (!this.ready) return;
    const ac = this.ac, t = ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = this.noise;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.18);
    // 三个不成和弦的高音一起响、往下滑一点，像玻璃片落地
    const fs = [1480, 2217, 3322];
    for (let i = 0; i < fs.length; i++) {
      const o = ac.createOscillator(); o.type = 'sine';
      const st = t + i * 0.018;
      o.frequency.setValueAtTime(fs[i], st);
      o.frequency.exponentialRampToValueAtTime(fs[i] * 0.93, st + 0.5);
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0.0001, st);
      g2.gain.linearRampToValueAtTime(0.07, st + 0.006);
      g2.gain.exponentialRampToValueAtTime(0.0001, st + 0.55);
      o.connect(g2); g2.connect(this.master);
      o.start(st); o.stop(st + 0.6);
    }
    const o3 = ac.createOscillator(); o3.type = 'sine';
    o3.frequency.setValueAtTime(120, t);
    o3.frequency.exponentialRampToValueAtTime(48, t + 0.22);
    const g3 = ac.createGain();
    g3.gain.setValueAtTime(0.32, t);
    g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o3.connect(g3); g3.connect(this.master);
    o3.start(t); o3.stop(t + 0.3);
  },

  // 强化：两声上行的清音。买到了，得先听得见
  upgrade: function () {
    if (!this.ready) return;
    const ac = this.ac, t = ac.currentTime;
    const notes = [659.25, 987.77];
    for (let i = 0; i < notes.length; i++) {
      const o = ac.createOscillator(); o.type = 'sine';
      const st = t + i * 0.075;
      o.frequency.setValueAtTime(notes[i], st);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.12, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.42);
      o.connect(g); g.connect(this.master);
      o.start(st); o.stop(st + 0.45);
    }
  },

  // 升段：一刀砍进去的声音，和刀声 / 击中 / 碎晶同一路打击乐。
  // 急速下扫的噪声"唰"（刀划过）→ 中低频的闷响"噗"（刀切进去）→ 下坠的重击 + 底下一记低频轰，
  // 最后只留一下很短、偏低的金属"锵"。越高的段位越"重"不是越"高"：重击更沉更长、低频轰更响，
  // 刀鸣几乎不升调（升太多会像敲玻璃）；第三段起 40ms 后再交叉补一刀
  tierUp: function (tier) {
    if (!this.ready) return;
    const ac = this.ac, t0 = ac.currentTime, self = this;
    function noise(t, type, f, q, peak, dur, sweepTo) {
      const src = ac.createBufferSource(); src.buffer = self.noise;
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t);
      if (q) fl.Q.value = q;
      if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur * 0.8);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(fl); fl.connect(g); g.connect(self.master);
      src.start(t); src.stop(t + dur + 0.02);
    }
    function drop(t, type, f0, f1, peak, dur, glide) {
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + glide);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(self.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function cut(t, w) {
      noise(t, 'bandpass', 5200, 1.6, 0.2 * w, 0.11, 700);         // 唰：刀划过
      noise(t + 0.012, 'bandpass', 520, 1.1, 0.26 * w, 0.1);        // 噗：切进去的闷响
    }
    cut(t0, 1);
    if (tier >= 3) cut(t0 + 0.04, 0.75);                             // 交叉补一刀
    drop(t0, 'triangle', 130, 38, 0.3 + 0.015 * tier, 0.32 + 0.04 * tier, 0.2);   // 重击（三角波带泛音，手机喇叭也听得出沉）
    drop(t0, 'sine', 62, 27, 0.2 + 0.025 * tier, 0.45 + 0.06 * tier, 0.35);      // 低频轰
    // 锵：短、偏低的金属声，每段只高四分之一个全音
    const k = Math.pow(2, 0.5 * tier / 12), ring = [[1, 0.045], [2.32, 0.025], [3.86, 0.012]], tail = 0.22 + 0.03 * tier;
    for (let i = 0; i < ring.length; i++) {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(640 * k * ring[i][0], t0 + 0.01);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0 + 0.01);
      g.gain.linearRampToValueAtTime(ring[i][1], t0 + 0.013);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.01 + tail * (1 - i * 0.2));
      o.connect(g); g.connect(this.master);
      o.start(t0 + 0.01); o.stop(t0 + 0.01 + tail + 0.02);
    }
  },

  // 连斩快断的滴答：干脆的"嗒" —— 极短的高通噪声咔一下，带一点点金属回响；u（0~1）越急越亮越响
  tick: function (u) {
    if (!this.ready) return;
    const ac = this.ac, t = ac.currentTime, x = u || 0;
    const src = ac.createBufferSource(); src.buffer = this.noise;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000 + 1500 * x;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.15 + 0.09 * x, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.02);
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(2600 + 900 * x, t);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.035 + 0.025 * x, t + 0.001);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g2); g2.connect(this.master);
    o.start(t); o.stop(t + 0.035);
  },

  // 死亡：一声尖啸向下坠（仅恐怖版）
  scream: function () {
    if (!this.ready) return;
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.9);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.9);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(bp); bp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.3);
  },

  // 死亡：合规版的"熄火"——低频下坠，不刺耳
  collapse: function () {
    if (!this.ready) return;
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.75);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.05);

    const src = ac.createBufferSource(); src.buffer = this.noise;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.6);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0.12, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(lp); lp.connect(g2); g2.connect(this.master);
    src.start(t); src.stop(t + 0.75);
  },

  // 远处传来的低语
  whisper: function () {
    if (!this.ready) return;
    const ac = this.ac, t = ac.currentTime;
    [372, 379].forEach(function (f, i) {
      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + 1.4);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035 - i * 0.01, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(g); g.connect(ac.destination === g ? g : this.master);
      o.start(t); o.stop(t + 1.6);
    });
  }
};

/* —— 抖音版声音：放预渲染好的文件 ——
   抖音的 WebAudio 靠不住：官方只有 tt.getAudioContext（另一套接口，没有滤波器，
   createBuffer 参数也不一样，开发者工具里还不出声），上面的现场合成在抖音上一声都不会响。
   所以 dev/render-audio.js 拿上面同一个 S 把每种声音离线渲染成 audio/ 下的文件，
   这里用 tt.createInnerAudioContext 放。★ 改了上面的合成参数，要重跑一遍渲染。
   · 格式：单发音效用 mp3；循环用 wav（mp3 首尾有编码器补的静音，循环接缝会断一下），
     wav 加载出错就自动换成 mp3 版（4 个循环长，断的次数少些）
   · obeyMuteSwitch 关掉：合成版本来就不受 iOS 静音键管，换成文件后不能变成"静音就没声"
   · BGM：每档（BGM_LV 档）各渲染一份完整混音，同时循环、只切音量 ——
     换档不用重新起播，拍子不会断。换档的时机和合成版一样（bgmShift：往上在拍子上，往下在小节线）
   · 心跳：照样挂在 BGM 的 16 分网格上。网格用墙钟推，再拿播放进度对表纠正漂移
   · 嗡鸣：一条循环，音量跟着危险度走 */
const SFX_DIR = 'audio/';
const BGM_LOOP = 32 * BGM_STEP;             // 一个循环 = 2 小节
const HIT_LEVELS = [1, 8, 20];             // hit(n) 渲染了这几档，放的时候取最近的

// 四种刀声（见 S.whoosh / S.hit 上面的说明），轮流放。k = 连斩分量 0~1。
// 各层读噪声的位置（off）错开：同一段噪声叠在一起会叠出梳子一样的怪音
const CUTS = [
  { name: '刀锋',   // 亮：刃口擦过去有一下很短的金属"铮"（噪声过窄带通刮出来的，不是纯音）
    whoosh: function (S, t) {
      S.nz(t, { type: 'bandpass', q: 1.3, f: [[0, 700], [0.04, 2200], [0.16, 600]],
                v: [[0, 0.0001], [0.035, 0.14], [0.08, 0.05], [0.17, 0.0001]] });
      S.nz(t, { type: 'bandpass', q: 5, f: [[0, 1900], [0.035, 3400], [0.12, 1500]],
                v: [[0, 0.0001], [0.03, 0.08], [0.12, 0.0001]], off: 0.25 });
    },
    hit: function (S, t, k) {
      S.nz(t, { type: 'highpass', q: 0.7, f: [[0, 2000]], v: [[0, 0.0001], [0.001, 0.14], [0.016, 0.0001]], off: 0.14 });
      S.nz(t, { type: 'bandpass', q: 1.1, f: [[0, 3400 - 700 * k], [0.07, 900 - 200 * k]],
                v: [[0, 0.0001], [0.002, 0.23], [0.03, 0.08], [0.09, 0.0001]], off: 0.02, grit: [95, 45, 0.45] });
      S.nz(t, { type: 'lowpass', q: 1.4, f: [[0, 900 - 150 * k], [0.1, 260]],
                v: [[0, 0.0001], [0.004, 0.33 + 0.17 * k], [0.12 + 0.04 * k, 0.0001]], off: 0.18 });
      S.tone(t, { type: 'sine', f: [[0, 140 - 15 * k], [0.04, 55 - 6 * k], [0.25, 46]],
                  v: [[0, 0.0001], [0.003, 0.17 + 0.06 * k], [0.14 + 0.06 * k, 0.0001]], h: [[2, 0.35]] });
      S.nz(t, { type: 'lowpass', q: 0.7, f: [[0, 1800], [0.25, 500]],
                v: [[0.01, 0.0001], [0.035, 0.03 + 0.01 * k], [0.26 + 0.06 * k, 0.0001]], off: 0.36 });
      // 铮：连斩越高越短越轻、略往下，绝不升调
      const M = [[1750, 0.55], [2630, 0.3], [3480, 0.19]];
      for (let i = 0; i < M.length; i++) {
        const f = M[i][0] * (1 - 0.05 * k);
        S.nz(t + 0.004, { type: 'bandpass', q: 28, f: [[0, f], [0.1, f * 0.96]],
                          v: [[0, 0.0001], [0.004, M[i][1] * (1 - 0.4 * k)], [0.1 - 0.03 * k, 0.0001]], off: 0.72 + 0.05 * i });
      }
    }, s: '累计跑', u: ' 米' },
  { name: '重刀',   // 低、厚：大刀抡过去劈开东西，没有金属声
    whoosh: function (S, t) {
      S.nz(t, { type: 'bandpass', q: 0.9, f: [[0, 450], [0.045, 1700], [0.18, 420]],
                v: [[0, 0.0001], [0.04, 0.12], [0.09, 0.04], [0.19, 0.0001]], off: 0.05 });
      S.nz(t, { type: 'lowpass', q: 0.8, f: [[0, 300], [0.04, 700], [0.15, 250]],
                v: [[0, 0.0001], [0.04, 0.14], [0.16, 0.0001]], off: 0.3 });
    },
    hit: function (S, t, k) {
      S.nz(t, { type: 'highpass', q: 0.7, f: [[0, 2000]], v: [[0, 0.0001], [0.001, 0.15], [0.014, 0.0001]], off: 0.17 });
      S.nz(t, { type: 'bandpass', q: 0.9, f: [[0, 2400 - 500 * k], [0.08, 650 - 150 * k]],
                v: [[0, 0.0001], [0.002, 0.25], [0.035, 0.1], [0.1, 0.0001]], off: 0.05, grit: [70, 35, 0.6] });
      S.nz(t, { type: 'lowpass', q: 1.6, f: [[0, 800 - 150 * k], [0.12, 220]],
                v: [[0, 0.0001], [0.004, 0.42 + 0.18 * k], [0.15 + 0.05 * k, 0.0001]], off: 0.21 });
      S.tone(t, { type: 'sine', f: [[0, 125 - 15 * k], [0.045, 50 - 6 * k], [0.3, 42]],
                  v: [[0, 0.0001], [0.003, 0.21 + 0.06 * k], [0.18 + 0.08 * k, 0.0001]], h: [[2, 0.4]] });
      S.nz(t, { type: 'lowpass', q: 0.7, f: [[0, 1800], [0.25, 500]],
                v: [[0.01, 0.0001], [0.035, 0.035 + 0.012 * k], [0.26 + 0.06 * k, 0.0001]], off: 0.4 });
    } },
  { name: '快刀',   // 短、脆：一下就过去，切口利落，分量最轻
    whoosh: function (S, t) {
      S.nz(t, { type: 'bandpass', q: 1.6, f: [[0, 1200], [0.025, 3200], [0.11, 900]],
                v: [[0, 0.0001], [0.022, 0.13], [0.05, 0.05], [0.12, 0.0001]], off: 0.09 });
    },
    hit: function (S, t, k) {
      S.nz(t, { type: 'highpass', q: 0.7, f: [[0, 2600]], v: [[0, 0.0001], [0.001, 0.18], [0.012, 0.0001]], off: 0.11 });
      S.nz(t, { type: 'bandpass', q: 1.3, f: [[0, 4200 - 800 * k], [0.05, 1200 - 250 * k]],
                v: [[0, 0.0001], [0.0015, 0.26], [0.02, 0.09], [0.07, 0.0001]], off: 0.08, grit: [130, 70, 0.35] });
      S.nz(t, { type: 'lowpass', q: 1.2, f: [[0, 1100 - 150 * k], [0.08, 320]],
                v: [[0, 0.0001], [0.004, 0.26 + 0.16 * k], [0.09 + 0.03 * k, 0.0001]], off: 0.24 });
      S.tone(t, { type: 'sine', f: [[0, 175 - 15 * k], [0.03, 70 - 8 * k], [0.2, 60]],
                  v: [[0, 0.0001], [0.003, 0.15 + 0.06 * k], [0.11 + 0.05 * k, 0.0001]], h: [[2, 0.3]] });
      S.nz(t, { type: 'lowpass', q: 0.7, f: [[0, 2200], [0.2, 700]],
                v: [[0.01, 0.0001], [0.03, 0.022 + 0.01 * k], [0.2 + 0.05 * k, 0.0001]], off: 0.46 });
    } },
  { name: '劈山',   // 大开大合：抡得最慢、落得最沉，砍中多一下"咔"的闷裂
    whoosh: function (S, t) {
      S.nz(t, { type: 'lowpass', q: 0.9, f: [[0, 250], [0.05, 600], [0.2, 220]],
                v: [[0, 0.0001], [0.05, 0.12], [0.2, 0.0001]], off: 0.13 });
      S.nz(t, { type: 'bandpass', q: 1.0, f: [[0, 500], [0.05, 1500], [0.2, 400]],
                v: [[0, 0.0001], [0.05, 0.09], [0.1, 0.035], [0.21, 0.0001]], off: 0.35 });
    },
    hit: function (S, t, k) {
      S.nz(t, { type: 'highpass', q: 0.7, f: [[0, 1800]], v: [[0, 0.0001], [0.001, 0.12], [0.016, 0.0001]], off: 0.27 });
      S.nz(t, { type: 'bandpass', q: 0.8, f: [[0, 2000 - 250 * k], [0.09, 500 - 60 * k]],
                v: [[0, 0.0001], [0.003, 0.27], [0.04, 0.11], [0.12, 0.0001]], off: 0.15, grit: [55, 30, 0.65] });
      S.nz(t, { type: 'lowpass', q: 1.8, f: [[0, 700 - 120 * k], [0.14, 200]],
                v: [[0, 0.0001], [0.005, 0.45 + 0.2 * k], [0.18 + 0.06 * k, 0.0001]], off: 0.31 });
      S.tone(t, { type: 'sine', f: [[0, 110 - 12 * k], [0.05, 44 - 5 * k], [0.3, 38]],
                  v: [[0, 0.0001], [0.004, 0.24 + 0.07 * k], [0.24 + 0.1 * k, 0.0001]], h: [[2, 0.45], [3, 0.15]] });
      S.nz(t + 0.004, { type: 'bandpass', q: 4, f: [[0, 1300], [0.03, 900]],
                        v: [[0, 0.0001], [0.002, 0.13 + 0.05 * k], [0.035, 0.0001]], off: 0.52 });
      S.nz(t, { type: 'lowpass', q: 0.7, f: [[0, 1500], [0.3, 400]],
                v: [[0.012, 0.0001], [0.04, 0.04 + 0.012 * k], [0.32 + 0.08 * k, 0.0001]], off: 0.58 });
    } }
];
const DRONE_REF = 0.1;                      // 嗡鸣按这个增益渲染；播放音量 = 实际增益 / DRONE_REF
const SFX_POOL = 3;                         // 同一个音效最多同时响几个


const SF = {
  bgm: null, drone: null, pools: null, tier: 0, cutI: -1, hitAt: -1e9,
  bgmAbs: 0, bgmSw: 0, bgmPos: -1, bgmFresh: false, droneTarget: 0.012, droneVol: 0, droneAt: -1e9,

  init: function () {
    if (this.ready) return;
    try {
      const self = this;
      this.pools = {};
      this.bgm = [];
      for (let i = 0; i < BGM_LV; i++) this.bgm.push(this.player('bgm-' + i, true));
      this.drone = this.player('drone', true);

      // 起播有延迟：真正出声那一刻才是第 0 拍
      this.bgm[0].played = function () {
        if (self.bgmFresh) { self.bgmFresh = false; self.bgmEpoch = nowMs() / 1000; }
      };

      // 常用的开机就建好、局内不再加（都在响就掐最早那个）：抖音上现建一个播放器要现加载、现解码，
      // 正好卡在斩的那一帧。刀声四种轮流放（见 CUTS），同一种要隔三刀才再响，每种一个播放器就够
      const warm = ['thump', 'upgrade', 'collapse', 'shatter', 'tick'];
      for (let i = 0; i < COMBO_TIERS.length; i++) warm.push('tier-' + i);
      for (let v = 0; v < CUTS.length; v++) {
        warm.push('whoosh-' + v);
        for (let i = 0; i < HIT_LEVELS.length; i++) warm.push('hit-' + HIT_LEVELS[i] + '-' + v);
      }
      for (let i = 0; i < warm.length; i++) {
        const pool = this.pools[warm[i]] = [this.player(warm[i], false)];
        pool.fixed = true;
      }

      this.ready = true;
      AUD.mode = '文件';
    } catch (e) {
      this.ready = false;
      AUD.mode = '文件失败'; AUD.err++; AUD.msg = String((e && e.message) || e);
    }
  },

  player: function (name, loop) {
    const a = MG.createInnerAudioContext();
    const p = { a: a, busy: false, t: 0, v: loop ? 0 : 1, mp3: !loop, ok: false, want: false, started: false, on: false, played: null };
    try { a.obeyMuteSwitch = false; } catch (e) {}
    a.loop = loop;
    a.volume = p.v;
    a.src = SFX_DIR + name + (p.mp3 ? '.mp3' : '.wav');
    AUD.n++;

    // 循环（BGM / 嗡鸣）开机就建、玩家一点开始就 play，可能那时还没加载完：有的机型会把这一下吞掉，
    // 结果整局没音乐。加载好了发现"该在放、却一次都没放出来"，就补一次
    if (typeof a.onCanplay === 'function') a.onCanplay(function () {
      if (!p.ok) { p.ok = true; AUD.ok++; }
      if (p.want && !p.on) { try { a.play(); } catch (e) {} }
    });
    if (typeof a.onPlay === 'function') {
      a.onPlay(function () {
        p.on = true;
        AUD.plays++;
        if (!p.ok) { p.ok = true; AUD.ok++; }
        if (p.played) p.played();
      });
    }
    if (!loop && typeof a.onEnded === 'function') a.onEnded(function () { p.busy = false; });
    if (typeof a.onError === 'function') {
      a.onError(function (e) {
        p.busy = false;
        AUD.err++;
        AUD.msg = name + (p.mp3 ? '.mp3 ' : '.wav ') + ((e && (e.errMsg || e.errCode)) || '');
        if (typeof console !== 'undefined') console.warn('[audio] 加载/播放失败', a.src, e);
        // 循环的 wav 不认，就换 mp3 版再来；正该响着的接着放
        if (!p.mp3) {
          p.mp3 = true;
          a.src = SFX_DIR + name + '.mp3';
          if (p.want) { try { a.play(); } catch (e2) {} }
        }
      });
    }
    return p;
  },

  // 放一个音效；花在播放调用上的时间记进帧体检（PT.snd）
  sfx: function (name, vol) {
    if (!this.ready) return;
    const t0 = nowMs();
    this.sfxPlay(name, vol);
    if (state === 'play') PT.snd += nowMs() - t0;
  },
  // 找一个空闲的播放器；都在响就再开一个（开机建好的那几种不再开），开满了就掐掉最早响的那个重来
  sfxPlay: function (name, vol) {
    const pool = this.pools[name] || (this.pools[name] = []);
    // 一刀砍穿好几只：同一个音效 40ms 内只响一次（叠在一起只是更响，还白白多几次 play / stop）
    const now = nowMs();
    if (now - (pool.last === undefined ? -1e9 : pool.last) < 40) return;
    pool.last = now;
    let p = null;
    for (let i = 0; i < pool.length; i++) if (!pool[i].busy) { p = pool[i]; break; }
    if (!p && !pool.fixed && pool.length < SFX_POOL) { p = this.player(name, false); pool.push(p); }
    if (!p) {
      p = pool[0];
      for (let i = 1; i < pool.length; i++) if (pool[i].t < p.t) p = pool[i];
    }
    try {
      if (p.busy) p.a.stop();
      p.a.volume = clamp(vol, 0, 1);
      p.a.play();
      p.busy = true; p.t = now;
    } catch (e) { p.busy = false; }
  },

  setTension: function (danger) {
    this.droneTarget = 0.012 + danger * 0.075;   // 和合成版同一个公式
  },

  bgmStart: function () {
    if (!this.ready || this.bgmTimer) return;
    // 每次都从小节头起；三档一起起播，之后只动音量
    this.tier = this.bgmWant;
    this.heartLeft = 8;
    this.bgmAbs = 0; this.bgmSw = 0; this.bgmPos = -1;
    this.bgmEpoch = nowMs() / 1000; this.bgmFresh = true;
    const loops = this.bgm.concat([this.drone]);
    for (let i = 0; i < loops.length; i++) {
      const p = loops[i];
      try {
        if (i < this.bgm.length) { p.v = (i === this.tier) ? 1 : 0; p.a.volume = p.v; }
        // 第一次直接 play：刚建好、可能还没加载完的播放器先 stop 再 play，有的机型会把 play 吞掉
        if (p.started) p.a.stop();
        p.a.play();
        p.started = true; p.want = true;
      } catch (e) {}
    }
    const self = this;
    this.bgmTimer = setInterval(function () { self.bgmPump(); }, 30);
  },

  bgmStop: function () {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
    if (!this.ready) return;
    const loops = this.bgm.concat([this.drone]);
    for (let i = 0; i < loops.length; i++) {
      loops[i].want = false;
      try { loops[i].a.pause(); } catch (e) {}
    }
  },

  setTier: function (t) {
    if (t === this.tier) return;
    this.bgm[this.tier].a.volume = 0;
    this.bgm[t].a.volume = 1;
    this.tier = t;
  },

  bgmPump: function () {
    if (!this.ready || !this.bgmTimer) return;
    const now = nowMs() / 1000;

    // 对表：播放进度一刷新，就拿它校正墙钟推出来的位置。
    // 循环接缝、卡顿都会让两者慢慢错开，不校正的话心跳和光环会一点点漂离鼓点
    const pos = this.bgm[0].a.currentTime;
    if (typeof pos === 'number' && pos > 0 && pos !== this.bgmPos) {
      this.bgmPos = pos;
      let d = ((now - this.bgmEpoch) - pos) % BGM_LOOP;
      if (d > BGM_LOOP / 2) d -= BGM_LOOP;
      else if (d < -BGM_LOOP / 2) d += BGM_LOOP;
      if (Math.abs(d) > 0.05) this.bgmEpoch += d;
    }

    // 16 分网格：过了几格走几格；卡了太久（超过 4 格）过期的直接跳过，不补
    const cur = Math.floor((now - this.bgmEpoch) / BGM_STEP);
    if (cur - this.bgmAbs > 4) this.bgmAbs = cur;
    while (this.bgmAbs <= cur) {
      this.heartTick();
      this.bgmAbs++;
    }
    // 换档提前 25ms：拍子前那一下最安静（上一拍的尾音都收了），新那档的底鼓从头整个响出来，
    // 不会在旧档的鼓头上切一刀
    const sw = Math.floor((now - this.bgmEpoch + 0.025) / BGM_STEP);
    if (sw !== this.bgmSw) {
      this.bgmSw = sw;
      this.setTier(bgmShift(this.tier, this.bgmWant, ((sw % 32) + 32) % 32));
    }

    // 嗡鸣：约 0.3 秒跟上目标，外加合成版那条 0.11Hz 的慢呼吸
    const target = this.droneTarget + 0.012 * Math.sin(now * 0.11 * Math.PI * 2);
    this.droneVol += (target - this.droneVol) * 0.1;
    const v = clamp(this.droneVol / DRONE_REF, 0, 1);
    // 每设一次音量都要走一趟原生：黑潮在屏幕里时危险度一直在变，以前一秒设二十多次（不在时 7 次）。差 0.03 以上、隔 0.15 秒以上才设
    if (Math.abs(v - this.drone.v) > 0.03 && now - this.droneAt > 0.15) {
      const t0 = nowMs();
      this.drone.a.volume = v; this.drone.v = v; this.droneAt = now;
      if (state === 'play') PT.snd += nowMs() - t0;      // 也记进帧体检（声音振动）
    }
  },

  // 文件是按 vol = 1 渲染的，这里只缩音量；跟拍的时机由 bgmPump 决定，when 用不上
  thump: function (vol) { this.sfx('thump', vol); },
  // 刀声四种轮流（见 CUTS）：冲刺换下一种，这一刀砍中用同一种；击中取最近的一档 HIT_LEVELS
  whoosh: function () {
    this.cutI = (this.cutI + 1) % CUTS.length;
    this.sfx('whoosh-' + this.cutI, 1);
  },
  hit: function (n) {
    const now = nowMs();
    if (now - this.hitAt < 40) return;   // 一刀砍穿好几只：同一刻只响一刀（四种是四个文件，sfx 里按文件的去重管不到彼此）
    this.hitAt = now;
    const k = Math.min(n, 20);
    let b = HIT_LEVELS[0];
    for (let i = 1; i < HIT_LEVELS.length; i++) {
      if (Math.abs(HIT_LEVELS[i] - k) < Math.abs(b - k)) b = HIT_LEVELS[i];
    }
    this.sfx('hit-' + b + '-' + Math.max(0, this.cutI), 1);
  },
  upgrade: function () { this.sfx('upgrade', 1); },
  tierUp: function (tier) { this.sfx('tier-' + clamp(tier, 0, COMBO_TIERS.length - 1), 1); },
  tick: function (u) { this.sfx('tick', 0.55 + 0.45 * (u || 0)); },   // 文件按最急的那声渲染，这里只缩音量
  shatter: function () { this.sfx('shatter', 1); },
  scream: function () { this.sfx('scream', 1); },
  collapse: function () { this.sfx('collapse', 1); },
  whisper: function () { this.sfx('whisper', 1); }
};

// 抖音（或别的没有 WebAudio 的小游戏平台）→ 换成文件版。接口一样，游戏里照常调 S.xxx。
// 抖音上就算冒出个 createWebAudioContext 也不用：没有文档、滤波器不全，合成会静默失败
const ON_DOUYIN = (typeof tt !== 'undefined') && MG === tt;
if (IS_MG && typeof MG.createInnerAudioContext === 'function' &&
    (ON_DOUYIN || typeof MG.createWebAudioContext !== 'function')) {
  Object.assign(S, SF);
  S.init();   // 放文件不用等玩家点屏幕，开机就建好播放器、提前加载
}

// 音频 API 在两端有差异，任何一个方法抛错都不该打断游戏
['setTension', 'thump', 'whoosh', 'hit', 'scream', 'collapse', 'whisper',
 'bgmStart', 'bgmStop', 'setBgm', 'bgmPump', 'bgmVoice', 'bgmOn', 'setHeart', 'heartTick',
 'heartStart', 'heartStop', 'upgrade', 'shatter'].forEach(function (k) {
  const f = S[k];
  S[k] = function () {
    try { return f.apply(S, arguments); } catch (e) {}
  };
});


/* =========================================================
   7. 输入
   ========================================================= */
const keys = Object.create(null);

function resetInput() {
  attackHeld = false;
  for (const k in keys) keys[k] = false;
  tMove.x = 0; tMove.y = 0;
  touchId = null; btnTouchId = null;
  for (const id in hSideTouch) delete hSideTouch[id];
  for (const id in lTouch) delete lTouch[id];
}

function toWorld(cx, cy) {
  // 小游戏的触摸坐标就是画布坐标；浏览器里画布可能被 CSS 缩放过，要先还原
  return { x: cx / SC, y: cy / SC };
}

// 把触摸点统一换算到"画布 CSS 坐标"，之后所有按钮判定都用这套坐标
function normalizeTouches(list) {
  if (IS_MG) return list;
  const r = canvas.getBoundingClientRect();
  const k = (r.width / (W_CSS || 1)) || 1;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    out.push({
      identifier: list[i].identifier,
      clientX: (list[i].clientX - r.left) / k,
      clientY: (list[i].clientY - r.top) / k
    });
  }
  return out;
}

function inRect(t, r) {
  return t.clientX >= r.x && t.clientX <= r.x + r.w &&
         t.clientY >= r.y && t.clientY <= r.y + r.h;
}

// 死亡界面的按钮位置：绘制和点击共用这一份，永远不会点偏
function deadBtns() {
  const w = Math.min(300, W_CSS - 56);
  const x = (W_CSS - w) / 2;
  const y = H_CSS - SAFE_BOTTOM - 168;
  return {
    revive: { x: x, y: y, w: w, h: 58 },
    retry:  { x: x, y: y + 72, w: w, h: 44 }
  };
}

// 结算页按钮：从下往上排。"再来一局"是最大最亮的一颗，打完一局手指落下去就是下一局；
// 翻倍余光在它上面（那是奖励），强化 / 广告 / 分享三颗小的在它下面
function overBtns() {
  const w = Math.min(320, W_CSS - 48);
  const x = (W_CSS - w) / 2;
  const third = (w - 16) / 3;
  const yHome = H_CSS - SAFE_BOTTOM - 46;
  const yRow = yHome - 8 - 44;
  const yRetry = yRow - 10 - 56;
  return {
    doubleUp: { x: x, y: yRetry - 10 - 46, w: w, h: 46 },
    retry:    { x: x, y: yRetry, w: w, h: 56 },
    skills:   { x: x, y: yRow, w: third, h: 44 },
    echoAd:   { x: x + third + 8, y: yRow, w: third, h: 44 },
    share:    { x: x + (third + 8) * 2, y: yRow, w: third, h: 44 },
    // 回到主界面：低调的一条，放在最下面 —— 它不该和"再来一局"抢手
    home:     { x: x, y: yHome, w: w, h: 36 }
  };
}

// 主界面右下角的"余光"入口
function readySkillBtn() {
  return { x: W_CSS - 150, y: readyTopY(), w: 130, h: 46 };
}
// 主界面顶上那排按钮的 y：在右上角胶囊下面（左边的振动开关跟着一起下来，两边对齐）
function readyTopY() { return MENU ? Math.max(SAFE_TOP + 16, MENU.bottom + 10) : SAFE_TOP + 16; }

function onTouchStart(e) {
  isTouch = true;
  const list = normalizeTouches(e.changedTouches || e.touches || []);
  const t0 = list[0] || { clientX: -1, clientY: -1 };

  if (state === 'ready' && CFG.mainMode === 'lane') { lReadyTap(t0); return; }     // 横屏跑酷主界面（2.17 节）
  if (state === 'ready' && CFG.mainMode === 'horde') {
    if (rkPick) { rkPickTap(t0); return; }                                                // 排行榜：挑哪个榜（0.5 节）
    if (canVibrate() && inRect(t0, readyVibBtn())) { toggleVib(); return; }
    if ((rkBoardOn() || rkCanOpen()) && inRect(t0, readyRankBtn())) { if (rkBoardOn()) openRankView(); else rkPick = true; return; }
    if (shopOn() && inRect(t0, readyCandyBtn())) { openShop(); return; }   // 左上角：嘉欣糖商店（2.13 节）
    if (CFG.testPanel && inRect(t0, readyDataBtn())) { openData(); return; }
    if (readyHTut && inRect(t0, readyHTut)) { hTutReplay(); return; }                   // 新手教程：从头教一局（2.14 节）
    hStartFlow(true); return;                   // 点屏幕任意处都算开始（先问看不看广告带道具，再放开场剧情）
  }
  if (state === 'ready') {
    if (inRect(t0, readySkillBtn())) { openSkills(); return; }
    if (canVibrate() && inRect(t0, readyVibBtn())) { toggleVib(); return; }
    if (inRect(t0, readyGuideBtn())) { openGuide(0); return; }
    if (inRect(t0, readyTutBtn())) { replayTutorial(); return; }
    if (CFG.testPanel && inRect(t0, readyDataBtn())) { openData(); return; }
    if (readyHordeOn() && inRect(t0, readyHordeBtn())) { startHorde(); return; }
    startFromMenu(); return;
  }
  if (state === 'talk') { talkTap(t0); return; }

  if (state === 'guide') { guideTap(t0); return; }

  if (state === 'dead' && laneMode) { lDeadTap(t0); return; }        // 横屏跑酷：被抓那一页
  if (state === 'dead' && hordeMode) { hordeDeadTap(t0); return; }   // 黑潮试玩：自己的失败页
  if (state === 'dead') {
    // 有复活机会时多等半秒防误触；没有的话 0.2 秒就够，别让玩家干等
    const guard = DEAD_LOOK + ((canRevive && reviveT > 0) ? 0.55 : 0.2);   // 死亡页晚 DEAD_LOOK 秒才出来
    if (deadT < guard) return;
    const b = deadBtns();
    if (canRevive && reviveT > 0 && inRect(t0, b.revive)) { startAd('revive'); return; }
    finishRun(); return;                               // 其余任何位置 = 直接进结算
  }

  if (state === 'over') {
    if (overT < 0.35) return;
    const b = overBtns();
    if (!echoDoubled && runEcho > 0 && inRect(t0, b.doubleUp)) { startAd('double'); return; }
    if (echoAdLeft > 0 && inRect(t0, b.echoAd)) { startAd('echo'); return; }
    if (inRect(t0, b.skills)) { openSkills(); return; }
    if (inRect(t0, b.share)) { shareGame(); return; }
    if (inRect(t0, b.retry)) { start(); return; }
    if (inRect(t0, b.home)) { toReady(); return; }
    return;
  }

  if (state === 'skills') { skillTap(t0); return; }
  if (state === 'data') { dataTap(t0); return; }
  if (state === 'shop') { shopTap(t0); return; }
  if (state === 'box') { boxTap(t0); return; }
  if (state === 'preAd') { preAdTap(t0); return; }
  if (state === 'rankView') { rankViewTap(t0); return; }
  if (state === 'propPick') { propPickTap(t0); return; }
  if (state === 'pause') { pauseTap(t0); return; }
  if (state === 'pick') { pickTap(t0); return; }
  if (state === 'ad') return;

  // ---- 游戏中 ----
  if (state !== 'play') return;
  if (laneMode) { for (let i = 0; i < list.length; i++) lTouchStart(list[i]); return; }   // 横屏跑酷：上下划换道、往右划斩
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (inRect(t, hudPauseBtn())) { pauseGame(); return; }
    if (testGod() && !hordeMode && inRect(t, godSkipBtn())) { breakLayer(); continue; }   // 测试：直接破门进下一层
    if (hordeMode && hTutFz && !hTutLet(t)) continue;      // 新手教程停住了：只认这一步要点的地方（2.14 节）
    // 黑潮试玩：「连斩」键（斩键正上方）
    if (hordeMode) {
      const bb = hBurstBtn();
      if (Math.hypot(t.clientX - bb.x, t.clientY - bb.y) < bb.r * 1.25) { hBurstGo(); continue; }
      // 仓库道具（2.16 节）：「连斩」正上方，整局都在；点到了就算点它（用不了也不误斩右边）
      const pb = hPropBtn();
      if (!hTutOn() && Math.hypot(t.clientX - pb.x, t.clientY - pb.y) < pb.r * 1.25) { bxUse(); continue; }
    }
    // 两把斩：左半屏点 = 左斩、右半屏点 = 右斩（按着的那边，鬼火冲的时候往那边挪）
    if (hordeMode && HD.twoBlades) {
      const side = t.clientX < W_CSS / 2 ? -1 : 1;
      hSideTouch[t.identifier] = { s: side, t: nowMs() }; hPressSide = side; hPressAt = nowMs();
      if (hTap(side)) hSideTouch[t.identifier].whiff = true;
      continue;
    }
    // 按钮判定用 CSS 坐标，别用世界坐标
    if (Math.hypot(t.clientX - DASH_BTN.x, t.clientY - DASH_BTN.y) < DASH_BTN.r * 1.6) {
      btnTouchId = t.identifier;
      attackHeld = true;
      if (hordeMode) hTap();            // 黑潮试玩：点一下斩一刀，按住不会自己接
      else tryDash(null);
    } else if (touchId === null) {
      touchId = t.identifier;
      tOrigin = { x: t.clientX, y: t.clientY };
      tMove.x = 0; tMove.y = 0;
    }
  }
}

function onTouchMove(e) {
  const list = normalizeTouches(e.changedTouches || e.touches || []);
  if (laneMode && state === 'play') { for (let i = 0; i < list.length; i++) lTouchMove(list[i]); return; }
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.identifier !== touchId) continue;
    const dx = t.clientX - tOrigin.x, dy = t.clientY - tOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len < 6) { tMove.x = 0; tMove.y = 0; }
    else {
      const k = Math.min(1, len / 70);
      tMove.x = dx / len * k;
      tMove.y = dy / len * k;
    }
  }
}

function onTouchEnd(e) {
  const list = normalizeTouches(e.changedTouches || e.touches || []);
  if (laneMode) for (let i = 0; i < list.length; i++) lTouchEnd(list[i]);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.identifier === touchId) { touchId = null; tMove.x = 0; tMove.y = 0; }
    if (t.identifier === btnTouchId) { btnTouchId = null; attackHeld = false; }
    // 两把斩点空了、点一下就松（不是按住走）：whiffWin 秒里第二次点空，两把都停一下（HD.whiffCd）；新手教程里不罚
    const h = hSideTouch[t.identifier];
    if (h && h.whiff && nowMs() - h.t < HD.whiffTap * 1000 && state === 'play' && !hTutOn()) {
      hMomAdd(-HD.momWhiff);                 // 势头：点空掉一档（每次都掉；罚停照旧只罚连着点空）
      if (nowMs() - hWhiffAt < HD.whiffWin * 1000) P.cd = Math.max(P.cd, HD.whiffCd);
      hWhiffAt = nowMs();
    }
    delete hSideTouch[t.identifier];
  }
}

function bindInput() {
  if (IS_MG) {
    MG.onTouchStart(onTouchStart);
    MG.onTouchMove(onTouchMove);
    MG.onTouchEnd(onTouchEnd);
    if (typeof MG.onTouchCancel === 'function') MG.onTouchCancel(onTouchEnd);

    // 切后台要停手，否则回来时角色还在按着上一次的方向跑；音乐也一起停
    if (typeof MG.onHide === 'function') {
      MG.onHide(function () { if (state === 'play') pauseGame(); resetInput(); S.bgmStop(); });
    }

    // 从广告 / 后台回来：重置计时基准，音频从挂起状态恢复
    if (typeof MG.onShow === 'function') {
      MG.onShow(function () {
        last = 0;
        keepScreenOn();
        if (S.ac) { try { if (S.ac.state === 'suspended') S.ac.resume(); } catch (e) {} }
        // 回到游戏里才续 BGM；还在 ready / 技能页就别自己响
        if (state === 'play' || state === 'pick' || state === 'talk' || state === 'dead' || state === 'over') S.bgmStart();
      });
    }

    initShare();
    rkInit();                    // 排行榜：悄悄登录、补交成绩（0.5 节）
    return;
  }

  // —— 以下是浏览器端，方便同一份代码在电脑上调试 ——
  window.addEventListener('keydown', function (e) {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === ' ' || k.indexOf('arrow') === 0) e.preventDefault();
    if (k === ' ') attackHeld = true;

    if (state === 'ready' && (k === ' ' || k === 'enter')) { if (CFG.mainMode === 'lane') lStartFlow(true); else if (CFG.mainMode === 'horde') hStartFlow(true); else startFromMenu(); return; }
    if (state === 'dead' && laneMode) { if (deadT > 0.7) { if (k === 'escape') toReady(); else if (k === ' ' || k === 'enter' || k === 'r') lStartFlow(false); } return; }
    if (state === 'talk') { if (k === 'escape') { testTalk(talk.key, 1, talk.i); talkEnd(); } else if (k === ' ' || k === 'enter') talkNext(); return; }
    if (state === 'ready' && k === 's') { openSkills(); return; }
    if (state === 'ready' && k === 'h') { openGuide(0); return; }
    if (state === 'ready' && k === 't') { replayTutorial(); return; }
    if (state === 'guide') {
      if (k === 'arrowleft') guideGo(-1);
      else if (k === 'arrowright') guideGo(1);
      else if (k === 'escape') closeGuide();
      return;
    }
    if (state === 'dead' && hordeMode) {
      if (deadT > DEAD_LOOK + 0.3) {
        if (hEnd === 'revive') { if (k === ' ' || k === 'enter' || k === 'escape') hEndAfterRevive(); }
        else if (hEnd === 'box') { if (k === ' ' || k === 'enter' || k === 'escape') hEndGo('rank'); }
        else if (k === 'escape') toReady(); else if (k === ' ' || k === 'enter' || k === 'r') hStartFlow();
      }
      return;
    }
    if (state === 'preAd') { if (k === ' ' || k === 'enter') hStartGo(); return; }
    if (state === 'dead' && deadT > DEAD_LOOK + 0.55) {
      if (canRevive && reviveT > 0 && k !== 'r') { startAd('revive'); return; }
      finishRun(); return;
    }
    if (state === 'over' && (k === 'escape' || k === 'backspace')) { toReady(); return; }
    if (state === 'over' && (k === 'r' || k === ' ' || k === 'enter')) { if (deadT > 0.35) start(); return; }
    if (state === 'skills' && (k === 'escape' || k === 's')) { backFromSkills(); return; }
    if (state === 'shop' && k === 'escape') { state = 'ready'; return; }
    if (state === 'propPick') { if (k >= '1' && k <= String(PROP_KINDS.length)) startHorde(PROP_KINDS[+k - 1]); return; }
    if (state === 'ad' && k === 'enter') { finishAd(); return; }
    if (state === 'play' && (k === 'escape' || k === 'p')) { pauseGame(); return; }
    if (state === 'pause') { if (k === 'escape' || k === 'p' || k === 'enter') resumeGame(); return; }
    if (state === 'pick') { if (k >= '1' && k <= '3') pickChoose(+k - 1); return; }
    if (state === 'play' && laneMode) {          // 横屏跑酷：↑↓ / W S 换道，→ / D / 空格 斩
      if (k === 'arrowup' || k === 'w') lMove(-1);
      else if (k === 'arrowdown' || k === 's') lMove(1);
      else if (k === 'arrowright' || k === 'd' || k === ' ') lSlash();
      return;
    }
    if (state === 'play' && hordeMode) {
      if (hIntro) return;
      if (HD.twoBlades && (k === 'a' || k === 'arrowleft' || k === 'j')) hTap(-1);       // 两把斩：A / ← / J 左斩，D / → / K / 空格 右斩
      else if (HD.twoBlades && (k === 'd' || k === 'arrowright' || k === 'k')) hTap(1);
      else if (k === ' ') hTap(1);
      else if (k === 'e' || k === 'shift') hBurstGo();
      return;
    }
    if (state === 'play' && k === ' ') tryDash(null);
  });
  window.addEventListener('keyup', function (e) {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === ' ') attackHeld = false;
  });
  window.addEventListener('blur', resetInput);
  window.addEventListener('mouseup', function () { attackHeld = false; });
  window.addEventListener('resize', function () { layout(); });

  canvas.addEventListener('mousedown', function (e) {
    const r = canvas.getBoundingClientRect();
    const k = (r.width / (W_CSS || 1)) || 1;
    const cx = (e.clientX - r.left) / k;
    const cy = (e.clientY - r.top) / k;

    if (state === 'play') {
      attackHeld = true;
      if (hordeMode) hTap(); else tryDash({ x: cx / SC, y: cy / SC });
      return;
    }

    // 非游戏状态复用触摸逻辑，保证桌面和手机上点的是同一个按钮
    const wasTouch = isTouch;
    onTouchStart({ changedTouches: [{ identifier: 1, clientX: cx, clientY: cy }] });
    isTouch = wasTouch;
  });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); onTouchStart(e); }, { passive: false });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); onTouchMove(e); }, { passive: false });
  canvas.addEventListener('touchend', function (e) { onTouchEnd(e); }, { passive: false });
}


/* =========================================================
   8. 开局 / 结束
   ========================================================= */
// 屏幕常亮：手指按住摇杆不动几秒，手机会先"预暗"准备息屏 —— 玩家看到的就是"屏幕时不时暗一下"。
// 只在开局设一次不够：看完广告、切后台回来设置就失效了，所以启动、开局、回前台都补一次。
// 结果记在 KEEP 里，主界面体检行能看到（✗ 就是没设上）
let KEEP = '';
function keepScreenOn() {
  if (!IS_MG || typeof MG.setKeepScreenOn !== 'function') return;
  try {
    MG.setKeepScreenOn({
      keepScreenOn: true,
      success: function () { KEEP = '✓'; },
      fail: function (e) { KEEP = '✗ ' + String((e && e.errMsg) || '').slice(0, 30); }
    });
  } catch (e) { KEEP = '✗ ' + String((e && e.message) || e).slice(0, 30); }
}

/* 振动：只给"手上该有感觉"的那几下。level：0 轻 · 1 中 · 2 重 · 3 长（死亡）。
   连斩一秒能砍五六刀，每刀都震就成了一直嗡嗡响、还费电 —— 所以两次振动至少隔 VIB_GAP 秒，
   连锁爆炸同一帧炸十个也只震一下；只有死亡那一下不受节流。
   type 是微信的强度参数，抖音文档没写明支持，不支持的平台会忽略它。
   结果记进 VIB，主界面体检行能看到（✗ 就是没震起来） */
const VIB_GAP = 0.09;
let VIB = '', vibLast = -1;
function canVibrate() { return IS_MG && typeof MG.vibrateShort === 'function'; }
function vibrate(level) {
  if (!meta.vib || !canVibrate()) return;
  const now = nowMs() / 1000;
  if (level < 3 && now - vibLast < VIB_GAP) return;
  vibLast = now;
  const ok = function () { VIB = '✓'; };
  const bad = function (e) { VIB = '✗ ' + String((e && e.errMsg) || '').slice(0, 30); };
  const t0 = nowMs();
  try {
    if (level >= 3 && typeof MG.vibrateLong === 'function') MG.vibrateLong({ success: ok, fail: bad });
    else MG.vibrateShort({ type: ['light', 'medium', 'heavy'][Math.min(level, 2)], success: ok, fail: bad });
  } catch (e) { bad({ errMsg: String((e && e.message) || e) }); }
  if (state === 'play') PT.snd += nowMs() - t0;
}

// 主界面左上角的振动开关（和右上角"余光"入口对称）
// 黑潮是主玩法、嘉欣糖商店开着时左上角让给商店（2.13 节），振动开关挪到右边（原来余光入口的地方）
function readyVibBtn() {
  return CFG.mainMode === 'horde' && shopOn() ? { x: W_CSS - 124, y: readyTopY(), w: 104, h: 46 } : { x: 20, y: readyTopY(), w: 104, h: 46 };
}
function toggleVib() {
  meta.vib = meta.vib ? 0 : 1;
  saveMeta();
  vibrate(1);                     // 打开时立刻震一下，玩家马上知道"有了"
}

function start() {
  state = 'play';
  recalcPowers();

  // 一局一分钟，别让屏幕自己暗下去
  keepScreenOn();
  P.x = WORLD / 2; P.y = WORLD / 2;   // 出生在环形世界的正中
  cam.x = P.x; cam.y = P.y;      // 镜头从出生点开始，别从上一局的残影飘过来
  camLap.x = 0; camLap.y = 0;
  P.px = P.x; P.py = P.y;
  P.vx = 0; P.vy = 0; P.cd = 0; P.dashT = 0; P.inv = 0; P.glideT = 0;
  P.ang = -Math.PI / 2; P.dx = 0; P.dy = -1;
  P.squash = 0;

  enemies.length = 0; parts.length = 0; ghosts.length = 0; floats.length = 0;
  stains.length = 0; rings.length = 0; trail.length = 0; turns.length = 0; cuts.length = 0; embers.length = 0;
  blasts.length = 0; shards.length = 0; armorBits.length = 0;
  viewDrain = 0; viewBoost = 0; reachGlow = 0; calmT = 0;
  inFog = null; coreNow = null; coreK = 0; tideT = -1e9;
  buildCrystals();

  score = 0; combo = 0; comboTimer = 0; bestCombo = 0;
  gameTime = 0; spawnTimer = 0.4;
  surviveT = 0; surviveAcc = 0; surviveGain = 0; survivePend = 0;
  autoTimer = 0; waveTimer = 0; waveWarnT = 0; waveDirs = [];
  shake = 0; hitstop = 0; hitSlow = 0; deadT = 0; lastHitT = -1e9;
  PERF.n = 0; PERF.worst = 0; PERF.t = 0; PERF.frames = 0; PERF.lay = {};
  for (const key in PT) PT[key] = 0;
  for (const key in PTF) delete PTF[key];
  for (const key in PTFL) delete PTFL[key];
  PTFI[0] = {}; PTFI[1] = {};
  testRunStart();
  runDeaths = []; runTut = !hordeMode && meta.tut < TUT_DONE; runGod = testGod();
  shield = POW.shieldLv > 0 ? 1 : 0; shieldT = 0; shieldFx = 0;
  qiCharge = 0; qiShown = 0; keptIdle = false; burstQ = [];
  reviveCount = 0; reviveT = 0; canRevive = false;
  runEcho = 0; echoDoubled = false;
  yingRun = 0; crystalsBroken = 0;
  echoAdLeft = 1;          // 每局给一次"看广告换余光"
  view = POW.viewBase; danger = 0; heartTimer = 0.6;
  whisperTimer = rand(8, 16);

  // 深度层与契约：每局重新起算
  layer = 1; layerBroke = false; layerFxT = 1.8; layerBestNew = false; scoutLeft = 0;
  lightL = 1; lightWarn = false; lightTickT = 0; runCandy = 0;
  lastDashEnd = -1e9; deathMark = null; deathInfo = null;
  buildTrail();        // 第 1 层的糖路：从出生点开始
  runKills = 0; contractDone = false; contractFx = 0;
  contractReward = 0; unlockNew = [];
  contract = CONTRACTS[Math.floor(Math.random() * CONTRACTS.length)];
  fbReset();
  cardReset();         // 刀诀：每局从零开始
  // 教学从上次断掉的那一步接着教（教完了就什么都不做）。放最后：它要往摆好的场上放怪。
  // 黑潮试玩不教：也不把存档记成"教过了"
  if (hordeMode) { tutStep = TUT_DONE; tutOut = false; tutFinT = 0; }
  else tutReset();

  S.init();        // 必须有交互才能出声
  S.setBgm(0);     // 开局从最薄的一档起，越连越厚
  S.heartStart();
  S.bgmStart();
}

// 撞死的那一下：记下凶手（死亡页圈红）和细节（测试数据）
function markDeath(e) {
  const dx = wdelta(P.x - e.x), dy = wdelta(P.y - e.y), d = Math.hypot(dx, dy) || 1;
  deathMark = { x: e.x, y: e.y, r: e.r, ux: dx / d, uy: dy / d, blast: false };
  deathInfo = [Math.round((gameTime - lastDashEnd) * 1000), Math.round((e.litT || 0) * 1000)];
}

function die(by) {
  if (state !== 'play') return;
  if (hordeMode && hTutOn()) { deathMark = null; deathInfo = null; return; }   // 新手教程里不掉命（2.14 节）
  if (hordeMode && hLives > 1 && !testGod()) { hLoseLife(by); return; }   // 黑潮：还有命就只掉一条
  // 测试用的无敌（测试数据页开关）：怎么撞都不死；光盾：这一下不死，盾替你碎
  if (testGod() || shield > 0) {
    deathMark = null; deathInfo = null;
    if (!testGod()) breakShield();
    return;
  }
  // 测试数据：死在谁手上；撞死 / 炸死的还记收刀后多少毫秒、凶手在亮处待了多久
  runDeaths.push([by || '?', layer, Math.floor(gameTime)].concat(deathInfo || []));
  deathInfo = null;
  state = 'dead';
  deadT = 0;
  shake = 26;
  hitstop = 0.1;
  vibrate(3);
  settleRun();

  // 复活窗口：不限次数。5 秒内不点就进结算，不逼着玩家看广告。
  // 黑潮试玩：不给复活，失败页直接再来；这一局记进测试数据
  canRevive = !hordeMode;
  reviveT = hordeMode ? 0 : 5;
  if (hordeMode) { hSettle(); runEcho = 0; contractReward = 0; testRecord(); hTestRec = CFG.testPanel ? TEST.runs[0] : null; }
  if (hordeMode) hEndStart();     // 黑潮：结算三页从哪一页起（能复活先问复活；升级送的宝箱结算完才知道）

  if (THEME.scream) S.scream(); else S.collapse();
  S.setTension(0);
  S.heartStop();
  S.setBgm(0);          // 回到最薄的一档，只剩底鼓和贝斯在撑，留一个"还能再来一次"的口子

  for (let i = 0; i < 48; i++) {
    const a = rand(0, Math.PI * 2), s = rand(60, 620);
    parts.push({
      x: P.x, y: P.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.4, 1.1), max: 1.1, r: rand(1.5, 4),
      c: i % 3 ? THEME.pA : THEME.pB
    });
  }
}
// 一局停下来那一刻就落账（死了、或者暂停里点「结束本局」）：连斩分入账，深度 / 最高连斩 / 解锁 / 最高分写进存档 ——
// 玩家直接杀进程也不会白打
function settleRun() {
  fbBankAll();
  if (hordeMode) return;     // 黑潮试玩的分数 / 连斩不算进现在这套玩法的纪录
  if (layer > meta.depthBest) { meta.depthBest = layer; layerBestNew = true; }
  if (bestCombo > meta.comboBest) meta.comboBest = bestCombo;
  checkMilestones();
  saveMeta();
  if (score > best) { best = score; Store.set('dash_best', best); }
}

/* ---------- 暂停 ----------
   局内左上角「Ⅱ」：游戏整个停住（世界不走、音乐停），弹「继续」/「结束本局」。
   结束本局 = 直接进结算，这一局照常记分、记余光、记测试数据（死因"主动结束"）。
   切后台也自动停在这里 —— 回来不会一睁眼就被撞死。测试无敌时这是唯一的收尾方式 */
function hudPauseBtn() { return { x: 12, y: hudTop() + 88, w: 44, h: 30 }; }
function pauseLayout() {
  const w = Math.min(240, W_CSS - 80), x = (W_CSS - w) / 2, y = H_CSS * 0.46;
  return { go: { x: x, y: y, w: w, h: 54 }, end: { x: x, y: y + 70, w: w, h: 46 } };
}
function pauseGame() {
  if (state !== 'play') return;
  state = 'pause';
  resetInput();
  S.bgmStop();
}
function resumeGame() {
  if (state !== 'pause') return;
  state = 'play';
  last = 0;                 // 停了多久都不算进下一帧
  P.inv = Math.max(P.inv, 0.6);   // 回来先给一口气，手指还没放回去
  S.bgmStart();
}
function endRunFromPause() {
  if (state !== 'pause') return;
  runDeaths.push(['主动结束', layer, Math.floor(gameTime)]);
  if (laneMode) { lSettle(); toReady(); S.bgmStart(); return; }     // 横屏跑酷：退出就回主界面（这局照常记）
  if (hordeMode) { fbBankAll(); hSettle(); runEcho = 0; contractReward = 0; testRecord(); toReady(); S.bgmStart(); return; }   // 黑潮试玩：退出就回主界面
  state = 'dead';
  settleRun();
  S.heartStop();
  S.setTension(0);
  S.setBgm(0);
  finishRun();
  S.bgmStart();
}
function pauseTap(t) {
  const L = pauseLayout();
  if (inRect(t, L.go)) { resumeGame(); return; }
  if (inRect(t, L.end)) endRunFromPause();
}
// 暂停键是死的：画成贴图，每帧一笔（按钮本身渐变 + 描边 + 两竖要五六笔）
function drawHudPause() {
  const b = hudPauseBtn();
  const paint = function () {
    drawButton(b, '', { kind: 'ghost', size: 12 });
    ctx.fillStyle = 'rgba(214,236,242,0.75)';
    ctx.fillRect(b.x + b.w / 2 - 6, b.y + 9, 4, 12);
    ctx.fillRect(b.x + b.w / 2 + 2, b.y + 9, 4, 12);
  };
  const spr = textSprite('pause', b.x + '|' + b.y + '|' + b.w + '|' + b.h, b.w + 8, b.h + 8, function () {
    ctx.translate(4 - b.x, 4 - b.y);
    paint();
  });
  if (spr) ctx.drawImage(spr, b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  else paint();
}
function drawPause() {
  ctx.fillStyle = 'rgba(4,6,9,0.82)';     // 压暗一点：定住的头顶大字别和"暂停"叠在一起
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  const L = pauseLayout(), cx = W_CSS / 2;
  ctx.textAlign = 'center';
  uf(900, 30);
  ctx.fillStyle = '#ffffff';
  spaced('暂停', cx, L.go.y - 64, 12, 'center');
  uf(600, 12);
  ctx.fillStyle = 'rgba(191,246,255,0.6)';
  ctx.fillText(laneMode ? '跑了 ' + lMeters() + ' 米 · ' + score + ' 分' + (combo > 1 ? ' · 连斩 ×' + combo : '') : hordeMode ? '逃了 ' + Math.floor(hTop / HD.m) + ' 米 · 第 ' + hWave + ' 波 · ' + score + ' 分'
    : '第 ' + layer + ' 层 · 活 ' + Math.floor(gameTime) + ' 秒 · ' + score + ' 分' + (combo > 1 ? ' · 连斩 ×' + combo : ''), cx, L.go.y - 30);
  drawButton(L.go, '继 续', { kind: 'primary', size: 19, weight: 900, glow: UI.cyan });
  drawButton(L.end, '结束本局', { kind: 'ghost', size: 15 });
  uf(500, 11);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('结束本局 = 直接结算，这一局照常记分', cx, L.end.y + L.end.h + 22);
  if (testGod()) { ctx.fillStyle = 'rgba(255,209,102,0.8)'; ctx.fillText('测试无敌中', cx, L.end.y + L.end.h + 40); }
  // 黑潮：三个任务做到哪了（2.15 节）
  if (hordeMode) {
    const cw = Math.min(330, W_CSS - 32), qy = L.end.y + L.end.h + (testGod() ? 56 : 40);
    if (qy + 100 < H_CSS - SAFE_BOTTOM) drawQuestCard(cx - cw / 2, qy, cw, H_CSS < 720 ? 19 : 21);
  }
}

/* ---------------- 复活 ----------------
   这是整个变现模型里最值钱的一下：玩家刚积累了几十连击和一大片光，
   死亡那一刻损失最大。所以只保留 50% 连击 —— 全保留的话死亡就没有代价，
   难度设计会全部作废。

   复活次数不设上限（可以一直看广告一直回来），代价改由两件事承担：
   ① 连击每次折半：40 → 20 → 10 → 5，反复复活到后面已经是白板；
   ② 无敌时间逐次收紧：2.5s → 2.1 → 1.7 → 1.3 → 1.1s 保底，
      免得"回来就站桩"变成免费护盾，越往后回来要越快站稳。 */
function doRevive() {
  reviveCount++;
  canRevive = false;
  reviveT = 0;

  state = 'play';
  deadT = 0;
  S.heartStart();

  combo = Math.max(1, Math.floor(combo * 0.5));
  comboTimer = POW.comboWindow;
  FB.tier = tierOf(combo);        // 折半后的段位悄悄落回去，不再放一次升段

  P.inv = Math.max(1.1, 2.5 - 0.4 * (reviveCount - 1));
  P.cd = 0;
  P.dashT = 0;

  // 清场：只清 280 内的，远处的保留（不然复活后立刻又空场，节奏断掉）
  const R = 280;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (wdist(e.x, e.y, P.x, P.y) > R + e.r) continue;
    for (let k = 0; k < 6; k++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 320);
      parts.push({
        x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.2, 0.5), max: 0.5, r: rand(1.2, 3), c: THEME.pA
      });
    }
    enemies.splice(i, 1);
  }

  // 看广告复活送一面光盾：没学光盾的也送；碎了再不再生照旧只看技能（POW.shieldRe）
  shield = 1; shieldT = 0; shieldFx = 1;
  lightL = 1; lightWarn = false;          // 光也补满（光灭了死的，回来不能马上又灭）
  deathMark = null;

  rings.push({ x: P.x, y: P.y, r0: 14, r1: R, life: 0.55, max: 0.55, color: '#ffffff', w: 5 });
  floats.push({ x: P.x, y: P.y - 50, text: '嘉豪归来', life: 1.2, max: 1.2, size: 26 });
  floats.push({ x: P.x, y: P.y - 22, text: '送你一面光盾', life: 1.2, max: 1.2, size: 18, c: '#ffd166' });
  shake = 26;
  S.hit(3);
  vibrate(2);
}

/* ---------------- 结算 ----------------
   余光只来自晶柱：分数不参与换算。最高分记的是 score，花余光不会影响它。 */
function finishRun() {
  if (state === 'over') return;
  state = 'over';
  overT = 0;

  // 契约奖励单独记一笔，和晶柱余光分开，玩家才分得清钱从哪来
  contractReward = (contractDone && contract) ? contract.reward : 0;
  runEcho = yingRun;        // 本局取到的余光原样入账
  echoDoubled = false;

  meta.pts += runEcho + contractReward;
  meta.total += score;      // "累计"记的是分数，不是余光
  meta.runs += 1;
  saveMeta();

  if (score > best) { best = score; Store.set('dash_best', best); }
  testRecord();
}

/* 结算页 → 主界面。
   只清场，不记分：这一局的余光在 finishRun 里已经入账了，回去再点一下就是新的一局。
   把尸体、碎屑、晶柱一起收干净 —— 标题页是 72% 的蒙版，不清理的话
   上一局的残骸会在"斩"字后面若隐若现。 */
function toReady() {
  state = 'ready';
  resetInput();
  talk = null;
  hordeMode = false; horde.length = 0; hBurst = null;
  laneMode = false; lObs.length = 0; lFx.length = 0; lFloat.length = 0;

  enemies.length = 0; parts.length = 0; ghosts.length = 0; floats.length = 0;
  stains.length = 0; rings.length = 0; trail.length = 0; turns.length = 0; cuts.length = 0; embers.length = 0;
  blasts.length = 0; shards.length = 0; armorBits.length = 0;
  viewDrain = 0; viewBoost = 0; reachGlow = 0; calmT = 0;
  inFog = null; coreNow = null; coreK = 0; tideT = -1e9;
  view = POW.viewBase; danger = 0;
  buildCrystals();

  P.x = WORLD / 2; P.y = WORLD / 2;   // 出生在环形世界的正中
  cam.x = P.x; cam.y = P.y;
  camLap.x = 0; camLap.y = 0;
  P.vx = 0; P.vy = 0; P.dashT = 0; P.inv = 0; P.cd = 0; P.glideT = 0;
  P.ang = -Math.PI / 2; P.dx = 0; P.dy = -1; P.squash = 0;

  score = 0; combo = 0; comboTimer = 0;
  gameTime = 0; spawnTimer = 1e6;   // 标题页不刷怪
  surviveT = 0; surviveAcc = 0; surviveGain = 0; survivePend = 0;
  waveTimer = 0; waveWarnT = 0; waveDirs = [];
  shake = 0; hitstop = 0; hitSlow = 0; deadT = 0; overT = 0; lastHitT = -1e9;

  layer = 1; layerBroke = false; layerFxT = 0; layerBestNew = false; scoutLeft = 0;
  lightL = 1; lightWarn = false; candies = []; door = null; deathMark = null;
  runKills = 0; contract = null; contractDone = false; contractFx = 0;
  contractReward = 0; unlockNew = [];
  fbReset();
  cardReset();

  S.setBgm(0);
}

/* 激励视频入口。真机有广告位就走真实广告，否则走 3 秒占位。
   注意：真实广告的奖励只在 onClose 的 isEnded 为真时发放。 */
function startAd(action) {
  testAd(action, 0);
  adHome = (state === 'dead') ? 'dead' : state;   // 从强化页进来的，看完要回强化页
  adAction = action;
  adT = 3;
  adWatch = 0;
  state = 'ad';
  adMode = 'placeholder';
  S.bgmStop();          // 广告有自己的声音，别叠在一起

  const unit = adUnitFor(action);
  if (canUseRealAd() && unit) {
    const o = ensureAdObj(unit);
    if (o) {
      adMode = 'real';
      adWatch = 6;                       // 6 秒还没弹出来就放弃，别把玩家卡住
      try {
        const p = o.show();
        if (p && p.then) {
          p.then(function () { adWatch = 0; })
           .catch(function () {
             // 首次 show 失败通常是没有预加载，补一次 load 再试
             const q = o.load();
             if (q && q.then) {
               q.then(function () { adWatch = 6; return o.show(); })
                .then(function () { adWatch = 0; })
                .catch(function () { endAd(false); });
             } else endAd(false);
           });
        } else adWatch = 0;
      } catch (e) { endAd(false); }
    }
  }
}

/* rewarded=false 表示没看完 / 拉不到广告：不发奖励，退回原界面 */
function endAd(rewarded) {
  if (state !== 'ad') return;

  adMode = 'idle';
  adWatch = 0;
  adT = 0;

  const act = adAction;
  adAction = null;
  testAd(act, rewarded ? 1 : 2);

  if (!rewarded) {
    state = adHome;
    if (state === 'dead' && hordeMode && hEnd === 'revive') hEndAt = deadT - H_END.reviveT + 3;   // 复活页：再给 3 秒
    if (state === 'preAd') preAdAt = nowMs();                                                     // 开局前那一页：重新数 5 秒
    // 广告没看成不是玩家的错，给回一次重试窗口
    if (state === 'dead' && canRevive) reviveT = Math.max(reviveT, 2);
    S.bgmStart();
    return;
  }

  if (act === 'revive') { if (laneMode) lRevive(); else if (hordeMode) hRevive(); else doRevive(); }
  else if (act === 'double') {
    if (!echoDoubled) {
      meta.pts += runEcho;
      saveMeta();
      echoDoubled = true;
    }
    state = 'over';
  } else if (act === 'echo') {
    // 直接换余光：一局一次，防止无限刷
    if (echoAdLeft > 0) {
      echoAdLeft--;
      meta.pts += ECHO_AD;
      saveMeta();
    }
    state = adHome;
  } else if (act === 'prop') openPropPick();      // 看完了：三个道具挑一个再开局（2.13 节）
  else if (act === 'skin') { heroSkinAdDone(); state = adHome; }   // 看完一次：这款皮肤的广告进度 +1（2.13 节）
  else if (act === 'box') { state = adHome; bxAdDone(); }          // 看完：宝箱十连（2.16 节）
  else state = adHome;

  S.bgmStart();
}

// 浏览器预览用：按 Enter 跳过占位广告
function finishAd() { endAd(true); }

/* =========================================================
   9. 冲刺
   ========================================================= */
function tryDash(target) {
  if (state !== 'play' || P.cd > 0 || P.dashT > 0) return;

  // 方向一律走 wdelta：目标在地图边界另一侧时，直接相减会朝反方向冲出去
  let dx, dy, aimed = false;       // aimed：这一刀有目标（斩到就停）；空挥照旧冲满
  if (target) {
    dx = wdelta(target.x - P.x); dy = wdelta(target.y - P.y); aimed = true;
  } else {
    const d = inputDir();
    // 推着摇杆点斩：那个方向上够得着的怪就对准它砍，没有就照摇杆方向冲
    const e0 = d ? lockOn(d) : null;
    if (e0) { dx = wdelta(e0.x - P.x); dy = wdelta(e0.y - P.y); aimed = true; target = e0; }
    else if (d) { dx = d.x; dy = d.y; }
    else if (CFG.autoAim) {
      const e = nearestEnemy();
      if (e) { dx = wdelta(e.x - P.x); dy = wdelta(e.y - P.y); aimed = true; target = e; }
      else { dx = P.dx; dy = P.dy; }
    } else { dx = P.dx; dy = P.dy; }
  }

  let len = Math.hypot(dx, dy);
  if (len < 0.001) { dx = P.dx; dy = P.dy; len = 1; }

  // 连斩急转：上一刀的余速还在时换方向，原地留一道转身刀弧 + 顺着惯性甩出去的火花。
  // 身体朝向不再一帧掰过去，而是在冲刺里 ~50ms 转到位（见 update 里的冲刺段）。
  // 刀路本身仍是直线：判定、距离、手感数值一点没变，只是"看起来是转过去的"
  const vSp = Math.hypot(P.vx, P.vy);
  if (vSp > CFG.maxSpeed * 0.8) {
    const a0 = Math.atan2(P.vy, P.vx), a1 = Math.atan2(dy, dx);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > 0.5) {
      const k = Math.abs(da) / Math.PI;
      turns.push({ x: P.x, y: P.y, a0: a0, da: da, life: 0.2, max: 0.2 });
      for (let i = 0, n = 4 + Math.round(k * 6); i < n; i++) {
        const a = a0 + rand(-0.45, 0.45), s = rand(180, 460);
        parts.push({
          x: P.x, y: P.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rand(0.12, 0.28), max: 0.28, r: rand(0.8, 1.8),
          c: i % 2 ? THEME.playerCore : heroColor()
        });
      }
    }
  }

  P.dx = dx / len; P.dy = dy / len;
  if (vSp <= CFG.maxSpeed * 0.8) P.ang = Math.atan2(P.dy, P.dx);   // 从走路起手的第一刀照旧直接对准
  P.dashT = CFG.dashTime;
  // 斩到就停：锁了目标的只冲到它身后一点（最多照旧一刀的长度 L0，远处的怪不会一刀够到）；
  // 爆裂者要穿过去冲到爆炸圈外，没裂的重型要穿过它的身子 —— 这两种为了不停在危险里，可以比 L0 多走一点
  P.dashRef = aimed && target ? (target.ref || (enemies.indexOf(target) >= 0 ? target : null)) : null;
  const tb = target && target.bomb, th = target && target.heavy && !target.cracked;
  const L0 = POW.dashSpeed * CFG.dashTime * 0.7 * (layerFeat() === 'slip' ? CFG.lf.slipDash : 1);
  P.dashLeft = !aimed ? Infinity : (tb || th) ? Math.min(L0 + CFG.dashOver, len + (tb ? CFG.bombR + CFG.bombFollow : (target.r || 24) + P.r + CFG.heavyFollow))
    : Math.min(L0, len + CFG.dashFollow);
  // 落点在快炸的圈里：顺着这一刀的方向冲出圈再停
  if (P.dashLeft < Infinity) {
    const ux = dx / len, uy = dy / len;
    for (let g = 0; g < 3; g++) {
      const b = inBlast(P.x + ux * P.dashLeft, P.y + uy * P.dashLeft, P.r + 8);
      if (!b) break;
      const bx = wdelta(b.x - P.x), by = wdelta(b.y - P.y), tc = bx * ux + by * uy;   // 圈心在这条线上的投影
      const h2 = (b.r + P.r + 8) * (b.r + P.r + 8) - (bx * bx + by * by - tc * tc);
      P.dashLeft = Math.min(L0 + CFG.dashOver, Math.max(P.dashLeft, tc + Math.sqrt(Math.max(0, h2)) + 4));
    }
  }
  dashSeq++;
  P.inv = CFG.dashTime + 0.1 + POW.invBonus;
  P.cd = POW.dashCd;
  P.squash = 1;
  tutDashed++;          // 教程第二步只认"他真按了斩"，不认读秒

  if (!hordeMode) shake = Math.min(shake + 5, 16);   // 黑潮：出刀不震屏（一秒好几刀，一直抖像掉帧）
  S.whoosh();

  for (let i = 0; i < 8; i++) {
    const a = Math.atan2(-P.dy, -P.dx) + rand(-0.7, 0.7), s = rand(80, 320);
    parts.push({
      x: P.x, y: P.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.15, 0.35), max: 0.35, r: rand(1, 2.6), c: heroColor()
    });
  }
}


/* =========================================================
   10. 敌人
   ========================================================= */
// 刷怪距离：在玩家周围"刚好在光外"的一圈。
// 距离随游戏时间收紧：开局 1.55 倍视野（走过来要 3 秒），后期 1.25 倍。
function spawnDist() {
  const near = 1.55 - Math.min(0.30, gameTime * 0.006);
  return view * (near + rand(0, 0.2));
}

// px/py 可选：合围波需要把敌人直接放到指定方向
function spawnEnemy(px, py, force) {
  if (enemies.length >= CFG.maxEnemies) return;

  // 出什么怪由"当前第几层"决定，不再看秒数。
  // force 给前哨用：进层时强行指定一只本层新怪，让玩家一定见得到。
  const W = layerCfg(layer).w;
  let charger, heavy, bomb, watch;
  if (force) {
    charger = force === 'charger';
    heavy   = force === 'heavy';
    bomb    = force === 'bomb';
    watch   = force === 'watch';
  } else {
    charger = Math.random() < (W.charger || 0);
    heavy   = !charger && Math.random() < (W.heavy || 0);
    bomb    = !charger && !heavy && Math.random() < (W.bomb || 0);
    watch   = !charger && !heavy && !bomb && Math.random() < (W.watch || 0);
  }

  const r  = charger ? 12 : (heavy ? rand(20, 26) : (bomb ? rand(16, 20) : (watch ? rand(15, 19) : rand(10, 15))));
  let sp = Math.min(90 + gameTime * 4.6, 285) * rand(0.85, 1.15) * (heavy ? 0.62 : 1);
  if (bomb) sp *= 0.78;      // 走得慢，才来得及被看清
  if (watch) sp *= 0.55;

  let x = 0, y = 0;
  if (px !== undefined) {
    x = px; y = py;
  } else {
    // 世界没有边界，所以不再夹回屏幕内 —— 怪永远从你四周的光外冒出来。
    // 走着的时候正面左右 frontDeg 度以内不刷：角度只在剩下那一圈里抽，给玩家留出拉扯的空间
    const minD = view * 1.15, h = headingDir(), half = CFG.frontDeg * Math.PI / 180;
    const ha = h ? Math.atan2(h.y, h.x) : 0;
    for (let k = 0; k < 8; k++) {
      const a = h ? ha + half + rand(0, Math.PI * 2 - 2 * half) : rand(0, Math.PI * 2);
      const d = spawnDist();
      x = P.x + Math.cos(a) * d;
      y = P.y + Math.sin(a) * d;
      if (Math.hypot(x - P.x, y - P.y) >= minD) break;
    }
  }

  const e = {
    x: wwrap(x), y: wwrap(y), vx: 0, vy: 0, r: r, sp: sp,
    heavy: heavy, charger: charger, bomb: bomb, watch: watch,
    hp: heavy ? 2 : 1, cracked: false, armorT: 0, crackT: 0,
    mode: 'walk', t: 0, cdx: 0, cdy: 0,
    score: charger ? 2 : (heavy ? 3 : (bomb || watch ? 2 : 1)),
    wob: rand(0, 6.28), born: 0,
    scout: 0,                      // >0 表示这是"本层新怪"的讲解员，头顶带标记
    stun: 0, gx: 0, gy: 0          // 刀诀「围观」：看呆还剩几秒、往哪儿凑
  };
  enemies.push(e);
  return e;
}

/* ---------------- 合围波 ----------------
   先把方向定下来，屏幕边缘亮 0.9 秒，然后才真的生成。
   预警比敌人本身重要：玩家要能提前决定"往哪边突"。 */
function startWaveWarn() {
  const n = 4 + Math.min(3, Math.floor(gameTime / 45));   // 4 → 7 个方向
  const base = rand(0, Math.PI * 2);
  waveDirs = [];
  for (let i = 0; i < n; i++) waveDirs.push(base + (i / n) * Math.PI * 2);
  waveWarnT = CFG.waveWarn;
  S.whoosh();
}

function spawnWave() {
  const h = headingDir();
  for (let i = 0; i < waveDirs.length; i++) {
    const a = waveDirs[i];
    // 落在正面的那几路推到远处，给正在跑的玩家留出拉扯空间
    const R = view * (h && inCone(h, Math.cos(a), Math.sin(a), CFG.frontDeg) ? CFG.frontFar : 1.5);
    for (let k = 0; k < 2; k++) {
      spawnEnemy(P.x + Math.cos(a) * R + rand(-26, 26),
                 P.y + Math.sin(a) * R + rand(-26, 26));
    }
  }
  waveDirs = [];
  waveWarnT = 0;
  shake = Math.min(shake + 8, 20);
}

/* 裂甲：第一刀劈在重型的壳上。
   刻意什么都不给 —— 不加分、不断连、不返冲刺。这一刀是亏的，
   而亏的这一刀，就是玩家从"无限连"里被拽出来的一拍。 */
function crackEnemy(e) {
  e.cracked = true;
  if (hordeMode && !hBurst) hqAdd('heavy');     // 任务：劈开重型（2.15 节）
  e.armorT = CFG.armorT;
  P.cd = 0;                     // 砍开外壳也算砍中：冷却清零，马上能接下一刀或者跑开（以前要干等 0.5 秒，常被撞死）
  e.crackT = 0.22;              // 裂开瞬间的亮，之后慢慢熄下去

  // 击退：被劈中但没死，它退开一点，也给你留出反应空间
  const dx = e.x - P.x, dy = e.y - P.y;
  const d = Math.hypot(dx, dy) || 1;
  e.x += dx / d * 30;
  e.y += dy / d * 30;

  // 甲环炸成六块甲片：向外翻着飞散。环没了 = 这一刀真的吃进去了。
  const spin = e.wob * 0.22;
  for (let k = 0; k < 6; k++) {
    const a = spin + (k / 6) * Math.PI * 2 + 0.43;   // 从每块甲片的中点出发
    const out = rand(120, 230), side = rand(-55, 55);
    armorBits.push({
      x: e.x + Math.cos(a) * e.r * 1.62,
      y: e.y + Math.sin(a) * e.r * 1.62,
      vx: Math.cos(a) * out + Math.cos(a + Math.PI / 2) * side,
      vy: Math.sin(a) * out + Math.sin(a + Math.PI / 2) * side,
      rot: a - 0.43, arc: 0.86,
      spin: (k % 2 === 0 ? 1 : -1) * rand(2.4, 5.2),
      r: e.r * 1.62,
      life: rand(0.34, 0.5), max: 0.5
    });
  }
  for (let k = 0; k < 8; k++) {
    const a = rand(0, Math.PI * 2), s = rand(90, 300);
    parts.push({
      x: e.x + Math.cos(a) * e.r * 1.35, y: e.y + Math.sin(a) * e.r * 1.35,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.18, 0.36), max: 0.36,
      r: rand(1.2, 2.6), c: THEME.pHeavy
    });
  }

  shake = Math.min(shake + 5, 20);
  rings.push({
    x: e.x, y: e.y, r0: e.r * 0.7, r1: e.r * 2.4,
    life: 0.25, max: 0.25,
    color: THEME.enemyEdgeHeavy, w: 3
  });
  S.hit(1);
  vibrate(1);                     // 破甲：刀被弹了一下，手上要"铛"一声
}

/* ---------------- 技能动作 ---------------- */
// 光盾碎：不死，0.9 秒无敌，身边的怪被推开一圈；满级时再放一圈震波
function breakShield() {
  shield = 0;
  shieldT = POW.shieldRe;
  shieldFx = 1;
  P.inv = Math.max(P.inv, 0.9);
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const dx = wdelta(e.x - P.x), dy = wdelta(e.y - P.y);
    const d = Math.hypot(dx, dy) || 1;
    if (d < 150) { e.x = wwrap(e.x + dx / d * (150 - d)); e.y = wwrap(e.y + dy / d * (150 - d)); }
  }
  if (POW.shieldBoom) burstQ.push({ r: 170, src: 'shield' });
  rings.push({ x: P.x, y: P.y, r0: 20, r1: 210, life: 0.6, max: 0.6, color: '#ffd166', w: 6 });
  for (let k = 0; k < 24; k++) {
    const a = rand(0, Math.PI * 2), sp = rand(160, 520);
    parts.push({ x: P.x, y: P.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                 life: rand(0.3, 0.7), max: 0.7, r: rand(1.5, 3.5), c: k % 3 ? '#ffd166' : '#ffffff' });
  }
  callout('光盾碎了', '#ffd166', 54, 112);
  shake = Math.min(shake + 18, 28);
  hitPause(0.08);
  S.shatter();
  vibrate(2);
}

function regrowShield() {
  shield = 1;
  shieldT = 0;
  shieldFx = 1;
  rings.push({ x: P.x, y: P.y, r0: 60, r1: 24, life: 0.45, max: 0.45, color: '#ffd166', w: 3 });
  floats.push({ x: P.x, y: P.y - 46, text: '光盾 再生', life: 1.1, max: 1.1, size: 22, c: '#ffd166' });
  S.upgrade();
}

// 剑气 / 光盾震波：以主角为圆心一圈杀过去。重型的甲先裂（和爆炸一样），爆裂者照样留引信 —— 会连锁
function releaseBurst(b) {
  const qi = b.src === 'qi';
  const c = qi ? (FB.tier >= 0 ? tierColor(FB.tier) : '#bff6ff') : '#ffd166';
  rings.push({ x: P.x, y: P.y, r0: 24, r1: b.r * 1.08, life: 0.38, max: 0.38, color: c, w: 7 });
  rings.push({ x: P.x, y: P.y, r0: 10, r1: b.r * 0.7, life: 0.26, max: 0.26, color: '#ffffff', w: 3 });
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2 + rand(-0.1, 0.1), sp = b.r * rand(2.6, 3.6);
    parts.push({ x: P.x, y: P.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                 life: rand(0.2, 0.4), max: 0.4, r: rand(1.2, 2.8), c: k % 4 ? c : '#ffffff' });
  }
  if (qi && qiShown < 3) { qiShown++; callout('剑气', c, 46, 150); }
  shake = Math.min(shake + 12, 26);
  hitPause(0.05);
  S.whoosh();
  vibrate(1);
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (wdist(e.x, e.y, P.x, P.y) > b.r + e.r) continue;
    if (e.heavy && !e.cracked) { crackEnemy(e); continue; }
    killEnemy(j, b.src);
  }
}

/* 空场呼吸：最后一刀砍空、四周一时没怪时，进入 0.9 秒缓冲。
   不是放水，是给"高速连斩突然断掉"一个可读的休止符：
   短暂无敌 + 光临时撑开，下一波在贴脸之前就先被看见。 */
function checkCalm() {
  if (calmT > 0) return;
  let near = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const d = wdist(enemies[i].x, enemies[i].y, P.x, P.y);
    if (d < near) near = d;
    if (near < CFG.calmRange) return;
  }
  if (near < CFG.calmRange) return;

  calmT = CFG.calmT;
  P.inv = Math.max(P.inv, CFG.calmInv);
  rings.push({
    x: P.x, y: P.y, r0: 18, r1: view * 1.02,
    life: 0.75, max: 0.75, color: 'rgba(191,239,255,0.30)', w: 2
  });
}

// 顿帧：一串打击里只顿第一下（见 CFG.hitstopGap）。连着的接刀不顿，
// 打击感交给震屏、刀光、圆环和音效。顿 = 短暂慢放（CFG.hitSlowK），不冻帧；
// 死亡的顿帧不走这里，照冻
function hitPause(d) {
  if (gameTime - lastHitT >= CFG.hitstopGap) hitSlow = Math.max(hitSlow, d);
  lastHitT = gameTime;
}

// src：'qi' / 'shield' = 剑气或光盾震波杀的（不给剑气蓄力，不然一圈剑气就能无限连放）；
// 'blast' / 'shard' = 炸死 / 晶片割死的；刀诀的 id（'chain' 'disc' …）= 刀诀杀的。空 = 刀砍的
function killEnemy(i, src) {
  const e = enemies[i];
  enemies.splice(i, 1);
  if (hordeMode) hqKill(e, src);                // 任务（2.15 节）
  if (hordeMode && !src && !hBurst) hMomAdd(HD.momHit);   // 势头：刀砍中一只
  const byCard = !!(src && CARD_MAP[src]);      // 刀诀杀的：不给无敌帧（唱片一直在切，不然人一直无敌），震屏也轻一点

  // 险！：连斩快断的最后关头续上（窗口剩不到 CFG.clutch），这一刀多给半刀的分
  const clutch = combo >= 3 && comboTimer > 0 && comboTimer < CFG.clutch * POW.comboWindow;
  combo += 1;
  keptIdle = false;
  if (POW.qiEvery > 0 && src !== 'qi' && src !== 'shield' && ++qiCharge >= POW.qiEvery) {
    qiCharge = 0;
    burstQ.push({ r: POW.qiR, src: 'qi' });
  }
  if (combo > bestCombo) bestCombo = combo;
  comboTimer = POW.comboWindow;

  runKills += 1;
  meta.kills += 1;        // 累计斩杀：里程碑的进度来源（存档在结算时落盘）

  let gain = e.score * Math.min(combo, CFG.scoreCap);
  if (clutch) gain += Math.round(gain * CFG.clutchBonus);
  score += gain;
  fbKill(gain);
  if (clutch) callout('险！', '#ffd166', 46, 88);
  const lv = FB.tier + 1;          // 0 = 没段位；段位越高，下面的刀痕 / 刀环 / 碎屑越大越多

  P.cd = 0;                        // ★ 核心爽点：击杀立刻返还冲刺
  if (!byCard) P.inv = Math.max(P.inv, 0.06);
  // 黑潮：斩死不震屏（以前每只 +6 + 连斩 × 0.7，连斩上了几十每刀都抖满 24 —— 六成的帧画面在乱跳，看着像掉帧）。
  // 打击感交给刀痕、碎屑、慢放和声音；大事（掉命、连斩、爆炸、拿道具）照旧震
  if (!hordeMode) shake = Math.min(shake + (byCard ? 2 : 6 + combo * 0.7), 24);
  if (!byCard) hitPause(0.05);

  // 刀痕：顺着这一刀的方向；不是冲刺砍的（炸死 / 剑气）就随便一个角度
  cuts.push({ x: e.x, y: e.y, a: P.dashT > 0 || P.glideT > 0 ? Math.atan2(P.dy, P.dx) : rand(0, Math.PI * 2),
              len: e.r * 6 * (1 + 0.08 * lv), w: 1 + 0.12 * lv,
              c: e.heavy ? THEME.pHeavy : (hordeMode && heroSkin().light) || heroColor(), life: 0.24, max: 0.24 });
  if (cuts.length > 24) cuts.shift();

  // 打击反馈只发生在刀口附近，绝不整屏变色
  rings.push({
    x: e.x, y: e.y, r0: e.r * 0.6, r1: e.r * 3.6 * (1 + 0.1 * lv),
    life: 0.2, max: 0.2,
    color: e.heavy ? THEME.ringHeavy : (FB.tier >= 0 ? tierColor(FB.tier) : THEME.ring),   // 刀环跟着段位升温
    w: (e.heavy ? 4 : 2.6) + 0.35 * lv
  });

  S.hit(combo);
  vibrate(e.heavy ? 1 : 0);       // 每刀一下轻震（节流保证连斩不会嗡成一片），重型砍穿给中震

  stains.push({ x: e.x, y: e.y, r: e.r * rand(1.4, 2.4), life: THEME.stainLife, max: THEME.stainLife, a: rand(0, 6.28) });
  if (stains.length > 40) stains.shift();   // 地上最多 40 块

  const n = (e.heavy ? 22 : 12) + 2 * lv;
  for (let k = 0; k < n; k++) {
    const a = rand(0, Math.PI * 2), s = rand(70, 480 + 30 * lv);
    parts.push({
      x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.2, 0.6), max: 0.6,
      r: rand(1.2, e.heavy ? 4 : 3) * (1 + 0.06 * lv),
      c: k % 4 === 0 ? THEME.pB : (e.heavy ? THEME.pHeavy : (k % 2 ? foeColor(e) : heroColor()))
    });
  }
  if (parts.length > 360) parts.splice(0, parts.length - 360);   // 封顶：高段位连着砍穿一串也不至于堆出几百个

  // 黑潮试玩不冒"+N"：一路斩上去同时挂好几个，1024.1253 真机上"飘字"一帧 2~4 毫秒；分数看左上角就够
  if (!hordeMode) floats.push({ x: e.x, y: e.y, text: '+' + gain, life: 0.7, max: 0.7, size: 15 + Math.min(combo, 14),
                c: FB.tier >= 0 ? tierColor(FB.tier) : undefined });

  // 爆裂者：死了不算完，尸体留下一条 0.62 秒的引信。
  // 被你自己的冲击波 / 剑气（破门、光盾碎、剑气：src 'shield' / 'qi'）引爆的照样炸怪，但不伤你 ——
  // 那一下玩家根本没去砍它，炸死就是冤死
  if (e.bomb) blasts.push({ x: e.x, y: e.y, t: 0, fuse: hordeMode ? HD.bombFuse : CFG.bombFuse, r: hordeMode ? HD.bombR : CFG.bombR, safe: src === 'shield' || src === 'qi' });

  checkContract();     // 连击型 / 斩杀数型的契约在这里结算
  checkCalm();         // 杀完这一只之后场上是否空了 —— 空场就给一个呼吸窗口
  cardOnKill(e, src);  // 刀诀：刀砍的才触发连锁 / 余震 / 围观
}


/* ---------------- 爆裂者的引信 ----------------
   0.62 秒的预警圈，涨到满半径就炸。
   它惩罚的是"砍完停在原地"：连续斩本来会让你站着不动，
   现在每杀一只都得看一眼脚下，决定要不要挪半步。 */
function explodeBlast(b) {
  const R = b.r;

  shake = Math.min(shake + 20, 30);
  hitPause(0.07);
  rings.push({
    x: b.x, y: b.y, r0: R * 0.32, r1: R * 1.18,
    life: 0.28, max: 0.28, color: 'rgba(255,120,70,0.95)', w: 5
  });
  for (let k = 0; k < 26; k++) {
    const a = rand(0, Math.PI * 2), s = rand(160, 760);
    parts.push({
      x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.25, 0.7), max: 0.7, r: rand(1.6, 4.2),
      c: k % 3 === 0 ? THEME.pB : THEME.pHeavy
    });
  }
  S.hit(combo);
  vibrate(2);

  // 炸死范围内的敌人 —— 包括别的爆裂者，所以会连锁
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (wdist(e.x, e.y, b.x, b.y) > R + e.r) continue;
    if (e.heavy && !e.cracked) { crackEnemy(e); continue; }   // 甲能扛一发，但会裂
    killEnemy(j, 'blast');
  }
  if (hordeMode) hBlastHorde(b);       // 黑潮试玩：炸到黑潮，圈里的一起死

  // 玩家：冲刺和无敌帧可以穿过去，否则就是死
  if (!b.safe && P.inv <= 0 && P.dashT <= 0 && !tutOn() && !hTutOn() && wdist(P.x, P.y, b.x, b.y) < R + P.r) {
    deathMark = { x: b.x, y: b.y, r: R, ux: 0, uy: 0, blast: true };
    deathInfo = [Math.round((gameTime - lastDashEnd) * 1000), -1];
    die('爆炸');
  }
}


/* ---------------- 晶柱：可以斩碎的场景 ----------------
   场上固定几根，位置每局不同。斩中不给分，但会炸成碎片向外飞：
   碎片能杀敌，同时扬起的光尘让视野扩大 35%、持续 3.2 秒。
   它给了走位第一个战术理由 —— 把敌人引到柱子边上，一刀两得。 */
/* 晶柱的落点：一圈环带里随机，避开地图边缘和已有的柱子。
   开局那几根落在光里（玩家一上来就看得见、砍得到）；
   之后补的落在光外（想拿余光，就得提着刀走进黑里）。 */
function crystalSpot(minD, maxD) {
  for (let k = 0; k < 28; k++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(minD, maxD);
    const x = wwrap(P.x + Math.cos(a) * d);
    const y = wwrap(P.y + Math.sin(a) * d);
    let ok = true;
    for (let i = 0; i < crystals.length; i++) {
      if (wdist(x, y, crystals[i].x, crystals[i].y) < 175) { ok = false; break; }
    }
    if (ok) return { x: x, y: y };
  }
  return null;
}

function addCrystal(s, born) {
  crystals.push({
    x: s.x, y: s.y, r: rand(26, 38), spin: rand(0, 6.28),
    age: born ? 0 : 9,           // 0 = 刚长出来，画的时候按比例撑开
    ying: YING_CRYSTAL + POW.yingBonus      // 聚光：每根多给一点
  });
}

function buildCrystals() {
  crystals.length = 0;
  crystalTimer = POW.crystalRe;
  for (let i = 0; i < POW.crystalN; i++) {
    const s = crystalSpot(view * 0.55, view * 0.92);
    if (s) addCrystal(s, false);
  }
}

// 从光外的黑暗里长出一根新的。
// 场上空着的时候补得快一点（2.5 秒），否则就是"砍完三根，站着等十五秒"。
function spawnCrystal() {
  const wasEmpty = crystals.length === 0;
  const s = crystalSpot(view * CFG.crystalOutMin, view * CFG.crystalOutMax);
  crystalTimer = POW.crystalRe * (wasEmpty ? 0.5 : 1);
  if (!s) return false;
  addCrystal(s, true);
  rings.push({
    x: s.x, y: s.y, r0: 4, r1: 58,
    life: CFG.crystalGrow, max: CFG.crystalGrow,
    color: 'rgba(' + THEME.viewRing + ',0.5)', w: 1.6
  });
  return true;
}

function shatterCrystal(i) {
  const c = crystals[i];
  crystals.splice(i, 1);          // 碎掉的柱子等下一根从光外长出来
  P.cd = 0;                       // 砍碎晶柱也算砍中：冷却清零（以前要干等 0.5 秒，常被趁机撞死）

  // —— 唯一的余光来源 ——
  // 不进分数：分数是成绩，余光是货币，两条线分开，改难度才不会牵动经济。
  yingRun += c.ying;
  crystalsBroken += 1;
  fbCrystal(c);           // 一颗光点从柱子飞进 HUD 的余光，落地才加数
  vibrate(1);
  checkContract();        // 碎柱型契约在这里结算
  floats.push({
    x: c.x, y: c.y - c.r * 0.7, text: '余光 +' + c.ying,
    life: 1.1, max: 1.1, size: 21, c: '#bfefff'
  });

  // 场上空了就催快一点：下一根 2.5 秒内长出来，别让玩家干等
  if (crystals.length === 0) crystalTimer = Math.min(crystalTimer, POW.crystalRe * 0.5);

  const n = 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand(-0.18, 0.18);
    const s = rand(330, 520);
    shards.push({
      x: c.x, y: c.y, ang: a,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.42, max: 0.42, hits: 0
    });
  }

  viewBoost = Math.max(viewBoost, CFG.crystalLight);
  shake = Math.min(shake + 9, 22);
  hitPause(0.04);
  rings.push({
    x: c.x, y: c.y, r0: c.r * 0.5, r1: c.r * 5,
    life: 0.3, max: 0.3, color: 'rgba(' + THEME.viewRing + ',0.9)', w: 3
  });
  for (let k = 0; k < 16; k++) {
    const a = rand(0, Math.PI * 2), s = rand(90, 420);
    parts.push({
      x: c.x, y: c.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.3, 0.8), max: 0.8, r: rand(1.2, 3),
      c: k % 4 === 0 ? THEME.pB : 'rgb(' + THEME.viewRing + ')'
    });
  }
  S.whoosh();
}


/* =========================================================
   11. 更新
   ========================================================= */
// 进层：一次短促的仪式 —— 报层名、给 0.45 秒无敌、一圈白环。
// 不是奖励数值，是"你活到了这里"的确认。
// 破门：本层斩够了，进下一层。冲击波把身边的怪震碎（重型裂甲）、屏幕四周亮一圈光框、
// 按层数给余光（光点从主角身上飞进 HUD），然后走正常的进层流程（横幅、前哨、契约）
function breakLayer() {
  const n = layer + 1;
  layer = n; layerBroke = true;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (wdist(e.x, e.y, P.x, P.y) > CFG.breakR + e.r) continue;
    if (e.heavy && !e.cracked) { crackEnemy(e); continue; }
    if (e.heavy && e.armorT > 0) continue;
    killEnemy(i, 'shield');          // 'shield'：震死的不给剑气蓄力
  }
  const reward = 5 + 3 * n;
  yingRun += reward;
  const a = toScreen(P.x, P.y), b = hudYing();
  flyers.push({ kind: 'ying', v: reward, x0: a.x, y0: a.y - 20, x1: b.x, y1: b.y, t: 0, hold: 0.35, dur: 0.7 });
  FB.flash = 1; FB.flashC = '#bfefff'; FB.flashT = 4;
  rings.push({ x: P.x, y: P.y, r0: 30, r1: CFG.breakR * 1.4, life: 0.55, max: 0.55, color: '#ffffff', w: 6 });
  shake = Math.max(shake, 18);
  S.tierUp(6);
  onEnterLayer(n);
  lightL = Math.min(1, lightL + CFG.breakLight);   // 破门补一大截光
  buildTrail();                                     // 下一层的糖路从门这儿接着往前摆
  cardGate();                                       // 每破一扇门挑一张刀诀
}

// 每层特性，每帧一次：雾 / 光核的判定、潮流换向与推人、地缝喷发烧人烧怪
function tickFeats(dt) {
  const f = layerFeat(), L = CFG.lf;
  // 低语：主角在哪团雾里
  inFog = null;
  if (f === 'fog') {
    for (let gx = Math.floor((P.x - 220) / FOG_CELL); gx <= Math.floor((P.x + 220) / FOG_CELL) && !inFog; gx++) {
      for (let gy = Math.floor((P.y - 220) / FOG_CELL); gy <= Math.floor((P.y + 220) / FOG_CELL) && !inFog; gy++) {
        const b = fogOf(gx, gy);
        if (Math.hypot(P.x - b.x, P.y - b.y) < b.r * 0.85) inFog = b;
      }
    }
  }
  // 核心：站进光核攒补光（0.5 秒攒满），出来 2 秒退完；站着时顺手把守望者吸走的光补回来
  coreNow = null;
  if (f === 'core') {
    const cx = Math.floor(P.x / FOG_CELL) * FOG_CELL + FOG_CELL / 2, cy = Math.floor(P.y / FOG_CELL) * FOG_CELL + FOG_CELL / 2;
    if (Math.hypot(P.x - cx, P.y - cy) < L.coreR) coreNow = { x: cx, y: cy };
  }
  coreK = coreNow ? Math.min(1, coreK + dt * 2) : Math.max(0, coreK - dt * 0.5);
  // 黑潮：每 tideEvery 秒换个方向（转 90°~180°），人和怪都被推着走
  if (f === 'tide') {
    tideT -= dt;
    if (tideT <= 0) {
      if (tideT > -1e8) callout('潮向变了', '#82b9ff', 22, 70);
      tideT = L.tideEvery;
      tideA += (Math.random() < 0.5 ? -1 : 1) * rand(Math.PI / 2, Math.PI);
    }
    const ux = Math.cos(tideA) * L.tideSp * dt, uy = Math.sin(tideA) * L.tideSp * dt;
    P.x += ux; P.y += uy;
    for (let i = 0; i < enemies.length; i++) { enemies[i].x = wwrap(enemies[i].x + ux); enemies[i].y = wwrap(enemies[i].y + uy); }
  }
  // 裂隙：预警时缝里冒火星；喷发第一下火星冲天、离得近的震一下屏；
  // 喷发中的地缝烧掉压在上面的东西（冲刺中 / 刚收刀 / 无敌 / 教学期间的主角不烧）
  if (f === 'rift') {
    const cs = riftCracks();
    for (let c = 0; c < cs.length; c++) {
      const s0 = cs[c];
      if (s0.st === 'idle' || !riftInView(s0, 40)) continue;
      if (s0.st === 'warn') {
        if (Math.random() < dt * (4 + 16 * s0.k)) riftSpark(s0, rand(-15, 15), rand(-75, -30), rand(0.5, 0.9), '#ff8a3c');
        // 这一层第一次有地缝在身边发红：头顶报一句，告诉他红的那条要喷火
        if (!riftTold && riftNear(s0) < 260) { riftTold = true; callout('发红的地缝要喷火！', '#ff9a3c', 20, 70); }
      } else if (s0.st === 'burn' && s0.k * L.riftBurn < dt) {
        for (let i = 0; i < 16; i++) riftSpark(s0, rand(-70, 70), rand(-460, -220), rand(0.3, 0.55), i % 3 ? '#ffb347' : '#fff1c4');
        if (riftNear(s0) < 240) shake = Math.max(shake, 5);
      }
    }
    for (let c = 0; c < cs.length; c++) {
      const s0 = cs[c];
      if (s0.st !== 'burn') continue;
      const me = P.dashT <= 0 && P.glideT <= 0 && P.inv <= 0 && !tutOn();
      if (me && riftHits(s0, P.x, P.y, P.r)) { die('地缝火'); return; }
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (riftHits(s0, P.x + wdelta(e.x - P.x), P.y + wdelta(e.y - P.y), e.r)) {
          for (let k = 0; k < 6; k++) parts.push({ x: e.x, y: e.y, vx: rand(-120, 120), vy: rand(-220, -60), life: rand(0.3, 0.6), max: 0.6, r: rand(1.5, 3), c: '#ff9a3c' });
          killEnemy(i, 'shield');
        }
      }
    }
  }
}

// 主角附近（一屏内）每条地缝现在处在哪一段：idle / warn（预警 0~1）/ burn（喷发中）
function riftCracks() {
  const out = [];
  const R = Math.max(W, H) * 0.7;
  for (let tx = Math.floor((P.x - R) / TILE); tx <= Math.floor((P.x + R) / TILE); tx++) {
    for (let ty = Math.floor((P.y - R) / TILE); ty <= Math.floor((P.y + R) / TILE); ty++) {
      const cl = cracksOf(tx, ty, groundOf(layer).cracks || 3);
      for (let c = 0; c < cl.length; c++) {
        const L = CFG.lf, tc = ((gameTime / L.riftCycle + cl[c].ph) % 1) * L.riftCycle;
        const burnAt = L.riftCycle - L.riftBurn, warnAt = burnAt - L.riftWarn;
        // cool：刚喷完那一小会儿，缝还红着慢慢冷下来（只是画面，不烧）
        const st = tc >= burnAt ? 'burn' : (tc >= warnAt ? 'warn' : (tc < RIFT_COOL ? 'cool' : 'idle'));
        out.push({ pts: cl[c].pts, ox: tx * TILE, oy: ty * TILE, st: st,
          k: st === 'warn' ? (tc - warnAt) / L.riftWarn : (st === 'burn' ? (tc - burnAt) / L.riftBurn : (st === 'cool' ? tc / RIFT_COOL : 0)) });
      }
    }
  }
  return out;
}
const RIFT_COOL = 0.7;
let riftTold = false;           // 这一层报过"发红的地缝要喷火"没有
// 这条地缝在不在屏幕里（m：往外多算几分，火苗会往上窜）。riftCracks 按主角周围一大圈取缝，
// 手机竖屏上屏幕外的缝占了大半 —— 屏幕外的不画、不冒火星
function riftInView(c, m) {
  const p = c.pts, hw = W / 2 + m, hh = H / 2 + m;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let k = 0; k < p.length; k++) {
    const x = wdelta(c.ox + p[k][0] - cam.x), y = wdelta(c.oy + p[k][1] - cam.y);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 > -hw && x0 < hw && y1 > -hh && y0 < hh;
}
// 主角离这条地缝多近
function riftNear(c) {
  const p = c.pts; let d = 1e9;
  for (let k = 1; k < p.length; k++) d = Math.min(d, segDist(c.ox + p[k - 1][0], c.oy + p[k - 1][1], c.ox + p[k][0], c.oy + p[k][1], P.x, P.y));
  return d;
}
// 地缝上随便一点冒一颗火星
function riftSpark(c, vx, vy, life, col) {
  const p = c.pts, k = 1 + Math.floor(Math.random() * (p.length - 1)), u = Math.random();
  parts.push({ x: c.ox + p[k - 1][0] + (p[k][0] - p[k - 1][0]) * u, y: c.oy + p[k - 1][1] + (p[k][1] - p[k - 1][1]) * u,
    vx: vx, vy: vy, life: life, max: life, r: rand(1.2, 2.4), c: col });
}
function riftHot() { const a = riftCracks(); const o = []; for (let i = 0; i < a.length; i++) if (a[i].st === 'burn') o.push(a[i]); return o; }
function riftHits(c, x, y, r) {
  const p = c.pts;
  for (let k = 1; k < p.length; k++) {
    if (segDist(c.ox + p[k - 1][0], c.oy + p[k - 1][1], c.ox + p[k][0], c.oy + p[k][1], x, y) < CFG.lf.riftW + r) return true;
  }
  return false;
}

/* 裂隙的一条地缝，按阶段画（不用渐变 —— 抖音上每帧现建的渐变时有时无，见 CFG.veil）：
   · 预警：碰到就死的那条带子整条标红、越闪越急；缝里一根引线从两头往中间烧，烧到中间就喷；最后 0.4 秒冒小火苗
   · 喷发：带子烧亮，沿缝一排火苗（外红、中橙、芯白三层），第一下闪白
   · 冷却：带子和缝慢慢暗下去（不烧人，只是告诉你"刚喷过"） */
const RX = new Float32Array(8), RY = new Float32Array(8), RL = new Float32Array(8);
let RNX = 0, RNY = 0;
function riftLoad(c) {
  const p = c.pts;
  for (let k = 0; k < p.length; k++) {
    RX[k] = wdx(c.ox + p[k][0]); RY[k] = wdy(c.oy + p[k][1]);
    RL[k] = k ? RL[k - 1] + Math.hypot(RX[k] - RX[k - 1], RY[k] - RY[k - 1]) : 0;
  }
  return p.length;
}
// 第 k 个点的法线（前后两段平均，拐弯处按夹角放大，带子宽度不缩）
function riftNorm(k, n) {
  let x = 0, y = 0, sx = 0, sy = 0;
  if (k > 0) { const dx = RX[k] - RX[k - 1], dy = RY[k] - RY[k - 1], l = Math.hypot(dx, dy) || 1; sx = -dy / l; sy = dx / l; x += sx; y += sy; }
  if (k < n - 1) { const dx = RX[k + 1] - RX[k], dy = RY[k + 1] - RY[k], l = Math.hypot(dx, dy) || 1; sx = -dy / l; sy = dx / l; x += sx; y += sy; }
  const l = Math.hypot(x, y) || 1;
  x /= l; y /= l;
  const m = 1 / Math.max(0.6, x * sx + y * sy);
  RNX = x * m; RNY = y * m;
}
// 沿缝两边各 w 宽的带子（两头半圆），就是"压上去就烧"的范围
function riftBand(n, w) {
  ctx.beginPath();
  for (let k = 0; k < n; k++) { riftNorm(k, n); ctx.lineTo(RX[k] + RNX * w, RY[k] + RNY * w); }
  let a = Math.atan2(RY[n - 1] - RY[n - 2], RX[n - 1] - RX[n - 2]);
  ctx.arc(RX[n - 1], RY[n - 1], w, a + Math.PI / 2, a - Math.PI / 2, true);
  for (let k = n - 1; k >= 0; k--) { riftNorm(k, n); ctx.lineTo(RX[k] - RNX * w, RY[k] - RNY * w); }
  a = Math.atan2(RY[1] - RY[0], RX[1] - RX[0]);
  ctx.arc(RX[0], RY[0], w, a - Math.PI / 2, a + Math.PI / 2, true);
  ctx.closePath();
}
// 缝上 d0 ~ d1 这一截
function riftTrace(n, d0, d1) {
  ctx.beginPath();
  let on = false;
  for (let k = 1; k < n; k++) {
    const a = RL[k - 1], b = RL[k];
    if (b <= d0 || a >= d1 || b <= a) continue;
    const u0 = Math.max(0, (d0 - a) / (b - a)), u1 = Math.min(1, (d1 - a) / (b - a));
    if (!on) { ctx.moveTo(RX[k - 1] + (RX[k] - RX[k - 1]) * u0, RY[k - 1] + (RY[k] - RY[k - 1]) * u0); on = true; }
    ctx.lineTo(RX[k - 1] + (RX[k] - RX[k - 1]) * u1, RY[k - 1] + (RY[k] - RY[k - 1]) * u1);
  }
  ctx.stroke();
}
// 沿缝一排火苗的一层：这一层所有火苗攒成一条路径、一个颜色一笔填完。hk 整体高度（0~1），ws / hs 这一层的宽、高比例
function riftFlames(c, n, t, hk, ws, hs, col) {
  const seed = c.pts[0][0] * 0.013 + c.pts[0][1] * 0.007;
  // 屏幕外的火苗不画：一条缝常常一半在屏幕外，几条一起喷时路径点能上万（手机上一个点约 1 微秒）。火苗往上长，下边多留一截
  const vx0 = cam.x - W / 2 - 30, vx1 = cam.x + W / 2 + 30, vy0 = cam.y - H / 2 - 10, vy1 = cam.y + H / 2 + 80;
  ctx.beginPath();
  let k = 1;
  // 每 7 一苗，一高一矮交错，高的那排再随机高低 —— 连成一道火墙，不是一排锯齿
  for (let i = 0, d = 5; d < RL[n - 1] - 3; i++, d += 7) {
    while (k < n - 1 && RL[k] < d) k++;
    const u = (d - RL[k - 1]) / ((RL[k] - RL[k - 1]) || 1);
    const x = RX[k - 1] + (RX[k] - RX[k - 1]) * u, y = RY[k - 1] + (RY[k] - RY[k - 1]) * u;
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
    const r = Math.sin(i * 12.9898 + seed) * 43758.5453, rr = r - Math.floor(r);
    const tall = i % 2 ? 0.45 + 0.25 * rr : 0.55 + 0.45 * rr * rr;
    const h = 72 * tall * hk * (0.62 + 0.38 * Math.abs(Math.sin(t * (17 + 9 * rr) + i * 2.1))) * hs;
    const w = 9 * ws * (0.55 + 0.45 * Math.min(1, h / hs / 50)), sw = Math.sin(t * 11 + i * 1.3) * 7 * hs * tall;   // 矮的火苗也窄一点
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - w, y - h * 0.5, x + sw, y - h);
    ctx.quadraticCurveTo(x + w, y - h * 0.5, x + w, y);
    ctx.closePath();
  }
  ctx.fillStyle = col;
  ctx.fill();
}
// 沿缝一排火苗：外红、中橙、芯白三层，每层一笔 —— 一条缝三笔。
// （试过一苗贴一张小图：第 3 层一帧上百次贴图，手机上"本层特性"一项就 19.6ms）
function riftFire(c, n, t, hk, alpha) {
  riftFlames(c, n, t, hk, 1, 1, 'rgba(255,75,25,' + (0.82 * alpha).toFixed(3) + ')');
  riftFlames(c, n, t, hk, 0.62, 0.72, 'rgba(255,160,50,' + (0.9 * alpha).toFixed(3) + ')');
  riftFlames(c, n, t, hk, 0.26, 0.36, 'rgba(255,244,205,' + (0.85 * alpha).toFixed(3) + ')');   // 芯白一层压在最上面：细一点、矮一点，别连成一排白梳齿
}
function drawRift(c, t) {
  const n = riftLoad(c), W = CFG.lf.riftW, L = RL[n - 1];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (c.st === 'warn') {
    const k = c.k, lt = k * CFG.lf.riftWarn;
    const blink = 0.6 + 0.4 * (0.5 + 0.5 * Math.cos(Math.PI * 2 * lt * (2 + 5 * k)));   // 2 → 7 下/秒，越闪越急
    riftBand(n, W);
    ctx.fillStyle = 'rgba(255,50,20,' + ((0.24 + 0.24 * k) * blink).toFixed(3) + ')';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,110,60,' + ((0.6 + 0.4 * k) * blink).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,110,40,' + (0.25 + 0.4 * k).toFixed(3) + ')';
    ctx.lineWidth = 6;
    riftTrace(n, 0, L);
    // 引线：两头往中间烧，烧到中间就喷
    const d = k * L / 2;
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 3;
    riftTrace(n, 0, d);
    riftTrace(n, L - d, L);
    if (k > 0.6) {
      riftFire(c, n, t, (k - 0.6) / 0.4 * 0.3, 0.8);
    }
  } else if (c.st === 'burn') {
    const k = c.k, hk = k < 0.12 ? 0.4 + 0.6 * k / 0.12 : (k > 0.7 ? 1 - (k - 0.7) / 0.3 * 0.5 : 1);
    ctx.strokeStyle = 'rgba(255,80,20,0.2)';      // 一圈火光，远远就看得见哪条在烧
    ctx.lineWidth = W * 2 + 26;
    riftTrace(n, 0, L);
    riftBand(n, W);
    ctx.fillStyle = k < 0.15 ? 'rgba(255,235,200,' + (0.85 - 2.6 * k).toFixed(3) + ')' : 'rgba(255,95,30,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,110,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,160,60,0.6)';
    ctx.lineWidth = 10;
    riftTrace(n, 0, L);
    ctx.strokeStyle = '#fff0c8';
    ctx.lineWidth = 4;
    riftTrace(n, 0, L);
    riftFire(c, n, t, hk, 1);
  } else {
    const a = 1 - c.k;
    riftBand(n, W);
    ctx.fillStyle = 'rgba(255,80,30,' + (0.22 * a).toFixed(3) + ')';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,130,60,' + (0.75 * a).toFixed(3) + ')';
    ctx.lineWidth = 3;
    riftTrace(n, 0, L);
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

// 特性的现场画面（压在地面之上、怪之下）：雾团亮边、地缝预警 / 喷发、光核、潮流线
function drawFeats() {
  const f = layerFeat(), t = nowMs() / 1000;
  if (f === 'fog' && inFog) {
    // 主角躲着的那团雾：亮一圈边，告诉他"现在藏着"
    const b = inFog, rx = wdx(b.x), ry = wdy(b.y), pk = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = 'rgba(120,235,195,0.05)';
    ctx.beginPath(); ctx.arc(rx, ry, b.r * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(150,245,210,' + (0.25 + 0.2 * pk).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(rx, ry, b.r * 0.85, 0, Math.PI * 2); ctx.stroke();
  }
  if (f === 'rift') {
    const cs = riftCracks();
    for (let c = 0; c < cs.length; c++) if (cs[c].st !== 'idle' && riftInView(cs[c], 90)) drawRift(cs[c], t);
  }
  if (f === 'core') {
    // 视口里的光核：一颗跳动的亮点 + 一圈呼吸的环；站进去的那颗更亮、环撑到光核边缘
    const F = FOG_CELL, vx = cam.x - W / 2, vy = cam.y - H / 2;
    for (let gx = Math.floor((vx - F) / F); gx <= Math.floor((vx + W) / F); gx++) {
      for (let gy = Math.floor((vy - F) / F); gy <= Math.floor((vy + H) / F); gy++) {
        const cx = gx * F + F / 2, cy = gy * F + F / 2;
        if (cx < vx - 80 || cx > vx + W + 80 || cy < vy - 80 || cy > vy + H + 80) continue;
        const on = coreNow && Math.abs(wdelta(coreNow.x - cx)) < 1 && Math.abs(wdelta(coreNow.y - cy)) < 1;
        const pk = 0.5 + 0.5 * Math.sin(t * 2.4 + gx * 1.7 + gy);
        ctx.fillStyle = 'rgba(215,180,255,' + (on ? 0.9 : 0.5 + 0.3 * pk).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(cx, cy, on ? 7 : 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200,160,255,' + (on ? 0.6 : 0.25 * pk).toFixed(3) + ')';
        ctx.lineWidth = on ? 2.5 : 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, on ? CFG.lf.coreR : 16 + 10 * pk, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  if (f === 'tide') {
    // 潮流线：二十来道短线顺着潮流漂，取模铺满视口
    const vx = cam.x - W / 2, vy = cam.y - H / 2, ux = Math.cos(tideA), uy = Math.sin(tideA);
    ctx.strokeStyle = 'rgba(130,185,250,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 22; i++) {
      const sx = (i * 197.3) % W, sy = (i * 311.7) % H;
      const x = vx + (((sx + dustOff[0] * 1.6) % W) + W) % W, y = vy + (((sy + dustOff[1] * 1.6) % H) + H) % H;
      ctx.moveTo(x, y); ctx.lineTo(x - ux * 46, y - uy * 46);
    }
    ctx.stroke();
  }
}

function onEnterLayer(n) {
  layerFxT = 1.8;
  riftTold = false;
  tideT = -1e9;              // 黑潮：一进来就定一个方向（不报"潮向变了"）
  tideA = rand(0, Math.PI * 2);
  vibrate(1);
  P.inv = Math.max(P.inv, 0.45);
  rings.push({
    x: P.x, y: P.y, r0: 24, r1: 230,
    life: 0.7, max: 0.7, color: 'rgba(191,239,255,0.85)', w: 3
  });
  S.upgrade();
  checkContract();

  // 前哨：进层 1.2 秒后必刷本层主怪，第 6 层起刷两只。
  // 这不是加压（常规刷怪概率一点没动），是给"这层多了什么"一个确定的演示窗口。
  const W = layerCfg(n).w;
  let pick = layerNewType(n);
  if (!pick) {
    // 没有新怪可讲时，刷本层权重最高的那一种 —— 它就是这一层的主题
    let best = 0;
    for (const k in W) if (W[k] > best) { best = W[k]; pick = k; }
  }
  if (pick) {
    scoutType = pick;
    scoutLeft = n >= 6 ? 2 : 1;
    scoutAt = gameTime + 1.2;
  } else {
    scoutLeft = 0;
  }
}

function contractProgress() {
  if (!contract) return 0;
  switch (contract.id) {
    case 'combo':   return bestCombo;
    case 'crystal': return crystalsBroken;
    case 'kill':    return runKills;
    case 'layer':   return layer;
    case 'pure':    return crystalsBroken === 0 ? layer : 0;
  }
  return 0;
}

function checkContract() {
  if (!contract || contractDone) return;
  if (contractProgress() < contract.need) return;
  contractDone = true;
  contractFx = 2.6;
  pushBanner('契约达成', contract.text + '　余光 +' + contract.reward, '#ffd166');
  S.upgrade();
}

function update(dt) {
  if (laneMode) { updateLane(dt); return; }      // 横屏跑酷（2.17 节）
  if (hordeMode) { updateHorde(dt); return; }   // 黑潮试玩：自己一套（2.12 节）
  gameTime += dt;
  tickTutorial(dt);

  // ---- 存活计分 ----
  // 分是连续涨的（分数一直在动，玩家自然读到"活着就在赚"），
  // 每 10 秒在主角头上报一次这段时间攒了多少，给一个可读的节拍。
  const sRate = Math.min(CFG.surviveMax, CFG.surviveRate + gameTime * CFG.surviveRamp)
              * (1 + Math.min(combo, 12) * CFG.surviveCombo);
  surviveAcc += dt * sRate;
  const sWhole = Math.floor(surviveAcc);
  if (sWhole > 0) {
    surviveAcc -= sWhole;
    score += sWhole;
    surviveGain += sWhole;
    survivePend += sWhole;
  }
  surviveT += dt;
  if (surviveT >= CFG.surviveEvery) {
    surviveT -= CFG.surviveEvery;
    if (survivePend > 0) {
      floats.push({
        x: P.x, y: P.y - P.r * 2.6, text: '存活 +' + survivePend,
        life: 1.2, max: 1.2, size: 16, c: 'rgba(191,239,255,0.85)'
      });
      survivePend = 0;
    }
  }

  // ---- 光和糖：光往下掉，捡糖补，碰到门就破门（2.11 节）----
  // 这是单局的主线：跟着糖往下走（HUD 右上角写着离门还有多远）
  tickLight(dt);
  if (state !== 'play') return;          // 光灭了
  if (layerFxT > 0) layerFxT -= dt;

  // 前哨到点必刷。两只之间隔 0.9 秒，免得叠在同一个生成点上。
  // 位置刻意放在光的内缘（普通怪在 1.5 倍视野外）：它是"讲解员"，
  // 生在光照不到的地方等于没讲。配合出生时的放大动画，看起来是从地里长出来。
  if (scoutLeft > 0 && gameTime >= scoutAt) {
    const a = rand(0, Math.PI * 2);
    const d = view * rand(0.72, 0.90);
    const sx = P.x + Math.cos(a) * d;
    const sy = P.y + Math.sin(a) * d;
    const e = spawnEnemy(sx, sy, scoutType);
    if (e) {
      e.scout = 2.8;               // 头顶标记，2.8 秒内淡出
      showEnemyTip(scoutType);     // 新敌人头两次出场：屏幕中下方弹一张"怎么对付"的卡
      rings.push({
        x: sx, y: sy, r0: 6, r1: e.r * 3.4,
        life: 0.5, max: 0.5, color: 'rgba(191,239,255,0.55)', w: 2
      });
    }
    scoutLeft -= 1;
    scoutAt = gameTime + 0.9;
  }
  if (contractFx > 0) contractFx -= dt;

  // ---- 氛围：危险度 / 视野 / 心跳 ----
  const nearE = nearestEnemy(0);
  const nearD = nearE ? wdist(nearE.x, nearE.y, P.x, P.y) : 9999;
  danger += (clamp(1 - nearD / 420, 0, 1) - danger) * Math.min(1, dt * 3);

  if (viewBoost > 0) viewBoost = Math.max(0, viewBoost - dt);

  // 视野 = 基础 + 连击撑开 → 被守望者吸走 → 被光尘放大
  let vt = Math.min(POW.viewMax, POW.viewBase + Math.min(combo, 13) * CFG.viewCombo);
  vt *= (1 - viewDrain);
  if (viewBoost > 0) vt *= (1 + CFG.crystalGain);
  // 空场呼吸：光会"喘一口气"。这一下把四周照亮，下一波从哪来先摆在眼前，
  // 玩家不用在新怪贴脸的那一刻才开始判断。
  if (calmT > 0) vt *= 1 + (CFG.calmView - 1) * (calmT / CFG.calmT);
  const viewTarget = CFG.darkness ? vt : Math.max(W, H);
  // 空场时光要"啪"地一下撑开（否则缓冲都结束了玩家还没看清），收的时候照旧慢
  view += (viewTarget - view) * Math.min(1, dt * (calmT > 0 ? 7 : 1.6));

  // ---- 晶柱：长出来的动画 + 场上不满时补一根 ----
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    if (c.age < 9) c.age += dt;
  }
  if (crystals.length < POW.crystalN) {
    crystalTimer -= dt;
    if (crystalTimer <= 0) spawnCrystal();
  } else {
    crystalTimer = POW.crystalRe;         // 满场时不攒时间，碎一根才开始倒计时
  }

  S.setTension(danger);
  // 音乐跟着连击走：杀得越顺，踩镲越密、贝斯越亮；危险靠近，心跳加速
  S.setBgm(bgmLvOf(combo));   // 音乐只跟连斩走：过一道门槛，曲子厚一层（危险度交给心跳和嗡鸣）

  // 心跳交给 BGM 的拍子去跳（S.heartTick），这里只把危险度递过去。
  // 以前是独立的帧计时器，速度在 56~130 BPM 之间乱飘，和 152 BPM 的曲子
  // 没有整数关系，两套节拍一直错位 —— 那才是"听着节奏对不上"的根源。
  if (S.bgmOn()) {
    S.setHeart(danger);
  } else {
    heartTimer -= dt;
    if (heartTimer <= 0) {
      heartTimer = 60 / (56 + danger * 74);
      S.thump(0.1 + danger * 0.22);
    }
  }

  whisperTimer -= dt;
  if (whisperTimer <= 0) {
    whisperTimer = rand(11, 22);
    if (THEME.whisper && danger < 0.5) S.whisper();
  }

  // ---- 玩家 ----
  if (P.cd > 0) P.cd = Math.max(0, P.cd - dt);
  if (P.glideT > 0) P.glideT = Math.max(0, P.glideT - dt);
  if (P.inv > 0) P.inv = Math.max(0, P.inv - dt);
  if (calmT > 0) calmT = Math.max(0, calmT - dt);
  if (shieldFx > 0) shieldFx = Math.max(0, shieldFx - dt * 1.4);
  if (shield === 0 && shieldT > 0) {
    shieldT -= dt;
    if (shieldT <= 0) regrowShield();
  }
  updateCamera(dt);       // 镜头追人：死区 → 前瞻 → 缓动
  tickFeats(dt);
  tickDust(dt);

  // ---- 长按连斩 ----
  // 按住攻击键时，冷却一归零就自动接下一刀。
  // 击杀会清零 cd，所以砍到第一个之后就是无限连；砍空了就要等满 0.5 秒。
  // ★ 自动接刀额外延迟 autoDelay 秒，手动点击是 0 延迟。
  //   这样"按住不放"仍然是省力的，但不再是最优解 —— 想抢那一刀得自己点。
  if (CFG.autoRepeat && attackHeld && P.dashT <= 0 && P.cd <= 0) {
    autoTimer += dt;
    if (autoTimer >= CFG.autoDelay) {
      const aim = inputDir();             // 推着摇杆：只砍那个方向上的
      const t = closeThreat() || lockOn(aim);   // 贴身的先砍：马上要撞上你的，不管摇杆指哪
      const n0 = dashSeq;
      if (t) { tryDash({ x: t.x, y: t.y, bomb: t.bomb, heavy: t.heavy, cracked: t.cracked, r: t.r, ref: t }); autoTimer = 0; }
      // 够不着敌人时，刀会自己去找晶柱 —— 场上没东西可杀，就去取余光。
      // 这一条很重要：否则"余光怎么来的"要玩家自己悟，很多人永远悟不到。
      else {
        const c = nearestCrystal(aim);
        if (c) { tryDash({ x: c.x, y: c.y }); autoTimer = 0; }
      }
      if (dashSeq !== n0) runDashAuto++;      // 测试数据：按住自动接的刀
      // 都没有就不挥刀。朝空气或扑太远的目标冲刺会白吃 0.5 秒真空期，
      // "边跑边按"应该比站桩更安全，而不是更危险。
    }
  } else {
    autoTimer = 0;
  }

  stepPlayer(dt);

  // ---- 刷怪 ----
  spawnTimer -= dt;
  if (spawnTimer <= 0 && enemies.length < CFG.maxEnemies) {
    const base = Math.max(CFG.spawnMin, CFG.spawnBase - gameTime * CFG.spawnRamp);
    // 开局 12 秒放宽 1.7 倍：第一只敌人必须给玩家时间建立第一次连击，
    // 否则新手 2 秒就死，根本走不到"我差一点"的那一步。
    const warm = gameTime < 12 ? 1.7 - (gameTime / 12) * 0.7 : 1;
    spawnTimer = base * warm * (1 - Math.min(combo, 12) * 0.025) * (tutOn() ? 1.5 : 1);   // 教学期间松一点
    spawnEnemy();
  }

  // ---- 甩掉的怪：收掉，从前面补一只 ----
  // 场上最多 maxEnemies 只，可玩家跑得比哪种怪都快（430 对最快约 330）。
  // 一直朝一个方向跑，身后就拖出一串追不上的怪，名额被它们占满，
  // 常规刷怪和合围都刷不出来 —— 跑久了前面空无一物，跑就是无敌。
  // 所以跑出感知外的怪直接收掉（黑暗里连核都看不见，不会在眼前凭空消失），
  // 在前进方向的光外补一只本层的新怪：跑能甩掉一只怪，甩不掉这片黑暗。
  // 距离按 view 和 viewBase 里大的那个算：守望者把视野吸小时，别把近处的怪也当成甩掉了。
  const lost = Math.max(view, POW.viewBase) * CFG.lostView;
  const hd = headingDir();
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (wdist(e.x, e.y, P.x, P.y) < lost) continue;
    enemies.splice(i, 1);
    // 在走就补在前方左右 55° 以内，但补在远处（frontFar 倍感知半径）：远远看得见、来得及绕；
    // 站着不动（远处冻着的守望者之类）就四面随机、正常距离
    const a = hd ? Math.atan2(hd.y, hd.x) + rand(-0.95, 0.95) : rand(0, Math.PI * 2);
    const d = hd ? view * (CFG.frontFar + rand(0, 0.15)) : spawnDist();
    spawnEnemy(P.x + Math.cos(a) * d, P.y + Math.sin(a) * d);
  }

  // ---- 合围波：预警 0.9 秒，然后四面向内同时压 ----
  if (waveWarnT > 0) {
    waveWarnT -= dt;
    if (waveWarnT <= 0) spawnWave();
  } else if (gameTime > CFG.waveFirst && !tutOn()) {    // 教学没走完不合围
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveTimer = layerFeat() === 'end' ? CFG.lf.endWave : CFG.waveEvery;
      startWaveWarn();
    }
  }

  // ---- 敌人 ----
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    e.born = Math.min(1, e.born + dt * 4);
    if (e.scout > 0) e.scout -= dt;
    e.wob += dt * 4;
    if (e.armorT > 0) e.armorT -= dt;
    if (e.crackT > 0) e.crackT -= dt;
    e.litT = litAt(wdist(e.x, e.y, P.x, P.y)) >= 0.5 ? (e.litT || 0) + dt : 0;   // 在亮处（看得清）连续待了多久
    // 重型被砍开外壳：硬甲那 armorT 秒愣在原地（以前照样追着撞你，刀又砍不动它 —— 冤死大户）
    if (e.heavy && e.armorT > 0) continue;
    // 刀诀「围观」：看呆了，不追人，往焦点那儿凑（约 0.3 秒凑到）
    if (e.stun > 0) {
      e.stun -= dt;
      const k = Math.min(1, dt * 10);
      e.x = wwrap(e.x + wdelta(e.gx - e.x) * k);
      e.y = wwrap(e.y + wdelta(e.gy - e.y) * k);
      continue;
    }
    // 环形世界：追人走最短绕行方向 —— 隔着边界也照追不误
    const dx = wdelta(P.x - e.x), dy = wdelta(P.y - e.y);
    const d = Math.sqrt(dx * dx + dy * dy) || 1;

    if (e.charger && e.mode !== 'walk') {
      if (e.mode === 'wind') {
        // 蓄力：几乎不动。这 0.6 秒是给玩家的反应时间，不是给敌人的。
        e.t -= dt;
        if (e.t <= 0) { e.mode = 'charge'; e.t = 0.42; }
      } else {
        e.t -= dt;
        e.x += e.cdx * 640 * dt;
        e.y += e.cdy * 640 * dt;
        // 冲过头或冲到离玩家太远的地方就收回走路态
        e.x = wwrap(e.x); e.y = wwrap(e.y);
        if (e.t <= 0 || wdist(e.x, e.y, P.x, P.y) > 2400) {
          e.mode = 'walk'; e.t = 0;
        }
      }
      continue;
    }

    let spd = e.sp;
    if (e.watch) spd *= (d < view * 0.95 ? 1.9 : 0.15);   // 黑暗里几乎静止，被光照到才扑上来
    let ux = dx / d, uy = dy / d;
    const ft = layerFeat();
    if (ft === 'end') spd *= CFG.lf.endSpeed;
    // 低语：主角躲在雾里，远处的怪找不准方向、慢下来
    if (ft === 'fog' && inFog && d > 90) {
      spd *= CFG.lf.fogSlow;
      const wa = Math.sin(e.wob * 0.9 + e.r) * 1.1, c = Math.cos(wa), sn = Math.sin(wa);
      const rx = ux * c - uy * sn; uy = ux * sn + uy * c; ux = rx;
    }
    e.x = wwrap(e.x + ux * spd * dt);
    e.y = wwrap(e.y + uy * spd * dt);

    // 走到近处才起手，太远蓄力没有意义
    if (e.charger && e.mode === 'walk' && d < 300) {
      e.mode = 'wind'; e.t = 0.6;
      e.cdx = dx / d; e.cdy = dy / d;
    }
  }

  // 互相推开，避免叠成一个点（跨边界的两只也按最短绕行方向推开）
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      const dx = wdelta(b.x - a.x), dy = wdelta(b.y - a.y);
      const d = Math.sqrt(dx * dx + dy * dy);
      const min = a.r + b.r;
      if (d > 0.001 && d < min) {
        const push = (min - d) / d * 0.5;
        a.x = wwrap(a.x - dx * push * 0.5); a.y = wwrap(a.y - dy * push * 0.5);
        b.x = wwrap(b.x + dx * push * 0.5); b.y = wwrap(b.y + dy * push * 0.5);
      }
    }
  }

  // 守望者吸视野：离得越近吸得越狠，最多吸掉 35%。
  // 用的是上一帧的位置算、下一帧生效 —— 一帧的延迟看不出来。
  let drain = 0;
  for (let i = 0; i < enemies.length; i++) {
    const w = enemies[i];
    if (!w.watch) continue;
    const k = clamp(1 - wdist(w.x, w.y, P.x, P.y) / 340, 0, 1);
    if (k > drain) drain = k;
  }
  viewDrain = coreNow ? 0 : drain * 0.35;      // 核心：站在光核里，守望者吸不走光

  // ---- 引信与碎片 ----
  updateProps(dt);

  // ---- 碰撞 ----
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    // 环形世界：把敌人折到离玩家最近的那个分身上再算刀痕距离
    const ex = P.x + wdelta(e.x - P.x), ey = P.y + wdelta(e.y - P.y);
    const d = segDist(P.px, P.py, P.x, P.y, ex, ey);
    if (d > P.r + e.r) continue;
    if (P.dashT > 0 || P.glideT > 0) {             // 冲刺中、或刚收刀的余势里：碰到就是斩到
      // 甲硬直中：刀滑过，什么都发生不了（硬直是给玩家跑路的窗口，不是白给）
      if (e.heavy && e.cracked && e.armorT > 0) continue;
      if (e.heavy && !e.cracked) { crackEnemy(e); continue; }
      killEnemy(i);
    }
    else if (P.inv > 0 || tutOn() || e.stun > 0 || (e.heavy && e.armorT > 0)) { /* 无敌帧 / 教学期间 / 看呆了的 / 被砍开外壳愣住的重型，穿过 */ }
    else { markDeath(e); die(FOE_NAME[foeType(e)]); break; }
  }

  // ---- 刀砍到晶柱：碎成飞片 ----
  if (P.dashT > 0) {
    for (let i = crystals.length - 1; i >= 0; i--) {
      const c = crystals[i];
      const cx = P.x + wdelta(c.x - P.x), cy = P.y + wdelta(c.y - P.y);
      if (segDist(P.px, P.py, P.x, P.y, cx, cy) < P.r + c.r) shatterCrystal(i);
    }
  }

  // ---- 剑气 / 光盾震波 ----
  while (burstQ.length && state === 'play') releaseBurst(burstQ.shift());

  // ---- 刀诀：唱片 / 飞刃 / 残影，连锁 / 余震 / 围观；破门以后弹三选一 ----
  if (state === 'play') { tickCards(dt); checkHao(dt); }

  // ---- 连击窗口 ----
  if (combo > 0) {
    comboTimer -= dt;
    // 快断提醒：连斩 ≥ 3 时，窗口剩最后四成开始滴答，越到最后越急（刚起手的一两刀不吵）
    const warnT = CFG.comboWarn * POW.comboWindow;
    if (combo >= 3 && comboTimer > 0 && comboTimer < warnT) {
      tickT -= dt;
      if (tickT <= 0) { S.tick(1 - comboTimer / warnT); tickT = 0.05 + 0.2 * comboTimer / warnT; }
    } else tickT = 0;
    if (comboTimer <= 0) {
      if (THEME.whisper && combo >= 3) S.whisper();
      fbChainEnd(combo);
      qiCharge = 0;
      // 续势：断连不清零，留下一截、重新给一个窗口；一直不砍就一截一截往下掉
      const kept = Math.floor(combo * POW.keep);
      if (kept >= 2) {
        combo = kept;
        comboTimer = POW.comboWindow;
        FB.tier = tierOf(combo);
        if (!keptIdle) callout('续势 ×' + kept, '#7df0ff', 36, 74);
        keptIdle = true;
      } else {
        combo = 0; comboTimer = 0;
      }
    }
  }

  updateFX(dt);
}

// 主角这一帧怎么动：冲刺（斩到就停）/ 走路 / 收刀滑行，环形世界跨界，刀光拖尾。
// 黑潮试玩（2.12 节）也走这一份，手感和正式玩法一样
function stepPlayer(dt) {
  P.px = P.x; P.py = P.y;
  // 黑潮：不碰屏幕就自动往上跑，拖动屏幕就往拖的方向，但不能往后走（往下拖只左右挪，正下方 = 站住，见 hNoBack）（2.12 节）
  // 两把斩：拖屏幕不管用，按住斩键往那边斜前方走（hSteerDir），没按住就一直往上跑
  const din = hordeMode && HD.twoBlades ? (hIntro ? null : hSteerDir()) : inputDir();
  const dir = !hordeMode ? din : din ? hNoBack(din) : (HD.autoRun && !hIntro && !hTutStill() ? HUP : null);   // 教左右斩时站住（2.14 节）
  const dashing = P.dashT > 0;
  let dashStop = false;             // 这一帧冲到了目标身后：停住（位移之后把速度降成滑一小步）

  if (P.dashT > 0) {
    P.dashT -= dt;
    // 锁了目标的一刀按计划走完：时间到了还没走到（要穿过爆裂者 / 重型 / 爆炸圈），用收刀的速度接着走
    if (P.dashT <= 0 && P.dashLeft < Infinity && P.dashLeft > 1) P.dashT = 1e-6;
    const k = Math.max(P.dashT, 0) / CFG.dashTime;
    const sp = POW.dashSpeed * (0.4 + 0.6 * k) * (layerFeat() === 'slip' ? CFG.lf.slipDash : 1) * (hordeMode ? hMomK() : 1);   // 黑潮：势头越高闪得越快
    P.vx = P.dx * sp; P.vy = P.dy * sp;
    // 斩到就停：这一帧要走的超过剩下的，就只走到头，这一刀到此为止
    const stepLen = sp * dt;
    if (P.dashLeft < Infinity) {
      if (stepLen >= P.dashLeft) {
        const q = P.dashLeft / Math.max(stepLen, 0.001);
        P.vx *= q; P.vy *= q;
        P.dashT = 0; P.dashLeft = Infinity; dashStop = true;
        // 目标在冲到之前就被别的东西弄死了（炸死、碎片……）：不算砍空，不用干等冷却；
        // 对准了却让它挪开了：只等 aimMissCd 就能再砍（砍空罚 0.5 秒是防对着空气乱点的，不是罚认真瞄准的）
        if (P.dashRef) P.cd = enemies.indexOf(P.dashRef) < 0 ? 0 : Math.min(P.cd, CFG.aimMissCd);
        P.dashRef = null;
      } else P.dashLeft -= stepLen;
    }
    if (P.dashT <= 0) {
      P.glideT = CFG.glideCut;      // 刀收了，余势还在
      lastDashEnd = gameTime;
      if (clv('blade')) launchBlades();
    }
    // 转身：朝向追冲刺方向，三帧转到九成五 —— 快得不拖判定，又看得出是"转"过去的
    let da = Math.atan2(P.dy, P.dx) - P.ang;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    P.ang += da * Math.min(1, dt * 38);
    const gl = POW.ghostLv || 0;
    ghosts.push({ x: P.x, y: P.y, r: P.r, a: P.ang, life: 0.26 + gl * 0.04, max: 0.26 + gl * 0.04 });
    // 残影：身后再拖几层，层数 = 等级。冲刺时一眼就能看出自己买了什么
    for (let g = 1; g <= gl; g++) {
      ghosts.push({
        x: P.x - P.dx * g * 9, y: P.y - P.dy * g * 9,
        r: P.r * (1 - g * 0.07), a: P.ang,
        life: 0.18 + g * 0.04, max: 0.18 + g * 0.04
      });
    }
  } else {
    const vmax = hordeMode ? HD.walk * hTempo() * hSpeedK() : CFG.maxSpeed;   // 黑潮试玩走得慢一些，每波跟着节奏快一点（2.12 节）；雨中嘉豪涌浪时快 30%
    const sp0 = Math.hypot(P.vx, P.vy);
    if (dir) { const ac = hordeMode ? HD.accel * hTempo() : CFG.accel; P.vx += dir.x * ac * dt; P.vy += dir.y * ac * dt; }
    // 收刀滑行：冲刺刚结束时速度还远高于走路上限，这一段用更松的阻尼收住。
    // 以前这里是 P.vx *= 0.3 一刀切，看起来就是"高速连斩中突然钉住"。
    // 正式玩法这里有个老毛病（没改，见 2.12 节）：推着摇杆一直走，加速先把速度顶过上限，就被当成"滑行"，
    // 一路走在上限的 coastCap 倍（实测 624，不是 430）。黑潮试玩改成：看推摇杆之前的速度判滑行，滑行时只减不增
    const gliding = (hordeMode ? sp0 : Math.hypot(P.vx, P.vy)) > vmax;
    const slip = layerFeat() === 'slip';
    const damp = Math.exp(-(gliding ? CFG.coastDamp * (slip ? CFG.lf.slipCoast : 1) : (dir ? 2.5 : CFG.damping) * (slip ? CFG.lf.slipDamp : 1)) * dt);
    P.vx *= damp; P.vy *= damp;
    const sp = Math.hypot(P.vx, P.vy);
    let cap = vmax * (gliding ? CFG.coastCap : (calmT > 0 ? CFG.calmSpeed : 1));
    if (hordeMode && gliding) cap = Math.max(vmax, Math.min(cap, sp0 * damp));
    if (sp > cap) { P.vx = P.vx / sp * cap; P.vy = P.vy / sp * cap; }
    // 两把斩：不滑行的时候方向说变就变 —— 按下 / 松手那一帧就是新方向、跑满速（收刀后的滑行照旧，斩完不会一下钉住）
    if (hordeMode && HD.twoBlades && dir && !gliding) { P.vx = dir.x * vmax; P.vy = dir.y * vmax; }
    if (Math.hypot(P.vx, P.vy) > 40) {
      const target = Math.atan2(P.vy, P.vx);
      let d = target - P.ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      P.ang += d * Math.min(1, dt * 18);
    }
  }

  P.x += P.vx * dt; P.y += P.vy * dt;
  if (dashStop) { P.vx = P.dx * CFG.dashStopV; P.vy = P.dy * CFG.dashStopV; }   // 停在目标身后，只顺势滑一小步

  // 环形世界：越过边界从另一侧绕回来。
  // 跳变的那一份差量要同步给镜头和刀痕的上一帧位置 ——
  // 镜头跟着跳，画面不闪；刀痕不断开，跨界那一刀照样砍得到人。
  const jx = P.x - wwrap(P.x);
  if (jx) { P.x -= jx; cam.x -= jx; P.px -= jx; camLap.x += jx; }
  const jy = P.y - wwrap(P.y);
  if (jy) { P.y -= jy; cam.y -= jy; P.py -= jy; camLap.y += jy; }
  if (dashing && clv('echo')) trackEcho();      // 残影：记下这一刀走过的路

  // 刀光拖尾：冲刺和收刀滑行时记刀路；慢下来就不再加点，尾巴自己缩回去
  if (P.dashT > 0 || Math.hypot(P.vx, P.vy) > (hordeMode ? HD.walk * hTempo() : CFG.maxSpeed) * 1.05) {
    trail.push({ x: P.x, y: P.y, life: 0.13, max: 0.13 });
    if (trail.length > 16) trail.shift();
  }

  P.squash = Math.max(0, P.squash - dt * 6);
}

/* 引信与碎片：都只活很短，但都参与杀伤判定。 */
function updateProps(dt) {
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    b.t += dt;
    if (b.t >= b.fuse) { blasts.splice(i, 1); explodeBlast(b); }
  }

  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.life -= dt;
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.vx *= 0.965; s.vy *= 0.965;

    // 一片碎片最多带走 3 个，避免一根柱子清空全场
    for (let j = enemies.length - 1; j >= 0 && s.hits < 3; j--) {
      const e = enemies[j];
      if (e.heavy && !e.cracked) continue;         // 甲能挡住碎片
      if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + 9) { killEnemy(j, 'shard'); s.hits++; }
    }

    if (s.life <= 0) shards.splice(i, 1);
  }
}

function updateFX(dt) {
  // 主角燃烧：上了段位，身上不停往外冒段位色的火星，段位越高越密；断连时跟着热度慢慢熄掉
  if (state === 'play' && FB.heat > 0.05) {
    emberAcc += dt * (12 + 8 * Math.max(0, FB.tier)) * FB.heat;
    const hc = heroColor();
    while (emberAcc >= 1) {
      emberAcc -= 1;
      if (embers.length >= 80) continue;
      const a = rand(0, Math.PI * 2), d = P.r * rand(0.3, 1), s = rand(20, 60);
      embers.push({
        x: P.x + Math.cos(a) * d, y: P.y + Math.sin(a) * d,
        vx: Math.cos(a) * s - P.vx * 0.15, vy: Math.sin(a) * s - rand(40, 90) - P.vy * 0.15,
        life: rand(0.35, 0.75), max: 0.75, r: rand(1.2, 2.6) * (1 + 0.05 * Math.max(0, FB.tier)), c: hc
      });
    }
  } else emberAcc = 0;
  for (let i = embers.length - 1; i >= 0; i--) {
    const m = embers[i];
    m.life -= dt;
    if (m.life <= 0) { embers.splice(i, 1); continue; }
    m.x += m.vx * dt; m.y += m.vy * dt;
    m.vx *= 0.96; m.vy *= 0.96;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.94; p.vy *= 0.94;
  }
  for (let i = ghosts.length - 1; i >= 0; i--) {
    ghosts[i].life -= dt;
    if (ghosts[i].life <= 0) ghosts.splice(i, 1);
  }
  // 拖尾按时间顺序存，最老的在最前：从头上剪就行
  for (let i = 0; i < trail.length; i++) trail[i].life -= dt;
  while (trail.length && trail[0].life <= 0) trail.shift();
  for (let i = turns.length - 1; i >= 0; i--) {
    turns[i].life -= dt;
    if (turns[i].life <= 0) turns.splice(i, 1);
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.life -= dt;
    if (f.life <= 0) { floats.splice(i, 1); continue; }
    f.y -= 42 * dt;
  }
  for (let i = stains.length - 1; i >= 0; i--) {
    stains[i].life -= dt;
    if (stains[i].life <= 0) stains.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].life -= dt;
    if (rings[i].life <= 0) rings.splice(i, 1);
  }
  for (let i = cuts.length - 1; i >= 0; i--) {
    cuts[i].life -= dt;
    if (cuts[i].life <= 0) cuts.splice(i, 1);
  }
  for (let i = armorBits.length - 1; i >= 0; i--) {
    const b = armorBits[i];
    b.life -= dt;
    if (b.life <= 0) { armorBits.splice(i, 1); continue; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.rot += b.spin * dt;
    b.vx *= 0.93; b.vy *= 0.93;
    b.spin *= 0.95;
    b.r += 26 * dt;                      // 边飞边散开，像壳被撑碎
  }
  tickCardFX(dt);
}


/* =========================================================
   12. 绘制（世界坐标）
   ========================================================= */
/* —— 无边界背景 ——
   世界没有边界，背景就不能"按一屏生成一次"。
   残骸按 900×900 的瓦片铺：每块瓦片用 (tx,ty) 做确定性种子，
   同一块地永远长同一片废墟，跑远了再折回来，废墟还在原地。
   缓存上限 36 块，超了整表重算 —— 重建一块就是几十次取随机数。
   浮尘改成视差层：比地面慢 15%，永远铺满视口，跑起来才有纵深。 */
const TILE = 900;
let dust = null;
let tileMap = {};

function buildBackdrop() {
  if (dust) return;
  // 固定种子的伪随机：每一局的浮尘都一样
  let s = 20260308;
  const rng = function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  dust = [];
  for (let i = 0; i < 30; i++) {
    dust.push({
      x: rng() * 4096, y: rng() * 4096,
      vx: (rng() - 0.5) * 9,
      vy: (rng() - 0.5) * 7,
      r: 0.8 + rng() * 1.7,
      ph: rng() * Math.PI * 2
    });
  }
}

function tileRng(tx, ty) {
  let s = ((tx * 73856093) ^ (ty * 19349663) ^ 20260308) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 瓦片号先对 WORLD / TILE 取模再当种子：绕一整圈回到同一块地，长的是同一片废墟。
// 存的是瓦片内的相对坐标，画的时候再加上这块瓦片在视口里的实际位置（可能是绕过圈的那个分身）。
function tileDebris(tx, ty) {
  const nt = WORLD / TILE;
  tx = ((tx % nt) + nt) % nt;
  ty = ((ty % nt) + nt) % nt;
  const key = tx + ',' + ty;
  let t = tileMap[key];
  if (t) return t;
  const rng = tileRng(tx, ty);
  const n = Math.round(TILE * TILE / 48000);
  t = [];
  for (let i = 0; i < n; i++) {
    const shards = [];
    const m = 2 + Math.floor(rng() * 3);
    for (let j = 0; j < m; j++) {
      shards.push({
        dx: (rng() - 0.5) * 95,
        dy: (rng() - 0.5) * 95,
        r: 7 + rng() * 22,
        k: 0.32 + rng() * 0.45,      // 压扁成尖片的比例
        a: rng() * Math.PI * 2
      });
    }
    t.push({
      x: rng() * TILE,
      y: rng() * TILE,
      scale: 0.7 + rng() * 1.1,
      shards: shards
    });
  }
  tileMap[key] = t;
  if (Object.keys(tileMap).length > 36) tileMap = {};   // 兜底：缓存不跟着玩家无限涨
  return t;
}

/* 背景缓存：地面（底色 + 菱格 + 光点 + 晶墟残骸）一辈子不变，以前却每帧整屏重画，占了每帧九成的绘制调用。
   现在切成边长 BG.T 的方块，先画进离屏小画布，每帧按镜头贴十几张图；浮尘会飘、暗角跟镜头，照旧现画。
   - 块对齐世界原点，T 整除 WORLD 且是 150（菱格 + 光点的周期）的倍数：绕世界一圈回来是同一块
   - 每块右、下多画 2 个像素，贴的时候压住下一块的边，接缝上不会漏出一条线
   - 视口外多备半块，每帧最多补画一块：跑起来不会在某一帧现画一整排
   - 建不了离屏画布就照旧整屏现画 */
const BG = { k: 0, T: 0, pad: 0, px: 0, tiles: {}, list: [], cap: 0, frame: 0, off: false };
// 换层换主题：块按主题分开存（key 带主题 id）。破门条到 75% 起每帧顺手画一块下一层的视口块，
// 破门那一下大多已经画好，不会一帧现画一整屏

function bgReset(k) {
  BG.k = k;
  BG.tiles = {}; BG.list = [];
  BG.T = 450;
  while (BG.T > 150 && BG.T * k > 560) BG.T -= 150;     // 一块不超过约 560 像素见方
  BG.pad = 2 / k;
  BG.px = Math.ceil((BG.T + BG.pad) * k);
}

// 第 (i, j) 块（块号不取模）。没画过的：now 为真就当场画（挪用这一帧用不着的最旧那块），否则返回 null
function bgTile(i, j, now, G) {
  G = G || groundOf(layer);
  const n = WORLD / BG.T;
  const mi = ((i % n) + n) % n, mj = ((j % n) + n) % n, key = G.id + ':' + (mi * n + mj);
  let t = BG.tiles[key];
  if (t) { t.used = BG.frame; return t; }
  if (!now) return null;
  if (BG.list.length >= BG.cap) {
    for (let a = 0; a < BG.list.length; a++) {
      const o = BG.list[a];
      if (o.used < BG.frame && (!t || o.used < t.used)) t = o;
    }
  }
  if (t) delete BG.tiles[t.key];
  else {
    try {
      const c = IS_MG ? MG.createCanvas() : document.createElement('canvas');
      c.width = BG.px; c.height = BG.px;
      t = { c: c, g: ctx2d(c), key: -1, used: 0 };
    } catch (e) { t = null; }
    if (!t || !t.g) { BG.off = true; return null; }
    BG.list.push(t);
  }
  // 画进小画布：把全局 ctx 临时换成它，地面照原样画（同一份代码，长得一模一样）
  const keep = ctx, s = BG.px / (BG.T + BG.pad);
  ctx = t.g;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, BG.px, BG.px);
  ctx.setTransform(s, 0, 0, s, -mi * BG.T * s, -mj * BG.T * s);
  drawGround(mi * BG.T, mj * BG.T, BG.T + BG.pad, BG.T + BG.pad, G);
  ctx = keep;
  FR.bg++;
  t.key = key; t.used = BG.frame;
  BG.tiles[key] = t;
  return t;
}

// 用缓存贴出视口里的地面；用不了返回 false，由调用方现画。
// cut：世界 y 从这往下被不透明的墨潮整片盖住（hInkSolid），只贴到这儿 —— 黑潮贴近时墨占半屏，底下那半屏地面画了也白画
function bgCached(vx, vy, cut) {
  if (BG.off) return false;
  const k = DPR * SC;
  if (k !== BG.k) bgReset(k);
  BG.frame++;
  const T = BG.T, m = 16;                       // m：抖屏的余量
  const i0 = Math.floor((vx - m) / T), i1 = Math.floor((vx + W + m) / T);
  const j0 = Math.floor((vy - m) / T), j1 = Math.floor((vy + H + m) / T);
  // 视口外半块：已经画好的先占住（不被挪用），没画的挑一块，等视口里的贴完再补
  const e = T / 2;
  const p0 = Math.floor((vx - m - e) / T), p1 = Math.floor((vx + W + m + e) / T);
  const q0 = Math.floor((vy - m - e) / T), q1 = Math.floor((vy + H + m + e) / T);
  const G = groundOf(layer), Gn = state === 'play' && layerProgress() >= 0.75 ? groundOf(layer + 1) : null;
  const pre = Gn && Gn.id !== G.id;
  BG.cap = (p1 - p0 + 1) * (q1 - q0 + 1) + 4 + (pre ? (i1 - i0 + 1) * (j1 - j0 + 1) : 0);
  let ti = 0, tj = 0, todo = false;
  for (let i = p0; i <= p1; i++) {
    for (let j = q0; j <= q1; j++) {
      if (!bgTile(i, j, false) && !todo && (i < i0 || i > i1 || j < j0 || j > j1)) { ti = i; tj = j; todo = true; }
    }
  }
  // 下一层的视口块：已画的占住，没画的记一块（本层的补位优先）
  let ni = 0, nj = 0, ntodo = false;
  if (pre) {
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (!bgTile(i, j, false, Gn) && !ntodo) { ni = i; nj = j; ntodo = true; }
      }
    }
  }
  const vis = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const t = bgTile(i, j, true);
      if (!t) return false;
      vis.push(t, i, j);
    }
  }
  const s = BG.px / (T + BG.pad);
  for (let a = 0; a < vis.length; a += 3) {
    const x = vis[a + 1] * T, y = vis[a + 2] * T;
    if (y >= cut) continue;
    if (y + T + BG.pad <= cut) { ctx.drawImage(vis[a].c, x, y, T + BG.pad, T + BG.pad); continue; }
    const sh = Math.ceil((cut - y) * s);          // 墨潮盖住的下半截不贴（整像素，多贴一点点也是被墨盖住）
    ctx.drawImage(vis[a].c, 0, 0, BG.px, sh, x, y, T + BG.pad, sh / s);
  }
  if (todo) bgTile(ti, tj, true);
  else if (ntodo) bgTile(ni, nj, true, Gn);
  return true;
}

/* 每层的地面主题：底色、地纹、残骸、浮尘都跟着层名走，破门时换。
   地纹的周期都要整除 WORLD（4500），绕一圈回来接缝才对得上：
   菱格 75、六边骨壳 90 × 150、同心环 450、波纹 75 × 450、裂缝跟残骸一样按 900 的瓦片种 */
const GROUNDS = [
  { id: 'echo',    name: '残响', bg: '#080a0b', pat: 'diamond', line: 'rgba(120,160,190,0.085)', dot: 'rgba(130,185,215,0.10)',
    debris: 'rgba(110,160,195,0.05)', edge: 'rgba(130,185,215,0.10)', dust: '150,215,245' },
  { id: 'whisper', name: '低语', bg: '#071713', pat: 'diamond', gs: 150, line: 'rgba(90,210,165,0.08)', dot: 'rgba(120,235,195,0.16)',
    debris: 'rgba(70,175,135,0.06)', edge: 'rgba(110,225,180,0.12)', dust: '150,240,205', fog: '70,200,155', dustN: 30 },
  { id: 'rift',    name: '裂隙', bg: '#130c08', pat: 'diamond', line: 'rgba(190,130,90,0.06)', dot: 'rgba(255,170,110,0.10)',
    debris: 'rgba(160,110,85,0.06)', edge: 'rgba(220,150,105,0.12)', dust: '255,170,120', crack: '255,130,70', cracks: 6 },
  { id: 'hollow',  name: '空壳', bg: '#141310', pat: 'hex', line: 'rgba(235,225,200,0.14)', cell: 'rgba(235,225,200,0.03)', gloss: 'rgba(255,255,255,0.10)', dot: null,
    debris: 'rgba(210,200,180,0.06)', edge: 'rgba(240,232,215,0.12)', dust: '240,232,215' },
  { id: 'core',    name: '核心', bg: '#0f0819', pat: 'rings', line: 'rgba(180,125,255,0.17)', dot: 'rgba(205,165,255,0.25)',
    debris: 'rgba(145,100,225,0.06)', edge: 'rgba(200,160,255,0.13)', dust: '205,165,255' },
  { id: 'tide',    name: '黑潮', bg: '#061122', pat: 'waves', line: 'rgba(90,150,230,0.16)', dot: null,
    debris: 'rgba(70,115,180,0.06)', edge: 'rgba(115,165,235,0.12)', dust: '130,185,250', dustV: [26, 0] },
  { id: 'void',    name: '无光', bg: '#000000', pat: 'void', line: null, dot: null, noDebris: true,
    debris: 'rgba(90,90,100,0.03)', edge: 'rgba(130,130,140,0.06)', dust: '170,170,180', dustN: 0 },
  { id: 'end',     name: '终末', bg: '#180606', pat: 'diamond', line: 'rgba(225,75,60,0.09)', dot: 'rgba(255,110,90,0.12)',
    debris: 'rgba(160,60,55,0.06)', edge: 'rgba(235,95,85,0.12)', dust: '255,125,100', crack: '255,70,50', cracks: 5, dustV: [0, 34] }
];
// 黑潮试玩一直用第 1 层的地面：layer 借来记第几波，每波换地面要把整屏地面重画一遍
function groundOf(n) { if (hordeMode) n = 1; return GROUNDS[Math.min(GROUNDS.length, Math.max(1, n)) - 1]; }

// 雾团（低语）：450 一格种一团，画地面和"站在雾里"的判定共用这一份
const FOG_CELL = 450;
function fogOf(gx, gy) {
  const n = WORLD / FOG_CELL, r = tileRng(((gx % n) + n) % n + 77, ((gy % n) + n) % n + 31);
  return { x: gx * FOG_CELL + r() * FOG_CELL, y: gy * FOG_CELL + r() * FOG_CELL, r: 90 + r() * 110 };
}
// 裂缝（裂隙 / 终末）：900 的瓦片里种几条折线，每条带一个喷发相位。画地面和"喷发烧人"的判定共用
const crackMap = {};
function cracksOf(tx, ty, cnt) {
  const n = WORLD / TILE, mx = ((tx % n) + n) % n, my = ((ty % n) + n) % n, key = mx + ',' + my + ',' + cnt;
  let list = crackMap[key];
  if (!list) {
    const r = tileRng(mx + 211, my + 97);
    list = [];
    for (let c = 0; c < cnt; c++) {
      let x = r() * TILE, y = r() * TILE, a = r() * Math.PI * 2;
      const pts = [[x, y]];
      for (let k = 0; k < 6; k++) { a += (r() - 0.5) * 1.2; const L = 28 + r() * 36; x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push([x, y]); }
      list.push({ pts: pts, ph: r() });
    }
    crackMap[key] = list;
  }
  return list;
}

// 地面的不动层：画世界里 (vx, vy, w, h) 这一块，按当前层的主题。缓存块和"缓存用不了时整屏现画"走的都是它
function drawGround(vx, vy, w, h, G) {
  G = G || groundOf(layer);
  ctx.fillStyle = G.bg;
  ctx.fillRect(vx - 4, vy - 4, w + 8, h + 8);

  // 雾团（低语）：几层同心实心圆叠出来的软边，不用渐变（真机上渐变时有时无）。按 450 的格子种
  if (G.fog) {
    const F = 450;
    for (let gx = Math.floor((vx - 200) / F); gx <= Math.floor((vx + w + 200) / F); gx++) {
      for (let gy = Math.floor((vy - 200) / F); gy <= Math.floor((vy + h + 200) / F); gy++) {
        const f = fogOf(gx, gy), cx = f.x, cy = f.y, R = f.r;
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = 'rgba(' + G.fog + ',0.028)';
          ctx.beginPath(); ctx.arc(cx, cy, R * (1 - k * 0.22), 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  // 地纹
  ctx.lineWidth = 1;
  if (G.pat === 'diamond') {
    // 斜向的菱格，对齐世界原点：移动时是"地面在动"。gs 必须整除 WORLD（75 / 150）
    const gs = G.gs || WORLD / 60;
    ctx.strokeStyle = G.line;
    ctx.beginPath();
    for (let c = Math.floor((vx + vy) / gs) * gs; c <= vx + vy + w + h; c += gs) {
      ctx.moveTo(c - vy, vy); ctx.lineTo(c - vy - h, vy + h);
    }
    for (let c = Math.floor((vx - vy - h) / gs) * gs; c <= vx + w - vy; c += gs) {
      ctx.moveTo(vy + c, vy); ctx.lineTo(vy + h + c, vy + h);
    }
    ctx.stroke();
    if (G.dot) {
      // 菱格交点上的小菱形光点（隔一个点一个）：远看是尘，近看是坐标
      ctx.fillStyle = G.dot;
      ctx.beginPath();
      const g2 = gs * 2;
      for (let a = Math.floor((vx + vy) / g2) * g2; a <= vx + vy + w + h; a += g2) {
        for (let b = Math.floor((vx - vy - h) / g2) * g2; b <= vx + w - vy; b += g2) {
          const x = (a + b) / 2, y = (a - b) / 2;
          if (x < vx - 4 || x > vx + w + 4 || y < vy - 4 || y > vy + h + 4) continue;
          ctx.moveTo(x, y - 2); ctx.lineTo(x + 1.4, y); ctx.lineTo(x, y + 2); ctx.lineTo(x - 1.4, y); ctx.closePath();
        }
      }
      ctx.fill();
    }
  } else if (G.pat === 'hex') {
    // 六边骨壳：横 90 一格、两行 150 一个周期，一格一格分开画（留缝 = 骨壳的接缝）
    const cw = 90, rh = 75, R = 46;
    if (G.cell) {
      ctx.fillStyle = G.cell;
      ctx.beginPath();
      for (let row = Math.floor((vy - R) / rh); row <= Math.floor((vy + h + R) / rh); row++) {
        const ox = (((row % 2) + 2) % 2) * cw / 2;
        for (let col = Math.floor((vx - R - ox) / cw); col <= Math.floor((vx + w + R - ox) / cw); col++) {
          if (((col + row) % 3 + 3) % 3) continue;
          const cx = col * cw + ox, cy = row * rh;
          for (let k = 0; k <= 6; k++) {
            const a = Math.PI / 6 + k * Math.PI / 3, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R * 0.92;
            if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
        }
      }
      ctx.fill();
    }
    if (G.gloss) {
      // 斜着的一道反光：骨壳是滑的
      ctx.strokeStyle = G.gloss;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let row = Math.floor((vy - R) / rh); row <= Math.floor((vy + h + R) / rh); row++) {
        const ox = (((row % 2) + 2) % 2) * cw / 2;
        for (let col = Math.floor((vx - R - ox) / cw); col <= Math.floor((vx + w + R - ox) / cw); col++) {
          if (((col * 2 + row) % 5 + 5) % 5) continue;
          const cx = col * cw + ox, cy = row * rh;
          ctx.moveTo(cx - R * 0.45, cy + R * 0.2); ctx.lineTo(cx + R * 0.1, cy - R * 0.45);
          ctx.moveTo(cx - R * 0.2, cy + R * 0.35); ctx.lineTo(cx + R * 0.05, cy + R * 0.05);
        }
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = G.line;
    ctx.beginPath();
    for (let row = Math.floor((vy - R) / rh); row <= Math.floor((vy + h + R) / rh); row++) {
      const ox = (((row % 2) + 2) % 2) * cw / 2;
      for (let col = Math.floor((vx - R - ox) / cw); col <= Math.floor((vx + w + R - ox) / cw); col++) {
        const cx = col * cw + ox, cy = row * rh;
        for (let k = 0; k <= 6; k++) {
          const a = Math.PI / 6 + k * Math.PI / 3, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R * 0.92;
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
      }
    }
    ctx.stroke();
  } else if (G.pat === 'rings') {
    // 同心环：每 450 一个圆心，三圈 + 圆心一点；底下垫一层很淡的菱格
    const F = 450;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = G.line;
    ctx.beginPath();
    for (let gx = Math.floor((vx - 240) / F); gx <= Math.floor((vx + w + 240) / F); gx++) {
      for (let gy = Math.floor((vy - 240) / F); gy <= Math.floor((vy + h + 240) / F); gy++) {
        const cx = gx * F + F / 2, cy = gy * F + F / 2;
        for (let k = 1; k <= 3; k++) { ctx.moveTo(cx + k * 70, cy); ctx.arc(cx, cy, k * 70, 0, Math.PI * 2); }
      }
    }
    ctx.stroke();
    if (G.dot) {
      ctx.fillStyle = G.dot;
      ctx.beginPath();
      for (let gx = Math.floor((vx - 10) / F); gx <= Math.floor((vx + w + 10) / F); gx++) {
        for (let gy = Math.floor((vy - 10) / F); gy <= Math.floor((vy + h + 10) / F); gy++) {
          const cx = gx * F + F / 2, cy = gy * F + F / 2;
          ctx.moveTo(cx + 4, cy); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }
  } else if (G.pat === 'waves') {
    // 波纹：每 75 一道，横向 450 一个波长；相位 6 道一轮回（6 × 75 = 450，整除 WORLD）
    const sp = 75, L = 450, A = 20;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = G.line;
    ctx.beginPath();
    for (let k = Math.floor((vy - A) / sp); k <= Math.floor((vy + h + A) / sp); k++) {
      const ph = (((k % 6) + 6) % 6) * Math.PI / 3, y0 = k * sp;
      for (let x = Math.floor(vx / 15) * 15 - 15; x <= vx + w + 15; x += 15) {
        const y = y0 + A * Math.sin(x / L * Math.PI * 2 + ph);
        if (x === Math.floor(vx / 15) * 15 - 15) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  } else if (G.pat === 'void') {
    // 无光：只剩极稀的光点，225 一个
    if (G.dot) {
      ctx.fillStyle = G.dot;
      ctx.beginPath();
      const F = 225;
      for (let x = Math.floor(vx / F) * F; x <= vx + w; x += F) {
        for (let y = Math.floor(vy / F) * F; y <= vy + h; y += F) {
          ctx.moveTo(x + 1.5, y); ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }
  }

  // 发光裂缝（裂隙 / 终末）：按 900 的瓦片种几条折线，外面一层宽而淡的光、里面一道细亮的缝
  if (G.crack) {
    const DR = 260;
    for (let tx = Math.floor((vx - DR) / TILE); tx <= Math.floor((vx + w + DR) / TILE); tx++) {
      for (let ty = Math.floor((vy - DR) / TILE); ty <= Math.floor((vy + h + DR) / TILE); ty++) {
        const cl = cracksOf(tx, ty, G.cracks || 3), ox = tx * TILE, oy = ty * TILE;
        for (let c = 0; c < cl.length; c++) {
          const pts = cl[c].pts;
          for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass ? 'rgba(' + G.crack + ',0.55)' : 'rgba(' + G.crack + ',0.12)';
            ctx.lineWidth = pass ? 1.5 : 8;
            ctx.beginPath();
            for (let k = 0; k < pts.length; k++) { if (k) ctx.lineTo(ox + pts[k][0], oy + pts[k][1]); else ctx.moveTo(ox + pts[k][0], oy + pts[k][1]); }
            ctx.stroke();
          }
        }
      }
    }
    ctx.lineWidth = 1;
  }

  if (G.noDebris) return;             // 无光：地上什么都没有
  // 晶墟残骸：凡是伸进这一块的都画。一团最远伸出团心约 180（碎片散开 ±48、半径 ≤ 29，再乘缩放 ≤ 1.8），
  // 只按团心所在的瓦片挑会漏掉跨边的那几团 —— 缓存块的接缝上就会被切掉半团
  buildBackdrop();
  const DR = 180;
  const tx0 = Math.floor((vx - DR) / TILE), tx1 = Math.floor((vx + w + DR) / TILE);
  const ty0 = Math.floor((vy - DR) / TILE), ty1 = Math.floor((vy + h + DR) / TILE);
  // 一块地面上的碎片全攒进三笔：身子一笔填、边一笔描、朝光的那道棱一笔描（顶点自己转，不再每片 save / rotate / restore）。
  // 以前一片三笔，一块地面四十来片 = 一百多笔，往上跑一秒要现画好几块（1024.1253 真机上大半的卡顿帧）
  const body = [], hi = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const list = tileDebris(tx, ty);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const cx = tx * TILE + c.x, cy = ty * TILE + c.y;
        if (cx < vx - DR || cx > vx + w + DR || cy < vy - DR || cy > vy + h + DR) continue;
        for (let j = 0; j < c.shards.length; j++) {
          const sh = c.shards[j], co = Math.cos(sh.a), si = Math.sin(sh.a), sc = c.scale;
          const ox = cx + sh.dx * sc, oy = cy + sh.dy * sc, r = sh.r * sc, q = sh.r * sh.k * sc;
          // 菱形四个角：(r, 0) (0, q) (-r, 0) (0, -q)，转 a 度
          body.push(ox + co * r, oy + si * r, ox - si * q, oy + co * q, ox - co * r, oy - si * r, ox + si * q, oy - co * q);
          hi.push(ox + co * r, oy + si * r, ox + si * q, oy - co * q);
        }
      }
    }
  }
  if (body.length) {
    ctx.beginPath();
    for (let k = 0; k < body.length; k += 8) {
      ctx.moveTo(body[k], body[k + 1]); ctx.lineTo(body[k + 2], body[k + 3]);
      ctx.lineTo(body[k + 4], body[k + 5]); ctx.lineTo(body[k + 6], body[k + 7]); ctx.closePath();
    }
    ctx.fillStyle = G.debris;
    ctx.fill();
    ctx.strokeStyle = G.edge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < hi.length; k += 4) { ctx.moveTo(hi[k], hi[k + 1]); ctx.lineTo(hi[k + 2], hi[k + 3]); }
    ctx.strokeStyle = 'rgba(' + G.dust + ',0.14)';
    ctx.stroke();
  }
}

// 浮尘的整体漂移（累计位移）：终末往下落灰；黑潮跟着潮流走（见 tide）
let dustOff = [0, 0];
function dustDrift(G) { return dustOff; }
function tickDust(dt) {
  const G = groundOf(layer);
  let vx = 0, vy = 0;
  if (G.dustV) { vx = G.dustV[0]; vy = G.dustV[1]; }
  if (layerFeat() === 'tide') { vx = Math.cos(tideA) * 70; vy = Math.sin(tideA) * 70; }
  dustOff[0] += vx * dt; dustOff[1] += vy * dt;
}

function drawBackground() {
  // 视口的世界范围：镜头看到的那一块
  const vx = cam.x - W / 2, vy = cam.y - H / 2;
  if (!bgCached(vx, vy, hInkSolid())) drawGround(vx, vy, W, H);

  // 段位染色（见 BGT）：整片纯色铺一层，不用渐变（真机上渐变时有时无）
  if (BGT.a > 0.004 && state !== 'ready' && !hordeMode) {     // 黑潮试玩不铺：连斩几乎一直挂着，整屏半透明一笔很费
    ctx.fillStyle = 'rgba(' + Math.round(BGT.r) + ',' + Math.round(BGT.g) + ',' + Math.round(BGT.b) + ',' + BGT.a.toFixed(3) + ')';
    ctx.fillRect(vx - 4, vy - 4, W + 8, H + 8);
  }

  // 浮尘：视差层。位置对镜头取模循环，永远铺满视口，且比地面慢 —— 纵深感的来源。
  // 视差要按展开后的镜头位置算（cam + camLap），跨界时才不会整层跳走
  const t = nowMs() / 1000;
  const pdx = (cam.x + camLap.x) * 0.85, pdy = (cam.y + camLap.y) * 0.85;
  const G = groundOf(layer), dv = dustDrift(G), dn = Math.min(dust.length, G.dustN !== undefined ? G.dustN : dust.length);
  ctx.fillStyle = 'rgba(' + G.dust + ',0.10)';
  ctx.beginPath();
  for (let i = 0; i < dn; i++) {
    const d0 = dust[i];
    const dx = d0.x + d0.vx * t + dv[0] + Math.sin(t * 0.7 + d0.ph) * 14 - pdx;
    const dy = d0.y + d0.vy * t + dv[1] + Math.cos(t * 0.5 + d0.ph) * 11 - pdy;
    const x = vx + ((dx % W) + W) % W;
    const y = vy + ((dy % H) + H) % H;
    ctx.moveTo(x + d0.r, y);
    ctx.arc(x, y, d0.r, 0, Math.PI * 2);
  }
  ctx.fill();

  // 暗角跟着镜头走，别钉在世界原点（真机上时有时无，见 CFG.veil）
  if (!CFG.veil) return;
  const g = ctx.createRadialGradient(
    cam.x, cam.y, Math.min(W, H) * 0.25,
    cam.x, cam.y, Math.max(W, H) * 0.75
  );
  g.addColorStop(0, THEME.vigInner);
  g.addColorStop(1, THEME.vigOuter);
  ctx.fillStyle = g;
  ctx.fillRect(vx - 4, vy - 4, W + 8, H + 8);
}

// 光圈里的地面：一层很淡的光，颜色跟主角走 —— 连斩越高，脚下的光越烫
function drawLightPool() {
  if (!CFG.darkness || hordeMode) return;      // 黑潮试玩全场都亮：脚下这片光放大了在真机上很费，不画
  const L = lightR() * 1.1 * (0.45 + 0.55 * lightL);      // 光少了，脚下这片光也跟着缩
  const hc = heroColor(), h = FB.heat;
  const spr = lightPoolSprite(hc);
  if (spr) {
    ctx.globalAlpha = 0.06 + 0.05 * h;
    ctx.drawImage(spr, P.x - L, P.y - L, L * 2, L * 2);
    ctx.globalAlpha = 1;
    return;
  }
  const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, L);
  g.addColorStop(0, rgba(hc, (0.06 + 0.05 * h).toFixed(3)));
  g.addColorStop(0.6, rgba(hc, (0.025 + 0.025 * h).toFixed(3)));
  g.addColorStop(1, rgba(hc, 0));
  ctx.fillStyle = g;
  ctx.fillRect(P.x - L, P.y - L, L * 2, L * 2);
}
// 脚下光的贴图：同一条渐变先画进 128px 的小图，每帧放大贴一次（每帧现画半屏大的渐变，手机上要几毫秒）。
// 按颜色缓存；换段位时主角颜色一帧一个过渡色，所以留一圈 12 张轮着用，最早的那张重画成新颜色。
// 中间那档透明度按 heat 一半算（真值 0.42~0.45，差不出来），整体亮度在贴的时候乘
const LPS = { ring: [], keys: [], at: 0, max: 12, off: false };
function lightPoolSprite(hc) {
  if (LPS.off) return null;
  const i = LPS.keys.indexOf(hc);
  if (i >= 0) return LPS.ring[i];
  try {
    let c, j;
    if (LPS.ring.length < LPS.max) {
      c = IS_MG ? MG.createCanvas() : document.createElement('canvas');
      c.width = c.height = 128;
      j = LPS.ring.length; LPS.ring.push(c); LPS.keys.push(hc);
    } else {
      j = LPS.at; LPS.at = (j + 1) % LPS.max; c = LPS.ring[j]; LPS.keys[j] = hc;
    }
    const g = ctx2d(c);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 128, 128);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(hc, 1));
    gr.addColorStop(0.6, rgba(hc, 0.435));
    gr.addColorStop(1, rgba(hc, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
  } catch (e) { LPS.off = true; return null; }
}

// 晶柱：场上唯一"能被打碎的家具"。淡蓝的六棱柱，光扫过时才看得见。
function drawCrystals() {
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    const t = nowMs() / 1000;
    const wob = 1 + Math.sin(t * 1.1 + c.spin) * 0.03;
    const hx = c.r * 0.62 * wob, hy = c.r * 1.12 * wob;

    // 刚从光外长出来时，从地里"撑"起来：先有个小环，再立成柱子
    const grow = c.age < 9 ? clamp(c.age / CFG.crystalGrow, 0, 1) : 1;
    const ge = grow * grow * (3 - 2 * grow);

    ctx.save();
    ctx.translate(wdx(c.x), wdy(c.y));
    ctx.scale(0.55 + 0.45 * ge, 0.30 + 0.70 * ge);
    ctx.globalAlpha = 0.15 + 0.85 * ge;

    // 柱身：上下两个六边形，中间两条棱
    ctx.beginPath();
    ctx.moveTo(0, -hy);
    ctx.lineTo(hx, -hy * 0.42);
    ctx.lineTo(hx, hy * 0.42);
    ctx.lineTo(0, hy);
    ctx.lineTo(-hx, hy * 0.42);
    ctx.lineTo(-hx, -hy * 0.42);
    ctx.closePath();
    ctx.fillStyle = 'rgba(22,42,58,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(' + THEME.viewRing + ',0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 内部一条折光：让它是"晶体"而不是一块石头
    ctx.beginPath();
    ctx.moveTo(0, -hy * 0.86);
    ctx.lineTo(-hx * 0.34, 0);
    ctx.lineTo(0, hy * 0.86);
    ctx.strokeStyle = 'rgba(' + THEME.viewRing + ',0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 左上那一面迎着光：一道亮棱；柱顶一颗慢慢闪的星
    ctx.beginPath();
    ctx.moveTo(-hx, -hy * 0.42);
    ctx.lineTo(0, -hy);
    ctx.strokeStyle = 'rgba(235,250,255,0.5)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const tw = 0.5 + 0.5 * Math.sin(t * 2.6 + c.spin * 3);
    if (tw > 0.55) {
      const sz = 2 + (tw - 0.55) * 9, sx = hx * 0.25, sy = -hy * 0.72;
      ctx.globalAlpha *= (tw - 0.55) / 0.45;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(sx, sy - sz); ctx.lineTo(sx + sz * 0.22, sy); ctx.lineTo(sx, sy + sz); ctx.lineTo(sx - sz * 0.22, sy);
      ctx.closePath();
      ctx.moveTo(sx - sz, sy); ctx.lineTo(sx, sy + sz * 0.22); ctx.lineTo(sx + sz, sy); ctx.lineTo(sx, sy - sz * 0.22);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

// 爆裂者的引信：一圈往外涨的红环，涨满就炸。
// 它必须比任何特效都清楚 —— 玩家只有 0.6 秒做决定。
function drawBlasts() {
  for (let i = 0; i < blasts.length; i++) {
    const b = blasts[i];
    const k = clamp(b.t / b.fuse, 0, 1);
    const rr = b.r * (0.42 + 0.58 * k);
    const bx = wdx(b.x), by = wdy(b.y);

    const fc = THEME.foe.bomb, hot = k > 0.75;
    ctx.globalAlpha = 0.08 + 0.16 * k;
    ctx.fillStyle = hot ? '#ffb06a' : fc;
    ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.fill();

    ctx.globalAlpha = 0.35 + 0.55 * k;
    ctx.strokeStyle = hot ? '#ffd0a0' : fc;
    ctx.lineWidth = 2 + k * 2.2;
    ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.stroke();
    // 倒计时：外面一圈白线从 12 点扫过去，扫满就炸
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, b.r + 5, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 晶柱碎片：短促的亮线，飞得越远越淡
function drawShards() {
  ctx.lineCap = 'round';
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const a = clamp(s.life / s.max, 0, 1);
    const sx = wdx(s.x), sy = wdy(s.y);
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = 'rgb(' + THEME.viewRing + ')';
    ctx.lineWidth = 1.6 + a * 1.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - s.vx * 0.028, sy - s.vy * 0.028);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 地面残留。恐怖版是血，合规版是冷却的光痕。
// 所有墨渍按深浅分 6 档，同一档的攒成一条路径、一笔填完：手机上每一笔都要 25~60 微秒（画布测速），
// 以前一块一笔、或者一块贴一张放大的半透明图（逐个像素混合，墨渍一项实测 5~21ms），连斩一高就扛不住
function drawStains() {
  ctx.fillStyle = THEME.stain;
  for (let q = 1; q <= 6; q++) {
    let any = false;
    for (let i = 0; i < stains.length; i++) {
      const b = stains[i], a = clamp(b.life / b.max, 0, 1);
      if (Math.ceil(a * 6) !== q) continue;
      if (!any) { ctx.beginPath(); any = true; }
      stainPath(b, a);
    }
    if (any) { ctx.globalAlpha = q / 6 * 0.7; ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
// 一块墨溅：一圈九个高低不齐的边 + 两滴溅出去的小点，转一个角度、竖向压扁到 0.72（形状第一次画时定下来，之后不变）。
// 直接算出屏幕坐标加进当前路径，不用 save / 变换 / restore
function stainPath(b, a) {
  if (!b.sh) {
    b.sh = []; for (let k = 0; k < 9; k++) b.sh.push(rand(0.62, 1.15));
    b.dr = rand(1.25, 1.6); b.ca = Math.cos(b.a); b.sa = Math.sin(b.a);
  }
  const cx = wdx(b.x), cy = wdy(b.y), ca = b.ca, sa = b.sa;
  const rr = b.r * (0.8 + (1 - a) * 0.5);       // 慢慢晕开
  for (let k = 0; k <= 9; k++) {
    const an = (k / 9) * Math.PI * 2, q = rr * b.sh[k % 9];
    const lx = Math.cos(an) * q, ly = Math.sin(an) * q * 0.72;
    const x = cx + lx * ca - ly * sa, y = cy + lx * sa + ly * ca;
    if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  let lx = rr * b.dr, ly = 0;
  ctx.moveTo(cx + lx * ca + 3, cy + lx * sa);
  ctx.arc(cx + lx * ca, cy + lx * sa, 3, 0, Math.PI * 2);
  lx = -rr * 0.9; ly = rr * 1.1 * 0.72;
  ctx.moveTo(cx + lx * ca - ly * sa + 2, cy + lx * sa + ly * ca);
  ctx.arc(cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, 2, 0, Math.PI * 2);
}

// 甲环碎片：第一刀劈开后飞出去的六块甲片，0.5 秒散尽。
// 环"碎掉"这个动作本身就是反馈 —— 所以它必须真的离开身体，而不是原地变暗。
function drawArmorBits() {
  ctx.lineCap = 'butt';
  for (let i = 0; i < armorBits.length; i++) {
    const b = armorBits[i];
    const a = clamp(b.life / b.max, 0, 1);
    ctx.globalAlpha = a * 0.8;
    ctx.strokeStyle = 'rgba(255,150,82,0.92)';
    ctx.lineWidth = 1.4 + a * 1.9;
    ctx.beginPath();
    ctx.arc(wdx(b.x), wdy(b.y), b.r, b.rot, b.rot + b.arc);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 刀环：击杀瞬间从刀口向外扩一圈，0.2 秒消失。局部、便宜、不刺眼。
function drawRings() {
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    const t = 1 - r.life / r.max;
    const rad = r.r0 + (r.r1 - r.r0) * t;
    ctx.globalAlpha = (1 - t) * 0.6;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.w * (1 - t) + 0.6;
    ctx.beginPath();
    ctx.arc(wdx(r.x), wdy(r.y), rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 刀诀的场上画面（2.9 节）。照"每一笔都贵"：同一种东西攒成一条路径一笔画完 ——
// 电光两笔、刀痕至多三笔、飞刃一笔、唱片三笔、看呆的圈一笔，不管场上有几个
function drawCards() {
  if (!CFG.cards) return;
  const live = state === 'play' || state === 'pick' || state === 'pause';   // 死了以后飞刃 / 唱片不再画

  // 连锁：一道折线电光。点是从第一只展开的（不跨界跳），整条按第一个点平移到镜头附近；
  // 每段中间插两个随机抖开的点，每帧都不一样 —— 看着就是在噼啪闪
  if (zaps.length) {
    let a = 0;
    ctx.beginPath();
    for (let i = 0; i < zaps.length; i++) {
      const z = zaps[i], p = z.pts;
      a = Math.max(a, z.life / z.max);
      const ox = wdx(p[0]) - p[0], oy = wdy(p[1]) - p[1];
      ctx.moveTo(p[0] + ox, p[1] + oy);
      for (let k = 2; k < p.length; k += 2) {
        const x0 = p[k - 2] + ox, y0 = p[k - 1] + oy, x1 = p[k] + ox, y1 = p[k + 1] + oy;
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
        for (let m = 1; m <= 2; m++) {
          const t = m / 3, j = rand(-10, 10);
          ctx.lineTo(x0 + dx * t + nx * j, y0 + dy * t + ny * j);
        }
        ctx.lineTo(x1, y1);
      }
    }
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.55 * a;
    ctx.strokeStyle = CARD_MAP.chain.c;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.lineJoin = 'miter';
  }

  // 残影：还没割的刀痕一道细线（越快割越亮），刚割完的那一下亮成一道宽刃
  if (echoes.length) {
    let wait = 0, fl = 0, fw = 0;
    for (let i = 0; i < echoes.length; i++) {
      if (echoes[i].n > 0) wait = Math.max(wait, 1 - echoes[i].t / CD.echoT);
      if (echoes[i].fl > 0) { fl = Math.max(fl, echoes[i].fl / 0.14); fw = Math.max(fw, echoes[i].w); }
    }
    const c = CARD_MAP.echo.c;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 3; pass++) {
      if (pass === 0 ? wait <= 0 : fl <= 0) continue;
      ctx.beginPath();
      for (let i = 0; i < echoes.length; i++) {
        const m = echoes[i];
        if (pass === 0 ? m.n <= 0 : m.fl <= 0) continue;
        const x0 = wdx(m.x0), y0 = wdy(m.y0);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + (m.x1 - m.x0), y0 + (m.y1 - m.y0));
      }
      if (pass === 0) { ctx.globalAlpha = 0.2 + 0.45 * clamp(wait, 0, 1); ctx.strokeStyle = c; ctx.lineWidth = 2; }
      else if (pass === 1) { ctx.globalAlpha = 0.6 * fl; ctx.strokeStyle = c; ctx.lineWidth = fw; }
      else { ctx.globalAlpha = 0.9 * fl; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4; }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  if (live && blades.length) {
    // 飞刃：一片细长的菱形刃，尖朝前
    ctx.beginPath();
    for (let i = 0; i < blades.length; i++) {
      const b = blades[i], x = wdx(b.x), y = wdy(b.y), nx = -b.dy, ny = b.dx;
      ctx.moveTo(x + b.dx * 16, y + b.dy * 16);
      ctx.lineTo(x + nx * 9 - b.dx * 3, y + ny * 9 - b.dy * 3);
      ctx.lineTo(x - b.dx * 20, y - b.dy * 20);
      ctx.lineTo(x - nx * 9 - b.dx * 3, y - ny * 9 - b.dy * 3);
      ctx.closePath();
    }
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = CARD_MAP.blade.c;
    ctx.fill();
  }

  const ld = live ? clv('disc') : 0;
  if (ld) {
    // 打碟：黑胶唱片绕身转 —— 黑盘、粉色唱片边、中间一枚标签
    const n = CD.discN[ld], R = CD.discR[ld], r = CD.discHit, px = wdx(P.x), py = wdy(P.y);
    ctx.globalAlpha = 1;
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const a = discA + k * Math.PI * 2 / n, x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
        const rr = pass === 2 ? r * 0.38 : r;
        ctx.moveTo(x + rr, y);
        ctx.arc(x, y, rr, 0, Math.PI * 2);
      }
      if (pass === 0) { ctx.fillStyle = '#16090f'; ctx.fill(); }
      else if (pass === 1) { ctx.strokeStyle = CARD_MAP.disc.c; ctx.lineWidth = 2.6; ctx.stroke(); }
      else { ctx.fillStyle = CARD_MAP.disc.c; ctx.fill(); }
    }
  }

  // 围观：看呆了的怪套一圈细环 —— 这一圈撞上去不死
  if (live && clv('pull')) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!(e.stun > 0)) continue;
      const x = wdx(e.x), y = wdy(e.y), rr = e.r + 6;
      ctx.moveTo(x + rr, y);
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      any = true;
    }
    if (any) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = CARD_MAP.pull.c;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// 嘉欣糖（2.11 节）：黑糖纸两头拧成小三角、中间一颗粉糖，上下浮一点。只画亮着的那几颗、屏幕附近的；
// 照"每一笔都贵"攒成几笔：外面一圈淡粉光、糖纸、糖心各一笔，下一颗再套一圈呼吸的环
function drawCandies() {
  if (!candies.length) return;
  const t = gameTime, mx = W / 2 + 40, my = H / 2 + 40, vis = [];
  for (let i = 0; i < candies.length; i++) {
    const c = candies[i];
    if (!candyOn(c)) continue;
    const x = wdx(c.x), y = wdy(c.y) + Math.sin(t * 3 + c.i) * 3;
    if (Math.abs(x - cam.x) > mx || Math.abs(y - cam.y) > my) continue;
    vis.push(x, y, c.i);
  }
  if (!vis.length) return;
  ctx.beginPath();
  for (let k = 0; k < vis.length; k += 3) { ctx.moveTo(vis[k] + 24, vis[k + 1]); ctx.arc(vis[k], vis[k + 1], 24, 0, Math.PI * 2); }
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = CANDY_C;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (let k = 0; k < vis.length; k += 3) {
    const x = vis[k], y = vis[k + 1];
    ctx.moveTo(x - 8, y); ctx.lineTo(x - 19, y - 8); ctx.lineTo(x - 19, y + 8); ctx.closePath();
    ctx.moveTo(x + 8, y); ctx.lineTo(x + 19, y - 8); ctx.lineTo(x + 19, y + 8); ctx.closePath();
  }
  ctx.fillStyle = '#2a1020';
  ctx.fill();
  ctx.strokeStyle = CANDY_C;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < vis.length; k += 3) { ctx.moveTo(vis[k] + 10, vis[k + 1]); ctx.arc(vis[k], vis[k + 1], 10, 0, Math.PI * 2); }
  ctx.fillStyle = CANDY_C;
  ctx.fill();
  for (let k = 0; k < vis.length; k += 3) {
    if (vis[k + 2] !== candyNext) continue;
    ctx.beginPath();
    ctx.arc(vis[k], vis[k + 1], 30 + 4 * Math.sin(t * 6), 0, Math.PI * 2);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// 这一层的门：两根柱子 + 一道门楣（一笔），门洞里一片金光（一笔），外面一圈呼吸的光（一笔），头顶一个"门"字。
// 教学没教到「破门」时斩不开：画暗一点
function drawDoor() {
  if (!doorOn()) return;
  const x = wdx(door.x), y = wdy(door.y);
  if (Math.abs(x - cam.x) > W / 2 + 80 || Math.abs(y - cam.y) > H / 2 + 80) return;
  const k = 0.5 + 0.5 * Math.sin(gameTime * 4), held = gateHeld();
  ctx.beginPath();
  ctx.arc(x, y, 66 + 8 * k, 0, Math.PI * 2);
  ctx.globalAlpha = held ? 0.06 : 0.12 + 0.08 * k;
  ctx.fillStyle = UI.gold;
  ctx.fill();
  ctx.globalAlpha = held ? 0.4 : 0.3 + 0.25 * k;
  ctx.fillRect(x - 21, y - 38, 42, 66);
  ctx.globalAlpha = held ? 0.5 : 1;
  ctx.beginPath();
  ctx.rect(x - 33, y - 39, 12, 68);
  ctx.rect(x + 21, y - 39, 12, 68);
  ctx.rect(x - 40, y - 51, 80, 13);
  ctx.fillStyle = '#1a1406';
  ctx.fill();
  ctx.strokeStyle = UI.gold;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = 'center';
  uf(900, 28);
  ctx.fillStyle = UI.gold;
  ctx.fillText('门', x, y - 64);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

// 光（2.11 节）：主角身边一圈，光越少圈越往里缩（满的时候只到斩杀圈的七成，别和红虚线挨成双圈）。
// 快灭了变橙、再低变红并且一闪一闪。两笔：一道宽而淡的光晕 + 一道细亮的线
function drawLightRing() {
  if (hordeMode) return;
  const r = reach() * (0.18 + 0.52 * lightL), low = lightL < CFG.lightLow;
  const c = lightL < CFG.lightLow * 0.6 ? '#ff5a4a' : (low ? '#ff9a5c' : '#bff6ff');
  const pk = low ? 0.5 + 0.5 * Math.sin(nowMs() / 90) : 1;
  ctx.beginPath();
  ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = c;
  ctx.globalAlpha = 0.14 * pk;
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.globalAlpha = low ? 0.5 + 0.4 * pk : 0.6;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// 预告下一刀：按住「斩」时，自动连斩下一刀要去的那只（和 update 里长按连斩同一套挑法）身上套四个转着的角。
// 下一刀去哪一直看得见；不想去那儿就拖摇杆换方向。要斩的是爆裂者就变红 —— 斩了它会炸。一笔描完
function drawAimMark() {
  if (state !== 'play' || !attackHeld || !CFG.autoRepeat || hordeMode) return;
  const t = lockOn(inputDir());
  if (!t) return;
  const x = wdx(t.x), y = wdy(t.y), r = t.r + 14, a0 = gameTime * 2.4, L = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = a0 + i * Math.PI / 2;
    ctx.moveTo(x + Math.cos(a - L / 2) * r, y + Math.sin(a - L / 2) * r);
    ctx.arc(x, y, r, a - L / 2, a + L / 2);
  }
  ctx.strokeStyle = t.bomb ? '#ff4a3a' : '#ffffff';
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// 刀光拖尾：最近一小段刀路连成一条由细到粗的光带，越新越亮。
// 相邻点之间走"中点 + 二次曲线"，连斩的拐角会被画成一小段弧，而不是一个硬折角。
// 外层宽而淡的辉光 + 内层细亮的刃光两遍描边，不用 shadowBlur
function drawDashTrail() {
  const n = trail.length;
  if (n < 3) return;
  ctx.save();
  ctx.lineCap = 'butt';             // 段与段在中点相切相接，butt 才不会在接缝叠出亮珠
  // 外层辉光跟着连斩段位换色：越连刀光越烫（内层刃光始终是白的）
  // 穿了皮肤：外层用皮肤的刀光色（2.13 节）
  const glow = (hordeMode && heroSkin().light) || (FB.tier >= 0 ? tierColor(FB.tier) : THEME.ghost);
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? THEME.playerCore : glow;
    for (let i = 1; i < n; i++) {
      const a = trail[i - 1], b = trail[i];
      const k = (i / (n - 1)) * clamp(b.life / b.max, 0, 1);
      if (k < 0.04) continue;
      const ax = wdx(a.x), ay = wdy(a.y), bx = wdx(b.x), by = wdy(b.y);
      let ex = bx, ey = by;
      if (i < n - 1) { const c = trail[i + 1]; ex = (bx + wdx(c.x)) / 2; ey = (by + wdy(c.y)) / 2; }
      ctx.globalAlpha = pass ? 0.55 * k : 0.16 * k;
      ctx.lineWidth = pass ? 0.6 + 2.2 * k : P.r * 1.5 * k;
      ctx.beginPath();
      ctx.moveTo((ax + bx) / 2, (ay + by) / 2);
      ctx.quadraticCurveTo(bx, by, ex, ey);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 转身刀弧：连斩换方向那一下，刀绕着身子从旧方向扫到新方向，0.2 秒散掉。
// 前 70ms 是"扫"的过程，之后只淡出；弧由细到粗分四段，粗的一头是刀口
function drawTurns() {
  if (!turns.length) return;
  ctx.save();
  ctx.lineCap = 'butt';
  for (let i = 0; i < turns.length; i++) {
    const tr = turns[i];
    const t = 1 - tr.life / tr.max;
    const fade = 1 - t;
    const x = wdx(tr.x), y = wdy(tr.y);
    const rad = P.r * (1.7 + 1.3 * t);
    const seg = 4, step = tr.da * Math.min(1, t / 0.35) / seg;
    for (let s = 0; s < seg; s++) {
      const w = (s + 1) / seg;
      const a = tr.a0 + step * s;
      ctx.globalAlpha = fade * (0.25 + 0.55 * w);
      ctx.strokeStyle = s === seg - 1 ? THEME.playerCore : heroColor();
      ctx.lineWidth = (1 + 3.2 * w) * fade + 0.5;
      ctx.beginPath();
      ctx.arc(x, y, rad, a, a + step, tr.da < 0);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 嘉豪本体（原点、朝 +x、已经转好方向）：披风尾迹、太刀、身体和发光核。sk：穿着的皮肤（2.13 节），hc 身体颜色，sq 冲刺压扁。
// 局里 drawPlayer 用，商店里的预览也用
function drawHeroBody(sk, hc, sq) {
  // —— 披风尾迹：从身后收束成一点，像个提刀疾行的人被光拉长的影子 ——
  const tail = -P.r * (1.7 + sq * 0.9);      // 冲刺瞬间披风被拉长
  ctx.beginPath();
  ctx.moveTo(-P.r * 0.15, -P.r * 0.78);
  ctx.quadraticCurveTo(tail * 0.55, -P.r * 0.30, tail, 0);
  ctx.quadraticCurveTo(tail * 0.55, P.r * 0.30, -P.r * 0.15, P.r * 0.78);
  ctx.closePath();
  ctx.fillStyle = sk.cloak || THEME.cloak;
  ctx.fill();

  // —— 太刀：刀柄 → 刀镡 → 微弧刀身 ——
  // 刀柄（在身后再画一点握持感）
  ctx.fillStyle = sk.hilt || THEME.hilt;
  ctx.fillRect(-P.r * 0.95, -P.r * 0.10, P.r * 1.05, P.r * 0.20);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();                            // 柄卷：缠柄的两道斜纹
  ctx.moveTo(-P.r * 0.62, -P.r * 0.10); ctx.lineTo(-P.r * 0.42, P.r * 0.10);
  ctx.moveTo(-P.r * 0.28, -P.r * 0.10); ctx.lineTo(-P.r * 0.08, P.r * 0.10);
  ctx.stroke();

  // 刀镡（护手）
  ctx.beginPath();
  ctx.arc(P.r * 0.22, 0, P.r * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = sk.hilt || THEME.hilt;
  ctx.fill();
  ctx.strokeStyle = rgba(hc, 0.45);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 刀身：细长、微弧。刀背一条线，刃口一条高光。
  // 延锋每升一级，刀真的会长一截 —— 数值变化必须画在手里这把刀上。
  const bl = POW.blade || 1;
  ctx.beginPath();
  ctx.moveTo(P.r * 0.38, -P.r * 0.15);
  ctx.quadraticCurveTo(P.r * 1.9 * bl, -P.r * 0.30, P.r * 3.0 * bl, -P.r * 0.03);
  ctx.lineTo(P.r * 3.0 * bl, P.r * 0.05);
  ctx.quadraticCurveTo(P.r * 1.8 * bl, P.r * 0.12, P.r * 0.38, P.r * 0.22);
  ctx.closePath();
  // 白刃里程碑：刀身从青白转成近乎纯白的热度，是"我杀够了一千只"的证据
  ctx.fillStyle = POW.white ? 'rgba(250,255,255,0.98)' : sk.blade || THEME.blade;
  ctx.fill();

  // 刃口高光
  ctx.beginPath();
  ctx.moveTo(P.r * 0.42, P.r * 0.16);
  ctx.quadraticCurveTo(P.r * 1.8 * bl, P.r * 0.06, P.r * 2.9 * bl, P.r * 0.02);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // —— 本体：外壳 + 朝向前方的发光核 ——
  ctx.beginPath();
  ctx.arc(0, 0, P.r, 0, Math.PI * 2);
  ctx.fillStyle = hc;
  ctx.fill();

  const core = ctx.createRadialGradient(P.r * 0.2, 0, 0, P.r * 0.2, 0, P.r * 0.55);
  core.addColorStop(0, THEME.playerCore);
  core.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.beginPath();
  ctx.arc(P.r * 0.2, 0, P.r * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();

}
// 皮肤身上的小装饰（各一两笔）：雨丝 / 耳机 / 亮片 / 火星 / 金环
function drawHeroDeco(sk, x, y, ang, R, t) {
  const c = sk.light;
  ctx.beginPath();
  if (sk.deco === 'rain') {
    // 雨中漫步：身边一直往下飘的几道斜雨丝
    for (let i = 0; i < 5; i++) {
      const f = (t * 1.6 + i * 0.2) % 1, rx = x + Math.sin(i * 2.4) * R * 2.2, ry = y - R * 2.4 + f * R * 4.4;
      ctx.moveTo(rx, ry); ctx.lineTo(rx - R * 0.25, ry + R * 0.7);
    }
    ctx.globalAlpha = 0.55; ctx.lineWidth = 1.4; ctx.strokeStyle = c; ctx.stroke();
  } else if (sk.deco === 'dj') {
    // 打碟：头上一副耳机（后脑一道箍 + 两边耳罩），跟着朝向转
    const ca = Math.cos(ang), sa = Math.sin(ang);
    ctx.arc(x - ca * R * 0.15, y - sa * R * 0.15, R * 1.08, ang + Math.PI * 0.5, ang + Math.PI * 1.5);
    ctx.globalAlpha = 0.95; ctx.lineWidth = 2.6; ctx.strokeStyle = c; ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - sa * R * 1.02, y + ca * R * 1.02, R * 0.34, 0, Math.PI * 2);
    ctx.moveTo(x + sa * R * 1.02 + R * 0.34, y - ca * R * 1.02);
    ctx.arc(x + sa * R * 1.02, y - ca * R * 1.02, R * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
  } else if (sk.deco === 'flashy') {
    // 显眼包：身边三颗一闪一闪的亮片（小菱形），慢慢绕着转
    for (let i = 0; i < 3; i++) {
      const a = t * 1.3 + i * 2.09, r = R * 1.9, s2 = R * (0.22 + 0.16 * Math.abs(Math.sin(t * 5 + i * 1.7)));
      const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
      ctx.moveTo(sx, sy - s2 * 1.6); ctx.lineTo(sx + s2, sy); ctx.lineTo(sx, sy + s2 * 1.6); ctx.lineTo(sx - s2, sy); ctx.closePath();
    }
    ctx.globalAlpha = 0.95; ctx.fillStyle = c; ctx.fill();
  } else if (sk.deco === 'revenge') {
    // 复仇：身后拖着几颗往外飘的火星
    for (let i = 0; i < 4; i++) {
      const f = (t * 2.2 + i * 0.25) % 1, a = ang + Math.PI + Math.sin(i * 1.9) * 0.5, r = R * (1 + f * 1.8);
      const ex = x + Math.cos(a) * r, ey = y + Math.sin(a) * r, er = R * 0.2 * (1 - f) + 0.5;
      ctx.moveTo(ex + er, ey);
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
    }
    ctx.globalAlpha = 0.9; ctx.fillStyle = c; ctx.fill();
  } else if (sk.deco === 'king') {
    // 嘉豪本豪：身边一圈金环，环上五颗慢慢转的金点
    ctx.arc(x, y, R * 1.45, 0, Math.PI * 2);
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 3); ctx.lineWidth = 1.6; ctx.strokeStyle = c; ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = t * 0.8 + i * 1.2566, px = x + Math.cos(a) * R * 1.45, py = y + Math.sin(a) * R * 1.45;
      ctx.moveTo(px + R * 0.16, py); ctx.arc(px, py, R * 0.16, 0, Math.PI * 2);
    }
    ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  if (hordeMode && hHurtT > 0 && Math.floor(hHurtT * 12) % 2 === 0) return;   // 黑潮刚掉一条命：一闪一闪
  const hc = heroColor();          // 主角当前颜色：跟着连斩段位走，断了回原色
  for (let i = 0; i < ghosts.length; i++) {
    const g = ghosts[i];
    const a = g.life / g.max;
    ctx.globalAlpha = a * 0.3;
    ctx.fillStyle = hc;
    ctx.beginPath();
    ctx.arc(wdx(g.x), wdy(g.y), g.r * (0.6 + a * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 光晕（收小：原来 5r/0.28 在暗场里会糊成一团蓝）
  const glow = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, P.r * 2.6);
  glow.addColorStop(0, rgba(hc, (0.09 + 0.05 * FB.heat).toFixed(3)));
  glow.addColorStop(0.55, rgba(hc, (0.05 + 0.03 * FB.heat).toFixed(3)));
  glow.addColorStop(1, rgba(hc, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(P.x, P.y, P.r * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.rotate(P.ang);
  const sq = P.squash, sk = hordeMode ? heroSkin() : HERO_SKINS[0];
  ctx.scale(1 + sq * 0.35, 1 - sq * 0.22);
  drawHeroBody(sk, hc, sq);
  ctx.restore();
  if (sk.deco) drawHeroDeco(sk, P.x, P.y, P.ang, P.r, gameTime);

  // 冷却环
  if (P.cd > 0) {
    const t = 1 - P.cd / POW.dashCd;
    ctx.beginPath();
    ctx.arc(P.x, P.y, P.r + 9, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.strokeStyle = rgba(hc, 0.25 + t * 0.45);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 续时：连击窗口的倒计时环。
  // 只有点了"续时"才会出现 —— 买与没买，画面直接不一样。
  const wl = POW.windowLv || 0;
  if (wl > 0 && combo > 0 && comboTimer > 0) {
    const t = clamp(comboTimer / POW.comboWindow, 0, 1);
    const rr = P.r + 17;
    ctx.beginPath();
    ctx.arc(P.x, P.y, rr, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.strokeStyle = rgba(heroColor(), (0.16 + 0.07 * wl).toFixed(3));
    ctx.lineWidth = 1.4 + wl * 0.34;
    ctx.lineCap = 'round';
    ctx.stroke();
    // 快断的时候闪两下，提醒"该再砍一刀了"
    if (t < 0.28) {
      const p = 0.5 + 0.5 * Math.sin(nowMs() / 70);
      ctx.beginPath();
      ctx.arc(P.x, P.y, rr, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,140,110,' + (0.25 * p).toFixed(3) + ')';
      ctx.lineWidth = 2 + wl * 0.4;
      ctx.stroke();
    }
  }

  // 刀已就绪：向外扩散一圈白光，提示"下一刀马上接上"
  if (attackHeld && P.cd <= 0 && P.dashT <= 0) {
    const t = (nowMs() % 600) / 600;
    ctx.beginPath();
    ctx.arc(P.x, P.y, P.r + 13 + t * 10, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.32 * (1 - t)) + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawEnemies() {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    // 黑潮试玩全场都亮，照不到也画：屏幕外（刚摆在屏幕顶上的）、整只淹在墨里的不画
    if (hordeMode && (Math.abs(wdelta(e.y - cam.y)) > H / 2 + e.r * 2 + 20 ||
        wdelta(e.y - P.y) - hGap() > HD.gap * HD.inkEdge + e.r * 1.7)) continue;
    const d = wdist(e.x, e.y, P.x, P.y);

    let lit = 1;
    if (THEME.dimEnemies) {
      lit = litAt(d);
      if (lit <= 0.03) continue;          // 照不到就不画，省一次填充
    }

    const b = e.born;
    ctx.save();
    ctx.translate(wdx(e.x), wdy(e.y));
    ctx.scale(b, b);
    ctx.globalAlpha = lit;

    // 冲锋者蓄力：一圈急促收紧的红环。这是"快跑"的信号，必须一眼看懂。
    if (e.charger && e.mode === 'wind') {
      const k = 1 - clamp(e.t / 0.6, 0, 1);
      const rr = e.r + 24 - k * 12;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,90,60,' + (0.08 + k * 0.16) + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,90,60,' + (0.35 + k * 0.55) + ')';
      ctx.lineWidth = 2 + k * 2.5;
      ctx.stroke();
    }

    // —— 本体：三种轮廓，一眼分清 ——
    // 冲锋者：锯齿尖刺（刺本身就在说"我很快，别正面撞"）
    // 重型：软体外面套一层慢转的六边甲壳
    // 普通：呼吸起伏的软体，不是一个死板的圆
    const seg = 10;
    ctx.beginPath();
    for (let s2 = 0; s2 <= seg; s2++) {
      const a = (s2 / seg) * Math.PI * 2;
      let rr;
      if (e.charger) {
        const spike = (s2 % 2 === 0) ? 1.22 : 0.82;
        rr = e.r * spike * (1 + 0.05 * Math.sin(e.wob * 2.3 + s2 * 1.7));
      } else {
        rr = e.r * (1 + 0.10 * Math.sin(e.wob * 1.7 + s2 * 2.1));
      }
      const sx = Math.cos(a) * rr, sy = Math.sin(a) * rr;
      if (s2 === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = THEME.enemyBody;
    ctx.fill();

    const fc = foeColor(e);          // 每种怪一个颜色，见 THEME.foe
    ctx.lineWidth = 6;               // 轮廓外一圈同色柔光：怪是"发着光的东西"，不是一个线框
    ctx.strokeStyle = rgba(fc, 0.16);
    ctx.stroke();
    ctx.lineWidth = e.heavy ? (e.cracked ? 2.2 : 2.6) : 2;
    ctx.strokeStyle = e.heavy && e.cracked ? 'rgba(255,186,128,0.92)' : rgba(fc, 0.9);
    ctx.stroke();

    /* 重型的"两条命"必须写在身上，不能靠玩家记。
       满甲：软体外面套一圈六块慢转的甲环 —— 全场只有它带环，环在 = 还得再补一刀。
       裂甲：环碎成甲片飞走（armorBits），只剩三道断根 + 一道裂痕，
             轮廓一下子"空"了，不看血条也知道这一刀砍进去了。 */
    if (e.heavy) {
      if (!e.cracked) {
        const spin = e.wob * 0.22;
        const RR = e.r * 1.62;

        // 内衬：慢速反转的六边壳，被甲环挡着，只露出一层暗光
        ctx.beginPath();
        for (let s2 = 0; s2 <= 6; s2++) {
          const a = -e.wob * 0.14 + (s2 / 6) * Math.PI * 2;
          const hx = Math.cos(a) * e.r * 1.18, hy = Math.sin(a) * e.r * 1.18;
          if (s2 === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255,120,60,0.34)';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // 外环：六块甲片，片与片之间留缝。整体随呼吸微微一亮 —— 是活着的壳。
        const breathe = 0.84 + 0.16 * Math.sin(e.wob * 1.6);
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = 'rgba(255,142,72,' + (0.58 * breathe).toFixed(3) + ')';
        for (let s2 = 0; s2 < 6; s2++) {
          const a0 = spin + (s2 / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(0, 0, RR, a0, a0 + 0.88);
          ctx.stroke();
        }
        // 接缝：短径向刻痕。环读起来是"拼起来的"，碎的时候才可信。
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,196,140,' + (0.42 * breathe).toFixed(3) + ')';
        ctx.beginPath();
        for (let s2 = 0; s2 < 6; s2++) {
          const a = spin + (s2 / 6) * Math.PI * 2 - 0.045;
          ctx.moveTo(Math.cos(a) * RR * 0.93, Math.sin(a) * RR * 0.93);
          ctx.lineTo(Math.cos(a) * RR * 1.07, Math.sin(a) * RR * 1.07);
        }
        ctx.stroke();
      } else {
        // 断根：三道没掉干净的甲片根，转得比原来急
        const spin = e.wob * 0.42;
        ctx.strokeStyle = 'rgba(255,132,74,0.26)';
        ctx.lineWidth = 2.2;
        for (let s2 = 0; s2 < 3; s2++) {
          const a0 = spin + (s2 / 3) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(0, 0, e.r * 1.20, a0, a0 + 0.38);
          ctx.stroke();
        }
        // 裂痕：刀从哪儿进去的，就留在哪儿；刚裂的 0.22 秒是亮的
        const hot = clamp((e.crackT || 0) / 0.22, 0, 1);
        ctx.save();
        ctx.rotate(e.wob * 0.06);
        ctx.beginPath();
        ctx.moveTo(-e.r * 0.98, -e.r * 0.16);
        ctx.lineTo(-e.r * 0.52, e.r * 0.12);
        ctx.lineTo(-e.r * 0.12, -e.r * 0.14);
        ctx.lineTo(e.r * 0.34, e.r * 0.16);
        ctx.lineTo(e.r * 0.96, -e.r * 0.04);
        ctx.strokeStyle = 'rgba(255,214,168,' + (0.34 + hot * 0.55).toFixed(3) + ')';
        ctx.lineWidth = 1.5 + hot * 1.1;
        ctx.stroke();
        ctx.restore();
      }
    }

    // 内核（呼吸）—— 四种敌人各有一套"读法"
    if (e.watch) {
      // 守望者：一只眼。瞳仁永远朝你转，等于把"我在看你"写在脸上。
      const ang = Math.atan2(P.y - e.y, P.x - e.x);
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.66, 0, Math.PI * 2);
      ctx.fillStyle = rgba(fc, 0.14);
      ctx.fill();
      ctx.strokeStyle = rgba(fc, 0.6);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * e.r * 0.22, Math.sin(ang) * e.r * 0.22, e.r * 0.27, 0, Math.PI * 2);
      ctx.fillStyle = rgba(fc, 0.95);
      ctx.fill();
    } else if (e.bomb) {
      // 爆裂者：胀起来的囊，身上几条发亮的缝，缝越亮说明越"满"
      const gl = 0.5 + 0.5 * Math.sin(e.wob * 2.4);
      for (let s2 = 0; s2 < 3; s2++) {
        const a0 = e.wob * 0.25 + s2 * 2.1;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * (0.32 + s2 * 0.2), a0, a0 + 1.05);
        ctx.strokeStyle = rgba(fc, 0.25 + gl * 0.45);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, e.r * (0.28 + gl * 0.06), 0, Math.PI * 2);
      ctx.fillStyle = rgba(fc, 0.85);
      ctx.fill();
    } else {
      const k = 0.42 + Math.sin(e.wob) * 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * k, 0, Math.PI * 2);
      ctx.fillStyle = rgba(fc, e.heavy ? 0.55 : 0.6);
      ctx.fill();
    }

    // 两只眼睛（只有恐怖版画）
    if (THEME.eyes) {
      const ang = Math.atan2(P.y - e.y, P.x - e.x);
      const off = e.r * 0.42;
      const ex = Math.cos(ang + Math.PI / 2) * off;
      const ey = Math.sin(ang + Math.PI / 2) * off;
      const er = Math.max(1.4, e.r * 0.16);
      ctx.fillStyle = e.heavy ? '#ffb057' : '#ff2d4a';
      ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-ex, -ey, er, 0, Math.PI * 2); ctx.fill();
    }

    // 前哨标记：进层时必刷的那只是本层的"讲解员"。
    // 头顶挂一个向下的箭头 + 一圈淡青外环，2.8 秒淡出。
    // 用 UI 的青而不是敌人的红橙，一眼就能和"普通怪"分开。
    if (e.scout > 0) {
      const sa = clamp(e.scout / 2.8, 0, 1);
      const ay = -e.r * 2.15 - 3;
      ctx.globalAlpha = lit * sa * 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 2.0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(191,239,255,0.24)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5.5, ay - 9);
      ctx.lineTo(5.5, ay - 9);
      ctx.lineTo(0, ay);
      ctx.closePath();
      ctx.fillStyle = 'rgba(191,239,255,0.95)';
      ctx.fill();
      ctx.globalAlpha = lit;
    }

    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// 黑暗：玩家周围一圈是亮的，外面全黑。这不是滤镜，这是主要玩法。
function drawDarkness() {
  if (!CFG.darkness || !CFG.veil || state === 'ready') return;
  // 亮区 = 斩杀圈：圈的 0.8 倍以内全亮，过渡带跨在圈线两侧，1.25 倍处全黑
  const L = lightR(), R = L * 1.25;
  const base = THEME.darkBase;
  // smoothstep 曲线：两端导数为零，任何渲染器都画不出"接缝"。
  // 旧曲线在 0.8r-1.0r 之间 alpha 从 0.39 跳到 0.94 且突然停止，
  // 真机 GPU 不做渐变抖动，这条膝盖会显示成一圈蓝环。
  // 过渡带比以前窄，色标加密到 24 个，带里照样是平滑的
  const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, R);
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;                          // t × R = 离主角的距离
    const k = clamp((t * 1.25 - 0.8) / 0.45, 0, 1);
    const s = k * k * (3 - 2 * k);
    g.addColorStop(t, 'rgba(' + base + ',' + (0.94 * s).toFixed(3) + ')');
  }
  ctx.fillStyle = g;
  // 覆盖当前视口（多铺一圈，抖屏时边缘不漏光）
  ctx.fillRect(cam.x - W / 2 - 60, cam.y - H / 2 - 60, W + 120, H + 120);
}

/* 斩杀距离：一圈暗红的虚线，标出"刀还够得着多远"，环内才会自动锁敌。
   （原先外面还有一圈跟着拍子闪的淡蓝视野环，已经去掉：亮区本身的明暗就是视野边界）
   虚线用"逐段画弧 + moveTo"实现，不用 setLineDash：
   小游戏基础库对它支持不一致，而且一旦设过没复位，后面所有描边都会变虚线。 */
function drawReachRing() {
  if (state !== 'play' || hordeMode) return;
  const r = reach();
  if (!(r > 20)) return;

  // 有目标（敌人或晶柱）落进圈里时，线亮一档：让"够得着了"这件事看得见
  let hot = false;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (wdist(e.x, e.y, P.x, P.y) <= r) { hot = true; break; }
  }
  if (!hot) {
    for (let i = 0; i < crystals.length; i++) {
      const c = crystals[i];
      if (wdist(c.x, c.y, P.x, P.y) <= r) { hot = true; break; }
    }
  }
  reachGlow += ((hot ? 1 : 0) - reachGlow) * 0.10;
  const a = 0.24 + 0.16 * reachGlow;

  // 贴图版：整圈先画进一张图（RRG），每帧贴一次。半径变了一成以上才重画（线宽跟着缩放，差一成看不出来）
  const spr = reachSprite(r);
  if (spr) {
    const sz = spr.width / RRG.k * r / RRG.r;
    ctx.globalAlpha = a;
    ctx.drawImage(spr, P.x - sz / 2, P.y - sz / 2, sz, sz);
    ctx.globalAlpha = 1;
    return;
  }
  reachRingPath(ctx, r, a, reachGlow);
}
// 斩杀圈的整圈贴图：r0 是画的时候的半径；刻度按 reachGlow = 0.5 画（亮暗只差 1.5 像素长，看不出）
const RRG = { c: null, k: 0, r: 0, col: '', off: false };
function reachSprite(r) {
  const k = DPR * SC;
  if (RRG.off) return null;
  if (RRG.c && RRG.k === k && RRG.col === THEME.reachRing && Math.abs(r / RRG.r - 1) < 0.1) return RRG.c;
  try {
    const c = RRG.c || (IS_MG ? MG.createCanvas() : document.createElement('canvas'));
    const half = r + 16;
    c.width = c.height = Math.ceil(half * 2 * k);
    const g = ctx2d(c);
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, half * 2, half * 2);
    reachRingPath(g, r, 1, 0.5, half, half);   // 圆心放在贴图正中、整体不透明，贴的时候再乘透明度
    RRG.c = c; RRG.k = k; RRG.r = r; RRG.col = THEME.reachRing;
    return c;
  } catch (e) { RRG.off = true; return null; }
}
// 斩杀圈本体：36 段暗红虚线 + 外侧十二道刻度，画在 g 上。cx / cy 不传就画在主角身上
function reachRingPath(g, r, a, glow, cx, cy) {
  const ox = cx === undefined ? P.x : cx, oy = cy === undefined ? P.y : cy;
  const seg = 36;                       // 36 段：手机上一段约 9px，看得出是"虚"线，又不至于碎成点
  const span = Math.PI * 2 / seg;
  const dash = span * 0.58;             // 实线占 58%，留 42% 的空

  g.save();
  g.strokeStyle = 'rgb(' + THEME.reachRing + ')';
  g.lineWidth = 1.6;
  g.lineCap = 'butt';
  g.globalAlpha = a;

  g.beginPath();
  for (let i = 0; i < seg; i++) {
    const s = i * span;
    // moveTo 到起点再画弧，各段之间才不会连出一条线
    g.moveTo(ox + Math.cos(s) * r, oy + Math.sin(s) * r);
    g.arc(ox, oy, r, s, s + dash);
  }
  g.stroke();

  // 外侧十二道刻度：像刀镡上的纹，有东西进圈时一起亮
  g.strokeStyle = 'rgba(' + THEME.reachRing + ',0.9)';
  g.lineWidth = 1.4;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const s = i * Math.PI / 6 + Math.PI / 12;
    g.moveTo(ox + Math.cos(s) * (r + 4), oy + Math.sin(s) * (r + 4));
    g.lineTo(ox + Math.cos(s) * (r + 9 + 3 * glow), oy + Math.sin(s) * (r + 9 + 3 * glow));
  }
  g.stroke();

  g.globalAlpha = 1;
  g.restore();
}

// 合围预警：在视野边缘、即将来人的方向上亮起弧线。
// 这 0.9 秒决定了玩家是"被围死"还是"选一个方向突出去"。
function drawWaveWarn() {
  if (waveWarnT <= 0 || !waveDirs.length) return;
  const k = 1 - waveWarnT / CFG.waveWarn;
  const r = view * 1.02;
  ctx.save();
  ctx.globalAlpha = 0.2 + k * 0.55;
  ctx.strokeStyle = '#ff5a3c';
  ctx.lineWidth = 2 + k * 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < waveDirs.length; i++) {
    const a = waveDirs[i];
    ctx.beginPath();
    ctx.arc(P.x, P.y, r, a - 0.15, a + 0.15);
    ctx.stroke();
    // 两道往里收的箭头，越临近越往里压
    ctx.fillStyle = '#ff5a3c';
    for (let j = 0; j < 2; j++) {
      const d = r - 16 - j * 14 - k * 10;
      const x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.PI);
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-4, -8); ctx.lineTo(-1, 0); ctx.lineTo(-4, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

// 光之外的东西：恐怖版是两点红眼，合规版是一个微弱的能量核
function drawRemote() {
  if (!CFG.darkness || hordeMode) return;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const rx = wdx(e.x), ry = wdy(e.y);
    const d = wdist(e.x, e.y, P.x, P.y);

    const lit = litAt(d);                                    // 1 = 完全被照亮（和本体同一条曲线，一个淡出一个淡入）
    const vf = layerFeat() === 'void' ? 1.15 : 1.9;                // 无光：圈外的核只在近处才露
    const fade = clamp((view * vf - d) / (view * 0.5), 0, 1);     // 能在黑暗里看见多远：感知半径
    const a = (1 - lit) * fade;

    // 蓄力中的冲锋者即使在光外也必须看得见。
    // 看不见的冲锋 = 随机死亡，那是"不讲理"，不是难度。
    if (e.charger && e.mode === 'wind') {
      ctx.globalAlpha = 0.75 + Math.sin(e.wob * 9) * 0.2;
      ctx.fillStyle = 'rgba(255,90,60,0.9)';
      ctx.beginPath();
      ctx.arc(rx, ry, e.r * 0.7 + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }

    if (a <= 0.02) continue;

    // 不用 shadowBlur：几十个敌人一起开阴影会把低端机拖到 20 帧
    const pulse = 0.55 + Math.sin(e.wob * 3) * 0.15;
    ctx.globalAlpha = a * pulse;

    if (THEME.remote === 'eyes') {
      const ang = Math.atan2(P.y - e.y, P.x - e.x);
      const off = e.r * 0.42;
      const ex = Math.cos(ang + Math.PI / 2) * off;
      const ey = Math.sin(ang + Math.PI / 2) * off;
      const er = Math.max(1.1, e.r * 0.13);
      ctx.fillStyle = foeColor(e);
      ctx.beginPath(); ctx.arc(rx + ex, ry + ey, er, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(rx - ex, ry - ey, er, 0, Math.PI * 2); ctx.fill();
    } else {
      // 场地染了色就把核调实、调大一点（最多不透明、大三成五），再垫一圈暗边，免得糊进有颜色的底里（没段位时和原来一样）
      const k = clamp(BGT.a / 0.3, 0, 1), er = Math.max(1.6, e.r * 0.22) * (1 + 0.35 * k), al = Math.min(1, a * pulse * (1 + 0.8 * k));
      if (k > 0) {
        ctx.globalAlpha = al * 0.6 * k;
        ctx.fillStyle = '#05070a';
        ctx.beginPath(); ctx.arc(rx, ry, er + 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = al;
      ctx.fillStyle = foeColor(e);
      ctx.beginPath(); ctx.arc(rx, ry, er, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = al * 0.25;
      ctx.beginPath(); ctx.arc(rx, ry, er * 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 光外的晶柱：只露一点冷白的微光，像黑暗里有人替你留了一盏灯。
  // 没有这个，补出来的柱子就是"看不见的余光"，玩家会以为没东西可砍。
  const t = nowMs() / 1000;
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    const rx = wdx(c.x), ry = wdy(c.y);
    const d = wdist(c.x, c.y, P.x, P.y);
    if (d < lightR() * 0.98) continue;                   // 圈里的走正常绘制
    const fade = clamp((view * 2.0 - d) / (view * 0.55), 0, 1);
    if (fade <= 0.02) continue;
    const tp = 0.5 + 0.5 * Math.sin(t * 1.6 + c.spin);
    ctx.globalAlpha = fade * (0.20 + 0.22 * tp);
    ctx.fillStyle = '#ffffff';
    // 一点核 + 一根极淡的竖线：告诉玩家"那是个能砍的东西"，不是又一个敌人
    ctx.beginPath();
    ctx.arc(rx, ry, 2.2 + tp * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = fade * (0.10 + 0.12 * tp);
    ctx.fillRect(rx - 1, ry - c.r * 1.1, 2, c.r * 2.2);
  }

  ctx.globalAlpha = 1;
}

// 刀痕：一道细白的斩线（外面裹一层刀光色），刚出来时一下拉长；
// 两侧各一道短线往外错开 —— 看起来是"被劈成了两半"
// 火星：一个个小方点，越老越淡；颜色一样的连着画，少换几次 fillStyle
// 火星：按 四档深浅 × 颜色 攒成几笔（以前一颗一笔：高段位身上三十几颗，真机上一帧一两毫秒）
function drawEmbers() {
  for (let q = 1; q <= 4; q++) {
    let c = null;
    ctx.globalAlpha = q / 4 * 0.9;
    for (let i = 0; i < embers.length; i++) {
      const m = embers[i];
      if (Math.ceil(clamp(m.life / m.max, 0, 1) * 4) !== q) continue;
      if (m.c !== c) { if (c !== null) ctx.fill(); c = m.c; ctx.fillStyle = c; ctx.beginPath(); }
      ctx.rect(wdx(m.x) - m.r / 2, wdy(m.y) - m.r / 2, m.r, m.r);
    }
    if (c !== null) ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCuts() {
  ctx.lineCap = 'round';
  for (let i = 0; i < cuts.length; i++) {
    const k = cuts[i], t = 1 - k.life / k.max;
    const x = wdx(k.x), y = wdy(k.y);
    const L = k.len * (0.55 + 0.45 * easeOut(t / 0.3)) / 2;
    const dx = Math.cos(k.a), dy = Math.sin(k.a), nx = -dy, ny = dx;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = rgba(k.c, 0.6);
    const kw = k.w || 1;             // 段位越高斩线越粗
    ctx.lineWidth = (9 * (1 - t) + 1.5) * kw;
    ctx.beginPath(); ctx.moveTo(x - dx * L, y - dy * L); ctx.lineTo(x + dx * L, y + dy * L); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = (2.2 * (1 - t) + 0.8) * kw;
    ctx.stroke();
    const off = 9 * easeOut(t);
    ctx.globalAlpha = (1 - t) * 0.6;
    ctx.strokeStyle = k.c;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - dx * L * 0.5 + nx * off, y - dy * L * 0.5 + ny * off); ctx.lineTo(x + dx * L * 0.5 + nx * off, y + dy * L * 0.5 + ny * off);
    ctx.moveTo(x - dx * L * 0.5 - nx * off, y - dy * L * 0.5 - ny * off); ctx.lineTo(x + dx * L * 0.5 - nx * off, y + dy * L * 0.5 - ny * off);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

// 粒子按 颜色 × 深浅（4 档）攒成一笔填完：飞着的拖尾不再描线，画成一条细长四边形，和停下的圆点同一笔。
// 手机上一笔"散满一屏的一大串形状"约 100 微秒（比一个小圆贵好几倍），所以组越少越好 ——
// 以前按线宽再分组，几十个粒子能分出三四十组，比一个一笔还慢（v1023.2300 粒子飘字 2.6ms/帧，第 9 层 5.5）
const FXG = new Map();         // key → { q, c, v: [x, y, r, …（r < 0 是拖尾：x, y, -1, x2, y2, hw）], n }，跨帧复用
function drawFX() {
  if (FXG.size > 120) FXG.clear();       // 颜色是有限几种，防万一攒太多
  FXG.forEach(function (g) { g.n = 0; });
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const a = clamp(p.life / p.max, 0, 1);
    if (a <= 0) continue;
    const q = Math.ceil(a * 4), x = wdx(p.x), y = wdy(p.y);
    const sp = Math.hypot(p.vx, p.vy);
    const key = q + p.c;
    let g = FXG.get(key);
    if (!g) { g = { q: q, c: p.c, v: [], n: 0 }; FXG.set(key, g); }
    const v = g.v;
    if (sp > 90) {
      const L = Math.min(16, sp * 0.028) * (0.5 + a * 0.5), ux = p.vx / sp, uy = p.vy / sp;
      v[g.n++] = x; v[g.n++] = y; v[g.n++] = -1;
      v[g.n++] = x - ux * L; v[g.n++] = y - uy * L;
      v[g.n++] = Math.max(1, p.r * 0.9 * (0.4 + a * 0.6)) / 2;
    } else {
      v[g.n++] = x; v[g.n++] = y; v[g.n++] = p.r * (0.4 + a * 0.6);
    }
  }
  FXG.forEach(function (g) {
    if (!g.n) return;
    const v = g.v;
    ctx.globalAlpha = g.q / 4;
    ctx.beginPath();
    for (let i = 0; i < g.n;) {
      const x = v[i], y = v[i + 1], r = v[i + 2];
      if (r >= 0) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); i += 3; continue; }
      // 拖尾：头 (x, y) → 尾 (x2, y2)，半宽 hw。顶点顺序和 arc 同向（都是顺时针），重叠处不会互相抵掉
      const x2 = v[i + 3], y2 = v[i + 4], hw = v[i + 5];
      const dx = x - x2, dy = y - y2, d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d * hw, ny = dx / d * hw;
      ctx.moveTo(x - nx, y - ny); ctx.lineTo(x + nx, y + ny); ctx.lineTo(x2 + nx, y2 + ny); ctx.lineTo(x2 - nx, y2 - ny);
      ctx.closePath();
      i += 6;
    }
    ctx.fillStyle = g.c; ctx.fill();
  });
  ctx.globalAlpha = 1;
  ptFn('粒子');

  ctx.textAlign = 'center';
  FLS.frame++;
  for (let i = 0; i < floats.length; i++) {
    const f = floats[i];
    if (f.pop) continue;                 // 头顶大字在黑暗层之上画（drawCallouts）
    ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
    worldText(f.text, wdx(f.x), wdy(f.y), 1, Math.round(f.size), 800, Math.max(2, f.size * 0.16), 'rgba(3,5,9,0.8)', f.c || THEME.floatColor, 0);
  }
  ctx.globalAlpha = 1;
}

// 头顶大字画在黑暗层之上：几行往上叠时会跑出光圈，压在暗场下面就看不清了
function drawCallouts() {
  ctx.textAlign = 'center';
  for (let i = 0; i < floats.length; i++) if (floats[i].pop) drawCallout(floats[i]);
  ctx.globalAlpha = 1;
}

// 段位名 / 多杀：先放大 1.7 倍砸下来，0.16 秒落定；前半程不透明，后半程才淡出。
// 暗描边 + 同色错位几笔当辉光，压在刀光和怪上都读得清（不用 shadowBlur）
function drawCallout(f) {
  const age = f.max - f.life;
  const s = 1 + 0.7 * Math.max(0, 1 - age / 0.16);
  ctx.globalAlpha = clamp(f.life / (f.max * 0.45), 0, 1);
  // 弹出放大那 0.16 秒直接写（贴图放大了会糊），落定以后贴图
  worldText(f.text, wdx(f.x), wdy(f.y), s, Math.round(f.size), 900, f.size * 0.16, 'rgba(3,5,9,0.9)', f.c, f.size * 0.05, s > 1);
}

// 世界里的描边字（飘字 / 头顶大字），基线中点在 (x, y)，放大 sc 倍；glow > 0 时左右上再叠三遍淡色（头顶大字）。
// 一条字第一次出现时写进一块小画布，之后每帧只贴一次 —— 手机上写一个字 30~60 微秒，飘字描边 + 填色两遍、
// 头顶大字五遍，一条要活 40~70 帧。一样的字（"+12"）共用一块；画布最多 24 块轮着用，这一帧都占满了就照旧直接写
const FLS = { slots: [], map: new Map(), frame: 0, k: 0 };
function worldText(txt, x, y, sc, size, weight, lw, stroke, c, glow, direct) {
  if (!direct) {
    if (FLS.k !== DPR * SC) { FLS.slots.length = 0; FLS.map.clear(); FLS.k = DPR * SC; }
    const key = weight + '|' + size + '|' + c + '|' + txt;
    let q = FLS.map.get(key);
    if (!q) {
      ctx.font = weight + ' ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      const pad = lw / 2 + glow + 2;
      const bx = textW(txt) / 2 + pad, by = pad + size;
      q = flsBake(key, bx * 2, by + size * 0.3 + pad, function () {
        ctx.textAlign = 'center';
        paintWorldText(txt, bx, by, size, weight, lw, stroke, c, glow);
      });
      if (q) { q.bx = bx; q.by = by; }
    }
    if (q) {
      q.used = FLS.frame;
      ctx.drawImage(q.c, 0, 0, q.wp, q.hp, x - q.bx * sc, y - q.by * sc, q.sw * sc, q.sh * sc);
      return;
    }
  }
  if (sc === 1) { paintWorldText(txt, x, y, size, weight, lw, stroke, c, glow); return; }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  paintWorldText(txt, 0, 0, size, weight, lw, stroke, c, glow);
  ctx.restore();
}
function paintWorldText(txt, x, y, size, weight, lw, stroke, c, glow) {
  ctx.font = weight + ' ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.strokeText(txt, x, y);
  if (glow) {
    ctx.fillStyle = rgba(c, 0.28);
    ctx.fillText(txt, x - glow, y); ctx.fillText(txt, x + glow, y); ctx.fillText(txt, x, y - glow);
  }
  ctx.fillStyle = c;
  ctx.fillText(txt, x, y);
}
// 从池子里拿一块画布把字写进去（sw × sh 是世界单位）：先挑这一帧没用过、够大、最久没用的一块，
// 池子没满就开新的，满了就把最久没用的一块撑大
function flsBake(key, sw, sh, draw) {
  const k = FLS.k;
  const wp = Math.ceil(sw * k), hp = Math.ceil(sh * k);
  let pick = null, old = null;
  for (let i = 0; i < FLS.slots.length; i++) {
    const q = FLS.slots[i];
    if (q.used === FLS.frame) continue;
    if (!old || q.used < old.used) old = q;
    if (q.c.width >= wp && q.c.height >= hp && (!pick || q.used < pick.used)) pick = q;
  }
  if (!pick) {
    if (FLS.slots.length < 24) {
      try { pick = { c: IS_MG ? MG.createCanvas() : document.createElement('canvas'), key: null, used: -1 }; }
      catch (x) { return null; }
      pick.c.width = Math.ceil(wp / 32) * 32; pick.c.height = Math.ceil(hp / 16) * 16;
      FLS.slots.push(pick);
    } else {
      if (!old) return null;
      pick = old;
      pick.c.width = Math.max(pick.c.width, Math.ceil(wp / 32) * 32);
      pick.c.height = Math.max(pick.c.height, Math.ceil(hp / 16) * 16);
    }
  }
  const g = ctx2d(pick.c);
  if (!g) return null;
  if (pick.key !== null) FLS.map.delete(pick.key);
  const keep = ctx;
  ctx = g;
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, pick.c.width, pick.c.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    draw();
  } finally { ctx = keep; }
  pick.key = key; pick.wp = wp; pick.hp = hp; pick.sw = wp / k; pick.sh = hp / k;
  FLS.map.set(key, pick);
  return pick;
}


/* =========================================================
   13. 绘制（屏幕坐标 —— UI 不跟着世界缩放，字号才是真实的）
   ========================================================= */
/* ---------------- 界面套件「墨刃」 ----------------
   整套界面只说一种话（主界面、局内 HUD、结算、强化、说明……全用这几件拼出来）：
   · 形状 = 刀切过的角：面板 / 按钮 / 标签都是"左上、右下各削掉一角"的刃形，
     另外两个角挂一对细角标 —— 一眼就是"斩"的东西，不是随便一个圆角框
   · 颜色 = 墨 + 光：底是带一点青的墨黑（不透明 —— 半透明亮色在部分真机上会亮得刺眼），
     亮色只给"该看的地方"：刃光青 = 能点 / 主操作，晨金 = 收获，朱砂 = 纪录印章 / 危险
   · 纪录用印章：像盖章一样砸下来，朱底白字，微微歪着
   · 进度条是斜切的刃条，菱形当点缀；全部不用 shadowBlur（辉光 = 同色低透明度错位几笔） */
const UI_FONT = '"PingFang SC","Microsoft YaHei",sans-serif';
const UI = {
  cyan: '#4df7ff', ice: '#bff6ff', gold: '#ffd166', amber: '#ffd98f', red: '#ef5040', jade: '#7dffd2',
  ink0: '#04070a', ink1: '#081117',
  text: '#eef8fa', dim: 'rgba(214,236,242,0.58)', faint: 'rgba(214,236,242,0.32)',
  panel: '#0a1217', panelTop: '#0f1a20', panelBot: '#080d11',
  line: 'rgba(150,225,240,0.16)', lineHi: 'rgba(150,225,240,0.4)'
};
function uf(w, s) { ctx.font = w + ' ' + Math.round(s) + 'px ' + UI_FONT; }
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
// 带一点回弹的弹出：徽章"啪"地落位
function easeBack(t) { t = clamp(t, 0, 1) - 1; return 1 + 2.7 * t * t * t + 1.7 * t * t; }
function textW(txt) { return ctx.measureText(txt).width; }

function outlineText(txt, x, y, c, lw) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(3,5,9,0.85)';
  ctx.lineWidth = lw;
  ctx.strokeText(txt, x, y);
  ctx.fillStyle = c;
  ctx.fillText(txt, x, y);
}
// HUD 文字贴图：一块字内容没变就贴上次画好的图，变了才重画（id 一块一张画布，w × h 是 CSS 像素，变了就重开画布）。
// 手机上写一个字就要 30~60 微秒，连斩数 / 分数带描边和四向辉光，一个数要写七八遍。
// minMs：内容一直在变时（分数滚动）最多每 minMs 毫秒重画一次，中间几帧先贴上一张；停下来以后最多晚 minMs 毫秒补上
const TXC = {};
// 局里画到一半去重画一张贴图（换一块画布画），手机得先把这一帧前面攒的几百笔全画完 —— 1025.2000 真机测试数据：
// 「分数」「米数」两项轮流一帧好几到十几毫秒，谁倒霉谁背（第 3~5 波是分数、第 6~11 波是米数），自己其实没多少活。
// 所以局里（txDefer）要重画的贴图：已经有一张旧的就先贴旧的，排进 TXQ，下一帧开头（还没画世界、没攒笔）再画（txFlush）
const TXQ = [];
let txDefer = false;
function textSprite(id, key, w, h, draw, minMs) {
  let e = TXC[id];
  if (!e) {
    try { e = TXC[id] = { c: IS_MG ? MG.createCanvas() : document.createElement('canvas'), key: null, k: 0, w: 0, h: 0 }; }
    catch (x) { return null; }
  }
  const same = e.k === DPR && e.w === w && e.h === h;
  if (same && (e.key === key || (minMs && e.key !== null && nowMs() - e.at < minMs))) return e.c;
  if (same && e.key !== null && txDefer) {
    if (!e.q) { e.q = true; TXQ.push(e); }
    e.qk = key; e.qd = draw;
    return e.c;
  }
  return txBake(e, key, w, h, draw);
}
function txFlush() {
  for (let i = 0; i < TXQ.length; i++) { const e = TXQ[i]; e.q = false; txBake(e, e.qk, e.w, e.h, e.qd); e.qd = null; }
  TXQ.length = 0;
}
function txBake(e, key, w, h, draw) {
  if (!(e.k === DPR && e.w === w && e.h === h)) {
    e.c.width = Math.ceil(w * DPR); e.c.height = Math.ceil(h * DPR); e.k = DPR; e.w = w; e.h = h;
  }
  if (state === 'play') { PERF.bake = (PERF.bake || 0) + 1; FR.tx++; }
  const g = ctx2d(e.c);
  if (!g) return null;
  // 把全局 ctx 临时换成它，原来的画字小工具（uf / glowText / outlineText）照用
  const keep = ctx;
  ctx = g;
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, e.c.width, e.c.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    draw();
  } finally { ctx = keep; }
  e.key = key; e.at = nowMs();
  return e.c;
}
// 数字条（1025.1500 真机测试数据：分数平均每帧 2.1 毫秒、连斩 1.4，比画所有怪还贵；一局 390 次卡顿，差不多每 0.3 秒一次 ——
// 就是分数贴图 0.3 秒重画一次的节奏。抖音上带描边、辉光的大字一次重画要好几毫秒到几十毫秒，一重画就掉一帧）：
// 一种字样把要用到的几个字（0~9 和几个符号）先画进一张图（主界面上一帧画一张，见 hudStripsWarm），之后每帧按位贴，
// 一位一次 drawImage 取一块（约 0.1 毫秒），数怎么变都不用再写字。paint(ch, x, y) 在当前 ctx 上按这种字样画一个字（基线 y）
const NSTRIP = {};
function numStrip(id, chars, weight, size, paint) {
  let e = NSTRIP[id];
  if (e) return e.k === DPR ? e : null;
  uf(weight, size);
  const pad = Math.ceil(size * 0.14) + 3, adv = {}, pos = {};
  let w = 0;
  for (let i = 0; i < chars.length; i++) { const ch = chars[i]; adv[ch] = textW(ch); pos[ch] = w; w += adv[ch] + pad * 2; }
  const h = Math.ceil(size * 0.82) + pad * 2, base = pad + Math.ceil(size * 0.8);
  let c = null;
  try { c = IS_MG ? MG.createCanvas() : document.createElement('canvas'); } catch (x) { c = null; }
  if (!c) return null;
  c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
  const g = ctx2d(c);
  if (!g) return null;
  const keep = ctx;
  ctx = g;
  try {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    uf(weight, size);
    ctx.textAlign = 'left';
    for (let i = 0; i < chars.length; i++) paint(chars[i], pos[chars[i]] + pad, base);
  } finally { ctx = keep; }
  e = NSTRIP[id] = { c: c, k: DPR, adv: adv, pos: pos, pad: pad, h: h, base: base };
  return e;
}
function stripW(e, txt) { let w = 0; for (let i = 0; i < txt.length; i++) w += e.adv[txt[i]] || 0; return w; }
// 左对齐、基线 y 贴一串（条里没有的字跳过）
function stripText(e, txt, x, y) {
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i], a = e.adv[ch];
    if (a === undefined) continue;
    const sw = a + e.pad * 2;
    ctx.drawImage(e.c, e.pos[ch] * DPR, 0, sw * DPR, e.h * DPR, x - e.pad, y - e.base, sw, e.h);
    x += a;
  }
}
// HUD 上用到的几张数字条：分数（白 / 新纪录金）、连斩数和"×"（每个段位一种颜色）、右上米数
const DIGITS = '0123456789';
function scoreStrip(rec) {
  return numStrip('score' + (rec ? 1 : 0), DIGITS, 900, 32, function (ch, x, y) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3,5,9,0.85)';
    ctx.lineWidth = 4;
    ctx.strokeText(ch, x, y);
    glowText(ch, x, y, rec ? UI.gold : UI.cyan, 1.5, 0.14);
    ctx.fillStyle = rec ? UI.gold : '#ffffff';
    ctx.fillText(ch, x, y);
  });
}
function comboStrip(t) {
  const c = tierColor(t);
  return numStrip('combo' + t, DIGITS, 900, 54, function (ch, x, y) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3,5,9,0.85)';
    ctx.lineWidth = 5;
    ctx.strokeText(ch, x, y);
    if (t >= 2) glowText(ch, x, y, c, 2.5, 0.22);
    else { ctx.fillStyle = c; ctx.fillText(ch, x, y); }
  });
}
function comboXStrip(t) {
  const c = tierColor(t);
  return numStrip('comboX' + t, '×', 800, 24, function (ch, x, y) { outlineText(ch, x, y, rgba(c, 0.85), 3); });
}
function meterStrip() { return numStrip('meter', DIGITS + ' 米', 900, 26, function (ch, x, y) { outlineText(ch, x, y, '#ffffff', 4); }); }
// 主界面上每帧先画好一张（一次全画会卡一下）
function hudStripsWarm() {
  if (!NSTRIP.score0) { scoreStrip(false); return; }
  if (!NSTRIP.score1) { scoreStrip(true); return; }
  if (!NSTRIP.meter) { meterStrip(); return; }
  for (let t = -1; t < COMBO_TIERS.length; t++) {
    if (!NSTRIP['combo' + t]) { comboStrip(t); return; }
    if (!NSTRIP['comboX' + t]) { comboXStrip(t); return; }
  }
}
function glowText(txt, x, y, c, spread, a) {
  ctx.fillStyle = rgba(c, a);
  ctx.fillText(txt, x - spread, y); ctx.fillText(txt, x + spread, y);
  ctx.fillText(txt, x, y - spread); ctx.fillText(txt, x, y + spread);
  ctx.fillStyle = c;
  ctx.fillText(txt, x, y);
}
// 拉开字距的小标签（canvas 的 letterSpacing 小游戏里不一定有，一个字一个字画）
function spaced(txt, x, y, gap, align) {
  const cs = Array.from(txt), ws = [];
  let total = 0;
  for (let i = 0; i < cs.length; i++) { ws.push(textW(cs[i])); total += ws[i]; }
  total += gap * (cs.length - 1);
  let px = align === 'center' ? x - total / 2 : (align === 'right' ? x - total : x);
  const keep = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < cs.length; i++) { ctx.fillText(cs[i], px, y); px += ws[i] + gap; }
  ctx.textAlign = keep;
  return total;
}

// 刃形：左上、右下各削掉 c
function bladePath(x, y, w, h, c) {
  c = Math.max(0, Math.min(c, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}
// 斜切条：左下、右上斜着收，进度条 / 色带用
function slantPath(x, y, w, h, s) {
  ctx.beginPath();
  ctx.moveTo(x + s, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - s, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}
/* 刃形面板。o：c 切角 / fill 实色 或 top+bot 竖向渐变 / border 描边（null = 不描）/
   ticks 两个没切的角上挂角标的颜色 / hi 顶边那条刀背反光（false = 不要） */
function bladeBox(x, y, w, h, o) {
  o = o || {};
  const c = o.c !== undefined ? o.c : Math.min(10, h * 0.3);
  bladePath(x, y, w, h, c);
  if (o.top) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, o.top);
    g.addColorStop(1, o.bot || o.top);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = o.fill || UI.panel;
  }
  ctx.fill();
  if (o.border !== null) {
    ctx.strokeStyle = o.border || UI.line;
    ctx.lineWidth = o.lw || 1;
    ctx.stroke();
  }
  if (o.hi !== false && w > 2 * c + 8) {
    ctx.fillStyle = o.hi || 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + c + 3, y + 1, w - c - 8, 1);
  }
  if (o.ticks) {
    const t = Math.min(9, h * 0.32), d = 3;
    ctx.strokeStyle = o.ticks;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + w - t, y - d); ctx.lineTo(x + w + d, y - d); ctx.lineTo(x + w + d, y + t);
    ctx.moveTo(x - d, y + h - t); ctx.lineTo(x - d, y + h + d); ctx.lineTo(x + t, y + h + d);
    ctx.stroke();
  }
}
// 老名字留着（不少地方在用）：现在一律画成刃形面板
function panel(x, y, w, h, border) {
  bladeBox(x, y, w, h, { c: 12, top: UI.panelTop, bot: UI.panelBot, border: border || UI.line });
}
function pill(x, y, w, h, fill, stroke, lw) {
  roundRect(x, y, w, h, h / 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}
// 进度条：斜切的刃条
function bar(x, y, w, h, p, fg, bg) {
  const s = Math.min(h, 6);
  slantPath(x, y, w, h, s);
  ctx.fillStyle = bg || 'rgba(255,255,255,0.09)';
  ctx.fill();
  p = clamp(p, 0, 1);
  if (p > 0) {
    slantPath(x, y, Math.max(s * 2, w * p), h, s);
    ctx.fillStyle = fg;
    ctx.fill();
  }
}
// 余光的记号：一颗竖着的菱形
function gem(x, y, r, c) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.68, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.68, y);
  ctx.closePath();
  ctx.fillStyle = c;
  ctx.fill();
}
// 分隔线：——◆——
function divider(cx, y, w, c) {
  ctx.fillStyle = c;
  ctx.fillRect(cx - w / 2, y, w / 2 - 9, 1);
  ctx.fillRect(cx + 9, y, w / 2 - 9, 1);
  gem(cx, y + 0.5, 4, c);
}
// 小刃签：一行字套一个刃形小框。返回宽度
function tag(x, y, text, c, o) {
  o = o || {};
  uf(o.w || 800, o.size || 12);
  const h = o.h || 22, w = textW(text) + (o.pad || 20) + (o.icon ? 16 : 0);
  const x0 = o.align === 'right' ? x - w : (o.align === 'center' ? x - w / 2 : x);
  bladeBox(x0, y - h / 2, w, h, { c: 6, fill: o.fill || '#0b1216', border: o.border || rgba(c, 0.55), hi: false });
  if (o.icon) o.icon(x0 + 13, y);
  ctx.textAlign = 'left';
  ctx.fillStyle = o.color || c;
  ctx.fillText(text, x0 + (o.pad || 20) / 2 + (o.icon ? 16 : 0), y + (o.size || 12) * 0.36);
  return w;
}
// 一排居中的小刃签。items: [{ t, c }]（c 必须是 #rrggbb）；appear(i) 给第 i 颗的弹出进度 0~1
function chipRow(items, cx, y, h, appear) {
  uf(800, 12);
  const ws = [];
  let total = -8;
  for (let i = 0; i < items.length; i++) { ws.push(textW(items[i].t) + 24); total += ws[i] + 8; }
  let x = cx - total / 2;
  for (let i = 0; i < items.length; i++) {
    const k = appear ? appear(i) : 1;
    if (k > 0) {
      const it = items[i], w = ws[i], s = easeBack(k);
      ctx.save();
      ctx.translate(x + w / 2, y);
      ctx.scale(s, s);
      ctx.globalAlpha *= clamp(k * 2, 0, 1);
      bladeBox(-w / 2, -h / 2, w, h, { c: 7, fill: '#0b1216', border: rgba(it.c, 0.7), hi: false });
      ctx.textAlign = 'center';
      ctx.fillStyle = it.c;
      ctx.fillText(it.t, 0, 4.5);
      ctx.restore();
    }
    x += ws[i] + 8;
  }
}
/* 印章：朱底、内外两道框、白字，微微歪着。像盖章一样砸下来：
   k = 砸的进度（0→1：从 1.9 倍大、透明，砸到原大），rot = 歪多少 */
function seal(x, y, text, c, k, rot, size) {
  if (k <= 0) return;
  const sz = size || 14;
  uf(900, sz);
  const w = textW(text) + sz * 1.3, h = sz * 2;
  const s = 1 + 0.9 * Math.pow(1 - easeOut(k), 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
  ctx.scale(s, s);
  ctx.globalAlpha *= clamp(k * 3, 0, 1);
  roundRect(-w / 2, -h / 2, w, h, 3);
  ctx.fillStyle = c || '#c9372d';
  ctx.fill();
  roundRect(-w / 2 + 2.5, -h / 2 + 2.5, w - 5, h - 5, 2);
  ctx.strokeStyle = 'rgba(255,240,228,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff4ea';
  ctx.fillText(text, 0, sz * 0.36);
  ctx.restore();
}
// 按钮 / 卡片右上角的小签（"可升级"）：一块不透明的小金签，轻轻跳
function cornerBadge(b, text) {
  uf(800, 10);
  const w = textW(text) + 14, h = 16;
  const s = 1 + 0.08 * Math.sin(nowMs() / 180);
  ctx.save();
  ctx.translate(b.x + b.w - w / 2 + 4, b.y - 2);
  ctx.scale(s, s);
  bladeBox(-w / 2, -h / 2, w, h, { c: 4, fill: UI.gold, border: null, hi: false });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1a1406';
  ctx.fillText(text, 0, 3.5);
  ctx.restore();
}

/* 全屏页 / 遮罩的底：墨黑 + 头顶一团压暗的青光 + 慢慢往上飘的光尘 + 两道很淡的斜刀光。
   a：墨底不透明度（主界面 / 死亡页要透出一点身后的场地） */
let INK_MOTES = null;
function inkBg(a) {
  ctx.globalAlpha = a === undefined ? 1 : a;
  ctx.fillStyle = UI.ink0;
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(W_CSS / 2, -H_CSS * 0.05, 0, W_CSS / 2, -H_CSS * 0.05, H_CSS * 0.75);
  g.addColorStop(0, 'rgba(16,58,70,0.55)');
  g.addColorStop(1, 'rgba(16,58,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W_CSS, H_CSS);

  if (!INK_MOTES) {
    let sd = 7919;
    const r = function () { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    INK_MOTES = [];
    for (let i = 0; i < 26; i++) INK_MOTES.push({ x: r(), y: r(), v: 0.012 + r() * 0.03, s: 0.6 + r() * 1.6, p: r() * 6.28 });
  }
  const t = nowMs() / 1000;
  for (let i = 0; i < INK_MOTES.length; i++) {
    const m = INK_MOTES[i];
    const y = ((m.y - t * m.v) % 1 + 1) % 1;
    ctx.globalAlpha = (0.18 + 0.22 * Math.sin(t * 1.3 + m.p)) * Math.min(1, y * 4);
    ctx.fillStyle = i % 5 ? '#9fefff' : '#ffe2a3';
    ctx.fillRect(m.x * W_CSS, y * H_CSS, m.s, m.s);
  }
  // 两道斜刀光：极淡，慢慢平移
  for (let i = 0; i < 2; i++) {
    const off = ((t * 0.02 + i * 0.5) % 1) * (W_CSS + H_CSS) - H_CSS;
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#bff6ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(off, H_CSS);
    ctx.lineTo(off + H_CSS * 0.9, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}


/* ---------------- 游戏中 HUD ----------------
   左上：分数（滚动上涨，连斩入账时跳一下）/ 最高或新纪录 / 本局余光 / 光盾
   中间：段位签 + 连斩数（身后一道段位色的斜刀光）+ 连斩窗口刃条 + 这一串攒的分 + 剑气
   右上：第几层 + 层名 + 下一层的刃条 / 本局契约
   右下：斩（冷却扫圈，跟着段位换色） */
function drawUI() {
  const top = hudTop();
  ptFn('(收尾)');
  drawTierFrame();      ptFn('段位光框');
  drawHudScore(top);    ptFn('分数');
  drawHudShield(top);   ptFn('光盾栏');
  drawHudDepth(top);    ptFn('层数破门');
  drawHudCombo(top);    ptFn('连斩');
  drawHudCards(top);    ptFn('刀诀小签');
  drawTrailArrow();     ptFn('糖路箭头');
  drawFlyers();         ptFn('飞字');
  drawStick();          ptFn('摇杆');
  drawDashBtn();        ptFn('斩按钮');
  drawLayerBanner();    ptFn('进层横幅');
  drawBanner();         ptFn('横幅');
  drawEnemyTip();       ptFn('新敌人卡');
  // 教程字永远画在最上面：它盖的是 HUD，但盖不住玩家自己的操作
  drawTutorial();       ptFn('教程');
  if (state === 'play') drawHudPause();
  if (testGod()) drawGodHud();
}

// 升段爆发：屏幕四周一圈段位色的光框，0.55 秒退掉，段位越高越亮越宽。
// 几层纯色由外往里、一层比一层淡叠出来（不用渐变：真机上渐变时有时无）
function drawTierFrame() {
  if (FB.flash <= 0) return;
  const f = FB.flash, t = FB.flashT;
  const env = f > 0.88 ? (1 - f) / 0.12 : f / 0.88;      // 0.07 秒亮起，再慢慢退
  const a = (0.3 + 0.05 * t) * env, b = 6 + 1.5 * t;
  // 六层由宽到窄叠上去，越靠边叠得越多：台阶细到看不出，像一圈往里散开的光
  // 黑潮试玩只叠两层：回头连斩一路升段，光框几乎一直亮着，六层就是一帧 24 笔、一屏多的半透明
  const layers = hordeMode ? [[b * 3, a * 0.2], [b * 1, a * 0.45]]
    : [[b * 4, a * 0.08], [b * 3.2, a * 0.1], [b * 2.5, a * 0.12], [b * 1.8, a * 0.15], [b * 1.2, a * 0.2], [b * 0.6, a * 0.3]];
  for (let i = 0; i < layers.length; i++) {
    const th = layers[i][0];
    ctx.fillStyle = rgba(FB.flashC, layers[i][1].toFixed(3));
    ctx.fillRect(0, 0, W_CSS, th);
    ctx.fillRect(0, H_CSS - th, W_CSS, th);
    ctx.fillRect(0, th, th, H_CSS - 2 * th);
    ctx.fillRect(W_CSS - th, th, th, H_CSS - 2 * th);
  }
}

function drawHudScore(top) {
  const sp = hudScore();
  const rec = FB.record;
  ctx.textAlign = 'left';
  ctx.save();
  ctx.translate(sp.x, sp.y);
  const s = 1 + FB.scorePop * 0.14;
  ctx.scale(s, s);
  const num = String(Math.floor(FB.score));
  const drawNum = function (ox, oy) {
    uf(900, 32);
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3,5,9,0.85)';
    ctx.lineWidth = 4;
    ctx.strokeText(num, ox, oy);
    glowText(num, ox, oy, rec ? UI.gold : UI.cyan, 1.5, 0.14);
    ctx.fillStyle = rec ? UI.gold : '#ffffff';
    ctx.fillText(num, ox, oy);
  };
  // 一张贴图贴上去（一笔）；分数变了用数字条拼一张新的（不写字，见 numStrip），局里排到下一帧开头再拼（见 textSprite）
  const SW = 200, SH = 46, SB = 36, SX = 6, st = scoreStrip(rec);
  const spr = st ? textSprite('score', num + (rec ? '!' : ''), SW, SH, function () { stripText(st, num, SX, SB); }, hordeMode ? 100 : 0) : null;
  if (spr) ctx.drawImage(spr, -SX, -SB, SW, SH);
  else drawNum(0, 0);
  ctx.restore();

  // 数字底下一道斜刀痕 + 最高 / 新纪录（一张贴图，一局里几乎不变）
  const sub = function () {
    slantPath(sp.x, top + 37, 26, 3, 3);
    ctx.fillStyle = rec ? UI.gold : UI.cyan;
    ctx.fill();
    uf(700, 11);
    ctx.textAlign = 'left';
    if (rec) {
      ctx.fillStyle = UI.gold;
      spaced('新纪录', sp.x + 32, top + 41, 2);
    } else if (FB.best0 > 0) {
      ctx.fillStyle = 'rgba(214,236,242,0.42)';
      ctx.fillText('最高 ' + FB.best0, sp.x + 32, top + 41);
    }
  };
  const ss = textSprite('scoreSub', rec + '|' + FB.best0 + '|' + sp.x + '|' + top, 140, 20, function () {
    ctx.translate(2 - sp.x, -30 - top);
    sub();
  });
  if (ss) ctx.drawImage(ss, sp.x - 2, top + 30, 140, 20);
  else sub();

  if (hordeMode || laneMode) return;      // 黑潮试玩、横屏跑酷没有余光
  // 余光：刃签 + 菱形，光点飞到这里才加数。不在跳的时候贴图
  const yp = hudYing();
  const on = FB.ying > 0;
  const k = 1 + FB.yingPop * 0.2;
  const yTag = function () {
    tag(0, 0, String(FB.ying), on ? UI.cyan : '#7f9aa3', {
      size: 13, pad: 18, color: on ? UI.ice : 'rgba(255,255,255,0.4)',
      border: on ? rgba(UI.cyan, 0.4 + 0.5 * FB.yingPop) : 'rgba(255,255,255,0.12)',
      icon: function (x, y) { gem(x, y, 6.5, on ? UI.cyan : 'rgba(191,246,255,0.35)'); }
    });
  };
  ctx.save();
  ctx.translate(yp.x - 14, yp.y);
  ctx.scale(k, k);
  const ys = FB.yingPop > 0 ? null : textSprite('ying', String(FB.ying), 124, 28, function () { ctx.translate(2, 14); yTag(); });
  if (ys) ctx.drawImage(ys, -2, -14, 124, 28);
  else yTag();
  ctx.restore();
}

// 破门条上的字：还差什么就写什么
function gateText() {
  if (!door) return '';
  if (door.n - candyNext <= 2) return '就在前面';
  return '还有 ' + Math.ceil((door.n - candyNext + 1) * CFG.candyGap / 10) + ' 米';     // 1 米 = 10 世界单位
}

// 右上角整块（层签 + 层名 + 破门条 + 契约签）是一张贴图（textSprite）：里面的字 / 进度变了才重画。
// 以前每帧十几笔（两块刃签、两条刃条、四行字），手机上约 1.2ms
function drawHudDepth(top) {
  const xr = W_CSS - 20;
  // 层名这一行会落在右上角胶囊底下：挪到胶囊左边（下面的契约签在胶囊下方，不用动）
  const xl = MENU && MENU.bottom > top && MENU.top < top + 32 ? Math.min(xr, MENU.left - 10) : xr;
  // 破门进度条贴右边、在胶囊下面 —— 跟着层名挪到中间会被连斩段位签压住
  const gy = MENU && MENU.left < xr ? Math.max(top + 26, MENU.bottom + 6) : top + 26;
  const lp = layerProgress();
  const label = !contract ? '' : (contractDone ? '契约达成' : contract.short + ' ' + Math.min(contractProgress(), contract.need) + '/' + contract.need);
  const glow = contract ? Math.round(clamp(contractFx / 2.6, 0, 1) * 20) / 20 : 0;
  const key = layer + '|' + gateText() + '|' + Math.round(lp * 208) + '|' + top + '|' + xl + '|' + gy + '|' + label + '|' + glow;
  const e = TXC.depth;
  let bx = e && e.key === key && e.k === DPR ? e.box : null;
  if (!bx) {
    // 贴图框：从层名的左端（或契约签的左端）到右边，宽按 8 取整，契约签字数变了也少重开画布
    uf(800, 11);
    const tw = textW('第 ' + layer + ' 层') + 14;
    uf(900, 17);
    let x0 = xl - tw - 8 - textW(layerName(layer));
    x0 = Math.min(x0, xr - 104);
    if (contract) { uf(700, 11); x0 = Math.min(x0, xr - textW(label) - 38); }
    const x1 = xr + 4, y0 = top - 2, y1 = (contract ? gy + 42 : gy + 13) + 4;
    const w = Math.ceil((x1 - x0 + 4) / 8) * 8, h = Math.ceil((y1 - y0) / 4) * 4;
    bx = { x: x1 - w, y: y0, w: w, h: h };
  }
  const spr = textSprite('depth', key, bx.w, bx.h, function () {
    ctx.translate(-bx.x, -bx.y);
    paintHudDepth(top, xl, xr, gy, lp, label, glow);
  });
  if (spr) {
    TXC.depth.box = bx;
    ctx.drawImage(spr, bx.x, bx.y, bx.w, bx.h);
    ctx.textAlign = 'left';
  } else paintHudDepth(top, xl, xr, gy, lp, label, glow);
  if (tutKey() === 'gate' && tutFinT <= 0) {
    // 教学「破门」这一步：进度条外面一圈呼吸的金框，告诉新手说的是这条
    const pk = 0.5 + 0.5 * Math.sin(nowMs() / 160);
    slantPath(xr - 108, gy - 4, 112, 21, 7);
    ctx.strokeStyle = rgba(UI.gold, (0.45 + 0.5 * pk).toFixed(3));
    ctx.lineWidth = 1.5 + pk;
    ctx.stroke();
  }
}
function paintHudDepth(top, xl, xr, gy, lp, label, glow) {
  // 层：一块小刃签写"第 N 层"，层名跟在左边
  uf(800, 11);
  const lt = '第 ' + layer + ' 层';
  const tw = tag(xl, top + 12, lt, UI.ice, { size: 11, h: 20, pad: 14, align: 'right', color: UI.ice, border: 'rgba(191,239,255,0.4)' });
  uf(900, 17);
  ctx.textAlign = 'right';
  ctx.fillStyle = UI.ice;
  ctx.fillText(layerName(layer), xl - tw - 8, top + 18);
  // 破门进度：一条带字的刃条"破门 · 还要 18 秒 / 还差 7 只"，快满时变金
  bar(xr - 104, gy, 104, 13, lp, lp > 0.8 ? 'rgba(255,209,102,0.85)' : 'rgba(255,122,200,0.5)', 'rgba(255,255,255,0.08)');
  uf(800, 10);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('门 · ' + gateText(), xr - 52, gy + 10);

  // 本局契约：刃签，底色按进度填一截金；达成后描金边、亮一下
  if (!contract) return;
  const p = Math.min(contractProgress(), contract.need);
  uf(700, 11);
  const h = 22, w = textW(label) + 38, x = xr - w, y = gy + 20;
  bladeBox(x, y, w, h, { c: 6, fill: '#0d1114', border: null, hi: false });
  if (!contractDone && p > 0) {
    ctx.save();
    bladePath(x, y, w, h, 6);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,209,102,0.14)';
    ctx.fillRect(x, y, w * p / contract.need, h);
    ctx.restore();
  }
  bladePath(x, y, w, h, 6);
  ctx.strokeStyle = contractDone ? rgba(UI.gold, 0.55 + 0.45 * glow) : 'rgba(255,209,102,0.28)';
  ctx.lineWidth = 1 + glow;
  ctx.stroke();
  // "契"字小印
  roundRect(x + 6, y + 4, 14, 14, 2);
  ctx.fillStyle = contractDone ? UI.gold : '#3a2b10';
  ctx.fill();
  ctx.textAlign = 'center';
  uf(900, 10);
  ctx.fillStyle = contractDone ? '#1a1406' : UI.gold;
  ctx.fillText(contractDone ? '✓' : '契', x + 13, y + h / 2 + 3.5);
  ctx.textAlign = 'left';
  uf(700, 11);
  ctx.fillStyle = contractDone ? UI.gold : 'rgba(255,255,255,0.66)';
  ctx.fillText(label, x + 26, y + h / 2 + 4);
}

function drawHudCombo(top) {
  if (combo < 2) return;
  const cp = hudCombo();
  // 黑潮：左下角、缩小一圈（hComboAt）；段位签跟着数字走（正式玩法在屏幕顶上那一行）
  if (cp.k) { ctx.save(); ctx.translate(cp.x, cp.y); ctx.scale(cp.k, cp.k); ctx.translate(-cp.x, -cp.y); top = cp.y - 108; }
  drawHudComboAt(cp, top);
  if (cp.k) ctx.restore();
}
function drawHudComboAt(cp, top) {
  const cx = cp.x, y = cp.y;
  const t = FB.tier, c = tierColor(t);

  // 身后一道段位色的斜刀光：连斩越高越亮，升段那一下闪一下
  const band = 0.08 + (t >= 0 ? 0.025 * (t + 1) : 0) + FB.tierPop * 0.12 + FB.comboPop * 0.04;
  slantPath(cx - 88, y - 44, 176, 50, 26);
  ctx.fillStyle = rgba(t >= 0 ? c : '#9fefff', Math.min(0.26, band));
  ctx.fill();
  slantPath(cx - 70, y + 3, 150, 2, 2);
  ctx.fillStyle = rgba(t >= 0 ? c : '#9fefff', 0.7);
  ctx.fill();

  // 连斩数：每一刀弹一下；到"破阵"以后带辉光。数没变就贴图（textSprite），一秒只重画几次
  const s = 1 + FB.comboPop * 0.18 + FB.tierPop * 0.12;
  const num = String(combo);
  const drawNum = function (ox, oy) {
    uf(900, 54);
    const nw = textW(num);
    uf(800, 24);
    const xw = textW('×');
    const x0 = ox - (nw + xw + 3) / 2;
    ctx.textAlign = 'left';
    outlineText('×', x0, oy - 2, rgba(c, 0.85), 3);
    uf(900, 54);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3,5,9,0.85)';
    ctx.lineWidth = 5;
    ctx.strokeText(num, x0 + xw + 3, oy);
    if (t >= 2) glowText(num, x0 + xw + 3, oy, c, 2.5, 0.22);
    else { ctx.fillStyle = c; ctx.fillText(num, x0 + xw + 3, oy); }
  };
  // 一张贴图贴上去（一笔）；连斩数变了用数字条拼一张新的（不写字，见 numStrip）
  const CW = 240, CH = 80, CB = 58, sn = comboStrip(t), sx = comboXStrip(t);
  const spr = sn && sx ? textSprite('combo', num + '|' + t, CW, CH, function () {
    const nw = stripW(sn, num), xw = stripW(sx, '×'), x0 = CW / 2 - (nw + xw + 3) / 2;
    stripText(sx, '×', x0, CB - 2);
    stripText(sn, num, x0 + xw + 3, CB);
  }, hordeMode ? 80 : 0) : null;
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(s, s);
  if (spr) ctx.drawImage(spr, -CW / 2, -CB, CW, CH);
  else drawNum(0, 0);
  ctx.restore();

  // 段位签：压在数字之上画，弹起来也不会被挡
  // 升段弹起那一下直接画（边框、角标在动），落定以后贴图
  if (t >= 0) {
    const name = COMBO_TIERS[t].name, tp = FB.tierPop;
    const tierTag = function () {
      uf(900, 14);
      const w = textW(name) + 28;
      bladeBox(-w / 2, -12, w, 24, { c: 7, fill: '#0c0e12', border: rgba(c, 0.5 + 0.5 * tp), lw: 1.2 + tp, hi: false, ticks: tp > 0.05 ? rgba(c, tp) : null });
      ctx.fillStyle = c;
      spaced(name, 0, 5, 3, 'center');
    };
    ctx.save();
    ctx.translate(cx, top + 40);
    const ts = 1 + tp * 0.4;
    ctx.scale(ts, ts);
    const sp = tp > 0 ? null : textSprite('tier', name + c, 220, 32, function () { ctx.translate(110, 16); tierTag(); });
    if (sp) ctx.drawImage(sp, -110, -16, 220, 32);
    else tierTag();
    ctx.restore();
  }

  // 连斩窗口：这一串还能撑多久。剩三成时开始闪 —— 快砍下一刀
  const p = clamp(comboTimer / POW.comboWindow, 0, 1);
  const bw = 120;
  ctx.globalAlpha = p < 0.3 ? 0.45 + 0.55 * Math.abs(Math.sin(nowMs() / 70)) : 1;
  bar(cx - bw / 2, y + 12, bw, 4, p, c);
  ctx.globalAlpha = 1;

  // 这一串攒的分 + 倍率：连斩越长每一刀越值钱，这一行说的就是这件事
  // 一刀变一次：贴图，变了才重画
  if (FB.chain > 0) {
    const g = '+' + FB.chain;
    const capped = combo >= CFG.scoreCap;
    const m = capped ? '倍率满' : '倍率 ×' + combo;
    const line = function (ox, oy) {
      uf(900, 17);
      const gw = textW(g);
      uf(700, 11);
      const mw = textW(m);
      const x = ox - (gw + 8 + mw) / 2;
      ctx.textAlign = 'left';
      uf(900, 17);
      outlineText(g, x, oy + 37, c, 3);
      uf(700, 11);
      ctx.fillStyle = capped ? UI.gold : 'rgba(255,255,255,0.5)';
      ctx.fillText(m, x + gw + 8, oy + 36);
    };
    const cs = textSprite('chain', g + '|' + m + '|' + c, 280, 30, function () { line(140, -16); }, hordeMode ? 120 : 0);
    if (cs) ctx.drawImage(cs, cx - 140, y + 16, 280, 30);
    else line(cx, y);
  }
  const n = POW.qiEvery;
  if (n > 0 && n <= 14) {
    const qs = textSprite('qi', n + '|' + qiCharge + '|' + c, 220, 18, function () { drawQiPips(110, 9, c); });
    if (qs) ctx.drawImage(qs, cx - 110, y + 45, 220, 18);
    else drawQiPips(cx, y + 54, c);
  } else drawQiPips(cx, y + 54, c);
}

// 飞进 HUD 的东西：余光光点先往上挑再落进胶囊；连斩入账先在原地亮一下再飞进分数
function drawFlyers() {
  for (let i = 0; i < flyers.length; i++) {
    const f = flyers[i];
    if (f.kind === 'ying') {
      const k = clamp((f.t - f.hold) / f.dur, 0, 1), kk = k * k;
      const mx = (f.x0 + f.x1) / 2, my = Math.min(f.y0, f.y1) - 90;
      const x = (1 - kk) * (1 - kk) * f.x0 + 2 * (1 - kk) * kk * mx + kk * kk * f.x1;
      const y = (1 - kk) * (1 - kk) * f.y0 + 2 * (1 - kk) * kk * my + kk * kk * f.y1;
      const r = 8 - 3 * k;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = UI.cyan;
      ctx.fill();
      ctx.globalAlpha = 1;
      gem(x, y, r, '#ffffff');
      gem(x, y, r * 0.55, UI.cyan);
      continue;
    }
    // 连斩入账
    const c = f.c || UI.gold;
    ctx.textAlign = 'center';
    if (f.t < f.hold) {
      const s = 1.5 - 0.5 * easeOut(f.t / 0.18);
      ctx.save();
      ctx.translate(f.x0, f.y0);
      ctx.scale(s, s);
      uf(700, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('×' + f.n + ' 连斩入账', 0, -24);
      uf(900, 24);
      outlineText('+' + f.v, 0, 0, c, 4);
      ctx.restore();
    } else {
      const k = clamp((f.t - f.hold) / f.dur, 0, 1), kk = k * k;
      const x = f.x0 + (f.x1 - f.x0) * kk;
      const y = f.y0 + (f.y1 - f.y0) * kk - Math.sin(k * Math.PI) * 30;
      ctx.globalAlpha = 1 - 0.4 * k;
      uf(900, 24 - 10 * k);
      outlineText('+' + f.v, x, y, c, 4);
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------------- 「斩」按钮 ----------------
   深色圆盘 + 一道斜劈过去的刀光 + 发光的"斩"字。
   外圈是冷却：从 12 点顺时针扫满 = 能斩；能斩时外面两圈慢慢呼吸。
   按下去整颗缩一点，按住自动连斩时两颗光点绕着外圈转，击杀返刀时荡开一圈。
   颜色跟着连斩段位走。玩法说明里的示意按钮也用这一个函数，长得一模一样。
   st：{ ready, p（冷却进度 0~1）, pressed, holding, flash（0~1）, c（#rrggbb）} */
function drawSlashButton(x, y, R, st) {
  const c = st.c, now = nowMs();
  ctx.save();
  ctx.translate(x, y);
  const s = st.pressed ? 0.93 : 1;
  ctx.scale(s, s);

  if (st.ready) {
    const br = 0.5 + 0.5 * Math.sin(now / 420);
    ctx.lineWidth = 6;
    ctx.strokeStyle = rgba(c, 0.06 + 0.08 * br);
    ctx.beginPath();
    ctx.arc(0, 0, R + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(c, 0.16 + 0.16 * br);
    ctx.beginPath();
    ctx.arc(0, 0, R + 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 不动的部分走贴图（见 slashBtnSprite）
  const spr = slashBtnSprite(R, c, st.ready);
  if (spr) ctx.drawImage(spr, -(R + 4), -(R + 4), (R + 4) * 2, (R + 4) * 2);
  else slashBtnBase(ctx, R, c, st.ready);

  // 冷却进度
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = st.ready ? c : rgba(c, 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + clamp(st.p, 0, 1) * Math.PI * 2);
  ctx.stroke();

  if (st.holding) {
    for (let i = 0; i < 2; i++) {
      const a = now / 170 + i * Math.PI;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (R + 5), Math.sin(a) * (R + 5), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    }
  }
  if (st.flash > 0.05) {
    ctx.globalAlpha *= st.flash * 0.7;
    ctx.lineWidth = 2;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, R + 4 + (1 - st.flash) * 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
// 斩按钮不动的部分：底盘、刀光带、内圈、冷却底环、"斩"字和它的辉光，画在 g 上（圆心在原点）
function slashBtnBase(g, R, c, ready) {
  // 底：不透明的深色圆盘，左上角微微发亮，像一块打磨过的刀镡（不透明，避免真机上辉光过亮）
  const gr = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
  gr.addColorStop(0, ready ? '#1a3c44' : '#171b23');
  gr.addColorStop(1, ready ? '#071114' : '#0a0c11');
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fillStyle = gr;
  g.fill();

  // 刀光：一道斜劈过圆盘的光带，裁在圆里
  g.save();
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.clip();
  g.rotate(-0.72);
  g.fillStyle = rgba(c, ready ? 0.16 : 0.05);
  g.fillRect(-R, -R * 0.16, R * 2, R * 0.32);
  g.fillStyle = 'rgba(255,255,255,' + (ready ? 0.5 : 0.12) + ')';
  g.fillRect(-R, -0.8, R * 2, 1.6);
  g.restore();

  g.lineWidth = 1;
  g.strokeStyle = rgba(c, ready ? 0.3 : 0.1);
  g.beginPath();
  g.arc(0, 0, R * 0.76, 0, Math.PI * 2);
  g.stroke();

  // 冷却底环
  g.lineWidth = 3.5;
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.stroke();

  // 斩：同色错位几笔当辉光，白色字芯
  g.textAlign = 'center';
  g.font = '900 ' + Math.round(R * 0.58) + 'px ' + UI_FONT;
  const ty = R * 0.2;
  if (ready) {
    const o = R * 0.05;
    g.fillStyle = rgba(c, 0.38);
    g.fillText('斩', -o, ty); g.fillText('斩', o, ty);
    g.fillText('斩', 0, ty - o); g.fillText('斩', 0, ty + o);
  }
  g.fillStyle = ready ? '#ffffff' : 'rgba(255,255,255,0.3)';
  g.fillText('斩', 0, ty);
}
// 斩按钮不动部分的贴图：按 颜色 × 能不能斩 × 半径 缓存（颜色只有段位那几种）。
// 以前整颗按钮每帧现画：一个渐变 + 一次裁剪 + 五遍"斩"字
const SBS = { map: {}, off: false };
function slashBtnSprite(R, c, ready) {
  const key = c + (ready ? '+' : '-') + R + '@' + DPR;
  if (SBS.map[key]) return SBS.map[key];
  if (SBS.off) return null;
  try {
    const half = R + 4, cv = IS_MG ? MG.createCanvas() : document.createElement('canvas');
    cv.width = cv.height = Math.ceil(half * 2 * DPR);
    const g = ctx2d(cv);
    g.setTransform(DPR, 0, 0, DPR, half * DPR, half * DPR);
    slashBtnBase(g, R, c, ready);
    SBS.map[key] = cv;
    return cv;
  } catch (e) { SBS.off = true; return null; }
}

function drawDashBtn() {
  if (!(isTouch && state === 'play')) return;
  if (hordeMode && HD.twoBlades) {
    // 两把斩：左下角左斩、右下角右斩，各看各的有没有能砍的；左蓝右黄（跟准星、范围弧一样，HD.sideC）
    const free = P.cd <= 0 && P.dashT <= 0 && hCaughtT <= 0, pr = nowMs() - hPressAt < 120;   // 被班主任抓了：两个斩键都灰着
    for (let k = -1; k <= 1; k += 2) {
      const ready = free && !!(k < 0 ? hAimTL : hAimTR);
      drawSlashButton(k < 0 ? W_CSS - DASH_BTN.x : DASH_BTN.x, DASH_BTN.y, DASH_BTN.r, {
        ready: ready, p: ready ? 1 : 1 - P.cd / POW.dashCd, pressed: (pr && hPressSide === k) || hHeld(k), holding: hHeld(k),
        flash: FB.comboPop, c: hSideC(k)
      });
    }
    return;
  }
  const ready = P.cd <= 0 && P.dashT <= 0 && (!hordeMode || !!hAimT);   // 黑潮试玩：面前没有能打的，斩键灰着
  drawSlashButton(DASH_BTN.x, DASH_BTN.y, DASH_BTN.r, {
    ready: ready,
    p: ready ? 1 : 1 - P.cd / POW.dashCd,
    pressed: btnTouchId !== null,
    holding: attackHeld && btnTouchId !== null,
    flash: FB.comboPop,
    c: FB.tier >= 0 ? tierColor(FB.tier) : '#3fd8e2'
  });
  // 头几局在按钮下面写一行：点 / 按住各是什么
  if (meta.runs < 3 && !tutOn() && !hordeMode) {
    ctx.textAlign = 'center';
    uf(600, 11);
    ctx.fillStyle = 'rgba(214,240,255,0.45)';
    ctx.fillText('轻点斩一刀 · 按住连斩', DASH_BTN.x, DASH_BTN.y + DASH_BTN.r + 20);
  }
}

// 拖动摇杆：手指按下的地方是底座，拖出去的方向就是走的方向（一直显示，淡淡的）
function drawStick() {
  if (!isTouch || touchId === null) return;
  const ox = tOrigin.x, oy = tOrigin.y;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.arc(ox, oy, 56, 0, Math.PI * 2);
  ctx.stroke();
  const kx = ox + tMove.x * 56, ky = oy + tMove.y * 56;
  ctx.beginPath();
  ctx.arc(kx, ky, 17, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(191,246,255,0.45)';
  ctx.stroke();
}


/* ---------------- 示意小件（玩法说明 / 新敌人卡片） ---------------- */
function miniPlayer(x, y, ang) {
  ctx.strokeStyle = 'rgba(234,252,255,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(ang) * 5, y + Math.sin(ang) * 5);
  ctx.lineTo(x + Math.cos(ang) * 17, y + Math.sin(ang) * 17);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = THEME.player;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// 五种敌人的简笔：和场上同一套"读法"（冲锋者带刺、重型套甲环、爆裂者发光的囊、守望者一只眼）
function miniEnemy(x, y, r, type, t) {
  if (type === 'charger') {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + t * 0.5;
      const rr = i % 2 ? r * 0.7 : r * 1.15;
      if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = THEME.enemyBody;
  ctx.fill();
  const fc = THEME.foe[type] || THEME.foe.grunt;
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = rgba(fc, 0.9);
  ctx.stroke();
  if (type === 'heavy') {
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t * 0.3;
      if (i) ctx.lineTo(x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55);
      else ctx.moveTo(x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55);
    }
    ctx.strokeStyle = 'rgba(255,140,70,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  if (type === 'watch') {
    ctx.arc(x + Math.cos(t) * r * 0.2, y + Math.sin(t) * r * 0.2, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = rgba(fc, 0.95);
  } else if (type === 'bomb') {
    ctx.arc(x, y, r * (0.32 + 0.06 * Math.sin(t * 5)), 0, Math.PI * 2);
    ctx.fillStyle = rgba(fc, 0.9);
  } else {
    ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = rgba(fc, 0.6);
  }
  ctx.fill();
}

function miniCrystal(x, y, h, a) {
  const w = h * 0.5;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.beginPath();
  ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - h * 0.55); ctx.lineTo(x + w, y + h * 0.55);
  ctx.lineTo(x, y + h); ctx.lineTo(x - w, y + h * 0.55); ctx.lineTo(x - w, y - h * 0.55);
  ctx.closePath();
  ctx.fillStyle = 'rgba(40,72,92,0.75)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(180,230,255,0.85)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = 'rgba(220,245,255,0.6)';
  ctx.fillRect(x - 0.6, y - h * 0.8, 1.2, h * 1.6);
  ctx.restore();
}

// 玩法说明里用的"斩杀圈"：分段画弧的暗红虚线（不用 setLineDash，见 drawReachRing）
function miniRing(x, y, r, a) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,106,92,' + a + ')';
  for (let i = 0; i < 28; i++) {
    const a0 = (i / 28) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a0 + Math.PI / 28);
    ctx.stroke();
  }
}

function miniBurst(x, y, k, c) {
  if (k <= 0 || k >= 1) return;
  ctx.globalAlpha = 1 - k;
  ctx.lineWidth = 2;
  ctx.strokeStyle = c;
  ctx.beginPath();
  ctx.arc(x, y, 6 + k * 22, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (8 + k * 26), y + Math.sin(a) * (8 + k * 26), 1.8, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 冲刺留下的一道刀光
function miniSlash(x0, y0, x1, y1, a) {
  ctx.globalAlpha = a;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(UI.cyan, 0.35);
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

function lerp(a, b, k) { return a + (b - a) * k; }


/* ---------------- 新敌人卡片 ----------------
   新敌人头两次出场（进层后单独刷出来的那只"讲解员"）时，屏幕上方弹一张卡：
   画出它的样子 + 一句怎么对付。4 秒后收起。
   放在上方横幅那一格（下方是左手拖动的地方，会被手指挡住），轮到它时才开始计时 */
const ENEMY_TIPS = {
  bomb:    { name: '爆裂者', tip: '被斩后 0.6 秒炸开 · 砍完马上挪开' },
  heavy:   { name: '重型',   tip: '要砍两刀 · 第一刀只破甲' },
  charger: { name: '冲锋者', tip: '亮起红圈 = 要冲了 · 往侧面闪' },
  watch:   { name: '守望者', tip: '靠近会吸走你的光 · 先斩掉它' }
};
const ENEMY_TIP_T = 4.2;
let enemyTip = null;      // { type, t }

function showEnemyTip(type) {
  if (!ENEMY_TIPS[type] || (meta.seen[type] || 0) >= 2) return;
  meta.seen[type] = (meta.seen[type] || 0) + 1;
  enemyTip = { type: type, t: 0 };
}

function enemyTipFree() { return !tutOn() && layerFxT <= 0.2 && !banners.length; }

function drawEnemyTip() {
  if (!enemyTip || !enemyTipFree()) return;
  const T = ENEMY_TIPS[enemyTip.type], t = enemyTip.t;
  const a = t < 0.2 ? t / 0.2 : clamp((ENEMY_TIP_T - t) / 0.4, 0, 1);
  const title = '新敌人 · ' + T.name;
  uf(800, 15);
  const nw = textW(title);
  uf(500, 12);
  const tw = textW(T.tip);
  const w = Math.min(W_CSS - 24, Math.max(nw, tw) + 84), h = 62;
  const x = W_CSS / 2 - w / 2, y = H_CSS * 0.29 - h / 2;
  ctx.globalAlpha = a;
  const fc = THEME.foe[enemyTip.type];
  bladeBox(x, y, w, h, { c: 12, top: '#0f1a20', bot: '#070c10', border: rgba(fc, 0.6), lw: 1.2, ticks: rgba(fc, 0.8) });
  hexPath(x + 34, y + h / 2, 21, Math.PI / 6);
  ctx.fillStyle = '#05080b';
  ctx.fill();
  ctx.strokeStyle = rgba(fc, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
  miniEnemy(x + 34, y + h / 2, 12, enemyTip.type, nowMs() / 1000);
  ctx.textAlign = 'left';
  uf(800, 15);
  ctx.fillStyle = THEME.foe[enemyTip.type];
  ctx.fillText(title, x + 62, y + 27);
  uf(500, 12);
  ctx.fillStyle = 'rgba(214,240,255,0.7)';
  ctx.fillText(T.tip, x + 62, y + 46);
  ctx.globalAlpha = 1;
}

// 引导气泡：一颗金色的小气泡 + 往下指的尖，挂在按钮左上方轻轻上下跳
function drawCoach(b, text) {
  const bob = Math.sin(nowMs() / 200) * 3;
  uf(800, 12);
  const w = textW(text) + 20, h = 24;
  const x = b.x, y = b.y - h - 9 + bob;
  bladeBox(x, y, w, h, { c: 6, fill: UI.gold, border: null, hi: false });
  ctx.beginPath();
  ctx.moveTo(x + 16, y + h - 1); ctx.lineTo(x + 30, y + h - 1); ctx.lineTo(x + 23, y + h + 7);
  ctx.closePath();
  ctx.fillStyle = UI.gold;
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1a1406';
  ctx.fillText(text, x + 10, y + 16);
}


/* ---------------- 玩法说明 ----------------
   主界面「玩法说明」进来，一页讲一件事：上面一块会动的示意图，下面三四句话。
   左右翻页（点按钮，或点示意图的左 / 右半边）；最后一页可以直接开局，或者重新走一遍新手教学。 */
let guidePage = 0;
let guideReturn = 'ready';
let guideT0 = 0;

const GUIDE = [
  { title: '移动', art: artMove, lines: [
    '手指按住屏幕任意空白处，往哪拖人就往哪走',
    '拖得越远走得越快，松手就停',
    '左手管走、右手管斩，两只手一起用'] },
  { title: '斩 · 轻点', art: artTap, lines: [
    '点一下「斩」= 扑出去斩一刀，冲刺途中无敌',
    '不拖动时：自动扑向最近的敌人',
    '边拖边点：那个方向有怪就砍它，没有就冲过去',
    '砍中 → 冷却立刻清零；砍空要等 0.5 秒'] },
  { title: '斩 · 按住', art: artHold, lines: [
    '按住「斩」不放 = 自动连斩，一路砍下去',
    '边拖边按：只砍拖的方向，不会被身后的拽回去',
    '刚收刀滑出去那一下，碰到的怪也算砍到',
    '圈里没怪会自己去砍晶柱；什么都没有就不挥刀'] },
  { title: '光会灭 · 捡嘉欣的糖', art: artCandy, lines: [
    '身边这圈光一直在变小，越往下灭得越快',
    '嘉欣被卷走时一路撒了糖：捡一颗补一截光',
    '斩怪不补光 —— 光灭了就输，别站着不动',
    '红虚线圈是斩杀圈：圈里的怪按住「斩」自动砍'] },
  { title: '破门 · 往下打', art: artGate, lines: [
    '糖连成一条路，路的尽头是这一层的门',
    '碰到门就斩开它，冲进下一层，挑一张刀诀',
    '下一颗糖在屏幕外时，屏幕边上有箭头指着',
    '每层有自己的特性，越往下越凶 —— 越深越好'] },
  { title: '余光 · 怎么拿', art: artYing, lines: [
    '斩碎晶柱：每根 +' + YING_CRYSTAL + ' 余光，碎片还能顺手杀怪',
    '晶柱会不断从光外的黑暗里长出来',
    '完成本局契约（右上角）：+50 ~ 70',
    '结算时看广告：晶柱余光翻倍，或直接 +' + ECHO_AD] },
  { title: '余光 · 怎么用', art: artShop, lines: [
    '主界面右上角「余光」，或结算页「强化」',
    '五项强化：延锋 · 续势 · 光盾 · 聚光 · 剑气',
    '每项三级，下一局开局就生效',
    '「重置技能」全额退回，可以随便试'] },
  { title: '认识敌人', art: artEnemies, lines: [
    '普通怪一刀一只，被碰到就死',
    '每破门一层，新敌人会先单独出来一只',
    '它头顶有标记，屏幕下方会告诉你怎么对付'] },
  { title: '越连越强', art: artTiers, lines: [
    '连斩越长每刀越值钱，倍率最高 ×' + CFG.scoreCap,
    '每过一道坎升一段，整个场地跟着变色',
    '快断时会滴答响 —— 最后关头续上是「险！」',
    '死了看广告复活：连斩保留一半，还送一面光盾'] }
];

// 玩法说明只从主界面「玩法说明」进（第一次玩不再先弹：试玩的人嫌"一上来就是九页说明书"，直接进教学局边打边学）
function openGuide(page) {
  guideReturn = state;
  state = 'guide';
  guidePage = page || 0;
  guideT0 = nowMs();
  resetInput();
}
function closeGuide() { state = guideReturn; }
function guideGo(d) {
  const n = clamp(guidePage + d, 0, GUIDE.length - 1);
  if (n !== guidePage) { guidePage = n; guideT0 = nowMs(); }
}

function guideLayout() {
  const short = H_CSS < 720;
  // 整页从右上角胶囊（"···"和关闭）下面排起：不然"跳过 / 关闭"正好压在平台的关闭键上
  const top = MENU ? Math.max(SAFE_TOP + 14, MENU.bottom + 12) : SAFE_TOP + 14;
  const w = Math.min(350, W_CSS - 32), x = (W_CSS - w) / 2;
  const navY = H_CSS - SAFE_BOTTOM - 62;
  const half = (w - 12) / 2;
  // 示意图吃掉剩下的高度：留出最多四句说明、页码点和"重新教学"那一行，封顶 300
  const gapT = short ? 26 : 34, lineH = short ? 24 : 28;
  const artH = clamp(navY - 50 - 30 - lineH * 4 - (top + 66) - gapT, 150, 300);
  return {
    x: x, w: w, top: top, short: short,
    art: { x: x, y: top + 66, w: w, h: artH },
    textY: top + 66 + artH + gapT,
    close: { x: x + w - 70, y: top - 4, w: 70, h: 34 },
    prev: { x: x, y: navY, w: half, h: 48 },
    next: { x: x + half + 12, y: navY, w: half, h: 48 },
    replay: { x: x, y: navY - 50, w: w, h: 40 }
  };
}

function guideTap(t) {
  const L = guideLayout();
  const last = guidePage === GUIDE.length - 1;
  if (inRect(t, L.close)) { closeGuide(); return; }
  if (last && inRect(t, L.replay)) {
    closeGuide();
    replayTutorial();
    return;
  }
  if (inRect(t, L.next)) {
    if (!last) { guideGo(1); return; }
    closeGuide();
    if (state === 'ready') start();
    return;
  }
  if (inRect(t, L.prev)) { guideGo(-1); return; }
  if (inRect(t, L.art)) guideGo(t.clientX < L.art.x + L.art.w / 2 ? -1 : 1);
}

// 主界面开始键下面两颗并排的小胶囊：「玩法说明」「新手教程」
function readyGuideBtn() {
  return { x: W_CSS / 2 - 136, y: H_CSS - SAFE_BOTTOM - 132, w: 128, h: 36 };
}
function readyTutBtn() {
  return { x: W_CSS / 2 + 8, y: H_CSS - SAFE_BOTTOM - 132, w: 128, h: 36 };
}

function drawGuide() {
  inkBg(1);
  const L = guideLayout();
  const g = GUIDE[guidePage];
  const last = guidePage === GUIDE.length - 1;
  const t = (nowMs() - guideT0) / 1000;

  ctx.textAlign = 'left';
  uf(700, 11);
  ctx.fillStyle = 'rgba(77,247,255,0.6)';
  spaced('玩法说明　' + (guidePage + 1) + ' / ' + GUIDE.length, L.x, L.top + 14, 2);
  uf(900, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(g.title, L.x, L.top + 46);
  slantPath(L.x, L.top + 53, 34, 3, 3);
  ctx.fillStyle = UI.cyan;
  ctx.fill();
  drawButton(L.close, '关闭', { kind: 'ghost', size: 14 });

  // 示意图：裁在框里，越界的不画
  const b = L.art;
  bladeBox(b.x, b.y, b.w, b.h, { c: 18, top: '#0a1217', bot: '#05090c', border: UI.line, ticks: 'rgba(77,247,255,0.45)' });
  ctx.save();
  bladePath(b.x, b.y, b.w, b.h, 18);
  ctx.clip();
  g.art(b, t);
  ctx.restore();
  ctx.globalAlpha = 1;

  // 说明：每句前面一颗小菱形
  ctx.textAlign = 'left';
  let y = L.textY;
  for (let i = 0; i < g.lines.length; i++) {
    const k = easeOut((t - 0.1 - i * 0.08) / 0.3);
    ctx.globalAlpha = k;
    gem(L.x + 6, y - 5, 4.5, UI.cyan);
    uf(i === 0 ? 700 : 500, 14);
    ctx.fillStyle = i === 0 ? '#eafcff' : 'rgba(214,240,255,0.72)';
    ctx.fillText(g.lines[i], L.x + 18, y);
    y += L.short ? 24 : 28;
  }
  ctx.globalAlpha = 1;

  // 页码点
  const dy = (last ? L.replay.y : L.prev.y) - 16;
  for (let i = 0; i < GUIDE.length; i++) {
    const cur = i === guidePage;
    gem(W_CSS / 2 + (i - (GUIDE.length - 1) / 2) * 14, dy + 2, cur ? 5.5 : 3.5, cur ? UI.cyan : 'rgba(255,255,255,0.2)');
  }

  drawButton(L.prev, '上一页', { kind: guidePage > 0 ? 'plain' : 'off', size: 15 });
  if (last) {
    drawButton(L.replay, '重新体验新手教学', { kind: 'ghost', size: 13, color: 'rgba(191,246,255,0.8)' });
    drawButton(L.next, guideReturn === 'ready' ? '开始游戏' : '知道了', { kind: 'primary', size: 16, weight: 900, glow: UI.cyan });
  } else {
    drawButton(L.next, '下一页', { kind: 'plain', size: 15, color: UI.ice, border: 'rgba(77,247,255,0.45)' });
  }
}

// 示意图里的小标签：暗描边小字
function artLabel(txt, x, y, c) {
  ctx.textAlign = 'center';
  uf(700, 11);
  outlineText(txt, x, y, c || 'rgba(214,240,255,0.7)', 3);
}

// 1. 移动：左边手指拖着摇杆转圈，右边小人朝同一个方向走
function artMove(b, t) {
  const ox = b.x + b.w * 0.27, oy = b.y + b.h * 0.55;
  const ang = t * 1.3;
  const k = 0.65 + 0.35 * Math.sin(t * 0.9);
  const fx = ox + Math.cos(ang) * 36 * k, fy = oy + Math.sin(ang) * 36 * k;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.arc(ox, oy, 36, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(lerp(ox, fx, i / 4), lerp(oy, fy, i / 4), 1.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(191,246,255,' + (0.2 + i * 0.15) + ')';
    ctx.fill();
  }
  drawFinger(fx, fy, true, 1);
  artLabel('按住往外拖', ox, b.y + b.h - 18);

  const cx = b.x + b.w * 0.72, cy = b.y + b.h * 0.48, R = Math.min(b.w * 0.16, b.h * 0.28);
  for (let i = 6; i >= 1; i--) {
    const a = ang - i * 0.13;
    ctx.globalAlpha = 0.5 - i * 0.07;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(a) * R, cy - Math.cos(a) * R, 3, 0, Math.PI * 2);
    ctx.fillStyle = UI.cyan;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  miniPlayer(cx + Math.sin(ang) * R, cy - Math.cos(ang) * R, ang);
  artLabel('人跟着走', cx, b.y + b.h - 18);
}

// 2. 轻点：手指点一下，主角扑向那只怪，怪碎掉、冷却立刻转满
function artTap(b, t) {
  const T = 1.9, ph = (t % T) / T;
  const bx = b.x + b.w - 46, by = b.y + b.h - 46;
  const p0 = { x: b.x + 54, y: b.y + b.h * 0.58 }, e = { x: b.x + b.w * 0.56, y: b.y + b.h * 0.34 };
  const dash = clamp((ph - 0.22) / 0.12, 0, 1);
  const back = clamp((ph - 0.6) / 0.3, 0, 1);
  const px = dash < 1 ? lerp(p0.x, e.x, dash) : lerp(e.x, p0.x, easeOut(back));
  const py = dash < 1 ? lerp(p0.y, e.y, dash) : lerp(e.y, p0.y, easeOut(back));
  const hit = ph > 0.34;
  const respawn = clamp((ph - 0.8) / 0.15, 0, 1);
  if (!hit || respawn > 0) {
    ctx.globalAlpha = hit ? respawn : 1;
    miniEnemy(e.x, e.y, 11, 'grunt', t);
    ctx.globalAlpha = 1;
  }
  if (dash > 0 && ph < 0.5) miniSlash(p0.x, p0.y, px, py, 1 - clamp((ph - 0.34) / 0.16, 0, 1));
  miniBurst(e.x, e.y, (ph - 0.34) / 0.3, UI.cyan);
  miniPlayer(px, py, Math.atan2(e.y - p0.y, e.x - p0.x));
  if (ph > 0.34 && ph < 0.62) artLabel('冷却清零！', bx, by - 40, UI.gold);

  const down = ph > 0.12 && ph < 0.26;
  drawSlashButton(bx, by, 26, {
    ready: ph < 0.22 || ph > 0.34, p: ph < 0.22 || ph > 0.34 ? 1 : 0.15,
    pressed: down, holding: false, flash: ph > 0.34 ? 1 - (ph - 0.34) / 0.2 : 0, c: '#3fd8e2'
  });
  drawFinger(bx + 8, by + 12, down, 1);
  artLabel('点一下', bx, b.y + b.h - 8);
}

// 3. 按住：手指一直按着，主角在圈里一只接一只地砍下去
function artHold(b, t) {
  const T = 3.4, ph = t % T;
  const bx = b.x + b.w - 46, by = b.y + b.h - 46;
  const c0 = { x: b.x + b.w * 0.4, y: b.y + b.h * 0.5 };
  const ring = Math.min(b.h * 0.4, 84);
  miniRing(c0.x, c0.y, ring, 0.5);
  const es = [
    { x: c0.x + ring * 0.6, y: c0.y - ring * 0.45 },
    { x: c0.x - ring * 0.55, y: c0.y - ring * 0.35 },
    { x: c0.x + ring * 0.05, y: c0.y + ring * 0.65 }
  ];
  let pos = c0, from = c0, n = 0;
  for (let i = 0; i < 3; i++) {
    const s = i * 0.42, k = clamp((ph - s) / 0.22, 0, 1);
    if (k > 0) {
      const f = i ? es[i - 1] : c0;
      pos = { x: lerp(f.x, es[i].x, k), y: lerp(f.y, es[i].y, k) };
      from = f;
      if (k >= 1) n = i + 1;
      if (k < 1 || ph - s < 0.4) miniSlash(f.x, f.y, pos.x, pos.y, 1 - clamp((ph - s - 0.22) / 0.2, 0, 1));
    }
  }
  const home = clamp((ph - 1.8) / 0.6, 0, 1);
  if (home > 0) pos = { x: lerp(es[2].x, c0.x, easeOut(home)), y: lerp(es[2].y, c0.y, easeOut(home)) };
  const back = clamp((ph - 2.6) / 0.4, 0, 1);
  for (let i = 0; i < 3; i++) {
    const dead = ph > i * 0.42 + 0.22;
    if (!dead || back > 0) {
      ctx.globalAlpha = dead ? back : 1;
      miniEnemy(es[i].x, es[i].y, 10, 'grunt', t + i);
      ctx.globalAlpha = 1;
    }
    miniBurst(es[i].x, es[i].y, (ph - i * 0.42 - 0.22) / 0.3, UI.gold);
  }
  miniPlayer(pos.x, pos.y, Math.atan2(pos.y - from.y, pos.x - from.x));
  if (n > 0 && ph < 2.4) {
    ctx.textAlign = 'right';
    uf(900, 22);
    outlineText('×' + n, b.x + b.w - 14, b.y + 30, UI.gold, 4);
    uf(700, 11);
    ctx.fillStyle = 'rgba(255,209,102,0.7)';
    ctx.fillText('自动连斩', b.x + b.w - 14, b.y + 46);
  }
  drawSlashButton(bx, by, 26, { ready: true, p: 1, pressed: true, holding: true, flash: 0, c: '#ffd166' });
  drawFinger(bx + 8, by + 12, true, 1);
  artLabel('按住不放', bx, b.y + b.h - 8);
}

// 4. 斩杀圈：圈里的怪画全身，圈外的只剩一个红点
// 光会灭：小人从左往右顺着一排糖走，身边的光圈一直在缩，捡到一颗就涨回一截
function artCandy(b, t) {
  const T = t % 4, cx = b.x + b.w / 2, cy = b.y + b.h * 0.55;
  const x0 = cx - Math.min(130, b.w * 0.38), x1 = cx + Math.min(130, b.w * 0.38);
  const k = clamp(T / 3.2, 0, 1), px = x0 + (x1 - x0) * k, py = cy + Math.sin(k * Math.PI * 2) * 10;
  let got = 0;
  for (let i = 0; i < 5; i++) {
    const q = (i + 0.7) / 5.4, x = x0 + (x1 - x0) * q, y = cy + Math.sin(q * Math.PI * 2) * 10;
    if (k >= q) { got++; continue; }
    ctx.beginPath();
    ctx.moveTo(x - 4, y); ctx.lineTo(x - 9, y - 4); ctx.lineTo(x - 9, y + 4); ctx.closePath();
    ctx.moveTo(x + 4, y); ctx.lineTo(x + 9, y - 4); ctx.lineTo(x + 9, y + 4); ctx.closePath();
    ctx.fillStyle = '#2a1020'; ctx.fill();
    ctx.strokeStyle = CANDY_C; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = CANDY_C; ctx.fill();
  }
  // 光：随时间往下掉，每捡一颗补一截（和局内同一个意思，数是示意）
  const L = clamp(0.85 - T * 0.32 + got * 0.2, 0.1, 1), low = L < 0.3;
  ctx.beginPath();
  ctx.arc(px, py, 14 + 44 * L, 0, Math.PI * 2);
  ctx.strokeStyle = low ? '#ff9a5c' : '#bff6ff';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.75;
  ctx.stroke();
  ctx.globalAlpha = 1;
  miniPlayer(px, py, 0);
  artLabel('光：一直在变小', cx, b.y + 22);
  artLabel('捡糖 = 补光', cx, b.y + b.h - 12, CANDY_C);
}

// 5. 余光：刀光劈开晶柱，碎片四散，一颗光点飞进右上角的余光
function artYing(b, t) {
  const T = 2.6, ph = (t % T) / T;
  const cx = b.x + b.w * 0.42, cy = b.y + b.h * 0.56;
  const h = Math.min(b.h * 0.22, 46);
  const cut = ph > 0.2;
  const grow = clamp((ph - 0.72) / 0.22, 0, 1);
  if (!cut) miniCrystal(cx, cy, h, 1);
  else if (grow > 0) miniCrystal(cx, cy + h * (1 - grow), h * grow, grow);
  if (ph > 0.1 && ph < 0.32) {
    const k = clamp((ph - 0.1) / 0.1, 0, 1);
    miniSlash(cx - h * 1.6, cy + h * 0.9, lerp(cx - h * 1.6, cx + h * 1.6, k), lerp(cy + h * 0.9, cy - h * 0.9, k), 1);
  }
  if (cut && ph < 0.6) {
    const k = (ph - 0.2) / 0.4;
    for (let i = 0; i < 8; i++) {
      const a = i * 0.785 + 0.2, d = 10 + k * 70;
      ctx.globalAlpha = 1 - k;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(191,239,255,0.9)';
      ctx.fillRect(-5, -1.2, 10, 2.4);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  const tx = b.x + b.w - 58, ty = b.y + 30;
  const fk = clamp((ph - 0.24) / 0.3, 0, 1);
  if (fk > 0 && fk < 1) {
    const kk = fk * fk;
    gem(lerp(cx, tx, kk), lerp(cy, ty, kk) - Math.sin(fk * Math.PI) * 40, 7 - 3 * fk, UI.cyan);
  }
  const pop = fk >= 1 ? 1 + 0.25 * Math.max(0, 1 - (ph - 0.54) / 0.12) : 1;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.scale(pop, pop);
  pill(-34, -12, 76, 24, '#0c171b', rgba(UI.cyan, 0.5), 1);
  gem(-20, 0, 6, UI.cyan);
  ctx.textAlign = 'left';
  uf(800, 13);
  ctx.fillStyle = UI.ice;
  ctx.fillText(fk >= 1 ? '+' + YING_CRYSTAL : '余光', -10, 5);
  ctx.restore();
  artLabel('斩碎晶柱', cx, b.y + b.h - 14);
}

// 6. 强化：两张卡，手指点亮着的"升级"，等级格一格格亮起来，余光减少
function artShop(b, t) {
  const T = 2.2, ph = (t % T) / T, cyc = Math.floor(t / T) % 2;
  const x = b.x + 18, w = b.w - 36, ch = Math.min(64, (b.h - 70) / 2);
  const tapped = ph > 0.35;
  const lv = 1 + cyc + (tapped ? 1 : 0);
  const pts = 400 - cyc * 100 - (tapped ? 100 : 0);
  ctx.textAlign = 'center';
  pill(b.x + b.w / 2 - 50, b.y + 14, 100, 24, '#0c171b', rgba(UI.cyan, 0.45), 1);
  gem(b.x + b.w / 2 - 34, b.y + 26, 6, UI.cyan);
  uf(800, 13);
  ctx.fillStyle = UI.ice;
  ctx.fillText('余光 ' + pts, b.x + b.w / 2 + 6, b.y + 31);
  for (let i = 0; i < 2; i++) {
    const y = b.y + 50 + i * (ch + 10);
    const sk = SKILLS[i];
    const live = i === 0;
    roundRect(x, y, w, ch, 12);
    ctx.fillStyle = '#0d1418';
    ctx.fill();
    ctx.strokeStyle = live ? rgba(UI.cyan, 0.5) : '#1f232c';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.textAlign = 'left';
    uf(800, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sk.name, x + 14, y + 24);
    const mx = sk.cost.length;
    const l = live ? Math.min(mx, lv) : 1;
    for (let d = 0; d < mx; d++) {
      roundRect(x + 14 + d * 16, y + 34, 12, 4, 2);
      ctx.fillStyle = d < l ? (live && d === l - 1 && tapped && ph < 0.6 ? '#ffffff' : UI.cyan) : 'rgba(255,255,255,0.12)';
      ctx.fill();
    }
    const btn = { x: x + w - 82, y: y + ch / 2 - 16, w: 70, h: 32 };
    drawButton(btn, '升级', live
      ? { size: 13, bg: '#0f2a2e', border: UI.cyan, color: '#eafcff' }
      : { size: 13, color: 'rgba(255,255,255,0.3)' });
    if (live) {
      const down = ph > 0.25 && ph < 0.38;
      drawFinger(btn.x + btn.w * 0.6, btn.y + btn.h * 0.75, down, 1);
      if (tapped && ph < 0.7) artLabel('Lv.' + l + ' ✓', btn.x + btn.w / 2, btn.y - 6, UI.gold);
    }
  }
}

// 7. 敌人：四种特殊敌人一行一个，画出样子 + 一句怎么对付
function artEnemies(b, t) {
  const keys = ['bomb', 'heavy', 'charger', 'watch'];
  const rh = (b.h - 12) / 4;
  for (let i = 0; i < 4; i++) {
    const y = b.y + 6 + rh * i + rh / 2;
    const T = ENEMY_TIPS[keys[i]];
    miniEnemy(b.x + 34, y, Math.min(12, rh * 0.26), keys[i], t + i);
    ctx.textAlign = 'left';
    uf(800, 14);
    ctx.fillStyle = THEME.foe[keys[i]];
    ctx.fillText(T.name, b.x + 62, y - 3);
    uf(500, 12);
    ctx.fillStyle = 'rgba(214,240,255,0.7)';
    ctx.fillText(T.tip, b.x + 62, y + 15);
    if (i < 3) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(b.x + 14, b.y + 6 + rh * (i + 1), b.w - 28, 1);
    }
  }
}

// 8. 段位：连斩数从 0 一路涨，跨过一道坎就点亮下一颗段位
function artTiers(b, t) {
  const n = Math.floor((t % 5) / 5 * 112);
  const tr = tierOf(n);
  const cx = b.x + b.w / 2;
  ctx.textAlign = 'center';
  uf(900, 46);
  outlineText('×' + n, cx, b.y + 66, tierColor(tr), 5);
  uf(700, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('倍率 ×' + Math.min(n, CFG.scoreCap) + (n >= CFG.scoreCap ? '（满）' : ''), cx, b.y + 88);
  const items = COMBO_TIERS;
  const per = 4, cw = (b.w - 40) / per;
  for (let i = 0; i < items.length; i++) {
    const row = Math.floor(i / per), col = i % per;
    const rowN = Math.min(per, items.length - row * per);
    const x = cx + (col - (rowN - 1) / 2) * cw;
    const y = b.y + (b.h > 200 ? 128 : 112) + row * 40;
    const on = i <= tr;
    const w = cw - 10;
    pill(x - w / 2, y - 13, w, 26, on ? '#14110a' : '#0d1015', on ? rgba(items[i].c, 0.85) : 'rgba(255,255,255,0.08)', on && i === tr ? 2 : 1);
    uf(800, 12);
    ctx.fillStyle = on ? items[i].c : 'rgba(255,255,255,0.3)';
    ctx.fillText(items[i].name, x, y - 1);
    uf(600, 9);
    ctx.fillStyle = on ? rgba(items[i].c, 0.7) : 'rgba(255,255,255,0.2)';
    ctx.fillText('×' + items[i].at, x, y + 10);
  }
}

// 破门：先斩够数量（"还差 N 只"）→ 再待够时间（"还要 N 秒"）→ 一圈冲击波把身边的怪震开 → "破门 · 第 2 层"
// 破门：一排糖弯弯地通到右边的门，小人顺着捡过去，碰到门那一下冲击波炸开，"破门 · 第 2 层"
function artGate(b, t) {
  const T = t % 4.2, cy = b.y + b.h * 0.52;
  const x0 = b.x + b.w * 0.12, xd = b.x + b.w * 0.82;
  const k = clamp(T / 2.8, 0, 1), px = x0 + (xd - x0) * k, py = cy + Math.sin(k * Math.PI * 1.5) * 14;
  for (let i = 0; i < 6; i++) {
    const q = (i + 0.6) / 7, x = x0 + (xd - x0) * q, y = cy + Math.sin(q * Math.PI * 1.5) * 14;
    if (k >= q) continue;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fillStyle = CANDY_C; ctx.fill();
  }
  const dy = cy + Math.sin(Math.PI * 1.5) * 14;
  if (T < 2.8) {
    ctx.beginPath();
    ctx.rect(xd - 14, dy - 18, 6, 32); ctx.rect(xd + 8, dy - 18, 6, 32); ctx.rect(xd - 18, dy - 24, 36, 7);
    ctx.fillStyle = '#1a1406'; ctx.fill();
    ctx.strokeStyle = UI.gold; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.globalAlpha = 0.35; ctx.fillStyle = UI.gold; ctx.fillRect(xd - 8, dy - 17, 16, 31); ctx.globalAlpha = 1;
    artLabel('门', xd, dy - 32, UI.gold);
  }
  miniPlayer(px, py, 0);
  if (T >= 2.8) {
    const q = clamp((T - 2.8) / 0.6, 0, 1);
    ctx.globalAlpha = 1 - q * 0.8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 + 4 * (1 - q);
    ctx.beginPath(); ctx.arc(xd, dy, 16 + q * 90, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = clamp((T - 2.9) / 0.3, 0, 1);
    uf(900, 20);
    ctx.textAlign = 'center';
    outlineText('破门 · 第 2 层', b.x + b.w / 2, b.y + b.h - 22, '#bfefff', 4);
    ctx.globalAlpha = 1;
  } else artLabel('跟着糖走到门', b.x + b.w / 2, b.y + 22, CANDY_C);
}

// 进层：一条墨色横带从中间拉开，"第 N 层"拉开字距，层名落下；比以往都深时盖一枚"最深"印
function drawLayerBanner() {
  if (layerFxT <= 0) return;
  const age = 1.8 - layerFxT;
  const a = layerFxT > 1.2 ? age / 0.6 : Math.min(1, layerFxT / 0.8);
  const k = easeOut(age / 0.45);
  const cx = W_CSS / 2, y = H_CSS * 0.35;      // 低一点：别压住连斩数下面那行"+85 倍率"
  ctx.globalAlpha = clamp(a, 0, 1);
  inkBand(cx, y - 8, W_CSS * 0.92 * k, 92);

  // 字（第 N 层 / 层名 / 说明）在横幅里不动：一张贴图，十几笔变一笔
  const head = (layerBroke ? '破门 · ' : '') + '第 ' + layer + ' 层';
  const note = layerCfg(layer).note;
  const words = function (ox, oy) {
    ctx.textAlign = 'center';
    uf(700, 12);
    ctx.fillStyle = 'rgba(191,239,255,0.85)';
    spaced(head, ox, oy - 36, 4, 'center');
    uf(900, 44);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3,5,9,0.8)';
    ctx.lineWidth = 6;
    ctx.strokeText(layerName(layer), ox, oy + 6);
    glowText(layerName(layer), ox, oy + 6, '#ffffff', 2, 0.12);
    if (note) {
      uf(600, 13);
      ctx.fillStyle = 'rgba(191,239,255,0.75)';
      ctx.fillText(note, ox, oy + 30);
    }
  };
  const BW = W_CSS, BH = 96;            // 贴图：整屏宽，从"第 N 层"上沿到说明下沿
  const bs = textSprite('lbanner', head + '|' + layer + '|' + note + '|' + BW, BW, BH, function () { words(BW / 2, 56); });
  if (bs) ctx.drawImage(bs, cx - BW / 2, y - 56, BW, BH);
  else words(cx, y);
  ctx.textAlign = 'center';
  uf(700, 12);
  const sw = textW(head) / 2 + (Array.from(head).length - 1) * 2 + 14;
  ctx.fillStyle = 'rgba(191,239,255,0.5)';
  ctx.fillRect(cx - sw - 70 * k, y - 40, 70 * k, 1);
  ctx.fillRect(cx + sw, y - 40, 70 * k, 1);
  gem(cx - sw - 70 * k, y - 39.5, 3, 'rgba(191,239,255,0.7)');
  gem(cx + sw + 70 * k, y - 39.5, 3, 'rgba(191,239,255,0.7)');

  if (FB.depth0 > 0 && layer > FB.depth0) seal(cx + 86, y - 18, '最深', '#c9372d', (age - 0.25) / 0.3, -0.16, 12);
  ctx.globalAlpha = 1;
}

// 墨带：一条两头渐隐的暗色横带，大字压在上面在任何场景里都读得清
function inkBand(cx, cy, w, h) {
  if (w <= 2) return;
  const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, 'rgba(4,7,10,0)');
  g.addColorStop(0.2, 'rgba(4,7,10,0.72)');
  g.addColorStop(0.8, 'rgba(4,7,10,0.72)');
  g.addColorStop(1, 'rgba(4,7,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
}

/* 横幅（新纪录 / 连斩纪录 / 契约达成）：墨带拉开，大字砸下来，一道刀光从字底下划过去。
   "新纪录"另外盖一枚朱印 */
function drawBanner() {
  if (!banners.length || layerFxT > 0.2) return;
  const b = banners[0], t = b.t;
  const a = t < 0.15 ? t / 0.15 : clamp((b.dur - t) / 0.4, 0, 1);
  const s = 1 + 0.4 * (1 - easeOut(t / 0.22));
  const cx = W_CSS / 2, y = H_CSS * 0.29;
  ctx.globalAlpha = a;
  inkBand(cx, y - 2, W_CSS * 0.9 * easeOut(t / 0.25), 84);
  ctx.textAlign = 'center';
  uf(900, 34);
  const w = textW(b.text);
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(3,5,9,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeText(b.text, 0, 0);
  glowText(b.text, 0, 0, b.c, 2.5, 0.25);
  ctx.restore();
  slantPath(cx - w / 2 - 14, y + 9, (w + 28) * easeOut(t / 0.3), 3, 3);
  ctx.fillStyle = rgba(b.c, 0.9);
  ctx.fill();
  if (b.sub) {
    uf(700, 13);
    outlineText(b.sub, cx, y + 32, 'rgba(255,255,255,0.82)', 3);
  }
  if (b.text === '新纪录') seal(cx + w / 2 + 28, y - 22, '破', '#c9372d', (t - 0.12) / 0.25, 0.18, 13);
  ctx.globalAlpha = 1;
}

/* ---------------- 通用绘制小件 ---------------- */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 按钮：刃形。kind 定样子 ——
   primary 刃光青（主操作，带一道每 2.8 秒扫过去的反光）/ gold 晨金（广告、奖励）/
   plain 普通 / ghost 低调 / off 不能点 / danger 测试用的红。
   其余 opt：size / weight / color 覆盖字，sub = 第二行小字，glow = 外圈呼吸描边（"该点这里"），
   icon(x, y) = 字左边画一个小记号 */
const BTN = {
  plain:   { top: '#111b21', bot: '#0a1014', border: 'rgba(150,225,240,0.24)', color: 'rgba(234,246,248,0.9)' },
  primary: { top: '#155058', bot: '#0b262a', border: '#4df7ff', color: '#f2feff', ticks: 'rgba(77,247,255,0.8)', sheen: true },
  gold:    { top: '#3d2c10', bot: '#1d1508', border: '#d6a64a', color: '#ffe3a6', ticks: 'rgba(255,209,102,0.75)', sheen: true },
  ghost:   { top: '#0a1014', bot: '#070b0e', border: 'rgba(150,225,240,0.13)', color: 'rgba(214,236,242,0.58)' },
  off:     { top: '#0c1013', bot: '#090c0f', border: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.24)' },
  danger:  { top: '#2a0f10', bot: '#160809', border: 'rgba(255,110,100,0.45)', color: 'rgba(255,170,160,0.7)' }
};
function drawButton(b, label, opt) {
  opt = opt || {};
  const k = BTN[opt.kind] || BTN.plain;
  const c = Math.min(11, b.h * 0.3);
  if (opt.glow) {
    bladePath(b.x - 3, b.y - 3, b.w + 6, b.h + 6, c + 1);
    ctx.strokeStyle = rgba(opt.glow, 0.25 + 0.3 * Math.sin(nowMs() / 260));
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  bladeBox(b.x, b.y, b.w, b.h, {
    c: c, top: opt.bg || k.top, bot: opt.bg || k.bot, border: opt.border || k.border,
    ticks: opt.ticks === false ? null : k.ticks
  });
  if (k.sheen && opt.sheen !== false) {
    const ph = (nowMs() / 2800 + b.x * 0.001) % 1;
    if (ph < 0.32) {
      ctx.save();
      bladePath(b.x, b.y, b.w, b.h, c);
      ctx.clip();
      const sx = b.x - 40 + (b.w + 80) * (ph / 0.32);
      ctx.beginPath();
      ctx.moveTo(sx, b.y); ctx.lineTo(sx + 24, b.y); ctx.lineTo(sx + 6, b.y + b.h); ctx.lineTo(sx - 18, b.y + b.h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.textAlign = 'center';
  const size = opt.size || 16;
  const cy = b.y + b.h / 2 + (opt.sub ? -7 : 0);
  uf(opt.weight || 800, size);
  const lw = textW(label);
  const ix = opt.icon ? 11 : 0;
  ctx.fillStyle = opt.color || k.color;
  ctx.fillText(label, b.x + b.w / 2 + ix, cy + size * 0.36);
  if (opt.icon) opt.icon(b.x + b.w / 2 - lw / 2 - 4, cy);
  if (opt.sub) {
    uf(600, 11);
    ctx.fillStyle = opt.subColor || 'rgba(255,255,255,0.45)';
    ctx.fillText(opt.sub, b.x + b.w / 2, cy + size * 0.36 + 17);
  }
}


/* ---------------- 主界面 ----------------
   打过的人：刃阶卡（称号 + 最高分 + 离下一阶还差多少）+ 一句轮换的小贴士；
   第一次来的人：三句话讲清楚玩法。开始键是一颗会呼吸的胶囊，点屏幕任意处都算 */
const READY_TIPS = [
  '光会一直灭：斩怪不补光，跟着嘉欣的糖走',
  '糖路的尽头是门：碰到门就破门，挑一张刀诀',
  '连斩越长，每一刀越值钱 —— 倍率最高 ×' + CFG.scoreCap,
  '连斩 5 / 10 / 20 / 35 …… 每过一道坎都有名号',
  '斩碎晶柱 = 余光，余光换强化',
  '爆裂者死后会炸，砍完挪半步',
  '重型要两刀：第一刀只破甲',
  '活着的每一秒也在加分',
  '第 3 层地缝发红就要喷火 —— 别站缝上耍帅'
];

function drawReady() {
  const compact = H_CSS < 430;     // 横屏
  const short = H_CSS < 720;       // 矮竖屏（667 这一档）
  const cx = W_CSS / 2;
  const now = nowMs();
  const hm = CFG.mainMode === 'horde';   // 主玩法是黑潮：余光商店、玩法说明、新手教程、试玩入口都不画（2.12 节）
  inkBg(0.84);
  ctx.textAlign = 'center';

  // —— 顶栏：振动开关 / 余光入口（有能买的强化时描边呼吸 + 金签）——
  const sb = readySkillBtn();
  const up = canUpgrade();
  if (!hm) drawButton(sb, String(meta.pts), {
    kind: meta.pts > 0 ? 'plain' : 'ghost', size: 17, weight: 900, glow: up ? UI.cyan : null,
    color: meta.pts > 0 ? UI.ice : 'rgba(255,255,255,0.4)',
    icon: function (x, y) { gem(x - 4, y, 7, meta.pts > 0 ? UI.cyan : 'rgba(255,255,255,0.3)'); }
  });
  if (!hm) {
    uf(700, 9);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(191,246,255,0.45)';
    spaced('余光', sb.x + 12, sb.y + 13, 2);
    if (up) cornerBadge(sb, '可升级');
  }

  // 嘉欣糖商店（黑潮主玩法，2.13 节）：左上角，攒了几颗；有买得起的皮肤就描边呼吸 + 角上挂"可买"
  if (hm && shopOn()) {
    const cb = readyCandyBtn(), buy = shopCanBuy();
    drawButton(cb, String(meta.candy), {
      kind: meta.candy > 0 ? 'plain' : 'ghost', size: 17, weight: 900, glow: buy ? CANDY_C : null,
      color: meta.candy > 0 ? '#ffd0ea' : 'rgba(255,255,255,0.4)',
      icon: function (x, y) { candyIcon(x - 5, y, 0.85); }
    });
    uf(700, 9);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,170,215,0.5)';
    spaced('商店', cb.x + 12, cb.y + 13, 2);
    if (buy) cornerBadge(cb, '可买');
  }
  // 排行榜（0.5 节 RK）：商店下面；拉得起平台榜单才画
  if (hm && (rkBoardOn() || rkCanOpen())) drawButton(readyRankBtn(), '排行榜', { kind: 'ghost', size: 13, weight: 800, color: UI.gold });

  // 振动开关：开着时和"余光"同一档低调，关了更淡；浏览器里没有振动就不画
  if (canVibrate()) {
    drawButton(readyVibBtn(), meta.vib ? '振动 开' : '振动 关', {
      kind: meta.vib ? 'plain' : 'ghost', size: 14,
      color: meta.vib ? 'rgba(234,246,248,0.75)' : 'rgba(255,255,255,0.3)'
    });
  }

  // —— 标题：一个"斩"字，一道斜刀光从它身上劈过，左边竖题"嘉豪"，右边盖一枚朱印 ——
  const tSize = compact ? 58 : (short ? 80 : 96);
  // 标题不能压到顶上那排按钮（按钮为了躲右上角胶囊可能往下挪了，标题跟着往下）
  // （标题在正中，按钮在左右两边，横向不重叠，矮屏上竖向只留一点空就够）
  let y = Math.max(compact ? H_CSS * 0.26 : H_CSS * 0.22, readyTopY() + (compact || short ? 40 : 58) + tSize * 0.8);
  const sl = 0.6 + 0.4 * Math.sin(now / 900);
  ctx.save();
  ctx.translate(cx, y - tSize * 0.32);
  ctx.rotate(-0.36);
  ctx.fillStyle = rgba(UI.cyan, 0.10 * sl);
  ctx.fillRect(-tSize * 1.05, -5, tSize * 2.1, 10);
  ctx.fillStyle = rgba('#ffffff', 0.5 * sl);
  ctx.fillRect(-tSize * 0.95, -0.75, tSize * 1.9, 1.5);
  ctx.restore();

  uf(900, tSize);
  ctx.textAlign = 'center';
  // 辉光用分层绘制模拟，绝不用 shadowBlur：
  // 部分安卓机的微信 Canvas 关不掉阴影（shadowBlur=0 无效），
  // 一旦用过，之后所有帧的所有图形都会带一圈同半径的青色光晕。
  ctx.fillStyle = 'rgba(77,247,255,0.10)';
  for (let i = 0; i < 4; i++) ctx.fillText(THEME.title, cx, y);
  ctx.fillStyle = 'rgba(77,247,255,0.22)';
  ctx.fillText(THEME.title, cx, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(THEME.title, cx, y);
  // 游戏叫「嘉豪斩」："嘉豪"两个字竖着题在"斩"的左边，从上往下读正好是嘉豪斩
  if (THEME.titlePre) {
    const ps = Math.round(tSize * 0.3), px = cx - tSize * 0.68, cs = Array.from(THEME.titlePre);
    uf(900, ps);
    ctx.fillStyle = 'rgba(234,246,248,0.9)';
    for (let i = 0; i < cs.length; i++) ctx.fillText(cs[i], px, y - tSize * 0.42 + ps * 1.05 * i);
  }
  seal(cx + tSize * 0.62, y - tSize * 0.12, '显眼', '#c9372d', 1, -0.12, compact ? 11 : 13);

  y += compact ? 22 : 30;
  uf(800, 12);
  ctx.fillStyle = 'rgba(77,247,255,0.75)';
  const dw = spaced('DASH', cx, y, 9, 'center');
  ctx.fillStyle = 'rgba(77,247,255,0.35)';
  ctx.fillRect(cx - dw / 2 - 46, y - 4, 34, 1);
  ctx.fillRect(cx + dw / 2 + 12, y - 4, 34, 1);

  y += compact ? 22 : 30;
  uf(600, 14);
  ctx.fillStyle = 'rgba(234,246,248,0.62)';
  ctx.fillText(hm ? '嘉欣被嘉豪们吸引走了。冲上去，追回来！' : THEME.subtitle, cx, y);

  // —— 黑潮：最远几米 / 新手的两句话；正式玩法：刃阶卡（打过至少一局）/ 新手的三句话 ——
  if (hm) {
    y += compact ? 30 : (short ? 46 : 60);
    if (meta.hBest > 0) {
      uf(700, 12);
      ctx.fillStyle = 'rgba(214,236,242,0.5)';
      spaced('最 远', cx, y - (compact ? 22 : 30), 6, 'center');
      uf(900, compact ? 30 : 40);
      outlineText(meta.hBest + ' 米', cx, y + 6, UI.gold, 5);
      uf(600, 12);
      ctx.fillStyle = 'rgba(214,236,242,0.45)';
      ctx.fillText('最高 ' + meta.hScore + ' 分', cx, y + 30);
      y += compact ? 46 : 62;
    } else {
      uf(700, 14);
      ctx.fillStyle = 'rgba(255,209,102,0.88)';
      ctx.fillText('嘉豪潮在身后追：斩前面的嘉豪，往前闪一截', cx, y);
      y += 26;
      ctx.fillStyle = 'rgba(77,247,255,0.65)';
      ctx.fillText('攒满怒气点「连斩」，回头把整屏斩光', cx, y);
      y += compact ? 26 : 38;
    }
  } else if (meta.runs > 0 && !compact) {
    y = drawRankCard(cx, y + (short ? 16 : 24)) + (short ? 26 : 34);
    ctx.textAlign = 'center';
  } else {
    y += compact ? 26 : 38;
    uf(700, 14);
    ctx.fillStyle = 'rgba(255,209,102,0.88)';
    ctx.fillText(THEME.tipMain, cx, y);
    y += 26;
    ctx.fillStyle = 'rgba(77,247,255,0.65)';
    ctx.fillText(THEME.tipSub, cx, y);
    if (!compact) {
      y += 24;
      uf(500, 13);
      ctx.fillStyle = 'rgba(234,246,248,0.34)';
      ctx.fillText('斩碎晶柱 = 余光　·　爆裂者死后会炸', cx, y);
    }
    y += compact ? 26 : 34;
  }

  // 矮屏：开始键被下面的「黑潮 · 试玩」顶上来，这两行字放不下就不画（先省轮换贴士，再省操作说明）
  const btnTop = compact ? Infinity : (hm ? H_CSS - SAFE_BOTTOM - 120 : readyHordeBtn().y) - 12 - 56;
  // 黑潮打过的人：三个任务的卡（2.15 节）。放得下才画，排在操作说明前面（操作说明、新手教程放不下就让给它）
  if (hm && meta.runs > 0 && !compact) {
    const rowH = short ? 19 : 21, qh = 36 + rowH * 3, cw = Math.min(330, W_CSS - 40);
    if (y - 14 + qh <= btnTop - 10) { drawQuestCard(cx - cw / 2, y - 14, cw, rowH); y += qh + 14; }
    ctx.textAlign = 'center';
  }
  uf(500, 13);
  ctx.fillStyle = 'rgba(234,246,248,0.42)';
  if (y <= btnTop - 16) ctx.fillText(hm ? (HD.twoBlades ? (IS_MG ? '点左 / 右斩　斩那一边　·　按住　往那边斜着走' : 'A / ←  左斩（按住往左前走）　·　D / →  右斩　·　E  连斩')
    : IS_MG ? '自己往上跑　·　拖动屏幕 换方向　·　点「斩」 往前闪' : 'WASD / 方向键  换方向　·　空格  斩　·　E  连斩')
    : (IS_MG ? '拖动屏幕  移动　·　按住「斩」  连斩' : 'WASD / 方向键  移动　·　空格 / 左键  冲刺'), cx, y);
  // 黑潮的「新手教程」挪到「开始」下面（用户："主页的新手教程被遮挡了"：以前在操作说明下面，加了任务卡以后被「开始」压住）

  // 打过的人才轮换小贴士：每 3.8 秒换一句，淡入淡出，前面一颗金菱形（黑潮不放：说的都是正式玩法）
  if (!hm && meta.runs > 0 && !compact && y + 25 <= btnTop - 16) {
    y += 25;
    const ph = now / 3800, f = ph % 1;
    ctx.globalAlpha = clamp(Math.min(f, 1 - f) / 0.1, 0, 1);
    uf(600, 13);
    const tip = READY_TIPS[Math.floor(ph) % READY_TIPS.length];
    const tw = textW(tip);
    gem(cx - tw / 2 - 10, y - 4.5, 4, UI.gold);
    ctx.fillStyle = 'rgba(255,209,102,0.8)';
    ctx.fillText(tip, cx + 4, y);
    ctx.globalAlpha = 1;
  }

  // —— 开始：一把横着的刃（主按钮），外面一圈刃形涟漪往外扩；点屏幕任意处都算 ——
  let cy = compact ? H_CSS * 0.82 : Math.max(y + 66, H_CSS * (short ? 0.72 : 0.7));
  const bw = 236, bh = 56;
  // 兜底：开始键不能压到下面的「黑潮 · 试玩」「玩法说明 / 新手教程」（黑潮主玩法：不压到底下那行局数）
  if (!compact) cy = Math.min(cy, (hm ? H_CSS - SAFE_BOTTOM - 120 : readyHordeBtn().y) - 12 - bh / 2);
  const bx = cx - bw / 2, by = cy - bh / 2;
  const rp = (now / 1600) % 1;
  bladePath(bx - rp * 16, by - rp * 16, bw + rp * 32, bh + rp * 32, 12 + rp * 8);
  ctx.strokeStyle = rgba(UI.cyan, 0.4 * (1 - rp));
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawButton({ x: bx, y: by, w: bw, h: bh }, '开　始', { kind: 'primary', size: 21, weight: 900 });
  // 看广告带道具开局（2.13 节）：「开始」下面一把金刃，放不下就不画（点的时候也认不到）
  readyPropAd = null;                // 「看广告 · 带道具开局」挪到开局前那一页（hStartFlow）
  // 「新手教程」：「开始」下面一颗小胶囊（原来「看广告 · 带道具开局」那个位置），点了开一局从头教（2.14 节）；放不下才不画
  readyHTut = null;
  if (hm && HD.tut && by + bh + 30 + 36 <= H_CSS - SAFE_BOTTOM - 58) {
    readyHTut = { x: cx - 64, y: by + bh + 30, w: 128, h: 36 };
    drawButton(readyHTut, '新手教程', { kind: 'ghost', size: 13, weight: 700, color: 'rgba(214,236,242,0.78)',
      icon: function (x, y) {
        ctx.beginPath(); ctx.moveTo(x - 8, y - 6); ctx.lineTo(x + 1, y); ctx.lineTo(x - 8, y + 6); ctx.closePath();
        ctx.fillStyle = 'rgba(191,246,255,0.7)'; ctx.fill();
      } });
  }
  // 矮屏上这一行会撞到下面的「黑潮 · 试玩」，放不下就不画
  if (compact || hm || by + bh + 24 < readyHordeBtn().y) {
    uf(500, 11);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(214,236,242,0.38)';
    ctx.fillText(IS_MG ? '点屏幕任意处也能开始' : '点击 / 空格 也能开始', cx, by + bh + 18);
  }

  hEyeTile(0);                       // 墨里眼睛的贴图在主界面就画好（进黑潮的第一帧别再现画）
  hudStripsWarm();                   // HUD 数字条也在主界面一帧一张先画好（见 numStrip）
  // 黑潮试玩（2.12 节）：金刃，角上挂"新"
  if (!hm && readyHordeOn()) {
    const hb = readyHordeBtn();
    drawButton(hb, '黑潮 · 试玩', { kind: 'gold', size: 17, weight: 900 });
    cornerBadge(hb, '新');
  }

  // 玩法说明 / 新手教程：两把小刃（问号 / 三角记号）
  if (!compact && !hm) {
    const gb = readyGuideBtn(), tb = readyTutBtn();
    drawButton(gb, IS_MG ? '玩法说明' : '玩法说明 H', { kind: 'ghost', size: 13, weight: 700, color: 'rgba(214,236,242,0.78)',
      icon: function (x, y) {
        ctx.beginPath(); ctx.arc(x - 4, y, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(191,246,255,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
        uf(900, 10); ctx.textAlign = 'center'; ctx.fillStyle = UI.ice; ctx.fillText('?', x - 4, y + 3.5);
      } });
    drawButton(tb, IS_MG ? '新手教程' : '新手教程 T', { kind: 'ghost', size: 13, weight: 700, color: 'rgba(214,236,242,0.78)',
      icon: function (x, y) {
        ctx.beginPath(); ctx.moveTo(x - 8, y - 6); ctx.lineTo(x + 1, y); ctx.lineTo(x - 8, y + 6); ctx.closePath();
        ctx.fillStyle = 'rgba(191,246,255,0.7)'; ctx.fill();
      } });
  }

  // —— 这一局带着什么上场：学过的技能图标排一排，右下角标等级 ——
  const owned = [];
  for (let i = 0; i < SKILLS.length; i++) if (lvOf(SKILLS[i].id) > 0) owned.push(SKILLS[i]);
  if (owned.length && !hm) {
    const oy = H_CSS - SAFE_BOTTOM - (meta.runs > 0 ? 74 : 50), gapI = 36;
    let ox = cx - ((owned.length - 1) * gapI) / 2;
    for (let i = 0; i < owned.length; i++, ox += gapI) {
      drawSkillIcon(owned[i], ox, oy, 13, true, 0);
      uf(900, 10);
      ctx.textAlign = 'center';
      outlineText(String(lvOf(owned[i].id)), ox + 12, oy + 13, owned[i].c, 3);
    }
  }

  if (meta.runs > 0) {
    ctx.textAlign = 'center';
    uf(500, 12);
    ctx.fillStyle = 'rgba(214,236,242,0.3)';
    const bits = ['第 ' + meta.runs + ' 局', '累计 ' + meta.total + ' 分'];
    if (hm && meta.hBest > 0) bits.push('最远 ' + meta.hBest + ' 米');
    else if (!hm && meta.depthBest > 0) bits.push('最深 第 ' + meta.depthBest + ' 层');
    ctx.fillText(bits.join('　·　'), cx, H_CSS - SAFE_BOTTOM - 44);
  }

  // 版本水印：极淡，只有想核对版本的人才会注意到
  ctx.textAlign = 'right';
  uf(500, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillText('v' + BUILD_TAG, W_CSS - 14, H_CSS - SAFE_BOTTOM - 6);

  // 音频体检（见 AUD）：出错时标红，正常时和版本号一样淡
  ctx.fillStyle = AUD.err ? 'rgba(255,130,120,0.8)' : 'rgba(255,255,255,0.22)';
  ctx.fillText(audioStatus() + (KEEP ? ' · 常亮 ' + KEEP : '') + (VIB ? ' · 振动 ' + VIB : ''),
    W_CSS - 14, H_CSS - SAFE_BOTTOM - 20);

  // 帧体检（见 PERF）：上一局平均帧率和卡顿次数，卡过就标橙（这一版出过错的话，这个位置让给出错的红字）
  if (PERF.frames > 30 && !(CFG.testPanel && TEST.errs[0] && TEST.errs[0].v === BUILD_TAG)) {
    ctx.textAlign = 'left';
    ctx.fillStyle = PERF.n ? 'rgba(255,190,120,0.7)' : 'rgba(255,255,255,0.22)';
    ctx.fillText('上局 ' + Math.round(PERF.frames * 1000 / PERF.t) + ' 帧/秒 · 卡顿 ' + PERF.n + ' 次' +
      (PERF.n ? ' · 最长 ' + Math.round(PERF.worst) + 'ms' : ''), 14, H_CSS - SAFE_BOTTOM - 6);
  }
  // 测试数据入口（见 TEST）：左下角这一片都能点
  if (CFG.testPanel) {
    ctx.textAlign = 'left';
    uf(700, 11);
    ctx.fillStyle = 'rgba(77,247,255,0.6)';
    ctx.fillText('测试数据 ›', 14, H_CSS - SAFE_BOTTOM - 26);
    // 这一版出过错：红字提醒（出错不再卡死，不提醒就没人知道）
    const e0 = TEST.errs[0];
    if (e0 && e0.v === BUILD_TAG) {
      uf(700, 11);
      ctx.fillStyle = 'rgba(255,120,110,0.9)';
      ctx.fillText('出错 ' + TEST.errs.filter(function (x) { return x.v === BUILD_TAG; }).reduce(function (a, x) { return a + x.n; }, 0) + ' 次 · 点「测试数据」复制给开发', 14, H_CSS - SAFE_BOTTOM - 6);
    }
  }
  if (rkPick) drawRankPick();        // 排行榜：挑哪个榜（0.5 节）
}

// 刃阶卡：六边徽记里一颗刃阶色的菱形，称号 + 最高分 + 离下一阶的刃条（下一阶顺带解锁里程碑时用金字点出来）。返回卡片底边
function drawRankCard(cx, y) {
  const R = rankOf(meta.kills);
  const ranked = CFG.fakeRank && best > 0;          // 卡片最下面多一行全服排名（假的，见 RANK）
  const w = Math.min(330, W_CSS - 40), h = ranked ? 114 : 96, x = cx - w / 2;
  bladeBox(x, y, w, h, { c: 14, top: UI.panelTop, bot: UI.panelBot, border: rgba(R.c, 0.3), ticks: rgba(R.c, 0.55) });

  const ex = x + 34, ey = y + 36;
  hexPath(ex, ey, 19, Math.PI / 6);
  ctx.fillStyle = '#0a1418';
  ctx.fill();
  ctx.strokeStyle = rgba(R.c, 0.55);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  gem(ex, ey, 11, R.c);

  ctx.textAlign = 'left';
  uf(700, 10);
  ctx.fillStyle = UI.faint;
  spaced('刃阶 · 第 ' + (R.i + 1) + ' 阶', x + 64, y + 25, 1.5);
  uf(900, 22);
  ctx.fillStyle = R.c;
  ctx.fillText(R.name, x + 64, y + 50);

  ctx.textAlign = 'right';
  uf(700, 10);
  ctx.fillStyle = UI.faint;
  spaced('最高分', x + w - 16, y + 25, 1.5, 'right');
  uf(900, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(best), x + w - 16, y + 50);

  bar(x + 16, y + 63, w - 32, 5, R.p, R.c);
  uf(600, 11);
  ctx.textAlign = 'left';
  ctx.fillStyle = UI.dim;
  ctx.fillText(R.next ? meta.kills + ' / ' + R.next.at + ' 斩' : meta.kills + ' 斩', x + 16, y + 85);
  ctx.textAlign = 'right';
  const un = rankUnlock(R.next);
  ctx.fillStyle = un ? UI.gold : 'rgba(191,239,255,0.62)';
  ctx.fillText(R.next ? '下一阶 ' + R.next.name + (un ? ' · 解锁「' + un.name + '」' : '') : '已是最高阶',
    x + w - 16, y + 85);
  if (ranked) {
    const r = RANK.of(best);
    ctx.textAlign = 'left';
    uf(800, 11);
    ctx.fillStyle = UI.gold;
    ctx.fillText('全服第 ' + fmtNum(r.rank) + ' 名 · 强于 ' + Math.floor(r.pct * 100) + '% 的玩家', x + 16, y + 103);
    ctx.textAlign = 'right';
    uf(500, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('测试数据', x + w - 16, y + 103);
  }
  return y + h;
}

function audioStatus() {
  let s = '音频 ' + (AUD.mode || '未启动');
  if (AUD.n) s += ' · 就绪 ' + AUD.ok + '/' + AUD.n + ' · 播放 ' + AUD.plays;
  if (AUD.err) s += ' · 出错 ' + AUD.err + '：' + AUD.msg.slice(0, 40);
  return s;
}

/* ---------------- 死亡页 ----------------
   先报这一局拿下了什么（分数、段位、深度、斩杀），再给复活。
   离纪录不远时告诉玩家"再拿多少分就破" —— 复活的理由是往前够，而不是"太可惜了"。 */
// 死亡页先晚 DEAD_LOOK 秒出来：这段时间场面照常慢放，凶手圈红、身后一道红线标出它从哪边冲过来
const DEAD_LOOK = 0.55;
function drawDeathMark(a) {
  if (!deathMark || a <= 0.01) return;
  const p = toScreen(deathMark.x, deathMark.y), k = 0.5 + 0.5 * Math.sin(nowMs() / 110);
  const r = deathMark.r * SC + 10 + 4 * k;
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#ff4a3a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  if (!deathMark.blast) {
    ctx.moveTo(p.x - deathMark.ux * r, p.y - deathMark.uy * r);
    ctx.lineTo(p.x - deathMark.ux * (r + 46), p.y - deathMark.uy * (r + 46));
  }
  ctx.stroke();
  ctx.textAlign = 'center';
  uf(800, 12);
  outlineText(deathMark.blast ? '炸到你的' : '撞你的', p.x, p.y - r - 8, '#ff8a7a', 3);
  ctx.globalAlpha = 1;
}
function drawDead() {
  const a = clamp((deadT - DEAD_LOOK) * 2.2, 0, 1);
  drawDeathMark(1 - a);
  if (a <= 0.01) return;                 // 先看清是谁：这段时间死亡页一点都不画
  inkBg(0.93 * a);                       // inkBg 自己设透明度：底也跟着淡入，不是一上来就全黑
  // 头顶压一层暗朱色：这是"熄"的那一刻
  ctx.globalAlpha = a;
  const rg = ctx.createRadialGradient(W_CSS / 2, 0, 0, W_CSS / 2, 0, H_CSS * 0.6);
  rg.addColorStop(0, 'rgba(70,16,18,0.55)');
  rg.addColorStop(1, 'rgba(70,16,18,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W_CSS, H_CSS);

  const cx = W_CSS / 2;
  const compact = H_CSS < 430;
  const short = H_CSS < 720;
  const b = deadBtns();
  let y = H_CSS * (compact ? 0.16 : (short ? 0.17 : 0.21));

  ctx.textAlign = 'center';
  uf(800, 15);
  ctx.fillStyle = THEME.eyes ? 'rgba(255,59,107,0.85)' : '#8fc3e4';
  spaced(THEME.dieLabel.replace(/ /g, ''), cx, y, 8, 'center');
  divider(cx, y + 12, 150, 'rgba(143,195,228,0.35)');

  const rec = FB.best0 > 0 && score > FB.best0;
  const ss = compact ? 56 : (short ? 66 : 80);
  y += ss + 12;
  ctx.save();
  ctx.translate(cx, y);
  const k = 1 + 0.2 * (1 - easeOut(deadT / 0.3));
  ctx.scale(k, k);
  uf(900, ss);
  glowText(String(score), 0, 0, rec ? UI.gold : '#ffffff', 2.5, rec ? 0.25 : 0.07);
  ctx.restore();
  if (rec) {
    uf(900, ss);
    seal(cx + textW(String(score)) / 2 + 22, y - ss * 0.62, '新纪录', '#c9372d', (deadT - 0.25) / 0.3, 0.14, 12);
  }

  y += 30;
  uf(700, 13);
  ctx.textAlign = 'center';
  if (rec) {
    ctx.fillStyle = UI.gold;
    ctx.fillText('超过了 ' + FB.best0, cx, y);
  } else {
    const gap = FB.best0 - score;
    ctx.fillStyle = gap > 0 && gap <= FB.best0 * 0.3 ? 'rgba(255,209,102,0.88)' : 'rgba(214,236,242,0.45)';
    ctx.fillText(FB.best0 <= 0 ? '本局得分'
      : (gap <= FB.best0 * 0.3 ? '再拿 ' + gap + ' 分就破纪录' : '最高 ' + FB.best0), cx, y);
  }

  // 这一局拿下了什么：段位 / 深度 / 斩杀
  y += short ? 36 : 44;
  const t = tierOf(bestCombo);
  const deep = layerBestNew && FB.depth0 > 0;
  chipRow([
    { t: t >= 0 ? '×' + bestCombo + ' ' + COMBO_TIERS[t].name : '最高连斩 ×' + bestCombo, c: t >= 0 ? COMBO_TIERS[t].c : UI.ice },
    { t: '第 ' + layer + ' 层' + (deep ? '　最深' : ''), c: deep ? UI.gold : UI.ice },
    { t: '斩杀 ' + runKills, c: UI.ice }
  ], cx, y, 26);

  y += 32;
  uf(500, 12);
  ctx.fillStyle = 'rgba(159,232,255,0.5)';
  ctx.fillText('存活 ' + Math.floor(gameTime) + ' 秒　·　存活得分 +' + surviveGain, cx, y);

  if (!compact && contract) {
    y += 24;
    uf(600, 13);
    ctx.fillStyle = contractDone ? 'rgba(255,209,102,0.88)' : 'rgba(255,255,255,0.32)';
    ctx.fillText('契约　' + contract.text + '　' + (contractDone ? '达成 +' + contract.reward : '未达成'), cx, y);
  }
  if (!compact && unlockNew.length) {
    y += 24;
    const names = [];
    for (let i = 0; i < unlockNew.length; i++) names.push(unlockNew[i].name);
    uf(700, 13);
    ctx.fillStyle = 'rgba(125,240,255,0.92)';
    ctx.fillText('解锁　' + names.join(' / '), cx, y);
  }

  // 一句话：嘉豪倒了，嘉欣还在更深处（破了最深纪录就说"从没斩到这么深"）—— 放在按钮上方，两款分支都不占位。
  uf(500, 13);
  ctx.fillStyle = 'rgba(159,232,255,0.45)';
  const lastDie = runDeaths.length ? runDeaths[runDeaths.length - 1][0] : '';
  ctx.fillText(lastDie === '光灭了' ? '光灭了 —— 卷潮把嘉豪吞了。' : layerBestNew ? '嘉豪倒下了 —— 但从没斩到过这么深。' : '嘉豪倒下了 —— 嘉欣还在更深处。', cx, b.revive.y - 30);

  if (canRevive && reviveT > 0) {
    // 复活回来带着什么：连斩折半后的数、这一次的无敌时长（和 doRevive 同一套算法）
    const keep = Math.max(1, Math.floor(combo * 0.5));
    const inv = Math.max(1.1, 2.5 - 0.4 * reviveCount);
    drawButton(b.revive, '看广告 · 原地复活', {
      kind: 'gold', size: 17, weight: 900, glow: UI.gold,
      sub: '送光盾 · ' + (combo >= 2 ? '连斩保留 ×' + keep + ' · ' : '') + '无敌 ' + inv.toFixed(1) + ' 秒',
      subColor: 'rgba(255,217,143,0.62)'
    });

    // 倒计时：按钮右侧一圈，一秒一格
    const rx = b.revive.x + b.revive.w - 30, ry = b.revive.y + b.revive.h / 2;
    const p = clamp(reviveT / 5, 0, 1);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(rx, ry, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = UI.gold;
    ctx.beginPath();
    ctx.arc(rx, ry, 14, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    ctx.textAlign = 'center';
    uf(900, 12);
    ctx.fillStyle = UI.amber;
    ctx.fillText(String(Math.ceil(reviveT)), rx, ry + 4);

    // 不限次数：第一次进来告诉玩家"可以一直回来"，之后只报已复活几次，
    // 让代价（连击折半、无敌变短）成为心理门槛，而不是硬上限。
    ctx.textAlign = 'left';
    uf(500, 12);
    ctx.fillStyle = reviveCount > 0 ? 'rgba(255,255,255,0.42)' : 'rgba(255,209,102,0.6)';
    ctx.fillText(reviveCount > 0 ? '已复活 ' + reviveCount + ' 次' : '复活不限次数', b.revive.x, b.revive.y - 9);

    ctx.textAlign = 'center';
    uf(500, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText('点击其他地方 = 直接结算', cx, b.revive.y + b.revive.h + 26);
  } else {
    uf(500, 13);
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fillText('点击任意处继续', cx, b.revive.y + 32);
  }

  ctx.globalAlpha = 1;
}


/* ---------------- 结算页 ----------------
   一局打完要有"收获"的过程，不是一张成绩单：
   0.1s 分数从 0 滚上去 → 1.05s 滚完，纪录印章一枚枚盖下来 →
   1.25s 余光入账，刃条推向下一次强化 → 1.7s 刃阶的刃条往前走，跨阶就报"刃阶提升"。
   时刻和 tickUI 里的音效对齐（OVER_REC_T / OVER_RANK_T）。 */
function overBadges() {
  const out = [];
  if (FB.best0 > 0 && score > FB.best0) out.push({ t: '新纪录', c: '#c9372d' });
  if (layerBestNew && FB.depth0 > 0) out.push({ t: '最深', c: '#2f6f8f' });
  if (FB.combo0 > 0 && bestCombo > FB.combo0) out.push({ t: '连斩纪录', c: '#b4462a' });
  if (contractDone) out.push({ t: '契约达成', c: '#9a6d1c' });
  for (let i = 0; i < unlockNew.length; i++) out.push({ t: '解锁 ' + unlockNew[i].name, c: '#1d7a6a' });
  return out.slice(0, 4);
}

function drawOver() {
  const T = overT;
  ctx.globalAlpha = clamp(T * 4, 0, 1);
  inkBg(0.97);
  ctx.globalAlpha = clamp(T * 4, 0, 1);

  const cx = W_CSS / 2;
  const b = overBtns();
  const short = H_CSS < 720;
  const x = b.doubleUp.x, w = b.doubleUp.w;
  const top = SAFE_TOP + 10, bottom = b.doubleUp.y - 14;
  const badges = overBadges();
  const hScore = short ? 54 : 68;
  const showRank = CFG.fakeRank && FB.best0 > 0 && score > FB.best0;
  const rankRow = showRank && !short ? 20 : 0;     // 矮屏放不下第二行：排名顶替"超过了之前的"那一行
  const need = 26 + (badges.length ? 38 : 0) + hScore + 26 + rankRow + 58 + 66 + 62;
  const gap = clamp((bottom - top - need) / 6, 6, 26);
  let y = top + gap;

  ctx.textAlign = 'center';
  uf(800, 14);
  ctx.fillStyle = '#8fc3e4';
  spaced('帅完收工', cx, y + 15, 8, 'center');
  divider(cx, y + 26, 150, 'rgba(143,195,228,0.3)');
  y += 26 + gap;

  // 纪录印章：一枚枚砸下来，左右歪着
  if (badges.length) {
    uf(900, 13);
    const ws = [];
    let total = -14;
    for (let i = 0; i < badges.length; i++) { ws.push(textW(badges[i].t) + 13 * 1.3); total += ws[i] + 14; }
    let sx = cx - total / 2;
    for (let i = 0; i < badges.length; i++) {
      seal(sx + ws[i] / 2, y + 15, badges[i].t, badges[i].c, (T - OVER_REC_T - i * 0.15) / 0.28, i % 2 ? 0.07 : -0.07, 13);
      sx += ws[i] + 14;
    }
    y += 38;
  }

  // —— 分数：0.9 秒从 0 滚上去；破了纪录，滚完那一下转金色并弹一下 ——
  const rec = FB.best0 > 0 && score > FB.best0;
  const done = T > OVER_REC_T;
  const gold = rec && done;
  uf(900, hScore);
  ctx.save();
  ctx.translate(cx, y + hScore * 0.86);
  const pop = gold ? 1 + 0.14 * (1 - easeOut((T - OVER_REC_T) / 0.3)) : 1;
  ctx.scale(pop, pop);
  glowText(String(Math.round(score * easeOut((T - 0.1) / 0.9))), 0, 0, gold ? UI.gold : '#ffffff', 2.5, gold ? 0.25 : 0.07);
  ctx.restore();
  y += hScore;
  uf(600, 13);
  ctx.fillStyle = gold ? UI.gold : 'rgba(214,236,242,0.42)';
  if (!(showRank && short && done)) ctx.fillText(gold ? '▲ 超过了之前的 ' + FB.best0 : '最高 ' + Math.max(best, FB.best0), cx, y + 18);
  // 破纪录：名次从旧的滚到新的，滚完报"↑ 提升多少名"（数据是假的，见 RANK）
  if (showRank && done) {
    const r0 = RANK.of(FB.best0), r1 = RANK.of(score);
    const kr = easeOut((T - OVER_REC_T - 0.15) / 0.6);
    const line = '全服第 ' + fmtNum(r0.rank + (r1.rank - r0.rank) * kr) + ' 名' +
      (kr >= 1 && r0.rank > r1.rank ? '　↑ ' + fmtNum(r0.rank - r1.rank) : '') + '　强于 ' + Math.floor(r1.pct * 100) + '% 的玩家';
    if (short) {
      // 一行装下：排名 + 行尾一枚小小的"测试数据"
      uf(500, 9);
      const tw = textW('测试数据') + 6;
      uf(800, 12);
      const lw = textW(line);
      ctx.textAlign = 'left';
      ctx.fillStyle = UI.gold;
      ctx.fillText(line, cx - (lw + tw) / 2, y + 18);
      uf(500, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('测试数据', cx - (lw + tw) / 2 + lw + 6, y + 18);
      ctx.textAlign = 'center';
    } else {
      uf(800, 12);
      ctx.fillStyle = UI.gold;
      ctx.fillText(line, cx, y + 38);
      uf(500, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('测试数据', cx, y + 51);
    }
  }
  y += 26 + rankRow + gap;

  // —— 四格战绩：斩杀 / 最高连斩（带段位名）/ 深度 / 存活 ——
  const t = tierOf(bestCombo);
  const cells = [
    { v: String(runKills), l: '斩杀' },
    { v: '×' + bestCombo, l: t >= 0 ? COMBO_TIERS[t].name : '最高连斩', c: t >= 0 ? COMBO_TIERS[t].c : null },
    { v: layer + ' 层', l: layerName(layer), c: layerBestNew && FB.depth0 > 0 ? UI.gold : null },
    { v: Math.floor(gameTime) + ' 秒', l: '存活 +' + surviveGain }
  ];
  const cw = (w - 24) / 4;
  for (let i = 0; i < 4; i++) {
    const k = easeOut((T - 0.3 - i * 0.08) / 0.3);
    if (k <= 0) continue;
    const c = cells[i], x0 = x + i * (cw + 8), y0 = y + (1 - k) * 10;
    ctx.globalAlpha = k * clamp(T * 4, 0, 1);
    bladeBox(x0, y0, cw, 56, { c: 9, top: UI.panelTop, bot: UI.panelBot, border: c.c ? rgba(c.c, 0.5) : UI.line });
    ctx.textAlign = 'center';
    uf(900, 19);
    ctx.fillStyle = c.c || '#ffffff';
    ctx.fillText(c.v, x0 + cw / 2, y0 + 27);
    uf(600, 11);
    ctx.fillStyle = c.c ? rgba(c.c, 0.8) : UI.dim;
    ctx.fillText(c.l, x0 + cw / 2, y0 + 45);
  }
  ctx.globalAlpha = clamp(T * 4, 0, 1);
  y += 58 + gap;

  // —— 余光：本局入账多少 → 推着刃条走向下一次强化 ——
  const echo = echoDoubled ? runEcho * 2 : runEcho;
  const earned = echo + contractReward;
  const ke = easeOut((T - 1.25) / 0.6);
  const before = Math.max(0, meta.pts - earned);
  const held = Math.round(before + (meta.pts - before) * ke);
  const g = nextSkillGoal();
  const ready = g && held >= g.cost;
  bladeBox(x, y, w, 66, { c: 12, top: UI.panelTop, bot: UI.panelBot,
    border: ready ? rgba(UI.gold, 0.55) : (earned > 0 ? rgba(UI.cyan, 0.3) : UI.line), ticks: ready ? rgba(UI.gold, 0.8) : null });
  gem(x + 22, y + 22, 8, UI.cyan);
  ctx.textAlign = 'left';
  uf(900, 18);
  ctx.fillStyle = UI.ice;
  ctx.fillText('余光 +' + Math.round(earned * ke), x + 36, y + 28);
  const src = [];
  if (echo > 0) src.push('晶柱 ' + echo + (echoDoubled ? '（翻倍）' : ''));
  if (contractReward > 0) src.push('契约 ' + contractReward);
  ctx.textAlign = 'right';
  uf(600, 11);
  ctx.fillStyle = UI.faint;
  ctx.fillText(src.length ? src.join(' · ') : '这局没砍到晶柱', x + w - 16, y + 27);
  bar(x + 16, y + 38, w - 32, 5, g ? held / g.cost : 1, ready ? UI.gold : UI.cyan);
  uf(700, 11);
  ctx.textAlign = 'left';
  if (!g) {
    ctx.fillStyle = UI.dim;
    ctx.fillText('强化已全部满级', x + 16, y + 59);
  } else if (ready) {
    ctx.fillStyle = UI.gold;
    ctx.fillText('够了！可以升级 ' + g.sk.name + ' Lv.' + g.lv, x + 16, y + 59);
  } else {
    ctx.fillStyle = UI.dim;
    ctx.fillText(g.sk.name + ' Lv.' + g.lv + ' · 还差 ' + (g.cost - held), x + 16, y + 59);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = UI.ice;
  ctx.fillText('持有 ' + held, x + w - 16, y + 59);
  y += 66 + gap;

  // —— 刃阶：这局的斩杀推着刃条往前走（亮的那一截是这局砍出来的），跨阶就报 ——
  const k0 = FB.kills0, k1 = Math.max(k0, meta.kills);
  const kr = easeOut((T - 1.7) / 0.85);
  const kills = Math.round(k0 + (k1 - k0) * kr);
  const R = rankOf(kills), R0 = rankOf(k0);
  const up = R.i > R0.i;
  const upDone = up && T > OVER_RANK_T;
  bladeBox(x, y, w, 62, { c: 12, top: UI.panelTop, bot: UI.panelBot, border: rgba(R.c, upDone ? 0.75 : 0.28), ticks: upDone ? R.c : null });
  hexPath(x + 22, y + 22, 10, Math.PI / 6);
  ctx.strokeStyle = rgba(R.c, 0.6);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  gem(x + 22, y + 22, 6, R.c);
  ctx.textAlign = 'left';
  uf(900, 17);
  ctx.fillStyle = R.c;
  ctx.fillText(R.name, x + 40, y + 28);
  const rw = textW(R.name);
  uf(600, 11);
  ctx.fillStyle = UI.faint;
  ctx.fillText('刃阶 · 第 ' + (R.i + 1) + ' 阶', x + 48 + rw, y + 27);
  ctx.textAlign = 'right';
  uf(800, 13);
  ctx.fillStyle = UI.ice;
  ctx.fillText('+' + runKills + ' 斩', x + w - 16, y + 27);
  const bx = x + 16, bw = w - 32;
  bar(bx, y + 37, bw, 5, R.p, R.c);
  const p0 = up ? 0 : Math.min(R0.p, R.p);           // 开局前就有的那一截压暗
  if (p0 > 0) {
    slantPath(bx, y + 37, Math.max(10, bw * p0), 5, 5);
    ctx.fillStyle = UI.panel;
    ctx.fill();
    slantPath(bx, y + 37, Math.max(10, bw * p0), 5, 5);
    ctx.fillStyle = rgba(R.c, 0.35);
    ctx.fill();
  }
  uf(700, 11);
  ctx.textAlign = 'left';
  ctx.fillStyle = UI.dim;
  ctx.fillText(R.next ? kills + ' / ' + R.next.at + ' 斩' : kills + ' 斩', bx, y + 57);
  ctx.textAlign = 'right';
  if (upDone) {
    const s = 1 + 0.25 * (1 - easeOut((T - OVER_RANK_T) / 0.3));
    ctx.save();
    ctx.translate(bx + bw, y + 57);
    ctx.scale(s, s);
    uf(900, 12);
    ctx.fillStyle = UI.gold;
    ctx.fillText('刃阶提升 → ' + R.name, 0, 0);
    ctx.restore();
  } else {
    const un = rankUnlock(R.next);
    ctx.fillStyle = un ? UI.gold : 'rgba(191,239,255,0.62)';
    ctx.fillText(R.next ? '下一阶 ' + R.next.name + (un ? ' · 解锁「' + un.name + '」' : '') : '已是最高阶', bx + bw, y + 57);
  }

  // —— 按钮 ——
  ctx.textAlign = 'center';
  if (!echoDoubled && runEcho > 0) {
    drawButton(b.doubleUp, '看广告 · 余光翻倍', {
      kind: 'gold', size: 15, sub: '晶柱余光 +' + runEcho + ' → +' + runEcho * 2, subColor: 'rgba(255,217,143,0.6)'
    });
  } else {
    uf(500, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.fillText(echoDoubled ? '已领取双倍余光' : '这局没有晶柱余光 · 下局记得砍柱子',
      cx, b.doubleUp.y + b.doubleUp.h / 2 + 4);
  }

  drawButton(b.retry, '再 来 一 局', { kind: 'primary', size: 19, weight: 900, glow: UI.cyan });

  const canUp = canUpgrade();
  drawButton(b.skills, '强化', {
    kind: meta.pts > 0 ? 'plain' : 'off', size: 15,
    border: canUp ? '#3fb8c2' : null, color: meta.pts > 0 ? UI.ice : null
  });
  if (canUp) cornerBadge(b.skills, '可升级');

  if (echoAdLeft > 0) drawButton(b.echoAd, '广告 +' + ECHO_AD, { kind: 'gold', size: 14 });
  else drawButton(b.echoAd, '已领取', { kind: 'off', size: 13 });
  drawButton(b.share, '分享', { kind: 'plain', size: 15, color: 'rgba(234,246,248,0.7)' });
  drawButton(b.home, '回到主界面', { kind: 'ghost', size: 13 });
  // 第一次攒够余光：气泡指着「强化」（点进去过一次就不再出现）
  if (canUp && !meta.tipShop && T > OVER_RANK_T) drawCoach(b.skills, '余光在这里用');
  ctx.globalAlpha = 1;
}

function drawAd() {
  inkBg(1);
  const cx = W_CSS / 2, cy = H_CSS / 2;
  ctx.textAlign = 'center';

  if (adMode === 'real') {
    uf(700, 15);
    ctx.fillStyle = 'rgba(234,246,248,0.6)';
    spaced('广告加载中', cx, cy - 8, 4, 'center');
    uf(500, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText('完整观看才会发放奖励', cx, cy + 24);
    return;
  }

  uf(700, 14);
  ctx.fillStyle = 'rgba(234,246,248,0.6)';
  spaced('激励视频播放中', cx, cy - 52, 4, 'center');
  const p = 1 - clamp(adT / 3, 0, 1);
  const w = Math.min(240, W_CSS - 80);
  bar(cx - w / 2, cy - 4, w, 6, p, UI.cyan);
  uf(900, 44);
  ctx.textAlign = 'center';
  glowText(String(Math.ceil(adT)), cx, cy + 60, '#ffffff', 2, 0.1);
  uf(500, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.26)';
  ctx.fillText(IS_MG ? '开发占位（未配置广告位 ID）' : '演示占位 · 按 Enter 立即结束', cx, cy + 98);
}


/* ---------------- 技能页 ---------------- */
let skillReturn = 'ready';

function openSkills() {
  skillReturn = (state === 'over') ? 'over' : 'ready';
  state = 'skills';
  resetInput();
  if (!meta.tipShop) { meta.tipShop = 1; saveMeta(); }
}

function backFromSkills() {
  state = skillReturn;
  if (!meta.tipSkills || meta.refund) { meta.tipSkills = 1; meta.refund = 0; saveMeta(); }   // 看过一次强化页，说明行就换回原来那句
}

function skillLayout() {
  const top = SAFE_TOP + 28;
  const cw = Math.min(350, W_CSS - 32);
  const x = (W_CSS - cw) / 2;
  const gap = 12;
  // 五张卡之后，667px 这类矮屏会顶到底。矮屏把头部收紧、卡片下限放低，
  // 卡内文字同时切成单行排版（见 drawSkills 里的 ch >= 86 分支）。
  const tight = H_CSS < 720;
  const adY = top + (tight ? 72 : 78);   // "看广告换余光"横条
  const listTop = adY + (tight ? 40 : 52);
  const botH = 130;                       // 返回 + 两个小按钮 + 底部安全余量
  const n = SKILLS.length;
  const ch = clamp((H_CSS - listTop - botH - gap * (n - 1)) / n, 64, 108);
  const ys = [];
  let y = listTop;
  for (let i = 0; i < n; i++) { ys.push(y); y += ch + gap; }
  const half = (cw - 10) / 2;
  return {
    x: x, cw: cw, ch: ch, gap: gap, ys: ys,
    ad:    { x: x, y: adY, w: cw, h: tight ? 34 : 40 },
    back:  { x: x, y: y + 2, w: cw, h: 44 },
    reset: { x: x, y: y + 54, w: half, h: 34 },
    clearYing: { x: x + half + 10, y: y + 54, w: half, h: 34 }
  };
}

// 看广告换余光：一局一次
function onEchoAd() {
  if (echoAdLeft <= 0) return;
  startAd('echo');
}

function skillTap(t) {
  const L = skillLayout();
  if (inRect(t, L.back)) { backFromSkills(); return; }
  if (inRect(t, L.reset)) { resetSkills(); return; }
  if (inRect(t, L.clearYing)) { clearYing(); return; }
  if (inRect(t, L.ad)) { onEchoAd(); return; }
  for (let i = 0; i < SKILLS.length; i++) {
    if (inRect(t, { x: L.x, y: L.ys[i], w: L.cw, h: L.ch })) {
      buySkill(SKILLS[i]);
      return;
    }
  }
}
/* ---------------- 技能的画面 ----------------
   技能要"看得见"：光盾挂在主角身上、HUD 左边报盾的状态；剑气的蓄力点挂在连斩数下面；
   强化页每张卡有自己的图标和颜色。 */

// 按宽度挑字号：放不下就一号一号往下缩（最小 9），窄屏上的长说明不会顶进按钮
function fitFont(w, s, txt, maxW) {
  for (let k = s; k >= 9; k--) {
    uf(w, k);
    if (textW(txt) <= maxW) return;
  }
}

function hexPath(x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = rot + (i / 6) * Math.PI * 2;
    if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

// 五个技能的记号：剑 / 回旋箭头 / 六边盾 / 菱形晶 / 一圈圈剑气
function drawSkillIcon(sk, x, y, r, on, fx) {
  const c = on ? sk.c : 'rgba(255,255,255,0.35)';
  hexPath(x, y, r * 1.06, Math.PI / 6);
  ctx.fillStyle = on ? '#0b1418' : '#111419';
  ctx.fill();
  ctx.lineWidth = 1.2 + (fx || 0) * 2;
  ctx.strokeStyle = on ? rgba(sk.c, 0.6 + 0.4 * (fx || 0)) : 'rgba(255,255,255,0.14)';
  ctx.stroke();
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineCap = 'round';
  const k = r * 0.55;
  if (sk.id === 'reach') {
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - k, y + k); ctx.lineTo(x + k, y - k); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - k * 0.75, y + k * 0.15); ctx.lineTo(x - k * 0.15, y + k * 0.75); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, k * 1.25, -Math.PI * 0.95, -Math.PI * 0.05); ctx.stroke();
  } else if (sk.id === 'keep') {
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, k, -Math.PI * 0.3, Math.PI * 1.35); ctx.stroke();
    const a = -Math.PI * 0.3, ex = x + Math.cos(a) * k, ey = y + Math.sin(a) * k;
    ctx.beginPath(); ctx.moveTo(ex + 4, ey - 1); ctx.lineTo(ex - 1, ey - 5); ctx.lineTo(ex - 2, ey + 3); ctx.closePath(); ctx.fill();
  } else if (sk.id === 'shield') {
    hexPath(x, y, k * 1.1, Math.PI / 6);
    ctx.globalAlpha *= 0.3; ctx.fill(); ctx.globalAlpha /= 0.3;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else if (sk.id === 'focus') {
    gem(x, y, k * 1.15, c);
    ctx.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.3)';
    ctx.fillRect(x + k * 0.7, y - k * 0.95, 2, 2);
  } else if (sk.id === 'qi') {
    ctx.beginPath(); ctx.arc(x, y, k * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 2; i++) {
      const rr = k * (0.75 + i * 0.5);
      ctx.beginPath(); ctx.arc(x, y, rr, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, rr, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

// 世界里：光盾是一圈慢慢转的六边形，挂在主角身上；刚长回来时亮一下
function drawShieldBubble() {
  if (state !== 'play' || shield <= 0) return;
  const t = nowMs() / 1000;
  const x = wdx(P.x), y = wdy(P.y), r = P.r * 2.3;
  ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 3) + 0.3 * shieldFx;
  ctx.lineWidth = 1.6 + shieldFx * 2;
  ctx.strokeStyle = '#ffd166';
  hexPath(x, y, r * (1 + shieldFx * 0.3), t * 0.6);
  ctx.stroke();
  ctx.globalAlpha *= 0.4;
  hexPath(x, y, r * 0.86, -t * 0.4);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// HUD 左边、余光下面：光盾的状态（挂着 / 再生倒计时 / 这局碎了）
function drawHudShield(top) {
  if (POW.shieldLv <= 0 && shield <= 0) return;      // 没学光盾：只在拿着复活送的那面时显示
  const on = shield > 0;
  const label = on ? '光盾' : (shieldT > 0 ? '光盾 ' + Math.ceil(shieldT) + 's' : '光盾 已碎');
  uf(800, 12);
  const w = textW(label) + 34, h = 22;
  const s = 1 + shieldFx * 0.25;
  ctx.save();
  ctx.translate(20, top + 136);
  ctx.scale(s, s);
  bladeBox(0, -h / 2, w, h, { c: 6, fill: on ? '#17130a' : '#0e1114', border: on ? rgba(UI.gold, 0.55 + 0.45 * shieldFx) : 'rgba(255,255,255,0.12)', hi: false });
  hexPath(14, 0, 6.5, Math.PI / 6);
  if (on) { ctx.fillStyle = UI.gold; ctx.fill(); }
  else { ctx.strokeStyle = 'rgba(255,209,102,0.4)'; ctx.lineWidth = 1.2; ctx.stroke(); }
  if (!on && shieldT > 0 && POW.shieldRe > 0) {
    ctx.strokeStyle = UI.gold;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(14, 0, 9, -Math.PI / 2, -Math.PI / 2 + (1 - shieldT / POW.shieldRe) * Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = on ? UI.gold : 'rgba(255,255,255,0.4)';
  ctx.fillText(label, 26, 4.5);
  ctx.restore();
}

// 连斩数下面：剑气蓄力点，攒满一排就放一圈
function drawQiPips(cx, y, c) {
  const n = POW.qiEvery;
  if (n <= 0) return;
  const gap = 10, x0 = cx - ((n - 1) * gap) / 2;
  ctx.textAlign = 'right';
  uf(700, 10);
  ctx.fillStyle = rgba(c, 0.6);
  ctx.fillText('剑气', x0 - 9, y + 3.5);
  for (let i = 0; i < n; i++) gem(x0 + i * gap, y, i < qiCharge ? 4.5 : 3, i < qiCharge ? c : 'rgba(255,255,255,0.16)');
}

// 下一颗糖（没糖了就是门）在屏幕外：沿着"主角 → 它"的方向，在屏幕边上画一个箭头（糖粉、门金）。
// 上下躲开 HUD 和斩按钮；新手教学「捡糖」「破门」两步自己会指，这里不重复
function drawTrailArrow() {
  const tg = lightTarget();
  if (!tg || (tutOn() && (tutKey() === 'candy' || tutKey() === 'gate'))) return;
  const p = toScreen(tg.x, tg.y), o = toScreen(P.x, P.y);
  const m = 26, top = hudTop() + 190, bot = H_CSS - SAFE_BOTTOM - 170;
  if (p.x > m && p.x < W_CSS - m && p.y > top && p.y < bot) return;
  const dx = p.x - o.x, dy = p.y - o.y;
  let k = Infinity;
  if (dx > 0) k = Math.min(k, (W_CSS - m - o.x) / dx); else if (dx < 0) k = Math.min(k, (m - o.x) / dx);
  if (dy > 0) k = Math.min(k, (bot - o.y) / dy); else if (dy < 0) k = Math.min(k, (top - o.y) / dy);
  if (!isFinite(k) || k <= 0) return;
  const bob = Math.sin(nowMs() / 160) * 4, ang = Math.atan2(dy, dx);
  drawArrow(o.x + dx * k - Math.cos(ang) * bob, o.y + dy * k - Math.sin(ang) * bob, ang, tg === door ? UI.gold : CANDY_C);
}

/* ---------- 刀诀（2.9 节）：右上契约底下挑过的刀诀小签，三选一界面 ---------- */
// 契约签底下一排小签：一个字 + 几级，奥义金签。整块一张贴图（textSprite），一帧一笔；挑完一张才重画
function drawHudCards(top) {
  if (!cardsOn() || !runPicks.length) return;
  const xr = W_CSS - 20;
  const gy = MENU && MENU.left < xr ? Math.max(top + 26, MENU.bottom + 6) : top + 26;
  const y0 = contract ? gy + 50 : gy + 22;
  const chips = [];
  for (let i = 0; i < CARDS.length; i++) {
    const cd = CARDS[i];
    if (clv(cd.id)) chips.push({ t: cd.ab + clv(cd.id), c: cd.c });
  }
  for (let i = 0; i < ULTS.length; i++) if (ultOn[ULTS[i].id]) chips.push({ t: ULTS[i].name, c: ULTS[i].c, ult: 1 });
  let key = y0 + '|' + xr;
  for (let i = 0; i < chips.length; i++) key += '|' + chips[i].t;
  const rows = Math.ceil(chips.length / 3), bh = rows * 26 + 4;
  const bx = xr - 150, by = y0 - 4, BW = 156;
  const paint = function () {
    // 小签从右往左排，一行三个
    uf(800, 11);
    let x = xr, y = y0 + 10, col = 0;
    for (let i = 0; i < chips.length; i++) {
      const it = chips[i], w = textW(it.t) + 14;
      if (col === 3) { col = 0; x = xr; y += 26; }
      bladeBox(x - w, y - 10, w, 20, { c: 5, fill: it.ult ? '#211808' : '#0b1216', border: rgba(it.c, it.ult ? 0.9 : 0.6), hi: false });
      ctx.textAlign = 'center';
      ctx.fillStyle = it.c;
      ctx.fillText(it.t, x - w / 2, y + 4);
      x -= w + 5; col++;
    }
  };
  const spr = textSprite('cards', key, BW, bh, function () {
    ctx.translate(-bx, -by);
    paint();
  });
  if (spr) ctx.drawImage(spr, bx, by, BW, bh);
  else paint();
  ctx.textAlign = 'left';
}

// 三选一的版面：三张横卡竖着排在屏幕中间（点击和绘制共用）。
// 标题（第一张卡上面 68）要躲开身后压暗的连斩那块 —— 数字、倍率行、剑气珠一直到 hudTop() + 167，
// 不然标题和「+837 倍率」叠成一行；矮屏把卡压扁一点（底下还要留"这一局已有"三行小签）
function pickLayout() {
  const top = hudTop() + 244, gap = 12;
  const w = Math.min(340, W_CSS - 36), h = clamp(Math.floor((H_CSS - SAFE_BOTTOM - top - 2 * gap - 110) / 3), 84, 108);
  const total = h * 3 + gap * 2;
  const y = Math.max(top, (H_CSS - total) / 2 + 10);
  return { x: (W_CSS - w) / 2, w: w, h: h, ys: [y, y + h + gap, y + 2 * (h + gap)] };
}

function drawPick() {
  if (!pick) return;
  const L = pickLayout(), cx = W_CSS / 2, t = pick.t;
  ctx.fillStyle = 'rgba(4,6,9,' + (0.85 * easeOut(t / 0.2)).toFixed(3) + ')';
  ctx.fillRect(0, 0, W_CSS, H_CSS);

  // 标题：破门 —— 挑一张刀诀
  const k0 = easeOut(t / 0.25);
  ctx.globalAlpha = k0;
  ctx.textAlign = 'center';
  uf(800, 12);
  ctx.fillStyle = UI.gold;
  spaced('破 门', cx, L.ys[0] - 58, 3, 'center');
  uf(900, 26);
  outlineText('挑一张刀诀', cx, L.ys[0] - 24, '#ffffff', 4);
  uf(500, 11);
  ctx.fillStyle = 'rgba(214,236,242,0.5)';
  ctx.fillText('只管这一局 · 每斩开一扇门挑一张', cx, L.ys[0] - 6);
  ctx.globalAlpha = 1;

  for (let i = 0; i < pick.opts.length; i++) {
    const cd = pick.opts[i], l = clv(cd.id);
    const ap = easeOut((t - 0.06 * i) / 0.22);          // 一张接一张从右边滑进来
    if (ap <= 0) continue;
    const on = pick.chosen === i, off = pick.chosen >= 0 && !on;
    const x = L.x + (1 - ap) * 40, y = L.ys[i], w = L.w, h = L.h;
    ctx.save();
    ctx.globalAlpha = ap * (off ? 0.3 : 1);
    if (on) {
      const s = 1 + 0.04 * easeOut(pick.ct / 0.1);
      ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s); ctx.translate(-x - w / 2, -y - h / 2);
    }
    bladeBox(x, y, w, h, { c: 14, fill: on ? '#16222a' : '#0b1418', border: rgba(cd.c, on ? 1 : 0.55), lw: on ? 2 : 1.2, ticks: rgba(cd.c, 0.75) });

    // 左边一枚刃框：这张刀诀的一个字
    const ix = x + 14, iy = y + h / 2 - 26;
    bladeBox(ix, iy, 52, 52, { c: 9, fill: rgba(cd.c, 0.12), border: rgba(cd.c, 0.8), hi: false });
    uf(900, 28);
    ctx.textAlign = 'center';
    ctx.fillStyle = cd.c;
    ctx.fillText(cd.ab, ix + 26, iy + 36);

    // 名字 + 三格等级（这次挑的那一格是白的）+ 右上角"新 / 升到 N 级"
    const tx = x + 80, tw = w - 80 - 14;
    ctx.textAlign = 'left';
    uf(900, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cd.name, tx, y + 28);
    const nw = textW(cd.name);
    for (let d = 0; d < 3; d++) {
      slantPath(tx + nw + 10 + d * 15, y + 18, 12, 5, 3);
      ctx.fillStyle = d < l ? cd.c : (d === l ? '#ffffff' : 'rgba(255,255,255,0.13)');
      ctx.fill();
    }
    uf(800, 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = l ? UI.gold : cd.c;
    ctx.fillText(l ? '升到 ' + (l + 1) + ' 级' : '新', x + w - 14, y + 26);

    // 这一级给什么（亮色），一句话说明（暗），能合成奥义的再加一行金字
    ctx.textAlign = 'left';
    fitFont(800, 14, cd.eff[l], tw);
    ctx.fillStyle = cd.c;
    ctx.fillText(cd.eff[l], tx, y + 51);
    fitFont(500, 12, cd.brief, tw);
    ctx.fillStyle = 'rgba(214,240,255,0.6)';
    ctx.fillText(cd.brief, tx, y + 71);
    const u = ultOf(cd);
    if (u && !ultOn[u.id] && h >= 96) {
      const names = u.need.map(function (id) { return CARD_MAP[id].name; }).join(' + ');
      const ut = '奥义「' + u.name + '」：' + names + ' 都满级';
      fitFont(700, 11, ut, tw);
      ctx.fillStyle = rgba(UI.gold, 0.75);
      ctx.fillText(ut, tx, y + 91);
    }
    ctx.restore();
  }

  // 底下：这一局已经有的
  if (runPicks.length) {
    const items = [];
    for (let i = 0; i < CARDS.length; i++) if (clv(CARDS[i].id)) items.push({ t: CARDS[i].name + ' ' + clv(CARDS[i].id), c: CARDS[i].c });
    for (let i = 0; i < ULTS.length; i++) if (ultOn[ULTS[i].id]) items.push({ t: ULTS[i].name, c: ULTS[i].c });
    const yb = L.ys[2] + L.h + 30;
    ctx.globalAlpha = k0;
    uf(600, 11);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(214,236,242,0.45)';
    ctx.fillText('这一局已有', cx, yb);
    for (let r = 0; r * 3 < items.length; r++) chipRow(items.slice(r * 3, r * 3 + 3), cx, yb + 22 + r * 30, 24);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

/* ---------- 开场对话（2.10 节）的画面 ---------- */
// 按字折行（中文没有空格可断）：用当前字体量宽
function wrapCJK(txt, maxW) {
  const out = [], cs = Array.from(txt);
  let line = '';
  for (let i = 0; i < cs.length; i++) {
    if (line && textW(line + cs[i]) > maxW) { out.push(line); line = ''; }
    line += cs[i];
  }
  if (line) out.push(line);
  return out;
}

// 剪影：黑色人形 + 一圈代表色描边，靠道具认人（嘉豪的刀、子涵的伞、全班举手）。
// 按 100 × 130 的格子画（和策划卷里的剪影一样），脚底在 (cx, footY)，高 h
function drawSil(who, cx, footY, h) {
  const T = TALKERS[who], s = h / 130;
  const edge = function () {
    ctx.fillStyle = '#05080c';
    ctx.fill();
    ctx.strokeStyle = T.c;
    ctx.lineWidth = 2.5 / s;
    ctx.stroke();
  };
  ctx.save();
  ctx.translate(cx - 50 * s, footY - 126 * s);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  if (who === 'jiahao') {
    ctx.beginPath();
    ctx.moveTo(70, 92); ctx.lineTo(97, 18);
    ctx.strokeStyle = T.c;
    ctx.lineWidth = 4 / s;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(50, 9); ctx.lineTo(41, 18);
    ctx.bezierCurveTo(35, 22, 32, 28, 32, 35);
    ctx.bezierCurveTo(32, 40, 34, 44, 37, 47);
    ctx.lineTo(29, 60);
    ctx.bezierCurveTo(23, 64, 21, 72, 21, 80);
    ctx.lineTo(21, 126); ctx.lineTo(79, 126); ctx.lineTo(79, 80);
    ctx.bezierCurveTo(79, 72, 77, 64, 71, 60);
    ctx.lineTo(63, 47);
    ctx.bezierCurveTo(66, 44, 68, 40, 68, 35);
    ctx.bezierCurveTo(68, 28, 65, 22, 59, 18);
    ctx.closePath();
    edge();
  } else if (who === 'zihan') {
    ctx.beginPath();
    ctx.moveTo(10, 36); ctx.quadraticCurveTo(50, -4, 90, 36); ctx.closePath();
    edge();
    ctx.beginPath();
    ctx.moveTo(50, 36); ctx.lineTo(50, 80);
    ctx.strokeStyle = T.c;
    ctx.lineWidth = 3 / s;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(30, 126); ctx.lineTo(32, 78);
    ctx.bezierCurveTo(32, 70, 40, 64, 50, 64);
    ctx.bezierCurveTo(60, 64, 68, 70, 68, 78);
    ctx.lineTo(70, 126); ctx.closePath();
    edge();
    ctx.beginPath();
    ctx.arc(50, 52, 11, 0, Math.PI * 2);
    edge();
  } else if (who === 'class') {
    // 全班：五个小人举手欢呼。身子和头一笔，举起来的胳膊一笔
    const hs = [62, 76, 68, 80, 60];
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const x = 10 + i * 20, y = 126 - hs[i];
      ctx.moveTo(x - 8, 126); ctx.lineTo(x - 7, y + 22); ctx.lineTo(x + 7, y + 22); ctx.lineTo(x + 8, 126); ctx.closePath();
      ctx.moveTo(x + 6.5, y + 9); ctx.arc(x, y + 9, 6.5, 0, Math.PI * 2);
    }
    edge();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const x = 10 + i * 20, y = 126 - hs[i];
      ctx.moveTo(x - 6, y + 24); ctx.lineTo(x - 11, y + 2);
      ctx.moveTo(x + 6, y + 24); ctx.lineTo(x + 11, y + 2);
    }
    ctx.strokeStyle = T.c;
    ctx.lineWidth = 2.6 / s;
    ctx.stroke();
  }
  ctx.restore();
}
// 有立绘就贴立绘（脚底对齐、按高度缩放），没有就画剪影
function drawPortrait(who, cx, footY, h) {
  const im = artImg(TALKERS[who].art);
  if (im) {
    const w = h * im.width / im.height;
    ctx.drawImage(im, cx - w / 2, footY - h, w, h);
  } else drawSil(who, cx, footY, h);
}

// 对话：身后是定住的场面压暗。旁白一条墨带压在屏幕中间；有人说话就是"人像 + 底下一个对话框"，
// 换人时人像从自己那边滑进来。字一个一个打出来，打完了右下角一闪一闪的小三角 = 点一下继续
function drawTalk() {
  if (!talk) return;
  const ln = talk.lines[talk.i], who = ln[0], T = TALKERS[who], txt = ln[1];
  const n = talkShown(), done = n >= Array.from(txt).length;
  const blink = done && Math.floor(nowMs() / 450) % 2 === 0;
  const cx = W_CSS / 2;
  ctx.fillStyle = 'rgba(4,6,9,0.62)';
  ctx.fillRect(0, 0, W_CSS, H_CSS);

  if (who === 'nar') {
    const y = H_CSS * 0.42;
    ctx.fillStyle = 'rgba(2,4,6,0.72)';
    ctx.fillRect(0, y - 46, W_CSS, 80);
    ctx.textAlign = 'center';
    uf(700, 11);
    ctx.fillStyle = 'rgba(191,239,255,0.45)';
    spaced('旁 白', cx, y - 26, 3, 'center');
    uf(800, 20);
    const fw = textW(txt);                       // 按整句的宽度定起点：边打字边居中会左右晃
    ctx.textAlign = 'left';
    ctx.fillStyle = UI.ice;
    ctx.fillText(Array.from(txt).slice(0, n).join(''), cx - fw / 2, y + 6);
    if (blink) {
      ctx.beginPath();
      ctx.moveTo(cx - 6, y + 20); ctx.lineTo(cx + 6, y + 20); ctx.lineTo(cx, y + 27); ctx.closePath();
      ctx.fillStyle = 'rgba(191,239,255,0.7)';
      ctx.fill();
    }
  } else {
    const box = { x: 14, y: H_CSS - SAFE_BOTTOM - 156, w: W_CSS - 28, h: 124 };
    const left = T.side === 'L';
    const prev = talk.i > 0 ? talk.lines[talk.i - 1][0] : null;
    const k = prev === who ? 1 : easeOut(talk.t / 0.2);
    const ph = Math.min(320, H_CSS * 0.4);
    ctx.globalAlpha = k;
    drawPortrait(who, (left ? W_CSS * 0.32 : W_CSS * 0.68) + (left ? -1 : 1) * (1 - k) * 40, box.y + 30, ph);
    ctx.globalAlpha = 1;
    bladeBox(box.x, box.y, box.w, box.h, { c: 14, fill: '#0b1418', border: rgba(T.c, 0.6), lw: 1.4, ticks: rgba(T.c, 0.75) });
    tag(left ? box.x + 16 : box.x + box.w - 16, box.y, T.name, T.c, { size: 14, h: 26, pad: 22, align: left ? 'left' : 'right', color: T.c, fill: '#0b1418' });
    uf(700, 17);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    const ls = wrapCJK(txt, box.w - 40);          // 按整句折行：打字时行不会跳
    let rest = n;
    for (let i = 0; i < ls.length && rest > 0; i++) {
      const cs = Array.from(ls[i]);
      ctx.fillText(cs.slice(0, rest).join(''), box.x + 20, box.y + 44 + i * 26);
      rest -= cs.length;
    }
    if (blink) {
      const bx = box.x + box.w - 24, by = box.y + box.h - 22;
      ctx.beginPath();
      ctx.moveTo(bx - 6, by); ctx.lineTo(bx + 6, by); ctx.lineTo(bx, by + 7); ctx.closePath();
      ctx.fillStyle = rgba(T.c, 0.8);
      ctx.fill();
    }
  }
  uf(600, 11);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText((talk.i + 1) + ' / ' + talk.lines.length, 18, H_CSS - SAFE_BOTTOM - 12);
  drawButton(talkSkipBtn(), '跳过 ›', { kind: 'ghost', size: 13 });
  ctx.textAlign = 'left';
}

function drawSkills() {
  inkBg(1);

  const cx = W_CSS / 2;
  const top = SAFE_TOP + 28;
  const now = nowMs();
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);

  ctx.textAlign = 'center';
  uf(900, 24);
  ctx.fillStyle = '#ffffff';
  const tw = spaced('强化', cx, top + 10, 10, 'center');
  ctx.fillStyle = 'rgba(77,247,255,0.4)';
  ctx.fillRect(cx - tw / 2 - 40, top + 1, 28, 1);
  ctx.fillRect(cx + tw / 2 + 12, top + 1, 28, 1);

  // 技能换过版：先报退了多少余光；第一次进来：换成操作说明（金色）；之后换回原来那句
  if (meta.refund > 0) {
    uf(700, 12);
    ctx.fillStyle = UI.gold;
    ctx.fillText('技能重做了 · 已退回 ' + meta.refund + ' 余光，重新挑吧', cx, top + 31);
  } else if (meta.tipSkills) {
    uf(500, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText('每一级，都让你在黑暗里更显眼一点', cx, top + 31);
  } else {
    uf(700, 12);
    ctx.fillStyle = UI.gold;
    ctx.fillText('点亮着的「升级」花余光 · 下一局开局就生效', cx, top + 31);
  }

  // 持有余光：一块刃签，菱形 + "余光" + 数字
  tag(cx, top + 56, '余光  ' + meta.pts, UI.cyan, {
    align: 'center', size: 15, w: 900, h: 26, pad: 26, color: UI.ice, border: rgba(UI.cyan, 0.5),
    icon: function (x, y) { gem(x + 2, y, 7, UI.cyan); }
  });

  const L = skillLayout();

  // 看广告换余光（一局一次）
  if (echoAdLeft > 0) {
    drawButton(L.ad, '看广告　余光 +' + ECHO_AD, { kind: 'gold', size: 14 });
  } else {
    drawButton(L.ad, '本局已领取广告余光', { kind: 'off', size: 12 });
  }

  for (let i = 0; i < SKILLS.length; i++) {
    const sk = SKILLS[i];
    const l = lvOf(sk.id);
    const max = sk.cost.length;
    const c = nextCost(sk);
    const open = skillOpen(sk);
    const can = open && c >= 0 && meta.pts >= c;
    const y = L.ys[i];
    const tall = L.ch >= 86;             // 矮屏的卡片只排两行，否则会挤成一团

    // 锁着的卡整张压暗：一眼看出"还没到那一步"，不用读文字
    ctx.globalAlpha = open ? 1 : 0.5;

    // 买得起的卡：描边慢慢呼吸 —— 不用读价格，亮着的就是能点的
    bladeBox(L.x, y, L.cw, L.ch, {
      c: 14, top: l > 0 ? '#0f1c21' : UI.panelTop, bot: UI.panelBot,
      border: can ? rgba(UI.cyan, 0.35 + 0.4 * pulse) : (l > 0 ? rgba(sk.c, 0.38) : UI.line),
      lw: can ? 1.6 : 1, ticks: l >= max ? rgba(sk.c, 0.7) : null
    });

    // 刚点亮的那一级：卡片边框亮一下，最新那一格弹一下，价格按钮周围荡开两圈
    const fxAge = now - skillFxAt;
    const fx = (sk.id === skillFxId && fxAge < 700) ? 1 - fxAge / 700 : 0;
    if (fx > 0) {
      bladePath(L.x, y, L.cw, L.ch, 14);
      ctx.strokeStyle = rgba(sk.c, 0.8 * fx);
      ctx.lineWidth = 1.2 + 2.2 * fx;
      ctx.stroke();
    }

    // 图标：一个小圆盘里画这一项的记号，学过的亮起来
    drawSkillIcon(sk, L.x + 30, y + L.ch / 2, tall ? 18 : 15, l > 0, fx);

    // 名字 + 三格等级
    const tx = L.x + 58;
    const btnW = 78;
    const textMax = L.cw - (tx - L.x) - btnW - 22;
    ctx.textAlign = 'left';
    uf(800, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sk.name, tx, y + (tall ? 25 : 23));
    const nw = textW(sk.name);
    for (let d = 0; d < max; d++) {
      const pop = (fx > 0 && d === l - 1) ? fx : 0;
      slantPath(tx + nw + 10 + d * 17, y + (tall ? 16 : 14) - pop * 1.5, 14, 5 + pop * 3, 4);
      ctx.fillStyle = d < l ? (pop > 0 ? '#ffffff' : sk.c) : 'rgba(255,255,255,0.13)';
      ctx.fill();
    }

    // 说明：高卡四行（一句话 / 现在 / 下一级），矮卡两行（只报"下一级"或"满级"）
    const nextTxt = !open ? '最深打到第 ' + sk.gate + ' 层解锁（现在第 ' + meta.depthBest + ' 层）'
      : (l >= max ? '已满级' : (l > 0 ? '下一级　' : '学会就有　') + sk.eff[l]);
    if (tall) {
      fitFont(500, 12, sk.brief, textMax);
      ctx.fillStyle = 'rgba(214,240,255,0.55)';
      ctx.fillText(sk.brief, tx, y + 44);
      const nowTxt = l > 0 ? '现在　' + sk.eff[l - 1] : '还没学';
      fitFont(700, 12, nowTxt, textMax);
      ctx.fillStyle = l > 0 ? rgba(sk.c, 0.95) : 'rgba(255,255,255,0.3)';
      ctx.fillText(nowTxt, tx, y + 63);
      fitFont(500, 11, nextTxt, textMax);
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText(nextTxt, tx, y + 80);
    } else {
      const one = l >= max ? '满级　' + sk.eff[max - 1] : nextTxt;
      fitFont(600, 12, one, textMax);
      ctx.fillStyle = l > 0 ? rgba(sk.c, 0.9) : 'rgba(255,255,255,0.42)';
      ctx.fillText(one, tx, y + L.ch - 14);
    }

    // 价格按钮：买得起 = 亮青底 + "升级"；买不起 = 价格 + 一条"攒到哪了"的细进度
    const bw = btnW, bh = 40;
    const bx = L.x + L.cw - bw - 12;
    const by = y + L.ch / 2 - bh / 2;
    if (fx > 0) {
      for (let r = 0; r < 2; r++) {
        const k = clamp((1 - fx) * 1.4 - r * 0.25, 0, 1);
        if (k <= 0 || k >= 1) continue;
        bladePath(bx - k * 16, by - k * 16, bw + k * 32, bh + k * 32, 9 + k * 10);
        ctx.strokeStyle = rgba(sk.c, 0.6 * (1 - k));
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    bladeBox(bx, by, bw, bh, {
      c: 9, top: fx > 0 ? '#1a4c53' : (can ? '#155058' : '#121a1f'), bot: fx > 0 ? '#12363b' : (can ? '#0b262a' : '#0a0f12'),
      border: fx > 0 ? '#9ff8ff' : (can ? rgba(UI.cyan, 0.6 + 0.4 * pulse) : 'rgba(255,255,255,0.1)'),
      lw: fx > 0 || can ? 1.6 : 1
    });

    ctx.textAlign = 'center';
    if (!open) {
      uf(700, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('第 ' + sk.gate + ' 层', bx + bw / 2, by + 17);
      uf(600, 11);
      ctx.fillText('解锁', bx + bw / 2, by + 32);
    } else if (fx > 0) {
      uf(900, 15);
      ctx.fillStyle = '#eafcff';
      ctx.fillText('Lv.' + l + ' ✓', bx + bw / 2, by + bh / 2 + 5);
    } else if (c < 0) {
      uf(700, 13);
      ctx.fillStyle = rgba(sk.c, 0.7);
      ctx.fillText('满级', bx + bw / 2, by + bh / 2 + 5);
    } else if (can) {
      uf(900, 14);
      ctx.fillStyle = '#eafcff';
      ctx.fillText('升级', bx + bw / 2, by + 18);
      uf(600, 11);
      ctx.fillStyle = 'rgba(191,246,255,0.7)';
      ctx.fillText(c + ' 余光', bx + bw / 2, by + 32);
    } else {
      uf(700, 13);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(c + ' 余光', bx + bw / 2, by + 20);
      bar(bx + 12, by + 28, bw - 24, 3, meta.pts / c, 'rgba(77,247,255,0.6)');
    }

    if (can && fx <= 0) cornerBadge({ x: L.x, y: y, w: L.cw - 8, h: L.ch }, '可升级');

    ctx.globalAlpha = 1;
  }

  drawButton(L.back, '返 回', { kind: 'plain', size: 16 });
  drawButton(L.reset, '重置技能', { kind: 'ghost', size: 12 });

  // 测试用：清空余光。待确认时整颗按钮变红并倒数，避免误触
  if (clearYingArmed()) {
    const left = Math.max(0, CLEAR_YING_ARM - (nowMs() - clearYingAt)) / 1000;
    bladeBox(L.clearYing.x, L.clearYing.y, L.clearYing.w, L.clearYing.h, {
      c: 9, fill: '#3c0e10', border: 'rgba(255,96,96,0.85)', lw: 1.6 });
    ctx.textAlign = 'center';
    uf(700, 12);
    ctx.fillStyle = '#ffb0b0';
    ctx.fillText('再点确认 ' + left.toFixed(1) + 's', L.clearYing.x + L.clearYing.w / 2,
      L.clearYing.y + L.clearYing.h / 2 + 4);
  } else {
    drawButton(L.clearYing, '清空余光 · 教程', { kind: 'danger', size: 12 });
  }
}


/* =========================================================
   14. 渲染
   ========================================================= */
function render() {
  FR.d = 0; FR.n = ''; FR.tx = 0; FR.bg = 0;   // 这一帧的（上一帧的已经在 testSample 里记过了）
  txDefer = false;
  txFlush();                     // 上一帧排着要重画的贴图，趁这一帧还没画东西先画（见 textSprite）
  txDefer = state === 'play';
  // 防御：部分安卓机的微信 Canvas shadowBlur=0 关不掉阴影，
  // 每帧开头强制清一次，绝不让阴影泄漏到任何图形上。
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 这两个界面是全屏的，不用画世界，省一半绘制开销
  if (state === 'skills' || state === 'ad' || state === 'guide' || state === 'data' || state === 'shop' || state === 'propPick' || state === 'box' || state === 'preAd' || state === 'rankView') {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (state === 'skills') drawSkills(); else if (state === 'guide') drawGuide(); else if (state === 'data') drawData(); else if (state === 'shop') drawShop();
    else if (state === 'box') drawBox();
    else if (state === 'preAd') drawPreAd();
    else if (state === 'rankView') drawRankView();
    else if (state === 'propPick') drawPropPick(); else drawAd();
    return;
  }
  // 横屏跑酷（2.17 节）：自己一套画法，屏幕坐标
  if (laneMode || (CFG.mainMode === 'lane' && (state === 'ready' || state === 'talk'))) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawLane();
    return;
  }

  // 世界层：DPR × 世界缩放
  const k = DPR * SC;
  ctx.setTransform(k, 0, 0, k, 0, 0);

  // 相机：屏幕中心对准 cam。世界比屏幕大，玩家不再被钉在画面正中。
  // shake 叠在相机偏移之上，震屏方向不受镜头位置影响。
  ctx.save();
  const shx = shake > 0.3 ? rand(-shake, shake) * 0.45 : 0;
  const shy = shake > 0.3 ? rand(-shake, shake) * 0.45 : 0;
  ctx.translate(W / 2 - cam.x + shx, H / 2 - cam.y + shy);

  ptOn = state === 'play'; ptAt = ptFnAt = nowMs();   // 帧体检计时（ptLap 分段，ptFn 逐项）
  drawBackground();                       ptFn('背景');
  ptLap('bg');
  drawLightPool();  ptFn('脚下光');       // 脚下的光，跟着段位换色
  drawFeats();      ptFn('本层特性');     // 本层特性：雾团亮边、地缝预警 / 喷发、光核、潮流线
  ptLap('feat');
  drawStains();     ptFn('墨渍');
  drawCrystals();   ptFn('晶柱');         // 晶柱是地面家具，压在敌人下面
  drawCandies();    ptFn('糖');           // 糖和门也是地上的东西
  drawDoor();       ptFn('门');
  if (hordeMode) { drawHCandy(); ptFn('嘉欣糖'); drawHItem(); ptFn('道具'); drawTeachers(); ptFn('班主任'); }   // 2.13 节；班主任压在怪下面
  if (hordeMode) { drawHorde(); ptFn('黑潮'); }   // 黑潮（2.12 节）：最前面两排的怪
  drawEnemies();    ptFn('敌人');
  if (hordeMode) { drawHordeInk(); ptFn('墨潮'); }   // 墨潮盖在黑潮前排和挡路的怪上面：掉进墨里的都看不见
  drawCuts();       ptFn('斩线');         // 斩线压在怪身上
  drawArmorBits();  ptFn('碎甲');         // 碎甲片要压在本体之上，才像"从它身上崩下来的"
  drawBlasts();     ptFn('爆炸');         // 引信必须盖在敌人之上：它是"快跑"的信号
  drawShards();     ptFn('晶片');
  drawRings();      ptFn('光环');
  drawCards();      ptFn('刀诀');         // 电光、刀痕、飞刃、唱片
  drawAimMark();    ptFn('下一刀');       // 按住斩：下一刀去哪
  if (hordeMode) drawHordeAim();           // 黑潮试玩：点「斩」会砍谁
  drawFX();         ptFn('飘字');         // drawFX 里先记一笔「粒子」，这里剩下的是飘字
  drawEmbers();     ptFn('火星');         // 火星也压在人下面
  drawDashTrail();  ptFn('刀光');         // 刀光压在人下面
  drawTurns();      ptFn('转身');
  drawLightRing();  ptFn('光圈');         // 光：一圈，越少越往里缩
  if (hordeMode) { drawHRange(); drawPropFx(); ptFn('道具效果'); }   // 斩击范围（黑板尺扩一倍）、道具倒计时、鬼火（2.13 节）
  drawPlayer();     ptFn('主角');
  drawMomPips();    ptFn('势头');
  drawShieldBubble(); ptFn('光盾');
  ptLap('world');
  drawDarkness();   ptFn('暗场');         // 盖掉视野之外的一切
  drawCallouts();   ptFn('头顶大字');     // 头顶大字不能被暗场压住
  drawReachRing();  ptFn('斩杀圈');       // 暗红虚线：刀能够到哪
  drawWaveWarn();   ptFn('合围预警');     // 合围预警要盖在暗场之上
  drawRemote();     ptFn('圈外红点');     // 但光外的东西还看得见一点点
  ctx.restore();
  ptLap('top');

  // UI 层：只用 DPR，不跟世界缩放
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  if (state === 'ready')      drawReady();
  else if (state === 'dead')  { if (hordeMode) drawHordeDead(); else drawDead(); }
  else if (state === 'over')  drawOver();
  else if (state === 'play' || state === 'pause' || state === 'pick') { if (hordeMode) drawHordeUI(); else drawUI(); }
  else if (state === 'talk')  drawTalk();
  if (state === 'play' || state === 'dead' || state === 'pause' || state === 'pick') drawMono();   // 无光：整屏去色（压在 HUD 上，"整个游戏"都褪成黑白）
  if (state === 'pause') drawPause();
  else if (state === 'pick') drawPick();
  ptFn('去色');
  ptLap('ui');
  ptOn = false;
}


/* =========================================================
   14.9 测试数据（CFG.testPanel）
   ---------------------------------------------------------
   给试玩用：每局结束记一条（最近 10 局），连同机型、报错一起存在本地。
   主界面左下角「测试数据」进来：截图，或者点「复制」把整段文字贴到群里（比截图全，数字也看得清）。
   一局记：分数 / 层 / 存活 / 斩杀 / 连斩 / 复活、每次死在谁手上、平均帧数 / 卡顿、每一层各自的帧数和卡顿、
   每帧时间花在哪（PT）、振动开没开。正式发布前把 CFG.testPanel 关掉：入口没了，也不再记
   ========================================================= */
const TEST_KEY = 'dash_test_v1';
const TEST = { runs: [], errs: [], god: false, bench: null, ads: {}, talk: {} };
try {
  const raw = JSON.parse(Store.get(TEST_KEY, '{}'));
  if (Array.isArray(raw.runs)) TEST.runs = raw.runs.slice(0, 10);
  if (Array.isArray(raw.errs)) TEST.errs = raw.errs.slice(0, 8);
  TEST.god = !!raw.god;
  if (raw.bench && Array.isArray(raw.bench.items)) TEST.bench = raw.bench;
  if (raw.ads && typeof raw.ads === 'object') TEST.ads = raw.ads;
  if (raw.talk && typeof raw.talk === 'object') TEST.talk = raw.talk;
} catch (e) {}
function testSave() { Store.set(TEST_KEY, JSON.stringify(TEST)); }

let runDeaths = [];          // 这一局每次死：[死因, 第几层, 第几秒]（复活了再死就有好几条）
let runTut = false;          // 这一局是不是教学局
let runGod = false;          // 这一局开没开测试无敌
let runLv = {}, runDash0 = 0, runDashAuto = 0, runMemWarn = 0;   // 开局带的技能 / 冲刺计数起点 / 其中按住自动接的 / 内存告警

// 开局（start）：清零这一局的采样
function testRunStart() {
  PERF.hist = [0, 0, 0, 0, 0, 0];          // 帧间隔分布：≤18 / ≤25 / ≤34 / ≤50 / ≤100 / 更长（毫秒）
  PERF.seg = []; PERF.segF = 0; PERF.segT = 0;   // 每 10 秒一个平均帧数：看是不是越玩越卡（发热降频）
  PERF.cnt = { e: [0, 0], p: [0, 0], s: [0, 0] };   // 同屏 怪 / 粒子 / 墨渍：[累计, 最多]
  PERF.big = [];                           // 最卡的 3 帧，连同当时的场面
  PERF.drag = 0;                           // 拖着移动的帧数
  PERF.ops = [0, 0]; PERF.bake = 0; OPS = 0;   // 每帧画几笔 [累计, 最多]；局里重画了几次贴图
  PERF.ink = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];   // 黑潮在屏幕里 / 不在：[帧数, 毫秒, 卡顿, 画面 JS 毫秒, 声音 JS 毫秒]
  PERF.inkPt = PT.bg + PT.feat + PT.world + PT.top + PT.ui; PERF.inkSnd = PT.snd;
  runLv = JSON.parse(JSON.stringify(meta.lv || {}));
  runDash0 = dashSeq; runDashAuto = 0; runMemWarn = 0;
}
// 局内每帧（frameStep 里，gap = 这一帧和上一帧隔了多少毫秒）
function testSample(gap) {
  const H = PERF.hist;
  if (PERF.ops) { PERF.ops[0] += OPS; if (OPS > PERF.ops[1]) PERF.ops[1] = OPS; }
  OPS = 0;
  H[gap <= 18 ? 0 : gap <= 25 ? 1 : gap <= 34 ? 2 : gap <= 50 ? 3 : gap <= 100 ? 4 : 5]++;
  PERF.segF++; PERF.segT += gap;
  if (PERF.segT >= 10000) {
    if (PERF.seg.length < 40) PERF.seg.push(Math.round(PERF.segF * 1000 / PERF.segT));
    PERF.segF = 0; PERF.segT = 0;
  }
  const C = PERF.cnt, n = [enemies.length + horde.length, parts.length, stains.length], k = ['e', 'p', 's'];   // 黑潮试玩：黑潮里的也算怪
  for (let i = 0; i < 3; i++) { C[k[i]][0] += n[i]; if (n[i] > C[k[i]][1]) C[k[i]][1] = n[i]; }
  if (touchId !== null) PERF.drag++;
  const B = PERF.big;
  if (gap > 40 && (B.length < 3 || gap > B[B.length - 1][0])) {
    B.push([Math.round(gap), layer, Math.floor(gameTime), n[0], n[1], n[2], FR.n, Math.round(FR.d), FR.tx, FR.bg]);   // 后四项：上一帧最慢的一项、它几毫秒、现做了几张贴图 / 几块地面
    B.sort(function (a, b) { return b[0] - a[0]; });
    if (B.length > 3) B.length = 3;
  }
}
// 广告：各个广告点累计 [点了, 看完, 没看成]（不分局，给广告方案用）
function testAd(action, what) {
  if (!action) return;
  const a = TEST.ads[action] || (TEST.ads[action] = [0, 0, 0]);
  a[what]++;
  testSave();
}
// 对话（开场）：每段累计 [打开, 跳过, 看完, 跳过时第几句（累加，除以跳过次数 = 平均第几句跳的）]，不分局
function testTalk(key, what, line) {
  if (!CFG.testPanel) return;
  const a = TEST.talk[key] || (TEST.talk[key] = [0, 0, 0, 0]);
  a[what]++;
  if (what === 1) a[3] += line + 1;
  testSave();
}
if (IS_MG && typeof MG.onMemoryWarning === 'function') {
  try { MG.onMemoryWarning(function () { runMemWarn++; }); } catch (e) {}
}

/* ---------- 测试无敌（测试数据页开关）----------
   开着时怎么撞都不死，左上角多一个「跳层 ›」：点一下直接破门进下一层 —— 几分钟就能把每一层的帧数都测一遍。
   开着无敌打的局在测试数据里标"无敌"，别和正常局混着比 */
function testGod() { return CFG.testPanel && TEST.god; }
function godSkipBtn() { return { x: 12, y: hudTop() + 160, w: 76, h: 32 }; }
function drawGodHud() {
  const b = godSkipBtn();
  drawButton(b, '跳层 ›', { kind: 'plain', size: 14, weight: 800, color: UI.ice });
  ctx.textAlign = 'left';
  uf(700, 10);
  ctx.fillStyle = 'rgba(255,209,102,0.8)';
  ctx.fillText('测试无敌中', b.x + 2, b.y + b.h + 14);
}
const FOE_NAME = { grunt: '杂兵', bomb: '爆裂者', heavy: '重型', charger: '冲锋者', watch: '守望者' };

// 报错：同一句只记一条、数次数，带上是在哪一步、哪个界面、第几层出的
function logErr(e, where) {
  try {
    const msg = String((e && (e.message || e.errMsg)) || e).slice(0, 120);
    for (let i = 0; i < TEST.errs.length; i++) {
      if (TEST.errs[i].msg === msg) { TEST.errs[i].n++; TEST.errs[i].t = Date.now(); testSave(); return; }
    }
    const at = String((e && e.stack) || '').split('\n').slice(1, 3)
      .map(function (x) { return x.trim().replace(/^at /, ''); }).join(' ← ').slice(0, 160);
    TEST.errs.unshift({ msg: msg, at: at, where: where + ' · ' + state + ' · 第 ' + layer + ' 层', v: BUILD_TAG, t: Date.now(), n: 1 });
    if (TEST.errs.length > 8) TEST.errs.length = 8;
    testSave();
  } catch (x) {}
}
// 平台的全局报错（触摸回调、异步里的错也接得到）
if (IS_MG && typeof MG.onError === 'function') {
  try { MG.onError(function (e) { logErr(e, '全局'); }); } catch (e) {}
}

// 一局结束（finishRun）记一条
function testRecord() {
  if (!CFG.testPanel) return;
  const f = Math.max(1, PERF.frames), ms = function (v) { return Math.round(v / f * 10) / 10; };
  const lay = [];
  for (const n in PERF.lay) {
    const L = PERF.lay[n];
    if (L.f > 10) lay.push([+n, Math.round(L.t / 1000), Math.round(L.f * 1000 / L.t), L.n]);
  }
  TEST.runs.unshift({
    t: Date.now(), v: BUILD_TAG, tut: runTut ? 1 : 0, god: runGod ? 1 : 0,
    s: score, sec: Math.floor(gameTime), layer: layer, kills: runKills, combo: bestCombo, rev: reviveCount,
    die: runDeaths.slice(0, 6),
    fps: PERF.t > 0 ? Math.round(PERF.frames * 1000 / PERF.t) : 0, lag: PERF.n, worst: Math.round(PERF.worst),
    lay: lay,
    ms: [ms(PT.logic), ms(PT.snd), ms(PT.bg), ms(PT.feat), ms(PT.world), ms(PT.top), ms(PT.ui)],
    top: Object.keys(PTF).map(function (k) { return [k, Math.round(PTF[k] / f * 100) / 100]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10),
    layTop: Object.keys(PERF.lay).map(function (n) {
      const L = PERF.lay[n], m = PTFL[n] || {};
      return [+n, Object.keys(m).map(function (k) { return [k, Math.round(m[k] / Math.max(1, L.f) * 10) / 10]; })
        .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3)];
    }),
    hist: PERF.hist.map(function (x) { return Math.round(x * 1000 / f) / 10; }),
    seg: PERF.seg.slice(),
    cnt: [Math.round(PERF.cnt.e[0] / f), PERF.cnt.e[1], Math.round(PERF.cnt.p[0] / f), PERF.cnt.p[1], Math.round(PERF.cnt.s[0] / f), PERF.cnt.s[1]],
    big: PERF.big.slice(),
    dash: dashSeq - runDash0, auto: runDashAuto, drag: Math.round(PERF.drag * 100 / f),
    lv: runLv, ct: contract ? [contract.short, contractDone ? 1 : 0] : null,
    cards: runPicks.slice(), ults: Object.keys(ultOn), candy: runCandy,
    ying: runEcho + contractReward, pts: meta.pts, mem: runMemWarn,
    ops: PERF.ops ? [Math.round(PERF.ops[0] / f), PERF.ops[1], Math.round((PERF.bake || 0) * 10 / Math.max(1, gameTime)) / 10] : null,   // 每帧画几笔 平均 / 最多，贴图每秒重画几次
    vib: meta.vib ? 1 : 0,
    ink: hordeMode && PERF.ink ? PERF.ink.map(function (I) {   // 黑潮在屏幕里 / 不在：[秒, 帧/秒, 卡顿, 画面 JS 毫秒/帧, 声音 JS 毫秒/帧]
      const f1 = Math.max(1, I[0]);
      return [Math.round(I[1] / 1000), I[1] > 0 ? Math.round(I[0] * 1000 / I[1]) : 0, I[2], Math.round(I[3] / f1 * 10) / 10, Math.round(I[4] / f1 * 100) / 100];
    }) : null,
    inkTop: hordeMode && PERF.ink ? PTFI.map(function (m, i) {   // 黑潮在屏幕里 / 不在：各自最慢的 5 项（ms/帧）
      const f1 = Math.max(1, PERF.ink[i][0]);
      return Object.keys(m).map(function (k) { return [k, Math.round(m[k] / f1 * 100) / 100]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
    }) : null,
    hd: hordeMode ? [Math.floor(hTop / HD.m), hWave, hBestBurst, hCandyRun, hPropUsed, heroSkin().id] : null   // 黑潮：[逃了几米, 到第几波, 一次连斩最多几只, 捡了几颗糖, 用了几个道具, 穿的皮肤]
  });
  if (TEST.runs.length > 10) TEST.runs.length = 10;
  testSave();
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtWhen(t) {
  const d = new Date(t);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// 机型：平台给什么就记什么（抖音 / 微信字段不全一样，没有的跳过）
function testDevice() {
  let s = {};
  try { if (IS_MG && typeof MG.getSystemInfoSync === 'function') s = MG.getSystemInfoSync() || {}; } catch (e) {}
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const a = [[s.brand, s.model].filter(Boolean).join(' ') || ua.slice(0, 40) || '未知机型'];
  if (s.system) a.push(s.system);
  if (s.appName || s.version) a.push([s.appName, s.version].filter(Boolean).join(' '));
  if (s.SDKVersion) a.push('基础库 ' + s.SDKVersion);
  const b = ['屏幕 ' + Math.round(W_CSS) + '×' + Math.round(H_CSS),
             '像素比 ' + ((s.pixelRatio || DPR) + '').slice(0, 4) + '（画布按 ' + DPR + '）', '缩放 ' + SC.toFixed(2)];
  if (s.deviceScore && s.deviceScore.overall) b.push('跑分 ' + s.deviceScore.overall);
  if (s.benchmarkLevel !== undefined) b.push('性能档 ' + s.benchmarkLevel);
  b.push('振动 ' + (meta.vib ? '开' : '关'));
  const c = [];
  try {
    if (IS_MG && typeof MG.getBatteryInfoSync === 'function') {
      const bt = MG.getBatteryInfoSync() || {};
      if (bt.level !== undefined) c.push('电量 ' + bt.level + '%' + (bt.isCharging ? '（充电中）' : ''));
    }
  } catch (e) {}
  c.push(audioStatus() + (AUD.err ? ' · 最后一条：' + AUD.msg : ''));
  return [a.join(' · '), b.join(' · '), c.join(' · ')];
}
function dieText(d) {
  return d && d.length ? d.map(function (x) {
    return x[0] + '（第' + x[1] + '层 ' + x[2] + '秒' + (x[3] !== undefined ? ' · 收刀后 ' + x[3] + 'ms' : '') +
      (x[4] >= 0 ? ' · 它亮着 ' + (x[4] / 1000).toFixed(1) + ' 秒' : '') + '）';
  }).join(' → ') : '—';
}
// 冤死：收刀 0.3 秒内被撞、撞你的那只亮出来还不到 0.4 秒 —— 玩家基本没机会反应
function unfairDeaths(d) {
  let n = 0, all = 0;
  for (let i = 0; i < (d || []).length; i++) {
    if (d[i][4] === undefined || d[i][4] < 0) continue;
    all++;
    if (d[i][3] <= 300 && d[i][4] <= 400) n++;
  }
  return [n, all];
}
// 整份报告：画在测试数据页上，「复制」也是这一份
function testReport() {
  const out = ['【黑皮爱嘉欣 测试数据】v' + BUILD_TAG + ' · ' + fmtWhen(Date.now())];
  out.push('【手机】');
  testDevice().forEach(function (x) { out.push(x); });
  // 排行榜（0.5 节 RK）：真机上拉不起来 / 名次不出来时看这一行
  out.push('【排行榜】交成绩 ' + (rkCan() ? '有' : '没有') + ' · 平台榜单 ' + (rkCanOpen() ? '有' : '没有') + ' · 开放数据域 ' + (rkODC() ? '有' : '没有') +
    ' · 登录 ' + ({ 0: '没登', 1: '登录中', 2: '登上了', '-1': '没登上' })[rkLogin] + ' · 交上去 ' + meta.rk.m + ' 米 / ' + meta.rk.s + ' 分' + (rkErr ? ' · 出错：' + rkErr : ''));
  const r = TEST.runs[0];
  if (!r) out.push('【最近一局】还没打完过一局');
  else {
    out.push('【最近一局】' + fmtWhen(r.t) + ' · v' + r.v + (r.hd ? ' · 黑潮试玩 逃了 ' + r.hd[0] + ' 米（第 ' + r.hd[1] + ' 波 · 一次连斩最多 ' + r.hd[2] + ' 只' + (r.hd.length > 3 ? ' · 糖 ' + r.hd[3] + ' · 道具 ' + r.hd[4] : '') + (r.hd[5] && HERO_SKIN[r.hd[5]] ? ' · ' + HERO_SKIN[r.hd[5]].name : '') + '）' : '') +
      (r.tut ? ' · 教学局' : '') + (r.god ? ' · 无敌测试' : '') + (r.vib ? '' : ' · 振动关'));
    out.push('第 ' + r.layer + ' 层 · 活 ' + r.sec + ' 秒 · ' + r.s + ' 分 · 斩 ' + r.kills + ' · 最高连斩 ×' + r.combo + ' · 复活 ' + r.rev + ' 次' + (r.candy !== undefined && !r.hd ? ' · 糖 ' + r.candy + ' 颗' : ''));   // 黑潮的糖在上一行（正式玩法的糖路这里老是 0，看着像没记上）
    out.push('死因：' + dieText(r.die));
    const uf2 = unfairDeaths(r.die);
    if (uf2[1]) out.push('冤死（收刀 0.3 秒内被撞、它亮出来不到 0.4 秒）：' + uf2[0] + ' / ' + uf2[1] + ' 次撞死');
    out.push('帧数 ' + r.fps + '/秒 · 卡顿 ' + r.lag + ' 次 · 最长 ' + r.worst + 'ms');
    if (r.ink) out.push('黑潮在屏幕里 ' + r.ink[0][0] + ' 秒：' + r.ink[0][1] + ' 帧/秒 · 卡顿 ' + r.ink[0][2] + ' · 画面 ' + r.ink[0][3] + 'ms · 声音 ' + r.ink[0][4] + 'ms ｜ 不在 ' +
      r.ink[1][0] + ' 秒：' + r.ink[1][1] + ' 帧/秒 · 卡顿 ' + r.ink[1][2] + ' · 画面 ' + r.ink[1][3] + 'ms · 声音 ' + r.ink[1][4] + 'ms');
    if (r.inkTop) out.push('黑潮在屏幕里最慢：' + r.inkTop[0].map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ') + ' ｜ 不在：' + r.inkTop[1].map(function (x) { return x[0] + ' ' + x[1]; }).join(' · '));
    if (r.ops) out.push('每帧画几笔 平均 ' + r.ops[0] + ' · 最多 ' + r.ops[1] + ' · 贴图重画 ' + r.ops[2] + ' 次/秒');
    if (r.lay.length) out.push('各层 帧数/卡顿：' + r.lay.map(function (x) { return x[0] + '层 ' + x[2] + '/' + x[3]; }).join(' · '));
    const m = r.ms;
    out.push('每帧ms：逻辑 ' + m[0] + '（声音振动 ' + m[1] + '）· 背景 ' + m[2] + ' · 特性 ' + m[3] + ' · 物体 ' + m[4] + ' · 盖层 ' + m[5] + ' · 界面 ' + m[6]);
    if (r.top && r.top.length) out.push('最慢的几项（ms/帧）：' + r.top.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · '));
    if (r.layTop && r.layTop.length) out.push('各层最慢：' + r.layTop.map(function (x) {
      return x[0] + '层 ' + x[1].map(function (y) { return y[0] + y[1]; }).join(' ');
    }).join(' ｜ '));
    if (r.hist) out.push('帧间隔：≤18ms ' + r.hist[0] + '% · ≤25 ' + r.hist[1] + '% · ≤34 ' + r.hist[2] + '% · ≤50 ' + r.hist[3] + '% · ≤100 ' + r.hist[4] + '% · 更长 ' + r.hist[5] + '%');
    if (r.seg && r.seg.length) out.push('每10秒帧数：' + r.seg.join(' '));
    if (r.big && r.big.length) out.push('最卡的几帧：' + r.big.map(function (b) {
      return b[0] + 'ms（第' + b[1] + '层 ' + b[2] + '秒 · 怪' + b[3] + ' 粒子' + b[4] + ' 墨渍' + b[5] +
        (b.length > 6 && b[6] ? ' · 最慢 ' + b[6] + ' ' + b[7] + 'ms' + (b[8] ? ' · 现做贴图 ' + b[8] : '') + (b[9] ? ' · 地面块 ' + b[9] : '') : '') + '）';
    }).join(' · '));
    if (r.cnt) out.push('同屏 平均/最多：怪 ' + r.cnt[0] + '/' + r.cnt[1] + ' · 粒子 ' + r.cnt[2] + '/' + r.cnt[3] + ' · 墨渍 ' + r.cnt[4] + '/' + r.cnt[5]);
    if (r.dash !== undefined) out.push('操作：冲刺 ' + r.dash + ' 次（按住自动接 ' + (r.dash ? Math.round(r.auto * 100 / r.dash) : 0) + '%）· 拖着移动 ' + r.drag + '% 的时间');
    if (r.lv) {
      const lv = SKILLS.filter(function (k) { return r.lv[k.id] > 0; }).map(function (k) { return k.name + r.lv[k.id]; });
      out.push('技能：' + (lv.length ? lv.join(' ') : '无') + ' · 契约 ' + (r.ct ? r.ct[0] + (r.ct[1] ? '（达成）' : '（没达成）') : '—') +
        ' · 余光 +' + r.ying + '（持有 ' + r.pts + '）' + (r.mem ? ' · 内存告警 ' + r.mem + ' 次' : ''));
    }
    if (r.cards) out.push('刀诀（挑的顺序 · 第几秒）：' + (r.cards.length ? r.cards.map(function (c) {
      return (CARD_MAP[c[0]] ? CARD_MAP[c[0]].name : c[0]) + c[1] + '@' + c[2];
    }).join(' ') : '一张没挑') + (r.ults && r.ults.length ? ' · 奥义 ' + r.ults.map(function (u) {
      for (let i = 0; i < ULTS.length; i++) if (ULTS[i].id === u) return ULTS[i].name;
      return u;
    }).join(' ') : ''));
  }
  if (TEST.runs.length > 1) {
    out.push('【前几局】时间 · 层 · 秒 · 分 · 帧/卡顿 · 最后死因');
    for (let i = 1; i < TEST.runs.length; i++) {
      const q = TEST.runs[i], last = q.die && q.die.length ? q.die[q.die.length - 1][0] : '—';
      out.push(fmtWhen(q.t) + ' · ' + q.layer + '层 · ' + q.sec + '秒 · ' + q.s + ' · ' + q.fps + '帧/' + q.lag + ' · ' + last + (q.hd ? ' · 黑潮 ' + q.hd[0] + '米' : '') + (q.tut ? ' · 教学' : '') + (q.god ? ' · 无敌' : ''));
    }
  }
  const AN = { revive: '复活', double: '余光翻倍', echo: '看广告余光' }, ak = Object.keys(TEST.ads);
  if (ak.length) out.push('【广告】累计 点了/看完/没看成：' + ak.map(function (k) { const a = TEST.ads[k]; return (AN[k] || k) + ' ' + a[0] + '/' + a[1] + '/' + a[2]; }).join(' · '));
  const tk = Object.keys(TEST.talk);
  if (tk.length) out.push('【剧情】累计 打开/看完/跳过：' + tk.map(function (k) {
    const a = TEST.talk[k];
    return k + ' ' + a[0] + '/' + a[2] + '/' + a[1] + (a[1] ? '（平均第 ' + (a[3] / a[1]).toFixed(1) + ' 句跳）' : '');
  }).join(' · '));
  if (TEST.bench) {
    out.push('【画布测速】' + fmtWhen(TEST.bench.t) + ' · v' + TEST.bench.v + ' · 每次微秒');
    out.push(TEST.bench.items.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · '));
  }
  out.push('【报错】' + (TEST.errs.length ? '' : '无'));
  TEST.errs.forEach(function (e) {
    out.push('×' + e.n + ' ' + e.msg + '（' + e.where + ' · v' + e.v + '）' + (e.at ? ' @ ' + e.at : ''));
  });
  return out;
}

/* ---------- 画布测速 ----------
   在这台手机上实测各种画法每次多少微秒（测试数据页「画布测速」）。每项画 150 次取平均，画在主画布上（下一帧就盖掉了）。
   「60…」几项量的是一批 60 个小形状的微秒数：一个一笔 vs 攒成一笔、散满一屏 vs 挤在一块
   以后做优化照着这张表挑最便宜的画法，不靠猜 */
function canvasBench() {
  const mk = function (w, h) {
    const c = IS_MG ? MG.createCanvas() : document.createElement('canvas');
    c.width = w; c.height = h;
    const g = ctx2d(c);
    g.fillStyle = 'rgba(77,247,255,0.6)';
    g.fillRect(0, 0, w, h);
    return c;
  };
  const small = mk(80, 80), sheet = mk(1024, 128), big = mk(512, 512);
  const N = 150, items = [];
  const X = function (i) { return 20 + (i * 37) % 300; }, Y = function (i) { return 120 + (i * 53) % 500; };
  // n：测多少次（"一批"的项一次画 60 个，少测几次）；name 为空的只热身不记
  const time = function (name, fn, n) {
    n = n || N;
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
    uf(800, 16);
    for (let i = 0; i < 5; i++) fn(i);              // 先热一下
    const t0 = nowMs();
    for (let i = 0; i < n; i++) fn(i);
    if (name) items.push([name, Math.round((nowMs() - t0) * 1000 / n)]);
    ctx.restore();
  };
  // 一批 60 个小形状：散满一屏 / 挤在一小块；一个一笔 / 攒成一笔。量的是"一批"的微秒数
  const B = 60;
  const bx = function (i, k, tight) { return tight ? 150 + (k * 13) % 60 : 10 + ((i + k) * 37) % 350; };
  const by = function (i, k, tight) { return tight ? 380 + (k * 29) % 60 : 100 + ((i + k) * 53) % 560; };
  const dotsEach = function (tight) { return function (i) {
    for (let k = 0; k < B; k++) { ctx.beginPath(); ctx.arc(bx(i, k, tight), by(i, k, tight), 3, 0, Math.PI * 2); ctx.fill(); }
  }; };
  const dotsOne = function (tight) { return function (i) {
    ctx.beginPath();
    for (let k = 0; k < B; k++) { const x = bx(i, k, tight), y = by(i, k, tight); ctx.moveTo(x + 3, y); ctx.arc(x, y, 3, 0, Math.PI * 2); }
    ctx.fill();
  }; };
  try {
    // 第一项会吃到上一帧和刚建的三张图没收完的尾巴（"小图整张贴"每次几十到四百乱跳），先空跑一轮不记
    time('', function (i) { ctx.drawImage(small, X(i), Y(i), 60, 60); ctx.drawImage(sheet, 128, 0, 128, 128, X(i), Y(i), 60, 60); ctx.drawImage(big, X(i), Y(i), 200, 200); });
    time('小图整张贴', function (i) { ctx.drawImage(small, X(i), Y(i), 60, 60); });
    time('小图取一块', function (i) { ctx.drawImage(small, 0, 0, 40, 40, X(i), Y(i), 60, 60); });
    time('长条图取一块', function (i) { ctx.drawImage(sheet, 128, 0, 128, 128, X(i), Y(i), 60, 60); });
    time('大图整张贴', function (i) { ctx.drawImage(big, X(i), Y(i), 200, 200); });
    time('改透明度+小图', function (i) { ctx.globalAlpha = 0.3 + (i % 5) * 0.1; ctx.drawImage(small, X(i), Y(i), 60, 60); });
    time('实心圆', function (i) { ctx.beginPath(); ctx.arc(X(i), Y(i), 12, 0, Math.PI * 2); ctx.fill(); });
    time('十边形', function (i) {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = k * 0.628; ctx.lineTo(X(i) + Math.cos(a) * 20, Y(i) + Math.sin(a) * 14); }
      ctx.closePath(); ctx.fill();
    });
    time('设颜色+方块', function (i) { ctx.fillStyle = i % 2 ? 'rgba(77,247,255,0.5)' : '#ffd166'; ctx.fillRect(X(i), Y(i), 8, 8); });
    time('描一条线', function (i) { ctx.beginPath(); ctx.moveTo(X(i), Y(i)); ctx.lineTo(X(i) + 30, Y(i) + 10); ctx.stroke(); });
    time('写一个字', function (i) { ctx.fillText('斩', X(i), Y(i)); });
    time('设字体', function (i) { uf(i % 2 ? 800 : 700, 14 + (i % 3)); });
    time('径向渐变', function (i) {
      const g = ctx.createRadialGradient(X(i), Y(i), 0, X(i), Y(i), 30);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(X(i) - 30, Y(i) - 30, 60, 60);
    });
    time('存档/恢复', function () { ctx.save(); ctx.restore(); });
    time('60点散开一个一笔', dotsEach(false), 20);
    time('60点散开攒一笔', dotsOne(false), 20);
    time('60点挤一块一个一笔', dotsEach(true), 20);
    time('60点挤一块攒一笔', dotsOne(true), 20);
    time('60条线散开一条一笔', function (i) {
      for (let k = 0; k < B; k++) { const x = bx(i, k), y = by(i, k); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9, y + 4); ctx.stroke(); }
    }, 20);
    time('60条线散开攒一笔', function (i) {
      ctx.beginPath();
      for (let k = 0; k < B; k++) { const x = bx(i, k), y = by(i, k); ctx.moveTo(x, y); ctx.lineTo(x + 9, y + 4); }
      ctx.stroke();
    }, 20);
    time('60条细块散开攒一笔', function (i) {
      ctx.beginPath();
      for (let k = 0; k < B; k++) {
        const x = bx(i, k), y = by(i, k);
        ctx.moveTo(x + 0.4, y - 0.9); ctx.lineTo(x - 0.4, y + 0.9); ctx.lineTo(x + 8.6, y + 4.9); ctx.lineTo(x + 9.4, y + 3.1); ctx.closePath();
      }
      ctx.fill();
    }, 20);
  } catch (e) { logErr(e, '测速'); }
  TEST.bench = { t: Date.now(), v: BUILD_TAG, items: items };
  testSave();
}

/* ---------- 测试数据页 ---------- */
let dataLines = null;        // 折好行的报告（打开时折一次，不每帧量字）
let dataCopyAt = -1e9, dataClearAt = -1e9;
function readyDataBtn() { return { x: 0, y: H_CSS - SAFE_BOTTOM - 44, w: W_CSS * 0.5, h: 44 + SAFE_BOTTOM }; }
function openData() { state = 'data'; dataLines = null; resetInput(); }
function dataLayout() {
  const top = MENU ? Math.max(SAFE_TOP + 14, MENU.bottom + 12) : SAFE_TOP + 14;   // 躲开右上角胶囊
  const w = Math.min(390, W_CSS - 24), x = (W_CSS - w) / 2;
  const by = H_CSS - SAFE_BOTTOM - 58, bw = (w - 16) / 3, by2 = by - 52, bw2 = (w - 8) / 2;
  return {
    x: x, w: w, top: top, textTop: top + 46, textBottom: by2 - 14,
    god:   { x: x, y: by2, w: bw2, h: 42 },
    bench: { x: x + bw2 + 8, y: by2, w: bw2, h: 42 },
    copy:  { x: x, y: by, w: bw, h: 44 },
    clear: { x: x + bw + 8, y: by, w: bw, h: 44 },
    back:  { x: x + 2 * (bw + 8), y: by, w: bw, h: 44 }
  };
}
// 按宽度折行：一个字一个字量（中文没有空格可断），续行缩进两格
function wrapReport(lines, maxW) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].charAt(0) === '【';
    uf(head ? 800 : 500, head ? 12 : 11);
    let cur = '';
    const cs = Array.from(lines[i]);
    for (let j = 0; j < cs.length; j++) {
      if (cur && textW(cur + cs[j]) > maxW) { out.push({ t: cur, head: head }); cur = '　' + cs[j]; }
      else cur += cs[j];
    }
    out.push({ t: cur, head: head });
  }
  return out;
}
function drawData() {
  inkBg(1);
  const L = dataLayout();
  ctx.textAlign = 'left';
  uf(900, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('测试数据', L.x, L.top + 24);
  uf(500, 11);
  ctx.fillStyle = 'rgba(191,246,255,0.55)';
  ctx.fillText('截图，或点「复制」发到群里', L.x + 100, L.top + 23);

  if (!dataLines) dataLines = wrapReport(testReport(), L.w);
  let y = L.textTop;
  for (let i = 0; i < dataLines.length; i++) {
    const ln = dataLines[i];
    if (ln.head && i) y += 6;
    if (y > L.textBottom) {
      uf(500, 11);
      ctx.fillStyle = UI.gold;
      ctx.fillText('…… 放不下了，完整的点「复制」', L.x, L.textBottom + 4);
      break;
    }
    uf(ln.head ? 800 : 500, ln.head ? 12 : 11);
    ctx.fillStyle = ln.head ? UI.cyan : 'rgba(226,240,246,0.85)';
    ctx.fillText(ln.t, L.x, y);
    y += ln.head ? 18 : 16;
  }

  const now = nowMs();
  drawButton(L.copy, now - dataCopyAt < 2000 ? '已复制' : '复制', { kind: 'primary', size: 15, weight: 900 });
  drawButton(L.clear, now - dataClearAt < 2500 ? '再点清空' : '清空', { kind: now - dataClearAt < 2500 ? 'danger' : 'ghost', size: 13 });
  drawButton(L.back, '返回', { kind: 'plain', size: 15 });
  drawButton(L.god, '无敌：' + (TEST.god ? '开' : '关'), { kind: TEST.god ? 'gold' : 'ghost', size: 14, weight: 800 });
  drawButton(L.bench, '画布测速', { kind: 'plain', size: 14 });
}
function dataTap(t) {
  const L = dataLayout();
  if (inRect(t, L.copy)) { copyReport(); return; }
  if (inRect(t, L.god)) { TEST.god = !TEST.god; testSave(); dataLines = null; return; }
  if (inRect(t, L.bench)) { canvasBench(); dataLines = null; return; }
  if (inRect(t, L.clear)) {
    if (nowMs() - dataClearAt < 2500) { TEST.runs = []; TEST.errs = []; testSave(); dataLines = null; dataClearAt = -1e9; }
    else dataClearAt = nowMs();
    return;
  }
  if (inRect(t, L.back)) { state = 'ready'; resetInput(); }
}
function copyReport() {
  const txt = testReport().join('\n');
  const ok = function () { dataCopyAt = nowMs(); };
  try {
    if (IS_MG && typeof MG.setClipboardData === 'function') MG.setClipboardData({ data: txt, success: ok });
    else if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(txt).then(ok);
    else console.log(txt);
  } catch (e) { logErr(e, '复制'); }
}


/* =========================================================
   15. 主循环
   ========================================================= */
let last = 0;

// 帧体检：局内两帧间隔超过 30ms（60Hz 下至少丢了一帧）记一次卡顿；超过半秒的是切后台，不算。
// 主界面左下角显示上一局的结果 —— 玩家说"掉帧"时先看这里，分清是真卡还是手感
const PERF = { n: 0, worst: 0, t: 0, frames: 0, lay: {} };   // lay：每层各自的 { f 帧数, t 毫秒, n 卡顿 }
// 每帧往屏幕上画了几笔（填 / 描 / 贴图 / 写字，只数主画布；测试数据页报平均和最多）：看卡是不是因为一帧笔数太多
let OPS = 0;
function wrapOps(g) {
  if (!CFG.testPanel || !g || g.__ops === 1) return;
  try {
    ['fill', 'stroke', 'fillRect', 'drawImage', 'fillText', 'strokeText'].forEach(function (k) {
      const f = g[k];
      if (typeof f !== 'function') return;
      g[k] = function () { OPS++; return f.apply(g, arguments); };
    });
    g.__ops = 1;
  } catch (e) {}
}
// 分段计时（只记局内）：每帧平均花几毫秒在 逻辑 / 背景 / 本层特性 / 场上物体 / 盖层 / 界面，另记声音和振动的调用。
// 主界面第二行显示 —— 手机上卡在哪一块一眼看出来。几项加起来远小于帧间隔，说明慢在画像素本身（交给画布之后），不在 JS
const PT = { logic: 0, bg: 0, feat: 0, world: 0, top: 0, ui: 0, snd: 0 };
let ptOn = false, ptAt = 0;
function ptLap(key) {
  if (!ptOn) return;
  const t = nowMs();
  PT[key] += t - ptAt;
  ptAt = t;
}
// 再细一层：每个绘制函数这一局累计多少毫秒（测试数据页列"最慢的几项"），和上面分段各记各的
const PTF = {}, PTFL = {};     // PTFL：同样的账再按层分一份（每层各自最慢的几项）
const PTFI = [{}, {}];         // 黑潮在屏幕里 / 不在 各记一份（黑潮一进屏幕就卡：看多出来的是哪几项）
// 这一帧最慢的一项（毫秒、名字）、现做了几张贴图 / 几块地面：最卡的几帧连同它一起记（卡在哪一步、是不是在现做图）
const FR = { d: 0, n: '', tx: 0, bg: 0 };
let ptFnAt = 0;
function ptFn(name) {
  if (!ptOn) return;
  const t = nowMs(), d = t - ptFnAt;
  PTF[name] = (PTF[name] || 0) + d;
  const L = PTFL[layer] || (PTFL[layer] = {});
  L[name] = (L[name] || 0) + d;
  if (hordeMode) { const I = PTFI[hInkFrac > 0.1 ? 0 : 1]; I[name] = (I[name] || 0) + d; }
  if (d > FR.d) { FR.d = d; FR.n = name; }
  ptFnAt = t;
}

function frameStep(now) {
  if (!last) last = now;
  const gap = now - last;
  if (state === 'play' && gap > 0 && gap < 500) {
    PERF.frames++; PERF.t += gap;
    if (gap > 30) { PERF.n++; if (gap > PERF.worst) PERF.worst = gap; }
    const L = PERF.lay[layer] || (PERF.lay[layer] = { f: 0, t: 0, n: 0 });
    L.f++; L.t += gap; if (gap > 30) L.n++;
    if (hordeMode && PERF.ink) {
      // 上一帧墨潮盖了屏幕一成以上算"黑潮在屏幕里"：[帧数, 毫秒, 卡顿, 画面 JS 毫秒, 声音 JS 毫秒] × 在 / 不在
      const pt = PT.bg + PT.feat + PT.world + PT.top + PT.ui, I = PERF.ink[hInkFrac > 0.1 ? 0 : 1];
      I[0]++; I[1] += gap; if (gap > 30) I[2]++; I[3] += pt - PERF.inkPt; I[4] += PT.snd - PERF.inkSnd;
      PERF.inkPt = pt; PERF.inkSnd = PT.snd;
    }
    testSample(gap);
  }
  let raw = gap / 1000;
  last = now;
  if (raw > 0.05) raw = 0.05;      // 切后台回来不要"瞬移"
  if (raw < 0) raw = 0;
  tickUI(raw);                     // HUD 动画走真实时间：顿帧、死亡慢放时数字照样滚

  // 顿帧：死亡那一下把时间冻住（击杀 / 破甲 / 爆炸的顿帧已改成慢放，见 hitPause）
  if (hitstop > 0) {
    hitstop -= raw;
    shake *= Math.exp(-6 * raw);
    render();
    return;
  }

  let dt = raw;
  if (state === 'dead') {
    dt = raw * 0.22;
    deadT += raw;
    if (hordeMode) hEndTick();       // 黑潮复活页：5 秒没选 = 不复活
    if (laneMode) lDeadTick(dt);     // 横屏跑酷：被抓那一下照放
    if (reviveT > 0) {
      reviveT -= raw;
      if (reviveT <= 0) { reviveT = 0; finishRun(); }
    }
  } else if (state === 'over') {
    deadT += raw; overT += raw;
  } else if (state === 'preAd') {
    preAdTick();                     // 开局前看不看广告：5 秒没选 = 直接开始
  } else if (state === 'pick') {
    tickPick(raw);
  } else if (state === 'talk') {
    tickTalk(raw);
  } else if (state === 'ad') {
    if (adMode === 'placeholder') {
      adT -= raw;
      if (adT <= 0) endAd(true);
    } else if (adMode === 'real' && adWatch > 0) {
      adWatch -= raw;
      if (adWatch <= 0) endAd(false);    // 广告始终没弹出来
    }
  }

  // 打击慢放：只放慢局内时间，HUD 照常（tickUI 走真实时间）
  if (hitSlow > 0) {
    hitSlow = Math.max(0, hitSlow - raw);
    if (state === 'play') dt *= CFG.hitSlowK;
  }

  if (state === 'play') { ptOn = true; ptAt = nowMs(); update(dt); ptLap('logic'); ptOn = false; }
  else if (state !== 'pause' && state !== 'pick' && state !== 'talk') updateFX(dt);     // 暂停 / 挑刀诀 / 开场对话：连特效都定住

  shake *= Math.exp(-7 * raw);

  render();
}
// 一帧出错：先记进测试数据（见 logErr），再照旧抛出去（行为不变，只是错误不再无声无息）
// 先排下一帧再跑这一帧（用户："每次玩到这个附近就开始卡死"）：以前这一帧出错就往外抛、下一帧不排了 ——
// 一次出错整个游戏就定住，点哪儿都没反应。现在出错记进测试数据（logErr，【报错】那一栏），下一帧照跑；
// 局里一直出错（连着 frameErrMax 帧，一秒多）就别硬撑了：这局直接结束进结算（死因"出错"），再不行回主界面
let frameErrN = 0;
const frameErrMax = 90;
function frame(now) {
  requestAnimationFrame(frame);
  try { frameStep(now); frameErrN = 0; }
  catch (e) {
    logErr(e, '每帧');
    if (++frameErrN === frameErrMax) {
      try {
        if (hordeMode && state === 'play') { hLives = 1; P.inv = 0; hHurtT = 0; shield = 0; die('出错'); }
        else toReady();
      } catch (x) { try { toReady(); } catch (y) {} }
    }
  }
}


/* =========================================================
   2.17 横屏跑酷（CFG.mainMode 'lane'）
   用户："改成横屏，分为上 中上 中下 下四个区域，体育生从左往右跑，嘉豪从右往左阻挡体育生，路上有柜子黑板饮水机之类的东西
   阻挡体育生，后面改成是教导主任在追，体育生如果撞上嘉豪，就会放慢速度，类似地铁跑酷那种，然后如果有嘉豪，玩家可以往前划一下给他打掉"；
   掉血："你学地铁跑酷就行"。
   · 上下划换道（四条道；换道撞到旁边的嘉豪一脚踢飞，算连斩），往右划斩：同一条道前面 reach 以内的嘉豪一刀全斩飞（挨着的一串 = 连斩），柜子 / 黑板 / 饮水机斩不动、刀停在它前面
   · 地铁跑酷那套：撞上嘉豪、换道蹭到旁边的东西 = 绊一跤（慢一下，教导主任冲到身后，chaseT 秒内再绊一跤 = 被抓）；
     正面撞上柜子 / 黑板 / 饮水机 = 直接被抓。被抓可以看广告复活 revives 次
   · 越跑越快（v0 → vMax）；连斩越高每只嘉豪越值钱（mul），连斩配乐按 bgmAt 升档；路上捡嘉欣糖（存进 meta.candy，跟商店同一种糖）
   · 第一局教两步：柜子来了停住教换道、嘉豪来了停住教斩（meta.lTut）
   全在屏幕坐标里画（不走世界相机）：体育生钉在横向 lPX() 处，东西从右边进来往左走
   ========================================================= */
const LN = {
  lanes: 4,
  px: 0.2,                         // 体育生站在跑道横向 20% 处
  v0: 330, vMax: 760, rampT: 240,  // 跑多快（像素/秒）：开局 v0，rampT 秒涨到 vMax
  m: 40,                           // 多少像素算 1 米
  laneT: 0.11,                     // 换一条道要多久（秒）
  swipe: 22,                       // 手指挪多远算一划
  pr: 13,                          // 体育生身宽的一半（碰撞用）
  reach: 230,                      // 往右划一刀够多远（同一条道）
  slashT: 0.16, slashCd: 0.1, whiffCd: 0.3,   // 一刀多久；斩到了 / 斩空了隔多久能再斩
  gap: [0.85, 1.2], gapMin: [0.55, 0.8],      // 两排东西隔几秒（rampT 秒内从 gap 缩到 gapMin）
  obsFrom: 4,                      // 开局前几秒只有嘉豪、没有障碍
  jhP: [0.4, 0.65],                // 没障碍的道上出嘉豪的概率（开局 → rampT 秒后）
  jhLine: 0.4, jhLineN: [2, 5],    // 出一串（同一条道 2~5 个挨着，一刀全斩）的概率（0.3 / 2~4 时机器人最高连斩才 17~34，不够爽）
  jhSpeed: [30, 110],              // 嘉豪自己往左跑多快（加在跑道速度上）
  swFrom: 40, swP: 0.2, swTell: 0.35,   // 拦路嘉豪：第 swFrom 秒以后，单个的里头 swP 会在半路往你那条道挪一条（先亮 swTell 秒箭头）
  candyP: 0.4,                     // 安全道上空着就摆一串嘉欣糖的概率（地铁跑酷的金币：顺着走就是安全的路）
  slowK: 0.6, slowT: 0.9,          // 绊一跤：速度 ×slowK，slowT 秒
  chaseT: 5,                       // 绊了以后教导主任贴在身后几秒；这几秒里再绊一跤 = 被抓
  kill: 10,                        // 斩一只嘉豪几分（再乘 mul）
  comboWin: 5,                     // 几秒没斩到嘉豪，连斩就断
  bgmAt: [10, 25, 50, 80, 120],    // 连斩配乐升档（跑酷一秒斩一两只，门槛比黑潮低得多）
  mul: [1, 2, 3, 4, 5, 6],         // 越连越值钱：每过一道 bgmAt，每只嘉豪的分 ×mul
  revives: 1, inv: 1.5             // 看广告复活几次、复活后无敌几秒
};
// 三种斩不动的：w = 半宽（碰撞），h = 占跑道高的几成（画）
const L_OBS = {
  cab:   { name: '柜子',   w: 26, h: 0.8 },
  board: { name: '黑板',   w: 56, h: 0.7 },
  water: { name: '饮水机', w: 18, h: 0.86 }
};
const L_OBS_K = ['cab', 'board', 'water'];
let laneMode = false;
let lObs = [], lFx = [], lFloat = [];
let lLane = 1, lFrom = 1, lLaneK = 1, lBumpT = 0, lBumpD = 0;
let lV = 0, lDist = 0, lTime = 0, lRowIn = 0, lSafe = 1;
let lChaseT = 0, lTeachX = -200, lSlashT = 0, lSlashCd = 0, lSlowT = 0, lInv = 0, lComboT = 0;
let lCandy = 0, lBestCombo = 0, lKills = 0, lStumbles = 0, lRevives = 0, lDeadWhy = '', lSettled = null, lNewBest = false;
let lTut = 3, lTutFz = null, lTutCard = null, lTutRef = null;
let lTouch = {};
let lScoredM = 0;            // 跑的米数已经给过几分（跑一米一分）
let lKickT = 0, lKickD = 0;   // 换道踢飞嘉豪：踢的那一下（画一道脚风）

// 开场剧情：黑潮那段（嘉欣被嘉豪们吸引走了）后面加一句教导主任
const INTRO_L = INTRO_H.slice(0, INTRO_H.length - 1).concat([
  ['jdzr', '那个体育生！走廊里不许跑！给我站住！'],
  INTRO_H[INTRO_H.length - 1]
]);
TALKERS.jdzr = { name: '教导主任', c: '#ff7a5a', side: 'R' };

function lTop() { return SAFE_TOP + 58; }                         // 跑道上沿（上面一条给分数、连斩、米数）
function lBot() { return H_CSS - SAFE_BOTTOM - 8; }
function lH() { return (lBot() - lTop()) / LN.lanes; }
function lY(l) { return lTop() + lH() * (l + 0.5); }
function lPX() { return SAFE_LEFT + (W_CSS - SAFE_LEFT - SAFE_RIGHT) * LN.px; }
function lCur() { return lLaneK >= 0.5 ? lLane : lFrom; }           // 碰撞算哪条道：换道过了一半就算新的那条
function lPY() { return lY(lFrom) + (lY(lLane) - lY(lFrom)) * easeOut(lLaneK); }
function lK() { return clamp(lTime / LN.rampT, 0, 1); }
function lLv() { let k = 0; while (k < LN.bgmAt.length && combo >= LN.bgmAt[k]) k++; return k; }
function lMul() { return LN.mul[lLv()]; }
function lMeters() { return Math.floor(lDist / LN.m); }
function lSpawnX() { return W_CSS + 80; }
function lPauseBtn() { return { x: SAFE_LEFT + 10, y: SAFE_TOP + 12, w: 40, h: 32 }; }

/* ---------- 开局 ---------- */
// story：主界面点开始才放开场剧情（再来一局不放）
function lStartFlow(story) {
  if (story && HD.story) { openTalk(INTRO_L, '跑酷开场', lStart); return; }
  lStart();
}
function lStart() {
  laneMode = true; hordeMode = false;
  state = 'play'; resetInput();
  lObs.length = 0; lFx.length = 0; lFloat.length = 0;
  lLane = 1; lFrom = 1; lLaneK = 1; lBumpT = 0; lKickT = 0;
  lTime = 0; lDist = 0; lV = LN.v0; lRowIn = LN.v0 * 0.8; lSafe = 1;
  lSlashT = 0; lSlashCd = 0; lSlowT = 0; lInv = 0; lComboT = 0;
  lCandy = 0; lBestCombo = 0; lKills = 0; lStumbles = 0; lRevives = 0; lDeadWhy = ''; lSettled = null; lNewBest = false;
  score = 0; combo = 0; comboTimer = 0; deadT = 0; shake = 0; hitSlow = 0; runDeaths = []; lScoredM = 0;
  gameTime = 0; runKills = 0; bestCombo = 0; reviveCount = 0;
  testRunStart();                              // 测试数据：这一局的帧数、卡顿从头记
  FB.score = 0; FB.pend = 0; FB.chain = 0; FB.tier = -1; FB.tierPop = 0; FB.comboPop = 0; FB.scorePop = 0; FB.record = false;
  FB.best0 = meta.lScore || 0;
  lTut = meta.lTut === 1 ? 3 : 0; lTutFz = null; lTutCard = null; lTutRef = null;
  // 开局：教导主任就在身后喊"站住"，跑两步甩开（地铁跑酷开头那样）；第一局教东西，他不出来
  lChaseT = lTut < 3 ? 0 : 2.2;
  lTeachX = lTut < 3 ? -200 : lPX() - 80;
  if (lChaseT > 0) lSay('站住！', lPX() - 80, lPY() - 50);
  S.bgmStart(); S.setBgm(0);
}

/* ---------- 每帧 ---------- */
function updateLane(dt) {
  if (lTutFz) {                                // 新手教程停住了：整个世界不动，等玩家照着划（刀、换道的动画照走，冷却也照走：不然停住前斩空过一次就永远斩不出来）
    lTutFz.t += dt;
    if (lSlashCd > 0) lSlashCd -= dt;
    if (lSlashT > 0) lSlashT -= dt;
    if (lBumpT > 0) lBumpT -= dt;
    if (lLaneK < 1) lLaneK = Math.min(1, lLaneK + dt / LN.laneT);
    lFxTick(dt);
    return;
  }
  lTime += dt; gameTime = lTime;               // gameTime 给测试数据用（帧数、贴图重画频率按局内时间算）
  const k = lK();
  lV = (LN.v0 + (LN.vMax - LN.v0) * k) * (lSlowT > 0 ? LN.slowK : 1);
  lDist += lV * dt;
  if (lSlowT > 0) lSlowT -= dt;
  if (lInv > 0) lInv -= dt;
  if (lSlashT > 0) lSlashT -= dt;
  if (lSlashCd > 0) lSlashCd -= dt;
  if (lBumpT > 0) lBumpT -= dt;
  if (lKickT > 0) lKickT -= dt;
  if (lLaneK < 1) lLaneK = Math.min(1, lLaneK + dt / LN.laneT);
  if (lChaseT > 0) lChaseT -= dt;
  lTeachX += ((lChaseT > 0 ? lPX() - 80 : -200) - lTeachX) * (1 - Math.exp(-(lChaseT > 0 ? 9 : 2.5) * dt));
  if (combo > 0 && (lComboT -= dt) <= 0) lBreak();
  lTutTick(dt);
  if (lTut >= 3 && (lRowIn -= lV * dt) <= 0) { lRow(); lRowIn = lGap() * lV; }
  const px = lPX();
  for (let i = lObs.length - 1; i >= 0; i--) {
    const o = lObs[i];
    o.t += dt;
    o.x -= (lV + (o.dead ? 0 : o.vx || 0)) * dt;
    if (o.fly) { o.x += o.fly.vx * dt; o.y += o.fly.vy * dt; o.fly.vy += 1500 * dt; o.fly.r += o.fly.vr * dt; }
    if (o.x < -140 || o.y > H_CSS + 80 || (o.dead && !o.fly)) { lObs.splice(i, 1); continue; }
    if (o.dead) continue;
    if (o.k === 'jh') lJhTick(o, dt, px);
    else if (o.k !== 'candy') o.y = lY(o.lane);
  }
  lHitTest(px);
  lFxTick(dt);
  // 分：跑一米一分
  const m = lMeters();
  if (m > lScoredM) { score += m - lScoredM; lScoredM = m; }
  FB.record = FB.best0 > 0 && score > FB.best0;
  S.setBgm(lLv());
}
// 嘉豪：别穿进前面同一条道的障碍里（排在它后面）；拦路的半路往你那条道挪一条（先亮箭头）
function lJhTick(o, dt, px) {
  for (let j = 0; j < lObs.length; j++) {
    const b = lObs[j];
    if (b === o || b.dead || b.k === 'jh' || b.k === 'candy' || b.lane !== o.lane || b.x > o.x) continue;
    const need = b.w + o.w + 24;
    if (o.x - b.x < need) o.x = b.x + need;
  }
  if (o.sw && !o.swd && o.x < W_CSS * 0.66 && o.x > px + 160) {
    const to = o.lane + (lLane > o.lane ? 1 : lLane < o.lane ? -1 : 0);
    if (to === o.lane || lLaneBlocked(to, o.x, 90)) { o.swd = true; }
    else if (o.tell === undefined) { o.tell = LN.swTell; o.to = to; }
  }
  if (o.tell !== undefined && o.tell > 0 && (o.tell -= dt) <= 0) { o.lane = o.to; o.swd = true; }
  o.y += (lY(o.lane) - o.y) * Math.min(1, dt * 14);
}
function lLaneBlocked(l, x, r) {
  for (let i = 0; i < lObs.length; i++) {
    const o = lObs[i];
    if (!o.dead && o.lane === l && o.k !== 'candy' && Math.abs(o.x - x) < r + o.w) return true;
  }
  return false;
}
// 撞没撞上：同一条道、横着叠上了
function lHitTest(px) {
  if (state !== 'play') return;
  const l = lCur();
  for (let i = 0; i < lObs.length; i++) {
    const o = lObs[i];
    if (o.dead || o.lane !== l || Math.abs(o.x - px) > o.w + LN.pr) continue;
    if (o.k === 'candy') { lEat(o); continue; }
    if (lTut < 3) { lPuff(o); continue; }      // 第一局还在教：撞上了也不算（东西化一团烟）
    if (o.k === 'jh' && lLaneK < 1 && lFrom !== lLane && o.lane === lLane) { lKick(o, lLane > lFrom ? 1 : -1); continue; }   // 正换道过去：踢飞
    if (o.k === 'jh') {
      lKnock(o);
      lStumble('撞上了嘉豪');
      if (state !== 'play') return;
      continue;
    }
    if (lInv > 0) { lPuff(o); continue; }
    lCaught('撞上了' + L_OBS[o.k].name);
    return;
  }
}
function lGap() {
  const k = lK();
  return rand(LN.gap[0] + (LN.gapMin[0] - LN.gap[0]) * k, LN.gap[1] + (LN.gapMin[1] - LN.gap[1]) * k);
}
function lAdd(kind, lane, x, extra) {
  const o = { k: kind, lane: lane, x: x, y: lY(lane), w: kind === 'jh' ? 15 : kind === 'candy' ? 10 : L_OBS[kind].w, vx: 0, dead: 0, t: 0 };
  if (extra) for (const key in extra) o[key] = extra[key];
  lObs.push(o);
  return o;
}
// 摆一排：先定这一排的安全道（没障碍，跟上一排的最多差两条道，换得过去），再在别的道上摆障碍、没障碍的道上摆嘉豪，安全道空着就摆一串糖
function lRow() {
  const k = lK(), x = lSpawnX();
  const r = Math.random(), d = r < 0.45 ? 0 : r < 0.8 ? (Math.random() < 0.5 ? -1 : 1) : (Math.random() < 0.5 ? -2 : 2);
  lSafe = clamp(lSafe + d, 0, LN.lanes - 1);
  const used = [];
  let nObs = lTime < LN.obsFrom ? 0 : 1 + (Math.random() < 0.25 + 0.35 * k ? 1 : 0) + (k > 0.5 && Math.random() < 0.25 * k ? 1 : 0);
  const cand = [];
  for (let l = 0; l < LN.lanes; l++) if (l !== lSafe) cand.push(l);
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
  for (let i = 0; i < nObs && i < cand.length; i++) {
    lAdd(L_OBS_K[Math.floor(Math.random() * L_OBS_K.length)], cand[i], x + rand(-20, 20));
    used[cand[i]] = true;
  }
  const pj = LN.jhP[0] + (LN.jhP[1] - LN.jhP[0]) * k;
  for (let l = 0; l < LN.lanes; l++) {
    if (used[l] || Math.random() >= pj) continue;
    const n = Math.random() < LN.jhLine ? LN.jhLineN[0] + Math.floor(Math.random() * (LN.jhLineN[1] - LN.jhLineN[0] + 1)) : 1;
    const sp = rand(LN.jhSpeed[0], LN.jhSpeed[1]);
    const sw = lTime > LN.swFrom && n === 1 && Math.random() < LN.swP;
    for (let i = 0; i < n; i++) lAdd('jh', l, x + i * 52, { vx: sp, sw: sw });
    used[l] = true;
  }
  if (!used[lSafe] && Math.random() < LN.candyP) for (let i = 0; i < 5; i++) lAdd('candy', lSafe, x + i * 46);
}

/* ---------- 换道、斩 ---------- */
function lMove(d) {
  if (state !== 'play' || !laneMode) return;
  if (lTutFz && lTutFz.k !== 'move') return;
  const to = lLane + d;
  if (to < 0 || to >= LN.lanes || lBumpT > 0) return;
  // 换道蹭到旁边那条道上的柜子 / 黑板 / 饮水机（地铁跑酷的蹭车）：弹回来、绊一跤。
  // 旁边是嘉豪：一脚踢飞，照样换过去（用户："如果嘉豪在侧面，可以给他踢飞，要不然容易出现死路" —— 以前也算绊一跤，
  // 前面有柜子、旁边那条道有嘉豪贴着就两头堵死）
  const px = lPX(), side = [];
  for (let i = 0; i < lObs.length; i++) {
    const o = lObs[i];
    if (o.dead || o.k === 'candy' || o.lane !== to || Math.abs(o.x - px) > o.w + LN.pr) continue;
    if (o.k !== 'jh') {
      lBumpT = 0.2; lBumpD = d;
      lStumble('蹭到了' + L_OBS[o.k].name);
      return;
    }
    side.push(o);
  }
  for (let i = 0; i < side.length; i++) lKick(side[i], d);
  lFrom = lCur(); lLane = to; lLaneK = 0;
  if (lTutFz) lTutFz = null;
}
function lSlash() {
  if (state !== 'play' || !laneMode || lSlashCd > 0) return;
  if (lTutFz && lTutFz.k !== 'slash') return;
  const px = lPX(), l = lCur();
  lSlashT = LN.slashT;
  S.whoosh();
  // 刀顺着这条道往前：嘉豪一路斩过去、糖顺手捡了，碰到斩不动的就停
  const hits = [];
  for (let i = 0; i < lObs.length; i++) {
    const o = lObs[i], dx = o.x - px;
    if (!o.dead && o.lane === l && dx > -o.w - LN.pr && dx < LN.reach + o.w) hits.push(o);
  }
  hits.sort(function (a, b) { return a.x - b.x; });
  let n = 0;
  for (let i = 0; i < hits.length; i++) {
    const o = hits[i];
    if (o.k === 'jh') { lKill(o); n++; }
    else if (o.k === 'candy') lEat(o);
    else { lClang(o); break; }
  }
  if (n) { lSlashCd = LN.slashCd; vibrate(1); if (lChaseT > 0) lChaseT = Math.max(0, lChaseT - 0.6 * n); }   // 斩一只，教导主任被甩远一点
  else lSlashCd = LN.whiffCd;
  if (lTutFz) lTutFz = null;
}
function lKill(o) {
  o.dead = 1;
  o.fly = { vx: rand(260, 460), vy: rand(-560, -340), r: 0, vr: rand(9, 15) * (Math.random() < 0.5 ? -1 : 1) };
  combo++; lComboT = LN.comboWin; lKills++; meta.kills++;
  if (combo > lBestCombo) lBestCombo = combo;
  const pts = LN.kill * lMul();
  score += pts;
  FB.comboPop = 1; FB.scorePop = 1;
  const t = tierOf(combo);
  if (t > FB.tier) { FB.tier = t; FB.tierPop = 1; S.tierUp(t); } else FB.tier = t;
  S.hit(combo);
  lSay('+' + pts, o.x, o.y - 34, UI.gold, 0.6);
  for (let i = 0; i < 7; i++) {
    const a = rand(-1.2, 1.2), sp = rand(160, 420);
    lFx.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.4), max: 0.4, c: i % 2 ? '#ffffff' : tierColor(FB.tier) });
  }
  hitSlow = Math.max(hitSlow, 0.035);
  shake = Math.max(shake, 4);
}
// 换道踢飞旁边的嘉豪（d：往哪边换，-1 上 / 1 下）：跟斩到一样算连斩、加分，往换道的方向飞出去
function lKick(o, d) {
  lKill(o);
  o.fly = { vx: rand(120, 280), vy: d * rand(380, 560) - 160, r: 0, vr: rand(10, 16) * d };
  lKickT = 0.18; lKickD = d;
  if (!meta.seen.lKick) { meta.seen.lKick = 1; saveMeta(); lSay('踢飞！', o.x, o.y - 40, '#ffffff', 0.9); }
}
function lKnock(o) { o.dead = 1; o.fly = { vx: rand(-80, 120), vy: rand(-420, -260), r: 0, vr: rand(6, 10) }; }
function lPuff(o) { o.dead = 1; for (let i = 0; i < 6; i++) lFx.push({ x: o.x, y: o.y, vx: rand(-160, 160), vy: rand(-160, 160), life: 0.3, max: 0.3, c: '#9fb0c0' }); }
function lClang(o) {
  for (let i = 0; i < 5; i++) lFx.push({ x: o.x - o.w, y: o.y + rand(-12, 12), vx: rand(-260, -80), vy: rand(-200, 200), life: 0.22, max: 0.22, c: '#ffe08a' });
  S.thump(0.3);
}
function lEat(o) {
  o.dead = 1;
  lCandy++;
  S.tick(0.5);
  lFx.push({ x: o.x, y: o.y, vx: 0, vy: 0, life: 0.25, max: 0.25, c: CANDY_C, ring: 1 });
}
function lSay(text, x, y, c, max) { lFloat.push({ text: text, x: x, y: y, t: 0, max: max || 1.1, c: c || '#ff8a6a' }); }
function lBreak() {
  combo = 0; lComboT = 0; FB.tier = -1; FB.tierPop = 0;
}
// 绊一跤（撞上嘉豪 / 换道蹭到）：慢一下，教导主任冲到身后；他还在身后时再绊一跤 = 被抓
function lStumble(why) {
  if (lInv > 0) return;
  if (lChaseT > 0) { lCaught(why + '，又绊了一跤'); return; }
  lStumbles++;
  lChaseT = LN.chaseT; lSlowT = LN.slowT; lInv = 0.45;
  lBreak();
  shake = Math.max(shake, 10); S.thump(0.8); vibrate(2);
  lSay('站住！', lPX() - 80, lPY() - 50);
  if (!meta.seen.lStum) { meta.seen.lStum = 1; saveMeta(); lTutCard = { t: 0, k: 'stum' }; }
}
function lCaught(why) {
  if (state !== 'play') return;
  lDeadWhy = why;
  state = 'dead'; deadT = 0;
  lChaseT = 0;
  shake = 16; S.thump(1); vibrate(3);
  runDeaths.push([why, 0, Math.floor(lTime)]);
  lSettle();
  runKills = lKills; bestCombo = lBestCombo; reviveCount = lRevives;
  try { testRecord(); } catch (e) { logErr(e, '跑酷记一局'); }   // 测试数据：一局一条（帧数、卡顿、死因）
}
// 一局结束记账：死了就记（关掉游戏也不丢糖），复活以后再死只补差额
function lSettle() {
  const s0 = lSettled || { candy: 0, run: false };
  if (!s0.run) meta.runs++;
  meta.candy += lCandy - s0.candy;
  const m = lMeters();
  lNewBest = m > (meta.lBest || 0);
  meta.lBest = Math.max(meta.lBest || 0, m);
  meta.lScore = Math.max(meta.lScore || 0, score);
  meta.comboBest = Math.max(meta.comboBest, lBestCombo);
  lSettled = { candy: lCandy, run: true };
  saveMeta();
}
function lCanRevive() { return lRevives < LN.revives; }
function lRevive() {
  lRevives++;
  state = 'play'; deadT = 0;
  const px = lPX();
  for (let i = 0; i < lObs.length; i++) { const o = lObs[i]; if (!o.dead && o.k !== 'candy' && o.x < px + 480) lPuff(o); }
  lChaseT = 0; lSlowT = 0; lInv = LN.inv; lTeachX = -200;
  S.bgmStart();
}
function lFxTick(dt) {
  for (let i = lFx.length - 1; i >= 0; i--) {
    const f = lFx[i];
    f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92;
    if ((f.life -= dt) <= 0) lFx.splice(i, 1);
  }
  for (let i = lFloat.length - 1; i >= 0; i--) {
    const f = lFloat[i];
    f.t += dt; f.y -= 30 * dt;
    if (f.t >= f.max) lFloat.splice(i, 1);
  }
}

// 被抓了那一页底下：飞出去的照飞、火花照走，教导主任扑上来揪住
function lDeadTick(dt) {
  lFxTick(dt);
  for (let i = 0; i < lObs.length; i++) {
    const o = lObs[i];
    if (o.fly) { o.x += o.fly.vx * dt; o.y += o.fly.vy * dt; o.fly.vy += 1500 * dt; o.fly.r += o.fly.vr * dt; }
  }
  lTeachX += (lPX() - 34 - lTeachX) * (1 - Math.exp(-10 * dt));
  if (lSlashT > 0) lSlashT -= dt;
}

/* ---------- 第一局：停住教两步 ---------- */
// lTut 0 = 柜子来了教换道，1 = 嘉豪来了教斩，2 = 一张卡（绊一跤、教导主任），3 = 教完（meta.lTut = 1）。
// 看的是要去的那条道（lLane）：换道动画那 0.11 秒碰撞还算老的那条，用它的话刚换完又会停住
function lTutTick(dt) {
  if (lTutCard && (lTutCard.t += dt) > 3.4) lTutCard = null;
  if (lTut >= 3) return;
  const px = lPX();
  if (lTut === 0) {
    if (!lTutRef && lTime > 1) lTutRef = lAdd('cab', lLane, lSpawnX());
    if (lTutRef && !lTutFz && lTutRef.lane === lLane && lTutRef.x - px < 300 && lTutRef.x - px > 60) { lTutFz = { k: 'move', ref: lTutRef, t: 0 }; lSlashCd = 0; lBumpT = 0; }
    if (lTutRef && lTutRef.x < px - 90) { lTut = 1; lTutRef = null; }
  } else if (lTut === 1) {
    if (!lTutRef) lTutRef = lAdd('jh', lLane, lSpawnX(), { vx: 40 });
    if (!lTutFz && !lTutRef.dead && lTutRef.lane === lLane && lTutRef.x - px < 200 && lTutRef.x - px > 40) { lTutFz = { k: 'slash', ref: lTutRef, t: 0 }; lSlashCd = 0; }
    if (lTutRef.dead || lTutRef.x < px - 90) { lTut = 2; lTutRef = null; lTutCard = { t: 0, k: 'stum' }; meta.seen.lStum = 1; }
  } else if (lTut === 2 && !lTutCard) {
    lTut = 3; meta.lTut = 1; saveMeta();
    lRowIn = lV * 0.5;
  }
}
// 主界面「新手教程」：下一局从头教
function lTutReplay() { meta.lTut = 0; saveMeta(); lStartFlow(false); }

/* ---------- 输入 ---------- */
function lTouchStart(t) {
  if (inRect(t, lPauseBtn())) { pauseGame(); return; }
  lTouch[t.identifier] = { x: t.clientX, y: t.clientY, at: nowMs(), done: false };
}
function lSwipe(s, x, y) {
  const dx = x - s.x, dy = y - s.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < LN.swipe) return false;
  s.done = true;
  if (Math.abs(dy) > Math.abs(dx)) lMove(dy < 0 ? -1 : 1);
  else if (dx > 0) lSlash();
  return true;
}
function lTouchMove(t) { const s = lTouch[t.identifier]; if (s && !s.done) lSwipe(s, t.clientX, t.clientY); }
function lTouchEnd(t) {
  const s = lTouch[t.identifier];
  delete lTouch[t.identifier];
  if (s && !s.done && nowMs() - s.at < 400) {
    // 松手时还没够一划：短划也认（手快的人一下就松了）
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= LN.swipe * 0.55) { s.x -= dx * 0.9; s.y -= dy * 0.9; lSwipe(s, t.clientX, t.clientY); }
  }
}
// 主界面（横屏）
function lReadyLayout() {
  const cx = W_CSS / 2, cy = H_CSS / 2;
  return {
    go: { x: cx - 110, y: cy + 34, w: 220, h: 56 },
    tut: { x: cx - 110, y: cy + 104, w: 104, h: 34 },
    data: { x: cx + 6, y: cy + 104, w: 104, h: 34 }
  };
}
function lReadyTap(t) {
  const L = lReadyLayout();
  if (inRect(t, L.tut)) { lTutReplay(); return; }
  if (CFG.testPanel && inRect(t, L.data)) { openData(); return; }
  lStartFlow(true);                    // 点别的地方都算开始
}
// 被抓了那一页
function lDeadLayout() {
  const cx = W_CSS / 2, w = Math.min(220, W_CSS * 0.3), y = H_CSS * 0.6, rv = lCanRevive();
  return {
    revive: rv ? { x: cx - 150, y: y, w: 300, h: 50 } : null,
    go: { x: cx - w - 8, y: rv ? y + 62 : y, w: w, h: 44 },
    home: { x: cx + 8, y: rv ? y + 62 : y, w: w, h: 44 }
  };
}
function lDeadTap(t) {
  if (deadT < 0.7) return;               // 刚被抓那一下的手指不算
  const L = lDeadLayout();
  if (L.revive && inRect(t, L.revive)) { startAd('revive'); return; }
  if (inRect(t, L.go)) { lStartFlow(false); return; }
  if (inRect(t, L.home)) toReady();
}

/* ---------- 画 ---------- */
// 走廊：上面一条墙（窗户），下面四条道（深浅相间、虚线分道、地砖缝），一张贴图，按跑了多远往左挪（一笔）
const L_TILE = 160;
function drawLaneBg(dist) {
  const w = W_CSS + L_TILE, h = H_CSS, top = lTop(), lh = lH();
  const spr = textSprite('lnBg', w + '|' + h + '|' + top, w, h, function () {
    ctx.fillStyle = '#121822';
    ctx.fillRect(0, 0, w, top);
    for (let x = 0; x < w; x += L_TILE) {
      ctx.fillStyle = '#1c2533';
      ctx.fillRect(x + 22, SAFE_TOP + 6, 64, top - SAFE_TOP - 16);
      ctx.fillStyle = 'rgba(150,200,255,0.10)';
      ctx.fillRect(x + 26, SAFE_TOP + 10, 56, top - SAFE_TOP - 24);
      ctx.fillStyle = '#2a2018';
      ctx.fillRect(x + 110, SAFE_TOP + 14, 30, top - SAFE_TOP - 14);
    }
    ctx.fillStyle = '#3a4656';
    ctx.fillRect(0, top - 4, w, 4);
    for (let l = 0; l < LN.lanes; l++) {
      ctx.fillStyle = l % 2 ? '#1a212c' : '#1e2733';
      ctx.fillRect(0, top + lh * l, w, lh);
    }
    ctx.fillStyle = '#161c25';                                     // 最下面一条道以下（底部安全区）接着铺地
    ctx.fillRect(0, top + lh * LN.lanes, w, h - top - lh * LN.lanes);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 0; x < w; x += 80) ctx.fillRect(x, top, 2, h - top);
    ctx.fillStyle = 'rgba(214,236,242,0.22)';
    for (let l = 1; l < LN.lanes; l++) for (let x = 0; x < w; x += 80) ctx.fillRect(x, top + lh * l - 1, 40, 2);
  });
  const ox = -(dist % L_TILE);
  if (spr) ctx.drawImage(spr, ox, 0, w, h);
}
// 人物、东西都是贴图（第一次画好以后每个一笔）。sz = 跑道高
function lSprJh(lh) {
  const w = 44, h = Math.round(lh * 0.82);
  return { w: w, h: h, c: textSprite('lnJh', w + '|' + h, w, h, function () {
    const cx = w / 2, by = h - 4;
    ctx.fillStyle = '#0c0c0f';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 13, by); ctx.lineTo(cx - 11, h * 0.42); ctx.lineTo(cx + 11, h * 0.42); ctx.lineTo(cx + 13, by); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, h * 0.27, Math.min(11, h * 0.16), 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 10, h * 0.25, 9, 3);              // 墨镜（朝左跑）
    ctx.textAlign = 'center';
    uf(900, 11);
    ctx.fillText('豪', cx, h * 0.72);
  }) };
}
function lSprObs(kind, lh) {
  const O = L_OBS[kind], w = O.w * 2, h = Math.round(lh * O.h);
  return { w: w, h: h, c: textSprite('lnO_' + kind, w + '|' + h, w, h, function () {
    ctx.textAlign = 'center';
    if (kind === 'cab') {
      ctx.fillStyle = '#5b6b80'; ctx.fillRect(1, 1, w - 2, h - 2);
      ctx.strokeStyle = '#2b3442'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.fillStyle = '#2b3442'; ctx.fillRect(w / 2 - 1, 4, 2, h - 8);
      ctx.fillStyle = '#d7dde5'; ctx.fillRect(w / 2 - 6, h * 0.5, 3, 8); ctx.fillRect(w / 2 + 3, h * 0.5, 3, 8);
      uf(800, 11); ctx.fillStyle = '#eef3f8'; ctx.fillText('柜子', w / 2, 15);
    } else if (kind === 'board') {
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(0, 0, w, h - 8);
      ctx.fillStyle = '#1f5c45'; ctx.fillRect(4, 4, w - 8, h - 16);
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(6, h - 8, 4, 8); ctx.fillRect(w - 10, h - 8, 4, 8);
      uf(800, 13); ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillText('黑板', w / 2, (h - 8) / 2 + 5);
    } else {
      ctx.fillStyle = '#59b7ff'; ctx.fillRect(w / 2 - 9, 0, 18, h * 0.3);
      ctx.fillStyle = '#dfe8ee'; ctx.fillRect(1, h * 0.3, w - 2, h * 0.7 - 1);
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(w / 2 - 8, h * 0.45, 5, 5);
      ctx.fillStyle = '#3a8dff'; ctx.fillRect(w / 2 + 3, h * 0.45, 5, 5);
      uf(800, 9); ctx.fillStyle = '#4a5866'; ctx.fillText('饮水机', w / 2, h * 0.85);
    }
  }) };
}
function lSprHero(lh, f) {
  const w = 46, h = Math.round(lh * 0.86);
  return { w: w, h: h, c: textSprite('lnP' + f, w + '|' + h, w, h, function () {
    const cx = w / 2 - 2, hy = h * 0.22;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1b2a3a'; ctx.lineWidth = 5;              // 腿：两帧交替
    ctx.beginPath();
    if (f) { ctx.moveTo(cx, h * 0.68); ctx.lineTo(cx + 12, h - 3); ctx.moveTo(cx, h * 0.68); ctx.lineTo(cx - 10, h - 6); }
    else { ctx.moveTo(cx, h * 0.68); ctx.lineTo(cx + 4, h - 3); ctx.moveTo(cx, h * 0.68); ctx.lineTo(cx - 3, h - 3); }
    ctx.stroke();
    ctx.fillStyle = '#2fd0ff';                                     // 运动服
    ctx.fillRect(cx - 9, h * 0.36, 18, h * 0.34);
    ctx.fillStyle = '#ffffff'; uf(900, 10); ctx.textAlign = 'center'; ctx.fillText('7', cx, h * 0.6);
    ctx.fillStyle = '#f2d3b0';                                     // 头
    ctx.beginPath(); ctx.arc(cx + 2, hy, Math.min(10, h * 0.14), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff4a5e'; ctx.fillRect(cx - 8, hy - 5, 20, 4); // 红头带
    ctx.lineCap = 'butt';
  }) };
}
function lSprTeach(lh) {
  const w = 56, h = Math.round(lh * 0.98);
  return { w: w, h: h, c: textSprite('lnT', w + '|' + h, w, h, function () {
    const cx = w / 2;
    ctx.fillStyle = '#6b3b2a'; ctx.fillRect(cx - 13, h * 0.38, 26, h * 0.6);       // 西装
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 3, h * 0.38, 6, h * 0.18);
    ctx.strokeStyle = '#6b3b2a'; ctx.lineWidth = 6; ctx.lineCap = 'round';          // 一只手往前抓
    ctx.beginPath(); ctx.moveTo(cx + 10, h * 0.45); ctx.lineTo(cx + 26, h * 0.32); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = '#f2d3b0'; ctx.beginPath(); ctx.arc(cx, h * 0.24, Math.min(13, h * 0.15), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2;                                    // 眼镜
    ctx.strokeRect(cx - 1, h * 0.21, 8, 5); ctx.strokeRect(cx + 9, h * 0.21, 6, 5);
    ctx.fillStyle = '#ff5a3a'; uf(900, 10); ctx.textAlign = 'center'; ctx.fillText('教导主任', cx, 10);
  }) };
}
function lSprCandy() { return textSprite('lnCandy', 'v1', 30, 20, function () { candyIcon(15, 10, 1); }); }

function drawLaneScene() {
  const dist = laneMode ? lDist : nowMs() * 0.12;
  ctx.save();
  if (shake > 0.3) ctx.translate(rand(-shake, shake) * 0.4, rand(-shake, shake) * 0.4);
  drawLaneBg(dist);
  if (!laneMode) { ctx.restore(); return; }
  const lh = lH(), px = lPX();
  const J = lSprJh(lh), C = lSprCandy();
  // 东西：从远到近（先画远的）
  for (let i = 0; i < lObs.length; i++) {
    const o = lObs[i];
    if (o.k === 'candy') { if (!o.dead && C) ctx.drawImage(C, o.x - 15, o.y - 10, 30, 20); continue; }
    const s = o.k === 'jh' ? J : lSprObs(o.k, lh);
    if (!s.c) continue;
    const by = o.y + lh * 0.42;                                    // 脚踩在道的下沿附近
    if (o.fly) {
      ctx.save(); ctx.translate(o.x, by - s.h / 2); ctx.rotate(o.fly.r); ctx.globalAlpha = 0.85;
      ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h); ctx.restore(); ctx.globalAlpha = 1;
      continue;
    }
    if (o.dead) continue;
    ctx.drawImage(s.c, o.x - s.w / 2, by - s.h, s.w, s.h);
    if (o.tell > 0) {                                              // 拦路嘉豪：要换道了，头上一个箭头
      const ay = by - s.h - 8, up = o.to < o.lane;
      ctx.beginPath();
      ctx.moveTo(o.x - 7, ay + (up ? 0 : -8)); ctx.lineTo(o.x + 7, ay + (up ? 0 : -8)); ctx.lineTo(o.x, ay + (up ? -10 : 2)); ctx.closePath();
      ctx.fillStyle = '#ff4a3a'; ctx.fill();
    }
  }
  // 教导主任（在身后才看得见）
  if (lTeachX > -60) {
    const T = lSprTeach(lh);
    if (T.c) ctx.drawImage(T.c, lTeachX - T.w / 2, lPY() + lh * 0.42 - T.h, T.w, T.h);
  }
  // 体育生：斩的时候往前冲一截；绊的时候往回一抖；无敌的时候一闪一闪
  const H0 = lSprHero(lh, Math.floor(lTime * 9) % 2);
  const lunge = lSlashT > 0 ? Math.sin((1 - lSlashT / LN.slashT) * Math.PI) * 34 : 0;
  const bump = lBumpT > 0 ? -lBumpD * Math.sin(lBumpT / 0.2 * Math.PI) * lh * 0.25 : 0;
  const hx = px + lunge, hy = lPY() + bump + lh * 0.42;
  if (H0.c && !(lInv > 0.5 && Math.floor(nowMs() / 80) % 2)) ctx.drawImage(H0.c, hx - H0.w / 2, hy - H0.h, H0.w, H0.h);
  if (lKickT > 0) {                                                // 踢飞：往换道那边一道白弧
    const k = 1 - lKickT / 0.18;
    ctx.beginPath();
    ctx.arc(hx, lPY(), 26 + k * 22, lKickD > 0 ? 0.3 : -Math.PI + 0.3, lKickD > 0 ? Math.PI - 0.3 : -0.3);
    ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * (1 - k)).toFixed(2) + ')';
    ctx.stroke();
  }
  if (lSlashT > 0) {                                               // 刀光：一道往前的弧
    const k = 1 - lSlashT / LN.slashT, cy = lPY();
    ctx.beginPath();
    ctx.arc(hx + 10, cy, 30 + k * (LN.reach - 40) * 0.5, -0.9, 0.9);
    ctx.lineWidth = 5 * (1 - k) + 1;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * (1 - k)).toFixed(2) + ')';
    ctx.stroke();
  }
  // 火花 / 糖圈
  for (let i = 0; i < lFx.length; i++) {
    const f = lFx[i], a = clamp(f.life / f.max, 0, 1);
    ctx.globalAlpha = a;
    if (f.ring) { ctx.beginPath(); ctx.arc(f.x, f.y, 10 + (1 - a) * 24, 0, Math.PI * 2); ctx.strokeStyle = f.c; ctx.lineWidth = 3; ctx.stroke(); }
    else { ctx.fillStyle = f.c; ctx.fillRect(f.x - 2, f.y - 2, 4, 4); }
  }
  ctx.globalAlpha = 1;
  // 飘字
  for (let i = 0; i < lFloat.length; i++) {
    const f = lFloat[i];
    ctx.globalAlpha = clamp((f.max - f.t) / 0.25, 0, 1);
    hText('lnF' + f.text, f.c, f.x - 50, f.y - 16, 100, 24, function () {
      ctx.textAlign = 'center'; uf(900, 16); outlineText(f.text, 50, 18, f.c, 3);
    });
  }
  ctx.globalAlpha = 1;
  // 教导主任贴在身后：左边一道红光（几秒里再绊一跤就被抓）
  if (lChaseT > 0 && state === 'play') {
    ctx.fillStyle = 'rgba(255,60,40,' + (0.12 + 0.1 * Math.sin(nowMs() / 90)).toFixed(3) + ')';
    ctx.fillRect(0, lTop(), 18 + SAFE_LEFT, lBot() - lTop());
  }
  ctx.restore();
}
function drawLaneHud() {
  const top = hudTop();
  drawHudScore(top);
  drawHudCombo(top);
  // 越连越值钱：连斩旁边一个小金签
  const mul = lMul();
  if (mul > 1 && combo >= 2) {
    const cp = hudCombo();
    hText('lnMul', String(mul), cp.x + 64 * cp.k, cp.y - 46 * cp.k, 76, 24, function () {
      ctx.textAlign = 'left'; uf(900, 15); outlineText('分 ×' + mul, 4, 17, UI.gold, 3);
    });
  }
  // 右上（胶囊左边）：米数、糖
  const mx = (MENU ? MENU.left : W_CSS - 100) - 14, mt = lMeters() + ' 米', ms = meterStrip();
  if (ms) hText('lnM', mt, mx - 176, SAFE_TOP + 6, 180, 40, function () { stripText(ms, mt, 176 - stripW(ms, mt), 30); });
  hText('lnCandyN', String(lCandy), mx - 80, SAFE_TOP + 38, 80, 20, function () {
    candyIcon(50, 10, 0.7); ctx.textAlign = 'left'; uf(800, 13); ctx.fillStyle = '#ffd0ea'; ctx.fillText(String(lCandy), 62, 15);
  });
  // 暂停键
  const pb = lPauseBtn();
  hText('lnPause', 'v1', pb.x, pb.y, pb.w, pb.h, function () {
    drawButton({ x: 0, y: 0, w: pb.w, h: pb.h }, '', { kind: 'ghost', size: 12 });
    ctx.fillStyle = 'rgba(214,236,242,0.75)';
    ctx.fillRect(pb.w / 2 - 6, 9, 4, 14); ctx.fillRect(pb.w / 2 + 2, 9, 4, 14);
  });
  // 第一局的卡
  if (lTutCard) {
    const a = clamp((3.4 - lTutCard.t) / 0.4, 0, 1) * clamp(lTutCard.t / 0.2, 0, 1), w = 360, h = 58;
    ctx.globalAlpha = a;
    hText('lnStum', 'v1', W_CSS / 2 - w / 2, lTop() + 8, w, h, function () {
      bladeBox(1, 1, w - 2, h - 2, { c: 10, border: 'rgba(255,122,90,0.8)', lw: 1.4, ticks: '#ff7a5a' });
      ctx.textAlign = 'center'; uf(800, 14); ctx.fillStyle = '#ffffff';
      ctx.fillText('撞上嘉豪会绊一跤，教导主任就追上来了', w / 2, 24);
      uf(600, 12); ctx.fillStyle = 'rgba(255,220,210,0.9)';
      ctx.fillText('他在身后的几秒里再绊一跤 = 被抓', w / 2, 44);
    });
    ctx.globalAlpha = 1;
  }
}
// 新手教程停住了：暗下来、照着那个东西，一张卡 + 箭头
function drawLaneTut() {
  if (!lTutFz || !lTutFz.ref) return;
  const o = lTutFz.ref, r = Math.max(46, lH() * 0.6), mv = lTutFz.k === 'move';
  ctx.beginPath();
  ctx.rect(0, 0, W_CSS, H_CSS);
  ctx.moveTo(o.x + r, o.y);
  ctx.arc(o.x, o.y, r, 0, Math.PI * 2, true);
  ctx.moveTo(lPX() + r * 0.8, lPY());
  ctx.arc(lPX(), lPY(), r * 0.8, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(4,6,9,0.66)';
  ctx.fill('evenodd');
  const w = 340, h = 64, x = W_CSS / 2 - w / 2, y = lTop() + 6;
  hText('lnTut', lTutFz.k, x, y, w, h, function () {
    bladeBox(1, 1, w - 2, h - 2, { c: 10, border: 'rgba(95,244,255,0.8)', lw: 1.4, ticks: UI.cyan });
    ctx.textAlign = 'center'; uf(900, 18); ctx.fillStyle = '#ffffff';
    ctx.fillText(mv ? '往上或往下划' : '往右划', w / 2, 27);
    uf(600, 13); ctx.fillStyle = 'rgba(214,236,242,0.9)';
    ctx.fillText(mv ? '换一条道，躲开柜子（柜子斩不动）' : '斩飞前面的嘉豪', w / 2, 50);
  });
  // 箭头：在体育生旁边一上一下跳（换道）/ 往右冲（斩）
  const k = (nowMs() % 900) / 900, px = lPX(), py = lPY();
  ctx.fillStyle = 'rgba(255,255,255,' + (1 - k).toFixed(2) + ')';
  ctx.beginPath();
  if (mv) {
    for (let s = -1; s <= 1; s += 2) {
      const ay = py + s * (26 + k * 30);
      ctx.moveTo(px - 10, ay - s * 8); ctx.lineTo(px + 10, ay - s * 8); ctx.lineTo(px, ay + s * 6); ctx.closePath();
    }
  } else {
    const ax = px + 40 + k * 60;
    ctx.moveTo(ax - 8, py - 10); ctx.lineTo(ax - 8, py + 10); ctx.lineTo(ax + 8, py); ctx.closePath();
  }
  ctx.fill();
}
function drawLaneReady() {
  hudStripsWarm();
  ctx.fillStyle = 'rgba(4,6,9,0.55)';
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  const cx = W_CSS / 2, L = lReadyLayout();
  hText('lnTitle', 'v1', cx - 220, H_CSS * 0.1, 440, 90, function () {
    ctx.textAlign = 'center'; uf(900, 60); outlineText('黑皮爱嘉欣', 220, 64, '#ffffff', 6);
  });
  hText('lnSub', 'v1', cx - 260, H_CSS * 0.1 + 88, 520, 26, function () {
    ctx.textAlign = 'center'; uf(700, 15); ctx.fillStyle = 'rgba(214,236,242,0.85)';
    ctx.fillText('教导主任在后面追，嘉豪们在前面挡。冲去找嘉欣！', 260, 18);
  });
  const best = '最远 ' + (meta.lBest || 0) + ' 米 · 最高 ' + (meta.lScore || 0) + ' 分 · 嘉欣糖 ' + meta.candy;
  hText('lnBest', best, cx - 220, L.go.y - 30, 440, 22, function () {
    ctx.textAlign = 'center'; uf(600, 13); ctx.fillStyle = 'rgba(255,209,102,0.85)'; ctx.fillText(best, 220, 15);
  });
  drawButton(L.go, '开 始', { kind: 'primary', size: 22, weight: 900, glow: UI.cyan });
  drawButton(L.tut, '新手教程', { kind: 'ghost', size: 13 });
  if (CFG.testPanel) drawButton(L.data, '测试数据', { kind: 'ghost', size: 13 });
  hText('lnHow', 'v2', cx - 300, H_CSS - SAFE_BOTTOM - 30, 600, 22, function () {
    ctx.textAlign = 'center'; uf(600, 12); ctx.fillStyle = 'rgba(214,236,242,0.55)';
    ctx.fillText('上下划换道（撞到旁边的嘉豪直接踢飞）· 往右划斩嘉豪 · 柜子、黑板、饮水机要躲开', 300, 15);
  });
  ctx.textAlign = 'right'; uf(500, 10); ctx.fillStyle = 'rgba(214,236,242,0.35)';
  ctx.fillText('v' + BUILD_TAG, W_CSS - SAFE_RIGHT - 10, H_CSS - SAFE_BOTTOM - 8);
}
function drawLaneDead() {
  const a = clamp((deadT - 0.35) / 0.3, 0, 1);
  if (a <= 0) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(4,6,9,0.78)';
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  const cx = W_CSS / 2, L = lDeadLayout();
  ctx.textAlign = 'center';
  uf(900, 34); outlineText('被教导主任抓住了！', cx, H_CSS * 0.2, '#ff8a6a', 5);
  uf(600, 14); ctx.fillStyle = 'rgba(214,236,242,0.75)';
  ctx.fillText(lDeadWhy, cx, H_CSS * 0.2 + 28);
  uf(800, 17); ctx.fillStyle = '#ffffff';
  ctx.fillText('跑了 ' + lMeters() + ' 米 · ' + score + ' 分 · 最高连斩 ×' + lBestCombo + ' · 嘉欣糖 +' + lCandy, cx, H_CSS * 0.2 + 66);
  if (lNewBest) { uf(900, 15); ctx.fillStyle = UI.gold; ctx.fillText('新纪录！', cx, H_CSS * 0.2 + 92); }
  if (L.revive) drawButton(L.revive, '看广告 · 原地复活', { kind: 'primary', size: 17, weight: 900, glow: UI.gold });
  drawButton(L.go, '再来一局', { kind: L.revive ? 'ghost' : 'primary', size: 16, weight: 800 });
  drawButton(L.home, '返回主界面', { kind: 'ghost', size: 15 });
  ctx.globalAlpha = 1;
}
function drawLane() {
  drawLaneScene();
  if (state === 'ready') { drawLaneReady(); return; }
  if (state === 'talk') { drawTalk(); return; }
  drawLaneHud();
  if (state === 'play') drawLaneTut();
  else if (state === 'pause') drawPause();
  else if (state === 'dead') drawLaneDead();
}

/* =========================================================
   16. 启动
   ========================================================= */
layout();
bindInput();
keepScreenOn();
requestAnimationFrame(frame);
