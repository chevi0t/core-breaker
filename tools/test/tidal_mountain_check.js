// 山の麓から側壁を越え、基地内へ下る経路を本体の徒歩物理で往復する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
(async()=>{
  const browser=await chromium.launch();
  try{
    const {page,errors}=await openMap(browser,'tidal',null,20261500,{silent:true,debugDir:process.argv[2]||'dbg'});
    await page.click('#start');
    const report=await page.evaluate(()=>{
      const g=__g,routes=[];
      if(g.curMap.generation.version!==5)throw new Error('山岳侵入路のtidal5を読み込んでください');
      for(const u of g.units){u.alive=false;u.frozen=true;u.group.visible=false;}
      const wall=g.obstacles.find(o=>o.bottom===undefined&&o.minX<=-115&&o.maxX>=-115&&o.minZ<=-480&&o.maxZ>=-480);
      if(!wall)throw new Error('横断する側壁がない');
      const summit=g.terrainH(-164,-480);
      const scout=g.units.find(u=>u.team==='B'&&u.idx===3);scout.role='attack';
      const corner=g.curMap.raidRoutes[1].points.findIndex(p=>p[0]===-110&&p[1]===-480);
      for(const p of [[-124,10,-480],[-110,10,-506]]){
        scout.pos.set(...p);scout.raidRoute={kind:'covert',index:corner};g.raidGoal(scout,new g.T.Vector3(0,0,-500));
        if(scout.raidRoute.index!==corner)throw new Error('山の狭い角を半径または奥行きで省略した');
      }
      const points=[[-164,-350,0],[-164,-410,14],[-164,-480,14],[-140,-480,10],[-100,-480,10],[-100,-518,0]];
      for(const c of g.catapults)if(g.terrainH(c.pos.x,c.pos.z)!==0)throw new Error('山が既存の射出台の基礎を持ち上げた');
      for(const [cls,chassis] of [['assault','light'],['heavy','heavy']])for(const reverse of [false,true]){
        const u=g.player;u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,cls);
        const route=reverse?[...points].reverse():points,[x,z,y]=route[0];
        u.pos.set(x,y,z);u.vel.set(0,0,0);
        Object.assign(u,{alive:true,onGround:true,flying:false,repairing:false,transfer:null,planted:false,stun:'',dashT:0,longDash:false,charging:false,overheat:false,ctrlLockT:0,boost:u.maxBoost});
        let ticks=0,wallCrossed=false,highest=0;
        for(const [x,z,y] of route.slice(1)){
          let arrived=false;
          for(let n=0;n<1600;n++){
            const delta=new g.T.Vector3(x-u.pos.x,0,z-u.pos.z);
            if(delta.length()<1.4&&Math.abs(u.pos.y-y)<1.2){arrived=true;break;}
            g.physics(u,delta.normalize(),false,false,.05);ticks++;highest=Math.max(highest,u.pos.y);
            wallCrossed ||= u.pos.x>-120&&u.pos.x<-108&&Math.abs(u.pos.z+480)<5&&u.pos.y>9;
          }
          if(!arrived)throw new Error(`${cls}/${reverse?'帰路':'侵入'}: ${u.pos.toArray()} → ${x},${y},${z}`);
        }
        routes.push({class:cls,reverse,seconds:ticks*.05,highest,wallCrossed,arrived:true});u.alive=false;
      }
      return {summit,wallTop:wall.top,precisionCases:2,catapultFoundationsFlat:true,routes};
    });
    const output=process.argv[3]||'dbg/tidal-mountain-check.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({...report,errors},null,2)+'\n');
    assert.deepEqual(errors,[]);assert.equal(report.summit,14);assert.equal(report.wallTop,8);
    for(const r of report.routes)assert.ok(r.arrived&&r.wallCrossed&&r.highest>13);
    console.log('山岳：軽量・重量機で侵入/帰路4経路、尾根14m→側壁8mの上10m→基地内地上、エラー0');
    await page.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
