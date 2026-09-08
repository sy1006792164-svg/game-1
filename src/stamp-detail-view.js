'use strict';

const { C } = require('./theme');
const { drawStampArt } = require('./stamp-art');

const readerStates = new WeakMap();

function readerState(game, stamp) {
  let state = readerStates.get(game);
  if (!state || state.id !== stamp.id) {
    state = { id: stamp.id, view: 'letter', page: 0 };
    readerStates.set(game, state);
  }
  return state;
}

function drawHero(r, stamp, equipped) {
  r.panel(24, 90, 342, 174, { fill: '#1e3b3d', stroke: stamp.mastered ? '#98794b' : C.line, accent: C.gold });
  drawStampArt(r, stamp, { x: 40, y: 104, w: 120, h: 146 }, { equipped });
  r.text('沿途邮局 · 第 ' + String(stamp.index + 1).padStart(2, '0') + ' 枚', 178, 116, 10, C.muted);
  r.text(stamp.mastered ? '金色珍藏' : stamp.owned ? '来信已抵达' : '来信还在途中', 178, 143, 18,
    stamp.mastered ? C.gold : C.ink, 'left', '600');
  r.label(stamp.condition, 178, 169, 168, 11, C.muted);
  const target = stamp.target === 'daily' ? 1 : stamp.target;
  r.meter(178, 186, 167, stamp.current, target, stamp.owned ? C.green : C.gold);
  r.text(stamp.owned ? '已收藏 · 可以佩戴' : stamp.current + ' / ' + target + (stamp.target === 'daily' ? ' 次' : ' 星'),
    178, 207, 11, stamp.owned ? C.green : C.gold);
  r.text(stamp.mastered ? '回信已抵达，感谢你的送达' : '三星完成委托，解锁回信', 178, 235, 10, C.muted);
}

function drawTab(r, state, key, label, x, y, locked) {
  const active = state.view === key;
  r.text(label, x, y, 12, active ? C.gold : C.muted, 'left', active ? '600' : '400');
  if (locked) r.icon('lock', x + 38, y, 11, C.muted);
  if (active) r.line([[x, y + 15], [x + 27, y + 15]], C.gold, 2);
  r.hit(x - 8, y - 20, 80, 40, () => { state.view = key; state.page = 0; });
}

function drawLetter(r, game, stamp, y, height) {
  const state = readerState(game, stamp);
  r.panel(24, y, 342, height, { fill: '#19383b', stroke: '#49635a', radius: 12 });
  if (!stamp.owned) {
    r.icon('letter', 64, y + height / 2, 36, C.gold);
    r.text('先收藏，再拆开这封信', 101, y + height / 2 - 15, 13, C.ink, 'left', '600');
    r.wrapped('解锁后，你会认识这枚邮票背后的寄信人。', 101, y + height / 2 + 10, 242, 11, C.muted, 18);
    return;
  }
  drawTab(r, state, 'letter', '来信', 42, y + 23, false);
  drawTab(r, state, 'reply', '回信', 123, y + 23, !stamp.mastered);
  r.label('来自 · ' + stamp.sender, 347, y + 23, 149, 10, C.muted, 'right');
  if (state.view === 'reply' && !stamp.mastered) {
    r.icon('lock', 62, y + 83, 24, C.gold);
    r.text('寄信人正在等你的好消息', 87, y + 72, 12, C.ink, 'left', '600');
    r.wrapped('将下方委托送到三星，即可收到回信，邮票也会变为金色珍藏。', 87, y + 95, 255, 11, C.muted, 18);
    return;
  }

  const lines = r.wrapLines(state.view === 'reply' ? stamp.reply : stamp.letter, 306, 13);
  const lineHeight = 23;
  const allRows = Math.max(1, Math.floor((height - 64) / lineHeight));
  const paged = lines.length > allRows;
  const rows = paged ? Math.max(1, Math.floor((height - 101) / lineHeight)) : allRows;
  const pages = Math.ceil(lines.length / rows);
  state.page = Math.min(state.page, pages - 1);
  lines.slice(state.page * rows, (state.page + 1) * rows).forEach((line, index) => {
    r.text(line, 42, y + 60 + index * lineHeight, 13, C.ink);
  });
  if (paged) {
    const pagerY = y + height - 39;
    r.button('上一页', 33, pagerY, 78, 34, () => { state.page -= 1; }, { style: 'quiet', disabled: state.page === 0 });
    r.text((state.page + 1) + ' / ' + pages, 195, pagerY + 17, 10, C.muted, 'center');
    r.button('下一页', 279, pagerY, 78, 34, () => { state.page += 1; }, { style: 'quiet', disabled: state.page + 1 === pages });
  }
}

function drawMission(r, stamp, y) {
  r.panel(24, y, 342, 88, { fill: '#253f3b', stroke: stamp.mastered ? '#927649' : '#4d675a', radius: 12 });
  r.text(stamp.mastered ? '三星委托已完成' : stamp.owned ? '寄信人的三星委托' : '收藏后开启的三星委托', 41, y + 20,
    12, stamp.mastered ? C.gold : C.ink, 'left', '600');
  for (let index = 0; index < stamp.missionTarget; index++) {
    r.icon('star', 309 + index * 17, y + 20, 13, index < stamp.missionCurrent ? C.gold : '#587268');
  }
  r.label(stamp.missionLabel, 41, y + 44, 305, 11, C.muted);
  const timing = stamp.missionPar === null ? '按当日三星目标送达' : stamp.missionPar + ' 拍内送达';
  r.text('最高 ' + stamp.missionCurrent + '/3 星 · ' + timing, 41, y + 68, 11, stamp.mastered ? C.gold : C.muted);
}

function drawStampDetail(r, game, stamp, equipped) {
  const wearing = !!equipped && equipped.id === stamp.id;
  r.header(stamp.name, '返回邮票册 · 每一次送达，都有回响', () => game.closeStamp());
  drawHero(r, stamp, wearing);
  const missionY = r.H - 188, actionY = r.H - 86;
  drawLetter(r, game, stamp, 276, missionY - 288);
  drawMission(r, stamp, missionY);
  if (stamp.owned) {
    r.button(wearing ? '取消佩戴' : '佩戴邮票', 24, actionY, 136, 46, () => game.equipStamp(wearing ? null : stamp.id));
    r.button(stamp.mastered ? '重访这封信' : '前往三星委托', 172, actionY, 194, 46,
      () => game.stampMission(stamp.id), 'primary');
  } else {
    r.button(stamp.target === 'daily' ? '去完成每日风笺' : '去收集星星', 24, actionY, 342, 46,
      () => game.stampMission(stamp.id), 'primary');
  }
}

module.exports = { drawStampDetail };
