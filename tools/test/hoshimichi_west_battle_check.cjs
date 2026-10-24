// 承認済みの施設配置・道路橋・移動・補給・占拠を通常本体で検査する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {build}=require('../build_hoshimichi_west_battle.cjs');
const ROOT=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||'/tmp/hoshimichi-west-battle-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const dbg=path.join(out,'dbg');
 execFileSync('python3',['tools/test/make_dbg.py',dbg],{cwd:ROOT});
 const file=path.join(dbg,'dbg.html');build(file,file);build(path.join(out,'battle.html'));
 const source=JSON.parse(fs.readFileSync(path.join(ROOT,'mapdesign/hoshimichi_west/battle/map.json')));
 const generation=JSON.parse(fs.readFileSync(path.join(ROOT,'mapdesign/hoshimichi_west/battle/generation.json')));
 const approved=JSON.parse(fs.readFileSync(path.join(ROOT,'mapdesign/hoshimichi_west/layout-proposal.json')));
 assert(fs.statSync(path.join(ROOT,'prototype/maps/hoshimichi_west.js')).size<=100000);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 const errors=[],external=[];
 try{
  const page=await browser.newPage({offline:true,viewport:{width:1440,height:900}});
  page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.__g);
  const results=await page.evaluate(({approved,generation})=>{
   const g=__g,T=g.T;g.setup();g.renderer.render=()=>{};g.running=false;
   const u=g.player,city=g.cityMap,result={};let checks=0;
   const ok=(v,m)=>{checks++;if(!v)throw Error(m);};
   ok(g.units.length===20&&g.plants.length===5&&g.turrets.length===8&&g.radars.length===2&&g.catapults.length===8&&g.pods.length===6,'通常の対戦設備と20機を生成');
   for(const b of approved.bases)ok(g.cores[b.team].pos.x===b.at[0]&&g.cores[b.team].pos.z===b.at[1],'承認済み基地位置');
   for(const p of approved.plants){const q=g.plants.find(q=>q.id===p.id);ok(q.pos.x===p.at[0]&&q.pos.z===p.at[1]&&q.owner===p.initialOwner&&Math.abs(q.pos.y)<.01,'承認済みプラント位置と初期所有');}
   ok(g.cityBattle.navigationReport.rejectedLinks===0&&g.cityBattle.navigationReport.removedNodes===0,'本体の経路検査で辺や節点が失われない');
   ok(!g.cityBattle.free(400,0,0,g.obstacles)&&!g.cityBattle.free(0,200,0,g.obstacles),'BOTの目標も進入範囲の内側に制限');
   for(const q of g.units)q.alive=false;u.alive=true;
   const fresh=(p,y=0)=>{g.spawn(u);u.pos.set(p[0],y,p[1]);u.vel.set(0,0,0);u.onGround=true;u.stun='';u.electricT=u.recoverT=0;u.flying=false;u.invulT=0;};
   result.captureClearance=[];
   for(const pl of g.plants){
    for(const r of [5,10,14.5])for(let angle=0;angle<Math.PI*2;angle+=Math.PI/6){
     const p=[pl.pos.x+Math.cos(angle)*r,pl.pos.z+Math.sin(angle)*r];fresh(p);const before=u.pos.clone();g.resolve(u);
     ok(before.distanceTo(u.pos)<.03&&Math.abs(g.groundAt(...[p[0],p[1],0]))<.01,'占拠円で機体が埋まらない '+pl.id);
    }
    result.captureClearance.push(pl.id);
   }
   result.spawnSlots={};
   for(const team of ['B','R']){
    const slots=[...g.curMap.cityBattle.baseSpawns[team]];
    for(const pl of g.plants)for(const p of g.curMap.cityBattle.respawns[team][pl.id]){
     const d=Math.hypot(p[0]-pl.pos.x,p[1]-pl.pos.z);ok(d>=46&&d<=52.05,'46〜52mの再出撃帯');slots.push(p);
    }
    for(const p of slots)ok(g.cityBattle.free(p[0],p[1],g.terrainH(...p),g.obstacles),'出撃候補が設備や建物に埋まらない');
    result.spawnSlots[team]=slots.length;
   }
   // 橋は真上からの見た目と、実際の接地・裏側の接触に同じ位置を使う。
   result.bridges=[];
   for(const deck of generation.bridgeDecks){
    const ring=deck.ring,center=ring.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]);
    ok(Math.abs(g.terrainH(...center))<.01&&Math.abs(g.groundAt(center[0],center[1],0))<.01,'道路橋の上は地上高0m');
    const sides=ring.map((p,i)=>{const q=ring[(i+1)%4];return {dx:q[0]-p[0],dz:q[1]-p[1],len:Math.hypot(q[0]-p[0],q[1]-p[1])};}).sort((a,b)=>b.len-a.len);
    let crossing=null;
    for(const v of [sides[0],sides.at(-1)])for(const offset of [0,-2,2,-4,4])for(const extension of [2,4,8]){
     const f=[v.dx/v.len,v.dz/v.len],c=[center[0]-f[1]*offset,center[1]+f[0]*offset],a=[c[0]-f[0]*(v.len/2+extension),c[1]-f[1]*(v.len/2+extension)],b=[c[0]+f[0]*(v.len/2+extension),c[1]+f[1]*(v.len/2+extension)];
     if(g.terrainH(...a)>-.01&&g.terrainH(...b)>-.01&&g.cityBattle.free(...a,0,g.obstacles)&&g.cityBattle.free(...b,0,g.obstacles)&&g.clearPath(...a,...b,0))crossing=[a,b];
    }
    ok(!!crossing,'道路方向に沿う橋と両岸の地上接続');
    const [a,b]=crossing;
    for(const [from,to] of [[a,b],[b,a]]){
     ok(g.clearPath(from[0],from[1],to[0],to[1],0),'橋と両岸の地上接続');fresh(from);const wish=new T.Vector3();let moved=false;
     for(let n=0;n<600;n++){const dx=to[0]-u.pos.x,dz=to[1]-u.pos.z,d=Math.hypot(dx,dz);if(d<.3){moved=true;break;}wish.set(dx/d,0,dz/d);g.physics(u,wish,false,false,1/60);ok(u.pos.y>-.05,'橋から川へ落ちない');}
     ok(moved,'実機体で橋を往復できる');
    }
    result.bridges.push({center,walkedBothWays:true});
   }
   // ナビの全辺を実機体で歩かせ、施設追加後の接触まで確認する。
   let walked=0;const wish=new T.Vector3();
   for(const link of g.NAV.links){
    const a=g.NAV.pts[link.a],b=g.NAV.pts[link.b];fresh([a.x,a.z],a.y);let arrived=false;
    for(let n=0;n<Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/5+3)*60;n++){
     const dx=b.x-u.pos.x,dz=b.z-u.pos.z,d=Math.hypot(dx,dz);if(d<.35){arrived=true;break;}
     wish.set(dx/d,0,dz/d);g.physics(u,wish,false,false,1/60);
    }
    ok(arrived,'経路を実機体で歩ける '+link.a+'→'+link.b);walked++;
   }
   result.walkedNavigationEdges=walked;
   result.catapults=[];
   for(const cp of g.catapults){
    fresh([cp.pos.x,cp.pos.z],cp.pos.y);g.launch(u,cp);let elapsed=0,apex=0;
    while(elapsed<8&&(!u.onGround||elapsed<.1)){g.physics(u,new T.Vector3(),false,false,1/120);elapsed+=1/120;apex=Math.max(apex,u.pos.y);}
    const error=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z);
    ok(error<6&&elapsed>3.5&&!u.flying&&u.ctrlLockT===0,'基地カタパルトの飛行・接地 '+JSON.stringify({start:cp.pos.toArray(),target:cp.land.toArray(),error,elapsed}));
    ok(g.cityBattle.free(u.pos.x,u.pos.z,u.pos.y,g.obstacles),'カタパルトから街路へ安全に着地');
    result.catapults.push({team:cp.side,range:cp.pos.distanceTo(cp.land),apex,elapsed,error});
   }
   result.shelters=[];
   const enemy=g.units.find(p=>p!==u&&p.team==='R');enemy.alive=true;
   for(const pd of g.pods.filter(p=>p.plant)){
    const pl=pd.plant,team=pl.start;u.team=team;fresh([pd.pos.x,pd.pos.z],pd.pos.y);u.hp=u.maxHp-1000;u.vel.set(0,0,0);g.podUpdate(pd,1);
    ok(pd.pos.y< -1.9&&u.hp>u.maxHp-1000&&u.repairing,'窪地の補給ポッドで修理できる');
    const shelter=city.district.repairShelters.find(s=>s.plant===pl.id),entry=new T.Vector3(shelter.entry[0],0,shelter.entry[1]);
    fresh(shelter.entry);let entered=false,exited=false;
    for(let n=0;n<600;n++){const dx=pd.pos.x-u.pos.x,dz=pd.pos.z-u.pos.z,d=Math.hypot(dx,dz);if(d<.25){entered=true;break;}g.physics(u,new T.Vector3(dx/d,0,dz/d),false,false,1/60);}
    for(let n=0;n<600;n++){const dx=entry.x-u.pos.x,dz=entry.z-u.pos.z,d=Math.hypot(dx,dz);if(d<.25){exited=true;break;}g.physics(u,new T.Vector3(dx/d,0,dz/d),false,false,1/60);}
    ok(entered&&exited&&u.pos.y>-.05,'補給室へ歩いて出入りできる '+pl.id);
    enemy.pos.copy(pd.pos);enemy.group.position.copy(enemy.pos);enemy.group.updateMatrixWorld(true);
    const back=g.cores[team].pos.clone().sub(pl.pos).setY(0);let seen=0,samples=0;
    for(let x=-340;x<350;x+=20)for(let z=-165;z<175;z+=20){
     if(Math.hypot(x-pd.pos.x,z-pd.pos.z)>150||(x-pl.pos.x)*back.x+(z-pl.pos.z)*back.z>0||!g.cityBattle.free(x,z,g.terrainH(x,z),g.obstacles))continue;
     samples++;const eye=new T.Vector3(x,g.terrainH(x,z)+4.6,z);
     if([2.4,3.9].some(h=>{const to=pd.pos.clone().add(new T.Vector3(0,h,0)),dir=to.sub(eye),distance=dir.length();return g.castFrom(eye,dir.normalize(),u,distance+2)?.ref===enemy;}))seen++;
    }
    ok(samples>10&&seen===0,'前衛補給は敵陣側の地上から見えない '+pl.id+' '+seen+'/'+samples);
    result.shelters.push({plant:pl.id,height:pd.pos.y,seen,samples});
   }
   enemy.alive=false;u.team='B';fresh([39,48]);const center=g.plants.find(p=>p.id==='C');
   for(let n=0;n<40;n++)g.plantUpdate(center,1);
   ok(center.owner==='B','本体の占拠処理でCを取得できる');g.spawn(u,'C');
   ok(Math.hypot(u.pos.x-center.pos.x,u.pos.z-center.pos.z)>=46,'占拠したCから安全な後方帯へ再出撃');
   result.checks=checks;return result;
  },{approved,generation});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,'battle-check.json'),JSON.stringify({...results,errors,externalRequests:external},null,2)+'\n');
  console.log(JSON.stringify({checks:results.checks,navigationEdges:results.walkedNavigationEdges,bridges:results.bridges.length,catapults:results.catapults.length,shelters:results.shelters,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
