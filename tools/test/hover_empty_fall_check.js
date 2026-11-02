// 空中ガス欠の鉛直軌道、回復待ち、着地/再使用。旧版を第3引数へ渡すと比較も記録。
const {chromium}=require('playwright'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{
const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
async function run(dir,verify){await p.goto('file://'+path.resolve(dir)+'/dbg.html');return p.evaluate(verify=>{
const g=__g,T=g.T;g.selectMap('dock');g.setup();g.running=false;const u=g.player,rows=[];
const ok=(x,m)=>{if(verify&&!x)throw Error(m);};
function reset(legs,boost,bot=false){u.mech={...g.MECH_DEFAULT,legs};g.equip(u,'assault');g.spawn(u);Object.assign(u,{isPlayer:!bot,pos:new T.Vector3(-30,1000,-30),vel:new T.Vector3(0,-3,0),onGround:false,boost,boostIdle:0,overheat:false,stun:'',stunT:0,dashT:0,longDash:false,ctrlLockT:0,flying:false,chargerOn:false,charging:false,actionHeld:false});}
for(const legs of ['skimmer','anchor','wisp'])for(const hz of [30,60,120])for(const held of [false,true])for(const bot of [false,true])for(const initial of [0,.1]){
reset(legs,initial,bot);if(initial){u.longDash=!held;g.physics(u,new T.Vector3(),!held,false,1/hz,held);ok(u.overheat&&u.boost===0,'自然消費でガス欠');}
const y=u.pos.y,v=u.vel.y;for(let i=0;i<hz;i++)g.physics(u,new T.Vector3(),held,false,1/hz,held);
const actual={y:u.pos.y,v:u.vel.y,boost:u.boost};ok(u.overheat,'回復途中に浮遊を再開しない');
reset('standard',0,bot);u.overheat=true;u.pos.y=y;u.vel.y=v;for(let i=0;i<hz;i++)g.physics(u,new T.Vector3(),held,false,1/hz,held);
ok(Math.abs(actual.y-u.pos.y)<1e-6&&Math.abs(actual.v-u.vel.y)<1e-6,'二脚と同じ落下 '+[legs,hz,held,bot,initial]);rows.push({legs,hz,held,bot,initial,hoverV:actual.v,bipedV:u.vel.y});
}
reset('skimmer',0);u.overheat=true;for(let i=0;i<240;i++)g.physics(u,new T.Vector3(),false,false,1/60);ok(!u.overheat&&u.boost===u.maxBoost,'満充填で再使用可能');g.physics(u,new T.Vector3(),false,false,1/60,true);ok(Math.abs(u.vel.y+.3)<1e-6,'満充填後の滞空');
reset('skimmer',0);u.overheat=true;u.pos.y=g.terrainH(-30,-30)+1;for(let i=0;i<240;i++)g.physics(u,new T.Vector3(),false,false,1/60);ok(u.onGround&&!u.overheat,'着地/回復');ok(g.shortDash(u,new T.Vector3(1,0,0)),'着地後再ブースト');
return {cases:rows.length,first:rows[0],last:rows.at(-1)};
},verify);}
let before;if(process.argv[3])before=await run(process.argv[3],false);const after=await run(process.argv[2],true);assert.deepEqual(errors,[]);console.log(JSON.stringify({before,after,errors},null,2));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
