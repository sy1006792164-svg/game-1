'use strict';

const { cleanScore, parseScore, mergeScores, serializeScore, DEFAULT_KEY } = require('./leaderboard-data');

// The read and write APIs run together in the open data domain. Keeping the
// better complete aggregate protects hosted history from an older local save;
// without a per-level database it cannot combine independent device progress.
function createHostedScoreSync(api, options) {
  const settings = options || {};
  const getKey = typeof settings.key === 'function' ? settings.key : () => DEFAULT_KEY;
  const changed = typeof settings.onChange === 'function' ? settings.onChange : () => {};
  const stores = new Map();
  function current() {
    const key = getKey();
    if (!stores.has(key)) stores.set(key, createStorageKeySync(api, key, state => {
      if (getKey() === key) changed(state);
    }));
    return stores.get(key);
  }
  return { submit: value => current().submit(value), retry: () => current().retry(), getState: () => current().getState() };
}

// Pending work, cached history and late-write repair all belong to the key
// where they started. Switching environments must never migrate an aggregate.
function createStorageKeySync(api, key, changed) {
  let desired = null, generation = 0, flight = null, status = 'idle', message = '', hosted = null;
  function createOwnerToken() {
    let suffix = '';
    for (let i = 0; i < 5; i++) suffix += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
    return 'wl1_' + Date.now().toString(16).padStart(12, '0').slice(-12) + suffix.slice(0, 36);
  }
  function notify() { changed({ status, message }); }
  function call(name, arguments_, lateSuccess) {
    return new Promise((resolve, reject) => {
      let done = false, expired = false;
      const timer = setTimeout(() => { expired = true; finish(new Error('TIMEOUT')); }, 12000);
      function finish(error, result) {
        if (done) { if (!error && expired && lateSuccess) lateSuccess(); return; }
        done = true; clearTimeout(timer); if (error) reject(error); else resolve(result);
      }
      try { api[name](Object.assign({}, arguments_, { success: result => finish(null, result), fail: error => finish(error || new Error('NETWORK')) })); }
      catch (error) { finish(error || new Error('UNAVAILABLE')); }
    });
  }
  function retry() {
    if (flight) return flight;
    if (!desired) return Promise.resolve(false);
    const startedGeneration = generation;
    status = 'pending'; message = '正在保存微信好友成绩…'; notify();
    flight = (async () => {
      let readSucceeded = false;
      try {
        const response = await call('getUserCloudStorage', { keyList: [key] });
        const list = response && response.KVDataList || [];
        const existing = Array.isArray(list) && list.find(item => item && item.key === key);
        const oldScore = parseScore(list, key);
        if (existing && !oldScore) throw new Error('UNRECOGNIZED_HISTORY');
        readSucceeded = true;
        const best = mergeScores(oldScore, desired);
        // Prefer the marker read from this WeChat account's own hosted record.
        // Generate only if absent; a submitted device value may never choose it.
        best.ownerToken = oldScore && oldScore.ownerToken || createOwnerToken();
        const value = serializeScore(best, key);
        if (!value) throw new Error('INVALID_SCORE');
        if (!existing || existing.value !== value) {
          await call('setUserCloudStorage', { KVDataList: [{ key, value }] }, () => {
            // A timed-out write may finish after a newer one. Read and merge
            // again instead of allowing its older value to remain last.
            generation++; retry();
          });
        }
        hosted = best; desired = mergeScores(best, desired);
        status = 'saved'; message = '已保存微信托管最佳成绩';
        return true;
      } catch (_) {
        status = 'error'; message = readSucceeded ? '成绩暂未保存，可点击重试' : '历史成绩读取失败，未覆盖旧成绩；可重试';
        return false;
      } finally {
        flight = null; notify();
        if (generation !== startedGeneration) retry();
      }
    })();
    return flight;
  }
  function submit(value) {
    const candidate = cleanScore(value); if (!candidate) return Promise.resolve(false);
    delete candidate.ownerToken;
    const merged = mergeScores(desired, candidate);
    if (JSON.stringify(merged) !== JSON.stringify(desired)) { desired = merged; generation++; }
    return retry();
  }
  return { submit, retry, getState: () => ({ status, message, hosted }) };
}

module.exports = { createHostedScoreSync };
