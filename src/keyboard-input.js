'use strict';

const { DIRECTIONS } = require('./engine');
const { stampDetailKey } = require('./stamp-detail-view');

const SCROLL_DELTA = Object.freeze({ ArrowUp: -100, ArrowDown: 100, PageUp: -340, PageDown: 340, ' ': 340 });
const MOVES = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', ' ': 'wait', Space: 'wait' });

// A modal owns keyboard input until its own close action returns to the prior view.
function handleGameKey(game, key) {
  if (game.hidden || game.busy || game.startupActive() || typeof key !== 'string') return false;
  game.unlockAudio();
  if (game.development && game.modal && game.modal.kind === 'developer-level') {
    game.developmentKey(key); return true;
  }
  if (stampDetailKey(game, key)) return true;
  if (game.modal) {
    if (game.modal.kind === 'item') {
      if (key === 'Escape') {
        const close = game.modal.buttons[game.modal.buttons.length - 1];
        if (close) close.action();
      } else if (key === 'Enter') {
        const primary = game.modal.buttons.find(button => button.primary);
        if (primary) primary.action();
      }
      return true;
    }
    const navigation = game.renderer.helpNavigation;
    if (game.modal.kind === 'help' && navigation && navigation.modal === game.modal) {
      if ((key === 'ArrowLeft' || key === 'PageUp') && navigation.page > 0) navigation.previous();
      else if ((key === 'ArrowRight' || key === 'PageDown') && navigation.page + 1 < navigation.count) navigation.next();
    }
    if (key === 'Escape') {
      if (game.modal.kind === 'help') {
        game.modal.buttons[0].action();
        game.pointer = null; game.renderer.hits = [];
        game.syncMusic();
      } else if (game.modal.kind === 'pause' && game.page === 'game') game.pause();
    }
    return true;
  }
  if (key === 'Escape') {
    if (game.page === 'game' && game.selectedItem) game.cancelItem();
    else if (game.page === 'game') game.pause();
    else if (['levels', 'collection', 'leaderboard', 'settings'].includes(game.page)) game.home();
    return true;
  }
  const delta = SCROLL_DELTA[key], edge = key === 'Home' || key === 'End';
  if (game.rankingInteractive() && (edge || delta)) {
    if (game.pointer && game.pointer.ranking) game.cancelRankingPointer();
    if (edge) game.friendLeaderboard.scroll(key === 'Home' ? 'start' : 'end', game.platform.now());
    else game.friendLeaderboard.wheel(delta, game.platform.now());
    return true;
  }
  const scroll = game.listScroll();
  if (scroll && (edge || delta)) {
    game.pointer = null;
    if (edge) { scroll.stop(); scroll.offset = key === 'Home' ? 0 : scroll.max; }
    else scroll.wheel(delta, game.platform.now());
    return true;
  }
  if (game.page !== 'game') return false;
  if (['1', '2', '3'].includes(key) && typeof game.selectItem === 'function') {
    game.selectItem(['oil', 'kite', 'bridge'][Number(key) - 1]); return true;
  }
  if (game.selectedItem) return true;
  const normalized = key.length === 1 ? key.toLowerCase() : key;
  let action = MOVES[normalized];
  if (action && action !== 'wait' && game.renderer.boardProjection) {
    action = game.renderer.boardProjection.direction(...DIRECTIONS[action]);
  }
  if (action) { game.act(action); return true; }
  if (normalized === 'z' || key === 'Backspace') { game.undo(); return true; }
  return false;
}

module.exports = { handleGameKey };
