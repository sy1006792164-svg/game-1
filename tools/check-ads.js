'use strict';

const assert = require('node:assert/strict');
const { createAds } = require('../src/ads');
const { requestRevive } = require('../src/revive-flow');
const { requestItemReward } = require('../src/item-reward-flow');
const { CAMPAIGN } = require('../src/levels');
const { createState } = require('../src/engine');

function sdk() {
  const instances = [];
  return {
    instances,
    wx: { createRewardedVideoAd() {
      const ad = {
        loads: [], errors: [], closes: [], showCount: 0, rejectShow: false, destroyed: false,
        onLoad(listener) { this.loads.push(listener); },
        offLoad(listener) { this.loads = this.loads.filter(value => value !== listener); },
        onError(listener) { this.errors.push(listener); },
        offError(listener) { this.errors = this.errors.filter(value => value !== listener); },
        onClose(listener) { this.closes.push(listener); },
        offClose(listener) { this.closes = this.closes.filter(value => value !== listener); },
        load() { return Promise.resolve(); },
        show() { this.showCount++; return this.rejectShow ? Promise.reject(new Error('no fill')) : Promise.resolve(); },
        destroy() { this.destroyed = true; },
        emitLoad() { for (const listener of [...this.loads]) listener(); },
        emitError() { for (const listener of [...this.errors]) listener({ errMsg: 'no fill' }); },
        emitClose(isEnded) { for (const listener of [...this.closes]) listener({ isEnded }); }
      };
      instances.push(ad);
      return ad;
    } }
  };
}

function adsFor(fake, season = 2) {
  return createAds({ kind: 'wechat', wx: fake.wx },
    { REWARDED_AD_UNIT_ID: 'adunit-acceptance', PROGRESSION_SEASON: season });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function readinessAndPlayback() {
  const fake = sdk(), ads = adsFor(fake);
  const changes = [];
  ads.onReadyChange(value => changes.push(value));
  assert.equal(ads.canOffer(), false);
  const loading = ads.preload();
  const first = fake.instances[0];
  assert.deepEqual(await ads.showRewarded(), { rewarded: false, reason: 'not-ready' });
  await Promise.resolve(); // A resolved load() promise alone is not readiness.
  assert.equal(first.showCount, 0);
  assert.equal(ads.canOffer(), false);
  first.emitLoad();
  assert.equal(await loading, true);
  assert.equal(ads.canOffer(), true);

  const completed = ads.showRewarded();
  assert.equal(ads.canOffer(), false);
  await Promise.resolve();
  assert.equal(first.showCount, 1);
  const staleClose = first.closes[0];
  first.emitClose(true);
  first.emitClose(true);
  assert.deepEqual(await completed, { rewarded: true, reason: 'completed' });
  assert.equal(first.destroyed, true);
  staleClose({ isEnded: true });
  await Promise.resolve();
  const second = fake.instances.at(-1);
  assert.notEqual(second, first);
  assert.equal(ads.canOffer(), false);
  second.emitLoad();
  assert.equal(ads.canOffer(), true);
  const cancelled = ads.showRevive();
  await Promise.resolve();
  staleClose({ isEnded: true });
  await Promise.resolve();
  assert.equal(ads.isActive(), true);
  second.emitClose(false);
  assert.deepEqual(await cancelled, { rewarded: false, reason: 'cancelled' });
  assert.deepEqual(changes.slice(0, 4), [true, false, true, false]);
  ads.destroy();
}

async function errorsAndBackground() {
  const fake = sdk(), ads = adsFor(fake);
  const firstLoad = ads.preload(), first = fake.instances[0];
  first.emitError();
  assert.equal(await firstLoad, false);
  assert.equal(first.destroyed, true);
  assert.equal(ads.canOffer(), false);
  const secondLoad = ads.preload(), second = fake.instances[1];
  second.emitLoad();
  assert.equal(await secondLoad, true);
  ads.suspend();
  assert.equal(second.destroyed, true);
  assert.equal(ads.canOffer(), false);
  const thirdLoad = ads.preload(), third = fake.instances[2];
  third.emitLoad();
  assert.equal(await thirdLoad, true);
  third.rejectShow = true;
  const failed = await ads.showRewarded();
  assert.equal(failed.rewarded, false);
  assert.equal(failed.reason, 'show-failed');
  assert.equal(third.destroyed, true);
  assert.equal(ads.canOffer(), false);
  await Promise.resolve();
  const fourth = fake.instances[3];
  fourth.emitLoad();
  const playing = ads.showRewarded();
  await Promise.resolve();
  ads.suspend();
  fourth.emitClose(true);
  assert.equal((await playing).rewarded, true);
  await Promise.resolve();
  assert.equal(fake.instances.length, 4); // No background preload after completion.
  const fifthLoad = ads.preload(), fifth = fake.instances[4];
  fifth.emitLoad();
  await fifthLoad;
  const errored = ads.showRewarded();
  await Promise.resolve();
  fifth.emitError();
  assert.equal((await errored).rewarded, false);
  assert.equal(fifth.destroyed, true);
  ads.destroy();
}

async function legacyOffer() {
  const fake = sdk(), ads = adsFor(fake, 1);
  assert.equal(ads.canOffer(), true); // Baseline release keeps its old entry behavior.
  const playing = ads.showRewarded();
  await Promise.resolve();
  fake.instances[0].emitClose(true);
  assert.equal((await playing).rewarded, true);
  ads.destroy();
}

function flowGame(level, state, reward) {
  const events = [];
  let writes = 0;
  const game = {
    page: 'game', hidden: false, busy: false, reviewing: false, modal: null,
    session: 1, level, state, mode: 'campaign', transitionAt: 0,
    actions: [], reviveHistory: [], itemRewards: { oil: 0, kite: 0, bridge: 0, echo: 0 },
    renderer: { hits: [] }, platform: { kind: 'wechat', now: () => 1000 },
    ads: { isConfigured: () => true, canOffer: () => true, isActive: () => false,
      showRevive: () => reward.promise, showRewarded: () => reward.promise },
    sound: { suspend() {}, resume() {} }, syncMusic() {}, toast() {}, cancelItem() {},
    guideStep: () => null, undoLeft: () => 0, pause() {},
    reportEvent(id, data) { events.push({ id, data }); },
    persist() { writes++; }
  };
  return { game, events, writes: () => writes };
}

async function abandonedRouteCannotEarn() {
  const revive = deferred();
  const level = CAMPAIGN[0], state = { ...createState(level), status: 'failed' };
  const failed = flowGame(level, state, revive);
  const pendingRevive = requestRevive(failed.game);
  failed.game.session++;
  revive.resolve({ rewarded: true, reason: 'completed' });
  await pendingRevive;
  assert.equal(failed.game.state, state);
  assert.equal(failed.writes(), 0);
  assert.equal(failed.events.filter(event => event.id === 'ad_complete').length, 1);

  const itemReward = deferred();
  const itemLevel = CAMPAIGN[3], itemState = createState(itemLevel);
  const item = flowGame(itemLevel, itemState, itemReward);
  const pendingItem = requestItemReward(item.game, 'oil', itemState.player);
  item.game.session++;
  itemReward.resolve({ rewarded: true, reason: 'completed' });
  await pendingItem;
  assert.equal(item.game.itemRewards.oil, 0);
  assert.equal(item.writes(), 0);

  const cancelled = deferred();
  const retry = flowGame(level, { ...createState(level), status: 'failed' }, cancelled);
  const pendingCancel = requestRevive(retry.game);
  cancelled.resolve({ rewarded: false, reason: 'cancelled' });
  await pendingCancel;
  assert.equal(retry.game.state.status, 'failed');
  assert.equal(retry.writes(), 0);
  assert.equal(retry.game.modal.kind, 'fail');
  assert.ok(retry.game.modal.buttons.some(button => button.text.includes('免费再试')));
  assert.equal(retry.events.filter(event => event.id === 'ad_cancel').length, 1);
}

(async function () {
  await readinessAndPlayback();
  await errorsAndBackground();
  await legacyOffer();
  await abandonedRouteCannotEarn();
  console.log('广告就绪、失败、奖励隔离和免费重试检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
