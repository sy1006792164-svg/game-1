'use strict';

const { C } = require('./theme');

const ECHO_TIMELINE_HEIGHT = 32;

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
  const titleWidth = 83, column = (w - titleWidth - 6) / 3;
  c.save();
  r.icon('echo', x + 12, y + h / 2, 17, C.blueText);
  r.text('回声预告', x + 26, y + h / 2, 11, C.muted);
  r.line([[x + titleWidth + 8, y + h / 2], [x + w - 20, y + h / 2]], C.line, 1.5);
  for (const entry of getEchoForecast(game)) {
    const left = x + titleWidth + (entry.beat - 1) * column;
    const center = left + column / 2;
    const ink = entry.seal ? C.blueText : C.muted;
    r.circle(center, y + h / 2, 12, entry.seal ? C.blue : C.panel, entry.cell === null ? C.line : C.blueText);
    if (entry.seal) r.icon('stamp', center, y + h / 2, 13, C.white);
    else r.text(entry.cell === null ? '·' : entry.beat, center, y + h / 2, 11, ink, 'center', '600');
    r.text(entry.beat + '拍', center + 19, y + h / 2, 9, C.muted);
  }
  c.restore();
}

// Mark the earliest arrival at each tile. A wait can queue the same tile more
// than once; listing all its beats prevents duplicate markers from overlapping.
function drawEchoMarkers(r, forecast, projection) {
  const groups = new Map(), { point, halfW, halfH } = projection, c = r.ctx;
  for (const entry of forecast) {
    if (entry.cell === null) continue;
    const group = groups.get(entry.cell);
    if (group) { group.beats.push(entry.beat); group.seal ||= entry.seal; }
    else groups.set(entry.cell, { beats: [entry.beat], seal: entry.seal });
  }
  c.save();
  for (const [cell, group] of groups) {
    const [x, y] = point(cell), label = group.beats.join('·');
    const size = Math.max(7.5, Math.min(10, halfW * .43));
    const width = Math.max(size + 6, label.length * size * .48 + 8);
    const height = size + 4, left = x - width / 2, top = y + halfH * .42 - height / 2;
    r.round(left, top, width, height, height / 2, group.seal ? '#367f85' : '#edf8ed', '#639f9d');
    r.text(label, x, top + height / 2, size, group.seal ? '#ffffff' : '#376d70', 'center', '600');
  }
  c.restore();
}

module.exports = { ECHO_TIMELINE_HEIGHT, getEchoForecast, drawEchoTimeline, drawEchoMarkers };
