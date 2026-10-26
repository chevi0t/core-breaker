// 実メッシュの三本の刃先から、袈裟軌道との直交・中心軌道・重装3段の実損傷を確かめる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
 await p.goto('file://'+path.resolve(process.argv[2]||'dbg/claw-rake','dbg.html'));
 const result=await p.evaluate(()=>{
  const g=__g,T=g.T,checks=[],samples=[],yes=(v,s)=>{if(!v)throw Error(s);checks.push(s);};g.selectMap('dock');document.getElementById('start').click();g.running=false;
  const u=g.player,e=g.units.find(v=>v.team!==u.team),base=new T.Vector3(-50,g.terrainH(-50,-48),-48);
  for(const q of g.units){q.frozen=true;q.alive=false;q.pos.set(10000,0,10000);}for(const q of g.turrets)q.alive=false;
  function reset(key,strong=true){
   g.loadout.assault.aux=key;g.equip(u,'assault');g.selectWeapon(u,'aux');
   Object.assign(u,{alive:true,isPlayer:true,switchT:0,swing:null,stun:'',stunT:0,invulT:0,recoverT:0,ctrlLockT:0,transfer:null,repairing:false,dashT:strong?.2:0,longDash:false,lungeT:0,yaw:0,pitch:0,onGround:true,flying:false});u.pos.copy(base);u.vel.set(0,0,0);
   u.group.position.set(0,0,0);u.group.rotation.set(0,0,0);g.weaponLook(u,0);g.resetMechPose(u);
   g.swordTick(u,u.slots.aux,.001,true,u.pos.clone().add(new T.Vector3(0,2.4,-100)));return u.swing;
  }
  function tips(sw,index,k){
   const s=sw.a.strikes[index];sw.t=sw.a.windup+s.at+s.sweep*k;u.group.position.set(0,0,0);g.weaponLook(u,0);u.group.updateMatrixWorld(true);
   const b=s.hand===1?u.blade:u.blade2,edge=b.userData.laserBlade.children[0],a=edge.geometry.attributes.position,m=edge.geometry.morphAttributes.position[0],amount=edge.morphTargetInfluences[0];
   const out=[];for(let j=0;j<3;j++){const v=new T.Vector3();let count=0;for(let i=j*36;i<(j+1)*36;i++){const x=m.getX(i),y=m.getY(i),z=m.getZ(i);if(x*x+y*y+z*z<.5)continue;v.add(new T.Vector3(a.getX(i)+x*amount,a.getY(i)+y*amount,a.getZ(i)+z*amount));count++;}out.push(v.multiplyScalar(1/count).applyMatrix4(edge.matrixWorld));}
   return out;
  }
  for(const key of ['claw','clawH','clawB','clawM']){
   const sw=reset(key),want=key==='clawM'?3:2;yes(sw.a.strikes.length===want,key+' 段数');
   yes(sw.a.strikes.map(s=>s.hand).join(',')===(want===3?'1,-1,1':'1,-1'),key+' 右→左'+(want===3?'→右':''));
   for(let index=0;index<want;index++)for(const k of [.1,.3,.5,.7,.9]){
    const before=tips(sw,index,k-.001)[1],after=tips(sw,index,k+.001)[1],now=tips(sw,index,k),across=now[2].clone().sub(now[0]).normalize(),velocity=after.clone().sub(before).normalize();
    const dot=Math.abs(across.dot(velocity));yes(dot<.01,key+'/'+index+'/'+k+' 三本の並びが刃先の移動へ直交 '+dot.toFixed(4));
    const s=sw.a.strikes[index],yaw=(s.from+(s.to-s.from)*k)*Math.PI/180,pitch=(s.pitchFrom+(s.pitchTo-s.pitchFrom)*k)*Math.PI/180;
    const expected=new T.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(sw.a.reach-.65).add(new T.Vector3(...s.gripFrom).lerp(new T.Vector3(...s.gripTo),k));
    yes(now[1].distanceTo(expected)<1e-5,key+'/'+index+'/'+k+' 中心刃の軌道・リーチを変えない');
    if(k===.5)samples.push({key,hand:s.hand,dot,spacing:now[2].distanceTo(now[0])});
   }
   u.swing=null;g.weaponLook(u,0);yes(!u.blade.userData.laserBlade.visible&&!u.blade2.userData.laserBlade.visible,key+' 待機中に光の刃を残さない');
  }
  const heavy=g.WEAPONS.clawM.strong;yes(heavy.strikes.every(s=>s.dmg===4500)&&heavy.dmg===13500,'重装型は4500×3＝13500');
  yes(heavy.dashName.includes('左袈裟→右袈裟')&&g.WEAPONS.clawM.desc.includes('三段'),'HUD・装備説明も3段へ更新');
  const damage=[];
  for(const dt of [1/30,1/60,1/120]){
   reset('clawM');Object.assign(e,{alive:true,hp:100000,maxHp:100000,invulT:0,weakT:0,downT:0,stun:'',stunT:0});e.armorAvg=1;e.partArmor={head:1,body:1,arms:1,legs:1};e.pos.copy(base).z-=3;e.vel.set(0,0,0);
   let hp=e.hp;const hits=[];
   for(let i=0;u.swing&&i<500;i++){g.swordTick(u,u.slots.aux,dt,false,u.pos.clone().add(new T.Vector3(0,2.4,-100)));if(e.hp!==hp){hits.push(hp-e.hp);hp=e.hp;}}
   yes(hits.length===3&&hits.every(v=>v===4500),dt+'秒刻みで右左右が各1回、4500ずつ損傷');damage.push({dt,hits});
   e.alive=false;
  }
  return {checks,samples,damage};
 });assert.deepEqual(errors,[]);const out=path.resolve(process.argv[3]||'/tmp/claw-rake-results');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({checks:result.checks.length,samples:result.samples,damage:result.damage,errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
