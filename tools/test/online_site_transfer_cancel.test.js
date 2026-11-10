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
const unit=id=>units.find(u=>u.entityId===id);let clock=1000;const now=()=>clock;const vector=a=>new T.Vector3().fromArray(a);`,c);
for(const name of ['isHumanControlled','isLocalView','isSimulationAuthority','slotOf','equip','resetLifeState','spawn','cancelTransfer','doTransfer','pickClass'])vm.runInContext(extract(html,name,'index.html'),c);
for(const name of ['preset','respawnLoadout','validInput','currentInputLife','actionIsRecent','rememberMovementAction','acceptInputActions','rememberClassChoice','validClassChoice','acceptClassChoice','startedClassTransfer','finishedClassUtility','applyUnit','packUnit','fixedUnitForPeer','packEquipmentUnit','equipmentRef','applyEquipmentUnit'])vm.runInContext(extract(game,name,'online/game.js'),c);
vm.runInContext(game.match(/^  const equipmentScalars=.*$/m)[0]+game.match(/^  const scalarKeys =.*$/m)[0]+game.match(/^  const slotKeys =.*$/m)[0],c);
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
const report={label:'current-test-site',sourceBase:'Sites v21 af9b36dcb3e8fe428cf05369ae7f5203bb75a9c3',method:'Node VM executes functions extracted unchanged from deployed index.html and online/game.js with actual deployed weapon/part tables; graphics, geometry and spawn placement are fixture stubs. No browser or WebRTC ran.',cases:[],extracted};
for(const role of ['host','guest'])for(const from of Object.keys(c.CLASSES))for(const to of Object.keys(c.CLASSES).filter(k=>k!==from)){
 let {u,p}=setup(from,role);select(u,p,to,role);c.cancelTransfer(u);const canceled={cls:u.cls,nextCls:u.nextCls,slots:slots(u),loadout:{...u.controlLoadout}};u.alive=false;c.spawn(u,'base');
 report.cases.push({case:'cancel_transfer_then_respawn',role,from,to,canceled,result:{cls:u.cls,slots:slots(u)},pass:matches(u,u.cls)});
 ({u,p}=setup(from,role));select(u,p,to,role);c.doTransfer(u);report.cases.push({case:'complete_transfer',role,from,to,result:{cls:u.cls,slots:slots(u)},pass:u.cls===to&&matches(u,to)});
 ({u,p}=setup(from,role));u.transfer=null;u.alive=false;select(u,p,to,role);c.spawn(u);report.cases.push({case:'select_while_dead',role,from,to,result:{cls:u.cls,slots:slots(u)},pass:u.cls===to&&matches(u,to)});
}

// 任意の装備組み合わせを維持する。取消で既定装備へ戻して保存ビルドを失う修正は不可。
for(const role of ['host','guest'])for(const from of Object.keys(c.CLASSES))for(const to of Object.keys(c.CLASSES).filter(k=>k!==from)){
 const {u,p}=setup(from,role),custom=Object.fromEntries(c.SLOTS.map(k=>[k,c.ARMORY[from][k][1]||c.ARMORY[from][k][0]]));
 u.controlLoadout={...custom};c.equip(u,from);select(u,p,to,role);c.cancelTransfer(u);c.cancelTransfer(u);u.alive=false;c.spawn(u);
 report.cases.push({case:'cancel_custom_loadout_twice_then_respawn',role,from,to,result:{cls:u.cls,slots:slots(u)},expected:custom,pass:u.cls===from&&c.SLOTS.every(k=>slots(u)[k]===custom[k])});
}
// 兵装変更なし、オフライン、Botの取消は既存の装備を変えない。
for(const mode of ['online_no_class_change','offline','bot'])for(const cls of Object.keys(c.CLASSES)){
 const {u}=setup(cls,'host');
 if(mode==='offline')c.CBOnlineGame.active=()=>false;
 if(mode==='bot'){u.controller='bot';u.localView=false;}
 const original={...u.controlLoadout};c.cancelTransfer(u);
 report.cases.push({case:'unaffected_cancel_path',mode,cls,pass:u.transfer===null&&JSON.stringify(u.controlLoadout)===JSON.stringify(original)});
 c.CBOnlineGame.active=()=>true;
}
// 操作の遅延、重複、古い命。製品受信関数そのものへ時刻を付けて渡す。
for(const delayMs of [0,100,250,500,501,900])for(const oldLife of [false,true]){
 const {u,p}=setup('assault','guest');u.lifeId=2;u.alive=false;u.transfer=null;
 const input={seq:1,actionSeq:1,lifeId:oldLife?u.lifeId-1:u.lifeId,sentAt:1000-delayMs,yaw:0,pitch:0,aimPoint:[0,2,0],keys:{},pressed:{},nextCls:'heavy',spawnChoice:'base',classChoice:{id:1,phase:'dead',lagEpoch:0,transferEpoch:0,transferActionSeq:0}};
 c.acceptInputActions(p,input);c.acceptInputActions(p,input);const expected=!oldLife&&delayMs<=500;
 report.cases.push({case:'delayed_duplicate_death_class_selection',delayMs,oldLife,accepted:p.receivedActionSeq===1,queueLength:p.actions?.length||0,pass:expected?p.receivedActionSeq===1&&p.actions.length===1&&u.nextCls==='heavy':p.receivedActionSeq===undefined&&u.nextCls===null});
}
// 可視自機の写真を4枚落とし、再出撃の最新写真だけから装備を復元。
const {Encoder,Decoder}=require(source+'/online/codec.js');
for(const to of Object.keys(c.CLASSES))for(const mode of ['completed','canceled']){
 const {u,p}=setup('assault','guest');const remote=setup('assault','host').u;c.units=[u];c.player=remote;c.state.peers=new Map([['guest',p]]);
 const enc=new Encoder(),dec=new Decoder();let frame=0,baselines=0;
 const encoded=()=>enc.encode({frame:++frame,time:1000+frame*50,unitUpdates:1,units:[c.fixedUnitForPeer(c.packUnit(u),false,1,true)]});
 const base=encoded();assert.ok(dec.seed(base.baseline));baselines++;
 // initial frame, then four lost frames (selection, cancel/complete, death, early respawn)
 const init=dec.decode(base.delta);c.applyUnit(remote,init.units[0]);
 select(u,p,to,'guest');const lost=[];lost.push(encoded());
 if(mode==='canceled')c.cancelTransfer(u);else c.doTransfer(u);lost.push(encoded());
 u.alive=false;u.downT=0;u.hp=0;lost.push(encoded());c.spawn(u);lost.push(encoded());
 const latest=encoded();if(latest.baseline){assert.ok(dec.seed(latest.baseline));baselines++;}
 let decoded=dec.decode(latest.delta),resync=false;
 if(!decoded){const recovery=enc.encode({frame:++frame,time:1000+frame*50,unitUpdates:1,units:[c.fixedUnitForPeer(c.packUnit(u),false,1,true)]},{forceBaseline:true});assert.ok(dec.seed(recovery.baseline));decoded=dec.decode(recovery.delta);resync=true;}
 assert.ok(decoded);c.applyUnit(remote,decoded.units[0]);
 report.cases.push({case:'four_lost_snapshots_around_respawn',to,mode,lost:lost.length,resync,result:{cls:remote.cls,slots:slots(remote),life:remote.lifeId},pass:remote.lifeId===u.lifeId&&remote.cls===(mode==='canceled'?'assault':to)&&matches(remote,remote.cls)});
}
report.summary={cases:report.cases.length,passed:report.cases.filter(c=>c.pass).length,failed:report.cases.filter(c=>!c.pass).length};
fs.writeFileSync(process.env.CB_OUTPUT||path.join(os.tmpdir(),'online-transfer-cancel.json'),JSON.stringify(report,null,2));
assert.equal(report.summary.failed,Number(process.env.CB_EXPECT_FAILURES||0),'all gameplay regressions must pass');
console.log(JSON.stringify(report.summary));console.log(JSON.stringify(report.cases.filter(c=>!c.pass).slice(0,2),null,2));
