const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
function page(name, api = {}, wx = {}, app = {globalData:{}}) {
  let result;
  const code = fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.js'),'utf8');
  vm.runInNewContext(code,{require: name => name.endsWith('/api') ? api : require('../miniprogram/utils/constants'),Page: p => {result=p;},getApp:()=>app,wx,console,setTimeout,clearTimeout,Map,Date,Math});
  result.setData = function(update, callback) { Object.assign(this.data,update); if(callback)callback(); };
  return result;
}
test('authorization refusal is recoverable and never invokes backend',async()=>{
  let calls=0;const p=page('auth',{call:async()=>calls++});p.data.consent=true;
  await p.authorize({detail:{errMsg:'getPhoneNumber:fail user deny'}});assert.equal(calls,0);assert.match(p.data.error,/重新尝试/);assert.equal(p.data.busy,false);
});
test('consent and registration fields gate phone authorization submission',async()=>{
  let calls=0;const p=page('auth',{call:async()=>calls++});await p.authorize({detail:{code:'verified'}});assert.equal(calls,0);assert.match(p.data.error,/隐私/);
  p.data.consent=true;await p.authorize({detail:{code:'verified'}});assert.equal(calls,0);assert.match(p.data.error,/昵称/);
});
test('login sends phone code, saves session only after backend success, and enters home',async()=>{
  const calls=[];let saved,navigated;const app={globalData:{}};
  const p=page('auth',{call:async(action,data)=>{calls.push({action,data});return{token:'secret',user:{_id:'me'}};}},{setStorageSync:(key,value)=>{saved=[key,value];},switchTab:o=>{navigated=o.url;}},app);
  Object.assign(p.data,{mode:'login',consent:true});await p.authorize({detail:{code:'phone-code'}});
  assert.equal(calls[0].data.code,'phone-code');assert.equal(calls[0].action,'auth.phone');assert.deepEqual(saved,['session','secret']);assert.equal(navigated,'/pages/home/index');assert.equal(p.data.busy,false);
});
test('backend login failure never creates a session and allows registering',async()=>{
  let saved=false;const p=page('auth',{call:async()=>{const e=new Error('尚未注册');e.code='NOT_REGISTERED';throw e;}},{setStorageSync:()=>{saved=true;}});
  Object.assign(p.data,{mode:'login',consent:true});await p.authorize({detail:{code:'phone-code'}});assert.equal(saved,false);assert.equal(p.data.mode,'register');assert.equal(p.data.busy,false);
});
test('chat retry preserves idempotency key and successful send clears draft',async()=>{
  let fail=true;const sent=[];const p=page('chat',{call:async(action,data)=>{sent.push(data);if(fail)throw new Error('offline');return{};}});
  p.roomId='room';p.refresh=async()=>{};p.data.content='你好';await p.send();assert.equal(p.data.content,'你好');assert.equal(p.data.busy,false);fail=false;await p.send();assert.equal(sent[0].requestId,sent[1].requestId);assert.equal(p.data.content,'');assert.equal(p.pending,null);
});
test('QR parser accepts only bounded store scene; malformed input cannot crash app',()=>{
  let app;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/app.js'),'utf8'),{require:()=>({}),App:x=>{app=x;},wx:{}});
  app.captureEntry({query:{scene:'s%3Dmain'}});assert.equal(app.globalData.entryStore,'main');
  app.captureEntry({query:{scene:'%ZZ'}});assert.equal(app.globalData.entryStore,'main');
  app.captureEntry({query:{scene:'s=../../admin'}});assert.equal(app.globalData.entryStore,'main');
});
test('order draft strips client price and only permits declared transitions',()=>{
  const {validateOrderDraft,canTransition}=require('../cloudfunctions/api/modules/order-contract');
  const result=validateOrderDraft({category:'laundry',items:[{serviceId:'wash',quantity:2,price:1}],status:'completed'});assert.deepEqual(result,{category:'laundry',items:[{serviceId:'wash',quantity:2}]});
  assert.equal(canTransition('submitted','accepted'),true);assert.equal(canTransition('draft','completed'),false);assert.equal(canTransition('completed','submitted'),false);
  assert.throws(()=>validateOrderDraft({category:'laundry',items:[{serviceId:'x',quantity:0}]}));
});
