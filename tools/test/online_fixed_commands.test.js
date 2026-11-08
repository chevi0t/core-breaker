// node tools/test/online_fixed_commands.test.js
// 製品の固定命令scheduler/ACKをVMで検査。移動は線形代役、physicsの一致は別試験。
const assert=require('node:assert/strict');
const {loadHarness,predictionRateFixture}=require('./online_prediction_rates_fixture');
const DT=1/60;
function hostHarness(){
  const api=loadHarness(30),h=api.harness();
  const p={id:'g',unitId:'B:0',receivedSeq:0,appliedSeq:0,last:0,pendingEdges:{},fixedCommands:true};
  h.game.state.role='host';h.game.state.peers.set(p.id,p);
  Object.assign(h.units[0],{controller:'remoteHuman',ownerPeerId:p.id,onlineFixedMovement:true});
  const command=(seq,extra={})=>({...api.input(seq),command:true,trigger:undefined,movePressed:{},...extra});
  const tick=(time,dt=DT)=>{h.at(time);h.c.updateHumanUnit(h.units[0],{},dt);};
  return {api,h,p,command,tick};
}
for(const hz of [30,60,144,240]){
  const api=loadHarness(10),h=api.harness();
  for(let frame=1;frame<=hz;frame++){
    h.at(frame*1000/hz);
    h.test.stepLocalCommands({...api.input(frame),pressed:frame===1?{Space:true}:{}},1/hz);
  }
  assert.equal(h.game.state.seq,60,`${hz}Hzでも60命令`);
  const commands=h.test.getPrediction().pending;
  assert(commands.every(p=>p.input.command&&p.provisionalDt===DT));
  assert.equal(h.calls.filter(c=>c.pressed.Space).length,1,'短い移動押下を失わず1回');
  assert.equal(h.sent.filter(m=>m.type==='inputActions'&&m.data.pressed.Space).length,1);
  assert(h.sent.filter(m=>m.type==='inputBatch').every(m=>m.data.inputs.length<=5&&m.data.inputs.every(i=>i.dt===undefined)));
}
{
  const {h,p,command,tick}=hostHarness();
  h.test.acceptInputBatch(p,{inputs:[command(2),command(1,{movePressed:{Space:true}}),command(2)]});
  assert.equal(p.commandQueue.length,2,'逆順と重複再送を番号順に整理');
  tick(20);tick(40);tick(60);
  const moves=h.calls.filter(c=>c.hostMovement);
  assert.deepEqual(Array.from(moves,c=>c.seq),[1,2,2]);
  assert.equal(moves.filter(c=>c.pressed.Space).length,1,'held反復で押下を再実行しない');
  assert.equal(p.repeatedCommands,1);
  h.test.acceptInputBatch(p,{inputs:[command(1),command(2)]});assert.equal(p.commandQueue.length,0);
  h.test.acceptInput(p,command(10000));assert.equal(p.commandQueue.length,0,'過大seq飛躍を拒否');
  h.test.acceptInput(p,{...command(3),command:false});assert.equal(p.commandQueue.length,0,'固定対戦で旧可変入力を拒否');
}
{
  const {h,p,command,tick}=hostHarness();
  h.test.acceptInputBatch(p,{inputs:[command(1),command(3)]});
  tick(20);tick(30); // seq2はまだ欠落。seq3を先に確定しない。
  assert.equal(p.appliedSeq,1);
  h.at(35);h.test.acceptInput(p,command(2));tick(40);tick(60);
  assert.deepEqual(Array.from(h.calls.filter(c=>c.hostMovement),c=>c.seq),[1,1,2,3]);
  assert.equal(p.appliedSeq,3,'遅れて来た欠番をlatest5再送から復元');
}
{
  const {h,p,command,tick}=hostHarness();
  h.test.acceptInputBatch(p,{inputs:[command(1),command(3)]});tick(20);tick(80);
  assert.equal(p.appliedSeq,3,'欠番が50ms埋まらなければ有界に前進');
  h.at(300);tick(300);const last=h.calls.filter(c=>c.hostMovement).at(-1);
  assert.equal(Object.keys(last.pressed).length,0); // 250ms後はneutralにする。
  const before=h.units[0].pos.x;tick(320);assert.equal(h.units[0].pos.x,before);
}
{
  const {h,p,command,tick}=hostHarness();
  for(let seq=1;seq<=100;seq++)h.test.acceptInput(p,command(seq,{dt:1000}));
  assert.equal(p.commandQueue.length,30);assert.equal(p.droppedCommands,70);
  for(let frame=1;frame<=20;frame++)tick(frame*50,.05);
  const moves=h.calls.filter(c=>c.hostMovement),weapons=h.calls.filter(c=>c.hostWeapon);
  assert(moves.every(c=>c.dt===DT),'client dtを採用しない');
  assert(moves.length<=70,'追い付きは毎秒最大10命令追加');
  assert.equal(weapons.length,20,'catchupしても武器はhost frameに1回');
  assert(Math.abs(weapons.reduce((n,c)=>n+c.dt,0)-1)<1e-10,'武器時間は実host dtだけ');
}
{
  const {api,h,p,command,tick}=hostHarness();
  h.test.acceptInputActions(p,{...api.input(1,{Space:true,ShiftLeft:true,KeyH:true,KeyE:true}),actionSeq:1,trigger:true});
  h.test.acceptInputBatch(p,{inputs:[command(1,{actionSeq:1,movePressed:{Space:true,ShiftLeft:true}}),command(2,{actionSeq:1})]});
  tick(20);tick(25,1/144);tick(40);
  const moves=h.calls.filter(c=>c.hostMovement),weapons=h.calls.filter(c=>c.hostWeapon);
  assert.equal(moves.filter(c=>c.pressed.Space).length,1);
  assert.equal(moves.filter(c=>c.pressed.ShiftLeft).length,1);
  assert.equal(weapons.filter(c=>c.pressed.Space||c.pressed.ShiftLeft).length,0);
  assert.equal(h.calls.filter(c=>c.hostUtility&&c.pressed.KeyH).length,1);
  assert.equal(h.calls.filter(c=>c.hostUtility&&c.pressed.KeyE).length,1);
  assert.equal(p.appliedActionSeq,1);
  h.test.acceptInputActions(p,{...api.input(1,{KeyH:true}),actionSeq:1});tick(60);
  assert.equal(h.calls.filter(c=>c.hostUtility&&c.pressed.KeyH).length,1,'control再送で操作重複なし');
}
{
  const {h,p,command,tick}=hostHarness();
  h.test.acceptInputBatch(p,{inputs:[command(1),command(2)]});tick(20);
  h.units[0].lifeId=2;
  h.test.acceptInput(p,command(3));assert.equal(p.inputLifeId,1,'古い命の入力を拒否');
  h.test.acceptInput(p,command(4,{lifeId:2}));
  assert.equal(p.inputLifeId,2);assert.equal(p.commandQueue.length,1);assert.equal(p.fixedStarted,false);
  assert.equal(p.lastCommand,null);assert.equal(p.fixedClock,0);
}
// 144Hzと長い50ms frameが交互でも、残余時間を切り捨てない。
{
  const api=loadHarness(10),h=api.harness();let time=0,total=0;
  for(let i=0;i<200;i++){
    const dt=i%2?.05:1/144;total+=dt;time+=dt*1000;h.at(time);
    h.test.stepLocalCommands(api.input(i+1),dt);
  }
  assert.equal(h.game.state.seq,Math.floor((total+1e-9)/DT));
}
// latest5を超えてmovement線が欠落しても、reliable押下を後続固定stepで1回復元する。
{
  const {api,h,p,command,tick}=hostHarness();
  h.test.acceptInputActions(p,{...api.input(1,{Space:true}),actionSeq:1});
  h.at(120);h.test.acceptInputBatch(p,{inputs:[command(8,{sentAt:120,actionSeq:1}),command(9,{sentAt:120,actionSeq:1})]});
  tick(130);tick(150);tick(170);
  assert.equal(h.calls.filter(c=>c.hostMovement&&c.pressed.Space).length,1);
  assert.equal(p.appliedMovementActionSeq,1);
  h.test.acceptInputActions(p,{...api.input(1,{Space:true}),actionSeq:1});tick(190);
  assert.equal(h.calls.filter(c=>c.hostMovement&&c.pressed.Space).length,1);
}
// 非再送線の押下2がreliable押下1を追い越しても、両方を別々に1回適用する。
{
  const {api,h,p,command,tick}=hostHarness();h.at(100);
  h.test.acceptInputBatch(p,{inputs:[command(2,{sentAt:100,actionSeq:2,moveActionSeq:2,movePressed:{ShiftLeft:true}}),command(3,{sentAt:100,actionSeq:2})]});
  tick(120);h.at(130);h.test.acceptInputActions(p,{...api.input(1,{Space:true}),sentAt:100,actionSeq:1});tick(140);
  assert.equal(h.calls.filter(c=>c.hostMovement&&c.pressed.Space).length,1);
  assert.equal(h.calls.filter(c=>c.hostMovement&&c.pressed.ShiftLeft).length,1);
  assert(p.appliedMovementIds.has(1)&&p.appliedMovementIds.has(2));
  const guest=api.harness();api.reconcile(guest,api.snapshot(guest));
  guest.test.predictLocalInput({...api.input(1,{Space:true}),command:true,moveActionSeq:1,actionSeq:1},DT);
  guest.test.predictLocalInput({...api.input(2,{ShiftLeft:true}),command:true,moveActionSeq:2,actionSeq:2},DT);
  api.reconcile(guest,api.snapshot(guest,2,{}, {fixed:true,seq:2,seqDt:DT,step:1,totalDt:DT,actionSeq:2,movementSeq:2,movementIds:[2]}));
  assert(guest.test.getPrediction().actionEdges.some(e=>e.actionSeq===1),'選択ACKで未適用の古い押下を残す');
}
// 240HzのSpace→Shiftが同じ固定命令に入ってもIDと内容を混同しない。
{
  const {api,h,p,tick}=hostHarness(),guest=api.harness();
  for(let frame=1;frame<=8;frame++){
    guest.at(frame*1000/240);guest.test.stepLocalCommands({...api.input(frame),pressed:frame===1?{Space:true}:frame===2?{ShiftLeft:true}:{}},1/240);
  }
  const batch=guest.sent.filter(m=>m.type==='inputBatch').at(-1);
  assert.equal(batch.data.inputs[0].moveActions.length,2);
  h.at(40);h.test.acceptInputBatch(p,batch.data);tick(60);
  // movementが先着し、その後controlがまとめて到着する。
  h.at(65);for(const action of guest.sent.filter(m=>m.type==='inputActions'))h.test.acceptInputActions(p,action.data);
  tick(80);tick(100);
  assert.equal(h.calls.filter(c=>c.hostMovement&&c.pressed.Space).length,1);
  assert.equal(h.calls.filter(c=>c.hostMovement&&c.pressed.ShiftLeft).length,1);
}
// inputAcksはcodecの単一原子。選択ACKを0→128→0件にしてもschemaは不変。
{
  const {Encoder,Decoder}=require('../../prototype/online/codec'),encoder=new Encoder(),decoder=new Decoder();let bases=0;
  for(let i=0;i<=129;i++){
    const ids=Array.from({length:i===129?0:i},(_,n)=>n+1);
    const snapshot={frame:i,time:i*16,inputAcks:{'B:0':{fixed:true,seq:i,movementIds:ids}}};
    const result=encoder.encode(snapshot);if(result.baseline){bases++;assert(decoder.seed(result.baseline));}
    assert.deepEqual(decoder.decode(result.delta).inputAcks['B:0'].movementIds,ids);
  }
  assert.equal(bases,1);
  const e=new Encoder(),base={frame:1,time:1,inputAcks:{'B:0':{fixed:true,seq:1,movementIds:[]}}};
  const empty=e.encode(base),full=e.encode({...base,inputAcks:{'B:0':{fixed:true,seq:1,movementIds:Array.from({length:128},(_,i)=>i+1)}}});
  console.log('選択ACK 128件のJSON delta増分:',Buffer.byteLength(JSON.stringify(full.delta))-Buffer.byteLength(JSON.stringify(empty.delta)),'bytes（このfixture、ID1〜128）');
}
// ACKを先に返した0step frameでもutilityは次の移動直前まで残す。
{
  const {api,h,p,command,tick}=hostHarness();
  h.test.acceptInputBatch(p,{inputs:[command(1),command(2)]});tick(20);
  h.test.acceptInputActions(p,{...api.input(1,{KeyH:true,KeyE:true}),actionSeq:1});
  tick(25,1/144);assert.equal(p.appliedActionSeq,1);
  assert.equal(h.calls.filter(c=>c.hostUtility).length,0);
  tick(40);const utilityIndex=h.calls.findIndex(c=>c.hostUtility);
  assert(utilityIndex>=0&&h.calls[utilityIndex+1].hostMovement,'utilityはphysicsより先');
  assert.equal(h.calls.filter(c=>c.hostUtility).length,1);
}
// 2.1秒のmovement線欠落後、正常60Hzのseqへ復帰できる。
{
  const {h,p,command,tick}=hostHarness();
  h.test.acceptInputBatch(p,{inputs:[command(1),command(2)]});tick(20);
  h.at(2120);h.test.acceptInputBatch(p,{inputs:[command(126,{sentAt:2120}),command(127,{sentAt:2120})]});
  assert.equal(p.receivedSeq,127);tick(2180);assert.equal(p.appliedSeq,126);
}
// 無限にqueueを補充しても、repeat込みの総移動時間はhost時間+2tick以内。
{
  const {h,p,command,tick}=hostHarness();let seq=0;
  for(let frame=1;frame<=600;frame++){
    h.at(frame*1000/60);
    for(let n=0;n<3;n++)h.test.acceptInput(p,command(++seq,{sentAt:frame*1000/60}));
    tick(frame*1000/60);
    assert(p.fixedSteps<=Math.floor((p.fixedElapsed+1e-9)/DT)+2);
  }
  assert(p.fixedSteps<=602);assert(p.droppedCommands>0);
}
// 実physicsとstartTransferを使い、H+Spaceがjumpを先に実行しないことを確認。
{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
  const filename=path.join(__dirname,'online_movement.test.js'),source=fs.readFileSync(filename,'utf8');
  const context={require:createRequire(filename),console};vm.createContext(context);
  vm.runInContext(source.slice(0,source.indexOf('let count=0;'))+'\nthis.api={harness,makeUnit,section};',context);
  const physics=context.api.harness(),u=context.api.makeUnit();
  Object.assign(physics.c,{movementSpread:()=>0,inOwnBase:()=>false,areaTime:()=>3,isHumanControlled:()=>true,clock:()=>0,AREA_CD:40});
  vm.runInContext(context.api.section('function startTransfer(','function cancelTransfer('),physics.c);
  const {api,h,p,command,tick}=hostHarness();
  Object.assign(u,{entityId:'B:0',lifeId:1,controller:'remoteHuman',ownerPeerId:'g',onlineFixedMovement:true});
  h.units[0]=u;h.c.player=u;
  h.c.updateHumanMovement=(...args)=>physics.c.updateHumanMovement(...args);
  h.c.humanUtilityInput=(...args)=>physics.c.humanUtilityInput(...args);
  h.c.movementStatusTick=(...args)=>physics.c.movementStatusTick(...args);
  h.test.acceptInputActions(p,{...api.input(1,{KeyH:true,Space:true}),actionSeq:1});
  h.test.acceptInputBatch(p,{inputs:[command(1,{actionSeq:1,moveActionSeq:1,movePressed:{Space:true}}),command(2,{actionSeq:1})]});
  tick(20);assert(u.transfer,'地上の転送開始を先に実行');assert.equal(u.pos.y,0);assert(u.onGround);
  // 同じ総時間の3固定stepではcharger消費もzipRideも3回だが武器は1回。
  for(const kind of ['charger','zip']){
    const actual=context.api.harness(),mech=context.api.makeUnit(kind==='charger'?{chargerOn:true}:{zip:{}});
    actual.c.movementSpread=()=>0;let consumed=0;
    actual.c.spUse=(_slot,amount)=>{actual.calls.sp++;consumed+=amount;};
    for(let step=0;step<3;step++)actual.c.updateHumanMovement(mech,{keys:{KeyW:true,ShiftLeft:kind==='charger'},pressed:{}},DT,{movementOnly:true});
    actual.c.updateHumanUnit(mech,{keys:{},pressed:{}},.05,{movementDone:true,utilityDone:true});
    assert.equal(actual.calls.weapon,1);
    if(kind==='charger'){assert.equal(actual.calls.sp,3);assert(Math.abs(consumed-1.25)<1e-9);}
    else assert.equal(actual.calls.facility,3);
  }
}
// 本番の「移動済み」分岐が武器の時間を固定tickへすり替えないことも静的に確認。
{
  const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../prototype/index.html'),'utf8');
  assert(html.includes('if(!u.onlineFixedMovement)movementStatusTick(u,dt)'));
  assert(html.includes('movementDone?{busy:u.repairing||!!u.transfer,artillery:isArtilleryMode(u)}:updateHumanMovement(u, input, dt)'));
  assert(html.includes('const res = weaponsTick(u, dt,'));
}
for(const [hostHz,guestHz] of [[60,60],[60,144],[144,60],[60,240],[30,144]]){
  for(const scenario of [{},{turnMs:100},{burstMs:150},{turnMs:100,burstMs:150},{snapshotGap:[1000,1150]},{hostPhaseMs:5,guestPhaseMs:2}]){
    const result=predictionRateFixture({hostHz,guestHz,durationMs:2000,...scenario});
    assert(result.correctionMax<1e-8,`${hostHz}/${guestHz} ${JSON.stringify(scenario)} の不要な位置補正`);
    assert.equal(result.hardSnaps,0);assert(result.fixedDtOnly);
    assert.equal(result.hostWeaponSteps,Math.floor(hostHz*2-(scenario.hostPhaseMs?hostHz*scenario.hostPhaseMs/1000:0)));
    assert(Math.abs(result.hostWeaponSeconds-result.hostWeaponSteps/hostHz)<1e-8);
  }
}
console.log('固定移動命令：生成Hz独立・重複/欠番/旧命/seq検査・反復押下一度・積滞上限・武器時間・30組の照合回帰 成功');
