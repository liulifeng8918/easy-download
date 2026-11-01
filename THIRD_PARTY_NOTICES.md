# 第三方组件与源码入口

本项目原创客户端源码按根目录 `LICENSE` 中的 GNU GPLv3 发布；下列独立组件及其依赖保留原版权与许可。版权没有因打包而转移给易下载。

| 组件 | 用途 | 许可与源码 |
| --- | --- | --- |
| Electron / Chromium | 桌面界面 | Electron 为 MIT，Chromium 及其依赖有各自许可。完整发行包保留 `LICENSE.electron.txt`、`LICENSES.chromium.html`；源码：https://github.com/electron/electron |
| yt-dlp 2026.10.26 | 网站解析与传输 | 上游项目为 Unlicense，Windows standalone 包中的依赖另有许可。https://github.com/yt-dlp/yt-dlp/tree/2026.10.26 ，上游发行包：https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26 |
| FFmpeg 9.0.1 essentials / gyan.dev | 合并、检查声画、封装字幕 | 本次二进制带 `--enable-gpl --enable-version3`，按 GPLv3 分发，不按 LGPL 描述。上游源码：https://github.com/FFmpeg/FFmpeg/tree/n9.0.1 ，构建提供方：https://www.gyan.dev/ffmpeg/builds/ ，其静态外部库保留各自许可。|
| Node.js v22.14.0 | 网页解析兼容脚本 | MIT 及随附第三方许可。源码与完整许可：https://github.com/nodejs/node/tree/v22.14.0 |
| CPython 3.11.9 | 本机下载服务运行时 | Python Software Foundation 许可及第三方声明。https://github.com/python/cpython/tree/v3.11.9 |
| PyInstaller | 本机服务打包 | GPLv2-or-later，附 bootloader 例外；该例外适用于打包输出。https://github.com/pyinstaller/pyinstaller |
| cryptography | 授权验签、本地数据保护依赖 | Apache-2.0 或 BSD-3-Clause，保留上游声明。https://github.com/pyca/cryptography |

上述版本以 1.0.2 发布包内组件实测为准，而不是“始终最新”的在线版本。完整包保留 Electron/Chromium 的许可文件，并附本项目 GPLv3 文本及第三方说明。未修改的第三方组件可从其上游取得对应源码；构建配置可通过 `ffmpeg.exe -buildconf` 等上游工具查看。

源代码与构建脚本入口：

- 易下载 1.0.2：https://github.com/liulifeng8918/easy-download/tree/v1.0.2
- Python 引擎构建：`scripts/build-sidecar.ps1`、`packaging/easy_download_sidecar.spec`
- 桌面构建：`package.json` 中的 `dist:dir`；绿色包构建：`scripts/build-portable-package.cjs`

本仓库不包含任何网站的 DRM 密钥或访问控制绕过实现，也不授予第三方网站内容的版权或下载权利。
