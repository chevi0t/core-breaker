// 製品lookMove/collectLocalInput/beforeFrame/physics/codec/写真受理/updateCameraを接続。
// 30Hzの人工写真列。lockUpdate/castFrom/地形/輸送は代役。
// WebGL/RTC/OSのマウスイベント配送/人の操作感は測らない。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const {execFileSync}=require('node:child_process');
const {createCameraSuite}=require(path.join(root,'tools/test/online_camera_fixture'));
const T=require(path.join(root,'vendor/three-r128/three.min.js'));
const deg=180/Math.PI,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),near=(a,b,msg)=>assert(Math.abs(a-b)<1e-9,`${msg}: ${a} != ${b}`);
function run(suite,hz,mode){
  const {h}=suite.create(),c=h.c,u=c.player,encoder=new c.CBOnlineCodec.Encoder();
  let frame=0,previousYaw=0,previousPitch=0,maxSnapshotYaw=0,maxSnapshotPitch=0,reverseFrames=0,maxReverse=0,maxYawStep=0,maxPitchStep=0,maxExpectedError=0,maxExpectedPitchError=0,expectedYaw=0,expectedPitch=0;
  const initial={alive:false,downT:mode==='wrecked'?0:10,respawnT:mode==='wrecked'?5:0,yaw:0,pitch:0,pos:[0,0,0],vel:[0,0,0],predictionBlocked:'inactive'};
  function deliver(time){
    const s=JSON.parse(JSON.stringify(h.game.snapshot()));s.frame=++frame;s.time=time;
    const wrecked=mode==='wrecked'||mode==='f_transition'&&time>=1000;
    Object.assign(s.units[0],initial,{downT:wrecked?0:10-time/1000,respawnT:wrecked?5:0});
    s.inputAcks={'B:0':{fixed:true,seq:0,replaySeq:0,step:0,movementIds:[]}};s.acks={'B:0':0};
    const yaw=u.yaw,pitch=u.pitch,count=h.game.metrics().interpolation.acceptedSnapshots;
    const wire=encoder.encode(s);if(wire.baseline)h.test.handleSnapshotControl('snapshotBase',wire.baseline);h.test.receiveSnapshot({frame,delta:wire.delta});
    assert.equal(h.game.metrics().interpolation.acceptedSnapshots,count+1);
    if(frame>1){maxSnapshotYaw=Math.max(maxSnapshotYaw,Math.abs(wrap(u.yaw-yaw))*deg);maxSnapshotPitch=Math.max(maxSnapshotPitch,Math.abs(u.pitch-pitch)*deg);}
    near(u.pos.lengthSq(),0,'位置はホストの確定値');assert.equal(u.alive,false);assert(Math.abs(u.downT-s.units[0].downT)<.00051,'codecのms量子化以内');
  }
  h.at(0);deliver(0);c.updateCamera(u,0);
  const events=[];
  for(let i=1;i<=60;i++)events.push({time:i*1000/30,photo:true});
  for(let i=1;i<=hz*2;i++)events.push({time:i*1000/hz,photo:false});
  events.sort((a,b)=>a.time-b.time||(a.photo?-1:1));
  for(const e of events){h.at(e.time);if(e.photo){deliver(e.time);continue;}
    const dyaw=120/deg/hz,dpitch=10/deg/hz;
    c.lookMove(-dyaw/.0025,-dpitch/.0025,.0025);expectedYaw+=dyaw;expectedPitch=Math.min(.7,expectedPitch+dpitch);
    c.keys={KeyW:true};c.pressed={};
    // Fは実送信経路を通す。大破写真は人工列で、ホスト側F実行はonline_downed_input.test.jsが検査する。
    if(mode==='f_transition'&&Math.abs(e.time-(1000-1000/hz))<.0001)c.pressed.KeyF=true;
    h.game.beforeFrame(1/hz,e.time);c.updateCamera(u,1/hz);h.game.afterFrame(1/hz,e.time);
    const view=c.camera.getWorldDirection(new T.Vector3()),yaw=Math.atan2(-view.x,-view.z),pitch=Math.asin(view.y),delta=wrap(yaw-previousYaw)*deg;
    if(delta< -1e-8){reverseFrames++;maxReverse=Math.max(maxReverse,-delta);}
    maxYawStep=Math.max(maxYawStep,Math.abs(delta));maxPitchStep=Math.max(maxPitchStep,Math.abs(pitch-previousPitch)*deg);
    maxExpectedError=Math.max(maxExpectedError,Math.abs(wrap(yaw-expectedYaw))*deg);maxExpectedPitchError=Math.max(maxExpectedPitchError,Math.abs(pitch-expectedPitch)*deg);previousYaw=yaw;previousPitch=pitch;
    near(u.pos.lengthSq(),0,'行動不能中は移動しない');
  }
  if(mode==='f_transition')assert(h.sent.some(m=>m.type==='inputActions'&&m.data.pressed?.KeyF),'見回し中もFを送る');
  return {hz,mode,seconds:2,photoHz:30,snapshots:frame,mouseYawDegPerSec:120,reverseFrames,maxReverseDeg:maxReverse,maxCameraYawStepDeg:maxYawStep,maxCameraPitchStepDeg:maxPitchStep,maxSnapshotYawDeg:maxSnapshotYaw,maxSnapshotPitchDeg:maxSnapshotPitch,maxExpectedErrorDeg:maxExpectedError,maxExpectedPitchErrorDeg:maxExpectedPitchError};
}
function boundaries(suite){
  const tests=[];
  function test(name,initial,change,keep){
    const {h,snapshot,reconcile}=suite.create(),u=h.c.player;
    Object.assign(u,initial);reconcile(h,snapshot(h));u.yaw=1.2;u.pitch=.4;
    const view={yaw:u.yaw,pitch:u.pitch};const s=snapshot(h,2,{yaw:-.7,pitch:-.2,...change});
    reconcile(h,s);near(u.yaw,keep?view.yaw:s.units[0].yaw,name+' yaw');near(u.pitch,keep?view.pitch:s.units[0].pitch,name+' pitch');
    assert.deepEqual(Array.from(u.pos.toArray()),Array.from(s.units[0].pos),name+' 位置hard-snap');assert.equal(h.game.metrics().prediction.pendingInputs,0,name+' pending');assert.equal(u.onlineVisualOffset,undefined,name+' visual');
    tests.push(name);
  }
  const down={alive:false,downT:10},dead={alive:false,downT:0,respawnT:5};
  test('行動不能継続',down,{downT:9},true);
  test('大破後待機継続',dead,{respawnT:4},true);
  test('F大破の境界',down,{downT:0,respawnT:5},true);
  test('初回行動不能',{alive:true,downT:0},{alive:false,downT:10},false);
  test('即時大破',{alive:true,downT:0},{alive:false,downT:0,respawnT:5},false);
  test('生存中の被弾ダウン',{alive:true,downT:0},{stun:'down',stunT:1},false);
  test('蘇生',down,{alive:true,downT:0,lagEpoch:1},false);
  test('再出撃',dead,{alive:true,downT:0,lifeId:2},false);
  test('生命が変わった倒れ',down,{alive:false,downT:9,lifeId:2},false);
  test('倒れ中の転送epoch',down,{motionEpoch:1},false);
  test('倒れ中の転送状態',down,{transfer:{t:1,base:true}},false);
  test('転送終了',{...down,transfer:{t:1,base:true}},{transfer:null},false);
  test('見逃した蘇生と再死亡',down,{lagEpoch:2},false);
  test('位置大差0.5m',down,{pos:[.5,0,0]},true);
  test('位置大差3m',down,{pos:[3,0,0]},true);
  // 装備変更はswing/モデルの作り直し代役を使い、向きと境界だけ検証。
  {const {h,snapshot,reconcile}=suite.create(),u=h.c.player;Object.assign(u,down);reconcile(h,snapshot(h));u.yaw=1.2;u.pitch=.4;
   h.c.equip=()=>{};reconcile(h,snapshot(h,2,{cls:'heavy',yaw:-.7,pitch:-.2}));near(u.yaw,-.7,'兵装変更');near(u.pitch,-.2,'兵装変更');tests.push('兵装変更');}
  {const {h,snapshot,reconcile}=suite.create(),u=h.c.player;Object.assign(u,down);reconcile(h,snapshot(h));u.yaw=1.2;u.pitch=.4;
   h.c.equip=()=>{};reconcile(h,snapshot(h,2,{mech:{...u.mech,head:'changed'},yaw:-.7,pitch:-.2}));near(u.yaw,-.7,'機体装備変更');tests.push('機体装備変更');}
  {const {h,snapshot,reconcile}=suite.create(),u=h.c.player;Object.assign(u,down);reconcile(h,snapshot(h));u.yaw=1.2;u.pitch=.4;
   h.c.equip=()=>{};const s=snapshot(h,2,{yaw:-.7,pitch:-.2});s.units[0].slots.main.key='changed';reconcile(h,s);near(u.yaw,-.7,'武器装備変更');tests.push('武器装備変更');}
  {
    const {h,snapshot,reconcile}=suite.create(),u=h.c.player;Object.assign(u,down);reconcile(h,snapshot(h));u.yaw=1.2;u.pitch=.4;
    h.test.predictLocalInput({seq:1,command:true,lifeId:u.lifeId,keys:{KeyW:true},pressed:{Space:true},moveActionSeq:1,yaw:u.yaw,pitch:u.pitch},1/60);
    assert(h.test.getPrediction().pending.length>0);assert(h.test.getPrediction().actionEdges.length>0);
    u.onlineVisualOffset=new T.Vector3(.1,0,0);u.onlineRenderOffset=new T.Vector3(.1,0,0);
    reconcile(h,snapshot(h,2,{pos:[3,0,0],yaw:-.7,pitch:-.2}));
    near(u.yaw,1.2,'大差でも視点保持');near(u.pitch,.4,'大差でもpitch保持');near(u.pos.x,3,'位置は即時反映');
    assert.equal(h.test.getPrediction().pending.length,0);assert.equal(h.test.getPrediction().actionEdges.length,0);
    assert.equal(u.onlineVisualOffset,undefined);assert.equal(u.onlineRenderOffset,undefined);tests.push('視点保持と予測履歴/offset破棄の分離');
  }
  return tests;
}
function offline(suite,html){
  const {h}=suite.create(),c=h.c,u=c.player;
  const a=html.indexOf('function wreck('),b=html.indexOf('// 起こせる機体：',a);
  Object.assign(c,{clearAttached:()=>{},removeGadget:()=>{},pings:[],dropPing:()=>{},isLocalView:v=>v===u,isHumanControlled:()=>true,reviverNear:()=>true,VS:null,killCore:5,KILLCAM:.5,boom:()=>{},killcam:null,pressed:{},cores:{B:{hp:100},R:{hp:100}}});
  vm.runInContext(html.slice(a,b),c);Object.assign(u,{team:'B',alive:false,downT:10,downYaw:.25,downBy:null,post:null,downPing:null});
  c.lookMove(-40,-20,.0025);const yaw=u.yaw,pitch=u.pitch;
  c.downTick(u,1/60);near(u.yaw,yaw,'offline downTick yaw');near(u.pitch,pitch,'offline downTick pitch');
  c.pressed.KeyF=true;c.downTick(u,1/60);near(u.yaw,yaw,'offline F yaw');near(u.pitch,pitch,'offline F pitch');assert.equal(u.downT,0);assert.equal(u.respawnT,5);
  c.lookMove(-40,-20,.0025);c.updateCamera(u,1/60);near(u.yaw,yaw+.1,'offline dead look yaw');near(u.pitch,pitch+.05,'offline dead look pitch');near(u.downYaw,.25,'模型の倒れ向き');
  assert.equal(c.killcam,null,'自爆等の通常視点');return {downTick:'pass',fWreckPreservesLook:'pass',deadWaitLook:'pass',downYaw:'pass',killcam:'専用カメラ中の入力は表示しない。endKillcamの向き変更は本patch対象外'};
}

function createDownedSuite(revision='working'){
  const camera=createCameraSuite(revision);
  const html=revision==='working'?fs.readFileSync(path.join(root,'prototype/index.html'),'utf8'):
    execFileSync('git',['show',revision+':prototype/index.html'],{cwd:root,encoding:'utf8'});
  return {run:(hz,mode)=>run(camera,hz,mode),boundaries:()=>boundaries(camera),offline:()=>offline(camera,html),sourceHashes:camera.sourceHashes};
}
if(require.main===module){
  const revision=process.argv.find(a=>a.startsWith('--revision='))?.slice(11)||'working',suite=createDownedSuite(revision);
  console.log(JSON.stringify({revision,notice:'平地VM・30Hz人工写真。実WebGL/RTC/人の操作感は未検証。',sourceHashes:suite.sourceHashes,
    scenarios:[60,144].flatMap(hz=>['downed','wrecked','f_transition'].map(mode=>suite.run(hz,mode)))},null,2));
}
module.exports={createDownedSuite};
