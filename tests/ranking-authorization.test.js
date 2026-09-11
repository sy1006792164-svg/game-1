'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRankingAuthorization } = require('../src/ranking-authorization');
const turn = () => new Promise(resolve => setImmediate(resolve));

function setup(options = {}) {
  const calls = [], pending = {}, ready = [], profiles = [];
  function request(name) {
    return value => {
      calls.push(name);
      (pending[name] || (pending[name] = [])).push(value);
    };
  }
  const api = {
    requirePrivacyAuthorize: request('privacy'),
    getSetting: request('setting'),
    getPrivacySetting: request('privacy-setting'),
    openPrivacyContract: request('contract'),
    openSetting: request('settings'),
    getUserInfo() { calls.push('userinfo'); throw new Error('getUserInfo must not be called'); },
    createUserInfoButton() { calls.push('button'); throw new Error('createUserInfoButton must not be called'); },
  };
  Object.defineProperty(api, 'cloud', { get() { throw new Error('Cloud development must not be accessed'); } });
  const callbacks = {
    onProfile(value) { calls.push('profile'); profiles.push(value); },
    onReady(value) { calls.push('ready'); ready.push(value); },
  };
  if (options.remove) delete api[options.remove];
  const platform = { kind: options.kind || 'wechat', isDevelopment: !!options.development, wx: api };
  const gate = createRankingAuthorization(platform, callbacks);
  async function finishFirst(settings = {}) {
    pending.privacy.at(-1).success(); await turn();
    pending.setting.at(-1).success({ authSetting: settings });
    return gate;
  }
  return { gate, api, calls, pending, ready, profiles, finishFirst };
}

async function enabledSession(settings = { 'scope.WxFriendInteraction': true }) {
  const h = setup();
  const opening = h.gate.open();
  await h.finishFirst(settings);
  await opening;
  return h;
}

function finishCheck(h, setting, privacy = { needAuthorization: false }, index = -1) {
  h.pending.setting.at(index).success({ authSetting: setting });
  if (h.pending['privacy-setting']) h.pending['privacy-setting'].at(index).success(privacy);
}

test('explicit ranking consent requests privacy and reads settings without requesting a public profile', async () => {
  const h = setup({ development: true });
  assert.equal('login' in h.api, false); assert.deepEqual(h.calls, []);
  h.gate.updateButton({ left: 10, top: 10, width: 100, height: 40 });
  assert.deepEqual(h.calls, []); assert.equal(h.gate.getState().hasNativeButton, false);
  const opening = h.gate.open();
  assert.deepEqual(h.calls, ['privacy']); assert.equal(h.gate.getState().status, 'privacy');
  assert.equal(h.gate.open(), opening, 'double taps share the same privacy request');
  const settings = { 'scope.userInfo': false, 'scope.WxFriendInteraction': false };
  await h.finishFirst(settings);
  assert.equal((await opening).status, 'ready');
  assert.deepEqual(h.calls, ['privacy', 'setting', 'ready']);
  assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().canDisplay, true);
  assert.equal(h.gate.getState().profile, null); assert.equal(h.gate.getState().needsProfile, false);
  assert.equal(h.gate.getState().canOpenSettings, false); assert.deepEqual(h.profiles, []);
  assert.deepEqual(h.ready, [{ authSetting: settings }]); h.gate.close();
});

test('privacy refusal stays disabled and a later explicit action can retry', async () => {
  const h = setup(); const first = h.gate.open();
  h.pending.privacy[0].fail({ errMsg: 'requirePrivacyAuthorize:fail disagree' });
  assert.equal((await first).status, 'denied'); assert.deepEqual(h.calls, ['privacy']);
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().canDisplay, false);
  const second = h.gate.open(); assert.equal(h.pending.privacy.length, 2);
  h.gate.close(); await second;
});

test('missing profile APIs do not block rankings, while required privacy APIs still report unavailable', async () => {
  for (const remove of ['getUserInfo', 'createUserInfoButton', 'openSetting']) {
    const h = setup({ remove }); const opening = h.gate.open(); await h.finishFirst({});
    assert.equal((await opening).status, 'ready'); h.gate.close();
  }
  for (const options of [{ kind: 'browser' }, { remove: 'requirePrivacyAuthorize' }, { remove: 'getSetting' }]) {
    const h = setup(options); assert.equal((await h.gate.open()).status, 'unavailable');
    assert.deepEqual(h.calls, []); h.gate.close();
  }
});

test('privacy contract opens only from its explicit action', async () => {
  const h = setup(); assert.deepEqual(h.calls, []);
  const viewing = h.gate.openContract(); assert.deepEqual(h.calls, ['contract']);
  h.pending.contract[0].success(); assert.equal(await viewing, true);
  assert.equal(h.gate.getState().status, 'idle');
});

test('closing cancels pending privacy and settings work and ignores late callbacks', async () => {
  {
    const h = setup(); const opening = h.gate.open(); h.gate.close(); await opening;
    h.pending.privacy[0].success(); await turn();
    assert.deepEqual(h.calls, ['privacy']); assert.equal(h.gate.getState().status, 'idle');
    assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().canDisplay, false);
  }
  {
    const h = setup(); const opening = h.gate.open(); h.pending.privacy[0].success(); await turn();
    assert.deepEqual(h.calls, ['privacy', 'setting']);
    h.gate.close(); await opening;
    h.pending.setting[0].success({ authSetting: { 'scope.WxFriendInteraction': true } }); await turn();
    assert.equal(h.gate.getState().status, 'idle'); assert.equal(h.gate.getState().enabled, false);
    assert.equal(h.gate.getState().canDisplay, true, 'confirmed privacy keeps cached ranks eligible');
    assert.equal(h.ready.length, 0);
  }
});

test('backgrounding preserves an explicit privacy dialog but cancels a cold silent restore', async () => {
  {
    const h = setup(); const opening = h.gate.open(); h.gate.hide();
    h.pending.privacy[0].success(); await turn();
    h.pending.setting[0].success({ authSetting: {} }); await opening;
    assert.equal(h.gate.getState().enabled, true);
  }
  {
    const h = setup(); const restoring = h.gate.revalidate();
    assert.deepEqual(h.calls, ['privacy-setting']); h.gate.hide();
    assert.equal(await restoring, null);
    h.pending['privacy-setting'][0].success({ needAuthorization: false }); await turn();
    assert.equal(h.pending.setting, undefined, 'a late restore callback cannot start settings work');
    assert.equal(h.gate.getState().enabled, false);
  }
});

test('a settings read failure after consent keeps cached preview and retries silently', async () => {
  const h = setup(); const opening = h.gate.open();
  h.pending.privacy[0].success(); await turn(); h.pending.setting[0].fail({ errMsg: 'getSetting:fail temporary' });
  assert.equal((await opening).status, 'error'); assert.equal(h.gate.getState().enabled, false);
  assert.equal(h.gate.getState().canDisplay, true); assert.equal(h.pending.privacy.length, 1);
  const retry = h.gate.open();
  assert.equal(h.gate.getState().checking, true); assert.equal(h.gate.getState().canDisplay, true);
  finishCheck(h, { 'scope.userInfo': false });
  assert.equal((await retry).status, 'ready'); assert.equal(h.gate.getState().enabled, true);
  assert.equal(h.pending.privacy.length, 1, 'known privacy consent is not requested again');
  h.gate.close();
});

test('returning players immediately preview cached ranks while one shared silent check runs', async () => {
  const h = await enabledSession(); h.gate.close(); const before = h.calls.length;
  const opening = h.gate.open();
  assert.deepEqual(h.calls.slice(before), ['privacy-setting', 'setting']);
  assert.equal(h.gate.getState().status, 'ready'); assert.equal(h.gate.getState().canDisplay, true);
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().checking, true);
  assert.equal(h.gate.open(), opening);
  const settings = { 'scope.userInfo': false, 'scope.WxFriendInteraction': true };
  finishCheck(h, settings);
  await opening;
  assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().checking, false);
  assert.equal(h.pending.privacy.length, 1); assert.deepEqual(h.ready[1], { authSetting: settings });
  h.ready[1].authSetting['scope.WxFriendInteraction'] = false;
  h.gate.getState().authSetting['scope.WxFriendInteraction'] = false;
  assert.equal(h.gate.getState().authSetting['scope.WxFriendInteraction'], true, 'permission snapshots are immutable to callers');
  h.gate.close();
});

test('userInfo and friend-interaction values never gate privacy readiness', async () => {
  for (const settings of [
    {},
    { 'scope.userInfo': false },
    { 'scope.userInfo': true, 'scope.WxFriendInteraction': false },
  ]) {
    const h = await enabledSession(settings);
    const checking = h.gate.revalidate(); finishCheck(h, settings);
    assert.deepEqual(await checking, settings);
    assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().canDisplay, true);
    assert.equal(h.gate.getState().canOpenSettings, false); assert.equal(h.pending.settings, undefined);
    h.gate.close();
  }
});

test('a definitive privacy revocation wins over a simultaneous settings failure and hides cached ranks', async () => {
  const h = await enabledSession();
  const checking = h.gate.revalidate();
  h.pending.setting[1].fail({ errMsg: 'getSetting:fail temporary' });
  h.pending['privacy-setting'][0].success({ needAuthorization: true });
  assert.equal(await checking, null);
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().canDisplay, false);
  assert.equal(h.gate.getState().status, 'denied'); assert.equal(h.gate.getState().canOpenSettings, false);
  h.gate.close();
});

test('temporary or malformed permission checks fail closed without discarding a confirmed cached preview', async () => {
  for (const result of [null, {}, { authSetting: [] }, 'failure']) {
    const h = await enabledSession(); const checking = h.gate.revalidate();
    if (result === 'failure') h.pending.setting[1].fail({ errMsg: 'getSetting:fail' });
    else h.pending.setting[1].success(result);
    h.pending['privacy-setting'][0].success({ needAuthorization: false });
    assert.equal(await checking, null); assert.equal(h.gate.getState().enabled, false);
    assert.equal(h.gate.getState().status, 'error'); assert.equal(h.gate.getState().canDisplay, true);
    assert.equal(h.gate.getState().checking, false); h.gate.close();
  }
});

test('cold restore needs only prior privacy consent and returns all settings for friend-leaderboard', async () => {
  const h = setup(); const restoring = h.gate.revalidate();
  assert.equal(h.gate.getState().checking, true); assert.deepEqual(h.calls, ['privacy-setting']);
  h.pending['privacy-setting'][0].success({ needAuthorization: false }); await turn();
  assert.deepEqual(h.calls, ['privacy-setting', 'setting']);
  const settings = { 'scope.userInfo': false, 'scope.WxFriendInteraction': false };
  h.pending.setting[0].success({ authSetting: settings });
  assert.deepEqual(await restoring, settings);
  assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().canDisplay, true);
  assert.equal(h.gate.getState().status, 'idle'); assert.equal(h.ready.length, 0);
  assert.equal(h.gate.getState().profile, null); assert.deepEqual(h.profiles, []);
  h.gate.close();
});

test('cold restore records a privacy revoke and waits for a new explicit consent action', async () => {
  const h = setup(); const restoring = h.gate.revalidate();
  h.pending['privacy-setting'][0].success({ needAuthorization: true });
  assert.equal(await restoring, null); assert.equal(h.gate.getState().canDisplay, false);
  const before = h.calls.length; assert.equal(await h.gate.revalidate(), null);
  assert.equal(h.calls.length, before, 'known revocation is not silently retried');
  const opening = h.gate.open(); assert.equal(h.pending.privacy.length, 1);
  h.gate.close(); await opening;
});

test('confirmed consent can be checked after closing without activating the page', async () => {
  const h = await enabledSession(); h.gate.close();
  const checking = h.gate.revalidate(); assert.equal(h.gate.getState().enabled, false);
  const settings = { 'scope.WxFriendInteraction': true };
  finishCheck(h, settings);
  assert.deepEqual(await checking, settings);
  assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().status, 'idle');
  assert.equal(h.ready.length, 1, 'a read-only refresh never reopens the list');
  h.gate.close();
});

test('closing or reopening cancels old checks and late callbacks cannot reenable them', async () => {
  for (const action of ['close', 'open']) {
    const h = await enabledSession(); const checking = h.gate.revalidate();
    const oldSetting = h.pending.setting[1], oldPrivacy = h.pending['privacy-setting'][0];
    const next = h.gate[action]();
    assert.equal(await checking, null);
    oldSetting.success({ authSetting: { 'scope.WxFriendInteraction': true } });
    oldPrivacy.success({ needAuthorization: false }); await turn();
    assert.equal(h.gate.getState().enabled, false);
    if (action === 'open') {
      finishCheck(h, { 'scope.WxFriendInteraction': true }); await next;
      assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().status, 'ready');
    } else {
      assert.equal(h.gate.getState().status, 'idle');
    }
    h.gate.close();
  }
});

test('read-only revalidation never starts privacy consent or interrupts an explicit dialog', async () => {
  const h = setup(); const restoring = h.gate.revalidate();
  assert.deepEqual(h.calls, ['privacy-setting']);
  h.gate.hide(); await restoring; h.gate.show();
  const opening = h.gate.open(); const before = h.calls.length;
  assert.equal(await h.gate.revalidate(), null); assert.equal(h.calls.length, before);
  h.gate.close(); await opening;
});

test('warm checks work without getPrivacySetting, but cold restore stays non-interactive', async () => {
  const h = setup({ remove: 'getPrivacySetting' });
  assert.equal(await h.gate.revalidate(), null); assert.deepEqual(h.calls, []);
  const opening = h.gate.open(); await h.finishFirst({}); await opening; h.gate.close();
  const checking = h.gate.revalidate(); assert.deepEqual(h.calls.slice(-1), ['setting']);
  h.pending.setting[1].success({ authSetting: {} });
  assert.deepEqual(await checking, {}); assert.equal(h.gate.getState().enabled, true);
  h.gate.close();
});

test('profile compatibility methods remain inert and never open native settings', async () => {
  const h = await enabledSession({ 'scope.userInfo': false });
  assert.deepEqual(await h.gate.openSettings(), h.gate.getState());
  h.gate.updateButton({ left: 1, top: 1, width: 10, height: 10 }, true);
  assert.equal(h.gate.getState().needsProfile, false); assert.equal(h.gate.getState().hasNativeButton, false);
  assert.equal(h.pending.settings, undefined); assert.equal(h.calls.includes('button'), false);
  assert.equal(h.calls.includes('userinfo'), false); assert.deepEqual(h.profiles, []);
  h.gate.close();
});
