# 从源码构建易下载

源码与构建脚本按 `LICENSE` 的 GPLv3 提供。源码包不是已编译软件；普通用户直接下载 Releases 的完整绿色 ZIP。

## 准备环境

- Windows x64、Python 3.11（发布构建使用 3.11.9）、Node.js 与 npm。
- 执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-build.txt
npm ci
```

开发者签发激活码的脚本另需 `keyring` 和自己的开发者凭据；这不是免费版运行或构建的要求，也不随源码分发任何签发凭据。

## 准备独立第三方运行时

发布包使用未修改的 yt-dlp 2026.10.26、FFmpeg 9.0.1 essentials、Node.js v22.14.0。上游源码与许可见 `THIRD_PARTY_NOTICES.md`。

可以从对应上游发行版准备以下文件；也可从本项目官方 1.0.2 绿色包的 `resources/app` 中复制相同位置的未修改二进制：

```text
bin/yt-dlp.exe
bin/ffmpeg.exe
runtime/node.exe
```

请保留第三方许可。不要从不明下载站获取替代文件。本项目不修改这些第三方组件，也不承诺第三方不同版本行为完全相同。

## 检查与运行

```powershell
npm test
python -m unittest discover -s test -p 'test_*.py'
npm run build:sidecar
npm start
```

`build:sidecar` 会将仓库中的 Python 源码编译为 `runtime/easy_download_sidecar.exe`，并检查冻结代码中的关键逻辑；不要只更新源码而继续运行旧 EXE。

## 构建新的绿色包

```powershell
npm run dist:dir
$env:PORTABLE_PAYLOAD_DIR = (Resolve-Path 'release/win-unpacked').Path
npm run dist:portable
```

脚本拒绝覆盖已经存在的同名正式 ZIP 和 staging 目录；重新构建时请先归档自己的旧构建输出。生成包需要根目录的 GPLv3 文本和第三方说明。新生成的主 EXE 没有商业代码签名，可能被 Windows 提示或拦截；本项目不修改系统防护设置。

历史发布脚本 `build-performance-release.cjs` 用来沿用本地 1.0.1 的已验证启动壳，并不要求所有开发者采用这一历史路径。独立开发者按上面的标准 `dist:dir` 流程即可。

官方在线授权后台不属于本仓库；源码不提供它的管理员权限或签名私钥。单个视频下载不需要激活码，专业版在线服务需使用官方授权，或者在遵守 GPLv3 及其他适用规则的前提下自行开发独立服务。
