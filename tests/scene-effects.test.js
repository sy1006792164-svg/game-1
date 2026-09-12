'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { MOVE_MS } = require('../src/motion');
const { drawActorTrails, drawDestination, drawCollectibleAura } = require('../src/scene-effects');

function recorder(options = {}, alpha = 1) {
  const paints = [], stack = [];
  const state = { globalAlpha: alpha, fillStyle: '#parent', strokeStyle: '#parent', lineWidth: 3,
    lineCap: 'butt', lineJoin: 'bevel', font: '12px serif', textAlign: 'left', textBaseline: 'top' };
  let path = [], dash = [2, 4];
  const methods = {
    save() { stack.push({ ...state, dash: dash.slice() }); },
    restore() {
      const saved = stack.pop();
      assert.ok(saved, 'Canvas restore must have a matching save');
      dash = saved.dash; delete saved.dash;
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, saved);
    },
    setLineDash(value) { dash = value.slice(); },
    beginPath() { path = []; },
    fill() { paint('fill', state.fillStyle); },
    stroke() { paint('stroke', state.strokeStyle); },
    fillText(...args) { paints.push({ kind: 'text', args, alpha: state.globalAlpha, color: state.fillStyle }); }
  };
  function paint(kind, color) {
    paints.push({ kind, color, alpha: state.globalAlpha, width: state.lineWidth, path: path.map(part => part.slice()) });
  }
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in methods) return methods[key];
      return (...args) => path.push([key, ...args]);
    }
  });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { reducedMotion: false, effectsQuality: 'high' }, options);
  return { r, paints, stack, snapshot: () => ({ ...state, dash: dash.slice() }) };
}

const points = [[60, 80], [90, 95], [60, 110], [125, 85], [95, 100]];
const point = cell => points[cell];
function movingGame(echo = false) {
  return { transitionAt: 1000, previousState: { player: 0, echo: echo ? 3 : null },
    state: { player: 2, echo: echo ? 4 : null }, motionPath: [0, 1, 2] };
}
function trails(now, options = {}, game = movingGame()) {
  const record = recorder(options);
  drawActorTrails(record.r, game, now, point, 30);
  return record;
}
const trailColors = new Set(['#e6b766', '#fff0bd', '#51c8bf', '#b5fff2']);
const trailPaints = record => record.paints.filter(paint => trailColors.has(paint.color));

test('movement ribbons use actual wind-push path samples and expire after the arrival tail', () => {
  const record = trails(1000 + MOVE_MS), paths = trailPaints(record);
  assert.ok(paths.length > 5, 'a complete step has a layered, visible trail');
  let beforeCorner = false, afterCorner = false;
  for (const paint of paths) for (const command of paint.path) {
    const [x, y] = command.slice(1);
    assert.ok(x >= 60 && x <= 90 && y >= 80 && y <= 110, 'ribbon cannot overshoot the actual move');
    const onEntry = Math.abs(y - 80 - (x - 60) / 2) < 1e-8;
    const onExit = Math.abs(y - 110 + (x - 60) / 2) < 1e-8;
    assert.ok(onEntry || onExit, 'every sampled vertex lies on a real movement leg');
    beforeCorner ||= onEntry && x > 65;
    afterCorner ||= onExit && y > 98;
  }
  assert.ok(beforeCorner && afterCorner, 'the trail shows both legs rather than drawing a shortcut');
  assert.ok(trailPaints(trails(1000 + MOVE_MS + 60)).length > 0, 'arrival retains a short readable tail');
  assert.equal(trailPaints(trails(1000 + MOVE_MS + 211)).length, 0, 'settled trails disappear');
  assert.equal(trailPaints(trails(999)).length, 0, 'a future move cannot leave a premature trail');
  assert.equal(trailPaints(trails(1200, {}, { ...movingGame(), transitionAt: -Infinity })).length, 0);
});

test('ribbon strokes pass through every wind corner in high and low quality, including undo', () => {
  const onLeg = (sample, from, to) => {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const sx = sample[0] - from[0], sy = sample[1] - from[1];
    const dot = sx * dx + sy * dy;
    return Math.abs(sx * dy - sy * dx) < 1e-7 && dot >= -1e-7 && dot <= dx * dx + dy * dy + 1e-7;
  };
  for (const motionPath of [[0, 1, 2], [2, 1, 0], [0, 1, 2, 4], [4, 2, 1, 0]]) {
    const game = { ...movingGame(), motionPath, previousState: { player: motionPath[0], echo: null },
      state: { player: motionPath[motionPath.length - 1], echo: null } };
    const legs = motionPath.slice(1).map((cell, index) => [point(motionPath[index]), point(cell)]);
    for (const effectsQuality of ['high', 'low']) for (const age of [75, 120, 180, 210]) {
      const paints = trailPaints(trails(1000 + age, { effectsQuality }, game));
      assert.ok(paints.length > 0);
      const vertices = [];
      for (const paint of paints) {
        const positions = paint.path.map(command => command.slice(1));
        vertices.push(...positions);
        for (let index = 1; index < positions.length; index++) {
          assert.ok(legs.some(([from, to]) => onLeg(positions[index - 1], from, to) && onLeg(positions[index], from, to)),
            'each complete painted line segment stays on one movement leg instead of cutting across its corner');
        }
      }
      const smooth = value => value * value * (3 - 2 * value);
      const start = smooth(Math.max(0, age - (effectsQuality === 'low' ? 100 : 210)) / MOVE_MS);
      const end = smooth(Math.min(age, MOVE_MS) / MOVE_MS);
      for (let index = 1; index < motionPath.length - 1; index++) {
        const cornerProgress = index / (motionPath.length - 1), corner = point(motionPath[index]);
        const visible = vertices.some(vertex => Math.hypot(vertex[0] - corner[0], vertex[1] - corner[1]) < 1e-8);
        assert.equal(visible, cornerProgress >= start && cornerProgress <= end,
          'every corner in the current tail window is explicit, and expired corners never extend its tail');
      }
    }
  }
});

test('low quality keeps deliberate golden and cyan movement feedback with fewer paint calls', () => {
  const high = trails(1130, {}, movingGame(true));
  const low = trails(1130, { effectsQuality: 'low' }, movingGame(true));
  assert.ok(low.paints.length < high.paints.length * .7);
  for (const color of ['#fff0bd', '#b5fff2']) {
    assert.ok(low.paints.some(paint => paint.color === color && paint.alpha > .1), 'both actors retain visible movement feedback');
  }
  assert.notDeepEqual(trailPaints(low), trailPaints(trails(1090, { effectsQuality: 'low' }, movingGame(true))));
});

test('reduced motion freezes echo presence and omits moving trails through either setting', () => {
  for (const explicit of [false, true]) {
    const frame = now => {
      const record = recorder(explicit ? {} : { reducedMotion: true });
      drawActorTrails(record.r, movingGame(true), now, point, 30, { reducedMotion: explicit });
      return record;
    };
    const first = frame(1030), later = frame(60000);
    assert.deepEqual(first.paints, later.paints);
    assert.equal(trailPaints(first).length, 0);
    assert.ok(first.paints.some(paint => paint.color === '#c5fff0'), 'the echo remains identifiable in a still frame');
  }
});

test('idle echo ornaments share paused decorative time and never add interaction targets', () => {
  const game = { ...movingGame(true), transitionAt: -Infinity };
  const first = trails(5000, { ambientNow: 5000 }, game);
  const paused = trails(60000, { ambientNow: 5000 }, game);
  assert.deepEqual(first.paints, paused.paints);
  assert.notDeepEqual(first.paints, trails(60000, { ambientNow: 60000 }, game).paints);
  assert.equal(first.r.hits.length, 0);
});

const projection = { point: () => [120, 180], halfW: 30, halfH: 15 };
const destinationGame = { level: { exit: 4 }, state: { letters: [], seals: [], status: 'playing' } };
function destination(now, options = {}, game = destinationGame, action) {
  const record = recorder(options);
  drawDestination(record.r, game, now, projection, {}, action);
  return record;
}

test('the destination gate appears only when delivery is ready and preserves its existing label hit box', () => {
  const action = () => {}, record = destination(1000, {}, destinationGame, action);
  assert.ok(record.paints.some(paint => paint.path && paint.path.some(command => command[0] === 'bezierCurveTo')));
  assert.ok(record.paints.some(paint => paint.kind === 'text' && paint.args[0] === '可投递'));
  assert.deepEqual(record.r.hits, [{ x: 92, y: 121.6, w: 56, h: 16, action, contains: undefined }]);
  for (const key of ['letters', 'seals']) {
    const hidden = destination(1000, {}, { ...destinationGame, state: { ...destinationGame.state, [key]: [1] } }, action);
    assert.equal(hidden.paints.length, 0);
    assert.equal(hidden.r.hits.length, 0);
  }
  assert.equal(destination(1000).r.hits.length, 0, 'decorative gate creates no new hit surface');
});

test('the ready gate has static quiet frames and a smaller low-quality paint budget', () => {
  for (const options of [{ reducedMotion: true }, { effectsQuality: 'low' }]) {
    assert.deepEqual(destination(1000, options).paints, destination(60000, options).paints);
  }
  assert.ok(destination(1000, { effectsQuality: 'low' }).paints.length < destination(1000).paints.length);
  assert.notDeepEqual(destination(1000).paints, destination(1500).paints);
});

test('collectible auras distinguish gold mail from cyan stamps while staying sparse and inside the prop footprint', () => {
  for (const seal of [false, true]) {
    const record = recorder();
    drawCollectibleAura(record.r, 120, 180, 24, 1100, 7, seal);
    assert.equal(record.paints.length, 5, 'each collectible adds only a floor mark and two tiny paper lights');
    assert.ok(record.paints.some(paint => paint.color === (seal ? '#6cb9b0' : '#d1ac65')));
    for (const paint of record.paints) for (const command of paint.path || []) {
      if (command[0] === 'ellipse' || command[0] === 'closePath') continue;
      const [x, y] = command.slice(1);
      assert.ok(Math.abs(x - 120) < 24 * .7 && y > 180 - 24 * 1.2 && y < 180 + 24 * .25,
        'light stays beside its own collectible and leaves neighboring cells clear');
    }
    assert.equal(record.r.hits.length, 0);
  }
});

test('collectible auras freeze in low quality and reduced motion while ordinary frames retain movement', () => {
  const frame = (now, options, seal) => {
    const record = recorder(options);
    drawCollectibleAura(record.r, 120, 180, 24, now, 7, seal);
    return record.paints;
  };
  for (const seal of [false, true]) {
    for (const options of [{ reducedMotion: true }, { effectsQuality: 'low' }]) {
      assert.deepEqual(frame(1000, options, seal), frame(60000, options, seal));
    }
    assert.ok(frame(1000, { effectsQuality: 'low' }, seal).length < frame(1000, {}, seal).length);
    assert.notDeepEqual(frame(1000, {}, seal), frame(1800, {}, seal));
  }
});

test('actor and destination effects inherit opacity and restore all Canvas styles', () => {
  for (const options of [{}, { reducedMotion: true }, { effectsQuality: 'low' }]) {
    for (const draw of [
      r => drawActorTrails(r, movingGame(true), 1120, point, 30),
      r => drawDestination(r, destinationGame, 1120, projection),
      r => drawCollectibleAura(r, 120, 180, 24, 1120, 7, false),
      r => drawCollectibleAura(r, 120, 180, 24, 1120, 7, true)
    ]) {
      const full = recorder(options), faded = recorder(options, .23), before = faded.snapshot();
      draw(full.r); draw(faded.r);
      assert.deepEqual(faded.snapshot(), before);
      assert.equal(faded.stack.length, 0);
      assert.equal(full.paints.length, faded.paints.length);
      faded.paints.forEach((paint, index) => {
        assert.ok(Math.abs(paint.alpha - full.paints[index].alpha * .23) < 1e-9);
        assert.deepEqual(paint.path, full.paints[index].path);
      });
    }
  }
});
