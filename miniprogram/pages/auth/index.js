const api = require('../../utils/api');
const { parks, genders } = require('../../utils/constants');
Page({
  data: { mode: 'register', parks, genders, parkIndex: 0, genderIndex: 0, nickname: '', stores: [], storeIndex: 0, consent: false, busy: false, error: '', loading: false, demoAvailable: false },
  onLoad(options = {}) { getApp().captureEntry({ query: options }); const available = api.demoAvailable(); this.setData({demoAvailable:available}); if(available && options.real !== '1'){wx.redirectTo({url:'/pages/demo/index'});return;} this.load(); },
  demo() { wx.reLaunch({url:'/pages/demo/index'}); },
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
  select(e) { this.setData({ [e.currentTarget.dataset.key]: Number(e.detail.value) }); },
  consent(e) { this.setData({ consent: e.detail.value.includes('yes') }); },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
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
    this.setData({ busy: true, error: '' });
    try {
      const result = await api.call('auth.phone', { code: detail.code, mode: d.mode, consent: d.consent, nickname: d.nickname, park: parks[d.parkIndex], gender: genders[d.genderIndex], storeId: d.stores[d.storeIndex] && d.stores[d.storeIndex]._id });
      wx.setStorageSync('session', result.token); getApp().globalData.user = result.user;
      wx.switchTab({ url: '/pages/home/index' });
    } catch (error) { this.setData({ error: error.message, ...(error.code === 'NOT_REGISTERED' ? { mode: 'register' } : {}) }); }
    finally { this.setData({ busy: false }); }
  }
});