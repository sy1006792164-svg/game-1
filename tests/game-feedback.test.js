'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, replay } = require('../src/engine');
const { gameFeedback, objectiveFeedback, drawObjectiveFeedback } = require('../src/game-feedback');
const { collectSamples } = require('../tools/effects-audit');

function fixture(level, itemRewards, options = {}) {
  const game = { level, state: createState(level, itemRewards), transitionAt: -10000,
    moveEvents: [], actions: [], session: 1 };
  const draws = [], stack = [], renderer = { ...options,
    ctx: { globalAlpha: 1, save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
      measureText(value) { return { width: String(value).length * 7 }; } },
    font() {}, text(value) { draws.push({ value, alpha: renderer.ctx.globalAlpha }); }
  };
  gameFeedback(renderer, game, 0);
  function act(action, at) {
    const result = step(level, game.state, action);
    assert.ok(result.moved, 'regression setup uses a legal engine action');
    game.previousState = game.state; game.state = result.state;
    game.moveEvents = result.events; game.transitionAt = at; game.actions.push(action);
    return gameFeedback(renderer, game, at);
  }
  function read(now, objective) { return objectiveFeedback(gameFeedback(renderer, game, now), objective); }
  return { game, renderer, act, read, draws };
}

test('consecutive blue-ticket flights acknowledge each arrival without delaying or hiding earlier gains', () => {
  const level = CAMPAIGN[8], run = fixture(level);
  for (let index = 0; index <= 21; index++) run.act(level.solution[index], index * 180);
  assert.equal(run.read(3800, 2).value, '+1');
  const second = run.read(3880, 2);
  assert.equal(second.value, '+2', 'second pickup arrives while the third is still in flight');
  assert.equal(second.impactAt, 3240 + 620);
  drawObjectiveFeedback(run.renderer, second, { x: 0, y: 0, w: 32, h: 16 }, 3880);
  assert.deepEqual(run.draws.at(-1), { value: '+2', alpha: 1 }, 'a fresh pickup never blanks an existing gain');
  const third = run.read(4420, 2);
  assert.equal(third.value, '+3');
  assert.equal(third.impactAt, 3780 + 620);
  assert.equal(third.pending.length, 0, 'completed flight records are released');
});

test('waiting preserves pending oil gains and displays the actual +6 per completed flight in low quality', () => {
  const run = fixture(CAMPAIGN[43], { oil: 2 }, { effectsQuality: 'low' });
  run.act('item:oil', 0); run.act('item:oil', 180); run.act('wait', 360);
  assert.equal(run.read(500, 0).type, 'light');
  assert.equal(run.read(650, 0).value, '+6 拍');
  const last = run.read(820, 0);
  assert.equal(last.value, '+12 拍');
  assert.equal(last.pending.length, 0);
});

test('reduced motion confirms rewards immediately and undo/modal/session changes release pending rewards', () => {
  const quiet = fixture(CAMPAIGN[43], { oil: 1 }, { reducedMotion: true });
  quiet.act('item:oil', 0);
  assert.equal(quiet.read(0, 0).value, '+6 拍');
  assert.equal(quiet.read(0, 0).pending.length, 0);
  const run = fixture(CAMPAIGN[43], { oil: 1 });
  run.act('item:oil', 0);
  assert.equal(run.read(0, 0).pending.length, 1);
  run.game.state = run.game.previousState;
  run.game.moveEvents = [{ type: 'undo', cell: run.game.state.player }];
  run.game.transitionAt = 180;
  assert.equal(run.read(180, 0), null);
  run.act('item:oil', 360);
  run.game.modal = { kind: 'pause' };
  assert.equal(run.read(400, 0), null);
  run.game.modal = null;
  assert.equal(run.read(500, 0), null, 'closing a modal does not replay old gains');
  run.game.session++; run.game.moveEvents = []; run.game.transitionAt = 600;
  assert.equal(run.read(620, 0), null);
});

test('all eight effect-audit samples replay through current engine rules and explicit test inventory', () => {
  const samples = collectSamples();
  assert.equal(samples.length, 8);
  for (const sample of samples) {
    const level = CAMPAIGN.find(candidate => candidate.id === sample.levelId);
    assert.deepEqual(replay(level, sample.actions, [], sample.itemRewards), sample.state, sample.type);
  }
  const oil = samples.find(sample => sample.type === 'light');
  assert.deepEqual(oil.itemRewards, { oil: 1 });
  assert.equal(oil.events.find(event => event.type === 'light').amount, 6);
});
