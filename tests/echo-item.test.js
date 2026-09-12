'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, createState, isAction, step, replay, stars, scoredTurns } = require('../src/engine');
const { ITEMS, initialInventory, normalizeItemRewards, itemTargets, itemOffer, itemAvailability,
  itemAction, parseItemAction } = require('../src/items');
const { CAMPAIGN } = require('../src/levels');
const { createStore } = require('../src/storage');
const { isReviveRouteBlocked } = require('../src/revive-policy');

function board(overrides = {}) {
  return { id: 31, width: 6, height: 4, start: 0, exit: 23, letters: [], seals: [1, 2, 3],
    lights: [], bridges: [], walls: [], winds: {}, budget: 20, par: 7, ...overrides };
}

function memory() {
  const values = new Map();
  return { get: key => values.get(key), set: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))),
    remove: key => values.delete(key) };
}

function assertUnchanged(level, state, action) {
  const before = JSON.stringify(state), result = step(level, state, action);
  assert.equal(result.state, state);
  assert.equal(result.moved, false);
  assert.deepEqual(result.events, []);
  assert.equal(JSON.stringify(state), before);
}

test('echo whistle unlocks at route 31 and old reward ledgers keep their original shape', () => {
  assert.deepEqual(ITEMS.find(item => item.id === 'echo'), {
    id: 'echo', name: '回声笛', icon: 'echo', unlock: 31,
    description: '提前盖好未来 1—3 拍回声将经过的一枚蓝票。\n只选最近走过的落点，不耗拍。', short: '提前盖蓝票'
  });
  const empty = { oil: 0, kite: 0, bridge: 0 };
  for (const id of [1, 30, 31, 999]) {
    assert.deepEqual(initialInventory(board({ id })), empty);
    assert.deepEqual(initialInventory(board({ id }), empty), empty);
  }
  assert.deepEqual(initialInventory(board(), { echo: 1 }), { ...empty, echo: 1 });
  assert.deepEqual(initialInventory(board(), { echo: 0 }), { ...empty, echo: 0 });
  assert.deepEqual(normalizeItemRewards(null, { echo: 1 }), { ...empty, echo: 1 });
  assert.throws(() => createState(board({ id: 30 }), { echo: 1 }), /invalid item rewards/);
  assert.equal(itemOffer(board({ id: 30 }), createState(board({ id: 30, seals: [0] })), 'echo').eligible, false);
});

test('echo rewards reject inherited fields, getters and noncanonical or unbounded quantities without reading accessors', () => {
  let reads = 0;
  const getter = {};
  Object.defineProperty(getter, 'echo', { enumerable: true, get() { reads++; return 1; } });
  const hidden = {};
  Object.defineProperty(hidden, 'echo', { value: 1 });
  const inherited = Object.create({ get echo() { reads++; return 1; } });
  const invalid = [getter, hidden, inherited, { echo: -1 }, { echo: 1.5 }, { echo: '1' },
    { echo: 4097 }, { echo: NaN }, { echo: Infinity }, { echo: undefined }, { Echo: 1 },
    { echo: 1, constructor: 0 }, { [Symbol('echo')]: 1 }];
  for (const rewards of invalid) assert.throws(() => normalizeItemRewards(board(), rewards), /invalid item rewards/);
  assert.equal(reads, 0);
  const nullPrototype = Object.assign(Object.create(null), { echo: 4096 });
  assert.equal(normalizeItemRewards(board(), nullPrototype).echo, 4096);
});

test('echo actions use canonical safe integer cells and cannot create rewards', () => {
  assert.deepEqual(ACTIONS, ['up', 'down', 'left', 'right', 'wait']);
  for (const cell of [0, 12, Number.MAX_SAFE_INTEGER]) {
    const action = itemAction('echo', cell);
    assert.equal(action, 'item:echo:' + cell);
    assert.equal(isAction(action), true);
    assert.deepEqual(parseItemAction(action), { id: 'echo', cell });
  }
  const invalid = ['item:echo', 'item:echo:', 'item:echo:-0', 'item:echo:-1', 'item:echo:+1',
    'item:echo:01', 'item:echo:1.0', 'item:echo:1e1', 'item:echo: 1', 'item:echo:1 ',
    'item:echo:1\n', 'item:echo:1\r\n', 'item:echo:9007199254740992', 'item:ECHO:1',
    'reward:echo', 'grant:echo', 'item:grant:echo', 'item:__proto__:0', {}, [], null];
  for (const action of invalid) {
    assert.equal(parseItemAction(action), null, String(action));
    assert.equal(isAction(action), false, String(action));
  }
  for (const cell of [-1, 1.5, '1', Infinity, NaN, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(itemAction('echo', cell), null);
  }
  const level = board({ seals: [0] }), state = createState(level);
  assert.deepEqual(itemOffer(level, state, 'echo').targets, [0]);
  assert.equal(itemAvailability(level, state, 'echo').available, false);
  assertUnchanged(level, state, 'item:echo:0');
  assert.throws(() => replay(level, ['item:echo:0']), /invalid action/);
  assert.throws(() => replay(level, ['item:echo:0'], [], { echo: 0 }), /invalid action/);
  assertUnchanged(level, createState(level, { echo: 1 }), 'item:echo:24');
});

test('echo whistle stamps exactly one queued landing without advancing or changing other board mechanics', () => {
  const level = board({ seals: [1, 2, 3], letters: [8], lights: [2], bridges: [2], winds: { 3: 'down' } });
  const state = replay(level, ['right', 'right'], [], { echo: 1 });
  Object.freeze(state.inventory);
  for (const key of ['history', 'letters', 'seals', 'lights', 'bridges']) Object.freeze(state[key]);
  Object.freeze(state);
  assert.deepEqual(itemTargets(level, state, 'echo'), [1, 2]);
  const result = step(level, state, 'item:echo:1'), next = result.state;
  assert.equal(result.moved, true);
  assert.deepEqual(next.seals, [2, 3]);
  assert.equal(next.inventory.echo, 0);
  assert.equal(next.itemsUsed, 1);
  for (const key of ['player', 'echo', 'turn', 'energy', 'history', 'bridges', 'lights', 'letters']) {
    assert.equal(next[key], state[key], key);
  }
  assert.deepEqual(result.events, [{ type: 'item', item: 'echo', cell: 1 },
    { type: 'seal', cell: 1, source: 'echo-item' }]);
  assertUnchanged(level, next, 'item:echo:2');
  const normal = step(level, next, 'wait');
  assert.equal(normal.state.turn, 3);
  assert.equal(normal.state.echo, 0, 'the whistle does not accelerate the actual echo');
  assert.deepEqual(normal.state.seals, [2, 3]);
});

test('only the pending one-to-three-action window is offered, including initial landings and deduplicated waits', () => {
  const level = board({ seals: [0, 1, 2, 3] });
  const start = createState(level, { echo: 4 });
  assert.deepEqual(itemTargets(level, start, 'echo'), [0], 'the start is a landing that echoes three actions later');
  assertUnchanged(level, start, 'item:echo:1');
  const repeated = replay(level, ['wait', 'wait'], [], { echo: 4 });
  assert.deepEqual(itemTargets(level, repeated, 'echo'), [0], 'one stamp does not become three targets after waiting');
  const state = replay(level, ['right', 'right', 'right'], [], { echo: 4 });
  assert.deepEqual(itemTargets(level, state, 'echo'), [1, 2, 3]);
  assertUnchanged(level, state, 'item:echo:0');
  const stamped = step(level, state, 'item:echo:1').state;
  assertUnchanged(level, stamped, 'item:echo:1');
  assert.deepEqual(itemTargets(level, stamped, 'echo'), [2, 3]);
  const afterNormalEcho = step(level, step(level, step(level, stamped, 'down').state, 'down').state, 'wait').state;
  assertUnchanged(level, afterNormalEcho, 'item:echo:3');
  assert.equal(itemOffer(level, afterNormalEcho, 'echo').eligible, false);
  assert.match(itemOffer(level, afterNormalEcho, 'echo').reason, /全部盖好/);
  const oldOnly = { ...state, seals: [0] };
  assert.deepEqual(itemTargets(level, oldOnly, 'echo'), [], 'a forged uncollected seal outside the queue is not a target');
});

test('wind crossings, unvisited seals, terminal states and inconsistent histories cannot use the whistle', () => {
  const level = board({ winds: { 1: 'right' }, seals: [1, 2] });
  const state = replay(level, ['right'], [], { echo: 1 });
  assert.deepEqual(state.history, [0, 2]);
  assert.deepEqual(itemTargets(level, state, 'echo'), [2]);
  assertUnchanged(level, state, 'item:echo:1');
  for (const status of ['won', 'failed']) assertUnchanged(level, { ...state, status }, 'item:echo:2');
  for (const history of [[], [2], [0, 2, 3], null]) {
    assertUnchanged(level, { ...state, history }, 'item:echo:2');
  }
  for (const turn of [-1, 0.5, '1', NaN, Infinity]) {
    assertUnchanged(level, { ...state, turn }, 'item:echo:2');
  }
  for (const stock of [0, -1, 4097, 1.5, '1', undefined]) {
    assertUnchanged(level, { ...state, inventory: { ...state.inventory, echo: stock } }, 'item:echo:2');
  }
});

test('whistle can settle the final stamp at the post office immediately with assisted scoring', () => {
  const level = board({ exit: 2, seals: [1], par: 4 });
  const actions = ['right', 'right', 'item:echo:1'], state = replay(level, actions, [], { echo: 1 });
  assert.equal(state.status, 'won');
  assert.equal(state.turn, 2);
  assert.equal(state.inventory.echo, 0);
  assert.equal(state.itemsUsed, 1);
  assert.equal(stars(level, state), 2);
  assert.equal(scoredTurns(level, state), 5);
  const direct = step(level, replay(level, ['right', 'right'], [], { echo: 1 }), 'item:echo:1');
  assert.deepEqual(direct.events, [{ type: 'item', item: 'echo', cell: 1 },
    { type: 'seal', cell: 1, source: 'echo-item' }, { type: 'win', cell: 2 }]);
  const store = createStore(memory());
  store.recordWin(level.id, 3, 4);
  store.recordWin(level.id, stars(level, state), scoredTurns(level, state));
  assert.deepEqual(store.getProfile().completed['31'], { stars: 3, bestTurns: 4 });
});

test('replay and undo preserve earned echo stock, reconstruct effects and ignore forged snapshots', () => {
  const level = board({ exit: 2, seals: [1], par: 4 }), adapter = memory(), store = createStore(adapter);
  const actions = ['right', 'right', 'item:echo:1'];
  const saved = { mode: 'campaign', levelId: level.id, actions, reviveHistory: [], itemRewards: { echo: 1 },
    state: { inventory: { echo: 999 }, itemsUsed: 0 } };
  assert.equal(store.saveRun(saved), true);
  const loaded = createStore(adapter).loadRun();
  const used = replay(level, loaded.actions, loaded.reviveHistory, loaded.itemRewards);
  assert.deepEqual(used.inventory, { oil: 0, kite: 0, bridge: 0, echo: 0 });
  assert.equal(used.status, 'won');
  const undone = replay(level, loaded.actions.slice(0, -1), [], loaded.itemRewards);
  assert.equal(undone.status, 'playing');
  assert.equal(undone.inventory.echo, 1);
  assert.equal(undone.itemsUsed, 0);
  assert.equal(undone.energy, used.energy);
  assert.equal(undone.turn, used.turn);
  assert.deepEqual(undone.seals, [1]);
  assert.equal(stars(level, undone), 3);
  assert.deepEqual(createState(level).inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.equal(store.saveRun({ ...saved, itemRewards: { echo: 0 } }), true);
  const empty = store.loadRun();
  assert.throws(() => replay(level, empty.actions, [], empty.itemRewards), /invalid action/);
  assert.throws(() => replay(board({ id: 30 }), actions, [], saved.itemRewards), /invalid item rewards/);
  const legacy = { mode: 'campaign', levelId: level.id, actions: ['right'], state: { inventory: { echo: 99 } } };
  assert.equal(store.saveRun(legacy), true);
  assert.deepEqual(replay(level, ['right'], [], store.loadRun().itemRewards).inventory, { oil: 0, kite: 0, bridge: 0 });
});

test('invalid echo save ledgers and action spellings cannot replace a valid route', () => {
  const store = createStore(memory()), saved = { mode: 'campaign', levelId: 31,
    actions: ['right', 'item:echo:1'], reviveHistory: [], itemRewards: { echo: 1 } };
  assert.equal(store.saveRun(saved), true);
  let reads = 0;
  const getter = { get echo() { reads++; return 1; } };
  const inherited = Object.create({ echo: 1 });
  for (const itemRewards of [getter, inherited, { echo: -1 }, { echo: 4097 }, { echo: '1' }, { ECHO: 1 }]) {
    assert.equal(store.saveRun({ ...saved, itemRewards }), false);
    assert.deepEqual(store.loadRun(), saved);
  }
  assert.equal(reads, 0);
  for (const action of ['item:echo:01', 'item:echo:-1', 'item:echo:1\n', 'grant:echo']) {
    assert.equal(store.saveRun({ ...saved, actions: [action] }), false);
    assert.deepEqual(store.loadRun(), saved);
  }
});

test('echo stock and a hypothetical video cannot rescue an unvisited seal across a torn bridge', () => {
  const level = board({ width: 4, height: 1, start: 0, exit: 3, letters: [], seals: [0], bridges: [1] });
  const blocked = { ...createState(level, { echo: 1 }), player: 3, turn: 7, history: [0, 1, 2, 3, 3, 3, 3, 3],
    seals: [0], bridges: [], energy: 0, status: 'failed' };
  assert.equal(isReviveRouteBlocked(level, blocked), true);
  assert.equal(isReviveRouteBlocked(level, { ...blocked, inventory: { oil: 0, kite: 0, bridge: 0 } }), true);
  const queued = { ...blocked, turn: 3, history: [0, 1, 2, 3], seals: [1] };
  assert.equal(isReviveRouteBlocked(level, queued), false, 'the normal echo was already enough to reach this stamp');
  const noRepair = { ...level, id: 31, walls: [2], bridges: [1] };
  assert.equal(isReviveRouteBlocked(noRepair, blocked, { canAcquireItems: true }), true);
});

test('all 999 unassisted campaign routes still win with three stars and queued offers agree with normal echo playback', () => {
  let pendingStates = 0, offeredTargets = 0;
  for (const level of CAMPAIGN) {
    let state = createState(level);
    assert.equal(Object.prototype.hasOwnProperty.call(state.inventory, 'echo'), false);
    for (const action of level.solution) {
      if (level.id >= 31 && state.seals.length) {
        const offer = itemOffer(level, state, 'echo');
        let future = { ...state, energy: 10 };
        const actual = new Set();
        for (let count = 0; count < 3; count++) {
          const result = step(level, future, 'wait');
          for (const event of result.events) if (event.type === 'seal') actual.add(event.cell);
          future = result.state;
        }
        assert.deepEqual(new Set(offer.targets), actual, 'route ' + level.id + ', turn ' + state.turn);
        if (offer.eligible) {
          pendingStates++;
          const rewarded = { ...state, inventory: { ...state.inventory, echo: 1 } };
          for (const cell of offer.targets) {
            const result = step(level, rewarded, itemAction('echo', cell));
            assert.equal(result.moved, true);
            assert.equal(result.state.seals.length, state.seals.length - 1);
            assert.equal(result.state.turn, state.turn);
            offeredTargets++;
          }
        }
      }
      const result = step(level, state, action);
      assert.equal(result.moved, true, 'route ' + level.id);
      state = result.state;
    }
    assert.equal(state.status, 'won', 'route ' + level.id);
    assert.equal(state.turn, level.par);
    assert.equal(state.itemsUsed, 0);
    assert.equal(stars(level, state), 3);
  }
  assert.ok(pendingStates > 999);
  assert.ok(offeredTargets >= pendingStates);
});
