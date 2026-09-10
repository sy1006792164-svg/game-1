'use strict';

const MIN_ZOOM = .65, MAX_ZOOM = 1.6, INTRO_MS = 850;
const SHAKE_MS = 260;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// A fixed isometric view with an entrance, desktop zoom/pan and brief impacts.
class SceneCamera {
  constructor() { this.reset(); }

  reset() { this.zoom = 1; this.panX = 0; this.panY = 0; this.enteredAt = -Infinity; this.stopShake(); }

  enter(now) { this.reset(); this.enteredAt = now; }

  shake(now, strength = 1) {
    if (!Number.isFinite(now) || !Number.isFinite(strength)) return;
    this.shakeAt = now; this.shakeStrength = clamp(strength, 0, 1);
  }

  stopShake() { this.shakeAt = -Infinity; this.shakeStrength = 0; }

  frame(now) {
    const progress = clamp((now - this.enteredAt) / INTRO_MS, 0, 1);
    const entrance = .36 + .64 * (1 - Math.pow(1 - progress, 3));
    const age = now - this.shakeAt;
    const phase = age >= 0 && age < SHAKE_MS ? age / SHAKE_MS : 1;
    const impact = this.shakeStrength * (1 - phase) ** 2;
    // Apply the offset to the rendered view so drawing and hit projection agree.
    // Keep the user's camera position intact; impacts never accumulate into drift.
    return { scale: this.zoom * entrance,
      panX: this.panX + Math.sin(phase * Math.PI * 5) * .012 * impact,
      panY: this.panY + Math.sin(phase * Math.PI * 7) * .0045 * impact };
  }

  limit(zoom = this.zoom) { return Math.max(0, (zoom - 1) / 2); }

  // Coordinates are fractions of the viewport, relative to its center.
  zoomAt(factor, x = 0, y = 0) {
    if (![factor, x, y].every(Number.isFinite) || factor <= 0) return;
    this.stopShake();
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM), ratio = next / this.zoom, limit = this.limit(next);
    this.panX = clamp(x + (this.panX - x) * ratio, -limit, limit);
    this.panY = clamp(y + (this.panY - y) * ratio, -limit, limit);
    this.zoom = next;
  }

  pan(dx, dy) {
    if (![dx, dy].every(Number.isFinite)) return;
    this.stopShake();
    const limit = this.limit();
    this.panX = clamp(this.panX + dx, -limit, limit);
    this.panY = clamp(this.panY + dy, -limit, limit);
  }
}

module.exports = { SceneCamera, MIN_ZOOM, MAX_ZOOM, INTRO_MS, SHAKE_MS };
