'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');

function drawLevelHeader(r, game, progress, mode) {
  r.header('选一封来信', game.development ? '开发试玩 · 独立存档' : '不必赶路，想好了再出发',
    () => game.home());

  const developerPicker = game.development && mode === 'chapters';
  const width = developerPicker ? 212 : 342;
  r.label('已送达 ' + progress.completedCount + ' 封', 25, 105, width, 16, C.ink, 'left', '500');
  r.label('收集 ' + progress.stars + ' 星光 · ' + progress.perfectCount + ' 封三星来信',
    25, 132, width, 11, C.muted);
  if (developerPicker) {
    r.button('输入关卡号', 250, 96, 116, CONTROL.compactHeight,
      () => game.openDevelopmentPicker(), { style: 'text', size: 12, icon: 'grid' });
  } else r.text('共 ' + CAMPAIGN.length + ' 封来信', 365, 106, 11, C.muted, 'right');
}

module.exports = { drawLevelHeader };
