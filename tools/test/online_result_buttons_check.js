// オンライン試合の結果画面のボタンが働くこと（2026-11-08 オーナー報告：試合後に固まる）。
// 試合後は同じ部屋の待機へ戻り、同じメンバーで続けて遊べること（2026-11-08 オーナー「さっき繋いだ人らがまたロビーに戻る形に」）。
// node tools/test/online_result_buttons_check.js dbg --mock-transport
const {check}=require('./lib');
const {readyAll,harness,pageFor,frames}=require('./online_test_helpers');
check('オンライン結果画面のボタン',async({browser,dir,ok,errors})=>{
  const h=await harness(dir),pages=[];
  const page=async()=>{const p=await pageFor(browser,h,errors,{autoApprove:false});pages.push(p);await p.evaluate(peerOptions=>{const create=CBOnlineGame.create,join=CBOnlineGame.join;CBOnlineGame.create=o=>create({...o,peerOptions});CBOnlineGame.join=(id,o)=>join(id,{...o,peerOptions});},h.peerOptions);return p;};
  try{
  const host=await page();await host.locator('#menuOnline').click();await host.locator('#onlineTeamSize').selectOption('2');await host.locator('#onlineCreate').click();
  await host.waitForFunction(()=>CBOnlineGame.state.roomId,{},{polling:20});const id=await host.evaluate(()=>CBOnlineGame.state.roomId);
  const g=await page();await g.locator('#menuOnline').click();await g.locator('#onlineRoom').fill(id);await g.locator('#onlineJoin').click();
  await host.waitForFunction(()=>CBOnlineGame.state.roster.length>=2&&[...CBOnlineGame.state.peers.values()].every(p=>p.preferred),{},{polling:20});
  ok(await host.evaluate(()=>CBOnlineGame.state.requests.size===0),'入室承認なしで自動で入室する');
  const playAndEnd=async(label,pages)=>{
    await readyAll(pages,host);
    await host.locator('#onlineStart').click();
    for(let i=0;i<400;i++){await frames(pages,1);if((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='playing'))break;}
    ok((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='playing'),label+'：両方の画面で試合が始まる');
    await frames(pages,10);
    await host.evaluate(()=>{__g.timeLeft=0.3;});
    for(let i=0;i<60;i++){await frames(pages,1);if((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='lobby'))break;}
    ok((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase+'/'+!document.getElementById('overlay').hidden)))).every(x=>x==='lobby/true'),label+'：試合が終わると結果画面のまま、両方とも同じ部屋の待機へ戻る');
  };
  await playAndEnd('1試合目',[host,g]);
  ok(await host.locator('#start').textContent()==='ロビーへ戻る（同じメンバー）','結果画面の出撃ボタンはロビーへ戻る表示');
  await host.locator('#start').click();await frames([host],2);
  ok(await host.evaluate(()=>CBOnlineGame.state.phase==='lobby'&&!document.getElementById('onlinePanel').hidden&&CBOnlineGame.state.roster.length===2&&document.getElementById('onlineStart').disabled),'ホスト：出撃ボタンでロビーを開き、さっきのゲストが残っていてReadyをリセットして次の試合の準備を待つ');
  await g.locator('#start').click();await frames([g],2);
  ok(await g.evaluate(()=>CBOnlineGame.state.phase==='lobby'&&!document.getElementById('onlinePanel').hidden&&CBOnlineGame.state.roster.length===2),'ゲスト：出撃ボタンで同じ部屋のロビーを開く');
  await playAndEnd('2試合目（同じ部屋で連続）',[host,g]);
  await g.locator('#menuRange').click();await frames([g],2);
  ok(await g.evaluate(()=>CBOnlineGame.state.phase==='lobby'&&!document.getElementById('onlinePanel').hidden),'ゲスト：結果画面のほかのボタンでは部屋を出ず、ロビーを開いて退出を案内する');
  await g.locator('#onlineClose').click();await g.locator('#onlineLeaveConfirm').click();await frames([host,g],4);
  await host.waitForFunction(()=>CBOnlineGame.state.roster.length===1,{},{polling:20,timeout:5000});
  ok(await g.evaluate(()=>CBOnlineGame.state.phase==='idle'&&document.getElementById('start').textContent==='もう一度出撃する'),'ゲスト：ロビーの退出で部屋を出て、出撃ボタンの表示も戻る');
  const g2=await page();await g2.locator('#menuOnline').click();await g2.locator('#onlineRoom').fill(id);await g2.locator('#onlineJoin').click();
  await host.waitForFunction(()=>CBOnlineGame.state.roster.length===2&&[...CBOnlineGame.state.peers.values()].every(p=>p.preferred),{},{polling:20,timeout:15000});
  ok(true,'試合の後のロビーにも、新しい人が同じ部屋IDで入れる');
  await host.locator('#start').click();await frames([host],2);
  await playAndEnd('3試合目（入れ替わったメンバー）',[host,g2]);
  }finally{for(const p of pages)if(!p.isClosed())await p.evaluate(()=>CBOnlineGame.leave('試験終了')).catch(()=>{});await h.close();}
});
