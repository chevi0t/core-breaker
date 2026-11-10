// 全兵装の実ブラウザ回帰試験。作成時点では未実行。
// node tools/test/online_equipment_check.js dbg /tmp/online-equipment [--mock-transport]
// mockは機能確認専用。実WebRTC・実回線性能の証明にはならない。
// 全武器走査は「装備/残弾/SPの写真往復」であり、全武器の命中性能試験ではない。
const fs=require('node:fs'),path=require('node:path');
const {check}=require('./lib');
const {harness,room,frames,readyAll,sleep,neutral,input}=require('./online_test_helpers');
check('オンラインの全兵装・装備同期',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let r;const report={roundtrips:[],representatives:[],transport:process.argv.includes('--mock-transport')?'mock':'WebRTC'};
  try{
    const expected=[];
    r=await room(browser,h,errors,{guests:3,teamSize:4,guestClasses:['heavy','raid','support'],beforeStart:async(host,guests)=>{
      for(const [i,p]of [host,...guests].entries()){
        const e=await p.evaluate(i=>{
          const cls=['assault','heavy','raid','support'][i],options=CBOnlineGame.equipmentOptions(cls);
          const loadout=Object.fromEntries(__g.SLOTS.map(k=>[k,options.weapons[k].at(-1).id]));
          const e={...CBOnlineGame.state.equipment,cls,loadout};CBOnlineGame.setEquipment(e);CBOnlineGame.chooseTeam('B');return e;
        },i);expected.push(e);
      }
    }});
    const pages=r.pages,host=r.host,guest=r.guests[0];
    const ids=await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.localUnitId)));
    // 通信時計は実時間。大量の同期loopだけで経過時間を偽造せず、各コマで配送へ制御を返す。
    const pump=async(n=1)=>{for(let i=0;i<n;i++){await frames(pages,1,16.7);await sleep(10);}};
    const until=async(fn,label,timeout=12000)=>{
      const end=Date.now()+timeout;while(Date.now()<end){await pump();if(errors.length)throw Error(label+'：ブラウザエラー\n'+errors.join('\n'));if(await fn())return;}
      throw Error(label+'：条件が成立しません（'+timeout+'ms）');
    };
    for(const [i,id]of ids.entries())for(const p of [host,guest]){
      ok(await p.evaluate(({id,e})=>{const u=__g.units.find(x=>x.entityId===id);return u?.cls===e.cls&&Object.entries(e.loadout).every(([k,v])=>u.slots[k].w.key===v)&&Object.entries(e.mech).every(([k,v])=>u.mech[k]===v);},{id,e:expected[i]}),expected[i].cls+'：正規入室・装備API・Ready開始後、両画面の武器/パーツ一致');
    }
    // 攻撃で走査対象が死亡しないよう、戦場fixtureはホストのみで設定する。
    // snapshot直前の残弾/SPだけ固定。ゲスト状態や通信/復号コードは一切変更しない。
    await host.evaluate(()=>{
      const old=CBOnlineGame.afterFrame;CBOnlineGame.afterFrame=function(dt,t){
        for(const u of __g.units){u.invulT=3600;u.invulCancelOnAttack=false;}
        const f=window.__equipmentSentinel;if(f){const u=__g.units.find(x=>x.entityId===f.id),sl=u.slots[f.slot];sl.ammo=3;sl.reserve=11;sl.heat=37;sl.overheat=false;sl.reloadT=0;}
        return old(dt,t);
      };
    });
    for(const p of pages)await input(p,{...neutral});
    const catalog=await host.evaluate(()=>({rows:Object.entries(__g.ARMORY).flatMap(([cls,slots])=>Object.entries(slots).flatMap(([slot,keys])=>keys.map(key=>({cls,slot,key})))),keys:Object.keys(__g.WEAPONS)}));
    const unique=new Set(catalog.rows.map(x=>x.key));
    ok(unique.size>=323&&catalog.keys.every(k=>unique.has(k)),'現在の全武器（323種以上）がARMORY走査対象に含まれる');
    // 残弾・予備・SPの写真は本人の機体にだけ届く（他機の分は b733504 で送らなくなった）ので、ゲスト自身の機体で往復を確かめる。
    for(const entry of catalog.rows){
      const boundary=await host.evaluate(({entry,id})=>{
        const u=__g.units.find(x=>x.entityId===id);u.controlLoadout={...__g.CLASSES[entry.cls],[entry.slot]:entry.key};__g.equip(u,entry.cls);
        u.weapon='main';u.switchT=0;window.__equipmentSentinel={id,slot:entry.slot};return CBOnlineGame.state.frame;
      },{entry,id:ids[1]});
      await until(()=>guest.evaluate(({entry,id,boundary})=>{
        const s=CBOnlineGame.state.lastSnapshot,u=__g.units.find(x=>x.entityId===id),sl=u?.slots[entry.slot];
        return s?.frame>boundary&&u.cls===entry.cls&&sl.w.key===entry.key&&sl.ammo===3&&sl.reserve===11&&Math.abs(sl.heat-37)<.11&&!sl.overheat;
      },{entry,id:ids[1],boundary}),entry.key+'：装備値往復');
      report.roundtrips.push(entry);
    }
    ok(report.roundtrips.length===catalog.rows.length,'全ARMORYのkey・兵装・残弾3・予備11・SP37・非過熱をゲストで検証');
    await host.evaluate(()=>{window.__equipmentSentinel=null;});
    // 以下はゲスト本人の操作。fixtureはホストの装備/初期状態のみ変更する。
    const target=ids[1];
    const equipRepresentative=async(kind)=>{
      await input(guest,{...neutral});await pump(4);
      const selected=await host.evaluate(({kind,id})=>{
        const rows=Object.entries(__g.ARMORY).flatMap(([cls,slots])=>Object.entries(slots).flatMap(([slot,keys])=>keys.map(key=>({cls,slot,key}))));
        const e=rows.find(e=>kind==='drone'?!!__g.WEAPONS[e.key].drone:__g.WEAPONS[e.key].type===kind);
        if(!e)throw Error('代表武器なし: '+kind);
        const u=__g.units.find(x=>x.entityId===id);u.controlLoadout={...__g.CLASSES[e.cls],[e.slot]:e.key};__g.equip(u,e.cls);
        u.alive=true;u.hp=u.maxHp;u.weapon='main';u.switchT=0;u.stun='';u.stunT=u.electricT=u.jamT=0;u.transfer=null;u.repairing=false;
        u.slots[e.slot].heat=100;u.slots[e.slot].overheat=false;u.slots[e.slot].cd=0;
        return {...e,frame:CBOnlineGame.state.frame};
      },{kind,id:target});
      await until(()=>guest.evaluate(({e,id})=>CBOnlineGame.state.lastSnapshot?.frame>e.frame&&__g.units.find(x=>x.entityId===id)?.slots[e.slot].w.key===e.key,{e:selected,id:target}),kind+'：装備反映');
      await guest.evaluate(slot=>CBOnlineGame.requestWeapon(slot),selected.slot);
      return selected;
    };
    const pair=async(predicate)=>{for(const p of [host,guest])if(!await p.evaluate(predicate,target))return false;return true;};
    for(const kind of ['barrier','field']){
      const e=await equipRepresentative(kind);
      await until(()=>pair(id=>{const u=__g.units.find(x=>x.entityId===id),kind=u.slots.sp.w.type;return !!u[kind+'On']&&!!u[kind==='barrier'?'barrierMesh':'fieldMesh'].visible&&u.slots.sp.heat>0&&u.slots.sp.heat<100;}),kind+'：入力・SP消費・表示');
      // 切り替えた直後の0.5秒は次の切り替えを受け付けない（toggleSp の sl.cd。オフラインと同じ）。明けてから押す。
      await until(()=>host.evaluate(id=>__g.units.find(x=>x.entityId===id).slots.sp.cd<=0,target),kind+'：切り替えの待ち時間');
      await guest.evaluate(()=>CBOnlineGame.requestWeapon('sp'));
      await until(()=>pair(id=>{const u=__g.units.find(x=>x.entityId===id),kind=u.slots.sp.w.type;return !u[kind+'On']&&!u[kind==='barrier'?'barrierMesh':'fieldMesh'].visible;}),kind+'：再押下で停止');
      report.representatives.push({kind,key:e.key});ok(true,kind+'：ゲスト押下→ホスト確定→両画面の作動/停止/SP消費');
    }
    {
      const e=await equipRepresentative('repair');
      await until(()=>guest.evaluate(()=>__g.player.weapon==='sp'&&__g.player.switchT<=0),'repair：持替完了');
      const hp=await host.evaluate(id=>{const u=__g.units.find(x=>x.entityId===id);u.hp=u.maxHp-2000;return u.hp;},target);
      await input(guest,{...neutral,alt:true});
      await until(()=>pair(id=>{const u=__g.units.find(x=>x.entityId===id);return u.healTarget===u&&u.slots.sp.heat<100;}),'repair：自己修復');
      ok(await host.evaluate(({id,hp})=>__g.units.find(x=>x.entityId===id).hp>hp,{id:target,hp}),'repair：ゲスト右入力でホストHPが増える');
      await input(guest,{...neutral});await until(()=>pair(id=>!__g.units.find(x=>x.entityId===id).healTarget),'repair：解除');report.representatives.push({kind:'repair',key:e.key});
    }
    {
      const e=await equipRepresentative('drone');
      await until(()=>guest.evaluate(slot=>__g.player.weapon===slot&&__g.player.switchT<=0,e.slot),'drone：持替完了');
      const ammo=await host.evaluate(({id,slot})=>__g.units.find(x=>x.entityId===id).slots[slot].ammo,{id:target,slot:e.slot});
      await input(guest,{...neutral,trigger:true});
      await until(()=>guest.evaluate(id=>__g.drones.some(d=>d.owner?.entityId===id&&!!d.mesh.parent),target),'drone：ゲストに偵察機の模型');
      await input(guest,{...neutral});
      ok(await host.evaluate(({id,slot,ammo})=>__g.units.find(x=>x.entityId===id).slots[slot].ammo<ammo,{id:target,slot:e.slot,ammo}),'drone：ホスト弾数消費');
      ok(await guest.evaluate(id=>__g.drones.some(d=>d.owner?.entityId===id&&d.spec.scan>0&&d.mesh.scale.x===1.4),target),'drone：索敵半径と表示倍率を復元');report.representatives.push({kind:'drone',key:e.key});
    }
    {
      const e=await equipRepresentative('beamCannon');
      await until(()=>guest.evaluate(()=>__g.player.weapon==='sp'&&__g.player.switchT<=0),'beam：持替完了');
      await input(guest,{...neutral,trigger:true});
      await until(()=>pair(id=>{const u=__g.units.find(x=>x.entityId===id);return !!u.beamFire&&u.beamFire.warm<=0&&!!u.beamVisual?.root.visible&&u.slots.sp.heat<100;}),'beam：照射開始');
      await guest.evaluate(()=>__g.aimPress(2,false));
      await input(guest,{...neutral});
      await until(()=>pair(id=>{const u=__g.units.find(x=>x.entityId===id);return !u.beamFire&&!u.beamVisual?.root.visible&&u.weapon!=='sp';}),'beam：右クリック中断');
      report.representatives.push({kind:'beamCannon',key:e.key});ok(true,'照射砲：ゲスト発射・SP消費・模型・右クリック中断');
    }
    {
      const e=await equipRepresentative('reflector');
      await until(()=>guest.evaluate(()=>__g.player.weapon==='sp'&&__g.player.switchT<=0),'reflector：持替完了');
      const at=await guest.evaluate(()=>{const p=__g.player.pos;return [p.x,p.y,p.z];});
      await guest.evaluate(at=>__g.reflectorConfirm(__g.player,new __g.T.Vector3(...at)),at);
      await input(guest,{...neutral,trigger:true,aimPoint:at});
      await until(()=>pair(id=>{const u=__g.units.find(x=>x.entityId===id);return u.reflect?.phase==='fire'&&!!u.reflectVisual?.root.visible&&u.slots.sp.heat<100;}),'reflector：地点確定・予告後照射');
      await input(guest,{...neutral});
      await until(()=>pair(id=>{const u=__g.units.find(x=>x.entityId===id);return !u.reflect&&!u.reflectVisual?.root.visible;}),'reflector：左解除で停止');
      report.representatives.push({kind:'reflector',key:e.key});ok(true,'反射衛星砲：ゲスト地点指定・SP消費・光柱・解除');
    }
    // 残存偵察機を含む試合終了→同じ部屋で再Ready。判定配列/模型をゲストから掃除しない。
    await host.evaluate(()=>{__g.timeLeft=.001;});
    await until(async()=>{const phases=await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)));return phases.every(x=>x==='lobby');},'全画面ロビー復帰');
    for(const p of pages)ok(await p.evaluate(()=>CBOnlineGame.state.roster.every(p=>!p.ready&&!p.editing)),'試合終了で全員Ready解除');
    await readyAll(pages,host);await host.evaluate(()=>{window.__startPromise=CBOnlineGame.start();});
    await until(async()=>{const phases=await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)));return phases.every(x=>x==='playing');},'同じ部屋で再試合',20000);
    ok(await guest.evaluate(()=>__g.drones.length===0&&__g.gadgets.length===0&&__g.units.every(u=>!u.beamFire&&!u.reflect&&!u.post&&!u.postFlight)),'再試合開始時に偵察機・設置物・特殊SPが残らない');
    await r.guests[2].evaluate(()=>CBOnlineGame.leave('切断引継ぎ試験'));
    await until(()=>host.evaluate(id=>__g.units.find(x=>x.entityId===id)?.controller==='bot',ids[3]),'切断した人間をBotへ引継ぎ');
    ok(await host.evaluate(id=>{const u=__g.units.find(x=>x.entityId===id);return u.controller==='bot'&&u.ownerPeerId===null&&u.alive;},ids[3]),'切断後も同じ機体を生存Botとして維持');
  }finally{
    fs.writeFileSync(path.join(out,'online-equipment-browser.json'),JSON.stringify(report,null,2));
    await r?.close().catch(()=>{});await h.close();
  }
},{page:false});
