const demo = require('../../demo/index');
const { parks, genders, roles } = require('../../utils/constants');
Page({
  data: { accounts: [], stores: [], error: '', busy: false, available: false, nickname: '', parks, genders, parkIndex: 0, genderIndex: 0, storeIndex: 0 },
  onShow() { return this.load(); },
  async load() {
    const available = demo.available();
    this.setData({ available, error: '' });
    if (!available) { this.setData({error:'当前版本不提供演示入口，请使用手机号登录'}); return; }
    try {
      const accounts = await demo.accounts(), stores = await demo.stores();
      this.setData({ accounts: accounts.map(u=>({...u,roleName:roles[u.role]})), stores, storeIndex: 0 });
    } catch(e) { this.setData({error:e.message}); }
  },
  async enter(e) {
    if (this.data.busy) return;
    this.setData({busy:true,error:''});
    try {
      getApp().globalData.user = await demo.login(e.currentTarget.dataset.id);
      wx.reLaunch({url:'/pages/home/index'});
    } catch(e) { this.setData({error:e.message}); }
    finally { this.setData({busy:false}); }
  },
  input(e) { this.setData({nickname:e.detail.value}); },
  select(e) { this.setData({[e.currentTarget.dataset.key]:Number(e.detail.value)}); },
  async register() {
    if(this.data.busy)return;
    const store=this.data.stores[this.data.storeIndex];
    if(!store){this.setData({error:'请先启用一家演示门店，或重置演示数据'});return;}
    this.setData({busy:true,error:''});
    try {
      getApp().globalData.user=await demo.register({nickname:this.data.nickname,park:parks[this.data.parkIndex],gender:genders[this.data.genderIndex],storeId:store._id});
      wx.reLaunch({url:'/pages/home/index'});
    } catch(e){this.setData({error:e.message});}
    finally{this.setData({busy:false});}
  },
  async reset() {
    if(this.data.busy)return;
    this.setData({busy:true});
    try {
      const result=await wx.showModal({title:'重置演示数据',content:'清除本机的演示聊天、资料和管理修改，恢复初始账号。真实云端数据不会改变。'});
      if(!result.confirm)return;
      demo.reset();getApp().globalData.user=null;
      wx.reLaunch({url:'/pages/demo/index'});
    } catch(e){this.setData({error:e.message});}
    finally{this.setData({busy:false});}
  },
  realLogin() {
    if(this.data.busy)return;
    demo.leave();getApp().globalData.user=null;
    wx.reLaunch({url:'/pages/auth/index?real=1'});
  }
});
