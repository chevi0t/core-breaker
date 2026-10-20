// 交戦と施設射撃を止めた単独Botで、各侵入経路・レーダー攻略の到達性を確認する。
// 敵の迎撃下での成功率は別の対戦記録で扱う。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
const prepareBotBattle=require('./prepare_bot_battle');
(async()=>{
  const browser=await chromium.launch(),results=[];
  try{
    let data=null;
    if(process.argv[4]){const c={window:{}};require('node:vm').runInNewContext(fs.readFileSync(process.argv[4],'utf8'),c);data=Object.values(c.window.MAP_DATA)[0];}
    const {page,errors}=await openMap(browser,'tidal',data,20261301,{silent:true,debugDir:process.argv[2]||'dbg'});await page.click('#start');
    for(const team of ['B','R'])for(const idx of [0,3,6,9]){
      // 地形モデルの乱数消費や前のケースに装備抽選を左右させない。
      const initialization=await page.evaluate(prepareBotBattle,{fixture:{seed:20261301,swapped:false}});
      const result=await page.evaluate(({team,idx})=>{
        const g=__g;g.running=true;
        for(const u of g.units){Object.assign(u,{alive:false,frozen:true,respawnT:Infinity});u.group.visible=false;}
        for(const turret of g.turrets)turret.alive=false;
        g.turrets.length=0; // 止めた砲台へ支援が修理に行くのを避ける。残骸の衝突は残す。
        const u=g.units.find(u=>u.team===team&&u.idx===idx);g.spawn(u,'base');u.frozen=false;u.waypoint=null;
        const rd=g.radars.find(r=>r.team!==team);g.renderer.render=()=>g.scene.updateMatrixWorld();
        let usedPad=false,roof=false,districtRoof=false,mountain=false,wallCrossed=false,alarm=false,radarDestroyedAt=null,ticks=0;
        const pads=new Set();
        const samples=[];
        for(;ticks<6000&&!g.ended;ticks++){
          g.loop(__advanceClock());usedPad ||= !!u.jumpPad;
          if(u.jumpPad)pads.add(g.jumpPads.indexOf(u.jumpPad));
          roof ||= u.onGround&&u.pos.y>9&&Math.abs(u.pos.z)>500;
          districtRoof ||= u.onGround&&u.pos.y>9&&u.pos.y<14&&Math.abs(u.pos.z)>276&&Math.abs(u.pos.z)<438;
          mountain ||= u.onGround&&u.pos.x<-150&&u.pos.z<-400&&u.pos.z>-490&&u.pos.y>12;
          wallCrossed ||= u.pos.x>-120&&u.pos.x<-108&&Math.abs(u.pos.z+480)<5&&u.pos.y>9;
          alarm ||= rd.intruders.includes(u);
          if(!rd.alive&&radarDestroyedAt===null)radarDestroyedAt=ticks*.05;
          if(ticks%200===0)samples.push({t:ticks*.05,pos:u.pos.toArray(),route:{...u.raidRoute},target:u.target?.kind});
          if(u.sc.coreDmg>0&&(idx!==6||!rd.alive))break;
        }
        return {team,idx,kind:u.raidRoute?.kind,class:u.cls,seconds:ticks*.05,coreDamage:u.sc.coreDmg,radarDestroyedAt,usedPad,pads:[...pads],roof,districtRoof,mountain,wallCrossed,revision:g.curMap.generation.version,requiresDistrictRoof:g.curMap.generation.version>=4,alarm,pos:u.pos.toArray(),samples};
      },{team,idx});
      result.fixture={...initialization.fixture,unit:initialization.units.find(u=>u.id===team+(idx+1))};
      results.push(result);console.log(`${team}/${result.kind}: ${result.seconds.toFixed(1)}秒、コア攻撃${result.coreDamage}、レーダー破壊${result.radarDestroyedAt}、パッド${result.usedPad}`);
    }
    const output=process.argv[3]||'dbg/tidal-raid-check.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results,errors},null,2)+'\n');
    assert.deepEqual(errors,[]);
    const mountain=results.find(r=>r.revision>=5&&r.team==='B'&&r.kind==='covert');
    if(mountain)assert.ok(mountain.mountain&&mountain.wallCrossed,'青の潜行役が山と防壁越えを使わない');
    for(const r of results){assert.ok(r.coreDamage>0,`${r.team}/${r.kind}: コアへ到達できない`);if(r.kind==='radar')assert.ok(r.radarDestroyedAt!==null,`${r.team}: レーダーを破壊できない`);if(r.kind==='sprint'){assert.ok(r.usedPad&&r.roof,`${r.team}: 屋根経路を使わない`);if(r.requiresDistrictRoof)assert.ok(r.districtRoof&&r.pads.includes(r.team==='B'?6:4),`${r.team}: 街区の新パッドと屋根を使わない`);}}
    await page.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
