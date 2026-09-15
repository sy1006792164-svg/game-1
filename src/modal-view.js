'use strict';

const { C } = require('./theme');
const { CONTROL, buttonLayout } = require('./controls');
const { drawResultStars } = require('./result-effects');
const { layoutHelp, drawHelp } = require('./help-view');
const { drawItemArt } = require('./item-view');

function actionRows(r, modal, width, touchHeight) {
  const gap = 10, half = (width - gap) / 2;
  const isExit = button => modal.kind === 'pause' && button.text === '返回邮局';
  const layout = (button, w) => {
    const style = button.primary ? 'primary' : isExit(button) ? 'text' :
      modal.kind === 'pause' ? 'quiet' : button.textOnly ? 'text' : 'secondary';
    const measured = buttonLayout(r, button.text, w, { style, icon: button.icon });
    return { ...button, w, style, h: Math.max(button.primary ? CONTROL.height : CONTROL.compactHeight,
      touchHeight, measured.lines.length * measured.lineHeight + 16) };
  };
  const rows = [];
  for (let index = 0; index < modal.buttons.length; index++) {
    const button = modal.buttons[index], next = modal.buttons[index + 1];
    const pair = !button.primary && next && !next.primary &&
      !isExit(button) && !isExit(next) &&
      button.text.length <= 9 && next.text.length <= 9;
    const buttons = pair ? [layout(button, half), layout(next, half)] : [layout(button, width)];
    rows.push({ buttons, height: Math.max(...buttons.map(entry => entry.h)), gap, exit: isExit(button) });
    if (pair) index++;
  }
  return rows;
}

// Measure each block before drawing so titles, paragraphs and actions keep
// their own space, including when a longer label wraps onto another line.
function measureModal(r, modal, navigation = null, helpHeight = 0, compact = false) {
  const x = 22, w = 346, inset = 24, width = w - inset * 2;
  const titleSize = compact ? 22 : 24, titleHeight = 30, bodySize = 14, lineHeight = compact ? 21 : 23;
  const touchHeight = Math.max(CONTROL.compactHeight, 44 / (r.scale || 1));
  const result = modal.kind === 'win' || modal.kind === 'fail';
  let cursor = modal.kind === 'item' ? 68 : modal.kind === 'pause' ? 30 : 24;
  if (modal.journeyProgress) cursor = compact ? 72 : 86;
  else if (modal.sections) cursor = compact ? 18 : 24;
  else if (result) cursor = compact ? 56 : 72;
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
    const lines = r.wrapLines(text, width, bodySize);
    paragraphs.push({ lines, y: cursor + lineHeight / 2 });
    cursor += lines.length * lineHeight;
  });
  let progress = null;
  if (modal.progressLine) {
    const style = { style: 'quiet', icon: 'stamp', trailing: 'chevron', size: 13,
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
  const buttons = [];
  actionRows(r, modal, width, touchHeight).forEach((row, index) => {
    if (index) cursor += row.exit ? compact ? 12 : 18 : compact ? 8 : 10;
    row.buttons.forEach((button, column) => buttons.push({ ...button, x: x + inset + column * (button.w + row.gap),
      y: cursor, h: row.height }));
    cursor += row.height;
  });
  const h = cursor + (compact ? 20 : 24);
  return { x, y: Math.max(24, (r.H - h) / 2), w, h, width, compact, kickerY, title, titleY, titleSize, titleHeight, bodySize, starsY, help, helpY, paragraphs, lineHeight, progress, buttons, navigation };
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
  const c = r.ctx, age = Number.isFinite(r.modalAt) ? Math.max(0, now - r.modalAt) : 1000, ui = modalLayout(r, modal);
  r.helpNavigation = ui.navigation ? { ...ui.navigation, modal } : null;
  const result = modal.kind === 'win' || modal.kind === 'fail';
  const enter = Math.min(1, age / 220);
  c.save(); c.globalAlpha *= r.reducedMotion ? 1 : .32 + .68 * (1 - (1 - enter) ** 3);
  r.scrim('#36554979');
  r.round(ui.x, ui.y + 6, ui.w, ui.h, 20, '#173c3518');
  r.round(ui.x, ui.y, ui.w, ui.h, 20, C.panel, C.line);
  const help = modal.kind === 'help';
  const reading = modal.sections || modal.kind === 'pause';
  if (result) {
    const centerY = ui.y + (ui.compact ? 30 : 42);
    r.circle(195, centerY, ui.compact ? 19 : 23, modal.kind === 'win' ? C.soft : C.peach);
    r.icon(modal.kind === 'win' ? 'check' : 'lamp', 195, centerY, ui.compact ? 23 : 27,
      modal.kind === 'win' ? C.green : C.orange);
  }
  else if (modal.journeyProgress) {
    const journey = modal.journeyProgress;
    r.circle(195, ui.y + 32, 21, C.soft);
    r.icon(journey.done ? 'check' : 'stamp', 195, ui.y + 32, 25, C.green);
    const gap = 19, start = 195 - (journey.target - 1) * gap / 2;
    for (let index = 0; index < journey.target; index++) {
      r.circle(start + index * gap, ui.y + 66, 4, index < journey.points ? C.green : C.line);
    }
  }
  else if (modal.kind === 'item') {
    r.circle(195, ui.y + 36, 24, modal.itemId === 'echo' ? C.bluePale : C.soft);
    drawItemArt(r, modal.itemId, 195, ui.y + 36, 31);
  }
  else if (modal.kind === 'pause') {
    r.circle(ui.x + ui.w - 46, ui.y + 44, 20, C.soft);
    r.icon('pause', ui.x + ui.w - 46, ui.y + 44, 22, C.green);
  }
  if (modal.kicker) r.label(modal.kicker, 195, ui.y + ui.kickerY, ui.width, 12, C.muted, 'center');
  ui.title.forEach((line, i) => r.text(line, reading ? ui.x + 24 : 195,
    ui.y + ui.titleY + i * ui.titleHeight, ui.titleSize, C.ink, reading ? 'left' : 'center', '700'));
  if (ui.starsY != null) drawResultStars(r, modal.stars, ui.y + ui.starsY, resultAge);
  if (ui.help) drawHelp(r, ui.help, ui.x + 24, ui.y + ui.helpY);
  const left = help || modal.kind === 'pause' || modal.kind === 'item' || ui.paragraphs.some(paragraph => paragraph.lines.length > 1);
  ui.paragraphs.forEach((paragraph, index) => {
    const warning = paragraph.lines.some(line => /仅在本次运行|存储.*异常|未能保存/.test(line));
    const lead = (result || modal.kind === 'item') && index === 0;
    const color = warning ? C.dangerText : lead ? C.ink : C.muted;
    paragraph.lines.forEach((line, i) => r.text(line, left ? ui.x + 24 : 195,
      ui.y + paragraph.y + i * ui.lineHeight, ui.bodySize, color, left ? 'left' : 'center', lead && i === 0 ? '600' : '400'));
  });
  if (modal.kind !== 'pause' && (ui.progress || ui.buttons.length || ui.navigation)) {
    const separatorY = ui.y + (ui.progress ? ui.progress.y - 6 : (ui.navigation ? ui.navigation.y : ui.buttons[0].y) - 12);
    r.line([[ui.x + 24, separatorY], [ui.x + ui.w - 24, separatorY]], C.line, 1);
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
