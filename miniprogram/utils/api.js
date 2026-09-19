const demo = require('../demo/index');
async function call(action, data = {}) {
  try {
    if (demo.hasSession()) {
      const result = await demo.call(action, data);
      return action === 'me' ? { ...result, demoMode: true } : result;
    }
    if (!getApp().globalData.cloudReady) throw new Error('尚未连接云环境，请按部署说明配置 AppID 和 cloudEnv');
    let response;
    try { response = await wx.cloud.callFunction({ name: 'api', data: { action, data, token: wx.getStorageSync('session') || '' } }); }
    catch (_) { throw new Error('无法连接服务，请检查网络、云环境及 api 云函数部署状态'); }
    const result = response.result;
    if (!result || !result.ok) {
      const err = new Error((result && result.message) || '服务响应异常，请重试');
      err.code = result && result.code;
      throw err;
    }
    return action === 'me' ? { ...result.data, demoMode: false } : result.data;
  } catch (err) {
    if (err.code === 'AUTH') { clear(); wx.reLaunch({ url: '/pages/auth/index' }); }
    throw err;
  }
}
function clear() {
  if (demo.hasSession()) demo.leave();
  else wx.removeStorageSync('session');
  getApp().globalData.user = null;
}
async function guard(roles) {
  if (!demo.hasSession() && !wx.getStorageSync('session')) { wx.reLaunch({ url: '/pages/auth/index' }); return null; }
  const result = await call('me');
  getApp().globalData.user = result.user;
  if (roles && !roles.includes(result.user.role)) { wx.switchTab({ url: '/pages/home/index' }); return null; }
  return result;
}
function time(value) { if (!value) return ''; const d = new Date(value); return [d.getMonth()+1,d.getDate()].join('/') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
module.exports = { call, guard, clear, time, demoAvailable: () => demo.available() };
