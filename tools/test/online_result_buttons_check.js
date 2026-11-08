// オンライン試合の結果画面のボタンが働くこと（2026-11-08 オーナー報告：試合後に固まる）。
// node tools/test/online_result_buttons_check.js dbg --mock-transport
const {check}=require('./lib');
const {harness,pageFor,frames}=require('./online_test_helpers');
check('オンライン結果画面のボタン',async({browser,dir,ok,errors})=>{
  const h=await harness(dir),pages=[];
  const page=async()=>{const p=await pageFor(browser,h,errors,{autoApprove:false});pages.push(p);await p.evaluate(peerOptions=>{const create=CBOnlineGame.create,join=CBOnlineGame.join;CBOnlineGame.create=o=>create({...o,peerOptions});CBOnlineGame.join=(id,o)=>join(id,{...o,peerOptions});},h.peerOptions);return p;};
  try{
  const host=await page();await host.locator('#menuOnline').click();await host.locator('#onlineTeamSize').selectOption('2');await host.locator('#onlineCreate').click();
  await host.waitForFunction(()=>CBOnlineGame.state.roomId,{},{polling:20});const id=await host.evaluate(()=>CBOnlineGame.state.roomId);
  const g=await page();await g.locator('#menuOnline').click();await g.locator('#onlineRoom').fill(id);await g.locator('#onlineJoin').click();
  await host.waitForFunction(()=>CBOnlineGame.state.roster.length>=2&&[...CBOnlineGame.state.peers.values()].every(p=>p.preferred),{},{polling:20});
  ok(await host.evaluate(()=>CBOnlineGame.state.requests.size===0),'入室承認なしで自動で入室する');
  await host.locator('#onlineStart').click();
  for(let i=0;i<400;i++){await frames(pages,1);if(await host.evaluate(()=>CBOnlineGame.state.phase==='playing'))break;}
  await frames(pages,10);
  await host.evaluate(()=>{__g.timeLeft=0.3;});
  for(let i=0;i<60;i++){await frames(pages,1);if((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='ended'))break;}
  ok((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='ended'),'両方の画面が試合結果になる');
  ok(await host.locator('#start').textContent()==='オンラインのメニューへ戻る','結果画面の出撃ボタンはオンラインのメニューへ戻る表示');
  await host.locator('#start').click();await frames([host],2);
  ok(await host.evaluate(()=>CBOnlineGame.state.phase==='idle'&&!document.getElementById('onlinePanel').hidden&&document.getElementById('start').textContent==='もう一度出撃する'),'ホスト：出撃ボタンで部屋を出てオンラインのメニューを開く');
  await g.waitForFunction(()=>CBOnlineGame.state.phase==='ended',{},{polling:20});
  await g.locator('#menuRange').click();
  await frames([g],2);
  ok(await g.evaluate(()=>CBOnlineGame.state.phase==='idle'),'ゲスト：結果画面のほかのボタンも部屋を出てから働く');
  }finally{for(const p of pages)if(!p.isClosed())await p.evaluate(()=>CBOnlineGame.leave('試験終了')).catch(()=>{});await h.close();}
});
