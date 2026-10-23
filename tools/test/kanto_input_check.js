// デバッグ口を追加せず、確認用HTMLで両陣営の実キー入力・地図・再開と施設表示を確かめる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),output=path.join(ROOT,'mapdesign/kanto');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const page=await browser.newPage({offline:true,viewport:{width:1440,height:1000}}),errors=[],external=[],inputs=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!/^https:\/\/fonts\./.test(r.url()))external.push(r.url());});
  await page.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
  // 本体はそのまま。試験時だけ描画を間引き、実入力は本体のループを動かして調べる。
  const three=fs.readFileSync(path.join(ROOT,'vendor/three-r128/three.min.js'),'utf8');
  const observe=`\n(()=>{const Original=THREE.WebGLRenderer;THREE.WebGLRenderer=function(...args){const r=new Original(...args),render=r.render.bind(r);r.render=(s,c)=>{window.testScene=s;window.testCamera=c;s.updateMatrixWorld(true);};window.renderTestFrame=()=>render(window.testScene,window.testCamera);return r;};THREE.WebGLRenderer.prototype=Original.prototype;})();`;
  await page.route('**/three.min.js',r=>r.fulfill({contentType:'application/javascript',body:three+observe}));
  await page.addInitScript(()=>{AudioContext=undefined;});
  for(const team of ['B','R']){
   await page.goto(pathToFileURL(path.join(output,'play.html')).href);
   await page.waitForFunction(()=>document.querySelector('#mapList button[data-map="kanto"]'));
   await page.locator(`input[name="team"][value="${team}"]`).check();
   await page.locator('#start').click();
   await page.waitForFunction(()=>{
    if(!window.testScene)return false;let u=null;
    testScene.traverse(m=>{if(m.userData.ref?.kind==='unit'&&m.userData.ref.isPlayer)u=m.userData.ref;});
    window.testPlayer=u;return !!u;
   });
   const start=await page.evaluate(()=>testPlayer.pos.toArray());
   assert(team==='B'?start[0]<0&&start[2]>0:start[0]>0&&start[2]<0,'指定した基地から出撃');
   await page.keyboard.down('KeyW');
   await page.waitForFunction(([x,,z])=>Math.hypot(testPlayer.pos.x-x,testPlayer.pos.z-z)>2,start,{timeout:30000});
   await page.keyboard.up('KeyW');const end=await page.evaluate(()=>testPlayer.pos.toArray());
   await page.waitForFunction(()=>testPlayer.invulT<=0&&!document.getElementById('announce').textContent.trim());
   await page.keyboard.press('KeyM');await page.waitForFunction(()=>!document.getElementById('bigMap').hidden);
   if(team==='B')await page.locator('#bigMapC').screenshot({path:path.join(output,'overview.png')});
   await page.keyboard.press('KeyM');await page.keyboard.press('F3');
   await page.waitForFunction(()=>!document.getElementById('pgOptions').hidden);
   await page.locator('#optionsResume').click();
   assert(await page.evaluate(()=>window.__g===undefined&&window.__cityBattle===undefined));
   assert(await page.evaluate(()=>typeof MAP_DATA.kanto.nav.nodes==='string'&&Array.isArray(MAP_DATA.kanto.cityTerrain.volumes[0])),'共有の入力データを変えない');
   await page.evaluate(()=>renderTestFrame());
   await page.screenshot({path:path.join(output,`battle-${team}.png`)});
   inputs.push({team,start,end,map:true,optionsResume:true,debugHooks:false});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(output,'input-check.json'),JSON.stringify({inputs,errors,externalRequests:external},null,2)+'\n');
  console.log('通常の本体と同じ確認用HTMLで、両基地からの出撃・実キー移動・地図・設定からの再開を確認。外部通信・ブラウザエラーなし。');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
