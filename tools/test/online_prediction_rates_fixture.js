// node tools/test/online_prediction_rates_fixture.js
// 異なる描画Hzで製品の入力送信・host適用ack・guest照合を再現する調査fixture。
// 移動だけは線形積分の代役。実physics、WebGL、RTC、実機FPSの検証ではない。
// 同時刻はguest採取→host計算→到着通知の順。phaseでその位相を明示変更できる。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');

function loadHarness(speed){
  // 既存の製品game.js VM harnessを使う。既存テスト本体や製品ファイルは変更しない。
  const filename=path.join(__dirname,'online_prediction.test.js');
  const original=fs.readFileSync(filename,'utf8');
  const marker='\n{\n  const h=harness();reconcile';
  const end=original.indexOf(marker);
  assert(end>0,'予測harnessの境界が変わった場合はfixtureを見直す');
  let source=original.slice(0,end);
  const guestMove='if(input.keys?.KeyW)u.pos.x+=10*dt;';
  const hostMove='updateHumanUnit(u,input,dt){u.pos.x+=10*dt;return false;}';
  assert(source.includes(guestMove)&&source.includes(hostMove),'線形移動代役の変更を検出');
  const movement=`u.pos.x+=${speed}*dt*((input.keys?.KeyW?1:0)-(input.keys?.KeyS?1:0));`;
  source=source.replace(guestMove,movement)
    .replace(hostMove,`humanUtilityInput(u,input){calls.push({hostUtility:true,pressed:{...input.pressed}});},
    updateHumanMovement(u,input,dt){calls.push({hostMovement:true,seq:input.seq,dt,pressed:{...input.pressed}});${movement}return {busy:false,artillery:false};},
    updateHumanUnit(u,input,dt,{movementDone=false}={}){calls.push({hostWeapon:true,dt,pressed:{...input.pressed},trigger:input.trigger});if(!movementDone)c.updateHumanMovement(u,input,dt);return false;}`);
  source=source.replace('getPrediction:()=>prediction,','stepLocalCommands,advanceRemoteCommands,getPrediction:()=>prediction,');
  const context={require:createRequire(filename),console,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(source+'\nthis.api={harness,input,snapshot,reconcile};',context);
  return context.api;
}

function predictionRateFixture({hostHz=60,guestHz=144,oneWayMs=1,burstMs=0,
  speed=30,turnMs=0,durationMs=10000,hostPhaseMs=0,guestPhaseMs=0,
  snapshotGap=null,fixed=true}={}){
  assert(hostHz>=20&&guestHz>=20&&speed>=0&&Number.isFinite(speed));
  const {harness,reconcile,snapshot,input}=loadHarness(speed);
  const host=harness(),guest=harness();
  host.game.state.role='host';
  const peer={id:'g',unitId:'B:0',receivedSeq:0,appliedSeq:0,last:0,pendingEdges:{}};
  host.game.state.peers.set(peer.id,peer);
  if(fixed){peer.fixedCommands=true;host.units[0].onlineFixedMovement=true;}
  Object.assign(host.units[0],{controller:'remoteHuman',ownerPeerId:peer.id});
  reconcile(guest,snapshot(guest));
  const queue=[],corrections=[];
  let order=0,lastSnapshot=-Infinity,frame=0,sentIndex=0,snapshotCount=0,droppedSnapshots=0;
  const enqueue=(time,kind,data)=>queue.push({time,kind,data,order:order++});
  for(let i=1;i<=Math.floor(guestHz*durationMs/1000);i++)enqueue(guestPhaseMs+i*1000/guestHz,'guest',i);
  for(let i=1;i<=Math.floor(hostHz*durationMs/1000);i++)enqueue(hostPhaseMs+i*1000/hostHz,'host',i);
  while(queue.length){
    queue.sort((a,b)=>a.time-b.time||a.order-b.order);
    const event=queue.shift(),time=event.time;
    if(time>durationMs)break;
    host.at(time);guest.at(time);
    if(event.kind==='guest'){
      guest.test.decayPredictionVisual();
      const value=input(event.data);
      value.keys=turnMs&&Math.floor(time/turnMs)%2?{KeyS:true}:{KeyW:true};
      value.trigger=false;
      if(fixed)guest.test.stepLocalCommands(value,1/guestHz);
      else {guest.test.sendLocalInput(value);guest.test.predictLocalInput(value,1/guestHz);}
      while(sentIndex<guest.sent.length){
        const message=guest.sent[sentIndex++];
        enqueue(time+oneWayMs,message.type,message.data);
      }
    }else if(event.kind==='inputBatch')host.test.acceptInputBatch(peer,event.data);
    else if(event.kind==='inputActions')host.test.acceptInputActions(peer,event.data);
    else if(event.kind==='host'){
      const value=host.game.remoteInput(host.units[0]);
      // 製品wrapperがrecordHostInputStepを呼ぶ。client dtをhostへ渡さない。
      host.c.updateHumanUnit(host.units[0],value,1/hostHz);
      frame++;
      if(time-lastSnapshot>=50-1e-6){
        const state=JSON.parse(JSON.stringify(host.game.snapshot()));
        state.frame=frame;state.time=time;
        if(snapshotGap&&time>=snapshotGap[0]&&time<snapshotGap[1])droppedSnapshots++;
        else{
          const arrival=burstMs?Math.ceil((time+oneWayMs)/burstMs)*burstMs:time+oneWayMs;
          enqueue(arrival,'snapshot',state);
        }
        lastSnapshot=time;
      }
    }else if(event.kind==='snapshot'){
      const previous=guest.units[0].pos.x;
      // 写真のcodec丸めや到着順拒否は別試験。ここでは単調な完全写真を直接照合する。
      reconcile(guest,event.data);
      const metric=guest.game.metrics().prediction,ack=event.data.inputAcks['B:0'];
      corrections.push({time,seq:ack.seq,seqDt:ack.seqDt,totalDt:ack.totalDt,
        before:previous,after:guest.units[0].pos.x,...metric.corrections.at(-1)});
      snapshotCount++;
    }
  }
  const metric=guest.game.metrics().prediction,changed=corrections.filter(c=>c.distance>.001);
  return {fixed,hostHz,guestHz,oneWayMs,burstMs,speed,turnMs,durationMs,hostPhaseMs,guestPhaseMs,snapshotGap,
    hardSnaps:metric.hardSnaps,reasons:metric.hardSnapReasons,
    correctionMean:metric.correctionMean,correctionMax:metric.correctionMax,
    changedCorrections:changed.length,changedCorrectionMean:changed.length?changed.reduce((n,c)=>n+c.distance,0)/changed.length:0,
    nonzeroCorrections:corrections.filter(c=>c.distance>1e-6).length,
    snapshotCount,droppedSnapshots,replayedSteps:metric.replayedSteps,
    inputBatches:guest.sent.filter(m=>m.type==='inputBatch').length,
    hostMovementSteps:host.calls.filter(c=>c.hostMovement).length,hostWeaponSteps:host.calls.filter(c=>c.hostWeapon).length,
    hostMovementSeconds:host.calls.filter(c=>c.hostMovement).reduce((n,c)=>n+c.dt,0),
    hostWeaponSeconds:host.calls.filter(c=>c.hostWeapon).reduce((n,c)=>n+c.dt,0),
    repeatedCommands:peer.repeatedCommands||0,droppedCommands:peer.droppedCommands||0,
    fixedDtOnly:host.calls.filter(c=>c.hostMovement).every(c=>Math.abs(c.dt-1/60)<1e-12),
    firstCorrections:corrections.slice(0,8),firstHardSnaps:corrections.filter(c=>c.reason!=='smooth').slice(0,3)};
}

if(require.main===module){
  const reports=[];
  for(const [hostHz,guestHz] of [[60,60],[60,144],[144,60],[60,240],[30,144]]){
    for(const scenario of [
      {speed:10}, {speed:30}, {speed:30,turnMs:100},
      {speed:30,burstMs:150}, {speed:30,turnMs:100,burstMs:150},
      {speed:30,turnMs:500,oneWayMs:5},
      {speed:30,snapshotGap:[1000,1150]},
      {speed:30,hostPhaseMs:5,guestPhaseMs:2}
    ]){
      const report=predictionRateFixture({hostHz,guestHz,...scenario});
      assert(report.snapshotCount>0&&Number.isFinite(report.correctionMax));
      assert(report.inputBatches<=Math.ceil(report.durationMs/1000*60));
      reports.push(report);
    }
  }
  // 既知問題の補正回数を成功条件として固定しない。修正後も対照条件だけ維持する。
  assert(reports[0].correctionMax<1e-8,'同位相60/60・直進の対照条件');
  console.log(JSON.stringify({notice:'線形移動の同期アルゴリズム調査。実ゲームのFPS測定ではない。',reports},null,2));
}
module.exports={predictionRateFixture,loadHarness};
