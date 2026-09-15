'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');

const GUIDE_HEIGHT = 144;
const MARKERS = {
  move: { color: C.gold },
  letter: { color: C.gold, icon: 'letter' },
  echo: { color: C.blue, icon: 'echo' },
  home: { color: C.green, icon: 'home' },
  wind: { color: C.green, icon: 'arrow-right' },
  light: { color: C.gold, icon: 'lamp' },
  bridge: { color: C.gold }
};

function guideCardLayout(r, guide) {
  if (guide.interactive) {
    const bodyLines = r.wrapLines(guide.text, 232, 13);
    return { titleLines: [guide.title], bodyLines, tipLines: [],
      height: 44 + bodyLines.length * 17, compact: true };
  }
  const titleLines = r.wrapLines(guide.title, 186, 16, '600');
  const bodyLines = r.wrapLines(guide.text, 306, 14);
  const tipLines = guide.visual && guide.visual.echo ? [] : r.wrapLines(guide.tip, 282, 12);
  const titleExtra = Math.max(0, titleLines.length - 1) * 21;
  const contentExtra = titleExtra + Math.max(0, bodyLines.length - 2) * 21;
  const footerHeight = 24 + Math.max(0, tipLines.length - 1) * 16;
  return { titleLines, bodyLines, tipLines, titleExtra, contentExtra,
    bodyY: 73 + titleExtra, footerY: 108 + contentExtra, footerHeight,
    height: GUIDE_HEIGHT + contentExtra + footerHeight - 24 };
}

function drawGuideCard(r, game, guide, y) {
  const total = guide.total || 4, ui = guideCardLayout(r, guide);
  if (ui.compact) {
    r.panel(24, y, 342, ui.height, { fill: C.panel, stroke: C.line, radius: 16, flat: true });
    r.label(guide.title, 38, y + 20, 232, 14, C.ink, 'left', '700');
    ui.bodyLines.forEach((line, index) => r.text(line, 38, y + 41 + index * 17, 13, C.muted));
    r.button('跳过', 284, y + 12, 64, CONTROL.compactHeight, () => game.dismissGuide(),
      { style: 'text', size: 12, disabled: !!game.modal || game.busy });
    return;
  }
  r.panel(24, y, 342, ui.height, { fill: C.panel, stroke: C.line, radius: 18, flat: true });
  r.round(42, y + 18, 34, 28, 10, C.soft);
  r.text(guide.step + '/' + total, 59, y + 32, 12, C.green, 'center', '700');
  ui.titleLines.forEach((line, index) => r.text(line, 86, y + 30 + index * 21, 16, C.ink, 'left', '600'));
  // Progress belongs with the step heading, leaving the rule its own quiet row.
  const segment = 96 / total;
  for (let index = 0; index < total; index++) {
    r.round(86 + index * segment, y + 48 + ui.titleExtra, segment - 5, 3, 1.5,
      index < guide.step ? C.green : C.soft);
  }
  // The full 44px hit target sits inside the card, clear of both title and body.
  r.button('跳过', 284, y + 14, 64, CONTROL.compactHeight, () => game.dismissGuide(), {
    style: 'text', disabled: !!game.modal || game.busy
  });
  ui.bodyLines.forEach((line, index) => r.text(line, 42, y + ui.bodyY + index * 21, 14, C.ink));
  const footerY = y + ui.footerY;
  const echo = guide.visual && guide.visual.echo;
  if (echo) r.round(42, footerY, 306, ui.footerHeight, 8, C.bluePale);
  else r.line([[42, footerY - 2], [348, footerY - 2]], C.line, 1);
  if (echo) {
    r.icon('echo', 56, footerY + 12, 14, C.blue);
    r.text('再行动 ' + echo.turns + ' 次，回声收票', 70, footerY + 12, 12, C.blueText);
    for (let index = 0; index < 3; index++) {
      const turns = 3 - index, done = echo.turns < turns;
      r.circle(292 + index * 21, footerY + 12, 7, done ? C.blueText : C.panel, echo.turns === turns ? C.blueText : C.line);
      if (done) r.icon('check', 292 + index * 21, footerY + 12, 9, C.white);
      else r.text(turns, 292 + index * 21, footerY + 12, 11, echo.turns === turns ? C.blueText : C.muted, 'center', echo.turns === turns ? '600' : '400');
    }
  } else ui.tipLines.forEach((line, index) => r.text(line, 54, footerY + 12 + index * 16, 12,
    game.state.energy <= 3 ? C.dangerText : C.muted));
}

// Painted in the board's existing projection; markers never add click targets.
function drawGuideTargets(r, guide, projection, now) {
  const target = guide && guide.visual && guide.visual.focus;
  if (!target || !projection.visible(target.cell)) return;
  const p = projection, c = r.ctx;
  c.save();
  c.globalAlpha *= r.reducedMotion ? .9 : .78 + Math.sin(now / 300) * .16;
  const [x, y] = p.point(target.cell), marker = MARKERS[target.kind];
  const offsets = [[0, -p.halfH * .85], [p.halfW * .85, 0], [0, p.halfH * .85], [-p.halfW * .85, 0], [0, -p.halfH * .85]];
  const outline = offsets.map(offset => { const [dx, dy] = p.floor(...offset); return [x + dx, y + dy]; });
  r.line(outline, C.white, 5);
  r.line(outline, marker.color, 2.8);
  if (marker.icon) {
    const [dx, dy] = p.floor(p.halfW * .55, 0);
    r.circle(x + dx, y + dy, 9, C.white, marker.color);
    r.icon(marker.icon, x + dx, y + dy, 12, marker.color);
  }
  c.restore();
}

module.exports = { GUIDE_HEIGHT, guideCardLayout, drawGuideCard, drawGuideTargets };
