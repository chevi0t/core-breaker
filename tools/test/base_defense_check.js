// 港湾の基地守備：通常の索敵・待機・射撃・Bot移動を使った動作検査。
// node tools/test/base_defense_check.js dbg [出力.json]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
if(!process.argv[2])throw new Error('デバッグ版のディレクトリを指定してください');
(async()=>{
  const browser=await chromium.launch(),results=[];
  try{
    const {page,errors}=await openMap(browser,'tidal',null,20261300,{silent:true,debugDir:process.argv[2]});
    await page.click('#start');
    const report=await page.evaluate(()=>{
      const g=__g,T=g.T,records=[];
      const check=(ok,message)=>{if(!ok)throw new Error(message);};
      const reset=()=>{
        g.setup();g.running=true;
        for(const u of g.units){Object.assign(u,{frozen:true,alive:false,respawnT:Infinity});u.group.visible=false;}
        for(const turret of g.turrets)turret.alive=false;
        g.renderer.render=()=>g.scene.updateMatrixWorld();
      };
      const deploy=(team,idx,x,z,liveBot=false)=>{
        const u=g.units.find(u=>u.team===team&&u.idx===idx);g.spawn(u,'base');
        u.pos.set(x,g.terrainH(x,z),z);u.group.position.copy(u.pos);
        Object.assign(u,{frozen:!liveBot,waypoint:null,xferCd:0,target:null,invulT:0,onGround:true});return u;
      };
      const tick=n=>{for(let i=0;i<n;i++)g.loop(__advanceClock());};
      for(const team of ['B','R']){
        const s=team==='B'?1:-1,enemy=team==='B'?'R':'B';
        reset();const guards=[2,7].map(i=>deploy(team,i,0,490*s,true));
        tick(600);
        const posts=guards.map(u=>({index:u.idx,pos:u.pos.toArray(),distance:u.pos.distanceTo(g.baseDefenseTask(u).pos)}));
        check(posts.every(p=>p.distance<6),`${team}: 守備地点へ着けない ${JSON.stringify(posts)}`);
        check(guards[0].pos.distanceTo(guards[1].pos)>25,`${team}: 守備が同じ地点に集中`);
        // 遠方プラントの交戦があっても、基地守備役は自動転出しない。
        const pl=g.plants.find(p=>Math.abs(p.pos.z)<200);pl.owner=team;pl.capturing=true;pl.gauge=s*50;
        deploy(enemy,0,pl.pos.x,pl.pos.z);
        for(const u of guards){u.target=null;u.xferCd=0;g.botTransfer(u);check(!u.transfer,`${team}: 守備が基地から転出`);}
        records.push({team,case:'常駐守備と転出禁止',posts});

        reset();const reserves=[1,4,5,8].map((i,n)=>deploy(team,i,(-80+n*35)*s,(200-n*70)*s));
        const intruder=deploy(enemy,0,134*s,326*s),rd=g.radars.find(r=>r.team===team);
        check(reserves.every(u=>!g.baseDefenseTask(u)),`${team}: 検知前に敵位置を利用`);
        // 実際のセンサー設置処理から検知する。レーダー警報の外側。
        // 追加された面状センサーと混同せず、このケースは通常の球形センサーを置く。
        const spec=g.WEAPONS.sensor.proj;
        check(spec.kind==='sensor'&&!spec.cone&&!spec.planar,'通常センサーの仕様が変わった');
        g.placeGadget({spec,owner:reserves[0],team},new T.Vector3(134*s,0,315*s),null);
        g.gadgetUpdate(.05);check(g.spotted[team].has(intruder),`${team}: センサー未検知`);
        const selected=reserves.filter(u=>g.baseDefenseTask(u));check(selected.length===2,`${team}: 応援数 ${selected.length}`);
        const u=selected[0],from=u.pos.clone(),expected=g.areaTime(u);g.botTransfer(u);
        check(u.transfer?.at==='base',`${team}: 索敵から基地へ帰還しない`);
        check(Math.abs(u.transfer.t-expected)<1e-6,`${team}: 帰還待機時間が通常と違う`);
        tick(10);check(u.pos.distanceTo(from)<1,`${team}: 待機前に移動`);
        tick(Math.ceil(expected/.05)+4);check(u.pos.z*s>g.curMap.baseLine,`${team}: 待機後に帰還しない`);
        // レーダーが壊れていても別のセンサーは検知を共有する。
        g.damage(rd,reserves[0],rd.maxHp+1);check(!rd.alive,`${team}: レーダーを破壊できない`);
        g.gadgetUpdate(.3);check(g.spotted[team].has(intruder),`${team}: センサー検知が消えた`);
        for(const gadget of [...g.gadgets])g.damage(gadget,intruder,gadget.maxHp+1);
        tick(Math.ceil((spec.keep+1)/.05));
        check(!g.spotted[team].has(intruder),`${team}: 検知が失効しない`);
        check(reserves.every(v=>!g.baseDefenseTask(v)),`${team}: 検知解除後も見えない敵を追う`);
        records.push({team,case:'センサー検知→通常待機→帰還・施設破壊後の失効',responders:selected.map(v=>v.idx),wait:expected});

        reset();const e=deploy(enemy,0,0,460*s),guard=deploy(team,2,0,498*s);
        g.scene.updateMatrixWorld();check(!g.canSee(guard,e,g.targetPoint(e)),`${team}: 内壁が射線を切らない`);
        const radar=g.radars.find(r=>r.team===team);g.radarUpdate(radar,.05);
        check(g.baseDefenseTask(guard)?.threat===e,`${team}: レーダー警報へ応答しない`);
        records.push({team,case:'侵入警報中も内壁で射線を遮る'});

        reset();const shooter=deploy(enemy,6,-42*s,412.8*s),antenna=g.radars.find(r=>r.team===team);
        g.scene.updateMatrixWorld();g.radarUpdate(antenna,.05);
        check(!antenna.intruders.includes(shooter),`${team}: 門外の射撃地点で侵入警報`);
        check(g.canSee(shooter,antenna,g.targetPoint(antenna)),`${team}: 門外からレーダーへの射線が無い`);
        g.fire(shooter,g.targetPoint(antenna),0,g.WEAPONS.marks);
        check(antenna.hp<antenna.maxHp,`${team}: 通常の弾がレーダーに当たらない`);
        records.push({team,case:'侵入警報の外からレーダーを射撃可能',position:shooter.pos.toArray(),damage:antenna.maxHp-antenna.hp});
      }
      // 地上で屋根の下へ着いても、上層の経由点を達成扱いしない。
      reset();const sprinter=deploy('B',9,-108,-531.2);
      sprinter.raidRoute={kind:'sprint',index:4};
      check(g.raidGoal(sprinter,new T.Vector3()).y===10&&sprinter.raidRoute.index===4,'屋根の経由点を地上で飛ばした');
      return records;
    });
    assert.deepEqual(errors,[]);results.push(...report);
    const output=process.argv[3]||'dbg/base-defense-check.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results,errors},null,2)+'\n');
    console.log(`基地守備 ${results.length} ケース、エラー0`);await page.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
