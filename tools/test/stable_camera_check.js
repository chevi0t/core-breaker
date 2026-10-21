// 実射で景色だけを安定させ、反動・移動・意図したズームが残ることを旧版と比較する。
// node tools/test/stable_camera_check.js 変更後dbg 変更前dbg [結果フォルダ]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const errors=[],results=[];
 async function open(dir){const p=await browser.newPage({viewport:{width:1280,height:720}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});await p.goto('file://'+path.resolve(dir,'dbg.html'));await p.evaluate(()=>{const g=__g;g.selectMap('dock');document.getElementById('start').click();g.running=true;g.renderer.render=()=>g.scene.updateMatrixWorld(true);for(const u of g.units){u.alive=false;u.frozen=true;u.group.visible=false;}});return p;}
 const before=await open(process.argv[3]||'dbg/stable-camera-before'),after=await open(process.argv[2]||'dbg/stable-camera');
 const catalog=p=>p.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));assert.deepEqual(await catalog(after),await catalog(before),'全294武器・パーツの値と装備順を保存');
 for(const [version,p]of [['before',before],['after',after]]){
  const result=await p.evaluate(()=>{const g=__g,u=g.player,T=g.T;
   function reset(key){const cls=Object.keys(g.ARMORY).find(c=>g.ARMORY[c].main.includes(key));g.equip(u,cls);u.slots.main=g.slotOf(key);Object.assign(u,{alive:true,isPlayer:true,invulT:0,weapon:'main',switchT:0,stun:'',repairing:false,transfer:null,onGround:true,yaw:0,pitch:0,longDash:false,dashT:0,lungeT:0,dashState:'',recoil:0,recoilYaw:0});u.pos.set(0,240,0);u.vel.set(0,0,0);u.group.position.copy(u.pos);u.group.visible=true;g.lock.target=null;g.lock.visible=false;g.gameOptions.fov=70;g.camera.fov=70;g.weaponLook(u,0);g.scene.updateMatrixWorld(true);g.updateCamera(u,1);}
   const samples=[];
   for(const key of ['gatling','ar','mg','haggard']){reset(key);const neutral=g.camera.quaternion.clone(),position=g.camera.position.clone();let angle=0,translation=0,kick=0,model=0,shots=0;const dirs=[];
    for(let n=0;n<300;n++){g.updateCamera(u,.01);const aim=g.camera.position.clone().addScaledVector(g.camera.getWorldDirection(new T.Vector3()),300),start=g.fx.length;g.weaponsTick(u,.01,key==='haggard'?n%60===0:true,aim,0);g.weaponLook(u,.01);g.scene.updateMatrixWorld(true);g.updateCamera(u,.01);angle=Math.max(angle,g.camera.quaternion.angleTo(neutral));translation=Math.max(translation,g.camera.position.distanceTo(position));kick=Math.max(kick,u.recoil);model=Math.max(model,Math.abs(u.gun.rotation.x));for(const f of g.fx.slice(start))if(f.kind==='tracer'){shots++;dirs.push(f.end.clone().sub(f.from).normalize().toArray());}g.fxUpdate(.01);}
    samples.push({key,angle,translation,kick,model,shots,directionRange:Math.max(...dirs.map(v=>v[1]))-Math.min(...dirs.map(v=>v[1]))});
   }
   reset('ar');const dashFovs=[];for(const state of ['short','long','lunge','charge','']){u.dashState=state;g.updateCamera(u,1);dashFovs.push(g.camera.fov);}
   const start=g.camera.position.clone(),quaternion=g.camera.quaternion.clone();u.pos.x+=5;g.updateCamera(u,1);const move={x:g.camera.position.x-start.x,angle:g.camera.quaternion.angleTo(quaternion)};
   g.lock.target=g.units.find(q=>q!==u);g.lock.visible=true;g.updateCamera(u,1);const lockFov=g.camera.fov;g.lock.target=null;u.slots.main=g.slotOf('sniper');u.scoped=true;g.updateCamera(u,1);const scopeFov=g.camera.fov,scopePower=g.scopePower(u);
   return{samples,dashFovs,move,lockFov,scopeFov,scopePower};
  });results.push({version,...result});
 }
 const old=results[0],now=results[1];for(const a of now.samples){assert.ok(a.shots>3&&a.kick>.001&&a.model>.001&&a.directionRange>.001,a.key+'の連射・銃の跳ね上がり・弾道の変動が残る');assert.ok(a.angle<1e-7&&a.translation<1e-7,a.key+'の連射で景色の回転・揺れがない');assert.ok(old.samples.find(s=>s.key===a.key).angle>.001,a.key+'の旧版の揺れを実際に再現');}
 assert.ok(now.dashFovs.every(v=>Math.abs(v-70)<1e-7),'各ダッシュ状態への出入りで画角を動かさない');assert.ok(old.dashFovs.some(v=>v>70),'旧版のダッシュ画角変化を再現');assert.ok(Math.abs(now.move.x-5)<1e-7&&now.move.angle<1e-7,'カメラは自機の移動に付いてくる');assert.ok(Math.abs(now.lockFov-70/1.3)<1e-7,'通常ロックの1.3倍ズームを維持');assert.ok(Math.abs(now.scopeFov-70/now.scopePower)<1e-7,'狙撃スコープの倍率を維持');
 assert.deepEqual(errors,[]);const out=path.resolve(process.argv[4]||'dbg/stable-camera/camera-results');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({results,errors},null,2));console.log('画面安定：連射4種の新旧比較・移動・ダッシュ5状態・ロック/スコープ・全294武器の性能保存：成功。ブラウザエラー0');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
