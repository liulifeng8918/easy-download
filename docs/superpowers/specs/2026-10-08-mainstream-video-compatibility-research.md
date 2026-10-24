# 主流视频平台兼容矩阵与一手资料

调研日期：2026-10-08。关联：[统一下载规格](2026-10-08-unified-download-douyin-design.md)。

## 1. 证据与范围

本文件依据下载引擎官方代码／维护文档、平台官方政策和浏览器标准说明制定处理规则。社区问题记录用于确认风险，不证明全站恒定失败或成功。

本轮只做资料与本地组件检查，没有逐站登录或下载测试。这里的 23 个平台是产品覆盖选择，不是用户人数排名，也不是本版已验证支持名单。

本地引擎为 `2026.08.19`，随包 Node 为 `v22.14.0`。2026-10-08 经官方 GitHub API 查询，最新稳定版标签也是 `2026.08.19`；本轮源码核对固定在主分支提交 `51bab8a0116f4d8004c315706d809782607d5847`（提交日期 2026-09-27），与发行版并非完全相同。因此：

- 本地出现解析器名只证明有实现入口，不证明当前链接可下载。
- 最新源码包含某路线不证明已装入现包。
- 已有抖音浏览器取流样例只证明该样例／浏览器上下文，不证明 Electron 集成已经通过。
- 每个平台最终验收必须使用实际交付包。

## 2. 共用内部方式

- A：专用解析器，提取目标媒体／清单及元数据。
- B：已验证的隔离浏览器站点适配器，初始化普通播放页后取目标媒体；用户不需要完整观看。
- C：非 DRM 的 MP4／HLS／DASH 下载与音视频合并；不是“保存网页”。
- V：确实需要时的网站验证／用户已有权限／视频密码；账号资格不由软件提供。
- R：准确拒绝或说明限制：当前页面不支持、正直播、图片笔记、地区限制、试看、DRM、无法完成验证等。

B 不是所有网站自动可用的通用功能。MSE／`blob:` 不等于可下载 HTTP 文件；必须找到该目标的真实流／清单。登录 Cookie、页面签名、媒体签名、YouTube PO 校验和易下载本机配对令牌是不同的机制，不能混为一谈。

## 3. 平台矩阵

优先级表示工作顺序：P0 首发核心闭环；P1 复用已有路线逐站验证；P2 需要额外适配或具有较强条件限制；R 本版不提供正片下载。所有未实测项保持未验证。

| 平台 | 目标网址／内容 | 内部路线 | 网络、验证与主要限制 | 优先级及本轮证据 |
| --- | --- | --- | --- | --- |
| YouTube | watch、youtu.be、Shorts 的单条视频 | A＋C；随包 Node／EJS | 公共内容优先匿名；账号内容／年龄限制、JS 挑战、部分客户端 PO 校验、限频与网络失败要区分；不要求用户填技术令牌 | P0；S01–S03；现包引擎与 Node 版本已检查，EJS／实际下载仍待验收 |
| B站 | BV／AV 播放页、b23.tv 分享，保留当前分 P | A＋C；分离音视频合并 | 部分画质需要登录或会员；一般不以代理为前提；番剧／付费资格另判，不承诺全部高清 | P0；S04；源码显示 SESSDATA、会员提示与 DASH |
| 抖音 | v.douyin.com 分享、douyin.com/video | B＋C；短链接展开与视频身份匹配 | Cookie 不等于必须登录；官方解析接口存在已报告失败；网站真实验证才显示窗口；不要求整段播放 | P0；S05、S06；已有单样例浏览器实验，应用集成未验收 |
| 快手 | kuaishou.com 的具体短视频、平台分享短链接 | 单独适配实验；通过后登记 B＋C，否则 R | 当前所查引擎未发现专用快手路线，官方项目仍有网站支持请求；不能靠添加域名／同步 Cookie 宣称解决 | P2；S07；未实测 |
| 小红书 | 视频笔记、xhslink.com 分享跳转；保留 xsec_token | A＋C；后备 B 必须先验证 | 原始访问参数不能清掉；普通图片笔记不是视频任务；网页可见性与验证须逐样例检查 | P1；S08；源码含带 xsec_token 的样例及初始页面状态解析 |
| 微博 | 帖子内视频、weibo.com/tv、m.weibo.cn | A＋C，必要时 V | 引擎已有访客状态处理；登录、私密内容和限频分开；主页不作为批量入口 | P1；S09；源码核对，未实测 |
| 西瓜视频 | ixigua.com 的单条播放页 | A＋C；后备 B 须验证 | 网页初始状态和 Cookie 可能影响解析，不必然需要账号登录；同时处理分离视频／音频 | P1；S10；源码明确 Cookie 可以不代表登录 |
| AcFun | acfun.cn/v/ac 单条投稿 | A＋C | 播放信息提取；番剧与付费内容不列入普通投稿承诺 | P1；S11；源码核对，未实测 |
| 好看视频 | haokan.baidu.com 的具体播放页 | 专用适配验证或静态通用尝试；否则 R | 所查专用入口 `BaiduVideo` 对应 v.baidu.com，不足以证明好看视频现包可用；不能混称“百度视频都支持” | P2；S12；未实测 |
| TikTok | @用户/video、vm／vt.tiktok.com、平台 /t/ 分享 | A＋C；只有通过测试才启用 B | 网络可达性、页面校验、账号／年龄与地区限制分别处理；不能把抖音适配器原样套用 | P1；S05；源码核对，未实测 |
| Vimeo | 单条视频、player.vimeo.com 嵌入页，保留私有链接必要参数 | A＋C；视频密码／正常权限走 V | 公开、密码、私有与嵌入 Referer 限制不同；密码由用户已有资格提供，不替用户获得访问权 | P1；S13；源码有密码和 Referer 处理，未实测 |
| Instagram | 视频帖子／Reels／分享的单条目标 | A＋C，必要时 V | 匿名与已登录路径不同，Cookie 可失效；相册可能含多个媒体，先精确定位单条目标；账号检查不伪装成代理问题 | P1；S14；源码核对，未实测 |
| Facebook | 视频、Watch／Reels 的单条目标 | A＋C，必要时 V | 已有 MP4／DASH／HLS 处理；公开视频、私密群组、账号访问权分别判定 | P1；S15；源码核对，未实测 |
| X／Twitter | status 帖子的目标视频，保留显式视频索引 | A＋C，必要时 V | 访客与账号访问条件可能不同；同帖多视频不误取；正常账号权限和网络限制分开 | P1；S16；源码核对，未实测 |
| Dailymotion | video／dai.ly 的单条内容 | A＋C，必要时 V | 访问令牌、年龄设置、地区与网络条件分别判定；技术参数由适配器处理 | P1；S17；源码核对，未实测 |
| Twitch | 已结束的 VOD／Clip | A＋C，必要时 V | 订阅回放要求用户已有资格；正直播本版不录制，不启动无法结束的任务 | P1；S18；源码有 HLS 和订阅限制，未实测 |
| 腾讯视频 | v.qq.com 单条播放页 | A＋C，仅非 DRM；否则 R | 源码明确记录 has_drm；正片、预告、试看、会员／地区不能混淆 | P2；S19；源码核对，未实测 |
| 爱奇艺 | iqiyi.com 单条／iq.com 国际播放页 | A＋C，仅允许访问的非 DRM 路线；否则 R | 已有 VIP、地区和试看相关条件；旧样例不能证明今天全部正片可用；不把试看片段报整集成功 | P2；S20；源码核对，未实测 |
| 优酷 | v.youku.com 单条播放页 | A＋C，内容权限另判；否则 R | 页面／播放接口、Cookie 与地区影响解析；不承诺会员正片、加密流或全部画质 | P2；S21；源码核对，未实测 |
| 芒果TV | mgtv.com/b 或 /v 的单条节目 | A＋C，仅可用非 DRM 流；否则 R | 已有播放流、Referer 与地区处理；会员、试看及加密内容不扩张支持承诺 | P2；S22；源码核对，未实测 |
| 搜狐视频 | tv.sohu.com 的具体播放页 | A＋C，条件限制另判 | 不混同首页、搜索和旧新播放地址；影视内容权限仍逐条检查 | P2；S23；源码核对，未实测 |
| Viu | viu.com/ott/{地区}/{语言}/vod/... 等具体内容 | 经过限制审查的 A＋C，仅可访问非 DRM 内容；否则 R | 源码含修改试看时长的回退分支，复用前须隔离该尝试；登录、地区和订阅资格另判；检查时长，防止“小文件假成功” | P2；S24；源码核对，未实测 |
| Netflix | 正片 | R：本版不提供正片提取 | 引导官方 App 离线观看；浏览器播放和第三方 MP4 下载不是同一能力 | R；S25、S27；非支持承诺 |

陌生／冷门网站不另设“填写域名就支持”的入口：先使用已有专用解析器与通用解析器，识别公开 MP4、非 DRM 播放清单或已知嵌入播放器；没有可靠结果明确说明暂不支持。此前的 Eporner 例子在官方源码有专用入口，说明网站是否知名不是兼容性的决定因素；本轮没有下载该站内容。来源 S26、S28。

## 4. 需要据此修正的统一设计

1. 站点兼容是一套内部策略注册表，不是给用户看的引擎收录名单。
2. 同一套入口支持整段分享文案与短链接，但保留 XHS 签名、B站分 P、Vimeo 私有访问参数等有效内容。
3. 代理用于网络可达性。公网可达不需强制代理；代理不会给用户会员或账号资格，也不会修复“尚无网站适配器”。
4. 所有站点共用验证提示，但不能承诺所有平台均允许嵌入登录。Google 的 OAuth 嵌入授权政策是明确风险；不要将此政策扩大解释为所有网页登录都已测试失败。
5. 普通公开视频优先不使用账号。真正需要的会话只在本地按站点隔离，不要求导出全部浏览器 Cookie，不发往授权后台。
6. 不能仅检查进程返回码、扩展名或非空文件。检查可用媒体、视频身份、预期时长、流关系和实际解码；试看必须单独说明。
7. HLS／DASH 不自动等于 DRM；非 DRM 路线按正常播放器可访问资源处理，DRM 则准确拒绝，不新增许可证绕过。
8. 当前网页能播放只是一个线索。MSE、账号条件、临时签名、分段和加密都需要站点适配，不许为追求“通用”而盲目下载页面任意网络资源。
9. 用户已有的高级浏览器授权能力保留为可选辅助；普通抖音路线不依赖安装扩展。无法完成某站点验证时如实说明，不无限弹设置。
10. Viu 已核对源码含修改试看时长的回退逻辑。本产品不使用取消未授权试看限制的路线；需要先隔离该分支并确认正常访问权限，无法隔离时按不支持该目标处理。非 DRM 并不自动代表用户有正片访问资格。

## 5. 统一验收场景

| 场景 | 需要证明的结果 |
| --- | --- |
| 整段分享文案／短链接 | 规范化正确，原参数和目标视频身份不丢失 |
| 普通匿名公开视频 | 仅粘贴和下载，不索取无关账号或令牌 |
| 指定分 P／多视频帖子 | 下载所指目标，不取第一条广告或推荐内容 |
| 音视频分离／HLS／DASH | 流选择正确，必要时合并，完整视频可解码 |
| 指定画质 | 可用则满足；不可用说明实际可用范围，不静默冒充 |
| 真正账号／密码／验证码 | 正常用户验证后继续；无法完成则明确结束 |
| 已有可用 Cookie 但接口 403 | 不谎称“尚未登录”，限定重试／可用后备 |
| 网络不可达／地区限制 | 分类正确，不把所有错误推荐为开启代理 |
| 试看、无权限、DRM | 不标作完整成功，不绕过限制 |
| 小文件／HTML／空清单 | 不能显示已完成 |
| 正直播／主页／图片笔记 | 明确当前版本目标范围，不挂无限任务 |
| 重复点击、超时、取消、退出 | 去重及资源释放正常，不破坏其它任务 |
| 清洁绿色包 | 能启动，要求激活，不携带开发机许可证／Cookie |

P0 每个平台至少 3 个合法可访问样例，覆盖不同网址形态；P1 每平台至少 2 个目标视频样例，通过后才标记相应范围已验证。特殊条件用实际平台场景验证；不能拿模拟单测冒充账号／地区／验证码成功。未通过的平台继续显示尝试结果，不提升为“已支持”。

固定记录：应用／引擎／运行组件版本、样例访问条件、网络方式、登录状态、视频身份、请求画质／实际画质、时长、实际输出文件及解码结果、验证日期。不保存 Cookie、登录密码、配对令牌或媒体临时签名。

## 6. 一手资料索引

源码链接固定于本次核对提交，避免未来分支变化改变本文证据含义；维护文档／平台政策另记本次查阅日期。

- S01：[YouTube EJS 官方说明](https://github.com/yt-dlp/yt-dlp/wiki/EJS)：JS 运行环境与随包脚本；本次文档注明 Node 最低 22.0.0，官方打包版包含 EJS。
- S02：[YouTube PO 校验官方维护指南](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)：部分客户端校验与 403 风险，不当作本机配对令牌。
- S03：[YouTube 官方引擎维护说明](https://github.com/yt-dlp/yt-dlp/wiki/Extractors)：账号、Cookie、限频及 OAuth 登录不可用说明；不用这些资料推导全站保证。
- S04：[B站解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/bilibili.py)。
- S05：[TikTok／抖音解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/tiktok.py)。
- S06：[抖音 Cookie／接口失败问题记录](https://github.com/yt-dlp/yt-dlp/issues/9667)：本次官方 API 查询状态 open，最近更新 2026-09-28；问题存在不代表全部链接失败。
- S07：[快手网站适配请求](https://github.com/yt-dlp/yt-dlp/issues/14010)：本次状态 open；结合本地入口列表和已核对源码目录，不能宣称已有专用快手路线。
- S08：[小红书解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/xiaohongshu.py)。
- S09：[微博解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/weibo.py)。
- S10：[西瓜视频解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/ixigua.py)。
- S11：[AcFun 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/acfun.py)。
- S12：[百度视频解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/baidu.py)：该入口对应 v.baidu.com，不是好看视频可用性证明。
- S13：[Vimeo 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/vimeo.py)。
- S14：[Instagram 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/instagram.py)。
- S15：[Facebook 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/facebook.py)。
- S16：[X／Twitter 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/twitter.py)。
- S17：[Dailymotion 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/dailymotion.py)。
- S18：[Twitch 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/twitch.py)。
- S19：[腾讯视频解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/tencent.py)。
- S20：[爱奇艺解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/iqiyi.py)。
- S21：[优酷解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/youku.py)。
- S22：[芒果TV 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/mgtv.py)。
- S23：[搜狐解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/sohu.py)。
- S24：[Viu 解析源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/viu.py)。
- S25：[Netflix 官方离线观看说明](https://help.netflix.com/en/node/54816)：官方 App 与设备条件，不是第三方正片导出接口。
- S26：[通用解析器源码](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/generic.py)及[官方兼容判断 FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ)：通用入口存在，不代表任意 URL 有视频可下载。
- S27：[MDN Media Source Extensions](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)及[Encrypted Media Extensions](https://developer.mozilla.org/en-US/docs/Web/API/Encrypted_Media_Extensions_API)：分段对象与加密播放的区别。
- S28：[Eporner 专用解析入口](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/eporner.py)：仅用于解释陌生网站并不必然不支持，未抓取站点内容。
- S29：[Google OAuth 安全浏览器政策](https://developers.google.com/identity/protocols/oauth2/policies#secure-browsers)：不在开发者控制的嵌入代理执行 Google OAuth 授权；政策范围不能泛化为所有网页登录已失败。
- S30：[官方稳定版发行记录](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19)及[本轮源码快照](https://github.com/yt-dlp/yt-dlp/commit/51bab8a0116f4d8004c315706d809782607d5847)。

## 7. 结论

统一的是入口、验证提示、队列与结果，而不是各个平台的底层请求方式。现有引擎专用解析＋经过验证的浏览器站点适配＋非 DRM 媒体下载组合能覆盖更广场景，但所有宣传范围都必须落在实际包的验收记录上。

先完成 P0，再复用现有解析器扩展 P1；P2 先保证识别和限制反馈准确，再按具体适配实验推进。既考虑主流平台，又避免为了未经验证的“全站支持”无限扩大首发。
