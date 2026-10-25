// 速装型の実射・残弾・中断・拡散・発射音を確認する。元版と他武器の定義も照合する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{pathToFileURL}=require('node:url');
const after=path.resolve(process.argv[2]),before=path.resolve(process.argv[3]),out=path.resolve(process.argv[4]||'/tmp/shotgun-q-burst-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--autoplay-policy=no-user-gesture-required']}),errors=[];
 async function open(dir){
  const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.stack));
  await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;window.__nativeAC=window.AudioContext;window.AudioContext=window.webkitAudioContext=undefined;});
  await p.goto(pathToFileURL(path.join(dir,'dbg.html')).href);await p.waitForFunction(()=>window.__g);return p;
 }
 try{
  const old=await open(before),p=await open(after);
  const catalog=page=>page.evaluate(()=>JSON.parse(JSON.stringify({weapons:__g.WEAPONS,armory:__g.ARMORY,parts:__g.PARTS})));
  const baseline=await catalog(old),current=await catalog(p);const changed=Object.keys(current.weapons).filter(k=>JSON.stringify(current.weapons[k])!==JSON.stringify(baseline.weapons[k]));
  assert.deepEqual(changed,['shotgunQ']);assert.deepEqual(current.armory,baseline.armory);assert.deepEqual(current.parts,baseline.parts);
  const ignored=new Set(['spread','burst','rpm','gap','desc','sfx']);
  const kept=w=>Object.fromEntries(Object.entries(w).filter(([k])=>!ignored.has(k)));
  assert.deepEqual(kept(current.weapons.shotgunQ),kept(baseline.weapons.shotgunQ));
  const result=await p.evaluate(base=>{
   const g=__g,T=g.T;g.selectMap('dock');g.setup();g.running=false;g.renderer.render=()=>g.scene.updateMatrixWorld();
   for(const u of g.units){u.alive=false;u.group.visible=false;}const u=g.player,aim=new T.Vector3(0,123,-300);let checks=0;
   const ok=(v,m)=>{checks++;if(!v)throw Error(m);},near=(a,b)=>Math.abs(a-b)<1e-7;
   const w=g.WEAPONS.shotgunQ;
   ok(w.mag===base.mag&&w.mag===6,'装填6発を維持');ok(near(w.spread,base.spread/3),'拡散率1/3');ok(w.burst===3&&near(60/w.rpm,.1),'3点バーストの間隔');ok(near(3*60/w.rpm+w.gap,60/base.rpm),'組の開始周期を維持');
   function reset(ammo=6,isPlayer=true){
    u.isPlayer=true;Object.assign(u.mech,g.MECH_DEFAULT);g.equip(u,'support');u.slots.main=g.slotOf('shotgunQ');u.slots.main.ammo=ammo;u.slots.main.reserve=0;
    Object.assign(u,{isPlayer,alive:true,weapon:'main',switchT:0,stun:'',invulT:0,repairing:false,transfer:null,onGround:true,electricT:0,reloadMul:1,aimMul:1,recoil:0,recoilYaw:0,cameraRecoil:0,cameraRecoilYaw:0,sfxT:{}});
    u.pos.set(0,120,0);u.vel.set(0,0,0);u.group.visible=true;u.group.position.copy(u.pos);g.weaponLook(u,0);g.scene.updateMatrixWorld(true);return u.slots.main;
   }
   function run({ammo=6,isPlayer=true,dt=1/120,held=false,seconds=.8}){
    const sl=reset(ammo,isPlayer),shots=[];const begin=g.fx.length;
    for(let n=0;n<Math.ceil(seconds/dt);n++){const was=sl.ammo;g.weaponsTick(u,dt,held||n===0,aim,0);for(let j=0;j<was-sl.ammo;j++)shots.push(n*dt);}
    return {shots,ammo:sl.ammo,pellets:g.fx.slice(begin).filter(f=>f.kind==='tracer').length};
   }
   const bursts=[];
   for(const dt of [1/20,1/30,1/120])for(const isPlayer of [true,false]){
    const row=run({dt,isPlayer});ok(row.shots.length===3&&row.ammo===3,'離してもプレイヤー/Botが3発だけ撃つ');ok(row.pellets===3*w.pellets,'1発ごとの散弾数を維持');
    row.shots.forEach((t,i)=>ok(Math.abs(t-i*.1)<=dt+.00001,'実射の時間間隔'));bursts.push({dt,isPlayer,...row});
   }
   const held=run({held:true,seconds:1.5});ok(held.shots.length===6&&held.ammo===0,'6発で2組');ok(Math.abs(held.shots[3]-1)<.01,'次の組は1秒後');
   for(const ammo of [1,2]){const row=run({ammo});ok(row.shots.length===ammo&&row.ammo===0,'残り1〜2発だけ発射し負数にしない');}
   const sl=reset(2);sl.reserve=6;for(let n=0;n<400;n++)g.weaponsTick(u,.01,n===0,aim,0);ok(sl.ammo===6&&sl.reserve===0&&sl.bn===0,'弾切れ後の再装填で古いバーストを再開しない');
   for(const kind of ['switch','repair']){
    const sl=reset();g.weaponsTick(u,.01,true,aim,0);if(kind==='switch')g.selectWeapon(u,'sub');else u.repairing=true;
    for(let n=0;n<100;n++)g.weaponsTick(u,.01,false,aim,0);
    ok(sl.ammo===5&&sl.bn===0,'持ち替え・修理で未発射分を中断');
   }
   // 同じ乱数・頭部補正・反動なしで、本体の散弾の射線角を比較する。
   function cone(spec){reset();const sl=u.slots.main;sl.w={...spec,recoil:0,recoilH:0};const begin=g.fx.length,random=Math.random;Math.random=()=>.75;
    try{g.shot(u,sl,aim,0);}finally{Math.random=random;}
    return g.fx.slice(begin).filter(f=>f.kind==='tracer').map(f=>f.end.clone().sub(f.from).normalize().angleTo(aim.clone().sub(f.from).normalize()));
   }
   const oldCone=cone(base),newCone=cone(w);ok(oldCone.length===w.pellets&&newCone.length===w.pellets,'両方で同数の散弾を実射');
   const ratios=newCone.map((a,i)=>a/oldCone[i]);ok(ratios.every(r=>Math.abs(r-1/3)<.005),'実際の射線も約1/3の角度へ収束');
   window.__shotgunReset=reset;return {checks,bursts,held,coneRatios:ratios,weapon:w};
  },baseline.weapons.shotgunQ);
  await p.evaluate(()=>{window.AudioContext=window.__nativeAC;__g.initAudio();});await p.waitForFunction(()=>!!__g.sfxBuf.shotgun);
  const audio=await p.evaluate(async()=>{
   const g=__g,u=g.player;window.__shotgunReset();await g.audio.resume();const starts=[],original=g.audio.createBufferSource.bind(g.audio);
   g.audio.createBufferSource=()=>{const n=original(),start=n.start.bind(n);n.start=(...args)=>{if(n.buffer===g.sfxBuf.shotgun)starts.push(g.audio.currentTime);return start(...args);};return n;};
   const aim=new g.T.Vector3(0,123,-300);
   try{g.weaponsTick(u,.001,true,aim,0);for(let i=0;i<2;i++){await new Promise(r=>setTimeout(r,110));g.weaponsTick(u,.1,false,aim,0);}}finally{g.audio.createBufferSource=original;}
   if(starts.length!==3)throw Error('3発の散弾音を再生 '+JSON.stringify(starts));return {starts,ammo:u.slots.main.ammo};
  });assert.equal(audio.ammo,3);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({changedWeapons:changed,before:baseline.weapons.shotgunQ,...result,audio,errors},null,2)+'\n');
  console.log(JSON.stringify({checks:result.checks,changedWeapons:changed,mag:result.weapon.mag,spread:result.weapon.spread,burstShots:result.weapon.burst,audioShots:audio.starts.length,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
