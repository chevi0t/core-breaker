// 初期構成だけの入替。通常の生成を通し、モデルと性能を別々に差し替えない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
const prepare=require('./prepare_bot_battle');
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),samples=[];
 try{
  for(const seed of [20261101,20261102]){
   const states=[];
   for(const [map,swapped] of [['circulation',false],['circulation-v3',false],['circulation',true]]){
    const {page,errors}=await openMap(browser,map,null,seed,{silent:true});
    try{
     await page.click('#start');
     const state=await page.evaluate(prepare,{fixture:{seed,swapped}});
     assert.ok(state.units.every(u=>!u.isPlayer));
     assert.equal(await page.evaluate(()=>!window.__botFixtureRandom),true,'初期化後は通常の乱数に戻す');
     assert.equal(await page.evaluate(()=>__g.units.every(u=>u.group.children.filter(o=>o.userData.own).every(o=>o.userData.ref===u))),true);
     assert.deepEqual(errors,[]);states.push(state);
    }finally{await page.close();}
   }
   assert.deepEqual(states[0],states[1],'地形の生成量が違っても初期状態は一致');
   const roster=u=>({cls:u.cls,role:u.role,mech:u.mech,weapons:u.weapons,walk:u.walk,cruise:u.cruise,weight:u.weight});
   for(let i=0;i<10;i++)assert.deepEqual(roster(states[0].units[i]),roster(states[2].units[(i+5)%10]),'青橙で同じ構成を入れ替える');
   samples.push({seed,normal:states[0],swapped:states[2]});
  }
  const output=process.argv[2]||'dbg/paired-rosters.json';fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({mapIndependent:true,rostersSwapped:true,ordinaryModelAndPhysics:true,samples},null,2)+'\n');
  console.log('2シード：戦場間の初期状態一致・全10機の構成入替・本体のモデル/判定・乱数hook解除を確認');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
