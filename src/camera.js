'use strict';

const MIN_ZOOM = .65, MAX_ZOOM = 1.6, INTRO_MS = 850;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

class SceneCamera {
  constructor() { this.reset(); }

  reset() {
    this.zoom = 1; this.rotation = 0; this.tilt = .62;
    this.panX = 0; this.panY = 0; this.enteredAt = -Infinity;
  }

  enter(now) { this.reset(); this.enteredAt = now; }

  frame(now, reducedMotion = false) {
    const progress = reducedMotion ? 1 : clamp((now - this.enteredAt) / INTRO_MS, 0, 1);
    const entrance = .36 + .64 * (1 - Math.pow(1 - progress, 3));
    return { scale: this.zoom * entrance, panX: this.panX, panY: this.panY, rotation: this.rotation, tilt: this.tilt };
  }

  // Coordinates are fractions of the viewport, relative to its center.
  zoomAt(factor, x = 0, y = 0, dx = 0, dy = 0) {
    if (![factor, x, y, dx, dy].every(Number.isFinite) || factor <= 0) return;
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM), ratio = next / this.zoom;
    const limit = Math.max(0, (next - 1) / 2);
    this.panX = clamp(x + (this.panX - x) * ratio + dx, -limit, limit);
    this.panY = clamp(y + (this.panY - y) * ratio + dy, -limit, limit);
    this.zoom = next;
  }

  orbit(dx, dy) {
    if (![dx, dy].every(Number.isFinite)) return;
    this.rotation = (this.rotation + dx * Math.PI) % (Math.PI * 2);
    this.tilt = clamp(this.tilt - dy * 1.3, .38, 1);
  }
}

module.exports = { SceneCamera, MIN_ZOOM, MAX_ZOOM, INTRO_MS };
