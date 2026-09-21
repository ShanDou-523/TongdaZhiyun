const config = require('../config');
const { createDemo } = require('./runtime');
module.exports = createDemo({
  canUse() {
    if (config.demoEnabled !== true || typeof wx.getAccountInfoSync !== 'function') return false;
    const version = wx.getAccountInfoSync().miniProgram.envVersion;
    return version === 'develop' || version === 'trial';
  },
  storage: {
    get: key => wx.getStorageSync(key),
    set: (key, value) => wx.setStorageSync(key, value),
    remove: key => wx.removeStorageSync(key)
  }
});
