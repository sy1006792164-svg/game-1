'use strict';

const { C } = require('./theme');
const { VERSION } = require('./config');

function drawToggle(r, game, key, title, y) {
  const enabled = game.profile().settings[key];
  const supported = key !== 'haptics' || game.platform.kind === 'wechat';
  r.panel(24, y, 342, 68);
  r.text(title, 43, y + 24, 15, C.ink, 'left', '500');
  r.text(supported ? enabled ? '已开启' : '已关闭' : '在微信设备上可用', 43, y + 47, 11, C.muted);
  r.ctx.save();
  if (!supported) r.ctx.globalAlpha *= .45;
  r.round(295, y + 20, 49, 28, 14, supported && enabled ? '#638e75' : '#3e5754');
  r.circle(supported && enabled ? 330 : 309, y + 34, 10, C.white);
  r.ctx.restore();
  if (supported) r.hit(24, y, 342, 68, () => game.toggle(key));
}

function drawSettings(r, game) {
  r.header('设置', '声音与本机进度', () => game.home());
  drawToggle(r, game, 'sound', '游戏音效', 99);
  drawToggle(r, game, 'haptics', '振动反馈', 181);
  r.button('玩法说明', 24, 273, 342, 48, () => game.help());
  const persisted = game.store.getStatus().persisted;
  const text = persisted ? '进度自动保存在这台设备。清理缓存或更换设备后，原进度可能无法找回。' : '当前存储不可用，进度仅在本次运行保留，关闭游戏后可能丢失。';
  const lines = r.wrapLines(text, 306, 13), panelH = 58 + lines.length * 22;
  r.panel(24, 345, 342, panelH, { fill: '#19373a' });
  r.text('本机进度', 42, 369, 13, C.ink, 'left', '500');
  lines.forEach((line, i) => r.text(line, 42, 397 + i * 22, 13, C.muted));
  r.button('清除本机进度', 24, 345 + panelH + 12, 342, 44, () => game.resetPrompt(), 'quiet');
  if (game.toastUntil <= r.now) r.text('风笺回廊  /  ' + VERSION, 195, r.H - 49, 11, C.muted, 'center');
}

module.exports = { drawSettings };
