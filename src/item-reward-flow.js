'use strict';

const { replay, step } = require('./engine');
const { ITEMS, itemOffer, itemAvailability, itemAction } = require('./items');
const { MOVE_MS } = require('./motion');
const { reportGameEvent } = require('./analytics');

// A video is tied to the selected tool, target and exact route that requested it.
// The reward ledger survives undo; consumption is recorded in the route actions.
async function requestItemReward(game, id, cell) {
  const guide = typeof game.guideStep === 'function' ? game.guideStep() : null;
  if (game.page !== 'game' || game.hidden || game.busy || game.modal || game.reviewing || game.ads.isActive() ||
      !game.state || game.state.status !== 'playing' || guide && guide.interactive !== true ||
      game.platform.now() - game.transitionAt < MOVE_MS) return;
  const offer = itemOffer(game.level, game.state, id);
  if (!offer.eligible || !offer.targets.includes(cell) || itemAvailability(game.level, game.state, id).available) return;
  if (!game.ads.isConfigured()) { game.toast('请在微信小游戏内观看视频获取道具'); return; }
  if ((game.itemRewards[id] || 0) >= 4096 || game.actions.length >= 4096) {
    game.toast('本次路线已达记录上限，请重新规划'); return;
  }
  const session = game.session, level = game.level, before = game.state;
  const item = ITEMS.find(entry => entry.id === id);
  const context = { placement: 'item', item_id: id, target_cell: cell, level_id: level.id, content_version: level.revision || '',
    mode: game.mode, turn: before.turn, energy: before.energy, revive_count: before.reviveCount || 0,
    remaining_letters: before.letters.length, remaining_seals: before.seals.length };
  game.cancelItem(); game.busy = true; game.renderer.hits = [];
  game.modal = { kind: 'item-ad', title: '正在连接广告',
    lines: ['完整观看后获得并使用 1 份' + item.name + '。', '未看完不会发放，也不会消耗拍数。'], buttons: [] };
  let reward, earnedReward = false;
  try {
    reportGameEvent(game, 'ad_request', context);
    game.sound.suspend('ad'); game.syncMusic();
    try { reward = await game.ads.showRewarded(); } catch (_) { reward = { rewarded: false, reason: 'error' }; }
    reportGameEvent(game, reward && reward.rewarded === true ? 'ad_complete' : reward && reward.reason === 'cancelled' ? 'ad_cancel' : 'ad_error',
      { ...context, reason: reward && reward.reason || 'error',
        route_current: session === game.session && game.page === 'game' && game.level === level && game.state === before ? 1 : 0 });
    game.busy = false;
    if (session === game.session && game.page === 'game' && game.level === level && game.state === before) {
      game.modal = null;
      if (reward && reward.rewarded === true) {
        game.itemRewards = { ...game.itemRewards, [id]: (game.itemRewards[id] || 0) + 1 };
        earnedReward = true;
        reportGameEvent(game, 'item_reward', { item_id: id, amount: 1 });
        // Record completion before replay, effects or score settlement can fail.
        // The fallback route restores with this reward still held.
        game.persist();
        const granted = replay(level, game.actions, game.reviveHistory, game.itemRewards, game.supplyPolicy);
        game.state = granted;
        const action = itemAction(id, cell), used = step(level, granted, action);
        if (used.moved) {
          game.blockedAt = null;
          game.commitAction(used, action, game.platform.now());
          if (game.state.status === 'playing') game.toast(item.name + '已使用，奖励计入本次路线');
        } else {
          // Keep a completed reward even if a future rule change invalidates its target.
          game.toast(item.name + '已领取，点道具选择目标');
        }
      } else game.toast(reward && reward.reason === 'cancelled' ? '视频未看完，未发放道具；可稍后重试' : '广告暂时不可用，未发放道具；可稍后重试');
      if (game.hidden && game.state.status === 'playing') game.pause();
    }
  } catch (_) {
    if (earnedReward && session === game.session && game.page === 'game' && game.level === level) {
      game.modal = { kind: 'item-reward-recovery', title: '道具处理暂未完成',
        lines: ['完整视频奖励已计入本次路线。', '返回邮局后点「继续投递」恢复，无需重复看视频。'],
        buttons: [{ text: '返回邮局恢复', primary: true, action: () => game.home() }] };
    } else if (session === game.session && game.page === 'game' && game.level === level) {
      game.modal = null; game.toast('道具处理未完成，请稍后重试');
    }
  } finally {
    game.busy = false; game.pointer = null; game.renderer.hits = []; game.lastFrame = -Infinity;
    try { game.syncMusic(); } finally { if (!game.ads.isActive()) game.sound.resume('ad'); }
  }
  if (earnedReward && session === game.session && game.page === 'game' && game.level === level &&
      !game.hidden && !game.modal && !game.ads.isActive()) game.cue('reward');
}

module.exports = { requestItemReward };
