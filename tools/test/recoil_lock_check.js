// 捕捉を保っても照準を敵へ張り付かせない。実際の入力/更新で切り返し・手動補正を確認する。
// node tools/test/recoil_lock_check.js dbg/stable-camera [結果フォルダ]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await b.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=undefined;});await p.goto('file://'+path.resolve(process.argv[2]||'dbg/stable-camera','dbg.html'));
 const result=await p.evaluate(()=>{
  const g=__g,T=g.T,checks=[],samples=[],yes=(ok,m)=>{if(!ok)throw Error(m);checks.push(m);},near=(a,b,e=1e-6)=>Math.abs(a-b)<e;
  g.selectMap('dock');document.getElementById('start').click();g.running=true;g.renderer.render=()=>g.scene.updateMatrixWorld(true);
  const u=g.player,e=g.units.find(q=>q.team!==u.team),canvas=g.renderer.domElement;
  // 見通しのよい高さに静止用の床を置き、落下を照準追従へ混ぜない。
  g.obstacles.push({minX:-60,maxX:60,minZ:-60,maxZ:60,top:120});
  function fixture(){
   for(const q of g.units){q.frozen=true;q.alive=false;q.group.visible=false;}g.equip(u,'assault');u.slots.main=g.slotOf('ar');
   Object.assign(u,{alive:true,isPlayer:true,invulT:0,weapon:'main',switchT:0,stun:'',stunT:0,repairing:false,transfer:null,yaw:0,pitch:0,onGround:true,dashT:0,longDash:false,lungeT:0,recoverT:0,planted:false,scoped:false,recoil:0,recoilYaw:0});u.pos.set(0,120,0);u.vel.set(0,0,0);
   Object.assign(e,{alive:true,invulT:0,cloak:false,downT:0,dashState:''});e.pos.set(0,120,-30);
   // 肩越し視点も含めて最初だけ正面の胴へ合わせる。
   for(let n=0;n<6;n++){const pv=u.pos.clone().add(new T.Vector3(2.2*Math.cos(u.yaw),4.6,-2.2*Math.sin(u.yaw))),d=g.targetPoint(e).sub(pv);u.yaw=Math.atan2(-d.x,-d.z);u.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));}
   Object.assign(g.lock,{target:e,visible:true,losT:100,lostT:0,prevAng:null});g.camera.fov=70/1.3;sync();g.updateCamera(u,1);g.playerUpdate(u,1/60);g.updateCamera(u,1/60);
  }
  function sync(){for(const q of [u,e]){q.group.position.copy(q.pos);q.group.rotation.set(0,q.yaw,0);q.group.visible=q.alive;g.weaponLook(q,0);}g.scene.updateMatrixWorld(true);}
  function aim(){const d=g.camera.getWorldDirection(new T.Vector3()),t=(e.pos.z-g.camera.position.z)/d.z,p=g.camera.position.clone().addScaledVector(d,t);return{x:p.x-e.pos.x,height:p.y-e.pos.y,yaw:u.yaw,pitch:u.pitch,locked:g.lock.target===e};}
  function frame(dt=1/60){sync();g.playerUpdate(u,dt);g.updateCamera(u,dt);return aim();}
  function mouse(yaw,pitch){const sens=.0025*g.camera.fov/70;canvas.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));const ev=new MouseEvent('mousemove');Object.defineProperties(ev,{movementX:{value:-yaw/sens},movementY:{value:-pitch/sens}});window.dispatchEvent(ev);window.dispatchEvent(new MouseEvent('mouseup',{button:0}));}
  fixture();const start=aim();u.recoil=.2;u.recoilYaw=.1;u.recoilWait=10;const stationary=[];for(let n=0;n<30;n++)stationary.push(frame());
  yes(stationary.every(s=>near(s.yaw,start.yaw)&&near(s.pitch,start.pitch)),'静止した相手のロックで反動を自動補償して視点を動かさない');
  fixture();mouse(.12,.09);g.updateCamera(u,1);const offset=aim();yes(Math.abs(offset.x)>2,'マウス入力で照準を機体の外へ動かした状態を再現');for(let n=0;n<30;n++)frame();const manual=aim();
  yes(manual.locked&&near(offset.yaw,manual.yaw)&&near(offset.pitch,manual.pitch),'手で敵の外へ動かした照準を自動で引き戻さず、捕捉は保つ');
  for(const dt of [1/30,1/60,1/120]){
   fixture();const trace=[];let maxGap=0,minRetained=1;
   for(let n=0;n<Math.round(1.2/dt);n++){const t=(n+1)*dt;e.pos.x=t<=.6?t*8:(1.2-t)*8;const a=frame(dt);trace.push(a);maxGap=Math.max(maxGap,Math.abs(a.x));minRetained=Math.min(minRetained,+a.locked);}
   yes(minRetained&&maxGap>2,'切り返す敵を捕捉しつつ、照準からは外れる '+dt+' '+maxGap);samples.push({kind:'targetReversal',dt,maxGap,trace});
  }
  fixture();const own=[];for(let n=0;n<60;n++){u.pos.x=n<30?n*.13:(60-n)*.13;own.push(frame());}
  yes(own.every(s=>s.locked)&&Math.max(...own.map(s=>Math.abs(s.x)))>1.5,'自機の切り返しでも照準を敵へ貼り付けずにロックを保つ');
  function track(dash){fixture();const yaw=u.yaw;e.dashState=dash;e.pos.x=.6;frame();return Math.abs(u.yaw-yaw);}
  const normal=track(''),dash=track('short');yes(normal>0&&dash>0&&dash<normal*.4,'ショートダッシュ中の敵への追従をさらに弱める');
  fixture();const yaw=u.yaw;e.pos.x=6;frame(1/120);yes(Math.abs(u.yaw-yaw)>0&&Math.abs(u.yaw-yaw)<=.8/120+1e-8,'急な角移動にも追従速度の上限を守る');
  fixture();e.alive=false;frame();yes(!g.lock.target,'撃破された敵のロックを解除する');
  fixture();e.pos.z=-100;frame();yes(!g.lock.target,'射程外の敵のロックを解除する');
  fixture();e.pos.x=40;frame();yes(!g.lock.target,'外側の保持範囲を外れた敵は解除する');
  fixture();e.cloak=true;e.cloakT=1.1;frame();yes(!g.lock.target,'迷彩で消えた敵を解除する');
  fixture();u.slots.main=g.slotOf('sniper');frame();yes(!g.lock.target,'スコープ狙撃銃では通常ロックを使わない');
  fixture();u.jamT=1;frame();yes(!g.lock.target,'妨害中は通常ロックを解除する');u.jamT=0;
  fixture();const wall=new T.Mesh(new T.BoxGeometry(15,10,1),new T.MeshBasicMaterial());wall.position.set(0,123,-15);g.scene.add(wall);g.hittables.push(wall);g.lock.losT=0;for(let n=0;n<45;n++)frame();yes(!g.lock.target,'0.6秒以上遮蔽された敵は解除する');g.hittables.splice(g.hittables.indexOf(wall),1);g.scene.remove(wall);wall.geometry.dispose();wall.material.dispose();
  return{passed:checks.length,checks,samples,normal,dash,own,stationary};
 });assert.deepEqual(errors,[]);const out=path.resolve(process.argv[3]||'dbg/stable-camera/lock-results');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(result,null,2));console.log('弱いロック追従 '+result.passed+'項目：成功。ブラウザエラーなし');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
