// 実ブラウザでのログ確認・任意コピー/保存。--mock-transport 時は実WebRTC未検証。
const path=require('node:path'),{check}=require('./lib'),{harness,pageFor}=require('./online_test_helpers');
check('オンライン試験ログ',async({browser,dir,out,ok,errors})=>{
 const h=await harness(dir);let host,guest;
 try{
  host=await pageFor(browser,h,errors);guest=await pageFor(browser,h,errors);
  const id=await host.evaluate(o=>CBOnlineGame.create({...o,displayName:'秘密のホスト名'}),{peerOptions:h.peerOptions});
  await guest.evaluate(([id,o])=>CBOnlineGame.join(id,{...o,displayName:'秘密のゲスト名'}),[id,{peerOptions:h.peerOptions}]);
  await guest.evaluate(()=>CBOnlineGame.leave('生エラー_192.0.2.1_SDP_PRIVATE'));
  await host.evaluate(()=>CBOnlineGame.leave());
  for(const p of [host,guest]){
   const text=await p.evaluate(()=>CBOnlineGame.logs.preview());ok(!text.includes(id)&&!/秘密の|生エラー_192|SDP_PRIVATE/.test(text),'個人情報と未知の生エラーを出力しない');
   ok(text.includes('session_ended')&&text.includes('sentBytes'),'退出後も接続と送信量を確認できる');
  }
  await host.waitForFunction(()=>!document.getElementById('menuOnlineLog').hidden,{},{polling:20});await host.locator('#menuOnlineLog').click();
  for(const [width,height]of [[1440,900],[390,844],[320,568]]){
   await host.setViewportSize({width,height});ok(await host.locator('#onlineLogDialog').evaluate(e=>{const r=e.getBoundingClientRect();return e.open&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth;}),'プレビューが画面内 '+width);
  }
  await host.screenshot({path:path.join(out,'diagnostic-preview.png')});
  const preview=await host.locator('#onlineLogText').inputValue();
  await host.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__logCopied=text;}}}));
  await host.locator('#onlineLogCopy').click();ok(await host.evaluate(text=>window.__logCopied===text,preview),'プレビューの固定内容だけコピー');
  await host.locator('#onlineLogToggle').click();const detail=await host.locator('#onlineLogText').inputValue();ok(detail.includes('session_ended')&&detail.includes('sentBytes'),'従来の詳細JSONを表示');await host.locator('#onlineLogToggle').click();ok(await host.locator('#onlineLogText').inputValue()===preview,'固定要約へ戻る');
  const downloading=host.waitForEvent('download');await host.locator('#onlineLogSave').click();const download=await downloading;ok(download.suggestedFilename()==='core-breaker-diagnostic.txt','テキスト保存は明示クリック後だけ');
  await host.keyboard.press('Escape');ok(await host.locator('#onlineLogDialog').evaluate(e=>!e.open),'Escapeで閉じられる');
  await host.reload();await host.waitForFunction(()=>window.CBOnlineGame?.logs?.status().available,{},{polling:20});ok(await host.evaluate(()=>CBOnlineGame.logs.preview().includes('session_ended')),'再読み込み後も安全な記録を復元');
  await host.locator('#menuOnlineLog').click();await host.locator('#onlineLogClear').click();ok(await host.evaluate(()=>!CBOnlineGame.logs.status().available),'明示消去で保存済みログを除去');await host.locator('#onlineLogClose').click();
 }finally{await h.close();}
},{page:false});
