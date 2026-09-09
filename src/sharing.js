'use strict';

// Mini Game sharing belongs to the runtime, so page changes never rebind it.
function enableSharing(platform, config) {
  const api = platform.wx;
  if (platform.kind !== 'wechat' || !api) return;

  const title = config.GAME_NAME + '｜和三拍后的回声一起送信';
  function shareContent() {
    const covers = config.SHARE_COVER_URLS;
    return { title, imageUrl: covers[Math.floor(Math.random() * covers.length)] };
  }
  function register(name, listener) {
    if (typeof api[name] !== 'function') return false;
    try { api[name](listener); return true; }
    catch (error) { console.warn('注册微信分享失败：' + name, error); return false; }
  }

  register('onShareAppMessage', () => ({ ...shareContent(), toCurrentGroup: false }));
  const timeline = register('onShareTimeline', () => {
    const content = shareContent();
    return { ...content, imagePreviewUrl: content.imageUrl };
  });

  if (typeof api.showShareMenu !== 'function') return;
  function showMenu(includeTimeline) {
    const fail = error => {
      // Some clients expose the API but cannot enable Moments. Keep forwarding available.
      if (includeTimeline) showMenu(false);
      else console.warn('启用微信转发菜单失败', error);
    };
    const options = { withShareTicket: false, fail };
    // Without menus, older SDKs enable the standard friend / group forwarding entry.
    if (includeTimeline) options.menus = ['shareAppMessage', 'shareTimeline'];
    try { api.showShareMenu(options); } catch (error) { fail(error); }
  }
  showMenu(timeline);
}

module.exports = { enableSharing };
