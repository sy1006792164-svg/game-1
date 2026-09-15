'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, replay, neighbor, step } = require('../src/engine');
const { availableMechanics, createMechanicGuide, mechanicStep, triggeredMechanics } = require('../src/mechanic-guide');
const { createStore, PROFILE_KEY } = require('../src/storage');

function lesson(level, phase = 0, state = createState(level), profile = {}) {
  return mechanicStep({ level, state, mechanicGuide: { ...createMechanicGuide(profile, level, 'campaign'), phase } });
}

test('first appearance follows all five actual mechanic types across the shipped maps', () => {
  assert.deepEqual(['supply', 'order', 'wind', 'bridge', 'light'].map(id => CAMPAIGN.find(l => availableMechanics(l).includes(id)).id), [4, 9, 13, 16, 19]);
  assert.deepEqual(availableMechanics(CAMPAIGN[19]), ['supply', 'wind', 'bridge', 'light']);
  assert.deepEqual(availableMechanics(CAMPAIGN[19], 'daily'), []);
  assert.equal(createMechanicGuide({ mechanicGuides: { wind: true, bridge: true, light: true, supply: true } }, CAMPAIGN[19], 'campaign'), null);
  assert.deepEqual(createMechanicGuide({ completed: { 999: {} }, guideDismissed: true }, CAMPAIGN[19], 'campaign').ids, ['supply', 'wind', 'bridge', 'light'],
    'invalid records and first-route dismissal cannot suppress an unseen mechanic');
  assert.deepEqual(createMechanicGuide({ completed: { 999: { stars: 3, bestTurns: 0 } } }, CAMPAIGN[19], 'campaign').ids,
    ['supply', 'wind', 'bridge', 'light'], 'an impossible zero-turn win cannot suppress a mechanic introduction');
  const oldProgress = { completed: { 13: { stars: 3, bestTurns: CAMPAIGN[12].par } } };
  assert.deepEqual(createMechanicGuide(oldProgress, CAMPAIGN[13], 'campaign'), { ids: ['supply'], phase: 0 },
    'a completed wind map suppresses only wind; the new station still needs its own introduction');
  assert.deepEqual(createMechanicGuide(oldProgress, CAMPAIGN[19], 'campaign'), { ids: ['supply', 'bridge', 'light'], phase: 0 },
    'later maps introduce only new types from the first explanation stage');
  assert.equal(createMechanicGuide(oldProgress, CAMPAIGN[1], 'campaign'), null, 'a map without new props has no mechanic guide');
  const displayed = { mechanicGuides: { wind: true } };
  assert.equal(createMechanicGuide(displayed, CAMPAIGN[12], 'campaign'), null, 'an already displayed type never creates another introduction');
  assert.equal(createMechanicGuide({}, CAMPAIGN[19], 'daily'), null);
});

function beforeEncounter(level, id) {
  let state = createState(level);
  for (const action of level.solution) {
    const result = step(level, state, action);
    if (triggeredMechanics(level, state, action, result).includes(id)) return { state, action, result };
    state = result.state;
  }
  assert.fail('Missing real encounter: ' + id);
}

test('mechanic lessons appear beside a real playable encounter and never change its state', () => {
  for (const [id, index] of [['supply', 3], ['order', 8], ['wind', 12], ['bridge', 15], ['light', 18]]) {
    const level = CAMPAIGN[index], { state, action, result } = beforeEncounter(level, id);
    const snapshot = JSON.stringify(state), game = { level, state, mechanicGuide: { ids: [id], phase: 0 } };
    const guide = mechanicStep(game);
    assert.equal(guide.interactive, true);
    assert.equal(guide.mechanic, id);
    assert.equal(guide.control, null, 'there is no extra confirmation before the move');
    assert.equal(guide.visual.tapCell, neighbor(level, state.player, guide.action, state));
    assert.ok(triggeredMechanics(level, state, guide.action, step(level, state, guide.action)).includes(id));
    assert.equal(JSON.stringify(state), snapshot);
    assert.equal(game.mechanicGuide.ids[0], id, 'display does not consume the lesson');
    assert.ok(triggeredMechanics(level, state, action, result).includes(id));
  }
  assert.equal(lesson(CAMPAIGN[12]), null, 'a distant wind does not interrupt departure');
});

test('wind and bridge guidance describes the actual next action, including stopped wind', () => {
  const level = CAMPAIGN[12], { state } = beforeEncounter(level, 'wind');
  const game = { level, state, mechanicGuide: { ids: ['wind'], phase: 0 } };
  const guide = mechanicStep(game), landing = step(level, state, guide.action).state.player;
  assert.match(guide.text, /只扣 1 拍/);
  const stopped = { ...level, walls: [...level.walls, landing] };
  const blockedGuide = mechanicStep({ ...game, level: stopped });
  assert.match(blockedGuide.text, /前方被挡/);
  assert.equal(blockedGuide.visual.tapCell, guide.visual.tapCell);
  const bridge = CAMPAIGN[20], encounter = beforeEncounter(bridge, 'bridge');
  const bridgeGuide = mechanicStep({ level: bridge, state: encounter.state, mechanicGuide: { ids: ['bridge'], phase: 0 } });
  assert.equal(bridgeGuide.visual.focus.cell, encounter.state.player, 'warn about the bridge the courier is leaving');
  assert.match(bridgeGuide.text, /身后的桥.*回声仍可通过/);
  const collapsed = replay(bridge, bridge.solution.slice(0, -1));
  assert.equal(mechanicStep({ level: bridge, state: collapsed, mechanicGuide: { ids: ['bridge'], phase: 0 } }), null);
});

test('station and numbered-letter knowledge require the real event or an explicit skip', () => {
  for (const [level, id] of [[CAMPAIGN[3], 'supply'], [CAMPAIGN[8], 'order']]) {
    const oldProgress = { completed: { [level.id]: { stars: 3, bestTurns: level.par } } };
    assert.deepEqual(createMechanicGuide(oldProgress, level, 'campaign'), { ids: [id], phase: 0 },
      'old completion records do not prove the newly added rule was explained');
    assert.equal(createMechanicGuide({ ...oldProgress, mechanicGuides: { [id]: true } }, level, 'campaign'), null,
      'only an explicitly seen new mechanic is suppressed');
    const { state, action, result } = beforeEncounter(level, id);
    const guide = mechanicStep({ level, state, mechanicGuide: { ids: [id], phase: 0 } });
    assert.equal(guide.mechanic, id);
    if (id === 'supply') {
      assert.match(guide.text, /免费领取.*1 份.*无需看视频/);
      assert.equal(result.state.inventory[result.events.find(event => event.type === 'supply').item], 1);
    } else {
      assert.match(guide.text, /提前经过后面的信不会收取/);
      assert.equal(result.state.letters.length, state.letters.length - 1);
    }
    assert.deepEqual(triggeredMechanics(level, state, 'wait', step(level, state, 'wait')), [], 'waiting is not practicing an adjacent mechanism');
    assert.ok(triggeredMechanics(level, state, action, result).includes(id));
  }
});

test('mechanic knowledge is validated, independently persisted, cloned, reset and retried after storage failure', () => {
  const data = new Map([[PROFILE_KEY, { version: 1, completed: {}, daily: {}, totalWins: 0,
    guideDismissed: true, mechanicGuides: { wind: true, light: 'true', bridge: false, supply: 'true', order: false, unknown: true } }]]);
  let fail = false;
  const adapter = { get: key => data.get(key), set: (key, value) => { if (fail) throw new Error('quota'); data.set(key, value); }, remove: key => data.delete(key) };
  const store = createStore(adapter);
  assert.deepEqual(store.getProfile().mechanicGuides, { wind: true });
  assert.equal(store.markMechanicSeen('__proto__'), false);
  fail = true; assert.equal(store.markMechanicSeen('light'), false);
  assert.equal(store.getProfile().mechanicGuides.light, true);
  fail = false; store.flush();
  assert.equal(store.markMechanicSeen('supply'), true);
  assert.equal(store.markMechanicSeen('order'), true);
  const reloaded = createStore(adapter);
  assert.deepEqual(reloaded.getProfile().mechanicGuides, { wind: true, light: true, supply: true, order: true });
  const snapshot = reloaded.getProfile(); snapshot.mechanicGuides.bridge = true;
  assert.equal(reloaded.getProfile().mechanicGuides.bridge, undefined);
  reloaded.reset(); assert.equal(reloaded.getProfile().mechanicGuides, undefined);
});
