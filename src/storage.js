'use strict';

const PROFILE_KEY = 'minigame.local.profile.v1';
const RUN_KEY = 'minigame.local.run.v1';
const MAX_BYTES = 192 * 1024;
const BAD_KEYS = ['__proto__', 'prototype', 'constructor'];
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
  return { version: 1, completed: {}, daily: {}, settings: { sound: true, haptics: true }, totalWins: 0 };
}

function score(value) {
  if (!plain(value) || !Number.isInteger(value.stars) || value.stars < 1 || value.stars > 3 ||
      !Number.isInteger(value.bestTurns) || value.bestTurns < 0 || value.bestTurns > 100000) return null;
  return { stars: value.stars, bestTurns: value.bestTurns };
}

function profileFrom(value) {
  const next = defaults();
  if (!plain(value) || value.version !== 1) return next;
  if (plain(value.settings)) {
    if (typeof value.settings.sound === 'boolean') next.settings.sound = value.settings.sound;
    if (typeof value.settings.haptics === 'boolean') next.settings.haptics = value.settings.haptics;
  }
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
    const hasHistory = Array.isArray(run.actions) && run.actions.length <= 4096 &&
      run.actions.every(function (action) { return ['up', 'down', 'left', 'right', 'wait'].indexOf(action) !== -1; }) &&
      (run.reviveAt == null || (Number.isInteger(run.reviveAt) && run.reviveAt >= 0 && run.reviveAt <= run.actions.length));
    if (run.undosUsed != null && !(Number.isInteger(run.undosUsed) && run.undosUsed >= 0 && run.undosUsed <= 99)) return null;
    if (!plain(run.state) && !hasHistory) return null;
    if (run.mode === 'daily' && !dateId(run.dateKey)) return null;
    return run;
  } catch (_) { return null; }
}

function createStore(adapter) {
  let profile = defaults(), run = null;
  let status = { persisted: true, message: '' };
  const dirty = new Set();
  function failure(message) { status = { persisted: false, message }; }
  function save(key, value) {
    dirty.add(key);
    try {
      adapter.set(key, cleanJson(value));
      dirty.delete(key);
      if (!dirty.size) status = { persisted: true, message: '' };
      return true;
    } catch (_) {
      failure('本地存储不可用，当前进度暂存于内存，关闭后可能丢失。');
      return false;
    }
  }
  function remove(key) {
    dirty.add(key);
    try {
      adapter.remove(key);
      dirty.delete(key);
      if (!dirty.size) status = { persisted: true, message: '' };
      return true;
    } catch (_) {
      // Writing null can repair a storage implementation with no working remove.
      return save(key, null);
    }
  }
  try {
    const stored = adapter.get(PROFILE_KEY);
    if (stored != null && stored !== '') {
      let clean;
      try { clean = cleanJson(stored); } catch (_) { clean = null; }
      profile = profileFrom(clean);
      if (JSON.stringify(profile) !== JSON.stringify(clean)) save(PROFILE_KEY, profile);
    }
  } catch (_) {
    // JSON decode errors and denied storage both arrive here. A successful
    // replacement repairs corrupt bytes; a rejected write keeps memory usable.
    save(PROFILE_KEY, profile);
  }
  try {
    const stored = adapter.get(RUN_KEY);
    if (stored != null && stored !== '') {
      run = runFrom(stored);
      if (!run) remove(RUN_KEY);
    }
  } catch (_) {
    remove(RUN_KEY);
  }
  function snapshot() { return cleanJson(profile); }
  return {
    getProfile: snapshot,
    getStatus: function () { return Object.assign({}, status); },
    updateSettings: function (partial) {
      if (!plain(partial)) return snapshot();
      ['sound', 'haptics'].forEach(function (key) {
        const descriptor = Object.getOwnPropertyDescriptor(partial, key);
        if (descriptor && own(descriptor, 'value') && typeof descriptor.value === 'boolean') profile.settings[key] = descriptor.value;
      });
      save(PROFILE_KEY, profile);
      return snapshot();
    },
    recordWin: function (levelId, stars, turns, mode, dateKey) {
      const daily = mode === 'daily';
      const id = daily ? dateKey : (typeof levelId === 'number' ? String(levelId) : levelId);
      if (!(daily ? dateId(id) : safeId(id)) || !Number.isInteger(stars) || stars < 1 || stars > 3 ||
          !Number.isInteger(turns) || turns < 0 || turns > 100000) return snapshot();
      const map = daily ? profile.daily : profile.completed;
      const before = own(map, id) ? map[id] : null;
      if (!before && Object.keys(map).length >= 1000) return snapshot();
      map[id] = {
        stars: Math.max(before ? before.stars : 0, stars),
        bestTurns: Math.min(before ? before.bestTurns : Infinity, turns),
      };
      if (!before) profile.totalWins += 1;
      save(PROFILE_KEY, profile);
      return snapshot();
    },
    saveRun: function (value) {
      const next = runFrom(value);
      if (!next) return false;
      run = next;
      return save(RUN_KEY, run);
    },
    loadRun: function () { return run ? cleanJson(run) : null; },
    clearRun: function () { run = null; return remove(RUN_KEY); },
    reset: function () {
      profile = defaults(); run = null;
      const removed = remove(RUN_KEY);
      const saved = save(PROFILE_KEY, profile);
      return removed && saved;
    },
  };
}

module.exports = { createStore, PROFILE_KEY, RUN_KEY };
