const crypto = require('crypto');
const { hash, uid, CATEGORIES, BusinessError, requireThat: need, text, profile, publicUser, allowedConversation } = require('./domain');
const INSPECT = ['users','stores','conversations','messages','notifications','services','banners','auditLogs'];
// 广告素材类型：none 纯文案；image 海报图；video 短视频。素材文件存云存储，库里只存 fileID。
const MEDIA_TYPES = ['none','image','video'];
// All repository access runs on the trusted server; no client database permissions are needed.
function createService({ repo, phoneExchange, qrCode, bootstrapOpenid = '', clock = Date.now, devLogin = false, msgCheck = null, storageDelete = null }) {
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
  // 内容安全检测（微信平台对 UGC 的强制要求，提审必查）。
  // scene 枚举：1 资料（昵称等）；2 评论（聊天消息）。仅 'pass' 放行，'review'/'risky' 一律拦截。
  // 检测在事务外执行（外部网络调用不进事务）；msgCheck 未注入时不检测（测试环境默认放行）。
  async function checkContent(content, scene, ctx) {
    if (!msgCheck) return;
    const suggest = await msgCheck(content, scene, ctx.openid);
    need(suggest === 'pass', 'CONTENT', '内容包含违规信息，请修改后重试');
  }
  async function audit(tx, user, action, target, detail) { await tx.put('auditLogs', crypto.randomBytes(16).toString('hex'), { actorId: user._id, action, target, detail, createdAt: clock() }); }
  async function authenticate(data, ctx) {
    need(ctx.openid, 'AUTH', '无法获取微信身份，请在微信内打开');
    need(data.consent === true, 'INVALID', '请先阅读并同意隐私说明');
    need(['login','register'].includes(data.mode), 'INVALID', '登录方式无效');
    const code = text(data.code, 512, '手机号验证凭证');
    let info;
    // 开发期登录开关（仅当服务端显式注入 devLogin 时生效）：接受 "dev:<手机号>" 形式的
    // 凭证，跳过微信手机号能力验证。个人主体小程序没有「获取手机号」能力，联调期靠它打通
    // 注册登录；手机号格式、绑定关系、角色分配等全部校验保持不变。
    // 生产环境不得注入 devLogin，此分支永远不会执行。
    if (devLogin && code.indexOf('dev:') === 0) info = { purePhoneNumber: code.slice(4), countryCode: '86' };
    else try { info = await phoneExchange(code); } catch (_) { throw new BusinessError('PHONE', '手机号验证失败，请重新点击授权；若持续失败，请检查平台手机号能力配置'); }
    const phone = info?.purePhoneNumber;
    need(info?.countryCode === '86' && /^1\d{10}$/.test(phone || ''), 'PHONE', '当前仅支持中国大陆手机号');
    const id = uid(ctx.openid), token = crypto.randomBytes(32).toString('hex'), now = clock();
    if (data.mode === 'register') await checkContent(profile(data).nickname, 1, ctx);
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
    if (action === 'profile.update') return (async () => { await checkContent(profile(data).nickname, 1, ctx); return repo.transaction(async tx => { const fresh = await actor(ctx, event.token, tx); const saved = { ...fresh, ...profile(data), updatedAt: clock() }; await tx.put('users', fresh._id, saved); return { user: publicUser(saved) }; }); })();
    if (action === 'services.list') return { items: await repo.list('services', { enabled: true }, { order: 'createdAt', limit: 30 }) };
    // 首页广告位：只下发启用的，按权重从高到低，最多 5 条，后台改完即实时生效。
    if (action === 'banners.list') return { items: await repo.list('banners', { enabled: true }, { order: 'weight', direction: 'desc', limit: 5 }) };
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
      await checkContent(content, 2, ctx);
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
      const marker = await repo.get('notificationReads', user._id);
      return { items, readAt: marker?.readAt || 0, serverTime: clock() };
    }
    if (action === 'staff.readNotifications') {
      staff(user); const at = Number(data.at);
      need(Number.isSafeInteger(at) && at >= 0 && at <= clock(), 'INVALID', '通知时间无效');
      return repo.transaction(async tx => { await actor(ctx, event.token, tx); const old = await tx.get('notificationReads', user._id); await tx.put('notificationReads', user._id, { readAt: Math.max(old?.readAt || 0, at) }); return {}; });
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
    if (action === 'admin.services') { admin(user); return { items: await repo.list('services', {}, { order: 'createdAt', limit: 100 }) }; }
    if (action === 'admin.serviceSave') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); admin(fresh);
      const name = text(data.name, 40, '服务名称');
      need(Object.keys(CATEGORIES).includes(data.category), 'INVALID', '请选择服务类别');
      const description = text(data.description, 60, '服务说明');
      need(typeof data.enabled === 'boolean', 'INVALID', '服务状态无效');
      // Existing ids are edited in place; new services get a server-side id.
      const id = data.id ? text(data.id, 32, '服务编号') : crypto.randomBytes(12).toString('hex');
      const old = await tx.get('services', id);
      need(!data.id || old, 'INVALID', '服务不存在或已被删除');
      await tx.put('services', id, { name, category: data.category, description, enabled: data.enabled, createdAt: old?.createdAt || clock(), updatedAt: clock() });
      await audit(tx, fresh, 'service.save', id, { name, category: data.category, enabled: data.enabled });
      return { id };
    });
    if (action === 'admin.serviceDelete') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); admin(fresh);
      const id = text(data.id, 32, '服务编号');
      need(await tx.get('services', id), 'INVALID', '服务不存在或已被删除');
      await tx.remove('services', id);
      await audit(tx, fresh, 'service.delete', id, {});
      return {};
    });
    if (action === 'admin.banners') { admin(user); return { items: await repo.list('banners', {}, { order: 'createdAt', limit: 100 }) }; }
    // 广告文案虽由管理员填写，同样过内容安全检测——所有会展示给用户的内容统一纳管。
    // 素材（海报/视频）由专业同事制作、管理员上传，属官方内容而非 UGC，不做图片/视频鉴黄。
    // 校验素材参数：mediaType 必填枚举；image/video 时 mediaFileID 必须是 cloud:// 开头的云存储文件 ID。
    function media(data) {
      const type = data.mediaType === undefined ? 'none' : data.mediaType;
      need(MEDIA_TYPES.includes(type), 'INVALID', '广告素材类型无效');
      if (type === 'none') return { mediaType: 'none', mediaFileID: '' };
      need(typeof data.mediaFileID === 'string' && data.mediaFileID.startsWith('cloud://') && data.mediaFileID.length <= 256, 'INVALID', '请先上传广告素材（图片或视频）');
      return { mediaType: type, mediaFileID: data.mediaFileID };
    }
    // 替换/删除广告后清理云存储里的旧素材文件；清理失败不影响主流程（孤儿文件可后台手动清）。
    async function cleanup(fileID) {
      if (!fileID || !storageDelete) return;
      try { await storageDelete(fileID); } catch (error) { console.warn('banner media cleanup failed:', String(error.errCode || error.code || 'UNKNOWN')); }
    }
    if (action === 'admin.bannerSave') return (async () => {
      await checkContent(text(data.title, 30, '广告标题'), 2, ctx);
      await checkContent(text(data.subtitle, 60, '广告说明'), 2, ctx);
      const saved = await repo.transaction(async tx => {
        const fresh = await actor(ctx, event.token, tx); admin(fresh);
        const title = text(data.title, 30, '广告标题');
        const subtitle = text(data.subtitle, 60, '广告说明');
        const weight = data.weight;
        need(typeof weight === 'number' && Number.isInteger(weight) && weight >= 0 && weight <= 999, 'INVALID', '权重须为 0–999 的整数，数字越大越靠前');
        need(typeof data.enabled === 'boolean', 'INVALID', '广告状态无效');
        const id = data.id ? text(data.id, 32, '广告编号') : crypto.randomBytes(12).toString('hex');
        const old = await tx.get('banners', id);
        need(!data.id || old, 'INVALID', '广告不存在或已被删除');
        const m = media(data);
        await tx.put('banners', id, { title, subtitle, weight, enabled: data.enabled, mediaType: m.mediaType, mediaFileID: m.mediaFileID, createdAt: old?.createdAt || clock(), updatedAt: clock() });
        await audit(tx, fresh, 'banner.save', id, { title, weight, enabled: data.enabled, mediaType: m.mediaType });
        return { id, replaced: old && old.mediaFileID && old.mediaFileID !== m.mediaFileID ? old.mediaFileID : '' };
      });
      await cleanup(saved.replaced);
      return { id: saved.id };
    })();
    if (action === 'admin.bannerDelete') return (async () => {
      const removed = await repo.transaction(async tx => {
        const fresh = await actor(ctx, event.token, tx); admin(fresh);
        const id = text(data.id, 32, '广告编号');
        const old = await tx.get('banners', id);
        need(old, 'INVALID', '广告不存在或已被删除');
        await tx.remove('banners', id);
        await audit(tx, fresh, 'banner.delete', id, {});
        return { mediaFileID: old.mediaFileID || '' };
      });
      await cleanup(removed.mediaFileID);
      return {};
    })();
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
