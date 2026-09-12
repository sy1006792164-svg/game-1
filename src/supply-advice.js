'use strict';

const { ITEMS, itemOffer } = require('./items');
const { DIRECTIONS, STAR_TWO_MARGIN, neighbor, step } = require('./engine');
const { SUPPLY_ENERGY } = require('./supply-rules');
const { difficultyProfile } = require('./difficulty');

const LABELS = Object.freeze({ oil: '灯油留余量', kite: '纸鸢省绕行', bridge: '修桥接回路', echo: '回声笛提前盖票' });
const result = (itemId, reason) => ({ itemId, reason, label: LABELS[itemId] || '先规划路线' });

function distance(level, from, to) {
  return Math.abs(from % level.width - to % level.width) +
    Math.abs(Math.floor(from / level.width) - Math.floor(to / level.width));
}

// A local topology estimate, not a solution: future bridge damage, collection
// order and the echo's timing still have to be planned by the player.
function routeDistances(level, state) {
  const distances = new Map([[state.player, 0]]), queue = [state.player];
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    for (const direction of Object.keys(DIRECTIONS)) {
      const entered = neighbor(level, from, direction, state);
      if (entered === null) continue;
      const wind = level.winds && level.winds[entered];
      const pushed = wind ? neighbor(level, entered, wind, state) : null;
      const landing = pushed === null ? entered : pushed;
      if (distances.has(landing)) continue;
      distances.set(landing, distances.get(from) + 1);
      queue.push(landing);
    }
  }
  return distances;
}

function remainingTargets(level, state) {
  const history = state.history || [];
  const queuedEcho = history.slice(Math.max(0, state.turn - 2), state.turn + 1);
  return [...new Set([level.exit, ...(state.letters || []),
    ...(state.seals || []).filter(cell => !queuedEcho.includes(cell))])];
}

function unlockedForPlanning(level, id) {
  const item = ITEMS.find(value => value.id === id);
  if (!item || !(level.id >= item.unlock)) return false;
  if (id === 'kite') return (level.letters || []).some(cell => cell !== level.start);
  if (id === 'bridge') return (level.bridges || []).length > 0;
  if (id === 'echo') return (level.seals || []).length > 0;
  return true;
}

/** Preparation is future planning, never authorization to grant or use stock. */
function preparationAdvice(level) {
  if (!level) return result(null, '先看清信笺、蓝票和邮局，给回声留出三拍。');
  const profile = level.difficulty || difficultyProfile(level) || {};
  const preferred = profile.recommendedItem;
  const itemId = [preferred, 'oil'].find(id => unlockedForPlanning(level, id));
  if (!itemId) return result(null, profile.focus || '先掌握三拍回声，把收信与盖票串成一路。');
  if (itemId === 'bridge') return result(itemId, '先安排过桥顺序；走到断桥旁时，修桥包可修复一座。');
  if (itemId === 'kite') return result(itemId, '信笺分散；靠近两格内时，纸鸢可取一封，蓝票仍靠回声。');
  if (itemId === 'echo') return result(itemId, '先踩过蓝票；回声笛仅能提前盖回声队列中的一枚待收蓝票，不能收从未经过的票，也不补灯火。');
  const reserve = profile.reserve;
  const context = reserve === 0 ? '本关灯火零余量；' : Number.isFinite(reserve) && reserve <= 2 ? '本关灯火余量' + reserve + '拍；' : '';
  return result(itemId, context + '灯油可补' + SUPPLY_ENERGY + '拍，仍需安排剩余路线。');
}

/** Recommend only an unlocked tool with a valid current target, even at zero stock. */
function supplyAdvice(level, state) {
  if (!level || !state || state.status !== 'playing') return null;
  const offers = {};
  for (const item of ITEMS) offers[item.id] = itemOffer(level, state, item.id);
  if (!ITEMS.some(item => offers[item.id].eligible)) return null;

  // Do not ask for a supply when one ordinary move or wait already finishes.
  for (const action of [...Object.keys(DIRECTIONS), 'wait']) {
    const next = step(level, state, action);
    if (next.moved && next.state.status === 'won') return null;
  }

  // Only claim a timing benefit when the final stamp's ordinary wait is known.
  // Other remaining objectives still require route planning and may need oil.
  if (offers.echo && offers.echo.eligible && state.player === level.exit &&
      !(state.letters || []).length && (state.seals || []).length === 1) {
    const seal = state.seals[0], history = state.history || [];
    let waiting = 0;
    for (let delay = 1; delay <= 3; delay++) {
      if (history[state.turn + delay - 3] === seal) { waiting = delay; break; }
    }
    if (waiting >= 2 && offers.echo.targets.includes(seal)) {
      const twoStarLimit = Math.max(1, level.par || level.budget) + STAR_TWO_MARGIN;
      if (state.energy < waiting) {
        return result('echo', '已在邮局，只差队列中一枚蓝票；正常还需等' + waiting + '拍，灯火不足。回声笛可提前盖这一枚，不补灯火，使用后最多二星。');
      }
      if ((state.itemsUsed > 0 || state.revived) && state.turn <= twoStarLimit && state.turn + waiting > twoStarLimit) {
        return result('echo', '已在邮局，只差队列中一枚蓝票；再等' + waiting + '拍会超出二星步数。回声笛可提前盖这一枚，使用后最多二星。');
      }
      // There is no light shortfall or demonstrated rating rescue for an assisted run.
      return null;
    }
  }

  const routes = routeDistances(level, state), targets = remainingTargets(level, state);
  if (offers.bridge.eligible) {
    for (const bridge of offers.bridge.targets) {
      const repaired = routeDistances(level, { ...state, bridges: (state.bridges || []).concat(bridge) });
      if (targets.some(cell => repaired.has(cell) && !routes.has(cell))) {
        return result('bridge', '相邻断桥可修复，可能接回通往剩余目标的路。');
      }
      if (targets.some(cell => repaired.has(cell) && routes.get(cell) - repaired.get(cell) >= 2)) {
        return result('bridge', '相邻断桥可修复，可能减少前往剩余目标的绕行。');
      }
    }
  }

  if (offers.kite.eligible) {
    const detour = offers.kite.targets.some(cell => !routes.has(cell) || routes.get(cell) > distance(level, state.player, cell));
    if (detour) return result('kite', '两格内有需要绕行的信；纸鸢可原地取一封，蓝票另走。');
    if (state.player === level.exit && (state.letters || []).length === 1 && !(state.seals || []).length) {
      return result('kite', '已在邮局，最后一封信在两格内；纸鸢可原地取回。');
    }
  }

  if (offers.oil.eligible) {
    const count = (state.letters || []).length + (state.seals || []).length;
    if (state.energy <= 6 || state.energy <= count * 2 + 3) {
      const goal = count ? '还有' + count + '个收集目标' : '还需抵达邮局';
      return result('oil', '余下' + state.energy + '拍，' + goal + '；灯油可补' + SUPPLY_ENERGY + '拍。');
    }
  }

  if (state.turn === 0) {
    const preparation = preparationAdvice(level);
    const profile = level.difficulty || difficultyProfile(level) || {};
    if (preparation.itemId && offers[preparation.itemId].eligible &&
        (profile.tier >= 3 || profile.reserve <= 2)) return preparation;
  }
  return null;
}

module.exports = { supplyAdvice, preparationAdvice };
