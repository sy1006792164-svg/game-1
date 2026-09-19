'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../src/platform');
const { handleGameKey } = require('../src/keyboard-input');

function keyboardHarness(listener) {
  const handlers = new Map();
  const canvas = { tagName: 'CANVAS' };
  const platform = createPlatform({
    window: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      removeEventListener: (name, handler) => { if (handlers.get(name) === handler) handlers.delete(name); }
    },
    document: { getElementById: () => canvas }
  });
  const cleanup = platform.onKey(listener);
  const send = (key, options = {}, type = 'keydown') => {
    const event = { key, target: canvas, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...options };
    const handler = handlers.get(type);
    if (handler) handler(event);
    return event;
  };
  return { canvas, send, cleanup, handlers };
}

test('held game keys never spend extra turns or scroll the browser', () => {
  const keys = [], harness = keyboardHarness(key => { keys.push(key); return true; });
  for (const key of ['ArrowDown', ' ', 'Backspace', 'Enter']) {
    assert.equal(harness.send(key).defaultPrevented, true, key + ' initial press is owned by the game');
    assert.equal(harness.send(key, { repeat: true }).defaultPrevented, true, key + ' repeated default is blocked');
    harness.send(key, {}, 'keyup');
  }
  assert.deepEqual(keys, ['ArrowDown', ' ', 'Backspace', 'Enter']);
});

test('unhandled keys and focused native controls keep their browser behavior', () => {
  const keys = [], harness = keyboardHarness(key => { keys.push(key); return false; });
  assert.equal(harness.send('ArrowDown').defaultPrevented, false);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY']) {
    assert.equal(harness.send('Enter', { target: { tagName } }).defaultPrevented, false);
  }
  assert.deepEqual(keys, ['ArrowDown']);
});

test('focus loss releases held key ownership and cleanup removes listeners', () => {
  const harness = keyboardHarness(() => true);
  harness.send('ArrowDown');
  const blur = harness.handlers.get('blur');
  if (blur) blur({});
  assert.equal(harness.send('ArrowDown', { repeat: true }).defaultPrevented, false);
  harness.cleanup();
  assert.equal(harness.handlers.size, 0);
});

test('composition and modified shortcuts never trigger game actions', () => {
  const keys = [], harness = keyboardHarness(key => { keys.push(key); return true; });
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    assert.equal(harness.send('z', options).defaultPrevented, false);
  }
  assert.deepEqual(keys, []);
});

function failedGame({ painted = true, undo = true, disabled = false } = {}) {
  const calls = [];
  const rewind = { icon: 'undo', primary: true, disabled, action: () => calls.push('undo') };
  const restart = { icon: 'restart', primary: !undo, action: () => calls.push('restart') };
  const modal = { kind: 'fail', buttons: undo ? [rewind, restart] : [restart] };
  const game = {
    page: 'game', modal, state: {}, session: 1, selectedItem: null,
    startupActive: () => false, unlockAudio() {}, syncMusic() {},
    renderer: { currentModal: painted ? modal : null, hits: painted ? [{ action: undo ? rewind.action : restart.action }] : [] },
    pointer: { held: true }, keyboardFocus: null
  };
  return { game, calls };
}

test('Z and Backspace recover a failed turn through its visible undo action', () => {
  for (const key of ['z', 'Z', 'Backspace']) {
    const { game, calls } = failedGame();
    assert.equal(handleGameKey(game, key), true);
    assert.deepEqual(calls, ['undo']);
    assert.equal(game.pointer, null);
    assert.deepEqual(game.renderer.hits, []);
  }
});

test('failure shortcuts wait for presentation and never substitute restart for unavailable undo', () => {
  for (const options of [{ painted: false }, { undo: false }, { disabled: true }]) {
    const { game, calls } = failedGame(options);
    assert.equal(handleGameKey(game, 'z'), true);
    assert.deepEqual(calls, []);
  }
});

test('reward recovery dialogs accept Enter only after their action is visible and enabled', () => {
  for (const kind of ['item-reward-recovery', 'revive-recovery']) {
    for (const options of [{}, { painted: false }, { disabled: true }]) {
      const { game, calls } = failedGame(options);
      game.modal.kind = kind;
      assert.equal(handleGameKey(game, 'Enter'), true);
      assert.deepEqual(calls, options.painted === false || options.disabled ? [] : ['undo'], kind);
    }
  }
});
