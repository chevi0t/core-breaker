// 実描画の確認用。倍率0/標準/最大、通常/被弾/左右/ジャンプ着地、PC/スマホと保存。
const {chromium}=require('playwright'),path=require('path'),fs=require('fs'),assert=require('assert/strict');
(async()=>{const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{
const out=path.resolve(process.argv[3]||'/tmp/gizappa-review');fs.mkdirSync(out,{recursive:true});const errors=[],rows=[];
for(const mobile of [false,true]){
 const p=await b.newPage({viewport:mobile?{width:844,height:390}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});await p.goto('file://'+path.resolve(process.argv[2]||'dbg')+'/dbg.html');
 await p.evaluate(()=>{document.querySelector('[data-pilot-choice="gizappa"]').click();document.querySelector('#start').click();__g.running=false;});await p.waitForFunction(()=>{__g.hud(240,.016);return __g.pilotSway?.layered});
 for(const amp of [0,1,3]){
 await p.evaluate(amp=>{const g=__g;g.gameOptions.swayHair=g.gameOptions.swayChest=amp*100;g.hud(240,.016);if(g.pilotSway.state.hairAmp!==amp||g.pilotSway.state.chestAmp!==amp)throw Error('option multiplier');},amp);
 for(const [scene,v,vy,input]of [['rest',0,0,0],['right',1,0,1],['left',-1,0,-1],['jump',0,1,0],['land',0,0,0],['damage',0,0,0]]){
 const state=await p.evaluate(({scene,v,vy,input})=>{const g=__g,sw=g.pilotSway;sw.setDamage(scene==='damage');if(scene==='land')sw.step(.016,0,-1,0);for(let i=0;i<(scene==='rest'?150:24);i++)sw.step(1/60,v,vy,input);if(!Object.values(sw.state.out).every(Number.isFinite))throw Error('nonfinite');return {layered:sw.layered,damage:sw.state.damage,amp:sw.state.hairAmp};},{scene,v,vy,input});rows.push({mobile,amp,scene,...state});
 if(!mobile)await p.locator('#pilotMark canvas').screenshot({path:path.join(out,`${amp}-${scene}.png`)});
 }
 }
 await p.screenshot({path:path.join(out,mobile?'mobile.png':'pc.png')});await p.reload();assert.equal(await p.locator('[data-pilot-choice="gizappa"]').getAttribute('aria-pressed'),'true');await p.close();
}
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({rows,errors},null,2));console.log('36描画条件、PC/スマホ・保存成功',errors);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
