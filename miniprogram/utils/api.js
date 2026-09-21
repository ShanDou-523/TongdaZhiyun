// 所有后端调用的唯一出口。页面里不要直接写 wx.cloud.callFunction。
// mock 模式下自动切换到本地假数据层，页面代码无需任何改动。
const config = require('../config');
const mock = require('../mock/index');

function session() { return wx.getStorageSync('session') || ''; }
function clear() { wx.removeStorageSync('session'); getApp().globalData.user = null; }
// 开发期身份切换：登录页填的测试手机号会存成 devActor，之后每次请求都带上，服务端据此判定
// "这次调用算谁"。前端这道开关只决定带不带参数，真正的判断在云函数（DEV_LOGIN 环境变量），
// 两边都开才生效；生产环境不设 DEV_LOGIN，带了也没用。
function devActor() { return config.devLogin && !config.mock ? (wx.getStorageSync('devActor') || '') : ''; }

async function call(action, data = {}) {
  if (config.mock) {
    try { return await mock.call(action, data, session()); }
    catch (error) { if (error.code === 'AUTH') { clear(); wx.reLaunch({ url: '/pages/auth/index' }); } throw error; }
  }
  if (!getApp().globalData.cloudReady) throw new Error('尚未连接云环境，请按 docs/环境切换清单.md 配置 AppID 和 cloudEnv');
  let response;
  try { response = await wx.cloud.callFunction({ name: 'api', data: { action, data, token: session(), devActor: devActor() } }); }
  catch (_) { throw new Error('无法连接服务，请检查网络、云环境及 api 云函数部署状态'); }
  const result = response.result;
  if (!result || !result.ok) {
    const err = new Error((result && result.message) || '服务响应异常，请重试'); err.code = result && result.code;
    if (err.code === 'AUTH') { clear(); wx.reLaunch({ url: '/pages/auth/index' }); }
    throw err;
  }
  return result.data;
}
async function guard(roles) {
  if (!wx.getStorageSync('session')) { wx.reLaunch({ url: '/pages/auth/index' }); return null; }
  const result = await call('me');
  getApp().globalData.user = result.user;
  if (roles && !roles.includes(result.user.role)) { wx.switchTab({ url: '/pages/home/index' }); return null; }
  return result;
}
function time(value) { if (!value) return ''; const d = new Date(value); return [d.getMonth()+1,d.getDate()].join('/') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
module.exports = { call, guard, clear, time };
