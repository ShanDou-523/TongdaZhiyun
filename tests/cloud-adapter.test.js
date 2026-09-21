const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const vm=require('vm');
const path=require('path');
function adapter(msgSecCheck){
 let options;
 const cloud={DYNAMIC_CURRENT_ENV:'test',init(){},database:()=>({}),openapi:{security:{msgSecCheck}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cloudfunctions/api/index.js'),'utf8'),{
  require:name=>name==='wx-server-sdk'?cloud:name==='./service'?{createService:o=>{options=o;return ()=>{};}}:require('../cloudfunctions/api/domain'),
  exports:{},process:{env:{}},console:{warn(){},log(){},error(){}}
 });return options;
}
test('actual cloud content adapter rejects API failures and missing verdicts',async()=>{
 for(const fn of [async()=>{throw Error('offline');},async()=>({}),async()=>({result:{suggest:'unknown'}})]){
  await assert.rejects(adapter(fn).msgCheck('hello',2,'openid'),e=>e.code==='CONTENT_UNAVAILABLE');
 }
});
test('actual cloud content adapter preserves pass, review and risky verdicts',async()=>{
 for(const verdict of ['pass','review','risky']){
  let args;const a=adapter(async input=>{args=input;return {result:{suggest:verdict}};});
  assert.equal(await a.msgCheck('hello',2,'openid'),verdict);assert.equal(args.openid,'openid');assert.equal(args.version,2);
 }
});
