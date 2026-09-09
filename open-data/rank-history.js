'use strict';

// Only the account's own last-viewed rank is saved. No friend IDs or rows leave this domain.
function historyKey(key) { return typeof key === 'string' && key.length <= 118 ? key + '_seen_rank' : null; }
function valid(value) {
  return value && value.v === 1 && Number.isSafeInteger(value.rank) && value.rank >= 1 && value.rank <= 100000 &&
    Number.isSafeInteger(value.index) && value.index >= 0 && value.index < 100000 ? { v: 1, rank: value.rank, index: value.index } : null;
}
function createRankHistory(api, allowed = () => true) {
  const records = new Map();
  function record(key) {
    if (!records.has(key)) records.set(key, { value: null, desired: '', saved: '', flight: null });
    return records.get(key);
  }
  function get(key) { const value = record(key).value; return value ? { ...value } : null; }
  function load(key, list) {
    const item = Array.isArray(list) && list.find(item => item && item.key === historyKey(key));
    const entry = record(key);
    if (!entry.value && item && typeof item.value === 'string' && item.value.length < 256) {
      try {
        const value = valid(JSON.parse(item.value));
        if (value) { entry.value = value; entry.desired = entry.saved = JSON.stringify(value); }
      } catch (_) {}
    }
    return get(key);
  }
  function flush(key) {
    const entry = record(key), storageKey = historyKey(key);
    if (!storageKey || !allowed(key) || entry.flight || !entry.desired || entry.saved === entry.desired || typeof api.setUserCloudStorage !== 'function') return;
    const flight = entry.flight = { value: entry.desired, timer: null };
    function finish(success) {
      if (entry.flight !== flight) {
        // A timed-out older write can land after a newer observation. Repair only while authorized.
        if (success && flight.value !== entry.desired) { entry.saved = ''; flush(key); }
        return;
      }
      clearTimeout(flight.timer); entry.flight = null;
      if (success) { entry.saved = flight.value; flush(key); }
    }
    flight.timer = setTimeout(() => finish(false), 5000);
    if (flight.timer && typeof flight.timer.unref === 'function') flight.timer.unref();
    try { api.setUserCloudStorage({ KVDataList: [{ key: storageKey, value: flight.value }], success: () => finish(true), fail: () => finish(false) }); }
    catch (_) { finish(false); }
  }
  function remember(key, value) {
    const next = valid({ v: 1, ...value }); if (!next) return;
    const entry = record(key); entry.value = next; entry.desired = JSON.stringify(next); flush(key);
  }
  function pause() {
    records.forEach(entry => { if (entry.flight) clearTimeout(entry.flight.timer); entry.flight = null; });
  }
  return { get, load, remember, pause };
}

module.exports = { historyKey, createRankHistory };
