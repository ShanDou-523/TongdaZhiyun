const demo = require('../../demo/index');
Component({
  data:{visible:false},
  lifetimes:{attached(){this.update();}},
  pageLifetimes:{show(){this.update();}},
  methods:{
    update(){this.setData({visible:demo.available()&&demo.hasSession()});},
    switchAccount(){wx.reLaunch({url:'/pages/demo/index'});}
  }
});
