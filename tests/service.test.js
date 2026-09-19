const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../cloudfunctions/api/service');
const { uid, hash } = require('../cloudfunctions/api/domain');

class MemoryRepository {
  constructor() { this.data = {}; this.queue = Promise.resolve(); }
  async get(c, id) { return structuredClone(this.data[c]?.[id] || null); }
  async put(c, id, data) { (this.data[c] ||= {})[id] = structuredClone({ ...data, _id: id }); }
  async list(c, filter, options = {}) {
    let rows = Object.values(this.data[c] || {}).filter(x => Object.entries(filter).every(([k,v]) => x[k] === v));
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
  const repo = new MemoryRepository(); let now = 1800000000000;
  await repo.put('stores', 'main', { name: '测试门店', enabled: true, createdAt: now });
  await repo.put('stores', 'other', { name: '另一门店', enabled: true, createdAt: now });
  const service = createService({ repo, clock: () => now, bootstrapOpenid: 'admin', phoneExchange: async code => {
    if (code === 'reject') throw new Error('expired');
    return { purePhoneNumber: code, countryCode: '86' };
  }, qrCode: async (store, version) => `cloud://${store}/${version}` });
  const call = (openid, token, action, data = {}) => service({ token, action, data }, { openid });
  const register = (openid, phone, more = {}) => call(openid, '', 'auth.phone', { mode: 'register', consent: true, code: phone, nickname: '邻居', park: '一园区', gender: '不愿透露', storeId: 'main', ...more });
  const provision = async (openid, role, storeId = 'main') => { const u = await repo.get('users', uid(openid)); await repo.put('users', u._id, {...u,role,storeId}); };
  return { repo, service, call, register, provision, tick(ms = 1000) { now += ms; } };
}
const fails = (promise, code) => assert.rejects(promise, e => e.code === code);
test('registration uses verified phone, ignores forged role and identity; notification is atomic', async () => {
  const f = await fixture(); const r = await f.register('customer','13800000001',{role:'admin',phone:'13900000000',openid:'admin'});
  assert.equal(r.user.role,'customer'); assert.equal(r.user.phone,'13800000001'); assert.equal(r.user._id,uid('customer'));
  assert.equal(Object.keys(f.repo.data.notifications).length,1); assert.equal(r.user.sessionHash,undefined);
  const saved=await f.repo.get('users',r.user._id);assert.equal(saved.sessionHash,hash(r.token));assert.notEqual(saved.sessionHash,r.token);
});
test('login and every registration require consent, phone code and valid profile', async () => {
  const f=await fixture();await fails(f.register('a','13800000001',{consent:false}),'INVALID');
  await fails(f.register('a','reject'),'PHONE');await fails(f.register('a','fake'),'PHONE');
  await fails(f.register('a','13800000001',{park:'十一园区'}),'INVALID');
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
