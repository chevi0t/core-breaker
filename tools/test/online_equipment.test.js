// 全装備の写真往復と特殊操作。実game.js/codec/visibility/weaponTablesを使用。
// WebGL・RTC・命中判定は実行しない。模型/施設の末端だけ代役で、実画面試験を置き換えない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../../vendor/three-r128/three.min.js'),codec=require('../../prototype/online/codec');
const html=fs.readFileSync(require.resolve('../../prototype/index.html'),'utf8'),copy=x=>JSON.parse(JSON.stringify(x)),noop=()=>{};
const segment=(from,to)=>{const a=html.indexOf(from),b=html.indexOf(to,a+from.length);assert(a>=0&&b>a,from);return html.slice(a,b);};
let time=1000;
const elements=new Map(),calls=[],c={T,console,structuredClone,Map,Set,Math,Date,setTimeout,clearTimeout,performance:{now:()=>time},window:{},
  SFX:{},TEAM:{B:{color:0x2266ff},R:{color:0xff6622}},CBOnlineCodec:codec,CBOnlineVisibility:require('../../prototype/online/visibility'),MAPS:{mesa:{name:'台地',team:5,time:300}},
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
vm.runInContext(html.match(/^function baseKick.*$/m)[0]+'\n'+fs.readFileSync(require.resolve('../../prototype/weapons.js'),'utf8')+'\nObject.assign(this,weaponModels());Object.assign(this,weaponTables());',c);
vm.runInContext(segment('function slotOf(', '\nfunction equip('),c);
c.equip=(u,cls)=>{u.cls=cls;u.slots=Object.fromEntries(c.SLOTS.map(k=>[k,c.slotOf(u.controlLoadout?.[k]||c.CLASSES[cls][k])]));};
function makeUnit(id,cls='assault'){
  const u={kind:'unit',entityId:id,team:id[0],idx:+id.slice(2),name:id,cls,lifeId:1,alive:true,hp:10000,maxHp:10000,weapon:'main',yaw:0,pitch:0,downT:0,invulT:0,mech:{...c.MECH_DEFAULT},pos:new T.Vector3(),vel:new T.Vector3(),sc:{total:0},group:new T.Group(),controller:'bot',switchT:0};
  c.equip(u,cls);c.units.push(u);c.scene.add(u.group);return u;
}
const own=makeUnit('B:0'),enemy=makeUnit('R:0','heavy');c.player=own;
const source=fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8').replace('  window.CBOnlineGame={create',`  window.__equipmentTest={packUnit,applyUnit,packEquipmentUnit,applyEquipmentUnit,equipmentUnitForPeer,snapshotForPeer,fixedUnitForPeer,gadgetPolicyForLoadouts,gadgetSlotsForPeer,equipmentObjectsForPeer,applyEquipmentObjects,clearRemoteEquipment,guestEquipmentVisuals,hideRemoteUnit,validInput,acceptInputActions,applyEquipmentActions,sendLocalInput,peerLeft,resetMeasurements,
  actions:()=>equipmentActions,remote:()=>remoteEquipment,checkedEquipment,equipmentRef,equipmentEntity,packShellVisual,makeRemoteShell,removeRemoteShell};\n  window.CBOnlineGame={create`);
vm.runInContext(source,c);const game=c.window.CBOnlineGame,test=c.window.__equipmentTest;
const sent=[];game.state.transport={send:(type,data)=>{sent.push({type,data:copy(data)});return true;},broadcast:noop,metrics:()=>({})};game.state.role='host';game.state.phase='playing';game.state.localUnitId='B:0';game.state.teamSize=1;
const peer={id:'peer',unitId:'B:0',equipment:{cls:'assault',loadout:{...c.CLASSES.assault}},inputLifeId:1,receivedSeq:0,last:time};game.state.peers.set(peer.id,peer);
assert.deepEqual(copy(game.roomOptions.classes.map(v=>v.id)),Object.keys(c.CLASSES),'全4兵装をロビーの選択肢へ出す');
assert.equal(game.roomOptions.classes.length,4);
for(const [cls,slots]of Object.entries(c.ARMORY))for(const slot of c.SLOTS)
  assert.deepEqual(copy(game.equipmentOptions(cls).weapons[slot].map(v=>v.id)),copy(slots[slot]),'兵装と枠ごとに全カタログを選べる');
assert.throws(()=>test.checkedEquipment({cls:'unknown'}),/兵装/);
const invalid={cls:'assault',loadout:{...c.CLASSES.assault,main:'unknown'}};
assert.throws(()=>test.checkedEquipment(invalid),/武器/);
const otherSlot=Object.keys(c.WEAPONS).find(key=>!c.ARMORY.assault.main.includes(key));
assert.throws(()=>test.checkedEquipment({...invalid,loadout:{...c.CLASSES.assault,main:otherSlot}}),/武器/,'正規キーでも兵装/枠が違えば拒否');
let roundtrips=0;
for(const [cls,slots]of Object.entries(c.ARMORY))for(const [slot,keys]of Object.entries(slots))for(const key of keys){
  own.controlLoadout=Object.fromEntries(c.SLOTS.map(k=>[k,k===slot?key:c.CLASSES[cls][k]]));c.equip(own,cls);own.weapon=slot;
  const accepted=test.checkedEquipment({cls,loadout:own.controlLoadout,mech:c.MECH_DEFAULT});assert.equal(accepted.loadout[slot],key,'全武器を正規の装備APIでも受理');
  own.slots[slot].ammo=3;own.slots[slot].heat=37;own.slots[slot].sheathed=true;own.slots[slot].scanRadius=45;
  const packed=test.packUnit(own),encoder=new codec.Encoder(),decoder=new codec.Decoder(),encoded=encoder.encode({units:[packed]});assert(decoder.seed(encoded.baseline));
  const decoded=decoder.decode(encoded.delta).units[0];enemy.mech={...own.mech};test.applyUnit(enemy,decoded);
  assert.equal(enemy.cls,cls);assert.equal(enemy.slots[slot].w.key,key);assert.equal(enemy.slots[slot].heat,37);assert.equal(enemy.slots[slot].sheathed,true);assert.equal(enemy.slots[slot].scanRadius,45);roundtrips++;
}
assert.equal(roundtrips,Object.keys(c.WEAPONS).length);
// 秘匿枠、循環参照を持つ近接硬直、施設の修理先、SP状態。
own.controlLoadout={...c.CLASSES.support};c.equip(own,'support');c.equip(enemy,'heavy');enemy.team='R';enemy.pos.set(500,0,0);own.pos.set(0,0,0);
const facility={kind:'turret',pos:new T.Vector3(5,0,0)};c.turrets.push(facility);own.healTarget=facility;own.fieldOn=true;own.barrierOn=true;own.escortOn=true;own.mirageOn=true;own.seekMode=true;own.radarHeading=1;own.escortAim=new T.Vector3(500,0,0);
own.meleeRecovery={a:{dur:.5},t:.3,stopTgt:enemy,hit:new Set([enemy])};enemy.circular=enemy;
const packed=test.packUnit(own);assert.equal(packed.healTarget,'turret:0');assert(!Object.hasOwn(packed.equipment.recovery,'stopTgt'));test.applyUnit(enemy,packed);assert.equal(enemy.healTarget,facility);assert(enemy.fieldOn&&enemy.barrierOn&&enemy.escortOn&&enemy.mirageOn&&enemy.seekMode);assert.equal(enemy.meleeRecovery.t,.3);
const view={viewer:own,visible:new Set([own.entityId]),pointVisible:p=>p.x<100,gadgetVisible:g=>g.team==='B'||g.pos.x<30};
const filtered=test.equipmentUnitForPeer(packed,view);assert.equal(filtered.vectors.escortAim,null);const hidden=test.fixedUnitForPeer(packed,true,1);assert.equal(hidden.equipment,null);assert.equal(hidden.fieldOn,null);assert.deepEqual(copy(hidden.pos),[0,0,0]);
// 地雷/センサー/SP設置の全種類が正規specのまま表示往復。判定の更新は呼ばない。
const gadgetKeys=Object.keys(c.WEAPONS).filter(k=>c.WEAPONS[k].proj?.max||c.WEAPONS[k].type==='repairPost');let gadgets=0;
for(const key of gadgetKeys){const w=c.WEAPONS[key],spec=w.proj||w,kind=w.type==='repairPost'?'repairPost':spec.kind;
  const row=[0,1,kind,'B',key,[1,2,3],[0,1,0],[1,1,1],50,100,own.entityId,[1,2.65,3],true,null];test.applyEquipmentObjects([row],[]);
  const o=test.remote().get('g:1');assert(o&&o.mesh.parent===c.scene);assert.equal(o.spec,spec);assert.equal(o.owner,own);assert.equal(o.mesh.position.y,2.65);test.applyEquipmentObjects([],[]);assert(!o.mesh.parent);assert(!c.gadgets.includes(o));gadgets++;
}
// 偵察機は秘匿発生で公開IDを進めず、再可視化では新ID。熱/電撃/榴弾警告/投擲も表示のみ。
const drone={team:'R',owner:enemy,pos:new T.Vector3(500,2,0),dir:new T.Vector3(0,0,-1),mesh:new T.Mesh(),spec:{scan:60,keep:5}};c.drones.push(drone);
assert.equal(test.equipmentObjectsForPeer(view).length,0);drone.pos.x=20;let objects=test.equipmentObjectsForPeer(view);const firstId=objects[0].id;assert.equal(objects[0].owner,null);
drone.pos.x=500;assert.equal(test.equipmentObjectsForPeer(view).length,0);drone.pos.x=20;objects=test.equipmentObjectsForPeer(view);assert(objects[0].id>firstId);c.drones.length=0;
const warn=new T.Mesh();warn.position.set(20,2,0);const projectile=new T.Mesh();projectile.position.set(500,100,0);c.barrages.push({team:'R',mesh:projectile,warn});objects=test.equipmentObjectsForPeer(view);assert.equal(objects.length,1);assert.equal(objects[0].type,'artilleryWarn');c.barrages.length=0;
objects=[{id:10,type:'drone',team:'B',pos:[1,2,3],dir:[0,0,-1],rotation:[0,0,0],spec:{scan:30}},{id:11,type:'heat',team:'R',pos:[3,0,0],radius:8,life:1,age:.1},{id:12,type:'stun',team:'R',pos:[4,0,0],dir:[0,0,-1],len:8,width:5,height:3,life:1,max:2},{id:13,type:'artilleryWarn',team:'R',pos:[5,0,0]}];
test.applyEquipmentObjects([],objects);assert.equal(test.remote().size,4);assert.equal(c.drones.length,1);
objects[0].owner=own.entityId;test.applyEquipmentObjects([],objects);assert.equal(c.drones[0].owner,own);objects[0].owner=null;test.applyEquipmentObjects([],objects);assert.equal(c.drones[0].owner,null);
const health=own.hp;test.guestEquipmentVisuals(.1);assert.equal(own.hp,health);test.clearRemoteEquipment();assert.equal(test.remote().size,0);assert.equal(c.drones.length,0);
// 隠れた照射が旧状態から復活しない。
enemy.reflect={at:new T.Vector3()};enemy.reflectVisual={root:new T.Group()};test.hideRemoteUnit(enemy);test.guestEquipmentVisuals(.1);assert.equal(enemy.reflectVisual.root.visible,false);assert.equal(enemy.reflect,null);
// 可視残像は生成時の外見を保持し、隠れた所有者の後の構成を送らない。捕捉先はpeer別公開ID。
const mirageKey=Object.keys(c.WEAPONS).find(k=>c.WEAPONS[k].type==='mirage');own.controlLoadout={...c.CLASSES.assault,sp:mirageKey};c.equip(own,'assault');
const decoy=c.deployMirage(own),oldHead=decoy.onlineAppearance.mech.head;own.mech.head='later-private-part';
peer.replication.gadgetPolicy=test.gadgetPolicyForLoadouts([own.controlLoadout]);let rows=test.gadgetSlotsForPeer(peer,view),decoyRow=rows.find(r=>r[0]===0);assert.equal(decoyRow[13].mech.head,oldHead);assert.equal(decoyRow[13].loadout.sp,mirageKey);
const missileKey=Object.keys(c.WEAPONS).find(k=>c.WEAPONS[k].missile);own.slots.main.w=c.WEAPONS[missileKey];own.slots.main.missileLocks=[{target:decoy,life:1}];own.slots.main.missileProgress=new Map([[decoy,.8]]);own.slots.main.missileCandidates=[decoy];
const missileState=test.equipmentUnitForPeer(test.packUnit(own),view);assert.equal(missileState.missiles.main.locks[0][0],'gadget:'+decoyRow[1]);test.applyEquipmentObjects(rows,[]);test.applyEquipmentUnit(own,missileState);assert.equal(own.slots.main.missileLocks[0].target,test.remote().get('g:'+decoyRow[1]));test.clearRemoteEquipment();c.gadgets.length=0;own.mech.head=oldHead;
// 投擲モデルと拡大率は写真から再現し、共有ジオメトリを破棄しない。
const shell={spec:{model:'sensor',kind:'sensor'},team:'B',mesh:new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),pos:new T.Vector3(),vel:new T.Vector3()};shell.mesh.scale.set(2,3,4);shell.mesh.rotation.y=.7;
const visual=test.packShellVisual(shell);assert.deepEqual(copy(visual.scale),[2,3,4]);const mesh=test.makeRemoteShell({...shell,visual});assert.equal(mesh.material,c.toolMat.B);test.removeRemoteShell(mesh);
// 特殊操作はguestでは計算せず、既存reliable actionのlife/番号/期限と共用。
game.state.role='guest';own.weapon='sp';own.controlLoadout={...c.CLASSES.heavy,sp:'artillery'};c.equip(own,'heavy');own.bombard=null;
c.mapOpen=true;c.mouseDown=true;c.rightDown=true;c.stopArtillery(own);assert(!c.mapOpen&&!c.mouseDown&&!c.rightDown);test.actions().length=0;
c.artilleryConfirm(own,new T.Vector3(10,0,20));assert.equal(own.bombard,null);assert.equal(test.actions().length,1);
const input={seq:1,actionSeq:0,lifeId:1,sentAt:time,yaw:0,pitch:0,aimPoint:[10,0,20],keys:{},pressed:{},equipmentActions:test.actions().splice(0)};
test.sendLocalInput(input,false,true);const wire=sent.findLast(v=>v.type==='inputActions').data;assert.equal(wire.equipmentActions[0].kind,'mapConfirm');game.state.role='host';test.acceptInputActions(peer,wire);assert.equal(peer.actions.length,1);test.acceptInputActions(peer,wire);assert.equal(peer.actions.length,1);test.applyEquipmentActions(own,peer.actions[0]);assert.deepEqual(own.bombard.toArray(),[10,0,20]);
assert.equal(test.validInput({...wire,equipmentActions:[{kind:'eval',point:[0,0,0]}]}),false);assert.equal(test.validInput({...wire,equipmentActions:[{kind:'mapConfirm',point:[NaN,0,0]}]}),false);
const count=peer.actions.length;test.acceptInputActions(peer,{...wire,actionSeq:wire.actionSeq+1,lifeId:0});assert.equal(peer.actions.length,count);
// 再出撃の兵装4種を受理し、選択した同兵装はカスタムを維持する。
peer.equipment={cls:'support',loadout:{...c.CLASSES.support,main:c.ARMORY.support.main.at(-1)}};own.alive=false;
for(const [i,cls]of Object.keys(c.CLASSES).entries()){test.acceptInputActions(peer,{...wire,actionSeq:wire.actionSeq+i+2,nextCls:cls,equipmentActions:[]});assert.equal(own.nextCls,cls);assert.equal(own.controlLoadout.main,cls==='support'?peer.equipment.loadout.main:c.CLASSES[cls].main);}
own.controller='remoteHuman';own.ownerPeerId=peer.id;const retained=own.slots.sp.w.key;test.peerLeft(peer.id,'切断');assert.equal(own.controller,'bot');assert.equal(own.slots.sp.w.key,retained);assert.equal(game.state.peers.size,0);
console.log(JSON.stringify({scope:'実snapshot/codec/装備操作/秘匿。模型末端は代役、実ブラウザ・RTC・命中は未検証',roundtrips,gadgetVariants:gadgets,checks:'4兵装・全武器key/残弾/SP/納刀/索敵半径・施設修理・循環近接状態・設置生成消去・偵察再可視化・地上榴弾予告・照射秘匿・reliable重複/不正拒否・再出撃装備保持・切断Bot引継ぎ'}));
