'use strict';

const { STAR_TWO_MARGIN, revive, reviveEnergy, step } = require('./engine');
const { SUPPLY_ENERGY, RELIGHT_ACTION } = require('./supply-rules');
const { isReviveRouteBlocked } = require('./revive-policy');
const { MOVE_MS } = require('./motion');

const BLOCKED_HINT = '这条路线补拍也无法送达，请免费重新规划。';
const routeBlocked = game => isReviveRouteBlocked(game.level, game.state, { canAcquireItems: game.ads.isConfigured() });
const hasStoredOil = game => Number.isSafeInteger(game.state && game.state.inventory && game.state.inventory.oil) && game.state.inventory.oil > 0;

function reviveScoreHint(level, state) {
  const par = Math.max(1, level.par || level.budget);
  return state.turn >= par + STAR_TWO_MARGIN
    ? '本次通关至多一星'
    : '续灯封顶二星，最终按总拍数结算';
}

function failureHint(game, blocked = routeBlocked(game)) {
  const s = game.state, l = game.level;
  if (blocked) return BLOCKED_HINT;
  if (!s.letters.length && !s.seals.length) return '下次为回到邮局留出更多拍数。';
  if ((l.bridges || []).length && !s.bridges.length) return '纸桥都碎了。先想清楚哪一段只走一次，再踏上去。';
  if (!s.letters.length) return '先踩过蓝色邮票，再给回声留出三拍。';
  if (s.lights.length) return '试着把剩余风灯串进路线，每盏补充三拍。';
  return '先安排远端目标，再把回邮局的路留到最后。';
}

function showFailure(game) {
  game.pendingAction = null; game.toastUntil = 0; game.reviewing = false;
  const blocked = routeBlocked(game);
  const needsToolVideo = !blocked && isReviveRouteBlocked(game.level, game.state);
  const recordFull = game.actions && game.actions.length >= 4096;
  const storedOil = hasStoredOil(game) && !blocked && !recordFull;
  const canRevive = !storedOil && game.platform.kind === 'wechat' && game.ads.isConfigured() && !blocked && !recordFull;
  const canContinue = storedOil || canRevive;
  const remaining = [];
  if (game.state.letters.length) remaining.push(game.state.letters.length + ' 封信');
  if (game.state.seals.length) remaining.push(game.state.seals.length + ' 枚邮票');
  game.modal = {
    kind: 'fail', title: canContinue ? '灯灭了，路线还在' : '换条路线，再寄一次',
    lines: [remaining.length ? '还差 ' + remaining.join(' / ') : '信笺和邮票已收齐',
      recordFull ? '本次路线记录已满，请重新规划。' : needsToolVideo ? '此路线还需道具；续灯后需另看视频获取。' : failureHint(game, blocked),
      ...(canContinue ? [storedOil ? '用已有灯油补 ' + SUPPLY_ENERGY + ' 拍，无需再看视频。' : '每次视频补 ' + SUPPLY_ENERGY + ' 拍，和投递中的灯油相同。',
        '保留路线与收集 · ' + reviveScoreHint(game.level, game.state)] : [])],
    buttons: [
      ...(storedOil ? [{ text: '使用已领取灯油 +' + SUPPLY_ENERGY + ' 拍', primary: true,
        icon: 'lamp', action: () => game.useStoredOil() }] : []),
      ...(canRevive ? [{ text: '看广告续灯 +' + reviveEnergy(game.level) + ' 拍 · 接着送', primary: true,
        icon: 'lamp', action: () => game.requestRevive() }] : []),
      { text: '重新规划 · 免费再试', primary: !canContinue, icon: 'restart', action: () => game.start(game.level, game.mode) },
      { text: '看看刚才的路线', icon: 'route', action: () => { game.modal = null; game.reviewing = true; } },
      { text: '返回邮局', textOnly: true, action: () => game.home() }
    ]
  };
}

async function requestRevive(game) {
  if (game.page !== 'game' || game.hidden || game.busy || game.ads.isActive() || !game.state ||
      game.state.status !== 'failed') return;
  if (game.actions && game.actions.length >= 4096) { showFailure(game); return; }
  if (hasStoredOil(game)) return useStoredOil(game);
  if (game.platform.kind !== 'wechat') return;
  if (routeBlocked(game)) {
    showFailure(game); game.toast(BLOCKED_HINT); return;
  }
  if (!game.ads.isConfigured()) {
    game.toast('激励视频尚未配置或当前环境不支持，可免费重新出发'); return;
  }
  const session = game.session, level = game.level, failed = game.state;
  game.busy = true; game.pendingAction = null; game.pointer = null; game.renderer.hits = [];
  game.modal = { title: '正在连接广告', lines: ['完整观看后恢复投递并补 ' + SUPPLY_ENERGY + ' 拍。', '与灯油补给相同，不额外发放道具。'], buttons: [] };
  game.sound.suspend('ad'); game.syncMusic();
  let result;
  try { result = await game.ads.showRevive(); } catch (_) { result = { rewarded: false, reason: 'error' }; }
  game.busy = false;
  // A completed video belongs to the exact failed route that requested it.
  if (session === game.session && game.page === 'game' && game.level === level && game.state === failed) {
    if (result && result.rewarded === true) applyRevive(game);
    else {
      showFailure(game);
      game.toast(result && result.reason === 'cancelled' ? '视频未看完，未续灯；可重试或免费重开'
        : '广告暂时不可用，可稍后再试或免费重开');
    }
  }
  game.pointer = null; game.renderer.hits = []; game.lastFrame = -Infinity;
  game.syncMusic();
  if (!game.ads.isActive()) game.sound.resume('ad');
}

function applyRevive(game) {
  const next = revive(game.level, game.state);
  if (next === game.state || next.status !== 'playing') return;
  game.state = next; game.previousState = null; game.reviveHistory.push(game.actions.length);
  game.pendingAction = null; game.blockedAt = null;
  game.moveEvents = [{ type: 'light', cell: next.player, amount: SUPPLY_ENERGY, source: 'oil' }];
  game.motionPath = null; game.transitionAt = game.platform.now() - MOVE_MS;
  game.modal = null; game.reviewing = false;
  game.persist(); game.cue('light'); game.toast('续灯成功，已增加 ' + next.energy + ' 拍，沿途收集已保留');
}

function useStoredOil(game) {
  if (game.page !== 'game' || game.hidden || game.busy || game.ads.isActive() || !game.state ||
      game.state.status !== 'failed' || !hasStoredOil(game) || game.modal && game.modal.kind !== 'fail') return false;
  if (game.actions.length >= 4096) { game.toast('本次路线已达记录上限，请重新规划'); return false; }
  if (routeBlocked(game)) { showFailure(game); game.toast(BLOCKED_HINT); return false; }
  const result = step(game.level, game.state, RELIGHT_ACTION);
  if (!result.moved) return false;
  game.cancelItem(); game.modal = null; game.reviewing = false; game.blockedAt = null;
  game.commitAction(result, RELIGHT_ACTION, game.platform.now());
  game.toast('已用已有灯油续灯 +' + SUPPLY_ENERGY + ' 拍，无需再看视频');
  game.syncMusic();
  return true;
}

module.exports = { failureHint, showFailure, requestRevive, applyRevive, useStoredOil };
