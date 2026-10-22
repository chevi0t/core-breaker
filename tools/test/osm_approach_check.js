// 基地前→中央Bの徒歩と、乗り場への徒歩・射出・着地後の徒歩を同じ装備で比較する。
// 候補の射出先は検査中の機体だけに渡し、採用済みマップは変更しない。
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const [debugDir,mapFile,outFile]=process.argv.slice(2);
if(!outFile)throw new Error('使い方: node tools/test/osm_approach_check.js dbgフォルダ マップJSON 記録JSON');
const d=JSON.parse(fs.readFileSync(mapFile)).map;
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=webkitAudioContext=undefined;});
  await page.route('**/maps.js',r=>r.fulfill({contentType:'application/javascript',body:'window.MAP_DATA={osm_city:'+JSON.stringify(d)+'};'}));
  await page.route('**fonts.g*/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.goto('file://'+path.resolve(debugDir,'dbg.html'));
  await page.waitForFunction(()=>window.__g);
  await page.click('#start');
  const result=await page.evaluate(existingOnly=>{
   const g=__g,T=g.T,N=g.NAV,d=g.curMap,u=g.player,dt=.05,runs=[];
   g.running=false;u.isPlayer=true;
   for(const v of g.units){v.frozen=true;v.pos.set(d.size[0]-6,0,d.size[1]-6);}
   const b=g.plants.find(p=>p.id==='B'),goal=new T.Vector3(b.pos.x+6,b.pos.y,b.pos.z+3);
   // プラント自身の柱を除き、占拠域と両軍の再出撃帯を本体の障害物で確認する。
   const ownPole=o=>Math.abs(o.minX-(b.pos.x-.7))<.01&&Math.abs(o.minZ-(b.pos.z-.7))<.01;
   const free=(x,z)=>{
    const y=g.terrainH(x,z);
    return !g.obstacles.some(o=>!ownPole(o)&&x>o.minX-1.2&&x<o.maxX+1.2&&z>o.minZ-1.2&&z<o.maxZ+1.2&&o.top>y+.6&&(o.bottom===undefined||o.bottom<y+4));
   };
   for(const[dx,dz]of [[0,0],[-17,0],[17,0],[0,-17],[0,17],[-12,-12],[12,-12],[-12,12],[12,12]]){
    const x=b.pos.x+dx,z=b.pos.z+dz;
    if(!free(x,z)||Math.abs(g.terrainH(x,z)-b.pos.y)>.4)throw new Error('Bの占拠域が塞がっています');
   }
   for(const base of Object.values(d.bases)){
    const dx=base.at[0]-b.pos.x,dz=base.at[1]-b.pos.z,len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len;
    for(const back of [46,49,52])for(const side of [-8,0,8]){
     if(!free(b.pos.x+ux*back-uz*side,b.pos.z+uz*back+ux*side))throw new Error('Bの再出撃帯が塞がっています');
    }
   }
   const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
   const node=(p,entry)=>{
    const order=N.pts.map((q,i)=>[dist(q,p)+3*Math.abs(q.y-p.y),i]).sort((a,b)=>a[0]-b[0]);
    for(const[,i]of order){const q=N.pts[i];
     if(entry?g.clearPath(p.x,p.z,q.x,q.z,p.y):g.clearPath(q.x,q.z,p.x,p.z,q.y)){
      if(Math.abs(g.pathEndH-(entry?q.y:p.y))<.4)return i;
     }
    }
    throw new Error('経路への接続がありません '+p.toArray());
   };
   const reset=(team,chassis)=>{
    const[x,z]=d.bases[team].at;
    u.team=team;u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};
    g.equip(u,'assault');u.navW=N.links.map(()=>1);
    u.pos.set(x+8,0,z+(team==='B'?-20:20));u.vel.set(0,0,0);
    Object.assign(u,{alive:true,onGround:true,flying:false,ctrlLockT:0,catCd:0,stun:'',stunT:0,downT:0,jumpBuf:0,zip:null,zipCd:0,repairing:false,transfer:null,dashT:0,longDash:false,overheat:false,boost:u.maxBoost});
   };
   const walk=to=>{
    const start=u.pos.clone(),a=node(start,true),b=node(to,false),route=g.navPath(u,a,b);
    if(!route)throw new Error('経路が連結していません');
    const points=route.map(i=>new T.Vector3(N.pts[i].x,N.pts[i].y,N.pts[i].z));points.push(to);
    let ticks=0,length=0;
    for(const q of points){
     let reached=false;
     for(let n=0;n<1200;n++){
      if(dist(q,u.pos)<1.2&&Math.abs(q.y-u.pos.y)<1.3){reached=true;break;}
      const before=u.pos.clone(),wish=q.clone().sub(u.pos).setY(0).normalize();
      g.physics(u,wish,false,false,dt);length+=dist(before,u.pos);ticks++;
     }
     if(!reached)throw new Error('徒歩で停止 '+q.toArray()+' / '+u.pos.toArray());
    }
    return{seconds:ticks*dt,length,start:start.toArray(),end:u.pos.toArray(),points:points.map(p=>p.toArray()),graphLength:route.slice(1).reduce((s,j,i)=>s+dist(N.pts[j],N.pts[route[i]]),0)};
   };
   const cases=[];
   for(const team of ['B','R']){
    cases.push({id:team+'-walk',team});
    d.bases[team].catapults.forEach(([x,z,lx,lz],i)=>cases.push({id:team+'-cat'+i,team,from:[x,z],to:[lx,lz]}));
   }
   if(!existingOnly)for(const x of [32,44,64])for(const z of [240,250,256,270])cases.push({id:'trial-'+x+'-'+z,team:'B',from:d.bases.B.catapults[1].slice(0,2),to:[x,z],trial:true});
   for(const c of cases)for(const chassis of ['light','heavy']){
    reset(c.team,chassis);
    const row={...c,chassis,walkSpeed:u.walkV,weight:u.stats.weight,weapons:{...g.loadout.assault}};
    try{
     if(!c.from){row.walk=walk(goal);row.seconds=row.walk.seconds;row.ok=true;}
     else{
      const[x,z]=c.to,y=g.terrainH(x,z);
      if(Math.hypot(x-b.pos.x,z-b.pos.z)<80)throw new Error('中央プラントへの直行に近すぎます');
      if(g.obstacles.some(o=>x>o.minX-3&&x<o.maxX+3&&z>o.minZ-3&&z<o.maxZ+3&&o.top>y+.6&&(o.bottom===undefined||o.bottom<y+4)))throw new Error('着地点に障害物');
      row.approach=walk(new T.Vector3(c.from[0],g.terrainH(...c.from),c.from[1]));
      const cp={pos:u.pos.clone(),land:new T.Vector3(x,y,z),flash:0};g.launch(u,cp);
      let n=0;const arc=[];
      while((u.flying||!u.onGround)&&n<400){arc.push(u.pos.toArray());g.physics(u,new T.Vector3(),false,false,dt);n++;}
      const miss=dist(u.pos,cp.land);
      row.flight={seconds:n*dt,landing:u.pos.toArray(),miss,arc};
      if(!u.onGround||miss>6||Math.abs(u.pos.y-y)>1)throw new Error('着地失敗 '+JSON.stringify({miss,at:u.pos.toArray()}));
      row.remaining=walk(goal);row.seconds=row.approach.seconds+row.flight.seconds+row.remaining.seconds;row.ok=true;
     }
    }catch(e){row.ok=false;row.reason=e.message;}
    runs.push(row);
   }
   return{plant:b.pos.toArray(),plantSiteChecks:'占拠域9点、両軍の出撃帯各9点に成功',goal:goal.toArray(),conditions:'初期の強襲装備を固定。全身軽量/重量各1回。基地前の固定点→B付近。徒歩、射出中は入力なし、ブーストなし。着地硬直を含む。射出先の試行はマップへ保存しない。',runs};
  },process.argv.includes('--existing-only'));
  result.errors=errors;
  fs.mkdirSync(path.dirname(path.resolve(outFile)),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(result,null,2));
  const ids=[...new Set(result.runs.map(r=>r.id))];
  for(const id of ids){const rows=result.runs.filter(r=>r.id===id);console.log(id,rows.every(r=>r.ok)?JSON.stringify({light:rows[0].seconds,heavy:rows[1].seconds,average:rows.reduce((s,r)=>s+r.seconds,0)/rows.length}):JSON.stringify(rows.filter(r=>!r.ok).map(r=>r.reason)));}
  if(errors.length||result.runs.filter(r=>!r.trial).some(r=>!r.ok))throw new Error('現行の移動かブラウザでエラー');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
