const api = require('../../utils/api');
const config = require('../../config');
const { parks, genders } = require('../../utils/constants');
Page({
  data: { mode: 'register', parks, genders, parkIndex: 0, genderIndex: 0, nickname: '', stores: [], storeIndex: 0, consent: false, busy: false, error: '', loading: false, demo: config.mock, devLogin: config.devLogin && !config.mock, devPhone: '13000000001' },
  onLoad(options) { getApp().captureEntry({ query: options }); this.load(); },
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
  select(e) { this.setData({ [e.currentTarget.dataset.key]: Number(e.detail.value) }); },
  consent(e) { this.setData({ consent: e.detail.value.includes('yes') }); },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  async demoLogin(e) {
    if (this.data.busy) return;
    if (!this.data.stores.length) { this.setData({ error: '演示门店还没加载好，请点下方「重新连接」' }); return; }
    this.setData({ consent: true, mode: 'register', nickname: this.data.nickname.trim() || '演示用户' });
    await this.authorize({ detail: { code: 'mock-' + (e.currentTarget.dataset.role || 'customer') } });
  },
  devPhoneInput(e) { this.setData({ devPhone: e.detail.value }); },
  async devAuth() {
    if (this.data.busy) return;
    const phone = (this.data.devPhone || '').trim();
    if (!/^1\d{10}$/.test(phone)) { this.setData({ error: '请输入 11 位测试手机号（不同号码 = 不同账号）' }); return; }
    // 开发联调入口：code 形如 "dev:<手机号>"，由云函数 DEV_LOGIN 开关决定是否接受。
    await this.authorize({ detail: { code: 'dev:' + phone } });
  },
  async authorize(e) {
    if (this.data.busy) return;
    if (!this.data.consent) { this.setData({ error: '请先阅读并同意隐私说明' }); return; }
    // 演示模式下没有真实手机号能力，允许直接进入。
    const authCode = config.mock ? (e.detail.code || 'mock-customer') : e.detail.code;
    if (!authCode) { this.setData({ error: '未完成手机号授权，请点击按钮重新尝试' }); return; }
    const d = this.data;
    if (d.mode === 'register' && (!d.nickname.trim() || !d.stores[d.storeIndex])) { this.setData({ error: '请填写昵称并选择门店' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      const result = await api.call('auth.phone', { code: authCode, mode: d.mode, consent: d.consent, nickname: d.nickname, park: parks[d.parkIndex], gender: genders[d.genderIndex], storeId: d.stores[d.storeIndex] && d.stores[d.storeIndex]._id });
      wx.setStorageSync('session', result.token); getApp().globalData.user = result.user;
      wx.switchTab({ url: '/pages/home/index' });
    } catch (error) { this.setData({ error: error.message, ...(error.code === 'NOT_REGISTERED' ? { mode: 'register' } : {}) }); }
    finally { this.setData({ busy: false }); }
  }
});