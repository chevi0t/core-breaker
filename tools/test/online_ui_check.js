// 通信司令室：PC/スマホの配置と繰り返し操作。通信そのものの品質試験ではない。
// node tools/test/online_ui_check.js dbg --mock-transport
const path=require('node:path');
const {check}=require('./lib');
const {harness,pageFor}=require('./online_test_helpers');
check('オンライン通信司令室',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir),pages=[];
  const make=async()=>{const p=await pageFor(browser,h,errors,{autoApprove:false});pages.push(p);await p.evaluate(peerOptions=>{const create=CBOnlineGame.create,join=CBOnlineGame.join;CBOnlineGame.create=o=>create({...o,peerOptions});CBOnlineGame.join=(id,o)=>join(id,{...o,peerOptions});},h.peerOptions);return p;};
  try {
    const host=await make();
    for(let i=0;i<3;i++){
      await host.locator('#menuOnline').click();
      ok(await host.locator('#onlineName').evaluate(e=>document.activeElement===e),'開いたら申告名へフォーカス '+i);
      await host.locator('#onlineClose').click();
      ok(await host.locator('#onlinePanel').isHidden()&&await host.locator('#menuOnline').evaluate(e=>document.activeElement===e),'閉じるとメニューへ戻る '+i);
    }
    await host.locator('#menuOnline').click();
    await host.locator('#onlineJoin').click();
    ok(/部屋IDを入力/.test(await host.locator('#onlineStatus').textContent()),'空のIDは状態欄で案内する');
    for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['small',320,568]]){
      await host.setViewportSize({width,height});
      await host.waitForFunction(()=>getComputedStyle(document.getElementById('onlinePanel')).display==='flex');
      const layout=await host.evaluate(()=>{const p=document.getElementById('onlinePanel'),b=p.querySelector('.online-body'),f=p.querySelector('.online-footer'),r=p.getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,noOverflow:p.scrollWidth<=p.clientWidth&&b.scrollWidth<=b.clientWidth,footer:f.getBoundingClientRect().bottom<=r.bottom,columns:getComputedStyle(b).gridTemplateColumns.split(' ').length};});
      ok(layout.inside&&layout.noOverflow&&layout.footer, name+'で横はみ出しがなく退出が画面内');
      ok(layout.columns===(width>760?2:1),name+'でPC二列・スマホ一列へ切替');
      await host.screenshot({path:path.join(out,'online-'+name+'.png')});
    }
    await host.setViewportSize({width:1440,height:900});
    await host.locator('#onlineTeamMode').selectOption('choice');
    await host.locator('#onlineCreate').click();
    await host.waitForFunction(()=>CBOnlineGame.state.roomId&&!document.getElementById('onlineCopy').disabled);
    ok(await host.locator('#onlineRequests').isHidden(),'自動入室では承認欄を隠す');
    ok(await host.locator('#onlineStart').isDisabled(),'一人では開始できない');
    const id=await host.locator('#onlineRoom').inputValue();
    await host.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedRoom=text;}}}));
    await host.locator('#onlineCopy').click();
    ok(await host.evaluate(()=>window.__copiedRoom===CBOnlineGame.state.roomId),'クリックした部屋IDだけをコピー');
    const guest=await make();await guest.locator('#menuOnline').click();await guest.locator('#onlineRoom').fill(id);await guest.locator('#onlineJoin').click();
    await host.waitForFunction(()=>CBOnlineGame.state.roster.length===2&&[...CBOnlineGame.state.peers.values()].every(p=>p.preferred));
    ok(await host.locator('#onlineStart').isEnabled(),'自動入室後はホストが出撃できる');
    ok(await guest.locator('#onlineStart').isHidden()&&await guest.locator('#onlineMap').isDisabled(),'ゲストに開始・設定変更の操作を出さない');
    const team=host.locator('#onlineRoster [data-team="R"]');await team.focus();await host.keyboard.press('Enter');
    await host.waitForFunction(()=>CBOnlineGame.state.roster.find(p=>p.host)?.team==='R');
    ok(await team.getAttribute('aria-pressed')==='true','キーボードで希望所属を選べる');
    await host.screenshot({path:path.join(out,'online-lobby-desktop.png')});
    await host.setViewportSize({width:390,height:844});await host.screenshot({path:path.join(out,'online-lobby-mobile.png')});
    await guest.locator('#onlineClose').click();await host.locator('#onlineClose').click();await host.locator('#menuOnline').click();
    ok(await host.locator('#onlineRoom').inputValue()===''&&await host.locator('#onlineCopy').isHidden()&&await host.locator('#onlineEmpty').isVisible(),'退出後の再表示で古い部屋ID・参加者を残さない');
  } finally {for(const p of pages)if(!p.isClosed())await p.evaluate(()=>CBOnlineGame.leave('UI試験終了')).catch(()=>{});await h.close();}
},{page:false});
