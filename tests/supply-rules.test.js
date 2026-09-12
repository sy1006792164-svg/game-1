'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { SUPPLY_ENERGY, RELIGHT_ACTION, normalizeSupplyPolicy } = require('../src/supply-rules');
const { createState, step, replay, revive, reviveEnergy, isAction, stars } = require('../src/engine');
const { ITEMS, parseItemAction } = require('../src/items');
const { createStore } = require('../src/storage');

function board(overrides = {}) {
  return { id: 16, width: 5, height: 3, start: 0, exit: 14, walls: [], letters: [4], seals: [],
    lights: [], bridges: [], winds: {}, budget: 2, par: 10, ...overrides };
}
const policy = (legacyActionCount = 0, legacyReviveCount = 0) => ({ version: 2, legacyActionCount, legacyReviveCount });
function store() {
  const saved = new Map();
  return createStore({ get: key => saved.get(key), set: (key, value) => saved.set(key, value), remove: key => saved.delete(key) });
}

test('supply policy normalizes strict bounded records including native WeChat-realm objects', () => {
  assert.deepEqual(normalizeSupplyPolicy(undefined, 0, 0), policy());
  const before = policy(3, 1), clean = normalizeSupplyPolicy(before, 5, 2);
  assert.deepEqual(clean, before); assert.notEqual(clean, before);
  assert.deepEqual(normalizeSupplyPolicy(vm.runInNewContext('({ version: 2, legacyActionCount: 3, legacyReviveCount: 1 })'), 5, 2), before);
  assert.deepEqual(normalizeSupplyPolicy(Object.assign(Object.create(null), before), 5, 2), before);
  let reads = 0;
  const getter = { ...before };
  Object.defineProperty(getter, 'legacyActionCount', { enumerable: true, get() { reads++; return 3; } });
  const hidden = { ...before };
  Object.defineProperty(hidden, 'legacyActionCount', { enumerable: false });
  const customRoot = Object.create(null);
  Object.defineProperty(customRoot, 'constructor', { get() { reads++; return Object; } });
  const bad = [null, true, 2, [], {}, { version: 2 }, policy(6, 0), policy(0, 3), policy(-1, 0), policy(0, -1),
    { ...before, version: 1 }, { ...before, version: '2' }, policy(1.5, 0), policy('3', 0), policy(NaN, 0),
    policy(Infinity, 0), policy(Number.MAX_SAFE_INTEGER + 1, 0), { ...before, extra: 0 }, getter, hidden,
    { ...before, [Symbol('hidden')]: 1 }, JSON.parse('{"version":2,"legacyActionCount":0,"legacyReviveCount":0,"__proto__":0}'),
    Object.assign(Object.create({ inherited: true }), before), Object.assign(Object.create(customRoot), before),
    Object.assign(Object.create(Object.create(null)), before), new (class Policy { constructor() { Object.assign(this, before); } })()];
  for (const value of bad) assert.throws(() => normalizeSupplyPolicy(value, 5, 2), /invalid supply policy/);
  for (const [actions, revivals] of [[-1, 0], [0, -1], [1.5, 0], [0, Infinity], [undefined, 0], ['5', 0]])
    assert.throws(() => normalizeSupplyPolicy(undefined, actions, revivals), /invalid supply policy/);
  assert.equal(reads, 0);
});

test('new oil and video relights both give six while old versions and map lanterns retain their original amounts', () => {
  assert.equal(SUPPLY_ENERGY, 6);
  assert.match(ITEMS.find(item => item.id === 'oil').short, /\+6/);
  for (const budget of [1, 8, 30, 99]) assert.equal(reviveEnergy(board({ budget })), 6);
  assert.equal(reviveEnergy(board({ budget: 1 }), 1), 8);
  assert.equal(reviveEnergy(board({ budget: 30 }), 1), 15);
  const level = board({ lights: [1] }), state = createState(level, { oil: 1 });
  const current = step(level, state, 'item:oil'), legacy = step(level, state, 'item:oil', 1);
  assert.equal(current.state.energy, state.energy + 6);
  assert.equal(legacy.state.energy, state.energy + 3);
  assert.deepEqual(current.events[1], { type: 'light', cell: 0, amount: 6, source: 'oil' });
  assert.deepEqual(legacy.events[1], { type: 'light', cell: 0, amount: 3, source: 'oil' });
  const lantern = step(level, state, 'right');
  assert.equal(lantern.state.energy, state.energy - 1 + 3);
  assert.deepEqual(lantern.events.find(event => event.type === 'light'), { type: 'light', cell: 1 });
  assert.equal(createState(board({ lights: [0] })).energy, 5);
});

test('owned oil relights a failed route without moving the courier or advancing the three-turn echo', () => {
  const level = board({ seals: [0], bridges: [0], winds: { 0: 'right' } });
  const failed = replay(level, ['wait', 'wait'], [], { oil: 2 });
  const before = JSON.stringify(failed), result = step(level, failed, RELIGHT_ACTION), next = result.state;
  assert.equal(result.moved, true);
  assert.equal(next.status, 'playing'); assert.equal(next.energy, 6);
  assert.equal(next.inventory.oil, 1); assert.equal(next.itemsUsed, 1);
  assert.equal(next.revived, true); assert.equal(next.reviveCount, 1);
  for (const key of ['player', 'echo', 'history', 'turn', 'letters', 'seals', 'lights', 'bridges']) assert.deepEqual(next[key], failed[key], key);
  assert.deepEqual(result.events, [{ type: 'item', item: 'oil', cell: 0 },
    { type: 'light', cell: 0, amount: 6, source: 'oil' }, { type: 'relight', cell: 0 }]);
  assert.equal(JSON.stringify(failed), before);
  assert.equal(stars(level, next), 2);
  assert.equal(step(level, next, RELIGHT_ACTION).moved, false, 'playing routes cannot use the failure-only action');
  const moved = step(level, next, 'wait').state;
  assert.equal(moved.turn, 3); assert.equal(moved.echo, 0); assert.deepEqual(moved.seals, []);
  let secondFailure = next;
  for (let i = 0; i < 6; i++) secondFailure = step(level, secondFailure, 'wait').state;
  const second = step(level, secondFailure, RELIGHT_ACTION).state;
  assert.equal(second.reviveCount, 2); assert.equal(second.itemsUsed, 2); assert.equal(second.inventory.oil, 0);
});

test('relight actions are canonical, failure-only and cannot grant or bypass earned stock', () => {
  const level = board(), empty = replay(level, ['wait', 'wait']);
  assert.equal(isAction(RELIGHT_ACTION), true);
  assert.equal(parseItemAction(RELIGHT_ACTION), null, 'relighting is its own logged action, not a normal item use');
  for (const action of ['relight', 'relight:kite', 'relight:oil:1', 'relight:oil\n', 'relight:Oil', 'relight:oil ']) assert.equal(isAction(action), false);
  for (const state of [empty, { ...empty, status: 'won', inventory: { oil: 1 } },
    { ...empty, status: 'playing', inventory: { oil: 1 } }, ...[0, -1, 1.5, '1', 4097].map(oil => ({ ...empty, inventory: { oil } }))]) {
    const result = step(level, state, RELIGHT_ACTION);
    assert.equal(result.moved, false); assert.equal(result.state, state); assert.deepEqual(result.events, []);
  }
  assert.throws(() => replay(level, ['wait', 'wait', RELIGHT_ACTION]), /invalid action/);
});

test('owned relights and video revivals replay independently without duplicating rewards or echo turns', () => {
  const level = board(), actions = ['wait', 'wait', RELIGHT_ACTION, ...Array(6).fill('wait'), 'wait'];
  const rewards = { oil: 1 }, history = [9], current = replay(level, actions, history, rewards, policy());
  assert.equal(current.status, 'playing'); assert.equal(current.energy, 5);
  assert.equal(current.turn, 9); assert.equal(current.history.length, 10);
  assert.equal(current.reviveCount, 2); assert.equal(current.itemsUsed, 1); assert.equal(current.inventory.oil, 0);
  assert.deepEqual(history, [9]); assert.deepEqual(rewards, { oil: 1 });
  assert.throws(() => replay(level, actions, [2, 9], rewards, policy()), /invalid action/,
    'one failure cannot pay both a video revival and an owned-oil relight');
  const local = store(), saved = { mode: 'campaign', levelId: level.id, actions, reviveHistory: history, itemRewards: rewards, supplyPolicy: policy() };
  assert.equal(local.saveRun(saved), true);
  const restored = local.loadRun();
  assert.deepEqual(replay(level, restored.actions, restored.reviveHistory, restored.itemRewards, restored.supplyPolicy), current);
});

test('mixed replay preserves a migrated three-energy oil and old video amount, then uses six for new supplies', () => {
  const level = board(), originalActions = ['item:oil', ...Array(5).fill('wait')];
  const migrated = policy(originalActions.length, 1), rewards = { oil: 2 };
  let direct = createState(level, rewards);
  for (const action of originalActions) direct = step(level, direct, action, 1).state;
  assert.equal(direct.status, 'failed');
  direct = revive(level, direct, 1);
  assert.equal(direct.energy, 8);
  assert.deepEqual(replay(level, originalActions, [6], rewards, migrated), direct);
  const actions = originalActions.concat('item:oil', ...Array(14).fill('wait'), 'wait');
  const mixed = replay(level, actions, [6, 21], rewards, migrated);
  assert.equal(mixed.energy, 5); assert.equal(mixed.status, 'playing');
  assert.equal(mixed.turn, 20); assert.equal(mixed.itemsUsed, 2); assert.equal(mixed.reviveCount, 2);
  assert.deepEqual(mixed.inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.throws(() => replay(level, originalActions, [6], rewards), /invalid revive/, 'unversioned replay defaults to new supplies');
});

test('migration boundaries reject impossible old/new event ordering but allow a new video at the exact old boundary', () => {
  const level = board({ budget: 1 });
  assert.equal(replay(level, ['wait'], [1], undefined, policy(1, 0)).energy, 6);
  assert.equal(replay(level, ['wait'], [1], undefined, policy(1, 1)).energy, 8);
  assert.throws(() => replay(level, ['wait'], [1], undefined, policy(0, 1)), /invalid supply policy/);
  assert.throws(() => replay(level, ['wait', 'wait'], [1], undefined, policy(2, 0)), /invalid supply policy/);
  assert.throws(() => replay(level, ['wait', RELIGHT_ACTION], [], { oil: 1 }, policy(2, 0)), /invalid supply policy/);
  assert.throws(() => replay(level, [], [], undefined, policy(1, 0)), /invalid supply policy/);
});

test('truncating a legacy action prefix before branching keeps old oil at three and appended oil at six', () => {
  const level = board(), rewards = { oil: 2 }, original = ['item:oil', 'wait'], savedPolicy = policy(2, 0);
  const shorter = original.slice(0, -1), clamped = { ...savedPolicy, legacyActionCount: Math.min(savedPolicy.legacyActionCount, shorter.length) };
  assert.equal(replay(level, shorter, [], rewards, clamped).energy, level.budget + 3);
  assert.equal(replay(level, shorter.concat('item:oil'), [], rewards, clamped).energy, level.budget + 9);
  assert.deepEqual(savedPolicy, policy(2, 0));
});

test('storage validates supply metadata before cleaning unknown keys and leaves old saves available for migration', () => {
  const local = store(), valid = { mode: 'campaign', levelId: 16, actions: ['wait'], reviveHistory: [1], supplyPolicy: policy(1, 1) };
  assert.equal(local.saveRun(valid), true);
  let reads = 0;
  const getter = { ...policy() };
  Object.defineProperty(getter, 'version', { enumerable: true, get() { reads++; return 2; } });
  for (const supplyPolicy of [null, {}, [], policy(2, 0), policy(0, 2), { ...policy(), extra: 1 }, getter,
    JSON.parse('{"version":2,"legacyActionCount":0,"legacyReviveCount":0,"constructor":1}'),
    Object.assign(Object.create(Object.create(null)), policy())]) {
    assert.equal(local.saveRun({ ...valid, supplyPolicy }), false);
    assert.deepEqual(local.loadRun(), valid);
  }
  assert.equal(reads, 0);
  assert.equal(local.saveRun({ mode: 'campaign', levelId: 16, state: {}, supplyPolicy: policy() }), false);
  assert.equal(local.saveRun({ ...valid, actions: ['teleport'] }), false);
  assert.equal(local.saveRun({ ...valid, reviveHistory: [2] }), false);
  const old = { mode: 'campaign', levelId: 16, actions: ['wait'], reviveAt: 1 };
  assert.equal(local.saveRun(old), true);
  assert.deepEqual(local.loadRun(), old, 'the controller must still be able to recognize missing metadata');
});
