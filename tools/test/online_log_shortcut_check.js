// 実ブラウザでF8と試合入力の共存を確認する。clipboardだけは検査用spy。
// --mock-transport時の通信はBroadcastChannel。実WebRTC・実clipboard許可は別受入。
const path=require('node:path'),{check}=require('./lib'),{harness,pageFor,frames,readyAll}=require('./online_test_helpers');
check('オンライン診断ログのF8コピー',async({browser,dir,out,ok,errors})=>{
 const h=await harness(dir),pages=[];
 try{
  const host=await pageFor(browser,h,errors),guest=await pageFor(browser,h,errors);pages.push(host,guest);
  const id=await host.evaluate(peerOptions=>CBOnlineGame.create({peerOptions,displayName:'PRIVATE_HOST',teamSize:2}),h.peerOptions);
  await guest.evaluate(([id,peerOptions])=>CBOnlineGame.join(id,{peerOptions,displayName:'PRIVATE_GUEST'}),[id,h.peerOptions]);
  for(const p of pages)await p.evaluate(()=>{window.__copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied.push(text);}}});document.activeElement?.blur();});
  for(const [i,p]of pages.entries()){
   await p.keyboard.press('F8');
   ok(await p.evaluate(([role,id])=>{const text=window.__copied.at(-1);return !!text&&text.startsWith('CBL2.S.')&&text.length<=6000&&!/[\r\n]/.test(text)&&!text.includes(id)&&!/PRIVATE_HOST|PRIVATE_GUEST/.test(text);},[i?'guest':'host',id]),'両端のF8本文は圧縮形式で名前・部屋IDの平文なし '+i);
   ok(await p.locator('#onlineLogNotice').isVisible(),'コピー通知を表示 '+i);
  }
  await readyAll(pages,host);await host.evaluate(()=>CBOnlineGame.start());
  for(let i=0;i<500;i++){await frames(pages);if((await Promise.all(pages.map(p=>p.evaluate(()=>CBOnlineGame.state.phase)))).every(x=>x==='playing'))break;}
  for(const [i,p]of pages.entries()){
   ok(await p.evaluate(()=>CBOnlineGame.state.phase==='playing'),'試合開始 '+i);
   await p.bringToFront();await p.evaluate(()=>document.activeElement?.blur());await p.locator('#view').click();
   await p.waitForFunction(()=>document.pointerLockElement===document.getElementById('view'),{},{timeout:5000});
   ok(await p.evaluate(()=>!!document.pointerLockElement),'実pointer lockを取得 '+i);await p.keyboard.down('w');
   const before=await p.evaluate(()=>({phase:CBOnlineGame.state.phase,weapon:__g.player.weapon,locked:!!document.pointerLockElement}));
   await p.keyboard.down('F8');await p.keyboard.down('F8');
   ok(await p.evaluate(before=>CBOnlineGame.state.phase===before.phase&&__g.keys.KeyW===true&&!__g.keys.F8&&__g.player.weapon===before.weapon&&!!document.pointerLockElement===before.locked&&!document.getElementById('onlineLogDialog').open,before),'W保持・武器・pointer lock・試合を変えない '+i);
   await p.keyboard.up('F8');await p.keyboard.up('w');
   ok(await p.evaluate(()=>!__g.keys.KeyW&&!__g.keys.F8),'キー解放を保持しない '+i);
   await p.keyboard.press('F3');ok(await p.locator('#onlineDiagnostic').isVisible(),'既存F3表示と共存 '+i);
   await p.keyboard.press('v');const chatOpen=await p.locator('#onlineQuickChat').isVisible();ok(chatOpen,'既存V定型通信を開ける '+i);await p.keyboard.press('Escape');
  }
  await host.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('PRIVATE_ERROR');};});await host.keyboard.press('F8');
  ok(/コピーできません.*以前のクリップボード/s.test(await host.locator('#onlineLogNotice').textContent()),'拒否時は前の内容を貼らない案内');
  for(const [width,height]of [[1440,900],[390,844],[320,568]]){await host.setViewportSize({width,height});ok(await host.locator('#onlineLogNotice').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'通知が画面内 '+width);}
  await host.screenshot({path:path.join(out,'log-copy-failed.png')});
  await host.keyboard.press('Escape');await host.locator('.online-measure summary').click();await host.locator('#onlineLogOpen').click();
  await host.locator('#onlineLogCopy').click();ok(await host.locator('#onlineLogText').evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length),'拒否時は手動コピー用に本文選択');
  await host.keyboard.press('Escape');ok(await host.locator('#onlineLogDialog').evaluate(e=>!e.open),'診断をEscapeで閉じられる');
  const before=await guest.evaluate(()=>window.__copied.length);await guest.keyboard.press('Escape');
  // 接続中の申告名はdisabled。部屋IDはreadonlyだがフォーカス可能な実入力欄。
  await guest.locator('#onlineRoom').focus();
  ok(await guest.evaluate(()=>document.activeElement?.id==='onlineRoom'),'部屋ID入力欄へ実際にフォーカス');
  await guest.keyboard.press('F8');ok(await guest.evaluate(n=>window.__copied.length===n,before),'入力欄のF8はコピーしない');
 }finally{await h.close();}
},{page:false});
