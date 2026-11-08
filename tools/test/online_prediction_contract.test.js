// node tools/test/online_prediction_contract.test.js [--before-v9-fixture=/path/to/old/check.js]
// 旧版の再現例: git show e8b0140:tools/test/online_prediction_check.js > /tmp/old-prediction-check.js
// node tools/test/online_prediction_contract.test.js --before-v9-fixture=/tmp/old-prediction-check.js
// 通常回帰は現sourceだけを使い、過去commitやネットワークを必要としない。
// browser版と同じfunctional/evaluateを製品game.js/physics/codecへ接続する平地VM回帰。
// WebGL、RTC、実マップ・装備描画の再構築、入力→表示遅延は検証しない。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),filename=path.join(__dirname,'online_prediction_check.js');
const before=process.argv.find(v=>v.startsWith('--before-v9-fixture='));
const source=fs.readFileSync(before?before.slice('--before-v9-fixture='.length):filename,'utf8');
const rawGameSource=fs.readFileSync(path.join(root,'prototype/online/game.js'),'utf8');
let gameSource=rawGameSource;
const localRequire=createRequire(filename);
const context={console,process:{argv:[]},require:name=>{
  if(name==='./lib')return {check:()=>{}};
  if(name==='./online_test_helpers')return {ROOT:root};
  if(name==='node:fs')return {...fs,readFileSync:()=>gameSource,writeFileSync:(_p,value)=>{gameSource=value;}};
  return localRequire(name);
}};
vm.createContext(context);vm.runInContext(source+'\nthis.contract={instrument,functional};',context,{filename});
context.contract.instrument('/fixture');
// 既存physics harnessの内部hookを残し、browser用hookも同じ製品closureへ足す。
gameSource=gameSource.replace('window.__predictionTest=','window.__predictionContractTest=');
const physicsFile=path.join(__dirname,'online_physics_sync_fixture.js'),physicsRequire=createRequire(physicsFile);
const physicsContext={module:{exports:{}},__dirname,require:name=>name==='node:fs'?{...fs,readFileSync:(p,...args)=>
  String(p)===path.join(root,'prototype/online/game.js')?gameSource:fs.readFileSync(p,...args)}:physicsRequire(name),
  structuredClone,TextEncoder,TextDecoder,Buffer,console,setTimeout,clearTimeout};
vm.createContext(physicsContext);vm.runInContext(fs.readFileSync(physicsFile,'utf8'),physicsContext,{filename:physicsFile});
const suite=physicsContext.module.exports.createPhysicsSuite(),api=suite.load('assault');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const sourceHashes=Object.fromEntries(Object.keys(suite.sourceHashes).map(p=>[p,sha256(fs.readFileSync(path.join(root,p)))]));
sourceHashes['prototype/online/game.js']=sha256(rawGameSource);
sourceHashes['tools/test/online_prediction_check.js']=sha256(fs.readFileSync(filename));
for(const [p,hash]of Object.entries(sourceHashes))assert.equal(hash,sha256(fs.readFileSync(path.join(root,p))),'記録した製品/fixture hashと実ファイル: '+p);
const instrumentedGameHash=sha256(gameSource); // VM用hookを足したsourceは製品hashとは別記する。
function page(role){
  const h=api.harness(),c=h.c,t=c.window.__predictionContractTest;
  Object.assign(c,{CBOnlineGame:h.game,__predictionTest:t,__g:c,structuredClone,terrainH:()=>0,releaseLock:()=>{},mainMuzzleFlash:()=>{},
    renderer:{render:()=>{}},PARTS:requireParts(),equip:(u)=>{
      // 境界の検出/状態復元を検査。WebGL機体再構築とmechStatsそのものはbrowser版が担当。
      u.lockRange=c.PARTS.head[u.mech.head].lock;
    }});
  h.game.state.role=role;
  for(const [i,u]of h.units.entries()){u.team=i?'R':'B';u.group.position=u.pos.clone();}
  if(role==='host'){
    Object.assign(c.player,{controller:'remoteHuman',ownerPeerId:'g',onlineFixedMovement:true});
    h.game.state.peers.set('g',{id:'g',unitId:c.player.entityId,fixedCommands:true,input:null});
  }
  // 実ゲームのrenderView全体は不要。製品game.jsのcamera offset wrapperを再利用する。
  const wrappedRender=c.renderView;
  c.renderView=()=>{wrappedRender();const saved=c.camera.position.clone();c.camera.position.copy(h.renderedCamera());
    try{c.renderer.render();}finally{c.camera.position.copy(saved);}};
  return {h,evaluate:async fn=>vm.runInContext('('+fn.toString()+')()',c,{filename:filename+':evaluate'})};
}
function requireParts(){
  const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'prototype/parts.js'),'utf8')+'\nthis.parts=partTables().PARTS;',c);return c.parts;
}
(async()=>{
  const host=page('host'),guest=page('guest'),h=guest.h;
  const snapshot=h.game.snapshot();snapshot.frame=1;snapshot.time=0;
  snapshot.roster=snapshot.units.map(u=>({id:u.id,name:u.name,team:u.team,cls:u.cls,sc:u.sc}));
  // 公開標的R:0を残し、秘匿slotの不変検査も空集合で成功しないようR:1を足す。
  const hidden={...snapshot.units[1],id:'R:1'};
  snapshot.roster.push({id:hidden.id,name:hidden.name,team:hidden.team,cls:hidden.cls,sc:hidden.sc});
  snapshot.units=snapshot.units.map(u=>h.test.fixedUnitForPeer(u,false,1));snapshot.units.push(h.test.fixedUnitForPeer(hidden,true,1));
  snapshot.unitUpdates=(1<<snapshot.units.length)-1;snapshot.gadgets=[];
  // browserのtemplateもwire復号済み。秘匿slotを含め値とキー順を同じ入口へ通す。
  const encoder=new h.c.CBOnlineCodec.Encoder(),decoder=new h.c.CBOnlineCodec.Decoder(),wire=encoder.encode(snapshot);
  assert(decoder.seed(wire.baseline));h.game.state.lastSnapshot=decoder.decode(wire.delta);
  const hiddenSlots=h.game.state.lastSnapshot.units.filter(u=>u.hidden).length;assert(hiddenSlots>0);
  let count=0;const report={};
  try{
    await context.contract.functional({host,guests:[guest]},(value,name)=>{assert(value,name);count++;console.log('固定予測契約VM: '+name);},report);
    assert(!before,'旧fixtureが失敗しなくなった場合は再現条件を見直す');
  }catch(error){
    if(!before)throw error;
    assert.match(error.message,/Cannot convert undefined or null to object/);
    assert.equal(report.functional.hostSteps.accepted,null);
    assert.equal(report.functional.hostSteps.seq,0);
    console.log('旧browser fixture再現: command印なしの入力が拒否されaccepted=null。Object.hasOwnで'+error.message);return;
  }
  console.log(JSON.stringify({scope:'平地VM・browserと同じfunctional fixture。実browser/RTC/描画遅延は未実行',adapters:['地形・施設・射撃は既存physics fixtureの代役','equipは変更検出とlockRange復元のみ','camera/aimは代役、offset wrapperは製品関数'],sourceHashes,instrumentedGameHash,checks:count,hiddenSlots,sourceChecks:report.functional.details.sourceChecks,hostSteps:report.functional.hostSteps.rows.map(row=>({dt:row.dt,ack:row.ack})),pacing:report.functional.details.pacing.prediction.predictedSteps}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
