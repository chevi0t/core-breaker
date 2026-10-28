// 全パッドの射出初速と、障害物のない空中での到達高度を検査。
const assert=require('assert/strict'),path=require('path'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});await p.goto('file://'+path.resolve(process.argv[2]||'dbg','dbg.html'));
 const result=await p.evaluate(()=>{const g=__g,rows=[];for(const id of Object.keys(g.MAPS)){g.selectMap(id);if(!g.jumpPads.length)continue;g.setup();const u=g.player;for(const other of g.units)other.alive=false;u.alive=true;
 for(const pad of g.jumpPads)if(pad.exit.y+.5>=pad.pos.y+pad.rise){u.pos.copy(pad.pos);Object.assign(u,{flying:false,jumpPad:null,mobilityRoute:null,zip:null,healing:false,transfer:null});g.botMobilityGoal(u,pad.exit);if(u.mobilityRoute?.facility===pad)throw Error('BOT selected unreachable pad');}
 for(const pad of g.jumpPads)for(const cls of ['light','heavy']){u.mech={head:cls,body:cls,arms:cls,legs:cls,color:'team'};g.equip(u,'assault');u.pos.copy(pad.pos);u.vel.set(0,0,0);Object.assign(u,{onGround:true,flying:false,catCd:0,transfer:null,repairing:false,stun:'',dashT:0,longDash:false,catMomentum:null});g.jumpPadUpdate(1/240);const initial=u.vel.y;
 if(!g.curMap.jumpPads.some(d=>Math.abs(d.rise*.4-pad.rise)<1e-8))throw Error("height scale mismatch");
 // 天井や屋根の影響を除き、同じphysicsの放物線頂点を測る。
 u.pos.y+=300;const start=u.pos.y;let peak=start;for(let i=0;i<2400&&u.vel.y>0;i++){g.physics(u,new g.T.Vector3(),false,false,1/240);peak=Math.max(peak,u.pos.y);}rows.push({id,cls,rise:pad.rise,measured:peak-start,initial,vertical:u.vel.x===0&&u.vel.z===0});
 }}return rows;});
 assert(result.length>0);for(const r of result){assert(r.vertical,JSON.stringify(r));assert(Math.abs(r.measured-r.rise)<.2,JSON.stringify(r));}
 assert.deepEqual(errors,[]);console.log('PASS '+result.length+' pad/class launches: vertical, apex within0.2m of40% rise; no browser errors');
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
