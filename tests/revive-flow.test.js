'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, replay } = require('../src/engine');
const { requestRevive } = require('../src/revive-flow');
const { SUPPLY_ENERGY } = require('../src/supply-rules');

function failedGame() {
  const level = CAMPAIGN[3], actions = [], suspended = new Set(), saved = [];
  let state = createState(level);
  while (state.status === 'playing') {
    state = step(level, state, 'wait').state; actions.push('wait');
  }
  const game = {
    page: 'game', hidden: false, busy: false, session: 1, mode: 'campaign', level, state, actions,
    reviveHistory: [], itemRewards: {}, modal: { kind: 'fail' }, reviewing: false,
    platform: { kind: 'wechat', now: () => 1000 }, renderer: { hits: [] },
    ads: { isActive: () => false, isConfigured: () => true, showRevive: async () => ({ rewarded: true }) },
    sound: { suspend: reason => suspended.add(reason), resume: reason => suspended.delete(reason) },
    syncMusic() {}, cue() {}, toast(message) { this.message = message; },
    pause() { this.modal = { kind: 'pause' }; },
    persist() { saved.push({ actions: this.actions.slice(), reviveHistory: this.reviveHistory.slice() }); }
  };
  return { game, suspended, saved };
}

test('a completed video restores the exact failed route and stores a replayable relight', async () => {
  const { game, suspended, saved } = failedGame();
  const before = game.state;
  await requestRevive(game);
  assert.equal(game.state.status, 'playing');
  assert.equal(game.state.energy, SUPPLY_ENERGY);
  assert.deepEqual(game.state.letters, before.letters);
  assert.deepEqual(game.state.seals, before.seals);
  assert.deepEqual(game.reviveHistory, [game.actions.length]);
  assert.deepEqual(replay(game.level, saved[0].actions, saved[0].reviveHistory), game.state);
  assert.equal(game.busy, false);
  assert.equal(suspended.size, 0);
});

test('a presentation failure preserves the earned relight and releases the ad audio lock', async () => {
  const { game, suspended, saved } = failedGame();
  game.cue = () => { throw new Error('audio bridge unavailable'); };
  await requestRevive(game);
  assert.equal(game.state.status, 'playing');
  assert.equal(game.state.energy, SUPPLY_ENERGY);
  assert.deepEqual(game.reviveHistory, [game.actions.length]);
  assert.equal(saved.length, 1);
  assert.equal(game.busy, false);
  assert.equal(suspended.size, 0);
  assert.equal(game.modal.kind, 'revive-recovery');
  game.modal.buttons[0].action();
  assert.equal(game.modal, null);
  assert.equal(saved.length, 2);
});

test('a persistence exception keeps the credited state available without a second video', async () => {
  const { game, suspended, saved } = failedGame();
  const persist = game.persist;
  game.persist = () => { throw new Error('save adapter failure'); };
  await requestRevive(game);
  assert.equal(game.state.status, 'playing');
  assert.equal(game.modal.kind, 'revive-recovery');
  assert.equal(suspended.size, 0);
  game.persist = persist;
  game.modal.buttons[0].action();
  assert.deepEqual(replay(game.level, saved[0].actions, saved[0].reviveHistory), game.state);
});

for (const reason of ['cancelled', 'error']) test(reason + ' videos never issue a relight', async () => {
  const { game, suspended, saved } = failedGame(), before = game.state;
  game.ads.showRevive = async () => {
    if (reason === 'error') throw new Error('network unavailable');
    return { rewarded: false, reason };
  };
  await requestRevive(game);
  assert.equal(game.state, before);
  assert.equal(game.modal.kind, 'fail');
  assert.equal(game.reviveHistory.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(suspended.size, 0);
});

test('finishing a video in the background retains an explicit resume step', async () => {
  const { game, suspended } = failedGame();
  game.ads.showRevive = async () => { game.hidden = true; return { rewarded: true }; };
  await requestRevive(game);
  assert.equal(game.state.status, 'playing');
  assert.equal(game.modal.kind, 'pause');
  assert.equal(suspended.size, 0);
});

test('a stale completed video cannot credit a different session', async () => {
  const { game, suspended, saved } = failedGame(), before = game.state;
  game.ads.showRevive = async () => { game.session++; return { rewarded: true }; };
  await requestRevive(game);
  assert.equal(game.state, before);
  assert.equal(game.reviveHistory.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(suspended.size, 0);
});
