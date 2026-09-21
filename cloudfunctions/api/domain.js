const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const uid = openid => hash(openid).slice(0, 32);
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
  const room = input.dormRoom;
  requireThat(room === undefined || (typeof room === 'string' && room.trim().length <= 20), 'INVALID', '宿舍号须为20字以内的文本');
  return { ...(room === undefined ? {} : { dormRoom: room.trim() }), nickname: text(input.nickname, 24, '昵称'), park: input.park, parkDetail, gender: input.gender };
}
function publicUser(user) {
  if (!user) return null;
  const { _id, nickname, phone, park, parkDetail, dormRoom = '', gender, role, storeId, enabled, createdAt } = user;
  return { _id, nickname, phone, park, parkDetail, dormRoom, gender, role, storeId, enabled, createdAt };
}
function allowedConversation(user, room) {
  return !!room && ((user.role === 'customer' && room.customerId === user._id) || (user.role === 'store' && room.storeId === user.storeId));
}
module.exports = { hash, uid, PARKS, CATEGORIES, BusinessError, requireThat, text, profile, publicUser, allowedConversation };
