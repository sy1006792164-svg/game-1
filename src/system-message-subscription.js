'use strict';

const SYSTEM_MESSAGE_TYPES = Object.freeze({
  INTERACTIVE: 'SYS_MSG_TYPE_INTERACTIVE',
  RANK: 'SYS_MSG_TYPE_RANK',
  WHATS_NEW: 'SYS_MSG_TYPE_WHATS_NEW',
});

const VALID_MESSAGE_TYPES = new Set(Object.values(SYSTEM_MESSAGE_TYPES));
const VALID_DECISIONS = new Set(['accept', 'reject', 'ban']);
const ERROR_MESSAGES = Object.freeze({
  10001: '订阅消息类型不能为空',
  10002: '网络异常，获取订阅消息列表失败，请稍后重试',
  10003: '网络异常，订阅请求发送失败，请稍后重试',
  10004: '订阅消息类型无效',
  10005: '暂时无法展示订阅界面，请保持游戏在前台后重试',
  20004: '微信订阅消息总开关已关闭，请在小游戏设置中开启',
  20005: '当前小游戏已被暂停订阅消息能力',
});

function normalizeMessageTypes(messageTypes) {
  const source = messageTypes === undefined ? [SYSTEM_MESSAGE_TYPES.RANK] : messageTypes;
  if (!Array.isArray(source)) throw new TypeError('messageTypes must be an array');
  if (source.length === 0 || source.length > 3) throw new RangeError('messageTypes must contain between 1 and 3 values');

  const seen = new Set();
  const normalized = source.map(function (messageType) {
    if (typeof messageType !== 'string' || !VALID_MESSAGE_TYPES.has(messageType)) {
      throw new TypeError('messageTypes contains an unsupported system message type');
    }
    if (seen.has(messageType)) throw new RangeError('messageTypes must not contain duplicates');
    seen.add(messageType);
    return messageType;
  });
  return Object.freeze(normalized);
}

function errorCodeOf(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  const code = Number(error.errCode);
  return Number.isInteger(code) ? code : null;
}

function createSystemMessageSubscription(platform, messageTypes) {
  const types = normalizeMessageTypes(messageTypes);
  // Never fall back to a global wx object: browser previews and other channels
  // must not accidentally open a native consent surface.
  const api = platform && platform.kind === 'wechat' ? platform.wx : null;
  const supported = !!(api && typeof api.requestSubscribeSystemMessage === 'function');
  let revision = 0;
  let refreshFlight = null;
  let requestFlight = null;
  let state = {
    status: supported ? 'idle' : 'unavailable',
    message: supported ? '尚未设置订阅消息提醒' :
      (api ? '当前微信版本暂不支持系统订阅消息，请更新微信后重试' : '请在微信小游戏中开启订阅消息'),
    mainSwitch: null,
    itemSettings: {},
    errorCode: null,
  };

  function getState() {
    return {
      status: state.status,
      message: state.message,
      mainSwitch: state.mainSwitch,
      itemSettings: Object.assign({}, state.itemSettings),
      errorCode: state.errorCode,
      messageTypes: types.slice(),
    };
  }

  function setState(status, message, details) {
    const update = details || {};
    state = {
      status,
      message,
      mainSwitch: Object.prototype.hasOwnProperty.call(update, 'mainSwitch') ? update.mainSwitch : state.mainSwitch,
      itemSettings: Object.prototype.hasOwnProperty.call(update, 'itemSettings') ?
        Object.assign({}, update.itemSettings) : Object.assign({}, state.itemSettings),
      errorCode: Object.prototype.hasOwnProperty.call(update, 'errorCode') ? update.errorCode : null,
    };
    return getState();
  }

  function pickItemSettings(itemSettings) {
    const source = itemSettings && typeof itemSettings === 'object' && !Array.isArray(itemSettings) ? itemSettings : {};
    const picked = {};
    types.forEach(function (messageType) {
      if (VALID_DECISIONS.has(source[messageType])) picked[messageType] = source[messageType];
    });
    return picked;
  }

  function outcomeOf(itemSettings, mainSwitch, requireComplete) {
    if (mainSwitch === false) return 'disabled';
    const decisions = types.map(function (messageType) { return itemSettings[messageType]; });
    if (decisions.includes('ban')) return 'banned';
    if (decisions.includes('reject')) return 'rejected';
    if (decisions.every(function (decision) { return decision === 'accept'; })) return 'accepted';
    return requireComplete ? 'error' : 'idle';
  }

  function messageFor(status) {
    if (status === 'accepted') return '订阅消息提醒已开启';
    if (status === 'rejected') return '你暂未同意订阅消息，可稍后重试';
    if (status === 'banned') return '当前订阅消息已被封禁，暂时无法开启';
    if (status === 'disabled') return ERROR_MESSAGES[20004];
    if (status === 'error') return '未能确认订阅结果，请稍后重试';
    return '尚未保存订阅选择，可点击开启提醒';
  }

  function callNative(method, options) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(result);
      }
      const nativeOptions = Object.assign({}, options, {
        success: function (result) { finish(null, result); },
        fail: function (error) { finish(error || new Error('REQUEST_FAILED')); },
      });
      try {
        const returned = method.call(api, nativeOptions);
        if (returned && typeof returned.then === 'function') {
          returned.then(function (result) { finish(null, result); }, function (error) { finish(error || new Error('REQUEST_FAILED')); });
        }
      } catch (error) {
        finish(error || new Error('REQUEST_FAILED'));
      }
    });
  }

  function setFailure(error, fallbackMessage) {
    const errorCode = errorCodeOf(error);
    const status = errorCode === 20004 ? 'disabled' : errorCode === 20005 ? 'banned' : 'error';
    return setState(status, ERROR_MESSAGES[errorCode] || fallbackMessage, {
      mainSwitch: errorCode === 20004 ? false : state.mainSwitch,
      errorCode,
    });
  }

  function refresh() {
    if (!supported) return Promise.resolve(getState());
    // A settings read must never compete with or overwrite an explicit user
    // request. The request result is the fresher authority.
    if (requestFlight) return requestFlight;
    if (refreshFlight) return refreshFlight;
    const acceptedSnapshot = state.status === 'accepted' ? getState() : null;
    if (typeof api.getSetting !== 'function') {
      if (acceptedSnapshot) return Promise.resolve(acceptedSnapshot);
      return Promise.resolve(setState('error', '当前微信版本无法读取订阅状态，可点击开启提醒重试', { errorCode: null }));
    }

    const token = ++revision;
    setState('checking', '正在检查订阅消息状态…');
    let tracked;
    tracked = callNative(api.getSetting, { withSubscriptions: true }).then(function (result) {
      if (revision !== token) return getState();
      const subscriptions = result && result.subscriptionsSetting;
      const mainSwitch = subscriptions && typeof subscriptions === 'object' && typeof subscriptions.mainSwitch === 'boolean' ?
        subscriptions.mainSwitch : null;
      const itemSettings = pickItemSettings(subscriptions && subscriptions.itemSettings);
      const status = outcomeOf(itemSettings, mainSwitch, false);
      // getSetting omits choices for which the user did not select “always”.
      // That absence (or an unrecognized value) is not evidence that a known
      // accepted subscription was revoked. Only explicit switch/reject/ban
      // results may downgrade it.
      if (status === 'idle' && acceptedSnapshot) {
        return setState('accepted', acceptedSnapshot.message, {
          mainSwitch: mainSwitch === true ? true : acceptedSnapshot.mainSwitch,
          itemSettings: acceptedSnapshot.itemSettings,
          errorCode: null,
        });
      }
      return setState(status, messageFor(status), { mainSwitch, itemSettings, errorCode: null });
    }, function (error) {
      if (revision !== token) return getState();
      if (acceptedSnapshot) {
        return setState('accepted', acceptedSnapshot.message, {
          mainSwitch: acceptedSnapshot.mainSwitch,
          itemSettings: acceptedSnapshot.itemSettings,
          errorCode: null,
        });
      }
      return setFailure(error, '订阅状态检查失败，请稍后重试');
    }).finally(function () {
      if (refreshFlight === tracked) refreshFlight = null;
    });
    refreshFlight = tracked;
    return tracked;
  }

  // This method intentionally reaches the native API before yielding to a
  // promise microtask: WeChat only permits it in the synchronous tap chain.
  function request() {
    if (!supported) return Promise.resolve(getState());
    if (requestFlight) return requestFlight;

    const token = ++revision;
    refreshFlight = null;
    setState('requesting', '正在请求订阅消息…');
    let tracked;
    tracked = callNative(api.requestSubscribeSystemMessage, { msgTypeList: types.slice() }).then(function (result) {
      if (revision !== token) return getState();
      const itemSettings = pickItemSettings(result);
      const status = outcomeOf(itemSettings, true, true);
      return setState(status, messageFor(status), { mainSwitch: true, itemSettings, errorCode: null });
    }, function (error) {
      if (revision !== token) return getState();
      return setFailure(error, '订阅消息请求失败，请稍后重试');
    }).finally(function () {
      if (requestFlight === tracked) requestFlight = null;
    });
    requestFlight = tracked;
    return tracked;
  }

  return { getState, refresh, request };
}

module.exports = { SYSTEM_MESSAGE_TYPES, createSystemMessageSubscription };
