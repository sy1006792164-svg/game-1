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

function browser(reducedMotion = false) {
  const saved = new Map();
  const rect = { left: 20, top: 10, width: 390, height: 800 };
  const canvas = eventTarget({ getBoundingClientRect: () => rect, setPointerCapture() {} });
  const doc = eventTarget({ hidden: false, getElementById: id => id === 'game' ? canvas : null });
  const motion = { matches: reducedMotion };
  const win = eventTarget({ devicePixelRatio: 4, matchMedia: query => {
    assert.equal(query, '(prefers-reduced-motion: reduce)'); return motion;
  }, localStorage: {
    getItem: key => saved.has(key) ? saved.get(key) : null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key),
  } });
  return { canvas, doc, win, saved, rect, motion, platform: createPlatform({ window: win, document: doc }) };
}

test('Tab navigates canvas controls without trapping focus or taking over other page elements', () => {
  const { platform, canvas, win } = browser();
  const keys = []; let handled = true, prevented = 0;
  platform.onKey(key => { keys.push(key); return handled; });
  const event = { key: 'Tab', target: canvas, preventDefault() { prevented++; } };
  win.emit('keydown', event);
  win.emit('keydown', { ...event, shiftKey: true });
  assert.deepEqual(keys, ['Tab', 'Shift+Tab']);
  assert.equal(prevented, 2);
  handled = false; win.emit('keydown', event);
  assert.equal(prevented, 2, 'the browser can leave the last or first canvas control');
  win.emit('keydown', { ...event, target: { tagName: 'A' } });
  assert.equal(keys.length, 3, 'normal document tab order stays intact');
});

test('a browser pointer press focuses the canvas for subsequent keyboard navigation', () => {
  const { platform, canvas } = browser(); platform.resize();
  const focused = [];
  canvas.focus = options => focused.push(options);
  platform.onPointer(() => {});
  const event = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, preventDefault() {} };
  canvas.emit('pointerdown', event);
  canvas.emit('pointerup', event);
  canvas.emit('pointerdown', { ...event, button: 2 });
  assert.deepEqual(focused, [{ preventScroll: true }]);
});

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

test('browser canvas uses CSS dimensions, native DPR and relative pointer coordinates', () => {
  const { platform, canvas } = browser();
  assert.equal(platform.kind, 'browser');
  assert.deepEqual(platform.resize(), { width: 390, height: 800, pixelRatio: 4, safeTop: 0, safeBottom: 0 });
  assert.equal(canvas.width, 1560);
  assert.equal(canvas.height, 3200);
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

test('browser motion preference stays live and memory pressure preserves native effect quality', () => {
  const reduced = browser(true);
  assert.equal(reduced.platform.reducedMotion, true);
  assert.equal(reduced.platform.effectsQuality, 'high');
  reduced.motion.matches = false;
  assert.equal(reduced.platform.reducedMotion, false);

  let collections = 0;
  const platform = createPlatform({ wx: { createCanvas: () => ({}), triggerGC() { collections++; } } });
  assert.equal(platform.reducedMotion, false);
  assert.equal(platform.effectsQuality, 'high');
  platform.reduceMemory();
  assert.equal(platform.effectsQuality, 'high');
  assert.equal(collections, 1);
});

test('browser multi-touch neither zooms nor releases a tap and the next single-finger tap works', () => {
  const { platform, canvas } = browser(); platform.resize();
  const points = [], zoomed = [];
  platform.onPointer((...args) => points.push(args), (...args) => zoomed.push(args));
  const first = { pointerType: 'touch', pointerId: 1, clientX: 120, clientY: 210, button: 0, preventDefault() {} };
  const second = { ...first, pointerId: 2, clientX: 220 };
  canvas.emit('pointerdown', first);
  canvas.emit('pointerdown', second);
  canvas.emit('pointermove', { ...second, clientX: 320 });
  canvas.emit('pointermove', { ...second, clientX: 150 });
  canvas.emit('pointerup', second);
  canvas.emit('pointermove', { ...first, clientX: 130 });
  canvas.emit('pointerup', first);
  assert.deepEqual(zoomed, []);
  assert.deepEqual(points, [[100, 200, 'start'], [100, 200, 'cancel']]);
  canvas.emit('pointerdown', first);
  canvas.emit('pointerup', first);
  assert.deepEqual(points.slice(2), [[100, 200, 'start'], [100, 200, 'end']]);
});

test('browser mouse release lost to an overlay cancels instead of continuing a drag or spending a turn', () => {
  for (const buttons of [0, 2, 4]) {
    const { platform, canvas } = browser(); platform.resize();
    const points = [];
    platform.onPointer((...args) => points.push(args));
    const event = { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 210, button: 0, buttons: 1 };
    canvas.emit('pointerdown', event);
    canvas.emit('pointermove', { ...event, clientX: 130, buttons });
    canvas.emit('pointerup', { ...event, buttons: 0 });
    assert.deepEqual(points, [[100, 200, 'start'], [100, 200, 'cancel']]);
    canvas.emit('pointerdown', event);
    canvas.emit('pointerup', { ...event, buttons: 0 });
    assert.deepEqual(points.slice(2), [[100, 200, 'start'], [100, 200, 'end']]);
  }
});

test('a context menu aborts the held browser gesture and the next click remains usable', () => {
  const { platform, canvas } = browser(); platform.resize();
  const points = [];
  platform.onPointer((...args) => points.push(args));
  const event = { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 210, button: 0, buttons: 1 };
  canvas.emit('pointerdown', event);
  canvas.emit('contextmenu', {});
  canvas.emit('pointerup', { ...event, buttons: 0 });
  canvas.emit('pointerdown', event);
  canvas.emit('pointerup', { ...event, buttons: 0 });
  assert.deepEqual(points, [[100, 200, 'start'], [100, 200, 'cancel'], [100, 200, 'start'], [100, 200, 'end']]);
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

test('IME candidate navigation and already handled keys cannot spend game turns', () => {
  const { platform, win } = browser();
  const keys = [];
  let prevented = 0;
  platform.onKey(key => keys.push(key));
  const event = { key: 'ArrowLeft', target: { tagName: 'CANVAS' }, preventDefault() { prevented++; } };
  win.emit('keydown', { ...event, isComposing: true });
  win.emit('keydown', { ...event, keyCode: 229 });
  win.emit('keydown', { ...event, defaultPrevented: true });
  assert.deepEqual(keys, []);
  assert.equal(prevented, 0, 'the IME and prior event owner retain their own input');
  win.emit('keydown', event);
  assert.deepEqual(keys, ['ArrowLeft']);
  assert.equal(prevented, 1);
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
  assert.deepEqual(platform.resize(), { width: 393, height: 852, pixelRatio: 3, safeTop: 87, safeBottom: 34 });
  assert.equal(canvas.width, 1179);
  assert.equal(canvas.height, 2556);
  const points = [];
  const off = platform.onPointer((...args) => points.push(args));
  callbacks.Start({ changedTouches: [{ identifier: 4, clientX: 12, clientY: 45 }] });
  callbacks.Start({ changedTouches: [{ identifier: 7, clientX: 90, clientY: 90 }] });
  callbacks.End({ changedTouches: [{ identifier: 7, clientX: 90, clientY: 90 }] });
  callbacks.Move({ changedTouches: [{ identifier: 4, clientX: 20, clientY: 60 }] });
  callbacks.Cancel({ changedTouches: [] });
  assert.deepEqual(points, [[12, 45, 'start'], [12, 45, 'cancel']]);
  callbacks.Start({ changedTouches: [{ identifier: 4, clientX: 12, clientY: 45 }] });
  callbacks.Move({ changedTouches: [{ identifier: 4, clientX: 20, clientY: 60 }] });
  callbacks.End({ changedTouches: [{ identifier: 4, clientX: 20, clientY: 60 }] });
  assert.deepEqual(points.slice(2), [[12, 45, 'start'], [20, 60, 'move'], [20, 60, 'end']]);
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

test('partial window info retains current dimensions and recovers real device density', () => {
  for (const pixelRatio of [undefined, 0, NaN]) {
    const canvas = {}, platform = createPlatform({ wx: {
      createCanvas: () => canvas, getDeviceInfo: () => ({ platform: 'ios' }),
      getWindowInfo: () => ({ windowWidth: 393, windowHeight: 852, pixelRatio }),
      getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 3 }),
    } });
    const metrics = platform.resize();
    assert.equal(metrics.width, 393); assert.equal(metrics.height, 852);
    assert.equal(metrics.pixelRatio, 3);
    assert.equal(canvas.width, 1179); assert.equal(canvas.height, 2556);
  }
});

test('native window resize uses event dimensions before the system snapshot catches up', () => {
  const canvas = {};
  let handler, pixelRatio = 1.25, metrics;
  const platform = createPlatform({ wx: {
    createCanvas: () => canvas, getDeviceInfo: () => ({ platform: 'windows' }),
    getWindowInfo: () => ({ windowWidth: 420, windowHeight: 745, pixelRatio }),
    onWindowResize: callback => { handler = callback; },
    offWindowResize: callback => { assert.equal(callback, handler); handler = null; },
  } });
  platform.resize();
  const off = platform.onResize(event => { metrics = platform.resize(event); });
  handler({ windowWidth: 840, windowHeight: 1490 });
  assert.deepEqual(metrics, { width: 840, height: 1490, pixelRatio: 2, safeTop: 0, safeBottom: 0 });
  assert.equal(canvas.width, 1680); assert.equal(canvas.height, 2980);
  // Moving to a denser display changes resolution even when the window size is unchanged.
  pixelRatio = 3;
  handler({ windowWidth: 840, windowHeight: 1490 });
  assert.equal(canvas.width, 2520); assert.equal(canvas.height, 4470);
  assert.deepEqual(platform.reduceMemory(), metrics, 'memory cleanup must not restore a stale window snapshot');
  assert.equal(canvas.width, 2520); assert.equal(canvas.height, 4470);
  off(); assert.equal(handler, null);
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

test('desktop WeChat never reserves its external title bar inside the game canvas', () => {
  for (const name of ['windows', 'mac', 'ohos_pc']) {
    for (const capsule of [undefined, () => { throw new Error('unsupported'); }, () => ({ bottom: 0 }), () => ({ bottom: 79 })]) {
      for (const legacy of [false, true]) {
        const info = { platform: name, windowWidth: 420, windowHeight: 745, pixelRatio: 1.5,
          statusBarHeight: 44, safeArea: { top: 44, bottom: 711 } };
        const canvas = {}, platform = createPlatform({ wx: {
          createCanvas: () => canvas, getWindowInfo: () => info,
          getDeviceInfo: legacy ? undefined : () => ({ platform: name }),
          getSystemInfoSync: () => info, getMenuButtonBoundingClientRect: capsule,
        } });
        assert.deepEqual(platform.resize(), { width: 420, height: 745, pixelRatio: 2, safeTop: 0, safeBottom: 0 });
        assert.equal(canvas.width, 840);
      }
    }
  }
});

test('phones and DevTools convert screen safe areas and capsule bounds to canvas coordinates', () => {
  for (const name of ['ios', 'android', 'ohos', 'devtools']) {
    for (const screenTop of [0, 20, 100]) {
      const platform = createPlatform({ wx: {
        createCanvas: () => ({}), getDeviceInfo: () => ({ platform: name }),
        getWindowInfo: () => ({ windowWidth: 393, windowHeight: 852 - screenTop, pixelRatio: 3,
          screenTop, statusBarHeight: 47, safeArea: { top: 47, bottom: 818 } }),
        getMenuButtonBoundingClientRect: () => ({ bottom: 79 }),
      } });
      const metrics = platform.resize();
      assert.equal(metrics.safeTop, Math.max(0, 87 - screenTop));
      assert.equal(metrics.safeBottom, 34);
    }
  }
});

test('native canvas has no DPR or backing-size ceiling on phones and desktops', () => {
  for (const name of ['windows', 'mac', 'ohos_pc', 'ios', 'android', 'ohos', 'devtools']) {
    let info;
    const writes = [], canvas = { _width: 0, _height: 0,
      get width() { return this._width; }, set width(value) { writes.push(value); this._width = value; },
      get height() { return this._height; }, set height(value) { writes.push(value); this._height = value; },
    };
    const platform = createPlatform({ wx: { createCanvas: () => canvas,
      getDeviceInfo: () => ({ platform: name }), getWindowInfo: () => info } });
    for (const [windowWidth, windowHeight, pixelRatio] of [
      [420, 745, 1], [420, 745, 1.25], [420, 745, 1.5], [420, 745, 2],
      [393, 852, 3], [430, 932, 3.5], [430, 932, 4], [1920, 1080, 2],
      [7680, 4320, 2], [430, 932, 6],
    ]) {
      info = { windowWidth, windowHeight, pixelRatio };
      const density = ['windows', 'mac', 'ohos_pc'].includes(name) ? Math.max(2, pixelRatio) : pixelRatio;
      const metrics = platform.resize();
      assert.equal(metrics.pixelRatio, density);
      assert.equal(metrics.width, windowWidth); assert.equal(metrics.height, windowHeight);
      assert.equal(canvas.width, Math.floor(windowWidth * density));
      assert.equal(canvas.height, Math.floor(windowHeight * density));
      const before = writes.length;
      platform.resize();
      assert.deepEqual(platform.reduceMemory(), metrics);
      assert.equal(writes.length, before, 'unchanged frames and memory cleanup must not clear or reallocate the canvas');
      assert.equal(platform.effectsQuality, 'high');
    }
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
