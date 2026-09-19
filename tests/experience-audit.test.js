'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectExperienceSamples, bundle } = require('../tools/experience-audit');
const { CAMPAIGN } = require('../src/levels');
const { replay, step, stars } = require('../src/engine');
const { itemOffer } = require('../src/items');

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
