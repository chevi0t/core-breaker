// 飛行時間と操作禁止を分離し、射出後の実入力と早期着地後の操作を検査する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await page.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await page.goto(pathToFileURL(path.join(path.resolve(process.argv[2]||'dbg'),'dbg.html')).href);
  const result=await page.evaluate(()=>{
   const g=__g,T=g.T,zero=new T.Vector3(),rows=[],early=[];
   const ok=(v,m,d)=>{if(!v)throw Error(m+' '+JSON.stringify(d));};
   function reset(u,at,type,team,isPlayer=true){
    for(const k of Object.keys(g.keys))delete g.keys[k];for(const k of Object.keys(g.pressed))delete g.pressed[k];
    u.isPlayer=isPlayer;u.team=team;u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.equip(u,'assault');g.spawn(u);
    u.pos.copy(at);u.vel.set(0,0,0);u.boost=u.maxBoost;
    Object.assign(u,{onGround:true,catCd:0,stun:'',stunT:0,dashT:0,ctrlLockT:0,flying:false,chargerOn:false});
   }
   const coast=(u,seconds,dt)=>{for(let i=0;i<Math.ceil(seconds/dt);i++)g.physics(u,zero,false,false,dt);};
   for(const map of ['hoshimichi','kanto','mesa']){
    g.selectMap(map);g.setup();g.running=false;const u=g.player;for(const other of g.units)other.alive=other===u;
    let count=0,maxLandingError=0;
    for(const cp of g.catapults)for(const type of ['light','heavy'])for(const team of ['B','R'])for(const dt of [1/30,1/120]){
     const info={map,from:cp.pos.toArray(),flight:cp.flight||2.8,type,team,dt};
     reset(u,cp.pos,type,team);g.launch(u,cp);
     ok(u.ctrlLockT===1,'飛行時間によらず操作禁止は最初の1秒',info);
     coast(u,.5,dt);ok(!g.shortDash(u,new T.Vector3(1,0,0)),'射出直後の禁止は維持',info);
     coast(u,.6,dt);ok(u.ctrlLockT===0,'1秒後には操作禁止を解く',info);
     for(let t=1.1;t<(cp.flight||2.8)+2&&!u.onGround;t+=dt)g.physics(u,zero,false,false,dt);
     const error=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z);
     const floor=map==='mesa'?g.groundAt(u.pos.x,u.pos.z,u.pos.y+.5):cp.land.y;
     ok(u.onGround&&error<6&&Math.abs(u.pos.y-floor)<.1,'無入力なら従来の着地点へ届く',{...info,error,at:u.pos.toArray()});
     ok(u.ctrlLockT===0,'通常着地後にも禁止を残さない',info);maxLandingError=Math.max(maxLandingError,error);
     reset(u,cp.pos,type,team);g.launch(u,cp);
     const forward=u.vel.clone().setY(0).normalize(),launchSpeed=Math.hypot(u.vel.x,u.vel.z);let minSpeed=launchSpeed;
     for(let t=0;t<(cp.flight||2.8)+2&&!u.onGround;t+=dt){
      g.physics(u,forward,false,false,dt);
      if(!u.onGround)minSpeed=Math.min(minSpeed,Math.hypot(u.vel.x,u.vel.z));
     }
     const forwardError=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z);
     ok(u.onGround&&forwardError<6&&minSpeed>=launchSpeed*.99,'前進入力で歩行速度へ落ちず、射出の勢いで着地する',{...info,launchSpeed,minSpeed,forwardError});
     // ShiftとSpaceはplayerUpdateに実際のキー状態を渡し、入力経路も調べる。
     reset(u,cp.pos,type,team);g.launch(u,cp);coast(u,1.1,dt);const beforeDash=u.boost;
     g.keys.KeyD=g.keys.ShiftLeft=g.pressed.ShiftLeft=true;g.playerUpdate(u,dt);
     ok(u.dashState==='short'&&u.boost<beforeDash,'1秒後のShiftで空中ダッシュできる',info);
     reset(u,cp.pos,type,team);g.launch(u,cp);
     for(let t=0;t<(cp.flight||2.8)+1&&u.vel.y>=-8;t+=dt)g.physics(u,zero,false,false,dt);
     ok(!u.onGround&&u.ctrlLockT===0,'降下中に操作できる',info);
     const beforeHover=u.boost,fall=u.vel.y;g.keys.Space=true;g.playerUpdate(u,dt);
     ok(u.dashState==='hover'&&u.boost<beforeHover&&u.vel.y>fall,'Space長押しで降下を緩められる',info);
     // Botも同じ解除条件でブーストを使える。
     reset(u,cp.pos,type,team,false);g.launch(u,cp);coast(u,1.1,dt);
     ok(g.shortDash(u,new T.Vector3(1,0,0)),'Botにも同じ操作解除を適用',info);count++;
    }
    reset(u,g.catapults[0].pos,'heavy','B');g.launch(u,g.catapults[0]);coast(u,1.1,1/120);
    const beforeTurn=u.vel.clone().setY(0),wish=beforeTurn.clone().normalize().applyAxisAngle(new T.Vector3(0,1,0),Math.PI/4);
    for(let t=0;t<.3;t+=1/120)g.physics(u,wish,false,false,1/120);
    ok(u.vel.clone().setY(0).normalize().dot(wish)>beforeTurn.clone().normalize().dot(wish),'1秒後も移動入力で旋回できる',map);
    rows.push({map,catapults:g.catapults.length,cases:count,maxLandingError,forwardMomentum:true,steering:true});
   }
   g.selectMap('mobility');g.setup();g.running=false;const u=g.player;for(const other of g.units)other.alive=other===u;
   // 低い天井へ触れ、操作禁止の1秒以内に地面へ戻る状況を実物理で作る。
   const ceiling={minX:-75,maxX:-35,minZ:-10,maxZ:10,bottom:8,top:10};g.obstacles.push(ceiling);
   for(const type of ['light','heavy'])for(const dt of [1/30,1/120])for(const isPlayer of [true,false]){
    reset(u,new T.Vector3(-60,0,0),type,'B',isPlayer);g.launch(u,{land:new T.Vector3(-40,0,0),flight:6.4,flash:0});
    let t=0;for(;t<1&&!u.onGround;t+=dt)g.physics(u,zero,false,false,dt);
    ok(t<1&&u.onGround,'天井で止まり1秒以内に着地',{type,dt,t});
    ok(u.ctrlLockT===0,'早期着地でも操作禁止を必ず解除',{type,dt,isPlayer,t,lock:u.ctrlLockT});
    ok(g.shortDash(u,new T.Vector3(1,0,0)),'早期着地後もダッシュできる',{type,dt,isPlayer});
    g.physics(u,zero,false,true,dt);ok(!u.onGround&&u.vel.y>0,'早期着地後も地上ジャンプできる',{type,dt,isPlayer});
    early.push({type,dt,isPlayer,seconds:t});
   }
   g.obstacles.splice(g.obstacles.indexOf(ceiling),1);
   reset(u,g.jumpPads[0].pos,'heavy','B');g.jumpPadUpdate(.05);
   ok(u.ctrlLockT===0&&g.shortDash(u,new T.Vector3(1,0,0)),'垂直パッドは従来どおり即座に空中操作できる');
   return {maps:rows,earlyLandings:early};
  });
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.resolve('mapdesign/catapult-control-check.json'),JSON.stringify({...result,errors},null,2)+'\n');
  console.log(JSON.stringify(result));console.log('全台で前進時の勢い・旋回・1秒後の実入力・無入力着地・Bot、早期着地8条件と垂直パッド：成功。ブラウザエラー0。');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
