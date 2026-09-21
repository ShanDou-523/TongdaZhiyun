const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const uid = openid => hash(openid).slice(0, 32);
// 开发期身份切换：仅当服务端显式开启 devLogin 时，允许用 11 位手机号作为"扮演身份"替代真实
// openid，让同一个微信号分饰多角做多端联调。真实 openid 是 28 位混排字符串，不可能是 11 位
// 纯数字，两者不会撞车。生产环境 devLogin 恒为 false，此函数永远返回真实 openid。
const resolveOpenid = (realOpenid, devActor, devLogin) => (devLogin && typeof devActor === 'string' && /^1\d{10}$/.test(devActor) ? devActor : realOpenid);
// 把用户输入的搜索词转成"字面量"再交给数据库做模糊匹配。元字符必须转义，否则用户敲一个 "."
// 就会匹配全部记录——搜索结果看起来像数据泄漏，查询代价也不可控。
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 订单状态机。选飞毛腿的单，在门店接单前多三段配送流程（接单 → 取件 → 送达门店）；
// 自送的单从 submitted 直接进 serving。每一步由特定角色触发，service 层逐个校验，
// 前端传来的状态一律不认（同 order-contract.js 的原则，但那条链是纯服务订单的草稿）。
const ORDER_FLOW = {
  submitted: ['runnerTaken', 'serving', 'cancelled'],
  runnerTaken: ['picked', 'cancelled'],
  picked: ['delivered', 'cancelled'],
  delivered: ['serving'],
  serving: ['done'],
  done: [],
  cancelled: []
};
const ORDER_STATUS = { submitted: '待处理', runnerTaken: '飞毛腿已接单', picked: '已取件', delivered: '已送达门店', serving: '服务中', done: '已完成', cancelled: '已取消' };
const canOrderTransition = (from, to) => (ORDER_FLOW[from] || []).includes(to);
const PARKS = ['一园区','二园区','三园区','四园区','五园区','六园区','七园区','八园区','九园区','十园区','十一园区','青教公寓','其它'];
const CATEGORIES = { laundry: '衣物洗护', housekeeping: '家政服务' };
class BusinessError extends Error { constructor(code, message) { super(message); this.code = code; } }
function requireThat(ok, code, message) { if (!ok) throw new BusinessError(code, message); }
function text(value, max, label) { requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 'INVALID', `${label}格式不正确`); return value.trim(); }
function profile(input) {
  requireThat(PARKS.includes(input.park), 'INVALID', '请选择园区');
  requireThat(['男','女','不愿透露'].includes(input.gender), 'INVALID', '请选择性别');
  // 选「其它」时必须补充自填位置（如某楼栋）；改回普通园区时清空，避免残留旧值。
  const parkDetail = input.park === '其它' ? text(input.parkDetail, 20, '所在位置') : '';
  return { nickname: text(input.nickname, 24, '昵称'), park: input.park, parkDetail, gender: input.gender };
}
function publicUser(user) {
  if (!user) return null;
  const { _id, nickname, phone, park, parkDetail, gender, role, storeId, enabled, createdAt } = user;
  // 跑腿认证只回传状态和姓名，不回传证件照片引用与学号：这些信息没必要在客户端到处流转。
  const runner = user.runner ? { status: user.runner.status, realName: user.runner.realName || '', appliedAt: user.runner.appliedAt || 0, reviewedAt: user.runner.reviewedAt || 0, reason: user.runner.reason || '' } : null;
  return { _id, nickname, phone, park, parkDetail, gender, role, storeId, enabled, createdAt, runner };
}
// 订单对外视图。取件电话是敏感信息：只有"这一单已经落到某个飞毛腿手里、或门店/管理员在看"
// 才下发；接单大厅里的单子不给电话，避免任何人翻大厅就能拿到全校学生的手机号。
function publicOrder(order, opts = {}) {
  if (!order) return null;
  const view = {
    _id: order._id, customerId: order.customerId, customerName: order.customerName,
    storeId: order.storeId, serviceId: order.serviceId, serviceName: order.serviceName,
    items: order.items, note: order.note, park: order.park, parkDetail: order.parkDetail,
    media: order.media || [], delivery: order.delivery, fee: order.fee,
    runnerId: order.runnerId || '', runnerName: order.runnerName || '',
    status: order.status, statusText: ORDER_STATUS[order.status] || order.status,
    createdAt: order.createdAt, updatedAt: order.updatedAt
  };
  if (opts.contact) view.contact = order.contact;
  return view;
}
function allowedConversation(user, room) {
  return !!room && ((user.role === 'customer' && room.customerId === user._id) || (user.role === 'store' && room.storeId === user.storeId));
}
module.exports = { hash, uid, resolveOpenid, escapeRegExp, ORDER_FLOW, ORDER_STATUS, canOrderTransition, PARKS, CATEGORIES, BusinessError, requireThat, text, profile, publicUser, publicOrder, allowedConversation };
