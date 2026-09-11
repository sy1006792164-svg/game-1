'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createFriendLeaderboard, FRIEND_STORAGE_KEY: KEY } = require('../src/friend-leaderboard');
const { LEGACY_KEY, legacyKeyFor, buildRows, parseScore, serializeScore } = require('../open-data/leaderboard-data');
const { createHostedScoreSync } = require('../open-data/hosted-score');
const { createOpenDataLeaderboard } = require('../open-data/index');
const SCOPE = 'scope.WxFriendInteraction', CHANNEL = 'wind-letter-friends-v1';
const tick = () => new Promise(resolve => setImmediate(resolve));
const score = extra => ({ v: 2, stars: 6, completed: 2, turns: 20, name: '送信人甲', avatarUrl: '', ...extra });
const kv = (value, key = KEY) => [{ key, value: JSON.stringify(value) }];
function bridge(extra = {}) {
  const messages = [], authorizations = [], settings = [];
  const context = { canvas: { width: 1, height: 1 }, postMessage: message => messages.push(message) };
  const api = { getOpenDataContext: () => context, authorize: o => authorizations.push(o), openSetting: o => settings.push(o),
    setUserCloudStorage: () => { throw new Error('Main must not write before the child reads hosted history'); } };
  const platform = { kind: 'wechat', wx: api, isDevelopment: false, ...extra };
  const board = createFriendLeaderboard(platform, {}, { canSync: extra.canSync || (() => true) });
  const open = async () => { const opening = board.open({ width: 354, height: 400, pixelRatio: 2 }); authorizations.at(-1).success(); await opening; };
  return { board, messages, authorizations, settings, context, api, open };
}
function hosted(initial, initialKey = KEY) {
  let stored = initial ? kv(initial, initialKey) : [], failRead = false, failWrite = false;
  const writes = [], changes = [];
  const api = {
    getUserCloudStorage(o) { queueMicrotask(() => failRead ? o.fail({ errMsg: 'offline' }) : o.success({ KVDataList: stored })); },
    setUserCloudStorage(o) { writes.push(o); queueMicrotask(() => { if (failWrite) o.fail({ errMsg: 'offline' }); else { stored = o.KVDataList; o.success(); } }); },
  };
  const sync = createHostedScoreSync(api, { key: () => KEY, onChange: value => changes.push(value) });
  return { sync, api, writes, changes, current: () => parseScore(stored), failRead: value => { failRead = value; }, failWrite: value => { failWrite = value; } };
}
function drawing() {
  const labels = [], frameLabels = [], ctx = new Proxy({
    clearRect: () => { frameLabels.length = 0; },
    fillText: text => { labels.push(String(text)); frameLabels.push(String(text)); },
    measureText: value => ({ width: Array.from(String(value)).length * 8 }) }, { get: (target, name) => target[name] || (() => {}) });
  const requests = { friends: [], mine: [], identity: [], writes: [] };
  const canvas = { width: 708, height: 800, getContext: () => ctx };
  const api = { getSharedCanvas: () => canvas, onMessage: cb => { api.message = cb; },
    getFriendCloudStorage: o => requests.friends.push(o), getUserCloudStorage: o => requests.mine.push(o),
    getUserInfo: o => requests.identity.push(o), setUserCloudStorage: o => requests.writes.push(o) };
  createOpenDataLeaderboard(api);
  return { api, requests, labels, frameLabels, send: value => api.message({ channel: CHANNEL, ...value }) };
}
test('browser never invokes WeChat and new players do not create zero-score rankings', async () => {
  const h = bridge({ kind: 'browser' });
  assert.equal((await h.board.open()).status, 'unavailable');
  assert.equal(await h.board.submit(score()), false);
  assert.equal(await h.board.submit(score({ stars: 0, completed: 0, turns: 0 })), false);
  assert.equal(h.messages.length, 0);
});
test('submit caches local aggregates until privacy and native friend permission both allow syncing', async () => {
  let allowed = false; const h = bridge({ canSync: () => allowed });
  assert.equal(await h.board.submit(score()), false); assert.equal(h.messages.length, 0);
  await h.open(); assert.equal(h.messages.some(m => m.action === 'submit'), false);
  assert.equal(h.board.getState().syncPending, true);
  allowed = true; h.board.retry();
  const message = h.messages.find(m => m.action === 'submit');
  assert.equal(message.score.stars, 6); assert.equal(message.score.v, 2);
  assert.equal('selfId' in message.score, false); assert.equal('openid' in message.score, false);
  assert.equal(h.board.getState().syncStatus, 'delegated'); assert.equal(h.board.getState().syncPending, false);
  h.board.close();
});
test('permission gate defaults to closed when the caller does not provide canSync', async () => {
  const h = bridge(), board = createFriendLeaderboard({ kind: 'wechat', wx: h.api }, {});
  const opening = board.open(); h.authorizations[0].success(); await opening;
  assert.equal(await board.submit(score()), false); assert.equal(h.messages.some(m => m.action === 'submit'), false); board.close();
});
test('open requests only friend permission and flushes a cached local aggregate after the grant', async () => {
  const h = bridge(); await h.board.submit(score()); await h.open();
  assert.equal(h.authorizations[0].scope, SCOPE);
  assert.equal(h.messages.at(-1).action, 'submit'); assert.equal(h.context.canvas.width, 708);
  const before = h.messages.length; h.board.resize({ width: 354, height: 400, pixelRatio: 2 }); assert.equal(h.messages.length, before);
  h.board.page(-3); assert.equal(h.messages.at(-1).delta, -1);
  const draws = []; assert.equal(h.board.draw({ drawImage: (...args) => draws.push(args) }, 18, 120, 354, 400), true);
  assert.equal(draws[0][0], h.context.canvas); h.board.close();
});
test('native authorization revocation blocks later uploads until explicit settings recovery', async () => {
  const h = bridge(); await h.open(); h.board.close();
  const revoked = h.board.open(); h.authorizations[1].fail(); assert.equal((await revoked).status, 'denied');
  assert.equal(h.messages.at(-1).action, 'close', 'confirmed native refusal clears cached friend rows, not just their pixels');
  await h.board.submit(score()); h.board.retry(); assert.equal(h.messages.some(m => m.action === 'submit'), false);
  const restore = h.board.open(); assert.equal(h.settings.length, 1);
  h.settings[0].success({ authSetting: { [SCOPE]: true } }); await restore;
  assert.equal(h.messages.at(-1).action, 'submit'); h.board.close();
});
test('close cancels late grants, but preserves confirmed permission for later gameplay score submissions', async () => {
  const h = bridge(); const opening = h.board.open(); h.board.close(); h.authorizations[0].success(); await opening;
  assert.equal(h.messages.length, 0);
  await h.open(); h.board.close(); assert.equal(h.messages.at(-1).action, 'hide', 'normal navigation preserves private child cache');
  assert.equal(await h.board.submit(score()), true); assert.equal(h.messages.at(-1).action, 'submit');
  assert.equal(h.board.draw({}, 0, 0, 1, 1), false);
});
test('development runtime uses a distinct native WeChat storage key', async () => {
  const h = bridge({ isDevelopment: true }); await h.open(); await h.board.submit(score());
  assert.equal(h.messages.at(-1).key, KEY + '_development'); h.board.close();
});
test('the production ranking key satisfies the immutable MP identifier rules and maps both legacy environments', () => {
  assert.match(KEY, /^[A-Za-z]{1,8}$/);
  assert.equal(legacyKeyFor(KEY), LEGACY_KEY);
  assert.equal(legacyKeyFor(KEY + '_development'), LEGACY_KEY + '_development');
  assert.equal(legacyKeyFor('another'), '');
});

test('read-only permission revocation closes friend data and a later confirmed grant reopens its canvas', async () => {
  const h = bridge(); await h.open();
  assert.equal(h.board.revalidate({ [SCOPE]: false }), false);
  assert.equal(h.messages.at(-1).action, 'close'); assert.equal(h.board.getState().status, 'denied');
  await h.board.submit(score()); assert.equal(h.board.refresh(), false);
  assert.equal(h.board.revalidate({ [SCOPE]: true }), true);
  assert.equal(h.messages.at(-1).action, 'open'); assert.equal(h.board.getState().status, 'ready');
  h.board.refresh(); assert.ok(h.messages.some(message => message.action === 'submit')); h.board.close();
});

test('a foreground settings snapshot cannot cancel an in-progress friend authorization dialog', async () => {
  const h = bridge(), opening = h.board.open();
  assert.equal(h.board.revalidate({ [SCOPE]: false }), false);
  assert.equal(h.board.getState().status, 'authorizing');
  h.authorizations[0].success(); await opening;
  assert.equal(h.board.getState().status, 'ready'); h.board.close();
});
test('later lower local aggregates do not replace a higher queued or dispatched aggregate', async () => {
  const h = bridge(); await h.open(); await h.board.submit(score({ stars: 9, completed: 3, turns: 30 }));
  await h.board.submit(score()); assert.equal(h.messages.filter(m => m.action === 'submit').length, 1);
  await h.board.submit(score({ stars: 9, completed: 3, turns: 29 })); assert.equal(h.messages.at(-1).score.turns, 29); h.board.close();
});
for (const recovery of ['open', 'revalidate', 'restore']) test('a child-rejected improved score is resent after confirmed ' + recovery, async () => {
  const h = bridge(), child = drawing();
  const previous = score({ stars: 2, completed: 1, turns: 10, ownerToken: 'wl1_' + 'a'.repeat(48) });
  const improved = { ...previous, stars: 3 };
  const stored = new Map([[KEY, serializeScore(previous, KEY)]]);
  child.api.getUserCloudStorage = request => {
    child.requests.mine.push(request);
    queueMicrotask(() => request.success({ KVDataList: request.keyList.filter(key => stored.has(key)).map(key => ({ key, value: stored.get(key) })) }));
  };
  child.api.setUserCloudStorage = request => {
    child.requests.writes.push(request);
    queueMicrotask(() => { request.KVDataList.forEach(item => stored.set(item.key, item.value)); request.success(); });
  };
  h.context.postMessage = message => { h.messages.push(message); child.api.message(message); };
  const current = () => parseScore([{ key: KEY, value: stored.get(KEY) }]);
  const submissions = () => h.messages.filter(message => message.action === 'submit');
  try {
    await h.open(); await h.board.submit(previous); await tick();
    child.requests.friends[0].fail({ errMsg: 'getFriendCloudStorage:fail auth deny' });
    h.board.close(); await h.board.submit(improved); await tick();
    assert.deepEqual(submissions().map(message => message.score.stars), [2, 3]);
    assert.equal(current().stars, 2, 'the child must not save a score while its permission gate is closed');
    assert.equal(child.requests.writes.length, 0);

    const friendReads = child.requests.friends.length;
    if (recovery === 'open') await h.open();
    else {
      if (recovery === 'restore') h.board.suspend();
      assert.equal(h.board[recovery]({ [SCOPE]: true }), true);
      assert.equal(child.requests.friends.length, friendReads, 'silent recovery must not read friend records');
    }
    await h.board.submit(improved); h.board.retry(); await tick();
    assert.deepEqual(submissions().map(message => message.score.stars), [2, 3, 3]);
    assert.deepEqual([current().stars, current().completed, current().turns], [3, 1, 10]);
    assert.equal(child.requests.writes.length, 1, 'only the improved aggregate is saved');

    await h.board.submit(improved); await h.board.submit(previous); await tick();
    assert.equal(submissions().length, 3, 'unchanged and lower scores remain deduplicated within this session');
    assert.equal(child.requests.writes.length, 1);
  } finally { h.board.revalidate({ [SCOPE]: false }); }
});

test('open data accepts legacy v1 records without trusting or requiring their old selfId', () => {
  assert.equal(parseScore(kv(score({ v: 1, selfId: 'old-hash' }))).stars, 6);
  assert.equal('selfId' in parseScore(kv(score({ v: 1, selfId: 'old-hash' }))), false);
  assert.equal(parseScore(kv(score({ stars: Infinity }))), null);
  assert.equal(parseScore(kv(score({ stars: 0, completed: 0, turns: 0 }))), null);
});
test('hosted values follow the WeChat social ranking schema without losing in-game tie-break fields', () => {
  const updateTime = 1513080573, value = serializeScore(score(), KEY, updateTime), stored = JSON.parse(value);
  assert.deepEqual(stored.wxgame, { score: 6, update_time: updateTime });
  assert.deepEqual({ stars: stored.stars, completed: stored.completed, turns: stored.turns },
    { stars: 6, completed: 2, turns: 20 });
  assert.equal(parseScore([{ key: KEY, value }]).stars, 6);
});
test('own identity uses native openId while equal names and scores remain separate people', () => {
  const friends = [{ openid: 'native-peer', nickname: 'same', KVDataList: kv(score()) }, { openid: 'native-me', nickname: 'same', KVDataList: kv(score()) }];
  const result = buildRows(friends, kv(score()), KEY, { openId: 'native-me', nickName: 'same' });
  assert.equal(result.rows.length, 2); assert.equal(result.rows.filter(r => r.isMe).length, 1);
  assert.equal(result.self.openid, 'native-me'); assert.deepEqual(result.rows.map(r => r.rank), [1, 1]);
});
test('missing native own identity produces an independent own-score card and never guesses a row identity', () => {
  const result = buildRows([{ openid: 'unknown-peer', nickname: '送信人甲', KVDataList: kv(score()) }], kv(score()), KEY, null);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].isMe, false);
  assert.equal(result.self.rank, null); assert.equal(result.self.stars, 6);
});

test('an echoed selfOpenId sentinel cannot manufacture a duplicate person beside the native friend record', () => {
  const value = score({ stars: 3, completed: 1, turns: 4, name: '茶杯' });
  const result = buildRows([{ openid: 'native-account-a', nickname: '茶杯', KVDataList: kv(value) }], kv(value), KEY,
    { openId: 'selfOpenId', nickName: '茶杯' });
  assert.equal(result.rows.length, 1, 'the table count must reflect the native rows, not an extra sentinel identity');
  assert.equal(result.rows[0].openid, 'native-account-a');
  assert.equal(result.rows[0].isMe, false, 'matching public profile and scores is not identity proof');
  assert.equal(result.self.rank, null); assert.equal(result.self.stars, 3);
});

test('an unmatched user-info ID cannot create a synthetic leaderboard row', () => {
  const result = buildRows([{ openid: 'native-account-a', nickname: 'same', KVDataList: kv(score()) }], kv(score()), KEY,
    { openId: 'different-id-space', nickName: 'same' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].isMe, false); assert.equal(result.self.rank, null);
});
test('competition ranks follow the same star/clear/turn comparison using only native rows', () => {
  const friends = [{ openid: 'a', nickname: 'a', KVDataList: kv(score()) }, { openid: 'b', nickname: 'b', KVDataList: kv(score({ stars: 5 })) },
    { openid: 'my-native-id', nickname: 'my-name', KVDataList: kv(score()) }];
  const result = buildRows(friends, kv(score()), KEY, { openId: 'my-native-id', nickName: 'my-name' });
  assert.deepEqual(result.rows.map(r => r.rank), [1, 1, 3]); assert.equal(result.self.rank, 1);
});
test('legacy-key friends stay visible while accounts migrate to the MP-compatible key', () => {
  const legacy = kv(score({ stars: 9, completed: 3, turns: 30 }), LEGACY_KEY);
  const result = buildRows([{ openid: 'native-me', nickname: '旧榜本人', KVDataList: legacy }], legacy, KEY,
    { openId: 'native-me', nickName: '旧榜本人' });
  assert.equal(result.rows.length, 1); assert.equal(result.self.rank, 1); assert.equal(result.self.stars, 9);
});
test('hosted synchronization reads and preserves higher history before writing an older local save', async () => {
  const h = hosted(score({ v: 1, selfId: 'legacy', stars: 30, completed: 10, turns: 100 }), LEGACY_KEY);
  assert.equal(await h.sync.submit(score()), true);
  assert.equal(h.current().stars, 30); assert.equal(h.current().completed, 10);
  const stored = JSON.parse(h.writes[0].KVDataList[0].value);
  assert.equal(stored.selfId, undefined);
  assert.equal(stored.wxgame.score, 30); assert.ok(Number.isSafeInteger(stored.wxgame.update_time));
  assert.equal(h.sync.getState().status, 'saved');
});
test('a better legacy-key aggregate migrates to the new key without being lowered by local progress', async () => {
  const updatedAt = 1513080573;
  const legacy = JSON.parse(serializeScore(score({ stars: 30, completed: 10, turns: 100 }), LEGACY_KEY, updatedAt));
  const h = hosted(legacy, LEGACY_KEY);
  assert.equal(await h.sync.submit(score()), true); assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].KVDataList[0].key, KEY);
  assert.equal(h.current().stars, 30);
  assert.deepEqual(JSON.parse(h.writes[0].KVDataList[0].value).wxgame, { score: 30, update_time: updatedAt });
});
test('unchanged standardized hosted scores keep their update time and avoid redundant writes', async () => {
  for (const updateTime of [0, 1513080573]) {
    const initial = JSON.parse(serializeScore(score({ ownerToken: 'wl1_' + 'a'.repeat(48) }), KEY, updateTime));
    const h = hosted(initial);
    assert.equal(await h.sync.submit(score()), true);
    assert.equal(h.writes.length, 0); assert.equal(h.current().stars, 6);
  }
});
test('a legacy millisecond rank timestamp is repaired to Unix seconds', async () => {
  const initial = JSON.parse(serializeScore(score({ ownerToken: 'wl1_' + 'a'.repeat(48) }), KEY, Date.now()));
  const h = hosted(initial);
  assert.equal(await h.sync.submit(score()), true); assert.equal(h.writes.length, 1);
  const repaired = JSON.parse(h.writes[0].KVDataList[0].value).wxgame.update_time;
  assert.ok(repaired <= Math.floor(Date.now() / 1000)); assert.ok(repaired < initial.wxgame.update_time);
});
test('aggregate comparison never adds independent device totals or silently invents per-level merged progress', async () => {
  const h = hosted(JSON.parse(serializeScore(score({ stars: 20, completed: 10, turns: 100 }), KEY, 1513080573)));
  await h.sync.submit(score({ stars: 21, completed: 7, turns: 80 }));
  assert.equal(h.current().stars, 21); assert.equal(h.current().completed, 7); assert.equal(h.current().turns, 80);
});
test('hosted reads failing never overwrite old records and explicit retry recovers', async () => {
  const h = hosted(JSON.parse(serializeScore(score({ stars: 9, completed: 3, turns: 30 }), KEY, 1513080573))); h.failRead(true);
  assert.equal(await h.sync.submit(score()), false); assert.equal(h.writes.length, 0); assert.equal(h.sync.getState().status, 'error');
  h.failRead(false); assert.equal(await h.sync.retry(), true); assert.equal(h.current().stars, 9);
});
test('unrecognized or malformed ranking values already stored under stars are never overwritten', async () => {
  for (const existing of [
    { unrelated: true },
    score(),
    { ...score(), wxgame: { score: 999, update_time: 1513080573 } },
  ]) {
    const h = hosted(existing);
    assert.equal(await h.sync.submit(score()), false);
    assert.equal(h.writes.length, 0); assert.equal(h.sync.getState().status, 'error');
  }
});
test('failed hosted writes retain the desired aggregate for a later explicit retry', async () => {
  const h = hosted(); h.failWrite(true);
  assert.equal(await h.sync.submit(score()), false); assert.equal(h.current(), null);
  h.failWrite(false); assert.equal(await h.sync.retry(), true); assert.equal(h.current().stars, 6);
});
test('serial writes eventually preserve the latest aggregate submitted while an earlier write is pending', async () => {
  const h = hosted(); const pending = [];
  h.api.setUserCloudStorage = o => pending.push(o);
  h.sync.submit(score()); await tick(); assert.equal(pending.length, 1);
  h.sync.submit(score({ stars: 9, completed: 3, turns: 30 })); assert.equal(pending.length, 1);
  pending[0].success(); await tick(); assert.equal(pending.length, 2);
  assert.equal(JSON.parse(pending[1].KVDataList[0].value).stars, 9);
  pending[1].success(); await tick(); assert.equal(h.sync.getState().hosted.stars, 9);
});
test('hosted key/value stays within the 1024-byte limit when avatar URLs and Unicode nicknames are long', () => {
  const value = serializeScore(score({ name: '信'.repeat(24), avatarUrl: 'https://thirdwx.qlogo.cn/' + 'a'.repeat(970) }), KEY);
  assert.ok(Buffer.byteLength(KEY + value, 'utf8') <= 1024); assert.equal(JSON.parse(value).avatarUrl, '');
});
test('open data resolves my native rank, automatically locates it, scrolls continuously, and ignores late callbacks after close', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const advanceFrames = duration => {
    for (let elapsed = 0; elapsed < duration; elapsed += 16) t.mock.timers.tick(Math.min(16, duration - elapsed));
  };
  const h = drawing(); h.send({ action: 'open', width: 354, height: 280, pixelRatio: 2 });
  assert.deepEqual(h.requests.identity[0].openIdList, ['selfOpenId']);
  h.requests.identity[0].success({ data: [{ openId: 'my-native-id', nickName: '我' }] });
  h.requests.mine[0].success({ KVDataList: kv(score()) });
  const friends = Array.from({ length: 5 }, (_,i) => ({ openid: 'peer-'+i, nickname: '好友'+i, KVDataList: kv(score({ stars: 9, completed: 3 })) }));
  friends.push({ openid: 'my-native-id', nickname: '我', KVDataList: kv(score()) });
  h.requests.friends[0].success({ data: friends });
  assert.ok(h.frameLabels.includes('我的名次  6')); assert.ok(h.frameLabels.includes('6 人'));
  assert.ok(h.frameLabels.includes('好友0')); assert.equal(h.frameLabels.includes('我 · 我'), false);
  advanceFrames(400);
  assert.ok(h.frameLabels.includes('我 · 我'), 'the first successful entry scrolls to my genuine row');
  assert.equal(h.frameLabels.includes('好友0'), false);
  assert.equal(h.labels.some(label => /刷新成绩|上一页|下一页|\d \/ \d/.test(label)), false);
  const rankWrites = h.requests.writes.filter(write => write.KVDataList.some(item => item.key === KEY + '_seen_rank'));
  assert.equal(rankWrites.length, 1);
  assert.deepEqual(JSON.parse(rankWrites[0].KVDataList[0].value), { v: 1, rank: 6, index: 5 });
  assert.equal(h.requests.writes.filter(write => write.KVDataList.some(item => item.key === KEY)).length, 0, 'viewing ranks never writes an aggregate score');
  rankWrites[0].success();
  h.send({ action: 'wheel', delta: -1000 }); advanceFrames(800);
  assert.ok(h.frameLabels.includes('好友0')); assert.equal(h.frameLabels.includes('我 · 我'), false);
  assert.equal(h.frameLabels.includes('定位我'), false, 'manual self-location is removed; scrolling remains available');
  h.send({ action: 'refresh' }); h.send({ action: 'close' }); const count = h.labels.length;
  h.requests.identity[1].success({ data: [{ openId: 'my-native-id' }] });
  h.requests.mine[1].success({ KVDataList: kv(score()) }); h.requests.friends[1].success({ data: friends });
  advanceFrames(1500);
  assert.equal(h.labels.length, count);
});
test('open data submits own storage while closed without reading friends or drawing hidden canvases', async () => {
  const h = drawing(); h.send({ action: 'submit', score: score() });
  assert.equal(h.requests.friends.length, 0); assert.equal(h.requests.identity.length, 0);
  h.requests.mine[0].success({ KVDataList: [] }); await tick();
  const scoreWrites = h.requests.writes.filter(write => write.KVDataList.some(item => item.key === KEY));
  assert.equal(scoreWrites.length, 1); assert.equal(parseScore(scoreWrites[0].KVDataList).stars, 6);
  scoreWrites[0].success(); await tick();
  assert.equal(h.labels.length, 0); assert.equal(h.api.postMessage, undefined);
});

test('a failed native identity lookup still displays the independently read own card when the friend list is empty', () => {
  const h = drawing(); h.send({ action: 'open' });
  h.requests.identity[0].fail({ errMsg: 'identity unavailable' });
  h.requests.mine[0].success({ KVDataList: kv(score()) }); h.requests.friends[0].success({ data: [] });
  assert.ok(h.labels.includes('我的最佳成绩')); assert.ok(h.labels.includes('本人成绩单独展示'));
  assert.ok(['6', '2', '20'].every(value => h.labels.includes(value))); h.send({ action: 'close' });
});

test('a stale identity callback cannot replace the active refresh identity', () => {
  const h = drawing(); h.send({ action: 'open' });
  // Scores finish independently while the first identity response stays late.
  h.requests.mine[0].success({ KVDataList: [] }); h.requests.friends[0].success({ data: [] });
  h.send({ action: 'refresh' });
  h.requests.identity[1].success({ data: [{ openId: 'correct-native-id', nickName: 'Correct' }] });
  h.requests.identity[0].success({ data: [{ openId: 'stale-native-id', nickName: 'Stale' }] });
  h.requests.mine[1].success({ KVDataList: kv(score()) });
  h.requests.friends[1].success({ data: [{ openid: 'correct-native-id', nickname: 'Correct', KVDataList: kv(score()) }] });
  assert.ok(h.labels.includes('1 人')); assert.ok(h.labels.includes('我的名次  1'));
  assert.equal(h.labels.includes('Stale'), false);
  h.send({ action: 'close' });
});

test('a unique account-hosted marker resolves an echoed sentinel without inserting any extra table row', () => {
  const mine = score({ ownerToken: 'wl1_' + 'a'.repeat(48) });
  const peers = [{ openid: 'native-me', nickname: '茶杯', KVDataList: kv(mine) },
    { openid: 'native-peer', nickname: '茶杯', KVDataList: kv(score()) }];
  const result = buildRows(peers, kv(mine), KEY, { openId: 'selfOpenId', nickName: '茶杯' });
  assert.equal(result.rows.length, 2); assert.equal(result.rows.filter(row => row.isMe).length, 1);
  assert.equal(result.self.openid, 'native-me'); assert.equal(result.self.rank, 1);
});

test('conflicting owner markers leave my card independent without guessing which friend is mine', () => {
  const mine = score({ ownerToken: 'wl1_' + 'a'.repeat(48) });
  const result = buildRows(['native-a', 'native-b'].map(openid => ({ openid, nickname: 'same', KVDataList: kv(mine) })), kv(mine), KEY, { openId: 'selfOpenId' });
  assert.equal(result.rows.length, 2); assert.equal(result.rows.some(row => row.isMe), false); assert.equal(result.self.rank, null);
});

test('a real native identity match takes priority over ambiguous or copied display markers', () => {
  const mine = score({ ownerToken: 'wl1_' + 'a'.repeat(48) });
  const result = buildRows(['native-a', 'native-b'].map(openid => ({ openid, nickname: 'same', KVDataList: kv(mine) })), kv(mine), KEY, { openId: 'native-a' });
  assert.equal(result.rows.length, 2); assert.equal(result.rows.filter(row => row.isMe).length, 1); assert.equal(result.self.openid, 'native-a');
});

test('sentinel and blank native IDs never become artificial account keys', () => {
  const friends = ['selfOpenId', 'self', '', ' '].map(openid => ({ openid, nickname: 'same', KVDataList: kv(score()) }));
  for (const openId of ['selfOpenId', 'self', '', ' ']) {
    const result = buildRows(friends, kv(score()), KEY, { openId });
    assert.equal(result.rows.length, 0); assert.equal(result.self.rank, null);
  }
});

test('a new marker is generated only inside hosted storage and cannot be supplied by the main domain', async () => {
  const injected = 'wl1_' + 'f'.repeat(48), h = hosted();
  await h.sync.submit(score({ ownerToken: injected }));
  const stored = h.current(); assert.match(stored.ownerToken, /^wl1_[a-f0-9]{48}$/); assert.notEqual(stored.ownerToken, injected);
  const token = stored.ownerToken;
  await h.sync.submit(score({ stars: 9, completed: 3, turns: 30, ownerToken: injected }));
  assert.equal(h.current().ownerToken, token, 'future writes preserve the marker read from the account-owned record');
});

test('existing account markers survive legacy migration and older-device score submissions', async () => {
  const token = 'wl1_' + 'b'.repeat(48), h = hosted(score({ v: 1, ownerToken: token, selfId: 'old', stars: 9, completed: 3, turns: 30 }), LEGACY_KEY);
  await h.sync.submit(score({ ownerToken: 'wl1_' + 'c'.repeat(48) }));
  assert.equal(h.current().ownerToken, token); assert.equal(h.current().stars, 9); assert.equal('selfId' in h.current(), false);
  assert.ok(Buffer.byteLength(KEY + h.writes[0].KVDataList[0].value, 'utf8') <= 1024);
});

