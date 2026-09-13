'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, step, stars } = require('../src/engine');
const { itemOffer } = require('../src/items');
const { SUPPLY_ENERGY } = require('../src/supply-rules');
const { supplyAdvice, preparationAdvice } = require('../src/supply-advice');

function board(overrides = {}) {
  return { id: 16, width: 5, height: 4, start: 6, exit: 19, letters: [18], seals: [],
    lights: [], bridges: [], walls: [], winds: {}, budget: 30, par: 6, ...overrides };
}

function playing(level, overrides = {}) {
  return { ...createState(level), turn: 4, history: [level.start, level.start, level.start, level.start, level.start], ...overrides };
}

test('failed, won and locked routes do not recommend unusable supplies', () => {
  const level = board();
  for (const status of ['failed', 'won']) assert.equal(supplyAdvice(level, playing(level, { status, energy: 1 })), null);
  const locked = board({ id: 3 });
  assert.equal(supplyAdvice(locked, playing(locked, { energy: 1 })), null);
  assert.equal(supplyAdvice(null, null), null);
  assert.equal(preparationAdvice(locked).itemId, null);
});

test('a relevant adjacent torn bridge outranks low oil and a kite', () => {
  const level = board({ width: 5, height: 1, start: 1, exit: 4, bridges: [2], letters: [3] });
  const state = playing(level, { bridges: [], energy: 3 });
  const advice = supplyAdvice(level, state);
  assert.equal(advice.itemId, 'bridge');
  assert.match(advice.reason, /相邻断桥/);
  assert.match(advice.reason, /可能/);
  assert.equal(itemOffer(level, state, advice.itemId).eligible, true);
  assert.deepEqual(state.inventory, { oil: 0, kite: 0, bridge: 0 });
});

test('an intact, distant or irrelevant torn bridge does not trigger a repair offer', () => {
  const level = board({ width: 5, height: 1, start: 2, exit: 4, bridges: [1], letters: [3] });
  assert.equal(supplyAdvice(level, playing(level)), null);
  assert.equal(supplyAdvice(level, playing(level, { bridges: [] })), null, 'the remaining objectives lie away from the torn dead end');
  const distant = board({ bridges: [19], letters: [18] });
  assert.equal(supplyAdvice(distant, playing(distant, { bridges: [] })), null);
});

test('a queued echo stamp on an irrelevant broken bridge does not make repair look necessary', () => {
  const level = board({ width: 5, height: 1, start: 2, exit: 4, bridges: [1], letters: [3], seals: [1] });
  const state = playing(level, { bridges: [], history: [2, 1, 1, 2, 2] });
  assert.equal(supplyAdvice(level, state), null);
});

test('kite advice uses current range and actual wall or wind landings', () => {
  const wall = board({ start: 6, letters: [8], walls: [7] });
  const advice = supplyAdvice(wall, playing(wall));
  assert.equal(advice.itemId, 'kite');
  assert.match(advice.reason, /两格内/);
  const wind = board({ start: 6, letters: [7], winds: { 7: 'right' } });
  assert.equal(supplyAdvice(wind, playing(wind)).itemId, 'kite', 'entering the letter cell pushes past it');
  const far = board({ start: 6, letters: [9], walls: [7] });
  assert.equal(supplyAdvice(far, playing(far)), null);
  const locked = { ...wall, id: 6 };
  assert.equal(supplyAdvice(locked, playing(locked)), null);
});

test('kite recommendation disappears when the letter is collected and does not invent a need on an open route', () => {
  const level = board({ letters: [8], walls: [7] });
  assert.equal(supplyAdvice(level, playing(level, { letters: [] })), null);
  const open = board({ letters: [8] });
  assert.equal(supplyAdvice(open, playing(open)), null);
});

test('oil recommendation explains actual light and targets without promising a completed route', () => {
  const level = board();
  const advice = supplyAdvice(level, playing(level, { energy: 6 }));
  assert.equal(advice.itemId, 'oil');
  assert.match(advice.reason, /余下6拍/);
  assert.ok(advice.reason.includes('可补' + SUPPLY_ENERGY + '拍'));
  const busy = board({ letters: [10, 15, 18], seals: [4, 14] });
  assert.equal(supplyAdvice(busy, playing(busy, { energy: 10 })).itemId, 'oil');
  assert.equal(supplyAdvice(level, playing(level)), null);
});

test('one ordinary move or echo wait to win suppresses unnecessary supply advice', () => {
  const level = board({ start: 18, letters: [], exit: 19 });
  assert.equal(supplyAdvice(level, playing(level, { energy: 1 })), null);
  const waiting = board({ start: 19, exit: 19, letters: [], seals: [18] });
  const state = playing(waiting, { energy: 1, history: [6, 7, 18, 19, 19] });
  assert.equal(step(waiting, state, 'wait').state.status, 'won');
  assert.equal(supplyAdvice(waiting, state), null);
});

test('the final nearby letter at the post office is an actionable kite opportunity', () => {
  const level = board({ start: 6, exit: 6, letters: [8] });
  const advice = supplyAdvice(level, playing(level));
  assert.equal(advice.itemId, 'kite');
  assert.match(advice.reason, /最后一封信/);
});

test('echo advice saves a final queued stamp only when waiting would exhaust the light', () => {
  const level = board({ id: 31, start: 19, exit: 19, letters: [], seals: [18] });
  const state = playing(level, { history: [6, 7, 9, 18, 19], energy: 1 });
  const before = JSON.stringify(state), advice = supplyAdvice(level, state);
  assert.equal(advice.itemId, 'echo');
  assert.equal(itemOffer(level, state, advice.itemId).eligible, true);
  assert.match(advice.reason, /正常还需等2拍/);
  assert.match(advice.reason, /灯火不足/);
  assert.match(advice.reason, /这一张/);
  assert.match(advice.reason, /不补灯火/);
  assert.match(advice.reason, /最多二星/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(supplyAdvice(level, { ...state, energy: 2 }), null, 'finishing on zero light needs no supply');
});

test('echo advice observes the exact two-star margin rather than pushing supplies for every wait', () => {
  const level = board({ id: 31, start: 19, exit: 19, letters: [], seals: [18], par: 3 });
  const state = playing(level, { history: [6, 7, 9, 18, 19], energy: 20, itemsUsed: 1 });
  const advice = supplyAdvice(level, state);
  assert.equal(advice.itemId, 'echo');
  assert.match(advice.reason, /再等2拍会超出二星步数/);
  assert.equal(supplyAdvice({ ...level, par: 4 }, state), null, 'finishing exactly at par + 2 retains two stars');
  assert.equal(supplyAdvice({ ...level, par: 1 }, state), null, 'an already missed two-star limit cannot be recovered');
  assert.equal(supplyAdvice({ ...level, par: 6 }, state), null, 'waiting on the minimum route can still earn three stars');
  assert.equal(supplyAdvice(level, { ...state, itemsUsed: 0 }), null, 'a rating-only recommendation does not introduce assistance to a clean attempt');
  assert.equal(supplyAdvice(level, { ...state, itemsUsed: 0, revived: true }).itemId, 'echo', 'relighting already makes the route assisted');
});

test('route 53 uses the flute to retain two stars after an earlier oil supply and three extra waits', () => {
  const { CAMPAIGN } = require('../src/levels');
  const level = CAMPAIGN[52];
  let state = createState(level, { oil: 1, echo: 1 });
  for (const action of ['item:oil', 'wait', 'wait', 'wait', ...level.solution.slice(0, 29)]) {
    const next = step(level, state, action);
    assert.equal(next.moved, true);
    state = next.state;
  }
  assert.equal(state.status, 'playing');
  assert.equal(state.turn, 32);
  assert.equal(state.player, level.exit);
  assert.deepEqual(state.letters, []);
  assert.deepEqual(state.seals, [30]);
  assert.equal(supplyAdvice(level, state).itemId, 'echo');
  const normal = step(level, step(level, state, 'wait').state, 'wait').state;
  const assisted = step(level, state, 'item:echo:30').state;
  assert.equal(normal.status, 'won');
  assert.equal(stars(level, normal), 1);
  assert.equal(assisted.status, 'won');
  assert.equal(stars(level, assisted), 2);
});

test('echo advice never outranks an ordinary one-step win, including a final wait', () => {
  const level = board({ id: 31, start: 19, exit: 19, letters: [], seals: [18], par: 2 });
  const state = playing(level, { history: [6, 7, 18, 19, 19], energy: 1 });
  assert.equal(itemOffer(level, state, 'echo').eligible, true);
  assert.equal(supplyAdvice(level, state), null);
  const moving = { ...level, start: 18, seals: [6] };
  const movingState = playing(moving, { history: [6, 7, 6, 8, 18], energy: 1 });
  assert.equal(step(moving, movingState, 'right').state.status, 'won');
  assert.equal(supplyAdvice(moving, movingState), null);
});

test('echo advice respects unlock and queue eligibility and leaves longer routes to oil', () => {
  const level = board({ id: 31, start: 19, exit: 19, letters: [], seals: [18], par: 2 });
  const state = playing(level, { history: [6, 7, 9, 18, 19], energy: 1 });
  assert.equal(supplyAdvice({ ...level, id: 30 }, state).itemId, 'oil');
  assert.equal(supplyAdvice(level, { ...state, history: [6, 7, 9, 9, 19] }).itemId, 'oil', 'a never-visited stamp is not a flute target');
  assert.equal(supplyAdvice(level, { ...state, history: [18, 7, 9, 9, 19] }).itemId, 'oil', 'a stamp outside the three-turn queue is not eligible');
  const continuing = { ...level, exit: 4 };
  assert.equal(supplyAdvice(continuing, state).itemId, 'oil', 'the flute cannot provide light to keep walking');
  const several = { ...level, seals: [17, 18] };
  const severalState = { ...state, seals: [17, 18], history: [6, 7, 17, 18, 19] };
  assert.equal(supplyAdvice(several, severalState).itemId, 'oil', 'one flute cannot claim to collect multiple pending stamps');
});

test('preparation shares difficulty intent, unlocks and map relevance', () => {
  const profile = { tier: 5, reserve: 0, recommendedItem: 'bridge' };
  const bridge = board({ difficulty: profile, bridges: [7] });
  assert.equal(preparationAdvice(bridge).itemId, 'bridge');
  assert.match(preparationAdvice(bridge).reason, /走到断桥旁/);
  assert.equal(preparationAdvice({ ...bridge, bridges: [] }).itemId, 'oil');
  assert.equal(preparationAdvice({ ...bridge, id: 15 }).itemId, 'oil');
  const kite = board({ difficulty: { ...profile, recommendedItem: 'kite' } });
  assert.equal(preparationAdvice(kite).itemId, 'kite');
  assert.equal(preparationAdvice({ ...kite, letters: [] }).itemId, 'oil');
  assert.equal(preparationAdvice({ ...kite, id: 6 }).itemId, 'oil');
  const oil = preparationAdvice({ ...bridge, bridges: [] });
  assert.match(oil.reason, /零余量/);
  assert.ok(oil.reason.includes('可补' + SUPPLY_ENERGY + '拍'));
  assert.equal(preparationAdvice(null).itemId, null);
});

test('echo preparation connects timing-heavy routes to a single previously visited stamp', () => {
  const level = board({ id: 31, seals: [4, 9, 14, 19], difficulty: { tier: 3, reserve: 0, recommendedItem: 'echo' } });
  const advice = preparationAdvice(level);
  assert.equal(advice.itemId, 'echo');
  assert.match(advice.reason, /先踩过蓝票/);
  assert.match(advice.reason, /回声还没到时/);
  assert.match(advice.reason, /未踩过的票不能选/);
  assert.match(advice.reason, /不补灯火/);
  assert.equal(preparationAdvice({ ...level, id: 30 }).itemId, 'oil');
  assert.equal(preparationAdvice({ ...level, seals: [] }).itemId, 'oil');
  assert.equal(supplyAdvice(level, createState(level)), null, 'a preparation suggestion cannot bypass the empty echo queue');
});

test('initial planning never bypasses current item target eligibility', () => {
  const bridge = board({ difficulty: { tier: 5, reserve: 0, recommendedItem: 'bridge' }, bridges: [7] });
  assert.equal(supplyAdvice(bridge, createState(bridge)), null, 'preparing for bridges does not imply an intact bridge is repairable');
  const kite = board({ difficulty: { tier: 4, reserve: 1, recommendedItem: 'kite' }, letters: [19] });
  assert.equal(supplyAdvice(kite, createState(kite)), null, 'distant letters cannot trigger a kite offer');
  const oil = board({ difficulty: { tier: 3, reserve: 1, recommendedItem: 'oil' } });
  assert.equal(supplyAdvice(oil, createState(oil)).itemId, 'oil');
});

test('advice does not consume stock or mutate the live route', () => {
  const level = board({ letters: [8], walls: [7] }), state = playing(level);
  const before = JSON.stringify({ level, state });
  preparationAdvice(level);
  const advice = supplyAdvice(level, state);
  assert.equal(itemOffer(level, state, advice.itemId).eligible, true);
  assert.equal(JSON.stringify({ level, state }), before);
});

test('campaign preparation and all complete clean routes keep every recommendation actionable without a flute', () => {
  const { CAMPAIGN } = require('../src/levels');
  function check(level, state) {
    const advice = supplyAdvice(level, state);
    if (advice) {
      assert.equal(itemOffer(level, state, advice.itemId).eligible, true, 'route ' + level.id + ', turn ' + state.turn);
      assert.ok(advice.reason.length > 0 && advice.label.length > 0);
    }
  }
  for (const level of CAMPAIGN) {
    let state = createState(level);
    check(level, state);
    const preparation = preparationAdvice(level);
    if (preparation.itemId === 'bridge') assert.ok(level.bridges.length > 0);
    for (const action of level.solution) {
      state = step(level, state, action).state;
      check(level, state);
      assert.notEqual(supplyAdvice(level, state)?.itemId, 'echo', 'a clean standard route never needs a flute');
    }
    assert.equal(state.status, 'won');
    assert.equal(supplyAdvice(level, state), null);
  }
});
