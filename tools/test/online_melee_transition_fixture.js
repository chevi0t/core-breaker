// node tools/test/online_melee_transition_fixture.js --revision=10dda30
// 30Hzの同じ人工写真列・入力を製品codec/beforeFrameへ渡す回帰VM。
// 終了歩行は線形の移動代役。ロックは実anglesTo/lockStick/updateLocalHumanAim/updateCamera。
// lockUpdate（選択/可視判定）・地形/命中/輸送は代役。実WebGL/RTC/人の操作感は測らない。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createMeleeSuite}=require('./online_melee_view_fixture');
const {createCameraSuite}=require('./online_camera_fixture');
const T=require('../../vendor/three-r128/three.min.js');
const root=path.resolve(__dirname,'../..');
function read(revision,file){return revision==='working'?fs.readFileSync(path.join(root,file),'utf8'):execFileSync('git',['show',revision+':'+file],{cwd:root,encoding:'utf8'});}
function stats(values){
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  return {min:Math.min(...values),max:Math.max(...values),mean,reverse:values.filter(x=>x< -1e-8).length,
    cv:mean?Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/values.length)/Math.abs(mean):0};
}
function schedule(hz,durationMs){
  const queue=[];
  for(let i=0;i<=durationMs*30/1000;i++)queue.push({time:i*1000/30+35,hostTime:i*1000/30,photo:true});
  for(let i=0;i<=durationMs*hz/1000;i++)queue.push({time:i*1000/hz});
  return queue.sort((a,b)=>a.time-b.time||(a.photo?-1:1));
}
function releaseWalk(revision='working',hz=144){
  const {h,u,deliver}=createMeleeSuite(revision).create(),rows=[];
  h.c.collectLocalInput=u=>({keys:{KeyW:true},pressed:{},trigger:false,yaw:u.yaw,pitch:u.pitch,aimPoint:[0,0,-100]});
  for(const e of schedule(hz,1000)){
    h.at(e.time);
    if(e.photo){
      const active=e.hostTime<200;
      deliver(e.hostTime,{pos:[active?0:.25+(e.hostTime-200)/100,0,0],vel:[active?0:10,0,0],predictionBlocked:active?'melee':'',recoverT:active?1:0});
    }else{
      h.game.beforeFrame(1/hz,e.time);h.c.updateCamera(u);const raw=u.pos.toArray();h.c.renderView();
      assert.deepEqual(u.pos.toArray(),raw,'描画後の物理位置');assert.deepEqual(h.c.camera.position.toArray(),raw,'描画後のカメラ');
      rows.push({time:e.time,x:h.renderedCamera().x,raw:u.pos.x,release:!!h.test.viewState().meleeRelease});
    }
  }
  const active=rows.filter(r=>r.time>=280&&r.time<=450),movement=stats(active.slice(1).map((v,i)=>v.x-active[i].x));
  return {revision,hz,movement,releaseAt500:rows.find(r=>r.time>=500).release,rows};
}
function createLockHarness(revision='working'){
  const {h}=createCameraSuite(revision).create(),c=h.c,u=c.player,enemy=h.units[1],html=read(revision,'prototype/index.html');
  const start=html.indexOf('function wrapAngle('),end=html.indexOf('// ---- コントローラー ----',start);
  assert(start>=0&&end>start);vm.runInContext(html.slice(start,end)+'\n'+html.match(/const LOCK_TRACK = [^\n]+/)[0],c);
  Object.assign(enemy,{kind:'unit',team:'R'});enemy.pos.set(1,0,-26);
  c.targetPoint=t=>t.pos.clone().add(new T.Vector3(0,2.4,0));
  return {h,c,u,enemy};
}
function lockedLunge(revision='working',hz=60,lockOn=true,speed=26){
  const {h,c,u,enemy}=createLockHarness(revision);
  c.lock.target=lockOn?enemy:null;c.lock.visible=lockOn;c.lock.prevAng=null;
  const aim=c.anglesTo(u,c.targetPoint(enemy));u.yaw=aim.yaw;u.pitch=aim.pitch;c.updateCamera(u,0);
  const encoder=new c.CBOnlineCodec.Encoder(),rows=[],photos=[],inAim=c.updateLocalHumanAim;
  let frame=0,aimPos;
  c.updateLocalHumanAim=(u,...args)=>{aimPos=shown();return inAim(u,...args);};
  function shown(){const p=u.pos.clone(),offset=c.onlineViewOffset(u);return offset?p.add(offset):p;}
  const a={time:.7,windup:.1,sweep:.5,from:0,to:720,spin:true,recover:.5};
  for(const e of schedule(hz,2000)){
    h.at(e.time);
    if(e.photo){
      const t=e.hostTime,melee=t>=200&&t<1400,moving=t>=200&&t<900,before=shown();
      const s=JSON.parse(JSON.stringify(h.game.snapshot()));s.frame=++frame;s.time=t;
      const authoritative={pos:[0,0,-speed*Math.min(700,Math.max(0,t-200))/1000],vel:[0,0,moving?-speed:0],yaw:aim.yaw,pitch:aim.pitch,
        predictionBlocked:melee?'melee':'',swing:moving?{a,t:(t-200)/1000,yaw0:0,phi:0,aimed:false,stopped:false}:null,
        lungeT:moving?(900-t)/1000:0,recoverT:melee&&!moving?(1400-t)/1000:0};
      Object.assign(s.units[0],authoritative);
      s.inputAcks={'B:0':{fixed:true,seq:h.game.state.seq,replaySeq:h.game.state.seq,step:frame,movementIds:[]}};s.acks={'B:0':h.game.state.seq};
      const wire=encoder.encode(s);if(wire.baseline)h.test.handleSnapshotControl('snapshotBase',wire.baseline);h.test.receiveSnapshot({frame,delta:wire.delta});
      if(melee&&t>200)photos.push({time:e.time,shift:shown().distanceTo(before),authoritative});
      assert(Math.abs(u.pos.z-authoritative.pos[2])<.011,'外挿を物理のposへ書かない');
    }else{
      h.game.beforeFrame(1/hz,e.time);c.updateCamera(u,1/hz);
      const dir=c.camera.getWorldDirection(new T.Vector3());
      rows.push({time:e.time,yaw:u.yaw,pitch:u.pitch,aim:aimPos.toArray(),shown:shown().toArray(),cameraYaw:Math.atan2(-dir.x,-dir.z)});
    }
  }
  const active=rows.filter(x=>x.time>350&&x.time<800),dy=active.slice(1).map((x,i)=>x.yaw-active[i].yaw);
  return {revision,hz,lockOn,speed,yaw:stats(dy),maxYawStep:Math.max(...dy.map(Math.abs)),
    maxPhotoViewShift:Math.max(...photos.map(x=>x.shift)),photoHash:crypto.createHash('sha256').update(JSON.stringify(photos.map(x=>x.authoritative))).digest('hex'),rows};
}
function summary(revision='working'){
  return {revision,sourceHashes:Object.fromEntries(['prototype/online/game.js','prototype/index.html','prototype/online/codec.js'].map(file=>[file,crypto.createHash('sha256').update(read(revision,file)).digest('hex')])),
    release:[60,120,144,240].map(hz=>{const {rows,...r}=releaseWalk(revision,hz);return r;}),
    lock:[60,120,144,240].flatMap(hz=>[false,true].map(on=>{const {rows,...r}=lockedLunge(revision,hz,on);return r;}))};
}
if(require.main===module)console.log(JSON.stringify(summary(process.argv.find(a=>a.startsWith('--revision='))?.split('=')[1]||'working'),null,2));
module.exports={releaseWalk,lockedLunge,createLockHarness,summary};
