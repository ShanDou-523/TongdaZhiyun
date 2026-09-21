const api = require('../../utils/api');
Page({
  data: { customers: [], notifications: [], orders: [], error: '', page: 0, more: false, unread: 0, loading: true, reading: false, busy: false },
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
      await this.orders();
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
  refresh() { return this.customers(false, true); },
  // 本店订单。自送的单提交后就能接；选了飞毛腿的要等骑手送到门店（delivered）才轮到这里。
  async orders() {
    const generation = this.generation;
    if (!this.active(generation)) return;
    try {
      const r = await api.call('order.storeList', { page: 0 });
      if (!this.active(generation)) return;
      this.setData({ orders: r.items.map(o => ({ ...o, time: api.time(o.createdAt), feeText: o.fee ? (o.fee / 100) + ' 元' : '', canAccept: (o.status === 'submitted' && o.delivery === 'self') || o.status === 'delivered', canFinish: o.status === 'serving' })) });
    } catch (e) {
      if (this.active(generation)) this.setData({ error: e.message });
    }
  },
  async accept(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    this.setData({ busy: true, error: '' });
    try { await api.call('order.accept', { id }); await this.orders(); wx.showToast({ title: '已接单' }); }
    catch (err) { this.setData({ error: err.message }); }
    finally { this.setData({ busy: false }); }
  },
  async finish(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const r = await wx.showModal({ title: '完成订单', content: '确认这单服务已经做完？完成后客户会看到状态更新。' });
    if (!r.confirm) return;
    this.setData({ busy: true, error: '' });
    try { await api.call('order.finish', { id }); await this.orders(); wx.showToast({ title: '已完成' }); }
    catch (err) { this.setData({ error: err.message }); }
    finally { this.setData({ busy: false }); }
  },
});
