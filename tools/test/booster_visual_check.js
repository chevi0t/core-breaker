// 噴流の描画・実移動との同期・迷彩・被弾面・共有資源を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const dir=path.resolve(process.argv[2]||'dbg/boost'),out=path.resolve(process.argv[3]||path.join(dir,'results'));
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  fs.mkdirSync(out,{recursive:true});const p=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;});
  await p.goto('file://'+path.join(dir,'dbg.html'));
  const result=await p.evaluate(()=>{
   const g=__g,T=g.T,checks=[],yes=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
   g.selectMap('dock');document.getElementById('start').click();g.running=true;
   const u=g.player,e=g.units.find(v=>v.team!==u.team),geo=u.flame.geometry;
   for(const v of g.units)v.frozen=true;
   const reset=()=>{g.spawn(u);Object.assign(u,{invulT:0,onGround:true,stun:'',downT:0,charging:false,chargerOn:false,boost:100,overheat:false,zip:null,transfer:null,repairing:false,recoverT:0,yaw:0,pitch:0});u.pos.set(0,200,0);u.vel.set(0,0,0);u.group.position.copy(u.pos);g.weaponLook(u,0);g.camera.position.set(8,205,12);g.camera.lookAt(0,202,2);};
   reset();
   const state=()=>JSON.stringify([u.pos.toArray(),u.vel.toArray(),u.boost,u.hp,u.yaw,u.pitch,u.recoil,u.slots,g.camera.quaternion.toArray()],(k,v)=>k==='missileLocks'?null:v);
   u.dashState='short';u.dashT=.24;const before=state(),random=Math.random;let consumed=0;
   try{Math.random=()=>{consumed++;return .5;};for(let i=0;i<10;i++)g.boosterFlameUpdate(u,.01);}finally{Math.random=random;}
   yes(consumed===0&&state()===before,'演出更新が戦闘乱数・移動・消費・耐久・照準・カメラを変えない');
   yes(u.flame.visible&&u.flame.material.uniforms.power.value>.9,'短い噴射が立ち上がる');
   yes(g.units.every(v=>v.flame.geometry===geo),'全機で噴流の形状を共有する');
   yes(g.units.every(v=>!g.hittables.includes(v.flame)),'噴流を被弾面へ追加しない');
   const ray=new T.Raycaster(new T.Vector3(0,202,10),new T.Vector3(0,0,-1));
   yes(ray.intersectObject(u.flame).length===0,'噴流へ直接レイを当てても損傷対象にならない');
   const lengths={};
   for(const mode of ['hover','long','short','charge','lunge']){g.resetBoosterFlame(u);u.dashState=mode;for(let i=0;i<30;i++)g.boosterFlameUpdate(u,1/60);lengths[mode]=u.flame.material.uniforms.length.value;yes(u.flame.visible&&Number.isFinite(lengths[mode]),mode+'の噴流を表示');}
   yes(lengths.hover<lengths.long&&lengths.long<lengths.short&&lengths.short<lengths.charge,'滞空・巡航・短噴射・加速装置の長さを区別');
   g.resetBoosterFlame(u);u.dashState='short';u.dashT=.24;g.boosterFlameUpdate(u,.01);g.boosterFlameUpdate(u,.12);u.dashT=.05;g.boosterFlameUpdate(u,.01);u.dashT=.24;g.boosterFlameUpdate(u,.01);
   yes(u.flame.material.uniforms.pulse.value===0,'同じshort状態の連続ステップでも点火し直す');
   g.boosterFlameUpdate(u,.1);u.dashState='long';g.boosterFlameUpdate(u,.01);yes(u.flame.material.uniforms.pulse.value>.09,'ステップから巡航への移行で点火を二重に出さない');
   u.dashState='';for(let i=0;i<30;i++)g.boosterFlameUpdate(u,1/60);yes(!u.flame.visible,'噴射終了時は短い余韻で消える');
   u.dashState='charge';g.boosterFlameUpdate(u,.1);u.alive=false;g.boosterFlameUpdate(u,.01);yes(!u.flame.visible,'撃破時は即座に消す');
   g.spawn(u);yes(!u.flame.visible&&u.flame.userData.boostFx.pulse===1,'再出撃で点火・余韻をリセット');
   reset();u.dashState='long';g.boosterFlameUpdate(u,.2);u.vis=.1;u.shimmer=0;g.cloakLook(u,1);
   yes(u.flame.material.blending===T.AdditiveBlending&&u.flame.visible,'迷彩中も既存仕様どおり噴射が見える');u.vis=1;g.cloakLook(u,2);
   const hiddenBefore=g.scene.children.length;for(let i=0;i<1000;i++)g.boosterFlameUpdate(u,1/60);
   yes(g.scene.children.length===hiddenBefore&&u.flame.geometry===geo,'継続噴射で物体や形状を増やさない');
   Object.assign(e,{alive:true,dashState:'short'});e.pos.set(1000,200,0);g.boosterFlameUpdate(e,.2);yes(!e.flame.visible,'遠方350m以遠の他機の噴射を省略');
   e.pos.set(200,200,0);g.boosterFlameUpdate(e,.1);yes(e.flame.visible&&e.flame.material.uniforms.pulse.value===1,'遠方の他機は点火リングを省略');
   const times=[];for(const step of [1/30,1/120]){g.resetBoosterFlame(u);u.dashState='long';for(let i=0;i<Math.round(.5/step);i++)g.boosterFlameUpdate(u,step);times.push([u.flame.userData.boostFx.power,u.flame.userData.boostFx.length]);}
   yes(times[0].every((v,i)=>Math.abs(v-times[1][i])<1e-6),'30Hzと120Hzで立ち上がりが揃う');
   const uniforms=JSON.stringify(u.flame.material.uniforms);g.boosterFlameUpdate(u,0);yes(JSON.stringify(u.flame.material.uniforms)===uniforms,'停止中は炎の時間を進めない');
   reset();g.shortDash(u,new T.Vector3(0,0,-1));g.physics(u,new T.Vector3(0,0,-1),true,false,1/60);g.boosterFlameUpdate(u,1/60);
   yes(u.dashState==='short'&&u.flame.visible,'実際のショートダッシュから噴射する');
   for(const mode of ['long','charge','hover']){
    reset();u.longDash=mode==='long';u.chargerOn=mode==='charge';u.onGround=mode!=='hover';u.vel.y=-1;
    g.physics(u,new T.Vector3(0,0,-1),mode!=='hover',false,1/60,mode==='hover');g.boosterFlameUpdate(u,1/60);
    yes(u.dashState===mode&&u.flame.visible,'実際の移動処理と'+mode+'噴射が同期する');
   }
   reset();Object.assign(e,{alive:true,invulT:0,hp:10000,barrierOn:false,weakT:0});e.pos.set(0,200,-25);e.group.position.copy(e.pos);e.group.visible=true;e.group.rotation.set(0,0,0);g.weaponLook(e,0);g.scene.updateMatrixWorld(true);
   const hp=e.hp;g.fire(u,new T.Vector3(0,202,-25),0,u.slots.main.w,new T.Vector3(0,202,-5));yes(e.hp<hp,'噴流の変更後も機体本体への実射が命中する');
   // 本体を離れた表示用シーンで遮蔽と追加描画回数を確認。
   const scene=new T.Scene(),cam=new T.PerspectiveCamera(50,1280/720,.1,100);
   scene.background=new T.Color(0x101f2a);scene.add(new T.HemisphereLight(0xd7eeff,0x384451,.9));
   const lamp=new T.DirectionalLight(0xffffff,.8);lamp.position.set(-3,8,4);scene.add(lamp);
   u.pos.set(0,0,0);u.group.position.copy(u.pos);u.group.rotation.set(0,0,0);u.alive=true;u.invulT=0;u.group.visible=true;
   u.vel.set(0,0,-20);u.dashState='long';g.weaponLook(u,.05);g.resetBoosterFlame(u);g.boosterFlameUpdate(u,.1);g.boosterFlameUpdate(u,.05);
   scene.add(u.group);cam.position.set(7,4,9);cam.lookAt(0,2,2);
   const ground=new T.Mesh(new T.PlaneGeometry(50,50),new T.MeshLambertMaterial({color:0x243746}));ground.rotation.x=-Math.PI/2;scene.add(ground);
   g.renderer.render(scene,cam);const on=g.renderer.info.render.calls;u.flame.visible=false;g.renderer.render(scene,cam);const off=g.renderer.info.render.calls;u.flame.visible=true;
   yes(on-off===1,'左右の炎・芯・点火輪を追加1ドローで描く');
   yes(u.flame.material.depthTest&&!u.flame.material.depthWrite,'噴流は壁の奥行き判定を維持し深度を書き込まない');
   yes(g.renderer.getContext().getError()===0,'実描画でWebGLエラーなし');
   let disposed=0;geo.addEventListener('dispose',()=>disposed++);
   const temp=g.buildMech(0x55bbdd);let materials=0;temp.flame.material.addEventListener('dispose',()=>materials++);g.disposeMech(temp.g);
   yes(materials===1&&disposed===0,'機体破棄では専用材質だけ破棄し共有形状を維持');
   const isolated=new T.Scene(),probe=g.makeBoosterFlame(1);probe.position.set(0,0,0);probe.visible=true;
   const pu=probe.material.uniforms;pu.power.value=1;pu.length.value=4;pu.pulse.value=1;isolated.add(probe);
   const pc=new T.PerspectiveCamera(45,1,.1,100);pc.position.set(0,0,12);pc.lookAt(0,0,2);
   const target=new T.WebGLRenderTarget(128,128),pixels=new Uint8Array(128*128*4),oldTarget=g.renderer.getRenderTarget();
   const brightness=()=>{g.renderer.setRenderTarget(target);g.renderer.render(isolated,pc);g.renderer.readRenderTargetPixels(target,0,0,128,128,pixels);let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];return sum;};
   const lit=brightness(),wall=new T.Mesh(new T.PlaneGeometry(30,30),new T.MeshBasicMaterial({color:0}));wall.position.z=8;isolated.add(wall);
   const blocked=brightness();yes(lit>1000&&blocked===0,'実描画で壁が噴流を遮り、壁越しに発光しない ('+lit+'/'+blocked+')');
   g.renderer.setRenderTarget(oldTarget);target.dispose();wall.geometry.dispose();wall.material.dispose();probe.material.dispose();
   const extra=[];for(let i=0;i<100;i++){const f=g.makeBoosterFlame(1);f.visible=true;f.position.set(i%10*2-10,0,Math.floor(i/10)*2-10);f.material.uniforms.power.value=1;f.material.uniforms.length.value=3;extra.push(f);}
   yes(new Set(extra.map(f=>f.geometry)).size===1&&extra.every(f=>f.children.length===0),'100機分でも形状1個を共有し子オブジェクトを追加しない');
   for(const f of extra)f.material.dispose();
   window.boostScene=scene;window.boostCamera=cam;window.boostSample=(mode,age=.1)=>{u.dashState=mode;u.dashT=.24;g.weaponLook(u,.01);g.resetBoosterFlame(u);g.boosterFlameUpdate(u,.05);g.boosterFlameUpdate(u,age);g.renderer.render(scene,cam);};
   return {checks,lengths,triangles:geo.attributes.position.count/3,additionalDrawCalls:on-off};
  });
  for(const mode of ['long','short','charge','hover']){await p.evaluate(mode=>{for(const el of document.querySelectorAll('.hud,#overlay,#respawn'))el.style.display='none';boostSample(mode,mode==='short'?.08:.35);},mode);await p.screenshot({path:path.join(out,mode+'.png')});}
  const model=await p.evaluate(()=>{
   const group=__g.player.group,stash=[];group.traverse(o=>{stash.push([o,o.userData]);o.userData={};});
   __g.player.flame.name='booster';let data;try{data=group.toJSON();}finally{for(const [o,d] of stash)o.userData=d;}return data;
  });
  fs.writeFileSync(path.join(out,'model.json'),JSON.stringify(model));
  assert.deepEqual(errors,[]);result.errors=errors;fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks.length,triangles:result.triangles,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
