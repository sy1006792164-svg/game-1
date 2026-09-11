'use strict';

const { C } = require('./theme');
const { UI_ICON, drawUiIcon } = require('./ui-icons');
const { materialGradient } = require('./ui-surface');

const CONTROL = Object.freeze({ height: 52, compactHeight: 44, icon: UI_ICON.size, gap: 8, depth: 5, lineHeight: 20 });
const TONES = Object.freeze({
  primary: { face: '#326d61', lower: '#204d46', held: '#214e46', edge: C.brassDark, base: '#173c35', shine: '#dbdcada6', ink: C.white, icon: '#f1d39b' },
  secondary: { face: '#fffdf4', lower: '#eae9d8', held: '#e2e6d5', edge: C.surfaceEdge, base: '#afb99f', shine: '#ffffff', ink: C.ink, icon: C.green },
  quiet: { face: '#f3f3e6', lower: '#e2e8d8', held: '#d4dfcc', edge: '#b9c6ad', base: '#b2bea5', shine: '#ffffffbf', ink: C.ink, icon: C.green }
});

function optionsFor(style) { return style && typeof style === 'object' ? style : { style }; }

// Shared painter/modal measurement includes emblems.
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

// Ticket notches stay transparent.
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
  const tab = options.style === 'tab', textOnly = options.style === 'text', flat = tab || textOnly;
  const pointer = r.pointer;
  const pressed = !disabled && pointer && !pointer.dragging &&
    pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
  // Press stays inside the hit target; reduced motion uses color.
  const depth = flat ? 0 : primary ? CONTROL.depth : 3, faceH = h - depth;
  const top = y + (pressed && !flat && !r.reducedMotion ? depth - 1 : 0);
  const cut = primary ? 12 : 9, notch = primary && w >= 140;
  if (disabled) c.globalAlpha *= .46;
  if (tab) {
    plaque(r, x + 2, y + 4, w - 4, h - 8, 7, false,
      pressed ? C.soft : options.selected ? C.panel : null, options.selected ? C.surfaceEdge : null);
    if (options.selected) {
      r.line([[x + 12, y + 5], [x + w - 12, y + 5]], C.white, 1);
      r.line([[x + w / 2 - 15, y + h - 8], [x + w / 2 + 15, y + h - 8]], C.gold, 2);
    }
  } else if (textOnly) {
    if (pressed) r.round(x + 2, y + 5, w - 4, h - 10, 8, C.soft, C.line);
  } else {
    if (!pressed && !disabled && r.effectsQuality !== 'low')
      plaque(r, x + 3, y + depth + 3, w - 6, faceH, cut, false, '#143d341a');
    plaque(r, x + 1, y + depth + 1, w - 2, faceH, cut, notch, '#143d342e');
    plaque(r, x, y + depth, w, faceH, cut, notch, tone.base);
    const face = pressed ? tone.held : r.effectsQuality === 'low' ? tone.face :
      materialGradient(r, x, top, w, faceH, [[0, tone.face], [1, tone.lower]]);
    plaque(r, x, top, w, faceH, cut, notch, face, tone.edge);
    if (primary) {
      plaque(r, x + 2, top + 2, w - 4, faceH - 4, cut - 1, notch, null, '#cfb37b69');
      r.line([[x + cut, y + h - 1.5], [x + w - cut, y + h - 1.5]], '#4f72604f', 1);
    }
    r.line([[x + 2, top + cut], [x + cut, top + 2], [x + w - cut, top + 2]], tone.shine, 1);
    r.line([[x + cut, top + faceH - 2], [x + w - cut, top + faceH - 2]], primary ? '#102f344f' : '#8d9c7733', 1);
  }
  const middle = top + faceH / 2;
  const feedbackAge = Number.isFinite(options.feedbackAt) ? r.now - options.feedbackAt : -1;
  const feedback = !disabled && !r.reducedMotion && feedbackAge >= 0 && feedbackAge < 650;
  const response = feedback ? Math.sin(feedbackAge / 650 * Math.PI) : 0;
  if (response) {
    c.save(); c.globalAlpha *= response * .55;
    plaque(r, x + 2, top + 2, w - 4, faceH - 4, Math.max(4, cut - 2), false, null, primary ? C.brassLight : C.green);
    c.restore();
  }
  const groupX = x + ui.inset + (w - ui.inset * 2 - ui.trailing - ui.leading - ui.textSpan) / 2;
  if (options.icon) {
    const iconOnly = String(text).length === 0;
    const iconX = iconOnly ? x + w / 2 : groupX + CONTROL.icon / 2;
    c.save(); c.translate(iconX, middle);
    if (feedback) c.rotate(options.icon === 'hourglass' ? Math.PI * (1 - (1 - feedbackAge / 650) ** 3) : -.18 * response);
    drawUiIcon(r, options.icon, 0, 0, tone.icon);
    c.restore();
  }
  const textX = groupX + ui.leading + ui.textSpan / 2;
  const textY = middle - (ui.lines.length - 1) * ui.lineHeight / 2;
  const ink = tab ? options.selected ? C.green : C.muted : textOnly ? C.green : tone.ink;
  ui.lines.forEach((line, index) => r.text(line, textX, textY + index * ui.lineHeight, ui.size, ink, 'center', ui.weight));
  if (options.trailing) drawUiIcon(r, options.trailing, x + w - ui.inset - CONTROL.icon / 2, middle, tone.icon);
  c.restore();
  if (!disabled) r.hit(x, y, w, h, action);
}

module.exports = { CONTROL, drawButton, buttonLayout, drawPaperPlaque: plaque };
