'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, PROFILE_KEY, RUN_KEY } = require('../src/storage');
const { CAMPAIGN } = require('../src/levels');
const { replay, step } = require('../src/engine');

function fixture() {
  const values = new Map(), writes = [];
  const blocked = new Set();
  const adapter = {
    get: key => values.has(key) ? structuredClone(values.get(key)) : null,
    set(key, value) {
      writes.push({ kind: 'set', key });
      if (blocked.has(key)) throw new Error('quota exceeded');
      values.set(key, structuredClone(value));
    },
    // A full quota can reject writes while deletions continue to work.
    remove(key) { writes.push({ kind: 'remove', key }); values.delete(key); }
  };
  const level = CAMPAIGN[0];
  const oldRun = { mode: 'campaign', levelId: level.id, revision: level.revision,
    actions: level.solution.slice(0, -1), reviveHistory: [],
    supplyPolicy: { version: 2, legacyActionCount: 0, legacyReviveCount: 0 } };
  const store = createStore(adapter);
  assert.equal(store.saveRun(oldRun), true);
  writes.length = 0;
  return { values, writes, blocked, adapter, level, oldRun, store };
}

test('a failed score write retains the recoverable route even when deletion would succeed', () => {
  const h = fixture();
  h.blocked.add(PROFILE_KEY);
  assert.equal(h.store.settleWin(h.level.id, 3, h.level.par), false);
  assert.equal(h.store.getStatus().persisted, false);
  assert.deepEqual(h.store.getProfile().completed[h.level.id], { stars: 3, bestTurns: h.level.par });
  assert.equal(h.store.loadRun(), null, 'a completed route is no longer offered in this running session');
  assert.deepEqual(h.adapter.get(RUN_KEY), h.oldRun, 'the disk fallback is not erased before the score is durable');
  assert.ok(!h.writes.some(write => write.key === RUN_KEY));

  const restarted = createStore(h.adapter), restored = restarted.loadRun();
  assert.equal(restarted.getProfile().completed[h.level.id], undefined, 'the interrupted score was not committed');
  const beforeFinish = replay(h.level, restored.actions, restored.reviveHistory, restored.itemRewards, restored.supplyPolicy);
  assert.equal(beforeFinish.status, 'playing');
  assert.equal(step(h.level, beforeFinish, h.level.solution.at(-1)).state.status, 'won',
    'reopening the game restores the last valid turn instead of losing the whole route');
});

test('flush commits the score before removing the fallback even when the route was dirty first', () => {
  const h = fixture();
  h.blocked.add(RUN_KEY);
  assert.equal(h.store.saveRun(h.oldRun), false, 'put the route ahead of the profile in the pending-write order');
  h.blocked.add(PROFILE_KEY);
  assert.equal(h.store.settleWin(h.level.id, 3, h.level.par), false);
  assert.equal(h.store.flush(), false);
  assert.deepEqual(h.adapter.get(RUN_KEY), h.oldRun);
  h.blocked.clear(); h.writes.length = 0;
  assert.equal(h.store.flush(), true);
  assert.deepEqual(h.writes, [{ kind: 'set', key: PROFILE_KEY }, { kind: 'remove', key: RUN_KEY }]);
  const restarted = createStore(h.adapter);
  assert.deepEqual(restarted.getProfile().completed[h.level.id], { stars: 3, bestTurns: h.level.par });
  assert.equal(restarted.loadRun(), null);
  assert.equal(h.store.getStatus().persisted, true);
});

test('continuing to the next route waits for the unlock score and later persists the newest route', () => {
  const h = fixture();
  h.blocked.add(PROFILE_KEY);
  assert.equal(h.store.settleWin(h.level.id, 3, h.level.par), false);
  const nextRun = { ...h.oldRun, levelId: CAMPAIGN[1].id, actions: CAMPAIGN[1].solution.slice(0, 1) };
  assert.equal(h.store.saveRun(nextRun), false, 'a new route cannot replace the fallback before its unlock is durable');
  assert.deepEqual(h.store.loadRun(), nextRun, 'play can continue in memory');
  assert.deepEqual(h.adapter.get(RUN_KEY), h.oldRun);
  h.blocked.clear(); h.writes.length = 0;
  assert.equal(h.store.flush(), true);
  assert.deepEqual(h.writes, [{ kind: 'set', key: PROFILE_KEY }, { kind: 'set', key: RUN_KEY }]);
  const restarted = createStore(h.adapter);
  assert.ok(restarted.getProfile().completed[h.level.id]);
  assert.deepEqual(restarted.loadRun(), nextRun, 'the previous pending deletion never erases newer progress');
});

test('a later successful profile update completes deferred settlement automatically', () => {
  const h = fixture();
  h.blocked.add(PROFILE_KEY);
  assert.equal(h.store.settleWin(h.level.id, 2, h.level.par + 1), false);
  h.blocked.clear(); h.writes.length = 0;
  h.store.updateSettings({ sound: false });
  const restarted = createStore(h.adapter);
  assert.deepEqual(restarted.getProfile().completed[h.level.id], { stars: 2, bestTurns: h.level.par + 1 });
  assert.equal(restarted.getProfile().settings.sound, false);
  assert.equal(restarted.loadRun(), null);
  assert.equal(h.store.getStatus().persisted, true);
  assert.deepEqual(h.writes, [{ kind: 'set', key: PROFILE_KEY }, { kind: 'remove', key: RUN_KEY }]);
});

test('ordinary next-route autosaves recover a deferred score without an explicit flush', () => {
  const h = fixture();
  h.blocked.add(PROFILE_KEY);
  assert.equal(h.store.settleWin(h.level.id, 3, h.level.par), false);
  const nextRun = { ...h.oldRun, levelId: CAMPAIGN[1].id, actions: [] };
  h.writes.length = 0;
  assert.equal(h.store.saveRun(nextRun), false);
  assert.deepEqual(h.writes, [{ kind: 'set', key: PROFILE_KEY }], 'one save makes only one prerequisite retry while unavailable');
  assert.deepEqual(h.adapter.get(RUN_KEY), h.oldRun);
  h.blocked.clear(); h.writes.length = 0;
  const advancedRun = { ...nextRun, actions: CAMPAIGN[1].solution.slice(0, 1) };
  assert.equal(h.store.saveRun(advancedRun), true, 'a normal walking autosave must unblock itself after recovery');
  assert.deepEqual(h.writes, [{ kind: 'set', key: PROFILE_KEY }, { kind: 'set', key: RUN_KEY }]);
  const restarted = createStore(h.adapter);
  assert.deepEqual(restarted.getProfile().completed[h.level.id], { stars: 3, bestTurns: h.level.par });
  assert.deepEqual(restarted.loadRun(), advancedRun);
  assert.equal(h.store.getStatus().persisted, true);
});

test('successful settlement is durable immediately and invalid results leave the route intact', () => {
  const h = fixture();
  for (const args of [[1, 0, 4], [1, 3, 0], ['__proto__', 3, 4], [1, 3, 4, 'daily']]) {
    assert.equal(h.store.settleWin(...args), false);
    assert.deepEqual(h.store.loadRun(), h.oldRun);
    assert.deepEqual(h.adapter.get(RUN_KEY), h.oldRun);
  }
  assert.equal(h.store.settleWin(h.level.id, 3, h.level.par), true);
  assert.deepEqual(h.writes, [{ kind: 'set', key: PROFILE_KEY }, { kind: 'remove', key: RUN_KEY }]);
  assert.equal(createStore(h.adapter).loadRun(), null);
});

test('explicit deletion and reset still clear a route after a deferred settlement', () => {
  for (const action of ['clearRun', 'reset']) {
    const h = fixture();
    h.blocked.add(PROFILE_KEY);
    h.store.settleWin(h.level.id, 3, h.level.par);
    h.store[action]();
    assert.equal(h.adapter.get(RUN_KEY), null, action + ': an explicit clear is not held by a pending score');
    h.blocked.clear(); h.store.flush();
    const restarted = createStore(h.adapter);
    assert.equal(restarted.loadRun(), null);
    assert.equal(!!restarted.getProfile().completed[h.level.id], action !== 'reset');
  }
});

test('the real final-turn controller preserves its route through flush, victory and quota failure', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { createRequire } = require('node:module');
  const filename = path.join(__dirname, '../src/main.js');
  const source = fs.readFileSync(filename, 'utf8');
  const testSource = source.replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
  assert.notEqual(testSource, source, 'load the real controller without bootstrapping a native canvas');
  const loaded = { exports: {} };
  vm.runInThisContext('(function(require, module, exports) {\n' + testSource + '\n})', { filename })(
    createRequire(filename), loaded, loaded.exports);

  for (const dirtyRoute of [false, true]) {
    const h = fixture(), game = Object.create(loaded.exports.Game.prototype);
    if (dirtyRoute) {
      h.blocked.add(RUN_KEY);
      assert.equal(h.store.saveRun(h.oldRun), false);
    }
    h.blocked.add(PROFILE_KEY);
    h.store.updateSettings({ sound: false });
    Object.assign(game, { store: h.store, level: h.level,
      state: replay(h.level, h.oldRun.actions, [], undefined, h.oldRun.supplyPolicy),
      actions: h.oldRun.actions.slice(), reviveHistory: [], itemRewards: { oil: 0, kite: 0, bridge: 0 },
      supplyPolicy: h.oldRun.supplyPolicy, undosUsed: 0, mode: 'campaign', page: 'game',
      guideEnabled: false, mechanicGuide: null, hidden: false, busy: false, cueCount: 0,
      platform: { now: () => 1000, vibrate() {} }, sound: { play() {} }, camera: { shake() {} },
      rankingAuthorization: { getState: () => ({ enabled: false }) } });
    const action = h.level.solution.at(-1);
    game.commitAction(step(h.level, game.state, action), action, 1000);
    assert.equal(game.state.status, 'won');
    assert.equal(game.modal.kind, 'win');
    assert.ok(game.modal.lines.some(line => /本次纪录仅在本次运行保留/.test(line)));
    assert.equal(game.store.loadRun(), null);
    assert.deepEqual(h.adapter.get(RUN_KEY), h.oldRun, 'the final-turn preflush cannot discard the recoverable route');
    assert.deepEqual(createStore(h.adapter).loadRun(), h.oldRun, 'a process restart can resume the old route');
    h.blocked.clear();
    game.persist();
    const recovered = createStore(h.adapter);
    assert.deepEqual(recovered.getProfile().completed[h.level.id], { stars: 3, bestTurns: h.level.par });
    assert.equal(recovered.loadRun(), null, 'the real lifecycle persist completes the deferred settlement');
  }
});
