'use strict';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ease = t => 1 - Math.pow(1 - t, 3);

// Standalone: the open-data context cannot import scripts from the main domain.
function createRankMotion() {
  let layout = { listTop: 0, listHeight: 0, stride: 1, rowHeight: 1 }, count = 0, max = 0;
  let offset = 0, velocity = 0, tick = 0, touch = null, wheelTarget = null;
  let animation = null, manual = false, settled = false;
  const targetFor = index => clamp(index * layout.stride - (layout.listHeight - layout.rowHeight) / 2, 0, max);
  function stop() { animation = null; velocity = 0; wheelTarget = null; touch = null; offset = clamp(offset, 0, max); }
  function reset(now = 0) { stop(); offset = 0; tick = now; manual = false; settled = false; }
  function setLayout(next, rowCount, now = tick) {
    const changed = Object.keys(layout).some(key => layout[key] !== next[key]) || count !== rowCount;
    layout = { ...next, stride: Math.max(1, next.stride) }; count = Math.max(0, rowCount);
    max = Math.max(0, (count - 1) * layout.stride + layout.rowHeight - layout.listHeight);
    if (changed) { stop(); tick = now; }
  }
  function frame(now = tick) {
    let ms = clamp(now - tick, 0, 64); tick = now;
    let rankMotion = null;
    if (animation) {
      const a = animation, progress = clamp((now - a.at) / a.duration, 0, 1);
      const travel = ease(clamp(progress / .82, 0, 1));
      offset = a.start + (a.end - a.start) * travel;
      if (a.direction && progress < 1) {
        const landing = clamp((progress - .68) / .32, 0, 1);
        const drift = (a.direction === 'up' ? 1 : -1) * 28 * (1 - ease(progress));
        const lift = -Math.sin(progress * Math.PI) * 7;
        const rowY = clamp(layout.listTop + a.newIndex * layout.stride - a.end + drift + lift,
          layout.listTop, Math.max(layout.listTop, layout.listTop + layout.listHeight - layout.rowHeight));
        rankMotion = { ...a, progress, landing, rowY,
          translateY: rowY - (layout.listTop + a.newIndex * layout.stride - offset) };
      }
      if (progress >= 1) { offset = a.end; animation = null; }
    } else if (!touch && wheelTarget !== null) {
      offset += (wheelTarget - offset) * (1 - Math.exp(-16 * ms / 1000));
      if (Math.abs(wheelTarget - offset) < .4) { offset = wheelTarget; wheelTarget = null; }
    } else if (!touch) {
      while (ms > 0) {
        const step = Math.min(16, ms), dt = step / 1000, bound = clamp(offset, 0, max);
        if (offset !== bound) {
          velocity += ((bound - offset) * 190 - velocity * 26) * dt;
          offset = clamp(offset + velocity * dt, -64, max + 64);
        } else {
          const decay = Math.exp(-2.8 * dt);
          offset = clamp(offset + velocity * (1 - decay) / 2.8, -64, max + 64);
          velocity *= decay;
        }
        if (Math.abs(velocity) < 4 && Math.abs(offset - clamp(offset, 0, max)) < .4) stop();
        ms -= step;
      }
    }
    return { scrollOffset: offset, rankMotion,
      active: !!(animation || touch || wheelTarget !== null || Math.abs(velocity) >= 4 || offset < 0 || offset > max) };
  }
  function locate(index, now = tick) {
    if (!Number.isInteger(index) || index < 0 || index >= count) return false;
    frame(now); stop();
    animation = { at: now, duration: 360, start: offset, end: targetFor(index), newIndex: index };
    return true;
  }
  function settle(change, now = tick) {
    if (manual || settled || !Number.isInteger(change.newIndex) || change.newIndex < 0) return false;
    if (Number.isFinite(change.count) && change.count !== count) setLayout(layout, change.count, now);
    if (change.newIndex >= count) return false;
    settled = true; frame(now); stop();
    const { fromRank, toRank, newIndex } = change;
    const changed = Number.isInteger(fromRank) && fromRank > 0 && Number.isInteger(toRank) && toRank > 0 && fromRank !== toRank;
    const end = targetFor(newIndex), oldIndex = Number.isInteger(change.oldIndex) ? change.oldIndex : newIndex;
    const distance = Math.max(layout.stride, layout.listHeight * 2);
    offset = changed ? clamp(targetFor(oldIndex), Math.max(0, end - distance), Math.min(max, end + distance)) : offset;
    animation = { at: now, duration: changed ? 1120 : 360, start: offset, end, fromRank, toRank,
      oldIndex, newIndex, direction: changed ? (toRank < fromRank ? 'up' : 'down') : null };
    return true;
  }
  function pointer(phase, x, y, now = tick) {
    if (phase === 'start') {
      if (y < layout.listTop || y > layout.listTop + layout.listHeight) return false;
      const moving = frame(now).active; stop(); manual = true;
      touch = { x, startY: y, y, at: now, dragged: false, interrupted: moving, samples: [{ y, at: now }] };
    } else if (touch && phase === 'move') {
      const t = touch, delta = t.y - y, wasDragged = t.dragged;
      if (Math.abs(delta) > 2 && delta * velocity < 0) t.samples = [{ y: t.y, at: t.at }];
      t.samples.push({ y, at: now });
      while (t.samples.length > 2 && t.samples[1].at <= now - 100) t.samples.shift();
      t.dragged = t.dragged || Math.abs(y - t.startY) > 6 || Math.abs(x - t.x) > 6;
      if (t.dragged) {
        const first = t.samples[0], second = t.samples[1], start = Math.max(first.at, now - 100);
        const startY = second && start > first.at && second.at > first.at ?
          first.y + (second.y - first.y) * (start - first.at) / (second.at - first.at) : first.y;
        velocity = clamp((startY - y) * 1000 / Math.max(8, now - start), -4800, 4800);
        const d = wasDragged ? delta : t.startY - y;
        let next = offset + d;
        if ((offset < 0 && d < 0) || (offset > max && d > 0)) next = offset + d * .36;
        else if (next < 0 && offset >= 0) next *= .36;
        else if (next > max && offset <= max) next = max + (next - max) * .36;
        offset = clamp(next, -64, max + 64);
      }
      t.y = y; t.at = now;
    } else if (touch && (phase === 'end' || phase === 'cancel')) {
      const tap = phase === 'end' && !touch.dragged && !touch.interrupted;
      if (phase === 'cancel' || now - touch.at > 90 || !touch.dragged || Math.abs(velocity) < 40) velocity = 0;
      touch = null; tick = now; return tap;
    }
    return false;
  }
  function wheel(delta, now = tick) {
    if (!Number.isFinite(delta) || delta === 0) return;
    frame(now); manual = true; animation = null; touch = null; velocity = 0;
    const base = wheelTarget !== null && (wheelTarget - offset) * delta > 0 ? wheelTarget : offset;
    wheelTarget = clamp(base + delta, 0, max);
  }
  function cancel(now = tick, manualInput = true) { frame(now); stop(); manual = manual || manualInput; tick = now; }
  return { setLayout, enter: reset, settle, pointer, wheel, locate, frame, cancel, reset };
}

module.exports = { createRankMotion };
