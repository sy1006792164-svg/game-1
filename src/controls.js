'use strict';

const { C } = require('./theme');
const { UI_ICON, drawUiIcon } = require('./ui-icons');

const CONTROL = Object.freeze({ height: 52, compactHeight: 44, icon: UI_ICON.size, gap: 8, depth: 3, lineHeight: 20 });
const TONES = Object.freeze({
  primary: { face: C.gold, held: '#dca85f', edge: '#ffe1a3', base: '#88613a', shine: '#fff0c2', ink: C.dark, icon: C.dark },
  secondary: { face: '#2d5250', held: '#24443f', edge: '#78927a', base: '#0a2428', shine: '#b2c79b66', ink: C.ink, icon: C.gold },
  quiet: { face: '#1d3c3e', held: '#2c504a', edge: '#526f64', base: '#102c2d', shine: '#82977933', ink: C.ink, icon: C.green }
});

function optionsFor(style) { return style && typeof style === 'object' ? style : { style }; }

// Shared by the painter and modal measurement, including space for the emblems.
function buttonLayout(r, text, width, style) {
  const options = optionsFor(style), compact = width < 120;
  const size = options.size == null ? compact ? 13 : 15 : options.size;
  const weight = options.style === 'primary' ? '700' : '600';
  const inset = compact ? 8 : 16;
  const leading = options.icon ? CONTROL.icon + CONTROL.gap : 0;
  const trailing = options.trailing ? CONTROL.icon + CONTROL.gap : 0;
  const textWidth = Math.max(1, width - inset * 2 - leading - trailing);
  const lines = r.wrapLines(text, textWidth, size, weight);
  const textSpan = Math.max(0, ...lines.map(line => r.ctx.measureText(line).width));
  return { options, size, weight, inset, leading, trailing, textWidth, textSpan, lines, lineHeight: CONTROL.lineHeight };
}

// A cut paper silhouette; the ticket notches remain transparent on any backdrop.
function plaque(r, x, y, w, h, cut, notch, fill, stroke) {
  const c = r.ctx, middle = y + h / 2;
  c.beginPath(); c.moveTo(x + cut, y); c.lineTo(x + w - cut, y);
  c.lineTo(x + w, y + cut);
  if (notch) { c.lineTo(x + w, middle - 4); c.quadraticCurveTo(x + w - 7, middle, x + w, middle + 4); }
  c.lineTo(x + w, y + h - cut); c.lineTo(x + w - cut, y + h);
  c.lineTo(x + cut, y + h); c.lineTo(x, y + h - cut);
  if (notch) { c.lineTo(x, middle + 4); c.quadraticCurveTo(x + 7, middle, x, middle - 4); }
  c.lineTo(x, y + cut); c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
}

function drawButton(r, text, x, y, w, h, action, style) {
  const c = r.ctx;
  c.save();
  const ui = buttonLayout(r, text, w, style), options = ui.options;
  const tone = TONES[options.style] || TONES.secondary;
  const primary = options.style === 'primary', disabled = !!options.disabled;
  const pointer = r.pointer;
  const pressed = !disabled && pointer && !pointer.dragging &&
    pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
  // Color changes priority; geometry, icon size and baseline stay the same.
  const depth = CONTROL.depth, faceH = h - depth;
  const top = y + (pressed && !r.reducedMotion ? depth - 1 : 0);
  const cut = 8, notch = primary && w >= 140;
  if (disabled) c.globalAlpha *= .46;
  plaque(r, x, y + depth, w, faceH, cut, notch, tone.base);
  plaque(r, x, top, w, faceH, cut, notch, pressed ? tone.held : tone.face, tone.edge);
  r.line([[x + cut + 3, top + 2], [x + w - cut - 3, top + 2]], tone.shine, 1);
  const middle = top + h / 2;
  const groupX = x + ui.inset + (w - ui.inset * 2 - ui.trailing - ui.leading - ui.textSpan) / 2;
  if (options.icon) {
    const iconOnly = String(text).length === 0;
    const iconX = iconOnly ? x + w / 2 : groupX + CONTROL.icon / 2;
    drawUiIcon(r, options.icon, iconX, middle, tone.icon);
  }
  const textX = groupX + ui.leading + ui.textSpan / 2;
  const textY = middle - (ui.lines.length - 1) * ui.lineHeight / 2;
  ui.lines.forEach((line, index) => r.text(line, textX, textY + index * ui.lineHeight, ui.size, tone.ink, 'center', ui.weight));
  if (options.trailing) drawUiIcon(r, options.trailing, x + w - ui.inset - CONTROL.icon / 2, middle, tone.icon);
  c.restore();
  if (!disabled) r.hit(x, y, w, h, action);
}

module.exports = { CONTROL, drawButton, buttonLayout };
