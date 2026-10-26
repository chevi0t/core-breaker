// 光学弾の色・拡大した軌跡・残光と、従来の実弾/衝突/ダメージを確認する。
// node tools/test/energy_trail_check.js dbg/lime-energy [結果JSONの保存先]
const fs=require('fs'),path=require('path');
let chromium;
try { ({chromium}=require('playwright')); } catch (_) { ({chromium}=require('/opt/node22/lib/node_modules/playwright')); }
const dir=path.resolve(process.argv[2]||'dbg/lime-energy');
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.goto('file://'+path.join(dir,'dbg.html'));
 const result=await p.evaluate(()=>{
  const g=__g,T=g.T;g.renderer.render=()=>{};g.selectMap('dock');document.getElementById('start').click();g.running=false;
  const u=g.player,e=g.units.find(q=>q.team!==u.team),scene=u.group.parent,checks=[],yes=(v,msg)=>{if(!v)throw Error(msg);checks.push(msg);},near=(a,b)=>Math.abs(a-b)<1e-6;
  for(const q of g.units){q.frozen=true;if(q!==u&&q!==e)q.alive=false;}
  const clear=()=>{for(const f of g.fx){f.obj.parent?.remove(f.obj);f.obj.material.dispose();if(f.kind==='sparks'||f.ownGeo)f.obj.geometry.dispose();}g.fx.length=0;for(const s of g.shells)s.mesh.parent?.remove(s.mesh);g.shells.length=0;};
  const reset=(cls,key,slot='main',team='B')=>{clear();u.team=team;e.team=team==='B'?'R':'B';u.isPlayer=true;g.loadout[cls][slot]=key;g.equip(u,cls);g.selectWeapon(u,slot);Object.assign(u,{alive:true,recoil:0,pitch:0,yaw:0,switchT:0,invulT:0,stun:'',electricT:0,repairing:false,transfer:null,aimMul:1});Object.assign(e,{alive:true,hp:1e6,maxHp:1e6,invulT:0,weakT:0,armorAvg:1,partArmor:{head:1,body:1,arms:1,legs:1}});u.pos.set(0,200,0);e.pos.set(0,200,-60);u.vel.set(0,0,0);for(const q of[u,e]){q.group.position.copy(q.pos);g.weaponLook(q,0);}scene.updateMatrixWorld(true);g.camera.position.set(10,205,5);return u.slots[slot];};
  const aim=new T.Vector3(0,202.5,-100);
  const energy=Object.entries(g.ARMORY).flatMap(([cls,s])=>Object.entries(s).flatMap(([slot,keys])=>keys.filter(k=>g.WEAPONS[k].energy).map(key=>({cls,slot,key}))));
  for(const team of['B','R'])for(const {cls,slot,key}of energy){
   const sl=reset(cls,key,slot,team);if(sl.w.type==='gun')g.shot(u,sl,aim,0);else g.fire(u,aim,0,sl.w);const laser=sl.w.series==='ln',traces=g.fx.filter(f=>f.kind===(laser?'laser':'tracer'));
   yes(traces.length>0&&traces.every(f=>(laser||f.energy)&&f.obj.material.color.getHex()===0xb8ff32),team+'/'+key+' ライム色');
   g.fxUpdate(.04);yes(traces.every(f=>laser?near(f.obj.scale.y,f.len):f.obj.scale.x>=.06&&f.obj.scale.y<=18.00001&&f.obj.scale.y>0),team+'/'+key+(laser?' 即時のレーザー':' 遠方でも見えるレーザー状'));
  }
  reset('assault','rail');const hp=e.hp;g.fire(u,aim,0,g.WEAPONS.rail,new T.Vector3(0,202.5,0));const f=g.fx.find(f=>f.kind==='tracer');
  yes(e.hp<hp,'光学弾の命中ダメージは射撃時に発生');const impact=g.fx.find(q=>q.kind==='flash'&&q.age<0);yes(impact&&near(-impact.age,f.len/450),'着弾エフェクトの遅延は従来のまま');
  g.fxUpdate(f.len/450+.03);yes(f.obj.material.opacity>0&&f.obj.material.opacity<.95,'到達後の短い残光が薄れる');g.fxUpdate(.2);yes(!g.fx.includes(f)&&!f.obj.parent,'残光は消えて材質を片付ける');
  for(const team of['B','R']){reset('assault','ar','main',team);g.fire(u,aim,0,g.WEAPONS.ar);const r=g.fx.find(f=>f.kind==='tracer');g.fxUpdate(.04);yes(!r.energy&&r.obj.material.color.getHex()===0xffb84a&&r.obj.scale.y>5&&r.obj.scale.y<=24&&r.life>r.len/450,team+' 実弾を黄橙に統一し、筋と短い残光を維持');}
  reset('raid','glint');const sl=u.slots.main;g.weaponsTick(u,sl.w.chargeTime,true,aim,0);yes(!g.shells.length,'充填中は弾を出さない');g.weaponsTick(u,.01,false,aim,0);
  yes(g.shells.length===2&&g.shells.every(s=>s.energyFrom&&s.mesh.material.color.getHex()===0xb8ff32),'満充填の二丁光弾もライム色');yes(g.shells[0].mesh.geometry===g.shells[1].mesh.geometry&&g.shells[0].mesh.material===g.shells[1].mesh.material,'飛翔弾の形と材質を共有');
  const sh=g.shells[0],start=sh.pos.clone(),vel=sh.vel.clone(),life=sh.life;g.shellUpdate(.04);yes(sh.pos.distanceTo(start.clone().addScaledVector(vel,.04))<1e-6&&sh.vel.equals(vel)&&near(sh.life,life-.04),'光弾の位置・速度・寿命を変更しない');
  sh.mesh.updateMatrixWorld(true);const tip=sh.mesh.localToWorld(new T.Vector3()),tail=sh.mesh.localToWorld(new T.Vector3(0,1,0));yes(tip.distanceTo(sh.pos)<1e-6&&tail.clone().sub(tip).dot(sh.vel)<0&&sh.mesh.scale.y<=start.distanceTo(sh.pos)+1e-6,'尾は先端から後ろへ伸び、発射点を越えない');
  for(const [cls,key,slot]of[['heavy','charge','sub'],['heavy','plasma','sub']]){reset(cls,key,slot);g.shot(u,u.slots[slot],aim,0);const sh=g.shells[0],trail=sh?.mesh.getObjectByName('plasmaTrail')||sh?.mesh.getObjectByName('chargeTrail')||sh?.mesh;yes(sh?.energyFrom&&trail.material.color.getHex()===(key==='plasma'?0xff63cc:0xb8ff32),key+' の指定色の尾');}
  reset('heavy','plasma','sub');const wall=new T.Mesh(new T.BoxGeometry(8,12,.5),new T.MeshBasicMaterial());wall.position.set(0,203,-10);scene.add(wall);g.hittables.push(wall);wall.updateMatrixWorld(true);g.shot(u,u.slots.sub,aim,0);const m=g.shells[0].mesh;for(let i=0;i<10;i++)g.shellUpdate(.02);yes(!g.shells.length&&!m.parent&&e.hp===1e6,'プラズマ弾は壁で消え、背後へ直進しない');g.hittables.splice(g.hittables.indexOf(wall),1);scene.remove(wall);wall.geometry.dispose();wall.material.dispose();
  reset('heavy','rocket','sub');g.shot(u,u.slots.sub,aim,0);yes(g.shells.length&&!g.shells[0].energyFrom,'実体ロケットの形を継承');
  reset('assault','waveSword','aux');g.shoot(u,new T.Vector3(0,202,0),new T.Vector3(0,0,-70),g.WEAPONS.waveSword.chargeWave);yes(!g.shells[0].energyFrom,'光波剣は三日月のまま');
  reset('heavy','plasma','sub');g.shot(u,u.slots.sub,aim,0);const mesh=g.shells[0].mesh;g.selectMap('city');yes(!g.shells.length&&!mesh.parent,'マップ切替で飛翔弾を片付ける');
  return {energyWeapons:energy.length,teams:2,passed:checks.length,checks};
 });if(errors.length)throw Error(errors.join('\n'));if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({energyWeapons:result.energyWeapons,passed:result.passed,errors}));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
