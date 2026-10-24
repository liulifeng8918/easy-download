const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
assert.ok(process.argv[2], 'Provide the actual installed application directory');
const directory = fs.realpathSync.native(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', `unsigned-${version}`, 'payload-manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  const target = path.resolve(directory, entry.path);
  assert.ok(target.startsWith(directory + path.sep), 'File must remain inside the installation');
  const content = fs.readFileSync(target);
  assert.equal(content.length, entry.size, `Installed file size mismatch: ${entry.path}`);
  assert.equal(crypto.createHash('sha256').update(content).digest('hex'), entry.sha256, `Installed file hash mismatch: ${entry.path}`);
}
assert.ok(fs.existsSync(path.join(directory, 'Uninstall.exe')), 'Uninstaller must be generated during installation');
assert.match(fs.readFileSync(path.join(directory, '.easy-download-install.ini'), 'utf8'), /com\.lifeconnection\.easydownload/);
const output = path.join(root, 'output', 'installed-verification.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
const result = { version, directory, matchedFiles: manifest.files.length, installerSha256: manifest.sha256, verifiedAt: new Date().toISOString() };
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
