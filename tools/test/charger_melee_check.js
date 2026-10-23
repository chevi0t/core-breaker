// 加速装置ON中の近接、加速からの慣性、OFF/過熱時と実キー入力を検査する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await page.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await page.goto(pathToFileURL(path.join(path.resolve(process.argv[2]||'dbg'),'dbg.html')).href);
  const result=await page.evaluate(()=>{
   const g=__g,T=g.T,dt=1/120,forward=new T.Vector3(0,0,-1),aim=new T.Vector3(0,202.6,-100);
   g.selectMap('dock');g.setup();document.getElementById('overlay').hidden=true;g.running=false;
   const u=g.player;for(const other of g.units)other.alive=other===u;g.lock.target=null;g.equip(u,'assault');
   const swords=Object.keys(g.WEAPONS).filter(k=>g.WEAPONS[k].type==='sword'),chargers=g.ARMORY.assault.sp.filter(k=>g.WEAPONS[k].type==='charger');
   const ok=(v,m,d)=>{if(!v)throw Error(m+' '+JSON.stringify(d));};let cases=0;
   function reset(key,charger='charger',bot=false){
    u.slots.aux=g.slotOf(key);u.slots.sp=g.slotOf(charger);u.weapon='aux';u.isPlayer=!bot;u.boost=u.maxBoost;u.pos.set(0,200,20);u.vel.set(0,0,0);
    Object.assign(u,{alive:true,switchT:0,stun:'',stunT:0,recoverT:0,ctrlLockT:0,electricT:0,repairing:false,transfer:null,planted:false,
     dashT:0,longDash:false,dashState:'',swing:null,lungeT:0,slideT:0,chargerOn:false,charging:false,onGround:true,flying:false,overheat:false,yaw:0,pitch:0,target:null});
   }
   function attack(strong){
    const sl=u.slots.aux,w=sl.w,charged=!!(w.meleeCharge||w.chargeWave),before=u.vel.clone(),boost=u.boost;
    if(charged)sl.chargeT=w.chargeTime;
    g.weaponsTick(u,dt,!charged,aim,0);
    const expected=strong?w.strong:w.normal;
    ok(u.swing&&u.swing.dashAttack===strong,'起動状態に応じた通常/ダッシュ攻撃',{weapon:w.key,strong});
    ok(u.swing.a.dmg===(w.meleeCharge?(strong?w.strongLevels:w.normalLevels)[2]:expected.dmg),'対応する威力を選ぶ',{weapon:w.key,strong});
    ok(u.swing.a.dashMotion===expected.dashMotion&&u.swing.a.spin===expected.spin&&u.swing.a.time===expected.time,'武器固有のモーションと硬直を選ぶ',{weapon:w.key,strong});
    if(strong)ok(u.vel.distanceTo(before)<1e-9,'加速中の水平・鉛直の勢いを開始時に保持',w.key);
    ok(u.boost===boost,'近接の開始で通常ブーストを追加消費しない',w.key);cases++;
   }
   for(const key of swords)for(const bot of [false,true])for(const moving of [false,true]){
    reset(key,'charger',bot);ok(g.toggleSp(u)&&u.chargerOn,'加速装置を起動する');
    if(moving){for(let i=0;i<24;i++)g.physics(u,forward,true,false,dt);ok(u.charging&&!u.dashT&&!u.longDash,'通常ダッシュを使わずSPで加速する');}
    attack(true);ok(u.chargerOn,'近接開始で加速装置のON状態を維持');
    const sp=u.slots.sp.heat,bound=Math.max(Math.hypot(u.vel.x,u.vel.z),u.lungeSpeed*1.35);
    g.physics(u,forward,true,false,dt);
    ok(u.dashState==='lunge'&&!u.charging&&u.slots.sp.heat===sp,'加速から近接の踏み込みへ切り替える',key);
    ok(Math.hypot(u.vel.x,u.vel.z)<=bound+1e-6,'近接の勢いを加算し直さない',key);
   }
   for(const charger of chargers)for(const bot of [false,true]){
    reset('clawM',charger,bot);ok(g.toggleSp(u),'各型の加速装置を起動');
    for(let i=0;i<24;i++)g.physics(u,forward,true,false,dt);
    ok(u.charging&&u.slots.sp.heat<100,'各型でSP加速が動く',charger);attack(true);
    reset('sword',charger,bot);ok(g.toggleSp(u),'停止中でも起動できる');attack(true);
   }
   for(const bot of [false,true]){
    reset('sword','charger',bot);attack(false);
    reset('sword','charger',bot);g.toggleSp(u);u.slots.sp.cd=0;g.toggleSp(u);attack(false);
    reset('sword','charger',bot);g.toggleSp(u);u.slots.sp.overheat=true;u.slots.sp.heat=0;attack(false);
    reset('sword','charger',bot);g.toggleSp(u);u.boost=0;u.overheat=true;attack(true);
    for(const mode of ['short','long']){reset('sword','charger',bot);if(mode==='short')g.shortDash(u,forward);else u.longDash=true;attack(true);}
   }
   reset('waveSword');g.toggleSp(u);const sl=u.slots.aux;
   for(let t=0;t<sl.w.chargeTime+.05;t+=dt)g.weaponsTick(u,dt,true,aim,0);
   ok(!u.swing,'ON中も光波剣は充填中に勝手に振らない');g.weaponsTick(u,dt,false,aim,0);
   ok(u.swing?.dashAttack&&u.swing.a.dmg===6000,'光波剣の解放はダッシュ威力6000');
   const fired=u.waveFired||0;for(let i=0;i<180;i++)g.swordTick(u,sl,dt,false,aim);
   ok(u.waveFired-fired===1,'満充填の光波を1回だけ放つ');
   return {cases,meleeWeapons:swords.length,chargers:chargers.length};
  });
  // 4キーで起動→Shiftを保持→通常ダッシュ終了後の左クリックを実際の入力で試す。
  for(const key of ['sword','sabre','rod','clawM']){
   await page.evaluate(key=>{const g=__g;g.setup();g.running=true;for(const q of g.units)q.alive=q===g.player;
    const p=g.player;g.loadout.assault.aux=key;g.loadout.assault.sp='charger';g.equip(p,'assault');g.selectWeapon(p,'aux');p.switchT=0;p.pos.set(0,200,20);p.yaw=0;p.pitch=0;
    window.testFrame=()=>{g.playerUpdate(g.player,1/120);for(const k of Object.keys(g.pressed))delete g.pressed[k];};
   },key);
   await page.mouse.click(640,360,{button:'right'});await page.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:5000});
   await page.keyboard.press('4');await page.evaluate(()=>testFrame());
   assert(await page.evaluate(()=>__g.player.chargerOn));
   await page.keyboard.down('w');await page.keyboard.down('Shift');await page.evaluate(()=>{for(let i=0;i<72;i++)testFrame();});
   assert(await page.evaluate(()=>__g.player.charging&&__g.player.dashT<=0&&!__g.player.longDash));
   await page.mouse.down();await page.evaluate(()=>testFrame());
   assert(await page.evaluate(()=>__g.player.swing?.dashAttack),key+'：実入力でダッシュ近接');
   await page.mouse.up();await page.keyboard.up('Shift');await page.keyboard.up('w');await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>!document.pointerLockElement);
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,realInputs:4,errors}));
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({...result,realInputs:4,errors},null,2)+'\n');
  console.log('加速装置ON中の近接・慣性・OFF/過熱・通常ブースト・光波と実入力：成功。');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
