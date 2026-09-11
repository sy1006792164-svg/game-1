'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createOpenDataLeaderboard } = require('../open-data/index');
const { DEFAULT_KEY: KEY, serializeScore } = require('../open-data/leaderboard-data');
const { historyKey } = require('../open-data/rank-history');
const score = extra => ({ v: 2, stars: 30, completed: 10, turns: 100, name: '本人', ownerToken: 'wl1_' + 'a'.repeat(48), ...extra });

function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const labels = [], requests = { mine: [], friends: [], identity: [], writes: [] };
  let message, paints = 0;
  const ctx = new Proxy({
    clearRect() { labels.length = 0; paints++; }, fillText: (value, x, y) => labels.push({ value: String(value), x, y }),
    measureText: value => ({ width: String(value).length * 7 })
  }, { get: (o, k) => k in o ? o[k] : () => {} });
  createOpenDataLeaderboard({
    getSharedCanvas: () => ({ width: 708, height: 940, getContext: () => ctx }), onMessage: fn => { message = fn; },
    getUserCloudStorage: o => requests.mine.push(o), getFriendCloudStorage: o => requests.friends.push(o), getUserInfo: o => requests.identity.push(o),
    setUserCloudStorage: o => { requests.writes.push(o); o.success(); }
  });
  const send = value => message({ channel: 'wind-letter-friends-v1', ...value });
  const advance = ms => { for (let elapsed = 0; elapsed < ms; elapsed += 16) t.mock.timers.tick(Math.min(16, ms - elapsed)); };
  function resolve(index, rank) {
    requests.identity[index].success({ data: [{ openId: 'native-me', nickName: '本人' }] });
    requests.mine[index].success({ KVDataList: [{ key: KEY, value: JSON.stringify(score()) }] });
    requests.friends[index].success({ data: Array.from({ length: 12 }, (_, i) => {
      const isMe = i === rank - 1;
      const value = isMe ? score() : score({ stars: i < rank - 1 ? 33 : 27, completed: i < rank - 1 ? 11 : 9, turns: 50 + i, ownerToken: '' });
      return { openid: isMe ? 'native-me' : 'peer-' + i, nickname: isMe ? '本人' : '好友' + i,
        KVDataList: [{ key: KEY, value: JSON.stringify(value) }] };
    }) });
  }
  const open = () => send({ action: 'open', width: 354, height: 470 });
  const counts = () => Object.fromEntries(Object.entries(requests).map(([k, list]) => [k, list.length]));
  const text = () => labels.map(item => item.value);
  const seed = (rank = 8) => { open(); resolve(0, rank); advance(1400); };
  return { send, open, seed, resolve, advance, counts, text, labels, requests, paints: () => paints };
}

test('hide then preview immediately restores private rows without reads, writes or automatic landing', t => {
  const h = harness(t);
  try {
    h.seed(); const before = h.counts();
    h.send({ action: 'hide' }); assert.deepEqual(h.text(), [], 'leaving clears only the shared pixels');
    h.send({ action: 'preview', width: 354, height: 470 });
    assert.ok(h.text().includes('好友0')); assert.ok(h.text().includes('我的名次  8'));
    assert.equal(h.text().some(v => /上升|下降/.test(v)), false);
    assert.deepEqual(h.counts(), before);
    const paints = h.paints(); h.advance(2000); assert.equal(h.paints(), paints, 'preview never settles or observes an old rank');
    h.send({ action: 'resize', width: 350, height: 470 });
    h.send({ action: 'wheel', delta: 300 }); h.advance(700);
    assert.equal(h.text().includes('好友0'), false, 'cached list scrolls normally');
    h.send({ action: 'pointer', phase: 'start', x: 100, y: 360 }); h.advance(32);
    h.send({ action: 'pointer', phase: 'move', x: 100, y: 300 });
    h.send({ action: 'pointer', phase: 'end', x: 100, y: 300 }); h.advance(1500);
    assert.deepEqual(h.counts(), before, 'resizing and scrolling cannot reopen network access');
    h.send({ action: 'preview' }); h.send({ action: 'tap', x: 315, y: 151 }); h.advance(600);
    assert.equal(h.text().includes('我 · 本人'), false, 'the removed location target cannot jump the cached list');
    assert.ok(h.text().includes('好友0'));
    assert.deepEqual(h.counts(), before);
  } finally { h.send({ action: 'close' }); }
});

test('cache preview ignores retry and submit, including the visible error retry target', t => {
  const h = harness(t);
  try {
    h.seed(); h.send({ action: 'refresh' });
    h.requests.mine[1].fail({ errMsg: 'network' }); h.requests.friends[1].fail({ errMsg: 'network' });
    h.send({ action: 'hide' }); h.send({ action: 'preview' });
    assert.ok(h.text().includes('重试')); const before = h.counts();
    h.send({ action: 'retry' }); h.send({ action: 'submit', score: score({ stars: 33, completed: 11 }) });
    h.send({ action: 'tap', x: 315, y: 151 }); h.advance(13000);
    assert.deepEqual(h.counts(), before);
  } finally { h.send({ action: 'close' }); }
});

test('verified open keeps old cards visible while reading fresh rank and retains the correct movement baseline', t => {
  const h = harness(t);
  try {
    h.seed(); h.send({ action: 'hide' }); h.send({ action: 'preview' });
    h.open(); assert.equal(h.requests.friends.length, 2);
    assert.ok(h.text().includes('好友0')); assert.ok(h.text().includes('我的名次  8'));
    h.resolve(1, 2); assert.ok(h.text().includes('↑ 上升 6 名'));
    h.advance(1400); assert.ok(h.text().includes('8 → 2'));
    const writes = h.requests.writes.filter(o => o.KVDataList[0].key === historyKey(KEY));
    assert.equal(writes.length, 2); assert.equal(JSON.parse(writes[1].KVDataList[0].value).rank, 2);
  } finally { h.send({ action: 'close' }); }
});

test('hidden pending responses cannot replace cached cards or write observations', t => {
  const h = harness(t);
  try {
    h.seed(); h.send({ action: 'refresh' }); h.send({ action: 'hide' });
    const before = h.counts(); h.resolve(1, 1); h.advance(13000); h.send({ action: 'preview' });
    assert.ok(h.text().includes('我的名次  8')); assert.deepEqual(h.counts(), before);
  } finally { h.send({ action: 'close' }); }
});

test('suspended preview stays offline until a verified refresh resumes the visit', t => {
  const h = harness(t);
  try {
    h.seed(); h.send({ action: 'suspend' }); h.send({ action: 'preview' }); const before = h.counts();
    h.send({ action: 'retry' }); h.advance(1000); assert.deepEqual(h.counts(), before);
    h.send({ action: 'refresh' }); assert.equal(h.requests.friends.length, 2);
    assert.ok(h.text().includes('我的名次  8')); h.resolve(1, 11);
    assert.ok(h.text().includes('↓ 下降 3 名'));
  } finally { h.send({ action: 'close' }); }
});

test('close and known permission denial erase cached friend rows before another preview', t => {
  for (const action of ['close', 'denied']) {
    const h = harness(t);
    try {
      h.seed();
      if (action === 'close') h.send({ action: 'close' });
      else { h.send({ action: 'refresh' }); h.requests.friends[1].fail({ errMsg: 'permission denied' }); }
      const before = h.counts(); h.send({ action: 'preview' });
      assert.equal(h.text().some(v => /^好友\d/.test(v)), false);
      assert.equal(h.text().includes('我的名次  8'), false); assert.deepEqual(h.counts(), before);
    } finally { h.send({ action: 'close' }); t.mock.timers.reset(); }
  }
});

test('storage key changes clear cached rows without requesting the other environment', t => {
  const h = harness(t);
  try {
    h.seed(); h.send({ action: 'hide' }); h.send({ action: 'preview' }); const before = h.counts();
    h.send({ action: 'resize', key: KEY + '_development', width: 354, height: 470 });
    assert.equal(h.text().some(v => /^好友\d/.test(v)), false); assert.deepEqual(h.counts(), before);
    h.send({ action: 'preview', key: KEY });
    assert.equal(h.text().includes('我的名次  8'), false); assert.deepEqual(h.counts(), before);
  } finally { h.send({ action: 'close' }); }
});

test('a verified foreground can resume score syncing after leaving during a cached preview', async t => {
  const h = harness(t);
  try {
    h.seed(); h.send({ action: 'hide' }); h.send({ action: 'preview' }); h.send({ action: 'hide' });
    const before = h.counts(); h.send({ action: 'validated' });
    assert.deepEqual(h.counts(), before, 'validation only opens the gate, without a background friend read');
    h.send({ action: 'submit', score: score({ stars: 33, completed: 11 }) });
    assert.equal(h.requests.mine.length, before.mine + 1);
    assert.equal(h.requests.friends.length, before.friends);
    h.requests.mine.at(-1).success({ KVDataList: [{ key: KEY, value: serializeScore(score(), KEY) }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(h.requests.writes.some(o => o.KVDataList[0].key === KEY && JSON.parse(o.KVDataList[0].value).stars === 33));
  } finally { h.send({ action: 'close' }); }
});

test('scrolling the cached preview prevents the later verified open from stealing the viewport', t => {
  const h = harness(t);
  try {
    h.seed(); h.send({ action: 'hide' }); h.send({ action: 'preview' });
    h.send({ action: 'wheel', delta: 130 }); h.advance(900);
    h.open(); h.resolve(1, 10); h.advance(1400);
    assert.equal(h.text().includes('我 · 本人'), false, 'verified data cannot jump away from the manually viewed rows');
    assert.ok(h.text().includes('↓ 下降 2 名'));
  } finally { h.send({ action: 'close' }); }
});
