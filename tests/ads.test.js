'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAds } = require('../src/ads');

const config = { REWARDED_AD_UNIT_ID: 'adunit-0123abcd' };
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
function setup(overrides) {
  const close = new Set(), error = new Set();
  const calls = { show: 0, load: 0, destroy: 0, created: [] };
  const video = {
    onClose: fn => close.add(fn), offClose: fn => close.delete(fn),
    onError: fn => error.add(fn), offError: fn => error.delete(fn),
    show: () => { calls.show += 1; return Promise.resolve(); },
    load: () => { calls.load += 1; return Promise.resolve(); },
    destroy: () => { calls.destroy += 1; },
    ...overrides,
  };
  const platform = { kind: 'wechat', wx: { createRewardedVideoAd: options => { calls.created.push(options); return video; } } };
  return { platform, video, close, error, calls, ads: createAds(platform, config) };
}

test('browser preview and missing ad configuration can never grant a real reward', async () => {
  const preview = createAds({ kind: 'browser' }, config);
  assert.equal(preview.isConfigured(), false);
  assert.deepEqual(await preview.showRevive(), { rewarded: false, reason: 'preview' });
  assert.deepEqual(await createAds({ kind: 'wechat', wx: {} }, {}).showRevive(), { rewarded: false, reason: 'unconfigured' });
  assert.equal((await createAds({ kind: 'wechat', wx: {} }, config).showRevive()).reason, 'unsupported');
});

test('only strict isEnded true rewards; listeners detach after each attempt', async () => {
  for (const value of [undefined, {}, { isEnded: false }, { isEnded: 1 }, { isEnded: true }]) {
    const { ads, close, error, calls } = setup();
    assert.equal(ads.isConfigured(), true);
    const pending = ads.showRevive();
    await flush();
    const handler = Array.from(close)[0];
    handler(value);
    handler({ isEnded: true });
    assert.deepEqual(await pending, { rewarded: value && value.isEnded === true || false, reason: value && value.isEnded === true ? 'completed' : 'cancelled' });
    assert.equal(close.size, 0);
    assert.equal(error.size, 0);
    assert.deepEqual(calls.created, [config && { adUnitId: config.REWARDED_AD_UNIT_ID }]);
    ads.destroy();
  }
});

test('concurrent clicks do not show multiple videos and stale callbacks do not settle the next attempt', async () => {
  const { ads, close, calls } = setup();
  const first = ads.showRevive();
  const oldClose = Array.from(close)[0];
  assert.deepEqual(await ads.showRevive(), { rewarded: false, reason: 'busy' });
  await flush();
  assert.equal(calls.show, 1);
  oldClose({ isEnded: true });
  assert.equal((await first).rewarded, true);
  const second = ads.showRevive();
  let settled = false; second.then(() => { settled = true; });
  oldClose({ isEnded: true });
  await flush();
  assert.equal(settled, false);
  Array.from(close)[0]({ isEnded: false });
  assert.equal((await second).rewarded, false);
  ads.destroy();
});

test('an initial show rejection reloads and retries exactly once', async () => {
  const fixture = setup();
  fixture.video.show = () => { fixture.calls.show += 1; return fixture.calls.show === 1 ? Promise.reject(new Error('not loaded')) : Promise.resolve(); };
  const pending = fixture.ads.showRevive();
  await flush();
  assert.equal(fixture.calls.show, 2);
  assert.equal(fixture.calls.load, 1);
  Array.from(fixture.close)[0]({ isEnded: true });
  assert.equal((await pending).rewarded, true);
  fixture.ads.destroy();
});

test('SDK onError plus the same rejected show starts only one retry', async () => {
  const fixture = setup();
  fixture.video.show = () => {
    fixture.calls.show += 1;
    if (fixture.calls.show === 1) {
      Array.from(fixture.error)[0]({ errCode: 1004 });
      return Promise.reject(new Error('empty inventory'));
    }
    return Promise.resolve();
  };
  const pending = fixture.ads.showRevive();
  await flush();
  assert.equal(fixture.calls.load, 1);
  assert.equal(fixture.calls.show, 2);
  Array.from(fixture.close)[0]({ isEnded: false });
  assert.equal((await pending).rewarded, false);
  fixture.ads.destroy();
});

test('load failure, repeated show failure and playback errors grant no reward', async () => {
  const loading = setup({ show: () => Promise.reject(new Error('show')), load: () => Promise.reject(new Error('load')) });
  assert.deepEqual(await loading.ads.showRevive(), { rewarded: false, reason: 'load-failed' });
  loading.ads.destroy();
  const showing = setup({ show: () => Promise.reject(new Error('show')) });
  assert.deepEqual(await showing.ads.showRevive(), { rewarded: false, reason: 'show-failed' });
  showing.ads.destroy();
  const playing = setup();
  const pending = playing.ads.showRevive();
  await flush();
  Array.from(playing.error)[0]({ errCode: 1003 });
  assert.deepEqual(await pending, { rewarded: false, reason: 'error' });
  playing.ads.destroy();
});

test('destroy settles pending requests and suppresses late completion', async () => {
  const { ads, close, calls } = setup();
  const pending = ads.showRevive();
  const handler = Array.from(close)[0];
  ads.destroy();
  ads.destroy();
  handler({ isEnded: true });
  assert.deepEqual(await pending, { rewarded: false, reason: 'destroyed' });
  assert.equal(calls.destroy, 1);
  assert.equal(ads.isConfigured(), false);
  assert.deepEqual(await ads.showRevive(), { rewarded: false, reason: 'destroyed' });
});

test('loading watchdog unlocks a hung SDK and late events cannot issue rewards', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ads, close } = setup({ show: () => new Promise(() => {}) });
  const pending = ads.showRevive();
  const handler = Array.from(close)[0];
  await flush();
  t.mock.timers.tick(30001);
  assert.deepEqual(await pending, { rewarded: false, reason: 'timeout' });
  handler({ isEnded: true });
  ads.destroy();
});

test('a normally playing video is not cancelled by the short loading timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ads, close } = setup();
  const pending = ads.showRevive();
  let settled = false; pending.then(() => { settled = true; });
  await flush();
  t.mock.timers.tick(180000);
  await flush();
  assert.equal(settled, false);
  Array.from(close)[0]({ isEnded: true });
  assert.equal((await pending).rewarded, true);
  ads.destroy();
});

test('invalid ad instances and construction failures settle without reward', async () => {
  for (const invalid of [null, {}, { show() {}, onClose() {} }, { show() {}, onError() {} }]) {
    const ads = createAds({ kind: 'wechat', wx: { createRewardedVideoAd: () => invalid } }, config);
    assert.deepEqual(await ads.showRevive(), { rewarded: false, reason: 'unsupported' });
    ads.destroy();
  }
  const ads = createAds({ kind: 'wechat', wx: { createRewardedVideoAd() { throw new Error('SDK not ready'); } } }, config);
  assert.deepEqual(await ads.showRevive(), { rewarded: false, reason: 'error' });
  ads.destroy();
});

test('synchronous show/load failures do not escape as unhandled rejections', async () => {
  const loading = setup({ show() { throw new Error('show'); }, load() { throw new Error('load'); } });
  assert.deepEqual(await loading.ads.showRevive(), { rewarded: false, reason: 'load-failed' });
  loading.ads.destroy();
  const showing = setup({ show() { throw new Error('show'); } });
  assert.deepEqual(await showing.ads.showRevive(), { rewarded: false, reason: 'show-failed' });
  showing.ads.destroy();
});

test('an immediate SDK error during listener registration starts one load and one show', async () => {
  const fixture = setup();
  fixture.video.onError = fn => { fixture.error.add(fn); fn({ errCode: 1004 }); };
  const pending = fixture.ads.showRevive();
  await flush();
  assert.equal(fixture.calls.load, 1);
  assert.equal(fixture.calls.show, 1);
  Array.from(fixture.close)[0]({ isEnded: false });
  assert.equal((await pending).rewarded, false);
  fixture.ads.destroy();
});

test('close callbacks before show starts or while loading never issue a reward', async () => {
  const fixture = setup({ show: () => Promise.reject(new Error('not ready')), load: () => new Promise(() => {}) });
  const pending = fixture.ads.showRevive();
  const close = Array.from(fixture.close)[0];
  close({ isEnded: true });
  await flush();
  close({ isEnded: true });
  let settled = false; pending.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false);
  fixture.ads.destroy();
  assert.deepEqual(await pending, { rewarded: false, reason: 'destroyed' });
});

test('listener registration failures clean up any already-registered callbacks', async () => {
  const fixture = setup({ onError() { throw new Error('SDK listener failure'); } });
  assert.deepEqual(await fixture.ads.showRevive(), { rewarded: false, reason: 'error' });
  assert.equal(fixture.close.size, 0);
  assert.equal(fixture.calls.show, 0);
  fixture.ads.destroy();
});
