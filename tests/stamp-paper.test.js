'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { drawStampArt } = require('../src/stamp-art');
const { drawStampPaper, clearStampPaperCache } = require('../src/stamp-paper');

const RECT = { x: 24, y: 100, w: 106, h: 144 };
const LIMIT = 4 * 1024 * 1024;

function canvas() {
  const surface = { width: 1, height: 1 }, calls = [], stack = [];
  const state = { canvas: surface, globalAlpha: 1, font: '12px sans-serif', lineJoin: 'round', lineCap: 'round' };
  const methods = {
    save() { stack.push({ ...state }); },
    restore() { Object.assign(state, stack.pop()); },
    measureText(value) { return { width: String(value).length * Number(state.font.match(/([\d.]+)px/)[1]) }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; }
  };
  const c = new Proxy(state, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      calls.push({ method: key, args, fill: state.fillStyle, stroke: state.strokeStyle, lineWidth: state.lineWidth });
      if (surface.failOn === key) throw new Error('unavailable ' + key);
      if (methods[key]) return methods[key](...args);
    };
  } });
  Object.assign(surface, { calls, getContext: () => c });
  return surface;
}

function harness() {
  const main = canvas(), surfaces = [], r = new Renderer(main);
  main.width = 780; main.height = 1688;
  Object.assign(r, { scale: 1, pixelRatio: 2, reducedMotion: true, effectsQuality: 'low', now: 1000,
    createSurface() { const surface = canvas(); surfaces.push(surface); return surface; } });
  return { r, main, surfaces };
}

const painted = calls => calls.filter(call => ['fill', 'stroke', 'clip', 'quadraticCurveTo', 'lineTo', 'moveTo', 'beginPath', 'closePath'].includes(call.method));
const paths = calls => calls.filter(call => call.method === 'quadraticCurveTo').length;

test('paper reuses a native-resolution transparent surface while preserving the shadow and clipped perforations', () => {
  const { r, main, surfaces } = harness();
  r.scale = .8; r.pixelRatio = 3;
  const rect = { ...RECT, w: 95.5, h: 131.25 };
  drawStampPaper(r, rect, true);
  assert.equal(surfaces.length, 1);
  const paper = surfaces[0], sx = rect.w / 106 * .8 * 3, sy = rect.h / 144 * .8 * 3;
  assert.equal(paper.width, Math.ceil(110 * sx));
  assert.equal(paper.height, Math.ceil(152 * sy));
  assert.deepEqual(paper.calls.find(call => call.method === 'setTransform').args, [sx, 0, 0, sy, 2 * sx, 2 * sy]);
  const blit = main.calls.find(call => call.method === 'drawImage').args;
  assert.deepEqual(blit.slice(1), [-2, -2, paper.width / sx, paper.height / sy]);
  assert.ok(blit[2] + blit[4] >= 150, 'four-pixel shadow and bottom padding are never cut off');
  assert.equal(paper.calls.some(call => call.method === 'fillRect'), false, 'no opaque rectangle fills the notch holes');
  const uncached = harness(); uncached.r.createSurface = null;
  drawStampPaper(uncached.r, rect, true);
  assert.deepEqual(painted(paper.calls), painted(uncached.main.calls), 'cache uses the exact original outline, shadow and clipped edge strokes');
  const paperCommands = paper.calls.length;
  main.calls.length = 0;
  for (let i = 0; i < 12; i++) drawStampPaper(r, { ...rect, x: i * 110, y: i * 10 }, true);
  assert.equal(surfaces.length, 1, 'position and stamp identity do not duplicate a shared paper face');
  assert.equal(paper.calls.length, paperCommands, 'a warm frame does not repaint any paper');
  assert.equal(main.calls.length, 12, 'each cached paper takes one drawImage call');
});

test('paper keys track ownership, next and held styles plus size, renderer scale and display density', () => {
  const { r, main, surfaces } = harness();
  for (const flags of [[false, false, false], [true, false, false], [false, true, false], [false, false, true], [true, false, true], [false, true, true]]) {
    drawStampPaper(r, RECT, ...flags);
    const reference = harness(); reference.r.createSurface = null;
    drawStampPaper(reference.r, RECT, ...flags);
    assert.deepEqual(painted(surfaces.at(-1).calls), painted(reference.main.calls));
  }
  assert.equal(surfaces.length, 6);
  drawStampPaper(r, RECT, false, false, false);
  assert.equal(surfaces.length, 6, 'a style change can return to its original cached face');
  for (const update of [() => { r.pixelRatio = 3; }, () => { r.scale = .75; }]) {
    update(); drawStampPaper(r, RECT, false);
    assert.equal(main.calls.at(-1).args[0], surfaces.at(-1), 'resolution change gets a newly rasterized face');
  }
  const count = surfaces.length;
  drawStampPaper(r, { ...RECT, w: 160 }, false);
  drawStampPaper(r, { ...RECT, h: 200 }, false);
  assert.equal(surfaces.length, count + 2, 'width and height changes cannot reuse a differently scaled face');
  r.ctx.lineJoin = 'bevel';
  drawStampPaper(r, { ...RECT, h: 200 }, false);
  assert.equal(surfaces.length, count + 3, 'an inherited stroke style change cannot reuse incompatible edge pixels');
});

test('least recently used paper is released at six entries and total live bitmap storage stays under four MiB', () => {
  const { r, surfaces } = harness();
  r.pixelRatio = 1;
  const rects = Array.from({ length: 7 }, (_, i) => ({ ...RECT, w: 100 + i }));
  for (const rect of rects.slice(0, 6)) drawStampPaper(r, rect, true);
  const first = surfaces[0], oldest = surfaces[1];
  drawStampPaper(r, rects[0], true);
  drawStampPaper(r, rects[6], true);
  assert.equal(r.stampPaperCache.entries.size, 6);
  assert.ok(first.width > 1, 'a recently reused paper remains live');
  assert.deepEqual([oldest.width, oldest.height], [1, 1], 'the least recently used bitmap is released');
  for (let i = 0; i < 12; i++) {
    drawStampPaper(r, { ...RECT, w: 620 + i, h: 900 }, !!(i % 2));
    const live = [...r.stampPaperCache.entries.values()];
    assert.ok(live.length <= 6);
    assert.equal(r.stampPaperCache.bytes, live.reduce((sum, entry) => sum + entry.surface.width * entry.surface.height * 4, 0));
    assert.ok(r.stampPaperCache.bytes <= LIMIT);
    assert.ok(surfaces.filter(surface => surface.width > 1).reduce((sum, surface) => sum + surface.width * surface.height * 4, 0) <= LIMIT);
  }
  const allocated = surfaces.length, entries = r.stampPaperCache.entries.size;
  drawStampPaper(r, { ...RECT, w: 2000, h: 2000 }, true);
  assert.equal(surfaces.length, allocated, 'an oversized paper uses vectors before allocating a bitmap');
  assert.equal(r.stampPaperCache.entries.size, entries, 'oversized requests do not evict reusable small papers');
});

test('clearing paper cache releases all bitmaps and the next draw rebuilds cleanly', () => {
  const { r, surfaces } = harness();
  drawStampPaper(r, RECT, true); drawStampPaper(r, RECT, false, true);
  clearStampPaperCache(r);
  assert.equal(r.stampPaperCache, null);
  assert.ok(surfaces.every(surface => surface.width === 1 && surface.height === 1));
  clearStampPaperCache(r);
  drawStampPaper(r, RECT, true);
  assert.equal(surfaces.length, 3);
  assert.equal(r.stampPaperCache.entries.size, 1);
});

test('missing, rejected and failed surfaces fall back once without touching the main canvas or retaining bad entries', () => {
  for (const factory of [null, () => null, () => ({ getContext: () => null }),
    () => ({ getContext: () => { throw new Error('context unavailable'); } }), () => { throw new Error('unsupported'); }, r => () => r.canvas,
    r => () => ({ getContext: () => r.ctx, set width(_) { assert.fail('main context alias resized'); } })]) {
    const { r, main } = harness();
    const create = typeof factory === 'function' && factory.length ? factory(r) : factory;
    let attempts = 0;
    r.createSurface = create ? () => { attempts++; return create(); } : null;
    for (let i = 0; i < 12; i++) drawStampPaper(r, RECT, true);
    assert.equal(attempts, create ? 1 : 0, 'an unsupported API is never retried for every stamp or frame');
    assert.ok(paths(main.calls) > 150, 'unavailable caching retains every perforation');
    assert.deepEqual([main.width, main.height], [780, 1688]);
    assert.equal(r.stampPaperCache?.entries.size || 0, 0);
  }
  const { r, main, surfaces } = harness();
  const create = r.createSurface;
  r.createSurface = () => { const surface = create(); surface.failOn = 'stroke'; return surface; };
  drawStampPaper(r, RECT, true);
  assert.equal(r.stampPaperCache.entries.size, 0, 'a partial raster is never remembered');
  assert.deepEqual([surfaces[0].width, surfaces[0].height], [1, 1]);
  assert.ok(paths(main.calls) > 150);
  r.createSurface = create;
  main.calls.length = 0;
  drawStampPaper(r, RECT, true);
  assert.equal(surfaces.length, 1, 'a raster failure stays disabled until caches are explicitly cleared');
  clearStampPaperCache(r); main.calls.length = 0;
  drawStampPaper(r, RECT, true);
  assert.equal(main.calls[0].method, 'drawImage', 'clearing permits a later successful surface');
  main.failOn = 'drawImage'; main.calls.length = 0;
  drawStampPaper(r, RECT, true);
  assert.equal(r.stampPaperCache.entries.size, 0, 'a failed bitmap upload is removed');
  assert.ok(paths(main.calls) > 150, 'drawImage failure also retains a complete vector paper');
  const attempts = surfaces.length;
  for (let i = 0; i < 12; i++) drawStampPaper(r, RECT, true);
  assert.equal(surfaces.length, attempts, 'a rejected drawImage source never causes repeated bitmap allocation');
  assert.equal(main.calls.filter(call => call.method === 'drawImage').length, 1);
});

test('a factory that returns an already cached canvas safely disables further allocation attempts', () => {
  const { r, surfaces } = harness();
  drawStampPaper(r, RECT, true);
  let attempts = 0;
  r.createSurface = () => { attempts++; return surfaces[0]; };
  for (let i = 0; i < 12; i++) drawStampPaper(r, RECT, false);
  assert.equal(attempts, 1);
  assert.equal(r.stampPaperCache.disabled, true);
  assert.deepEqual([surfaces[0].width, surfaces[0].height], [1, 1]);
});

test('a twelve-stamp warm frame cuts canvas commands while illustrations, text and moving foil remain live', () => {
  const vector = harness(), cached = harness(); vector.r.createSurface = null;
  for (const h of [vector, cached]) Object.assign(h.r, { reducedMotion: false, effectsQuality: 'high', ambientNow: 300 });
  const stamps = Array.from({ length: 12 }, (_, index) => ({ index, owned: true, icon: 'leaf', name: '邮票' + index, target: index + 1 }));
  const draw = h => stamps.forEach((stamp, index) => drawStampArt(h.r, stamp, { ...RECT, x: index * 112 }));
  draw(cached); cached.main.calls.length = 0;
  draw(vector); draw(cached);
  assert.ok(cached.main.calls.length < vector.main.calls.length * .5, 'paper caching removes more than half of stamp Canvas commands');
  assert.equal(cached.main.calls.filter(call => call.method === 'drawImage').length, 12);
  const texts = h => h.main.calls.filter(call => call.method === 'fillText').map(call => call.args);
  assert.deepEqual(texts(cached), texts(vector), 'all names, counters and labels draw as before');
  const arcs = h => h.main.calls.filter(call => call.method === 'arc').map(call => call.args);
  assert.deepEqual(arcs(cached), arcs(vector), 'medallions and their animations remain outside the paper cache');
  const before = cached.main.calls.filter(call => call.method === 'lineTo').map(call => call.args);
  cached.main.calls.length = 0; cached.r.ambientNow = 500; draw(cached);
  const after = cached.main.calls.filter(call => call.method === 'lineTo').map(call => call.args);
  assert.notDeepEqual(after, before, 'the foil continues moving between frames');
  assert.equal(cached.surfaces.length, 1, 'animation time never invalidates the static paper');
});
