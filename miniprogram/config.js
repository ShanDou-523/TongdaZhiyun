// 本地演示开关：mock = true 时，所有接口走 miniprogram/mock/ 里的假数据，
// 不需要 AppID、不需要云环境、不需要手机号能力 —— 打开开发者工具就能把整个小程序点通。
// 用途：在等公司账号 / 认证 / 备案期间，仍然可以开发页面、调交互、写业务逻辑。
// ⚠️ 联调真实云函数或提交审核前，必须改回 false。
// 建议做法：cloudEnv 填好真实环境 ID 的同一次改动里，把这里改成 false。
//
// 开发期登录开关：devLogin = true 时，登录页出现「开发登录」入口，
// 用测试手机号直接注册/登录，跳过微信「获取手机号」能力（个人主体没有该能力）。
// 前提：云函数 api 的环境变量已设 DEV_LOGIN=1，否则服务端会拒绝（安全判断在服务端，前端开关只控制入口显示）。
// ⚠️ 提交审核 / 上线前必须改回 false，且公司生产环境绝不设置 DEV_LOGIN 环境变量。
// mock 与 devLogin 不要同时开；mock 优先。
module.exports = { cloudEnv: 'cloudbase-d9g2aibtdf3e4d6bc', brand: '园邻', privacyOperator: '', privacyContact: '', mock: false, devLogin: true };
