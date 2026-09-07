'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN, getDaily } = require('../src/levels');
const { getChallenge } = require('../src/challenge');
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
    for (const page of ['home', 'levels', 'progress', 'collection', 'settings']) { h.game.openPage(page); h.draw(); }
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

function finishCampaign(h, count) {
  for (const level of CAMPAIGN.slice(0, count)) {
    h.start(level);
    level.solution.forEach(action => h.act(action));
    assert.equal(h.game.state.status, 'won');
  }
}

test('expert routes unlock after three deliveries and require that exact standard route to be completed', () => {
  const h = harness();
  h.game.selectMode('expert');
  assert.equal(h.game.levelMode, 'campaign');
  h.start(CAMPAIGN[0], 'expert');
  assert.equal(h.game.state, null, 'a fresh profile cannot enter expert through start');
  finishCampaign(h, 2);
  assert.equal(h.game.expertUnlocked(CAMPAIGN[0]), false);
  const before = clone(h.game.state);
  h.start(CAMPAIGN[0], 'expert');
  assert.deepEqual(h.game.state, before, 'two standard wins are not enough');
  h.start(CAMPAIGN[2]);
  CAMPAIGN[2].solution.forEach(action => h.act(action));
  h.game.selectMode('expert');
  assert.equal(h.game.levelMode, 'expert');
  assert.ok(CAMPAIGN.slice(0, 3).every(level => h.game.expertUnlocked(level)));
  assert.equal(h.game.unlocked(3), true, 'standard fourth route is now unlocked');
  assert.equal(h.game.expertUnlocked(CAMPAIGN[3]), false, 'its expert route still needs its own standard win');
  h.start(CAMPAIGN[3], 'expert');
  assert.equal(h.game.level.id, 3);
  h.game.modal = null;
  h.game.levelInfo(CAMPAIGN[3], 'expert');
  assert.equal(h.game.modal, null, 'locked expert route cannot open a launch dialog');
  h.game.levelInfo(CAMPAIGN[1], 'expert');
  h.game.modal.buttons[0].action();
  assert.equal(h.game.mode, 'expert');
  assert.deepEqual(h.game.level, getChallenge(CAMPAIGN[1]));
  assert.equal(h.game.state.energy, 7);
  h.destroy();
});

test('an expert relaunch rebuilds its exact smaller-budget state and wins only in the expert record table', () => {
  const h = harness();
  finishCampaign(h, 3);
  const completed = clone(h.game.profile().completed);
  h.start(CAMPAIGN[1], 'expert');
  CAMPAIGN[1].solution.slice(0, 3).forEach(action => h.act(action));
  const before = clone(h.game.state);
  h.callbacks.hide();
  const run = h.game.store.loadRun();
  assert.equal(run.mode, 'expert');
  assert.equal(run.revision, getChallenge(CAMPAIGN[1]).revision);
  const reloaded = harness({ data: h.data });
  assert.equal(reloaded.game.restore(), true);
  assert.equal(reloaded.game.mode, 'expert');
  assert.equal(reloaded.game.level.challenge, true);
  assert.deepEqual(reloaded.game.state, before);
  CAMPAIGN[1].solution.slice(3).forEach(action => reloaded.act(action));
  assert.equal(reloaded.game.state.status, 'won');
  assert.deepEqual(reloaded.game.profile().expert['2'], { stars: 3, bestTurns: CAMPAIGN[1].par });
  assert.deepEqual(reloaded.game.profile().completed, completed);
  assert.deepEqual(reloaded.game.profile().daily, {});
  assert.equal(reloaded.game.starCount(), 9, 'expert stars must not inflate the standard stamp collection');
  assert.equal(reloaded.game.progress().expertCompleted, 1);
  assert.equal(reloaded.game.store.loadRun(), null);
  h.destroy(); reloaded.destroy();
});

test('expert next-route buttons retain expert mode and stop at a standard route that has not been won', () => {
  const h = harness();
  finishCampaign(h, 3);
  const completed = clone(h.game.profile().completed);
  h.start(CAMPAIGN[0], 'expert');
  for (let index = 0; index < 3; index++) {
    assert.equal(h.game.mode, 'expert');
    assert.equal(h.game.level.id, index + 1);
    assert.equal(h.game.level.challenge, true);
    CAMPAIGN[index].solution.forEach(action => h.act(action));
    assert.equal(h.game.state.status, 'won');
    const next = h.game.modal.buttons[0];
    if (index < 2) assert.match(next.text, /下一条高手/);
    else assert.match(next.text, /返回邮局/);
    next.action();
  }
  assert.equal(h.game.page, 'home');
  assert.equal(h.game.level.id, 3, 'the unopened fourth expert route must not start');
  assert.equal(h.game.profile().expert['4'], undefined);
  assert.deepEqual(h.game.profile().completed, completed);
  assert.equal(h.game.progress().expertCompleted, 3);
  h.destroy();
});

test('expert failure offers free retry and cannot revive through either real or preview ad entry points', async () => {
  for (const kind of ['wechat', 'browser']) {
    const h = harness({ kind });
    finishCampaign(h, 3);
    h.start(CAMPAIGN[0], 'expert');
    for (let index = 0; index < h.game.level.budget; index++) h.act('wait');
    assert.equal(h.game.state.status, 'failed');
    const failed = clone(h.game.state);
    assert.equal(h.game.modal.buttons[0].primary, true);
    assert.match(h.game.modal.buttons[0].text, /免费再试/);
    assert.equal(h.game.modal.buttons.some(button => /看视频|续灯/.test(button.text)), false);
    await h.game.requestRevive();
    h.game.applyRevive();
    assert.deepEqual(h.game.state, failed);
    assert.equal(h.game.modal.kind, 'fail');
    assert.equal(h.showCount, 0);
    assert.equal(h.game.reviveAt, null);
    h.game.modal.buttons[0].action();
    assert.equal(h.game.mode, 'expert');
    assert.equal(h.game.state.turn, 0);
    assert.equal(h.game.state.energy, getChallenge(CAMPAIGN[0]).budget);
    assert.equal(h.game.state.revived, false);
    h.destroy();
  }
});

test('expert restore rejects revived or no-longer-unlocked saves without erasing earned scores', () => {
  const h = harness();
  finishCampaign(h, 3);
  const earned = clone(h.game.profile());
  for (const run of [
    { mode: 'expert', levelId: 1, revision: getChallenge(CAMPAIGN[0]).revision, actions: [], reviveAt: 0 },
    { mode: 'expert', levelId: 4, revision: getChallenge(CAMPAIGN[3]).revision, actions: [], reviveAt: null }
  ]) {
    h.data.set(RUN_KEY, { dateKey: '2026-09-07', ...run });
    const reloaded = harness({ data: h.data });
    assert.equal(reloaded.game.restore(), false);
    assert.equal(reloaded.game.store.loadRun(), null);
    assert.deepEqual(reloaded.game.profile(), earned);
    reloaded.destroy();
  }
  h.destroy();
});

test('a failed route can be reviewed without spending turns and free retry preserves the old personal best', () => {
  const h = harness();
  finishCampaign(h, 1);
  const earned = clone(h.game.profile());
  h.start();
  for (let index = 0; index < CAMPAIGN[0].budget; index++) h.act('wait');
  const failed = clone(h.game.state), saved = clone(h.game.store.loadRun());
  assert.equal(h.game.modal.buttons[0].primary, true);
  assert.match(h.game.modal.buttons[0].text, /免费再试/);
  assert.ok(h.game.modal.buttons.some(button => /看视频/.test(button.text)), 'standard routes still offer an optional revive');
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
  h.game.modal.buttons[0].action();
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

test('growth goals navigate to today, the relevant expert chapter and the next unfinished three-star route', () => {
  const h = harness();
  finishCampaign(h, 3);
  h.game.openPage('progress');
  assert.equal(h.game.page, 'progress');
  const expertGoal = h.game.progress().goals.find(goal => goal.action === 'expert');
  assert.ok(expertGoal);
  h.game.goal(expertGoal.action);
  assert.equal(h.game.page, 'levels');
  assert.equal(h.game.levelMode, 'expert');
  assert.equal(h.game.chapter, 0);
  const dailyGoal = h.game.progress().goals.find(goal => goal.action === 'daily');
  h.game.goal(dailyGoal.action);
  assert.match(h.game.modal.kicker, /2026 \/ 09 \/ 07/);
  h.game.modal.buttons[0].action();
  assert.equal(h.game.mode, 'daily');
  assert.equal(h.game.runDate, h.clock.date);

  // Stored progress sets up a later chapter without making this navigation
  // regression replay dozens of unrelated maps.
  for (const level of CAMPAIGN.slice(0, 7)) h.game.store.recordWin(level.id, level.id === 7 ? 2 : 3, level.par, 'campaign');
  for (const level of CAMPAIGN.slice(0, 6)) h.game.store.recordWin(level.id, 3, level.par, 'expert');
  h.game.goal('expert');
  assert.equal(h.game.levelMode, 'expert');
  assert.equal(h.game.chapter, 1);
  const refineGoal = h.game.progress().goals.find(goal => goal.action === 'stars');
  assert.ok(refineGoal);
  h.game.goal(refineGoal.action);
  assert.equal(h.game.page, 'levels');
  assert.equal(h.game.levelMode, 'campaign');
  assert.equal(h.game.chapter, 1);
  h.destroy();
});

test('the next-campaign growth goal cannot resume an unrelated daily or expert save', () => {
  for (const mode of ['daily', 'expert']) {
    const h = harness();
    finishCampaign(h, 3);
    h.start(mode === 'daily' ? getDaily(h.clock.date) : CAMPAIGN[0], mode);
    h.act(h.game.level.solution[0]);
    h.game.openPage('progress');
    const goal = h.game.progress().goals.find(item => item.action === 'campaign');
    assert.ok(goal);
    h.game.goal(goal.action);
    assert.equal(h.game.page, 'game');
    assert.equal(h.game.mode, 'campaign', `the campaign goal must not restore a ${mode} run`);
    assert.equal(h.game.level.id, 4);
    assert.equal(h.game.state.turn, 0);
    h.destroy();
  }
});

test('a daily launch dialog left open past midnight starts and scores the new calendar date', () => {
  const clock = { date: '2026-09-07' };
  const h = harness({ clock });
  h.game.daily();
  assert.match(h.game.modal.kicker, /2026 \/ 09 \/ 07/);
  clock.date = '2026-09-08';
  h.game.modal.buttons[0].action();
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

test('idle home and growth pages refresh their calendar goals and week after midnight', () => {
  for (const page of ['home', 'progress']) {
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
    if (page === 'home') assert.ok(h.calls.some(call => call.method === 'fillText' && call.args[0] === '新路线，等你来解'));
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
  assert.ok(reloaded.calls.some(call => call.method === 'fillText' && /已走 0 拍/.test(call.args[0])));
  reloaded.game.primary();
  assert.equal(reloaded.game.page, 'game');
  assert.equal(reloaded.game.mode, 'campaign');
  assert.equal(reloaded.game.level.id, 3);
  assert.equal(reloaded.game.state.turn, 0, 'unsupported old state is not replayed as authoritative progress');
  assert.deepEqual(reloaded.game.profile(), earned);
  assert.deepEqual(reloaded.game.store.loadRun().actions, []);
  h.destroy(); reloaded.destroy();
});
