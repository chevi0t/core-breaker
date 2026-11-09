// #214独立監査。Node/VM上の本体処理→peer写真→実codec→別VMへの復元。
// WebGL、実入力配送、実WebRTC、地形上の命中を証明しない。
// 既存fixtureの準備部分だけ再利用し、そのassertや製品実装は変更しない。
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=require.resolve('./online_equipment.test.js');
const fixtureSource=fs.readFileSync(filename,'utf8');
const strict=process.env.CB_AUDIT_STRICT==='1';
const known=reason=>strict?false:reason;
const boundary="assert.deepEqual(copy(game.roomOptions.classes.map";
assert.equal(fixtureSource.split(boundary).length,2,'fixture準備の境界が一意');
function fixture(){
  const env={require:createRequire(filename),console,structuredClone,setTimeout,clearTimeout};
  // 製品の公開APIを変更せず、VM内だけ内部関数を観測する。
  const setup=fixtureSource.slice(0,fixtureSource.indexOf(boundary))
    .replace('packUnit,applyUnit,packEquipmentUnit','snapshot,applySnapshot,packUnit,applyUnit,packEquipmentUnit');
  vm.runInNewContext(setup+'\nglobalThis.audit={c,test,game,own,enemy,peer,sent,makeUnit,html,segment};',env,{filename});
  const a=env.audit;
  a.load=(from,to)=>vm.runInContext(a.segment(from,to),a.c);
  a.equip=(u,cls,slot,key)=>{u.controlLoadout={...a.c.CLASSES[cls],[slot]:key};a.c.equip(u,cls);u.prevWeapon='main';u.weapon=slot;u.switchT=0;};
  return a;
}
function wire(s){
  const codec=require('../../prototype/online/codec'),e=new codec.Encoder(),d=new codec.Decoder();
  const packet=JSON.parse(JSON.stringify(e.encode(s)));assert(d.seed(packet.baseline));return d.decode(packet.delta);
}
function pair(){const h=fixture(),g=fixture();g.game.state.role='guest';return {h,g};}
function transfer(h,g){const s=wire(h.test.snapshotForPeer(h.peer,null,true));g.test.applySnapshot(s);return s;}
function realRepair(a){
  Object.assign(a.c,{muzzle:u=>u.pos.clone(),clearTo:()=>true,scoreHeal:()=>{},scoreFac:()=>{},REVIVE_NEED:7000,TURRET_REVIVE:7000,SC:{restart:2},addScore:()=>{}});
  a.load('function repairTick(', '// ---- 特別装備 ----');
  a.load('function spRegen(', '// ---- 双肩照射砲');
  vm.runInContext('const postTargets=[units,turrets,radars];',a.c);
}
function facility(a,kind){
  const m=new a.c.T.Mesh();const f={kind,team:'B',pos:new a.c.T.Vector3(0,0,-5),hp:5000,maxHp:10000,alive:true,revive:0,yaw:0,head:new a.c.T.Group(),base:m,baseMat:new a.c.T.MeshBasicMaterial(),parts:[m],body:[m],dish:m,intruders:[]};
  a.c[kind==='turret'?'turrets':'radars'].push(f);a.c.TURRET_BASE=0;a.c.RADAR_BODY=0;return f;
}
for(const kind of ['self','ally','turret','radar'])test('実repairTick→codec→別guest：'+kind,()=>{
  const {h,g}=pair();realRepair(h);
  const key=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].type==='repair');
  for(const a of [h,g])a.equip(a.own,'support','sp',key);
  let target,received;
  if(kind==='self'){target=h.own;received=g.own;target.hp=8000;}
  else if(kind==='ally'){target=h.makeUnit('B:1','support');received=g.makeUnit('B:1','support');target.hp=8000;target.pos.set(0,0,-5);}
  else {target=facility(h,kind);received=facility(g,kind);}
  const before=target.hp,heat=h.own.slots.sp.heat;
  h.c.repairTick(h.own,h.own.slots.sp,.1,kind!=='self',target.pos.clone(),kind==='self');
  assert(target.hp>before);assert(h.own.slots.sp.heat<heat);
  transfer(h,g);
  assert.equal(received.hp,target.hp);assert.equal(g.own.healTarget,received);
  assert(Math.abs(g.own.slots.sp.heat-h.own.slots.sp.heat)<.11);
  h.c.repairTick(h.own,h.own.slots.sp,.1,false,target.pos.clone(),false);transfer(h,g);assert.equal(g.own.healTarget,null);
});
test('設置型修理：実回復/SP消費→生成→破壊を別guestへ反映',()=>{
  const {h,g}=pair();realRepair(h);h.load('function addGadget(', 'function damageGadget(');
  h.load('function postFieldTick(', '// 加速装置');
  const key=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].type==='repairPost');
  h.equip(h.own,'support','sp',key);g.equip(g.own,'support','sp',key);h.own.hp=8000;
  const w=h.own.slots.sp.w,o=h.c.addGadget({kind:'repairPost',owner:h.own,team:'B',pos:h.own.pos.clone(),hp:w.postHp,maxHp:w.postHp,mesh:new h.c.T.Mesh(),field:new h.c.T.Mesh(),spec:w});h.own.post=o;
  h.c.scene.add(o.field);h.c.postFieldTick(o,.1);transfer(h,g);
  assert(g.own.hp>8000);assert(g.own.post);assert.equal(g.own.post.spec,g.c.WEAPONS[key]);assert(g.own.post.field.visible);
  assert(Math.abs(g.own.post.hp-o.hp)<.11);assert(Math.abs(g.own.slots.sp.heat-h.own.slots.sp.heat)<.11);
  h.c.removeGadget(o);transfer(h,g);assert.equal(g.own.post,null);assert.equal(g.c.gadgets.length,0);
});
test('全設置48型：peer選別→codec→別guestの生成/更新/消去',()=>{
  let count=0;
  const {h,g}=pair();
  for(const [key,w] of Object.entries(h.c.WEAPONS)){
    if(!w.proj?.max&&w.type!=='repairPost')continue;
    const spec=w.proj||w,kind=w.type==='repairPost'?'repairPost':spec.kind;
    h.peer.replication=undefined;h.peer.replication={gadgetPolicy:h.test.gadgetPolicyForLoadouts([{sp:key}])};
    // replicationの基礎Mapも本体に作らせるため、この試験では直接スロットAPIを使う。
    const o={gadget:true,alive:true,kind,team:'B',owner:h.own,spec,pos:new h.c.T.Vector3(2,0,3),mesh:new h.c.T.Mesh(),hp:100,maxHp:100};h.c.gadgets.push(o);h.c.scene.add(o.mesh);
    const view={viewer:h.own,visible:new Set(['B:0']),gadgetVisible:()=>true};
    let rows=wire({gadgets:h.test.gadgetSlotsForPeer(h.peer,view)}).gadgets;g.test.applyEquipmentObjects(rows,[]);
    const remote=g.c.gadgets[0];assert.equal(remote.spec,g.c.WEAPONS[key].proj||g.c.WEAPONS[key]);assert.equal(remote.owner,g.own);assert(remote.mesh.parent);
    o.pos.x=7;o.mesh.position.copy(o.pos);o.hp=40;
    rows=wire({gadgets:h.test.gadgetSlotsForPeer(h.peer,view)}).gadgets;g.test.applyEquipmentObjects(rows,[]);assert.equal(remote.hp,40);assert.equal(remote.mesh.position.x,7);
    h.c.gadgets.length=0;g.test.applyEquipmentObjects(h.test.gadgetSlotsForPeer(h.peer,view),[]);assert.equal(g.c.gadgets.length,0);assert(!remote.mesh.parent);count++;
  }
  assert.equal(count,48);
});
const radarKeys=Object.entries(fixture().c.WEAPONS).filter(([,w])=>w.type==='radarTool').map(([k])=>k);
for(const key of radarKeys){
  test('展開レーダー '+key+'：実索敵/半径/解除の往復',()=>{
    const {h,g}=pair();h.equip(h.own,'raid','aux',key);h.load('function radarToolTick(', 'const auxiliaryCur');
    h.c.spot=(team,u,keep)=>h.c.spotted[team].set(u,keep);
    h.enemy.pos.set(0,0,-5);h.c.radarToolTick(h.own,h.own.slots.aux,1,true);
    assert(h.c.spotted.B.has(h.enemy));transfer(h,g);
    assert(g.c.spotted.B.has(g.enemy));assert(g.own.slots.aux.scanRadius>0);
    h.c.radarToolTick(h.own,h.own.slots.aux,.1,false);transfer(h,g);assert.equal(g.own.slots.aux.scanRadius,0);
  });
  const w=fixture().c.WEAPONS[key];
  test('展開レーダー '+key+'：guestの作動波角度がhostと一致',{todo:w.arc!==90?known('監査A1：guestはw.arcを使わずcone||90で固定する'):false},()=>{
    const {h,g}=pair();h.equip(h.own,'raid','aux',key);h.load('function radarToolTick(', 'const auxiliaryCur');h.c.spot=()=>{};
    const host=[],guest=[];h.c.emitReconPulse=(...args)=>host.push(args.slice(1));g.c.emitReconPulse=(...args)=>guest.push(args.slice(1));
    h.c.radarToolTick(h.own,h.own.slots.aux,1,true);transfer(h,g);g.test.guestEquipmentVisuals(.016);
    assert.deepEqual(guest,host);
  });
}
test('持続熱：実visual関数で復元/時間更新/消去、戦闘状態は不変',()=>{
  const a=fixture();Object.assign(a.c,{visualAlloc:f=>f(),heatGeo:new a.c.T.SphereGeometry(),heatCoronaGeo:new a.c.T.SphereGeometry(),heatEmberGeo:new a.c.T.BufferGeometry()});
  a.load('function makeHeatField(', 'function secondaryBurst(');
  const hp=a.own.hp,heat=a.own.slots.sp.heat;
  a.test.applyEquipmentObjects([],[{id:1,type:'heat',team:'B',pos:[1,2,3],radius:8,life:1,age:.1}]);
  const o=a.test.remote().get('o:1');assert.equal(o.mesh.scale.x,8);a.test.guestEquipmentVisuals(.05);assert(Math.abs(o.mesh.material.uniforms.time.value-.15)<1e-9);
  assert.equal(a.own.hp,hp);assert.equal(a.own.slots.sp.heat,heat);a.test.clearRemoteEquipment();assert(!o.mesh.parent);
});
test('修理装置の投擲：ownerの作動状態もguestへ同期',{todo:known('監査A2：postFlight模型は復元するがowner.postFlightは復元しない')},()=>{
  const {h,g}=pair();const key=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].type==='repairPost');h.equip(h.own,'support','sp',key);
  for(const a of [h,g])a.load('function triangleSpecialActive(', 'function triangleThermal(');
  h.own.weapon='main';h.own.postFlight={team:'B',pos:new h.c.T.Vector3(2,3,4),w:h.c.WEAPONS[key],mesh:new h.c.T.Mesh()};
  transfer(h,g);assert([...g.test.remote().values()].some(o=>o.type==='postFlight'&&o.mesh.parent),'投擲模型自体はある');
  assert(h.c.triangleSpecialActive(h.own));assert(g.c.triangleSpecialActive(g.own),'実HUDの特殊装備作動判定も一致する');
});
test('敵センサー：peer別の秘匿/再公開/削除と索敵波の停止',()=>{
  const {h,g}=pair();const key=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].proj?.kind==='sensor');
  h.equip(h.enemy,'support','aux',key);h.enemy.pos.set(500,0,0);
  const o={gadget:true,alive:true,kind:'sensor',team:'R',owner:h.enemy,spec:h.c.WEAPONS[key].proj,pos:new h.c.T.Vector3(500,0,0),mesh:new h.c.T.Mesh(),hp:100,maxHp:100};h.c.gadgets.push(o);
  const other={id:'enemy-peer',unitId:'R:0'};h.game.state.peers.set(other.id,other);
  transfer(h,g);assert.equal(g.c.gadgets.length,0);assert(h.test.snapshotForPeer(other,null,true).gadgets.some(r=>r[0]===0),'R陣営には自軍装置が届く');
  o.pos.x=20;o.mesh.position.copy(o.pos);transfer(h,g);assert.equal(g.c.gadgets.length,1);assert.equal(g.c.gadgets[0].owner,null,'装置の公開から隠れた所有者へ参照を戻さない');
  const first=g.c.gadgets[0],id=first.onlinePublicId;
  const pulses=[];g.c.emitReconPulse=(source)=>pulses.push(source);g.test.guestEquipmentVisuals(.016);assert(pulses.includes(first));
  o.pos.x=500;transfer(h,g);pulses.length=0;g.test.guestEquipmentVisuals(.016);assert.equal(pulses.length,0);assert(!first.mesh.parent);assert(!g.c.hittables.includes(first.mesh));
  o.pos.x=20;transfer(h,g);assert(g.c.gadgets[0].onlinePublicId>id,'再公開には新ID');
  o.alive=false;transfer(h,g);assert.equal(g.c.gadgets.length,0);
});
test('特殊操作5種：guest送信/host重複排除→実関数→codec往復',()=>{
  const {h,g}=pair();Object.assign(h.c,{MAP_SP:['artillery','reflector'],terrainH:()=>0,isLocalView:()=>false,selectWeapon:(u,k)=>{u.weapon=k;},cancelSpawnInvul:()=>{},artillerySurface:p=>({point:p.clone()})});
  h.load('function isArtilleryMode(', 'function artilleryTick(');
  h.load('function reflectorConfirm(', '// trigger：左クリック');
  h.load('function seekModeOk(', 'function gunTick(');
  h.load('function beamCannonMode(', 'function clearBeamCannons(');
  let seq=0;
  const act=(kind,point)=>{
    g.test.sendLocalInput({seq:++seq,lifeId:1,yaw:0,pitch:0,aimPoint:[0,0,-10],keys:{},pressed:{},equipmentActions:[{kind,...(point?{point}: {})}]},false,true);
    const payload=JSON.parse(JSON.stringify(g.sent.at(-1).data)),before=h.peer.actions?.length||0;
    h.test.acceptInputActions(h.peer,payload);h.test.acceptInputActions(h.peer,payload);assert.equal(h.peer.actions.length,before+1);
    h.test.applyEquipmentActions(h.own,h.peer.actions.at(-1));
  };
  for(const type of ['artillery','reflector']){
    const key=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].type===type);h.equip(h.own,'heavy','sp',key);
    act('mapConfirm',[0,0,-10]);assert(type==='reflector'?h.own.reflect:h.own.bombard);transfer(h,g);assert(type==='reflector'?g.own.reflect:g.own.bombard);
    act('mapCancel');assert.equal(h.own.weapon,'main');transfer(h,g);assert.equal(g.own.reflect,null);assert.equal(g.own.bombard,null);
  }
  const beam=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].type==='beamCannon');h.equip(h.own,'assault','sp',beam);h.own.prevWeapon='main';h.own.beamFire={warm:0};act('beamCancel');assert.equal(h.own.beamFire,null);assert.equal(h.own.weapon,'main');
  const scope=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].scopeHigh);h.equip(h.own,'raid','main',scope);h.own.scopeStep=0;
  for(const expected of [1,2,0]){act('scopeCycle');transfer(h,g);assert.equal(g.own.scopeStep,expected);}
  const seek=Object.keys(h.c.WEAPONS).find(k=>h.c.WEAPONS[k].proj?.seek);h.equip(h.own,'heavy','sub',seek);
  for(const expected of [true,false]){act('seekToggle');transfer(h,g);assert.equal(g.own.seekMode,expected);}
});
