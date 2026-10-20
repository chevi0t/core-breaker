// 新3系統36パーツ：AC値・旧36パーツ/285武器・SP/装填/持替/反動/重量・UI/保存を確認。
// node tools/test/mech_series_check.js dbg/mech-series [画像出力先] [追加前stats.json]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),source=require('../../research/parts/types/new-series.json');
(async()=>{
 const dir=path.resolve(process.argv[2]||'dbg/mech-series'),out=path.resolve(process.argv[3]||path.join(dir,'series'));
 fs.mkdirSync(out,{recursive:true});const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const legacy={head:'light2',body:'standard3',arms:'heavy2',legs:'heavy3',color:'ash'};
 try{
  const p=await b.newPage({viewport:{width:1360,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.route('**fonts.g*/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.addInitScript(cfg=>{if(localStorage.getItem('newSeriesFixture'))return;localStorage.setItem('newSeriesFixture','1');localStorage.setItem('coreBreakerMap','dock');localStorage.setItem('coreBreakerMech',JSON.stringify(cfg));localStorage.setItem('coreBreakerBuilds',JSON.stringify({cur:0,list:[{mech:cfg},{mech:{head:'heavy',body:'heavy',arms:'heavy',legs:'heavy',color:'sand'}},{mech:cfg}]}));},legacy);
  await p.goto('file://'+path.join(dir,'dbg.html'));
  await p.evaluate(()=>{__g.renderer.render=()=>{const u=__g.units[0];if(u)u.group.parent.updateMatrixWorld();};});
  assert.deepEqual(await p.evaluate(()=>__g.mechCfg),legacy,'旧Ⅱ/Ⅲ型の混成保存');
  const stats=await p.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));
  assert.equal(Object.values(stats.parts).flatMap(Object.keys).length,72);assert.equal(Object.keys(stats.weapons).length,285);
  let count=0;
  for(const f of source.families)for(const [slot,rows]of Object.entries(f.parts))for(const row of rows){
   const p=stats.parts[slot][row.key],anchor=stats.parts[slot].standard;
   assert.equal(p.series,f.id);assert.equal(p.label,row.label);assert.ok(p.model.startsWith(f.name));
   for(const [field,v]of Object.entries(row.values)){const digits=source.rounding[field]??source.rounding.default;const want=+(anchor[field]*(v/source.anchor.rows[slot][field])).toFixed(digits);assert.equal(p[field],want,slot+'/'+row.key+'/'+field);}
   if(slot==='body')assert.equal(p.sp,100,'SPは容量へ変換しない');if(slot==='legs')assert.equal(p.cruise,19.7,'不明な巡航は標準値を継承');count++;
  }
  assert.equal(count,36);
  if(process.argv[4]){const old=JSON.parse(fs.readFileSync(process.argv[4]));assert.deepEqual(stats.weapons,old.weapons,'旧285武器');assert.deepEqual(stats.armory,old.armory,'全武器の初期装備と並び');for(const [slot,ps]of Object.entries(old.parts))for(const [key,p]of Object.entries(ps))assert.deepEqual(stats.parts[slot][key],p,'旧36パーツ '+slot+'/'+key);}
  await p.evaluate(()=>{document.getElementById('start').click();__g.running=false;for(const u of __g.units){u.frozen=true;u.invulT=0;u.alive=false;u.downT=0;}});
  const checks=await p.evaluate(()=>{
   const g=__g,T=g.T,u=g.player,log=[],yes=(v,m)=>{if(!v)throw new Error(m);log.push(m);},eq=(a,b)=>Math.abs(a-b)<1e-6;
   const keys=['harrier','harrier2','harrier3','prism','prism2','prism3','bastion','bastion2','bastion3'];
   u.isPlayer=true;g.loadout.heavy.main='mg';g.loadout.heavy.sp='barrier';
   for(const key of keys){
    u.mech={head:key,body:key,arms:key,legs:key,color:'ash'};Object.assign(u,{alive:true,stun:'',invulT:0,repairing:false,transfer:null,barrierOn:false,escortOn:false,flying:false,onGround:true});
    g.equip(u,'heavy');u.pos.set(-50,g.terrainH(-50,-48),-48);u.yaw=0;u.pitch=0;u.vel.set(0,0,0);u.group.position.copy(u.pos);u.group.updateMatrixWorld(true);
    const st=g.mechStats(u.mech,g.loadout.heavy),P=st.P,aim=u.pos.clone().add(new T.Vector3(0,8,-30)),main=u.slots.main;
    yes(eq(u.aimMul,1/P.head.aim)&&eq(u.lockRange,P.head.lock),key+' 頭の射撃補正・ロック距離が装備へ反映');
    yes(eq(u.maxBoost,P.body.boost)&&eq(u.slots.sp.supply,P.body.sp/100*P.body.supply),key+' 胴のブースト・SP回復が装備へ反映');
    yes(eq(main.ammo+main.reserve,Math.max(main.w.mag,Math.floor(main.w.mag*main.w.mags*P.arms.ammo+1e-8))),key+' 腕の携行弾数を適用');
    main.ammo=1;u.recoil=0;g.weaponsTick(u,.01,true,aim,0);
    yes(main.ammo===0&&eq(main.reloadT,main.w.reload*P.arms.reload),key+' 実射の撃ち切りで腕性能の装填時間');
    yes(eq(u.recoil,.004/P.arms.recoil),key+' 発射時の反動を腕性能で軽減');
    const wait=main.reloadT;g.weaponsTick(u,wait-.001,false,aim,0);yes(main.ammo===0,key+' 装填完了前は弾が戻らない');g.weaponsTick(u,.002,false,aim,0);yes(main.ammo===main.w.mag,key+' 装填時間後に弾倉を補充');
    g.selectWeapon(u,'sub');yes(eq(u.switchT,.8/P.arms.swap),key+' 武器の持替時間を適用');g.selectWeapon(u,'main');u.switchT=0;
    const sp=u.slots.sp;sp.heat=0;sp.overheat=true;g.specialTick(u,1);yes(eq(sp.heat,100/sp.w.charge*P.body.sp/100*P.body.supply),key+' 空から1秒のSP回復速度');
    sp.heat=100;sp.overheat=false;u.barrierOn=true;g.barrierAbsorb(u,1000,u.pos.clone().add(new T.Vector3(0,2,-4)));yes(eq(sp.heat,90.4),key+' バリアの割合消費は胴によらず同じ');u.barrierOn=false;
    yes(eq(u.walkV,st.walk)&&eq(u.dashV,st.dash)&&eq(u.cruiseV,st.cruise),key+' 重量超過後の移動速度を適用');
    const at=u.pos.clone();g.physics(u,new T.Vector3(1,0,0),false,false,.05);yes(u.pos.x>at.x&&u.vel.length()>0,key+' 新脚で歩行できる');
    if(key.startsWith('harrier'))yes(eq(st.P.head.lock,g.PARTS.head[key].lock+5)&&eq(st.P.legs.dash,g.PARTS.legs[key].dash+.6),key+' 型を揃えた機動セット');
    if(key.startsWith('prism'))yes(eq(st.P.arms.reload,g.PARTS.arms[key].reload/1.045),key+' 型を揃えた装填セット');
    if(key.startsWith('bastion'))yes(eq(st.P.arms.recoil,g.PARTS.arms[key].recoil*1.05)&&eq(st.P.legs.walk,g.PARTS.legs[key].walk+.45),key+' 型を揃えた荷重セット');
   }
   const mixed={head:'harrier3',body:'prism3',arms:'bastion3',legs:'harrier2',color:'ash'},st=g.mechStats(mixed,g.loadout.heavy);
   yes(!st.set,'3系統の混成ではセットを付けない');const neutral=g.mechStats(g.MECH_DEFAULT,g.loadout.assault);yes(st.excess>0&&st.dash<st.P.legs.dash*neutral.dash/neutral.P.legs.dash,'積載を超えた混成機で速度低下');
   const initial=Object.fromEntries(Object.entries(g.ARMORY).map(([cls,slots])=>[cls,Object.fromEntries(g.SLOTS.map(k=>[k,slots[k][0]]))]));
   const examples={};for(const key of ['light','standard','heavy',...keys]){const cfg={head:key,body:key,arms:key,legs:key,color:'team'};examples[key]=Object.fromEntries(Object.entries(initial).map(([cls,load])=>{const s=g.mechStats(cfg,load);return [cls,{frame:s.frame,payload:s.payload,weight:s.weight,cap:s.cap,excess:s.excess,walk:s.walk,dash:s.dash,cruise:s.cruise,set:s.set?.text}];}));}
   window.__seriesExamples=examples;window.__newMixed=mixed;u.alive=false;return log;
  });console.log('AC36パーツ、旧36パーツ/285武器の同値と実動作'+checks.length+'項目：成功');
  await p.evaluate(()=>{document.exitPointerLock();__g.renderCustom();__g.showPage('pgCustom');document.getElementById('overlay').hidden=false;});await p.waitForFunction(()=>!document.pointerLockElement);
  await p.click('#cuBuilds [data-build="1"]');assert.equal(await p.evaluate(()=>__g.mechCfg.head),'heavy','古い構成2');await p.click('#cuBuilds [data-build="0"]');assert.deepEqual(await p.evaluate(()=>__g.mechCfg),legacy);
  for(const f of source.families){
   await p.evaluate(id=>{Object.assign(__g.mechCfg,{head:id,body:id,arms:id,legs:id,color:'ash'});__g.renderCustom();},f.id);
   await p.click('[data-cslot="head"]');const h=p.locator(`[data-series="${f.id}"]`);if(await h.getAttribute('aria-expanded')!=='true')await h.click();
   for(const row of f.parts.head)assert.equal(await p.locator(`[data-pick="${row.key}"]`).count(),1);
   await p.locator(`[data-pick="${f.id}3"]`).hover();assert.match(await p.locator('#cuDiff').innerText(),/[▲▼]/);
   await p.waitForFunction(()=>!!__g.mechRig?.m);await p.evaluate(()=>{__g.mechRig.drag=0;__g.mechRig.yaw=-.45;});await p.waitForTimeout(200);
   await p.screenshot({path:path.join(out,f.id+'-compare.png')});await p.locator('#cuPreview').screenshot({path:path.join(out,f.id+'-preview.png')});
   await p.click('[data-cslot="body"]');const hb=p.locator(`[data-series="${f.id}"]`);if(await hb.getAttribute('aria-expanded')!=='true')await hb.click();await p.locator(`[data-pick="${f.id}3"]`).hover();assert.match(await p.locator('#cuDiff').innerText(),/SP回復/);await p.screenshot({path:path.join(out,f.id+'-body.png')});
  }
  const mixed=await p.evaluate(()=>window.__newMixed);
  for(const slot of ['head','body','arms','legs']){await p.click(`[data-cslot="${slot}"]`);const series=stats.parts[slot][mixed[slot]].series,h=p.locator(`[data-series="${series}"]`);if(await h.getAttribute('aria-expanded')!=='true')await h.click();await p.click(`[data-pick="${mixed[slot]}"]`);}
  assert.deepEqual(await p.evaluate(()=>__g.mechCfg),mixed);assert.match(await p.locator('#cuSet').innerText(),/今は/);assert.match(await p.locator('#cuWBar').innerText(),/重量耐性/);await p.screenshot({path:path.join(out,'mixed.png')});
  const examples=await p.evaluate(()=>window.__seriesExamples);await p.reload();assert.deepEqual(await p.evaluate(()=>__g.mechCfg),mixed,'新機体を保存して再読込');assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('coreBreakerBuilds')).list[0].mech),mixed,'構成保存も新しい型を保持');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(dir,'series-results.json'),JSON.stringify({stats,examples,checks},null,2));
  console.log('3系統の選択・比較・SP表示・回転見本、混成機と重量棒・旧構成切替・新保存の再読込：成功。エラーなし');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
