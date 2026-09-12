'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createFriendLeaderboard } = require('../src/friend-leaderboard');
const { leaderboardRect } = require('../src/leaderboard-view');

const tick = () => new Promise(resolve => setImmediate(resolve));
const mainPath = path.join(__dirname, '../src/main.js');
const actualRequire = createRequire(mainPath);
const source = fs.readFileSync(mainPath, 'utf8').replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
const factory = vm.runInThisContext('(function(require, module, exports) {\n' + source + '\n})', { filename: mainPath });

function harness(t) {
  const noop = () => {}, messages = [], callbacks = {}, frameRates = [], permissions = { 'scope.WxFriendInteraction': true };
  let now = 1000;
  const ctx = new Proxy({ globalAlpha: 1, measureText: value => ({ width: String(value).length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) },
  { get: (value, key) => key in value ? value[key] : noop });
  const shared = { canvas: { width: 1, height: 1 }, postMessage: value => messages.push(value) };
  const data = new Map();
  const metrics = { width: 320, height: 720, pixelRatio: 2, safeTop: 60, safeBottom: 24 };
  const platform = {
    kind: 'wechat', canvas: { getContext: () => ctx }, resize: () => metrics, now: () => now,
    raf: fn => { callbacks.frame = fn; return 1; }, cancelRaf: noop, setFrameRate: fps => frameRates.push(fps), vibrate: noop,
    storage: { get: key => data.get(key), set: (key, value) => data.set(key, value), remove: key => data.delete(key) },
    onPointer: (pointer, zoom, wheel) => Object.assign(callbacks, { pointer, zoom, wheel }),
    onKey: fn => { callbacks.key = fn; }, onResize: fn => { callbacks.resize = fn; },
    onHide: fn => { callbacks.hide = fn; }, onShow: fn => { callbacks.show = fn; },
    onMemoryWarning: fn => { callbacks.memory = fn; }, onAudioInterruptionBegin: noop, onAudioInterruptionEnd: noop,
    reduceMemory: () => metrics,
    wx: { requirePrivacyAuthorize: options => options.success(), getSetting: options => options.success({ authSetting: { ...permissions } }),
      authorize: options => options.success(), getOpenDataContext: () => shared },
  };
  const module = { exports: {} };
  factory(specifier => specifier === './sound' ? { createSound: () => ({ play: noop, stop: noop, release: noop, ambience: noop, unlock: noop, suspend: noop, resume: noop }) } : actualRequire(specifier), module, module.exports);
  const game = new module.exports.Game(platform);
  for (let frame = 0; game.page !== 'home' && frame < 200; frame++) { now += 100; game.loop(); }
  assert.equal(game.page, 'home', 'the real startup loop must automatically finish before ranking gesture tests');
  t.after(() => { game.home(); game.ads.destroy(); game.sound.release(); });
  const css = (x, y) => [x * game.renderer.scale + game.renderer.ox, y * game.renderer.scale + game.renderer.oy];
  return { game, messages, callbacks, permissions, frameRates, metrics, css,
    frame(ms = 16) { now += ms; game.loop(); },
    draw() { game.renderer.draw(game, now, metrics); },
    pointer(x, y, phase) { callbacks.pointer(...css(x, y), phase); },
    async enter() { game.openPage('leaderboard'); await tick(); game.renderer.draw(game, now, metrics); assert.equal(game.rankingInteractive(), true); },
  };
}

test('friend gesture bridge validates starts and permissions while allowing captured releases outside its canvas', async () => {
  const messages = []; let allowed = true;
  const board = createFriendLeaderboard({ kind: 'wechat', wx: { authorize: options => options.success(),
    getOpenDataContext: () => ({ canvas: { width: 1, height: 1 }, postMessage: value => messages.push(value) }) } }, {}, { canSync: () => allowed });
  assert.equal(board.pointer('start', 20, 20, 100), false);
  await board.open({ width: 354, height: 470 }); messages.length = 0;
  for (const args of [['start', -1, 20, 0], ['start', 355, 20, 0], ['start', 1, 471, 0], ['start', NaN, 1, 0], ['start', 1, 1, Infinity], ['move', 1, 1, 0], ['end', 1, 1, 0]])
    assert.equal(board.pointer(...args), false);
  assert.equal(board.pointer('start', 20, 200, 100), true);
  assert.equal(board.pointer('move', 20, -100, 130), true);
  assert.equal(board.pointer('end', -5, -200, 160), true);
  assert.deepEqual(messages.map(value => value.phase), ['start', 'move', 'end']);
  for (const message of messages) assert.deepEqual(Object.keys(message).sort(), ['action', 'channel', 'key', 'phase', 'time', 'x', 'y']);
  assert.equal(board.pointer('end', 1, 1, 200), false, 'a release is delivered once');
  board.pointer('start', 1, 1, 200); allowed = false;
  const count = messages.length;
  assert.equal(board.pointer('move', 1, 40, 210), false);
  assert.equal(board.wheel(120, 220), false); assert.equal(board.scroll('end', 230), false);
  assert.equal(messages.length, count, 'a closed privacy gate prevents input traffic');
  allowed = true; assert.equal(board.pointer('end', 1, 40, 240), false);
  board.close(); assert.equal(board.wheel(120, 250), false);
});

test('cached ranking preview accepts visual gestures while cloud access waits for the permission recheck', async () => {
  const messages = []; let allowed = true, display = true, authorizations = 0;
  const board = createFriendLeaderboard({ kind: 'wechat', wx: { authorize: options => { authorizations++; options.success(); },
    getOpenDataContext: () => ({ canvas: { width: 1, height: 1 }, postMessage: value => messages.push(value) }) } }, {},
  { canSync: () => allowed, canPreview: () => display });
  assert.equal(board.preview(), false, 'a cold entry cannot invent a cached surface');
  await board.open({ width: 354, height: 470 }); board.close();
  assert.equal(messages.at(-1).action, 'hide'); allowed = false; messages.length = 0;
  assert.equal(board.preview(), true); assert.equal(board.getState().status, 'preview');
  assert.equal(board.pointer('start', 20, 200, 100), true);
  assert.equal(board.pointer('move', 20, 80, 130), true); assert.equal(board.pointer('end', 20, 80, 140), true);
  assert.equal(board.wheel(120, 160), true); assert.equal(board.scroll('end', 180), true);
  assert.equal(board.refresh(), false); assert.equal(board.retry(), false);
  assert.deepEqual(messages.map(value => value.action), ['preview', 'pointer', 'pointer', 'pointer', 'wheel', 'scroll']);
  assert.equal(authorizations, 1, 'cache inspection cannot reauthorize or read friend data');
  display = false; const before = messages.length;
  assert.equal(board.pointer('start', 20, 200, 200), false); assert.equal(board.wheel(120, 220), false);
  assert.equal(messages.length, before, 'confirmed revocation disables the cached gesture surface too');
  board.revalidate({ 'scope.WxFriendInteraction': false }); assert.equal(messages.at(-1).action, 'close');
  assert.equal(board.preview(), false); board.close();
});

test('ranking gestures use logical shared-canvas coordinates and never turn dragging into a host or duplicate tap', async t => {
  const h = harness(t); await h.enter(); h.messages.length = 0;
  const box = leaderboardRect(h.game.renderer.H);
  let accidental = 0;
  h.game.renderer.hit(0, 0, 390, h.game.renderer.H, () => accidental++);
  h.pointer(box.x + 80, box.y + 250, 'start');
  h.pointer(box.x + 80, box.y - 30, 'move');
  h.pointer(box.x + 80, box.y - 40, 'end');
  const gesture = h.messages.filter(value => value.action === 'pointer');
  assert.deepEqual(gesture.map(value => value.phase), ['start', 'move', 'end']);
  for (const [index, y] of [250, -30, -40].entries()) {
    assert.ok(Math.abs(gesture[index].x - 80) < 1e-9);
    assert.ok(Math.abs(gesture[index].y - y) < 1e-9);
  }
  assert.equal(accidental, 0); assert.equal(h.game.pointer, null);
  h.messages.length = 0;
  h.pointer(box.x + 40, box.y + 40, 'start'); h.pointer(box.x + 40, box.y + 40, 'end');
  assert.deepEqual(h.messages.map(value => value.phase), ['start', 'end'], 'the child recognizes the only tap');
  assert.equal(accidental, 0); assert.equal(h.messages.some(value => value.action === 'tap'), false);
  h.messages.length = 0;
  h.pointer(box.x - 10, box.y + 250, 'start'); h.pointer(box.x + 80, box.y + 250, 'move'); h.pointer(box.x + 80, box.y + 250, 'end');
  assert.equal(h.messages.length, 0, 'a gesture beginning outside cannot acquire the child surface');
});

test('Tab takes over a held ranking gesture without leaving a stale child release', async t => {
  const h = harness(t); await h.enter();
  const box = leaderboardRect(h.game.renderer.H);
  h.pointer(box.x + 40, box.y + 100, 'start');
  assert.ok(h.game.pointer && h.game.pointer.ranking);
  h.messages.length = 0;
  h.callbacks.key('Tab');
  assert.equal(h.game.pointer, null);
  assert.deepEqual(h.messages.filter(message => message.action === 'pointer').map(message => message.phase), ['cancel']);
  h.pointer(box.x + 40, box.y + 100, 'end');
  assert.equal(h.messages.some(message => message.phase === 'end'), false);
});

test('ranking wheel and keyboard scroll use the isolated bridge and leave the game camera unchanged', async t => {
  const h = harness(t); await h.enter(); const box = leaderboardRect(h.game.renderer.H);
  const before = JSON.stringify(h.game.camera); h.messages.length = 0;
  assert.equal(h.callbacks.wheel(...h.css(box.x + 30, box.y + 220), 120 * h.game.renderer.scale), true);
  assert.ok(Math.abs(h.messages.find(value => value.action === 'wheel').delta - 120) < 1e-9);
  assert.equal(h.callbacks.wheel(...h.css(10, 10), 120), false);
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Home', 'End']) h.callbacks.key(key);
  assert.deepEqual(h.messages.filter(value => value.action === 'wheel').map(value => Math.round(value.delta)), [120, -100, 100, -340, 340, 340]);
  assert.deepEqual(h.messages.filter(value => value.action === 'scroll').map(value => value.edge), ['start', 'end']);
  assert.equal(JSON.stringify(h.game.camera), before);
  h.game.help(); h.messages.length = 0;
  h.callbacks.key('ArrowDown'); assert.equal(h.callbacks.wheel(...h.css(box.x + 30, box.y + 220), 120), false);
  assert.equal(h.messages.length, 0, 'modal content cannot scroll the ranking beneath it');
});

test('continuous wheel input retains child targets while switching from a drag cancels that finger only once', async t => {
  const h = harness(t); await h.enter(); const box = leaderboardRect(h.game.renderer.H);
  const wheel = () => h.callbacks.wheel(...h.css(box.x + 40, box.y + 220), 8 * h.game.renderer.scale);
  h.messages.length = 0;
  for (let index = 0; index < 25; index++) wheel();
  assert.equal(h.messages.length, 25);
  assert.ok(h.messages.every(value => value.action === 'wheel' && Math.abs(value.delta - 8) < 1e-9),
    'no idle pointer cancellation can clear the child accumulated wheel target');
  h.messages.length = 0;
  for (const key of ['ArrowDown', 'ArrowDown', 'PageDown', 'Home', 'End']) h.callbacks.key(key);
  assert.deepEqual(h.messages.map(value => value.action), ['wheel', 'wheel', 'wheel', 'scroll', 'scroll']);
  for (const input of [wheel, () => h.callbacks.key('ArrowDown'), () => h.callbacks.key('End')]) {
    h.pointer(box.x + 40, box.y + 220, 'start'); h.pointer(box.x + 40, box.y + 170, 'move');
    h.messages.length = 0; input(); input();
    assert.equal(h.messages[0].action, 'pointer'); assert.equal(h.messages[0].phase, 'cancel');
    assert.equal(h.messages.filter(value => value.action === 'pointer').length, 1);
    assert.equal(h.game.pointer, null);
    h.pointer(box.x + 40, box.y + 170, 'end');
    assert.equal(h.messages.some(value => value.phase === 'end' || value.action === 'tap'), false,
      'the superseded finger cannot release a stale tap');
  }
});

test('resize, pinch, modal, navigation and hide cancel a ranking gesture before any stale release can act', async t => {
  for (const interrupt of ['resize', 'pinch', 'modal', 'navigate', 'hide', 'memory']) {
    const h = harness(t); await h.enter(); const box = leaderboardRect(h.game.renderer.H);
    h.pointer(box.x + 60, box.y + 230, 'start'); h.messages.length = 0;
    if (interrupt === 'resize') h.callbacks.resize();
    if (interrupt === 'pinch') h.pointer(100, 300, 'cancel');
    if (interrupt === 'modal') h.game.help();
    if (interrupt === 'navigate') h.game.home();
    if (interrupt === 'hide') h.callbacks.hide();
    if (interrupt === 'memory') h.callbacks.memory();
    assert.ok(h.messages.some(value => value.action === 'pointer' && value.phase === 'cancel'), interrupt);
    assert.equal(h.game.pointer, null, interrupt);
    const count = h.messages.filter(value => value.phase === 'end').length;
    h.pointer(box.x + 60, box.y + 230, 'end');
    assert.equal(h.messages.filter(value => value.phase === 'end').length, count, interrupt);
    if (interrupt === 'hide') {
      assert.ok(h.messages.some(value => value.action === 'suspend'));
      assert.equal(h.messages.some(value => ['refresh', 'open', 'retry'].includes(value.action)), false, 'backgrounding never reads friend data');
      h.callbacks.show(); await tick();
      assert.equal(h.messages.filter(value => value.action === 'refresh').length, 1, 'foreground permission validation triggers one automatic update');
    }
  }
});

test('each real ranking entry opens automatically once and shares every native frame until leaving', async t => {
  const h = harness(t); await h.enter();
  assert.equal(h.messages.filter(value => value.action === 'open').length, 1);
  let draws = 0; const originalDraw = h.game.renderer.draw.bind(h.game.renderer);
  h.game.renderer.draw = (...args) => { draws++; return originalDraw(...args); };
  for (const ms of [8, 16, 17, 10]) h.frame(ms);
  assert.equal(draws, 4); assert.equal(h.frameRates.at(-1), 60);
  assert.equal(h.messages.filter(value => value.action === 'open').length, 1, 'rendering does not reopen or reread rankings');
  h.game.home(); h.frame();
  assert.equal(h.game.rankingInteractive(), false, 'leaving stops the friend gesture bridge immediately');
  assert.equal(h.frameRates.at(-1), 60, 'home gets its own short entrance');
  h.frame(300); assert.equal(h.frameRates.at(-1), 30);
  await h.enter(); assert.equal(h.messages.filter(value => value.action === 'open').length, 2);
  h.game.help(); h.frame();
  assert.equal(h.game.rankingInteractive(), false, 'a dialog owns input while its entrance animates');
  assert.equal(h.frameRates.at(-1), 60);
  h.frame(300); assert.equal(h.frameRates.at(-1), 30);
});
