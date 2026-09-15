'use strict';

const { C } = require('./theme');
const { insideRect } = require('./board-projection');
const { DIRECTORY_ROW, navigateLevelBrowser } = require('./level-navigation');

function drawChapterDirectory(r, game, chapters, viewport, current, saved) {
  const offset = game.levelScroll.offset;
  const first = Math.max(0, Math.floor(offset / DIRECTORY_ROW));
  const last = Math.min(chapters.length - 1, Math.floor((offset + viewport.h) / DIRECTORY_ROW));
  for (let index = first; index <= last; index++) {
    const chapter = chapters[index], x = 24, y = viewport.y + index * DIRECTORY_ROW - offset, w = 342, h = DIRECTORY_ROW - 12;
    const inProgress = saved && saved.levelId >= chapter.firstId && saved.levelId <= chapter.lastId;
    const next = index === current.chapter && chapter.completedCount < chapter.count, highlighted = inProgress || next;
    if (highlighted) r.round(x, y, w, h, 16, C.peach);
    else r.line([[x + 16, y + h], [x + w - 16, y + h]], C.line, 1);
    r.text(String(index + 1).padStart(3, '0'), x + 16, y + 26, 13, highlighted ? C.goldText : C.muted, 'left', '600');
    r.label(chapter.name, x + 55, y + 26, highlighted ? 181 : 231, 17, C.ink, 'left', '600');
    if (highlighted) r.text(inProgress ? '进行中' : '待送达', x + w - 18, y + 26, 12, C.goldText, 'right', '600');
    r.text('来信 ' + String(chapter.firstId).padStart(3, '0') + '–' + String(chapter.lastId).padStart(3, '0'),
      x + 55, y + 53, 12, C.muted);
    r.text('送达 ' + chapter.completedCount + '/' + chapter.count, x + w - 44, y + 53, 12, C.muted, 'right');
    r.actionIcon('chevron', x + w - 22, y + 53, highlighted ? C.gold : C.green);
    r.meter(x + 55, y + 77, 180, chapter.stars, chapter.maxStars, chapter.stars === chapter.maxStars ? C.gold : C.green);
    r.icon('star', x + 258, y + 79, 11, C.gold);
    r.text(chapter.stars + '/' + chapter.maxStars, x + w - 18, y + 79, 11, C.goldText, 'right');
    const action = () => navigateLevelBrowser(game, 'all', chapter.firstId);
    action.focusId = 'chapter:' + index;
    r.hit(x, y, w, h, action,
      (px, py) => insideRect(viewport, px, py));
  }
}

module.exports = { drawChapterDirectory };
