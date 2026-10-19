// 青1を通常Botとして作り、機体抽選・初動と見た目の生成を通常経路へ戻す検査。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {openMap}=require('../mapgen_browser');
const prepare=require('./prepare_bot_battle');
(async()=>{const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const samples=[];try{
 for(const seed of [20261071,20261072,20261073,20261074]){
  const {page,errors}=await openMap(browser,'circulation',null,seed,{silent:true});
  try{
   await page.click('#start');
   assert.equal(await page.evaluate(()=>__g.player.isPlayer),true,'フラグなしはプレイヤー');
   const legacy=await page.evaluate(prepare,true);
   assert.equal(legacy.units[0].waypoint,null,'旧初動はカタパルト選択なし');
   assert.equal(legacy.units[0].mech.legs,'standard','旧青1の機体は固定');
   const state=await page.evaluate(prepare,false);
   assert.equal(state.silent,true);
   assert.ok(state.units.every(u=>!u.isPlayer));
   assert.deepEqual(state.units.slice(0,5).map(u=>[u.cls,u.role]),state.units.slice(5).map(u=>[u.cls,u.role]));
   assert.equal(await page.evaluate(()=>__g.units.every(u=>u.group.children.filter(o=>o.userData.own).every(o=>o.userData.ref===u))),true,'実際のモデルと判定の持ち主');
   await page.evaluate(()=>{for(let i=0;i<60;i++)__g.loop(__advanceClock());});
   assert.equal(errors.length,0,errors.join('\n'));
   await page.evaluate(()=>{window.__allBotBattle=false;__g.setup();});
   assert.equal(await page.evaluate(()=>__g.player.isPlayer),true,'通常操作へ戻せる');
   samples.push({seed,legacy:legacy.units[0],ordinary:state.units[0],errors});
  }finally{await page.close();}
 }
 assert.ok(new Set(samples.map(s=>JSON.stringify(s.ordinary.mech))).size>1,'青1にも通常の機体抽選');
 assert.ok(samples.some(s=>s.ordinary.waypoint),'青1にも初動のカタパルト選択');
 const output=process.argv[2]||'dbg/bot-initialization.json';fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({seeds:samples.length,allUnitsOrdinaryBots:true,matchingClassAndRole:true,ordinaryMeshAndCollision:true,catapultChoice:true,normalPlayerRestored:true,samples},null,2)+'\n');
 console.log('4シード：全機通常Bot・両軍の兵装/役割・機体抽選・初動・モデル/判定・通常操作への復帰を確認');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
