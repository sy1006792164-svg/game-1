'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, replay, neighbor, step } = require('../src/engine');
const { availableMechanics, createMechanicGuide, mechanicStep } = require('../src/mechanic-guide');
const { createStore, PROFILE_KEY } = require('../src/storage');

function lesson(level, phase = 0, state = createState(level), profile = {}) {
  return mechanicStep({ level, state, mechanicGuide: { ...createMechanicGuide(profile, level, 'campaign'), phase } });
}

test('first appearance follows the actual three mechanic types across all shipped maps', () => {
  assert.deepEqual(['wind', 'bridge', 'light'].map(id => CAMPAIGN.find(l => availableMechanics(l).includes(id)).id), [13, 16, 19]);
  assert.deepEqual(availableMechanics(CAMPAIGN[19]), ['wind', 'bridge', 'light']);
  assert.deepEqual(availableMechanics(CAMPAIGN[19], 'daily'), []);
  assert.equal(createMechanicGuide({ mechanicGuides: { wind: true, bridge: true, light: true } }, CAMPAIGN[19], 'campaign'), null);
  assert.deepEqual(createMechanicGuide({ completed: { 999: {} }, guideDismissed: true }, CAMPAIGN[19], 'campaign').ids, ['wind', 'bridge', 'light'],
    'invalid records and first-route dismissal cannot suppress an unseen mechanic');
  assert.deepEqual(createMechanicGuide({ completed: { 999: { stars: 3, bestTurns: 0 } } }, CAMPAIGN[19], 'campaign').ids,
    ['wind', 'bridge', 'light'], 'an impossible zero-turn win cannot suppress a mechanic introduction');
  const oldProgress = { completed: { 13: { stars: 3, bestTurns: CAMPAIGN[12].par } } };
  assert.equal(createMechanicGuide(oldProgress, CAMPAIGN[13], 'campaign'), null, 'a completed wind map proves the player has already encountered wind');
  assert.deepEqual(createMechanicGuide(oldProgress, CAMPAIGN[19], 'campaign'), { ids: ['bridge', 'light'], phase: 0 },
    'later maps introduce only new types from the first explanation stage');
  assert.equal(createMechanicGuide(oldProgress, CAMPAIGN[1], 'campaign'), null, 'a map without new props has no mechanic guide');
  const displayed = { mechanicGuides: { wind: true } };
  assert.equal(createMechanicGuide(displayed, CAMPAIGN[12], 'campaign'), null, 'an already displayed type never creates another introduction');
  assert.equal(createMechanicGuide({}, CAMPAIGN[19], 'daily'), null);
});

test('wind inspection targets the real one-push landing and explains blocked and non-chained winds', () => {
  const l = CAMPAIGN[12], before = createState(l), intro = lesson(l), detail = lesson(l, 1);
  assert.equal(intro.visual.tapCell, Number(Object.keys(l.winds)[0]));
  assert.equal(detail.visual.tapCell, neighbor(l, intro.visual.tapCell, l.winds[intro.visual.tapCell], before));
  assert.equal(detail.visual.fromCell, intro.visual.tapCell);
  assert.match(detail.text, /只扣 1 拍，不连续吹/);
  assert.match(detail.tip, /等待不会触发风/);
  const blocked = { ...l, walls: [...l.walls, detail.visual.tapCell] };
  assert.match(lesson(blocked, 1).text, /前方被挡/);
  assert.equal(lesson(blocked, 1).visual.tapCell, intro.visual.tapCell);
  assert.deepEqual(before, createState(l));
});

test('lamp and bridge previews follow usable props and explain already used legacy state accurately', () => {
  const l = CAMPAIGN[19], profile = { mechanicGuides: { wind: true, bridge: true } };
  const start = createState(l), first = lesson(l, 1, start, profile);
  assert.match(first.text, /移动扣 1 拍后补 3 拍/);
  assert.ok(start.lights.includes(first.visual.tapCell));
  let state = start;
  for (const action of l.solution) {
    const next = step(l, state, action).state;
    if (next.status !== 'playing') break;
    state = next;
    if (!state.lights.length) break;
  }
  assert.equal(state.lights.length, 0);
  assert.match(lesson(l, 1, state, profile).text, /已在本次路线中用过/);
  const bridge = CAMPAIGN[20], bridgeProfile = { mechanicGuides: { wind: true } };
  assert.match(lesson(bridge, 1, createState(bridge), bridgeProfile).text, /离开后，桥就会碎/);
  const collapsed = replay(bridge, bridge.solution.slice(0, -1));
  assert.equal(collapsed.bridges.length, 0);
  assert.match(lesson(bridge, 1, collapsed, bridgeProfile).text, /已经碎了/);
});

test('mechanic knowledge is validated, independently persisted, cloned, reset and retried after storage failure', () => {
  const data = new Map([[PROFILE_KEY, { version: 1, completed: {}, daily: {}, totalWins: 0,
    guideDismissed: true, mechanicGuides: { wind: true, light: 'true', bridge: false, unknown: true } }]]);
  let fail = false;
  const adapter = { get: key => data.get(key), set: (key, value) => { if (fail) throw new Error('quota'); data.set(key, value); }, remove: key => data.delete(key) };
  const store = createStore(adapter);
  assert.deepEqual(store.getProfile().mechanicGuides, { wind: true });
  assert.equal(store.markMechanicSeen('__proto__'), false);
  fail = true; assert.equal(store.markMechanicSeen('light'), false);
  assert.equal(store.getProfile().mechanicGuides.light, true);
  fail = false; store.flush();
  const reloaded = createStore(adapter);
  assert.deepEqual(reloaded.getProfile().mechanicGuides, { wind: true, light: true });
  const snapshot = reloaded.getProfile(); snapshot.mechanicGuides.bridge = true;
  assert.equal(reloaded.getProfile().mechanicGuides.bridge, undefined);
  reloaded.reset(); assert.equal(reloaded.getProfile().mechanicGuides, undefined);
});
