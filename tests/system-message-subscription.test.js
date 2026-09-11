'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SYSTEM_MESSAGE_TYPES,
  createSystemMessageSubscription,
} = require('../src/system-message-subscription');

const TYPES = SYSTEM_MESSAGE_TYPES;

function setup(messageTypes = [TYPES.RANK]) {
  const calls = [];
  const pending = { setting: [], request: [] };
  const wx = {
    getSetting(options) { calls.push(['setting', options]); pending.setting.push(options); },
    requestSubscribeSystemMessage(options) { calls.push(['request', options]); pending.request.push(options); },
  };
  return {
    calls,
    pending,
    wx,
    subscription: createSystemMessageSubscription({ kind: 'wechat', wx }, messageTypes),
  };
}

test('exports immutable official message types and strictly validates configured values', async () => {
  assert.deepEqual(SYSTEM_MESSAGE_TYPES, {
    INTERACTIVE: 'SYS_MSG_TYPE_INTERACTIVE',
    RANK: 'SYS_MSG_TYPE_RANK',
    WHATS_NEW: 'SYS_MSG_TYPE_WHATS_NEW',
  });
  assert.equal(Object.isFrozen(SYSTEM_MESSAGE_TYPES), true);
  assert.throws(() => createSystemMessageSubscription({}, TYPES.RANK), TypeError);
  assert.throws(() => createSystemMessageSubscription({}, []), RangeError);
  assert.throws(() => createSystemMessageSubscription({}, ['SYS_MSG_TYPE_UNKNOWN']), TypeError);
  assert.throws(() => createSystemMessageSubscription({}, [TYPES.RANK, TYPES.RANK]), RangeError);

  let options;
  const subscription = createSystemMessageSubscription({
    kind: 'wechat',
    wx: { requestSubscribeSystemMessage(value) { options = value; value.success({ [TYPES.RANK]: 'accept' }); } },
  });
  const requested = subscription.request();
  assert.deepEqual(options.msgTypeList, [TYPES.RANK], 'the safe default requests only the ranking reminder');
  assert.equal((await requested).status, 'accepted');
});

test('only a supported WeChat platform can call native subscription APIs', async () => {
  const browser = createSystemMessageSubscription({
    kind: 'browser',
    get wx() { throw new Error('non-WeChat platforms must not read wx'); },
  }, [TYPES.RANK]);
  assert.equal(browser.getState().status, 'unavailable');
  assert.equal((await browser.refresh()).status, 'unavailable');
  assert.equal((await browser.request()).status, 'unavailable');

  let settingCalls = 0;
  const oldWechat = createSystemMessageSubscription({ kind: 'wechat', wx: {
    getSetting() { settingCalls += 1; },
  } }, [TYPES.RANK]);
  assert.equal(oldWechat.getState().status, 'unavailable');
  await oldWechat.refresh(); await oldWechat.request();
  assert.equal(settingCalls, 0, 'feature detection is based on requestSubscribeSystemMessage');
});

test('refresh requests subscription settings and parses every official result', async () => {
  const h = setup([TYPES.INTERACTIVE, TYPES.RANK, TYPES.WHATS_NEW]);
  const checking = h.subscription.refresh();
  assert.equal(h.subscription.getState().status, 'checking');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'setting');
  assert.equal(h.calls[0][1].withSubscriptions, true);
  h.pending.setting[0].success({ subscriptionsSetting: {
    mainSwitch: true,
    itemSettings: {
      [TYPES.INTERACTIVE]: 'accept',
      [TYPES.RANK]: 'reject',
      [TYPES.WHATS_NEW]: 'accept',
      unrelated: 'ban',
    },
  } });
  const rejected = await checking;
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(rejected.itemSettings, {
    [TYPES.INTERACTIVE]: 'accept',
    [TYPES.RANK]: 'reject',
    [TYPES.WHATS_NEW]: 'accept',
  });

  const bannedCheck = h.subscription.refresh();
  h.pending.setting[1].success({ subscriptionsSetting: {
    mainSwitch: true,
    itemSettings: { [TYPES.INTERACTIVE]: 'accept', [TYPES.RANK]: 'ban', [TYPES.WHATS_NEW]: 'accept' },
  } });
  assert.equal((await bannedCheck).status, 'banned');

  const acceptedCheck = h.subscription.refresh();
  h.pending.setting[2].success({ subscriptionsSetting: {
    mainSwitch: true,
    itemSettings: { [TYPES.INTERACTIVE]: 'accept', [TYPES.RANK]: 'accept', [TYPES.WHATS_NEW]: 'accept' },
  } });
  assert.equal((await acceptedCheck).status, 'accepted');

  const disabledCheck = h.subscription.refresh();
  h.pending.setting[3].success({ subscriptionsSetting: { mainSwitch: false, itemSettings: {} } });
  assert.equal((await disabledCheck).status, 'disabled');
});

test('a missing persistent item setting remains idle instead of becoming a rejection', async () => {
  const h = setup([TYPES.RANK]);
  for (const result of [
    {},
    { subscriptionsSetting: { mainSwitch: true } },
    { subscriptionsSetting: { mainSwitch: true, itemSettings: {} } },
    { subscriptionsSetting: { mainSwitch: true, itemSettings: { [TYPES.RANK]: 'unknown' } } },
  ]) {
    const checking = h.subscription.refresh();
    h.pending.setting.at(-1).success(result);
    const state = await checking;
    assert.equal(state.status, 'idle');
    assert.deepEqual(state.itemSettings, {});
  }
});

test('silent refresh keeps a known acceptance unless WeChat explicitly revokes or blocks it', async () => {
  const h = setup([TYPES.RANK]);
  const request = h.subscription.request();
  h.pending.request[0].success({ [TYPES.RANK]: 'accept' });
  assert.equal((await request).status, 'accepted');

  for (const result of [
    {},
    { subscriptionsSetting: { mainSwitch: true } },
    { subscriptionsSetting: { mainSwitch: true, itemSettings: {} } },
  ]) {
    const refresh = h.subscription.refresh();
    assert.equal(h.subscription.getState().status, 'accepted', 'a silent recheck cannot briefly restore the reminder entry');
    h.pending.setting.at(-1).success(result);
    const state = await refresh;
    assert.equal(state.status, 'accepted');
    assert.equal(state.itemSettings[TYPES.RANK], 'accept');
  }

  const failed = h.subscription.refresh();
  h.pending.setting.at(-1).fail({ errCode: -1, errMsg: 'temporary failure' });
  assert.equal((await failed).status, 'accepted');

  const disabled = h.subscription.refresh();
  h.pending.setting.at(-1).success({ subscriptionsSetting: { mainSwitch: false, itemSettings: {} } });
  assert.equal((await disabled).status, 'disabled');

  const acceptAgain = h.subscription.request();
  h.pending.request.at(-1).success({ [TYPES.RANK]: 'accept' });
  await acceptAgain;
  const rejected = h.subscription.refresh();
  h.pending.setting.at(-1).success({ subscriptionsSetting: {
    mainSwitch: true,
    itemSettings: { [TYPES.RANK]: 'reject' },
  } });
  assert.equal((await rejected).status, 'rejected');

  const acceptedAgain = h.subscription.request();
  h.pending.request.at(-1).success({ [TYPES.RANK]: 'accept' });
  await acceptedAgain;
  const banned = h.subscription.refresh();
  h.pending.setting.at(-1).success({ subscriptionsSetting: {
    mainSwitch: true,
    itemSettings: { [TYPES.RANK]: 'ban' },
  } });
  assert.equal((await banned).status, 'banned');

  let requestOptions;
  const withoutReader = createSystemMessageSubscription({ kind: 'wechat', wx: {
    requestSubscribeSystemMessage(options) { requestOptions = options; },
  } }, [TYPES.RANK]);
  const acceptedWithoutReader = withoutReader.request();
  requestOptions.success({ [TYPES.RANK]: 'accept' });
  await acceptedWithoutReader;
  assert.equal((await withoutReader.refresh()).status, 'accepted');
});

test('request starts natively in the current stack and success is not assumed to mean acceptance', async () => {
  const h = setup([TYPES.INTERACTIVE, TYPES.RANK]);
  const rejectedRequest = h.subscription.request();
  assert.equal(h.calls.length, 1, 'native request starts before request() returns');
  assert.equal(h.calls[0][0], 'request');
  assert.deepEqual(h.calls[0][1].msgTypeList, [TYPES.INTERACTIVE, TYPES.RANK]);
  assert.equal(h.subscription.getState().status, 'requesting');
  h.pending.request[0].success({
    errMsg: 'requestSubscribeSystemMessage:ok',
    [TYPES.INTERACTIVE]: 'accept',
    [TYPES.RANK]: 'reject',
  });
  assert.equal((await rejectedRequest).status, 'rejected');

  const acceptedRequest = h.subscription.request();
  h.pending.request[1].success({ [TYPES.INTERACTIVE]: 'accept', [TYPES.RANK]: 'accept' });
  assert.equal((await acceptedRequest).status, 'accepted');

  const incompleteRequest = h.subscription.request();
  h.pending.request[2].success({ errMsg: 'requestSubscribeSystemMessage:ok' });
  assert.equal((await incompleteRequest).status, 'error');
});

test('documented request errors map to readable Chinese messages and useful states', async () => {
  const expectations = new Map([
    [10001, ['error', '不能为空']],
    [10002, ['error', '获取订阅消息列表失败']],
    [10003, ['error', '订阅请求发送失败']],
    [10004, ['error', '类型无效']],
    [10005, ['error', '保持游戏在前台']],
    [20004, ['disabled', '总开关已关闭']],
    [20005, ['banned', '暂停订阅消息能力']],
  ]);
  const h = setup();
  for (const [errorCode, [status, messagePart]] of expectations) {
    const pending = h.subscription.request();
    h.pending.request.at(-1).fail({ errCode: errorCode, errMsg: 'native English text' });
    const state = await pending;
    assert.equal(state.status, status);
    assert.equal(state.errorCode, errorCode);
    assert.match(state.message, new RegExp(messagePart));
  }
});

test('duplicate flights are shared and a stale refresh cannot overwrite a newer request', async () => {
  const h = setup();
  const refresh = h.subscription.refresh();
  assert.equal(h.subscription.refresh(), refresh);
  assert.equal(h.pending.setting.length, 1);

  const request = h.subscription.request();
  assert.notEqual(request, refresh);
  assert.equal(h.subscription.request(), request);
  assert.equal(h.pending.request.length, 1);
  assert.equal(h.subscription.refresh(), request, 'refresh shares the explicit request while it is active');

  h.pending.setting[0].success({ subscriptionsSetting: {
    mainSwitch: true,
    itemSettings: { [TYPES.RANK]: 'reject' },
  } });
  await refresh;
  assert.equal(h.subscription.getState().status, 'requesting', 'late settings cannot replace the newer request state');

  h.pending.request[0].success({ [TYPES.RANK]: 'accept' });
  assert.equal((await request).status, 'accepted');
  assert.equal(h.subscription.getState().status, 'accepted');
});

test('native promise style, thrown failures, and returned snapshots remain isolated', async () => {
  const promised = createSystemMessageSubscription({ kind: 'wechat', wx: {
    requestSubscribeSystemMessage() { return Promise.resolve({ [TYPES.RANK]: 'ban' }); },
    getSetting() { return Promise.resolve({ subscriptionsSetting: { mainSwitch: true, itemSettings: { [TYPES.RANK]: 'accept' } } }); },
  } }, [TYPES.RANK]);
  assert.equal((await promised.request()).status, 'banned');
  const accepted = await promised.refresh();
  assert.equal(accepted.status, 'accepted');
  accepted.itemSettings[TYPES.RANK] = 'reject';
  accepted.messageTypes.push(TYPES.INTERACTIVE);
  assert.deepEqual(promised.getState().itemSettings, { [TYPES.RANK]: 'accept' });
  assert.deepEqual(promised.getState().messageTypes, [TYPES.RANK]);

  const throwing = createSystemMessageSubscription({ kind: 'wechat', wx: {
    requestSubscribeSystemMessage() { throw { errCode: 10005 }; },
    getSetting() { throw new Error('SDK failure'); },
  } }, [TYPES.RANK]);
  assert.equal((await throwing.request()).errorCode, 10005);
  assert.equal((await throwing.refresh()).status, 'error');
});
