// 実game/codecで可視→秘匿→復旧を確認。描画/RTCの代わりにはしない。
const assert=require('node:assert/strict');
const fixture=require('./online_equipment_fixture');
const f=fixture(),{c,game,test,codec,own,enemy,peer,copy,T}=f;
// この試験では写真は直ちに渡し、未送信キューは存在しない。基準破棄はonline_site_visibility系で検証。
game.state.transport.dropPendingSnapshots=(_id,options)=>{assert.equal(options.details,true);return {count:0,baselines:0};};
c.canSee=(_u,e)=>!e.testHidden;
function snapshot(){return test.encodePeerSnapshot(peer,null,true);}
function decode(w,d){if(w.baseline)assert(d.seed(w.baseline));const s=d.decode(w.wire.delta);assert(s);return s;}
function remote(s){return s.units.find(u=>u.id===enemy.entityId);}
const d=new codec.Decoder();enemy.pos.set(0,0,-100);
// 自機の確定座標は表示用unitの量子化から独立し、ACKでIEEE精度を保持する。
own.pos.set(1/3,Math.PI,-123.456789123);
let w=snapshot(),s=decode(w,d);const visibleBase=copy(peer.replication.encoder.currentBase());
assert.equal(remote(s).hidden,false);
assert.deepEqual(s.inputAcks[own.entityId].pos,own.pos.toArray(),'自機の確定座標を丸めない');
assert.deepEqual(Object.keys(s.inputAcks),[own.entityId],'他機の精密座標ACKを公開しない');
assert(Object.hasOwn(s.units.find(u=>u.id===own.entityId).slots.main,'ammo'));
assert(!Object.hasOwn(remote(s).slots.main,'ammo'));
assert.equal(remote(s).slots.aux.chargeT,enemy.slots.aux.chargeT??null);
const signature=JSON.stringify(visibleBase.s);
// 受け手の履歴が無くてもhideだけで全非公開値を消せる。hidden中の変更はwireに影響しない。
enemy.testHidden=true;enemy.pos.set(300,0,300);game.state.frame++;f.setTime(1100);snapshot();
f.setTime(1150);game.state.frame++;w=snapshot();const independently=new codec.Decoder();assert(independently.seed(visibleBase));s=decode(w,independently);
const hidden=remote(s);assert(hidden.hidden);assert.deepEqual(hidden.pos,[0,0,0]);assert.equal(hidden.equipment,null);assert.equal(hidden.mech,null);assert.equal(hidden.slots.aux.chargeT,null);
assert.equal(w.baseline,null);assert.equal(JSON.stringify(peer.replication.encoder.currentBase().s),signature);
const before=copy(w.wire.delta);enemy.pos.set(999,321,777);enemy.hp=1;enemy.slots.main.ammo=123;enemy.slots.aux.chargeT=.9;enemy.mech.head='private-hidden-head';
assert.deepEqual(copy(snapshot().wire.delta),before,'秘匿中の実位置/残弾/溜め/構成が送信差分に影響しない');
// 秘匿状態での定期patchは中立値の列を再送しない。parent欠落は拒否し完全基準で回復。
f.setTime(12000);game.state.frame++;w=snapshot();assert(w.baseline.parent);assert.equal(w.baseline.s,undefined);
const patched=decode(w,independently);assert.deepEqual(remote(patched),hidden);
const lost=new codec.Decoder();assert.equal(lost.seed(w.baseline),false);assert.equal(lost.decode(w.wire.delta),null);
assert(lost.seed(peer.replication.encoder.currentBase()));assert.deepEqual(remote(lost.decode(w.wire.delta)),hidden);
assert(!JSON.stringify(peer.replication.encoder.currentBase()).includes('private-hidden-head'));
// 完全resyncでも現在の秘密値は収録しない。
w=test.encodePeerSnapshot(peer,null,true,true);assert(!w.baseline.parent);assert(!JSON.stringify(w.baseline).includes('private-hidden-head'));decode(w,lost);
// 別フィールドによるschema更新がhidden中に起きても、新規項目を含めて中立へ。
const changedSchema=copy(w.snapshot);changedSchema.time+=50;changedSchema.extra={test:1};changedSchema.units.find(u=>u.id===enemy.entityId).hiddenExtra=null;
const sw=peer.replication.encoder.encode(changedSchema);assert(sw.baseline.s);assert(lost.seed(sw.baseline));const ss=lost.decode(sw.delta);assert.equal(remote(ss).hiddenExtra,null);assert(remote(ss).hidden);assert.equal(remote(ss).mech,null);
// 再可視化、装備変更、死亡→再出撃を共通基準だけから復元。
enemy.testHidden=false;enemy.pos.set(0,0,-100);enemy.mech.head='standard';enemy.lifeId++;enemy.alive=true;enemy.hp=9000;
f.setTime(12050);game.state.frame++;w=snapshot();s=decode(w,lost);assert(!remote(s).hidden);assert.equal(remote(s).lifeId,2);assert.equal(remote(s).hp,9000);
assert.equal(remote(s).slots.aux.chargeT,.9);
// 被ミサイル捕捉の警告に使う参照は、他機向けの装備選別後も自機へ復元する。
const missile=Object.keys(c.WEAPONS).find(k=>c.WEAPONS[k].missile);
enemy.controlLoadout={...c.CLASSES.heavy,main:missile};c.equip(enemy,'heavy');enemy.weapon='main';enemy.slots.main.missileLocks=[{target:own,life:own.lifeId}];
let missilePacked=test.fixedUnitForPeer(test.packUnit(enemy),false,2,false);
missilePacked.equipment=test.equipmentUnitForPeer(test.packUnit(enemy),{viewer:own,visible:new Set([own.entityId,enemy.entityId]),pointVisible:()=>true});
const remoteCopy={...enemy,slots:Object.fromEntries(c.SLOTS.map(k=>[k,{...enemy.slots[k]}]))};test.applyUnit(remoteCopy,missilePacked);
assert.equal(remoteCopy.slots.main.missileLocks[0].target,own);assert.equal(remoteCopy.slots.main.missileLocks[0].life,own.lifeId);
// 323種すべてで他機用枠を適用し、必須の見た目値が残り、残弾/CDは残らない。
let variants=0;
for(const [cls,slots]of Object.entries(c.ARMORY))for(const [slot,keys]of Object.entries(slots))for(const key of keys){
  enemy.controlLoadout={...c.CLASSES[cls],[slot]:key};c.equip(enemy,cls);enemy.weapon=slot;
  for(const k of c.SLOTS)Object.assign(enemy.slots[k],{ammo:7,cd:.2,chargeT:.4,sheathed:true,heat:31,overheat:false,scanRadius:42});
  const packed=test.fixedUnitForPeer(test.packUnit(enemy),false,2,false);
  const restored={...enemy,slots:Object.fromEntries(c.SLOTS.map(k=>[k,{...enemy.slots[k]}]))};test.applyUnit(restored,packed);
  assert.equal(restored.slots[slot].w.key,key);assert.equal(restored.slots.aux.chargeT,.4);assert.equal(restored.slots.aux.sheathed,true);assert.equal(restored.slots.sp.heat,31);assert.equal(restored.slots.sp.overheat,false);
  for(const k of c.SLOTS){assert.equal(restored.slots[k].scanRadius,42);assert.equal(restored.slots[k].ammo,undefined);assert.equal(restored.slots[k].cd,undefined);}
  variants++;
}
// 施設のnullable項目/侵入者配列の変化、破壊/復旧はschemaを保ち独立復元。
const e=new codec.Encoder(),fd=new codec.Decoder(),fac={time:0,frame:0,plants:[{id:'A',owner:null,gauge:0,capturing:null,contested:false}],turrets:[{hp:100,alive:true,yaw:0,revive:0,team:'B'}],radars:[{hp:100,alive:true,revive:0,headYaw:0,intruders:[]}],barricades:[{hp:100,alive:true}]};
let fw=e.encode(fac);assert(fd.seed(fw.baseline));const schema=JSON.stringify(fw.baseline.s);
fac.time=50;fac.frame++;fac.plants[0].owner='R';fac.plants[0].capturing='B';fac.plants[0].gauge=.125;fac.radars[0].intruders=['R:0'];fac.barricades[0].hp=0;fac.barricades[0].alive=false;
e.encode(fac);fac.time=100;fac.frame++;fac.turrets[0].hp=0;fac.turrets[0].alive=false;fac.turrets[0].yaw=12.345;fw=e.encode(fac);assert(!fw.baseline);assert.deepEqual(fd.decode(fw.delta),fac);assert.equal(JSON.stringify(e.currentBase().s),schema);
fac.time=150;fac.frame++;fac.barricades[0]={hp:100,alive:true};fac.radars[0].intruders=[];fac.plants[0].capturing=null;fw=e.encode(fac);assert.deepEqual(fd.decode(fw.delta),fac);assert(!fw.baseline);
assert.equal(new codec.Decoder().seed({...visibleBase,v:1}),false);assert.equal(d.decode([1,visibleBase.id,'']),null);
const legacyShape={units:[{hidden:true,hp:123}],time:0},le=new codec.Encoder(),ld=new codec.Decoder(),lw=le.encode(legacyShape);assert(ld.seed(lw.baseline));assert.deepEqual(ld.decode(lw.delta),legacyShape,'固定枠でない一般オブジェクトは中立化しない');
console.log(`snapshot削減：秘匿中の非干渉・hide欠落・定期patch・基準欠落/完全復旧・再可視化/再出撃・全${variants}武器の他機表示値・施設破壊復旧・旧codec拒否 成功`);
