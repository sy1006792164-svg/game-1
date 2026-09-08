'use strict';

// Deterministic procedural campaign routes for chapters 6 and later.
// `node tools/generate.js [total]` rewrites src/levels-extra.js so that the
// campaign holds `total` routes (default 999). Routes 1-30 stay hand made.
// Every generated route is solved by a compact BFS, replayed through the real
// engine via parseLevel and cross-checked by the independent tools/solve.js
// before it is written, so par is a verified minimum and the witness wins.
// Generation fans out across worker threads; the output is independent of the
// worker count because every route is seeded by its own index.
//
//   node tools/generate.js              # rebuild all 969 generated routes
//   node tools/generate.js 240          # a shorter campaign for experiments
//   node tools/generate.js --probe 40,200,700   # time a few indices, write nothing
//   node tools/generate.js --organize          # order existing maps within difficulty stages
//   node tools/generate.js --resume            # continue the last interrupted generation
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { createState, step } = require('../src/engine');
const { solve } = require('./solve');

const HAND_MADE = 30;
const PER_CHAPTER = 6;
const DEFAULT_TOTAL = 999;
const LETTERS = { up: 'U', down: 'D', left: 'L', right: 'R', wait: 'W' };
const ACTIONS = ['up', 'down', 'left', 'right', 'wait'];
const DELTAS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const WIND_CHARS = ['^', 'v', '<', '>'];

// Chapters 6-20 keep their original two-character words; later chapters draw
// fresh words from a scenery x place grid, and the very last chapter is 终章.
const CHAPTER_WORDS = ['雾巷', '纸桥', '逆风', '薄暮', '灯塔', '雪线', '潮汐', '千折', '暗巷', '风眼', '星海', '孤岛', '霜夜', '旧城', '灯河'];
const WORD_HEADS = '晨夜雨云月沙苔青赤银墨远春秋海山溪林萤芦松柳桂枫竹梅荷苇霞雁鹭渔'.split('');
const WORD_TAILS = '巷桥塔岸渡驿阁径洲坞堤窗檐谷岭湾港岛城楼亭野坡滩'.split('');
const CHAPTER_TAILS = ['来信', '回廊', '邮路', '夜渡', '晨光', '余晖', '灯语', '长信', '归途', '雪声', '潮信', '风过'];
const TITLE_TAILS = ['的来信', '回廊', '邮路', '折返', '灯语', '长信'];
const FINAL_WORD = '终章', FINAL_CHAPTER = '寄往终章';

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

/** Two-character word for a zero-based chapter (5 and later). Deterministic and unique across the campaign. */
function chapterWords(chapterCount) {
  const words = CHAPTER_WORDS.slice();
  const pool = [];
  for (const head of WORD_HEADS) for (const tail of WORD_TAILS) pool.push(head + tail);
  shuffle(pool, rng(20260908));
  for (const word of pool) {
    if (words.length >= chapterCount - 5 - 1) break;
    if (!words.includes(word)) words.push(word);
  }
  while (words.length < chapterCount - 5 - 1) words.push(words[words.length - 1] + '外');
  words.push(FINAL_WORD);
  return words;
}

/** Display names for zero-based chapters 20 and later; the first twenty stay hand written in levels.js. */
function chapterNames(chapterCount) {
  const words = chapterWords(chapterCount);
  const names = [];
  for (let chapter = 20; chapter < chapterCount; chapter++) {
    const word = words[chapter - 5];
    names.push(chapter === chapterCount - 1 ? FINAL_CHAPTER : word + CHAPTER_TAILS[(chapter * 7) % CHAPTER_TAILS.length]);
  }
  return names;
}

/**
 * Difficulty tier for a zero-based route index. The curve keeps climbing to the
 * end of the campaign: bigger boards, more letters and stamps, more winds and
 * one-way paper bridges, fewer lamps on the shortest route (lamps sit on the
 * witness path, so every lamp removed is one hint fewer), and a longer floor
 * for the shortest route. Light reserve and undo count shrink in levels.js.
 */
function tier(index) {
  const id = index + 1, chapter = Math.floor(index / PER_CHAPTER);
  const stage =
    id <= 36 ? { size: 6, targets: 3, winds: 2, bridges: 0, lights: 2, minPar: 28 } :
    id <= 48 ? { size: 6, targets: 3, winds: 2, bridges: 1, lights: 2, minPar: 28 } :
    id <= 60 ? { size: 6, targets: 4, winds: 2, bridges: 1, lights: 2, minPar: 30 } :
    id <= 72 ? { size: 7, targets: 4, winds: 2, bridges: 1, lights: 2, minPar: 36 } :
    id <= 90 ? { size: 7, targets: 4, winds: 3, bridges: 1, lights: 2, minPar: 36 } :
    id <= 120 ? { size: 7, targets: 5, winds: 3, bridges: 2, lights: 2, minPar: 40 } :
    id <= 180 ? { size: 8, targets: 5, winds: 3, bridges: 2, lights: 2, minPar: 46 } :
    id <= 240 ? { size: 8, targets: 5, winds: 3, bridges: 2, lights: 1, minPar: 48 } :
    id <= 300 ? { size: 8, targets: 6, winds: 3, bridges: 2, lights: 1, minPar: 50 } :
    id <= 360 ? { size: 8, targets: 6, winds: 4, bridges: 3, lights: 1, minPar: 52 } :
    id <= 480 ? { size: 9, targets: 6, winds: 4, bridges: 3, lights: 1, minPar: 58 } :
    id <= 600 ? { size: 9, targets: 6, winds: 4, bridges: 3, lights: 0, minPar: 60 } :
    id <= 780 ? { size: 9, targets: 6, winds: 4, bridges: 4, lights: 0, minPar: 62 } :
    { size: 10, targets: 6, winds: 4, bridges: 4, lights: 0, minPar: 68 };
  const size = stage.size;
  return {
    chapter, ...stage,
    maxRoute: size <= 7 ? 95 : size === 8 ? 110 : size === 9 ? 125 : 140,
    maxStates: size <= 6 ? 900000 : size === 7 ? 1500000 : size === 8 ? 2500000 : size === 9 ? 3500000 : 4500000,
    density: size === 6 ? .64 : size === 7 ? .6 : size === 8 ? .56 : size === 9 ? .56 : .54
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
 * States are packed into one number each so multi-million-state searches fit.
 */
function search(geometry, draft, maxStates) {
  const { floors, winds, start, exit, letters, seals, bridges } = draft;
  const EMPTY = 127, SLOT = 128, SLOTS = SLOT * SLOT * SLOT;
  const letterBit = new Uint16Array(SLOT), sealBit = new Uint16Array(SLOT), bridgeBit = new Uint16Array(SLOT);
  letters.forEach((cell, i) => { letterBit[cell] = 1 << i; });
  seals.forEach((cell, i) => { sealBit[cell] = 1 << (i + letters.length); });
  bridges.forEach((cell, i) => { bridgeBit[cell] = 1 << i; });
  const neighbors = new Int16Array(SLOT * 4).fill(-1), windLandings = new Int16Array(SLOT).fill(-1);
  for (const cell of floors) {
    for (let direction = 0; direction < 4; direction++) {
      const next = geometry.adjacent(cell, direction);
      if (floors.has(next)) neighbors[cell * 4 + direction] = next;
    }
    if (winds[cell] !== undefined) {
      const pushed = geometry.adjacent(cell, winds[cell]);
      if (floors.has(pushed)) windLandings[cell] = pushed;
    }
  }
  const fullMask = (1 << (letters.length + seals.length)) - 1, allBridges = (1 << bridges.length) - 1, BRIDGE_BASE = allBridges + 1;
  const key = (oldest, previous, player, collected, intact) => ((collected * BRIDGE_BASE + intact) * SLOTS) + (oldest * SLOT + previous) * SLOT + player;
  const first = key(EMPTY, EMPTY, start, 0, allBridges);
  // Bounded typed buffers avoid repeatedly growing and copying boxed arrays
  // during multi-million-state searches. A final expansion can add five nodes.
  const capacity = maxStates + 6;
  const queue = new Float64Array(capacity), parents = new Int32Array(capacity), moves = new Uint8Array(capacity);
  queue[0] = first; parents[0] = -1;
  const seen = new Set([first]);
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const packed = queue[head];
    const player = packed % SLOT;
    let rest = Math.floor(packed / SLOT);
    const previous = rest % SLOT; rest = Math.floor(rest / SLOT);
    const oldest = rest % SLOT; rest = Math.floor(rest / SLOT);
    const intact = rest % BRIDGE_BASE, collected = Math.floor(rest / BRIDGE_BASE);
    if (player === exit && collected === fullMask) {
      const route = [];
      for (let at = head; parents[at] >= 0; at = parents[at]) route.push(ACTIONS[moves[at]]);
      return { route: route.reverse(), states: seen.size };
    }
    if (seen.size > maxStates) return null;
    for (let action = 0; action < 5; action++) {
      let next = player;
      if (action < 4) {
        next = neighbors[player * 4 + action];
        if (next < 0 || (bridgeBit[next] && !(intact & bridgeBit[next]))) continue;
        const pushed = windLandings[next];
        if (pushed >= 0 && (!bridgeBit[pushed] || (intact & bridgeBit[pushed]))) next = pushed;
      }
      let bridgesLeft = intact;
      if (next !== player) bridgesLeft &= ~bridgeBit[player];
      const mask = collected | letterBit[next] | sealBit[oldest];
      const signature = key(previous, player, next, mask, bridgesLeft);
      if (seen.has(signature)) continue;
      seen.add(signature); queue[tail] = signature; parents[tail] = head; moves[tail] = action; tail++;
    }
  }
  return null;
}

function draft(index, attempt, fail = () => {}) {
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
  if (junctions < 4) return fail('draft:junctions');
  const start = floorList[Math.floor(random() * floorList.length)];
  // Winds prefer junctions, then corridors. Every standing cell stays reachable.
  const winds = {};
  const order = shuffle(floorList.slice(), random);
  const degree = cell => floorNeighbors(geometry, floors, cell).length;
  for (const candidate of [...order.filter(cell => degree(cell) >= 3), ...order.filter(cell => degree(cell) === 2)]) {
    if (Object.keys(winds).length >= t.winds) break;
    if (candidate === start) continue;
    const directions = floorNeighbors(geometry, floors, candidate);
    winds[candidate] = directions[Math.floor(random() * directions.length)];
    // Nobody can stand on a wind tile, so every other floor cell must stay
    // mutually reachable: no one-way pockets that trap the courier.
    const standing = floorList.filter(cell => winds[cell] === undefined);
    const connected = standing.every(from => { const seen = reachable(geometry, floors, winds, from); return standing.every(cell => seen.has(cell)); });
    if (!connected) delete winds[candidate];
  }
  if (Object.keys(winds).length < Math.min(2, t.winds)) return fail('draft:winds');
  const fromStart = distances(geometry, floors, start);
  const far = floorList.filter(cell => cell !== start && winds[cell] === undefined).sort((a, b) => fromStart.get(b) - fromStart.get(a));
  const exit = far[Math.floor(random() * Math.min(4, far.length))];
  // Bridges live in corridors, where tearing one really closes a passage, but
  // never on a cut cell: a torn bridge must not strand the courier or a target.
  const cutFree = cell => { const rest = new Set(floors); rest.delete(cell); return distances(geometry, rest, rest.values().next().value).size === rest.size; };
  const corridorCells = shuffle(floorList.filter(cell => cell !== start && cell !== exit && winds[cell] === undefined && floorNeighbors(geometry, floors, cell).length === 2 && cutFree(cell)), random);
  const bridges = corridorCells.slice(0, t.bridges);
  if (bridges.length < t.bridges) return fail('draft:bridges');
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
    if (best === null) return fail('draft:targets');
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

/** Walk the witness on the draft geometry: visited cells, whether wind mattered, which bridges tore. */
function walk(d, route) {
  let player = d.start, windUsed = false;
  const torn = new Set(), visits = new Map(), path = [];
  for (const action of route) {
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
    path.push(player);
    visits.set(player, (visits.get(player) || 0) + 1);
  }
  return { windUsed, torn, visits, path };
}

/** The witness must tear at least this many of the route's paper bridges; the rest are one-way traps. */
function bridgesRequired(count) { return Math.min(count, 2); }

/** Longest verified shortest route among the drafts of one index. A relaxed pass lowers the par floor by four when a tier's floor is out of reach for this seed. */
function generate(index, stats = {}) {
  const t = tier(index);
  const found = attemptRoutes(index, t, 0, stats);
  if (found) return found;
  stats.relaxed = true;
  return attemptRoutes(index, { ...t, minPar: t.minPar - 4 }, 600, stats);
}

function attemptRoutes(index, t, offset, stats) {
  const count = reason => { stats[reason] = (stats[reason] || 0) + 1; };
  let best = null, candidates = 0;
  for (let attempt = offset; attempt < offset + 600; attempt++) {
    const d = draft(index, attempt, reason => { count(reason); return null; });
    if (!d) continue;
    if (Object.keys(d.winds).length < t.winds - 1) { count('winds'); continue; }
    const found = search(d.geometry, d, t.maxStates);
    if (!found) { count('search'); continue; }
    if (found.route.length > t.maxRoute) { count('long'); continue; }
    const { windUsed, torn, visits, path } = walk(d, found.route);
    if (!windUsed) { count('noWind'); continue; }
    if (torn.size < bridgesRequired(d.bridges.length)) { count('bridges'); continue; }
    // Lamps go on plain cells the witness crosses exactly once, spread along
    // the route, so the budget can count them and a stray lamp never pads the reserve.
    const reserved = new Set([d.start, d.exit, ...d.letters, ...d.seals, ...d.bridges, ...Object.keys(d.winds).map(Number)]);
    const pick = segment => shuffle(Array.from(new Set(segment.filter(cell => !reserved.has(cell) && visits.get(cell) === 1))), d.random)[0];
    const lights = [];
    if (t.lights === 1) lights.push(pick(path.slice(2, -4)));
    if (t.lights === 2) { const half = Math.floor(path.length / 2); lights.push(pick(path.slice(2, half)), pick(path.slice(half, -4))); }
    if (lights.some(cell => cell === undefined) || new Set(lights).size !== lights.length) { count('lights'); continue; }
    const candidate = { rows: rows(d, lights), code: found.route.map(action => LETTERS[action]).join(''), par: found.route.length, states: found.states, t };
    candidates++;
    if (!best || candidate.par > best.par) best = candidate;
    // Four-bridge boards already have the strongest route constraints. Once
    // the exact shortest route meets the floor, extra drafts only add cost.
    if (t.bridges === 4 && best.par >= t.minPar) break;
    if (candidates >= 8 && best.par >= t.minPar + 4) break;
    if (candidates >= 20 && best.par >= t.minPar) break;
  }
  stats.candidates = candidates; stats.bestPar = best ? best.par : null;
  return best && best.par >= t.minPar ? best : null;
}

/** Replay through the real engine, then let the independent solver confirm par is the true minimum. */
function verify(level, states) {
  let state = createState(level);
  for (const action of level.solution) {
    const result = step(level, state, action);
    if (!result.moved) throw new Error(level.id + ': witness blocked');
    state = result.state;
  }
  if (state.status !== 'won' || state.turn !== level.par) throw new Error(level.id + ': witness does not win at par');
  if (state.lights.length) throw new Error(level.id + ': witness skips a lamp');
  if (level.bridges.length - state.bridges.length < bridgesRequired(level.bridges.length)) throw new Error(level.id + ': witness skips too many bridges');
  const independent = solve(level, Math.max(400000, states * 3));
  if (!independent) throw new Error(level.id + ': independent solver exhausted');
  if (independent.length !== level.par) throw new Error(level.id + ': independent solver disagrees (' + independent.length + ' vs ' + level.par + ')');
  return state;
}

function brief(level, reserve) {
  const winds = Object.keys(level.winds).length, bridges = level.bridges.length, lights = level.lights.length;
  const parts = [level.letters.length + ' 封信、' + level.seals.length + ' 枚邮票'];
  if (winds) parts.push(winds + ' 处风口');
  if (bridges) parts.push(bridges + ' 座只走一次的纸桥');
  const lamp = lights === 2 ? '两盏灯已计入预算，' : lights === 1 ? '仅一盏灯，已计入预算，' : '沿途没有灯火补给，';
  const margin = reserve > 0 ? '灯火只比最短路多 ' + reserve + ' 拍。' : '灯火恰好等于最短路，一步也不能多走。';
  return parts.join('，') + '；' + lamp + margin;
}

function titleFor(index, words) {
  const chapter = Math.floor(index / PER_CHAPTER) - 5;
  return words[Math.min(chapter, words.length - 1)] + TITLE_TAILS[index % PER_CHAPTER];
}

/** Build one finished route entry plus its report line. Runs inside workers. */
function build(index, words) {
  const { parseLevel, reserveFor } = require('../src/levels');
  const started = Date.now();
  const stats = {};
  const result = generate(index, stats);
  if (!result) throw new Error('No route found for ' + (index + 1) + ' ' + JSON.stringify({ tier: tier(index), stats }));
  const title = titleFor(index, words);
  const probe = parseLevel([title, result.rows, ''], index, result.code);
  const final = verify(probe, result.states);
  const text = brief(probe, reserveFor(index));
  return {
    index, entry: [title, result.rows, text, result.code],
    report: { id: index + 1, relaxed: !!stats.relaxed, size: result.t.size, targets: result.t.targets, winds: Object.keys(probe.winds).length, bridges: probe.bridges.length, lights: probe.lights.length, par: result.par, budget: probe.budget, reserve: final.energy, states: result.states, seconds: Math.round((Date.now() - started) / 100) / 10 }
  };
}

function runWorkers(indices, words, onResult, probe = false) {
  const threads = Math.max(1, Math.min(Number(process.env.GEN_THREADS) || os.cpus().length - 2, indices.length, 14));
  return new Promise((resolve, reject) => {
    let active = threads, cursor = 0;
    for (let thread = 0; thread < threads; thread++) {
      const worker = new Worker(__filename, { workerData: { words, probe }, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
      const feed = () => { if (cursor < indices.length) worker.postMessage(indices[cursor++]); else worker.postMessage(null); };
      worker.on('message', message => { if (message.error) reject(new Error(message.error)); else { onResult(message); feed(); } });
      worker.on('error', reject);
      worker.on('exit', () => { if (--active === 0) resolve(); });
      feed();
    }
  });
}

// A random seed should change the puzzle, not make the difficulty jump up and
// down. Within each mechanics/budget stage, introduce shorter routes first.
// Keep the map and its verified witness together; only its title/id change.
function organizeRoutes(messages, words) {
  const { parseLevel, reserveFor } = require('../src/levels');
  const stage = index => {
    const { size, targets, winds, bridges, lights, minPar } = tier(index);
    return [size, targets, winds, bridges, lights, minPar, reserveFor(index)].join('/');
  };
  const ordered = messages.slice().sort((a, b) => a.index - b.index);
  for (let first = 0; first < ordered.length;) {
    let end = first + 1;
    while (end < ordered.length && stage(ordered[end].index) === stage(ordered[first].index)) end++;
    const indices = ordered.slice(first, end).map(row => row.index);
    const group = ordered.slice(first, end).sort((a, b) => a.entry[3].length - b.entry[3].length ||
      a.report.winds - b.report.winds || (a.report.sourceId || a.report.id) - (b.report.sourceId || b.report.id));
    group.forEach((row, slot) => {
      const index = indices[slot], title = titleFor(index, words);
      const level = parseLevel([title, row.entry[1], ''], index, row.entry[3]);
      ordered[first + slot] = { index, entry: [title, row.entry[1], brief(level, reserveFor(index)), row.entry[3]],
        report: { ...row.report, sourceId: row.report.sourceId || row.report.id, id: index + 1, budget: level.budget } };
    });
    first = end;
  }
  return ordered;
}

function writeCampaign(messages, total) {
  const chapterCount = Math.ceil(total / PER_CHAPTER);
  const ordered = organizeRoutes(messages, chapterWords(chapterCount));
  const source = "'use strict';\n\n// Generated by tools/generate.js. Maps are ordered by shortest route within each difficulty stage.\n// chapters: names for zero-based chapters 20 and later.\n// routes: [title, rows, brief, encoded witness].\nmodule.exports = {\n  chapters: " +
    JSON.stringify(chapterNames(chapterCount)) + ',\n  routes: [\n' +
    ordered.map(row => '    ' + JSON.stringify(row.entry)).join(',\n') + '\n  ]\n};\n';
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'levels-extra.js'), source.replace(/\n/g, '\r\n'));
  fs.mkdirSync(path.join(__dirname, '..', 'work'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'work', 'generate-report.json'), JSON.stringify(ordered.map(row => row.report), null, 1));
  return ordered;
}

if (!isMainThread) {
  parentPort.on('message', index => {
    if (index === null) { parentPort.close(); return; }
    try { parentPort.postMessage(build(index, workerData.words)); } catch (error) { parentPort.postMessage(workerData.probe ? { index, entry: null, report: { id: index + 1, failed: error.message } } : { error: error.stack || String(error) }); }
  });
} else if (require.main === module && process.argv.includes('--organize')) {
  const { routes } = require('../src/levels-extra');
  const reports = require('../work/generate-report.json');
  if (routes.length !== reports.length) throw new Error('Route/report count mismatch');
  const ordered = writeCampaign(routes.map((entry, i) => ({ index: HAND_MADE + i, entry, report: reports[i] })), routes.length + HAND_MADE);
  console.log('Ordered ' + ordered.length + ' verified maps within their difficulty stages.');
} else if (require.main === module) {
  const probeAt = process.argv.indexOf('--probe');
  const total = probeAt >= 0 ? DEFAULT_TOTAL : Number(process.argv[2]) || DEFAULT_TOTAL;
  if (!Number.isInteger(total) || total <= HAND_MADE || total > DEFAULT_TOTAL) throw new Error('total must be 31..999');
  const chapterCount = Math.ceil(total / PER_CHAPTER);
  const words = chapterWords(chapterCount);
  const indices = probeAt >= 0
    ? String(process.argv[probeAt + 1] || '').split(',').map(Number).filter(Number.isInteger).map(id => id - 1)
    : Array.from({ length: total - HAND_MADE }, (_, i) => HAND_MADE + i);
  const started = Date.now();
  const results = new Map();
  const checkpoint = path.join(__dirname, '..', 'work', 'generation-v5-checkpoint.json');
  if (probeAt < 0) fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
  if (probeAt < 0 && process.argv.includes('--resume') && fs.existsSync(checkpoint)) {
    const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    if (saved.total !== total || saved.version !== '5') throw new Error('Checkpoint campaign version/size mismatch');
    const { parseLevel } = require('../src/levels');
    for (const row of saved.rows) {
      if (!indices.includes(row.index) || row.report.id !== row.index + 1 || results.has(row.index)) throw new Error('Invalid checkpoint index');
      // parseLevel replays and checks the cached witness against the engine.
      const level = parseLevel(row.entry, row.index, row.entry[3]);
      if (level.par !== row.report.par || level.budget !== row.report.budget) throw new Error('Checkpoint rules changed');
      results.set(row.index, row);
    }
    console.error('Resumed ' + results.size + ' verified maps.');
  }
  runWorkers(indices.filter(index => !results.has(index)), words, message => {
    results.set(message.index, message);
    if (probeAt < 0) {
      fs.writeFileSync(checkpoint + '.tmp', JSON.stringify({ total, version: '5', rows: Array.from(results.values()) }));
      fs.renameSync(checkpoint + '.tmp', checkpoint);
    }
    console.error(JSON.stringify({ done: results.size + '/' + indices.length, ...message.report }));
  }, probeAt >= 0).then(() => {
    if (probeAt >= 0) { console.error('Probe finished in ' + Math.round((Date.now() - started) / 100) / 10 + 's'); return; }
    const output = writeCampaign(indices.map(index => results.get(index)), total);
    console.error('Wrote ' + output.length + ' routes in ' + Math.round((Date.now() - started) / 100) / 10 + 's');
  }).catch(error => { console.error(error.stack || String(error)); process.exit(1); });
}

module.exports = { tier, bridgesRequired, generate, search, draft, chapterWords, chapterNames, organizeRoutes, HAND_MADE, PER_CHAPTER, DEFAULT_TOTAL };
