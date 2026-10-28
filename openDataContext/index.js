'use strict';
/* =========================================================
   开放数据域（抖音）：排行榜那一页的榜单
   ---------------------------------------------------------
   用户："结算画面……排名单独放"：结算第三页、主界面「排行榜」都是一整页榜单。榜单数据（昵称、头像、成绩、自己第几名）
   只有这边拿得到（tt.getImRankData 只能在开放数据域里用）；这边不能给主域发消息，所以名次、"提升了几名"都在这边算好，
   画在 sharedCanvas 上，主域把它贴到屏幕上（game.js 0.5 节 RK）。切哪个榜的按钮是主域画的，切了发消息过来。
   主域发来的消息：
   · { t: 'fetch', base: true }  开游戏 / 打开主界面的排行榜：拿一遍（不挂"升了几名"）
   · { t: 'fetch', run }         一局结束、成绩交完了：拿新名次，跟这一局之前的名次比，升了就挂"↑ 几名"
                                 （run = 第几局：同一局再来一次（看广告复活后又结算）还跟同一个比）
   · { t: 'size', k, kind, rel } sharedCanvas 大小变了（主域定的，k = 像素比）：重画
   · { t: 'show', kind, rel }    看哪个榜：kind 'm' 米数 / 's' 分数，rel 'friend' 好友 / 'all' 全服
   两个榜：米数榜在默认分区 'default'，分数榜在 'score'（跟 game.js 的 RK.zone 一致）
   ========================================================= */
var ZONE = { m: 'default', s: 'score' };
var UNIT = { m: '米', s: '分' };
var REL = ['friend', 'all'];
var PAGE = 20;                  // 一页拿几个（平台要小于 40）
var C = tt.getSharedCanvas();
var X = C.getContext('2d');
var K = 2, kind = 'm', rel = 'friend';
var rank = {};      // 'm.friend' → 自己第几名（0 = 不在榜上，-1 = 拿不到）
var up = {};        // 'm.friend' → 这一次比上一次升了几名（0 没变 / 'new' 刚上榜）
var list = {};      // 'm.friend' → 榜上前 PAGE 个 [{ nick_name, user_img, value, openid }]
var mine = {};      // 'm.friend' → 自己的成绩（字符串）
var me = '';        // 自己的 openid（榜上那一行标金色）
var busy = 0, err = '';
var runRef = {}, runId = null;   // 这一局之前的名次（第一次收到这一局的 fetch 时记下）
var IMG = {};       // 头像：url → { img, ok }

function key(k, r) { return k + '.' + r; }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function getList(k, r, done) {
  if (typeof tt.getImRankData !== 'function') { err = 'old'; done(-1); return; }
  try {
    tt.getImRankData({
      zoneId: ZONE[k], dataType: 0, relationType: r, rankType: 'all', pageSize: PAGE, pageNum: 1,
      success: function (res) {
        var d = (res && res.data) || {}, s = d.self_item;
        if (d.self_user_info && d.self_user_info.openid) me = d.self_user_info.openid;
        done(s && s.rank > 0 ? s.rank : 0, d.items || [], s && s.item ? s.item.value : '');
      },
      fail: function (e) { err = (e && e.errMsg) || 'fail'; done(-1); }
    });
  } catch (e) { err = String(e); done(-1); }
}

// 两个榜 × 好友 / 全服，一共四份。ref：这一轮之前的名次（升了几名跟它比）。
// 刚交的成绩平台可能还没排进去：一局结束那一轮拿完，2.5 秒后再拿一遍（还是跟同一个 ref 比）
function fetchAll(base, ref, again) {
  if (!ref) { ref = {}; for (var q in rank) ref[q] = rank[q]; }
  if (!again) up = {};          // 新的一轮：上一局的"↑"先撤掉，拿到了再挂
  busy = 4;
  draw();
  for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) (function (k, r) {
    getList(k, r, function (n, items, val) {
      var kk = key(k, r), old = ref[kk];
      if (n >= 0 || rank[kk] === undefined) rank[kk] = n;
      if (items) list[kk] = items;
      if (val) mine[kk] = val;
      if (base || old === undefined || old < 0 || n < 0) up[kk] = again ? up[kk] || 0 : 0;
      else if (n > 0 && old === 0) up[kk] = 'new';
      else if (n > 0 && old > 0 && n < old) up[kk] = old - n;
      else up[kk] = 0;
      if (--busy === 0 && !base && !again && typeof setTimeout === 'function') setTimeout(function () { fetchAll(false, ref, true); }, 2500);
      draw();
    });
  })(i ? 's' : 'm', REL[j]);
}

// 头像：能拿到图就贴（圆的），拿不到画一个带昵称第一个字的圆
function avatar(url, name, x, y, r, gold) {
  var a = url ? IMG[url] : null;
  if (url && !a && typeof tt.createImage === 'function') {
    try {
      a = IMG[url] = { img: tt.createImage(), ok: false };
      a.img.onload = function () { a.ok = true; draw(); };
      a.img.src = url;
    } catch (e) { a = IMG[url] = { ok: false }; }
  }
  X.beginPath();
  X.arc(x, y, r, 0, Math.PI * 2);
  X.fillStyle = gold ? 'rgba(255,209,102,0.25)' : 'rgba(150,225,240,0.15)';
  X.fill();
  if (a && a.ok) {
    X.save();
    X.beginPath();
    X.arc(x, y, r, 0, Math.PI * 2);
    X.clip();
    X.drawImage(a.img, x - r, y - r, r * 2, r * 2);
    X.restore();
  } else {
    X.textAlign = 'center';
    X.font = '800 ' + Math.round(r) + 'px sans-serif';
    X.fillStyle = 'rgba(234,246,248,0.8)';
    X.fillText(String(name || '?').charAt(0), x, y + 1);
  }
}

function cut(t, w) {
  t = String(t || '');
  if (X.measureText(t).width <= w) return t;
  while (t.length > 1 && X.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}

// 一页榜单：最上面"我 第几名 ↑几名 · 我的成绩"，下面一行一个人（名次、头像、昵称、成绩），自己那一行金色
function draw() {
  var w = C.width / K, h = C.height / K;
  X.setTransform(1, 0, 0, 1, 0, 0);
  X.clearRect(0, 0, C.width, C.height);
  if (w < 40 || h < 40) return;
  X.setTransform(K, 0, 0, K, 0, 0);
  X.textBaseline = 'middle';
  var kk = key(kind, rel), n = rank[kk], u = up[kk], items = list[kk], unit = UNIT[kind];
  // —— 我 ——
  var hy = 22;
  X.fillStyle = 'rgba(255,209,102,0.1)';
  X.fillRect(0, 0, w, 44);
  X.textAlign = 'left';
  X.font = '700 12px sans-serif';
  X.fillStyle = 'rgba(214,236,242,0.6)';
  X.fillText('我', 12, hy);
  var t, c = '#ffd166';
  if (err === 'old') { t = '抖音版本太老，看不了'; c = 'rgba(214,236,242,0.5)'; }
  else if (n === undefined) { t = busy ? '加载中…' : '—'; c = 'rgba(214,236,242,0.5)'; }
  else if (n < 0) { t = '暂时拿不到'; c = 'rgba(214,236,242,0.5)'; }
  else if (n === 0) { t = '还没上榜'; c = 'rgba(214,236,242,0.7)'; }
  else t = '第 ' + fmt(n) + ' 名';
  X.font = '900 18px sans-serif';
  X.fillStyle = c;
  X.fillText(t, 34, hy);
  var tx = 34 + X.measureText(t).width + 10;
  if (u) {
    X.font = '900 14px sans-serif';
    X.fillStyle = '#ffd166';
    X.fillText(u === 'new' ? '新上榜！' : '↑ ' + fmt(u) + ' 名', tx, hy);
  }
  if (mine[kk]) {
    X.textAlign = 'right';
    X.font = '800 13px sans-serif';
    X.fillStyle = 'rgba(234,246,248,0.85)';
    X.fillText(fmt(mine[kk]) + ' ' + unit, w - 12, hy);
  }
  // —— 榜单 ——
  var y0 = 52, rh = 40, rows = Math.max(0, Math.floor((h - y0) / rh));
  if (!items || !items.length) {
    X.textAlign = 'center';
    X.font = '600 13px sans-serif';
    X.fillStyle = 'rgba(214,236,242,0.5)';
    X.fillText(items ? (rel === 'friend' ? '好友里还没人上榜，叫他们来玩' : '还没有人上榜') : (busy ? '加载中…' : ''), w / 2, y0 + 40);
    return;
  }
  for (var i = 0; i < Math.min(rows, items.length); i++) {
    var it = items[i], y = y0 + i * rh + rh / 2, my = me && it.openid === me;
    if (my) { X.fillStyle = 'rgba(255,209,102,0.16)'; X.fillRect(0, y - rh / 2 + 2, w, rh - 4); }
    else if (i % 2) { X.fillStyle = 'rgba(255,255,255,0.03)'; X.fillRect(0, y - rh / 2 + 2, w, rh - 4); }
    X.textAlign = 'center';
    X.font = '900 ' + (i < 3 ? 16 : 13) + 'px sans-serif';
    X.fillStyle = i === 0 ? '#ffd166' : i === 1 ? '#d6e4ea' : i === 2 ? '#e0a46a' : 'rgba(214,236,242,0.6)';
    X.fillText(String(i + 1), 18, y);
    avatar(it.user_img, it.nick_name, 50, y, 14, my);
    X.textAlign = 'left';
    X.font = (my ? '900' : '700') + ' 13px sans-serif';
    X.fillStyle = my ? '#ffd166' : 'rgba(234,246,248,0.9)';
    X.fillText(cut(it.nick_name || '抖音用户', w - 72 - 96), 72, y);
    X.textAlign = 'right';
    X.font = '800 13px sans-serif';
    X.fillStyle = my ? '#ffd166' : '#ffffff';
    X.fillText(fmt(it.value) + ' ' + unit, w - 12, y);
  }
}

tt.onMessage(function (m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'fetch') {
    if (m.base) { fetchAll(true); return; }
    if (m.run !== runId) { runId = m.run; runRef = {}; for (var q in rank) runRef[q] = rank[q]; }
    fetchAll(false, runRef);
  }
  else if (m.t === 'size' || m.t === 'show') {
    if (m.k > 0) K = m.k;
    if (m.kind) kind = m.kind;
    if (m.rel) rel = m.rel;
    draw();
  }
});
