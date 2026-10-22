#!/usr/bin/env node
// 独立した地形ビューアをオフラインで検査。ゲーム本体は起動しない。
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const {chromium}=require('playwright');
(async()=>{
 const file=path.resolve(process.argv[2]),output=path.dirname(file),errors=[],requests=[];
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,offline:true});const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.preview);
  const initial=await page.evaluate(()=>({triangles:preview.renderer.info.render.triangles,layers:Object.keys(preview.groups),height:new THREE.Box3().setFromObject(preview.robot).getSize(new THREE.Vector3()).y}));
  assert.deepEqual(initial.layers.sort(),['bldg','brid','dem','tran',...(initial.layers.includes('rail')?['rail']:[]),...(initial.layers.includes('station')?['station']:[])].sort());assert(initial.triangles>1000);assert(Math.abs(initial.height-4)<.001);
  for(const name of ['oblique','top','street','scale']){await page.locator('#'+name).click();if(name==='scale'){const blocked=await page.evaluate(()=>{const target=preview.robot.position.clone().add(new THREE.Vector3(0,2,0)),ndc=target.clone().project(preview.camera),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),preview.camera);const hit=ray.intersectObject(preview.groups.bldg)[0];return !!hit&&hit.distance<ray.ray.origin.distanceTo(target)-.2;});assert.equal(blocked,false,'比較機体が建物に隠れていない');}await page.screenshot({path:path.join(output,name+'.png')});}
  if(initial.layers.includes('rail')){await page.locator('#railview').click();assert.equal(await page.evaluate(()=>preview.groups.bldg.visible),initial.layers.includes('station'));if(initial.layers.includes('station'))assert.equal(await page.evaluate(()=>preview.groups.station.visible),true);await page.screenshot({path:path.join(output,'railview.png')});}
  for(const name of initial.layers){await page.locator('#'+name).uncheck();assert.equal(await page.evaluate(n=>preview.groups[n].visible,name),false);await page.locator('#'+name).check();assert.equal(await page.evaluate(n=>preview.groups[n].visible,name),true);}
  await page.locator('#top').click();const before=await page.evaluate(()=>preview.camera.position.toArray());
  await page.mouse.move(1000,550);await page.mouse.down();await page.mouse.move(1080,600,{steps:5});await page.mouse.up();assert.notDeepEqual(await page.evaluate(()=>preview.camera.position.toArray()),before);
  const zoom=await page.evaluate(()=>preview.camera.top);await page.mouse.wheel(0,-200);assert(await page.evaluate(()=>preview.camera.top)<zoom);
  const targetBefore=await page.evaluate(()=>preview.camera.position.toArray());await page.mouse.down({button:'right'});await page.mouse.move(1020,580,{steps:4});await page.mouse.up({button:'right'});assert.notDeepEqual(await page.evaluate(()=>preview.camera.position.toArray()),targetBefore);
  await page.setViewportSize({width:390,height:844});await page.locator('#controls-toggle').click();await page.locator('#top').click();await page.locator('#controls-toggle').click();await page.screenshot({path:path.join(output,'mobile.png')});
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  let infillToggle=false;await page.setViewportSize({width:1440,height:1000});if(await page.locator('#infill-label').isVisible()){await page.locator('#infill').check();assert.equal(await page.evaluate(()=>preview.infillOverlay.visible),true);await page.locator('#top').click();await page.screenshot({path:path.join(output,'infill.png')});await page.locator('#infill').uncheck();infillToggle=true;}
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  const result={infillToggle,offline:true,externalRequests:requests.length,browserErrors:errors.length,presets:initial.layers.includes('rail')?5:4,layerToggles:initial.layers.length,rotationZoomPan:true,scaleReferenceVisible:true,mobile:true,robotHeightMeters:initial.height,drawnTriangles:initial.triangles};fs.writeFileSync(path.join(output,'browser-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
