'use strict';

const { CAMPAIGN, getLegacyLevel } = require('./levels');
const { difficultyProfile } = require('./difficulty');
const { preparationAdvice, supplyAdvice } = require('./supply-advice');
const { ITEMS } = require('./items');
const { C } = require('./theme');

// Every entry returns to the existing campaign; there is no separate score,
// inventory or unlock path hidden behind the daily itinerary.
function openRoutePlan(game, level) {
  if (!level || game.busy || game.hidden || game.startupActive() || !game.unlocked(level.id - 1)) return false;
  if (!game.ensureStoredProgressReady()) return false;
  const savedAtOpen = game.savedRun();
  if (savedAtOpen && savedAtOpen.levelId === level.id)
    level = getLegacyLevel(level.id, savedAtOpen.revision || '1') || level;
  if (game.page === 'game' && game.level && game.level.id === level.id && game.level.revision === level.revision)
    level = game.level;
  const old = game.modal, session = game.session;
  const current = game.page === 'game' && game.level === level && game.state && game.state.status === 'playing';
  const difficulty = difficultyProfile(level), advice = current ? supplyAdvice(level, game.state) : preparationAdvice(level);
  const item = advice && ITEMS.find(entry => entry.id === advice.itemId);
  const videoAvailable = !!(game.platform && game.platform.kind === 'wechat' && game.ads &&
    typeof game.ads.isConfigured === 'function' && game.ads.isConfigured());
  const heldSupply = item && current && game.state.inventory && game.state.inventory[item.id] > 0;
  const supplyDetail = heldSupply ? '本次路线已有 ' + game.state.inventory[item.id] + ' 份，无需另看视频。' :
    videoAvailable ? '需要时自愿完整看视频获得 1 份，只用于本次路线；未看完不发放。' :
      '当前环境没有可用的视频补给，可直接无道具出发。';
  const credited = game.journey().creditedLevelIds.includes(level.id);
  const close = () => { game.modal = old; game.renderer.hits = []; game.syncMusic(); };
  const begin = () => {
    if (game.session !== session || game.busy || game.hidden) return false;
    if (!game.ensureStoredProgressReady()) return false;
    game.modal = null;
    if (!current) {
      const saved = game.savedRun();
      if (!(saved && saved.levelId === level.id && game.restore())) game.start(level);
    }
    game.renderer.hits = []; game.syncMusic();
    return true;
  };
  game.pendingAction = null; game.cancelItem(); game.pointer = null; game.stopListScrolling();
  game.modal = { kind: 'route-plan', title: '第 ' + level.id + ' 封 · ' + difficulty.name,
    sections: [
      { title: level.title, icon: 'route', color: C.green,
        text: difficulty.summary + '\n起始灯火 ' + level.budget + ' 拍 · 可撤回 ' + level.undo + ' 次。\n' + difficulty.focus },
      { title: '这次投递的收获', icon: 'stamp', color: C.goldText,
        text: (credited ? '本关今日邮程已记；仍可重投补星。' : '今日首次送达本关，获得 ' + difficulty.journeyPoints + ' 邮程。') +
          '\n星光同时用于邮票收藏与好友排行。\n道具或续灯助你送达，最高二星；' + level.par + ' 拍内无辅助送达可摘三星。' },
      ...(item ? [{ title: '补给建议 · ' + item.name, icon: item.icon, color: C.goldText,
        text: advice.reason + '\n' + supplyDetail }] : []),
      ...(savedAtOpen && savedAtOpen.levelId !== level.id ? [{ title: '出发前的存档提醒', icon: 'route', color: C.muted,
        text: '第 ' + savedAtOpen.levelId + ' 封还在投递中。开始这封信会替换该路线，原路线的视频补给随之清空。已有通关成绩保留。' }] : [])
    ], lines: [], buttons: [
      { text: current || savedAtOpen && savedAtOpen.levelId === level.id ? '继续投递' : '出发 · 挑战这封信', primary: true, action: begin },
      ...(item && (videoAvailable || heldSupply) ? [{ text: '查看' + item.name + (heldSupply ? ' · 已有补给' : ' · 视频补给'), icon: item.icon, action: () => {
        if (!begin()) return;
        if (game.guideStep()) { game.toast('先完成机关引导，再点道具查看补给'); return; }
        game.selectItem(item.id);
      } }] : []),
      { text: '返回', textOnly: true, action: close }
    ] };
  game.renderer.hits = []; game.syncMusic();
  return true;
}

function openJourney(game) {
  if (game.busy || game.hidden || game.startupActive()) return false;
  const old = game.modal, journey = game.journey(), album = game.album();
  game.pendingAction = null; game.cancelItem(); game.pointer = null; game.stopListScrolling();
  game.modal = { kind: 'journey', title: journey.done ? '今日邮程已盖章' : '今日邮程 · ' + journey.points + ' / ' + journey.target,
    sections: [
      { title: '累计 ' + journey.earnedDays + ' 枚日邮戳', icon: 'stamp', color: C.goldText,
        text: '每天集满 6 邮程记一枚日邮戳，累计保留。\n每关每日计一次，难关贡献更多；使用视频道具送达也计入。' },
      { title: '同一程，同时收集星光', icon: 'star', color: C.green,
        text: (album.next ? '再收 ' + album.next.remaining + ' 星，收藏「' + album.next.name + '」。' : '旅程邮票已集齐，还可挑战全关三星。') +
          '\n新通关解锁后续来信；重投升星更新邮票册和好友排行。' },
      { title: journey.done ? '下一程由你选择' : '为你选好的邮路', icon: 'route', color: C.green,
        text: journey.candidates.slice(0, 2).map(candidate => {
          const level = CAMPAIGN[candidate.levelId - 1];
          return '第 ' + level.id + ' 封「' + level.title + '」\n' + candidate.reason + ' · 今日送达 +' + candidate.points + ' 邮程';
        }).join('\n') || '今日已走过全部可用邮路，随时重投补星。' }
    ], lines: [], buttons: [
      ...journey.candidates.slice(0, 2).map((candidate, index) => ({
        text: '第 ' + candidate.levelId + ' 封 · 查看挑战', primary: index === 0, icon: 'route',
        action: () => game.openRoutePlan(CAMPAIGN[candidate.levelId - 1])
      })),
      { text: '去邮票册看目标', icon: 'stamp', action: () => game.openPage('collection') },
      { text: '返回', textOnly: true, action: () => { game.modal = old; game.renderer.hits = []; game.syncMusic(); } }
    ] };
  game.renderer.hits = []; game.syncMusic();
  return true;
}

module.exports = { openJourney, openRoutePlan };
