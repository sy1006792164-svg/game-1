'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN, undoFor } = require('../src/levels');
const { MOVE_MS } = require('../src/motion');
const { drawResultHeader, drawResultStars } = require('../src/result-effects');
const { C } = require('../src/theme');
const { RUN_KEY, PROFILE_KEY, DEV_RUN_KEY, DEV_PROFILE_KEY } = require('../src/storage');
const { StartupLoader } = require('../src/startup');
const { replay: replayItems } = require('../src/engine');
const { SUPPLY_ENERGY, RELIGHT_ACTION } = require('../src/supply-rules');

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
  const frameRates = [];
  const soundCalls = [];
  const audio = [];
  const { canvas, calls } = canvasMock();
  const closeListeners = new Set(); const errorListeners = new Set();
  let now = options.now ?? 1000; let frame = 0; let showCount = 0; let vibrations = 0;
  const ad = {
    show: () => { showCount++; return Promise.resolve(); }, load: () => Promise.resolve(),
    onClose: handler => closeListeners.add(handler), offClose: handler => closeListeners.delete(handler),
    onError: handler => errorListeners.add(handler), offError: handler => errorListeners.delete(handler)
  };
  const metrics = options.metrics || { width: 390, height: 844, pixelRatio: 2, safeTop: 50, safeBottom: 34 };
  const platform = {
    isDevelopment: options.development === true,
    kind: options.kind || 'wechat', wx: {
      createRewardedVideoAd: () => ad,
      createInnerAudioContext() {
        const voice = {
          playing: false, destroyed: false,
          play() { this.playing = true; }, stop() { this.playing = false; },
          destroy() { this.destroyed = true; this.playing = false; },
          onEnded(fn) { this.ended = fn; }, offEnded() {}, onError(fn) { this.error = fn; }, offError() {},
        };
        audio.push(voice); return voice;
      },
    }, canvas,
    storage: { get: key => clone(data.get(key)), set: (key, value) => data.set(key, clone(value)), remove: key => data.delete(key) },
    resize: () => metrics, now: () => now, raf: callback => { callbacks.frame = callback; return ++frame; }, cancelRaf: () => {}, vibrate: () => { vibrations++; },
    setFrameRate: fps => frameRates.push(fps),
    onResize: handler => { callbacks.resize = handler; }, onPointer: handler => { callbacks.pointer = handler; },
    onKey: handler => { callbacks.key = handler; }, onHide: handler => { callbacks.hide = handler; }, onShow: handler => { callbacks.show = handler; },
    onAudioInterruptionBegin: handler => { callbacks.audioBegin = handler; }, onAudioInterruptionEnd: handler => { callbacks.audioEnd = handler; },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.date + 'T12:00:00'])); }
  }
  const module = { exports: {} };
  factory(specifier => {
    if (specifier === './sound' && !options.withAudio) return { createSound: () => ({
      play(type) { soundCalls.push(['play', type]); }, stop() { soundCalls.push(['stop']); },
      release() { soundCalls.push(['release']); }, ambience(enabled) { soundCalls.push(['ambience', enabled]); },
      unlock() { soundCalls.push(['unlock']); },
      suspend(reason) { soundCalls.push(['suspend', reason]); }, resume(reason) { soundCalls.push(['resume', reason]); },
    }) };
    if (specifier === './config') return {
      ...actualRequire(specifier),
      REWARDED_AD_UNIT_ID: options.configured === false ? '' : 'adunit-integrationtest',
      ...(options.publicationInfo ? { PUBLICATION_INFO: options.publicationInfo } : {}),
    };
    // Non-guide scenarios deliberately explore waits, failures and buffered input.
    // Keep their saved profiles intact while dedicated guide cases use the real policy.
    if (specifier === './play-guide' && options.guide !== true) return { ...actualRequire(specifier), autoGuide: () => false };
    if (specifier === './mechanic-guide' && options.mechanics !== true) return { ...actualRequire(specifier), createMechanicGuide: () => null };
    return actualRequire(specifier);
  }, module, module.exports, ClockDate);
  Object.defineProperties(platform.wx, Object.getOwnPropertyDescriptors(options.wx || {}));
  const game = new module.exports.Game(platform);
  if (options.startup !== true) {
    for (let frame = 0; game.page !== 'home' && frame < 200; frame++) { now += 100; game.loop(); }
    assert.equal(game.page, 'home', 'the real startup loop must automatically finish before gameplay tests');
  }
  function draw(ms = 200) { calls.length = 0; now += ms; game.renderer.draw(game, now, metrics); }
  return {
    game, data, clock, calls, callbacks, platform, draw, soundCalls, audio, ad, frameRates, metrics,
    get showCount() { return showCount; },
    get vibrations() { return vibrations; },
    advance(ms, runLoop = true) { now += ms; if (runLoop) game.loop(); },
    act(action) { now += 200; game.act(action); },
    start(level = CAMPAIGN[0], mode = 'campaign') { game.start(level, mode); },
    closeAd(ended) { Array.from(closeListeners).forEach(handler => handler({ isEnded: ended })); },
    failAd(error) { Array.from(errorListeners).forEach(handler => handler(error)); },
    destroy() { game.ads.destroy(); game.sound.release(); }
  };
}

const settleItemVideo = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
async function completeItemVideo(h, ended = true) {
  await settleItemVideo(); h.closeAd(ended); await settleItemVideo();
}

test('tool confirmation, cancellation, save/restore and undo preserve paid rewards without free refills', async t => {
  const h = harness({ development: true }); t.after(() => h.destroy()); h.start(CAMPAIGN[22]);
  const before = clone(h.game.state);
  assert.deepEqual(before.inventory, { oil: 0, kite: 0, bridge: 0 });
  h.callbacks.key('1');
  assert.equal(h.game.modal.kind, 'item');
  assert.ok(h.game.modal.lines.some(line => line.includes('最多二星')));
  h.callbacks.key('Escape');
  assert.equal(h.game.modal, null);
  assert.deepEqual(h.game.state, before);
  h.callbacks.key('1'); h.callbacks.key('Enter');
  assert.equal(h.game.busy, true);
  assert.deepEqual(h.game.state, before);
  await completeItemVideo(h, false);
  assert.deepEqual(h.game.state, before, 'cancelled video cannot grant or apply a tool');
  h.callbacks.key('1'); h.callbacks.key('Enter');
  await completeItemVideo(h);
  assert.equal(h.game.state.energy, before.energy + SUPPLY_ENERGY);
  assert.equal(h.game.state.turn, 0);
  assert.equal(h.game.state.inventory.oil, 0);
  assert.deepEqual(h.game.actions, ['item:oil']);
  assert.equal(h.game.store.loadRun().itemRewards.oil, 1);
  const supplied = clone(h.game.state);
  h.game.home(); assert.equal(h.game.restore(), true);
  assert.deepEqual(h.game.state, supplied);
  h.advance(300); h.game.undo();
  assert.deepEqual(h.game.state, { ...before, inventory: { ...before.inventory, oil: 1 } });
  assert.equal(h.game.undosUsed, 1);
  h.advance(300); h.callbacks.key('1'); h.callbacks.key('Enter');
  assert.equal(h.game.state.itemsUsed, 1);
  assert.equal(h.showCount, 2, 'undo returns the earned charge without another video');
  h.game.start(h.game.level);
  assert.deepEqual(h.game.state, before, 'restart never refills free supplies');
  assert.deepEqual(h.game.itemRewards, { oil: 0, kite: 0, bridge: 0 });
});

test('targeted tools never move or show a video on invalid taps, pause or buffered input', async t => {
  const h = harness(); t.after(() => h.destroy());
  const level = { ...CAMPAIGN[6], width: 3, height: 2, start: 0, exit: 5, walls: [1], letters: [2], seals: [], lights: [], winds: {}, bridges: [], budget: 10, par: 4 };
  h.start(level); h.game.selectItem('kite'); h.callbacks.key('Enter');
  assert.equal(h.game.selectedItem, 'kite');
  const before = clone(h.game.state);
  h.callbacks.key('ArrowDown'); h.callbacks.key(' '); h.game.itemTarget(5);
  assert.deepEqual(h.game.state, before);
  assert.equal(h.showCount, 0);
  assert.equal(h.game.selectedItem, 'kite');
  h.callbacks.key('Escape');
  assert.equal(h.game.selectedItem, null);
  assert.equal(h.game.modal, null);
  h.game.selectItem('kite'); h.callbacks.key('Enter'); h.game.pause();
  assert.equal(h.game.selectedItem, null);
  h.game.itemTarget(2); assert.deepEqual(h.game.state, before);
  h.game.pause(); h.game.selectItem('kite'); h.callbacks.key('Enter');
  h.game.itemTarget(2); h.game.itemTarget(2);
  assert.deepEqual(h.game.state, before, 'a valid target still waits for completed playback');
  await completeItemVideo(h);
  assert.equal(h.showCount, 1);
  assert.deepEqual(h.game.actions, ['item:kite:2']);
  assert.equal(h.game.state.player, 0);
  assert.deepEqual(h.game.state.letters, []);
  assert.equal(h.game.state.turn, 0);
  h.advance(300); h.game.undo(); assert.deepEqual(h.game.state, { ...before, inventory: { ...before.inventory, kite: 1 } });
});

test('kite delivery after completed video wins immediately but never overwrites an unaided record', async t => {
  const h = harness(); t.after(() => h.destroy());
  const level = { ...CAMPAIGN[6], width: 3, height: 1, start: 0, exit: 0, walls: [], letters: [2], seals: [], lights: [], winds: {}, bridges: [], budget: 5, par: 4 };
  h.game.store.recordWin(level.id, 3, 4, 'campaign');
  h.start(level); h.game.selectItem('kite'); h.callbacks.key('Enter'); h.game.itemTarget(2);
  await completeItemVideo(h);
  assert.equal(h.game.state.status, 'won');
  assert.equal(h.game.modal.stars, 2);
  assert.deepEqual(h.game.profile().completed[String(level.id)], { stars: 3, bestTurns: 4 });
  assert.ok(!h.game.modal.lines.some(line => line.includes('刷新纪录')));
  assert.ok(h.game.modal.lines.some(line => line.includes('按 5 拍计')));
  assert.equal(h.game.store.loadRun(), null);
});

test('video repair restores a broken bridge and undo returns the earned inventory and exact terrain', async t => {
  const h = harness(); t.after(() => h.destroy());
  const level = { ...CAMPAIGN[15], width: 3, height: 2, start: 0, exit: 0, walls: [], letters: [5], seals: [], lights: [], winds: {}, bridges: [1], budget: 12, par: 6 };
  h.start(level); h.act('right'); h.act('down'); h.advance(300);
  const broken = clone(h.game.state);
  assert.deepEqual(broken.bridges, []);
  h.game.selectItem('bridge'); h.callbacks.key('Enter'); h.game.itemTarget(1);
  await completeItemVideo(h);
  assert.deepEqual(h.game.state.bridges, [1]);
  assert.equal(h.game.state.turn, broken.turn);
  assert.deepEqual(h.game.state, replayItems(level, h.game.actions, [], h.game.itemRewards));
  h.advance(300); h.game.undo(); assert.deepEqual(h.game.state, { ...broken, inventory: { ...broken.inventory, bridge: 1 } });
});

test('level 44 can use a kite then repair its bridge, save, restore and undo without sharing item charges', async t => {
  const h = harness({ development: true }); t.after(() => h.destroy());
  const level = CAMPAIGN[43]; h.start(level);
  while (h.game.mechanicGuide) h.game.advanceMechanicGuide(true);
  h.advance(300);
  h.game.selectItem('kite'); h.callbacks.key('Enter'); h.game.itemTarget(2);
  await completeItemVideo(h);
  assert.equal(h.game.state.player, level.start, 'a kite collects mail without walking over any tile');
  assert.deepEqual(h.game.state.bridges, [16]);
  assert.equal(h.game.state.itemsUsed, 1);
  h.advance(300); h.game.selectItem('bridge');
  assert.ok(h.game.modal.lines.includes('纸桥完好，无需修复'));
  assert.equal(h.game.modal.buttons.some(button => button.primary), false);
  h.callbacks.key('Escape');
  for (const action of level.solution.slice(0, 12)) h.act(action);
  const torn = clone(h.game.state);
  assert.equal(torn.player, 22); assert.deepEqual(torn.bridges, []);
  h.act('up');
  assert.deepEqual(h.game.state, torn, 'walking into torn paper consumes no beat');
  assert.match(h.game.toastText, /修桥包/);
  h.advance(300); h.game.selectItem('bridge'); h.callbacks.key('Enter'); h.game.itemTarget(16);
  await completeItemVideo(h);
  assert.equal(h.game.state.turn, torn.turn);
  assert.equal(h.game.state.energy, torn.energy);
  assert.deepEqual(h.game.state.history, torn.history);
  assert.deepEqual(h.game.state.bridges, [16]);
  assert.deepEqual(h.game.itemRewards, { oil: 0, kite: 1, bridge: 1 });
  assert.equal(h.showCount, 2, 'each selected tool receives its own completed-video grant');
  const repaired = clone(h.game.state);
  h.game.home(); assert.equal(h.game.restore(), true); assert.deepEqual(h.game.state, repaired);
  h.advance(300); h.game.undo();
  assert.deepEqual(h.game.state, { ...torn, inventory: { ...torn.inventory, bridge: 1 } });
  h.advance(300); h.game.selectItem('bridge'); h.callbacks.key('Enter'); h.game.itemTarget(16);
  assert.equal(h.showCount, 2, 'undo returns the earned repair without requesting another video');
  assert.deepEqual(h.game.state, repaired);
  h.act('up'); assert.equal(h.game.state.player, 16);
  h.act('down'); assert.deepEqual(h.game.state.bridges, [], 'the repaired bridge tears only when left again');
});

test('tool selection drops a queued walk and repeated confirmation cannot reward twice', async t => {
  const h = harness(); t.after(() => h.destroy()); h.start(CAMPAIGN[3]);
  h.act(h.game.level.solution[0]); h.game.act(h.game.level.solution[1]);
  assert.ok(h.game.pendingAction);
  h.game.selectItem('oil'); assert.equal(h.game.pendingAction, null);
  assert.equal(h.game.modal, null, 'moving courier cannot open a stale tool confirmation');
  h.advance(300); h.game.selectItem('oil');
  const confirm = h.game.modal.buttons[0].action;
  confirm(); confirm();
  await settleItemVideo();
  await completeItemVideo(h); h.closeAd(true); await settleItemVideo();
  assert.equal(h.showCount, 1);
  assert.equal(h.game.itemRewards.oil, 1);
  assert.equal(h.game.actions.filter(action => action === 'item:oil').length, 1);
});

test('item videos remain opt-in, never reward in browser or after an ad error, and can retry', async t => {
  for (const options of [{ kind: 'browser' }, { configured: false }]) {
    const h = harness(options); t.after(() => h.destroy()); h.start(CAMPAIGN[3]);
    const before = clone(h.game.state);
    h.game.selectItem('oil'); assert.equal(h.game.modal.buttons.some(button => button.primary), false);
    h.game.modal = null; await h.game.requestItemReward('oil', before.player);
    h.act('item:oil');
    assert.equal(h.showCount, 0); assert.deepEqual(h.game.state, before);
  }
  const h = harness(); t.after(() => h.destroy()); h.start(CAMPAIGN[3]);
  assert.equal(h.showCount, 0, 'opening a route never starts an advertisement');
  const before = clone(h.game.state);
  h.game.selectItem('oil'); h.callbacks.key('Enter'); await settleItemVideo();
  h.failAd({ errCode: 1004 }); await settleItemVideo();
  assert.deepEqual(h.game.state, before);
  assert.equal(h.game.busy, false);
  assert.match(h.game.toastText, /未发放/);
  h.game.selectItem('oil'); h.callbacks.key('Enter'); await completeItemVideo(h);
  assert.equal(h.game.itemRewards.oil, 1);
  h.advance(300); h.game.selectItem('oil'); h.callbacks.key('Enter'); await completeItemVideo(h);
  assert.equal(h.game.itemRewards.oil, 2);
  assert.equal(h.game.state.energy, before.energy + SUPPLY_ENERGY * 2);
  assert.equal(h.showCount, 3, 'each new dose requires its own completed video');
});

test('completed item playback saves exactly once in background and cannot reward another restored session', async t => {
  const h = harness({ development: true }); t.after(() => h.destroy()); h.start(CAMPAIGN[3]);
  const before = clone(h.game.state);
  h.game.selectItem('oil'); h.callbacks.key('Enter'); await settleItemVideo();
  h.callbacks.hide(); await completeItemVideo(h);
  assert.equal(h.game.state.energy, before.energy + SUPPLY_ENERGY);
  assert.equal(h.game.itemRewards.oil, 1);
  assert.equal(h.game.modal.kind, 'pause');
  assert.equal(h.game.store.loadRun().itemRewards.oil, 1);
  h.callbacks.show(); h.game.pause(); h.advance(300);
  h.game.selectItem('oil'); h.callbacks.key('Enter'); await settleItemVideo();
  assert.equal(h.game.restore(), true);
  const restored = clone(h.game.state);
  await completeItemVideo(h);
  assert.deepEqual(h.game.state, restored);
  assert.equal(h.game.itemRewards.oil, 1, 'stale completion cannot apply to a different session');
});

test('proactive oil and a failed-route video give the same six energy without double rewards', async t => {
  const active = harness(), failed = harness(); t.after(() => { active.destroy(); failed.destroy(); });
  active.start(CAMPAIGN[3]); failed.start(CAMPAIGN[3]);
  const starting = active.game.state.energy, activeHistory = clone(active.game.state.history);
  active.game.selectItem('oil'); active.callbacks.key('Enter'); await completeItemVideo(active);
  while (failed.game.state.status === 'playing') failed.act('wait');
  const failedHistory = clone(failed.game.state.history), failedTurn = failed.game.state.turn;
  assert.ok(failed.game.modal.lines.some(line => line.includes('和投递中的灯油相同')));
  const revive = failed.game.requestRevive(); await completeItemVideo(failed); await revive;
  assert.equal(active.game.state.energy - starting, 6);
  assert.equal(failed.game.state.energy, 6);
  assert.deepEqual(active.game.state.history, activeHistory);
  assert.deepEqual(failed.game.state.history, failedHistory);
  assert.equal(failed.game.state.turn, failedTurn);
  assert.equal(active.showCount, 1); assert.equal(failed.showCount, 1);
  assert.equal(active.game.state.inventory.oil, 0); assert.equal(failed.game.state.inventory.oil, 0);
  assert.equal(failed.game.itemRewards.oil, 0, 'video relight does not additionally grant a stock item');
});

test('a failed route uses already-earned oil before ads and persists its own undo boundary', async t => {
  const h = harness({ development: true }); t.after(() => h.destroy()); h.start(CAMPAIGN[3]);
  h.game.selectItem('oil'); h.callbacks.key('Enter'); await completeItemVideo(h);
  h.advance(300); h.game.undo();
  assert.equal(h.game.state.inventory.oil, 1);
  h.game.ads.isConfigured = () => false;
  while (h.game.state.status === 'playing') h.act('wait');
  assert.equal(h.game.modal.buttons[0].text, '使用已领取灯油 +6 拍');
  assert.equal(h.game.modal.buttons.some(button => button.text.includes('看广告')), false);
  const turn = h.game.state.turn, rewards = clone(h.game.itemRewards), use = h.game.modal.buttons[0].action;
  use(); use();
  assert.equal(h.game.state.status, 'playing'); assert.equal(h.game.state.energy, 6);
  assert.equal(h.game.state.turn, turn); assert.equal(h.game.state.inventory.oil, 0);
  assert.equal(h.game.state.reviveCount, 1); assert.equal(h.game.state.itemsUsed, 1);
  assert.equal(h.showCount, 1); assert.deepEqual(h.game.itemRewards, rewards);
  assert.deepEqual(h.game.reviveHistory, []);
  assert.equal(h.game.actions.at(-1), RELIGHT_ACTION);
  assert.equal(h.game.reviveAt, h.game.actions.length);
  const restored = clone(h.game.state);
  h.game.undo(); assert.deepEqual(h.game.state, restored, 'inventory relight itself cannot be undone');
  h.act(h.game.level.solution[0]); h.game.undo();
  assert.deepEqual(h.game.state, restored, 'the first move after relighting remains reversible');
  h.game.home(); assert.equal(h.game.restore(), true);
  assert.deepEqual(h.game.state, restored); assert.equal(h.game.canUndo(), false);
  assert.deepEqual(h.game.itemRewards, rewards);
});

test('a route at its saved-action limit never sells an unusable relight or consumes owned oil', async t => {
  const h = harness(); t.after(() => h.destroy());
  const level = { ...CAMPAIGN[3], budget: 4096 };
  h.start(level); h.game.actions = Array(4096).fill('wait'); h.game.itemRewards = { oil: 1, kite: 0, bridge: 0 };
  h.game.state = replayItems(level, h.game.actions, [], h.game.itemRewards);
  assert.equal(h.game.state.status, 'failed');
  const before = clone(h.game.state);
  h.game.failure();
  assert.equal(h.game.modal.buttons.some(button => /看广告|已领取灯油/.test(button.text)), false);
  assert.ok(h.game.modal.lines.some(line => line.includes('记录已满')));
  await h.game.requestRevive(); h.game.useStoredOil();
  assert.equal(h.showCount, 0); assert.deepEqual(h.game.state, before);
});

test('legacy oil and half-budget relights retain their gains while new mixed-history supplies use six', async t => {
  const level = CAMPAIGN[3], legacyReviveAt = level.budget + 4;
  const actions = ['item:oil', ...Array(level.budget + 3).fill('wait'), 'wait'];
  const run = { mode: 'campaign', levelId: level.id, revision: level.revision, actions,
    reviveHistory: [legacyReviveAt], itemRewards: { oil: 1 }, undosUsed: 0 };
  const h = harness({ development: true, data: new Map([[DEV_RUN_KEY, run]]) }); t.after(() => h.destroy());
  assert.equal(h.game.restore(), true);
  const legacyGain = Math.max(8, Math.ceil(level.budget * .5));
  assert.equal(h.game.state.energy, legacyGain - 1);
  assert.deepEqual(h.game.supplyPolicy, { version: 2, legacyActionCount: actions.length, legacyReviveCount: 1 });
  assert.deepEqual(h.game.store.loadRun().supplyPolicy, h.game.supplyPolicy, 'migration is saved before another action');
  h.game.selectItem('oil'); h.callbacks.key('Enter'); await completeItemVideo(h);
  assert.equal(h.game.state.energy, legacyGain - 1 + 6);
  const mixed = clone(h.game.state);
  h.game.home(); assert.equal(h.game.restore(), true); assert.deepEqual(h.game.state, mixed);
  h.game.undo(); h.advance(300); h.game.undo();
  assert.equal(h.game.state.energy, legacyGain);
  assert.equal(h.game.supplyPolicy.legacyActionCount, legacyReviveAt);
  h.advance(300); h.game.selectItem('oil'); h.callbacks.key('Enter');
  assert.equal(h.game.state.energy, legacyGain + 6, 'a replacement for an undone legacy action uses current rules');
  while (h.game.state.status === 'playing') h.act('wait');
  const pending = h.game.requestRevive(); await completeItemVideo(h); await pending;
  assert.equal(h.game.state.energy, 6);
  assert.equal(h.game.state.reviveCount, 2);
  assert.equal(h.game.supplyPolicy.legacyReviveCount, 1);
  const final = clone(h.game.state);
  h.game.home(); assert.equal(h.game.restore(), true); assert.deepEqual(h.game.state, final);
});

test('trees keep the same continuous wind motion through moves, waits and undo', t => {
  const idle = harness(), active = harness();
  t.after(() => { idle.destroy(); active.destroy(); });
  for (const h of [idle, active]) { h.start(CAMPAIGN[1]); h.draw(1200); }
  // Capture full tree crowns in world coordinates, before the camera transform.
  // Actor poses, collection feedback and the rest of the UI can change freely.
  const crowns = h => h.calls.filter(({ method, args }) => method === 'ellipse' &&
    Math.abs(args[2] / args[3] - .27 / .48) < 1e-9 && args[5] === 0 && args[6] === Math.PI * 2)
    .map(({ args }) => args);
  const initial = crowns(idle);
  assert.ok(initial.length > 2, 'the real board must draw trees, not just the distant backdrop');
  const sample = ms => {
    idle.draw(ms); active.draw(ms);
    assert.equal(active.game.renderer.ambientNow, idle.game.renderer.ambientNow);
    assert.deepEqual(crowns(active), crowns(idle), 'player actions cannot restart or amplify tree sway');
  };
  active.game.act('right');
  assert.equal(active.game.state.turn, 1);
  for (const ms of [0, 40, 80, 120]) sample(ms);
  active.game.act('wait');
  assert.equal(active.game.state.turn, 2);
  for (const ms of [0, 60, 180]) sample(ms);
  active.game.undo();
  assert.equal(active.game.state.turn, 1);
  for (const ms of [0, 60, 200, 1000]) sample(ms);
  assert.notDeepEqual(crowns(active), initial, 'natural wind must keep animating while idle or walking');
});

test('zooming at a floor tile preserves its screen anchor with the shared guide framing', t => {
  for (const metrics of [
    { width: 320, height: 568, pixelRatio: 2, safeTop: 72, safeBottom: 0 },
    { width: 390, height: 844, pixelRatio: 3, safeTop: 96, safeBottom: 34 },
    { width: 430, height: 932, pixelRatio: 3, safeTop: 96, safeBottom: 34 }
  ]) {
    const h = harness({ guide: true, metrics }); t.after(() => h.destroy());
    h.start(); h.draw(1200);
    const r = h.game.renderer, cell = h.game.level.seals[0];
    const before = r.boardProjection.point(cell);
    h.game.zoomScene(before[0] * r.scale + r.ox, before[1] * r.scale + r.oy, 1.3);
    h.draw();
    const after = r.boardProjection.point(cell);
    assert.ok(Math.abs(before[0] - after[0]) < 1e-8);
    assert.ok(Math.abs(before[1] - after[1]) < 1e-8, 'vertical zoom must use the actual projection center');
    assert.equal(h.game.state.turn, 0);
  }
});

test('new mechanics use two actual board taps on small phones without spending a turn or accepting stray input', t => {
  for (const [id, seen] of [[13, {}], [16, { wind: true }], [19, { wind: true, bridge: true }]]) {
    const h = harness({ mechanics: true, development: true,
      metrics: { width: 320, height: 568, pixelRatio: 2, safeTop: 70, safeBottom: 20 } });
    t.after(() => h.destroy());
    Object.keys(seen).forEach(key => h.game.store.markMechanicSeen(key));
    h.start(CAMPAIGN[id - 1]); h.advance(1200, false); h.draw();
    const original = clone(h.game.state), undos = h.game.undosUsed;
    assert.equal(h.game.guideStep().kind, 'mechanic');
    h.act(h.game.level.solution[0]); h.callbacks.key(' '); h.game.undo();
    assert.deepEqual(h.game.state, original);
    assert.equal(h.game.undosUsed, undos);
    assert.equal(h.game.pendingAction, null);
    for (let phase = 0; phase < 2; phase++) {
      h.draw();
      const guide = h.game.guideStep();
      assert.equal(guide.step, phase + 1);
      const point = h.game.renderer.boardProjection.point(guide.visual.tapCell);
      tapBoardPoint(h, point);
      assert.deepEqual(h.game.state, original, 'inspection spends no energy or history');
      assert.equal(h.game.actions.length, 0);
    }
    assert.equal(h.game.guideStep(), null);
    assert.equal(h.game.profile().mechanicGuides[{ 13: 'wind', 16: 'bridge', 19: 'light' }[id]], true);
    h.act(h.game.level.solution[0]);
    assert.equal(h.game.state.turn, 1, 'normal movement resumes immediately after the explanation');
  }
});

test('new mechanic appearances persist across relaunch, retry and skip independently of first-route preferences', t => {
  const h = harness({ mechanics: true, development: true }); t.after(() => h.destroy());
  h.game.store.setGuideDismissed(true); h.start(CAMPAIGN[19]);
  assert.deepEqual(h.game.mechanicGuide.ids, ['wind', 'bridge', 'light']);
  assert.deepEqual(h.game.profile().mechanicGuides, { wind: true }, 'record the first displayed type before confirmation');
  h.game.advanceMechanicGuide();
  const resumed = harness({ mechanics: true, development: true, data: h.data }); t.after(() => resumed.destroy());
  assert.equal(resumed.game.restore(), true);
  assert.equal(resumed.game.guideStep().step, 1);
  assert.equal(resumed.game.guideStep().mechanic, 'bridge', 'relaunch skips the already displayed wind and introduces the next unseen type');
  assert.deepEqual(resumed.game.profile().mechanicGuides, { wind: true, bridge: true });
  resumed.game.start(resumed.game.level);
  assert.equal(resumed.game.guideStep().mechanic, 'light', 'retry skips the displayed bridge and introduces the next unseen type');
  assert.deepEqual(resumed.game.profile().mechanicGuides, { wind: true, bridge: true, light: true });
  resumed.game.dismissGuide();
  assert.equal(resumed.game.guideStep(), null);
  resumed.game.start(resumed.game.level);
  assert.equal(resumed.game.guideStep(), null, 'confirmed mechanics do not reopen on retry');
  assert.equal(resumed.game.profile().guideDismissed, true, 'first-route preference is independent');
});

test('pausing a first paper bridge explanation preserves its type, phase and remaining new mechanics', t => {
  for (const level of [CAMPAIGN[15], CAMPAIGN[19]]) {
    const h = harness({ mechanics: true, development: true }); t.after(() => h.destroy());
    h.game.store.markMechanicSeen('wind'); h.start(level);
    const route = clone(h.game.state);
    for (let phase = 0; phase < 2; phase++) {
      const lesson = clone(h.game.mechanicGuide);
      assert.equal(h.game.guideStep().mechanic, 'bridge');
      assert.equal(h.game.guideStep().step, phase + 1);
      h.game.pause();
      assert.equal(h.game.modal.buttons.some(button => /道具引导|回看/.test(button.text)), false);
      h.game.modal.buttons.find(button => button.text === '玩法说明').action();
      assert.equal(h.game.modal.kind, 'help');
      assert.deepEqual(h.game.mechanicGuide, lesson, 'reading static rules preserves the active introduction');
      h.game.modal.buttons.find(button => button.text === '明白了').action();
      assert.equal(h.game.modal.kind, 'pause');
      h.game.modal.buttons.find(button => button.text === '继续投递').action();
      assert.equal(h.game.modal, null);
      assert.deepEqual(h.game.mechanicGuide, lesson, 'pause must not rebuild the queue from wind or reset its phase');
      assert.deepEqual(h.game.state, route);
      assert.equal(h.game.actions.length, 0);
      assert.deepEqual(h.game.store.loadRun().mechanicGuide, { id: 'bridge', phase });
      h.game.advanceMechanicGuide();
    }
    assert.equal(h.game.guideStep()?.mechanic || null, level.id === 20 ? 'light' : null);
  }
});

test('known mechanics are read through current-map help without replay entries or route changes', t => {
  for (const [id, names] of [[13, ['风口']], [16, ['风口', '纸桥']], [19, ['风口', '风灯']], [20, ['风口', '纸桥', '风灯']]]) {
    const h = harness({ mechanics: true, development: true }); t.after(() => h.destroy());
    ['wind', 'bridge', 'light'].forEach(item => h.game.store.markMechanicSeen(item));
    h.start(CAMPAIGN[id - 1]); h.act(h.game.level.solution[0]);
    const route = clone(h.game.state), run = h.game.store.loadRun();
    assert.equal(h.game.canShowGuide(), false);
    h.game.pause();
    assert.deepEqual(h.game.modal.buttons.map(button => button.text), ['继续投递', '重新开始', '玩法说明', '返回邮局']);
    h.game.showGuide();
    assert.equal(h.game.modal.kind, 'pause', 'the old guide entry cannot start a manual mechanic replay');
    h.game.modal.buttons.find(button => button.text === '玩法说明').action();
    assert.equal(h.game.modal.kind, 'help');
    const rules = h.game.modal.sections.find(section => section.title === '本关机关').text;
    for (const name of ['风口', '纸桥', '风灯']) assert.equal(rules.includes(name + '：'), names.includes(name), 'level ' + id + ' rules for ' + name);
    assert.equal(h.game.guideStep(), null);
    assert.deepEqual(h.game.state, route);
    h.game.modal.buttons.find(button => button.text === '明白了').action();
    assert.equal(h.game.modal.kind, 'pause');
    h.game.modal.buttons.find(button => button.text === '继续投递').action();
    assert.equal(h.game.modal, null);
    assert.equal(h.game.guideStep(), null);
    assert.deepEqual(h.game.state, route);
    assert.deepEqual(h.game.store.loadRun(), run);
  }
});

test('a retired paper bridge replay save resumes its real route without an introduction or extra undo cost', t => {
  const h = harness({ mechanics: true, development: true }); t.after(() => h.destroy());
  ['wind', 'bridge', 'light'].forEach(id => h.game.store.markMechanicSeen(id));
  h.start(CAMPAIGN[19]); h.act(h.game.level.solution[0]);
  const route = clone(h.game.state);
  h.data.set(DEV_RUN_KEY, { ...h.game.store.loadRun(), mechanicGuide: { id: 'bridge', phase: 1, repeat: true } });
  const resumed = harness({ mechanics: true, development: true, data: h.data }); t.after(() => resumed.destroy());
  assert.equal(resumed.game.restore(), true);
  assert.equal(resumed.game.guideStep(), null, 'removed replay state cannot start wind, bridge or lamp explanations');
  assert.equal(resumed.game.store.loadRun().mechanicGuide, undefined, 'retired replay metadata is removed immediately');
  assert.deepEqual(resumed.game.state, route);
  assert.equal(resumed.game.undosUsed, 0);
  resumed.game.undo();
  assert.equal(resumed.game.state.turn, 0);
  assert.equal(resumed.game.guideStep(), null, 'undo preserves acquired knowledge without consuming extra undo credit');
  assert.equal(resumed.game.undosUsed, 1);
});

test('a map without mechanics offers no mechanic review entry', t => {
  const h = harness({ mechanics: true, development: true }); t.after(() => h.destroy());
  h.start(CAMPAIGN[1]);
  const state = clone(h.game.state);
  h.game.pause();
  assert.equal(h.game.modal.buttons.some(button => /道具/.test(button.text)), false);
  h.game.showGuide();
  assert.equal(h.game.modal.kind, 'pause');
  assert.equal(h.game.guideStep(), null);
  assert.deepEqual(h.game.state, state);
});

test('mechanic help on a legacy mid-route save preserves its route through background pause', t => {
  const level = CAMPAIGN[18], data = new Map([[DEV_RUN_KEY, { mode: 'campaign', levelId: level.id,
    revision: level.revision || '1', actions: level.solution.slice(0, 3), reviveAt: null, undosUsed: 0 }]]);
  const h = harness({ mechanics: true, development: true, data }); t.after(() => h.destroy());
  assert.equal(h.game.restore(), true);
  const state = clone(h.game.state);
  assert.equal(h.game.guideStep(), null, 'continuing a real legacy route must not introduce its existing props again');
  h.game.pause(); h.game.modal.buttons.find(button => button.text === '玩法说明').action();
  const rules = h.game.modal.sections.find(section => section.title === '本关机关').text;
  assert.match(rules, /风灯：/);
  assert.doesNotMatch(rules, /纸桥：/);
  h.game.modal.buttons.find(button => button.text === '明白了').action();
  h.game.modal.buttons.find(button => button.text === '继续投递').action();
  h.callbacks.hide();
  assert.equal(h.game.advanceMechanicGuide(), false);
  h.callbacks.show(); h.game.modal.buttons.find(button => button.text === '继续投递').action();
  assert.equal(h.game.guideStep(), null);
  assert.deepEqual(h.game.state, state);
  assert.equal(h.game.store.loadRun().mechanicGuide, undefined);
});

const startupAdvice = [
  '抵制不良游戏，拒绝盗版游戏。',
  '注意自我保护，谨防受骗上当。',
  '适度游戏益脑，沉迷游戏伤身。',
  '合理安排时间，享受健康生活。',
];

test('home and loading decoration keeps hit geometry and real preparation state stable across animation frames', t => {
  const geometry = r => r.hits.map(({ x, y, w, h }) => ({ x, y, w, h }));
  for (const metrics of [
    { width: 320, height: 568, pixelRatio: 2, safeTop: 72, safeBottom: 0 },
    { width: 390, height: 844, pixelRatio: 3, safeTop: 96, safeBottom: 34 },
  ]) {
    const home = harness({ metrics }); t.after(() => home.destroy());
    home.draw(0);
    const r = home.game.renderer, homeHits = geometry(r);
    const entry = r.hits.find(hit => hit.x === 42 && hit.w === 306 && hit.h === 52);
    assert.ok(entry, 'the existing primary button remains the departure target');
    for (const ms of [400, 1000]) { home.draw(ms); assert.deepEqual(geometry(r), homeHits); }
    let departures = 0;
    home.game.primary = () => { departures++; };
    const x = (entry.x + entry.w / 2) * r.scale + r.ox, y = (entry.y + entry.h / 2) * r.scale + r.oy;
    home.game.pointerEvent(x, y, 'start');
    home.draw(400);
    assert.deepEqual(geometry(r), homeHits, 'the pressed visual state cannot move or add a hit region');
    home.game.pointerEvent(x, y, 'end'); home.game.pointerEvent(x, y, 'end');
    assert.equal(departures, 1, 'a release across an animation frame starts exactly one departure');

    const loading = harness({ startup: true, metrics }); t.after(() => loading.destroy());
    const startup = loading.game.startup;
    for (const progress of [0, .4, 1]) {
      startup.progress = progress; startup.completed = Math.ceil(progress * startup.tasks.length);
      startup.settledMs = progress === 1 ? 180 : 0;
      const before = { progress, completed: startup.completed, settledMs: startup.settledMs,
        ready: startup.ready, pending: startup.pending, page: loading.game.page, lastAt: loading.game.startupLastAt };
      for (const ms of [0, 400, 1000]) {
        loading.draw(ms);
        assert.deepEqual({ progress: startup.progress, completed: startup.completed, settledMs: startup.settledMs,
          ready: startup.ready, pending: startup.pending, page: loading.game.page, lastAt: loading.game.startupLastAt }, before,
        'drawing the scan never advances real preparation or changes the automatic-entry timing');
        assert.deepEqual(geometry(loading.game.renderer), [], 'loading decoration creates no invisible input target');
      }
    }
    startup.error = new Error('preparation unavailable'); loading.draw(0);
    const retryHits = geometry(loading.game.renderer);
    assert.equal(retryHits.length, 1);
    for (const ms of [400, 1000]) { loading.draw(ms); assert.deepEqual(geometry(loading.game.renderer), retryHits); }
  }
});

function startupText(h) {
  return h.calls.filter(call => call.method === 'fillText').map(call => String(call.args[0])).join('').replace(/\s+/g, '');
}
function startupPointer(h, x, y, phase) {
  const r = h.game.renderer;
  h.callbacks.pointer(x * r.scale + r.ox, y * r.scale + r.oy, phase);
}
function completeStartup(h, target = 'home') {
  for (let frame = 0; h.game.page !== target && frame < 200; frame++) {
    h.calls.length = 0; h.advance(100);
  }
  assert.equal(h.game.page, target, 'startup must finish through the real frame loop without an entry action');
}
function assertStartupContentFits(h) {
  const r = h.game.renderer;
  for (const call of h.calls.filter(call => call.method === 'fillText')) {
    const size = Number((call.font.match(/([\d.]+)px/) || [0, 0])[1]);
    assert.ok(call.args[2] - size / 2 >= 0, 'startup text stays below the top safe area: ' + call.args[0]);
    assert.ok(call.args[2] + size / 2 <= r.H, 'startup text stays above the bottom safe area: ' + call.args[0]);
  }
  for (const hit of r.hits) {
    assert.ok(hit.x >= 0 && hit.x + hit.w <= 390);
    assert.ok(hit.y >= 0 && hit.y + hit.h <= r.H);
  }
}

test('cold launch shows the full health notice and real progress, then automatically enters home without starting a route', t => {
  const h = harness({ startup: true, withAudio: true }); t.after(() => h.destroy());
  assert.equal(h.game.page, 'startup');
  assert.equal(h.game.state, null);
  const text = startupText(h);
  const brandStart = h.calls.findIndex(call => call.method === 'fillText' && call.args[0] === '风 起 · 信 至');
  const brandEnd = h.calls.findIndex(call => call.method === 'fillText' && call.args[0] === '一封信，一段与回声同行的邮路。');
  assert.ok(brandStart >= 0 && brandEnd > brandStart);
  assert.equal(h.calls.slice(brandStart + 1, brandEnd).filter(call => call.method === 'fill').length, 4,
    'cold launch paints all four title glyphs as outlines before the subtitle');
  assert.ok(text.includes('健康游戏忠告'));
  for (const line of startupAdvice) assert.ok(text.includes(line), line);
  assert.equal(/适龄提示|8\+/.test(text), false);
  assert.equal(/进入回廊/.test(text), false);
  assert.ok(text.includes('%'), 'loading progress is visible');
  assert.equal(h.game.renderer.hits.length, 0, 'loading has no entry button');
  assert.ok(h.game.startup.progress < 1);
  assert.ok(h.audio.every(voice => !voice.playing));
  const data = clone(Array.from(h.data));
  h.game.unlockAudio(); h.game.cue('tap');
  for (const key of ['Enter', ' ', 'Space', 'ArrowRight', 'Escape', 'z']) h.callbacks.key(key);
  startupPointer(h, 195, 400, 'start');
  assert.equal(h.game.finishStartup(), false, 'entry is gated by completed loading');
  assert.equal(h.game.page, 'startup', 'game controls cannot skip loading');
  assert.equal(h.game.state, null);
  assert.ok(h.audio.every(voice => !voice.playing));
  assert.deepEqual(clone(Array.from(h.data)), data);
  let previous = h.game.startup.progress, paintedFull = false;
  for (let frame = 0; h.game.page === 'startup' && frame < 100; frame++) {
    h.calls.length = 0;
    h.advance(100);
    assert.ok(h.game.startup.progress >= previous, 'displayed loading progress never goes backwards');
    if (h.game.page === 'startup' && startupText(h).includes('100%')) paintedFull = true;
    previous = h.game.startup.progress;
  }
  assert.equal(h.game.page, 'home');
  assert.equal(paintedFull, true, '100 percent is visibly painted before automatic entry');
  assert.equal(h.game.startup.progress, 1);
  assert.equal(h.game.startup.ready, true);
  assert.equal(h.game.state, null, 'entering the home page does not start a route');
  assert.equal(h.game.pointer, null);
  assert.deepEqual(clone(Array.from(h.data)), data);
  h.draw();
  for (const hit of h.game.renderer.hits) startupPointer(h, hit.x + hit.w / 2, hit.y + hit.h / 2, 'end');
  assert.equal(h.game.page, 'home', 'the same touch release cannot click the home page');
  assert.equal(h.game.state, null);
  assert.equal(h.audio.filter(voice => voice.loop && voice.playing).length, 1);
});

test('a zero-based platform clock paints the initial 0 percent before starting preparation', t => {
  const h = harness({ startup: true, now: 0 }); t.after(() => h.destroy());
  assert.ok(startupText(h).includes('0%'));
  assert.equal(h.game.startup.completed, 0);
  assert.equal(h.game.startup.progress, 0);
  assert.equal(h.game.page, 'startup');
  completeStartup(h);
  assert.equal(h.game.state, null);
});

test('startup survives backgrounding and resizing without accepting stale touches or replaying on return', t => {
  const h = harness({ startup: true, withAudio: true }); t.after(() => h.destroy());
  h.advance(100);
  startupPointer(h, 195, 400, 'start');
  h.callbacks.hide(); h.game.finishStartup(); h.callbacks.key('Enter');
  const progress = h.game.startup.progress, completed = h.game.startup.completed;
  h.advance(120000);
  assert.equal(h.game.startup.progress, progress, 'time spent hidden cannot fill the progress bar');
  assert.equal(h.game.startup.completed, completed, 'hidden frames do not start more preparation tasks');
  startupPointer(h, 195, 400, 'end');
  assert.equal(h.game.page, 'startup');
  assert.ok(h.audio.every(voice => !voice.playing));
  h.callbacks.show(); startupPointer(h, 195, 400, 'end');
  assert.equal(h.game.startup.progress, progress, 'returning to the foreground resets the startup clock');
  assert.equal(h.game.page, 'startup');
  startupPointer(h, 195, 400, 'start');
  h.metrics.width = 320; h.metrics.height = 568; h.metrics.safeTop = 60; h.metrics.safeBottom = 24;
  h.callbacks.resize(); h.game.loop(); startupPointer(h, 195, 400, 'end');
  assert.equal(h.game.page, 'startup');
  h.draw(0); assertStartupContentFits(h); completeStartup(h);
  assert.equal(h.game.page, 'home');
  h.callbacks.hide(); h.callbacks.show(); h.callbacks.resize(); h.game.loop();
  assert.equal(h.game.page, 'home', 'returning to a running game does not repeat the startup notice');
});

test('the notice preserves an ongoing saved route until the player explicitly restores it', t => {
  const original = harness(); t.after(() => original.destroy()); original.start(); original.act('right');
  const state = clone(original.game.state), run = clone(original.game.savedRun()), data = clone(Array.from(original.data));
  const h = harness({ startup: true, data: original.data }); t.after(() => h.destroy());
  assert.equal(h.game.page, 'startup'); assert.equal(h.game.state, null);
  h.callbacks.hide(); h.callbacks.show(); h.advance(10000);
  assert.deepEqual(clone(h.game.savedRun()), run);
  assert.deepEqual(clone(Array.from(h.data)), data);
  completeStartup(h);
  assert.equal(h.game.page, 'home');
  assert.equal(h.game.restore(), true);
  assert.deepEqual(clone(h.game.state), state);
  assert.deepEqual(clone(h.game.savedRun()), run);
});

test('configured publication information automatically shows every complete page before home, including small screens', t => {
  const publicationInfo = {
    copyrightHolder: '用于自动化测试的完整游戏著作权人名称北京示例科技有限公司',
    publisher: '用于自动化测试的完整出版服务单位名称上海示例数字出版有限公司',
    approvalNumber: '自动化测试批准文号〔2026〕123456789号',
    publicationNumber: '自动化测试出版物号ISBN978-7-000-12345-6',
  };
  for (const metrics of [
    { width: 320, height: 568, pixelRatio: 2, safeTop: 70, safeBottom: 24 },
    { width: 390, height: 844, pixelRatio: 3, safeTop: 60, safeBottom: 34 },
    { width: 768, height: 1024, pixelRatio: 2, safeTop: 24, safeBottom: 20 },
  ]) {
    const h = harness({ startup: true, publicationInfo, metrics, withAudio: true }); t.after(() => h.destroy());
    assertStartupContentFits(h);
    const first = startupText(h);
    for (const line of startupAdvice) assert.ok(first.includes(line));
    assert.equal(Object.values(publicationInfo).some(value => first.includes(value)), false);
    completeStartup(h, 'publication');
    assert.equal(h.game.page, 'publication'); assert.equal(h.game.state, null);
    assert.ok(h.audio.every(voice => !voice.playing));
    const pages = new Map();
    h.draw(0); assertStartupContentFits(h);
    pages.set(h.game.startupPublicationPage || 0, startupText(h));
    assert.equal(h.game.renderer.hits.length, 0, 'publication pages advance automatically');
    h.callbacks.hide(); h.game.finishStartup();
    h.advance(120000);
    assert.equal(h.game.page, 'publication');
    h.callbacks.show();
    assert.equal(h.game.page, 'publication', 'background time cannot consume a publication page');
    assert.equal(h.game.startupPublicationPage || 0, 0);
    for (let frame = 0; h.game.page === 'publication' && frame < 200; frame++) {
      const page = h.game.startupPublicationPage || 0;
      for (const key of ['Enter', ' ', 'Space']) h.callbacks.key(key);
      assert.equal(h.game.page, 'publication');
      assert.equal(h.game.startupPublicationPage || 0, page, 'keys cannot skip a publication page');
      h.draw(0); assertStartupContentFits(h);
      pages.set(page, startupText(h));
      h.advance(100);
    }
    assert.equal(h.game.page, 'home'); assert.equal(h.game.state, null);
    const allText = Array.from(pages.values()).join('');
    for (const value of Object.values(publicationInfo)) {
      for (const line of h.game.renderer.wrapLines(value, 302, 14)) assert.ok(allText.includes(line), 'publication text cannot be truncated: ' + line);
    }
    assert.equal(h.audio.filter(voice => voice.loop && voice.playing).length, 1);
  }
});

test('asynchronous preparation keeps loading below 100 percent until the real operation completes', async t => {
  const h = harness({ startup: true, kind: 'web' }); t.after(() => h.destroy());
  let resolve;
  h.game.startup = new StartupLoader([{ label: '读取游戏资源', run: () => new Promise(done => { resolve = done; }) }]);
  h.advance(100);
  assert.equal(h.game.startup.pending, true);
  for (let frame = 0; frame < 50; frame++) h.advance(100);
  for (const key of ['Enter', ' ', 'Space']) h.callbacks.key(key);
  assert.equal(h.game.page, 'startup'); assert.equal(h.game.state, null);
  assert.ok(h.game.startup.progress < 1, 'elapsed time cannot claim unfinished resources are loaded');
  resolve(); await new Promise(done => setImmediate(done));
  completeStartup(h);
  assert.equal(h.game.startup.progress, 1); assert.equal(h.game.state, null);
  assert.equal(h.soundCalls.some(call => call[0] === 'unlock'), false, 'automatic browser entry does not impersonate an audio-unlocking gesture');
});

test('resizing publication information restarts pagination so every line remains visible before automatic entry', t => {
  const publicationInfo = {
    copyrightHolder: '自动化测试完整著作权人名称北京示例科技有限公司'.repeat(10),
    publisher: '自动化测试完整出版服务单位名称上海示例数字出版有限公司'.repeat(10),
    approvalNumber: '自动化测试批准文号〔2026〕123456789号',
    publicationNumber: '自动化测试出版物号ISBN978-7-000-12345-6',
  };
  const h = harness({ startup: true, publicationInfo }); t.after(() => h.destroy());
  completeStartup(h, 'publication');
  for (let frame = 0; h.game.startupPublicationPage === 0 && frame < 100; frame++) h.advance(100);
  assert.equal(h.game.startupPublicationPage, 1);
  h.metrics.width = 320; h.metrics.height = 568; h.metrics.safeTop = 70; h.metrics.safeBottom = 24;
  h.callbacks.resize(); h.game.loop();
  assert.equal(h.game.startupPublicationPage, 0, 'new wrapping starts from the first page');
  assert.equal(h.game.startupPublicationMs, 0, 'the resized first page gets its full reading time');
  const pages = new Map(), pageCount = h.game.startupPublicationPages;
  for (let frame = 0; h.game.page === 'publication' && frame < 500; frame++) {
    h.draw(0); assertStartupContentFits(h);
    pages.set(h.game.startupPublicationPage, startupText(h));
    h.advance(100);
  }
  assert.equal(h.game.page, 'home'); assert.equal(h.game.state, null);
  assert.equal(pages.size, pageCount, 'automatic entry waits for every resized page');
  const allText = Array.from(pages.values()).join('');
  for (const value of Object.values(publicationInfo)) {
    for (const line of h.game.renderer.wrapLines(value, 302, 14)) assert.ok(allText.includes(line), line);
  }
});

test('failed loading exposes a retry action and automatically continues after the real task recovers', t => {
  const h = harness({ startup: true }); t.after(() => h.destroy());
  let attempts = 0;
  h.game.startup = new StartupLoader([{ label: '读取游戏资源', run: () => { if (++attempts === 1) throw new Error('offline'); } }]);
  h.advance(100); h.draw(0);
  assert.equal(h.game.page, 'startup'); assert.equal(h.game.startup.ready, false);
  assert.equal(h.game.renderer.hits.length, 1);
  assert.ok(startupText(h).includes('重新加载'));
  const hit = h.game.renderer.hits[0];
  startupPointer(h, hit.x + hit.w / 2, hit.y + hit.h / 2, 'start');
  startupPointer(h, hit.x + hit.w / 2, hit.y + hit.h / 2, 'end');
  assert.equal(h.game.startup.error, null);
  completeStartup(h);
  assert.equal(attempts, 2); assert.equal(h.game.state, null);
});

test('selecting the ongoing level resumes its route and guide while explicit restart begins again', () => {
  const h = harness({ guide: true }); h.start();
  h.act('right'); h.act('right'); h.game.undo();
  const state = clone(h.game.state), run = clone(h.game.store.loadRun());
  h.game.openPage('levels'); h.draw(500);
  assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '进行中'));
  assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '继续投递'));
  assert.equal(h.game.selectLevel(1), true);
  assert.deepEqual(h.game.state, state);
  assert.deepEqual(h.game.store.loadRun(), run);
  assert.equal(h.game.undosUsed, 1);
  assert.equal(h.game.guideEnabled, true);
  const reloaded = harness({ data: h.data, guide: true });
  reloaded.game.openPage('levels');
  assert.equal(reloaded.game.selectLevel(1), true);
  assert.deepEqual(reloaded.game.state, state);
  assert.equal(reloaded.game.undosUsed, 1);
  assert.equal(reloaded.game.guideStep().step, h.game.guideStep().step);
  reloaded.game.pause();
  reloaded.game.modal.buttons.find(button => button.text === '重新开始').action();
  assert.equal(reloaded.game.state.turn, 0);
  assert.equal(reloaded.game.undosUsed, 0);
  assert.deepEqual(reloaded.game.actions, []);
  h.destroy(); reloaded.destroy();
});

test('a temporary score write failure recovers on backgrounding without losing the unlocked next route', () => {
  for (const enterNext of [false, true]) {
    const h = harness(); h.start();
    const save = h.platform.storage.set;
    let unavailable = true;
    h.platform.storage.set = (key, value) => {
      if (key === PROFILE_KEY && unavailable) throw new Error('temporarily unavailable');
      return save(key, value);
    };
    CAMPAIGN[0].solution.forEach(action => h.act(action));
    assert.equal(h.game.state.status, 'won');
    assert.equal(h.game.store.getStatus().persisted, false);
    if (enterNext) {
      h.game.modal.buttons[0].action();
      h.act(CAMPAIGN[1].solution[0]);
    }
    const state = clone(h.game.state);
    unavailable = false;
    h.callbacks.hide();
    assert.equal(h.game.store.getStatus().persisted, true);
    const reloaded = harness({ data: h.data });
    assert.deepEqual(reloaded.game.profile().completed['1'], { stars: 3, bestTurns: 4 });
    assert.equal(reloaded.game.unlocked(1), true);
    assert.equal(reloaded.game.restore(), enterNext);
    if (enterNext) assert.deepEqual(reloaded.game.state, state);
    else assert.equal(reloaded.game.savedRun(), null);
    h.destroy(); reloaded.destroy();
  }
});

test('WeChat page and dialog entrances draw at 60 FPS then restore 30 FPS when settled', () => {
  const h = harness();
  h.advance(400);
  const draw = h.game.renderer.draw.bind(h.game.renderer), drawnAt = [];
  h.game.renderer.draw = (...args) => { drawnAt.push(h.platform.now()); draw(...args); };
  const frame = ms => { h.advance(ms, false); h.callbacks.frame(); };
  assert.equal(h.frameRates.at(-1), 30);
  frame(1000 / 60);
  assert.equal(drawnAt.length, 0, 'home still skips alternate 60 Hz callbacks');
  frame(1000 / 60);
  assert.equal(drawnAt.length, 1);

  for (const page of ['levels', 'collection']) {
    h.game.openPage(page);
    const before = drawnAt.length;
    for (const ms of [1000 / 60, 15, 17, 8]) frame(ms);
    assert.equal(h.frameRates.at(-1), 60, page);
    assert.equal(drawnAt.length, before + 4, page + ' draws every callback despite small RAF timing variation');
    frame(700);
    assert.equal(h.frameRates.at(-1), 30, page + ' returns to idle cadence when its entrance settles');
  }

  h.game.help();
  let before = drawnAt.length;
  frame(1000 / 60);
  assert.equal(h.frameRates.at(-1), 60, 'a newly opened menu dialog has a short smooth entrance');
  assert.equal(drawnAt.length, before + 1);
  frame(300);
  assert.equal(h.frameRates.at(-1), 30, 'the dialog stops requesting smooth frames after its entrance');
  h.game.modal = null;
  frame(34);
  assert.equal(h.frameRates.at(-1), 30, 'closing a settled dialog does not restart the list entrance');

  h.game.home();
  before = drawnAt.length;
  frame(1000 / 60);
  assert.equal(h.frameRates.at(-1), 60);
  assert.equal(drawnAt.length, before + 1, 'returning home gets the same brief page entrance');
  frame(300);
  assert.equal(h.frameRates.at(-1), 30);
  before = drawnAt.length;
  frame(1000 / 60);
  assert.equal(drawnAt.length, before, 'settled home skips alternate 60 Hz callbacks');
  frame(1000 / 60);
  assert.equal(drawnAt.length, before + 1);
  h.destroy();
});

test('browser idle scenery paints at 30 FPS while input and active scrolling remain responsive', t => {
  for (const quiet of [false, true]) {
    const h = harness({ kind: 'browser' }); t.after(() => h.destroy());
    h.platform.reducedMotion = quiet;
    h.advance(400);
    let paints = 0;
    const draw = h.game.renderer.draw.bind(h.game.renderer);
    h.game.renderer.draw = (...args) => { paints++; draw(...args); };
    const frame = () => { h.advance(1000 / 60, false); h.callbacks.frame(); };
    h.game.lastFrame = h.platform.now();
    for (let i = 0; i < 60; i++) frame();
    assert.equal(paints, 30, 'idle browser backgrounds no longer redraw 60 times a second');
    h.game.openPage('levels'); frame();
    h.advance(700, false); frame();
    paints = 0; h.game.lastFrame = h.platform.now();
    for (let i = 0; i < 60; i++) frame();
    assert.equal(paints, 30, 'settled lists use the same idle cadence in either motion mode');
    h.game.levelScroll.touching = true;
    paints = 0;
    for (let i = 0; i < 6; i++) frame();
    assert.equal(paints, quiet ? 3 : 6,
      quiet ? 'reduced motion caps active lists at 30 FPS' : 'a held list still paints each incoming frame');
  }
});

test('backgrounding resumes decorative phases without changing action feedback deadlines', t => {
  const h = harness(); t.after(() => h.destroy());
  h.draw(1000);
  const homeTime = h.game.renderer.ambientNow;
  h.callbacks.hide(); h.advance(60000, false); h.callbacks.show();
  assert.equal(h.game.renderer.ambientNow, homeTime, 'home scenery resumes exactly where it stopped');
  h.start(); h.draw(1200);
  const poses = [];
  h.game.renderer.courier = (...pose) => poses.push(pose);
  h.act('right'); h.draw(50);
  assert.equal(poses.find(pose => !pose[3])[4].moving, true,
    'new player movement still uses its real deadline after a long suspension');
  assert.equal(h.game.state.turn, 1);
  poses.length = 0; h.draw(MOVE_MS);
  assert.equal(poses.find(pose => !pose[3])[4].moving, false, 'arrival is not delayed by the paused scenery clock');
});

test('native music stays enabled across navigation and full animations remain enabled', () => {
  const h = harness({ withAudio: true });
  assert.equal(h.game.renderer.reducedMotion, false);
  const background = h.audio[0];
  assert.equal(background.loop, true);
  assert.equal(background.playing, true);
  h.game.cue('tap');
  h.game.openPage('collection');
  assert.equal(background.playing, true);
  assert.equal(background.destroyed, false);
  assert.equal(h.audio.filter(voice => voice.loop).length, 1);
  assert.ok(h.audio.some(voice => !voice.loop && voice.playing));
  h.callbacks.hide();
  assert.ok(h.audio.every(voice => !voice.playing));
  h.callbacks.show(); h.advance(500);
  assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 1);
  h.game.home();
  assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 1);
  h.destroy();
});

test('ads, backgrounding and system interruptions stay silent until every blocker ends', async () => {
  for (const order of ['close-first', 'foreground-first', 'interruption-first']) {
    const h = harness({ withAudio: true }); h.start();
    for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
    const pending = h.game.requestRevive();
    await Promise.resolve();
    h.callbacks.audioBegin(); h.callbacks.hide();
    assert.ok(h.audio.every(voice => !voice.playing));
    const count = h.audio.length;
    h.game.unlockAudio(); h.game.cue('tap');
    assert.equal(h.audio.length, count);
    if (order === 'foreground-first') h.callbacks.show();
    if (order === 'interruption-first') h.callbacks.audioEnd();
    assert.ok(h.audio.every(voice => !voice.playing), 'an open ad always owns the audio');
    h.closeAd(true); await pending;
    assert.equal(h.game.state.revived, true);
    assert.ok(h.audio.every(voice => !voice.playing), 'ad completion cannot clear another blocker');
    if (order !== 'foreground-first') h.callbacks.show();
    if (order !== 'interruption-first') h.callbacks.audioEnd();
    h.callbacks.show(); h.callbacks.audioEnd(); h.game.unlockAudio();
    if (order !== 'foreground-first') {
      assert.equal(h.game.modal.kind, 'pause', 'a relight completed in the background waits for the player');
      assert.ok(h.audio.every(voice => !voice.playing), 'returning to the pause panel remains quiet');
      h.game.pause();
    }
    assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 1, order);
    assert.equal(h.audio.filter(voice => voice.playing && !voice.loop).length, 0, 'old effects are never replayed');
    h.destroy();
  }
});

test('ad completion restores music immediately and cancelled or failed ads allow a clean retry', async () => {
  for (const outcome of ['completed', 'cancelled', 'load-failed']) {
    const h = harness({ withAudio: true }); h.start();
    for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
    if (outcome === 'load-failed') {
      h.ad.show = () => Promise.reject(new Error('unavailable'));
      h.ad.load = () => Promise.reject(new Error('no inventory'));
    }
    const pending = h.game.requestRevive();
    assert.ok(h.audio.every(voice => !voice.playing));
    await Promise.resolve();
    h.game.unlockAudio(); h.game.cue('tap');
    assert.ok(h.audio.every(voice => !voice.playing));
    if (outcome !== 'load-failed') h.closeAd(outcome === 'completed');
    await pending;
    assert.equal(h.game.ads.isActive(), false);
    assert.equal(h.game.busy, false);
    if (outcome !== 'completed') {
      assert.ok(h.audio.every(voice => !voice.playing), 'the failure dialog remains quiet');
      h.start(); h.advance(200);
    }
    assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 1, outcome);
    h.destroy();
  }
});

test('SDK errors during close cleanup or after a completed close cannot change the earned revive', async () => {
  for (const timing of ['cleanup', 'after-close']) {
    const h = harness({ withAudio: true }); h.start();
    while (h.game.state.status === 'playing') h.act('wait');
    const before = clone(h.game.state);
    const offClose = h.ad.offClose;
    h.ad.offClose = handler => {
      offClose(handler);
      if (timing === 'cleanup') h.failAd({ errCode: 1003, errMsg: 'SDK error during close cleanup' });
    };
    const pending = h.game.requestRevive(); await Promise.resolve();
    h.closeAd(true);
    if (timing === 'after-close') h.failAd({ errCode: 1004, errMsg: 'no ad for next preload' });
    await pending;
    assert.deepEqual(h.game.state, { ...before, energy: SUPPLY_ENERGY, status: 'playing', revived: true, reviveCount: 1 });
    assert.deepEqual(h.game.store.loadRun().reviveHistory, [before.turn]);
    assert.equal(h.game.busy, false);
    assert.equal(h.game.ads.isActive(), false);
    assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 1);
    while (h.game.state.status === 'playing') h.act('wait');
    const secondFailure = clone(h.game.state);
    const retry = h.game.requestRevive(); await Promise.resolve(); h.closeAd(false); await retry;
    assert.deepEqual(h.game.state, secondFailure, 'a later cancelled ad cannot add another revive');
    assert.equal(h.showCount, 2, 'the next user request can still display an ad');
    h.destroy();
  }
});

test('an ad timeout cannot unmute a video that has not closed or award a late revive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ withAudio: true }); h.start();
  for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
  const pending = h.game.requestRevive();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  t.mock.timers.tick(15 * 60 * 1000 + 1);
  await pending;
  assert.equal(h.game.busy, false);
  assert.equal(h.game.ads.isActive(), true);
  h.game.home(); h.game.unlockAudio(); h.advance(200);
  assert.ok(h.audio.every(voice => !voice.playing));
  h.closeAd(true);
  assert.equal(h.game.state.revived, false);
  assert.equal(h.game.ads.isActive(), false);
  assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 1);
  h.destroy();
});

test('saved experience settings independently control music, sounds and effective motion', () => {
  const completed = { 1: { stars: 3, bestTurns: 8 } };
  const data = new Map([[PROFILE_KEY, { version: 1, completed, daily: {}, totalWins: 1,
    settings: { music: false, sound: false, haptics: false, reducedMotion: true } }]]);
  const h = harness({ withAudio: true, data });
  assert.deepEqual(h.game.profile().settings,
    { music: false, sound: false, haptics: false, reducedMotion: true });
  assert.equal(h.game.renderer.reducedMotion, true);
  assert.deepEqual(h.game.profile().completed, completed);
  assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 0);
  h.game.cue('tap');
  assert.equal(h.audio.filter(voice => voice.playing && !voice.loop).length, 0);
  h.game.toggle('music');
  assert.equal(h.audio.filter(voice => voice.playing && voice.loop).length, 1);
  h.game.toggle('sound');
  assert.equal(h.audio.filter(voice => voice.playing && !voice.loop).length, 1);
  assert.ok(h.audio.some(voice => voice.playing && /toggle\.wav$/.test(voice.src)), 'enabling sound previews the setting response');
  h.game.cue('tap');
  assert.equal(h.audio.filter(voice => voice.playing && !voice.loop).length, 2, 'a separate action can overlap its short confirmation');
  h.game.toggle('reducedMotion'); h.draw();
  assert.equal(h.game.renderer.reducedMotion, false);
  const reloaded = harness({ data });
  assert.deepEqual(reloaded.game.profile().settings,
    { music: true, sound: true, haptics: false, reducedMotion: false });
  h.destroy(); reloaded.destroy();
});

test('reduced motion combines the saved choice with the live system preference and caps frame rate', () => {
  const h = harness({ kind: 'browser' });
  const frame = () => { h.advance(1000 / 60, false); h.callbacks.frame(); };
  h.platform.reducedMotion = true;
  h.game.openPage('levels'); h.game.levelScroll.touching = true;
  frame(); h.draw();
  assert.equal(h.game.reducedMotion(), true);
  assert.equal(h.game.renderer.reducedMotion, true);
  assert.equal(h.frameRates.at(-1), 30);
  h.platform.reducedMotion = false; h.game.toggle('reducedMotion');
  frame(); h.draw();
  assert.equal(h.game.reducedMotion(), true, 'the saved choice works without a system preference');
  assert.equal(h.frameRates.at(-1), 30);
  h.game.toggle('reducedMotion'); frame();
  assert.equal(h.game.reducedMotion(), false);
  assert.equal(h.frameRates.at(-1), 60, 'active scrolling can use 60 FPS after both preferences are off');
  h.destroy();
});

test('disabling haptics stops only hardware vibration and retains visual collection feedback', () => {
  for (const enabled of [true, false]) {
    const h = harness({ kind: 'wechat' }), level = CAMPAIGN[0];
    if (!enabled) h.game.toggle('haptics');
    h.start(level); h.draw(900);
    level.solution.slice(0, 3).forEach(action => h.act(action));
    assert.equal(h.vibrations > 0, enabled);
    const camera = h.game.camera, baseline = { panX: camera.panX, panY: camera.panY };
    h.draw(45);
    const view = h.game.renderer.boardGeometry.view;
    assert.ok(Math.hypot(view.panX - baseline.panX, view.panY - baseline.panY) > 0,
      'canvas feedback remains visible when hardware vibration is ' + (enabled ? 'on' : 'off'));
    h.destroy();
  }
});

test('clearing local data requires confirmation and accurately resets the current environment only', () => {
  const h = harness();
  h.game.store.recordWin(1, 3, 4); h.start(); h.game.toggle('sound');
  h.game.openPage('settings');
  assert.equal(h.game.resetPrompt(), true);
  assert.equal(h.game.profile().totalWins, 1, 'opening the confirmation does not clear anything');
  assert.match(h.game.modal.lines.join(''), /正式版本.*通关记录.*体验设置/);
  assert.match(h.game.modal.lines.join(''), /排行榜.*不会随之删除/);
  h.game.modal.buttons[0].action();
  assert.equal(h.game.profile().totalWins, 1, 'the primary cancellation keeps local data');
  h.game.resetPrompt(); h.game.modal.buttons[1].action();
  assert.equal(h.game.page, 'home');
  assert.equal(h.game.savedRun(), null);
  assert.deepEqual(h.game.profile(), {
    version: 1, completed: {}, daily: {},
    settings: { sound: true, music: true, haptics: true, reducedMotion: false }, totalWins: 0,
  });
  assert.match(h.game.toastText, /本机数据已清除.*恢复默认/);
  h.destroy();
});

test('real turn events select distinct sounds without replaying outcomes after undo or review', () => {
  const h = harness(); h.start(); h.soundCalls.length = 0;
  h.act('up');
  assert.deepEqual(h.soundCalls.filter(call => call[0] === 'play'), [['play', 'blocked']]);
  h.act('wait');
  assert.equal(h.soundCalls.at(-1)[1], 'wait');
  h.game.undo();
  assert.equal(h.soundCalls.at(-1)[1], 'undo');
  assert.deepEqual(h.game.moveEvents, [{ type: 'undo', cell: h.game.state.player }]);
  h.start(); h.soundCalls.length = 0;
  for (const action of CAMPAIGN[0].solution) h.act(action);
  const sounds = h.soundCalls.filter(call => call[0] === 'play').map(call => call[1]);
  assert.ok(sounds.includes('letter'));
  assert.equal(sounds.at(-1), 'win', 'the last stamp shares a turn with delivery, so its result cue takes priority');
  assert.equal(sounds.filter(type => type === 'win').length, 1);
  const count = h.soundCalls.length;
  h.game.victory();
  assert.equal(h.soundCalls.length, count, 'opening the result does not replay its jingle');
});

test('result effects preserve earned stars and saves, fit small screens and allow immediate next-level taps', t => {
  for (const [waits, earned] of [[0, 3], [1, 2], [3, 1]]) {
    const h = harness({ guide: waits === 0, metrics: { width: 320, height: 568, pixelRatio: 2, safeTop: 70, safeBottom: 20 } });
    t.after(() => h.destroy()); h.start();
    for (let i = 0; i < waits; i++) h.act('wait');
    CAMPAIGN[0].solution.forEach(action => h.act(action));
    assert.equal(h.game.modal.stars, earned);
    const snapshot = clone({ state: h.game.state, profile: h.game.profile(), actions: h.game.actions, data: Array.from(h.data) });
    const soundCount = h.soundCalls.length, ages = [];
    const renderer = h.game.renderer, modal = renderer.modal.bind(renderer);
    let bounds;
    renderer.modal = (value, now, age) => { ages.push(age); bounds = modal(value, now, age); return bounds; };
    h.draw(399);
    assert.equal(ages.length, 0, 'the final move gets its existing 400 ms presentation');
    assert.equal(renderer.hits.length, 0, 'the covered board has no active hit targets');
    h.draw(1);
    assert.equal(ages.at(-1), 0);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.h <= renderer.H, 'the result fits the smallest supported phone');
    assert.ok(h.game.modal.buttons.every(button => renderer.hits.some(hit => hit.action === button.action)), 'every action is available on the first visible result frame');
    const next = renderer.hits.find(hit => hit.action === h.game.modal.buttons[0].action);
    for (const ms of [120, 330, 750, 3800]) h.draw(ms);
    assert.deepEqual(clone({ state: h.game.state, profile: h.game.profile(), actions: h.game.actions, data: Array.from(h.data) }), snapshot);
    assert.equal(h.soundCalls.length, soundCount, 'drawing and finishing the animation do not replay feedback');

    const icons = [], icon = renderer.icon.bind(renderer);
    renderer.icon = (...args) => { icons.push(args); icon(...args); };
    drawResultStars(renderer, h.game.modal.stars, bounds.y + bounds.starsY, null);
    assert.equal(icons.filter(args => args[0] === 'star' && args[4] === C.yellow).length, earned, 'the final row lights only the stars actually earned');
    renderer.icon = icon;

    const resultDraws = ages.length;
    const x = renderer.ox + (next.x + next.w / 2) * renderer.scale;
    const y = renderer.oy + (next.y + next.h / 2) * renderer.scale;
    h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x, y, 'end');
    assert.equal(h.game.level.id, 2);
    assert.equal(h.game.modal, null);
    h.draw(1);
    assert.equal(ages.length, resultDraws, 'no result overlay survives into the next level');
  }
});

test('failed result effects keep the original turn time across review, ads and backgrounding', async t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  for (let i = 0; i < CAMPAIGN[0].budget; i++) h.act('wait');
  const renderer = h.game.renderer, modal = renderer.modal.bind(renderer), ages = [];
  renderer.modal = (value, now, age) => { ages.push({ kind: value.kind, age }); return modal(value, now, age); };
  h.draw(400);
  assert.deepEqual(ages.at(-1), { kind: 'fail', age: 0 });
  assert.ok(h.game.modal.buttons.every(button => renderer.hits.some(hit => hit.action === button.action)), 'failure actions are immediately available too');
  h.game.modal.buttons.find(button => /刚才的路线/.test(button.text)).action();
  h.draw(500);
  assert.equal(ages.length, 1);
  h.game.pause(); h.draw(0);
  assert.deepEqual(ages.at(-1), { kind: 'fail', age: 500 }, 'reviewing does not restart the effect');

  let pending = h.game.requestRevive(); await Promise.resolve();
  h.draw(100);
  assert.equal(ages.at(-1).age, null, 'the ad loading dialog is not an outcome');
  h.advance(1200, false); h.closeAd(false); await pending; h.draw(0);
  assert.deepEqual(ages.at(-1), { kind: 'fail', age: 1800 }, 'cancelling an ad does not replay failure');
  h.callbacks.hide(); h.advance(4000, false); h.callbacks.show();
  assert.deepEqual(ages.at(-1), { kind: 'fail', age: 5800 }, 'returning from the background expires the effect instead of restarting it');
  assert.equal(h.soundCalls.filter(call => call[0] === 'play' && call[1] === 'fail').length, 1);

  pending = h.game.requestRevive(); await Promise.resolve(); h.closeAd(true); await pending;
  const resultDraws = ages.length;
  h.draw(0);
  assert.equal(h.game.state.status, 'playing');
  assert.equal(ages.length, resultDraws, 'a relit route has no leftover failure effect');
  for (let i = h.game.state.energy; i > 0; i--) h.act('wait');
  h.draw(400);
  assert.deepEqual(ages.at(-1), { kind: 'fail', age: 0 }, 'a new real failure gets its own effect');
  h.game.modal.buttons.find(button => /免费再试/.test(button.text)).action(); h.draw(0);
  assert.equal(h.game.modal, null);
  assert.equal(h.game.state.turn, 0);
});

test('restored failures are static and outcome decorations stop after their short presentation', t => {
  const h = harness(); t.after(() => h.destroy()); h.start();
  for (let i = 0; i < CAMPAIGN[0].budget; i++) h.act('wait');
  const restored = harness({ data: h.data }); t.after(() => restored.destroy());
  assert.equal(restored.game.restore(), true);
  const renderer = restored.game.renderer, modal = renderer.modal.bind(renderer);
  let age, bounds;
  renderer.modal = (value, now, resultAge) => { age = resultAge; bounds = modal(value, now, resultAge); return bounds; };
  restored.draw(0);
  assert.equal(age, null, 'saved failure has no fresh event to animate');
  assert.ok(renderer.hits.length > 0);
  assert.equal(restored.soundCalls.some(call => call[0] === 'play' && call[1] === 'fail'), false);

  function decoration(kind, resultAge, reducedMotion = false) {
    restored.calls.length = 0; renderer.reducedMotion = reducedMotion;
    drawResultHeader(renderer, kind, bounds, resultAge);
    if (kind === 'win') drawResultStars(renderer, 2, 200, resultAge);
    return clone(restored.calls);
  }
  for (const kind of ['win', 'fail']) {
    const settled = decoration(kind, null);
    assert.notDeepEqual(decoration(kind, 220), settled, kind + ' has visible short feedback');
    assert.deepEqual(decoration(kind, 5000), settled, kind + ' stops animating instead of looping');
    assert.deepEqual(decoration(kind, 9000), settled);
    assert.deepEqual(decoration(kind, 220, true), settled, 'reduced motion renders the final state');
  }
});

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

test('all 999 campaign routes clear with three stars through the real next-level flow without revives', t => {
  assert.equal(CAMPAIGN.length, 999);
  const h = harness({ configured: false, mechanics: true });
  const introductions = [];
  t.after(() => h.destroy());
  assert.equal(h.game.development, false);
  assert.equal(h.game.completion(), 0);
  h.game.primary();

  for (const [index, level] of CAMPAIGN.entries()) {
    const label = `level ${level.id}`;
    assert.equal(h.game.page, 'game', label);
    assert.equal(h.game.mode, 'campaign', label);
    assert.equal(h.game.level, level, label + ' starts from the preceding result button');
    assert.equal(h.game.modal, null, label);
    assert.equal(h.game.state.energy, level.budget, label + ' uses its original budget');
    assert.equal(h.game.unlocked(index), true, label);
    if (index + 1 < CAMPAIGN.length) assert.equal(h.game.unlocked(index + 1), false, label + ' has not unlocked its successor early');

    for (let inspected = 0; h.game.mechanicGuide && inspected < 6; inspected++) {
      const lesson = h.game.guideStep(), before = clone(h.game.state);
      if (lesson.step === 1) introductions.push([level.id, lesson.mechanic]);
      assert.equal(h.game.inspectGuideCell(lesson.visual.tapCell), true);
      assert.deepEqual(h.game.state, before, label + ' teaches without spending a turn or inventing a state');
    }
    assert.equal(h.game.mechanicGuide, null, label + ' returns to normal controls after inspection');

    for (const [stepIndex, action] of level.solution.entries()) {
      assert.equal(h.game.state.status, 'playing', `${label} before step ${stepIndex + 1}`);
      h.act(action);
      assert.equal(h.game.state.turn, stepIndex + 1, `${label} commits step ${stepIndex + 1}: ${action}`);
    }

    assert.equal(h.game.state.status, 'won', label);
    assert.equal(h.game.state.player, level.exit, label);
    assert.equal(h.game.state.letters.length + h.game.state.seals.length, 0, label + ' delivers every required collectible');
    assert.equal(h.game.state.revived, false, label);
    assert.equal(h.game.reviveAt, null, label);
    assert.equal(h.game.undosUsed, 0, label);
    assert.equal(h.showCount, 0, label + ' never requests a rewarded ad');
    assert.equal(h.game.modal.kind, 'win', label);
    assert.equal(h.game.modal.stars, 3, label);
    assert.deepEqual(h.game.profile().completed[String(level.id)], { stars: 3, bestTurns: level.solution.length }, label);
    assert.equal(h.game.completion(), index + 1, label);
    assert.equal(h.game.store.loadRun(), null, label + ' clears the completed run');
    assert.equal(h.data.has(RUN_KEY), false, label);

    const next = h.game.modal.buttons[0];
    if (index + 1 < CAMPAIGN.length) {
      assert.equal(h.game.unlocked(index + 1), true, label + ' unlocks its successor');
      assert.equal(h.game.nextLevel().id, CAMPAIGN[index + 1].id, label);
      assert.equal(next.text, '下一封信', label);
    } else {
      assert.equal(next.text, '返回邮局', label);
      assert.equal(h.game.modal.buttons.some(button => button.text === '下一封信'), false, label);
    }
    next.action();
  }

  assert.equal(h.game.page, 'home');
  assert.equal(h.game.completion(), 999);
  assert.equal(h.game.starCount(), 2997);
  assert.deepEqual(introductions, [[13, 'wind'], [16, 'bridge'], [19, 'light']]);
  assert.equal(h.game.unlocked(999), false, 'there is no thousandth campaign level');
  const reloaded = harness({ data: h.data, configured: false });
  t.after(() => reloaded.destroy());
  assert.equal(reloaded.game.completion(), 999);
  assert.equal(reloaded.game.starCount(), 2997);
  assert.equal(reloaded.game.profile().totalWins, 999);
  assert.deepEqual(reloaded.game.profile().completed, h.game.profile().completed);
  assert.equal(reloaded.game.store.loadRun(), null);
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

test('cancelled ads do not revive and the same route can relight repeatedly across relaunches', async () => {
  const h = harness(); h.start();
  for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
  assert.equal(h.game.state.status, 'failed');
  const failed = clone(h.game.state);
  assert.match(h.game.modal.buttons[0].text, /看广告续灯 \+6 拍/);
  assert.ok(h.game.modal.lines.some(line => line.includes('每次视频补 6 拍')));
  let pending = h.game.requestRevive();
  await Promise.resolve();
  assert.equal(h.game.busy, true);
  const soundCount = h.soundCalls.length;
  h.game.cue('tap');
  assert.equal(h.soundCalls.length, soundCount, 'a button release cannot restart audio after the ad stops it');
  h.act('right');
  h.closeAd(false); await pending;
  assert.deepEqual(h.game.state, failed);
  assert.equal(h.game.state.revived, false);
  assert.equal(h.game.modal.kind, 'fail');
  pending = h.game.requestRevive(); await Promise.resolve();
  h.closeAd(true); await pending;
  assert.equal(h.game.state.status, 'playing');
  assert.equal(h.game.state.revived, true);
  assert.equal(h.game.state.energy, SUPPLY_ENERGY);
  assert.match(h.game.toastText, /已增加 6 拍/);
  assert.equal(h.game.reviveAt, failed.turn);
  assert.deepEqual(h.game.state, { ...failed, energy: SUPPLY_ENERGY, status: 'playing', revived: true, reviveCount: 1 });
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.deepEqual(reloaded.game.state, h.game.state);
  for (let count = 2; count <= 3; count++) {
    while (reloaded.game.state.status === 'playing') reloaded.act('wait');
    assert.equal(reloaded.game.modal.buttons.some(button => button.text.includes('看广告')), true);
    const before = clone(reloaded.game.state);
    pending = reloaded.game.requestRevive(); await Promise.resolve();
    reloaded.closeAd(true); await pending;
    assert.deepEqual(reloaded.game.state, { ...before, energy: SUPPLY_ENERGY, status: 'playing', reviveCount: count });
    assert.equal(reloaded.game.reviveHistory.length, count);
    assert.deepEqual(reloaded.game.store.loadRun().reviveHistory, reloaded.game.reviveHistory);
  }
  assert.equal(reloaded.showCount, 2);
  const resumed = harness({ data: reloaded.data });
  assert.equal(resumed.game.restore(), true);
  assert.deepEqual(resumed.game.state, reloaded.game.state);
  assert.deepEqual(resumed.game.reviveHistory, reloaded.game.reviveHistory);
  resumed.game.help();
  assert.ok(resumed.game.modal.sections.some(section => /已续灯 3 次/.test(section.text)));
  resumed.game.modal.buttons[0].action();
  const boundary = resumed.game.state.turn;
  resumed.act('right'); resumed.game.undo();
  assert.equal(resumed.game.state.turn, boundary);
  assert.equal(resumed.game.state.reviveCount, 3);
  assert.equal(resumed.game.canUndo(), false, 'undo stops at the most recent relight');
  CAMPAIGN[0].solution.forEach(action => resumed.act(action));
  assert.equal(resumed.game.state.status, 'won');
  assert.equal(resumed.game.modal.stars, 1);
  assert.ok(resumed.game.modal.lines.some(line => /续灯 3 次/.test(line)));
  assert.ok(resumed.game.modal.lines.some(line => /总拍数超过.*本次获一星/.test(line)));
  assert.equal(resumed.game.profile().completed['1'].bestTurns, boundary + CAMPAIGN[0].par);
  assert.equal(resumed.game.profile().totalWins, 1);
  assert.equal(resumed.game.unlocked(1), true);
  assert.equal(resumed.game.store.loadRun(), null);
  h.destroy(); reloaded.destroy(); resumed.destroy();
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

test('an irrecoverable bridge route never offers or starts an ad and can restart for free', async () => {
  const h = harness({ development: true }), level = { ...CAMPAIGN[20], width: 4, height: 1,
    start: 0, exit: 3, letters: [3], seals: [], walls: [2], bridges: [1], lights: [], winds: {}, budget: 4 };
  h.start(level); h.act('right'); h.act('left');
  assert.equal(h.game.state.inventory.bridge, 0, 'no completed item video means no repair charge');
  while (h.game.state.status === 'playing') h.act('wait');
  const failed = clone(h.game.state);
  assert.equal(failed.status, 'failed');
  assert.ok(h.game.modal.lines.some(line => /补拍也无法送达/.test(line)));
  assert.equal(h.game.modal.buttons.some(button => /看广告/.test(button.text)), false);
  await h.game.requestRevive();
  assert.equal(h.showCount, 0);
  assert.deepEqual(h.game.state, failed);
  const retry = h.game.modal.buttons.find(button => /免费再试/.test(button.text));
  assert.equal(retry.primary, true);
  retry.action();
  assert.equal(h.game.state.status, 'playing');
  assert.deepEqual(h.game.state.bridges, level.bridges);
  assert.equal(h.game.state.revived, false);
  h.destroy();
});

test('a broken route can relight then acquire its repair with a separate explicitly disclosed video', async t => {
  const h = harness(); t.after(() => h.destroy()); h.start(CAMPAIGN[20]);
  h.act('left'); h.act('right');
  while (h.game.state.status === 'playing') h.act('wait');
  assert.ok(h.game.modal.lines.some(line => line.includes('另看视频获取')));
  assert.ok(h.game.modal.buttons.some(button => button.text.includes('看广告续灯')));
  const relight = h.game.requestRevive(); await completeItemVideo(h); await relight;
  assert.equal(h.game.state.status, 'playing');
  assert.equal(h.game.state.inventory.bridge, 0, 'relight does not grant an unearned tool');
  h.advance(300); h.game.selectItem('bridge'); h.callbacks.key('Enter');
  h.game.itemTarget(h.game.level.bridges[0]); await completeItemVideo(h);
  assert.equal(h.game.itemRewards.bridge, 1);
  assert.equal(h.showCount, 2);
  h.act('left');
  assert.equal(h.game.state.player, h.game.level.bridges[0]);
});

test('a completed ad belongs to its original failed session and cannot reward a restored route', async () => {
  const h = harness(); h.start();
  while (h.game.state.status === 'playing') h.act('wait');
  const session = h.game.session;
  const pending = h.game.requestRevive(); await Promise.resolve();
  await h.game.requestRevive();
  assert.equal(h.showCount, 1, 'repeated requests cannot display a second video');
  assert.equal(h.game.restore(), true);
  assert.notEqual(h.game.session, session);
  const restored = clone(h.game.state);
  h.closeAd(true); await pending;
  assert.deepEqual(h.game.state, restored);
  assert.equal(h.game.state.revived, false);
  assert.deepEqual(h.game.store.loadRun().reviveHistory, []);
  assert.equal(h.game.busy, false);
  h.destroy();
});

test('a legacy single-relight save upgrades to multiple relights without losing the route', async () => {
  const level = CAMPAIGN[0], first = level.budget;
  const h = harness({ data: new Map([[RUN_KEY, { mode: 'campaign', levelId: level.id,
    revision: level.revision, actions: Array(first + 8).fill('wait'), reviveAt: first, undosUsed: 0 }]]) });
  assert.equal(h.game.restore(), true);
  assert.equal(h.game.state.status, 'failed');
  assert.equal(h.game.state.reviveCount, 1);
  assert.deepEqual(h.game.reviveHistory, [first]);
  const pending = h.game.requestRevive(); await Promise.resolve(); h.closeAd(true); await pending;
  assert.equal(h.game.state.reviveCount, 2);
  assert.deepEqual(h.game.store.loadRun().reviveHistory, [first, first + 8]);
  assert.equal(Object.hasOwn(h.game.store.loadRun(), 'reviveAt'), false);
  h.destroy();
});

test('relit results use total turns and repeated low-star wins preserve personal bests and rewards', async () => {
  const h = harness();
  finishCampaign(h, 1);
  const before = clone(h.game.profile()), stamps = h.game.album().stamps.filter(stamp => stamp.owned).map(stamp => stamp.id);
  const { campaignScore } = require('../src/friend-score');
  const score = campaignScore(before);
  h.start();
  for (let count = 0; count < 2; count++) {
    while (h.game.state.status === 'playing') h.act('wait');
    const pending = h.game.requestRevive(); await Promise.resolve(); h.closeAd(true); await pending;
  }
  const turn = h.game.state.turn;
  CAMPAIGN[0].solution.forEach(action => h.act(action));
  assert.equal(h.game.state.turn, turn + CAMPAIGN[0].par);
  assert.equal(h.game.modal.stars, 1);
  assert.deepEqual(h.game.profile(), before);
  assert.deepEqual(campaignScore(h.game.profile()), score);
  assert.deepEqual(h.game.album().stamps.filter(stamp => stamp.owned).map(stamp => stamp.id), stamps);
  assert.equal(h.game.modal.lines.some(line => /新邮票/.test(line)), false);
  h.game.victory();
  assert.deepEqual(h.game.profile(), before, 'repeated settlement never adds wins or stars');
  h.destroy();
});

test('a real route finishing within the two-star limit still earns two stars after relighting', async () => {
  const h = harness({ development: true }), level = CAMPAIGN[18];
  h.start(level); h.act('wait'); h.act('wait');
  let action = 0;
  while (h.game.state.status === 'playing') h.act(level.solution[action++]);
  assert.equal(h.game.state.status, 'failed');
  assert.ok(action < level.solution.length);
  const pending = h.game.requestRevive(); await Promise.resolve(); h.closeAd(true); await pending;
  assert.equal(h.game.state.reviveCount, 1);
  level.solution.slice(action).forEach(move => h.act(move));
  assert.equal(h.game.state.status, 'won');
  assert.equal(h.game.state.turn, level.par + 2);
  assert.equal(h.game.modal.stars, 2);
  assert.ok(h.game.modal.lines.some(line => /本次获二星/.test(line)));
  assert.equal(h.game.profile().completed[level.id].stars, 2);
  h.destroy();
});


test('a transient profile read failure retries before checking whether the saved route is unlocked', t => {
  const progress = { mode: 'campaign', levelId: 2, revision: CAMPAIGN[1].revision,
    actions: ['right'], reviveHistory: [], undosUsed: 0 };
  const data = new Map([
    [PROFILE_KEY, { version: 1, completed: { 1: { stars: 3, bestTurns: 4 } }, daily: {}, totalWins: 1 }],
    [RUN_KEY, progress]
  ]);
  const get = data.get.bind(data);
  let firstRead = true;
  data.get = key => {
    if (key === PROFILE_KEY && firstRead) { firstRead = false; throw new Error('temporary read failure'); }
    return get(key);
  };
  const h = harness({ data }); t.after(() => h.destroy());
  assert.equal(h.game.store.hasPendingReads(), true);
  h.game.primary();
  assert.equal(h.game.page, 'game');
  assert.equal(h.game.level.id, 2);
  assert.deepEqual(h.game.state, replayed(CAMPAIGN[1], ['right']));
  assert.equal(h.game.store.hasPendingReads(), false);
  assert.deepEqual(h.game.profile().completed['1'], { stars: 3, bestTurns: 4 });
  assert.deepEqual(get(RUN_KEY), { ...progress, itemRewards: { oil: 0, kite: 0, bridge: 0 },
    supplyPolicy: { version: 2, legacyActionCount: 1, legacyReviveCount: 0 } }, 'recovery preserves the route while recording its supply-rule migration');
});

test('unread profile or route data cannot be cleared or replaced by continuing or selecting a level', t => {
  for (const unreadKey of [PROFILE_KEY, RUN_KEY]) for (const entry of ['primary', 'restore', 'selectLevel']) {
    const profile = { version: 1, completed: { 1: { stars: 3, bestTurns: 4 } }, daily: {},
      settings: { sound: true, music: true, haptics: true, reducedMotion: false }, totalWins: 1 };
    const progress = { mode: 'campaign', levelId: 2, revision: CAMPAIGN[1].revision,
      actions: ['right'], reviveHistory: [], undosUsed: 0 };
    const data = new Map([[PROFILE_KEY, clone(profile)], [RUN_KEY, clone(progress)]]), get = data.get.bind(data);
    let unavailable = true;
    data.get = key => {
      if (key === unreadKey && unavailable) throw new Error('storage remains unavailable');
      return get(key);
    };
    const h = harness({ data }); t.after(() => h.destroy());
    h.game[entry](2);
    assert.equal(h.game.page, 'home', entry);
    assert.equal(h.game.state, null, entry + ' cannot silently start a replacement route');
    assert.equal(h.game.store.hasPendingReads(), true);
    assert.match(h.game.toastText, /原存档已保留.*稍后再试/);
    assert.deepEqual(get(PROFILE_KEY), profile);
    assert.deepEqual(get(RUN_KEY), progress);
    unavailable = false;
    h.game[entry](2);
    assert.equal(h.game.page, 'game');
    assert.equal(h.game.level.id, 2);
    assert.deepEqual(h.game.state, replayed(CAMPAIGN[1], ['right']));
    assert.equal(h.game.store.hasPendingReads(), false);
    assert.deepEqual(get(RUN_KEY), { ...progress, itemRewards: { oil: 0, kite: 0, bridge: 0 },
      supplyPolicy: { version: 2, legacyActionCount: 1, legacyReviveCount: 0 } });
  }
});

test('read recovery still starts a new game when storage is empty and never blocks an active route', t => {
  const empty = new Map(), emptyGet = empty.get.bind(empty);
  let unavailable = true;
  empty.get = key => { if (unavailable) throw new Error('temporary read failure'); return emptyGet(key); };
  const fresh = harness({ data: empty }); t.after(() => fresh.destroy());
  unavailable = false;
  fresh.game.primary();
  assert.equal(fresh.game.page, 'game');
  assert.equal(fresh.game.level.id, 1);
  assert.equal(fresh.game.state.turn, 0);

  const savedProfile = { version: 1, completed: { 1: { stars: 3, bestTurns: 4 } }, daily: {}, totalWins: 1 };
  const data = new Map([[PROFILE_KEY, clone(savedProfile)]]), get = data.get.bind(data);
  unavailable = true;
  data.get = key => { if (key === PROFILE_KEY && unavailable) throw new Error('temporary read failure'); return get(key); };
  const active = harness({ data }); t.after(() => active.destroy());
  active.start(); active.act('right');
  assert.equal(active.game.store.hasPendingReads(), true);
  assert.equal(active.game.state.turn, 1, 'normal play does not depend on a recovered profile');
  assert.deepEqual(get(RUN_KEY).actions, ['right'], 'the current playable route is still persisted');
  assert.deepEqual(get(PROFILE_KEY), savedProfile, 'an unread profile is never overwritten with empty defaults');
  unavailable = false;
  active.callbacks.hide();
  assert.equal(active.game.store.hasPendingReads(), false);
  assert.deepEqual(active.game.profile().completed, savedProfile.completed);
  assert.deepEqual(get(RUN_KEY).actions, ['right']);
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

test('every campaign screen renders finite geometry on small phones and tablets', () => {
  for (const metrics of [
    { width: 320, height: 568, pixelRatio: 2, safeTop: 70, safeBottom: 20 },
    { width: 390, height: 844, pixelRatio: 3, safeTop: 88, safeBottom: 34 },
    { width: 768, height: 1024, pixelRatio: 2, safeTop: 70, safeBottom: 20 }
  ]) {
    const h = harness({ metrics });
    for (const level of CAMPAIGN) {
      h.start(level, 'campaign'); h.draw();
      assert.ok(h.game.renderer.boardRect.w > 240);
      const controls = h.game.renderer.hits.filter(hit => hit.w === 165 && hit.h === 52);
      assert.equal(controls.length, 1, 'only wait is clickable before the first move');
      assert.equal(controls[0].x, 201, 'the disabled undo button has no click target');
      const boardBottom = h.game.renderer.boardRect.y + h.game.renderer.boardRect.h;
      assert.ok(controls.every(hit => hit.y > boardBottom && hit.y + hit.h <= h.game.renderer.H));
      assert.equal(h.calls.some(call => call.method === 'fillText' && call.args[0] === '回声预告'), false);
      h.game.help(); h.draw();
    }
    for (const page of ['home', 'levels', 'collection']) { h.game.openPage(page); h.draw(); }
    h.destroy();
  }
});

test('the first route starts without a modal and explains the real echo countdown', () => {
  const h = harness(); h.start();
  assert.equal(h.game.modal, null);
  assert.match(h.game.playHint(), /相邻地砖.*蓝票/);
  h.act('right');
  assert.equal(h.game.state.player, CAMPAIGN[0].seals[0]);
  assert.equal(h.game.state.echo, null);
  assert.match(h.game.playHint(), /再走 3 拍/);
  h.act('right');
  assert.match(h.game.playHint(), /再走 2 拍/);
  h.act('right');
  assert.deepEqual(h.game.state.seals, CAMPAIGN[0].seals);
  assert.match(h.game.playHint(), /下一步回声会收起蓝票/);
  h.game.undo();
  assert.match(h.game.playHint(), /再走 2 拍/, 'undo must restore the countdown from replayed history');
  h.act('right');
  h.act('wait');
  assert.deepEqual(h.game.state.seals, []);
  assert.match(h.game.playHint(), /收集完成.*邮局/);
  h.start();
  assert.equal(h.game.modal, null, 'retry does not reopen a tutorial popup');
  h.destroy();
});

test('first-route guidance depends on that route and the dismissal preference, not unrelated wins', () => {
  const score = { stars: 3, bestTurns: 4 };
  const profiles = [
    { name: 'fresh profile', profile: {}, enabled: true },
    { name: 'another campaign win', profile: { completed: { 2: score } }, enabled: true },
    { name: 'archived daily win', profile: { daily: { '2026-09-08': score } }, enabled: true },
    { name: 'first route completed', profile: { completed: { 1: score } }, enabled: false },
    { name: 'explicitly dismissed', profile: { guideDismissed: true }, enabled: false }
  ];
  for (const scenario of profiles) {
    const profile = { version: 1, completed: {}, daily: {}, ...scenario.profile };
    const h = harness({ guide: true, data: new Map([[PROFILE_KEY, profile]]) });
    h.start();
    assert.equal(h.game.guideEnabled, scenario.enabled, scenario.name);
    assert.equal(!!h.game.guideStep(), scenario.enabled, scenario.name);
    assert.equal(h.game.modal, null, 'guidance starts on the real board');
    h.start(CAMPAIGN[1]);
    assert.equal(h.game.guideEnabled, false, 'later routes retain free play');
    h.destroy();
  }
});

test('first-route guidance gives four executable neighboring taps and the real three-turn echo delay', () => {
  const h = harness({ guide: true }); h.start();
  for (const [index, cell] of [14, 15, 16, 17].entries()) {
    const guide = h.game.guideStep();
    assert.equal(guide.step, index + 1);
    assert.equal(guide.total, 4);
    assert.equal(guide.action, 'right');
    assert.equal(guide.visual.tapCell, cell, 'the pointer must stay on the next reachable floor');
    const { neighbor } = require('../src/engine');
    assert.equal(neighbor(h.game.level, h.game.state.player, guide.action, h.game.state), cell);
    if (index) assert.equal(guide.visual.echo.turns, 4 - index);
    h.act(guide.action);
    assert.equal(h.game.state.player, cell);
    assert.equal(h.game.state.turn, index + 1);
  }
  assert.equal(h.game.state.status, 'won');
  assert.deepEqual(h.game.state.letters, []);
  assert.deepEqual(h.game.state.seals, []);
  assert.equal(h.game.state.echo, 14);
  assert.equal(h.game.profile().completed['1'].stars, 3);
  assert.equal(h.game.guideStep(), null);
  assert.equal(h.game.store.loadRun(), null);
  h.destroy();
});

test('guide mis-taps, reverse movement and wait keys preserve energy and the saved route', () => {
  const h = harness({ guide: true }); h.start(); h.draw();
  const initial = clone(h.game.state), saved = clone(h.game.store.loadRun());
  tapBoardPoint(h, h.game.renderer.boardGeometry.projection.point(h.game.state.player));
  h.callbacks.key(' ');
  h.callbacks.key('ArrowUp');
  h.act('wait');
  assert.deepEqual(h.game.state, initial, 'selecting the courier cannot spend the first teaching turn');
  assert.deepEqual(h.game.store.loadRun(), saved);
  h.act('right'); h.draw();
  const onStamp = clone(h.game.state), stampRun = clone(h.game.store.loadRun());
  h.act('left');
  h.callbacks.key(' ');
  tapBoardPoint(h, h.game.renderer.boardGeometry.projection.point(h.game.level.letters[0]));
  assert.deepEqual(h.game.state, onStamp, 'a valid backward step and a distant goal tap cannot bypass the lesson');
  assert.deepEqual(h.game.store.loadRun(), stampRun);
  assert.equal(h.game.pendingAction, null);
  assert.equal(h.game.guideStep().visual.tapCell, 15);
  h.act('right');
  assert.equal(h.game.state.player, 15, 'the recommended input still works after mistakes');
  h.destroy();
});

test('guide callout taps advance one real action even when a frame renders before touch release', () => {
  for (const priorSteps of [0, 2]) {
    const h = harness({ guide: true }); h.start();
    for (let index = 0; index < priorSteps; index++) h.act('right');
    h.advance(1200, false); h.draw();
    const guide = h.game.guideStep(), r = h.game.renderer;
    const label = h.calls.find(call => call.method === 'fillText' && call.args[0] === guide.visual.label);
    assert.ok(label, 'the real drawing must expose the current callout');
    const [, x, y] = label.args;
    const hit = r.hits.slice().reverse().find(item => x >= item.x && x <= item.x + item.w &&
      y >= item.y && y <= item.y + item.h && (!item.contains || item.contains(x, y)));
    assert.ok(hit && !hit.contains, 'the callout itself must have a hit region independent of the floor');
    const before = clone(h.game.state), actions = [...h.game.actions, guide.action];
    const dx = x * r.scale + r.ox, dy = y * r.scale + r.oy;
    h.game.pointerEvent(dx, dy, 'start');
    h.draw();
    h.game.pointerEvent(dx, dy, 'end');
    assert.equal(h.game.state.turn, before.turn + 1, guide.visual.label + ' spends exactly one turn');
    assert.equal(h.game.state.energy, before.energy - 1);
    assert.equal(h.game.state.player, guide.visual.tapCell);
    assert.deepEqual(h.game.actions, actions);
    assert.deepEqual(h.game.state, replayed(h.game.level, actions));
    assert.deepEqual(h.game.store.loadRun().actions, actions);
    h.advance(MOVE_MS * 2);
    assert.equal(h.game.state.turn, before.turn + 1, 'the label never queues a duplicate action');
    h.destroy();
  }
});

test('guide taps on actual empty board space show a correction without changing the saved route', () => {
  const h = harness({ guide: true }); h.start(); h.advance(1200, false); h.draw();
  const r = h.game.renderer, rect = r.boardRect;
  const occupied = (x, y) => r.hits.some(hit => x >= hit.x && x <= hit.x + hit.w &&
    y >= hit.y && y <= hit.y + hit.h && (!hit.contains || hit.contains(x, y)));
  let blank;
  for (let y = rect.y + 8; y < rect.y + rect.h - 8 && !blank; y += 12) {
    for (let x = rect.x + 8; x < rect.x + rect.w - 8; x += 12) {
      if (!occupied(x, y)) { blank = [x, y]; break; }
    }
  }
  assert.ok(blank, 'choose real board background outside every rendered hit region');
  const before = clone(h.game.state), saved = clone(h.game.store.loadRun());
  const dx = blank[0] * r.scale + r.ox, dy = blank[1] * r.scale + r.oy;
  h.game.pointerEvent(dx, dy, 'start');
  assert.equal(h.game.pointer.scene, true);
  h.draw();
  h.game.pointerEvent(dx, dy, 'end');
  assert.deepEqual(h.game.state, before);
  assert.deepEqual(h.game.store.loadRun(), saved);
  assert.equal(h.game.pendingAction, null);
  assert.equal(h.game.blockedAt, h.platform.now());
  assert.ok(h.game.toastUntil > h.platform.now(), 'an empty-space mistake needs visible feedback');
  assert.match(h.game.toastText, /手指.*亮格/);
  h.destroy();
});

test('guide animation ignores repeated input without buffering a hidden extra teaching step', () => {
  const h = harness({ guide: true }); h.start();
  h.game.act('right');
  const first = clone(h.game.state), saved = clone(h.game.store.loadRun());
  h.advance(30, false); h.game.act('right');
  h.advance(30, false); h.game.act('wait');
  assert.equal(h.game.pendingAction, null);
  assert.deepEqual(h.game.state, first);
  assert.deepEqual(h.game.store.loadRun(), saved);
  h.advance(MOVE_MS * 2);
  assert.deepEqual(h.game.state, first, 'finishing the animation must wait for a fresh deliberate input');
  assert.deepEqual(h.game.actions, ['right']);
  h.act('right');
  assert.deepEqual(h.game.actions, ['right', 'right']);
  h.destroy();
});

test('skipping enables free play and reopening guidance follows the actual detour without resetting it', () => {
  const h = harness({ guide: true }); h.start();
  h.game.dismissGuide();
  assert.equal(h.game.guideStep(), null);
  assert.equal(h.game.profile().guideDismissed, true);
  for (const action of ['right', 'left', 'right']) h.act(action);
  assert.equal(h.game.state.turn, 3, 'free play accepts the reverse step');
  const before = clone(h.game.state), actions = clone(h.game.actions);
  h.game.showGuide();
  assert.deepEqual(h.game.state, before);
  assert.deepEqual(h.game.actions, actions);
  assert.notEqual(h.game.profile().guideDismissed, true);
  assert.equal(h.game.guideStep().action, 'right');
  assert.equal(h.game.guideStep().visual.tapCell, 15);
  assert.equal(h.game.guideStep().visual.echo.turns, 1, 'the oldest pending visit determines the real countdown');
  for (let index = 0; index < 3; index++) h.act(h.game.guideStep().action);
  assert.equal(h.game.state.status, 'won');
  assert.equal(h.game.state.turn, 6);
  h.destroy();
});

test('guide undo, relaunch and retry derive the next lesson from the replayed route', () => {
  const h = harness({ guide: true }); h.start();
  for (let index = 0; index < 3; index++) h.act('right');
  assert.equal(h.game.guideStep().step, 4);
  h.game.undo();
  assert.equal(h.game.guideStep().step, 3);
  assert.equal(h.game.guideStep().visual.tapCell, 16);
  assert.equal(h.game.guideStep().visual.echo.turns, 2);
  const before = clone(h.game.state), actions = clone(h.game.actions);
  const reloaded = harness({ guide: true, data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.deepEqual(reloaded.game.state, before);
  assert.deepEqual(reloaded.game.actions, actions);
  assert.equal(reloaded.game.guideStep().step, 3);
  assert.equal(reloaded.game.guideStep().visual.tapCell, 16);
  assert.equal(reloaded.game.guideStep().visual.echo.turns, 2);
  reloaded.start();
  assert.equal(reloaded.game.guideStep().step, 1);
  assert.equal(reloaded.game.guideStep().visual.tapCell, 14);
  assert.equal(reloaded.game.state.energy, CAMPAIGN[0].budget);
  assert.equal(reloaded.game.undosUsed, 0);
  h.destroy(); reloaded.destroy();
});

test('completed players can resume or restart a manually opened guide and keep a later dismissal', () => {
  const h = harness({ guide: true }); h.start();
  CAMPAIGN[0].solution.forEach(action => h.act(action));
  const earned = clone(h.game.profile().completed);
  h.start();
  assert.equal(h.game.guideEnabled, false, 'a completed first route no longer auto-opens guidance');
  h.game.showGuide(); h.act('right');
  const before = clone(h.game.state);
  const reloaded = harness({ guide: true, data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.guideEnabled, true, 'manual guidance must survive relaunch independently of autoGuide');
  assert.deepEqual(reloaded.game.state, before);
  assert.equal(reloaded.game.guideStep().visual.tapCell, 15);
  reloaded.start();
  assert.equal(reloaded.game.guideEnabled, true, 'retry keeps the manually chosen lesson active');
  assert.equal(reloaded.game.guideStep().step, 1);
  reloaded.game.dismissGuide();
  const dismissed = harness({ guide: true, data: h.data });
  assert.equal(dismissed.game.restore(), true);
  assert.equal(dismissed.game.guideEnabled, false, 'a stale saved guide flag cannot undo an explicit dismissal');
  dismissed.act('wait');
  assert.equal(dismissed.game.state.turn, 1, 'free play is restored after relaunch');
  assert.deepEqual(dismissed.game.profile().completed, earned);
  h.destroy(); reloaded.destroy(); dismissed.destroy();
});

test('an unsolvable detour offers undo or an explicit fresh guide instead of spending more light', () => {
  for (const remainingUndos of [true, false]) {
    const h = harness({ guide: true }); h.start(); h.game.dismissGuide();
    if (!remainingUndos) {
      for (let index = 0; index < CAMPAIGN[0].undo; index++) { h.act('wait'); h.game.undo(); }
    }
    for (let index = 0; index < 5; index++) h.act('wait');
    assert.equal(h.game.state.status, 'playing');
    assert.equal(h.game.state.energy, 3, 'four moves are still needed from the start');
    h.game.showGuide();
    assert.equal(h.game.guideStep().control, remainingUndos ? 'undo' : 'restart');
    const before = clone(h.game.state), saved = clone(h.game.store.loadRun());
    h.act('right'); h.act('wait');
    assert.deepEqual(h.game.state, before, 'recovery must happen before another route action');
    assert.deepEqual(h.game.store.loadRun(), saved);
    if (remainingUndos) {
      h.game.undo();
      assert.equal(h.game.guideStep().action, 'right');
      assert.equal(h.game.state.energy, 4);
    } else {
      h.game.restartGuide();
      assert.equal(h.game.guideEnabled, true);
      assert.equal(h.game.guideStep().step, 1);
      assert.equal(h.game.state.turn, 0);
      assert.equal(h.game.state.energy, CAMPAIGN[0].budget);
      assert.equal(h.game.undosUsed, 0);
      assert.deepEqual(h.game.actions, []);
    }
    h.destroy();
  }
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

function finishCampaign(h, count) {
  for (const level of CAMPAIGN.slice(0, count)) {
    h.start(level);
    level.solution.forEach(action => h.act(action));
    assert.equal(h.game.state.status, 'won');
  }
}

test('a failed route can be reviewed without spending turns and free retry preserves the old personal best', () => {
  const h = harness();
  finishCampaign(h, 1);
  const earned = clone(h.game.profile());
  h.start();
  for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
  const failed = clone(h.game.state), saved = clone(h.game.store.loadRun());
  assert.equal(h.game.modal.buttons[0].primary, true);
  assert.match(h.game.modal.buttons[0].text, /看广告续灯/, 'with a configured ad the relight leads the failure dialog');
  assert.ok(h.game.modal.lines.some(line => /本次通关至多一星/.test(line)), 'the reachable score is disclosed before choosing an ad');
  const retry = h.game.modal.buttons.find(button => /免费再试/.test(button.text));
  assert.ok(retry, 'the free retry always remains available');
  assert.equal(retry.primary, false);
  const review = h.game.modal.buttons.find(button => /刚才的路线/.test(button.text));
  assert.ok(review);
  review.action();
  assert.equal(h.game.reviewing, true);
  assert.equal(h.game.modal, null);
  h.draw();
  h.act('right');
  h.callbacks.key('ArrowRight');
  assert.deepEqual(h.game.state, failed);
  assert.deepEqual(h.game.store.loadRun(), saved);
  h.game.pause();
  assert.equal(h.game.modal.kind, 'fail');
  assert.equal(h.game.reviewing, false);
  assert.deepEqual(h.game.state, failed);
  h.game.modal.buttons.find(button => /免费再试/.test(button.text)).action();
  assert.equal(h.game.state.turn, 0);
  assert.equal(h.game.state.status, 'playing');
  assert.equal(h.game.state.energy, CAMPAIGN[0].budget);
  assert.deepEqual(h.game.profile(), earned);
  assert.equal(h.showCount, 0);
  h.destroy();
});

test('a slower replay reports the personal best and does not downgrade stars or stored route time', () => {
  const h = harness();
  finishCampaign(h, 1);
  const before = clone(h.game.profile().completed['1']);
  h.game.modal.buttons[1].action();
  h.act('wait');
  CAMPAIGN[0].solution.forEach(action => h.act(action));
  assert.equal(h.game.state.status, 'won');
  assert.equal(h.game.modal.stars, 2);
  assert.match(h.game.modal.lines[0], /已保留最佳 3 星/);
  assert.match(h.game.modal.lines[1], /个人最佳 4 拍.*多走 1 拍/);
  assert.deepEqual(h.game.profile().completed['1'], before);
  assert.equal(h.game.profile().totalWins, 1, 'a repeat delivery must not inflate distinct wins');
  h.destroy();
});

test('real replay upgrades refresh settlement, progress, stamps and ranking totals across campaign boundaries', async t => {
  const { campaignScore } = require('../src/friend-score');
  const { replayLevels } = require('../src/level-navigation');
  const h = harness({ development: true }); t.after(() => h.destroy());
  async function deliver(level, waits) {
    h.start(level);
    for (const action of [...Array(waits).fill('wait'), ...level.solution]) {
      if (h.game.state.status === 'failed') {
        const pending = h.game.requestRevive();
        await Promise.resolve(); h.closeAd(true); await pending;
        assert.equal(h.game.state.status, 'playing');
      }
      h.act(action);
    }
    assert.equal(h.game.state.status, 'won', `route ${level.id}`);
  }
  // Chapter boundaries, new mechanics, the strict late-game light budget and
  // the final three-route chapter all share the same settlement contract.
  for (const id of [1, 6, 7, 18, 19, 300, 301, 996, 997, 999]) {
    const level = CAMPAIGN[id - 1];
    await deliver(level, 2);
    assert.equal(h.game.modal.stars, 2);
    const before = h.game.album(), scoreBefore = campaignScore(h.game.profile());
    assert.ok(replayLevels(h.game).some(route => route.id === id));
    await deliver(level, 0);
    const after = h.game.album(), scoreAfter = campaignScore(h.game.profile());
    assert.equal(h.game.modal.stars, 3);
    assert.match(h.game.modal.lines[0], /星光 \+1/);
    assert.equal(after.stars, before.stars + 1);
    assert.equal(h.game.completion(), before.progress.completedCount);
    assert.equal(after.progress.perfectCount, before.progress.perfectCount + 1);
    assert.equal(after.progress.chapters[level.chapter].stars, before.progress.chapters[level.chapter].stars + 1);
    assert.equal(replayLevels(h.game).some(route => route.id === id), false);
    assert.equal(scoreAfter.stars, scoreBefore.stars + 1);
    assert.equal(scoreAfter.completed, scoreBefore.completed);
    assert.equal(scoreAfter.turns, scoreBefore.turns - 2);
    assert.equal(h.game.store.loadRun(), null);
    const rewards = after.stamps.filter(stamp => stamp.owned && !before.stamps[stamp.index].owned);
    assert.equal(h.game.modal.lines.some(line => /新邮票/.test(line)), rewards.length > 0);
    const profile = clone(h.game.profile());
    h.game.victory();
    assert.deepEqual(h.game.profile(), profile, 'duplicate settlement preserves every total');
    assert.equal(h.game.modal.lines.some(line => /星光 \+|新邮票/.test(line)), false);
    await deliver(level, 2);
    assert.match(h.game.modal.lines[0], /已保留最佳 3 星/);
    assert.deepEqual(h.game.profile(), profile);
    assert.deepEqual(campaignScore(h.game.profile()), scoreAfter);
    assert.deepEqual(h.game.album().stamps, after.stamps);
    if (id === 999) assert.equal(h.game.modal.buttons[0].text, '返回邮局');
  }
});




test('a legacy state-only save renders the home screen and falls back without losing earned progress', () => {
  const h = harness();
  finishCampaign(h, 2);
  const earned = clone(h.game.profile());
  h.start(CAMPAIGN[2]);
  h.act(CAMPAIGN[2].solution[0]);
  h.data.set(RUN_KEY, { mode: 'campaign', levelId: 3, state: clone(h.game.state) });
  let reloaded;
  assert.doesNotThrow(() => { reloaded = harness({ data: h.data }); });
  reloaded.draw();
  assert.equal(reloaded.game.page, 'home');
  assert.ok(reloaded.calls.some(call => call.method === 'fillText' && call.args[0] === '继续送信'));
  assert.equal(reloaded.calls.some(call => call.method === 'fillText' && /已走 0 拍/.test(call.args[0])), false);
  reloaded.game.primary();
  assert.equal(reloaded.game.page, 'game');
  assert.equal(reloaded.game.mode, 'campaign');
  assert.equal(reloaded.game.level.id, 3);
  assert.equal(reloaded.game.state.turn, 0, 'unsupported old state is not replayed as authoritative progress');
  assert.deepEqual(reloaded.game.profile(), earned);
  assert.deepEqual(reloaded.game.store.loadRun().actions, []);
  h.destroy(); reloaded.destroy();
});

test('undo takes back turns from history, is limited per run, survives relaunch and stops at the revival point', async () => {
  const h = harness();
  finishCampaign(h, 1);
  const level = CAMPAIGN[1];
  h.start(level);
  assert.equal(h.game.undoLeft(), 3);
  assert.equal(h.game.canUndo(), false, 'nothing to undo at the start');
  h.game.undo();
  assert.equal(h.game.undosUsed, 0, 'an impossible undo costs nothing');
  level.solution.slice(0, 2).forEach(action => h.act(action));
  const twoSteps = clone(h.game.state);
  h.act(level.solution[2]);
  const threeSteps = clone(h.game.state);
  h.act('wait');
  h.act(level.solution[3]);
  assert.equal(h.game.canUndo(), true);
  h.game.undo();
  h.game.undo();
  assert.deepEqual(h.game.state, threeSteps);
  assert.deepEqual(h.game.state, replayed(level, level.solution.slice(0, 3)), 'undo rebuilds the exact rule-produced state');
  assert.equal(h.game.undoLeft(), 1);
  assert.equal(h.game.store.loadRun().undosUsed, 2);
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.undosUsed, 2);
  assert.deepEqual(reloaded.game.state, h.game.state);
  reloaded.game.undo();
  assert.deepEqual(reloaded.game.state, twoSteps);
  assert.equal(reloaded.game.undoLeft(), 0);
  reloaded.game.undo();
  assert.deepEqual(reloaded.game.state, twoSteps, 'the fourth undo is refused');
  assert.match(reloaded.game.toastText, /已用完/);
  assert.equal(reloaded.game.canUndo(), false);

  // Revival is a one-way door: turns before it cannot be taken back.
  const spent = harness(); spent.start();
  for (let index = 0; index < CAMPAIGN[0].budget; index++) spent.act('wait');
  const pending = spent.game.requestRevive(); await Promise.resolve(); spent.closeAd(true); await pending;
  assert.equal(spent.game.state.status, 'playing');
  spent.game.undo();
  assert.equal(spent.game.undosUsed, 0);
  assert.match(spent.game.toastText, /续灯之前/);
  spent.act('right');
  spent.game.undo();
  assert.equal(spent.game.undosUsed, 1);
  assert.equal(spent.game.state.turn, CAMPAIGN[0].budget);
  assert.equal(spent.game.state.revived, true);
  h.destroy(); reloaded.destroy(); spent.destroy();
});

test('late routes allow a single undo, a legacy expert save is discarded, and an over-limit undo count is rejected', () => {
  const h = harness();
  const level = CAMPAIGN[18];
  assert.equal(level.undo, 1);
  assert.deepEqual([undoFor(0), undoFor(5), undoFor(6), undoFor(17), undoFor(18), undoFor(119)], [3, 3, 2, 2, 1, 1]);
  for (const earlier of CAMPAIGN.slice(0, 18)) h.game.store.recordWin(earlier.id, 3, earlier.par, 'campaign');
  const earned = clone(h.game.profile());
  h.start(level);
  assert.equal(h.game.undoLeft(), 1);
  h.act(level.solution[0]);
  h.act(level.solution[1]);
  h.game.undo();
  assert.equal(h.game.undoLeft(), 0);
  const before = clone(h.game.state);
  h.game.undo();
  assert.deepEqual(h.game.state, before);
  assert.match(h.game.toastText, /1 次回溯已用完/);
  h.data.set(RUN_KEY, { ...clone(h.game.store.loadRun()), undosUsed: 2 });
  let reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), false, 'a save claiming more undos than the route allows is rejected');
  assert.deepEqual(reloaded.game.profile(), earned);
  h.data.set(RUN_KEY, { mode: 'expert', levelId: 1, revision: '3-challenge-1', dateKey: '2026-09-07', actions: [], reviveAt: null });
  reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), false, 'saves from the retired expert mode are discarded');
  assert.equal(reloaded.game.store.loadRun(), null);
  assert.deepEqual(reloaded.game.profile(), earned);
  h.destroy(); reloaded.destroy();
});

test('a torn paper bridge uses board effects without a duplicate toast and survives relaunch', () => {
  const h = harness();
  const level = CAMPAIGN[20];
  assert.deepEqual(level.bridges, [34]);
  for (const earlier of CAMPAIGN.slice(0, 20)) h.game.store.recordWin(earlier.id, 3, earlier.par, 'campaign');
  h.start(level);
  // The witness steps onto the bridge beside the start and tears it on its second turn.
  let tornAt = -1;
  for (const [index, action] of level.solution.entries()) {
    h.act(action);
    if (tornAt < 0 && h.game.state.bridges.length === 0) { tornAt = index; break; }
  }
  assert.ok(tornAt > 0, 'the reference route tears the bridge');
  assert.ok(h.game.moveEvents.some(event => event.type === 'bridge' && event.cell === 34));
  assert.equal(h.game.toastUntil, 0, 'the board effect does not create a second toast');
  h.draw();
  assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '纸桥碎了'), 'the default animation displays the bridge hint');
  const saved = clone(h.game.state);
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.deepEqual(reloaded.game.state, saved);
  assert.deepEqual(reloaded.game.state.bridges, []);
  level.solution.slice(tornAt + 1).forEach(action => reloaded.act(action));
  assert.equal(reloaded.game.state.status, 'won');
  assert.equal(reloaded.game.modal.stars, 3);
  h.destroy(); reloaded.destroy();
});

test('the game screen keeps one route target, undo and wait without duplicate board overlays', () => {
  const h = harness(); h.start(CAMPAIGN[15]);
  h.draw();
  const texts = () => h.calls.filter(call => call.method === 'fillText').map(call => String(call.args[0]));
  assert.ok(texts().includes('撤回（2）'), 'chapter three routes allow two undos');
  assert.ok(texts().includes('等一拍'));
  assert.equal(texts().filter(text => text.includes('已走 0 拍') && text.includes('三星目标')).length, 1,
    'one compact header communicates the current route target');
  assert.equal(texts().some(text => /回声预告|1×|^[A-F][1-6]$|^[A-F]$/.test(text)), false);
  assert.equal(h.game.renderer.hits.some(hit => hit.w === 50 && hit.h === 42), false, 'the direction pad is removed');
  h.act(CAMPAIGN[15].solution[0]);
  h.game.undo();
  h.draw();
  assert.ok(texts().includes('撤回（1）'));
  h.game.openPage('levels'); h.game.levelScroll.offset = require('../src/level-view').levelProgressOffset(CAMPAIGN[12], h.game.renderer.H); h.draw();
  assert.ok(h.game.renderer.hits.length > 0);
  h.destroy();
});

function readyPostOffice(view = {}) {
  const h = harness({ metrics: { width: 780, height: 1688, pixelRatio: 2, safeTop: 100, safeBottom: 68 } });
  h.start(CAMPAIGN[3]);
  h.game.level.solution.slice(0, -1).forEach(action => h.act(action));
  h.act('wait'); h.act('wait');
  Object.assign(h.game.camera, view);
  h.draw();
  assert.equal(h.game.state.player, 6);
  assert.equal(h.game.state.echo, 7);
  assert.equal(h.game.state.energy, 2);
  assert.deepEqual(h.game.state.letters, []);
  assert.deepEqual(h.game.state.seals, []);
  return h;
}

function boardDevicePoint(h, point) {
  const r = h.game.renderer;
  const [x, y] = r.boardGeometry.projection.toScreen(...point);
  return [x * r.scale + r.ox, y * r.scale + r.oy];
}

function postOfficePoint(h, part) {
  const p = h.game.renderer.boardGeometry.projection;
  const [x, y] = p.point(h.game.level.exit), size = p.halfW * 1.2 / 44;
  if (part === 'badge') return [x, y - p.halfW * 1.68];
  return part === 'door' ? [x - 7 * size, y - 2 - 10 * size] : [x, y - 2 - 32 * size];
}

function tapBoardPoint(h, point) {
  const device = boardDevicePoint(h, point);
  h.game.pointerEvent(...device, 'start');
  h.game.pointerEvent(...device, 'end');
}

test('post office roof, door and ready badge deliver from the screenshot state without changing the camera', () => {
  const cameraState = ({ zoom, panX, panY, enteredAt }) => ({ zoom, panX, panY, enteredAt });
  const views = [
    { name: 'default', camera: {} },
    { name: 'zoomed out', camera: { zoom: .7 } },
    { name: 'zoom and pan', camera: { zoom: 1.4, panX: .08, panY: .04 } }
  ];
  for (const view of views) for (const part of ['roof', 'door', 'badge']) {
    const h = readyPostOffice(view.camera), beforeCamera = cameraState(h.game.camera);
    const beforeTurn = h.game.state.turn, beforeActions = h.game.actions.length;
    tapBoardPoint(h, postOfficePoint(h, part));
    assert.equal(h.game.state.player, h.game.level.exit, `${view.name}: tapping ${part} enters the post office`);
    assert.equal(h.game.state.status, 'won');
    assert.equal(h.game.state.turn, beforeTurn + 1, 'a tap spends exactly one turn');
    assert.equal(h.game.state.energy, 1);
    assert.equal(h.game.actions.length, beforeActions + 1);
    assert.equal(h.game.actions.at(-1), 'up');
    assert.deepEqual(cameraState(h.game.camera), beforeCamera, 'delivery does not require a camera change');
    h.draw(45);
    const effect = h.game.camera.frame(h.platform.now());
    assert.ok(Math.hypot(effect.panX - beforeCamera.panX, effect.panY - beforeCamera.panY) > 0, 'delivery adds only a temporary visual impact');
    h.draw(215);
    assert.equal(h.game.camera.frame(h.platform.now()).panX, beforeCamera.panX);
    assert.equal(h.game.camera.frame(h.platform.now()).panY, beforeCamera.panY);
    h.destroy();
  }
});

test('post office taps preserve collection requirements and waiting on its own tile', () => {
  const h = harness(); h.start(CAMPAIGN[3]);
  h.game.level.solution.slice(0, 7).forEach(action => h.act(action));
  h.act('left'); h.draw();
  assert.equal(h.game.state.player, 6);
  const before = clone(h.game.state);
  tapBoardPoint(h, postOfficePoint(h, 'roof'));
  assert.equal(h.game.state.player, h.game.level.exit);
  assert.equal(h.game.state.status, 'playing', 'the building does not bypass uncollected mail');
  assert.deepEqual(h.game.state.letters, before.letters);
  assert.deepEqual(h.game.state.seals, before.seals);
  assert.equal(h.game.state.energy, before.energy - 1);
  assert.equal(h.game.modal, null);
  h.draw();
  tapBoardPoint(h, postOfficePoint(h, 'roof'));
  assert.equal(h.game.actions.at(-1), 'wait');
  assert.equal(h.game.state.player, h.game.level.exit);
  assert.equal(h.game.state.energy, before.energy - 2);
  assert.equal(h.game.state.status, 'playing');
  h.destroy();
});

test('post office hit areas leave uncovered neighboring floors and empty roof corners reachable', () => {
  for (const zoom of [1, 1.4]) {
    for (const [cell, action] of [[7, 'right'], [6, 'wait']]) {
      const h = readyPostOffice({ zoom });
      const p = h.game.renderer.boardGeometry.projection, [x, y] = p.point(cell);
      // The neighboring tile's side remains visible beside both roof and badge.
      const [dx, dy] = cell === 7 ? p.floor(p.halfW * .8, 0) : [0, 0];
      tapBoardPoint(h, [x + dx, y + dy]);
      assert.equal(h.game.state.player, cell, `zoom ${zoom}: floor ${cell} remains reachable`);
      assert.equal(h.game.actions.at(-1), action);
      assert.equal(h.game.state.energy, 1);
      assert.equal(h.game.state.status, 'playing');
      h.destroy();
    }
  }
  const h = readyPostOffice(), before = clone(h.game.state);
  const p = h.game.renderer.boardGeometry.projection, [x, y] = p.point(h.game.level.exit);
  const size = p.halfW * 1.2 / 44;
  // This point is inside the roof's bounding box but above its sloping right edge.
  tapBoardPoint(h, [x + 20 * size, y - 2 - 41 * size]);
  assert.deepEqual(h.game.state, before, 'an empty bounding-box corner must not act like visible roof');
  h.destroy();
});

test('dragging from the post office or tapping it from far away cannot spend a delivery turn', () => {
  const h = readyPostOffice({ zoom: 1.4 });
  const before = clone(h.game.state), saved = clone(h.game.store.loadRun());
  const [x, y] = boardDevicePoint(h, postOfficePoint(h, 'roof'));
  h.game.pointerEvent(x, y, 'start');
  h.game.pointerEvent(x + 60, y, 'move');
  h.game.pointerEvent(x + 60, y, 'end');
  assert.notEqual(h.game.camera.panX, 0, 'the normal pan gesture still works over the building');
  assert.deepEqual(h.game.state, before);
  assert.deepEqual(h.game.store.loadRun(), saved);
  h.start(CAMPAIGN[3]); h.advance(900, false); h.draw();
  const farState = clone(h.game.state);
  tapBoardPoint(h, postOfficePoint(h, 'roof'));
  assert.deepEqual(h.game.state, farState, 'the building does not add distant movement');
  h.destroy();
});

test('rapid input retains only the latest action without spending a turn before the animation ends', () => {
  const h = harness(); h.start();
  h.game.act('right');
  const firstStep = clone(h.game.state), saved = clone(h.game.store.loadRun());
  h.advance(30, false); h.game.act('right');
  h.advance(30, false); h.game.act('wait');
  assert.equal(h.game.pendingAction.action, 'wait', 'the last intention replaces the earlier one');
  assert.deepEqual(h.game.state, firstStep);
  assert.deepEqual(h.game.store.loadRun(), saved, 'queued input is not a committed or saved turn');
  h.advance(MOVE_MS - 61);
  assert.deepEqual(h.game.state, firstStep, 'the final animation millisecond still owns the current turn');
  h.advance(1);
  assert.deepEqual(h.game.actions, ['right', 'wait']);
  assert.deepEqual(h.game.state, replayed(CAMPAIGN[0], ['right', 'wait']));
  assert.equal(h.game.pendingAction, null);
  const secondStep = clone(h.game.state);
  h.advance(MOVE_MS * 3);
  assert.deepEqual(h.game.state, secondStep, 'there is no accumulated input after the single queued action');
  h.destroy();
});

test('input older than 500ms expires without changing the puzzle or saved history', () => {
  const h = harness(); h.start();
  h.game.act('right');
  h.advance(30, false); h.game.act('right');
  const before = clone(h.game.state), saved = clone(h.game.store.loadRun());
  h.advance(501);
  assert.equal(h.game.pendingAction, null);
  assert.deepEqual(h.game.state, before);
  assert.deepEqual(h.game.store.loadRun(), saved);
  h.destroy();
});

test('pause, undo, route changes, backgrounding and navigation cancel pending input', () => {
  const transitions = [
    { name: 'pause', leave: h => h.game.pause(), resume: h => h.game.modal.buttons[0].action() },
    { name: 'undo', leave: h => h.game.undo() },
    { name: 'new route', leave: h => h.start(CAMPAIGN[1]) },
    { name: 'background', leave: h => h.callbacks.hide(), resume: h => { h.callbacks.show(); h.game.modal.buttons[0].action(); } },
    { name: 'help', leave: h => h.game.help(), resume: h => h.game.modal.buttons[0].action() },
    { name: 'home', leave: h => h.game.home(), resume: h => h.game.primary() },
    { name: 'collection', leave: h => h.game.openPage('collection'), resume: h => assert.equal(h.game.restore(), true) },
    { name: 'restore', leave: h => assert.equal(h.game.restore(), true) }
  ];
  for (const transition of transitions) {
    const h = harness(); h.start();
    h.game.act('right'); h.game.act('right');
    assert.ok(h.game.pendingAction);
    transition.leave(h);
    assert.equal(h.game.pendingAction, null, transition.name + ' clears pending input immediately');
    if (transition.resume) transition.resume(h);
    const before = clone(h.game.state), saved = clone(h.game.store.loadRun());
    h.advance(MOVE_MS * 2);
    assert.deepEqual(h.game.state, before, transition.name + ' must not deliver a stale action after returning');
    assert.deepEqual(h.game.store.loadRun(), saved);
    h.destroy();
  }
});

test('blocked movement gives a temporary contextual hint without consuming energy or history', () => {
  const h = harness(); h.start();
  const before = clone(h.game.state), saved = clone(h.game.store.loadRun());
  h.game.act('up');
  assert.equal(h.game.blockedAt, h.platform.now());
  assert.match(h.game.playHint(), /这边不通/);
  assert.equal(h.game.toastUntil, 0, 'blocked movement does not obscure the board with a toast');
  assert.deepEqual(h.game.state, before);
  assert.deepEqual(h.game.store.loadRun(), saved);
  h.advance(1400);
  assert.doesNotMatch(h.game.playHint(), /这边不通/);
  h.game.act('right');
  assert.equal(h.game.blockedAt, null);
  assert.equal(h.game.state.turn, 1);
  h.destroy();
});

test('a save from an older content version restarts its route with notice and preserves earned scores', () => {
  const h = harness(); finishCampaign(h, 3);
  const earned = clone(h.game.profile());
  h.start(CAMPAIGN[3]); h.act(CAMPAIGN[3].solution[0]);
  h.data.set(RUN_KEY, { ...clone(h.game.store.loadRun()), revision: '4' });
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.level.id, 4);
  assert.equal(reloaded.game.state.turn, 0);
  assert.deepEqual(reloaded.game.actions, []);
  assert.equal(reloaded.game.store.loadRun().revision, '5');
  assert.match(reloaded.game.toastText, /路线已升级/);
  assert.deepEqual(reloaded.game.profile(), earned);
  h.destroy(); reloaded.destroy();
});

test('a current-version save resumes its exact actions without an upgrade notice', () => {
  const h = harness(); finishCampaign(h, 2);
  h.start(CAMPAIGN[2]);
  CAMPAIGN[2].solution.slice(0, 3).forEach(action => h.act(action));
  const before = clone(h.game.state), actions = clone(h.game.actions), earned = clone(h.game.profile());
  assert.equal(h.game.store.loadRun().revision, '5');
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.level.id, 3);
  assert.deepEqual(reloaded.game.state, before);
  assert.deepEqual(reloaded.game.actions, actions);
  assert.deepEqual(reloaded.game.profile(), earned);
  assert.doesNotMatch(reloaded.game.toastText, /路线已升级/);
  h.destroy(); reloaded.destroy();
});

test('the fresh home separates its settings shortcut from the three primary links', () => {
  const h = harness(); h.draw();
  const texts = h.calls.filter(call => call.method === 'fillText').map(call => String(call.args[0]));
  for (const label of ['开始送信', '选关', '邮票', '排行']) assert.ok(texts.includes(label));
  assert.equal(texts.includes('设置'), false, 'the icon-only settings shortcut stays out of the bottom labels');
  assert.equal(texts.includes('圈子'), false);
  assert.equal(texts.some(text => /每日|成长|LV\.|已走 0 拍|本周|下一小步/.test(text)), false);
  const hits = h.game.renderer.hits;
  assert.equal(hits.length, 5, 'delivery, three primary links and settings are available');
  const settings = hits.find(hit => hit.x === 330 && hit.y === 10 && hit.w === 44 && hit.h === 44);
  assert.ok(settings, 'settings uses a top-right touch target below the platform safe area');
  const bottomY = Math.max(...hits.map(hit => hit.y));
  assert.equal(hits.filter(hit => hit.y === bottomY).length, 3, 'settings is not grouped with bottom navigation');
  settings.action(); h.draw();
  assert.equal(h.game.page, 'settings');
  assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '体验设置'));
  h.callbacks.key('Escape'); assert.equal(h.game.page, 'home');
  h.destroy();
});

test('home keeps five accessible actions across browser and WeChat versions', () => {
  for (const kind of ['wechat', 'browser']) {
    for (const envVersion of ['develop', 'trial', 'release', undefined]) {
      const h = harness({ kind, wx: {
        getAccountInfoSync: () => ({ miniProgram: { envVersion } })
      } });
      try {
        h.draw();
        const texts = h.calls.filter(call => call.method === 'fillText').map(call => String(call.args[0]));
        assert.equal(texts.includes('圈子'), false, kind + '/' + envVersion);
        const hits = h.game.renderer.hits;
        assert.equal(hits.length, 5, 'delivery, three primary links and settings are available');
        const bottomY = Math.max(...hits.map(hit => hit.y));
        const links = hits.filter(hit => hit.y === bottomY);
        assert.equal(links.length, 3, 'bottom navigation contains only primary destinations');
        assert.equal(links[0].x + links.at(-1).x + links.at(-1).w, 390, 'navigation stays centered');
        assert.ok(hits.every(hit => hit.x >= 0 && hit.x + hit.w <= 390 && hit.w >= 44 && hit.h >= 44),
          'all home actions remain visible and touch accessible');
      } finally { h.destroy(); }
    }
  }
});

test('choosing each introductory route starts it directly without a launch or tutorial dialog', () => {
  const h = harness();
  for (const level of CAMPAIGN.slice(0, 3)) {
    h.game.openPage('levels');
    h.game.start(level, 'campaign');
    assert.equal(h.game.page, 'game');
    assert.equal(h.game.level.id, level.id);
    assert.equal(h.game.state.turn, 0);
    assert.equal(h.game.modal, null);
    level.solution.forEach((action, index) => {
      h.act(action);
      if (index === 0 && level.id > 1) {
        assert.equal(h.game.state.echo, null);
        assert.doesNotMatch(h.game.playHint(), /蓝色光环/, 'a hint must not refer to the next-echo marker before it appears');
      }
    });
    assert.equal(h.game.state.status, 'won');
  }
  h.destroy();
});

test('a real wind lamp grants three energy and acknowledges its HUD delivery without a duplicate toast', () => {
  const h = harness(); h.start(CAMPAIGN[18]);
  let collected = false;
  for (const action of h.game.level.solution) {
    const before = clone(h.game.state);
    h.act(action);
    const light = h.game.moveEvents.find(event => event.type === 'light');
    if (!light) continue;
    collected = true;
    assert.equal(h.game.state.energy, before.energy - 1 + 3);
    assert.ok(before.lights.includes(light.cell));
    assert.equal(h.game.state.lights.includes(light.cell), false);
    assert.equal(h.game.toastUntil, 0);
    h.draw();
    assert.equal(h.calls.some(call => call.method === 'fillText' && call.args[0] === '+3 拍'), false,
      'the gain is printed after the collection flight lands');
    h.draw(600);
    const gain = h.calls.find(call => call.method === 'fillText' && call.args[0] === '+3 拍');
    assert.ok(gain);
    assert.ok(gain.args[2] < h.game.renderer.boardRect.y, 'the gain belongs to the HUD, outside the board');
    assert.ok(gain.args[2] + 7 < 143, 'the gain and its text height fit inside the paper card');
    assert.ok(gain.args[1] > 24 && gain.args[1] < 66, 'the gain sits under its icon, clear of the number and progress ticks');
    assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '剩余拍数'), 'the counter caption remains stable');
    break;
  }
  assert.equal(collected, true, 'the recorded route must actually collect a wind lamp');
  h.start(); h.act('wait'); h.draw();
  const spent = h.calls.find(call => call.method === 'fillText' && call.args[0] === '−1 拍');
  assert.ok(spent);
  assert.ok(spent.args[2] + 7 < 143, 'the waiting cost also stays inside the paper card');
  assert.ok(spent.args[1] > 24 && spent.args[1] < 66, 'the waiting cost uses the same icon column');
  h.destroy();
});

function replayed(level, actions) {
  const { replay } = require('../src/engine');
  return replay(level, actions, null);
}

test('development can enter and resume level 999 without unlocking or changing formal progress', () => {
  const profile = { version: 1, completed: { 1: { stars: 3, bestTurns: 4 } }, daily: {}, totalWins: 1 };
  const formalRun = { mode: 'campaign', levelId: 2, revision: CAMPAIGN[1].revision, actions: [], reviveAt: null, undosUsed: 0 };
  const data = new Map([[PROFILE_KEY, clone(profile)], [RUN_KEY, clone(formalRun)]]);
  const dev = harness({ data, development: true });
  assert.equal(dev.game.savedRun(), null, 'developer session does not resume formal run');
  assert.equal(dev.game.selectLevel(999), true);
  assert.equal(dev.game.level.id, 999);
  CAMPAIGN[998].solution.slice(0, 4).forEach(action => dev.act(action));
  const state = clone(dev.game.state);
  const reloaded = harness({ data, development: true });
  assert.equal(reloaded.game.restore(), true);
  assert.deepEqual(reloaded.game.state, state);
  CAMPAIGN[998].solution.slice(4).forEach(action => reloaded.act(action));
  assert.equal(reloaded.game.state.status, 'won');
  assert.equal(data.get(DEV_PROFILE_KEY).completed['999'].stars, 3);
  assert.equal(data.has(DEV_RUN_KEY), false);
  assert.deepEqual(data.get(PROFILE_KEY), profile);
  assert.deepEqual(data.get(RUN_KEY), formalRun);
  const formal = harness({ data });
  assert.equal(formal.game.unlocked(998), false);
  assert.equal(formal.game.restore(), true);
  assert.equal(formal.game.level.id, 2);
  dev.destroy(); reloaded.destroy(); formal.destroy();
});

test('formal game refuses developer entry points and invalid level ids regardless of mutable flags', () => {
  const h = harness(); h.game.openPage('levels');
  h.platform.isDevelopment = true;
  assert.throws(() => { h.game.development = true; }, TypeError);
  assert.equal(h.game.openDevelopmentPicker(), false);
  assert.equal(h.game.developmentKey('Enter'), false);
  for (const id of [999, 0, -1, 1000, 1.5, '999', NaN]) assert.equal(h.game.selectLevel(id), false);
  assert.equal(h.game.page, 'levels');
  assert.equal(h.game.store.loadRun(), null);
  assert.equal(h.game.selectLevel(1), true);
  h.destroy();
});

test('retired daily runs return to the campaign without losing existing campaign or archived scores', () => {
  const completed = { 1: { stars: 3, bestTurns: 4 } }, daily = { '2026-09-08': { stars: 2, bestTurns: 30 } };
  const data = new Map([
    [PROFILE_KEY, { version: 1, completed, daily, totalWins: 2 }],
    [RUN_KEY, { mode: 'daily', levelId: 'daily-2026-09-08', dateKey: '2026-09-08', revision: '5', actions: ['up'], reviveAt: null }],
  ]);
  const h = harness({ data });
  assert.equal(h.game.savedRun(), null);
  assert.deepEqual(h.game.profile().completed, completed);
  assert.deepEqual(h.game.profile().daily, daily);
  assert.equal(h.game.album().stars, 3);
  assert.equal(h.game.album().stamps.length, 23);
  h.game.primary();
  assert.equal(h.game.mode, 'campaign');
  assert.equal(h.game.level.id, 2);
  h.game.start(CAMPAIGN[0], 'daily');
  assert.equal(h.game.level.id, 2, 'retired mode cannot be started programmatically');
  h.destroy();
});

test('the 999th route resumes after undo, saves the final score and returns home without an extra level', () => {
  assert.equal(CAMPAIGN.length, 999);
  const completed = Object.fromEntries(CAMPAIGN.slice(0, 998).map(level => [level.id, { stars: 3, bestTurns: level.par }]));
  const data = new Map([[PROFILE_KEY, { version: 1, completed, daily: {}, totalWins: 998 }]]);
  const h = harness({ data }), last = CAMPAIGN[998];
  assert.equal(h.game.nextLevel().id, 999);
  h.game.openPage('levels');
  assert.equal(h.game.levelScroll.offset, h.game.levelScroll.max);
  assert.equal(h.game.unlocked(998), true);
  h.start(last);
  last.solution.slice(0, 5).forEach(action => h.act(action));
  h.game.undo();
  const state = clone(h.game.state);
  const reloaded = harness({ data });
  assert.equal(reloaded.game.restore(), true);
  assert.deepEqual(reloaded.game.state, state);
  assert.equal(reloaded.game.undoLeft(), 0);
  last.solution.slice(4).forEach(action => reloaded.act(action));
  assert.equal(reloaded.game.state.status, 'won');
  assert.equal(reloaded.game.completion(), 999);
  assert.equal(reloaded.game.starCount(), 2997);
  assert.equal(reloaded.game.store.loadRun(), null);
  assert.equal(reloaded.game.modal.buttons[0].text, '返回邮局');
  assert.equal(reloaded.game.modal.buttons.some(button => button.text === '下一封信'), false);
  reloaded.game.modal.buttons[0].action();
  assert.equal(reloaded.game.page, 'home');
  const finished = harness({ data });
  assert.deepEqual(finished.game.profile().completed['999'], { stars: 3, bestTurns: last.par });
  assert.equal(finished.game.completion(), 999);
  h.destroy(); reloaded.destroy(); finished.destroy();
});

test('large campaign boards render and accept adjacent moves at phone sizes', () => {
  for (const metrics of [
    { width: 320, height: 568, pixelRatio: 1, safeTop: 0, safeBottom: 0 },
    { width: 390, height: 844, pixelRatio: 2, safeTop: 50, safeBottom: 34 },
  ]) {
    const h = harness({ metrics });
    for (const id of [121, 301, 361, 481, 601, 781, 999]) {
      h.start(CAMPAIGN[id - 1]); h.advance(1000); h.draw();
      if (id >= 301) assert.match(h.game.playHint(h.platform.now()), /没有富余拍数/);
      for (const hit of h.game.renderer.hits) {
        for (const value of [hit.x, hit.y, hit.w, hit.h]) assert.ok(Number.isFinite(value), `${id}: invalid hit region`);
      }
      const action = h.game.level.solution[0];
      const expected = replayed(h.game.level, [action]);
      const { neighbor } = require('../src/engine');
      const entered = action === 'wait' ? h.game.state.player : neighbor(h.game.level, h.game.state.player, action, h.game.state);
      tapBoardPoint(h, h.game.renderer.boardGeometry.projection.point(entered));
      h.draw();
      assert.equal(h.game.state.player, expected.player);
      assert.equal(h.game.state.energy, expected.energy);
      assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '撤回（1）'));
      assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '等一拍'));
    }
    h.destroy();
  }
});

test('repeated destination taps during arrival do not turn a move into an accidental wait', () => {
  for (const redraw of [false, true]) {
    const h = harness(); h.start(); h.draw(900);
    const target = h.game.state.player + 1;
    const device = boardDevicePoint(h, h.game.renderer.boardGeometry.projection.point(target));
    const tap = () => { h.game.pointerEvent(...device, 'start'); h.game.pointerEvent(...device, 'end'); };
    tap();
    const arrived = clone(h.game.state), saved = clone(h.game.store.loadRun());
    if (redraw) h.draw(70); else h.advance(70, false);
    tap();
    assert.equal(h.game.pendingAction, null, 'a duplicate move destination must not queue a wait');
    h.advance(MOVE_MS - 70);
    assert.deepEqual(h.game.state, arrived);
    assert.deepEqual(h.game.store.loadRun(), saved);
    tap();
    assert.deepEqual(h.game.actions, ['right', 'wait'], 'the settled foot tile still supports intentional waiting');
    h.destroy();
  }
});

test('the explicit wait button still queues an intentional wait during movement', () => {
  const h = harness(); h.start(); h.draw(900);
  tapBoardPoint(h, h.game.renderer.boardGeometry.projection.point(h.game.state.player + 1));
  h.draw(70);
  const r = h.game.renderer, button = r.hits.find(hit => hit.x === 201 && hit.w === 165 && hit.h === 52);
  assert.ok(button);
  const x = (button.x + button.w / 2) * r.scale + r.ox, y = (button.y + button.h / 2) * r.scale + r.oy;
  h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x, y, 'end');
  assert.equal(h.game.pendingAction.action, 'wait');
  h.advance(MOVE_MS - 70);
  assert.deepEqual(h.game.actions, ['right', 'wait']);
  h.destroy();
});

test('board inspection, viewport changes and cancelled touches discard buffered movement', () => {
  const gestures = [
    { name: 'zoom', run: (h, x, y) => h.game.zoomScene(x, y, 1.2) },
    { name: 'drag', run: (h, x, y) => {
      h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x + 40, y, 'move'); h.game.pointerEvent(x + 40, y, 'end');
    } },
    { name: 'resize', run: h => h.callbacks.resize() },
    { name: 'cancel', run: (h, x, y) => {
      h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x, y, 'cancel');
    } },
  ];
  for (const gesture of gestures) {
    const h = harness(); h.start(); h.game.camera.zoom = 1.3; h.draw(900);
    h.game.act('right'); h.advance(40, false); h.game.act('right');
    assert.ok(h.game.pendingAction);
    const state = clone(h.game.state), saved = clone(h.game.store.loadRun());
    const r = h.game.renderer, b = r.boardRect;
    gesture.run(h, (b.x + b.w / 2) * r.scale + r.ox, (b.y + b.h / 2) * r.scale + r.oy);
    assert.equal(h.game.pendingAction, null, gesture.name + ' cancels buffered movement immediately');
    h.advance(MOVE_MS * 2);
    assert.deepEqual(h.game.state, state, gesture.name + ' cannot spend a turn while inspecting the board');
    assert.deepEqual(h.game.store.loadRun(), saved);
    h.destroy();
  }
});

function propPoint(h, cell, kind) {
  const p = h.game.renderer.boardGeometry.projection, [x, y] = p.point(cell), now = h.platform.now();
  const size = p.halfW * (kind === 'letter' ? .76 : .7);
  if (kind === 'light') {
    const scale = size / 24, angle = Math.sin(now / 870 + x) * .06;
    return [x + (5 - 7 * Math.sin(angle)) * scale, y - 1 + (-25 + 7 * Math.cos(angle)) * scale];
  }
  const angle = Math.sin(now / 1500 + cell) * .09, offset = size * (kind === 'letter' ? .18 : .3);
  return [x + offset * Math.sin(angle), y - size * .5 + Math.sin(now / 670 + cell * .7) * 2.2 - offset * Math.cos(angle)];
}

test('visible mail and lantern shapes select their own cells across animation frames and camera views', () => {
  const samples = [
    { id: 7, turn: 9, cell: 35, kind: 'seal', action: 'down' },
    { id: 1, turn: 2, cell: 16, kind: 'letter', action: 'right' },
    { id: 19, turn: 2, cell: 31, kind: 'light', action: 'left' },
  ];
  for (const sample of samples) for (const elapsed of [2200, 2400, 2600, 2800, 3000]) for (const view of [
    { zoom: .7, panX: 0, panY: 0 }, { zoom: 1, panX: 0, panY: 0 }, { zoom: 1.4, panX: .02, panY: -.01 },
  ]) {
    const h = harness(), level = CAMPAIGN[sample.id - 1], actions = level.solution.slice(0, sample.turn), enteredAt = h.platform.now();
    h.start(level); actions.forEach(action => h.act(action)); Object.assign(h.game.camera, view); h.draw(enteredAt + elapsed - h.platform.now());
    tapBoardPoint(h, propPoint(h, sample.cell, sample.kind));
    assert.equal(h.game.state.player, sample.cell, sample.kind + ' selects its painted object instead of the floor behind it');
    assert.deepEqual(h.game.state, replayed(level, [...actions, sample.action]));
    h.destroy();
  }
});

test('prop hit shapes preserve exposed neighboring floors and do not move toward distant objects', () => {
  for (const zoom of [1, 1.4]) for (const target of [28, 35, 33]) {
    const h = harness(), level = CAMPAIGN[6], actions = level.solution.slice(0, 9);
    h.start(level); actions.forEach(action => h.act(action)); h.game.camera.zoom = zoom; h.draw(600);
    const before = clone(h.game.state), p = h.game.renderer.boardGeometry.projection;
    tapBoardPoint(h, target === 33 ? propPoint(h, target, 'seal') : p.point(target));
    if (target === 33) {
      assert.deepEqual(h.game.state, before, 'the distant stamp cannot activate a floor hidden behind it');
      assert.match(h.game.toastText, /点相邻格/);
    } else assert.equal(h.game.state.player, target, 'uncovered floor ' + target + ' remains directly reachable');
    h.destroy();
  }
});

test('WeChat renders a bounded canvas shake for pickups and wins without hardware vibration', () => {
  const cases = [
    { id: 1, actions: ['right'], shakes: false },
    { id: 1, actions: ['wait'], shakes: false },
    { id: 1, actions: Array(CAMPAIGN[0].budget).fill('wait'), shakes: false },
    { id: 1, turns: 3, shakes: true },
    { id: 7, turns: 7, shakes: true },
    { id: 19, turns: 3, shakes: true },
    { id: 1, turns: 4, shakes: true },
  ];
  for (const sample of cases) {
    const h = harness({ kind: 'wechat' }), level = CAMPAIGN[sample.id - 1];
    assert.equal(h.platform.wx.vibrateShort, undefined, 'the device bridge provides no hardware vibration');
    h.platform.vibrate = () => {};
    h.start(level); h.draw(900);
    (sample.actions || level.solution.slice(0, sample.turns)).forEach(action => h.act(action));
    if (h.game.state.status === 'playing') h.game.act('wait');
    const snapshot = clone({ state: h.game.state, actions: h.game.actions, saved: h.game.store.loadRun(), pending: h.game.pendingAction });
    const camera = h.game.camera, baseline = { zoom: camera.zoom, panX: camera.panX, panY: camera.panY };
    h.draw(45);
    const view = h.game.renderer.boardGeometry.view, dx = view.panX - baseline.panX, dy = view.panY - baseline.panY;
    assert.equal(Math.hypot(dx, dy) > 0, sample.shakes, JSON.stringify(sample));
    assert.ok(Math.abs(dx) <= .012 && Math.abs(dy) <= .0045, 'feedback stays within a few screen pixels');
    h.draw(215);
    assert.equal(h.game.renderer.boardGeometry.view.panX, baseline.panX, 'the view settles after 260 ms');
    assert.equal(h.game.renderer.boardGeometry.view.panY, baseline.panY);
    assert.deepEqual({ zoom: camera.zoom, panX: camera.panX, panY: camera.panY }, baseline, 'visual feedback cannot drift the chosen camera');
    assert.deepEqual(clone({ state: h.game.state, actions: h.game.actions, saved: h.game.store.loadRun(), pending: h.game.pendingAction }), snapshot,
      'drawing the effect never advances the puzzle, saves a turn or changes queued input');
    h.destroy();
  }
});

test('shaking board projections keep floor and floating-object taps aligned after zoom and pan', () => {
  const targets = [{ cell: 23, kind: 'letter', action: 'up' }, { cell: 35, kind: 'seal', action: 'down' }, { cell: 28, action: 'left' }];
  for (const zoom of [.7, 1, 1.4]) for (const target of targets) {
    const h = harness({ kind: 'wechat' }), level = CAMPAIGN[6], actions = level.solution.slice(0, 7);
    h.start(level); actions.slice(0, -1).forEach(action => h.act(action)); h.draw(400);
    h.game.camera.zoomAt(zoom); h.game.camera.pan(.06, -.02); h.act(actions.at(-1)); h.draw(45);
    const r = h.game.renderer, view = r.boardGeometry.view;
    assert.ok(Math.hypot(view.panX - h.game.camera.panX, view.panY - h.game.camera.panY) > 0);
    const point = target.kind ? propPoint(h, target.cell, target.kind) : r.boardGeometry.projection.point(target.cell);
    tapBoardPoint(h, point);
    assert.equal(h.game.pendingAction.action, target.action, 'the visibly shifted target queues its own grid direction');
    assert.deepEqual(h.game.actions, actions, 'the active move must finish before the tapped next step');
    h.advance(MOVE_MS - 45);
    assert.deepEqual(h.game.state, replayed(level, [...actions, target.action]));
    assert.deepEqual(h.game.actions, [...actions, target.action]);
    h.destroy();
  }
});

test('canvas shake is cleared by pausing, lifecycle changes, route recovery and camera gestures', () => {
  const transitions = [
    { name: 'pause', run: h => { h.game.pause(); h.game.modal.buttons[0].action(); } },
    { name: 'background', run: h => { h.callbacks.hide(); h.callbacks.show(); h.game.modal.buttons[0].action(); } },
    { name: 'resize', run: h => h.callbacks.resize() },
    { name: 'undo', run: h => h.game.undo() },
    { name: 'restart', run: h => h.start() },
    { name: 'restore', run: h => assert.equal(h.game.restore(), true) },
    { name: 'zoom', run: (h, x, y) => h.game.zoomScene(x, y, 1.1) },
    { name: 'pan', run: (h, x, y) => {
      h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x + 40, y, 'move'); h.game.pointerEvent(x + 40, y, 'end');
    } },
  ];
  for (const transition of transitions) {
    const h = harness(); h.start(); h.game.camera.zoomAt(1.4); h.draw(900);
    CAMPAIGN[0].solution.slice(0, 3).forEach(action => h.act(action)); h.draw(45);
    const camera = h.game.camera, active = camera.frame(h.platform.now());
    assert.ok(Math.hypot(active.panX - camera.panX, active.panY - camera.panY) > 0);
    const r = h.game.renderer, b = r.boardRect;
    transition.run(h, (b.x + b.w / 2) * r.scale + r.ox, (b.y + b.h / 2) * r.scale + r.oy);
    for (const age of [0, 40, 300]) {
      h.draw(age);
      const view = camera.frame(h.platform.now());
      assert.equal(view.panX, camera.panX, transition.name + ' clears horizontal feedback without a later replay');
      assert.equal(view.panY, camera.panY, transition.name + ' clears vertical feedback without a later replay');
    }
    h.destroy();
  }
});

test('friend-only ranking navigation preserves the active route and has no world tab', () => {
  for (const metrics of [{ width: 320, height: 568, pixelRatio: 2, safeTop: 20, safeBottom: 0 }, { width: 390, height: 844, pixelRatio: 3, safeTop: 50, safeBottom: 34 }]) {
    const h = harness({ kind: 'browser', metrics }); h.start(); h.act('right');
    const saved = clone(h.game.store.loadRun()); h.game.openPage('leaderboard'); h.draw();
    const labels = h.calls.filter(call => call.method === 'fillText').map(call => String(call.args[0]));
    assert.ok(labels.includes('好友排行')); assert.ok(!labels.includes('全服榜') && !labels.includes('世界榜'));
    assert.equal(h.game.listScroll(), null); assert.equal(h.game.rankingAuthorization.getState().status, 'unavailable');
    h.game.home(); assert.deepEqual(h.game.store.loadRun(), saved); h.destroy();
  }
});

test('rank reminder is checked silently and requested only by the explicit ranking action', async () => {
  const settings = [], requests = [];
  const h = harness({ wx: {
    getSetting(options) {
      assert.equal(options.withSubscriptions, true);
      settings.push(options);
      options.success({ subscriptionsSetting: { mainSwitch: true, itemSettings: {} } });
    },
    requestSubscribeSystemMessage(options) { requests.push(options); }
  } });
  try {
    assert.equal(requests.length, 0, 'startup never opens a subscription prompt');
    h.game.openPage('leaderboard');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settings.length, 1);
    assert.equal(requests.length, 0, 'entering and rendering rankings only reads the current setting');

    const result = h.game.subscribeRankReminder();
    assert.equal(requests.length, 1, 'the native prompt starts synchronously in the explicit action');
    assert.deepEqual(requests[0].msgTypeList, ['SYS_MSG_TYPE_RANK']);
    requests[0].success({ errMsg: 'requestSubscribeSystemMessage:ok', SYS_MSG_TYPE_RANK: 'accept' });
    assert.equal((await result).status, 'accepted');
    assert.equal(h.game.rankMessageSubscription.getState().status, 'accepted');
  } finally { h.destroy(); }
});

test('friend ranking uses existing local bests after privacy and friend consent without login or profile access', async () => {
  const events = [], privacy = [], authorizations = [], messages = [];
  const context = { canvas: { width: 1, height: 1 }, postMessage(message) { messages.push(message); } };
  const h = harness({ development: true, wx: {
    get cloud() { throw new Error('Cloud development must not be accessed'); },
    get login() { throw new Error('Native friend ranking needs no login'); },
    requirePrivacyAuthorize(options) { events.push('privacy'); privacy.push(options); },
    getSetting(options) { options.success({ authSetting: { 'scope.userInfo': false } }); },
    getUserInfo() { throw new Error('Friend ranking must not read profile data in the main domain'); },
    createUserInfoButton() { throw new Error('Friend ranking must not create a profile button'); },
    authorize(options) { events.push('friend-permission'); authorizations.push(options); },
    getOpenDataContext() { return context; }
  } });
  h.game.store.recordWin(2, 2, 6); // Pre-existing progress needs no replay upload.
  h.start(); CAMPAIGN[0].solution.forEach(action => h.act(action));
  h.callbacks.hide(); h.callbacks.show(); assert.deepEqual(events, []); assert.deepEqual(messages, []);
  h.game.openPage('leaderboard'); privacy[0].fail({ errMsg: 'requirePrivacyAuthorize:fail auth deny' });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(messages, []);
  h.game.home(); h.game.openPage('leaderboard'); privacy[1].success();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(authorizations[0].scope, 'scope.WxFriendInteraction'); assert.deepEqual(messages, []);
  authorizations[0].success(); await new Promise(resolve => setImmediate(resolve)); h.draw();
  const submitted = messages.find(message => message.action === 'submit');
  assert.ok(submitted); assert.equal(submitted.key, 'stars_development');
  assert.deepEqual(submitted.score, { v: 2, stars: 5, completed: 2, turns: 10, name: '我', avatarUrl: '' });
  assert.equal(h.game.friendLeaderboard.getState().status, 'ready');
  h.game.home(); h.game.store.recordWin(2, 3, 5); h.game.syncFriendScore();
  assert.equal(messages.filter(message => message.action === 'submit').at(-1).score.stars, 6);
  assert.equal(Array.from(h.data.keys()).some(key => key.startsWith('wind-letter.ranking.')), false);
  h.destroy();
});

function rankingHarness(options = {}) {
  const messages = [], authorizations = [], settings = [], checks = [], privacy = [];
  let holdChecks = false;
  const permissions = { 'scope.userInfo': false, ...(options.friendGranted ? { 'scope.WxFriendInteraction': true } : {}) };
  const context = { canvas: { width: 1, height: 1 }, postMessage: message => messages.push(message) };
  const h = harness({ wx: {
    requirePrivacyAuthorize: request => { privacy.push(request); if (!options.holdPrivacy) request.success(); },
    getSetting: options => { if (holdChecks) checks.push(options); else options.success({ authSetting: { ...permissions } }); },
    getUserInfo() { throw new Error('Friend ranking must not read profile data in the main domain'); },
    createUserInfoButton() { throw new Error('Friend ranking must not create a profile button'); },
    authorize: options => authorizations.push({ ...options,
      success: result => { permissions['scope.WxFriendInteraction'] = true; options.success(result); },
      fail: error => { permissions['scope.WxFriendInteraction'] = false; options.fail(error); } }),
    openSetting: options => settings.push({ ...options,
      success: result => { Object.assign(permissions, result && result.authSetting); options.success(result); } }),
    getOpenDataContext: () => context,
  } });
  h.game.store.recordWin(1, 3, 4);
  return { ...h, messages, authorizations, settings, checks, privacy, permissions,
    holdChecks: value => { holdChecks = value; } };
}
const rankingTick = () => new Promise(resolve => setImmediate(resolve));

test('revisiting rankings rechecks friend permission before a changed local score is submitted', async () => {
  for (const revoked of [false, true]) {
    const h = rankingHarness();
    try {
      h.game.openPage('leaderboard'); await rankingTick(); h.authorizations[0].success(); await rankingTick();
      h.game.home(); h.game.store.recordWin(2, 3, 5); h.messages.length = 0; h.holdChecks(true);
      h.game.openPage('leaderboard'); h.draw();
      assert.equal(h.game.friendLeaderboard.getState().status, 'preview', 'the click immediately restores the cached child');
      assert.ok(h.calls.some(call => call.method === 'drawImage'), 'cached ranks are drawn before any permission reply');
      assert.equal(h.calls.some(call => call.method === 'fillText' && /正在确认微信授权|等待授权|我的邮路/.test(String(call.args[0]))), false,
        'returning players see neither an authorization card nor empty placeholders');
      await rankingTick();
      assert.equal(h.authorizations.length, 1); assert.equal(h.privacy.length, 1);
      assert.equal(h.checks.length, 1);
      assert.equal(h.messages.some(message => ['open', 'refresh', 'retry', 'submit'].includes(message.action)), false,
        'showing cached ranks cannot initiate reads or changed-score uploads during permission validation');
      h.checks[0].success({ authSetting: { ...h.permissions, 'scope.WxFriendInteraction': !revoked } }); await rankingTick();
      assert.equal(h.authorizations.length, 1, 'a current settings snapshot replaces repeated friend authorization');
      if (revoked) {
        assert.equal(h.messages.some(message => message.action === 'submit'), false);
        assert.equal(h.game.friendLeaderboard.getState().status, 'denied');
      } else {
        assert.equal(h.messages.filter(message => message.action === 'open').length, 1);
        const submitted = h.messages.filter(message => message.action === 'submit');
        assert.equal(submitted.length, 1);
        assert.deepEqual(submitted[0].score,
          { v: 2, stars: 6, completed: 2, turns: 9, name: '我', avatarUrl: '' });
      }
    } finally { h.game.home(); h.destroy(); }
  }
});

test('scope.userInfo false does not remove an already visible cached leaderboard', async () => {
  const h = rankingHarness();
  try {
    h.game.openPage('leaderboard'); await rankingTick(); h.authorizations[0].success(); await rankingTick();
    h.game.home(); h.messages.length = 0; h.holdChecks(true);
    h.game.openPage('leaderboard'); h.draw(); await rankingTick();
    assert.ok(h.calls.some(call => call.method === 'drawImage'));
    h.checks[0].success({ authSetting: { 'scope.userInfo': false, 'scope.WxFriendInteraction': true } });
    await rankingTick(); h.game.loop(); h.draw();
    assert.equal(h.game.rankingAuthorization.getState().enabled, true);
    assert.equal(h.game.rankingAuthorization.getState().canDisplay, true);
    assert.equal(h.game.friendLeaderboard.getState().status, 'ready');
    assert.equal(h.messages.some(message => message.action === 'close'), false);
    assert.ok(h.calls.some(call => call.method === 'drawImage'));
  } finally { h.game.home(); h.destroy(); }
});

test('a denied friend permission opens settings only from the visible authorization button', async () => {
  const h = rankingHarness();
  try {
    h.game.openPage('leaderboard'); await rankingTick(); h.authorizations[0].fail(); await rankingTick();
    h.game.home(); h.game.openPage('leaderboard'); await rankingTick(); h.draw();
    assert.equal(h.settings.length, 0, 'reentering the page must leave the settings decision to the player');
    assert.equal(h.game.friendLeaderboard.getState().status, 'denied');
    const consent = h.game.renderer.hits.find(hit => hit.w === 206);
    assert.ok(consent, 'friend authorization recovery remains available'); consent.action();
    assert.equal(h.settings.length, 1, 'the button opens native settings synchronously');
    h.settings[0].success({ authSetting: { 'scope.WxFriendInteraction': true } }); await rankingTick();
    assert.equal(h.game.friendLeaderboard.getState().status, 'ready');
    assert.ok(h.messages.some(message => message.action === 'submit'));
  } finally { h.game.home(); h.destroy(); }
});

test('foreground recovery gates friend traffic only on the friend permission snapshot', async () => {
  for (const friendRevoked of [true, false]) {
    const h = rankingHarness();
    try {
      h.game.openPage('leaderboard'); await rankingTick(); h.authorizations[0].success(); await rankingTick();
      h.callbacks.hide(); h.game.store.recordWin(2, 3, 5); h.messages.length = 0; h.holdChecks(true);
      h.callbacks.show(); h.game.syncFriendScore();
      assert.equal(h.checks.length, 1); assert.equal(h.game.rankingAuthorization.getState().enabled, false);
      assert.equal(h.messages.some(message => ['open', 'submit', 'retry', 'refresh'].includes(message.action)), false,
        'cached preview draws cannot resume data traffic while permissions are being checked');
      h.checks[0].success({ authSetting: { ...h.permissions, 'scope.userInfo': false,
        'scope.WxFriendInteraction': !friendRevoked } }); await rankingTick();
      const traffic = h.messages.filter(message => ['submit', 'retry', 'refresh'].includes(message.action));
      assert.equal(h.game.rankingAuthorization.getState().enabled, true,
        'scope.userInfo is not a privacy or friend-ranking gate');
      if (friendRevoked) {
        assert.deepEqual(traffic, []);
        assert.equal(h.game.friendLeaderboard.getState().status, 'denied');
      } else {
        assert.equal(traffic.filter(message => message.action === 'submit').length, 1);
        assert.equal(traffic.filter(message => message.action === 'refresh').length, 1);
        assert.equal(traffic.find(message => message.action === 'submit').score.stars, 6);
      }
      assert.equal(h.authorizations.length, 1, 'returning to foreground does not open an authorization dialog');
    } finally { h.game.home(); h.destroy(); }
  }
});

test('privacy authorization completed in the background restores sync without opening the friend list', async () => {
  const h = rankingHarness({ friendGranted: true, holdPrivacy: true });
  try {
    h.game.openPage('leaderboard'); h.callbacks.hide();
    h.privacy[0].success(); await rankingTick();
    assert.equal(h.game.rankingAuthorization.getState().enabled, true);
    assert.equal(h.authorizations.length, 0); assert.deepEqual(h.messages, []);
    h.callbacks.show(); await rankingTick();
    assert.equal(h.authorizations.length, 0, 'an existing friend grant is restored without another prompt');
    assert.equal(h.game.friendLeaderboard.getState().status, 'idle', 'a background callback cannot open the visible list');
    assert.ok(h.messages.some(message => message.action === 'submit'));
    assert.equal(h.messages.some(message => message.action === 'open'), false);
    h.game.openFriendLeaderboard(); assert.equal(h.authorizations.length, 1);
    h.authorizations[0].success(); await rankingTick();
    assert.equal(h.game.friendLeaderboard.getState().status, 'ready');
    assert.ok(h.messages.some(message => message.action === 'open'));
  } finally { h.game.home(); h.destroy(); }
});

test('friend grants wait for foreground validation and obey its current friend-permission result', async () => {
  for (const friendAllowed of [false, true]) {
    const h = rankingHarness();
    try {
      h.game.openPage('leaderboard'); await rankingTick();
      h.callbacks.hide(); h.holdChecks(true); h.callbacks.show();
      h.authorizations[0].success(); await rankingTick();
      assert.deepEqual(h.messages, [], 'no friend data is requested before the settings check completes');
      h.checks[0].success({ authSetting: { 'scope.userInfo': false,
        'scope.WxFriendInteraction': friendAllowed } }); await rankingTick();
      assert.equal(h.game.rankingAuthorization.getState().enabled, true);
      if (friendAllowed) {
        assert.equal(h.game.friendLeaderboard.getState().status, 'ready');
        assert.ok(h.messages.some(message => message.action === 'open'));
        assert.ok(h.messages.some(message => message.action === 'submit'));
      } else {
        assert.equal(h.game.friendLeaderboard.getState().status, 'denied');
        assert.deepEqual(h.messages, [], 'a stale grant callback cannot bypass the current denied snapshot');
      }
    } finally { h.game.home(); h.destroy(); }
  }
});

test('a background friend grant defers all open-data traffic until foreground consent is confirmed', async () => {
  const h = rankingHarness();
  try {
    h.game.openPage('leaderboard'); await rankingTick(); h.callbacks.hide();
    h.authorizations[0].success(); await rankingTick(); assert.deepEqual(h.messages, []);
    h.callbacks.show(); await rankingTick();
    assert.equal(h.game.friendLeaderboard.getState().status, 'ready');
    assert.ok(h.messages.some(message => message.action === 'submit'));
  } finally { h.game.home(); h.destroy(); }
});

test('a failed or page-cancelled foreground check can recover pending scores on a later foreground visit', async () => {
  for (const outcome of ['failure', 'close']) {
    const h = rankingHarness();
    try {
      h.game.openPage('leaderboard'); await rankingTick(); h.authorizations[0].success(); await rankingTick();
      h.callbacks.hide(); h.game.store.recordWin(2, 3, 5); h.holdChecks(true); h.callbacks.show();
      if (outcome === 'failure') h.checks[0].fail({ errMsg: 'getSetting:fail offline' }); else h.game.home();
      await rankingTick(); assert.equal(h.game.rankingAuthorization.getState().enabled, false);
      h.messages.length = 0; h.callbacks.hide(); h.callbacks.show();
      assert.equal(h.checks.length, 2, 'temporary failure must not disable all subsequent checks');
      h.checks[1].success({ authSetting: { ...h.permissions } }); await rankingTick();
      assert.equal(h.game.rankingAuthorization.getState().enabled, true);
      assert.equal(h.messages.find(message => message.action === 'submit').score.stars, 6);
      assert.equal(h.authorizations.length, 1, 'recovery uses existing permissions without another prompt');
    } finally { h.game.home(); h.destroy(); }
  }
});

test('WeChat scene motion draws at 60 FPS and returns to 30 without accelerating turns or paused routes', t => {
  const { INTRO_MS } = require('../src/camera');
  const h = harness(); t.after(() => h.destroy());
  const draw = h.game.renderer.draw.bind(h.game.renderer), drawnAt = [];
  h.game.renderer.draw = (...args) => { drawnAt.push(h.platform.now()); draw(...args); };
  const frame = ms => { h.advance(ms, false); h.callbacks.frame(); };
  h.start(CAMPAIGN[1]);
  const initial = clone(h.game.state);
  for (const ms of [10, 15, 17, 8]) frame(ms);
  assert.equal(h.frameRates.at(-1), 60, 'the entrance uses the native 60 FPS cadence');
  assert.equal(drawnAt.length, 4, 'each entrance RAF is painted, including short intervals');
  assert.deepEqual(h.game.state, initial, 'the entrance itself spends no turns or light');

  frame(INTRO_MS);
  assert.equal(h.frameRates.at(-1), 30);
  let before = drawnAt.length;
  frame(1000 / 60);
  assert.equal(drawnAt.length, before, 'a settled board skips the next 60 Hz callback');
  frame(1000 / 60);
  assert.equal(drawnAt.length, before + 1, 'a settled board paints at 30 FPS');

  h.game.act('right');
  before = drawnAt.length;
  for (const ms of [9, 17, 8]) frame(ms);
  assert.equal(h.frameRates.at(-1), 60, 'a real move restores smooth rendering');
  assert.equal(drawnAt.length, before + 3, 'movement paints every native callback');
  const firstMove = clone(h.game.state);
  h.game.act('right');
  assert.equal(h.game.pendingAction.action, 'right');
  frame(MOVE_MS - 35);
  assert.deepEqual(h.game.state, firstMove, 'extra drawing never executes a buffered turn early');
  frame(1);
  assert.equal(h.game.state.turn, initial.turn + 2, 'the buffered turn executes at the original MOVE_MS boundary');
  assert.equal(h.game.state.energy, initial.energy - 2);
  assert.deepEqual(h.game.actions, ['right', 'right']);
  assert.equal(h.frameRates.at(-1), 60, 'the buffered movement also receives smooth frames');
  frame(MOVE_MS + 1);
  assert.equal(h.frameRates.at(-1), 60, 'arrival feedback stays smooth after the actor finishes moving');
  frame(600);
  assert.equal(h.frameRates.at(-1), 30, 'completed movement and arrival feedback return to the idle cadence');

  h.game.act('down'); frame(10);
  assert.equal(h.frameRates.at(-1), 60);
  h.game.act('down');
  const paused = clone({ state: h.game.state, actions: h.game.actions, run: h.game.store.loadRun() });
  h.game.pause();
  assert.equal(h.game.pendingAction, null);
  before = drawnAt.length;
  frame(1000 / 60);
  assert.equal(h.frameRates.at(-1), 30, 'pause overrides an in-flight scene animation');
  assert.equal(drawnAt.length, before);
  frame(1000 / 60);
  assert.equal(drawnAt.length, before + 1);
  frame(MOVE_MS + 1);
  assert.deepEqual(clone({ state: h.game.state, actions: h.game.actions, run: h.game.store.loadRun() }), paused,
    'paused frames neither consume light nor execute the cancelled input');
});


test('disabling operation sounds immediately silences effects while keeping music alive', t => {
  const h = harness({ withAudio: true }); t.after(() => h.destroy());
  h.game.openPage('settings'); h.game.cue('letter');
  const music = h.audio.find(voice => voice.loop && voice.playing);
  assert.ok(music);
  assert.ok(h.audio.some(voice => !voice.loop && voice.playing));
  h.game.toggle('sound');
  assert.equal(h.game.profile().settings.sound, false);
  assert.equal(h.audio.filter(voice => !voice.loop && voice.playing).length, 0);
  assert.equal(music.playing, true);
  assert.equal(music.destroyed, false);
  const count = h.audio.length;
  h.callbacks.key('Escape'); h.game.cue('letter');
  assert.equal(h.audio.length, count, 'navigation respects the disabled operation sound setting');
});

test('page touch feedback cancels on drag and navigation emits one semantic cue', t => {
  const h = harness(); t.after(() => h.destroy());
  h.game.openPage('settings'); h.draw(400);
  const r = h.game.renderer;
  const device = (x, y) => [r.ox + x * r.scale, r.oy + y * r.scale];
  const before = clone(h.game.profile().settings);
  h.callbacks.pointer(...device(80, 113), 'start');
  h.callbacks.pointer(...device(120, 113), 'move');
  h.callbacks.pointer(...device(80, 113), 'end');
  assert.deepEqual(h.game.profile().settings, before, 'dragging off a setting never toggles it');
  assert.equal(r.uiFeedback, null);
  h.soundCalls.length = 0;
  h.callbacks.pointer(...device(38, 32), 'start');
  h.callbacks.pointer(...device(38, 32), 'end');
  assert.equal(h.game.page, 'home');
  assert.deepEqual(h.soundCalls.filter(call => call[0] === 'play'), [['play', 'page']]);
  h.draw(40); assert.equal(r.uiFeedback, null, 'the outgoing control ripple cannot bleed onto home');
  h.soundCalls.length = 0;
  h.game.openPage('collection'); h.callbacks.key('Escape');
  assert.deepEqual(h.soundCalls.filter(call => call[0] === 'play'), [['play', 'page'], ['play', 'page']]);
});


test('supply reward chime acknowledges only a completed visible reward and never queues from the background', async t => {
  for (const outcome of ['cancelled', 'completed', 'hidden']) {
    const h = harness({ development: true }); t.after(() => h.destroy());
    h.start(CAMPAIGN[22]); h.game.selectItem('oil'); h.callbacks.key('Enter');
    if (outcome === 'hidden') h.callbacks.hide();
    await completeItemVideo(h, outcome !== 'cancelled');
    assert.equal(h.soundCalls.filter(call => call[0] === 'play' && call[1] === 'reward').length,
      outcome === 'completed' ? 1 : 0, outcome);
    if (outcome === 'hidden') {
      h.callbacks.show(); h.advance(1000);
      assert.equal(h.soundCalls.some(call => call[0] === 'play' && call[1] === 'reward'), false);
    }
  }
});
