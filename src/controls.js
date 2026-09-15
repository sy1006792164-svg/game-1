'use strict';

const { C } = require('./theme');
const { UI_ICON, drawUiIcon } = require('./ui-icons');
const { buttonTouch, TOUCH_MS } = require('./ui-motion');

const CONTROL = Object.freeze({ height: 52, compactHeight: 44, icon: UI_ICON.size, gap: 8, lineHeight: 20 });
const TONES = Object.freeze({
  primary: { face: C.green, held: '#204d42', ink: C.white, icon: '#f4e9d5' },
  secondary: { face: C.panel, held: '#e4ece2', ink: C.ink, icon: C.green },
  quiet: { face: C.soft, held: '#d9e5da', ink: C.ink, icon: C.green }
});

function optionsFor(style) { return style && typeof style === 'object' ? style : { style }; }

// Shared by the painter and modal measurement, including space for the emblems.
function buttonLayout(r, text, width, style) {
  const options = optionsFor(style), compact = width < 120;
  const size = options.size == null ? compact ? 13 : 15 : options.size;
  const weight = options.style === 'primary' ? '700' :
    options.style === 'text' || options.style === 'quiet' || options.style === 'tab' && !options.selected ? '500' : '600';
  const inset = compact ? 8 : 16;
  const leading = options.icon ? CONTROL.icon + CONTROL.gap : 0;
  const trailing = options.trailing ? CONTROL.icon + CONTROL.gap : 0;
  const textWidth = Math.max(1, width - inset * 2 - leading - trailing);
  const lines = r.wrapLines(text, textWidth, size, weight);
  const textSpan = Math.max(0, ...lines.map(line => r.ctx.measureText(line).width));
  return { options, size, weight, inset, leading, trailing, textWidth, textSpan, lines, lineHeight: CONTROL.lineHeight };
}

function drawButton(r, text, x, y, w, h, action, style) {
  const c = r.ctx;
  c.save();
  const ui = buttonLayout(r, text, w, style), options = ui.options;
  const tone = TONES[options.style] || TONES.secondary;
  const primary = options.style === 'primary', disabled = !!options.disabled;
  const tab = options.style === 'tab', textOnly = options.style === 'text', quiet = options.style === 'quiet';
  const pointer = r.pointer;
  const pressed = !disabled && pointer && !pointer.dragging &&
    pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
  // The full face is also the touch target; feedback never shifts the label.
  const faceH = h, top = y, radius = primary ? 16 : 13;
  if (tab) {
    r.round(x + 2, y + 3, w - 4, h - 6, 12,
      options.selected ? C.green : pressed ? C.soft : null);
  } else if (textOnly) {
    if (pressed) r.round(x, y, w, h, radius, C.soft);
  } else {
    if (!pressed && !disabled && primary && r.effectsQuality !== 'low') {
      r.round(x, y + 3, w, faceH, radius, '#214c4112');
    }
    r.round(x, top, w, h, radius, disabled ? C.raised : pressed ? tone.held : tone.face,
      !primary && !quiet ? C.line : null);
  }
  const touch = !disabled && !r.reducedMotion && buttonTouch(r, x, y, w, h);
  const touchAge = touch ? r.now - touch.at : -1;
  if (touchAge >= 0 && touchAge < TOUCH_MS) {
    const t = touchAge / TOUCH_MS;
    c.save();
    r.round(x + 1, top + 1, w - 2, Math.max(1, faceH - 2), radius);
    c.clip(); c.globalAlpha *= (1 - t) * (primary ? .19 : .12);
    r.circle(touch.touchX, touch.touchY, Math.max(2, Math.hypot(w, h) * (1 - (1 - t) ** 3)), primary ? '#f8ecc6' : '#39796b');
    c.restore();
  }
  const middle = top + faceH / 2;
  const feedbackAge = Number.isFinite(options.feedbackAt) ? r.now - options.feedbackAt : -1;
  const feedback = !disabled && !r.reducedMotion && feedbackAge >= 0 && feedbackAge < 650;
  const response = feedback ? Math.sin(feedbackAge / 650 * Math.PI) : 0;
  if (response) {
    c.save(); c.globalAlpha *= response * .55;
    r.round(x + 2, top + 2, w - 4, faceH - 4, radius - 2, null, primary ? C.white : C.green);
    c.restore();
  }
  const groupX = x + ui.inset + (w - ui.inset * 2 - ui.trailing - ui.leading - ui.textSpan) / 2;
  if (options.icon) {
    const iconOnly = String(text).length === 0;
    const iconX = iconOnly ? x + w / 2 : groupX + CONTROL.icon / 2;
    c.save(); c.translate(iconX, middle);
    if (feedback) c.rotate(options.icon === 'hourglass' ? Math.PI * (1 - (1 - feedbackAge / 650) ** 3) : -.18 * response);
    drawUiIcon(r, options.icon, 0, 0, disabled ? C.muted : tab && options.selected ? C.white : options.color || tone.icon);
    c.restore();
  }
  const textX = groupX + ui.leading + ui.textSpan / 2;
  const textY = middle - (ui.lines.length - 1) * ui.lineHeight / 2;
  const ink = disabled ? C.muted : options.color || (tab ? options.selected ? C.white : C.muted : textOnly ? C.green : tone.ink);
  ui.lines.forEach((line, index) => r.text(line, textX, textY + index * ui.lineHeight, ui.size, ink, 'center', ui.weight));
  if (options.trailing) drawUiIcon(r, options.trailing, x + w - ui.inset - CONTROL.icon / 2, middle, disabled ? C.muted : options.color || tone.icon);
  c.restore();
  if (!disabled) {
    const minimum = 44 / (r.scale || 1), hitW = Math.max(w, minimum), hitH = Math.max(h, minimum);
    r.hit(x - (hitW - w) / 2, y - (hitH - h) / 2, hitW, hitH, action, undefined,
      options.label || String(text) || options.icon);
  }
}

module.exports = { CONTROL, drawButton, buttonLayout };
