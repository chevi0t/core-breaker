// 垂直パッドで実際の屋根へ着地・離脱し、B/D→Cを機体の物理で飛ぶ。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--no-sandbox']});
 try{
  const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.stack));
  await p.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await p.goto(pathToFileURL(path.join(path.resolve(process.argv[2]),'dbg.html')).href);
  const result=await p.evaluate(()=>{
   const g=__g,T=g.T;g.selectMap('kanto');g.setup();g.running=false;
   const rows=[],u=g.player,check=(v,m,d)=>{if(!v)throw Error(m+' '+JSON.stringify(d));};
   for(const other of g.units)other.alive=other===u;
   function reset(at,type,team){u.team=team;u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.equip(u,'assault');g.spawn(u);u.pos.copy(at);u.vel.set(0,0,0);Object.assign(u,{onGround:true,catCd:0,stun:'',stunT:0,dashT:0,ctrlLockT:0,flying:false,jumpPad:null});}
   check(g.jumpPads.length===6,'街路パッド6基');
   for(const pad of g.jumpPads)for(const type of ['light','standard','heavy'])for(const team of ['B','R'])for(const dt of [1/30,1/120]){
    reset(pad.pos,type,team);g.jumpPadUpdate(dt);
    check(u.flying&&u.vel.x===0&&u.vel.z===0&&u.ctrlLockT===0,'垂直射出・即座に空中操作できる');
    let peak=0,land=null;
    for(let t=0;t<10;t+=dt){
     const goal=g.botMobilityGoal(u,pad.exit),wish=goal.clone().sub(u.pos).setY(0);
     if(wish.length()>1)wish.normalize();else wish.set(0,0,0);
     g.physics(u,wish,false,false,dt);peak=Math.max(peak,u.pos.y);
     if(u.onGround){land=u.pos.clone();break;}
    }
    check(land&&land.y>=pad.exit.y-.05,'軽量・重量とも屋根へ着地',{type,team,dt,pad:pad.pos.toArray(),exit:pad.exit.toArray(),land:land?.toArray(),peak});
    // パッドと反対へ歩いて建物から降り、地上へ戻れる。
    const walk=pad.exit.clone().sub(pad.pos).setY(0).normalize();let returned=false;
    for(let t=0;t<60;t+=dt){g.physics(u,walk,false,false,dt);if(u.onGround&&u.pos.y<.1){returned=true;break;}}
    check(returned,'屋根から地上へ離脱できる',{pad:pad.pos.toArray(),type,at:u.pos.toArray()});
    rows.push({kind:'pad',type,team,dt,from:pad.pos.toArray(),landing:land.toArray(),peak,returned});
   }
   const routes=g.catapults.filter(cp=>cp.targetPlant);check(routes.length===2,'B/D→Cの2基');
   for(const cp of routes)for(const type of ['light','heavy'])for(const team of ['B','R'])for(const dt of [1/30,1/120])for(const offset of [-1.5,0,1.5]){
    reset(cp.pos.clone().add(new T.Vector3(offset,0,0)),type,team);g.catapultUpdate(dt);let land=null,peak=0;
    for(let t=0;t<cp.flight+2;t+=dt){g.physics(u,new T.Vector3(),false,false,dt);peak=Math.max(peak,u.pos.y);if(u.onGround){land=u.pos.clone();break;}}
    const error=land?Math.hypot(land.x-cp.land.x,land.z-cp.land.z):Infinity;
    check(land&&Math.abs(land.y-cp.land.y)<.05&&error<6,'ビルを越え中央の指定位置へ着地',{plant:cp.plant.id,flight:cp.flight,type,team,dt,offset,land:land?.toArray(),error});
    rows.push({kind:'catapult',plant:cp.plant.id,target:cp.targetPlant.id,type,team,dt,offset,flight:cp.flight,peak,error});
   }
   for(const pad of g.jumpPads)for(const type of ['light','heavy'])for(const team of ['B','R']){
    reset(pad.pos,type,team);u.isPlayer=false;u.role='attack';u.target=null;u.order={kind:'go',pos:pad.exit.clone(),until:Infinity};
    let used=false,land=null;
    for(let t=0;t<20;t+=.05){g.botUpdate(u,.05);g.jumpPadUpdate(.05);used ||= u.jumpPad===pad;if(used&&u.onGround){land=u.pos.clone();break;}}
    check(land&&land.y>=pad.exit.y-.05,'本体Botの指示・空中操作でも屋根へ到達',{type,team,pad:pad.pos.toArray(),land:land?.toArray(),at:u.pos.toArray(),used});
    rows.push({kind:'bot-pad',type,team,from:pad.pos.toArray(),landing:land.toArray()});u.isPlayer=true;
   }
   const lawn=g.cityMap.district.lawns;check(lawn?.length,'公園の芝生がある');
   check(g.terrainH(-444,-255)===0,'芝生の見た目で地面を変えない');
   return rows;
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve('mapdesign/kanto/mobility-check.json'),JSON.stringify({cases:result,errors},null,2)+'\n');
  console.log('パッド72条件・カタパルト48条件・本体Botの屋上到達24条件：成功。ブラウザエラー0。');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
