// 台地/広域演習場の設計地形に沿う往復路を、旧版/修正版の実物理で比較する。
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.fulfill({body:''}));await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});await page.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
 const result=await page.evaluate(()=>{const g=__g,out=[];
 for(const map of ['mesa','wide']){g.selectMap(map);g.setup();for(const u of g.units)u.alive=false;const u=g.player,rows=[],routes=[];
 const grad=(x,z)=>Math.hypot((g.terrainH(x+.1,z)-g.terrainH(x-.1,z))/.2,(g.terrainH(x,z+.1)-g.terrainH(x,z-.1))/.2);
 const add=(name,a,b)=>routes.push({name,a,b});
 for(const sign of [1,-1]){
  const v=a=>a.map(n=>n*sign),f=g.curMap.terrain.find(f=>f.type==='ramp');
  for(const offset of [-4,0,4])add('base ramp '+sign+' offset '+offset,v([(f.x0+f.x1)/2+offset,f.z1+3]),v([(f.x0+f.x1)/2+offset,f.z0-4]));
  add('base ramp diagonal '+sign,v([(f.x0+f.x1)/2-4,f.z1+3]),v([(f.x0+f.x1)/2+4,f.z0-4]));
  for(const f of g.curMap.terrain.filter(f=>f.type==='hill'&&f.h>=4))for(let i=0;i<4;i++){const t=i*Math.PI/2;add('hill '+sign+' '+f.x+','+f.z+' '+i,v([f.x+Math.cos(t)*f.r,f.z+Math.sin(t)*f.r]),v([f.x,f.z]));}
  const t=g.curMap.terrain.find(f=>f.type==='trench'&&f.x< -100);for(const z of [0,40])add('valley '+sign+' '+z,v([t.x+t.w+t.slope+2,z]),v([t.x,z]));add('valley length '+sign,v([t.x,110]),v([t.x,0]));
  const pod=map==='mesa'?[-40,117]:[-57.5,180];add('pod entrance '+sign,v([pod[0],pod[1]+12]),v(pod));
 }
 if(map==='mesa')for(let i=0;i<8;i++){const t=i*Math.PI/4;add('central mound '+i,[Math.cos(t)*38,Math.sin(t)*38],[Math.cos(t)*20,Math.sin(t)*20]);}
 else for(let i=0;i<4;i++){const t=i*Math.PI/2;add('central depression '+i,[Math.cos(t)*32,Math.sin(t)*26],[Math.cos(t)*4,Math.sin(t)*4]);}
 // 坂ではない崖面への直進/斜め這い上がり。通れるべき経路とは別集計。
 const block=g.curMap.terrain.find(f=>f.type==='block'&&f.h>=10);add('cliff direct',[block.x-block.hx-5,block.z],[block.x,block.z]);add('cliff diagonal',[block.x-block.hx-5,block.z-8],[block.x,block.z+8]);
 let max=0,steep=0,total=0;for(let x=-g.curMap.size[0]+1;x<g.curMap.size[0];x+=2)for(let z=-g.curMap.size[1]+1;z<g.curMap.size[1];z+=2){const s=grad(x,z);max=Math.max(max,s);steep+=s>1.1;total++;}
 for(const r of routes)for(const mode of ['walk','boost','jump'])for(const reverse of [false,true]){
 const a=reverse?r.b:r.a,b=reverse?r.a:r.b;u.mech={head:'heavy',body:'heavy',arms:'heavy',legs:'heavy',color:'team'};g.equip(u,'assault');u.pos.set(a[0],g.terrainH(...a),a[1]);u.vel.set(0,0,0);Object.assign(u,{alive:true,onGround:true,stun:'',stunT:0,dashT:0,longDash:false,flying:false,ctrlLockT:0,catMomentum:null,jumpPad:null,transfer:null,repairing:false,overheat:false,boost:u.maxBoost,catCd:100,lungeT:0,slideT:0,kneeSlideT:0,crouching:false,actionBlockBoost:false,jumpBuf:0});
 let peakSlope=0;for(let i=0;i<=100;i++)peakSlope=Math.max(peakSlope,grad(a[0]+(b[0]-a[0])*i/100,a[1]+(b[1]-a[1])*i/100));
 let reached=false;for(let i=0;i<900;i++){const wish=new g.T.Vector3(b[0]-u.pos.x,0,b[1]-u.pos.z);if(wish.length()<1){reached=true;break;}wish.normalize();if(mode==='boost'&&i%60===0){u.boost=u.maxBoost;g.shortDash(u,wish);}g.physics(u,wish,mode==='boost',mode==='jump'&&i%120<20,1/60,false);}
 rows.push({name:r.name,mode,reverse,reached,at:u.pos.toArray(),maxDegrees:Math.atan(peakSlope)*180/Math.PI});
 }
 out.push({map,distribution:{grid:2,maxDegrees:Math.atan(max)*180/Math.PI,steep,total},rows});
 }return out;});fs.writeFileSync(process.argv[3],JSON.stringify({result,errors},null,2));console.log(JSON.stringify(result.map(r=>({map:r.map,cases:r.rows.length,failed:r.rows.filter(x=>!x.reached).length,distribution:r.distribution})),null,2));if(errors.length)throw Error(errors.join('\n'));
 for(const map of result)for(const r of map.rows)if(!r.name.startsWith('cliff')&&!r.reached)throw Error(map.map+': '+r.name+' '+r.mode+' reverse='+r.reverse);
 if(process.argv[4]){const before=JSON.parse(fs.readFileSync(process.argv[4])).result;for(let m=0;m<result.length;m++)for(let i=0;i<result[m].rows.length;i++){const a=before[m].rows[i],b=result[m].rows[i];if(a.name!==b.name||a.mode!==b.mode||a.reverse!==b.reverse||a.reached!==b.reached)throw Error('旧版との到達性差: '+b.name);}}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
