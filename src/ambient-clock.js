'use strict';

// Decorative time advances only while visible and active. Gameplay continues
// to use the platform clock for actions, feedback, loading and input deadlines.
class AmbientClock {
  constructor() { this.time = null; this.last = null; this.paused = false; }

  sample(now, paused = false) {
    if (!Number.isFinite(now)) return this.time == null ? 0 : this.time;
    if (this.time == null) this.time = now;
    else if (!this.paused && !paused) this.time += Math.max(0, now - this.last);
    this.last = now;
    this.paused = paused;
    return this.time;
  }
}

module.exports = { AmbientClock };
