'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAds } = require('../src/ads');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(options = {}) {
  const instances = [], active = [], wx = { createRewardedVideoAd(config) {
    const ad = { config, closes: [], errors: [], shows: 0, loads: 0, destroyed: false,
      onClose(fn) { this.closes.push(fn); }, offClose(fn) { this.closes = this.closes.filter(value => value !== fn); },
      onError(fn) { this.errors.push(fn); }, offError(fn) { this.errors = this.errors.filter(value => value !== fn); },
      load() { this.loads++; return options.rejectLoad ? Promise.reject(new Error('load failed')) : Promise.resolve(); },
      show() { this.shows++; return options.rejectShow ? Promise.reject(new Error('show failed')) : Promise.resolve(); },
      destroy() { this.destroyed = true; },
      close(event) { this.closes.slice().forEach(fn => fn(event)); },
      error(event) { this.errors.slice().forEach(fn => fn(event)); }
    };
    instances.push(ad); return ad;
  } };
  const ads = createAds({ kind: 'wechat', wx }, { REWARDED_AD_UNIT_ID: 'adunit-testfixture' }, value => active.push(value));
  return { ads, instances, active };
}

test('preloading never shows a video; only explicit completed close grants a reward once', async () => {
  const { ads, instances, active } = harness();
  assert.equal(await ads.preload(), true);
  const first = instances[0]; assert.equal(first.shows, 0); assert.equal(first.config.multiton, true);
  const result = ads.showRewarded(); await flush();
  assert.equal(first.shows, 1); assert.equal(ads.isActive(), true);
  assert.deepEqual(await ads.showRewarded(), { rewarded: false, reason: 'busy' });
  const stale = first.closes[0]; first.close({ isEnded: true }); first.close({ isEnded: true });
  assert.deepEqual(await result, { rewarded: true, reason: 'completed' }); await flush();
  assert.equal(first.destroyed, true); assert.equal(ads.isActive(), false);
  const next = ads.showRewarded(); await flush(); stale({ isEnded: true }); await flush();
  assert.equal(ads.isActive(), true, 'a previous emitter cannot settle the new attempt');
  instances.at(-1).close({ isEnded: false });
  assert.deepEqual(await next, { rewarded: false, reason: 'cancelled' });
  assert.deepEqual(active, [true, false, true, false]); ads.destroy();
});

test('malformed and cancelled native closes fail closed', async () => {
  for (const close of [undefined, {}, { isEnded: false }, { isEnded: 'true' }]) {
    const { ads, instances } = harness(); const result = ads.showRewarded(); await flush();
    instances[0].close(close); assert.equal((await result).rewarded, false); ads.destroy();
  }
});

test('show retries are isolated and a repeated SDK failure releases the input/audio lock', async () => {
  const { ads, instances } = harness({ rejectShow: true });
  assert.deepEqual(await ads.showRewarded(), { rewarded: false, reason: 'show-failed' });
  assert.equal(ads.isActive(), false); assert.ok(instances.length >= 2);
  assert.equal(instances[0].destroyed, true); assert.equal(instances[1].destroyed, true); ads.destroy();
});

test('backgrounding preserves a playing reward but never starts the next preload until resume', async () => {
  const { ads, instances } = harness(); const result = ads.showRevive(); await flush();
  ads.suspend(); assert.equal(instances[0].destroyed, false);
  instances[0].close({ isEnded: true }); assert.equal((await result).rewarded, true); await flush();
  assert.equal(instances.length, 1); assert.equal(ads.isActive(), false);
  assert.equal(await ads.preload(), true); assert.equal(instances.length, 2);
  ads.suspend(); assert.equal(instances[1].destroyed, true); ads.destroy();
});

test('SDK errors and destroy release active attempts without rewards or stranded input', async () => {
  for (const reason of ['sdk', 'destroy']) {
    const { ads, instances } = harness(); const result = ads.showRewarded(); await flush();
    if (reason === 'sdk') instances[0].error({ errMsg: 'operateWXDataForAd failed' });
    else ads.destroy();
    const outcome = await result;
    assert.equal(outcome.rewarded, false); assert.equal(ads.isActive(), false);
    assert.equal(instances[0].destroyed, true); ads.destroy();
  }
});
