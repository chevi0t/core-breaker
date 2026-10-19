// エンジン更新後も、登録済みマップを生成器と同じ実物理検査へ通す。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap,driveRoutes,driveMobility}=require('../mapgen_browser');
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),results=[];
 try{
  for(const map of ['circulation','circulation-v2','circulation-v3']){
   const {page,errors}=await openMap(browser,map,null,1,{silent:true});
   try{await page.click('#start');const routes=await page.evaluate(driveRoutes),mobility=await page.evaluate(driveMobility);
    assert.deepEqual(errors,[]);results.push({map,routes,mobility,errors});
   }finally{await page.close();}
  }
  const output=process.argv[2]||'dbg/generated-routes.json';fs.mkdirSync(path.dirname(output),{recursive:true});
  const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../..',file))).digest('hex');
  fs.writeFileSync(output,JSON.stringify({engineSha256:sha('prototype/index.html'),mapSha256:sha('prototype/maps/circulation.js'),results},null,2)+'\n');
  console.log(`${results.reduce((n,r)=>n+r.routes.length,0)}徒歩経路・${results.reduce((n,r)=>n+r.mobility.length,0)}設備乗降成功`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
