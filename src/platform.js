'use strict';

const { createPinchGesture } = require('./pointer-zoom');

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
  const win = env.window;
  const doc = env.document;
  const canvas = api ? api.createCanvas() : doc && doc.getElementById('game');
  if (api && typeof GameGlobal !== 'undefined') GameGlobal.canvas = canvas;
  if (!canvas) throw new Error('Game canvas is unavailable.');
  let dimensions = { width: 390, height: 844, pixelRatio: 1, safeTop: 0, safeBottom: 0 };
  let lowMemory = false;
  // This turn-based game does not need the native runtime's default 60 FPS.
  if (api && typeof api.setPreferredFramesPerSecond === 'function') {
    try { api.setPreferredFramesPerSecond(30); } catch (_) { /* The game loop also limits drawing. */ }
  }

  function resize() {
    let width, height, pixelRatio, safeTop = 0, safeBottom = 0;
    if (api) {
      let info = {};
      try {
        info = typeof api.getWindowInfo === 'function' ? api.getWindowInfo() : api.getSystemInfoSync();
      } catch (_) {
        try { info = api.getSystemInfoSync(); } catch (_) { /* Keep a usable default. */ }
      }
      width = positive(info.windowWidth, 390);
      height = positive(info.windowHeight, 844);
      pixelRatio = positive(info.pixelRatio, 1);
      safeTop = Math.max(0, Number(info.statusBarHeight) || 0, Number(info.safeArea && info.safeArea.top) || 0);
      if (info.safeArea && Number.isFinite(info.safeArea.bottom)) {
        safeBottom = Math.max(0, height - info.safeArea.bottom);
      }
      let hasCapsuleBounds = false;
      try {
        const capsule = api.getMenuButtonBoundingClientRect && api.getMenuButtonBoundingClientRect();
        if (capsule && Number.isFinite(capsule.bottom) && capsule.bottom > 0) {
          safeTop = Math.max(safeTop, capsule.bottom + 8);
          hasCapsuleBounds = true;
        }
      } catch (_) { /* Some older runtimes have no capsule geometry. */ }
      // Mini Game runtimes may omit the Mini Program capsule geometry API.
      // Reserve its navigation row below the status bar in that case.
      if (!hasCapsuleBounds) safeTop += 44 + 8;
    } else {
      const rect = canvas.getBoundingClientRect();
      width = positive(rect.width, positive(win && win.innerWidth, 390));
      height = positive(rect.height, positive(win && win.innerHeight, 844));
      pixelRatio = positive(win && win.devicePixelRatio, 1);
    }
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    // Bound the native backing texture, including large tablet/desktop windows.
    // Keep logical coordinates unchanged so touch and safe-area layout still match.
    pixelRatio = api ? Math.min(pixelRatio, lowMemory ? 1 : 2,
      Math.sqrt((lowMemory ? 1024 * 1024 : 2 * 1024 * 1024) / (width * height)),
      4096 / width, 4096 / height) : Math.min(3, pixelRatio);
    dimensions = {
      width, height, pixelRatio,
      safeTop: Math.min(height / 3, safeTop), safeBottom: Math.min(height / 3, safeBottom),
    };
    const backingWidth = Math.max(1, Math.floor(dimensions.width * pixelRatio));
    const backingHeight = Math.max(1, Math.floor(dimensions.height * pixelRatio));
    // Reassigning even the same size resets the context and reallocates native storage.
    // Shrink before growing so a window rotation cannot allocate a large intermediate texture.
    if (canvas.width > backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    return Object.assign({}, dimensions);
  }

  // Zoom receives canvas coordinates, a relative scale, and optional center motion.
  function onPointer(listener, onZoom) {
    if (typeof listener !== 'function') return function () {};
    let activeId = null;
    let last = null;
    let source = null;
    let lastNativeTouchAt = -Infinity;
    const removeListeners = [];
    const pinch = typeof onZoom === 'function' ? createPinchGesture(cancelPointer, onZoom) : null;

    function cancelPointer() {
      const point = last;
      const wasActive = source !== null;
      activeId = null; last = null; source = null;
      if (wasActive) listener(point ? point.x : 0, point ? point.y : 0, 'cancel');
    }
    function cancel() {
      if (pinch) pinch.reset();
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
      if (!pinch) return;
      listen(canvas, 'wheel', function (event) {
        if (pinch.isActive() || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
        const point = canvasPoint(event);
        if (!finitePoint(point)) return;
        if (event.preventDefault) event.preventDefault();
        cancel();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dimensions.height : 1;
        const exponent = Math.max(-0.35, Math.min(0.35, -event.deltaY * unit * 0.002));
        onZoom(point.x, point.y, Math.exp(exponent));
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
          if (pinch && pinch.touch(type, event)) { lastNativeTouchAt = now(); return; }
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

      let device = {};
      try { device = typeof api.getDeviceInfo === 'function' ? api.getDeviceInfo() : {}; } catch (_) { /* Older SDK. */ }
      if (!device || !device.platform) {
        try { device = typeof api.getSystemInfoSync === 'function' ? api.getSystemInfoSync() : {}; } catch (_) { /* Native touch remains available. */ }
      }
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
            if (source !== null || (pinch && pinch.isActive()) || now() - lastNativeTouchAt < 700) return;
            const point = canvasPoint(event);
            if (!finitePoint(point)) return;
            source = 'mouse'; activeId = 'mouse'; last = point;
          } else {
            if (source !== 'mouse') return;
            if (type === 'end' && event.button != null && event.button !== 0) return;
            if (type === 'move' && event.buttons === 0) { cancel(); return; }
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
        if (pinch && (event.pointerType === 'touch' || pinch.isActive())) {
          if (event.preventDefault) event.preventDefault();
          if (type === 'start' && canvas.setPointerCapture) {
            try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic pointer. */ }
          }
          if (pinch.pointer(type, event, point)) return;
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
        if (type === 'cancel') { if (finitePoint(point)) last = point; cancel(); return; }
        if (!finitePoint(point)) return;
        last = point;
        if (type === 'end') { activeId = null; last = null; source = null; }
        listener(point.x, point.y, type);
      });
    });
    listenWheel();
    listen(win, 'blur', cancel);
    listen(doc, 'visibilitychange', function () { if (doc.hidden) cancel(); });
    return cleanup;
  }

  function onKey(listener) {
    if (!win || typeof win.addEventListener !== 'function') return function () {};
    const handler = function (event) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (event.target && event.target.isContentEditable)) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].indexOf(event.key) !== -1) event.preventDefault();
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
    const handler = function () { listener(); };
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
  return {
    kind: api ? 'wechat' : 'browser', wx: api, canvas, resize, onPointer, onKey, onResize, storage,
    onMemoryWarning: function (listener) {
      if (!api || typeof api.onMemoryWarning !== 'function') return function () {};
      try { api.onMemoryWarning(listener); } catch (_) { return function () {}; }
      return function () { if (typeof api.offMemoryWarning === 'function') api.offMemoryWarning(listener); };
    },
    reduceMemory: function () {
      lowMemory = true;
      const metrics = resize();
      if (api && typeof api.triggerGC === 'function') {
        try { api.triggerGC(); } catch (_) { /* GC timing belongs to the host. */ }
      }
      return metrics;
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
