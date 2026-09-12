'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, replay, step } = require('../src/engine');
const { createStore } = require('../src/storage');
const { requestRevive, showFailure } = require('../src/revive-flow');

function harness() {
  const level = { id: 4, width: 2, height: 1, start: 0, exit: 1, walls: [],
    letters: [1], seals: [], lights: [], bridges: [], winds: {}, budget: 1 };
  const values = new Map(), store = createStore({ get: key => values.get(key),
    set: (key, value) => values.set(key, structuredClone(value)), remove: key => values.delete(key) });
  let complete;
  const game = {
    page: 'game', mode: 'campaign', hidden: false, busy: false, session: 1,
    level, state: step(level, createState(level), 'wait').state,
    actions: ['wait'], reviveHistory: [], itemRewards: { oil: 0, kite: 0, bridge: 0 },
    renderer: { hits: [] }, platform: { kind: 'wechat', now: () => 1000 },
    ads: { isActive: () => false, isConfigured: () => true,
      showRevive: () => new Promise(resolve => { complete = resolve; }) },
    sound: { suspend() {}, resume() {} },
    syncMusic() { this.musicActive = !this.hidden && !this.busy && !this.modal; },
    persist() { store.saveRun({ mode: this.mode, levelId: level.id, actions: this.actions,
      reviveHistory: this.reviveHistory, itemRewards: this.itemRewards }); },
    cue() {}, toast() {},
    pause() { this.modal = { kind: 'pause', buttons: [{ text: '继续投递', action: () => {
      this.modal = null; this.syncMusic();
    } }] }; this.syncMusic(); }
  };
  showFailure(game);
  return { game, store, complete: result => complete(result) };
}

test('a revive completed in background saves one reward and remains paused until explicit resume', async () => {
  const h = harness(), before = structuredClone(h.game.state);
  const pending = requestRevive(h.game);
  h.game.hidden = true;
  h.complete({ rewarded: true });
  await pending;
  assert.equal(h.game.state.energy, 6);
  assert.equal(h.game.state.reviveCount, 1);
  assert.deepEqual(h.game.state.history, before.history);
  assert.deepEqual(h.game.reviveHistory, [1]);
  assert.equal(h.game.modal.kind, 'pause');
  assert.equal(h.game.busy, false);
  assert.equal(h.game.musicActive, false);
  const saved = h.store.loadRun();
  assert.deepEqual(replay(h.game.level, saved.actions, saved.reviveHistory, saved.itemRewards), h.game.state);
  h.game.hidden = false; h.game.syncMusic();
  assert.equal(h.game.musicActive, false, 'foregrounding does not silently resume the route');
  h.game.modal.buttons[0].action();
  assert.equal(h.game.modal, null);
  assert.equal(h.game.musicActive, true);
});

test('foreground completion resumes normally, while a cancelled background video keeps the failure dialog', async () => {
  for (const rewarded of [true, false]) {
    const h = harness(), before = h.game.state;
    const pending = requestRevive(h.game);
    h.game.hidden = !rewarded;
    h.complete({ rewarded, reason: 'cancelled' });
    await pending;
    if (rewarded) {
      assert.equal(h.game.modal, null);
      assert.equal(h.game.musicActive, true);
    } else {
      assert.equal(h.game.state, before);
      assert.equal(h.game.modal.kind, 'fail');
      assert.deepEqual(h.game.reviveHistory, []);
      assert.equal(h.game.musicActive, false);
    }
  }
});

test('a background completion cannot pause or grant a reward to a replacement session', async () => {
  const h = harness(), before = h.game.state;
  const pending = requestRevive(h.game);
  h.game.session++; h.game.hidden = true;
  const replacement = h.game.modal = { kind: 'help' };
  h.complete({ rewarded: true });
  await pending;
  assert.equal(h.game.state, before);
  assert.equal(h.game.modal, replacement);
  assert.deepEqual(h.game.reviveHistory, []);
  assert.equal(h.store.loadRun(), null);
});
