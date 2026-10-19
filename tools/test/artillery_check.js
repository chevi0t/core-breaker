// 使い方: node tools/test/artillery_check.js dbg/artillery [画像出力先] [変更前のstats.json]
// AC4型の数値、マップ操作、連射・中断・再充填、軌道・予告・屋根と爆風遮蔽を確かめる。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const dir=path.resolve(process.argv[2]||'dbg/artillery'),out=path.resolve(process.argv[3]||path.join(dir,'artillery'));
  fs.mkdirSync(out,{recursive:true});
  const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  try{
    const p=await b.newPage({viewport:{width:1000,height:760}}),errors=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await p.goto('file://'+path.join(dir,'dbg.html'));
    await p.evaluate(()=>{__g.renderer.render=()=>{const u=__g.units[0];if(u)u.group.parent.updateMatrixWorld();};__g.selectMap('dock');document.getElementById('start').click();__g.running=false;});
    const stats=await p.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));
    assert.equal(Object.keys(stats.weapons).length,217);
    for(const row of require('../../research/weapons/types/artillery.json').rows){
      const w=stats.weapons[row.key];for(const [k,v]of Object.entries(row.stats))assert.equal(w[k],v===null?undefined:v,row.key+':'+k);
      assert.ok(stats.armory.heavy.sp.includes(row.key));assert.ok(w.noLock&&w.plant);
    }
    if(process.argv[4]){
      const old=JSON.parse(fs.readFileSync(process.argv[4]));for(const [k,w]of Object.entries(old.weapons))assert.deepEqual(stats.weapons[k],w,'旧装備 '+k);
      assert.deepEqual(stats.parts,old.parts);for(const [c,slots]of Object.entries(old.armory))for(const [sl,keys]of Object.entries(slots))assert.deepEqual(stats.armory[c][sl].filter(k=>keys.includes(k)),keys,'初期装備・並び順');
    }
    const checks=await p.evaluate(()=>{
      const g=__g,T=g.T,u=g.player,e=g.units.find(q=>q.team==='R'),a=g.units.find(q=>q.team==='B'&&q!==u),scene=u.group.parent,log=[];
      const yes=(v,m)=>{if(!v)throw new Error(m);log.push(m);},eq=(a,b)=>Math.abs(a-b)<1e-6;
      for(const q of g.units){q.alive=false;q.downT=0;q.frozen=true;q.pos.set(10000,0,10000);}
      let spot;
      for(let z=72;z>=0&&!spot;z-=6)for(let x=-56;x<=56&&!spot;x+=7){const y=g.terrainH(x,z);const h=g.castFrom(new T.Vector3(x,y+3,z),new T.Vector3(0,0,-1),null,62);if(!h&&Math.abs(g.terrainH(x,z-60)-y)<.3&&g.clearPath(x,z,x,z-60,y))spot=[x,y,z];}
      yes(!!spot,'開けた60mの試験場所');
      const target=()=>new T.Vector3(spot[0],g.terrainH(spot[0],spot[2]-60),spot[2]-60);
      function sync(){for(const q of g.units){q.group.position.copy(q.pos);q.group.rotation.y=q.yaw||0;q.group.visible=q.alive;}scene.updateMatrixWorld(true);}
      let launches=[],seen=new Set();
      function reset(key='artillery',body='standard'){
        g.clearArtillery();for(const gd of g.gadgets.slice())g.removeGadget(gd);
        for(const q of [u,e,a])Object.assign(q,{alive:true,hp:1e6,maxHp:1e6,invulT:0,downT:0,stun:'',weakT:0,repairing:false,transfer:null,barrierOn:false,escortOn:false,fieldOn:false});
        u.isPlayer=true;u.mech.body=body;g.loadout.heavy.sp=key;g.equip(u,'heavy');u.hp=u.maxHp;u.onGround=true;u.flying=false;u.pos.set(...spot);u.vel.set(0,0,0);u.yaw=u.pitch=0;
        e.pos.copy(target());e.armorAvg=1;e.partArmor={head:1,body:1,arms:1,legs:1};a.pos.set(-60,0,-85);
        g.selectWeapon(u,'sub');u.switchT=0;g.selectWeapon(u,'sp');g.weaponsTick(u,1,false,target(),0);launches=[];seen=new Set();sync();return u.slots.sp;
      }
      function step(t,trigger=false,aim=target(),alt=false){for(let n=0;n<Math.round(t/.01);n++){g.weaponsTick(u,.01,trigger,aim,0,alt);for(const sh of g.barrages)if(!seen.has(sh)){seen.add(sh);launches.push(sh);}g.artilleryUpdate(.01);sync();}}
      window.__artTest={spot,target:target().toArray()};
      for(const key of ['artillery','artilleryR','artilleryF','artilleryH']){
        const sl=reset(key),w=sl.w;yes(g.isArtilleryMode(u)&&u.planted&&u.prevWeapon==='sub',key+' 特別装備の選択で射撃モード');
        const heat=sl.heat;step(.5);yes(!u.bombard&&u.artilleryFired===0&&sl.heat===heat,key+' 地点指定前は撃たずSPも使わない');
        yes(!g.artilleryConfirm(u,new T.Vector3(u.pos.x+w.range+1,u.pos.y,u.pos.z)),key+' 射程外を拒否');
        yes(g.artilleryConfirm(u,target()),key+' 爆撃中心を指定');step(.01);yes(u.artilleryFired===1,key+' ボタンを離した状態でも最初の1発');
        const first=launches[0];yes(first.mesh.position.y>first.from.y&&eq(first.mesh.position.x,first.from.x)&&eq(first.mesh.position.z,first.from.z),key+' 自機から垂直上昇');
        yes(first.target.distanceTo(target())<=w.scatter+1,key+' 指定した円内へ散布');
        if(w.interval)step(w.interval*(w.shots-1)+.04);
        yes(u.artilleryFired===w.shots,key+' 表どおりの最大発数');yes(!g.isArtilleryMode(u)&&u.weapon==='sub'&&!u.planted,key+' 撃ち切りで直前の副武器へ戻る');
        yes(sl.overheat,key+' 使い切ると再充填待ち');
        for(const sh of launches)yes(Math.hypot(sh.target.x-target().x,sh.target.z-target().z)<=w.scatter+1e-6,key+' 各弾の着弾誤差上限');
        step(w.charge+.1);yes(sl.heat===100&&!sl.overheat,key+' 再充填完了');
      }
      for(const [body,counts]of [['light',[6,12,5,1]],['standard',[6,12,5,1]],['heavy',[6,12,5,1]]])for(const [i,key]of ['artillery','artilleryR','artilleryF','artilleryH'].entries()){
        const sl=reset(key,body);g.artilleryConfirm(u,target());step(14);yes(u.artilleryFired===counts[i],key+' '+body+'胴の満タン発数 '+counts[i]);yes(!g.isArtilleryMode(u),key+' '+body+'胴でも弾数分で終了');
        if(key==='artilleryH')yes(sl.heat===0||sl.heat>0&&u.weapon!=='sp',body+'胴でも単発榴弾砲を発射可能');
      }
      for(const [body,rate]of [['light',.8],['standard',1],['heavy',1.32]]){
        const sl=reset('artilleryH',body);g.artilleryConfirm(u,target());step(.01);yes(sl.heat===0&&sl.overheat,body+'胴でも単発は100%消費');step(1);yes(eq(sl.heat,100/62*rate),body+'胴SPは回復速度 '+rate+'倍');
        reset('artillery',body);g.loadout.heavy.sp='barrier';g.equip(u,'heavy');u.barrierOn=true;const heat=u.slots.sp.heat;g.barrierAbsorb(u,1000,u.pos.clone().add(new T.Vector3(0,2,-4)));yes(eq(heat-u.slots.sp.heat,9.6),body+'胴でもバリアの割合消費は同じ');g.hud(g.timeLeft,.01);yes(document.getElementById('spT').textContent==='90',body+'胴でもHUDは残り割合を表示');
      }
      {const sl=reset();u.switchT=.4;g.stopArtillery(u);yes(u.weapon==='sub'&&sl.heat===100,'発射前の右クリック中断はSPを消費しない');}
      {const sl=reset();g.artilleryConfirm(u,target());step(.01);const count=u.artilleryFired,heat=sl.heat;g.stopArtillery(u);yes(g.barrages.length===1&&heat>0&&!sl.overheat,'途中中断は残SPを保ち発射済みの弾を残す');step(1);yes(u.artilleryFired===count&&eq(sl.heat,heat+100/44),'途中中断後は新たに撃たず44秒基準の早いSP回復');}
      {const sl=reset('artilleryH');g.artilleryConfirm(u,target());step(.01);const sh=launches[0];step(7.97);yes(!sh.warned&&!sh.warn,'着弾2秒前までは火柱を出さない');step(.02);yes(sh.warned&&sh.warn?.parent&&sh.mesh.position.y>sh.landing.point.y,'2秒前に火柱・落下を開始');const y=sh.mesh.position.y;step(.5);yes(sh.mesh.position.y<y&&eq(sh.mesh.position.x,sh.target.x)&&eq(sh.mesh.position.z,sh.target.z),'指定地点の真上から垂直落下');step(1.5);yes(!g.barrages.includes(sh)&&!sh.warn.parent&&e.hp<e.maxHp,'着弾して実ダメージと予告の除去');}
      {const sl=reset('artilleryH');const p=target(),roof=new T.Mesh(new T.BoxGeometry(18,1,18),new T.MeshBasicMaterial());roof.position.copy(p).y+=8;scene.add(roof);g.hittables.push(roof);sync();yes(eq(g.artillerySurface(p).point.y,p.y+8.5),'屋根の最上面が着弾点');g.artilleryConfirm(u,p);step(.01);step(10);yes(e.hp===e.maxHp,'屋根の下の敵へ爆風を通さない');g.hittables.splice(g.hittables.indexOf(roof),1);scene.remove(roof);roof.geometry.dispose();roof.material.dispose();}
      {reset();const p=target(),src={owner:u,team:u.team,spec:{dmg:10000,blast:25,linear:true,occluded:true}};e.pos.copy(p);g.blast(src,p,null);yes(eq(e.maxHp-e.hp,10000),'榴弾砲は爆心で表どおりの威力');e.hp=e.maxHp;e.pos.x+=20;sync();g.blast(src,p,null);yes(eq(e.maxHp-e.hp,2000),'榴弾砲の直線減衰（20mで2000）');e.hp=e.maxHp;g.blast({owner:u,team:u.team,spec:{dmg:10000,blast:25}},p,null);yes(e.maxHp-e.hp>5900,'従来の爆風は端で半分の減衰を保持');}
      {reset();u.repairing=true;step(.01,true);yes(!g.isArtilleryMode(u)&&u.artilleryFired===0,'ポッド利用中は射撃モードを停止');}
      {reset();const yaw=u.yaw,pos=u.pos.clone();g.keys.KeyW=g.keys.Space=g.keys.ArrowLeft=true;g.playerUpdate(u,.05);g.keys.KeyW=g.keys.Space=g.keys.ArrowLeft=false;yes(eq(u.yaw,yaw)&&u.pos.distanceTo(pos)<.01,'射撃モードでは矢印旋回・移動・ジャンプ不可');yes(!g.shortDash(u,new T.Vector3(1,0,0))&&!g.startTransfer(u,null),'射撃モードではダッシュ・エリア移動不可');}
      {reset('artilleryH');u.isPlayer=false;u.target=e;a.pos.set(1000,0,1000);const act=g.botAct(u,true,g.cores.R);yes(act?.slot==='sp'&&act.aim.distanceTo(target())<5,'Botが同じマップ指定式の砲撃行動を選ぶ');}
      {reset();g.artilleryConfirm(u,target());step(.01);const sh=launches[0];g.selectMap('city');yes(g.barrages.length===0&&!sh.mesh.parent,'マップ切替で砲弾と予告を片付ける');}
      return log;
    });
    console.log(checks.join('\n'));
    // 入力イベントと実クリック：旋回せずマップ照準を動かし、クリックで開始・右クリックで中断。
    await p.evaluate(()=>{document.getElementById('overlay').hidden=true;document.getElementById('start').click();__g.running=false;for(const u of __g.units)u.frozen=true;const u=__g.player;u.isPlayer=true;__g.loadout.heavy.sp='artillery';__g.equip(u,'heavy');u.repairing=false;u.stun='';u.transfer=null;u.onGround=true;__g.selectWeapon(u,'sub');__g.selectWeapon(u,'sp');u.switchT=0;__g.drawBigMap();__g.running=true;});
    await p.evaluate(()=>document.exitPointerLock());await p.waitForFunction(()=>!document.pointerLockElement);await p.mouse.move(500,380);
    const before=await p.evaluate(()=>({yaw:__g.player.yaw,pitch:__g.player.pitch,x:__g.mapCur.x,z:__g.mapCur.z}));
    await p.evaluate(()=>__g.renderer.domElement.requestPointerLock());
    await p.waitForFunction(()=>document.pointerLockElement===__g.renderer.domElement);
    // ヘッドレスChromiumのCDP移動はポインタロック中に絶対量になるため、相対入力は実際のDOM入力イベントで検証する。
    await p.evaluate(()=>window.dispatchEvent(new MouseEvent('mousemove',{movementX:20,movementY:10,bubbles:true})));
    const moved=await p.evaluate(()=>({yaw:__g.player.yaw,pitch:__g.player.pitch,x:__g.mapCur.x,z:__g.mapCur.z}));
    assert.equal(moved.yaw,before.yaw);assert.equal(moved.pitch,before.pitch);assert.ok(moved.x!==before.x||moved.z!==before.z,'マウスはマップ照準だけ動かす');
    await p.evaluate(()=>{const u=__g.player;__g.mapCur.x=u.pos.x;__g.mapCur.z=u.pos.z-80;});
    await p.mouse.click(520,390);
    await p.waitForFunction(()=>__g.player.artilleryFired>0);
    await p.evaluate(()=>{window.__dt=.000001;__g.drawBigMap();document.exitPointerLock();});await p.waitForFunction(()=>!document.pointerLockElement);
    await p.screenshot({path:path.join(out,'mode.png')});
    const cv=p.locator('#bigMapC');await p.evaluate(()=>__g.running=true);await cv.click({button:'right'});
    await p.evaluate(()=>{__g.running=false;__g.drawBigMap();});
    assert.equal(await p.evaluate(()=>__g.player.weapon),'sub');assert.equal(await p.locator('#bigMap').isHidden(),true);
    await p.setViewportSize({width:1360,height:900});
    await p.evaluate(()=>{__g.renderCustom();__g.showPage('pgCustom');document.getElementById('overlay').hidden=false;});
    await p.click('#pgCustom [data-cu="heavy"]');await p.click('[data-cslot="sp"]');const h=p.locator('[data-series="vh"]');if(await h.getAttribute('aria-expanded')!=='true')await h.click();
    await p.locator('[data-pick="artilleryF"]').hover();assert.match(await p.locator('#cuDiff').innerText(),/[▲▼]/);await p.screenshot({path:path.join(out,'loadout.png')});await p.click('[data-pick="artilleryF"]');await p.waitForTimeout(200);await p.reload();assert.equal(await p.evaluate(()=>__g.loadout.heavy.sp),'artilleryF');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'stats.json'),JSON.stringify(stats,null,2));
    console.log('榴弾砲4型、旧213装備互換、動作'+checks.length+'項目、入力イベント・実クリック・UI・保存：成功。エラーなし');
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
