'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { replay, step, createState, revive } = require('../src/engine');
const { createRouteReview, seekReview, closeReview, reviewLandmark, describeMoment } = require('../src/route-review');
const { reviewLayout, reviewWindow } = require('../src/route-review-view');
const { createHarness } = require('./helpers/game-harness');

const fixture = { id: 12, width: 3, height: 1, start: 0, exit: 2, budget: 2, par: 2,
  undo: 3, letters: [], seals: [], walls: [], bridges: [] };

test('every campaign route review exactly reproduces initial, middle and final engine states', () => {
  for (const level of CAMPAIGN) {
    const review = createRouteReview(level, level.solution);
    for (const index of [0, Math.floor(level.solution.length / 2), level.solution.length])
      assert.deepEqual(review.at(index).state, replay(level, level.solution.slice(0, index)), 'level ' + level.id + ', index ' + index);
    assert.equal(review.at(level.solution.length).state.status, 'won');
    assert.ok(review.checkpointCount <= 18);
  }
});

test('video relight is its own zero-turn moment and legacy amounts are reproduced', () => {
  const actions = ['wait', 'wait', 'right', 'right'];
  for (const policy of [undefined, { version: 2, legacyActionCount: 2, legacyReviveCount: 1 }]) {
    const review = createRouteReview(fixture, actions, [2], {}, policy);
    assert.equal(review.length, 6);
    assert.equal(review.at(2).state.status, 'failed');
    assert.equal(review.at(3).state.turn, 2);
    assert.equal(review.at(3).state.energy, policy ? 8 : 6);
    assert.equal(review.moments[3].label, '视频续灯');
    assert.deepEqual(review.at(5).state, replay(fixture, actions, [2], {}, policy));
    assert.match(describeMoment(review.moments[3], review.at(3).state), /灯火补充/);
  }
});

test('tool relight is distinct from a movement beat and never credits extra inventory', () => {
  const actions = ['wait', 'wait', 'relight:oil', 'right', 'right'];
  const rewards = { oil: 1 }, review = createRouteReview(fixture, actions, [], rewards);
  assert.equal(review.at(2).state.energy, 0);
  assert.equal(review.at(3).state.energy, 6);
  assert.equal(review.at(3).state.turn, 2);
  assert.equal(review.at(3).state.inventory.oil, 0);
  assert.equal(review.at(3).state.itemsUsed, 1);
  assert.deepEqual(rewards, { oil: 1 });
  assert.deepEqual(review.at(5).state, replay(fixture, actions, [], rewards));
});

test('long routes retain a bounded number of snapshots and can seek backwards', () => {
  const level = { ...fixture, budget: 5000 }, actions = Array(4096).fill('wait');
  const review = createRouteReview(level, actions);
  assert.ok(review.checkpointCount <= 18);
  assert.equal(review.at(4096).state.turn, 4096);
  assert.equal(review.at(127).state.turn, 127);
  assert.equal(review.at(0).state.turn, 0);
  assert.equal(review.at(-1), null);
  assert.equal(review.at(NaN), null);
  assert.throws(() => createRouteReview(level, actions.concat('wait')));
  assert.throws(() => createRouteReview(level, ['teleport']));
  assert.throws(() => createRouteReview(level, ['wait'], [0]));
});

test('opening, seeking, keyboard use and backgrounding preserve the exact active route and paused return', () => {
  const { game, listeners, draw } = createHarness();
  game.start(CAMPAIGN[0]); game.guideEnabled = false;
  game.act(CAMPAIGN[0].solution[0]); game.pause();
  const state = game.state, actions = game.actions, modal = game.modal;
  const save = JSON.stringify(game.store.loadRun()), profile = JSON.stringify(game.profile());
  assert.equal(game.openReview(), true);
  assert.equal(game.page, 'review');
  draw();
  assert.ok(game.renderer.hits.length > 0);
  assert.ok(game.renderer.hits.every(hit => hit.action.boardCell === undefined), 'no live board movement targets');
  assert.equal(listeners.key('Home'), true);
  assert.equal(game.routeReview.index, 0);
  assert.equal(listeners.key('ArrowRight'), true);
  assert.equal(game.routeReview.index, 1);
  game.act('wait'); game.undo();
  listeners.hide(); listeners.show();
  assert.equal(game.state, state);
  assert.equal(game.actions, actions);
  assert.equal(JSON.stringify(game.store.loadRun()), save);
  assert.equal(JSON.stringify(game.profile()), profile);
  assert.equal(listeners.key('Escape'), true);
  assert.equal(game.page, 'game'); assert.equal(game.modal, modal); assert.equal(game.routeReview, null);
  assert.equal(closeReview(game), false);
});

test('win and failure reviews return to their original result without settling twice', () => {
  for (const outcome of ['won', 'failed']) {
    const { game, draw } = createHarness();
    const level = CAMPAIGN[0]; game.start(level); game.guideEnabled = false;
    const actions = outcome === 'won' ? level.solution : Array(level.budget).fill('wait');
    game.actions = actions.slice(); game.state = replay(level, actions);
    outcome === 'won' ? game.victory() : game.failure();
    const modal = game.modal, revision = game.store.revision(), state = game.state;
    assert.equal(game.openReview(), true); draw();
    seekReview(game, 0); reviewLandmark(game, 1); draw();
    assert.equal(closeReview(game), true);
    assert.equal(game.modal, modal); assert.equal(game.state, state);
    assert.equal(game.store.revision(), revision);
    assert.equal(game.page, 'game');
  }
});

test('review target sizes and board stay separated on narrow, safe-area and standard screens', () => {
  for (const scale of [1, 320 / 390, .7, 490 / 732]) {
    for (const height of [700, 760, 900]) {
      const ui = reviewLayout(height, scale);
      assert.ok(ui.touch * scale >= 44);
      assert.ok(ui.board.h >= 200);
      assert.ok(ui.board.y + ui.board.h < ui.captionY);
      assert.ok(ui.captionY + 66 < ui.stripY);
      assert.ok(ui.stripY + ui.touch < ui.landmarksY);
      assert.ok(ui.landmarksY + ui.touch < ui.actionsY);
      assert.ok(ui.actionsY + ui.touch <= height - 12);
    }
  }
  assert.deepEqual(reviewWindow(0, 20, 6), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(reviewWindow(19, 20, 6), [14, 15, 16, 17, 18, 19]);
});


test('storage warnings plus deep safe areas keep the review subtitle outside header controls and objectives', () => {
  const metrics = { width: 320, height: 568, pixelRatio: 1, safeTop: 44, safeBottom: 34 };
  const { game, draw } = createHarness({ metrics });
  game.start(CAMPAIGN[0]); game.guideEnabled = false; game.act(CAMPAIGN[0].solution[0]);
  game.platform.storage.set = () => { throw new Error('quota'); };
  game.persist(); game.pause(); game.openReview();
  const labels = [], original = game.renderer.label;
  game.renderer.label = function (...args) { labels.push(args); return original.apply(this, args); };
  draw();
  assert.equal(game.store.getStatus().persisted, false);
  const subtitle = labels.find(args => String(args[0]).includes('只回看'));
  assert.ok(subtitle);
  const [, x, y, width, size] = subtitle;
  assert.ok(y + size / 2 < 82, 'text bottom stays above the objectives');
  assert.ok(x + width < 290, 'text stays to the left of the enlarged return target');
  const back = game.renderer.hits.find(hit => hit.label === '返回');
  assert.ok(back && back.h * game.renderer.scale >= 44);
});
