'use strict';

const { C } = require('./theme');

const GUIDE_HEIGHT = 136;
const MARKERS = {
  move: { color: C.gold },
  letter: { color: C.gold, icon: 'letter' },
  echo: { color: C.blue, icon: 'echo' },
  home: { color: C.green, icon: 'home' }
};

function drawGuideCard(r, game, guide, y) {
  r.panel(24, y, 342, GUIDE_HEIGHT, { fill: '#183a3c', stroke: '#698b7a', radius: 12 });
  r.text('引导 ' + guide.step + '/3', 40, y + 23, 11, C.gold);
  r.label(guide.title, 109, y + 23, 178, 13, C.ink, 'left', '600');
  r.button('跳过', 290, y + 1, 68, 44, () => game.dismissGuide(), {
    style: 'quiet', disabled: !!game.modal || game.busy
  });
  r.wrapped(guide.text, 40, y + 54, 310, 12, C.ink, 18);
  const echo = guide.visual && guide.visual.echo;
  const blocked = game.blockedAt != null && r.now - game.blockedAt < 1400;
  if (echo && game.state.energy > 3 && !blocked) {
    r.icon('echo', 50, y + 109, 19, C.blue);
    r.line([[76, y + 109], [140, y + 109]], C.blue, 1.4);
    for (let index = 0; index < 3; index++) {
      const done = index < 3 - echo.turns;
      r.circle(80 + index * 28, y + 109, 7, done ? C.blue : C.dark, C.blue);
      if (done) r.icon('check', 80 + index * 28, y + 109, 9, C.dark);
    }
    r.text('再行动 ' + echo.turns + ' 拍，回声收票', 163, y + 109, 11, C.blue);
  } else r.label(guide.tip, 40, y + 109, 310, 11, game.state.energy <= 3 ? C.gold : C.muted);
  for (let index = 0; index < 3; index++) {
    r.round(40 + index * 105, y + 125, 100, 3, 1.5, index < guide.step ? C.gold : C.line);
  }
}

// Painted in the board's existing projection; markers never add click targets.
function drawGuideTargets(r, guide, projection, now) {
  if (!guide) return;
  const p = projection, c = r.ctx;
  c.save();
  c.globalAlpha *= r.reducedMotion ? .9 : .78 + Math.sin(now / 300) * .16;
  for (const target of guide.targets) {
    if (!p.visible(target.cell)) continue;
    const [x, y] = p.point(target.cell), marker = MARKERS[target.kind];
    const offsets = [[0, -p.halfH * .85], [p.halfW * .85, 0], [0, p.halfH * .85], [-p.halfW * .85, 0], [0, -p.halfH * .85]];
    const outline = offsets.map(offset => { const [dx, dy] = p.floor(...offset); return [x + dx, y + dy]; });
    r.line(outline, C.dark, 5);
    r.line(outline, marker.color, 2.8);
    if (marker.icon) {
      const [dx, dy] = p.floor(p.halfW * .55, 0);
      r.circle(x + dx, y + dy, 9, C.dark, marker.color);
      r.icon(marker.icon, x + dx, y + dy, 12, marker.color);
    }
  }
  c.restore();
}

module.exports = { GUIDE_HEIGHT, drawGuideCard, drawGuideTargets };
