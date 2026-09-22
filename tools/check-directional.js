'use strict';

const assert = require('node:assert/strict');
const { createState, step, replay, queuedEchoSeals, stars } = require('../src/engine');
const { isReviveRouteBlocked } = require('../src/revive-policy');
const { getEchoForecast } = require('../src/echo-timeline');
const { playHint } = require('../src/play-guide');
const { helpContent } = require('../src/help-view');
const { STYLES } = require('../src/game-feedback');
const { createMechanicGuide, mechanicStep, triggeredMechanics } = require('../src/mechanic-guide');
const { verifyCampaign } = require('./verify-levels');
const { solve } = require('./solve');

const configPath = require.resolve('../src/config');
const levelsPath = require.resolve('../src/levels');
const originalConfig = require(configPath);
const originalLevels = require.cache[levelsPath];
// Exercise both release stages entirely in memory; never rewrite the gate.
const loadSeason = season => {
  require.cache[configPath].exports = { ...originalConfig, PROGRESSION_SEASON: season };
  delete require.cache[levelsPath];
  return require(levelsPath);
};
let first, second;
try { first = loadSeason(1); second = loadSeason(2); }
finally {
  require.cache[configPath].exports = originalConfig;
  if (originalLevels) require.cache[levelsPath] = originalLevels;
  else delete require.cache[levelsPath];
}
assert.equal(first.CONTENT_VERSION, '8');
assert.equal(first.CAMPAIGN.filter(level => level.directionalSeals).length, 0);

assert.equal(second.CONTENT_VERSION, '9');
const expected = {
  5: { 15: 'up' }, 6: { 16: 'up' }, 9: { 31: 'down' },
  12: { 13: 'down' }, 15: { 12: 'left' }, 18: { 16: 'left' },
  21: { 7: 'left' }, 24: { 35: 'right' }, 27: { 22: 'right' },
  30: { 23: 'down' }
};
assert.equal(second.CAMPAIGN.filter(level => level.directionalSeals).length, 10);
const independent = solve(second.CAMPAIGN[11], 400000);
assert.ok(independent && independent.length <= second.CAMPAIGN[11].par,
  'The independent search must preserve queued echo directions');
for (const [id, rule] of Object.entries(expected)) {
  const level = second.CAMPAIGN[Number(id) - 1];
  assert.deepEqual(level.directionalSeals, rule);
  let state = createState(level), stamped = 0;
  for (const action of level.solution) {
    const result = step(level, state, action);
    stamped += result.events.filter(event => event.type === 'seal' && rule[event.cell]).length;
    state = result.state;
  }
  assert.equal(stamped, 1, `Level ${id}: directional stamp must be collected once`);
  assert.equal(state.status, 'won');
  assert.equal(stars(level, state), 3);
}
assert.match(helpContent(second.CAMPAIGN[4], 0, 'browser').sections.map(section => section.text).join('\n'), /定向回声邮票/);
assert.match(STYLES['seal-wrong-direction'].detail, /箭头方向/);
const guidedLevel = second.CAMPAIGN[4];
const guided = { level: guidedLevel, state: createState(guidedLevel), mode: 'campaign',
  reviewing: false, selectedItem: null,
  mechanicGuide: createMechanicGuide({ completed: {}, mechanicGuides: {} }, guidedLevel, 'campaign') };
let shown = false, learned = false;
for (const action of guidedLevel.solution) {
  const card = mechanicStep(guided);
  if (card && card.mechanic === 'directionalSeal') shown = true;
  const previous = guided.state, result = advance(guidedLevel, previous, action);
  if (triggeredMechanics(guidedLevel, previous, action, result).includes('directionalSeal')) learned = true;
  guided.state = result.state;
}
assert.equal(shown && learned, true, 'First encounter must teach and record the directional rule');

function simple(start, direction = 'up') {
  return { id: 5, width: 3, height: 3, start, exit: 8, walls: [], letters: [],
    seals: [4], bridges: [], winds: {}, budget: 9, par: 4,
    directionalSeals: { 4: direction } };
}
function advance(level, state, action) {
  const result = step(level, state, action);
  assert.equal(result.moved, true, `action ${action} must be legal`);
  return result;
}
for (const [start, action, correct] of [[7, 'up', true], [1, 'down', false]]) {
  const level = simple(start), actions = [action, 'wait', 'wait', 'wait'];
  let result = advance(level, createState(level), action), state = result.state;
  assert.equal(queuedEchoSeals(level, state)[2].seal, correct);
  assert.equal(getEchoForecast({ level, state })[2].wrongDirection, !correct);
  for (let turn = 1; turn <= 3; turn++) {
    result = advance(level, state, 'wait'); state = result.state;
    if (turn < 3) assert.equal(state.seals.includes(4), true, 'Echo must wait three beats');
  }
  assert.equal(state.seals.includes(4), !correct);
  assert.equal(result.events.some(event => event.type === 'seal-wrong-direction'), !correct);
  assert.equal(replay(level, actions).seals.includes(4), !correct, 'Resume must replay the same rule');
  assert.equal(replay(level, actions.slice(0, -1)).seals.includes(4), true, 'Undo returns before the stamp');
  assert.equal(createState(level).turn, 0, 'Restart returns to the opening state');
  if (!correct) {
    const game = { level, state, moveEvents: result.events, transitionAt: 100,
      blockedAt: null, reviewing: false, failureHint: () => '' };
    assert.match(playHint(game, 200), /方向不对/);
  }
}

// The last leg of a wind push determines entry direction, even when the net
// displacement between recorded landings is diagonal.
const windLevel = { id: 5, width: 4, height: 3, start: 9, exit: 11,
  walls: [], letters: [], seals: [6], directionalSeals: { 6: 'right' },
  winds: { 5: 'right' }, bridges: [], budget: 9, par: 4 };
let wind = advance(windLevel, createState(windLevel), 'up');
assert.equal(wind.state.player, 6);
assert.equal(wind.state.historyDirections[1], 'right');
assert.equal(getEchoForecast({ level: windLevel, state: wind.state })[2].seal, true);
for (let turn = 0; turn < 3; turn++) wind = advance(windLevel, wind.state, 'wait');
assert.equal(wind.state.seals.includes(6), false, 'Wind-pushed echo stamps along its final leg');
const oppositeWind = { ...windLevel, directionalSeals: { 6: 'up' } };
let wrongWind = advance(oppositeWind, createState(oppositeWind), 'up');
assert.equal(getEchoForecast({ level: oppositeWind, state: wrongWind.state })[2].wrongDirection, true);
for (let turn = 0; turn < 3; turn++) wrongWind = advance(oppositeWind, wrongWind.state, 'wait');
assert.equal(wrongWind.state.seals.includes(6), true);

const stranded = { ...simple(1), walls: [3, 5, 6, 7, 8], exit: 2, bridges: [0], budget: 4 };
let blocked = createState(stranded);
blocked.bridges = [];
blocked = advance(stranded, blocked, 'down').state;
for (let turn = 0; turn < 3; turn++) blocked = advance(stranded, blocked, 'wait').state;
assert.equal(isReviveRouteBlocked(stranded, blocked), true,
  'A relight must not promise an impossible arrow approach');

const report = verifyCampaign(second.CAMPAIGN);
assert.equal(report.summary.ok, true, 'Every shipped route must still win without items');
console.log(`PASS directional season gate, ten routes, echo/forecast/wind/replay/revive; ${report.summary.passed}/999 three-star routes`);
