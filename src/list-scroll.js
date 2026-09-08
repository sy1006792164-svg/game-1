'use strict';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SAMPLE_MS = 100, FRICTION = 2.8, MAX_VELOCITY = 4800;

class ListScroll {
  constructor() { this.max = 0; this.reset(0); }
  reset(now) {
    this.offset = 0; this.velocity = 0; this.touching = false; this.dragged = false;
    this.samples = []; this.wheelTarget = null; this.interrupted = false;
    this.lastTick = now; this.activeAt = -Infinity; this.enteredAt = now;
    this.revealed = new Map(); this.tapped = null;
  }
  setBounds(max) {
    max = Math.max(0, max);
    if (this.max !== max) { this.max = max; this.stop(); }
  }
  stop() { this.touching = false; this.velocity = 0; this.wheelTarget = null; this.offset = clamp(this.offset, 0, this.max); }
  begin(y, now) {
    this.update(now);
    this.interrupted = Math.abs(this.velocity) > 4 || this.wheelTarget !== null || this.offset < 0 || this.offset > this.max;
    this.wheelTarget = null; this.samples = [{ y, at: now }];
    this.velocity = 0; this.touching = true; this.dragged = false;
    this.startY = this.lastY = y; this.lastMove = this.lastTick = this.activeAt = now;
  }
  move(y, now, sideways = false) {
    if (!this.touching) return;
    const delta = this.lastY - y, wasDragged = this.dragged;
    // Average a short gesture window so a tiny final touch sample cannot erase a flick.
    // A deliberate reversal starts a new window, allowing the next flick to change direction.
    if (Math.abs(delta) > 2 && delta * this.velocity < 0) this.samples = [{ y: this.lastY, at: this.lastMove }];
    this.samples.push({ y, at: now });
    const cutoff = now - SAMPLE_MS;
    while (this.samples.length > 2 && this.samples[1].at <= cutoff) this.samples.shift();
    this.dragged = this.dragged || Math.abs(y - this.startY) > 6 || sideways;
    if (!this.dragged) { this.lastY = y; this.lastMove = now; return; }
    const first = this.samples[0], second = this.samples[1];
    const start = Math.max(first.at, cutoff);
    const startY = second && first.at < start && second.at > first.at ?
      first.y + (second.y - first.y) * (start - first.at) / (second.at - first.at) : first.y;
    this.velocity = clamp((startY - y) * 1000 / Math.max(8, now - start), -MAX_VELOCITY, MAX_VELOCITY);
    this.lastY = y; this.lastMove = this.activeAt = now;
    if (Math.abs(delta) < .01) return;
    const dragDelta = wasDragged ? delta : this.startY - y;
    let next = this.offset + dragDelta;
    // Resist only the new outward movement. Rescaling the entire overshoot on
    // every event makes the list jump inward while the finger is still pulling out.
    if ((this.offset < 0 && dragDelta < 0) || (this.offset > this.max && dragDelta > 0)) next = this.offset + dragDelta * .36;
    else if (next < 0 && this.offset >= 0) next *= .36;
    else if (next > this.max && this.offset <= this.max) next = this.max + (next - this.max) * .36;
    this.offset = clamp(next, -64, this.max + 64);
  }
  end(now) {
    const scrolled = this.dragged || this.interrupted;
    if (now - this.lastMove > 90 || !this.dragged || Math.abs(this.velocity) < 40) this.velocity = 0;
    this.touching = false; this.lastTick = this.activeAt = now;
    return scrolled;
  }
  wheel(delta, now) {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.update(now);
    this.touching = false; this.velocity = 0;
    // Accumulate the entire input, including page-sized deltas, then ease toward it.
    // Reversing the wheel discards the old destination instead of continuing the wrong way.
    const target = this.wheelTarget !== null && (this.wheelTarget - this.offset) * delta > 0 ? this.wheelTarget : this.offset;
    this.wheelTarget = clamp(target + delta, 0, this.max);
    this.activeAt = now;
  }
  update(now) {
    let elapsed = Math.max(0, Math.min(64, now - this.lastTick));
    this.lastTick = now;
    if (this.touching) return;
    if (this.wheelTarget !== null) {
      this.offset += (this.wheelTarget - this.offset) * (1 - Math.exp(-16 * elapsed / 1000));
      if (Math.abs(this.wheelTarget - this.offset) < .4) { this.offset = this.wheelTarget; this.wheelTarget = null; }
      return;
    }
    while (elapsed > 0) {
      const ms = Math.min(16, elapsed), dt = ms / 1000;
      const target = clamp(this.offset, 0, this.max);
      if (this.offset !== target) {
        this.velocity += ((target - this.offset) * 190 - this.velocity * 26) * dt;
        this.offset = clamp(this.offset + this.velocity * dt, -64, this.max + 64);
      }
      else {
        const decay = Math.exp(-FRICTION * dt);
        this.offset = clamp(this.offset + this.velocity * (1 - decay) / FRICTION, -64, this.max + 64);
        this.velocity *= decay;
      }
      if (Math.abs(this.velocity) < 4 && Math.abs(this.offset - clamp(this.offset, 0, this.max)) < .4) this.stop();
      elapsed -= ms;
    }
  }
}

module.exports = { ListScroll };
