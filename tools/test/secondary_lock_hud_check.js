// 副武器の自由照準と、ミサイルの誘導状態/実際の発射数をHUDまで通して確認する。
// node tools/test/secondary_lock_hud_check.js dbg/stable-camera [結果フォルダ]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});await p.goto('file://'+path.resolve(process.argv[2]||'dbg/stable-camera','dbg.html'));
 const result=await p.evaluate(()=>{
  const g=__g,T=g.T,checks=[],samples=[],yes=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg);};g.selectMap('dock');document.getElementById('start').click();g.running=true;
  const render=g.renderer.render.bind(g.renderer);g.renderer.render=()=>g.scene.updateMatrixWorld(true);const u=g.player,e=g.units.find(q=>q.team!==u.team);g.obstacles.push({minX:-80,maxX:80,minZ:-80,maxZ:80,top:120});
  function sync(){for(const q of [u,e]){q.group.position.copy(q.pos);q.group.rotation.set(0,q.yaw,0);q.group.visible=q.alive;g.weaponLook(q,0);}g.scene.updateMatrixWorld(true);}
  function reset(cls='assault',key='missile'){
   for(const q of g.units){q.alive=false;q.frozen=true;q.group.visible=false;}for(const q of g.turrets)q.alive=false;
   for(const sh of g.shells)g.scene.remove(sh.mesh);g.shells.length=0;g.equip(u,cls);u.slots.sub=g.slotOf(key);
   Object.assign(u,{alive:true,isPlayer:true,weapon:'main',invulT:0,switchT:0,stun:'',repairing:false,transfer:null,onGround:true,yaw:0,pitch:0,jamT:0,electricT:0,scoped:false,lockRange:70});u.pos.set(0,120,0);u.vel.set(0,0,0);
   Object.assign(e,{alive:true,invulT:0,downT:0,cloak:false,cloakT:0,stun:'',hp:1e6,maxHp:1e6});e.pos.set(0,120,-30);e.vel.set(0,0,0);
   for(let i=0;i<6;i++){const pv=u.pos.clone().add(new T.Vector3(2.2*Math.cos(u.yaw),4.6,-2.2*Math.sin(u.yaw))),d=g.targetPoint(e).sub(pv);u.yaw=Math.atan2(-d.x,-d.z);u.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));}
   Object.assign(g.lock,{target:null,cand:null,acqT:0,visible:false,prevAng:null});g.camera.fov=70;sync();g.updateCamera(u,1);return u.slots.sub;
  }
  function frame(){sync();g.playerUpdate(u,.01);g.updateCamera(u,.01);}
  function display(){g.hud(g.timeLeft,.01);return document.getElementById('missileHud').getAttribute('aria-label');}
  reset();for(let i=0;i<30;i++)frame();yes(g.lock.target===e,'主武器の通常ロックは引き続き取得できる');
  for(const [cls,c]of Object.entries(g.ARMORY))for(const key of c.sub){reset(cls,key);g.lock.target=e;g.lock.visible=true;g.selectWeapon(u,'sub');yes(!g.lock.target,key+'：副武器への持ち替えで通常ロックを即解除');u.switchT=0;for(let i=0;i<30;i++)frame();display();yes(!g.lock.target&&!g.lock.cand&&document.getElementById('lockRing').style.visibility==='hidden'&&document.getElementById('lockMark').hidden,key+'：副武器は通常の捕捉/追従マークを出さない');}
  const keys=Object.keys(g.WEAPONS).filter(k=>g.WEAPONS[k].missile);
  for(const key of keys){const cls=Object.keys(g.ARMORY).find(c=>g.ARMORY[c].sub.includes(key)),sl=reset(cls,key),M=sl.w.missile;g.selectWeapon(u,'sub');u.switchT=0;
   let text=display();yes(text.includes('直進射撃')&&text.includes(`発射 ${Math.min(M.shots,sl.ammo)}発`),key+'：未捕捉の直進モードと一組の弾数');
   const tick=(trigger=false,alt=false)=>{g.weaponsTick(u,.01,trigger,g.targetPoint(e),0,alt);sync();};
   for(let n=0;n<Math.floor(M.time*50);n++)tick();text=display();yes(text.includes('捕捉中')&&!sl.missileLocks.length,key+'：完了前は捕捉中と明示');
   for(let n=0;n<Math.ceil(M.time*M.locks*100)+2;n++)tick();const planned=Math.min(sl.ammo,sl.missileLocks.length*M.shots);text=display();yes(sl.missileLocks.length===Math.min(M.locks,Math.floor(sl.ammo/M.shots))&&text.includes('誘導ロック完了')&&text.includes(`発射 ${planned}発`),key+'：重ね掛けを含めた誘導発射総数');
   const launchText=text,ammo=sl.ammo;tick(true);let frames=0,queued=false;while(sl.bn>0&&frames++<300){text=display();yes(text.includes('誘導弾 連射中')&&text.includes(`残り ${sl.bn}発`)&&g.shells.length+sl.bn===planned,key+'：連射中の残数が実際の発射待ちと一致 '+frames);queued=true;tick();}
   yes(queued&&sl.bn===0&&g.shells.length===planned&&ammo-sl.ammo===planned&&g.shells.every(sh=>sh.missileTarget?.target===e),key+'：表示した数だけ実際に誘導弾を射出');samples.push({key,planned,launchText});
   g.clearMissileLocks(sl);sl.bn=0;sl.missileQueue=[];sl.reloadT=sl.cd=0;sl.held=false;sl.ammo=Math.max(1,M.shots-1);for(let n=0;n<Math.ceil(M.time*100)+2;n++)tick();text=display();yes((M.shots===1||!sl.missileLocks.length)&&text.includes(`発射 ${Math.min(M.shots,sl.ammo)}発`),key+'：半端な残弾で発射数を過大表示しない');
   sl.ammo=0;sl.reloadT=0;yes(display().includes('弾切れ・発射不可'),key+'：弾切れ時は発射不可');sl.reloadT=2;yes(display().includes('再装填中・発射不可'),key+'：装填中も発射不可');sl.reloadT=0;sl.ammo=sl.w.mag;u.jamT=1;tick();yes(display().includes('誘導妨害中・誘導不可')&&!sl.missileLocks.length,key+'：妨害中は捕捉を失う');u.jamT=0;
   g.selectWeapon(u,'main');display();yes(document.getElementById('missileHud').hidden&&!sl.missileLocks.length,key+'：持ち替えで専用照準と捕捉を消す');
  }
  // 画面内の別々の敵へ割り振ったロックも、合計は実際の射出予定数。
  const sl=reset('heavy','mlrs');g.selectWeapon(u,'sub');u.switchT=0;const e2=g.units.find(q=>q.team!==u.team&&q!==e);Object.assign(e2,{alive:true,downT:0,cloak:false});e2.pos.set(3,120,-30);e2.group.position.copy(e2.pos);e2.group.visible=true;g.scene.updateMatrixWorld(true);
  sl.missileLocks=[{target:e,life:e.lifeId||0},{target:e2,life:e2.lifeId||0}];yes(display().includes('発射 4発'),'複数対象へ割り振ったミサイル数を合算');g.weaponsTick(u,.01,false,g.targetPoint(e),0,true);yes(display().includes('直進射撃')&&!sl.missileLocks.length,'右クリック解除は直進表示へ戻る');
  // Botも非ミサイルの副武器では被ロック警告を出さず、通常の射撃判断はできる。
  reset();g.equip(e,'heavy');e.weapon='sub';e.slots.sub=g.slotOf('rocket');e.target=u;e.aimTarget=u;e.aimPos.copy(g.targetPoint(u));e.aimPrev.copy(e.aimPos);e.reacq=0;e.jamT=0;e.alive=true;
  yes(g.trackAim(e,.01,e.pos.clone().add(new T.Vector3(0,2.8,0)))&&!e.locked,'Botの副武器は手動照準相当の射撃を保って通常ロックしない');g.lockWarning(u,.01);yes(document.getElementById('lockDirections').hidden,'ロケットを構える敵からの通常ロック警告は出さない');
  e.weapon='main';g.trackAim(e,.01,e.pos.clone().add(new T.Vector3(0,2.8,0)));g.lockWarning(u,.01);yes(e.locked&&!document.getElementById('lockDirections').hidden,'同じBotが主武器でロックすると警告する');
  g.renderer.render=render;return{passed:checks.length,checks,samples,secondary:Object.values(g.ARMORY).reduce((n,c)=>n+c.sub.length,0),missiles:keys.length};
 });assert.deepEqual(errors,[]);const out=path.resolve(process.argv[3]||'dbg/stable-camera/secondary-results');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(result,null,2));console.log(`副武器 ${result.secondary}種・ミサイル ${result.missiles}種のHUD/射出確認 ${result.passed}項目：成功。ブラウザエラー0`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
