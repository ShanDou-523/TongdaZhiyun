const api = require('../../utils/api');
const config = require('../../config');
const { parks, genders } = require('../../utils/constants');
Page({
  data: { mode: 'register', parks, genders, parkIndex: 0, genderIndex: 0, nickname: '', stores: [], storeIndex: 0, consent: false, busy: false, error: '', loading: false, devLogin: false, devPhone: '13000000001', parkDetail: '', dormRoom: '' },
  onLoad(options = {}) { getApp().captureEntry({query:options}); this.setData({devLogin:this.developmentLoginAvailable()}); this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      if (wx.getStorageSync('session')) { const me = await api.guard(); if (me) { wx.switchTab({ url: '/pages/home/index' }); return; } }
      const result = await api.call('public.stores');
      const entry = getApp().globalData.entryStore;
      const i = result.items.findIndex(s => s._id === entry);
      this.setData({ stores: result.items, storeIndex: i < 0 ? 0 : i, error: entry && i < 0 ? '扫码对应门店已不可用，请选择其他门店' : '' });
    } catch (e) { this.setData({ error: e.message }); } finally { this.setData({ loading: false }); }
  },
  mode(e) { if (!this.data.busy) this.setData({ mode: e.currentTarget.dataset.mode, error: '' }); },
  nickname(e) { this.setData({ nickname: e.detail.value }); },
  parkDetail(e) { this.setData({ parkDetail: e.detail.value }); },
  dormRoom(e) { this.setData({dormRoom:e.detail.value}); },
  select(e) { this.setData({ [e.currentTarget.dataset.key]: Number(e.detail.value) }); },
  consent(e) { this.setData({ consent: e.detail.value.includes('yes') }); },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  developmentLoginAvailable() {
    try { return config.devLogin === true && ['develop','trial'].includes(wx.getAccountInfoSync().miniProgram.envVersion); } catch (_) { return false; }
  },
  devPhoneInput(e) { this.setData({ devPhone: e.detail.value }); },
  async devAuth() {
    if (this.data.busy) return;
    if (!this.developmentLoginAvailable()) { this.setData({error:'当前版本不支持开发登录'}); return; }
    const phone = (this.data.devPhone || '').trim();
    if (!/^1\d{10}$/.test(phone)) { this.setData({ error: '请输入 11 位手机号，不同号码代表不同身份' }); return; }
    // 一个手机号同时决定两件事：devActor（这次算谁）和 dev:<手机号> 凭证（免微信手机号验证）。
    // 换号即换身份，退出后用另一个号登录就能分饰客户 / 门店 / 管理员。
    wx.setStorageSync('devActor', phone);
    await this.authorize({ detail: { code: 'dev:' + phone } });
  },
  async authorize(e) {
    if (this.data.busy) return;
    if (!this.data.consent) { this.setData({ error: '请先阅读并同意隐私说明' }); return; }
    const detail = (e && e.detail) || {};
    if (!detail.code) {
      const message = detail.errMsg || '';
      const errno = Number(detail.errno);
      let error = '未完成手机号授权，请点击按钮重新尝试';
      if (errno === 112 || /api scope is not declared in the privacy agreement|appid privacy api banned/i.test(message)) {
        error = '手机号登录暂不可用：小程序隐私配置尚未就绪，请联系运营方处理后再试';
      } else if (errno === 104 || /privacy permission is not authorized/i.test(message)) {
        error = '尚未同意微信隐私保护指引，请阅读后重新尝试授权';
      }
      this.setData({ error });
      return;
    }
    const d = this.data;
    if (d.mode === 'register' && (!d.nickname.trim() || !d.stores[d.storeIndex])) { this.setData({ error: '请填写昵称并选择门店' }); return; }
    if (d.mode === 'register' && parks[d.parkIndex] === '其它' && !d.parkDetail.trim()) { this.setData({error:'选择「其它」时，请填写具体园区或楼栋'}); return; }
    this.setData({ busy: true, error: '' });
    try {
      const result = await api.call('auth.phone', { code: detail.code, mode: d.mode, consent: d.consent, nickname: d.nickname, park: parks[d.parkIndex], parkDetail: parks[d.parkIndex] === '其它' ? d.parkDetail : '', dormRoom: d.dormRoom, gender: genders[d.genderIndex], storeId: d.stores[d.storeIndex] && d.stores[d.storeIndex]._id });
      wx.setStorageSync('session', result.token); getApp().globalData.user = result.user;
      wx.switchTab({ url: '/pages/home/index' });
    } catch (error) { this.setData({ error: error.message, ...(error.code === 'NOT_REGISTERED' ? { mode: 'register' } : {}) }); }
    finally { this.setData({ busy: false }); }
  }
});
