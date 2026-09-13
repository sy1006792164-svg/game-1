'use strict';

const { SUPPLY_ENERGY, plainRecord } = require('./supply-rules');

// Only completed rewarded videos grant supplies; a new route starts empty.
const ITEMS = Object.freeze([
  Object.freeze({ id: 'oil', name: '灯油', icon: 'oil', unlock: 4,
    description: '补充 ' + SUPPLY_ENERGY + ' 拍灯火，能再走或等 ' + SUPPLY_ENERGY + ' 次。\n灯还亮着时，点下方按钮直接补充。\n不用选格子，不移动人物，也不耗拍。', short: '灯火 +' + SUPPLY_ENERGY }),
  Object.freeze({ id: 'kite', name: '纸鸢', icon: 'kite', unlock: 7,
    description: '隔空取回一封橙色信笺，省下绕路。\n直着数最多 2 格，拐弯数各 1 格。\n点亮起的信即可；隔墙也能取，不耗拍。\n只收信，不收蓝票，也不会踩桥。', short: '隔空收信' }),
  Object.freeze({ id: 'bridge', name: '修桥包', icon: 'bridge', unlock: 16,
    description: '修好一座断纸桥，让你能再走过去。\n先走到断桥旁，上下左右紧挨一格，\n再点亮起的断桥；每次只修一座。\n修好后再离开仍会碎，修桥不耗拍。', short: '修复断桥' }),
  Object.freeze({ id: 'echo', name: '回声笛', icon: 'echo', unlock: 31,
    description: '提前盖一张蓝票，省下等回声的时间。\n先踩上蓝票，在回声到来前使用。\n离开后也能用：点亮起的那张票即可。\n未踩过的票不能用；每次只盖一张。\n不耗拍、不补灯火，也不移动回声。', short: '提前盖蓝票' })
]);

function itemDefinition(id) { return ITEMS.find(item => item.id === id); }

function normalizeItemRewards(level, rewards) {
  const inventory = { oil: 0, kite: 0, bridge: 0 };
  if (rewards === undefined) return inventory;
  if (!plainRecord(rewards) || Object.getOwnPropertySymbols(rewards).length) throw new Error('invalid item rewards');
  for (const id of Object.getOwnPropertyNames(rewards)) {
    const item = itemDefinition(id), descriptor = Object.getOwnPropertyDescriptor(rewards, id);
    if (!item || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 4096) throw new Error('invalid item rewards');
    if (descriptor.value > 0 && level && (!(level.id >= item.unlock) ||
        (id === 'bridge' && !(level.bridges || []).length))) throw new Error('invalid item rewards');
    inventory[id] = descriptor.value;
  }
  return inventory;
}

function initialInventory(level, rewards) { return normalizeItemRewards(level, rewards); }

/** Only canonical, bounded integer cell strings are allowed in saved actions. */
function parseItemAction(action) {
  if (action === 'item:oil') return { id: 'oil', cell: null };
  if (typeof action !== 'string') return null;
  const match = /^item:(kite|bridge|echo):(0|[1-9]\d*)$/.exec(action);
  if (!match || match[0] !== action) return null;
  const cell = Number(match[2]);
  return Number.isSafeInteger(cell) ? { id: match[1], cell } : null;
}

function itemAction(id, cell) {
  if (id === 'oil') return 'item:oil';
  if ((id !== 'kite' && id !== 'bridge' && id !== 'echo') || !Number.isSafeInteger(cell) || cell < 0) return null;
  return 'item:' + id + ':' + cell;
}

function validCell(level, cell) {
  return Number.isSafeInteger(cell) && cell >= 0 && cell < level.width * level.height;
}

function distance(level, from, to) {
  return Math.abs(from % level.width - to % level.width) +
    Math.abs(Math.floor(from / level.width) - Math.floor(to / level.width));
}

// Geometry is independent of stock, so the UI can describe an unavailable item.
function candidateTargets(level, state, id) {
  if (!validCell(level, state.player)) return [];
  if (id === 'oil') return [state.player];
  if (id === 'kite') return (state.letters || []).filter(cell => validCell(level, cell) && distance(level, state.player, cell) <= 2);
  if (id === 'bridge') return (level.bridges || []).filter(cell => validCell(level, cell) &&
    !(state.bridges || []).includes(cell) && distance(level, state.player, cell) === 1);
  if (id === 'echo') {
    if (!Array.isArray(state.history) || !Number.isSafeInteger(state.turn) || state.turn < 0 ||
        state.history.length !== state.turn + 1) return [];
    // These landings reach the unmodified three-turn echo on actions 1–3.
    // Wind crossings never enter history, and repeated waits offer one stamp.
    const queued = state.history.slice(Math.max(0, state.turn - 2), state.turn + 1);
    return [...new Set(queued)].filter(cell => validCell(level, cell) && (state.seals || []).includes(cell));
  }
  return [];
}

function itemOffer(level, state, id) {
  const item = itemDefinition(id);
  const unavailable = reason => ({ eligible: false, reason, targets: [] });
  if (!item || !level) return unavailable('道具不可用');
  if (!(level.id >= item.unlock)) return unavailable('第 ' + item.unlock + ' 关解锁');
  if (id === 'bridge' && !(level.bridges || []).length) return unavailable('本关没有纸桥');
  if (!state || state.status !== 'playing') return unavailable('只能在投递中使用');
  const targets = candidateTargets(level, state, id);
  if (!targets.length) {
    if (id === 'kite') return unavailable((state.letters || []).length ? '两格内没有待收的信' : '信笺已全部收齐');
    if (id === 'echo') return unavailable((state.seals || []).length ? '先踩蓝票，趁回声还没到时使用' : '蓝票已全部盖好');
    const torn = (level.bridges || []).some(cell => !(state.bridges || []).includes(cell));
    return unavailable(torn ? '先走到断桥旁，上下左右紧挨一格' : '纸桥完好，无需修复');
  }
  return { eligible: true, reason: '', targets };
}

function itemAvailability(level, state, id) {
  const offer = itemOffer(level, state, id);
  if (!offer.eligible) return { available: false, reason: offer.reason, targets: [] };
  const stock = state.inventory && state.inventory[id];
  if (!Number.isSafeInteger(stock) || stock < 1 || stock > 4096) return { available: false, reason: '看完整视频领取', targets: [] };
  return { available: true, reason: '', targets: offer.targets };
}

function itemTargets(level, state, id) { return itemAvailability(level, state, id).targets; }

/** No route time passes: only the selected supply and its direct effect change. */
function applyItemAction(level, state, action, version = 2) {
  const parsed = parseItemAction(action);
  const unchanged = () => ({ state, moved: false, events: [] });
  if (!parsed) return unchanged();
  const availability = itemAvailability(level, state, parsed.id);
  if (!availability.available) return unchanged();
  const cell = parsed.cell === null ? state.player : parsed.cell;
  if (!availability.targets.includes(cell)) return unchanged();
  const next = { ...state, inventory: { ...state.inventory, [parsed.id]: state.inventory[parsed.id] - 1 }, itemsUsed: (state.itemsUsed || 0) + 1 };
  const events = [{ type: 'item', item: parsed.id, cell }];
  if (parsed.id === 'oil') {
    const amount = version === 1 ? 3 : SUPPLY_ENERGY;
    next.energy += amount;
    events.push({ type: 'light', cell, amount, source: 'oil' });
  } else if (parsed.id === 'kite') {
    next.letters = state.letters.filter(letter => letter !== cell);
    events.push({ type: 'letter', cell });
  } else if (parsed.id === 'echo') {
    next.seals = state.seals.filter(seal => seal !== cell);
    events.push({ type: 'seal', cell, source: 'echo-item' });
  } else {
    next.bridges = (state.bridges || []).concat(cell);
    events.push({ type: 'repair', cell });
  }
  return { state: next, moved: true, events };
}

module.exports = { ITEMS, itemTargets, itemOffer, itemAvailability, itemAction, parseItemAction, initialInventory, normalizeItemRewards, applyItemAction };
