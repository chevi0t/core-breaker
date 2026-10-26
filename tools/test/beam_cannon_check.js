// 双肩照射砲：継続ダメージ・SP・貫通と遮蔽・旋回・実入力・後片付け。
// node tools/test/beam_cannon_check.js dbg/shoulder-beam /tmp/beam-check
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await browser.newPage({viewport:{width:960,height:720}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});await p.goto('file://'+path.resolve(process.argv[2]||'dbg/shoulder-beam','dbg.html'));
 const result=await p.evaluate(()=>{
  const g=__g,T=g.T;g.selectMap('dock');g.setup();g.running=false;
  const u=g.player,enemies=g.units.filter(q=>q.team!==u.team),e=enemies[0],e2=enemies[1],ally=g.units.find(q=>q!==u&&q.team===u.team),aim=new T.Vector3(0,202.4,-100),checks=[],rates=[];
  const yes=(x,m)=>{if(!x)throw Error(m);checks.push(m);},near=(a,b,eps=1e-5)=>Math.abs(a-b)<eps;
  const cleanup=[];
  function reset(){
   for(const x of cleanup){g.scene.remove(x);g.hittables.splice(g.hittables.indexOf(x),1);x.geometry.dispose();x.material.dispose();}cleanup.length=0;
   for(const q of g.units){q.frozen=true;q.alive=false;q.pos.set(10000,200,10000);q.group.position.copy(q.pos);}
   g.loadout.heavy.sp='beamCannon';Object.assign(u.mech,g.MECH_DEFAULT);g.equip(u,'heavy');
   Object.assign(u,{alive:true,invulT:0,invulCancelOnAttack:false,switchT:0,yaw:0,pitch:0,stun:'',stunT:0,electricT:0,ctrlLockT:0,repairing:false,transfer:null,zip:null,flying:false,onGround:true,dashT:0,longDash:false,lungeT:0,recoverT:0,overheat:false,boost:u.maxBoost,catCd:0});u.pos.set(0,200,0);u.vel.set(0,0,0);u.group.position.copy(u.pos);u.group.rotation.set(0,0,0);
   g.selectWeapon(u,'sp');u.switchT=0;u.slots.sp.supply=1;g.weaponLook(u,.65);
   for(const [i,q]of [e,e2,ally].entries()){
    Object.assign(q,{alive:true,invulT:0,weakT:0,hp:1e7,maxHp:1e7,armorAvg:1,partArmor:{head:1,body:1,arms:1,legs:1},stun:'',stunT:0,repairing:false,barrierOn:false,ctrlLockT:0,electricT:0});q.pos.set(i===2?0:0,200,i===0?-60:i===1?-90:-30);q.group.position.copy(q.pos);q.group.rotation.set(0,0,0);q.vel.set(0,0,0);
   }
   g.scene.updateMatrixWorld(true);g.lock.target=null;g.camera.position.set(12,207,12);g.camera.lookAt(0,202,-40);g.camera.updateMatrixWorld(true);
   for(const k of Object.keys(g.keys))delete g.keys[k];for(const k of Object.keys(g.pressed))delete g.pressed[k];
   return u.slots.sp;
  }
  function frame(dt=1/60,trigger=true,alt=false){g.weaponsTick(u,dt,trigger,aim,0,alt);g.weaponLook(u,dt);g.fxUpdate(dt);}
  function active(){reset();frame(.5);frame(.01);yes(!!u.beamFire&&u.beamFire.elapsed>0,'準備後に照射を開始');}
  yes(g.ARMORY.heavy.sp.includes('beamCannon')&&g.WEAPONS.beamCannon.model==='LI-5','重火力SP一覧に固有の型番で登録');
  yes(g.wStats(g.WEAPONS.beamCannon).some(t=>t.includes('5秒')),'一覧に5秒の照射を表示');
  reset();u.invulT=2;u.invulCancelOnAttack=true;frame(.49);
  yes(e.hp===1e7&&u.slots.sp.heat===100&&u.invulT===2,'準備中は損傷・SP消費・攻撃無敵解除を起こさない');
  frame(.02);yes(u.invulT===0&&u.beamFire.elapsed>0&&u.slots.sp.heat<100,'発射開始で無敵解除とSP消費');
  for(const hz of [30,60,120]){
   reset();const dt=1/hz;let count=0,maxAge=0;
   while(u.weapon==='sp'&&count++<hz*7){frame(dt);maxAge=Math.max(maxAge,u.beamFire?.elapsed||0);}
   yes(count<hz*7&&!u.beamFire&&u.weapon==='main'&&!u.planted,'照射完了で元の武器へ戻る '+hz);
   yes(u.slots.sp.heat===0&&u.slots.sp.overheat,'5秒でSPを割合消費し、使い切る '+hz);
   yes(near(count*dt,5.5,dt+.001),'準備.5秒と照射5秒の時刻 '+hz);
   rates.push({hz,damage:1e7-e.hp,second:1e7-e2.hp,ally:1e7-ally.hp,time:count*dt,maxAge});
  }
  yes(Math.max(...rates.map(r=>r.damage))-Math.min(...rates.map(r=>r.damage))<1,'30/60/120Hzで総損傷差が1未満');
  yes(rates.every(r=>r.damage>70000&&r.second>60000&&r.ally===0),'両肩から敵2体を貫通し、味方を傷つけない');
  reset();for(let i=0;i<90;i++)frame();const hp=e.hp;for(let i=0;i<60;i++)frame();
  yes(near(hp-e.hp,14400,.01),'両肩が接触した1秒は7200×2の継続威力');
  active();frame();const initial=new T.Vector3(0,1,0).applyQuaternion(u.beamVisual.lanes[0].group.quaternion),savedAim=aim.clone();aim.x=100;
  frame();const actualTurn=initial.angleTo(new T.Vector3(0,1,0).applyQuaternion(u.beamVisual.lanes[0].group.quaternion));aim.copy(savedAim);
  yes(actualTurn<=g.WEAPONS.beamCannon.turnRate/60+1e-6,'Botの照準点が急変してもビームは毎秒5度を越えない');
  reset();for(let i=0;i<90;i++)frame();
  const oldX=e.pos.x;e.pos.x=30;for(let i=0;i<12;i++)frame();e.pos.x=oldX;const reenter=e.hp;frame();
  yes(near(reenter-e.hp,240,.01),'再接触で固定ダメージを繰り返さない');
  reset();e.pos.z=-200;e2.alive=false;for(let i=0;i<150;i++)frame();yes(e.hp===1e7,'175mより遠い相手に届かない');
  reset();const wall=new T.Mesh(new T.BoxGeometry(12,12,1),new T.MeshBasicMaterial());wall.position.set(0,202,-20);g.scene.add(wall);g.hittables.push(wall);cleanup.push(wall);wall.updateMatrixWorld(true);for(let i=0;i<120;i++)frame();
  yes(e.hp===1e7&&e2.hp===1e7,'壁の裏へ照射しない');yes(u.beamVisual.lanes.every(v=>v.core.scale.y<25),'描画も壁の手前まで');
  active();e.slots.sp=g.slotOf('barrier');e.barrierOn=true;e.yaw=Math.PI;const shield=e.slots.sp.heat;for(let i=0;i<60;i++)frame();
  yes(e.hp<1e7&&e.slots.sp.heat===shield,'防御膜を消費させずに機体へ貫通');
  ally.pos.x=30;ally.group.position.copy(ally.pos);g.scene.updateMatrixWorld(true);const health=e.hp;g.fire(u,g.targetPoint(e),0,g.WEAPONS.ar,u.pos.clone().add(new T.Vector3(0,2.4,0)));
  yes(e.hp===health&&e.slots.sp.heat<shield,'通常の弾は既存どおりバリアで防ぐ');
  active();g.hud(g.timeLeft,1/60);yes(document.getElementById('ammo').textContent.endsWith('s')&&!document.getElementById('ammoSub').textContent.includes('弾切れ'),'弾数ではなく残り照射秒数を表示');
  const b=u.beamFire;u.yaw+=1;u.pitch+=.5;g.beamCannonTurn(u,1/60);
  yes(Math.abs(u.yaw)<=g.WEAPONS.beamCannon.turnRate/60+1e-8&&Math.abs(u.pitch)<=g.WEAPONS.beamCannon.turnRate/60+1e-8,'大きな視点入力も毎秒5度に制限');
  const boost=u.boost,pos=u.pos.clone();yes(!g.shortDash(u,new T.Vector3(1,0,0)),'構え中に横ダッシュしない');g.physics(u,new T.Vector3(1,0,0),true,true,1/60,true);
  yes(u.pos.x===pos.x&&u.pos.z===pos.z&&u.vel.y<=0&&u.boost===boost,'歩き・ブースト・ジャンプを止める');yes(!g.startTransfer(u,null),'構え中にエリア移動しない');
  active();const partial=u.slots.sp.heat;frame(1/60,true,true);
  yes(!u.beamFire&&u.weapon==='main'&&!u.beamVisual.root.visible&&near(u.slots.sp.heat,partial),'右クリックで中断し残SPを温存');
  g.weaponsTick(u,35,false,aim,0);yes(u.slots.sp.heat===100,'途中中断は35秒基準で回復');
  reset();u.slots.sp.heat=10;let low=0;while(u.weapon==='sp'&&low++<90)frame();yes(near(low/60,1,.02)&&u.slots.sp.overheat,'残SP10%は準備後0.5秒で使い切る');
  g.weaponsTick(u,40,false,aim,0);yes(u.slots.sp.heat===100&&!u.slots.sp.overheat,'使い切りは40秒基準で回復');
  active();g.selectWeapon(u,'sub');yes(!u.beamFire&&!u.beamVisual.root.visible,'持ち替えで照射と描画を止める');
  active();g.jolt(u,e.pos,4000,false);yes(!u.beamFire&&!u.beamVisual.root.visible&&u.stun==='stagger','被弾よろけで照射を中断');
  active();u.electricT=1;frame();yes(!u.beamFire&&!u.beamVisual.root.visible,'電撃でも照射を中断');
  active();g.damage(u,e,1e8,false,false,null,e.pos,false);yes(!u.alive&&!u.beamFire&&!u.beamVisual.root.visible,'大破した瞬間に照射を消す');
  active();g.equip(u,'assault');yes(!u.beamFire&&!u.beamVisual.root.visible,'装備更新で照射を消す');
  reset();const bot=e;g.loadout.heavy.sp='beamCannon';g.equip(bot,'heavy');bot.slots.sp=g.slotOf('beamCannon');bot.slots.sub=g.slotOf('rocket');bot.slots.aux=g.slotOf('weaken');ally.alive=false;Object.assign(bot,{alive:true,isPlayer:false,target:u,onGround:true,stun:'',repairing:false,transfer:null,weapon:'main',actCd:0,yaw:Math.PI});bot.pos.set(0,200,-60);u.pos.set(0,200,0);bot.group.position.copy(bot.pos);g.scene.updateMatrixWorld(true);const act=g.botAct(bot,true,g.cores[u.team]);
  yes(act?.slot==='sp','Botも射線の通った中距離で照射砲を選ぶ');
  active();const root=u.beamVisual.root,shared=u.beamVisual.lanes[0].core.material;let disposed=0;shared.addEventListener('dispose',()=>disposed++);g.selectMap('city');
  yes(!root.parent&&g.beamCannonOwners.size===0&&disposed===0,'マップ変更で個体を外し、共有資源は使い回す');
  window.beamFixture={g,reset,frame,u,aim};return {checks,rates};
 });
 // 実際の4キー・左長押し・マウス・右クリックで入力経路を確認する。
 await p.evaluate(()=>{const {g,reset,u}=beamFixture;g.selectMap('dock');g.setup();beamFixture.u=g.player;g.loadout.heavy.sp='beamCannon';g.equip(g.player,'heavy');g.running=true;document.getElementById('overlay').hidden=true;for(const q of g.units)if(q!==g.player){q.alive=false;q.downT=0;q.respawnT=1e9;}const v=g.player;v.pos.set(0,200,20);v.yaw=v.pitch=0;v.vel.set(0,0,0);v.stun='';v.ctrlLockT=0;v.invulT=0;window.realBeamFrame=()=>{g.playerUpdate(v,1/120);g.weaponLook(v,1/120);for(const k of Object.keys(g.pressed))delete g.pressed[k];};});
 await p.mouse.click(480,360,{button:'right'});await p.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:5000});await p.keyboard.press('Digit4');await p.evaluate(()=>{for(let i=0;i<120;i++)realBeamFrame();});
 assert(await p.evaluate(()=>__g.player.weapon==='sp'&&__g.player.planted));await p.mouse.down();await p.evaluate(()=>{for(let i=0;i<90;i++)realBeamFrame();});assert(await p.evaluate(()=>__g.player.beamFire?.elapsed>0));
 const yaw=await p.evaluate(()=>__g.player.yaw);await p.mouse.move(600,360);await p.evaluate(()=>realBeamFrame());const turned=await p.evaluate(()=>__g.player.yaw);assert(Math.abs(turned-yaw)<=Math.PI/36/120+1e-6);
 await p.keyboard.down('d');await p.keyboard.down('Shift');const x=await p.evaluate(()=>__g.player.pos.x);await p.evaluate(()=>{for(let i=0;i<10;i++)realBeamFrame();});assert.equal(await p.evaluate(()=>__g.player.pos.x),x);await p.keyboard.up('Shift');await p.keyboard.up('d');
 await p.mouse.click(600,360,{button:'right'});await p.evaluate(()=>realBeamFrame());await p.mouse.up();assert(await p.evaluate(()=>!__g.player.beamFire&&__g.player.weapon==='main'&&!__g.player.beamVisual.root.visible));
 assert.deepEqual(errors,[]);const out=path.resolve(process.argv[3]||'/tmp/beam-check');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({...result,realInputs:5,errors},null,2)+'\n');console.log(JSON.stringify({checks:result.checks.length,rates:result.rates,realInputs:5,errors}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
