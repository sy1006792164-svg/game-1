'use strict';

const { replay, step } = require('./engine');
const { ITEMS, itemOffer, itemAvailability, itemAction } = require('./items');
const { MOVE_MS } = require('./motion');

// A video is tied to the selected tool, target and exact route that requested it.
// Grant and consumption share one saved action record; undo keeps the earned grant.
async function requestItemReward(game, id, cell) {
  if (game.page !== 'game' || game.hidden || game.busy || game.modal || game.reviewing || game.ads.isActive() ||
      !game.state || game.state.status !== 'playing' || game.guideStep() || game.platform.now() - game.transitionAt < MOVE_MS) return;
  const offer = itemOffer(game.level, game.state, id);
  if (!offer.eligible || !offer.targets.includes(cell) || itemAvailability(game.level, game.state, id).available) return;
  if (!game.ads.isConfigured()) { game.toast('请在微信小游戏内观看视频获取道具'); return; }
  if ((game.itemRewards[id] || 0) >= 4096 || game.actions.length >= 4096) {
    game.toast('本次路线已达记录上限，请重新规划'); return;
  }
  const session = game.session, level = game.level, before = game.state;
  const item = ITEMS.find(entry => entry.id === id);
  game.cancelItem(); game.busy = true; game.renderer.hits = [];
  game.modal = { kind: 'item-ad', title: '正在连接广告',
    lines: ['完整观看后获得并使用 1 份' + item.name + '。', '未看完不会发放，也不会消耗拍数。'], buttons: [] };
  game.sound.suspend('ad'); game.syncMusic();
  let reward, earnedReward = false;
  try { reward = await game.ads.showRewarded(); } catch (_) { reward = { rewarded: false, reason: 'error' }; }
  game.busy = false;
  if (session === game.session && game.page === 'game' && game.level === level && game.state === before) {
    game.modal = null;
    if (reward && reward.rewarded === true) {
      const earned = { ...game.itemRewards, [id]: (game.itemRewards[id] || 0) + 1 };
      const granted = replay(level, game.actions, game.reviveHistory, earned, game.supplyPolicy);
      const action = itemAction(id, cell), used = step(level, granted, action);
      game.itemRewards = earned;
      earnedReward = true;
      if (used.moved) {
        game.blockedAt = null;
        game.commitAction(used, action, game.platform.now());
        if (game.state.status === 'playing') game.toast(item.name + '已使用，观看奖励已保存');
      } else {
        // Keep a completed reward even if a future rule change invalidates its target.
        game.state = granted; game.persist(); game.toast(item.name + '已领取，点道具选择目标');
      }
    } else game.toast(reward && reward.reason === 'cancelled' ? '视频未看完，未发放道具；可稍后重试' : '广告暂时不可用，未发放道具；可稍后重试');
    if (game.hidden && game.state.status === 'playing') game.pause();
  }
  game.pointer = null; game.renderer.hits = []; game.lastFrame = -Infinity;
  game.syncMusic();
  if (!game.ads.isActive()) game.sound.resume('ad');
  if (earnedReward && session === game.session && game.page === 'game' && game.level === level &&
      !game.hidden && !game.modal && !game.ads.isActive()) game.cue('reward');
}

module.exports = { requestItemReward };
