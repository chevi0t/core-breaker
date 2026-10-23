// 単体HTMLの出撃・実キー移動・地図・中断/再開・陣営切替を確かめ、見た目を保存する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const folder=path.resolve(process.argv[2]||'mapdesign/akihabara_city/battle');
 const b=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const page=await b.newPage({offline:true,viewport:{width:1440,height:1000}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await page.addInitScript(()=>{AudioContext=undefined;});
  await page.goto(pathToFileURL(path.join(folder,'index.html')).href);
  await page.waitForFunction(()=>window.__cityBattle);
  // 実キーの試験中はGPU描画だけを省き、入力・対戦・物理・行列更新を通常のループで進める。
  await page.evaluate(()=>{const g=__cityBattle;window.realCityRender=g.renderer.render.bind(g.renderer);g.renderer.render=()=>g.scene.updateMatrixWorld(true);});
  const checks=[];
  for(const team of ['B','R']){
   if(team==='R'){
    await page.reload();await page.waitForFunction(()=>window.__cityBattle);
    await page.evaluate(()=>{const g=__cityBattle;window.realCityRender=g.renderer.render.bind(g.renderer);g.renderer.render=()=>g.scene.updateMatrixWorld(true);});
   }
   await page.locator(`input[name="team"][value="${team}"]`).check();
   await page.locator('#start').click();
   await page.waitForFunction(team=>__cityBattle.running&&__cityBattle.player?.team===team,team);
   const before=await page.evaluate(()=>__cityBattle.player.pos.toArray());
   await page.keyboard.down('KeyW');
   await page.waitForFunction(([x,,z])=>Math.hypot(__cityBattle.player.pos.x-x,__cityBattle.player.pos.z-z)>2,before,{timeout:30000});
   await page.keyboard.up('KeyW');await page.keyboard.press('KeyM');
   await page.waitForFunction(()=>!document.getElementById('bigMap').hidden);
   await page.keyboard.press('KeyM');await page.keyboard.press('Escape');
   await page.waitForFunction(()=>!__cityBattle.running&&!document.pointerLockElement&&!document.getElementById('overlay').hidden);
   const end=await page.evaluate(()=>__cityBattle.player.pos.toArray());
   assert(Math.hypot(before[0]-end[0],before[2]-end[2])>2);
   await page.locator('#start').click();await page.waitForFunction(()=>__cityBattle.running);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!__cityBattle.running);
   checks.push({team,start:before,end,map:true,pause:true,resume:true});
  }
  // 施設と地形が一緒に見えるゲーム画面。対戦を止めた状態で実際に一度描画する。
  await page.evaluate(()=>{
   const g=__cityBattle;g.player.pos.set(45,-2,1);g.player.yaw=0;g.player.invulT=0;
   g.player.group.position.copy(g.player.pos);g.player.group.visible=true;g.updateCamera(g.player,1);
   g.scene.updateMatrixWorld(true);realCityRender(g.scene,g.camera);document.getElementById('overlay').hidden=true;
   document.getElementById('trialPanel').hidden=true;
  });
  await page.screenshot({path:path.join(folder,'battle.png')});
  await page.evaluate(()=>{
   const g=__cityBattle;g.chosenTeam='B';g.setup();
   const c=document.createElement('canvas');c.id='battleOverview';c.width=c.height=1100;
   Object.assign(c.style,{position:'fixed',left:'0',top:'0',zIndex:99999});document.body.append(c);
   g.drawMapOn(c.getContext('2d'),1100,1100,null,1.6,true);
  });
  await page.setViewportSize({width:1100,height:1100});
  await page.locator('#battleOverview').screenshot({path:path.join(folder,'overview.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(folder,'input-check.json'),JSON.stringify({checks,errors,externalRequests:external},null,2)+'\n');
  console.log('両陣営の実キー移動・出撃・地図・中断/再開、画像2点、エラーなし・外部通信なし');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
