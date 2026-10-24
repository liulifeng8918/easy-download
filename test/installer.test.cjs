const test = require('node:test');
const assert = require('node:assert/strict');
const { nsisEscape, makeIncludes } = require('../scripts/build-unsigned-installer.cjs');

test('installer paths escape NSIS expansion and reject line injection', () => {
  assert.equal(nsisEscape('C:\\资料\\$file.txt'), 'C:\\资料\\$$file.txt');
  assert.throws(() => nsisEscape('a\nDelete something'));
});

test('uninstaller removes only manifest files and nonrecursive empty folders', () => {
  const output = makeIncludes([{ absolute: 'D:\\payload\\app.exe', relative: 'app.exe' }, { absolute: 'D:\\payload\\resources\\a\\x.txt', relative: 'resources\\a\\x.txt' }]);
  assert.match(output.install, /File "D:\\payload\\app.exe"/);
  assert.match(output.uninstall, /Delete "\$INSTDIR\\resources\\a\\x.txt"/);
  assert.ok(output.uninstall.indexOf('RMDir "$INSTDIR\\resources\\a"') < output.uninstall.indexOf('RMDir "$INSTDIR\\resources"'));
  assert.doesNotMatch(output.uninstall, /\/r|\*/i);
  assert.throws(() => makeIncludes([{ absolute: 'D:\\outside', relative: '..\\outside' }]));
});
