'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { getProgress, STAMPS } = require('../src/progression');
const { CAMPAIGN } = require('../src/levels');

const win = (stars = 3) => ({ stars, bestTurns: 8 });
const profile = (completed = {}, daily = {}) => ({ completed, daily });

test('a new player gets a reachable first stamp and a clear campaign and daily goal', () => {
  const progress = getProgress(undefined, '2026-09-07');
  assert.equal(progress.stars, 0);
  assert.equal(progress.totalCompleted, 0);
  assert.deepEqual(progress.nextStamp, { name: '第一缕风', current: 0, target: 1 });
  assert.equal(progress.rank.level, 1);
  assert.equal(progress.rank.current, 0);
  assert.equal(progress.rank.target, 12);
  assert.deepEqual(progress.goals.map(goal => goal.action), ['campaign', 'daily']);
  assert.equal(progress.goals[0].detail, '第 1 封 · 第一封信');
  assert.equal(progress.weekly.count, 0);
  assert.equal(progress.weekly.target, 3);
});

test('rank grows from campaign stars alone and old expert tables are ignored', () => {
  const saved = { ...profile({ 1: win(), 2: win(), 3: win(), 4: win() }), expert: { 1: win(), 2: win() } };
  const snapshot = JSON.stringify(saved);
  const progress = getProgress(saved, '2026-09-07');
  assert.equal(progress.stars, 12);
  assert.equal(progress.totalCompleted, 4);
  assert.equal(progress.rank.level, 2, 'twelve stars reach the second rank');
  assert.equal(progress.rank.current, 0);
  assert.equal(progress.rank.target, 24);
  assert.deepEqual(progress.nextStamp, { name: '苔阶来信', current: 12, target: 18 });
  assert.equal('expertCompleted' in progress, false);
  assert.equal(JSON.stringify(saved), snapshot, 'the selector does not change saves');
});

test('the next stamp advances at every collection threshold and the last one stays reachable', () => {
  const thresholds = STAMPS.map(stamp => stamp[1]);
  assert.deepEqual(thresholds, [1, 3, 9, 18, 30, 48, 72, 100, 135, 175, 220]);
  assert.ok(thresholds[thresholds.length - 1] <= CAMPAIGN.length * 3 * .7, 'the final stamp must not require near-perfect stars');
  function savedWithStars(amount) {
    const completed = {};
    for (let id = 1; amount > 0; id += 1) {
      const stars = Math.min(amount, 3);
      completed[id] = win(stars);
      amount -= stars;
    }
    return profile(completed);
  }
  for (const threshold of thresholds) {
    assert.equal(getProgress(savedWithStars(threshold - 1), '2026-09-07').nextStamp.target, threshold);
    const next = getProgress(savedWithStars(threshold), '2026-09-07').nextStamp;
    assert.equal(next ? next.target : null, thresholds[thresholds.indexOf(threshold) + 1] || null);
  }
});

test('the refinement goal points at the first route below three stars', () => {
  const before = getProgress(profile({ 1: win(), 2: win(2) }), '2026-09-07');
  assert.deepEqual(before.goals.map(goal => goal.action), ['campaign', 'daily', 'stars']);
  assert.equal(before.goals.find(goal => goal.action === 'stars').detail, '第 2 封 · 转角的脚步');
  assert.equal(before.goals[0].detail, '第 3 封 · 寄往岔路');
  const perfect = getProgress(profile({ 1: win(), 2: win(), 3: win() }), '2026-09-07');
  assert.deepEqual(perfect.goals.map(goal => goal.action), ['campaign', 'daily']);
  assert.equal(perfect.goals[0].detail, '第 4 封 · 绕行的问候');
});

test('weekly activity counts any three days, ignores previous weeks and future records', () => {
  const daily = {
    '2026-09-06': win(), '2026-09-07': win(), '2026-09-09': win(),
    '2026-09-11': win(), '2026-09-13': win(),
  };
  const progress = getProgress(profile({}, daily), '2026-09-11');
  assert.equal(progress.weekly.count, 3);
  assert.deepEqual(progress.weekly.days.map(day => day.dateKey), [
    '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13',
  ]);
  assert.deepEqual(progress.weekly.days.map(day => day.done), [true, false, true, false, true, false, false]);
  assert.deepEqual(progress.weekly.days.filter(day => day.today).map(day => day.label), ['五']);
  assert.equal(progress.goals.find(goal => goal.action === 'daily').complete, true);
  assert.match(progress.goals.find(goal => goal.action === 'daily').detail, /目标已达成/);
});

test('calendar weeks work on Sunday, leap day and across year boundaries in any local timezone', () => {
  const dates = ['2027-01-03', '2024-02-29', '2026-03-08'];
  const expectedStarts = ['2026-12-28', '2024-02-26', '2026-03-02'];
  dates.forEach((date, index) => {
    const days = getProgress({}, date).weekly.days;
    assert.equal(days[0].dateKey, expectedStarts[index]);
    assert.equal(days.filter(day => day.today).length, 1);
  });
  const modulePath = require.resolve('../src/progression');
  const script = 'const { getProgress } = require(' + JSON.stringify(modulePath) + '); process.stdout.write(JSON.stringify(' + JSON.stringify(dates) + '.map(date => getProgress({}, date).weekly)));';
  const results = ['Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Auckland'].map(TZ =>
    execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.equal(results[0], results[1]);
  assert.equal(results[1], results[2]);
});

test('full mastery has a finite completed rank and no unreachable collection target', () => {
  const completed = Object.fromEntries(CAMPAIGN.map(level => [level.id, win()]));
  const progress = getProgress(profile(completed), '2026-09-07');
  assert.equal(progress.stars, CAMPAIGN.length * 3);
  assert.equal(progress.totalCompleted, CAMPAIGN.length);
  assert.equal(progress.nextStamp, null);
  assert.equal(progress.rank.name, '风笺大师');
  assert.equal(progress.rank.nextName, null);
  assert.equal(progress.rank.current / progress.rank.target, 1);
  assert.ok(progress.goals.length <= 3);
  assert.ok(progress.goals.some(goal => goal.complete && goal.action === 'stars'));
});

test('incomplete old profiles and invalid dates remain deterministic without counting invalid records', () => {
  const saved = { completed: { 1: win(), 2: { stars: 99, bestTurns: 2 }, fake: win() }, totalWins: 900 };
  const first = getProgress(saved, '2026-02-30');
  assert.equal(first.totalCompleted, 1);
  assert.equal(first.stars, 3);
  assert.equal(first.weekly.days.find(day => day.today).dateKey, '1970-01-01');
  assert.deepEqual(first, getProgress(saved, 'invalid'));
});
