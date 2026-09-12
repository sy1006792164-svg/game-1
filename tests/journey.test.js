'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { JOURNEY_TARGET, MAX_DAY_POINTS, localDate, journeyPoints, normalizeJourney, addJourneyWin, getJourney } = require('../src/journey');
const { createStore, PROFILE_KEY, RUN_KEY } = require('../src/storage');

const TODAY = '2026-09-12';
const NEXT_DAY = '2026-09-13';
const finish = (store, id, date = TODAY, stars = 3, turns = 100) => store.settleWin(id, stars, turns, 'campaign', { date });
function adapter(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = [], blockedReads = new Set(), blockedWrites = new Set();
  return {
    values, writes, blockedReads, blockedWrites,
    get(key) {
      if (blockedReads.has(key)) throw new Error('temporary read failure');
      return values.has(key) ? structuredClone(values.get(key)) : null;
    },
    set(key, value) {
      writes.push({ key, kind: 'set' });
      if (blockedWrites.has(key)) throw new Error('temporary write failure');
      values.set(key, structuredClone(value));
    },
    remove(key) { writes.push({ key, kind: 'remove' }); values.delete(key); }
  };
}

test('journey dates use the player local calendar and reject impossible dates', () => {
  const local = new Date(2026, 8, 12, 23, 59, 59);
  assert.equal(localDate(local), TODAY);
  assert.equal(localDate(local.getTime()), TODAY);
  assert.equal(localDate('2024-02-29'), '2024-02-29');
  for (const value of ['2026-02-29', '2026-09-31', '2026-9-12', '2026-09-12T00:00:00Z', '', null, {}, new Date(NaN)]) {
    assert.equal(localDate(value), null);
  }
});

test('only real canonical campaign ids determine contribution from content difficulty', () => {
  assert.equal(journeyPoints(1), 1);
  assert.equal(journeyPoints('30'), 1);
  assert.equal(journeyPoints(31), 2);
  assert.equal(journeyPoints(360), 2);
  assert.equal(journeyPoints(361), 3);
  assert.equal(journeyPoints(999), 3);
  for (const id of ['01', '1.0', 'daily', '__proto__', 'constructor', 0, 1000, {}, 1.1, NaN]) assert.equal(journeyPoints(id), 0);
  for (const level of CAMPAIGN) {
    if (level.difficulty) assert.equal(journeyPoints(level.id), level.difficulty.journeyPoints);
  }
});

test('a new profile has a visible target and recommends its first unlocked mainline route', () => {
  const profile = { completed: {} }, before = JSON.stringify(profile);
  assert.deepEqual(getJourney(profile, TODAY), {
    date: TODAY, points: 0, target: JOURNEY_TARGET, done: false, earnedDays: 0, remaining: JOURNEY_TARGET,
    creditedLevelIds: [], candidates: [{ levelId: 1, points: 1, reason: '主线前进' }], nextLevelId: 1
  });
  assert.equal(JSON.stringify(profile), before, 'reading the daily task never grants progress');
});

test('recommendations connect next mainline, missing stars and accessible chapter challenges', () => {
  const completed = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [i + 1, { stars: i === 1 ? 2 : 3, bestTurns: 100 }]));
  const profile = { completed, journey: { earnedDays: 0, days: {} } };
  const task = getJourney(profile, TODAY);
  assert.deepEqual(task.candidates.map(c => [c.levelId, c.reason]), [[7, '主线前进'], [2, '重走摘星'], [6, '章节难关']]);
  profile.journey.days[TODAY] = { 2: 1, 6: 1 };
  assert.deepEqual(getJourney(profile, TODAY).candidates.map(c => c.levelId), [7]);
  profile.completed = { 999: { stars: 1, bestTurns: 100 } };
  assert.deepEqual(getJourney(profile, TODAY).candidates.map(c => c.levelId), [1], 'a malformed gap cannot advertise a locked challenge');
});

test('harder wins fill one daily stamp, and a repeated level cannot credit or award twice', () => {
  let journey;
  for (const id of [1, 31, 361]) journey = addJourneyWin(journey, id, TODAY).journey;
  assert.equal(journey.earnedDays, 1);
  assert.deepEqual(journey.days[TODAY], { 1: 1, 31: 2, 361: 3 });
  const duplicate = addJourneyWin(journey, 361, TODAY);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.stampEarned, false);
  assert.deepEqual(duplicate.journey, journey);
  const next = addJourneyWin(journey, 362, TODAY);
  assert.equal(next.journey.earnedDays, 1);
  assert.equal(next.credited, 3);
  assert.equal(next.stampEarned, false);
  journey = addJourneyWin(next.journey, 361, NEXT_DAY).journey;
  journey = addJourneyWin(journey, 362, NEXT_DAY).journey;
  assert.equal(journey.earnedDays, 2);
});

test('missing a day preserves cumulative stamps and old credited dates cannot award again after pruning', () => {
  let journey;
  for (let i = 0; i < 35; i++) {
    const date = new Date(Date.UTC(2026, 0, i * 2 + 1)).toISOString().slice(0, 10);
    journey = addJourneyWin(journey, 361, date).journey;
    journey = addJourneyWin(journey, 362, date).journey;
  }
  assert.equal(Object.keys(journey.days).length, 30);
  assert.equal(journey.earnedDays, 35);
  assert.equal(journey.archivedThrough, '2026-01-09');
  assert.equal(addJourneyWin(journey, 363, '2026-01-01').changed, false);
  const completed = { 361: { stars: 3 }, 362: { stars: 3 } };
  assert.equal(getJourney({ completed, journey }, '2026-09-30').earnedDays, 35);
  assert.equal(getJourney({ completed, journey }, '2026-09-30').points, 0);
});

test('untrusted daily entries need actual known completed levels and their exact difficulty contribution', () => {
  const input = JSON.parse('{"earnedDays":-4,"days":{"2026-09-12":{"1":99,"31":2,"361":3,"362":3,"01":1,"1000":3,"__proto__":3},"2026-02-30":{"31":2}}}');
  const complete = { 1: { stars: 3 }, 31: { stars: 3 }, 361: { stars: 3 } };
  assert.deepEqual(normalizeJourney(input, complete), { days: { [TODAY]: { 31: 2, 361: 3 } }, earnedDays: 0 });
  let reads = 0;
  const malicious = {};
  Object.defineProperty(malicious, 'days', { enumerable: true, get() { reads++; throw new Error('getter'); } });
  assert.deepEqual(normalizeJourney(malicious), { days: {}, earnedDays: 0 });
  assert.equal(reads, 0);
  assert.equal(Object.prototype[361], undefined);
});

test('a fully populated day remains bounded and never records a partial forged contribution', () => {
  let journey;
  for (const level of CAMPAIGN) journey = addJourneyWin(journey, level.id, TODAY).journey;
  const day = journey.days[TODAY], points = Object.values(day).reduce((sum, value) => sum + value, 0);
  assert.ok(points <= MAX_DAY_POINTS);
  assert.ok(points >= MAX_DAY_POINTS - 2);
  assert.equal(journey.earnedDays, 1);
  for (const [id, contribution] of Object.entries(day)) assert.equal(contribution, journeyPoints(id));
});

test('settlement writes score and daily progress atomically before clearing its run', () => {
  const disk = adapter(), store = createStore(disk);
  store.saveRun({ mode: 'campaign', levelId: 1, actions: [] });
  disk.writes.length = 0;
  assert.equal(finish(store, 1), true);
  assert.deepEqual(disk.writes, [{ key: PROFILE_KEY, kind: 'set' }, { key: RUN_KEY, kind: 'remove' }]);
  const reloaded = createStore(disk).getProfile();
  assert.equal(reloaded.completed[1].stars, 3);
  assert.equal(reloaded.totalWins, 1);
  assert.equal(getJourney(reloaded, TODAY).points, 1);
});

test('replaying to improve stars keeps unique-win totals and daily level deduplication independent', () => {
  const disk = adapter(), store = createStore(disk);
  finish(store, 1, TODAY, 1, 110);
  finish(store, 1, TODAY, 3, 100);
  let profile = store.getProfile();
  assert.deepEqual(profile.completed[1], { stars: 3, bestTurns: 100 });
  assert.equal(profile.totalWins, 1);
  assert.equal(getJourney(profile, TODAY).points, 1);
  finish(store, 1, NEXT_DAY, 2, 120);
  profile = createStore(disk).getProfile();
  assert.equal(profile.totalWins, 1);
  assert.equal(getJourney(profile, NEXT_DAY).points, 1);
  assert.deepEqual(profile.completed[1], { stars: 3, bestTurns: 100 });
});

test('the supplemental recorder rejects uncompleted or unknown levels and cannot accept caller-supplied points', () => {
  const disk = adapter(), store = createStore(disk);
  store.recordJourneyWin(361, TODAY, 999);
  assert.equal(store.getProfile().journey, undefined);
  store.recordWin(361, 3, 100);
  store.recordJourneyWin(361, TODAY, 999);
  store.recordWin('fake_level', 3, 100);
  store.recordJourneyWin('fake_level', TODAY, 3);
  assert.deepEqual(store.getProfile().journey.days[TODAY], { 361: 3 });
  assert.equal(getJourney(store.getProfile(), TODAY).points, 3);
});

test('invalid settlement dates, results and retired modes preserve the route and do not grant stamps', () => {
  const disk = adapter(), store = createStore(disk), run = { mode: 'campaign', levelId: 1, actions: [] };
  store.saveRun(run);
  for (const args of [[1, 3, 10, 'campaign', { date: '2026-02-30' }], [1, 3, 10, 'daily', { date: TODAY }],
    [1, 0, 10, 'campaign', { date: TODAY }], [1, 3, 10, 'campaign', '2026-09-12']]) {
    assert.equal(store.settleWin(...args), false);
    assert.deepEqual(store.loadRun(), run);
    assert.equal(store.getProfile().journey, undefined);
  }
});

test('write failure retains both score and daily stamp in memory, then recovers once without duplicate rewards', () => {
  const disk = adapter(), store = createStore(disk);
  store.saveRun({ mode: 'campaign', levelId: 361, actions: [] });
  disk.blockedWrites.add(PROFILE_KEY);
  assert.equal(finish(store, 361), false);
  assert.equal(finish(store, 362), false);
  assert.equal(getJourney(store.getProfile(), TODAY).earnedDays, 1);
  assert.equal(store.getStatus().persisted, false);
  assert.ok(disk.get(RUN_KEY), 'the recoverable run stays until its combined settlement is durable');
  disk.blockedWrites.clear();
  assert.equal(store.flush(), true);
  assert.equal(getJourney(createStore(disk).getProfile(), TODAY).earnedDays, 1);
  assert.equal(createStore(disk).loadRun(), null);
  assert.equal(store.flush(), true);
  assert.equal(getJourney(createStore(disk).getProfile(), TODAY).earnedDays, 1);
});

test('failed read recovery merges same-day partial wins and counts its newly completed stamp once', () => {
  const disk = adapter(), old = createStore(disk);
  finish(old, 361, '2026-09-01'); finish(old, 362, '2026-09-01');
  finish(old, 361, TODAY);
  disk.blockedReads.add(PROFILE_KEY);
  const store = createStore(disk);
  finish(store, 362, TODAY);
  assert.equal(getJourney(store.getProfile(), TODAY).earnedDays, 0);
  disk.blockedReads.clear();
  assert.equal(store.flush(), true);
  const task = getJourney(createStore(disk).getProfile(), TODAY);
  assert.equal(task.points, 6);
  assert.equal(task.earnedDays, 2);
  assert.deepEqual(task.creditedLevelIds, [361, 362]);
});

test('read recovery deduplicates a day that both the old save and offline play already completed', () => {
  const disk = adapter(), old = createStore(disk);
  finish(old, 361); finish(old, 362);
  disk.blockedReads.add(PROFILE_KEY);
  const store = createStore(disk);
  finish(store, 361); finish(store, 362); finish(store, 363);
  disk.blockedReads.clear();
  assert.equal(store.flush(), true);
  const task = getJourney(createStore(disk).getProfile(), TODAY);
  assert.equal(task.points, 9);
  assert.equal(task.earnedDays, 1);
});

test('reset clears daily progress and pending read operations along with the existing campaign save', () => {
  const disk = adapter(), store = createStore(disk);
  finish(store, 361); finish(store, 362);
  disk.blockedReads.add(PROFILE_KEY);
  const recovering = createStore(disk);
  finish(recovering, 363);
  assert.equal(recovering.reset(), true);
  disk.blockedReads.clear();
  recovering.flush();
  const profile = createStore(disk).getProfile();
  assert.deepEqual(profile.completed, {});
  assert.equal(getJourney(profile, TODAY).earnedDays, 0);
});

test('30 bounded daily ledgers coexist with all campaign and archived daily scores in a durable save', () => {
  const completed = Object.fromEntries(CAMPAIGN.map(level => [level.id, { stars: 3, bestTurns: 100 }]));
  const daily = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [
    new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), { stars: 3, bestTurns: 100 }
  ]));
  let oneDay;
  for (const level of CAMPAIGN) oneDay = addJourneyWin(oneDay, level.id, TODAY).journey;
  const days = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [
    new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10), { ...oneDay.days[TODAY] }
  ]));
  const disk = adapter({ [PROFILE_KEY]: { version: 1, completed, daily, journey: { days, earnedDays: 40 } } });
  const store = createStore(disk);
  assert.equal(store.getStatus().persisted, true);
  assert.equal(store.getProfile().totalWins, 1999);
  assert.equal(Object.keys(store.getProfile().journey.days).length, 30);
  store.updateSettings({ sound: false });
  const reloaded = createStore(disk).getProfile();
  assert.equal(reloaded.journey.earnedDays, 40);
  assert.equal(Object.keys(reloaded.completed).length, 999);
  assert.equal(Object.keys(reloaded.daily).length, 1000);
  assert.equal(reloaded.settings.sound, false);
});
