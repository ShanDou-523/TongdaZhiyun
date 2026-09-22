const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../cloudfunctions/api/service');
const { uid, hash, resolveOpenid, escapeRegExp } = require('../cloudfunctions/api/domain');

class MemoryRepository {
  constructor() { this.data = {}; this.queue = Promise.resolve(); }
  async get(c, id) { return structuredClone(this.data[c]?.[id] || null); }
  async put(c, id, data) { (this.data[c] ||= {})[id] = structuredClone({ ...data, _id: id }); }
  async remove(c, id) { delete (this.data[c] || {})[id]; }
  async list(c, filter, options = {}) {
    let rows = Object.values(this.data[c] || {}).filter(x => Object.entries(filter).every(([k,v]) => x[k] === v));
    if (options.search && options.search.keyword) {
      const kw = String(options.search.keyword).toLowerCase();
      rows = rows.filter(x => options.search.fields.some(f => String(x[f] || '').toLowerCase().includes(kw)));
    }
    if (options.before !== undefined) rows = rows.filter(x => x[options.order] < options.before);
    rows.sort((a,b) => (a[options.order] - b[options.order]) * (options.direction === 'asc' ? 1 : -1));
    return structuredClone(rows.slice(options.skip || 0, (options.skip || 0) + (options.limit || 20)));
  }
  transaction(fn) {
    const job = this.queue.then(async () => { const snapshot = structuredClone(this.data); try { return await fn(this); } catch (error) { this.data = snapshot; throw error; } });
    this.queue = job.catch(() => {}); return job;
  }
}
async function fixture() {
  const repo = new MemoryRepository(); let now = 1800000000000; const deletedFiles = [];
  await repo.put('stores', 'main', { name: '测试门店', enabled: true, createdAt: now });
  await repo.put('stores', 'other', { name: '另一门店', enabled: true, createdAt: now });
  const service = createService({ repo, clock: () => now, bootstrapOpenid: 'admin', storageDelete: async id => { deletedFiles.push(id); }, phoneExchange: async code => {
    if (code === 'reject') throw new Error('expired');
    return { purePhoneNumber: code, countryCode: '86' };
  }, qrCode: async (store, version) => `cloud://${store}/${version}` });
  const call = (openid, token, action, data = {}) => service({ token, action, data }, { openid });
  const register = (openid, phone, more = {}) => call(openid, '', 'auth.phone', { mode: 'register', consent: true, code: phone, nickname: '邻居', park: '一园区', gender: '不愿透露', storeId: 'main', ...more });
  const provision = async (openid, role, storeId = 'main') => { const u = await repo.get('users', uid(openid)); await repo.put('users', u._id, {...u,role,storeId}); };
  return { repo, service, call, register, provision, deletedFiles, tick(ms = 1000) { now += ms; } };
}
const fails = (promise, code) => assert.rejects(promise, e => e.code === code);
test('admin manages the service catalog; customers cannot write and changes are audited',async()=>{
  const f=await fixture(),admin=await f.register('admin','13800000001'),c=await f.register('c','13800000002');
  await fails(f.call('c',c.token,'admin.services'),'FORBIDDEN');
  await fails(f.call('c',c.token,'admin.serviceSave',{name:'衣物洗护',category:'laundry',description:'干净清爽',enabled:true}),'FORBIDDEN');
  assert.deepEqual((await f.call('admin',admin.token,'admin.services')).items,[]);
  await fails(f.call('admin',admin.token,'admin.serviceSave',{name:'家政服务',category:'meal',description:'x',enabled:true}),'INVALID');
  await fails(f.call('admin',admin.token,'admin.serviceSave',{name:' ',category:'laundry',description:'x',enabled:true}),'INVALID');
  await fails(f.call('admin',admin.token,'admin.serviceSave',{name:'家政服务',category:'laundry',description:'x',enabled:'yes'}),'INVALID');
  await fails(f.call('admin',admin.token,'admin.serviceSave',{id:'missing',name:'家政服务',category:'laundry',description:'x',enabled:true}),'INVALID');
  const created=await f.call('admin',admin.token,'admin.serviceSave',{name:'衣物洗护',category:'laundry',description:'干净清爽，轻装出发',enabled:true});
  assert.equal((await f.call('admin',admin.token,'admin.services')).items.length,1);
  assert.equal((await f.call('c',c.token,'services.list')).items.length,1);
  await f.call('admin',admin.token,'admin.serviceSave',{id:created.id,name:'衣物洗护（改）',category:'housekeeping',description:'按件计价',enabled:false});
  const saved=(await f.call('admin',admin.token,'admin.services')).items[0];
  assert.equal(saved.name,'衣物洗护（改）');assert.equal(saved.category,'housekeeping');
  assert.equal((await f.call('c',c.token,'services.list')).items.length,0);
  await f.call('admin',admin.token,'admin.serviceDelete',{id:created.id});
  assert.equal((await f.call('admin',admin.token,'admin.services')).items.length,0);
  await fails(f.call('admin',admin.token,'admin.serviceDelete',{id:created.id}),'INVALID');
  const actions=Object.values(f.repo.data.auditLogs).map(x=>x.action);
  assert.ok(actions.includes('service.save')&&actions.includes('service.delete'));
});
test('banners: admin CRUD, weight ordering, only enabled reach the client home page',async()=>{
  const f=await fixture(),admin=await f.register('admin','13800000001'),c=await f.register('c','13800000002');
  await fails(f.call('c',c.token,'admin.bannerSave',{title:'新用户福利',subtitle:'注册即领 10 元现金红包，3 万元送完即止',weight:100,enabled:true}),'FORBIDDEN');
  await fails(f.call('c',c.token,'admin.banners'),'FORBIDDEN');
  await fails(f.call('admin',admin.token,'admin.bannerSave',{title:'新用户福利',subtitle:'注册即领 10 元现金红包',weight:'9',enabled:true}),'INVALID');
  await fails(f.call('admin',admin.token,'admin.bannerSave',{title:'新用户福利',subtitle:'注册即领 10 元现金红包',weight:100,enabled:'yes'}),'INVALID');
  const a=await f.call('admin',admin.token,'admin.bannerSave',{title:'新用户福利',subtitle:'注册即领 10 元现金红包，3 万元送完即止',weight:100,enabled:true});
  const b=await f.call('admin',admin.token,'admin.bannerSave',{title:'开学季洗护特惠',subtitle:'首单衣物洗护 8 折',weight:50,enabled:true});
  const off=await f.call('admin',admin.token,'admin.bannerSave',{title:'已停投',subtitle:'x',weight:10,enabled:false});
  assert.deepEqual((await f.call('c',c.token,'banners.list')).items.map(x=>x._id),[a.id,b.id],'权重降序，停投被过滤');
  await fails(f.call('admin',admin.token,'admin.bannerSave',{id:'missing',title:'x',subtitle:'y',weight:1,enabled:true}),'INVALID');
  await f.call('admin',admin.token,'admin.bannerSave',{id:b.id,title:'开学季洗护特惠',subtitle:'首单衣物洗护 7 折',weight:50,enabled:false});
  assert.equal((await f.call('c',c.token,'banners.list')).items.length,1,'停投后从首页消失');
  await f.call('admin',admin.token,'admin.bannerDelete',{id:off.id});
  await fails(f.call('admin',admin.token,'admin.bannerDelete',{id:off.id}),'INVALID');
  assert.equal((await f.call('admin',admin.token,'admin.banners')).items.length,2);
  const actions=Object.values(f.repo.data.auditLogs).map(x=>x.action);
  assert.ok(actions.includes('banner.save')&&actions.includes('banner.delete'));
});
test('banners media: image/video fileID validated, shared assets retained on replace and delete',async()=>{
  const f=await fixture(),admin=await f.register('admin','13800000001');
  await fails(f.call('admin',admin.token,'admin.bannerSave',{title:'x',subtitle:'y',weight:1,enabled:true,mediaType:'gif'}),'INVALID');
  await fails(f.call('admin',admin.token,'admin.bannerSave',{title:'x',subtitle:'y',weight:1,enabled:true,mediaType:'image'}),'INVALID');
  await fails(f.call('admin',admin.token,'admin.bannerSave',{title:'x',subtitle:'y',weight:1,enabled:true,mediaType:'image',mediaFileID:'http://evil.com/a.jpg'}),'INVALID');
  const a=await f.call('admin',admin.token,'admin.bannerSave',{title:'海报',subtitle:'新用户注册送 10 元',weight:100,enabled:true,mediaType:'image',mediaFileID:'cloud://env/banners/a.png'});
  const saved=(await f.call('admin',admin.token,'admin.banners')).items[0];
  assert.equal(saved.mediaType,'image');assert.equal(saved.mediaFileID,'cloud://env/banners/a.png');
  assert.deepEqual(f.deletedFiles,[],'首次保存不清理任何文件');
  await f.call('admin',admin.token,'admin.bannerSave',{id:a.id,title:'海报',subtitle:'新用户注册送 10 元',weight:100,enabled:true,mediaType:'video',mediaFileID:'cloud://env/banners/b.mp4'});
  assert.deepEqual(f.deletedFiles,[],'素材引用删除不触发物理文件删除');
  await f.call('admin',admin.token,'admin.bannerSave',{id:a.id,title:'海报',subtitle:'新用户注册送 10 元',weight:100,enabled:true,mediaType:'none'});
  assert.deepEqual(f.deletedFiles,[],'素材引用删除不触发物理文件删除');
  const c=await f.call('admin',admin.token,'admin.bannerSave',{title:'视频',subtitle:'x',weight:1,enabled:true,mediaType:'video',mediaFileID:'cloud://env/banners/c.mp4'});
  await f.call('admin',admin.token,'admin.bannerDelete',{id:c.id});
  assert.deepEqual(f.deletedFiles,[],'素材引用删除不触发物理文件删除');
});
test('park 其它 requires a short free-text detail; normal parks ignore it', async () => {
  const f = await fixture();
  await fails(f.call('c','','auth.phone',{mode:'register',consent:true,code:'13800000001',nickname:'邻居',park:'其它',gender:'不愿透露',storeId:'main'}),'INVALID');
  const r = await f.register('c','13800000001',{park:'其它',parkDetail:'青教公寓1号楼'});
  assert.equal(r.user.park,'其它'); assert.equal(r.user.parkDetail,'青教公寓1号楼');
  await fails(f.call('c',r.token,'profile.update',{nickname:'邻居',park:'其它',gender:'不愿透露'}),'INVALID');
  const u = await f.call('c',r.token,'profile.update',{nickname:'邻居',park:'其它',parkDetail:'主校区南门',gender:'不愿透露'});
  assert.equal(u.user.parkDetail,'主校区南门');
  const v = await f.call('c',r.token,'profile.update',{nickname:'邻居',park:'十一园区',parkDetail:'应被清空',gender:'不愿透露'});
  assert.ok(!v.user.parkDetail,'非其它园区清空自填字段');
});
test('registration uses verified phone, ignores forged role and identity; notification is atomic', async () => {
  const f = await fixture(); const r = await f.register('customer','13800000001',{role:'admin',phone:'13900000000',openid:'admin'});
  assert.equal(r.user.role,'customer'); assert.equal(r.user.phone,'13800000001'); assert.equal(r.user._id,uid('customer'));
  assert.equal(Object.keys(f.repo.data.notifications).length,1); assert.equal(r.user.sessionHash,undefined);
  const saved=await f.repo.get('users',r.user._id);assert.equal(saved.sessionHash,hash(r.token));assert.notEqual(saved.sessionHash,r.token);
});
test('login and every registration require consent, phone code and valid profile', async () => {
  const f=await fixture();await fails(f.register('a','13800000001',{consent:false}),'INVALID');
  await fails(f.register('a','reject'),'PHONE');await fails(f.register('a','fake'),'PHONE');
  await fails(f.register('a','13800000001',{park:'十二园区'}),'INVALID');
  await fails(f.register('a','13800000001',{nickname:' '}),'INVALID');
  await fails(f.register('a','13800000001',{gender:'未知'}),'INVALID');
  await fails(f.register('a','13800000001',{storeId:'missing'}),'INVALID');
  assert.equal(Object.keys(f.repo.data.users || {}).length,0);
  await fails(f.call('a','','auth.phone',{mode:'login',consent:true,code:'13800000001'}),'NOT_REGISTERED');
});
test('same phone cannot create a second account; concurrent registrations emit one notice', async () => {
  const f=await fixture();await Promise.all([f.register('a','13800000001'),f.register('a','13800000001')]);
  assert.equal(Object.keys(f.repo.data.notifications).length,1);assert.equal(Object.keys(f.repo.data.users).length,1);
  await fails(f.register('b','13800000001'),'PHONE_BOUND');
});
test('session is bound to wx identity; expired, logged out and forged sessions fail', async () => {
  const f=await fixture();const a=await f.register('a','13800000001');
  await fails(f.call('b',a.token,'me'),'AUTH');await fails(f.call('a','x'.repeat(64),'me'),'AUTH');
  await f.call('a',a.token,'logout');await fails(f.call('a',a.token,'me'),'AUTH');
  const b=await f.register('a','13800000001');f.tick(8*86400000);await fails(f.call('a',b.token,'me'),'AUTH');
});
test('repeat login preserves profile and rejects a changed phone', async () => {
  const f=await fixture();const a=await f.register('a','13800000001');
  const b=await f.register('a','13800000001',{nickname:'覆盖',park:'二园区'});assert.equal(b.user.nickname,'邻居');
  await fails(f.call('a',a.token,'me'),'AUTH');await fails(f.register('a','13800000002'),'PHONE_CHANGED');
});
test('customers and other stores cannot access private resources or administration', async () => {
  const f=await fixture();const a=await f.register('a','13800000001'),b=await f.register('b','13800000002'),s=await f.register('s','13800000003');
  await f.provision('s','store','other');const room=await f.call('a',a.token,'chat.open');
  for(const action of ['chat.messages','chat.send','chat.read']){
    const data={roomId:room.roomId,content:'hello',requestId:'test',seq:0};
    await fails(f.call('b',b.token,action,data),'FORBIDDEN');await fails(f.call('s',s.token,action,data),'FORBIDDEN');
  }
  for(const action of ['admin.stores','admin.inspect','staff.customers','staff.notifications'])await fails(f.call('a',a.token,action,{collection:'users'}),'FORBIDDEN');
  assert.deepEqual((await f.call('s',s.token,'staff.customers')).items,[]);
});
test('chat is bidirectional, ordered, idempotent, read positions never clear unseen messages', async () => {
  const f=await fixture();const c=await f.register('c','13800000001'),s=await f.register('s','13800000002');await f.provision('s','store');
  const room=await f.call('c',c.token,'chat.open');assert.equal((await f.call('s',s.token,'chat.open',{customerId:c.user._id})).roomId,room.roomId);
  const payload={roomId:room.roomId,content:'您好',requestId:'request_1'};
  const [one,two]=await Promise.all([f.call('c',c.token,'chat.send',payload),f.call('c',c.token,'chat.send',payload)]);
  assert.equal(one.message._id,two.message._id);assert.equal(Object.keys(f.repo.data.messages).length,1);
  await fails(f.call('c',c.token,'chat.send',{...payload,content:'改了'}),'INVALID');
  assert.equal((await f.call('s',s.token,'chat.rooms')).items[0].unread,true);
  await f.call('s',s.token,'chat.read',{roomId:room.roomId,seq:1});
  assert.equal((await f.call('s',s.token,'chat.rooms')).items[0].unread,false);
  await f.call('s',s.token,'chat.send',{...payload,content:'你好，可以帮到你什么？'});
  const messages=await f.call('c',c.token,'chat.messages',{roomId:room.roomId});assert.deepEqual(messages.items.map(m=>m.seq),[1,2]);
  await f.call('c',c.token,'chat.read',{roomId:room.roomId,seq:1});assert.equal((await f.call('c',c.token,'chat.rooms')).items[0].unread,true);
  await fails(f.call('c',c.token,'chat.read',{roomId:room.roomId,seq:999}),'INVALID');
});
test('message pagination has no overlap; rate and length limits enforced', async () => {
  const f=await fixture(),c=await f.register('c','13800000001'),room=await f.call('c',c.token,'chat.open');
  for(let i=1;i<=35;i++){f.tick();await f.call('c',c.token,'chat.send',{roomId:room.roomId,content:'消息'+i,requestId:'req'+i});}
  await fails(f.call('c',c.token,'chat.send',{roomId:room.roomId,content:'过快',requestId:'fast'}),'RATE');
  await fails(f.call('c',c.token,'chat.send',{roomId:room.roomId,content:'x'.repeat(1001),requestId:'long'}),'INVALID');
  const latest=await f.call('c',c.token,'chat.messages',{roomId:room.roomId});assert.equal(latest.items.length,30);assert.equal(latest.items[0].seq,6);
  const older=await f.call('c',c.token,'chat.messages',{roomId:room.roomId,before:6});assert.deepEqual(older.items.map(x=>x.seq),[1,2,3,4,5]);
});
test('admin role changes revoke sessions, cannot grant admin or modify self; audit is recorded',async()=>{
  const f=await fixture(),admin=await f.register('admin','13800000001'),u=await f.register('u','13800000002');
  const data={id:u.user._id,enabled:true,role:'store',storeId:'main'};
  await fails(f.call('u',u.token,'admin.userUpdate',data),'FORBIDDEN');
  await fails(f.call('admin',admin.token,'admin.userUpdate',{...data,role:'admin'}),'INVALID');
  await fails(f.call('admin',admin.token,'admin.userUpdate',{...data,id:admin.user._id}),'FORBIDDEN');
  await f.call('admin',admin.token,'admin.userUpdate',data);await fails(f.call('u',u.token,'me'),'AUTH');
  const again=await f.register('u','13800000002');assert.equal(again.user.role,'store');assert.equal(Object.keys(f.repo.data.auditLogs).length,1);
  const records=await f.call('admin',admin.token,'admin.inspect',{collection:'users'});assert(records.items.every(x=>!('sessionHash'in x)));
  await fails(f.call('admin',admin.token,'admin.inspect',{collection:'phoneClaims'}),'INVALID');
});
test('disabled accounts and stores deny access; notification reads belong to each employee',async()=>{
  const f=await fixture(),a=await f.register('a','13800000001'),s=await f.register('s','13800000002');await f.provision('s','store');
  const r=await f.call('s',s.token,'staff.notifications');assert.equal(r.items.length,2);
  await f.call('s',s.token,'staff.readNotifications',{ids:r.items.map(n=>n._id)});assert((await f.call('s',s.token,'staff.notifications')).items.every(n=>!n.unread));
  await f.repo.put('stores','main',{name:'测试',enabled:false});await fails(f.call('s',s.token,'me'),'FORBIDDEN');await fails(f.call('a',a.token,'chat.open'),'FORBIDDEN');
  const u=await f.repo.get('users',a.user._id);await f.repo.put('users',u._id,{...u,enabled:false});await fails(f.register('a','13800000001'),'FORBIDDEN');
});
test('public store listing hides disabled stores; QR generation requires admin and enabled store',async()=>{
  const f=await fixture();await f.repo.put('stores','closed',{enabled:false,createdAt:1});
  assert.equal((await f.call('','','public.stores')).items.length,2);
  const a=await f.register('admin','13800000001');
  assert.equal((await f.call('admin',a.token,'admin.qrcode',{storeId:'main',version:'trial'})).fileID,'cloud://main/trial');
  await fails(f.call('admin',a.token,'admin.qrcode',{storeId:'closed',version:'trial'}),'INVALID');
});
test('profile update cannot change phone, role, store or session',async()=>{
  const f=await fixture(),a=await f.register('a','13800000001');const r=await f.call('a',a.token,'profile.update',{nickname:'新昵称',park:'十园区',gender:'女',role:'admin',phone:'13900000001',storeId:'other',sessionHash:'x'});
  assert.equal(r.user.nickname,'新昵称');assert.equal(r.user.role,'customer');assert.equal(r.user.storeId,'main');assert.equal(r.user.phone,'13800000001');await f.call('a',a.token,'me');
});
test('storage failure during registration rolls back user, phone claim and notification',async()=>{
  const f=await fixture();const put=f.repo.put.bind(f.repo);f.repo.put=async(c,id,data)=>{if(c==='users')throw new Error('storage failure');return put(c,id,data);};
  await assert.rejects(f.register('a','13800000001'),/storage failure/);assert.equal(Object.keys(f.repo.data.phoneClaims||{}).length,0);assert.equal(Object.keys(f.repo.data.notifications||{}).length,0);
});

test('notification reads affect only selected ids, preserving older and same-time unseen notices',async()=>{
  const f=await fixture(),s=await f.register('s','13800000001');await f.provision('s','store');
  for(let i=0;i<50;i++)await f.repo.put('notifications','n'+i,{storeId:'main',createdAt:1800000001000+i});
  const first=await f.call('s',s.token,'staff.notifications');
  await f.repo.put('notifications','concurrent',{storeId:'main',createdAt:first.items[0].createdAt});
  await f.call('s',s.token,'staff.readNotifications',{ids:first.items.map(n=>n._id)});
  const all=[];
  for(let page=0;page<3;page++)all.push(...(await f.call('s',s.token,'staff.notifications',{page})).items);
  assert.equal(all.filter(n=>!n.unread).length,20);
  assert.equal(all.find(n=>n._id==='n0').unread,true);
  assert.equal(all.find(n=>n._id==='concurrent').unread,true);
  await f.call('s',s.token,'staff.readNotifications',{ids:first.items.map(n=>n._id)});
  assert.equal(Object.keys(f.repo.data.notificationReads).length,20);
});

test('notification reads are employee-specific and cannot target another store',async()=>{
  const f=await fixture(),s=await f.register('s','13800000001'),t=await f.register('t','13800000002');
  await f.provision('s','store');await f.provision('t','store');
  await f.repo.put('notifications','foreign',{storeId:'other',createdAt:1800000001000});
  const items=(await f.call('s',s.token,'staff.notifications')).items;
  await fails(f.call('s',s.token,'staff.readNotifications',{ids:[items[0]._id,'foreign']}),'FORBIDDEN');
  assert.equal(Object.keys(f.repo.data.notificationReads||{}).length,0);
  await f.call('s',s.token,'staff.readNotifications',{ids:[items[0]._id]});
  assert((await f.call('t',t.token,'staff.notifications')).items.every(n=>n.unread));
  await fails(f.call('s',s.token,'staff.readNotifications',{at:1800000000000}),'INVALID');
  await fails(f.call('s',s.token,'staff.readNotifications',{ids:[]}),'INVALID');
  await fails(f.call('s',s.token,'staff.readNotifications',{ids:Array(21).fill(items[0]._id)}),'INVALID');
});

test('legacy notification timestamps remain readable without being advanced by new reads',async()=>{
  const f=await fixture(),s=await f.register('s','13800000001');await f.provision('s','store');
  await f.repo.put('notificationReads',s.user._id,{readAt:1800000000000});
  await f.repo.put('notifications','later',{storeId:'main',createdAt:1800000001000});
  const items=(await f.call('s',s.token,'staff.notifications')).items;
  assert.equal(items.find(n=>n._id==='later').unread,true);
  assert.equal(items.find(n=>n._id!=='later').unread,false);
  await f.call('s',s.token,'staff.readNotifications',{ids:['later']});
  assert.equal((await f.repo.get('notificationReads',s.user._id)).readAt,1800000000000);
});

test('dev login switch: off by default; when on, skips phone exchange but keeps every other check',async()=>{
  // 默认关闭（fixture 未传 devLogin）："dev:" 凭证不被特殊对待，走正常手机号校验并被拒绝。
  const f=await fixture();
  await fails(f.register('a','dev:13012345678'),'PHONE');
  // 显式开启：跳过 phoneExchange，手机号格式、门店校验、绑定关系、角色分配全部保持不变。
  const repo=new MemoryRepository();let now=1800000000000;
  await repo.put('stores','main',{name:'测试门店',enabled:true,createdAt:now});
  let exchanged=0;
  const service=createService({repo,clock:()=>now,devLogin:true,bootstrapOpenid:'boss',
    phoneExchange:async()=>{exchanged++;throw new Error('must not be called');},qrCode:async()=>''});
  const call=(openid,token,action,data={})=>service({token,action,data},{openid});
  const reg=(openid,code,more={})=>call(openid,'','auth.phone',{mode:'register',consent:true,code,nickname:'邻居',park:'一园区',gender:'不愿透露',storeId:'main',...more});
  const a=await reg('a','dev:13012345678');
  assert.equal(a.user.phone,'13012345678');assert.equal(a.user.role,'customer');assert.equal(exchanged,0);
  const boss=await reg('boss','dev:13000000000');
  assert.equal(boss.user.role,'admin');
  await fails(reg('b','dev:123'),'PHONE');
  await fails(reg('b','dev:13012345678'),'PHONE_BOUND');
  await fails(reg('b','dev:13099998888',{storeId:'missing'}),'INVALID');
  const again=await call('a','','auth.phone',{mode:'login',consent:true,code:'dev:13012345678'});
  assert.equal(again.user.phone,'13012345678');assert.equal(exchanged,0);
  // 开关开启也不影响普通凭证：非 "dev:" 前缀的 code 仍走 phoneExchange（此处抛错被转为 PHONE）。
  await fails(call('c','','auth.phone',{mode:'login',consent:true,code:'13012345678'}),'PHONE');
  assert.equal(exchanged,1);
});
test('content security: msgSecCheck verdicts gate chat, profile and registration; pass lets everything through',async()=>{
  // 注入可编程的 msgCheck：默认 pass，特定内容返回 review/risky。
  const repo=new MemoryRepository();let now=1800000000000;
  await repo.put('stores','main',{name:'测试门店',enabled:true,createdAt:now});
  let checked=[];
  const service=createService({repo,clock:()=>now,bootstrapOpenid:'admin',
    phoneExchange:async code=>({purePhoneNumber:code,countryCode:'86'}),qrCode:async()=>'',
    msgCheck:async(content,scene,openid)=>{checked.push({content,scene,openid});
      if(content.indexOf('评审词')>-1)return 'review';
      if(content.indexOf('违规词')>-1)return 'risky';
      return 'pass';}});
  const call=(openid,token,action,data={})=>service({token,action,data},{openid});
  const reg=(openid,phone,more={})=>call(openid,'','auth.phone',{mode:'register',consent:true,code:phone,nickname:'邻居',park:'一园区',gender:'不愿透露',storeId:'main',...more});
  // 注册昵称含违规词：拦截，用户不落地。
  await fails(reg('u1','13800000001',{nickname:'违规词用户'}),'CONTENT');
  assert.deepEqual(Object.keys(repo.data.users||{}),[]);
  // review 同样拦截（只有 pass 放行）。
  await fails(reg('u1','13800000001',{nickname:'评审词用户'}),'CONTENT');
  // 正常注册通过，且注册时确实做了 scene=1 检测。
  const u=await reg('u1','13800000001');
  assert.equal(u.user.role,'customer');
  assert.equal(checked.some(c=>c.scene===1&&c.content==='邻居'&&c.openid==='u1'),true);
  // 聊天：正常消息通过（scene=2），违规消息拦截且不入库。
  const room=await call('u1',u.token,'chat.open',{});
  await call('u1',u.token,'chat.send',{roomId:room.roomId,content:'你好，请问营业时间？',requestId:'m1'});
  assert.equal((repo.data.messages&&Object.keys(repo.data.messages).length)||0,1);
  assert.equal(checked.some(c=>c.scene===2),true);
  await fails(call('u1',u.token,'chat.send',{roomId:room.roomId,content:'违规词了解一下',requestId:'m2'}),'CONTENT');
  assert.equal(Object.keys(repo.data.messages).length,1);
  // 改资料昵称含违规词：拦截；正常昵称通过。
  await fails(call('u1',u.token,'profile.update',{nickname:'违规词昵称',park:'一园区',gender:'男'}),'CONTENT');
  const saved=await call('u1',u.token,'profile.update',{nickname:'好邻居',park:'二园区',gender:'男'});
  assert.equal(saved.user.nickname,'好邻居');
  // 未注入 msgCheck 的环境（如单元测试 fixture）默认放行——不改变既有行为。
  const plain=await fixture();
  const p=await plain.register('p','13800000009');
  const proom=await plain.call('p',p.token,'chat.open',{});
  await plain.call('p',p.token,'chat.send',{roomId:proom.roomId,content:'任何内容都放行',requestId:'x1'});
});

test('store deletion is admin-only, blocked while referenced, and audited',async()=>{
  const {repo,call,register}=await fixture();
  const admin=await register('admin','13800000001');
  const customer=await register('customer','13800000002');

  // 权限：客户和未登录都进不来
  await fails(call('customer',customer.token,'admin.storeDelete',{id:'other'}),'FORBIDDEN');
  await fails(call('nobody','','admin.storeDelete',{id:'other'}),'AUTH');
  // 要删的门店必须存在
  await fails(call('admin',admin.token,'admin.storeDelete',{id:'ghost'}),'INVALID');

  // 被会话引用的门店不能删，错误信息要引导改用「停用」
  await repo.put('conversations','room-x',{customerId:'c',storeId:'other',lastText:'',lastMessageAt:0,createdAt:1});
  await assert.rejects(call('admin',admin.token,'admin.storeDelete',{id:'other'}),e=>e.code==='INVALID'&&/停用/.test(e.message));
  await repo.remove('conversations','room-x');

  // other 已无任何引用 → 真删成功
  await call('admin',admin.token,'admin.storeDelete',{id:'other'});
  assert.equal(await repo.get('stores','other'),null);

  // main 下还有账户（含管理员自己）→ 拒绝，并指向账户页
  await assert.rejects(call('admin',admin.token,'admin.storeDelete',{id:'main'}),e=>e.code==='INVALID'&&/账户/.test(e.message));
  // 已删除的门店再删一次
  await fails(call('admin',admin.token,'admin.storeDelete',{id:'other'}),'INVALID');

  // 删除动作留痕，且只留一条
  assert.equal((await repo.list('auditLogs',{action:'store.delete'},{order:'createdAt',limit:10})).length,1);
});

test('dev actor switch: only with dev login on, and only for a plain 11-digit phone',()=>{
  // 开着才换身份，换出来的是手机号本身
  assert.equal(resolveOpenid('real-openid','13800000001',true),'13800000001');
  // 关掉一定回落到真实 openid —— 生产环境走的就是这条路径
  assert.equal(resolveOpenid('real-openid','13800000001',false),'real-openid');
  // 形状不对一律不接受：真实 openid 是 28 位混排字符串，不该被误认成手机号
  assert.equal(resolveOpenid('real-openid','oABCDEF1234567890abcdefghijkl',true),'real-openid');
  assert.equal(resolveOpenid('real-openid','1380000000',true),'real-openid');
  assert.equal(resolveOpenid('real-openid','23800000001',true),'real-openid');
  assert.equal(resolveOpenid('real-openid','13800000001x',true),'real-openid');
  // 空值、非字符串都不能得逞
  assert.equal(resolveOpenid('real-openid','',true),'real-openid');
  assert.equal(resolveOpenid('real-openid',undefined,true),'real-openid');
  assert.equal(resolveOpenid('real-openid',{ toString: () => '13800000001' },true),'real-openid');
  assert.equal(resolveOpenid('real-openid',['13800000001'],true),'real-openid');
});

test('customer can switch service store; only enabled ones, and the role is untouched',async()=>{
  const {repo,call,register}=await fixture();
  const admin=await register('admin','13800000001');
  const customer=await register('customer','13800000002');
  assert.equal((await repo.get('users',customer.user._id)).storeId,'main');

  await call('customer',customer.token,'store.switch',{storeId:'other'});
  const moved=await repo.get('users',customer.user._id);
  assert.equal(moved.storeId,'other');
  assert.equal(moved.role,'customer','换门店不该动角色');

  await fails(call('customer',customer.token,'store.switch',{storeId:'other'}),'INVALID');
  await fails(call('customer',customer.token,'store.switch',{storeId:'ghost'}),'INVALID');

  await repo.put('stores','main',{name:'测试门店',enabled:false,createdAt:1});
  await fails(call('customer',customer.token,'store.switch',{storeId:'main'}),'INVALID');

  await fails(call('admin',admin.token,'store.switch',{storeId:'other'}),'FORBIDDEN');

  assert.equal((await repo.list('auditLogs',{action:'store.switch'},{order:'createdAt',limit:10})).length,1);
});

test('account search matches nickname or phone, and store staff stay inside their own store',async()=>{
  const {call,register,provision}=await fixture();
  const admin=await register('admin','13800000001');
  await register('zhang','13900000001',{nickname:'张三'});
  await register('li','13900000002',{nickname:'李四',storeId:'other'});
  await register('dot','13900000003',{nickname:'王.五'});

  const byName=await call('admin',admin.token,'staff.customers',{keyword:'张'});
  assert.deepEqual(byName.items.map(u=>u.nickname),['张三']);

  const byPhone=await call('admin',admin.token,'staff.customers',{keyword:'0002'});
  assert.deepEqual(byPhone.items.map(u=>u.nickname),['李四']);

  // 点号按字面量处理：只命中真的含点号的名字，不会把所有人都拉出来
  const byDot=await call('admin',admin.token,'staff.customers',{keyword:'.'});
  assert.deepEqual(byDot.items.map(u=>u.nickname),['王.五']);

  assert.equal((await call('admin',admin.token,'staff.customers',{keyword:'查无此人'})).items.length,0);

  // 换成门店员工身份后，只能搜到自己店里的客户
  await provision('admin','store','main');
  const scoped=await call('admin',admin.token,'staff.customers',{keyword:''});
  assert.ok(scoped.items.length>0 && scoped.items.every(u=>u.storeId==='main'),'门店员工不该看到别家店的客户');
});

test('search keyword is escaped before it reaches a regex',()=>{
  assert.equal(escapeRegExp('13800000001'),'13800000001');
  assert.equal(escapeRegExp('a.b'),'a\\.b');
  assert.equal(escapeRegExp('.*'),'\\.\\*');
  assert.equal(escapeRegExp('(x)[y]{z}'),'\\(x\\)\\[y\\]\\{z\\}');
  assert.equal(new RegExp(escapeRegExp('.')).test('abc'),false,'转义后不再匹配任意字符');
  assert.equal(new RegExp(escapeRegExp('.')).test('a.b'),true);
});

// 下单通用前置：建一个启用的服务，返回它的 id。
async function withService(call,admin){
  await call('admin',admin.token,'admin.serviceSave',{name:'衣物洗护',category:'laundry',description:'按件收洗，48小时可取',enabled:true});
  return (await call('admin',admin.token,'admin.services')).items.find(s=>s.name==='衣物洗护')._id;
}

test('order: customer places a self-drop order, store drives it to done',async()=>{
  const {repo,call,register,provision}=await fixture();
  const admin=await register('admin','13800000001');
  const serviceId=await withService(call,admin);
  const customer=await register('customer','13800000002');

  const created=await call('customer',customer.token,'order.create',{serviceId,items:'两件外套',park:'一园区',parkDetail:'3号楼502',contact:'13800000002',delivery:'self'});
  assert.equal(created.order.status,'submitted');
  assert.equal(created.order.fee,0,'自送不收跑腿费');

  // 参数校验
  await fails(call('customer',customer.token,'order.create',{serviceId,items:'',park:'一园区',parkDetail:'x',contact:'13800000002',delivery:'self'}),'INVALID');
  await fails(call('customer',customer.token,'order.create',{serviceId,items:'x',park:'不存在园区',parkDetail:'x',contact:'13800000002',delivery:'self'}),'INVALID');
  await fails(call('customer',customer.token,'order.create',{serviceId,items:'x',park:'一园区',parkDetail:'x',contact:'123',delivery:'self'}),'INVALID');
  await fails(call('customer',customer.token,'order.create',{serviceId,items:'x',park:'一园区',parkDetail:'x',contact:'13800000002',delivery:'teleport'}),'INVALID');

  const shop=await register('shop','13800000003');
  await provision('shop','store','main');

  // 门店不能跳步：先接单再完成
  await fails(call('shop',shop.token,'order.finish',{id:created.id}),'INVALID');
  await call('shop',shop.token,'order.accept',{id:created.id});
  assert.equal((await repo.get('orders',created.id)).status,'serving');
  await call('shop',shop.token,'order.finish',{id:created.id});
  assert.equal((await repo.get('orders',created.id)).status,'done');

  // 完成后不能再取消
  await fails(call('customer',customer.token,'order.cancel',{id:created.id}),'INVALID');

  const mine=await call('customer',customer.token,'order.mine',{});
  assert.deepEqual(mine.items.map(o=>o.status),['done']);
  assert.deepEqual(mine.items.map(o=>o.statusText),['已完成']);
});

test('order: runner flow from application to delivery; pickup phone stays hidden until taken',async()=>{
  const {repo,call,register,provision,deletedFiles}=await fixture();
  const admin=await register('admin','13800000001');
  const serviceId=await withService(call,admin);
  const customer=await register('customer','13800000002');
  const runner=await register('runner','13800000003');

  // 没认证不能进大厅
  await fails(call('runner',runner.token,'order.pool',{}),'FORBIDDEN');
  // 证件照片必须是云存储 fileID
  await fails(call('runner',runner.token,'runner.apply',{realName:'李四',schoolId:'2023001',idCardPhoto:'https://example.com/a.jpg',studentCardPhoto:'cloud://stu-1'}),'INVALID');

  await call('runner',runner.token,'runner.apply',{realName:'李四',schoolId:'2023001',idCardPhoto:'cloud://id-1',studentCardPhoto:'cloud://stu-1'});
  assert.equal((await repo.get('users',runner.user._id)).runner.status,'pending');
  // 审核前重复申请要被挡
  await fails(call('runner',runner.token,'runner.apply',{realName:'李四',schoolId:'2023001',idCardPhoto:'cloud://id-1',studentCardPhoto:'cloud://stu-1'}),'INVALID');

  // 管理员通过：证件引用清掉，原件从云存储删除
  await call('admin',admin.token,'admin.runnerReview',{id:runner.user._id,result:'approved'});
  const approved=await repo.get('users',runner.user._id);
  assert.equal(approved.runner.status,'approved');
  assert.equal(approved.runner.idCardPhoto,undefined,'不留证件原件');
  assert.equal(approved.runner.schoolId,undefined,'不留学号');
  assert.deepEqual(deletedFiles.slice().sort(),['cloud://id-1','cloud://stu-1']);

  const created=await call('customer',customer.token,'order.create',{serviceId,items:'一件羽绒服',park:'二园区',parkDetail:'5号楼101',contact:'13800000002',delivery:'runner'});
  assert.equal(created.order.fee,300,'默认跑腿费 3 元');

  // 大厅能看到单，但看不到取件电话
  const pool=await call('runner',runner.token,'order.pool',{});
  assert.equal(pool.items.length,1);
  assert.equal(pool.items[0].contact,undefined,'接单前不下发取件电话');

  // 抢单成功后才给电话
  const taken=await call('runner',runner.token,'order.take',{id:created.id});
  assert.equal(taken.order.contact,'13800000002');
  // 抢过就锁定，别人再抢拿不到
  await fails(call('customer',customer.token,'order.take',{id:created.id}),'FORBIDDEN');
  assert.equal((await call('runner',runner.token,'order.pool',{})).items.length,0,'已接的单不再出现在大厅');

  // 只有接单的飞毛腿能推进
  const other=await register('other','13800000004');
  await fails(call('other',other.token,'order.runnerAdvance',{id:created.id,step:'picked'}),'FORBIDDEN');
  await fails(call('runner',runner.token,'order.runnerAdvance',{id:created.id,step:'done'}),'INVALID');

  await call('runner',runner.token,'order.runnerAdvance',{id:created.id,step:'picked'});
  assert.equal((await repo.get('orders',created.id)).status,'picked');

  // 还没送到门店，门店接不了单
  const shop=await register('shop','13800000005');
  await provision('shop','store','main');
  await assert.rejects(call('shop',shop.token,'order.accept',{id:created.id}),e=>e.code==='INVALID'&&/飞毛腿/.test(e.message));

  await call('runner',runner.token,'order.runnerAdvance',{id:created.id,step:'delivered'});
  assert.equal((await repo.get('orders',created.id)).status,'delivered');
  await call('shop',shop.token,'order.accept',{id:created.id});
  assert.equal((await repo.get('orders',created.id)).status,'serving');
});

test('order: runner fee is admin-configurable and cancellation is role-scoped',async()=>{
  const {repo,call,register,provision}=await fixture();
  const admin=await register('admin','13800000001');
  const serviceId=await withService(call,admin);
  const customer=await register('customer','13800000002');

  await fails(call('admin',admin.token,'admin.runnerFee',{fee:-1}),'INVALID');
  await fails(call('admin',admin.token,'admin.runnerFee',{fee:'abc'}),'INVALID');
  await fails(call('customer',customer.token,'admin.runnerFee',{fee:500}),'FORBIDDEN');

  await call('admin',admin.token,'admin.runnerFee',{fee:500});
  const created=await call('customer',customer.token,'order.create',{serviceId,items:'一双球鞋',park:'一园区',parkDetail:'1号楼101',contact:'13800000002',delivery:'runner'});
  assert.equal(created.order.fee,500,'配置生效');

  // 无关的人取消不了
  const outsider=await register('outsider','13800000006');
  await fails(call('outsider',outsider.token,'order.cancel',{id:created.id}),'FORBIDDEN');
  // 门店可以取消本店订单
  const shop=await register('shop','13800000003');
  await provision('shop','store','main');
  await call('shop',shop.token,'order.cancel',{id:created.id});
  assert.equal((await repo.get('orders',created.id)).status,'cancelled');
  // 已取消的单不能再取消
  await fails(call('customer',customer.token,'order.cancel',{id:created.id}),'INVALID');
});

test('runner apply: dev placeholder photos are only accepted when dev login is on',async()=>{
  // 先确认默认（生产形态）下占位符一律被拒
  const strict=await fixture();
  const r1=await strict.register('runner','13800000003');
  await fails(strict.call('runner',r1.token,'runner.apply',{realName:'李四',schoolId:'2023001',idCardPhoto:'dev:idCard',studentCardPhoto:'dev:studentCard'}),'INVALID');
  await fails(strict.call('runner',r1.token,'runner.apply',{realName:'李四',schoolId:'2023001',idCardPhoto:'http://example.com/a.jpg',studentCardPhoto:'dev:stu'}),'INVALID');

  // 开发环境（devLogin 打开）才放行 dev: 占位符，其它形状依旧不行
  const repo=new MemoryRepository(); const now=1800000000000;
  await repo.put('stores','main',{name:'测试门店',enabled:true,createdAt:now});
  const service=createService({ repo, clock:()=>now, devLogin:true, phoneExchange:async code=>({purePhoneNumber:code,countryCode:'86'}) });
  const call=(openid,token,action,data={})=>service({token,action,data},{openid});
  const reg=(openid,phone,nickname)=>call(openid,'','auth.phone',{mode:'register',consent:true,code:phone,nickname,park:'一园区',gender:'不愿透露',storeId:'main'});

  const dev=await reg('devrunner','13800000005','李四');
  await call('devrunner',dev.token,'runner.apply',{realName:'李四',schoolId:'2023001',idCardPhoto:'dev:idCard',studentCardPhoto:'dev:studentCard'});
  assert.equal((await repo.get('users',dev.user._id)).runner.status,'pending','开发期占位符放行');

  const bad=await reg('baduser','13800000006','王五');
  await fails(call('baduser',bad.token,'runner.apply',{realName:'王五',schoolId:'1',idCardPhoto:'http://example.com/a.jpg',studentCardPhoto:'dev:stu'}),'INVALID');
});

test('dorm room persists across login and profile edits, is staff-visible, and supports legacy users',async()=>{
 const f=await fixture();const c=await f.register('c','13800000001',{dormRoom:' 3栋502 '});
 assert.equal(c.user.dormRoom,'3栋502');
 const again=await f.call('c','','auth.phone',{mode:'login',consent:true,code:'13800000001'});
 assert.equal(again.user.dormRoom,'3栋502');
 const fields={nickname:'邻居',park:'一园区',gender:'不愿透露'};
 const unchanged=await f.call('c',again.token,'profile.update',fields);assert.equal(unchanged.user.dormRoom,'3栋502');
 const changed=await f.call('c',again.token,'profile.update',{...fields,dormRoom:'A-601'});assert.equal(changed.user.dormRoom,'A-601');
 const staff=await f.register('s','13800000002');await f.provision('s','store');
 assert.equal((await f.call('s',staff.token,'staff.customers')).items.find(x=>x._id===c.user._id).dormRoom,'A-601');
 const cleared=await f.call('c',again.token,'profile.update',{...fields,dormRoom:'   '});assert.equal(cleared.user.dormRoom,'');
 assert.equal(staff.user.dormRoom,'');
 for(const invalid of ['x'.repeat(21),502,null])await fails(f.call('c',again.token,'profile.update',{...fields,dormRoom:invalid}),'INVALID');
 assert.equal((await f.call('c',again.token,'me')).user.dormRoom,'');
});

test('delivery mode constrains acceptance and taking, not just the shared status graph',async()=>{
 const f=await fixture();const admin=await f.register('admin','13800000001');const serviceId=await withService(f.call,admin);const customer=await f.register('c','13800000002');const shop=await f.register('s','13800000003');await f.provision('s','store');
 const runner=await f.register('r','13800000004');const u=await f.repo.get('users',runner.user._id);await f.repo.put('users',u._id,{...u,runner:{status:'approved'}});
 const create=delivery=>f.call('c',customer.token,'order.create',{serviceId,items:'衣服',park:'一园区',parkDetail:'3栋502',contact:'13800000002',delivery});
 const r=await create('runner');
 for(const status of ['submitted','runnerTaken','picked']){
  const o=await f.repo.get('orders',r.id);await f.repo.put('orders',r.id,{...o,status});
  for(const [who,token] of [['s',shop.token],['admin',admin.token]])await fails(f.call(who,token,'order.accept',{id:r.id}),'INVALID');
  assert.equal((await f.repo.get('orders',r.id)).status,status);
 }
 const o=await f.repo.get('orders',r.id);await f.repo.put('orders',r.id,{...o,status:'delivered'});await f.call('s',shop.token,'order.accept',{id:r.id});assert.equal((await f.repo.get('orders',r.id)).status,'serving');
 const self=await create('self');await fails(f.call('r',runner.token,'order.take',{id:self.id}),'INVALID');assert.equal((await f.repo.get('orders',self.id)).runnerId,'');await f.call('s',shop.token,'order.accept',{id:self.id});
});

test('banner create retries are atomic, reject changed payload and never resurrect deleted records',async()=>{
 const f=await fixture(),a=await f.register('admin','13800000001');const d={title:'活动',subtitle:'说明',weight:1,enabled:true,mediaType:'none',requestId:'create_1'};
 const call=data=>f.call('admin',a.token,'admin.bannerSave',data);
 const [one,two]=await Promise.all([call(d),call(d)]);assert.equal(one.id,two.id);assert.equal(Object.keys(f.repo.data.banners).length,1);
 assert.equal(Object.values(f.repo.data.auditLogs).filter(x=>x.action==='banner.save').length,1);
 await fails(call({...d,title:'更改的标题'}),'INVALID');
 await f.call('admin',a.token,'admin.bannerDelete',{id:one.id});const retry=await call(d);assert.equal(retry.id,one.id);assert.equal(Object.keys(f.repo.data.banners).length,0);
 const next=await call({...d,requestId:'create_2'});assert.notEqual(next.id,one.id);
 const customer=await f.register('c','13800000002');await fails(f.call('c',customer.token,'admin.bannerSave',d),'FORBIDDEN');
});
