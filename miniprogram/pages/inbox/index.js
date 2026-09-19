const api = require('../../utils/api');
Page({ data: { items: [], loading: true, error: '', more: false, page: 0, isAdmin: false },
 onShow() { this.visible = true; this.refresh(); }, onHide() { this.stop(); }, onUnload() { this.stop(); },
 stop() { this.visible = false; clearTimeout(this.timer); },
 async refresh() { try { const me = await api.guard(); if (!me) return; this.setData({ isAdmin: me.user.role === 'admin' }); if (me.user.role !== 'admin') await this.load(false, true); } catch(e) { this.setData({error:e.message}); } finally { this.setData({loading:false}); if (this.visible) this.timer = setTimeout(() => this.refresh(),15000); } },
 async load(e, reset = false) { if (this.fetching) return; this.fetching = true; const page = reset ? 0 : this.data.page + 1; try { const r = await api.call('chat.rooms',{page}); const items = r.items.map(x => ({...x,time:api.time(x.lastMessageAt)})); this.setData({ items: reset ? items : this.data.items.concat(items), page, more: items.length === 20, error:'' }); } catch(e) { this.setData({error:e.message}); } finally { this.fetching = false; } },
 open(e) { wx.navigateTo({url:'/pages/chat/index?id='+e.currentTarget.dataset.id}); }, admin() { wx.navigateTo({url:'/pages/admin/index'}); }
});