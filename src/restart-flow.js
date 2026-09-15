'use strict';

// Replacing an unfinished route also discards its earned supplies. Keep that
// consequence visible before a pause-menu tap can replace the saved run.
function confirmRestart(game) {
  if (game.page !== 'game' || game.hidden || game.busy || !game.state ||
      game.state.status !== 'playing' || !game.modal || game.modal.kind !== 'pause') return false;
  const hasProgress = game.actions.length > 0 || game.undosUsed > 0 ||
    Object.values(game.itemRewards || {}).some(count => count > 0);
  if (!hasProgress) { game.start(game.level, game.mode); return true; }
  const previous = game.modal;
  game.pointer = null; game.pendingAction = null; game.renderer.hits = [];
  game.modal = {
    kind: 'restart-confirm', title: '重新走这段邮路？',
    kicker: '当前已走 ' + game.state.turn + ' 拍',
    lines: ['本次路线和随身道具将重置。', '已获得的星星、邮票和通关记录会保留。'],
    buttons: [
      { text: '重新出发', primary: true, icon: 'restart', action: () => game.start(game.level, game.mode) },
      { text: '保留当前路线', textOnly: true, action: () => { game.modal = previous; game.syncMusic(); } }
    ]
  };
  game.lastFrame = -Infinity; game.syncMusic();
  return true;
}

module.exports = { confirmRestart };
