'use strict';

const { DEFAULT_KEY, legacyKeyFor, isKVDataList, parseScore, buildRows } = require('./leaderboard-data');
const { createHostedScoreSync } = require('./hosted-score');
const { leaderboardLayout, paintLeaderboard } = require('./leaderboard-view');
const { createRankMotion } = require('./rank-motion');
const { historyKey, createRankHistory } = require('./rank-history');
const CHANNEL = 'wind-letter-friends-v1';

function createOpenDataLeaderboard(api) {
  const canvas = api.getSharedCanvas(), ctx = canvas.getContext('2d');
  let width = 354, height = 400, ratio = 1, visible = false, request = 0, timer = null;
  let key = DEFAULT_KEY, status = 'idle', rows = [], self = null, notice = '';
  let identity = null, refreshing = false, refreshQueued = false, updatedAt = null, hits = [], syncSnapshot = '';
  let suspended = false, cacheOnly = false, syncEnabled = true, frameTimer = null, pointer = null;
  let lastPaintAt = -Infinity;
  let visitBaseline = null, visitSettled = false, observationOk = false, rankChange = null;
  const motion = createRankMotion();
  const history = createRankHistory(api, target => target === key && visible && !suspended && !cacheOnly && status !== 'denied');
  const hostedSync = createHostedScoreSync(api, { key: () => key, canSync: () => syncEnabled && !suspended && !cacheOnly, onChange: sync => {
    const snapshot = sync.status === 'saved' ? key + JSON.stringify(hostedSync.getState().hosted) : '';
    const changed = snapshot && snapshot !== syncSnapshot;
    if (snapshot) syncSnapshot = snapshot;
    if (!visible || suspended || cacheOnly) return;
    if (changed) refresh(true); else { if (sync.status !== 'pending') observeRank(); paint(); }
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
    ctx.fillStyle = '#d6e5dc'; ctx.fillRect(x, y, size, size);
    if (entry && entry.ready) { try { ctx.drawImage(entry.image, x, y, size, size); } catch (_) {} }
    else { ctx.fillStyle = '#5d7469'; ctx.beginPath(); ctx.arc(x + size / 2, y + size * .4, size * .2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function queuePaint() {
    if (!visible || suspended || frameTimer !== null) return;
    const delay = Math.max(1, 16 - (Date.now() - lastPaintAt));
    frameTimer = setTimeout(() => { frameTimer = null; paint(); }, delay);
    if (frameTimer !== null && typeof frameTimer.unref === 'function') frameTimer.unref();
  }
  function requestPaint() {
    if (!visible || suspended) return;
    if (Date.now() - lastPaintAt >= 16) paint();
    else queuePaint();
  }
  function paint() {
    // An immediate data/permission update also satisfies the pending input frame.
    // Keep only one owner of the next draw, including during an inertial scroll.
    if (frameTimer !== null) clearTimeout(frameTimer);
    frameTimer = null;
    lastPaintAt = Date.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hits = [];
    if (!visible || suspended) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    motion.setLayout(leaderboardLayout(width, height), rows.length, Date.now());
    const frame = motion.frame(Date.now());
    hits = paintLeaderboard(ctx, { width, height, status, rows, self, notice, sync: hostedSync.getState(), updatedAt, refreshing,
      scrollOffset: frame.scrollOffset, rankChange, rankMotion: frame.rankMotion && { ...frame.rankMotion, active: true } }, avatar) || [];
    // A captured finger changes the surface only when it moves. Repainting for
    // both touch events and a timer doubled the draw rate and spun while held.
    if (frame.active && (!pointer || frame.rankMotion)) queuePaint();
  }
  function cancelMotion() {
    if (frameTimer !== null) clearTimeout(frameTimer); frameTimer = null; pointer = null; motion.cancel(Date.now());
  }
  function enter() {
    cancelMotion(); motion.enter(Date.now());
    visitBaseline = history.get(key); visitSettled = false; observationOk = false; rankChange = null;
  }
  function observeRank() {
    if (!visible || suspended || cacheOnly || refreshing || refreshQueued || !observationOk || hostedSync.getState().status === 'pending') return;
    const index = rows.findIndex(row => row.isMe);
    if (index < 0 || !self || !Number.isInteger(self.rank) || self.rank < 1) return;
    const baseline = visitBaseline;
    if (!visitSettled) {
      visitSettled = true;
      rankChange = baseline && baseline.rank !== self.rank ? { fromRank: baseline.rank, toRank: self.rank,
        delta: Math.abs(baseline.rank - self.rank), direction: self.rank < baseline.rank ? 'up' : 'down' } : null;
      motion.setLayout(leaderboardLayout(width, height), rows.length, Date.now());
      motion.settle({ fromRank: baseline && baseline.rank, toRank: self.rank, oldIndex: baseline ? baseline.index : index,
        newIndex: index, count: rows.length }, Date.now());
    }
    history.remember(key, { rank: self.rank, index });
  }
  function resize(message) {
    if (Number.isFinite(message.width) && message.width > 0) width = message.width;
    if (Number.isFinite(message.height) && message.height > 0) height = message.height;
    // The main domain already sized sharedCanvas. A second DPR cap
    // would shrink the child content inside that higher-resolution surface.
    if (Number.isFinite(message.pixelRatio) && message.pixelRatio > 0) ratio = message.pixelRatio;
    paint();
  }
  function stop() {
    request++; if (timer) clearTimeout(timer); timer = null;
    refreshing = false; refreshQueued = false; observationOk = false;
  }
  function refresh(afterSave) {
    if (!visible || suspended || cacheOnly || status === 'denied') return;
    // Coalesce reads; a completed upload may request one fresh read.
    if (refreshing) { if (afterSave === true) refreshQueued = true; return; }
    const token = ++request;
    refreshing = true; notice = '';
    if (!rows.length && !self) status = 'loading';
    paint();
    if (typeof api.getFriendCloudStorage !== 'function' || typeof api.getUserCloudStorage !== 'function') {
      refreshing = false; status = rows.length || self ? 'ready' : 'error';
      notice = '好友榜暂时不可用，请更新微信后重试'; paint(); return;
    }
    let friends = null, mine = null, finished = false, ownFailed = false, friendsFailed = false, denied = false;
    const legacyKey = legacyKeyFor(key);
    function active() { return token === request && visible && !denied; }
    function applyData() {
      if (friendsFailed) {
        const own = ownFailed ? null : buildRows([], mine, key, identity).self;
        if (own) self = own;
        notice = rows.length ? '更新未成功，已保留上次成绩' : '好友成绩暂未读取成功，请稍后重试';
      } else {
        const result = buildRows(friends, mine, key, identity);
        rows = result.rows; self = result.self || (ownFailed ? self : null);
        notice = ownFailed ? '本人数据暂未读取成功，可稍后重试' : '';
      }
      status = rows.length ? 'ready' : friendsFailed || ownFailed ? 'error' : self ? 'ready' : 'empty';
      observationOk = !friendsFailed && !ownFailed;
      // Users with only the former key keep their score and republish it under
      // the MP-compatible key after the same friend permission is confirmed.
      if (!ownFailed && legacyKey && !parseScore(mine, key)) {
        const legacyScore = parseScore(mine, legacyKey);
        if (legacyScore) hostedSync.submit(legacyScore);
      }
    }
    function finish() {
      if (finished || !active() || friends === null || mine === null) return;
      finished = true; refreshing = false; clearTimeout(timer); timer = null;
      applyData(); if (!friendsFailed) updatedAt = Date.now(); observeRank(); paint();
      if (refreshQueued) { refreshQueued = false; refresh(); }
    }
    function fail(error, own) {
      if (finished || !active()) return;
      if (error && /auth|deny|denied|permission/i.test(error.errMsg || '')) {
        denied = true; finished = true; syncEnabled = false; hostedSync.pause(); stop(); rows = []; self = null; identity = null; updatedAt = null;
        notice = ''; status = 'denied'; rankChange = null; cancelMotion(); history.pause(); paint(); return;
      }
      if (own) { ownFailed = true; mine = []; }
      else { friendsFailed = true; friends = []; }
      finish();
    }
    function identify(value) {
      if (!active()) return;
      identity = value;
      // Late identity may label rows; never infer it from names or scores.
      if (finished) { applyData(); observeRank(); paint(); }
    }
    timer = setTimeout(function () {
      if (!active() || finished) return;
      if (friends === null) { friends = []; friendsFailed = true; }
      if (mine === null) { mine = []; ownFailed = true; }
      finish();
    }, 12000);
    try {
      try {
        if (typeof api.getUserInfo === 'function') api.getUserInfo({ openIdList: ['selfOpenId'], lang: 'zh_CN',
          success: result => identify(result && Array.isArray(result.data) && result.data[0] || null),
          fail: () => identify(null) });
        else identify(null);
      } catch (_) { identify(null); }
      api.getUserCloudStorage({ keyList: [key, legacyKey, historyKey(key), legacyKey && historyKey(legacyKey)].filter(Boolean), success: function (result) {
        if (!active() || finished) return;
        if (!result || !isKVDataList(result.KVDataList)) { fail(new Error('INVALID_HISTORY_RESPONSE'), true); return; }
        mine = result.KVDataList;
        const previous = history.load(key, mine) || (legacyKey ? history.load(legacyKey, mine) : null);
        if (!visitSettled && !visitBaseline) visitBaseline = previous;
        finish();
      }, fail: error => fail(error, true) });
    } catch (error) { fail(error, true); }
    if (!active() || finished) return;
    try {
      api.getFriendCloudStorage({ keyList: [key, legacyKey].filter(Boolean), success: function (result) {
        if (!active() || finished) return;
        if (!result || !Array.isArray(result.data) || result.data.some(friend =>
          !friend || typeof friend.openid !== 'string' || !isKVDataList(friend.KVDataList))) {
          fail(new Error('INVALID_FRIEND_RESPONSE'), false); return;
        }
        friends = result.data; finish();
      }, fail: error => fail(error, false) });
    } catch (error) { fail(error, false); }
  }
  function requestRefresh() {
    if (!visible || suspended || cacheOnly || refreshing || status === 'denied') return;
    hostedSync.retry(); refresh();
  }
  function tap(x, y) {
    const hit = hits.find(item => x >= item.x && y >= item.y && x < item.x + item.w && y < item.y + item.h);
    if (hit && hit.action === 'retry') requestRefresh();
  }
  function gesture(message) {
    const { phase, x, y } = message;
    if (!['start', 'move', 'end', 'cancel'].includes(phase) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now(), ui = leaderboardLayout(width, height);
    if (phase === 'start') {
      if (x < 0 || x > width || y < 0 || y > height) return;
      const list = y >= ui.listTop && y <= ui.listBottom;
      pointer = { x, y, list, dragged: false };
      if (list) motion.pointer('start', x, y, now); else motion.cancel(now);
    } else if (pointer) {
      const origin = pointer;
      origin.dragged = origin.dragged || Math.hypot(x - origin.x, y - origin.y) > 6;
      if (origin.list && phase !== 'cancel') motion.pointer('move', x, y, now);
      if (phase === 'end' || phase === 'cancel') {
        const clicked = origin.list ? motion.pointer(phase, x, y, now) : phase === 'end' && !origin.dragged;
        pointer = null;
        if (clicked && x >= 0 && x <= width && y >= 0 && y <= height) tap(x, y);
        if (phase === 'cancel') motion.cancel(now);
      }
    } else if (phase === 'cancel') motion.cancel(now, false);
    requestPaint();
  }
  api.onMessage(function (message) {
    if (!message || message.channel !== CHANNEL) return;
    if (typeof message.key === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(message.key) && message.key !== key) {
      history.pause(); hostedSync.pause(); key = message.key; stop(); cancelMotion(); rows = []; self = null; identity = null; notice = ''; status = 'idle'; updatedAt = null; hits = []; enter();
      if (visible && !['open', 'refresh', 'close', 'hide', 'preview'].includes(message.action)) refresh();
    }
    if (message.action === 'submit') { if (syncEnabled && !cacheOnly && !suspended) hostedSync.submit(message.score); return; }
    if (message.action === 'retry') { if (syncEnabled && !cacheOnly && !suspended) hostedSync.retry(); return; }
    if (message.action === 'open') {
      const previewing = visible && cacheOnly;
      visible = true; suspended = false; cacheOnly = false; syncEnabled = true;
      if (!previewing) enter();
      if (status === 'denied') status = 'idle';
      resize(message); requestRefresh();
    }
    else if (message.action === 'preview') {
      stop(); history.pause(); hostedSync.pause(); visible = true; suspended = false; cacheOnly = true; enter(); resize(message);
    }
    else if (message.action === 'resize') resize(message);
    else if (message.action === 'validated') { cacheOnly = false; suspended = false; syncEnabled = true; }
    else if (message.action === 'refresh') {
      if (suspended || cacheOnly) { suspended = false; cacheOnly = false; enter(); }
      requestRefresh();
    }
    else if (message.action === 'hide') { visible = false; stop(); cancelMotion(); history.pause(); paint(); }
    else if (message.action === 'suspend') { suspended = true; stop(); cancelMotion(); history.pause(); hostedSync.pause(); }
    else if (message.action === 'pointer' && visible && !suspended) gesture(message);
    else if (message.action === 'wheel' && visible && !suspended && Number.isFinite(message.delta)) { pointer = null; motion.wheel(message.delta, Date.now()); requestPaint(); }
    else if (message.action === 'scroll' && visible && !suspended && ['start', 'end'].includes(message.edge)) {
      pointer = null; motion.wheel(message.edge === 'end' ? rows.length * leaderboardLayout(width, height).stride : -1e8, Date.now()); requestPaint();
    }
    else if (message.action === 'tap' && visible && !suspended && Number.isFinite(message.x) && Number.isFinite(message.y)) tap(message.x, message.y);
    else if (message.action === 'close') {
      visible = false; suspended = false; cacheOnly = false; syncEnabled = false; stop(); cancelMotion(); history.pause(); hostedSync.pause(); rows = []; self = null; identity = null; updatedAt = null; notice = ''; status = 'idle'; rankChange = null;
      avatars.forEach(entry => { if (entry.image) { entry.image.onload = null; entry.image.onerror = null; } }); avatars.clear(); paint();
    }
  });
}

if (typeof wx !== 'undefined' && typeof wx.getSharedCanvas === 'function') createOpenDataLeaderboard(wx);
module.exports = { createOpenDataLeaderboard };
