// node tools/test/online_camera_fixture.js --revision=e8b0140
// 平地VM。製品lookMove/採取/beforeFrame/physics/codec/写真受理/updateCameraを接続する。
// lockUpdate/castFrom/施設/地形は代役。WebGL描画・実マウスイベント・RTC・人の操作感は測らない。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createPhysicsSuite}=require('./online_physics_sync_fixture');
const T=require('../../vendor/three-r128/three.min.js');
const {Encoder}=require('../../prototype/online/codec');
const root=path.resolve(__dirname,'../..'),deg=180/Math.PI;
const angleError=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))*deg;
function createCameraSuite(revision='working'){
  const physics=createPhysicsSuite(revision);
  const html=revision==='working'?fs.readFileSync(path.join(root,'prototype/index.html'),'utf8'):
    execFileSync('git',['show',revision+':prototype/index.html'],{cwd:root,encoding:'utf8'});
  function section(from,to){const a=html.indexOf(from),b=html.indexOf(to,a);assert(a>=0&&b>a,from);return html.slice(a,b);}
  const viewSource=section('function lookMove(', 'function grabPointer(')+'\n'+
    section('function collectLocalInput(', 'function updateLocalAimMark(')+'\n'+
    section('function cameraPivot(', '// 視界をふさぐ建物を薄くする');
  function create(unitClass='assault'){
    const api=physics.load(unitClass),h=api.harness(),c=h.c;
    for(const u of h.units)Object.assign(u,{recoil:0,recoilYaw:0,cameraRecoil:0,cameraRecoilYaw:0});
    Object.assign(c,{qc:{open:false},wsel:{open:false},mapOpen:false,pressed:{},pad:{fwd:0,side:0},touch:{fwd:0,side:0},
      mouseDown:false,rightDown:false,camera:new T.PerspectiveCamera(70,16/9,.1,1000),
      CAM:{back:8,up:4.6,side:2.2},SEEK_ZOOM:1.1,SEEK_EYE:3.4,LOCK_ZOOM:1.3,LOCK_ZOOM_RATE:9,
      gameOptions:{fov:70},lockUpdate:()=>{},castFrom:()=>null,cameraFade:()=>{},cityMap:null,
      terrainH:()=>-1000,ceilingAt:()=>Infinity,actionLower:()=>0,isArtilleryMode:()=>false});
    vm.runInContext(viewSource,c);c.updateCamera(c.player,0);
    return {...api,h};
  }
  function run({hostHz=60,guestHz=60,yawRateDeg=30,pitchRateDeg=12,oneWayMs=2,
    inputDelayMs=oneWayMs,snapshotDelayMs=oneWayMs,transportPumpMs=20,guestJitterMs=0,
    inputGap=null,snapshotGap=null,mode='stop',durationMs=3200,snapshotMs=50}={}){
    const {h:guest}=create(),{h:host}=create();host.game.state.role='host';
    const peer={id:'g',unitId:'B:0',receivedSeq:0,appliedSeq:0,last:0,pendingEdges:{},fixedCommands:true};
    host.game.state.peers.set(peer.id,peer);Object.assign(host.c.player,{controller:'remoteHuman',ownerPeerId:'g',onlineFixedMovement:true});
    const encoder=new Encoder(),queue=[],rows=[],photos=[];
    let order=0,sent=0,hostFrame=0,lastSnapshot=-Infinity,expectedYaw=0,expectedPitch=0,lastShownYaw=0,maxDebt=0;
    const enqueue=(time,kind,data)=>queue.push({time,kind,data,order:order++});
    const send=(time,kind,data)=>{
      const delay=kind==='snapshot'?snapshotDelayMs:inputDelayMs;
      const arrival=(transportPumpMs?Math.ceil((time-1e-9)/transportPumpMs)*transportPumpMs:time)+delay;
      if(transportPumpMs&&(kind==='inputBatch'||kind==='snapshot'))for(let i=queue.length-1;i>=0;i--)
        if(queue[i].kind===kind&&Math.abs(queue[i].time-arrival)<1e-7)queue.splice(i,1);
      enqueue(arrival,kind,data);
    };
    for(const [kind,hz]of [['guest',guestHz],['host',hostHz]])for(let i=1,time=kind==='host'?1:0;time<durationMs;i++){
      const ms=1000/hz+(kind==='guest'?(i%2?guestJitterMs:-guestJitterMs):0);time+=ms;enqueue(time,kind,{dt:ms/1000,index:i});
    }
    while(queue.length){
      queue.sort((a,b)=>a.time-b.time||a.order-b.order);const e=queue.shift(),time=e.time;if(time>durationMs)break;
      guest.at(time);host.at(time);
      if(e.kind==='guest'){
        const c=guest.c,u=c.player,dt=e.data.dt;
        // 毎frameの相対mouse量を加算。期待角をuへ直接代入して過去の巻き戻りを隠さない。
        const dyaw=yawRateDeg/deg*dt,dpitch=pitchRateDeg/deg*dt*(Math.floor(time/700)%2?-1:1);
        const sensitivity=c.camera.fov/70*(u.slots[u.weapon].w.turn||1);
        c.lookMove(-dyaw/.0025,-dpitch/.0025,.0025);
        expectedYaw+=dyaw*sensitivity;expectedPitch=Math.max(-.9,Math.min(.7,expectedPitch+dpitch*sensitivity));
        c.keys=mode==='stop'?{}:{KeyW:true,...(mode==='longDash'?{ShiftLeft:true}:{})};c.pressed={};
        const latest={yaw:u.yaw,pitch:u.pitch};
        guest.game.beforeFrame(dt,time);c.updateCamera(u,dt);guest.game.afterFrame(dt,time);
        const view=c.camera.getWorldDirection(new T.Vector3()),shownYaw=Math.atan2(-view.x,-view.z),shownPitch=Math.asin(view.y);
        const stepYawError=angleError(u.yaw,latest.yaw),stepPitchError=angleError(u.pitch,latest.pitch);
        const delta=Math.atan2(Math.sin(shownYaw-lastShownYaw),Math.cos(shownYaw-lastShownYaw))*deg;lastShownYaw=shownYaw;
        maxDebt=Math.max(maxDebt,guest.test.getPrediction().repeatDebt||0);
        rows.push({time,stepYawError,stepPitchError,yawError:angleError(shownYaw,expectedYaw),pitchError:angleError(shownPitch,expectedPitch),delta,repeatDebt:guest.test.getPrediction().repeatDebt||0});
        while(sent<guest.sent.length){const message=guest.sent[sent++];
          if(message.type==='inputBatch'&&inputGap&&time>=inputGap[0]&&time<inputGap[1])continue;
          if(message.type==='inputBatch'||message.type==='inputActions')send(time,message.type,message.data);
        }
      }else if(e.kind==='inputBatch')host.test.acceptInputBatch(peer,e.data);
      else if(e.kind==='inputActions')host.test.acceptInputActions(peer,e.data);
      else if(e.kind==='host'){
        host.c.updateHumanUnit(host.c.player,host.game.remoteInput(host.c.player),e.data.dt);hostFrame++;
        if(time-lastSnapshot>=snapshotMs){
          const s=JSON.parse(JSON.stringify(host.game.snapshot()));s.frame=hostFrame;s.time=time;
          s.roster=s.units.map(u=>({id:u.id,name:u.name,team:u.team,cls:u.cls,sc:u.sc}));
          s.units=s.units.map(u=>host.test.fixedUnitForPeer(u,false,1));s.unitUpdates=(1<<s.units.length)-1;s.gadgets=[];
          send(time,'snapshot',{s,wire:encoder.encode(s)});lastSnapshot=time;
        }
      }else if(e.kind==='snapshot'){
        if(snapshotGap&&time>=snapshotGap[0]&&time<snapshotGap[1])continue;
        const u=guest.c.player,before={yaw:u.yaw,pitch:u.pitch},count=guest.game.metrics().interpolation.acceptedSnapshots;
        if(e.data.wire.baseline)guest.test.handleSnapshotControl('snapshotBase',e.data.wire.baseline);
        guest.test.receiveSnapshot({frame:e.data.s.frame,delta:e.data.wire.delta});
        assert.equal(guest.game.metrics().interpolation.acceptedSnapshots,count+1,'製品receiveSnapshotの受理を確認');
        photos.push({time,yawError:angleError(u.yaw,before.yaw),pitchError:angleError(u.pitch,before.pitch)});
      }
    }
    const max=(items,key)=>Math.max(0,...items.map(row=>row[key]));
    const intervals=photos.slice(1).map((p,i)=>p.time-photos[i].time);
    return {revision,hostHz,guestHz,yawRateDeg,pitchRateDeg,inputDelayMs,snapshotDelayMs,transportPumpMs,guestJitterMs,inputGap,snapshotGap,mode,durationMs,
      frames:rows.length,snapshots:photos.length,photoMeanMs:intervals.reduce((a,b)=>a+b,0)/Math.max(1,intervals.length),
      repeatedCommands:peer.repeatedCommands||0,maxRepeatDebt:maxDebt,
      maxStepYawErrorDeg:max(rows,'stepYawError'),maxStepPitchErrorDeg:max(rows,'stepPitchError'),
      maxSnapshotYawErrorDeg:max(photos,'yawError'),maxSnapshotPitchErrorDeg:max(photos,'pitchError'),
      maxCameraYawErrorDeg:max(rows,'yawError'),maxCameraPitchErrorDeg:max(rows,'pitchError'),
      reverseFrames:rows.filter(r=>r.delta< -1e-8).length,stalledFrames:rows.filter(r=>Math.abs(r.delta)<1e-8).length,
      firstErrors:rows.filter(r=>r.stepYawError>1e-8||r.stepPitchError>1e-8).slice(0,3)};
  }
  const uiPath='prototype/online/ui.js',ui=revision==='working'?fs.readFileSync(path.join(root,uiPath),'utf8'):
    execFileSync('git',['show',revision+':'+uiPath],{cwd:root,encoding:'utf8'});
  return {create,run,sourceHashes:{...physics.sourceHashes,[uiPath]:crypto.createHash('sha256').update(ui).digest('hex')}};
}
function scenarios(){
  const result=[];
  for(const [hostHz,guestHz]of [[60,60],[60,144],[144,60]])for(const yawRateDeg of [30,360]){
    for(const condition of [
      {oneWayMs:2,guestJitterMs:guestHz===60?.1:0},
      {oneWayMs:12},
      {inputDelayMs:70,snapshotDelayMs:90},
      {oneWayMs:2,inputGap:[1200,1350],snapshotGap:[1800,1960]}
    ])result.push({hostHz,guestHz,yawRateDeg,...condition});
  }
  return result;
}
if(require.main===module){
  const revision=process.argv.find(arg=>arg.startsWith('--revision='))?.slice(11)||'working',suite=createCameraSuite(revision);
  console.log(JSON.stringify({notice:'平地VM・実lookMove/採取/beforeFrame/physics/codec/写真受理/updateCamera。lockUpdate/castFrom/施設/地形は代役。WebGL/RTC/マウスイベント配送/人の操作感は未検証。',sourceHashes:suite.sourceHashes,reports:scenarios().map(s=>suite.run(s))},null,2));
}
module.exports={createCameraSuite,scenarios,angleError};
