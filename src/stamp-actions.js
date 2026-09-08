'use strict';

const { CAMPAIGN } = require('./levels');

function openStamp(game, id) {
  if (game.busy || !game.album().stamps.some(stamp => stamp.id === id)) return;
  game.openPage('collection');
  game.selectedStamp = id;
  game.toastUntil = 0;
}

function equipStamp(game, id) {
  if (game.busy) return;
  const album = game.album(), stamp = id === null ? album.equipped : album.stamps.find(item => item.id === id);
  if (!stamp || !stamp.owned) return;
  const removing = id === null || album.equipped && album.equipped.id === id;
  const saved = game.store.equipStamp(removing ? null : id);
  game.toast((removing ? '已收起佩戴邮戳' : '已佩戴「' + stamp.name + '」，首页与投递回执可见') +
    (saved ? '' : '；本次选择仅暂存于内存'));
}

// A commission uses the ordinary route and its existing best score.
function validMission(game, id, level, mode) {
  const stamp = game.album().stamps.find(item => item.id === id && (item.owned || item.target === 'daily'));
  return stamp && (stamp.target === 'daily' ? mode === 'daily' : mode === 'campaign' && stamp.levelId === level.id) ? stamp.id : null;
}

function startMission(game, id) {
  if (game.busy) return;
  const stamp = game.album().stamps.find(item => item.id === id);
  if (!stamp) return;
  if (!stamp.owned && stamp.target !== 'daily') { game.goal('stars'); return; }
  const daily = stamp.target === 'daily', mode = daily ? 'daily' : 'campaign';
  const level = daily ? null : CAMPAIGN.find(item => item.id === stamp.levelId);
  if (!daily && (!level || !game.unlocked(CAMPAIGN.indexOf(level)))) {
    game.goal('campaign'); return;
  }
  const saved = game.savedRun();
  const matches = saved && saved.mode === mode && (daily ? saved.dateKey === game.dateKey : saved.levelId === level.id);
  if (matches && game.restore()) {
    game.missionStampId = id;
    game.persist();
    return;
  }
  const depart = () => {
    if (daily) game.daily();
    else game.start(level, mode);
    game.missionStampId = id;
    game.persist();
  };
  if (saved && saved.actions && saved.actions.length) {
    game.modal = {
      title: '先把哪封信送完？',
      lines: ['开始回信委托会替换尚未完成的路线。已获得的星星与邮票会保留。'],
      buttons: [
        { text: '继续上次投递', primary: true, action: () => game.primary() },
        { text: '开始回信委托', action: depart },
        { text: '返回邮票', textOnly: true, action: () => { game.modal = null; } }
      ]
    };
    return;
  }
  depart();
}

function albumRewards(before, after) {
  const rewards = after.stamps.filter(stamp => {
    const previous = before.stamps.find(item => item.id === stamp.id);
    return stamp.owned && (!previous.owned || stamp.mastered && !previous.mastered);
  });
  if (!rewards.length) return null;
  const stamp = rewards[0];
  return {
    id: stamp.id,
    text: rewards.length > 1 ? rewards.length + ' 枚邮票有新收藏或回信' :
      stamp.mastered ? '「' + stamp.name + '」已成为金色珍藏' : '收到新邮票「' + stamp.name + '」'
  };
}

module.exports = { openStamp, equipStamp, validMission, startMission, albumRewards };
