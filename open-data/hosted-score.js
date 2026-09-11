'use strict';

const { isKVDataList, cleanScore, parseScoreRecord, mergeScores, serializeScore, legacyKeyFor, DEFAULT_KEY } = require('./leaderboard-data');

// Keep the better hosted aggregate when this client can read it first. WeChat
// exposes no compare-and-set, so simultaneous devices cannot be made atomic.
function createHostedScoreSync(api, options) {
  const settings = options || {};
  const getKey = typeof settings.key === 'function' ? settings.key : () => DEFAULT_KEY;
  const canSync = typeof settings.canSync === 'function' ? settings.canSync : () => true;
  const changed = typeof settings.onChange === 'function' ? settings.onChange : () => {};
  const stores = new Map();
  function current() {
    const key = getKey();
    if (!stores.has(key)) stores.set(key, createStorageKeySync(api, key, canSync, state => {
      if (getKey() === key) changed(state);
    }));
    return stores.get(key);
  }
  return { submit: value => current().submit(value), retry: () => current().retry(),
    pause: () => stores.forEach(store => store.pause()), getState: () => current().getState() };
}

// Pending writes and late repairs belong to their original storage key.
function createStorageKeySync(api, key, allowed, changed) {
  let desired = null, generation = 0, flight = null, status = 'idle', message = '', hosted = null;
  let retryTimer = null, retryAttempt = 0;
  const retryDelays = [2000, 5000, 15000];
  function pause() { if (retryTimer) clearTimeout(retryTimer); retryTimer = null; }
  function retryLater() {
    if (!allowed() || retryTimer || retryAttempt >= retryDelays.length) return;
    retryTimer = setTimeout(() => { retryTimer = null; retry(true); }, retryDelays[retryAttempt++]);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
  }
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
  function retry(automatic) {
    if (flight) return flight;
    if (!desired || !allowed()) return Promise.resolve(false);
    pause(); if (automatic !== true) retryAttempt = 0;
    const startedGeneration = generation;
    status = 'pending'; message = '正在保存微信好友成绩…'; notify();
    flight = (async () => {
      let readSucceeded = false, retryable = false;
      try {
        const legacyKey = legacyKeyFor(key);
        const response = await call('getUserCloudStorage', { keyList: [key, legacyKey].filter(Boolean) });
        // A malformed success is not proof of an empty account history.
        if (!response || !isKVDataList(response.KVDataList)) throw new Error('INVALID_HISTORY_RESPONSE');
        const list = response.KVDataList;
        const existing = list.find(item => item.key === key);
        const currentRecord = parseScoreRecord(list, key);
        const legacyRecord = legacyKey && parseScoreRecord(list, legacyKey);
        const currentScore = currentRecord && currentRecord.score;
        const legacyScore = legacyRecord && legacyRecord.score;
        // `stars` may predate this feature as an unrelated generic key. Only
        // records carrying the full WeChat ranking envelope are ours to update.
        if (existing && (!currentScore || !currentRecord.wxgame)) throw new Error('UNRECOGNIZED_HISTORY');
        readSucceeded = true;
        // A late read must not write during suspension or permission checks.
        if (!allowed()) { message = '等待恢复微信成绩同步'; return false; }
        const best = mergeScores(mergeScores(legacyScore, currentScore), desired);
        // Only this account's hosted record may choose the owner marker.
        best.ownerToken = currentScore && currentScore.ownerToken || legacyScore && legacyScore.ownerToken || createOwnerToken();
        const nowSeconds = Math.floor(Date.now() / 1000);
        const sameResult = score => score && ['stars', 'completed', 'turns'].every(field => score[field] === best[field]);
        const sourceRecord = sameResult(currentScore) ? currentRecord : sameResult(legacyScore) ? legacyRecord : null;
        const previousUpdate = sourceRecord && sourceRecord.wxgame ? sourceRecord.wxgame.update_time : null;
        // Preserve a valid timestamp when the ranked result did not improve,
        // including a migration from the former key and Unix epoch 0.
        // Millisecond/far-future legacy values are normalized on the next sync.
        const plausibleUpdate = Number.isSafeInteger(previousUpdate) && previousUpdate >= 0 && previousUpdate <= nowSeconds + 86400;
        const updateTime = plausibleUpdate ? previousUpdate : nowSeconds;
        const value = serializeScore(best, key, updateTime);
        if (!value) throw new Error('INVALID_SCORE');
        if (!existing || existing.value !== value) {
          await call('setUserCloudStorage', { KVDataList: [{ key, value }] }, () => {
            // Repair an old write that completed after a newer one.
            generation++; retry();
          });
        }
        hosted = best; desired = mergeScores(best, desired);
        status = 'saved'; message = '已保存微信托管最佳成绩'; retryAttempt = 0;
        return true;
      } catch (error) {
        retryable = !/UNRECOGNIZED_HISTORY|INVALID_SCORE|auth|deny|denied|permission/i.test(error && (error.errMsg || error.message) || '');
        status = 'error'; message = readSucceeded ? '成绩暂未保存，可点击重试' : '历史成绩读取失败，未覆盖旧成绩；可重试';
        return false;
      } finally {
        flight = null; notify();
        if (generation !== startedGeneration) retry();
        else if (retryable) retryLater();
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
  return { submit, retry, pause, getState: () => ({ status, message, hosted }) };
}

module.exports = { createHostedScoreSync };
