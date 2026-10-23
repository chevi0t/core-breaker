// パッドから既存の屋根を越えて別の街路へ実走し、高角・前線カタパルトも検査する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),imported=JSON.parse(fs.readFileSync(path.join(ROOT,'mapdesign/hoshimichi/import.json'),'utf8')),plan=imported.mobility;
plan.groundPassages=imported.groundPassages;
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--no-sandbox']});
 try{
  const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.stack));
  await p.route(/^https:\/\/fonts\./,r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await p.goto(pathToFileURL(path.join(path.resolve(process.argv[2]||'dbg'),'dbg.html')).href);
  await p.waitForFunction(()=>window.__g,{},{timeout:5000}).catch(e=>{throw Error(errors.join('\n')||e.message);});
  const result=await p.evaluate(plan=>{
   const g=__g,T=g.T;g.selectMap('hoshimichi');g.setup();g.running=false;
   const u=g.player,rows=[],ok=(v,m,d)=>{if(!v)throw Error(m+' '+JSON.stringify(d));};
   for(const other of g.units)other.alive=other===u;
   const vec=a=>new T.Vector3(a[0],a[2],a[1]);
   function reset(at,type,team){u.isPlayer=true;u.team=team;u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.spawn(u);u.pos.copy(at);u.vel.set(0,0,0);Object.assign(u,{onGround:true,catCd:0,stun:'',stunT:0,dashT:0,ctrlLockT:0,flying:false,jumpPad:null});}
   for(const road of plan.groundPassages.routes)for(const type of ['light','standard','heavy'])for(const reverse of [false,true])for(const dt of [1/30,1/120]){
    const a=reverse?road.to:road.from,b=reverse?road.from:road.to,start=new T.Vector3(a[0],g.terrainH(...a),a[1]),goal=new T.Vector3(b[0],g.terrainH(...b),b[1]);reset(start,type,'B');let reached=false;
    for(let t=0;t<40;t+=dt){const wish=goal.clone().sub(u.pos).setY(0);if(wish.length()<.4){reached=true;break;}g.physics(u,wish.normalize(),false,false,dt);ok(u.onGround,'地上通路はジャンプや浮遊なしで通れる');}
    ok(reached,'赤矢印の地上4通路を徒歩で往復',{road,type,reverse,dt,at:u.pos.toArray(),goal:goal.toArray()});rows.push({kind:'ground',road:road.from,type,reverse,dt,end:u.pos.toArray()});
   }
   for(const road of plan.groundPassages.routes)for(const team of ['B','R'])for(const type of ['light','heavy']){
    const a=road.from,b=road.to;reset(new T.Vector3(a[0],g.terrainH(...a),a[1]),type,team);u.isPlayer=false;u.role='attack';u.target=null;u.actCd=1e6;u.order={kind:'go',pos:new T.Vector3(b[0],g.terrainH(...b),b[1]),until:Infinity};let reached=false;
    for(let t=0;t<40;t+=.05){g.botUpdate(u,.05);if(Math.hypot(u.pos.x-b[0],u.pos.z-b[1])<7){reached=true;break;}}
    ok(reached,'Botも新しい地上通路を選んで通る',{road,type,team,at:u.pos.toArray()});rows.push({kind:'bot-ground',team,type,end:u.pos.toArray()});
   }
   g.scene.updateMatrixWorld(true);
   for(const check of plan.groundPassages.roofChecks){const [x,z]=check.at;ok(Math.abs(g.groundAt(x,z,1000)-check.top)<.05,'開口部の上の屋根・高架を保持',{...check,actual:g.groundAt(x,z,1000),near:[...g.cityMap.nearby(x,z,1)].map(v=>({top:v.top,kind:v.kind,rings:v.rings}))});}
   const inRing=(x,z,r)=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
   for(const road of plan.groundPassages.routes){
    let checked=0;for(const f of [.2,.35,.5,.65,.8])for(const offset of [-2,0,2]){const dx=road.to[0]-road.from[0],dz=road.to[1]-road.from[1],length=Math.hypot(dx,dz),x=road.from[0]+dx*f-dz/length*offset,z=road.from[1]+dz*f+dx/length*offset,y=g.terrainH(x,z),ceiling=g.ceilingAt(x,z,y);if(!Number.isFinite(ceiling))continue;
     // 接地カプセルの縁だけが屋根に重なる位置を避け、天井の面の真下から撃つ。
     if(![...g.cityMap.nearby(x,z,1)].some(v=>v.bottom===ceiling&&inRing(x,z,v.rings[0])&&!v.rings.slice(1).some(r=>inRing(x,z,r))))continue;
     ok(ceiling-y>=6,'頭上の空間6m以上');const hit=g.castFrom(new T.Vector3(x,y+3,z),new T.Vector3(0,1,0),u,ceiling-y+2);ok(hit&&Math.abs(hit.point.y-ceiling)<.05,'通路の天井にも弾が当たる',{x,z,ceiling,hit:hit?.point.toArray()});checked++;
    }ok(checked>0,'各通路の天井を検査');
   }
   ok(g.jumpPads.length===10,'共有パッド10基');
   for(let index=0;index<g.jumpPads.length;index++)for(const type of ['light','standard','heavy'])for(const team of ['B','R'])for(const dt of [1/30,1/120]){
    const pad=g.jumpPads[index],street=vec(plan.routes[index].street);reset(pad.pos,type,team);g.jumpPadUpdate(dt);
    ok(u.flying&&u.vel.x===0&&u.vel.z===0&&u.ctrlLockT===0,'垂直射出・即時の空中操作');
    let peak=0,land=null;
    for(let t=0;t<10;t+=dt){const wish=g.botMobilityGoal(u,pad.exit).clone().sub(u.pos).setY(0);if(wish.length()>1)wish.normalize();else wish.set(0,0,0);g.physics(u,wish,false,false,dt);peak=Math.max(peak,u.pos.y);if(u.onGround){land=u.pos.clone();break;}}
    ok(land&&land.y>=pad.exit.y-.05,'屋根へ着地',{index,type,team,dt,at:u.pos.toArray(),expected:pad.exit.toArray()});
    let crossed=false,jumps=0;
    for(let t=0;t<75;t+=dt){
     const wish=street.clone().sub(u.pos).setY(0);if(wish.length()<2&&u.onGround&&Math.abs(u.pos.y-street.y)<.1){crossed=true;break;}
     wish.normalize();const ahead=g.groundAt(u.pos.x+wish.x*2.5,u.pos.z+wish.z*2.5,u.pos.y+6);
     const jump=u.onGround&&ahead>u.pos.y+.6&&ahead<u.pos.y+6.4;
     if(jump)jumps++;g.physics(u,wish,false,jump,dt);
    }
    ok(crossed,'高架・街区の反対側の道路まで通り抜ける',{index,type,team,dt,landing:land.toArray(),street:street.toArray(),at:u.pos.toArray(),jumps,vel:u.vel.toArray(),stun:u.stun,ceiling:g.ceilingAt(u.pos.x,u.pos.z,u.pos.y),near:[...g.cityMap.nearby(u.pos.x,u.pos.z,4)].map(v=>({kind:v.kind,top:v.top,bottom:v.bottom}))});
    rows.push({kind:'pad',index,type,team,dt,peak,landing:land.toArray(),street:u.pos.toArray(),jumps});
   }
   for(const cp of g.catapults)for(const type of ['light','heavy'])for(const team of ['B','R'])for(const dt of [1/30,1/120]){
    reset(cp.pos,type,team);g.catapultUpdate(dt);let peak=-Infinity,land=null;
    for(let t=0;t<cp.flight+2;t+=dt){g.physics(u,new T.Vector3(),false,false,dt);peak=Math.max(peak,u.pos.y);if(u.onGround){land=u.pos.clone();break;}}
    const error=land?Math.hypot(land.x-cp.land.x,land.z-cp.land.z):Infinity;
    ok(land&&error<6&&Math.abs(land.y-cp.land.y)<.1,'高角台・前線台の最初の接地が指定地点6m以内',{plant:cp.plant?.id,type,team,dt,error,land:land?.toArray()});
    ok(peak-cp.pos.y>70,'短距離の基地台も高く打ち上がる',{from:cp.pos.toArray(),peak,flight:cp.flight});
    rows.push({kind:'catapult',from:cp.pos.toArray(),route:cp.plant?cp.plant.id+'→'+cp.targetPlant.id:'base',type,team,dt,flight:cp.flight,peak,error});
   }
   ok(g.catapults.filter(c=>c.targetPlant).map(c=>c.plant.id+'→'+c.targetPlant.id).sort().join(',')==='C→B,D→A','指定の前線2経路');
   for(const pad of g.jumpPads)for(const type of ['light','heavy'])for(const team of ['B','R']){
    reset(pad.pos,type,team);u.isPlayer=false;u.role='attack';u.target=null;u.order={kind:'go',pos:pad.exit.clone(),until:Infinity};let used=false,land=null;
    for(let t=0;t<20;t+=.05){g.botUpdate(u,.05);g.jumpPadUpdate(.05);used ||= u.jumpPad===pad;if(used&&u.onGround){land=u.pos.clone();break;}}
    ok(land&&land.y>=pad.exit.y-.05,'本体Botが屋根へ到達',{type,team,pad:pad.pos.toArray(),at:u.pos.toArray()});
    rows.push({kind:'bot-pad',type,team,from:pad.pos.toArray(),landing:land.toArray()});
   }
   return rows;
  },plan);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(ROOT,'mapdesign/hoshimichi/mobility-check.json'),JSON.stringify({cases:result,errors},null,2)+'\n');
  console.log('地上48条件・Bot地上16条件・高架と天井の保持、パッド通り抜け120条件・Bot屋根40条件、カタパルト80条件：成功。ブラウザエラー0。');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
