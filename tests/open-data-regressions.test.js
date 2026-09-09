'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHostedScoreSync } = require('../open-data/hosted-score');
const { createOpenDataLeaderboard } = require('../open-data/index');
const { DEFAULT_KEY: KEY, parseScore } = require('../open-data/leaderboard-data');
const CHANNEL = 'wind-letter-friends-v1';
const tick = () => new Promise(resolve => setImmediate(resolve));
const score = extra => ({ v: 2, stars: 6, completed: 2, turns: 20, name: '送信人', avatarUrl: '', ...extra });
const kv = (value, key = KEY) => [{ key, value: JSON.stringify(value) }];

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
  const labels = [], requests = { friends: [], mine: [], identity: [] };
  const ctx = new Proxy({ fillText: value => labels.push(String(value)), measureText: value => ({ width: Array.from(String(value)).length * 8 }) },
    { get: (target, name) => target[name] || (() => {}) });
  const canvas = { width: 708, height: 800, getContext: () => ctx };
  const api = { getSharedCanvas: () => canvas, onMessage: callback => { api.message = callback; },
    getFriendCloudStorage: o => requests.friends.push(o), getUserCloudStorage: o => requests.mine.push(o), getUserInfo: o => requests.identity.push(o) };
  createOpenDataLeaderboard(api);
  const send = message => { labels.length = 0; api.message({ channel: CHANNEL, ...message }); };
  const resolve = (index, peers, key = KEY) => {
    requests.identity[index].fail({ errMsg: 'unavailable' }); requests.mine[index].success({ KVDataList: [] });
    requests.friends[index].success({ data: peers.map((name, i) => ({ openid: 'peer-' + i, nickname: name, KVDataList: kv(score(), key) })) });
  };
  return { send, labels, requests, resolve };
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

test('page boundaries clamp after navigation, resizing and a smaller refreshed friend list', () => {
  const h = drawing();
  try {
    h.send({ action: 'open', width: 354, height: 280 }); h.resolve(0, ['甲', '乙', '丙', '丁', '戊']);
    h.send({ action: 'page', delta: -1 }); assert.ok(h.labels.includes('1 / 3 页 · 共 5 人'));
    for (let i = 0; i < 5; i++) h.send({ action: 'page', delta: 1 });
    assert.ok(h.labels.includes('3 / 3 页 · 共 5 人'));
    h.send({ action: 'resize', width: 354, height: 400 }); assert.ok(h.labels.includes('1 / 1 页 · 共 5 人'));
    h.send({ action: 'refresh' }); h.resolve(1, ['甲']); assert.ok(h.labels.includes('1 / 1 页 · 共 1 人'));
  } finally { h.send({ action: 'close' }); }
});
