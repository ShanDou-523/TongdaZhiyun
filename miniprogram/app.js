const config = require('./config');
App({
  globalData: { user: null, entryStore: '', cloudReady: false },
  onLaunch(options) {
    if (wx.cloud && config.cloudEnv) { wx.cloud.init({ env: config.cloudEnv, traceUser: false }); this.globalData.cloudReady = true; }
    if (config.mock && typeof console !== 'undefined') console.warn('[园邻] 本地演示模式：接口走 miniprogram/mock/ 假数据，不会调用云函数。上线前请把 config.js 的 mock 改为 false。');
    this.captureEntry(options);
  },
  onShow(options) { this.captureEntry(options); },
  captureEntry(options) {
    const query = (options && options.query) || {};
    try { const match = decodeURIComponent(query.scene || '').match(/^s=([a-z0-9_-]{2,24})$/); if (match) this.globalData.entryStore = match[1]; } catch (_) { /* Untrusted QR input is ignored. */ }
  }
});