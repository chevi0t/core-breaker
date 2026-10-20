// 港湾テーマの追加検査：両軍の再出撃域と、本体Botによる拠点への接近・占拠。
// node tools/test/tidal_check.js dbg [出力.json]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
if(process.argv[2]!=='dbg')throw new Error('dbg を指定してください');
(async()=>{
  const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),results=[];
  try{
    for(const id of ['tidal','tidal-v2','tidal-v3']){
      const {page,errors}=await openMap(browser,id,null,20261020,{silent:true});
      try{
        await page.click('#start');
        const report=await page.evaluate(()=>{
          const g=__g,spawns=[],routes=[];
          for(const pl of g.plants)for(const team of ['B','R']){
            const u=g.units.find(u=>u.team===team),distances=[];
            pl.owner=team;pl.gauge=team==='B'?100:-100;
            for(let n=0;n<40;n++){
              g.spawn(u,pl.id);
              const {x,y,z}=u.pos,dist=Math.hypot(x-pl.pos.x,z-pl.pos.z);distances.push(dist);
              if(dist<45.9||dist>52.7)throw new Error(`${pl.id}/${team}: 再出撃距離 ${dist}`);
              if(g.obstacles.some(o=>x>o.minX-1.2&&x<o.maxX+1.2&&z>o.minZ-1.2&&z<o.maxZ+1.2&&o.top>y+.6&&(o.bottom===undefined||o.bottom<y+4)))throw new Error(`${pl.id}/${team}: 障害物内の再出撃 ${u.pos.toArray()}`);
              if(Math.abs(g.terrainH(x+.5,z)-g.terrainH(x-.5,z))>1.1||Math.abs(g.terrainH(x,z+.5)-g.terrainH(x,z-.5))>1.1)throw new Error(`${pl.id}/${team}: 急斜面の再出撃 ${u.pos.toArray()}`);
            }
            spawns.push({plant:pl.id,team,samples:40,min:Math.min(...distances),max:Math.max(...distances)});
          }
          // 無敵や瞬間移動で目的地へ運ばず、本体のBot判断とloopで歩かせる。
          // 交戦下の生還率とは区別し、ここでは敵と砲台を止めて到達性を調べる。
          for(const pl of g.plants.slice(1,-1))for(const team of ['B','R'])for(const [cls,chassis] of [['assault','light'],['heavy','heavy']]){
            g.setup();
            for(const u of g.units){u.frozen=true;u.alive=false;u.respawnT=Infinity;u.group.visible=false;}
            for(const turret of g.turrets)turret.alive=false;
            for(const p of g.plants){p.owner=team;p.gauge=team==='B'?100:-100;}
            pl.owner=null;pl.gauge=0;
            const u=g.units.find(u=>u.team===team&&!u.isPlayer);
            u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,cls);g.spawn(u,'base');
            Object.assign(u,{frozen:false,role:'plant',xferCd:Infinity,onGround:true,waypoint:null});
            const scene=u.group.parent;g.renderer.render=()=>scene.updateMatrixWorld();
            let arrived=false,ticks=0,usedPad=false,usedLift=false;
            for(;ticks<1800;ticks++){
              g.loop(__advanceClock());usedPad ||= !!u.jumpPad;usedLift ||= !!u.lift;
              if(pl.owner===team){arrived=true;break;}
            }
            if(!arrived)throw new Error(`${g.mapId}/${pl.id}/${team}/${cls}: Botが占拠できない ${u.pos.toArray()}`);
            routes.push({plant:pl.id,team,class:cls,seconds:Number((ticks*.05).toFixed(2)),usedPad,usedLift,captured:true});
          }
          return {spawns,routes};
        });
        assert.deepEqual(errors,[]);results.push({id,...report,errors});
        console.log(`${id}: 再出撃${report.spawns.length*40}回・本体Botの占拠${report.routes.length}経路、エラー0`);
      }finally{await page.close();}
    }
    const output=process.argv[3]||'dbg/tidal-check.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
