'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/platform');
const { createStore, PROFILE_KEY, RUN_KEY } = require('../src/storage');

function eventTarget(extra) {
  const events = new Map();
  return {
    ...extra, events,
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { if (events.has(name)) events.get(name).delete(fn); },
    emit(name, event) { if (events.has(name)) for (const fn of events.get(name)) fn(event); },
  };
}

function browser() {
  const saved = new Map();
  const rect = { left: 20, top: 10, width: 390, height: 800 };
  const canvas = eventTarget({ getBoundingClientRect: () => rect, setPointerCapture() {} });
  const doc = eventTarget({ hidden: false, getElementById: id => id === 'game' ? canvas : null });
  const win = eventTarget({ devicePixelRatio: 4, localStorage: {
    getItem: key => saved.has(key) ? saved.get(key) : null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key),
  } });
  return { canvas, doc, win, saved, rect, platform: createPlatform({ window: win, document: doc }) };
}

test('wheel events route to collection scrolling before board zoom and preserve line/page units', () => {
  const { platform, canvas } = browser(); platform.resize();
  const scrolled = [], zoomed = [];
  let collection = true;
  platform.onPointer(() => {}, (...args) => zoomed.push(args), (x, y, delta) => { if (!collection) return false; scrolled.push([x, y, delta]); return true; });
  const event = { clientX: 120, clientY: 310, deltaY: 2, deltaMode: 1, preventDefault() {} };
  canvas.emit('wheel', event);
  canvas.emit('wheel', { ...event, deltaY: 1, deltaMode: 2 });
  assert.deepEqual(scrolled, [[100, 300, 32], [100, 300, 800]]);
  assert.equal(zoomed.length, 0);
  collection = false; canvas.emit('wheel', event);
  assert.equal(zoomed.length, 1);
});

test('browser canvas uses CSS dimensions, bounded DPR and relative pointer coordinates', () => {
  const { platform, canvas } = browser();
  assert.equal(platform.kind, 'browser');
  assert.deepEqual(platform.resize(), { width: 390, height: 800, pixelRatio: 3, safeTop: 0, safeBottom: 0 });
  assert.equal(canvas.width, 1170);
  assert.equal(canvas.height, 2400);
  const points = [];
  const off = platform.onPointer((x, y, type) => points.push([x, y, type]));
  const event = { clientX: 120, clientY: 210, pointerId: 1, button: 0, preventDefault() {} };
  canvas.emit('pointerdown', event);
  canvas.emit('pointerdown', { ...event, pointerId: 2 });
  canvas.emit('pointermove', { ...event, clientX: 130 });
  canvas.emit('pointercancel', event);
  canvas.emit('lostpointercapture', event);
  assert.deepEqual(points, [[100, 200, 'start'], [110, 200, 'move'], [100, 200, 'cancel']]);
  off();
  canvas.emit('pointerdown', event);
  assert.equal(points.length, 3);
});

test('platform exposes native channel or browser origin development detection', () => {
  const canvas = {};
  for (const envVersion of ['develop', 'trial', 'release', undefined]) {
    const platform = createPlatform({ wx: { createCanvas: () => canvas, getAccountInfoSync: () => ({ miniProgram: { envVersion } }) },
      window: { location: { protocol: 'http:', hostname: 'localhost' } } });
    assert.equal(platform.isDevelopment, envVersion === 'develop');
  }
  const { canvas: browserCanvas, win, doc } = browser();
  win.location = { protocol: 'http:', hostname: 'localhost' };
  assert.equal(createPlatform({ window: win, document: doc }).isDevelopment, true);
  win.location = { protocol: 'https:', hostname: 'game.example.com', search: '?dev=1' };
  assert.equal(createPlatform({ window: win, document: doc }).isDevelopment, false);
  assert.ok(browserCanvas);
});

test('browser storage roundtrips objects and surfaces corrupt/quota errors to the store', () => {
  const { platform, saved } = browser();
  platform.storage.set('a', { turns: 4 });
  assert.deepEqual(platform.storage.get('a'), { turns: 4 });
  saved.set('bad', '{');
  assert.throws(() => platform.storage.get('bad'), SyntaxError);
  platform.storage.remove('a');
  assert.equal(platform.storage.get('a'), null);
});

test('browser lifecycle, resize and keyboard callbacks can unsubscribe', () => {
  const { platform, doc, win } = browser();
  const seen = [];
  const offHide = platform.onHide(() => seen.push('hide'));
  platform.onShow(() => seen.push('show'));
  const offResize = platform.onResize(() => seen.push('resize'));
  const offKey = platform.onKey(key => seen.push(key));
  doc.hidden = true; doc.emit('visibilitychange');
  doc.hidden = false; doc.emit('visibilitychange');
  win.emit('resize');
  const event = { key: 'ArrowLeft', target: { tagName: 'CANVAS' }, preventDefault() {} };
  win.emit('keydown', event);
  win.emit('keydown', { ...event, repeat: true });
  win.emit('keydown', { ...event, target: { tagName: 'INPUT' } });
  offHide(); offResize(); offKey();
  doc.hidden = true; doc.emit('visibilitychange'); win.emit('resize'); win.emit('keydown', event);
  assert.deepEqual(seen, ['hide', 'show', 'resize', 'ArrowLeft']);
});

test('WeChat reserves capsule/safe area, uses native local storage and single-touch gesture input', () => {
  const callbacks = {}, canvas = {}, data = new Map();
  const wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ windowWidth: 393, windowHeight: 852, pixelRatio: 3, statusBarHeight: 47, safeArea: { top: 47, bottom: 818 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 79 }),
    getStorageSync: key => data.get(key), setStorageSync: (key, value) => data.set(key, value), removeStorageSync: key => data.delete(key),
  };
  ['Start', 'Move', 'End', 'Cancel'].forEach(name => { wx['onTouch' + name] = fn => { callbacks[name] = fn; }; wx['offTouch' + name] = fn => { if (callbacks[name] === fn) delete callbacks[name]; }; });
  const platform = createPlatform({ wx });
  assert.equal(platform.wx, wx);
  assert.equal(platform.kind, 'wechat');
  assert.deepEqual(platform.resize(), { width: 393, height: 852, pixelRatio: 2, safeTop: 87, safeBottom: 34 });
  assert.equal(canvas.width, 786);
  const points = [];
  const off = platform.onPointer((...args) => points.push(args));
  callbacks.Start({ changedTouches: [{ identifier: 4, clientX: 12, clientY: 45 }] });
  callbacks.Start({ changedTouches: [{ identifier: 7, clientX: 90, clientY: 90 }] });
  callbacks.End({ changedTouches: [{ identifier: 7, clientX: 90, clientY: 90 }] });
  callbacks.Move({ changedTouches: [{ identifier: 4, clientX: 20, clientY: 60 }] });
  callbacks.Cancel({ changedTouches: [] });
  assert.deepEqual(points, [[12, 45, 'start'], [20, 60, 'move'], [20, 60, 'cancel']]);
  off(); assert.deepEqual(callbacks, {});
  platform.storage.set('a', { valid: true });
  assert.equal(data.get('a'), '{"valid":true}', 'native bridge receives a JSON string');
  assert.deepEqual(platform.storage.get('a'), { valid: true });
  platform.storage.remove('a'); assert.equal(data.has('a'), false);
});

test('older WeChat versions use system info and animation callbacks are cancellable', () => {
  let called, cancelled;
  const platform = createPlatform({
    wx: { createCanvas: () => ({}), getWindowInfo() { throw new Error('unsupported'); }, getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }) },
    performance: { now: () => 123 },
    requestAnimationFrame: fn => { called = fn; return 9; }, cancelAnimationFrame: id => { cancelled = id; },
  });
  assert.equal(platform.resize().width, 375);
  assert.equal(platform.now(), 123);
  const callback = () => {};
  assert.equal(platform.raf(callback), 9); assert.equal(called, callback);
  platform.cancelRaf(9); assert.equal(cancelled, 9);
});

test('native frame rate switches between lists and scenes without repeated SDK calls', () => {
  const requests = [];
  const platform = createPlatform({ wx: {
    createCanvas: () => ({}), setPreferredFramesPerSecond: fps => requests.push(fps),
  } });
  platform.setFrameRate(30);
  for (let frame = 0; frame < 120; frame++) platform.setFrameRate(60);
  for (let frame = 0; frame < 60; frame++) platform.setFrameRate(30);
  assert.deepEqual(requests, [30, 60, 30]);
});

test('native frame rate requests tolerate missing or throwing SDK APIs', () => {
  let attempts = 0;
  for (const setter of [undefined, () => { attempts++; throw new Error('unsupported'); }]) {
    const platform = createPlatform({ wx: { createCanvas: () => ({}), setPreferredFramesPerSecond: setter } });
    assert.doesNotThrow(() => {
      for (let frame = 0; frame < 10; frame++) platform.setFrameRate(60);
      for (let frame = 0; frame < 10; frame++) platform.setFrameRate(30);
    });
  }
  assert.equal(attempts, 3, 'unsupported SDK requests are retried only when the requested rate changes');
  assert.doesNotThrow(() => browser().platform.setFrameRate(60));
});

test('coordinate-free pointer cancellation clears the gesture without activating a release', () => {
  const { platform, canvas } = browser();
  platform.resize();
  const events = [];
  platform.onPointer((...args) => events.push(args));
  const down = { pointerId: 1, clientX: 70, clientY: 80, button: 0 };
  canvas.emit('pointerdown', down);
  canvas.emit('lostpointercapture', { pointerId: 1 });
  canvas.emit('pointerup', down);
  canvas.emit('pointerdown', down);
  canvas.emit('pointercancel', {});
  assert.deepEqual(events, [[50, 70, 'start'], [50, 70, 'cancel'], [50, 70, 'start'], [50, 70, 'cancel']]);
});

test('coordinate-free WeChat touch cancel clears the active finger', () => {
  const callbacks = {};
  const wx = { createCanvas: () => ({}) };
  ['Start', 'Move', 'End', 'Cancel'].forEach(name => { wx['onTouch' + name] = fn => { callbacks[name] = fn; }; });
  const platform = createPlatform({ wx });
  const events = [];
  platform.onPointer((...args) => events.push(args));
  callbacks.Start({ changedTouches: [{ identifier: 1, clientX: 9, clientY: 12 }] });
  callbacks.Cancel({ changedTouches: [{ identifier: 1 }] });
  callbacks.End({ changedTouches: [{ identifier: 1, clientX: 9, clientY: 12 }] });
  callbacks.Start({ changedTouches: [{ identifier: 2, clientX: 5, clientY: 7 }] });
  callbacks.Cancel({});
  assert.deepEqual(events, [[9, 12, 'start'], [9, 12, 'cancel'], [5, 7, 'start'], [5, 7, 'cancel']]);
});

test('WeChat reserves the capsule row when its geometry API is missing or unavailable', () => {
  for (const capsule of [undefined, () => { throw new Error('not supported'); }, () => ({ bottom: 0 })]) {
    const platform = createPlatform({ wx: {
      createCanvas: () => ({}),
      getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, statusBarHeight: 47, safeArea: { top: 47, bottom: 810 } }),
      getMenuButtonBoundingClientRect: capsule,
    } });
    assert.equal(platform.resize().safeTop, 99);
  }
});

test('WeChat JSON storage boundary retains run and profile across platform recreation', () => {
  const data = new Map();
  const wx = {
    createCanvas: () => ({}),
    getStorageSync: key => data.has(key) ? data.get(key) : '',
    setStorageSync: (key, value) => { assert.equal(typeof value, 'string'); data.set(key, value); },
    removeStorageSync: key => data.delete(key),
  };
  const first = createStore(createPlatform({ wx }).storage);
  const history = { mode: 'campaign', levelId: 2, dateKey: '2026-09-07', actions: ['up', 'wait'], reviveAt: null };
  first.recordWin('1', 3, 8, 'campaign');
  assert.equal(first.saveRun(history), true);
  assert.equal(typeof data.get(PROFILE_KEY), 'string');
  assert.equal(typeof data.get(RUN_KEY), 'string');
  const reloaded = createStore(createPlatform({ wx }).storage);
  assert.deepEqual(reloaded.loadRun(), history);
  assert.deepEqual(reloaded.getProfile(), first.getProfile());
  assert.deepEqual(reloaded.getStatus(), { persisted: true, message: '' });
});

test('WeChat storage reads legacy objects and empty values while surfacing corrupt JSON', () => {
  const legacy = { mode: 'campaign', levelId: 1, actions: [], reviveAt: null };
  const values = new Map([['legacy', legacy], ['empty', ''], ['null', null], ['bad', '{']]);
  const platform = createPlatform({ wx: { createCanvas: () => ({}), getStorageSync: key => values.get(key) } });
  assert.equal(platform.storage.get('legacy'), legacy);
  assert.equal(platform.storage.get('empty'), '');
  assert.equal(platform.storage.get('null'), null);
  assert.equal(platform.storage.get('missing'), undefined);
  assert.throws(() => platform.storage.get('bad'), SyntaxError);
});
