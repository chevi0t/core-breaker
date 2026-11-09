// 全装備の写真往復と特殊操作。実game.js/codec/visibility/weaponTablesを使用。
// WebGL・RTC・命中判定は実行しない。模型/施設の末端だけ代役で、実画面試験を置き換えない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
module.exports=function equipmentFixture(root=path.resolve(__dirname,'../..')){
const file=p=>path.join(root,p),T=require(file('vendor/three-r128/three.min.js')),codec=require(file('prototype/online/codec.js'));
const html=fs.readFileSync(file('prototype/index.html'),'utf8'),copy=x=>JSON.parse(JSON.stringify(x)),noop=()=>{};
const segment=(from,to)=>{const a=html.indexOf(from),b=html.indexOf(to,a+from.length);assert(a>=0&&b>a,from);return html.slice(a,b);};
let time=1000;
const elements=new Map(),calls=[],c={T,console,structuredClone,Map,Set,Math,Date,setTimeout,clearTimeout,performance:{now:()=>time},window:{},
  SFX:{},TEAM:{B:{color:0x2266ff},R:{color:0xff6622}},CBOnlineCodec:codec,CBOnlineVisibility:require(file('prototype/online/visibility.js')),MAPS:{mesa:{name:'台地',team:5,time:300}},
  units:[],turrets:[],radars:[],barricades:[],plants:[],lifts:[],jumpPads:[],catapults:[],ziplines:[],shells:[],gadgets:[],drones:[],barrages:[],heatFields:[],stunFields:[],mirages:[],hittables:[],scene:new T.Scene(),
  PART_SLOTS:['head','body','arms','legs'],MECH_DEFAULT:{head:'standard',body:'standard',arms:'standard',legs:'standard',color:'team'},PAINTS:[{id:'team',name:'所属色'}],
  PARTS:Object.fromEntries(['head','body','arms','legs'].map(k=>[k,{standard:{name:'標準'}}])),
  spotted:{B:new Map(),R:new Map()},spotSrc:{B:new Map(),R:new Map()},running:true,ended:false,timeLeft:300,cores:{B:{hp:9000},R:{hp:9000}},
  document:{exitPointerLock:noop},$:id=>{if(!elements.has(id))elements.set(id,{querySelector:()=>null,textContent:'test'});return elements.get(id);},
  addEventListener:noop,stopLoopingGameSounds:noop,bgmTick:noop,tutorialClearInput:noop,setSimulationRole:noop,showPage:noop,selectMap:noop,
  weaponLook:noop,tracer:noop,boom:noop,impact:noop,sfx:noop,shot:noop,shoot:noop,blast:noop,damage:noop,finish:noop,releaseLock:noop,
  castFrom:()=>null,canSee:()=>true,noticed:(u,d)=>d<10,targetPoint:u=>u.pos.clone(),wrapAngle:x=>Math.atan2(Math.sin(x),Math.cos(x)),UP:new T.Vector3(0,1,0),BALLISTIC_COLOR:0xffbb11,
  toolMat:{B:new T.MeshBasicMaterial(),R:new T.MeshBasicMaterial()},shellMat:{B:new T.MeshBasicMaterial(),R:new T.MeshBasicMaterial()},artilleryShellGeo:new T.BoxGeometry(),artilleryWarnGeo:new T.BoxGeometry(),artilleryWarnMat:new T.MeshBasicMaterial(),fieldGeo:new T.SphereGeometry(),fieldMat:new T.MeshBasicMaterial(),GADGET_NAME:{mine:'地雷',sensor:'センサー'},
  weaponGeo:()=>new T.BoxGeometry(),setWeaponGeo:noop,disposeMech:noop,buildMech:()=>{const g=new T.Group();return {g,gun:new T.Mesh(),blade:new T.Mesh(),pack:new T.Mesh(),flame:new T.Mesh()};},mirageMesh:()=>new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),
  deployMirage:u=>{const g={gadget:true,kind:'decoy',team:u.team,owner:u,spec:u.slots.sp.w,pos:u.pos.clone(),mesh:new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),hp:100,maxHp:100,yaw:0,alive:true};c.gadgets.push(g);return g;},makeHeatField:()=>new T.Mesh(new T.SphereGeometry(),new T.MeshBasicMaterial()),heatVisualTick:noop,removeHeatVisual:o=>c.scene.remove(o.mesh),
  shockLines:()=>new T.Group(),shockBolts:noop,shockOpacity:noop,shockDispose:noop,emitReconPulse:noop,
  reflectorUpdate:()=>{for(const u of c.units)if(u.reflect){u.reflectVisual||={root:new T.Group()};u.reflectVisual.root.visible=true;}},beamCannonVisual:(u,p,a)=>calls.push(['beam',u.entityId,p,a]),
  artilleryConfirm:(u,p)=>{u.bombard=p.clone();calls.push(['map',u.entityId,p.toArray()]);return true;},reflectorConfirm:(u,p)=>{u.reflect={at:p.clone()};return true;},stopArtillery:u=>{u.bombard=null;u.reflect=null;calls.push(['cancel',u.entityId]);},stopBeamCannon:u=>{u.beamFire=null;},setSeekMode:(u,on)=>{u.seekMode=on;},
  isArtilleryMode:u=>u.weapon==='sp'&&['artillery','reflector'].includes(u.slots.sp.w.type),seekerHeld:u=>!!u.slots[u.weapon].w.proj?.seek,aimPress:(button)=>{if(button===2)c.player.scopeStep=((c.player.scopeStep||0)+1)%3;},
  fwdOf:()=>new T.Vector3(0,0,-1),spawnPoints:()=>[{id:'base'}]};
vm.createContext(c);
vm.runInContext(html.match(/^function baseKick.*$/m)[0]+'\n'+fs.readFileSync(file('prototype/weapons.js'),'utf8')+'\nObject.assign(this,weaponModels());Object.assign(this,weaponTables());',c);
vm.runInContext(segment('function slotOf(', '\nfunction equip('),c);
c.equip=(u,cls)=>{u.cls=cls;u.slots=Object.fromEntries(c.SLOTS.map(k=>[k,c.slotOf(u.controlLoadout?.[k]||c.CLASSES[cls][k])]));};
function makeUnit(id,cls='assault'){
  const u={kind:'unit',entityId:id,team:id[0],idx:+id.slice(2),name:id,cls,lifeId:1,alive:true,hp:10000,maxHp:10000,weapon:'main',yaw:0,pitch:0,downT:0,invulT:0,mech:{...c.MECH_DEFAULT},pos:new T.Vector3(),vel:new T.Vector3(),sc:{total:0},group:new T.Group(),controller:'bot',switchT:0};
  c.equip(u,cls);c.units.push(u);c.scene.add(u.group);return u;
}
const own=makeUnit('B:0'),enemy=makeUnit('R:0','heavy');c.player=own;
const source=fs.readFileSync(file('prototype/online/game.js'),'utf8').replace('  window.CBOnlineGame={create',`  window.__equipmentTest={encodePeerSnapshot,replicationFor,createPeerView,slotKeys,remoteSlotKeys:typeof remoteSlotKeys==='undefined'?null:remoteSlotKeys,packUnit,applyUnit,packEquipmentUnit,applyEquipmentUnit,equipmentUnitForPeer,snapshotForPeer,fixedUnitForPeer,gadgetPolicyForLoadouts,gadgetSlotsForPeer,equipmentObjectsForPeer,applyEquipmentObjects,clearRemoteEquipment,guestEquipmentVisuals,hideRemoteUnit,validInput,acceptInputActions,applyEquipmentActions,sendLocalInput,peerLeft,resetMeasurements,
  actions:()=>equipmentActions,remote:()=>remoteEquipment,checkedEquipment,equipmentRef,equipmentEntity,packShellVisual,makeRemoteShell,removeRemoteShell};\n  window.CBOnlineGame={create`);
vm.runInContext(source,c);const game=c.window.CBOnlineGame,test=c.window.__equipmentTest;
const sent=[];game.state.transport={send:(type,data)=>{sent.push({type,data:copy(data)});return true;},broadcast:noop,metrics:()=>({})};game.state.role='host';game.state.phase='playing';game.state.localUnitId='B:0';game.state.teamSize=1;
const peer={id:'peer',unitId:'B:0',equipment:{cls:'assault',loadout:{...c.CLASSES.assault}},inputLifeId:1,receivedSeq:0,last:time};game.state.peers.set(peer.id,peer);

return {T,c,game,test,codec,own,enemy,peer,makeUnit,copy,calls,sent,noop,time,setTime:value=>time=value};
};
