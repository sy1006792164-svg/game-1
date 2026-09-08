'use strict';

const { C } = require('./theme');

// Measure each block before drawing so titles, paragraphs and actions keep
// their own space, including when a longer label wraps onto another line.
function modalLayout(r, modal) {
  const x = 22, w = 346, inset = 24, width = w - inset * 2;
  const titleSize = 20, titleHeight = 28, lineHeight = 22;
  let cursor = 96;
  const kickerY = modal.kicker ? cursor + 5 : null;
  if (modal.kicker) cursor += 22;
  const title = r.wrapLines(modal.title, width, titleSize, '600');
  const titleY = cursor + titleHeight / 2;
  cursor += title.length * titleHeight;
  let starsY = null;
  if (modal.stars) { cursor += 16; starsY = cursor + 18; cursor += 36; }
  const paragraphs = [];
  if (modal.lines.length) cursor += 18;
  modal.lines.forEach((text, index) => {
    if (index) cursor += 6;
    const lines = r.wrapLines(text, width, 13);
    paragraphs.push({ lines, y: cursor + lineHeight / 2 });
    cursor += lines.length * lineHeight;
  });
  if (modal.buttons.length) cursor += 24;
  const buttons = modal.buttons.map((button, index) => {
    if (index) cursor += button.textOnly ? 6 : 12;
    const style = button.primary ? 'primary' : button.textOnly ? 'quiet' : 'secondary';
    const size = button.textOnly ? 13 : 15;
    const lines = r.wrapLines(button.text, width - 32, size, button.primary ? '700' : '500');
    const h = Math.max(button.textOnly ? 44 : 48, lines.length * 20 + 20);
    const result = { ...button, x: x + inset, y: cursor, w: width, h, style };
    cursor += h;
    return result;
  });
  const last = modal.buttons[modal.buttons.length - 1];
  const h = cursor + (last && last.textOnly ? 16 : 24);
  return { x, y: Math.max(24, (r.H - h) / 2), w, h, width, kickerY, title, titleY, titleSize, titleHeight, starsY, paragraphs, lineHeight, buttons };
}

function drawStars(r, stars, y, age) {
  for (let i = 0; i < 3; i++) {
    const x = 150 + i * 45, size = i === 1 ? 36 : 29;
    r.icon('star', x, y, size, C.line);
    if (i >= stars) continue;
    const progress = r.reducedMotion ? 1 : Math.min(1, Math.max(0, (age - 120 - i * 180) / 300));
    if (!progress) continue;
    const eased = 1 - Math.pow(1 - progress, 3);
    r.ctx.save(); r.ctx.globalAlpha *= eased;
    r.icon('star', x, y, size * (.65 + eased * .35), C.yellow);
    r.ctx.restore();
    if (progress === 1) continue;
    r.ctx.save(); r.ctx.globalAlpha *= Math.sin(progress * Math.PI) * .65;
    // Keep the celebration inside the star row, clear of the result and actions.
    for (let side = -1; side <= 1; side += 2) {
      const sparkX = x + side * (14 + progress * 7), sparkY = y - 12 - progress * 5;
      r.line([[sparkX - 2, sparkY], [sparkX + 2, sparkY]], C.gold, 1);
      r.line([[sparkX, sparkY - 2], [sparkX, sparkY + 2]], C.gold, 1);
    }
    r.ctx.restore();
  }
}

function drawModal(r, modal, now) {
  const c = r.ctx, age = Math.max(0, now - r.modalAt), ui = modalLayout(r, modal);
  c.save(); c.globalAlpha *= r.reducedMotion ? 1 : Math.min(1, .18 + age / 180);
  c.fillStyle = '#071d25c7';
  c.fillRect(-r.ox / r.scale, -r.oy / r.scale, 390 + r.ox * 2 / r.scale, r.H + r.oy / r.scale + r.safeBottom / r.scale);
  r.round(ui.x, ui.y + 5, ui.w, ui.h, 24, '#071c24');
  r.round(ui.x, ui.y, ui.w, ui.h, 24, C.panel, '#6a8270');
  r.line([[ui.x + 35, ui.y + 2], [ui.x + ui.w - 35, ui.y + 2]], C.gold, 2);
  r.circle(195, ui.y + 52, 28, '#d1b97112', '#697e69');
  r.circle(195, ui.y + 52, 22, '#35554e');
  const help = modal.kind === 'help';
  const icon = modal.kind === 'win' ? 'letter' : modal.kind === 'fail' ? 'lamp' : help ? 'echo' : 'wind';
  r.icon(icon, 195, ui.y + 52, 28, help ? C.blue : C.gold);
  if (modal.kicker) r.label(modal.kicker, 195, ui.y + ui.kickerY, ui.width, 10, C.muted, 'center');
  ui.title.forEach((line, i) => r.text(line, 195, ui.y + ui.titleY + i * ui.titleHeight, ui.titleSize, C.ink, 'center', '600'));
  if (ui.starsY != null) drawStars(r, modal.stars, ui.y + ui.starsY, age);
  ui.paragraphs.forEach(paragraph => paragraph.lines.forEach((line, i) => {
    r.text(line, help ? ui.x + 24 : 195, ui.y + paragraph.y + i * ui.lineHeight, 13, C.muted, help ? 'left' : 'center');
  }));
  ui.buttons.forEach(button => r.button(button.text, button.x, ui.y + button.y, button.w, button.h, button.action, button.style));
  c.restore();
  return ui;
}

module.exports = { drawModal };
