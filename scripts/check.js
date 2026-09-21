const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
let files = 0;
function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes:true})) { if (['node_modules','.git'].includes(entry.name)) continue; const f=path.join(dir,entry.name); if(entry.isDirectory())walk(f);else{ files++; if(f.endsWith('.json'))JSON.parse(fs.readFileSync(f,'utf8'));if(f.endsWith('.js')){const result=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);} } } }
require('./sync-demo')(true);
walk(root);
const app=JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json'),'utf8'));
for(const page of app.pages)for(const ext of ['js','json','wxml','wxss'])if(!fs.existsSync(path.join(root,'miniprogram',page+'.'+ext)))throw new Error('Missing '+page+'.'+ext);
for(const tab of app.tabBar.list)if(!app.pages.includes(tab.pagePath))throw new Error('Invalid tab '+tab.pagePath);
for(const page of app.pages){const html=fs.readFileSync(path.join(root,'miniprogram',page+'.wxml'),'utf8');if(/<(br|div|span|script)(\s|\/|>)/.test(html))throw new Error('Browser tag in WXML: '+page);}
console.log(`PASS: ${files} files; JSON, JavaScript syntax, ${app.pages.length} page bundles and tab routes.`);
