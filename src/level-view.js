'use strict';

const { CAMPAIGN, chapterNames, PER_CHAPTER } = require('./levels');
const { C } = require('./theme');

function drawLevels(r, game) {
  const profile = game.profile();
  r.header('选一封来信', '点选关卡，直接出发', () => game.home());
  r.text('主线旅程', 25, 109, 14, C.ink, 'left', '600');
  r.text('已送达 ' + game.completion() + ' / ' + CAMPAIGN.length, 25, 130, 10, C.muted);
  r.round(247, 88, 119, 44, 12, C.bluePale);
  r.icon('sun', 267, 110, 18, C.blue);
  r.text(profile.daily[game.dateKey] ? '今日已送达' : '每日一关', 318, 110, 11, C.blue, 'center');
  r.hit(247, 88, 119, 44, () => game.daily());

  r.text(chapterNames[game.chapter], 25, 156, 22, C.ink, 'left', '600');
  r.text((game.chapter + 1) + ' / ' + chapterNames.length + ' 章', 365, 157, 11, C.muted, 'right');
  const top = 187, gap = 12, rows = Math.ceil(PER_CHAPTER / 2);
  const footerH = 44, footerGap = 20, bottomInset = 80;
  const cardH = Math.min(144, (r.H - top - gap * (rows - 1) - footerGap - footerH - bottomInset) / rows);
  CAMPAIGN.slice(game.chapter * PER_CHAPTER, game.chapter * PER_CHAPTER + PER_CHAPTER).forEach((level, offset) => {
    const index = game.chapter * PER_CHAPTER + offset, x = 24 + offset % 2 * 178, y = top + Math.floor(offset / 2) * (cardH + gap);
    const record = profile.completed[String(level.id)];
    const unlocked = game.unlocked(index);
    r.panel(x, y, 164, cardH, { fill: unlocked ? C.panel : C.dark, radius: 16 });
    r.text(String(level.id).padStart(2, '0'), x + 17, y + 26, 22, unlocked ? C.green : '#6c8780', 'left', '600');
    r.icon(unlocked ? record ? 'check' : 'letter' : 'lock', x + 136, y + 25, 18, unlocked ? C.gold : '#6c8780');
    r.label(level.title, x + 17, y + 60, 132, 14, unlocked ? C.ink : C.muted, 'left', '500');
    if (record) {
      for (let star = 0; star < 3; star++) r.icon('star', x + 23 + star * 21, y + cardH - 24, 14, star < record.stars ? C.gold : C.line);
      r.text(record.bestTurns + ' 拍', x + 146, y + cardH - 24, 10, C.muted, 'right');
    } else r.text(unlocked ? '开始投递' : '先送达上一封', x + 17, y + cardH - 23, 11, unlocked ? C.green : C.muted);
    r.hit(x, y, 164, cardH, () => unlocked ? game.levelInfo(level, 'campaign') : game.toast('送达上一封信后开启'));
  });
  const bottom = top + cardH * rows + gap * (rows - 1) + footerGap;
  if (game.chapter > 0) r.button('上一章', 24, bottom, 154, footerH, () => { game.chapter--; }, 'quiet');
  if (game.chapter < chapterNames.length - 1) r.button('下一章', 212, bottom, 154, footerH, () => { game.chapter++; }, 'quiet');
}

module.exports = { drawLevels };
