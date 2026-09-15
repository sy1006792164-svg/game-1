'use strict';

function stationCells(level) { return Object.keys(level.supplies || {}).map(Number); }

function pendingSupplyCells(level, state, item) {
  const cells = state ? state.supplies || [] : stationCells(level);
  return cells.filter(cell => level.supplies[cell] === item);
}

/** Route caches grant stock once. Only spending that stock counts as item use. */
function collectSupply(level, state, events) {
  if (!state.supplies || !state.supplies.includes(state.player)) return;
  const item = level.supplies[state.player];
  state.supplies = state.supplies.filter(cell => cell !== state.player);
  const before = state.inventory[item] || 0;
  const after = Math.min(4096, before + 1);
  state.inventory = { ...state.inventory, [item]: after };
  events.push({ type: 'supply', cell: state.player, item, amount: after - before });
}

module.exports = { stationCells, pendingSupplyCells, collectSupply };
