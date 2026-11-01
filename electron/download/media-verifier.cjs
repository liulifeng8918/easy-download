const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const children = new Set();
let quickTail = Promise.resolve(), deepTail = Promise.resolve();
function probeText(text) {
  const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return { duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null, hasVideo: /Stream[^\r\n]*Video:/.test(text), hasAudio: /Stream[^\r\n]*Audio:/.test(text) };
}
function decode(ffmpeg, filename, { start = 0, deep = false } = {}) {
  return new Promise(resolve => {
    const args = ['-hide_banner', '-nostdin', '-nostats', '-xerror'];
    if (start) args.push('-ss', String(start));
    args.push('-threads', os.cpus().length <= 2 ? '1' : '2', '-i', filename, '-map', '0:v:0?', '-map', '0:a:0?');
    if (!deep) args.push('-t', '1');
    args.push('-progress', 'pipe:1', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null');
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let text = '', counters = '', settled = false;
    const done = result => { if (settled) return; settled = true; clearTimeout(timer); children.delete(child); resolve(result); };
    const timer = setTimeout(() => { child.kill(); done({ code: -1, text, counters, timeout: true }); }, deep ? 600000 : 30000);
    child.stderr.on('data', chunk => { if (text.length < 16000) text += chunk.toString().slice(0, 16000 - text.length); });
    child.stdout.on('data', chunk => { counters = (counters + chunk.toString()).slice(-4000); });
    child.once('error', () => done({ code: -1, text, counters }));
    child.once('close', code => done({ code, text, counters }));
  });
}
async function check(task, expected, ffmpeg) {
  const filename = task.output_path;
  try {
    const output = fs.realpathSync(task.output_dir), file = fs.realpathSync(filename);
    const relative = path.relative(output, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.statSync(file).size <= 0) throw new Error();
  } catch { return { ok: false, message: '下载未生成可核验的媒体文件。' }; }
  const deep = expected.mode === 'deep';
  const first = await decode(ffmpeg, filename, { deep });
  if (first.timeout) return { ok: false, message: deep ? '深度检查超时，可稍后重试；文件保留在下载目录。' : '文件快速检查超时，请尝试深度检查或检查电脑负载。' };
  const info = probeText(first.text);
  const hasFrames = data => [...data.matchAll(/^frame=(\d+)/gm)].some(match => Number(match[1]) > 0);
  if (first.code !== 0 || (task.quality === 'audio' ? !info.hasAudio : !info.hasVideo || !hasFrames(first.counters)) || !(info.duration > 0)) return { ok: false, message: '输出文件无法正常解码，未标记为下载成功。' };
  if (task.quality !== 'audio' && expected.requireAudio && !info.hasAudio) return { ok: false, message: '这个视频缺少应有的声音，未标记为下载成功。' };
  if (expected.duration && Math.abs(info.duration - expected.duration) > Math.max(2, expected.duration * 0.05)) return { ok: false, message: '下载文件时长与目标视频不符，请重试。' };
  if (!deep && info.duration > 2) {
    const last = await decode(ffmpeg, filename, { start: Math.max(0, info.duration - 1.5) });
    if (last.code !== 0 || (task.quality !== 'audio' && !hasFrames(last.counters))) return { ok: false, message: '视频尾部无法正常读取，请重试或运行深度检查。' };
  }
  return { ok: true, ...info, mode: deep ? 'deep' : 'quick' };
}
function verifyMedia(task, expected = {}, ffmpeg) {
  const deep = expected.mode === 'deep';
  const previous = deep ? deepTail : quickTail;
  const result = previous.catch(() => {}).then(() => check(task, expected, ffmpeg));
  if (deep) deepTail = result.catch(() => {}); else quickTail = result.catch(() => {});
  return result;
}
function disposeMediaChecks() { for (const child of children) child.kill(); }
module.exports = { verifyMedia, probeText, disposeMediaChecks };
