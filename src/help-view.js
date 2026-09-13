'use strict';

const { C } = require('./theme');
const { STAR_TWO_MARGIN } = require('./engine');
const { SUPPLY_ENERGY } = require('./supply-rules');

function helpContent(level, reviveCount, platformKind, options = {}) {
  const videoAvailable = platformKind === 'wechat' && options.canRevive === true;
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
    if ((level.bridges || []).length) mechanics.push('纸桥：离开即碎，回声仍可通过；\n修桥包可修复相邻断桥，修好可再走。');
    if (level.lights.length) mechanics.push('风灯：首次踩上补 3 拍，每盏仅一次。');
    if (mechanics.length) sections.push({ title: '本关机关', icon: 'lamp', color: C.green, text: mechanics.join('\n') });
    if (level.id >= 4) sections.push({ title: '随身道具', icon: 'lamp', color: C.goldText,
      text: '灯未灭时，灯油原地补' + SUPPLY_ENERGY + '拍。' +
        (level.id >= 7 ? '\n纸鸢隔空收一封信：直着数最多2格，\n或拐弯数各1格；可隔墙，不收蓝票。' : '') +
        (level.id >= 16 ? '\n修桥包修身旁断桥，上下左右紧挨一格；\n修好后再离开仍会碎。' : '') +
        '\n道具不耗拍，回声也不前进；最高二星。\n点道具看说明，再选亮起的目标。' });
    if (level.id >= 4) sections.push({ title: '灯油与续灯', icon: 'oil', color: C.goldText,
      text: '灯灭后已有灯油，优先用油补' + SUPPLY_ENERGY + '拍。' +
        (videoAvailable ? '\n没有灯油时，可完整看视频续灯' + SUPPLY_ENERGY + '拍。' : '\n无法续灯时，可免费重新挑战。') +
        '\n续灯消耗同一份补给，不额外送库存。\n每份只补一次，已有灯油无需另看视频。' });
    if (level.id >= 31) sections.push({ title: '回声笛 · 提前盖票', icon: 'echo', color: C.blueText,
      text: '提前盖好一张蓝票，省下等回声的时间。\n先踩上蓝票，在回声到来前用；\n离开蓝票后也能用，点亮起的票即可。\n未踩过的票不能选；每次只盖一张。\n到了邮局只差这张票时，可直接盖好通关。\n不耗拍、不补灯火；用后最高二星。' });
    if (level.id >= 4) sections.push({ title: videoAvailable ? '按需看视频获取' : '道具获取与保留', icon: 'play', color: C.goldText,
      text: (videoAvailable ? '在微信内，自愿完整看1个视频获1份道具。\n未看完、加载失败或取消，都不会发放。' :
        '当前环境没有可用的视频补给。\n已有道具仍可使用，无道具也能通关。') +
        '\n仅本次路线有效，重试或切关会清空。\n撤回道具会退回效果、返还已领取的1份，\n再次使用这份无需看视频。\n不会自动弹广告，也不影响无道具通关。' });
    sections.push({ title: '一程关联所有成长', icon: 'stamp', color: C.green,
      text: '主线送达解锁下一封，星光推进邮票收藏与好友排行。\n每日同一关首次送达获1至3邮程，满6记日邮戳。\n日邮戳累计保留，道具通关同样计邮程。\n首页「今日邮程」会推荐新关与待摘星邮路。' });
    const two = level.par + STAR_TWO_MARGIN, assisted = reviveCount > 0 || options.itemsUsed > 0;
    // A paper kite can finish a delivery without advancing the turn, even
    // immediately after relighting at the two-star boundary.
    const oneStar = options.turn > two;
    sections.push({ title: '本关评星', icon: 'star', color: C.goldText,
      text: assisted ? (reviveCount ? '已续灯 ' + reviveCount + ' 次，' : '已使用道具，') +
        (oneStar ? '本次最多一星。' : reviveCount ? '续灯封顶二星。' : '本次最高二星。') +
        (oneStar ? '\n送达即可获得一星，重试可重新挑战更高星级。' : '\n总计 ' + two + ' 拍内通关得二星，超出得一星。')
        : '三星：' + level.par + ' 拍内 · 二星：' + two + ' 拍内\n超过 ' + two + ' 拍通关得一星。' });
    if (level.id >= 4) sections[sections.length - 1].text += (assisted ? '' : '\n使用道具或续灯，本次最高二星。') +
      '\n道具局纪录至少按三星目标 +1 拍计，\n已获得的三星与更短纪录会保留。';
    if (platformKind === 'browser') sections.push({ title: '电脑操作', icon: 'grid', color: C.green,
      text: '方向键 / WASD：移动\n空格：等一拍 · Z / 退格：撤回\nTab / Shift+Tab：切换按钮或道具目标\nEnter：选择 · 1 / 2 / 3 / 4：查看道具\n鼠标点亮起的目标使用道具\nEsc：取消选择、暂停或返回\n滚轮缩放，放大后可拖动棋盘。\n暂停里的「恢复视角」可还原棋盘。' });
  }
  return { sections, lines: level && videoAvailable
    ? ['可用时看视频续灯 +' + SUPPLY_ENERGY + ' 拍，不另送灯油；已有油优先使用。', '续灯封顶二星，并按总拍数结算。'] : [] };
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
