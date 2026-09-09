'use strict';

// Only our own local aggregate enters the isolated open data context. Native
// hosted reads/merges/writes and WeChat friend identities stay inside it.
const FRIEND_STORAGE_KEY = 'wind_letter_rank_v1';
const CHANNEL = 'wind-letter-friends-v1';
const FRIEND_SCOPE = 'scope.WxFriendInteraction';

function verifiedScore(value) {
  if (!value || typeof value !== 'object') return null;
  const stars = value.stars, completed = value.completed, turns = value.turns;
  if (![stars, completed, turns].every(Number.isSafeInteger) || completed < 1 || completed > 999 ||
      stars < completed || stars > completed * 3 || turns < completed || turns > 99900000) return null;
  return { v: 2, stars, completed, turns,
    avatarUrl: typeof value.avatarUrl === 'string' && /^https:\/\/(?:[a-z0-9-]+\.)*qlogo\.cn\//.test(value.avatarUrl) && value.avatarUrl.length <= 1024 ? value.avatarUrl : '',
    name: typeof value.name === 'string' ? Array.from(value.name).slice(0, 24).join('') : '送信人' };
}

function createFriendLeaderboard(platform, config, options) {
  const api = platform && platform.kind === 'wechat' && platform.wx;
  const canSync = options && typeof options.canSync === 'function' ? options.canSync : function () { return false; };
  const canShow = options && typeof options.canShow === 'function' ? options.canShow : function () { return true; };
  const key = (config && config.FRIEND_LEADERBOARD_KEY || FRIEND_STORAGE_KEY) + (platform && platform.isDevelopment ? '_development' : '');
  let state = { status: 'idle', message: '授权后可查看同玩好友的成绩' };
  let context = null, visible = false, authorized = false, revision = 0, cancelAuthorization = null, pendingShow = null;
  let dimensions = { width: 354, height: 400, pixelRatio: 1 };
  let desired = null, desiredScore = null, dispatched = '';
  let syncStatus = 'idle', syncMessage = '';

  function setState(status, message) { state = { status, message }; return getState(); }
  function getState() { return Object.assign({}, state, { syncStatus, syncMessage, syncPending: !!desired && desired !== dispatched }); }
  function syncAllowed() { try { return authorized && canSync() === true; } catch (_) { return false; } }
  function available() {
    if (!api) { setState('unavailable', '请在微信小游戏中查看好友榜'); return false; }
    if (typeof api.getOpenDataContext !== 'function' || typeof api.authorize !== 'function') {
      setState('unavailable', '当前微信版本暂不支持好友榜\n请更新微信后重试'); return false;
    }
    return true;
  }
  function post(action, extra) {
    if (!context) return false;
    try { context.postMessage(Object.assign({ channel: CHANNEL, action, key }, extra)); return true; }
    catch (_) { setState('error', '好友榜暂时未能打开\n请稍后重试'); return false; }
  }
  function resize(next) {
    next = next || {};
    const width = Number.isFinite(next.width) && next.width > 0 ? Math.min(2048, next.width) : dimensions.width;
    const height = Number.isFinite(next.height) && next.height > 0 ? Math.min(2048, next.height) : dimensions.height;
    const ratio = Number.isFinite(next.pixelRatio) && next.pixelRatio > 0 ? next.pixelRatio : dimensions.pixelRatio;
    const pixelRatio = Math.min(2, ratio, Math.sqrt(2 * 1024 * 1024 / (width * height)));
    const changed = width !== dimensions.width || height !== dimensions.height || pixelRatio !== dimensions.pixelRatio;
    dimensions = { width, height, pixelRatio };
    if (context && context.canvas) {
      const backingWidth = Math.max(1, Math.floor(width * dimensions.pixelRatio));
      const backingHeight = Math.max(1, Math.floor(height * dimensions.pixelRatio));
      const backingChanged = context.canvas.width !== backingWidth || context.canvas.height !== backingHeight;
      if (context.canvas.width > backingWidth) context.canvas.width = backingWidth;
      if (context.canvas.height !== backingHeight) context.canvas.height = backingHeight;
      if (context.canvas.width !== backingWidth) context.canvas.width = backingWidth;
      if (visible && authorized && (changed || backingChanged)) post('resize', dimensions);
    }
    return getState();
  }
  function show(token) {
    if (!visible || token !== revision) return getState();
    try {
      if (canShow() !== true) { pendingShow = token; return setState('waiting', '返回游戏并确认授权后显示好友榜'); }
      pendingShow = null;
      context = context || api.getOpenDataContext();
      if (!context || !context.canvas || typeof context.postMessage !== 'function') throw new Error('unsupported');
      authorized = true;
      resize(dimensions);
      if (post('open', dimensions)) { setState('ready', '好友数据仅在微信开放数据域展示'); flush(); }
    } catch (_) { setState('unavailable', '好友榜尚未就绪\n请更新微信或稍后重试'); }
    return getState();
  }
  // Call only from the player's explicit "view friends" / "authorize" click.
  function open(next) {
    if (cancelAuthorization) cancelAuthorization();
    visible = true; authorized = false; pendingShow = null;
    resize(next);
    if (!available()) return Promise.resolve(getState());
    const token = ++revision;
    // Recheck even after a previous visit: permission may have been revoked in
    // WeChat settings. authorize does not prompt again while permission remains.
    const useSettings = state.status === 'denied' && typeof api.openSetting === 'function';
    setState('authorizing', '正在获取好友榜授权…');
    return new Promise(function (resolve) {
      let done = false;
      function finish(ok, message) {
        if (done) return;
        done = true;
        cancelAuthorization = null;
        if (!visible || token !== revision) { resolve(getState()); return; }
        if (ok) resolve(show(token));
        else { authorized = false; resolve(setState('denied', message || '尚未允许好友互动\n点击授权按钮可前往设置开启')); }
      }
      // System authorization may remain open while the player reads it.
      cancelAuthorization = function () { done = true; cancelAuthorization = null; resolve(getState()); };
      try {
        if (useSettings) api.openSetting({
          success: function (result) { finish(!!(result && result.authSetting && result.authSetting[FRIEND_SCOPE])); },
          fail: function () { finish(false); },
        });
        else api.authorize({ scope: FRIEND_SCOPE, success: function () { finish(true); }, fail: function () { finish(false); } });
      } catch (_) { finish(false, '暂时无法获取授权，请更新微信后重试'); }
    });
  }
  function refresh() {
    if (!syncAllowed()) return false;
    flush();
    if (visible && authorized && state.status === 'ready') return post('refresh');
    return post('retry');
  }
  // Apply a read-only settings check after returning from the background.
  // An authorization dialog already in progress must settle on its own.
  function revalidate(settings) {
    if (settings && cancelAuthorization) return false;
    if (!settings || settings[FRIEND_SCOPE] !== true) {
      revision++; pendingShow = null;
      if (cancelAuthorization) cancelAuthorization();
      authorized = false; post('close');
      setState(settings ? 'denied' : 'idle', settings ? '好友互动权限尚未开启\n点击授权按钮可前往设置开启' : '授权后可查看同玩好友的成绩');
      return false;
    }
    if (pendingShow !== null) return show(pendingShow).status === 'ready';
    if (!context) return false;
    const wasAuthorized = authorized;
    authorized = true;
    if (visible) {
      if (!wasAuthorized && !post('open', dimensions)) return false;
      setState('ready', '好友数据仅在微信开放数据域展示');
    }
    return true;
  }
  function retry() { if (!syncAllowed()) return false; flush(); return post('retry'); }
  function page(delta) {
    if (visible && authorized && state.status === 'ready' && Number.isFinite(delta) && delta !== 0) {
      return post('page', { delta: delta > 0 ? 1 : -1 });
    }
    return false;
  }
  function close() { visible = false; revision++; pendingShow = null; if (cancelAuthorization) cancelAuthorization(); post('close'); }
  function draw(ctx, x, y, width, height) {
    if (!visible || state.status !== 'ready' || !context || !context.canvas) return false;
    try { ctx.drawImage(context.canvas, x, y, width, height); return true; }
    catch (_) { setState('error', '好友榜画面暂时不可用，请重试'); return false; }
  }
  // Deliver to the child, whose canvas reports actual synchronization status.
  // The child first reads hosted history so an older device cannot downgrade it.
  function flush() {
    if (!desired || !syncAllowed() || !context) return false;
    if (desired === dispatched) return true;
    if (!post('submit', { score: desiredScore })) { syncStatus = 'error'; syncMessage = '成绩暂未交给微信，请刷新重试'; return false; }
    dispatched = desired; syncStatus = 'delegated'; syncMessage = '';
    return true;
  }
  function submit(value) {
    const score = verifiedScore(value);
    if (!score) return Promise.resolve(false);
    if (desiredScore &&
        (score.stars < desiredScore.stars || (score.stars === desiredScore.stars &&
          (score.completed < desiredScore.completed || (score.completed === desiredScore.completed && score.turns > desiredScore.turns))))) {
      desiredScore = Object.assign({}, desiredScore, { name: score.name, avatarUrl: score.avatarUrl || desiredScore.avatarUrl });
    } else {
      desiredScore = score;
    }
    desired = JSON.stringify(desiredScore);
    if (desired !== dispatched) { syncStatus = 'pending'; syncMessage = '完成授权后同步好友成绩'; }
    return Promise.resolve(flush());
  }
  return { open, resize, refresh, retry, revalidate, page, close, submit, getState, draw };
}

module.exports = { createFriendLeaderboard, FRIEND_STORAGE_KEY };
