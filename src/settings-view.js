'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { togglePosition } = require('./ui-motion');

const ROWS = Object.freeze([
  Object.freeze({ key: 'sound', title: '操作音效', detail: '移动、收集与结果提示音' }),
  Object.freeze({ key: 'music', title: '背景音乐', detail: '邮路中的环境音乐' }),
  Object.freeze({ key: 'haptics', title: '硬件振动', detail: '收集与送达时轻振' }),
  Object.freeze({ key: 'reducedMotion', title: '减少动态效果', detail: '关闭位移过渡与装饰动画' }),
]);

function settingStatus(game, row, enabled, supported) {
  if (!supported) return '当前平台不支持硬件振动';
  if (row.key === 'reducedMotion' && !enabled && game.platform.reducedMotion) return '手动关闭 · 系统仍保持开启';
  return (enabled ? '已开启 · ' : '已关闭 · ') + row.detail;
}

function settingLayout(r, game, row, settings) {
  const enabled = settings[row.key];
  const supported = row.key !== 'haptics' || game.platform.kind === 'wechat';
  const lines = r.wrapLines(settingStatus(game, row, enabled, supported), 232, 12);
  return { row, enabled, supported, lines, height: Math.max(68 + (lines.length - 1) * 18, 44 / (r.scale || 1)) };
}

function drawToggle(r, game, entry, y) {
  const { row, enabled, supported, lines, height } = entry;
  r.text(row.title, 42, y + 21, 16, C.ink, 'left', '600');
  lines.forEach((line, index) => r.text(line, 42, y + 45 + index * 18, 12, C.muted));
  r.ctx.save();
  if (!supported) r.ctx.globalAlpha *= .45;
  const active = supported && enabled, change = game.settingChange;
  const position = togglePosition(change, row.key, active, r.now, r.reducedMotion || r.effectsQuality === 'low');
  const knobX = 312 + position * 20;
  r.round(296, y + 19, 52, 30, 15, active ? C.green : C.line);
  r.circle(knobX, y + 34, 11, C.white);
  r.ctx.restore();
  if (supported) r.hit(24, y, 342, height, () => game.toggle(row.key), undefined,
    row.title + (enabled ? '，已开启，点击关闭' : '，已关闭，点击开启'));
}

function drawSettingGroup(r, game, title, rows, settings, y) {
  const entries = rows.map(row => settingLayout(r, game, row, settings));
  const height = entries.reduce((total, entry) => total + entry.height, 0);
  r.text(title, 42, y + 10, 13, C.muted, 'left', '600');
  let rowY = y + 28;
  r.panel(24, rowY, 342, height, { radius: 18, fill: C.panel, flat: true });
  entries.forEach((entry, index) => {
    if (index) r.round(42, rowY, 306, .7, 0, C.line);
    drawToggle(r, game, entry, rowY);
    rowY += entry.height;
  });
  return rowY;
}

function storageMessage(game) {
  if (game.store.getStatus().persisted) {
    return '通关记录、邮票、引导状态、当前路线和体验设置保存在这台设备。清理缓存或更换设备后无法同步找回。';
  }
  return '当前存储状态异常。原存档会尽量保留，新变化可能仅在本次运行有效；恢复后游戏会自动重试保存。';
}

function drawSettings(r, game) {
  r.header('体验设置', '声音、反馈与动态效果', () => game.home());
  const settings = game.profile().settings;
  let y = drawSettingGroup(r, game, '声音', ROWS.slice(0, 2), settings, 92);
  y = drawSettingGroup(r, game, '反馈与动态', ROWS.slice(2), settings, y + 16) + 22;

  const lines = r.wrapLines(storageMessage(game), 306, 13);
  const panelH = 42 + lines.length * 20;
  r.round(42, y, 306, 1, 0, C.line);
  r.text('本机数据', 42, y + 21, 15, C.ink, 'left', '600');
  lines.forEach((line, index) => r.text(line, 42, y + 46 + index * 20, 13,
    game.store.getStatus().persisted ? C.muted : C.dangerText));
  const actionHeight = Math.max(CONTROL.compactHeight, 44 / (r.scale || 1));
  r.button('清除这台设备的数据', 24, y + panelH + 10, 342, actionHeight,
    () => game.resetPrompt(), { style: 'text', size: 13, color: C.dangerText });
  r.text('清除后无法恢复', 195, y + panelH + actionHeight + 26, 12, C.muted, 'center');
}

module.exports = { drawSettings, ROWS };
