'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { estimatePackageSources, packageEstimateLines, WECHAT_PACKAGE_RULES } = require('../tools/package-size');

function fixture(t, files) {
  const prefix = path.join(os.tmpdir(), 'wind-package-test-');
  const root = fs.mkdtempSync(prefix);
  assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

test('source estimates recurse through all package paths and obey ignored files and folders', t => {
  const root = fixture(t, {
    'game.js': 'entry', 'game.json': '{}', 'src/nested/rule.js': 'rule',
    'assets/nested/texture.png': 'image', 'assets/icon.png': 'metadata',
    'open-data/nested/leaderboard.js': 'ranking', 'output/large.bin': 'excluded', 'output-kept/data.bin': 'kept'
  });
  const result = estimatePackageSources(root, { packOptions: { ignore: [
    { type: 'folder', value: 'OUTPUT' }, { type: 'file', value: 'Assets\\Icon.PNG' }
  ] } }, { openDataContext: 'open-data' });
  assert.deepEqual(result.packages[0].files.sort(), ['assets/nested/texture.png', 'game.js', 'game.json',
    'open-data/nested/leaderboard.js', 'output-kept/data.bin', 'src/nested/rule.js'].sort());
  assert.equal(result.totalSourceBytes, 27);
});

test('include takes priority inside ignored folders and other matching rules ignore case', t => {
  const root = fixture(t, { 'assets/keep.wav': 'keep', 'assets/drop.wav': 'drop',
    'cache/a.js': 'cache', 'note.BAK': 'backup', 'private-secret.js': 'secret',
    'level01.debug.js': 'debug', 'nested/trace.tmp': 'temporary', 'main.js': 'main' });
  const result = estimatePackageSources(root, { packOptions: {
    ignore: [{ type: 'folder', value: 'assets' }, { type: 'prefix', value: 'CACHE/' },
      { type: 'suffix', value: '.bak' }, { type: 'prefix', value: 'PRIVATE-' },
      { type: 'regexp', value: '^level[0-9]+\\.debug\\.js$' }, { type: 'glob', value: '**/*.TMP' }],
    include: [{ type: 'file', value: 'ASSETS/KEEP.WAV' }]
  } }, {});
  assert.deepEqual(result.packages[0].files.sort(), ['assets/keep.wav', 'main.js']);
  assert.deepEqual(result.warnings, []);
});

test('directory and single-JavaScript subpackages are accounted separately from the main package', t => {
  const root = fixture(t, { 'game.js': 'main', 'open-data/index.js': 'data',
    'stage1/game.js': 'stage', 'stage1/assets/image.bin': 'asset', 'stage2.js': 'second',
    'stage2.js.map': 'map', 'standalone/game.js': 'independent' });
  const result = estimatePackageSources(root, {}, { subpackages: [
    { name: 'first', root: 'stage1/' }, { root: 'stage2.js' }, { root: 'standalone', independent: true }
  ] });
  assert.deepEqual(result.packages.map(pkg => [pkg.name, pkg.sourceBytes, pkg.independent]),
    [['main', 11, false], ['first', 10, false], ['stage2.js', 6, false], ['standalone', 11, true]]);
  assert.equal(result.totalSourceBytes, 38);
  assert.ok(result.packages[0].files.includes('open-data/index.js'));
});

test('configured source roots scope estimates and outside-project paths are rejected', t => {
  const root = fixture(t, { 'compiled/game.js': 'game', 'compiled/late/game.js': 'late', 'tools/build.js': 'tool' });
  const result = estimatePackageSources(root, { miniprogramRoot: './compiled/' }, { subpackages: [{ root: 'late' }] });
  assert.equal(result.totalSourceBytes, 8);
  assert.equal(result.sourceRoot, path.join(root, 'compiled'));
  assert.throws(() => estimatePackageSources(root, { miniprogramRoot: '../' }, {}), /inside the project/);
  assert.throws(() => estimatePackageSources(root, {}, { subpackages: [{ root: '../other' }] }), /inside the project/);
});

test('large source estimates do not become either a custom budget failure or packaged-size approval', t => {
  const root = fixture(t, { 'game.js': Buffer.alloc(5 * 1024 * 1024, 32) });
  const result = estimatePackageSources(root, {}, {}), lines = packageEstimateLines(result);
  assert.equal(result.totalSourceBytes, 5 * 1024 * 1024);
  assert.equal(result.kind, 'source-estimate');
  assert.equal(result.actualPackagedBytes, null);
  assert.equal(result.acceptance, 'requires-wechat-devtools');
  assert.ok(lines.some(line => line.startsWith('PENDING Actual packaged size')));
  assert.ok(lines.every(line => !/^(PASS|FAIL) |self-imposed|2 MiB/.test(line)));
  assert.equal(WECHAT_PACKAGE_RULES.mainMiB, 4);
  assert.equal(WECHAT_PACKAGE_RULES.totalMiB, 30);
  assert.equal(WECHAT_PACKAGE_RULES.independentMiB, 4);
  assert.match(WECHAT_PACKAGE_RULES.source, /^https:\/\/developers\.weixin\.qq\.com\/minigame\//);
});

test('unsupported advanced glob rules are disclosed instead of presented as exact package analysis', t => {
  const root = fixture(t, { 'game.js': 'game' });
  const result = estimatePackageSources(root, { packOptions: { ignore: [{ type: 'glob', value: '**/*.{js,json}' }] } }, {});
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /cannot resolve packOptions glob/);
  assert.ok(packageEstimateLines(result).some(line => line.startsWith('NOTE ')));
  assert.equal(result.actualPackagedBytes, null);
});
