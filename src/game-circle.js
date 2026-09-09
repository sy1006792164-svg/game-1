'use strict';

function isAvailable(platform) {
  if (platform.kind !== 'wechat') return false;
  try {
    const account = platform.wx.getAccountInfoSync();
    return !!account && !!account.miniProgram && ['develop', 'trial'].includes(account.miniProgram.envVersion);
  } catch (_) { return false; }
}

function createGameCircle(platform, openlink, notify) {
  const api = platform.wx;
  const available = isAvailable(platform);
  let manager = null;
  let opening = false;

  async function open() {
    if (!available || opening) return;
    if (!api || typeof api.createPageManager !== 'function') {
      notify('当前微信版本不支持游戏圈，请更新微信');
      return;
    }

    opening = true;
    try {
      if (!manager) manager = api.createPageManager();
      // show({ openlink }) loads the destination automatically and returns a Promise.
      await manager.show({ openlink });
    } catch (error) {
      console.warn('打开微信游戏圈失败', error);
      notify('游戏圈暂时无法打开，请稍后再试');
    } finally {
      opening = false;
    }
  }

  return Object.freeze({ available, open });
}

module.exports = { createGameCircle };
