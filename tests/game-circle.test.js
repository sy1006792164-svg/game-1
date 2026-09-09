'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameCircle } = require('../src/game-circle');

test('game circle fails closed for unsupported channels and failed account identification', async () => {
  const accounts = ['release', 'production', 'development', '', null, undefined, true]
    .map(envVersion => ({ getAccountInfoSync: () => ({ miniProgram: { envVersion } }) }));
  accounts.push({}, { getAccountInfoSync: () => null }, { getAccountInfoSync: () => ({}) },
    { getAccountInfoSync() { throw new Error('SDK unavailable'); } });
  for (const wx of accounts) {
    wx.createPageManager = () => assert.fail('Disabled circles must not create native pages');
    const circle = createGameCircle({ kind: 'wechat', wx, isDevelopment: true }, 'circle-link',
      () => assert.fail('Disabled circles must stay silent'));
    assert.equal(circle.available, false);
    await circle.open();
    assert.throws(() => { circle.available = true; }, TypeError);
    wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } });
    await circle.open();
  }
});

test('develop and trial circles retain their configured destination and duplicate-click protection', async () => {
  for (const envVersion of ['develop', 'trial']) {
    const shown = [];
    let finish, created = 0;
    const circle = createGameCircle({ kind: 'wechat', wx: {
      getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
      createPageManager() {
        created++;
        return { show(options) { shown.push(options); return new Promise(resolve => { finish = resolve; }); } };
      }
    } }, 'circle-link', () => assert.fail('Opening should succeed'));
    assert.equal(circle.available, true);
    const first = circle.open();
    await circle.open();
    assert.deepEqual(shown, [{ openlink: 'circle-link' }]);
    finish(); await first;
    const second = circle.open();
    assert.equal(shown.length, 2);
    assert.equal(created, 1);
    finish(); await second;
  }
});
