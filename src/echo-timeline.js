'use strict';

const { C } = require('./theme');
const { insideRect } = require('./board-projection');

const ECHO_TIMELINE_HEIGHT = 44;
const echoTimelineHeight = r => Math.max(ECHO_TIMELINE_HEIGHT, 44 / r.scale);

function canInspectEcho(game) {
  return game.page === 'game' && game.state.status === 'playing' && !game.reviewing &&
    !game.modal && !game.busy && !game.hidden && !game.selectedItem && !game.actionPreview &&
    !game.pendingAction && !game.guideStep();
}

// Only already-recorded landings can reach the echo during the next three
// movement/wait actions. Supply actions never add a beat to this queue.
function getEchoForecast(game) {
  const { state } = game, seals = new Set(state.seals), stamped = new Set();
  return [1, 2, 3].map(beat => {
    const index = state.turn + beat - 3;
    const cell = index >= 0 && index < state.history.length ? state.history[index] : null;
    const seal = cell !== null && seals.has(cell) && !stamped.has(cell);
    if (seal) stamped.add(cell);
    return { beat, cell, seal };
  });
}

function echoInspection(r, game) {
  const current = r.echoInspection;
  if (!current) return null;
  if (!canInspectEcho(game) || current.game !== game || current.state !== game.state ||
      current.level !== game.level || current.session !== game.session) {
    r.echoInspection = null;
    return null;
  }
  return current;
}

function echoForecastMessage(game, entry) {
  const remaining = game.state.energy, needed = entry.cell === null ? Math.max(1, 3 - game.state.turn) : entry.beat;
  const warning = remaining < needed ? ' 仅剩 ' + remaining + ' 拍，需先补光。'
    : remaining <= 3 ? ' 灯火仅剩 ' + remaining + ' 拍。' : '';
  if (entry.cell === null) return '回声尚未出现，再行动 ' + Math.max(1, 3 - game.state.turn) + ' 拍诞生。' + warning;
  const plate = Object.values(game.level.echoGates || {}).some(gate => gate.plate === entry.cell);
  const outcome = [entry.seal && '盖一张蓝票', plate && '压住踏板开门'].filter(Boolean);
  return entry.beat + ' 拍后回声到光圈' + (outcome.length ? '，' + outcome.join('、') : '') + '。' + warning;
}

function inspectEcho(r, game, entry, source = game.state, session = game.session) {
  if (!canInspectEcho(game) || game.state !== source || game.session !== session) return;
  const current = echoInspection(r, game);
  r.echoInspection = current && current.entry.beat === entry.beat ? null : {
    game, state: source, level: game.level, session, entry
  };
  game.lastFrame = -Infinity;
}

function drawEchoInspection(r, game, now) {
  const inspection = echoInspection(r, game), projection = r.boardProjection, rect = r.boardRect;
  if (!inspection || !projection || !rect || inspection.entry.cell === null) return;
  const { cell, beat } = inspection.entry, [x, y] = projection.point(cell);
  if (!insideRect(rect, x, y)) return;
  const c = r.ctx, w = projection.halfW, h = projection.halfH;
  const unit = 1 / r.scale, still = r.reducedMotion || r.effectsQuality === 'low';
  const pulse = still ? 0 : (1 + Math.sin(now / 320)) * .035;
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
  const ring = () => {
    c.beginPath(); c.ellipse(x, y, w * (.75 + pulse), h * (.75 + pulse), 0, 0, Math.PI * 2);
  };
  ring(); c.fillStyle = '#9be4db30'; c.fill();
  c.strokeStyle = '#fffdf4'; c.lineWidth = 4 * unit; c.stroke();
  ring(); c.strokeStyle = C.blueText; c.lineWidth = 1.8 * unit; c.stroke();
  const radius = 9 * unit;
  const bx = Math.max(rect.x + radius + 2, Math.min(rect.x + rect.w - radius - 2, x + w * .7));
  const by = Math.max(rect.y + radius + 2, Math.min(rect.y + rect.h - radius - 2, y + h * .28));
  r.circle(bx, by, radius, C.blueText, '#fffdf4');
  r.text(beat, bx, by, 11 * unit, C.white, 'center', '700');
  c.restore();
}

function drawEchoTimeline(r, game, rect) {
  if (game.reviewing || game.state.status !== 'playing' || game.selectedItem) return;
  const c = r.ctx, { x, y, w, h = ECHO_TIMELINE_HEIGHT } = rect;
  const titleWidth = 80, column = (w - titleWidth) / 3;
  const faceY = y + (h - 40) / 2, faceWidth = column - 8;
  const inspection = echoInspection(r, game), inspectable = canInspectEcho(game);
  c.save();
  r.icon('echo', x + 12, y + h / 2 - 8, 17, C.blueText);
  r.text('回声', x + 26, y + h / 2 - 8, 13, C.blueText, 'left', '700');
  r.text(inspectable ? '点选预览' : '回声预告', x + 4, y + h / 2 + 10, 12, C.muted);
  for (const entry of getEchoForecast(game)) {
    const left = x + titleWidth + (entry.beat - 1) * column;
    const selected = inspection && inspection.entry.beat === entry.beat;
    const pending = entry.cell === null;
    const needsLight = entry.beat > game.state.energy;
    const ink = selected ? C.white : !inspectable ? C.muted : needsLight ? C.dangerText : pending ? C.muted : C.blueText;
    const fill = selected ? C.blueText : !inspectable ? C.raised : needsLight ? C.peach : pending ? C.raised : entry.seal ? C.bluePale : C.panel;
    r.round(left, faceY, faceWidth, 40, 10, fill, selected || entry.seal ? C.blueText : C.line);
    const center = left + faceWidth / 2;
    r.text(entry.beat + ' 拍后', center, faceY + 12, 13, ink, 'center', '700');
    if (selected) r.icon('check', left + faceWidth - 8, faceY + 8, 9, C.white);
    const label = needsLight ? entry.seal ? '补拍后盖票' : '需先补拍' : pending ? '未出现' : entry.seal ? '盖蓝票' : '有落点';
    const stamp = entry.seal && !needsLight;
    if (stamp) r.icon('stamp', center - 24, faceY + 29, 12, ink);
    r.text(label, center + (stamp ? 5 : 0), faceY + 29, 12, ink, 'center');
    if (inspectable) {
      const source = game.state, session = game.session;
      const action = Object.assign(() => inspectEcho(r, game, entry, source, session), { focusId: 'echo-beat:' + entry.beat });
      r.hit(left - 2, y, column - 3, h, action, undefined,
        '查看回声：' + echoForecastMessage(game, entry) + (selected ? ' 当前预览，再次选择收起。' : ''));
    }
  }
  c.restore();
}

module.exports = { ECHO_TIMELINE_HEIGHT, echoTimelineHeight, getEchoForecast, drawEchoTimeline,
  echoInspection, echoForecastMessage, inspectEcho, drawEchoInspection };
