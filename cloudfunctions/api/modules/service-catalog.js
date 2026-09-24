// Source: the operator's laundry and housekeeping price list. Amounts are in yuan here;
// all values sent to the database are integer cents.
const items = [];
const legacyIds = {
  '2小时深度保洁（不擦窗）': 'test_clean2',
  '3小时深度保洁（不擦窗）': 'test_clean3',
  '2小时大扫除（含双面擦窗）': 'test_full2',
  '3小时大扫除（含双面擦窗）': 'test_full3',
  '衬衫': 'test_shirt', '毛衣': 'test_sweater', '普通连衣裙': 'test_dress',
  '短款羽绒服': 'test_down', '长款大衣': 'test_coat',
  '网面运动鞋': 'test_mesh', '皮面运动鞋': 'test_leather_shoe',
  '短款皮鞋': 'test_shoe', '低筒雪地靴': 'test_boot',
  '普通窗帘': 'test_curtain', '毛毯': 'test_blanket', '羽绒被': 'test_quilt',
  '普通三件套（枕套×1）': 'test_set3', '普通四件套（枕套×2）': 'test_set4',
  '奢品包包': 'test_bag', '黑色皮衣': 'test_leather',
  '皮草大衣': 'test_fur', '皮毛一体': 'test_shearling'
};
function add(key, name, category, group, unit, options, description) {
  const variants = options.map(([label, yuan], index) => ({ id: String(index), name: label, price: yuan * 100 }));
  items.push({
    _id: legacyIds[name] || `catalog_${key}`, name, category, group, unit,
    description: description || '按所选规格计价，附加处理需门店确认',
    enabled: true, variants
  });
}
const levels = ['普洗', '普通精洗', '高级精洗'];
function wash(key, name, group, unit, prices) {
  add(key, name, 'laundry', group, unit, levels.map((level, i) => [level, prices[i]]));
}
function house(key, name, price) {
  add(key, name, 'housekeeping', '家政套餐', '间', [['整间套餐', price]], '按整间收费，请预约上门时间');
}
house('clean2', '2小时深度保洁（不擦窗）', 119);
house('clean3', '3小时深度保洁（不擦窗）', 149);
house('full2', '2小时大扫除（含双面擦窗）', 149);
house('full3', '3小时大扫除（含双面擦窗）', 179);

for (const [key, name] of [
  ['shirt', '衬衫'], ['trousers', '西裤'], ['tshirt', 'T恤衫'],
  ['skirt', '短裙'], ['casual_trousers', '休闲裤']
]) wash(key, name, '衣物', '件', [20, 40, 60]);
for (const [key, name] of [
  ['silk_shirt', '真丝衬衣'], ['silk_trousers', '真丝裤'], ['silk_skirt', '真丝短裙'],
  ['wool_shirt', '羊毛衬衣'], ['wool_trousers', '羊毛裤'], ['wool_skirt', '羊毛短裙']
]) wash(key, name, '衣物', '件', [35, 70, 105]);
for (const [key, name] of [
  ['suit_jacket', '西装上衣'], ['jacket', '夹克'], ['sweater', '毛衣'], ['short_wool_sweater', '短款羊毛衫']
]) wash(key, name, '衣物', '件', [30, 60, 90]);
for (const [key, name] of [['tie', '领带'], ['scarf', '围巾']]) wash(key, name, '衣物', '件', [30, 60, 90]);
for (const [key, name] of [['cashmere_sweater', '羊绒衫'], ['shawl', '披肩']]) wash(key, name, '衣物', '件', [40, 80, 120]);
wash('dress', '普通连衣裙', '衣物', '件', [40, 80, 120]);
wash('silk_dress', '真丝连衣裙', '衣物', '件', [70, 140, 210]);
for (const [size, suffix, prices] of [
  ['短款', 'short', [40, 80, 120]], ['中款', 'mid', [50, 100, 150]], ['长款', 'long', [55, 110, 165]]
]) {
  for (const [key, name] of [
    ['down', '羽绒服'], ['coat', '大衣'], ['cotton_coat', '棉衣'], ['trench_coat', '风衣']
  ]) wash(`${key}_${suffix}`, `${size}${name}`, '衣物', '件', prices);
}
wash('short_shearling_coat', '短款羊羔毛外套', '衣物', '件', [80, 160, 240]);

for (const [key, name] of [['mesh', '网面运动鞋'], ['cloth', '布面运动鞋']]) wash(key, name, '鞋类', '双', [25, 55, 85]);
wash('leather_shoe', '皮面运动鞋', '鞋类', '双', [32, 70, 100]);
wash('suede_shoe', '绒面运动鞋', '鞋类', '双', [32, 70, 100]);
for (const [key, name, prices] of [
  ['shoe', '短款皮鞋', [60, 120, 180]], ['mid_shoe', '中款皮鞋', [70, 140, 210]], ['high_shoe', '高款皮鞋', [80, 160, 240]],
  ['boot', '低筒雪地靴', [50, 100, 150]], ['mid_boot', '中筒雪地靴', [60, 120, 180]], ['high_boot', '高筒雪地靴', [70, 140, 210]]
]) wash(key, name, '鞋类', '双', prices);

for (const [key, name, unit, price] of [
  ['curtain', '普通窗帘', '㎡', 10], ['double_curtain', '双层窗帘', '㎡', 15],
  ['acrylic_carpet', '腈纶地毯', '㎡', 60], ['polyester_carpet', '涤纶地毯', '㎡', 60],
  ['wool_carpet', '羊毛地毯', '㎡', 120], ['blanket', '毛毯', '件', 120],
  ['acrylic_quilt', '腈纶被', '件', 120], ['quilt', '羽绒被', '件', 120],
  ['silk_quilt', '蚕丝被', '件', 160],
  ['set3', '普通三件套（枕套×1）', '套', 29], ['set4', '普通四件套（枕套×2）', '套', 32],
  ['silk_set3', '真丝三件套（枕套×1）', '套', 69], ['silk_set4', '真丝四件套（枕套×2）', '套', 89]
]) add(key, name, 'laundry', '床品家纺', unit, [['标准', price]]);

for (const [key, name, labels, prices] of [
  ['bag', '奢品包包', ['小', '中', '大'], [399, 499, 599]],
  ['leather', '黑色皮衣', ['短', '中', '长'], [260, 280, 320]],
  ['fur', '皮草大衣', ['短', '中', '长'], [350, 400, 450]],
  ['shearling', '皮毛一体', ['短', '中', '长'], [450, 600, 800]]
]) add(key, name, 'laundry', '包包皮革', '件', labels.map((label, i) => [label, prices[i]]));

for (const item of items) {
  if (/^(普通|真丝)(三|四)件套/.test(item.name)) {
    item.description = item.name.includes('三件套') ? '床单、被罩、枕套×1；按套计价' : '床单、被罩、枕套×2；按套计价';
  }
}

// This service has a minimum and a relative price only. The store must confirm
// the corresponding garment price before the order receives a final quote.
add('ironing', '单熨烫', 'laundry', '衣物', '件', [], '对应洗护价格六折，15元起；由门店确认报价');

items.forEach((item, index) => { item.sortOrder = index; });
module.exports = items;
