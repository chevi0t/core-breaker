// パイロット絵の揺れを場面ごとに撮る（止まる・右へ吹かす・止める・左・着地・被弾）。新しいキャラの揺れを目で確かめる用。
//   python3 tools/test/make_dbg.py dbg && node tools/test/pilot_sway_frames.js <キャラID> <出力の頭> [髪の倍率]
// <出力の頭>_0rest.png など7枚。背景は灰色。
const {chromium}=require('playwright');const path=require('path');
(async()=>{const id=process.argv[2]||'ace',out=process.argv[3];const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});const p=await b.newPage({viewport:{width:1280,height:800},deviceScaleFactor:3}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});await p.goto('file://'+path.resolve(__dirname,'../../dbg/dbg.html'));
await p.evaluate(id=>{document.querySelector(`[data-pilot-choice="${id}"]`).click();document.querySelector('#start').click();__g.running=false;},id);
await p.waitForFunction(()=>{__g.hud(240,.016);return document.querySelector('#pilotMark').classList.contains('swayOn')},null,{timeout:10000});
await p.evaluate(()=>{document.querySelector('#pilotMark canvas.pilotSway').style.background='#a8a890'});await p.evaluate(a=>{__g.pilotSway.state.hairAmp=a},Number(process.argv[4]||1));const cv=await p.$('#pilotMark canvas.pilotSway');
const run=async(fn)=>{await p.evaluate(fn);await p.waitForTimeout(80);};
const shots=[];
const snap=async n=>{const f=`${out}_${n}.png`;await cv.screenshot({path:f});shots.push(f)};
await run(()=>{const g=__g,P=g.player;P.invulT=0;P.alive=true;P.hurtT=0;P.vel.set(0,0,0);for(let i=0;i<30;i++)g.hud(240,.016)});await snap('0rest');
for(const [n,sx,steps] of [['1right',1,24],['2left',-1,24]]){
await run(new Function(`const g=__g,P=g.player;P.dashState='short';(P.boostVisualDir||=new g.T.Vector3()).set(${sx},0,0);for(let i=0;i<${steps};i++){P.vel.set(${sx}*20*Math.min(1,(i+1)/3),0,0);const t0=performance.now();while(performance.now()-t0<15);g.hud(240,.016)}`));await snap(n);
await run(()=>{const g=__g,P=g.player;P.dashState='';P.vel.set(0,0,0);for(let i=0;i<14;i++){const t0=performance.now();while(performance.now()-t0<15);g.hud(240,.016)}});await snap(n+'_stop');
await run(()=>{const g=__g,P=g.player;for(let i=0;i<80;i++){const t0=performance.now();while(performance.now()-t0<15);g.hud(240,.016)}});}
await run(()=>{const g=__g,P=g.player;P.vel.set(0,-12,0);g.hud(240,.016);P.vel.set(0,0,0);for(let i=0;i<5;i++){const t0=performance.now();while(performance.now()-t0<15);g.hud(240,.016)}});await snap('3land');
await run(()=>{const g=__g,P=g.player;P.hurtT=.09;g.hud(240,.016)});await snap('4dmg');
console.log(shots.join(' '),errors);await b.close();})();
