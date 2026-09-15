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
    const chapter = chapters[index], x = 24, y = viewport.y + index * DIRECTORY_ROW - offset, w = 342, h = DIRECTORY_ROW - 12;
    const inProgress = saved && saved.levelId >= chapter.firstId && saved.levelId <= chapter.lastId;
    const next = index === current.chapter && chapter.completedCount < chapter.count, highlighted = inProgress || next;
    r.panel(x, y, w, h, { fill: highlighted ? '#fff7e5' : C.panel, stroke: highlighted ? '#cba477' : C.line,
      accent: highlighted ? C.gold : null, radius: 12, flat: !highlighted });
    r.text(String(index + 1).padStart(3, '0'), x + 16, y + 26, 12, highlighted ? C.goldText : C.muted, 'left', '600');
    r.label(chapter.name, x + 55, y + 26, highlighted ? 181 : 231, 17, C.ink, 'left', '600');
    if (highlighted) r.text(inProgress ? '进行中' : '待送达', x + w - 18, y + 26, 11, C.goldText, 'right', '600');
    r.actionIcon('chevron', x + w - 22, y + 61, highlighted ? C.gold : C.green);
    r.text('来信 ' + String(chapter.firstId).padStart(3, '0') + '–' + String(chapter.lastId).padStart(3, '0'), x + 16, y + 53, 11, C.muted);
    r.text('送达 ' + chapter.completedCount + '/' + chapter.count, x + 16, y + 76, 11, C.muted);
    r.icon('star', x + 240, y + 53, 11, C.gold);
    r.text(chapter.stars + '/' + chapter.maxStars, x + 251, y + 53, 11, C.goldText);
    r.meter(x + 93, y + 74, w - 145, chapter.stars, chapter.maxStars, chapter.stars === chapter.maxStars ? C.gold : C.green);
    if (!game.levelScroll.touching && Math.abs(game.levelScroll.velocity) < 4 && game.levelScroll.wheelTarget === null) {
      drawProgressGlint(r, x + 93, y + 74, w - 145, chapter.stars, chapter.maxStars, index * 419);
    }
    const action = () => navigateLevelBrowser(game, 'all', chapter.firstId);
    action.focusId = 'chapter:' + index;
    r.hit(x, y, w, h, action,
      (px, py) => insideRect(viewport, px, py));
  }
}

module.exports = { drawChapterDirectory };
