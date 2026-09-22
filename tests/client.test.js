const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
function page(name, api = {}, wx = {}, app = {globalData:{}}, timers = {setTimeout,clearTimeout}) {
  let result;
  const code = fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.js'),'utf8');
  vm.runInNewContext(code,{require: name => name.endsWith('/api') ? api : name.endsWith('/config') ? {devLogin:true} : require('../miniprogram/utils/constants'),Page: p => {result=p;},getApp:()=>app,wx,console,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,Map,Date,Math});
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

function fakeTimers() {
  let next = 0;
  const jobs = new Map();
  return { jobs, setTimeout(fn) { jobs.set(++next, fn); return next; }, clearTimeout(id) { jobs.delete(id); } };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('inbox refresh preserves all loaded pages and updates room ordering', async () => {
  const timers = fakeTimers();
  let rows = Array.from({length:45},(_,i)=>({_id:'r'+i,lastMessageAt:i}));
  const p = page('inbox', {guard:async()=>({user:{role:'store'}}),time:()=>'',call:async(a,d)=>({items:rows.slice(d.page*20,d.page*20+20)})}, {}, undefined, timers);
  await p.onShow(); await p.load();
  assert.equal(p.data.items.length,40);
  rows = [rows[30], ...rows.filter(x=>x._id!=='r30')];
  await p.refresh();
  assert.equal(p.data.items.length,40); assert.equal(p.data.page,1);
  assert.equal(p.data.items[0]._id,'r30'); assert.equal(new Set(p.data.items.map(x=>x._id)).size,40);
  assert.equal(timers.jobs.size,1); p.stop(); assert.equal(timers.jobs.size,0);
});

test('inbox hides pending responses and keeps only one poll after rapid reentry', async () => {
  const timers=fakeTimers(), slow=deferred(), started=deferred(); let calls=0;
  const p=page('inbox',{guard:async()=>({user:{role:'store'}}),time:()=>'',call:()=>{if(++calls===1){started.resolve();return slow.promise;}return Promise.resolve({items:[{_id:'new'}]});}},{},undefined,timers);
  const first=p.onShow(); await started.promise; p.onHide();
  await p.onShow(); slow.resolve({items:[{_id:'stale'}]}); await first;
  assert.equal(p.data.items[0]._id,'new'); assert.equal(timers.jobs.size,1);
  p.onHide(); assert.equal(timers.jobs.size,0);
});

test('inbox failure while refreshing later pages preserves existing list',async()=>{
  const timers=fakeTimers(); let fail=false;
  const p=page('inbox',{guard:async()=>({user:{role:'store'}}),time:()=>'',call:async(a,d)=>{
    if(fail&&d.page===1)throw Error('offline');
    return{items:Array.from({length:20},(_,i)=>({_id:'r'+(d.page*20+i)}))};
  }},{},undefined,timers);
  await p.onShow();await p.load();fail=true;await p.refresh();
  assert.equal(p.data.items.length,40);assert.equal(p.data.page,1);assert.equal(p.data.error,'offline');p.stop();
});

test('staff ignores stale notification responses and stops every timer',async()=>{
  const timers=fakeTimers(),slow=deferred();let requests=0;
  const p=page('staff',{time:()=>'',call:()=>++requests===1?slow.promise:Promise.resolve({items:[{_id:'new',unread:true}]})},{showToast(){}},undefined,timers);
  p.generation=1;p.visible=true;const first=p.poll();p.stop();p.visible=true;
  await p.poll();slow.resolve({items:[{_id:'old',unread:true}]});await first;
  assert.equal(p.data.notifications[0]._id,'new');assert.equal(timers.jobs.size,1);p.stop();assert.equal(timers.jobs.size,0);
});

test('staff read submits only displayed unread ids and ignores a pending stale poll',async()=>{
  const timers=fakeTimers(),slow=deferred();let polls=0,payload;
  const p=page('staff',{time:()=>'',call:async(a,d)=>{
    if(a==='staff.readNotifications'){payload=d;return{};}
    if(++polls===1)return slow.promise;
    return{items:[{_id:'shown',unread:false},{_id:'arrived',unread:true}]};
  }},{showToast(){}},undefined,timers);
  p.generation=1;p.visible=true;p.data.notifications=[{_id:'shown',unread:true},{_id:'already',unread:false}];
  const pending=p.poll();await p.read();slow.resolve({items:[{_id:'shown',unread:true}]});await pending;
  assert.deepEqual(Array.from(payload.ids),['shown']);
  assert.equal(p.data.unread,1);assert.equal(p.data.notifications[0].unread,false);
  assert.equal(timers.jobs.size,1);p.stop();
});

test('chat only advances read position after success and retries failed acknowledgements',async()=>{
  const timers=fakeTimers();let reads=0,fail=true,seq=1;
  const p=page('chat',{time:()=>'',call:async(a)=>{
    if(a==='chat.messages')return{items:[{_id:'m'+seq,seq,senderId:'other'}],latestSeq:seq,more:false};
    reads++;if(fail)throw Error('offline');return{};
  }},{},undefined,timers);
  p.onLoad({id:'room'});p.generation=1;p.visible=true;
  await p.refresh();assert.equal(reads,1);assert.equal(p.readSeq,0);
  fail=false;await p.refresh();await p.refresh();assert.equal(reads,2);assert.equal(p.readSeq,1);
  seq=2;await p.refresh();assert.equal(reads,3);assert.equal(p.readSeq,2);p.stop();
});

test('chat does not mark hidden responses read or create timers after leaving',async()=>{
  const timers=fakeTimers(),slow=deferred();let reads=0;
  const p=page('chat',{time:()=>'',call:async a=>{if(a==='chat.messages')return slow.promise;reads++;return{};}},{},undefined,timers);
  p.onLoad({id:'room'});p.generation=1;p.visible=true;const pending=p.refresh();p.stop();
  slow.resolve({items:[{_id:'m1',seq:1}],latestSeq:1,more:false});await pending;
  assert.equal(reads,0);assert.equal(p.data.items.length,0);assert.equal(timers.jobs.size,0);
});

test('phone privacy scope errors explain service unavailability without calling backend',async()=>{
  for(const detail of [
    {errno:112,errMsg:'getPhoneNumber:fail'},
    {errMsg:'getPhoneNumber:fail api scope is not declared in the privacy agreement'},
    {errMsg:'getPhoneNumber:fail appid privacy api banned'}
  ]) {
    let calls=0;
    const p=page('auth',{call:async()=>calls++});
    p.data.consent=true;
    await p.authorize({detail});
    assert.equal(calls,0);assert.match(p.data.error,/隐私配置/);assert.equal(p.data.busy,false);
  }
});

test('privacy refusal stays recoverable without requesting a phone exchange',async()=>{
  let calls=0;const p=page('auth',{call:async()=>calls++});
  p.data.consent=true;
  await p.authorize({detail:{errno:104,errMsg:'getPhoneNumber:fail privacy permission is not authorized'}});
  assert.equal(calls,0);assert.match(p.data.error,/隐私保护指引/);assert.equal(p.data.busy,false);
});

test('missing phone event detail is handled as recoverable authorization failure',async()=>{
  let calls=0;const p=page('auth',{call:async()=>calls++});p.data.consent=true;
  await p.authorize({});
  assert.equal(calls,0);assert.match(p.data.error,/重新尝试/);
});


test('other-campus registration forwards detail and blocks an empty location',async()=>{
  let submitted;const p=page('auth',{call:async(a,d)=>{submitted=d;return {token:'t',user:{}};}},{setStorageSync(){},switchTab(){}});
  Object.assign(p.data,{consent:true,nickname:'邻居',stores:[{_id:'main'}],parkIndex:p.data.parks.indexOf('其它')});
  await p.authorize({detail:{code:'verified'}});assert.equal(submitted,undefined);assert.match(p.data.error,/具体园区/);
  p.data.parkDetail='青教公寓1号楼';await p.authorize({detail:{code:'verified'}});
  assert.equal(submitted.parkDetail,'青教公寓1号楼');assert.equal(require('../cloudfunctions/api/domain').profile(submitted).parkDetail,'青教公寓1号楼');
});
test('development phone login is blocked on release and unknown runtimes',async()=>{
  for(const version of ['release','unknown']){
    let calls=0;const p=page('auth',{call:async()=>{calls++;}},{getAccountInfoSync:()=>({miniProgram:{envVersion:version}})});
    Object.assign(p.data,{consent:true,mode:'login'});await p.devAuth();assert.equal(calls,0);assert.match(p.data.error,/不支持开发登录/);
  }
  let code;const p=page('auth',{call:async(a,d)=>{code=d.code;return {token:'t',user:{}};}},{getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),setStorageSync(){},switchTab(){}});
  Object.assign(p.data,{consent:true,mode:'login'});await p.devAuth();assert.equal(code,'dev:13000000001');
});
test('profile nickname input remains wired to the generic field handler',()=>{
  const template=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/profile/index.wxml'),'utf8');
  const input=template.match(/<input[^>]*value="{{nickname}}"[^>]*>/)[0];
  const key=input.match(/data-key="([^"]+)"/)[1];const p=page('profile');
  p.input({currentTarget:{dataset:{key}},detail:{value:'新昵称'}});assert.equal(p.data.nickname,'新昵称');
});
test('banner retry reuses uploaded file after failed save',async()=>{
  let uploads=0,calls=0;const p=page('admin',{call:async()=>{if(++calls===1)throw Error('offline');}},{cloud:{uploadFile:async()=>{uploads++;return {fileID:'cloud://env/banners/a.jpg'};}},showToast(){}});p.load=async()=>{};
  Object.assign(p.data,{bannerTitle:'活动',bannerSubtitle:'欢迎',bannerWeight:50,bannerMediaType:'image',bannerMedia:'wxfile://tmp/a.jpg'});
  await p.saveBanner();assert.equal(p.data.bannerMedia,'cloud://env/banners/a.jpg');await p.saveBanner();assert.equal(uploads,1);assert.equal(calls,2);
});


test('registration and profile form submit and restore dorm room',async()=>{
 let data;const auth=page('auth',{call:async(a,d)=>{data=d;return {token:'t',user:{}};}},{setStorageSync(){},switchTab(){}});
 Object.assign(auth.data,{consent:true,nickname:'邻居',stores:[{_id:'main'}]});auth.dormRoom({detail:{value:'3栋502'}});
 await auth.authorize({detail:{code:'phone'}});assert.equal(data.dormRoom,'3栋502');
 const user={nickname:'邻居',park:'一园区',gender:'男',dormRoom:'3栋502'};
 const profile=page('profile',{guard:async()=>({user}),call:async(a,d)=>{data=d;return {user:{...user,...d}};}},{showToast(){}});
 await profile.load();assert.equal(profile.data.dormRoom,'3栋502');
 profile.input({currentTarget:{dataset:{key:'dormRoom'}},detail:{value:'A-601'}});await profile.save();assert.equal(data.dormRoom,'A-601');
});

test('order and runner media always upload to cloud',async()=>{
 for(const name of ['order/create','runner/apply']){
  let uploads=0,selection;const p=page(name,{guard:async()=>({user:{phone:'13800000001',park:'一园区'}}),call:async a=>a==='services.list'?{items:[]}:{runnerFee:300}},
  {getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),chooseMedia:opts=>{selection=opts;},cloud:{uploadFile:async()=>{uploads++;return {fileID:'cloud://test/photo'};}}});
  await p.load();if(name==='order/create')await p.addPhoto();else await p.pick({currentTarget:{dataset:{key:'idCard'}}});
  await selection.success({tempFiles:[{tempFilePath:'wxfile://tmp/photo.jpg'}]});
  assert.equal(uploads,1);assert.equal(name==='order/create'?p.data.media[0]:p.data.idCard,'cloud://test/photo');
 }
});
test('runner placeholder photo control is unavailable in release cloud mode',async()=>{
 const p=page('runner/apply',{guard:async()=>({demoMode:false,user:{}})},{getAccountInfoSync:()=>({miniProgram:{envVersion:'release'}})});await p.load();p.skipPhotos();assert.equal(p.data.devLogin,false);assert.equal(p.data.idCard,'');
});

test('banner upload freezes target and fields while edit and clear actions are blocked',async()=>{
 let uploadDone,sent;const p=page('admin',{call:async(a,d)=>{sent=d;}},{cloud:{uploadFile:()=>new Promise(r=>{uploadDone=r;})},showToast(){}});p.load=async()=>{};
 Object.assign(p.data,{bannerId:'a',bannerTitle:'A',bannerSubtitle:'说明A',bannerMediaType:'image',bannerMedia:'wxfile://a',bannerWeight:50,bannerEnabled:true,banners:[{_id:'b',title:'B'}]});
 const saving=p.saveBanner();p.editBanner({currentTarget:{dataset:{id:'b'}}});p.newBanner();p.removeBannerMedia();p.bannerEnabled({detail:{value:false}});p.input({currentTarget:{dataset:{key:'bannerTitle'}},detail:{value:'B'}});
 assert.equal(p.data.bannerId,'a');assert.equal(p.data.bannerTitle,'A');
 uploadDone({fileID:'cloud://a'});await saving;assert.equal(sent.id,'a');assert.equal(sent.title,'A');assert.equal(sent.enabled,true);assert.equal(sent.mediaType,'image');assert.equal(p.data.bannerId,'');
});
test('banner create retry preserves request identity and a fresh draft gets a different identity',async()=>{
 const requests=[];const p=page('admin',{call:async(a,d)=>{requests.push(d.requestId);if(requests.length===1)throw Error('response lost');return {id:'created'};}},{showToast(){}});p.load=async()=>{};
 const draft={bannerTitle:'活动',bannerSubtitle:'说明',bannerWeight:20};Object.assign(p.data,draft);await p.saveBanner();await p.saveBanner();assert.ok(requests[0]);assert.equal(requests[0],requests[1]);
 Object.assign(p.data,draft);await p.saveBanner();assert.notEqual(requests[2],requests[0]);
});
test('home services and banners render independently when either request fails',async()=>{
 for(const failed of ['banners.list','services.list']){
  const p=page('home',{guard:async()=>({user:{role:'customer'}}),call:async a=>{if(a===failed)throw Error('offline');return {items:[{_id:a,category:'laundry'}]};}});
  await p.load();assert.equal(p.data.services.length,failed==='services.list'?0:1);assert.equal(p.data.banners.length,failed==='banners.list'?0:1);assert.match(p.data.error,/offline/);assert.equal(p.data.loading,false);
 }
});

test('auth entry loads cloud login directly with no demo redirect',()=>{
 const p=page('auth',{}, {getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}})}, {globalData:{},captureEntry(){}});let loaded=0;p.load=()=>{loaded++;};p.onLoad();assert.equal(loaded,1);assert.equal(p.data.devLogin,true);
});
test('API ignores legacy demo storage and preserves cloud sessions on ordinary calls',async()=>{
 const values=new Map([['session','cloud-token'],['yuanlin.demo.session.v2',{token:'old-demo'}],['devActor','13000000001']]);let request;const app={globalData:{cloudReady:true}};const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/api.js'),'utf8'),{module,require:()=>({devLogin:true}),getApp:()=>app,wx:{getStorageSync:k=>values.get(k),removeStorageSync:k=>values.delete(k),cloud:{callFunction:async r=>{request=r;return {result:{ok:true,data:{user:{_id:'cloud-user'}}}};}}}});
 const r=await module.exports.call('me');assert.equal(r.user._id,'cloud-user');assert.equal(request.data.token,'cloud-token');assert.equal(request.data.devActor,'13000000001');module.exports.clear();assert.equal(values.has('session'),false);assert.equal(values.has('yuanlin.demo.session.v2'),true);
});


test('catalog order page restores dorm address and submits house appointment without delivery pickup',async()=>{
 const item={_id:'house',name:'2小时深度保洁',category:'housekeeping',unit:'间',variants:[{id:'0',name:'整间套餐',price:11900}]};let sent;
 const api={guard:async()=>({user:{role:'customer',phone:'13800000001',park:'一园区',dormRoom:'3栋502'}}),call:async(a,d)=>{if(a==='services.list')return {items:[item]};if(a==='order.config')return {runnerFee:0};sent=d;return {};}};
 const p=page('order/create',api,{showToast(){}},{globalData:{}},{setTimeout(){},clearTimeout(){}});p.preset='house';await p.load();
 assert.equal(p.data.parkDetail,'3栋502');assert.equal(p.data.delivery,'onsite');assert.equal(p.data.amountText,'119.00');
 await p.submit();assert.match(p.data.error,/预约/);assert.equal(sent,undefined);
 p.setData({appointmentDate:'2027-01-16',appointmentTime:'12:00'});await p.submit();assert.equal(sent.appointment,'2027-01-16 12:00');assert.equal(sent.quantity,1);assert.equal(sent.variantId,'0');assert.equal(sent.delivery,'onsite');assert.equal(sent.serviceAmount,undefined);
});

test('laundry specification and quantity update displayed amount and reject fractional pieces',async()=>{
 const p=page('order/create');p.setData({services:[{unit:'件'}],variants:[{id:'0',price:2000},{id:'1',price:4000}],quantity:'2',loading:false});
 p.select({currentTarget:{dataset:{key:'variantIndex'}},detail:{value:'1'}});assert.equal(p.data.amountText,'80.00');
 p.input({currentTarget:{dataset:{key:'quantity'}},detail:{value:'1.5'}});await p.submit();assert.match(p.data.error,/有效数量/);
});
