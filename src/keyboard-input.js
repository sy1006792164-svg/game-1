'use strict';

const { DIRECTIONS } = require('./engine');
const { stampDetailKey } = require('./stamp-detail-view');
const { handleFocusKey } = require('./keyboard-focus');

const SCROLL_DELTA = Object.freeze({ ArrowUp: -100, ArrowDown: 100, PageUp: -340, PageDown: 340, ' ': 340 });
const MOVES = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', ' ': 'wait', Space: 'wait' });

function activateModalButton(game, button) {
  if (!button || button.disabled || typeof button.action !== 'function') return;
  // A confirming key owns the action; a held finger must not activate the
  // replacement dialog or the newly uncovered board when it later lifts.
  game.pointer = null; game.renderer.pointer = null; game.renderer.hits = [];
  button.action();
  game.lastFrame = -Infinity;
  game.syncMusic();
}

// A modal owns keyboard input until its own close action returns to the prior view.
function handleGameKey(game, key) {
  if (game.hidden || game.busy || game.startupActive() || typeof key !== 'string') return false;
  game.unlockAudio();
  if (game.development && game.modal && game.modal.kind === 'developer-level') {
    game.developmentKey(key); return true;
  }
  const focused = handleFocusKey(game, key);
  if (focused !== null) return focused;
  if (stampDetailKey(game, key)) return true;
  if (game.modal) {
    const buttons = game.modal.buttons || [];
    const primary = buttons.find(button => button.primary);
    if (game.modal.kind === 'item') {
      if (key === 'Escape') {
        activateModalButton(game, buttons[buttons.length - 1]);
      } else if (key === 'Enter') {
        // Locked or unavailable tools have a single acknowledgement action.
        activateModalButton(game, primary || buttons.length === 1 && buttons[0]);
      }
      return true;
    }
    if (key === 'Enter' && ['help', 'pause', 'win', 'fail', 'reset-confirm', 'journey', 'route-plan'].includes(game.modal.kind)) {
      // Result actions become available after the final move is presented.
      // Use the actual painted control so reduced motion and restored results
      // keep exactly the same activation timing as pointer input.
      if (['win', 'fail'].includes(game.modal.kind) && (game.renderer.currentModal !== game.modal ||
          !primary || !game.renderer.hits.some(hit => hit.action === primary.action))) return true;
      activateModalButton(game, primary);
      return true;
    }
    const navigation = game.renderer.helpNavigation;
    if (game.modal.sections && navigation && navigation.modal === game.modal) {
      const page = Number.isInteger(game.modal.helpPage) ? Math.max(0, Math.min(navigation.count - 1, game.modal.helpPage)) : navigation.page;
      const turn = (key === 'ArrowLeft' || key === 'PageUp') && page > 0 ? navigation.previous :
        (key === 'ArrowRight' || key === 'PageDown') && page + 1 < navigation.count ? navigation.next : null;
      if (turn) {
        // A keyboard page change must also end a finger held over the old page.
        game.pointer = null; game.renderer.pointer = null;
        turn();
      }
    }
    if (key === 'Escape') {
      if (game.modal.kind === 'journey' || game.modal.kind === 'route-plan') {
        activateModalButton(game, buttons[buttons.length - 1]);
      } else if (game.modal.kind === 'help') {
        activateModalButton(game, buttons[0]);
      } else if (game.modal.kind === 'pause' && game.page === 'game') game.pause();
      // This dialog deliberately makes "keep local data" its primary action.
      else if (game.modal.kind === 'reset-confirm') activateModalButton(game, primary);
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
  if (['1', '2', '3', '4'].includes(key) && typeof game.selectItem === 'function') {
    game.selectItem(['oil', 'kite', 'bridge', 'echo'][Number(key) - 1]); return true;
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
