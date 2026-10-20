// 出撃の2つの乱数を範囲全体へ振り、本体のspawnPosとresolve後の位置を検査する。
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
(async()=>{const b=await chromium.launch(),results=[];try{
 let data=null;if(process.argv[4]){const c={window:{}};require('node:vm').runInNewContext(fs.readFileSync(process.argv[4],'utf8'),c);data=Object.values(c.window.MAP_DATA)[0];}
 for(const id of ['tidal','tidal-v2','tidal-v3']){
  const {page,errors}=await openMap(b,id,data,20261701,{silent:true,debugDir:process.argv[2]||'dbg'});await page.click('#start');
  const r=await page.evaluate(()=>{
   const g=__g,cases=[],failures=[];for(const u of g.units){u.alive=false;u.frozen=true;u.group.visible=false;}
   for(const pl of g.plants)for(const team of ['B','R']){
    pl.owner=team;const u=g.units.find(u=>u.team===team),back=new g.T.Vector3(-pl.pos.x,0,g.TEAM[team].baseZ-pl.pos.z).normalize();
    let samples=0,displaced=0,min=Infinity,max=0;
    for(let d=46;d<=52;d++)for(let side=-8;side<=8;side++){
     const values=[Math.min((d-46)/6,1-Number.EPSILON),Math.min((side+8)/16,1-Number.EPSILON)],random=Math.random;let i=0;
     try{Math.random=()=>values[i++]??random();g.spawnPos(u,pl.id);}finally{Math.random=random;}
     const {x,y,z}=u.pos,dist=Math.hypot(x-pl.pos.x,z-pl.pos.z),raw=[pl.pos.x+back.x*d-back.z*side,pl.pos.z+back.z*d+back.x*side];
     min=Math.min(min,dist);max=Math.max(max,dist);samples++;
     if(Math.hypot(x-raw[0],z-raw[1])>.05)displaced++;
     const obstacle=g.obstacles.findIndex(o=>x>o.minX-1.2&&x<o.maxX+1.2&&z>o.minZ-1.2&&z<o.maxZ+1.2&&o.top>y+.6&&(o.bottom===undefined||o.bottom<y+4));
     const slope=Math.max(Math.abs(g.terrainH(x+.5,z)-g.terrainH(x-.5,z)),Math.abs(g.terrainH(x,z+.5)-g.terrainH(x,z-.5)));
     if(obstacle>=0||dist<45.9||dist>52.7||slope>1.1)failures.push({plant:pl.id,team,d,side,pos:u.pos.toArray(),dist,slope,obstacle});
    }
    cases.push({plant:pl.id,team,samples,displaced,min,max});
   }
   return {id:g.mapId,revision:g.curMap.generation.version,cases,failures};
  });results.push({...r,errors});await page.close();
 }
 const output=process.argv[3]||'dbg/tidal-respawn-band.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
 for(const r of results){assert.deepEqual(r.errors,[]);assert.deepEqual(r.failures,[],r.id+'の出撃帯');}
 console.log(`出撃帯：3配置・両所有、範囲端を含む${results.reduce((n,r)=>n+r.cases.reduce((s,c)=>s+c.samples,0),0)}点、エラー0`);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
