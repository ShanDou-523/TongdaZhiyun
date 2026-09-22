const api = require('../../../utils/api');
Page({
 data: { items: [], staff: false, loading: true, busy: false, error: '', more: false, page: 0 },
 onShow() { this.load(false, true); },
 async load(e, reset = false) {
  if (this.fetching) return;
  this.fetching = true;
  const page = reset ? 0 : this.data.page + 1;
  try {
   const me=await api.guard();if(!me)return;const staff=['store','admin'].includes(me.user.role);this.setData({staff});
   const r = await api.call(staff ? 'order.storeList' : 'order.mine', { page });
   // 还没进服务环节的单才能自己取消，和状态机的转换表保持一致。
   const items = r.items.map(o => ({ ...o, time: api.time(o.createdAt), canAccept: (o.delivery === 'runner' ? o.status === 'delivered' : o.status === 'submitted'), amountText: o.serviceAmount === undefined ? '' : (o.serviceAmount/100).toFixed(2), feeText: o.fee ? (o.fee / 100) + ' 元' : '免跑腿费', canCancel: ['submitted', 'runnerTaken', 'picked'].includes(o.status) }));
   this.setData({ items: reset ? items : this.data.items.concat(items), page, more: items.length === 20, error: '' });
  } catch (e) { this.setData({ error: e.message }); }
  finally { this.fetching = false; this.setData({ loading: false }); }
 },
 async cancel(e) {
  if (this.data.busy) return;
  const id = e.currentTarget.dataset.id;
  const r = await wx.showModal({ title: '取消订单', content: '取消后无法恢复，需要重新下单。' });
  if (!r.confirm) return;
  this.setData({ busy: true, error: '' });
  try { await api.call('order.cancel', { id }); await this.load(false, true); wx.showToast({ title: '已取消' }); }
  catch (err) { this.setData({ error: err.message }); }
  finally { this.setData({ busy: false }); }
 },
 async advance(e){if(this.data.busy)return;this.setData({busy:true,error:''});try{await api.call(e.currentTarget.dataset.action,{id:e.currentTarget.dataset.id});await this.load(false,true);}catch(err){this.setData({error:err.message});}finally{this.setData({busy:false});}},
 create() { wx.navigateTo({ url: '/pages/services/index?category=laundry' }); }
});
