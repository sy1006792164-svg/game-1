'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN, getDaily, undoFor } = require('../src/levels');
const { MOVE_MS } = require('../src/motion');
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
    if (specifier === './sound') return { createSound: () => ({ play() {}, stop() {}, release() {} }) };
    if (specifier === './config') return { REWARDED_AD_UNIT_ID: options.configured === false ? '' : 'adunit-integrationtest' };
    return actualRequire(specifier);
  }, module, module.exports, ClockDate);
  const game = new module.exports.Game(platform);
  function draw() { calls.length = 0; now += 200; game.renderer.draw(game, now, metrics); }
  return {
    game, data, clock, calls, callbacks, platform, draw,
    get showCount() { return showCount; },
    advance(ms, runLoop = true) { now += ms; if (runLoop) game.loop(); },
    act(action) { now += 200; game.act(action); },
    start(level = CAMPAIGN[0], mode = 'campaign') { game.start(level, mode); },
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
      const controls = h.game.renderer.hits.filter(hit => hit.w === 165 && hit.h === 52);
      assert.equal(controls.length, 1, 'only wait is clickable before the first move');
      assert.equal(controls[0].x, 201, 'the disabled undo button has no click target');
      const boardBottom = h.game.renderer.boardRect.y + h.game.renderer.boardRect.h;
      assert.ok(controls.every(hit => hit.y > boardBottom && hit.y + hit.h <= h.game.renderer.H));
      assert.equal(h.calls.some(call => call.method === 'fillText' && call.args[0] === '回声预告'), false);
      h.game.help(); h.draw();
    }
    for (const page of ['home', 'levels', 'progress', 'collection', 'settings']) { h.game.openPage(page); h.draw(); }
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
  assert.match(h.game.modal.buttons[0].text, /看视频续灯/, 'with a configured ad the relight leads the failure dialog');
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
  assert.match(h.game.modal.lines[1], /个人最佳 4 拍.*多走 1 拍/);
  assert.deepEqual(h.game.profile().completed['1'], before);
  assert.equal(h.game.profile().totalWins, 1, 'a repeat delivery must not inflate distinct wins');
  h.destroy();
});

test('legacy growth links open collection and stored goals route to the matching chapter', () => {
  const h = harness();
  finishCampaign(h, 3);
  h.game.openPage('progress');
  assert.equal(h.game.page, 'collection');
  assert.equal(h.game.progress().goals.some(goal => goal.action === 'expert'), false, 'the retired expert goal never appears');
  const dailyGoal = h.game.progress().goals.find(goal => goal.action === 'daily');
  h.game.goal(dailyGoal.action);
  assert.equal(h.game.modal, null);
  assert.equal(h.game.page, 'game');
  assert.equal(h.game.mode, 'daily');
  assert.equal(h.game.runDate, h.clock.date);

  // Stored progress sets up a later chapter without making this navigation
  // regression replay dozens of unrelated maps.
  for (const level of CAMPAIGN.slice(0, 7)) h.game.store.recordWin(level.id, level.id === 7 ? 2 : 3, level.par, 'campaign');
  const refineGoal = h.game.progress().goals.find(goal => goal.action === 'stars');
  assert.ok(refineGoal);
  h.game.goal(refineGoal.action);
  assert.equal(h.game.page, 'levels');
  assert.equal(h.game.chapter, 1);
  h.game.openPage('levels');
  assert.equal(h.game.chapter, 1, 'the level list opens on the chapter of the next undelivered route');
  h.destroy();
});

test('the next-campaign growth goal cannot resume an unrelated daily save', () => {
  const h = harness();
  finishCampaign(h, 3);
  h.start(getDaily(h.clock.date), 'daily');
  h.act(h.game.level.solution[0]);
  h.game.openPage('progress');
  const goal = h.game.progress().goals.find(item => item.action === 'campaign');
  assert.ok(goal);
  h.game.goal(goal.action);
  assert.equal(h.game.page, 'game');
  assert.equal(h.game.mode, 'campaign', 'the campaign goal must not restore a daily run');
  assert.equal(h.game.level.id, 4);
  assert.equal(h.game.state.turn, 0);
  h.destroy();
});

test('daily starts immediately and reopening after midnight starts and scores the new calendar date', () => {
  const clock = { date: '2026-09-07' };
  const h = harness({ clock });
  h.game.daily();
  assert.equal(h.game.modal, null);
  assert.equal(h.game.page, 'game');
  assert.equal(h.game.runDate, clock.date);
  assert.equal(h.game.level.id, 'daily-2026-09-07');
  h.act(h.game.level.solution[0]);
  clock.date = '2026-09-08';
  h.game.daily();
  assert.equal(h.game.modal, null);
  assert.equal(h.game.state.turn, 0);
  assert.equal(h.game.dateKey, clock.date);
  assert.equal(h.game.runDate, clock.date);
  assert.equal(h.game.level.id, 'daily-2026-09-08');
  assert.deepEqual(h.game.level, getDaily(clock.date));
  h.game.level.solution.forEach(action => h.act(action));
  assert.equal(h.game.state.status, 'won');
  assert.equal(h.game.profile().daily['2026-09-07'], undefined);
  assert.equal(h.game.profile().daily['2026-09-08'].stars, 3);
  h.destroy();
});

test('idle home and collection keep stored calendar progress current after midnight', () => {
  for (const page of ['home', 'collection']) {
    const clock = { date: '2026-09-13' };
    const h = harness({ clock });
    h.game.store.recordWin('daily-' + clock.date, 3, 20, 'daily', clock.date);
    h.game.openPage(page);
    h.draw();
    assert.equal(h.game.progress().weekly.count, 1);
    assert.equal(h.game.progress().goals.find(goal => goal.action === 'daily').complete, true);
    clock.date = '2026-09-14';
    h.game.dateCheckedAt = 0;
    h.game.loop();
    h.draw();
    assert.equal(h.game.page, page);
    assert.equal(h.game.dateKey, clock.date);
    assert.equal(h.game.progress().weekly.count, 0, 'Sunday wins do not count toward the new week');
    assert.equal(h.game.progress().goals.find(goal => goal.action === 'daily').complete, false);
    assert.equal(h.game.progress().weekly.days.find(day => day.today).dateKey, clock.date);
    if (page === 'home') assert.equal(h.calls.some(call => call.method === 'fillText' && /今日风笺|成长|本周/.test(call.args[0])), false);
    h.destroy();
  }
});

test('calendar refresh during an active daily preserves that route and its original scoring date', () => {
  const clock = { date: '2026-09-07' };
  const h = harness({ clock });
  h.start(getDaily(clock.date), 'daily');
  h.game.level.solution.slice(0, 2).forEach(action => h.act(action));
  const before = clone(h.game.state);
  clock.date = '2026-09-08';
  h.game.dateCheckedAt = 0;
  h.game.loop();
  assert.equal(h.game.dateKey, clock.date);
  assert.equal(h.game.runDate, '2026-09-07');
  assert.equal(h.game.level.id, 'daily-2026-09-07');
  assert.deepEqual(h.game.state, before);
  h.game.level.solution.slice(2).forEach(action => h.act(action));
  assert.equal(h.game.profile().daily['2026-09-07'].stars, 3);
  assert.equal(h.game.profile().daily['2026-09-08'], undefined);
  h.destroy();
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
  assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '纸桥碎了'), 'the board flashes the tear');
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

test('the game screen retains undo and wait while removing duplicate controls and numeric overlays', () => {
  const h = harness(); h.start(CAMPAIGN[15]);
  h.draw();
  const texts = () => h.calls.filter(call => call.method === 'fillText').map(call => String(call.args[0]));
  assert.ok(texts().includes('撤回（2）'), 'chapter three routes allow two undos');
  assert.ok(texts().includes('等一拍'));
  assert.equal(texts().some(text => /三星|二星|回声预告|1×|^[A-F][1-6]$|^[A-F]$/.test(text)), false);
  assert.equal(h.game.renderer.hits.some(hit => hit.w === 50 && hit.h === 42), false, 'the direction pad is removed');
  h.act(CAMPAIGN[15].solution[0]);
  h.game.undo();
  h.draw();
  assert.ok(texts().includes('撤回（1）'));
  h.game.openPage('levels'); h.game.chapter = 2; h.draw();
  assert.ok(h.game.renderer.hits.length > 0);
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
    { name: 'settings', leave: h => h.game.openPage('settings'), resume: h => assert.equal(h.game.restore(), true) },
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
  h.data.set(RUN_KEY, { ...clone(h.game.store.loadRun()), revision: '3-intro2' });
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.level.id, 4);
  assert.equal(reloaded.game.state.turn, 0);
  assert.deepEqual(reloaded.game.actions, []);
  assert.equal(reloaded.game.store.loadRun().revision, '4');
  assert.match(reloaded.game.toastText, /路线已升级/);
  assert.deepEqual(reloaded.game.profile(), earned);
  h.destroy(); reloaded.destroy();
});

test('a current-version save resumes its exact actions without an upgrade notice', () => {
  const h = harness(); finishCampaign(h, 2);
  h.start(CAMPAIGN[2]);
  CAMPAIGN[2].solution.slice(0, 3).forEach(action => h.act(action));
  const before = clone(h.game.state), actions = clone(h.game.actions), earned = clone(h.game.profile());
  assert.equal(h.game.store.loadRun().revision, '4');
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.level.id, 3);
  assert.deepEqual(reloaded.game.state, before);
  assert.deepEqual(reloaded.game.actions, actions);
  assert.deepEqual(reloaded.game.profile(), earned);
  assert.doesNotMatch(reloaded.game.toastText, /路线已升级/);
  h.destroy(); reloaded.destroy();
});

test('the fresh home offers one delivery action and compact selection, stamp and settings links', () => {
  const h = harness(); h.draw();
  const texts = h.calls.filter(call => call.method === 'fillText').map(call => String(call.args[0]));
  for (const label of ['开始送信', '选关', '邮票', '设置']) assert.ok(texts.includes(label));
  assert.equal(texts.some(text => /每日|成长|LV\.|已走 0 拍|本周|下一小步/.test(text)), false);
  assert.equal(h.game.renderer.hits.length, 4, 'duplicate home actions and tabs are removed');
  h.destroy();
});

test('choosing each introductory route starts it directly without a launch or tutorial dialog', () => {
  const h = harness();
  for (const level of CAMPAIGN.slice(0, 3)) {
    h.game.openPage('levels');
    h.game.levelInfo(level, 'campaign');
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

test('a real wind lamp grants three energy and one board effect without a duplicate toast', () => {
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
    assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '+3 拍'));
    break;
  }
  assert.equal(collected, true, 'the recorded route must actually collect a wind lamp');
  h.destroy();
});

function replayed(level, actions) {
  const { replay } = require('../src/engine');
  return replay(level, actions, null);
}
