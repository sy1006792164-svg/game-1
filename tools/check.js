'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
let errors = 0;
function check(ok, label) { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) errors++; }
const project = JSON.parse(read('project.config.json')), game = JSON.parse(read('game.json')), config = require('../src/config');
const { estimatePackageSources, packageEstimateLines } = require('./package-size');
const packageEstimate = estimatePackageSources(root, project, game);
const includedFiles = new Set(packageEstimate.packages.flatMap(pkg => pkg.files));
check(project.appid === 'wxee6289f904a5d625' && project.appid === config.APP_ID, 'AppID matches requested project.');
check(project.compileType === 'game' && game.deviceOrientation === 'portrait', 'Native portrait WeChat Mini Game.');
check(read('game.js').includes("require('./src/main')"), 'Native entry points to the new game.');
for (const file of fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js'))) {
  const source = read('src/' + file);
  try { new vm.Script(source, { filename: file }); } catch (error) { check(false, error.message); }
  check(!/wx\.(request|connectSocket|getLocation|getFriendCloudStorage)\b/.test(source), file + ': no unrelated network, location or friend reads in the main domain.');
  // Check SDK access, not the unrelated mood.cloud sky-palette color.
  check(!/\b(?:wx|api)\s*\.\s*cloud\b|\bcallFunction\s*\(/.test(source), file + ': friend leaderboard has no cloud development dependency.');
}
for (const name of require('../src/sound').SOUND_TYPES) {
  check(includedFiles.has('assets/' + name + '.wav'), name + ' audio is included by the native package rules.');
  const file = path.join(root, 'assets', name + '.wav');
  const audio = fs.existsSync(file) ? fs.readFileSync(file) : null;
  check(audio && audio.length >= 44 && audio.subarray(0, 4).toString() === 'RIFF' &&
    audio.subarray(8, 12).toString() === 'WAVE' && audio.readUInt32LE(40) === audio.length - 44,
  'Original ' + name + ' audio exists with a complete WAV payload.');
}
// The account icon is uploaded as platform metadata, never loaded by the game.
// Keep it available for account setup without including it in the runtime package.
check(includedFiles.has('assets/title-font.LICENSE.txt'), 'Title outline license is included by the native package rules.');
const ignored = project.packOptions.ignore.filter(x => x.type === 'folder').map(x => x.value);
check(['work', 'output', 'docs', 'tests', 'tools', 'preview'].every(x => ignored.includes(x)), 'Tooling and QA excluded from game upload.');
check(!project.cloudfunctionRoot && !config.CLOUD_ENV_ID && game.openDataContext === 'open-data', 'Only the native friend leaderboard is configured; no cloud environment required.');
const authorization = read('src/ranking-authorization.js');
check(authorization.includes("'requirePrivacyAuthorize'") && !authorization.includes('scope.userInfo') &&
  !authorization.includes('createUserInfoButton') && !authorization.includes("'getUserInfo'"),
'Ranking requests privacy consent without an extra avatar/nickname authorization gate.');
for (const file of fs.readdirSync(path.join(root, 'open-data')).filter(f => f.endsWith('.js'))) {
  const source = read('open-data/' + file);
  try { new vm.Script(source, { filename: 'open-data/' + file }); } catch (error) { check(false, error.message); }
}
const { CAMPAIGN, chapterNames, PER_CHAPTER } = require('../src/levels');
check(CAMPAIGN.length === 999 && chapterNames.length === Math.ceil(CAMPAIGN.length / PER_CHAPTER), '999 campaign routes across 167 chapters.');
try {
  const { summary } = require('./verify-levels').assertCampaignSolvable();
  check(true, `${summary.passed} campaign routes win at three stars with original light and no revival (${summary.totalTurns} turns).`);
} catch (error) { check(false, error.message); }
const { isDevelopmentEnvironment } = require('../src/runtime-environment');
const loopback = { protocol: 'http:', hostname: 'localhost' };
check(['release', 'trial', undefined].every(envVersion => !isDevelopmentEnvironment({
  getAccountInfoSync: () => ({ miniProgram: { envVersion } }), enableDebug: true,
  getDeviceInfo: () => ({ platform: 'devtools' })
}, loopback)) && !isDevelopmentEnvironment({}, loopback) &&
  !isDevelopmentEnvironment(null, { protocol: 'https:', hostname: 'game.example.com', search: '?dev=1' }),
'Developer selection stays disabled for release, trial, unknown SDKs and public web origins.');
for (const line of packageEstimateLines(packageEstimate)) console.log(line);
if (process.argv.includes('--release')) check(/^adunit-[a-zA-Z0-9]+$/.test(config.REWARDED_AD_UNIT_ID), 'Real rewarded-video adUnitId configured.');
else if (!config.REWARDED_AD_UNIT_ID) console.log('PENDING Real adUnitId; real-ad acceptance remains pending.');
if (errors) { console.error(errors + ' check(s) failed.'); process.exitCode = 1; }
else console.log('Code/source checks passed; actual WeChat packaged size, physical devices, real ads and platform review require separate acceptance.');
