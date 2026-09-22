'use strict';

const config = require('./config');

function seasonModal(game) {
  const store = game.store;
  if (config.PROGRESSION_SEASON === 1) {
    if (store.hasSeenSeasonNotice()) return null;
    return {
      kind: 'season-notice', title: '邮路即将开启新篇',
      lines: ['下一次大版本将从第一封信重新出发，通关星级、日邮程和好友榜成绩都会重新计算。',
        '旧版存档会在本机只读保留，用于更新故障时恢复；声音等设置会延续。'],
      buttons: [{ text: '我知道了', primary: true, action: () => {
        if (!store.markSeasonNoticeSeen()) {
          game.toast('公告确认暂时无法保存，请稍后重试'); return;
        }
        game.modal = null; game.renderer.hits = []; game.syncMusic();
        game.reportEvent('season_notice', { season: 1 });
      } }]
    };
  }
  const state = store.getMigrationState();
  if (state.status === 'ready') return null;
  return {
    kind: 'season-reset', title: state.status === 'error' ? '存档暂时无法启用' : '确认开启新邮路',
    lines: state.status === 'error' ? [state.message || '原存档仍安全保留，请重试；新进度尚未开始。'] :
      ['确认后，通关、星级、邮票、日邮程及进行中路线会从零开始，本局视频道具也不带入新版。',
        '旧版存档只读留在本机供故障恢复；声音等设置会延续。新好友榜将重新计算。'],
    buttons: [{ text: state.status === 'error' ? '重试' : '确认，从第一封开始', primary: true, action: () => {
      if (state.status === 'error') {
        store.retryMigration();
        game.modal = seasonModal(game); game.renderer.hits = [];
      } else if (store.confirmMigration()) {
        game.modal = null; game.renderer.hits = [];
        game.reportEvent('progress_reset', { season: 2, legacy: state.hasLegacyProgress === true });
        game.syncMusic();
      } else {
        game.modal = seasonModal(game);
        game.renderer.hits = [];
      }
    } }]
  };
}

module.exports = { seasonModal };
