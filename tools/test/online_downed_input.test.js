// 製品のF送信・受信・downTick・ACKを接続。移動/描画/RTCは既存VM代役。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const path=require('node:path');
const filename=path.join(__dirname,'online_prediction.test.js');
const original=fs.readFileSync(filename,'utf8');
let source=original.slice(0,original.indexOf('\n{\n  const h=harness();reconcile'));
const html=fs.readFileSync(path.join(__dirname,'../../prototype/index.html'),'utf8');
const downTick=html.slice(html.indexOf('function downTick('),html.indexOf('// 起こせる機体：'));
source=source.replace('  vm.createContext(c);',`  c.isHumanControlled=u=>u.controller==='remoteHuman'||u.controller==='localHuman';
  c.isLocalView=u=>u.controller==='localHuman';c.pressed={};c.reviverNear=()=>true;
  c.wreck=u=>{u.downT=0;u.respawnT=5;u.wrecks=(u.wrecks||0)+1;};
  vm.createContext(c);vm.runInContext(${JSON.stringify(downTick)},c);`);
source=source.replace('getPrediction:()=>prediction,','stepLocalCommands,getPrediction:()=>prediction,');
const ctx={require:createRequire(filename),console,setTimeout,clearTimeout};vm.createContext(ctx);
vm.runInContext(source+'\nthis.api={harness,input};',ctx);
const {harness,input}=ctx.api;
function host(){
  const h=harness();h.game.state.role='host';
  const u=h.units[1],p={id:'g',unitId:u.entityId,receivedSeq:0,last:0,fixedCommands:true};
  Object.assign(u,{controller:'remoteHuman',ownerPeerId:p.id,alive:false,downT:10});h.game.state.peers.set(p.id,p);
  const action=(n,extra={})=>({...input(n,{KeyF:true}),actionSeq:n,...extra});
  const tick=()=>{u.controlInput=h.game.remoteInput(u);h.c.downTick(u,1/60);};
  return {h,u,p,action,tick};
}
for(const batchFirst of [false,true]){
  const {h,u,p,action,tick}=host();
  if(batchFirst)h.test.acceptInputBatch(p,{inputs:[{...input(1),command:true}]});
  h.test.acceptInputActions(p,action(1));
  assert.equal(h.game.remoteInput(u).pressed.KeyF,true,'移動未消化でもFを取得');
  assert.equal(p.appliedActionSeq,undefined,'取得だけでACKしない');
  tick();assert.equal(u.wrecks,1);assert.equal(u.respawnT,5);assert.equal(p.appliedActionSeq,1);
  h.test.acceptInputActions(p,action(1));assert.equal(p.actions.length,0,'重複のFは再実行しない');
}
{
  const {h,u,p,action,tick}=host();
  h.test.acceptInputActions(p,action(1,{pressed:{Space:true,KeyH:true},trigger:true}));
  u.controlInput=h.game.remoteInput(u);assert.equal(Object.keys(u.controlInput.pressed).length,0);assert.equal(u.controlInput.trigger,false);
  tick();assert(!u.wrecks);assert.equal(p.appliedActionSeq,1,'F以外を戦闘操作へ転用しない');
  h.test.acceptInputActions(p,action(2));tick();assert.equal(u.wrecks,1);assert.equal(p.appliedActionSeq,2);
}
for(const staleLife of [false,true]){
  const {h,u,p,action,tick}=host();h.test.acceptInputActions(p,action(1));
  if(staleLife)u.lifeId++;else h.at(501);
  tick();assert(!u.wrecks,'古い生命/期限切れのFを無視');assert.equal(p.actions.length,0);
}
{
  const {h,u,p,action,tick}=host();h.test.acceptInputActions(p,action(1,{pressed:{},keys:{KeyF:true}}));
  tick();assert(!u.wrecks,'保持だけでは大破しない');
}
{
  const h=harness();h.units[0].alive=false;h.units[0].downT=10;
  h.test.stepLocalCommands(input(1,{KeyF:true}),1/240);
  const action=h.sent.find(x=>x.type==='inputActions');assert(action.data.pressed.KeyF);
  assert(!h.sent.some(x=>x.type==='inputBatch'),'移動命令0stepの描画でもFを送る');
  assert.equal(h.units[0].downT,10,'ゲストでは大破を先読みしない');
}
console.log('行動不能のゲストF：移動未到着/未消化・独立ACK・重複・他操作抑止・期限/生命・押下・高Hz送信 成功');
