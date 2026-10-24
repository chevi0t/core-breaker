// 加速中はSPを使い、通常ブースターは0.5秒の待ち時間後に毎秒50回復する。
const path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader']});
 try{
  const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.stack));
  await p.route(/^https:\/\/fonts\./,r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await p.goto(pathToFileURL(path.join(path.resolve(process.argv[2]||'dbg'),'dbg.html')).href);
  const cases=await p.evaluate(()=>{
   const g=__g;g.selectMap('city');g.setup();g.running=false;const u=g.player,rows=[];
   const ok=(v,m)=>{if(!v)throw Error(m);};
   for(const key of g.ARMORY.assault.sp.filter(k=>g.WEAPONS[k].type==='charger'))for(const bot of [false,true])for(const hot of [false,true]){
    u.isPlayer=true;g.loadout.assault.sp=key;g.equip(u,'assault');g.spawn(u);u.isPlayer=!bot;
    Object.assign(u,{chargerOn:true,boost:hot?0:10,boostIdle:0,overheat:hot,dashT:0,longDash:false,stun:'',ctrlLockT:0,flying:false});
    const initial=u.boost,sp=u.slots.sp.heat,dt=1/120;
    for(let t=0;t<1-1e-6;t+=dt)g.physics(u,new g.T.Vector3(0,0,-1),true,false,dt);
    ok(u.charging&&u.slots.sp.heat<sp,'加速中はSP消費：'+key);
    ok(Math.abs(u.boost-initial-25)<.5,'加速中に通常ブースターが毎秒50回復：'+key+' '+u.boost);
    if(hot){
     // SPを回復して継続し、通常ブースターの過熱が満タンで解除されることを確認。
     for(let t=0;t<4;t+=dt){u.slots.sp.heat=100;u.slots.sp.overheat=false;g.physics(u,new g.T.Vector3(0,0,-1),true,false,dt);}
     ok(u.boost===u.maxBoost&&!u.overheat,'SP加速中も通常過熱から復帰：'+key);
    }
    rows.push({key,bot,hot});
   }
   u.isPlayer=true;g.equip(u,'assault');g.spawn(u);u.boost=50;u.boostIdle=0;u.longDash=true;u.chargerOn=false;
   for(let t=0;t<1;t+=1/120)g.physics(u,new g.T.Vector3(0,0,-1),true,false,1/120);
   ok(u.boost<40&&u.dashState==='long','通常巡航は従来どおりブーストを消費');
   return rows;
  });
  assert.deepEqual(errors,[]);console.log(`加速装置${cases.length/4}種 × 自機/BOT × 通常/過熱、通常巡航の消費：成功。ブラウザエラー0。`);
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
