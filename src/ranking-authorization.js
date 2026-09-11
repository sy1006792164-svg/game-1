'use strict';

// WeChat owns consent. Friend identities stay in the open data domain and
// scope.WxFriendInteraction is requested by friend-leaderboard.
function createRankingAuthorization(platform, callbacks) {
  const api = platform && platform.kind === 'wechat' && platform.wx;
  const handlers = callbacks || {};
  let state = { status: 'idle', message: '同意微信隐私授权后即可查看排行榜' };
  let active = false, foreground = true, revision = 0;
  let sessionConfirmed = false, privacyRevoked = false, sessionEnabled = false;
  let checking = false, authSetting = null;
  let flight = null, validationFlight = null;
  const cancellations = new Set();

  function getState() {
    return Object.assign({}, state, {
      enabled: sessionEnabled,
      canDisplay: sessionConfirmed && !privacyRevoked,
      checking,
      authSetting: authSetting && { ...authSetting },
      // Compatibility fields for the existing view and resume coordinator.
      // Public profile data is supplied by WeChat inside the open data domain.
      profile: null,
      needsProfile: false,
      canOpenSettings: false,
      hasNativeButton: false,
    });
  }
  function current(token, allowInactive) { return (active || allowInactive === true) && revision === token; }
  function setState(status, message) { state = { status, message }; return getState(); }
  function cancelled() { const error = new Error('CANCELLED'); error.cancelled = true; return error; }
  function check(token) { if (!current(token)) throw cancelled(); }
  function denial(error) { return !!error && /deny|denied|denial|cancel|disagree|auth\s+deny/i.test(error.errMsg || error.message || ''); }
  function cancelPending() { Array.from(cancellations).forEach(function (cancel) { cancel(); }); }
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
  function settingsOf(result) {
    const settings = result && result.authSetting;
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...settings } : null;
  }
  function notifyReady() {
    if (typeof handlers.onReady === 'function') {
      try { handlers.onReady({ authSetting: authSetting && { ...authSetting } }); } catch (_) {}
    }
  }
  function available() {
    if (!api) { setState('unavailable', '请在微信小游戏中授权并查看排行榜'); return false; }
    if (['requirePrivacyAuthorize', 'getSetting'].some(function (name) { return typeof api[name] !== 'function'; })) {
      setState('unavailable', '当前微信版本暂不支持排行榜授权，请更新微信后重试'); return false;
    }
    return true;
  }

  // Privacy requests must start directly from the player's ranking/retry tap.
  function open() {
    if (flight) return flight;
    foreground = true;
    if (sessionConfirmed && !privacyRevoked) {
      active = true;
      const token = ++revision;
      cancelPending(); validationFlight = null;
      setState('ready', '微信隐私授权已完成');
      flight = revalidate().then(function () {
        if (current(token) && sessionEnabled) notifyReady();
        return getState();
      }).finally(function () { if (current(token)) flight = null; });
      return flight;
    }
    return authorize();
  }
  function authorize() {
    sessionEnabled = false; active = true; authSetting = null; checking = false;
    const token = ++revision;
    cancelPending(); validationFlight = null;
    if (!available()) return Promise.resolve(getState());
    setState('privacy', '请阅读并选择是否同意微信隐私授权');
    flight = (async function () {
      let privacyAccepted = false;
      try {
        // Consent has no timeout; only closing the page cancels it.
        await native(token, 'requirePrivacyAuthorize', {}, 0);
        check(token);
        privacyAccepted = true; sessionConfirmed = true; privacyRevoked = false;
        setState('authorizing', '正在确认好友榜权限…');
        const settings = settingsOf(await native(token, 'getSetting', {}, 20000));
        check(token);
        if (!settings) throw new Error('SETTING_UNAVAILABLE');
        authSetting = settings; sessionEnabled = true;
        setState('ready', '微信隐私授权已完成'); notifyReady();
      } catch (error) {
        if (current(token) && !error.cancelled) {
          if (!privacyAccepted) {
            sessionConfirmed = false; privacyRevoked = denial(error); authSetting = null;
            setState(denial(error) ? 'denied' : 'error', denial(error) ?
              '你暂未同意隐私授权，可以返回继续游戏，或点击重试' : '微信隐私授权暂未完成，请重新打开后重试');
          } else {
            sessionEnabled = false;
            setState('error', '微信授权状态暂未确认，请点击重试');
          }
        }
      } finally { if (current(token)) flight = null; }
      return getState();
    })();
    return flight;
  }

  // Retained as no-op compatibility methods until the profile-button view code
  // is removed. They never construct or open native user profile controls.
  function updateButton() { return getState(); }
  function openSettings() { return Promise.resolve(getState()); }
  function hide() {
    foreground = false;
    // A cold restore must not complete after the game has entered background.
    // Explicit system consent dialogs are allowed to return normally.
    if (!sessionConfirmed && validationFlight) {
      revision++; cancelPending(); validationFlight = null; checking = false;
    }
  }
  function show() { foreground = true; }

  // Read-only checks may outlive the ranking page. Failure disables writes but
  // keeps a previously confirmed cached list visible until a definitive revoke.
  function revalidate() {
    if (validationFlight) return validationFlight;
    if (flight) return Promise.resolve(null);
    if (!sessionConfirmed) return restore();
    const token = revision;
    sessionEnabled = false; checking = true;
    // Retain both outcomes: a failed request must not hide an explicit privacy
    // revocation returned by the other request or leak a callback into a retry.
    const outcome = task => task.then(value => ({ value }), error => ({ error }));
    const privacy = typeof api.getPrivacySetting === 'function' ?
      native(token, 'getPrivacySetting', {}, 20000, true) : Promise.resolve(null);
    validationFlight = Promise.all([
      outcome(native(token, 'getSetting', {}, 20000, true)),
      outcome(privacy),
    ]).then(function ([settingResult, privacyResult]) {
      if (!current(token, true)) throw cancelled();
      const privacySetting = privacyResult.value;
      if (privacySetting && privacySetting.needAuthorization === true) {
        sessionConfirmed = false; privacyRevoked = true; authSetting = null;
        if (active) setState('denied', '微信隐私授权需要重新确认，请点击重试');
        return null;
      }
      if (settingResult.error || privacyResult.error) throw settingResult.error || privacyResult.error;
      if (typeof api.getPrivacySetting === 'function' &&
          (!privacySetting || privacySetting.needAuthorization !== false)) throw new Error('PRIVACY_UNAVAILABLE');
      const settings = settingsOf(settingResult.value);
      if (!settings) throw new Error('SETTING_UNAVAILABLE');
      authSetting = settings; sessionConfirmed = true; privacyRevoked = false; sessionEnabled = true;
      if (active) setState('ready', '微信隐私授权已完成');
      return { ...authSetting };
    }).catch(function (error) {
      if (current(token, true) && !error.cancelled && active) setState('error', '微信授权状态暂未确认，请点击重试');
      return null;
    }).finally(function () {
      if (current(token, true)) { validationFlight = null; checking = false; }
    });
    return validationFlight;
  }

  // Cold launches recover existing privacy consent without opening a dialog.
  // The returned setting snapshot is interpreted by friend-leaderboard.
  function restore() {
    if (!foreground || active || privacyRevoked || !api ||
        ['getPrivacySetting', 'getSetting'].some(name => typeof api[name] !== 'function')) return Promise.resolve(null);
    const token = revision;
    checking = true;
    validationFlight = (async function () {
      const privacy = await native(token, 'getPrivacySetting', {}, 20000, true);
      if (!privacy || privacy.needAuthorization !== false) {
        if (privacy && privacy.needAuthorization === true) privacyRevoked = true;
        return null;
      }
      const settings = settingsOf(await native(token, 'getSetting', {}, 20000, true));
      if (!settings || !current(token, true) || !foreground) return null;
      authSetting = settings; sessionConfirmed = true; privacyRevoked = false; sessionEnabled = true;
      return { ...authSetting };
    })().catch(function () { return null; }).finally(function () {
      if (current(token, true)) { validationFlight = null; checking = false; }
    });
    return validationFlight;
  }
  function close() {
    active = false; revision++; cancelPending();
    flight = null; validationFlight = null; checking = false;
    state = { status: 'idle', message: '同意微信隐私授权后即可查看排行榜' };
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
