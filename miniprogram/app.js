const config = require('./config');
App({
  globalData: { user: null, entryStore: '', cloudReady: false },
  onLaunch(options) {
    if (wx.cloud && config.cloudEnv) { wx.cloud.init({ env: config.cloudEnv, traceUser: false }); this.globalData.cloudReady = true; }
    this.captureEntry(options);
  },
  onShow(options) { this.captureEntry(options); },
  captureEntry(options) {
    const query = (options && options.query) || {};
    try { const match = decodeURIComponent(query.scene || '').match(/^s=([a-z0-9_-]{2,24})$/); if (match) this.globalData.entryStore = match[1]; } catch (_) { /* Untrusted QR input is ignored. */ }
  }
});