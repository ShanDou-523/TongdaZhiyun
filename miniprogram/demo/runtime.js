// Local-only demo adapter. No cloud SDK, network calls or production tokens.
const { createService } = require('./service');
const { uid, hash, publicUser } = require('./domain');
const demoCrypto = require('./crypto');
const DATA_KEY = 'yuanlin.demo.data.v2';
const SESSION_KEY = 'yuanlin.demo.session.v2';
const clone = value => JSON.parse(JSON.stringify(value));
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function seed(now) {
  const data = {};
  for (const name of ['users','phoneClaims','stores','conversations','messages','notifications','notificationReads','services','auditLogs','demoAccounts']) data[name] = {};
  const put = (name, id, row) => { data[name][id] = { ...row, _id: id }; };
  put('stores', 'main', { name: '演示门店 · 园区服务中心', enabled: true, createdAt: now - 86400000 });
  const accounts = [
    ['customer_a','客户 A','customer','main','一园区'],
    ['customer_b','客户 B','customer','main','二园区'],
    ['staff_a','店员小林','store','main','一园区'],
    ['staff_a2','店员小周','store','main','一园区'],
    ['admin','平台管理员','admin','main','一园区']
  ];
  function user(account, index, selectable) {
    const [name, nickname, role, storeId, park] = account;
    const openid = 'demo_' + name, id = uid(openid), phone = String(10000000001 + index);
    put('users', id, { nickname, role, storeId, park, phone, gender: '不愿透露', enabled: true, createdAt: now - 60000 + index * 100, sessionHash: '', sessionExpiresAt: 0 });
    put('phoneClaims', hash('86:' + phone), { userId: id });
    if (selectable) put('demoAccounts', id, { openid, phone, createdAt: now - index });
    if (role === 'customer') put('notifications', 'reg_' + id, { storeId, customerId: id, title: '新客户注册', nickname, park, createdAt: now - 50000 + index * 100 });
    return id;
  }
  accounts.forEach((a,i)=>user(a,i,true));
  const extra = [];
  for (let i=0;i<24;i++) extra.push(user(['sample_'+i,'示例客户 '+(i+1),'customer','main','一园区'],i+accounts.length,false));
  const customer = uid('demo_customer_a'), employee = uid('demo_staff_a');
  for (const id of [customer, ...extra, uid('demo_customer_b')]) {
    const u=data.users[id], roomId=u.storeId+'_'+id;
    const count=id===customer?35:1;
    put('conversations',roomId,{customerId:id,customerName:u.nickname,storeId:u.storeId,lastText:'这是一条演示咨询，可以继续回复。',lastMessageAt:now-1000,customerReadSeq:0,storeReadSeq:0,sequence:count,createdAt:now-40000});
    for(let seq=1;seq<=count;seq++) put('messages',roomId+'_'+seq,{
      roomId,seq,senderId:seq%2?id:employee,
      senderRole:seq%2?'customer':'store',content:seq===count?'这是一条演示咨询，可以继续回复。':'演示历史消息 '+seq,
      createdAt:now-40000+seq*1000
    });
  }
  put('services','laundry_intro',{name:'洗护服务 · 演示介绍',description:'可咨询门店；价格、下单、取送与支付尚未实现。',category:'laundry',enabled:true,createdAt:now});
  put('services','housekeeping_intro',{name:'家政服务 · 演示介绍',description:'可咨询门店；预约时段、人员排班与支付尚未实现。',category:'housekeeping',enabled:true,createdAt:now-1});
  return data;
}

function createDemo({ storage, canUse, clock = Date.now }) {
  let repo, service, epoch = 0;
  const available = () => { try { return canUse() === true; } catch (_) { return false; } };
  const hasSession = () => !!storage.get(SESSION_KEY);
  function requireDemo() { if (!available()) fail('AUTH','当前版本未开启本地演示，请使用正式登录'); }
  function ensure() {
    requireDemo();
    if (repo) return;
    let initial=storage.get(DATA_KEY);
    if (!initial || initial.version!==2) {
      initial={version:2,collections:seed(clock())};
      storage.set(DATA_KEY,initial);
    }
    const generation=epoch;
    const holder={data:clone(initial.collections)};
    let queue=Promise.resolve();
    function adapter(source) {
      return {
        async get(c,id) { return clone(source.data[c]?.[id] || null); },
        async put(c,id,value) { (source.data[c] ||= {})[id]=clone({...value,_id:id}); },
        async list(c,filter,options={}) {
          let rows=Object.values(source.data[c]||{}).filter(row=>Object.entries(filter).every(([key,value])=>row[key]===value));
          if(options.before!==undefined)rows=rows.filter(row=>row[options.order]<options.before);
          const field=options.order||'createdAt', direction=options.direction==='asc'?1:-1;
          rows.sort((a,b)=>((a[field]||0)-(b[field]||0))*direction || a._id.localeCompare(b._id));
          return clone(rows.slice(options.skip||0,(options.skip||0)+(options.limit||20)));
        },
        transaction(fn) {
          const job=queue.then(async()=>{
            if(generation!==epoch)fail('AUTH','演示数据已重置，请重新选择身份');
            const draft={data:clone(holder.data)};
            const result=await fn(adapter(draft));
            if(generation!==epoch)fail('AUTH','演示数据已重置，请重新选择身份');
            storage.set(DATA_KEY,{version:2,collections:draft.data});
            holder.data=draft.data;
            return result;
          });
          queue=job.catch(()=>{});
          return job;
        }
      };
    }
    repo=adapter(holder);
    service=createService({
      repo,clock,
      phoneExchange:async code=>({purePhoneNumber:code,countryCode:'86'}),
      qrCode:async()=>{fail('DEMO_UNSUPPORTED','本地演示不能生成真实小程序码；请在云端联调阶段验证');}
    });
  }
  async function accounts() {
    ensure();
    const entries=await repo.list('demoAccounts',{}, {limit:100});
    return Promise.all(entries.map(async entry=>{
      const user=await repo.get('users',entry._id), store=await repo.get('stores',user.storeId);
      return {...publicUser(user),storeName:store?.name||user.storeId};
    }));
  }
  async function login(id) {
    ensure();
    const generation=epoch;
    const account=await repo.get('demoAccounts',id);
    if(!account)fail('INVALID','请选择一个演示身份');
    const result=await service({action:'auth.phone',data:{mode:'login',consent:true,code:account.phone}},{openid:account.openid});
    if(generation!==epoch)fail('AUTH','演示数据已重置，请重新选择身份');
    storage.set(SESSION_KEY,{openid:account.openid,token:result.token});
    return result.user;
  }
  async function call(action,data={}) {
    ensure();
    // Phone registration is only simulated by the explicit demo controls.
    if(action==='auth.phone')fail('DEMO_UNSUPPORTED','请通过演示入口选择身份或新增测试客户');
    const session=storage.get(SESSION_KEY);
    if(!session)fail('AUTH','请先选择演示身份');
    const result=await service({action,data,token:session.token},{openid:session.openid});
    return result;
  }
  async function register(data) {
    ensure();
    const generation=epoch;
    const openid='demo_new_'+demoCrypto.randomBytes(16).toString('hex');
    const phone=String(10000001000+Object.keys((storage.get(DATA_KEY)).collections.users).length);
    const result=await service({action:'auth.phone',data:{...data,mode:'register',consent:true,code:phone}},{openid});
    await repo.transaction(tx=>tx.put('demoAccounts',result.user._id,{openid,phone}));
    if(generation!==epoch)fail('AUTH','演示数据已重置，请重新选择身份');
    storage.set(SESSION_KEY,{openid,token:result.token});
    return result.user;
  }
  function leave() { storage.remove(SESSION_KEY); }
  function reset() { requireDemo(); epoch++; repo=null; service=null; leave(); storage.remove(DATA_KEY); }
  async function stores() { ensure(); return (await service({action:'public.stores'},{})).items; }
  return { available, hasSession, accounts, login, call, register, leave, reset, stores };
}
module.exports = { createDemo, DATA_KEY, SESSION_KEY };
