'use strict';

const { C } = require('./theme');
const { STAR_TWO_MARGIN } = require('./engine');

function helpContent(level, reviveCount, platformKind, options = {}) {
  const sections = [
    { title: '移动与等待', icon: 'arrow-right', color: C.green,
      text: '点相邻亮格移动；点脚下格或「等一拍」等待。\n每次消耗 1 拍，思考时不扣拍。\n撤回会退回上一步，剩余次数见按钮。' },
    { title: '你收信，回声收票', icon: 'echo', color: C.blueText,
      text: '你收橙色信笺，回声收蓝色邮票。\n停在蓝票格后，再移动或等待 3 次，\n回声就会到那里收票。' },
    { title: '收齐后，抵达邮局', icon: 'home', color: C.green,
      text: '信笺、邮票全收齐，抵达邮局即通关。' }
  ];
  if (level) {
    const mechanics = [];
    if (Object.keys(level.winds).length) mechanics.push('风口：走入后推 1 格，不额外扣拍；\n遇墙停下，不连推，等待不触发。');
    if ((level.bridges || []).length) mechanics.push('纸桥：离开即碎，仅回声可再次通过。');
    if (level.lights.length) mechanics.push('风灯：首次踩上补 3 拍，每盏仅一次。');
    if (mechanics.length) sections.push({ title: '本关机关', icon: 'lamp', color: C.green, text: mechanics.join('\n') });
    const two = level.par + STAR_TWO_MARGIN;
    sections.push({ title: '本关评星', icon: 'star', color: C.goldText,
      text: reviveCount ? '已续灯 ' + reviveCount + ' 次，' + (options.turn >= two ? '本次最多一星。' : '续灯封顶二星。') + '\n总计 ' + two + ' 拍内通关得二星，超出得一星。'
        : '三星：' + level.par + ' 拍内 · 二星：' + two + ' 拍内\n超过 ' + two + ' 拍通关得一星。' });
    if (platformKind === 'browser') sections.push({ title: '电脑操作', icon: 'grid', color: C.green,
      text: '方向键 / WASD：移动\n空格：等一拍 · Z / 退格：撤回\nEsc：暂停或返回\n滚轮缩放，放大后可拖动棋盘。\n暂停里的「恢复视角」可还原棋盘。' });
  }
  return { sections, lines: level && platformKind === 'wechat' && options.canRevive
    ? ['可用时可看广告续灯；灯再次熄灭后仍可选择续灯。', '续灯封顶二星，并按总拍数结算。'] : [] };
}

function layoutHelp(r, sections, width) {
  let height = 0;
  const blocks = sections.map(section => {
    const lines = r.wrapLines(section.text, width, 14);
    const block = { ...section, lines, y: height };
    height += 22 + lines.length * 22 + 14;
    return block;
  });
  return { blocks, height: Math.max(0, height - 14) };
}

function drawHelp(r, layout, x, y) {
  layout.blocks.forEach(block => {
    const top = y + block.y;
    r.icon(block.icon, x + 8, top + 9, 16, block.color);
    r.text(block.title, x + 23, top + 9, 14, block.color, 'left', '600');
    block.lines.forEach((line, i) => r.text(line, x, top + 33 + i * 22, 14, C.ink));
  });
}

module.exports = { helpContent, layoutHelp, drawHelp };
