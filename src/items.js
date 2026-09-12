'use strict';

const { SUPPLY_ENERGY, plainRecord } = require('./supply-rules');

// Only completed rewarded videos grant supplies; a new route starts empty.
const ITEMS = Object.freeze([
  Object.freeze({ id: 'oil', name: '灯油', icon: 'oil', unlock: 4,
    description: '原地补充 ' + SUPPLY_ENERGY + ' 拍灯火。\n不耗拍，也不会移动你与回声。', short: '灯火 +' + SUPPLY_ENERGY }),
  Object.freeze({ id: 'kite', name: '纸鸢', icon: 'kite', unlock: 7,
    description: '取回横竖合计 2 格内的一封信。\n可以越过墙壁，不移动、不耗拍。', short: '隔空收信' }),
  Object.freeze({ id: 'bridge', name: '修桥包', icon: 'bridge', unlock: 16,
    description: '修复相邻的一座断纸桥，不耗拍。\n修好后可以再走，离开仍会碎。', short: '修复断桥' })
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
  const match = /^item:(kite|bridge):(0|[1-9]\d*)$/.exec(action);
  if (!match || match[0] !== action) return null;
  const cell = Number(match[2]);
  return Number.isSafeInteger(cell) ? { id: match[1], cell } : null;
}

function itemAction(id, cell) {
  if (id === 'oil') return 'item:oil';
  if ((id !== 'kite' && id !== 'bridge') || !Number.isSafeInteger(cell) || cell < 0) return null;
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
  if (!targets.length) return unavailable(id === 'kite' ? '横竖 2 格内没有待收的信' : '身边没有断纸桥');
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
  } else {
    next.bridges = (state.bridges || []).concat(cell);
    events.push({ type: 'repair', cell });
  }
  return { state: next, moved: true, events };
}

module.exports = { ITEMS, itemTargets, itemOffer, itemAvailability, itemAction, parseItemAction, initialInventory, normalizeItemRewards, applyItemAction };
