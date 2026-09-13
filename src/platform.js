'use strict';

const { createMultiTouchGuard } = require('./multi-touch');
const { isDevelopmentEnvironment } = require('./runtime-environment');
const { getWindowInfo, getDeviceInfo, getSafeInsets, isDesktop } = require('./wechat-viewport');
const { getCanvasPixelRatio, resizeCanvas } = require('./canvas-resolution');

// A small platform boundary; game rules never depend on wx or the DOM.
function defaultEnvironment() {
  return {
    wx: typeof wx !== 'undefined' ? wx : null,
    window: typeof window !== 'undefined' ? window : null,
    document: typeof document !== 'undefined' ? document : null,
    performance: typeof performance !== 'undefined' ? performance : null,
    requestAnimationFrame: typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null,
    cancelAnimationFrame: typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null,
  };
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createPlatform(environment) {
  const env = environment || defaultEnvironment();
  const api = env.wx && typeof env.wx.createCanvas === 'function' ? env.wx : null;
  const device = api ? getDeviceInfo(api) : null;
  const win = env.window;
  const doc = env.document;
  const canvas = api ? api.createCanvas() : doc && doc.getElementById('game');
  if (api && typeof GameGlobal !== 'undefined') GameGlobal.canvas = canvas;
  if (!canvas) throw new Error('Game canvas is unavailable.');
  let dimensions = { width: 390, height: 844, pixelRatio: 1, safeTop: 0, safeBottom: 0 };
  let reducedMotionQuery = null;
  if (!api && win && typeof win.matchMedia === 'function') {
    try { reducedMotionQuery = win.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_) { /* Optional browser preference. */ }
  }
  let preferredFrameRate = null;
  function setFrameRate(fps) {
    if (!api) return;
    const next = fps === 60 ? 60 : 30;
    if (preferredFrameRate === next) return;
    // Remember unsupported requests too, so an older SDK is not retried every frame.
    preferredFrameRate = next;
    if (typeof api.setPreferredFramesPerSecond === 'function') {
      try { api.setPreferredFramesPerSecond(next); } catch (_) { /* Drawing still follows the available RAF cadence. */ }
    }
  }
  // Lists opt into 60 FPS; the turn-based scenes keep their lower native frame rate.
  setFrameRate(30);

  function resize(event) {
    let width, height, pixelRatio, safeTop = 0, safeBottom = 0;
    if (api) {
      const info = getWindowInfo(api);
      // Mini Game resize events carry windowWidth/windowHeight at the top level.
      // Use them immediately even if the synchronous window snapshot is older.
      width = positive(event && event.windowWidth, positive(info.windowWidth, 390));
      height = positive(event && event.windowHeight, positive(info.windowHeight, 844));
      pixelRatio = positive(info.pixelRatio, 1);
      ({ safeTop, safeBottom } = getSafeInsets(api, info, device, height));
    } else {
      const rect = canvas.getBoundingClientRect();
      width = positive(rect.width, positive(win && win.innerWidth, 390));
      height = positive(rect.height, positive(win && win.innerHeight, 844));
      pixelRatio = positive(win && win.devicePixelRatio, 1);
    }
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    // Resolution changes only the backing surface, never layout or touch coordinates.
    pixelRatio = getCanvasPixelRatio(pixelRatio, api && isDesktop(device));
    dimensions = {
      width, height, pixelRatio,
      safeTop: Math.min(height / 3, safeTop), safeBottom: Math.min(height / 3, safeBottom),
    };
    resizeCanvas(canvas, dimensions.width, dimensions.height, pixelRatio);
    return Object.assign({}, dimensions);
  }

  // Wheel zoom receives canvas coordinates and a relative scale; touch is single-finger only.
  function onPointer(listener, onWheelZoom, onScroll) {
    if (typeof listener !== 'function') return function () {};
    let activeId = null;
    let last = null;
    let source = null;
    let lastNativeTouchAt = -Infinity;
    const removeListeners = [];
    const multiTouch = createMultiTouchGuard(cancelPointer);

    function cancelPointer() {
      const point = last;
      const wasActive = source !== null;
      activeId = null; last = null; source = null;
      if (wasActive) listener(point ? point.x : 0, point ? point.y : 0, 'cancel');
    }
    function cancel() {
      multiTouch.reset();
      cancelPointer();
    }
    function listen(target, name, handler) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(name, handler, { passive: false });
      removeListeners.push(function () { target.removeEventListener(name, handler); });
    }
    function cleanup() {
      cancel();
      removeListeners.forEach(function (remove) { remove(); });
    }
    function canvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * dimensions.width / positive(rect.width, dimensions.width),
        y: (event.clientY - rect.top) * dimensions.height / positive(rect.height, dimensions.height),
      };
    }
    function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }
    function listenWheel() {
      if (typeof onWheelZoom !== 'function' && typeof onScroll !== 'function') return;
      listen(canvas, 'wheel', function (event) {
        if (multiTouch.isActive() || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
        const point = canvasPoint(event);
        if (!finitePoint(point)) return;
        if (event.preventDefault) event.preventDefault();
        cancel();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dimensions.height : 1;
        if (typeof onScroll === 'function' && onScroll(point.x, point.y, event.deltaY * unit)) return;
        const exponent = Math.max(-0.35, Math.min(0.35, -event.deltaY * unit * 0.002));
        if (typeof onWheelZoom === 'function') onWheelZoom(point.x, point.y, Math.exp(exponent));
      });
    }

    if (api) {
      const handlers = {};
      ['Start', 'Move', 'End', 'Cancel'].forEach(function (name) {
        const type = name === 'Start' ? 'start' : name === 'Move' ? 'move' : name === 'Cancel' ? 'cancel' : 'end';
        const handler = function (event) {
          // In the desktop simulator, a canvas mouse event may subsequently be
          // translated to wx touch at the document. Its existing owner wins.
          if (source === 'mouse') return;
          if (multiTouch.touch(type, event)) { lastNativeTouchAt = now(); return; }
          const changed = Array.from((event && event.changedTouches) || []);
          const touches = Array.from((event && event.touches) || []);
          const points = changed.length ? changed : touches;
          let point;
          if (type === 'start') {
            if (!points.length) return;
            if (activeId !== null) {
              // A missing end/cancel must not permanently lock the next finger.
              // A genuine second finger leaves the first in the active list.
              if (!touches.length || touches.some(function (touch) { return (touch.identifier == null ? 0 : touch.identifier) === activeId; })) return;
              cancelPointer();
            }
            point = points[0];
            const x = Number.isFinite(point.clientX) ? point.clientX : point.x;
            const y = Number.isFinite(point.clientY) ? point.clientY : point.y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            activeId = point.identifier == null ? 0 : point.identifier;
            source = 'touch';
          } else {
            if (source !== 'touch' || activeId === null) return;
            point = points.find(function (touch) { return (touch.identifier == null ? 0 : touch.identifier) === activeId; });
            if (!point && (type === 'end' || type === 'cancel') && !points.length) point = last;
            if (!point) return;
          }
          const x = Number.isFinite(point.clientX) ? point.clientX : point.x;
          const y = Number.isFinite(point.clientY) ? point.clientY : point.y;
          const next = { x: Number.isFinite(x) ? x : last && last.x, y: Number.isFinite(y) ? y : last && last.y };
          if (type === 'cancel') { if (finitePoint(next)) last = next; lastNativeTouchAt = now(); cancel(); return; }
          if (!finitePoint(next)) return;
          lastNativeTouchAt = now();
          last = next;
          if (type === 'end') { activeId = null; last = null; source = null; }
          listener(next.x, next.y, type);
        };
        handlers[name] = handler;
        if (typeof api['onTouch' + name] === 'function') api['onTouch' + name](handler);
        removeListeners.push(function () {
          if (typeof api['offTouch' + name] === 'function') api['offTouch' + name](handler);
        });
      });
      ['Hide', 'Show'].forEach(function (name) {
        if (typeof api['on' + name] !== 'function') return;
        api['on' + name](cancel);
        removeListeners.push(function () { if (typeof api['off' + name] === 'function') api['off' + name](cancel); });
      });

      // DevTools returns its real DOM canvas. Its iPhone simulator only forwards
      // mouse clicks when the tool's touch-emulation mode is enabled; keep the
      // canvas usable when that mode is off. This path never runs on a phone.
      if (device && device.platform === 'devtools' && typeof canvas.addEventListener === 'function' && typeof canvas.getBoundingClientRect === 'function') {
        const releaseTarget = canvas.ownerDocument && typeof canvas.ownerDocument.addEventListener === 'function' ? canvas.ownerDocument : canvas;
        const windowTarget = releaseTarget.defaultView || win;
        const mouse = function (type, event) {
          if (event.sourceCapabilities && event.sourceCapabilities.firesTouchEvents) return;
          if (type === 'start') {
            if (event.button != null && event.button !== 0) return;
            // A new left-button down is also a recovery point if an overlay
            // swallowed the previous release. It cannot be a second finger.
            if (source === 'mouse') cancel();
            if (source !== null || multiTouch.isActive() || now() - lastNativeTouchAt < 700) return;
            const point = canvasPoint(event);
            if (!finitePoint(point)) return;
            source = 'mouse'; activeId = 'mouse'; last = point;
          } else {
            if (source !== 'mouse') return;
            if (type === 'end' && event.button != null && event.button !== 0) return;
            if (type === 'move' && Number.isFinite(event.buttons) && !(event.buttons & 1)) { cancel(); return; }
            const point = canvasPoint(event);
            if (!finitePoint(point)) { cancel(); return; }
            last = point;
          }
          const point = last;
          if (type === 'end') { activeId = null; last = null; source = null; }
          listener(point.x, point.y, type);
        };
        listen(canvas, 'mousedown', function (event) { mouse('start', event); });
        listen(releaseTarget, 'mousemove', function (event) { mouse('move', event); });
        listen(releaseTarget, 'mouseup', function (event) { mouse('end', event); });
        listen(canvas, 'mouseleave', cancel);
        listen(canvas, 'contextmenu', cancel);
        listen(windowTarget, 'blur', cancel);
        listenWheel();
      }
      return cleanup;
    }

    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
      const type = name === 'pointerdown' ? 'start' : name === 'pointermove' ? 'move' : name === 'pointerup' ? 'end' : 'cancel';
      listen(canvas, name, function (event) {
        if (type === 'start' && event.button != null && event.button !== 0) return;
        const point = canvasPoint(event);
        if (event.pointerType === 'touch' || multiTouch.isActive()) {
          if (event.preventDefault) event.preventDefault();
          if (type === 'start' && canvas.setPointerCapture) {
            try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic pointer. */ }
          }
          if (multiTouch.pointer(type, event)) return;
        }
        if (type === 'start') {
          if (activeId !== null || (event.button != null && event.button !== 0)) return;
          activeId = event.pointerId;
          source = 'pointer';
          if (canvas.setPointerCapture) {
            try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic pointer. */ }
          }
        } else if (activeId === null || (event.pointerId !== activeId && !(type === 'cancel' && event.pointerId == null))) return;
        if (event.preventDefault) event.preventDefault();
        // A context menu or host overlay can swallow the primary release. The
        // next hover (or secondary-button move) must cancel, never finish a tap.
        if (type === 'move' && event.pointerType === 'mouse' && Number.isFinite(event.buttons) && !(event.buttons & 1)) {
          cancel(); return;
        }
        if (type === 'cancel') { if (finitePoint(point)) last = point; cancel(); return; }
        if (!finitePoint(point)) return;
        if (type === 'start' && typeof canvas.focus === 'function') {
          try { canvas.focus({ preventScroll: true }); } catch (_) { /* Focus is optional on embedded canvases. */ }
        }
        last = point;
        if (type === 'end') { activeId = null; last = null; source = null; }
        listener(point.x, point.y, type);
      });
    });
    listenWheel();
    listen(canvas, 'contextmenu', cancel);
    listen(win, 'blur', cancel);
    listen(doc, 'visibilitychange', function () { if (doc.hidden) cancel(); });
    return cleanup;
  }

  function onKey(listener) {
    if (!win || typeof win.addEventListener !== 'function') return function () {};
    const handler = function (event) {
      // IME navigation belongs to candidate selection, including boundary
      // events where isComposing has already reset but the legacy code is 229.
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (event.target && event.target.isContentEditable)) return;
      if (event.key === 'Tab') {
        if (event.target !== canvas) return;
        if (listener(event.shiftKey ? 'Shift+Tab' : 'Tab') === true) event.preventDefault();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].indexOf(event.key) !== -1) event.preventDefault();
      listener(event.key);
    };
    win.addEventListener('keydown', handler);
    return function () { win.removeEventListener('keydown', handler); };
  }

  function nativeListener(name, listener) {
    if (!api || typeof api['on' + name] !== 'function') return function () {};
    try { api['on' + name](listener); } catch (_) { return function () {}; }
    return function () { if (typeof api['off' + name] === 'function') api['off' + name](listener); };
  }

  function lifecycle(name, listener) {
    if (api && typeof api['on' + name] === 'function') {
      return nativeListener(name, listener);
    }
    if (!doc || typeof doc.addEventListener !== 'function') return function () {};
    const handler = function () {
      if ((name === 'Hide') === Boolean(doc.hidden)) listener();
    };
    doc.addEventListener('visibilitychange', handler);
    return function () { doc.removeEventListener('visibilitychange', handler); };
  }

  function onResize(listener) {
    // Consumers call resize before repainting; changing canvas size resets its context.
    const handler = function (event) { listener(event); };
    if (api && typeof api.onWindowResize === 'function') {
      api.onWindowResize(handler);
      return function () { if (typeof api.offWindowResize === 'function') api.offWindowResize(handler); };
    }
    if (!win) return function () {};
    win.addEventListener('resize', handler);
    return function () { win.removeEventListener('resize', handler); };
  }

  const storage = api ? {
    get: function (key) {
      const value = api.getStorageSync(key);
      // A JSON string crosses the native bridge without SDK object wrappers or
      // foreign prototypes. Keep old object saves readable during migration.
      return typeof value === 'string' && value !== '' ? JSON.parse(value) : value;
    },
    set: function (key, value) { api.setStorageSync(key, JSON.stringify(value)); },
    remove: function (key) { api.removeStorageSync(key); },
  } : {
    get: function (key) {
      const value = win.localStorage.getItem(key);
      return value == null ? null : JSON.parse(value);
    },
    set: function (key, value) { win.localStorage.setItem(key, JSON.stringify(value)); },
    remove: function (key) { win.localStorage.removeItem(key); },
  };

  const now = function () {
    return env.performance && typeof env.performance.now === 'function' ? env.performance.now() : Date.now();
  };
  const requestFrame = env.requestAnimationFrame || (win && win.requestAnimationFrame) || canvas.requestAnimationFrame;
  const cancelFrame = env.cancelAnimationFrame || (win && win.cancelAnimationFrame) || canvas.cancelAnimationFrame;
  function createSurface() {
    // The first wx canvas is the screen; later canvases are independent surfaces.
    // Allocate only on demand, and never let a host reuse the visible canvas.
    try {
      const surface = api ? api.createCanvas() : doc && typeof doc.createElement === 'function' && doc.createElement('canvas');
      return surface && surface !== canvas ? surface : null;
    } catch (_) { return null; }
  }
  return {
    kind: api ? 'wechat' : 'browser', wx: api, canvas, createSurface, resize, onPointer, onKey, onResize, storage, setFrameRate,
    get reducedMotion() { return !!(reducedMotionQuery && reducedMotionQuery.matches); },
    effectsQuality: 'high',
    isDevelopment: isDevelopmentEnvironment(api, win && win.location),
    onMemoryWarning: function (listener) {
      if (!api || typeof api.onMemoryWarning !== 'function') return function () {};
      try { api.onMemoryWarning(listener); } catch (_) { return function () {}; }
      return function () { if (typeof api.offMemoryWarning === 'function') api.offMemoryWarning(listener); };
    },
    reduceMemory: function () {
      // The caller releases caches/audio; memory pressure never lowers image quality.
      if (api && typeof api.triggerGC === 'function') {
        try { api.triggerGC(); } catch (_) { /* GC timing belongs to the host. */ }
      }
      return Object.assign({}, dimensions);
    },
    onHide: function (listener) { return lifecycle('Hide', listener); },
    onShow: function (listener) { return lifecycle('Show', listener); },
    onAudioInterruptionBegin: function (listener) { return nativeListener('AudioInterruptionBegin', listener); },
    onAudioInterruptionEnd: function (listener) { return nativeListener('AudioInterruptionEnd', listener); },
    vibrate: function () {
      if (api && typeof api.vibrateShort === 'function') {
        try { api.vibrateShort({ type: 'light', fail: function () {} }); } catch (_) { /* Optional feedback. */ }
      }
    },
    now,
    raf: function (callback) {
      return requestFrame ? requestFrame.call(win || canvas, callback) : setTimeout(function () { callback(now()); }, 16);
    },
    cancelRaf: function (id) {
      if (cancelFrame) cancelFrame.call(win || canvas, id);
      else clearTimeout(id);
    },
  };
}

module.exports = { createPlatform };
