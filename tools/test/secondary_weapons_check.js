// AC追加副武器：数値・旧217種の互換性・固有挙動・実クリック・カスタマイズを検証する。
// node tools/test/secondary_weapons_check.js dbg/secondary [画像出力先] [追加前stats.json]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),source=require('../../research/weapons/types/secondary.json');
(async()=>{
 const dir=path.resolve(process.argv[2]||'dbg/secondary'),out=path.resolve(process.argv[3]||path.join(dir,'secondary'));
 fs.mkdirSync(out,{recursive:true});const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try {
  const p=await b.newPage({viewport:{width:1280,height:900}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto('file://'+path.join(dir,'dbg.html'));
  await p.evaluate(()=>{__g.renderer.render=()=>{const u=__g.units[0];if(u)u.group.parent.updateMatrixWorld();};__g.selectMap('dock');document.getElementById('start').click();__g.running=false;});
  const stats=await p.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));
  assert.ok(Object.keys(stats.weapons).length>=250);const newKeys=[];
  for(const f of source.families){
   const ws=Object.values(stats.weapons).filter(w=>w.series===stats.weapons[f.base].series);assert.equal(ws.length,f.rows.length,f.base);
   for(const row of f.rows){const w=ws.find(w=>w.label===row.label),P=w.proj||{};assert.ok(w,f.base+row.label);newKeys.push(w.key);assert.ok(stats.armory[f.cls].sub.includes(w.key));
    for(const [k,v] of Object.entries(row.values)){
     const actual=k==='recoilV'?w.recoil*180/Math.PI:k==='blast'?P.blast||w.directBlast:P[k]??w[k];
     if(Array.isArray(v))assert.deepEqual(actual,v,w.key+k);else assert.ok(Math.abs(actual-v)<1e-7,w.key+':'+k+' '+actual+' != '+v);
    }
    assert.ok(/^[A-Z]{2}-\d+[A-Z0-9]*$/.test(w.model),w.model);assert.ok(!w.model.includes('undefined'));
   }
  }
  assert.equal(newKeys.length,33);
  if(process.argv[4]){const old=JSON.parse(fs.readFileSync(process.argv[4]));for(const [k,w]of Object.entries(old.weapons))assert.deepEqual(stats.weapons[k],w,'旧武器 '+k);assert.deepEqual(stats.parts,old.parts);for(const [c,slots]of Object.entries(old.armory))for(const [sl,keys]of Object.entries(slots))assert.deepEqual(stats.armory[c][sl].filter(k=>keys.includes(k)),keys,'旧装備順');}
  console.log('AC33型の性能、全250種、旧217種と機体パーツ・初期装備順を確認');
  const checks=await p.evaluate(()=>{
   const g=__g,T=g.T,u=g.player,e=g.units.find(q=>q.team==='R'),a=g.units.find(q=>q.team==='B'&&q!==u),scene=u.group.parent,log=[];
   const yes=(v,m)=>{if(!v)throw new Error(m);log.push(m);},eq=(x,y)=>Math.abs(x-y)<1e-5;
   for(const q of g.units){q.alive=false;q.frozen=true;q.downT=0;q.pos.set(10000,0,10000);}
   for(const t of g.turrets)t.alive=false;
   const pos=new T.Vector3(-50,g.terrainH(-50,-48),-48),at=pos.clone().add(new T.Vector3(0,2.4,-18));
   function sync(){for(const q of g.units){q.group.position.copy(q.pos);q.group.rotation.y=q.yaw||0;q.group.visible=q.alive;}scene.updateMatrixWorld(true);}
   function clear(){g.clearSecondaryEffects();for(const sh of g.shells){scene.remove(sh.mesh);}g.shells.length=0;for(const gd of g.gadgets.slice())g.removeGadget(gd);}
   function reset(key,cls){
    clear();u.isPlayer=true;g.loadout[cls].sub=key;g.equip(u,cls);
    for(const q of [u,e,a]){Object.assign(q,{alive:true,hp:1e6,maxHp:1e6,invulT:0,downT:0,stun:'',weakT:0,repairing:false,transfer:null,barrierOn:false,escortOn:false,fieldOn:false,chargeOn:false,recoil:0});q.vel.set(0,0,0);q.armorAvg=1;q.partArmor={head:1,body:1,arms:1,legs:1};}
    u.pos.copy(pos);u.yaw=u.pitch=0;u.onGround=true;u.flying=false;g.selectWeapon(u,'sub');u.switchT=0;u.reloadMul=1;u.aimMul=1;
    e.pos.copy(at).y-=2.4;a.pos.set(1000,0,1000);sync();return u.slots.sub;
   }
   function tick(t,trig=false,aim=at){for(let n=0;n<Math.round(t/.01);n++){g.weaponsTick(u,.01,trig,aim,0);g.shellUpdate(.01);g.secondaryUpdate(.01);g.gadgetUpdate(.01);sync();}}
   {const sl=reset('flare','assault');g.secondaryBurst({owner:u,team:u.team,spec:sl.w.proj},at,null);g.secondaryUpdate(.25);yes(eq(1e6-e.hp,2300),'熱球：接触1150＋毎秒4600×0.25');yes(!e.stun,'熱球は姿勢異常を起こさない');e.pos.x+=30;g.secondaryUpdate(.25);e.pos.x-=30;g.secondaryUpdate(.25);yes(eq(1e6-e.hp,3450),'再接触しても接触損傷を二重加算しない');g.secondaryUpdate(2);yes(g.heatFields.length===0,'熱領域は持続時間で消える');}
   {const sl=reset('flare','assault');const wall=new T.Mesh(new T.BoxGeometry(2,10,20),new T.MeshBasicMaterial());wall.position.copy(at).x+=3;scene.add(wall);g.hittables.push(wall);sync();e.pos.x+=6;g.secondaryBurst({owner:u,team:u.team,spec:sl.w.proj},at,null);g.secondaryUpdate(.1);yes(eq(1e6-e.hp,1610),'熱領域は壁を貫通し、端でも減衰しない');g.hittables.splice(g.hittables.indexOf(wall),1);scene.remove(wall);wall.geometry.dispose();wall.material.dispose();}
   {const sl=reset('chain','assault');const q={owner:u,team:u.team,spec:sl.w.proj,vel:new T.Vector3(0,0,-32)};g.startChain(q,e.pos.clone());g.secondaryUpdate(.01);yes(g.chains.length===1&&g.chains[0].left===5,'連鎖ボムは最初の爆発後に残り5回');yes(eq(g.chains[0].pos.z,e.pos.z-12),'連鎖の爆心が前方12mへ進む');yes(e.hp<1e6,'連鎖で実ダメージ');g.secondaryUpdate(2);yes(g.chains.length===0,'6回で連鎖終了');}
   {const sl=reset('chain','assault');const wall=new T.Mesh(new T.BoxGeometry(4,10,1),new T.MeshBasicMaterial());wall.position.copy(e.pos).add(new T.Vector3(0,4,-4));scene.add(wall);g.hittables.push(wall);sync();g.startChain({owner:u,team:u.team,spec:sl.w.proj,vel:new T.Vector3(0,0,-32)},e.pos);g.secondaryUpdate(.01);yes(g.chains.length===0,'連鎖は進行先の壁で止まる');g.hittables.splice(g.hittables.indexOf(wall),1);scene.remove(wall);wall.geometry.dispose();wall.material.dispose();}
   {const sl=reset('dart','assault');const from=at.clone().add(new T.Vector3(0,0,18));g.fire(u,at,0,{...sl.w,pellets:1},from);yes(eq(1e6-e.hp,1400),'炸裂弾の胴直撃は1400だけ（爆風を重複しない）');}
   {const sl=reset('blastSniper','raid');const head=at.clone().setY(e.pos.y+3.7),from=head.clone().add(new T.Vector3(0,0,18));g.fire(u,head,0,sl.w,from);yes(eq(1e6-e.hp,10250),'炸裂狙撃の頭直撃は4100×2.5');}
   {const sl=reset('charge','heavy');tick(.1,true);yes(g.shells.length===0,'蓄圧中は発射しない');tick(.01,false);yes(g.shells.length===1&&g.shells[0].spec.dmg===3500,'半分未満で離すと無充填3500');}
   {reset('charge','heavy');tick(.6,true);tick(.01,false);yes(g.shells[0]?.spec.dmg===5250,'半充填5250');}
   {reset('chargeH','heavy');tick(3,true);tick(.01,false);yes(g.shells[0]?.spec.dmg===10500,'強装型の満充填10500');}
   {const sl=reset('charge','heavy');tick(4.2,true);yes(sl.overheat&&g.shells.length===0,'最大充填の保持で過熱し弾を消費しない');tick(2.1,false);yes(!sl.overheat,'蓄圧砲の過熱回復');}
   {const sl=reset('charge','heavy');tick(.6,true);tick(.01,false);tick(.7,true);tick(.01,false);yes(sl.ammo===sl.w.mag-2,'プレイヤーが続けて充填・発射できる');}
   {const sl=reset('detonator','support');const from=at.clone().add(new T.Vector3(0,0,5));g.shoot(u,from,new T.Vector3(0,0,-70),sl.w.proj);for(let i=0;i<15;i++)g.shellUpdate(.01);const gd=g.gadgets.find(q=>q.attached===e);yes(!!gd,'射出ボムは敵機に吸着できる');const old=gd.pos.clone();e.pos.x+=7;g.gadgetUpdate(.01);yes(eq(gd.pos.x-old.x,7),'吸着ボムは敵機の移動に追従');}
   {const sl=reset('jumpMine','raid');g.shoot(u,e.pos.clone().add(new T.Vector3(0,1,0)),new T.Vector3(0,-2,0),sl.w.proj);for(let i=0;i<30;i++)g.shellUpdate(.01);const gd=g.gadgets[0];yes(!!gd,'跳躍地雷を地面へ設置');const y=gd.pos.y;g.gadgetUpdate(.99);yes(gd.triggerT==null,'設置準備中は敵を感知しない');g.gadgetUpdate(.02);g.gadgetUpdate(.01);yes(gd.triggerT!=null&&gd.pos.y>y,'半径5mで感知して上昇');g.gadgetUpdate(.7);yes(!g.gadgets.includes(gd)&&e.hp<1e6,'上昇終了で爆発');}
   {const sl=reset('delayMine','support');g.shoot(u,e.pos.clone().add(new T.Vector3(0,1,0)),new T.Vector3(0,-2,0),sl.w.proj);for(let i=0;i<30;i++)g.shellUpdate(.01);const gd=g.gadgets[0];g.gadgetUpdate(1);const y=gd.pos.y;g.gadgetUpdate(.8);yes(g.gadgets.includes(gd)&&eq(gd.pos.y,y)&&e.hp===1e6,'衝撃地雷は感知後も地上に残り遅延');g.gadgetUpdate(.21);yes(!g.gadgets.includes(gd)&&e.hp<1e6&&e.stun==='down','衝撃地雷が1秒後に強い転倒を起こす');}
   {const sl=reset('detonator','support');g.shoot(u,e.pos.clone().add(new T.Vector3(0,1,0)),new T.Vector3(0,-2,0),sl.w.proj);g.detonateRemotes(u);yes(g.shells.length===1,'射出式遠隔ボムは飛行中に起爆できない');for(let i=0;i<30;i++)g.shellUpdate(.01);const gd=g.gadgets[0];g.detonateRemotes(u);yes(g.gadgets.includes(gd),'吸着準備中は起爆不可');g.gadgetUpdate(.51);g.detonateRemotes(u);yes(!g.gadgets.length&&e.hp<1e6,'吸着準備後の任意起爆でダメージ');}
   {const sl=reset('chain','assault');const wall=new T.Mesh(new T.BoxGeometry(1,8,6),new T.MeshBasicMaterial());wall.position.copy(pos).add(new T.Vector3(3,4,0));scene.add(wall);g.hittables.push(wall);sync();g.shoot(u,pos.clone().add(new T.Vector3(0,3,0)),new T.Vector3(32,0,0),sl.w.proj);g.shellUpdate(.1);yes(g.shells[0]?.vel.x<0&&!g.chains.length,'接地前の連鎖ボムは壁で反射する');g.hittables.splice(g.hittables.indexOf(wall),1);scene.remove(wall);wall.geometry.dispose();wall.material.dispose();}
   {const sl=reset('detonator','support');u.repairing=true;tick(.2,true);yes(sl.ammo===sl.w.mag&&g.shells.length===0,'ポッド使用中は新しい副武器も発射不可');}
   {reset('jumpMine','raid');u.isPlayer=false;u.role='defend';const act=g.botAct(u,false,g.cores.R);yes(act?.slot==='sub'&&act.aim,'Botが跳躍地雷を守備位置へ設置する');}
   {const sl=reset('detonator','support');g.secondaryBurst({owner:u,team:u.team,spec:{...sl.w.proj,heatDps:1000,heatDur:3}},at,null);g.startChain({owner:u,team:u.team,spec:{...sl.w.proj,chainCount:3},vel:new T.Vector3(0,0,-1)},at);g.selectMap('city');yes(!g.heatFields.length&&!g.chains.length,'マップ切替で熱領域と連鎖を片付ける');}
   clear();yes(g.barricades.length>0,'市街地のバリケードあり');g.bladeSweep(u,{a:g.WEAPONS.sword.normal,hit:new Set()},0,.1);yes(true,'バリケードのあるマップでも従来の近接攻撃を処理できる');return log;
  });console.log(checks.join('\n'));
  // 実際の右クリックが3段階を巡回し、持ち替えで解除される。
  await p.evaluate(()=>{document.getElementById('start').click();__g.running=false;const u=__g.player;__g.loadout.raid.sub='zoom';__g.equip(u,'raid');__g.selectWeapon(u,'sub');Object.assign(u,{repairing:false,transfer:null,stun:'',switchT:0});document.getElementById('overlay').hidden=true;__g.running=true;window.__dt=.000001;});
  await p.evaluate(()=>document.exitPointerLock());await p.waitForFunction(()=>!document.pointerLockElement);
  for(const [step,power]of [[1,2.5],[2,5],[0,2.5]]){await p.mouse.click(650,450,{button:'right'});assert.equal(await p.evaluate(()=>__g.player.scopeStep),step);assert.equal(await p.evaluate(()=>__g.scopePower(__g.player)),power);}
  await p.evaluate(()=>{__g.selectWeapon(__g.player,'main');__g.running=false;document.exitPointerLock();});assert.equal(await p.evaluate(()=>__g.player.scopeStep),0);
  await p.waitForFunction(()=>!document.pointerLockElement);
  await p.evaluate(()=>{document.getElementById('overlay').hidden=false;__g.renderCustom();__g.showPage('pgCustom');});
  for(const [cls,series,key,name]of [['assault','vc','chainH','連鎖ボム'],['heavy','lq','chargeM','蓄圧砲'],['raid','sz','zoomH','二段ズーム'],['support','vn','detonatorR','遠隔ボム']]){
   await p.click(`#pgCustom [data-cu="${cls}"]`);await p.click('[data-cslot="sub"]');const h=p.locator(`[data-series="${series}"]`);if(await h.getAttribute('aria-expanded')!=='true')await h.click();
   await p.locator(`[data-pick="${key}"]`).hover();await p.waitForTimeout(200);assert.match(await p.locator('#cuDiff').innerText(),/[▲▼]/,'比較の矢印 '+name);await p.screenshot({path:path.join(out,cls+'.png')});await p.click(`[data-pick="${key}"]`);
  }
  await p.reload();assert.deepEqual(await p.evaluate(()=>['assault','heavy','raid','support'].map(c=>__g.loadout[c].sub)),['chainH','chargeM','zoomH','detonatorR'],'保存して再読み込み');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'stats.json'),JSON.stringify(stats,null,2));console.log(checks.length+'項目＋実クリックの二段ズーム＋4兵装の選択・比較表示：成功。エラーなし');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
