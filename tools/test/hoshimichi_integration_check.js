// 都市を通常メニューから選び、本体の切替・再読み込み・入力・画像と資源破棄を調べる。
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),dbg=path.resolve(process.argv[2]||'dbg');
const output=path.resolve(process.env.CITY_INTEGRATION_OUTPUT||path.join(ROOT,'mapdesign/hoshimichi'));
function maps(source){const context={window:{}};vm.runInNewContext(source,context);return JSON.parse(JSON.stringify(context.window.MAP_DATA));}
(async()=>{
 const current=maps(fs.readFileSync(path.join(ROOT,'prototype/maps.js'),'utf8'));
 const previous=maps(execFileSync('git',['show','origin/main:prototype/maps.js'],{cwd:ROOT,encoding:'utf8'}));
 for(const id of Object.keys(previous))assert.deepEqual(current[id],previous[id],id+' の既存配置は同じ');
 assert(Buffer.byteLength(JSON.stringify(current.hoshimichi))<=100000);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const errors=[],external=[];
  const page=await browser.newPage({offline:true,viewport:{width:1280,height:900}});
  page.on('pageerror',e=>errors.push(e.stack));
  await page.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await page.goto(pathToFileURL(path.join(dbg,'dbg.html')).href);await page.waitForFunction(()=>window.__g);
  const switches=await page.evaluate(()=>{
   const g=__g,result=[];let old=null,disposed=0;
   for(const id of ['kanto','hoshimichi','kanto','city','kanto','wide','hoshimichi','dock','kanto','mesa','hoshimichi','dock-melee','kanto','hoshimichi']){
    if(g.cityMap){old=g.cityMap;for(const m of g.hittables.filter(m=>m.name.startsWith('city-collision-')))m.geometry.addEventListener('dispose',()=>disposed++);}
    g.selectMap(id);g.setup();
    if(old&&old!==g.cityMap&&old.cameraGeometryCount!==0)throw Error('切替前の都市の判定形状が残っている');
    const row={id,units:g.units.length,city:!!g.cityMap,proxies:g.cityMap?.cameraGeometryCount||0,colliders:g.hittables.filter(m=>m.name.startsWith('city-collision-')).length,disposed};
    if(['hoshimichi','kanto'].includes(id)){
     if(g.units.length!==20||g.jumpPads.length!==(id==='kanto'?6:0)||g.cores.B.pos.x!==(id==='kanto'?-310:260)||g.cores.B.pos.y!==(id==='kanto'?19:17))throw Error('都市の人数・設備・基地が不正');
     if(!Array.isArray(g.curMap.cityTerrain.volumes[0])||g.curMap.cityTerrain.meshes)throw Error('元のマップデータを書き換えている');
    }else if(g.cityBattle||row.colliders)throw Error('従来マップへ都市の処理が残っている');
    result.push(row);
   }
   return result;
  });
  for(const id of ['hoshimichi','kanto']){const cityCounts=switches.filter(s=>s.id===id);assert(cityCounts.every(s=>s.proxies===cityCounts[0].proxies&&s.colliders===cityCounts[0].colliders));}
  assert(switches.at(-1).disposed>0);assert.deepEqual(errors,[]);await page.close();
  // デバッグHTMLを使わず、配布と同じindex.html・maps.js・音源を通常通り読む。
  // 既存のThree.js CDNとフォントだけ試験内で応答する。地形の通信は許可しない。
  const production=await browser.newPage({offline:true,viewport:{width:1440,height:1000}});
  production.on('pageerror',e=>errors.push(e.stack));
  production.on('request',r=>{if(/^https?:/.test(r.url())&&!/fonts\.|cdnjs\.cloudflare\.com/.test(r.url()))external.push(r.url());});
  production.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED/.test(m.text()))errors.push(m.text());});
  await production.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
  const three=fs.readFileSync(path.join(ROOT,'vendor/three-r128/three.min.js'),'utf8');
  const observe=`\n(()=>{const Original=THREE.WebGLRenderer;THREE.WebGLRenderer=function(...args){const r=new Original(...args),render=r.render.bind(r);r.render=(s,c)=>{window.testScene=s;window.testCamera=c;s.updateMatrixWorld(true);};window.renderTestFrame=()=>render(window.testScene,window.testCamera);return r;};THREE.WebGLRenderer.prototype=Original.prototype;})();`;
  await production.route('**/three.min.js',r=>r.fulfill({contentType:'application/javascript',body:three+observe}));
  await production.addInitScript(()=>{AudioContext=undefined;});
  const inputs=[];
  for(const team of ['B','R']){
   await production.goto(pathToFileURL(path.join(ROOT,'prototype/index.html')).href);
   await production.locator('button[data-page="pgMap"]').click();
   await production.locator('#mapList button[data-map="hoshimichi"]').click();
   if(await production.locator('#pgMap').isVisible())await production.locator('#pgMap .back').click();
   await production.locator(`input[name="team"][value="${team}"]`).check();
   await production.locator('#start').click();
   await production.waitForFunction(()=>{
    if(!window.testScene)return false;
    let u=null;testScene.traverse(m=>{if(m.userData.ref?.kind==='unit'&&m.userData.ref.isPlayer)u=m.userData.ref;});
    window.testPlayer=u;return !!u;
   });
   const start=await production.evaluate(()=>testPlayer.pos.toArray());
   await production.keyboard.down('KeyW');
   await production.waitForFunction(([x,,z])=>Math.hypot(testPlayer.pos.x-x,testPlayer.pos.z-z)>2,start,{timeout:30000});
   await production.keyboard.up('KeyW');const end=await production.evaluate(()=>testPlayer.pos.toArray());
   await production.waitForFunction(()=>testPlayer.invulT<=0&&!document.getElementById('announce').textContent.trim());
   await production.keyboard.press('KeyM');await production.waitForFunction(()=>!document.getElementById('bigMap').hidden);
   if(team==='B')await production.locator('#bigMapC').screenshot({path:path.join(output,'overview.png')});
   await production.keyboard.press('KeyM');
   await production.keyboard.press('F3');await production.waitForFunction(()=>!document.getElementById('pgOptions').hidden);
   await production.locator('#optionsResume').click();
   assert(await production.evaluate(()=>window.__g===undefined&&window.__cityBattle===undefined));
   inputs.push({team,start,end,map:true,optionsResume:true,debugHooks:false});
  }
  await production.keyboard.down('ArrowLeft');await production.waitForTimeout(450);await production.keyboard.up('ArrowLeft');
  await production.evaluate(()=>{renderTestFrame();});
  await production.screenshot({path:path.join(output,'battle.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(output,'integration-check.json'),JSON.stringify({unchangedMaps:Object.keys(previous),switches,inputs,errors,externalGeographyRequests:external},null,2)+'\n');
  console.log('既存配置の一致、都市と従来5ルールの切替、資源破棄、通常HTMLで両陣営の実入力・地図・再開：成功');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
