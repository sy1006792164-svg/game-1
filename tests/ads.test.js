'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAds } = require('../src/ads');

const config = { REWARDED_AD_UNIT_ID: 'adunit-0123abcd' };
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
function setup(overrides, onActiveChange) {
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
  return { platform, video, close, error, calls, ads: createAds(platform, config, onActiveChange) };
}

test('browser preview and missing ad configuration can never grant a real reward', async () => {
  const preview = createAds({ kind: 'browser' }, config);
  assert.equal(preview.isConfigured(), false);
  assert.deepEqual(await preview.showRevive(), { rewarded: false, reason: 'preview' });
  assert.deepEqual(await createAds({ kind: 'wechat', wx: {} }, {}).showRevive(), { rewarded: false, reason: 'unconfigured' });
  assert.equal((await createAds({ kind: 'wechat', wx: {} }, config).showRevive()).reason, 'unsupported');
});

test('the ad initializes before user input without displaying or muting and is reused', async () => {
  const active = [];
  const fixture = setup({}, value => active.push(value));
  assert.deepEqual(fixture.calls.created, [{ adUnitId: config.REWARDED_AD_UNIT_ID }]);
  assert.equal(fixture.calls.show, 0);
  assert.equal(fixture.error.size, 1, 'automatic preloading has an error listener immediately');
  assert.equal(fixture.ads.isActive(), false);
  assert.deepEqual(active, []);
  for (const isEnded of [false, true]) {
    const pending = fixture.ads.showRevive();
    await flush();
    assert.equal(fixture.ads.isActive(), true);
    Array.from(fixture.close)[0]({ isEnded });
    assert.equal((await pending).rewarded, isEnded);
    assert.equal(fixture.ads.isActive(), false);
  }
  assert.equal(fixture.calls.created.length, 1);
  assert.equal(fixture.calls.show, 2);
  assert.deepEqual(active, [true, false, true, false]);
  fixture.ads.destroy();
  assert.equal(fixture.calls.destroy, 1);
  assert.equal(fixture.error.size, 0);
});

test('idle and post-close preload errors stay handled without showing ads or spending rewards', async () => {
  const active = [];
  const fixture = setup({}, value => active.push(value));
  const listener = Array.from(fixture.error)[0];
  listener({ errCode: 1004 });
  await flush();
  assert.equal(fixture.calls.show, 0);
  assert.equal(fixture.calls.load, 0);
  assert.deepEqual(active, []);
  for (const isEnded of [false, true]) {
    const pending = fixture.ads.showRevive();
    await flush();
    Array.from(fixture.close)[0]({ isEnded });
    assert.equal((await pending).rewarded, isEnded);
    assert.deepEqual(Array.from(fixture.error), [listener], 'one listener survives each close');
    listener({ errCode: 1004 });
    await flush();
    assert.equal(fixture.ads.isActive(), false);
  }
  assert.equal(fixture.calls.show, 2);
  assert.equal(fixture.calls.load, 0);
  fixture.ads.destroy();
  assert.equal(fixture.error.size, 0);
  listener({ errCode: 1004 });
  assert.equal(fixture.calls.show, 2);
});

test('an error emitted while the startup listener is registering never starts an ad', async () => {
  let listener;
  const fixture = setup({ onError(fn) { listener = fn; fn({ errCode: 1004 }); } });
  await flush();
  assert.equal(fixture.calls.show, 0);
  assert.equal(fixture.calls.load, 0);
  assert.equal(fixture.ads.isActive(), false);
  const pending = fixture.ads.showRevive();
  await flush();
  listener({ errCode: 1003 });
  assert.deepEqual(await pending, { rewarded: false, reason: 'error' });
  fixture.ads.destroy();
});

test('startup initialization failure can recover on the next user request', async () => {
  let attempts = 0, close;
  const video = { show: () => Promise.resolve(), onClose: fn => { close = fn; }, offClose() {}, onError() {}, offError() {} };
  const ads = createAds({ kind: 'wechat', wx: { createRewardedVideoAd() {
    attempts += 1;
    if (attempts === 1) throw new Error('SDK not ready');
    return video;
  } } }, config);
  assert.equal(attempts, 1);
  const pending = ads.showRevive();
  await flush();
  assert.equal(attempts, 2);
  close({ isEnded: true });
  assert.equal((await pending).rewarded, true);
  ads.destroy();
});

test('only strict isEnded true rewards; close listeners detach and the error listener persists', async () => {
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
    assert.equal(error.size, 1);
    assert.deepEqual(calls.created, [config && { adUnitId: config.REWARDED_AD_UNIT_ID }]);
    ads.destroy();
    assert.equal(error.size, 0);
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

test('loading watchdog denies rewards but retains the audio lock until a late close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ads, close, video } = setup({ show: () => new Promise(() => {}) });
  let cleanupCalls = 0;
  video.offClose = fn => { cleanupCalls++; close.delete(fn); };
  const pending = ads.showRevive();
  const handler = Array.from(close)[0];
  await flush();
  t.mock.timers.tick(30001);
  assert.deepEqual(await pending, { rewarded: false, reason: 'timeout' });
  assert.equal(ads.isActive(), true);
  assert.equal(cleanupCalls, 0);
  handler({ isEnded: true });
  handler({ isEnded: true });
  assert.equal(ads.isActive(), false);
  assert.equal(cleanupCalls, 1);
  ads.destroy();
});

for (const trigger of ['offClose', 'onActiveChange']) {
  test('closing keeps its result when ' + trigger + ' synchronously emits another ad error', async () => {
    for (const isEnded of [true, false]) {
      const active = [];
      const fixture = setup({}, value => {
        active.push(value);
        if (!value && trigger === 'onActiveChange') Array.from(fixture.error)[0]({ errCode: -1 });
      });
      let cleanupCalls = 0;
      fixture.video.offClose = fn => {
        cleanupCalls++;
        fixture.close.delete(fn);
        if (trigger === 'offClose') Array.from(fixture.error)[0]({ errCode: -1 });
      };
      const pending = fixture.ads.showRevive();
      const close = Array.from(fixture.close)[0];
      await flush();
      close({ isEnded });
      close({ isEnded: true });
      Array.from(fixture.error)[0]({ errCode: -1 });
      assert.deepEqual(await pending, { rewarded: isEnded, reason: isEnded ? 'completed' : 'cancelled' });
      assert.equal(cleanupCalls, 1, 'native cleanup never reenters or repeats for stale callbacks');
      assert.deepEqual(active, [true, false]);
      assert.equal(fixture.ads.isActive(), false);
      fixture.ads.destroy();
      assert.equal(cleanupCalls, 1);
    }
  });
}

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

test('an SDK error while a user attempt registers its close listener starts one retry', async () => {
  const fixture = setup();
  fixture.video.onClose = fn => { fixture.close.add(fn); Array.from(fixture.error)[0]({ errCode: 1004 }); };
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

test('a failed close-listener registration preserves the idle error listener and allows retry', async () => {
  const fixture = setup();
  const onClose = fixture.video.onClose;
  fixture.video.onClose = fn => { onClose(fn); throw new Error('close listener failure'); };
  assert.deepEqual(await fixture.ads.showRevive(), { rewarded: false, reason: 'error' });
  assert.equal(fixture.close.size, 0);
  assert.equal(fixture.error.size, 1);
  assert.equal(fixture.calls.show, 0);
  fixture.video.onClose = onClose;
  const pending = fixture.ads.showRevive();
  await flush();
  Array.from(fixture.close)[0]({ isEnded: true });
  assert.equal((await pending).rewarded, true);
  fixture.ads.destroy();
});

test('a failed error-listener registration cleans up and retries without reviving stale handlers', async () => {
  const registered = new Set();
  let fails = true, stale;
  const fixture = setup({
    onError(fn) { registered.add(fn); if (fails) { stale = fn; throw new Error('registration failed'); } },
    offError(fn) { registered.delete(fn); }
  });
  assert.equal(registered.size, 0);
  assert.equal(fixture.calls.show, 0);
  fails = false;
  const pending = fixture.ads.showRevive();
  let settled = false; pending.then(() => { settled = true; });
  await flush();
  assert.equal(registered.size, 1);
  stale({ errCode: 1003 });
  await flush();
  assert.equal(settled, false);
  assert.equal(fixture.ads.isActive(), true);
  Array.from(fixture.close)[0]({ isEnded: true });
  assert.equal((await pending).rewarded, true);
  fixture.ads.destroy();
  assert.equal(registered.size, 0);
});

test('the persistent error listener releases a timed-out native video without granting a late reward', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = setup();
  const pending = fixture.ads.showRevive();
  const close = Array.from(fixture.close)[0];
  await flush();
  t.mock.timers.tick(15 * 60 * 1000 + 1);
  assert.deepEqual(await pending, { rewarded: false, reason: 'timeout' });
  assert.equal(fixture.ads.isActive(), true);
  Array.from(fixture.error)[0]({ errCode: 1003 });
  assert.equal(fixture.ads.isActive(), false);
  assert.equal(fixture.close.size, 0);
  assert.equal(fixture.error.size, 1);
  const next = fixture.ads.showRevive();
  await flush();
  close({ isEnded: true });
  assert.equal(fixture.ads.isActive(), true);
  Array.from(fixture.close)[0]({ isEnded: false });
  assert.deepEqual(await next, { rewarded: false, reason: 'cancelled' });
  fixture.ads.destroy();
});
