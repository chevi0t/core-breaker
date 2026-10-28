const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{const dir=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=undefined;let s=19;Math.random=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296)});await p.goto('file://'+path.join(dir,'dbg.html'));
 const result=await p.evaluate(()=>{
  const g=__g;g.selectMap('kazan_pass');document.getElementById('start').click();for(const u of g.units){u.alive=false;u.group.visible=false;}const checks=[],routes=[];const ok=(v,m)=>{checks.push({name:m,pass:!!v});};const u=g.player;
  const place=(a)=>{u.pos.set(a[0],a[2],a[1]);u.vel.set(0,0,0);Object.assign(u,{alive:true,onGround:true,stun:'',flying:false,repairing:false,transfer:null,planted:false,charging:false,dashT:0,longDash:false,overheat:false,ctrlLockT:0,boost:u.maxBoost,navPath:null,navVia:null});};
  ok(g.groundAt(80,0,2)===2&&g.groundAt(80,0,100)>19,'same XZ has separate lower/upper floors');ok(g.ceilingAt(80,0,2)===14,'tunnel 12m clearance');
  const scenarios=[['tunnel',[[25,0,2],[125,0,2]],false],['roof',[[80,50,34],[80,-50,34]],false],['bridge',[[-75,30,24.3125],[75,30,33.6875]],false],['under_bridge',[[-20,10,2],[-20,45,2]],false],...g.curMap.recipeMeta.routes.filter(r=>['valley','hillside','ridge'].includes(r.id)).map(r=>[r.id,r.points,true])];
  for(const cls of ['light','heavy'])for(const [name,points,nav] of scenarios)for(const reverse of [false,true]){
   const actualPoints=points.map(a=>name==='bridge'||name==='tunnel'?a:[a[0],a[1],['roof','ridge'].includes(name)?g.groundAt(a[0],a[1],100):g.terrainH(a[0],a[1])]);
   u.mech={head:cls,body:cls,arms:cls,legs:cls,color:'team'};g.equip(u,'assault');const ps=reverse?[...actualPoints].reverse():actualPoints;place(ps[0]);let ticks=0,failed=null;
   for(const a of ps.slice(1)){const goal=new g.T.Vector3(a[0],a[2],a[1]);let arrived=false;for(let i=0;i<1400;i++){const gd=Math.hypot(goal.x-u.pos.x,goal.z-u.pos.z);if(gd<1.5&&Math.abs(u.pos.y-goal.y)<1.5){arrived=true;break;}const to=nav?g.navSteer(u,goal,gd,.05):goal;g.physics(u,new g.T.Vector3(to.x-u.pos.x,0,to.z-u.pos.z).normalize(),false,false,.05);ticks++;}if(!arrived){failed={at:u.pos.toArray(),goal:goal.toArray()};break;}}
   routes.push({name,cls,reverse,controller:nav?'BOT navSteer + physics':'player physics',seconds:ticks*.05,pass:!failed,failed});
  }
  // 凹外周へ歩く。箱範囲内でも切欠きは通れない。
  place([-105,0,2]);for(let i=0;i<180;i++)g.physics(u,new g.T.Vector3(-1,0,0),true,false,1/60);ok(g.cityMap.withinBoundary(u.pos.x,u.pos.z,1.29)&&u.pos.x>-109,'concave notch stops boosted player');
  const boundaryChecks=[];for(const y of [2,100])for(const a of g.curMap.cityTerrain.boundary){for(const dx of [-.1,0,.1]){u.pos.set(a[0]+dx,y,a[1]);u.vel.set(-30,0,30);g.resolve(u);boundaryChecks.push(g.cityMap.withinBoundary(u.pos.x,u.pos.z,1.29));}}ok(boundaryChecks.every(Boolean),'all concave/convex boundary vertices retain capsule at ground and altitude');
  place([80,0,2]);u.onGround=false;u.vel.y=25;let maxY=2;for(let i=0;i<120;i++){g.physics(u,new g.T.Vector3(),false,false,1/60);maxY=Math.max(maxY,u.pos.y);}ok(maxY<=10.01&&Math.abs(u.pos.y-2)<.1,'upward movement hits bore ceiling then returns to lower floor');
  const ray=(a,b)=>{const from=new g.T.Vector3(...a),to=new g.T.Vector3(...b),v=to.sub(from),len=v.length();return g.castFrom(from,v.normalize(),u,len);};
  ok(!ray([25,5,0],[125,5,0]),'projectile passes through bore');ok(!!ray([80,5,0],[80,24,0]),'projectile hits tunnel ceiling');ok(!!ray([80,5,0],[80,5,20]),'projectile hits tunnel side');ok(!!ray([-20,5,30],[-20,40,30]),'projectile hits bridge underside');
  place([80,0,2]);u.yaw=-Math.PI/2;u.pitch=0;u.group.visible=true;u.group.position.copy(u.pos);for(let i=0;i<20;i++)g.updateCamera(u,.05);ok(g.cityMap.cameraFree(g.camera.position,.2),'camera stays outside rock in tunnel');
  const spawns=[];for(const team of ['B','R']){u.team=team;for(const id of [null,...g.plants.map(p=>p.id)]){if(id)g.plants.find(p=>p.id===id).owner=team;for(let n=0;n<5;n++){const a=g.cityBattle.pickSpawn(team,id,g.plants);spawns.push(g.cityBattle.free(a[0],a[2],a[1],g.obstacles));}}}ok(spawns.every(Boolean),'base and objective spawns have free capsule space');
  return {checks,routes,navigation:g.cityBattle.navigationReport,geometry:g.cityMap.geometryStats};
 });
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,errors},null,2));console.log(JSON.stringify(result,null,2));assert(!errors.length,errors.join('\n'));assert(result.checks.every(x=>x.pass)&&result.routes.every(x=>x.pass),'terrain checks failed; see result.json');
 console.log('PASS '+(result.checks.length+result.routes.length));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
