// 通常の本体へ登録した都市マップをオフラインで検査する。配置だけでなく本体の移動・占拠・補給・20機の対戦を動かす。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const folder=path.resolve(process.argv[2]||'dbg');
const output=path.resolve(process.env.CITY_CHECK_OUTPUT||'mapdesign/hoshimichi');
const seconds=+(process.argv[3]||600);
const config={seed:+(process.argv[4]||20261023),team:process.argv[5]||'B'};
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const page=await browser.newPage({offline:true,viewport:{width:1280,height:960}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url()))external.push(r.url());});
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await page.addInitScript(initialSeed=>{
   window.testNow=0;performance.now=()=>window.testNow;requestAnimationFrame=()=>0;AudioContext=undefined;
   let seed=initialSeed;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;
  },config.seed);
  const open=async()=>{await page.goto(pathToFileURL(path.join(folder,'dbg.html')).href);await page.waitForFunction(()=>window.__g);await page.evaluate(()=>{
   const g=__g;g.selectMap('hoshimichi');
   Object.defineProperties(g,{city:{get:()=>g.cityMap},battle:{get:()=>g.cityBattle},frame:{get:()=>g.loop},chosenTeam:{set:team=>{const input=document.querySelector(`input[name="team"][value="${team}"]`);input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));}}});
  });};
  await open();
  const facilities=await page.evaluate(()=>{
   const g=__g,{T,city}=g;g.setup();g.running=false;g.scene.updateMatrixWorld(true);
   function ok(test,message,data){if(!test)throw Error(message+' '+JSON.stringify(data));}
   ok(g.units.length===20,'10対10');ok(g.jumpPads.length===0&&city.district.roofPads.length===0,'片軍だけの屋上ジャンプパッドを撤去');
   ok(g.turrets.length===8&&g.radars.length===2&&g.catapults.length===8&&g.pods.length===8,'両軍の対戦施設');
   ok(g.plants.length===4&&g.plants.every(p=>p.owner===null),'4プラントは中立から');
   const markers=[['A',51,-23],['B',-70,-56],['C',196,-218],['D',-250,215]];
   for(const [id,x,z] of markers){const p=g.plants.find(p=>p.id===id);ok(p.pos.x===x&&p.pos.z===z,'赤丸の位置を維持',id);}
   for(const e of g.NAV.links){const a=g.NAV.pts[e.a],b=g.NAV.pts[e.b];ok(g.clearPath(a.x,a.z,b.x,b.z,a.y)&&g.clearPath(b.x,b.z,a.x,a.z,b.y),'全経路が往復可能',{a,b});}
   const u=g.player,zero=new T.Vector3(),flights=[],spawns=[],captures=[],walks=[],repairs=[],hiddenPodViews=[];
   function reset(at){g.spawn(u);u.pos.fromArray(at);u.vel.set(0,0,0);u.onGround=true;Object.assign(u,{stun:'',stunT:0,dashT:0,lungeT:0,recoverT:0,ctrlLockT:0,flying:false,planted:false,electricT:0,charging:false,chargerOn:false,repairing:false});}
   for(const type of ['light','standard','heavy'])for(const dt of [1/30,1/120])for(const cp of g.catapults){
    u.mech={head:type,body:type,arms:type,legs:type,color:'team'};reset(cp.pos.toArray());g.catapultUpdate(dt);
    ok(u.flying,'台に乗ると自動射出',cp.pos.toArray());
    let firstLanding=null;
    for(let t=0;t<6;t+=dt){g.physics(u,zero,false,false,dt);if(!firstLanding&&u.onGround)firstLanding=u.pos.clone();}
    const error=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z);
    const landingError=firstLanding?Math.hypot(firstLanding.x-cp.land.x,firstLanding.z-cp.land.z):Infinity;
    ok(landingError<=6&&Math.abs(firstLanding.y-cp.land.y)<.05,'最初の接地が指定地点の6m以内',{type,dt,from:cp.pos.toArray(),firstLanding:firstLanding?.toArray(),landingError});
    ok(error<=6&&u.onGround&&Math.abs(u.pos.y-cp.land.y)<.05,'カタパルトの指定着地から6m以内',{type,dt,from:cp.pos.toArray(),land:cp.land.toArray(),end:u.pos.toArray(),error});
    flights.push({type,dt,from:cp.pos.toArray(),land:cp.land.toArray(),firstLanding:firstLanding.toArray(),landingError,end:u.pos.toArray(),error});
   }
   for(const other of g.units)other.alive=other===u;
   for(const pl of g.plants)for(const team of ['B','R']){
    u.team=team;reset([pl.pos.x+4,pl.pos.y,pl.pos.z+3]);pl.owner=null;pl.gauge=0;
    for(let i=0;i<240;i++)g.plantUpdate(pl,.05);
    ok(pl.owner===team,'本体の占拠で所有権が変わる',{plant:pl.id,team,gauge:pl.gauge});captures.push([pl.id,team]);
    for(let i=0;i<24;i++){
     g.spawn(u,pl.id);const r=Math.hypot(u.pos.x-pl.pos.x,u.pos.z-pl.pos.z),b=city.base(team).at;
     const dot=(u.pos.x-pl.pos.x)*(b[0]-pl.pos.x)+(u.pos.z-pl.pos.z)*(b[1]-pl.pos.z);
     ok(r>=45.98&&r<=52.02&&dot>0&&Math.abs(u.pos.y+2)<.03,'基地側の陸上46〜52mに再出撃',{plant:pl.id,team,r,dot,at:u.pos.toArray()});
     ok(g.battle.free(u.pos.x,u.pos.z,u.pos.y,g.obstacles),'再出撃時に建物へ埋まらない',u.pos.toArray());spawns.push([pl.id,team,r]);
    }
   }
   // 両基地から全プラントへ、経路探索と同じ節点を機体で歩く。ブースト・ジャンプによる救済はしない。
   for(const team of ['B','R'])for(const pl of g.plants){
    u.team=team;g.spawn(u,'base');const start=u.pos.toArray(),goal=pl.pos.clone().add(new T.Vector3(4,0,3));
    const nearest=(p)=>g.NAV.pts.map((q,i)=>[Math.hypot(q.x-p.x,q.z-p.z)+Math.abs(q.y-p.y)*3,i]).sort((a,b)=>a[0]-b[0]).find(([,i])=>{const q=g.NAV.pts[i];return g.clearPath(p.x,p.z,q.x,q.z,p.y);})?.[1];
    const a=nearest(u.pos),b=nearest(goal);ok(a!==undefined&&b!==undefined,'基地とプラントが経路へ接続',{team,id:pl.id});
    u.navW=new Float64Array(g.NAV.links.length).fill(1);
    const route=g.navPath(u,a,b);ok(route?.length,'両基地から全プラントへ経路あり',{team,id:pl.id});
    const points=route.map(i=>g.NAV.pts[i]);points.push({x:goal.x,z:goal.z,y:goal.y});let i=0,t=0;
    u.vel.set(0,0,0);u.stun='';u.flying=false;u.repairing=false;u.onGround=true;
    for(;i<points.length&&t<250;t+=1/60){const p=points[i],wish=new T.Vector3(p.x-u.pos.x,0,p.z-u.pos.z);if(wish.length()<.35){i++;continue;}g.physics(u,wish.normalize(),false,false,1/60);}
    ok(i===points.length,'実機体が徒歩でプラントへ到達',{team,id:pl.id,progress:i,total:points.length,at:u.pos.toArray(),next:points[i]});
    walks.push({team,plant:pl.id,seconds:t,start,end:u.pos.toArray()});
   }
   for(const pd of g.pods){
    u.team=pd.team||'B';if(pd.plant)pd.plant.owner=u.team;
    reset(pd.pos.toArray());const before=u.hp=u.maxHp-3000;u.moveInput=false;u.podT=u.podN=0;
    const sl=u.slots.main;sl.ammo=Math.max(1,sl.w.mag-1);sl.reserve=0;sl.reloadT=0;
    for(let i=0;i<40;i++)g.podUpdate(pd,.05);
    ok(u.hp>before&&u.repairing&&sl.reserve>0,'本体のポッドで修理・弾薬補給',{at:pd.pos.toArray(),hp:u.hp,reserve:sl.reserve});
    const ammo=sl.ammo,at=u.pos.clone();g.keys.ShiftLeft=g.keys.Space=true;g.pressed.ShiftLeft=g.pressed.Space=true;g.weaponsTick(u,1/120,true,new T.Vector3(0,5,0),0);
    g.playerUpdate(u,1/120);delete g.keys.ShiftLeft;delete g.keys.Space;delete g.pressed.ShiftLeft;delete g.pressed.Space;
    ok(sl.ammo===ammo&&u.dashT<=0&&u.pos.distanceTo(at)<.01,'補給中は発砲・ダッシュ・ジャンプをしない');
    repairs.push({at:pd.pos.toArray(),healed:u.hp-before});
    if(pd.plant&&['A','B'].includes(pd.plant.id)){
     const sign=pd.plant.id==='A'?1:-1;let at=0;
     let sampled=0;
     for(const distance of [20,40,60])for(const angle of [-Math.PI/3,-Math.PI/6,0,Math.PI/6,Math.PI/3]){
      const x=pd.pos.x+Math.sin(angle)*distance,z=pd.pos.z-sign*Math.cos(angle)*distance,y=g.terrainH(x,z);
      if(!g.battle.free(x,z,y,g.obstacles))continue;
      const from=new T.Vector3(x,y+3,z),to=pd.pos.clone().add(new T.Vector3(0,1.5,0)),direction=to.clone().sub(from),length=direction.length();
      const hit=g.castFrom(from,direction.normalize(),u,length);
      ok(hit&&hit.dist<length-.2,'敵側の地上から補給ポッドが隠れる',{plant:pd.plant.id,from:from.toArray(),hit:hit?.dist,length});sampled++;
     }
     ok(sampled>=5,'補給ポッドの隠れ方を複数方向から検査',{plant:pd.plant.id,sampled});hiddenPodViews.push({plant:pd.plant.id,sampled});
     for(let t=0;t<8;t+=1/120){u.repairing=false;g.physics(u,new T.Vector3(0,0,sign),false,false,1/120);at=u.pos.z;if((at-pd.pos.z)*sign>19)break;}
     ok((at-pd.pos.z)*sign>19&&Math.abs(u.pos.y+2)<.05,'窪地から歩いて道路へ出られる',{plant:pd.plant.id,at:u.pos.toArray()});
    }
   }
   const defenses=[];
   for(const rd of g.radars){
    u.team=rd.team==='B'?'R':'B';const base=city.base(rd.team);reset([base.at[0]+16,-2,base.at[1]]);
    g.radarUpdate(rd,.05);ok(rd.intruders.includes(u),'基地のレーダーが敵侵入を検知',rd.team);
   }
   for(const tu of g.turrets){
    u.team=tu.team==='B'?'R':'B';let fired=false;
    for(let a=0;a<Math.PI*2&&!fired;a+=Math.PI/6){
     const x=tu.pos.x+Math.cos(a)*18,z=tu.pos.z+Math.sin(a)*18,y=g.terrainH(x,z);
     if(!g.battle.free(x,z,y,g.obstacles))continue;
     reset([x,y,z]);u.invulT=0;u.cloak=false;u.group.position.copy(u.pos);g.scene.updateMatrixWorld(true);
     tu.think=tu.fireCd=0;tu.target=null;
     for(let i=0;i<120;i++)g.turretUpdate(tu,.05);
     fired=g.shells.some(s=>s.owner===tu);
    }
    ok(fired,'防衛砲台が視認した敵を射撃',tu.pos.toArray());defenses.push(tu.pos.toArray());
   }
   return {plants:markers,counts:{units:g.units.length,turrets:g.turrets.length,radars:g.radars.length,catapults:g.catapults.length,pods:g.pods.length,jumpPads:g.jumpPads.length},navigation:{...g.battle.navigationReport,nodes:g.NAV.pts.length,links:g.NAV.links.length},flights,spawns:spawns.length,captures,walks,repairs,defenses,hiddenPodViews};
  });
  console.log('施設・占拠・再出撃・徒歩経路の検査完了');
  await open();
  await page.evaluate(team=>{const g=__g;g.chosenTeam=team;g.setup();g.player.isPlayer=false;g.spawn(g.player,'base');g.renderer.render=()=>g.scene.updateMatrixWorld(true);g.running=true;
   window.battleStats={kills:0,spawns:0,catapults:0,captures:[],maxShells:0,repairSeconds:0};window.wasAlive=new Map();window.wasFlying=new Map();window.owners=new Map();
  },config.team);
  let state;
  for(let t=0;t<seconds;t+=30){
   state=await page.evaluate(count=>{
    const g=__g,s=battleStats;
    for(let frame=0;frame<count*20&&!g.ended;frame++){
     testNow+=50;g.frame(testNow);
     for(const u of g.units){if(wasAlive.get(u)&&!u.alive)s.kills++;if(!wasAlive.get(u)&&u.alive)s.spawns++;wasAlive.set(u,u.alive);if(!wasFlying.get(u)&&u.flying)s.catapults++;wasFlying.set(u,u.flying);if(u.repairing)s.repairSeconds+=.05;
      if(!u.pos.toArray().every(Number.isFinite)||u.pos.y<g.city.river.bed-.02||Math.max(Math.abs(u.pos.x),Math.abs(u.pos.z))>298.71)throw Error('対戦中の座標異常 '+u.pos.toArray());}
     for(const p of g.plants){if(owners.get(p)!==p.owner&&p.owner)s.captures.push({plant:p.id,team:p.owner,seconds:600-g.timeLeft});owners.set(p,p.owner);}
     s.maxShells=Math.max(s.maxShells,g.shells.length);
    }
    return {seconds:600-g.timeLeft,ended:g.ended,core:[g.cores.B.hp,g.cores.R.hp],plants:g.plants.map(p=>[p.id,p.owner]),...s};
   },Math.min(30,seconds-t));
   console.log(`Bot戦 ${Math.round(state.seconds)}秒: 撃破${state.kills} 占拠${state.captures.length} 射出台使用${state.catapults}`);
   assert.deepEqual(errors,[]);if(state.ended)break;
  }
  assert(state.seconds>=seconds-.05||state.ended,'指定時間まで対戦が進む');
  if(seconds>=150){assert(state.kills>0,'交戦して撃破が発生');assert(state.captures.length>=4,'占拠が発生');assert(state.catapults>0,'Botが射出台を使う');}
  if(seconds>=600)assert(state.ended,'10分で勝敗画面へ');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const record={config,facilities,battle:state,errors,externalRequests:external};
  const recordName=process.argv[4]?`battle-check-${config.team}-${config.seed}.json`:'battle-check.json';
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,recordName),JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(state));console.log('エラーなし・地形の外部通信なし（既存フォントは試験内で応答）');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
