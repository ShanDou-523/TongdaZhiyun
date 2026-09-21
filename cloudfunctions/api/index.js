const cloud = require('wx-server-sdk');
const { createService } = require('./service');
const { BusinessError, resolveOpenid, escapeRegExp } = require('./domain');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
function repository(source) {
  return {
    async get(collection, id) {
      try { const result = await source.collection(collection).doc(id).get(); return result.data || null; }
      catch (error) { if (/document.*(not exist|not found)|DOCUMENT_NOT_EXIST/i.test(error.errMsg || error.message || '')) return null; throw error; }
    },
    async put(collection, id, data) { const clean = { ...data }; delete clean._id; await source.collection(collection).doc(id).set({ data: clean }); },
    async remove(collection, id) { await source.collection(collection).doc(id).remove(); },
    async list(collection, filter, options = {}) {
      let where = { ...filter };
      if (options.before !== undefined) where[options.order] = db.command.lt(options.before);
      // 关键词搜索：在指定字段上做不区分大小写的模糊匹配，与原有等值条件取交集。
      // 用户输入的正则元字符要先转义，否则一个 "." 就能匹配全部记录。
      if (options.search && options.search.keyword) {
        const rx = db.RegExp({ regexp: escapeRegExp(options.search.keyword), options: 'i' });
        where = db.command.and([where, db.command.or(options.search.fields.map(field => ({ [field]: rx })))]);
      }
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
  // 开发期登录开关：仅在云函数环境变量 DEV_LOGIN=1 时开启。
  // 联调环境（个人主体）设它打通注册登录；公司生产环境绝不设置此变量。
  devLogin: process.env.DEV_LOGIN === '1',
  async phoneExchange(code) { return (await cloud.openapi.phonenumber.getPhoneNumber({ code })).phoneInfo; },
  // 跑腿资质审核通过后要删掉证件照原件（留存最小化），这里注入云存储删除能力。
  async storageDelete(fileID) { await cloud.deleteFile({ fileList: [fileID] }); },
  // 内容安全检测（UGC 强制要求）。返回 suggest：pass 放行，review/risky 由 service 层拦截。
  // 检测失败或缺少有效结论时不提交内容，保留用户输入供稍后重试。
  async msgCheck(content, scene, openid) {
    try {
      const result = await cloud.openapi.security.msgSecCheck({ content, version: 2, scene, openid });
      const verdict = result.result && result.result.suggest;
      if (!['pass','review','risky'].includes(verdict)) throw new Error('INVALID_VERDICT');
      return verdict;
    } catch (error) {
      console.warn('msgSecCheck unavailable:', String(error.errCode || error.code || 'UNKNOWN'));
      throw new BusinessError('CONTENT_UNAVAILABLE', '内容检测暂不可用，请稍后重试；管理员请检查云调用权限与额度');
    }
  },
  async qrCode(storeId, version) {
    const result = await cloud.openapi.wxacode.getUnlimited({ scene: `s=${storeId}`, page: 'pages/auth/index', envVersion: version, checkPath: version === 'release', width: 430 });
    if (!result.buffer || (result.errCode && result.errCode !== 0)) throw new BusinessError('QRCODE', '生成失败，请检查小程序版本、发布状态和云调用权限');
    const upload = await cloud.uploadFile({ cloudPath: `entry-codes/${storeId}-${version}-${Date.now()}.png`, fileContent: result.buffer });
    return upload.fileID;
  }
});
exports.main = async event => {
  try {
    const devLogin = process.env.DEV_LOGIN === '1';
    const wxOpenid = cloud.getWXContext().OPENID;
    // 开发期身份切换：devLogin 开启时，前端可用 devActor（11 位手机号）指定这次调用扮演谁，
    // 同一个微信号据此分饰客户 / 门店 / 管理员，做多端联调。生产环境不设 DEV_LOGIN，
    // resolveOpenid 恒返回真实 openid，此能力不存在。
    const openid = resolveOpenid(wxOpenid, event && event.devActor, devLogin);
    // 把调用者真实 openid 打进日志，方便配置 BOOTSTRAP_ADMIN_OPENID。
    if (devLogin) console.log('dev caller openid:', wxOpenid, '| actor:', openid);
    return { ok: true, data: await service(event, { openid }) };
  }
  catch (error) {
    if (error instanceof BusinessError) return { ok: false, code: error.code, message: error.message };
    // Only log a code, never request bodies, phone numbers or session tokens.
    console.error('api failure', String(error.errCode || error.code || 'INTERNAL'));
    return { ok: false, code: 'INTERNAL', message: '服务暂不可用，请稍后重试；管理员请检查云函数、数据库集合和索引配置' };
  }
};
