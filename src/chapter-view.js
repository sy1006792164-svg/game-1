'use strict';

const { C } = require('./theme');
const { insideRect } = require('./board-projection');
const { DIRECTORY_ROW, navigateLevelBrowser } = require('./level-navigation');
const { drawProgressGlint } = require('./page-feedback');

function drawChapterDirectory(r, game, chapters, viewport, current, saved) {
  const offset = game.levelScroll.offset;
  const first = Math.max(0, Math.floor(offset / DIRECTORY_ROW));
  const last = Math.min(chapters.length - 1, Math.floor((offset + viewport.h) / DIRECTORY_ROW));
  for (let index = first; index <= last; index++) {
    const chapter = chapters[index], x = 24, y = viewport.y + index * DIRECTORY_ROW - offset, w = 342, h = 84;
    const inProgress = saved && saved.levelId >= chapter.firstId && saved.levelId <= chapter.lastId;
    const next = index === current.chapter && chapter.completedCount < chapter.count, highlighted = inProgress || next;
    r.panel(x, y, w, h, { fill: highlighted ? '#fff7e5' : C.panel, stroke: highlighted ? '#cba477' : C.line, radius: 12 });
    r.text(String(index + 1).padStart(3, '0'), x + 16, y + 24, 15, highlighted ? C.goldText : C.green, 'left', '600');
    r.label(chapter.name, x + 60, y + 24, highlighted ? 174 : 214, 15, C.ink, 'left', '600');
    if (highlighted) r.text(inProgress ? '进行中' : '待送达', x + w - 24, y + 24, 10, C.goldText, 'right');
    r.actionIcon('chevron', x + w - 23, y + 49, highlighted ? C.gold : C.green);
    r.text('来信 ' + String(chapter.firstId).padStart(3, '0') + '–' + String(chapter.lastId).padStart(3, '0'), x + 16, y + 48, 10, C.muted);
    r.text('送达 ' + chapter.completedCount + '/' + chapter.count, x + 137, y + 48, 10, C.muted);
    r.icon('star', x + 215, y + 48, 11, C.gold);
    r.text(chapter.stars + '/' + chapter.maxStars, x + 226, y + 48, 10, C.goldText);
    r.meter(x + 16, y + 65, w - 61, chapter.stars, chapter.maxStars, chapter.stars === chapter.maxStars ? C.gold : C.green);
    if (!game.levelScroll.touching && Math.abs(game.levelScroll.velocity) < 4 && game.levelScroll.wheelTarget === null) {
      drawProgressGlint(r, x + 16, y + 65, w - 61, chapter.stars, chapter.maxStars, index * 419);
    }
    r.hit(x, y, w, h, () => navigateLevelBrowser(game, 'all', chapter.firstId),
      (px, py) => insideRect(viewport, px, py));
  }
}

module.exports = { drawChapterDirectory };
