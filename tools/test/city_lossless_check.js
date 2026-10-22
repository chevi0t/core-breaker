// 頂点列・色・法線・射線形状・画像を変更前と照合し、容量と再組み立ての保持数を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {createHash}=require('node:crypto');
(async()=>{
  const folder=path.resolve(process.argv[2]),baseline=path.resolve(process.argv[3]);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const reports=[],shots=[];
    for(const dir of [baseline,folder]){
      const page=await browser.newPage({offline:true,viewport:{width:960,height:600}}),errors=[],external=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
      await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
      await page.goto(pathToFileURL(path.join(dir,'index.html')).href);await page.waitForFunction(()=>window.__cityTrial);
      const result=await page.evaluate(async()=>{
        const g=__cityTrial;g.setup();g.running=false;
        async function hash(a){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a.buffer,a.byteOffset,a.byteLength)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
        async function geometry(m){
          const geo=m.geometry,attributes={};let bytes=geo.index?.array.byteLength||0;
          for(const [name,a] of Object.entries(geo.attributes)){
            bytes+=a.array.byteLength;let expanded=a.array;
            if(geo.index){expanded=new a.array.constructor(geo.index.count*a.itemSize);for(let i=0;i<geo.index.count;i++)expanded.set(a.array.subarray(geo.index.array[i]*a.itemSize,geo.index.array[i]*a.itemSize+a.itemSize),i*a.itemSize);}
            attributes[name]={hash:await hash(expanded),itemSize:a.itemSize,normalized:a.normalized};
          }
          return {name:m.name,attributes,bytes,vertices:geo.attributes.position.count,triangles:(geo.index?.count||geo.attributes.position.count)/3};
        }
        const arrays={};for(const [k,a] of Object.entries(g.city.arrays))arrays[k]=await hash(a);
        const render=await Promise.all(g.mapRoot.children.filter(m=>m.name.startsWith('city-')).map(geometry));
        const collision=await Promise.all(g.hittables.filter(m=>m.name.startsWith('city-collision-')).map(geometry));
        return {arrays,render,collision,metadata:JSON.stringify({volumes:g.city.volumes,spawns:g.city.spawns,river:g.city.river,district:g.city.district}),geometryStats:g.city.geometryStats||null};
      });
      const images=[];
      for(const [name,eye,target] of [
        ['overview',[360,500,420],[0,0,0]],['street',[-185,4,-50],[-190,5,-120]],
        ['glass',[-150,75,-120],[-75,45,-205]],['heritage',[-240,90,100],[-280,3,161]],
        ['rail',[90,95,-160],[0,8,-105]],['north-east',[170,170,-40],[250,8,-210]],
        ['blue',[170,120,200],[240,-2,260]],['orange',[-200,140,-150],[-230,-2,-240]],
        ['underpass',[-55,2.5,-104],[-5,2.5,-100]]
      ]){
        await page.evaluate(({eye,target})=>{
          const g=__cityTrial;g.player.group.visible=false;
          g.renderer.setSize(960,600);g.renderer.domElement.id='losslessCanvas';
          g.renderer.domElement.style.cssText='position:fixed;inset:0;z-index:2147483647';
          g.camera.aspect=960/600;g.camera.updateProjectionMatrix();g.camera.position.fromArray(eye);g.camera.lookAt(new g.T.Vector3(...target));g.camera.updateMatrixWorld(true);
          g.scene.updateMatrixWorld(true);g.renderer.render(g.scene,g.camera);
        },{eye,target});
        images.push({name,bytes:await page.locator('#losslessCanvas').screenshot({path:path.join(folder,(dir===baseline?'before-':'after-')+name+'.png')})});
      }
      if(dir===folder){
        const counts=await page.evaluate(()=>{
          const g=__cityTrial,result=[g.city.cameraGeometryCount];
          for(let i=0;i<3;i++){g.setup();g.running=false;result.push(g.city.cameraGeometryCount);}
          return result;
        });
        assert.ok(counts.every(v=>v===counts[0]),'再組み立てでカメラ形状が増えない: '+counts.join(','));result.cameraGeometryCounts=counts;
      }
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);reports.push({...result,errors,external});shots.push(images);
      await page.close();
    }
    const [old,now]=reports;
    assert.deepEqual(now.arrays,old.arrays,'物理へ渡すfloat32列がビット単位で一致');assert.equal(now.metadata,old.metadata,'体積・基地・復帰経路を維持');
    for(const kind of ['render','collision']){
      assert.deepEqual(now[kind].map(v=>({name:v.name,attributes:v.attributes,triangles:v.triangles})),old[kind].map(v=>({name:v.name,attributes:v.attributes,triangles:v.triangles})),kind+'の頂点・属性・面順を維持');
    }
    const images=[];
    for(let i=0;i<shots[0].length;i++){
      const before=shots[0][i],after=shots[1][i];assert.ok(before.bytes.equals(after.bytes),'同じ視点の画像が一致: '+before.name);images.push({name:before.name,identical:true});
    }
    const memory={};for(const kind of ['render','collision']){
      memory[kind]={beforeBytes:old[kind].reduce((n,v)=>n+v.bytes,0),afterBytes:now[kind].reduce((n,v)=>n+v.bytes,0),beforeVertices:old[kind].reduce((n,v)=>n+v.vertices,0),afterVertices:now[kind].reduce((n,v)=>n+v.vertices,0)};
      assert.ok(memory[kind].afterBytes<memory[kind].beforeBytes,kind+'のバッファが小さくなる');
    }
    const beforeHTML=fs.readFileSync(path.join(baseline,'index.html')),afterHTML=fs.readFileSync(path.join(folder,'index.html'));
    const packedSize=html=>Buffer.from(html.toString().match(/const CITY = await createCityTrial\(T,"([^"]+)"/)[1],'base64').length;
    const report={bitExact:true,images,memory,cameraGeometryCounts:now.cameraGeometryCounts,
      baselineHTMLSHA256:createHash('sha256').update(beforeHTML).digest('hex'),
      files:{htmlBefore:beforeHTML.length,htmlAfter:afterHTML.length,mapGzipBefore:packedSize(beforeHTML),mapGzipAfter:packedSize(afterHTML)},
      errors:[],externalRequests:[],offline:true};
    fs.writeFileSync(path.join(folder,'lossless-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
