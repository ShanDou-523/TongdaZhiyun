const api = require('../../utils/api');
Page({
  data: { items: [], loading: true, error: '', more: false, page: 0, isAdmin: false },
  onShow() { this.stop(); this.visible = true; return this.refresh(); },
  onHide() { this.stop(); },
  onUnload() { this.stop(); },
  stop() { this.visible = false; this.generation = (this.generation || 0) + 1; clearTimeout(this.timer); },
  active(generation) { return this.visible && this.generation === generation; },
  async refresh() {
    const generation = this.generation;
    if (!this.active(generation) || this.refreshing === generation) return;
    this.refreshing = generation;
    clearTimeout(this.timer);
    try {
      const me = await api.guard();
      if (!me || !this.active(generation)) return;
      this.setData({ isAdmin: me.user.role === 'admin' });
      if (me.user.role !== 'admin') await this.load(false, true);
    } catch (e) {
      if (this.active(generation)) this.setData({ error: e.message });
    } finally {
      if (this.active(generation)) {
        this.refreshing = null;
        this.setData({ loading: false });
        this.timer = setTimeout(() => this.refresh(), 15000);
      }
    }
  },
  async load(e, reset = false) {
    const generation = this.generation;
    if (!this.active(generation) || this.fetching === generation) return;
    this.fetching = generation;
    try {
      const lastPage = reset ? this.data.page : this.data.page + 1;
      let items = reset ? [] : this.data.items.slice();
      let page = reset ? 0 : lastPage;
      let more = false;
      for (; page <= lastPage; page++) {
        const r = await api.call('chat.rooms', { page });
        if (!this.active(generation)) return;
        items = items.concat(r.items.map(x => ({ ...x, time: api.time(x.lastMessageAt) })));
        more = r.items.length === 20;
        if (!more || page === lastPage) break;
      }
      this.setData({ items: Array.from(new Map(items.map(x => [x._id, x])).values()), page, more, error: '' });
    } catch (e) {
      if (this.active(generation)) this.setData({ error: e.message });
    } finally {
      if (this.active(generation)) this.fetching = null;
    }
  },
  open(e) { wx.navigateTo({ url: '/pages/chat/index?id=' + e.currentTarget.dataset.id }); },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }); }
});
