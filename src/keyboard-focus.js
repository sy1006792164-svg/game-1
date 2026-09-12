'use strict';

const { itemOffer } = require('./items');

function sameContext(game, focus) {
  return focus && focus.page === game.page && focus.modal === game.modal &&
    focus.session === game.session && focus.state === game.state && focus.item === game.selectedItem;
}

function focusTargets(game) {
  const r = game.renderer;
  if (game.hidden || game.busy || game.startupActive() || game.modal && r.currentModal !== game.modal) return [];
  const targets = [], cells = new Set();
  const aiming = !game.modal && game.selectedItem && game.state;
  const allowed = aiming ? new Set(itemOffer(game.level, game.state, game.selectedItem).targets) : null;
  for (const hit of r.hits) {
    if (typeof hit.action !== 'function') continue;
    const cell = hit.action.boardCell;
    if (Number.isInteger(cell)) {
      // Walking already has direct arrow keys. Only legal item destinations
      // join Tab navigation, once each, regardless of overlapping prop art.
      if (!allowed || !allowed.has(cell) || cells.has(cell)) continue;
      const p = r.boardProjection, rect = r.boardRect;
      if (!p || !rect) continue;
      const [x, y] = p.point(cell);
      if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) continue;
      cells.add(cell); targets.push({ ...hit, key: 'cell:' + cell, cell });
    } else {
      if (hit.contains && !hit.contains(hit.x + hit.w / 2, hit.y + hit.h / 2)) continue;
      targets.push({ ...hit, key: hit.action.focusId || (hit.action.itemId ? 'item:' + hit.action.itemId :
        [hit.label || '', hit.x, hit.y, hit.w, hit.h].join('|')) });
    }
  }
  return targets;
}

function focusedTarget(game, targets) {
  if (!sameContext(game, game.keyboardFocus)) return null;
  if (!targets) targets = focusTargets(game);
  return targets.find(hit => hit.key === game.keyboardFocus.key) || null;
}

function handleFocusKey(game, key) {
  if (key !== 'Tab' && key !== 'Shift+Tab' && key !== 'Enter') {
    game.keyboardFocus = null; return null;
  }
  if (key === 'Tab' || key === 'Shift+Tab') {
    // Keyboard ownership ends the old touch and its inertia before sampling
    // controls; otherwise a released finger is lost or a moving row loses focus.
    game.cancelRankingPointer(); game.stopListScrolling();
    game.pointer = null; game.renderer.pointer = null; game.pendingAction = null;
    game.renderer.draw(game, game.platform.now(), game.metrics);
  }
  const targets = focusTargets(game), current = focusedTarget(game, targets);
  if (key === 'Enter') {
    if (!current) { game.keyboardFocus = null; return null; }
    game.keyboardFocus = null;
    game.pointer = null; game.renderer.pointer = null; game.renderer.hits = [];
    current.action({ x: current.x + current.w / 2, y: current.y + current.h / 2 });
    game.lastFrame = -Infinity; game.syncMusic();
    return true;
  }
  const index = current ? targets.findIndex(hit => hit.key === current.key) : -1;
  const next = current ? index + (key === 'Tab' ? 1 : -1) : key === 'Tab' ? 0 : targets.length - 1;
  game.pointer = null; game.renderer.pointer = null;
  game.pendingAction = null; game.lastFrame = -Infinity;
  if (!targets[next]) {
    // Returning false lets the browser move focus out of the canvas normally.
    game.keyboardFocus = null; return false;
  }
  game.keyboardFocus = { key: targets[next].key, page: game.page, modal: game.modal,
    session: game.session, state: game.state, item: game.selectedItem };
  return true;
}

function drawKeyboardFocus(r, game) {
  const hit = focusedTarget(game);
  if (!hit) { game.keyboardFocus = null; return; }
  r.ctx.save();
  if (Number.isInteger(hit.cell)) {
    const p = r.boardProjection, [x, y] = p.point(hit.cell), w = p.halfW, h = p.halfH;
    const points = [[x, y - h], [x + w, y], [x, y + h], [x - w, y], [x, y - h]];
    r.line(points, '#fffdf4', 6); r.line(points, '#285b52', 2.5);
  } else {
    r.round(hit.x - 3, hit.y - 3, hit.w + 6, hit.h + 6, 10, null, '#fffdf4');
    r.round(hit.x - 2, hit.y - 2, hit.w + 4, hit.h + 4, 9, null, '#285b52');
    r.round(hit.x - 1, hit.y - 1, hit.w + 2, hit.h + 2, 8, null, '#285b52');
  }
  r.ctx.restore();
}

module.exports = { focusTargets, focusedTarget, handleFocusKey, drawKeyboardFocus };
