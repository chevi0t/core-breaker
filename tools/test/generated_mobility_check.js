// 生成した各戦場で、本体の Bot 判断・経路探索・移動により高所拠点へ到達する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {openMap}=require('../mapgen_browser');
if(process.argv[2]!=='dbg')throw new Error('dbg を指定してください');
(async()=>{
  const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),results=[];
  try{
    for(const id of ['circulation','circulation-v2','circulation-v3']){
      const {page,errors}=await openMap(browser,id,null,20261060);
      try{
        await page.click('#start');
        const report=await page.evaluate(()=>{
          const g=__g,report=[],high=g.plants.filter(p=>p.pos.y>5);
          if(!high.length)throw new Error('高所プラントがありません');
          for(const pl of high) for(const kind of ['pad',g.ziplines.length?'zip':'lift']) for(const team of ['B','R']) for(const [cls,chassis] of [['assault','light'],['heavy','heavy']]){
            g.setup();for(const v of g.units){v.frozen=true;v.pos.set(140,0,220-v.idx*8);}
            for(const p of g.plants){p.owner=team;p.gauge=team==='B'?100:-100;}
            pl.owner=null;pl.gauge=0;
            const u=g.units.find(v=>v.team===team && !v.isPlayer);
            const source=kind==='pad'?g.jumpPads:kind==='lift'?g.lifts:g.ziplines,end=f=>kind==='zip'?f.top:f.exit||f.to;
            const facility=source.slice().sort((a,b)=>end(a).distanceTo(pl.pos)-end(b).distanceTo(pl.pos))[0];
            const from=kind==='zip'?facility.bottom:facility.pos,to=end(facility),away=from.clone().sub(to).setY(0).normalize();
            u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,cls);
            u.pos.copy(from).addScaledVector(away,8);u.vel.set(0,0,0);
            Object.assign(u,{frozen:false,role:'plant',onGround:true,stun:'',catCd:0,target:null});
            const scene=u.group.parent;g.renderer.render=()=>scene.updateMatrixWorld();
            let used=false,arrived=false,ticks=0;
            for(;ticks<1000;ticks++){
              g.loop(__advanceClock());used ||= kind==='pad'?u.jumpPad===facility:kind==='lift'?u.lift===facility:u.zip?.line===facility; // v0.21：リフトの代わりにジップラインのある戦場
              if(used && u.onGround && !u.lift && Math.abs(u.pos.y-pl.pos.y)<.5 && u.pos.distanceTo(pl.pos)<14){arrived=true;break;}
            }
            if(!arrived)throw new Error(`${g.mapId}/${pl.id}/${team}/${cls}/${kind}: Bot が到達できません ${u.pos.toArray()} used=${used}`);
            report.push({map:g.mapId,plant:pl.id,team,class:cls,kind,used,arrived,seconds:Number((ticks*.05).toFixed(2)),landing:u.pos.toArray()});
          }
          return report;
        });
        assert.equal(errors.length,0,errors.join('\n'));results.push(...report);
        console.log(`${id}: 本体Bot ${report.length}経路、高所到達・エラー0`);
      }finally{await page.close();}
    }
    const output=process.argv[3]||'dbg/generated-mobility.json';fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({passed:results.length,results},null,2)+'\n');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
