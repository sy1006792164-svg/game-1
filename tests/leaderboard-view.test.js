'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawLeaderboard, leaderboardRect } = require('../src/leaderboard-view');

function harness(options = {}) {
  const calls = [], events = [], hits = [], buttons = [];
  const r = { H: options.H || 700, scale: options.scale || 1, ox: 9, oy: 26, now: 900, ctx: {},
    wrapLines: value => String(value).split('\n'),
    hit(x, y, w, h, action) { hits.push({ x, y, w, h, action }); },
    button(label, x, y, w, h, action, style) { buttons.push({ label, x, y, w, h, action, style }); },
  };
  for (const method of ['header', 'panel', 'round', 'circle', 'actionIcon', 'icon', 'text', 'label']) {
    r[method] = (...args) => calls.push({ method, args });
  }
  const authorization = options.authorization || { enabled: true, status: 'ready' };
  const friendState = options.friendState || { status: 'ready' };
  const game = {
    development: options.development === true, metrics: { pixelRatio: 3 }, hidden: options.hidden || false, modal: options.modal || null,
    home: () => events.push(['home']), primary: () => events.push(['primary']), openFriendLeaderboard: () => events.push(['friend-open']),
    rankingAuthorization: {
      getState: () => authorization,
      updateButton: (...args) => events.push(['native-button', ...args]),
      open: () => events.push(['authorize']), openSettings: () => events.push(['settings']), openContract: () => events.push(['contract']),
    },
    friendLeaderboard: {
      getState: () => friendState,
      resize: value => events.push(['resize', value]),
      draw: (...args) => events.push(['draw', ...args]),
      tap: (...args) => events.push(['tap', ...args]),
      get friends() { throw new Error('Friend identities must remain in the child'); },
      get rank() { throw new Error('Friend rank must remain in the child'); },
      get count() { throw new Error('Friend count must remain in the child'); },
    },
  };
  drawLeaderboard(r, game);
  return { r, calls, events, hits, buttons, game, labels: calls.filter(call => ['text', 'label'].includes(call.method)).map(call => call.args[0]) };
}

test('ready ranking paints the child without a duplicate host tap target or manual list controls', () => {
  const h = harness({ H: 760, scale: .8 });
  assert.deepEqual(h.events.find(event => event[0] === 'resize'), ['resize', { width: 354, height: 602, pixelRatio: 2 }]);
  assert.deepEqual(h.events.find(event => event[0] === 'draw').slice(2), [18, 120, 354, 602]);
  assert.equal(h.hits.length, 0, 'the full gesture bridge owns shared-canvas taps');
  assert.equal(h.events.some(event => event[0] === 'tap'), false);
  assert.deepEqual(h.buttons, [], 'the ranking has no continue, self-location, refresh or page buttons');
  h.calls.find(call => call.method === 'header').args[2]();
  assert.deepEqual(h.events.at(-1), ['home'], 'the header remains the exit to the home page');
});

test('native profile consent stays aligned with the painted button and respects foreground/modal visibility', () => {
  for (const options of [{}, { hidden: true }, { modal: { kind: 'pause' } }]) {
    const h = harness({ ...options, H: 700, scale: .72, authorization: { enabled: false, status: 'needs-profile', needsProfile: true } });
    const native = h.events.find(event => event[0] === 'native-button');
    assert.deepEqual(native[1], { left: 9 + 55 * .72, top: 26 + 422 * .72, width: 280 * .72, height: 48 * .72 });
    assert.equal(native[2].visible, !options.hidden && !options.modal);
    assert.ok(h.calls.some(call => call.method === 'round' && call.args[0] === 55 && call.args[1] === 422 && call.args[2] === 280 && call.args[3] === 48));
    assert.equal(h.buttons.some(button => button.label === '授权头像昵称并查看'), false, 'consent is handled by the native button, not a canvas imitation');
    h.buttons.find(button => button.label === '隐私保护指引').action();
    h.buttons.find(button => button.label === '暂不授权').action();
    assert.deepEqual(h.events.slice(-2), [['contract'], ['home']]);
  }
});

test('permission checks and loading use the normal ranking skeleton without another authorization waiting card', () => {
  for (const status of ['privacy', 'authorizing', 'loading']) {
    const message = '微信状态：' + status;
    const h = harness({ authorization: { enabled: false, status, message } });
    assert.ok(h.labels.includes('我的邮路')); assert.ok(h.labels.includes('好友成绩'));
    assert.equal(h.labels.includes(message), false);
    assert.equal(h.labels.some(label => /等待.*授权|正在确认微信授权|等待微信隐私确认/.test(label)), false);
    assert.deepEqual(h.buttons, []);
    assert.equal(h.events.some(event => ['draw', 'resize', 'authorize'].includes(event[0])), false, 'cold skeleton does not draw friend data or request consent');
  }
  for (const status of ['authorizing', 'waiting', 'loading']) {
    const message = '好友状态：' + status;
    const h = harness({ friendState: { status, message } });
    assert.ok(h.labels.includes('我的邮路')); assert.ok(h.labels.includes('好友成绩'));
    assert.equal(h.labels.includes(message), false);
    assert.deepEqual(h.buttons, []);
    assert.equal(h.hits.length, 0, 'an unfinished friend surface cannot accept child actions');
    assert.equal(h.events.some(event => ['draw', 'resize'].includes(event[0])), false);
  }
});

test('a previously authorized preview draws cached rankings during a silent recheck without a waiting card', () => {
  const h = harness({ authorization: { enabled: false, canDisplay: true, status: 'authorizing', message: '正在确认微信授权' },
    friendState: { status: 'preview' } });
  assert.deepEqual(h.events.find(event => event[0] === 'resize'), ['resize', { width: 354, height: 542, pixelRatio: 2 }]);
  assert.deepEqual(h.events.find(event => event[0] === 'draw').slice(2), [18, 120, 354, 542]);
  assert.equal(h.labels.some(label => /等待|正在确认微信授权|我的邮路/.test(label)), false, 'cached child replaces both waiting card and empty skeleton');
  assert.deepEqual(h.buttons, []);
  assert.deepEqual(h.events[0], ['native-button', null]);
});

test('authorization recovery keeps explicit settings, retry and friend-consent actions', () => {
  const settings = harness({ authorization: { enabled: false, status: 'denied', canOpenSettings: true, message: '头像权限已关闭' } });
  settings.buttons.find(button => button.label === '去设置授权').action();
  assert.deepEqual(settings.events.at(-1), ['settings']);
  const retry = harness({ authorization: { enabled: false, status: 'error', message: '网络暂不可用' } });
  retry.buttons.find(button => button.label === '重新申请授权').action();
  assert.deepEqual(retry.events.at(-1), ['authorize']);
  const friend = harness({ friendState: { status: 'denied', message: '朋友权限已关闭' } });
  const consent = friend.buttons.find(button => button.label === '去授权');
  assert.equal(consent.w, 206, 'existing integration and accessible target geometry remain valid');
  consent.action(); assert.deepEqual(friend.events.at(-1), ['friend-open']);
});

test('browser unavailable page is truthful and returns home from the header', () => {
  const h = harness({ authorization: { enabled: false, status: 'unavailable', message: '请在微信小游戏中授权并查看排行榜' } });
  assert.ok(h.labels.includes('浏览器中可以完整体验解谜旅程'));
  assert.ok(h.labels.includes('请在微信小游戏中授权并查看排行榜'));
  assert.equal(h.hits.length, 0);
  assert.deepEqual(h.buttons, []);
  assert.equal(h.events.some(event => ['draw', 'resize'].includes(event[0])), false);
  h.calls.find(call => call.method === 'header').args[2]();
  assert.deepEqual(h.events.at(-1), ['home']);
});

test('all ranking states keep content and actions inside the 700-point safe layout', () => {
  const variants = [
    {}, { authorization: { enabled: false, status: 'needs-profile', needsProfile: true } },
    { authorization: { enabled: false, status: 'privacy', message: '等待微信确认' } },
    { authorization: { enabled: false, status: 'unavailable' } },
    { friendState: { status: 'denied' } }, { friendState: { status: 'loading' } },
  ];
  for (const H of [700, 760, 844, 1000]) for (const variant of variants) {
    const h = harness({ ...variant, H, development: true });
    const footer = h.calls.find(call => call.method === 'label');
    assert.equal(footer.args[2], H - 18, 'only a note remains below the full-height ranking');
    assert.equal(h.buttons.some(button => /继续送信|定位我/.test(button.label)), false);
    for (const button of h.buttons) {
      assert.ok(button.x >= 0 && button.x + button.w <= 390);
      assert.ok(button.y >= 0 && button.y + button.h < H - 38, button.label + ' must stay clear of the footer note');
    }
    for (const call of h.calls.filter(call => call.method === 'panel')) {
      assert.ok(call.args[1] + call.args[3] <= H - 38, 'the content card keeps a clear gap above the footer note');
      assert.ok(call.args[3] <= 470, 'consent and error cards do not stretch across a tall screen');
    }
    for (const call of h.calls.filter(call => ['text', 'label'].includes(call.method))) {
      assert.ok(call.args[2] >= 0 && call.args[2] <= H - 10, 'all labels stay in the safe area');
    }
  }
});

test('ranking drawing and gesture bounds reclaim the space previously used by the continue button', () => {
  for (const H of [700, 760, 844, 1000]) {
    const rect = leaderboardRect(H), h = harness({ H });
    assert.deepEqual(rect, { x: 18, y: 120, w: 354, h: H - 158 });
    assert.equal(rect.y + rect.h, H - 38, 'the scroll surface reaches the footer note');
    assert.deepEqual(h.events.find(event => event[0] === 'draw').slice(2), [rect.x, rect.y, rect.w, rect.h]);
  }
});

test('host footer reserves synchronization errors while ranking rules appear only in the header', () => {
  const h = harness({ friendState: { status: 'ready', syncStatus: 'error', syncMessage: '成绩尚未同步，请稍后刷新' } });
  assert.ok(h.labels.includes('成绩尚未同步，请稍后刷新'));
  assert.equal(h.calls.find(call => call.method === 'header').args[0], '好友排行');
  assert.equal(h.calls.find(call => call.method === 'header').args[1], '总星数优先 · 同星比较通关与步数');
  assert.equal(h.labels.some(label => /星星优先|总星数|通关数/.test(label)), false);
});
