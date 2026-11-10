'use strict';
// 失効したHと新しい兵装予約の独立回帰。実sender/receiver・写真codec・H本体を使用。
// 一部は実移動schedulerも通す。移動物理・描画・実通信はfixture。
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {pair}=require('./online_site_transfer_two_sided.test.js');
function activeTransfer(){
  const p=pair();p.host.c.testNow=p.guest.c.testNow=1000;
  p.keyH();p.sync();p.keyH();p.sync();
  assert.equal(p.hu.onlineTransferActionSeq,2);return p;
}
function scheduler(p,seq=20){
  vm.runInContext(p.host.extract(p.host.game,'advanceRemoteCommands','online/game.js'),p.host.c);
  Object.assign(p.host.c,{commandLimits:{dt:1/60,maxFrameSteps:3,catchupSeconds:1,catchupBacklog:10,maxAheadSteps:3},remoteInput:()=>({pressed:{}}),updateHumanMovement:()=>{},recordHostInputStep:()=>{}});
  Object.assign(p.p,{fixedStarted:true,fixedClock:0,catchupClock:0,fixedElapsed:0,lastCommand:null,commandQueue:[{seq,lifeId:p.hu.lifeId,sentAt:p.host.c.testNow,receivedAt:p.host.c.testNow,movePressed:{},keys:{}}]});
  p.host.c.advanceRemoteCommands(p.hu,p.p,1/60);
}
for(const expiry of ['受信前','utility queue内'])test('取消H失効後、新写真で確認した転送へ新兵装を選べる: '+expiry,()=>{
  const p=activeTransfer();
  if(expiry==='受信前')p.setDeferred(true);
  p.input({KeyH:true},{KeyH:true});const h=p.sent.at(-1).actionSeq;
  assert.equal(h,3);p.host.c.testNow=p.guest.c.testNow=1601;
  if(expiry==='受信前'){p.flush();p.setDeferred(false);}else scheduler(p);
  p.sync(1601);assert.ok(p.hu.transfer);assert.ok(p.gu.transfer);
  // 現在も続く転送を、失効後に生成されたホスト写真で確認済み。
  p.guest.c.pickClass('support');p.input();
  assert.equal(p.hu.nextCls,'support','失効した取消Hが、観測済みの現転送で選び直した兵装を妨げない');
  p.sync(1601);assert.equal(p.gu.nextCls,'support');
});
test('失効Hの配送を期限後の写真が追い越しても現転送へ選び直せる',()=>{
  const p=activeTransfer();p.setDeferred(true);p.input({KeyH:true},{KeyH:true});
  p.host.c.testNow=p.guest.c.testNow=1601;p.sync(1601);
  p.guest.c.pickClass('support');p.input();assert.equal(p.gu.onlineClassChoice.transferActionSeq,2);
  p.flush();assert.equal(p.hu.nextCls,'support');
});
test('500ms境界ではまだ実行可能なHを退役させない',()=>{
  const p=activeTransfer();p.input({KeyH:true},{KeyH:true});p.host.c.testNow=p.guest.c.testNow=1500;p.sync(1500);
  p.guest.c.pickClass('support');assert.equal(p.gu.onlineClassChoice.transferActionSeq,3);p.input();
  assert.ok(p.p.pendingClassChoice);scheduler(p);assert.equal(p.hu.transfer,null);assert.equal(p.hu.nextCls,null);
});
test('期限前に作った写真の遅着では新しい開始Hを退役させない',()=>{
  const p=activeTransfer();p.host.c.testNow=p.guest.c.testNow=1400;const old=p.packet(1400);p.host.c.cancelTransfer(p.hu);
  p.host.c.testNow=p.guest.c.testNow=1500;p.input({KeyH:true},{KeyH:true});p.guest.c.testNow=2100;p.receive(old);
  // 届いたのが遅くても、生成時刻はHの期限より前。
  p.guest.c.pickClass('support');assert.equal(p.gu.onlineClassChoice.transferActionSeq,3);
});
test('時計差が途中で変わってもHの期限は送信済みホスト時刻を使う',()=>{
  const p=activeTransfer();p.guest.c.state.transport.clock=()=>({offsetMs:10000});
  p.host.c.testNow=11000;p.input({KeyH:true},{KeyH:true});
  assert.equal(p.guest.c.inputSending.lastHSentAt,11000);p.host.c.testNow=11501;p.guest.c.testNow=2001;
  p.guest.c.state.transport.clock=()=>({offsetMs:9500});
  scheduler(p);p.sync(11501);p.guest.c.pickClass('support');p.input();assert.equal(p.hu.nextCls,'support');
});
test('期限後の写真でも送信済み番号の再送を別のHへ付け替えない',()=>{
  const p=activeTransfer();p.setDeferred(true);p.input({KeyH:true},{KeyH:true});p.guest.c.pickClass('heavy');p.input();
  assert.equal(p.gu.onlineClassChoice.transferActionSeq,3);p.host.c.testNow=p.guest.c.testNow=1601;p.sync(1601);p.input();
  assert.equal(p.sent.at(-1).classChoice.id,1);assert.equal(p.sent.at(-1).classChoice.transferActionSeq,3);
  p.flush();assert.equal(p.hu.nextCls,null);p.setDeferred(false);p.guest.c.pickClass('support');p.input();
  assert.equal(p.hu.nextCls,'support');assert.equal(p.hu.onlineClassChoiceAck,2);
});
test('古いHが先に実行されても保留中の最新兵装を上書きしない',()=>{
  const p=activeTransfer();p.input({KeyH:true},{KeyH:true});p.guest.c.pickClass('heavy');p.input();
  const cancel=p.p.utilityActions[0];p.input({KeyH:true},{KeyH:true});p.guest.c.pickClass('support');p.input();
  assert.equal(p.p.pendingClassChoice.nextCls,'support');
  p.host.c.humanUtilityInput(p.hu,cancel);p.p.utilityActions.shift();assert.equal(p.hu.nextCls,null);
  const start=p.p.utilityActions[0];p.host.c.humanUtilityInput(p.hu,start);p.p.utilityActions.shift();
  assert.equal(p.hu.nextCls,'support');assert.equal(p.hu.onlineClassChoiceAck,2);
});
test('固定stepが0回のframeでは保留Hと兵装を実stepまで保持する',()=>{
  const p=activeTransfer();p.host.c.cancelTransfer(p.hu);p.input({KeyH:true},{KeyH:true});p.guest.c.pickClass('heavy');p.input();
  vm.runInContext(p.host.extract(p.host.game,'advanceRemoteCommands','online/game.js'),p.host.c);
  p.host.c.commandLimits={dt:1/60,maxFrameSteps:3};p.p.commandQueue=[];p.p.fixedStarted=false;p.host.c.advanceRemoteCommands(p.hu,p.p,0);
  assert.ok(p.p.pendingClassChoice);assert.equal(p.hu.nextCls,null);scheduler(p);assert.equal(p.hu.nextCls,'heavy');
});
test('初回遅着した旧lifeの兵装は新しい操作番号でも新lifeを変えない',()=>{
  const p=activeTransfer();p.setDeferred(true);p.guest.c.pickClass('heavy');p.input();
  p.host.c.cancelTransfer(p.hu);p.hu.alive=false;p.host.c.spawn(p.hu);const life=p.hu.lifeId;
  p.flush();assert.equal(p.hu.lifeId,life);assert.equal(p.hu.nextCls,null);assert.equal(p.hu.cls,'assault');
});
test('処理済み兵装番号は新しい操作へ写しても再採用しない',()=>{
  const p=activeTransfer();p.guest.c.pickClass('heavy');p.input();const old=structuredClone(p.sent.at(-1));
  p.host.c.cancelTransfer(p.hu);p.host.c.startTransfer(p.hu);
  p.host.c.acceptInputActions(p.p,{...old,actionSeq:old.actionSeq+1,classChoice:{...old.classChoice,transferActionSeq:0,transferEpoch:p.hu.onlineTransferEpoch}});
  assert.equal(p.hu.nextCls,null);
});
test('再接続の命令初期化で機体上の兵装ACKとH番号を失わない',()=>{
  const p=activeTransfer();p.guest.c.pickClass('heavy');p.input();
  vm.runInContext(p.host.extract(p.host.game,'resetPeerCommands','online/game.js'),p.host.c);p.host.c.resetPeerCommands(p.p);
  assert.equal(p.hu.onlineClassChoiceAck,1);assert.equal(p.hu.onlineProcessedHSeq,2);assert.equal(p.p.pendingClassChoice,null);
  p.sync();p.guest.c.inputSending.actionSeq=0;delete p.guest.c.inputSending.lastHActionSeq;
  p.guest.c.pickClass('support');p.input();assert.equal(p.hu.nextCls,'support');assert.equal(p.hu.onlineClassChoiceAck,2);
});
test('兵装予約の情報は自機の公開枠以外へ載せない',()=>{
  const p=activeTransfer();p.guest.c.pickClass('support');p.input();
  const packed=p.host.c.packUnit(p.hu);
  for(const hidden of [false,true])for(const own of [false,true]){
    const row=p.host.c.fixedUnitForPeer(packed,hidden,1,own);
    if(own&&!hidden)assert.equal(row.classSelection.pending,'support');else assert.equal(row.classSelection,null);
  }
});
test('互換印とtransportの版一致検査で旧版との接続を拒否する',()=>{
  const p=pair();assert.match(p.host.game,/reconnect-1 \/ class-choice-1/);
  assert.match(fs.readFileSync(p.host.source+'/online/transport.js','utf8'),/msg\.appVersion !== this\.appVersion/);
});
test('旧取消写真はACK済み世代だけを消し新しい同兵装選択を残す',()=>{
  const p=activeTransfer();p.guest.c.pickClass('support');p.input();p.host.c.cancelTransfer(p.hu);const terminal=p.packet();
  p.keyH();p.guest.c.pickClass('support');p.receive(terminal);assert.equal(p.gu.onlineClassChoice.id,2);assert.equal(p.gu.nextCls,'support');
  p.input();assert.equal(p.hu.nextCls,'support');
});
