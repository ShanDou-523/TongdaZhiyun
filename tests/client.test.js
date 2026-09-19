const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
function page(name, api = {}, wx = {}, app = {globalData:{}}, timers = {setTimeout,clearTimeout}) {
  let result;
  const code = fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.js'),'utf8');
  vm.runInNewContext(code,{require: name => name.endsWith('/api') ? api : require('../miniprogram/utils/constants'),Page: p => {result=p;},getApp:()=>app,wx,console,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,Map,Date,Math});
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
