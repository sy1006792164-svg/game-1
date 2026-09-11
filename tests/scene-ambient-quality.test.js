'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { drawBoard, drawBackdrop, drawVignette } = require('../src/scene');
const { drawHomeArchitecture } = require('../src/world-art');
const { createState, step } = require('../src/engine');
const { SceneCamera } = require('../src/camera');
const { CAMPAIGN } = require('../src/levels');
const { drawStampArt } = require('../src/stamp-art');
const { getAlbum } = require('../src/stamp-album');

// Compare submitted geometry and opacity, independently of rasterization. Courier
// poses are recorded separately so idle scenery cannot hide disabled move feedback.
function recorder(options = {}) {
  const commands = [], poses = [], stack = [];
  const state = { globalAlpha: options.alpha == null ? 1 : options.alpha, fillStyle: '', strokeStyle: '', font: '12px sans-serif' };
  const methods = {
    save() { stack.push({ ...state }); },
    restore() {
      const saved = stack.pop();
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, saved);
    },
    measureText(text) { return { width: String(text).length * 8 }; },
    createLinearGradient(...args) {
      const gradient = { args, stops: [] };
      Object.defineProperty(gradient, 'addColorStop', { value(at, color) { this.stops.push([at, color]); } });
      return gradient;
    }
  };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in methods) return methods[key];
      return (...args) => commands.push([key, args, state.globalAlpha,
        key === 'fill' || key === 'fillRect' ? state.fillStyle : key === 'stroke' ? state.strokeStyle : null]);
    }
  });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { reducedMotion: false, effectsQuality: 'high', ...options });
  r.courier = (...args) => poses.push(args);
  return { r, commands, poses };
}

function boardFrame(now, options = {}, ready = false, moving = false) {
  const record = recorder(options), level = moving ? CAMPAIGN[0] : CAMPAIGN[18];
  const previous = createState(level), state = moving ? step(level, previous, 'right').state : previous;
  if (ready) { state.letters = []; state.seals = []; }
  const game = { level, state, camera: new SceneCamera(), transitionAt: moving ? 1000 : -Infinity,
    platform: { now: () => now }, previousState: moving ? previous : null };
  record.r.ambientNow = now;
  drawBoard(record.r, game, now, { x: 0, y: 158, w: 390, h: 420 }, null);
  return record;
}

test('the next-stamp orbit shares paused decorative time and disappears in low quality', () => {
  const stamp = getAlbum({ completed: {} }).next;
  const frame = options => {
    const record = recorder(options);
    drawStampArt(record.r, stamp, { x: 24, y: 24, w: 106, h: 144 }, { next: true });
    return record.commands;
  };
  assert.deepEqual(frame({ now: 1000, ambientNow: 1000 }), frame({ now: 60000, ambientNow: 1000 }));
  const quiet = frame({ now: 1000, reducedMotion: true });
  assert.deepEqual(quiet, frame({ now: 60000, effectsQuality: 'low' }));
  assert.ok(quiet.length < frame({ now: 1000, ambientNow: 1000 }).length);
});

test('low quality and reduced motion freeze all board scenery, including ready-office decoration', () => {
  for (const options of [{ effectsQuality: 'low' }, { reducedMotion: true }]) {
    for (const ready of [false, true]) {
      const first = boardFrame(1000, options, ready), later = boardFrame(9000, options, ready);
      assert.deepEqual(first.commands, later.commands);
      assert.deepEqual(first.r.boardProjection.point(19), later.r.boardProjection.point(19));
    }
  }
  assert.notDeepEqual(boardFrame(1000).commands, boardFrame(9000).commands,
    'normal quality retains the moving scenery');
});

test('low quality keeps player movement and its arrival coordinates', () => {
  const early = boardFrame(1040, { effectsQuality: 'low' }, false, true);
  const late = boardFrame(1120, { effectsQuality: 'low' }, false, true);
  const arrived = boardFrame(1200, { effectsQuality: 'low' }, false, true);
  const player = record => record.poses.find(pose => pose[3] === false);
  assert.equal(player(early)[4].moving, true);
  assert.equal(player(late)[4].moving, true);
  assert.notEqual(player(early)[0], player(late)[0]);
  assert.equal(player(arrived)[4].moving, false);
  assert.equal(player(arrived)[0], arrived.r.boardProjection.point(CAMPAIGN[0].start + 1)[0]);
});

test('home architecture and vignettes respect both renderer and explicit quiet settings', () => {
  const rect = { x: 5, y: 142, w: 380, h: 360 };
  for (const draw of [
    (r, now, options) => drawHomeArchitecture(r, now, options),
    (r, now, options) => drawVignette(r, now, rect, { deliveryStory: true, ...options }),
    (r, now, options) => drawBackdrop(r, now, 0, { page: 'home', ...options })
  ]) {
    for (const [rendererOptions, explicitOptions] of [
      [{ reducedMotion: true }, {}], [{ effectsQuality: 'low' }, {}],
      [{}, { reducedMotion: true }], [{}, { quality: 'low' }]
    ]) {
      const first = recorder(rendererOptions), later = recorder(rendererOptions);
      draw(first.r, 1000, explicitOptions); draw(later.r, 9000, explicitOptions);
      assert.deepEqual(first.commands, later.commands);
      assert.deepEqual(first.poses, later.poses);
    }
  }
});

test('decorative glows inherit parent opacity and use one fill at low quality', () => {
  const glows = options => {
    const { r, commands } = recorder({ alpha: .25, ...options });
    drawBoard(r, { level: CAMPAIGN[0], state: createState(CAMPAIGN[0]),
      camera: new SceneCamera(), transitionAt: -Infinity, platform: { now: () => 1000 } },
    1000, { x: 0, y: 158, w: 390, h: 420 });
    return commands.filter(command => command[0] === 'fill' && command[3] === '#f9f3d3');
  };
  const high = glows({}), low = glows({ effectsQuality: 'low' });
  assert.equal(high.length, 3);
  assert.equal(low.length, 1);
  assert.equal(high[high.length - 1][2], .25 * .026);
  assert.equal(low[0][2], .25 * .026);
});

test('low quality home architecture keeps every courtyard tile with fewer paint calls', () => {
  const high = recorder(), low = recorder({ effectsQuality: 'low' });
  drawHomeArchitecture(high.r, 1000); drawHomeArchitecture(low.r, 1000);
  const paints = commands => commands.filter(command => command[0] === 'fill' || command[0] === 'stroke');
  assert.ok(paints(low.commands).length < paints(high.commands).length * .9);
  for (const color of ['#f4efd9', '#edead3']) {
    const count = commands => commands.filter(command => command[0] === 'fill' && command[3] === color).length;
    assert.equal(count(low.commands), 8);
    assert.equal(count(high.commands), count(low.commands));
  }
});
