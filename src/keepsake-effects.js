'use strict';

const { C } = require('./theme');

const clamp = value => Math.max(0, Math.min(1, value));
const quiet = r => r.reducedMotion || r.effectsQuality === 'low';

// Light stays inside illustration space; labels and action targets never move.
function drawEmblemLight(r, x, y, radius, age, accent = C.gold) {
  const c = r.ctx, elapsed = Number.isFinite(age) ? Math.max(0, age) : 1000;
  c.save();
  c.beginPath(); c.arc(x, y, radius - 1, Math.PI * 1.06, Math.PI * 1.8);
  c.strokeStyle = '#fffef3'; c.lineWidth = 1.2; c.stroke();
  if (!quiet(r) && elapsed < 700) {
    const progress = elapsed / 700, pulse = Math.sin(progress * Math.PI);
    c.globalAlpha *= pulse * .55;
    c.beginPath(); c.arc(x, y, radius + 4, Math.PI * (1.08 + progress * .6), Math.PI * (1.1 + progress * 2));
    c.strokeStyle = accent; c.lineWidth = 1.25; c.stroke();
    c.beginPath(); c.arc(x, y, radius - 5, Math.PI * (.18 + progress * .6), Math.PI * (.3 + progress * 1.3));
    c.strokeStyle = '#fff7d7'; c.lineWidth = 2.2; c.stroke();
  }
  c.restore();
}

function drawStampFinish(r, stamp, rect, age, next = false) {
  const c = r.ctx, x = rect.x + rect.w / 2, y = rect.y + rect.h * 62 / 144;
  const radius = rect.w * 28 / 106, accent = stamp.owned ? C.green : C.gold;
  const elapsed = Number.isFinite(age) ? Math.max(0, age) : 1000;
  c.save();
  if (stamp.owned || next) {
    c.beginPath(); c.arc(x, y, radius + 2, -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * (stamp.owned ? 1 : clamp(stamp.stageCurrent / Math.max(1, stamp.stageGoal))));
    c.strokeStyle = stamp.owned ? '#859a7080' : '#bb934f'; c.lineWidth = 1.1; c.stroke();
  }
  if (stamp.owned) {
    // The collection seal lives beside the artwork, clear of the stamp's copy.
    const sealX = rect.x + rect.w + 10, sealY = rect.y + 22;
    r.circle(sealX + 1, sealY + 2, 10, '#78907726');
    r.circle(sealX, sealY, 10, '#e8f0dc', '#97af87');
    r.circle(sealX, sealY, 7.4, null, '#fffdf0');
    r.icon('check', sealX, sealY, 12, accent);
  }
  if (!quiet(r) && (stamp.owned || next) && elapsed < 860) {
    const progress = elapsed / 860, beamX = x - radius * 2.8 + progress * radius * 5.6;
    c.save(); c.beginPath(); c.arc(x, y, radius - 4, 0, Math.PI * 2); c.clip();
    c.globalAlpha *= Math.sin(progress * Math.PI) * (stamp.owned ? .3 : .14);
    // A finite diagonal reflection crosses only the medallion, never text.
    c.beginPath(); c.moveTo(beamX, y - radius); c.lineTo(beamX + radius * .28, y - radius);
    c.lineTo(beamX + radius * 1.05, y + radius); c.lineTo(beamX + radius * .77, y + radius); c.closePath();
    c.fillStyle = '#fffef0'; c.fill(); c.restore();
  }
  c.restore();
}

module.exports = { drawEmblemLight, drawStampFinish };
