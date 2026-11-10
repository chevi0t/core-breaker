// WebGL/通信なしで製品game.jsのack境界・巻き直しを検査する。
// 移動の代役は線形積分（physics自体の一致はonline_movement.test.jsが検査）。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const codec=require('../../prototype/online/codec');
const copy=x=>JSON.parse(JSON.stringify(x)),empty=()=>{};
class V3 {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  fromArray(a){[this.x,this.y,this.z]=a;return this;}
  toArray(){return [this.x,this.y,this.z];}
  copy(v){return this.fromArray(v.toArray());}
  clone(){return new V3().copy(this);}
  add(v){return this.addScaledVector(v,1);}
  addScaledVector(v,n){this.x+=v.x*n;this.y+=v.y*n;this.z+=v.z*n;return this;}
  multiplyScalar(n){this.x*=n;this.y*=n;this.z*=n;return this;}
  distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;}
}
function harness(enabled=true){
  let time=0;const calls=[],sent=[],elements=new Map();
  const makeUnit=id=>({entityId:id,team:id.split(':')[0],cls:'assault',name:id,lifeId:1,alive:true,hp:100,downT:0,pos:new V3(),vel:new V3(),yaw:0,pitch:0,boost:100,slots:{},sc:{total:0},group:{visible:true},controller:'localHuman'});
  const units=[makeUnit('B:0'),makeUnit('R:0')];let renderedCamera=null;
  const c={MAPS:{mesa:{name:'台地',team:5,time:300}},T:{Vector3:V3},performance:{now:()=>time},Map,Set,Date,Math,console,setTimeout,clearTimeout,CBOnlineCodec:codec,
    window:{},SLOTS:[],WEAPONS:{},CLASSES:{assault:{},heavy:{}},units,player:units[0],running:true,ended:false,timeLeft:300,cores:{B:{hp:1000},R:{hp:1000}},spotted:{B:new Map(),R:new Map()},spotSrc:{B:new Map(),R:new Map()},plants:[],turrets:[],radars:[],barricades:[],lifts:[],jumpPads:[],catapults:[],ziplines:[],shells:[],
    document:{exitPointerLock:empty},$:id=>{if(!elements.has(id))elements.set(id,{querySelector:()=>null});return elements.get(id);},wrapAngle:x=>Math.atan2(Math.sin(x),Math.cos(x)),
    showPage:empty,stopLoopingGameSounds:empty,bgmTick:empty,tutorialClearInput:empty,setSimulationRole:empty,addEventListener:empty,weaponLook:empty,tracer:empty,boom:empty,impact:empty,sfx:empty,shot:empty,shoot:empty,blast:empty,damage:empty,finish:empty,SFX:{},scene:{remove:empty,add:empty},
    // 機体変更時の製品rebuildも通す。ここでは形状は代役で、WebGLの検証はブラウザ試験が担当。
    TEAM:{B:{color:0},R:{color:0}},hittables:[],refOf:o=>o.userData?.ref,disposeMech:empty,buildMech:()=>({g:{position:new V3(),rotation:{},traverse:empty,visible:true}}),
    keys:{},lock:{visible:false},wheelDir:0,updateLocalHumanAim:()=>({aim:new V3()}),
    collectLocalInput:u=>({keys:{KeyW:true},pressed:{},yaw:u.yaw,pitch:u.pitch,aimPoint:[0,0,-100]}),
    predictHumanMovement(u,input,dt){
      if(!u.alive||u.onlinePredictionBlocked)return false;
      calls.push({seq:input.seq,dt,pressed:{...input.pressed}});
      u.yaw=input.yaw;u.pitch=input.pitch;
      if(input.keys?.KeyW)u.pos.x+=10*dt;
      if(input.pressed?.Space){u.vel.y=10;u.boost-=10;}
      return true;
    },
    updateHumanUnit(u,input,dt){u.pos.x+=10*dt;return false;},
    renderView(){renderedCamera=c.camera.position.clone();},updateCamera(u){c.camera.position.copy(u.pos);},fwdOf:()=>new V3(0,0,-1),spawnPoints:()=>[],camera:{position:new V3(),updateMatrixWorld:empty}};
  vm.createContext(c);
  let source=fs.readFileSync(require.resolve('../../prototype/online/game'),'utf8');
  source=source.replace('  window.CBOnlineGame={create',`  window.__predictionTest={resetPrediction,clearPrediction,capturePredictionView,predictLocalInput,reconcilePrediction,applySnapshot,applyUnit,recordHostInputStep,acceptInput,acceptInputBatch,acceptInputActions,sendLocalInput,decayPredictionVisual,receiveSnapshot,handleSnapshotControl,onMessage,
    getPrediction:()=>prediction,
    reset:enabled=>{resetMeasurements();resetPrediction(enabled);prepared=true;state.role='guest';state.phase='playing';state.matchId='test';state.localUnitId='B:0';},
    finish:s=>receiveMatchEnded(s)};
  window.CBOnlineGame={create`);
  vm.runInContext(source,c);const game=c.window.CBOnlineGame,test=c.window.__predictionTest;
  test.reset(enabled);game.state.transport={send:(type,data,id)=>{sent.push({type,data:copy(data),id,time});return true;},metrics:()=>({}),close:empty};
  return {game,test,c,calls,sent,units,renderedCamera:()=>renderedCamera,at:t=>time=t};
}
const input=(seq,pressed={})=>({seq,lifeId:1,sentAt:0,actionSeq:0,keys:{KeyW:true},pressed,yaw:0,pitch:0,aimPoint:[0,0,-100],trigger:true});
function snapshot(h,frame=1,overrides={},ack={seq:0,step:0,seqDt:0,totalDt:0,steps:[]}){
  const s=h.game.snapshot();s.frame=frame;s.inputAcks={'B:0':ack};s.acks={'B:0':ack.seq};Object.assign(s.units[0],overrides);return copy(s);
}
function reconcile(h,s){const previous=h.test.capturePredictionView();h.test.applySnapshot(s);h.test.reconcilePrediction(s,previous);}
function approx(actual,expected){assert(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);}
{
  const h=harness();reconcile(h,snapshot(h));
  h.test.predictLocalInput({...input(1,{Space:true}),actionSeq:1},.03);h.test.predictLocalInput(input(2),.02);
  approx(h.units[0].pos.x,.5);assert.equal(h.units[0].boost,90);assert.equal(h.units[1].pos.x,0);
  const health=h.units[0].hp,score=copy(h.units[0].sc),calls=h.calls.length;
  // hostはseq1を10msだけ実行。残り20msは押下なし、seq2は未確定の20ms。
  reconcile(h,snapshot(h,2,{pos:[.1,0,0],boost:90,vel:[0,10,0]}, {seq:1,step:1,seqDt:.01,actionSeq:1,totalDt:.01,steps:[{step:1,seq:1,dt:.01,seqDt:.01,pressed:['Space']}]}));
  approx(h.units[0].pos.x,.5);assert.equal(h.units[0].boost,90);
  approx(h.calls[calls].dt,.02);assert.deepEqual(h.calls[calls].pressed,{});approx(h.calls[calls+1].dt,.02);
  assert.equal(h.game.metrics().prediction.partialAcks,1);assert.equal(h.units[0].hp,health);assert.deepEqual(copy(h.units[0].sc),score);
  // 同seq1の確定累積dtが伸びた写真。写真以前の10+20msを再実行せずseq2だけ残す。
  reconcile(h,snapshot(h,3,{pos:[.3,0,0],boost:90}, {seq:1,step:2,seqDt:.03,actionSeq:1,totalDt:.03,steps:[{step:1,seq:1,dt:.01,seqDt:.01,pressed:['Space']},{step:2,seq:1,dt:.02,seqDt:.03,pressed:[]}]}));
  approx(h.units[0].pos.x,.5);assert.equal(h.game.metrics().prediction.pendingInputs,1);assert.equal(h.game.metrics().prediction.hostStepSamples,2);
  reconcile(h,snapshot(h,4,{pos:[.5,0,0]}, {seq:2,step:3,seqDt:.02,actionSeq:1,totalDt:.05,steps:[{step:3,seq:2,dt:.02,seqDt:.02,pressed:[]}]}));
  assert.equal(h.game.metrics().prediction.pendingInputs,0);approx(h.game.metrics().prediction.confirmedHostSeconds,.05);
}
{
  const h=harness(),p={id:'g',unitId:'R:0',receivedSeq:0,appliedSeq:0,last:0,pendingEdges:{}};
  h.game.state.role='host';h.game.state.peers.set('g',p);Object.assign(h.units[1],{controller:'remoteHuman',ownerPeerId:'g'});
  h.test.acceptInput(p,{...input(1,{Space:true}),dt:9000});h.test.acceptInput(p,{...input(2),dt:1e9});
  assert.equal(p.input.dt,undefined);assert.equal(p.appliedSeq,0);assert.equal(p.pendingEdges.Space,undefined);
  h.test.acceptInputActions(p,{...input(1,{Space:true}),actionSeq:1});assert.equal(p.actions[0].pressed.Space,true);
  // remoteInputを取得しただけではackしない。実updateがfalse（非射撃）を返しても適用記録する。
  const oldInput=h.game.remoteInput(h.units[1]);assert.equal(oldInput.pressed.Space,true);h.c.updateHumanUnit(h.units[1],oldInput,.011234567);
  h.c.updateHumanUnit(h.units[1],{...p.input,pressed:{}},.023456789);
  assert.equal(p.appliedSeq,2);approx(p.appliedSeqDt,.034691356);assert.equal(p.appliedStep,2);approx(h.units[1].pos.x,.34691356);
  assert.deepEqual(copy(p.appliedSteps.map(x=>x.pressed)),[['Space'],[]]);
  const raw=h.game.snapshot(),encoder=new codec.Encoder(),decoder=new codec.Decoder(),wire=encoder.encode(raw);assert(decoder.seed(wire.baseline));
  assert.deepEqual(decoder.decode(wire.delta).inputAcks,copy(raw.inputAcks));
  for(let i=0;i<200;i++)h.c.updateHumanUnit(h.units[1],{...input(3),pressed:{}},.016);
  assert.equal(p.appliedSteps.length,120);assert.equal(h.game.snapshot().inputAcks['R:0'].steps,undefined);
}
{
  const h=harness();reconcile(h,snapshot(h));h.test.predictLocalInput(input(1),.02);
  reconcile(h,snapshot(h,2,{pos:[.3,0,0]}, {seq:1,step:1,seqDt:.02,totalDt:.02,steps:[]}));
  approx(h.units[0].pos.x,.3);approx(h.units[0].onlineVisualOffset.x,-.1);
  h.c.updateCamera(h.units[0]);approx(h.c.camera.position.x,.3);h.c.renderView();approx(h.renderedCamera().x,.2);approx(h.c.camera.position.x,.3);approx(h.units[0].pos.x,.3);
  for(let i=0;i<6;i++)h.test.decayPredictionVisual();assert.equal(h.units[0].onlineVisualOffset,undefined);
  reconcile(h,snapshot(h,3,{pos:[20,0,0]}));assert.equal(h.game.metrics().prediction.hardSnapReasons.distance,1);assert.equal(h.units[0].onlineVisualOffset,undefined);
}
for(const [patch,reason]of [[{lifeId:2},'respawn'],[{alive:false},'down'],[{stun:'stagger',stunT:.5},'stun'],[{stun:'down',stunT:1},'down'],[{flying:true},'catapult'],[{jumpPadIndex:0},'jumpPad'],[{electricT:1},'electric'],[{shockT:1},'shock'],[{motionEpoch:1},'transfer'],[{predictionBlocked:'lift'},'lift']]){
  const h=harness();reconcile(h,snapshot(h));h.test.predictLocalInput(input(1),.02);
  reconcile(h,snapshot(h,2,{...patch,pos:[.1,0,0]}));
  approx(h.units[0].pos.x,.1);assert.equal(h.game.metrics().prediction.hardSnapReasons[reason],1);assert.equal(h.game.metrics().prediction.pendingInputs,0);assert.equal(h.units[0].onlineVisualOffset,undefined);
}
{
  const h=harness();h.c.player.alive=false;
  for(let i=1;i<=5000;i++)h.test.predictLocalInput(input(i),.016);
  const m=h.game.metrics().prediction;assert(m.pendingInputs<=240);assert(m.pendingSeconds<=1);assert(m.droppedInputs>0);assert.equal(m.predictedSteps,0);
  h.test.clearPrediction();assert.equal(h.game.metrics().prediction.pendingInputs,0);assert.equal(h.test.getPrediction().hostSteps.length,0);
  h.test.reset(false);assert.equal(h.test.predictLocalInput(input(1),.016),false);assert.equal(h.game.metrics().prediction.pendingInputs,0);
  h.test.reset(true);assert.equal(h.game.metrics().prediction.correctionCount,0);
}
for(const enabled of [false,true]){
  const h=harness(enabled);h.at(100);h.game.state.lastHost=100;
  h.game.beforeFrame(1/60,100);h.game.afterFrame(1/60,100);
  assert.equal(h.sent[0].type,'inputActions');assert.equal(h.sent[1].type,'inputBatch');assert.equal(h.sent[1].data.inputs[0].dt,undefined);
  if(enabled){approx(h.units[0].pos.x,10/60);assert.equal(h.game.metrics().inputLatency.length,1);assert.equal(h.game.metrics().inputLatency[0],0);}
  else {assert.equal(h.units[0].pos.x,0);assert.equal(h.game.metrics().inputLatency.length,0);}
}
{
  const h=harness(),e=new codec.Encoder();
  const deliver=s=>{const w=e.encode(s);if(w.baseline)h.test.handleSnapshotControl('snapshotBase',w.baseline);h.test.receiveSnapshot({frame:s.frame,delta:w.delta});return {frame:s.frame,delta:w.delta};};
  const old=deliver(snapshot(h,1));h.test.predictLocalInput(input(1),.02);deliver(snapshot(h,2,{pos:[.2,0,0]},{seq:1,step:1,seqDt:.02,totalDt:.02,steps:[]}));
  const count=h.game.metrics().prediction.reconciliations;h.test.receiveSnapshot(old);assert.equal(h.game.metrics().prediction.reconciliations,count);
  h.test.predictLocalInput(input(2),.02);const result={matchId:'test',frame:3,timeLeft:0,cores:{B:1000,R:0},units:h.units.map(u=>({id:u.entityId,name:u.name,cls:u.cls,sc:{total:0}}))};
  h.test.finish(result);assert.equal(h.game.state.phase,'ended');assert.equal(h.game.metrics().prediction.pendingInputs,0);assert.equal(h.units[0].onlineVisualOffset,undefined);
  h.test.reset();h.test.predictLocalInput(input(1),.02);h.game.leave();assert.equal(h.game.state.role,'offline');assert.equal(h.game.metrics().prediction.pendingInputs,0);
}
// movementとcontrolの到着順が逆でも、独立action ackまで予測押下を失わない。
{
  const h=harness();reconcile(h,snapshot(h));
  h.test.predictLocalInput({...input(1,{Space:true}),actionSeq:1},.02);
  h.test.predictLocalInput({...input(2),actionSeq:1},.02);
  reconcile(h,snapshot(h,2,{pos:[.4,0,0],boost:100},{seq:2,step:2,seqDt:.02,actionSeq:0,totalDt:.04,steps:[]}));
  assert.equal(h.game.metrics().prediction.pendingInputs,0);assert.equal(h.game.metrics().prediction.pendingActions,1);assert.equal(h.units[0].boost,100);
  h.test.predictLocalInput({...input(3),actionSeq:1},.02);assert.equal(h.units[0].boost,90);assert.equal(h.calls.at(-1).pressed.Space,true);
  reconcile(h,snapshot(h,3,{pos:[.6,0,0],boost:90},{seq:3,step:3,seqDt:.02,actionSeq:1,totalDt:.06,steps:[]}));
  assert.equal(h.game.metrics().prediction.pendingActions,0);h.test.predictLocalInput({...input(4),actionSeq:1},.02);assert.equal(h.units[0].boost,90);
}
{
  const h=harness(),p={id:'g',unitId:'R:0',receivedSeq:0,appliedSeq:0,last:0,pendingEdges:{}};
  h.game.state.role='host';h.game.state.peers.set('g',p);Object.assign(h.units[1],{controller:'remoteHuman',ownerPeerId:'g'});
  const move=seq=>({...input(seq),actionSeq:2});
  // control先着はmovementを待ち、取得だけでは消化されない。
  h.test.acceptInputActions(p,{...input(3,{Space:true}),actionSeq:1,trigger:true});
  h.test.acceptInputBatch(p,{inputs:[move(1),move(2)]});assert.equal(h.game.remoteInput(h.units[1]).pressed.Space,undefined);assert.equal(p.actions.length,1);
  h.test.acceptInputBatch(p,{inputs:[move(5),move(4),move(3),move(2),move(1)]});assert.equal(p.receivedSeq,5);
  h.test.acceptInputBatch(p,{inputs:[move(1),move(2),move(3)]});assert.equal(p.receivedSeq,5);
  let actual=h.game.remoteInput(h.units[1]);assert.equal(actual.pressed.Space,true);assert.equal(actual.trigger,true);assert.equal(p.appliedActionSeq,undefined);
  h.c.updateHumanUnit(h.units[1],actual,.016);assert.equal(p.appliedActionSeq,1);assert.equal(p.actions.length,0);
  h.test.acceptInputActions(p,{...input(3,{Space:true}),actionSeq:1,trigger:true});assert.equal(p.actions.length,0);
  // batchが新しいrelease action番号を告げたら、control到着待ちに古いtriggerを保持しない。
  assert.equal(h.game.remoteInput(h.units[1]).trigger,false);
  h.test.acceptInputActions(p,{...input(4),actionSeq:2,trigger:false});actual=h.game.remoteInput(h.units[1]);assert.equal(actual.trigger,false);
  h.c.updateHumanUnit(h.units[1],actual,.016);assert.equal(p.appliedActionSeq,2);
  // clientがsentAtだけ現在へ書き換えても、hostで500ms前に観測したseqのactionは復活しない。
  h.at(700);h.test.acceptInputBatch(p,{inputs:[{...move(6),sentAt:700}]});
  h.test.acceptInputActions(p,{...input(3,{Space:true}),sentAt:700,actionSeq:3});assert.equal(p.actions.length,0);
  const seq=p.receivedSeq;h.test.acceptInputBatch(p,{inputs:[{...move(7),sentAt:0}]});assert.equal(p.receivedSeq,seq);
  h.test.acceptInputActions(p,{...input(6,{Space:true}),sentAt:700,actionSeq:3});assert.equal(p.actions.length,1);
  h.units[1].lifeId=2;h.game.remoteInput(h.units[1]);assert.equal(p.actions.length,0);
  h.test.acceptInputBatch(p,{inputs:[{...move(99),sentAt:700}]});assert.equal(p.receivedSeq,seq);
  h.test.acceptInputActions(p,{...input(99,{Space:true}),sentAt:700,actionSeq:99});assert.equal(p.actions.length,0);
}
{
  const h=harness();
  for(let frame=0;frame<240;frame++){
    h.at(frame*1000/240);h.game.state.lastHost=frame*1000/240;
    h.game.testInput({...input(frame+1,frame===1?{Space:true}:{}),trigger:frame===1});h.game.beforeFrame(1/240,frame*1000/240);
  }
  const batches=h.sent.filter(s=>s.type==='inputBatch'),actions=h.sent.filter(s=>s.type==='inputActions');
  assert.equal(batches.length,60);assert(batches.every(s=>s.data.inputs.length<=5));
  assert(batches.every(s=>s.data.inputs.every(i=>i.pressed===undefined&&i.trigger===undefined)));
  assert.equal(actions.filter(s=>s.data.pressed.Space).length,1);assert.equal(actions.filter(s=>s.data.trigger).length,1);
  assert.equal(h.game.metrics().prediction.predictedSteps,60);
}
// 冒頭batch全欠落の後でも、先着/後着したまだ新しいcontrol押下は保持する。
for(const controlFirst of [false,true]){
  const h=harness(),p={id:'g',unitId:'R:0',receivedSeq:0,appliedSeq:0,last:0,pendingEdges:{}};
  h.game.state.role='host';h.game.state.peers.set('g',p);Object.assign(h.units[1],{controller:'remoteHuman',ownerPeerId:'g'});
  const action={...input(1,{Space:true}),actionSeq:1};
  if(controlFirst)h.test.acceptInputActions(p,action);
  h.at(50);h.test.acceptInputBatch(p,{inputs:[{...input(10),sentAt:50,actionSeq:1}]});
  if(!controlFirst)h.test.acceptInputActions(p,action);
  const actual=h.game.remoteInput(h.units[1]);assert.equal(actual.pressed.Space,true);h.c.updateHumanUnit(h.units[1],actual,.016);
  // 一時途絶はneutral。復旧後は押しっぱなし状態だけ戻し、押下は再発火しない。
  h.at(350);assert.equal(h.game.remoteInput(h.units[1]).trigger,false);
  h.test.acceptInputBatch(p,{inputs:[{...input(11),sentAt:350,actionSeq:1}]});
  const resumed=h.game.remoteInput(h.units[1]);assert.equal(resumed.trigger,true);assert.equal(resumed.pressed.Space,undefined);
}
{
  const h=harness();reconcile(h,snapshot(h));h.test.predictLocalInput({...input(1,{Space:true}),actionSeq:1},.02);
  h.at(501);reconcile(h,snapshot(h,2,{pos:[.2,0,0],boost:100},{seq:1,step:1,seqDt:.02,actionSeq:0,totalDt:.02,steps:[]}));
  assert.equal(h.game.metrics().prediction.pendingActions,0);h.test.predictLocalInput({...input(2),actionSeq:1},.02);assert.equal(h.units[0].boost,100);assert.equal(h.calls.at(-1).pressed.Space,undefined);
}
// 捨てた仮stepをackがまだ含まなければ、末尾だけで巻き直さず0.5m未満でもsnapする。
{
  const h=harness();reconcile(h,snapshot(h));
  for(let i=1;i<=300;i++)h.test.predictLocalInput({...input(i),keys:{}},.004);
  assert(h.test.getPrediction().droppedThroughSeq>0);
  reconcile(h,snapshot(h,2,{pos:[.1,0,0]}));
  assert.equal(h.game.metrics().prediction.hardSnapReasons.history,1);assert.equal(h.game.metrics().prediction.pendingInputs,0);assert.equal(h.units[0].onlineVisualOffset,undefined);approx(h.units[0].pos.x,.1);
}
// 捨てた最後の入力と同seqでも、部分ackなら未保持dtがあるのでsnapする。
{
  const h=harness();reconcile(h,snapshot(h));for(let i=1;i<=30;i++)h.test.predictLocalInput({...input(i),keys:{}},.05);
  const m=h.test.getPrediction(),seq=m.droppedThroughSeq;assert(seq>0);
  reconcile(h,snapshot(h,2,{pos:[.1,0,0]},{seq,seqDt:.01,step:1,actionSeq:0,totalDt:.01,steps:[]}));assert.equal(h.game.metrics().prediction.hardSnapReasons.history,1);
}
// controlが失効しても現在のheldは新番号で回復し、過去の押下を再送しない。
{
  const h=harness();h.test.sendLocalInput({...input(1,{Space:true}),trigger:true});
  h.at(501);h.test.sendLocalInput({...input(2),trigger:true});
  const actions=h.sent.filter(x=>x.type==='inputActions');assert.equal(actions.length,2);assert(actions[1].data.actionSeq>actions[0].data.actionSeq);assert.equal(actions[1].data.trigger,true);assert.equal(actions[1].data.pressed.Space,undefined);
  h.test.getPrediction().lastAckActionSeq=actions[1].data.actionSeq;
  h.at(1100);h.test.sendLocalInput({...input(3),trigger:true});assert.equal(h.sent.filter(x=>x.type==='inputActions').length,2);
}
// パーツ写真の更新は速度の算出元も再構築してから予測へ戻す。
{
  const h=harness();h.units[0].mech={legs:'old'};let equipped=0;
  h.c.equip=(u,cls)=>{u.cls=cls;u.walkV=u.mech.legs==='new'?9:5;equipped++;};
  reconcile(h,snapshot(h));h.test.predictLocalInput(input(1),.02);reconcile(h,snapshot(h,2,{mech:{legs:'new'},pos:[.1,0,0]}));
  assert.equal(equipped,1);assert.equal(h.units[0].walkV,9);assert.equal(h.game.metrics().prediction.hardSnapReasons.equipment,1);
}
console.log('自機予測管理：即時入力・可変dt/部分ack・押下一度・同seq累積・client dt無視・実dt精度・6コマ描画補正・離散snap・上限・終了/退出/再接続 成功');
