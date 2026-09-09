'use strict';

const { DEFAULT_KEY, buildRows } = require('./leaderboard-data');
const { createHostedScoreSync } = require('./hosted-score');
const CHANNEL = 'wind-letter-friends-v1';
const C = { paper: '#112e32', panel: '#203e42', ink: '#f4eddc', muted: '#aec1b8', gold: '#efbd72', green: '#9bcbbc', line: '#426262' };

function createOpenDataLeaderboard(api) {
  const canvas = api.getSharedCanvas(), ctx = canvas.getContext('2d');
  let width = 354, height = 400, ratio = 1, visible = false, request = 0, timer = null;
  let key = DEFAULT_KEY, status = 'idle', page = 0, rows = [], self = null, notice = '';
  let identity = null;
  const hostedSync = createHostedScoreSync(api, { key: () => key, onChange: sync => {
    if (!visible) return;
    if (sync.status === 'saved') refresh(); else paint();
  } });
  const avatars = new Map();
  function avatar(url, x, y, size) {
    let entry = avatars.get(url);
    if (url && !entry && typeof api.createImage === 'function') {
      if (avatars.size >= 64) {
        const oldest = avatars.keys().next().value, image = avatars.get(oldest).image;
        if (image) { image.onload = null; image.onerror = null; }
        avatars.delete(oldest);
      }
      entry = { ready: false }; avatars.set(url, entry);
      try {
        entry.image = api.createImage();
        entry.image.onload = () => { entry.ready = true; if (visible) paint(); };
        entry.image.onerror = () => { entry.ready = false; };
        entry.image.src = url;
      } catch (_) {}
    }
    ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#315859'; ctx.fillRect(x, y, size, size);
    if (entry && entry.ready) { try { ctx.drawImage(entry.image, x, y, size, size); } catch (_) {} }
    else { ctx.fillStyle = C.muted; ctx.beginPath(); ctx.arc(x + size / 2, y + size * .4, size * .2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function text(value, x, y, size, color, align) {
    ctx.fillStyle = color || C.ink;
    ctx.font = (size || 14) + 'px sans-serif';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x, y);
  }
  function fitted(value, maxWidth, size) {
    ctx.font = size + 'px sans-serif';
    const chars = Array.from(String(value));
    if (ctx.measureText(chars.join('')).width <= maxWidth) return chars.join('');
    while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
    return chars.join('') + '…';
  }
  function capacity() { return Math.max(1, Math.floor((height - 132) / 52)); }
  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!visible) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, width, height);
    if (status !== 'ready') {
      const title = status === 'loading' ? '正在读取好友成绩…' : status === 'empty' ? '好友榜还没有成绩' : status === 'denied' ? '尚未允许好友互动' : '暂时无法读取好友榜';
      text(title, width / 2, height * .35, 16, C.ink, 'center');
      const hint = status === 'loading' ? '稍等片刻，信笺正在送达' : status === 'empty' ? '通关并联网同步后，就能一起上榜' : status === 'denied' ? '请关闭后点击授权，或在微信设置中开启' : '检查网络后，点击下方刷新按钮';
      text(hint, width / 2, height * .35 + 32, 12, C.muted, 'center');
      if (status === 'empty') text('仅显示已授权并玩过本游戏的好友', width / 2, height * .35 + 60, 11, C.muted, 'center');
      const sync = hostedSync.getState();
      if (sync.message) text(fitted(sync.message, width - 20, 10), width / 2, height - 18, 10, sync.status === 'error' ? C.gold : C.muted, 'center');
      return;
    }
    const size = capacity(), pages = Math.max(1, Math.ceil(rows.length / size));
    page = Math.max(0, Math.min(pages - 1, page));
    text('名次 / 好友', 12, 19, 12, C.muted);
    text('星星 · 通关 · 步数', width - 12, 19, 12, C.muted, 'right');
    if (!rows.length) text('暂无同玩好友的已上传成绩', width / 2, 98, 13, C.muted, 'center');
    rows.slice(page * size, (page + 1) * size).forEach(function (row, index) {
      const y = 38 + index * 52;
      ctx.fillStyle = row.isMe ? '#294d50' : C.panel; ctx.fillRect(0, y, width, 46);
      text(fitted(row.rank, 36, 13), 22, y + 23, 13, row.rank <= 3 ? C.gold : C.muted, 'center');
      avatar(row.avatarUrl, 44, y + 6, 34);
      const label = row.isMe ? '我 · ' + row.nickname : row.nickname;
      text(fitted(label, Math.max(40, width - 208), 13), 86, y + 23, 13, row.isMe ? C.green : C.ink);
      text(row.stars + ' ★', width - 12, y + 15, 14, C.gold, 'right');
      text(row.completed + ' 关 · ' + row.turns + ' 步', width - 12, y + 33, 10, C.muted, 'right');
    });
    const footer = height - 81;
    ctx.fillStyle = C.line; ctx.fillRect(0, footer, width, 1);
    if (self) avatar(self.avatarUrl, 10, footer + 7, 28);
    text(self ? self.rank ? '我的名次  ' + self.rank : '我的最佳成绩' : '我还没有同步的通关成绩', self ? 46 : 10, footer + 20, 12, self ? C.green : C.muted);
    if (self) text(self.stars + ' ★ · ' + self.completed + ' 关', width - 10, footer + 20, 12, C.gold, 'right');
    text(rows.length ? (page + 1) + ' / ' + pages + ' 页 · 共 ' + rows.length + ' 人' : '本人成绩单独展示', width / 2, footer + 45, 12, C.muted, 'center');
    const sync = hostedSync.getState();
    text(fitted(sync.message || notice || '星星优先；同星比通关，再比更少步数', width - 20, 10), width / 2, height - 12, 10, sync.status === 'error' ? C.gold : C.muted, 'center');
  }
  function resize(message) {
    if (Number.isFinite(message.width) && message.width > 0) width = Math.min(2048, message.width);
    if (Number.isFinite(message.height) && message.height > 0) height = Math.min(2048, message.height);
    ratio = Number.isFinite(message.pixelRatio) && message.pixelRatio > 0 ? Math.min(2, message.pixelRatio) : 1;
    paint();
  }
  function stop() { request++; if (timer) clearTimeout(timer); timer = null; }
  function refresh() {
    stop();
    if (!visible) return;
    const token = request;
    status = 'loading'; notice = ''; paint();
    if (typeof api.getFriendCloudStorage !== 'function' || typeof api.getUserCloudStorage !== 'function') {
      status = 'error'; paint(); return;
    }
    let friends = null, mine = null, finished = false, ownFailed = false, identityDone = false;
    function fail(error) {
      if (finished || token !== request || !visible) return;
      finished = true; clearTimeout(timer); timer = null;
      status = error && /auth|deny|denied|permission/i.test(error.errMsg || '') ? 'denied' : 'error'; paint();
    }
    function finish() {
      if (finished || token !== request || !visible || friends === null || mine === null || !identityDone) return;
      finished = true; clearTimeout(timer); timer = null;
      if (key.endsWith('_development')) console.info('[friend-rank-check]', JSON.stringify({
        ownIdKind: !identity || !identity.openId ? 'missing' : identity.openId === 'selfOpenId' ? 'sentinel' : 'native',
        friendRecords: friends.length,
        ownIdMatches: identity ? friends.filter(item => item && item.openid === identity.openId).length : 0
      }));
      const result = buildRows(friends, mine, key, identity);
      rows = result.rows; self = result.self;
      notice = ownFailed ? '本人数据暂未读取成功，可点击刷新重试' : '';
      status = rows.length || self ? 'ready' : ownFailed ? 'error' : 'empty'; paint();
    }
    timer = setTimeout(function () {
      if (!identityDone && friends !== null && mine !== null) { identity = null; identityDone = true; finish(); }
      else fail({ errMsg: 'timeout' });
    }, 12000);
    try {
      try {
        if (typeof api.getUserInfo === 'function') api.getUserInfo({ openIdList: ['selfOpenId'], lang: 'zh_CN',
          success: result => {
            if (token !== request || !visible || finished) return;
            identity = result && Array.isArray(result.data) && result.data[0] || null; identityDone = true; finish();
          },
          fail: () => { if (token !== request || !visible || finished) return; identity = null; identityDone = true; finish(); } });
        else { identity = null; identityDone = true; }
      } catch (_) { identity = null; identityDone = true; }
      api.getUserCloudStorage({ keyList: [key], success: function (result) { mine = result && result.KVDataList || []; finish(); }, fail: function () { ownFailed = true; mine = []; finish(); } });
      api.getFriendCloudStorage({ keyList: [key], success: function (result) { friends = result && Array.isArray(result.data) ? result.data : []; finish(); }, fail });
    } catch (error) { fail(error); }
  }
  api.onMessage(function (message) {
    if (!message || message.channel !== CHANNEL) return;
    if (typeof message.key === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(message.key) && message.key !== key) {
      key = message.key; stop(); rows = []; self = null; identity = null; page = 0; notice = ''; status = 'idle';
      if (visible && !['open', 'refresh', 'close'].includes(message.action)) refresh();
    }
    if (message.action === 'submit') { hostedSync.submit(message.score); return; }
    if (message.action === 'retry') { hostedSync.retry(); return; }
    if (message.action === 'open') { visible = true; page = 0; resize(message); hostedSync.retry(); refresh(); }
    else if (message.action === 'resize') resize(message);
    else if (message.action === 'refresh' && visible) { hostedSync.retry(); refresh(); }
    else if (message.action === 'page' && visible && status === 'ready') { page += message.delta > 0 ? 1 : -1; paint(); }
    else if (message.action === 'close') {
      visible = false; stop(); rows = []; self = null; identity = null;
      avatars.forEach(entry => { if (entry.image) { entry.image.onload = null; entry.image.onerror = null; } }); avatars.clear(); paint();
    }
  });
}

// WeChat loads this entry independently because game.json points here.
if (typeof wx !== 'undefined' && typeof wx.getSharedCanvas === 'function') createOpenDataLeaderboard(wx);
module.exports = { createOpenDataLeaderboard };
