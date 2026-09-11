'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createOpenDataLeaderboard } = require('../open-data/index');
const { DEFAULT_KEY: KEY, LEGACY_KEY, serializeScore } = require('../open-data/leaderboard-data');
const { historyKey } = require('../open-data/rank-history');
const tick = () => new Promise(resolve => setImmediate(resolve));
const score = extra => ({ v: 2, stars: 30, completed: 10, turns: 100, name: '本人', ownerToken: 'wl1_' + 'a'.repeat(48), ...extra });

function harness(t, previous = null, cloud = new Map()) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  if (!cloud.has(KEY)) cloud.set(KEY, serializeScore(score(), KEY, 100));
  if (previous) cloud.set(historyKey(KEY), JSON.stringify({ v: 1, ...previous }));
  const labels = [], requests = { mine: [], friends: [], identity: [], writes: [] };
  let message, paintCount = 0;
  const ctx = new Proxy({
    clearRect() { labels.length = 0; paintCount++; }, fillText: (value, x, y) => labels.push({ value: String(value), x, y }),
    measureText: value => ({ width: String(value).length * 7 })
  }, { get: (o, k) => k in o ? o[k] : () => {} });
  const api = {
    getSharedCanvas: () => ({ width: 708, height: 940, getContext: () => ctx }), onMessage: fn => { message = fn; },
    getUserCloudStorage: o => requests.mine.push(o), getFriendCloudStorage: o => requests.friends.push(o), getUserInfo: o => requests.identity.push(o),
    setUserCloudStorage: o => {
      requests.writes.push(o);
      if (o.KVDataList[0].key.endsWith('_seen_rank')) { for (const item of o.KVDataList) cloud.set(item.key, item.value); o.success(); }
    }
  };
  createOpenDataLeaderboard(api);
  const send = value => message({ channel: 'wind-letter-friends-v1', ...value });
  const advance = ms => { for (let elapsed = 0; elapsed < ms; elapsed += 16) t.mock.timers.tick(Math.min(16, ms - elapsed)); };
  const own = (index, key = KEY) => requests.mine[index].success({ KVDataList: requests.mine[index].keyList.filter(k => cloud.has(k)).map(k => ({ key: k, value: cloud.get(k) })) });
  function friends(index, rank, key = KEY, count = 8) {
    const me = JSON.parse(cloud.get(key));
    requests.friends[index].success({ data: Array.from({ length: count }, (_, i) => {
      const isMe = i === rank - 1, value = isMe ? me : score(i < rank - 1 ? { stars: me.stars + 3, completed: me.completed + 1, turns: 50 + i, ownerToken: '' }
        : { stars: me.stars, completed: me.completed, turns: me.turns + 1 + i, ownerToken: '' });
      return { openid: isMe ? 'native-me' : 'peer-' + i, nickname: isMe ? '本人' : '好友' + i, KVDataList: [{ key, value: JSON.stringify(value) }] };
    }) });
  }
  const identify = index => requests.identity[index].success({ data: [{ openId: 'native-me', nickName: '本人' }] });
  const open = (key = KEY) => send({ action: 'open', key, width: 354, height: 470 });
  const resolve = (index, rank) => { identify(index); own(index); friends(index, rank); };
  const text = () => labels.map(item => item.value);
  return { api, cloud, send, advance, own, friends, identify, open, resolve, text, labels, requests, paints: () => paintCount };
}

test('entry reads automatically and compares persisted own rank in both directions', t => {
  const h = harness(t, { rank: 6, index: 5 });
  try {
    h.open(); assert.equal(h.requests.friends.length, 1); h.resolve(0, 2);
    assert.ok(h.text().includes('↑ 上升 4 名'));
    assert.equal(h.text().filter(v => v === '我 · 本人').length, 1, 'floating own card is never duplicated');
    const start = h.labels.find(v => v.value === '我 · 本人').y;
    h.advance(400); const during = h.labels.find(v => v.value === '我 · 本人').y;
    assert.notEqual(during, start, 'the rendered personal row actually moves');
    h.advance(900); assert.ok(h.text().includes('6 → 2'));
    const before = h.paints(); h.advance(3000); assert.equal(h.paints(), before, 'idle list stops scheduling frames');
    h.send({ action: 'close' }); h.open(); assert.equal(h.requests.friends.length, 2);
    h.resolve(1, 7); assert.ok(h.text().includes('↓ 下降 5 名'));
    h.advance(1400); assert.ok(h.text().includes('2 → 7')); assert.ok(h.text().includes('我 · 本人'));
    assert.deepEqual(JSON.parse(h.cloud.get(historyKey(KEY))), { v: 1, rank: 7, index: 6 });
    assert.equal(JSON.parse(h.cloud.get(KEY)).stars, 30, 'rank snapshots never overwrite gameplay scores');
  } finally { h.send({ action: 'close' }); }
});

test('first visit and unchanged rank never invent movement, but locate the real row', t => {
  const h = harness(t);
  try {
    h.open(); h.resolve(0, 8); h.advance(700);
    assert.ok(h.text().includes('我 · 本人')); assert.equal(h.text().some(v => /上升|下降/.test(v)), false);
    h.send({ action: 'close' }); h.open(); h.resolve(1, 8); h.advance(700);
    assert.equal(h.text().some(v => /上升|下降/.test(v)), false);
    assert.equal(h.requests.writes.filter(o => o.KVDataList[0].key === historyKey(KEY)).length, 1);
  } finally { h.send({ action: 'close' }); }
});

test('a legacy rank snapshot is used once and future snapshots move to the new key', t => {
  const h = harness(t);
  h.cloud.set(historyKey(LEGACY_KEY), JSON.stringify({ v: 1, rank: 6, index: 5 }));
  try {
    h.open();
    assert.ok(h.requests.mine[0].keyList.includes(historyKey(LEGACY_KEY)));
    h.resolve(0, 2); h.advance(1300);
    assert.ok(h.text().includes('↑ 上升 4 名'));
    assert.deepEqual(JSON.parse(h.cloud.get(historyKey(KEY))), { v: 1, rank: 2, index: 1 });
  } finally { h.send({ action: 'close' }); }
});

test('an initial viewport cancellation is not mistaken for a player interrupting the pending entry', t => {
  const h = harness(t, { rank: 2, index: 1 });
  try {
    h.open(); h.send({ action: 'pointer', phase: 'cancel', x: 0, y: 0 });
    h.send({ action: 'resize', width: 354, height: 470 });
    h.resolve(0, 7); const before = h.paints(); h.advance(1200);
    assert.ok(h.paints() > before, 'late rankings still animate after the viewport settles');
    assert.ok(h.text().includes('我 · 本人')); assert.ok(h.text().includes('↓ 下降 5 名'));
  } finally { h.send({ action: 'close' }); }
});

test('manual scrolling before the response prevents the landing animation from stealing control', t => {
  const h = harness(t, { rank: 7, index: 6 });
  try {
    h.open(); h.send({ action: 'pointer', phase: 'start', x: 100, y: 360 });
    h.advance(30); h.send({ action: 'pointer', phase: 'move', x: 100, y: 280 });
    h.send({ action: 'pointer', phase: 'end', x: 100, y: 280 });
    h.resolve(0, 6); const before = h.paints(); h.advance(2000);
    assert.equal(h.paints(), before, 'a late response has no automatic frame loop after manual input');
    assert.equal(h.text().includes('我 · 本人'), false, 'the list is not forced away from the top');
    assert.ok(h.text().includes('↑ 上升 1 名'), 'the actual change is still described honestly');
  } finally { h.send({ action: 'close' }); }
});

test('suspending invalidates pending data and resuming reads fresh without background animation', t => {
  const h = harness(t, { rank: 3, index: 2 });
  try {
    h.open(); h.send({ action: 'suspend' }); const before = h.paints();
    h.resolve(0, 1); h.advance(13000); assert.equal(h.paints(), before);
    assert.equal(h.requests.writes.length, 0, 'an unseen stale response cannot replace the observation');
    h.send({ action: 'refresh' }); assert.equal(h.requests.friends.length, 2);
    h.resolve(1, 6); assert.ok(h.text().includes('↓ 下降 3 名')); h.advance(1200);
    h.send({ action: 'close' }); const stopped = h.paints(); h.advance(3000); assert.equal(h.paints(), stopped);
  } finally { h.send({ action: 'close' }); }
});

test('a still-pending score upload cannot consume the real rank-rise animation', async t => {
  const h = harness(t, { rank: 3, index: 2 });
  try {
    h.open(); h.send({ action: 'submit', score: score({ stars: 36, completed: 12 }) });
    h.own(1); await tick(); assert.equal(h.requests.writes.length, 1);
    h.identify(0); h.own(0); h.friends(0, 3);
    assert.equal(h.requests.writes.some(o => o.KVDataList[0].key === historyKey(KEY)), false, 'old rank is not committed while upload is pending');
    const write = h.requests.writes[0]; for (const item of write.KVDataList) h.cloud.set(item.key, item.value); write.success(); await tick();
    assert.equal(h.requests.friends.length, 2);
    h.identify(1); h.own(2); h.friends(1, 1);
    assert.ok(h.text().includes('↑ 上升 2 名')); h.advance(1300);
    assert.deepEqual(JSON.parse(h.cloud.get(historyKey(KEY))), { v: 1, rank: 1, index: 0 });
  } finally { h.send({ action: 'close' }); }
});
