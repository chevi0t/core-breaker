// node tools/test/action_crouch_check.js dbg result.json
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.fulfill({body:''}));
 await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
 await page.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
 const checks=await page.evaluate(()=>{
 const g=__g;g.selectMap('dock');g.setup();g.running=true;const u=g.player,T=g.T,checks=[],ok=(name,pass)=>checks.push({name,pass:!!pass});
 const oldObs=g.obstacles.slice();g.obstacles.length=0;
 function reset(){g.spawn(u);Object.assign(u,{alive:true,downT:0,electricT:0,recoverT:0,invulT:0,onGround:true,actionHeld:false,crouching:false,actionId:'crouch',slideT:0});u.pos.set(0,g.groundAt(0,0,100),0);u.vel.set(0,0,0);for(const k in g.keys)g.keys[k]=false;for(const k in g.pressed)g.pressed[k]=false;}
 const key=(code,down)=>dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}));
 reset();for(const code of ['KeyC','ControlLeft']){key(code,true);g.playerUpdate(u,1/60);ok(code+'保持',u.crouching);key(code,false);g.playerUpdate(u,1/60);ok(code+'解放',!u.crouching);}
 key('KeyC',true);key('ControlLeft',true);key('KeyC',false);g.playerUpdate(u,1/60);ok('片方を離しても他方の保持有効',u.crouching);key('ControlLeft',false);
 reset();key('ControlRight',true);g.playerUpdate(u,1/60);ok('右Ctrlは未割当',!u.crouching);
 reset();key('KeyC',true);g.playerUpdate(u,1/60);dispatchEvent(new Event('blur'));ok('フォーカス喪失で解除',!u.crouching&&!g.keys.KeyC);
 const input=document.createElement('input');document.body.append(input);input.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC',bubbles:true}));ok('入力欄のCを無視',!g.keys.KeyC);input.remove();
 for(const state of [{stun:'land'},{repairing:true},{transfer:{}},{flying:true},{zip:{}},{downT:2},{alive:false},{swing:{}},{lungeT:.2}]){reset();Object.assign(u,state);g.actionUpdate(u,true,false,false);ok('行動不可 '+Object.keys(state)[0],!u.crouching);}
 reset();g.actionUpdate(u,true,true,false);ok('ブースト優先',!u.crouching);g.actionUpdate(u,true,false,true);ok('ジャンプ優先',!u.crouching);
 function move(held){reset();u.actionHeld=held;for(let i=0;i<60;i++)g.physics(u,new T.Vector3(1,0,0),false,false,1/60);return u.pos.x;}
 const normal=move(false),slow=move(true);ok('二脚しゃがみ歩行は低速',slow>0&&slow<normal*.5);
 reset();g.mechPose(u,1);const head=u.rig.bones.head.node.getWorldPosition(new T.Vector3()).y,eye=g.cameraPivot(u).y,spread=g.movementSpread(u);
 u.actionHeld=true;g.physics(u,new T.Vector3(),false,false,1/60);g.mechPose(u,1);
 ok('頭と視点が約0.6m下がる',Math.abs(head-u.rig.bones.head.node.getWorldPosition(new T.Vector3()).y-.6)<.02&&Math.abs(eye-g.cameraPivot(u).y-.6)<.02);
 ok('精度強化なし',g.movementSpread(u)===spread);
 u.group.updateMatrixWorld(true);const mesh=u.rig.meshes.find(m=>m.mesh.userData.armorSlot==='head').mesh;
 const center=new T.Box3().setFromBufferAttribute(mesh.userData.hitGeometry.attributes.position).getCenter(new T.Vector3()).applyMatrix4(mesh.matrixWorld);
 const ray=new T.Raycaster(center.clone().add(new T.Vector3(0,0,8)),new T.Vector3(0,0,-1));
 ok('しゃがみ頭部へ実被弾判定',ray.intersectObject(mesh,false).length>0);
 const slot=u.slots.main;u.weapon='main';u.switchT=0;slot.cd=0;const ammo=slot.ammo;
 g.weaponsTick(u,.1,true,u.pos.clone().add(new T.Vector3(0,2,-30)),1,false);ok('しゃがみ中も発砲',slot.ammo<ammo);
 g.spawn(u);ok('再出撃リセット',!u.actionHeld&&!u.crouching);
 reset();u.mech={...g.MECH_DEFAULT,legs:'anchor'};g.equip(u,'heavy');u.onGround=true;u.actionHeld=true;u.vel.set(4,0,0);g.physics(u,new T.Vector3(1,0,0),false,false,1/60);ok('ホバーしゃがみ移動停止',u.vel.x===0&&u.vel.z===0&&!g.hoverActive(u));
 const oldWater=g.waters.slice();g.waters.splice(0,g.waters.length,[-100,-100,100,100,30]);u.pos.set(0,30,0);u.vel.set(0,0,0);u.onGround=true;u.actionHeld=true;
 for(let i=0;i<60;i++)g.physics(u,new T.Vector3(),false,false,1/60);
 ok('水上しゃがみで沈む',u.pos.y<29&&!g.hoverActive(u));u.actionHeld=false;g.physics(u,new T.Vector3(),false,false,1/60);ok('解放で浮上機能復帰',g.hoverActive(u));
 g.waters.splice(0,g.waters.length,...oldWater);g.obstacles.push(...oldObs);return checks;
 });
 fs.writeFileSync(process.argv[3],JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,failed:checks.filter(x=>!x.pass),errors}));assert(!errors.length&&checks.every(x=>x.pass));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
