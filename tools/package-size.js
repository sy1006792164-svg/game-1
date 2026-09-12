'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Verified against the WeChat Mini Game documentation on 2026-09-12.
// These limits apply to DevTools' compiled packages, never this source estimate.
const WECHAT_PACKAGE_RULES = Object.freeze({
  source: 'https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html',
  packOptionsSource: 'https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html#packOptions',
  checkedOn: '2026-09-12', mainMiB: 4, totalMiB: 30, independentMiB: 4
});

const slash = value => String(value).replace(/\\/g, '/');
function relativeName(value) {
  const name = slash(value).replace(/^\.\//, '').replace(/\/$/, '');
  if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..'))
    throw new Error('Package paths must remain inside the project: ' + value);
  return name;
}

function compileRule(rule, warnings) {
  if (!rule || typeof rule.value !== 'string') throw new Error('Invalid packOptions rule.');
  const value = slash(rule.value), normalized = value.replace(/^\.\//, '').replace(/^\//, '').toLowerCase();
  if (rule.type === 'file') return name => name.toLowerCase() === normalized;
  if (rule.type === 'folder') {
    const folder = normalized.replace(/\/$/, '');
    return name => name.toLowerCase() === folder || name.toLowerCase().startsWith(folder + '/');
  }
  if (rule.type === 'suffix') return name => name.toLowerCase().endsWith(value.toLowerCase());
  if (rule.type === 'prefix') return name => name.toLowerCase().startsWith(normalized);
  if (rule.type === 'regexp') {
    const regexp = new RegExp(rule.value, 'i');
    return name => regexp.test(name);
  }
  if (rule.type === 'glob' && !/[\[\]{}()!]/.test(value)) {
    let pattern = '';
    for (let index = 0; index < normalized.length; index++) {
      const character = normalized[index];
      if (character === '*' && normalized[index + 1] === '*') {
        index++;
        if (normalized[index + 1] === '/') { index++; pattern += '(?:.*/)?'; }
        else pattern += '.*';
      } else if (character === '*') pattern += '[^/]*';
      else if (character === '?') pattern += '[^/]';
      else pattern += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const regexp = new RegExp('^' + pattern + '$', 'i');
    return name => regexp.test(name);
  }
  warnings.push('Source estimate cannot resolve packOptions ' + rule.type + ': ' + rule.value + '; verify this rule in DevTools.');
  return () => false;
}

function estimatePackageSources(root, project, game) {
  const warnings = [], pack = project.packOptions || {};
  const ignore = (pack.ignore || []).map(rule => compileRule(rule, warnings));
  const include = (pack.include || []).map(rule => compileRule(rule, warnings));
  const projectRoot = path.resolve(root), sourceRoot = path.resolve(projectRoot, relativeName(project.miniprogramRoot || '.'));
  const isIncluded = name => include.some(matches => matches(slash(name))) || !ignore.some(matches => matches(slash(name)));
  const packages = [{ name: 'main', root: '', independent: false, sourceBytes: 0, files: [] }];
  for (const entry of game.subpackages || game.subPackages || []) {
    if (!entry || typeof entry.root !== 'string') throw new Error('Invalid game.json subpackage root.');
    const subRoot = relativeName(entry.root);
    if (!subRoot || subRoot === '.' || packages.some(pkg => pkg.root === subRoot)) throw new Error('Invalid or duplicate subpackage root: ' + subRoot);
    packages.push({ name: entry.name || subRoot, root: subRoot, independent: entry.independent === true, sourceBytes: 0, files: [] });
  }
  const subpackages = packages.slice(1).sort((a, b) => b.root.length - a.root.length);
  function walk(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) { warnings.push('Source estimate skips symbolic link: ' + name); continue; }
      if (entry.isDirectory()) {
        if (!include.length && ignore.some(matches => matches(name))) continue;
        walk(path.join(directory, entry.name), name);
      } else if (entry.isFile() && isIncluded(name)) {
        const pkg = subpackages.find(item => name === item.root || name.startsWith(item.root + '/')) || packages[0];
        const bytes = fs.statSync(path.join(directory, entry.name)).size;
        pkg.files.push(name); pkg.sourceBytes += bytes;
      }
    }
  }
  walk(sourceRoot);
  return { kind: 'source-estimate', sourceRoot, packages,
    totalSourceBytes: packages.reduce((total, pkg) => total + pkg.sourceBytes, 0),
    warnings, actualPackagedBytes: null, acceptance: 'requires-wechat-devtools', rules: WECHAT_PACKAGE_RULES };
}

function packageEstimateLines(estimate) {
  const size = bytes => bytes + ' bytes (' + (bytes / 1024 / 1024).toFixed(3) + ' MiB)';
  return [
    ...estimate.packages.map(pkg => 'INFO Package source estimate ' + pkg.name + ': ' + size(pkg.sourceBytes) +
      ' in ' + pkg.files.length + ' files' + (pkg.independent ? ' (independent subpackage)' : '') + '.'),
    'INFO Total source estimate: ' + size(estimate.totalSourceBytes) + '; applies packOptions include/ignore and game.json subpackage roots.',
    'INFO WeChat Mini Game rules: main <= 4M; main + subpackages <= 30M; independent subpackage <= 4M; ordinary subpackages share the total limit.',
    'INFO Official package rules: ' + WECHAT_PACKAGE_RULES.source,
    ...estimate.warnings.map(warning => 'NOTE ' + warning),
    'PENDING Actual packaged size must be measured by WeChat DevTools. Source totals do not model compiler/minifier output, extension filtering, npm packaging or source maps and do not pass or fail an upload limit.'
  ];
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
  for (const line of packageEstimateLines(estimatePackageSources(root, read('project.config.json'), read('game.json')))) console.log(line);
}

module.exports = { WECHAT_PACKAGE_RULES, estimatePackageSources, packageEstimateLines };
