'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { homeGoal, nextDeliveryGoal } = require('../src/player-goals');
const { homeLayout } = require('../src/home-view');
const { helpContent } = require('../src/help-view');
const { CAMPAIGN } = require('../src/levels');
const { createStore, PROFILE_KEY } = require('../src/storage');
const { createHarness } = require('./helpers/game-harness');

test('home goals follow a saved earlier chapter without losing the main campaign frontier', () => {
  const { game } = createHarness();
  let goal = homeGoal(game);
  assert.equal(goal.level.id, 1); assert.equal(goal.title, '开始送信');
  for (const level of CAMPAIGN.slice(0, 14)) game.store.recordWin(level.id, 3, level.par);
  goal = homeGoal(game);
  assert.equal(goal.level.id, 15); assert.equal(goal.chapter.completedCount, 2);
  assert.equal(goal.chapter.count, 6); assert.equal(homeGoal(game), goal, 'unchanged frames reuse their goal');
  game.start(CAMPAIGN[3]); game.guideEnabled = false; game.mechanicGuide = null;
  game.act(CAMPAIGN[3].solution[0]); game.home();
  goal = homeGoal(game);
  assert.equal(goal.active, true); assert.equal(goal.level.id, 4); assert.equal(goal.recordedTurns, 1);
  assert.equal(goal.chapter.index, 0); assert.equal(game.nextLevel().id, 15);
  assert.match(goal.chapterDetail, /本章已送达/);
});

test('the shortened final chapter and full completion never invent new locked routes or stamp goals', () => {
  const { game } = createHarness();
  for (const level of CAMPAIGN) game.store.recordWin(level.id, 3, level.par);
  const goal = homeGoal(game);
  assert.equal(goal.finished, true); assert.equal(goal.title, '重温邮路');
  assert.equal(goal.chapter.count, 3); assert.equal(goal.chapter.completedCount, 3);
  assert.equal(goal.album.next, null); assert.equal(goal.level.id, 999);
  assert.match(goal.stampDetail, /已集齐/);
});

test('personal retry goals reflect actual turn budget and assisted score restrictions', () => {
  const level = CAMPAIGN[14], album = { next: { remaining: 4, name: '随风远行' } };
  assert.match(nextDeliveryGoal(level, { turn: level.par + 3 }, 1, album), /少走 3 拍/);
  assert.match(nextDeliveryGoal(level, { turn: level.par, itemsUsed: 1 }, 2, album), /不用道具或续灯/);
  assert.match(nextDeliveryGoal(level, { turn: level.par, revived: true }, 2, album), /不用道具或续灯/);
  assert.match(nextDeliveryGoal(level, { turn: level.par }, 3, album), /再收 4 星/);
  assert.match(nextDeliveryGoal(level, { turn: level.par }, 3, { next: null }), /全部旅程邮票已收藏/);
});

test('home artwork, chapter card, route copy and touch controls never collide on supported small screens', () => {
  for (const scale of [1, 320 / 390, .7]) {
    for (const height of [700, 760, 900]) {
      const ui = homeLayout(height, scale);
      assert.ok(ui.heroY >= ui.top + 140);
      assert.ok(ui.heroY + ui.heroH <= ui.goalY - 8);
      assert.ok(ui.goalY + 68 < ui.routeY);
      assert.ok(ui.routeY + 61 < ui.buttonY);
      assert.ok(ui.buttonY + ui.primaryHeight < ui.linksY);
      assert.ok(ui.linksY + ui.linksHeight < ui.journeyY);
      assert.ok(ui.primaryHeight * scale >= 44 && ui.compactHeight * scale >= 44);
      assert.ok(ui.journeyY + ui.compactHeight <= height - 24);
    }
  }
});

test('lightweight graphics preference migrates safely and respects device automatic limits', () => {
  const { game, draw } = createHarness();
  game.platform.effectsQuality = 'high'; game.platform.reducedMotion = false;
  assert.equal(game.profile().settings.lowEffects, false); assert.equal(game.effectsQuality(), 'high');
  game.openPage('settings');
  assert.equal(game.toggle('lowEffects'), true); draw();
  assert.equal(game.renderer.effectsQuality, 'low');
  assert.equal(createStore(game.platform.storage).getProfile().settings.lowEffects, true);
  assert.equal(game.toggle('lowEffects'), false); draw();
  assert.equal(game.renderer.effectsQuality, 'high');
  game.platform.effectsQuality = 'low'; draw(); assert.equal(game.renderer.effectsQuality, 'low');
  game.platform.storage.set(PROFILE_KEY, { version: 1, completed: { 1: { stars: 3, bestTurns: 4 } }, settings: { sound: false } });
  const migrated = createStore(game.platform.storage).getProfile();
  assert.equal(migrated.settings.lowEffects, false); assert.equal(migrated.settings.sound, false);
  assert.equal(migrated.completed['1'].stars, 3);
});

test('settings survive failed reads and later recovery without overwriting untouched old choices', () => {
  let fail = true;
  const data = new Map([[PROFILE_KEY, { version: 1, completed: { 1: { stars: 3, bestTurns: 4 } },
    settings: { sound: false, music: false, lowEffects: false } }]]);
  const adapter = { get: key => { if (fail && key === PROFILE_KEY) throw new Error('temporarily unavailable'); return data.get(key); },
    set: (key, value) => data.set(key, value), remove: key => data.delete(key) };
  const store = createStore(adapter);
  store.updateSettings({ lowEffects: true }); fail = false; assert.equal(store.flush(), true);
  const profile = store.getProfile();
  assert.equal(profile.settings.lowEffects, true); assert.equal(profile.settings.sound, false);
  assert.equal(profile.settings.music, false); assert.equal(profile.completed['1'].stars, 3);
});

test('settings help is available before starting and includes review and keyboard controls', () => {
  const sections = helpContent(null, 0, 'browser').sections;
  assert.ok(sections.some(section => section.title === '回看自己的路线'));
  assert.ok(sections.some(section => section.title === '电脑操作' && section.text.includes('PageUp/PageDown')));
  const { game, draw } = createHarness();
  game.openPage('settings'); draw();
  const help = game.renderer.hits.find(hit => hit.label && hit.label.includes('玩法与操作速查'));
  assert.ok(help); help.action(); draw();
  assert.equal(game.modal.kind, 'help');
  game.modal.buttons[0].action(); assert.equal(game.modal, null); assert.equal(game.page, 'settings');
});
