'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createStore, PROFILE_KEY, RUN_KEY, DEV_PROFILE_KEY, DEV_RUN_KEY } = require('../src/storage');

function memory(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    values,
    get: key => values.has(key) ? values.get(key) : null,
    set: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))),
    remove: key => values.delete(key),
  };
}
function run() { return { mode: 'campaign', levelId: '1', state: { tiles: [0, 1, 2], turns: 4 } }; }

test('development profile, run and reset remain isolated from formal saves in the same adapter', () => {
  const adapter = memory(), formal = createStore(adapter);
  formal.recordWin(1, 3, 4, 'campaign'); formal.saveRun(run());
  const original = JSON.stringify([adapter.get(PROFILE_KEY), adapter.get(RUN_KEY)]);
  const dev = createStore(adapter, { development: true });
  assert.deepEqual(dev.getProfile().completed, {});
  dev.recordWin(999, 3, 81, 'campaign'); dev.saveRun({ ...run(), levelId: 998 });
  assert.equal(JSON.stringify([adapter.get(PROFILE_KEY), adapter.get(RUN_KEY)]), original);
  assert.equal(adapter.get(DEV_PROFILE_KEY).completed['999'].stars, 3);
  assert.equal(createStore(adapter, { development: true }).loadRun().levelId, 998);
  dev.reset();
  assert.equal(JSON.stringify([adapter.get(PROFILE_KEY), adapter.get(RUN_KEY)]), original);
  dev.saveRun({ ...run(), levelId: 900 }); formal.reset();
  assert.equal(adapter.get(DEV_RUN_KEY).levelId, 900);
});

test('all 999 campaign scores and 1000 archived daily scores survive saving and reloading together', () => {
  const completed = Object.fromEntries(Array.from({ length: 998 }, (_, i) => [i + 1, { stars: 3, bestTurns: 80 }]));
  const daily = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [
    new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), { stars: 2, bestTurns: 30 }
  ]));
  const adapter = memory({ [PROFILE_KEY]: { version: 1, completed, daily, totalWins: 1998 } });
  const store = createStore(adapter);
  store.recordWin(999, 3, 90, 'campaign');
  assert.equal(store.getStatus().persisted, true);
  const reloaded = createStore(adapter).getProfile();
  assert.equal(Object.keys(reloaded.completed).length, 999);
  assert.equal(Object.keys(reloaded.daily).length, 1000);
  assert.deepEqual(reloaded.completed['999'], { stars: 3, bestTurns: 90 });
  assert.equal(reloaded.totalWins, 1999);
});

test('local progress is reloadable and duplicate wins only improve personal bests', () => {
  const adapter = memory();
  const store = createStore(adapter);
  assert.deepEqual(store.getProfile().settings,
    { sound: true, music: true, haptics: true, reducedMotion: false });
  store.recordWin('1', 2, 10, 'campaign');
  store.recordWin('1', 1, 12, 'campaign');
  store.recordWin('1', 3, 8, 'campaign');
  store.recordWin('daily', 2, 14, 'daily', '2026-09-07');
  store.recordWin('daily', 3, 12, 'daily', '2026-09-07');
  store.recordWin('daily', 1, 18, 'daily', '2026-09-08');
  const loaded = createStore(adapter).getProfile();
  assert.deepEqual(loaded.completed['1'], { stars: 3, bestTurns: 8 });
  assert.deepEqual(loaded.daily, {}, 'retired daily mode rejects new scores');
  assert.equal(loaded.totalWins, 1);
  assert.deepEqual(store.getStatus(), { persisted: true, message: '' });
});

test('untrusted records are sanitized and cannot inject prototype keys or bogus totals', () => {
  const payload = JSON.parse('{"version":1,"completed":{"__proto__":{"stars":3,"bestTurns":0},"constructor":{"stars":3,"bestTurns":0},"1":{"stars":2,"bestTurns":10},"2":{"stars":99,"bestTurns":-1}},"daily":{"2026-02-30":{"stars":3,"bestTurns":0}},"settings":{"sound":false,"haptics":"yes"},"totalWins":900}');
  const adapter = memory({ [PROFILE_KEY]: payload });
  const store = createStore(adapter);
  assert.deepEqual(store.getProfile(), {
    version: 1, completed: { 1: { stars: 2, bestTurns: 10 } }, daily: {},
    settings: { sound: false, music: true, haptics: true, reducedMotion: false },
    totalWins: 1,
  });
  assert.equal(Object.prototype.stars, undefined);
  assert.deepEqual(adapter.get(PROFILE_KEY), store.getProfile());
  store.recordWin('__proto__', 3, 0, 'campaign');
  store.recordWin('2', 3, -1, 'campaign');
  store.recordWin('3', NaN, 4, 'campaign');
  assert.equal(store.getProfile().totalWins, 1);
});

test('corrupt JSON/read failures are repaired where writes still work', () => {
  const adapter = memory();
  adapter.get = () => { throw new SyntaxError('bad JSON'); };
  const store = createStore(adapter);
  assert.equal(store.getProfile().totalWins, 0);
  assert.equal(adapter.values.get(PROFILE_KEY).version, 1);
  assert.equal(store.getStatus().persisted, true);
});

test('legacy profiles drop the retired expert table, sanitize settings and recount unique wins', () => {
  const legacy = {
    version: 1, completed: { 1: { stars: 2, bestTurns: 10 } },
    daily: { '2026-09-07': { stars: 3, bestTurns: 14 } },
    expert: { 1: { stars: 3, bestTurns: 8 }, '__proto__': { stars: 3, bestTurns: 0 } },
    settings: { sound: false, haptics: true, music: false, reducedMotion: true }, totalWins: 3,
  };
  const adapter = memory({ [PROFILE_KEY]: JSON.parse(JSON.stringify(legacy)) });
  const store = createStore(adapter);
  const profile = store.getProfile();
  assert.equal('expert' in profile, false);
  assert.deepEqual(profile.completed, legacy.completed);
  assert.deepEqual(profile.daily, legacy.daily);
  assert.equal(profile.totalWins, 2, 'the unique-win total no longer counts expert entries');
  assert.deepEqual(profile.settings, legacy.settings);
  assert.deepEqual(adapter.get(PROFILE_KEY).settings, legacy.settings, 'valid historical settings survive repair');
  assert.equal('expert' in adapter.get(PROFILE_KEY), false, 'the repaired profile is written back without the old table');
  store.recordWin(1, 3, 8, 'campaign');
  assert.deepEqual(createStore(adapter).getProfile().completed, { 1: { stars: 3, bestTurns: 8 } });
});

test('quota failures retain playable memory, with persistence status until all dirty keys recover', () => {
  const adapter = memory();
  const set = adapter.set;
  const blocked = new Set([PROFILE_KEY, RUN_KEY]);
  adapter.set = (key, value) => { if (blocked.has(key)) throw new Error('quota'); return set(key, value); };
  const store = createStore(adapter);
  store.recordWin('1', 1, 6, 'campaign');
  assert.equal(store.saveRun(run()), false);
  assert.equal(store.getProfile().totalWins, 1);
  assert.deepEqual(store.loadRun(), run());
  assert.equal(store.getStatus().persisted, false);
  blocked.delete(PROFILE_KEY);
  store.updateSettings({ sound: false });
  store.recordWin('1', 2, 5, 'campaign');
  assert.equal(store.getStatus().persisted, false, 'run remains unsaved');
  blocked.delete(RUN_KEY);
  assert.equal(store.saveRun(run()), true);
  assert.equal(store.getStatus().persisted, true);
});

test('a later run save or flush recovers the latest scores after a temporary write failure', () => {
  for (const recovery of ['saveRun', 'flush']) {
    const adapter = memory(), set = adapter.set;
    let blocked = true;
    adapter.set = (key, value) => {
      if (blocked && key === PROFILE_KEY) throw new Error('temporary storage failure');
      return set(key, value);
    };
    const store = createStore(adapter);
    store.recordWin(1, 1, 6);
    store.recordWin(1, 3, 4);
    assert.equal(store.getStatus().persisted, false);
    assert.equal(adapter.get(PROFILE_KEY), null);
    blocked = false;
    const progress = { mode: 'campaign', levelId: 2, actions: ['right'], reviveAt: null };
    assert.equal(recovery === 'saveRun' ? store.saveRun(progress) : store.flush(), true);
    const reloaded = createStore(adapter);
    assert.deepEqual(reloaded.getProfile().completed, { 1: { stars: 3, bestTurns: 4 } }, recovery);
    assert.deepEqual(reloaded.loadRun(), recovery === 'saveRun' ? progress : null, recovery);
    assert.deepEqual(store.getStatus(), { persisted: true, message: '' });
  }
});

test('read recovery preserves settings changed while storage was unavailable', () => {
  const saved = {
    version: 1, completed: { 1: { stars: 3, bestTurns: 8 } }, daily: {},
    settings: { sound: false, music: false, haptics: false, reducedMotion: true }, totalWins: 1,
  };
  const adapter = memory({ [PROFILE_KEY]: saved });
  const get = adapter.get;
  let blocked = true;
  adapter.get = key => {
    if (blocked && key === PROFILE_KEY) throw new Error('temporarily unreadable');
    return get(key);
  };
  const store = createStore(adapter);
  assert.equal(store.hasPendingReads(), true);
  // These explicit choices equal the temporary defaults, but must still win
  // over the older values recovered from disk.
  store.updateSettings({ sound: true, reducedMotion: false });
  assert.deepEqual(store.getProfile().settings,
    { sound: true, music: true, haptics: true, reducedMotion: false });
  blocked = false;
  assert.equal(store.flush(), true);
  assert.equal(store.hasPendingReads(), false);
  assert.deepEqual(store.getProfile().settings,
    { sound: true, music: false, haptics: false, reducedMotion: false });
  assert.deepEqual(store.getProfile().completed, saved.completed);
  assert.deepEqual(createStore(adapter).getProfile(), store.getProfile());
});

test('retrying a failed run deletion never restores its earlier pending route', () => {
  for (const recovery of ['recordWin', 'flush']) {
    const adapter = memory(), set = adapter.set, remove = adapter.remove;
    let blocked = false;
    adapter.set = (key, value) => {
      if (blocked && key === RUN_KEY) throw new Error('temporary storage failure');
      return set(key, value);
    };
    adapter.remove = key => {
      if (blocked) throw new Error('temporary storage failure');
      return remove(key);
    };
    const store = createStore(adapter);
    store.saveRun(run());
    blocked = true;
    assert.equal(store.saveRun({ ...run(), levelId: 2 }), false);
    assert.equal(store.clearRun(), false, 'both native removal and null replacement fail');
    assert.equal(store.loadRun(), null);
    assert.deepEqual(adapter.get(RUN_KEY), run());
    blocked = false;
    if (recovery === 'recordWin') store.recordWin(1, 3, 4);
    else assert.equal(store.flush(), true);
    assert.equal(createStore(adapter).loadRun(), null, recovery);
    assert.equal(adapter.values.has(RUN_KEY), false, recovery);
    assert.equal(store.getStatus().persisted, true);
  }
});

test('a newer run replaces a pending deletion and failed flushes preserve memory without looping', () => {
  const adapter = memory(), set = adapter.set, remove = adapter.remove;
  let blocked = false, attempts = 0;
  adapter.set = (key, value) => {
    attempts += 1;
    if (blocked) throw new Error('temporary storage failure');
    return set(key, value);
  };
  adapter.remove = key => {
    attempts += 1;
    if (blocked) throw new Error('temporary storage failure');
    return remove(key);
  };
  const store = createStore(adapter);
  store.saveRun(run());
  blocked = true;
  store.clearRun();
  const newerRun = { ...run(), levelId: 2 };
  store.saveRun(newerRun);
  store.recordWin(1, 3, 4);
  attempts = 0;
  assert.equal(store.flush(), false);
  assert.equal(attempts, 2, 'each pending value is attempted once while storage stays unavailable');
  assert.deepEqual(store.loadRun(), newerRun);
  blocked = false;
  assert.equal(store.flush(), true);
  const reloaded = createStore(adapter);
  assert.deepEqual(reloaded.loadRun(), newerRun);
  assert.deepEqual(reloaded.getProfile().completed, { 1: { stars: 3, bestTurns: 4 } });
  attempts = 0;
  assert.equal(store.flush(), true);
  assert.equal(attempts, 0, 'a clean store does not rewrite saved progress');
});

test('snapshots are isolated and run inputs reject cycles, accessors and oversized saves', () => {
  const store = createStore(memory());
  const input = run();
  assert.equal(store.saveRun(input), true);
  input.state.tiles[0] = 999;
  const loaded = store.loadRun();
  loaded.state.tiles[0] = 888;
  assert.equal(store.loadRun().state.tiles[0], 0);
  const cyclic = run(); cyclic.state.loop = cyclic;
  assert.equal(store.saveRun(cyclic), false);
  const accessor = run();
  Object.defineProperty(accessor.state, 'bad', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.equal(store.saveRun(accessor), false);
  const huge = run(); huge.state.tiles = new Array(100000000);
  assert.equal(store.saveRun(huge), false);
  const tooDeep = run(); let current = tooDeep.state;
  for (let i = 0; i < 30; i += 1) { current.next = {}; current = current.next; }
  assert.equal(store.saveRun(tooDeep), false);
  assert.equal(store.loadRun().state.tiles[0], 0, 'a rejected save preserves the previous run');
  store.recordWin('1', 2, 10, 'campaign');
  store.updateSettings({ music: false });
  const snapshot = store.getProfile(); snapshot.completed['1'].stars = 3; snapshot.settings.music = true;
  assert.equal(store.getProfile().completed['1'].stars, 2);
  assert.equal(store.getProfile().settings.music, false);
});

test('reset removes only this game’s save keys and clears all in-memory progress', () => {
  const adapter = memory({ unrelated: 'keep' });
  const store = createStore(adapter);
  store.recordWin('1', 2, 10, 'campaign');
  store.updateSettings({ sound: false, music: false, haptics: false, reducedMotion: true });
  store.saveRun(run());
  assert.equal(store.reset(), true);
  assert.equal(store.getProfile().totalWins, 0);
  assert.deepEqual(store.getProfile().completed, {});
  assert.deepEqual(store.getProfile().settings,
    { sound: true, music: true, haptics: true, reducedMotion: false });
  assert.deepEqual(createStore(adapter).getProfile(), store.getProfile());
  assert.equal(store.loadRun(), null);
  assert.equal(adapter.values.has(RUN_KEY), false);
  assert.equal(adapter.values.get('unrelated'), 'keep');
});

test('invalid and future-version saves recover safely and invalid setting values are ignored', () => {
  const adapter = memory({ [PROFILE_KEY]: { version: 200, completed: { 1: { stars: 3, bestTurns: 0 } } }, [RUN_KEY]: { nope: true } });
  const store = createStore(adapter);
  assert.equal(store.getProfile().totalWins, 0);
  assert.equal(store.loadRun(), null);
  store.updateSettings({ sound: 'false', music: 0, haptics: null, reducedMotion: 'yes', extra: true });
  assert.deepEqual(store.getProfile().settings,
    { sound: true, music: true, haptics: true, reducedMotion: false });
});

test('historical settings migrate without losing scores or the in-progress run', () => {
  const progress = { mode: 'campaign', levelId: 2, actions: ['up', 'wait'], reviveAt: null };
  const adapter = memory({
    [PROFILE_KEY]: {
      version: 1, completed: { 1: { stars: 3, bestTurns: 8 } }, daily: {},
      settings: { sound: false, haptics: false, music: true, reducedMotion: true }, totalWins: 1,
    },
    [RUN_KEY]: progress,
  });
  const store = createStore(adapter);
  assert.deepEqual(store.getProfile().settings,
    { sound: false, music: true, haptics: false, reducedMotion: true });
  assert.deepEqual(adapter.get(PROFILE_KEY).settings, store.getProfile().settings);
  assert.deepEqual(store.loadRun(), progress);
  const reloaded = createStore(adapter);
  assert.deepEqual(reloaded.getProfile(), {
    version: 1, completed: { 1: { stars: 3, bestTurns: 8 } }, daily: {},
    settings: { sound: false, music: true, haptics: false, reducedMotion: true }, totalWins: 1,
  });
  assert.deepEqual(reloaded.loadRun(), progress);
});

test('controller action-history saves survive reload and reject invalid revive indexes', () => {
  const adapter = memory();
  const store = createStore(adapter);
  const history = { mode: 'campaign', levelId: 1, dateKey: '2026-09-07', actions: ['up', 'wait', 'right'], reviveAt: null };
  assert.equal(store.saveRun(history), true);
  assert.deepEqual(createStore(adapter).loadRun(), history);
  assert.equal(store.saveRun({ ...history, actions: ['teleport'] }), false);
  assert.equal(store.saveRun({ ...history, reviveAt: 4 }), false);
  assert.equal(store.saveRun({ ...history, undosUsed: 2 }), true);
  assert.equal(store.saveRun({ ...history, undosUsed: -1 }), false);
  assert.equal(store.saveRun({ ...history, undosUsed: 1.5 }), false);
  assert.equal(store.saveRun({ ...history, undosUsed: 100 }), false);
  assert.equal(store.saveRun({ ...history, mode: 'daily', levelId: 'daily-2026-09-07' }), false);
  assert.equal(store.saveRun({ ...history, mode: 'daily', dateKey: 'broken' }), false);
});

test('multiple-revival saves survive relaunch and derive the earned count from the real route', () => {
  const { CAMPAIGN } = require('../src/levels');
  const { replay, reviveEnergy } = require('../src/engine');
  const level = CAMPAIGN[0], adapter = memory(), store = createStore(adapter);
  const actions = Array(level.budget + reviveEnergy(level)).fill('wait');
  const progress = { mode: 'campaign', levelId: level.id, revision: level.revision, actions,
    reviveHistory: [level.budget, actions.length], reviveCount: 99 };
  assert.equal(store.saveRun(progress), true);
  progress.reviveHistory.push(actions.length + 1);
  const saved = createStore(adapter).loadRun();
  assert.deepEqual(saved.reviveHistory, [level.budget, actions.length]);
  const restored = replay(level, saved.actions, saved.reviveHistory);
  assert.equal(restored.reviveCount, 2, 'an arbitrary stored count is never used to rebuild the route');
  assert.equal(restored.status, 'playing');
  assert.equal(restored.turn, actions.length);
  const legacy = { mode: 'campaign', levelId: level.id, actions: actions.slice(0, level.budget), reviveAt: level.budget };
  assert.equal(store.saveRun(legacy), true);
  const oldSaved = createStore(adapter).loadRun();
  assert.equal(replay(level, oldSaved.actions, oldSaved.reviveAt).reviveCount, 1);
});

test('invalid new revival histories cannot fall back to a legacy index or state snapshot', () => {
  const adapter = memory(), store = createStore(adapter);
  const valid = { mode: 'campaign', levelId: 1, actions: ['wait', 'wait', 'wait'], reviveHistory: [] };
  assert.equal(store.saveRun(valid), true);
  const sparse = [0, 3]; delete sparse[0];
  for (const reviveHistory of [undefined, null, 3, '3', {}, true, [3, 3], [2, 1], [-1], [4], [1.5], sparse]) {
    assert.equal(store.saveRun({ ...valid, reviveHistory, reviveAt: 0, state: {} }), false);
    assert.deepEqual(store.loadRun(), valid);
    assert.deepEqual(adapter.get(RUN_KEY), valid);
  }
  assert.equal(store.saveRun({ mode: 'campaign', levelId: 1, reviveHistory: [], state: {} }), false);
  assert.equal(store.saveRun({ ...valid, reviveHistory: [], reviveAt: 99 }), true, 'the explicitly valid new format has priority');
  const legacyArray = { mode: 'campaign', levelId: 1, actions: ['wait'], reviveAt: [1] };
  assert.equal(store.saveRun(legacyArray), false, 'the legacy field remains a single index');
});

test('an oversized route reports unsaved progress and preserves the previous save until recovery', () => {
  const adapter = memory(), store = createStore(adapter);
  const saved = { mode: 'campaign', levelId: 1, actions: ['wait'], reviveHistory: [] };
  assert.equal(store.saveRun(saved), true);
  assert.equal(store.saveRun({ ...saved, actions: Array(4097).fill('wait') }), false);
  assert.equal(store.getStatus().persisted, false);
  assert.match(store.getStatus().message, /当前路线无法保存.*原存档已保留/);
  assert.deepEqual(store.loadRun(), saved);
  assert.deepEqual(createStore(adapter).loadRun(), saved);
  assert.equal(store.flush(), false);
  store.recordWin(1, 3, 4);
  assert.equal(store.getStatus().persisted, false, 'a separate successful score write cannot claim the rejected route was saved');
  assert.equal(store.saveRun({ ...saved, actions: ['wait', 'wait'] }), true);
  assert.deepEqual(store.getStatus(), { persisted: true, message: '' });
  assert.deepEqual(createStore(adapter).loadRun().actions, ['wait', 'wait']);
  assert.equal(store.saveRun({ ...saved, actions: Array(5001).fill('wait') }), false);
  assert.equal(store.getStatus().persisted, false);
  assert.equal(store.clearRun(), true);
  assert.deepEqual(store.getStatus(), { persisted: true, message: '' });
});

test('WeChat-style cross-realm storage reads preserve saved run, progress and settings', () => {
  const adapter = memory();
  const first = createStore(adapter);
  first.recordWin('1', 3, 8, 'campaign');
  first.recordWin('daily', 2, 17, 'daily', '2026-09-07');
  first.updateSettings({ sound: false, haptics: false });
  const history = { mode: 'campaign', levelId: 2, dateKey: '2026-09-07', actions: ['up', 'wait', 'right'], reviveAt: null };
  assert.equal(first.saveRun(history), true);
  const expectedProfile = first.getProfile();
  const realm = vm.createContext({});
  const get = adapter.get;
  adapter.get = key => {
    const value = get(key);
    if (value == null) return value;
    realm.storedJson = JSON.stringify(value);
    return vm.runInContext('JSON.parse(storedJson)', realm);
  };
  assert.notEqual(Object.getPrototypeOf(adapter.get(RUN_KEY)), Object.prototype, 'the mocked SDK really returns a different realm');
  let rewrites = 0, removes = 0;
  const set = adapter.set, remove = adapter.remove;
  adapter.set = (key, value) => { rewrites += 1; return set(key, value); };
  adapter.remove = key => { removes += 1; return remove(key); };
  const recompiled = createStore(adapter);
  assert.deepEqual(recompiled.loadRun(), history);
  assert.deepEqual(recompiled.getProfile(), expectedProfile);
  assert.deepEqual(recompiled.getStatus(), { persisted: true, message: '' });
  assert.equal(rewrites, 0, 'valid foreign objects are not rewritten as empty defaults');
  assert.equal(removes, 0, 'valid foreign run is not cleared');
  assert.deepEqual(createStore(adapter).loadRun(), history, 'the next restart still sees the run');
});

test('cross-realm JSON state saves and null-prototype objects remain safe and isolated', () => {
  const store = createStore(memory());
  const foreign = vm.runInNewContext('({mode: "campaign", levelId: 1, state: {tiles: [0, 1, 2], turns: 4}})');
  assert.equal(store.saveRun(foreign), true);
  foreign.state.tiles[0] = 99;
  assert.deepEqual(store.loadRun(), { mode: 'campaign', levelId: 1, state: { tiles: [0, 1, 2], turns: 4 } });
  const settings = vm.runInNewContext('({sound: false, music: false, haptics: false, reducedMotion: true})');
  store.updateSettings(settings);
  assert.deepEqual(store.getProfile().settings,
    { sound: false, music: false, haptics: false, reducedMotion: true });
  const nullProto = Object.assign(Object.create(null), { mode: 'campaign', levelId: 2, state: Object.create(null) });
  assert.equal(store.saveRun(nullProto), true);
});

test('cross-realm class instances, cycles and accessors are rejected without executing getters', () => {
  const store = createStore(memory());
  assert.equal(store.saveRun(run()), true);
  const values = [
    vm.runInNewContext('(new (class Save { constructor() { this.mode="campaign"; this.levelId=1; this.state={}; } }))'),
    vm.runInNewContext('({mode:"campaign", levelId:1, state: new (class State {})})'),
    vm.runInNewContext('(() => { const save={mode:"campaign",levelId:1,state:{}}; save.state.loop=save; return save; })()'),
    vm.runInNewContext('({mode:"campaign",levelId:1,state:{get tiles(){throw new Error("must not execute");}}})'),
    { mode: 'campaign', levelId: 1, state: new (class State {})() },
  ];
  for (const value of values) assert.equal(store.saveRun(value), false);
  let getterCalls = 0;
  const prototype = Object.create(null);
  Object.defineProperty(prototype, 'constructor', { get() { getterCalls += 1; throw new Error('must not execute'); } });
  const custom = Object.assign(Object.create(prototype), { mode: 'campaign', levelId: 1, state: {} });
  assert.equal(store.saveRun(custom), false);
  assert.equal(getterCalls, 0);
  assert.deepEqual(store.loadRun(), run(), 'invalid foreign values do not replace the previous run');
});
