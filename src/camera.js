'use strict';

const MIN_ZOOM = .65, MAX_ZOOM = 1.6, INTRO_MS = 850;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// A fixed isometric view: the island grows in on entry, then only zooms and pans.
class SceneCamera {
  constructor() { this.reset(); }

  reset() { this.zoom = 1; this.panX = 0; this.panY = 0; this.enteredAt = -Infinity; }

  enter(now) { this.reset(); this.enteredAt = now; }

  frame(now) {
    const progress = clamp((now - this.enteredAt) / INTRO_MS, 0, 1);
    const entrance = .36 + .64 * (1 - Math.pow(1 - progress, 3));
    return { scale: this.zoom * entrance, panX: this.panX, panY: this.panY };
  }

  limit(zoom = this.zoom) { return Math.max(0, (zoom - 1) / 2); }

  // Coordinates are fractions of the viewport, relative to its center.
  zoomAt(factor, x = 0, y = 0, dx = 0, dy = 0) {
    if (![factor, x, y, dx, dy].every(Number.isFinite) || factor <= 0) return;
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM), ratio = next / this.zoom, limit = this.limit(next);
    this.panX = clamp(x + (this.panX - x) * ratio + dx, -limit, limit);
    this.panY = clamp(y + (this.panY - y) * ratio + dy, -limit, limit);
    this.zoom = next;
  }

  pan(dx, dy) {
    if (![dx, dy].every(Number.isFinite)) return;
    const limit = this.limit();
    this.panX = clamp(this.panX + dx, -limit, limit);
    this.panY = clamp(this.panY + dy, -limit, limit);
  }
}

module.exports = { SceneCamera, MIN_ZOOM, MAX_ZOOM, INTRO_MS };
