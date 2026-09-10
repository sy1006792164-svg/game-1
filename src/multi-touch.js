'use strict';

// Ignore multi-touch until every finger lifts, so releasing it cannot become a tap.
function createMultiTouchGuard(cancelPointer) {
  const contacts = new Set();
  let blocked = false;

  function reset() {
    contacts.clear(); blocked = false;
  }
  function update() {
    const wasBlocked = blocked;
    if (contacts.size >= 2) {
      if (!blocked) { cancelPointer(); blocked = true; }
    } else if (!contacts.size) blocked = false;
    return wasBlocked || blocked;
  }
  return {
    reset,
    isActive: function () { return blocked; },
    touch: function (type, event) {
      if (type !== 'start' && !contacts.size && !blocked) return false;
      const changed = Array.from((event && event.changedTouches) || []);
      if (event && event.touches != null) {
        contacts.clear();
        Array.from(event.touches).forEach(function (touch) { contacts.add(touch.identifier == null ? 0 : touch.identifier); });
      } else if (type === 'cancel' && !changed.length) contacts.clear();
      else changed.forEach(function (touch) {
        const id = touch.identifier == null ? 0 : touch.identifier;
        if (type === 'end' || type === 'cancel') contacts.delete(id);
        else contacts.add(id);
      });
      return update();
    },
    pointer: function (type, event) {
      if (type === 'cancel' && event.pointerId == null) contacts.clear();
      else if (type === 'end' || type === 'cancel') contacts.delete(event.pointerId);
      else if (type === 'start') contacts.add(event.pointerId);
      return update();
    },
  };
}

module.exports = { createMultiTouchGuard };
