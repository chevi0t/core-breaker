// 地形確認段階。整数列の復元、矩形の範囲、縮尺、変形とオフライン描画を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const dir=path.resolve(process.argv[2]||'mapdesign/hoshimichi_west'),out=path.resolve(process.argv[3]||'dbg/hoshimichi-west');fs.mkdirSync(out,{recursive:true});
 const bytes=fs.statSync(path.join(dir,'layout.json')).size,info=JSON.parse(fs.readFileSync(path.join(dir,'generation.json'))),data=JSON.parse(fs.readFileSync(path.join(dir,'layout.json')));
 assert.equal(bytes,info.layoutBytes);assert.deepEqual(info.playableGameExtentMeters,[700,350]);assert.equal(info.equivalentRealWorldMechHeightMeters,8);assert.equal(info.bases,0);assert.equal(info.plants,0);
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await page.goto(pathToFileURL(path.join(dir,'preview.html')).href);await page.waitForSelector('body[data-ready="true"]',{timeout:30000});
  const checks=await page.evaluate(()=>{
   const p=__preview,checks=[];const yes=(ok,name)=>{if(!ok)throw Error(name);checks.push(name);};
   const d=p.layout,meta=p.meta;yes(d.volumes.length===d.volumeCount,'全建物を整数列から復元');
   yes(d.volumes.every(v=>Number.isFinite(v.bottom)&&Number.isFinite(v.top)&&v.top>v.bottom&&v.rings.length),'建物の高さと輪郭が有限');
   yes(d.volumes.every(v=>v.rings.every(r=>r.length>=3&&r.every(([x,z])=>Number.isFinite(x)&&Number.isFinite(z)&&Math.abs(x)<=450.03&&Math.abs(z)<=275.03))),'全輪郭が描画範囲内');
   const xs=meta.playable.map(q=>q[0]),zs=meta.playable.map(q=>q[1]);
   yes(Math.max(...xs)-Math.min(...xs)===700&&Math.max(...zs)-Math.min(...zs)===350,'進入範囲案は700×350m');
   yes(meta.previous.every(([x,z])=>x>=Math.min(...xs)&&x<=Math.max(...xs)&&z>=Math.min(...zs)&&z<=Math.max(...zs)),'元の秋葉原600m四方を全て含む');
   const station=meta.labels.find(q=>q.text==='新御茶ノ水駅');yes(station&&station.at[0]>=Math.min(...xs)&&station.at[0]<=Math.max(...xs)&&station.at[1]>=Math.min(...zs)&&station.at[1]<=Math.max(...zs),'新御茶ノ水の参照点も進入範囲案に含む');
   yes(d.volumes.some(v=>v.kind==='infill'&&v.landmarkColor==='#75817f'),'外側に簡略背景がある');
   yes(d.volumes.some(v=>v.landmarkColor==='#d22c39')&&d.volumes.some(v=>v.landmarkColor==='#246aca'),'秋葉原側の赤・青のランドマーク色を引き継ぐ');
   const northwest=d.volumes.filter(v=>v.kind==='grounded'&&v.rings[0].some(([x,z])=>x<0&&z< -70));
   yes(northwest.length>30,'北西側の文京区にも建物を取り込む');
   const meshes=p.scene.children.filter(q=>q.isMesh),original=meshes.map(m=>m.geometry.attributes.position.array.slice());
   yes(meshes.every(m=>{const a=m.geometry.attributes.position.array;for(let i=0;i<a.length;i+=9)if(Math.max(a[i],a[i+3],a[i+6])-Math.min(a[i],a[i+3],a[i+6])>8.01)return false;return true;}),'長い高架と床も曲線に追従する分割を持つ');
   p.setWarp(true);let changed=0;
   for(let k=0;k<meshes.length;k++){const a=meshes[k].geometry.attributes.position.array,b=original[k];for(let i=0;i<a.length;i+=3){const yesFinite=Number.isFinite(a[i])&&Number.isFinite(a[i+1])&&Number.isFinite(a[i+2]);if(!yesFinite)throw Error('変形後の頂点が有限でない');if(Math.abs(a[i+2]-b[i+2])>.01)changed++;if(a[i]!==b[i]||a[i+1]!==b[i+1])throw Error('変形で幅や高さが変化した');}}
   yes(changed>1000,'道路・建物を共通の南北変形で曲げる');p.setWarp(false);
   yes(meshes.every((m,k)=>m.geometry.attributes.position.array.every((v,i)=>Math.abs(v-original[k][i])<.0001)),'変形を戻すと元座標へ復元');
   yes(p.renderer.info.render.triangles>0,'WebGLで実際に地形を描画');return checks;
  });
  await page.evaluate(()=>__preview.preset('top'));await page.screenshot({path:path.join(out,'overview.png')});
  await page.selectOption('#deform','1');await page.screenshot({path:path.join(out,'overview-bent.png')});
  await page.click('#oblique');await page.screenshot({path:path.join(out,'oblique.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const result={checks,errors,externalRequests:external,layoutBytes:bytes,withinTarget:info.withinTarget,volumes:data.volumeCount};fs.writeFileSync(path.join(out,'preview-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
