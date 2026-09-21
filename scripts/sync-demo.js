const fs = require('fs');
const path = require('path');
const header = '// Generated from cloudfunctions/api by scripts/sync-demo.js. Do not edit.\n// Local demo only; production authentication remains in the cloud function.\n';
function sync(check = false) {
  const root = path.resolve(__dirname, '..');
  for (const name of ['service.js', 'domain.js']) {
    const source = fs.readFileSync(path.join(root, 'cloudfunctions/api', name), 'utf8').replace(/\r\n/g, '\n');
    const expected = header + source.replace("require('crypto')", "require('./crypto')");
    const target = path.join(root, 'miniprogram/demo', name);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== expected) {
        throw new Error('Demo business rules are stale: run npm run demo:sync');
      }
    } else {
      fs.mkdirSync(path.dirname(target), {recursive:true});
      fs.writeFileSync(target, expected);
    }
  }
}
if (require.main === module) { sync(process.argv.includes('--check')); console.log('Demo business rules synchronized.'); }
module.exports = sync;
