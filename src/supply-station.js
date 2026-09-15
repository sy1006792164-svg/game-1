'use strict';

const { drawItemArt } = require('./item-view');
const { ITEMS } = require('./items');
const { MOVE_MS } = require('./feedback-timing');
const { drawArtSprite } = require('./art-sprites');

function drawSupplyStation(r, x, y, size, item) {
  const c = r.ctx;
  if (r.artAssets && r.artAssets.ready) {
    drawArtSprite(r, 'supply', x, y + size * .15, size * 1.18, size * 1.12);
    drawItemArt(r, item, x, y - size * .91, size * .62);
    r.circle(x + size * .47, y - size * .42, size * .23, '#4d8979', '#fff5dc');
    r.text('+1', x + size * .47, y - size * .42, Math.max(7, size * .32), '#ffffff', 'center', '600');
    return;
  }
  c.save();
  c.beginPath(); c.ellipse(x, y + 1, size * .62, size * .19, 0, 0, Math.PI * 2);
  c.fillStyle = '#79987f2b'; c.fill();
  // A tied paper parcel carries the same real item artwork as the satchel.
  r.round(x - size * .51, y - size * .41, size * 1.02, size * .53, 3, '#e4c994', '#a1885e');
  r.round(x - size * .56, y - size * .49, size * 1.12, size * .2, 2, '#f6e1b3', '#af976b');
  r.line([[x, y - size * .48], [x, y + size * .1]], '#faf3d7', size * .11);
  r.line([[x - size * .3, y - size * .12], [x + size * .3, y - size * .12]], '#c09967', .8);
  drawItemArt(r, item, x, y - size * .68, size * .84);
  r.circle(x + size * .49, y - size * .51, size * .23, '#4d8979', '#e1f0db');
  r.text('+1', x + size * .49, y - size * .51, Math.max(7, size * .32), '#ffffff', 'center', '600');
  c.restore();
}

function drawSupplyPickup(r, game, now, projection) {
  if (game.reviewing || game.modal || !Number.isFinite(game.transitionAt)) return;
  const age = now - game.transitionAt, duration = 1050;
  if (age < MOVE_MS || age >= duration) return;
  const event = (game.moveEvents || []).find(entry => entry.type === 'supply');
  if (!event) return;
  const item = ITEMS.find(entry => entry.id === event.item);
  if (!item) return;
  const [x, y] = projection.point(event.cell), unit = projection.halfW;
  const quiet = r.reducedMotion || r.effectsQuality === 'low';
  const progress = (age - MOVE_MS) / (duration - MOVE_MS);
  const rise = quiet ? 0 : Math.min(1, progress * 3) * 7, c = r.ctx;
  c.save();
  if (!quiet) c.globalAlpha *= Math.min(1, (1 - progress) * 4);
  const width = Math.max(62, item.name.length * 10 + 35), top = y - unit * 1.8 - rise;
  r.round(x - width / 2, top, width, 22, 8, '#f5f3df', '#97b39a');
  drawItemArt(r, event.item, x - width / 2 + 12, top + 10, 15);
  r.text(item.name + ' +' + event.amount, x - width / 2 + 25, top + 11, 10, '#416b54', 'left', '600');
  c.restore();
}

module.exports = { drawSupplyStation, drawSupplyPickup };
