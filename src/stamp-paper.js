'use strict';

const { C } = require('./theme');

const WIDTH = 106, HEIGHT = 144, PADDING = 2, SHADOW = 4;
const MAX_PAPERS = 6, MAX_BYTES = 4 * 1024 * 1024;

// The notches belong to the paper silhouette, leaving the background visible.
function stampOutline(c, x, y, w, h) {
  const notch = 1.65, inset = 10, spacing = 11;
  c.beginPath(); c.moveTo(x + 3, y);
  for (let px = x + inset; px < x + w - inset; px += spacing) {
    c.lineTo(px - notch, y); c.quadraticCurveTo(px, y + notch * 2, px + notch, y);
  }
  c.lineTo(x + w - 3, y); c.quadraticCurveTo(x + w, y, x + w, y + 3);
  for (let py = y + inset; py < y + h - inset; py += spacing) {
    c.lineTo(x + w, py - notch); c.quadraticCurveTo(x + w - notch * 2, py, x + w, py + notch);
  }
  c.lineTo(x + w, y + h - 3); c.quadraticCurveTo(x + w, y + h, x + w - 3, y + h);
  for (let px = x + w - inset; px > x + inset; px -= spacing) {
    c.lineTo(px + notch, y + h); c.quadraticCurveTo(px, y + h - notch * 2, px - notch, y + h);
  }
  c.lineTo(x + 3, y + h); c.quadraticCurveTo(x, y + h, x, y + h - 3);
  for (let py = y + h - inset; py > y + inset; py -= spacing) {
    c.lineTo(x, py + notch); c.quadraticCurveTo(x + notch * 2, py, x, py - notch);
  }
  c.lineTo(x, y + 3); c.quadraticCurveTo(x, y, x + 3, y); c.closePath();
}

function paintPaper(c, owned, next, held) {
  const paper = owned ? '#fffbed' : next ? '#fff0d5' : '#e2eade';
  const border = held ? owned ? '#86a489' : C.gold : owned ? '#b9c7a9' : next ? '#cba477' : '#b5c9b6';
  stampOutline(c, 0, SHADOW, WIDTH, HEIGHT); c.fillStyle = '#496c5120'; c.fill();
  stampOutline(c, 0, 0, WIDTH, HEIGHT); c.fillStyle = paper; c.fill(); c.strokeStyle = border; c.lineWidth = held ? 1.8 : next ? 1.3 : .8; c.stroke();
  // Offset strokes are clipped to the paper, so the perforations stay open.
  c.save();
  try {
    c.clip();
    stampOutline(c, .8, .8, WIDTH, HEIGHT); c.strokeStyle = '#fffef2dc'; c.lineWidth = .85; c.stroke();
    stampOutline(c, -.85, -.85, WIDTH, HEIGHT); c.strokeStyle = owned ? '#859b797d' : next ? '#ac874c7d' : '#87a0857d'; c.lineWidth = 1; c.stroke();
  } finally { c.restore(); }
}

function releaseSurface(r, surface) {
  if (!surface || surface === r.canvas) return;
  try { surface.width = 1; surface.height = 1; } catch (_) { /* Some lost contexts cannot be resized. */ }
}

function removePaper(r, cache, key) {
  const entry = cache.entries.get(key);
  if (!entry) return;
  cache.entries.delete(key); cache.bytes -= entry.bytes;
  releaseSurface(r, entry.surface);
}

function clearStampPaperCache(r) {
  const cache = r.stampPaperCache;
  if (!cache) return;
  for (const key of cache.entries.keys()) removePaper(r, cache, key);
  r.stampPaperCache = null;
}

function disableStampPaperCache(r) {
  clearStampPaperCache(r);
  r.stampPaperCache = { entries: new Map(), bytes: 0, disabled: true };
  return null;
}

function cachedPaper(r, rect, owned, next, held) {
  if (r.stampPaperCache && r.stampPaperCache.disabled) return null;
  if (typeof r.createSurface !== 'function' || typeof r.ctx.drawImage !== 'function') return null;
  const scale = r.scale === undefined ? 1 : r.scale, ratio = r.pixelRatio === undefined ? 1 : r.pixelRatio;
  const sx = rect.w / WIDTH * scale * ratio, sy = rect.h / HEIGHT * scale * ratio;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return null;
  const width = Math.ceil((WIDTH + PADDING * 2) * sx), height = Math.ceil((HEIGHT + SHADOW + PADDING * 2) * sy);
  const bytes = width * height * 4;
  if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES) return null;
  const cap = ['butt', 'round', 'square'].includes(r.ctx.lineCap) ? r.ctx.lineCap : 'butt';
  const join = ['round', 'bevel', 'miter'].includes(r.ctx.lineJoin) ? r.ctx.lineJoin : 'miter';
  const miter = Number.isFinite(r.ctx.miterLimit) && r.ctx.miterLimit > 0 ? r.ctx.miterLimit : 10;
  const key = [rect.w, rect.h, scale, ratio, !!owned, !!next, !!held, cap, join, miter].join('|');
  const cache = r.stampPaperCache || (r.stampPaperCache = { entries: new Map(), bytes: 0 });
  const found = cache.entries.get(key);
  if (found) {
    cache.entries.delete(key); cache.entries.set(key, found);
    return found;
  }
  // Release before allocating, so even the construction peak stays bounded.
  while (cache.entries.size >= MAX_PAPERS || cache.bytes + bytes > MAX_BYTES) {
    removePaper(r, cache, cache.entries.keys().next().value);
  }
  let surface = null, safeToResize = false;
  try {
    surface = r.createSurface();
    if (!surface || surface === r.canvas || typeof surface.getContext !== 'function' ||
        [...cache.entries.values()].some(entry => entry.surface === surface)) return disableStampPaperCache(r);
    const c = surface.getContext('2d');
    if (!c || c === r.ctx || r.canvas && c.canvas === r.canvas) return disableStampPaperCache(r);
    safeToResize = true;
    surface.width = width; surface.height = height;
    if (surface.width !== width || surface.height !== height) throw new Error('stamp surface size unavailable');
    c.save();
    try {
      c.setTransform(sx, 0, 0, sy, PADDING * sx, PADDING * sy);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.lineCap = cap; c.lineJoin = join; c.miterLimit = miter;
      paintPaper(c, owned, next, held);
    } finally { c.restore(); }
    const entry = { key, surface, bytes, w: width / sx, h: height / sy };
    cache.entries.set(key, entry); cache.bytes += bytes;
    return entry;
  } catch (_) {
    if (safeToResize) releaseSurface(r, surface);
    return disableStampPaperCache(r);
  }
}

// Called inside the stamp's existing local 106 × 144 transform. The cache
// contains only paper; all illustrations, labels and animations remain live.
function drawStampPaper(r, rect, owned, next = false, held = false) {
  const entry = cachedPaper(r, rect, owned, next, held);
  if (entry) {
    try {
      r.ctx.drawImage(entry.surface, -PADDING, -PADDING, entry.w, entry.h);
      return;
    } catch (_) { disableStampPaperCache(r); }
  }
  paintPaper(r.ctx, owned, next, held);
}

module.exports = { drawStampPaper, clearStampPaperCache };
