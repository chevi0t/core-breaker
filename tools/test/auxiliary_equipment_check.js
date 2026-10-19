// node tools/test/auxiliary_equipment_check.js dbg/auxiliary [画像出力先] [追加前stats.json]
// AC補助35型、旧250種、連撃/充填/妨害/浮遊・巡航/平面索敵/補給/実入力と保存を確認。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),source=require('../../research/weapons/types/auxiliary.json');
(async()=>{
 const dir=path.resolve(process.argv[2]||'dbg/auxiliary'),out=path.resolve(process.argv[3]||path.join(dir,'auxiliary'));fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const p=await b.newPage({viewport:{width:1360,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto('file://'+path.join(dir,'dbg.html'));
  await p.evaluate(()=>{__g.renderer.render=()=>{const u=__g.units[0];if(u)u.group.parent.updateMatrixWorld();};__g.selectMap('dock');document.getElementById('start').click();__g.running=false;});
  const stats=await p.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));assert.equal(Object.keys(stats.weapons).length,285);const keys=[];
  for(const f of source.families){const ws=Object.values(stats.weapons).filter(w=>w.series===stats.weapons[f.base].series);assert.equal(ws.length,f.rows.length,f.base);
   for(const row of f.rows){const w=ws.find(w=>w.label===row.label);assert.ok(w,f.base+row.label);const P=w.proj||{},G=P.gun||{};keys.push(w.key);assert.ok(stats.armory[f.cls].aux.includes(w.key));
    for(const [k,v]of Object.entries(row.values)){
     const a=k==='normalHits'?w.normal.strikes.map(x=>x.dmg):k==='strongHits'?w.strong.strikes.map(x=>x.dmg):k==='count'?w.mag*w.mags:k==='gunEnergy'?G.energy:G[k]??P[k]??w[k];
     if(Array.isArray(v))assert.deepEqual(a,v,w.key+k);else if(typeof v==='boolean')assert.equal(a,v,w.key+k);else assert.ok(Math.abs(a-v)<1e-7,w.key+':'+k+' '+a+' != '+v);
    }assert.ok(/^[A-Z]{2}-\d+[A-Z0-9]*$/.test(w.model),w.model);
   }
  }assert.equal(keys.length,35);
  if(process.argv[4]){const old=JSON.parse(fs.readFileSync(process.argv[4]));for(const [k,w]of Object.entries(old.weapons))assert.deepEqual(stats.weapons[k],w,'旧武器 '+k);assert.deepEqual(stats.parts,old.parts);for(const [c,slots]of Object.entries(old.armory))for(const [sl,ks]of Object.entries(slots))assert.deepEqual(stats.armory[c][sl].filter(k=>ks.includes(k)),ks,'旧装備順');}
  console.log('AC補助35型・全285種、旧250種と36パーツ、初期装備順を照合');
  const checks=await p.evaluate(()=>{
   const g=__g,T=g.T,u=g.player,e=g.units.find(q=>q.team==='R'),a=g.units.find(q=>q.team==='B'&&q!==u),scene=u.group.parent,log=[];
   const yes=(v,m)=>{if(!v)throw new Error(m);log.push(m);},eq=(x,y)=>Math.abs(x-y)<1e-5;
   for(const q of g.units){q.alive=false;q.frozen=true;q.downT=0;q.pos.set(10000,0,10000);}for(const t of g.turrets)t.alive=false;
   const pos=new T.Vector3(-50,g.terrainH(-50,-48),-48),at=()=>e.pos.clone().add(new T.Vector3(0,2.4,0));
   function sync(){for(const q of g.units){q.group.position.copy(q.pos);q.group.rotation.y=q.yaw||0;q.group.visible=q.alive;}scene.updateMatrixWorld(true);}
   function clear(){g.clearSecondaryEffects();for(const sh of g.shells)scene.remove(sh.mesh);g.shells.length=0;for(const gd of g.gadgets.slice())g.removeGadget(gd);g.spotted.B.clear();g.spotted.R.clear();}
   function reset(key,cls){
    clear();u.isPlayer=true;g.loadout[cls].aux=key;g.equip(u,cls);g.selectWeapon(u,'aux');u.switchT=0;
    for(const q of [u,e,a]){Object.assign(q,{alive:true,hp:1e6,maxHp:1e6,invulT:0,downT:0,stun:'',stunT:0,electricT:0,jamT:0,weakT:0,repairing:false,transfer:null,barrierOn:false,escortOn:false,fieldOn:false,recoil:0,swing:null,lungeT:0,dashT:0,longDash:false,recoverT:0});q.vel.set(0,0,0);q.armorAvg=1;q.partArmor={head:1,body:1,arms:1,legs:1};q.onGround=true;for(const sl of Object.values(q.slots))if(sl.w.mag)Object.assign(sl,{ammo:sl.w.mag,reserve:sl.resMax,overheat:false,reloadT:0});}
    u.pos.copy(pos);u.yaw=u.pitch=0;u.flying=false;u.reloadMul=u.aimMul=1;u.meleeFired=0;e.pos.copy(pos).z-=3;a.pos.set(1000,0,1000);sync();return u.slots.aux;
   }
   function tick(t,trig=false,aim=at()){for(let n=0;n<Math.round(t/.01);n++){g.auxiliaryStatusTick(u,.01);g.weaponsTick(u,.01,trig,aim,0);g.shellUpdate(.01);g.secondaryUpdate(.01);g.gadgetUpdate(.01);sync();}}
   function place(S,p=pos.clone().add(new T.Vector3(0,0,-10)),vel=new T.Vector3(0,0,-1)){g.placeGadget({owner:u,team:u.team,spec:S,vel},p,null);return g.gadgets.at(-1);}
   for(const [key,want]of [['sabre',5500],['sabreM',10500],['rod',5000],['rodM',12500],['clawB',10000],['clawM',7000]]){reset(key,'assault');tick(.01,true);tick(1);yes(eq(1e6-e.hp,want),key+' 各段の合計威力 '+want);yes(u.meleeFired===1,key+' 1クリックの連撃で重複命中しない');}
   {reset('clawB','assault');u.dashT=.2;tick(.01,true);tick(1);yes(eq(1e6-e.hp,15500),'双爪の特殊5判定15500');g.weaponLook(u,.01);yes(u.blade2?.visible&&u.blade2.geometry===u.blade.geometry,'二刀は左右の専用モデルを表示');}
   for(const [hold,want]of [[.1,4500],[1.1,6750],[2.01,9000]]){reset('pike','heavy');tick(hold,true);yes(!u.swing,'蓄圧中は攻撃しない');tick(.01,false);tick(1);yes(eq(1e6-e.hp,want),'杭の段階威力 '+want);}
   {reset('pikeM','heavy');tick(3.01,true);u.dashT=.2;tick(.01,false);tick(1);yes(eq(1e6-e.hp,30000),'離す瞬間のダッシュで満充填強打30000');}
   {const sl=reset('pike','heavy');tick(10.2,true);yes(sl.overheat&&!u.swing,'満充填を8秒保持すると過熱');tick(2.1,false);yes(!sl.overheat,'杭の過熱が回復する');}
   {reset('pike','heavy');tick(1,true);g.selectWeapon(u,'main');u.switchT=0;tick(1);yes(!u.swing&&!u.meleeFired,'持ち替えで充填を消し、勝手に発射しない');}
   {const sl=reset('jammer','heavy');a.pos.copy(e.pos);sync();g.blast({owner:u,team:u.team,spec:sl.w.proj},at(),null);yes(e.jamT===5&&e.hp===1e6,'電子妨害は敵の視界だけを5秒妨害し損傷なし');yes(!a.jamT&&!u.jamT,'電子妨害は自機と味方に効かない');}
   {reset('jammer','heavy');u.jamT=5;g.lock.target=e;g.lock.visible=true;g.playerUpdate(u,.01);yes(!g.lock.target,'電子妨害中は近距離ロックを解除');g.updateCamera(u,.05);g.tagsHud(u,.01);yes(e.tagEl?.style.display==='none','電子妨害中は敵の頭上表示を隠す');g.hud(g.timeLeft,.01);yes(!document.getElementById('jamView').hidden,'電子妨害の画面効果を表示');g.auxiliaryStatusTick(u,5.1);yes(!u.jamT,'電子妨害の時間切れ');}
   {reset('ammoBox','support');u.hp=1000;u.maxHp=10000;a.pos.copy(pos).z-=5;a.hp=1000;a.maxHp=10000;sync();u.jamT=5;const sl=u.slots.sp,heat=sl.heat;g.repairTick(u,sl,.1,true,a.pos.clone().add(new T.Vector3(0,2.4,0)),false);yes(a.hp===1000&&sl.heat===heat,'電子妨害中は他者を修理できない');g.repairTick(u,sl,.1,false,a.pos,true);yes(u.hp>1000,'妨害中も右クリックの自己修理は使える');}
   {const sl=reset('stunGrenade','raid');const old=e.pos.clone();g.blast({owner:u,team:u.team,spec:sl.w.proj},at(),null);yes(e.electricT===2.5&&e.hp===1e6,'電撃弾は2.5秒の硬直、損傷なし');const ammo=e.slots.main.ammo;g.weaponsTick(e,.1,true,pos,0);yes(e.slots.main.ammo===ammo,'硬直中は撃てない');g.physics(e,new T.Vector3(1,0,0),true,true,.01,true);yes(eq(e.pos.x,old.x)&&eq(e.pos.z,old.z)&&e.vel.y===0,'硬直中は移動・ダッシュ・ジャンプ不可');for(let i=0;i<260;i++){g.auxiliaryStatusTick(e,.01);g.physics(e,new T.Vector3(),false,false,.01);}yes(!e.electricT&&!e.stun,'硬直は時間で回復');}
   {const sl=reset('airTurret','raid');e.pos.z=pos.z-20;g.shoot(u,pos.clone().add(new T.Vector3(0,4,0)),new T.Vector3(0,0,-22),sl.w.proj);tick(1.5);const gd=g.gadgets[0];yes(gd?.pos.y>pos.y+4,'投射した空中から浮上して停滞');yes(e.hp<1e6,'浮遊自動銃が見える敵へ実射');gd.ammo=0;gd.reloadT=.1;g.gadgetUpdate(.11);yes(gd.ammo===sl.w.proj.gun.mag,'無限の弾倉を腕の装填倍率で再装填');}
   {const sl=reset('airTurret','raid');const p=pos.clone().add(new T.Vector3(0,1,-10)),roof=new T.Mesh(new T.BoxGeometry(8,.5,8),new T.MeshBasicMaterial());roof.position.copy(p).y+=1;scene.add(roof);g.hittables.push(roof);sync();const gd=place(sl.w.proj,p);for(let i=0;i<100;i++)g.gadgetUpdate(.01);yes(!gd.riseLeft&&gd.pos.y<roof.position.y-.4,'天井に接触すると浮上を止める');g.hittables.splice(g.hittables.indexOf(roof),1);scene.remove(roof);roof.geometry.dispose();roof.material.dispose();}
   {const sl=reset('flyTurret','raid');e.pos.z=pos.z-20;const gd=place(sl.w.proj,pos.clone().add(new T.Vector3(0,7,-8))),z=gd.pos.z;sync();g.gadgetUpdate(.5);yes(eq(gd.pos.z,z-5),'巡航自動銃が投擲方向へ10m/sで前進');for(let i=0;i<150;i++)g.gadgetUpdate(.01);yes(e.hp<1e6,'巡航しながら下方へ射撃');g.gadgetUpdate(9);yes(!gd.alive&&!gd.mesh.parent,'飛行時間が終わると消滅');}
   {const sl=reset('planeSensor','support'),gd=place(sl.w.proj);e.pos.set(gd.pos.x+30,gd.pos.y,gd.pos.z-15);g.planarSensorTick(gd);yes(!g.spotted.B.has(e),'面の前後方向だけにいる敵を検出しない');e.pos.z=gd.pos.z+15;g.planarSensorTick(gd);yes(g.spotted.B.get(e)===10,'フレーム間で平面を横断しても10秒表示');g.spotted.B.clear();e.pos.z+=10;g.planarSensorTick(gd);yes(!g.spotted.B.has(e),'面を離れた後は球状範囲として再検出しない');}
   {const sl=reset('planeSensor','support');u.yaw=Math.PI/2;const gd=place(sl.w.proj);e.pos.set(gd.pos.x-15,gd.pos.y,gd.pos.z+40);g.planarSensorTick(gd);e.pos.x=gd.pos.x+15;g.planarSensorTick(gd);yes(g.spotted.B.has(e),'設置時の向きで索敵面が90度変わる');}
   {const sl=reset('ammoBox','support'),aux=sl.ammo+sl.reserve;u.slots.main.ammo--;u.slots.sub.reserve--;u.slots.main.reloadT=3;u.slots.main.overheat=true;u.slots.main.temp=100;u.slots.sp.heat=34;const gd=place(sl.w.proj,pos.clone().add(new T.Vector3(0,0,-1)));g.gadgetUpdate(.2);yes(!gd.alive&&u.slots.main.ammo===u.slots.main.w.mag&&u.slots.sub.reserve===u.slots.sub.resMax,'自己拾得で主・副武器を全補給');yes(!u.slots.main.overheat&&!u.slots.main.reloadT&&u.slots.main.temp===0,'補給で装填・過熱を解消');yes(sl.ammo+sl.reserve===aux&&u.slots.sp.heat===34,'補助装備とSPは補給しない');}
   {const sl=reset('ammoBox','support');e.slots.main.ammo--;const gd=place(sl.w.proj,e.pos.clone().add(new T.Vector3(0,0,1)));g.gadgetUpdate(.2);yes(!gd.alive&&e.slots.main.ammo===e.slots.main.w.mag,'敵も弾薬箱を拾える');}
   {const sl=reset('ammoBox','support');const gd=place(sl.w.proj,pos.clone().add(new T.Vector3(0,0,-1)));g.gadgetUpdate(.5);yes(gd.alive,'主副が満タンなら拾得しない');g.damage(gd,e,1e9);yes(gd.alive&&!g.hittables.includes(gd.mesh),'補給コンテナは破壊不可で射線を塞がない');}
   {const sl=reset('radarTool','raid');e.pos.copy(pos).add(new T.Vector3(0,100,-100));g.radarToolTick(u,sl,.5,true);yes(!g.spotted.B.has(e),'レーダーは展開直後に最大距離を見ない');g.radarToolTick(u,sl,1.5,true);yes(g.spotted.B.get(e)===12,'展開後は高低差を問わず12秒表示');u.yaw=Math.PI;g.radarToolTick(u,sl,.1,true);yes(Math.abs(u.yaw-u.radarHeading)<=Math.PI/6+1e-8,'展開式レーダーは左右30度まで旋回');const before=u.pos.clone();g.physics(u,new T.Vector3(1,0,0),true,true,.05,true);yes(u.pos.distanceTo(before)<.01,'レーダー展開中は移動・ダッシュ・ジャンプ不可');g.radarToolTick(u,sl,.1,false);yes(!sl.scanRadius,'持ち替えで索敵範囲を解除');}
   {const sl=reset('radarToolA','raid');e.pos.copy(pos).add(new T.Vector3(100,40,0));g.radarToolTick(u,sl,2,true);yes(g.spotted.B.has(e),'全周型は側方も索敵する');}
   {const sl=reset('pike','heavy');u.repairing=true;tick(3,true);yes(!sl.chargeT&&!u.swing,'ポッド使用中は新しい補助装備も使用不可');}
   {reset('radarTool','raid');u.isPlayer=false;const act=g.botAct(u,false,g.cores.R);yes(act?.slot==='aux','Botが展開式レーダーの行動を選ぶ');}
   {reset('ammoBox','support');u.isPlayer=false;u.slots.main.ammo--;const act=g.botAct(u,false,g.cores.R);yes(act?.slot==='aux','Botが弾薬不足に応じて補給箱を使う');}
   {reset('rod','assault');g.weaponLook(u,.01);g.tagsHud(u,.01);const b2=u.blade2,tag=e.tagEl;g.selectMap('city');yes(!g.hittables.includes(b2)&&!u.group.parent,'マップ切替で追加の二刀モデルと判定を片付ける');yes(!tag?.isConnected,'最新mainの頭上表示も片付ける');}
   return log;
  });console.log(checks.join('\n'));
  // ポインタロック中の実押下・解放で杭を充填して撃つ。
  await p.evaluate(()=>{document.getElementById('start').click();const g=__g,u=g.player;for(const q of g.units)q.frozen=true;g.loadout.heavy.aux='pikeM';g.equip(u,'heavy');g.selectWeapon(u,'aux');Object.assign(u,{switchT:0,repairing:false,stun:'',electricT:0,transfer:null,yaw:0,pitch:0,meleeFired:0});window.__dt=.05;});
  await p.evaluate(()=>document.exitPointerLock());await p.waitForFunction(()=>!document.pointerLockElement);await p.mouse.move(680,450);await p.mouse.down();await p.waitForFunction(()=>__g.player.slots.aux.chargeT>=3,{},{timeout:15000});await p.mouse.up();await p.waitForFunction(()=>__g.player.meleeFired>0);await p.evaluate(()=>{__g.running=false;document.exitPointerLock();});await p.waitForFunction(()=>!document.pointerLockElement);
  await p.evaluate(()=>{__g.renderCustom();__g.showPage('pgCustom');document.getElementById('overlay').hidden=false;});
  for(const [cls,series,key,file]of [['assault','sc','clawB','claw'],['heavy','gj','pikeM','pike'],['raid','io','airTurretE','air'],['raid','is','radarToolA','radar'],['support','ix','planeSensorW','plane'],['support','ib','ammoBoxW','ammo']]){
   await p.click(`#pgCustom [data-cu="${cls}"]`);await p.click('[data-cslot="aux"]');const h=p.locator(`[data-series="${series}"]`);if(await h.getAttribute('aria-expanded')!=='true')await h.click();await p.locator(`[data-pick="${key}"]`).hover();assert.match(await p.locator('#cuDiff').innerText(),/[▲▼]/);await p.screenshot({path:path.join(out,file+'.png')});await p.click(`[data-pick="${key}"]`);
  }
  await p.reload();assert.deepEqual(await p.evaluate(()=>['assault','heavy','raid','support'].map(c=>__g.loadout[c].aux)),['clawB','pikeM','radarToolA','ammoBoxW'],'保存と再読み込み');assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'stats.json'),JSON.stringify(stats,null,2));console.log(checks.length+'項目＋実押下/解放の充填攻撃＋6画面の型比較と保存：成功。エラーなし');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
