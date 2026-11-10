// WebGL不要。製品関数の視点保持と歴史移動を別々に検査する。
const assert=require('node:assert/strict');
const {createCameraSuite,scenarios,angleError}=require('./online_camera_fixture');
const suite=createCameraSuite(),DT=1/60,EPS=1e-8;
const near=(a,b,label)=>assert(angleError(a,b)<EPS,label);
let count=0;
for(const condition of scenarios()){
  const result=suite.run(condition),label=JSON.stringify(condition);
  assert(result.snapshots>30&&result.frames>150,label);
  for(const k of ['maxStepYawErrorDeg','maxStepPitchErrorDeg','maxSnapshotYawErrorDeg','maxSnapshotPitchErrorDeg','maxCameraYawErrorDeg','maxCameraPitchErrorDeg'])assert(result[k]<EPS,`${k}: ${label}`);
  assert.equal(result.reverseFrames,0,label);assert.equal(result.stalledFrames,0,label);
  if(condition.inputGap)assert(result.repeatedCommands>0&&result.maxRepeatDebt>0,'実host queueの反復を経た条件');
  count++;
}
// 移動中も現在入力へ戻す。FOV/武器旋回倍率をlookMove直前の期待角へ反映する。
for(const guestHz of [60,144])for(const mode of ['walk','longDash']){
  const r=suite.run({mode,guestHz,yawRateDeg:90,inputGap:[1200,1350]});
  assert(r.maxStepYawErrorDeg<EPS);assert(r.maxSnapshotYawErrorDeg<EPS);assert(r.maxCameraYawErrorDeg<EPS);count++;
}
// 保存済みcommandの方向で実physicsを進める。最新視点を古いcommandへ書き戻してはならない。
{
  const {h}=suite.create(),{h:control}=suite.create();
  const command=(seq,yaw,pitch)=>({seq,command:true,keys:{KeyW:true},pressed:{},yaw,pitch,aimPoint:[1,2,3],view:{time:20,frame:1,delayMs:100}});
  for(const item of [command(1,.2,.1),command(2,.4,.2)]){
    Object.assign(h.c.player,{yaw:item.yaw,pitch:item.pitch});h.test.predictLocalInput(item,DT);
    control.c.predictHumanMovement(control.c.player,item,DT);
  }
  const m=h.test.getPrediction(),saved=JSON.stringify(m.pending[1].input);m.repeatDebt=1;
  const latest=command(3,1.1,-.3);Object.assign(h.c.player,{yaw:latest.yaw,pitch:latest.pitch,cameraRecoil:.07,cameraRecoilYaw:-.02});
  h.test.predictLocalInput(latest,DT);control.c.predictHumanMovement(control.c.player,command(2,.4,.2),DT);
  near(h.c.player.yaw,latest.yaw,'yawを保存');near(h.c.player.pitch,latest.pitch,'pitchを保存');
  assert(h.c.player.pos.distanceTo(control.c.player.pos)<1e-10,'実移動は過去commandの方向');
  assert(h.c.player.vel.distanceTo(control.c.player.vel)<1e-10,'実速度は過去commandの方向');
  assert.equal(JSON.stringify(m.pending[1].input),saved,'過去の入力/aimPoint/viewを書き換えない');
  assert.equal(h.c.player.cameraRecoil,.07);assert.equal(h.c.player.cameraRecoilYaw,-.02);
  const before={yaw:h.c.player.yaw,pitch:h.c.player.pitch};
  h.c.predictHumanMovement=()=>{h.c.player.yaw=-2;h.c.player.pitch=.6;throw Error('試験例外');};
  assert.throws(()=>h.test.predictLocalInput(command(4,2,.5),DT),/試験例外/);
  near(h.c.player.yaw,before.yaw,'例外時も復元');near(h.c.player.pitch,before.pitch,'例外時も復元');count++;
}
// 命令0step/複数stepの描画frame、updateLocalHumanAimのlock追従後の角度を保つ。
{
  const {h}=suite.create(),{h:control}=suite.create(),commands=[];
  h.test.getPrediction().repeatDebt=2;
  const physical=u=>Object.fromEntries(['boost','boostIdle','overheat','onGround','dashT','dashState','longDash','jumpBuf','crouching','actionHeld','stun','stunT','recoil','cameraRecoil','flying','ctrlLockT','lungeT','slideT','recoverT','moveInput'].map(k=>[k,u[k]])
    .concat(['pos','vel','dashDir','boostVisualDir'].map(k=>[k,u[k]?Array.from(u[k].toArray()):null])));
  for(let i=1;i<=120;i++){
    h.at(i*1000/60);h.c.player.yaw=1.2+i*.011;h.c.player.pitch=.21;
    const input={seq:i,command:true,yaw:i*.008,pitch:-.07,keys:{KeyW:true,...(i<50?{ShiftLeft:true}:{}),...(i>=80&&i<95?{KeyC:true}:{})},pressed:i===3?{ShiftLeft:true}:i===65?{Space:true}:{}};
    commands.push(input);h.test.predictLocalInput(input,DT);
    if(i>2)control.c.predictHumanMovement(control.c.player,commands[i-3],DT);
    assert.deepEqual(physical(h.c.player),physical(control.c.player),'120stepのdash/jump/しゃがみは歴史向きの物理と一致');
    near(h.c.player.yaw,1.2+i*.011,'最新yawを保持');near(h.c.player.pitch,.21,'最新pitchを保持');
  }
  count++;
}
// 診断量は実際に表示した補正でなく、復元前に防いだ軸角の最大。横は±πで折り返す。
{
  const {h}=suite.create();h.c.player.yaw=.5;h.c.player.pitch=.1;
  h.c.predictHumanMovement=u=>{u.yaw+=2*Math.PI+5e-8;return true;};
  h.test.predictLocalInput({seq:1,keys:{},pressed:{}},DT);
  assert.equal(h.game.diagnostics().preventedLook.count,0,'1e-7rad以下はノイズとして除く');
  h.c.predictHumanMovement=u=>{u.yaw+=2*Math.PI+.2;u.pitch-=.3;return true;};
  h.test.predictLocalInput({seq:2,keys:{},pressed:{}},DT);
  const d=h.game.diagnostics();assert.equal(d.preventedLook.count,1);assert(Math.abs(d.preventedLook.maxDeg-.3*180/Math.PI)<1e-9);
  near(h.c.player.yaw,.5,'診断を取っても視点を戻す');near(h.c.player.pitch,.1,'診断を取っても視点を戻す');count++;
}
for(const dt of [1/144,.05]){
  const {h}=suite.create(),c=h.c;h.at(100);
  c.player.yaw=.2;c.player.pitch=.1;
  h.test.predictLocalInput({seq:1,command:true,keys:{},pressed:{},yaw:-1,pitch:-.3},DT);
  h.test.getPrediction().repeatDebt=1;
  Object.assign(c,{LOCK_TRACK:1,LOCK_TRACK_SHAKEN:.35,LOCK_MAX_RATE:4,LOCK_PULL:.8,
    anglesTo:()=>({yaw:.4,pitch:.2}),targetPoint:()=>new c.T.Vector3(),lockStick:()=>({yaw:0,pitch:0})});
  Object.assign(c.lock,{target:{dashState:''},visible:true,prevAng:{yaw:.3,pitch:.15}});
  // wire上のlock IDは既存unitだけを指す。
  c.lock.target=c.units[1];c.lock.target.dashState='';
  const expectedYaw=.2+Math.min(.1,4*dt),expectedPitch=.1+Math.min(.05,4*dt);
  h.game.beforeFrame(dt,100);
  near(c.player.yaw,expectedYaw,'lock追従後yaw');near(c.player.pitch,expectedPitch,'lock追従後pitch');
  const action=h.sent.find(m=>m.type==='inputActions');assert(action);
  near(action.data.yaw,expectedYaw,'送信照準yaw');near(action.data.pitch,expectedPitch,'送信照準pitch');
  assert.deepEqual(Array.from(action.data.aimPoint),Array.from(c.updateLocalHumanAim(c.player,0,false).aim.toArray()),'発射照準点は採取値');count++;
}
// 位置hardSnapの既存仕様は今回変更しない。再出撃・エリア移動・蘇生の権威向きを保護。
for(const [patch,reason]of [
  [{lifeId:2,yaw:Math.PI,pitch:0},'respawn'],
  [{motionEpoch:1,yaw:Math.PI,pitch:0},'transfer'],
  [{alive:true,downT:0,lagEpoch:1,yaw:-.7,pitch:0},'']
]){
  const {h,snapshot,reconcile}=suite.create();
  if(patch.lagEpoch)Object.assign(h.c.player,{alive:false,downT:3});
  reconcile(h,snapshot(h));h.c.player.yaw=1.2;h.c.player.pitch=.4;
  reconcile(h,snapshot(h,2,patch));
  near(h.c.player.yaw,patch.yaw,'権威の向きを適用');near(h.c.player.pitch,patch.pitch,'権威pitch');
  if(reason)assert.equal(h.game.metrics().prediction.hardSnapReasons[reason],1);count++;
}
// カタパルト・ジャンプ台など先読みを止める間は、写真の（少し前に自分が送った）向きで今の向きを戻さない（2026-11-08 揺れ計測）。
for(const patch of [{flying:true},{predictionBlocked:'jumpPad'}]){
  const {h,snapshot,reconcile}=suite.create();
  reconcile(h,snapshot(h));h.c.player.yaw=1.2;h.c.player.pitch=.4;
  reconcile(h,snapshot(h,2,{...patch,yaw:-.7,pitch:0}));
  near(h.c.player.yaw,1.2,'先読み停止中もゲストの向き');near(h.c.player.pitch,.4,'先読み停止中もゲストのpitch');count++;
}
console.log(`ゲスト視点：${count}条件成功。写真直後/予測後/実cameraで逆行なし、歴史移動・lock・境界を保持。実RTC/描画/人の操作感は未検証。`);
