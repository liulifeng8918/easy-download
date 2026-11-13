// Build a portable ZIP from the already verified electron-builder unpacked payload.
// This package has no installer and does not change Windows security policy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = packageJson.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid package version: ${version}`);
  const suffix = String(process.env.PORTABLE_SUFFIX || '').trim().replace(/[^a-zA-Z0-9-]/g, '');

  const release = path.resolve(process.env.PORTABLE_RELEASE_DIR || path.join(root, `release-${version}`));
  const payload = path.resolve(process.env.PORTABLE_PAYLOAD_DIR || path.join(release, 'win-unpacked'));
  const outputDir = path.resolve(process.env.PORTABLE_OUTPUT_DIR || release);
  const appExe = path.join(payload, '易下载.exe');
  const sidecar = path.join(payload, 'resources', 'app', 'runtime', 'easy_download_sidecar.exe');
  const ytdlp = path.join(payload, 'resources', 'app', 'bin', 'yt-dlp.exe');
  const ffmpeg = path.join(payload, 'resources', 'app', 'bin', 'ffmpeg.exe');
  const node = path.join(payload, 'resources', 'app', 'runtime', 'node.exe');
  const payloadVersion = JSON.parse(fs.readFileSync(path.join(payload, 'resources', 'app', 'package.json'), 'utf8')).version;
  if (payloadVersion !== version) throw new Error('Packaged app version mismatch; run dist:dir first');
  for (const file of [appExe, sidecar, ytdlp, ffmpeg, node]) {
    if (!fs.existsSync(file)) throw new Error(`Missing packaged runtime: ${file}`);
  }

  const stagingLabel = String(process.env.PORTABLE_STAGING_LABEL || '');
  if (stagingLabel && !/^[A-Za-z0-9-]{1,60}$/.test(stagingLabel)) throw new Error('Invalid staging label');
  const staging = path.join(root, 'build', `portable-${version}-x64${suffix}${stagingLabel ? '-' + stagingLabel : ''}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const archive = path.join(outputDir, `EasyDownload-${version}-x64-portable${suffix}.zip`);
  if (fs.existsSync(staging)) throw new Error(`Staging exists; preserve it before rebuilding: ${staging}`);
  if (fs.existsSync(archive)) throw new Error(`Release exists; preserve it before rebuilding: ${archive}`);
  fs.mkdirSync(staging, { recursive: true });
  fs.cpSync(payload, staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'resources', 'app', 'portable-mode.flag'), 'portable-user-data-v1\r\n', 'utf8');
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const source = path.join(root, name);
    if (!fs.existsSync(source)) throw new Error('Missing publication license file: ' + name);
    fs.copyFileSync(source, path.join(staging, name));
  }
  fs.writeFileSync(path.join(staging, 'SOURCE_CODE.txt'), [
    'Easy Download ' + version + ' - corresponding application source and build scripts',
    'https://github.com/liulifeng8918/easy-download/tree/v' + version,
    'Application license: GNU GPL version 3 only (GPL-3.0-only). See LICENSE.',
    'Third-party source and license links: THIRD_PARTY_NOTICES.md.',
    'Official free edition: single-video downloads remain free and unlimited; updates and source publication continue.',
    '',
  ].join('\r\n'), 'utf8');

  fs.writeFileSync(path.join(staging, '启动易下载.cmd'), [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'cd /d "%~dp0"',
    'start "" "%~dp0易下载.exe"',
    'endlocal',
    '',
  ].join('\r\n'), 'utf8');

  fs.writeFileSync(path.join(staging, '绿色版使用说明.txt'), [
    `易下载 ${version} 绿色免安装版`,
    '',
    '使用方法：',
    '1. 将整个文件夹解压到本地目录。不要只复制其中的易下载.exe。',
    '2. 直接双击“易下载.exe”。“启动易下载.cmd”仅为备用入口。',
    '3. 单个视频链接下载免费且不限次数，不需要激活；点击“开始下载”即可使用。',
    '4. 浏览器扩展支持“下载当前视频”“发送到易下载”，页面空白处和视频链接右键均显示“下载此视频”；软件未启动时请先打开易下载。',
    '5. 如果网站提示需要登录，打开“设置 → 连接 Chrome”。程序直接打开扩展管理页和图文向导：先开启右上角开发者模式，点击加载已解压的扩展程序，再复制向导中的路径到选择窗口确认。之后自动连接，不需填写连接码。',
    '6. 专业版工作流为“来源 → 队列 → 整理输出”：可批量加入链接，逐项选择最佳画质、4K、1080p、720p或 MP3，并设置 MP4/MKV、并发数和失败重试；需要有效激活码。',
    '7. 下载完成后可在“整理输出”中勾选视频、保存原字幕、使用免费公共翻译，并把译文封装为可切换的独立字幕轨道。',
    '8. 点击“更改目录”选择下载位置；首页会保存画质、格式、目录和代理策略，浏览器扩展会沿用这些默认偏好。',
    '9. 网络默认自动检测代理；如无需代理，可在设置中选择直接连接。高级代理地址应以自己的代理软件显示为准。',
    '10. 特殊网站下载需求可联系微信 open_java；需先评估链接类型、登录要求与技术可行性。',
    '',
    '说明：',
    '- 本版本不写入 Program Files，不创建卸载项，不需要安装器。',
    '- 绿色版不等于绕过 Windows 安全策略；如果 Windows 智能应用控制拦截易下载.exe，仍需使用受信任签名版本或由用户自行调整系统策略。',
    '- 请保留整个文件夹，删除其中的文件可能导致程序无法启动。',
    '- 此 ZIP 不带登录状态、个人设置或激活信息。首次运行后，数据保存在此绿色版文件夹的 resources/app/user-data 下；不要将使用过的文件夹直接发给他人，请分发原始 ZIP。',
    '- 不需要另行安装 Python、Node.js 或 Electron。',
    '- 原目录覆盖更新会保留 Chrome 连接。使用这个全新 ZIP 则是新目录，必要时连接一次 Chrome；不要同时运行多个易下载。',
    '- 下载资源按电脑性能自动分配；完成前默认快速检查首尾声画，下载任务页可手动运行深度检查。',
    '',
  ].join('\r\n'), 'utf8');

  const powershell = [
    '$ErrorActionPreference = "Stop"',
    `Compress-Archive -Path ${psQuote(path.join(staging, '*'))} -DestinationPath ${psQuote(archive)} -CompressionLevel Optimal`,
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', powershell], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ZIP creation failed (${result.status}): ${result.stderr || result.stdout}`);

  const digest = hashFile(archive);
  fs.writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\r\n`, 'utf8');
  const manifest = {
    product: packageJson.productName || '易下载',
    version,
    architecture: 'x64',
    format: 'portable-zip',
    archive: path.basename(archive),
    sha256: digest,
    signed: false,
    builtAt: new Date().toISOString(),
    payloadSource: path.relative(root, payload),
    launchers: ['启动易下载.cmd', '易下载.exe'],
    notes: [
      'This package is a portable distribution, not a security-policy bypass.',
      'Smart App Control may still block unsigned executables.',
    ],
  };
  fs.writeFileSync(path.join(outputDir, `EasyDownload-${version}-x64-portable${suffix}.json`), JSON.stringify(manifest, null, 2) + '\r\n', 'utf8');
  console.log(JSON.stringify({ archive, bytes: fs.statSync(archive).size, sha256: digest, signed: false }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = { hashFile };
