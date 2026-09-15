'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN, CONTENT_VERSION, getLegacyLevel, SPECS, parseLevel } = require('../src/levels');
const { additionsFor, difficultyProfile } = require('../src/difficulty');
const { createState, step, replay, stars } = require('../src/engine');
const { ITEMS } = require('../src/items');

function follow(level, actions = level.solution) {
  let state = createState(level);
  for (const action of actions) {
    assert.equal(state.status, 'playing', `${level.id}: exhausted light`);
    const result = step(level, state, action);
    assert.ok(result.moved, `${level.id}: blocked route`);
    state = result.state;
  }
  return state;
}

test('every route keeps its original shortest witness and v6 objectives while adding practice room', () => {
  for (const current of CAMPAIGN) {
    const legacy = getLegacyLevel(current.id, '5'), previous = getLegacyLevel(current.id, '6');
    assert.deepEqual(current.solution, legacy.solution, `${current.id}: original witness remains intact`);
    assert.equal(current.par, legacy.par, `${current.id}: established shortest lower bound remains intact`);
    for (const field of ['width', 'height', 'walls', 'start', 'exit', 'letters', 'seals', 'lights', 'bridges', 'winds', 'difficultyAdditions']) {
      assert.deepEqual(current[field], previous[field], `${current.id}: v6 ${field} remains intact`);
    }
    assert.ok(current.budget > previous.budget, `${current.id}: the current route restores bounded practice light`);
    for (const kind of ['letters', 'seals']) {
      assert.ok(legacy[kind].every(cell => current[kind].includes(cell)), `${current.id}: existing ${kind} constraints retained`);
      assert.equal(current.difficultyAdditions[kind].length, additionsFor(current.id - 1)[kind]);
      for (const cell of current.difficultyAdditions[kind]) {
        assert.equal(SPECS[current.id - 1][Math.floor(cell / current.width)][cell % current.width], '.',
          `${current.id}: additions cannot obscure a special tile`);
      }
    }
    const objects = [current.start, current.exit, ...current.letters, ...current.seals,
      ...current.lights, ...current.bridges, ...Object.keys(current.winds).map(Number), ...Object.keys(current.supplies || {}).map(Number)];
    assert.equal(new Set(objects).size, objects.length, `${current.id}: all painted objects remain distinct`);
    const final = follow(current);
    assert.equal(final.status, 'won');
    assert.equal(stars(current, final), 3);
    assert.equal(final.itemsUsed, 0);
    assert.equal(final.revived, false);
  }
});

test('all v5 and v6 runs resume with original targets, light, undos and rating without new obligations', () => {
  for (const current of CAMPAIGN) for (const revision of ['5', '6']) {
    const legacy = getLegacyLevel(current.id, revision);
    const partial = legacy.solution.slice(0, Math.floor(legacy.par / 2));
    assert.equal(legacy.revision, revision);
    assert.equal(legacy.letterOrder, undefined);
    assert.equal(legacy.supplies, undefined);
    assert.equal(legacy.experience, undefined);
    assert.equal(createState(legacy).supplies, undefined, 'legacy state shape stays unchanged');
    assert.equal(legacy.undo, legacy.id <= 6 ? 3 : legacy.id <= 18 ? 2 : 1);
    assert.deepEqual(replay(legacy, partial), follow(legacy, partial));
    const final = follow(legacy);
    assert.equal(final.status, 'won');
    assert.equal(stars(legacy, final), 3);
    const expectedReserve = revision === '6' ? legacy.id <= 3 ? 2 : legacy.id <= 18 ? 1 : 0
      : legacy.id <= 3 ? Math.max(4, Math.ceil(legacy.par * .6)) : legacy.id <= 6 ? 3 : legacy.id <= 18 ? 2 : legacy.id <= 300 ? 1 : 0;
    assert.equal(final.energy, expectedReserve, `${legacy.id}/v${revision}: the old exact light margin survives`);
    assert.equal(getLegacyLevel(current.id, CONTENT_VERSION), current);
  }
  assert.deepEqual([1, 4, 7, 19, 301].map(id => getLegacyLevel(id, '5').budget), [8, 18, 25, 25, 46]);
  assert.deepEqual([1, 4, 7, 19, 301].map(id => getLegacyLevel(id, '6').budget), [6, 16, 24, 24, 46]);
  for (const revision of ['5', '6']) for (const id of [0, -1, 1000, 1.5, '1', null]) assert.equal(getLegacyLevel(id, revision), null);
  assert.equal(getLegacyLevel(1, '4'), null);
});

test('difficulty advice and daily contribution derive from actual mechanics and unlocked supplies', () => {
  assert.equal(difficultyProfile(null), null);
  for (const level of CAMPAIGN) {
    const profile = difficultyProfile(level), final = follow(level);
    assert.deepEqual(profile, level.difficulty);
    assert.equal(profile.reserve, final.energy);
    assert.equal(profile.targetCount, level.letters.length + level.seals.length);
    assert.ok([1, 2, 3].includes(profile.journeyPoints));
    assert.ok(profile.summary.includes(level.letters.length + '信' + level.seals.length + '票'));
    assert.ok(level.brief.includes('本关' + level.letters.length + '信' + level.seals.length + '票'));
    if (profile.recommendedItem) {
      const item = ITEMS.find(item => item.id === profile.recommendedItem);
      assert.ok(item && level.id >= item.unlock, `${level.id}: advice names an unlocked item`);
      if (item.id === 'bridge') assert.ok(level.bridges.length > 0);
      if (item.id === 'echo') {
        assert.ok(level.seals.length > 0);
        assert.ok(profile.timingTargets > 0 || level.seals.length >= 4);
        assert.match(profile.itemReason, /回声还没到时/);
        assert.match(profile.itemReason, /未踩过的票不能选/);
      }
    } else assert.ok(level.id <= 3);
  }
  assert.deepEqual([1, 7, 31, 121, 361, 999].map(id => difficultyProfile(CAMPAIGN[id - 1]).journeyPoints), [1, 1, 2, 2, 3, 3]);
});

test('timing-focused difficulty introduces the flute at 31 and preserves other mechanic priorities', () => {
  const level = { id: 31, budget: 20, par: 20, letters: [1, 2, 3], seals: [4, 5, 6, 7],
    lights: [], bridges: [8, 9, 10], difficultyAdditions: { letters: [], seals: [7], timingSeals: [7] } };
  const timed = difficultyProfile(level);
  assert.equal(timed.recommendedItem, 'echo');
  assert.match(timed.focus, /提前经过/);
  assert.match(timed.itemReason, /先踩过蓝票/);
  assert.equal(difficultyProfile({ ...level, id: 30 }).recommendedItem, 'bridge');
  const noTiming = { ...level, difficultyAdditions: { letters: [], seals: [], timingSeals: [] } };
  assert.equal(difficultyProfile(noTiming).recommendedItem, 'bridge', 'bridge planning stays primary without a timing target');
  assert.equal(difficultyProfile({ ...noTiming, bridges: [] }).recommendedItem, 'echo', 'many blue stamps make echo timing the main challenge');
  assert.equal(difficultyProfile({ ...noTiming, bridges: [], seals: [4] }).recommendedItem, 'kite');
  assert.equal(difficultyProfile({ ...noTiming, bridges: [], seals: [4], letters: [1] }).recommendedItem, 'oil');
});

test('late-route stamps impose an earlier visit because their final pass cannot finish the echo in time', () => {
  let timedRoutes = 0;
  for (const level of CAMPAIGN) {
    const cells = level.difficultyAdditions.timingSeals || [];
    if (!cells.length) continue;
    timedRoutes++;
    const final = follow(level);
    for (const cell of cells) {
      const first = final.history.indexOf(cell), last = final.history.lastIndexOf(cell);
      assert.ok(first >= 0 && first <= level.par - 3, `${level.id}: an earlier visit can stamp in time`);
      assert.ok(last > level.par - 3, `${level.id}: the final visit alone is too late`);
      assert.notEqual(first, last, `${level.id}: must arrange an earlier visit rather than collect on the final pass`);
      assert.ok(level.seals.includes(cell));
    }
    assert.equal(level.difficulty.timingTargets, cells.length);
    assert.match(level.difficulty.focus, /提前经过/);
  }
  assert.ok(timedRoutes > 300, 'hundreds of routes explicitly add a three-turn timing obligation');
});

test('strengthening is deterministic and does not mutate the source map or v5 route', () => {
  for (const id of [1, 6, 31, 301, 999]) {
    const current = CAMPAIGN[id - 1], legacy = getLegacyLevel(id, '5');
    const before = JSON.stringify([SPECS[id - 1], legacy]);
    const code = current.solution.map(action => ({ up: 'U', down: 'D', left: 'L', right: 'R', wait: 'W' })[action]).join('');
    const parsed = parseLevel([current.title, SPECS[id - 1], legacy.brief], id - 1, code);
    assert.deepEqual(parsed, current);
    assert.equal(JSON.stringify([SPECS[id - 1], legacy]), before);
  }
});
