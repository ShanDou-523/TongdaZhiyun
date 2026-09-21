// 本地演示数据层：mock 模式下替代云函数的假后端，全部数据存在内存里。
// 用途：在 AppID、云环境、手机号能力都不具备时，也能把整个小程序点通、改 UI、调交互。
// 上线前把 config.js 里的 mock 改回 false，本文件不会被走到。
// 结构与 cloudfunctions/api/service.js 一一对应，方便对照阅读。
const { categories } = require('../utils/constants');

const DAY = 86400000;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function need(ok, code, message) { if (!ok) fail(code, message); }
function text(value, max, label) { need(typeof value === 'string' && value.trim() && value.trim().length <= max, 'INVALID', `${label}格式不正确`); return value.trim(); }
// 演示版内容安全检测：真实环境走微信 msgSecCheck 接口，演示模式用简单规则模拟拦截效果。
function checkContent(value) { need(String(value || '').indexOf('违规') < 0, 'CONTENT', '内容包含违规信息，请修改后重试（演示规则：含「违规」二字即拦截）'); }

function seed() {
  const at = Date.now();
  return {
    sessions: {},
    stores: {
      main: { _id: 'main', name: '园区服务中心', enabled: true, createdAt: at - 5 * DAY },
      east: { _id: 'east', name: '东区生活馆', enabled: true, createdAt: at - 4 * DAY },
      west: { _id: 'west', name: '西区服务站', enabled: false, createdAt: at - 3 * DAY }
    },
    users: {
      u_c1: { _id: 'u_c1', nickname: '陈阿姨', phone: '13800000001', park: '二园区', gender: '女', role: 'customer', storeId: 'main', enabled: true, createdAt: at - 2 * DAY },
      u_c2: { _id: 'u_c2', nickname: '李先生', phone: '13800000002', park: '三园区', gender: '男', role: 'customer', storeId: 'main', enabled: true, createdAt: at - DAY },
      u_s1: { _id: 'u_s1', nickname: '王店长', phone: '13800000003', park: '一园区', gender: '不愿透露', role: 'store', storeId: 'main', enabled: true, createdAt: at - DAY }
    },
    services: [
      { _id: 'svc_laundry', name: '衣物洗护', category: 'laundry', description: '按件收洗，48 小时可取', enabled: true, createdAt: at - 2 * DAY },
      { _id: 'svc_housekeeping', name: '家政保洁', category: 'housekeeping', description: '日常保洁与深度清洁', enabled: true, createdAt: at - DAY }
    ],
    banners: [
      { _id: 'bn_newuser', title: '新用户福利', subtitle: '注册即领 10 元现金红包，3 万元额度送完即止', weight: 100, enabled: true, mediaType: 'none', mediaFileID: '', createdAt: at - DAY },
      { _id: 'bn_laundry', title: '开学季洗护特惠', subtitle: '首单衣物洗护 8 折，宿舍楼下取送', weight: 50, enabled: true, mediaType: 'none', mediaFileID: '', createdAt: at - 2 * DAY },
      { _id: 'bn_off', title: '已停投示例', subtitle: '这条不会出现在首页', weight: 10, enabled: false, mediaType: 'none', mediaFileID: '', createdAt: at }
    ],
    rooms: {},
    messages: {},
    notices: [{ _id: 'n_1', storeId: 'main', customerId: 'u_c1', title: '新客户注册', nickname: '陈阿姨', park: '二园区', createdAt: at - 2 * DAY }],
    audits: [],
    counter: 0
  };
}
let state = seed();

function audit(actor, action, target, detail) {
  state.counter += 1;
  state.audits.push({ _id: `log_${state.counter}`, actorId: actor._id, action, target, detail, createdAt: Date.now() });
}
function room(storeId, customerId) {
  const key = `${storeId}_${customerId}`;
  if (!state.rooms[key]) {
    state.rooms[key] = { _id: key, storeId, customerId, customerName: (state.users[customerId] || {}).nickname || '客户', lastText: '', lastMessageAt: 0, sequence: 0, customerReadSeq: 0, storeReadSeq: 0, createdAt: Date.now() };
  }
  return state.rooms[key];
}
function post(roomId, sender, content) {
  const box = state.rooms[roomId];
  box.sequence += 1;
  const item = { _id: `msg_${roomId}_${box.sequence}`, roomId, senderId: sender._id, senderRole: sender.role, content, seq: box.sequence, createdAt: Date.now() };
  state.messages[item._id] = item;
  box.lastText = content.slice(0, 80);
  box.lastMessageAt = item.createdAt;
  box[sender.role === 'customer' ? 'customerReadSeq' : 'storeReadSeq'] = box.sequence;
  return item;
}
function login(data) {
  const code = String(data.code || '');
  const role = code.indexOf('store') > -1 ? 'store' : code.indexOf('admin') > -1 ? 'admin' : 'customer';
  const store = state.stores[data.storeId] && state.stores[data.storeId].enabled ? data.storeId : 'main';
  const id = `u_demo_${role}`, token = `mock-${role}`;
  const user = {
    _id: id,
    nickname: text(data.nickname || '演示用户', 24, '昵称'),
    phone: role === 'admin' ? '13800000009' : role === 'store' ? '13800000008' : '13800000007',
    park: data.park || '一园区',
    parkDetail: data.park === '其它' ? (data.parkDetail || '') : '',
    gender: data.gender || '不愿透露',
    role, storeId: store, enabled: true,
    createdAt: state.users[id] ? state.users[id].createdAt : Date.now()
  };
  // token 与用户一一对应，和真实后端一致：多个身份可以同时存在，互不干扰。
  state.users[id] = user;
  state.sessions[token] = id;
  state.notices.unshift({ _id: `n_${state.notices.length + 1}`, storeId: store, customerId: id, title: '新客户注册', nickname: user.nickname, park: user.park, createdAt: Date.now() });
  return { token, user };
}

function call(action, data = {}, token = '') {
  if (action === 'public.stores') return { items: Object.values(state.stores).filter(s => s.enabled) };
  if (action === 'auth.phone') return login(data);
  const user = state.users[state.sessions[token]];
  need(user, 'AUTH', '演示会话已失效，请重新选择演示身份');
  const isAdmin = user.role === 'admin', isStaff = isAdmin || user.role === 'store';
  const mine = () => Object.values(state.users).filter(u => (isAdmin || u.storeId === user.storeId));
  const byTime = (a, b) => b.createdAt - a.createdAt;

  if (action === 'me') return { user, store: state.stores[user.storeId] };
  if (action === 'logout') { delete state.sessions[token]; return {}; }
  if (action === 'profile.update') { checkContent(data.nickname); Object.assign(user, { nickname: text(data.nickname, 24, '昵称'), park: data.park, parkDetail: data.park === '其它' ? (data.parkDetail || '') : '', gender: data.gender }); state.users[user._id] = user; return { user }; }
  if (action === 'services.list') return { items: state.services.filter(s => s.enabled).sort(byTime) };
  if (action === 'banners.list') return { items: state.banners.filter(b => b.enabled).sort((a, b) => b.weight - a.weight) };

  if (action === 'chat.open') {
    need(user.role !== 'admin', 'FORBIDDEN', '管理员请使用数据库查看记录');
    const customerId = user.role === 'customer' ? user._id : (data.customerId || 'u_c1');
    const box = room(user.storeId, customerId);
    if (!box.sequence) post(box._id, { _id: 'u_s1', role: 'store' }, '您好，这里是南通大学店，有什么可以帮您？');
    return { roomId: box._id };
  }
  if (action === 'chat.rooms') {
    need(user.role !== 'admin', 'FORBIDDEN', '管理员请使用数据库查看记录');
    const items = Object.values(state.rooms)
      .filter(r => (user.role === 'customer' ? r.customerId === user._id : r.storeId === user.storeId))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .map(r => ({ ...r, unread: r.sequence > (user.role === 'customer' ? r.customerReadSeq : r.storeReadSeq) }));
    return { items };
  }
  if (action === 'chat.messages') {
    const box = state.rooms[data.roomId];
    need(box, 'FORBIDDEN', '无权访问该会话');
    const items = Object.values(state.messages).filter(m => m.roomId === box._id).sort((a, b) => a.seq - b.seq);
    return { items, latestSeq: box.sequence, more: false };
  }
  if (action === 'chat.read') {
    const box = state.rooms[data.roomId];
    need(box, 'FORBIDDEN', '无权访问该会话');
    const key = user.role === 'customer' ? 'customerReadSeq' : 'storeReadSeq';
    box[key] = Math.max(box[key], Number(data.seq) || 0);
    return {};
  }
  if (action === 'chat.send') {
    const box = state.rooms[data.roomId];
    need(box, 'FORBIDDEN', '无权访问该会话');
    const content = text(data.content, 1000, '消息');
    checkContent(content);
    return { message: post(box._id, user, content) };
  }

  if (action === 'staff.customers') { need(isStaff, 'FORBIDDEN', '仅门店或管理员可操作'); return { items: mine().filter(u => u.role === 'customer').sort(byTime) }; }
  if (action === 'staff.notifications') { need(isStaff, 'FORBIDDEN', '仅门店或管理员可操作'); return { items: state.notices.filter(n => isAdmin || n.storeId === user.storeId).sort(byTime), readAt: 0, serverTime: Date.now() }; }
  if (action === 'staff.readNotifications') { need(isStaff, 'FORBIDDEN', '仅门店或管理员可操作'); return {}; }

  if (action === 'admin.stores') { need(isAdmin, 'FORBIDDEN', '仅管理员可操作'); return { items: Object.values(state.stores).sort(byTime) }; }
  if (action === 'admin.storeSave') {
    need(isAdmin, 'FORBIDDEN', '仅管理员可操作');
    const id = text(data.id, 24, '门店编号');
    const old = state.stores[id];
    state.stores[id] = { _id: id, name: text(data.name, 40, '门店名称'), enabled: data.enabled === true, createdAt: old ? old.createdAt : Date.now() };
    audit(user, 'store.save', id, { name: state.stores[id].name, enabled: state.stores[id].enabled });
    return {};
  }
  if (action === 'admin.userUpdate') {
    need(isAdmin, 'FORBIDDEN', '仅管理员可操作');
    const target = state.users[text(data.id, 32, '用户')];
    need(target, 'INVALID', '用户不存在；演示数据里只有预置的几位用户');
    need(['customer', 'store'].includes(data.role), 'INVALID', '账户角色无效');
    need(state.stores[data.storeId], 'INVALID', '请选择启用的门店');
    Object.assign(target, { role: data.role, enabled: data.enabled === true, storeId: data.storeId });
    audit(user, 'user.update', target._id, { role: target.role, enabled: target.enabled, storeId: target.storeId });
    return {};
  }
  if (action === 'admin.services') { need(isAdmin, 'FORBIDDEN', '仅管理员可操作'); return { items: state.services.slice().sort(byTime) }; }
  if (action === 'admin.serviceSave') {
    need(isAdmin, 'FORBIDDEN', '仅管理员可操作');
    const name = text(data.name, 40, '服务名称');
    need(Object.keys(categories).includes(data.category), 'INVALID', '请选择服务类别');
    const description = text(data.description, 60, '服务说明');
    need(typeof data.enabled === 'boolean', 'INVALID', '服务状态无效');
    const id = data.id ? text(data.id, 32, '服务编号') : `svc_${Date.now().toString(36)}`;
    const old = state.services.find(s => s._id === id);
    need(!data.id || old, 'INVALID', '服务不存在或已被删除');
    if (old) Object.assign(old, { name, category: data.category, description, enabled: data.enabled, updatedAt: Date.now() });
    else state.services.push({ _id: id, name, category: data.category, description, enabled: data.enabled, createdAt: Date.now() });
    audit(user, 'service.save', id, { name, category: data.category, enabled: data.enabled });
    return { id };
  }
  if (action === 'admin.serviceDelete') {
    need(isAdmin, 'FORBIDDEN', '仅管理员可操作');
    const id = text(data.id, 32, '服务编号');
    const index = state.services.findIndex(s => s._id === id);
    need(index > -1, 'INVALID', '服务不存在或已被删除');
    state.services.splice(index, 1);
    audit(user, 'service.delete', id, {});
    return {};
  }
  if (action === 'admin.banners') { need(isAdmin, 'FORBIDDEN', '仅管理员可操作'); return { items: state.banners.slice().sort(byTime) }; }
  if (action === 'admin.bannerSave') {
    need(isAdmin, 'FORBIDDEN', '仅管理员可操作');
    const title = text(data.title, 30, '广告标题');
    const subtitle = text(data.subtitle, 60, '广告说明');
    const weight = data.weight;
    need(typeof weight === 'number' && Number.isInteger(weight) && weight >= 0 && weight <= 999, 'INVALID', '权重须为 0–999 的整数，数字越大越靠前');
    need(typeof data.enabled === 'boolean', 'INVALID', '广告状态无效');
    const id = data.id ? text(data.id, 32, '广告编号') : `bn_${Date.now().toString(36)}`;
    const old = state.banners.find(b => b._id === id);
    need(!data.id || old, 'INVALID', '广告不存在或已被删除');
    // 演示模式没有云存储，素材直接存本地临时路径（真机/联调环境由云函数校验 cloud:// fileID）。
    const mediaType = data.mediaType === undefined ? 'none' : data.mediaType;
    need(['none', 'image', 'video'].includes(mediaType), 'INVALID', '广告素材类型无效');
    const mediaFileID = mediaType === 'none' ? '' : text(data.mediaFileID, 256, '广告素材');
    if (old) Object.assign(old, { title, subtitle, weight, enabled: data.enabled, mediaType, mediaFileID, updatedAt: Date.now() });
    else state.banners.push({ _id: id, title, subtitle, weight, enabled: data.enabled, mediaType, mediaFileID, createdAt: Date.now() });
    audit(user, 'banner.save', id, { title, weight, enabled: data.enabled });
    return { id };
  }
  if (action === 'admin.bannerDelete') {
    need(isAdmin, 'FORBIDDEN', '仅管理员可操作');
    const id = text(data.id, 32, '广告编号');
    const index = state.banners.findIndex(b => b._id === id);
    need(index > -1, 'INVALID', '广告不存在或已被删除');
    state.banners.splice(index, 1);
    audit(user, 'banner.delete', id, {});
    return {};
  }
  if (action === 'admin.inspect') {
    need(isAdmin, 'FORBIDDEN', '仅管理员可操作');
    const table = { users: Object.values(state.users), stores: Object.values(state.stores), services: state.services, banners: state.banners, conversations: Object.values(state.rooms), messages: Object.values(state.messages), notifications: state.notices, auditLogs: state.audits }[data.collection];
    need(table, 'INVALID', '不可查询该集合');
    audit(user, 'database.read', data.collection, { page: data.page || 0 });
    return { items: table.slice(0, 20) };
  }
  if (action === 'admin.qrcode') fail('MOCK', '演示模式不生成真实二维码，等配置好真实 AppID 和云环境后再试');
  fail('NOT_FOUND', '演示模式暂未实现该接口：' + action);
}

module.exports = { call, reset: () => { state = seed(); }, categories };
