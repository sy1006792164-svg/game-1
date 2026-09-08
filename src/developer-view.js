'use strict';

const { C } = require('./theme');
const { CAMPAIGN } = require('./levels');

function developmentLevelNumber(value) {
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return null;
  const id = Number(value);
  return id >= 1 && id <= CAMPAIGN.length ? id : null;
}

function drawDeveloperPicker(r, game) {
  const modal = game.modal, x = 36, w = 318, h = 472, y = Math.max(24, (r.H - h) / 2);
  r.round(0, 0, 390, r.H, 0, '#071e26dc');
  r.panel(x, y, w, h, { fill: C.panel, stroke: '#67765d', accent: C.gold, radius: 22 });
  r.text('开发选关', x + 24, y + 34, 23, C.ink, 'left', '600');
  r.text('输入 1–' + CAMPAIGN.length + ' 关，直接开始试玩', x + 24, y + 61, 12, C.muted);
  r.round(x + 22, y + 82, w - 44, 56, 12, C.dark, C.line);
  r.text(modal.digits || '关卡编号', 195, y + 110, modal.digits ? 28 : 17, modal.digits ? C.gold : C.muted, 'center', '600');
  r.text(modal.error || '开发存档与正式存档独立', 195, y + 155, 11, modal.error ? C.gold : C.muted, 'center');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '退格'].forEach((key, index) => {
    r.button(key, x + 22 + index % 3 * 94, y + 176 + Math.floor(index / 3) * 52, 86, 44,
      () => game.developmentKey(key === '清空' ? 'Delete' : key === '退格' ? 'Backspace' : key), 'secondary');
  });
  r.button('开始试玩', x + 22, y + 398, 174, 48, () => game.developmentKey('Enter'),
    { style: 'primary', disabled: developmentLevelNumber(modal.digits) === null });
  r.button('取消', x + 206, y + 398, 90, 48, () => game.developmentKey('Escape'), 'quiet');
  return { x, y, w, h };
}

module.exports = { developmentLevelNumber, drawDeveloperPicker };
