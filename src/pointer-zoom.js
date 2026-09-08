'use strict';

// A pinch owns every remaining finger until the complete gesture is released.
function createPinchGesture(cancelPointer, onZoom) {
  const contacts = new Map();
  let blocked = false;
  let previous = null;

  function reset() {
    contacts.clear(); blocked = false; previous = null;
  }
  function update(emit) {
    const wasBlocked = blocked;
    if (contacts.size >= 2) {
      if (!blocked) { cancelPointer(); blocked = true; }
      const ids = previous && previous.ids.every(function (id) { return contacts.has(id); })
        ? previous.ids : Array.from(contacts.keys()).slice(0, 2);
      const a = contacts.get(ids[0]), b = contacts.get(ids[1]);
      const next = { ids, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) };
      if (emit && previous && previous.ids[0] === ids[0] && previous.ids[1] === ids[1]) {
        const factor = previous.distance > 0 && next.distance > 0 ? next.distance / previous.distance : 1;
        const dx = next.x - previous.x, dy = next.y - previous.y;
        if (factor !== 1 || dx !== 0 || dy !== 0) onZoom(next.x, next.y, factor, { dx, dy });
      }
      previous = next;
    } else {
      previous = null;
      if (!contacts.size) blocked = false;
    }
    return wasBlocked || blocked;
  }
  function touchPoint(touch) {
    return {
      x: Number.isFinite(touch.clientX) ? touch.clientX : touch.x,
      y: Number.isFinite(touch.clientY) ? touch.clientY : touch.y,
    };
  }
  function setContact(id, point) {
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) contacts.set(id, point);
  }
  return {
    reset,
    isActive: function () { return blocked; },
    touch: function (type, event) {
      if (type !== 'start' && !contacts.size && !blocked) return false;
      const changed = Array.from((event && event.changedTouches) || []);
      if (event && event.touches != null) {
        contacts.clear();
        Array.from(event.touches).forEach(function (touch) { setContact(touch.identifier == null ? 0 : touch.identifier, touchPoint(touch)); });
      } else if (type === 'cancel' && !changed.length) contacts.clear();
      else changed.forEach(function (touch) {
        const id = touch.identifier == null ? 0 : touch.identifier;
        if (type === 'end' || type === 'cancel') contacts.delete(id);
        else setContact(id, touchPoint(touch));
      });
      return update(type === 'move');
    },
    pointer: function (type, event, point) {
      if (type === 'cancel' && event.pointerId == null) contacts.clear();
      else if (type === 'end' || type === 'cancel') contacts.delete(event.pointerId);
      else if (type === 'start' || contacts.has(event.pointerId)) setContact(event.pointerId, point);
      return update(type === 'move');
    },
  };
}

module.exports = { createPinchGesture };
