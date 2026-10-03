'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the untouched native game.js entry with an in-memory WeChat-shaped
// host. No browser, account, real SDK or real-device result is implied.
test('native WeChat entry boots and handles hide/show without a browser adapter', async () => {
  const root = path.resolve(__dirname, '..'), modules = new Map(), storage = new Map(), events = {};
  const texts = [], frames = new Map(); let time = 0, nextFrame = 0;
  const noop = () => {};
  const ctx = new Proxy({ globalAlpha: 1, measureText: text => ({ width: String(text).length * 7 }),
    fillText: text => texts.push(String(text)),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) },
  { get: (target, key) => key in target ? target[key] : noop });
  const screen = { width: 390, height: 844, getContext: () => ctx };
  const wx = { createCanvas: () => screen,
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }),
    getDeviceInfo: () => ({ platform: 'ios' }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key), setPreferredFramesPerSecond: noop,
    createImage: () => ({ width: 1254, height: 1254, set src(value) { Promise.resolve().then(() => this.onload()); } }) };
  for (const name of ['Hide', 'Show', 'WindowResize', 'TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel'])
    wx['on' + name] = fn => { events[name] = fn; };
  const context = vm.createContext({ wx, GameGlobal: {}, console, setTimeout, clearTimeout,
    performance: { now: () => time }, requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id) });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const localRequire = name => {
      assert.ok(name.startsWith('.'), 'native entry must not need npm or browser dependencies');
      const target = path.resolve(path.dirname(file), name.endsWith('.js') ? name : name + '.js');
      assert.ok(target.startsWith(root + path.sep)); return load(target);
    };
    vm.runInContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', context, { filename: file })
      (localRequire, module, module.exports);
    return module.exports;
  }
  load(path.join(root, 'game.js'));
  assert.equal(context.GameGlobal.canvas, screen);
  for (let index = 0; index < 45; index++) {
    time += 100; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time));
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
  }
  assert.ok(texts.includes('开始送信'), 'startup must reach the actual home page');
  assert.ok(events.TouchStart && events.TouchEnd, 'native touch listeners must be registered');
  events.Hide(); assert.equal(frames.size, 0, 'hidden games stop rendering');
  events.Show(); assert.ok(frames.size > 0, 'show resumes the native frame loop');
  events.Hide();
});
