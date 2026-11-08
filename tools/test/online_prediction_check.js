// #214 次段階②。node tools/test/online_prediction_check.js dbg /tmp/online-prediction [--mock-transport]
// [--functional-only | --latency-only] [--latency-ms=50|100] [--samples=5]
// 機能fixtureはv9固定命令/ACK、描画・host frameと遅延測定は可変dt/実RAF。
// 描画省略・同一PCなので実PCの操作感ではない。共有fixtureのVM回帰はonline_prediction_contract.test.js。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {check}=require('./lib');
const {ROOT,MOCK_TRANSPORT,TRANSPORT_MODE,harness,room,input,neutral,sleep,stats,installWireObserver}=require('./online_test_helpers');
const numberArg=(name,fallback)=>{const s=process.argv.find(x=>x.startsWith('--'+name+'='));return s?Number(s.split('=')[1]):fallback;};
const samples=numberArg('samples',5),latencyArg=numberArg('latency-ms',null),latencies=latencyArg===null?[50,100]:[latencyArg];
if(!Number.isSafeInteger(samples)||samples<5)throw Error('--samples は5以上の整数');
if(latencies.some(x=>![50,100].includes(x)))throw Error('--latency-ms は50または100');
const functionalOnly=process.argv.includes('--functional-only'),latencyOnly=process.argv.includes('--latency-only');
if(functionalOnly&&latencyOnly)throw Error('*-only は同時指定できません');

// 内部参照は生成した試験コピーだけへ足す。製品APIにテスト専用の状態変更を増やさない。
function instrument(dir){
  const file=path.join(dir,'online/game.js'),source=fs.readFileSync(file,'utf8'),marker='  window.CBOnlineGame=';
  if(!source.includes(marker))throw Error('予測fixtureの挿入位置がありません');
  const hook=`  window.__predictionTest={resetPrediction,predictLocalInput,reconcilePrediction,capturePredictionView,recordHostInputStep,decayPredictionVisual,applyUnit,acceptInput,acceptInputBatch,acceptInputActions,sendLocalInput,onMessage,receiveSnapshot,handleSnapshotControl,
    resetPeerInput:(p,u)=>Object.assign(p,{fixedCommands:true,commandQueue:[],lastCommand:null,fixedStarted:false,fixedClock:0,catchupClock:0,fixedElapsed:0,fixedSteps:0,fixedReplaySeq:0,fixedNeedsResync:false,lastCommandArrival:null,movementActions:[],utilityActions:[],appliedMovementIds:new Set(),appliedMovementActionSeq:0,repeatedCommands:0,droppedCommands:0,inputLifeId:u.lifeId,input:null,receivedSeq:0,appliedSeq:0,appliedSeqDt:0,appliedTotalDt:0,appliedStep:0,appliedSteps:[],inputTimes:[],inputHistoryTruncated:false,firstInputAt:null,pendingEdges:{},receivedActionSeq:0,appliedActionSeq:0,actions:[],actionState:null,activeAction:null,frameAction:null,pendingShot:null,shotActionSeq:0,last:now()}),
    prediction:()=>prediction,
    reset:()=>{resetPrediction();snapshotDecoder=new CBOnlineCodec.Decoder();lastSnapshotBaseId=0;pendingSnapshotWires.clear();pendingSnapshotBases.clear();lastResync=-Infinity;resyncBackoff=250;finalFrame=null;interpolation=interpolationState();remoteUnitHistory.clear();state.history=[];state.lastSnapshot=null;state.seq=0;state.pendingInputs.clear();previousMove=previousTrigger=false;displayedLatencies.length=0;prepared=true;},
    applySnapshot,packUnit};\n`;
  fs.writeFileSync(file,source.replace(marker,hook+marker));
}

async function installInputWireProbe(guest){
  await installWireObserver(guest);await guest.evaluate(()=>{
    const p=window.__inputWireProbe={batches:0,actions:0,largestBatch:0,batchChannels:{},actionChannels:{},clientDtFields:0,nonFixedCommands:0,obsoleteInput:0};
    __observeOnlineWire(null,w=>{
      if(w.type==='input')p.obsoleteInput++;
      if(w.type==='inputBatch'){
        const frames=w.envelope.payload.inputs;p.batches++;p.largestBatch=Math.max(p.largestBatch,frames.length);
        p.batchChannels[w.channel]=(p.batchChannels[w.channel]||0)+1;
        p.clientDtFields+=frames.filter(f=>['dt','elapsed','clientTime'].some(k=>Object.hasOwn(f,k))).length;
        p.nonFixedCommands+=frames.filter(f=>f.command!==true).length;
      }
      if(w.type==='inputActions'){p.actions++;p.actionChannels[w.channel]=(p.actionChannels[w.channel]||0)+1;}
    });
  });
}
async function installFrameProbe(guest){await guest.evaluate(()=>{
  const game=CBOnlineGame,after=game.afterFrame,receive=game.state.transport.options.onMessage;
  window.__predictionProbe={frames:[],corrections:[],sample:null};
  game.afterFrame=(dt,t)=>{
    after(dt,t);
    const q=__predictionProbe,p=__g.player,at=performance.now();q.frames.push({dt,at});
    if(q.frames.length>10000)q.frames.shift();
    const s=q.sample;if(!s||s.done)return;
    // 物理位置と描画用groupの両方を、入力投入と同じguest時計で観測する。
    if(s.physicalMs===null&&s.pos.distanceTo(p.pos)>.02)s.physicalMs=at-s.at;
    if(s.visualMs===null&&s.visual.distanceTo(p.group.position)>.02)s.visualMs=at-s.at;
    if(s.physicalMs!==null&&s.visualMs!==null){s.done=true;s.endAt=at;game.testInput(s.neutral);}
    else if(at-s.at>5000){s.done=true;s.timeout=true;game.testInput(s.neutral);}
  };
  game.state.transport.options.onMessage=(type,data,id)=>{
    const before=game.metrics().prediction,oldFrame=game.state.lastSnapshot?.frame,oldPos=__g.player.pos.clone();
    const result=receive(type,data,id),after=game.metrics().prediction;
    if(type==='snapshot'&&before?.enabled&&game.state.lastSnapshot?.frame!==oldFrame){
      const reasons=Object.fromEntries(Object.entries(after.hardSnapReasons||{}).map(([k,v])=>[k,v-(before.hardSnapReasons?.[k]||0)]).filter(([,v])=>v));
      __predictionProbe.corrections.push({at:performance.now(),distance:oldPos.distanceTo(__g.player.pos),
        hardSnapDelta:after.hardSnaps-before.hardSnaps,reasons});
    }
    return result;
  };
});}
async function settleFixture(host,guest,latencyMs){
  await input(guest,neutral);await sleep(350+latencyMs*2);
  const reset=await host.evaluate(()=>{
    const g=__g,u=g.units.find(x=>x.controller==='remoteHuman');if(!u)throw Error('遠隔機がありません');
    u.pos.set(0,g.terrainH(0,170),170);u.vel.set(0,0,0);u.onGround=true;u.yaw=0;u.pitch=0;
    u.hp=u.maxHp;u.invulT=10;u.repairing=false;u.transfer=null;u.stun='';u.stunT=u.electricT=u.shockT=0;
    u.dashT=u.lungeT=u.slideT=u.recoverT=u.jumpBuf=0;u.longDash=false;u.flying=false;u.catMomentum=null;u.catLaunch=null;u.jumpPad=null;u.zip=null;u.ctrlLockT=0;
    u.onlineMotionEpoch=(u.onlineMotionEpoch||0)+1;
    return {id:u.entityId,epoch:u.onlineMotionEpoch};
  });
  await guest.waitForFunction(({id,epoch})=>CBOnlineGame.state.lastSnapshot?.units.some(u=>!u.hidden&&u.id===id&&u.motionEpoch===epoch),reset,{timeout:8000,polling:20});
  await sleep(450+latencyMs*2);
}
async function latencyCase(browser,h,errors,{latencyMs,enabled},ok){
  const active=await room(browser,h,errors,{guests:1,teamSize:2,latencyMs,predictionEnabled:enabled,frozen:false,render:false,beforeStart:async(host,guests)=>installInputWireProbe(guests[0])});
  try{
    const {host,guests:[guest]}=active;
    // 負荷計測と独立したページ。移動反応の測定中だけBot・砲台の干渉を止める。
    await host.evaluate(()=>{window.botUpdate=()=>{};window.turretUpdate=()=>{};for(const u of __g.units)if(u.controller==='bot')u.vel.set(0,0,0);});
    await installFrameProbe(guest);
    const configured=await guest.evaluate(()=>CBOnlineGame.metrics().prediction.enabled);
    ok(configured===enabled,`片道${latencyMs}msの予測${enabled?'ON':'OFF'}設定を確認`);
    const rows=[];
    for(let i=0;i<samples;i++){
      await settleFixture(host,guest,latencyMs);
      await guest.evaluate(base=>{
        const p=__g.player,q=__predictionProbe; q.corrections=[];
        q.sample={at:performance.now(),pos:p.pos.clone(),visual:p.group.position.clone(),physicalMs:null,visualMs:null,done:false,neutral:base};
        CBOnlineGame.testInput({...base,keys:{KeyW:true},yaw:0,pitch:0});
      },neutral);
      await guest.waitForFunction(()=>__predictionProbe.sample.done,{},{timeout:8000,polling:20});
      // 入力停止をhostが適用した後の補正まで含める。次回の位置resetは含めない。
      await sleep(350+latencyMs*2);
      const sample=await guest.evaluate(()=>{
        const q=__predictionProbe,s=q.sample,m=CBOnlineGame.metrics().prediction;
        return {inputAt:s.at,endAt:s.endAt,physicalMs:s.physicalMs,visualMs:s.visualMs,timeout:!!s.timeout,
          corrections:q.corrections.filter(x=>x.at>=s.at),metrics:m};
      });
      rows.push(sample);
    }
    const frames=await guest.evaluate(()=>__predictionProbe.frames),wire=await guest.evaluate(()=>__inputWireProbe);
    const corrections=rows.flatMap(x=>x.corrections),distances=corrections.map(x=>x.distance);
    const result={oneWayInjectedMs:latencyMs,predictionEnabled:enabled,samples:rows,
      movementMs:stats(rows.map(x=>x.physicalMs)),visibleMovementMs:stats(rows.map(x=>x.visualMs)),timeouts:rows.filter(x=>x.timeout).length,
      correctionMetres:stats(distances),hardSnaps:corrections.reduce((n,x)=>n+x.hardSnapDelta,0),
      hardSnapReasons:corrections.reduce((all,x)=>{for(const [k,n]of Object.entries(x.reasons))all[k]=(all[k]||0)+n;return all;},{}),frameDtSeconds:stats(frames.map(x=>x.dt)),
      distinctDtValues:new Set(frames.map(x=>x.dt.toFixed(5))).size,wire};
    ok(rows.every(x=>!x.timeout)&&result.movementMs.count>=5&&result.visibleMovementMs.count>=5,`片道${latencyMs}ms・予測${enabled?'ON':'OFF'}の物理/表示反応を${samples}回採取`);
    ok(result.distinctDtValues>1,`片道${latencyMs}ms・予測${enabled?'ON':'OFF'}の描画frameは可変dtで実行（移動命令は60Hz）`);
    ok(wire.batches>0&&wire.largestBatch===5&&Object.keys(wire.batchChannels).every(k=>k==='snapshot')&&!wire.clientDtFields&&!wire.nonFixedCommands&&!wire.obsoleteInput,`片道${latencyMs}ms・予測${enabled?'ON':'OFF'}の最新5固定命令を非再送線へ送りclient dtを送らない`);
    ok(wire.actions>0&&Object.keys(wire.actionChannels).every(k=>k==='control'),`片道${latencyMs}ms・予測${enabled?'ON':'OFF'}の一度きり操作はcontrol線へ送る`);
    console.log('入力予測計測',JSON.stringify(result));return result;
  }finally{await active.close();}
}

async function functional(active,ok,report){
  const {host,guests:[guest]}=active;
  const hostSteps=await host.evaluate(()=>{
    const game=CBOnlineGame,t=__predictionTest,u=__g.units.find(x=>x.controller==='remoteHuman'),p=game.state.peers.get(u.ownerPeerId),DT=1/60;
    const originalNow=Object.getOwnPropertyDescriptor(performance,'now');let clock=performance.now();
    Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    try{
      u.pos.set(0,__g.terrainH(0,170),170);u.vel.set(0,0,0);u.onGround=true;u.repairing=false;u.transfer=null;
      u.flying=false;u.catMomentum=null;u.catLaunch=null;u.jumpPad=null;u.zip=null;u.stun='';u.stunT=u.electricT=u.shockT=0;
      u.dashT=u.lungeT=u.slideT=u.recoverT=0;u.longDash=false;u.boost=u.maxBoost;u.overheat=false;
      t.resetPeerInput(p,u);
      const input={seq:11,command:true,actionSeq:1,moveActions:[[1,5]],movePressed:{ShiftLeft:true,Space:true},lifeId:u.lifeId,sentAt:clock,yaw:0,pitch:0,aimPoint:[0,3,0],keys:{KeyW:true,ShiftLeft:true,Space:true},pressed:{ShiftLeft:true,Space:true},dt:1000,elapsed:1000,clientTime:1e12};
      t.acceptInput(p,{...input,command:false});const legacyRejected=p.input===null&&p.commandQueue.length===0&&p.receivedSeq===0;
      t.acceptInputBatch(p,{inputs:[input,{...input,seq:12,moveActions:[],movePressed:{},pressed:{}}]});t.acceptInputActions(p,input);
      const before={pos:u.pos.toArray(),appliedStep:p.appliedStep,appliedTotalDt:p.appliedTotalDt,input:p.input},accepted=structuredClone(p.commandQueue),rows=[];
      for(const dt of [.011,.029,.007,.023]){
        clock+=dt*1000;__g.updateHumanUnit(u,game.remoteInput(u),dt);
        rows.push({dt,ack:structuredClone(game.snapshot().inputAcks[u.entityId]),pos:u.pos.toArray(),boost:u.boost});
      }
      t.acceptInput(p,{...input,seq:10,moveActions:[[2,4]],actionSeq:2});t.acceptInput(p,{...input,seq:12});
      const stale={receivedSeq:p.receivedSeq,queue:p.commandQueue.length,movementActions:p.movementActions.length};
      t.acceptInput(p,{...input,seq:13,keys:{},pressed:{},movePressed:{},moveActions:[]});
      clock+=14;__g.updateHumanUnit(u,game.remoteInput(u),.014);
      return {DT,legacyRejected,before,accepted,rows,stale,steps:structuredClone(p.appliedSteps),nextAck:game.snapshot().inputAcks[u.entityId]};
    }finally{if(originalNow)Object.defineProperty(performance,'now',originalNow);else delete performance.now;}
  });
  report.functional={hostSteps};
  ok(hostSteps.legacyRejected,'v9対戦では旧形式の可変入力を拒否する');
  ok(hostSteps.accepted.length===2&&hostSteps.accepted.every(v=>v.command&&!['dt','elapsed','clientTime'].some(k=>Object.hasOwn(v,k))),'固定queueへ命令を受理しゲスト送信の時間加速値を除外');
  ok(hostSteps.before.input===null&&hostSteps.before.appliedStep===0&&hostSteps.before.appliedTotalDt===0,'受信時点では固定queueを実適用済みにしない');
  ok(hostSteps.rows.map(x=>x.ack.step).join(',')==='0,2,2,4'&&hostSteps.steps.every(x=>Math.abs(x.dt-hostSteps.DT)<1e-10),'host frame 11/29/7/23msでも移動は0/2/0/2個の1/60秒命令だけを消化');
  ok(hostSteps.rows[3].ack.fixed&&hostSteps.rows[3].ack.seq===12&&hostSteps.rows[3].ack.replaySeq===14&&Math.abs(hostSteps.rows[3].ack.seqDt-3*hostSteps.DT)<1e-10,'実消化seqと保持反復を含むreplaySeqを別々にACKする');
  ok(hostSteps.steps[0].pressed.includes('Space')&&hostSteps.steps[0].pressed.includes('ShiftLeft')&&hostSteps.steps.slice(1).every(x=>x.pressed.length===0)&&hostSteps.rows[3].ack.movementIds.join(',')==='1','移動命令/control両方の押下を一度だけ適用し反復でも重ねない');
  ok(hostSteps.stale.receivedSeq===12&&hostSteps.stale.queue===0&&hostSteps.stale.movementActions===0,'古い/重複入力が後着してもqueueや押下を再注入しない');
  ok(hostSteps.nextAck.seq===13&&hostSteps.nextAck.replaySeq===15&&Math.abs(hostSteps.nextAck.seqDt-hostSteps.DT)<1e-10&&Math.abs(hostSteps.nextAck.totalDt-5*hostSteps.DT)<1e-10,'次命令はseqDtだけをリセットし反復込みの固定時間を維持');

  const inputDelivery=await host.evaluate(()=>{
    const game=CBOnlineGame,t=__predictionTest,u=__g.units.find(x=>x.controller==='remoteHuman'),p=game.state.peers.get(u.ownerPeerId),checks=[],details={},DT=1/60;
    const test=(v,name)=>checks.push({value:!!v,name}),originalNow=Object.getOwnPropertyDescriptor(performance,'now');
    let clock=performance.now();Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    const reset=()=>t.resetPeerInput(p,u);
    const move=(seq,patch={})=>({seq,command:true,actionSeq:1,moveActions:[],movePressed:{},lifeId:u.lifeId,sentAt:clock,yaw:0,pitch:0,aimPoint:[0,3,0],keys:{KeyW:true},...patch});
    const action=(actionSeq,seq,patch={})=>({actionSeq,seq,lifeId:u.lifeId,sentAt:clock,trigger:false,alt:false,keys:{},pressed:{},...patch});
    const ingest=(type,data)=>t.onMessage(type,data,p.id);
    const applied=(dt=DT)=>{
      clock+=dt*1000;const step=p.appliedStep;__g.updateHumanUnit(u,game.remoteInput(u),dt);
      return {input:structuredClone(p.input),action:structuredClone(u.controlInput),steps:structuredClone(p.appliedSteps.filter(v=>v.step>step)),ack:structuredClone(game.snapshot().inputAcks[u.entityId])};
    };
    try{
      reset();
      // 最初のbatchを丸ごと落とす。次の最新5命令を保持し、latestだけへ飛ばさない。
      ingest('inputBatch',{inputs:[2,3,4,5,6].map(n=>move(n,{trigger:true,pressed:{Space:true},dt:1000}))});
      test(p.receivedSeq===6&&p.appliedSeq===0&&p.input===null&&p.commandQueue.map(v=>v.seq).join(',')==='2,3,4,5,6'&&p.commandQueue.every(v=>!v.trigger&&!v.pressed.Space&&!Object.hasOwn(v,'dt')),'欠落後の5命令は番号順queueへ入り、旧pressed/射撃/dtの混入を拒否');
      const first=applied(.05),second=applied(),third=applied();
      test([...first.steps,...second.steps,...third.steps].map(v=>v.seq).join(',')==='2,3,4,5,6','冗長batchをlatestへ飛ばさず実固定stepごとに順番に消化');
      ingest('inputBatch',{inputs:[1,2,3,4,5].map(n=>move(n,{keys:{KeyS:true}}))});
      ingest('inputBatch',{inputs:[6,5,4,3,2].map(n=>move(n,{keys:{KeyS:true}}))});
      test(p.receivedSeq===6&&p.commandQueue.length===0&&p.input.keys.KeyW&&!p.input.keys.KeyS,'逆転/重複batchで適用済み入力を巻き戻さない');
      ingest('inputBatch',{inputs:[9,7,8,6,5].map(n=>move(n))});
      test(p.receivedSeq===9&&p.commandQueue.map(v=>v.seq).join(',')==='7,8,9','batch内部の逆順も番号順で重複排除');
      details.redundancy={receivedSeq:p.receivedSeq,appliedSeq:p.appliedSeq};

      reset();ingest('inputActions',action(1,10,{pressed:{Space:true},trigger:true}));
      const before=game.remoteInput(u);test(!before.seq&&!before.trigger&&!before.pressed.Space,'control先着時は対応する固定命令まで押下と射撃を待つ');
      ingest('inputBatch',{inputs:[move(10),move(11)]});const started=applied();
      ingest('inputActions',action(1,10,{pressed:{Space:true},trigger:true}));const repeated=applied();
      test(started.steps[0].pressed.includes('Space')&&started.action.trigger&&repeated.steps.every(v=>!v.pressed.includes('Space'))&&p.appliedActionSeq===1,'controlの押下は固定移動で一度だけ適用し重複actionを捨てる');
      ingest('inputActions',action(2,12));const earlyRelease=game.remoteInput(u);
      test(earlyRelease.trigger&&p.appliedActionSeq===1,'後続control先着だけでは現在の射撃状態を先走って変更しない');
      ingest('inputBatch',{inputs:[move(12,{actionSeq:2})]});const released=applied();
      test(!released.action.trigger&&p.appliedActionSeq===2,'対応固定命令の消化後に射撃解除を確定');

      reset();ingest('inputBatch',{inputs:[move(50),move(51)]});applied();
      ingest('inputActions',action(1,49,{pressed:{ShiftLeft:true}}));const late=applied(),lateAgain=applied();
      test(late.steps[0].pressed.includes('ShiftLeft')&&lateAgain.steps.every(v=>!v.pressed.includes('ShiftLeft'))&&p.appliedMovementIds.has(1),'movement ackより後着したcontrol押下も個別IDで一度だけ適用');
      details.actionOrder={lateAppliedSeq:p.appliedSeq,lateActionSeq:p.appliedActionSeq};

      reset();ingest('inputBatch',{inputs:[move(1)]});ingest('inputActions',action(1,1,{pressed:{Space:true},trigger:true}));
      const oldLife=u.lifeId;u.lifeId++;
      try{
        ingest('inputBatch',{inputs:[move(100,{lifeId:oldLife})]});ingest('inputActions',action(100,100,{lifeId:oldLife,pressed:{Space:true},trigger:true}));
        const oldLifeInput=game.remoteInput(u);
        test(!oldLifeInput.seq&&!oldLifeInput.trigger&&!oldLifeInput.pressed.Space&&p.receivedSeq===1&&p.receivedActionSeq===1,'再出撃後の古いlife入力/押下/射撃を拒否し番号も進めない');
        ingest('inputBatch',{inputs:[move(2),move(3)]});const fresh=applied();
        test(fresh.ack.seq===2&&p.actions.length===0&&p.movementActions.length===0&&fresh.steps.every(v=>v.pressed.length===0),'新lifeの固定命令は旧lifeの押下を引き継がず再開');
      }finally{u.lifeId=oldLife;}

      reset();ingest('inputBatch',{inputs:[move(1,{sentAt:clock-501})]});ingest('inputActions',action(1,1,{sentAt:clock-501,pressed:{Space:true}}));
      ingest('inputBatch',{inputs:[move(2,{sentAt:clock+251})]});
      test(p.receivedSeq===0&&p.receivedActionSeq===0,'500ms超遅着/250ms超未来の命令とcontrol操作を失効');
      ingest('inputBatch',{inputs:[move(1),move(2)]});ingest('inputActions',action(1,1,{pressed:{Space:true},trigger:true}));applied();clock+=251;
      const stale=game.remoteInput(u);test(!stale.seq&&!stale.trigger&&!stale.pressed.Space,'移動入力が250ms途絶えると古いキー・射撃を継続しない');
      const neutral=applied();test(!neutral.action.trigger&&neutral.steps.every(v=>v.pressed.length===0),'固定保持反復も250ms後は押下なしの中立入力になる');
      // 未適用の押下が失効する場合を、既に確定したheld射撃状態から分離する。
      reset();ingest('inputBatch',{inputs:[move(1)]});ingest('inputActions',action(1,1,{pressed:{Space:true},trigger:true}));
      clock+=501;ingest('inputBatch',{inputs:[move(3),move(4)]});const restored=applied();
      test(restored.ack.seq===3&&!restored.action.trigger&&restored.steps.every(v=>v.pressed.length===0)&&p.actions.length===0,'長い欠落後は失効した押下を再生せずfresh命令で再開');
      details.expiry={maxAgeMs:500,movementStaleMs:250,restoredSeq:restored.ack.seq,restored};
    }finally{reset();if(originalNow)Object.defineProperty(performance,'now',originalNow);else delete performance.now;}
    return {checks,details};
  });
  report.functional.inputDelivery=inputDelivery;
  for(const item of inputDelivery.checks)ok(item.value,item.name);

  const result=await guest.evaluate(()=>{
    const g=__g,game=CBOnlineGame,t=__predictionTest,copy=x=>structuredClone(x),p=g.player,id=game.state.localUnitId,DT=1/60;
    // 実際にこのpeerへ届いた公開状態を土台にする。非公開機体を全量snapshotから補わない。
    const template=copy(game.state.lastSnapshot),own=s=>s.units.find(u=>!u.hidden&&u.id===id),checks=[],details={boundaries:[]};
    if(!template?.roster?.length||!own(template))throw Error('peer別公開snapshotのfixtureがありません');
    template.unitUpdates=(1<<template.units.length)-1;
    const test=(value,name)=>checks.push({value:!!value,name});
    test(template.units.length===template.roster.length&&template.units.every((u,i)=>u.fixedUnit&&typeof u.hidden==='boolean'&&u.id===template.roster.map(v=>v.id).sort()[i]),'予測fixtureも全機固定slot・可視/秘匿の公開契約を維持');
    const near=(a,b,epsilon=.000001)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=epsilon);
    const movement=u=>({pos:u.pos.toArray(),vel:u.vel.toArray(),boost:u.boost,jumpBuf:u.jumpBuf,dashT:u.dashT,onGround:u.onGround});
    let encoder,decoder,base,frame,sourceChecks=0;
    const setAck=(s,{seq=0,replaySeq=seq,step=0,seqDt=0,totalDt=0,steps=[],actionSeq=0,movementSeq=0,movementIds=[]}={})=>{s.acks={[id]:seq};s.inputAcks={[id]:{fixed:true,seq,replaySeq,step,seqDt,totalDt,steps,actionSeq,movementSeq,movementIds}};return s;};
    const normalize=u=>Object.assign(u,{pos:[0,g.terrainH(0,170),170],vel:[0,0,0],alive:true,hp:u.maxHp,lifeId:1,motionEpoch:0,
      onGround:true,repairing:false,transfer:null,stun:'',stunT:0,downT:0,electricT:0,shockT:0,shockSlow:0,invulT:0,
      dashT:0,lungeT:0,slideT:0,recoverT:0,jumpBuf:0,longDash:false,flying:false,ctrlLockT:0,catLaunch:null,jumpPadIndex:-1,zipLine:-1,
      predictionBlocked:'',planted:false,charging:false,chargerOn:false,crouching:false,actionHeld:false,actionBlockBoost:false,kneeSlideT:0,
      swing:null,boost:u.maxBoost,overheat:false,boostIdle:0,yaw:0,pitch:0,motionVectors:{dashDir:[0,0,-1],boostVisualDir:[0,0,-1],catMomentum:null,lungeDir:[0,0,-1]}});
    const encode=s=>{
      const w=encoder.encode(s);if(w.baseline&&!decoder.seed(w.baseline))throw Error('独立fixture基準を復元できません');
      const decoded=decoder.decode(w.delta);if(!decoded)throw Error('独立fixture差分を復元できません');
      // hostとguestではunits配列順が異なる。必ずidで照合し、古い基準の偶然再利用を検出する。
      for(const u of s.units){const d=decoded.units.find(x=>x.id===u.id);if(!d||!near(u.pos,d.pos,.011)||u.lifeId!==d.lifeId)throw Error('fixture生成元と復号状態が不一致: '+u.id);}
      if(decoded.roster.length!==template.roster.length||Object.keys(decoded.inputAcks).some(key=>key!==id)||decoded.units.some(u=>!template.units.some(v=>v.id===u.id&&v.hidden===u.hidden)||u.hidden&&JSON.stringify(u)!==JSON.stringify(template.units.find(v=>v.id===u.id))))throw Error('fixtureが他peerのack/非公開機体を追加しました');
      sourceChecks++;return {baseline:w.baseline,wire:{frame:s.frame,delta:w.delta},decoded};
    };
    const deliver=s=>{const w=encode(s);if(w.baseline)t.handleSnapshotControl('snapshotBase',w.baseline);t.receiveSnapshot(w.wire);return w;};
    const next=()=>{const s=copy(base);s.frame=++frame;s.time=base.time+(frame-1)*50;return s;};
    const fresh=()=>{
      t.reset();encoder=new CBOnlineCodec.Encoder();decoder=new CBOnlineCodec.Decoder();frame=1;
      base=copy(template);normalize(own(base));base.frame=frame;base.time=performance.now();setAck(base);
      // wireは固定id順。guestの自軍優先配列とは別の順でもidで復元する。
      base.units.sort((a,b)=>a.id.localeCompare(b.id));deliver(base);t.resetPrediction(true);
      // 予測測定だけを初期化後、基準状態をもう一度渡す。decoderは同じfixture内だけ使う。
      const seed=next();deliver(seed);base=copy(seed);
    };
    const input=(seq,pressed={},keys={KeyW:true})=>({seq,command:true,moveActions:[],lifeId:p.lifeId,sentAt:performance.now(),keys,pressed,yaw:0,pitch:0,fwd:0,side:0,trigger:false,alt:false,wheel:0,aimPoint:[0,3,0]});

    fresh();
    const start=movement(p),combatBefore={hp:g.units.map(u=>[u.entityId,u.hp]),slots:JSON.stringify(p.slots,(k,v)=>k==='w'?v.key:v),shells:g.shells.length,events:game.state.receivedEvents.size,hits:game.state.hitLatency.length};
    const shotInput={...input(1),trigger:true,weapon:'sub',pressed:{Digit2:true}};
    const moved=t.predictLocalInput(shotInput,DT),combatAfter={hp:g.units.map(u=>[u.entityId,u.hp]),slots:JSON.stringify(p.slots,(k,v)=>k==='w'?v.key:v),shells:g.shells.length,events:game.state.receivedEvents.size,hits:game.state.hitLatency.length};
    test(moved&&!near(p.pos.toArray(),start.pos),'host写真前に自機の移動だけが進む');
    test(JSON.stringify(combatBefore)===JSON.stringify(combatAfter),'射撃入力を含む予測でもHP・弾数・弾・命中表示はhost確定前に変えない');
    const damage=next(),target=damage.units.find(u=>!u.hidden&&u.id!==id);if(!target)throw Error('公開された標的のfixtureがありません');target.hp-=100;deliver(damage);
    test(g.units.find(u=>u.entityId===target.id).hp===target.hp,'host snapshotが到着した時点で初めて標的HPを反映');

    fresh();
    // hostは命令20を2回（新規+保持反復）適用。実消化seq=20、時間境界replaySeq=21。
    const first={...input(20,{Space:true,ShiftLeft:true},{KeyW:true,Space:true,ShiftLeft:true}),actionSeq:1,moveActions:[[1,5]]},later=input(21,{}, {KeyW:true}),last=input(22,{}, {KeyS:true});
    const initial=copy(own(base));
    t.predictLocalInput(first,DT);t.predictLocalInput(later,DT);t.predictLocalInput(last,DT);
    const predicted=copy(t.packUnit(p));
    t.applyUnit(p,initial);g.predictHumanMovement(p,first,DT);g.predictHumanMovement(p,{...first,pressed:{}},DT);
    const ackSnapshot=next();Object.assign(own(ackSnapshot),t.packUnit(p));setAck(ackSnapshot,{seq:20,replaySeq:21,step:2,seqDt:2*DT,totalDt:2*DT,actionSeq:1,movementSeq:1,movementIds:[1],steps:[{step:1,seq:20,dt:DT,seqDt:DT,pressed:['Space','ShiftLeft']},{step:2,seq:20,dt:DT,seqDt:2*DT,pressed:[]}]});
    // wire量子化後の確定stateから、未消化queue先頭21だけを1/60秒再生。末尾22は保持する。
    const encoded=encode(ackSnapshot);t.applyUnit(p,own(encoded.decoded));
    g.predictHumanMovement(p,later,DT);const expected=movement(p);
    t.applyUnit(p,predicted);if(encoded.baseline)t.handleSnapshotControl('snapshotBase',encoded.baseline);t.receiveSnapshot(encoded.wire);
    const repeated=game.metrics().prediction;
    test(near(p.pos.toArray(),expected.pos)&&near(p.vel.toArray(),expected.vel)&&Math.abs(p.boost-expected.boost)<1e-6,'固定ACKはqueue先頭を再生し、host保持反復ぶんを引いて未適用末尾を残す');
    test(repeated.partialAcks===0&&repeated.pendingInputs===2&&t.prediction().repeatDebt===1&&Math.abs(repeated.replayedSeconds-DT)<1e-7,'v9では可変dtの部分ACKを作らずseq/replaySeqと1/60秒で照合');
    test(repeated.lastAckStep===2&&Math.abs(repeated.confirmedHostSeconds-2*DT)<1e-7&&repeated.hostStepSamples===2&&repeated.pendingActions===0,'確定host固定時間と押下の個別適用済みIDを復元');
    const duplicateState=movement(p),duplicateMetrics=game.metrics().prediction;t.receiveSnapshot(encoded.wire);
    test(JSON.stringify(movement(p))===JSON.stringify(duplicateState)&&game.metrics().prediction.replayedSteps===duplicateMetrics.replayedSteps,'同じsnapshotを再受信しても押下・replayを二重適用しない');
    const saved=copy(t.packUnit(p));g.predictHumanMovement(p,last,DT);const expectedNext=movement(p);t.applyUnit(p,saved);
    t.predictLocalInput(input(23,{},{}),DT);
    test(near(p.pos.toArray(),expectedNext.pos)&&near(p.vel.toArray(),expectedNext.vel)&&t.prediction().pending.map(v=>v.input.seq).join(',')==='21,22,23','通常の先読みも反復控除後の未適用命令22を先に使い新命令23を保留');
    const fully=next();Object.assign(own(fully),initial);setAck(fully,{seq:22,replaySeq:23,step:4,seqDt:DT,totalDt:4*DT,actionSeq:1,movementSeq:1,movementIds:[1]});deliver(fully);
    const full=game.metrics().prediction;
    test(full.pendingInputs===1&&t.prediction().pending[0].input.seq===23&&full.lastAckStep===4&&Math.abs(full.confirmedHostSeconds-4*DT)<1e-7,'実消化seqまでだけ除去しreplaySeqに含まれる未適用命令も保持');
    details.fixedAck={repeated,full};

    fresh();
    t.predictLocalInput({...input(1,{Space:true},{Space:true}),actionSeq:1,moveActions:[[1,4]]},DT);
    t.predictLocalInput({...input(2,{ShiftLeft:true},{ShiftLeft:true}),actionSeq:2,moveActions:[[2,1]]},DT);
    const moveFirst=next();setAck(moveFirst,{seq:2,step:2,seqDt:DT,totalDt:2*DT,actionSeq:2,movementSeq:2,movementIds:[2]});deliver(moveFirst);
    const awaitingAction=game.metrics().prediction;
    test(awaitingAction.pendingInputs===0&&awaitingAction.pendingActions===1&&t.prediction().actionEdges[0].actionSeq===1,'control ACK/新しい移動押下IDが先着しても未適用の古い押下IDを保持');
    t.predictLocalInput(input(3,{},{}),DT);const replayedEdge=movement(p),edgeFlag=t.prediction().actionEdges[0]?.needsReplay;
    t.predictLocalInput(input(4,{},{}),DT);
    test(replayedEdge.vel[1]>0&&edgeFlag===false&&p.jumpBuf===0,'後続の固定命令へ未適用ジャンプを一度だけ合成');
    const actionDone=next();Object.assign(own(actionDone),t.packUnit(p));setAck(actionDone,{seq:4,step:4,seqDt:DT,totalDt:4*DT,actionSeq:2,movementSeq:2,movementIds:[1,2]});deliver(actionDone);
    test(game.metrics().prediction.pendingActions===0,'押下の個別適用済みIDがそろうと保留押下を除去');
    details.actionAck={awaitingAction,after:game.metrics().prediction};

    fresh();const oldWire=encode(next());deliver(next());
    const afterNewest={pos:p.pos.toArray(),frame:game.state.lastSnapshot.frame,ack:game.metrics().prediction.lastAckStep};t.receiveSnapshot(oldWire.wire);
    test(near(afterNewest.pos,p.pos.toArray())&&game.state.lastSnapshot.frame===afterNewest.frame&&game.metrics().prediction.lastAckStep===afterNewest.ack,'逆順の古いsnapshotは位置とackを巻き戻さない');
    const missing=next();missing.time=base.time+12000;own(missing).pos[0]+=.12;
    const missingWire=encode(missing),beforeMissing=p.pos.toArray();
    if(!missingWire.baseline)throw Error('欠落試験用の独立新基準が生成されませんでした');
    t.receiveSnapshot(missingWire.wire);
    test(near(beforeMissing,p.pos.toArray())&&game.metrics().interpolation.missingBaselines>0,'基準欠落の差分を誤った過去基準で適用しない');
    t.handleSnapshotControl('snapshotBase',missingWire.baseline);
    test(game.state.lastSnapshot.frame===missing.frame&&near(p.pos.toArray(),own(missingWire.decoded).pos),'欠落基準の復旧後に最新snapshotから再開');

    const boundaries=[
      ['respawn',{lifeId:2}],['down',{alive:false,downT:3}],['transfer',{motionEpoch:1}],
      ['equipment',{mech:{...own(template).mech,head:own(template).mech?.head==='heavy'?'light':'heavy'}}],['stun',{stun:'stagger',stunT:.4}],['electric',{electricT:.3}],['shock',{shockT:.5}],
      ['catapult',{flying:true,predictionBlocked:'launch'}],['jumpPad',{jumpPadIndex:0,predictionBlocked:'jumpPad'}],
      ['repair',{repairing:true,predictionBlocked:'repair'}],['zip',{predictionBlocked:'zip'}],
      ['lift',{predictionBlocked:'lift'}],['melee',{predictionBlocked:'melee'}],['planted',{planted:true,predictionBlocked:'planted'}],
    ];
    for(const [reason,patch]of boundaries){
      fresh();t.predictLocalInput(input(1),DT);const s=next(),u=own(s);Object.assign(u,patch);u.pos[0]+=.1;deliver(s);
      const m=game.metrics().prediction,good=m.pendingInputs===0&&m.hardSnapReasons[reason]>=1&&m.visualOffset.every(v=>v===0)&&near(p.pos.toArray(),u.pos,.011);
      test(good,reason+'境界で過去入力を捨て、0.5m未満でも補間せず確定位置へ合わせる');
      if(reason==='equipment')test(p.mech.head===patch.mech.head&&p.lockRange===g.PARTS.head[patch.mech.head].lock,'同lifeの機体変更は移動用statsを新しい機体から再構築');
      details.boundaries.push({reason,metrics:m,position:p.pos.toArray()});
    }
    fresh();const beforeSmall=p.pos.toArray(),small=next();own(small).pos[0]+=.2;deliver(small);
    const sm=game.metrics().prediction,physicsPosition=p.pos.toArray(),visual=p.pos.clone();if(p.onlineVisualOffset)visual.add(p.onlineVisualOffset);
    test(near(p.pos.toArray(),own(small).pos,.011)&&near(visual.toArray(),beforeSmall,.011)&&sm.visualOffset.some(v=>Math.abs(v)>.1),'0.2m補正は物理位置を即確定し、見た目だけ旧位置から滑らかにする');
    const offset=[];for(let i=0;i<6;i++){t.decayPredictionVisual();offset.push(p.onlineVisualOffset?.length()||0);}
    test(offset.at(-1)===0&&offset.every((v,i)=>!i||v<=offset[i-1])&&near(p.pos.toArray(),physicsPosition),'見た目補正は6frame以内で単調に解消し物理位置を変更しない');
    details.smallCorrection={metrics:sm,offset};
    fresh();const large=next();own(large).pos[0]+=1;deliver(large);
    test(game.metrics().prediction.hardSnapReasons.distance===1&&game.metrics().prediction.visualOffset.every(v=>v===0),'0.5m以上のずれは見た目も即座に確定位置へ合わせる');

    fresh();for(let seq=1;seq<=300;seq++)t.predictLocalInput(input(seq),DT);
    const bound=game.metrics().prediction,atBound=p.pos.toArray(),invalid=t.predictLocalInput(input(301),1000);
    test(bound.pendingInputs<=240&&bound.pendingSeconds<=1.0000001&&bound.droppedInputs>0,'長い欠落でも予測履歴を240入力・固定命令合計1秒以内へ制限');
    test(!invalid&&near(atBound,p.pos.toArray()),'不正な巨大dtは自機予測へも適用しない');
    details.bounds=bound;
    const historyGap=next();own(historyGap).pos[0]+=.1;deliver(historyGap);
    test(game.metrics().prediction.hardSnapReasons.history===1&&game.metrics().prediction.pendingInputs===0&&near(p.pos.toArray(),own(historyGap).pos,.011),'捨てた履歴より前のsnapshotには不完全な末尾をreplayせずhistory snapで捨てる');
    details.historyGap=game.metrics().prediction;

    fresh();t.predictLocalInput({...input(1,{Space:true},{Space:true}),actionSeq:1,moveActions:[[1,4]]},DT);
    const expiredNow=Object.getOwnPropertyDescriptor(performance,'now'),expiredClock=performance.now()+501;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>expiredClock});
    try{
      const expired=next();setAck(expired,{seq:1,step:1,seqDt:DT,totalDt:DT,actionSeq:0});deliver(expired);
      t.predictLocalInput({...input(2,{},{}),actionSeq:1},DT);
      test(game.metrics().prediction.pendingActions===0&&p.vel.y===0&&p.boost===p.maxBoost,'500ms超の未ackジャンプは失効し新しい固定命令で再発火しない');
    }finally{if(expiredNow)Object.defineProperty(performance,'now',expiredNow);else delete performance.now;}

    fresh();g.releaseLock();g.updateCamera(p,.016);g.camera.updateMatrixWorld(true);
    const physicalBefore=movement(p),cameraBefore=g.camera.position.toArray(),aimBefore=g.updateLocalHumanAim(p,0,false).aim.toArray();
    const savedRender=g.renderer.render,renderedCameras=[];p.onlineVisualOffset=p.pos.clone().set(.2,.05,-.1);
    g.renderer.render=()=>{renderedCameras.push(g.camera.position.toArray());};
    try{g.renderView();}finally{g.renderer.render=savedRender;}
    const aimAfter=g.updateLocalHumanAim(p,0,false).aim.toArray();
    test(renderedCameras.length>0&&renderedCameras.some(v=>near(v,cameraBefore.map((n,i)=>n+[.2,.05,-.1][i]))),'描画関数の中だけcameraへ見た目補正を足す');
    test(near(g.camera.position.toArray(),cameraBefore)&&near(aimAfter,aimBefore)&&JSON.stringify(movement(p))===JSON.stringify(physicalBefore),'描画後はcamera/aimPointを元へ戻し補正を照準・物理・送信値へ混ぜない');
    delete p.onlineVisualOffset;

    fresh();
    const originalNow=Object.getOwnPropertyDescriptor(performance,'now'),transport=game.state.transport,originalSend=transport.send;
    let clock=performance.now()+1000;const sent=[];Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    transport.send=(type,data)=>{sent.push({type,data:copy(data),at:clock});return true;};
    try{
      game.state.lastHost=clock;
      for(let i=0;i<240;i++){
        clock+=1000/240;
        // 1描画コマ（4.17ms）だけの押下も、60Hz送信間隔に埋もれさせない。
        game.testInput({...input(i+1),keys:i===21?{Space:true}:{},pressed:i===21?{Space:true}:{},trigger:i===103});
        game.beforeFrame(1/240,clock);
      }
    }finally{transport.send=originalSend;game.testInput(null);if(originalNow)Object.defineProperty(performance,'now',originalNow);else delete performance.now;}
    const batches=sent.filter(x=>x.type==='inputBatch'),actions=sent.filter(x=>x.type==='inputActions');
    test(game.state.seq===60&&batches.length===60&&batches.every(x=>x.data.inputs.length<=5)&&batches.some(x=>x.data.inputs.length===5)&&t.prediction().pending.every(v=>v.input.command&&v.provisionalDt===DT),'240Hz描画でも60個の固定命令を生成し命令が増えたframeだけbatchをenqueue');
    test(actions.some(x=>x.data.pressed.Space)&&actions.some(x=>x.data.trigger)&&actions.some(x=>!x.data.trigger&&x.data.actionSeq>actions.find(y=>y.data.trigger).data.actionSeq),'4msのジャンプ/射撃開始/解除を信頼性ありinputActionsへ残す');
    test(batches.every(x=>x.data.inputs.every(v=>v.command&&!Object.hasOwn(v,'pressed')&&!Object.hasOwn(v,'trigger')&&!Object.hasOwn(v,'dt')))&&batches.some(x=>x.data.inputs.some(v=>v.moveActions.some(row=>row[1]&4))),'固定batchは移動押下ID/内容を持ち、旧pressed/射撃/client dtを混ぜない');
    details.pacing={renderFrames:240,seconds:1,batches:batches.length,actions:actions.map(x=>x.data),prediction:game.metrics().prediction};
    const holdNowDescriptor=Object.getOwnPropertyDescriptor(performance,'now'),holdTransport=game.state.transport,holdSend=holdTransport.send,held=[];
    let holdClock=performance.now();Object.defineProperty(performance,'now',{configurable:true,value:()=>holdClock});
    holdTransport.send=(type,data)=>{if(type==='inputActions')held.push(copy(data));return true;};
    try{
      t.resetPrediction(true);t.sendLocalInput({...input(1001),trigger:true},true,true);holdClock+=501;t.sendLocalInput({...input(1002),trigger:true},true,true);
    }finally{holdTransport.send=holdSend;if(holdNowDescriptor)Object.defineProperty(performance,'now',holdNowDescriptor);else delete performance.now;}
    test(held.length===2&&held[1].actionSeq>held[0].actionSeq&&held.every(x=>x.trigger&&Object.keys(x.pressed).length===0)&&held[1].sentAt-held[0].sentAt>=500,'controlのheld状態が未ackのまま500ms経過したら押下なしのfresh actionで再同期');
    details.heldRefresh=held;details.sourceChecks=sourceChecks;
    return {checks,details};
  });
  Object.assign(report.functional,result);
  for(const item of result.checks)ok(item.value,item.name);
  return {hostSteps,inputDelivery,...result};
}

check('自機入力予測・v9固定命令照合・遅延比較',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let active;
  const report={mode:TRANSPORT_MODE,usesRealWebRTC:!MOCK_TRANSPORT,productionNetworkPerformanceVerified:false,createdAt:new Date().toISOString(),
    commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    sourceHashes:Object.fromEntries(['prototype/index.html','prototype/online/game.js','prototype/online/transport.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')])),
    environment:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),browser:browser.version(),sameComputer:true,rendering:false,softwareGpu:true},
    method:{functional:'製品の共有移動/physics・v9固定queue/選択ACK・snapshot復元を独立fixtureで検証。host frameは可変dt、ゲスト予測/遠隔移動/replayは1/60秒。旧可変dtの対照はonline_prediction.test.jsに分離。',
      latency:'人工遅延は各方向50/100ms。実RAF、同一ゲストperformance.nowで入力投入→物理位置/描画groupが2cm超動く最初のframe。各条件5回以上。位置reset期間を補正集計から除く。',
      corrections:'snapshot受信直前の予測物理位置とsnapshot復元+replay後の位置の距離を独立観測。単位m。入力開始から停止がhostへ届いた後までを採取。再出撃などfixture resetは除外。',
      scope:MOCK_TRANSPORT?'BroadcastChannel代替経路の通信機能・人工遅延のみ。WebRTC/NAT/実回線性能は未検証。':'実WebRTC・ローカルPeerServer・同一PC。別PC/別回線/NAT接続成功・実回線性能は未検証。',
      subjective:'描画省略の機能latencyで、GPU描画・ディスプレイ発光時刻・実ユーザーPCの操作感・人による試遊を測ったものではない。'},functional:null,latency:[]};
  try{
    instrument(path.resolve(dir));
    if(!latencyOnly){
      active=await room(browser,h,errors,{guests:1,teamSize:2});
      report.functional=await functional(active,ok,report);
      await active.close();active=null;
    }
    if(!functionalOnly)for(const latencyMs of latencies){
      for(const enabled of [false,true])report.latency.push(await latencyCase(browser,h,errors,{latencyMs,enabled},ok));
      const off=report.latency.find(x=>x.oneWayInjectedMs===latencyMs&&!x.predictionEnabled),on=report.latency.find(x=>x.oneWayInjectedMs===latencyMs&&x.predictionEnabled);
      ok(on.visibleMovementMs.mean<off.visibleMovementMs.mean,`片道${latencyMs}msで予測ONの平均表示反応がOFFより短い`);
    }
  }finally{
    if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'online-prediction.json'),JSON.stringify(report,null,2));
  }
},{page:false});
