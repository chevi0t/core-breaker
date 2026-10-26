// GM/LV各型の画面上の視認性と、描画変更前後の武器数値・実射・乱数・弾道の一致を確認。
// node tools/test/bullet_visibility_check.js dbg/bullets dbg/bullets-base /tmp/bullet-check
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const out=path.resolve(process.argv[4]||'/tmp/bullet-check');fs.mkdirSync(out,{recursive:true});const errors=[];
 try{
  async function sample(folder,version){
   const p=await browser.newPage({viewport:{width:960,height:720}});p.on('pageerror',e=>errors.push(e.stack));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
   await p.goto('file://'+path.resolve(folder,'dbg.html'));
   const result=await p.evaluate(()=>{
    const g=__g,T=g.T;g.selectMap('dock');g.setup();g.running=false;
    const u=g.player,e=g.units.find(q=>q.team!==u.team),source=new T.Vector3(0,202.6,0),aim=new T.Vector3(0,202.6,-60);
    for(const q of g.units){q.alive=false;q.frozen=true;q.pos.set(10000,100,10000);q.group.visible=false;}for(const q of g.turrets)q.alive=false;
    const box=new T.Mesh(new T.BoxGeometry(12,12,1),new T.MeshBasicMaterial());box.position.set(0,202.6,-60);box.userData.ref=e;box.userData.armorSlot='body';g.scene.add(box);g.hittables.length=0;g.hittables.push(box);box.updateMatrixWorld(true);
    const clear=()=>{g.fxUpdate(20);for(const s of g.shells)g.scene.remove(s.mesh);g.shells.length=0;};
    function reset(key,team='B'){
     clear();const location=Object.entries(g.ARMORY).flatMap(([cls,slots])=>Object.entries(slots).flatMap(([slot,keys])=>keys.includes(key)?[{cls,slot}]:[]))[0];Object.assign(u.mech,g.MECH_DEFAULT);g.equip(u,location.cls);u.slots[location.slot]=g.slotOf(key);u.weapon=location.slot;
     Object.assign(u,{alive:true,team,isPlayer:true,switchT:0,stun:'',electricT:0,ctrlLockT:0,recoil:0,recoilYaw:0,cameraRecoil:0,cameraRecoilYaw:0,invulT:0,yaw:0,pitch:0,onGround:true,repairing:false,transfer:null,aimMul:1,overheat:false});
     u.pos.set(0,200,0);u.vel.set(0,0,0);u.group.position.copy(u.pos);g.weaponLook(u,0);
     Object.assign(e,{alive:true,team:team==='B'?'R':'B',hp:1e9,maxHp:1e9,invulT:0,weakT:0,armorAvg:1,partArmor:{head:1,body:1,arms:1,legs:1},stun:'',stunT:0,ctrlLockT:0,repairing:false});e.pos.set(0,200,-60);e.vel.set(0,0,0);
     g.camera.position.set(0,202.6,10);g.camera.lookAt(0,202.6,-100);g.camera.fov=70;g.camera.updateProjectionMatrix();g.camera.updateMatrixWorld(true);g.lock.target=null;
     return u.slots[location.slot];
    }
    const fire=sl=>{if(sl.w.chargeOrb){sl.chargeT=sl.w.chargeTime;g.weaponsTick(u,.001,false,aim,0);}else g.shot(u,sl,aim,0);};
    const gm=Object.keys(g.WEAPONS).filter(k=>g.WEAPONS[k].series==='gm'),lv=Object.keys(g.WEAPONS).filter(k=>g.WEAPONS[k].series==='lv');
    // 異なる系統も、飛翔/即時命中/散弾/レーザー/充填/ロケット/榴弾を実射比較する。
    const keys=[...new Set([...gm,...lv,'ar','gatling','shotgunQ','aurora','rail','lzsniper','zoom','rocket','scrum','grenade','gl','plasma','charge','glint'])];
    const shots=[];
    for(const key of keys){
     const sl=reset(key);let seed=58312,draws=0;const rnd=Math.random;
     Math.random=()=>{draws++;seed=Math.imul(seed,1664525)+1013904223>>>0;return seed/4294967296;};
     try{
      fire(sl);const start=g.shells.map(s=>({pos:s.pos.toArray(),vel:s.vel.toArray(),life:s.life,spec:s.spec}));
      const trace=g.fx.filter(f=>f.kind==='tracer'||f.kind==='laser').map(f=>({kind:f.kind,len:f.len,life:f.life,age:f.age,segment:f.segment,fade:f.fade}));
      const states=[];for(let i=0;i<20;i++){g.shellUpdate(.02);g.fxUpdate(.02);states.push({hp:e.hp,shells:g.shells.map(s=>({pos:s.pos.toArray(),vel:s.vel.toArray(),life:s.life}))});}
      shots.push({key,start,trace,states,recoil:[u.recoil,u.recoilYaw],ammo:sl.ammo,rng:{draws,seed}});
     }finally{Math.random=rnd;}
    }
    const closed=geo=>{const n=geo.getAttribute('normal');for(let i=0;i<n.count;i++)if(Math.abs(n.getY(i))>.99)return true;return false;};
    const visuals=[];
    for(const team of ['B','R'])for(const key of [...gm,...lv]){
     const sl=reset(key,team);g.fire(u,aim,0,sl.w,source);const f=g.fx.find(x=>x.kind==='tracer');g.fxUpdate(.04);
     const pixels=f.obj.scale.x*innerHeight/(f.obj.position.distanceTo(g.camera.position)*Math.tan(g.camera.fov*Math.PI/360));
     visuals.push({team,key,energy:!!f.energy,color:f.obj.material.color.getHex(),width:f.obj.scale.x,pixels,depthTest:f.obj.material.depthTest,depthWrite:f.obj.material.depthWrite,fog:f.obj.material.fog,blend:f.obj.material.blending,open:!closed(f.obj.geometry),length:f.obj.scale.y});
    }
    const projectiles=[];
    for(const key of ['rocket','scrum','grenade','gl','plasma','charge','glint']){
     const sl=reset(key);fire(sl);const fired=g.shells.length;g.shellUpdate(.04);const s=g.shells[0];if(!s)throw Error(key+'：飛翔確認用の弾がない '+JSON.stringify({fired,proj:sl.w.proj,from:g.muzzle(u).toArray()}));const head=s.mesh.getObjectByName('plasmaHead')||s.mesh.getObjectByName('chargeHead'),trail=s.mesh.getObjectByName('plasmaTrail')||s.mesh.getObjectByName('chargeTrail');
     projectiles.push({key,scale:s.mesh.scale.toArray(),color:(trail||s.mesh).material?.color.getHex(),width:trail?.scale.x,head:head?.scale.x,energy:!!s.energyFrom,open:!closed((trail||s.mesh).geometry)});
    }
    const secondarySizes=[];
    const subKeys=[...new Set(Object.values(g.ARMORY).flatMap(a=>a.sub))];
    for(const key of subKeys){
     const sl=reset(key);const rnd=Math.random;let seed=12345;Math.random=()=>{seed=Math.imul(seed,1664525)+1013904223>>>0;return seed/4294967296;};try{fire(sl);g.fxUpdate(.001);}finally{Math.random=rnd;}
     secondarySizes.push({key,projectiles:g.shells.map(s=>({scale:s.mesh.scale.toArray(),children:s.mesh.children.map(m=>({name:m.name,scale:m.scale.toArray()}))})),traces:g.fx.filter(f=>['tracer','laser'].includes(f.kind)).map(f=>({kind:f.kind,scale:f.obj.scale.toArray(),length:f.len}))});
    }
    const switchSizes=[];
    for(const key of ['glint','charge']){
     const sl=reset(key);fire(sl);u.weapon=key==='glint'?'sub':'main';g.shellUpdate(.04);const m=g.shells[0].mesh;
     switchSizes.push({key,scale:m.scale.toArray(),children:m.children.map(c=>({name:c.name,scale:c.scale.toArray()}))});
    }
    reset('ar');g.shoot(u,source,new T.Vector3(0,0,-50),g.WEAPONS.waveSword.chargeWave);const waveScale=g.shells[0].mesh.scale.toArray();
    // 陣営変更メニュー経由でも弾種色を維持する。
    const teamColors=[];
    for(const team of ['R','B']){
     const radio=document.querySelector('#teamChoice input[value="'+team+'"]');radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));
     reset('mg',team);g.fire(u,aim,0,g.WEAPONS.mg,source);teamColors.push(g.fx.find(f=>f.kind==='tracer').obj.material.color.getHex());
    }
    reset('glint');fire(u.slots.main);const meshes=g.shells.map(s=>s.mesh);g.selectMap('city');const cleanup=!g.shells.length&&meshes.every(m=>!m.parent);
    window.bulletFixture={g,reset,clear,source,aim};
    return {catalog:JSON.stringify({weapons:g.WEAPONS,parts:g.PARTS,armory:g.ARMORY}),gm,lv,shots,visuals,projectiles,secondarySizes,switchSizes,waveScale,teamColors,cleanup};
   });
   // 射手の真後ろから、明暗背景の実ピクセルを検査。光学弾の開いた端面もここで検出する。
   result.pixels=[];
   for(const light of [false,true])for(const key of ['mg','vulcan']){
    const image=await p.evaluate(({light,key})=>{
     const {g,clear}=bulletFixture,T=g.T;clear();g.camera.position.set(0,0,10);g.camera.lookAt(0,0,-100);g.camera.fov=70;g.camera.updateProjectionMatrix();g.camera.updateMatrixWorld(true);
     const background=light?0xdfe6eb:0x18252f,scene=new T.Scene();scene.background=new T.Color(background);scene.fog=new T.FogExp2(0x808080,.04);
     g.tracer(new T.Vector3(0,0,0),new T.Vector3(0,0,-150),'B',!!g.WEAPONS[key].energy,g.WEAPONS[key]);g.fxUpdate(.18);const f=g.fx.find(x=>x.kind==='tracer');scene.add(f.obj);g.renderer.render(scene,g.camera);
     const gl=g.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);let colored=0,visible=0;const bg=new T.Color(background);const rgb=[bg.r*255,bg.g*255,bg.b*255];
     const isEnergy=!!g.WEAPONS[key].energy;
     for(let y=h/2-18;y<h/2+18;y++)for(let x=w/2-18;x<w/2+18;x++){
      const i=(y*w+x)*4,[r,g0,b]=data.subarray(i,i+3);if([r,g0,b].some((v,j)=>Math.abs(v-rgb[j])>24))visible++;if(isEnergy?g0>150&&g0>r*1.2&&g0>b*1.5:r>150&&r>g0*1.1&&g0>b*1.5)colored++;
     }
     const png=g.renderer.domElement.toDataURL('image/png');
     // 見た目を大きくしても壁の裏へ透かさない。
     const wall=new T.Mesh(new T.PlaneGeometry(30,30),new T.MeshBasicMaterial({color:background}));wall.position.set(0,0,-5);scene.add(wall);g.renderer.render(scene,g.camera);
     const hidden=new Uint8Array(4);gl.readPixels(w/2,h/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,hidden);
     scene.remove(f.obj);g.renderer.render(scene,g.camera);const reference=new Uint8Array(4);gl.readPixels(w/2,h/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,reference);return {key,light,colored,visible,png,hidden:Array.from(hidden),reference:Array.from(reference)};
    },{light,key});
    fs.writeFileSync(path.join(out,version+'-'+key+'-'+(light?'light':'dark')+'.png'),Buffer.from(image.png.split(',')[1],'base64'));delete image.png;result.pixels.push(image);
   }
   await p.close();return result;
  }
  const old=await sample(process.argv[3],'before'),now=await sample(process.argv[2],'after'),checks=[];
  const yes=(v,m)=>{assert(v,m);checks.push(m);};
  assert.equal(now.catalog,old.catalog);yes(true,'全武器・パーツ・装備一覧の実行時数値は変更前と一致');
  assert(now.gm.length>=3&&now.lv.length>=3);assert.deepEqual(now.gm,old.gm);assert.deepEqual(now.lv,old.lv);
  for(const row of now.shots){assert.deepEqual(row,old.shots.find(x=>x.key===row.key),row.key+'：命中・軌道・時刻・反動・弾数・乱数が一致');yes(true,row.key+'：実射と戦闘乱数を維持');}
  for(const row of now.visuals){
   const before=old.visuals.find(x=>x.team===row.team&&x.key===row.key);
   yes(row.color===(row.energy?0xb8ff32:0xffb84a),row.team+'/'+row.key+'：弾種の色');
   yes(row.pixels>=5.19&&row.width>=before.width*1.99,row.key+'：画面上の太さを確保、従来の2倍以上');
   yes(row.depthTest&&!row.depthWrite&&!row.fog&&!row.open&&row.blend===1,row.key+'：端面・明暗背景・奥行き');
   assert.equal(row.length,before.length);
  }
  for(const row of now.projectiles){const before=old.projectiles.find(x=>x.key===row.key);if(row.head){yes(Math.abs(row.head/before.head-1)<1e-6&&Math.abs(row.width/before.width-1)<1e-6,row.key+'：副武器の砲を拡大前の寸法へ復帰');}else if(row.energy){yes(row.scale[0]>=before.scale[0]*1.99,row.key+'：飛翔光弾を拡大');}else{yes(Math.abs(row.scale[0]/before.scale[0]-1)<1e-6,row.key+'：副武器の実体弾を拡大前の寸法へ復帰');}}
  for(const row of now.secondarySizes){assert.deepEqual(row,old.secondarySizes.find(x=>x.key===row.key),row.key+'：副武器の描画寸法を#84前と照合');yes(true,row.key+'：副武器の寸法を拡大前へ復帰');}
  assert.deepEqual(now.switchSizes[1],old.switchSizes[1]);yes(true,'副武器発射後に主武器へ持ち替えても拡大しない');yes(now.switchSizes[0].scale[0]>=old.switchSizes[0].scale[0]*1.99,'主武器発射後に副武器へ持ち替えても視認性を維持');
  assert.deepEqual(now.waveScale,old.waveScale);yes(now.cleanup,'光波剣は維持、マップ切替で弾を片付け');
  yes(now.teamColors.every(c=>c===0xffb84a),'陣営を変更しても黄橙の実弾');
  for(const row of now.pixels){
   const before=old.pixels.find(x=>x.key===row.key&&x.light===row.light);yes(row.colored>=12,row.key+'/'+row.light+'：射手の真後ろから弾の色を12px以上描画');
   if(row.key==='mg')yes(row.visible>=before.visible*2.8,row.key+'：明暗背景で表示面積を拡大');
   yes(row.hidden.every((v,i)=>v===row.reference[i]),'壁の裏へ弾を表示しない');
  }
  assert.deepEqual(errors,[]);const output={checks,gm:now.gm,lv:now.lv,shots:now.shots.length,pixels:{before:old.pixels,after:now.pixels},visuals:now.visuals,projectiles:now.projectiles,secondaryWeapons:now.secondarySizes.length,errors};
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,gm:now.gm,lv:now.lv,shots:now.shots.length,secondaryWeapons:now.secondarySizes.length,pixels:now.pixels,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
