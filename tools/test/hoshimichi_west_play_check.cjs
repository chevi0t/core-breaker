// 通常HTMLの出撃・歩行・ブースト・ジャンプ・全体マップを実入力で確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {build}=require('../build_hoshimichi_west_battle.cjs');
const out=path.resolve(process.argv[2]||'/tmp/hoshimichi-west-play-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const file=path.join(out,'battle.html');build(file);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 const errors=[],requests=[];
 try{
  const normal=await browser.newPage({offline:true,viewport:{width:1280,height:900}});
  normal.on('pageerror',e=>errors.push(e.stack));normal.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await normal.addInitScript(()=>{
   AudioContext=undefined;
   // 本体の関数や入力を差し替えず、描画へ渡された機体とフレームだけを観測する。
   let three;
   Object.defineProperty(window,'THREE',{configurable:true,get:()=>three,set:value=>{
    three=value;let Renderer;
    Object.defineProperty(value,'WebGLRenderer',{configurable:true,get:()=>Renderer,set:Original=>{
     Renderer=function(...args){const r=new Original(...args),render=r.render.bind(r);r.render=(scene,camera)=>{
      if(!window.walkPlayer)scene.traverse(m=>{if(m.userData.ref?.kind==='unit'&&m.userData.ref.isPlayer){window.walkPlayer=m.userData.ref;window.walkRenderer=r;}});
      return render(scene,camera);
     };return r;};Renderer.prototype=Original.prototype;
    }});
   }});
  });
  normal.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await normal.goto(pathToFileURL(file).href);await normal.locator('#start').click();await normal.waitForFunction(()=>window.walkPlayer?.alive);
  const start=await normal.evaluate(()=>walkPlayer.pos.toArray());
  await normal.keyboard.down('KeyW');await normal.waitForFunction(([x,,z])=>Math.hypot(walkPlayer.pos.x-x,walkPlayer.pos.z-z)>2,start);
  await normal.keyboard.down('ShiftLeft');await normal.waitForFunction(()=>!!walkPlayer.dashState);
  await normal.keyboard.up('ShiftLeft');await normal.keyboard.up('KeyW');
  await normal.waitForFunction(()=>walkPlayer.onGround&&!walkPlayer.stun);const baseY=await normal.evaluate(()=>walkPlayer.pos.y);
  await normal.keyboard.down('Space');await normal.waitForFunction(y=>walkPlayer.pos.y>y+.3,baseY);await normal.keyboard.up('Space');
  const input=await normal.evaluate(()=>({end:walkPlayer.pos.toArray(),renderedTriangles:walkRenderer.info.render.triangles}));
  assert(input.renderedTriangles>0);
  assert.match(await normal.locator('#timer').textContent(),/^\d+:\d+$/);assert.equal(await normal.evaluate(()=>window.__g===undefined),true);
  await normal.keyboard.press('KeyM');assert.equal(await normal.locator('#bigMap').isVisible(),true);await normal.keyboard.press('KeyM');
  await normal.screenshot({path:path.join(out,'battle-play.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  fs.writeFileSync(path.join(out,'play-check.json'),JSON.stringify({start,...input,errors,externalRequests:requests},null,2)+'\n');
  console.log(JSON.stringify({actualInputs:true,triangles:input.renderedTriangles,errors,externalRequests:requests}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
