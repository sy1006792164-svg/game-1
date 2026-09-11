'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawDistantAtmosphere, drawAmbientOverlay } = require('../src/ambient-effects');
const { drawHomeDelivery, drawPageAtmosphere } = require('../src/page-atmosphere');
const { CHAPTER_MOODS } = require('../src/chapter-atmosphere');

function recorder(alpha = 1) {
  const events = [], stack = [], state = { globalAlpha: alpha, fillStyle: '', strokeStyle: '' };
  let path = [];
  const methods = {
    save() { stack.push({ ...state }); },
    restore() { Object.assign(state, stack.pop()); },
    beginPath() { path = []; },
    ellipse(...args) { path.push(args); },
    fill() { events.push({ kind: 'fill', alpha: state.globalAlpha, color: state.fillStyle, path }); }
  };
  const ctx = new Proxy(state, { get(target, key) { return key in target ? target[key] : methods[key] || (() => {}); } });
  const r = { ctx, scale: 1 };
  for (const kind of ['icon', 'circle', 'line']) r[kind] = (...args) => events.push({ kind, args, alpha: state.globalAlpha });
  return { r, events, state };
}

test('the home delivery fades fully before entering or leaving its repeating story beat', () => {
  const duration = 11800, active = duration * .38;
  for (let cycle = 1; cycle <= 3; cycle++) {
    const start = cycle * duration - 1700;
    for (const time of [start - 1, start, start + 1, start + active - 1, start + active, start + active + 1]) {
      const { r, events } = recorder();
      drawHomeDelivery(r, time, CHAPTER_MOODS[0]);
      const letter = events.find(event => event.kind === 'icon');
      assert.ok(!letter || letter.alpha < .00001, `the letter remains invisible around loop boundary ${time}`);
    }
  }
});

test('the home delivery inherits vignette opacity and restores the canvas state', () => {
  for (const alpha of [0, .2, .5, 1]) {
    const { r, events, state } = recorder(alpha);
    drawHomeDelivery(r, 11800 - 1700 + 11800 * .19, CHAPTER_MOODS[0], .7);
    assert.ok(events.every(event => event.alpha <= alpha * .7 + 1e-9), 'decorative mail cannot brighten a faded parent');
    assert.equal(state.globalAlpha, alpha);
  }
});

test('each drifting mist band fades out at its horizontal wrap on compact and wide screens', () => {
  const fract = value => value - Math.floor(value);
  for (const width of [320, 390, 768]) for (let band = 0; band < 3; band++) {
    const offset = fract(Math.sin((band + 1) * 91.73 + 2 * 47.11) * 43758.5453);
    const boundary = (1 - offset) * (15000 + band * 2400);
    for (const time of [boundary - 1, boundary, boundary + 1]) {
      const { r, events, state } = recorder(.6);
      drawDistantAtmosphere(r, time, { x: 0, y: 0, w: width, h: 650 }, {
        mood: CHAPTER_MOODS[0], treatment: { depth: 1, mist: 1, motes: 0 }
      });
      const layers = events.filter(event => event.kind === 'fill').slice(band * 3, band * 3 + 3);
      assert.equal(layers.length, 3);
      assert.ok(layers.every(layer => layer.alpha < .00001), `mist band ${band} disappears before wrapping at ${time}`);
      assert.equal(state.globalAlpha, .6);
    }
  }
});

test('all ambient pages stay still under reduced motion or low effects quality across chapter palettes', () => {
  const rect = { x: 0, y: 0, w: 390, h: 650 };
  for (const mood of CHAPTER_MOODS) for (const quiet of [{ reducedMotion: true }, { quality: 'low' }]) {
    for (const page of ['startup', 'home', 'levels', 'game', 'publication', 'collection', 'leaderboard']) {
      const frames = [1000, 20000].map(time => {
        const { r, events } = recorder();
        drawDistantAtmosphere(r, time, rect, { page, mood, ...quiet });
        drawAmbientOverlay(r, time, page, rect, { mood, ...quiet });
        return events;
      });
      assert.deepEqual(frames[0], frames[1], `${page} remains still for ${mood.id}`);
    }
    for (const page of ['levels', 'publication', 'collection', 'leaderboard']) {
      const frames = [1000, 20000].map(time => {
        const { r, events } = recorder();
        drawPageAtmosphere(r, time, page, rect, { mood, ...quiet });
        return events;
      });
      assert.deepEqual(frames[0], frames[1], `${page} motif respects the motion setting directly`);
    }
  }
});
