'use strict';

const { normalizeReviveHistory } = require('./engine');

const PROFILE_KEY = 'minigame.local.profile.v1';
const RUN_KEY = 'minigame.local.run.v1';
const DEV_PROFILE_KEY = 'minigame.development.profile.v1';
const DEV_RUN_KEY = 'minigame.development.run.v1';
const MAX_BYTES = 192 * 1024;
const BAD_KEYS = ['__proto__', 'prototype', 'constructor'];
const SETTING_KEYS = Object.freeze(['sound', 'music', 'haptics', 'reducedMotion']);
const NATIVE_OBJECT_SOURCE = Function.prototype.toString.call(Object);

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null || proto === Object.prototype) return true;
  // wx.getStorageSync can return objects created in the SDK's JavaScript realm.
  // Their Object.prototype has a different identity, but is still the root
  // prototype of its own native Object constructor. Do not read constructor
  // through a property access: a custom prototype could install a getter.
  if (Object.getPrototypeOf(proto) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(proto, 'constructor');
  if (!constructor || !own(constructor, 'value') || typeof constructor.value !== 'function') return false;
  const ctor = constructor.value;
  const constructorPrototype = Object.getOwnPropertyDescriptor(ctor, 'prototype');
  return Boolean(constructorPrototype && own(constructorPrototype, 'value') &&
    constructorPrototype.value === proto && Function.prototype.toString.call(ctor) === NATIVE_OBJECT_SOURCE);
}

function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function safeId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id) && BAD_KEYS.indexOf(id) === -1; }
function dateId(id) {
  if (typeof id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(id)) return false;
  const date = new Date(id + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === id;
}

function defaults() {
  return {
    version: 1, completed: {}, daily: {},
    settings: { sound: true, music: true, haptics: true, reducedMotion: false },
    totalWins: 0
  };
}

function score(value) {
  if (!plain(value) || !Number.isInteger(value.stars) || value.stars < 1 || value.stars > 3 ||
      !Number.isInteger(value.bestTurns) || value.bestTurns < 0 || value.bestTurns > 100000) return null;
  return { stars: value.stars, bestTurns: value.bestTurns };
}

function bestScore(before, stars, turns) {
  return { stars: Math.max(before ? before.stars : 0, stars), bestTurns: Math.min(before ? before.bestTurns : Infinity, turns) };
}

function profileFrom(value) {
  const next = defaults();
  if (!plain(value) || value.version !== 1) return next;
  if (plain(value.settings)) {
    SETTING_KEYS.forEach(function (key) {
      if (typeof value.settings[key] === 'boolean') next.settings[key] = value.settings[key];
    });
  }
  if (value.guideDismissed === true) next.guideDismissed = true;
  if (plain(value.mechanicGuides)) {
    const seen = {};
    ['wind', 'bridge', 'light'].forEach(id => { if (value.mechanicGuides[id] === true) seen[id] = true; });
    if (Object.keys(seen).length) next.mechanicGuides = seen;
  }
  // Retain historical daily scores only for save compatibility; no active mode writes them.
  [['completed', safeId], ['daily', dateId]].forEach(function (pair) {
    const name = pair[0], valid = pair[1];
    if (!plain(value[name])) return;
    Object.keys(value[name]).slice(0, 1000).forEach(function (id) {
      if (!valid(id)) return;
      const record = score(value[name][id]);
      if (record) next[name][id] = record;
    });
  });
  next.totalWins = Object.keys(next.completed).length + Object.keys(next.daily).length;
  return next;
}

// Do not serialize arbitrary objects, accessors, cycles, prototypes, or huge inputs.
function cleanJson(value) {
  const seen = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 20000 || depth > 24) throw new Error('Save data is too large.');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string' && item.length <= 8192) return item;
    if (typeof item !== 'object' || (!Array.isArray(item) && !plain(item)) || seen.has(item)) throw new Error('Invalid save data.');
    if (Array.isArray(item) && item.length > 5000) throw new Error('Save data is too large.');
    seen.add(item);
    const out = Array.isArray(item) ? [] : {};
    const keys = Object.keys(item);
    if (keys.length > 5000) throw new Error('Save data is too large.');
    // Sparse arrays would silently lose trailing turns when copied or become
    // null entries after JSON serialization. Accept only real JSON sequences.
    if (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) {
      throw new Error('Invalid save array.');
    }
    keys.forEach(function (key) {
      if (BAD_KEYS.indexOf(key) !== -1) return;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !own(descriptor, 'value')) throw new Error('Invalid save property.');
      out[key] = visit(descriptor.value, depth + 1);
    });
    seen.delete(item);
    return out;
  }
  const result = visit(value, 0);
  if (JSON.stringify(result).length > MAX_BYTES) throw new Error('Save data is too large.');
  return result;
}

function runFrom(value) {
  try {
    const run = cleanJson(value);
    if (!plain(run) || typeof run.mode !== 'string' || !safeId(run.mode) ||
        !(safeId(run.levelId) || (Number.isInteger(run.levelId) && run.levelId >= 0 && run.levelId <= 100000))) return null;
    const hasRevivalHistory = own(run, 'reviveHistory');
    if (hasRevivalHistory && !Array.isArray(run.reviveHistory)) return null;
    if (!hasRevivalHistory && run.reviveAt != null && !Number.isInteger(run.reviveAt)) return null;
    const hasHistory = Array.isArray(run.actions) && run.actions.length <= 4096 &&
      run.actions.every(function (action) { return ['up', 'down', 'left', 'right', 'wait'].indexOf(action) !== -1; });
    if (hasHistory) normalizeReviveHistory(hasRevivalHistory ? run.reviveHistory : run.reviveAt, run.actions.length);
    // A legacy state snapshot must not bypass validation of a supplied route.
    if ((own(run, 'actions') || hasRevivalHistory || run.reviveAt != null) && !hasHistory) return null;
    if (run.undosUsed != null && !(Number.isInteger(run.undosUsed) && run.undosUsed >= 0 && run.undosUsed <= 99)) return null;
    if (!plain(run.state) && !hasHistory) return null;
    if (run.mode !== 'campaign') return null;
    return run;
  } catch (_) { return null; }
}

function createStore(adapter, options = {}) {
  const profileKey = options.development === true ? DEV_PROFILE_KEY : PROFILE_KEY;
  const runKey = options.development === true ? DEV_RUN_KEY : RUN_KEY;
  let profile = defaults(), run = null;
  let status = { persisted: true, message: '' };
  // Bumped on in-memory changes so callers can cache snapshots between frames.
  let revision = 0;
  const dirty = new Set();
  const unread = new Set();
  const settingsChanged = new Set();
  let guideDismissedChanged = false, runChanged = false, runRejected = false;
  function failure(message) { status = { persisted: false, message }; }
  function readFailed(key, error) {
    if (error instanceof SyntaxError) { save(key); return; }
    // A failed read does not prove the stored value is missing or corrupt.
    unread.add(key); dirty.add(key);
    failure('本地进度暂时无法读取，已保留原存档；当前进度暂存于内存。');
  }
  function recoverRead(key) {
    if (!unread.has(key)) return;
    let stored;
    try { stored = adapter.get(key); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    if (key === profileKey) {
      let clean;
      try { clean = cleanJson(stored); } catch (_) { clean = null; }
      const recovered = profileFrom(clean);
      // Apply real play since the failed read without erasing older records.
      ['completed', 'daily'].forEach(name => Object.keys(profile[name]).forEach(id => {
        const record = profile[name][id];
        recovered[name][id] = bestScore(own(recovered[name], id) ? recovered[name][id] : null, record.stars, record.bestTurns);
      }));
      if (profile.mechanicGuides) recovered.mechanicGuides = { ...recovered.mechanicGuides, ...profile.mechanicGuides };
      if (guideDismissedChanged) {
        if (profile.guideDismissed) recovered.guideDismissed = true;
        else delete recovered.guideDismissed;
      }
      // A recovered snapshot is older than choices made after its failed read.
      // Overlay only those choices; untouched settings should still come from disk.
      settingsChanged.forEach(key => { recovered.settings[key] = profile.settings[key]; });
      profile = profileFrom(recovered);
    } else if (!runChanged) run = runFrom(stored);
    unread.delete(key); revision += 1;
  }
  function writePending(key) {
    try {
      recoverRead(key);
      // Read current memory on every attempt; never replay an older queued save.
      const value = key === profileKey ? profile : run;
      if (key === runKey && value === null) {
        try { adapter.remove(key); }
        catch (_) { adapter.set(key, null); }
      } else adapter.set(key, cleanJson(value));
      dirty.delete(key);
      if (key === profileKey) settingsChanged.clear();
      if (!dirty.size && !runRejected) status = { persisted: true, message: '' };
      return true;
    } catch (_) {
      failure('本地存储不可用，当前进度暂存于内存，关闭后可能丢失。');
      return false;
    }
  }
  function flush() {
    // Each pending key gets one attempt, even if storage is still unavailable.
    Array.from(dirty).forEach(writePending);
    return !dirty.size && !runRejected;
  }
  function save(key) {
    revision += 1;
    dirty.add(key);
    const saved = writePending(key);
    if (saved) flush();
    return saved;
  }
  try {
    const stored = adapter.get(profileKey);
    if (stored != null && stored !== '') {
      let clean;
      try { clean = cleanJson(stored); } catch (_) { clean = null; }
      profile = profileFrom(clean);
      if (JSON.stringify(profile) !== JSON.stringify(clean)) save(profileKey);
    }
  } catch (error) { readFailed(profileKey, error); }
  try {
    const stored = adapter.get(runKey);
    if (stored != null && stored !== '') {
      run = runFrom(stored);
      if (!run) save(runKey);
    }
  } catch (error) { readFailed(runKey, error); }
  function snapshot() { return cleanJson(profile); }
  return {
    getProfile: snapshot,
    revision: function () { return revision; },
    getStatus: function () { return Object.assign({}, status); },
    hasPendingReads: function () { return unread.size > 0; },
    flush,
    updateSettings: function (partial) {
      if (!plain(partial)) return snapshot();
      let changed = false;
      SETTING_KEYS.forEach(function (key) {
        const descriptor = Object.getOwnPropertyDescriptor(partial, key);
        if (!descriptor || !own(descriptor, 'value') || typeof descriptor.value !== 'boolean') return;
        profile.settings[key] = descriptor.value;
        settingsChanged.add(key); changed = true;
      });
      if (changed) save(profileKey);
      return snapshot();
    },
    setGuideDismissed: function (dismissed) {
      if (typeof dismissed !== 'boolean') return false;
      guideDismissedChanged = true;
      if (dismissed) profile.guideDismissed = true;
      else delete profile.guideDismissed;
      return save(profileKey);
    },
    markMechanicSeen: function (id) {
      if (!['wind', 'bridge', 'light'].includes(id)) return false;
      if (!profile.mechanicGuides) profile.mechanicGuides = {};
      profile.mechanicGuides[id] = true;
      return save(profileKey);
    },
    recordWin: function (levelId, stars, turns, mode = 'campaign') {
      const id = typeof levelId === 'number' ? String(levelId) : levelId;
      if (mode !== 'campaign' || !safeId(id) || !Number.isInteger(stars) || stars < 1 || stars > 3 ||
          !Number.isInteger(turns) || turns < 0 || turns > 100000) return snapshot();
      const map = profile.completed;
      const before = own(map, id) ? map[id] : null;
      if (!before && Object.keys(map).length >= 1000) return snapshot();
      map[id] = bestScore(before, stars, turns);
      if (!before) profile.totalWins += 1;
      save(profileKey);
      return snapshot();
    },
    saveRun: function (value) {
      const next = runFrom(value);
      if (!next) {
        runRejected = true;
        failure('当前路线无法保存，原存档已保留；本次进度仅在运行期间保留。');
        return false;
      }
      run = next; runChanged = true; runRejected = false;
      return save(runKey);
    },
    loadRun: function () { return run ? cleanJson(run) : null; },
    clearRun: function () { run = null; runRejected = false; unread.delete(runKey); return save(runKey); },
    reset: function () {
      profile = defaults(); run = null;
      unread.clear(); settingsChanged.clear(); guideDismissedChanged = false; runChanged = false; runRejected = false;
      save(runKey);
      save(profileKey);
      return !dirty.size;
    },
  };
}

module.exports = { createStore, PROFILE_KEY, RUN_KEY, DEV_PROFILE_KEY, DEV_RUN_KEY };
