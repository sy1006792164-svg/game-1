'use strict';

const { STAR_TWO_MARGIN, revive, reviveEnergy, step } = require('./engine');
const { SUPPLY_ENERGY, RELIGHT_ACTION } = require('./supply-rules');
const { isReviveRouteBlocked } = require('./revive-policy');
const { MOVE_MS } = require('./motion');
const { reportGameEvent } = require('./analytics');

const BLOCKED_HINT = '这条路线补拍也无法送达，请免费重新规划。';
// A video relight must be useful with the tools already earned. A hypothetical
// second tool video must never turn a stranded route into a revive offer.
const routeBlocked = game => isReviveRouteBlocked(game.level, game.state);
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
  if (!s.letters.length && !s.seals.length) return '收集已完成；接下来只需回到邮局。';
  const queued = s.history.slice(Math.max(0, s.turn - 2), s.turn + 1);
  if (!s.letters.length && s.seals.every(cell => queued.includes(cell))) return s.player === l.exit
    ? '已到邮局，蓝票已踩过；续灯后等待回声盖票。'
    : '蓝票已踩过；回邮局途中让回声把票盖完。';
  if ((l.bridges || []).length && !s.bridges.length) return '纸桥都碎了。先想清楚哪一段只走一次，再踏上去。';
  if (!s.letters.length) return '先踩过蓝色邮票，再给回声留出三拍。';
  if (Object.keys(l.echoGates || {}).length) return '先踩门的机关，再让回声接力压住，安排好过门时机。';
  if (Object.keys(l.tideGates || {}).length) return '把潮汐门开放的时机排进路线，少等一拍就多留一拍灯火。';
  return '先安排远端目标，再把回邮局的路留到最后。';
}

function showFailure(game) {
  game.pendingAction = null; game.toastUntil = 0; game.reviewing = false;
  const blocked = routeBlocked(game);
  const recordFull = game.actions && game.actions.length >= 4096;
  const storedOil = hasStoredOil(game) && !blocked && !recordFull;
  const canRevive = !storedOil && game.platform.kind === 'wechat' && game.ads.isConfigured() && !blocked && !recordFull;
  const canContinue = storedOil || canRevive;
  if (game.reviveOfferState !== game.state) {
    game.reviveOfferState = game.state;
    reportGameEvent(game, 'revive_offer', { available: canContinue ? 1 : 0,
      source: storedOil ? 'stored_oil' : canRevive ? 'video' : 'none',
      undo_left: typeof game.undoLeft === 'function' ? game.undoLeft() : 0,
      reason: recordFull ? 'record-full' : blocked ? 'route-blocked' : canContinue ? 'available' : 'unconfigured' });
  }
  const canRewind = typeof game.undo === 'function' && typeof game.undoLeft === 'function' &&
    game.undoLeft() > 0 && game.actions.length > (game.reviveAt == null ? 0 : game.reviveAt);
  const remaining = [];
  if (game.state.letters.length) remaining.push(game.state.letters.length + ' 封信');
  if (game.state.seals.length) remaining.push(game.state.seals.length + ' 枚邮票');
  game.modal = {
    kind: 'fail', title: canContinue ? '灯灭了，路线还在' : '换条路线，再寄一次',
    lines: [remaining.length ? '还差 ' + remaining.join(' / ') : '信笺和邮票已收齐',
      recordFull ? '本次路线记录已满，请重新规划。' : failureHint(game, blocked),
      ...(canContinue ? [storedOil ? '用已有灯油补 ' + SUPPLY_ENERGY + ' 拍，无需再看视频。' : '每次视频补 ' + SUPPLY_ENERGY + ' 拍，和投递中的灯油相同。',
        '保留路线与收集 · ' + reviveScoreHint(game.level, game.state)] : [])],
    buttons: [
      ...(canRewind ? [{ text: '撤回上一步 · 剩余 ' + game.undoLeft() + ' 次', primary: true,
        icon: 'undo', action: () => { game.modal = null; game.undo(); if (game.state.status === 'failed') showFailure(game); game.syncMusic(); } }] : []),
      ...(storedOil ? [{ text: '使用已领取灯油 +' + SUPPLY_ENERGY + ' 拍', primary: !canRewind,
        icon: 'lamp', action: () => game.useStoredOil() }] : []),
      ...(canRevive ? [{ text: '看广告续灯 +' + reviveEnergy(game.level) + ' 拍 · 接着送', primary: !canRewind,
        icon: 'lamp', action: () => game.requestRevive() }] : []),
      { text: '重新规划 · 免费再试', primary: !canContinue && !canRewind, icon: 'restart', action: () => game.start(game.level, game.mode) },
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
  const context = { placement: 'revive', level_id: level.id, content_version: level.revision || '', mode: game.mode, turn: failed.turn,
    energy: failed.energy, revive_count: failed.reviveCount || 0,
    remaining_letters: failed.letters.length, remaining_seals: failed.seals.length };
  game.busy = true; game.pendingAction = null; game.pointer = null; game.renderer.hits = [];
  game.modal = { title: '正在连接广告', lines: ['完整观看后恢复投递并补 ' + SUPPLY_ENERGY + ' 拍。', '与灯油补给相同，不额外发放道具。'], buttons: [] };
  const sameRoute = () => session === game.session && game.page === 'game' && game.level === level;
  let result;
  try {
    reportGameEvent(game, 'ad_request', context);
    game.sound.suspend('ad'); game.syncMusic();
    try { result = await game.ads.showRevive(); } catch (_) { result = { rewarded: false, reason: 'error' }; }
    reportGameEvent(game, result && result.rewarded === true ? 'ad_complete' : result && result.reason === 'cancelled' ? 'ad_cancel' : 'ad_error',
      { ...context, reason: result && result.reason || 'error', route_current: sameRoute() && game.state === failed ? 1 : 0 });
    game.busy = false;
    // A completed video belongs to the exact failed route that requested it.
    if (sameRoute() && game.state === failed) {
      if (result && result.rewarded === true) applyRevive(game);
      else {
        showFailure(game);
        game.toast(result && result.reason === 'cancelled' ? '视频未看完，未续灯；可重试或免费重开'
          : '广告暂时不可用，可稍后再试或免费重开');
      }
      // Native playback may finish while the app is still in the background.
      // Preserve the same explicit resume step as normal backgrounding and tool rewards.
      if (game.hidden && game.state.status === 'playing') game.pause();
    }
  } catch (_) {
    if (sameRoute() && game.state !== failed && game.state.status === 'playing') {
      // The engine and revival ledger commit before optional persistence or
      // presentation work. Keep that earned relight usable if either fails.
      game.modal = { kind: 'revive-recovery', title: '续灯已生效',
        lines: ['已补充 ' + SUPPLY_ENERGY + ' 拍，沿途收集已保留。', '提示暂未完成，可以继续投递，无需重复看视频。'],
        buttons: [{ text: '继续投递', primary: true, action: () => {
          game.modal = null; game.persist(); game.syncMusic();
        } }] };
    } else if (sameRoute()) {
      showFailure(game); game.toast('续灯处理暂未完成，可稍后重试或免费重开');
    }
  } finally {
    game.busy = false; game.pointer = null; game.renderer.hits = []; game.lastFrame = -Infinity;
    try { game.syncMusic(); } finally { if (!game.ads.isActive()) game.sound.resume('ad'); }
  }
}

function applyRevive(game) {
  const next = revive(game.level, game.state);
  if (next === game.state || next.status !== 'playing') return;
  game.state = next; game.previousState = null; game.reviveHistory.push(game.actions.length);
  game.pendingAction = null; game.blockedAt = null;
  game.moveEvents = [{ type: 'light', cell: next.player, amount: SUPPLY_ENERGY, source: 'oil' }];
  game.motionPath = null; game.transitionAt = game.platform.now() - MOVE_MS;
  game.modal = null; game.reviewing = false;
  reportGameEvent(game, 'revive_applied', { source: 'video', amount: SUPPLY_ENERGY });
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
  reportGameEvent(game, 'revive_applied', { source: 'stored_oil', amount: SUPPLY_ENERGY });
  game.toast('已用已有灯油续灯 +' + SUPPLY_ENERGY + ' 拍，无需再看视频');
  game.syncMusic();
  return true;
}

module.exports = { failureHint, showFailure, requestRevive, applyRevive, useStoredOil };
