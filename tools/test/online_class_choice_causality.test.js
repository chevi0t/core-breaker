'use strict';
// 実sender/receiverとH本体を2つのVMで検査。末尾3件は実移動schedulerも使う。描画/物理/実RTCは代役。
const test=require('node:test'),assert=require('node:assert/strict');
const {pair}=require('./online_site_transfer_two_sided.test.js');
function executeH(p,id){
 const action=p.p.utilityActions.find(a=>a.actionSeq===id);
 assert(action,'H must be queued before execution');
 p.host.c.humanUtilityInput(p.hu,action);
 p.p.utilityActions=p.p.utilityActions.filter(a=>a!==action);
}
function queueH(p){p.input({KeyH:true},{KeyH:true});return p.sent.at(-1).actionSeq;}

test('delayed first choice cannot enter a host-started later transfer in the same life',()=>{
 const p=pair();p.setDeferred(true);p.guest.c.pickClass('heavy');p.input();
 p.host.c.cancelTransfer(p.hu);p.host.c.startTransfer(p.hu);p.flush();
 assert.equal(p.hu.nextCls,null);p.sync();assert.equal(p.gu.nextCls,null);
});

test('an expired first choice is not revived by a resend after a newer H transfer',()=>{
 const p=pair();p.guest.c.testNow=1000;p.host.c.testNow=1000;p.setDeferred(true);p.guest.c.pickClass('heavy');p.input();
 p.host.c.cancelTransfer(p.hu);p.host.c.testNow=1600;p.guest.c.testNow=1600;p.flush();assert.equal(p.hu.onlineClassChoiceAck,undefined);
 p.setDeferred(false);p.keyH();p.sync(); // 新選択の前にHで古い手元予約を消す。
 assert.equal(p.hu.nextCls,null);assert.equal(p.gu.nextCls,null);
 const stale=p.sent.find(x=>x.classChoice);p.host.c.acceptInputActions(p.p,{...stale,sentAt:1600,actionSeq:p.p.receivedActionSeq+1});
 assert.equal(p.hu.nextCls,null);
});

test('new pre-snapshot choice waits for its queued start H and then commits exactly once',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);const terminal=p.packet();
 const h=queueH(p);p.guest.c.pickClass('support');p.input();
 assert.equal(p.hu.nextCls,null);assert.equal(p.hu.onlineClassChoiceAck,undefined);assert(p.p.pendingClassChoice);
 p.receive(terminal);assert.equal(p.gu.nextCls,'support');
 executeH(p,h);assert.equal(p.hu.nextCls,'support');assert.equal(p.hu.onlineClassChoiceAck,1);assert.equal(p.p.pendingClassChoice,undefined);
 const slot=p.hu.controlLoadout; // 実receiverが重複配送を拒否する。
 p.host.c.acceptInputActions(p.p,p.sent.at(-1));assert.equal(p.hu.controlLoadout,slot);
});

test('choice bound to a queued cancellation H is retired rather than used by a later transfer',()=>{
 const p=pair();const h=queueH(p);p.guest.c.pickClass('heavy');p.input();assert(p.p.pendingClassChoice);
 executeH(p,h);assert.equal(p.hu.transfer,null);assert.equal(p.hu.nextCls,null);assert.equal(p.hu.onlineClassChoiceAck,1);
 p.host.c.startTransfer(p.hu);p.sync();p.input();assert.equal(p.hu.nextCls,null);
});

test('failed H start consumes its choice so retry cannot apply it later',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);p.hu.onGround=false;const h=queueH(p);p.guest.c.pickClass('heavy');p.input();
 executeH(p,h);assert.equal(p.hu.transfer,null);assert.equal(p.hu.nextCls,null);assert.equal(p.hu.onlineClassChoiceAck,1);
 p.hu.onGround=true;p.host.c.startTransfer(p.hu);p.sync();p.input();assert.equal(p.hu.nextCls,null);
});

test('only the newest choice waiting for the same H is applied',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);const h=queueH(p);
 p.guest.c.pickClass('heavy');p.input();p.guest.c.pickClass('support');p.input();
 executeH(p,h);assert.equal(p.hu.nextCls,'support');assert.equal(p.hu.onlineClassChoiceAck,2);
});

test('death between choice receipt and H execution cannot convert transfer intent to death intent',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);const h=queueH(p);p.guest.c.pickClass('heavy');p.input();
 p.hu.alive=false;p.hu.onlineLagEpoch=1;executeH(p,h);
 assert.equal(p.hu.nextCls,null);assert.equal(p.hu.onlineClassChoiceAck,1);
});

test('expired pending choice is not applied when the H eventually executes',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);const h=queueH(p);p.guest.c.pickClass('heavy');p.input();
 p.host.c.testNow=1601;executeH(p,h);assert.equal(p.hu.nextCls,null);assert.equal(p.p.pendingClassChoice,undefined);
});

test('reconnected sender starts after the host H watermark and can make a fresh choice',()=>{
 const p=pair();p.hu.onlineProcessedHSeq=40;p.hu.onlineTransferActionSeq=40;p.hu.onlineTransferEpoch=7;p.sync();
 p.guest.c.inputSending.actionSeq=0;delete p.guest.c.inputSending.lastHActionSeq;
 p.keyH();assert(p.sent.at(-1).actionSeq>40);p.keyH();
 p.guest.c.pickClass('support');p.input();assert.equal(p.hu.nextCls,'support');
});

test('a host-started observed transfer does not inherit an older locally sent H origin',()=>{
 const p=pair();p.keyH();p.host.c.startTransfer(p.hu);p.sync();
 p.guest.c.pickClass('heavy');p.input();assert.equal(p.hu.nextCls,'heavy');
});

test('an observed transfer can be selected after a late old terminal snapshot without losing new intent',()=>{
 const p=pair();p.keyH();const terminal=p.packet();p.keyH();p.guest.c.pickClass('heavy');
 p.receive(terminal);assert.equal(p.gu.nextCls,'heavy');p.input();assert.equal(p.hu.nextCls,'heavy');
});

test('an expired H removed from the utility queue retires its pending class ACK',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);queueH(p);p.guest.c.pickClass('support');p.input();
 p.host.c.testNow=1601;p.p.utilityActions=[];p.host.c.retirePendingClassChoice(p.hu,p.p);
 assert.equal(p.p.pendingClassChoice,undefined);assert.equal(p.hu.onlineClassChoiceAck,1);
 p.sync();assert.equal(p.gu.nextCls,null);
});

test('a class is resent until its own ACK even after cumulative control ACK advances',()=>{
 const p=pair();p.host.c.testNow=1000;p.guest.c.testNow=1000;p.setDeferred(true);p.guest.c.pickClass('support');p.input();
 p.guest.c.prediction.lastAckActionSeq=100;p.guest.c.testNow=1500;p.host.c.testNow=1500;p.input();
 assert.equal(p.sent.at(-1).nextCls,'support');assert.equal(p.sent.at(-1).classChoice.id,1);
 p.flush();assert.equal(p.hu.nextCls,'support');
});

function runHostStep(p,seq=20){
 require('node:vm').runInContext(p.host.extract(p.host.game,'advanceRemoteCommands','online/game.js'),p.host.c);
 Object.assign(p.host.c,{commandLimits:{dt:1/60,maxFrameSteps:3,catchupSeconds:1,catchupBacklog:10,maxAheadSteps:3},remoteInput:()=>({pressed:{}}),updateHumanMovement:()=>{},recordHostInputStep:()=>{}});
 Object.assign(p.p,{fixedStarted:true,fixedClock:0,catchupClock:0,fixedElapsed:0,lastCommand:null,commandQueue:[{seq,lifeId:p.hu.lifeId,sentAt:p.host.c.testNow||1000,receivedAt:p.host.c.testNow||1000,movePressed:{},keys:{}}]});
 p.host.c.advanceRemoteCommands(p.hu,p.p,1/60);
}
test('actual movement scheduler executes pending start H and commits class',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);p.input({KeyH:true},{KeyH:true});
 p.guest.c.pickClass('support');p.input();assert.ok(p.p.pendingClassChoice);runHostStep(p);
 assert.equal(p.hu.nextCls,'support');assert.equal(p.hu.onlineClassChoiceAck,1);assert.equal(p.p.pendingClassChoice,undefined);assert.equal(p.p.utilityActions.length,0);
 runHostStep(p,21);assert.equal(p.hu.nextCls,'support');assert.ok(p.hu.transfer);
});
test('actual movement scheduler retires expired pending H and choice',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);p.input({KeyH:true},{KeyH:true});
 p.guest.c.pickClass('support');p.input();assert.ok(p.p.pendingClassChoice);p.host.c.testNow=1601;runHostStep(p);
 assert.equal(p.hu.nextCls,null);assert.equal(p.hu.onlineClassChoiceAck,1);assert.equal(p.p.pendingClassChoice,undefined);assert.equal(p.p.utilityActions.length,0);p.sync();assert.equal(p.gu.nextCls,null);
});
test('actual scheduler failed start retires choice without equipment change',()=>{
 const p=pair();p.host.c.cancelTransfer(p.hu);p.input({KeyH:true},{KeyH:true});p.guest.c.pickClass('support');p.input();p.hu.onGround=false;runHostStep(p);
 assert.equal(p.hu.nextCls,null);assert.equal(p.hu.onlineClassChoiceAck,1);assert.equal(p.p.pendingClassChoice,undefined);assert.equal(p.hu.transfer,null);
});
