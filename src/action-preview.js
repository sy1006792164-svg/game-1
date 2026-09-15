'use strict';

const { ACTIONS, DIRECTIONS, neighbor, step } = require('./engine');

const PREVIEW_HOLD_MS = 350;

/** The forecast is the same single action the player can commit, never a route solver. */
function forecastAction(level, state, action) {
  if (!level || !state || state.status !== 'playing' || !ACTIONS.includes(action)) return null;
  const result = step(level, state, action);
  if (!result.moved) return null;
  return { level, source: state, action, state: result.state, events: result.events,
    entry: action === 'wait' ? state.player : neighbor(level, state.player, action, state) };
}

function actionForHit(game, hit) {
  if (!hit || !hit.action) return null;
  if (hit.action.previewAction === 'wait') return 'wait';
  const cell = hit.action.boardCell;
  if (!Number.isInteger(cell)) return null;
  if (cell === game.state.player) return 'wait';
  return Object.keys(DIRECTIONS).find(action => neighbor(game.level, game.state.player, action, game.state) === cell) || null;
}

function canPreview(game) {
  return game.page === 'game' && !game.modal && !game.busy && !game.hidden && !game.reviewing &&
    !game.selectedItem && game.state && game.state.status === 'playing';
}

function capturePreview(game, hit) {
  // A legal hit may outlive a temporary busy/modal frame. Retain its hold
  // intent at pointer-down; availability decides whether to show a forecast,
  // never whether a long release may be reinterpreted as a short press.
  if (game.page !== 'game' || game.hidden || game.reviewing || game.selectedItem ||
      !game.state || game.state.status !== 'playing') return null;
  const action = actionForHit(game, hit), guide = game.guideStep();
  if (!action || guide && !guide.interactive && guide.action !== action) return null;
  return { action, state: game.state, level: game.level, session: game.session };
}

/** Hold state lives only on the active pointer and never enters the saved run. */
function updateActionPreview(game, now) {
  const pointer = game.pointer, hold = pointer && pointer.preview;
  if (!hold || pointer.dragging || !canPreview(game) || pointer.page !== game.page ||
      pointer.modal !== game.modal || hold.session !== game.session || hold.level !== game.level || hold.state !== game.state) {
    game.actionPreview = null;
    if (pointer && hold) { pointer.preview = null; pointer.previewCancelled = true; }
    return null;
  }
  if (now - pointer.time < PREVIEW_HOLD_MS) return null;
  pointer.previewed = true;
  // Keep the held intent even while a buffered turn is unresolved. A blocked
  // or expired turn leaves the state unchanged; that must not turn this hold
  // into a short tap on release. Predict only after the buffer has settled.
  if (game.pendingAction) { game.actionPreview = null; return null; }
  if (!game.actionPreview) game.actionPreview = forecastAction(game.level, game.state, hold.action);
  return game.actionPreview;
}

function previewMessage(preview) {
  if (!preview) return '';
  const events = preview.events, summary = [];
  if (events.some(event => event.type === 'wind')) summary.push('顺风落到光圈');
  if (events.some(event => event.type === 'letter')) summary.push('收信');
  if (events.some(event => event.type === 'seal')) summary.push('回声盖票');
  if (events.some(event => event.type === 'bridge')) summary.push('身后纸桥断开');
  if (events.some(event => event.type === 'light')) summary.push('风灯 +3 拍');
  if (events.some(event => event.type === 'supply')) summary.push('领取补给');
  if (events.some(event => event.type === 'order-blocked')) summary.push('编号未到，信会留下');
  if (preview.state.status === 'won') summary.push('完成投递');
  else if (preview.state.status === 'failed') summary.push('灯火将熄灭');
  else summary.push('灯火 ' + preview.source.energy + ' → ' + preview.state.energy);
  return summary.join(' · ');
}

function drawActionPreview(r, game, projection) {
  const preview = game.actionPreview;
  if (!preview || !canPreview(game) || game.pendingAction || preview.source !== game.state) return;
  const { point, halfW, halfH } = projection, c = r.ctx;
  const ring = (cell, color, size = .65) => {
    const [x, y] = point(cell);
    c.beginPath(); c.ellipse(x, y, halfW * size, halfH * size, 0, 0, Math.PI * 2);
    c.strokeStyle = color; c.lineWidth = 2; c.stroke();
  };
  c.save();
  c.setLineDash([4, 4]);
  const route = [preview.source.player, preview.entry, preview.state.player].filter((cell, i, cells) => !i || cell !== cells[i - 1]);
  if (route.length > 1) r.line(route.map(point), '#f3be68', 2.5);
  ring(preview.state.player, preview.state.status === 'failed' ? '#e29b87' : '#f8d398');
  c.setLineDash([]);
  const [x, y] = point(preview.state.player);
  c.globalAlpha *= .82;
  r.circle(x, y - halfH * .3, Math.max(7, halfW * .19), '#f6d995', '#fff3d0');
  r.icon(preview.action === 'wait' ? 'hourglass' : 'arrow-right', x, y - halfH * .3, Math.max(10, halfW * .27), '#544c45');
  if (preview.state.echo !== null) {
    ring(preview.state.echo, '#78e1e8', .46);
    const [ex, ey] = point(preview.state.echo);
    r.icon('echo', ex, ey - halfH * .4, Math.max(12, halfW * .34), '#91eef1');
  }
  for (const event of preview.events) {
    if (!['letter', 'seal', 'bridge', 'light', 'supply', 'order-blocked'].includes(event.type)) continue;
    const [ex, ey] = point(event.cell), size = Math.max(12, halfW * .35);
    const warning = event.type === 'bridge' || event.type === 'order-blocked';
    r.circle(ex + halfW * .42, ey - halfH * .55, size * .6, '#182e3f');
    r.icon(warning ? 'close' : 'check', ex + halfW * .42, ey - halfH * .55, size, warning ? '#eda694' : '#bfe6bd');
  }
  c.restore();
}

module.exports = { PREVIEW_HOLD_MS, forecastAction, actionForHit, capturePreview, updateActionPreview,
  previewMessage, drawActionPreview };
