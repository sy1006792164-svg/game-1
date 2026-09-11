'use strict';

// Friend identities and all conditional controls remain inside the open-data domain.
const C = { ink: '#294d49', muted: '#4d6359', green: '#316c5f', gold: '#a36c35', goldText: '#885729', paper: '#fffdf4', line: '#cedbcf' };

function leaderboardLayout(width, height) {
  const compact = height < 420, heroH = compact ? 96 : 126;
  const listTop = heroH + 52, stride = compact ? 64 : 76;
  const listBottom = Math.max(listTop, height - 28), listHeight = listBottom - listTop;
  return { heroH, listTop, stride, rowHeight: stride - 8, listHeight, listBottom,
    capacity: Math.max(1, Math.ceil(listHeight / stride)), compact };
}

function paintLeaderboard(ctx, model, avatar) {
  const { width: w, height: h, rows = [], self, status, refreshing, updatedAt, sync = {}, notice = '' } = model;
  const ui = leaderboardLayout(w, h), hits = [];
  const contentHeight = Math.max(0, rows.length * ui.stride - 8);
  const maxScroll = Math.max(0, contentHeight - ui.listHeight);
  // Keep the controller's small edge rebound visible, inside the list clip.
  const scroll = Math.max(-64, Math.min(maxScroll + 64, Number.isFinite(model.scrollOffset) ? model.scrollOffset : 0));
  const listWidth = w - (maxScroll > 0 ? 10 : 0);
  const motion = model.rankMotion;
  const change = model.rankChange || motion;
  const hasChange = change && Number.isFinite(change.fromRank) && Number.isFinite(change.toRank) && change.fromRank !== change.toRank;
  const progress = motion ? Math.max(0, Math.min(1, Number.isFinite(motion.progress) ? motion.progress : 1)) : 1;
  const moving = motion && motion.active;
  const font = (size, weight) => { ctx.font = (weight || '400') + ' ' + size + 'px sans-serif'; };
  const text = (value, x, y, size = 13, color = C.ink, align = 'left', weight) => {
    font(size, weight); ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(String(value), x, y);
  };
  const fitted = (value, maxWidth, size) => {
    font(size); const chars = Array.from(String(value));
    if (ctx.measureText(chars.join('')).width <= maxWidth) return chars.join('');
    while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
    return chars.join('') + '…';
  };
  const round = (x, y, width, height, radius, fill, stroke, strokeWidth = 1) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = strokeWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
  };
  const line = (points, color, width = 1) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  };
  // Match the main canvas's upper-left light without crossing domain boundaries.
  const edges = (x, y, width, height, radius, dark = false) => {
    const inset = 1.5, r = Math.max(0, Math.min(radius, width / 2, height / 2) - inset);
    const left = x + inset, right = x + width - inset, top = y + inset, bottom = y + height - inset;
    ctx.save(); ctx.lineWidth = .9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(left, bottom - r); ctx.lineTo(left, top + r);
    ctx.arcTo(left, top, left + r, top, r); ctx.lineTo(right - r, top);
    ctx.strokeStyle = dark ? '#c6dec18a' : '#fffef1dc'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(right, top + r); ctx.lineTo(right, bottom - r);
    ctx.arcTo(right, bottom, right - r, bottom, r); ctx.lineTo(left + r, bottom);
    ctx.strokeStyle = dark ? '#183e3966' : '#718a7163'; ctx.stroke(); ctx.restore();
  };
  const circle = (x, y, radius, fill) => { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  const star = (x, y, size, color) => {
    ctx.beginPath(); for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = size * (i % 2 ? .43 : 1);
      i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  };
  const button = (label, x, y, width, height, action, disabled = false) => {
    round(x, y, width, height, 10, disabled ? '#e4ebe2' : C.paper, disabled ? '#d8e2d6' : C.line);
    text(label, x + width / 2, y + height / 2, 12, disabled ? '#869b8e' : C.green, 'center', '600');
    if (!disabled) hits.push({ x, y: y - 4, w: width, h: height + 8, action });
  };

  // A personal scorecard anchors the page even when only one friend is present.
  round(1, 3, w - 2, ui.heroH, 19, '#476d5920');
  round(0, 0, w, ui.heroH, 19, C.green);
  edges(0, 0, w, ui.heroH, 19, true);
  round(8, 8, w - 16, ui.heroH - 16, 13, null, '#83aa934d');
  circle(w - 14, 15, 33, '#ffffff08'); star(w - 23, 19, 15, '#c0d8b222');
  const portrait = ui.compact ? 30 : 38;
  const myIndex = rows.findIndex(row => row.isMe);
  avatar(self && self.avatarUrl, 17, 15, portrait);
  text(fitted(self && self.nickname || '我的邮路', w - (hasChange ? 135 : 22) - (17 + portrait + 12), 15), 17 + portrait + 12, 27, 15, C.paper, 'left', '600');
  const personal = self ? self.rank ? '我的名次  ' + self.rank : '我的最佳成绩' : '完成一关，留下你的成绩';
  text(personal, 17 + portrait + 12, 47, 10, '#e2ecdc');
  if (hasChange) {
    const up = change.direction === 'up', delta = Math.abs(change.toRank - change.fromRank);
    round(w - 129, 13, 116, 42, 11, up ? '#f7e5af24' : '#e3ece124', up ? '#e1ca8e55' : '#b5cbb555');
    text((up ? '↑ 上升 ' : '↓ 下降 ') + delta + ' 名', w - 71, 26, 12, up ? '#ffe2a6' : '#ecf1e3', 'center', '600');
    // Animate the real destination digit, never an invented intermediate rank.
    if (moving) {
      const appear = 1 - Math.pow(1 - progress, 3);
      text(change.fromRank + ' →', w - 70, 43, 10, '#e2ecdc', 'right');
      ctx.save(); ctx.globalAlpha = .45 + .55 * appear;
      text(change.toRank, w - 64, 43 + (up ? 1 : -1) * (1 - appear) * 7, 10, '#e2ecdc');
      ctx.restore();
    } else text(change.fromRank + ' → ' + change.toRank, w - 71, 43, 10, '#e2ecdc', 'center');
  }
  const numbersY = ui.compact ? 68 : 85, labelsY = ui.compact ? 85 : 108;
  const values = [self ? self.stars : '—', self ? self.completed : '—', self ? self.turns : '—'];
  ['总星数', '已通关', '最佳总步数'].forEach((label, i) => {
    const x = (i + .5) * w / 3;
    if (i) line([[i * w / 3, numbersY - 9], [i * w / 3, labelsY + 1]], '#a4c5ac33');
    text(values[i], x, numbersY, i === 0 ? 24 : 20, i === 0 ? '#ffe2a6' : C.paper, 'center', '600');
    text(label, x, labelsY, 10, '#dce9d8', 'center');
  });

  text('好友成绩', 4, ui.heroH + 28, 14, C.ink, 'left', '600');
  if (rows.length) text(rows.length + ' 人', 75, ui.heroH + 28, 11, C.muted);
  const busy = status === 'loading' || refreshing;
  if ((status === 'error' || sync.status === 'error' || /未成功|未能|未读取/.test(notice)) && !busy) button('重试', w - 73, ui.heroH + 10, 71, 32, 'retry');
  else if (busy) text('更新中…', w - 4, ui.heroH + 28, 11, C.muted, 'right');
  else if (maxScroll > 0) text('上下滑动', w - 4, ui.heroH + 28, 10, C.muted, 'right');

  ctx.save(); ctx.beginPath(); ctx.rect(0, ui.listTop, w, ui.listHeight); ctx.clip();
  if (rows.length) {
    const first = Math.max(0, Math.floor(scroll / ui.stride));
    const end = Math.min(rows.length, Math.ceil((scroll + ui.listHeight) / ui.stride));
    const drawRow = (row, y) => {
      const rh = ui.rowHeight;
      const landingProgress = moving && Number.isFinite(motion.landing) ? motion.landing : Math.max(0, (progress - .75) / .25);
      const landing = row.isMe && moving ? Math.sin(Math.PI * Math.max(0, Math.min(1, landingProgress))) : 0;
      ctx.save();
      if (landing) {
        ctx.translate(listWidth / 2, y + rh / 2);
        ctx.scale(1 - .016 * landing, 1 - .026 * landing);
        ctx.translate(-listWidth / 2, -y - rh / 2);
      }
      round(1, y + 2, listWidth - 2, rh, 13, '#5c805714');
      round(0, y, listWidth, rh, 13, row.isMe ? moving ? '#eaf1d9' : '#f2f4e2' : C.paper,
        row.isMe ? moving ? '#77965d' : '#9fba9b' : '#d6dfcf', row.isMe && moving ? 2 : 1);
      edges(0, y, listWidth, rh, 13);
      if (row.isMe) round(0, y + 13, 3, rh - 26, 1.5, C.green);
      if (row.rank <= 3) {
        const cy = y + rh / 2, colors = [
          ['#c69a45', '#f4dc96', '#78521f'], ['#a0b3b1', '#e0e8e4', '#536c69'], ['#bb8b65', '#e8c7a4', '#70482d'],
        ][row.rank - 1];
        [-1, 1].forEach(side => {
          ctx.beginPath();
          [[2, 3], [8, 2], [10, 15], [5, 12], [1, 15]].forEach(([dx, dy], i) =>
            i ? ctx.lineTo(22 + dx * side, cy + dy) : ctx.moveTo(22 + dx * side, cy + dy));
          ctx.closePath(); ctx.fillStyle = colors[0]; ctx.fill();
        });
        circle(22, cy - 3, 11, colors[0]); circle(22, cy - 3, 9, colors[1]);
        ctx.beginPath(); ctx.arc(22, cy - 3, 7.5, 3.6, 5.2); ctx.strokeStyle = C.paper; ctx.lineWidth = 1; ctx.stroke();
        text(row.rank, 22, cy - 2, 11, colors[2], 'center', '600');
      } else text(fitted(row.rank, 30, 12), 22, y + rh / 2, 12, C.muted, 'center');
      const size = ui.compact ? 32 : 38;
      avatar(row.avatarUrl, 44, y + (rh - size) / 2, size);
      const nameX = ui.compact ? 87 : 94;
      text(fitted((row.isMe ? '我 · ' : '') + row.nickname, listWidth - nameX - 79, 13), nameX, y + rh / 2 - 11, 13, C.ink, 'left', '600');
      text(fitted(row.completed + ' 关 · ' + row.turns + ' 步', listWidth - nameX - 15, 10), nameX, y + rh / 2 + 12, 10, C.muted);
      star(listWidth - 17, y + rh / 2 - 10, 6, C.gold);
      text(row.stars, listWidth - 28, y + rh / 2 - 10, 18, C.gold, 'right', '600');
      ctx.restore();
    };
    const floatingSelf = moving && myIndex >= 0 && Number.isFinite(motion.rowY);
    for (let index = first; index < end; index++) {
      if (floatingSelf && rows[index].isMe) continue;
      drawRow(rows[index], ui.listTop + index * ui.stride - scroll);
    }
    // Move only the genuine self card; all other rows keep the received order.
    if (floatingSelf) drawRow(rows[myIndex], motion.rowY);
    // The hint belongs to the scrolling content, including elastic overscroll.
    // Keep visibility independent of the gesture so it cannot flicker in and out.
    const showHint = !maxScroll && rows.length <= 2 && ui.listHeight - contentHeight >= 83;
    if (showHint) {
      const contentEnd = Math.max(ui.listTop + contentHeight - scroll,
        floatingSelf ? motion.rowY + ui.rowHeight : -Infinity);
      round(0, contentEnd + 14, w, 68, 13, '#e0e9dc');
      star(27, contentEnd + 37, 9, '#8da985');
      text('每一封送达，都让星光更近', 48, contentEnd + 35, 12, C.green, 'left', '600');
      text('同玩好友同步成绩后，也会出现在这里', 48, contentEnd + 56, 10, C.muted);
    }
  } else if (status === 'loading') {
    for (let i = 0; i < Math.min(2, ui.capacity); i++) {
      const y = ui.listTop + i * ui.stride;
      round(0, y, w, ui.rowHeight, 13, '#f8faf0', C.line);
      circle(31, y + ui.rowHeight / 2, 15, '#dfe9dc');
      round(60, y + 18, w * .38, 7, 3, '#d9e4d6');
      round(60, y + 33, w * .24, 6, 3, '#e3ebdf');
    }
  } else {
    const emptyH = Math.min(167, ui.listHeight);
    const center = ui.listTop + emptyH / 2;
    round(0, ui.listTop, w, emptyH, 16, '#f7f8ed', C.line);
    const error = status === 'error', denied = status === 'denied';
    const short = emptyH < 110;
    if (!short) {
      round(w / 2 - 17, center - 43, 34, 24, 4, '#e7d6b2');
      line([[w / 2 - 15, center - 40], [w / 2, center - 29], [w / 2 + 15, center - 40]], C.paper, 1.5);
    }
    text(denied ? '朋友信息权限未开启' : error ? '这次没能收到好友成绩' : '等待好友的第一封来信', w / 2, center - (short ? 13 : 1), 14, C.ink, 'center', '600');
    const hint = denied ? '返回后重新进入排行，可调整授权' : error ? '请检查网络后重试' : '同玩好友完成关卡并同步后，就能一起上榜';
    text(fitted(hint, w - 24, 11), w / 2, center + (short ? 11 : 25), 11, C.muted, 'center');
    if (!short && self && !self.rank) text('本人成绩单独展示', w / 2, center + 46, 10, C.muted, 'center');
  }
  ctx.restore();

  if (maxScroll > 0) {
    const trackHeight = ui.listHeight - 8;
    const thumbHeight = Math.min(trackHeight, Math.max(22, trackHeight * ui.listHeight / contentHeight));
    const thumbY = ui.listTop + 4 + Math.max(0, Math.min(1, scroll / maxScroll)) * (trackHeight - thumbHeight);
    round(w - 4, ui.listTop + 4, 3, trackHeight, 1.5, '#9ab39b24');
    round(w - 4, thumbY, 3, thumbHeight, 1.5, '#7c9e85aa');
  }
  const date = updatedAt ? new Date(updatedAt) : null;
  const time = date ? String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') : '';
  const footer = notice || (sync.status === 'error' ? sync.message : '') || (busy ? rows.length || self ? '正在更新，已有成绩仍可查看' : '正在读取好友成绩…' : time ? '更新于 ' + time : '成绩将在联网后更新');
  text(fitted(footer, w - 12, 10), w / 2, h - 9, 10, notice || sync.status === 'error' ? C.goldText : C.muted, 'center');
  return hits;
}

module.exports = { leaderboardLayout, paintLeaderboard };
