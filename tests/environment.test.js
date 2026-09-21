const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspect } = require('../scripts/check-environment');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuanlin-env-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('yuanlin-env-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  function put(file, value) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  }
  const targets = {
    development: { appid: 'wx1111111111111111', cloudEnv: 'test-env' },
    production: { appid: 'wx2222222222222222', cloudEnv: 'company-env' }
  };
  const config = { cloudEnv: 'company-env', demoEnabled: false, privacyOperator: '示例主体', privacyContact: '测试联系渠道' };
  put('config/deployment-targets.json', targets);
  put('project.config.json', { appid: targets.production.appid });
  const save = () => put('miniprogram/config.js', 'module.exports = ' + JSON.stringify(config));
  save();
  return { root, put, config, targets, save };
}

test('environment checker requires an explicit known target', t => {
  const f = fixture(t);
  assert(inspect(f.root).errors.length);
  assert(inspect(f.root, 'prod').errors.length);
});
test('production remains blocked until actual company identifiers are supplied', t => {
  const f = fixture(t);
  f.targets.production = { appid: '', cloudEnv: '' };
  f.put('config/deployment-targets.json', f.targets);
  assert(inspect(f.root, 'production').errors.some(x => x.includes('尚未填写')));
});
test('production rejects development flags, missing privacy data and wrong cloud environment', t => {
  const f = fixture(t);
  Object.assign(f.config, { demoEnabled: true, mock: true, devLogin: true, privacyContact: '', cloudEnv: 'test-env' });
  f.save();
  const r = inspect(f.root, 'production');
  for (const key of ['demoEnabled', 'mock', 'devLogin', 'privacyContact', 'cloudEnv']) assert(r.errors.some(x => x.includes(key)));
});
test('production refuses an inconsistent private AppID even if shared configuration is correct', t => {
  const f = fixture(t);
  f.put('project.private.config.json', { appid: f.targets.development.appid });
  assert(inspect(f.root, 'production').errors.some(x => x.includes('project.private')));
});
test('production cannot silently reuse personal identifiers', t => {
  const f = fixture(t);
  f.targets.production = f.targets.development;
  f.put('config/deployment-targets.json', f.targets);
  assert(inspect(f.root, 'production').errors.some(x => x.includes('不能复用')));
});
test('matching local production settings stay read-only and report pending cloud verification', t => {
  const f = fixture(t);
  const file = path.join(f.root, 'miniprogram/config.js'), before = fs.readFileSync(file, 'utf8');
  const r = inspect(f.root, 'production');
  assert.equal(r.errors.length, 0);
  assert(r.pending.some(x => x.includes('DEV_LOGIN')));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
