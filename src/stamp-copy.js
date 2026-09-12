'use strict';

// Fictional keepsake notes describe the world, never a player's unsaved history.
const STAMP_NOTES = Object.freeze({
  'first-wind': '风从门缝里探进来，把空白信纸翻到第一页。',
  'three-beats': '脚步停下时，回廊还会替远处的回声数完三拍。',
  'paper-wings': '把纸角轻轻折起，一封信便有了想飞的模样。',
  'moss-letter': '石阶上的青苔留着水汽，也替来信留出一块干燥的角落。',
  'alley-light': '巷口只有一盏小灯，足够让晚归的信认出方向。',
  'far-wind': '风不在信封上写地址，却总能找到下一扇开着的窗。',
  'forest-echo': '林间的脚步声绕过树干，回来时带着叶子的轻响。',
  'moon-route': '月亮缓缓越过屋脊，把弯弯的邮路照成一条细线。',
  'starlight': '星光落在邮戳边缘，像替夜里的来信添了一枚小小的印记。',
  'long-corridor': '回廊很长，窗与窗之间，藏着许多可以慢慢读的句子。',
  'sky-letters': '晾起的信笺随风轻摆，天空也像一册尚未合拢的书。',
  'paper-bridge': '薄薄的纸桥连接两岸；走过它的风，会记得轻些落脚。',
  'snow-line': '雪线把山分成两种颜色，信封替两边留着同一份问候。',
  'tide-echo': '潮水退去又回来，像一封写到一半、仍舍不得收笔的信。',
  'thousand-turns': '纸上千百道折痕，每一道，都能摊开成另一段回廊。',
  'dark-alley': '暗巷里的灯不善言辞，只把光轻轻挪到行人的脚边。',
  'wind-eye': '急风绕着屋角打转，中央的一片信纸却安静地躺着。',
  'star-sea': '远处的灯与天上的星相接，让邮路有了海的宽广。',
  'lone-island': '小岛的邮局面朝大海，空着的窗台随时准备迎接来信。',
  'frost-night': '霜停在窗外，问候留在信里；夜色再深，也各有归处。',
  'old-town': '旧城的门牌褪了色，风仍认得每一个转角的名字。',
  'lamp-river': '桥上的灯映进水里，一条邮路便有了明亮的倒影。',
  'final-letter': '信写到最后一行，窗外的风还在等一张新的纸。',
  'star-river': '星河翻过新的一页，未写完的问候仍沿着灯火向远处延伸。',
  'ridge-wind': '风越过山岭，把另一侧的花香轻轻夹进信封。',
  'thousand-lamps': '万家灯火陆续亮起，每一扇窗都替归来的信留着位置。',
  'echo-poem': '回声把散落的脚步连成诗，最后一拍落在邮局门前。',
  'star-corridor': '群星垂在回廊尽头，弯折的邮路也有了完整的轮廓。',
  'thousand-starlights': '九百九十九条邮路连起星光，远处的第一缕风仍轻轻翻动信纸。'
});

module.exports = { STAMP_NOTES };
