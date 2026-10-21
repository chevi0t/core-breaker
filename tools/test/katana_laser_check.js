// 日本刀の上下4段・無料の小跳躍・片手打ち、レーザー刃の実リーチと型ごとの範囲/隙。
// node tools/test/katana_laser_check.js dbg/katana-laser [結果JSON]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.addInitScript(()=>requestAnimationFrame=()=>0);await p.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
 const result=await p.evaluate(()=>{
  const g=__g,T=g.T,u=g.player,checks=[],yes=(v,m)=>{if(!v)throw Error(m);checks.push(m);},eq=(x,y)=>Math.abs(x-y)<1e-5;
  g.selectMap('dock');document.getElementById('start').click();g.running=false;g.renderer.render=()=>{};
  const unit=g.player,e=g.units.find(q=>q.team!==unit.team),base=new T.Vector3(-50,g.terrainH(-50,-48),-48),rays=[],ranges=[];
  for(const q of g.units){q.frozen=true;q.alive=false;q.pos.set(10000,100,10000);}for(const t of g.turrets)t.alive=false;
  function reset(key,{dist=3,angle=0,lift=0,strong=true}={}){
   g.loadout.assault.aux=key;g.equip(unit,'assault');g.selectWeapon(unit,'aux');
   for(const q of [unit,e]){Object.assign(q,{alive:true,hp:1e6,maxHp:1e6,invulT:0,weakT:0,downT:0,stun:'',stunT:0,electricT:0,ctrlLockT:0,repairing:false,transfer:null,yaw:0,pitch:0,swing:null,lungeT:0,recoverT:0,slideT:0,dashT:0,longDash:false,onGround:true,flying:false,catCd:0,jumpBuf:0,boost:0,overheat:true});q.armorAvg=1;q.partArmor={head:1,body:1,arms:1,legs:1};q.vel.set(0,0,0);}
   unit.isPlayer=true;unit.switchT=0;unit.dashT=strong?.2:0;unit.pos.copy(base);e.pos.set(base.x-Math.sin(angle)*dist,base.y+lift,base.z-Math.cos(angle)*dist);g.lock.target=null;return unit.slots.aux;
  }
  const aim=()=>unit.pos.clone().add(new T.Vector3(0,2.4,-100));
  function attack(key,opt={}){
   const sl=reset(key,opt),dt=opt.dt||1/60,stages=[];let previous=e.hp;g.swordTick(unit,sl,dt,true,aim());
   for(let n=0;unit.swing&&n<500;n++){g.swordTick(unit,sl,dt,false,aim());g.fxUpdate(dt);if(e.hp!==previous){stages.push({time:n*dt,damage:previous-e.hp});previous=e.hp;}}
   return {damage:1e6-e.hp,stages};
  }
  for(const [key,want]of[['sabre',12000],['sabreH',18000],['sabreM',20000]]){
   yes(g.WEAPONS[key].name.startsWith('日本刀'),key+' 表示名を日本刀へ変更、保存キーは維持');
   for(const dt of [1/30,1/60,1/120]){const a=attack(key,{dt});yes(eq(a.damage,want)&&a.stages.length===4,key+'/'+dt+' 4段の実損傷とFPS差 '+JSON.stringify(a));}
  }
  const elevated=attack('sabre',{lift:5});yes(eq(elevated.damage,4500),'日本刀：高い正面の相手へ縦の面打ちだけが命中 '+JSON.stringify(elevated));
  yes(attack('sabre',{angle:Math.PI}).damage===0,'日本刀：背後を回転斬りのように攻撃しない');
  for(const key of ['claw','clawH','clawB','clawM']){
   const a=attack(key),w=g.WEAPONS[key];yes(a.stages.length===2&&eq(a.damage,w.strong.dmg),key+' 右袈裟→左袈裟の2段が各1回命中');
   let max=0;for(let dist=4.5;dist<=10;dist+=.5)if(attack(key,{dist}).damage)max=dist;
   let maxAngle=0;for(let angle=40;angle<=110;angle+=5)if(attack(key,{dist:3,angle:angle*Math.PI/180}).damage)maxAngle=angle;
   ranges.push({key,max,maxAngle,reach:w.strong.reach,span:w.strong.strikes[0].to-w.strong.strikes[0].from,windup:w.strong.windup,recover:w.strong.recover,time:w.strong.time});
   yes(attack(key,{dist:6,strong:false}).damage===0,key+' 通常の爪は遠方に届かない');
   yes(attack(key,{angle:Math.PI}).damage===0,key+' レーザー刃も正面の斬撃');
  }
  yes(ranges[0].max>=6,'基本型のレーザー刃が旧爪の範囲外へ実損傷 '+JSON.stringify(ranges));
  for(let n=1;n<ranges.length;n++){
   const a=ranges[n-1],b=ranges[n];yes(b.max>a.max&&b.span>a.span&&b.recover>a.recover&&b.time>a.time,b.key+' 上位型ほど実リーチ・薙ぐ幅・隙が拡大');
  }
  yes(ranges.at(-1).maxAngle>ranges[0].maxAngle,'上位の袈裟斬りは側方へ届く角度も広い '+JSON.stringify(ranges));
  // 描画の刃先を実メッシュから測り、上下の振りと片手への切替を検査する。
  function pose(key,t){
   reset(key);g.swordTick(unit,unit.slots.aux,1/120,true,aim());unit.swing.t=t;
   unit.group.position.set(0,0,0);unit.group.rotation.set(0,0,0);g.weaponLook(unit,1/120);unit.group.updateMatrixWorld(true);
   const blade=unit.blade,tip=new T.Vector3(0,0,blade.geometry.boundingBox.min.z).applyMatrix4(blade.matrixWorld);
   const grip=blade.userData.grip.clone();const left=unit.rig.bones.handL.node.getWorldPosition(new T.Vector3());
   return {tip,grip,left,blade,body:unit.group.rotation.y};
  }
  const down0=pose('sabre',.15),down1=pose('sabre',.34),up0=pose('sabre',.46),up1=pose('sabre',.64);
  yes(down0.tip.y>down1.tip.y+2&&up1.tip.y>up0.tip.y+2,'日本刀：実際の刃先が袈裟で下がり、逆袈裟で上がる');
  const top=pose('sabre',1.24),bottom=pose('sabre',1.59);
  yes(top.tip.y>bottom.tip.y+5&&Math.abs(top.tip.x-bottom.tip.x)<.6,'面打ち：大きな縦軌道で振り下ろす');
  yes(top.left.distanceTo(top.grip)>.7&&down0.left.distanceTo(down0.grip)<.41,'日本刀：最終段だけ左手を離す');
  const laser=pose('clawM',.3),edge=laser.blade.userData.laserBlade;
  yes(edge.visible&&edge.userData.length>7&&laser.blade.scale.z===1,'上位のレーザー刃だけが伸び、爪本体は元の寸法');
  const laserLength=edge.userData.length;unit.swing=null;g.weaponLook(unit,.01);yes(!edge.visible,'中断でレーザー刃を消す');
  // 本体の物理で小跳躍を確認。残量0・過熱からでも無料、空中で二段跳躍しない。
  const hops=[];
  for(const dt of [1/30,1/60,1/120]){
   const sl=reset('sabre');e.alive=false;g.swordTick(unit,sl,dt,true,aim());let max=0,minBoost=unit.boost,count=0,wasUp=false;
   for(let n=0;n<Math.ceil(3/dt);n++){
    g.physics(unit,new T.Vector3(),false,false,dt);g.swordTick(unit,sl,dt,false,aim());g.fxUpdate(dt);
    max=Math.max(max,unit.pos.y-base.y);minBoost=Math.min(minBoost,unit.boost);
    if(unit.vel.y>0&&!wasUp)count++;wasUp=unit.vel.y>0;
   }
   yes(max>.9&&max<1.3&&count===1&&minBoost>=0&&unit.onGround,'日本刀：'+dt+'秒刻み、無料の小跳躍1回と着地 '+[max,count,minBoost]);hops.push({dt,max,count,minBoost});
  }
  {const sl=reset('sabre');unit.onGround=false;unit.pos.y+=5;unit.vel.y=-1;g.swordTick(unit,sl,.01,true,aim());for(let n=0;n<220;n++){g.swordTick(unit,sl,.01,false,aim());g.fxUpdate(.01);}yes(unit.vel.y===-1,'空中開始では無料の追加跳躍を作らない');}
  {const sl=reset('sabre');g.swordTick(unit,sl,.01,true,aim());const sw=unit.swing;g.swordTick(unit,sl,.8,false,aim());g.jolt(unit,e.pos,3500,true);for(let n=0;n<200;n++)g.swordTick(unit,sl,.01,false,aim());yes(!sw.hopDone&&!unit.swing,'小跳躍前のよろけで技と跳躍を中断');}
  {const sl=reset('sabre'),roof={minX:base.x-10,maxX:base.x+10,minZ:base.z-15,maxZ:base.z+10,bottom:base.y+4.25,top:base.y+5};e.alive=false;g.obstacles.push(roof);g.swordTick(unit,sl,.01,true,aim());let max=0;
   try{for(let n=0;n<250;n++){g.physics(unit,new T.Vector3(),false,false,.01);g.swordTick(unit,sl,.01,false,aim());g.fxUpdate(.01);max=Math.max(max,unit.pos.y-base.y);}yes(max<=.251,'小跳躍でも低い天井を突き抜けない '+max);}finally{g.obstacles.splice(g.obstacles.indexOf(roof),1);}}
  // 再出撃・持ち替え・マップ破棄は光と跳躍を残さない。
  pose('clawM',.3);const light=unit.blade.userData.laserBlade;g.jolt(unit,e.pos,3500,true);g.weaponLook(unit,.01);yes(!light.visible,'被弾で左右のレーザー刃を消す');
  g.spawn(unit);g.weaponLook(unit,.01);yes(!unit.swing&&!light.visible,'再出撃にレーザーと跳躍を持ち越さない');
  g.selectMap('city');yes(!unit.group.parent,'マップ破棄でレーザーを含む機体を外す');
  return {passed:checks.length,ranges,hops,laserLength,checks};
 });
 assert.deepEqual(errors,[]);if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));console.log(JSON.stringify({...result,checks:undefined},null,2));console.log('日本刀・レーザー爪 '+result.passed+'項目：成功。ブラウザエラーなし');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
