'use strict';

function getCanvasPixelRatio(pixelRatio, desktop) {
  const requested = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  // Supersample fine vector paths on low-DPI desktop windows. Phones retain
  // their native density; neither platform has a DPR or backing-size ceiling.
  return desktop ? Math.max(2, requested) : requested;
}

function resizeCanvas(canvas, width, height, pixelRatio) {
  const backingWidth = Math.max(1, Math.floor(width * pixelRatio));
  const backingHeight = Math.max(1, Math.floor(height * pixelRatio));
  const changed = canvas.width !== backingWidth || canvas.height !== backingHeight;
  // Shrink first; assigning an unchanged size also clears pixels and reallocates storage.
  if (canvas.width > backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  return changed;
}

module.exports = { getCanvasPixelRatio, resizeCanvas };
