'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');

function drawLevelHeader(r, game, progress, mode) {
  const journey = typeof game.journey === 'function' ? game.journey() : null;
  r.header(mode === 'all' ? '选择一封来信' : mode === 'chapters' ? '邮路章节' : '再收一颗星', game.development ? '开发试玩 · 独立存档' : journey ? '今日邮程 ' + Math.min(journey.points, journey.target) + '/' + journey.target + ' · 每一程都算数' : '沿着邮路，把来信送向远方',
    () => game.home(), { actionWidth: 52 });
  r.button('', 322, 10, CONTROL.compactHeight, CONTROL.compactHeight,
    () => game.scrollToProgress(), { style: 'quiet', icon: 'route', label: '回到当前进度' });

  const developerPicker = game.development && mode === 'chapters';
  const width = developerPicker ? 212 : 342;
  r.label('已送达 ' + progress.completedCount + ' 封', 25, 105, width, 20, C.ink, 'left', '600');
  const guidance = mode === 'all' || mode === 'replay' ? '三星：目标拍数内送达，不用道具或续灯' :
      '收集 ' + progress.stars + ' 星光 · ' + progress.perfectCount + ' 封三星来信';
  r.label(guidance,
    25, 132, width, 12, C.muted);
  if (developerPicker) {
    const touchGrowth = Math.max(0, 44 / (r.scale || 1) - CONTROL.compactHeight);
    r.button('输入关卡号', 250, 96 - touchGrowth, 116, CONTROL.compactHeight,
      () => game.openDevelopmentPicker(), { style: 'text', size: 12, icon: 'grid' });
  } else r.text('共 ' + CAMPAIGN.length + ' 封来信', 365, 106, 12, C.muted, 'right');
}

module.exports = { drawLevelHeader };
