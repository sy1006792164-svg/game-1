'use strict';

// Deterministic procedural campaign routes for chapters 6 and later.
// `node tools/generate.js [total]` rewrites src/levels-extra.js so that the
// campaign holds `total` routes (default 120). Routes 1-30 stay hand made.
// Every generated route is solved by a compact BFS, replayed through the real
// engine via parseLevel and cross-checked by the independent tools/solve.js
// before it is written, so par is a verified minimum and the witness wins.
const fs = require('node:fs');
const path = require('node:path');
const { createState, step } = require('../src/engine');
const { solve } = require('./solve');

const HAND_MADE = 30;
const PER_CHAPTER = 6;
const TOTAL = Number(process.argv[2]) || 120;
const LETTERS = { up: 'U', down: 'D', left: 'L', right: 'R', wait: 'W' };
const ACTIONS = ['up', 'down', 'left', 'right', 'wait'];
const DELTAS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const WIND_CHARS = ['^', 'v', '<', '>'];

const CHAPTER_WORDS = ['雾巷', '纸桥', '逆风', '薄暮', '灯塔', '雪线', '潮汐', '千折', '暗巷', '风眼', '星海', '孤岛', '霜夜', '旧城', '终章'];
const TITLE_TAILS = ['的来信', '回廊', '邮路', '折返', '灯语', '长信'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (array, random) => {
  for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
  return array;
};

/** Difficulty tier for a zero-based route index. Boards, targets and hazards grow by chapter. */
function tier(index) {
  const chapter = Math.floor(index / PER_CHAPTER);
  const size = chapter <= 8 ? 6 : chapter <= 13 ? 7 : 8;
  const targets = size === 6 ? (chapter <= 6 ? 3 : 4) : size === 7 ? (chapter <= 10 ? 4 : 5) : (chapter <= 16 ? 4 : 5);
  return {
    chapter, size, targets,
    winds: chapter <= 7 ? 2 : chapter <= 16 ? 3 : 4,
    bridges: chapter <= 5 ? 0 : chapter <= 8 ? 1 : 2,
    lights: 2,
    // Shortest-route floor per tier; the generator keeps the longest valid draft it finds.
    minPar: size === 6 ? 28 : size === 7 ? 36 : 44,
    maxStates: 900000,
    density: size === 6 ? .64 : size === 7 ? .6 : .56
  };
}

function board(size) {
  const adjacent = (cell, direction) => {
    const x = cell % size + DELTAS[direction][0], y = Math.floor(cell / size) + DELTAS[direction][1];
    return x < 0 || x >= size || y < 0 || y >= size ? -1 : y * size + x;
  };
  return { size, adjacent };
}

/** Cells reachable from start when wind pushes apply and every bridge is intact. */
function reachable(geometry, floors, winds, start) {
  const seen = new Set([start]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (let direction = 0; direction < 4; direction++) {
      let next = geometry.adjacent(queue[head], direction);
      if (!floors.has(next)) continue;
      if (winds[next] !== undefined) {
        const pushed = geometry.adjacent(next, winds[next]);
        if (floors.has(pushed)) next = pushed;
      }
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

function distances(geometry, floors, start) {
  const map = new Map([[start, 0]]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (let direction = 0; direction < 4; direction++) {
      const next = geometry.adjacent(queue[head], direction);
      if (floors.has(next) && !map.has(next)) { map.set(next, map.get(queue[head]) + 1); queue.push(next); }
    }
  }
  return map;
}

function floorNeighbors(geometry, floors, cell) {
  return [0, 1, 2, 3].filter(direction => floors.has(geometry.adjacent(cell, direction)));
}

/**
 * Exact BFS over (last three positions, collected targets, intact bridges).
 * Mirrors engine.step: wind pushes once on entry, a torn bridge is a wall for
 * the courier and for wind landings, seals are stamped by the echo three
 * turns behind, waiting never triggers wind. Light is unlimited here.
 */
function search(geometry, draft, maxStates) {
  const { floors, winds, start, exit, letters, seals, bridges } = draft;
  const EMPTY = 127, SLOT = 128, SLOTS = SLOT * SLOT * SLOT;
  const letterBit = new Map(letters.map((cell, i) => [cell, 1 << i]));
  const sealBit = new Map(seals.map((cell, i) => [cell, 1 << (i + letters.length)]));
  const bridgeBit = new Map(bridges.map((cell, i) => [cell, 1 << i]));
  const fullMask = (1 << (letters.length + seals.length)) - 1, allBridges = (1 << bridges.length) - 1;
  const key = (oldest, previous, player, collected, intact) => ((collected * (allBridges + 1) + intact) * SLOTS) + (oldest * SLOT + previous) * SLOT + player;
  const first = key(EMPTY, EMPTY, start, 0, allBridges);
  const queue = [[EMPTY, EMPTY, start, 0, allBridges]], parents = [-1], moves = [-1], seen = new Set([first]);
  for (let head = 0; head < queue.length; head++) {
    const [oldest, previous, player, collected, intact] = queue[head];
    if (player === exit && collected === fullMask) {
      const route = [];
      for (let at = head; parents[at] >= 0; at = parents[at]) route.push(ACTIONS[moves[at]]);
      return { route: route.reverse(), states: seen.size };
    }
    if (seen.size > maxStates) return null;
    const open = cell => floors.has(cell) && (!bridgeBit.has(cell) || (intact & bridgeBit.get(cell)));
    for (let action = 0; action < 5; action++) {
      let next = player;
      if (action < 4) {
        next = geometry.adjacent(player, action);
        if (!open(next)) continue;
        if (winds[next] !== undefined) {
          const pushed = geometry.adjacent(next, winds[next]);
          if (open(pushed)) next = pushed;
        }
      }
      let bridgesLeft = intact;
      if (next !== player && bridgeBit.has(player)) bridgesLeft &= ~bridgeBit.get(player);
      const mask = collected | (letterBit.get(next) || 0) | (sealBit.get(oldest) || 0);
      const signature = key(previous, player, next, mask, bridgesLeft);
      if (seen.has(signature)) continue;
      seen.add(signature); queue.push([previous, player, next, mask, bridgesLeft]); parents.push(head); moves.push(action);
    }
  }
  return null;
}

function draft(index, attempt) {
  const t = tier(index), random = rng(index * 1000003 + attempt * 7919 + 17), geometry = board(t.size);
  const size = t.size, all = Array.from({ length: size * size }, (_, i) => i);
  const floors = new Set(all);
  const wanted = Math.round(size * size * t.density);
  for (const candidate of shuffle(all.slice(), random)) {
    if (floors.size <= wanted) break;
    floors.delete(candidate);
    if (distances(geometry, floors, floors.values().next().value).size !== floors.size) floors.add(candidate);
  }
  const floorList = Array.from(floors).sort((a, b) => a - b);
  const junctions = floorList.filter(cell => floorNeighbors(geometry, floors, cell).length >= 3).length;
  if (junctions < 4) return null;
  const start = floorList[Math.floor(random() * floorList.length)];
  // Winds sit at junctions and blow toward floor. Every floor must stay reachable.
  const winds = {};
  for (const candidate of shuffle(floorList.slice(), random)) {
    if (Object.keys(winds).length >= t.winds) break;
    if (candidate === start) continue;
    const directions = floorNeighbors(geometry, floors, candidate);
    if (directions.length < 3) continue;
    winds[candidate] = directions[Math.floor(random() * directions.length)];
    // Nobody can stand on a wind tile, so every other floor cell must stay
    // mutually reachable: no one-way pockets that trap the courier.
    const standing = floorList.filter(cell => winds[cell] === undefined);
    const connected = standing.every(from => { const seen = reachable(geometry, floors, winds, from); return standing.every(cell => seen.has(cell)); });
    if (!connected) delete winds[candidate];
  }
  if (Object.keys(winds).length < Math.min(2, t.winds)) return null;
  const fromStart = distances(geometry, floors, start);
  const far = floorList.filter(cell => cell !== start && winds[cell] === undefined).sort((a, b) => fromStart.get(b) - fromStart.get(a));
  const exit = far[Math.floor(random() * Math.min(4, far.length))];
  // Bridges live in corridors, where tearing one really closes a passage, but
  // never on a cut cell: a torn bridge must not strand the courier or a target.
  const cutFree = cell => { const rest = new Set(floors); rest.delete(cell); return distances(geometry, rest, rest.values().next().value).size === rest.size; };
  const corridorCells = shuffle(floorList.filter(cell => cell !== start && cell !== exit && winds[cell] === undefined && floorNeighbors(geometry, floors, cell).length === 2 && cutFree(cell)), random);
  const bridges = corridorCells.slice(0, t.bridges);
  if (bridges.length < t.bridges) return null;
  const pool = shuffle(floorList.filter(cell => cell !== start && cell !== exit && winds[cell] === undefined && !bridges.includes(cell)), random);
  // Spread targets across the board: greedy farthest-point from everything chosen so far.
  const selected = [], separation = [fromStart, distances(geometry, floors, exit)];
  for (let i = 0; i < t.targets * 2; i++) {
    let best = null, bestDistance = -1;
    for (const cell of pool) {
      if (selected.includes(cell)) continue;
      const distance = Math.min(...separation.map(map => map.get(cell) || 0));
      if (distance > bestDistance) { best = cell; bestDistance = distance; }
    }
    if (best === null) return null;
    selected.push(best); separation.push(distances(geometry, floors, best));
  }
  shuffle(selected, random);
  return { t, geometry, floors, floorList, start, exit, winds, bridges, letters: selected.slice(0, t.targets), seals: selected.slice(t.targets), random };
}

function rows(d, lights) {
  const size = d.geometry.size, out = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const cell = y * size + x;
      row += !d.floors.has(cell) ? '#' : cell === d.start ? 'S' : cell === d.exit ? 'E' : d.letters.includes(cell) ? 'L' : d.seals.includes(cell) ? 'T'
        : d.winds[cell] !== undefined ? WIND_CHARS[d.winds[cell]] : d.bridges.includes(cell) ? '=' : lights.includes(cell) ? '+' : '.';
    }
    out.push(row);
  }
  return out;
}

function generate(index) {
  const t = tier(index);
  let best = null;
  for (let attempt = 0; attempt < 600; attempt++) {
    const d = draft(index, attempt);
    if (!d) continue;
    const found = search(d.geometry, d, t.maxStates);
    if (!found || found.route.length > 95) continue;
    // Replay the witness to learn which cells it visits and whether wind and bridges matter.
    let player = d.start, windUsed = false;
    const torn = new Set(), visits = new Map();
    for (const action of found.route) {
      const direction = ACTIONS.indexOf(action);
      let next = player;
      if (direction < 4) {
        next = d.geometry.adjacent(player, direction);
        if (d.winds[next] !== undefined) {
          const pushed = d.geometry.adjacent(next, d.winds[next]);
          if (d.floors.has(pushed) && !torn.has(pushed)) { next = pushed; windUsed = true; }
        }
      }
      if (next !== player && d.bridges.includes(player)) torn.add(player);
      player = next;
      visits.set(player, (visits.get(player) || 0) + 1);
    }
    if (!windUsed || torn.size !== d.bridges.length) continue;
    // Lamps go on plain cells the witness crosses, one in each half of the route,
    // so the budget can count them and a stray lamp never pads the reserve.
    const reserved = new Set([d.start, d.exit, ...d.letters, ...d.seals, ...d.bridges, ...Object.keys(d.winds).map(Number)]);
    const path = [];
    player = d.start;
    for (const action of found.route) {
      const direction = ACTIONS.indexOf(action);
      let next = player;
      if (direction < 4) { next = d.geometry.adjacent(player, direction); if (d.winds[next] !== undefined) { const pushed = d.geometry.adjacent(next, d.winds[next]); if (d.floors.has(pushed)) next = pushed; } }
      player = next; path.push(player);
    }
    const half = Math.floor(path.length / 2);
    const pick = segment => shuffle(Array.from(new Set(segment.filter(cell => !reserved.has(cell) && visits.get(cell) === 1))), d.random)[0];
    const lights = [pick(path.slice(2, half)), pick(path.slice(half, -4))].filter(cell => cell !== undefined);
    if (lights.length !== t.lights || lights[0] === lights[1]) continue;
    const candidate = { rows: rows(d, lights), code: found.route.map(action => LETTERS[action]).join(''), par: found.route.length, states: found.states, t };
    if (!best || candidate.par > best.par) best = candidate;
    if (attempt >= 120 && best.par >= t.minPar + 6) break;
  }
  return best && best.par >= t.minPar ? best : null;
}

function verify(level) {
  let state = createState(level);
  for (const action of level.solution) {
    const result = step(level, state, action);
    if (!result.moved) throw new Error(level.id + ': witness blocked');
    state = result.state;
  }
  if (state.status !== 'won' || state.turn !== level.par) throw new Error(level.id + ': witness does not win at par');
  if (state.lights.length) throw new Error(level.id + ': witness skips a lamp');
  if (state.bridges.length) throw new Error(level.id + ': witness skips a bridge');
  const independent = solve(level, 400000);
  if (!independent || independent.length !== level.par) throw new Error(level.id + ': independent solver disagrees (' + (independent && independent.length) + ' vs ' + level.par + ')');
  return state;
}

function brief(level, reserve) {
  const winds = Object.keys(level.winds).length, bridges = level.bridges.length;
  const parts = [level.letters.length + ' 封信、' + level.seals.length + ' 枚邮票'];
  if (winds) parts.push(winds + ' 处风口');
  if (bridges) parts.push(bridges + ' 座只走一次的纸桥');
  return parts.join('，') + '；两盏灯已计入预算，灯火只比最短路多 ' + reserve + ' 拍。';
}

if (require.main === module) {
  const { parseLevel, reserveFor } = require('../src/levels');
  const output = [];
  const started = Date.now();
  for (let index = HAND_MADE; index < TOTAL; index++) {
    const result = generate(index);
    if (!result) throw new Error('No route found for ' + (index + 1));
    const chapter = Math.floor(index / PER_CHAPTER) - 5;
    const title = CHAPTER_WORDS[chapter % CHAPTER_WORDS.length] + TITLE_TAILS[index % PER_CHAPTER];
    const probe = parseLevel([title, result.rows, ''], index, result.code);
    const final = verify(probe);
    const text = brief(probe, reserveFor(index));
    output.push([title, result.rows, text, result.code]);
    console.error(JSON.stringify({ id: index + 1, size: result.t.size, par: result.par, budget: probe.budget, reserve: final.energy, states: result.states, targets: result.t.targets, bridges: probe.bridges.length }));
  }
  const source = "'use strict';\n\n// Generated by tools/generate.js. Do not edit by hand: rerun the generator.\n// Entries: [title, rows, brief, encoded witness]. Route ids continue after the hand-made campaign.\nmodule.exports = [\n" +
    output.map(entry => '  ' + JSON.stringify(entry)).join(',\n') + '\n];\n';
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'levels-extra.js'), source);
  console.error('Wrote ' + output.length + ' routes in ' + Math.round((Date.now() - started) / 100) / 10 + 's');
}

module.exports = { tier, generate, search, draft, HAND_MADE, PER_CHAPTER };
