// 全マップの人数上下限、中間人数、出撃側切替、再試合、スコア表を実UIで確かめる。
const path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader']});
 try{
  const p=await b.newPage({viewport:{width:1280,height:960}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
  await p.route(/^https:\/\/fonts\./,r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await p.goto(pathToFileURL(path.join(path.resolve(process.argv[2]||'dbg'),'dbg.html')).href);
  const maps=await p.evaluate(()=>Object.keys(__g.MAPS).filter(k=>!__g.MAPS[k].testOnly));
  assert.equal(await p.locator('#teamSize option').count(),49);assert.equal(await p.locator('#battleSizeControl select').count(),1);
  for(const n of [2,50]){
   await p.selectOption('#teamSize',String(n));
   for(const map of maps){
    const roster=await p.evaluate(({map,n})=>{
     const g=__g;g.selectMap(map);g.setup();g.running=false;
     if(g.units.some(u=>!g.CLASSES[u.cls]||!['plant','attack','defend'].includes(u.role)||g.SLOTS.some(k=>!u.slots[k]?.w)))throw Error('編成が不正');
     return {count:g.units.length,players:g.units.filter(u=>u.isPlayer).length,B:g.units.filter(u=>u.team==='B').length,R:g.units.filter(u=>u.team==='R').length,indices:['B','R'].every(k=>new Set(g.units.filter(u=>u.team===k).map(u=>u.idx)).size===n)};
    },{map,n});
    assert.deepEqual(roster,{count:n*2,players:1,B:n,R:n,indices:true},map+' 人数'+n);
   }
  }
  for(const team of ['B','R'])for(const n of [3,17]){
   await p.check(`input[name="team"][value="${team}"]`);await p.selectOption('#teamSize',String(n));
   assert((await p.locator('#battleSizeHint').textContent()).includes(`味方BOT${n-1}機 対 敵BOT${n}機`));
   const roster=await p.evaluate(()=>{__g.setup();return [__g.units.filter(u=>u.team===__g.player.team).length,__g.units.filter(u=>u.team!==__g.player.team).length];});
   assert.deepEqual(roster,[n,n]);
  }
  await p.selectOption('#teamSize','50');
  await p.evaluate(()=>{const g=__g;g.setup();g.keys.Tab=true;g.running=true;g.hud(g.timeLeft,.016);g.running=false;});
  assert.equal(await p.locator('#board tbody tr').count(),100);
  await p.evaluate(()=>{__g.selectMap('dock-melee');__g.setup();});
  assert.equal(await p.evaluate(()=>__g.units.length),100,'近接限定でも人数を維持');
  await p.click('#resetBattleSize');await p.evaluate(()=>__g.setup());assert.equal(await p.evaluate(()=>__g.units.length),4);
  await p.selectOption('#teamSize','19');await p.reload();
  assert.equal(await p.locator('#teamSize').inputValue(),'2','再読み込みはマップ推奨人数');
  assert.deepEqual(errors,[]);console.log(`全${maps.length}マップ/配置の2対2・50対50、3対3・17対17の両出撃側、100行スコア、近接限定とリセット：成功。ブラウザエラー0。`);
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
