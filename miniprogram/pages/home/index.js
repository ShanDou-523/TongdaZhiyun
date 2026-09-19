const api = require('../../utils/api');
Page({
 data: { user: null, store: null, services: [], loading: true, error: '' },
 onShow() { this.load(); },
 async load() { this.setData({ loading: true, error: '' }); try { const me = await api.guard(); if (!me) return; this.setData(me); const s = await api.call('services.list'); this.setData({ services: s.items }); } catch(e) { this.setData({ error: e.message }); } finally { this.setData({ loading: false }); } },
 async contact() { if (this.opening) return; this.opening = true; try { const r = await api.call('chat.open'); wx.navigateTo({ url: '/pages/chat/index?id=' + r.roomId }); } catch(e) { this.setData({error:e.message}); } finally { this.opening = false; } },
 staff() { wx.navigateTo({ url: '/pages/staff/index' }); }, admin() { wx.navigateTo({ url: '/pages/admin/index' }); },
 coming() { wx.showToast({ title: '服务筹备中，敬请期待', icon: 'none' }); }
});