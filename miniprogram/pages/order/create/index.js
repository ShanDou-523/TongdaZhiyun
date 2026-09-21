const api = require('../../../utils/api');
const config = require('../../../config');
const { parks } = require('../../../utils/constants');
Page({
 data: { services: [], serviceIndex: 0, items: '', note: '', parks, parkIndex: 0, parkDetail: '', contact: '', media: [], delivery: 'self', runnerFee: 0, loading: true, busy: false, error: '' },
 onLoad(options) { this.preset = (options && options.serviceId) || ''; this.load(); },
 async load() {
  this.setData({ loading: true, error: '' });
  try {
   const me = await api.guard(['customer']); if (!me) return;
   const list = await api.call('services.list');
   const conf = await api.call('order.config');
   const i = list.items.findIndex(x => x._id === this.preset);
   this.setData({
    services: list.items, serviceIndex: i < 0 ? 0 : i,
    contact: me.user.phone,
    parkIndex: Math.max(0, parks.indexOf(me.user.park)),
    parkDetail: me.user.parkDetail || '',
    runnerFee: conf.runnerFee
   });
  } catch (e) { this.setData({ error: e.message }); }
  finally { this.setData({ loading: false }); }
 },
 select(e) { this.setData({ [e.currentTarget.dataset.key]: Number(e.detail.value) }); },
 input(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }); },
 delivery(e) { this.setData({ delivery: e.currentTarget.dataset.value }); },
 // 照片是可选项：工具或隐私声明没配好时不该挡住下单，失败原因要如实显示而不是静默。
 async addPhoto() {
  if (this.data.busy) return;
  if (this.data.media.length >= 3) { this.setData({ error: '最多上传 3 张照片' }); return; }
  if (!wx.chooseMedia) { this.setData({ error: '当前工具版本不支持选择照片，可以先跳过照片直接下单' }); return; }
  wx.chooseMedia({ count: 3 - this.data.media.length, mediaType: ['image'], sourceType: ['album'], sizeType: ['compressed'],
   success: async r => {
    const files = (r.tempFiles || []).map(f => f.tempFilePath).filter(Boolean);
    if (!files.length) return;
    this.setData({ busy: true, error: '' });
    try {
     const added = [];
     for (const file of files) {
      if (config.mock) { added.push(file); continue; }
      const ext = (file.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0];
      const up = await wx.cloud.uploadFile({ cloudPath: `orders/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`, filePath: file });
      added.push(up.fileID);
     }
     this.setData({ media: this.data.media.concat(added) });
    } catch (e) { this.setData({ error: '照片上传失败：' + (e.errMsg || e.message || '未知原因') }); }
    finally { this.setData({ busy: false }); }
   },
   fail: err => { const msg = (err && err.errMsg) || '未知原因'; if (msg.indexOf('cancel') > -1) return; this.setData({ error: '选择照片失败：' + msg }); } });
 },
 removePhoto(e) { const i = Number(e.currentTarget.dataset.index); this.setData({ media: this.data.media.filter((_, n) => n !== i) }); },
 async submit() {
  if (this.data.busy) return;
  const s = this.data, service = s.services[s.serviceIndex];
  if (!service) { this.setData({ error: '请选择服务' }); return; }
  if (!s.items.trim()) { this.setData({ error: '请填写要处理的物品' }); return; }
  if (!s.parkDetail.trim()) { this.setData({ error: '请填写详细取件地址（楼栋、房间号）' }); return; }
  if (!/^1\d{10}$/.test(s.contact.trim())) { this.setData({ error: '请填写 11 位联系电话' }); return; }
  this.setData({ busy: true, error: '' });
  try {
   await api.call('order.create', { serviceId: service._id, items: s.items.trim(), note: s.note.trim(), park: parks[s.parkIndex], parkDetail: s.parkDetail.trim(), contact: s.contact.trim(), media: s.media, delivery: s.delivery });
   wx.showToast({ title: '已下单' });
   setTimeout(() => wx.redirectTo({ url: '/pages/order/mine/index' }), 600);
  } catch (e) { this.setData({ error: e.message }); }
  finally { this.setData({ busy: false }); }
 }
});
