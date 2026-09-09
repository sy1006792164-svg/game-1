'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');

const GUIDE_HEIGHT = 152;
const MARKERS = {
  move: { color: C.gold },
  letter: { color: C.gold, icon: 'letter' },
  echo: { color: C.blue, icon: 'echo' },
  home: { color: C.green, icon: 'home' }
};

function guideCardLayout(r, guide) {
  const titleLines = r.wrapLines(guide.title, 180, 15, '600');
  const bodyLines = r.wrapLines(guide.text, 310, 12);
  const titleExtra = Math.max(0, titleLines.length - 1) * 19;
  const contentExtra = titleExtra + Math.max(0, bodyLines.length - 2) * 18;
  return { titleLines, bodyLines, titleExtra, contentExtra, height: GUIDE_HEIGHT + contentExtra };
}

function drawGuideCard(r, game, guide, y) {
  const total = guide.total || 4, ui = guideCardLayout(r, guide);
  r.panel(24, y, 342, ui.height, { fill: '#fffaf0', stroke: '#c9d2b9', radius: 16 });
  r.round(25, y + 19, 3, ui.height - 38, 1.5, '#d1a56e');
  r.round(40, y + 18, 34, 28, 9, '#e5eddd', '#b9cdb1');
  r.text(guide.step + '/' + total, 57, y + 32, 11, '#316c5f', 'center', '600');
  ui.titleLines.forEach((line, index) => r.text(line, 86, y + 32 + index * 19, 15, C.ink, 'left', '600'));
  r.button('跳过', 278, y + 10, 72, CONTROL.compactHeight, () => game.dismissGuide(), {
    style: 'quiet', disabled: !!game.modal || game.busy
  });
  ui.bodyLines.forEach((line, index) => r.text(line, 40, y + 70 + ui.titleExtra + index * 18, 12, C.ink));
  const footerY = y + ui.contentExtra;
  r.line([[40, footerY + 101], [350, footerY + 101]], '#e5e6d6', 1);
  const echo = guide.visual && guide.visual.echo;
  if (echo) {
    r.label(guide.tip, 40, footerY + 110, 310, 10, C.muted);
    r.icon('echo', 49, footerY + 128, 17, C.blue);
    r.text('再行动 ' + echo.turns + ' 次，回声自动收票', 66, footerY + 128, 11, '#2b737b');
    for (let index = 0; index < 3; index++) {
      const turns = 3 - index, done = echo.turns < turns;
      r.circle(296 + index * 22, footerY + 128, 8, done ? C.blue : '#e1eeea', echo.turns === turns ? C.blue : '#b4cfca');
      if (done) r.icon('check', 296 + index * 22, footerY + 128, 9, C.white);
      else r.text(turns, 296 + index * 22, footerY + 128, 10, echo.turns === turns ? '#2b737b' : C.muted, 'center', echo.turns === turns ? '600' : '400');
    }
  } else r.label(guide.tip, 40, footerY + 121, 310, 11, game.state.energy <= 3 ? '#925e37' : C.muted);
  const segment = 310 / total;
  for (let index = 0; index < total; index++) {
    r.round(40 + index * segment, footerY + 145, segment - 5, 3, 1.5, index < guide.step ? C.green : '#e0e5d8');
  }
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
