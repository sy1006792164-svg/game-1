'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, replay, revive } = require('../src/engine');
const { isReviveRouteBlocked } = require('../src/revive-policy');
const { showFailure, requestRevive } = require('../src/revive-flow');
const { itemOffer, parseItemAction } = require('../src/items');

// Routes start empty; separate fixtures explicitly grant completed-video rewards.
function exhausted(state) { return { ...state, inventory: { oil: 0, kite: 0, bridge: 0 } }; }

function trappedRoute(withTools = false) {
  const level = CAMPAIGN[19];
  // Tear the bridge above cell 26. The apparently open passage below is a
  // north-facing wind: every attempt to leave through it lands back on 26.
  const detour = ['down', 'down', 'down', 'down', 'left', 'down', 'left', 'left', 'up', 'down'];
  const state = replay(level, detour.concat(Array(level.budget - detour.length).fill('wait')), [], withTools ? { bridge: 1 } : undefined);
  return { level, state };
}

function intactBridgeTrap() {
  const level = CAMPAIGN[15];
  const route = ['right', 'up', 'right', 'right', 'up', 'up', 'left', 'left', 'left', 'up'];
  return { level, state: exhausted(replay(level, route.concat(Array(level.budget - route.length).fill('wait')))) };
}

function failureGame(level, state) {
  const game = {
    level, state, page: 'game', mode: 'campaign', hidden: false, busy: false, session: 1,
    actions: Array(state.turn).fill('wait'), reviveHistory: [], itemRewards: { oil: 0, kite: 0, bridge: 0 },
    requested: 0, restarted: 0, renderer: { hits: [] },
    platform: { kind: 'wechat', now: () => 1000 },
    sound: { suspend() {}, resume() {} }, syncMusic() {}, persist() {}, cue() {},
    toast(message) { this.toastText = message; },
    start(next, mode) { assert.equal(next, level); assert.equal(mode, 'campaign'); this.restarted++; },
    requestRevive() { return requestRevive(this); }
  };
  game.ads = { isActive: () => false, isConfigured: () => true,
    showRevive: async () => { game.requested++; return { rewarded: true }; } };
  return game;
}

// A witness earns each tool only when its next action needs it. This models
// distinct completed tool videos after relighting, never speculative stock.
function followVideoRescue(level, initial, actions) {
  let state = initial;
  const rewards = { oil: 0, kite: 0, bridge: 0 };
  for (const action of actions) {
    const item = parseItemAction(action);
    if (item) {
      const offer = itemOffer(level, state, item.id);
      assert.equal(offer.eligible, true, action + ': a real target must exist before the video');
      assert.ok(offer.targets.includes(item.cell === null ? state.player : item.cell));
      assert.equal(state.inventory[item.id], 0, 'no future tool reward was granted early');
      rewards[item.id]++;
      state = { ...state, inventory: { ...state.inventory, [item.id]: 1 } };
    }
    const result = step(level, state, action);
    assert.equal(result.moved, true, action + ': the rescue must be legal with actual light, wind and bridge rules');
    if (item && item.id === 'oil') assert.equal(result.state.energy - state.energy, 6, 'one completed oil video adds exactly six beats');
    state = result.state;
  }
  assert.equal(state.status, 'won');
  assert.deepEqual(state.inventory, { oil: 0, kite: 0, bridge: 0 });
  return { state, rewards };
}

test('the real level 20 wind trap cannot be repaired by relighting its torn bridge route', () => {
  const { level, state } = trappedRoute(), before = JSON.stringify(state);
  assert.equal(state.status, 'failed');
  assert.equal(state.player, 26);
  assert.deepEqual(state.bridges, []);
  assert.equal(isReviveRouteBlocked(level, state), true);
  const relit = revive(level, state);
  assert.equal(isReviveRouteBlocked(level, relit), true);
  assert.equal(step(level, relit, 'down').state.player, 26, 'the only open exit blows the courier straight back');
  assert.equal(JSON.stringify(state), before, 'the check does not change the failed route');
});

test('the real level 20 wind trap discloses separate tool videos and can then be delivered', async () => {
  const { level, state } = trappedRoute();
  const before = JSON.stringify(state), game = failureGame(level, state);
  assert.equal(isReviveRouteBlocked(level, state), true);
  assert.equal(isReviveRouteBlocked(level, state, { canAcquireItems: true }), false);
  showFailure(game);
  const relight = game.modal.buttons.find(button => /看广告续灯/.test(button.text));
  assert.equal(relight.primary, true);
  assert.ok(game.modal.lines.some(line => /另看视频获取/.test(line)));
  assert.equal(game.requested, 0, 'showing an offer does not launch an advertisement');
  assert.equal(game.state, state);
  assert.equal(JSON.stringify(state), before, 'hypothetical tools never mutate the failed state');
  await relight.action();
  assert.equal(game.requested, 1);
  assert.equal(game.state.status, 'playing');
  assert.equal(game.state.energy, 6, 'the relight earns exactly the same six beats as an oil video');
  assert.deepEqual(game.state.inventory, { oil: 0, kite: 0, bridge: 0 }, 'the relight video grants energy only');
  assert.deepEqual(game.itemRewards, { oil: 0, kite: 0, bridge: 0 });
  const rescued = followVideoRescue(level, game.state, ['item:bridge:20', 'up', 'up', 'left', 'left', 'down', 'down',
    'up', 'up', 'item:oil', 'right', 'right', 'up', 'right', 'up', 'item:kite:1', 'down', 'item:oil',
    'right', 'right', 'down', 'down', 'left', 'left']);
  assert.deepEqual(rescued.rewards, { oil: 2, kite: 1, bridge: 1 });
  assert.equal(rescued.state.turn - state.turn, 20);
  assert.equal(rescued.state.energy, 1);
});

test('the real level 16 intact-bridge failure explains further videos and has a legal tool-assisted rescue', async () => {
  const { level, state } = intactBridgeTrap(), before = JSON.stringify(state);
  assert.equal(state.status, 'failed');
  assert.equal(state.player, 7);
  assert.deepEqual(state.bridges, [7], 'the courier is still standing on the intact bridge');
  assert.deepEqual(state.letters, [1, 5, 35]);
  assert.deepEqual(state.seals, [9, 17, 24]);
  assert.equal(isReviveRouteBlocked(level, state), true,
    'every departure strands either the post office or the remaining targets');

  const game = failureGame(level, state);
  assert.equal(isReviveRouteBlocked(level, state, { canAcquireItems: true }), false);
  showFailure(game);
  assert.equal(game.modal.buttons.some(button => /看广告续灯/.test(button.text)), true);
  assert.ok(game.modal.lines.some(line => /另看视频获取/.test(line)));
  assert.equal(game.modal.lines.some(line => /纸桥已断/.test(line)), false,
    'an intact bridge is not described as already torn');
  await requestRevive(game);
  assert.equal(game.requested, 1);
  assert.equal(game.state.energy, 6);
  assert.deepEqual(game.state.inventory, { oil: 0, kite: 0, bridge: 0 });
  assert.deepEqual(game.itemRewards, { oil: 0, kite: 0, bridge: 0 });
  assert.equal(JSON.stringify(state), before, 'eligibility checks preserve the failed route');
  const rescued = followVideoRescue(level, game.state, ['up', 'right', 'right', 'down', 'up', 'item:oil', 'right', 'right',
    'down', 'left', 'down', 'down', 'item:kite:35', 'item:oil', 'up', 'up', 'left', 'left', 'left', 'down',
    'item:oil', 'left', 'down', 'up', 'right', 'up', 'item:bridge:7', 'up', 'left']);
  assert.deepEqual(rescued.rewards, { oil: 3, kite: 1, bridge: 1 });
  assert.equal(rescued.state.turn - state.turn, 24);
  assert.equal(rescued.state.energy, 0, 'the unchanged rescue route can finish on the final supplied beat');
});

test('a permanent wall-separated post office still hides ads and rejects revival even with future tool videos', async () => {
  const level = { id: 16, width: 6, height: 1, start: 0, exit: 5, walls: [3, 4],
    letters: [], seals: [], lights: [], bridges: [1], winds: {}, budget: 2 };
  const state = replay(level, ['right', 'left']), game = failureGame(level, state), before = JSON.stringify(state);
  assert.equal(state.status, 'failed');
  assert.deepEqual(state.bridges, []);
  assert.equal(isReviveRouteBlocked(level, state, { canAcquireItems: true }), true,
    'repairing a paper bridge cannot open a permanent wall or move the post office');
  showFailure(game);
  assert.equal(game.modal.buttons.some(button => /看广告/.test(button.text)), false);
  assert.ok(game.modal.lines.some(line => /补拍也无法送达/.test(line)));
  assert.equal(game.modal.lines.some(line => /另看视频/.test(line)), false);
  await requestRevive(game);
  assert.equal(game.requested, 0);
  assert.equal(game.state, state);
  assert.equal(JSON.stringify(state), before);
  const retry = game.modal.buttons.find(button => /免费再试/.test(button.text));
  assert.equal(retry.primary, true);
  retry.action();
  assert.equal(game.restarted, 1);
});

test('queued echo may finish at an intact bridge post office without leaving it', () => {
  const level = {
    id: 'bridge-exit-echo', width: 3, height: 1, start: 2, exit: 0, walls: [],
    letters: [], seals: [1], lights: [], bridges: [0], winds: {}, budget: 2
  };
  const failed = replay(level, ['left', 'left']);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.player, level.exit);
  assert.deepEqual(failed.bridges, [level.exit]);
  assert.deepEqual(failed.seals, [1]);
  assert.equal(isReviveRouteBlocked(level, failed), false, 'waiting keeps the bridge intact while the echo catches up');

  let relit = revive(level, failed);
  relit = step(level, relit, 'wait').state;
  assert.equal(relit.status, 'playing');
  relit = step(level, relit, 'wait').state;
  assert.equal(relit.status, 'won');
  assert.deepEqual(relit.bridges, [level.exit]);
});

test('a bridge that may tear later can stop a wind and open a valid landing', () => {
  const level = {
    id: 'wind-bridge', width: 4, height: 2, start: 7, exit: 2, walls: [3],
    letters: [0], seals: [], lights: [], bridges: [1, 7], winds: { 2: 'left' }, budget: 8
  };
  let state = replay(level, ['left']);
  assert.deepEqual(state.bridges, [1], 'the first bridge has already torn');
  assert.equal(isReviveRouteBlocked(level, state), false, 'cell 2 becomes a possible landing once bridge 1 tears');
  for (const action of ['left', 'up', 'left', 'down', 'right', 'right', 'up']) {
    assert.equal(isReviveRouteBlocked(level, state), false);
    state = step(level, state, action).state;
  }
  assert.equal(state.status, 'won');
  assert.equal(state.energy, 0);
});

test('the real level 20 wind trap remains eligible while its adjacent bridge can be repaired', () => {
  const { level, state } = trappedRoute(true), before = JSON.stringify(state);
  assert.equal(state.inventory.bridge, 1);
  assert.equal(isReviveRouteBlocked(level, state), false);
  const repaired = step(level, revive(level, state), 'item:bridge:20');
  assert.equal(repaired.moved, true);
  assert.equal(step(level, repaired.state, 'up').state.player, 20, 'the restored bridge provides a real way out');
  assert.equal(JSON.stringify(state), before);
});

function toolTrap(overrides = {}) {
  const level = { id: 16, width: 3, height: 2, start: 0, exit: 0, walls: [1, 4],
    letters: [2], seals: [], lights: [], bridges: [5], winds: {}, budget: 1, ...overrides };
  const state = { ...createState(level, { kite: 1, bridge: 1 }), bridges: [], status: 'failed', energy: 0 };
  return { level, state };
}

test('a kite can rescue one isolated letter through a wall and finish at the post office', () => {
  const { level, state } = toolTrap(), before = JSON.stringify(state);
  assert.equal(isReviveRouteBlocked(level, state), false);
  const result = step(level, revive(level, state), 'item:kite:2');
  assert.equal(result.state.status, 'won');
  assert.equal(result.state.turn, state.turn);
  assert.equal(JSON.stringify(state), before);
  assert.equal(isReviveRouteBlocked(level, { ...state, inventory: { ...state.inventory, kite: 0 } }), true);
  assert.equal(isReviveRouteBlocked(level, { ...state, inventory: undefined }), true, 'legacy missing stock grants no rescue');
});

test('a kite cannot rescue an unreachable exit, seal, distant letter or two stranded letters', () => {
  for (const overrides of [{ exit: 2, letters: [] }, { letters: [], seals: [2] },
    { letters: [5], walls: [1, 3, 4] }, { letters: [2, 5] }]) {
    const { level, state } = toolTrap(overrides);
    assert.equal(isReviveRouteBlocked(level, state), true, JSON.stringify(overrides));
  }
});

test('a single repair pack cannot reconnect a route across two already torn bridges', () => {
  const { level, state } = toolTrap({ width: 7, height: 1, exit: 6, walls: [], letters: [], bridges: [2, 4] });
  assert.equal(isReviveRouteBlocked(level, state), true);
});

test('a kite may need to collect its letter before leaving an intact bridge', () => {
  const level = { id: 16, width: 5, height: 2, start: 2, exit: 4, walls: [1, 5, 6, 7, 8, 9],
    letters: [0], seals: [], lights: [], bridges: [2], winds: {}, budget: 1 };
  const failed = replay(level, ['wait'], [], { kite: 1 });
  assert.equal(isReviveRouteBlocked(level, failed), false);
  let state = revive(level, failed);
  for (const action of ['item:kite:0', 'right', 'right']) state = step(level, state, action).state;
  assert.equal(state.status, 'won');
  assert.equal(isReviveRouteBlocked(level, exhausted(failed)), true);
});

test('an adjacent repair may need to happen before departing another intact bridge', () => {
  const level = { id: 16, width: 5, height: 1, start: 2, exit: 0, walls: [],
    letters: [], seals: [], lights: [], bridges: [1, 2], winds: {}, budget: 1 };
  const failed = { ...replay(level, ['wait'], [], { bridge: 1 }), bridges: [2] };
  assert.equal(isReviveRouteBlocked(level, failed), false);
  let state = revive(level, failed);
  for (const action of ['item:bridge:1', 'left', 'left']) state = step(level, state, action).state;
  assert.equal(state.status, 'won');
  assert.equal(isReviveRouteBlocked(level, exhausted(failed)), true);
});

test('revival eligibility never rejects a state on any of the 999 original winning routes', () => {
  let checked = 0;
  for (const level of CAMPAIGN) {
    let state = createState(level);
    for (const action of level.solution) {
      assert.equal(isReviveRouteBlocked(level, state), false, `level ${level.id}, turn ${state.turn}`);
      state = step(level, state, action).state;
      checked++;
    }
    assert.equal(state.status, 'won', `level ${level.id}`);
    assert.equal(state.revived, false, `level ${level.id}`);
  }
  assert.ok(checked > 30000, 'the audit includes all route prefixes, pending echoes and bridge/wind combinations');
});
