'use strict';

function isBridgeNotReady(error) {
  try {
    const text = typeof error === 'string' ? error : [error && error.errMsg, error && error.message].filter(Boolean).join(' ');
    return /jsbridge\s+(?:is\s+)?not\s+ready/i.test(text);
  } catch (_) { return false; }
}

function getWindowInfo(api) {
  let info = {};
  const modern = typeof api.getWindowInfo === 'function';
  let bridgePending = false;
  try {
    if (modern) info = api.getWindowInfo() || {};
  } catch (error) {
    // Calling another synchronous bridge API in the same startup tick only
    // repeats DevTools' "jsbridge not ready" error. A later resize retries it.
    bridgePending = isBridgeNotReady(error);
  }
  const fields = ['windowWidth', 'windowHeight', 'pixelRatio'];
  const valid = value => Number.isFinite(value) && value > 0;
  if (fields.every(key => valid(info[key]))) return info;
  let legacy = {};
  // Preserve compatibility with hosts whose modern method is stubbed,
  // unsupported or incomplete. Only an explicit transient bridge error skips
  // this call; otherwise the legacy API can fill missing required fields.
  if (!bridgePending) {
    try {
      if (typeof api.getSystemInfoSync === 'function') legacy = api.getSystemInfoSync() || {};
    } catch (_) { /* Use defaults until a later resize can retry. */ }
  }
  const merged = {};
  // Recent SDKs expose lazy getters on the legacy system-info object. Copying
  // the entire object also invokes unrelated orientation/authorization APIs.
  // Recover only missing layout fields, without touching those native getters.
  fields.concat(['screenTop', 'statusBarHeight', 'safeArea']).forEach(key => {
    let current, fallback;
    try { current = info[key]; } catch (_) { /* Recover this one field below. */ }
    const missing = fields.includes(key) ? !valid(current) : current == null;
    if (missing) {
      try { fallback = legacy[key]; } catch (_) { /* An optional layout field may be unavailable. */ }
    }
    if (missing && fallback != null && (!fields.includes(key) || valid(fallback))) merged[key] = fallback;
    else if (current !== undefined) merged[key] = current;
  });
  return merged;
}

function getDeviceInfo(api) {
  const modern = typeof api.getDeviceInfo === 'function';
  try {
    const device = modern && api.getDeviceInfo();
    if (device && device.platform) return device;
  } catch (error) {
    // Do not turn a transient failure of the maintained API into a second
    // deprecated bridge call. A later resize/onShow retries the modern API.
    if (isBridgeNotReady(error)) return {};
  }
  try { return api.getSystemInfoSync() || {}; } catch (_) { return {}; }
}

function isDesktop(device) {
  return !!device && ['windows', 'mac', 'ohos_pc'].includes(device.platform);
}

function getSafeInsets(api, info, device, height) {
  // Desktop WeChat hosts its title/menu bar outside the game's client canvas.
  // DevTools still emulates phone safe areas and must not take this branch.
  if (isDesktop(device)) return { safeTop: 0, safeBottom: 0 };

  const screenTop = Math.max(0, Number(info.screenTop) || 0);
  const safeArea = info.safeArea || {};
  const statusBottom = Math.max(0, Number(info.statusBarHeight) || 0, Number(safeArea.top) || 0);
  let safeTop = Math.max(0, statusBottom - screenTop), hasCapsule = false;
  try {
    const capsule = api.getMenuButtonBoundingClientRect && api.getMenuButtonBoundingClientRect();
    if (capsule && Number.isFinite(capsule.bottom) && capsule.bottom > 0 && capsule.bottom <= screenTop + height) {
      // WeChat returns screen coordinates; reserve only the overlap with the window.
      if (capsule.bottom > screenTop) safeTop = Math.max(safeTop, capsule.bottom - screenTop + 8);
      hasCapsule = true;
    }
  } catch (_) { /* Some phone runtimes do not expose capsule geometry. */ }
  if (!hasCapsule) safeTop = Math.max(0, statusBottom + 52 - screenTop);
  const safeBottom = Number.isFinite(safeArea.bottom) ? Math.max(0, screenTop + height - safeArea.bottom) : 0;
  return { safeTop: Math.min(height / 3, safeTop), safeBottom: Math.min(height / 3, safeBottom) };
}

module.exports = { getWindowInfo, getDeviceInfo, getSafeInsets, isDesktop };
