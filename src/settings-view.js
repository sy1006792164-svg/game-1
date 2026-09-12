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

function drawToggle(r, game, row, y) {
  const enabled = game.profile().settings[row.key];
  const supported = row.key !== 'haptics' || game.platform.kind === 'wechat';
  r.panel(24, y, 342, 62, { fill: C.panel, stroke: C.line, radius: 13 });
  r.text(row.title, 42, y + 20, 14, C.ink, 'left', '600');
  r.text(settingStatus(game, row, enabled, supported), 42, y + 43, 11, C.muted);
  r.ctx.save();
  if (!supported) r.ctx.globalAlpha *= .45;
  const active = supported && enabled, change = game.settingChange;
  const age = change && change.key === row.key ? r.now - change.at : 240;
  const moving = supported && !r.reducedMotion && r.effectsQuality !== 'low' && age >= 0 && age < 240;
  const t = moving ? 1 - (1 - age / 240) ** 3 : 1;
  const position = togglePosition(change, row.key, active, r.now, r.reducedMotion || r.effectsQuality === 'low');
  const knobX = 312 + position * 18;
  r.round(296, y + 16, 50, 30, 15, active ? '#285b52' : '#b4c6b8', C.line);
  r.round(297, y + 17, 48, 27, 13.5, active ? C.green : C.soft);
  if (r.effectsQuality !== 'low') r.round(309, y + 18, 22, 1, .5, active ? '#a6c9ad88' : '#ffffffb3');
  r.circle(knobX, y + 31, 11, '#aabfaf', C.line);
  r.circle(knobX - .3, y + 30, 10, C.white);
  if (moving) {
    r.ctx.save(); r.ctx.globalAlpha *= Math.sin(t * Math.PI) * .36;
    r.circle(knobX, y + 30, 12, null, C.green);
    r.ctx.restore();
  }
  if (r.effectsQuality !== 'low') r.round(knobX - 5, y + 23, 7, 1.2, .6, '#ffffff');
  r.ctx.restore();
  if (supported) r.hit(24, y, 342, 62, () => game.toggle(row.key));
}

function storageMessage(game) {
  if (game.store.getStatus().persisted) {
    return '通关记录、邮票、引导状态、当前路线和体验设置保存在这台设备。清理缓存或更换设备后无法同步找回。';
  }
  return '当前存储状态异常。原存档会尽量保留，新变化可能仅在本次运行有效；恢复后游戏会自动重试保存。';
}

function drawSettings(r, game) {
  r.header('体验设置', '声音、反馈与动态效果', () => game.home());
  ROWS.forEach((row, index) => drawToggle(r, game, row, 92 + index * 70));

  const y = 382, lines = r.wrapLines(storageMessage(game), 306, 12);
  const panelH = 48 + lines.length * 19;
  r.panel(24, y, 342, panelH, { fill: C.raised, stroke: C.line, radius: 13 });
  r.text('本机数据', 42, y + 21, 13, C.ink, 'left', '600');
  lines.forEach((line, index) => r.text(line, 42, y + 47 + index * 19, 12, C.muted));
  r.button('清除这台设备的数据', 24, y + panelH + 12, 342, CONTROL.compactHeight,
    () => game.resetPrompt(), { style: 'quiet' });
}

module.exports = { drawSettings, ROWS };
