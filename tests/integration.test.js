'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN, getDaily } = require('../src/levels');
const { RUN_KEY, PROFILE_KEY } = require('../src/storage');

const mainPath = path.join(__dirname, '../src/main.js');
const source = fs.readFileSync(mainPath, 'utf8');
const withoutBootstrap = source.replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
assert.notEqual(source, withoutBootstrap, 'Test must load Game without bootstrapping a native canvas');
const factory = vm.runInThisContext('(function(require, module, exports, Date) {\n' + withoutBootstrap + '\n})', { filename: mainPath });
const actualRequire = createRequire(mainPath);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function canvasMock() {
  const calls = [];
  const properties = { globalAlpha: 1, font: '12px sans-serif', textAlign: 'left' };
  const context = new Proxy(properties, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 11 });
      return (...args) => {
        for (const argument of args) if (typeof argument === 'number') assert.ok(Number.isFinite(argument), `Canvas ${String(key)} received ${argument}`);
        calls.push({ method: key, args, font: target.font, align: target.textAlign });
      };
    }
  });
  return { canvas: { getContext: () => context }, calls };
}

function harness(options = {}) {
  const data = options.data || new Map();
  const clock = options.clock || { date: '2026-09-07' };
  const callbacks = {};
  const { canvas, calls } = canvasMock();
  const closeListeners = new Set(); const errorListeners = new Set();
  let now = 1000; let frame = 0; let showCount = 0;
  const ad = {
    show: () => { showCount++; return Promise.resolve(); }, load: () => Promise.resolve(),
    onClose: handler => closeListeners.add(handler), offClose: handler => closeListeners.delete(handler),
    onError: handler => errorListeners.add(handler), offError: handler => errorListeners.delete(handler)
  };
  const metrics = options.metrics || { width: 390, height: 844, pixelRatio: 2, safeTop: 50, safeBottom: 34 };
  const platform = {
    kind: options.kind || 'wechat', wx: { createRewardedVideoAd: () => ad }, canvas,
    storage: { get: key => clone(data.get(key)), set: (key, value) => data.set(key, clone(value)), remove: key => data.delete(key) },
    resize: () => metrics, now: () => now, raf: () => ++frame, cancelRaf: () => {}, vibrate: () => {},
    onResize: handler => { callbacks.resize = handler; }, onPointer: handler => { callbacks.pointer = handler; },
    onKey: handler => { callbacks.key = handler; }, onHide: handler => { callbacks.hide = handler; }, onShow: handler => { callbacks.show = handler; }
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.date + 'T12:00:00'])); }
  }
  const module = { exports: {} };
  factory(specifier => {
    if (specifier === './sound') return { createSound: () => ({ play() {}, stop() {} }) };
    if (specifier === './config') return { REWARDED_AD_UNIT_ID: options.configured === false ? '' : 'adunit-integrationtest' };
    return actualRequire(specifier);
  }, module, module.exports, ClockDate);
  const game = new module.exports.Game(platform);
  function draw() { calls.length = 0; now += 200; game.renderer.draw(game, now, metrics); }
  return {
    game, data, clock, calls, callbacks, platform, draw,
    get showCount() { return showCount; },
    act(action) { now += 200; game.act(action); },
    start(level = CAMPAIGN[0], mode = 'campaign') { game.start(level, mode); if (game.modal && game.modal.kind === 'help') game.modal.buttons[0].action(); },
    closeAd(ended) { Array.from(closeListeners).forEach(handler => handler({ isEnded: ended })); },
    destroy() { game.ads.destroy(); }
  };
}

test('a complete first delivery records three stars, unlocks the next level and clears its run', () => {
  const h = harness(); h.start();
  h.act('up');
  assert.equal(h.game.state.turn, 0, 'a blocked tap must not enter the saved route');
  for (const action of CAMPAIGN[0].solution) h.act(action);
  assert.equal(h.game.state.status, 'won');
  assert.equal(h.game.modal.kind, 'win');
  assert.equal(h.game.profile().completed['1'].stars, 3);
  assert.equal(h.game.unlocked(1), true);
  assert.equal(h.game.store.loadRun(), null);
  assert.equal(h.data.has(RUN_KEY), false);
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.starCount(), 3);
  assert.equal(reloaded.game.nextLevel().id, 2);
  h.destroy(); reloaded.destroy();
});

test('closing and relaunching reconstructs the exact active puzzle from saved actions', () => {
  const h = harness(); h.start();
  CAMPAIGN[0].solution.slice(0, 2).forEach(action => h.act(action));
  const before = clone(h.game.state);
  h.callbacks.hide();
  assert.equal(h.game.modal.kind, 'pause');
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.deepEqual(reloaded.game.state, before);
  CAMPAIGN[0].solution.slice(2).forEach(action => reloaded.act(action));
  assert.equal(reloaded.game.state.status, 'won');
  assert.equal(reloaded.game.starCount(), 3);
  h.destroy(); reloaded.destroy();
});

test('cancelled ads cannot revive, completed ads revive once, and relaunch preserves that spent chance', async () => {
  const h = harness(); h.start();
  for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
  assert.equal(h.game.state.status, 'failed');
  const failed = clone(h.game.state);
  let pending = h.game.requestRevive();
  await Promise.resolve();
  assert.equal(h.game.busy, true);
  h.act('right');
  h.closeAd(false); await pending;
  assert.deepEqual(h.game.state, failed);
  assert.equal(h.game.state.revived, false);
  assert.equal(h.game.modal.kind, 'fail');
  pending = h.game.requestRevive(); await Promise.resolve();
  h.closeAd(true); await pending;
  assert.equal(h.game.state.status, 'playing');
  assert.equal(h.game.state.revived, true);
  assert.equal(h.game.reviveAt, failed.turn);
  assert.deepEqual(h.game.state.history, failed.history);
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.deepEqual(reloaded.game.state, h.game.state);
  for (let index = 0; index < h.game.state.energy; index++) reloaded.act('wait');
  assert.equal(reloaded.game.state.status, 'failed');
  assert.equal(reloaded.game.modal.buttons.some(button => button.text.includes('看视频')), false);
  await reloaded.game.requestRevive();
  assert.equal(reloaded.showCount, 0);
  h.destroy(); reloaded.destroy();
});

test('an unconfigured real-WeChat ad never grants a preview reward', async () => {
  const h = harness({ configured: false }); h.start();
  for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
  await h.game.requestRevive();
  assert.equal(h.game.state.status, 'failed');
  assert.equal(h.game.state.revived, false);
  assert.equal(h.showCount, 0);
  assert.match(h.game.toastText, /尚未配置/);
  h.destroy();
});

test('yesterday\'s restored daily and its replay keep their original scoring date after midnight', () => {
  const clock = { date: '2026-09-07' };
  const level = getDaily(clock.date);
  const h = harness({ clock }); h.start(level, 'daily');
  level.solution.slice(0, 2).forEach(action => h.act(action));
  clock.date = '2026-09-08';
  const reloaded = harness({ data: h.data, clock });
  assert.equal(reloaded.game.restore(), true);
  reloaded.game.start(reloaded.game.level, 'daily');
  assert.equal(reloaded.game.runDate, '2026-09-07');
  reloaded.game.level.solution.forEach(action => reloaded.act(action));
  assert.equal(reloaded.game.state.status, 'won');
  assert.equal(reloaded.game.profile().daily['2026-09-07'].stars, 3);
  assert.equal(reloaded.game.profile().daily['2026-09-08'], undefined);
  assert.equal(reloaded.game.starCount(), 0, 'daily stars do not inflate campaign collection goals');
  assert.equal(Object.keys(reloaded.game.profile().completed).length, 0);
  reloaded.game.modal.buttons[1].action();
  assert.equal(reloaded.game.runDate, '2026-09-07');
  h.destroy(); reloaded.destroy();
});

test('an interrupted or invalid replay is discarded without erasing completed deliveries', () => {
  const h = harness(); h.start();
  CAMPAIGN[0].solution.forEach(action => h.act(action));
  const profile = clone(h.data.get(PROFILE_KEY));
  h.data.set(RUN_KEY, { mode: 'campaign', levelId: 2, revision: CAMPAIGN[1].revision || '1', dateKey: '2026-09-07', actions: ['left'], reviveAt: null });
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), false);
  assert.equal(reloaded.game.store.loadRun(), null);
  assert.deepEqual(reloaded.data.get(PROFILE_KEY), profile);
  h.destroy(); reloaded.destroy();
});

test('every campaign and daily screen renders finite geometry on small phones and tablets', () => {
  for (const metrics of [
    { width: 320, height: 568, pixelRatio: 2, safeTop: 70, safeBottom: 20 },
    { width: 390, height: 844, pixelRatio: 3, safeTop: 88, safeBottom: 34 },
    { width: 768, height: 1024, pixelRatio: 2, safeTop: 70, safeBottom: 20 }
  ]) {
    const h = harness({ metrics });
    for (const level of [...CAMPAIGN, getDaily('2026-09-07')]) {
      h.start(level, typeof level.id === 'string' ? 'daily' : 'campaign'); h.draw();
      assert.ok(h.game.renderer.boardRect.w > 240);
      const preview = h.calls.find(call => call.method === 'fillText' && call.args[0] === '回声预告');
      const up = h.game.renderer.hits.find(hit => hit.x === 170 && hit.w === 50 && hit.h === 42);
      assert.ok(up.y >= preview.args[2] + 21, 'the direction pad must not overlap the echo forecast');
      h.game.help(); h.draw();
    }
    for (const page of ['home', 'levels', 'collection', 'settings']) { h.game.openPage(page); h.draw(); }
    h.destroy();
  }
});

test('the forecast leaves empty slots until each of the next three echoes exists', () => {
  const h = harness(); h.start();
  const expected = [[null, null, 13], [null, 13, 14], [13, 14, 15], [14, 15, 16]];
  for (let turn = 0; turn < expected.length; turn++) {
    if (turn > 0) h.act('right');
    h.draw();
    const preview = h.calls.find(call => call.method === 'fillText' && call.args[0] === '回声预告');
    const values = h.calls.filter(call => call.method === 'fillText' && call.args[2] === preview.args[2] && [153, 203, 253].includes(call.args[1])).map(call => call.args[0]);
    assert.equal(values.length, 3);
    expected[turn].forEach((position, index) => {
      if (position == null) assert.ok(!/^[A-F][1-6]$/.test(values[index]));
      else assert.equal(values[index], String.fromCharCode(65 + position % 6) + (Math.floor(position / 6) + 1));
    });
  }
  h.destroy();
});

test('a difficulty update restarts the changed route with notice and preserves earned progress', () => {
  const h = harness(); h.start();
  CAMPAIGN[0].solution.forEach(action => h.act(action));
  const earned = clone(h.game.profile());
  h.start(CAMPAIGN[1]);
  h.act(CAMPAIGN[1].solution[0]);
  const oldRun = clone(h.data.get(RUN_KEY));
  delete oldRun.revision;
  h.data.set(RUN_KEY, oldRun);
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.level.id, 2);
  assert.equal(reloaded.game.state.turn, 0, 'old actions must not silently replay on a changed puzzle');
  assert.match(reloaded.game.toastText, /路线已升级/);
  assert.deepEqual(reloaded.game.profile(), earned);
  assert.equal(reloaded.game.store.loadRun().revision, CAMPAIGN[1].revision);
  h.destroy(); reloaded.destroy();
});

test('a lifecycle transition cannot finish a gesture started before the game was hidden', () => {
  const h = harness(); h.start(); h.draw();
  h.game.pointerEvent(100, 100, 'start');
  assert.ok(h.game.pointer);
  h.callbacks.hide();
  assert.equal(h.game.pointer, null);
  h.callbacks.show();
  assert.equal(h.game.pointer, null);
  h.game.pointerEvent(100, 100, 'end');
  assert.equal(h.game.state.turn, 0);
  assert.equal(h.game.modal.kind, 'pause');
  h.destroy();
});
