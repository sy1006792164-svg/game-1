'use strict';

// No privacy listener or local consent flag is installed here. WeChat owns the
// privacy dialog and the visible avatar/nickname button. Public userInfo stays
// in this game session; no login, cloud function or credential is needed.
function createRankingAuthorization(platform, callbacks) {
  const api = platform && platform.kind === 'wechat' && platform.wx;
  const handlers = callbacks || {};
  let state = { status: 'idle', message: '授权头像昵称后即可参与排行榜' };
  let active = false, foreground = true, revision = 0, needsProfile = false, settingsAllowed = false, sessionEnabled = false;
  let flight = null, profileFlight = null, validationFlight = null, button = null, buttonTap = null, buttonVisible = false;
  let rect = null, wantsButton = false;
  let sessionProfile = null, sessionConfirmed = false, profileRevoked = false, checking = false, authSetting = null;
  const cancellations = new Set();

  function getState() {
    return Object.assign({}, state, { enabled: sessionEnabled, canDisplay: sessionConfirmed && !!sessionProfile && !profileRevoked,
      checking, authSetting: authSetting && { ...authSetting }, profile: sessionProfile && { ...sessionProfile }, needsProfile, canOpenSettings: settingsAllowed, hasNativeButton: !!button && buttonVisible });
  }
  function current(token, allowInactive) { return (active || allowInactive === true) && revision === token; }
  function setState(status, message, profileNeeded, allowSettings) {
    state = { status, message }; needsProfile = profileNeeded === true; settingsAllowed = allowSettings === true;
    reconcileButton(); return getState();
  }
  function cancelled() { const error = new Error('CANCELLED'); error.cancelled = true; return error; }
  function check(token) { if (!current(token)) throw cancelled(); }
  function denial(error) { return !!error && /deny|denied|denial|cancel|disagree|auth\s+deny/i.test(error.errMsg || error.message || ''); }
  function runTask(token, start, timeout, allowInactive) {
    return new Promise(function (resolve, reject) {
      let done = false, timer = null;
      function finish(error, result) {
        if (done) return;
        done = true; if (timer) clearTimeout(timer); cancellations.delete(cancel);
        if (!current(token, allowInactive)) reject(cancelled());
        else if (error) reject(error); else resolve(result);
      }
      function cancel() { finish(cancelled()); }
      cancellations.add(cancel);
      if (timeout) timer = setTimeout(function () { finish(new Error('TIMEOUT')); }, timeout);
      if (!current(token, allowInactive)) { cancel(); return; }
      try { start(function (result) { finish(null, result); }, function (error) { finish(error || new Error('REQUEST_FAILED')); }); }
      catch (error) { finish(error || new Error('REQUEST_FAILED')); }
    });
  }
  function native(token, name, options, timeout, allowInactive) {
    return runTask(token, function (resolve, reject) {
      const result = api[name](Object.assign({}, options, { success: resolve, fail: reject }));
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    }, timeout, allowInactive);
  }
  function external(token, action) {
    return runTask(token, function (resolve, reject) { Promise.resolve().then(function () { check(token); return action(); }).then(resolve, reject); }, 20000);
  }
  function destroyButton() {
    const previous = button, listener = buttonTap;
    button = null; buttonTap = null; buttonVisible = false;
    if (!previous) return;
    try { if (typeof previous.offTap === 'function' && listener) previous.offTap(listener); } catch (_) {}
    try { previous.destroy(); } catch (_) {}
  }
  function styleFor(value) {
    return { left: value.left, top: value.top, width: value.width, height: value.height,
      lineHeight: value.height, fontSize: Math.max(10, Math.min(16, Math.round(value.height * .30))),
      borderRadius: Math.min(10, value.height / 4), borderWidth: 1, borderColor: '#4c8a77',
      backgroundColor: '#39796b', color: '#fffdf4', textAlign: 'center' };
  }
  function reconcileButton() {
    const visible = active && foreground && wantsButton && rect && needsProfile;
    if (!visible) {
      if (button && buttonVisible) { try { button.hide(); } catch (_) {} buttonVisible = false; }
      return;
    }
    if (!api || typeof api.createUserInfoButton !== 'function') return;
    const style = styleFor(rect);
    if (!button) {
      const token = revision;
      try {
        button = api.createUserInfoButton({ type: 'text', text: '授权头像昵称并查看', withCredentials: false, lang: 'zh_CN', style });
        if (!button || typeof button.onTap !== 'function' || typeof button.destroy !== 'function') throw new Error('BUTTON_UNAVAILABLE');
        buttonTap = function (result) { handleProfileTap(token, result); };
        button.onTap(buttonTap); buttonVisible = true;
        if (typeof button.show === 'function') button.show();
      } catch (_) {
        destroyButton(); state = { status: 'unavailable', message: '微信授权按钮暂不可用，请更新微信后重试' }; needsProfile = false;
      }
    } else {
      try {
        Object.keys(style).forEach(function (key) { if (button.style[key] !== style[key]) button.style[key] = style[key]; });
        if (!buttonVisible) { button.show(); buttonVisible = true; }
      } catch (_) {
        destroyButton(); state = { status: 'error', message: '授权按钮暂时未能显示，请重新打开排行榜' }; needsProfile = false;
      }
    }
  }
  function publicProfile(result) {
    if (!result || (typeof result.errMsg === 'string' && /:fail|deny|denied|cancel/i.test(result.errMsg))) return null;
    const userInfo = result.userInfo;
    if (!userInfo || typeof userInfo !== 'object' || Array.isArray(userInfo) || typeof userInfo.nickName !== 'string') return null;
    const nickName = Array.from(userInfo.nickName.slice(0, 2048)
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, 20).join('');
    if (!nickName) return null;
    // WeChat avatars use qlogo.cn. Keep only a bounded public image URL; other
    // profile fields, encryptedData, signatures and identifiers are discarded.
    const source = typeof userInfo.avatarUrl === 'string' ? userInfo.avatarUrl : '';
    const avatarUrl = source.length <= 2048 && /^https?:\/\/(?:[a-z0-9-]+\.)*qlogo\.cn\/[^\s#]*$/i.test(source) ? source.replace(/^http:/i, 'https:') : '';
    return { nickName, avatarUrl };
  }
  function notifyReady() {
    if (typeof handlers.onReady === 'function') { try { handlers.onReady({ authSetting: authSetting && { ...authSetting } }); } catch (_) {} }
  }
  async function saveProfile(token, firstResult, refresh) {
    const result = firstResult === undefined ? await native(token, 'getUserInfo', { withCredentials: false, lang: 'zh_CN' }, 20000) : firstResult;
    check(token);
    if (refresh && denial(result)) throw result;
    const profile = publicProfile(result);
    if (refresh && !sessionEnabled) return false;
    if (!profile) { if (!refresh && current(token)) setState('error', '未取得微信头像昵称，请重新授权后重试'); return false; }
    const saved = typeof handlers.onProfile === 'function' ? await external(token, function () { return handlers.onProfile({ ...profile }); }) : true;
    if (saved === false) { if (!refresh && current(token)) setState('error', '头像昵称暂未准备好，请重新打开后重试'); return false; }
    if (!current(token) || refresh && !sessionEnabled) return false;
    sessionProfile = { ...profile };
    if (refresh) return true;
    sessionConfirmed = true; sessionEnabled = true; profileRevoked = false;
    authSetting = Object.assign({}, authSetting, { 'scope.userInfo': true }); destroyButton(); setState('ready', '微信授权已完成'); notifyReady();
    return true;
  }
  function handleProfileTap(token, result) {
    if (!current(token) || !needsProfile || profileFlight) return;
    const failed = !publicProfile(result);
    if (failed) { setState('denied', '你暂未授权头像昵称，可前往微信设置开启，或返回继续游戏', false, true); return; }
    setState('authorizing', '正在读取微信头像昵称…');
    profileFlight = saveProfile(token, result).catch(function (error) {
      if (current(token) && !error.cancelled) setState(denial(error) ? 'denied' : 'error', denial(error) ? '微信头像昵称授权未完成，可前往设置开启' : '头像昵称暂未准备好，请重新打开后重试', false, denial(error));
      return false;
    }).finally(function () { if (current(token)) profileFlight = null; });
  }
  function available() {
    if (!api) { setState('unavailable', '请在微信小游戏中授权并查看排行榜'); return false; }
    if (['requirePrivacyAuthorize', 'getSetting', 'getUserInfo', 'createUserInfoButton'].some(function (name) { return typeof api[name] !== 'function'; })) {
      setState('unavailable', '当前微信版本暂不支持排行榜授权，请更新微信后重试'); return false;
    }
    return true;
  }
  // Invoke only from the player's ranking/retry button. The native privacy API
  // starts synchronously here, before reading the current userInfo permission.
  function open() {
    if (flight) return flight;
    if (profileFlight) return profileFlight.then(getState);
    if (active && settingsAllowed) return openSettings();
    foreground = true;
    if (sessionConfirmed && sessionProfile && !profileRevoked) {
      active = true; destroyButton(); const token = ++revision;
      Array.from(cancellations).forEach(function (cancel) { cancel(); }); validationFlight = null;
      setState('ready', '微信授权已完成');
      flight = revalidate().then(function () {
        if (current(token) && sessionEnabled) {
          notifyReady();
          // Refresh changed public names without delaying cached ranks or
          // reopening the child a second time when the profile arrives.
          saveProfile(token, undefined, true).catch(function (error) {
            if (current(token) && !error.cancelled && denial(error)) {
              sessionEnabled = false; profileRevoked = true;
              authSetting = Object.assign({}, authSetting, { 'scope.userInfo': false });
              setState('denied', '头像昵称权限尚未开启，请前往微信设置授权', false, true);
            }
          });
        }
        return getState();
      }).finally(function () { if (current(token)) flight = null; });
      return flight;
    }
    return authorize();
  }
  function authorize() {
    // First use and explicit recovery still complete the native consent flow.
    sessionConfirmed = false; sessionEnabled = false; active = true; destroyButton();
    authSetting = null; checking = false;
    const token = ++revision;
    Array.from(cancellations).forEach(function (cancel) { cancel(); }); validationFlight = null;
    if (!available()) return Promise.resolve(getState());
    setState('privacy', '请阅读并选择是否同意微信隐私授权');
    flight = (async function () {
      let stage = 'privacy';
      try {
        // A player may read the platform dialog for as long as needed. close()
        // cancels this wait; a background transition must not cancel consent.
        await native(token, 'requirePrivacyAuthorize', {}, 0);
        check(token);
        stage = 'profile'; setState('authorizing', '正在检查微信头像昵称授权…');
        const setting = await native(token, 'getSetting', {}, 20000);
        check(token);
        authSetting = setting && setting.authSetting && typeof setting.authSetting === 'object' && !Array.isArray(setting.authSetting) ? { ...setting.authSetting } : null;
        stage = 'profile';
        if (setting && setting.authSetting && setting.authSetting['scope.userInfo'] === true) {
          setState('authorizing', '正在读取微信头像昵称…'); await saveProfile(token);
        } else if (setting && setting.authSetting && setting.authSetting['scope.userInfo'] === false) {
          setState('denied', '头像昵称权限尚未开启，请前往微信设置授权', false, true);
        } else setState('needs-profile', '点击下方微信按钮，授权使用头像和昵称展示排行榜', true);
      } catch (error) {
        if (current(token) && !error.cancelled) {
          const refused = denial(error);
          setState(refused ? 'denied' : 'error', stage === 'privacy' ?
            (refused ? '你暂未同意隐私授权，可以返回继续游戏，或点击重试' : '微信隐私授权暂未完成，请重新打开后重试') :
            refused ? '微信头像昵称授权未完成，可前往设置开启' : '头像昵称暂未准备好，请重新打开后重试', false, refused && stage === 'profile');
        }
      } finally { if (current(token)) flight = null; }
      return getState();
    })();
    return flight;
  }
  function updateButton(next, options) {
    const requested = typeof options === 'boolean' ? options : !options || options.visible !== false;
    if (next && [next.left, next.top, next.width, next.height].every(Number.isFinite) && next.width > 0 && next.height > 0) {
      rect = { left: next.left, top: next.top, width: next.width, height: next.height }; wantsButton = requested;
    } else { rect = null; wantsButton = false; }
    reconcileButton(); return getState();
  }
  function hide() { foreground = false; reconcileButton(); }
  function show() { foreground = true; reconcileButton(); }
  // Call from a deliberate "go to settings" tap. The native settings API is
  // invoked before any await; returning rechecks privacy and userInfo afresh.
  function openSettings() {
    if (flight) return flight;
    if (!active || !settingsAllowed) return Promise.resolve(getState());
    if (typeof api.openSetting !== 'function') return Promise.resolve(setState('unavailable', '当前微信暂不支持打开授权设置，请更新微信后重试'));
    const token = revision;
    sessionConfirmed = false; sessionEnabled = false;
    checking = false;
    destroyButton(); setState('authorizing', '请在微信设置中允许使用头像昵称');
    flight = native(token, 'openSetting', {}, 0).then(function (result) {
      check(token);
      if (!result || !result.authSetting || result.authSetting['scope.userInfo'] !== true) return setState('denied', '头像昵称权限尚未开启，可再次前往设置，或返回继续游戏', false, true);
      flight = null;
      return authorize();
    }).catch(function (error) {
      if (current(token) && !error.cancelled) setState('denied', '微信授权设置暂未完成，可以点击重试', false, true);
      return getState();
    }).finally(function () { if (current(token)) flight = null; });
    return flight;
  }
  // Foreground refreshes only read existing permissions. A confirmed session
  // can also sync after leaving rankings, so this request may outlive the page.
  // A failed read disables uploads but keeps that session eligible for another
  // read; starting a new explicit authorization discards the old confirmation.
  function revalidate() {
    if (validationFlight) return validationFlight;
    if (!sessionConfirmed || flight || profileFlight) return Promise.resolve(null);
    const token = revision;
    sessionEnabled = false; checking = true;
    validationFlight = native(token, 'getSetting', {}, 20000, true).then(function (result) {
      if (!current(token, true)) throw cancelled();
      if (!result || !result.authSetting || typeof result.authSetting !== 'object' || Array.isArray(result.authSetting)) throw new Error('SETTING_UNAVAILABLE');
      authSetting = { ...result.authSetting };
      sessionEnabled = authSetting['scope.userInfo'] === true;
      profileRevoked = !sessionEnabled;
      if (active) {
        if (sessionEnabled) setState('ready', '微信授权已完成');
        else setState('denied', '头像昵称权限尚未开启，请前往微信设置授权', false, true);
      }
      return { ...authSetting };
    }).catch(function (error) {
      if (current(token, true) && !error.cancelled && active) setState('error', '微信授权状态暂未确认，请点击重试');
      return null;
    }).finally(function () { if (current(token, true)) { validationFlight = null; checking = false; } });
    return validationFlight;
  }
  function close() {
    active = false; revision++; Array.from(cancellations).forEach(function (cancel) { cancel(); });
    flight = null; profileFlight = null; validationFlight = null; checking = false; rect = null; wantsButton = false; destroyButton();
    state = { status: 'idle', message: '授权头像昵称后即可参与排行榜' }; needsProfile = false; settingsAllowed = false;
  }
  function openContract() {
    if (!api || typeof api.openPrivacyContract !== 'function') return Promise.resolve(false);
    return new Promise(function (resolve) {
      try { api.openPrivacyContract({ success: function () { resolve(true); }, fail: function () { resolve(false); } }); }
      catch (_) { resolve(false); }
    });
  }
  return { open, getState, updateButton, hide, show, close, openSettings, openContract, revalidate };
}

module.exports = { createRankingAuthorization };
