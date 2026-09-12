'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { actorFrame, MOVE_MS } = require('../src/motion');
const { drawCourier } = require('../src/courier-art');
const { drawEmblemLight, drawStampFinish } = require('../src/keepsake-effects');
const { drawModal } = require('../src/modal-view');
const { drawStampDetail } = require('../src/stamp-detail-view');
const { getAlbum } = require('../src/stamp-album');

function recorder(options = {}) {
  const paints = [], stack = [], texts = [];
  let path = [], transform = [], clip = null;
  const state = { globalAlpha: .7, fillStyle: '#parent', strokeStyle: '#parent', lineWidth: 3, font: '12px sans-serif' };
  const copy = value => JSON.parse(JSON.stringify(value));
  const paint = kind => paints.push({ kind, path: copy(path), transform: copy(transform), clip: copy(clip),
    color: state[kind === 'fill' ? 'fillStyle' : 'strokeStyle'], alpha: state.globalAlpha });
  const methods = {
    save() { stack.push({ state: { ...state }, transform: copy(transform), clip: copy(clip) }); },
    restore() {
      const saved = stack.pop(); assert.ok(saved, 'balanced Canvas state');
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, saved.state); transform = saved.transform; clip = saved.clip;
    },
    beginPath() { path = []; }, fill() { paint('fill'); }, stroke() { paint('stroke'); },
    clip() { clip = copy(path); }, setLineDash() {},
    translate(...args) { transform.push(['translate', ...args]); },
    rotate(...args) { transform.push(['rotate', ...args]); },
    scale(...args) { transform.push(['scale', ...args]); },
    measureText(text) {
      const size = Number(state.font.match(/([\d.]+)px/)[1]);
      return { width: [...String(text)].reduce((sum, char) => sum + size * (char.charCodeAt(0) > 255 ? 1 : .56), 0) };
    },
    fillText(value, x, y) { texts.push({ value, x, y, transform: copy(transform) }); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; }
  };
  const ctx = new Proxy(state, { get(target, key) {
    return key in target ? target[key] : key in methods ? methods[key] : (...args) => path.push([key, ...args]);
  } });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { H: 680, modalAt: 1000, now: 1000, ambientNow: 1000,
    viewport: { x: 0, y: 0, w: 390, h: 680 }, reducedMotion: false, effectsQuality: 'high' }, options);
  return { r, paints, texts, stack, state };
}

const points = [[60, 80], [90, 95], [60, 110]];
const point = cell => points[cell];
const moving = { transitionAt: 1000, previousState: { player: 0, echo: 0 },
  state: { player: 2, echo: 2 }, motionPath: [0, 1, 2] };

test('expressive courier poses retain the exact wind path and original arrival time', () => {
  for (const age of [0, 20, 45, 90, 125, 160, 180, 200, 245, 320, 10000]) {
    const progress = Math.min(1, age / MOVE_MS), eased = progress * progress * (3 - 2 * progress);
    const leg = eased < .5 ? 0 : 1, fraction = eased * 2 - leg;
    const expected = points[leg].map((value, axis) => value + (points[leg + 1][axis] - value) * fraction);
    const pose = actorFrame(moving, 1000 + age, point);
    assert.deepEqual([pose.x, pose.y], expected);
    assert.equal(pose.moving, age < MOVE_MS);
    assert.ok(pose.stretch > .9 && pose.stretch < 1.1 && pose.squash > .94 && pose.squash < 1.1);
  }
  assert.ok(actorFrame(moving, 1090, point).stretch > 1, 'takeoff extends the body');
  assert.ok(actorFrame(moving, 1225, point).stretch < 1, 'landing compresses the body after the position settles');
  assert.equal(actorFrame(moving, 1320, point).stretch, 1, 'landing ends without a timer');
  const wait = { ...moving, previousState: moving.state, motionPath: [2] };
  assert.equal(actorFrame(wait, 1225, point).stretch, 1, 'waiting never invents a landing');
});

test('reduced motion is still and low quality removes extra deformation without skipping travel', () => {
  for (const ghost of [false, true]) {
    assert.deepEqual(actorFrame(moving, 1040, point, ghost, { reducedMotion: true }),
      actorFrame(moving, 90000, point, ghost, { reducedMotion: true }));
    const low = actorFrame(moving, 1090, point, ghost, { quality: 'low' });
    assert.equal(low.moving, true);
    assert.deepEqual([low.lean, low.stretch, low.squash, low.cloak], [0, 1, 1, 0]);
    const first = actorFrame(moving, 10000, point, ghost, { ambientNow: 8000 });
    const paused = actorFrame(moving, 90000, point, ghost, { ambientNow: 8000 });
    assert.deepEqual(first, paused, 'the ambient clock controls idle breathing and echo sway');
  }
});

test('courier deformation affects the body while its ground shadow and parent Canvas state stay fixed', () => {
  for (const ghost of [false, true]) {
    const record = recorder(), initial = { ...record.state };
    drawCourier(record.r, 120, 160, 40, ghost, { alpha: .6, lift: 4, lean: .08, stretch: 1.07, squash: .96, cloak: 1.7 });
    const shadow = record.paints[0];
    assert.equal(shadow.path[0][0], 'ellipse');
    assert.equal(shadow.path[0][2], (ghost ? 12 : 18) + 4);
    assert.equal(shadow.transform.some(item => item[0] === 'rotate'), false);
    assert.ok(record.paints.slice(1).some(paint => paint.transform.some(item => item[0] === 'rotate' && item[1] === .08)));
    assert.equal(record.stack.length, 0); assert.deepEqual(record.state, initial);
    assert.equal(record.r.hits.length, 0);
  }
});

test('keepsake light is finite, clipped to the illustration and static in quiet modes', () => {
  const rect = { x: 120, y: 90, w: 140, h: 190 }, stamp = { owned: true, stageCurrent: 3, stageGoal: 3 };
  const frame = (age, options = {}) => {
    const record = recorder(options), initial = { ...record.state };
    drawEmblemLight(record.r, 195, 60, 24, age);
    drawStampFinish(record.r, stamp, rect, age);
    assert.equal(record.stack.length, 0); assert.deepEqual(record.state, initial);
    assert.equal(record.r.hits.length, 0);
    return record.paints;
  };
  const active = frame(430), settled = frame(1000);
  assert.notDeepEqual(active, settled);
  const reflection = active.find(paint => paint.color === '#fffef0');
  assert.ok(reflection && reflection.clip && reflection.clip[0][0] === 'arc');
  assert.deepEqual(frame(1000), frame(90000), 'a background interval cannot replay the reflection');
  for (const options of [{ reducedMotion: true }, { effectsQuality: 'low' }]) assert.deepEqual(frame(220, options), frame(90000, options));
  const locked = recorder(); drawStampFinish(locked.r, { ...stamp, owned: false }, rect, 430, false);
  assert.equal(locked.paints.length, 0, 'an unearned stamp receives no owned seal or gilt');
});

test('modal highlights never transform text or change the first-frame hit rectangles', () => {
  for (const kind of ['item', 'pause', 'help', 'win', 'fail']) {
    const modal = { kind, itemId: 'kite', title: '继续旅程', lines: ['纸上的风会等你回来。'],
      stars: kind === 'win' ? 2 : undefined, buttons: [{ text: '继续', primary: true, action() {} }] };
    const frame = age => {
      const record = recorder(); drawModal(record.r, modal, 1000 + age, age);
      assert.equal(record.stack.length, 0);
      assert.ok(record.texts.every(text => text.transform.length === 0));
      return record.r.hits;
    };
    assert.deepEqual(frame(0), frame(180)); assert.deepEqual(frame(180), frame(90000));
  }
});

test('stamp paging renews only its artwork reflection and preserves all control positions', () => {
  for (const H of [590, 740]) {
    const album = getAlbum({ completed: { 1: { stars: 3, bestTurns: 8 } } }), record = recorder({ H });
    const game = { modal: { kind: 'stamp-detail', stampId: album.stamps[0].id }, album: () => album,
      unlocked: () => true, collectionFilter: 'all', openLevelBrowser() {}, syncMusic() {} };
    const snapshot = () => record.r.hits.map(({ x, y, w, h }) => [x, y, w, h]);
    drawStampDetail(record.r, game, 1000); const hits = snapshot();
    assert.equal(record.r.stampDetailPresentation.at, 1000);
    record.r.hits = []; drawStampDetail(record.r, game, 90000);
    assert.equal(record.r.stampDetailPresentation.at, 1000, 'time alone cannot restart the reveal');
    assert.deepEqual(snapshot(), hits);
    game.modal.stampId = album.stamps[1].id; record.r.hits = [];
    drawStampDetail(record.r, game, 90100);
    assert.equal(record.r.stampDetailPresentation.at, 90100);
    assert.equal(record.stack.length, 0);
    assert.ok(record.r.hits.slice(1).every(hit => hit.y >= 0 && hit.y + hit.h <= H));
  }
});
