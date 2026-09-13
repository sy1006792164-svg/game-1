'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHostedScoreSync } = require('../open-data/hosted-score');
const { createOpenDataLeaderboard } = require('../open-data/index');
const { DEFAULT_KEY: KEY, parseScore } = require('../open-data/leaderboard-data');
const CHANNEL = 'wind-letter-friends-v1';
const tick = () => new Promise(resolve => setImmediate(resolve));
const score = extra => ({ v: 2, stars: 6, completed: 2, turns: 20, name: '送信人', avatarUrl: '', ...extra });
const kv = (value, key = KEY) => [{ key, value: JSON.stringify(value) }];
const advance = (t, duration = 2000) => { for (let left = duration; left > 0; left -= 16) t.mock.timers.tick(Math.min(16, left)); };

test('switching storage keys never retries an aggregate from another environment', async () => {
  let key = KEY + '_development';
  const records = new Map(), writes = [];
  const api = {
    getUserCloudStorage(o) { o.success({ KVDataList: records.get(o.keyList[0]) || [] }); },
    setUserCloudStorage(o) { writes.push(o.KVDataList[0]); records.set(o.KVDataList[0].key, o.KVDataList); o.success(); },
  };
  const sync = createHostedScoreSync(api, { key: () => key });
  await sync.submit(score({ stars: 30, completed: 10, turns: 100 }));
  key = KEY;
  assert.equal(sync.getState().hosted, null, 'production must not display the development sync state');
  assert.equal(await sync.retry(), false, 'opening production must not upload cached development progress');
  assert.equal(records.has(KEY), false);
  await sync.submit(score());
  assert.equal(parseScore(records.get(KEY)).stars, 6);
  assert.equal(parseScore(records.get(KEY + '_development'), KEY + '_development').stars, 30);
  assert.equal(writes.length, 2);
});

test('a key change while a write is pending keeps both environments isolated', async () => {
  let key = KEY + '_development';
  const records = new Map(), pending = [];
  const api = {
    getUserCloudStorage(o) { o.success({ KVDataList: records.get(o.keyList[0]) || [] }); },
    setUserCloudStorage(o) { pending.push(o); },
  };
  const sync = createHostedScoreSync(api, { key: () => key });
  const development = sync.submit(score({ stars: 30, completed: 10, turns: 100 }));
  await tick();
  key = KEY;
  const production = sync.submit(score());
  await tick();
  assert.equal(pending.length, 2, 'a pending development request must not consume the production submission');
  for (const request of pending) { records.set(request.KVDataList[0].key, request.KVDataList); request.success(); }
  await Promise.all([development, production]);
  assert.equal(parseScore(records.get(KEY)).stars, 6);
  assert.equal(sync.getState().hosted.stars, 6);
  key = KEY + '_development';
  assert.equal(sync.getState().hosted.stars, 30);
});

test('a timed-out older write completing last is repaired with the newest aggregate', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stored = [];
  const pending = [];
  const api = {
    getUserCloudStorage(o) { o.success({ KVDataList: stored }); },
    setUserCloudStorage(o) { pending.push(o); },
  };
  const finish = request => { stored = request.KVDataList; request.success(); };
  const sync = createHostedScoreSync(api);
  const first = sync.submit(score()); await tick();
  t.mock.timers.tick(12000); assert.equal(await first, false);
  const newest = sync.submit(score({ stars: 9, completed: 3, turns: 30 })); await tick();
  finish(pending[1]); assert.equal(await newest, true); assert.equal(parseScore(stored).stars, 9);
  finish(pending[0]); await tick();
  assert.equal(pending.length, 3, 'the late older value triggers a read-and-merge repair');
  finish(pending[2]); await tick();
  assert.equal(parseScore(stored).stars, 9); assert.equal(sync.getState().hosted.stars, 9);
});

test('late timed-out callbacks repair their original key without changing the visible environment', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let key = KEY + '_development';
  const records = new Map(), pending = [], changes = [];
  const api = {
    getUserCloudStorage(o) { o.success({ KVDataList: records.get(o.keyList[0]) || [] }); },
    setUserCloudStorage(o) { pending.push(o); },
  };
  const finish = request => { records.set(request.KVDataList[0].key, request.KVDataList); request.success(); };
  const sync = createHostedScoreSync(api, { key: () => key, onChange: state => changes.push(state.status) });
  const development = sync.submit(score({ stars: 30, completed: 10, turns: 100 })); await tick();
  t.mock.timers.tick(12000); assert.equal(await development, false);
  key = KEY;
  const production = sync.submit(score()); await tick(); finish(pending[1]); await production;
  const changeCount = changes.length;
  finish(pending[0]); await tick();
  assert.equal(parseScore(records.get(KEY)).stars, 6);
  assert.equal(sync.getState().hosted.stars, 6);
  assert.equal(changes.length, changeCount, 'an inactive environment must not refresh the visible leaderboard');
  key = KEY + '_development'; assert.equal(sync.getState().hosted.stars, 30);
});

function drawing() {
  const labels = [], positions = [], requests = { friends: [], mine: [], identity: [], writes: [] };
  let paints = 0;
  const ctx = new Proxy({
    clearRect: () => { paints++; labels.length = 0; positions.length = 0; },
    fillText: (value, x, y) => { labels.push(String(value)); positions.push({ value: String(value), x, y }); },
    measureText: value => ({ width: Array.from(String(value)).length * 8 }) },
    { get: (target, name) => target[name] || (() => {}) });
  const canvas = { width: 708, height: 800, getContext: () => ctx };
  const api = { getSharedCanvas: () => canvas, onMessage: callback => { api.message = callback; },
    getFriendCloudStorage: o => requests.friends.push(o), getUserCloudStorage: o => requests.mine.push(o), getUserInfo: o => requests.identity.push(o),
    setUserCloudStorage: o => requests.writes.push(o) };
  createOpenDataLeaderboard(api);
  const send = message => api.message({ channel: CHANNEL, ...message });
  const tap = label => {
    const point = positions.find(item => item.value === label); assert.ok(point, 'visible control: ' + label);
    send({ action: 'pointer', phase: 'start', x: point.x, y: point.y });
    send({ action: 'pointer', phase: 'end', x: point.x, y: point.y });
  };
  const resolve = (index, peers, key = KEY) => {
    requests.identity[index].fail({ errMsg: 'unavailable' }); requests.mine[index].success({ KVDataList: [] });
    requests.friends[index].success({ data: peers.map((name, i) => ({ openid: 'peer-' + i, nickname: name, KVDataList: kv(score(), key) })) });
  };
  return { send, labels, positions, requests, resolve, tap,
    paints: () => paints,
    scoreWrites: () => requests.writes.filter(request => request.KVDataList.some(item => item.key === KEY)) };
}

test('changing the displayed storage key invalidates old rows and late refresh callbacks', () => {
  const h = drawing(), development = KEY + '_development';
  try {
    h.send({ action: 'open', key: development }); h.resolve(0, ['开发好友'], development);
    assert.ok(h.labels.includes('开发好友'));
    h.send({ action: 'refresh' });
    h.send({ action: 'resize', key: KEY, width: 354, height: 400 });
    assert.equal(h.labels.includes('开发好友'), false);
    assert.equal(h.requests.friends.length, 3);
    h.resolve(1, ['过期开发好友'], development);
    assert.equal(h.labels.includes('过期开发好友'), false);
    h.resolve(2, ['正式好友']); assert.ok(h.labels.includes('正式好友'));
  } finally { h.send({ action: 'close' }); }
});

test('continuous scroll bounds clamp after scrolling, resizing and a smaller automatically updated list', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = drawing();
  try {
    h.send({ action: 'open', width: 354, height: 280 }); h.resolve(0, ['甲', '乙', '丙', '丁', '戊']);
    h.send({ action: 'scroll', edge: 'start' }); advance(t);
    assert.ok(h.labels.includes('甲')); assert.equal(h.labels.includes('戊'), false);
    h.send({ action: 'scroll', edge: 'end' }); advance(t);
    assert.ok(h.labels.includes('戊')); assert.equal(h.labels.includes('甲'), false);
    const last = h.positions.find(point => point.value === '戊').y;
    h.send({ action: 'wheel', delta: 10000 }); advance(t);
    assert.equal(h.positions.find(point => point.value === '戊').y, last, 'scrolling past the bottom settles at the same row position');
    h.send({ action: 'resize', width: 354, height: 800 });
    assert.ok(['甲', '乙', '丙', '丁', '戊'].every(name => h.labels.includes(name)));
    assert.equal(h.labels.some(label => ['上一页', '下一页', '刷新成绩'].includes(label)), false);
    h.send({ action: 'refresh' }); h.resolve(1, ['甲']);
    assert.ok(h.labels.includes('甲')); assert.ok(h.labels.includes('1 人')); assert.equal(h.labels.includes('乙'), false);
  } finally { h.send({ action: 'close' }); }
});

test('repeated automatic updates share one read, preserve the list and cannot extend its timeout', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = drawing();
  try {
    h.send({ action: 'open' }); h.resolve(0, ['已有好友']);
    h.send({ action: 'refresh' });
    assert.ok(h.labels.includes('已有好友'), 'refreshing keeps the rendered list');
    for (let i = 0; i < 5; i++) h.send({ action: 'refresh' });
    assert.equal(h.requests.friends.length, 2, 'concurrent refreshes do not restart the read');
    t.mock.timers.tick(11000); h.send({ action: 'refresh' }); t.mock.timers.tick(1000);
    assert.ok(h.labels.includes('已有好友'));
    assert.ok(h.labels.includes('更新未成功，已保留上次成绩'));
    assert.equal(h.labels.includes('刷新成绩'), false, 'automatic updates never restore the removed refresh button');
    assert.equal(h.labels.includes('更新中…'), false, 'the original deadline ends the pending read');
    h.send({ action: 'refresh' }); assert.equal(h.requests.friends.length, 3);
    h.resolve(2, ['新到好友']);
    assert.ok(h.labels.includes('新到好友')); assert.equal(h.labels.includes('已有好友'), false);
    h.resolve(1, ['超时旧好友']);
    assert.equal(h.labels.includes('超时旧好友'), false, 'a timed-out read cannot replace the recovered result');
  } finally { h.send({ action: 'close' }); }
});

test('scores render before identity replies and a late native identity adds my rank without adding a person', () => {
  const h = drawing(), mine = score({ name: '茶杯' });
  try {
    h.send({ action: 'open' });
    h.requests.mine[0].success({ KVDataList: kv(mine) });
    h.requests.friends[0].success({ data: ['native-me', 'native-peer'].map(openid => ({ openid, nickname: '茶杯', KVDataList: kv(mine) })) });
    assert.ok(h.labels.includes('2 人')); assert.ok(h.labels.includes('我的最佳成绩'));
    assert.equal(h.labels.some(label => label.startsWith('我的名次')), false, 'matching names and scores are not identity');
    assert.equal(h.labels.includes('更新中…'), false, 'identity cannot keep the completed score read busy');
    assert.equal(h.labels.includes('刷新成绩'), false);
    h.requests.identity[0].success({ data: [{ openId: 'native-me', nickName: '茶杯' }] });
    assert.ok(h.labels.includes('我的名次  1')); assert.ok(h.labels.includes('2 人'));
    assert.equal(h.labels.includes('我的最佳成绩'), false);
  } finally { h.send({ action: 'close' }); }
});

test('a failed friend read preserves the independently loaded personal score and can recover', () => {
  const h = drawing();
  try {
    h.send({ action: 'open' });
    h.requests.mine[0].success({ KVDataList: kv(score()) });
    h.requests.friends[0].fail({ errMsg: 'network unavailable' });
    assert.ok(h.labels.includes('我的最佳成绩'));
    assert.ok(['6', '2', '20'].every(value => h.labels.includes(value)));
    assert.ok(h.labels.includes('好友成绩暂未读取成功，请稍后重试'));
    h.tap('重试'); h.resolve(1, ['归来的好友']);
    assert.ok(h.labels.includes('归来的好友'));
    assert.equal(h.labels.includes('好友成绩暂未读取成功，请稍后重试'), false);
  } finally { h.send({ action: 'close' }); }
});

test('permission rejection clears cached people immediately and requires a new authorized open', () => {
  const h = drawing();
  try {
    h.send({ action: 'open' }); h.resolve(0, ['私密好友']);
    h.send({ action: 'refresh' }); h.requests.friends[1].fail({ errMsg: 'getFriendCloudStorage:fail auth deny' });
    assert.equal(h.labels.includes('私密好友'), false);
    assert.ok(h.labels.includes('朋友信息权限未开启'));
    h.requests.mine[1].success({ KVDataList: kv(score({ name: '迟到本人' })) });
    h.requests.identity[1].success({ data: [{ openId: 'late', nickName: '迟到本人' }] });
    assert.equal(h.labels.includes('迟到本人'), false);
    h.send({ action: 'refresh' }); assert.equal(h.requests.friends.length, 2, 'refresh alone cannot reopen revoked friend data');
    h.send({ action: 'open' }); h.resolve(2, ['再次授权好友']);
    assert.ok(h.labels.includes('再次授权好友'));
  } finally { h.send({ action: 'close' }); }
});

test('a changed saved score queues one follow-up read and an unchanged save causes no extra refresh', async () => {
  const h = drawing();
  try {
    h.send({ action: 'open' });
    h.send({ action: 'submit', score: score() });
    h.requests.mine[1].success({ KVDataList: [] }); await tick();
    h.scoreWrites()[0].success(); await tick();
    assert.equal(h.requests.friends.length, 1, 'saving does not interrupt an active friend read');
    h.requests.mine[0].success({ KVDataList: [] }); h.requests.friends[0].success({ data: [] });
    assert.equal(h.requests.friends.length, 2, 'saved progress gets one read after the earlier snapshot');
    const saved = h.scoreWrites()[0].KVDataList;
    const peers = [{ openid: 'native-me', nickname: '送信人', KVDataList: saved }];
    h.requests.mine[2].success({ KVDataList: saved }); h.requests.friends[1].success({ data: peers });
    h.send({ action: 'refresh' });
    h.requests.mine[3].success({ KVDataList: saved }); await tick();
    h.requests.mine[4].success({ KVDataList: saved }); h.requests.friends[2].success({ data: peers });
    await tick();
    assert.equal(h.scoreWrites().length, 1, 'an unchanged hosted score is not rewritten by separate rank-history storage');
    assert.ok(h.requests.writes.some(request => request.KVDataList[0].key === KEY + '_seen_rank'));
    assert.equal(h.requests.friends.length, 3, 'an unchanged successful retry does not cause a second friend read');
    assert.ok(h.labels.includes('我的名次  1'), 'the native hosted marker still identifies the existing row');
  } finally { h.send({ action: 'close' }); }
});

test('canvas gestures and wheel scroll continuously while invalid input and obsolete controls do nothing', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = drawing();
  try {
    h.send({ action: 'open', width: 354, height: 400 }); h.resolve(0, ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']);
    assert.ok(h.labels.includes('甲')); assert.equal(h.labels.includes('癸'), false);
    h.send({ action: 'pointer', phase: 'start', x: 100, y: 330 }); advance(t, 30);
    h.send({ action: 'pointer', phase: 'move', x: 100, y: 260 });
    advance(t, 16);
    assert.equal(h.labels.includes('甲'), false, 'dragging changes visible rows before release');
    h.send({ action: 'pointer', phase: 'end', x: 100, y: 260 }); advance(t);
    h.send({ action: 'scroll', edge: 'start' }); advance(t);
    const atTop = [...h.labels];
    h.send({ action: 'pointer', phase: 'start', x: -1, y: 260 });
    h.send({ action: 'pointer', phase: 'move', x: 100, y: 150 });
    h.send({ action: 'pointer', phase: 'end', x: 100, y: 150 });
    h.send({ action: 'pointer', phase: 'start', x: NaN, y: 260 });
    h.send({ action: 'wheel', delta: NaN }); h.send({ action: 'page', delta: 1 });
    h.send({ action: 'tap', x: -1, y: -1 }); h.send({ action: 'tap', x: NaN, y: 20 });
    assert.deepEqual(h.labels, atTop);
    h.send({ action: 'wheel', delta: 10000 }); advance(t);
    assert.ok(h.labels.includes('癸')); assert.equal(h.labels.includes('甲'), false);
    assert.equal(h.labels.some(label => ['上一页', '下一页', '刷新成绩'].includes(label)), false);
    assert.equal(h.requests.friends.length, 1, 'scrolling and obsolete controls never refetch the list');
  } finally { h.send({ action: 'close' }); }
});

test('touch frames are coalesced, a held finger stays idle and release retains inertia', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = drawing();
  try {
    h.send({ action: 'open', width: 354, height: 400 });
    h.resolve(0, Array.from({ length: 200 }, (_, i) => '好友' + String(i).padStart(3, '0')));
    advance(t, 32);
    const start = h.paints();
    h.send({ action: 'pointer', phase: 'start', x: 100, y: 330 });
    for (let i = 1; i <= 20; i++) h.send({ action: 'pointer', phase: 'move', x: 100, y: 330 - i });
    assert.equal(h.paints() - start, 1, 'a burst of touch updates shares the next paint');
    advance(t, 16);
    assert.equal(h.paints() - start, 2, 'the queued frame draws the latest finger position');
    const held = h.paints(); advance(t, 5000);
    assert.equal(h.paints(), held, 'a stationary finger needs no repeating frame timer');

    const moving = h.paints();
    for (let i = 1; i <= 60; i++) {
      advance(t, 16);
      h.send({ action: 'pointer', phase: 'move', x: 100, y: 310 - i * 2 });
    }
    assert.ok(h.paints() - moving <= 61, '60 move events must not also produce 60 timer frames');
    const beforeRelease = h.positions.map(point => ({ ...point }));
    h.send({ action: 'pointer', phase: 'end', x: 100, y: 190 }); advance(t, 200);
    assert.notDeepEqual(h.positions, beforeRelease, 'inertial movement continues after release');
    advance(t, 5000);
    const settled = h.paints(); advance(t, 1000);
    assert.equal(h.paints(), settled, 'the timer stops when inertia settles');
  } finally { h.send({ action: 'close' }); }
});

test('queued touch frames cannot survive hide, suspension, close or permission rejection', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (const action of ['hide', 'suspend', 'close', 'denied']) {
    const h = drawing();
    try {
      h.send({ action: 'open', width: 354, height: 400 }); h.resolve(0, ['甲', '乙', '丙', '丁', '戊']);
      h.send({ action: 'pointer', phase: 'start', x: 100, y: 330 });
      h.send({ action: 'pointer', phase: 'move', x: 100, y: 260 });
      if (action === 'denied') {
        h.send({ action: 'refresh' });
        h.requests.friends[1].fail({ errMsg: 'auth deny' });
        assert.equal(h.labels.includes('甲'), false, 'permission rejection removes people immediately');
      } else h.send({ action });
      const paints = h.paints(); advance(t, 1000);
      assert.equal(h.paints(), paints, action + ' cancels the pending draw');
    } finally { h.send({ action: 'close' }); }
  }
});

test('automatic entry uses the real tied row and removed location controls cannot jump the list', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = drawing(), mine = score({ name: '我' });
  try {
    h.send({ action: 'open', width: 354, height: 400 });
    h.requests.identity[0].success({ data: [{ openId: 'z-me', nickName: '我' }] });
    h.requests.mine[0].success({ KVDataList: kv(mine) });
    h.requests.friends[0].success({ data: ['a', 'b', 'c', 'd', 'z-me'].map(openid => ({ openid, nickname: openid, KVDataList: kv(mine) })) });
    assert.ok(h.labels.includes('我的名次  1'), 'all rows tie at first place');
    advance(t);
    assert.ok(h.labels.includes('我 · 我'), 'entering automatically locates the actual final tied row');
    assert.equal(h.labels.includes('定位我'), false);
    h.send({ action: 'scroll', edge: 'start' }); advance(t);
    assert.equal(h.labels.includes('我 · 我'), false);
    assert.equal(h.labels.includes('定位我'), false);
    const atTop = [...h.labels]; h.send({ action: 'tap', x: 317, y: 122 }); advance(t);
    assert.deepEqual(h.labels, atTop, 'the removed button has no hidden tap target');
    h.send({ action: 'scroll', edge: 'end' }); advance(t);
    assert.ok(h.labels.includes('我 · 我'));
    const row = h.positions.find(point => point.value === '我 · 我');
    assert.ok(row.y > 148 && row.y < 372, 'the real row is inside the list viewport');
    assert.equal(h.labels.includes('定位我'), false);
    assert.equal(h.requests.friends.length, 1, 'locating a cached row never refetches friends');
  } finally { h.send({ action: 'close' }); }
});
