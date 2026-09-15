'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN } = require('../src/levels');
const { MOVE_MS } = require('../src/motion');
const { ART_SIZE } = require('../src/art-assets');

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
    createImage: () => ({ width: ART_SIZE, height: ART_SIZE, set src(value) { this.onload(); } }),
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
    start(level = CAMPAIGN[0]) { game.start(level, 'campaign'); now += 1000; game.loop(); },
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
  const settled = JSON.stringify(h.game.profile());
  h.draw(399);
  h.key('Enter');
  assert.equal(h.game.level.id, 1, 'the final move still owns input before presentation controls are available');
  h.draw(1);
  assert.ok(h.game.renderer.hits.some(hit => hit.action === h.game.renderer.deliveryPresentation.skip));
  h.key('Enter');
  assert.equal(h.game.level.id, 1, 'skipping the delivery opens its receipt, never the next route');
  assert.equal(JSON.stringify(h.game.profile()), settled, 'skipping cannot award the delivery twice');
  h.key('Enter');
  assert.equal(h.game.level.id, 1, 'a second key cannot activate receipt buttons before they are drawn');
  h.draw();
  const primary = h.game.modal.buttons.find(button => button.primary);
  assert.ok(h.game.renderer.hits.some(hit => hit.action === primary.action));
  h.key('Enter');
  assert.equal(h.game.level.id, 2);
  assert.equal(h.game.modal, null);
  for (let used = 0, limit = h.game.undoLimit(); used < limit; used++) {
    h.act('wait'); h.game.undo();
  }
  assert.equal(h.game.undoLeft(), 0, 'legal attempts exhaust rewinds before testing the free restart');
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

test('Escape only skips a visible delivery and keyboard focus cannot activate stale presentation actions', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  for (const action of h.game.level.solution) h.act(action);
  const modal = h.game.modal, settled = JSON.stringify(h.game.profile());
  h.key('Escape');
  assert.equal(h.game.modal, modal);
  assert.equal(h.game.renderer.deliveryPresentation, undefined);
  h.draw(400);
  const { focusedTarget } = require('../src/keyboard-focus');
  h.key('Tab');
  assert.equal(focusedTarget(h.game).label, '查看回执');
  h.key('Escape');
  assert.equal(h.game.modal, modal);
  assert.equal(h.game.level.id, 1);
  assert.deepEqual(h.game.renderer.hits, []);
  h.key('Escape');
  assert.equal(h.game.level.id, 1);
  h.draw();
  assert.equal(h.game.renderer.deliveryPresentation, null);
  assert.equal(JSON.stringify(h.game.profile()), settled);
  h.key('Enter');
  assert.equal(h.game.level.id, 2);
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
  assert.match(h.game.modal.buttons.find(button => button.primary).text, /撤回上一步/);
  while (h.game.undoLeft() > 0) {
    const actions = h.game.actions.length;
    h.draw(); h.key('Enter');
    assert.equal(h.game.state.status, 'playing');
    assert.equal(h.game.actions.length, actions - 1, 'the primary recovery really rewinds one action');
    assert.equal(requested, 0, 'available free rewinds never request an ad');
    while (h.game.state.status === 'playing') h.act('wait');
  }
  assert.equal(h.game.state.inventory.oil, 0, 'the ad fixture has no stored oil');
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

test('Escape cancels a pause restart without changing the route, held supplies or saved progress', t => {
  const h = harness(); t.after(() => h.destroy()); h.start(CAMPAIGN[3]);
  for (const action of h.game.level.solution.slice(0, 4)) h.act(action);
  assert.equal(h.game.state.inventory.oil, 1, 'the actual route station supplies the held oil');
  h.game.pause();
  const pause = h.game.modal, state = h.game.state;
  const before = JSON.stringify({ state, actions: h.game.actions, rewards: h.game.itemRewards,
    run: h.game.store.loadRun(), profile: h.game.profile(), saved: [...h.saved] });
  pause.buttons.find(button => button.text === '重新开始').action();
  assert.equal(h.game.modal.kind, 'restart-confirm');
  assert.equal(h.game.state, state, 'opening the confirmation never replaces the running state');
  assert.match(h.game.modal.lines.join(''), /本次路线和随身道具将重置/);
  h.draw();
  h.game.pointer = h.game.renderer.pointer = { x: 195, y: 500 };
  h.key('Escape');
  assert.equal(h.game.modal, pause, 'cancel returns to the original pause menu');
  assert.equal(h.game.pointer, null);
  assert.equal(h.game.renderer.pointer, null);
  assert.deepEqual(h.game.renderer.hits, []);
  assert.equal(JSON.stringify({ state: h.game.state, actions: h.game.actions, rewards: h.game.itemRewards,
    run: h.game.store.loadRun(), profile: h.game.profile(), saved: [...h.saved] }), before);
});

test('Enter confirms a pause restart, resets this route and keeps earned stars and stamps', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  for (const action of h.game.level.solution) h.act(action);
  const profile = JSON.stringify(h.game.profile()), album = JSON.stringify(h.game.album());
  assert.ok(h.game.profile().completed['1']);
  h.start(CAMPAIGN[3]);
  for (const action of h.game.level.solution.slice(0, 4)) h.act(action);
  assert.equal(h.game.state.inventory.oil, 1);
  h.game.pause();
  h.game.modal.buttons.find(button => button.text === '重新开始').action();
  assert.equal(h.game.modal.kind, 'restart-confirm');
  h.draw(); h.key('Enter');
  assert.equal(h.game.modal, null);
  assert.equal(h.game.page, 'game');
  assert.equal(h.game.level.id, 4);
  assert.equal(h.game.state.status, 'playing');
  assert.equal(h.game.state.turn, 0);
  assert.equal(h.game.state.inventory.oil, 0);
  assert.equal(h.game.undosUsed, 0);
  assert.deepEqual(h.game.actions, []);
  assert.deepEqual(h.game.store.loadRun().actions, []);
  assert.equal(JSON.stringify(h.game.profile()), profile);
  assert.equal(JSON.stringify(h.game.album()), album);
});

test('an untouched route restarts directly but a route rewound to its start still asks first', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  const session = h.game.session;
  h.game.pause();
  h.game.modal.buttons.find(button => button.text === '重新开始').action();
  assert.equal(h.game.modal, null, 'an untouched route does not need another confirmation');
  assert.equal(h.game.session, session + 1, 'the blank route really restarts');
  assert.equal(h.game.state.turn, 0);
  assert.deepEqual(h.game.actions, []);
  h.act('right'); h.game.undo();
  assert.equal(h.game.state.turn, 0);
  assert.deepEqual(h.game.actions, []);
  assert.equal(h.game.undosUsed, 1);
  h.game.pause();
  h.game.modal.buttons.find(button => button.text === '重新开始').action();
  assert.equal(h.game.modal.kind, 'restart-confirm', 'rewind usage is progress even with no remaining actions');
  h.key('Escape');
  assert.equal(h.game.undosUsed, 1);
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

test('Tab starts a route from home and Shift+Tab leaves the canvas at its boundary', t => {
  const h = harness(); t.after(() => h.destroy()); h.draw(1000);
  const { focusedTarget } = require('../src/keyboard-focus');
  assert.equal(h.key('Tab'), true);
  assert.ok(focusedTarget(h.game), 'a visible control is selected');
  assert.equal(h.key('Shift+Tab'), false, 'the browser can move focus out of the game');
  assert.equal(h.game.keyboardFocus, null);
  for (let i = 0; i < 20; i++) {
    h.key('Tab');
    const target = focusedTarget(h.game);
    if (target && /送信/.test(target.label)) break;
  }
  assert.match(focusedTarget(h.game).label, /送信/);
  h.draw();
  h.key('Enter');
  assert.equal(h.game.page, 'game');
  assert.equal(h.game.level.id, 1);
  assert.deepEqual(h.game.actions, []);
});

test('keyboard focus selects a secondary pause action and never activates stale page controls', t => {
  const h = harness(); t.after(() => h.destroy()); h.start(); h.act('right');
  h.game.pause(); h.draw();
  const { focusedTarget } = require('../src/keyboard-focus');
  for (let i = 0; i < 12; i++) {
    h.key('Tab');
    if (focusedTarget(h.game).label === '玩法说明') break;
  }
  assert.equal(focusedTarget(h.game).label, '玩法说明');
  h.draw(); h.key('Enter');
  assert.equal(h.game.modal.kind, 'help');
  assert.equal(h.game.actions.length, 1);
  h.draw(); h.key('Tab');
  h.game.home();
  h.key('Enter');
  assert.equal(h.game.page, 'home');
  assert.equal(h.game.modal, null);
});

test('Tab selects only legal item cells once and Enter uses the selected target', t => {
  const h = harness(); t.after(() => h.destroy());
  const { focusTargets, focusedTarget } = require('../src/keyboard-focus');
  const { createState } = require('../src/engine');
  const { itemOffer } = require('../src/items');
  h.game.start(CAMPAIGN[6]);
  h.game.itemRewards = { kite: 1 };
  h.game.state = createState(h.game.level, h.game.itemRewards);
  for (const action of h.game.level.solution.slice(0, 6)) h.act(action);
  h.draw(1000); h.game.selectedItem = 'kite'; h.draw();
  const cells = focusTargets(h.game).filter(hit => Number.isInteger(hit.cell));
  const offered = itemOffer(h.game.level, h.game.state, 'kite').targets;
  assert.ok(cells.length > 0);
  assert.equal(new Set(cells.map(hit => hit.cell)).size, cells.length);
  assert.ok(cells.every(hit => offered.includes(hit.cell)));
  for (let i = 0; i < 40; i++) {
    h.key('Tab');
    if (Number.isInteger(focusedTarget(h.game).cell)) break;
  }
  const target = focusedTarget(h.game).cell;
  assert.ok(Number.isInteger(target));
  const player = h.game.state.player, turn = h.game.state.turn;
  h.draw(); h.key('Enter');
  assert.equal(h.game.state.player, player);
  assert.equal(h.game.state.letters.includes(target), false);
  assert.equal(h.game.selectedItem, null);
  assert.equal(h.game.state.inventory.kite, 0);
  assert.equal(h.game.state.turn, turn, 'aiming and using a tool do not spend a turn');
});

test('pointer input cancels keyboard focus before changing controls', t => {
  const h = harness(); t.after(() => h.destroy()); h.draw(1000);
  h.key('Tab'); assert.ok(h.game.keyboardFocus);
  h.game.pointerEvent(5, 5, 'start');
  assert.equal(h.game.keyboardFocus, null);
  h.game.pointerEvent(5, 5, 'cancel');
});

test('Tab ends a held list gesture and stops scrolling before retaining a row focus', t => {
  const h = harness(); t.after(() => h.destroy()); h.game.openPage('collection'); h.draw(1000);
  const rect = h.game.renderer.collectionRect;
  h.game.pointerEvent(rect.x + 30, rect.y + 30, 'start');
  assert.equal(h.game.collectionScroll.touching, true);
  h.key('Tab'); h.game.pointerEvent(rect.x + 30, rect.y + 30, 'end');
  assert.equal(h.game.collectionScroll.touching, false);
  h.key('PageDown'); h.draw(40);
  assert.notEqual(h.game.collectionScroll.wheelTarget, null);
  const { focusedTarget } = require('../src/keyboard-focus');
  for (let i = 0; i < 30; i++) {
    h.key('Tab');
    const target = focusedTarget(h.game);
    if (target && target.y > rect.y && target.h > 80) break;
  }
  const selected = focusedTarget(h.game);
  assert.ok(selected && selected.h > 80, 'a visible stamp card can be reached');
  h.draw(100);
  assert.equal(h.game.collectionScroll.wheelTarget, null);
  assert.equal(focusedTarget(h.game).key, selected.key, 'the selected card stays in place');
});

test('a stamp keeps keyboard focus through its first entrance frames', t => {
  const h = harness(); t.after(() => h.destroy());
  const { focusedTarget } = require('../src/keyboard-focus');
  h.game.openPage('collection'); h.draw();
  for (let i = 0; i < 30; i++) {
    h.key('Tab');
    const target = focusedTarget(h.game);
    if (target && target.key.startsWith('stamp:')) break;
  }
  const selected = focusedTarget(h.game);
  assert.ok(selected && selected.key.startsWith('stamp:'));
  h.draw(16);
  assert.equal(focusedTarget(h.game).key, selected.key);
  h.draw(300);
  assert.equal(focusedTarget(h.game).key, selected.key);
  h.key('Enter');
  assert.equal(h.game.modal.kind, 'stamp-detail');
});
