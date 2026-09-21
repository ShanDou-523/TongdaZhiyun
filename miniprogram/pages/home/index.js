const api = require('../../utils/api');
Page({
 data: { user: null, store: null, services: [], banners: [], loading: true, error: '' },
 onShow() { this.load(); },
 async load() { this.setData({ loading: true, error: '' }); try { const me = await api.guard(); if (!me) return; this.setData(me); const s = await api.call('services.list'); const b = await api.call('banners.list'); this.setData({ services: s.items, banners: await this.resolveMedia(b.items) }); } catch(e) { this.setData({ error: e.message }); } finally { this.setData({ loading: false }); } },
 // 广告素材存的是云存储 fileID（cloud:// 开头），<image>/<video> 虽能直接渲染 cloud://，
 // 但批量换临时 URL 后加载更快、兼容性更好；换取失败时回退直接用 fileID。
 // 本地演示模式下素材是本地临时路径，直接使用。
 async resolveMedia(items) {
  const ids = items.filter(x => x.mediaFileID && x.mediaFileID.startsWith('cloud://')).map(x => x.mediaFileID);
  const urls = {};
  if (ids.length && !this.data.demoMode) { try { const r = await wx.cloud.getTempFileURL({ fileList: ids }); r.fileList.forEach(f => { if (f.tempFileURL) urls[f.fileID] = f.tempFileURL; }); } catch (_) { /* 网络异常时回退 fileID 直渲 */ } }
  return items.map(x => ({ ...x, mediaUrl: x.mediaFileID ? (urls[x.mediaFileID] || x.mediaFileID) : '' }));
 },
 async contact() { if (this.opening) return; this.opening = true; try { const r = await api.call('chat.open'); wx.navigateTo({ url: '/pages/chat/index?id=' + r.roomId }); } catch(e) { this.setData({error:e.message}); } finally { this.opening = false; } },
 staff() { wx.navigateTo({ url: '/pages/staff/index' }); }, admin() { wx.navigateTo({ url: '/pages/admin/index' }); },
 coming() { wx.showToast({ title: '服务筹备中，敬请期待', icon: 'none' }); }
});