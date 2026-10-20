// 遮蔽の両側の横道と、中央から既存ポッドへ戻る道を本体のphysicsで歩く。
// 交戦下の生還率やBotの自発的な退避判断の検査ではない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),results=[];
 try{
  for(const map of ['circulation','circulation-v2','circulation-v3']){
   const {page,errors}=await openMap(browser,map,null,1,{silent:true});
   try{
    await page.click('#start');
    const routes=await page.evaluate(()=>{
     const g=__g,out=[],N=g.NAV;
     const scene=g.player.group.parent;g.renderer.render=()=>scene.updateMatrixWorld();
     for(const u of g.units){u.frozen=true;u.pos.set(140,0,220-u.idx*8);}
     const near=(x,z)=>N.pts.reduce((best,p,i)=>Math.hypot(p.x-x,p.z-z)+Math.abs(p.y-g.terrainH(x,z))*4<Math.hypot(N.pts[best].x-x,N.pts[best].z-z)+Math.abs(N.pts[best].y-g.terrainH(x,z))*4?i:best,0);
     const plans=[];
     g.player.navW=N.links.map(()=>1);
     if(g.mapId==='circulation')for(const side of [-1,1]){
      const points=[[0,190],[side*60,184],[side*60,148],[side*32,148]];
      plans.push({name:side<0?'青ベース左の横道':'青ベース右の横道',points},
       {name:side<0?'左の横道からベースへ':'右の横道からベースへ',points:points.slice().reverse()});
     }
     for(const team of ['B','R']){
      const pod=g.pods.find(p=>p.plant?.owner===team),sign=team==='B'?1:-1;
      const start=near(8,-80*sign),end=near(8,165*sign);
      const indices=g.navPath(g.player,start,end);
      if(!indices)throw new Error('中央から補給への経路なし');
      plans.push({name:team+'中央から外周ポッドへ',team,pod,points:[...indices.map(i=>[N.pts[i].x,N.pts[i].z]),[pod.pos.x,pod.pos.z]]});
     }
     for(const chassis of ['light','heavy'])for(const plan of plans){
      const u=g.player;u.team=plan.team||'B';u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,chassis==='light'?'assault':'heavy');
      const [x,z]=plan.points[0];u.pos.set(x,g.terrainH(x,z),z);u.vel.set(0,0,0);
      Object.assign(u,{alive:true,onGround:true,flying:false,repairing:false,planted:false,stun:'',dashT:0,longDash:false,charging:false,overheat:false,ctrlLockT:0,boost:u.maxBoost});
      let ticks=0;
      for(const [x,z] of plan.points.slice(1)){
       let arrived=false;
       for(let i=0;i<1000;i++){
        const delta=new g.T.Vector3(x-u.pos.x,0,z-u.pos.z);
        if(delta.length()<1.4){arrived=true;break;}
        g.physics(u,delta.normalize(),false,false,.05);ticks++;
       }
       if(!arrived)throw new Error(`${chassis}/${plan.name}: (${x},${z})に到達不能、現在${u.pos.toArray()}`);
      }
      let healed=null;
      if(plan.pod){
       u.hp=1000;u.vel.set(0,0,0);u.moveInput=false;
       for(let i=0;i<20;i++)g.loop(__advanceClock());
       healed=u.hp>1000;if(!healed)throw new Error('既存ポッドで補給できません');
      }
      out.push({chassis,route:plan.name,seconds:Math.round(ticks*5)/100,arrived:true,healed});
     }
     return out;
    });
    assert.deepEqual(errors,[]);results.push({map,routes,errors});
   }finally{await page.close();}
  }
  const output=process.argv[2]||'dbg/cover-routes.json';fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({note:'戦闘なしの実走。自発的な退避や交戦下の生還は未検証。',results},null,2)+'\n');
  console.log(`${results.reduce((n,r)=>n+r.routes.length,0)}経路：軽量/重量機の横道・両軍の退避と実ポッド回復を確認`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
