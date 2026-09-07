# 风笺回廊

竖屏、单人、回合制的原生微信小游戏。送信员收集橙色信笺，晚三拍的回声沿历史落点收集蓝色邮票，最后到达邮局。包含5章30关、每日离线挑战、三星评价、12枚成长邮票、本地续玩，以及一次自愿激励视频续灯。

项目路径：`C:\Users\10067\WeChatProjects\minigame-1`  
微信 AppID：`wx224cd457271e1ace`

## 微信版直接运行

在微信开发者工具打开本目录，项目类型为“小游戏”，点击“编译”。`game.js` 直接加载 `src/main.js`，不需要 npm 安装、不需要构建、不需要数据库。

原飞机大战示例的 js/、images/、audio/ 仍保留，旧入口和配置备份在 work/starter-backup/。这些目录已从上传包排除，新游戏只引用 src/ 和 assets/。原 project.private.config.json 保留。

## 浏览器验收

```powershell
cd C:\Users\10067\WeChatProjects\minigame-1
npm.cmd run preview
```

打开 http://127.0.0.1:8765 。方向键 / WASD 移动，空格等一拍，Esc 暂停；也可点击相邻格或滑动棋盘。预览与微信版共用规则和界面代码，两者的本地进度相互独立。

浏览器失败后点击“看视频续灯”显示明确标记的测试面板，可模拟完整观看、中途关闭、加载失败。微信运行时没有模拟奖励入口。

## 广告接入

src/config.js 中 AppID 已设置；REWARDED_AD_UNIT_ID 仍为空，等待该小游戏账号下的真实激励式视频广告位 ID。AppID 不是广告位 ID。填入后重新编译，在实体手机验收。

只有 onClose 的 res && res.isEnded === true 才续灯，单局一次。取消、异常、无填充、未配置均不发奖，保留重试和免费重开选择。并发和过期回调不会重复发奖。

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run release:check
```

release:check 在缺少真实广告位时会失败，这是明确的发布前检查。代码通过不等于实体手机、真实广告或微信正式审核通过。

## 玩法

- 每次有效移动或等待消耗1拍，撞墙不消耗，没有实时倒计时。
- 第3拍回声出现于起点，第4拍到达第1拍的最终落点；它只收蓝色邮票。
- 风格推动一次，最终落点记入轨迹；等待不重复触发风。
- 灯格首次触及补充3拍，每盏一次。
- 全收集且玩家到达绿色邮局即胜；最后一点能量抵达也算成功。
- 三星依关卡目标拍数评价；复活最高二星。邮票只作收藏，不改变属性。
- 每日挑战由本机日期生成，同一天固定；跨日重玩旧题仍记旧日期。离线版不做跨设备同步、防改时间或在线排名。

## 目录

| 文件 | 作用 |
| --- | --- |
| src/engine.js、src/levels.js | 规则、30关、确定性每日题 |
| src/main.js、src/renderer.js | 流程、交互、原创Canvas画面 |
| src/platform.js | 微信/浏览器、触摸、安全区、生命周期 |
| src/storage.js、src/ads.js | 本地存档和激励视频 |
| src/sound.js、assets/ | 原创合成音效、512×512图标 |
| tests/ | 单元和集成回归 |
| tools/ | 零依赖构建、预览服务、检查、参考求解器 |
| docs/ | 设计、差异化检索、验收记录 |

## 交付边界

阅读 docs/ACCEPTANCE.md 区分已完成和待验项目，docs/RESEARCH.md 记录公开检索范围和来源。名称未做全量商标检索，不宣称玩法首创、全市场零相似或保证过审。真实广告位、实体手机、账号后台材料和正式审核需要在发布前完成。
