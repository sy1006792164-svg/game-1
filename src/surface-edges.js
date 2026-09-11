'use strict';

// The same upper-left light shapes cards, receipts and raised interface surfaces.
// Edges stay inside the face, so small screens keep their existing content space.
function drawSurfaceEdges(r, x, y, w, h, radius, dark = false) {
  const c = r.ctx, inset = 1.5, curve = Math.max(0, Math.min(radius, w / 2, h / 2) - inset);
  const left = x + inset, right = x + w - inset, top = y + inset, bottom = y + h - inset;
  c.save(); c.lineWidth = .9; c.lineCap = 'round';
  c.beginPath(); c.moveTo(left, bottom - curve);
  c.lineTo(left, top + curve); c.arcTo(left, top, left + curve, top, curve);
  c.lineTo(right - curve, top);
  c.strokeStyle = dark ? '#c6dec18a' : '#fffef1dc'; c.stroke();
  c.beginPath(); c.moveTo(right, top + curve);
  c.lineTo(right, bottom - curve); c.arcTo(right, bottom, right - curve, bottom, curve);
  c.lineTo(left + curve, bottom);
  c.strokeStyle = dark ? '#183e3966' : '#718a7163'; c.stroke();
  c.restore();
}

module.exports = { drawSurfaceEdges };
