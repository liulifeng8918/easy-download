const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { DouyinResolver } = require('../electron/download/douyin-resolver.cjs');

const source = process.env.EASY_DOWNLOAD_TEST_SOURCE || process.argv.find(value => /^https?:\/\//i.test(value)) || 'https://v.douyin.com/uOCeLrzmht8/';
const output = path.join(require('node:os').tmpdir(), 'easy-download-douyin-media-test.mp4');
const proxy = process.env.EASY_DOWNLOAD_TEST_PROXY || '';
app.on('window-all-closed', event => event.preventDefault());
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { text += chunk; process.stderr.write(chunk); });
    child.once('error', reject); child.once('close', code => resolve({ code, text }));
  });
}
app.whenReady().then(async () => {
  console.log('media-test-ready');
  const resolver = new DouyinResolver({ BrowserWindow, session, parent: () => undefined, timeoutMs: 45000 });
  try {
    const result = await resolver.resolve(source, { proxy, autoProxy: false });
    console.log(`resolved ${result.width}x${result.height} ${result.duration}s`);
    fs.rmSync(output, { force: true });
    const ytdlp = path.resolve('bin/yt-dlp.exe');
    const ffmpeg = path.resolve('bin');
    const args = ['--ignore-config', '--no-playlist', '--ffmpeg-location', ffmpeg, '--no-warnings', '--socket-timeout', '30'];
    if (proxy) args.push('--proxy', proxy);
    if (result.referer) args.push('--referer', result.referer);
    if (result.userAgent) args.push('--user-agent', result.userAgent);
    args.push('-o', output, result.mediaUrl);
    const download = await run(ytdlp, args);
    console.log(`download-exit ${download.code}`);
    if (download.code !== 0 || !fs.existsSync(output)) throw new Error(`媒体下载失败（退出码 ${download.code}）。`);
    const probe = await run(path.join(ffmpeg, 'ffmpeg.exe'), ['-hide_banner', '-i', output, '-t', '1', '-f', 'null', 'NUL']);
    if (probe.code !== 0) throw new Error('FFmpeg 媒体核验失败。');
    console.log(JSON.stringify({ ok: true, source, duration: result.duration, width: result.width, height: result.height, bytes: fs.statSync(output).size, output }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }, null, 2));
    process.exitCode = 1;
  } finally { resolver.dispose(); app.quit(); }
});
