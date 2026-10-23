// 画像の実ドロップ・選択・保存と復元・削除、透過・HUD・スコア・保存不可時を調べる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),dir=path.resolve(process.argv[2]||'dbg'),output=path.resolve(process.argv[3]||'media/custom-pilots');
(async()=>{fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});try{
 const context=await browser.newContext({offline:true}),page=await context.newPage({viewport:{width:1280,height:900}}),errors=[],external=[],checks=[];
 const yes=(ok,label)=>{assert(ok,label);checks.push(label);};
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!/^https:\/\/fonts\./.test(r.url()))external.push(r.url());});
 await page.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
 await page.addInitScript(()=>{
  requestAnimationFrame=()=>0;AudioContext=undefined;window.objectURLs={created:0,revoked:0};
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
  URL.createObjectURL=function(...a){objectURLs.created++;return create.apply(this,a);};URL.revokeObjectURL=function(...a){objectURLs.revoked++;return revoke.apply(this,a);};
 });
 await page.goto(pathToFileURL(path.join(dir,'dbg.html')).href);await page.waitForFunction(()=>window.__g);await page.locator('[data-page="pgPilot"]').click();
 yes(await page.locator('[data-pilot-choice]').count()===8,'既存の猫8匹と選択を維持');
 const fixtures=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=160;c.height=320;const x=c.getContext('2d');x.fillStyle='#3cd291';x.fillRect(20,20,120,280);
  const portrait=c.toDataURL('image/png');c.width=640;c.height=200;x.fillStyle='#be5041';x.fillRect(0,0,640,200);
  return {portrait,landscape:c.toDataURL('image/jpeg',.9)};
 });
 async function drop(files){await page.evaluate(rows=>{
  const dt=new DataTransfer();for(const r of rows){const a=Uint8Array.from(atob(r.data.split(',')[1]),c=>c.charCodeAt(0));dt.items.add(new File([a],r.name,{type:r.type}));}
  document.getElementById('pilotDrop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
 },files);await page.waitForFunction(()=>!document.getElementById('pilotDrop').hasAttribute('aria-busy'),null,{polling:50});}
 const portrait={name:'<img onerror=alert(1)>.png',type:'image/png',data:fixtures.portrait};
 await page.evaluate(()=>{window.gameRandomCalls=0;window.savedRandom=Math.random;Math.random=()=>{gameRandomCalls++;return savedRandom();};});
 await drop([portrait]);
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('coreBreakerPilotImages'))[0]);
 yes(await page.locator('#customPilotList [data-pilot-choice]').count()===1&&await page.locator(`#customPilotList [data-pilot-choice="${first.id}"]`).getAttribute('aria-pressed')==='true','実ドロップで追加・選択');
 yes(await page.locator('#customPilotList img').count()===0&&(await page.locator('#customPilotList b').textContent()).includes('<img'),'ファイル名はHTMLとして解釈しない');
 yes(await page.evaluate(()=>gameRandomCalls===0),'追加画像にゲーム用乱数を使わない');await page.evaluate(()=>{Math.random=savedRandom;});
 const pixels=await page.evaluate(async id=>{
  const face=document.querySelector(`[data-pilot-choice="${id}"] .catFace`),src=getComputedStyle(face).backgroundImage.slice(5,-2),img=new Image();img.src=src;await img.decode();
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;
  let minX=c.width,maxX=-1,minY=c.height,maxY=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(p[(y*c.width+x)*4+3]>240){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  return {width:img.width,height:img.height,ratio:(maxY-minY+1)/(maxX-minX+1),clearCorner:p[3]===0,size:src.length,fit:getComputedStyle(face).backgroundSize};
 },first.id);
 yes(pixels.width<=384&&pixels.height<=384&&pixels.clearCorner&&Math.abs(pixels.ratio-280/120)<.08&&pixels.fit==='contain'&&pixels.size<=180000,'縦横比と透過を維持し、容量を抑える');
 await page.reload();await page.locator('[data-page="pgPilot"]').click();yes(await page.locator(`[data-pilot-choice="${first.id}"]`).getAttribute('aria-pressed')==='true','画像と選択を再読み込み後に復元');
 await page.locator('#pilotFiles').setInputFiles({name:'横長.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixtures.landscape.split(',')[1],'base64')});
 await page.waitForFunction(()=>document.querySelectorAll('#customPilotList [data-pilot-choice]').length===2&&!document.getElementById('pilotDrop').hasAttribute('aria-busy'),null,{polling:50});
 const second=await page.evaluate(()=>JSON.parse(localStorage.getItem('coreBreakerPilotImages'))[1]);yes(await page.locator(`[data-pilot-choice="${second.id}"]`).getAttribute('aria-pressed')==='true','クリックのファイル選択でJPEGも追加');
 await page.locator(`[data-pilot-choice="${first.id}"]`).click();await page.locator(`[data-pilot-remove="${second.id}"]`).click();yes(await page.locator(`[data-pilot-choice="${first.id}"]`).getAttribute('aria-pressed')==='true','非選択画像の削除で現在の顔を維持');
 await page.screenshot({path:path.join(output,'selection.png')});
 await page.evaluate(()=>{const g=__g;g.renderer.render=()=>{};g.selectMap('wide');g.setup();g.running=false;for(const u of g.units)u.frozen=true;window.beforeGame=JSON.stringify({hp:g.player.hp,boost:g.player.boost,mech:g.mechCfg,loadout:g.loadout,units:g.units.length});});
 for(const mode of ['standard','arcade','flight','mechanical']){
  await page.evaluate(mode=>{document.querySelector(`[data-console-choice="${mode}"]`).click();__g.hud(240,.016);},mode);
  yes(await page.locator('#pilotMark .customPilotFace').getAttribute('data-pilot')===first.id,mode+'のHUDへ反映');
 }
 const board=await page.evaluate(()=>{const g=__g;g.keys.Tab=true;g.running=true;g.hud(240,.016);g.running=false;g.keys.Tab=false;return {player:document.querySelector('#boardBody .me .catFace').dataset.pilot,bots:[...document.querySelectorAll('#boardBody tr:not(.me) .catFace')].map(e=>e.dataset.pilot)};});
 yes(board.player===first.id&&board.bots.length===19&&board.bots.every(id=>!id.startsWith('custom-')),'スコア表は自分だけ追加画像、Botは猫のまま');
 await page.evaluate(()=>{__g.spawn(__g.player);__g.hud(240,.016);});yes(await page.locator('#pilotMark .customPilotFace').getAttribute('data-pilot')===first.id,'再出撃後も追加画像を維持');
 yes(await page.evaluate(()=>beforeGame===JSON.stringify({hp:__g.player.hp,boost:__g.player.boost,mech:__g.mechCfg,loadout:__g.loadout,units:__g.units.length})),'装備・性能・人数を変えない');
 await page.evaluate(()=>{__g.running=false;document.querySelector('[data-page="pgPilot"]').click();});
 await page.locator(`[data-pilot-remove="${first.id}"]`).click();yes(await page.locator('[data-pilot-choice="tabby"]').getAttribute('aria-pressed')==='true'&&await page.locator('#customPilotList [data-pilot-choice]').count()===0,'選択画像の削除で猫へ戻る');
 await drop([{name:'bad.svg',type:'image/svg+xml',data:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/no.png"/></svg>').toString('base64')}]);
 yes(await page.locator('#customPilotList [data-pilot-choice]').count()===0&&(await page.locator('#pilotImportStatus').textContent()).includes('PNG'),'SVGやURLを取り込まず、理由を表示');
 await drop([{name:'broken.png',type:'image/png',data:'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}]);
 yes(await page.locator('#customPilotList [data-pilot-choice]').count()===0&&(await page.locator('#pilotImportStatus').textContent()).includes('読み込めません'),'壊れた画像を拒否し、操作を再開できる');
 yes(await page.evaluate(()=>objectURLs.created===objectURLs.revoked),'デコード失敗時も一時画像URLを解放');
 await page.locator('#pilotFiles').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(16*1024*1024+1)});
 await page.waitForFunction(()=>!document.getElementById('pilotDrop').hasAttribute('aria-busy'),null,{polling:50});
 yes((await page.locator('#pilotImportStatus').textContent()).includes('16MB'),'大きすぎるファイルをデコード前に拒否');
 await drop([{name:'small.gif',type:'image/gif',data:'data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='}]);
 const gif=await page.evaluate(async()=>{const c=JSON.parse(localStorage.getItem('coreBreakerPilotImages'))[0],i=new Image();i.src=c.src;await i.decode();return {id:c.id,width:i.width,height:i.height};});
 yes(gif.width===1&&gif.height===1,'小さいGIFも静止画として無駄な余白なく取り込む');
 await page.locator(`[data-pilot-remove="${gif.id}"]`).click();
 await drop(Array.from({length:9},(_,i)=>({name:`画像${i}.png`,type:'image/png',data:fixtures.portrait})));
 yes(await page.locator('#customPilotList [data-pilot-choice]').count()===8&&(await page.locator('#pilotImportStatus').textContent()).includes('8枚まで'),'複数ドロップを8枚で制限');
 await page.evaluate(()=>{localStorage.setItem('coreBreakerPilotImages','[{"id":"bad","src":"javascript:alert(1)"}]');localStorage.setItem('coreBreakerPilot','custom-invalid');});await page.reload();
 yes(await page.locator('#customPilotList [data-pilot-choice]').count()===0&&await page.locator('[data-pilot-choice="tabby"]').getAttribute('aria-pressed')==='true','壊れた保存内容から猫へ復帰');
 await page.locator('[data-page="pgPilot"]').click();await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('保存不可');};});await drop([portrait]);
 yes(await page.locator('#customPilotList [data-pilot-choice]').count()===1&&(await page.locator('#pilotImportStatus').textContent()).includes('この起動中だけ'),'保存不可でも使え、その場限りと表示');
 const urls=await page.evaluate(()=>objectURLs);yes(urls.created===urls.revoked,'一時画像URLを成功・失敗とも解放');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);fs.writeFileSync(path.join(output,'custom-validation.json'),JSON.stringify({passed:checks.length,checks,pixels,urls,errors,externalRequests:external},null,2)+'\n');
 console.log('追加パイロット画像：'+checks.length+'項目成功。ブラウザエラー・画像の外部送信なし。');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
