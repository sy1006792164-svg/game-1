'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getWindowInfo, getDeviceInfo } = require('../src/wechat-viewport');

test('modern device and window APIs do not call legacy system info for absent optional fields', () => {
  let legacyCalls = 0;
  for (const platform of ['ios', 'android', 'ohos', 'ohos_pc', 'devtools']) {
    const api = {
      getDeviceInfo: () => ({ platform }),
      getWindowInfo: () => ({ windowWidth: 393, windowHeight: 852, pixelRatio: 3 }),
      getSystemInfoSync() { legacyCalls++; throw new Error('legacy API must not be needed'); },
    };
    assert.equal(getDeviceInfo(api).platform, platform);
    assert.deepEqual(getWindowInfo(api), { windowWidth: 393, windowHeight: 852, pixelRatio: 3 });
  }
  assert.equal(legacyCalls, 0);
});

test('partial window info recovers density without invoking unrelated legacy bridge getters', () => {
  let legacyCalls = 0, unrelatedReads = 0;
  const legacy = {
    pixelRatio: 3, screenTop: 20, statusBarHeight: 47,
    safeArea: { top: 47, bottom: 818 },
  };
  for (const key of ['windowWidth', 'windowHeight', 'deviceOrientation', 'cameraAuthorized']) {
    Object.defineProperty(legacy, key, { enumerable: true, get() {
      unrelatedReads++;
      throw new Error('unnecessary native bridge call: ' + key);
    } });
  }
  const info = getWindowInfo({
    getWindowInfo: () => ({ windowWidth: 393, windowHeight: 832, pixelRatio: 0 }),
    getSystemInfoSync() { legacyCalls++; return legacy; },
  });
  assert.deepEqual(info, {
    windowWidth: 393, windowHeight: 832, pixelRatio: 3,
    screenTop: 20, statusBarHeight: 47, safeArea: { top: 47, bottom: 818 },
  });
  assert.equal(legacyCalls, 1);
  assert.equal(unrelatedReads, 0);
});

test('older SDK window fallback survives unavailable optional geometry getters', () => {
  const legacy = { windowWidth: 375, windowHeight: 667, pixelRatio: 2 };
  Object.defineProperty(legacy, 'safeArea', { enumerable: true, get() { throw new Error('unsupported'); } });
  assert.deepEqual(getWindowInfo({ getSystemInfoSync: () => legacy }), {
    windowWidth: 375, windowHeight: 667, pixelRatio: 2,
  });
});
