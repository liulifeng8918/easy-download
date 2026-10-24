const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
function probeText(text) {
  const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return { duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null, hasVideo: /Stream[^\r\n]*Video:/.test(text), hasAudio: /Stream[^\r\n]*Audio:/.test(text) };
}
async function verifyMedia(task, expected = {}, ffmpeg) {
  const filename = task.output_path;
  try {
    const output = fs.realpathSync(task.output_dir);
    const file = fs.realpathSync(filename);
    const relative = path.relative(output, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.statSync(file).size <= 0) throw new Error();
  } catch { return { ok: false, message: '下载未生成可核验的媒体文件。' }; }
  return new Promise(resolve => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-xerror', '-threads', '2', '-i', filename, '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let text = '', settled = false;
    const done = result => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { child.kill(); done({ ok: false, message: '媒体核验超时，未标记为下载完成。' }); }, 600000);
    child.stderr.on('data', chunk => { if (text.length < 16000) text += chunk.toString().slice(0, 16000 - text.length); });
    child.once('error', () => done({ ok: false, message: '媒体核验组件无法运行，请检查程序文件是否完整。' }));
    child.once('close', code => {
      const info = probeText(text);
      if (code !== 0 || (task.quality === 'audio' ? !info.hasAudio : !info.hasVideo) || !(info.duration > 0)) return done({ ok: false, message: '输出不是可读取的完整媒体文件，未标记为下载成功。' });
      if (expected.duration && Math.abs(info.duration - expected.duration) > Math.max(2, expected.duration * 0.05)) return done({ ok: false, message: '下载文件时长与目标视频不符，请重试；本次未标记为完整下载。' });
      done({ ok: true, ...info });
    });
  });
}
module.exports = { verifyMedia, probeText };
