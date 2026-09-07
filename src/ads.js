'use strict';

// Rewards are issued only by an explicit, complete WeChat close event.
// Each attempt owns its listeners so late callbacks cannot reward a later attempt.
function createAds(platform, config) {
  const options = config || {};
  const adUnitId = typeof options.REWARDED_AD_UNIT_ID === 'string' ? options.REWARDED_AD_UNIT_ID.trim() : '';
  const api = platform && platform.wx;
  const configured = /^adunit-[a-zA-Z0-9]+$/.test(adUnitId);
  let pending = null;
  let destroyed = false;
  let activeAd = null;

  function result(reason) { return { rewarded: reason === 'completed', reason }; }
  function isConfigured() {
    return !destroyed && Boolean(platform && platform.kind === 'wechat' && configured && api && typeof api.createRewardedVideoAd === 'function');
  }

  function showRevive() {
    if (destroyed) return Promise.resolve(result('destroyed'));
    if (pending) return Promise.resolve(result('busy'));
    if (!platform || platform.kind !== 'wechat') return Promise.resolve(result('preview'));
    if (!configured) return Promise.resolve(result('unconfigured'));
    if (!api || typeof api.createRewardedVideoAd !== 'function') return Promise.resolve(result('unsupported'));

    let resolvePromise;
    const promise = new Promise(function (resolve) { resolvePromise = resolve; });
    const attempt = { resolve: resolvePromise, settled: false, started: false, timer: null, stage: 'starting', ad: null, close: null, error: null };
    pending = attempt;

    function settle(reason) {
      if (attempt.settled) return;
      attempt.settled = true;
      clearTimeout(attempt.timer);
      const ad = attempt.ad;
      if (ad) {
        try { if (typeof ad.offClose === 'function') ad.offClose(attempt.close); } catch (_) { /* Cleanup only. */ }
        try { if (typeof ad.offError === 'function') ad.offError(attempt.error); } catch (_) { /* Cleanup only. */ }
      }
      if (pending === attempt) pending = null;
      attempt.resolve(result(reason));
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
      // WeChat may return its global singleton. Detach our previous listeners above;
      // never destroy/recreate a component while it is displaying a video.
      activeAd = api.createRewardedVideoAd({ adUnitId });
      if (!activeAd || typeof activeAd.show !== 'function' || typeof activeAd.onClose !== 'function' || typeof activeAd.onError !== 'function') {
        settle('unsupported');
        return promise;
      }
      attempt.ad = activeAd;
      attempt.close = function (event) {
        if (attempt.settled || pending !== attempt || !attempt.started) return;
        settle(event && event.isEnded === true ? 'completed' : 'cancelled');
      };
      attempt.error = function () {
        if (attempt.settled || pending !== attempt) return;
        // The SDK may emit onError and reject show for the same failure. The
        // stage guard in retry ensures that pair starts only one load attempt.
        if (attempt.stage === 'starting') retry();
        else if (attempt.stage === 'playing') settle('error');
        else if (attempt.stage === 'retrying') settle('load-failed');
        else settle('show-failed');
      };
      activeAd.onClose(attempt.close);
      activeAd.onError(attempt.error);
      armTimer(30000, 'timeout');
      function showing() {
        if (attempt.settled) return;
        attempt.stage = 'playing';
        // Allow long videos, end cards and store detours; loading gets a separate,
        // short deadline. Closing or destroy always clears this watchdog.
        armTimer(15 * 60 * 1000, 'timeout');
      }
      function retry() {
        if (attempt.settled || attempt.stage !== 'starting') return;
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
            if (!attempt.settled) { attempt.started = true; return attempt.ad.show(); }
          }).then(function () { if (attempt.stage === 'showing') showing(); }, function () { settle('show-failed'); });
        }, function () { settle('load-failed'); });
      }
      Promise.resolve().then(function () {
        if (!attempt.settled && attempt.stage === 'starting') { attempt.started = true; return attempt.ad.show(); }
      }).then(function () { if (attempt.stage === 'starting') showing(); }, retry);
    } catch (_) { settle('error'); }
    return promise;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (pending) pending.settle('destroyed');
    if (activeAd && typeof activeAd.destroy === 'function') {
      try { activeAd.destroy(); } catch (_) { /* SDK destroy is optional. */ }
    }
    activeAd = null;
  }

  return { isConfigured, showRevive, destroy };
}

module.exports = { createAds };
