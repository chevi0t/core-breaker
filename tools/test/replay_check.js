// 保存した3試合の閲覧・イベント遡り・被害内訳の整合性を実ブラウザで確認する。
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
const p=await b.newPage({viewport:{width:1280,height:1100}}),errors=[],external=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:') && !r.url().startsWith('file:'))external.push(r.url())});
await p.goto('file://'+path.join(ROOT,'mapdesign/circulation/replay/replay.html'));
await p.waitForFunction(()=>!!window.__replay);
const expect=(v,msg)=>{if(!v)throw new Error(msg)};
expect(await p.locator('#match option').count()===3,'試合数');
for(let i=0;i<3;i++){
 await p.selectOption('#match',String(i));
 await p.evaluate(()=>__replay.seek(300));
 const s=await p.evaluate(()=>({actual:[document.querySelector('#coreB').textContent,document.querySelector('#coreR').textContent],expected:__replay.data.matches[Number(document.querySelector('#match').value)].finalCore.map(v=>Number(v.toFixed(2)).toLocaleString('ja-JP'))}));
 expect(JSON.stringify(s.actual)===JSON.stringify(s.expected),'終局HP表示');
}
await p.selectOption('#match','1');
await p.locator('#events button').first().click();
expect(await p.evaluate(()=>__replay.selected!==null),'命中イベントの機体選択');
await p.click('#firstOrange');expect(await p.evaluate(()=>__replay.time===18.45 && __replay.selected==='R1'),'最初の凸を出撃から再生');await p.selectOption('#trails','sortie');
const first=await p.evaluate(()=>__replay.data.matches[1].events.find(e=>e.type==='coreHit'));
await p.evaluate(t=>__replay.seek(t),first.t);
const ledger=await p.evaluate(()=>{const m=__replay.data.matches[1],loss=m.events.filter(e=>(e.type==='coreHit'||e.type==='wreck')&&e.team==='B'&&e.t<=__replay.time).reduce((n,e)=>n+e.amount,0);return [document.querySelector('#coreB').textContent,Number((m.initialCore[0]-loss).toFixed(2)).toLocaleString('ja-JP')]});expect(ledger[0]===ledger[1],'命中直後のコアHPと被害内訳の一致');
await p.screenshot({path:path.join(ROOT,'mapdesign/circulation/replay/preview.png'),fullPage:true});
await p.click('#play');await p.waitForFunction(t=>__replay.time>t+.5,first.t);await p.click('#play');
for(const type of ['plant','deploy','baseEnter','wreck','coreHit']){await p.selectOption('#eventFilter',type);expect(await p.locator('#events button').count()>0,type+'イベント');}
await p.setViewportSize({width:390,height:844});
expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'モバイル横はみ出し');
expect(!errors.length,'ページエラー '+errors.join(','));expect(!external.length,'外部要求 '+external.join(','));
fs.writeFileSync(path.join(ROOT,'mapdesign/circulation/replay/viewer-check.json'),JSON.stringify({matches:3,finalCoreDisplay:true,eventSeek:true,unitSelection:true,sortieTrail:true,playback:true,eventTypes:5,mobileWidth:390,overflow:false,firstAttackFromDeployment:true,coreLossLedgerDisplay:true,externalRequests:external,errors},null,2)+'\n');
process.stdout.write('3試合切替・終局HP・イベント遡り・機体選択・軌跡・再生・390px幅・外部要求なしを確認\n');
}finally{await b.close()}})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1});
