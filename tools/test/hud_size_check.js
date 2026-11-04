// 実画面でのHUD個別拡大、保存互換、停止と復帰、PC/タッチの調整操作を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const dir=path.resolve(process.argv[2]||'dbg/hud-size'),out=path.resolve(process.argv[3]||'dbg/hud-size-results');fs.mkdirSync(out,{recursive:true});
 const fixture=path.join(dir,'hud-size-standards.html');fs.writeFileSync(fixture,'<!DOCTYPE html>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'+fs.readFileSync(path.join(dir,'dbg.html'),'utf8'));
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),checks=[],errors=[];
 const yes=(v,s)=>{assert(v,s);checks.push(s);},near=(a,b)=>Math.abs(a-b)<.3;
 async function open(touch,saved){
  const c=await browser.newContext({viewport:touch?{width:844,height:390}:{width:1280,height:720},hasTouch:touch,isMobile:touch});const p=await c.newPage();
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(saved=>{
   requestAnimationFrame=()=>0;AudioContext=undefined;
   if(saved&&!sessionStorage.getItem('hudSizeFixture')){sessionStorage.setItem('hudSizeFixture','1');localStorage.setItem('coreBreakerOptions',JSON.stringify(saved));}
   const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,a){return get.call(this,k,k.includes('webgl')?{...a,preserveDrawingBuffer:true}:a);};
  },saved);
  await p.goto(pathToFileURL(fixture).href);return{c,p};
 }
 const step=(p,n=1)=>p.evaluate(n=>{for(let i=0;i<n;i++)__g.loop(performance.now());},n);
 const set=(p,key,value)=>p.evaluate(([key,value])=>{const el=document.getElementById(key);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},[key,value]);
 const metrics=p=>p.evaluate(()=>{
  const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
  return{tri:rect('triangleAim'),pilot:rect('pilotMark'),allPilot:rect('pilot'),status:rect('status'),fov:__g.camera.fov,range:__g.player.lockRange};
 });
 const snapshot=p=>p.evaluate(()=>({time:__g.timeLeft,cores:[__g.cores.B.hp,__g.cores.R.hp],units:__g.units.map(u=>({pos:u.pos.toArray(),hp:u.hp,boost:u.boost,ammo:u.slots.main.ammo,weapon:u.weapon,alive:u.alive}))}));
 try{
  for(const touch of [false,true]){
   const{c,p}=await open(touch,{master:65,swayHair:150,swayChest:80});
   await p.locator('[data-page="pgOptions"]').click();
   yes(await p.locator('#optHudTriangle').inputValue()==='100'&&await p.locator('#optHudPilot').inputValue()==='100','旧設定は両方100%から開始');
   for(const id of ['optHudTriangle','optHudPilot'])yes(await p.locator('#'+id).getAttribute('min')==='100'&&await p.locator('#'+id).getAttribute('max')==='200',id+'は100〜200%');
   await p.locator('#hudPreviewOpen').click();await step(p);
   yes(await p.locator('#hudPreviewPanel').isVisible()&&await p.locator('#overlay').isHidden()&&await p.locator('#triangleAim').isVisible(),'メニューから実際の戦場と三角HUDを表示');
   yes(await p.evaluate(()=>!__g.running&&!!__g.player),'調整画面を開いても戦闘は開始しない');
   const still=await snapshot(p);await step(p,20);assert.deepEqual(await snapshot(p),still);checks.push('調整中は時間・機体・耐久・弾数・ブーストが進まない');
   const base=await metrics(p);await set(p,'optHudTriangle',150);await step(p);let now=await metrics(p);
   yes(near(now.tri.w,base.tri.w*1.5)&&near(now.tri.h,base.tri.h*1.5)&&near(now.pilot.w,base.pilot.w),'三角150%は縦横1.5倍で肖像は変わらない');
   await p.locator('#optHudTriangle').focus();await p.keyboard.press('End');await step(p);
   await set(p,'optHudPilot',200);await step(p);now=await metrics(p);
   yes(near(now.tri.w,base.tri.w*2)&&near(now.tri.h,base.tri.h*2)&&near(now.pilot.w,base.pilot.w*2)&&near(now.pilot.h,base.pilot.h*2),'両方200%で画像とゲージを縦横2倍');
   yes(near(now.tri.x+now.tri.w/2,base.tri.x+base.tri.w/2)&&near(now.tri.y+now.tri.h/2,base.tri.y+base.tri.h/2),'照準の中心は移動しない');
   yes(now.fov===base.fov&&now.range===base.range,'倍率を変えても視野角とロック範囲は変わらない');
   const persisted=await p.evaluate(()=>JSON.parse(localStorage.getItem('coreBreakerOptions')));
   yes(persisted.hudTriangle===200&&persisted.hudPilot===200&&persisted.master===65&&persisted.swayHair===150&&persisted.swayChest===80,'独立倍率を自動保存し既存設定を維持');
   await p.screenshot({path:path.join(out,(touch?'touch':'pc')+'-200.png')});
   const panel=await p.locator('#hudPreviewPanel').boundingBox(),handle=await p.locator('#hudPreviewHandle').boundingBox();
   await p.mouse.move(handle.x+40,handle.y+10);await p.mouse.down();await p.mouse.move(handle.x-120,handle.y+60);await p.mouse.up();
   const moved=await p.locator('#hudPreviewPanel').boundingBox();yes(moved.x<panel.x-100&&moved.x>=8&&moved.y>=8,'見出しのドラッグでパネルを画面内に移動');
   await p.locator('#hudPreviewClose').click();
   yes(await p.locator('#pgOptions').isVisible()&&await p.evaluate(()=>!__g.running)&&await p.locator('#hudSizeOptions #optHudTriangle').count()===1,'終了はオプションへ戻り再開しない・同じ操作部品を戻す');
   await p.reload();await p.locator('[data-page="pgOptions"]').click();
   yes(await p.locator('#optHudTriangle').inputValue()==='200'&&await p.locator('#optHudPilot').inputValue()==='200','再読み込みで両方の倍率を復元');
   await p.locator('#hudPreviewOpen').click();await p.locator('#hudSizeReset').click();
   yes(await p.locator('#optHudTriangleValue').innerText()==='100%'&&await p.locator('#optHudPilotValue').innerText()==='100%'&&await p.evaluate(()=>__g.gameOptions.master===65),'両方100%へのリセットは他の設定を保つ');
   await p.keyboard.press('Escape');yes(await p.locator('#pgOptions').isVisible()&&await p.evaluate(()=>!__g.running),'Escでもオプションへ戻り一時停止を維持');
   await p.locator('#pgOptions .pgh .back').click();await p.evaluate(()=>window.previewUnit=__g.player);
   if(touch)await p.locator('#start').tap();else await p.locator('#start').click();await step(p,2);
   yes(await p.evaluate(()=>__g.running&&__g.player!==previewUnit),'プレビュー後の出撃は新しい試合を準備');
   await p.keyboard.press('F3');await p.locator('#hudPreviewOpen').click();await step(p);
   const paused=await snapshot(p);await step(p,20);assert.deepEqual(await snapshot(p),paused);checks.push('戦闘からの調整でも戦況は進まない');
   if(!touch)for(const mode of ['standard','arcade','flight','mechanical','retro']){
    await p.locator('#hudPreviewClose').click();await p.locator('[data-console-choice="'+mode+'"]').click();await p.locator('#hudPreviewOpen').click();
    await p.locator('#hudSizeReset').click();await step(p);const one=await metrics(p);
    await set(p,'optHudTriangle',200);await set(p,'optHudPilot',200);await step(p);const two=await metrics(p);
    yes(near(two.tri.w,one.tri.w*2)&&near(two.pilot.w,one.pilot.w*2),mode+'で両方200%を適用');
    yes(near(two.allPilot.x,one.allPilot.x)&&near(two.allPilot.bottom,one.allPilot.bottom),mode+'の肖像は左下基準を維持');
    if(two.status.w>0)yes(two.status.x>=two.allPilot.right,mode+'の情報欄は拡大した肖像の右に追従');
    await p.screenshot({path:path.join(out,mode+'-200.png')});
   }
   if(!touch){
    await p.evaluate(()=>{window.hudPadButtons=Array(18).fill(0);Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{id:'HUD test',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:hudPadButtons.map(v=>({value:v,pressed:!!v}))}]});});
    await step(p);await p.locator('#optHudTriangle').focus();await p.evaluate(()=>hudPadButtons[14]=1);await step(p);await p.evaluate(()=>hudPadButtons[14]=0);await step(p);
    yes(await p.locator('#optHudTriangle').inputValue()==='195','パッドの左で調整パネルの値を5%下げられる');
    await p.evaluate(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));await step(p);
   }
   await p.locator('#optHudPilot').focus();await p.keyboard.press('F3');yes(await p.locator('#pgOptions').isVisible()&&await p.evaluate(()=>!__g.running),'入力欄のF3はオプションへ戻るだけ');
   await p.locator('#optionsResume').click();await step(p);yes(await p.evaluate(()=>__g.running)&&await p.locator('#triangleAim').isVisible(),'戦闘へ戻る操作で拡大HUDを維持して再開');
   await c.close();
  }
  for(const mode of ['range','tutorial']){
   const{c,p}=await open(false,{});
   if(mode==='range')await p.locator('#menuRange').click();
   else{await p.locator('[data-page="pgTutorialIntro"]').click();await p.locator('#tutorialStart').click();}
   await step(p);await p.evaluate(mode=>window.hudModeRef=__g[mode],mode);
   await p.keyboard.press('F3');await p.locator('#hudPreviewOpen').click();
   const before=await snapshot(p);await step(p,20);assert.deepEqual(await snapshot(p),before);checks.push(mode+'でも実画面調整中は停止');
   await p.locator('#hudPreviewClose').click();await p.locator('#optionsResume').click();
   yes(await p.evaluate(mode=>__g.running&&__g[mode]===hudModeRef,mode),mode+'の同じ進行へ復帰');await c.close();
  }
  for(const [saved,expected] of [[{hudTriangle:-1,hudPilot:999},[100,200]],[{hudTriangle:'150',hudPilot:null},[100,100]]]){
   const{c,p}=await open(false,saved);yes(await p.evaluate(expected=>__g.gameOptions.hudTriangle===expected[0]&&__g.gameOptions.hudPilot===expected[1],expected),'保存値の範囲外・無効値を補正');await c.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
