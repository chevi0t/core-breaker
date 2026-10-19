// 同じ初期状態で、ブラウザ呼出しの区切りを変えても実走の状態列が一致するか確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {openMap}=require('../mapgen_browser'),prepare=require('./prepare_bot_battle');
(async()=>{const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),runs=[];
try{
 for(const chunk of [400,100]){
  const {page,errors}=await openMap(browser,'circulation-v3',null,20261073,{silent:true});
  try{
   await page.click('#start');const initialization=await page.evaluate(prepare,false);
   const frames=[];
   for(let i=0;i<400;i+=chunk)frames.push(...await page.evaluate(count=>{
    const g=__g,out=[];for(let i=0;i<count;i++){
     g.loop(__advanceClock());
     if(i%20===19)out.push({core:[g.cores.B.hp,g.cores.R.hp],u:g.units.map(u=>[...u.pos.toArray(),...u.vel.toArray(),u.hp,u.alive,u.cls,u.stun])});
    }return out;
   },chunk));
   assert.equal(errors.length,0,errors.join('\n'));runs.push({initialization,frames});
  }finally{await page.close();}
 }
 assert.deepEqual(runs[0],runs[1],'同一シードの初期状態と20秒の全機体状態');
 const output=process.argv[2]||'dbg/bot-determinism.json';fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({seed:20261073,silent:true,seconds:20,chunks:[400,100],samples:20,identical:true,errors:[]},null,2)+'\n');
 console.log('同じシードで20秒・全10機の位置/速度/耐久/生死・コアの状態列が完全一致');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
