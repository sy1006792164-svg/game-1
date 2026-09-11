'use strict';

const { C } = require('./theme');
const { CONTROL, buttonLayout } = require('./controls');
const { drawResultHeader, drawResultStars } = require('./result-effects');
const { layoutHelp, drawHelp } = require('./help-view');

// Measure each block before drawing so titles, paragraphs and actions keep
// their own space, including when a longer label wraps onto another line.
function measureModal(r, modal, navigation = null, helpHeight = 0) {
  const x = 22, w = 346, inset = 24, width = w - inset * 2;
  const titleSize = 20, titleHeight = 28, lineHeight = 22;
  let cursor = modal.sections ? 24 : 96;
  const kickerY = modal.kicker ? cursor + 5 : null;
  if (modal.kicker) cursor += 22;
  const title = r.wrapLines(modal.title, width, titleSize, '600');
  const titleY = cursor + titleHeight / 2;
  cursor += title.length * titleHeight;
  let starsY = null;
  if (modal.stars) { cursor += 16; starsY = cursor + 18; cursor += 36; }
  const help = modal.sections ? layoutHelp(r, modal.sections, width) : null;
  const helpY = help ? cursor + 22 : null;
  if (help) cursor = helpY + Math.max(help.height, helpHeight);
  const paragraphs = [];
  if (modal.lines.length) cursor += 18;
  modal.lines.forEach((text, index) => {
    if (index) cursor += 6;
    const lines = r.wrapLines(text, width, 13);
    paragraphs.push({ lines, y: cursor + lineHeight / 2 });
    cursor += lines.length * lineHeight;
  });
  if (navigation) {
    cursor += 20;
    navigation = { ...navigation, y: cursor };
    cursor += CONTROL.compactHeight;
  }
  if (modal.buttons.length) cursor += navigation ? 14 : 24;
  const styles = modal.buttons.map(button => button.primary ? 'primary' : button.textOnly ? 'quiet' : 'secondary');
  const buttonHeight = Math.max(CONTROL.height, ...modal.buttons.map((button, index) => {
    const layout = buttonLayout(r, button.text, width, { style: styles[index], icon: button.icon });
    return layout.lines.length * layout.lineHeight + 24;
  }));
  const buttons = modal.buttons.map((button, index) => {
    if (index) cursor += 10;
    const result = { ...button, x: x + inset, y: cursor, w: width, h: buttonHeight, style: styles[index] };
    cursor += buttonHeight;
    return result;
  });
  const h = cursor + 24;
  return { x, y: Math.max(24, (r.H - h) / 2), w, h, width, kickerY, title, titleY, titleSize, titleHeight, starsY, help, helpY, paragraphs, lineHeight, buttons, navigation };
}

function modalLayout(r, modal) {
  const full = measureModal(r, modal), available = r.H - 48;
  if (!modal.sections || full.h <= available) return full;
  // Keep whole help topics together and preserve readable type and full-sized
  // close controls. Only the longer current-map help needs another page.
  const frame = measureModal(r, { ...modal, sections: [] }, { page: 0, count: 1 });
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
    modal.helpPage = Math.min(pages.length - 1, Math.max(0, page + direction));
    r.hits = [];
  };
  const pageHeight = Math.max(...pages.map(topics => layoutHelp(r, topics, full.width).height));
  return measureModal(r, { ...modal, sections: pages[page] }, {
    page, count: pages.length, previous: turn(-1), next: turn(1)
  }, pageHeight);
}

function drawModal(r, modal, now, resultAge = null) {
  const c = r.ctx, age = Math.max(0, now - r.modalAt), ui = modalLayout(r, modal);
  r.helpNavigation = ui.navigation ? { ...ui.navigation, modal } : null;
  const result = modal.kind === 'win' || modal.kind === 'fail';
  const accent = modal.kind === 'fail' ? '#a76e55' : C.gold;
  c.save(); c.globalAlpha *= r.reducedMotion ? 1 : Math.min(1, .18 + age / 180);
  r.scrim('#36554979');
  r.panel(ui.x, ui.y, ui.w, ui.h, { radius: 23, fill: C.panel, stroke: C.surfaceEdge, accent });
  r.round(ui.x + 8, ui.y + 8, ui.w - 16, ui.h - 16, 18, null, '#e4e8d9');
  r.line([[ui.x + 42, ui.y + 2], [ui.x + ui.w - 42, ui.y + 2]], accent, 2);
  // Small cancellation marks turn the result into a paper receipt without
  // adding height or moving its text and actions on compact screens.
  if (!ui.help) [ui.x + 48, ui.x + ui.w - 89].forEach(left => {
    for (let line = 0; line < 3; line++) {
      const y = ui.y + 46 + line * 6;
      r.line([[left, y + 2], [left + 12, y], [left + 26, y + 2], [left + 40, y]], '#c7d4be', 1);
    }
  });
  const help = modal.kind === 'help';
  if (result) drawResultHeader(r, modal.kind, ui, resultAge);
  else if (!ui.help) {
    r.circle(195, ui.y + 52, 29, '#f5ecd5', '#d6c5a5');
    r.circle(195, ui.y + 52, 23, '#fffaf0', '#e6d8bb');
    r.icon(help ? 'echo' : 'wind', 195, ui.y + 52, 28, help ? C.blue : C.gold);
  }
  if (modal.kicker) r.label(modal.kicker, 195, ui.y + ui.kickerY, ui.width, 10, C.muted, 'center');
  ui.title.forEach((line, i) => r.text(line, 195, ui.y + ui.titleY + i * ui.titleHeight, ui.titleSize, C.ink, 'center', '600'));
  if (ui.starsY != null) drawResultStars(r, modal.stars, ui.y + ui.starsY, resultAge);
  if (ui.help) drawHelp(r, ui.help, ui.x + 24, ui.y + ui.helpY);
  ui.paragraphs.forEach(paragraph => paragraph.lines.forEach((line, i) => {
    r.text(line, help ? ui.x + 24 : 195, ui.y + paragraph.y + i * ui.lineHeight, 13, C.muted, help ? 'left' : 'center');
  }));
  if (ui.buttons.length || ui.navigation) {
    const separatorY = ui.y + (ui.navigation ? ui.navigation.y : ui.buttons[0].y) - 12;
    r.line([[ui.x + 24, separatorY], [ui.x + ui.w - 24, separatorY]], '#d1d8c3', 1, [2, 5]);
    r.circle(ui.x + 8, separatorY, 3, '#e0e6d3');
    r.circle(ui.x + ui.w - 8, separatorY, 3, '#e0e6d3');
  }
  if (ui.navigation) {
    const nav = ui.navigation, y = ui.y + nav.y;
    r.button('上一页', ui.x + 24, y, 104, CONTROL.compactHeight, nav.previous,
      { style: 'quiet', icon: 'back', disabled: nav.page === 0 });
    r.text((nav.page + 1) + ' / ' + nav.count, 195, y + CONTROL.compactHeight / 2, 12, C.muted, 'center');
    r.button('下一页', ui.x + ui.w - 128, y, 104, CONTROL.compactHeight, nav.next,
      { style: 'quiet', icon: 'chevron', disabled: nav.page === nav.count - 1 });
  }
  ui.buttons.forEach(button => r.button(button.text, button.x, ui.y + button.y, button.w, button.h, button.action,
    { style: button.style, icon: button.icon }));
  c.restore();
  return ui;
}

module.exports = { drawModal };
