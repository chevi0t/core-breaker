// CDP touch events + actual ray/weapon paths; no device performance claim.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{
 const dir=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
 const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true}),p=await ctx.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.stack));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=undefined;const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,a){return get.call(this,k,k.includes("webgl")?{...a,preserveDrawingBuffer:true}:a)}});await p.goto('file://'+path.join(dir,'dbg.html'));
 // Frozen RAF can leave a stale compositor canvas in headless Chromium: preserve the actual rendered frame as a bitmap under the real DOM UI, only in this test.
 const capture=async name=>{await p.evaluate(()=>{const g=__g;g.scene.updateMatrixWorld(true);g.renderer.render(g.scene,g.camera);let image=document.getElementById('testFrame');if(!image){image=document.createElement('img');image.id='testFrame';image.style='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';document.getElementById('game').appendChild(image);}image.src=g.renderer.domElement.toDataURL();});await p.screenshot({path:path.join(out,name)});};
 const checks=[];const ok=(v,m)=>{assert.ok(v,m);checks.push(m)};
 await p.evaluate(()=>{const g=__g;g.selectMap('dock');document.getElementById('start').click();for(const u of g.units)u.frozen=true;g.touchTick();g.loop(50);g.loop(100);});
 ok(await p.evaluate(()=>__g.TOUCH&&__g.touchPlay),'touch capability detection');
 const cdp=await ctx.newCDPSession(p),active=new Map();
 const send=async(type,id,x,y)=>{if(type==='touchEnd'){const point=active.get(id);active.delete(id);return cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[point]});}active.set(id,{x,y,id});await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[...active.values()]});};
 const down=(id,x,y)=>send('touchStart',id,x,y),move=(id,x,y)=>send('touchMove',id,x,y),up=id=>send('touchEnd',id);
 const tap=async(x,y)=>{await down(9,x,y);await up(9);};
 await tap(500,170);ok(await p.evaluate(()=>!__g.touch.menu),'single tap does not open');
 await tap(502,170);ok(await p.evaluate(()=>__g.touch.menu&&!__g.mouseDown&&!__g.rightDown),'double tap opens without shooting');
 await capture('landscape-cross.png');
 ok(await p.evaluate(()=>[...document.querySelectorAll('#tcWeaponMenu button')].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})),'cross targets large and within viewport');

 const at=async sel=>p.locator(sel).boundingBox().then(r=>[r.x+r.width/2,r.y+r.height/2]);
 await tap(...await at('[data-slot="sub"]'));ok(await p.evaluate(()=>__g.player.weapon==='sub'&&!__g.touch.menu&&!__g.touch.armed),'selection and resume guard');
 await down(2,500,170);await move(2,530,170);await up(2);ok(await p.evaluate(()=>__g.touch.armed&&!__g.touch.menu),'drag arms without opening menu');
 await down(1,130,270);await move(1,130,220);await down(2,500,170);await move(2,540,170);const boost=await at('[data-tc="dash"]');await down(3,...boost);
 ok(await p.evaluate(()=>__g.touch.ptr.size===3&&__g.touch.fwd>0&&__g.keys.ShiftLeft),'three contacts movement aim boost');
 await up(2);ok(await p.evaluate(()=>__g.touch.fwd>0&&__g.keys.ShiftLeft),'aim release preserves other contacts');await up(3);await up(1);
 await down(2,500,160);await down(3,550,160);await move(2,490,160);await move(3,560,160);await up(2);await up(3);ok(await p.evaluate(()=>!__g.touch.menu&&!__g.touch.tap),'pinch/multiple look contacts do not doubletap');
 await tap(500,170);await tap(500,170);await tap(...await at('[data-close]'));ok(await p.evaluate(()=>!__g.touch.menu&&!__g.touch.armed),'explicit cancel guards autoresume');
 await tap(500,170);await tap(500,170);await p.evaluate(()=>dispatchEvent(new Event('blur')));ok(await p.evaluate(()=>!__g.touch.menu&&!__g.touch.ptr.size&&!__g.touch.armed),'blur clears');
 await down(2,500,170);await move(2,530,170);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});active.clear();await p.waitForFunction(()=>!__g.touch.armed&&!__g.touch.ptr.size);ok(await p.evaluate(()=>!__g.touch.armed&&!__g.touch.ptr.size),'pointercancel clears gestures');
 await p.evaluate(()=>{__g.gameOptions.touchAuto=0;__g.touchTick()});await down(4,...await at('[data-tc="fire"]'));ok(await p.evaluate(()=>__g.mouseDown),'manual mode retains fire');
 await tap(500,170);await tap(500,170);ok(await p.evaluate(()=>__g.touch.menu&&!__g.mouseDown),'opening menu releases held manual fire');await up(4);await tap(...await at('[data-close]'));
 await p.evaluate(()=>{__g.gameOptions.touchAuto=1;__g.touchTick()});
 await tap(500,170);await tap(500,170);await p.evaluate(()=>dispatchEvent(new Event('orientationchange')));ok(await p.evaluate(()=>!__g.touch.menu&&!__g.touch.armed),'orientation change clears');
 const prior=await p.evaluate(()=>__g.player.weapon);await tap(...await at('[data-tc="weapon"]'));ok(await p.evaluate(k=>__g.touch.menu&&__g.player.weapon===k&&!__g.wsel.open,prior),'fallback weapon button opens without cycling');await tap(...await at('[data-close]'));
 const combat=await p.evaluate(()=>{
  const g=__g,T=g.T,u=g.player,e=g.units.find(v=>v.team!==u.team),res=[];
  function check(v,m){if(!v)throw Error(m);res.push(m)}
  g.selectWeapon(u,'main');u.switchT=0;Object.assign(u,{yaw:0,pitch:0,recoil:0,recoilYaw:0,alive:true,downT:0,stun:'',electricT:0,repairing:false,transfer:null});u.pos.set(0,200,0);u.group.position.copy(u.pos);u.group.rotation.set(0,0,0);
  Object.assign(e,{alive:true,downT:0,cloak:false});e.pos.set(0,200,-20);e.group.position.copy(e.pos);g.weaponLook(u,0);g.weaponLook(e,0);g.scene.updateMatrixWorld(true);g.touch.armed=true;g.touch.tap=null;
  const aim=g.targetPoint(e),from=aim.clone().setZ(5),dir=aim.clone().sub(from).normalize();g.camera.position.copy(from);g.camera.lookAt(aim);g.camera.updateMatrixWorld(true);
  const hit=()=>g.castFrom(from,dir,u);const auto=()=>g.touchAutoTrigger(u,hit(),aim);
  check(hit()?.ref===e,'actual center ray hits enemy');check(auto(),'valid enemy autofire');
  const ammo=u.slots.main.ammo;g.weaponsTick(u,.05,auto(),aim,0);check(u.slots.main.ammo<ammo,'actual gun fired');
  check(!g.touchAutoTrigger(u,null,aim),'reticle exit stops');
  check(!g.touchAutoTrigger(u,{ref:{alive:true,pos:aim},point:aim},aim),'neutral object excluded');
  const e2=g.units.find(v=>v.team!==u.team&&v!==e);e2.alive=true;e2.cloak=false;e2.downT=0;e2.pos.set(5,200,-20);e2.group.position.copy(e2.pos);g.scene.updateMatrixWorld(true);const aim2=g.targetPoint(e2);g.camera.lookAt(aim2);g.camera.updateMatrixWorld(true);const hit2=g.castFrom(from,aim2.clone().sub(from).normalize(),u);check(hit2?.ref===e2&&g.touchAutoTrigger(u,hit2,aim2)&&g.lock.target===e2,'actual reticle switches enemy lock');g.camera.lookAt(aim);g.camera.updateMatrixWorld(true);

  const team=e.team;e.team=u.team;check(!auto(),'friendly never fires');e.team=team;
  e.alive=false;check(!auto(),'dead target never fires');e.alive=true;
  const wall=new T.Mesh(new T.BoxGeometry(20,20,1),new T.MeshBasicMaterial());wall.position.set(0,202,-10);g.scene.add(wall);g.hittables.push(wall);wall.updateMatrixWorld(true);check(!auto(),'LOS wall stops');g.hittables.splice(g.hittables.indexOf(wall),1);g.scene.remove(wall);
  const semi=Object.keys(g.WEAPONS).find(k=>g.WEAPONS[k].type==='gun'&&g.WEAPONS[k].semi&&!g.WEAPONS[k].chargeTime&&!g.WEAPONS[k].missile);
  u.weapon='main';u.slots.main=g.slotOf(semi);const count=u.slots.main.ammo;
  for(let i=0;i<60;i++)g.weaponsTick(u,1/60,auto(),aim,0);
  const used=count-u.slots.main.ammo;check(used>1&&used<=Math.ceil(u.slots.main.w.rpm/60)+1,'semi auto respects existing cadence');
  u.slots.main.ammo=0;u.slots.main.reserve=0;g.weaponsTick(u,.05,auto(),aim,0);check(u.slots.main.ammo===0,'empty ammo cannot fire');
  u.slots.sub=g.slotOf('grenade');u.weapon='sub';u.switchT=0;check(auto(),'equipped explosive included');
  u.slots.sp=g.slotOf('charger');u.weapon='sp';check(!auto(),'activation device remains manual');
  u.weapon='main';const charge=Object.keys(g.WEAPONS).find(k=>g.WEAPONS[k].type==='gun'&&g.WEAPONS[k].chargeTime);u.slots.main=g.slotOf(charge);check(auto(),'charged gun starts');u.slots.main.chargeT=u.slots.main.w.chargeTime;check(!auto(),'full charge releases on valid target');u.slots.main.chargeT=.3;g.touchAutoTrigger(u,null,aim);check(u.slots.main.chargeT===0,'lost target cancels charge without shot');
  u.slots.aux=g.slotOf('sword');u.weapon='aux';u.dashT=0;u.longDash=false;u.chargerOn=false;e.pos.set(0,200,-3);e.group.position.copy(e.pos);g.scene.updateMatrixWorld(true);check(!!g.touchMeleeTarget(u,g.targetPoint(e)),'melee range arc');e.pos.z=-30;e.group.position.copy(e.pos);g.scene.updateMatrixWorld(true);check(!g.touchMeleeTarget(u,g.targetPoint(e)),'melee distant excluded');e.pos.z=3;e.group.position.copy(e.pos);g.scene.updateMatrixWorld(true);check(!g.touchMeleeTarget(u,g.targetPoint(e)),'melee behind excluded');
  e.pos.z=-3;e.group.position.copy(e.pos);g.scene.updateMatrixWorld(true);u.slots.aux.cd=0;const meleeAim=g.targetPoint(e);
  const start=g.touchAutoTrigger(u,null,meleeAim);check(start,'melee auto trigger in range');g.weaponsTick(u,.016,start,meleeAim,0);check(!!u.swing,'actual melee starts');const swing=u.swing;g.weaponsTick(u,.016,true,meleeAim,0);check(u.swing===swing&&u.slots.aux.cd>0,'existing melee cooldown preserved');
  u.swing=null;g.gameOptions.touchAuto=0;check(!g.touchAutoTrigger(u,null,meleeAim),'manual option disables auto');g.gameOptions.touchAuto=1;

  g.touchMenuOpen();check(!g.touchAutoTrigger(u,null,aim),'menu blocks all auto');u.alive=false;g.touchTick();check(!g.touch.menu&&!g.touch.armed,'death clears');
  return res;
 });checks.push(...combat);
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>__g.touchTick());await p.screenshot({path:path.join(out,'portrait.png')});ok(await p.locator('#touchRotate').isVisible(),'portrait rotation guard');
 await p.setViewportSize({width:844,height:390});await p.evaluate(()=>{__g.spawn(__g.player);__g.touchTick();__g.updateCamera(__g.player,0);__g.scene.updateMatrixWorld(true);__g.renderer.render(__g.scene,__g.camera)});await capture('landscape-play.png');
 ok(errors.length===0,'no browser errors: '+errors.join('\n'));
 const pc=await b.newContext({viewport:{width:844,height:390},hasTouch:false}),q=await pc.newPage();await q.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=undefined;const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,a){return get.call(this,k,k.includes("webgl")?{...a,preserveDrawingBuffer:true}:a)}});await q.route('https://**/*',r=>r.fulfill({body:''}));await q.goto('file://'+path.join(dir,'dbg.html'));ok(await q.evaluate(()=>!__g.TOUCH&&!__g.touchAutoTrigger({},null,null)),'desktop bypasses touch auto even narrow viewport');
 ok(await q.evaluate(()=>{const g=__g;g.selectMap('dock');document.getElementById('start').click();const u=g.player;u.switchT=0;const sl=u.slots[u.weapon],n=sl.ammo;document.getElementById('view').dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));g.playerUpdate(u,.05);const fired=sl.ammo<n;dispatchEvent(new MouseEvent('mouseup',{button:0}));return fired&&!g.mouseDown}),'desktop mouse still fires and releases');
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,errors},null,2));console.log(checks.join('\n'));console.log('PASS '+checks.length);
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
