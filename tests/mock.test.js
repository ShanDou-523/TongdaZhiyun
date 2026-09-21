// 演示层（miniprogram/mock）的回归测试。
// 这一层是开发期的主要工作环境，坏掉了整个团队都开不了工，所以纳入 npm test。
const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('../miniprogram/mock/index');

const fails = (fn, code) => assert.throws(fn, e => e.code === code, `应当抛出 ${code}`);
const enter = (role, more = {}) => mock.call('auth.phone', { code: `mock-${role}`, nickname: '演示用户', storeId: 'main', ...more });

test('演示层：门店列表只暴露启用的门店', () => {
  assert.equal(mock.call('public.stores').items.length, 2);
  assert.ok(!mock.call('public.stores').items.some(s => s._id === 'west'));
});

test('演示层：三种身份都能登录，token 与身份一一对应且互不干扰', () => {
  const admin = enter('admin'), shop = enter('store'), customer = enter('customer');
  assert.equal(admin.user.role, 'admin');
  assert.equal(shop.user.role, 'store');
  assert.equal(customer.user.role, 'customer');
  assert.equal(mock.call('me', {}, admin.token).user.role, 'admin');
  assert.equal(mock.call('me', {}, shop.token).user.role, 'store');
  assert.equal(mock.call('me', {}, customer.token).user.role, 'customer');
  assert.deepEqual(mock.call('logout', {}, shop.token), {});
  fails(() => mock.call('me', {}, shop.token), 'AUTH');
  assert.equal(mock.call('me', {}, admin.token).user.role, 'admin');
  mock.reset();
});

test('演示层：管理后台服务增删改查可用，越权被拒，留审计', () => {
  const admin = enter('admin'), customer = enter('customer');
  fails(() => mock.call('admin.services', {}, customer.token), 'FORBIDDEN');
  fails(() => mock.call('admin.serviceSave', { name: '代收快递', category: 'laundry', description: '园区门口代收', enabled: true }, customer.token), 'FORBIDDEN');
  assert.equal(mock.call('admin.services', {}, admin.token).items.length, 2);

  const created = mock.call('admin.serviceSave', { name: '代收快递', category: 'laundry', description: '园区门口代收', enabled: true }, admin.token);
  assert.ok(created.id.startsWith('svc_'));
  assert.equal(mock.call('admin.services', {}, admin.token).items.length, 3);
  assert.equal(mock.call('services.list', {}, customer.token).items.length, 3, '启用后客户端能看到');

  mock.call('admin.serviceSave', { id: created.id, name: '代收快递（改）', category: 'housekeeping', description: '改了说明', enabled: false }, admin.token);
  const saved = mock.call('admin.services', {}, admin.token).items.find(s => s._id === created.id);
  assert.equal(saved.name, '代收快递（改）');
  assert.equal(saved.category, 'housekeeping');
  assert.equal(mock.call('services.list', {}, customer.token).items.length, 2, '停用后客户端看不到');

  fails(() => mock.call('admin.serviceSave', { name: 'x', category: 'meal', description: 'y', enabled: true }, admin.token), 'INVALID');
  fails(() => mock.call('admin.serviceSave', { name: ' ', category: 'laundry', description: 'y', enabled: true }, admin.token), 'INVALID');
  fails(() => mock.call('admin.serviceSave', { id: 'svc_none', name: 'x', category: 'laundry', description: 'y', enabled: true }, admin.token), 'INVALID');

  mock.call('admin.serviceDelete', { id: created.id }, admin.token);
  assert.equal(mock.call('admin.services', {}, admin.token).items.length, 2);
  fails(() => mock.call('admin.serviceDelete', { id: created.id }, admin.token), 'INVALID');

  const actions = mock.call('admin.inspect', { collection: 'auditLogs' }, admin.token).items.map(x => x.action);
  assert.ok(actions.includes('service.save') && actions.includes('service.delete'));
  fails(() => mock.call('admin.inspect', { collection: 'phoneClaims' }, admin.token), 'INVALID');
  fails(() => mock.call('admin.qrcode', { storeId: 'main', version: 'trial' }, admin.token), 'MOCK');
  mock.reset();
});

test('演示层：客户与门店的会话互相可见、未读正确、越权被拒', () => {
  const customer = enter('customer', { nickname: '小张' }), shop = enter('store');
  fails(() => mock.call('staff.customers', {}, customer.token), 'FORBIDDEN');
  fails(() => mock.call('admin.stores', {}, shop.token), 'FORBIDDEN');

  const room = mock.call('chat.open', {}, customer.token);
  assert.ok(room.roomId);
  assert.equal(mock.call('chat.messages', { roomId: room.roomId }, customer.token).items.length, 1, '门店自动打招呼');
  assert.equal(mock.call('chat.send', { roomId: room.roomId, content: '你好，想洗羽绒服', requestId: 'r1' }, customer.token).message.seq, 2);

  const rooms = mock.call('chat.rooms', {}, shop.token).items;
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].unread, true);
  assert.ok(mock.call('staff.customers', {}, shop.token).items.length >= 1);
  fails(() => mock.call('chat.messages', { roomId: 'main_u_c1' }, customer.token), 'FORBIDDEN');
  mock.reset();
});

test('演示层：重置后所有会话失效，等于重启小程序', () => {
  const admin = enter('admin');
  assert.equal(mock.call('me', {}, admin.token).user.role, 'admin');
  mock.reset();
  fails(() => mock.call('me', {}, 'mock-admin'), 'AUTH');
});

test('演示层：内容安全演示规则生效（含「违规」二字即拦截），正常内容不受影响', () => {
  const customer = enter('customer');
  const room = mock.call('chat.open', {}, customer.token);
  fails(() => mock.call('chat.send', { roomId: room.roomId, content: '这里有违规内容', requestId: 'b1' }, customer.token), 'CONTENT');
  assert.equal(mock.call('chat.messages', { roomId: room.roomId }, customer.token).items.length, 1, '被拦截的消息不入库');
  assert.equal(mock.call('chat.send', { roomId: room.roomId, content: '正常消息没问题', requestId: 'b2' }, customer.token).message.seq, 2);
  fails(() => mock.call('profile.update', { nickname: '违规昵称', park: '一园区', gender: '男' }, customer.token), 'CONTENT');
  assert.equal(mock.call('profile.update', { nickname: '好邻居', park: '一园区', gender: '男' }, customer.token).user.nickname, '好邻居');
  mock.reset();
});

test('演示层：广告位按权重排序、只显示投放中的，管理端可增删改', () => {
  const admin = enter('admin'), customer = enter('customer');
  const list = mock.call('banners.list', {}, customer.token).items;
  assert.deepEqual(list.map(b => b._id), ['bn_newuser', 'bn_laundry'], '权重大的在前，停投的被过滤');

  fails(() => mock.call('admin.bannerSave', { title: 'x', subtitle: 'y', weight: 10, enabled: true }, customer.token), 'FORBIDDEN');
  fails(() => mock.call('admin.bannerSave', { title: 'x', subtitle: 'y', weight: '9', enabled: true }, admin.token), 'INVALID');
  fails(() => mock.call('admin.bannerSave', { title: 'x', subtitle: 'y', weight: 10, enabled: true, mediaType: 'gif' }, admin.token), 'INVALID');
  fails(() => mock.call('admin.bannerSave', { title: 'x', subtitle: 'y', weight: 10, enabled: true, mediaType: 'image' }, admin.token), 'INVALID');

  const created = mock.call('admin.bannerSave', { title: '运动会特惠', subtitle: '本周洗护全场 9 折', weight: 200, enabled: true, mediaType: 'image', mediaFileID: 'wxfile://tmp/poster.jpg' }, admin.token);
  assert.ok(created.id.startsWith('bn_'));
  const first = mock.call('banners.list', {}, customer.token).items[0];
  assert.equal(first._id, created.id, '新广告权重最高排第一');
  assert.equal(first.mediaType, 'image'); assert.equal(first.mediaFileID, 'wxfile://tmp/poster.jpg');

  mock.call('admin.bannerSave', { id: created.id, title: '运动会特惠（改）', subtitle: '本周洗护全场 8 折', weight: 200, enabled: false }, admin.token);
  assert.equal(mock.call('banners.list', {}, customer.token).items.length, 2, '停投后从首页消失');

  mock.call('admin.bannerDelete', { id: created.id }, admin.token);
  fails(() => mock.call('admin.bannerDelete', { id: created.id }, admin.token), 'INVALID');
  const actions = mock.call('admin.inspect', { collection: 'auditLogs' }, admin.token).items.map(x => x.action);
  assert.ok(actions.includes('banner.save') && actions.includes('banner.delete'));
  mock.reset();
});
