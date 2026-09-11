'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAlbum, STAMPS } = require('../src/stamp-album');
const { CAMPAIGN } = require('../src/levels');
const { getCampaignProgress } = require('../src/campaign-progress');
const { campaignScore } = require('../src/friend-score');
const { createStore } = require('../src/storage');
const { createState, step, revive, replay, stars } = require('../src/engine');

const win = (stars = 3) => ({ stars, bestTurns: 8 });
function withStars(amount) {
  const completed = {};
  for (let id = 1; amount > 0; id += 1) {
    const stars = Math.min(amount, 3);
    completed[id] = win(stars);
    amount -= stars;
  }
  return { completed };
}

test('star thresholds stay reachable and the next stamp advances at every threshold', () => {
  const thresholds = STAMPS.map(stamp => stamp.target);
  assert.deepEqual(thresholds, [1, 3, 9, 18, 30, 48, 72, 100, 135, 175, 220, 280, 350, 430, 520, 620, 730, 850, 980, 1120, 1270, 1430, 1600]);
  assert.equal(STAMPS.length, 23);
  assert.equal(new Set(STAMPS.map(stamp => stamp.id)).size, STAMPS.length);
  assert.ok(thresholds[thresholds.length - 1] <= CAMPAIGN.length * 3 * .7, 'the final stamp must not require near-perfect stars');
  for (const threshold of thresholds) {
    assert.equal(getAlbum(withStars(threshold - 1)).next.target, threshold);
    const next = getAlbum(withStars(threshold)).next;
    assert.equal(next && next.target, thresholds[thresholds.indexOf(threshold) + 1] || null);
  }
});

test('archived daily scores and invalid records cannot earn campaign stamps', () => {
  const empty = getAlbum(undefined);
  assert.equal(empty.ownedCount, 0);
  assert.equal(empty.stars, 0);
  assert.equal(empty.next.id, 'first-wind');
  const album = getAlbum({ completed: { 2: { stars: 99, bestTurns: 1 }, fake: win() }, daily: { '2026-09-07': win(2), bad: win() } });
  assert.equal(album.stars, 0);
  assert.equal(album.ownedCount, 0);
  assert.equal(album.stamps.some(stamp => stamp.id === 'daily-greeting'), false);
  assert.equal(album.next.id, 'first-wind');
});

test('full mastery owns every stamp and leaves no next target', () => {
  const completed = Object.fromEntries(CAMPAIGN.map(level => [level.id, win()]));
  const album = getAlbum({ completed, daily: { '2026-09-07': win() } });
  assert.equal(album.stars, CAMPAIGN.length * 3);
  assert.equal(album.ownedCount, STAMPS.length);
  assert.equal(album.next, null);
});

test('each stamp shows progress since its preceding milestone without changing ownership', () => {
  for (const stamp of STAMPS) {
    const previous = stamp.index ? STAMPS[stamp.index - 1].target : 0;
    for (const total of [0, previous, stamp.target - 1, stamp.target, stamp.target + 3]) {
      const actual = getAlbum(withStars(total)).stamps[stamp.index];
      assert.equal(actual.previousGoal, previous);
      assert.equal(actual.stageGoal, stamp.target - previous);
      assert.equal(actual.stageCurrent, Math.max(0, Math.min(stamp.target - previous, total - previous)));
      assert.equal(actual.remaining, Math.max(0, stamp.target - total));
      assert.equal(actual.owned, total >= stamp.target);
    }
  }
});

test('chapter progress counts valid campaign records and preserves the three-route final chapter', () => {
  const profile = { completed: { 1: win(1), 2: win(2), 3: win(3), 4: { stars: 3 }, 999: win(2),
    1000: win(), old: win(), 5: { stars: 4, bestTurns: 8 } }, daily: { '2026-09-07': win() } };
  const progress = getCampaignProgress(profile);
  assert.equal(progress.completedCount, 4);
  assert.equal(progress.stars, 8);
  assert.equal(progress.perfectCount, 1);
  assert.deepEqual(progress.replayLevels.map(level => level.id), [1, 2, 999]);
  assert.equal(progress.chapters.length, 167);
  const first = progress.chapters[0], last = progress.chapters[166];
  assert.equal(first.stars, 6);
  assert.equal(first.completedCount, 3);
  assert.equal(first.remainingStars, 12);
  assert.equal(first.perfectCount, 1);
  assert.deepEqual([last.firstId, last.lastId, last.count, last.maxStars, last.stars], [997, 999, 3, 9, 2]);
  assert.equal(getCampaignProgress({ completed: Object.create({ 1: win() }) }).stars, 0);
  assert.equal(getCampaignProgress({ completed: [win()] }).completedCount, 0);
});

test('raising a route score earns only the added stars and removes a perfected replay target', () => {
  const profile = { completed: { 1: win(1) } };
  const before = getAlbum(profile);
  profile.completed[1] = win(3);
  const after = getAlbum(profile);
  assert.equal(after.stars - before.stars, 2);
  assert.equal(after.ownedCount, 2);
  assert.equal(after.progress.replayLevels.length, 0);
  assert.equal(after.progress.completedCount, 1);
});

test('all 999 real routes retain their best across upgrades, faster ties, worse repeats and save reloads', () => {
  const completed = {};
  for (const level of CAMPAIGN) {
    const values = new Map(), adapter = {
      get: key => values.get(key),
      set: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))),
      remove: key => values.delete(key)
    };
    let store = createStore(adapter), bestStars = 0, bestTurns = Infinity;
    // Every score comes from an actual finished route. Late boards need a
    // relight after extra waits; do not assume their original light is enough.
    for (const waits of [4, 3, 4, 2, 1, 0, 2, 0]) {
      const actions = [...Array(waits).fill('wait'), ...level.solution], reviveHistory = [];
      let state = createState(level);
      for (const action of actions) {
        if (state.status === 'failed') {
          reviveHistory.push(state.turn);
          state = revive(level, state);
        }
        const result = step(level, state, action);
        assert.equal(result.moved, true, `route ${level.id}, waits ${waits}: valid action`);
        state = result.state;
      }
      assert.equal(state.status, 'won', `route ${level.id}, waits ${waits}: delivery completed`);
      const rating = waits === 0 ? 3 : waits <= 2 ? 2 : 1;
      assert.equal(stars(level, state), rating, `route ${level.id}: total turns and relights determine stars`);
      store.saveRun({ mode: 'campaign', levelId: level.id, revision: level.revision,
        actions, reviveHistory, undosUsed: 0 });
      store = createStore(adapter);
      const saved = store.loadRun();
      assert.deepEqual(replay(level, saved.actions, saved.reviveHistory), state);

      const before = campaignScore(store.getProfile());
      bestStars = Math.max(bestStars, rating); bestTurns = Math.min(bestTurns, state.turn);
      store.recordWin(level.id, rating, state.turn);
      store.clearRun();
      store = createStore(adapter);
      const profile = store.getProfile(), score = campaignScore(profile), album = getAlbum(profile);
      const expected = { stars: bestStars, bestTurns };
      assert.deepEqual(profile.completed[level.id], expected, `route ${level.id}: stored personal best`);
      assert.equal(profile.totalWins, 1, 'repeated delivery never increases the number of wins');
      assert.equal(store.loadRun(), null, 'settled routes stay cleared after a reload');
      assert.equal(score.stars - before.stars, Math.max(0, rating - before.stars));
      assert.equal(score.turns, bestTurns);
      assert.equal(score.completed, 1);
      assert.equal(album.stars, score.stars, 'album and ranking agree after every repeat');
      assert.equal(album.progress.completedCount, score.completed);
      assert.equal(album.progress.perfectCount, bestStars === 3 ? 1 : 0);
      assert.deepEqual(album.progress.replayLevels.map(route => route.id), bestStars < 3 ? [level.id] : []);
      const chapter = album.progress.chapters[level.chapter];
      assert.equal(chapter.stars, bestStars);
      assert.equal(chapter.remainingStars, chapter.maxStars - bestStars);
      completed[level.id] = profile.completed[level.id];
    }
  }
  const score = campaignScore({ completed }), album = getAlbum({ completed });
  assert.deepEqual([score.stars, score.completed, score.turns], [2997, 999, 59240]);
  assert.equal(album.stars, score.stars);
  assert.equal(album.progress.completedCount, 999);
  assert.equal(album.progress.perfectCount, 999);
  assert.equal(album.progress.replayLevels.length, 0);
  assert.equal(album.ownedCount, STAMPS.length);
  assert.ok(album.progress.chapters.every(chapter => chapter.remainingStars === 0));
});
