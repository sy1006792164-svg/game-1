'use strict';

const FEATURED_VIGNETTE = Object.freeze({ x: 13, w: 364 });
const VIGNETTE_SOURCE = Object.freeze({ w: 360, h: 300 });

function startupLayout(height) {
  const contentHeight = Math.min(height, 840), top = (height - contentHeight) / 2;
  const loadingY = top + contentHeight - 88, adviceH = 164;
  const adviceY = loadingY - 18 - adviceH;
  const heroY = top + 116, heroH = Math.min(380, adviceY - heroY - 20);
  return { top, heroY, heroH, adviceY, adviceH, loadingY };
}

function featuredVignetteRect(y, h) {
  return { x: FEATURED_VIGNETTE.x, y, w: FEATURED_VIGNETTE.w, h };
}

function startupVignetteScale(height) {
  const layout = startupLayout(height);
  return Math.min(FEATURED_VIGNETTE.w / VIGNETTE_SOURCE.w, layout.heroH / VIGNETTE_SOURCE.h);
}

module.exports = { FEATURED_VIGNETTE, VIGNETTE_SOURCE, startupLayout,
  featuredVignetteRect, startupVignetteScale };
