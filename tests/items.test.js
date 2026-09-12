'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, createState, isAction, step, replay, revive, stars, scoredTurns } = require('../src/engine');
const { ITEMS, initialInventory, normalizeItemRewards, itemTargets, itemOffer, itemAvailability, itemAction, parseItemAction } = require('../src/items');
const { createStore } = require('../src/storage');

function board(overrides = {}) {
  return { id: 16, width: 5, height: 4, start: 6, exit: 19, letters: [8, 16], seals: [],
    lights: [], bridges: [], walls: [], winds: {}, budget: 12, par: 6, ...overrides };
}

// These effect fixtures explicitly model completed videos, never free stock.
function earnedRewards(level) {
  return { oil: level.id >= 4 ? 1 : 0, kite: level.id >= 7 ? 1 : 0,
    bridge: level.id >= 16 && level.bridges.length ? 1 : 0 };
}
function rewardedState(level) { return createState(level, earnedRewards(level)); }
function rewardedReplay(level, actions, revivals) { return replay(level, actions, revivals, earnedRewards(level)); }

function memory() {
  const values = new Map();
  return { get: key => values.get(key), set: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))), remove: key => values.delete(key) };
}

function assertUnchanged(level, state, action) {
  const before = JSON.stringify(state);
  const result = step(level, state, action);
  assert.equal(result.state, state, String(action));
  assert.equal(result.moved, false, String(action));
  assert.deepEqual(result.events, [], String(action));
  assert.equal(JSON.stringify(state), before);
}

test('new routes always start empty; completed-video rewards are scoped to unlocked relevant items', () => {
  assert.deepEqual(ITEMS.map(item => [item.id, item.unlock]), [['oil', 4], ['kite', 7], ['bridge', 16]]);
  assert.ok(ITEMS.every(item => item.description.includes('不耗拍')));
  assert.deepEqual(initialInventory(board({ id: 3, bridges: [7] })), { oil: 0, kite: 0, bridge: 0 });
  for (const id of [4, 7, 15, 16, 999]) assert.deepEqual(initialInventory(board({ id, bridges: [7] })), { oil: 0, kite: 0, bridge: 0 });
  assert.deepEqual(initialInventory(board({ id: 4 }), { oil: 1 }), { oil: 1, kite: 0, bridge: 0 });
  assert.deepEqual(initialInventory(board({ id: 7 }), { oil: 1, kite: 1 }), { oil: 1, kite: 1, bridge: 0 });
  assert.deepEqual(initialInventory(board({ bridges: [7] }), { oil: 1, kite: 1, bridge: 1 }), { oil: 1, kite: 1, bridge: 1 });
  const level = board(), first = rewardedState(level), second = rewardedState(level);
  first.inventory.oil = 0;
  assert.equal(second.inventory.oil, 1);
  assert.equal(second.itemsUsed, 0);
});

test('an eligible video offer never grants inventory or authorizes item use by itself', () => {
  const level = board({ bridges: [6] }), state = createState(level), before = JSON.stringify(state);
  assert.deepEqual(state.inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.deepEqual(itemOffer(level, state, 'oil'), { eligible: true, reason: '', targets: [6] });
  assert.deepEqual(itemOffer(level, state, 'kite').targets, [8, 16]);
  assert.equal(itemOffer(level, state, 'bridge').eligible, false, 'there is no torn bridge to repair yet');
  assert.equal(itemOffer(level, step(level, state, 'right').state, 'bridge').eligible, true);
  for (const id of ['oil', 'kite', 'bridge']) assert.equal(itemAvailability(level, state, id).available, false);
  assertUnchanged(level, state, 'item:oil');
  assertUnchanged(level, state, 'item:kite:8');
  assert.equal(itemOffer(board({ id: 3 }), state, 'oil').eligible, false);
  assert.equal(itemOffer(level, { ...state, status: 'failed' }, 'oil').eligible, false);
  assert.equal(itemOffer(level, { ...state, status: 'won' }, 'kite').eligible, false);
  assert.equal(itemOffer(board(), state, 'bridge').eligible, false);
  assert.equal(JSON.stringify(state), before);
});

test('reward ledgers require known own data properties and bounded earned counts without reading getters', () => {
  const level = board({ bridges: [7] }), empty = { oil: 0, kite: 0, bridge: 0 };
  assert.deepEqual(normalizeItemRewards(level), empty);
  assert.deepEqual(normalizeItemRewards(level, {}), empty);
  assert.deepEqual(normalizeItemRewards(level, { oil: 4096, kite: 2 }), { oil: 4096, kite: 2, bridge: 0 });
  assert.deepEqual(normalizeItemRewards(null, { bridge: 1 }), { oil: 0, kite: 0, bridge: 1 }, 'storage can validate structure before resolving a level');
  const valid = { oil: 2 }, normalized = normalizeItemRewards(level, valid);
  valid.oil = 99;
  assert.equal(normalized.oil, 2);
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'oil', { get() { reads++; return 1; } });
  const hidden = {};
  Object.defineProperty(hidden, 'oil', { value: 1 });
  const bad = [null, false, 1, 'oil', [], { oil: -1 }, { oil: 4097 }, { oil: 1.5 }, { oil: '1' },
    { oil: NaN }, { oil: Infinity }, { oil: Number.MAX_SAFE_INTEGER + 1 }, { oil: undefined }, { extra: 0 },
    { constructor: 1 }, JSON.parse('{"__proto__":0}'), { [Symbol('oil')]: 1 }, accessor, hidden,
    Object.create({ oil: 1 }), new (class Rewards { constructor() { this.oil = 1; } })()];
  for (const rewards of bad) assert.throws(() => normalizeItemRewards(level, rewards), /invalid item rewards/);
  assert.equal(reads, 0);
  assert.throws(() => createState(board({ id: 3 }), { oil: 1 }), /invalid item rewards/);
  assert.throws(() => createState(board({ id: 6 }), { kite: 1 }), /invalid item rewards/);
  assert.throws(() => createState(board({ id: 15, bridges: [7] }), { bridge: 1 }), /invalid item rewards/);
  assert.throws(() => createState(board({ id: 999 }), { bridge: 1 }), /invalid item rewards/);
  assert.deepEqual(createState(board({ id: 1 }), empty).inventory, empty, 'zero counts remain valid before unlocking');
});

test('each completed video supplies one separately spendable charge and actions cannot manufacture rewards', () => {
  const level = board(), rewards = { oil: 2, kite: 2 };
  const state = replay(level, ['item:oil', 'item:oil', 'item:kite:8', 'item:kite:16'], [], rewards);
  assert.deepEqual(state.inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.equal(state.energy, level.budget + 12);
  assert.equal(state.itemsUsed, 4);
  assert.equal(state.turn, 0);
  assert.deepEqual(rewards, { oil: 2, kite: 2 });
  assert.throws(() => replay(level, ['item:oil']), /invalid action/);
  assert.throws(() => replay(level, ['item:oil'], [], { oil: 0 }), /invalid action/);
  assert.throws(() => replay(level, ['item:oil', 'item:oil', 'item:oil'], [], rewards), /invalid action/);
  for (const action of ['grant:oil', 'item:grant:oil', 'reward:oil', 'item:oil:1']) {
    assert.equal(isAction(action), false);
    assert.throws(() => replay(level, [action], [], rewards), /invalid action/);
  }
  const maximum = createState(level, { oil: 4096 });
  assert.equal(step(level, maximum, 'item:oil').state.inventory.oil, 4095);
  for (const stock of [4097, 1.5, -1, '1']) assertUnchanged(level, { ...maximum, inventory: { ...maximum.inventory, oil: stock } }, 'item:oil');
});

test('undo preserves completed-video earnings while retrying or changing routes starts with zero stock', () => {
  const level = board(), rewards = { oil: 2, kite: 1 }, actions = ['wait', 'item:oil'];
  const afterUse = replay(level, actions, [], rewards);
  const undone = replay(level, actions.slice(0, -1), [], rewards);
  assert.equal(afterUse.inventory.oil, 1);
  assert.equal(undone.inventory.oil, 2);
  assert.equal(undone.inventory.kite, 1, 'unspent video rewards survive undo too');
  assert.equal(undone.itemsUsed, 0);
  assert.equal(undone.energy, level.budget - 1);
  assert.deepEqual(replay(level, [], [], rewards).inventory, { oil: 2, kite: 1, bridge: 0 });
  assert.deepEqual(createState(level).inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.deepEqual(createState(board({ id: 17 })).inventory, { oil: 0, kite: 0, bridge: 0 });
});

test('storage rejects malformed reward histories and state-only grants while preserving the previous save', () => {
  const level = board(), adapter = memory(), store = createStore(adapter);
  const valid = { mode: 'campaign', levelId: level.id, actions: ['item:oil'], reviveHistory: [], itemRewards: { oil: 1 } };
  assert.equal(store.saveRun(valid), true);
  const loaded = createStore(adapter).loadRun();
  assert.equal(replay(level, loaded.actions, loaded.reviveHistory, loaded.itemRewards).itemsUsed, 1);
  let reads = 0;
  const accessor = { get oil() { reads++; return 1; } };
  for (const itemRewards of [null, [], { oil: -1 }, { oil: 4097 }, { kite: 1.1 }, { oil: '1' },
    { extra: 0 }, { constructor: 1 }, JSON.parse('{"__proto__":0}'), accessor]) {
    assert.equal(store.saveRun({ ...valid, itemRewards }), false);
    assert.deepEqual(store.loadRun(), valid);
  }
  assert.equal(reads, 0);
  assert.equal(store.saveRun({ mode: 'campaign', levelId: level.id, itemRewards: { oil: 1 }, state: {} }), false);
  assert.equal(store.saveRun({ mode: 'campaign', levelId: level.id, state: { inventory: { oil: 99 } } }), false);
  const legacy = { mode: 'campaign', levelId: level.id, actions: ['wait'], state: { inventory: { oil: 99 } } };
  assert.equal(store.saveRun(legacy), true);
  const old = createStore(adapter).loadRun();
  assert.deepEqual(replay(level, old.actions, [], old.itemRewards).inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.throws(() => replay(level, ['item:oil'], [], old.itemRewards), /invalid action/, 'old free-item saves cannot replay without completed-video rewards');
});

test('saved item actions accept only canonical IDs and safe nonnegative integer cells', () => {
  assert.deepEqual(ACTIONS, ['up', 'down', 'left', 'right', 'wait'], 'the optimal solver never receives assisted actions');
  for (const action of ['item:oil', 'item:kite:0', 'item:kite:23', 'item:bridge:7']) assert.equal(isAction(action), true);
  assert.deepEqual(parseItemAction('item:oil'), { id: 'oil', cell: null });
  assert.deepEqual(parseItemAction('item:kite:0'), { id: 'kite', cell: 0 });
  assert.equal(itemAction('oil'), 'item:oil');
  assert.equal(itemAction('bridge', 0), 'item:bridge:0');
  const invalid = ['item', 'item:oil:0', 'item:kite', 'item:kite:', 'item:kite:-1', 'item:kite:-0',
    'item:kite:+1', 'item:kite:01', 'item:kite:1.0', 'item:kite:1e1', 'item:kite: 1', 'item:kite:1 ',
    'item:kite:1\n', 'item:bridge:2\r\n', 'item:kite:9007199254740992', 'item:__proto__:1',
    'item:constructor:0', 'item:KITE:1', {}, [], null, 1, true];
  for (const action of invalid) {
    assert.equal(parseItemAction(action), null, JSON.stringify(action));
    assert.equal(isAction(action), false, JSON.stringify(action));
  }
  for (const cell of [-1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) assert.equal(itemAction('kite', cell), null);
  assert.equal(itemAction('__proto__', 0), null);
});

test('oil grants exactly six energy without advancing route, echo or collections, once only', () => {
  const level = board({ seals: [6], bridges: [6], winds: { 6: 'right' } });
  const before = rewardedReplay(level, ['wait', 'wait']);
  Object.freeze(before.inventory); Object.freeze(before.history); Object.freeze(before);
  const result = step(level, before, 'item:oil'), after = result.state;
  assert.equal(result.moved, true);
  assert.equal(after.energy, before.energy + 6);
  assert.equal(after.turn, before.turn);
  assert.equal(after.player, before.player);
  assert.equal(after.echo, before.echo);
  for (const key of ['history', 'letters', 'seals', 'lights', 'bridges']) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.inventory, { oil: 0, kite: 1, bridge: 1 });
  assert.equal(after.itemsUsed, 1);
  assert.deepEqual(result.events, [{ type: 'item', item: 'oil', cell: 6 }, { type: 'light', cell: 6, amount: 6, source: 'oil' }]);
  assertUnchanged(level, after, 'item:oil');
  const nextMove = step(level, after, 'wait').state;
  assert.equal(nextMove.turn, 3);
  assert.equal(nextMove.echo, 6);
  assert.deepEqual(nextMove.seals, [], 'only the next actual turn advances the waiting echo');
});

test('kite reaches a chosen letter within two Manhattan cells across walls without triggering its tile', () => {
  const level = board({ start: 6, letters: [0, 8, 12, 16, 9], walls: [7], lights: [8], seals: [8],
    bridges: [6], winds: { 8: 'down' } });
  const before = rewardedState(level);
  assert.deepEqual(itemTargets(level, before, 'kite'), [0, 8, 12, 16]);
  const result = step(level, before, 'item:kite:8'), after = result.state;
  assert.equal(after.player, 6);
  assert.equal(after.energy, before.energy);
  assert.equal(after.turn, 0);
  assert.equal(after.echo, null);
  assert.deepEqual(after.history, [6]);
  assert.deepEqual(after.letters, [0, 12, 16, 9]);
  assert.deepEqual(after.lights, [8]);
  assert.deepEqual(after.seals, [8]);
  assert.deepEqual(after.bridges, [6]);
  assert.deepEqual(result.events, [{ type: 'item', item: 'kite', cell: 8 }, { type: 'letter', cell: 8 }]);
  assertUnchanged(level, after, 'item:kite:0');
  assert.deepEqual(before.letters, [0, 8, 12, 16, 9], 'the previous route remains available for undo');
});

test('kite rejects distant, wrapped, empty and out-of-board targets without losing its charge', () => {
  const level = board({ start: 4, letters: [0, 5, 14, 18] }), state = rewardedState(level);
  assert.deepEqual(itemTargets(level, state, 'kite'), [14]);
  for (const action of ['item:kite:0', 'item:kite:5', 'item:kite:3', 'item:kite:18', 'item:kite:20', 'item:kite:999999']) assertUnchanged(level, state, action);
  assert.equal(state.inventory.kite, 1);
  assert.equal(step(level, state, 'item:kite:14').moved, true);
});

test('target cell zero is collected correctly and a remote final letter can complete delivery immediately', () => {
  const level = board({ start: 6, exit: 6, letters: [0], budget: 1 }), before = rewardedState(level);
  const result = step(level, before, 'item:kite:0');
  assert.equal(result.state.status, 'won');
  assert.equal(result.state.turn, 0);
  assert.equal(result.state.energy, 1);
  assert.deepEqual(result.events, [{ type: 'item', item: 'kite', cell: 0 }, { type: 'letter', cell: 0 }, { type: 'win', cell: 6 }]);
  const unsealed = board({ start: 6, exit: 6, letters: [0], seals: [6] });
  assert.equal(step(unsealed, rewardedState(unsealed), 'item:kite:0').state.status, 'playing', 'a kite never collects blue stamps');
});

test('repair requires an adjacent torn bridge and allows exactly one further crossing', () => {
  const level = board({ start: 6, bridges: [6, 2], letters: [19] });
  const standing = rewardedState(level);
  assert.equal(itemAvailability(level, standing, 'bridge').available, false, 'intact bridges cannot consume a repair');
  assertUnchanged(level, standing, 'item:bridge:6');
  const torn = step(level, standing, 'right').state;
  assert.deepEqual(torn.bridges, [2]);
  assert.deepEqual(itemTargets(level, torn, 'bridge'), [6]);
  for (const action of ['item:bridge:2', 'item:bridge:8', 'item:bridge:999']) assertUnchanged(level, torn, action);
  assert.equal(step(level, torn, 'left').moved, false);
  const result = step(level, torn, 'item:bridge:6'), repaired = result.state;
  assert.deepEqual(result.events, [{ type: 'item', item: 'bridge', cell: 6 }, { type: 'repair', cell: 6 }]);
  assert.equal(repaired.turn, torn.turn);
  assert.equal(repaired.energy, torn.energy);
  assert.equal(repaired.player, torn.player);
  assert.deepEqual(repaired.history, torn.history);
  assert.deepEqual(repaired.bridges, [2, 6]);
  assert.equal(repaired.inventory.bridge, 0);
  const crossed = step(level, repaired, 'left').state;
  assert.equal(crossed.player, 6);
  const leftAgain = step(level, crossed, 'down').state;
  assert.deepEqual(leftAgain.bridges, [2]);
  assertUnchanged(level, leftAgain, 'item:bridge:6');
  assert.equal(step(level, leftAgain, 'up').moved, false);
});

test('repair does not mistake neighboring row indices for adjacent bridge geometry', () => {
  const level = board({ start: 4, bridges: [5, 9] });
  const state = { ...rewardedState(level), bridges: [] };
  assert.deepEqual(itemTargets(level, state, 'bridge'), [9]);
  assertUnchanged(level, state, 'item:bridge:5');
  assert.equal(step(level, state, 'item:bridge:9').moved, true);
});

test('availability explains locked, exhausted, missing-target and finished states consistently', () => {
  const locked = board({ id: 3 }), lockState = rewardedState(locked);
  assert.match(itemAvailability(locked, lockState, 'oil').reason, /第 4 关/);
  assertUnchanged(locked, lockState, 'item:oil');
  const level = board({ letters: [19] }), state = rewardedState(level);
  assert.deepEqual(itemTargets(level, state, 'oil'), [6]);
  assert.match(itemAvailability(level, state, 'bridge').reason, /没有纸桥/);
  assert.match(itemAvailability(level, state, 'kite').reason, /没有待收的信/);
  assert.equal(itemAvailability(level, state, '__proto__').available, false);
  const used = step(level, state, 'item:oil').state;
  assert.match(itemAvailability(level, used, 'oil').reason, /完整视频/);
  for (const status of ['won', 'failed']) {
    const finished = { ...state, status };
    for (const action of ['item:oil', 'item:kite:8', 'item:bridge:7']) assertUnchanged(level, finished, action);
    assert.deepEqual(itemTargets(level, finished, 'oil'), []);
  }
});

test('replaying item actions restores supplies and effects and rejects duplicate or forged routes', () => {
  const level = board({ bridges: [6], letters: [8, 19] });
  const actions = ['right', 'item:bridge:6', 'item:kite:8', 'item:oil', 'left'];
  let direct = rewardedState(level);
  for (const action of actions) direct = step(level, direct, action).state;
  assert.deepEqual(rewardedReplay(level, actions), direct);
  assert.equal(direct.turn, 2);
  assert.equal(direct.itemsUsed, 3);
  assert.deepEqual(direct.inventory, { oil: 0, kite: 0, bridge: 0 });
  for (const forged of [
    ['item:oil', 'item:oil'], ['item:kite:8', 'item:kite:19'], ['item:kite:19'], ['item:bridge:6'],
    ['right', 'item:bridge:6', 'left', 'right', 'item:bridge:6'], ['item:kite:8\n']
  ]) assert.throws(() => rewardedReplay(level, forged), /invalid action/);
  assert.throws(() => rewardedReplay(board({ id: 3 }), ['item:oil']), /invalid action/);
});

test('storage preserves canonical item histories and ignores forged snapshots during replay', () => {
  const level = board({ bridges: [6], letters: [8, 19] }), adapter = memory(), store = createStore(adapter);
  const actions = ['right', 'item:bridge:6', 'item:kite:8', 'item:oil'];
  const saved = { mode: 'campaign', levelId: level.id, revision: '5', actions, reviveHistory: [], undosUsed: 0, itemRewards: earnedRewards(level),
    state: { inventory: { oil: 99, kite: 99, bridge: 99 }, itemsUsed: 0 } };
  assert.equal(store.saveRun(saved), true);
  const restored = createStore(adapter).loadRun();
  const state = replay(level, restored.actions, restored.reviveHistory, restored.itemRewards);
  assert.deepEqual(state.inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.equal(state.itemsUsed, 3);
  for (const action of ['item:oil:0', 'item:kite:01', 'item:bridge:-1', 'item:kite:1\n', 'item:oil\n']) {
    assert.equal(store.saveRun({ ...saved, actions: [action] }), false);
    assert.deepEqual(store.loadRun(), restored, 'a rejected route preserves the last usable save');
  }
  const legacy = { mode: 'campaign', levelId: level.id, revision: '5', actions: ['right'], reviveAt: null };
  assert.equal(store.saveRun(legacy), true);
  const old = createStore(adapter).loadRun(), rebuilt = replay(level, old.actions, old.reviveAt, old.itemRewards);
  assert.deepEqual(rebuilt.inventory, initialInventory(level));
  assert.equal(rebuilt.itemsUsed, 0);
});

test('undo by truncating the action log restores a charge, effects and clean scoring before branching', () => {
  const level = board({ letters: [8, 16] }), actions = ['wait', 'item:kite:8'];
  const used = rewardedReplay(level, actions);
  const undone = rewardedReplay(level, actions.slice(0, -1));
  assert.equal(undone.turn, used.turn);
  assert.equal(undone.energy, used.energy);
  assert.equal(undone.itemsUsed, 0);
  assert.equal(undone.inventory.kite, 1);
  assert.deepEqual(undone.letters, [8, 16]);
  assert.equal(stars(level, undone), 3);
  const branched = rewardedReplay(level, ['wait', 'item:kite:16']);
  assert.deepEqual(branched.letters, [8]);
  assert.deepEqual(used.letters, [16]);
  const oil = rewardedReplay(level, ['wait', 'item:oil']);
  assert.equal(rewardedReplay(level, ['wait']).energy, oil.energy - 6);
});

test('revival histories use action indices even when supplies add no turns and never refill supplies', () => {
  const level = board({ budget: 1, letters: [19] });
  const actions = ['item:oil', ...Array(7).fill('wait')];
  const failed = rewardedReplay(level, actions);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.turn, 7);
  assert.equal(actions.length, 8);
  const restored = rewardedReplay(level, actions.concat('wait'), [8]);
  assert.equal(restored.revived, true);
  assert.equal(restored.turn, 8);
  assert.equal(restored.itemsUsed, 1);
  assert.equal(restored.inventory.oil, 0);
  assert.equal(revive(level, failed).inventory.oil, 0);
  assert.throws(() => rewardedReplay(level, actions.concat('wait'), [7]), /invalid revive/);
  assert.throws(() => rewardedReplay(level, actions.concat('item:oil'), [8]), /invalid action/);
});

test('assisted runs cap stars and cannot replace a clean best-turn record with a shortcut', () => {
  const level = board({ par: 6 }), clean = { ...rewardedState(level), status: 'won', turn: 6 };
  assert.equal(stars(level, clean), 3);
  assert.equal(scoredTurns(level, clean), 6);
  const assisted = { ...clean, turn: 2, itemsUsed: 1 };
  assert.equal(stars(level, assisted), 2);
  assert.equal(scoredTurns(level, assisted), 7);
  assert.equal(stars(level, { ...assisted, turn: 9 }), 1, 'the cap never raises an earned one-star score');
  assert.equal(scoredTurns(level, { ...assisted, turn: 9 }), 9);
  const store = createStore(memory());
  store.recordWin(level.id, stars(level, clean), scoredTurns(level, clean));
  store.recordWin(level.id, stars(level, assisted), scoredTurns(level, assisted));
  assert.deepEqual(store.getProfile().completed[String(level.id)], { stars: 3, bestTurns: 6 });
  const firstAssisted = createStore(memory());
  firstAssisted.recordWin(level.id, stars(level, assisted), scoredTurns(level, assisted));
  assert.deepEqual(firstAssisted.getProfile().completed[String(level.id)], { stars: 2, bestTurns: 7 });
});
