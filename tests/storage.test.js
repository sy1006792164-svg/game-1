'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createStore, PROFILE_KEY, RUN_KEY } = require('../src/storage');

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

test('local progress is reloadable and duplicate wins only improve personal bests', () => {
  const adapter = memory();
  const store = createStore(adapter);
  store.recordWin('1', 2, 10, 'campaign');
  store.recordWin('1', 1, 12, 'campaign');
  store.recordWin('1', 3, 8, 'campaign');
  store.recordWin('daily', 2, 14, 'daily', '2026-09-07');
  store.recordWin('daily', 3, 12, 'daily', '2026-09-07');
  store.recordWin('daily', 1, 18, 'daily', '2026-09-08');
  const loaded = createStore(adapter).getProfile();
  assert.deepEqual(loaded.completed['1'], { stars: 3, bestTurns: 8 });
  assert.deepEqual(loaded.daily['2026-09-07'], { stars: 3, bestTurns: 12 });
  assert.equal(loaded.totalWins, 3);
  assert.deepEqual(store.getStatus(), { persisted: true, message: '' });
});

test('untrusted records are sanitized and cannot inject prototype keys or bogus totals', () => {
  const payload = JSON.parse('{"version":1,"completed":{"__proto__":{"stars":3,"bestTurns":0},"constructor":{"stars":3,"bestTurns":0},"1":{"stars":2,"bestTurns":10},"2":{"stars":99,"bestTurns":-1}},"daily":{"2026-02-30":{"stars":3,"bestTurns":0}},"settings":{"sound":false,"haptics":"yes"},"totalWins":900}');
  const adapter = memory({ [PROFILE_KEY]: payload });
  const store = createStore(adapter);
  assert.deepEqual(store.getProfile(), {
    version: 1, completed: { 1: { stars: 2, bestTurns: 10 } }, daily: {},
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

test('legacy profiles drop the retired expert table and recount unique wins from campaign and daily', () => {
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
  assert.equal('settings' in profile, false);
  assert.equal('settings' in adapter.get(PROFILE_KEY), false, 'retired settings are removed from storage');
  assert.equal('expert' in adapter.get(PROFILE_KEY), false, 'the repaired profile is written back without the old table');
  store.recordWin(1, 3, 8, 'campaign');
  assert.deepEqual(createStore(adapter).getProfile().completed, { 1: { stars: 3, bestTurns: 8 } });
});

test('quota failures retain playable memory, with persistence status until all dirty keys recover', () => {
  const adapter = memory();
  const set = adapter.set;
  let blocked = true;
  adapter.set = (key, value) => { if (blocked) throw new Error('quota'); return set(key, value); };
  const store = createStore(adapter);
  store.recordWin('1', 1, 6, 'campaign');
  assert.equal(store.saveRun(run()), false);
  assert.equal(store.getProfile().totalWins, 1);
  assert.deepEqual(store.loadRun(), run());
  assert.equal(store.getStatus().persisted, false);
  blocked = false;
  store.recordWin('1', 2, 5, 'campaign');
  assert.equal(store.getStatus().persisted, false, 'run remains unsaved');
  assert.equal(store.saveRun(run()), true);
  assert.equal(store.getStatus().persisted, true);
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
  const snapshot = store.getProfile(); snapshot.completed['1'].stars = 3;
  assert.equal(store.getProfile().completed['1'].stars, 2);
});

test('reset removes only this game’s save keys and clears all in-memory progress', () => {
  const adapter = memory({ unrelated: 'keep' });
  const store = createStore(adapter);
  store.recordWin('1', 2, 10, 'campaign');
  store.saveRun(run());
  assert.equal(store.reset(), true);
  assert.equal(store.getProfile().totalWins, 0);
  assert.deepEqual(store.getProfile().completed, {});
  assert.deepEqual(createStore(adapter).getProfile(), store.getProfile());
  assert.equal(store.loadRun(), null);
  assert.equal(adapter.values.has(RUN_KEY), false);
  assert.equal(adapter.values.get('unrelated'), 'keep');
});

test('invalid and future-version saves recover safely', () => {
  const adapter = memory({ [PROFILE_KEY]: { version: 200, completed: { 1: { stars: 3, bestTurns: 0 } } }, [RUN_KEY]: { nope: true } });
  const store = createStore(adapter);
  assert.equal(store.getProfile().totalWins, 0);
  assert.equal(store.loadRun(), null);
});

test('retired settings migrate without losing scores or the in-progress run', () => {
  const progress = { mode: 'campaign', levelId: 2, actions: ['up', 'wait'], reviveAt: null };
  const adapter = memory({
    [PROFILE_KEY]: {
      version: 1, completed: { 1: { stars: 3, bestTurns: 8 } }, daily: {},
      settings: { sound: false, haptics: false, music: true, reducedMotion: true }, totalWins: 1,
    },
    [RUN_KEY]: progress,
  });
  const store = createStore(adapter);
  assert.equal('settings' in store.getProfile(), false);
  assert.equal('settings' in adapter.get(PROFILE_KEY), false);
  assert.deepEqual(store.loadRun(), progress);
  const reloaded = createStore(adapter);
  assert.deepEqual(reloaded.getProfile(), {
    version: 1, completed: { 1: { stars: 3, bestTurns: 8 } }, daily: {}, totalWins: 1,
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
  assert.equal(store.saveRun({ ...history, mode: 'daily', levelId: 'daily-2026-09-07' }), true);
  assert.equal(store.saveRun({ ...history, mode: 'daily', dateKey: 'broken' }), false);
});

test('WeChat-style cross-realm storage reads preserve saved run and progress', () => {
  const adapter = memory();
  const first = createStore(adapter);
  first.recordWin('1', 3, 8, 'campaign');
  first.recordWin('daily', 2, 17, 'daily', '2026-09-07');
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
