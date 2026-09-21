const api = require('../../../utils/api');
// 列表项统一在这里加工，避免 wxml 里做换算。
function decorate(o) { return { ...o, time: api.time(o.createdAt), feeText: (o.fee / 100) + ' 元' }; }
Page({
 data: { tab: 'pool', pool: [], mine: [], loading: true, busy: false, error: '' },
 onShow() { this.load(); },
 async load() {
  this.setData({ loading: true, error: '' });
  try {
   const me = await api.guard(['customer']); if (!me) return;
   const pool = await api.call('order.pool');
   const mine = await api.call('order.myRunner');
   this.setData({
    pool: pool.items.map(decorate),
    mine: mine.items.map(o => ({ ...decorate(o), canPick: o.status === 'runnerTaken', canDeliver: o.status === 'picked' }))
   });
  } catch (e) { this.setData({ error: e.message }); }
  finally { this.setData({ loading: false }); }
 },
 tab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
 async take(e) {
  if (this.data.busy) return;
  const id = e.currentTarget.dataset.id;
  const r = await wx.showModal({ title: '接下这单', content: '接下后请尽快上门取件；送到门店这单就算跑完。' });
  if (!r.confirm) return;
  this.setData({ busy: true, error: '' });
  try { await api.call('order.take', { id }); await this.load(); wx.showToast({ title: '接单成功' }); }
  catch (err) { this.setData({ error: err.message }); }
  finally { this.setData({ busy: false }); }
 },
 async advance(e) {
  if (this.data.busy) return;
  const id = e.currentTarget.dataset.id, step = e.currentTarget.dataset.step;
  this.setData({ busy: true, error: '' });
  try { await api.call('order.runnerAdvance', { id, step }); await this.load(); wx.showToast({ title: step === 'picked' ? '已取件' : '已送达门店' }); }
  catch (err) { this.setData({ error: err.message }); }
  finally { this.setData({ busy: false }); }
 }
});
