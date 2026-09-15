'use strict';

const { C } = require('./theme');

const ECHO_TIMELINE_HEIGHT = 28;

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

function drawEchoTimeline(r, game, rect) {
  if (game.reviewing || game.state.status !== 'playing' || game.selectedItem) return;
  const c = r.ctx, { x, y, w, h = ECHO_TIMELINE_HEIGHT } = rect;
  const titleWidth = 100, column = (w - titleWidth) / 3;
  c.save();
  r.icon('echo', x + 12, y + h / 2, 18, C.blueText);
  r.text('回声预告', x + 28, y + h / 2, 12, C.blueText, 'left', '600');
  for (const entry of getEchoForecast(game)) {
    const left = x + titleWidth + (entry.beat - 1) * column;
    const ink = entry.seal ? C.white : entry.cell === null ? C.muted : C.blueText;
    if (entry.seal) r.round(left, y + 1, column - 7, h - 2, 8, C.blueText);
    else if (entry.beat > 1) r.line([[left - 4, y + 9], [left - 4, y + h - 9]], C.line, 1);
    if (entry.seal) r.icon('stamp', left + 15, y + h / 2, 15, ink);
    else if (entry.cell === null) r.text('—', left + 15, y + h / 2, 12, ink, 'center');
    else r.circle(left + 15, y + h / 2, 3, ink);
    r.text(entry.beat + ' 拍', left + 30, y + h / 2, 12, ink, 'left', '600');
  }
  c.restore();
}

module.exports = { ECHO_TIMELINE_HEIGHT, getEchoForecast, drawEchoTimeline };
