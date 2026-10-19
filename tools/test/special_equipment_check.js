// 使い方: node tools/test/special_equipment_check.js dbg/special [画像出力先] [変更前stats.json]
// SPの防御・自律射撃・設置回復を実ゲームの関数で検証し、全9型のUI・保存・旧装備を確かめる。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
(async()=>{
  const dir=path.resolve(process.argv[2]||'dbg/special'), out=path.resolve(process.argv[3]||path.join(dir,'special-equipment'));
  fs.mkdirSync(out,{recursive:true});
  const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  try {
    const p=await b.newPage({viewport:{width:640,height:400}}), errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    p.on('console',m=>{if(m.type()==='error'&&!/net::ERR_FAILED/.test(m.text()))errors.push(m.text());});
    await p.goto('file://'+path.join(dir,'dbg.html'));
    await p.evaluate(()=>{__g.renderer.render=()=>{const u=__g.units[0];if(u)u.group.parent.updateMatrixWorld();}; __g.selectMap('dock'); document.getElementById('start').click(); __g.running=false;});
    const data=await p.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));
    assert.ok(Object.keys(data.weapons).length>=213);
    const source=require('../../research/weapons/types/special.json');
    for(const family of source.families)for(const row of family.rows){
      const w=data.weapons[row.key];
      for(const [k,v] of Object.entries(row.stats))if(v!==null)assert.equal(w[k],v,row.key+':'+k);
      assert.ok(data.armory[family.cls].sp.includes(row.key));
      if(row.stats.chargeKeep===null)assert.equal(w.chargeKeep,undefined);
    }
    if(process.argv[4]){
      const old=JSON.parse(fs.readFileSync(process.argv[4]));
      for(const [key,w]of Object.entries(old.weapons))assert.deepEqual(data.weapons[key],w,'旧武器 '+key);
      assert.deepEqual(data.parts,old.parts,'既存パーツ');
      for(const [cls,slots]of Object.entries(old.armory))for(const [slot,keys]of Object.entries(slots))assert.deepEqual(data.armory[cls][slot].filter(k=>keys.includes(k)),keys,'初期装備と並び順');
    }
    const checks=await p.evaluate(()=>{
      const g=__g,T=g.T,log=[],yes=(v,m)=>{if(!v)throw new Error(m);log.push(m);},near=(a,b)=>Math.abs(a-b)<1e-6;
      const u=g.player,e=g.units.find(q=>q.team==='R'),a=g.units.find(q=>q.team==='B'&&q!==u), scene=u.group.parent;
      for(const q of g.units){q.alive=false;q.downT=0;q.frozen=true;q.pos.set(10000,0,10000);}
      for(const q of g.turrets)q.alive=false;
      let spot=null;
      for(let z=-60;z<=60&&!spot;z+=6)for(let x=-50;x<=50&&!spot;x+=6){const y=g.terrainH(x,z);if(Math.abs(g.terrainH(x,z-40)-y)>.2)continue;const h=g.castFrom(new T.Vector3(x,y+3,z+12),new T.Vector3(0,0,-1),null,55);if(!h&&g.clearPath(x,z,x,z-40,y))spot=[x,y,z];}
      yes(!!spot,'遮蔽物のない試験場所');
      function sync(){for(const q of g.units){q.group.position.copy(q.pos);q.group.rotation.y=q.yaw||0;q.group.visible=q.alive;}scene.updateMatrixWorld(true);}
      function reset(cls,key){
        for(const gd of g.gadgets.slice())g.removeGadget(gd);
        for(const q of [u,e,a]){q.alive=true;q.hp=q.maxHp=100000;q.invulT=0;q.downT=0;q.stun='';q.weakT=0;q.barrierOn=q.escortOn=false;q.repairing=false;q.transfer=null;q.repairBlock=0;}
        u.isPlayer=true;g.loadout[cls].sp=key;g.equip(u,cls);u.hp=u.maxHp;u.pos.set(...spot);u.yaw=u.pitch=0;u.onGround=true;
        e.pos.set(spot[0],spot[1],spot[2]-12);e.yaw=Math.PI;
        a.pos.set(spot[0]+3,spot[1],spot[2]+1);a.yaw=0;
        g.equip(e,'assault');e.hp=e.maxHp=100000;e.stun='';
        sync();return u.slots.sp;
      }
      function step(t,trigger=false,aim=new T.Vector3(spot[0],spot[1],spot[2]-2)){
        for(let n=0;n<Math.round(t/.01);n++){for(const q of [u,e,a])if(q.alive)g.specialTick(q,.01);if(u.postRecall)g.selectWeapon(u,'sp');g.weaponsTick(u,.01,trigger,aim,0);g.gadgetUpdate(.01);sync();}
      }
      for(const key of ['barrier','barrierL','barrierM']){
        const sl=reset('heavy',key),hp=u.hp;g.toggleSp(u);yes(u.weapon==='main'&&u.barrierOn,key+' 手持ち武器のまま起動');
        g.damage(u,e,1000);yes(u.hp===hp&&near(sl.heat,100-120000/sl.w.shieldHp),key+' 前方からの一撃をSPで吸収');
        const heat=sl.heat;g.damage(u,e,1000,false,true);yes(u.hp<hp&&near(sl.heat,heat),key+' 近接は貫通');
        u.hp=hp;e.pos.z=spot[2]+12;g.damage(u,e,1000);yes((sl.w.arc===360?u.hp===hp:u.hp<hp),key+' 後方の防御角');
        u.hp=hp;e.pos.z=spot[2]-12;sl.heat=1;g.damage(u,e,100000);yes(u.hp===hp&&sl.overheat&&!u.barrierOn,key+' SP残量超過でも一撃を全吸収');
        step(sl.w.charge+.1);yes(!sl.overheat&&sl.heat===100,key+' 使い切りから再充填');
        sl.cd=0;g.toggleSp(u);u.repairing=true;g.specialTick(u,.01);yes(!u.barrierOn,key+' ポッド利用中は停止');u.repairing=false;
      }
      {const sl=reset('heavy','barrier');g.toggleSp(u);const hp=u.hp;sync();const from=new T.Vector3(e.pos.x,e.pos.y+3.7,e.pos.z);g.fire(e,new T.Vector3(u.pos.x,u.pos.y+3.7,u.pos.z),0,{dmg:1000,range:100},from);yes(u.hp===hp&&near(sl.heat,90.4),'実射はバリア表面に命中し頭部倍率が付かない');
       g.blast({owner:e,team:e.team,spec:{dmg:1000,blast:8}},u.pos.clone().add(new T.Vector3(0,2,-4)),null);yes(u.hp===hp&&sl.heat<90.4,'爆心方向で前方爆風を防御');
       g.blast({owner:e,team:e.team,spec:{dmg:1000,blast:8}},u.pos.clone().add(new T.Vector3(0,2,4)),null);yes(u.hp<hp,'背後で爆発した爆風は前面バリアを通る');}
      {const sl=reset('heavy','barrier');g.toggleSp(u);const heat=sl.heat;
       g.blast({owner:a,team:u.team,spec:{dmg:1000,blast:8}},u.pos.clone().add(new T.Vector3(0,2,-4)),null);yes(sl.heat===heat,'味方の爆風でバリアSPを消費しない');
       g.blast({owner:u,team:u.team,spec:{dmg:1000,blast:8}},u.pos.clone().add(new T.Vector3(0,2,-4)),null);yes(sl.heat===heat,'自分の爆風でバリアSPを消費しない');
       u.stun='';g.blast({owner:e,team:e.team,spec:{dmg:0,blast:8,knock:true}},u.pos.clone().add(new T.Vector3(0,2,-4)),null);yes(sl.heat===heat&&u.stun==='down','威力0の衝撃弾はSPを消費せずバリアを通す');}
      {const sl=reset('raid','escort');e.cloak=true;e.vis=.05;e.pos.z=spot[2]-20;sync();g.toggleSp(u);step(2);yes(sl.ammo===sl.w.mag,'背部自動銃は見えない迷彩中の敵へ撃たない');e.cloak=false;step(.1);yes(sl.ammo<sl.w.mag,'迷彩解除後は索敵して射撃');e.cloak=true;e.pos.z=spot[2]-6;sync();const n=sl.ammo;step(.2);yes(sl.ammo<n,'迷彩中でも至近距離で気付いた敵へ射撃');e.cloak=false;}
      for(const key of ['escort','escortR','escortH']){
        const sl=reset('raid',key),hp=e.hp,main=u.slots.main.ammo;g.toggleSp(u);step(.99);yes(e.hp===hp,key+' 展開後1秒は撃たない');step(.1);yes(e.hp<hp&&sl.ammo<sl.w.mag,key+' 1秒後に実弾命中');yes(u.weapon==='main'&&u.slots.main.ammo===main&&u.pitch===0&&u.recoil===0,key+' 主武器の弾・照準は独立');
        sl.ammo=1;u.escortCd=0;step(.01);yes(sl.reloadT>0,key+' 撃ち切りで腕性能の再装填');const rt=sl.reloadT;yes(near(rt,sl.w.reload*u.reloadMul),key+' 腕のリロード倍率');sl.cd=0;g.toggleSp(u);e.alive=false;step(rt+.02);e.alive=true;yes(sl.ammo===sl.w.mag&&sl.reserve===0,key+' 予備弾を使わず弾倉を補充');
        sl.cd=0;g.toggleSp(u);u.escortT=1;e.pos.z=spot[2]+12;sync();u.escortCd=0;sl.reloadT=0;const old=e.hp;step(.1);yes(key==='escortR'?e.hp<old:e.hp===old,key+' 型ごとの後方射角');
        u.repairing=true;g.specialTick(u,.01);yes(!u.escortOn,key+' ポッド中は停止');
      }
      {const sl=reset('raid','escortR');g.toggleSp(u);step(1.01);const n=sl.ammo;step(1);yes(n-sl.ammo===15,'900発/分の自動銃は1秒で15発');}
      {const sl=reset('raid','escort');const wall=new T.Mesh(new T.BoxGeometry(12,8,1),new T.MeshBasicMaterial());wall.position.set(spot[0],spot[1]+3,spot[2]-6);scene.add(wall);g.hittables.push(wall);sync();g.toggleSp(u);step(2);yes(sl.ammo===sl.w.mag,'自動銃は壁越しに撃たない');g.hittables.splice(g.hittables.indexOf(wall),1);scene.remove(wall);wall.geometry.dispose();wall.material.dispose();e.pos.z=spot[2]-sl.w.range-5;step(.2);yes(sl.ammo===sl.w.mag,'自動銃の射程外は撃たない');}
      {const sl=reset('raid','escort');g.toggleSp(u);e.alive=false;step(2);yes(sl.ammo===sl.w.mag,'敵機がいない時は施設・設置物へ自動射撃しない');
       e.alive=true;u.stun='down';u.transfer={t:5};step(.1);yes(sl.ammo<sl.w.mag,'転倒・エリア移動待機中も自動射撃');g.kill(u,e,false,100000);yes(!u.escortOn,'撃破で背部自動銃を解除');}
      for(const key of ['repairPost','repairPostW','repairPostG']){
        const sl=reset('support',key);a.hp=1000;u.hp=1000;g.selectWeapon(u,'sp');u.switchT=0;step(.01,true);yes(!!u.postFlight&&u.weapon==='main',key+' 投擲して主武器へ戻る');step(3);yes(!!u.post,key+' 地面に着いて設置');
        yes(a.hp>1000&&u.hp>1000,key+' 味方と自機を回復');yes(e.hp===e.maxHp,key+' 敵を回復しない');const post=u.post,hp=a.hp;g.damage(a,e,100);const hurt=a.hp;step(.5);yes(a.hp===hurt,key+' 被弾後は回復を一時中断');step(.6);yes(a.hp>hurt,key+' 被弾中断の後に回復再開');
        a.alive=false;a.downT=10;a.reviveAcc=0;step(3000/sl.w.heal+.03);yes(a.alive&&a.invulT===3,key+' 3000回復で蘇生');
        const heat=sl.heat;g.damage(post,u,1000);yes(sl.heat===heat,key+' 味方の射撃ではSPを削らない');g.damage(post,e,600);yes(near(sl.heat,heat-10),key+' 敵の装置攻撃でSP消費');
        g.selectWeapon(u,'sp');step(.2);yes(!!u.post,key+' 持ち替え中は回収待ち');step(1);yes(!u.post,key+' Botの連続選択でも持ち替え完了で遠隔回収');
        step(sl.w.charge+.6);u.switchT=0;step(.01,true);step(3);yes(!!u.post,key+' 回収後に再設置');g.equip(u,'support');yes(!u.post&&!g.gadgets.includes(post),key+' 再装備時に古い設置物を除去');
      }
      {const sl=reset('support','repairPost');a.hp=1000;g.selectWeapon(u,'sp');u.switchT=0;step(.01,true);step(3);const hp=a.hp;u.repairing=true;step(.5);yes(a.hp===hp,'ポッド利用中は設置回復も停止');u.repairing=false;g.kill(u,e,false,1000);const old=a.hp;g.postFieldTick(u.post,.1);yes(a.hp>old,'持ち主が行動不能でも大破までは設置回復');g.wreck(u);yes(!u.post,'持ち主の大破で設置物を除去');}
      {reset('heavy','barrier');u.isPlayer=false;u.target=e;g.botAct(u,true,g.cores.R);yes(u.barrierOn,'Botが交戦でバリア起動');reset('raid','escort');u.isPlayer=false;u.target=e;g.botAct(u,true,g.cores.R);yes(u.escortOn,'Botが交戦で背部自動銃を起動');reset('support','repairPost');u.isPlayer=false;a.hp=1000;u.target=e;yes(g.botAct(u,true,g.cores.R)?.slot==='sp','Botが交戦中も回復装置を設置');}
      {reset('support','repairPost');g.selectWeapon(u,'sp');u.switchT=0;step(.01,true);const flight=u.postFlight,barrier=u.barrierMesh;g.selectMap('city');yes(!flight.mesh.parent&&!barrier.parent&&g.gadgets.length===0,'マップ切替で投擲中の装置・防御面も除去');}
      return log;
    });
    console.log(checks.join('\n'));
    await p.evaluate(()=>document.exitPointerLock());
    await p.waitForFunction(()=>!document.pointerLockElement);
    await p.setViewportSize({width:1360,height:900});
    await p.evaluate(()=>{__g.renderCustom();__g.showPage('pgCustom');document.getElementById('overlay').hidden=false;});
    for(const [series,cls,last]of [['gb','heavy','barrierM'],['it','raid','escortH'],['ip','support','repairPostG']]){
      await p.click(`#pgCustom [data-cu="${cls}"]`);await p.click('[data-cslot="sp"]');const h=p.locator(`[data-series="${series}"]`);if(await h.getAttribute('aria-expanded')!=='true')await h.click();
      await p.locator(`[data-pick="${last}"]`).hover();assert.match(await p.locator('#cuDiff').innerText(),/[▲▼]/);await p.screenshot({path:path.join(out,series+'.png')});await p.click(`[data-pick="${last}"]`);
    }
    await p.reload();assert.deepEqual(await p.evaluate(()=>[__g.loadout.heavy.sp,__g.loadout.raid.sp,__g.loadout.support.sp]),['barrierM','escortH','repairPostG'],'保存・再読み込み');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'stats.json'),JSON.stringify(data,null,2));
    console.log('特殊装備9型、旧装備互換、動作'+checks.length+'項目、UI比較・保存：成功。エラーなし');
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
