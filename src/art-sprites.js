'use strict';

function drawArtSprite(r, id, x, y, width, height, anchorY = 1) {
  const sprite = r.artAssets && r.artAssets.get(id);
  if (!sprite) return false;
  const [sx, sy, sw, sh] = sprite.rect;
  const h = height === undefined ? width * sh / sw : height;
  r.ctx.drawImage(sprite.image, sx, sy, sw, sh, x - width / 2, y - h * anchorY, width, h);
  return true;
}

function drawArtCourier(r, x, y, size, ghost, pose) {
  if (!r.artAssets || !r.artAssets.ready) return false;
  const c = r.ctx, quiet = r.reducedMotion;
  const suffix = pose.celebrating ? 'Win' : !quiet && pose.moving ? pose.stride > 0 ? 'WalkA' : 'WalkB' : '';
  c.save(); c.translate(x, y);
  c.globalAlpha *= pose.alpha == null ? 1 : pose.alpha;
  c.scale(pose.facing === -1 ? -1 : 1, 1);
  c.translate(0, size * .42); c.rotate(quiet ? 0 : pose.lean || 0);
  c.scale(quiet ? 1 : pose.squash || 1, quiet ? 1 : pose.stretch || 1);
  drawArtSprite(r, (ghost ? 'echo' : 'courier') + suffix, 0, 0, size * (ghost ? 1.3 : 1.12), size * 1.48);
  c.restore();
  return true;
}

// Surface geometry stays mathematical, so texture never changes legal targets.
function drawPaving(r, x, y, halfW, halfH) {
  if (!r.artAssets || !r.artAssets.ready) return;
  const c = r.ctx;
  c.save(); c.beginPath(); c.moveTo(x, y - halfH); c.lineTo(x + halfW, y);
  c.lineTo(x, y + halfH); c.lineTo(x - halfW, y); c.closePath(); c.clip();
  c.globalAlpha *= .32;
  drawArtSprite(r, 'paving', x, y + halfH * 1.15, halfW * 2.5, halfH * 2.7);
  c.restore();
}

module.exports = { drawArtSprite, drawArtCourier, drawPaving };
