const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { createDemo, DATA_KEY, SESSION_KEY } = require('../miniprogram/demo/runtime');
const { uid } = require('../miniprogram/demo/domain');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function fixture() {
  const data = new Map();
  let allowed=true,now=1800000000000;
  const storage={get:key=>copy(data.get(key)),set:(key,value)=>data.set(key,copy(value)),remove:key=>data.delete(key)};
  const demo=createDemo({storage,canUse:()=>allowed,clock:()=>now});
  const login=name=>demo.login(uid('demo_'+name));
  return {demo,storage,login,setAllowed:value=>{allowed=value;},tick:()=>{now+=1000;}};
}
const fails=(promise,code)=>assert.rejects(promise,e=>e.code===code);

test('demo exposes five selectable accounts, one store and seeded pagination data',async()=>{
  const f=fixture();const accounts=await f.demo.accounts();
  assert.equal(accounts.length,5);
  assert.equal(accounts.filter(u=>u.role==='customer').length,2);
  assert.equal(accounts.filter(u=>u.role==='store').length,2);
  assert.equal(accounts.filter(u=>u.role==='admin').length,1);
  assert.equal((await f.demo.stores()).length,1);
  await f.login('staff_a');
  assert.equal((await f.demo.call('staff.customers')).items.length,20);
  assert.equal((await f.demo.call('staff.customers',{page:1})).items.length,6);
  assert.equal((await f.demo.call('chat.rooms')).items.length,20);
});

test('demo supports customer send, staff reply, read state and earlier messages',async()=>{
  const f=fixture();await f.login('customer_a');
  const {roomId}=await f.demo.call('chat.open');
  const messages=await f.demo.call('chat.messages',{roomId});
  assert.equal(messages.items.length,30);assert.equal(messages.more,true);
  const older=await f.demo.call('chat.messages',{roomId,before:messages.items[0].seq});
  assert.equal(older.items.length,5);
  const data={roomId,content:'测试洗护咨询',requestId:'demo_send'};
  await f.demo.call('chat.send',data);await f.demo.call('chat.send',data);
  assert.equal((await f.demo.call('chat.messages',{roomId})).latestSeq,36);
  await f.login('staff_a');
  const incoming=await f.demo.call('chat.messages',{roomId});
  assert.equal(incoming.items.at(-1).content,'测试洗护咨询');
  await f.demo.call('chat.read',{roomId,seq:36});
  assert.equal((await f.demo.call('chat.rooms')).items.find(r=>r._id===roomId).unread,false);
  await f.demo.call('chat.send',{roomId,content:'可以，欢迎咨询',requestId:'reply'});
  await f.login('customer_a');
  assert.equal((await f.demo.call('chat.messages',{roomId})).items.at(-1).content,'可以，欢迎咨询');
});

test('demo enforces customer privacy and role permissions using shared business rules',async()=>{
  const f=fixture();await f.login('customer_a');const {roomId}=await f.demo.call('chat.open');
  await fails(f.demo.call('admin.stores'),'FORBIDDEN');
  await f.login('customer_b');await fails(f.demo.call('chat.messages',{roomId}),'FORBIDDEN');
  await f.login('staff_a');assert.equal((await f.demo.call('chat.messages',{roomId})).items.length,30);
  assert((await f.demo.call('staff.customers')).items.every(u=>u.storeId==='main'));
  assert((await f.demo.call('chat.rooms')).items.every(r=>r.storeId==='main'));
});

test('new demo customer creates a selectable identity and store notification',async()=>{
  const f=fixture();await f.demo.accounts();
  const created=await f.demo.register({nickname:'试用小王',park:'三园区',gender:'不愿透露',storeId:'main',role:'admin'});
  assert.equal(created.role,'customer');
  assert.equal((await f.demo.call('me')).user._id,created._id);
  assert.equal((await f.demo.accounts()).length,6);
  await f.login('staff_a');
  const notice=(await f.demo.call('staff.notifications')).items.find(n=>n.customerId===created._id);
  assert(notice);assert.equal(notice.unread,true);
  await f.demo.call('staff.readNotifications',{ids:[notice._id]});
  assert.equal((await f.demo.call('staff.notifications')).items.find(n=>n._id===notice._id).unread,false);
  await f.login('staff_a2');
  assert.equal((await f.demo.call('staff.notifications')).items.find(n=>n._id===notice._id).unread,true);
});

test('invalid demo registration does not add an account or user',async()=>{
  const f=fixture();await f.demo.accounts();const before=f.storage.get(DATA_KEY);
  await fails(f.demo.register({nickname:'',park:'一园区',gender:'不愿透露',storeId:'main'}),'INVALID');
  assert.deepEqual(f.storage.get(DATA_KEY),before);
});

test('demo administration can revoke sessions, reassign roles and inspect audit records',async()=>{
  const f=fixture();await f.login('customer_a');const old=f.storage.get(SESSION_KEY);
  await f.login('admin');
  await f.demo.call('admin.userUpdate',{id:uid('demo_customer_a'),enabled:true,role:'store',storeId:'main'});
  const audit=await f.demo.call('admin.inspect',{collection:'auditLogs'});assert.equal(audit.items[0].action,'user.update');
  f.storage.set(SESSION_KEY,old);await fails(f.demo.call('me'),'AUTH');
  const user=await f.login('customer_a');assert.equal(user.role,'store');assert.equal(user.storeId,'main');
});

test('demo disabled accounts and stores cannot log in; administrators remain available',async()=>{
  const f=fixture();await f.login('admin');
  await f.demo.call('admin.userUpdate',{id:uid('demo_customer_a'),enabled:false,role:'customer',storeId:'main'});
  await fails(f.login('customer_a'),'FORBIDDEN');
  await f.demo.call('admin.storeSave',{id:'main',name:'演示门店',enabled:false});
  await fails(f.login('staff_a'),'FORBIDDEN');
  assert.equal((await f.login('admin')).role,'admin');
});

test('demo persists locally across restarts and reset preserves unrelated and real sessions',async()=>{
  const f=fixture();f.storage.set('session','real-session');f.storage.set('other-app-value',42);
  await f.login('customer_a');
  await f.demo.call('profile.update',{nickname:'修改后的演示昵称',park:'四园区',gender:'女'});
  const restarted=createDemo({storage:f.storage,canUse:()=>true,clock:()=>1800000000000});
  assert.equal((await restarted.call('me')).user.nickname,'修改后的演示昵称');
  restarted.reset();
  assert.equal(f.storage.get(SESSION_KEY),undefined);
  assert.equal(f.storage.get('session'),'real-session');assert.equal(f.storage.get('other-app-value'),42);
  assert.equal((await restarted.accounts()).find(u=>u._id===uid('demo_customer_a')).nickname,'客户 A');
});

test('demo has no pretend QR or production phone authorization endpoint',async()=>{
  const f=fixture();await f.login('admin');
  await fails(f.demo.call('admin.qrcode',{storeId:'main',version:'trial'}),'DEMO_UNSUPPORTED');
  await fails(f.demo.call('auth.phone',{code:'arbitrary'}),'DEMO_UNSUPPORTED');
});

test('demo unavailable mode blocks existing demo sessions and test registration',async()=>{
  const f=fixture();await f.login('customer_a');f.setAllowed(false);
  await fails(f.demo.call('me'),'AUTH');
  await fails(f.demo.register({}),'AUTH');
  assert.throws(()=>f.demo.reset(),e=>e.code==='AUTH');
});

test('demo gate allows develop/trial only and fails closed for unknown runtime',()=>{
  const source=fs.readFileSync('miniprogram/demo/index.js','utf8');
  for(const [enabled,version,expected] of [[true,'develop',true],[true,'trial',true],[true,'release',false],[false,'develop',false],[true,undefined,false]]){
    let options;
    vm.runInNewContext(source,{module:{exports:{}},require:name=>name==='../config'?{demoEnabled:enabled}:{createDemo:x=>{options=x;return{};}},wx:{getAccountInfoSync:()=>({miniProgram:{envVersion:version}})}});
    assert.equal(options.canUse(),expected);
  }
});

test('API routes demo data locally, never forwards revoked demo sessions to cloud, preserves real token',async()=>{
  const f=fixture();let clouds=0;const app={globalData:{cloudReady:true,user:null}};const module={exports:{}};
  const wx={getStorageSync:f.storage.get,removeStorageSync:f.storage.remove,reLaunch(){},switchTab(){},cloud:{callFunction:async()=>{clouds++;return{result:{ok:true,data:{user:{role:'customer',_id:'real'}}}};}}};
  vm.runInNewContext(fs.readFileSync('miniprogram/utils/api.js','utf8'),{require:()=>f.demo,module,wx,getApp:()=>app,Date});
  const api=module.exports;f.storage.set('session','real-token');await f.login('customer_a');
  assert.equal((await api.guard()).demoMode,true);assert.equal(clouds,0);
  await api.call('logout');api.clear();
  assert.equal(f.storage.get('session'),'real-token');assert.equal(f.demo.hasSession(),false);
  assert.equal((await api.guard()).demoMode,false);assert.equal(clouds,1);
  await f.login('customer_a');f.setAllowed(false);
  await fails(api.call('me'),'AUTH');assert.equal(clouds,1);assert.equal(f.demo.hasSession(),false);
});

test('generated demo rules exactly match cloud business source except crypto import',()=>{
  require('../scripts/sync-demo')(true);
});

test('development auth entry opens demo without requesting phone or cloud stores',()=>{
  let page,route,calls=0;
  const moduleApi={demoAvailable:()=>true,call:()=>{calls++;}};
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/auth/index.js','utf8'),{
    require:name=>name.endsWith('/api')?moduleApi:require('../miniprogram/utils/constants'),
    Page:p=>{page=p;},wx:{redirectTo:o=>{route=o.url;}},getApp:()=>({captureEntry(){}})
  });
  page.setData=values=>Object.assign(page.data,values);
  page.onLoad({});
  assert.equal(route,'/pages/demo/index');assert.equal(calls,0);
});

test('demo selection page enters chosen account and restarts page stack',async()=>{
  const f=fixture();let page,route;const app={globalData:{}};
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/demo/index.js','utf8'),{
    require:name=>name.includes('/demo/')?f.demo:require('../miniprogram/utils/constants'),
    Page:p=>{page=p;},wx:{reLaunch:o=>{route=o.url;}},getApp:()=>app
  });
  page.setData=values=>Object.assign(page.data,values);
  await page.onShow();assert.equal(page.data.accounts.length,5);
  await page.enter({currentTarget:{dataset:{id:uid('demo_staff_a')}}});
  assert.equal(app.globalData.user.role,'store');assert.equal(route,'/pages/home/index');assert.equal(page.data.busy,false);
});

test('single-store demo ignores legacy two-store data and sessions without deleting them',async()=>{
  const f=fixture();const legacy={version:1,collections:{stores:{other:{_id:'other'}}}};
  f.storage.set('yuanlin.demo.data.v1',legacy);f.storage.set('yuanlin.demo.session.v1',{openid:'demo_staff_b',token:'old'});
  assert.equal(f.demo.hasSession(),false);
  assert.equal((await f.demo.stores()).length,1);
  const accounts=await f.demo.accounts();assert.equal(accounts.length,5);assert(accounts.every(u=>u.storeId==='main'));
  assert.deepEqual(f.storage.get('yuanlin.demo.data.v1'),legacy);
  await fails(f.login('staff_b'),'INVALID');
});


test('single-store demo supports service and banner CRUD across roles and rejects customer writes',async()=>{
 const f=fixture();await f.login('admin');
 const service=await f.demo.call('admin.serviceSave',{name:'洗鞋',description:'联系门店咨询',category:'laundry',enabled:true});
 const banner=await f.demo.call('admin.bannerSave',{title:'活动',subtitle:'演示广告',weight:999,enabled:true,mediaType:'image',mediaFileID:'wxfile://tmp/poster.jpg'});
 await f.login('customer_a');assert.ok((await f.demo.call('services.list')).items.some(s=>s._id===service.id));assert.equal((await f.demo.call('banners.list')).items[0].mediaFileID,'wxfile://tmp/poster.jpg');
 await fails(f.demo.call('admin.bannerDelete',{id:banner.id}),'FORBIDDEN');
 await f.login('admin');await f.demo.call('admin.bannerDelete',{id:banner.id});await f.demo.call('admin.serviceDelete',{id:service.id});
 assert.ok(!(await f.demo.call('services.list')).items.some(s=>s._id===service.id));assert.ok(!(await f.demo.call('banners.list')).items.some(s=>s._id===banner.id));assert.equal((await f.demo.stores()).length,1);
});
test('demo registration supports other-campus location using the cloud validation rules',async()=>{
 const f=fixture();const user=await f.demo.register({nickname:'新邻居',park:'其它',parkDetail:'测试楼',gender:'不愿透露',storeId:'main'});assert.equal(user.parkDetail,'测试楼');
});


test('demo dorm room uses shared persistence and validation',async()=>{
 const f=fixture();const user=await f.demo.register({nickname:'新同学',park:'一园区',gender:'不愿透露',storeId:'main',dormRoom:'5栋101'});
 assert.equal(user.dormRoom,'5栋101');f.demo.leave();await f.demo.login(user._id);assert.equal((await f.demo.call('me')).user.dormRoom,'5栋101');
});
