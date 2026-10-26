// 専用ダッシュ技：実入力・各段の実損傷・腕/刃/体の軌道・元の寸法への復帰。
// node tools/test/unique_melee_dash_check.js dbg/unique-melee-dash [結果JSON] [変更前dbg]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;localStorage.setItem('coreBreakerBgm','off');localStorage.setItem('coreBreakerVoice','off');});
  let before=null;
  if(process.argv[4]){await page.goto('file://'+path.resolve(process.argv[4],'dbg.html'));before=await page.evaluate(()=>__g.WEAPONS);}
  await page.goto('file://'+path.resolve(process.argv[2]||'dbg/unique-melee-dash','dbg.html'));
  const result=await page.evaluate(before=>{
   const g=__g,T=g.T,checks=[],yes=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
   g.selectMap('dock');document.getElementById('start').click();g.running=false;g.renderer.render=()=>g.scene.updateMatrixWorld(true);
   const u=g.player,e=g.units.find(q=>q.team!==u.team),keys=Object.keys(g.WEAPONS).filter(k=>/^(sabre|rod|claw)/.test(k)),damage={};
   for(const q of g.units){q.frozen=true;q.alive=false;q.pos.set(1000,100,1000);}for(const t of g.turrets)t.alive=false;
   const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
   if(before)for(const [key,w]of Object.entries(g.WEAPONS)){
    const old=before[key];
    if(!keys.includes(key)){yes(equal(w,old),key+' 他系統の性能・形の指定を維持');continue;}
    yes(equal(w.normal,old.normal),key+' 通常攻撃の全数値を維持');
    yes(w.strong.dmg===({sabre:12000,sabreH:18000,sabreM:20000}[key]||old.strong.dmg)&&w.kg===old.kg&&w.strong.lunge===old.strong.lunge,key+' 日本刀は4段の威力、他は総威力と重量・踏み込み距離を維持');
   }
   const sync=()=>{for(const q of [u,e]){q.group.position.copy(q.pos);q.group.rotation.set(0,q.yaw,0);g.weaponLook(q,1/120);}g.scene.updateMatrixWorld(true);};
   function reset(key,strong=true){
    g.loadout.assault.aux=key;g.equip(u,'assault');g.selectWeapon(u,'aux');
    for(const q of [u,e]){Object.assign(q,{alive:true,hp:1e6,maxHp:1e6,invulT:0,weakT:0,downT:0,stun:'',stunT:0,electricT:0,ctrlLockT:0,repairing:false,transfer:null,yaw:0,pitch:0,swing:null,lungeT:0,recoverT:0,slideT:0,dashT:0,longDash:false});q.armorAvg=1;q.partArmor={head:1,body:1,arms:1,legs:1};q.vel.set(0,0,0);}
    Object.assign(u,{isPlayer:true,switchT:0,dashT:strong?.2:0});u.pos.set(-50,100,-48);e.pos.copy(u.pos).z-=3;g.lock.target=null;sync();return u.slots.aux;
   }
   const aim=()=>u.pos.clone().add(new T.Vector3(0,2.4,-100));
   for(const key of keys){
    const w=g.WEAPONS[key];
    for(const kind of ['normal','burst','cruise']){
     const sl=reset(key,kind==='burst');g.hud(300,.016);yes(document.getElementById('ammoSub').textContent.includes(w.strong.dashName),key+' 専用技の操作説明をHUDに表示');u.longDash=kind==='cruise';g.swordTick(u,sl,1/120,true,aim());
     const a=u.swing.a;yes(a===(kind==='normal'?w.normal:w.strong),key+'/'+kind+' 操作状態で正しい攻撃を発動');
     const stages=[];let previous=e.hp;
     for(let n=0;u.swing&&n<400;n++){
      g.swordTick(u,sl,1/120,false,aim());sync();
      if(e.hp!==previous){stages.push({t:n/120,damage:previous-e.hp});previous=e.hp;}
     }
     yes(Math.abs(1e6-e.hp-a.dmg)<1e-6,key+'/'+kind+' 各段の実損傷合計 '+(1e6-e.hp));
     if(kind!=='normal'){
      const groups=stages.filter((s,i)=>i===0||s.t-stages[i-1].t>.08);
      yes(groups.length===(key==='clawM'||key.startsWith('rod')?3:key.startsWith('sabre')?4:2),key+' 各系統の連撃が重複しない '+JSON.stringify(stages));damage[key]=stages;
      for(const b of [u.blade,u.blade2])if(b?.visible)yes(b.scale.x===1&&b.scale.z===1,key+' 終了後は刃を元の寸法へ戻す');
     }
    }
   }
   function sample(key,t){
    reset(key);g.swordTick(u,u.slots.aux,1/120,true,aim());u.swing.t=t;sync();
    const a=u.swing.a,R=u.blade,L=u.blade2;
    const localHandError=(side,b)=>u.rig.bones['hand'+side].node.getWorldPosition(new T.Vector3()).distanceTo(b.userData.grip);
    yes(localHandError('R',R)<.025,key+'/'+t+' 右手が柄を握る');
    if(L?.visible)yes(localHandError('L',L)<.025,key+'/'+t+' 左手が柄を握る');
    return {body:u.group.rotation.y,right:R.rotation.y,left:L?.rotation.y,scale:R.scale.toArray(),leftGrip:L?.userData.grip.toArray(),a};
   }
   const idle=sample('rod',0),first=sample('rod',.19),second=sample('rod',.42),spin=sample('rod',.68);
   yes(first.right<idle.right-.1,'双短刀：右手が最初に右へ薙ぐ');
   yes(Math.abs(first.left-idle.left)<.01,'双短刀：初段では左手を振らない');
   yes(second.right>first.right&&second.left>first.left,'双短刀：第2段は両手で左へ薙ぐ');
   yes(Math.abs(first.body)<.001&&Math.abs(second.body)<.001&&spin.body>Math.PI,'双短刀：最後の段だけ体ごと回る');
   for(const key of ['sabre','claw'])for(const t of [.05,.2,.3,.4,.6])yes(Math.abs(sample(key,t).body)<.001,key+' ソードの回転技を使わない');
   sample('claw',.25);yes(u.blade.userData.laserBlade?.visible&&u.blade.userData.laserBlade.userData.length>4,'双爪：本体を巨大化せず独立したレーザー刃が伸びる');
   reset('sabre');sync();
   const left=u.rig.bones.handL.node.getWorldPosition(new T.Vector3()),grip=u.blade.userData.grip;
   yes(Math.abs(left.distanceTo(grip)-.38)<.025,'日本刀：左手も柄尻を握る刀の構え');
   // 持ち替えで巨大化と回転を残さない。
   for(const key of ['sabre','rod','claw']){
    reset(key);g.swordTick(u,u.slots.aux,1/120,true,aim());u.swing.t=.3;sync();g.selectWeapon(u,'main');
    yes(u.weapon==='aux'&&u.swing,key+' 攻撃中は持ち替えず最後まで出す');
    g.damage(u,e,10000,false,true);sync();
    yes(!u.swing&&u.blade.scale.x===1&&u.blade.scale.z===1,key+' 被弾中断で元の寸法へ戻す');
    g.selectWeapon(u,'main');sync();
    yes(!u.swing&&u.blade.scale.x<=1&&u.blade.scale.z<=1,key+' 持ち替えで構えと寸法を戻す');
   }
   return {passed:checks.length,weapons:keys.length,damage,checks};
  },before);
  // 実際のShift+W→左クリックでも専用ダッシュ技が選ばれる。
  for(const key of ['sabre','rod','claw']){
   await page.evaluate(key=>{const g=__g,u=g.player;g.running=true;g.equip(u,'assault');u.slots.aux=g.slotOf(key);g.selectWeapon(u,'aux');Object.assign(u,{switchT:0,stun:'',stunT:0,recoverT:0,ctrlLockT:0,electricT:0,repairing:false,transfer:null,dashT:0,longDash:false,lungeT:0,yaw:0,pitch:0,onGround:true});u.pos.set(-50,g.terrainH(-50,-48),-48);u.vel.set(0,0,0);},key);
   await page.mouse.click(640,360,{button:'right'});await page.waitForFunction(()=>!!document.pointerLockElement);
   await page.keyboard.down('w');await page.keyboard.down('Shift');await page.evaluate(()=>__g.playerUpdate(__g.player,.016));
   assert.ok(await page.evaluate(()=>__g.player.dashT>0));
   await page.mouse.down();await page.evaluate(()=>__g.playerUpdate(__g.player,.016));
   assert.equal(await page.evaluate(()=>__g.player.swing?.a.dashMotion),key,key+' 実キー入力');
   await page.mouse.up();await page.keyboard.up('Shift');await page.keyboard.up('w');await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>!document.pointerLockElement);
  }
  assert.deepEqual(errors,[]);if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,checks:undefined},null,2));console.log('専用ダッシュ技 '+result.passed+'項目＋3系統の実入力：成功。ブラウザエラーなし');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
