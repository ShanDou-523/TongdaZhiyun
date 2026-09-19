// Generated from cloudfunctions/api by scripts/sync-demo.js. Do not edit.
// Local demo only; production authentication remains in the cloud function.
const crypto = require('./crypto');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const uid = openid => hash(openid).slice(0, 32);
const PARKS = ['一园区','二园区','三园区','四园区','五园区','六园区','七园区','八园区','九园区','十园区'];
class BusinessError extends Error { constructor(code, message) { super(message); this.code = code; } }
function requireThat(ok, code, message) { if (!ok) throw new BusinessError(code, message); }
function text(value, max, label) { requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 'INVALID', `${label}格式不正确`); return value.trim(); }
function profile(input) {
  requireThat(PARKS.includes(input.park), 'INVALID', '请选择一园区至十园区');
  requireThat(['男','女','不愿透露'].includes(input.gender), 'INVALID', '请选择性别');
  return { nickname: text(input.nickname, 24, '昵称'), park: input.park, gender: input.gender };
}
function publicUser(user) {
  if (!user) return null;
  const { _id, nickname, phone, park, gender, role, storeId, enabled, createdAt } = user;
  return { _id, nickname, phone, park, gender, role, storeId, enabled, createdAt };
}
function allowedConversation(user, room) {
  return !!room && ((user.role === 'customer' && room.customerId === user._id) || (user.role === 'store' && room.storeId === user.storeId));
}
module.exports = { hash, uid, PARKS, BusinessError, requireThat, text, profile, publicUser, allowedConversation };
