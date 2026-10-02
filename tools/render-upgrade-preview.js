'use strict';

// Optional CPU Canvas QA. These are static renders of production code, not a
// browser/WeChat/device test. Install @napi-rs/canvas separately to run locally.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { createHarness } = require('../tests/helpers/game-harness');
const { CAMPAIGN } = require('../src/levels');
const { replay } = require('../src/engine');
const { ART_FILE, ART_FRAMES } = require('../src/art-assets');
const { seekReview } = require('../src/route-review');

async function main() {
  for (const [file, family] of [['NotoSansCJK-Regular.ttc', 'PingFang SC'], ['NotoSansCJK-Bold.ttc', 'Microsoft YaHei']]) {
    const font = '/usr/share/fonts/opentype/noto/' + file;
    if (fs.existsSync(font)) GlobalFonts.registerFromPath(font, family);
  }
  const atlas = await loadImage(path.resolve(__dirname, '..', ART_FILE));
  const output = path.resolve(__dirname, '../output/experience');
  fs.mkdirSync(output, { recursive: true });
  for (const small of [false, true]) {
    const metrics = small ? { width: 320, height: 568, pixelRatio: 1, safeTop: 20, safeBottom: 0 } :
      { width: 390, height: 844, pixelRatio: 1, safeTop: 50, safeBottom: 34 };
    for (const scene of ['home', 'review', 'review-start', 'win', 'pause', 'settings']) {
      const canvas = createCanvas(metrics.width, metrics.height), harness = createHarness({ canvas, metrics });
      const { game } = harness;
      game.artAssets = game.renderer.artAssets = { ready: true,
        get: id => ART_FRAMES[id] ? { image: atlas, rect: ART_FRAMES[id] } : null };
      for (const level of CAMPAIGN.slice(0, 14)) game.store.recordWin(level.id, level.id === 7 ? 2 : 3, level.par);
      if (scene === 'home') game.home();
      else if (scene === 'settings') game.openPage('settings');
      else {
        const level = CAMPAIGN[14]; game.start(level); game.guideEnabled = false; game.mechanicGuide = null;
        game.actions = level.solution.slice(0, scene === 'pause' ? 4 : undefined);
        game.state = replay(level, game.actions); game.transitionAt = 0;
        if (scene === 'pause') game.pause();
        else { game.victory(); if (scene.startsWith('review')) game.openReview(); }
        if (scene === 'review') seekReview(game, Math.floor(game.actions.length / 2));
        if (scene === 'review-start') seekReview(game, 0);
      }
      harness.advance(); harness.draw();
      const file = path.join(output, scene + (small ? '-320' : '-390') + '.png');
      fs.writeFileSync(file, canvas.toBuffer('image/png')); console.log(file);
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
