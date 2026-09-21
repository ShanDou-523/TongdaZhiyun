const api = require('../../../utils/api');
const config = require('../../../config');
Page({
 data: { runner: null, realName: '', schoolId: '', idCard: '', studentCard: '', demoMode: false, devLogin: false, loading: true, busy: false, error: '' },
 onShow() { this.load(); },
 async load() {
  try { const me = await api.guard(['customer']); if (!me) return; this.setData({ runner: me.user.runner || null, demoMode:!!me.demoMode, devLogin:this.canSkipPhotos(!!me.demoMode) }); }
  catch (e) { this.setData({ error: e.message }); }
  finally { this.setData({ loading: false }); }
 },
 input(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }); },
 // 证件照先传云存储再提交；审核通过后服务端会把原件删掉，只留核验标记。
 async pick(e) {
  if (this.data.busy || this.data.loading) return;
  const key = e.currentTarget.dataset.key;
  if (!wx.chooseMedia) { this.setData({ error: '当前工具版本不支持选择照片' }); return; }
  wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'], sizeType: ['compressed'],
   success: async r => {
    const file = ((r.tempFiles || [])[0] || {}).tempFilePath;
    if (!file) return;
    this.setData({ busy: true, error: '' });
    try {
     let value = file;
     if (!this.data.demoMode) {
      const ext = (file.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0];
      const up = await wx.cloud.uploadFile({ cloudPath: `runner/${key}-${Date.now()}${ext}`, filePath: file });
      value = up.fileID;
     }
     this.setData({ [key]: value });
    } catch (err) { this.setData({ error: '照片上传失败：' + (err.errMsg || err.message || '未知原因') }); }
    finally { this.setData({ busy: false }); }
   },
   fail: err => { const msg = (err && err.errMsg) || '未知原因'; if (msg.indexOf('cancel') > -1) return; this.setData({ error: '选择照片失败：' + msg }); } });
 },
 async submit() {
  if (this.data.busy) return;
  const s = this.data;
  if (!s.realName.trim()) { this.setData({ error: '请填写真实姓名' }); return; }
  if (!s.schoolId.trim()) { this.setData({ error: '请填写学号' }); return; }
  if (!s.idCard || !s.studentCard) { this.setData({ error: '请上传身份证和学生证照片' }); return; }
  this.setData({ busy: true, error: '' });
  try {
   const r = await api.call('runner.apply', { realName: s.realName.trim(), schoolId: s.schoolId.trim(), idCardPhoto: s.idCard, studentCardPhoto: s.studentCard });
   this.setData({ runner: r.user.runner });
   wx.showToast({ title: '已提交' });
  } catch (e) { this.setData({ error: e.message }); }
  finally { this.setData({ busy: false }); }
 },
 hall() { wx.navigateTo({ url: '/pages/runner/hall/index' }); },
 // 开发期旁路：隐私声明没配好之前选不了照片，用占位符把流程跑通；上线前关掉 devLogin 即失效。
 canSkipPhotos(demoMode) {
  if (demoMode) return true;
  try { return config.devLogin === true && ['develop','trial'].includes(wx.getAccountInfoSync().miniProgram.envVersion); } catch (_) { return false; }
 },
 skipPhotos() { if (this.data.busy || this.data.loading || !this.canSkipPhotos(this.data.demoMode)) return; this.setData({ idCard: 'dev:idCard', studentCard: 'dev:studentCard', error: '' }); }
});
