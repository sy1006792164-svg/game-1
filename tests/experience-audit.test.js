'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectExperienceSamples, bundle } = require('../tools/experience-audit');
const { CAMPAIGN, getLegacyLevel } = require('../src/levels');
const { PHASES } = require('../src/campaign-design');
const { replay, step, stars } = require('../src/engine');
const { itemOffer } = require('../src/items');
const { waitStatus } = require('../src/game-view');

test('budget tuning preserves every v8 route and its earned video supply on resume', () => {
  for (const current of CAMPAIGN) {
    const legacy = getLegacyLevel(current.id, '8');
    const phase = PHASES[current.id === 999 ? 5 : (current.id - 1) % 6];
    const reserve = Math.max(phase.minimum, Math.ceil(current.par * Math.round(phase.ratio * 100) / 100));
    assert.equal(legacy.revision, '8');
    assert.equal(legacy.budget, current.par + reserve);
    assert.equal(legacy.undo, current.undo);
    const completed = replay(legacy, legacy.solution);
    assert.equal(completed.status, 'won', String(current.id));
    assert.equal(stars(legacy, completed), 3);
    assert.equal(completed.energy, reserve);
    if (current.id <= 30) assert.equal(current.budget, legacy.budget, 'teaching budget stays unchanged');
  }
  const legacy = getLegacyLevel(601, '8');
  const actions = Array(legacy.budget).fill('wait');
  const restored = replay(legacy, actions, [actions.length], { oil: 1 });
  assert.equal(restored.status, 'playing');
  assert.equal(restored.energy, require('../src/supply-rules').SUPPLY_ENERGY);
  assert.equal(restored.inventory.oil, 1);
  assert.equal(restored.reviveCount, 1);
  assert.throws(() => replay(CAMPAIGN[600], actions, [actions.length], { oil: 1 }),
    'the same paid route would be invalid if silently replayed against the smaller budget');
});

test('all 23 experience specimens remain available, with replayable routes for all 15 game scenes', () => {
  const samples = collectExperienceSamples();
  assert.equal(samples.length, 23);
  assert.equal(new Set(samples.map(sample => sample.id)).size, 23);
  const routes = samples.filter(sample => sample.levelId);
  assert.equal(routes.length, 15);
  for (const sample of routes) {
    const level = CAMPAIGN.find(entry => entry.id === sample.levelId);
    const state = replay(level, sample.actions, [], sample.itemRewards);
    assert.equal(state.status, sample.status, sample.id);
    if (sample.id.startsWith('item-')) assert.equal(itemOffer(level, state, sample.id.slice(5)).eligible, true, sample.id);
    if (sample.id === 'low-light') assert.equal(state.energy, 3);
    if (sample.id === 'fail') assert.equal(state.energy, 0);
  }
  // The browser must receive the same verified catalogue, including its
  // dynamically chosen level and target, rather than an unfilled argument.
  assert.ok(bundle(samples).includes(', ' + JSON.stringify(samples) + ');'));
});

test('echo ready, target and finish form one legal route completed by one owned tool', () => {
  const samples = collectExperienceSamples();
  const ready = samples.find(sample => sample.id === 'echo-ready');
  const target = samples.find(sample => sample.id === 'echo-target');
  const finish = samples.find(sample => sample.id === 'echo-finish');
  const level = CAMPAIGN.find(entry => entry.id === ready.levelId);
  assert.deepEqual(ready.actions, target.actions);
  assert.deepEqual(finish.actions.slice(0, -1), ready.actions);
  assert.deepEqual(ready.itemRewards, { echo: 1 });
  const before = replay(level, ready.actions, [], ready.itemRewards);
  assert.equal(before.status, 'playing');
  assert.ok(itemOffer(level, before, 'echo').targets.includes(target.targetCell));
  const result = step(level, before, finish.actions[finish.actions.length - 1]);
  assert.equal(result.moved, true);
  assert.equal(result.state.status, 'won');
  assert.equal(result.state.turn, before.turn);
  assert.equal(result.state.player, before.player);
  assert.equal(stars(level, result.state), 2);
  assert.ok(result.events.some(event => event.type === 'seal' && event.cell === target.targetCell));
  assert.ok(result.events.some(event => event.type === 'win'));
});

test('wait guidance distinguishes a fatal wait from a real echo delivery without spending a beat', () => {
  const samples = collectExperienceSamples(), renderer = {};
  const low = samples.find(sample => sample.id === 'low-light');
  const game = { level: CAMPAIGN[low.levelId - 1] };
  game.state = replay(game.level, low.actions, [], low.itemRewards);
  while (game.state.energy > 1) game.state = step(game.level, game.state, 'wait').state;
  const source = game.state, before = JSON.stringify(source);
  const warning = waitStatus(renderer, game);
  assert.equal(warning.warning, true);
  assert.match(warning.caption, /等待后灯灭/);
  assert.equal(step(game.level, source, 'wait').state.status, 'failed');
  assert.equal(waitStatus(renderer, game), warning, 'unchanged frames reuse the real forecast');
  assert.equal(game.state, source);
  assert.equal(JSON.stringify(game.state), before);

  const ready = samples.find(sample => sample.id === 'echo-ready');
  game.level = CAMPAIGN[ready.levelId - 1];
  game.state = step(game.level, replay(game.level, ready.actions, [], ready.itemRewards), 'wait').state;
  const delivery = waitStatus(renderer, game);
  assert.equal(delivery.warning, false);
  assert.match(delivery.caption, /完成投递/);
  assert.equal(step(game.level, game.state, 'wait').state.status, 'won');
});
