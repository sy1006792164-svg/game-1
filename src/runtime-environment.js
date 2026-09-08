'use strict';

// Only a positive runtime identification enables developer features. Debug
// settings, query parameters and saved values cannot turn a release into dev.
function isDevelopmentEnvironment(api, location) {
  if (api) {
    try {
      const account = api.getAccountInfoSync();
      return !!account && !!account.miniProgram && account.miniProgram.envVersion === 'develop';
    } catch (_) { return false; }
  }
  return !!location && ['http:', 'https:'].includes(location.protocol) &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
}

module.exports = { isDevelopmentEnvironment };
