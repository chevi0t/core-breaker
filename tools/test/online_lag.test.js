// WebGL/通信なしで製品の時刻検証と本物のthree.js colliderを検査する。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../../vendor/three-r128/three.min.js');
const {limits,validateViewTime,ColliderHistory}=require('../../prototype/online/lag-compensation');
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('巻戻し: '+name);};
function clock(extra={}){return {now:1000,sentAt:975,receivedAt:1000,rttMs:50,snapshots:new Map([[1,900],[2,700]]),...extra};}
const view=(extra={})=>({time:850,frame:1,delayMs:100,...extra});
check('申告はhost写真時計、受信時のRTT+補間から評価',()=>{
  const result=validateViewTime(view(),clock());assert.equal(result.ok,true);assert.equal(result.time,850);assert.equal(result.clamped,false);
  // performance.nowの原点に依存しない。全host時計を同じだけ移す。
  const base=1e8,shift=validateViewTime(view({time:850+base}),clock({now:1000+base,sentAt:975+base,receivedAt:1000+base,snapshots:new Map([[1,900+base]])}));
  assert.equal(shift.ageMs,result.ageMs);
});
check('妥当な200ms超表示は200msに丸め、欠落復旧も無制限に戻さない',()=>{
  const r=validateViewTime(view({time:650,frame:2}),clock({rttMs:200,sentAt:900}));assert.equal(r.ok,true);assert.equal(r.clamped,true);assert.equal(r.time,800);assert.equal(r.ageMs,200);
  const ancient=validateViewTime(view({time:-100000,frame:2}),clock());assert.equal(ancient.ok,true);assert(ancient.time>=800);
});
check('低RTT/短い補間の不正申告に最大200msを与えない',()=>{
  const r=validateViewTime(view({time:-1e9,delayMs:60}),clock({rttMs:0,sentAt:1000}));assert.equal(r.ok,true);assert.equal(r.clamped,true);assert.equal(r.ageMs,110);assert.equal(r.time,890);
  const {u,mesh}=unit(),h=history();for(let t=750;t<=1000;t+=10){move(u,t/10);h.capture(t,[u],[mesh]);}
  h.withRewind(r.time,[u],null,()=>close(mesh.matrixWorld.elements[12],89));close(mesh.matrixWorld.elements[12],100);
});
check('未来/不正値/未知写真/外挿100ms超/保持入力の古い時刻は拒否',()=>{
  for(const bad of [{time:NaN},{time:Infinity},{time:1001},{time:990,frame:2},{frame:999},{frame:1.5},{delayMs:59},{delayMs:201}])assert.equal(validateViewTime(view(bad),clock()).ok,false,JSON.stringify(bad));
  for(const bad of [{rttMs:null},{rttMs:-1},{rttMs:Infinity},{receivedAt:1001},{now:1501},{sentAt:1}])assert.equal(validateViewTime(view(),clock(bad)).ok,false,JSON.stringify(bad));
});
function unit(id='target'){
  const group=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(1,2,1),new T.MeshBasicMaterial());mesh.position.y=1;group.add(mesh);
  const u={entityId:id,group,pos:new T.Vector3(),vel:new T.Vector3(),hp:100,alive:true,lifeId:1,downT:0,onlineMotionEpoch:0,onlineLagEpoch:0,mech:{head:'a'},slots:{main:{w:{key:'ar'}}}};
  mesh.userData.ref=u;group.updateMatrixWorld(true);return {u,mesh};
}
function history(extra={}){return new ColliderHistory(T,{refOf:m=>m.userData.ref,...extra});}
function move(u,x){u.pos.x=x;u.group.position.x=x;u.group.updateMatrixWorld(true);}
check('可変時間刻みの位置と向きで当たり、現在のpos/HP/世界行列を復旧',()=>{
  const {u,mesh}=unit(),h=history(),ray=new T.Raycaster(new T.Vector3(5,1,10),new T.Vector3(0,0,-1));
  h.capture(0,[u],[mesh]);move(u,10);h.capture(100,[u],[mesh]);const before=mesh.matrixWorld.elements.slice();
  assert.equal(ray.intersectObjects([mesh]).length,0);
  let called=0;
  const hit=h.withRewind(50,[u],null,()=>{called++;assert.equal(u.pos.x,10);assert.equal(u.hp,100);close(mesh.matrixWorld.elements[12],5);return ray.intersectObjects([mesh])[0];});
  assert(hit);assert.equal(called,1);assert.equal(h.lastRewound,1);assert.deepEqual(mesh.matrixWorld.elements,before);assert.equal(u.pos.x,10);
  assert.throws(()=>h.withRewind(50,[u],null,()=>{throw Error('ray failure');}),/ray failure/);assert.deepEqual(mesh.matrixWorld.elements,before);
});
check('機体別の表示時刻で一度だけcastし、射手/非掲載機を現状維持、例外でも全復元',()=>{
  const a=unit('a'),b=unit('b'),hidden=unit('hidden'),shooter=unit('shooter'),all=[a,b,hidden,shooter],units=all.map(v=>v.u),meshes=all.map(v=>v.mesh),h=history();
  h.capture(0,units,meshes);all.forEach((v,i)=>move(v.u,(i+1)*10));h.capture(100,units,meshes);
  const before=all.map(v=>v.mesh.matrixWorld.elements.slice()),times=new Map([['a',25],['b',75],['shooter',0]]);
  let calls=0;
  const inspect=()=>{
    calls++;close(a.mesh.matrixWorld.elements[12],2.5);close(b.mesh.matrixWorld.elements[12],15);
    close(hidden.mesh.matrixWorld.elements[12],30);close(shooter.mesh.matrixWorld.elements[12],40);
    assert.deepEqual(units.map(u=>u.pos.x),[10,20,30,40]);assert.equal(h.lastRewound,2);return '一度の射線';
  };
  assert.equal(h.withRewind(50,units,shooter.u,inspect,times),'一度の射線');assert.equal(calls,1);
  all.forEach((v,i)=>assert.deepEqual(v.mesh.matrixWorld.elements,before[i]));
  assert.throws(()=>h.withRewind(50,units,shooter.u,()=>{inspect();throw Error('機体別cast失敗');},times),/機体別cast失敗/);assert.equal(calls,2);
  all.forEach((v,i)=>assert.deepEqual(v.mesh.matrixWorld.elements,before[i]));
});
check('life/移動/死亡蘇生epoch/機体構成/新colliderを跨がない',()=>{
  for(const patch of [{lifeId:2},{onlineMotionEpoch:1},{onlineLagEpoch:2},{mech:{head:'b'}},{alive:false},{downT:1}]){
    const {u,mesh}=unit(),h=history();h.capture(0,[u],[mesh]);move(u,10);h.capture(100,[u],[mesh]);Object.assign(u,patch);
    h.withRewind(50,[u],null,()=>close(mesh.matrixWorld.elements[12],10));assert.equal(h.lastRewound,0);
  }
  const {u,mesh}=unit(),h=history(),meshes=[mesh];h.capture(0,[u],meshes);move(u,10);h.capture(100,[u],meshes);
  const added=new T.Mesh(mesh.geometry,mesh.material);added.userData.ref=u;u.group.add(added);meshes.push(added);
  h.withRewind(50,[u],null,()=>close(mesh.matrixWorld.elements[12],10));assert.equal(h.lastRewound,0);
});
check('現在死んだ相手/過去死んでいた相手/射手を巻戻さない',()=>{
  const {u,mesh}=unit(),h=history();u.alive=false;h.capture(0,[u],[mesh]);u.alive=true;move(u,10);h.capture(100,[u],[mesh]);
  h.withRewind(50,[u],null,()=>close(mesh.matrixWorld.elements[12],10));assert.equal(h.lastRewound,0);
  h.clear();h.capture(0,[u],[mesh]);move(u,20);h.capture(100,[u],[mesh]);h.withRewind(50,[u],u,()=>close(mesh.matrixWorld.elements[12],20));assert.equal(h.lastRewound,0);
});
check('骨付き被弾頂点・lazy cache・矩形境界も例外後に復旧',()=>{
  const {u,mesh}=unit(),bone={matrix:new T.Matrix4()},geometry=new T.BoxGeometry(1,1,1),range={bone,hitPrevious:new Float64Array(16).fill(2)};
  const entry={mesh:{geometry},ranges:[range],hitBounds:new T.Box3(new T.Vector3(-1,-1,-1),new T.Vector3(1,1,1))};
  u.rig={list:[bone],hitMeshes:[entry]};mesh.userData.hitGeometry=geometry;
  const skinHit=e=>{e.mesh.geometry.attributes.position.array[0]=e.ranges[0].bone.matrix.elements[13];e.ranges[0].hitPrevious.fill(9);e.hitBounds.min.set(100,100,100);e.mesh.geometry.boundingBox=null;};
  const h=history({skinHit});h.capture(0,[u],[mesh]);bone.matrix.makeTranslation(0,2,0);move(u,10);h.capture(100,[u],[mesh]);
  const before={matrix:mesh.matrixWorld.elements.slice(),bone:bone.matrix.elements.slice(),position:geometry.attributes.position.array.slice(),normal:geometry.attributes.normal.array.slice(),previous:range.hitPrevious.slice(),box:entry.hitBounds.clone()};
  assert.throws(()=>h.withRewind(50,[u],null,()=>{close(bone.matrix.elements[13],1);close(geometry.attributes.position.array[0],1);throw Error('damage must wait');}),/damage must wait/);
  assert.deepEqual(mesh.matrixWorld.elements,before.matrix);assert.deepEqual(bone.matrix.elements,before.bone);assert.deepEqual(geometry.attributes.position.array,before.position);assert.deepEqual(geometry.attributes.normal.array,before.normal);assert.deepEqual(range.hitPrevious,before.previous);assert(entry.hitBounds.equals(before.box));
});
check('初回lazy境界生成を復旧した後も次の通常castが動く',()=>{
  const source=fs.readFileSync(require.resolve('../../prototype/index.html'),'utf8'),from=source.indexOf('function mechHitBounds(entry)'),to=source.indexOf('function skinMechHit(entry)',from);
  const c={Map,T,mechHitBox:new T.Box3(),mechHitPoint:new T.Vector3()};vm.createContext(c);vm.runInContext(source.slice(from,to),c);
  const {u,mesh}=unit(),bone={matrix:new T.Matrix4()},geometry=new T.BoxGeometry(1,1,1),pos=geometry.attributes.position.array.slice();
  const entry={mesh:{geometry},pos,ranges:[{bone,start:0,end:pos.length}]};u.rig={list:[bone],hitMeshes:[entry]};
  const h=history();h.capture(0,[u],[mesh]);move(u,10);h.capture(100,[u],[mesh]);
  h.withRewind(50,[u],null,()=>assert(c.mechHitBounds(entry)));assert.equal(entry.hitBounds,undefined);assert.equal(entry.boundGroups,undefined);
  assert.doesNotThrow(()=>c.mechHitBounds(entry));assert(entry.hitBounds&&entry.boundGroups);
});
check('準備中の例外でも先に巻戻した対象まで復旧',()=>{
  const a=unit('a'),b=unit('b'),h=history({skinHit:()=>{throw Error('skin failure');}}),bone={matrix:new T.Matrix4()},g=new T.BoxGeometry(1,1,1);
  b.u.rig={list:[bone],hitMeshes:[{mesh:{geometry:g},ranges:[{bone}]}]};
  h.capture(0,[a.u,b.u],[a.mesh,b.mesh]);move(a.u,10);move(b.u,20);h.capture(100,[a.u,b.u],[a.mesh,b.mesh]);
  assert.throws(()=>h.withRewind(50,[a.u,b.u],null,()=>assert.fail('cast前に失敗する')),/skin failure/);
  close(a.mesh.matrixWorld.elements[12],10);close(b.mesh.matrixWorld.elements[12],20);assert.equal(a.u.pos.x,10);assert.equal(b.u.pos.x,20);
});
check('250ms履歴と件数上限、履歴外は現在判定',()=>{
  const {u,mesh}=unit(),h=history();let t=0;
  for(let i=0;i<1000;i++){t+=[3,17,50][i%3];move(u,i);h.capture(t,[u],[mesh]);}
  assert(h.frames.length<=limits.maxFrames);assert(h.frames[0].time>=t-250);assert(h.frames.some(f=>f.time<=t-200));
  h.withRewind(t-1000,[u],null,()=>close(mesh.matrixWorld.elements[12],999));assert.equal(h.lastRewound,0);
  for(let i=0;i<500;i++)h.capture(t+i*.01,[u],[mesh]);assert.equal(h.frames.length,limits.maxFrames);
  h.capture(t+1000,[u],[mesh]);assert.equal(h.frames.length,1);h.withRewind(t+800,[u],null,()=>close(mesh.matrixWorld.elements[12],999));assert.equal(h.lastRewound,0);
  h.clear();assert.equal(h.frames.length,0);
});
check('製品shotのcontextは手持ちgunだけ、throwでも解除',()=>{
  const source=fs.readFileSync(require.resolve('../../prototype/online/game'),'utf8'),from=source.indexOf('  const oldShot=shot;'),to=source.indexOf('  const oldShoot=',from);
  const c={hitscanContext:null,damageInputSeq:null,effectSource:null,effectTarget:null,state:{role:'offline'},emit:()=>{},shot:(u,sl)=>{assert.equal(c.hitscanContext?.unit===u,!!sl.expected);if(sl.throws)throw Error('shot failure');}};vm.createContext(c);vm.runInContext(source.slice(from,to),c);
  const u={controller:'remoteHuman',entityId:'remote'};
  for(const [w,expected]of [[{type:'gun'},true],[{type:'gun',proj:{}},false],[{type:'sword'},false],[{type:'escort'},false]]){c.shot(u,{w,expected});assert.equal(c.hitscanContext,null);}
  c.shot({controller:'bot'},{w:{type:'gun'},expected:false});assert.throws(()=>c.shot(u,{w:{type:'gun'},expected:true,throws:true}),/shot failure/);assert.equal(c.hitscanContext,null);
});
function gameHarness(){
  let time=1000;const empty=()=>{},shooter=unit('B:0'),target=unit('R:0'),sent=[];
  Object.assign(shooter.u,{controller:'remoteHuman',ownerPeerId:'guest',team:'B',yaw:0,pitch:0});Object.assign(target.u,{team:'R',yaw:0,pitch:0});
  const c={T,CBOnlineVisibility:require('../../prototype/online/visibility'),spotted:{B:new Map(),R:new Map()},noticed:()=>false,canSee:()=>true,targetPoint:u=>u.pos.clone().add(new T.Vector3(0,1,0)),CBOnlineLagComp:require('../../prototype/online/lag-compensation'),CBOnlineCodec:require('../../prototype/online/codec'),MAPS:{mesa:{name:'台地',team:5,time:300}},
    Map,Set,Date,Math,Number,console,setTimeout,clearTimeout,performance:{now:()=>time},window:{},SLOTS:['main'],WEAPONS:{},CLASSES:{assault:{main:'ar'},heavy:{main:'ar'}},
    units:[shooter.u,target.u],hittables:[shooter.mesh,target.mesh],player:shooter.u,addEventListener:empty,weaponLook:empty,tracer:empty,boom:empty,impact:empty,sfx:empty,finish:empty,shoot:empty,blast:empty,damage:empty,
    shot:(u,sl,aim)=>{c.lastShotAim=aim?.toArray();c.lastShotRecoil=u.cameraRecoil;return c.window.CBOnlineGame.castHitscan(u,new T.Vector3(),new T.Vector3(0,0,-1),sl.w);},castFrom:()=>target.mesh.matrixWorld.elements[12],refOf:m=>m.userData.ref};
  let source=fs.readFileSync(require.resolve('../../prototype/online/game'),'utf8');
  source=source.replace('  window.CBOnlineGame={create',`  window.__lagTest={captureLagHistory,rememberLagSnapshot,replicationFor,rememberPeerSnapshot,acceptInput,acceptInputActions,recordHostInputStep,sendLocalInput,interpolateRemotePose,lagHistory,setRender:time=>{interpolation.renderTime=time;},rendered:()=>lastRenderedView};\n  window.CBOnlineGame={create`);
  vm.createContext(c);vm.runInContext(source,c);const game=c.window.CBOnlineGame,test=c.window.__lagTest;
  Object.assign(game.state,{role:'host',phase:'playing',transport:{clock:()=>({rttMs:50,offsetMs:0}),send:(type,payload)=>{sent.push({type,payload});return true;},metrics:()=>({})}});
  const p={id:'guest',unitId:shooter.u.entityId,inputLifeId:1,receivedSeq:0};game.state.peers.set('guest',p);
  return {c,game,test,p,shooter,target,sent,at:t=>time=t};
}
check('製品input受信でclient受信時刻を捨て、shotのみ巻戻し、現在復旧',()=>{
  const h=gameHarness(),u=h.shooter.u;
  move(h.target.u,0);h.test.captureLagHistory(850);move(h.target.u,10);h.test.captureLagHistory(1000);h.test.rememberLagSnapshot({frame:1,time:900});
  h.test.acceptInput(h.p,{seq:1,lifeId:1,sentAt:975,receivedAt:-1e9,view:view(),yaw:0,pitch:0,aimPoint:[0,0,-10],keys:{}});
  assert.equal(h.p.input.receivedAt,1000);u.controlInput=h.p.input;
  assert.equal(h.c.shot(u,{w:{type:'gun'}}),0);close(h.target.mesh.matrixWorld.elements[12],10);assert.equal(h.game.metrics().lagCompensation.rewinds,1);
  // fireを直接使う設置銃にはshot contextがない。
  assert.equal(h.game.castHitscan(u,new T.Vector3(),new T.Vector3(),{type:'gun'}),10);assert.equal(h.game.metrics().lagCompensation.rewinds,1);
  u.controlInput={...u.controlInput,lifeId:0};assert.equal(h.c.shot(u,{w:{type:'gun'}}),10);assert.equal(h.game.metrics().lagCompensation.reasons.input,1);
});
check('当該peerの成功送信だけを巻戻し根拠にし、他peer/未送信/秘匿状態は使わない',()=>{
  const h=gameHarness(),u=h.shooter.u,target=h.target.u,other={id:'other',unitId:'B:1'};
  h.game.state.peers.set(other.id,other);
  move(target,0);h.test.captureLagHistory(850);move(target,10);h.test.captureLagHistory(1000);
  // global履歴は存在しても、replicationのあるpeerでは根拠にしない。
  h.test.rememberLagSnapshot({frame:1,time:850});
  const r=h.test.replicationFor(h.p),otherR=h.test.replicationFor(other),delta=[h.c.CBOnlineCodec.VERSION,1,''];
  const record=()=>({time:850,baseId:1,delta:JSON.stringify(delta),visible:new Map([[u.entityId,1],[target.entityId,1]]),updates:new Map([[target.entityId,{time:850,epoch:1,lifeId:1,motionEpoch:0,lagEpoch:0}]])});
  r.epochs.set(u.entityId,1);r.epochs.set(target.entityId,1);
  otherR.queued.set(1,record());h.test.rememberPeerSnapshot(other.id,{frame:1,delta});
  assert.equal(otherR.sent.size,1);assert.equal(r.sent.size,0);
  h.test.acceptInput(h.p,{seq:1,lifeId:1,sentAt:975,view:view(),yaw:0,pitch:0,aimPoint:[0,0,-10],keys:{}});u.controlInput=h.p.input;
  const cast=()=>h.c.shot(u,{w:{type:'gun'}});
  assert.equal(cast(),10);assert.equal(h.game.metrics().lagCompensation.reasons.anchor,1);
  r.queued.set(1,record());assert.equal(cast(),10);assert.equal(r.sent.size,0);
  h.test.rememberPeerSnapshot(h.p.id,{frame:1,delta:[delta[0],2,'']});assert.equal(r.sent.size,0);assert.equal(r.queued.size,1);
  h.test.rememberPeerSnapshot(h.p.id,{frame:1,delta:[delta[0],1,'別の差分']});assert.equal(r.sent.size,0);assert.equal(r.queued.size,1);
  h.test.rememberPeerSnapshot(h.p.id,{frame:1,delta});assert.equal(r.queued.size,0);assert.equal(r.sent.size,1);
  assert.equal(cast(),0);close(h.target.mesh.matrixWorld.elements[12],10);
  r.sent.get(1).visible.delete(target.entityId);assert.equal(cast(),10);
  r.sent.get(1).visible.set(target.entityId,1);r.epochs.set(target.entityId,2);assert.equal(cast(),10);
  // 再公開epochの過去像へ以前の送信履歴を流用しない。
  assert.equal(otherR.sent.size,1);assert.equal(h.game.metrics().lagCompensation.rewinds,1);
});
check('tuple省略でも最後の送信姿勢から100ms超を巻戻しに使わない',()=>{
  const h=gameHarness(),u=h.shooter.u,target=h.target.u,r=h.test.replicationFor(h.p),delta=[h.c.CBOnlineCodec.VERSION,1,''];
  move(target,0);h.test.captureLagHistory(800);move(target,10);h.test.captureLagHistory(1000);
  r.epochs.set(target.entityId,1);
  const sent=(frame,time,updateTime)=>{
    const updates=new Map(updateTime===null?[]:[[target.entityId,{time:updateTime,epoch:1,lifeId:1,motionEpoch:0,lagEpoch:0}]]);
    r.queued.set(frame,{time,baseId:1,delta:JSON.stringify(delta),visible:new Map([[target.entityId,1]]),updates});
    h.test.rememberPeerSnapshot(h.p.id,{frame,delta});
  };
  sent(1,650,650);sent(2,950,null);
  h.test.acceptInput(h.p,{seq:1,lifeId:1,sentAt:975,view:view({time:900,frame:2}),yaw:0,pitch:0,aimPoint:[0,0,-10],keys:{}});u.controlInput=h.p.input;
  assert.equal(h.c.shot(u,{w:{type:'gun'}}),10);assert.equal(h.game.metrics().lagCompensation.rewinds,0);
  // 同じanchorでも実更新が850msにあれば、900msの姿勢は許可範囲へ戻る。
  sent(3,850,850);sent(4,950,null);h.p.input.view=view({time:900,frame:4});
  close(h.c.shot(u,{w:{type:'gun'}}),5);close(h.target.mesh.matrixWorld.elements[12],10);assert.equal(h.game.metrics().lagCompensation.rewinds,1);
});
check('製品guest入力は未描画時計でなく、直前afterFrameの時刻を申告',()=>{
  const h=gameHarness();h.game.state.role='guest';h.game.state.lastSnapshot={frame:10};h.test.setRender(850);h.game.afterFrame(.016,1000);
  h.test.setRender(875);h.test.sendLocalInput({seq:1,keys:{},pressed:{},yaw:0,pitch:0,aimPoint:[0,0,-100]});
  const movement=h.sent.find(x=>x.type==='inputBatch').payload.inputs[0];assert.equal(movement.view.time,850);assert.equal(movement.view.frame,10);assert.equal(movement.sentAt,1000);
  h.game.afterFrame(.016,1016);h.at(1016.7);h.test.sendLocalInput({seq:2,keys:{},pressed:{},yaw:0,pitch:0,aimPoint:[0,0,-100]});
  assert.equal(h.sent.filter(x=>x.type==='inputBatch').at(-1).payload.inputs.at(-1).view.time,875);
});
check('相手機のしゃがみ/tiltは写真と同時刻の値を描画へ渡す',()=>{
  const h=gameHarness(),u=h.target.u;
  h.test.interpolateRemotePose(u,{crouching:false,renderCrouch:0,tilt:0,vel:[0,0,0]},{crouching:true,renderCrouch:.6,tilt:.4,vel:[0,0,0]},.5);
  close(u.onlineRenderCrouch,.3);close(u.tilt,.2);
});
check('control後着でも初回照準/表示時刻/反動を対にし、継続は最新movement',()=>{
  const h=gameHarness(),u=h.shooter.u,w={type:'gun'},common={lifeId:1,sentAt:975,yaw:0,pitch:0,keys:{},pressed:{}};
  move(h.target.u,0);h.test.captureLagHistory(850);move(h.target.u,10);h.test.captureLagHistory(1000);h.test.rememberLagSnapshot({frame:1,time:900});
  h.test.acceptInput(h.p,{...common,seq:5,actionSeq:1,aimPoint:[100,3,0],view:view({time:950}),cameraRecoil:.2});
  h.test.acceptInputActions(h.p,{...common,seq:1,actionSeq:1,trigger:true,aimPoint:[-50,3,0],view:view(),cameraRecoil:.1});
  u.controlInput=h.game.remoteInput(u);u.yaw=1;u.cameraRecoil=.2;
  assert.equal(h.c.shot(u,{w},new T.Vector3(100,3,0)),0);assert.deepEqual(h.c.lastShotAim,[-50,3,0]);assert.equal(h.c.lastShotRecoil,.1);assert.equal(u.yaw,1);assert.equal(u.cameraRecoil,.2);assert.equal(h.p.pendingShot,null);
  h.test.recordHostInputStep(u,u.controlInput,.016);u.controlInput=h.game.remoteInput(u);
  close(h.c.shot(u,{w},new T.Vector3(100,3,0)),10*2/3);assert.deepEqual(h.c.lastShotAim,[100,3,0]);assert.equal(h.c.lastShotRecoil,.2);
  h.test.acceptInputActions(h.p,{...common,seq:1,actionSeq:1,trigger:true,aimPoint:[-50,3,0],view:view()});h.game.remoteInput(u);assert.equal(h.p.pendingShot,null);
  // releaseで発射する銃も、その端の照準を一度だけ使う。
  h.test.acceptInput(h.p,{...common,seq:6,actionSeq:2,aimPoint:[100,3,0],view:view({time:950})});
  h.test.acceptInputActions(h.p,{...common,seq:6,actionSeq:2,trigger:false,aimPoint:[-40,3,0],view:view()});u.controlInput=h.game.remoteInput(u);
  h.c.shot(u,{w:{...w,chargeTime:1}},new T.Vector3(100,3,0));assert.deepEqual(h.c.lastShotAim,[-40,3,0]);assert.equal(h.p.pendingShot,null);
  h.p.pendingShot={...common,seq:6,actionSeq:2,trigger:false,aimPoint:[-40,3,0],view:view(),receivedAt:1000};
  h.c.shot(u,{w:{...w,burst:3}},new T.Vector3(100,3,0));assert.deepEqual(h.c.lastShotAim,[100,3,0]);assert.equal(h.p.pendingShot,null);
  // spin/再装填でそのstepに撃たなければ、後の初弾へ古いpress照準を持ち越さない。
  h.p.pendingShot={...common,seq:6,actionSeq:3,trigger:true,aimPoint:[-30,3,0],view:view(),receivedAt:1000};
  h.test.recordHostInputStep(u,u.controlInput,.016);assert.equal(h.p.pendingShot,null);h.c.shot(u,{w},new T.Vector3(100,3,0));assert.deepEqual(h.c.lastShotAim,[100,3,0]);
});
console.log(`hitscan巻戻し: ${checks}項目 成功`);
