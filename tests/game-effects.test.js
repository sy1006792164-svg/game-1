'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { drawEffects, actorFrame, MOVE_MS } = require('../src/motion');
const { EVENT_TIMINGS, EFFECT_BATCH_MS } = require('../src/feedback-timing');
const { CAMPAIGN } = require('../src/levels');
const { createState, step } = require('../src/engine');

// Use the shipped Renderer primitives and a Canvas recorder with real style
// save/restore semantics, so drawing errors cannot hide in no-op helper mocks.
function recorder(quality = 'high', alpha = 1) {
  const commands = [], paints = [], stack = [];
  const initial = { globalAlpha: alpha, fillStyle: '#parent-fill', strokeStyle: '#parent-stroke',
    lineWidth: 7, lineCap: 'butt', lineJoin: 'bevel', globalCompositeOperation: 'source-over',
    shadowBlur: 0, shadowColor: '#00000000', shadowOffsetX: 0, shadowOffsetY: 0 };
  const state = { ...initial };
  let dash = [3, 4];
  const snapshot = () => ({ ...state, dash: dash.slice() });
  function finite(value, label) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${label} received ${value}`);
    else if (Array.isArray(value)) value.forEach(item => finite(item, label));
  }
  const methods = {
    save() { stack.push(snapshot()); },
    restore() {
      const saved = stack.pop();
      assert.ok(saved, 'Canvas restore must have a matching save');
      for (const key of Object.keys(state)) delete state[key];
      dash = saved.dash; delete saved.dash; Object.assign(state, saved);
    },
    setLineDash(value) { value.forEach(item => finite(item, 'dash')); dash = value.slice(); },
    getLineDash() { return dash.slice(); },
    measureText(value) { return { width: String(value).length * 8 }; },
    createLinearGradient(...args) { args.forEach(value => finite(value, 'gradient')); return { addColorStop() {} }; },
    createRadialGradient(...args) { args.forEach(value => finite(value, 'gradient')); return { addColorStop() {} }; }
  };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in methods) return methods[key];
      return (...args) => {
        args.forEach(value => finite(value, String(key)));
        if (key === 'arc') assert.ok(args[2] >= 0, 'circle radius is nonnegative');
        if (key === 'ellipse') assert.ok(args[2] >= 0 && args[3] >= 0, 'ellipse radii are nonnegative');
        commands.push([key, args]);
        if (['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText'].includes(key)) {
          assert.ok(state.globalAlpha >= 0 && state.globalAlpha <= 1, 'paint alpha stays in range');
          paints.push({ kind: key, alpha: state.globalAlpha,
            color: key === 'stroke' || key === 'strokeRect' ? state.strokeStyle : state.fillStyle });
        }
      };
    },
    set(target, key, value) { finite(value, String(key)); target[key] = value; return true; }
  });
  const r = new Renderer({ getContext: () => ctx });
  r.effectsQuality = quality;
  return { r, commands, paints, stack, snapshot };
}

const project = cell => [60 + cell % 7 * 19, 80 + Math.floor(cell / 7) * 13];
function gameFor(type = 'letter', cell = 9) {
  const level = CAMPAIGN[19], previousState = createState(level);
  return { level, session: 1, undosUsed: 0, page: 'game', transitionAt: 1000,
    previousState, state: { ...previousState, player: cell, turn: 1 },
    moveEvents: [{ type, cell }], actions: ['right'], reviewing: false };
}
function sample(record, game, age, options = {}, point = project, unit = 42) {
  record.commands.length = 0; record.paints.length = 0;
  drawEffects(record.r, game, game.transitionAt + age, point, unit, options);
  assert.equal(record.stack.length, 0, 'each rendered frame balances Canvas save/restore');
  return record.paints.length;
}

function campaignTurn(id, turn) {
  const level = CAMPAIGN[id - 1], actions = level.solution.slice(0, turn);
  let state = createState(level), previousState, moveEvents;
  for (const action of actions) {
    previousState = state;
    const result = step(level, state, action);
    assert.ok(result.moved, 'the sample follows a legal shipped route');
    state = result.state; moveEvents = result.events;
  }
  return { level, previousState, state, moveEvents, actions, transitionAt: 1000, session: 1, undosUsed: 0 };
}

test('same-cell real pickups replace only the ordinary landing burst without changing event order or remaining effects', () => {
  for (const [id, turn, type] of [[1, 3, 'letter'], [19, 3, 'light'], [73, 26, 'seal']]) {
    const game = campaignTurn(id, turn), original = JSON.stringify(game.moveEvents);
    const move = game.moveEvents.find(event => event.type === 'move');
    assert.ok(game.moveEvents.some(event => event.type === type && event.cell === move.cell));
    // Retain the original index so this expected frame also checks that other
    // particles keep their deterministic trajectories and wind references.
    const pickupOnly = { ...game, moveEvents: game.moveEvents.map(event => event === move ? { ...event, type: 'omitted' } : event) };
    for (const quality of ['high', 'low']) for (const age of [126, 200, 400, 539, 620]) {
      const actual = recorder(quality), expected = recorder(quality);
      sample(actual, game, age); sample(expected, pickupOnly, age);
      assert.deepEqual(actual.commands, expected.commands, `${type}: only the duplicate move geometry is omitted`);
      assert.deepEqual(actual.paints, expected.paints, `${type}: collection and any bridge effects keep their colors and opacity`);
      assert.ok(actual.paints.length > 0, `${type}: the collection stays visible`);
      assert.deepEqual(actual.r.motionEffects.batches[0].events.slice(0, game.moveEvents.length), game.moveEvents);
    }
    assert.equal(JSON.stringify(game.moveEvents), original, 'rendering cannot edit engine events');
  }
});

test('remote echo pickups and wind landings retain the original ordinary step feedback', () => {
  for (const [id, turn, type] of [[1, 4, 'seal'], [14, 24, 'letter'], [34, 21, 'light']]) {
    const game = campaignTurn(id, turn), move = game.moveEvents.find(event => event.type === 'move');
    const pickup = game.moveEvents.find(event => event.type === type);
    assert.notEqual(move.cell, pickup.cell, 'these legal pickups happen away from the ordinary landing');
    for (const quality of ['high', 'low']) {
      const actual = recorder(quality), stepOnly = recorder(quality);
      sample(actual, game, 280);
      sample(stepOnly, { ...game, previousState: null, moveEvents: [move] }, 280);
      assert.deepEqual(actual.commands.slice(0, stepOnly.commands.length), stepOnly.commands);
      assert.deepEqual(actual.paints.slice(0, stepOnly.paints.length), stepOnly.paints);
      assert.ok(actual.paints.length > stepOnly.paints.length, 'the separate collection remains visible too');
    }
  }
});

test('a turn is consumed once and cannot replay after the last particle expires', () => {
  const record = recorder(), game = gameFor();
  assert.ok(sample(record, game, 200) > 0);
  const count = record.paints.length;
  assert.equal(sample(record, game, 200), count, 'redrawing the same instant does not duplicate a burst');
  assert.equal(record.r.motionEffects.batches.length, 1);
  assert.equal(sample(record, game, EFFECT_BATCH_MS + 10), 0);
  assert.equal(record.r.motionEffects.batches.length, 0);
  assert.equal(sample(record, game, 200), 0, 'an expired source is already consumed even if a QA clock seeks back');
});

test('a rapid next action preserves the first collection particles at their original age', () => {
  const record = recorder(), game = gameFor();
  sample(record, game, 150);
  const original = record.r.motionEffects.batches[0];
  game.previousState = game.state;
  game.state = { ...game.state, player: 10, turn: 2 };
  game.transitionAt += MOVE_MS;
  game.moveEvents = [{ type: 'move', cell: 10 }];
  sample(record, game, 160);
  assert.equal(record.r.motionEffects.batches.length, 2);
  assert.equal(record.r.motionEffects.batches[0], original, 'old particles retain their trajectory and start time');
  assert.equal(original.at, 1000);
  assert.ok(record.paints.some(paint => paint.kind === 'fill'), 'the old collection still paints during the next step');
});

test('undo removes old forward bursts while retaining the new rewind feedback', () => {
  const record = recorder(), game = gameFor();
  sample(record, game, 180);
  game.previousState = game.state;
  game.state = { ...game.state, turn: 0 };
  game.undosUsed++;
  game.transitionAt += 200;
  game.moveEvents = [{ type: 'undo', cell: game.state.player }];
  assert.ok(sample(record, game, 140) > 0);
  assert.equal(record.r.motionEffects.batches.length, 1);
  assert.deepEqual(record.r.motionEffects.batches[0].events.map(event => event.type), ['undo']);
});

test('changing session or level discards old effects without replaying the consumed source', () => {
  for (const change of [game => { game.session++; }, game => { game.level = CAMPAIGN[20]; }]) {
    const record = recorder(), game = gameFor();
    sample(record, game, 180); change(game);
    assert.equal(sample(record, game, 240), 0);
    assert.equal(record.r.motionEffects.batches.length, 0);
  }
});

test('review and reduced motion consume hidden events so returning never restarts a burst', () => {
  for (const mode of ['review', 'reduced']) {
    const record = recorder(), game = gameFor();
    sample(record, game, 180);
    game.transitionAt += 200; game.moveEvents = [{ type: 'seal', cell: 12 }];
    if (mode === 'review') game.reviewing = true;
    assert.equal(sample(record, game, 150, { reducedMotion: mode === 'reduced' }), 0);
    assert.equal(record.r.motionEffects.batches.length, 0);
    game.reviewing = false;
    assert.equal(sample(record, game, 230), 0);
  }
});

test('a pause or background interval lets short feedback settle and cannot resurrect it on resume', () => {
  const record = recorder(), game = gameFor('wind');
  sample(record, game, 160);
  game.modal = { kind: 'pause' };
  assert.equal(sample(record, game, 60000), 0);
  assert.equal(record.r.motionEffects.batches.length, 0);
  game.modal = null;
  assert.equal(sample(record, game, 60100), 0);
});

test('every event draws safely throughout its life and restores all inherited Canvas styles', () => {
  const types = Object.keys(EVENT_TIMINGS).filter(type => type !== 'blocked');
  for (const type of types) for (const quality of ['high', 'low']) {
    const timing = EVENT_TIMINGS[type], game = gameFor(type);
    const record = recorder(quality, .23), before = record.snapshot();
    for (const fraction of [0, .02, .25, .5, .8, .99, 1]) {
      sample(record, game, timing.delay + timing.duration * fraction);
      assert.deepEqual(record.snapshot(), before, `${type} ${quality} restores parent drawing state`);
    }
  }
});

test('event drawing inherits the parent opacity instead of making a dimmed board glow at full strength', () => {
  for (const type of ['letter', 'seal', 'light', 'bridge', 'repair', 'wind', 'echo-born', 'ready', 'win', 'fail']) {
    const full = recorder(), faded = recorder('high', .23);
    sample(full, gameFor(type), 280); sample(faded, gameFor(type), 280);
    assert.equal(faded.paints.length, full.paints.length, type);
    faded.paints.forEach((paint, index) => assert.ok(Math.abs(paint.alpha - full.paints[index].alpha * .23) < 1e-9,
      `${type} opacity respects the enclosing board fade`));
  }
});

test('low quality keeps each gameplay cue visible with fewer submitted paint operations', () => {
  for (const type of ['move', 'letter', 'seal', 'light', 'bridge', 'repair', 'wind', 'wait', 'undo', 'win']) {
    const high = recorder(), low = recorder('low');
    const normal = sample(high, gameFor(type), 280), cheap = sample(low, gameFor(type), 280);
    assert.ok(cheap > 0, `${type} remains visible on a low-end device`);
    assert.ok(cheap < normal, `${type} submits less geometry in low quality (${cheap} vs ${normal})`);
  }
});

test('invalid event cells, points and units never send NaN or negative radii to Canvas', () => {
  const record = recorder(), game = gameFor();
  game.moveEvents = [null, {}, { type: 'letter', cell: -1 }, { type: 'win', cell: NaN },
    { type: 'unknown', cell: 3 }, { type: 'seal', cell: 4 }];
  for (const unit of [undefined, NaN, Infinity, -20, 0, 18]) {
    sample(record, game, 280, {}, () => [NaN, Infinity], unit);
  }
  assert.ok(record.paints.length > 0, 'the valid event still has a safe fallback position');
});

test('real wind moves travel through the wind tile before reaching the pushed destination', () => {
  let scenario;
  for (const level of CAMPAIGN.slice(18, 60)) {
    let state = createState(level);
    for (const [index, action] of level.solution.entries()) {
      const result = step(level, state, action);
      if (result.events.some(event => event.type === 'wind')) {
        scenario = { level, previousState: state, state: result.state, moveEvents: result.events,
          transitionAt: 1000, actions: level.solution.slice(0, index + 1) };
        break;
      }
      state = result.state;
    }
    if (scenario) break;
  }
  assert.ok(scenario, 'the shipped legal routes contain a wind-push sample');
  const entry = scenario.moveEvents.find(event => event.type === 'move').cell;
  const middle = actorFrame(scenario, 1000 + MOVE_MS / 2, project);
  assert.deepEqual([middle.x, middle.y], project(entry));
  const arrived = actorFrame(scenario, 1000 + MOVE_MS, project);
  assert.deepEqual([arrived.x, arrived.y], project(scenario.state.player));
  assert.equal(arrived.moving, false);
});
