// 同一seed・wide10対10・120フレーム準備後の300フレームを、描画あり/行列更新のみで比較する。
// node tools/test/mech_performance_check.js dbg/base,dbg/before,dbg/after /tmp/performance.json [反復数=1]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const dirs=process.argv[2].split(',').map(p=>path.resolve(p)),out=path.resolve(process.argv[3]),repeats=+(process.argv[4]||1),results=[];
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-frame-rate-limit','--disable-gpu-vsync']});
 try{
  for(let run=0;run<repeats;run++)for(const render of [false,true])for(const dir of dirs){
   const page=await browser.newPage({viewport:{width:640,height:400}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**fonts.g*/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
   await page.addInitScript(()=>{let seed=15485863;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};window.requestAnimationFrame=fn=>{window.__benchFrame=fn;return 1;};window.__dt=1/60;});
   await page.goto('file://'+path.join(dir,'dbg.html'));
   const sample=await page.evaluate(render=>{
    const g=__g;g.selectMap('wide');document.getElementById('start').click();g.player.isPlayer=false;
    if(!render)g.renderer.render=sc=>sc.updateMatrixWorld(true);
    for(let i=0;i<120;i++)window.__benchFrame(performance.now());
    let total=0,alive=0,visible=0;const frames=[];
    for(let i=0;i<300;i++){const t=performance.now();window.__benchFrame(t);const ms=performance.now()-t;frames.push(ms);total+=ms;for(const u of g.units){if(u.alive)alive++;if(u.group.visible)visible++;}}
    frames.sort((a,b)=>a-b);
    return{meanMs:total/300,medianMs:frames[150],p95Ms:frames[285],units:g.units.length,aliveMean:alive/300,visibleMean:visible/300,render,frames:300,warmup:120};
   },render);
   assert.equal(sample.units,20);assert.deepEqual(errors,[]);results.push({dir:path.basename(dir),run,...sample});console.log(JSON.stringify(results.at(-1)));await page.close();
  }
 }finally{await browser.close();}
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({viewport:[640,400],map:'wide',seed:15485863,dt:1/60,repeats,renderer:'SwiftShader。描画ありはJSと描画命令の送信時間。GPU完了待ちは入れない。',results},null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
