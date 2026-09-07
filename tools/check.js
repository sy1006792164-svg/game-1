'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
let errors = 0;
function check(ok, label) { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) errors++; }
const project = JSON.parse(read('project.config.json')), game = JSON.parse(read('game.json')), config = require('../src/config');
check(project.appid === 'wx224cd457271e1ace' && project.appid === config.APP_ID, 'AppID matches requested project.');
check(project.compileType === 'game' && game.deviceOrientation === 'portrait', 'Native portrait WeChat Mini Game.');
check(read('game.js').includes("require('./src/main')"), 'Native entry points to the new game.');
let bytes = fs.statSync(path.join(root, 'game.js')).size + fs.statSync(path.join(root, 'game.json')).size;
for (const file of fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js'))) {
  const source = read('src/' + file);
  try { new vm.Script(source, { filename: file }); } catch (error) { check(false, error.message); }
  check(!/wx\.(request|connectSocket|cloud|login|getUserInfo|getLocation)\b/.test(source), file + ': no business backend or personal information API.');
  bytes += Buffer.byteLength(source);
}
for (const name of ['move', 'collect', 'start', 'win']) {
  const file = path.join(root, 'assets', name + '.wav');
  check(fs.existsSync(file) && fs.readFileSync(file).subarray(0, 4).toString() === 'RIFF', 'Original ' + name + ' audio exists.');
}
bytes += fs.readdirSync(path.join(root, 'assets')).reduce((n, f) => n + fs.statSync(path.join(root, 'assets', f)).size, 0);
const ignored = project.packOptions.ignore.filter(x => x.type === 'folder').map(x => x.value);
check(['work', 'docs', 'tests', 'tools', 'preview', 'js', 'images', 'audio'].every(x => ignored.includes(x)), 'Starter template, tooling and QA excluded from upload.');
check(bytes < 1024 * 1024, 'Source/assets below 1 MiB: ' + bytes + ' bytes; final upload size subject to WeChat tools.');
if (process.argv.includes('--release')) check(/^adunit-[a-zA-Z0-9]+$/.test(config.REWARDED_AD_UNIT_ID), 'Real rewarded-video adUnitId configured.');
else if (!config.REWARDED_AD_UNIT_ID) console.log('PENDING Real adUnitId; real-ad acceptance remains pending.');
if (errors) { console.error(errors + ' check(s) failed.'); process.exitCode = 1; }
else console.log('Code/package checks passed; physical devices, real ads and platform review require separate acceptance.');
