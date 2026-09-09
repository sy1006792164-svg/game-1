# 手机与开发者工具的标题字形一致性

修复日期：2026-09-09；真机截图确认与后续动效更新：2026-09-10。

用户后来提供的真机截图已显示 v1.9.0 和固定宋体字形，本轮标题效果得到实际画面确认。v1.9.1 保留该字形，仅增加加载页与主页装饰动效。标题当前直接把轮廓转换为最终逻辑坐标绘制，也不再依赖字形内部的负缩放变换；这是跨运行时的绘制简化，不将未证实的 Canvas 差异断言为旧问题根因。

2026-09-10 按用户要求移除启动加载提示和主页页脚的界面版本号，内部版本仍保留供构建使用。带有 v1.9.0 的真机截图是当时的验证记录；当前验收不再要求界面显示版本文字。

此前启动页和主页均通过 Canvas 的 `font` 指定 `Songti SC`、`STSong`、`SimSun` 与通用 `serif`。这些名称依赖设备安装的字体及小游戏运行时的字体支持；代码没有携带字形，手机可以回退到默认字体。开发者工具显示的宋体不能保证在手机端存在。

现在两个大标题统一调用 `src/brand-title.js` 的 `drawTitle()`，通过 `moveTo`、`lineTo`、`bezierCurveTo`、`closePath` 和 `fill` 绘制四个固定字形。未调用 `fillText` 绘制品牌大标题，也不使用系统字体、字体加载接口、Path2D 或远程资源。启动页保留 36px 字号／48px 字距，主页保留 39px 字号／50px 字距；两个标题的水平中心都为 195 逻辑像素。其他正文继续使用原来的字体设置。

## 字形来源与重建

四个字来自 Adobe 官方提供的 [Source Han Serif CN Regular（思源宋体）](https://github.com/adobe-fonts/source-han-serif/blob/release/SubsetOTF/CN/SourceHanSerifCN-Regular.otf)。提取为矢量轮廓，保留宋体风格，不复制手机系统字体文件。

- 原始文件：`SourceHanSerifCN-Regular.otf`，11,626,108 字节，仅留在忽略且不上传的 `work/title-font/`。
- 原始文件 SHA-256：`3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d`。
- 四字轮廓：`src/title-glyphs.js`，3,541 字节。坐标按原始 1000 units/em 取整，运行时解码一次，无完整字体文件入包。
- [SIL Open Font License 1.1](https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release/LICENSE.txt)及 Adobe 版权声明随包保存在 `assets/title-font.LICENSE.txt`；字形数据按该许可证提供。
- 生成器：`tools/title-outline.py`，开发时使用 Python 与 fontTools（本次为 4.64.0）。命令：`python tools/title-outline.py /path/to/SourceHanSerifCN-Regular.otf`。生成器核验原始文件哈希；游戏运行和正常构建均无需 Python 或 fontTools。

## 验证与手机复测

基础 Canvas 回归覆盖四字路径、字距和上下文恢复，并检查启动页／主页实际使用相同的矢量标题。包检查计入随包许可证，仍保持原有 2 MiB 预算；构建沿用原关卡验证门。

此前的一张手机截图包含已移除的“适龄提示 8+”和“进入回廊”按钮，可以识别该截图中的启动界面较旧；这不能证明后续每次真机反馈都由同一种原因导致。再次反馈字体未变化时，起初没有该次手机运行包的版本证据，不能直接认定是旧体验版、编译缓存或热启动。后续 v1.9.0 真机截图已确认新的字形显示正常。

上一轮记录：`node --test tests/brand-title.test.js tests/integration.test.js` 87 项全部通过，覆盖不能使用 `font`／`fillText`／`Path2D` 的基础 Canvas、四字轮廓、36/39px 字号、字距、DPR 变换与上下文状态恢复、两页真实视图接入，以及既有启动、存档和关卡流程。上一轮 `npm.cmd run check` 与 `npm.cmd run build` 通过，源码及素材为 2,090,567 字节，999 关原预算验证门通过。此处数量是上轮快照；本轮 v1.9.0 的包大小和验证结果另见 `docs/DEVICE-FIXES-v9.md`。

上一轮已在浏览器 390×844 下实看启动页和主页，两处均显示宋体矢量字形，控制台无错误。截图：`output/startup-preview.png`、`output/title-home-preview.png`。浏览器结果不是实体手机验收。

## v1.9.0 真机资料核查

2026-09-09 重新直读微信官方资料，并检查本地入口和打包配置：

- [wx.loadFont](https://developers.weixin.qq.com/minigame/dev/api/render/font/wx.loadFont.html)支持本地路径和代码包路径，加载失败返回 `null`。这是明确加载自定义字体的接口；当前固定轮廓标题不调用该接口，也没有系统字体回退分支。如果当前 `drawTitle()` 执行，它绘制的就是随包轮廓，不会自行改选黑体。
- [小游戏运行机制](https://developers.weixin.qq.com/minigame/dev/guide/runtime/operating-mechanism.html)区分冷启动和热启动；关闭右上角胶囊会先进入后台，再次打开可能恢复原运行实例。因此“重新打开”本身不是代码已重载的证据。这里只确认平台机制，尚未证实本次反馈发生了热启动。
- [微信开发者工具 CLI](https://developers.weixin.qq.com/minigame/dev/devtools/cli.html)提供 `--project` 指定项目，`reset-fileutils` 重建文件监听，`cache --clean compile` 清理编译缓存，以及 `preview --info-output` 输出预览包信息。针对 `E:\work\game-1` 固定项目路径、刷新文件监听和编译缓存后生成新预览，可减少错误目录与工具缓存这两种排查变量；这些操作不清理玩家存档。
- [wx.getAccountInfoSync](https://developers.weixin.qq.com/minigame/dev/api/open-api/account-info/wx.getAccountInfoSync.html)的 `miniProgram.envVersion` 可区分 `develop`、`trial`、`release`，但 `miniProgram.version` 仅正式版提供。调查时曾在启动加载提示和主页页脚显示随代码携带的 `v1.9.0`，用于当时的真机核对；该界面文字现已按用户要求移除，内部版本仍供构建使用。
- [UpdateManager](https://developers.weixin.qq.com/minigame/dev/api/base/update/UpdateManager.html)说明客户端在每次启动（包括热启动）自动检查更新，下载就绪后才可调用 `applyUpdate()`；官方也说明开发版和体验版无法测试这套版本更新机制。本轮不新增正式版自动更新功能，避免把它误当成预览二维码或体验代码包的替代步骤。

### 网页构建与原生预览

`npm.cmd run build` 执行 `tools/build.js`，只生成 `preview/bundle.js` 供本地网页使用；`project.config.json` 明确把 `preview` 排除在小游戏上传范围之外。微信原生入口 `game.js` 直接加载 `src/main.js`，两个品牌标题最终使用 `src/brand-title.js` 和 `src/title-glyphs.js`。网页刷新成功不能证明手机预览包已更新，原生预览需要开发者工具针对同一项目生成二维码。

### 当前确认标准与历史记录

当前启动加载提示和主页页脚均不显示版本号。使用本次构建对应的原生预览二维码及包信息核对交付；启动页应是进度条加载后自动进入主页，随后分别检查启动页和主页的四字宋体轮廓。界面没有版本文字是预期行为，不能据此认定运行了旧代码。若字形仍不符，应记录手机型号、微信版本和实际截图，调查该运行环境的渲染，不笼统归因为未更新。

v1.9.0 原生预览二维码、代码包信息及真机截图确认结果记录在 `docs/DEVICE-FIXES-v9.md`，作为当时的验证记录保留。
