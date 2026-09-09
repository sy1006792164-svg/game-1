# 微信好友榜说明

更新日期：2026-09-09。项目为原生微信小游戏，AppID 为 `wxee6289f904a5d625`。首页“排行”仅提供微信好友榜，世界榜已移除。单人游玩与本地存档不依赖联网。

## 存储与数据流

好友榜通过微信原生用户托管数据保存成绩摘要，不使用 `wx.cloud`、云开发数据库、云函数或 CloudID，不需要开发者部署成绩服务。微信原生托管数据由微信平台保存，因此好友榜仍需要微信账号和网络；它不是纯本地榜单。[微信关系链数据指南](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/open-data.html)

主域读取已有本地通关记录，并把本人成绩摘要与展示指令发送给开放数据域。开放数据域先读取本人托管记录，再写入更好的成绩；好友查询、头像昵称和排行绘制都在开放数据域内完成。主域只显示共享画布，不接收好友关系明细，也不向开发者后台上传个人资料或关卡路线。

| 用途 | 微信原生能力 |
| --- | --- |
| 读取本人托管成绩 | 开放数据域内 `wx.getUserCloudStorage` |
| 保存本人托管成绩 | 开放数据域内 `wx.setUserCloudStorage` |
| 读取同玩好友与成绩 | 开放数据域内 `wx.getFriendCloudStorage` |
| 主域发送显示或更新指令 | `OpenDataContext.postMessage` |
| 显示好友榜 | 开放数据域绘制 `sharedCanvas`，主域显示画布 |

这些托管接口与 `wx.cloud` 是不同的能力。官方允许 `setUserCloudStorage` 在主域或开放数据域使用；本项目在开放数据域内完成读后比较、写入，以保留本人已有的更好成绩。[微信关系链数据指南](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/open-data.html)

开放数据域可调用 `wx.getUserInfo({ openIdList: ['selfOpenId'] })` 获取本人资料，用返回的 `openId` 在域内识别本人；参数哨兵值是 `selfOpenId`。本人身份读取失败时，不按昵称或成绩推测对应好友，只保留独立的本人托管成绩展示。[官方开放数据域用户信息接口](https://developers.weixin.qq.com/minigame/dev/api/open-api/data/OpenDataContext-wx.getUserInfo.html)

## 计分与旧存档

成绩来自本机已保存的主线通关记录，旧版本存档也可计入，不要求重新通关。每关的最高星数与最少拍数分别累计，按以下次序比较：

1. 累计星数更多的在前。
2. 星数相同，通关数更多的在前。
3. 前两项相同，总最佳拍数更少的在前。

同步前读取本人已有托管摘要，按相同排序规则选择更好的总成绩。写入串行执行，避免同次运行中较早的写入覆盖较新的成绩。托管摘要不是完整逐关存档，不能把不同设备上分别完成的关卡自动合并成逐关合集，也不提供跨设备恢复解锁、收藏或进行中的路线。

原生托管接口不提供本项目所需的跨设备比较后原子写入能力；同次运行中的串行保护不等于多台设备同时写入的事务保证。

这是基于本地成绩的好友比较，不再有服务端路线重放或反作弊校验。仅检查摘要格式和数值边界不能证明记录未被修改；不要将该版本描述为服务端核验榜。

## 玩家授权流程

1. 玩家主动点击“排行”后，通过 `wx.requirePrivacyAuthorize` 获取隐私同意。
2. 用 `wx.getSetting` 检查公开头像昵称授权。首次使用真实可见的 `wx.createUserInfoButton` 让玩家点击；已有授权时调用 `wx.getUserInfo` 刷新资料。两种方式均使用 `withCredentials: false`，只取公开头像昵称，不需要 `wx.login`、登录凭证、加密资料或 CloudID。[微信用户信息指南](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/user-info.html)、[原生按钮参数](https://developers.weixin.qq.com/minigame/dev/api/open-api/user-info/wx.createUserInfoButton.html)
3. 申请 `scope.WxFriendInteraction`，允许后由开放数据域读取本人及同玩好友的托管数据，展示头像、昵称、成绩与本人排名。[微信朋友信息权限](https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.getFriendCloudStorage.html)

未完成授权时不自动上传好友托管成绩。拒绝、取消或接口不可用时保留返回游戏和主动重试入口，不阻断单人游玩。已有授权的步骤可能直接成功，不保证每次重复全部弹窗。

已授权会话从后台返回时，先通过 `getSetting` 只读复核头像昵称和朋友信息权限，检查期间暂停新的成绩同步；撤权或检查失败时保留重试入口，不自动弹出授权框。朋友权限被拒绝后，再次进入排行只展示“去授权”，由玩家点击该按钮直接打开设置。后台迟到的头像昵称授权结果不会继续发起朋友授权。

微信游戏的“游戏账号信息／所有人可见”由微信游戏平台管理，本游戏不强制唤起该界面，也不能替玩家选择公开范围；不会为仿照截图而申请无关权限。[微信隐私指引第 1.22、5.1.7 项](https://weixin.qq.com/cgi-bin/readtemplate?lang=zh_CN&t=weixin_agreement&s=privacy)

隐私接口需要基础库 `2.32.3`，原生用户信息按钮需要 `2.0.1`，托管数据接口需要 `1.9.92`。低版本应提示更新微信，不能跳过隐私授权。[隐私接口](https://developers.weixin.qq.com/minigame/dev/api/open-api/privacy/wx.requirePrivacyAuthorize.html)、[托管数据接口](https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.setUserCloudStorage.html)

## 开发与正式成绩隔离

开发版允许体验完整的隐私、头像昵称和朋友信息授权。开发环境自由选关产生的成绩写入 `wind_letter_rank_v1_development`；体验版和正式版写入 `wind_letter_rank_v1`。读取好友榜时也使用相应键，两者不混排。

开放数据域的待同步成绩、缓存和进行中的请求也按存储键隔离；切换键时清空旧榜单并废弃旧查询回调，超时后迟到的写入只修复其原来的存储键。

微信托管数据每用户、每游戏最多 128 组 KV；每组 key 与 value 合计不超过 1,024 字节，key 不超过 128 字节。本项目只保存紧凑成绩摘要，不存储全部关卡路线。[微信托管数据限制](https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.setUserCloudStorage.html)

只有已托管成绩的同玩好友才能出现在相关列表；新增微信好友后的两小时内可能尚未返回其数据。不能用模拟好友、相同昵称或相同分数猜测真实好友身份。[好友数据接口](https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.getFriendCloudStorage.html)

## 微信公众平台隐私配置

用户此前已确认隐私声明和统一隐私组件配置完成。代理因站点安全策略未独立核验 MP 后台，也不会绕过限制访问；新版缩减后的信息用途应由账号运营者核对。配置完成与是否生效应结合真实微信授权结果确认。

后台“设置 → 服务内容声明 → 用户隐私保护指引”需如实披露昵称头像、微信朋友关系，以及本地通关成绩用于好友比较的用途；统一组件在“基本设置 → 隐私授权弹窗 → 设置”开启。可填写文案见 [提交资料隐私用途表](SUBMISSION-MATERIALS.md#隐私保护指引可填写的用途文案)。开发者姓名、联系方式由运营者填写，不在文档中推测。[微信官方隐私指南](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/privacy.html)

`getPrivacySetting.needAuthorization === false` 也可能意味着后台未声明类型，不能仅据此确认后台正确。统一组件在拒绝后的默认 10 秒内不会重复弹窗；`game.json` 的 `officialPrivacyAuthorizationShowingGap` 只控制间隔，不能代替后台声明和组件启用。需要展示隐私正文时使用 `wx.openPrivacyContract`。

## 旧云端资源状态

新版已取消世界榜，不再连接此前部署的 `leaderboard` 云函数和 `leaderboard_scores` 数据库集合。本次本地代码调整没有删除远端云函数、集合或历史数据，不能报告云端已清理；也没有因改为微信托管数据而自动注销此前开通的云开发环境。

旧本地云函数源码保留在已忽略、不随小游戏上传的 `work/retired-leaderboard-cloudfunctions` 备份目录。新版客户端不包含后端依赖，也没有需要执行的云函数准备或部署步骤。

微信托管成绩与旧云开发数据库是两套独立数据。清理本地缓存不等于删除微信托管成绩，也不等于删除旧云开发历史数据。

## 验证清单

- 运行 `npm.cmd test`、`npm.cmd run check`、`npm.cmd run build`，保留 999 关原规则通关验证。
- 未授权时通关、切后台、回前台与重启，确认没有云开发调用，也没有自动写入好友托管成绩。
- 使用已有本地通关存档授权，确认旧成绩进入本人好友榜；较旧或较差的本地成绩不能覆盖本人更好的托管记录。
- 开发版真机验证原生隐私、头像昵称和朋友信息授权；测试键和正式键隔离。
- 两个真实互为好友的账号分别授权并托管成绩，检查头像昵称、排序、并列、本人名次、翻页与刷新。
- 检查拒绝、取消、重新授权、没有上榜好友、网络失败、头像不可用、退出及切后台的状态。
- 已授权后切后台，在微信设置撤回头像昵称或朋友信息权限；返回时确认先复核权限，没有新的成绩提交或好友刷新。拒绝朋友权限后重新进入排行，必须点击“去授权”才打开设置。
- 真实本人身份不可用时独立显示本人卡片，不按昵称或分数把某个好友误标为本人。

本轮仅好友榜的完整微信双账号验收以实际执行结果为准；此前世界榜的云端联调结果不能替代新版验收。浏览器预览不能验证微信权限和好友关系。
