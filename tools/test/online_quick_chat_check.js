// V→カテゴリ→定型文とロビー/試合の実送信。既定はローカルPeerServerの実WebRTC。
const path=require('node:path');
const {check}=require('./lib');
const {harness,room,sleep,TRANSPORT_MODE}=require('./online_test_helpers');
check('オンライン定型通信',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let r;
  const keySequence=async(p,...keys)=>{for(const key of keys)await p.keyboard.press(key);};
  try {
    r=await room(browser,h,errors,{guests:2,teamSize:2,beforeStart:async(host,guests)=>{
      await host.evaluate(()=>{document.getElementById('onlinePanel').hidden=false;});
      await host.locator('#onlineRoom').focus();await host.keyboard.press('v');
      ok(await host.locator('#onlineQuickChat').isHidden(),'入力欄でVを打っても通信メニューを開かない');
      await host.evaluate(()=>document.activeElement.blur());await keySequence(host,'v','4','3');
      for(const p of [host,...guests])await p.waitForFunction(()=>CBOnlineGame.quickChat.lines().some(line=>line.id==='thanks'),{},{polling:20});
      ok(true,'ロビーのV→4→3は所属を問わず全員へ一度届く');
      for(const p of [host,...guests])ok(await p.evaluate(()=>CBOnlineGame.quickChat.lines().filter(line=>line.id==='thanks').length===1),'ロビーの重複表示なし');
      await host.evaluate(()=>{document.getElementById('onlinePanel').hidden=true;});
    }});
    const {host,guests:[red,blue]}=r;
    await host.evaluate(()=>{document.getElementById('onlinePanel').hidden=true;});
    await red.evaluate(()=>{document.getElementById('onlinePanel').hidden=true;});
    await blue.evaluate(()=>{document.getElementById('onlinePanel').hidden=true;});
    const before=await host.evaluate(()=>({weapon:__g.player.weapon,cls:__g.chosenCls}));
    await keySequence(host,'v','2','4');
    await blue.waitForFunction(()=>CBOnlineGame.quickChat.lines().some(line=>line.id==='cover'),{},{polling:20});await sleep(150);
    ok(await red.evaluate(()=>CBOnlineGame.quickChat.lines().length===0),'試合中のBホスト発言は敵Rゲストへ送らない');
    ok(await host.evaluate(()=>CBOnlineGame.quickChat.lines().filter(line=>line.id==='cover').length===1),'ホスト自身に一度だけ表示');
    ok(await host.evaluate(b=>__g.player.weapon===b.weapon&&__g.chosenCls===b.cls&&!__g.keys.Digit2&&!__g.pressed.Digit2&&!__g.keys.Digit4&&!__g.pressed.Digit4,before),'カテゴリ・文の数字を武器/兵装操作へ漏らさない');
    await host.keyboard.press('v');await host.keyboard.press('1');await host.keyboard.down('2');
    await host.evaluate(()=>dispatchEvent(new KeyboardEvent('keydown',{code:'Digit2',key:'2',repeat:true,bubbles:true,cancelable:true})));
    ok(await host.evaluate(()=>!__g.keys.Digit2&&!__g.pressed.Digit2),'送信直後も選択数字の長押しrepeatをkeyupまで遮断');
    await host.keyboard.up('2');await host.keyboard.press('2');
    ok(await host.evaluate(()=>!!__g.pressed.Digit2),'キーを離した後の通常数字操作は戻る');await host.evaluate(()=>{delete __g.pressed.Digit2;});
    await host.keyboard.press('v');await host.keyboard.press('Escape');
    ok(await host.locator('#onlineQuickChat').isHidden()&&await host.locator('#onlinePanel').isHidden(),'Escは通信だけ閉じロビーを開かない');
    await keySequence(host,'v','1','0');
    ok(await host.locator('#onlineQuickChatTitle').textContent()==='味方のみ / 定型通信','0でカテゴリへ戻れる');
    await host.keyboard.press('v');
    ok(await host.locator('#onlineQuickChat').isHidden(),'Vをもう一度押して取り消せる');
    await host.keyboard.press('v');await host.evaluate(()=>dispatchEvent(new Event('blur')));
    ok(await host.locator('#onlineQuickChat').isHidden(),'フォーカスを失ったら取り消す');
    await host.keyboard.press('v');await host.evaluate(()=>{__g.player.alive=false;__g.player.downT=5;});await host.keyboard.press('v');
    ok(await host.locator('#onlineQuickChat').isHidden()&&await host.evaluate(()=>!!__g.pressed.KeyV),'行動不能直後のVはチャットに取られず従来の兵装入力へ届く');
    ok(!(await host.evaluate(()=>CBOnlineGame.quickChat.send('yes'))).ok,'UIを迂回した死亡/行動不能送信も不可');
    await host.evaluate(()=>{__g.player.alive=true;__g.player.downT=0;delete __g.pressed.KeyV;});
    await keySequence(red,'v','3','1');await red.waitForFunction(()=>CBOnlineGame.quickChat.lines().some(line=>line.id==='enemy'),{},{polling:20});await sleep(150);
    ok(await host.evaluate(()=>!CBOnlineGame.quickChat.lines().some(line=>line.id==='enemy'))&&await blue.evaluate(()=>!CBOnlineGame.quickChat.lines().some(line=>line.id==='enemy')),'敵ゲスト発言をホスト・別陣営へ出さない');
    for(const [width,height,name] of [[1440,900,'desktop'],[390,844,'mobile']]){
      await host.setViewportSize({width,height});await host.keyboard.press('v');
      if(await host.locator('#onlineQuickChat').isHidden())await host.keyboard.press('v');
      const bounds=await host.locator('#onlineQuickChat').boundingBox();ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height,name+'の通信メニューが画面内');
      await host.screenshot({path:path.join(out,'quick-chat-'+name+'.png')});await host.keyboard.press('Escape');
    }
    // 受信内容はHTMLとして解釈しない。
    await host.evaluate(()=>{const t=CBOnlineGame.state.transport;CBOnlineGame.state.role='guest';t.options.onMessage('quickChat',{id:'yes',event:999,phase:'playing',matchId:CBOnlineGame.state.matchId,sender:'safe',name:'<img src=x onerror=1>',team:__g.player.team,scope:'team'},'host');CBOnlineGame.state.role='host';});
    ok(await host.locator('#onlineQuickChatLog img').count()===0&&/img src=x/.test(await host.locator('#onlineQuickChatLog').textContent()),'申告名をHTMLにせず文字で表示');
    await host.evaluate(()=>CBOnlineGame.leave());await sleep(120);
    ok(await host.locator('#onlineQuickChat').isHidden()&&await host.locator('#onlineQuickChatLog').isHidden()&&await host.locator('#onlineQuickChatOpen').isHidden(),'退出時に通信UIと履歴を消す');
    console.log(TRANSPORT_MODE);
  }finally{await r?.close();await h.close();}
},{page:false});
