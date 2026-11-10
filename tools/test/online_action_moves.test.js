// Cアクションの装備・入力・写真の往復。判定と実ブラウザはaction_moves_check/online_checkで確認する。
const assert=require('node:assert/strict');
const {c,game,test,codec,own,enemy,copy}=require('./online_equipment_fixture')();
assert.deepEqual(copy(game.equipmentOptions().actions.map(a=>a.id)),['crouch','tackle','kick']);
for(const actionId of ['crouch','tackle','kick']){
  const e=test.checkedEquipment({cls:'assault',actionId});assert.equal(e.actionId,actionId);
  assert.equal(test.checkedEquipment({cls:'heavy'},e).actionId,actionId,'兵装変更でもアクションを保持');
}
assert.equal(test.checkedEquipment({cls:'assault'}).actionId,'crouch');
for(const actionId of ['unknown','__proto__',{},4,null])assert.throws(()=>test.checkedEquipment({cls:'assault',actionId}),/アクション/);
own.actionId='tackle';own.actionCd=2.5;own.actionRecoverT=.4;own.actionHeldTime=.1;own.actionWasHeld=true;own.actionLandMiss=false;
own.actionMove={id:'tackle',phase:'move',elapsed:.1,yaw:.2,air:false,hit:false,distance:2};own.actionPush={x:1,z:0,left:3,time:.15};own.actionHitUnits=new Set([enemy]);
const packed=test.packUnit(own);assert(!JSON.stringify(packed).includes('actionHitUnits'));
const visible=test.fixedUnitForPeer(packed,false,1),hidden=test.fixedUnitForPeer(packed,true,1);
assert.equal(hidden.actionId,null);assert.equal(hidden.actionCd,null);assert.equal(hidden.actionMove,null);assert.equal(hidden.actionPush,null);
const encoder=new codec.Encoder(),decoder=new codec.Decoder();let wire=encoder.encode({units:[visible]});assert(decoder.seed(wire.baseline));
let snapshot=decoder.decode(wire.delta);test.applyUnit(enemy,snapshot.units[0]);
assert.equal(enemy.actionId,'tackle');assert.equal(enemy.actionCd,2.5);assert.deepEqual(copy(enemy.actionMove),copy(own.actionMove));assert.deepEqual(copy(enemy.actionPush),copy(own.actionPush));
own.actionMove=null;own.actionPush=null;own.actionCd=1;
wire=encoder.encode({units:[test.fixedUnitForPeer(test.packUnit(own),false,1)]});if(wire.baseline)decoder.seed(wire.baseline);
snapshot=decoder.decode(wire.delta);assert(snapshot);test.applyUnit(enemy,snapshot.units[0]);assert.equal(enemy.actionMove,null);assert.equal(enemy.actionPush,null);assert.equal(enemy.actionCd,1);
const input={seq:1,actionSeq:1,lifeId:1,sentAt:1000,yaw:0,pitch:0,aimPoint:[0,0,-10],keys:{KeyC:true},pressed:{KeyC:true},moveActions:[[1,8]]};
assert(test.validInput(input),'C押下を移動命令の独立IDで運ぶ');assert(!test.validInput({...input,moveActions:[[1,16]]}));
console.log('オンラインアクション：装備3種・不正拒否・写真往復/秘匿・押下ビット 成功');
