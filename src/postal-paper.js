'use strict';

const { C } = require('./theme');

// Receipts, album leaves and settings share the same paper stock. The binding
// stays in the margin so existing content and touch targets keep their space.
function drawPostalPaper(r, x, y, w, h, { tone = 'cream', radius = 16, binding = true } = {}) {
  const moss = tone === 'moss';
  r.panel(x, y, w, h, { fill: moss ? '#edf0df' : '#fff8e7', stroke: '#cfbea0', radius, flat: true });
  r.round(x + 13, y + 2, Math.max(0, w - 26), 1, .5, '#fffef4');
  r.round(x + 13, y + h - 3, Math.max(0, w - 26), 1, .5, '#b9a07c33');
  if (!binding) return;
  r.round(x + 9, y + 15, 1, Math.max(0, h - 30), .5, '#c57e5e40');
  for (let dot = y + 22; dot < y + h - 14; dot += 17) r.round(x + 5, dot, 2.5, 2.5, 1.25, '#ac956b50');
}

function drawPostalRules(r, x, y, w, color = '#a28d6870') {
  for (let index = 0; index < 3; index++) r.round(x, y + index * 5, w - index * 5, 1, .5, color);
}

function drawPostmark(r, x, y, size, icon = 'stamp', color = C.goldText) {
  r.circle(x, y, size / 2, null, color);
  r.circle(x, y, size / 2 - 3, null, color + '70');
  r.icon(icon, x, y, size * .49, color);
  drawPostalRules(r, x + size / 2 - 3, y - 5, size * .72, color + '70');
}

module.exports = { drawPostalPaper, drawPostalRules, drawPostmark };
