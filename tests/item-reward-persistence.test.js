'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createStore, PROFILE_KEY, RUN_KEY } = require('../src/storage');
const { replay, step } = require('../src/engine');

const filename = path.join(__dirname, '../src/main.js');
const source = fs.readFileSync(filename, 'utf8');
const testSource = source.replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
assert.notEqual(testSource, source);
const loaded = { exports: {} };
vm.runInThisContext('(function(require, module, exports) {\n' + testSource + '\n})', { filename })(
  createRequire(filename), loaded, loaded.exports);

function fixture(item, blockScore) {
  const values = new Map(), writes = [];
  const adapter = {
    get: key => values.has(key) ? structuredClone(values.get(key)) : null,
    set(key, value) {
      writes.push(key);
      if (blockScore && key === PROFILE_KEY) throw new Error('profile quota exceeded');
      values.set(key, structuredClone(value));
    },
    remove: key => values.delete(key)
  };
  const level = { id: item === 'echo' ? 31 : 7, width: 3, height: 1, start: 0, exit: 1,
    budget: 6, par: 3, walls: [], letters: item === 'kite' ? [2] : [],
    seals: item === 'echo' ? [1] : [], lights: [], bridges: [], winds: {} };
  const store = createStore(adapter), game = Object.create(loaded.exports.Game.prototype);
  const supplyPolicy = { version: 2, legacyActionCount: 0, legacyReviveCount: 0 };
  let videos = 0;
  Object.assign(game, { store, level, state: replay(level, ['right']),
    actions: ['right'], reviveHistory: [], itemRewards: { oil: 0, kite: 0, bridge: 0 },
    supplyPolicy, undosUsed: 0, mode: 'campaign', page: 'game', session: 1,
    modal: null, reviewing: false, transitionAt: 0, guideEnabled: false, mechanicGuide: null,
    hidden: false, busy: false, cueCount: 0, renderer: { hits: [] },
    platform: { kind: 'wechat', now: () => 1000, vibrate() {} },
    sound: { suspend() {}, resume() {}, play() {}, ambience() {} }, camera: { shake() {} },
    rankingAuthorization: { getState: () => ({ enabled: false }) },
    ads: { isActive: () => false, isConfigured: () => true,
      showRewarded: () => { videos++; return Promise.resolve({ rewarded: true }); } } });
  game.persist(); writes.length = 0;
  return { game, store, adapter, values, writes, level, videos: () => videos };
}

for (const item of ['kite', 'echo']) test(item + ' earned on the winning action survives a failed score write', async () => {
  const h = fixture(item, true), target = item === 'kite' ? 2 : 1;
  await h.game.requestItemReward(item, target);
  assert.equal(h.game.state.status, 'won');
  assert.equal(h.game.modal.kind, 'win');
  assert.equal(h.videos(), 1);
  assert.equal(h.store.getStatus().persisted, false);
  assert.equal(h.store.loadRun(), null, 'the current session already completed this route');

  const restarted = createStore(h.adapter), saved = restarted.loadRun();
  assert.deepEqual(saved.actions, ['right'], 'the fallback remains a playable route');
  assert.equal(saved.itemRewards[item], 1, 'the completed video is durable before settlement can fail');
  const restored = replay(h.level, saved.actions, saved.reviveHistory, saved.itemRewards, saved.supplyPolicy);
  assert.equal(restored.status, 'playing');
  assert.equal(restored.inventory[item], 1);
  const completed = step(h.level, restored, 'item:' + item + ':' + target);
  assert.equal(completed.state.status, 'won', 'the restored earned supply finishes without another video');
  assert.equal(completed.state.inventory[item], 0, 'the one earned supply is consumed once');
  assert.equal(h.writes[0], RUN_KEY, 'save the earned supply before attempting its larger score record');
});

test('a successful video-assisted settlement still clears the recovery route', async () => {
  const h = fixture('kite', false);
  await h.game.requestItemReward('kite', 2);
  const restarted = createStore(h.adapter);
  assert.equal(h.videos(), 1);
  assert.equal(restarted.getProfile().completed[7].stars, 2);
  assert.equal(restarted.loadRun(), null);
  assert.equal(h.values.has(RUN_KEY), false);
});
