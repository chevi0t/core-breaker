'use strict';
// Two actual sender/receiver VMs, snapshot codec, wreck/spawn/transfer and panel
// functions. Rendering, collision geometry, clocks, delivery and ACKs are fixtures.
// This does not test browser input, WebRTC or a real network.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {pair}=require('./online_site_transfer_two_sided.test.js');

function scenario(){
 const p=pair();
 for(const side of [p.host,p.guest]){
  const {c,extract,html,game}=side,elements=new Map();
  Object.assign(c,{testNow:1000,running:true,pressed:{},wheelDir:0,touchPlay:false,
   CLASS_KEYS:Object.keys(c.CLASSES),CLASS_HOTKEYS:['KeyZ','KeyX','KeyC','KeyV'],
   padActive:()=>false,keyName:s=>s,$:id=>{if(!elements.has(id))elements.set(id,{hidden:false,dataset:{},innerHTML:''});return elements.get(id);},
   cores:{B:{hp:10000},R:{hp:10000}},killCore:1,boom:()=>{},KILLCAM:.5,cityBattle:null,curMap:{},
   plants:[{id:'A',owner:'B',pos:new c.T.Vector3(200,0,0)}],SPAWN_BACK:[46,52],resolve:()=>{},terrainH:()=>0});
  Object.assign(c.TEAM.B,{baseX:0,baseZ:1000});
  for(const name of ['plantsFrom','spawnPoints','spawnPos','wreck','respawnPanel'])vm.runInContext(extract(html,name,'index.html'),c);
  vm.runInContext(game.match(/^  const equipmentActionKinds=.*$/m)[0]+extract(game,'validEquipmentAction','online/game.js'),c);
 }
 p.hu.transfer=null;p.hu.downT=0;p.sync();
 const panel=()=>p.guest.c.respawnPanel(p.gu);
 const ack=()=>{p.guest.c.prediction.lastAckActionSeq=p.p.receivedActionSeq||0;};
 const input=(pressed={},keys={})=>{p.input(pressed,keys);ack();};
 const advance=ms=>{p.host.c.testNow+=ms;p.guest.c.testNow+=ms;};
 const wreck=()=>{p.hu.alive=false;p.hu.transfer=null;p.hu.downBy=null;p.host.c.wreck(p.hu);};
 const respawn=()=>{p.host.c.spawn(p.hu,p.hu.spawnChoice);p.sync();input();};
 const checkPlant=()=>{assert.equal(p.hu.spawnChoice,'A');assert(p.hu.pos.distanceTo(p.host.c.plants[0].pos)<70,'actual spawnPos must place the unit by A, not the base');};
 return {...p,panel,ack,input,advance,wreck,respawn,checkPlant};
}

test('unchanged selected plant reaches host and actual spawn on three consecutive deaths',()=>{
 const p=scenario();
 for(let death=1;death<=3;death++){
  p.wreck();p.sync();p.panel();assert.equal(p.gu.spawnChoice,'A');
  const before=p.sent.length;p.input();assert(p.sent.length>before,'death '+death+' must send its unchanged visible selection');
  p.respawn();p.checkPlant();
 }
});

test('downed selection is resent after wreck clears the host choice in the same life',()=>{
 const p=scenario();p.gu.spawnChoice='A';p.hu.alive=false;p.hu.downT=10;p.sync();p.input();
 assert.equal(p.hu.spawnChoice,'A');const life=p.hu.lifeId;
 p.wreck();p.sync();p.panel();p.input();assert.equal(p.hu.lifeId,life);p.respawn();p.checkPlant();
});

for(const base of [true,false])test('unchanged plant reaches a transfer started '+(base?'inside':'outside')+' base',()=>{
 const p=scenario();p.host.c.inOwnBase=()=>base;p.gu.spawnChoice='A';p.input();
 // H selection reaches the host before startTransfer resets it.
 p.input({KeyH:true},{KeyH:true});p.host.c.humanUtilityInput(p.hu,{pressed:{KeyH:true}});
 // Hold H until the first transfer snapshot; there is no release/signature change.
 p.sync();p.panel();p.input({},{KeyH:true});assert.equal(p.hu.spawnChoice,'A');
 p.host.c.doTransfer(p.hu);p.checkPlant();
});

test('transfer cancellation and immediate restart resends even when idle snapshot is missed',()=>{
 const p=scenario();p.host.c.startTransfer(p.hu);p.sync();p.panel();p.input();assert.equal(p.hu.spawnChoice,'A');
 p.host.c.cancelTransfer(p.hu);p.host.c.startTransfer(p.hu); // both between delivered snapshots
 p.sync();p.panel();assert.equal(p.gu.spawnChoice,'A');assert.equal(p.hu.spawnChoice,null);
 p.advance(500);p.input();assert.equal(p.hu.spawnChoice,'A');p.host.c.doTransfer(p.hu);p.checkPlant();
});

test('acknowledged choice is refreshed if the earlier send arrived before the host reset',()=>{
 const p=scenario();p.hu.alive=false;p.hu.downT=0;p.sync();p.panel();p.input();assert.equal(p.hu.spawnChoice,'A');
 p.wreck(); // Guest already has the same respawn mode; no new signature is available.
 p.advance(499);const count=p.sent.length;p.input();assert.equal(p.sent.length,count);
 p.advance(1);p.input();assert.equal(p.sent.length,count+1);assert.equal(p.hu.spawnChoice,'A');
 assert.deepEqual(p.sent.at(-1).pressed,{});p.respawn();p.checkPlant();
});

test('expired reliable selection is retried with a new timestamp and action sequence',()=>{
 const p=scenario();p.wreck();p.sync();p.panel();p.setDeferred(true);p.input();const old=p.sent.at(-1);
 p.advance(501);p.flush();assert.equal(p.hu.spawnChoice,null,'expired selection must be rejected');
 p.setDeferred(false);p.input();const fresh=p.sent.at(-1);
 assert(fresh.actionSeq>old.actionSeq);assert(fresh.sentAt>old.sentAt);p.respawn();p.checkPlant();
});

test('selection heartbeat never replays H, wheel, weapon or equipment activation',()=>{
 const p=scenario();p.host.c.startTransfer(p.hu);p.sync();p.panel();
 const c=p.guest.c;
 c.sendLocalInput({seq:1,keys:{},pressed:{KeyH:true},wheel:1,weapon:'main',equipmentActions:[{kind:'mapConfirm',point:[1,2,3]}],yaw:0,pitch:0,aimPoint:[0,2,0],spawnChoice:'A',nextCls:null},true,true);
 p.ack();p.advance(500);p.input();const latest=p.sent.at(-1);
 assert.deepEqual(latest.pressed,{});assert.equal(latest.wheel,0);assert.equal(latest.weapon,undefined);assert.equal(latest.equipmentActions,undefined);
});

test('selection heartbeat stops in ordinary alive play after acknowledgment',()=>{
 const p=scenario();p.gu.spawnChoice='A';p.input();const before=p.sent.length;p.advance(5000);p.input();assert.equal(p.sent.length,before);
});

test('spawn-only refresh does not restore a canceled class after a missed restart snapshot',()=>{
 const p=scenario();p.host.c.startTransfer(p.hu);p.sync();p.panel();p.guest.c.pickClass('heavy');p.input();
 assert.equal(p.hu.nextCls,'heavy');p.host.c.cancelTransfer(p.hu);p.host.c.startTransfer(p.hu);
 p.sync();p.panel();assert.equal(p.gu.nextCls,'heavy','known stale local reservation is deliberately present');assert.equal(p.hu.nextCls,null);
 p.advance(500);p.input();assert.equal(p.sent.at(-1).nextCls,undefined);assert.equal(p.hu.spawnChoice,'A');assert.equal(p.hu.nextCls,null);
 p.host.c.doTransfer(p.hu);assert.equal(p.hu.cls,'assault');p.checkPlant();
});

test('spawn-only mode change does not restore a previously canceled class on death',()=>{
 const p=scenario();p.host.c.startTransfer(p.hu);p.sync();p.panel();p.guest.c.pickClass('heavy');p.input();
 p.host.c.cancelTransfer(p.hu);p.wreck();p.sync();p.panel();p.input();
 assert.equal(p.sent.at(-1).nextCls,undefined);assert.equal(p.hu.nextCls,null);p.respawn();assert.equal(p.hu.cls,'assault');p.checkPlant();
});

test('a deliberate new class choice is still sent immediately while refreshing spawn choice',()=>{
 const p=scenario();p.wreck();p.sync();p.panel();p.input();p.advance(500);p.input();
 p.guest.c.pickClass('support');p.input();assert.equal(p.hu.nextCls,'support');assert.equal(p.sent.at(-1).nextCls,'support');
 p.respawn();assert.equal(p.hu.cls,'support');p.checkPlant();
});

test('retry of an unacknowledged spawn-only refresh still excludes the canceled class',()=>{
 const p=scenario();p.host.c.startTransfer(p.hu);p.sync();p.panel();p.guest.c.pickClass('heavy');p.input();
 p.host.c.cancelTransfer(p.hu);p.host.c.startTransfer(p.hu);p.sync();p.panel();p.advance(500);
 p.guest.c.prediction.lastAckActionSeq=p.p.receivedActionSeq;
 p.guest.c.stepLocalCommands({keys:{},pressed:{},yaw:0,pitch:0,aimPoint:[0,2,0]},0); // Receive, but lose ACK.
 assert.equal(p.sent.at(-1).nextCls,undefined);p.advance(500);
 p.guest.c.stepLocalCommands({keys:{},pressed:{},yaw:0,pitch:0,aimPoint:[0,2,0]},0);
 assert.equal(p.sent.at(-1).nextCls,undefined);assert.equal(p.hu.nextCls,null);p.host.c.doTransfer(p.hu);assert.equal(p.hu.cls,'assault');p.checkPlant();
});

test('new unacknowledged class choice survives a selector transition and an expired original send',()=>{
 const p=scenario();p.hu.alive=false;p.hu.downT=10;p.sync();p.setDeferred(true);p.guest.c.pickClass('support');p.input();
 p.advance(100);p.wreck();p.sync();p.panel();p.input();assert.equal(p.sent.at(-1).nextCls,'support','pending class must accompany fresh selector update');
 p.advance(450);p.flush();assert.equal(p.hu.nextCls,'support','original send expired, but the fresh selection is accepted');
 p.setDeferred(false);p.respawn();assert.equal(p.hu.cls,'support');p.checkPlant();
});

test('new selection is sent immediately, and duplicate or old-life actions cannot revert it',()=>{
 const p=scenario();p.wreck();p.sync();p.panel();p.input();const old=p.sent.at(-1);
 p.gu.spawnChoice='base';p.input();assert.equal(p.hu.spawnChoice,'base');
 p.host.c.acceptInputActions(p.p,old);assert.equal(p.hu.spawnChoice,'base');p.respawn();
 p.wreck();p.sync();p.gu.spawnChoice='A';p.panel();p.input();
 p.host.c.acceptInputActions(p.p,{...old,actionSeq:p.sent.at(-1).actionSeq+100,sentAt:p.host.c.testNow});
 assert.equal(p.hu.spawnChoice,'A');p.respawn();p.checkPlant();
});

test('captured plant is rejected, panel falls back, and recapture can be selected again',()=>{
 const p=scenario();p.wreck();p.sync();p.panel();p.input();
 p.host.c.plants[0].owner='R';p.guest.c.plants[0].owner='R';p.panel();assert.equal(p.gu.spawnChoice,'base');p.input();assert.equal(p.hu.spawnChoice,'base');
 p.gu.spawnChoice='A';p.input();assert.equal(p.hu.spawnChoice,'base','host must reject an unavailable plant');
 p.host.c.plants[0].owner='B';p.guest.c.plants[0].owner='B';p.advance(500);p.panel();p.input();p.respawn();p.checkPlant();
});

test('lost death snapshot still works when the latest snapshot eventually arrives',()=>{
 const p=scenario();p.gu.spawnChoice='A';p.input();p.wreck();p.packet();p.packet();p.sync();p.panel();p.input();p.respawn();p.checkPlant();
});

test('delayed snapshot does not overwrite a newer unsent local plant choice',()=>{
 const p=scenario();p.wreck();const delayed=p.packet();p.gu.spawnChoice='A';p.receive(delayed);p.panel();assert.equal(p.gu.spawnChoice,'A');p.input();p.respawn();p.checkPlant();
});

test('host-local respawn and transfer selection paths remain usable',()=>{
 const p=scenario(),c=p.host.c;c.player=p.hu;p.hu.localView=true;p.hu.controller='localHuman';
 p.wreck();c.respawnPanel(p.hu);c.spawn(p.hu,p.hu.spawnChoice);p.checkPlant();
 p.hu.onGround=true;c.startTransfer(p.hu);c.respawnPanel(p.hu);c.doTransfer(p.hu);p.checkPlant();
});
