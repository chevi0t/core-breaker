// 保存失敗・複数タブ・旧形式・破損復元・設定ファイルを実際の保存先とUIで確かめる。
// make_dbg.pyでdbgを作り、node tools/test/build_save_check.js <dbg> [結果dir]
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const dir=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]||'/tmp/build-save-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(dir,'.'+name);if(!file.startsWith(dir+'/'))return res.writeHead(403).end();try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/javascript');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/dbg.html';
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']}),errors=[],checks=[];
 const yes=(v,name)=>{assert(v,name);checks.push(name);};
 const snapshot=p=>p.evaluate(()=>JSON.parse(JSON.stringify({mech:__g.mechCfg,loadout:__g.loadout,cur:__g.builds.cur,list:__g.builds.list,failed:__g.buildSaveState.failed})));
 const record=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('coreBreakerBuilds')));
 async function context(block=false){
  const c=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});await c.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await c.addInitScript(block=>{
   requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;
   if(!localStorage.getItem('__saveFixture')){
    const mech={head:'light3',body:'standard',arms:'standard',legs:'standard',color:'team'},loadout={heavy:{sub:'rocketH'},support:{main:'shotgunQ'}};
    localStorage.setItem('__saveFixture','1');localStorage.setItem('coreBreakerMap','dock');
    localStorage.setItem('coreBreakerMech',JSON.stringify(mech));localStorage.setItem('coreBreakerLoadout',JSON.stringify(loadout));
    localStorage.setItem('coreBreakerBuilds',JSON.stringify({cur:1,list:[{mech:{...mech,head:'heavy'},loadout},{mech,loadout},{mech:{...mech,head:'light2'},loadout}]}));
   }
   window.storageFail=block?'all':'none';const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
   Storage.prototype.getItem=function(k){if(window.storageFail==='all')throw new DOMException('blocked','SecurityError');return get.call(this,k);};
   Storage.prototype.setItem=function(k,v){if(window.storageFail==='all'||window.storageFail==='primary'&&k==='coreBreakerBuilds'||window.storageFail==='mirrors'&&['coreBreakerMech','coreBreakerLoadout'].includes(k))throw new DOMException('full','QuotaExceededError');return set.call(this,k,v);};
  },block);return c;
 }
 async function open(c,deferred=false){const p=await c.newPage();p.on('pageerror',e=>{errors.push(e.stack);console.error('PAGE',e.message);});if(deferred)await p.addInitScript(()=>{window.deferStorage=false;window.storageQueue=[];const add=window.addEventListener;window.addEventListener=function(t,fn,o){return add.call(this,t,t==='storage'?e=>{if(window.deferStorage)window.storageQueue.push(()=>fn(e));else fn(e);}:fn,o);};});await p.goto(url);await p.locator('[data-page="pgCustom"]').click();return p;}
 async function part(p,slot,key){await p.locator('[data-cslot="'+slot+'"]').click();if(!await p.locator('[data-pick="'+key+'"]').count()){const series=await p.evaluate(([slot,key])=>__g.PARTS[slot][key].series,[slot,key]);await p.locator('#cuSeries [data-series="'+series+'"]').click();}await p.locator('[data-pick="'+key+'"]').click();}
 async function reload(p){await p.reload();await p.locator('[data-page="pgCustom"]').click();}
 async function download(p,name){const promise=p.waitForEvent('download');await p.locator('#buildExport').click();const d=await promise;await d.saveAs(path.join(out,name));return JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));}
 try{
  const c=await context(),p=await open(c);const initial=await snapshot(p);
  yes(initial.cur===1&&initial.mech.head==='light3'&&initial.loadout.heavy.sub==='rocketH','旧形式の現在構成・機体・武器を保持して開始');
  await part(p,'head','heavy3');let r=await record(p);
  yes(r.version===2&&r.cur===1&&r.list[1].mech.head==='heavy3','機体と4兵装を1つの正本へ保存');
  yes((await p.locator('#buildSaveStatus').innerText()).includes('保存済み'),'保存成功を画面に表示');
  yes(await p.evaluate(()=>JSON.parse(localStorage.getItem('coreBreakerBuildsBackup')).list[1].mech.head==='light3'),'初回の変更前もバックアップする');
  await reload(p);yes((await snapshot(p)).mech.head==='heavy3','再読み込み後も現在の機体を保持');
  await p.locator('#cuBuilds [data-build="0"]').click();yes((await snapshot(p)).mech.head==='heavy','旧形式の別構成も保持');
  await p.locator('#cuBuilds [data-build="2"]').click();await p.locator('[data-paint="sand"]').click();const exported=await download(p,'settings.json');
  yes(exported.format==='core-breaker-settings'&&exported.cur===2&&exported.list.length===3,'現在構成と3構成をファイルへ書き出す');
  await part(p,'head','heavy2');await p.locator('#buildRestore').click();yes((await snapshot(p)).mech.head==='light2','前の保存へ戻せる');
  await p.locator('#buildRestore').click();yes((await snapshot(p)).mech.head==='heavy2','復元を取り消して戻せる');
  const beforeBad=await snapshot(p);await p.locator('#buildImportFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"bad":true}')});
  await p.waitForFunction(()=>document.getElementById('buildSaveStatus').textContent.includes('読み込めません'));
  assert.deepEqual(await snapshot(p),beforeBad);yes(true,'不正な設定ファイルで現在構成を消さない');
  const unknown=JSON.parse(JSON.stringify(exported));unknown.list[0].mech.head='__proto__';
  await p.locator('#buildImportFile').setInputFiles({name:'unknown.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(unknown))});
  await p.waitForFunction(()=>document.getElementById('buildSaveStatus').textContent.includes('読み込めません'));assert.deepEqual(await snapshot(p),beforeBad);yes(true,'未知のパーツを含む設定は適用しない');
  await p.locator('#buildImportFile').setInputFiles(path.join(out,'settings.json'));await p.waitForFunction(()=>__g.mechCfg.head==='light2');
  yes((await snapshot(p)).cur===2,'有効な設定ファイルから現在構成と全3構成を読み込む');
  await p.evaluate(()=>{const text=File.prototype.text;File.prototype.text=function(){return this.name==='slow-settings.json'?new Promise(resolve=>{window.releaseSlowImport=async()=>resolve(await text.call(this));}):text.call(this);};});
  const slow=JSON.parse(JSON.stringify(exported));slow.list[slow.cur].mech.head='heavy2';await p.locator('#buildImportFile').setInputFiles({name:'slow-settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(slow))});
  await p.waitForFunction(()=>!!window.releaseSlowImport);await p.locator('#buildImportFile').setInputFiles(path.join(out,'settings.json'));await p.waitForFunction(()=>document.getElementById('buildSaveStatus').textContent.includes('保存済み'));
  await p.evaluate(()=>window.releaseSlowImport());yes((await snapshot(p)).mech.head==='light2','連続して選んだ設定ファイルは最後に選んだものを優先');
  const peer=await open(c,true);await part(p,'head','heavy2');await peer.waitForFunction(()=>__g.mechCfg.head==='heavy2');yes(true,'別タブの変更を反映');
  await part(peer,'body','light3');await p.waitForFunction(()=>__g.mechCfg.body==='light3');yes((await snapshot(p)).mech.head==='heavy2','別タブで違う部位を変えても既存部位を保持');
  await peer.evaluate(()=>window.deferStorage=true);await part(p,'head','prism2');
  await part(peer,'legs','light3');const merged=await snapshot(peer);
  yes(merged.mech.head==='prism2'&&merged.mech.body==='light3'&&merged.mech.legs==='light3','同期前の古いタブからの保存も変更した項目だけ統合');
  await peer.evaluate(()=>{window.deferStorage=false;for(const f of window.storageQueue.splice(0))f();});
  yes((await snapshot(peer)).mech.legs==='light3','遅れた通知で新しい保存を巻き戻さない');
  const oldWriter=await record(p);oldWriter.list[oldWriter.cur].mech.arms='heavy2';await peer.evaluate(r=>localStorage.setItem('coreBreakerBuilds',JSON.stringify(r)),oldWriter);
  await p.waitForFunction(()=>__g.mechCfg.arms==='heavy2');yes(true,'旧版がrevisionを変えずに保存しても同期');
  await peer.locator('[data-paint="ash"]').click();yes((await snapshot(peer)).mech.arms==='heavy2','旧版からの同じrevisionの変更も古いタブで上書きしない');
  await p.waitForFunction(()=>__g.mechCfg.legs==='light3');await p.evaluate(()=>window.storageFail='mirrors');await part(p,'head','prism3');
  yes(!(await snapshot(p)).failed,'互換キーの書き込み失敗でも正本の成功を確認');
  await reload(p);yes((await snapshot(p)).mech.head==='prism3','古い互換キーより新しい正本を優先して読み込む');
  await p.evaluate(()=>window.storageFail='primary');await part(p,'head','bastion3');
  yes((await snapshot(p)).failed&&(await snapshot(p)).mech.head==='bastion3','容量不足時に未保存と表示し、画面の設定を保持');
  yes((await record(p)).list[2].mech.head==='prism3','失敗しても最後の正常な保存を壊さない');
  const unsaved=await download(p,'unsaved-settings.json');yes(unsaved.list[2].mech.head==='bastion3','保存できない設定もファイルに保管できる');
  await part(peer,'body','heavy3');await p.waitForFunction(()=>document.getElementById('buildSaveStatus').textContent.includes('別のタブでも'));
  yes((await snapshot(p)).mech.head==='bastion3','保存失敗中の設定を別タブ更新で消さない');
  await p.evaluate(()=>window.storageFail='none');await p.locator('#buildSaveRetry').click();
  const retried=await snapshot(p);yes(!retried.failed&&retried.mech.head==='bastion3'&&retried.mech.body==='heavy3','再試行で未保存の変更と別タブの更新を統合');
  const fresh=await browser.newContext({storageState:await c.storageState()});await fresh.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await fresh.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;});
  const newSession=await open(fresh);assert.deepEqual(await snapshot(newSession),retried);yes(true,'保存した状態を別セッションで読み直しても3構成と現在構成を保持');await fresh.close();
  const backup=await p.evaluate(()=>JSON.parse(localStorage.getItem('coreBreakerBuildsBackup')));
  await p.evaluate(()=>localStorage.setItem('coreBreakerBuilds','broken json'));await reload(p);
  yes((await snapshot(p)).mech.head===backup.list[backup.cur].mech.head&&(await p.locator('#buildSaveStatus').innerText()).includes('バックアップ'),'正本の破損時に前回の保存から復元');
  yes(await p.evaluate(()=>localStorage.getItem('coreBreakerBuilds')==='broken json'),'起動だけで破損した正本や既存設定を上書きしない');
  yes(await p.locator('#buildSaveRetry').isVisible(),'復元した設定を保存し直す操作を表示');await p.locator('#buildSaveRetry').click();
  yes(!(await snapshot(p)).failed&&(await record(p)).version===2,'バックアップから復元後に保存記録を修復できる');
  const beforeClear=await snapshot(p);await peer.evaluate(()=>localStorage.clear());await p.waitForFunction(()=>document.getElementById('buildSaveStatus').textContent.includes('削除'));
  yes((await snapshot(p)).mech.head===beforeClear.mech.head,'別タブで保存先を消去されても画面の設定は保持');
  await p.locator('#buildSaveRetry').click();yes(!(await snapshot(p)).failed&&(await record(p)).list[beforeClear.cur].mech.head===beforeClear.mech.head,'保存先消去後も画面に残る設定を再保存できる');
  await c.close();
  const blocked=await context(true),q=await open(blocked);
  yes((await q.locator('#buildSaveStatus').innerText()).includes('利用できません'),'ブラウザ保存禁止時にも起動し理由を表示');
  await part(q,'head','heavy2');yes((await snapshot(q)).failed,'保存禁止時の変更を保存済みと偽らない');
  const portable=await download(q,'blocked-settings.json');yes(portable.list[portable.cur].mech.head==='heavy2','保存禁止時にも書き出しできる');
  await blocked.close();assert.deepEqual(errors,[]);
  const legacyContext=await browser.newContext({acceptDownloads:true});await legacyContext.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await legacyContext.addInitScript(data=>{requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;if(!localStorage.getItem('__divergentFixture')){localStorage.setItem('__divergentFixture','1');const list=data.list;list[0].mech.head='heavy3';localStorage.setItem('coreBreakerMech',JSON.stringify({...list[0].mech,head:'standard'}));localStorage.setItem('coreBreakerLoadout',JSON.stringify(list[0].loadout));localStorage.setItem('coreBreakerBuilds',JSON.stringify({cur:0,list}));}},exported);
  const legacyPage=await open(legacyContext);yes((await snapshot(legacyPage)).mech.head==='standard'&&(await legacyPage.locator('#buildSaveStatus').innerText()).includes('差があります'),'旧形式の食い違いを無断で上書きせず知らせる');
  await legacyPage.locator('#buildRestore').click();yes((await snapshot(legacyPage)).mech.head==='heavy3','旧形式の構成側に残った機体を復元できる');
  await legacyPage.locator('#buildRestore').click();yes((await snapshot(legacyPage)).mech.head==='standard','旧形式の復元も取り消せる');await legacyContext.close();assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({checks,errors},null,2)+'\n');console.log(JSON.stringify({checks:checks.length,errors}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exit(1)});
