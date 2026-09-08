'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAlbum, STAMPS } = require('../src/stamp-album');
const { CAMPAIGN } = require('../src/levels');

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
