const api = require('../../utils/api');
const config = require('../../config');
Page({
 data: { user: null, store: null, services: [], banners: [], panel: { title: '联系你的门店', note: '服务咨询，有话直接说' }, loading: true, error: '' },
 onShow() { this.load(); },
 async load() { this.setData({ loading: true, error: '' }); try { const me = await api.guard(); if (!me) return; this.setData({ ...me, panel: this.panelFor(me.user && me.user.role) }); const s = await api.call('services.list'); const b = await api.call('banners.list'); this.setData({ services: this.decorate(s.items), banners: await this.resolveMedia(b.items) }); } catch(e) { this.setData({ error: e.message }); } finally { this.setData({ loading: false }); } },
 // 服务卡片的配色与图标由类别决定；未登记类别走 house 兜底，避免出现空白卡片。
 decorate(items) { return items.map(x => ({ ...x, tone: x.category === 'laundry' ? 'laundry' : 'house', icon: x.category === 'laundry' ? '洗' : '家' })); },
 // 底部卡片随角色换标题与说明，避免出现"标题说联系门店、按钮却是管理中心"的错位。
 panelFor(role) { if (role === 'store') return { title: '门店工作台', note: '客户消息、新客户提醒与已读管理' }; if (role === 'admin') return { title: '管理中心', note: '客户、门店、广告与数据，一处掌握' }; return { title: '联系你的门店', note: '服务咨询，有话直接说' }; },
 // 广告素材存的是云存储 fileID（cloud:// 开头），<image>/<video> 虽能直接渲染 cloud://，
 // 但批量换临时 URL 后加载更快、兼容性更好；换取失败时回退直接用 fileID。
 // 演示模式（mock）下素材是本地临时路径，直接使用。
 async resolveMedia(items) {
  const ids = items.filter(x => x.mediaFileID && x.mediaFileID.startsWith('cloud://')).map(x => x.mediaFileID);
  const urls = {};
  if (ids.length && !config.mock) { try { const r = await wx.cloud.getTempFileURL({ fileList: ids }); r.fileList.forEach(f => { if (f.tempFileURL) urls[f.fileID] = f.tempFileURL; }); } catch (_) { /* 网络异常时回退 fileID 直渲 */ } }
  return items.map(x => ({ ...x, mediaUrl: x.mediaFileID ? (urls[x.mediaFileID] || x.mediaFileID) : '' }));
 },
 async contact() { if (this.opening) return; this.opening = true; try { const r = await api.call('chat.open'); wx.navigateTo({ url: '/pages/chat/index?id=' + r.roomId }); } catch(e) { this.setData({error:e.message}); } finally { this.opening = false; } },
 staff() { wx.navigateTo({ url: '/pages/staff/index' }); }, admin() { wx.navigateTo({ url: '/pages/admin/index' }); },
 // 点服务卡片 = 去下这一单。门店/管理员没有下单入口，直接引导到各自工作台。
 consult(e) { if (!this.data.user) return; if (this.data.user.role !== 'customer') { wx.showToast({ title: '请在门店工作台或管理中心处理', icon: 'none' }); return; } const id = e.currentTarget.dataset.id; wx.navigateTo({ url: '/pages/order/create/index' + (id ? '?serviceId=' + id : '') }); }
});
