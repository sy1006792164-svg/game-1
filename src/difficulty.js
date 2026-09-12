'use strict';

const { createState, step } = require('./engine');
const { SUPPLY_ENERGY } = require('./supply-rules');

const TIER_NAMES = ['回声进阶', '分岔挑战', '长途挑战', '极限规划', '大师邮路'];

function additionsFor(index) {
  if (index < 3) return { letters: 0, seals: 0 };
  if (index < 30) return index % 2 ? { letters: 1, seals: 0 } : { letters: 0, seals: 1 };
  const count = index < 300 ? 1 : 2;
  return { letters: count, seals: count };
}

/** Add objectives only on ordinary cells that the original winning route collects.
 * Existing objectives remain mandatory: adding constraints cannot create a route
 * shorter than the previously verified minimum, while its witness still wins.
 */
function strengthenObjectives(level) {
  const requested = additionsFor(level.id - 1);
  if (!requested.letters && !requested.seals) return { letters: [], seals: [] };
  const occupied = new Set([level.start, level.exit, ...level.walls, ...level.letters,
    ...level.seals, ...level.lights, ...level.bridges, ...Object.keys(level.winds).map(Number)]);
  const visits = new Map(), echoes = new Set(), finalVisits = new Map();
  let state = createState({ ...level, budget: level.solution.length + 1 });
  for (const action of level.solution) {
    const result = step(level, state, action);
    if (!result.moved) throw new Error('Invalid difficulty witness: ' + level.id);
    state = result.state;
    visits.set(state.player, (visits.get(state.player) || 0) + 1);
    finalVisits.set(state.player, state.turn);
    if (state.echo !== null) echoes.add(state.echo);
  }
  if (state.status !== 'won') throw new Error('Unfinished difficulty witness: ' + level.id);
  const distance = (a, b) => Math.abs(a % level.width - b % level.width) +
    Math.abs(Math.floor(a / level.width) - Math.floor(b / level.width));
  const degree = cell => {
    const x = cell % level.width, y = Math.floor(cell / level.width);
    return [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]].filter(([nx, ny]) =>
      nx >= 0 && nx < level.width && ny >= 0 && ny < level.height && !level.walls.includes(ny * level.width + nx)).length;
  };
  const timingCells = new Set(Array.from(echoes).filter(cell => finalVisits.get(cell) > level.par - 3));
  const originalTargets = [level.exit, ...level.letters, ...level.seals];
  const optional = new Map();
  const geometryOptional = removed => {
    if (optional.has(removed)) return optional.get(removed);
    const reached = new Set([level.start]), queue = [level.start];
    for (let index = 0; index < queue.length; index++) {
      const cell = queue[index], x = cell % level.width, y = Math.floor(cell / level.width);
      for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]) {
        const next = ny * level.width + nx;
        if (nx < 0 || nx >= level.width || ny < 0 || ny >= level.height || next === removed ||
          level.walls.includes(next) || reached.has(next)) continue;
        reached.add(next); queue.push(next);
      }
    }
    const result = originalTargets.every(cell => reached.has(cell));
    optional.set(removed, result);
    return result;
  };
  const added = { letters: [], seals: [], timingSeals: [] };
  const selected = [...level.letters, ...level.seals];
  const pick = (kind, candidates, count) => {
    for (let index = 0; index < count; index++) {
      let cell = null, bestScore = -Infinity;
      for (const candidate of candidates) {
        if (occupied.has(candidate)) continue;
        // A stamp revisited in the final three turns must be reached earlier;
        // its last visit is too late for the echo. Other objectives favor cells
        // that geometry alone did not previously require and spread across forks.
        const score = Math.min(...selected.map(other => distance(candidate, other))) * 5 +
          Math.max(0, degree(candidate) - 2) * 4 + Math.min(3, visits.get(candidate) || 0) +
          (geometryOptional(candidate) ? 100 : 0) + (kind === 'seals' && timingCells.has(candidate) ? 1000 : 0);
        // Only the winning cell is needed. Score each candidate once and keep
        // the same smallest-cell tie break without sorting the whole board.
        if (cell === null || score > bestScore || score === bestScore && candidate < cell) {
          cell = candidate; bestScore = score;
        }
      }
      if (cell === null) throw new Error('Missing difficulty objective: ' + level.id + '/' + kind);
      occupied.add(cell); selected.push(cell); added[kind].push(cell); level[kind].push(cell);
      if (kind === 'seals' && timingCells.has(cell)) added.timingSeals.push(cell);
    }
  };
  // Echo candidates are a subset of visited cells and must be reserved first.
  pick('seals', Array.from(echoes), requested.seals);
  pick('letters', Array.from(visits.keys()), requested.letters);
  return added;
}

/** One shared challenge contract for route cards, supply advice and daily progress. */
function difficultyProfile(level) {
  if (!level) return null;
  const id = Number.isSafeInteger(level.id) ? level.id : 1;
  const tier = id <= 6 ? 1 : id <= 30 ? 2 : id <= 120 ? 3 : id <= 360 ? 4 : 5;
  const additions = level.difficultyAdditions || { letters: [], seals: [] };
  const reserve = Math.max(0, level.budget + (level.lights || []).length * 3 - level.par);
  const letters = (level.letters || []).length, seals = (level.seals || []).length;
  const bridges = (level.bridges || []).length;
  const timingTargets = (additions.timingSeals || []).length;
  const echoFocus = id >= 31 && (timingTargets > 0 || (bridges < 3 && seals >= 4));
  const recommendedItem = id < 4 ? null : echoFocus ? 'echo' : bridges >= 3 ? 'bridge' : id >= 7 && letters >= 3 ? 'kite' : 'oil';
  const itemReason = recommendedItem === 'bridge' ? '纸桥离开即断，修桥包可补救相邻断桥。'
    : recommendedItem === 'echo' ? '先踩过蓝票；回声笛仅能提前盖好回声队列中的一枚待收蓝票，不能收从未经过的票。'
    : recommendedItem === 'kite' ? '信笺分散，纸鸢可取回两格内的信，减少折返。'
    : recommendedItem === 'oil' ? '灯油可补充 ' + SUPPLY_ENERGY + ' 拍灯火，为规划失误留出余地。' : '先掌握三拍回声，再挑战最短路线。';
  const focus = timingTargets ? '末段有蓝票需要提前经过，等回声盖好再回邮局。'
    : bridges >= 3 ? '先安排过桥顺序，再把回声盖票与收信串成一条路。'
    : seals >= 4 ? '先规划远端蓝票，提前三拍经过，再顺路收信回邮局。'
    : id >= 7 ? '把分散信笺与蓝票一起规划，减少支路折返。'
    : '每次行动扣一拍，蓝票由晚三拍的回声收取。';
  return {
    tier, name: TIER_NAMES[tier - 1], reserve, targetCount: letters + seals,
    addedLetters: additions.letters.length, addedSeals: additions.seals.length, timingTargets,
    summary: letters + '信' + seals + '票 · ' + (reserve ? '余量' + reserve + '拍' : '零余量'),
    focus, recommendedItem, itemReason, journeyPoints: tier <= 2 ? 1 : tier <= 4 ? 2 : 3
  };
}

function challengeBrief(level, original) {
  const letters = level.letters.length, seals = level.seals.length;
  let brief = original
    .replace(/\d+ 封信、\d+ 枚邮票/g, letters + ' 封信、' + seals + ' 枚邮票')
    .replace(/[一二三四五六七八九十]+封信/g, letters + '封信')
    .replace(/[一二三四五六七八九十]+枚邮票/g, seals + '枚邮票')
    .replace(/三信三票/g, letters + '信' + seals + '票');
  brief = brief.replace(/灯火只比最短路多 \d+ 拍。|灯火恰好等于最短路，一步也不能多走。/g, '');
  return '本关' + letters + '信' + seals + '票。' + brief +
    (level.difficulty.reserve ? '灯火余量' + level.difficulty.reserve + '拍。' : '灯火零余量，每一拍都要规划。');
}

module.exports = { additionsFor, strengthenObjectives, difficultyProfile, challengeBrief };
