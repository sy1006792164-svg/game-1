'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../../src/main.js');
const source = fs.readFileSync(filename, 'utf8').replace('new Game(createPlatform());', 'module.exports = { Game };');
const loaded = { exports: {} };
vm.runInNewContext(source, { module: loaded, exports: loaded.exports, require: createRequire(filename),
  console, setTimeout, clearTimeout, Promise, Date }, { filename });

function createHarness(options = {}) {
  const noop = () => {}, listeners = {}, data = new Map();
  let now = 10000;
  const ctx = new Proxy({ measureText: text => ({ width: String(text).length * 7 }), globalAlpha: 1,
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) },
  { get: (target, key) => key in target ? target[key] : noop });
  const canvas = options.canvas || { getContext: () => ctx };
  const metrics = options.metrics || { width: 390, height: 844, pixelRatio: 1, safeTop: 50, safeBottom: 34 };
  const platform = { kind: 'browser', isDevelopment: false, canvas,
    storage: { get: key => data.get(key), set: (key, value) => data.set(key, value), remove: key => data.delete(key) },
    resize: () => metrics, now: () => now, raf: () => 1, cancelRaf: noop, onResize: noop,
    onPointer: noop, onKey: fn => { listeners.key = fn; }, onHide: fn => { listeners.hide = fn; }, onShow: fn => { listeners.show = fn; },
    vibrate: noop, setFrameRate: noop, effectsQuality: 'low', reducedMotion: true };
  const game = new loaded.exports.Game(platform);
  game.page = 'home'; game.modal = null;
  game.store.setGuideDismissed(true);
  return { game, data, listeners, metrics, advance: (ms = 1000) => { now += ms; }, draw: () => game.renderer.draw(game, now, metrics) };
}

module.exports = { Game: loaded.exports.Game, createHarness };
