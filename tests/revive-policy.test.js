'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, replay, revive } = require('../src/engine');
const { isReviveRouteBlocked } = require('../src/revive-policy');
const { showFailure, requestRevive } = require('../src/revive-flow');

function trappedRoute() {
  const level = CAMPAIGN[19];
  // Tear the bridge above cell 26. The apparently open passage below is a
  // north-facing wind: every attempt to leave through it lands back on 26.
  const detour = ['down', 'down', 'down', 'down', 'left', 'down', 'left', 'left', 'up', 'down'];
  return { level, state: replay(level, detour.concat(Array(level.budget - detour.length).fill('wait'))) };
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

test('a proven wind trap hides the advertisement and rejects stale revival requests before starting one', async () => {
  const { level, state } = trappedRoute();
  let requested = 0, restarted = 0;
  const game = {
    level, state, page: 'game', mode: 'campaign', hidden: false, busy: false,
    platform: { kind: 'wechat' },
    ads: { isActive: () => false, isConfigured: () => true, showRevive: async () => { requested++; } },
    toast(message) { this.toastText = message; },
    start(next, mode) { assert.equal(next, level); assert.equal(mode, 'campaign'); restarted++; }
  };
  showFailure(game);
  assert.equal(game.modal.buttons.some(button => /看广告/.test(button.text)), false);
  assert.ok(game.modal.lines.some(line => /补拍也无法送达/.test(line)));
  await requestRevive(game);
  assert.equal(requested, 0);
  assert.equal(game.state, state);
  const retry = game.modal.buttons.find(button => /免费再试/.test(button.text));
  assert.equal(retry.primary, true);
  retry.action();
  assert.equal(restarted, 1);
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
