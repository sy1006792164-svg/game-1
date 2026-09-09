'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRankingAuthorization } = require('../src/ranking-authorization');
const rectangle = { left: 42, top: 310, width: 240, height: 48 };
const turn = () => new Promise(resolve => setImmediate(resolve));
const profile = { nickName: '小风📮', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/own/132' };
const userInfo = extra => ({ userInfo: { ...profile, ...extra } });

function setup(options = {}) {
  const calls = [], pending = {}, buttons = [], profiles = [], ready = [];
  function request(name) { return value => { calls.push(name); (pending[name] || (pending[name] = [])).push(value); }; }
  const api = { requirePrivacyAuthorize: request('privacy'), getSetting: request('setting'),
    getUserInfo: request('userinfo'), openSetting: request('settings'), openPrivacyContract: request('contract'),
    createUserInfoButton(value) {
      calls.push('button');
      const b = { options: value, style: { ...value.style }, showCount: 0, hideCount: 0, destroyCount: 0,
        onTap(fn) { b.tap = fn; }, offTap(fn) { b.removed = fn; },
        show() { b.showCount++; }, hide() { b.hideCount++; }, destroy() { b.destroyCount++; } };
      buttons.push(b); return b;
    } };
  Object.defineProperty(api, 'cloud', { get() { throw new Error('Cloud development must not be accessed'); } });
  const callbacks = {
    onProfile(value) { calls.push('profile'); profiles.push({ ...value }); return options.onProfile ? options.onProfile(value) : undefined; },
    onReady() { calls.push('ready'); ready.push(true); },
  };
  const platform = { kind: options.kind || 'wechat', isDevelopment: !!options.development, wx: api };
  if (options.remove) delete api[options.remove];
  const gate = createRankingAuthorization(platform, callbacks);
  async function reachSetting(value) {
    pending.privacy.at(-1).success(); await turn();
    pending.setting.at(-1).success({ authSetting: value === undefined ? {} : { 'scope.userInfo': value } }); await turn();
  }
  return { gate, api, calls, pending, buttons, profiles, ready, reachSetting };
}

test('explicit ranking actions request privacy then userInfo permission without login or cloud access', async () => {
  const h = setup({ development: true });
  assert.equal('login' in h.api, false); assert.deepEqual(h.calls, []);
  h.gate.updateButton(rectangle); assert.deepEqual(h.calls, []);
  const opening = h.gate.open();
  assert.deepEqual(h.calls, ['privacy']);
  assert.equal(h.gate.getState().status, 'privacy');
  assert.equal(h.gate.open(), opening, 'double taps share the same privacy request');
  await h.reachSetting(); await opening;
  assert.deepEqual(h.calls.slice(0, 2), ['privacy', 'setting']);
  assert.equal(h.gate.getState().status, 'needs-profile');
  assert.equal(h.profiles.length, 0);
  h.gate.close();
});

test('privacy refusal makes no login or cloud call and allows an explicit retry', async () => {
  const h = setup(); const first = h.gate.open();
  h.pending.privacy[0].fail({ errMsg: 'requirePrivacyAuthorize:fail disagree' });
  assert.equal((await first).status, 'denied'); assert.deepEqual(h.calls, ['privacy']);
  assert.equal(h.gate.getState().enabled, false);
  const second = h.gate.open(); assert.equal(h.pending.privacy.length, 2);
  h.gate.close(); await second;
});

test('authorized users need only uncredentialed public userInfo and synchronous local handling succeeds', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(true);
  assert.equal(h.pending.userinfo[0].withCredentials, false);
  assert.equal(h.pending.userinfo[0].lang, 'zh_CN');
  h.pending.userinfo[0].success({ ...userInfo({ openId: 'discard', unionId: 'discard', gender: 1, city: 'discard' }), encryptedData: 'discard', signature: 'discard' });
  assert.equal((await opening).status, 'ready');
  assert.deepEqual(h.profiles, [profile]); assert.equal(h.ready.length, 1);
  assert.deepEqual(h.gate.getState().profile, profile);
  assert.equal(h.buttons.length, 0); assert.equal(h.gate.getState().enabled, true);
  h.gate.close(); assert.equal(h.gate.getState().enabled, true, 'leaving rankings preserves the confirmed session gate for later wins');
});

test('first authorization uses a visible native button at CSS coordinates and resizes without recreating it', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(); await opening;
  assert.equal(h.buttons.length, 0, 'no native overlay before the main renderer provides its rectangle');
  h.gate.updateButton(rectangle, { visible: true });
  const button = h.buttons[0];
  assert.equal(button.options.type, 'text'); assert.equal(button.options.text, '授权头像昵称并查看');
  assert.equal(button.options.withCredentials, false); assert.equal(button.options.lang, 'zh_CN');
  assert.equal(button.style.left, 42); assert.equal(button.style.top, 310); assert.equal(button.style.width, 240);
  assert.equal(button.style.backgroundColor, '#efbd72'); assert.equal(button.style.color, '#112e32');
  for (let n = 0; n < 5; n++) h.gate.updateButton(rectangle, true);
  assert.equal(h.buttons.length, 1); assert.equal(button.showCount, 1);
  h.gate.updateButton({ ...rectangle, top: 330, width: 220 }); assert.equal(button.style.top, 330); assert.equal(button.style.width, 220);
  h.gate.updateButton(rectangle, false); assert.equal(button.hideCount, 1);
  h.gate.updateButton(rectangle, true); assert.equal(button.showCount, 2);
  button.tap(userInfo()); await turn();
  assert.deepEqual(h.profiles, [profile]); assert.equal(h.gate.getState().status, 'ready');
  assert.equal(h.pending.userinfo, undefined, 'button userInfo is sufficient without another request');
  assert.equal(button.destroyCount, 1); assert.equal(button.removed, button.tap); h.gate.close();
});

test('cloudID or encrypted fields without native public userInfo cannot enable the gate', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(true);
  h.pending.userinfo[0].success({ cloudID: 'irrelevant', encryptedData: 'irrelevant', nickName: 'top-level-fake' }); await opening;
  assert.equal(h.profiles.length, 0); assert.equal(h.gate.getState().status, 'error');
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().profile, null); h.gate.close();
});

test('profile refusal uses a fresh settings gesture and rechecks privacy and current permission on return', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(); await opening;
  h.gate.updateButton(rectangle); h.buttons[0].tap({ errMsg: 'getUserInfo:fail auth deny' });
  assert.equal(h.gate.getState().status, 'denied'); assert.equal(h.gate.getState().canOpenSettings, true);
  assert.equal(h.pending.settings, undefined); assert.equal(h.profiles.length, 0);
  const restoring = h.gate.openSettings(); assert.equal(h.pending.settings.length, 1, 'the native settings request starts in the user action');
  h.pending.settings[0].success({ authSetting: { 'scope.userInfo': true } }); await turn();
  assert.equal(h.pending.privacy.length, 2);
  await h.reachSetting(true); h.pending.userinfo[0].success(userInfo()); await restoring;
  assert.equal(h.gate.getState().status, 'ready'); assert.deepEqual(h.profiles, [profile]); h.gate.close();
});

test('an explicitly denied scope from getSetting offers settings instead of repeatedly constructing native buttons', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(false); await opening;
  h.gate.updateButton(rectangle); assert.equal(h.buttons.length, 0); assert.equal(h.gate.getState().canOpenSettings, true);
  const retry = h.gate.open(); assert.equal(h.pending.settings.length, 1);
  h.pending.settings[0].success({ authSetting: { 'scope.userInfo': false } });
  assert.equal((await retry).status, 'denied'); h.gate.close();
});

test('backgrounding hides native overlays but preserves a legitimate system-dialog callback', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(); await opening;
  h.gate.updateButton(rectangle); const button = h.buttons[0];
  h.gate.hide(); assert.equal(button.hideCount, 1); assert.equal(h.gate.getState().hasNativeButton, false);
  h.gate.updateButton(rectangle, true); assert.equal(button.showCount, 1, 'a background renderer cannot show the overlay');
  h.gate.show(); assert.equal(button.showCount, 2);
  h.gate.hide(); button.tap(userInfo()); await turn();
  assert.equal(h.gate.getState().status, 'ready'); assert.equal(button.destroyCount, 1); h.gate.close();
});

test('closing cancels pending native calls and ignores late privacy and user info callbacks', async () => {
  const h = setup(); const first = h.gate.open(); h.gate.close(); await first;
  h.pending.privacy[0].success(); await turn(); assert.deepEqual(h.calls, ['privacy']); assert.equal(h.gate.getState().status, 'idle');
  const second = h.gate.open(); await h.reachSetting(true); h.gate.close(); await second;
  h.pending.userinfo[0].success(userInfo()); await turn(); assert.equal(h.profiles.length, 0); assert.equal(h.gate.getState().status, 'idle');
});

test('closing destroys the native button and ignores a saved late tap callback', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(); await opening;
  h.gate.updateButton(rectangle); const button = h.buttons[0], lateTap = button.tap;
  h.gate.close(); lateTap(userInfo()); await turn();
  assert.equal(button.destroyCount, 1); assert.equal(h.profiles.length, 0); assert.equal(h.gate.getState().enabled, false);
});

test('local profile handling settles before ready and duplicate native callbacks are ignored', async () => {
  let resolveSave; const h = setup({ onProfile: () => new Promise(resolve => { resolveSave = resolve; }) });
  const opening = h.gate.open(); await h.reachSetting(); await opening; h.gate.updateButton(rectangle);
  h.buttons[0].tap(userInfo()); h.buttons[0].tap(userInfo({ nickName: '重复回调' })); await turn();
  assert.equal(h.profiles.length, 1); assert.equal(h.gate.getState().enabled, false);
  resolveSave(false); await turn(); assert.equal(h.gate.getState().status, 'error'); assert.equal(h.ready.length, 0); h.gate.close();
});

test('closing while a local profile callback is pending ignores its late completion', async () => {
  let finishProfile; const h = setup({ onProfile: () => new Promise(resolve => { finishProfile = resolve; }) });
  const opening = h.gate.open(); await h.reachSetting(true); h.pending.userinfo[0].success(userInfo()); await turn();
  h.gate.close(); await opening; finishProfile(true); await turn();
  assert.equal(h.gate.getState().status, 'idle'); assert.equal(h.gate.getState().enabled, false);
  assert.equal(h.gate.getState().profile, null); assert.equal(h.ready.length, 0);
});

test('a synchronous local callback failure stays disabled and a later explicit visit recovers', async () => {
  let fails = true; const h = setup({ onProfile: () => { if (fails) throw new Error('local failure'); } });
  const first = h.gate.open(); await h.reachSetting(true); h.pending.userinfo[0].success(userInfo());
  assert.equal((await first).status, 'error'); assert.equal(h.gate.getState().enabled, false);
  fails = false; const retry = h.gate.open(); await h.reachSetting(true); h.pending.userinfo[1].success(userInfo());
  assert.equal((await retry).status, 'ready'); assert.equal(h.gate.getState().enabled, true); h.gate.close();
});

test('closing between native success and the continuation cannot initiate more profile work', async () => {
  const h = setup(); const opening = h.gate.open(); h.pending.privacy[0].success(); h.gate.close(); await opening;
  assert.equal(h.gate.getState().status, 'idle'); assert.deepEqual(h.calls, ['privacy']);
});

test('each new ranking visit rechecks actual WeChat permission instead of a saved consent flag', async () => {
  const h = setup(); const first = h.gate.open(); await h.reachSetting(true); h.pending.userinfo[0].success(userInfo()); await first; h.gate.close();
  assert.equal(h.gate.getState().enabled, true);
  const second = h.gate.open(); assert.equal(h.gate.getState().enabled, false, 'a new visit suspends sync while current permission is checked');
  await h.reachSetting(false); await second;
  assert.equal(h.pending.privacy.length, 2); assert.equal(h.pending.setting.length, 2);
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().canOpenSettings, true); h.gate.close();
});

test('browser or missing native APIs report unavailable without starting another service', async () => {
  for (const options of [{ kind: 'browser' }, { remove: 'requirePrivacyAuthorize' }, { remove: 'createUserInfoButton' }]) {
    const h = setup(options); assert.equal((await h.gate.open()).status, 'unavailable'); assert.deepEqual(h.calls, []); h.gate.close();
  }
});

test('privacy contract opens only in response to its explicit action', async () => {
  const h = setup(); assert.deepEqual(h.calls, []);
  const viewing = h.gate.openContract(); assert.deepEqual(h.calls, ['contract']);
  h.pending.contract[0].success(); assert.equal(await viewing, true); assert.equal(h.gate.getState().status, 'idle');
});

test('public profile fields are bounded, discard identities, and cannot be changed through callback or state references', async () => {
  const h = setup({ onProfile(value) { value.nickName = 'callback-mutation'; return Promise.resolve(); } });
  const opening = h.gate.open(); await h.reachSetting(true);
  h.pending.userinfo[0].success(userInfo({ nickName: '\u0000' + '📮'.repeat(30) + '\u202e', avatarUrl: 'http://wx.qlogo.cn/mmopen/own/132', openId: 'discard', country: 'discard' }));
  await opening;
  const own = h.gate.getState().profile;
  assert.equal(h.gate.getState().enabled, true);
  assert.deepEqual(Object.keys(own).sort(), ['nickName', 'avatarUrl'].sort());
  assert.equal(Array.from(own.nickName).length, 20);
  assert.equal(own.avatarUrl, 'https://wx.qlogo.cn/mmopen/own/132');
  own.nickName = 'external-mutation';
  assert.equal(h.gate.getState().profile.nickName, '📮'.repeat(20));
  assert.deepEqual(Object.keys(h.profiles[0]).sort(), ['nickName', 'avatarUrl'].sort());
  h.gate.close(); assert.equal(h.gate.getState().profile.nickName, '📮'.repeat(20));
});

test('invalid or oversized avatar URLs use the default avatar while native nickname authorization still succeeds', async () => {
  for (const avatarUrl of ['https://wx.qlogo.cn.evil.example/132', 'https://user:pass@wx.qlogo.cn/132', 'data:image/png,evil', 'x'.repeat(2049)]) {
    const h = setup(); const opening = h.gate.open(); await h.reachSetting(true);
    h.pending.userinfo[0].success(userInfo({ avatarUrl })); await opening;
    assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().profile.avatarUrl, ''); h.gate.close();
  }
});

test('a refused native result cannot enable rankings even if it contains profile fields', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(); await opening;
  h.gate.updateButton(rectangle); h.buttons[0].tap({ ...userInfo(), errMsg: 'getUserInfo:fail auth deny' }); await turn();
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().profile, null);
  assert.equal(h.profiles.length, 0); h.gate.close();
});

test('settings callbacks preserve background visibility until the app is shown', async () => {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(); await opening;
  h.gate.updateButton(rectangle); h.buttons[0].tap({ errMsg: 'getUserInfo:fail auth deny' });
  const restoring = h.gate.openSettings(); h.gate.hide();
  h.pending.settings[0].success({ authSetting: { 'scope.userInfo': true } }); await turn();
  // The follow-up setting query remains authoritative if permission changed
  // again before returning to the game.
  await h.reachSetting(); await restoring;
  assert.equal(h.gate.getState().needsProfile, true);
  assert.equal(h.buttons.length, 1, 'no new native overlay may be created in the background');
  h.gate.updateButton(rectangle, true); assert.equal(h.buttons.length, 1);
  h.gate.show(); assert.equal(h.buttons.length, 2); assert.equal(h.gate.getState().hasNativeButton, true);
  h.gate.close();
});

async function enabledSession() {
  const h = setup(); const opening = h.gate.open(); await h.reachSetting(true);
  h.pending.userinfo[0].success(userInfo()); await opening; return h;
}

test('foreground permission revalidation closes the sync gate immediately and only reads settings once', async () => {
  const h = await enabledSession(); const before = h.calls.length;
  const checking = h.gate.revalidate();
  assert.equal(h.gate.getState().enabled, false, 'automatic score writes must stop before the asynchronous permission check');
  assert.equal(h.gate.revalidate(), checking, 'repeated foreground events share the permission request');
  assert.deepEqual(h.calls.slice(before), ['setting']);
  const authSetting = { 'scope.userInfo': true, 'scope.WxFriendInteraction': false };
  h.pending.setting[1].success({ authSetting });
  assert.deepEqual(await checking, authSetting);
  assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().status, 'ready');
  assert.equal(h.ready.length, 1, 'a read-only refresh must not reopen rankings through onReady');
  assert.equal(h.profiles.length, 1); h.gate.close();
});

test('revoked profile permission disables the session and offers a fresh explicit settings action', async () => {
  const h = await enabledSession(); h.gate.hide();
  const checking = h.gate.revalidate();
  h.pending.setting[1].success({ authSetting: { 'scope.userInfo': false, 'scope.WxFriendInteraction': true } });
  await checking;
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().status, 'denied');
  assert.equal(h.gate.getState().canOpenSettings, true); assert.equal(h.pending.settings, undefined);
  h.gate.show(); const restoring = h.gate.openSettings();
  assert.equal(h.pending.settings.length, 1); h.pending.settings[0].fail({ errMsg: 'openSetting:fail' }); await restoring;
  assert.equal(h.gate.getState().canOpenSettings, true, 'failed settings remains explicitly retryable');
  const retry = h.gate.openSettings(); h.pending.settings[1].success({ authSetting: { 'scope.userInfo': true } }); await turn();
  await h.reachSetting(true); h.pending.userinfo[1].success(userInfo()); await retry;
  assert.equal(h.gate.getState().enabled, true); h.gate.close();
});

test('permission read failures or malformed responses never retain the previous enabled session', async () => {
  for (const result of [null, {}, { authSetting: [] }, 'failure']) {
    const h = await enabledSession(); const checking = h.gate.revalidate();
    if (result === 'failure') h.pending.setting[1].fail({ errMsg: 'getSetting:fail' });
    else h.pending.setting[1].success(result);
    assert.equal(await checking, null); assert.equal(h.gate.getState().enabled, false);
    assert.equal(h.gate.getState().status, 'error'); assert.equal(h.pending.privacy.length, 1);
    h.gate.close();
  }
});

test('a confirmed session can be checked after leaving rankings without activating the page', async () => {
  const h = await enabledSession(); h.gate.close();
  const checking = h.gate.revalidate(); assert.equal(h.gate.getState().enabled, false);
  h.pending.setting[1].success({ authSetting: { 'scope.userInfo': true, 'scope.WxFriendInteraction': true } }); await checking;
  assert.equal(h.gate.getState().enabled, true); assert.equal(h.gate.getState().status, 'idle');
  assert.equal(h.ready.length, 1); assert.equal(h.buttons.length, 0);
  const revoked = h.gate.revalidate(); h.pending.setting[2].success({ authSetting: {} }); await revoked;
  assert.equal(h.gate.getState().enabled, false); assert.equal(h.gate.getState().status, 'idle'); h.gate.close();
});

test('closing or opening again cancels old foreground checks and late callbacks cannot reenable the gate', async () => {
  for (const action of ['close', 'open']) {
    const h = await enabledSession(); const checking = h.gate.revalidate();
    const next = h.gate[action]();
    assert.equal(await checking, null, 'leaving or explicitly reopening cancels the old read immediately');
    h.pending.setting[1].success({ authSetting: { 'scope.userInfo': true } }); await turn();
    assert.equal(h.gate.getState().enabled, false);
    assert.equal(h.gate.getState().status, action === 'close' ? 'idle' : 'privacy');
    h.gate.close(); await next;
  }
});

test('read-only revalidation cannot start authorization or interfere with an explicit authorization already underway', async () => {
  const h = setup(); assert.equal(await h.gate.revalidate(), null); assert.deepEqual(h.calls, []);
  const opening = h.gate.open(); const before = h.calls.length;
  assert.equal(await h.gate.revalidate(), null); assert.equal(h.calls.length, before);
  await h.reachSetting(); await opening; h.gate.updateButton(rectangle);
  assert.equal(await h.gate.revalidate(), null); assert.equal(h.gate.getState().needsProfile, true);
  h.gate.close();
});

test('later foreground checks can recover after a failed, cancelled or revoked permission check', async () => {
  for (const outcome of ['failed', 'cancelled', 'revoked']) {
    const h = await enabledSession(); h.gate.hide(); const checking = h.gate.revalidate();
    const firstCheck = h.pending.setting[1];
    if (outcome === 'failed') firstCheck.fail({ errMsg: 'getSetting:fail temporary' });
    else if (outcome === 'cancelled') h.gate.close();
    else firstCheck.success({ authSetting: { 'scope.userInfo': false } });
    await checking; assert.equal(h.gate.getState().enabled, false);
    h.gate.hide(); h.gate.show(); const restoring = h.gate.revalidate();
    assert.equal(h.pending.setting.length, 3, `${outcome} must not permanently disable read-only permission refreshes`);
    assert.equal(h.gate.getState().enabled, false, 'permission still must be confirmed before restoring sync');
    if (outcome === 'cancelled') {
      firstCheck.success({ authSetting: { 'scope.userInfo': true } }); await turn();
      assert.equal(h.gate.getState().enabled, false, 'a cancelled request cannot complete the newer check');
    }
    h.pending.setting[2].success({ authSetting: { 'scope.userInfo': true, 'scope.WxFriendInteraction': true } });
    assert.deepEqual(await restoring, { 'scope.userInfo': true, 'scope.WxFriendInteraction': true });
    assert.equal(h.gate.getState().enabled, true);
    assert.equal(h.gate.getState().status, outcome === 'cancelled' ? 'idle' : 'ready');
    assert.equal(h.pending.privacy.length, 1); assert.equal(h.pending.userinfo.length, 1);
    assert.equal(h.ready.length, 1); assert.equal(h.pending.settings, undefined); h.gate.close();
  }
});

test('a newly opened authorization must finish again before the prior profile becomes eligible for read-only recovery', async () => {
  for (const outcome of ['cancelled', 'privacy-denied', 'needs-profile', 'profile-error']) {
    const h = await enabledSession(); h.gate.close(); const opening = h.gate.open();
    assert.equal(await h.gate.revalidate(), null);
    if (outcome === 'cancelled') h.gate.close();
    else if (outcome === 'privacy-denied') h.pending.privacy[1].fail({ errMsg: 'requirePrivacyAuthorize:fail disagree' });
    else {
      await h.reachSetting(outcome === 'needs-profile' ? undefined : true);
      if (outcome === 'profile-error') h.pending.userinfo[1].success({});
    }
    await opening;
    const before = h.calls.length; assert.deepEqual(h.gate.getState().profile, profile, 'an old profile exists but does not grant permission');
    assert.equal(await h.gate.revalidate(), null); assert.equal(h.calls.length, before);
    assert.equal(h.gate.getState().enabled, false); h.gate.close();
  }
});

test('abandoning an explicit settings recovery cannot restore a prior session with a background check', async () => {
  const h = await enabledSession(); const checking = h.gate.revalidate();
  h.pending.setting[1].success({ authSetting: { 'scope.userInfo': false } }); await checking;
  const restoring = h.gate.openSettings(); h.gate.close(); await restoring;
  const before = h.calls.length; assert.equal(await h.gate.revalidate(), null); assert.equal(h.calls.length, before);
  h.pending.settings[0].success({ authSetting: { 'scope.userInfo': true } }); await turn();
  assert.equal(h.gate.getState().enabled, false); h.gate.close();
});
