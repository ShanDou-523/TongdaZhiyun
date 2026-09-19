// Generated from cloudfunctions/api by scripts/sync-demo.js. Do not edit.
// Local demo only; production authentication remains in the cloud function.
const crypto = require('./crypto');
const { hash, uid, BusinessError, requireThat: need, text, profile, publicUser, allowedConversation } = require('./domain');
const INSPECT = ['users','stores','conversations','messages','notifications','services','auditLogs'];
// All repository access runs on the trusted server; no client database permissions are needed.
function createService({ repo, phoneExchange, qrCode, bootstrapOpenid = '', clock = Date.now }) {
  async function actor(ctx, token, source = repo) {
    need(ctx.openid, 'AUTH', '请重新登录');
    const user = await source.get('users', uid(ctx.openid));
    need(user && user.enabled && typeof token === 'string' && token.length === 64 && user.sessionHash === hash(token) && user.sessionExpiresAt > clock(), 'AUTH', '登录已过期或账户权限已变更，请重新验证手机号');
    if (user.role === 'store') need((await source.get('stores', user.storeId))?.enabled, 'FORBIDDEN', '门店已停用，请联系管理员');
    return user;
  }
  const admin = user => need(user.role === 'admin', 'FORBIDDEN', '仅管理员可操作');
  const staff = user => need(['store','admin'].includes(user.role), 'FORBIDDEN', '仅门店或管理员可操作');
  const page = value => { const n = value === undefined ? 0 : Number(value); need(Number.isInteger(n) && n >= 0 && n <= 10000, 'INVALID', '分页参数错误'); return n; };
  async function audit(tx, user, action, target, detail) { await tx.put('auditLogs', crypto.randomBytes(16).toString('hex'), { actorId: user._id, action, target, detail, createdAt: clock() }); }
  async function authenticate(data, ctx) {
    need(ctx.openid, 'AUTH', '无法获取微信身份，请在微信内打开');
    need(data.consent === true, 'INVALID', '请先阅读并同意隐私说明');
    need(['login','register'].includes(data.mode), 'INVALID', '登录方式无效');
    const code = text(data.code, 512, '手机号验证凭证');
    let info;
    try { info = await phoneExchange(code); } catch (_) { throw new BusinessError('PHONE', '手机号验证失败，请重新点击授权；若持续失败，请检查平台手机号能力配置'); }
    const phone = info?.purePhoneNumber;
    need(info?.countryCode === '86' && /^1\d{10}$/.test(phone || ''), 'PHONE', '当前仅支持中国大陆手机号');
    const id = uid(ctx.openid), token = crypto.randomBytes(32).toString('hex'), now = clock();
    return repo.transaction(async tx => {
      let user = await tx.get('users', id);
      const claimId = hash(`86:${phone}`), claim = await tx.get('phoneClaims', claimId);
      need(!claim || claim.userId === id, 'PHONE_BOUND', '该手机号已绑定其他微信账户，请联系门店处理');
      if (user) {
        need(user.enabled, 'FORBIDDEN', '账户已停用，请联系管理员');
        need(user.phone === phone, 'PHONE_CHANGED', '请使用注册时的手机号登录，换绑请联系管理员');
        if (user.role === 'store') need((await tx.get('stores', user.storeId))?.enabled, 'FORBIDDEN', '门店已停用，请联系管理员');
      } else {
        need(data.mode === 'register', 'NOT_REGISTERED', '尚未注册，请先填写注册信息');
        const p = profile(data);
        const store = await tx.get('stores', text(data.storeId, 24, '门店'));
        need(store?.enabled, 'INVALID', '门店不存在或已停用，请重新选择');
        user = { _id: id, ...p, phone, role: ctx.openid === bootstrapOpenid ? 'admin' : 'customer', storeId: store._id, enabled: true, createdAt: now };
        await tx.put('phoneClaims', claimId, { userId: id });
        await tx.put('notifications', `reg_${id}`, { storeId: store._id, customerId: id, title: '新客户注册', nickname: p.nickname, park: p.park, createdAt: now });
      }
      const saved = { ...user, sessionHash: hash(token), sessionExpiresAt: now + 7 * 86400000, updatedAt: now };
      await tx.put('users', id, saved);
      return { token, user: publicUser(saved) };
    });
  }
  async function roomFor(user, id, tx = repo) {
    const room = await tx.get('conversations', text(id, 80, '会话'));
    need(allowedConversation(user, room), 'FORBIDDEN', '无权访问该会话');
    need((await tx.get('stores', room.storeId))?.enabled, 'FORBIDDEN', '门店已停用');
    return room;
  }
  return async function handle(event = {}, ctx = {}) {
    const data = event.data || {}, action = event.action;
    if (action === 'public.stores') return { items: await repo.list('stores', { enabled: true }, { order: 'createdAt', direction: 'asc', limit: 100 }) };
    if (action === 'auth.phone') return authenticate(data, ctx);
    const user = await actor(ctx, event.token);
    if (action === 'me') return { user: publicUser(user), store: await repo.get('stores', user.storeId) };
    if (action === 'logout') return repo.transaction(async tx => { const fresh = await actor(ctx, event.token, tx); await tx.put('users', fresh._id, { ...fresh, sessionHash: '', sessionExpiresAt: 0 }); return {}; });
    if (action === 'profile.update') return repo.transaction(async tx => { const fresh = await actor(ctx, event.token, tx); const saved = { ...fresh, ...profile(data), updatedAt: clock() }; await tx.put('users', fresh._id, saved); return { user: publicUser(saved) }; });
    if (action === 'services.list') return { items: await repo.list('services', { enabled: true }, { order: 'createdAt', limit: 30 }) };
    if (action === 'chat.open') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      let customer = fresh;
      if (fresh.role === 'store') customer = await tx.get('users', text(data.customerId, 32, '客户'));
      need(customer?.enabled && customer.role === 'customer' && customer.storeId === fresh.storeId, 'FORBIDDEN', '仅客户及其所属门店可创建会话');
      need((await tx.get('stores', customer.storeId))?.enabled, 'FORBIDDEN', '门店已停用');
      const id = `${customer.storeId}_${customer._id}`;
      if (!await tx.get('conversations', id)) await tx.put('conversations', id, { customerId: customer._id, customerName: customer.nickname, storeId: customer.storeId, lastText: '', lastMessageAt: 0, customerReadSeq: 0, storeReadSeq: 0, sequence: 0, createdAt: clock() });
      return { roomId: id };
    });
    if (action === 'chat.rooms') {
      need(['customer','store'].includes(user.role), 'FORBIDDEN', '管理员请使用数据库查看记录');
      const filter = user.role === 'customer' ? { customerId: user._id } : { storeId: user.storeId };
      const items = await repo.list('conversations', filter, { order: 'lastMessageAt', skip: page(data.page) * 20, limit: 20 });
      return { items: items.map(r => ({ ...r, unread: r.sequence > (user.role === 'customer' ? r.customerReadSeq : r.storeReadSeq) })) };
    }
    if (action === 'chat.messages') {
      const room = await roomFor(user, data.roomId);
      const before = data.before === undefined ? room.sequence + 1 : Number(data.before);
      need(Number.isInteger(before) && before > 0, 'INVALID', '消息游标错误');
      const items = await repo.list('messages', { roomId: room._id }, { order: 'seq', before, limit: 30 });
      return { items: items.reverse(), latestSeq: room.sequence, more: items.length === 30 };
    }
    if (action === 'chat.read') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx), room = await roomFor(fresh, data.roomId, tx);
      const seq = Number(data.seq);
      need(Number.isInteger(seq) && seq >= 0 && seq <= room.sequence, 'INVALID', '阅读位置无效');
      const key = fresh.role === 'customer' ? 'customerReadSeq' : 'storeReadSeq';
      await tx.put('conversations', room._id, { ...room, [key]: Math.max(room[key], seq) }); return {};
    });
    if (action === 'chat.send') {
      const content = text(data.content, 1000, '消息');
      const requestId = text(data.requestId, 80, '消息编号');
      need(/^[a-zA-Z0-9_-]+$/.test(requestId), 'INVALID', '消息编号无效');
      return repo.transaction(async tx => {
        const fresh = await actor(ctx, event.token, tx), room = await roomFor(fresh, data.roomId, tx);
        const id = hash(`${fresh._id}:${room._id}:${requestId}`);
        const old = await tx.get('messages', id);
        if (old) { need(old.content === content, 'INVALID', '请勿复用消息编号'); return { message: old }; }
        need(!fresh.lastSentAt || clock() - fresh.lastSentAt >= 600, 'RATE', '发送太快，请稍后重试');
        const seq = room.sequence + 1, now = clock();
        const message = { roomId: room._id, senderId: fresh._id, senderRole: fresh.role, content, seq, createdAt: now };
        await tx.put('messages', id, message);
        await tx.put('conversations', room._id, { ...room, sequence: seq, lastText: content.slice(0, 80), lastMessageAt: now, [fresh.role === 'customer' ? 'customerReadSeq' : 'storeReadSeq']: seq });
        await tx.put('users', fresh._id, { ...fresh, lastSentAt: now });
        return { message: { _id: id, ...message } };
      });
    }
    if (action === 'staff.customers') {
      staff(user); const filter = user.role === 'store' ? { storeId: user.storeId, role: 'customer' } : {};
      return { items: (await repo.list('users', filter, { order: 'createdAt', skip: page(data.page) * 20, limit: 20 })).map(publicUser) };
    }
    if (action === 'staff.notifications') {
      staff(user); const filter = user.role === 'store' ? { storeId: user.storeId } : {};
      const items = await repo.list('notifications', filter, { order: 'createdAt', skip: page(data.page) * 20, limit: 20 });
      // Preserve legacy read timestamps, but all new reads are per notification.
      const legacy = await repo.get('notificationReads', user._id);
      const marked = await Promise.all(items.map(async n => {
        const read = await repo.get('notificationReads', hash(user._id + ':' + n._id));
        return { ...n, unread: !read && !(legacy && n.createdAt <= legacy.readAt) };
      }));
      return { items: marked };
    }
    if (action === 'staff.readNotifications') {
      staff(user);
      need(Array.isArray(data.ids) && data.ids.length > 0 && data.ids.length <= 20, 'INVALID', '请提交1至20条已显示的通知');
      const ids = [...new Set(data.ids.map(id => text(id, 80, '通知编号')))];
      return repo.transaction(async tx => {
        const fresh = await actor(ctx, event.token, tx); staff(fresh);
        for (const id of ids) {
          const notice = await tx.get('notifications', id);
          need(notice && (fresh.role === 'admin' || notice.storeId === fresh.storeId), 'FORBIDDEN', '无权访问该通知');
        }
        for (const id of ids) {
          await tx.put('notificationReads', hash(fresh._id + ':' + id), { userId: fresh._id, notificationId: id, readAt: clock() });
        }
        return {};
      });
    }
    if (action === 'admin.stores') { admin(user); return { items: await repo.list('stores', {}, { order: 'createdAt', limit: 100 }) }; }
    if (action === 'admin.storeSave') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); admin(fresh);
      const id = text(data.id, 24, '门店编号'); need(/^[a-z0-9_-]{2,24}$/.test(id), 'INVALID', '门店编号须为2至24位小写字母、数字、下划线或短横线');
      const name = text(data.name, 40, '门店名称'); need(typeof data.enabled === 'boolean', 'INVALID', '门店状态无效');
      const old = await tx.get('stores', id);
      await tx.put('stores', id, { name, enabled: data.enabled, createdAt: old?.createdAt || clock(), updatedAt: clock() });
      await audit(tx, fresh, 'store.save', id, { name, enabled: data.enabled }); return {};
    });
    if (action === 'admin.userUpdate') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); admin(fresh);
      const target = await tx.get('users', text(data.id, 32, '用户'));
      need(target && target.role !== 'admin' && target._id !== fresh._id, 'FORBIDDEN', '不能修改管理员账户');
      need(['customer','store'].includes(data.role) && typeof data.enabled === 'boolean', 'INVALID', '账户角色或状态无效');
      const store = await tx.get('stores', text(data.storeId, 24, '门店'));
      need(store?.enabled, 'INVALID', '请选择启用的门店');
      // Existing conversations retain original store ownership as historical records.
      await tx.put('users', target._id, { ...target, role: data.role, enabled: data.enabled, storeId: store._id, sessionHash: '', sessionExpiresAt: 0, updatedAt: clock() });
      await audit(tx, fresh, 'user.update', target._id, { role: data.role, enabled: data.enabled, storeId: store._id }); return {};
    });
    if (action === 'admin.inspect') {
      admin(user); need(INSPECT.includes(data.collection), 'INVALID', '不可查询该集合');
      let items = await repo.list(data.collection, {}, { order: 'createdAt', skip: page(data.page) * 20, limit: 20 });
      if (data.collection === 'users') items = items.map(publicUser);
      await repo.transaction(tx => audit(tx, user, 'database.read', data.collection, { page: page(data.page) }));
      return { items };
    }
    if (action === 'admin.qrcode') {
      admin(user); const store = await repo.get('stores', text(data.storeId, 24, '门店'));
      need(store?.enabled, 'INVALID', '门店不可用');
      need(['develop','trial','release'].includes(data.version), 'INVALID', '请选择二维码版本');
      return { fileID: await qrCode(store._id, data.version) };
    }
    throw new BusinessError('NOT_FOUND', '接口不存在');
  };
}
module.exports = { createService, INSPECT };
