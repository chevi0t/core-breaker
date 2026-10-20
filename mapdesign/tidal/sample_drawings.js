// 全体平面図・断面図のため、本体が焼いた地面と固定物の当たり判定を取り出す。
// source /workspace/.cloud-setup/core-breaker/env.sh
// node mapdesign/tidal/sample_drawings.js
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),{openMap}=require('../../tools/mapgen_browser');
(async()=>{
  execFileSync('python3',['tools/test/make_dbg.py','dbg/drawings'],{cwd:path.join(__dirname,'../..'),stdio:'inherit'});
  const browser=await chromium.launch();
  try{
    const {page,errors}=await openMap(browser,'tidal',null,20261020,{silent:true,debugDir:'dbg/drawings'});
    const data=await page.evaluate(()=>{
      const g=__g,[mx,mz]=g.curMap.size,round=x=>Math.round(x*10000)/10000,step=2;
      const grid=[];
      for(let z=-mz;z<=mz;z+=step){const row=[];for(let x=-mx;x<=mx;x+=step)row.push(round(g.terrainH(x,z)));grid.push(row);}
      const cuts=[['A','z',-38],['B','z',58],['C','x',0],['D','x',531.2],['E','x',-531.2]];
      if(g.curMap.generation.version>=4)cuts.push(['F','x',383],['G','x',-371]);
      if(g.curMap.generation.version>=5)cuts.push(['H','z',-164],['I','x',-480]);
      return {map:g.curMap,step,grid,
        obstacles:g.obstacles.filter(o=>!g.lifts.some(l=>l.ob===o)),
        cuts:cuts.map(([name,axis,fixed])=>{
          const half=axis==='z'?mz:mx,points=[];
          for(let t=-half;t<=half;t+=.5)points.push([t,round(axis==='z'?g.terrainH(fixed,t):g.terrainH(t,fixed))]);
          return {name,axis,fixed,points};
        }),
        plants:g.plants.map(p=>({id:p.id,owner:p.owner,pos:p.pos.toArray()})),
        cores:Object.values(g.cores).map(c=>({team:c.team,pos:c.pos.toArray()})),
        pods:g.pods.map(p=>({pos:p.pos.toArray(),team:p.team,plant:p.plant?.id})),
        radars:g.radars.map(r=>({team:r.team,pos:r.pos.toArray()})),
        catapults:g.catapults.map(c=>({from:c.pos.toArray(),to:c.land.toArray()})),
        turrets:g.turrets.map(t=>({team:t.team,pos:t.pos.toArray()}))};
    });
    if(errors.length)throw new Error(errors.join('\n'));
    const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../../',p))).digest('hex');
    data.source={mapSha256:hash('prototype/maps/tidal.js'),engineSha256:hash('prototype/index.html'),mapId:'tidal',revision:'tidal'+data.map.generation.version,note:'主配置。断面は0.5m間隔で本体のterrainHを採取。平面の高さは2m間隔。移動中のリフト床は固定物の断面から除外。'};
    const out=path.join(__dirname,'v'+data.map.generation.version,'drawings');
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(data)+'\n');
    console.log(`本体から平面と${data.cuts.length}断面を採取、ページエラー0`);await page.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
