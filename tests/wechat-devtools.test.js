'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/platform');

function target(extra) {
  const events = new Map();
  return Object.assign({
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { const set = events.get(name); if (set) set.delete(fn); },
    emit(name, event) { const set = events.get(name); if (set) Array.from(set).forEach(fn => fn(event)); },
  }, extra);
}
function harness(platformName = 'devtools') {
  const callbacks = {}, data = new Map();
  const doc = target({}), win = target({});
  const rect = { left: 20, top: 30, width: 195, height: 422 };
  const canvas = target({ ownerDocument: doc, getBoundingClientRect: () => rect });
  let time = 1000;
  const wx = {
    createCanvas() { assert.equal(this, wx); return canvas; },
    getDeviceInfo() { return { platform: platformName }; },
    getWindowInfo() { return { windowWidth: 390, windowHeight: 844, pixelRatio: 3 }; },
    getSystemInfoSync() { return { platform: platformName, windowWidth: 390, windowHeight: 844, pixelRatio: 3 }; },
    getStorageSync(key) { assert.equal(this, wx); return data.get(key) || ''; },
    setStorageSync(key, value) { assert.equal(this, wx); data.set(key, value); },
    removeStorageSync(key) { assert.equal(this, wx); data.delete(key); },
  };
  ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide', 'Show'].forEach(name => {
    callbacks[name] = new Set();
    wx['on' + name] = function(fn) { assert.equal(this, wx); callbacks[name].add(fn); };
    wx['off' + name] = function(fn) { assert.equal(this, wx); callbacks[name].delete(fn); };
  });
  const platform = createPlatform({ wx, window: win, document: doc, performance: { now: () => time } });
  platform.resize();
  const seen = [];
  const off = platform.onPointer((...args) => seen.push(args));
  const mouse = (kind, x = 70, y = 90, extra = {}) => {
    const event = Object.assign({ clientX: x, clientY: y, button: 0, buttons: kind === 'mouseup' ? 0 : 1, timeStamp: time }, extra);
    canvas.emit(kind, event); doc.emit(kind, event); win.emit(kind, event);
  };
  const touch = (kind, x = 100, y = 120, identifier = 1) => {
    const point = { identifier, clientX: x, clientY: y };
    Array.from(callbacks[kind]).forEach(fn => fn({ changedTouches: [point], touches: kind === 'TouchEnd' ? [] : [point], timeStamp: time }));
  };
  const lifecycle = name => Array.from(callbacks[name]).forEach(fn => fn());
  return { platform, canvas, doc, win, wx, callbacks, mouse, touch, lifecycle, seen, off, advance: amount => { time += amount; } };
}

test('devtools accepts mouse clicks when its mobile simulator touch emulation is absent', () => {
  const h = harness();
  h.mouse('mousedown'); h.mouse('mouseup');
  assert.deepEqual(h.seen, [[100, 120, 'start'], [100, 120, 'end']]);
  h.off(); h.mouse('mousedown'); h.mouse('mouseup');
  assert.equal(h.seen.length, 2);
});

test('devtools combines canvas mouse and wx synthetic touch into one gesture', () => {
  const h = harness();
  // Native canvas listeners run before the SDK document mouse-to-touch bridge.
  h.mouse('mousedown'); h.touch('TouchStart');
  h.mouse('mousemove', 80, 100); h.touch('TouchMove', 120, 140);
  h.mouse('mouseup', 80, 100); h.touch('TouchEnd', 120, 140);
  assert.equal(h.seen.filter(p => p[2] === 'start').length, 1);
  assert.equal(h.seen.filter(p => p[2] === 'end').length, 1);
  assert.deepEqual(h.seen[h.seen.length - 1], [120, 140, 'end']);
});

test('devtools suppresses compatibility mouse events emitted after a native touch tap', () => {
  const h = harness();
  h.touch('TouchStart'); h.touch('TouchEnd');
  h.mouse('mousedown', 70, 90, { sourceCapabilities: { firesTouchEvents: true } });
  h.mouse('mouseup', 70, 90, { sourceCapabilities: { firesTouchEvents: true } });
  assert.deepEqual(h.seen, [[100, 120, 'start'], [100, 120, 'end']]);
  h.advance(50); h.touch('TouchStart', 160, 200); h.touch('TouchEnd', 160, 200);
  assert.equal(h.seen.filter(p => p[2] === 'end').length, 2, 'quick consecutive real taps are retained');
});

test('devtools mouse fallback ignores right clicks and does not activate on physical devices', () => {
  const h = harness();
  h.mouse('mousedown', 70, 90, { button: 2 }); h.mouse('mouseup', 70, 90, { button: 2 });
  assert.deepEqual(h.seen, []);
  for (const name of ['ios', 'android']) {
    const device = harness(name);
    device.mouse('mousedown'); device.mouse('mouseup');
    assert.deepEqual(device.seen, [], name + ' keeps native touch as its input path');
    device.touch('TouchStart'); device.touch('TouchEnd');
    assert.equal(device.seen.length, 2);
  }
});

test('interrupted native gesture is cancelled across app background and input works after return', () => {
  const h = harness();
  h.platform.onHide(() => {}); h.platform.onShow(() => {});
  h.touch('TouchStart'); h.lifecycle('Hide'); h.lifecycle('Show');
  h.touch('TouchStart', 180, 220, 2); h.touch('TouchEnd', 180, 220, 2);
  assert.equal(h.seen.filter(p => p[2] === 'cancel').length, 1);
  assert.deepEqual(h.seen.slice(-2), [[180, 220, 'start'], [180, 220, 'end']]);
});

test('WeChat event registration and local storage preserve the API receiver', () => {
  const h = harness();
  h.platform.storage.set('run', { turn: 2 });
  assert.deepEqual(h.platform.storage.get('run'), { turn: 2 });
  h.platform.storage.remove('run');
  h.off();
  assert.equal(h.callbacks.TouchStart.size, 0);
});

test('devtools completes release outside the canvas and recovers from a window blur', () => {
  const h = harness();
  h.mouse('mousedown');
  h.doc.emit('mouseup', { clientX: 230, clientY: 480, button: 0, buttons: 0 });
  assert.deepEqual(h.seen.slice(-1), [[420, 900, 'end']]);
  h.mouse('mousedown'); h.win.emit('blur', {});
  h.mouse('mouseup');
  h.mouse('mousedown'); h.mouse('mouseup');
  assert.equal(h.seen.filter(p => p[2] === 'cancel').length, 1);
  assert.equal(h.seen.filter(p => p[2] === 'end').length, 2);
});

test('devtools cancels a gesture when mouse leaves the simulator or the button was released elsewhere', () => {
  const h = harness();
  h.mouse('mousedown'); h.canvas.emit('mouseleave', {});
  h.mouse('mouseup');
  h.mouse('mousedown'); h.mouse('mousemove', 80, 100, { buttons: 0 });
  h.mouse('mousedown'); h.mouse('mouseup');
  assert.equal(h.seen.filter(p => p[2] === 'cancel').length, 2);
  assert.equal(h.seen.filter(p => p[2] === 'end').length, 1);
});

test('empty changedTouches falls back to touches and a lost native release recovers on the next finger', () => {
  const h = harness('ios');
  const fire = (name, event) => Array.from(h.callbacks[name]).forEach(fn => fn(event));
  fire('TouchStart', { changedTouches: [], touches: [{ identifier: 5, clientX: 10, clientY: 20 }] });
  fire('TouchMove', { changedTouches: [], touches: [{ identifier: 5, clientX: 30, clientY: 40 }] });
  h.touch('TouchStart', 100, 120, 6); h.touch('TouchEnd', 100, 120, 6);
  assert.deepEqual(h.seen, [[10, 20, 'start'], [30, 40, 'move'], [30, 40, 'cancel'], [100, 120, 'start'], [100, 120, 'end']]);
});

test('a second simultaneous native finger cancels the current gesture without a tap', () => {
  const h = harness('ios');
  h.touch('TouchStart');
  const original = { identifier: 1, clientX: 100, clientY: 120 };
  const second = { identifier: 2, clientX: 200, clientY: 240 };
  Array.from(h.callbacks.TouchStart).forEach(fn => fn({ changedTouches: [second], touches: [original, second] }));
  h.touch('TouchEnd', 200, 240, 2); h.touch('TouchEnd');
  assert.deepEqual(h.seen, [[100, 120, 'start'], [100, 120, 'cancel']]);
  h.touch('TouchStart'); h.touch('TouchEnd');
  assert.deepEqual(h.seen.slice(2), [[100, 120, 'start'], [100, 120, 'end']]);
});

test('compatibility mouse with no sourceCapabilities is ignored for the same touch tap', () => {
  const h = harness();
  h.touch('TouchStart'); h.touch('TouchEnd');
  h.advance(20); h.mouse('mousedown'); h.mouse('mouseup');
  assert.equal(h.seen.filter(p => p[2] === 'end').length, 1);
  h.advance(800); h.mouse('mousedown'); h.mouse('mouseup');
  assert.equal(h.seen.filter(p => p[2] === 'end').length, 2);
});

test('a new mouse press recovers if a simulator overlay swallowed the previous release', () => {
  const h = harness();
  h.mouse('mousedown');
  h.advance(1000); h.mouse('mousedown', 80, 100); h.mouse('mouseup', 80, 100);
  assert.deepEqual(h.seen, [[100, 120, 'start'], [100, 120, 'cancel'], [120, 140, 'start'], [120, 140, 'end']]);
});

test('devtools cancels context menus and mouse movement after the primary button is released', () => {
  const h = harness();
  h.mouse('mousedown'); h.canvas.emit('contextmenu', {}); h.mouse('mouseup');
  h.mouse('mousedown'); h.mouse('mousemove', 80, 100, { buttons: 2 }); h.mouse('mouseup');
  h.mouse('mousedown'); h.mouse('mouseup');
  assert.equal(h.seen.filter(p => p[2] === 'cancel').length, 2);
  assert.equal(h.seen.filter(p => p[2] === 'end').length, 1);
});
