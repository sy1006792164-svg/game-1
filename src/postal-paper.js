'use strict';

const { C } = require('./theme');

// Receipts, album leaves and settings share the same quiet paper surface.
function drawPostalPaper(r, x, y, w, h, { tone = 'cream', radius = 18 } = {}) {
  const moss = tone === 'moss';
  r.panel(x, y, w, h, { fill: moss ? C.raised : C.panel, stroke: C.line, radius, flat: true });
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
