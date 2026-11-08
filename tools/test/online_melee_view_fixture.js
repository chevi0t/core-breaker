// node tools/test/online_melee_view_fixture.js [--revision=ab43ed8]
// 製品game.js/codec/beforeFrame/weaponLook wrapper/描画camera wrapperのVM試験。
// 写真の軌道は人工データ。実physicsの命中・WebGL・RTC・実機の操作感を代用しない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),base=path.join(__dirname,'online_prediction.test.js'),localRequire=createRequire(base);
const copy=x=>JSON.parse(JSON.stringify(x));
function createMeleeSuite(revision='working'){
  assert(revision==='working'||/^[a-f0-9]{7,40}$/.test(revision));
  const read=p=>revision==='working'?fs.readFileSync(path.join(root,p),'utf8'):execFileSync('git',['show',revision+':'+p],{cwd:root,encoding:'utf8'});
  const files={'prototype/online/game.js':read('prototype/online/game.js'),'prototype/online/codec.js':read('prototype/online/codec.js'),'prototype/index.html':read('prototype/index.html')};
  const game=files['prototype/online/game.js'],html=files['prototype/index.html'];
  const source=fs.readFileSync(base,'utf8').split('\n{\n  const h=harness();reconcile')[0]
    .replace('weaponLook:empty','weaponLook:(u)=>{c.shownSwing=u.swing?{t:u.swing.t,angle:c.swingRel(u.swing)}:null;if(c.throwLook)throw Error("描画試験例外");}')
    .replace('getPrediction:()=>prediction,','getPrediction:()=>prediction,viewOffsetOf,blockedRenderOffset,updateLocalRenderOffset,'+
      (game.includes('function finishMeleeRender(')?'finishMeleeRender,localMeleeRenderSwing,':'')+
      'viewState:()=>({blockedView'+(game.includes('meleeRelease')?',meleeRelease,localMeleeSwing':'')+'}),');
  const c={console,setTimeout,clearTimeout,require:name=>name==='node:fs'||name==='fs'?{...fs,readFileSync:(p,...args)=>String(p)===path.join(root,'prototype/online/game.js')?game:fs.readFileSync(p,...args)}:localRequire(name)};
  c.require.resolve=localRequire.resolve;vm.createContext(c);vm.runInContext(source+'\nthis.api={harness,snapshot,reconcile,input};',c,{filename:base});
  const codec={module:{exports:{}},TextEncoder,TextDecoder,Buffer};vm.createContext(codec);vm.runInContext(files['prototype/online/codec.js'],codec);
  function create(){
    const h=c.api.harness(),u=h.c.player;h.units.splice(1);u.team='B';u.weapon='aux';
    u.slots={aux:{w:{type:'sword'},cd:0},main:{w:{type:'gun'},ammo:30},sp:{w:{}}};
    h.c.DEG=Math.PI/180;h.c.equip=()=>{}; // 装備境界だけ検査しWebGL機体を生成しない。
    vm.runInContext(html.slice(html.indexOf('function swingRel('),html.indexOf('// 刃のワールドでの向き')),h.c);
    h.c.collectLocalInput=u=>({keys:{},pressed:{},trigger:false,yaw:u.yaw,pitch:u.pitch,aimPoint:[0,0,-100]});
    const encoder=new codec.module.exports.Encoder();let frame=0;
    const deliver=(time,patch={})=>{
      const s=c.api.snapshot(h,++frame,patch,{fixed:true,seq:h.game.state.seq,step:frame,replaySeq:h.game.state.seq,movementIds:[]});s.time=time;
      const wire=encoder.encode(s);if(wire.baseline)h.test.handleSnapshotControl('snapshotBase',wire.baseline);
      const accepted=h.game.metrics().interpolation.acceptedSnapshots;h.test.receiveSnapshot({frame,delta:wire.delta});
      assert.equal(h.game.metrics().interpolation.acceptedSnapshots,accepted+1,'実codecと写真受理');return s;
    };
    return {h,u,deliver};
  }
  function physicalPhotos({dash=false,homing=false,wall=false}={}){
    const file=path.join(__dirname,'online_movement.test.js'),req=createRequire(file),ctx={console,require:name=>name==='node:fs'?{...fs,readFileSync:(p,...args)=>String(p)===path.join(root,'prototype/index.html')?html:fs.readFileSync(p,...args)}:req(name)};
    ctx.require.resolve=req.resolve;vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file,'utf8').split('let count=0;')[0]+'\nthis.api={harness,makeUnit};',ctx);
    const physical=ctx.api.harness(),p=physical.c;
    const initial=require('./online_physics_sync_fixture').createPhysicsSuite(revision).load('assault').harness().units[0];
    const u=ctx.api.makeUnit({weapon:'aux',walkV:initial.walkV,dashV:initial.dashV,cruiseV:initial.cruiseV,stats:initial.stats});
    u.slots.aux={w:initial.slots.aux.w,cd:0};p.units=[u];
    const target={alive:true,kind:'unit',pos:u.pos.clone().fromArray([0,0,-(dash?16:7)])};
    Object.assign(p,{fwdOf:u=>u.pos.clone().fromArray([-Math.sin(u.yaw),0,-Math.cos(u.yaw)]),isHumanControlled:()=>true,humanLockTarget:()=>homing?target:null,
      cancelSpawnInvul:()=>{},reveal:()=>{},bladeSweep:()=>{}}); // 敵への命中と演出は代役、移動/攻撃時計/誘導は実本体。
    vm.runInContext(html.slice(html.indexOf('const DEG ='),html.indexOf('// 刃が phi0')),p);
    if(wall)p.obstacles.push({minX:-20,maxX:20,minZ:-10,maxZ:-9,bottom:0,top:10});
    const result=[];
    for(let i=0;i<=126;i++){
      const time=i*1000/60,attack=i===12;
      if(homing)target.pos.x=2*Math.sin(time/800);
      if(attack&&dash){u.dashT=.1;u.vel.z=-35;}
      p.movementStatusTick(u,1/60);p.physics(u,u.pos.clone().fromArray([0,0,0]),false,false,1/60);
      p.swordTick(u,u.slots.aux,1/60,attack,target.pos);
      if(i%2===0)result.push({time,patch:{pos:Array.from(u.pos.toArray()),vel:Array.from(u.vel.toArray()),predictionBlocked:p.movementPredictionBlockReason(u),
        lungeT:u.lungeT,recoverT:u.recoverT,slideT:u.slideT,swing:u.swing?{a:copy(u.swing.a),...Object.fromEntries(['t','phi','yaw0','aimed','tilt','slope','pike','dashAttack','stopped','queued'].map(k=>[k,u.swing[k]]))}:null}});
    }
    return result;
  }
  function run({hz=60,speed=10,jitter=false,gap=null,turn=false,physical=null}={}){
    const {h,u,deliver}=create(),rows=[],photos=[],queue=[];
    const a={time:.7,windup:.1,sweep:.5,from:0,to:720,spin:true,recover:.5};
    const sourcePhotos=physical?physicalPhotos(physical):Array.from({length:61},(_,i)=>({time:i*1000/30}));
    for(const [i,photo]of sourcePhotos.entries()){
      const time=photo.time,delay=35+(jitter?[0,12,0,8,25,0][i%6]:0);
      if(gap&&time>=gap[0]&&time<gap[1])continue;
      queue.push({time:time+delay,kind:'photo',hostTime:time,patch:photo.patch});
    }
    for(let i=0;i<=Math.round(2.1*hz);i++)queue.push({time:i*1000/hz,kind:'render'});
    queue.sort((a,b)=>a.time-b.time||(a.kind==='photo'?-1:1));
    let lastFrame=null,yaw=0;
    for(const e of queue){h.at(e.time);
      if(e.kind==='photo'){
        const time=e.hostTime,inSwing=time>=200&&time<900,melee=time>=200&&time<1400;
        const patch=e.patch||{pos:[speed*Math.min(700,Math.max(0,time-200))/1000,0,0],vel:[inSwing?speed:0,0,0],
          swing:inSwing?{a,t:(time-200)/1000,yaw0:0,phi:0,aimed:false,stopped:false}:null,
          predictionBlocked:melee?'melee':'',lungeT:inSwing?(900-time)/1000:0,recoverT:melee&&!inSwing?(1400-time)/1000:0,yaw:0,pitch:0};
        const beforeYaw=u.yaw;deliver(time,patch);photos.push({time:e.time,yawJump:Math.abs(u.yaw-beforeYaw)});
      }else{
        const dt=lastFrame===null?1/hz:(e.time-lastFrame)/1000;lastFrame=e.time;
        if(turn){u.yaw+=dt*.7;yaw+=dt*.7;}
        h.game.beforeFrame(dt,e.time);
        const raw=copy({pos:u.pos.toArray(),vel:u.vel.toArray(),swing:u.swing,hp:u.hp,slots:u.slots});
        const ref=u.swing;h.c.weaponLook(u,dt);
        assert.equal(u.swing,ref,'描画後の確定swing参照');assert.deepEqual(copy({pos:u.pos.toArray(),vel:u.vel.toArray(),swing:u.swing,hp:u.hp,slots:u.slots}),raw,'描画で権威状態を変更しない');
        h.c.updateCamera(u);const cameraBefore=Array.from(u.pos.toArray());h.c.renderView();assert.deepEqual(Array.from(h.c.camera.position.toArray()),cameraBefore,'描画後camera復元');
        const display=h.renderedCamera().toArray(),offset=h.test.viewOffsetOf(u),expected=u.pos.clone();if(offset)expected.add(offset);
        assert.deepEqual(Array.from(display),Array.from(expected.toArray()),'描画cameraと自機offset一致');
        rows.push({time:e.time,shown:display[0],position:Array.from(display),rawPosition:Array.from(u.pos.toArray()),raw:u.pos.x,t:h.c.shownSwing?.t??null,angle:h.c.shownSwing?.angle??null,yaw:u.yaw,expectedYaw:yaw,visual:u.onlineVisualOffset?.x||0});
      }
    }
    const active=rows.filter(r=>r.time>350&&r.time<800),steps=active.slice(1).map((r,i)=>r.shown-active[i].shown);
    const phases=active.slice(1).map((r,i)=>r.t-active[i].t),mean=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length),avg=mean(steps);
    return {revision,hz,speed,jitter,gap,turn,physical,frames:rows.length,snapshots:photos.length,
      motion:{meanStep:avg,cv:Math.sqrt(mean(steps.map(x=>(x-avg)**2)))/avg,reverse:steps.filter(x=>x< -1e-8).length},
      phase:{stalled:phases.filter(x=>Math.abs(x)<1e-8).length,reverse:phases.filter(x=>x< -1e-8).length,maxStep:Math.max(...phases)},
      maxYawJump:Math.max(0,...photos.map(r=>r.yawJump)),maxStackedOffset:Math.max(...active.map(r=>Math.abs(r.visual))),
      rows,photos};
  }
  return {create,run,physicalPhotos,sourceHashes:Object.fromEntries(Object.entries(files).map(([p,s])=>[p,crypto.createHash('sha256').update(s).digest('hex')]))};
}
module.exports={createMeleeSuite};
if(require.main===module){const revision=process.argv.find(v=>v.startsWith('--revision='))?.slice(11)||'working',suite=createMeleeSuite(revision);
  console.log(JSON.stringify({sourceHashes:suite.sourceHashes,results:[60,144].flatMap(hz=>[10,26].flatMap(speed=>[false,true].map(jitter=>{const {rows,photos,...r}=suite.run({hz,speed,jitter,turn:true});return r;})))},null,2));}
