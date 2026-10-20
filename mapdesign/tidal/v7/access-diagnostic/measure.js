// 上層Cへの前線拠点からの再合流を、無交戦の本体Botで測る。
// 地形・施設は変更しない。中心出発と通常の49m後方再出撃を分ける。
// 実行: node mapdesign/tidal/v7/access-diagnostic/measure.js
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../../../..');
const {openMap}=require(path.join(ROOT,'tools/mapgen_browser'));
(async()=>{
  const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const results=[];
  try{
    for(const mode of ['center','respawn'])for(const [cls,chassis] of [['assault','light'],['heavy','heavy']])for(const team of ['B','R']){
      const {page,errors}=await openMap(browser,'tidal-v2',null,20261020,{silent:true,debugDir:'dbg/access-diagnostic'});
      try{
        await page.click('#start');
        const result=await page.evaluate(({mode,cls,chassis,team})=>{
          const g=__g;
          for(const u of g.units){u.frozen=true;u.alive=false;u.respawnT=Infinity;u.group.visible=false;}
          for(const turret of g.turrets)turret.alive=false;
          for(const p of g.plants){p.owner=team;p.gauge=team==='B'?100:-100;}
          const source=g.plants.find(p=>p.id===(team==='B'?'B':'D')),target=g.plants.find(p=>p.id==='C');
          target.owner=null;target.gauge=0;
          const u=g.units.find(u=>u.team===team&&!u.isPlayer);
          u.idx=0;u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};
          u.cls=cls;
          // 出撃距離49m・横振れ0と、装備抽選を両軍で一致させる。
          const previous=Math.random;Math.random=()=>.5;
          try{g.spawn(u,source.id);}finally{Math.random=previous;}
          if(mode==='center')u.pos.copy(source.pos).add(new g.T.Vector3(0,0,3));
          Object.assign(u,{frozen:false,role:'plant',xferCd:Infinity,onGround:true,waypoint:null,think:0});
          let state=20261020;Math.random=()=>{state=Math.imul(1664525,state)+1013904223>>>0;return state/4294967296;};
          const scene=u.group.parent;g.renderer.render=()=>scene.updateMatrixWorld();
          const start=u.pos.toArray(),trace=[],usedLifts=new Set(),usedPads=new Set();
          let enterSeconds=null,floorSeconds=null,captureSeconds=null,distance=0,last=u.pos.clone();
          for(let tick=1;tick<=2400;tick++){
            g.loop(__advanceClock());
            const seconds=Number((tick*.05).toFixed(2));
            distance+=u.pos.distanceTo(last);last.copy(u.pos);
            if(u.lift)usedLifts.add(g.lifts.indexOf(u.lift));
            if(u.jumpPad)usedPads.add(g.jumpPads.indexOf(u.jumpPad));
            const horizontal=Math.hypot(u.pos.x-target.pos.x,u.pos.z-target.pos.z);
            // 占拠判定と、目標の床の高さへ実際に到達した時刻を別々に残す。
            if(enterSeconds===null&&horizontal<g.PLANT_R&&u.pos.y-target.pos.y<6)enterSeconds=seconds;
            if(floorSeconds===null&&horizontal<g.PLANT_R&&Math.abs(u.pos.y-target.pos.y)<2)floorSeconds=seconds;
            if(tick%20===0)trace.push({seconds,pos:u.pos.toArray(),lift:u.lift?g.lifts.indexOf(u.lift):null,pad:u.jumpPad?g.jumpPads.indexOf(u.jumpPad):null});
            if(target.owner===team){captureSeconds=seconds;break;}
          }
          return {mode,class:cls,chassis,team,source:source.id,sourcePos:source.pos.toArray(),target:target.pos.toArray(),start,
            stats:{walk:u.walkV,dash:u.dashV,cruise:u.cruiseV,weight:u.stats.weight,weapons:Object.fromEntries(g.SLOTS.map(k=>[k,u.slots[k].w.name]))},
            enterSeconds,floorSeconds,captureSeconds,distance,usedLifts:[...usedLifts],usedPads:[...usedPads],trace};
        },{mode,cls,chassis,team});
        assert.deepEqual(errors,[]);assert.notEqual(result.captureSeconds,null);
        results.push(result);console.log(`${mode}/${cls}/${team}: 進入${result.enterSeconds}s、床${result.floorSeconds}s、占拠${result.captureSeconds}s`);
      }finally{await page.close();}
    }
    for(const mode of ['center','respawn'])for(const cls of ['assault','heavy']){
      const pair=results.filter(r=>r.mode===mode&&r.class===cls);assert.deepEqual(pair[0].stats,pair[1].stats);
    }
    const sources=Object.fromEntries(['prototype/index.html','prototype/maps/tidal.js','prototype/maps.js','tools/test/make_dbg.py',path.relative(ROOT,__filename)].map(p=>[p,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]));
    fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify({map:'tidal-v2',conditions:'無交戦・Cだけ中立・エリア移動停止・同装備同性能・49m後方横振れ0・各条件1走。中心出発は満タンの機体を中心から3mずらす。',sources,results},null,2)+'\n');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
