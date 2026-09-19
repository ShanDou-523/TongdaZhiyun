// Read-only local checks. This script neither contacts nor deploys to CloudBase.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function inspect(root, target) {
  const report = { target, errors: [], warnings: [], pending: [] };
  if (!['development', 'production'].includes(target)) {
    report.errors.push('目标必须明确指定为 development 或 production');
    return report;
  }
  const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  let targets, project, local, config;
  try {
    targets = readJson('config/deployment-targets.json');
    project = readJson('project.config.json');
    const privatePath = path.join(root, 'project.private.config.json');
    local = fs.existsSync(privatePath) ? readJson('project.private.config.json') : {};
    const context = { module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/config.js'), 'utf8'), context, { timeout: 1000 });
    config = context.module.exports;
  } catch (e) {
    report.errors.push('无法读取本地环境配置：' + e.message);
    return report;
  }
  const expected = targets[target];
  if (!expected || !/^wx[0-9a-f]{16}$/.test(expected.appid || '') || typeof expected.cloudEnv !== 'string' || !expected.cloudEnv.trim()) {
    report.errors.push('目标 AppID 或云环境尚未填写完整，不能执行该环境的切换或部署');
  } else {
    if (config.cloudEnv !== expected.cloudEnv) report.errors.push('前端 cloudEnv 与所选目标不一致');
    // Do not guess which AppID the IDE actually uses when the two files disagree.
    if (project.appid !== expected.appid) {
      report[target === 'production' ? 'errors' : 'warnings'].push('共享 project.config.json 的 AppID 与目标不同，需要核对开发者工具实际身份');
    }
    if (local.appid && local.appid !== expected.appid) {
      report.errors.push('本机 project.private.config.json 的 AppID 与目标不同');
    }
  }
  if (target === 'production') {
    const dev = targets.development;
    if (expected && dev && (expected.appid && expected.appid === dev.appid || expected.cloudEnv && expected.cloudEnv === dev.cloudEnv)) {
      report.errors.push('公司正式目标不能复用当前个人开发 AppID 或环境');
    }
    for (const flag of ['demoEnabled', 'mock', 'devLogin']) {
      if (Object.prototype.hasOwnProperty.call(config, flag) && config[flag] !== false) {
        report.errors.push('正式配置必须将 ' + flag + ' 明确设为 false');
      }
    }
    for (const field of ['privacyOperator', 'privacyContact']) {
      if (typeof config[field] !== 'string' || !config[field].trim()) report.errors.push('正式配置缺少 ' + field);
    }
    if (fs.existsSync(path.join(root, 'miniprogram/demo')) || fs.existsSync(path.join(root, 'miniprogram/mock'))) {
      report.warnings.push('源码含本地演示实现；正式构建还需验证测试入口和打包边界');
    }
  } else if (config.demoEnabled === true || config.mock === true) {
    report.warnings.push('本地演示已开启，演示通过不等于个人云环境联调通过');
  }
  report.pending.push('开发者工具运行时实际 AppID、云环境归属与关联、数据库权限和索引尚未核验');
  report.pending.push('云端已部署版本及 DEV_LOGIN 等真实环境变量尚未核验；前端检查不能代替服务端检查');
  if (target === 'production') report.pending.push('公司主体认证、平台能力、商户绑定、真实注册/支付/退款、备份与回退仍需验收');
  return report;
}

if (require.main === module) {
  const report = inspect(path.resolve(__dirname, '..'), process.argv[2]);
  console.log('只读本地环境检查：' + (report.target || '未指定目标'));
  for (const [key, label] of [['errors', '阻断'], ['warnings', '注意'], ['pending', '待核验']]) {
    for (const message of report[key]) console.log(label + '：' + message);
  }
  console.log(report.errors.length ? '本地配置检查未通过。没有修改或部署任何资源。' : '本地配置检查完成；云端状态未验证，这不是发布许可。');
  process.exitCode = report.errors.length ? 1 : 0;
}
module.exports = { inspect };
