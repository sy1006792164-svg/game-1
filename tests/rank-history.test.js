'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRankHistory, historyKey } = require('../open-data/rank-history');
const { DEFAULT_KEY: KEY } = require('../open-data/leaderboard-data');

const value = (rank, index = rank - 1) => ({ v: 1, rank, index });
const entry = (key, data) => ({ key: historyKey(key), value: JSON.stringify(data) });

function harness(t, initial = []) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const storage = new Map(initial.map(item => [item.key, item.value])), writes = [];
  let allowed = true;
  const history = createRankHistory({ setUserCloudStorage: request => writes.push(request) }, () => allowed);
  const succeed = index => {
    const request = writes[index];
    for (const item of request.KVDataList) storage.set(item.key, item.value);
    request.success();
  };
  return { history, writes, storage, succeed,
    allow: next => { allowed = next; },
    stored: key => JSON.parse(storage.get(historyKey(key)) || 'null'),
    written: index => JSON.parse(writes[index].KVDataList[0].value) };
}

test('rank history uses its own storage key and persists only my rank and index without changing score records', t => {
  const scoreRecord = { key: KEY, value: JSON.stringify({ v: 2, stars: 30, completed: 10, turns: 80, ownerToken: 'account-marker' }) };
  const records = [scoreRecord, entry(KEY, value(10))], before = structuredClone(records);
  const h = harness(t, records);
  assert.equal(historyKey(KEY), KEY + '_seen_rank');
  assert.deepEqual(h.history.load(KEY, records), value(10));
  h.history.remember(KEY, { rank: 8, index: 7, openid: 'never-persist-me', nickname: '好友', friends: ['never-persist-a-friend'] });
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].KVDataList, [entry(KEY, value(8))]);
  assert.deepEqual(Object.keys(h.written(0)).sort(), ['index', 'rank', 'v']);
  h.succeed(0);
  assert.deepEqual(h.stored(KEY), value(8));
  assert.equal(h.storage.get(KEY), scoreRecord.value);
  assert.deepEqual(records, before, 'reading ranking history never mutates supplied cloud records');
  const copy = h.history.get(KEY); copy.rank = 99;
  assert.deepEqual(h.history.get(KEY), value(8), 'callers receive an independent baseline snapshot');
});

test('development and production ranking baselines and writes remain isolated', t => {
  const devKey = KEY + '_development', h = harness(t);
  assert.equal(h.history.load(KEY, [entry(devKey, value(2))]), null);
  assert.deepEqual(h.history.load(KEY, [entry(KEY, value(11))]), value(11));
  assert.deepEqual(h.history.load(devKey, [entry(KEY, value(11)), entry(devKey, value(2))]), value(2));
  h.history.remember(KEY, value(8)); h.history.remember(devKey, value(4));
  assert.deepEqual(h.writes.map(write => write.KVDataList[0].key), [historyKey(KEY), historyKey(devKey)]);
  h.succeed(0); h.succeed(1);
  assert.deepEqual(h.history.get(KEY), value(8));
  assert.deepEqual(h.history.get(devKey), value(4));
  assert.deepEqual(h.stored(KEY), value(8)); assert.deepEqual(h.stored(devKey), value(4));
});

test('malformed and out-of-range cloud baselines are ignored', t => {
  const h = harness(t);
  const invalid = [null, {}, [], 7, 'rank', { ...value(2), v: 2 }, { ...value(2), rank: 0 },
    { ...value(2), rank: -1 }, { ...value(2), rank: 1.5 }, { ...value(2), rank: 100001 },
    { ...value(2), rank: '2' }, { ...value(2), rank: null }, { ...value(2), index: -1 },
    { ...value(2), index: 1.5 }, { ...value(2), index: 100000 }, { ...value(2), index: '1' }];
  for (const data of invalid) assert.equal(h.history.load(KEY, [entry(KEY, data)]), null);
  for (const raw of ['{invalid', ' '.repeat(256), JSON.stringify(value(2)) + ' '.repeat(256)]) {
    assert.equal(h.history.load(KEY, [{ key: historyKey(KEY), value: raw }]), null);
  }
  for (const list of [null, {}, [], [{ key: KEY, value: JSON.stringify(value(2)) }]]) assert.equal(h.history.load(KEY, list), null);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.history.load(KEY, [entry(KEY, value(100000, 99999))]), value(100000, 99999));
  assert.equal(historyKey('a'.repeat(118)).length, 128);
  assert.equal(historyKey('a'.repeat(119)), null);
  assert.equal(historyKey(null), null);
});

test('invalid observations cannot replace an existing baseline or cause cloud writes', t => {
  const h = harness(t);
  h.history.load(KEY, [entry(KEY, value(6))]);
  for (const invalid of [{ rank: 0, index: 0 }, { rank: NaN, index: 0 }, { rank: Infinity, index: 0 },
    { rank: 4, index: -1 }, { rank: 4, index: 1.2 }, { v: 2, rank: 4, index: 3 }]) h.history.remember(KEY, invalid);
  assert.deepEqual(h.history.get(KEY), value(6));
  assert.equal(h.writes.length, 0);
});

test('identical loaded, pending and saved observations do not create duplicate writes', t => {
  const h = harness(t);
  h.history.load(KEY, [entry(KEY, value(8))]);
  h.history.remember(KEY, value(8)); assert.equal(h.writes.length, 0);
  h.history.remember(KEY, value(6)); h.history.remember(KEY, value(6));
  assert.equal(h.writes.length, 1);
  h.succeed(0); h.history.remember(KEY, value(6));
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.history.load(KEY, [entry(KEY, value(8))]), value(6), 'a stale later read does not replace the current session observation');
});

test('newer observations wait for the active write and then persist only the latest baseline', t => {
  const h = harness(t);
  h.history.remember(KEY, value(9)); h.history.remember(KEY, value(7)); h.history.remember(KEY, value(4));
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.history.get(KEY), value(4));
  h.succeed(0);
  assert.equal(h.writes.length, 2); assert.deepEqual(h.written(1), value(4));
  h.succeed(1); h.history.remember(KEY, value(4));
  assert.equal(h.writes.length, 2); assert.deepEqual(h.stored(KEY), value(4));
});

test('a failed write preserves the session baseline and retries on the next identical observation', t => {
  const h = harness(t);
  h.history.remember(KEY, value(5)); h.writes[0].fail({ errMsg: 'offline' });
  assert.deepEqual(h.history.get(KEY), value(5));
  t.mock.timers.tick(6000);
  assert.equal(h.writes.length, 1, 'failed writes do not start a background retry loop');
  h.history.remember(KEY, value(5));
  assert.equal(h.writes.length, 2); assert.deepEqual(h.written(1), value(5));
  h.succeed(1); assert.deepEqual(h.stored(KEY), value(5));
});

test('a timed-out write releases the queue and a late older success is repaired with the newest rank', t => {
  const h = harness(t);
  h.history.remember(KEY, value(9)); t.mock.timers.tick(4999);
  h.history.remember(KEY, value(6)); assert.equal(h.writes.length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(h.history.get(KEY), value(6));
  h.history.remember(KEY, value(6)); assert.equal(h.writes.length, 2);
  h.succeed(1); assert.deepEqual(h.stored(KEY), value(6));
  h.succeed(0);
  assert.equal(h.writes.length, 3, 'an old timed-out callback cannot leave an older rank persisted');
  assert.deepEqual(h.written(2), value(6));
  h.succeed(2); assert.deepEqual(h.stored(KEY), value(6));
});

test('a paused old write completing while hidden marks history dirty and repairs it on return', t => {
  const h = harness(t);
  h.history.remember(KEY, value(9));
  h.allow(false); h.history.pause();
  h.allow(true); h.history.remember(KEY, value(5)); h.succeed(1);
  assert.deepEqual(h.stored(KEY), value(5));
  h.allow(false); h.history.pause();
  h.succeed(0);
  assert.deepEqual(h.stored(KEY), value(9), 'the native older write can still physically complete after pause');
  assert.deepEqual(h.history.get(KEY), value(5), 'the session retains the most recently viewed rank');
  assert.equal(h.writes.length, 2, 'hidden data must not trigger a new native write');
  t.mock.timers.tick(6000); assert.equal(h.writes.length, 2);
  h.allow(true); h.history.remember(KEY, value(5));
  assert.equal(h.writes.length, 3, 'returning repairs the baseline even when the observed rank is unchanged');
  assert.deepEqual(h.written(2), value(5));
  h.succeed(2); assert.deepEqual(h.stored(KEY), value(5));
});
