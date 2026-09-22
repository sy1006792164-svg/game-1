'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, step } = require('../src/engine');
const { CAMPAIGN } = require('../src/levels');
const { echoTimelineHeight, getEchoForecast, echoInspection, echoForecastMessage, inspectEcho, drawEchoTimeline } = require('../src/echo-timeline');
const { gameBoardRect } = require('../src/game-view');
const { GAME_LAYOUT } = require('../src/game-layout');

function sample() {
  const level = CAMPAIGN[43];
  let state = createState(level);
  for (const action of level.solution.slice(0, 4)) state = step(level, state, action).state;
  return { page: 'game', level, state, session: 1, guideStep: () => null };
}

test('three-beat forecasts match real echo landings and never promise the same ticket twice', () => {
  for (const index of [0, 3, 14, 43, 52, 100, 300, 600, 998]) {
    const level = CAMPAIGN[index];
    let state = createState(level);
    for (const action of level.solution) {
      let future = state;
      for (const entry of getEchoForecast({ state })) {
        if (future.status !== 'playing') break;
        const result = step(level, future, 'wait');
        assert.equal(entry.cell, result.state.echo, 'level ' + level.id + ', turn ' + state.turn);
        assert.equal(entry.seal, result.events.some(event => event.type === 'seal'));
        future = result.state;
      }
      state = step(level, state, action).state;
    }
  }
});

test('forecast inspection does not spend a beat, change the route or consume anything', () => {
  const game = sample(), renderer = {}, source = game.state, before = JSON.stringify(source);
  const entry = getEchoForecast(game)[1];
  inspectEcho(renderer, game, entry);
  assert.equal(echoInspection(renderer, game).entry, entry);
  assert.equal(game.state, source);
  assert.equal(JSON.stringify(game.state), before);
  inspectEcho(renderer, game, entry);
  assert.equal(echoInspection(renderer, game), null, 'second click closes the preview');
});

test('old hit targets and previews cannot survive a move, undo, restart or another UI mode', () => {
  for (const change of [game => { game.state = step(game.level, game.state, 'wait').state; },
    game => { game.state = { ...game.state }; }, game => { game.session++; },
    game => { game.modal = {}; }, game => { game.hidden = true; }, game => { game.busy = true; },
    game => { game.selectedItem = 'echo'; }, game => { game.actionPreview = {}; },
    game => { game.pendingAction = {}; }, game => { game.guideStep = () => ({}); },
    game => { game.page = 'home'; }]) {
    const game = sample(), renderer = {}, source = game.state, session = game.session;
    const entry = getEchoForecast(game)[1];
    inspectEcho(renderer, game, entry);
    change(game);
    assert.equal(echoInspection(renderer, game), null);
    inspectEcho(renderer, game, entry, source, session);
    assert.equal(echoInspection(renderer, game), null);
  }
});

test('timeline exposes labelled keyboard targets which only inspect their own beat', () => {
  const game = sample(), hits = [], noop = () => {};
  const renderer = { ctx: { save: noop, restore: noop }, icon: noop, text: noop,
    round: noop, line: noop, circle: noop,
    hit: (x, y, w, h, action, contains, label) => hits.push({ action, label }) };
  const state = game.state;
  drawEchoTimeline(renderer, game, { x: 24, y: 154, w: 342 });
  assert.equal(hits.length, 3);
  assert.equal(new Set(hits.map(hit => hit.action.focusId)).size, 3);
  hits.forEach((hit, index) => {
    assert.ok(hit.label.startsWith('查看回声：'));
    hit.action();
    assert.equal(echoInspection(renderer, game).entry.beat, index + 1);
    assert.equal(game.state, state);
  });
});

test('inspection explains echo birth, ticket collection and pressure plates', () => {
  const game = sample();
  game.state = createState(game.level);
  assert.match(echoForecastMessage(game, getEchoForecast(game)[0]), /再行动 3 拍诞生/);
  game.level = { ...game.level, echoGates: { 8: { plate: 4 } } };
  assert.match(echoForecastMessage(game, { cell: 4, beat: 2, seal: true }), /盖一张蓝票、压住踏板开门/);
});

test('inspecting a later beat warns when light will run out first', () => {
  const game = sample();
  game.state = { ...game.state, energy: 1 };
  assert.equal(step(game.level, game.state, 'wait').state.status, 'failed');
  assert.match(echoForecastMessage(game, getEchoForecast(game)[2]), /仅剩 1 拍，需先补光/);
  assert.match(echoForecastMessage(game, getEchoForecast(game)[0]), /灯火仅剩 1 拍/);
});

test('forecast touch targets retain 44 pixels on small screens without overlapping the board', () => {
  for (const scale of [320 / 390, 1, 1.2]) {
    const game = sample(), hits = [], noop = () => {};
    const renderer = { scale, viewport: { x: 0, w: 390 }, ctx: { save: noop, restore: noop },
      icon: noop, text: noop, round: noop, line: noop, circle: noop,
      hit: (x, y, w, h) => hits.push({ y, h }) };
    drawEchoTimeline(renderer, game, { x: 24, y: GAME_LAYOUT.timelineY, w: 342, h: echoTimelineHeight(renderer) });
    const board = gameBoardRect(renderer, { hintY: 500 });
    for (const hit of hits) {
      assert.ok(hit.h * scale >= 44);
      assert.ok(hit.y + hit.h < board.y);
      assert.ok(hit.y >= GAME_LAYOUT.objectivesY + GAME_LAYOUT.objectivesHeight);
    }
  }
});

test('forecast cells beyond remaining light carry a visible text warning without disabling inspection', () => {
  const game = sample(), labels = [], hits = [], noop = () => {};
  while (game.state.energy > 1) game.state = step(game.level, game.state, 'wait').state;
  const renderer = { ctx: { save: noop, restore: noop }, icon: noop,
    text: label => labels.push(label), round: noop, line: noop, circle: noop,
    hit: (x, y, w, h, action) => hits.push(action) };
  drawEchoTimeline(renderer, game, { x: 24, y: 154, w: 342 });
  assert.equal(labels.filter(label => label === '需先补拍' || label === '补拍后盖票').length, 2);
  assert.equal(hits.length, 3);
  hits[2]();
  assert.equal(echoInspection(renderer, game).entry.beat, 3);
});
