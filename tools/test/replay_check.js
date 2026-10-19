// 保存した試合の閲覧・イベント遡り・被害内訳の整合性を実ブラウザで確認する。
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const {chromium}=require('playwright');
const fs=require('node:fs');
const input=path.resolve(ROOT,process.argv[2]||'mapdesign/circulation/replay/replay.html'),folder=path.dirname(input);
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{
const p=await b.newPage({viewport:{width:1280,height:1100}}),errors=[],external=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:') && !r.url().startsWith('file:'))external.push(r.url())});
await p.goto('file://'+input);
await p.waitForFunction(()=>!!window.__replay);
const expect=(v,msg)=>{if(!v)throw new Error(msg)};
const count=await p.evaluate(()=>__replay.data.matches.length);
expect(await p.locator('#match option').count()===count && count>0,'試合数');
for(let i=0;i<count;i++){
 await p.selectOption('#match',String(i));
 await p.evaluate(()=>__replay.seek(300));
 const s=await p.evaluate(()=>({actual:[document.querySelector('#coreB').textContent,document.querySelector('#coreR').textContent],expected:__replay.data.matches[Number(document.querySelector('#match').value)].finalCore.map(v=>Number(v.toFixed(2)).toLocaleString('ja-JP'))}));
 expect(JSON.stringify(s.actual)===JSON.stringify(s.expected),'終局HP表示');
}
const chosen=Math.min(1,count-1);await p.selectOption('#match',String(chosen));
const first=await p.evaluate(i=>{const events=__replay.data.matches[i].events;return events.find(e=>e.type==='coreHit')||events.find(e=>e.type==='wreck');},chosen);
expect(!!first,'被害イベントがある');
await p.selectOption('#eventFilter',first.type);
await p.locator('#events button').first().click();
expect(await p.evaluate(()=>__replay.selected!==null),'被害イベントの機体選択');
const attack=await p.evaluate(i=>{const m=__replay.data.matches[i],e=m.events.find(e=>e.type==='coreHit'&&e.unit?.startsWith('R'));return e?{unit:e.unit,t:m.events.filter(d=>d.type==='deploy'&&d.unit===e.unit&&d.t<=e.t).at(-1)?.t||0}:null;},chosen);
if(attack){await p.click('#firstOrange');expect(await p.evaluate(a=>__replay.time===a.t && __replay.selected===a.unit,attack),'最初の凸を出撃から再生');}await p.selectOption('#trails','sortie');
await p.evaluate(t=>__replay.seek(t),first.t);
const ledger=await p.evaluate(()=>{const m=__replay.data.matches[Number(document.querySelector('#match').value)],loss=m.events.filter(e=>(e.type==='coreHit'||e.type==='wreck')&&e.team==='B'&&e.t<=__replay.time).reduce((n,e)=>n+e.amount,0);return [document.querySelector('#coreB').textContent,Number((m.initialCore[0]-loss).toFixed(2)).toLocaleString('ja-JP')]});expect(ledger[0]===ledger[1],'命中直後のコアHPと被害内訳の一致');
await p.screenshot({path:path.join(folder,'viewer-check.png'),fullPage:true});
await p.click('#play');await p.waitForFunction(t=>__replay.time>t+.5,first.t);await p.click('#play');
const available=await p.locator('#eventFilter option').evaluateAll(options=>options.map(o=>o.value));
const types=['plant','deploy','baseEnter','wreck','coreHit','padLaunch','padLand','liftBoard','liftExit'].filter(type=>available.includes(type));
if(await p.evaluate(i=>__replay.data.matches[i].events.some(e=>e.facility),chosen))expect(['padLaunch','padLand','liftBoard','liftExit'].every(type=>types.includes(type)),'昇降イベントの選択肢');
for(const type of types){
 await p.selectOption('#eventFilter',type);const observed=await p.evaluate(({i,type})=>__replay.data.matches[i].events.filter(e=>e.type===type).length,{i:chosen,type});expect((await p.locator('#events button').count()>0)===(observed>0),type+'イベント表示');
 if(observed && ['padLaunch','padLand','liftBoard','liftExit'].includes(type)){
  const e=await p.evaluate(({i,type})=>__replay.data.matches[i].events.find(e=>e.type===type),{i:chosen,type});await p.locator('#events button').first().click();
  expect(await p.evaluate(e=>__replay.time===Math.max(0,e.t-8)&&__replay.selected===e.unit,e),type+'の8秒前と対象機体へ移動');
 }
}
await p.setViewportSize({width:390,height:844});
expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'モバイル横はみ出し');
expect(!errors.length,'ページエラー '+errors.join(','));expect(!external.length,'外部要求 '+external.join(','));
fs.writeFileSync(path.join(folder,'viewer-check.json'),JSON.stringify({matches:count,finalCoreDisplay:true,eventSeek:true,unitSelection:true,sortieTrail:true,playback:true,eventTypes:types.length,mobileWidth:390,overflow:false,firstAttackFromDeployment:!!attack,coreLossLedgerDisplay:true,externalRequests:external,errors},null,2)+'\n');
process.stdout.write(count+'試合切替・終局HP・イベント遡り・機体選択・軌跡・再生・390px幅・外部要求なしを確認\n');
}finally{await b.close()}})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1});
