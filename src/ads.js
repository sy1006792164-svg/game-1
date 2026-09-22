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
  let preloadAttempt = null;
  let suspended = false;

  function defer(callback) {
    Promise.resolve().then(callback).catch(function () { /* Never leak SDK callback failures. */ });
  }

  function errorText(value, seen) {
    if (typeof value === 'string') return value;
    if (value == null || typeof value !== 'object') return value == null ? '' : String(value);
    seen = seen || new Set();
    if (seen.has(value)) return '';
    seen.add(value);
    const parts = [];
    for (const key of ['errMsg', 'message', 'stack', 'reason', 'error']) {
      try {
        const part = errorText(value[key], seen);
        if (part) parts.push(part);
      } catch (_) { /* Host error wrappers may expose throwing getters. */ }
    }
    return parts.join(' ');
  }

  function isAdSystemError(error) {
    return /operateWXDataForAd|adOperateWXData/i.test(errorText(error));
  }

  function setActive(attempt, active) {
    if (active ? activeAttempt === attempt : activeAttempt !== attempt) return;
    activeAttempt = active ? attempt : null;
    if (typeof onActiveChange === 'function') onActiveChange(active);
  }

  function result(reason) { return { rewarded: reason === 'completed', reason }; }
  function isConfigured() {
    return !destroyed && Boolean(platform && platform.kind === 'wechat' && configured && api && typeof api.createRewardedVideoAd === 'function');
  }

  function detachErrorListener(ad) {
    const listener = errorListener;
    errorListener = null;
    try { if (listener && ad && typeof ad.offError === 'function') ad.offError(listener); } catch (_) { /* Cleanup only. */ }
  }

  function discardAd(ad) {
    if (!ad || activeAd !== ad) return;
    if (preloadAttempt && preloadAttempt.ad === ad) preloadAttempt.finish(false);
    detachErrorListener(ad);
    activeAd = null;
    try { if (typeof ad.destroy === 'function') ad.destroy(); } catch (_) { /* A broken SDK object is already detached. */ }
  }

  function initializeAd() {
    if (!isConfigured()) return 'unsupported';
    try {
      // Retain the prepared object until its video ends. Mini Games default
      // to a global singleton; multiton mode is required so the next video
      // can use an isolated emitter after this one is destroyed.
      if (!activeAd) activeAd = api.createRewardedVideoAd({ adUnitId, multiton: true });
      if (!activeAd || typeof activeAd.show !== 'function' || typeof activeAd.onClose !== 'function' || typeof activeAd.onError !== 'function') {
        discardAd(activeAd);
        return 'unsupported';
      }
      if (!errorListener) {
        const ad = activeAd;
        const listener = function (error) {
          if (destroyed || activeAd !== ad || errorListener !== listener) return;
          const attempt = pending || activeAttempt;
          if (!attempt) {
            // Idle loading can fail too. Retire this native emitter so the
            // next user request can initialize a clean advertisement.
            defer(function () { if (!pending && !activeAttempt && activeAd === ad) discardAd(ad); });
            return;
          }
          if (attempt.ad !== ad || !attempt.error) return;
          const systemError = isAdSystemError(error);
          // Capture the owning attempt now. A synchronous error emitted while
          // registering this listener must remain an idle preload error.
          defer(function () {
            if (!destroyed && activeAd === ad && errorListener === listener) attempt.error(systemError);
          });
        };
        // Automatic preloads also emit errors while no user request is pending.
        // Keep one listener from initialization through destroy; idle errors
        // must neither display an ad nor consume a future revive attempt.
        errorListener = listener;
        try { ad.onError(listener); } catch (error) { detachErrorListener(ad); throw error; }
      }
      return null;
    } catch (_) {
      discardAd(activeAd);
      return 'error';
    }
  }

  // Warming an ad never displays it and never grants a reward. It only reduces
  // the wait after the player's explicit tap; show retains its normal retry.
  function preload() {
    suspended = false;
    if (!isConfigured() || pending || activeAttempt) return Promise.resolve(false);
    if (preloadAttempt) return preloadAttempt.promise;
    if (initializeAd()) return Promise.resolve(false);
    const ad = activeAd;
    if (typeof ad.load !== 'function') return Promise.resolve(false);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const load = { ad, promise, timer: null, finish(success) {
      if (preloadAttempt !== load) return;
      preloadAttempt = null; clearTimeout(load.timer); resolve(success);
    } };
    preloadAttempt = load;
    load.timer = setTimeout(function () {
      load.finish(false);
      if (!pending && !activeAttempt) discardAd(ad);
    }, 30000);
    if (load.timer && typeof load.timer.unref === 'function') load.timer.unref();
    Promise.resolve().then(function () {
      if (preloadAttempt === load && activeAd === ad) return ad.load();
    }).then(function () { load.finish(activeAd === ad && !destroyed && !suspended); }, function () {
      load.finish(false);
      if (!pending && !activeAttempt) discardAd(ad);
    });
    return promise;
  }

  function preloadNext() {
    defer(function () { if (!destroyed && !suspended && !pending && !activeAttempt) preload(); });
  }

  function suspend() {
    suspended = true;
    // Native video playback backgrounds the game too. Its explicit close
    // callback still owns the earned reward, so never destroy a playing ad.
    if (!pending && !activeAttempt) discardAd(activeAd);
  }

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
    const attempt = { resolve: resolvePromise, settled: false, started: false, displayEnded: false, timer: null, stage: 'starting', generation: 1, ad: null, close: null, error: null };
    pending = attempt;

    function detachCloseListener(ad) {
      const close = attempt.close;
      attempt.close = null;
      try { if (close && ad && typeof ad.offClose === 'function') ad.offClose(close); } catch (_) { /* Cleanup only. */ }
    }

    function releaseDisplay() {
      if (attempt.displayEnded) return;
      attempt.displayEnded = true;
      setActive(attempt, false);
    }

    function endDisplay() {
      if (attempt.displayEnded) return;
      detachCloseListener(attempt.ad);
      releaseDisplay();
    }
    attempt.endDisplay = endDisplay;

    function settle(reason) {
      // Commit the result before native cleanup or audio callbacks can reenter.
      if (!attempt.settled) {
        attempt.settled = true;
        clearTimeout(attempt.timer);
        // A new attempt gets its own native emitter, not just a new listener.
        // A delayed duplicate close from this video cannot reward the next one.
        detachCloseListener(attempt.ad);
        discardAd(attempt.ad);
        attempt.ad = null;
        if (pending === attempt) pending = null;
        attempt.resolve(result(reason));
      }
      endDisplay();
      preloadNext();
    }
    attempt.settle = settle;

    function failClosed(reason) {
      if (attempt.settled) return;
      // Quarantine the suspect emitter while this attempt still owns both the
      // pending slot and active lock. Only after native cleanup may callbacks
      // synchronously start a fresh request.
      attempt.settled = true;
      clearTimeout(attempt.timer);
      attempt.started = false;
      const ad = attempt.ad;
      detachCloseListener(ad);
      attempt.ad = null;
      discardAd(ad);
      attempt.generation += 1;
      if (pending === attempt) pending = null;
      try { releaseDisplay(); } finally { attempt.resolve(result(reason)); preloadNext(); }
    }
    attempt.failClosed = failClosed;

    function armTimer(milliseconds, reason) {
      if (attempt.settled) return;
      clearTimeout(attempt.timer);
      attempt.timer = setTimeout(function () { failClosed(reason); }, milliseconds);
      // Node-based acceptance checks should not be kept alive by an abandoned ad.
      if (attempt.timer && typeof attempt.timer.unref === 'function') attempt.timer.unref();
    }

    try {
      function attachAttemptAd(ad) {
        const generation = attempt.generation;
        const close = function (event) {
          if (!attempt.started || attempt.ad !== ad || attempt.close !== close || attempt.generation !== generation) return;
          let completed = false;
          try { completed = !!(event && event.isEnded === true); } catch (_) { /* Treat malformed native events as cancellation. */ }
          defer(function () {
            if (attempt.settled) { endDisplay(); return; }
            if (pending !== attempt || attempt.ad !== ad || attempt.close !== close || attempt.generation !== generation) return;
            settle(completed ? 'completed' : 'cancelled');
          });
        };
        attempt.ad = ad;
        attempt.close = close;
        ad.onClose(close);
      }
      attempt.error = function (systemError) {
        if (attempt.settled) { endDisplay(); return; }
        if (pending !== attempt) return;
        if (systemError) { failClosed('system-error'); return; }
        // The SDK may emit onError and reject show for the same failure. The
        // stage guard in retry ensures that pair starts only one load attempt.
        if (attempt.stage === 'starting') retry();
        else if (attempt.stage === 'playing') failClosed('error');
        else if (attempt.stage === 'retrying') failClosed('load-failed');
        else failClosed('show-failed');
      };
      attachAttemptAd(activeAd);
      armTimer(30000, 'timeout');
      function showing() {
        if (attempt.settled) return;
        attempt.stage = 'playing';
        // Allow long videos, end cards and store detours; loading gets a separate,
        // short deadline. Closing or destroy always clears this watchdog.
        armTimer(platform && platform.isDevelopment ? 60 * 1000 : 15 * 60 * 1000, 'timeout');
      }
      function retry() {
        if (attempt.stage !== 'starting') return;
        if (attempt.settled) { endDisplay(); return; }
        attempt.stage = 'retrying';
        attempt.started = false;
        const failedAd = attempt.ad;
        detachCloseListener(failedAd);
        attempt.ad = null;
        discardAd(failedAd);
        attempt.generation += 1;
        try { setActive(attempt, false); } catch (_) { failClosed('load-failed'); return; }
        if (attempt.settled || destroyed) return;
        const initializationError = initializeAd();
        if (initializationError) { failClosed('load-failed'); return; }
        try { attachAttemptAd(activeAd); } catch (_) { failClosed('load-failed'); return; }
        armTimer(30000, 'timeout');
        if (typeof attempt.ad.load !== 'function') { failClosed('load-failed'); return; }
        Promise.resolve().then(function () {
          if (attempt.settled) return;
          return attempt.ad.load();
        }).then(function () {
          if (attempt.settled) return;
          attempt.stage = 'showing';
          return Promise.resolve().then(function () {
            if (!attempt.settled) { attempt.started = true; setActive(attempt, true); return attempt.ad.show(); }
          }).then(function () { if (attempt.stage === 'showing') showing(); }, function () { failClosed('show-failed'); });
        }, function () { failClosed('load-failed'); });
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
    const ad = activeAd;
    discardAd(ad);
    if (activeAttempt) activeAttempt.endDisplay();
  }

  return { isConfigured, isActive: function () { return activeAttempt !== null; }, preload, suspend,
    showRewarded: showRevive, showRevive, destroy };
}

module.exports = { createAds };
