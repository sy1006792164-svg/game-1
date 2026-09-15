'use strict';

const { C } = require('./theme');
const { CONTROL, buttonLayout } = require('./controls');
const { drawResultHeader, drawResultStars } = require('./result-effects');
const { layoutHelp, drawHelp } = require('./help-view');
const { drawSurfaceEdges } = require('./surface-edges');
const { drawItemArt } = require('./item-view');
const { drawEmblemLight } = require('./keepsake-effects');
const { drawDeliveryIntro } = require('./delivery-presentation');
const { drawPostalRules, drawPostmark } = require('./postal-paper');

// Measure each block before drawing so titles, paragraphs and actions keep
// their own space, including when a longer label wraps onto another line.
function measureModal(r, modal, navigation = null, helpHeight = 0, compact = false) {
  const x = 22, w = 346, inset = 24, width = w - inset * 2;
  const titleSize = 22, titleHeight = 30, lineHeight = compact ? 20 : 22;
  const touchHeight = Math.max(CONTROL.compactHeight, 44 / (r.scale || 1));
  const result = modal.kind === 'win' || modal.kind === 'fail';
  let cursor = 76;
  if (modal.journeyProgress) cursor = compact ? 72 : 86;
  else if (modal.sections) cursor = compact ? 18 : 24;
  else if (result) cursor = compact ? 64 : 96;
  const kickerY = modal.kicker ? cursor + 5 : null;
  if (modal.kicker) cursor += 22;
  const title = r.wrapLines(modal.title, width, titleSize, '700');
  const titleY = cursor + titleHeight / 2;
  cursor += title.length * titleHeight;
  let starsY = null;
  if (modal.stars) { cursor += compact ? 6 : 16; starsY = cursor + 18; cursor += 36; }
  const help = modal.sections ? layoutHelp(r, modal.sections, width) : null;
  const helpY = help ? cursor + (compact ? 14 : 22) : null;
  if (help) cursor = helpY + Math.max(help.height, helpHeight);
  const paragraphs = [];
  if (modal.lines.length) cursor += compact ? 14 : 18;
  modal.lines.forEach((text, index) => {
    if (index) cursor += compact ? 4 : 6;
    const lines = r.wrapLines(text, width, 13);
    paragraphs.push({ lines, y: cursor + lineHeight / 2 });
    cursor += lines.length * lineHeight;
  });
  let progress = null;
  if (modal.progressLine) {
    const style = { style: 'text', icon: 'stamp', trailing: 'chevron', size: 12,
      disabled: typeof modal.progressAction !== 'function' };
    const layout = buttonLayout(r, modal.progressLine, width, style);
    cursor += compact ? 8 : 12;
    progress = { text: modal.progressLine, action: modal.progressAction, x: x + inset,
      y: cursor, w: width, h: Math.max(touchHeight, layout.lines.length * layout.lineHeight + 16), style };
    cursor += progress.h;
  }
  if (navigation) {
    cursor += compact ? 12 : 20;
    navigation = { ...navigation, y: cursor, h: touchHeight };
    cursor += touchHeight;
  }
  const actionGap = compact ? 8 : navigation ? 14 : 12;
  if (modal.buttons.length) cursor += navigation || progress ? actionGap : compact ? 16 : 24;
  const buttons = modal.buttons.map((button, index) => {
    const style = button.primary ? 'primary' : button.textOnly ? 'text' : 'secondary';
    const layout = buttonLayout(r, button.text, width, { style, icon: button.icon });
    const buttonHeight = Math.max(button.primary ? CONTROL.height : CONTROL.compactHeight, touchHeight,
      layout.lines.length * layout.lineHeight + 20);
    if (index) cursor += compact ? 6 : 8;
    const result = { ...button, x: x + inset, y: cursor, w: width, h: buttonHeight, style };
    cursor += buttonHeight;
    return result;
  });
  const h = cursor + (compact ? 20 : 24);
  return { x, y: Math.max(24, (r.H - h) / 2), w, h, width, compact, kickerY, title, titleY, titleSize, titleHeight, starsY, help, helpY, paragraphs, lineHeight, progress, buttons, navigation };
}

function modalLayout(r, modal) {
  const available = r.H - 48;
  let full = measureModal(r, modal);
  const compact = full.h > available;
  if (compact) full = measureModal(r, modal, null, 0, true);
  if (!modal.sections || full.h <= available) return full;
  // Keep topics intact and retain readable type and full-sized controls.
  // Page bodies share the action frame's spacing and physical touch budget.
  const frame = measureModal(r, { ...modal, sections: [] }, { page: 0, count: 1 }, 0, compact);
  const bodyHeight = Math.max(0, available - frame.h), pages = [];
  let sections = [];
  for (const section of modal.sections) {
    const next = [...sections, section];
    if (sections.length && layoutHelp(r, next, full.width).height > bodyHeight) {
      pages.push(sections); sections = [];
    }
    sections.push(section);
  }
  if (sections.length) pages.push(sections);
  const page = Math.min(pages.length - 1, Math.max(0, Number.isInteger(modal.helpPage) ? modal.helpPage : 0));
  const turn = direction => () => {
    const current = Math.min(pages.length - 1, Math.max(0, Number.isInteger(modal.helpPage) ? modal.helpPage : page));
    modal.helpPage = Math.min(pages.length - 1, Math.max(0, current + direction));
    r.hits = [];
  };
  const pageHeight = Math.max(...pages.map(topics => layoutHelp(r, topics, full.width).height));
  return measureModal(r, { ...modal, sections: pages[page] }, {
    page, count: pages.length, previous: turn(-1), next: turn(1)
  }, pageHeight, compact);
}

function drawModal(r, modal, now, resultAge = null) {
  const delivery = drawDeliveryIntro(r, modal, now, resultAge);
  if (delivery) { r.helpNavigation = null; return delivery; }
  if (r.deliveryPresentation) {
    // A finger pressed on the ceremony must not release onto a freshly
    // uncovered next-route button when the ceremony finishes on its own.
    if (r.pointer) r.pointer.cancelled = true;
    r.deliveryPresentation = null;
  }
  // A skipped or completed ceremony reveals the complete receipt immediately.
  if (modal.kind === 'win' && modal.delivery) resultAge = null;
  const c = r.ctx, age = Number.isFinite(r.modalAt) ? Math.max(0, now - r.modalAt) : 1000, ui = modalLayout(r, modal);
  r.helpNavigation = ui.navigation ? { ...ui.navigation, modal } : null;
  const result = modal.kind === 'win' || modal.kind === 'fail';
  const accent = modal.kind === 'fail' ? '#a76e55' : C.gold;
  const enter = Math.min(1, age / 220);
  c.save(); c.globalAlpha *= r.reducedMotion ? 1 : .32 + .68 * (1 - (1 - enter) ** 3);
  r.scrim('#36554979');
  r.round(ui.x + 3, ui.y + 8, ui.w - 6, ui.h, 23, '#24473526');
  r.round(ui.x - 2, ui.y + 3, ui.w + 4, ui.h, 23, '#e5d6b7', '#bda77f');
  r.round(ui.x, ui.y, ui.w, ui.h, 23, '#fff8e8', '#caba96');
  drawSurfaceEdges(r, ui.x, ui.y, ui.w, ui.h, 23);
  r.line([[ui.x + 42, ui.y + 2], [ui.x + ui.w - 42, ui.y + 2]], accent, 2);
  for (let hole = ui.y + 24; hole < ui.y + ui.h - 18; hole += 18) {
    r.round(ui.x + 8, hole, 2, 2, 1, '#b8a07c60');
    r.round(ui.x + ui.w - 10, hole, 2, 2, 1, '#b8a07c60');
  }
  // Small cancellation marks turn the result into a paper receipt without
  // adding height or moving its text and actions on compact screens.
  if (result) [ui.x + 48, ui.x + ui.w - 89].forEach(left => {
    for (let line = 0; line < 3; line++) {
      const y = ui.y + 46 + line * 6;
      r.line([[left, y + 2], [left + 12, y], [left + 26, y + 2], [left + 40, y]], '#c7d4be', 1);
    }
  });
  const help = modal.kind === 'help';
  if (result) drawResultHeader(r, modal.kind, ui, resultAge);
  else if (modal.journeyProgress) {
    const journey = modal.journeyProgress;
    drawPostmark(r, 195, ui.y + 32, 39, journey.done ? 'check' : 'stamp', C.goldText);
    const gap = 19, start = 195 - (journey.target - 1) * gap / 2;
    for (let index = 0; index < journey.target; index++) {
      r.circle(start + index * gap, ui.y + 66, 4, index < journey.points ? C.gold : '#e4dac2', '#c6b593');
    }
  }
  else if (modal.kind === 'item') {
    const itemAccent = modal.itemId === 'echo' ? '#72aabb' : modal.itemId === 'kite' ? '#719f89' : modal.itemId === 'bridge' ? '#ab8860' : C.gold;
    r.circle(195, ui.y + 41.5, 26, '#8b997524');
    r.circle(195, ui.y + 40, 24, modal.itemId === 'echo' ? '#e0eff1' : modal.itemId === 'kite' ? '#e8efdd' : '#f5ecd5', '#d6c5a5');
    r.circle(195, ui.y + 40, 20, null, '#fff9e9');
    drawItemArt(r, modal.itemId, 195, ui.y + 40, 29);
    drawEmblemLight(r, 195, ui.y + 40, 24, age, itemAccent);
  } else if (!ui.help) {
    r.circle(195, ui.y + 40, 22, C.raised, C.line);
    const emblem = help ? 'echo' : modal.kind === 'pause' ? 'lamp' : modal.kind === 'journey' ? 'stamp' : 'wind';
    r.icon(emblem, 195, ui.y + 40, 24, help ? C.blue : C.gold);
    drawEmblemLight(r, 195, ui.y + 40, 22, age, help ? C.blue : C.gold);
    drawPostalRules(r, 228, ui.y + 34, 35);
  }
  if (modal.kicker) r.label(modal.kicker, 195, ui.y + ui.kickerY, ui.width, 11, C.muted, 'center');
  ui.title.forEach((line, i) => r.text(line, 195, ui.y + ui.titleY + i * ui.titleHeight, ui.titleSize, C.ink, 'center', '700'));
  if (ui.starsY != null) drawResultStars(r, modal.stars, ui.y + ui.starsY, resultAge);
  if (ui.help) drawHelp(r, ui.help, ui.x + 24, ui.y + ui.helpY);
  const left = help || ui.paragraphs.some(paragraph => paragraph.lines.length > 1);
  ui.paragraphs.forEach((paragraph, index) => {
    const color = result && index === 0 ? C.ink : C.muted;
    paragraph.lines.forEach((line, i) => r.text(line, left ? ui.x + 24 : 195,
      ui.y + paragraph.y + i * ui.lineHeight, 13, color, left ? 'left' : 'center'));
  });
  if (ui.progress || ui.buttons.length || ui.navigation) {
    const separatorY = ui.y + (ui.progress ? ui.progress.y - 6 : (ui.navigation ? ui.navigation.y : ui.buttons[0].y) - 12);
    r.line([[ui.x + 24, separatorY], [ui.x + ui.w - 24, separatorY]], '#d1d8c3', 1, [2, 5]);
    r.circle(ui.x + 8, separatorY, 3, '#e0e6d3');
    r.circle(ui.x + ui.w - 8, separatorY, 3, '#e0e6d3');
  }
  if (ui.progress) {
    const progress = ui.progress;
    r.button(progress.text, progress.x, ui.y + progress.y, progress.w, progress.h, progress.action, progress.style);
  }
  if (ui.navigation) {
    const nav = ui.navigation, y = ui.y + nav.y;
    r.button('上一页', ui.x + 24, y, 104, nav.h, nav.previous,
      { style: 'text', icon: 'back', disabled: nav.page === 0 });
    r.text((nav.page + 1) + ' / ' + nav.count, 195, y + nav.h / 2, 12, C.muted, 'center');
    r.button('下一页', ui.x + ui.w - 128, y, 104, nav.h, nav.next,
      { style: 'text', icon: 'chevron', disabled: nav.page === nav.count - 1 });
  }
  ui.buttons.forEach(button => r.button(button.text, button.x, ui.y + button.y, button.w, button.h, button.action,
    { style: button.style, icon: button.icon }));
  c.restore();
  return ui;
}

module.exports = { drawModal };
