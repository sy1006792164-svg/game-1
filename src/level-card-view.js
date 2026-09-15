'use strict';

const { C } = require('./theme');
const { PER_CHAPTER } = require('./levels');
const { insideRect } = require('./board-projection');
const { difficultyProfile } = require('./difficulty');

function drawLevelCard(r, game, level, record, index, rect, viewport, current, saved) {
  const scroll = game.levelScroll, now = Number.isFinite(r.pageNow) ? r.pageNow : r.now;
  if (!scroll.revealed.has(index)) {
    if (scroll.revealed.size >= 64) scroll.revealed.delete(scroll.revealed.keys().next().value);
    const entering = now - scroll.enteredAt < 200 && !scroll.touching && !scroll.dragged && scroll.wheelTarget === null;
    scroll.revealed.set(index, entering ? now + index % PER_CHAPTER * 26 : now - 320);
  }
  if (scroll.touching || scroll.dragged || scroll.wheelTarget !== null)
    scroll.revealed.set(index, Math.min(scroll.revealed.get(index), now - 320));
  const progress = Math.max(0, Math.min(1, (now - scroll.revealed.get(index)) / 320));
  const ease = r.reducedMotion || r.effectsQuality === 'low' ? 1 : 1 - Math.pow(1 - progress, 3);
  const { x, w, h } = rect, y = rect.y + (1 - ease) * 8;
  const unlocked = game.unlocked(index), inProgress = saved && saved.levelId === level.id;
  const highlighted = inProgress || level.id === current.id;
  const held = game.pointer && !game.pointer.dragging && insideRect(viewport, game.pointer.x, game.pointer.y) &&
    insideRect(rect, game.pointer.x, game.pointer.y);
  const c = r.ctx;
  c.save(); c.globalAlpha *= ease;
  r.round(x, y, w, h, 16, held && unlocked ? C.soft : highlighted ? C.peach : unlocked ? C.panel : C.paper,
    highlighted ? C.orange : C.line);
  r.text(String(level.id).padStart(3, '0'), x + 16, y + 23, 13, highlighted ? C.goldText : C.muted, 'left', '600');
  const difficulty = level.difficulty || difficultyProfile(level);
  r.label(inProgress ? '进行中' : level.experience ? level.experience.phaseName : difficulty.name,
    x + 54, y + 23, 76, 11, inProgress ? C.goldText : C.muted);
  r.actionIcon(unlocked ? record ? 'check' : 'letter' : 'lock', x + w - 21, y + 23, unlocked ? C.green : C.muted);
  r.label(level.title, x + 16, y + 53, w - 32, 17, unlocked ? C.ink : C.muted, 'left', '600');
  r.label('三星目标 · ' + level.par + ' 拍内', x + 16, y + 80, w - 32, 12, C.muted);
  r.line([[x + 16, y + h - 42], [x + w - 16, y + h - 42]], C.line, .8);
  if (record) {
    for (let star = 0; star < 3; star++) r.icon('star', x + 21 + star * 21, y + h - 22, 14,
      star < record.stars ? C.gold : C.line);
    r.text(record.bestTurns + ' 拍', x + w - 18, y + h - 22, 12, C.muted, 'right');
  } else {
    r.text(inProgress ? '继续投递' : unlocked ? '开始投递' : '先送达上一封', x + 16, y + h - 22, 12,
      highlighted ? C.goldText : unlocked ? C.green : C.muted, 'left', '600');
    if (unlocked) r.actionIcon('arrow-right', x + w - 21, y + h - 22, highlighted ? C.orange : C.green);
  }
  c.restore();
  const action = () => unlocked ? game.selectLevel(level.id) : game.toast('送达上一封信后开启');
  action.focusId = 'level:' + level.id;
  r.hit(x, y, w, h, action, (px, py) => insideRect(viewport, px, py),
    '第 ' + level.id + ' 封 ' + level.title + (record ? ' ' + record.stars + ' 星' : unlocked ? ' 开始投递' : ' 未开启'));
}

module.exports = { drawLevelCard };
