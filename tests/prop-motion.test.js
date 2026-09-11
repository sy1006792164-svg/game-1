'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { drawWindRune, drawBridgeFlutter, lampFrame, drawLampFlame } = require('../src/prop-motion');

// Record actual Canvas paths, including the real Renderer.line implementation.
// Path state deliberately is not saved: Canvas save/restore only saves styles.
function recorder(options = {}, alpha = 1) {
  const paints = [], stack = [];
  let path = [], dash = [3, 4];
  const keys = ['globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin'];
  const ctx = {
    globalAlpha: alpha, fillStyle: '#parent-fill', strokeStyle: '#parent-stroke',
    lineWidth: 7, lineCap: 'butt', lineJoin: 'bevel',
    save() { stack.push(snapshot()); },
    restore() {
      const saved = stack.pop();
      assert.ok(saved, 'every restore has a matching save');
      for (const key of keys) this[key] = saved[key];
      dash = saved.dash.slice();
    },
    setLineDash(value) { dash = value.slice(); },
    beginPath() { path = []; },
    moveTo(...args) { path.push(['moveTo', ...args]); },
    lineTo(...args) { path.push(['lineTo', ...args]); },
    quadraticCurveTo(...args) { path.push(['quadraticCurveTo', ...args]); },
    closePath() { path.push(['closePath']); },
    fill() { paint('fill'); },
    stroke() { paint('stroke'); }
  };
  function snapshot() {
    return { ...Object.fromEntries(keys.map(key => [key, ctx[key]])), dash: dash.slice() };
  }
  function paint(kind) {
    paints.push({ kind, path: path.map(command => command.slice()), alpha: ctx.globalAlpha,
      color: kind === 'fill' ? ctx.fillStyle : ctx.strokeStyle, width: ctx.lineWidth });
  }
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { reducedMotion: false, effectsQuality: 'high' }, options);
  return { r, paints, snapshot, stack };
}

const point = command => command.slice(1);
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, message);

function wind(now, vector = [22, 12], seed = 0, options = {}) {
  const record = recorder(options);
  drawWindRune(record.r, 120, 80, vector, now, seed);
  return record.paints;
}

test('every wind arrow keeps its projected direction and complete arrowhead throughout motion', () => {
  for (const vector of [[22, 12], [-22, -12], [-22, 12], [22, -12]]) {
    for (let now = 0; now < 6000; now += 137) {
      const paints = wind(now, vector, 7);
      assert.ok(paints.length >= 2, 'the permanent instruction is always drawn');
      for (let index = 0; index < paints.length; index += 2) {
        const shaft = paints[index].path.map(point), head = paints[index + 1].path.map(point);
        const direction = minus(shaft[1], shaft[0]);
        assert.ok(dot(direction, vector) > 0, 'shaft points along the game direction');
        close(cross(direction, vector), 0, 'shaft stays aligned to its isometric axis');
        assert.deepEqual(head[1], shaft[1], 'arrowhead is attached to the shaft tip');
        for (const wing of [head[0], head[2]]) {
          assert.ok(dot(minus(head[1], wing), vector) > 0, 'both wings stay behind the tip');
        }
        assert.ok(cross(minus(head[0], head[1]), vector) * cross(minus(head[2], head[1]), vector) < 0,
          'arrowhead wings remain on opposite sides of the shaft');
        assert.ok([...shaft, ...head].flat().every(Number.isFinite));
      }
    }
  }
});

test('the moving ink advances, fades before wrapping, and leaves a real resting interval', () => {
  const vector = [22, 12];
  for (const seed of [0, 1, 17]) {
    let previous, rests = 0, longestRest = 0, advances = 0, starts = 0, ends = 0;
    const base = wind(0, vector, seed).slice(0, 2);
    for (let now = 0; now < 12000; now += 16) {
      const paints = wind(now, vector, seed), moving = paints[2];
      assert.deepEqual(paints.slice(0, 2), base, 'base rune never moves or fades');
      if (!moving) {
        longestRest = Math.max(longestRest, ++rests);
        if (previous) { assert.ok(previous.alpha < .01, 'ink disappears before a rest'); ends++; }
      } else {
        rests = 0;
        if (!previous && now > 0) { assert.ok(moving.alpha < .01, 'new pass begins invisibly'); starts++; }
        if (previous) {
          const delta = dot(minus(point(moving.path[0]), point(previous.path[0])), vector);
          assert.ok(delta >= -1e-9, 'a visible pass never reverses or snaps backwards');
          if (delta > .01 && moving.alpha > .1) advances++;
        }
      }
      previous = moving;
    }
    assert.ok(longestRest * 16 >= 250, 'each cycle contains a perceptible pause');
    assert.ok(advances > 30 && starts >= 3 && ends >= 3, 'several complete advancing cycles were observed');
  }
});

test('reduced motion and low quality retain static wind instructions and visible lamplight', () => {
  for (const options of [{ reducedMotion: true }, { effectsQuality: 'low' }]) {
    for (const now of [0, 917, 9000, 60000]) {
      const arrows = wind(now, [22, -12], 3, options);
      assert.equal(arrows.length, 2);
      assert.deepEqual(arrows, wind(0, [22, -12], 3, options));
      const first = recorder(options), later = recorder(options);
      const still = lampFrame(first.r, 0, 8);
      assert.deepEqual(lampFrame(later.r, now, 8), still);
      drawLampFlame(first.r, still); drawLampFlame(later.r, lampFrame(later.r, now, 8));
      assert.deepEqual(later.paints, first.paints);
      assert.ok(later.paints.some(paint => paint.kind === 'fill' && paint.alpha > 0));
      drawBridgeFlutter(later.r, 30, 20, 12, 6, now, 8);
      assert.deepEqual(later.paints, first.paints, 'quiet mode adds no moving paper corners');
    }
  }
});

test('paper corners flutter continuously inside a small bridge while their hinges stay fixed', () => {
  const x = 30, y = 20, hw = 12, hh = 6, tips = [[], []];
  let first, previous;
  for (let now = 0; now < 8000; now += 16) {
    const record = recorder();
    drawBridgeFlutter(record.r, x, y, hw, hh, now, 5);
    const corners = record.paints.filter(paint => paint.kind === 'fill').map(paint => paint.path.slice(0, 3).map(point));
    assert.equal(corners.length, 2);
    if (!first) first = corners;
    corners.forEach((corner, side) => {
      assert.deepEqual([corner[0], corner[2]], [first[side][0], first[side][2]], 'hinges stay attached to the deck');
      close(corner[1][0], first[side][1][0], 'corner does not slide sideways off the bridge');
      for (const [px, py] of corner) assert.ok(Math.abs(px - x) < hw && Math.abs(py - y) < hh);
      assert.ok(corner[1][1] <= y, 'loose corner lifts above the paper surface');
      if (previous) assert.ok(Math.abs(corner[1][1] - previous[side][1][1]) < .15, 'no per-frame jumps');
      tips[side].push(corner[1][1]);
    });
    previous = corners;
  }
  for (const positions of tips) assert.ok(Math.max(...positions) - Math.min(...positions) > .4, 'small-size flutter is visible');
  assert.notDeepEqual(tips[0], tips[1], 'paper corners do not move in lockstep');
});

test('lamplight changes gently within its tiny lantern and never flashes or goes out', () => {
  const record = recorder(), heights = [], leans = [], warmth = [];
  let previous, first;
  for (let now = 0; now < 8000; now += 16) {
    const frame = lampFrame(record.r, now, 3);
    assert.ok(frame.warmth >= 0 && frame.warmth <= 1);
    assert.ok(Math.abs(frame.lean) < 1 && frame.height > 3 && frame.height < 6);
    if (previous) for (const key of ['warmth', 'lean', 'height']) {
      assert.ok(Math.abs(frame[key] - previous[key]) < .04, 'lamplight stays continuous');
    }
    const drawn = recorder(); drawLampFlame(drawn.r, frame);
    const flame = drawn.paints.find(paint => paint.kind === 'fill');
    assert.ok(flame && flame.alpha > 0, 'flame is visible at every instant');
    for (const command of flame.path) for (let index = 1; index < command.length; index += 2) {
      assert.ok(Math.abs(command[index]) < 2 && command[index + 1] >= 3 && command[index + 1] <= 10);
    }
    if (!first) first = drawn.paints;
    if (now > 7900) assert.notDeepEqual(drawn.paints, first, 'actual flame geometry moves');
    heights.push(frame.height); leans.push(frame.lean); warmth.push(frame.warmth);
    previous = frame;
  }
  for (const values of [heights, leans, warmth]) assert.ok(Math.max(...values) - Math.min(...values) > .4);
});

test('all prop painters inherit parent alpha and restore Canvas styles in active, resting and quiet frames', () => {
  const draws = [
    (r, now) => drawWindRune(r, 20, 30, [22, -12], now, 0),
    (r, now) => drawBridgeFlutter(r, 20, 30, 12, 6, now, 0),
    (r, now) => drawLampFlame(r, lampFrame(r, now, 0))
  ];
  for (const options of [{}, { reducedMotion: true }, { effectsQuality: 'low' }]) {
    for (const now of [0, 900, 2400]) for (const draw of draws) {
      const full = recorder(options), faded = recorder(options, .23), before = faded.snapshot();
      draw(full.r, now); draw(faded.r, now);
      assert.deepEqual(faded.snapshot(), before, 'parent alpha, styles and line dash are preserved');
      assert.equal(faded.stack.length, 0, 'Canvas save/restore remains balanced');
      assert.equal(full.paints.length, faded.paints.length);
      faded.paints.forEach((paint, index) => {
        assert.deepEqual(paint.path, full.paints[index].path);
        close(paint.alpha, full.paints[index].alpha * .23, 'paint opacity inherits the parent');
      });
    }
  }
});
