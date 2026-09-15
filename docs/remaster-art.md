# 风笺回廊：手绘素材与资源约定

## 重制模块与交互

- `src/art-assets.js` 负责真实启动加载与重试，`src/art-sprites.js` 负责图集裁切和角色姿态；图片创建统一经过平台适配层。
- `src/chapter-map.js` 绘制每章六个邮路节点，最后一章三个；节点直接读取真实进度、星级和解锁结果。
- `src/action-preview.js` 调用已有 `engine.step()` 生成单步结果，预览只保存在当前手势中。短按合法邻格行动；长按 350 毫秒预览；松手、拖动、多指或页面变化取消。等待按钮使用同一流程。
- `src/echo-timeline.js` 仅展示已有历史确定的未来三拍，重复落点合并标记。
- 胜利结果页只消费已完成结算的星级、邮票和邮程结果；重绘不会再次发奖。
- `src/postal-paper.js` 统一收藏册、每日邮程、设置及弹窗的纸张与邮戳样式。

## 制作与使用

- 由内置 imagegen 生成原创童话手绘素材，已将最终原图复制到 `assets/art/storybook.png`，未依赖外部图片地址。
- 原图为 1254 × 1254 RGBA PNG。保留原始透明通道，不把文字烘焙进图片。
- 16 个主体通过 `src/art-assets.js` 中的实际像素矩形引用；不假定生成结果严格遵守请求的网格。
- 邮差与回声各有站立、两个步态和庆祝姿势；建筑、树、风灯、补给箱、岩石、铺地、指路牌与花盆共用同一透视及光源。
- 角色、灯光和动态景物单独绘制。首页静态地景缓存为 720 × 600，并在内存告警时释放。
- 图集约 6.0 MiB 解码内存，首页缓存约 1.65 MiB；代码检查约束二者合计不超过 16 MiB。
- 图集解码失败阻止进入游戏并显示重试；不会使用示例图片替代缺失资源。

## 最终生成提示词

Create ONE production-ready transparent PNG game sprite atlas, 1024x1024 square. Exactly 4 columns by 4 rows of equally sized 256x256 cells, no grid lines, no words, no labels, NO checkerboard painted in image, genuine alpha transparency everywhere outside each object. Each object must stay inside its own cell with 24px transparent padding, centered horizontally and feet/base at y=224 within its cell. Consistent exquisite hand-painted gouache storybook miniature style, softly tactile paper texture, ivory cream, moss green, terracotta orange, brass golden warm light, pale cyan ghost. Soft warm light from upper left. Isometric camera 2:1 diamond ground. Clear readable silhouettes at 40px display size, modest detail. Exact cell contents row-major: ROW1: (1) friendly tiny mail courier standing, moss green postman's cap, terracotta cape, satchel, boots, round face, full body seen front three-quarter facing screen right; (2) same identical courier walking left-foot forward; (3) same identical courier walking right-foot forward; (4) same courier lifting an envelope in celebration. ROW2: (1) adorable cyan translucent echo ghost courier with same cap shape, floating rounded hem, two eyes, front three-quarter facing right; (2) matching ghost stretched in movement; (3) matching ghost leaning in movement; (4) matching ghost celebrating. ROW3: (1) small storybook cream post office cottage with terracotta tiled roof, teal arched door and brass envelope emblem, whole building isometric; (2) soft rounded moss-green broadleaf tree with clearly visible trunk, whole tree; (3) brass standing lantern with amber light and curved dark green post, entire lantern; (4) open wooden supply crate with a tiny rolled paper map and oil flask. ROW4: (1) small mossy stone garden rock cluster with tiny grass; (2) a single low ivory paving stone tile, precisely 2:1 isometric diamond, subtle paper grain and grass at one edge; (3) a wooden direction sign with blank cream face; (4) terracotta flowerpot with tiny cream and golden wildflowers. All sixteen isolated objects fully visible, no overlapping across cell boundaries, no background, no floating effects outside cells. This is a sprite atlas to be sliced mathematically into equal cells, so strict 4x4 registration is essential.

## 验证边界

素材本身已检查透明通道、原图尺寸及裁切边缘。使用现有自动化测试检查事件、手势、布局计算、资源加载失败及存档兼容；按本次要求未做页面功能验证，也未进行微信真机或实际编译包验收。
