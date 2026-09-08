'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDevelopmentEnvironment } = require('../src/runtime-environment');
const { developmentLevelNumber } = require('../src/developer-view');

const local = { protocol: 'http:', hostname: '127.0.0.1' };
const native = envVersion => ({ getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
  getDeviceInfo: () => ({ platform: 'devtools' }), enableDebug: true });

test('native development requires the exact develop channel, even inside devtools or localhost', () => {
  for (const version of ['develop', 'trial', 'release', 'production', 'development', '', null, undefined, true]) {
    assert.equal(isDevelopmentEnvironment(native(version), local), version === 'develop', String(version));
  }
  for (const api of [{}, { getAccountInfoSync: () => null }, { getAccountInfoSync: () => ({}) },
    { getAccountInfoSync() { throw new Error('SDK unavailable'); }, enableDebug: true }]) {
    assert.equal(isDevelopmentEnvironment(api, local), false, 'failed native identification never falls back to browser dev');
  }
});

test('browser development is limited to explicit HTTP loopback origins', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', '::1']) {
    for (const protocol of ['http:', 'https:']) assert.equal(isDevelopmentEnvironment(null, { hostname, protocol }), true);
  }
  for (const hostname of ['game.example.com', 'localhost.example.com', '127.0.0.1.example.com', '192.168.1.3', '']) {
    assert.equal(isDevelopmentEnvironment(null, { protocol: 'https:', hostname, search: '?dev=1&debug=true', development: true }), false);
  }
  assert.equal(isDevelopmentEnvironment(null, { ...local, protocol: 'file:' }), false);
  assert.equal(isDevelopmentEnvironment(null, undefined), false);
});

test('developer level numbers reject malformed or out-of-range input without truncation', () => {
  for (const value of ['', '0', '000', '1000', '-1', '1e2', '1.5', '12abc', ' 12 ', 999, null]) assert.equal(developmentLevelNumber(value), null);
  for (const [value, id] of [['1', 1], ['001', 1], ['121', 121], ['999', 999]]) assert.equal(developmentLevelNumber(value), id);
});
