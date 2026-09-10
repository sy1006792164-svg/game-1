'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { drawTitle } = require('../src/brand-title');
const { C } = require('../src/theme');
const { CAMPAIGN } = require('../src/levels');

// Deliberately expose only baseline Canvas geometry. Font, text, image, transforms and Path2D
// access fails instead of being silently accepted by the broader renderer mocks.
function outlineCanvas() {
  const fills = [], stack = [];
  let state = { sx: 2, sy: 2, x: 17, y: 23, fillStyle: '#123456' };
  let points = [], closed = 0;
  const initial = { ...state };
  const addPoint = (x, y) => {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'outline coordinates must be finite');
    points.push([state.x + state.sx * x, state.y + state.sy * y]);
  };
  const methods = {
    save() { stack.push({ ...state }); },
    restore() { assert.ok(stack.length, 'restore must match save'); state = stack.pop(); },
    beginPath() { points = []; closed = 0; },
    moveTo: addPoint,
    lineTo: addPoint,
    bezierCurveTo(...values) { for (let i = 0; i < values.length; i += 2) addPoint(values[i], values[i + 1]); },
    closePath() { closed++; },
    fill(...args) {
      assert.equal(args.length, 0, 'ordinary fill preserves the font contour winding without Path2D');
      fills.push({ points: points.slice(), closed, color: state.fillStyle });
    },
  };
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'fillStyle') return state.fillStyle;
      assert.ok(Object.hasOwn(methods, key), 'unexpected Canvas dependency: ' + String(key));
      return methods[key];
    },
    set(_, key, value) {
      assert.equal(key, 'fillStyle', 'outlines must not set a device font or another Canvas property');
      state.fillStyle = value; return true;
    },
  });
  return { ctx, fills, initial, state: () => state, depth: () => stack.length };
}

function assertTitleGeometry(record, y, size, spacing, color = C.ink) {
  assert.equal(record.fills.length, 4, 'all four characters must be visibly filled');
  record.fills.forEach((fill, index) => {
    assert.equal(fill.color, color);
    assert.ok(fill.points.length > 12 && fill.closed > 0, 'each character has a complete, nonempty outline');
    const xs = fill.points.map(point => (point[0] - record.initial.x) / record.initial.sx);
    const ys = fill.points.map(point => (point[1] - record.initial.y) / record.initial.sy);
    assert.ok([...xs, ...ys].every(Number.isFinite));
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const centerX = 195 + (index - 1.5) * spacing;
    assert.ok(right - left > size * .65 && bottom - top > size * .65, 'glyphs retain their intended visual size');
    assert.ok(left >= centerX - size * .6 && right <= centerX + size * .6, 'glyph stays in its own title cell');
    assert.ok(top >= y - size * .6 && bottom <= y + size * .6, 'glyph stays within the title height');
    assert.ok(Math.abs((left + right) / 2 - centerX) < size * .07, 'character center preserves title tracking');
    assert.ok(Math.abs((top + bottom) / 2 - y) < size * .07, 'character remains vertically centered');
  });
  assert.equal(record.depth(), 0, 'the title balances every save and restore');
  assert.deepEqual(record.state(), record.initial, 'title drawing preserves the caller transform and fill color');
}

test('title outlines render at startup and home sizes without any device font or optional Canvas API', () => {
  for (const [size, spacing] of [[36, 48], [39, 50]]) {
    for (const color of [undefined, '#456789']) {
      const record = outlineCanvas();
      drawTitle({ ctx: record.ctx }, 195, 76, size, spacing, color);
      assertTitleGeometry(record, 76, size, spacing, color);
    }
  }
});

function loadView(filename) {
  const file = path.join(__dirname, '../src', filename), actualRequire = createRequire(file);
  const module = { exports: {} };
  const factory = vm.runInThisContext('(function(require, module, exports) {\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file });
  factory(specifier => specifier === './scene' ? { drawVignette() {} } : specifier === './ambient-effects'
    ? { atmosphereTreatment: () => ({}), drawAmbientOverlay() {} } : specifier === './startup-journey'
      ? { drawStartupJourney() {} } : actualRequire(specifier), module, module.exports);
  return module.exports;
}

test('both real page views draw the four outlined title characters at their existing layout positions', () => {
  const { drawHome } = loadView('home-view.js');
  const { drawStartup } = loadView('startup-view.js');
  const game = {
    savedRun: () => null, completion: () => 0, nextLevel: () => CAMPAIGN[0],
    gameCircle: { available: false }, startup: { progress: .5 },
  };
  for (const height of [680, 844, 1000]) {
    for (const [draw, size, spacing, y] of [
      [drawHome, 39, 50, Math.max(0, (height - 844) / 2) + 76],
      [drawStartup, 36, 48, (height - Math.min(height, 840)) / 2 + 62],
    ]) {
      const record = outlineCanvas(), text = [];
      const renderer = {
        ctx: record.ctx, H: height, reducedMotion: true, line() {}, panel() {}, round() {}, label() {}, button() {},
        text(value) { text.push(value); },
      };
      draw(renderer, game, 1000);
      assertTitleGeometry(record, y, size, spacing);
      assert.ok(text.includes('风 起 · 信 至'), 'ordinary labels remain text');
      assert.equal(text.some(value => /^(风|笺|回|廊|风笺回廊)$/.test(value)), false, 'the page must not replace its outlined title with system text');
    }
  }
});
