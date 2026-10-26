// 実際のQB・被弾・ロック移譲・破棄・Bot使用をブラウザ内で検証する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  try {
    const p = await browser.newPage({viewport:{width:1280,height:720}}), errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
    await p.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;});
    await p.goto('file://'+path.resolve(process.argv[2]||'/tmp/mirage-dbg','dbg.html'));
    const result = await p.evaluate(()=>{
      const g=__g,T=g.T,checks=[],yes=(v,msg)=>{if(!v)throw Error(msg);checks.push(msg);},eq=(a,b,msg)=>yes(Math.abs(a-b)<1e-6,msg);
      g.selectMap('dock');document.getElementById('start').click();g.running=true;
      const u=g.player,e=g.units.find(v=>v.team!==u.team), foe=g.units.find(v=>v!==e&&v.team===e.team);
      for(const v of g.units){v.alive=false;v.group.visible=false;v.frozen=true;}
      for(const v of [u,e,foe]) {g.spawn(v);v.invulT=0;v.group.visible=true;v.pos.set(0,200,0);v.vel.set(0,0,0);v.yaw=0;v.stun='';v.transfer=null;}
      u.pos.set(0,200,30);e.pos.set(0,200,0);foe.pos.set(20,200,20);
      function sync(){for(const v of [u,e,foe]){v.group.position.copy(v.pos);v.group.rotation.set(0,v.yaw,0);}g.scene.updateMatrixWorld(true);}
      function prepare(v,key='mirage'){v.slots.sp=g.slotOf(key);v.mirageOn=false;v.mirageWait=0;v.dashT=0;v.boost=v.maxBoost;v.overheat=false;v.ctrlLockT=v.recoverT=0;v.stun='';v.repairing=false;v.transfer=null;v.alive=true;g.weaponLook(v,0);sync();}
      function qb(v){v.dashT=0;v.boost=v.maxBoost;v.overheat=false;return g.shortDash(v,new T.Vector3(1,0,0));}
      prepare(e); const weapon=e.weapon;
      yes(g.toggleSp(e)&&e.mirageOn&&e.weapon===weapon,'起動は持ち替えずSPを消費しない');eq(e.slots.sp.heat,100,'起動時SP100%');
      const entry=()=>({target:e,life:e.lifeId,hidden:0,far:0});
      u.slots.sub=g.slotOf('missile');u.slots.sub.missileLocks=[entry(),{...entry(),life:e.lifeId-1}];u.slots.sub.missileQueue=[entry()];u.slots.sub.missileProgress=new Map([[e,.1]]);
      const sh={missileTarget:entry(),team:u.team};g.shells.push(sh);
      g.lock.target=e;const seq=g.lock.visualSeq,cam=g.camera.quaternion.clone(),yaw=u.yaw;
      u.target=e;u.aimTarget=e;
      yes(qb(e),'成功QB');const d=g.mirages.at(-1);
      yes(d.hp===500&&d.spec.decoyLife===10&&d.pos.equals(e.pos),'標準HP500・10秒・出発点を維持');
      eq(e.slots.sp.heat,75,'QBごとSP25%');
      yes(g.lock.target===d&&g.lock.visualSeq===seq&&g.camera.quaternion.equals(cam)&&u.yaw===yaw,'通常ロックだけ移譲し視点と照準を動かさない');
      yes(u.target===d&&u.aimTarget===d&&u.mirageLock===d,'Botの追従対象と追従の履歴を引き継ぐ');
      yes(u.slots.sub.missileLocks[0].target===d&&u.slots.sub.missileQueue[0].target===d&&sh.missileTarget.target===d,'捕捉・待機・飛翔中ミサイルを移譲');
      yes(u.slots.sub.missileLocks[1].target===e&&!g.missileTargetValid(u,u.slots.sub.missileLocks[1]),'前の出撃を追っていた無効なミサイルを復活させない');u.slots.sub.missileLocks.pop();
      yes(g.missileTargetValid(u,u.slots.sub.missileLocks[0]),'デコイは有効なミサイル目標');
      yes(d.mesh.geometry.attributes.position.count>1000&&d.mesh.material.opacity===1,'実機の形を1描画メッシュに複製');
      yes(!g.units.includes(d)&&g.gadgets.includes(d)&&g.hittables.includes(d.mesh),'占拠・復活対象に混ぜず射撃対象へ登録');
      eq(g.targetPoint(d).y,d.pos.y+2.4,'ロックは残像の胴体を狙う');
      e.pos.x+=15;sync();yes(g.canSee(u,d,g.targetPoint(d)),'実射線から残像が見える');
      g.updateCamera(u,1);g.camera.lookAt(g.targetPoint(d));g.camera.updateMatrixWorld(true);u.weapon='main';u.switchT=0;g.lockUpdate(u,.1);g.lockHud(u,.1);
      yes(g.lock.target===d&&g.lockCandidates(u).some(c=>c.e===d),'残像を通常ロック更新・HUDでも保持する');
      yes(g.heldMirage(u,.1,100)===d,'移動した本体にロックを戻さない');
      qb(e);yes(g.lock.target===d&&g.mirages.length===2,'2回目のQBは古い残像のロックを奪わない');
      const hp=d.hp;g.damageGadget(d,100,e);eq(d.hp,hp,'味方の弾で壊れない');
      g.damage(d,u,100,false);eq(d.hp,400,'通常ダメージを受ける');
      const sx=JSON.stringify(u.sx), core=g.cores[e.team].hp;
      let disposed=0;d.mesh.geometry.addEventListener('dispose',()=>disposed++);d.mesh.material.addEventListener('dispose',()=>disposed++);
      g.damage(d,u,1000,false);yes(disposed===2,'破壊で専用GPU資源2個を解放');
      yes(!d.alive&&!g.mirages.includes(d)&&!g.hittables.includes(d.mesh),'撃破で描画・当たり判定・一覧から除去');
      yes(!g.lock.target&&!u.target&&!u.aimTarget&&!sh.missileTarget&&u.slots.sub.missileLocks.length===0&&u.slots.sub.missileQueue[0]===null,'破壊で全捕捉を解除、予約弾は無誘導にする');
      yes(JSON.stringify(u.sx)===sx&&g.cores[e.team].hp===core,'破壊で撃破数・得点・コアが変わらない');g.shells.length=0;
      g.clearGadgets();prepare(e);g.toggleSp(e);qb(e);
      const n=g.mirages.length,sp=e.slots.sp.heat;
      yes(!g.shortDash(e,new T.Vector3(1,0,0))&&g.mirages.length===n&&e.slots.sp.heat===sp,'QB連続入力の不成立でSPを使わない');
      g.mirageTick(e,e.slots.sp,.5);eq(e.slots.sp.heat,75,'発生後1秒はSP回復待ち');
      g.mirageTick(e,e.slots.sp,.8);eq(e.slots.sp.heat,76,'待ち時間を跨いだ余りだけ回復');
      e.slots.sp.supply=2;g.mirageTick(e,e.slots.sp,1);eq(e.slots.sp.heat,76+200/30,'胴のSP性能は回復速度にのみ反映');
      e.slots.sp.heat=20;yes(qb(e)&&!e.mirageOn&&e.slots.sp.heat===20&&g.mirages.length===n,'SP不足でも移動できるが残像は作らず停止');
      prepare(e);g.toggleSp(e);e.slots.sp.heat=25;qb(e);yes(e.slots.sp.overheat&&!e.mirageOn&&e.slots.sp.heat===0,'ちょうど使い切るとオーバーヒート');
      g.mirageTick(e,e.slots.sp,41);eq(e.slots.sp.heat,100,'OH回復40秒＋待ち1秒');yes(!e.slots.sp.overheat,'満充填でOH解除');
      for(const [key,hp,life,cost] of [['mirageH',1500,10,40],['mirageL',180,6,15],['mirageD',350,20,20]]){
        g.clearGadgets();prepare(e,key);g.toggleSp(e);qb(e);const a=g.mirages.at(-1);
        yes(a.hp===hp&&a.spec.decoyLife===life&&e.slots.sp.heat===100-cost,key+'の耐久・時間・消費');
        if(key==='mirageL')eq(a.mesh.material.opacity,.35,'省エネ型は半透明');
        if(key==='mirageD')yes(a.spec.hologram&&a.mesh.material.emissive.getHex()!==0,'長時間型は明滅する有色の投影像');
        e.alive=false;g.gadgetUpdate(life-.01);yes(a.alive,'持ち主の死亡後も寿命まで残る');
        g.lock.target=a;g.gadgetUpdate(.02);yes(!a.alive&&!g.lock.target,'寿命終了で残像と捕捉を除去');
      }
      prepare(e,'mirageL');g.toggleSp(e);const first=[];
      for(let i=0;i<5;i++){e.slots.sp.heat=100;qb(e);first.push(g.mirages.at(-1));}
      yes(g.mirages.length===4&&!first[0].alive&&first[4].alive,'5体目で最古の残像を除去');
      prepare(u);g.toggleSp(u);qb(u);yes(g.mirages.length===5,'上限は持ち主ごとに4体');
      const a=g.mirages.at(-1);u.slots.sp.cd=0;g.toggleSp(u);yes(!u.mirageOn&&a.alive,'停止しても既存残像は残る');
      g.clearGadgets();yes(g.mirages.length===0,'マップ終了時の一括破棄');
      prepare(e);e.frozen=false;e.target=u;e.think=1;e.actCd=10;g.botUpdate(e,.01);
      yes(e.mirageOn,'Botも交戦中に装置を起動する');qb(e);yes(g.mirages.at(-1)?.owner===e,'Botも同じQBで残像を生成');
      g.clearGadgets();prepare(e);g.toggleSp(e);qb(e);const shootTarget=g.mirages.at(-1);e.pos.x+=30;sync();
      const from=new T.Vector3(0,202.4,15),aim=g.targetPoint(shootTarget);
      g.fire(u,aim,0,{...g.WEAPONS.ar,dmg:100},from);
      yes(shootTarget.hp<500,'実弾の実射で残像のHPが減る');
      g.blast({owner:u,team:u.team,spec:{dmg:1000,blast:10}},shootTarget.pos.clone().add(new T.Vector3(0,2,0)));
      yes(!shootTarget.alive,'爆風でも残像を破壊できる');
      for(const key of ['mirage','mirageH','mirageL','mirageD'])yes(g.ARMORY.assault.sp.includes(key)&&g.wStats(g.WEAPONS[key]).some(t=>t.startsWith('残像耐久')),key+'が装備一覧と説明に存在');
      g.clearGadgets();
      const renderSizes=[];
      for(const [i,key] of ['mirage','mirageH','mirageL','mirageD'].entries()) {
        prepare(e,key);e.pos.set((i-1.5)*7,200,0);e.yaw=Math.PI;sync();g.toggleSp(e);qb(e);
        const d=g.mirages.at(-1);renderSizes.push({key,vertices:d.mesh.geometry.attributes.position.count});
      }
      for(const v of [u,e,foe])v.group.visible=false;
      g.scene.add(new T.Mesh(new T.BoxGeometry(38,1,16),new T.MeshLambertMaterial({color:0x34424b})).translateY(199.5));
      g.camera.position.set(0,207,24);g.camera.lookAt(0,202,0);g.camera.updateProjectionMatrix();
      g.renderer.render(g.scene,g.camera);
      return {checks,renderSizes};
    });
    const out=path.resolve(process.argv[3]||'/tmp/mirage-results');fs.mkdirSync(out,{recursive:true});
    const canvas=await p.evaluateHandle(()=>__g.renderer.domElement);await p.evaluate(()=>__g.renderer.domElement.id='miragePreview');await p.addStyleTag({content:'body * { visibility: hidden !important; } #miragePreview { visibility: visible !important; }'});await canvas.asElement().screenshot({path:path.join(out,'variants.png')});
    for(const key of ['mirage','mirageH','mirageL','mirageD']) {
      await p.reload();
      await p.evaluate(key=>{
        document.querySelector('[data-page="pgCustom"]').click();
        document.querySelector('[data-cslot="sp"]').click();
        if(!document.querySelector('[data-pick="'+key+'"]')) document.querySelector('#cuSeries [data-series="mirage"]').click();
        document.querySelector('[data-pick="'+key+'"]').click();
      },key);
      assert.equal(await p.evaluate(()=>__g.loadout.assault.sp),key);
      await p.reload();assert.equal(await p.evaluate(()=>__g.loadout.assault.sp),key);
      result.checks.push(key+'を画面で装備し、再読み込み後も保存を維持');
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({count:result.checks.length,...result,errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
