'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');

function drawLevelHeader(r, game, progress, mode) {
  const journey = typeof game.journey === 'function' ? game.journey() : null;
  r.header(mode === 'all' ? '风中的邮路' : mode === 'chapters' ? '远方的章节' : '收集余下星光', game.development ? '开发试玩 · 独立存档' : journey ? '今日邮程 ' + Math.min(journey.points, journey.target) + '/' + journey.target + ' · 难关贡献更多' : '沿着浮岛，把来信送向远方',
    () => game.home());

  const developerPicker = game.development && mode === 'chapters';
  const width = developerPicker ? 212 : 342;
  r.label('已送达 ' + progress.completedCount + ' 封', 25, 105, width, 18, C.ink, 'left', '600');
  const guidance = mode === 'all' ? '三星 · 目标拍数内送达，不用道具或续灯' :
    mode === 'replay' ? '待摘星 · 目标拍数内送达，不用道具或续灯' :
      '收集 ' + progress.stars + ' 星光 · ' + progress.perfectCount + ' 封三星来信';
  r.label(guidance,
    25, 132, width, 12, C.muted);
  if (developerPicker) {
    const touchGrowth = Math.max(0, 44 / (r.scale || 1) - CONTROL.compactHeight);
    r.button('输入关卡号', 250, 96 - touchGrowth, 116, CONTROL.compactHeight,
      () => game.openDevelopmentPicker(), { style: 'text', size: 12, icon: 'grid' });
  } else r.text('共 ' + CAMPAIGN.length + ' 封来信', 365, 106, 11, C.muted, 'right');
}

module.exports = { drawLevelHeader };
