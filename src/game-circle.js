'use strict';

function createGameCircle(platform, openlink, notify) {
  const api = platform.wx;
  let manager = null;
  let opening = false;

  async function open() {
    if (opening) return;
    if (platform.kind !== 'wechat') {
      notify('请在微信内打开游戏圈');
      return;
    }
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

  return { open };
}

module.exports = { createGameCircle };
