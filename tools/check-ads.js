'use strict';

// Current native lifecycle and gameplay reward regressions. The historical
// season/readiness API was never shipped by src/ads.js; test the actual API.
// This is an SDK simulation, not real ad approval, fill or device acceptance.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', 'tests/ads-lifecycle.test.js', 'tests/revive-flow.test.js'], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit'
});
if (result.error) { console.error(result.error.message); process.exitCode = 1; }
else process.exitCode = result.status === null ? 1 : result.status;
