const api = require('../../utils/api');
Page({
 data: { category: 'laundry', group: '全部', groups: ['全部','衣物','鞋类','床品家纺','包包皮革'], services: [], visible: [], loading: true, error: '' },
 onLoad(o) { this.setData({category:o.category === 'housekeeping' ? 'housekeeping' : 'laundry'}); },
 async onShow() { this.setData({loading:true,error:''}); try { const me=await api.guard(); if(!me)return; this.role=me.user.role; const r=await api.call('services.list'); this.setData({services:r.items.filter(s=>s.category===this.data.category).sort((a,b)=>(a.sortOrder===undefined?999:a.sortOrder)-(b.sortOrder===undefined?999:b.sortOrder)).map(s=>({...s,priceText:s.variants && s.variants.length ? (Math.min(...s.variants.map(v=>v.price))/100)+'元/'+s.unit+'起' : '门店确认报价'}))});this.filter(); } catch(e){this.setData({error:e.message});} finally{this.setData({loading:false});} },
 group(e){this.setData({group:e.currentTarget.dataset.group});this.filter();},
 filter(){this.setData({visible:this.data.services.filter(s=>this.data.group==='全部'||s.group===this.data.group)});},
 order(e){if(this.role!=='customer'){wx.showToast({title:'请使用客户账号下单',icon:'none'});return;}wx.navigateTo({url:'/pages/order/create/index?serviceId='+e.currentTarget.dataset.id});}
});
