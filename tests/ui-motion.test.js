'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { pageFrame, recordTouch, buttonTouch, actionSnapshot, actionSound, togglePosition, hasActiveUiMotion } = require('../src/ui-motion');

function game() {
  return { page: 'home', modal: null, session: 1, hidden: false, busy: false,
    startupActive: () => false, renderer: {}, state: { turn: 3, energy: 10 } };
}

test('a rapidly reversed setting starts at the current knob position instead of snapping to an endpoint', () => {
  const closing = { key: 'sound', enabled: false, from: 1, at: 1000 };
  const interrupted = togglePosition(closing, 'sound', false, 1080);
  assert.ok(interrupted > 0 && interrupted < 1);
  const opening = { key: 'sound', enabled: true, from: interrupted, at: 1080 };
  assert.equal(togglePosition(opening, 'sound', true, 1080), interrupted);
  assert.ok(togglePosition(opening, 'sound', true, 1090) > interrupted);
  assert.equal(togglePosition(opening, 'sound', true, 1320), 1);
  assert.equal(togglePosition(opening, 'sound', true, 1080, true), 1);
  assert.equal(togglePosition(opening, 'music', false, 1080), 0);
});

test('page entrances settle without moving hit coordinates or replaying after cache release', () => {
  const g = game(), r = g.renderer, before = JSON.stringify(g.state);
  assert.equal(pageFrame(r, g, 1000), 1);
  g.page = 'settings';
  assert.ok(hasActiveUiMotion(g, 1200));
  assert.equal(pageFrame(r, g, 1200), 0);
  assert.ok(pageFrame(r, g, 1300) > 0);
  assert.equal(pageFrame(r, g, 1460), 1);
  assert.equal(hasActiveUiMotion(g, 1460), false);
  Renderer.prototype.clearCaches.call(r);
  assert.equal(pageFrame(r, g, 60000), 1, 'returning from the background never replays an old page entrance');
  assert.equal(JSON.stringify(g.state), before);
  g.page = 'game';
  assert.equal(pageFrame(r, g, 60100), 1, 'the board keeps its own camera entrance and action clock');
});

test('an accepted touch has one short feedback lifetime limited to its original page and modal', () => {
  const g = game(), r = g.renderer, hit = { x: 24, y: 80, w: 342, h: 52 }, p = { x: 65, y: 105 };
  pageFrame(r, g, 1000); recordTouch(r, g, hit, p, 1000);
  assert.ok(buttonTouch(r, 24, 80, 342, 52));
  assert.equal(buttonTouch(r, 24, 81, 342, 52), null);
  assert.equal(hasActiveUiMotion(g, 1200), true);
  pageFrame(r, g, 1360); assert.equal(r.uiFeedback, null);
  recordTouch(r, g, hit, p, 1400); g.modal = { kind: 'help' };
  pageFrame(r, g, 1410); assert.equal(r.uiFeedback, null, 'opening a dialog cannot light a different button at the same position');
  recordTouch(r, g, hit, p, 1500); g.session++;
  pageFrame(r, g, 1510); assert.equal(r.uiFeedback, null);
});

test('keyboard and touch navigation choose semantic sounds without treating mere redraws as actions', () => {
  const g = game();
  let before = actionSnapshot(g); g.page = 'collection'; assert.equal(actionSound(before, g), 'page');
  before = actionSnapshot(g); g.modal = { kind: 'stamp-detail', stampId: 'a' };
  assert.equal(actionSound(before, g), 'open');
  before = actionSnapshot(g); g.modal.stampId = 'b'; assert.equal(actionSound(before, g), 'page');
  before = actionSnapshot(g); g.modal = null; assert.equal(actionSound(before, g), 'close');
  before = actionSnapshot(g); g.collectionFilter = 'owned'; assert.equal(actionSound(before, g), 'page');
  before = actionSnapshot(g); assert.equal(actionSound(before, g), 'tap');
});

test('reduced motion and low quality show page contents immediately', () => {
  for (const options of [{ reducedMotion: true }, { effectsQuality: 'low' }]) {
    const g = game(), r = Object.assign(g.renderer, options);
    pageFrame(r, g, 1000); g.page = 'levels';
    assert.equal(pageFrame(r, g, 1100), 1);
    assert.equal(pageFrame(r, g, 1300), 1);
  }
});

test('held or completed UI feedback never keeps settled or background pages at high cadence', () => {
  const g = game(); pageFrame(g.renderer, g, 1000);
  g.pointer = { x: 40, y: 100, time: 1100 };
  assert.equal(hasActiveUiMotion(g, 1120), true);
  assert.equal(hasActiveUiMotion(g, 1400), false);
  g.pointer.time = 1400; g.pointer.dragging = true;
  assert.equal(hasActiveUiMotion(g, 1420), false);
  g.pointer.dragging = false; g.hidden = true;
  assert.equal(hasActiveUiMotion(g, 1420), false);
});

test('button release light is clipped to its face and never changes the action target', () => {
  const calls = [], stack = [], styles = { globalAlpha: 1 };
  const ctx = new Proxy(styles, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'save') return () => stack.push({ ...styles });
    if (key === 'restore') return () => Object.assign(styles, stack.pop());
    if (key === 'measureText') return text => ({ width: text.length * 10 });
    return (...args) => { args.filter(v => typeof v === 'number').forEach(v => assert.ok(Number.isFinite(v))); calls.push([key, ...args]); };
  } });
  const r = new Renderer({ getContext: () => ctx }); r.now = 1150;
  const g = game(), hit = { x: 24, y: 80, w: 342, h: 52 }, action = () => {};
  recordTouch(r, g, hit, { x: 45, y: 91 }, 1000);
  r.button('继续投递', 24, 80, 342, 52, action, { style: 'primary' });
  assert.ok(calls.some(call => call[0] === 'clip'), 'release wash is bounded by the paper silhouette');
  assert.deepEqual(r.hits[0], { ...hit, action, contains: undefined });
  assert.equal(stack.length, 0);
  calls.length = 0; r.reducedMotion = true;
  r.button('继续投递', 24, 80, 342, 52, action, { style: 'primary' });
  assert.equal(calls.some(call => call[0] === 'clip'), false, 'reduced motion omits the expanding wash');
});
