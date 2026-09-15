'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, replay, RELIGHT_ACTION } = require('../src/engine');
const { itemTargets } = require('../src/items');
const { helpContent } = require('../src/help-view');
const { mechanicStep } = require('../src/mechanic-guide');
const { getRoutePreview } = require('../src/route-preview');
const { forecastAction, previewMessage } = require('../src/action-preview');

test('bridge lessons describe the real repair-and-cross route after using a kite', () => {
  const level = CAMPAIGN[20], rewards = { kite: 1, bridge: 1 };
  const actions = ['item:kite:33', 'left', 'left'];
  const state = replay(level, actions, [], rewards);
  assert.equal(state.player, 33);
  assert.deepEqual(state.bridges, []);
  assert.deepEqual(itemTargets(level, state, 'bridge'), [34]);

  const guide = mechanicStep({ level, state, mechanicGuide: { ids: ['bridge'], phase: 1 } });
  const explanation = helpContent(level, 0, 'wechat').sections.find(section => section.title === '本关机关').text;
  assert.equal(guide, null, 'a consumed bridge has no unperformed first-crossing lesson');
  assert.doesNotMatch(explanation, /无法折返|仅回声可再次通过/);
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

test('one-step forecasts preserve real state, inventory and history across every shipped mechanic', () => {
  const observed = new Set();
  for (const level of [CAMPAIGN[3], CAMPAIGN[8], CAMPAIGN[12], CAMPAIGN[15], CAMPAIGN[18], CAMPAIGN[19]]) {
    let state = createState(level);
    for (const action of level.solution) {
      const before = JSON.stringify(state), preview = forecastAction(level, state, action);
      assert.ok(preview);
      assert.equal(preview.source, state);
      assert.equal(JSON.stringify(state), before, 'preview cannot change a nested collection or inventory');
      assert.equal(state.status, 'playing', 'forecast completion does not settle the source route');
      preview.events.forEach(event => observed.add(event.type));
      assert.deepEqual(preview.state, step(level, state, action).state);
      state = preview.state;
    }
    assert.equal(forecastAction(level, state, 'wait'), null, 'finished routes cannot be forecast');
  }
  for (const event of ['move', 'echo', 'letter', 'seal', 'wind', 'bridge', 'light', 'supply', 'win'])
    assert.ok(observed.has(event), 'real route coverage: ' + event);
  const level = CAMPAIGN[0], state = createState(level);
  assert.equal(forecastAction(level, state, 'up'), null);
  assert.equal(forecastAction(level, state, 'item:oil'), null);
  const lastBeat = { ...state, energy: 1 };
  const failed = forecastAction(level, lastBeat, 'wait');
  assert.equal(failed.state.status, 'failed');
  assert.equal(lastBeat.status, 'playing');
  assert.match(previewMessage(failed), /将熄灭/);
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
  const nextLetter = level.letterOrder && level.letterOrder.find(cell => state.letters.includes(cell));
  return id === 'kite' ? state.letters.filter(cell => distance(cell) <= 2 && (!level.letterOrder || cell === nextLetter))
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
    relight: 0, bridgeDepartures: 0, windPushes: 0, windBlockedByBridge: 0,
    stationPickups: 0, stationUndos: 0, orderBlockedMoves: 0, orderBlockedKites: 0 };
  for (const level of CAMPAIGN) for (let sample = 0; sample < 2; sample++) {
    counts.routes++;
    const rewards = { oil: level.id >= 4 ? 4 : 0, kite: level.id >= 7 ? 4 : 0,
      bridge: level.id >= 16 && level.bridges.length ? 4 : 0 };
    let state = freezeState(createState(level, rewards));
    const actions = [], collectedStations = new Set();
    for (let attempt = 0; attempt < 80 && state.status !== 'won'; attempt++) {
      const targets = {};
      for (const id of ['oil', 'kite', 'bridge']) {
        targets[id] = expectedTargets(level, state, id);
        assert.deepEqual(itemTargets(level, state, id), targets[id], `${level.id}/${sample}/${attempt}: ${id} target geometry`);
        counts.targetChecks++;
      }
      if (level.letterOrder && state.status === 'playing' && state.inventory.kite > 0) {
        const nextLetter = level.letterOrder.find(cell => state.letters.includes(cell));
        for (const cell of state.letters) {
          const distance = Math.abs(cell % level.width - state.player % level.width) +
            Math.abs(Math.floor(cell / level.width) - Math.floor(state.player / level.width));
          if (cell === nextLetter || distance > 2) continue;
          const rejected = step(level, state, 'item:kite:' + cell);
          assert.equal(rejected.moved, false, `${level.id}/${sample}/${attempt}: a kite cannot skip a letter number`);
          assert.equal(rejected.state, state);
          counts.orderBlockedKites++;
        }
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
      const supplyEvents = result.events.filter(event => event.type === 'supply');
      if (action.startsWith('item:') || action === RELIGHT_ACTION) {
        const id = action === RELIGHT_ACTION ? 'oil' : action.split(':')[1];
        counts[action === RELIGHT_ACTION ? 'relight' : id === 'bridge' ? 'repair' : id]++;
        assert.equal(state.player, before.player, label + ': tools do not move the courier');
        assert.equal(state.turn, before.turn, label + ': tools do not advance the clock');
        assert.equal(state.echo, before.echo, label + ': tools do not advance the echo');
        assert.deepEqual(state.history, before.history, label + ': tools leave the recorded route alone');
        assert.deepEqual(state.seals, before.seals, label + ': tools cannot collect stamps');
        assert.deepEqual(state.lights, before.lights, label + ': tools cannot consume map lamps');
        assert.deepEqual(state.supplies, before.supplies, label + ': tools cannot collect route stations');
        assert.deepEqual(supplyEvents, [], label + ': tools never grant station stock');
        assert.deepEqual(state.inventory, { ...before.inventory, [id]: before.inventory[id] - 1 });
        assert.equal(state.itemsUsed, before.itemsUsed + 1, label + ': spending stock counts exactly once');
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
        const nextLetter = level.letterOrder && level.letterOrder.find(cell => before.letters.includes(cell));
        const mayCollect = !level.letterOrder || landing === nextLetter;
        assert.deepEqual(state.letters, before.letters.filter(cell => cell !== landing || !mayCollect));
        const orderBlocked = before.letters.includes(landing) && !mayCollect;
        assert.deepEqual(result.events.filter(event => event.type === 'order-blocked'), orderBlocked
          ? [{ type: 'order-blocked', cell: landing, expected: nextLetter }] : [], label + ': numbered letters report only premature arrivals');
        if (orderBlocked) counts.orderBlockedMoves++;
        assert.deepEqual(state.seals, before.seals.filter(cell => cell !== state.echo));
        assert.deepEqual(state.lights, before.lights.filter(cell => cell !== landing));
        assert.equal(state.energy, before.energy - 1 + (before.lights.includes(landing) ? 3 : 0));
        assert.deepEqual(state.bridges, before.bridges.filter(cell => cell !== before.player || landing === before.player));
        const station = (before.supplies || []).includes(landing);
        if (station) {
          const item = level.supplies[landing], stock = Math.min(4096, (before.inventory[item] || 0) + 1);
          assert.deepEqual(supplyEvents, [{ type: 'supply', cell: landing, item, amount: stock - (before.inventory[item] || 0) }],
            label + ': the first landing reports the real station reward');
          assert.deepEqual(state.inventory, { ...before.inventory, [item]: stock }, label + ': only the station item gains stock');
          assert.deepEqual(state.supplies, before.supplies.filter(cell => cell !== landing), label + ': a collected station is removed');
          assert.equal(collectedStations.has(landing), false, label + ': a station grants stock once per route');
          collectedStations.add(landing); counts.stationPickups++;
        } else {
          assert.deepEqual(supplyEvents, [], label + ': movement without an uncollected station grants no stock');
          assert.deepEqual(state.inventory, before.inventory, label + ': movement without a station preserves every item');
          assert.deepEqual(state.supplies, before.supplies, label + ': other movement leaves uncollected stations alone');
        }
        assert.equal(state.itemsUsed, before.itemsUsed, label + ': movement and station collection never spend an item');
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
      if (actions.length % 12 === 0 || supplyEvents.length) {
        assert.deepEqual(replay(level, actions, [], rewards), state, label + ': saved history reproduces direct execution');
        const restored = replay(level, actions.slice(0, -1), [], rewards);
        assert.deepEqual(restored, before, label + ': undo restores the prior state and inventory');
        if (supplyEvents.length) {
          assert.ok(restored.supplies.includes(supplyEvents[0].cell), label + ': undo makes the collected station available again');
          const repeated = step(level, restored, action);
          assert.deepEqual(repeated.state, state, label + ': replaying the pickup restores the same stock without duplication');
          assert.deepEqual(repeated.events.filter(event => event.type === 'supply'), supplyEvents);
          counts.stationUndos++;
        }
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
  assert.ok(counts.stationPickups > 0 && counts.orderBlockedMoves > 0 && counts.orderBlockedKites > 0);
  assert.equal(counts.stationUndos, counts.stationPickups, 'every station pickup is checked through undo and replay');
  t.diagnostic('Deterministic mixed-route coverage: ' + JSON.stringify(counts));
});
