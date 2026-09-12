'use strict';

// Rewards are issued only by an explicit, complete WeChat close event.
// Each attempt owns its close listener so late callbacks cannot reward a later attempt.
function createAds(platform, config, onActiveChange) {
  const options = config || {};
  const adUnitId = typeof options.REWARDED_AD_UNIT_ID === 'string' ? options.REWARDED_AD_UNIT_ID.trim() : '';
  const api = platform && platform.wx;
  const configured = /^adunit-[a-zA-Z0-9]+$/.test(adUnitId);
  let pending = null;
  let destroyed = false;
  let activeAd = null;
  let activeAttempt = null;
  let errorListener = null;

  function setActive(attempt, active) {
    if (active ? activeAttempt === attempt : activeAttempt !== attempt) return;
    activeAttempt = active ? attempt : null;
    if (typeof onActiveChange === 'function') onActiveChange(active);
  }

  function result(reason) { return { rewarded: reason === 'completed', reason }; }
  function isConfigured() {
    return !destroyed && Boolean(platform && platform.kind === 'wechat' && configured && api && typeof api.createRewardedVideoAd === 'function');
  }

  function detachErrorListener() {
    const listener = errorListener;
    errorListener = null;
    try { if (listener && activeAd && typeof activeAd.offError === 'function') activeAd.offError(listener); } catch (_) { /* Cleanup only. */ }
  }

  function initializeAd() {
    if (!isConfigured()) return 'unsupported';
    try {
      // Reuse the SDK singleton for the lifetime of this game instance.
      if (!activeAd) activeAd = api.createRewardedVideoAd({ adUnitId });
      if (!activeAd || typeof activeAd.show !== 'function' || typeof activeAd.onClose !== 'function' || typeof activeAd.onError !== 'function') return 'unsupported';
      if (!errorListener) {
        const ad = activeAd;
        const listener = function () {
          if (destroyed || activeAd !== ad || errorListener !== listener) return;
          const attempt = pending || activeAttempt;
          if (attempt && attempt.ad === ad && attempt.error) attempt.error();
        };
        // Automatic preloads also emit errors while no user request is pending.
        // Keep one listener from initialization through destroy; idle errors
        // must neither display an ad nor consume a future revive attempt.
        errorListener = listener;
        try { ad.onError(listener); } catch (error) { detachErrorListener(); throw error; }
      }
      return null;
    } catch (_) { return 'error'; }
  }

  // Prepare at startup without showing an ad or taking the game's audio lock.
  // If the SDK is not ready yet, the next user request can retry initialization.
  initializeAd();

  function showRevive() {
    if (destroyed) return Promise.resolve(result('destroyed'));
    if (pending || activeAttempt) return Promise.resolve(result('busy'));
    if (!platform || platform.kind !== 'wechat') return Promise.resolve(result('preview'));
    if (!configured) return Promise.resolve(result('unconfigured'));
    if (!api || typeof api.createRewardedVideoAd !== 'function') return Promise.resolve(result('unsupported'));
    const initializationError = initializeAd();
    if (initializationError) return Promise.resolve(result(initializationError));

    let resolvePromise;
    const promise = new Promise(function (resolve) { resolvePromise = resolve; });
    const attempt = { resolve: resolvePromise, settled: false, started: false, displayEnded: false, timer: null, stage: 'starting', ad: null, close: null, error: null };
    pending = attempt;

    function endDisplay() {
      if (attempt.displayEnded) return;
      attempt.displayEnded = true;
      const ad = attempt.ad;
      if (ad) {
        try { if (typeof ad.offClose === 'function') ad.offClose(attempt.close); } catch (_) { /* Cleanup only. */ }
      }
      setActive(attempt, false);
    }
    attempt.endDisplay = endDisplay;

    function settle(reason) {
      // Commit the result before native cleanup or audio callbacks can reenter.
      if (!attempt.settled) {
        attempt.settled = true;
        clearTimeout(attempt.timer);
        if (pending === attempt) pending = null;
        attempt.resolve(result(reason));
      }
      // A watchdog cannot close a native video. Keep its audio lock and listeners
      // until the SDK confirms closure/failure, even after denying the reward.
      if (reason !== 'timeout' || !attempt.started) endDisplay();
    }
    attempt.settle = settle;

    function armTimer(milliseconds, reason) {
      if (attempt.settled) return;
      clearTimeout(attempt.timer);
      attempt.timer = setTimeout(function () { settle(reason); }, milliseconds);
      // Node-based acceptance checks should not be kept alive by an abandoned ad.
      if (attempt.timer && typeof attempt.timer.unref === 'function') attempt.timer.unref();
    }

    try {
      attempt.ad = activeAd;
      attempt.close = function (event) {
        if (!attempt.started) return;
        if (attempt.settled) { endDisplay(); return; }
        if (pending !== attempt) return;
        settle(event && event.isEnded === true ? 'completed' : 'cancelled');
      };
      attempt.error = function () {
        if (attempt.settled) { endDisplay(); return; }
        if (pending !== attempt) return;
        // The SDK may emit onError and reject show for the same failure. The
        // stage guard in retry ensures that pair starts only one load attempt.
        if (attempt.stage === 'starting') retry();
        else if (attempt.stage === 'playing') settle('error');
        else if (attempt.stage === 'retrying') settle('load-failed');
        else settle('show-failed');
      };
      activeAd.onClose(attempt.close);
      armTimer(30000, 'timeout');
      function showing() {
        if (attempt.settled) return;
        attempt.stage = 'playing';
        // Allow long videos, end cards and store detours; loading gets a separate,
        // short deadline. Closing or destroy always clears this watchdog.
        armTimer(15 * 60 * 1000, 'timeout');
      }
      function retry() {
        if (attempt.stage !== 'starting') return;
        if (attempt.settled) { endDisplay(); return; }
        setActive(attempt, false);
        if (typeof attempt.ad.load !== 'function') { settle('load-failed'); return; }
        attempt.stage = 'retrying';
        attempt.started = false;
        Promise.resolve().then(function () {
          if (attempt.settled) return;
          return attempt.ad.load();
        }).then(function () {
          if (attempt.settled) return;
          attempt.stage = 'showing';
          return Promise.resolve().then(function () {
            if (!attempt.settled) { attempt.started = true; setActive(attempt, true); return attempt.ad.show(); }
          }).then(function () { if (attempt.stage === 'showing') showing(); }, function () { settle('show-failed'); });
        }, function () { settle('load-failed'); });
      }
      Promise.resolve().then(function () {
        if (!attempt.settled && attempt.stage === 'starting') { attempt.started = true; setActive(attempt, true); return attempt.ad.show(); }
      }).then(function () { if (attempt.stage === 'starting') showing(); }, retry);
    } catch (_) { settle('error'); }
    return promise;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (pending) pending.settle('destroyed');
    detachErrorListener();
    if (activeAd && typeof activeAd.destroy === 'function') {
      try { activeAd.destroy(); } catch (_) { /* SDK destroy is optional. */ }
    }
    if (activeAttempt) activeAttempt.endDisplay();
    activeAd = null;
  }

  return { isConfigured, isActive: function () { return activeAttempt !== null; }, showRewarded: showRevive, showRevive, destroy };
}

module.exports = { createAds };
