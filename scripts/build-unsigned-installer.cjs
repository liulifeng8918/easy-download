// Compiles a standard NSIS installer without executing any generated EXE.
// Does not sign files, submit them externally, or alter Windows security policy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function nsisEscape(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid character in installer path');
  return value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
}

function inventory(directory) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push({ absolute, relative: path.relative(directory, absolute), size: fs.statSync(absolute).size });
    }
  }
  visit(directory);
  return files.sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
}

function makeIncludes(files) {
  const install = [], uninstall = [], directories = new Set();
  let lastDirectory;
  for (const file of files) {
    const relative = file.relative.replaceAll('/', '\\');
    if (path.win32.isAbsolute(relative) || relative.split('\\').includes('..')) throw new Error('Payload must stay inside installation directory');
    const folder = path.win32.dirname(relative);
    if (folder !== lastDirectory) {
      install.push(`SetOutPath "$INSTDIR${folder === '.' ? '' : '\\' + nsisEscape(folder)}"`);
      lastDirectory = folder;
    }
    install.push(`File "${nsisEscape(file.absolute)}"`);
    uninstall.push(`Delete "$INSTDIR\\${nsisEscape(relative)}"`);
    for (let parent = folder; parent !== '.'; parent = path.win32.dirname(parent)) directories.add(parent);
  }
  for (const directory of [...directories].sort((a, b) => b.split('\\').length - a.split('\\').length)) {
    uninstall.push(`RMDir "$INSTDIR\\${nsisEscape(directory)}"`);
  }
  return { install: install.join('\r\n') + '\r\n', uninstall: uninstall.join('\r\n') + '\r\n' };
}

function main() {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be x.y.z');
  const release = path.join(root, `release-${version}`);
  const payload = path.join(release, 'win-unpacked');
  const payloadVersion = JSON.parse(fs.readFileSync(path.join(payload, 'resources', 'app', 'package.json'), 'utf8')).version;
  if (payloadVersion !== version) throw new Error('Packaged app version mismatch; run dist:dir first');
  for (const relative of ['易下载.exe', 'resources/app/runtime/easy_download_sidecar.exe', 'resources/app/runtime/node.exe', 'resources/app/bin/yt-dlp.exe', 'resources/app/bin/ffmpeg.exe']) {
    if (!fs.existsSync(path.join(payload, relative))) throw new Error(`Missing runtime: ${relative}`);
  }
  const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'nsis');
  const compiler = fs.readdirSync(cache).filter(name => /^nsis-\d/.test(name)).sort().reverse()
    .map(name => path.join(cache, name, 'makensis.exe')).find(file => fs.existsSync(file));
  if (!compiler) throw new Error('NSIS compiler not found in electron-builder cache');
  const files = inventory(payload);
  const includes = makeIncludes(files);
  const work = path.join(root, 'build', `unsigned-${version}`);
  fs.mkdirSync(work, { recursive: true });
  const installFiles = path.join(work, 'install-files.nsh');
  const uninstallFiles = path.join(work, 'uninstall-files.nsh');
  fs.writeFileSync(installFiles, '\uFEFF' + includes.install);
  fs.writeFileSync(uninstallFiles, '\uFEFF' + includes.uninstall);
  const output = path.join(release, `EasyDownload-${version}-x64-setup.exe`);
  if (fs.existsSync(output)) throw new Error(`Release exists; preserve it before rebuilding: ${output}`);
  const compileLog = fs.openSync(path.join(work, 'compile.log'), 'w');
  let result;
  try {
    result = spawnSync(compiler, ['/V3', '/INPUTCHARSET', 'UTF8', `/DAPP_VERSION=${version}`, `/DINSTALLER_OUT=${output}`, `/DINSTALL_FILES=${installFiles}`, `/DUNINSTALL_FILES=${uninstallFiles}`, `/DINSTALLED_KB=${Math.ceil(files.reduce((sum, file) => sum + file.size, 0) / 1024)}`, path.join(root, 'packaging', 'unsigned-installer.nsi')], { windowsHide: true, stdio: ['ignore', compileLog, compileLog] });
  } finally { fs.closeSync(compileLog); }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`NSIS compilation failed (${result.status}); see ${work}\\compile.log`);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.sha256', `${digest}  ${path.basename(output)}\r\n`);
  fs.writeFileSync(path.join(work, 'payload-manifest.json'), JSON.stringify({ version, output, sha256: digest, builtAt: new Date().toISOString(), files: files.map(file => ({ path: file.relative, size: file.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file.absolute)).digest('hex') })) }, null, 2));
  console.log(JSON.stringify({ installer: output, bytes: fs.statSync(output).size, sha256: digest, payloadFiles: files.length, signed: false }, null, 2));
}

if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { nsisEscape, makeIncludes };
