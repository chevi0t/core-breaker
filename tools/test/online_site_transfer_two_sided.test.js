// Two-sided cancellation regression. Node VM, not browser/WebRTC.
// CB_SOURCE=/path/to/prototype CB_THREE=/path/to/three.min.js node this-file.js
// CB_REVIEW_REPORT_ONLY=1 prints failures without exiting nonzero.
// Reuses the actual deployed class selection, sender, receiver, cancellation,
// respawn, snapshot codec, and stale-frame rejection functions. Geometry,
// rendering, transport scheduling, and snapshot schema validation are fixtures.
'use strict';
const outerFs=require('fs'), outerVm=require('vm'), strict=require('assert/strict');
function make(){
// オンラインの兵装予約取消・再出撃の回帰（Node VM、ブラウザ/実通信の試験ではない）。
// node tools/test/online_transfer_cancel.test.js
// 本体関数を変更せず抽出し、配信版の武器表とcodecで検査する。描画・地形・機体性能はfixture。
// CB_SOURCEでprototype相当、CB_THREEでthree.min.js、CB_OUTPUTで結果JSONを指定できる。
// 既知の不具合を持つ元版との比較時だけCB_EXPECT_FAILURES=51を指定する。
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const source=path.resolve(process.env.CB_SOURCE||path.join(__dirname,'../../prototype')),html=fs.readFileSync(source+'/index.html','utf8'),game=fs.readFileSync(source+'/online/game.js','utf8');
const extracted=[];
function extract(s,name,origin){
 const re=new RegExp('(?:^|\\n)([ \\t]*)function '+name+'\\('),m=re.exec(s);if(!m)throw Error(name+' not found');
 const start=m.index+(s[m.index]==='\n'?1:0),body=s.indexOf('{',start),indent=m[1];
 // These selected functions have no object destructuring in their parameters. Scan balanced JS braces, ignoring comments and strings.
 let depth=0,quote=null,comment=null,escape=false,end=-1;
 for(let i=body;i<s.length;i++){const ch=s[i],next=s[i+1];
   if(comment==='line'){if(ch==='\n')comment=null;continue;}if(comment==='block'){if(ch==='*'&&next==='/'){comment=null;i++;}continue;}
   if(quote){if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch===quote)quote=null;continue;}
   if(ch==='/'&&next==='/'){comment='line';i++;continue;}if(ch==='/'&&next==='*'){comment='block';i++;continue;}
   if(['"',"'",'`'].includes(ch)){quote=ch;continue;}if(ch==='{')depth++;if(ch==='}'&&--depth===0){end=i+1;break;}
 }
 if(end<0)throw Error('no end '+name);const text=s.slice(start,end);
 extracted.push({name,origin,line:s.slice(0,start).split('\n').length,sha256:crypto.createHash('sha256').update(text).digest('hex')});return text;
}
const c=vm.createContext({console,structuredClone,TextEncoder,TextDecoder,setTimeout,clearTimeout});c.window=c;
c.SFX={};c.TEAM={B:{color:0x3366ff,dir:1},R:{color:0xff6633,dir:-1}};
vm.runInContext(fs.readFileSync(process.env.CB_THREE||path.join(__dirname,'../../vendor/three-r128/three.min.js'),'utf8'),c);c.T=c.THREE;
vm.runInContext(extract(html,'baseKick','index.html'),c);
for(const file of ['parts.js','weapons.js'])vm.runInContext(fs.readFileSync(source+'/'+file,'utf8'),c);
vm.runInContext('Object.assign(globalThis,partTables()); Object.assign(globalThis,weaponModels()); Object.assign(globalThis,weaponTables());',c);
const noop=()=>{};
Object.assign(c,{simulationRole:'host',chosenCls:'assault',player:null,units:[],state:{role:'host',phase:'playing',peers:new Map()},inputLimits:{batch:5,maxAgeMs:500,activeMs:250,futureMs:250,actions:64},movementKeys:['KeyW','KeyS','KeyA','KeyD','KeyC','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'],movementEdges:['ShiftLeft','ShiftRight','Space'],localMeleeSwing:null,prediction:{enabled:true},jumpPads:[],ziplines:[],gadgets:[],turrets:[],radars:[],equipmentVectors:['escortAim','bombard','seekAim'],equipmentEntity:()=>null,applyEquipmentUnit:noop,replaceMech:noop,
 stopBeamCannon:noop,resetBoosterFlame:noop,stopMovementSound:noop,clearAttached:noop,resetBlastShake:noop,resetCombatFeedback:noop,resetMechPose:noop,weaponLook:noop,removeGadget:noop,dropPing:noop,releaseLock:noop,feed:noop,sfx:noop,
 incomingShots:new Set(),pings:[],scene:{remove:noop},VS:null,SPAWN_INVUL:2,meleeOnly:()=>false,tutorial:false,loadout:Object.fromEntries(Object.entries(c.CLASSES).map(([k,v])=>[k,Object.fromEntries(c.SLOTS.map(s=>[s,v[s]]))])),document:{querySelectorAll:()=>[]},spawnPos:(u,at)=>{u.lastSpawnAt=at;},spawnPoints:()=>[{id:'base'},{id:'A'}],copyView:()=>null,validEquipmentAction:()=>true,
 mechStats:()=>({P:{head:{lock:200,aim:1},body:{boost:100,sp:100,supply:1},arms:{ammo:1,reload:1,swap:1,recoil:1}},armor:1,avg:1,walk:10,dash:20,cruise:15})});
vm.runInContext(`const inputKeys=${JSON.stringify(['KeyW','KeyS','KeyA','KeyD','KeyR','KeyC','KeyF','KeyH','KeyE','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Digit1','Digit2','Digit3','Digit4'])};
const pickedKeys=(o,allowed=inputKeys)=>Object.fromEntries(allowed.filter(k=>o?.[k]).map(k=>[k,true]));
const safe=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined&&(typeof o[k]!=='number'||Number.isFinite(o[k]))).map(k=>[k,o[k]]));
const unit=id=>units.find(u=>u.entityId===id);const now=()=>globalThis.testNow??1000;const clock=()=>1000;const vector=a=>new T.Vector3().fromArray(a);`,c);
for(const name of ['isHumanControlled','isLocalView','isSimulationAuthority','slotOf','equip','resetLifeState','spawn','cancelTransfer','doTransfer','pickClass'])vm.runInContext(extract(html,name,'index.html'),c);
for(const name of ['preset','respawnLoadout','validInput','currentInputLife','actionIsRecent','rememberMovementAction','acceptInputActions','rememberClassChoice','validClassChoice','acceptClassChoice','retirePendingClassChoice','startedClassTransfer','finishedClassUtility','applyUnit','packUnit','fixedUnitForPeer','packEquipmentUnit','equipmentRef','applyEquipmentUnit'])vm.runInContext(extract(game,name,'online/game.js'),c);
vm.runInContext(game.match(/^  const equipmentScalars=.*$/m)[0]+game.match(/^  const scalarKeys =.*$/m)[0]+game.match(/^  const slotKeys =.*$/m)[0]+game.match(/^  const remoteSlotKeys=.*$/m)[0],c);
c.CBOnlineGame={active:()=>true,roomOptions:{classes:Object.keys(c.CLASSES).map(id=>({id}))},respawnLoadout:cls=>c.respawnLoadout(cls),rememberClassChoice:u=>c.rememberClassChoice(u),startedClassTransfer:u=>c.startedClassTransfer(u),finishedClassUtility:(...a)=>c.finishedClassUtility(...a)};
function setup(cls,role='host'){
 const u={entityId:'B:0',idx:0,name:'fixture',ownerPeerId:'guest',team:'B',controller:role==='host'?'localHuman':'remoteHuman',localView:role==='host',cls,lifeId:1,alive:true,hp:10000,maxHp:10000,mech:{},sx:{},sc:{},group:{visible:true},pos:new c.T.Vector3(),vel:new c.T.Vector3(),controlLoadout:c.preset(cls),transfer:{base:true,t:1},nextCls:null};
 c.units=[u];c.player=role==='host'?u:null;c.state.equipment={cls,loadouts:structuredClone(c.loadout)};const p={unitId:u.entityId,inputLifeId:1,receivedSeq:0,equipment:c.state.equipment};c.state.peers=new Map([['guest',p]]);c.equip(u,cls);return {u,p};
}
function select(u,p,cls,role){if(role==='host'){c.pickClass(cls);return;}
 c.acceptInputActions(p,{seq:1,actionSeq:1,lifeId:u.lifeId,sentAt:1000,yaw:0,pitch:0,aimPoint:[0,2,0],keys:{},pressed:{},nextCls:cls,spawnChoice:'base',classChoice:{id:1,phase:u.alive?'transfer':'dead',lagEpoch:u.onlineLagEpoch||0,transferEpoch:u.onlineTransferEpoch||0,transferActionSeq:u.onlineTransferActionSeq||0}});
 assert.equal(p.receivedActionSeq,1,'valid guest action accepted');
}
const slots=u=>Object.fromEntries(c.SLOTS.map(k=>[k,u.slots[k].w.key]));const matches=(u,cls)=>c.SLOTS.every(k=>u.slots[k].w.key===c.CLASSES[cls][k]);

 Object.assign(c,{AREA_CD:40,areaTime:()=>5,inOwnBase:()=>true,isArtilleryMode:()=>false,beamCannonMode:()=>false});
 for(const n of ['startTransfer','humanUtilityInput'])vm.runInContext(extract(html,n,'index.html'),c);
 for(const n of ['sendLocalInput','stepLocalCommands','receiveSnapshot','validPeerSnapshot'])vm.runInContext(extract(game,n,'online/game.js'),c);
 return {c,setup,slots,source,extract,html,game};
}
function pair(){
 const host=make(),guest=make(),{u:hu,p}=host.setup('assault','guest'),{u:gu}=guest.setup('assault','host');
 hu.onGround=true;guest.c.simulationRole='guest';guest.c.state.role='guest';
 const sent=[],queue=[];let defer=false;
 Object.assign(guest.c,{lastRenderedView:null,inputSending:{lifeId:gu.lifeId,history:[],signature:null,actionSeq:0,lastActionAt:0},
   localCommands:{lifeId:gu.lifeId,accumulator:0,pressed:{},wheel:0,weapon:null,moveActions:[]},commandLimits:{dt:1/60,maxFrameSteps:3},
   blockedRenderOffset:()=>false,updateLocalRenderOffset:()=>{},finishMeleeRender:()=>{},flushLocalInputs:()=>{},
   finalFrame:null,prepared:true,pendingPrepare:null,diagnosticArrival:()=>{},requestSnapshotResync:()=>{},
   pendingSnapshotWires:new Map(),pendingSnapshotBases:new Map(),lastResync:0,resyncBackoff:250,lastSnapshotBaseId:null,
   interpolation:{staleSnapshots:0,lastArrival:null,acceptedSnapshots:0,localOffset:null,intervalMs:50,jitterMs:0,targetDelayMs:60},
   clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),capturePredictionView:()=>null,reconcilePrediction:()=>{}});
 guest.c.state.localUnitId=gu.entityId;guest.c.state.seq=0;guest.c.state.pendingInputs=new Map();guest.c.state.history=[];guest.c.state.phase='playing';
 guest.c.state.transport={clock:()=>({offsetMs:0}),send:(kind,value)=>{if(kind==='inputActions'){sent.push(JSON.parse(JSON.stringify(value)));if(defer)queue.push(value);else host.c.acceptInputActions(p,value);}return true;}};
 const {Encoder,Decoder}=require(host.source+'/online/codec.js'),enc=new Encoder(),dec=new Decoder();let frame=0;
 guest.c.snapshotDecoder=dec;guest.c.applySnapshot=s=>guest.c.applyUnit(gu,s.units[0]);
 const packet=(time)=>{const e=enc.encode({frame:++frame,time:time??1000+frame*50,unitUpdates:1,roster:[{id:hu.entityId,team:hu.team,name:hu.name,sc:hu.sc}],units:[host.c.fixedUnitForPeer(host.c.packUnit(hu),false,1,true)]},{forceBaseline:true});strict.ok(dec.seed(e.baseline));return {frame,delta:e.delta};};
 const receive=wire=>guest.c.receiveSnapshot(wire),sync=(time)=>{const w=packet(time);receive(w);return w;};
 const input=(pressed={},keys={})=>guest.c.stepLocalCommands({keys,pressed,yaw:0,pitch:0,aimPoint:[0,2,0]},0);
 const keyH=()=>{input({KeyH:true},{KeyH:true});host.c.humanUtilityInput(hu,{pressed:{KeyH:true},actionSeq:sent.at(-1).actionSeq});p.utilityActions=(p.utilityActions||[]).filter(a=>a.actionSeq!==sent.at(-1).actionSeq);};
 sync();
 return {host,guest,hu,gu,p,sent,packet,receive,sync,input,keyH,setDeferred:v=>defer=v,flush:()=>{while(queue.length)host.c.acceptInputActions(p,queue.shift());}};
}
module.exports={make,pair};
if(require.main===module){
const results=[];
function test(name,fn,known=false){try{fn();results.push({name,pass:true,known});}catch(e){results.push({name,pass:false,known,error:e.message});}}
function selectAndCancel(p,{syncCancel=true}={}){p.guest.c.pickClass('heavy');p.input();p.keyH();if(syncCancel)p.sync();p.input();}
function dieAndRespawn(p){p.hu.alive=false;p.hu.downT=10;p.sync();p.input({KeyF:true},{KeyF:true});p.host.c.spawn(p.hu);p.sync();}
for(const lost of [false,true]){
 test('H cancellation then death/F, cancellation snapshot '+(lost?'lost':'delivered'),()=>{const p=pair();selectAndCancel(p,{syncCancel:!lost});dieAndRespawn(p);strict.equal(p.hu.cls,'assault');strict.equal(p.gu.cls,'assault');strict.equal(p.gu.nextCls,null);});
 test('H cancellation then immediate repeated transfer, cancellation snapshot '+(lost?'lost':'delivered'),()=>{const p=pair();selectAndCancel(p,{syncCancel:!lost});p.keyH();p.sync();p.input();p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.hu.cls,'assault');strict.equal(p.gu.nextCls,null);});
}
test('Pending class choice survives snapshots before sender runs',()=>{const p=pair();p.guest.c.pickClass('heavy');p.sync();strict.equal(p.gu.nextCls,'heavy');p.input();strict.equal(p.hu.nextCls,'heavy');p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.gu.cls,'heavy');});
test('Pending class choice survives snapshots while reliable send is delayed',()=>{const p=pair();p.setDeferred(true);p.guest.c.pickClass('heavy');p.input();p.sync();strict.equal(p.gu.nextCls,'heavy');strict.equal(p.hu.nextCls,null);p.flush();strict.equal(p.hu.nextCls,'heavy');p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.gu.cls,'heavy');});
test('Canceled class can be explicitly selected again in next transfer',()=>{const p=pair();selectAndCancel(p);p.keyH();p.sync();p.input();p.guest.c.pickClass('heavy');p.sync();strict.equal(p.gu.nextCls,'heavy');p.input();p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.gu.cls,'heavy');});
test('Death-time class choice survives same-dead snapshots and reaches respawn',()=>{const p=pair();selectAndCancel(p);p.hu.alive=false;p.sync();p.setDeferred(true);p.guest.c.pickClass('support');p.input();p.sync();strict.equal(p.gu.nextCls,'support');p.flush();p.host.c.spawn(p.hu);p.sync();strict.equal(p.hu.cls,'support');strict.equal(p.gu.cls,'support');strict.equal(p.gu.nextCls,null);});
test('Old snapshot cannot erase an unacknowledged new-transfer choice',()=>{const p=pair();selectAndCancel(p);const old=p.packet();p.keyH();p.sync();p.input();p.guest.c.pickClass('support');p.receive(old);strict.equal(p.gu.nextCls,'support');strict.equal(p.guest.c.interpolation.staleSnapshots,1);p.input();p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.gu.cls,'support');});
test('In-order delayed previous-transfer terminal snapshot preserves a new unsent class choice',()=>{const p=pair();selectAndCancel(p,{syncCancel:false});const terminal=p.packet();p.keyH();p.input();strict.ok(p.hu.transfer);p.guest.c.pickClass('support');strict.equal(p.gu.nextCls,'support');p.receive(terminal);strict.equal(p.guest.c.interpolation.staleSnapshots,0);strict.equal(p.gu.nextCls,'support');p.input();strict.equal(p.hu.nextCls,'support');p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.gu.cls,'support');});
test('Delivered automatic cancellation clears its acknowledged pending choice before later death',()=>{const p=pair();p.guest.c.pickClass('heavy');p.input();p.host.c.cancelTransfer(p.hu);p.sync();dieAndRespawn(p);strict.equal(p.gu.cls,'assault');});
test('Completed transfer clears old-life pending selection even if terminal snapshot is lost',()=>{const p=pair();p.guest.c.pickClass('heavy');p.input();p.host.c.doTransfer(p.hu);p.hu.alive=false;p.host.c.spawn(p.hu);p.sync();strict.equal(p.gu.cls,'heavy');strict.equal(p.gu.nextCls,null);});
// Automatic cancellation is acknowledged by explicit selection id, not merely by a
// transfer-to-null transition. A delayed terminal snapshot must preserve newer intent.
test('automatic cancellation snapshot lost then death reaccepts stale choice',()=>{const p=pair();p.guest.c.pickClass('heavy');p.input();p.host.c.cancelTransfer(p.hu);dieAndRespawn(p);strict.equal(p.hu.cls,'assault');});

// Additional generation/ACK races. These are blocking, never known failures.
for(const cls of ['assault','heavy','raid','support'])for(const delivered of [false,true]){
 test('Automatic cancellation of '+cls+', terminal '+(delivered?'delivered':'lost')+', immediate death does not repeat choice',()=>{
  const p=pair();p.guest.c.pickClass(cls);p.input();p.host.c.cancelTransfer(p.hu);if(delivered)p.sync();
  p.hu.alive=false;p.hu.onlineLagEpoch=(p.hu.onlineLagEpoch||0)+1;p.sync();p.input({KeyF:true},{KeyF:true});p.host.c.spawn(p.hu);p.sync();
  strict.equal(p.hu.cls,'assault');strict.equal(p.gu.cls,'assault');strict.equal(p.gu.nextCls,null);
 });
}
test('First receipt of transfer choice after automatic cancellation and death retires it',()=>{
 const p=pair();p.setDeferred(true);p.guest.c.pickClass('heavy');p.input();strict.equal(p.hu.nextCls,null);
 p.host.c.cancelTransfer(p.hu);p.hu.alive=false;p.hu.onlineLagEpoch=1;p.sync();p.flush();p.sync();
 strict.equal(p.hu.nextCls,null);strict.equal(p.gu.nextCls,null);strict.equal(p.hu.onlineClassChoiceAck,1);
 p.input({KeyF:true},{KeyF:true});p.host.c.spawn(p.hu);p.sync();strict.equal(p.hu.cls,'assault');
});
test('Explicit same-class choice during death remains new intent after canceled transfer',()=>{
 const p=pair();p.guest.c.pickClass('heavy');p.input();p.host.c.cancelTransfer(p.hu);p.hu.alive=false;p.hu.onlineLagEpoch=1;p.sync();
 p.guest.c.pickClass('heavy');p.input();strict.equal(p.hu.onlineClassChoiceAck,2);p.host.c.spawn(p.hu);p.sync();strict.equal(p.gu.cls,'heavy');
});
test('Old in-order terminal ACK preserves a same-class unsent new-transfer choice',()=>{
 const p=pair();p.guest.c.pickClass('heavy');p.input();p.host.c.cancelTransfer(p.hu);const terminal=p.packet();
 p.keyH();p.guest.c.pickClass('heavy');strict.equal(p.gu.onlineClassChoice.id,2);p.receive(terminal);strict.equal(p.gu.nextCls,'heavy');
 p.sync();p.input();strict.equal(p.hu.onlineClassChoiceAck,2);p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.gu.cls,'heavy');
});
test('Old in-order terminal ACK preserves an already-sent newer selection',()=>{
 const p=pair();p.guest.c.pickClass('heavy');p.input();p.host.c.cancelTransfer(p.hu);const terminal=p.packet();
 p.keyH();p.guest.c.pickClass('support');p.input();strict.equal(p.hu.nextCls,'support');
 p.receive(terminal);strict.equal(p.gu.nextCls,'support');p.host.c.doTransfer(p.hu);p.sync();strict.equal(p.gu.cls,'support');
});
test('Rejected old receipt ACK does not clear an even newer unsent death selection',()=>{
 const p=pair();p.setDeferred(true);p.guest.c.pickClass('heavy');p.input();p.host.c.cancelTransfer(p.hu);p.hu.alive=false;p.hu.onlineLagEpoch=1;p.sync();
 p.flush();const oldAck=p.packet();p.guest.c.pickClass('support');p.receive(oldAck);strict.equal(p.gu.nextCls,'support');
 p.setDeferred(false);p.input();p.host.c.spawn(p.hu);p.sync();strict.equal(p.gu.cls,'support');
});
test('Fresh resumed guest increments beyond received host ACK',()=>{
 const p=pair();p.hu.onlineClassChoiceAck=19;p.hu.nextCls=null;delete p.gu.onlineClassChoice;delete p.gu.onlineClassChoiceAck;p.sync();
 p.guest.c.pickClass('support');strict.equal(p.gu.onlineClassChoice.id,20);p.input();strict.equal(p.hu.nextCls,'support');
});
test('Old death choice cannot cross revive and second death in the same life',()=>{
 const p=pair();p.hu.transfer=null;p.hu.alive=false;p.hu.onlineLagEpoch=1;p.sync();p.setDeferred(true);p.guest.c.pickClass('support');p.input();
 p.hu.alive=true;p.hu.onlineLagEpoch=2;p.hu.alive=false;p.hu.onlineLagEpoch=3;p.flush();p.sync();
 strict.equal(p.hu.nextCls,null);strict.equal(p.gu.nextCls,null);strict.equal(p.hu.onlineClassChoiceAck,1);
});
test('A new explicit choice at the second death succeeds after rejected old-life-boundary choice',()=>{
 const p=pair();p.hu.transfer=null;p.hu.alive=false;p.hu.onlineLagEpoch=1;p.sync();p.setDeferred(true);p.guest.c.pickClass('support');p.input();
 p.hu.alive=true;p.hu.onlineLagEpoch=2;p.hu.alive=false;p.hu.onlineLagEpoch=3;p.flush();p.sync();p.setDeferred(false);
 p.guest.c.pickClass('support');p.input();p.host.c.spawn(p.hu);p.sync();strict.equal(p.gu.cls,'support');
});
test('A received choice outside any selection phase is retired before later death',()=>{
 const p=pair();p.setDeferred(true);p.guest.c.pickClass('heavy');p.input();p.host.c.cancelTransfer(p.hu);p.flush();
 strict.equal(p.hu.onlineClassChoiceAck,1);p.hu.alive=false;p.sync();p.input({KeyF:true},{KeyF:true});p.host.c.spawn(p.hu);strict.equal(p.hu.cls,'assault');
});
test('Choice acknowledgement and pending class are only in own visible snapshot slot',()=>{
 const p=pair();p.guest.c.pickClass('support');p.input();const packed=p.host.c.packUnit(p.hu);
 const own=p.host.c.fixedUnitForPeer(packed,false,1,true),other=p.host.c.fixedUnitForPeer(packed,false,1,false),hidden=p.host.c.fixedUnitForPeer(packed,true,2,true);
 strict.equal(own.classSelection.ack,1);strict.equal(own.classSelection.pending,'support');strict.equal(other.classSelection,null);strict.equal(hidden.classSelection,null);
});
for(const token of [null,[],{id:0,phase:'dead',lagEpoch:0},{id:1.5,phase:'dead',lagEpoch:0},{id:1,phase:'other',lagEpoch:0},{id:1,phase:'dead',lagEpoch:-1},{id:Infinity,phase:'dead',lagEpoch:0}]){
 test('Malformed choice token does not mutate input or equipment: '+JSON.stringify(token),()=>{
  const p=pair();p.hu.alive=false;
  p.host.c.acceptInputActions(p.p,{seq:1,actionSeq:1,lifeId:1,sentAt:1000,yaw:0,pitch:0,aimPoint:[0,2,0],keys:{},pressed:{},nextCls:'support',classChoice:token});
  strict.equal(p.hu.nextCls,null);strict.equal(p.p.receivedActionSeq,undefined);strict.equal(p.hu.onlineClassChoiceAck,undefined);
 });
}
const summary={source:process.env.CB_SOURCE,cases:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass&&!x.known).length,knownFailures:results.filter(x=>!x.pass&&x.known).length,method:'Node VM with two state contexts, actual local sender/input receiver and real snapshot codec/stale-frame gate; no browser/WebRTC',results};
console.log(JSON.stringify(summary,null,2));if(process.env.CB_OUTPUT)outerFs.writeFileSync(process.env.CB_OUTPUT,JSON.stringify(summary,null,2));
if(process.env.CB_REVIEW_REPORT_ONLY!=='1')strict.equal(summary.failed,0,'two-sided cancellation checks must pass');

}
