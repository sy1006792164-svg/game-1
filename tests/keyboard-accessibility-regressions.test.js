'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN } = require('../src/levels');
const { MOVE_MS } = require('../src/motion');

const mainPath = path.join(__dirname, '../src/main.js');
const source = fs.readFileSync(mainPath, 'utf8').replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
const actualRequire = createRequire(mainPath);
const factory = vm.runInThisContext('(function(require, module, exports) {\n' + source + '\n})', { filename: mainPath });

function harness() {
  let now = 1000;
  const noop = () => {}, callbacks = {}, saved = new Map();
  const context = new Proxy({ globalAlpha: 1 }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return text => ({ width: String(text).length * 7 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
    return noop;
  } });
  const metrics = { width: 390, height: 844, pixelRatio: 1, safeTop: 0, safeBottom: 0 };
  const platform = {
    kind: 'browser', canvas: { getContext: () => context },
    storage: { get: key => saved.get(key), set: (key, value) => saved.set(key, value), remove: key => saved.delete(key) },
    resize: () => metrics, now: () => now, raf: () => 1, cancelRaf: noop, vibrate: noop,
    onResize: noop, onPointer: noop, onKey: fn => { callbacks.key = fn; }, onHide: noop, onShow: noop,
    onAudioInterruptionBegin: noop, onAudioInterruptionEnd: noop,
  };
  const module = { exports: {} };
  factory(specifier => {
    if (specifier === './sound') return { createSound: () => ({ play: noop, stop: noop, release: noop, ambience: noop, unlock: noop, suspend: noop, resume: noop }) };
    if (specifier === './play-guide') return { ...actualRequire(specifier), autoGuide: () => false };
    if (specifier === './mechanic-guide') return { ...actualRequire(specifier), createMechanicGuide: () => null };
    return actualRequire(specifier);
  }, module, module.exports);
  const game = new module.exports.Game(platform);
  for (let frame = 0; game.page !== 'home' && frame < 200; frame++) { now += 100; game.loop(); }
  return { game, saved, key: callbacks.key,
    start() { game.start(CAMPAIGN[0], 'campaign'); now += 1000; game.loop(); },
    act(action) { now += MOVE_MS + 1; game.act(action); },
    draw(ms = 0) { now += ms; game.renderer.draw(game, now, metrics); },
    destroy() { game.ads.destroy(); game.sound.release(); },
  };
}

test('Enter returns from help to the paused route, then resumes without spending a turn', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  h.game.pause(); const pause = h.game.modal;
  h.game.help();
  h.game.pointer = h.game.renderer.pointer = { x: 195, y: 500 };
  h.key('Enter');
  assert.equal(h.game.modal, pause, 'the existing help close action must preserve the prior pause');
  assert.equal(h.game.pointer, null);
  assert.equal(h.game.renderer.pointer, null);
  assert.deepEqual(h.game.renderer.hits, []);
  h.key('Enter');
  assert.equal(h.game.modal, null);
  assert.deepEqual(h.game.actions, []);
  h.key('Enter');
  assert.deepEqual(h.game.actions, [], 'confirm never becomes a board wait');
});

test('Enter continues the completed route and restarts a failed route without a mouse', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  for (const action of h.game.level.solution) h.act(action);
  assert.equal(h.game.modal.kind, 'win');
  h.key('Enter');
  assert.equal(h.game.level.id, 1, 'an unseen result cannot consume an early confirmation');
  h.draw(399); h.key('Enter');
  assert.equal(h.game.level.id, 1, 'the final move must finish its presentation');
  h.draw(1);
  h.key('Enter');
  assert.equal(h.game.level.id, 2);
  assert.equal(h.game.modal, null);
  while (h.game.state.status === 'playing') h.act('wait');
  assert.equal(h.game.modal.kind, 'fail');
  h.draw(399); h.key('Enter');
  assert.equal(h.game.state.status, 'failed');
  h.draw(1);
  h.key('Enter');
  assert.equal(h.game.modal, null);
  assert.equal(h.game.state.status, 'playing');
  assert.equal(h.game.level.id, 2);
  assert.deepEqual(h.game.actions, []);
});

test('visible reduced-motion results accept Enter immediately and failure ads require explicit confirmation', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  h.game.platform.reducedMotion = true;
  for (const action of h.game.level.solution) h.act(action);
  h.draw(); h.key('Enter');
  assert.equal(h.game.level.id, 2);
  while (h.game.state.status === 'playing') h.act('wait');
  let requested = 0;
  h.game.platform.kind = 'wechat';
  h.game.ads.isConfigured = () => true;
  h.game.requestRevive = () => { requested++; };
  h.game.failure();
  assert.match(h.game.modal.buttons.find(button => button.primary).text, /看广告续灯/);
  h.key('Enter');
  assert.equal(requested, 0, 'an unseen ad choice is not activated');
  h.draw();
  for (const key of ['ArrowRight', 'ArrowDown', ' ', 'z', '1', 'Escape']) h.key(key);
  assert.equal(requested, 0, 'board and cancel keys cannot choose an ad');
  h.key('Enter');
  assert.equal(requested, 1);
});

test('Escape and Enter both preserve local data when closing the reset confirmation', t => {
  const h = harness(); t.after(() => h.destroy()); h.start(); h.act('right');
  h.game.openPage('settings');
  const before = JSON.stringify([...h.saved]);
  for (const key of ['Escape', 'Enter']) {
    h.game.resetPrompt();
    assert.equal(h.game.modal.kind, 'reset-confirm');
    h.key(key);
    assert.equal(h.game.modal, null);
    assert.equal(h.game.page, 'settings');
    assert.equal(JSON.stringify([...h.saved]), before, 'a keyboard dismissal cannot select the destructive action');
  }
});

test('Enter acknowledges an unavailable tool and modal movement keys stay isolated', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  h.key('1');
  assert.equal(h.game.modal.kind, 'item');
  assert.equal(h.game.modal.buttons.length, 1, 'an unavailable tool has only an acknowledgement');
  for (const key of ['ArrowRight', ' ', 'z', '2']) h.key(key);
  assert.deepEqual(h.game.actions, []);
  h.key('Enter');
  assert.equal(h.game.modal, null);
  assert.equal(h.game.selectedItem, null);
  assert.deepEqual(h.game.actions, []);
});

test('hidden and busy games cannot confirm a modal from the keyboard', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  h.game.pause(); const modal = h.game.modal;
  for (const flag of ['hidden', 'busy']) {
    h.game[flag] = true;
    h.key('Enter'); h.key('Escape');
    assert.equal(h.game.modal, modal);
    h.game[flag] = false;
  }
});
