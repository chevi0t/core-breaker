// ホバー全型の原表換算、慣性・水面・制動補正、二脚互換、混成・保存を確認する。
// node tools/test/hover_legs_check.js dbg/hover /tmp/hover-check dbg/before
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const research=require('../../research/parts/types/hover-series.json');
const dir=path.resolve(process.argv[2]||'dbg/hover'),out=path.resolve(process.argv[3]||'/tmp/hover-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;});
  const catalog=()=>page.evaluate(()=>({parts:JSON.parse(JSON.stringify(__g.PARTS)),weapons:JSON.parse(JSON.stringify(__g.WEAPONS))}));
  const trace=()=>page.evaluate(()=>{
   const g=__g,T=g.T;g.selectMap('dock');g.setup();g.running=false;
   const u=g.player;u.mech={...g.MECH_DEFAULT};g.equip(u,'assault');
   Object.assign(u,{alive:true,pos:new T.Vector3(-20,100,0),vel:new T.Vector3(),onGround:false,stun:'',jumpBuf:0,catCd:0,ctrlLockT:0,dashT:0,longDash:false,flying:false,zip:null,electricT:0,transfer:null,repairing:false});
   const samples=[];
   for(let i=0;i<180;i++){g.physics(u,new T.Vector3(i<70?1:0,0,0),i>=25&&i<60,i===5,1/60,i>80&&i<110);if(i%10===0)samples.push([...u.pos.toArray(),...u.vel.toArray(),u.boost,u.onGround,u.dashState]);}
   return samples;
  });
  let before,oldTrace;
  if(process.argv[4]){await page.goto('file://'+path.join(path.resolve(process.argv[4]),'dbg.html'));before=await catalog();oldTrace=await trace();}
  await page.goto('file://'+path.join(dir,'dbg.html'));
  if(before){const after=await catalog();assert.deepEqual(after.weapons,before.weapons,'既存武器の全数値');for(const slot in before.parts)for(const key in before.parts[slot])assert.deepEqual(after.parts[slot][key],before.parts[slot][key],slot+'/'+key+'の互換');assert.deepEqual(await trace(),oldTrace,'二脚の位置・速度・ブースト・滞空が旧版と完全一致');}
  const result=await page.evaluate(research=>{
   const g=__g,T=g.T,checks=[],braking=[],snapshots=[];
   const yes=(v,m)=>{if(!v)throw Error(m);checks.push(m);},near=(a,b,e=1e-5)=>Math.abs(a-b)<e;
   g.selectMap('dock');g.setup();g.running=false;
   for(const u of g.units){u.frozen=true;u.alive=false;u.group.visible=false;}
   const u=g.player;u.alive=true;u.group.visible=true;
   const reset=(key,dt=1/60)=>{
    u.mech={...g.MECH_DEFAULT,legs:key};g.equip(u,'assault');
    Object.assign(u,{pos:new T.Vector3(-30,200,-30),vel:new T.Vector3(),onGround:false,stun:'',stunT:0,downT:0,jumpBuf:0,catCd:0,ctrlLockT:0,dashT:0,longDash:false,flying:false,zip:null,electricT:0,transfer:null,repairing:false,boostIdle:0,overheat:false});
    return dt;
   };
   for(const [family,record]of Object.entries(research.families)){
    yes(JSON.stringify(g.HOVER_PART_TYPES[family].rows)===JSON.stringify(record.rows),family+'のAC原表');
    for(let i=0;i<4;i++){
     const key=family+(i?i+1:'');
     for(const slot of ['head','body','arms','legs']){
      const p=g.PARTS[slot][key],fields=research.fields[slot],base=research.anchor[slot];
      yes(p.label==='ⅠⅡⅢⅣ'[i]+'型',slot+'/'+key+'の4型表示');
      fields.forEach((field,j)=>{const actual=p[field],raw=record.rows[slot][i][j];if(field==='accelTime')yes(actual===raw,key+'の加速は秒');else{const digits=['weight','cap'].includes(field)?0:['lock','boost'].includes(field)?1:['walk','dash','cruise'].includes(field)?2:4;const expected=+(g.PARTS[slot].standard[field]*raw/base[field]).toFixed(digits);yes(near(actual,expected),slot+'/'+key+'/'+field+'の換算');}});
     }
     reset(key);yes(g.hoverLegs(u),key+'は脚だけでホバー');
     reset('standard');u.mech={head:key,body:key,arms:key,legs:'standard',color:'team'};g.equip(u,'assault');yes(!g.hoverLegs(u),key+'の上半身だけでは二脚');
     const cfg=Object.fromEntries(['head','body','arms','legs'].map((s,j)=>[s,family+(j?j+1:'')]));
     yes(g.setBonus(cfg)===g.PART_SERIES[family].set,key+'の混成4型セット');
     const rates=[];
     for(const hz of [30,60,120]){
      reset(key);u.vel.x=20;
      const x=u.pos.x;for(let f=0;f<hz*2;f++)g.physics(u,new T.Vector3(),false,false,1/hz);
      const distance=u.pos.x-x;
      yes(Math.abs(distance-5)<.01&&Math.abs(u.vel.x)<.01,key+'/'+hz+'Hzの無入力制動は約5m');
      rates.push({hz,distance,speed:u.vel.x});
      reset(key);u.longDash=true;const initial=u.boost;
      for(let f=0;f<hz;f++)g.physics(u,new T.Vector3(1,0,0),true,false,1/hz);
      yes(near(initial-u.boost,13.8*.8*1.75,1e-4),key+'/'+hz+'Hzの巡航消費');
      reset(key);u.vel.y=-4;const h=u.pos.y,b=u.boost;
      for(let f=0;f<hz;f++)g.physics(u,new T.Vector3(),false,false,1/hz,true);
      yes(near(h-u.pos.y,.3,1e-4)&&near(b-u.boost,12*.8*1.75,1e-4),key+'/'+hz+'Hzの滞空と消費');
     }
     braking.push({key,rates,uncompensatedReferenceDistance:10,compensatedDistance:5});
     reset(key);yes(g.shortDash(u,new T.Vector3(1,0,0))&&near(u.maxBoost-u.boost,12*.8),key+'の瞬間ブースト消費は二脚と同じ');
     reset(key);u.vel.y=-30;g.physics(u,new T.Vector3(),false,false,1/60);yes(u.vel.y>=-6,key+'の受動エアブレーキ');
     reset(key);u.vel.y=-30;u.boost=0;u.overheat=true;g.physics(u,new T.Vector3(),false,false,1/60,true);yes(u.vel.y<=-6&&u.vel.y>=-12,key+'のOH時は降下');
     reset(key);u.ctrlLockT=1;u.flying=true;u.flightSpeed=80;u.vel.set(0,15,80);g.physics(u,new T.Vector3(1,0,0),false,false,1/60,true);yes(near(u.vel.z,80),key+'のカタパルト射出の勢い');
     reset(key);g.jolt(u,u.pos.clone().add(new T.Vector3(0,0,-1)),2600,true);yes(u.stun==='stagger',key+'の転倒耐性低下');
     const model=g.buildMech(g.TEAM.B.color,{head:key,body:key,arms:key,legs:key,color:'ash'});
     yes(model.rig.legKind==='hover'&&!!model.hoverJet,key+'の専用形状と下方噴射');
     const own=model.g.children.filter(m=>m.userData.own&&m.userData.armorSlot);yes(own.length===4,key+'の装甲4部位');
     const fixture={...model,stats:g.mechStats({head:key,body:key,arms:key,legs:key},g.loadout.assault),slots:u.slots,weapon:'main',pos:new T.Vector3(),vel:new T.Vector3(0,-2,0),yaw:0,pitch:0,recoil:0,alive:true,boost:100,onGround:false};
     g.weaponLook(fixture,1/60);
     yes(Math.abs(model.rig.bones.brakeL.node.rotation.z)>.5&&Math.abs(model.rig.bones.brakeR.node.rotation.z)>.5,key+'の空中制動板が開く');
     fixture.planted=true;g.weaponLook(fixture,1/60);
     yes(!model.hoverJet.visible&&model.rig.bones.brakeL.node.rotation.z===0,key+'の構え中は噴射・制動板を閉じる');
     yes(model.hoverJet.userData.visualOnly&&new T.Raycaster().intersectObject(model.hoverJet).length===0,key+'の噴射は被弾面を持たない');
     g.disposeMech(model.g);
    }
   }
   const key=Object.keys(research.families)[0],oldObstacles=g.obstacles.slice(),oldWater=g.waters.slice();
   g.obstacles.length=0;g.waters.length=0;
   try{
    reset(key);const ground=g.terrainH(-30,-30),level=ground+8;g.waters.push([-100,-100,100,100,level]);u.pos.set(-30,level,-30);u.onGround=true;
    yes(g.hoverOnWater(u),'水面と地面を区別する');
    for(let i=0;i<60;i++)g.physics(u,new T.Vector3(),false,false,1/60);yes(near(u.pos.y,level),'水面を支持面にする');
    u.boost=0;u.overheat=true;g.physics(u,new T.Vector3(),false,false,1/60);yes(near(u.pos.y,level),'OHだけでは水没しない');
    u.planted=true;for(let i=0;i<120;i++)g.physics(u,new T.Vector3(),false,false,1/60);yes(u.pos.y<level-1,'構えると下方噴射が停止して沈む');
    u.planted=false;g.physics(u,new T.Vector3(),false,false,1/60);yes(near(u.pos.y,level),'構え解除で水面へ復帰');
    g.obstacles.push({minX:-60,maxX:0,minZ:-60,maxZ:0,bottom:level+6,top:level+7});
    yes(near(g.hoverGroundAt(u,-30,-30,level),level),'橋下の水面から橋上へ飛び移らない');
    u.pos.y=level+7;yes(near(g.hoverGroundAt(u,-30,-30,u.pos.y),level+7),'橋上は橋の床を使う');
    g.obstacles[0].bottom=level-2;g.obstacles[0].top=level-1;u.pos.y=ground;
    yes(g.hoverGroundAt(u,-30,-30,ground)<level,'水面との間に低い天井があれば浮上しない');
    g.obstacles.length=0;u.pos.y=level;
    yes(g.hoverClearPath(u,-30,-30,20,-30,level),'ホバーBotの水上経路');
    g.obstacles.push({minX:-2,maxX:2,minZ:-50,maxZ:0,top:level+10});
    yes(!g.hoverClearPath(u,-30,-30,20,-30,level),'水上経路も壁を避ける');
    reset('standard');u.pos.set(-30,ground,-30);yes(near(g.hoverGroundAt(u,-30,-30,ground),ground),'二脚は水面を床にしない');
   }finally{g.obstacles.splice(0,g.obstacles.length,...oldObstacles);g.waters.splice(0,g.waters.length,...oldWater);}
   const catalog={},weights=[];
   for(const family of Object.keys(research.families))for(let i=0;i<4;i++){
    const key=family+(i?i+1:''),cfg=Object.fromEntries(['head','body','arms','legs'].map(s=>[s,key]));
    catalog[key]=Object.fromEntries(['head','body','arms','legs'].map(s=>[s,g.PARTS[s][key]]));
    for(const cls of ['assault','heavy','raid','support']){
     const load=Object.fromEntries(g.SLOTS.map(s=>[s,g.ARMORY[cls][s][0]])),st=g.mechStats(cfg,load);
     weights.push({key,cls,weight:st.weight,cap:st.cap,excess:st.excess});
    }
   }
   g.mechCfg.legs=key;g.setup();yes(!!g.player.hoverJet&&!g.hittables.includes(g.player.hoverJet),'実機の噴射が同期し、被弾面に登録されない');
   return {checks,braking,catalog,weights};
  },research);
  const ui=[];
  for(const family of Object.keys(research.families))for(const slot of ['head','body','arms','legs'])for(let i=0;i<4;i++){
   const key=family+(i?i+1:'');
   await page.evaluate(({slot,family})=>{document.querySelector('[data-page="pgCustom"]').click();document.querySelector(`[data-cslot="${slot}"]`).click();if(!document.querySelector(`[data-pick="${family}"]`))document.querySelector(`[data-series="${family}"]`).click();},{slot,family});
   await page.locator(`[data-pick="${key}"]`).click();
   assert.equal(await page.locator(`[data-pick="${key}"]`).getAttribute('aria-pressed'),'true');
   ui.push(slot+'/'+key);
  }
  await page.evaluate(()=>__g.loop(performance.now()));await page.screenshot({path:path.join(out,'custom.png'),fullPage:true});
  const config=await page.evaluate(()=>JSON.parse(JSON.stringify(__g.mechCfg)));
  await page.reload();assert.deepEqual(await page.evaluate(()=>JSON.parse(JSON.stringify(__g.mechCfg))),config,'新4型の保存・再読込');
  const legacyContext=await browser.newContext();
  await legacyContext.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  const legacy={head:'light3',body:'standard2',arms:'heavy3',legs:'standard',color:'ash'};
  await legacyContext.addInitScript(cfg=>{requestAnimationFrame=()=>0;window.AudioContext=undefined;if(!localStorage.getItem('hoverLegacyFixture')){localStorage.setItem('hoverLegacyFixture','1');localStorage.setItem('coreBreakerMech',JSON.stringify(cfg));localStorage.setItem('coreBreakerBuilds',JSON.stringify({cur:1,list:[{mech:cfg},{mech:cfg},{mech:cfg}]}));}},legacy);
  const oldPage=await legacyContext.newPage();await oldPage.goto('file://'+path.join(dir,'dbg.html'));
  assert.deepEqual(await oldPage.evaluate(()=>JSON.parse(JSON.stringify(__g.mechCfg))),legacy,'旧形式の混成機体を維持');
  assert.equal(await oldPage.evaluate(()=>__g.builds.cur),1,'旧形式の選択構成を維持');await legacyContext.close();
  assert.deepEqual(errors,[]);
  const output={...result,ui,oldCatalogAndBipedTraceCompared:!!before,errors};fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({checks:result.checks.length,ui:ui.length,oldCatalogAndBipedTraceCompared:!!before,braking:result.braking,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
