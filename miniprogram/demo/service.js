// Generated from cloudfunctions/api by scripts/sync-demo.js. Do not edit.
// Local demo only; production authentication remains in the cloud function.
const crypto = require('./crypto');
const { hash, uid, CATEGORIES, PARKS, BusinessError, requireThat: need, text, profile, publicUser, publicOrder, canOrderTransition, allowedConversation } = require('./domain');
const INSPECT = ['users','stores','conversations','messages','notifications','services','banners','orders','auditLogs'];
// 广告素材类型：none 纯文案；image 海报图；video 短视频。素材文件存云存储，库里只存 fileID。
const MEDIA_TYPES = ['none','image','video'];
// All repository access runs on the trusted server; no client database permissions are needed.
function createService({ repo, phoneExchange, qrCode, bootstrapOpenid = '', clock = Date.now, devLogin = false, msgCheck = null, allowLocalMedia = false, storageDelete = null }) {
  async function actor(ctx, token, source = repo) {
    need(ctx.openid, 'AUTH', '请重新登录');
    const user = await source.get('users', uid(ctx.openid));
    need(user && user.enabled && typeof token === 'string' && token.length === 64 && user.sessionHash === hash(token) && user.sessionExpiresAt > clock(), 'AUTH', '登录已过期或账户权限已变更，请重新验证手机号');
    if (user.role === 'store') need((await source.get('stores', user.storeId))?.enabled, 'FORBIDDEN', '门店已停用，请联系管理员');
    return user;
  }
  const admin = user => need(user.role === 'admin', 'FORBIDDEN', '仅管理员可操作');
  // 跑腿费是全局配置（settings/delivery），管理员可改；单位「分」，避免浮点误差。默认 3 元。
  const DEFAULT_RUNNER_FEE = 300;
  async function runnerFee(source) { const s = await source.get('settings', 'delivery'); return Number.isInteger(s?.runnerFee) && s.runnerFee >= 0 ? s.runnerFee : DEFAULT_RUNNER_FEE; }
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
    // 客户自己更换服务门店：门店停用或搬迁时，不该把客户卡死在原地，客户有权选一家还开着的门店。
    // 只换归属、不动角色；新会话归新门店，旧会话保留原门店归属作为历史记录（与 admin.userUpdate 同一约定）。
    if (action === 'store.switch') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      need(fresh.role === 'customer', 'FORBIDDEN', '仅客户可更换服务门店');
      const store = await tx.get('stores', text(data.storeId, 24, '门店'));
      need(store?.enabled, 'INVALID', '请选择正常营业的门店');
      need(store._id !== fresh.storeId, 'INVALID', '这已经是你当前的服务门店');
      const saved = { ...fresh, storeId: store._id, updatedAt: clock() };
      await tx.put('users', fresh._id, saved);
      await audit(tx, fresh, 'store.switch', fresh._id, { from: fresh.storeId, to: store._id });
      return { user: publicUser(saved) };
    });
    if (action === 'services.list') return { items: await repo.list('services', { enabled: true }, { order: 'createdAt', limit: 30 }) };
    // 首页广告位：只下发启用的，按权重从高到低，最多 5 条，后台改完即实时生效。
    if (action === 'banners.list') return { items: await repo.list('banners', { enabled: true }, { order: 'weight', direction: 'desc', limit: 5 }) };
    if (action === 'chat.open') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      let customer = fresh;
      if (fresh.role === 'store') customer = await tx.get('users', text(data.customerId, 32, '客户'));
      need(customer?.enabled && customer.role === 'customer' && customer.storeId === fresh.storeId, 'FORBIDDEN', '仅客户及其所属门店可创建会话');
      need((await tx.get('stores', customer.storeId))?.enabled, 'FORBIDDEN', '你所属的门店已停用，请到「我的」页面更换服务门店');
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
      // 支持按昵称或手机号搜索：客户上千人以后，逐页翻是找不到人的。
      const keyword = typeof data.keyword === 'string' ? data.keyword.trim().slice(0, 20) : '';
      const search = keyword ? { keyword, fields: ['nickname', 'phone'] } : undefined;
      return { items: (await repo.list('users', filter, { order: 'createdAt', skip: page(data.page) * 20, limit: 20, search })).map(publicUser) };
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
    if (action === 'admin.stores') {
      admin(user);
      const items = await repo.list('stores', {}, { order: 'createdAt', limit: 100 });
      // 附带每个门店下的账户数，让管理员在停用之前就知道会影响到多少人。
      const members = await repo.list('users', {}, { order: 'createdAt', limit: 1000 });
      const counts = {}; members.forEach(u => { counts[u.storeId] = (counts[u.storeId] || 0) + 1; });
      return { items: items.map(s => ({ ...s, userCount: counts[s._id] || 0 })) };
    }
    if (action === 'admin.storeSave') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); admin(fresh);
      const id = text(data.id, 24, '门店编号'); need(/^[a-z0-9_-]{2,24}$/.test(id), 'INVALID', '门店编号须为2至24位小写字母、数字、下划线或短横线');
      const name = text(data.name, 40, '门店名称'); need(typeof data.enabled === 'boolean', 'INVALID', '门店状态无效');
      const old = await tx.get('stores', id);
      await tx.put('stores', id, { name, enabled: data.enabled, createdAt: old?.createdAt || clock(), updatedAt: clock() });
      await audit(tx, fresh, 'store.save', id, { name, enabled: data.enabled }); return {};
    });
    // 门店被用户、会话和注册提醒引用，直接删除会留下指向不存在门店的悬空记录，
    // 所以只在完全没被引用时才允许删除；有引用时引导改用「停用」——停用同样能让门店
    // 从注册页和首页消失，但保留历史记录。删除是真删，不可恢复。
    if (action === 'admin.storeDelete') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); admin(fresh);
      const id = text(data.id, 24, '门店编号');
      const store = await tx.get('stores', id); need(store, 'INVALID', '门店不存在或已被删除');
      need((await tx.list('users', { storeId: id }, { order: 'createdAt', limit: 1 })).length === 0, 'INVALID', '该门店下还有账户，请先在「账户」里把他们转到其他门店');
      need((await tx.list('conversations', { storeId: id }, { order: 'createdAt', limit: 1 })).length === 0, 'INVALID', '该门店还有历史会话，请改用「停用」以保留记录');
      need((await tx.list('notifications', { storeId: id }, { order: 'createdAt', limit: 1 })).length === 0, 'INVALID', '该门店还有注册提醒，请改用「停用」以保留记录');
      await tx.remove('stores', id);
      await audit(tx, fresh, 'store.delete', id, { name: store.name }); return {};
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
      need(typeof data.mediaFileID === 'string' && (data.mediaFileID.startsWith('cloud://') || (allowLocalMedia && data.mediaFileID.length > 0)) && data.mediaFileID.length <= 256, 'INVALID', '请先上传广告素材（图片或视频）');
      return { mediaType: type, mediaFileID: data.mediaFileID };
    }
    // 素材可能被其他广告引用；删除记录不自动删除文件，待引用核验后由管理员清理。
    if (action === 'admin.bannerSave') return (async () => {
      admin(user);
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
        return { id };
      });
      return { id: saved.id };
    })();
    if (action === 'admin.bannerDelete') return (async () => {
      await repo.transaction(async tx => {
        const fresh = await actor(ctx, event.token, tx); admin(fresh);
        const id = text(data.id, 32, '广告编号');
        const old = await tx.get('banners', id);
        need(old, 'INVALID', '广告不存在或已被删除');
        await tx.remove('banners', id);
        await audit(tx, fresh, 'banner.delete', id, {});
        return { mediaFileID: old.mediaFileID || '' };
      });
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
    // ---------- 订单 ----------
    // 下单页要在提交前显示跑腿费，所以单独给一个只读配置接口（不泄露其它设置）。
    if (action === 'order.config') return { runnerFee: await runnerFee(repo) };
    // 下单：客户选服务、填取件地址与电话、可选拍照，并决定自送还是叫飞毛腿。
    if (action === 'order.create') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      need(fresh.role === 'customer', 'FORBIDDEN', '仅客户可以下单');
      const store = await tx.get('stores', fresh.storeId);
      need(store?.enabled, 'INVALID', '你所属的门店已停用，请先在「我的」里更换服务门店');
      const service = await tx.get('services', text(data.serviceId, 32, '服务'));
      need(service?.enabled, 'INVALID', '该服务已下架，请重新选择');
      const items = text(data.items, 200, '物品说明');
      const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '';
      const park = text(data.park, 20, '园区'); need(PARKS.includes(park), 'INVALID', '请选择园区');
      const parkDetail = text(data.parkDetail, 40, '详细地址');
      const contact = text(data.contact, 20, '联系电话'); need(/^1\d{10}$/.test(contact), 'INVALID', '联系电话格式不正确');
      need(['self','runner'].includes(data.delivery), 'INVALID', '请选择配送方式');
      // 照片只收云存储 fileID，最多 3 张；其它形状一律丢弃，避免把外链塞进订单。
      const media = (Array.isArray(data.media) ? data.media : []).filter(x => typeof x === 'string' && x.startsWith('cloud://')).slice(0, 3);
      const now = clock(), id = crypto.randomBytes(12).toString('hex');
      const order = { _id: id, customerId: fresh._id, customerName: fresh.nickname, storeId: store._id, serviceId: service._id, serviceName: service.name, items, note, park, parkDetail, contact, media, delivery: data.delivery, fee: data.delivery === 'runner' ? await runnerFee(tx) : 0, runnerId: '', runnerName: '', status: 'submitted', createdAt: now, updatedAt: now };
      await tx.put('orders', id, order);
      await tx.put('notifications', `ord_${id}`, { storeId: store._id, customerId: fresh._id, title: '新订单', nickname: fresh.nickname, park, createdAt: now });
      await audit(tx, fresh, 'order.create', id, { storeId: store._id, delivery: order.delivery });
      return { id, order: publicOrder(order, { contact: true }) };
    });
    // 客户看自己的订单
    if (action === 'order.mine') { const list = await repo.list('orders', { customerId: user._id }, { order: 'createdAt', skip: page(data.page) * 20, limit: 20 }); return { items: list.map(o => publicOrder(o, { contact: true })) }; }
    // 门店看本店订单；管理员看全部
    if (action === 'order.storeList') { staff(user); const list = await repo.list('orders', user.role === 'store' ? { storeId: user.storeId } : {}, { order: 'createdAt', skip: page(data.page) * 20, limit: 20 }); return { items: list.map(o => publicOrder(o, { contact: true })) }; }
    // 我接的跑腿单
    if (action === 'order.myRunner') { const list = await repo.list('orders', { runnerId: user._id }, { order: 'createdAt', skip: page(data.page) * 20, limit: 20 }); return { items: list.map(o => publicOrder(o, { contact: true })) }; }
    // 接单大厅：待接的跑腿单。这里不下发取件电话——翻一遍大厅就能拿到全校手机号是不可接受的。
    if (action === 'order.pool') {
      need(user.runner?.status === 'approved', 'FORBIDDEN', '先完成飞毛腿认证才能接单');
      const list = await repo.list('orders', { delivery: 'runner', status: 'submitted' }, { order: 'createdAt', skip: page(data.page) * 20, limit: 20 });
      return { items: list.map(o => publicOrder(o)) };
    }
    // 门店接单 → 服务中。自送单从 submitted 直接过来；选了飞毛腿的必须等送到门店（delivered）。
    if (action === 'order.accept') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); staff(fresh);
      const order = await tx.get('orders', text(data.id, 40, '订单'));
      need(order, 'INVALID', '订单不存在或已被删除');
      need(fresh.role === 'admin' || order.storeId === fresh.storeId, 'FORBIDDEN', '这不是本门店的订单');
      need(canOrderTransition(order.status, 'serving'), 'INVALID', order.delivery === 'runner' && order.status !== 'delivered' ? '这单要等飞毛腿送到门店后才能接单' : '当前状态不能接单');
      const saved = { ...order, status: 'serving', updatedAt: clock() };
      await tx.put('orders', order._id, saved);
      await audit(tx, fresh, 'order.accept', order._id, { from: order.status });
      return { order: publicOrder(saved, { contact: true }) };
    });
    // 门店完成订单
    if (action === 'order.finish') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); staff(fresh);
      const order = await tx.get('orders', text(data.id, 40, '订单'));
      need(order, 'INVALID', '订单不存在或已被删除');
      need(fresh.role === 'admin' || order.storeId === fresh.storeId, 'FORBIDDEN', '这不是本门店的订单');
      need(canOrderTransition(order.status, 'done'), 'INVALID', '只有服务中的订单才能标记完成');
      const saved = { ...order, status: 'done', updatedAt: clock() };
      await tx.put('orders', order._id, saved);
      await audit(tx, fresh, 'order.finish', order._id, {});
      return { order: publicOrder(saved, { contact: true }) };
    });
    // 取消：客户、门店、管理员都可以，但只能取消还没进入服务的单。
    if (action === 'order.cancel') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      const order = await tx.get('orders', text(data.id, 40, '订单'));
      need(order, 'INVALID', '订单不存在或已被删除');
      const isOwner = order.customerId === fresh._id;
      const isStore = fresh.role === 'store' && order.storeId === fresh.storeId;
      need(fresh.role === 'admin' || isOwner || isStore, 'FORBIDDEN', '无权取消这个订单');
      need(canOrderTransition(order.status, 'cancelled'), 'INVALID', '订单已经开始服务，无法取消');
      const saved = { ...order, status: 'cancelled', updatedAt: clock() };
      await tx.put('orders', order._id, saved);
      await audit(tx, fresh, 'order.cancel', order._id, { from: order.status });
      return { order: publicOrder(saved, { contact: true }) };
    });
    // 飞毛腿抢单：先抢先得，抢到即锁定，其他人从大厅看不到。
    if (action === 'order.take') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      need(fresh.runner?.status === 'approved', 'FORBIDDEN', '先完成飞毛腿认证才能接单');
      const order = await tx.get('orders', text(data.id, 40, '订单'));
      need(order, 'INVALID', '订单不存在或已被删除');
      need(canOrderTransition(order.status, 'runnerTaken'), 'INVALID', '这单已经被别人接走了');
      const saved = { ...order, status: 'runnerTaken', runnerId: fresh._id, runnerName: fresh.nickname, updatedAt: clock() };
      await tx.put('orders', order._id, saved);
      await audit(tx, fresh, 'order.take', order._id, {});
      return { order: publicOrder(saved, { contact: true }) };
    });
    // 配送进度：只有接单的那个飞毛腿能推进（已取件 → 已送达门店）。
    if (action === 'order.runnerAdvance') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      const order = await tx.get('orders', text(data.id, 40, '订单'));
      need(order, 'INVALID', '订单不存在或已被删除');
      need(order.runnerId === fresh._id, 'FORBIDDEN', '这不是你接的单');
      need(['picked','delivered'].includes(data.step), 'INVALID', '请选择要推进到哪一步');
      need(canOrderTransition(order.status, data.step), 'INVALID', '当前状态不能这样推进');
      const saved = { ...order, status: data.step, updatedAt: clock() };
      await tx.put('orders', order._id, saved);
      await audit(tx, fresh, `order.${data.step}`, order._id, {});
      return { order: publicOrder(saved, { contact: true }) };
    });
    // 申请跑腿资格：交证件照片，等管理员审核。
    if (action === 'runner.apply') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx);
      need(fresh.role === 'customer', 'FORBIDDEN', '仅客户可以申请跑腿资格');
      need(fresh.runner?.status !== 'approved', 'INVALID', '你已经通过认证了');
      need(fresh.runner?.status !== 'pending', 'INVALID', '申请正在审核中，请耐心等待');
      const realName = text(data.realName, 20, '真实姓名');
      const schoolId = text(data.schoolId, 20, '学号');
      const idCardPhoto = text(data.idCardPhoto, 300, '身份证照片');
      const studentCardPhoto = text(data.studentCardPhoto, 300, '学生证照片');
      // 正常环境只认云存储 fileID。开发期（DEV_LOGIN=1）额外放行 dev: 占位符——隐私声明没配好前
      // 选不了照片，不放行就整条跑腿流程没法联调。生产环境不设 DEV_LOGIN，这条分支不存在。
      const isPhoto = file => file.startsWith('cloud://') || (devLogin && file.startsWith('dev:'));
      need(isPhoto(idCardPhoto) && isPhoto(studentCardPhoto), 'INVALID', '证件照片必须先上传到云存储');
      const runner = { status: 'pending', realName, schoolId, idCardPhoto, studentCardPhoto, appliedAt: clock(), reviewedAt: 0, reason: '' };
      const saved = { ...fresh, runner, updatedAt: clock() };
      await tx.put('users', fresh._id, saved);
      await audit(tx, fresh, 'runner.apply', fresh._id, {});
      return { user: publicUser(saved) };
    });
    // 管理员审核跑腿申请。通过或驳回后立刻丢掉证件照片引用与学号：留存最小化。
    if (action === 'admin.runnerReview') {
      const photos = [];
      const reviewed = await repo.transaction(async tx => {
        const fresh = await actor(ctx, event.token, tx); admin(fresh);
        const target = await tx.get('users', text(data.id, 32, '用户'));
        need(target?.runner?.status === 'pending', 'INVALID', '该申请不存在或已经处理过了');
        need(['approved','rejected'].includes(data.result), 'INVALID', '请选择审核结果');
        const reason = data.result === 'rejected' ? text(data.reason, 40, '驳回理由') : '';
        const runner = { ...target.runner, status: data.result, reviewedAt: clock(), reason };
        photos.push(runner.idCardPhoto, runner.studentCardPhoto);
        delete runner.idCardPhoto; delete runner.studentCardPhoto; delete runner.schoolId;
        await tx.put('users', target._id, { ...target, runner, updatedAt: clock() });
        await audit(tx, fresh, 'runner.review', target._id, { result: data.result });
        return publicUser({ ...target, runner });
      });
      // 云存储删除是外部调用，放在事务之外；删不掉只告警，不影响审核结论。
      if (storageDelete) for (const file of photos.filter(Boolean)) { try { await storageDelete(file); } catch (_) { console.warn('runner photo cleanup failed'); } }
      return { user: reviewed };
    }
    // 跑腿费配置（单位：分）。默认 3 元，管理员随时可改。
    if (action === 'admin.runnerFee') return repo.transaction(async tx => {
      const fresh = await actor(ctx, event.token, tx); admin(fresh);
      const fee = Number(data.fee);
      need(Number.isInteger(fee) && fee >= 0 && fee <= 100000, 'INVALID', '跑腿费需为 0 到 1000 元之间的整数（单位分）');
      await tx.put('settings', 'delivery', { runnerFee: fee, updatedAt: clock() });
      await audit(tx, fresh, 'settings.runnerFee', 'delivery', { fee });
      return { runnerFee: fee };
    });
    throw new BusinessError('NOT_FOUND', '接口不存在');
  };
}
module.exports = { createService, INSPECT };
