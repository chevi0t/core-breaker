// 画面の照準と実際の発射を比較し、固定照準の旧不具合・反動・ズーム・壁際を確認する。
// node tools/test/recoil_reticle_check.js 変更後dbg 変更前dbg [結果フォルダ]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const errors=[],out=path.resolve(process.argv[4]||'dbg/reticle-results');fs.mkdirSync(out,{recursive:true});
 async function page(dir){const p=await b.newPage({viewport:{width:1280,height:720}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});await p.goto('file://'+path.resolve(dir,'dbg.html'));return p;}
 async function compare(p,current){return p.evaluate(current=>{
  const g=__g,T=g.T,checks=[],samples=[],yes=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg);};g.selectMap('dock');document.getElementById('start').click();g.running=true;g.renderer.render=()=>g.scene.updateMatrixWorld(true);
  const u=g.player,wall=new T.Mesh(new T.BoxGeometry(250,250,.1),new T.MeshBasicMaterial());g.scene.add(wall);g.hittables.push(wall);
  function reset(key,dist=40,recoil=.12,side=.035,fov=70,scoped=false){for(const q of g.units){q.alive=false;q.frozen=true;q.group.visible=false;}for(const t of g.turrets)t.alive=false;
   const cls=Object.keys(g.ARMORY).find(c=>Object.values(g.ARMORY[c]).flat().includes(key)),slot=Object.keys(g.ARMORY[cls]).find(k=>g.ARMORY[cls][k].includes(key));g.equip(u,cls);u.slots[slot]=g.slotOf(key);u.slots[slot].w={...u.slots[slot].w,spread:0,hip:0,sway:0};u.weapon=slot;
   Object.assign(u,{alive:true,isPlayer:true,hp:1e6,maxHp:1e6,invulT:0,switchT:0,stun:'',stunT:0,repairing:false,transfer:null,onGround:true,yaw:0,pitch:0,longDash:false,dashT:0,lungeT:0,dashState:'',recoil,recoilYaw:side,recoilWait:100,scoped,scopeStep:0});u.pos.set(0,200,0);u.vel.set(0,0,0);u.group.visible=true;u.group.position.copy(u.pos);u.group.rotation.set(0,0,0);g.lock.target=null;g.lock.visible=false;g.gameOptions.fov=fov;g.camera.fov=scoped?fov/g.scopePower(u):fov;
   wall.position.set(0,200,-dist);g.weaponLook(u,0);g.scene.updateMatrixWorld(true);g.updateCamera(u,1);g.hud(g.timeLeft,.01);return u.slots[slot];
  }
  function base(){if(current)return g.viewAim(u);const d=g.camera.getWorldDirection(new T.Vector3()),from=g.camera.position.clone().addScaledVector(d,7);return g.castFrom(from,d,u)?.point||from.addScaledVector(d,300);}
  const pixel=point=>{const s=point.clone().project(g.camera);return{x:(s.x+1)*innerWidth/2,y:(1-s.y)*innerHeight/2};};
  function cursor(){if(u.scoped)return{x:parseFloat(getComputedStyle(document.getElementById('scope'),'::before').left),y:parseFloat(getComputedStyle(document.getElementById('scope'),'::after').top)};const id=document.body.dataset.console==='mechanical'?'mechAim':'cross',r=document.getElementById(id).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}
  function shot(sl,dist){const n=g.fx.length,k=g.shells.length;g.shot(u,sl,base(),0);const rays=g.fx.slice(n).filter(f=>f.kind==='tracer'||f.kind==='laser');let end;
   if(rays.length){const f=rays.at(-1);end=f.end||f.from.clone().addScaledVector(f.dir,f.len);}
   else{const sh=g.shells[k];yes(!!sh,'実際に弾を射出');const time=(-dist+.05-sh.pos.z)/sh.vel.z;end=sh.pos.clone().addScaledVector(sh.vel,time);}
   return pixel(end);
  }
  const catalog={weapons:g.WEAPONS,parts:g.PARTS,armory:g.ARMORY};
  for(const mode of current?['standard','arcade','flight','mechanical']:['standard']){
   document.querySelector(`[data-console-choice="${mode}"]`).click();
   for(const key of current?['ar','gatling','mg','haggard','sniper','lightSniper','rocket','plasma']:['ar'])for(const dist of [10,40,100])for(const fov of current?[60,100]:[70]){
    const scoped=key==='sniper'||key==='lightSniper',sl=reset(key,dist,scoped?.015:.12,.02,fov,scoped),mark=cursor(),camera=g.camera.quaternion.clone(),actual=shot(sl,dist),gap=Math.hypot(mark.x-actual.x,mark.y-actual.y);
    samples.push({mode,key,dist,fov,scoped,mark,actual,gap});if(current){yes(gap<.25,`${mode}/${key}/${dist}m/FOV${fov}：照準と実弾が0.25px未満 ${gap}`);yes(g.camera.quaternion.angleTo(camera)<1e-7,'射撃でカメラを回さない');}
   }
  }
  if(current){
   document.querySelector('[data-console-choice="standard"]').click();const sl=reset('gatling',40,0,0);sl.spin=1;const trace=[];
   for(let n=0;n<120;n++){g.recoilRecover(u,1/60);g.weaponLook(u,1/60);g.scene.updateMatrixWorld(true);g.updateCamera(u,1/60);g.hud(g.timeLeft,1/60);const mark=cursor(),start=g.fx.length;sl.spin=1;g.weaponsTick(u,0,true,base(),0);const f=g.fx.slice(start).find(f=>f.kind==='tracer');if(f){const actual=pixel(f.end),gap=Math.hypot(mark.x-actual.x,mark.y-actual.y);yes(gap<.25,'連射中も発射直前の照準と実弾が一致 '+gap);trace.push({mark,actual,recoil:u.recoil});}g.weaponsTick(u,1/60,false,base(),0);g.fxUpdate(1/60);}
   yes(trace.length>15&&trace.at(-1).mark.y<trace[0].mark.y-30,'反動を蓄積した連射でも照準が実射線へ上がる');
   for(let n=0;n<200;n++)g.weaponsTick(u,.02,false,base(),0);g.weaponLook(u,0);g.scene.updateMatrixWorld(true);g.reticleHud(u);yes(Math.abs(cursor().y-innerHeight/2)<.5,'撃ち止めると反動と照準が中心へ戻る');
   reset('sniper',100,.22,.05,60,true);yes(!document.getElementById('aimEdge').hidden,'スコープの外へ出た射線は方向の矢印を表示');u.recoil=u.recoilYaw=0;g.weaponLook(u,0);g.scene.updateMatrixWorld(true);g.reticleHud(u);yes(document.getElementById('aimEdge').hidden,'射線が戻ると矢印を消す');
   reset('rocket',10,.06,0);const closeWall=new T.Mesh(new T.BoxGeometry(10,20,.1),new T.MeshBasicMaterial());closeWall.position.set(0,204,-1);g.scene.add(closeWall);g.hittables.push(closeWall);g.scene.updateMatrixWorld(true);g.reticleHud(u);const predicted=g.reticlePoint(u),mark=cursor(),k=g.shells.length;g.shot(u,u.slots.sub,base(),0);const sh=g.shells[k],time=(predicted.z-sh.pos.z)/sh.vel.z,actual=pixel(sh.pos.clone().addScaledVector(sh.vel,time));yes(Math.hypot(mark.x-actual.x,mark.y-actual.y)<.25&&predicted.z> -2,'壁際の補正された銃口と最初の壁を照準にも反映');g.hittables.splice(g.hittables.indexOf(closeWall),1);g.scene.remove(closeWall);
   for(const key of ['grenade','gl']){const sl=reset(key,40,.1,.03),point=g.reticlePoint(u),k=g.shells.length;g.shot(u,sl,base(),0);const sh=g.shells[k],gravity=sh.spec.grav;yes(gravity>0,'投射武器の実際の重力を使う');const time=(point.z-sh.pos.z)/sh.vel.z,at=sh.pos.clone().addScaledVector(sh.vel,time);at.y-=gravity*time*time/2;yes(at.distanceTo(point)<.1,'投射武器の照準も実際の発射速度の放物線上 '+key+' '+at.distanceTo(point));}
   reset('ar',40,0,0);const floor={minX:-10,maxX:10,minZ:-10,maxZ:10,top:200};g.obstacles.push(floor);const canvas=g.renderer.domElement,start=g.fx.length;canvas.dispatchEvent(new MouseEvent('mousedown',{button:0}));const move=new MouseEvent('mousemove');Object.defineProperties(move,{movementX:{value:-80},movementY:{value:0}});window.dispatchEvent(move);g.playerUpdate(u,0);window.dispatchEvent(new MouseEvent('mouseup',{button:0}));const ray=g.fx.slice(start).find(f=>f.kind==='tracer'),at=pixel(ray.end);yes(Math.abs(u.yaw-.2)<1e-7&&Math.hypot(at.x-innerWidth/2,at.y-innerHeight/2)<.25,'マウスで振り向いたフレームの射撃が更新後の視点と一致 '+JSON.stringify({yaw:u.yaw,at}));g.obstacles.splice(g.obstacles.indexOf(floor),1);
   // 持ち替え・死亡で固定照準へ戻す。
   reset('ar');u.weapon='aux';g.reticleHud(u);yes(Math.abs(cursor().x-innerWidth/2)<.5&&Math.abs(cursor().y-innerHeight/2)<.5,'近接へ持ち替えると照準を中央へ戻す');u.weapon='main';u.alive=false;g.reticleHud(u);yes(Math.abs(cursor().y-innerHeight/2)<.5&&document.getElementById('aimEdge').hidden,'死亡時に反動照準を残さない');
  }
  return{catalog,passed:checks.length,samples,checks};
 },current);}
 const oldPage=await page(process.argv[3]||'dbg/recoil-reticle-before'),old=await compare(oldPage,false);await oldPage.close();fs.writeFileSync(path.join(out,'before.json'),JSON.stringify(old.samples,null,2));assert.ok(old.samples.every(s=>s.gap>20),'旧版の実弾と固定照準のずれを再現');
 const p=await page(process.argv[2]||'dbg/recoil-reticle'),now=await compare(p,true);assert.deepEqual(now.catalog,old.catalog,'全294武器・機体パーツ・装備順を保持');assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({before:old.samples,passed:now.passed,samples:now.samples,checks:now.checks,errors},null,2));console.log(`照準と実弾：${now.passed}項目、4HUD・8武器・距離/画角・連射・スコープ・壁際・投射を確認。ブラウザエラー0`);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
