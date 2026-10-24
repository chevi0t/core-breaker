// 地形確認段階。整数列の復元、矩形の範囲、縮尺、切り取り回転とオフライン描画を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const dir=path.resolve(process.argv[2]||'mapdesign/hoshimichi_west'),out=path.resolve(process.argv[3]||'dbg/hoshimichi-west');fs.mkdirSync(out,{recursive:true});
 const bytes=fs.statSync(path.join(dir,'layout.json')).size,info=JSON.parse(fs.readFileSync(path.join(dir,'generation.json'))),data=JSON.parse(fs.readFileSync(path.join(dir,'layout.json')));
 assert.equal(bytes,info.layoutBytes);assert.deepEqual(info.playableGameExtentMeters,[700,350]);assert.equal(info.equivalentRealWorldMechHeightMeters,8);assert.equal(info.bases,0);assert.equal(info.plants,0);assert.equal(info.rotationDegrees,30);assert.equal(info.terrainDeformed,false);
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
   yes(meta.rotationDegrees===30&&meta.terrainDeformed===false&&!meta.warp,'街を変形せず切り取り枠を30度回転');
   yes(['秋葉原駅','秋葉原UDX','新御茶ノ水駅'].every(name=>{const q=meta.labels.find(q=>q.text===name);return q&&q.at[0]>=Math.min(...xs)&&q.at[0]<=Math.max(...xs)&&q.at[1]>=Math.min(...zs)&&q.at[1]<=Math.max(...zs);}),'主要3地点が進入範囲案に収まる');
   yes(d.volumes.some(v=>v.kind==='infill'&&v.landmarkColor==='#75817f'),'外側に簡略背景がある');
   yes(d.volumes.some(v=>v.landmarkColor==='#d22c39')&&d.volumes.some(v=>v.landmarkColor==='#246aca'),'秋葉原側の赤・青のランドマーク色を引き継ぐ');
   const northwest=d.volumes.filter(v=>v.kind==='grounded'&&v.rings[0].some(([x,z])=>x<0&&z< -70));
   yes(northwest.length>30,'北西側の文京区にも建物を取り込む');
   const meshes=p.scene.children.filter(q=>q.isMesh),original=meshes.map(m=>m.geometry.attributes.position.array.slice());
   const roof=d.volumes.find(v=>v.kind==='elevated'&&v.top===13&&v.landmarkColor==='#dce1df'),r=roof?.rings[0];
   yes(r?.length===4,'駅の屋根が四角形のまま');
   const edges=r.map((v,i)=>[r[(i+1)%4][0]-v[0],r[(i+1)%4][1]-v[1]]),lengths=edges.map(v=>Math.hypot(...v));
   yes(Math.abs(Math.min(...lengths)-35)<.05&&Math.abs(Math.max(...lengths)-118.5)<.05,'回転しても駅屋根の縦横の長さを保つ');
   yes(edges.every((v,i)=>Math.abs(v[0]*edges[(i+1)%4][0]+v[1]*edges[(i+1)%4][1])/(lengths[i]*lengths[(i+1)%4])<.001),'回転しても駅屋根の直角を保つ');
   const edgeAngle=(Math.atan2(edges[0][1],edges[0][0])*180/Math.PI+360)%90;
   yes(Math.abs(edgeAngle-30)<.05,'地理上の東西の線は枠内で30度斜めになる');
   p.setHeading('crop');
   yes(meshes.every((m,k)=>m.geometry.attributes.position.array.every((v,i)=>v===original[k][i])),'表示方向の切替で地形の頂点を変更しない');
   p.setHeading('north');
   const theta=meta.rotationDegrees*Math.PI/180,origin=new THREE.Vector3(0,0,0).project(p.camera),north=new THREE.Vector3(Math.sin(theta)*10,0,-Math.cos(theta)*10).project(p.camera);
   yes(Math.abs(north.x-origin.x)<.00001&&north.y>origin.y,'北を上にした表示方向を実カメラで確認');
   yes(!document.getElementById('deform')&&typeof p.setWarp==='undefined','街を曲げる操作を撤去');
   yes(p.renderer.info.render.triangles>0,'WebGLで実際に地形を描画');return checks;
  });
  await page.evaluate(()=>__preview.preset('top'));await page.screenshot({path:path.join(out,'overview.png')});
  await page.selectOption('#heading','crop');await page.screenshot({path:path.join(out,'overview-crop.png')});
  await page.selectOption('#heading','north');
  await page.click('#oblique');await page.screenshot({path:path.join(out,'oblique.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const result={checks,errors,externalRequests:external,layoutBytes:bytes,withinTarget:info.withinTarget,volumes:data.volumeCount};fs.writeFileSync(path.join(out,'preview-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,errors,externalRequests:external,layoutBytes:bytes,withinTarget:info.withinTarget}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
