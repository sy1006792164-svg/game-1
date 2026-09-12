'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, replay, RELIGHT_ACTION } = require('../src/engine');
const { itemTargets } = require('../src/items');
const { helpContent } = require('../src/help-view');
const { mechanicStep } = require('../src/mechanic-guide');
const { getRoutePreview } = require('../src/route-preview');

test('bridge lessons describe the real repair-and-cross route after using a kite', () => {
  const level = CAMPAIGN[20], rewards = { kite: 1, bridge: 1 };
  const actions = ['item:kite:33', 'left', 'left'];
  const state = replay(level, actions, [], rewards);
  assert.equal(state.player, 33);
  assert.deepEqual(state.bridges, []);
  assert.deepEqual(itemTargets(level, state, 'bridge'), [34]);

  const guide = mechanicStep({ level, state, mechanicGuide: { ids: ['bridge'], phase: 1 } });
  const explanation = helpContent(level, 0, 'wechat').sections.find(section => section.title === '本关机关').text;
  assert.match(guide.text, /修好才能再走/);
  assert.match(guide.tip, /修桥包.*相邻断桥/);
  assert.doesNotMatch(guide.title + explanation, /无法折返|仅回声可再次通过/);
  assert.match(explanation, /修桥包.*相邻断桥.*修好可再走/);

  const repaired = step(level, state, 'item:bridge:34');
  assert.equal(repaired.moved, true);
  assert.deepEqual(repaired.state.bridges, [34]);
  assert.equal(repaired.state.turn, state.turn, 'repair does not spend a turn');
  assert.equal(repaired.state.energy, state.energy);
  assert.deepEqual(repaired.state.history, state.history, 'the kite and repair never advance the echo');
  const returned = step(level, step(level, repaired.state, 'right').state, 'right');
  assert.equal(returned.state.player, level.start);
  assert.deepEqual(returned.state.bridges, [], 'a repaired bridge tears again after departure');
  assert.deepEqual(returned.state, replay(level, [...actions, 'item:bridge:34', 'right', 'right'], [], rewards));
});

test('route previews retain the real echo timing through tools and bridge repairs', () => {
  const level = CAMPAIGN[20], renderer = {};
  const actions = ['item:kite:33', 'left', 'left', 'item:bridge:34', 'right', 'right'];
  let state = createState(level, { kite: 1, bridge: 1 });
  const played = [];
  for (const action of actions) {
    const previous = state;
    state = step(level, state, action).state;
    played.push(action);
    const preview = getRoutePreview(renderer, { level, state, actions: played });
    const waited = step(level, state, 'wait');
    assert.equal(preview.echoNext, waited.state.echo, action + ': the next-echo ring predicts a real turn');
    if (action.startsWith('item:')) {
      assert.equal(state.turn, previous.turn);
      assert.deepEqual(state.history, previous.history);
    }
    assert.equal(preview.echo[preview.echo.length - 1], state.player);
  }
  assert.equal(state.echo, 34, 'the echo can occupy the bridge after it tears again');
  assert.deepEqual(getRoutePreview(renderer, { level, state, actions: played }).echo, [34, 33, 34, 35]);
});

// This geometry oracle deliberately does not call neighbor(), itemOffer() or
// itemAvailability(): a shared adjacency bug must not validate itself.
const DELTAS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function openNeighbor(level, state, from, action) {
  const [dx, dy] = DELTAS[action];
  const x = from % level.width + dx, y = Math.floor(from / level.width) + dy;
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return null;
  const cell = y * level.width + x;
  return level.walls.includes(cell) || level.bridges.includes(cell) && !state.bridges.includes(cell) ? null : cell;
}

function expectedTargets(level, state, id) {
  if (state.status !== 'playing' || !state.inventory[id] || level.id < { oil: 4, kite: 7, bridge: 16 }[id]) return [];
  if (id === 'oil') return [state.player];
  const distance = cell => Math.abs(cell % level.width - state.player % level.width) +
    Math.abs(Math.floor(cell / level.width) - Math.floor(state.player / level.width));
  return id === 'kite' ? state.letters.filter(cell => distance(cell) <= 2)
    : level.bridges.filter(cell => !state.bridges.includes(cell) && distance(cell) === 1);
}

function freezeState(state) {
  for (const value of Object.values(state)) if (value && typeof value === 'object') Object.freeze(value);
  return Object.freeze(state);
}

test('seeded mixed routes on all 999 boards preserve geometry, echo timing, replay and undo', t => {
  let random = 0x70a3c512;
  const pick = size => {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    return (random >>> 0) % size;
  };
  const directions = Object.keys(DELTAS);
  const counts = { routes: 0, attempted: 0, accepted: 0, blocked: 0, targetChecks: 0,
    replayChecks: 0, undoChecks: 0, waits: 0, kite: 0, repair: 0, oil: 0,
    relight: 0, bridgeDepartures: 0, windPushes: 0, windBlockedByBridge: 0 };
  for (const level of CAMPAIGN) for (let sample = 0; sample < 2; sample++) {
    counts.routes++;
    const rewards = { oil: level.id >= 4 ? 4 : 0, kite: level.id >= 7 ? 4 : 0,
      bridge: level.id >= 16 && level.bridges.length ? 4 : 0 };
    let state = freezeState(createState(level, rewards));
    const actions = [];
    for (let attempt = 0; attempt < 80 && state.status !== 'won'; attempt++) {
      const targets = {};
      for (const id of ['oil', 'kite', 'bridge']) {
        targets[id] = expectedTargets(level, state, id);
        assert.deepEqual(itemTargets(level, state, id), targets[id], `${level.id}/${sample}/${attempt}: ${id} target geometry`);
        counts.targetChecks++;
      }
      let action;
      if (state.status === 'failed') {
        if (!state.inventory.oil) break;
        action = RELIGHT_ACTION;
      } else if (targets.bridge.length && pick(2) === 0) {
        action = 'item:bridge:' + targets.bridge[pick(targets.bridge.length)];
      } else if (targets.kite.length && pick(4) === 0) {
        action = 'item:kite:' + targets.kite[pick(targets.kite.length)];
      } else if (!sample && targets.oil.length && state.energy <= 2) {
        action = 'item:oil';
      } else {
        const choices = pick(5) === 0 ? directions
          : directions.filter(direction => openNeighbor(level, state, state.player, direction) !== null).concat('wait');
        action = choices[pick(choices.length)];
      }
      const before = state, result = step(level, before, action);
      const label = `${level.id}/${sample}/${attempt}/${action}`;
      counts.attempted++;
      if (!result.moved) {
        assert.equal(result.state, before, label + ': rejected actions preserve every field');
        assert.equal(openNeighbor(level, before, before.player, action), null, label + ': only blocked movement is rejected');
        counts.blocked++;
        continue;
      }
      actions.push(action); counts.accepted++;
      state = freezeState(result.state);
      if (action.startsWith('item:') || action === RELIGHT_ACTION) {
        const id = action === RELIGHT_ACTION ? 'oil' : action.split(':')[1];
        counts[action === RELIGHT_ACTION ? 'relight' : id === 'bridge' ? 'repair' : id]++;
        assert.equal(state.player, before.player, label + ': tools do not move the courier');
        assert.equal(state.turn, before.turn, label + ': tools do not advance the clock');
        assert.equal(state.echo, before.echo, label + ': tools do not advance the echo');
        assert.deepEqual(state.history, before.history, label + ': tools leave the recorded route alone');
        assert.deepEqual(state.seals, before.seals, label + ': tools cannot collect stamps');
        assert.deepEqual(state.lights, before.lights, label + ': tools cannot consume map lamps');
        assert.deepEqual(state.inventory, { ...before.inventory, [id]: before.inventory[id] - 1 });
        assert.equal(state.energy, action === RELIGHT_ACTION ? 6 : before.energy + (id === 'oil' ? 6 : 0));
      } else {
        const entry = action === 'wait' ? before.player : openNeighbor(level, before, before.player, action);
        const wind = action !== 'wait' && level.winds[entry];
        const pushed = wind ? openNeighbor(level, before, entry, wind) : null;
        const landing = pushed === null ? entry : pushed;
        assert.equal(state.player, landing, label + ': movement and a single wind push use valid floor');
        assert.deepEqual(state.history, before.history.concat(landing));
        assert.equal(state.turn, before.turn + 1);
        assert.equal(state.echo, state.turn >= 3 ? state.history[state.turn - 3] : null);
        assert.deepEqual(state.letters, before.letters.filter(cell => cell !== landing));
        assert.deepEqual(state.seals, before.seals.filter(cell => cell !== state.echo));
        assert.deepEqual(state.lights, before.lights.filter(cell => cell !== landing));
        assert.equal(state.energy, before.energy - 1 + (before.lights.includes(landing) ? 3 : 0));
        assert.deepEqual(state.bridges, before.bridges.filter(cell => cell !== before.player || landing === before.player));
        assert.deepEqual(state.inventory, before.inventory, label + ': movement never spends an item');
        if (action === 'wait') counts.waits++;
        if (pushed !== null) counts.windPushes++;
        if (before.bridges.length !== state.bridges.length) counts.bridgeDepartures++;
        if (wind && pushed === null) {
          const [dx, dy] = DELTAS[wind], target = entry + dx + dy * level.width;
          if (level.bridges.includes(target) && !before.bridges.includes(target)) counts.windBlockedByBridge++;
        }
      }
      assert.equal(state.status, state.player === level.exit && !state.letters.length && !state.seals.length
        ? 'won' : state.energy <= 0 ? 'failed' : 'playing', label + ': completion wins over empty energy');
      if (actions.length % 12 === 0) {
        assert.deepEqual(replay(level, actions, [], rewards), state, label + ': saved history reproduces direct execution');
        assert.deepEqual(replay(level, actions.slice(0, -1), [], rewards), before, label + ': undo restores the prior state and inventory');
        counts.replayChecks++; counts.undoChecks++;
        for (const id of ['kite', 'bridge']) {
          const rejected = step(level, state, 'item:' + id + ':' + level.width * level.height);
          assert.equal(rejected.moved, false, label + ': out-of-board item targets are rejected');
          assert.equal(rejected.state, state);
        }
      }
    }
    assert.deepEqual(replay(level, actions, [], rewards), state, `${level.id}/${sample}: complete mixed route replays`);
    counts.replayChecks++;
  }
  assert.ok(counts.accepted > 100000 && counts.blocked > 5000 && counts.waits > 10000);
  assert.ok(counts.kite > 1000 && counts.repair > 500 && counts.oil > 500 && counts.relight > 500);
  assert.ok(counts.bridgeDepartures > 1000 && counts.windPushes > 1000 && counts.windBlockedByBridge > 0);
  t.diagnostic('Deterministic mixed-route coverage: ' + JSON.stringify(counts));
});
