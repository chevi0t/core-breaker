#!/usr/bin/env node
// 同じ地形の未圧縮版・圧縮版で、実ブラウザの復元値と描画を比較する。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {gunzipSync}=require('node:zlib'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const hash=data=>createHash('sha256').update(data).digest('hex');
function read(file){
 const html=fs.readFileSync(file,'utf8'),match=html.match(/let payload=(.*);\nif\(typeof payload/);
 assert(match,'圧縮対応HTMLの埋め込みデータ');let value=JSON.parse(match[1]);
 if(typeof value==='string')value=JSON.parse(gunzipSync(Buffer.from(value,'base64')));
 return value;
}
(async()=>{
 const before=path.resolve(process.argv[2]),after=path.resolve(process.argv[3]),sizeBaseline=path.resolve(process.argv[4]||before);
 const raw=read(before),packed=read(after);assert.deepEqual(packed,raw,'圧縮は形状・メタデータを可逆に保持');
 const errors=[],requests=[],screenshots={};const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,offline:true});const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  let browserHashes;
  for(const [label,file] of [['raw',before],['packed',after]]){
   await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.preview);
   assert.equal(await page.evaluate(()=>JSON.stringify(preview.meta)),JSON.stringify(raw.meta));
   const hashes=await page.evaluate(async()=>Object.fromEntries(await Promise.all(Object.entries(preview.groups).map(async([key,mesh])=>{
    const a=mesh.geometry.getAttribute('position').array,bytes=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
    const result=await crypto.subtle.digest('SHA-256',bytes);return [key,Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('')];
   }))));
   assert.deepEqual(hashes,Object.fromEntries(Object.entries(raw.data).map(([k,v])=>[k,hash(Buffer.from(v,'base64'))])));browserHashes=hashes;
   for(const view of ['oblique',...(raw.meta.railways?['railview']:[])]){
    await page.evaluate(name=>preview.preset(name),view);const shot=hash(await page.screenshot());
    if(label==='raw')screenshots[view]=shot;else assert.equal(shot,screenshots[view],view+'の画像が一致');
   }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  const sizes={uncompressedCurrent:fs.statSync(before).size,previousShared:fs.statSync(sizeBaseline).size,packed:fs.statSync(after).size};
  assert(sizes.packed<sizes.previousShared/2,'前の配布HTMLの半分未満');
  const result={codec:'gzip+base64',losslessPositionsAndMetadata:true,browserPositionSHA256:browserHashes,identicalScreenshots:screenshots,offline:true,externalRequests:0,browserErrors:0,htmlBytes:sizes,reductionFromPreviousPercent:100*(1-sizes.packed/sizes.previousShared),triangles:Object.values(raw.meta.layers).reduce((sum,v)=>sum+v.triangles,0)};
  fs.writeFileSync(path.join(path.dirname(after),'packing-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
