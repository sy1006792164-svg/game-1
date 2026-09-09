'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { C } = require('../src/theme');

// Record the actual canvas-space bounds after the renderer applies DPR and safe-area transforms.
function canvasRecorder() {
  const rectangles = [], paths = [], stack = [];
  let transform = { sx: 1, sy: 1, x: 0, y: 0 }, points = [];
  const properties = { globalAlpha: 1, font: '', fillStyle: '' };
  const point = (x, y) => [transform.x + x * transform.sx, transform.y + y * transform.sy];
  const methods = {
    setTransform(sx, b, c, sy, x, y) { transform = { sx, sy, x, y }; },
    translate(x, y) { transform.x += x * transform.sx; transform.y += y * transform.sy; },
    scale(x, y) { transform.sx *= x; transform.sy *= y; },
    save() { stack.push({ properties: { ...properties }, transform: { ...transform } }); },
    restore() { const saved = stack.pop(); Object.assign(properties, saved.properties); transform = saved.transform; },
    fillRect(x, y, w, h) {
      const [left, top] = point(x, y);
      rectangles.push({ x: left, y: top, w: w * transform.sx, h: h * transform.sy,
        style: properties.fillStyle, alpha: properties.globalAlpha });
    },
    createLinearGradient(x0, y0, x1, y1) {
      return { start: point(x0, y0), end: point(x1, y1), stops: [], addColorStop(at, color) { this.stops.push([at, color]); } };
    },
    measureText(text) { return { width: String(text).length * 8 }; },
    beginPath() { points = []; },
    moveTo(x, y) { points.push(point(x, y)); },
    lineTo(x, y) { points.push(point(x, y)); },
    bezierCurveTo(...args) { for (let i = 0; i < args.length; i += 2) points.push(point(args[i], args[i + 1])); },
    fill() { paths.push({ style: properties.fillStyle, points: points.slice() }); }
  };
  const ctx = new Proxy(properties, { get(target, key) { return key in target ? target[key] : methods[key] || (() => {}); } });
  return { canvas: { getContext: () => ctx }, rectangles, paths };
}

function draw(metrics, page, modal) {
  const record = canvasRecorder(), renderer = new Renderer(record.canvas);
  // Content layouts have their own integration coverage; keep a known hit target to
  // verify that extending the backdrop cannot change page or pointer coordinates.
  const content = () => renderer.hit(24, 12, 44, 44, () => {});
  renderer.home = content; renderer.game = content; renderer.levels = content; renderer.collection = content;
  const game = {
    page, modal, development: true, store: { getStatus: () => ({ persisted: true }) },
    rankingAuthorization: { getState: () => ({ enabled: false, status: 'unavailable' }), updateButton() {} }
  };
  renderer.draw(game, 1000, metrics);
  return { ...record, renderer };
}

function coversCanvas(rect, metrics) {
  const ratio = metrics.pixelRatio;
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} must equal ${expected}`);
  close(rect.x, 0); close(rect.y, 0);
  close(rect.w, metrics.width * ratio); close(rect.h, metrics.height * ratio);
}

const screens = [
  { width: 390, height: 844, pixelRatio: 3, safeTop: 88, safeBottom: 34 },
  { width: 320, height: 568, pixelRatio: 2, safeTop: 70, safeBottom: 20 },
  { width: 768, height: 1024, pixelRatio: 2, safeTop: 70, safeBottom: 20 },
  { width: 390, height: 844, pixelRatio: 1, safeTop: 0, safeBottom: 0 }
];

test('all page skies and paper washes cover the notch, home indicator and side gutters', () => {
  for (const metrics of screens) for (const page of ['home', 'game', 'levels', 'collection', 'leaderboard']) {
    const { rectangles } = draw(metrics, page);
    const sky = rectangles.find(rect => typeof rect.style === 'object' && rect.style.stops);
    assert.ok(sky, `${page} draws a sky gradient`);
    coversCanvas(sky, metrics);
    const wash = rectangles.find(rect => rect.style === C.paper && rect.alpha < 1);
    assert.ok(wash, `${page} draws its paper wash`);
    coversCanvas(wash, metrics);
    assert.equal(wash.alpha, page === 'game' ? .08 : page === 'home' ? .02 : .87);
    // The same gradient spans either side of each safe-area boundary. Its end
    // colors extend into the reserved area instead of exposing a separate fill.
    assert.equal(sky.style.start[1], metrics.safeTop * metrics.pixelRatio);
    assert.ok(Math.abs(sky.style.end[1] - (metrics.height - metrics.safeBottom) * metrics.pixelRatio) < 1e-7);
  }
});

test('the landscape reaches wide-screen edges without a seam at the content column', () => {
  const metrics = screens[2], { paths } = draw(metrics, 'home');
  for (const color of ['#d0dfd1', '#c1d6c5']) {
    const ridge = paths.find(path => path.style === color);
    assert.ok(ridge);
    assert.equal(Math.min(...ridge.points.map(point => point[0])), 0);
    assert.ok(Math.abs(Math.max(...ridge.points.map(point => point[0])) - metrics.width * metrics.pixelRatio) < 1e-7);
  }
});

test('modal dimming also covers the entire canvas on compact and wide screens', () => {
  const modals = [
    { kind: 'help', title: '投递指引', lines: ['慢慢走，信会送到。'], buttons: [] },
    { kind: 'developer-level', digits: '' }
  ];
  for (const metrics of screens) for (const modal of modals) {
    const { rectangles } = draw(metrics, 'home', modal);
    const scrim = rectangles.find(rect => rect.style === (modal.kind === 'help' ? '#36554979' : '#294d498f'));
    assert.ok(scrim);
    coversCanvas(scrim, metrics);
  }
});

test('full canvas painting preserves content height, safe-area placement and touch conversion', () => {
  for (const metrics of screens) {
    const { renderer } = draw(metrics, 'home');
    const available = metrics.height - metrics.safeTop - metrics.safeBottom;
    const scale = Math.min(metrics.width / 390, available / 700);
    assert.equal(renderer.H, available / scale);
    assert.equal(renderer.oy, metrics.safeTop);
    assert.equal(renderer.ox, (metrics.width - 390 * scale) / 2);
    const hit = renderer.hits[0];
    const pointer = renderer.toLogical(renderer.ox + (hit.x + hit.w / 2) * scale,
      renderer.oy + (hit.y + hit.h / 2) * scale);
    assert.ok(Math.abs(pointer.x - (hit.x + hit.w / 2)) < 1e-7);
    assert.ok(Math.abs(pointer.y - (hit.y + hit.h / 2)) < 1e-7);
  }
});
