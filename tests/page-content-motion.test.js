'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { drawStampArt } = require('../src/stamp-art');
const { drawLeaderboard } = require('../src/leaderboard-view');
const { collectionLayout, locateNextStamp } = require('../src/collection-view');
const { getAlbum } = require('../src/stamp-album');
const { drawScrollEdges, drawProgressGlint } = require('../src/page-feedback');

function recorder(options = {}) {
  const commands = [], stack = [];
  const state = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1 };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'save') return () => stack.push({ ...state });
      if (key === 'restore') return () => Object.assign(state, stack.pop());
      if (key === 'measureText') return text => ({ width: String(text).length * 7 });
      return (...args) => commands.push({ key, args, alpha: state.globalAlpha, color: key === 'stroke' ? state.strokeStyle : state.fillStyle });
    }
  });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { now: 500, ambientNow: 500, effectsQuality: 'high', reducedMotion: false, ...options });
  return { r, commands, state, depth: () => stack.length };
}

test('owned stamp foil stays in the medallion, pauses with decorative time and is silent during scrolling', () => {
  const album = getAlbum({ completed: { 1: { stars: 3, bestTurns: 7 } } });
  const owned = album.stamps.find(stamp => stamp.owned);
  assert.ok(owned);
  const frame = (options = {}, artOptions = {}) => {
    const record = recorder(options);
    drawStampArt(record.r, owned, { x: 24, y: 308, w: 106, h: 144 }, artOptions);
    assert.equal(record.depth(), 0, 'foil clipping and opacity restore all canvas state');
    assert.equal(record.state.globalAlpha, 1);
    return record.commands;
  };
  const first = frame();
  assert.deepEqual(first, frame({ now: 60000 }), 'wall time cannot fast-forward artwork while the decorative clock is paused');
  assert.notDeepEqual(first, frame({ ambientNow: 4200 }), 'owned medallions have a visible foil pass at normal quality');
  const still = frame({ reducedMotion: true });
  assert.deepEqual(still, frame({ effectsQuality: 'low', ambientNow: 9000 }));
  assert.deepEqual(still, frame({}, { scrolling: true }), 'list movement never adds moving foil on top');
  const foil = first.filter(command => command.key === 'stroke' && command.color === '#fffad9');
  assert.equal(foil.length, 1);
  const foilPosition = first.findIndex(command => command === foil[0]);
  assert.ok(first.slice(0, foilPosition).some(command => command.key === 'arc' && command.args[2] === 26));
  assert.ok(first.slice(0, foilPosition).some(command => command.key === 'clip'));
});

test('list continuation arrows stay in the card gutters and show only available scroll directions', () => {
  for (const height of [680, 780, 1000]) {
    const { viewport, maxScroll } = collectionLayout(height);
    const draw = (offset, options = {}) => {
      const lines = [], r = { ...options, now: 500, line: (...args) => lines.push(args) };
      drawScrollEdges(r, viewport, { offset, max: maxScroll, velocity: 0, touching: false, wheelTarget: null });
      return lines;
    };
    assert.equal(draw(0).length, 1);
    assert.equal(draw(maxScroll).length, 1);
    const middle = draw(maxScroll / 2);
    assert.equal(middle.length, 2);
    for (const [points] of middle) for (const [x, y] of points) {
      assert.ok(x > 366 && x < 377, 'arrows never cover the right-hand stamp or scroll thumb');
      assert.ok(y >= viewport.y && y <= viewport.y + viewport.h);
    }
    assert.deepEqual(draw(0, { reducedMotion: true }), draw(0, { effectsQuality: 'low', ambientNow: 9000 }));
  }
  const r = { line: () => assert.fail('an unscrollable list has no continuation arrow') };
  drawScrollEdges(r, { x: 18, y: 205, w: 354, h: 400 }, { max: 0 });
});

test('progress highlights do not invent progress or travel beyond the real filled section', () => {
  const calls = [], r = { now: 600, round: (...args) => calls.push(args) };
  drawProgressGlint(r, 10, 20, 200, 0, 50);
  assert.equal(calls.length, 0);
  drawProgressGlint(r, 10, 20, 200, 10, 50);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0] >= 10 && calls[0][0] + calls[0][2] <= 50);
  for (const options of [{ reducedMotion: true }, { effectsQuality: 'low' }]) {
    drawProgressGlint({ ...r, ...options }, 10, 20, 200, 10, 50);
  }
  assert.equal(calls.length, 1);
});

test('loading shimmer changes only paint and never starts a friend request or draws unfinished data', () => {
  const paint = options => {
    const calls = [], r = { H: 700, now: 500, ...options, ctx: {},
      ...Object.fromEntries(['header', 'round', 'circle', 'text', 'label', 'panel'].map(key => [key, (...args) => calls.push([key, ...args])])) };
    const game = {
      rankingAuthorization: { getState: () => ({ status: 'loading', enabled: false }) },
      friendLeaderboard: { getState: () => ({ status: 'loading' }), draw() { assert.fail('unfinished friend data cannot draw'); } }
    };
    drawLeaderboard(r, game);
    return calls.map(call => call.map(value => typeof value === 'function' ? '[action]' : value));
  };
  assert.notDeepEqual(paint({ ambientNow: 500 }), paint({ ambientNow: 1400 }));
  assert.deepEqual(paint({ ambientNow: 500 }), paint({ now: 60000, ambientNow: 500 }));
  assert.deepEqual(paint({ reducedMotion: true }), paint({ effectsQuality: 'low', now: 60000 }));
});

test('locating a distant next stamp preserves progress and lands its full row inside the visible album', () => {
  const completed = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, { stars: 3, bestTurns: 10 }]));
  const album = getAlbum({ completed }), initial = JSON.stringify(completed);
  const scroll = { reset(at) { this.enteredAt = at; this.offset = 0; }, setBounds(max) { this.max = max; } };
  const game = { page: 'collection', collectionFilter: 'owned', collectionScroll: scroll,
    renderer: { H: 700, pageNow: 3000 }, album: () => album, platform: { now: () => 3000 } };
  assert.equal(locateNextStamp(game), true);
  assert.equal(game.collectionFilter, 'all');
  const index = album.stamps.findIndex(stamp => stamp.id === album.next.id);
  const layout = collectionLayout(700, album.stamps.length), y = layout.viewport.y + 6 + Math.floor(index / 3) * 160 - scroll.offset;
  assert.ok(y >= layout.viewport.y && y + 144 <= layout.viewport.y + layout.viewport.h);
  assert.equal(JSON.stringify(completed), initial);
  assert.equal(game.page, 'collection');
});
