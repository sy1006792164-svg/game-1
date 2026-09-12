'use strict';

const { C } = require('./theme');

const clamp = value => Math.max(0, Math.min(1, value));

function decorativeTime(r) {
  return Number.isFinite(r.ambientNow) ? r.ambientNow : Number.isFinite(r.now) ? r.now : 0;
}

function quiet(r) { return r.reducedMotion || r.effectsQuality === 'low'; }

// Keep these cues in the six-point gutters: they never cover a card or add a
// touch target, and persist when the temporary scroll thumb has faded away.
function drawScrollEdges(r, viewport, scroll) {
  if (!(scroll.max > 0)) return;
  const x = viewport.x + viewport.w - 1;
  const moving = scroll.touching || Math.abs(scroll.velocity) > 4 || scroll.wheelTarget != null;
  const drift = quiet(r) || moving ? 0 : Math.sin(decorativeTime(r) / 950) * 1.3;
  if (scroll.offset > 2) {
    const y = viewport.y + 6 - drift;
    r.line([[x - 3, y + 3], [x, y], [x + 3, y + 3]], C.green, 1.1);
  }
  if (scroll.offset < scroll.max - 2) {
    const y = viewport.y + viewport.h - 7 + drift;
    r.line([[x - 3, y - 3], [x, y], [x + 3, y - 3]], C.green, 1.1);
  }
}

// A glint follows the filled portion only; the underlying amount is always the
// real amount, including on a brand new or completely finished chapter.
function drawProgressGlint(r, x, y, w, current, goal, offset = 0) {
  if (quiet(r) || current <= 0 || goal <= 0) return;
  const filled = w * clamp(current / goal);
  if (filled < 8) return;
  const phase = ((decorativeTime(r) + offset) % 5800) / 1150;
  if (phase >= 1) return;
  const shine = Math.sin(phase * Math.PI);
  const center = x + 3 + phase * Math.max(0, filled - 6);
  const length = Math.min(7, filled * .2) * shine;
  r.round(center - length / 2, y + 1.5, length, 2, 1, '#fff6d8ba');
}

function drawLocatedCorners(r, rect, amount) {
  if (!(amount > 0)) return;
  const alpha = Math.round(clamp(amount) * 220).toString(16).padStart(2, '0');
  const color = C.gold + alpha, reach = 13, gap = 3;
  for (const [x, dx] of [[rect.x - gap, 1], [rect.x + rect.w + gap, -1]]) {
    for (const [y, dy] of [[rect.y - gap, 1], [rect.y + rect.h + gap, -1]]) {
      r.line([[x, y + dy * reach], [x, y], [x + dx * reach, y]], color, 1.7);
    }
  }
}

module.exports = { decorativeTime, quiet, drawScrollEdges, drawProgressGlint, drawLocatedCorners };
