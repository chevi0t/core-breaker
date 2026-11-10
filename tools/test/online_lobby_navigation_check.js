// node tools/test/online_lobby_navigation_check.js dbg /tmp/online-navigation --mock-transport
// 実DOM/keyboard/CSSで導線を確認。--mock-transportは実WebRTC・回線の検証ではない。
const path=require('node:path');
const {check}=require('./lib');
const {harness,pageFor}=require('./online_test_helpers');
check('部屋を維持する装備編集と退出確認',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir),pages=[];
  const make=async()=>{const p=await pageFor(browser,h,errors);pages.push(p);await p.evaluate(peerOptions=>{
    const create=CBOnlineGame.create,join=CBOnlineGame.join;
    CBOnlineGame.create=o=>create({...o,peerOptions});CBOnlineGame.join=(id,o)=>join(id,{...o,peerOptions});
  },h.peerOptions);return p;};
  const wait=(p,fn)=>p.waitForFunction(fn,{},{polling:20,timeout:20000});
  try{
    const host=await make(),guest=await make();
    await host.locator('#menuOnline').click();await host.locator('#onlineCreate').click();
    await wait(host,()=>CBOnlineGame.state.phase==='lobby'&&!document.getElementById('onlineEquipment').disabled&&!!CBOnlineGame.state.roomId);
    const room=await host.evaluate(()=>CBOnlineGame.state.roomId);
    await guest.locator('#menuOnline').click();await guest.locator('#onlineRoom').fill(room);await guest.locator('#onlineJoin').click();
    await wait(guest,()=>!!CBOnlineGame.state.equipment&&!document.getElementById('onlineEquipment').disabled);
    for(const [role,p] of [['host',host],['guest',guest]]){
      const before=await p.evaluate(()=>JSON.stringify(CBOnlineGame.savedBuilds()));
      await p.locator('#onlineEquipment').click();await wait(p,()=>CBOnlineGame.state.editing);
      const weapon=p.locator('[data-equipment="main"]'),old=await weapon.inputValue();
      const other=await weapon.locator('option').evaluateAll((xs,old)=>xs.map(x=>x.value).find(x=>x!==old),old);
      await weapon.selectOption(other);await p.keyboard.press('Escape');
      ok(await p.locator('#onlineEquipmentEditor').isVisible()&&await p.evaluate(id=>CBOnlineGame.state.roomId===id,room),role+'：Escで編集・部屋を保持');
      for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['small',320,568],['short',844,390],['zoom',320,300]]){
        await p.setViewportSize({width,height});
        if(height<=560){
          for(const id of ['onlineEquipmentBuild','onlineEquipmentSave','onlineEquipmentCancel','onlineClose']){
            await p.locator('#'+id).scrollIntoViewIfNeeded();
            ok(await p.locator('#'+id).evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),role+' '+name+'：'+id+'へスクロールで到達');
          }
        }else for(const scroll of [0,99999]){
          await p.locator('.online-body').evaluate((e,top)=>e.scrollTop=top,scroll);
          const layout=await p.evaluate(()=>{
            const panel=document.getElementById('onlinePanel'),body=panel.querySelector('.online-body');
            const inside=id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;};
            return ['onlineEquipmentSave','onlineEquipmentCancel','onlineClose'].every(inside)&&panel.scrollWidth<=panel.clientWidth&&body.scrollWidth<=body.clientWidth&&body.clientHeight>0;
          });
          ok(layout,role+' '+name+'：スクロール'+scroll+'でも保存・破棄・退出が画面内');
        }
        await p.screenshot({path:path.join(out,role+'-equipment-'+name+'.png')});
      }
      await p.setViewportSize({width:1440,height:900});
      await p.locator('#onlineClose').click();ok(await p.locator('#onlineLeaveDialog').isVisible(),role+'：退出は確認を挟む');
      ok(await p.locator('#onlineLeaveCancel').evaluate(e=>document.activeElement===e),role+'：確認の初期フォーカスは退出しない方');
      await p.keyboard.press('Escape');ok(await p.locator('#onlineLeaveDialog').isHidden()&&await p.locator('#onlineEquipmentEditor').isVisible(),role+'：Escは確認だけを閉じる');
      await p.locator('#onlineClose').click();await p.locator('#onlineLeaveCancel').click();ok(await weapon.inputValue()===other,role+'：退出を取り消して下書きを保持');
      await p.locator('#onlineEquipmentCancel').click();await wait(p,()=>!CBOnlineGame.state.editing);
      ok(await p.evaluate(b=>JSON.stringify(CBOnlineGame.savedBuilds())===b,before),role+'：明示破棄では保存構成不変');
      await p.locator('#onlineEquipment').click();await weapon.selectOption(other);await p.locator('#onlineEquipmentSave').click();
      await wait(p,()=>!CBOnlineGame.state.editing&&!CBOnlineGame.state.equipmentPending);
      ok(await p.evaluate(({room,other})=>CBOnlineGame.state.roomId===room&&CBOnlineGame.state.equipment.loadout.main===other&&CBOnlineGame.savedBuilds().list[CBOnlineGame.savedBuilds().cur].loadout[CBOnlineGame.state.equipment.cls].main===other,{room,other}),role+'：保存後も同じ部屋に残り共通構成へ反映');
      ok(await p.locator('#onlinePanel').isVisible()&&await p.locator('#onlineEquipmentEditor').isHidden(),role+'：保存から最初のメニューへ出ない');
      await p.keyboard.press('Escape');ok(await p.locator('#onlinePanel').isVisible(),role+'：ロビーEscでも最初メニューへ出ない');
    }
    await guest.locator('#onlineClose').click();await guest.locator('#onlineLeaveConfirm').click();
    await wait(host,()=>CBOnlineGame.state.roster.length===1);
    ok(await guest.evaluate(()=>CBOnlineGame.state.role==='offline')&&await guest.locator('#onlinePanel').isHidden(),'ゲストが確認して初めて部屋を退出');
    await host.locator('#onlineClose').click();await host.locator('#onlineLeaveConfirm').click();
    ok(await host.evaluate(()=>CBOnlineGame.state.role==='offline'),'ホストも確認して終了');
  }finally{for(const p of pages)if(!p.isClosed())await p.evaluate(()=>CBOnlineGame.leave('導線試験終了')).catch(()=>{});await h.close();}
},{page:false});
