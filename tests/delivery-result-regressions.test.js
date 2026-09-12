'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, step, stars, scoredTurns } = require('../src/engine');
const { createStore } = require('../src/storage');
const { deliveryResultLines } = require('../src/delivery-result');

const level = { id: 7, width: 3, height: 2, start: 0, exit: 1, budget: 3, par: 3,
  walls: [], letters: [2], seals: [], lights: [], bridges: [], winds: {} };

test('a first assisted delivery keeps its save warning when local storage is unavailable', () => {
  const store = createStore({ get: () => null,
    set() { throw new Error('quota exceeded'); }, remove() { throw new Error('storage unavailable'); } });
  let state = createState(level, { kite: 1 });
  state = step(level, state, 'right').state;
  state = step(level, state, 'item:kite:2').state;
  assert.equal(state.status, 'won', 'collecting the last letter from the post office completes delivery');
  const rating = stars(level, state), before = store.getProfile().completed[level.id];
  store.settleWin(level.id, rating, scoredTurns(level, state));
  const lines = deliveryResultLines(level, state, rating, before, store.getStatus().persisted);
  assert.ok(lines.some(line => /道具辅助最高二星/.test(line)), 'the assisted rating explanation remains available');
  assert.equal(lines.filter(line => /本次纪录仅在本次运行保留/.test(line)).length, 1,
    'the first assisted result explicitly reports the failed persistence attempt');
  assert.deepEqual(store.getProfile().completed[level.id], { stars: 2, bestTurns: 4 },
    'the win and its scoring remain usable in memory');
});

test('all first and repeat delivery variants show an unsaved warning exactly once', () => {
  for (const before of [undefined, { stars: 3, bestTurns: 3 }]) {
    for (const itemsUsed of [0, 1]) for (const revived of [false, true]) {
      const state = { turn: 4, itemsUsed, revived, reviveCount: revived ? 1 : 0 };
      const rating = stars(level, state);
      const label = JSON.stringify({ before, itemsUsed, revived });
      const unsaved = deliveryResultLines(level, state, rating, before, false);
      assert.equal(unsaved.filter(line => /本次纪录仅在本次运行保留/.test(line)).length, 1, label);
      assert.ok(!unsaved.some(line => /本次纪录已保存/.test(line)), label);
      const saved = deliveryResultLines(level, state, rating, before, true);
      assert.ok(!saved.some(line => /仅在本次运行保留/.test(line)), label);
    }
  }
});
