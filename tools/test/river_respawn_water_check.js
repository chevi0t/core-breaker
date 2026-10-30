// 翠河城下・橙プラントBを実再出撃処理と物理で検査する。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});await p.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
const result=await p.evaluate(()=>{const g=__g;g.selectMap('river_castle');g.setup();g.running=false;g.plants.find(p=>p.id==='B').owner='R';const u=g.player,rows=[];u.team='R';const coords=g.curMap.cityBattle.respawns.R.B;
for(const legs of ['heavy','anchor'])for(const isPlayer of [true,false])for(let i=0;i<3;i++){
 u.isPlayer=isPlayer;u.mech={...g.MECH_DEFAULT,legs};g.spawn(u);g.equip(u,'heavy');u.alive=true;u.downT=0;u.invulT=2;u.hp=u.maxHp;
 const random=Math.random;Math.random=()=>(i+.5)/3;g.spawnPos(u,'B');Math.random=random;u.vel.set(0,0,0);const start=u.pos.toArray();
 for(let t=0;t<300;t++){u.invulT=Math.max(0,u.invulT-1/60);g.physics(u,new g.T.Vector3(),false,false,1/60);g.waterDamageTick(u,1/60);}
 rows.push({legs,isPlayer,index:i,start,end:u.pos.toArray(),water:g.waterHeightAt(u.pos.x,u.pos.z),hp:u.hp,maxHp:u.maxHp,pass:Math.hypot(start[0]-coords[i][0],start[2]-coords[i][1])<.01&&u.pos.y>9.9&&u.invulT===0&&u.hp===u.maxHp});
}
// 旧地点の実地形は依然川底。地形変更やダメージ無効化で直したのではないこと。
const old=[[177.49,97.8],[184.69,95.15],[170.81,101.57]].map(([x,z])=>({x,z,floor:g.terrainH(x,z),water:g.waterHeightAt(x,z)}));
return {rows,old,coordinates:coords};});fs.writeFileSync(process.argv[3],JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({...result,errors}));assert(result.rows.every(r=>r.pass)&&result.old.every(r=>r.floor<r.water)&&!errors.length);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
