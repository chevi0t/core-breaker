// ロビーの明示Ready・部屋専用装備・控えめな催促・試合後リセット。
// --mock-transport は機能試験だけ。NAT越え・実回線性能の証明には使わない。
const path=require('node:path');
const {check}=require('./lib');
const {harness,pageFor,frames,readyAll}=require('./online_test_helpers');
check('オンラインのReadyと装備変更',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir),pages=[];
  const make=async()=>{const p=await pageFor(browser,h,errors);pages.push(p);await p.evaluate(peerOptions=>{
    const create=CBOnlineGame.create,join=CBOnlineGame.join;CBOnlineGame.create=o=>create({...o,peerOptions});CBOnlineGame.join=(id,o)=>join(id,{...o,peerOptions});
    // 診断ログの専用キーは独立して増える。オフラインの装備・既存保存キーだけを比較する。
    window.__offlineBuild=()=>JSON.stringify({mech:__g.mechCfg,loadout:__g.loadout,storage:Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='coreBreakerOnlineDiagnosticsV1'))});
    window.__savedBuild=window.__offlineBuild();
  },h.peerOptions);return p;};
  const wait=(p,fn)=>p.waitForFunction(fn,{},{polling:20,timeout:20000});
  try{
    const host=await make(),guest=await make();
    await host.locator('#menuOnline').click();await host.locator('#onlineTeamSize').selectOption('2');await host.locator('#onlineCreate').click();
    await wait(host,()=>!!CBOnlineGame.state.roomId);const id=await host.evaluate(()=>CBOnlineGame.state.roomId);
    await guest.locator('#menuOnline').click();await guest.locator('#onlineRoom').fill(id);await guest.locator('#onlineJoin').click();
    await wait(guest,()=>!!CBOnlineGame.state.equipment&&!document.getElementById('onlineReady').disabled);
    ok(await host.locator('#onlineStart').isDisabled(),'入室だけでは出撃できない');
    ok(await host.evaluate(()=>{try{CBOnlineGame.start();return false;}catch(e){return /Ready/.test(e.message);}}),'APIを直接呼んでも全員Ready前の開始を拒否');
    await host.locator('#onlineReady').click();
    await wait(guest,()=>CBOnlineGame.state.roster.find(p=>p.host)?.ready);
    ok(await guest.locator('#onlineReadyNudge').isHidden(),'装備中でない人には催促を出さない');
    await guest.locator('#onlineEquipment').click();
    await wait(guest,()=>CBOnlineGame.state.editing);
    await guest.locator('#onlineReadyNudge').waitFor({state:'visible'});
    const firstNudge=await guest.evaluate(()=>CBOnlineGame.state.lastNudgeAt);
    ok(/そろそろ/.test(await guest.locator('#onlineReadyNudge').textContent()),'ほかの全員がReadyなら装備中の本人へ静かな通知');
    ok(await guest.locator('#onlineReady').isDisabled(),'装備編集を閉じるまでReady不可');
    await host.evaluate(()=>{CBOnlineGame.setReady(false);CBOnlineGame.setReady(true);CBOnlineGame.updateSettings({teamSize:2});});
    await wait(guest,()=>CBOnlineGame.state.roster.find(p=>p.host)?.ready);
    ok(await guest.evaluate(t=>CBOnlineGame.state.lastNudgeAt===t,firstNudge),'繰り返しReadyや同じ設定の再送でも催促を連打しない');
    await guest.locator('#onlineEquipmentClass').selectOption('heavy');
    for(const key of ['main','sub','aux','sp','head','body','arms','legs','color']){
      const select=guest.locator('[data-equipment="'+key+'"]');
      const options=await select.locator('option').evaluateAll(xs=>xs.map(x=>x.value));
      const current=await select.inputValue(),other=options.find(value=>value!==current);if(other)await select.selectOption(other);
    }
    await guest.screenshot({path:path.join(out,'online-ready-equipment.png')});
    const hostEquipment=await host.evaluate(()=>JSON.stringify(CBOnlineGame.state.equipment));
    await guest.locator('#onlineEquipmentSave').click();
    await wait(guest,()=>!CBOnlineGame.state.editing&&!CBOnlineGame.state.equipmentPending&&CBOnlineGame.state.equipment.cls==='heavy');
    const expected=await guest.evaluate(()=>JSON.parse(JSON.stringify(CBOnlineGame.state.equipment)));
    ok(await host.evaluate(()=>CBOnlineGame.state.roster.find(p=>p.host).ready&&!CBOnlineGame.state.roster.find(p=>!p.host).ready),'個人装備変更で自分だけReady解除');
    // 2026-11-10 から、本人が「保存して部屋に戻る」で保存した変更はオフラインと共通の3構成へ反映する（saveEquipmentBuilds）。
    // 通信で届いた他人の装備は、誰の保存も変えない。
    ok(await guest.evaluate(e=>window.__savedBuild!==window.__offlineBuild()&&Object.entries(e.mech).every(([k,v])=>__g.mechCfg[k]===v),expected),'本人が保存した装備は共通の構成（オフラインの保存）へ反映');
    // この試験の2ページは同じブラウザの保存領域を共有する（別タブと同じ）。保存データはホスト側にも見えるので、
    // 「ほかの人の変更で変わらない」はホストの部屋用装備で確かめ、保存データの基準は両方ここで取り直す。
    ok(await host.evaluate(e=>JSON.stringify(CBOnlineGame.state.equipment)===e,hostEquipment),'ほかの人の装備変更は自分の部屋用装備を変えない');
    for(const p of pages)await p.evaluate(()=>{window.__savedBuild=window.__offlineBuild();});
    await guest.locator('#onlineReady').click();await wait(host,()=>CBOnlineGame.canStart());
    ok(await host.locator('#onlineStart').isEnabled()&&await host.evaluate(()=>CBOnlineGame.state.phase==='lobby'),'全員Readyでも自動開始せずホストの出撃を待つ');
    await host.evaluate(()=>CBOnlineGame.updateSettings({teamSize:3}));
    await wait(guest,()=>CBOnlineGame.state.settings.teamSize===3&&CBOnlineGame.state.roster.every(p=>!p.ready));
    ok(await host.locator('#onlineStart').isDisabled(),'部屋設定変更は人間全員のReadyを解除');
    await readyAll(pages,host);await guest.locator('#onlineEquipment').click();
    await wait(host,()=>CBOnlineGame.state.roster.some(p=>p.editing));
    await guest.locator('#onlineEquipmentCancel').click();
    await wait(guest,()=>!CBOnlineGame.state.editing);
    ok(await guest.evaluate(e=>JSON.stringify(CBOnlineGame.state.equipment)===JSON.stringify(e),expected),'取消では装備を変えずロビーへ戻す');
    ok(await host.locator('#onlineStart').isDisabled(),'編集を取り消した後も再度Readyを必要とする');
    await readyAll(pages,host);await host.locator('#onlineStart').click();
    for(let i=0;i<500;i++){await frames(pages);if((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='playing'))break;}
    ok((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='playing'),'手動開始で両画面が試合へ進む');
    const guestId=await guest.evaluate(()=>CBOnlineGame.state.localUnitId);
    for(const p of pages){
      ok(await p.evaluate(({id,e})=>{const u=__g.units.find(u=>u.entityId===id);return u&&u.cls===e.cls&&JSON.stringify(u.mech)===JSON.stringify(e.mech)&&Object.entries(e.loadout).every(([k,key])=>u.slots[k].w.key===key)&&u.maxBoost===mechStats(e.mech,e.loadout).P.body.boost;},{id:guestId,e:expected}),'選んだ兵装・武器4枠・機体パーツをホストとゲストへ反映');
      ok(await p.evaluate(()=>{const u=__g.player;let refs=0;u.group.traverse(o=>{if(o.isMesh&&!o.userData.visualOnly&&o.userData.ref===u&&__g.hittables.includes(o))refs++;});return refs>0;}),'機体モデルの当たり判定を正しい所有者へ再登録');
    }
    await host.evaluate(()=>__g.timeLeft=.1);
    for(let i=0;i<100;i++){await frames(pages);if((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='lobby'))break;}
    for(const p of pages){
      await wait(p,()=>CBOnlineGame.state.phase==='lobby'&&CBOnlineGame.state.roster.every(p=>!p.ready&&!p.editing));
      await p.locator('#start').click();
      ok(await p.locator('#onlineReady').isEnabled(),'試合後は同じ部屋で全員のReadyをリセット');
    }
    ok(await guest.evaluate(e=>JSON.stringify(CBOnlineGame.state.equipment)===JSON.stringify(e),expected),'次の試合にも部屋専用装備を保持');
    await readyAll(pages,host);await guest.locator('#onlineClose').click();await guest.locator('#onlineLeaveConfirm').click();
    await wait(host,()=>CBOnlineGame.state.roster.length===1);
    ok(await host.locator('#onlineStart').isDisabled()&&!await host.evaluate(()=>CBOnlineGame.state.lobbyReady),'退出時もReadyを解除し一人だけでは出撃しない');
    for(const p of pages)ok(await p.evaluate(()=>window.__savedBuild===window.__offlineBuild()),'試合後・退出後も、本人が保存した時点からオフライン保存は不変');
  }finally{for(const p of pages)if(!p.isClosed())await p.evaluate(()=>CBOnlineGame.leave('Ready試験終了')).catch(()=>{});await h.close();}
},{page:false});
