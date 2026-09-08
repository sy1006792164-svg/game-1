'use strict';

// Level design workbench. `node tools/design.js scan <id> [max-bridges]` lists
// paper-bridge placements for a campaign route with the resulting shortest
// witness and the constraints the tests enforce; `node tools/design.js check`
// prints the same metrics for the current campaign.
const { CAMPAIGN, parseLevel } = require('../src/levels');
const { createState, step } = require('../src/engine');
const { solve } = require('./solve');

const LETTERS = { up: 'U', down: 'D', left: 'L', right: 'R', wait: 'W' };
const encode = solution => solution.map(action => LETTERS[action]).join('');

function junctions(level) {
  return Array.from({ length: level.width * level.height }, (_, cell) => cell).filter(cell => {
    if (level.walls.includes(cell)) return false;
    const x = cell % level.width, y = Math.floor(cell / level.width);
    return [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]].filter(([nx, ny]) =>
      nx >= 0 && nx < level.width && ny >= 0 && ny < level.height && !level.walls.includes(ny * level.width + nx)).length >= 3;
  }).length;
}

function evaluate(rows, index, title, brief) {
  const level = parseLevel([title || 'draft', rows, brief || ''], index, '');
  const solution = solve(level, 900000);
  if (!solution) return { solvable: false, rows };
  const solved = parseLevel([title || 'draft', rows, brief || ''], index, encode(solution));
  let state = createState(solved), firstWind = null, bridgesTorn = 0, visits = {};
  for (const action of solution) {
    const result = step(solved, state, action);
    state = result.state;
    if (firstWind === null && result.events.some(e => e.type === 'wind')) firstWind = state.turn;
    bridgesTorn += result.events.filter(e => e.type === 'bridge').length;
    visits[state.player] = (visits[state.player] || 0) + 1;
  }
  return { solvable: true, rows, par: solution.length, code: encode(solution), junctions: junctions(solved), firstWind, lampsLeft: state.lights.length, lamps: solved.lights.length, bridges: solved.bridges.length, bridgesTorn, visits };
}

function scan(id, maxBridges) {
  const index = id - 1;
  const spec = SPECS[index];
  const before = evaluate(spec, index);
  console.log('base', JSON.stringify({ par: before.par, code: before.code, junctions: before.junctions, firstWind: before.firstWind, lampsLeft: before.lampsLeft }));
  const cells = [];
  spec.forEach((row, y) => row.split('').forEach((ch, x) => { if (ch === '.') cells.push(y * spec[0].length + x); }));
  // Prefer cells the current witness crosses more than once: a bridge there
  // really removes the route instead of decorating an unused corner.
  const busy = cells.filter(cell => (before.visits[cell] || 0) >= 1).sort((a, b) => (before.visits[b] || 0) - (before.visits[a] || 0));
  const results = [];
  const combos = maxBridges >= 2 ? busy.flatMap((a, i) => busy.slice(i + 1).map(b => [a, b])) : [];
  for (const set of [...busy.map(cell => [cell]), ...combos]) {
    const draft = spec.map((row, y) => row.split('').map((ch, x) => set.includes(y * row.length + x) ? '=' : ch).join(''));
    const result = evaluate(draft, index);
    if (!result.solvable) continue;
    const ok = result.junctions >= 3 && (index < 12 || result.firstWind !== null) && (index < 18 || result.lampsLeft === 0) && result.bridgesTorn === set.length;
    results.push({ set, ok, par: result.par, delta: result.par - before.par, code: result.code, firstWind: result.firstWind, lampsLeft: result.lampsLeft });
  }
  results.filter(r => r.ok).sort((a, b) => b.delta - a.delta).slice(0, 25).forEach(r => console.log(JSON.stringify(r)));
}

const SPECS = require('../src/levels').SPECS;

if (require.main === module) {
  const [command, id, extra] = process.argv.slice(2);
  if (command === 'scan') scan(Number(id), Number(extra) || 1);
  else if (command === 'check') {
    for (const level of CAMPAIGN) {
      const rows = SPECS[level.id - 1];
      const result = evaluate(rows, level.id - 1, level.title, level.brief);
      console.log(JSON.stringify({ id: level.id, par: level.par, budget: level.budget, shortest: result.par, same: result.code === encode(level.solution), junctions: result.junctions, firstWind: result.firstWind, lampsLeft: result.lampsLeft, bridges: result.bridges, bridgesTorn: result.bridgesTorn }));
    }
  }
}

module.exports = { evaluate, encode, junctions };

/** Try one-time shortcuts (wall → bridge) and forced detours (corridor → bridge + a wall opened). */
function scan2(id, override, broad) {
  const index = id - 1, spec = override || SPECS[index], width = spec[0].length;
  const before = evaluate(spec, index);
  console.log('base', JSON.stringify({ par: before.par, code: before.code, junctions: before.junctions, firstWind: before.firstWind }));
  const floors = [], walls = [];
  spec.forEach((row, y) => row.split('').forEach((ch, x) => { const cell = y * width + x; if (ch === '.') floors.push(cell); if (ch === '#') walls.push(cell); }));
  const busy = floors.filter(cell => (before.visits[cell] || 0) >= (broad ? 1 : 2));
  const drafts = [];
  const edge = cell => { const x = cell % width, y = Math.floor(cell / width); return x === 0 || y === 0 || x === width - 1 || y === spec.length - 1; };
  for (const wall of walls) drafts.push({ kind: 'shortcut', set: [wall], changes: { [wall]: '=' } });
  for (const cell of busy) for (const wall of walls) drafts.push({ kind: 'detour', set: [cell], open: wall, changes: { [cell]: '=', [wall]: '.' } });
  const results = [];
  for (const draft of drafts) {
    const rows = spec.map((row, y) => row.split('').map((ch, x) => draft.changes[y * width + x] || ch).join(''));
    const result = evaluate(rows, index);
    if (!result.solvable) continue;
    const ok = result.junctions >= 3 && (index < 12 || result.firstWind !== null) && (index < 18 || result.lampsLeft === 0) && result.bridgesTorn === 1;
    if (!ok || result.code === before.code) continue;
    results.push({ kind: draft.kind, set: draft.set, open: draft.open, par: result.par, delta: result.par - before.par, code: result.code, firstWind: result.firstWind, rows });
  }
  results.sort((a, b) => b.delta - a.delta);
  results.slice(0, 14).forEach(r => console.log(JSON.stringify(r)));
  console.log('total', results.length, 'edgeUnused', edge(0));
}
if (require.main === module && process.argv[2] === 'scan2') scan2(Number(process.argv[3]), process.argv[4] ? JSON.parse(process.argv[4]) : undefined);
if (require.main === module && process.argv[2] === 'scan3') scan2(Number(process.argv[3]), undefined, true);
