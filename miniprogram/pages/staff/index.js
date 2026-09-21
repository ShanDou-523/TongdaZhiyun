const api = require('../../utils/api');
Page({
  data: { customers: [], notifications: [], error: '', page: 0, more: false, unread: 0, loading: true, reading: false },
  onShow() { this.stop(); this.visible = true; return this.start(); },
  onHide() { this.stop(); },
  onUnload() { this.stop(); },
  stop() { this.visible = false; this.generation = (this.generation || 0) + 1; clearTimeout(this.timer); },
  active(generation) { return this.visible && generation === this.generation; },
  async start() {
    const generation = this.generation;
    try {
      const me = await api.guard(['store', 'admin']);
      if (!me || !this.active(generation)) return;
      this.setData(me);
      await this.customers(false, true);
      if (this.active(generation)) await this.poll();
    } catch (e) {
      if (this.active(generation)) this.setData({ error: e.message });
    } finally {
      if (this.active(generation)) this.setData({ loading: false });
    }
  },
  async customers(e, reset = false) {
    const generation = this.generation;
    if (!this.active(generation) || this.fetching === generation) return;
    this.fetching = generation;
    const page = reset ? 0 : this.data.page + 1;
    try {
      const r = await api.call('staff.customers', { page });
      if (this.active(generation)) this.setData({ customers: reset ? r.items : this.data.customers.concat(r.items), page, more: r.items.length === 20, error: '' });
    } catch (e) {
      if (this.active(generation)) this.setData({ error: e.message });
    } finally {
      if (this.active(generation)) this.fetching = null;
    }
  },
  async poll() {
    const generation = this.generation;
    if (!this.active(generation) || this.polling === generation) return;
    this.polling = generation;
    clearTimeout(this.timer);
    try {
      const r = await api.call('staff.notifications');
      if (!this.active(generation)) return;
      const latest = r.items[0] && r.items[0]._id;
      if (latest && this.latest && latest !== this.latest) wx.showToast({ title: '有新客户注册', icon: 'none' });
      this.latest = latest;
      this.setData({ notifications: r.items.map(n => ({ ...n, time: api.time(n.createdAt) })), unread: r.items.filter(n => n.unread).length, error: '' });
    } catch (e) {
      if (this.active(generation)) this.setData({ error: e.message });
    } finally {
      if (this.active(generation)) {
        this.polling = null;
        this.timer = setTimeout(() => this.poll(), 15000);
      }
    }
  },
  async read() {
    const generation = this.generation;
    if (!this.active(generation) || this.reading) return;
    const ids = this.data.notifications.filter(n => n.unread).map(n => n._id);
    if (!ids.length) return;
    this.reading = true;
    this.setData({ reading: true });
    try {
      await api.call('staff.readNotifications', { ids });
      if (!this.active(generation)) return;
      // Invalidate a notification request that started before the read completed.
      this.stop();
      this.visible = true;
      await this.poll();
    } catch (e) {
      if (this.active(generation)) this.setData({ error: e.message });
    } finally {
      this.reading = null;
      this.setData({ reading: false });
    }
  },
  async chat(e) {
    if (this.opening) return;
    this.opening = true;
    try {
      const r = await api.call('chat.open', { customerId: e.currentTarget.dataset.id });
      wx.navigateTo({ url: '/pages/chat/index?id=' + r.roomId });
    } catch (e) { this.setData({ error: e.message }); }
    finally { this.opening = false; }
  },
  refresh() { return this.customers(false, true); }
});
