# v1.9.0 真机问题修复与验证

日期：2026-09-09。

后续真机确认：用户提供的新截图可见 v1.9.0，标题已呈现固定细宋体字形。用户接受该效果，并继续要求增加主页与加载页动效；动效版本为 v1.9.1，见 [动效说明](HOME-MOTION.md)。下文保留当时的调查过程和适用边界。

2026-09-10 按用户要求移除启动加载提示和主页页脚的界面版本号，内部版本仍保留供构建使用。下文带版本号的截图和预览包说明均为当时的验证记录，当前界面不再以显示版本文字作为验收条件。

## 标题字形：代码路径与运行包核对

用户反馈手机里的“风笺回廊”仍显示原字体。原先通过 Canvas `font` 指定 `Songti SC`、`STSong`、`SimSun` 和 `serif`，依赖设备字体，存在回退风险；当前启动页和主页已改为同一个 `drawTitle()`，使用随包思源宋体轮廓及基础 Canvas 路径绘制，没有 `font`、`fillText`、远程字体或字体加载失败后的黑体分支。

据源码可确认：如果该 `drawTitle()` 正在执行，它不会通过系统字体回退改选黑体。调查开始时未取得手机运行包的版本证据，无法确定具体原因是工具缓存、预览目录不一致、旧体验包或热启动。后续 v1.9.0 真机截图已确认修复后的字形生效，但不能据此逆推此前究竟是哪一层缓存或启动路径。

当时把 `package.json` 与 `src/config.js` 的版本统一为 `1.9.0`，并临时在启动加载提示和主页页脚显示 `v1.9.0`，用于核对修复包。该界面文字现已按用户要求移除，内部版本继续供构建使用。固定字形及其许可来源详见 `docs/TITLE-TYPOGRAPHY.md`。

### 微信官方资料与适用范围

本轮直接读取以下微信官方文档：

1. [wx.loadFont](https://developers.weixin.qq.com/minigame/dev/api/render/font/wx.loadFont.html)：加载代码包或本地字体，成功返回 family，失败返回 `null`。当前固定轮廓标题不依赖这一接口，继续更改系统字体列表不能解释当前轮廓代码下的旧黑体。
2. [小游戏运行机制](https://developers.weixin.qq.com/minigame/dev/guide/runtime/operating-mechanism.html)：退出胶囊先进入后台，热启动恢复已有实例；仅重新打开游戏不能证明发生代码重载。这是可能影响排查的平台机制，本轮尚未证实具体手机发生了哪种启动。
3. [开发者工具 CLI](https://developers.weixin.qq.com/minigame/dev/devtools/cli.html)：`--project` 固定项目路径；`reset-fileutils` 刷新工具内部文件监听；`cache --clean compile` 清编译缓存；`preview --qr-output --info-output` 生成二维码和包信息。只清编译缓存，不清 `storage`，不删除玩家存档。
4. [wx.getAccountInfoSync](https://developers.weixin.qq.com/minigame/dev/api/open-api/account-info/wx.getAccountInfoSync.html)：`envVersion` 区分开发、体验与正式，线上 `version` 仅正式版可取。当时使用代码内的 `v1.9.0` 文字核对真机包；移除界面版本号后，改以对应构建的原生预览二维码和包信息核对，不把开发或体验环境的空版本号当作异常。
5. [UpdateManager](https://developers.weixin.qq.com/minigame/dev/api/base/update/UpdateManager.html)：每次启动包括热启动会自动检查更新，下载就绪后才可 `applyUpdate()`；开发、体验环境无法测试这套版本更新机制。因此本轮先修复本地预览交付和版本可核对性，不增加正式版自动更新，不把该 API 当作开发预览或体验版更新途径。

### 本地网页与微信原生的交付区别

本地 `npm.cmd run build` 只更新 `preview/bundle.js`；项目配置将 `preview` 文件夹排除上传。原生小游戏由 `game.js` 加载 `src/main.js`，直接使用 `src` 中的标题和游戏逻辑。网页预览通过不能替代微信原生编译、扫码和真机验收。

原生预览明确针对 `E:\work\game-1` 刷新文件监听、清编译缓存并生成本次二维码，保留 `--info-output` 的代码包信息。

执行结果：开发者工具 CLI 已登录；对上述路径执行 `reset-fileutils`、`cache --clean compile` 均成功，随后 `preview` 成功。v1.9.0 原生包为 1,961,181 字节，二维码和信息保存在 `output/wechat-preview-v1.9.0.png`／`.json`。没有清理 storage，没有修改玩家存档，也未上传体验或正式版本。

标题绘制进一步改为直接输出最终坐标，严格测试不提供 `font`、`fillText`、`scale`、`translate` 或 `Path2D` 仍能绘制四字。当时原生包加入可见版本号，结合新生成二维码，完成从源码到真机画面的核对；该版本文字现已移除，历史核对记录保留。

## 新道具指引与小屏输入

风口、纸桥、风灯分别在第 13、16、19 关首次出现时自动展示同款卡片、手指和实物高亮，两步讲解不移动、不扣拍。跳关、旧档、恢复、跳过和重看均有回归；完整 999 关流程启用实际教学后仍按原预算三星通过。详见 [机制引导](MECHANIC-GUIDES.md)。

小屏根因已复现：原来的 8 个逻辑单位拖动阈值在 320×568 布局仅约 5.67 屏幕像素，轻抖会取消点击；严格要求按下和抬起同时命中重绘后的图形也会丢失边缘触摸。现在使用 12 屏幕像素阈值，按下锁定语义目标，并对空白边缘只给合法相邻格最多 8 像素容差。75 组尺寸／DPR／缩放／关卡组合及既有拖动、双指、重复点击保护通过，详见 [小屏修复](SMALL-SCREEN-INPUT.md)。

v1.9.0 整合后的 `npm.cmd test` 共 374 项全部通过，`check` 和构建通过；日志为 `output/team-tests.log`、`output/team-check.log`。v1.9.1 追加动效后的验证另见动效说明。

### 字形验收标准与当前边界

- 当前启动加载提示和主页页脚均不显示版本号，使用对应构建的原生预览二维码及包信息核对交付。
- 启动页显示进度条并自动进入主页，启动页和主页均呈现固定宋体轮廓。
- 界面没有版本文字是预期行为，不能据此认定使用了旧包。若字形异常，核对该次扫码或体验包，并保留画面、手机型号和微信版本，继续调查原生渲染，不能重复假定用户没有更新。
- 基础 Canvas 回归检查代码不访问字体或可选 `Path2D`。v1.9.0 标题已由用户真机截图确认；小屏输入的多机型验证目前仍以自动化窗口与微信 API 模拟为依据。
