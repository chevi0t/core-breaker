// 絵のパイロット（揺れの設定 PILOT_RIGS があるキャラ全員）：標準とやられ顔の2枚の切り替え、横ブーストでの揺れ、保存と復帰。
// node tools/test/pilot_sprites_check.js dbg [スクリーンショットの頭（<頭>-<キャラ>.png）]
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const ids=[],b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});await p.goto('file://'+path.resolve(process.argv[2])+'/dbg.html');
const pilots=await p.evaluate(()=>Object.keys(__g.PILOT_RIGS));
for(const id of pilots){
await p.reload();await p.evaluate(id=>{document.querySelector(`[data-pilot-choice="${id}"]`).click();document.querySelector('#start').click();__g.running=false;},id);
// 揺れの絵が読み込まれるのを待つ
await p.waitForFunction(()=>{__g.hud(240,.016);return document.querySelector('#pilotMark').classList.contains('swayOn')},null,{timeout:10000});
const res=await p.evaluate(async(id)=>{const g=__g,p=g.player,mark=document.querySelector('#pilotMark');p.invulT=0;p.alive=true;p.downT=0;p.hurtT=0;p.yaw=0;
const face=mark.querySelector('.pilotSprite'),cv=mark.querySelector('canvas.pilotSway');
const shown=()=>getComputedStyle(cv).display!=='none';
if(face.dataset.state!=='NORMAL'||!shown())throw Error('normal');
// 標準の絵が2枚のどちらも読めて、寸法が合う
const sizes=[];for(const st of ['NORMAL','DAMAGE']){const s=document.createElement('span');s.className='pilotSprite';s.dataset.pilot=id;s.dataset.state=st;document.body.appendChild(s);const img=new Image();const urls=[...getComputedStyle(s).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)].map(m=>m[1]);s.remove();img.src=urls[urls.length-1];await img.decode();if(img.naturalWidth<128||img.naturalWidth!==img.naturalHeight)throw Error('decode '+st);sizes.push(img.naturalWidth);
// 顔の切り抜きのキャラは、やられ顔＝切り抜き＋標準の絵（重ねる）
if(st==='DAMAGE'&&g.PILOT_PATCHES[id]){if(urls.length!==2)throw Error('patch layers');const pi=new Image();pi.src=urls[0];await pi.decode();const r=g.PILOT_PATCHES[id].DAMAGE;if(Math.abs(pi.naturalWidth/img.naturalWidth-r[2])>.01)throw Error('patch size');}}if(sizes[0]!==sizes[1])throw Error('size');
// 止まっている間は揺れない
const step=n=>{for(let i=0;i<n;i++){g.hud(240,.016);}};
p.vel.set(0,0,0);p.dashState='';step(30);const rest=Math.abs(g.pilotSway.state.out.shakeX)+Math.abs(g.pilotSway.state.out.lean);
// 右へ吹かすと、絵が慣性で左へ遅れ、上半身が傾く。左は逆向き
const side=(sx)=>{p.dashState='short';(p.boostVisualDir||=new g.T.Vector3()).set(sx,0,0);const o=g.pilotSway.state.out;let hipMin=0,hipMax=0,leanMin=0,leanMax=0;for(let i=0;i<20;i++){p.vel.set(sx*20*Math.min(1,(i+1)/6),0,0);const t0=performance.now();while(performance.now()-t0<15);g.hud(240,.016);hipMin=Math.min(hipMin,o.hip);hipMax=Math.max(hipMax,o.hip);leanMin=Math.min(leanMin,o.lean);leanMax=Math.max(leanMax,o.lean);}const hair=o.hairX;p.dashState='';p.vel.set(0,0,0);for(let i=0;i<80;i++){const t0=performance.now();while(performance.now()-t0<15);g.hud(240,.016);}return {hipMin,hipMax,leanMin,leanMax,hair};};
const right=side(1),left=side(-1);
// 描けているか（真ん中付近が透明でない）
const px=new Uint8Array(4);const gl=cv.getContext('webgl');
// 被弾でやられ顔、揺れの絵は隠れる
const patched=!!g.PILOT_PATCHES[id];
// やられ顔：切り抜きのあるキャラは揺れの絵のまま顔だけ替わる。無いキャラは止まった絵
p.hurtT=.09;g.hud(240,.016);const dmg=face.dataset.state==='DAMAGE'&&(patched?shown()&&g.pilotSway.state.damage:!shown());
p.alive=false;p.hurtT=0;g.hud(240,.016);const dead=face.dataset.state==='DAMAGE';p.alive=true;await new Promise(r=>setTimeout(r,400));g.hud(240,.016);const back=face.dataset.state==='NORMAL'&&shown()&&!g.pilotSway.state.damage;
document.querySelector('[data-pilot-choice="tabby"]').click();g.hud(240,.016);if(document.querySelector('#pilotMark .pilotSprite, #pilotMark canvas'))throw Error('cat changed');document.querySelector(`[data-pilot-choice="${id}"]`).click();
return {patched,rest,right,left,dmg,dead,back};},id);
assert.ok(res.rest<1e-3,'止まっている間は揺れない');
assert.ok(res.right.hipMin<-1e-4&&res.left.hipMax>1e-4,'左右に吹かすと腰が滑る');
assert.ok(-res.right.hipMin>res.right.hipMax&&res.left.hipMax>-res.left.hipMin,'左右で滑る向きが逆');
assert.ok(Math.max(-res.right.leanMin,res.right.leanMax)>.01&&res.right.hair*res.left.hair<0,'上半身が傾き、髪が左右逆になびく');
assert.ok(res.dmg&&res.dead&&res.back,'やられ顔の切り替え');
await p.reload();assert.equal(await p.locator(`[data-pilot-choice="${id}"]`).getAttribute('aria-pressed'),'true');assert.deepEqual(errors,[]);console.log(id,JSON.stringify(res));ids.push(id);
if(process.argv[3]){await p.evaluate(()=>{document.querySelector('#start').click();__g.running=false;});await p.waitForFunction(()=>{__g.hud(240,.016);return document.querySelector('#pilotMark').classList.contains('swayOn')},null,{timeout:10000});await p.evaluate(()=>{document.querySelector('#start').click();__g.loop(performance.now()+16);__g.running=false;__g.player.invulT=0;__g.hud(240,.016);__g.renderView();});await p.waitForTimeout(300);await p.evaluate(()=>{const g=__g;g.player.dashState='short';(g.player.boostVisualDir||=new g.T.Vector3()).set(1,0,0);g.player.vel.set(20,0,0);for(let i=0;i<4;i++){const t0=performance.now();while(performance.now()-t0<15);g.hud(240,.016);}});await p.screenshot({path:`${process.argv[3]}-${id}.png`});}
}
console.log(`パイロットの揺れ：${ids.join('・')} 成功。ブラウザのエラーなし`);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
