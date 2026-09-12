'use strict';

const PAGE_MS = 260, TOUCH_MS = 360;
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => 1 - (1 - clamp(value)) ** 3;
const active = (now, at, duration) => Number.isFinite(at) && now >= at && now - at < duration;
const sameScope = (feedback, game) => feedback && feedback.page === game.page &&
  feedback.modal === game.modal && feedback.session === game.session;

// Draw-time bookkeeping never changes the route, navigation, or saved settings.
function pageFrame(r, game, now) {
  const previous = r.uiPage;
  if (!previous || previous.game !== game || previous.page !== game.page) {
    r.uiPage = { game, page: game.page, at: previous && previous.game === game ? now : now - PAGE_MS };
  }
  if (!sameScope(r.uiFeedback, game) || !active(now, r.uiFeedback.at, TOUCH_MS)) r.uiFeedback = null;
  if (r.reducedMotion || r.effectsQuality === 'low' || ['startup', 'publication', 'game'].includes(game.page)) return 1;
  return ease((now - r.uiPage.at) / PAGE_MS);
}

function recordTouch(r, game, hit, point, now) {
  if (![hit.x, hit.y, hit.w, hit.h, point.x, point.y, now].every(Number.isFinite)) return;
  r.uiFeedback = { page: game.page, modal: game.modal, session: game.session, at: now,
    x: hit.x, y: hit.y, w: hit.w, h: hit.h, touchX: point.x, touchY: point.y };
}

function buttonTouch(r, x, y, w, h) {
  const feedback = r.uiFeedback;
  return feedback && Math.abs(feedback.x - x) < .5 && Math.abs(feedback.y - y) < .5 &&
    Math.abs(feedback.w - w) < .5 && Math.abs(feedback.h - h) < .5 ? feedback : null;
}

function actionSnapshot(game) {
  const modal = game.modal;
  return { page: game.page, modal, kind: modal && modal.kind, stamp: modal && modal.stampId,
    help: modal && modal.helpPage, filter: game.collectionFilter,
    levelMode: game.levelBrowser && game.levelBrowser.mode };
}

function actionSound(before, game) {
  if (before.page !== game.page) return game.page === 'game' ? 'start' : 'page';
  if (before.modal !== game.modal) {
    if (!game.modal || before.kind === 'help' && game.modal.kind === 'pause') return 'close';
    return 'open';
  }
  if (game.modal && (before.stamp !== game.modal.stampId || before.help !== game.modal.helpPage) ||
      before.filter !== game.collectionFilter || before.levelMode !== (game.levelBrowser && game.levelBrowser.mode)) return 'page';
  return 'tap';
}

function togglePosition(change, key, enabled, now, quiet = false) {
  const target = enabled ? 1 : 0;
  if (quiet || !change || change.key !== key || !active(now, change.at, 240)) return target;
  const from = Number.isFinite(change.from) ? clamp(change.from) : 1 - target;
  return from + (target - from) * ease((now - change.at) / 240);
}

function hasActiveUiMotion(game, now) {
  if (!game || game.hidden || game.busy || game.startupActive()) return false;
  const r = game.renderer;
  if (!r) return false;
  const pointer = game.pointer;
  if (pointer && !pointer.dragging && !pointer.scene && active(now, pointer.time, 220)) return true;
  if (sameScope(r.uiFeedback, game) && active(now, r.uiFeedback.at, TOUCH_MS)) return true;
  if (game.page === 'game' || game.platform && game.platform.effectsQuality === 'low') return false;
  if (!r.uiPage || r.uiPage.page !== game.page || active(now, r.uiPage.at, PAGE_MS)) return true;
  if (game.modal && (r.currentModal !== game.modal || active(now, r.modalAt, 260))) return true;
  return active(now, game.settingChangedAt, 240) || active(now, game.toastAt, 160);
}

module.exports = { PAGE_MS, TOUCH_MS, pageFrame, recordTouch, buttonTouch, actionSnapshot, actionSound, togglePosition, hasActiveUiMotion };
