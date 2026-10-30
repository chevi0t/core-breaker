const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});await p.goto('file://'+path.resolve(process.argv[2],'dbg.html'));const result=await p.evaluate(()=>{
 const g=__g;g.selectMap('river_castle');g.setup();g.running=false;const checks=[],ok=(name,pass,data)=>checks.push({name,pass:!!pass,data}),u=g.units.find(v=>!v.isPlayer),P=g.NAV.pts;
 for(const v of g.units)v.alive=false;u.alive=true;u.navW=Float32Array.from(g.NAV.links,()=>1);
 const bridge=g.NAV.links.find(l=>{const a=P[l.a],b=P[l.b];return Number.isFinite(g.waterHeightAt((a.x+b.x)/2,(a.z+b.z)/2))&&!g.botWetPath(a.x,a.z,b.x,b.z,a.y,b.y)});
 const a=P[bridge.a],q=P[bridge.b];ok('橋上リンクを水路と誤判定しない',g.clearPath(a.x,a.z,q.x,q.z,a.y,u));
 const wet=P.find(p=>g.botWetAt(p.x,p.z,p.y));ok('川底は水路判定',g.botWetPath(wet.x,wet.z,wet.x+1,wet.z,wet.y));
 const route=g.navPath(u,692,787);ok('対岸への橋経路が残る',route?.length>1&&!route.some((n,i)=>i&&g.NAV.links[g.NAV.adj[route[i-1]].find(e=>e[0]===n)[1]].wet),route);
 for(const start of [590,692])for(const legs of ['heavy','anchor']){
  u.mech={...g.MECH_DEFAULT,legs};g.equip(u,'heavy');Object.assign(u,{alive:true,invulT:0,stun:'',stunT:0,repairing:false,planted:false,transfer:null,flying:false,catMomentum:null,catLaunch:null,ctrlLockT:0,dashT:0,longDash:false,lungeT:0,recoverT:0,slideT:0,swing:null,zip:null,electricT:0,navPath:null,navT:0,navChk:0,navRc:0,onGround:true});u.pos.set(P[start].x,P[start].y,P[start].z);u.vel.set(0,0,0);const goal=new g.T.Vector3(P[787].x,P[787].y,P[787].z);let elapsed=0,wetTime=0;
  while(elapsed<40&&u.pos.distanceTo(goal)>3){const d=Math.hypot(goal.x-u.pos.x,goal.z-u.pos.z),to=g.navSteer(u,goal,d,1/30),wish=new g.T.Vector3(to.x-u.pos.x,0,to.z-u.pos.z).normalize();g.physics(u,wish,false,false,1/30);if(g.botWetAt(u.pos.x,u.pos.z,u.pos.y))wetTime+=1/30;elapsed+=1/30;}
  ok('橋ルートを実歩行 '+start+'/'+legs,u.pos.distanceTo(goal)<4&&wetTime===0,{elapsed,wetTime,pos:u.pos.toArray(),goal:goal.toArray()});
 }
 const exits=[[{x:135,y:-2,z:35}],[{x:115,y:-2,z:95}]];
 for(const legs of ['heavy','anchor'])for(const [w,d] of exits){
  u.mech={...g.MECH_DEFAULT,legs};g.equip(u,'heavy');Object.assign(u,{alive:true,hp:u.maxHp,invulT:0,stun:'',stunT:0,transfer:null,planted:false,repairing:false,flying:false,catMomentum:null,catLaunch:null,ctrlLockT:0,lungeT:0,dashT:0,longDash:false,slideT:0,recoverT:0,swing:null,zip:null,electricT:0,think:999,act:null,snipe:false,healing:false,waterExit:null,navPath:null,navT:0,sideT:0,stuckT:0,waypoint:null,role:'plant',target:null});u.pos.set(w.x,w.y,w.z);u.vel.set(0,0,0);u.lastPos.copy(u.pos);let elapsed=0;
  while(elapsed<10&&g.botWetAt(u.pos.x,u.pos.z,u.pos.y)&&u.alive){g.botUpdate(u,1/30);g.waterDamageTick(u,1/30);elapsed+=1/30;}
  ok('落水から岸へ復帰 '+legs+'/'+w.x+'/'+w.z,u.alive&&!g.botWetAt(u.pos.x,u.pos.z,u.pos.y),{elapsed,pos:u.pos.toArray(),hp:u.hp});
 }
 return checks;
 });fs.writeFileSync(process.argv[3],JSON.stringify({checks:result,errors},null,2));console.log(JSON.stringify({checks:result.length,failed:result.filter(c=>!c.pass),errors}));assert(!errors.length&&result.every(c=>c.pass));}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
