const { requireThat: need } = require('../domain');
function quote(service, data, now) {
 const house = service.category === 'housekeeping';
 let selection = {};
 if (service.variants && service.variants.length) {
  const variant = service.variants.find(v => v.id === data.variantId);
  need(variant && Number.isInteger(variant.price) && variant.price >= 0, 'INVALID', '请选择有效的服务规格');
  const quantity = Number(data.quantity);
  need(Number.isFinite(quantity) && quantity > 0 && quantity <= 99 && (service.unit === '㎡' ? /^\d+(\.\d{1,2})?$/.test(String(data.quantity)) : Number.isInteger(quantity)), 'INVALID', '数量须为1至99的整数；面积支持两位小数且不超过99㎡');
  need(!house || quantity === 1, 'INVALID', '家政每单预约一间');
  selection = { variantId: variant.id, variantName: variant.name, quantity, unit: service.unit, unitPrice: variant.price, serviceAmount: Math.round(variant.price * quantity) };
 }
 let appointment = '';
 if (house) {
  appointment = data.appointment;
  need(typeof appointment === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(appointment), 'INVALID', '请选择预约日期和时间');
  const date = new Date(appointment.replace(' ', 'T') + ':00+08:00');
  need(Number.isFinite(date.getTime()) && date.getTime() > now && date.getTime() <= now + 90 * 86400000 && new Date(date.getTime() + 8 * 3600000).toISOString().slice(0,16).replace('T',' ') === appointment, 'INVALID', '预约时间须在未来90天内');
  need(data.delivery === 'onsite', 'INVALID', '家政为上门服务');
 } else need(['self','runner'].includes(data.delivery), 'INVALID', '请选择配送方式');
 return { ...selection, category: service.category, appointment };
}
module.exports = { quote };
