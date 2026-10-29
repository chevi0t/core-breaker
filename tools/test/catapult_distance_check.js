// 発射時の無入力着地点を基準にした距離60%と、噴射による加減速を実物理で確認。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader']});
 try{
  const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});
  await p.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
  const result=await p.evaluate(()=>{
   const g=__g,T=g.T,checks=[],rows=[];const ok=(name,pass,data={})=>checks.push({name,pass:!!pass,...data});
   g.selectMap('mobility');g.setup();const u=g.player;for(const v of g.units)v.alive=v===u;
   const cp=g.catapults[0];
   function reset(type){u.mech={head:type==='anchor4'?'heavy':type,body:'heavy',arms:'heavy',legs:type,color:'team'};g.equip(u,'assault');g.spawn(u);u.pos.copy(cp.pos);Object.assign(u,{stun:'',stunT:0,jumpPad:null,chargerOn:false,electricT:0,recoverT:0,planted:false,boost:u.maxBoost,overheat:false});const at=performance.now();g.launch(u,cp);return performance.now()-at;}
   for(const type of ['light','heavy','anchor4'])for(const dt of [1/30,1/120]){
    const cases={};
    for(const mode of ['coast','forward','reverse','empty']){
     const launchMs=reset(type),origin=u.pos.clone(),f=u.catMomentum.clone(),range=u.catLaunch.range,initial=u.flightSpeed;
     let unlock=null,previous=0,maxLockedError=0,snapshot=null,emptyBoost=mode==='empty',rangeFixed=true,staysFree=true;
     if(emptyBoost){u.boost=0;u.overheat=true;}
     for(let time=0;time<30&&!u.onGround;time+=dt){
      const locked=u.ctrlLockT>0,before=u.vel.clone(),wish=mode==='coast'?new T.Vector3():f.clone().multiplyScalar(mode==='reverse'?-1:1);
      if(emptyBoost){u.boost=0;u.overheat=true;}
      g.physics(u,wish,mode!=='coast',false,dt,false);
      const progress=u.pos.clone().sub(origin).dot(f);
      if(locked&&!u.catLaunch?.free&&u.flying)maxLockedError=Math.max(maxLockedError,Math.abs(u.vel.dot(f)-initial));
      if(u.catLaunch?.free&&!unlock){unlock={time:time+dt,ratio:progress/range,previous:previous/range,speedJump:Math.hypot(u.vel.x-before.x,u.vel.z-before.z)};}
      if(unlock&&!snapshot&&time+dt>=unlock.time+.18)snapshot={forward:u.vel.dot(f),boost:u.boost};
      if(u.catLaunch){rangeFixed&&=u.catLaunch.range===range;if(unlock)staysFree&&=u.catLaunch.free&&u.ctrlLockT===0;}
      previous=progress;
     }
     const distance=Math.hypot(u.pos.x-origin.x,u.pos.z-origin.z);
     ok('60%境界 '+type+'/'+mode,unlock&&unlock.previous<.6&&unlock.ratio>=.6&&unlock.ratio<.64,{unlock});
     ok('固定中は噴射で速度変更しない '+type+'/'+mode,maxLockedError<.1,{maxLockedError});
     if(mode==='coast'){ok('無入力着地距離の予測 '+type,Math.abs(distance-range)<2,{distance,range});ok('解除時の速度連続 '+type,unlock.speedJump<.01,{jump:unlock.speedJump});}
     ok('基準距離固定・逆行しても再固定しない '+type+'/'+mode,rangeFixed&&staysFree);
     ok('接地で全状態解除 '+type+'/'+mode,u.onGround&&!u.catMomentum&&!u.catLaunch&&u.ctrlLockT===0);
     cases[mode]={snapshot,distance,initial,launchMs,unlock};
    }
    ok('前噴射で加速 '+type,cases.forward.snapshot?.forward>cases.coast.snapshot?.forward+2);
    ok('逆噴射で減速 '+type,cases.reverse.snapshot?.forward<cases.coast.snapshot?.forward-2);
    ok('通常ブースト消費 '+type,cases.forward.snapshot?.boost<cases.coast.snapshot?.boost);
    ok('資源ゼロでは加速しない '+type,Math.abs(cases.empty.snapshot?.forward-cases.empty.initial)<.1);
    rows.push({type,dt,cases});
   }
   reset('heavy');g.spawn(u);ok('再出撃で解除',!u.catLaunch&&!u.catMomentum&&u.ctrlLockT===0);
   reset('heavy');g.kill(u,u,false,Infinity);ok('死亡で解除',!u.catLaunch&&!u.catMomentum&&u.ctrlLockT===0);
   return {rows,checks};
  });
  fs.writeFileSync(process.argv[3],JSON.stringify({...result,errors},null,2));const failed=result.checks.filter(x=>!x.pass);console.log(JSON.stringify({cases:result.rows.length,checks:result.checks.length,failed,errors}));assert(!failed.length&&!errors.length);
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
