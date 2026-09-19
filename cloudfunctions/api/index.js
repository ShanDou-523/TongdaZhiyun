const cloud = require('wx-server-sdk');
const { createService } = require('./service');
const { BusinessError } = require('./domain');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
function repository(source) {
  return {
    async get(collection, id) {
      try { const result = await source.collection(collection).doc(id).get(); return result.data || null; }
      catch (error) { if (/document.*(not exist|not found)|DOCUMENT_NOT_EXIST/i.test(error.errMsg || error.message || '')) return null; throw error; }
    },
    async put(collection, id, data) { const clean = { ...data }; delete clean._id; await source.collection(collection).doc(id).set({ data: clean }); },
    async list(collection, filter, options = {}) {
      const where = { ...filter };
      if (options.before !== undefined) where[options.order] = db.command.lt(options.before);
      let query = source.collection(collection).where(where).orderBy(options.order || 'createdAt', options.direction || 'desc');
      if (options.skip) query = query.skip(options.skip);
      return (await query.limit(options.limit || 20).get()).data;
    },
    transaction(fn) { return db.runTransaction(tx => fn(repository(tx))); }
  };
}
const service = createService({
  repo: repository(db),
  bootstrapOpenid: process.env.BOOTSTRAP_ADMIN_OPENID || '',
  async phoneExchange(code) { return (await cloud.openapi.phonenumber.getPhoneNumber({ code })).phoneInfo; },
  async qrCode(storeId, version) {
    const result = await cloud.openapi.wxacode.getUnlimited({ scene: `s=${storeId}`, page: 'pages/auth/index', envVersion: version, checkPath: version === 'release', width: 430 });
    if (!result.buffer || (result.errCode && result.errCode !== 0)) throw new BusinessError('QRCODE', '生成失败，请检查小程序版本、发布状态和云调用权限');
    const upload = await cloud.uploadFile({ cloudPath: `entry-codes/${storeId}-${version}-${Date.now()}.png`, fileContent: result.buffer });
    return upload.fileID;
  }
});
exports.main = async event => {
  try { return { ok: true, data: await service(event, { openid: cloud.getWXContext().OPENID }) }; }
  catch (error) {
    if (error instanceof BusinessError) return { ok: false, code: error.code, message: error.message };
    // Only log a code, never request bodies, phone numbers or session tokens.
    console.error('api failure', String(error.errCode || error.code || 'INTERNAL'));
    return { ok: false, code: 'INTERNAL', message: '服务暂不可用，请稍后重试；管理员请检查云函数、数据库集合和索引配置' };
  }
};
