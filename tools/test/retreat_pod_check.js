// 実測した中央の損傷地点で、本体のBotが補給点を選び、歩いて回復できるか。
// 敵を退避させた機能検査であり、交戦下の生還率の代用にはしない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser'),prepare=require('./prepare_bot_battle');
const sourceFile=process.argv[3]==='--map-source'?process.argv[4]:null;
let source=null;
if(sourceFile){const c={window:{}};require('node:vm').runInNewContext(fs.readFileSync(sourceFile,'utf8'),c);source=JSON.parse(JSON.stringify(c.window.MAP_DATA.circulation));}
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const {page,errors}=await openMap(browser,'circulation-v3',source,20261105,{silent:true});
  try{
   await page.click('#start');await page.evaluate(prepare,{fixture:{seed:20261105,swapped:false}});
   const results=await page.evaluate(()=>{
    const g=__g,out=[],pod=g.pods.find(p=>p.plant?.id==='C');
    if(!pod)throw new Error('中央補給点なし');pod.plant.owner='B';pod.plant.gauge=100;
    for(const [idx,x,z] of [[0,-4,-45],[2,16,-89]]){
     g.setup();g.plants.find(p=>p.id==='C').owner='B';g.plants.find(p=>p.id==='C').gauge=100;
     // 敵を青ベースへ置くと守備役のエリア移動が発動する。各軍を自軍後方へ退避。
     for(const u of g.units){u.frozen=true;u.pos.set(140,0,(u.team==='B'?1:-1)*(220-u.idx*2));}
     for(const radar of g.radars)radar.intruders=[];
     const u=g.units.find(u=>u.team==='B'&&u.idx===idx),start=g.MATCH-g.timeLeft;
     u.pos.set(x,g.terrainH(x,z),z);u.vel.set(0,0,0);
     Object.assign(u,{frozen:false,hp:u.maxHp*.25,waypoint:null,target:null,healing:false,onGround:true,flying:false});
     pod.plant.owner=null;
     if(g.nearestPod(u)!==null)throw new Error('中央ポッドなしでも90m以内の味方補給点が存在します');
     pod.plant.owner='B';
     const selected=g.nearestPod(u);
     if(selected!==pod)throw new Error(`${idx}: 中央ポッドを選べません`);
     const distance=u.pos.distanceTo(pod.pos),trace=[];let reached=false,healed=false,firstArrival=null;
     for(let i=0;i<800;i++){
      g.loop(__advanceClock());
      if(i%20===0)trace.push({t:i*.05,pos:u.pos.toArray(),hp:u.hp,maxHp:u.maxHp,repairing:u.repairing,healing:u.healing});
      if(u.repairing&&u.pos.distanceTo(pod.pos)<5){reached=true;firstArrival??=g.MATCH-g.timeLeft-start;}
      if(reached&&u.hp>=u.maxHp*.95){healed=true;break;}
     }
     if(!reached||!healed)throw new Error(`${idx}: 退避/回復失敗 ${JSON.stringify({reached,healed,pod:pod.pos.toArray(),trace})}`);
     out.push({class:u.cls,start:[x,z],distance,withoutCentralPod:null,selected:true,arrived:true,arrivalSeconds:Math.round(firstArrival*20)/20,recovered95:true});
    }
    return out;
   });
   assert.deepEqual(errors,[]);
   const output=process.argv[2]||'dbg/retreat-pod.json';fs.mkdirSync(path.dirname(output),{recursive:true});
   fs.writeFileSync(output,JSON.stringify({note:'戦闘なし。本体Botの選択・実走・回復。',results,errors},null,2)+'\n');
   console.log('中央2地点：強襲/重火力Botのポッド選択・実走・95%回復を確認');
  }finally{await page.close();}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
